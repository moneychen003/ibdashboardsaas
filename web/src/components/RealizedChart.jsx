import ECharts from './ECharts';
import { fmtCur } from '../utils/format';

export default function RealizedChart({ data }) {
  const nav = data.changeInNav || {};
  const labels = ['已实现盈亏', '未实现变动', 'MTM 本期', '股息', '利息'];
  const vals = [nav.realized || 0, nav.changeInUnrealized || 0, nav.mtm || 0, nav.dividends || 0, nav.interest || 0];
  const colors = ['#000000', '#666666', '#333333', '#00c853', '#2196f3'];

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => ` ${params[0].name}<br/>${params[0].marker} 金额: ${fmtCur(params[0].value)}`,
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
      axisLabel: { formatter: (v) => fmtCur(Math.abs(v)), color: '#666' },
      splitLine: { lineStyle: { color: '#f0f0f0' } },
    },
    series: [
      {
        type: 'bar',
        data: vals.map((v, i) => ({
          value: v,
          itemStyle: { color: colors[i], borderRadius: [6, 6, 0, 0] },
        })),
      },
    ],
  };

  return (
    <div className="chart-container">
      <ECharts option={option} />
    </div>
  );
}
