# IB Dashboard 成本算法文档

> 最后更新：2026-04-10

本文档记录 `ib_dashboard` 项目中持仓成本的核心计算逻辑，供后续迁移到 SaaS/多租户 SQL 数据库时参考。

---

## 一、输入事件定义

所有影响持仓数量或成本的交易，被抽象为三种事件：

- `BUY`：买入股票 / ETF（含期权行权导致的被动买入）
- `SELL`：卖出股票 / ETF（含期权行权导致的被动卖出）
- `TRANSFER_IN` / `TRANSFER_OUT`：转入 / 转出

---

## 二、买入成本的计算规则

### 2.1 普通股票交易（`archive_trade`）

```python
cost = abs(trade_money) + commission + taxes
```

- `trade_money`：成交金额（IBKR XML 中的 `tradeMoney`）
- `commission`：佣金（`ibCommission`）
- `taxes`：税费

### 2.2 期权 Short Put 行权（Assignment）

Short Put 被行权意味着：**以 strike price 买入股票**。

#### 移动加权平均法（对齐 IBKR 默认）
```python
cost = strike_price × shares            # 不扣除权利金
```

IBKR 将权利金收入单独计为期权已实现盈亏，不抵扣股票的 cost basis。

#### 摊薄成本法（真实持仓成本）
```python
cost = strike_price × shares - premium  # 扣除收到的权利金
```

示例：30 元 strike，收了 10 元 premium：
- 移动加权成本 = 30 元/股
- 摊薄成本 = 20 元/股

### 2.3 期权 Long Call 行权（Assignment）

Long Call 被行权意味着：**以 strike price 买入股票**。

#### 移动加权平均法
```python
cost = strike_price × shares            # 不加 premium
```

#### 摊薄成本法
```python
cost = strike_price × shares + abs(premium)  # 加上已支付的权利金
```

### 2.4 期权 Short Call 行权（Assignment）⚠️

Short Call 被行权意味着：**被动卖出股票**（按 strike price 交割）。

**这本质上是 SELL 事件**，而非 BUY。

- 如果 IBKR XML 的 `Trade` 节点已包含对应 SELL 记录，则通过 `archive_trade` 正常处理。
- ⚠️ **如果 `Trade` 节点缺失该 SELL 记录**（与 Short Put 的 BUY 缺失类似），当前代码**不会**从 `OptionEAE` 自动补充 SELL 事件。

**建议补充逻辑：**
```python
if option_assignment.put_call == 'C' and premium > 0:
    # Short Call assignment → SELL at strike price
    net_proceeds = strike_price × shares
    events.append(type='SELL', qty=shares, cost=net_proceeds, net_proceeds=net_proceeds)
```

### 2.5 期权 Long Put 行权（Assignment）

Long Put 被行权意味着：**被动卖出股票**（按 strike price 交割）。

同样属于 SELL 事件。若 `Trade` 节点缺失，也应从 `OptionEAE` 补充。

---

## 三、两种成本算法

### 3.1 移动加权平均法（Moving Weighted Average）

**用途**：对齐 IBKR 客户端默认显示的成本价。

```python
total_cost = 0
total_qty = 0

for event in sorted_events:
    if event.type in ('BUY', 'TRANSFER_IN'):
        total_cost += event.cost
        total_qty += event.qty
    elif event.type in ('SELL', 'TRANSFER_OUT'):
        if total_qty > 0:
            ratio = min(event.qty / total_qty, 1)
            total_cost *= (1 - ratio)
            total_qty -= event.qty
        if total_qty <= 0:
            total_qty = 0
            total_cost = 0

avg_price = total_cost / total_qty if total_qty > 0 else 0
```

**核心规则**：卖出只按比例减少总成本，不改变剩余持仓的每股平均成本。

### 3.2 摊薄成本法（Diluted Cost Basis）

**用途**：显示用户真实的、经卖出盈亏和期权权利金调整后的持仓成本。

```python
total_cost = 0
total_qty = 0

for event in sorted_events:
    if event.type in ('BUY', 'TRANSFER_IN'):
        total_cost += event.cost_diluted   # 期权可能已扣除 premium
        total_qty += event.qty
    elif event.type in ('SELL', 'TRANSFER_OUT'):
        proceeds = event.cost - commission - taxes
        total_cost -= proceeds             # 盈亏直接摊入剩余成本
        total_qty -= event.qty
        if total_qty <= 0:
            total_qty = 0
            total_cost = 0

diluted_price = total_cost / total_qty if total_qty > 0 else 0
```

**核心规则**：卖出的净收入（`trade_money - commission - taxes`）直接抵扣（或增加）剩余持仓的总成本。盈利卖出会拉低剩余成本，亏损卖出会抬高剩余成本。

---

## 四、增量计算设计（SaaS 化）

### 4.1 为什么需要增量

当前实现每次导入 XML 后全量重算所有历史。SaaS 化后，为支持多用户并发和快速响应，必须改为**增量更新**。

### 4.2 核心思路

为每只股票的每只账户维护一个 **成本快照（Cost Basis Snapshot）**：

```sql
CREATE TABLE cost_basis_snapshots (
    user_id UUID,
    account_id TEXT,
    symbol TEXT,
    total_qty NUMERIC,
    total_cost_avg NUMERIC,      -- 移动加权总成本
    total_cost_diluted NUMERIC,  -- 摊薄成本总成本
    last_trade_date DATE,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, account_id, symbol)
);
```

### 4.3 增量流程

1. 用户上传新 XML → 解析出新增的 `Trade` / `OptionEAE` 事件
2. 读取该 `(user_id, account_id, symbol)` 的 snapshot
3. 仅将新事件按上述算法追加到 snapshot 状态
4. 写回 snapshot
5. Dashboard 直接从 snapshot 读取，无需重算

### 4.4 异常处理

- 如果用户上传了**包含旧数据**的新 XML（如时间范围重叠），需要先**去重**或**回滚到重叠日期之前的 snapshot**，再重新从该日期起算。
- 建议保留 `cost_basis_history` 表记录每日历史快照，便于回滚。

---

## 五、与 IBKR 的已知差异

1. **缺失早期 Trade 历史**：如果用户的 XML 没有导出完整历史（例如只导出了近一年），而持仓中存在更早买入的股票，则计算结果会与 IBKR 不一致。
2. **期权行权价的差异**：
   - 移动加权算法方向已对齐 IBKR（按 strike 算，不扣 premium）。
   - 摊薄成本法是本项目的特有算法，IBKR 客户端没有直接对应显示。
3. **Short Call / Long Put 行权**：当前代码依赖 `Trade` 节点包含对应 SELL 记录，若缺失会导致偏差。

---

## 六、前端展示

当前 Web 面板仅保留两种成本模式：

- **移动加权**：对应 IBKR Average Cost
- **摊薄成本**：对应 strike - premium 后的真实持仓成本

已移除 FIFO 和实际本金按钮，避免用户混淆。
