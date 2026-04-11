# IB Dashboard 数据可视化扩展建议

> 版本：1.0.1  
> 日期：2026-04-11  
> 基于当前 PostgreSQL 全量数据的可视化扩展方向

---

## 一、现有数据资产盘点

| 数据表 | U12672188 数据量 | 当前利用程度 | 可挖掘价值 |
|--------|------------------|--------------|-----------|
| `archive_trade` | 296 条 | 中（已用于 PnL、月度统计） | **高**（交易行为、执行质量、时段分析） |
| `archive_order` | 489 条 | 低 | **高**（滑点、撤单率、下单偏好） |
| `archive_cash_transaction` | 371 条 | 中（明细列表） | **高**（现金流日历、净现金流趋势） |
| `archive_slb_open_contract` | 274 条 | 低 | **高**（借券收入、融券成本） |
| `archive_prior_period_position` | 8,494 条 | 低 | **极高**（历史持仓回溯、换手率、持仓演变） |
| `archive_mtm_performance_summary_underlying` | 有数据 | 低 | **高**（标的层面 MTM 归因） |
| `archive_corporate_action` | 2 条 | 低 | 中（公司行动影响） |
| `archive_change_in_dividend_accrual` | 262 条 | 中 | **高**（股息日历、分红收益率） |
| `archive_open_dividend_accrual` | 415 条 | 低 | **高**（待收股息跟踪） |
| `archive_net_stock_position` | 有数据 | 低 | 中（净多头集中度） |
| `archive_unbundled_commission_detail` | 有数据 | 低 | **高**（费用侵蚀分析） |
| `archive_conversion_rate` | 有数据 | 中（FX 面板） | **高**（汇率波动对总资产贡献） |
| `archive_statement_of_funds_line` | 有数据 | 低 | 中（资金流水明细） |

---

## 二、建议新增的展现维度

### 🔥 优先级 P0：最具洞察力的 5 个方向

#### 1. 历史持仓时间轴（Position History Timeline）
**数据源**：`archive_prior_period_position`（8,494 条，是 `OpenPositions` 的历史快照）

**展现形式**：
- 选择任意一只股票，展示它从**第一次出现**到**最后一次出现**的完整时间线
- 横轴：时间；纵轴：持仓数量 + 持仓市值（双轴）
- 叠加标记：交易日期（买卖点）、分红日期、公司行动日期
- **价值**：回答"我是什么时候买的、加仓了、减仓了、清仓了"

**可进一步扩展**：
- 持仓周转率排行榜（哪些股票换手最频繁）
- 最长/最短持仓周期 Top 10
- 任意历史日期点选查看当日完整持仓（"如果我在 2025-06-15 满仓，持仓是什么"）

---

#### 2. 订单执行质量分析（Order Execution Quality）
**数据源**：`archive_order` + `archive_trade`

**展现形式**：
- **滑点分析**：平均滑点 by Symbol / by Exchange / by 下单时段
- **撤单率**：总下单数 vs 成交数 vs 取消数（`archive_order` 有 `order_status` 或类似字段）
- **价格改善/恶化**：`limit_price` vs `avg_price` vs `market_price`
- **价值**：量化交易执行损耗，优化下单策略

---

#### 3. 外汇敞口与汇率贡献分解（FX Exposure & Contribution）
**数据源**：`archive_open_position` + `archive_conversion_rate` + `daily_nav`

**展现形式**：
- 各币种资产占比饼图（不是现金占比，而是**持仓市值按币种分解**）
- 汇率波动对总资产的影响：
  - "如果汇率不变，今日 NAV 应该是 X"
  - "汇率变动贡献了 +Y / -Y"
- 外汇敞口热力图（币种 × 资产类别矩阵）

**价值**：对于基础货币是 CNH、但大量持仓是 USD/HKD 的账户，这是最关键的归因

---

#### 4. 借券收益分析（Securities Lending Income）
**数据源**：`archive_slb_open_contract` + `archive_slb_fee` + `archive_slb_activity`

**展现形式**：
- 月度借券收入时间线
- 各标的借券收益率（借券收入 / 持仓市值）
- 借券 vs 不借券的机会成本对比
- 当前被借出股票清单及预计日收益

**价值**：量化被动收入来源，评估是否值得开通/保持借券服务

---

#### 5. 真实现金流瀑布（True Cashflow Waterfall）
**数据源**：`archive_cash_transaction` + `archive_trade`（净买入/卖出）+ `archive_change_in_dividend_accrual`

**展现形式**：
- 月度瀑布图：
  - 期初现金
  - + 净入金
  - + 股票卖出回款
  - + 股息收入
  - + 借券收入
  - - 股票买入支出
  - - 佣金税费
  - - 出金
  - = 期末现金
- 可筛选只看"净外部现金流"（入金-出金）vs "内部再投资"

**价值**：清晰区分"赚的钱"和"转进来的钱"

---

### 🟠 优先级 P1：锦上添花的数据产品

#### 6. 交易行为热力图（Trading Behavior Heatmap）
**数据源**：`archive_trade` + `archive_order`

- 按**星期几** × **小时段**的成交频率/金额热力图
- 识别交易习惯："我总在周一开盘和周五收盘操作"
- 叠加收益率：哪个时段下单的平均收益更高

#### 7. 最赚/最亏交易排行榜（Trade Hall of Fame / Shame）
**数据源**：`archive_trade`（`fifo_pnl_realized` 或 `mtmPnl`）

- Top 10 单笔盈利交易 & Top 10 单笔亏损交易
- 按 Symbol 聚合：哪个股票累计贡献最多利润/亏损
- 盈亏归因标签："选股正确但卖早了"、"抄底成功"、"追高被套"

#### 8. 股息跟踪与收益率（Dividend Tracker）
**数据源**：`archive_change_in_dividend_accrual` + `archive_open_dividend_accrual`

- 股息日历（未来 30 天预计到账股息）
- 各标的股息收益率（年化股息 / 持仓市值）
- 股息收入时间线（月度/年度累计）
- 股息再投资 vs 现金提取比例

#### 9. 费用侵蚀仪表盘（Fee Erosion Dashboard）
**数据源**：`archive_unbundled_commission_detail` + `archive_trade`（`ib_commission`）

- 累计佣金占累计收益的比例（"我为赚钱付出了多少成本"）
- 按交易所/资产类别的费用分布
- 费用年化率（年化费用 / 平均 NAV）
- 与"零佣金券商"的潜在节省对比

#### 10. 持仓集中度与风险雷达（Concentration & Risk Radar）
**数据源**：`archive_open_position` + `archive_security_info`

- 个股集中度趋势（最大持仓占比随时间变化）
- 行业/地区集中度（若 `security_info` 中有行业数据）
- 风险雷达图：集中度、杠杆、外汇敞口、期权 Greek 敞口、单股最大回撤

---

### 🟡 优先级 P2：高级玩家功能

#### 11. 公司行动影响追踪（Corporate Action Impact）
**数据源**：`archive_corporate_action` + `archive_prior_period_position` + `cost_basis_history`

- 拆股/合并前后的持仓数量与成本基础变化对比
- 分红除权后股价与成本调整可视化

#### 12. 择时 vs 选股归因（Timing vs Stock Selection Attribution）
**数据源**：`archive_trade` + `daily_nav` + `archive_prior_period_position`

- **选股贡献**：如果我一直持有买入时的组合不变，收益是多少？
- **择时贡献**：实际收益 - 买入持有收益
- **调仓贡献**：加仓正确 vs 减仓过早的量化

#### 13. Wash Sale 检测与税务规划（Tax Optimization）
**数据源**：`archive_trade`

- 识别潜在 Wash Sale（卖出亏损后 30 天内重新买入同一标的）
- 年末未实现盈亏清单：建议"先卖亏的锁定亏损"（Tax Loss Harvesting）
- 长短期资本利得分布预测

#### 14. 期权策略透视（Options Strategy Lens）
**数据源**：`archive_open_position`（OPT）+ `archive_option_eae` + `archive_trade`（OPT）

- 当前期权持仓按策略分类：Covered Call、Cash-Secured Put、Spread、Naked
- 期权 Greek 汇总（Delta / Theta 敞口，若 XML 有提供）
- 期权到期日历（未来 30/60/90 天到期合约）
- 期权年化收益率（权利金收入 / 保证金占用）

---

## 三、按用户场景的建议落地顺序

### 场景 A：每天看盘前快速扫一眼
**建议优先做**：外汇敞口、期权到期日历、待收股息日历、借券收入

### 场景 B：月末复盘投资决策
**建议优先做**：历史持仓时间轴、最赚最亏交易、现金流瀑布、费用侵蚀

### 场景 C：年度税务与资产配置
**建议优先做**：Wash Sale 检测、长短期利得分布、持仓集中度雷达、择时选股归因

---

## 四、技术实现建议

1. **历史持仓时间轴**：`archive_prior_period_position` 数据量大（8,494 条），建议在后端预聚合每个 symbol 的"持仓生命周期"（首次日期、最后日期、峰值、交易记录），避免前端遍历全表。

2. **外汇敞口分解**：可在 `generate_dashboards.py` 里增加一个 `fxAttribution` 切片，计算每个币种持仓的"本位币等值市值"和"汇率贡献"。

3. **借券分析**：`archive_slb_open_contract` 和 `archive_slb_fee` 可以按 `symbol` 和 `date` join，预计算月度收入。

4. **订单执行质量**：`archive_order` 的数据目前似乎未进入 dashboard JSON，可以在 `details` slice 中新增 `orders` 和 `executionQuality` 两个块。

---

*本文档由 Kimi Code CLI 生成于 2026-04-11。*
