# IB Dashboard 数据修复与审计报告

> 版本：1.0.0  
> 日期：2026-04-11  
> 范围：PostgreSQL 迁移后数据链路全面修复与代码审计

---

## 一、本次已修复的问题

### 1. 历史 NAV 数据缺失（U12672188）
**现象**：`daily_nav` 只有 64 条（2026-01-12 ~ 2026-04-09），导致 3个月/YTD/1年/All 的区间汇总返回相同数值。

**根因**：`enforce_history_retention()` 依据 `user_profiles.max_history_months = 3` 默认删除了老数据。

**修复**：
- 将所有用户 `max_history_months` 更新为 `99`
- 从 `archive_change_in_nav` 重建 `U12672188` 的 `daily_nav`（520 条，2024-04-12 ~ 2026-04-09）
- 重新生成所有 Dashboard JSON 并清空 Redis 缓存

### 2. 现金与资产分类统计错误（U12672188）
**现象**：Cash 显示为 ~$1573 万（异常巨大），stocks/etfs/options 合计仅 ~$263 万。

**根因**：FlexQuery XML 中 `OpenPosition` 节点严重缺失 `fxRateToBase`、`currency`、`assetCategory`，导致：
- 持仓市值未做汇率转换，被直接当作基础货币（CNH）处理
- `estimated_cash = net_liquidation - position_total` 因此算出巨大现金
- 资产分类全部落入默认分类，统计严重失真

**修复**：
- `sqlite_to_dashboard.py`：`get_open_pos_breakdown` 增加从 `archive_conversion_rate` 查找汇率的 fallback，并根据 symbol/description 智能推断 ETF/OPTION/STOCK 分类
- `sqlite_to_dashboard.py`：`get_cash_by_currency` 增加 fallback，当 `archive_cash_report_currency` 为空时回退到 `archive_equity_summary_by_report_date_in_base.cash`
- `sqlite_to_dashboard.py`：`summary` 中的 stocks/etfs/options 统一使用 `balance_breakdown` 中已汇率转换后的基础货币数值
- `xml_to_postgres.py`：导入 `positions` 核心表时，若 `OpenPosition` 缺失 `fxRateToBase`，自动从 XML 的 `ConversionRate` 节点按 currency 查找汇率

**修复后 U12672188 数据（CNH 计价）**：
| 项目 | 数值 |
|------|------|
| totalNav | 18,365,677.61 |
| stocks | 13,190,788.74 |
| etfs | 6,286,454.66 |
| options | -1,481,325.12 |
| cash | 228,626.60 |

### 3. Flex Sync 日志支持手动停止与删除
**现象**："IB 自动同步" 页面只能看日志，无法删除历史记录或停止卡住的 running 任务。

**修复**：
- 数据库：`flex_sync_logs` 新增 `job_id` 字段关联 RQ 任务
- 后端：新增 `DELETE /api/flex-credentials/sync-logs/<log_id>` 和 `POST /api/flex-credentials/sync/cancel`
- 后端：`flex_sync_job` 启动时自动记录 RQ `job.id`
- 前端：日志表格增加"操作"列，running 状态显示"停止"按钮，所有行支持"删除"
- 更新了 `db/schema.sql` 定义

### 4. P0 审计问题批量修复（Dashboard 安全与数据正确性）
**现象**：审计报告中的 4 项 P0 问题导致多租户数据泄漏或关键指标失真。

**修复**：
- **Dashboard JSON 跨用户缓存隔离**：`server_saas.py` 与 `generate_dashboards.py` 将文件名从 `dashboard_{account_id}.json` 改为 `dashboard_{account_id}_{user_id}.json`，并兼容读取旧路径
- **`enforce_history_retention` 列名修正**：`utils/quotas.py` 中 `archive_trade` / `archive_cash_transaction` 的过滤条件从 `account_id` 改为 `stmt_account_id`
- **TWR 缺失 vs 0.0 区分**：`sqlite_to_dashboard.py` 的 `get_flow_series` 中，单账户分支对 `twr is None` 使用 `ending - prev_ending` 而非硬套公式；combined 分支跳过当天无数据的账户，避免把缺失误当 0 收益
- **FX 汇率 fallback 优化**：`sqlite_to_dashboard.py` 的 `get_fx_rates` 优先从 `archive_conversion_rate` 读取，再 fallback 到 `archive_cash_transaction`，避免缺汇率时默认 `1.0`
- **TimingAttribution 起始本金容错**：`dashboard_extensions.py` 跳过 `daily_nav` 开头连续 `ending_value = 0` 的记录，用第一个非零值作为起始本金

### 5. P1/P0 Combined 视图与成本基础修复
**现象**：合并账户（combined）持仓与资产分类存在基础货币未转换、成本基础跨账户混算、 stale 账户混入导致幽灵变动等问题。

**修复**：
- **`get_latest_positions` 基础货币转换**：combined 模式下改为逐账户查询最新持仓，利用 `archive_conversion_rate` 将各账户持仓市值、成本、 unrealized PnL 统一转换为基础货币后再按 symbol 聚合
- **`get_cost_basis` 按账户分组聚合**：提取 `_calc_cost_basis_for_account` 辅助函数，combined 模式下先逐账户计算，再按 symbol 加权合并（保留各自数量权重），避免跨账户直接混算
- **`get_open_pos_breakdown` / `pos_by_currency`  stale 账户过滤**：combined 模式下引入 7 天容差窗口，若某账户的 `archive_open_position` / `positions` 最新日期比全局最新日期落后超过 7 天，则排除该账户，防止旧持仓数据造成幽灵变动与分类失真
- **`import_xml_job` 保留策略顺序**：将 `enforce_history_retention` 提前到 `refresh_user_account` 之前执行，确保成本基础计算基于完整历史数据

---

## 二、代码审计发现的问题清单（待修复）

以下问题已通过代码审计识别，**尚未修复**，建议按优先级处理。

### 🔴 P0（严重）

| # | 问题 | 文件 | 影响 | 状态 |
|---|------|------|------|------|
| 1 | ~~Dashboard JSON 文件缓存跨用户泄漏：文件名 `data/dashboard_{account_id}.json` 不含 `user_id`，所有用户的 `combined` 视图共用同一文件~~ | ~~`server_saas.py`~~ | ~~多租户数据泄漏~~ | **已修复** |
| 2 | ~~`enforce_history_retention` 用 `account_id` 过滤 `archive_trade` 等表，实际应为 `stmt_account_id`~~ | ~~`utils/quotas.py`~~ | ~~老数据删不掉或误删~~ | **已修复** |
| 3 | ~~TWR 缺失时被存成 `0.0`，导致 `get_flow_series` 把全天涨跌误判为出入金~~ | ~~`xml_to_postgres.py` + `sqlite_to_dashboard.py`~~ | ~~MWR/收益/资金流水失真~~ | **已修复** |
| 4 | ~~`get_open_pos_breakdown` 对缺失汇率 fallback 到 `1.0`~~ | ~~`sqlite_to_dashboard.py`~~ | ~~外币持仓按 1:1 计入~~ | **已修复** |
| 5 | ~~合并账户时 `get_latest_positions` 使用原始本币市值相加，未转基础货币~~ | ~~`sqlite_to_dashboard.py`~~ | ~~combined 持仓总额无意义~~ | **已修复** |

### 🟠 P1（高）

| # | 问题 | 文件 | 影响 |
|---|------|------|------|
| 6 | `OpenPosition` 自身的 `fxRateToBase` 被完全忽略 | `xml_to_postgres.py` | 部分持仓 base value 为 NULL |
| 7 | `_collect_currency_fx_rates` 未校验 `toCurrency` 是否等于基础货币 | `xml_to_postgres.py` | 可能误用交叉汇率 |
| 8 | ~~数据保留策略在 `refresh_user_account` 之后执行，快照基于已被删除的交易~~ | ~~`workers/jobs.py`~~ | ~~成本基础与明细不一致~~ | **已修复** |
| 9 | ~~合并账户时 cost basis 查询未按账户分组聚合~~ | ~~`sqlite_to_dashboard.py`~~ | ~~同 symbol 多账户数据混算~~ | **已修复** |
| 10 | ~~合并账户时 `get_open_pos_breakdown` 混用不同账户的最新日期~~ | ~~`sqlite_to_dashboard.py`~~ | ~~持仓出现幽灵变动~~ | **已修复** |
| 11 | `archive_open_position` 无唯一约束，重复行导致 double count | `postgres_to_dashboard.py` | 持仓数值虚高 |

### 🟡 P2（中/低）

| # | 问题 | 文件 | 影响 |
|---|------|------|------|
| 12 | `CashReportCurrency` 核心表只存了 `cash`，丢了 `endingCash` 等字段 | `xml_to_postgres.py` | 现金明细 richer fallback 失效 |
| 13 | 合并账户现金原币直加 | `sqlite_to_dashboard.py` | combined 现金混算 |
| 14 | 期权 `estimatedPnl` 符号逻辑不明确 | `sqlite_to_dashboard.py` | 期权盈亏估算可能反号 |
| 15 | `get_true_performance` 用第一天 `ending_value` 当 `initial_capital` | `sqlite_to_dashboard.py` | totalGainPct / MWR 偏高 |
| 16 | ~~`get_fx_rates` 从 cash transaction 取汇率，而非 `archive_conversion_rate`~~ | ~~`sqlite_to_dashboard.py`~~ | ~~FX 面板汇率可能陈旧~~ | **已修复** |
| 17 | `get_base_currency` 硬编码 fallback 为 `CNH` | `sqlite_to_dashboard.py` | USD 账户显示错误基础货币 |
| 18 | `get_trade_pnl_analysis` 把 `mtmPnl` 当 realized PnL | `sqlite_to_dashboard.py` | 交易分析 realized 失真 |
| 19 | `get_position_attribution` 单账户查询未过滤 `stmt_account_id` | `sqlite_to_dashboard.py` | 可能混入其他账户持仓 |
| 20 | XML 上传与 Flex Sync 同账户无并发锁 | `workers/jobs.py` | 数据可能 flip-flop |
| 21 | Dashboard JSON 文件写和 Redis 写之间存在极小 stale 窗口 | `server_saas.py` | 导入后极短暂旧数据 |

---

## 三、当前环境状态

- **PostgreSQL 16**：`ib_dashboard` 数据库，已迁移完成，所有 `.db` SQLite 文件已删除
- **Redis**：localhost:6379，用于 RQ 队列和 Dashboard JSON 缓存
- **Flask SaaS**：`server_saas.py` 运行在 8080 端口
- **前端**：`web/dist` 已重新 build
- **历史数据**：
  - `U12672188`：`daily_nav` 520 条（2024-04-12 ~ 2026-04-09）
  - `U11181997`：`daily_nav` 817 条（2023-02-20 ~ 2026-04-07）

---

## 四、建议的下一步

1. **立即处理 P0**：尤其是跨用户缓存泄漏（#1）和 TWR=0 bug（#3），这两项会直接影响所有用户的数据正确性。
2. **处理 P1**：优先修复汇率相关（#6、#7）和 combined 视图逻辑（#5、#9、#10）。
3. **回归测试**：修复后重新运行 `generate_dashboards.py`，对比 `U12672188` 和 `combined` 的 summary / balanceBreakdown 是否一致。

---

*本报告由 Kimi Code CLI 生成于 2026-04-11。*
