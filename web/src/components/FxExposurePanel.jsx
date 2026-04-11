import ECharts from './ECharts';
import { fmtCur, fmtNum, fmtPct } from '../utils/format';

export default function FxExposurePanel({ data }) {
  const fx = data?.fxExposure || {};
  const breakdown = fx.currencyBreakdown || [];
  const contribution = fx.fxContribution || {};

  const pieData = breakdown
    .filter((b) => b.totalExposure !== 0)
    .map((b) => ({ value: Math.abs(b.totalExposure), name: b.currency }));

  const option = {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { type: 'scroll', orient: 'vertical', right: 10, top: 20, bottom: 20 },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['35%', '50%'],
        data: pieData,
        label: { show: false },
      },
    ],
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">外汇敞口</div>
      <div className="grid gap-4 md:grid-cols-2">
        <ECharts option={option} style={{ height: 280 }} />
        <div className="space-y-3">
          <div className="rounded border border-[var(--light-gray)] p-3">
            <div className="text-xs text-[var(--gray)]">汇率影响估算</div>
            <div className="mt-1 text-lg font-bold">
              {contribution.fxImpact >= 0 ? '+' : ''}
              {fmtCur(contribution.fxImpact)}
            </div>
            <div className="text-xs text-[var(--gray)]">
              占中性 NAV 的 {fmtPct(contribution.impactPct)}
            </div>
          </div>
          <div className="max-h-[180px] overflow-auto rounded border border-[var(--light-gray)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-[var(--light-gray)] text-left text-[var(--gray)]">
                  <th className="px-2 py-1">币种</th>
                  <th className="px-2 py-1 text-right">持仓</th>
                  <th className="px-2 py-1 text-right">现金</th>
                  <th className="px-2 py-1 text-right">占比</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((b, i) => (
                  <tr key={i} className="border-b border-[var(--lighter-gray)]">
                    <td className="px-2 py-1">{b.currency}</td>
                    <td className="px-2 py-1 text-right">{fmtCur(b.positionValue, 0)}</td>
                    <td className="px-2 py-1 text-right">{fmtCur(b.cashValue, 0)}</td>
                    <td className="px-2 py-1 text-right">{fmtPct(b.pctOfNav)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
