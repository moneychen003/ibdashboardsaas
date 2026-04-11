import { fmtCur, fmtNum, fmtPct } from '../utils/format';

export default function OptionsStrategyLens({ data }) {
  const lens = data?.optionsStrategyLens || {};
  const strategies = lens.currentStrategies || [];
  const expiryCalendar = lens.expiryCalendar || [];
  const upcomingEAE = lens.upcomingEAE || [];

  if (!strategies.length && !expiryCalendar.length) {
    return <div className="text-sm text-[var(--gray)]">当前无期权持仓</div>;
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">期权策略透视</div>

      <div className="grid gap-3 md:grid-cols-2">
        {strategies.map((s, i) => (
          <div key={i} className="rounded border border-[var(--light-gray)] p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{s.symbol}</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{s.strategy}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--gray)]">
              <div>标的: {s.underlying}</div>
              <div>方向: {s.putCall}</div>
              <div>行权价: {fmtNum(s.strike)}</div>
              <div>到期: {s.expiry} ({s.daysToExpiry}天)</div>
              <div>数量: {fmtNum(s.quantity)}</div>
              <div>市值: {fmtCur(s.positionValue)}</div>
              {s.annualizedYield != null && <div className="col-span-2">年化收益: {fmtPct(s.annualizedYield)}</div>}
            </div>
          </div>
        ))}
      </div>

      {expiryCalendar.length > 0 && (
        <div className="rounded border border-[var(--light-gray)] p-3">
          <div className="mb-2 text-xs font-semibold">期权到期日历</div>
          <div className="flex flex-wrap gap-2">
            {expiryCalendar.map((e, i) => (
              <div key={i} className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">
                {e.date} ({e.count}张)
              </div>
            ))}
          </div>
        </div>
      )}

      {upcomingEAE.length > 0 && (
        <div className="rounded border border-[var(--light-gray)] p-3">
          <div className="mb-2 text-xs font-semibold text-orange-600">即将发生的期权事件 (EAE)</div>
          <div className="space-y-1">
            {upcomingEAE.slice(0, 5).map((e, i) => (
              <div key={i} className="text-xs">
                {e.date} · {e.symbol} · {e.type} · 数量 {fmtNum(e.quantity)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
