import ECharts from './ECharts';

export default function TradingHeatmap({ data }) {
  const heatmap = data?.tradingHeatmap || { byDayHour: [] };
  const flat = heatmap.byDayHour || [];

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}`);

  const matrix = days.map((day) =>
    hours.map((hr) => {
      const cell = flat.find((f) => f.dayOfWeek === day && f.hour === hr);
      return cell ? cell.tradeCount : 0;
    })
  );

  const seriesData = [];
  matrix.forEach((row, dayIndex) => {
    row.forEach((val, hourIndex) => {
      seriesData.push([hourIndex, dayIndex, val]);
    });
  });

  const option = {
    tooltip: {
      position: 'top',
      formatter: (p) => `${days[p.value[1]]} ${hours[p.value[0]]}:00<br/>交易次数: ${p.value[2]}`,
    },
    grid: { top: 10, bottom: 40, left: 50, right: 10 },
    xAxis: { type: 'category', data: hours, splitArea: { show: true }, name: '小时' },
    yAxis: { type: 'category', data: days, splitArea: { show: true } },
    visualMap: { min: 0, max: Math.max(1, ...seriesData.map((d) => d[2])), calculable: true, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['#f0f9ff', '#0ea5e9', '#0c4a6e'] } },
    series: [{ name: '交易次数', type: 'heatmap', data: seriesData, label: { show: false }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } } }],
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">交易行为热力图</div>
      <ECharts option={option} style={{ height: 300 }} />
    </div>
  );
}
