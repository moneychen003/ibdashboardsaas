import ECharts from './ECharts';
import { fmtCur, fmtNum, fmtPct } from '../utils/format';

export default function FeeErosionPanel({ data }) {
  const fee = data?.feeErosion || {};
  const byMonth = fee.byMonth || [];

  const option = {
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, bottom: 30, top: 20 },
    xAxis: { type: 'category', data: byMonth.map((m) => m.month) },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => fmtCur(v, 0) } },
    series: [{ data: byMonth.map((m) => m.amount), type: 'bar', itemStyle: { color: '#f59e0b' } }],
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">费用侵蚀</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="总费用" value={fmtCur(fee.totalFees)} />
        <Stat label="已实现盈亏" value={fmtCur(fee.totalRealizedGain)} />
        <Stat label="费用/收益比" value={fmtPct(fee.feeToGainRatio)} />
        <Stat label="费用年化率" value={fmtPct(fee.annualizedFeeRate)} />
      </div>
      {byMonth.length > 0 && <ECharts option={option} style={{ height: 240 }} />}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded border border-[var(--light-gray)] p-2 text-center">
      <div className="text-xs text-[var(--gray)]">{label}</div>
      <div className="text-base font-bold">{value}</div>
    </div>
  );
}
