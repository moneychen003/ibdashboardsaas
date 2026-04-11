import { fmtPct } from '../utils/format';

export default function TimingAttribution({ data }) {
  const ta = data?.timingAttribution || {};

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">择时 vs 选股归因</div>
      <div className="grid grid-cols-3 gap-3">
        <Card label="买入持有收益" value={fmtPct(ta.buyAndHoldReturn)} desc="不调仓的收益" />
        <Card label="实际收益" value={fmtPct(ta.actualReturn)} desc="包含所有调仓" />
        <Card label="择时贡献" value={fmtPct(ta.timingContribution)} desc="实际 - 买入持有" highlight />
      </div>
    </div>
  );
}

function Card({ label, value, desc, highlight }) {
  return (
    <div className={`rounded border p-3 text-center ${highlight ? 'border-blue-200 bg-blue-50' : 'border-[var(--light-gray)]'}`}>
      <div className="text-xs text-[var(--gray)]">{label}</div>
      <div className={`my-1 text-xl font-bold ${highlight ? 'text-blue-700' : ''}`}>{value}</div>
      <div className="text-[10px] text-[var(--gray)]">{desc}</div>
    </div>
  );
}
