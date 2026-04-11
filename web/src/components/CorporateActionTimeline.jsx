import { fmtNum } from '../utils/format';

export default function CorporateActionTimeline({ data }) {
  const events = data?.corporateActionImpact?.events || [];
  if (!events.length) return <div className="text-sm text-[var(--gray)]">暂无公司行动记录</div>;

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">公司行动</div>
      <div className="space-y-2">
        {events.map((e, i) => (
          <div key={i} className="flex items-start gap-3 rounded border border-[var(--light-gray)] p-2 text-sm">
            <div className="w-20 shrink-0 text-xs text-[var(--gray)]">{e.date}</div>
            <div className="flex-1">
              <div className="font-medium">{e.symbol}</div>
              <div className="text-xs text-[var(--gray)]">{e.action}</div>
            </div>
            <div className="text-right text-xs">
              {e.amount != null && <div>影响: {fmtNum(e.amount)}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
