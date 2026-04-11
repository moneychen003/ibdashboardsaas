import ECharts from './ECharts';
import { fmtCur } from '../utils/format';

export default function PnlCompositionChart({ assetStats }) {
  if (!assetStats.length) return <p className="text-sm text-[var(--gray)]">暂无盈亏构成数据</p>;
  const map = { STK: '股票', OPT: '期权', BOND: '债券', BILL: '短期票据', FUND: '基金', OTHER: '其他' };
  const labels = assetStats.map((a) => map[a.category] || a.category);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        let html = `${params[0].name}<br/>`;
        params.forEach((p) => {
          html += `${p.marker} ${p.seriesName}: ${fmtCur(p.value)}<br/>`;
        });
        return html;
      },
    },
    legend: { top: 0, itemWidth: 10, textStyle: { fontSize: 11, color: '#666' } },
    grid: { left: '3%', right: '4%', bottom: '3%', top: 24, containLabel: true },
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
        name: '盈利',
        type: 'bar',
        data: assetStats.map((a) => Number(a.profit) || 0),
        itemStyle: { color: '#00c853', borderRadius: [4, 4, 0, 0] },
      },
      {
        name: '亏损',
        type: 'bar',
        data: assetStats.map((a) => -(Number(a.loss) || 0)),
        itemStyle: { color: '#ff3d00', borderRadius: [4, 4, 0, 0] },
      },
    ],
  };

  return (
    <div className="chart-container" style={{ height: 220 }}>
      <ECharts option={option} style={{ height: 220 }} />
    </div>
  );
}
