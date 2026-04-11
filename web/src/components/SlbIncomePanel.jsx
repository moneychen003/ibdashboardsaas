import ECharts from './ECharts';
import { fmtCur, fmtNum } from '../utils/format';

export default function SlbIncomePanel({ data }) {
  const slb = data?.slbIncome || {};
  const monthly = slb.monthlyIncome || [];
  const current = slb.currentContracts || [];

  const option = {
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, bottom: 30, top: 20 },
    xAxis: { type: 'category', data: monthly.map((m) => m.month) },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => fmtCur(v, 0) } },
    series: [{ data: monthly.map((m) => m.income), type: 'bar', itemStyle: { color: '#8b5cf6' } }],
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">借券收益</div>
      <div className="flex items-center gap-4">
        <div className="rounded border border-[var(--light-gray)] px-4 py-2">
          <div className="text-xs text-[var(--gray)]">累计借券收入</div>
          <div className="text-xl font-bold">{fmtCur(slb.totalIncome)}</div>
        </div>
        <div className="text-xs text-[var(--gray)]">
          当前借出合约: {current.length} 个标的
        </div>
      </div>
      {monthly.length > 0 && <ECharts option={option} style={{ height: 220 }} />}
      {current.length > 0 && (
        <div className="max-h-[160px] overflow-auto rounded border border-[var(--light-gray)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[var(--light-gray)] text-left text-[var(--gray)]">
                <th className="px-2 py-1">标的</th>
                <th className="px-2 py-1 text-right">数量</th>
                <th className="px-2 py-1 text-right">费率</th>
                <th className="px-2 py-1 text-right">预估日收</th>
              </tr>
            </thead>
            <tbody>
              {current.map((c, i) => (
                <tr key={i} className="border-b border-[var(--lighter-gray)]">
                  <td className="px-2 py-1">{c.symbol}</td>
                  <td className="px-2 py-1 text-right">{fmtNum(c.quantity, 0)}</td>
                  <td className="px-2 py-1 text-right">{fmtNum(c.feeRate, 4)}%</td>
                  <td className="px-2 py-1 text-right">{fmtCur(c.estimatedDailyIncome)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
