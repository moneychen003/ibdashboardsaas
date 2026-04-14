# IB Dashboard 数据字典

本文档说明 IBKR FlexQuery XML 导入后生成的核心表结构及字段含义，供前端开发和数据排查参考。

---

## 核心动态表

系统根据 IBKR FlexQuery XML 的节点类型动态创建 `archive_*` 表。以下是前端最常用的几张表。

---

## 1. `archive_trade` — 交易记录（最重要）

**数据来源**：IBKR FlexQuery XML 中的 `<Trade>` 节点  
**用途**：计算期权权益金、交易成本、历史盈亏分析

| 字段 | 类型 | 含义 | 备注 |
|------|------|------|------|
| `user_id` | UUID | 用户 ID | 多租户隔离 |
| `stmt_date` | DATE | 该条记录所属的 Flex Statement 日期 | 用于幂等删除/覆盖 |
| `stmt_account_id` | TEXT | 账户 ID，如 `U12672188` | |
| `symbol` | TEXT | 交易标的代码 | 期权格式：`XPEV  260417P00030000` |
| `description` | TEXT | 标的描述 | 如 `XPEV 17APR26 30 P` |
| `asset_category` | TEXT | 资产类别 | `STK`股票 / `OPT`期权 / `ETF` / `CASH` |
| `sub_category` | TEXT | 子类别 | 期权：`C`=Call, `P`=Put |
| `buy_sell` | TEXT | 交易方向 | `BUY` / `SELL` |
| `quantity` | TEXT | 成交数量 | ⚠️ **单位不统一**：IBKR 有时用股数(-100)，有时用张数(-1) |
| `trade_price` | TEXT | 每股/每张成交价 | 期权为**每股**价格 |
| `proceeds` | TEXT | 总权益金流水（未扣佣金） | SELL 为正，BUY 为负 |
| `ib_commission` | TEXT | IB 收取的佣金 | 通常为负数 |
| `net_cash` | TEXT | 扣除佣金后的净现金流 | `proceeds + ib_commission` |
| `trade_date` | TEXT | 交易日期 | 格式 `YYYYMMDD`，如 `20250903` |
| `trade_id` | TEXT | IBKR 交易 ID | |
| `transaction_id` | TEXT | IBKR 事务 ID | |
| `open_close_indicator` | TEXT | 开平仓标识 | `O`=开仓(Open), `C`=平仓(Close) |
| `put_call` | TEXT | 期权类型 | `C` / `P` |
| `strike` | TEXT | 行权价 | |
| `expiry` | TEXT | 到期日 | 格式 `YYYYMMDD` |
| `multiplier` | TEXT | 合约乘数 | 美股期权通常为 `100` |

### 关于期权 `quantity` 的兼容性

后端 `sqlite_to_dashboard.py` 在计算 `avg_premium_per_share` 时，已通过以下逻辑自动兼容两种单位：

```sql
CASE
    WHEN ABS(proceeds) / ABS(quantity) BETWEEN trade_price * 0.9 AND trade_price * 1.1
    THEN ABS(quantity)        -- quantity 是股数
    ELSE ABS(quantity) * 100  -- quantity 是张数，转为股数
END
```

**结论**：`avg_premium_per_share = SUM(proceeds) / SUM(股数)`，最终结果始终为**每股价格**。

---

## 2. `archive_statement_of_funds_line` — 资金流水

**数据来源**：`<StatementOfFundsLine>` 节点  
**用途**：资金对账、查看每日现金变动明细

| 字段 | 含义 |
|------|------|
| `date` | 发生日期 |
| `activity_code` | 活动代码，如 `SELL`、`BUY`、`DIV` |
| `activity_description` | 活动描述 |
| `amount` | 变动金额（基础货币） |
| `credit` / `debit` | 贷方/借方金额 |
| `balance` | 变动后余额 |

> ⚠️ **注意**：某些历史 XML 中，期权交易只出现在 `<StatementOfFundsLine>` 而没有 `<Trade>`。当前导入脚本**不会**将 `StatementOfFundsLine` 自动同步到 `archive_trade`，因此盈亏分析仍以 `archive_trade` 为准。

---

## 3. `archive_open_position` — 每日持仓快照

**数据来源**：`<OpenPosition>` 节点  
**用途**：生成每日持仓历史、计算市值

| 字段 | 含义 |
|------|------|
| `symbol` | 持仓代码 |
| `position` | 持仓数量 |
| `position_value` | 持仓市值 |
| `mark_price` | 标记价格 |
| `cost_basis_price` | 成本基础价 |

---

## 4. `daily_nav` — 每日净资产

**数据来源**：`<ChangeInNAV>` 节点  
**用途**：账户净值走势、收益率计算

| 字段 | 含义 |
|------|------|
| `date` | 日期 |
| `starting_value` | 期初净值 |
| `ending_value` | 期末净值 |
| `mtm` | 当日盯市盈亏 |
| `realized` | 已实现盈亏 |
| `commissions` | 佣金 |

---

## 5. Dashboard JSON 字段说明

`postgres_to_dashboard.py` 生成的 JSON 中，`openPositions.options` 数组包含以下关键字段：

| 字段 | 含义 | 计算方式 |
|------|------|---------|
| `contracts` | 持仓张数 | `ABS(positionValue) / ABS(markPrice) / 100` |
| `currentPrice` | 实时市场价 | 优先从 `market_prices` 表读取，否则 fallback 到持仓 markPrice |
| `premiumPerShare` | 原始开仓平均每股权益金 | 基于 `archive_trade` 所有 SELL 记录计算，**不受平仓/行权影响** |
| `premiumPerContract` | 每份合约权益金 | `premiumPerShare * 100` |
| `netPremium` | 总权益金现金 | `premiumPerContract * contracts`（按当前持仓张数） |
| `marketValue` | 当前市值 | `-contracts * currentPrice * 100`（卖期权为负） |
| `estimatedPnl` | 未实现盈亏 | `netPremium + marketValue` |
| `costBasisMoney` | IBKR 提供的成本基础 | |
| `fifoPnlUnrealized` | IBKR 提供的未实现盈亏 | |

---

## 6. 常见问题排查

### Q: 为什么期权盈亏和 IBKR 对不上？
A: 检查 `archive_trade` 中该期权的 SELL 开仓记录是否完整。如果缺失，需要补录历史 XML 或手动插入记录。

### Q: `quantity` 为什么有时是 -100 有时是 -1？
A: IBKR FlexQuery 在不同报告类型中单位不一致。后端已做自动兼容，无需手动调整。

### Q: 被行权的期权为什么还显示在持仓里？
A: 如果 `positions` 表中已经没有该记录，但 dashboard 还有，可能是缓存未刷新。清除 Redis 缓存即可。

### Q: 上传了 XML 但数据没更新？
A: 检查 `xml_uploads` 表中是否有该文件的导入记录。直接复制到 `uploads` 目录不会自动导入，必须通过 API 上传或运行扫描脚本 `scripts/scan_and_import_uploads.py`。

---

*最后更新：2026-04-14*
