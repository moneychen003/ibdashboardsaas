# IB Dashboard 操作记录

> 日期：2026-04-11  
> 操作人：Kimi Code CLI

---

## 一、本次会话概览

本次会话按 **A → B → C** 顺序完成了三类修复：

- **A**：`timingAttribution` 扩展的数据容错
- **B**：4 项 P0 审计问题修复
- **C**：4 项 P1/P0 combined 视图与成本基础修复，以及审计文档更新

---

## 二、文件修改清单

| 文件 | 修改次数 | 主要内容 |
|------|----------|----------|
| `scripts/dashboard_extensions.py` | 2 处 | timingAttribution 起始本金容错；tradeRankings / slbIncome / washSaleAlerts 数据回退逻辑修复 |
| `server_saas.py` | 1 处 | Dashboard JSON 文件缓存路径加入 `user_id` 隔离 |
| `scripts/generate_dashboards.py` | 1 处 | 生成文件名改为 `dashboard_{account_id}_{user_id}.json` |
| `utils/quotas.py` | 1 处 | `enforce_history_retention` 列名修正 `account_id` → `stmt_account_id` |
| `scripts/sqlite_to_dashboard.py` | 4 处 | TWR 缺失区分、FX 汇率 fallback 优化、combined 持仓基础货币转换、combined 成本基础按账户分组、stale 账户 7 天过滤 |
| `workers/jobs.py` | 1 处 | `enforce_history_retention` 提前到 `refresh_user_account` 之前执行 |
| `README_AUDIT_1.0.0.md` | 3 处 | 更新修复状态、新增章节说明、标记已修复项 |

---

## 三、详细修改记录

### 1. `scripts/dashboard_extensions.py`

#### a) `get_timing_attribution` — 起始本金容错
**修改前**：直接取 `daily_nav` 第一天的 `ending_value` 作为 `start_nav`，但该账户最早 18 天均为 `0`，导致分母为 0。  
**修改后**：遍历 `daily_nav` 开头连续为 0 的记录，取**第一个非零 `ending_value`** 作为 `start_nav`。

#### b) 扩展数据零值修复
- **`tradeRankings`**：当 `fifo_pnl_realized` 为 `0` 时，回退使用 `mtm_pnl`（IB 数据不填充 fifo 字段）
- **`slbIncome`**：当 `fee` 为 `0` 时，回退使用 `gross_lend_fee`
- **`washSaleAlerts`**：同上回退逻辑；并修复了子查询中缺失的 account_id 参数绑定

---

### 2. `server_saas.py`

**问题**：Dashboard JSON 文件缓存路径为 `data/dashboard_{account_id}.json`，不含 `user_id`，多租户环境下存在数据泄漏风险。  
**修复**：
- 新路径改为 `data/dashboard_{account_id}_{user_id}.json`
- 读取时**优先新路径、兼容旧路径**
- 实时计算落盘时写入新路径

---

### 3. `scripts/generate_dashboards.py`

同步 `server_saas.py` 的文件名规范：
```python
output = f"data/dashboard_{account_id}_{user_id}.json"
```

---

### 4. `utils/quotas.py`

**问题**：`enforce_history_retention` 使用 `account_id` 过滤 `archive_trade` 和 `archive_cash_transaction`，但这两张表的实际列名为 `stmt_account_id`，导致历史清理条件永远不命中。  
**修复**：将两处 `WHERE user_id = %s AND account_id = %s` 改为 `WHERE user_id = %s AND stmt_account_id = %s`。

---

### 5. `scripts/sqlite_to_dashboard.py`

#### a) `get_flow_series` — TWR 缺失 vs 0.0 区分
**问题**：`daily_nav.twr` 为空时存入 `0.0`，代码把 `0.0` 当正常 TWR 处理，导致全天涨跌被误判为出入金。  
**修复**：
- 单账户分支：判断 `if twr is None` 时用 `ending_val - prev_ending` 代替 TWR 公式
- Combined 分支：跳过当天无数据的账户，避免用 `0` 代替缺失 TWR

#### b) `get_fx_rates` — FX 汇率 fallback 优化
**问题**：原本只从 `archive_cash_transaction` 取汇率，缺少时 fallback 到 `1.0`。  
**修复**：
1. 优先从 `archive_conversion_rate` 读取（带 `to_currency` 校验）
2. 缺失的币种再 fallback 到 `archive_cash_transaction`

#### c) `get_latest_positions` — combined 持仓基础货币转换（P0 #5）
**问题**：combined 模式下直接把各账户的 `position_value`（原币种）相加，未做汇率转换。  
**修复**：
- 逐账户查询最新 `positions` 和 `archive_open_position`
- 利用 `archive_conversion_rate` 获取该账户当日的 FX 映射
- 优先使用 `positions.position_value_in_base`；若缺失则按 `position_value * fx_rate` 计算
- 将市值、成本、unrealized PnL 统一转换为基础货币后，再按 `symbol` 聚合
- 增加 7 天容差窗口，过滤 stale 账户

#### d) `get_cost_basis` — combined 按账户分组聚合（P1 #9）
**问题**：combined 模式下直接把所有账户的交易混在一起计算成本基础，导致同 symbol 跨账户混算错误。  
**修复**：
- 提取 `_calc_cost_basis_for_account(conn, account_id)` 辅助函数
- `get_cost_basis` 在 combined 模式下逐账户计算，再按 symbol 加权合并（保留各自数量权重）

#### e) `get_open_pos_breakdown` / `pos_by_currency` — stale 账户过滤（P1 #10）
**问题**：combined 模式下混用不同账户的最新日期，某账户（如 U11181997）持仓停留在 2026-02-05，却被当作当前持仓混入 combined。  
**修复**：
- 计算全局最新日期
- 若某账户的 `archive_open_position` 最新日期比全局最新日期落后 **> 7 天**，则排除该账户

---

### 6. `workers/jobs.py`

**问题**：`import_xml_job` 和 `flex_sync_job` 中，`enforce_history_retention` 在 `refresh_user_account` **之后**执行，导致成本基础等快照基于已被删除的历史数据计算。  
**修复**：将 `enforce_history_retention` 提前到 `refresh_user_account` 之前。

---

### 7. `README_AUDIT_1.0.0.md`

- 新增 **"4. P0 审计问题批量修复"** 章节
- 新增 **"5. P1/P0 Combined 视图与成本基础修复"** 章节
- P0 表格中 #1~#5 标记为 **已修复**
- P1 表格中 #8~#10 标记为 **已修复**
- P2 表格中 #16 标记为 **已修复**

---

## 四、验证结果

### 4.1 Dashboard 生成
```bash
python3 scripts/generate_dashboards.py
# 状态：成功，无报错
```

### 4.2 关键数据校验

#### `timingAttribution`（U12672188）
```json
{'buyAndHoldReturn': 0.0, 'actualReturn': 25378.01, 'timingContribution': 25378.01}
```

#### Combined `openPositions` BABA 市值
- `positionValue`: `435,918.67`
- 计算过程：`63,840 USD × 6.8283 (CNH/USD)` = `435,918.67` ✅

#### Combined Summary 一致性
| 指标 | 数值 |
|------|------|
| totalNav | 18,365,677.61 |
| stocks | 13,190,788.74 |
| etfs | 6,286,454.66 |
| options | -1,481,325.12 |
| cash | 228,626.60 |

- stale 账户 U11181997（最新持仓 2026-02-05）已被正确排除 ✅
- 各分类数值与 `balanceBreakdown` 一致 ✅

---

## 五、遗留问题（待后续处理）

| 优先级 | 编号 | 问题简述 |
|--------|------|----------|
| P1 | #6 | `xml_to_postgres.py` 中 `OpenPosition` 自身的 `fxRateToBase` 被忽略 |
| P1 | #7 | `_collect_currency_fx_rates` 未校验 `toCurrency` 是否等于基础货币 |
| P1 | #11 | `archive_open_position` 无唯一约束，重复行导致 double count |
| P2 | #12~#21 |  assorted 中低优先级问题（详见 `README_AUDIT_1.0.0.md`） |

---

### 6. `DASHBOARD_SLICES` 分片缺失新扩展 key（实时修复）
**现象**：前端按 tab 分片加载数据（`/api/dashboard/:alias/positions` 等），但新加的 14 个扩展 key 未被加入 `DASHBOARD_SLICES`，导致 `PositionsTab` 的"历史持仓时间轴"、PerformanceTab 的"交易热力图"等组件显示"暂无数据"。

**修复**：在 `server_saas.py` 的 `DASHBOARD_SLICES` 中为各 tab 补充对应的扩展 key：
- `overview`: `fxExposure`, `slbIncome`, `enhancedCashflow`, `dividendTracker`
- `positions`: `positionTimeline`, `riskRadar`, `optionsStrategyLens`, `corporateActionImpact`
- `performance`: `tradingHeatmap`, `tradeRankings`, `feeErosion`, `timingAttribution`
- `details`: `orderExecution`, `washSaleAlerts`

**验证**：
```python
_slice_payload(payload, 'positions')  # 包含 positionTimeline，symbols=94
```

**用户操作**：刷新页面或切换账户后重新加载，即可看到数据。

---

### 7. 用户合并与数据迁移
**操作**：将 `13160170407@163.com`（user_id: `5800d4ba...`）的全部数据迁移到 admin 用户 `moneychen`（user_id: `8d242211...`）下，并清理其他用户。

**执行内容**：
- 迁移 40+ 张业务表（archive_*、positions、daily_nav、user_accounts 等）共计 **20 余万条记录** 的 `user_id`
- 删除 `moneychen` 原空的 `user_profiles`，保留并迁移 `13160170407@163.com` 的 profile 设置
- 删除 `13160170407@163.com` 的原用户记录以释放邮箱唯一约束
- 将 `moneychen` 的邮箱改为 `13160170407@163.com`，密码重置为 `19950712`，保持 `is_admin = TRUE`
- 删除其余 5 个测试/空用户（`moneychen@gmail.com`、`testviewer@example.com`、`tester999@example.com`、`folder_test@example.com`、`test2@example.com`）
- 清理旧的 Dashboard JSON 缓存文件和 Redis 缓存

**结果**：
- 系统中仅剩 `moneychen` 一个用户（admin）
- 该用户拥有原 `13160170407@163.com` 下的全部两个账户（`U11181997`、`U12672188`）及历史数据
- 需要重新登录（旧 JWT token 已失效）

---

*记录于 2026-04-11*
