import { fmtCur, fmtNum, fmtDate } from '../utils/format';

export default function TradeRankings({ data }) {
  const rankings = data?.tradeRankings || {};
  const profits = rankings.topProfits || [];
  const losses = rankings.topLosses || [];
  const bySymbol = rankings.bySymbol || [];

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">交易盈亏榜</div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border border-green-200 bg-green-50 p-3">
          <div className="mb-2 text-xs font-semibold text-green-700">Top 盈利交易</div>
          <div className="max-h-[200px] overflow-auto space-y-2">
            {profits.slice(0, 5).map((t, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span>
                  {t.symbol} · {t.date}
                </span>
                <span className="font-medium text-green-700">+{fmtCur(t.pnl)}</span>
              </div>
            ))}
            {!profits.length && <div className="text-xs text-[var(--gray)]">暂无数据</div>}
          </div>
        </div>
        <div className="rounded border border-red-200 bg-red-50 p-3">
          <div className="mb-2 text-xs font-semibold text-red-700">Top 亏损交易</div>
          <div className="max-h-[200px] overflow-auto space-y-2">
            {losses.slice(0, 5).map((t, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span>
                  {t.symbol} · {t.date}
                </span>
                <span className="font-medium text-red-700">{fmtCur(t.pnl)}</span>
              </div>
            ))}
            {!losses.length && <div className="text-xs text-[var(--gray)]">暂无数据</div>}
          </div>
        </div>
      </div>

      <div className="rounded border border-[var(--light-gray)] p-3">
        <div className="mb-2 text-xs font-semibold">标的累计盈亏</div>
        <div className="max-h-[160px] overflow-auto space-y-1">
          {bySymbol.slice(0, 10).map((s, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span>{s.symbol}</span>
              <span className={s.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                {s.totalPnl >= 0 ? '+' : ''}
                {fmtCur(s.totalPnl)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
