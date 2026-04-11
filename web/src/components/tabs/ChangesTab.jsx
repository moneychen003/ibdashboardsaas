import { useDashboardStore } from '../../stores/dashboardStore';
import { fmtCur, fmtNum } from '../../utils/format';

function Card({ title, children }) {
  return (
    <div className="rounded-xl border border-[var(--light-gray)] bg-white p-5">
      <div className="mb-4 text-lg font-semibold">{title}</div>
      {children}
    </div>
  );
}

function Badge({ children, tone }) {
  const toneClass =
    tone === 'good'
      ? 'bg-green-50 text-green-700 border-green-200'
      : tone === 'bad'
      ? 'bg-red-50 text-red-700 border-red-200'
      : tone === 'warn'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-gray-50 text-gray-700 border-gray-200';
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function Empty({ text = '暂无数据' }) {
  return <div className="py-8 text-center text-sm text-[var(--gray)]">{text}</div>;
}

export default function ChangesTab() {
  const data = useDashboardStore((s) => s.data);
  const baseCurrency = data?.baseCurrency || 'BASE';
  const displayCurrency = baseCurrency;

  if (!data) return <div className="py-10 text-center text-[var(--gray)]">暂无数据</div>;

  const posChanges = data.positionChanges || { latestDate: null, prevDate: null, changes: [] };
  const latestTrades = data.latestDayTrades || { tradeDate: null, trades: [] };
  const soldAnalysis = data.soldAnalysis || [];
  const costBasis = data.costBasisHoldings || [];
  const dailyPnL = data.dailyPnL || [];
  const recentPnL = dailyPnL.slice(-7).reverse();
  const recentPnLSum = recentPnL.reduce((sum, d) => sum + (d.pnl || 0), 0);

  return (
    <div className="space-y-6">
      {/* 持仓变动对比 */}
      <Card title={`📊 持仓变动对比 ${posChanges.latestDate && posChanges.prevDate ? `(${posChanges.latestDate} vs ${posChanges.prevDate})` : ''}`}>
        {posChanges.changes.length === 0 ? (
          <Empty text="近两日无持仓变动" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                  <th className="py-2">标的</th>
                  <th className="py-2">变动类型</th>
                  <th className="py-2 text-right">前日数量</th>
                  <th className="py-2 text-right">最新数量</th>
                  <th className="py-2 text-right">数量变动</th>
                  <th className="py-2 text-right">前日市值</th>
                  <th className="py-2 text-right">最新市值</th>
                  <th className="py-2 text-right">市值变动</th>
                </tr>
              </thead>
              <tbody>
                {posChanges.changes.map((c) => (
                  <tr key={c.symbol} className="border-b border-[var(--lighter-gray)]">
                    <td className="py-2">
                      <div className="font-medium">{c.symbol}</div>
                      <div className="text-xs text-[var(--gray)] truncate max-w-[200px]">{c.description}</div>
                    </td>
                    <td className="py-2">
                      <Badge
                        tone={
                          c.action === '新增'
                            ? 'good'
                            : c.action === '清仓'
                            ? 'bad'
                            : c.action === '增持'
                            ? 'good'
                            : 'warn'
                        }
                      >
                        {c.action}
                      </Badge>
                    </td>
                    <td className="py-2 text-right">{fmtNum(c.prevQty, 2)}</td>
                    <td className="py-2 text-right font-medium">{fmtNum(c.latestQty, 2)}</td>
                    <td className={`py-2 text-right font-medium ${c.qtyDiff > 0 ? 'text-green-600' : c.qtyDiff < 0 ? 'text-red-600' : ''}`}>
                      {c.qtyDiff > 0 ? '+' : ''}{fmtNum(c.qtyDiff, 2)}
                    </td>
                    <td className="py-2 text-right">{fmtCur(c.prevValue, displayCurrency)}</td>
                    <td className="py-2 text-right font-medium">{fmtCur(c.latestValue, displayCurrency)}</td>
                    <td className={`py-2 text-right font-semibold ${c.valueDiff > 0 ? 'text-green-600' : c.valueDiff < 0 ? 'text-red-600' : ''}`}>
                      {c.valueDiff > 0 ? '+' : ''}{fmtCur(c.valueDiff, displayCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 近7日盈亏 */}
      <Card title="📈 近7日盈亏">
        {recentPnL.length === 0 ? (
          <Empty text="暂无盈亏数据" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                  <th className="py-2">日期</th>
                  <th className="py-2 text-right">当日盈亏</th>
                </tr>
              </thead>
              <tbody>
                {recentPnL.map((d) => (
                  <tr key={d.date} className="border-b border-[var(--lighter-gray)]">
                    <td className="py-2">{d.date}</td>
                    <td className={`py-2 text-right font-medium ${d.pnl > 0 ? 'text-green-600' : d.pnl < 0 ? 'text-red-600' : ''}`}>
                      {d.pnl > 0 ? '+' : ''}{fmtCur(d.pnl, displayCurrency)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-50">
                  <td className="py-2 font-semibold">合计</td>
                  <td className={`py-2 text-right font-bold ${recentPnLSum > 0 ? 'text-green-600' : recentPnLSum < 0 ? 'text-red-600' : ''}`}>
                    {recentPnLSum > 0 ? '+' : ''}{fmtCur(recentPnLSum, displayCurrency)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 最新交易日操作 */}
      <Card title={`📝 最新交易日操作 ${latestTrades.tradeDate ? `(${latestTrades.tradeDate})` : ''}`}>
        {latestTrades.trades.length === 0 ? (
          <Empty text="最近无交易记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                  <th className="py-2">时间</th>
                  <th className="py-2">标的</th>
                  <th className="py-2">方向</th>
                  <th className="py-2 text-right">数量</th>
                  <th className="py-2 text-right">成交价</th>
                  <th className="py-2 text-right">金额</th>
                  <th className="py-2 text-right">MTM 盈亏</th>
                </tr>
              </thead>
              <tbody>
                {latestTrades.trades.map((t, idx) => (
                  <tr key={`${t.symbol}-${t.buySell}-${idx}`} className="border-b border-[var(--lighter-gray)]">
                    <td className="py-2">{t.tradeDate}</td>
                    <td className="py-2">
                      <div className="font-medium">{t.symbol}</div>
                      <div className="text-xs text-[var(--gray)] truncate max-w-[200px]">{t.description}</div>
                    </td>
                    <td className="py-2">
                      <Badge tone={t.buySell === 'BUY' ? 'good' : t.buySell === 'SELL' ? 'bad' : 'warn'}>
                        {t.buySell === 'BUY' ? '买入' : t.buySell === 'SELL' ? '卖出' : t.buySell}
                      </Badge>
                    </td>
                    <td className="py-2 text-right">{fmtNum(Math.abs(t.quantity), 2)}</td>
                    <td className="py-2 text-right">{fmtCur(t.tradePrice, t.currency)}</td>
                    <td className="py-2 text-right">{fmtCur(Math.abs(t.proceeds), t.currency)}</td>
                    <td className={`py-2 text-right font-medium ${(t.mtmPnl || 0) > 0 ? 'text-green-600' : (t.mtmPnl || 0) < 0 ? 'text-red-600' : ''}`}>
                      {t.mtmPnl > 0 ? '+' : ''}{fmtCur(t.mtmPnl, t.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 近期卖出盈亏分析 */}
      <Card title="💰 近期卖出盈亏分析（30天内）">
        {soldAnalysis.length === 0 ? (
          <Empty text="30天内无卖出记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                  <th className="py-2">卖出日期</th>
                  <th className="py-2">标的</th>
                  <th className="py-2 text-right">卖出股数</th>
                  <th className="py-2 text-right">卖出均价</th>
                  <th className="py-2 text-right">卖出总额</th>
                  <th className="py-2 text-right">移动加权成本</th>
                  <th className="py-2 text-right">移动加权盈亏</th>
                  <th className="py-2 text-right">摊薄成本</th>
                  <th className="py-2 text-right">摊薄盈亏</th>
                </tr>
              </thead>
              <tbody>
                {soldAnalysis.map((s) => (
                  <tr key={`${s.symbol}-${s.tradeDate}`} className="border-b border-[var(--lighter-gray)]">
                    <td className="py-2">{s.tradeDate}</td>
                    <td className="py-2">
                      <div className="font-medium">{s.symbol}</div>
                      <div className="text-xs text-[var(--gray)] truncate max-w-[180px]">{s.description}</div>
                    </td>
                    <td className="py-2 text-right">{fmtNum(s.soldQty, 2)}</td>
                    <td className="py-2 text-right">{fmtCur(s.avgSellPrice, s.currency)}</td>
                    <td className="py-2 text-right">{fmtCur(s.proceeds, s.currency)}</td>
                    <td className="py-2 text-right text-[var(--gray)]">{fmtCur(s.mwaCost, s.currency)}</td>
                    <td className={`py-2 text-right font-semibold ${s.mwaPnl > 0 ? 'text-green-600' : s.mwaPnl < 0 ? 'text-red-600' : ''}`}>
                      {s.mwaPnl > 0 ? '+' : ''}{fmtCur(s.mwaPnl, s.currency)}
                      <div className="text-xs font-normal text-[var(--gray)]">{fmtNum(s.mwaPct, 2)}%</div>
                    </td>
                    <td className="py-2 text-right text-[var(--gray)]">{fmtCur(s.dilutedCost, s.currency)}</td>
                    <td className={`py-2 text-right font-semibold ${s.dilutedPnl > 0 ? 'text-green-600' : s.dilutedPnl < 0 ? 'text-red-600' : ''}`}>
                      {s.dilutedPnl > 0 ? '+' : ''}{fmtCur(s.dilutedPnl, s.currency)}
                      <div className="text-xs font-normal text-[var(--gray)]">{fmtNum(s.dilutedPct, 2)}%</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 当前持仓成本分析 */}
      <Card title="📈 当前持仓成本与盈亏（移动加权 vs 摊薄成本）">
        {costBasis.length === 0 ? (
          <Empty text="暂无持仓成本数据" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                  <th className="py-2">标的</th>
                  <th className="py-2 text-right">当前数量</th>
                  <th className="py-2 text-right">当前市值</th>
                  <th className="py-2 text-right">市价</th>
                  <th className="py-2 text-right">移动加权成本价</th>
                  <th className="py-2 text-right">移动加权盈亏</th>
                  <th className="py-2 text-right">摊薄成本价</th>
                  <th className="py-2 text-right">摊薄盈亏</th>
                </tr>
              </thead>
              <tbody>
                {costBasis.map((c) => (
                  <tr key={c.symbol} className="border-b border-[var(--lighter-gray)]">
                    <td className="py-2">
                      <div className="font-medium">{c.symbol}</div>
                      <div className="text-xs text-[var(--gray)] truncate max-w-[180px]">{c.description}</div>
                    </td>
                    <td className="py-2 text-right">{fmtNum(c.currentQty, 2)}</td>
                    <td className="py-2 text-right font-medium">{fmtCur(c.currentValue, displayCurrency)}</td>
                    <td className="py-2 text-right">{fmtCur(c.markPrice, displayCurrency)}</td>
                    <td className="py-2 text-right text-[var(--gray)]">
                      {fmtCur(c.avgCostPrice, displayCurrency)}
                      <div className="text-xs">总 {fmtCur(c.avgCostBasis, displayCurrency)}</div>
                    </td>
                    <td className={`py-2 text-right font-semibold ${c.mwaPnl > 0 ? 'text-green-600' : c.mwaPnl < 0 ? 'text-red-600' : ''}`}>
                      {c.mwaPnl > 0 ? '+' : ''}{fmtCur(c.mwaPnl, displayCurrency)}
                      <div className="text-xs font-normal text-[var(--gray)]">{fmtNum(c.mwaPct, 2)}%</div>
                    </td>
                    <td className="py-2 text-right text-[var(--gray)]">
                      {fmtCur(c.dilutedCostPrice, displayCurrency)}
                      <div className="text-xs">总 {fmtCur(c.dilutedCostBasis, displayCurrency)}</div>
                    </td>
                    <td className={`py-2 text-right font-semibold ${c.dilutedPnl > 0 ? 'text-green-600' : c.dilutedPnl < 0 ? 'text-red-600' : ''}`}>
                      {c.dilutedPnl > 0 ? '+' : ''}{fmtCur(c.dilutedPnl, displayCurrency)}
                      <div className="text-xs font-normal text-[var(--gray)]">{fmtNum(c.dilutedPct, 2)}%</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
