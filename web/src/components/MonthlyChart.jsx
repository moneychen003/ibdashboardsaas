import ECharts from './ECharts';
import { fmtCur } from '../utils/format';
import { useDashboardStore } from '../stores/dashboardStore';

function getCutoffDate(range, customStart) {
  if (range === 'custom' && customStart) {
    const [y, m] = customStart.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }
  const now = new Date();
  if (range === 'nav1Week') {
    const d = new Date(now);
    d.setDate(now.getDate() - 7);
    return d;
  }
  if (range === 'navMTD') {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (range === 'nav1Month') {
    const d = new Date(now);
    d.setDate(now.getDate() - 30);
    return d;
  }
  if (range === 'nav3Months') {
    const d = new Date(now);
    d.setDate(now.getDate() - 90);
    return d;
  }
  if (range === 'nav1Year') {
    const d = new Date(now);
    d.setFullYear(now.getFullYear() - 1);
    return d;
  }
  if (range === 'navYTD') {
    return new Date(now.getFullYear(), 0, 1);
  }
  return null;
}

export default function MonthlyChart({ data, range }) {
  const customNavStart = useDashboardStore((s) => s.customNavStart);
  const customNavEnd = useDashboardStore((s) => s.customNavEnd);
  if (!data?.monthlyRealGains?.length) return null;

  const cutoff = getCutoffDate(range, customNavStart);
  const cutoffMonth = cutoff ? `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}` : null;
  const endMonth = customNavEnd ? `${customNavEnd.split('-')[0]}-${customNavEnd.split('-')[1]}` : null;

  const filtered = data.monthlyRealGains.filter((m) => {
    if (cutoffMonth && m.month < cutoffMonth) return false;
    if (endMonth && m.month > endMonth) return false;
    return true;
  });

  if (!filtered.length) return null;

  const labels = filtered.map((m) => {
    const [y, mon] = m.month.split('-');
    return `${y}年${Number(mon)}月`;
  });
  const vals = filtered.map((m) => m.gain);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => ` ${params[0].axisValue}<br/>${params[0].marker} 月度收益: ${fmtCur(params[0].value)}`,
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
        data: vals.map((v) => ({
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
