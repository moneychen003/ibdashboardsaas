import ECharts from './ECharts';
import { useEquitySeries } from '../hooks/useEquitySeries';
import { fmtCur } from '../utils/format';

export default function DailyPLChart({ data, range }) {
  const series = useEquitySeries(data, range);
  if (!series.length) return null;
  const labels = series.map((s) => s.date.toISOString().slice(0, 10));
  const pls = series.map((s) => s.dailyPL || 0);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => ` ${params[0].axisValue}<br/>${params[0].marker} 每日盈亏: ${fmtCur(params[0].value)}`,
    },
    grid: { left: '3%', right: '4%', bottom: '60', top: '3%', containLabel: true },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        start: 0,
        end: 100,
        zoomOnMouseWheel: true,
        moveOnMouseWheel: true,
        moveOnMouseMove: true,
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        start: 0,
        end: 100,
        height: 24,
        bottom: 10,
        handleSize: '80%',
        showDetail: false,
        borderColor: 'transparent',
        backgroundColor: '#f5f5f5',
        fillerColor: 'rgba(0,0,0,0.08)',
        handleStyle: {
          color: '#999',
          borderColor: '#999',
        },
      },
    ],
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
      axisLabel: { formatter: (v) => fmtCur(v), color: '#666' },
      splitLine: { lineStyle: { color: '#f0f0f0' } },
    },
    series: [
      {
        type: 'bar',
        data: pls.map((v) => ({
          value: v,
          itemStyle: {
            color: v >= 0 ? '#00c853' : '#ff3d00',
            borderRadius: v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
          },
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
