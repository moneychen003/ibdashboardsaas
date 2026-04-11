import { fmtCur, fmtPct } from '../utils/format';

export default function DividendTracker({ data }) {
  const dt = data?.dividendTracker || {};
  const upcoming = dt.upcoming || [];
  const yields = dt.yieldBySymbol || [];
  const monthly = dt.monthlyIncome || [];

  const totalAnnual = yields.reduce((s, y) => s + (y.annualDividend || 0), 0);

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">股息跟踪</div>
      <div className="flex items-center gap-4">
        <div className="rounded border border-[var(--light-gray)] px-4 py-2">
          <div className="text-xs text-[var(--gray)]">预估年化股息</div>
          <div className="text-xl font-bold">{fmtCur(totalAnnual)}</div>
        </div>
        <div className="text-xs text-[var(--gray)]">
          历史月份数: {monthly.length}
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="rounded border border-[var(--light-gray)] p-3">
          <div className="mb-2 text-xs font-semibold">即将到账股息</div>
          <div className="max-h-[160px] overflow-auto space-y-1">
            {upcoming.slice(0, 10).map((u, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span>
                  {u.symbol} · 除息 {u.exDate} · 派息 {u.payDate}
                </span>
                <span className="font-medium">{fmtCur(u.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {yields.length > 0 && (
        <div className="rounded border border-[var(--light-gray)] p-3">
          <div className="mb-2 text-xs font-semibold">持仓股息收益率</div>
          <div className="max-h-[160px] overflow-auto space-y-1">
            {yields.map((y, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span>{y.symbol}</span>
                <span className="text-[var(--gray)]">
                  年化 {fmtCur(y.annualDividend)} · 收益率 {fmtPct(y.yieldPct)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
