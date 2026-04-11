import ECharts from './ECharts';
import { fmtCur } from '../utils/format';

export default function EnhancedCashflowPanel({ data }) {
  const cf = data?.enhancedCashflow || {};
  const waterfall = cf.monthlyWaterfall || [];

  if (!waterfall.length) return <div className="text-sm text-[var(--gray)]">暂无现金流瀑布数据</div>;

  const months = waterfall.map((w) => w.month);
  const deposits = waterfall.map((w) => w.deposits);
  const withdrawals = waterfall.map((w) => -w.withdrawals);
  const sales = waterfall.map((w) => w.sales);
  const purchases = waterfall.map((w) => -w.purchases);
  const dividends = waterfall.map((w) => w.dividends);
  const slb = waterfall.map((w) => w.slbIncome);
  const fees = waterfall.map((w) => -(w.commissions + w.fees));

  const option = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['入金', '出金', '卖出', '买入', '股息', '借券', '费用'], bottom: 0 },
    grid: { left: 50, right: 20, bottom: 50, top: 20 },
    xAxis: { type: 'category', data: months },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => fmtCur(v, 0) } },
    series: [
      { name: '入金', type: 'bar', stack: 'total', data: deposits, itemStyle: { color: '#10b981' } },
      { name: '出金', type: 'bar', stack: 'total', data: withdrawals, itemStyle: { color: '#ef4444' } },
      { name: '卖出', type: 'bar', stack: 'total', data: sales, itemStyle: { color: '#3b82f6' } },
      { name: '买入', type: 'bar', stack: 'total', data: purchases, itemStyle: { color: '#f59e0b' } },
      { name: '股息', type: 'bar', stack: 'total', data: dividends, itemStyle: { color: '#8b5cf6' } },
      { name: '借券', type: 'bar', stack: 'total', data: slb, itemStyle: { color: '#ec4899' } },
      { name: '费用', type: 'bar', stack: 'total', data: fees, itemStyle: { color: '#6b7280' } },
    ],
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">现金流瀑布（月度）</div>
      <ECharts option={option} style={{ height: 300 }} />
    </div>
  );
}
