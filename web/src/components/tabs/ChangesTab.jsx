import { useState } from 'react';
import { useDashboardStore } from '../../stores/dashboardStore';
import { fmtCur, fmtNum } from '../../utils/format';

function tradeKindTag(t) {
  const codes = (t.notes || '').split(';').map((c) => c.trim());
  if (codes.includes('A')) return { label: '指派', cls: 'bg-amber-100 text-amber-700' };
  if (codes.includes('Ep')) return { label: '到期', cls: 'bg-slate-100 text-slate-600' };
  if (codes.includes('Ex')) return { label: '行权', cls: 'bg-amber-100 text-amber-700' };
  if (t.openCloseIndicator === 'O') return { label: '开仓', cls: 'bg-blue-100 text-blue-700' };
  if (t.openCloseIndicator === 'C') return { label: '平仓', cls: 'bg-slate-100 text-slate-600' };
  return null;
}

function OcTag({ trade }) {
  const tag = tradeKindTag(trade);
  if (!tag) return null;
  return (
    <span className={`ml-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${tag.cls}`}>
      {tag.label}
    </span>
  );
}

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

function OptionEaeHistory({ data }) {
  const [page, setPage] = useState(1);
  const rows = data || [];
  if (!rows.length) return <Empty text="暂无期权行权/到期记录" />;

  const PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const currentRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const typeMap = {
    Assignment: { label: '被指派', emoji: '🔴', tone: 'bad' },
    Exercise:   { label: '主动行权', emoji: '🔵', tone: 'warn' },
    Expiration: { label: '到期归零', emoji: '⚪', tone: 'default' },
  };

  const summary = rows.reduce((acc, r) => {
    const t = r.transactionType || 'Other';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  const totalPnl = rows.reduce((s, r) => s + (Number(r.mtmPnl) || 0), 0);

  const fmtExp = (e) => {
    if (!e) return '-';
    const s = String(e);
    if (s.length === 8 && /^\d+$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    return s;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-[var(--gray)]">
        <span>共 {rows.length} 条</span>
        {Object.entries(summary).map(([t, n]) => {
          const m = typeMap[t] || { label: t, emoji: '•' };
          return <span key={t}>{m.emoji} {m.label} {n}</span>;
        })}
        <span className="ml-auto">
          累计 MTM 盈亏:
          <span className={`ml-1 font-semibold ${totalPnl >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
            {(totalPnl >= 0 ? '+' : '')}{fmtNum(totalPnl, 2)}
          </span>
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--light-gray)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
              <th className="py-2 pl-3">日期</th>
              <th className="py-2">标的</th>
              <th className="py-2">合约</th>
              <th className="py-2">类型</th>
              <th className="py-2 text-right">张数</th>
              <th className="py-2 pr-3 text-right">MTM 盈亏</th>
            </tr>
          </thead>
          <tbody>
            {currentRows.map((r, i) => {
              const t = typeMap[r.transactionType] || { label: r.transactionType || '-', emoji: '•', tone: 'default' };
              const pc = r.putCall === 'P' ? 'Put' : r.putCall === 'C' ? 'Call' : (r.putCall || '');
              const pnl = Number(r.mtmPnl || 0);
              const qty = Math.abs(Number(r.quantity || 0));
              const strike = r.strike != null ? r.strike : '';
              return (
                <tr key={i} className="border-b border-[var(--lighter-gray)]">
                  <td className="py-2 pl-3">{r.date || '-'}</td>
                  <td className="py-2 font-medium">{r.underlyingSymbol || r.symbol || '-'}</td>
                  <td className="py-2 text-[var(--gray)]">{pc} {strike} / {fmtExp(r.expiry)}</td>
                  <td className="py-2"><Badge tone={t.tone}>{t.emoji} {t.label}</Badge></td>
                  <td className="py-2 text-right">{fmtNum(qty, 0)}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${pnl > 0 ? 'text-[var(--success)]' : pnl < 0 ? 'text-[var(--danger)]' : ''}`}>
                    {pnl !== 0 ? fmtCur(pnl, r.currency || 'USD') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="rounded border border-[var(--light-gray)] px-3 py-1 text-xs font-medium disabled:opacity-40 hover:border-black"
          >
            上一页
          </button>
          <span className="text-xs text-[var(--gray)]">
            第 {safePage} / {totalPages} 页
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="rounded border border-[var(--light-gray)] px-3 py-1 text-xs font-medium disabled:opacity-40 hover:border-black"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
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
  const hasFlex = recentPnL.some((d) => d.pnlFlex != null);
  const recentFlexSum = hasFlex ? recentPnL.reduce((sum, d) => sum + (d.pnlFlex || 0), 0) : null;

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
                  <th className="py-2 text-right" title="NAV 差扣净流入（含 FX translation）">当日盈亏</th>
                  <th className="py-2 text-right" title="daily_nav 五列：mtm + realized + 股息 + 利息 + 佣金">Flex 口径</th>
                  <th className="py-2 text-right" title="当日 - Flex（未实现变动 + FX 等）">差额</th>
                </tr>
              </thead>
              <tbody>
                {recentPnL.map((d) => {
                  const flex = d.pnlFlex;
                  const diff = flex != null ? (d.pnl - flex) : null;
                  return (
                    <tr key={d.date} className="border-b border-[var(--lighter-gray)]">
                      <td className="py-2">{d.date}</td>
                      <td className={`py-2 text-right font-medium ${d.pnl > 0 ? 'text-green-600' : d.pnl < 0 ? 'text-red-600' : ''}`}>
                        {d.pnl > 0 ? '+' : ''}{fmtCur(d.pnl, displayCurrency)}
                      </td>
                      <td className={`py-2 text-right ${flex != null ? (flex > 0 ? 'text-green-600' : flex < 0 ? 'text-red-600' : '') : 'text-[var(--gray)]'}`}>
                        {flex != null ? ((flex > 0 ? '+' : '') + fmtCur(flex, displayCurrency)) : '—'}
                      </td>
                      <td className={`py-2 text-right text-xs ${diff != null ? (diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : '') : 'text-[var(--gray)]'}`}>
                        {diff != null ? ((diff > 0 ? '+' : '') + fmtCur(diff, displayCurrency)) : '—'}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-50">
                  <td className="py-2 font-semibold">合计</td>
                  <td className={`py-2 text-right font-bold ${recentPnLSum > 0 ? 'text-green-600' : recentPnLSum < 0 ? 'text-red-600' : ''}`}>
                    {recentPnLSum > 0 ? '+' : ''}{fmtCur(recentPnLSum, displayCurrency)}
                  </td>
                  <td className={`py-2 text-right font-bold ${recentFlexSum > 0 ? 'text-green-600' : recentFlexSum < 0 ? 'text-red-600' : ''}`}>
                    {recentFlexSum != null ? ((recentFlexSum > 0 ? '+' : '') + fmtCur(recentFlexSum, displayCurrency)) : '—'}
                  </td>
                  <td className="py-2 text-right text-xs text-[var(--gray)]">
                    {recentFlexSum != null ? ((recentPnLSum - recentFlexSum > 0 ? '+' : '') + fmtCur(recentPnLSum - recentFlexSum, displayCurrency)) : '—'}
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
                    <td className="py-2 whitespace-nowrap">
                      <Badge tone={t.buySell === 'BUY' ? 'good' : t.buySell === 'SELL' ? 'bad' : 'warn'}>
                        {t.buySell === 'BUY' ? '买入' : t.buySell === 'SELL' ? '卖出' : t.buySell}
                      </Badge>
                      <OcTag trade={t} />
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

      {/* 期权行权 / 到期历史 */}
      <Card title="🎯 期权行权 / 到期历史">
        <OptionEaeHistory data={data.optionEAE || []} />
      </Card>
    </div>
  );
}
