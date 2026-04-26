import { fmtNum } from '../utils/format';

export default function CorporateActionTimeline({ data }) {
  const events = data?.corporateActionImpact?.events || [];
  if (!events.length) return <div className="text-sm text-[var(--gray)]">暂无公司行动记录</div>;

  return (
    <div className="space-y-2">
      {events.map((e, i) => (
        <div
          key={i}
          className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-start gap-4 rounded border border-[var(--light-gray)] p-3 text-sm"
        >
          <div className="font-mono text-xs text-[var(--gray)] whitespace-nowrap overflow-hidden text-ellipsis" title={e.date}>
            {e.date}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate" title={e.symbol}>{e.symbol}</div>
            <div className="text-xs text-[var(--gray)] line-clamp-2 break-all">{e.action}</div>
          </div>
          <div className="text-right text-xs whitespace-nowrap text-[var(--gray)]">
            {e.amount != null ? <>影响: {fmtNum(e.amount)}</> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
