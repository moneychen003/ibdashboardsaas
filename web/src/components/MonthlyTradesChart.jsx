import ECharts from './ECharts';
import { fmtNum } from '../utils/format';

export default function MonthlyTradesChart({ stats }) {
  if (!stats.length) return null;
  const labels = stats.map((s) => s.month || '');
  const counts = stats.map((s) => s.tradeCount || 0);
  const totalTrades = counts.reduce((a, b) => a + b, 0);
  const totalTurnover = stats.reduce((s, m) => s + (m.turnover || 0), 0);
  const avgTrades = stats.length ? (totalTrades / stats.length).toFixed(1) : '0';

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => ` ${params[0].axisValue}<br/>${params[0].marker} 交易笔数: ${fmtNum(params[0].value, 0)}`,
    },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#666' },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v) => fmtNum(v, 0), color: '#666' },
      splitLine: { lineStyle: { color: '#f0f0f0' } },
    },
    series: [
      {
        type: 'bar',
        data: counts,
        itemStyle: { color: '#000', borderRadius: [4, 4, 0, 0] },
      },
    ],
  };

  return (
    <div>
      <div className="chart-container">
        <ECharts option={option} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-[var(--light-gray)] p-3">
          <div className="text-xs text-[var(--gray)]">总交易笔数</div>
          <div className="text-lg font-bold">{fmtNum(totalTrades, 0)}</div>
        </div>
        <div className="rounded-lg border border-[var(--light-gray)] p-3">
          <div className="text-xs text-[var(--gray)]">总成交额</div>
          <div className="text-lg font-bold">{fmtNum(totalTurnover, 0)}</div>
        </div>
        <div className="rounded-lg border border-[var(--light-gray)] p-3">
          <div className="text-xs text-[var(--gray)]">月均交易</div>
          <div className="text-lg font-bold">{avgTrades}</div>
        </div>
      </div>
    </div>
  );
}
