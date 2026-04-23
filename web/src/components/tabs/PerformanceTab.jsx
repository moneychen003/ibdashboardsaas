import { useMemo, useState } from 'react';
import { useDashboardStore } from '../../stores/dashboardStore';
import { useEquitySeries } from '../../hooks/useEquitySeries';
import { fmtCur, fmtNum, fmtPct, fmtDate, parseDate } from '../../utils/format';
import DailyPLChart from '../DailyPLChart';
import MonthlyChart from '../MonthlyChart';
import RealizedChart from '../RealizedChart';
import PnlCompositionChart from '../PnlCompositionChart';
import MonthlyTradesChart from '../MonthlyTradesChart';
import ECharts from '../ECharts';
import TradingHeatmap from '../TradingHeatmap';
import TradeRankings from '../TradeRankings';
import FeeErosionPanel from '../FeeErosionPanel';
import TimingAttribution from '../TimingAttribution';

function Card({ title, children }) {
  return (
    <div className="rounded-xl border border-[var(--light-gray)] p-6">
      {title && <div className="mb-4 text-lg font-semibold">{title}</div>}
      {children}
    </div>
  );
}

function Stat({ label, value, colorClass = '' }) {
  return (
    <div className="rounded-xl border border-[var(--light-gray)] p-4">
      <div className="mb-1 text-xs text-[var(--gray)]">{label}</div>
      <div className={`text-xl font-bold ${colorClass}`}>{value}</div>
    </div>
  );
}

function usePnlAnalysis(data) {
  return useMemo(() => {
    const trades = data?.trades || [];
    const holdings = {};
    const closing = [];
    const sorted = [...trades].sort((a, b) => parseDate(a.date || a.tradeDate) - parseDate(b.date || b.tradeDate));
    sorted.forEach((t) => {
      const qty = Number(t.quantity) || 0;
      const mtm = Number(t.mtmPnl) || 0;
      const sym = t.symbol || 'OTHER';
      if (qty === 0) return;
      const pos = holdings[sym] || 0;
      const isClosing = pos !== 0 && (qty > 0) !== (pos > 0);
      if (isClosing) {
        const closedQty = Math.min(Math.abs(qty), Math.abs(pos));
        const closingMtm = qty !== 0 ? mtm * (closedQty / Math.abs(qty)) : 0;
        closing.push(closingMtm);
      }
      holdings[sym] = pos + qty;
    });

    const totalPnl = closing.reduce((s, v) => s + v, 0);
    const profitCount = closing.filter((v) => v > 0).length;
    const lossCount = closing.filter((v) => v < 0).length;
    const totalCount = closing.length;
    const avgProfit = profitCount ? closing.filter((v) => v > 0).reduce((s, v) => s + v, 0) / profitCount : 0;
    const avgLoss = lossCount ? closing.filter((v) => v < 0).reduce((s, v) => s + v, 0) / lossCount : 0;
    const plRatio = avgLoss !== 0 ? Math.abs(avgProfit / avgLoss) : avgProfit > 0 ? 999 : 0;

    const assetMap = {};
    const holdings2 = {};
    sorted.forEach((t) => {
      const qty = Number(t.quantity) || 0;
      const mtm = Number(t.mtmPnl) || 0;
      const sym = t.symbol || 'OTHER';
      const cat = (t.assetCategory || 'OTHER').toUpperCase();
      if (qty === 0) return;
      const pos = holdings2[sym] || 0;
      const isClosing = pos !== 0 && (qty > 0) !== (pos > 0);
      if (isClosing) {
        const closedQty = Math.min(Math.abs(qty), Math.abs(pos));
        const closingMtm = qty !== 0 ? mtm * (closedQty / Math.abs(qty)) : 0;
        if (!assetMap[cat]) assetMap[cat] = { profit: 0, loss: 0 };
        if (closingMtm > 0) assetMap[cat].profit += closingMtm;
        else if (closingMtm < 0) assetMap[cat].loss += Math.abs(closingMtm);
      }
      holdings2[sym] = pos + qty;
    });
    const assetStats = Object.entries(assetMap).map(([cat, v]) => ({
      category: cat,
      profit: Math.round(v.profit * 100) / 100,
      loss: Math.abs(Math.round(v.loss * 100) / 100),
      total: Math.round((v.profit + v.loss) * 100) / 100,
    }));

    return { totalPnl, profitCount, lossCount, totalCount, avgProfit, avgLoss, plRatio, assetStats };
  }, [data?.trades]);
}

function usePnlRanking(data) {
  return useMemo(() => {
    const analysis = data?.tradePnLAnalysis || {};
    let symbolStats = [...(analysis.symbolStats || [])];
    if ((data?.trades || []).length) {
      const trades = data.trades;
      const holdings = {};
      const symMap = {};
      const sorted = [...trades].sort((a, b) => parseDate(a.date || a.tradeDate) - parseDate(b.date || b.tradeDate));
      sorted.forEach((t) => {
        const qty = Number(t.quantity) || 0;
        const mtm = Number(t.mtmPnl) || 0;
        const sym = t.symbol || 'OTHER';
        if (qty === 0) return;
        const pos = holdings[sym] || 0;
        const isClosing = pos !== 0 && (qty > 0) !== (pos > 0);
        if (isClosing) {
          const closedQty = Math.min(Math.abs(qty), Math.abs(pos));
          const closingMtm = qty !== 0 ? mtm * (closedQty / Math.abs(qty)) : 0;
          if (!symMap[sym]) symMap[sym] = { profit: 0, loss: 0, win: 0, total: 0 };
          symMap[sym].total += 1;
          if (closingMtm > 0) {
            symMap[sym].profit += closingMtm;
            symMap[sym].win += 1;
          } else if (closingMtm < 0) symMap[sym].loss += closingMtm;
        }
        holdings[sym] = pos + qty;
      });
      symbolStats = Object.entries(symMap)
        .map(([sym, s]) => ({
          symbol: sym,
          totalPnl: Math.round((s.profit + s.loss) * 100) / 100,
          profit: Math.round(s.profit * 100) / 100,
          loss: Math.abs(Math.round(s.loss * 100) / 100),
          winRate: s.total ? Math.round((s.win / s.total) * 1000) / 10 : 0,
          tradeCount: s.total,
        }))
        .sort((a, b) => b.totalPnl - a.totalPnl);
    }
    return symbolStats;
  }, [data?.tradePnLAnalysis, data?.trades]);
}

function PnlCalendar({ dailyPnL }) {
  const [current, setCurrent] = useState(() => new Date());
  const y = current.getFullYear();
  const m = current.getMonth();
  const pnlMap = useMemo(() => {
    const map = {};
    (dailyPnL || []).forEach((d) => {
      const dateStr = d.date && /^\d{8}$/.test(String(d.date))
        ? `${String(d.date).slice(0, 4)}-${String(d.date).slice(4, 6)}-${String(d.date).slice(6, 8)}`
        : String(d.date).slice(0, 10);
      map[dateStr] = d.pnl;
    });
    return map;
  }, [dailyPnL]);

  const firstDay = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0);
  const startWeekDay = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  let maxAbs = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    maxAbs = Math.max(maxAbs, Math.abs(pnlMap[dateStr] || 0));
  }

  const days = [];
  for (let i = 0; i < startWeekDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  return (
    <Card title="盈亏日历">
      <div className="mb-3 flex items-center justify-center gap-3">
        <button onClick={() => setCurrent(new Date(y, m - 1, 1))} className="rounded-md border px-2 py-1 text-xs">◀</button>
        <span className="min-w-[80px] text-center text-sm font-medium">
          {y}年{m + 1}月
        </span>
        <button onClick={() => setCurrent(new Date(y, m + 1, 1))} className="rounded-md border px-2 py-1 text-xs">▶</button>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[300px]">
          <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs text-[var(--gray)]">
            {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          if (d == null) return <div key={i} />;
          const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const val = pnlMap[dateStr] || 0;
          const intensity = maxAbs ? Math.min(Math.abs(val) / maxAbs, 1) : 0;
          const bg = val > 0 ? `rgba(0,200,83,${0.1 + intensity * 0.8})` : val < 0 ? `rgba(255,61,0,${0.1 + intensity * 0.8})` : '#f5f5f5';
          const color = intensity > 0.5 ? '#fff' : val !== 0 ? (val > 0 ? '#00c853' : '#ff3d00') : '#999';
          const displayVal = val !== 0 ? fmtNum(val, 0) : '';
          return (
            <div
              key={i}
              title={`${dateStr} ${val !== 0 ? (val > 0 ? '+' : '') + fmtCur(val) : '无盈亏'}`}
              className="flex aspect-square flex-col items-center justify-center rounded text-[10px] font-medium leading-tight"
              style={{ background: bg, color }}
            >
              {val !== 0 && <span className="text-[10px]">{displayVal}</span>}
              <span className="text-xs opacity-80">{d}</span>
            </div>
          );
        })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function BenchmarkSummary({ data }) {
  const series = useEquitySeries(data, 'navAll');
  if (!series.length) return null;
  const labels = series.map((s) => s.date.toISOString().slice(0, 10));
  const firstValue = series[0].value;
  const accountReturns = series.map((s) => (firstValue ? ((s.value / firstValue) - 1) * 100 : 0));
  const myTotal = accountReturns[accountReturns.length - 1] || 0;

  function getBenchmarkTotal(key) {
    const raw = data.benchmarks?.[key];
    if (!raw || !raw.length) return null;
    const priceMap = {};
    raw.forEach((r) => (priceMap[r.date] = r.price));
    let firstPrice = priceMap[labels[0]];
    if (firstPrice == null) {
      for (let i = 0; i < raw.length; i++) {
        if (raw[i].date <= labels[0]) firstPrice = raw[i].price;
        else break;
      }
    }
    if (firstPrice == null || firstPrice === 0) return null;
    const lastPrice = priceMap[labels[labels.length - 1]];
    if (lastPrice == null) return null;
    return ((lastPrice / firstPrice) - 1) * 100;
  }

  const BENCHMARK_COLORS = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
  const BENCHMARK_LABELS = { 'SP500': '标普500', 'HSI': '恒生指数', 'CSI300': '沪深300', 'N225': '日经225', 'STI': '海峡指数', 'NASDAQ': '纳斯达克' };

  const benchmarkKeys = Object.keys(data.benchmarks || {}).filter((k) => k !== 'accountId');
  const benchmarkTotals = {};
  const benchmarkMaps = {};
  const benchmarkFirsts = {};

  benchmarkKeys.forEach((key) => {
    benchmarkTotals[key] = getBenchmarkTotal(key);
    const bmData = data.benchmarks[key];
    const first = bmData?.find((r) => r.date <= labels[0])?.price || bmData?.[0]?.price;
    benchmarkFirsts[key] = first;
    const map = {};
    (bmData || []).forEach((r) => (map[r.date] = r.price));
    benchmarkMaps[key] = map;
  });

  const echartsSeries = [
    {
      name: '我的账户',
      type: 'line',
      data: accountReturns,
      smooth: true,
      showSymbol: false,
      lineStyle: { color: '#000', width: 2 },
      areaStyle: { color: 'rgba(0,0,0,0.05)' },
      z: 10,
    },
  ];

  benchmarkKeys.forEach((key, idx) => {
    if (benchmarkTotals[key] == null) return;
    const color = BENCHMARK_COLORS[idx % BENCHMARK_COLORS.length];
    const map = benchmarkMaps[key];
    const first = benchmarkFirsts[key];
    echartsSeries.push({
      name: BENCHMARK_LABELS[key] || key,
      type: 'line',
      data: labels.map((d) => { const p = map[d]; return first && p != null ? ((p / first) - 1) * 100 : null; }),
      smooth: true,
      showSymbol: false,
      connectNulls: true,
      lineStyle: { color, width: 2, type: 'dashed' },
      z: 5,
    });
  });

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      formatter: (params) => {
        let html = `${params[0].axisValue}<br/>`;
        params.forEach((p) => {
          const val = p.value;
          if (val == null) return;
          html += `${p.marker} ${p.seriesName}: ${(val >= 0 ? '+' : '') + fmtNum(val, 2) + '%'}<br/>`;
        });
        return html;
      },
    },
    legend: { top: 0, itemWidth: 10, textStyle: { fontSize: 11, color: '#666' } },
    grid: { left: '3%', right: '4%', bottom: '3%', top: 28, containLabel: true },
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
      axisLabel: { formatter: (v) => (v >= 0 ? '+' : '') + fmtNum(v, 1) + '%', color: '#666' },
      splitLine: { lineStyle: { color: '#f0f0f0' } },
    },
    series: echartsSeries,
  };

  // Build stat cards dynamically
  const statCards = [
    <Stat key="me" label="我的账户" value={(myTotal >= 0 ? '+' : '') + fmtNum(myTotal, 2) + '%'} colorClass={myTotal >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
  ];
  const firstBmKey = benchmarkKeys.find((k) => benchmarkTotals[k] != null);
  benchmarkKeys.forEach((key) => {
    if (benchmarkTotals[key] == null) return;
    const label = BENCHMARK_LABELS[key] || key;
    statCards.push(
      <Stat key={key} label={label} value={(benchmarkTotals[key] >= 0 ? '+' : '') + fmtNum(benchmarkTotals[key], 2) + '%'} colorClass={benchmarkTotals[key] >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
    );
  });
  if (firstBmKey && benchmarkTotals[firstBmKey] != null) {
    const diff = myTotal - benchmarkTotals[firstBmKey];
    statCards.push(
      <Stat key="excess" label={`相对 ${BENCHMARK_LABELS[firstBmKey] || firstBmKey} 超额`} value={(diff >= 0 ? '+' : '') + fmtNum(diff, 2) + '%'} colorClass={diff >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
    );
  }

  const cols = statCards.length <= 2 ? 2 : statCards.length <= 4 ? 4 : Math.min(statCards.length, 6);
  const gridClass = `grid-cols-2 gap-3 sm:grid-cols-${Math.min(cols, 4)}`;

  return (
    <Card title="基准收益对比">
      <div className={`mb-4 grid ${gridClass}`}>
        {statCards}
      </div>
      <div className="chart-container" style={{ height: 220 }}>
        <ECharts option={option} style={{ height: 220 }} />
      </div>
    </Card>
  );
}

function DividendAnalysis({ data }) {
  const arr = data.dividends || [];
  if (!arr.length) return null;
  const byYear = {};
  const bySymbol = {};
  let totalDiv = 0;
  arr.forEach((d) => {
    const year = String(d.date || d.exDate || d.payDate || '').slice(0, 4);
    const amt = Math.abs(Number(d.amount) || 0);
    const sym = d.symbol || d.underlyingSymbol || '其他';
    if (year) byYear[year] = (byYear[year] || 0) + amt;
    bySymbol[sym] = (bySymbol[sym] || 0) + amt;
    totalDiv += amt;
  });
  const totalReturn = (data.changeInNav?.endingValue || 0) - (data.changeInNav?.startingValue || 0);
  const returnRatio = totalReturn ? (totalDiv / totalReturn) * 100 : 0;
  const years = Object.keys(byYear).sort();
  const topSymbols = Object.entries(bySymbol)
    .map(([sym, amt]) => ({ sym, amt }))
    .sort((a, b) => b.amt - a.amt)
    .slice(0, 10);

  const option = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => ` 股息: ${fmtCur(params[0].value)}` },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: years, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#666' }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => fmtCur(v), color: '#666' }, splitLine: { lineStyle: { color: '#f0f0f0' } } },
    series: [{ type: 'bar', data: years.map((y) => byYear[y]), itemStyle: { color: '#00c853', borderRadius: [4, 4, 0, 0] } }],
  };

  return (
    <Card title="股息收益分析">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="累计股息收入" value={fmtCur(totalDiv)} colorClass="text-[var(--success)]" />
        <Stat label="股息占总收益" value={fmtNum(returnRatio, 2) + '%'} />
      </div>
      <div className="chart-container" style={{ height: 220 }}>
        <ECharts option={option} style={{ height: 220 }} />
      </div>
      <div className="mt-4">
        <div className="mb-2 text-sm font-semibold">🏆 TOP 股息标的</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                <th className="py-2">标的</th>
                <th className="py-2">累计股息</th>
                <th className="py-2">笔数</th>
              </tr>
            </thead>
            <tbody>
              {topSymbols.map((r) => (
                <tr key={r.sym} className="border-b border-[var(--lighter-gray)]">
                  <td className="py-2 font-medium">{r.sym}</td>
                  <td className="py-2 font-semibold text-[var(--success)]">+{fmtCur(r.amt)}</td>
                  <td className="py-2">{arr.filter((d) => (d.symbol || d.underlyingSymbol) === r.sym).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function FeeImpact({ data }) {
  const fees = data.transactionFees || [];
  const nav = data.changeInNav || {};
  const totalFee =
    Math.abs(Number(nav.commissions || 0)) +
    Math.abs(Number(nav.otherFees || 0)) +
    Math.abs(Number(nav.brokerFees || 0)) +
    Math.abs(Number(nav.transactionTax || 0)) +
    Math.abs(Number(nav.salesTax || 0));
  const sumFees = fees.reduce((s, f) => s + Math.abs(Number(f.amount) || 0), 0);
  // 明细表 archive_unbundled_commission_detail 通常比 changeInNav 聚合字段更完整，取较大值
  const finalTotalFee = Math.max(totalFee, sumFees);
  const totalReturn = (nav.endingValue || 0) - (nav.startingValue || 0);
  const erosion = totalReturn ? (finalTotalFee / totalReturn) * 100 : 0;

  const typeMap = {
    brokerExecution: '券商执行费',
    brokerClearing: '券商清算费',
    thirdPartyExecution: '第三方执行费',
    thirdPartyClearing: '第三方清算费',
    thirdPartyRegulatory: '第三方监管费',
    finraFee: 'FINRA费',
    secFee: 'SEC费',
    regOther: '其他监管费',
    other: '其他',
  };
  const typeTotals = {};
  fees.forEach((f) => {
    Object.entries(typeMap).forEach(([key, label]) => {
      const amt = Math.abs(Number(f[key]) || 0);
      if (amt > 0) typeTotals[label] = (typeTotals[label] || 0) + amt;
    });
  });
  const pieLabels = Object.keys(typeTotals);
  const pieData = Object.values(typeTotals);
  const colors = ['#000', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  const byYear = {};
  fees.forEach((f) => {
    const year = String(f.date || '').slice(0, 4);
    if (year) byYear[year] = (byYear[year] || 0) + Math.abs(Number(f.amount) || 0);
  });
  const years = Object.keys(byYear).sort();

  const pieOption = {
    tooltip: { trigger: 'item', formatter: (params) => `${params.name}: ${fmtCur(params.value)} (${params.percent}%)` },
    legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle', itemWidth: 10, textStyle: { fontSize: 11, color: '#666' } },
    color: colors,
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['35%', '50%'],
      data: pieLabels.map((name, i) => ({ name, value: pieData[i] })),
      label: { show: false },
      emphasis: { label: { show: true } },
    }],
  };

  const lineOption = {
    tooltip: { trigger: 'axis', formatter: (params) => `${params[0].axisValue}<br/>${params[0].marker} 年度费用: ${fmtCur(params[0].value)}` },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: years, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#666' }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => fmtCur(v), color: '#666' }, splitLine: { lineStyle: { color: '#f0f0f0' } } },
    series: [{
      type: 'line',
      data: years.map((y) => byYear[y]),
      smooth: true,
      showSymbol: true,
      symbolSize: 6,
      lineStyle: { color: '#ff3d00' },
      areaStyle: { color: 'rgba(255,61,0,0.08)' },
      itemStyle: { color: '#ff3d00' },
    }],
  };

  return (
    <Card title="费用侵蚀分析">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="累计费用" value={fmtCur(finalTotalFee)} />
        <Stat label="费用占收益比" value={fmtNum(erosion, 3) + '%'} colorClass="text-[var(--danger)]" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {pieLabels.length > 0 && (
          <div className="chart-container" style={{ height: 220 }}>
            <ECharts option={pieOption} style={{ height: 220 }} />
          </div>
        )}
        {years.length > 0 && (
          <div className="chart-container" style={{ height: 220 }}>
            <ECharts option={lineOption} style={{ height: 220 }} />
          </div>
        )}
      </div>
    </Card>
  );
}

export default function PerformanceTab() {
  const data = useDashboardStore((s) => s.data);
  const currentNavRange = useDashboardStore((s) => s.currentNavRange);
  if (!data) return <div className="py-10 text-center text-[var(--gray)]">暂无数据</div>;

  const nav = data.changeInNav || {};
  const pnl = usePnlAnalysis(data);
  const ranking = usePnlRanking(data);
  const profitItems = ranking.filter((s) => s.totalPnl > 0).slice(0, 10);
  const lossItems = ranking.filter((s) => s.totalPnl < 0).slice(0, 10);
  const winRateItems = [...ranking].sort((a, b) => b.winRate - a.winRate).slice(0, 10);

  const tradeBehavior = data.tradeBehavior || {};
  const monthlyTradePerf = tradeBehavior.monthlyTradePerformance || [];
  const inefficientTrades = tradeBehavior.inefficientTrades || [];
  const avgPnls = monthlyTradePerf.map((m) => m.avgPnl || 0);
  const bestMonthAvg = avgPnls.length ? Math.max(...avgPnls) : null;
  const worstMonthAvg = avgPnls.length ? Math.min(...avgPnls) : null;
  const perf = data.performance || {};
  const totalCapital = (perf.initialCapital || 0) + (perf.netDeposits || 0) + (perf.netTransfers || 0);

  return (
    <div className="space-y-6">
      <Card title="每日盈亏曲线">
        <DailyPLChart data={data} range={currentNavRange} />
      </Card>
      <Card title="月度收益柱状图">
        <MonthlyChart data={data} range={currentNavRange} />
      </Card>
      <Card title="已实现 / 未实现盈亏对比">
        <RealizedChart data={data} />
      </Card>
      <Card title="业绩摘要">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="已实现盈亏" value={fmtCur(nav.realized || 0)} colorClass={(nav.realized || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
          <Stat label="未实现变动" value={fmtCur(nav.changeInUnrealized || 0)} colorClass={(nav.changeInUnrealized || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
          <Stat label="MTM 本期" value={fmtCur(nav.mtm || 0)} colorClass={(nav.mtm || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
          <Stat label="股息收入" value={fmtCur(nav.dividends || 0)} colorClass="text-[var(--success)]" />
          <Stat label="利息收入" value={fmtCur(nav.interest || 0)} />
          <Stat label="佣金费用" value={fmtCur(nav.commissions || 0)} colorClass="text-[var(--danger)]" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="初始资本" value={fmtCur(perf.initialCapital || 0)} />
          <Stat label="净入金" value={fmtCur(perf.netDeposits || 0)} colorClass={(perf.netDeposits || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
          <Stat label="净转账" value={fmtCur(perf.netTransfers || 0)} colorClass={(perf.netTransfers || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
          <Stat label="实际总本金" value={fmtCur(totalCapital)} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="卡玛比率" value={fmtNum(data.metrics?.calmarRatio, 2)} />
          <Stat label="索提诺比率" value={fmtNum(data.metrics?.sortinoRatio, 2)} />
          <Stat label="最大连续盈利月数" value={fmtNum(data.metrics?.maxConsecutiveWinMonths, 0)} colorClass="text-[var(--success)]" />
          <Stat label="最大连续亏损月数" value={fmtNum(data.metrics?.maxConsecutiveLossMonths, 0)} colorClass="text-[var(--danger)]" />
        </div>
      </Card>

      <Card title="盈亏分析">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="总盈亏" value={(pnl.totalPnl >= 0 ? '+' : '') + fmtCur(pnl.totalPnl)} colorClass={pnl.totalPnl >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
          <Stat label="胜率" value={pnl.totalCount ? fmtNum((pnl.profitCount / pnl.totalCount) * 100, 1) + '%' : '--'} />
          <Stat label="盈亏比" value={pnl.plRatio === 999 ? '∞' : fmtNum(pnl.plRatio, 2)} />
          <Stat label="平均盈利" value={fmtCur(pnl.avgProfit)} colorClass="text-[var(--success)]" />
          <Stat label="平均亏损" value={fmtCur(pnl.avgLoss)} colorClass="text-[var(--danger)]" />
        </div>
        <PnlCompositionChart assetStats={pnl.assetStats} />
      </Card>

      <Card title="盈亏排行">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-sm font-semibold text-[var(--success)]">🏆 区间盈利 TOP</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                    <th className="py-2">标的</th>
                    <th className="py-2">盈亏</th>
                    <th className="py-2">胜率</th>
                  </tr>
                </thead>
                <tbody>
                  {profitItems.map((s) => (
                    <tr key={s.symbol} className="border-b border-[var(--lighter-gray)]">
                      <td className="py-2 font-medium">{s.symbol}</td>
                      <td className="py-2 font-semibold text-[var(--success)]">+{fmtCur(s.totalPnl)}</td>
                      <td className="py-2">{s.winRate}%</td>
                    </tr>
                  ))}
                  {!profitItems.length && <tr><td colSpan={3} className="py-4 text-center text-[var(--gray)]">暂无盈利标的</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold text-[var(--danger)]">📉 区间亏损 TOP</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                    <th className="py-2">标的</th>
                    <th className="py-2">盈亏</th>
                    <th className="py-2">胜率</th>
                  </tr>
                </thead>
                <tbody>
                  {lossItems.map((s) => (
                    <tr key={s.symbol} className="border-b border-[var(--lighter-gray)]">
                      <td className="py-2 font-medium">{s.symbol}</td>
                      <td className="py-2 font-semibold text-[var(--danger)]">{fmtCur(s.totalPnl)}</td>
                      <td className="py-2">{s.winRate}%</td>
                    </tr>
                  ))}
                  {!lossItems.length && <tr><td colSpan={3} className="py-4 text-center text-[var(--gray)]">暂无亏损标的</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-2 text-sm font-semibold">📊 交易胜率排行</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                  <th className="py-2">标的</th>
                  <th className="py-2">交易次数</th>
                  <th className="py-2">盈利次数</th>
                  <th className="py-2">亏损次数</th>
                  <th className="py-2">胜率</th>
                  <th className="py-2">总盈亏</th>
                </tr>
              </thead>
              <tbody>
                {winRateItems.map((s) => (
                  <tr key={s.symbol} className="border-b border-[var(--lighter-gray)]">
                    <td className="py-2 font-medium">{s.symbol}</td>
                    <td className="py-2">{s.tradeCount}</td>
                    <td className="py-2">{Math.round(s.tradeCount * s.winRate / 100) || 0}</td>
                    <td className="py-2">{Math.round(s.tradeCount * (100 - s.winRate) / 100) || 0}</td>
                    <td className="py-2">{s.winRate}%</td>
                    <td className={`py-2 font-semibold ${s.totalPnl >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                      {s.totalPnl >= 0 ? '+' : ''}{fmtCur(s.totalPnl)}
                    </td>
                  </tr>
                ))}
                {!winRateItems.length && <tr><td colSpan={6} className="py-4 text-center text-[var(--gray)]">暂无数据</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <PnlCalendar dailyPnL={data.dailyPnL || []} />

      <Card title="月度交易统计">
        <MonthlyTradesChart stats={data.monthlyTradeStats || []} />
      </Card>

      <BenchmarkSummary data={data} />
      <DividendAnalysis data={data} />
      <FeeImpact data={data} />
      <Card title="标的级 MTM 绩效 (MTM Performance Summary)">
        <MtmPerformanceTable data={data} />
      </Card>

      <Card title="月度盈亏热力图 (ECharts)">
        <PnlHeatmap dailyPnL={data.dailyPnL || []} />
      </Card>

      <Card title="资金流向桑基图">
        <CapitalFlowSankey data={data} />
      </Card>

      <Card title="交易行为复盘">
        <div className="space-y-6">
          <div>
            <div className="mb-2 text-sm font-semibold">月度交易绩效</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                    <th className="py-2">月份</th>
                    <th className="py-2">交易笔数</th>
                    <th className="py-2">总盈亏</th>
                    <th className="py-2">平均盈亏</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyTradePerf.map((m, i) => (
                    <tr key={i} className="border-b border-[var(--lighter-gray)]">
                      <td className="py-2">{m.month}</td>
                      <td className="py-2">{m.tradeCount}</td>
                      <td className={`py-2 font-semibold ${(m.totalPnl || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                        {(m.totalPnl || 0) >= 0 ? '+' : ''}{fmtCur(m.totalPnl || 0)}
                      </td>
                      <td className={`py-2 ${(m.avgPnl || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                        {(m.avgPnl || 0) >= 0 ? '+' : ''}{fmtCur(m.avgPnl || 0)}
                      </td>
                    </tr>
                  ))}
                  {!monthlyTradePerf.length && <tr><td colSpan={4} className="py-4 text-center text-[var(--gray)]">暂无数据</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold">无效交易识别</div>
            {inefficientTrades.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {inefficientTrades.map((t, i) => (
                  <div key={i} className="rounded-xl border border-[var(--light-gray)] p-4">
                    <div className="mb-1 text-xs text-[var(--gray)]">交易类型</div>
                    <div className="mb-2 font-medium">{t.category}</div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-[var(--gray)]">胜率</div>
                        <div>{fmtNum(t.winRate, 1)}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--gray)]">盈亏比</div>
                        <div>{fmtNum(t.plRatio, 2)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--gray)]">交易次数</div>
                        <div>{t.totalTrades}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--light-gray)] bg-green-50 p-4 text-sm text-green-700">
                未发现明显无效交易模式
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold">择时能力概览</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="总平仓交易数" value={fmtNum(tradeBehavior.totalCloseTrades || 0, 0)} />
              <Stat label="最佳月份平均收益" value={bestMonthAvg != null ? ((bestMonthAvg >= 0 ? '+' : '') + fmtCur(bestMonthAvg)) : '--'} colorClass={bestMonthAvg != null && bestMonthAvg >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
              <Stat label="最差月份平均收益" value={worstMonthAvg != null ? ((worstMonthAvg >= 0 ? '+' : '') + fmtCur(worstMonthAvg)) : '--'} colorClass={worstMonthAvg != null && worstMonthAvg >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'} />
            </div>
          </div>
        </div>
      </Card>

      <Card title="交易成本拆解瀑布图">
        <CostBreakdownWaterfall costBreakdown={data.costBreakdown} />
      </Card>

      <Card title="交易行为热力图">
        <TradingHeatmap data={data} />
      </Card>
      <Card title="交易盈亏榜">
        <TradeRankings data={data} />
      </Card>
      <Card title="费用侵蚀">
        <FeeErosionPanel data={data} />
      </Card>
      <Card title="择时 vs 选股归因">
        <TimingAttribution data={data} />
      </Card>
    </div>
  );
}

function PnlHeatmap({ dailyPnL }) {
  const option = useMemo(() => {
    if (!dailyPnL.length) return null;
    const normDateStr = (d) => {
      if (d && /^\d{8}$/.test(String(d.date))) {
        return `${String(d.date).slice(0, 4)}-${String(d.date).slice(4, 6)}-${String(d.date).slice(6, 8)}`;
      }
      return String(d.date).slice(0, 10);
    };
    const years = [...new Set(dailyPnL.map((d) => normDateStr(d).slice(0, 4)))];
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const map = {};
    dailyPnL.forEach((d) => {
      const ym = normDateStr(d).slice(0, 7);
      map[ym] = (map[ym] || 0) + (d.pnl || 0);
    });
    const data = [];
    years.forEach((y, yIndex) => {
      months.forEach((m, mIndex) => {
        const val = map[`${y}-${m}`] || 0;
        data.push([mIndex, yIndex, Number(val.toFixed(2))]);
      });
    });
    const maxAbs = Math.max(...data.map((d) => Math.abs(d[2])), 1);
    return {
      tooltip: {
        position: 'top',
        formatter: (p) => `${years[p.value[1]]}-${String(p.value[0] + 1).padStart(2, '0')}: ${fmtCur(p.value[2])}`
      },
      grid: { height: '70%', top: '10%' },
      xAxis: { type: 'category', data: months.map((_, i) => `${i + 1}月`), splitArea: { show: true } },
      yAxis: { type: 'category', data: years, splitArea: { show: true } },
      visualMap: {
        min: -maxAbs,
        max: maxAbs,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: '0%',
        inRange: {
          color: ['#ff3d00', '#ffcccc', '#ffffff', '#ccffcc', '#00c853']
        }
      },
      series: [{
        name: '月度盈亏',
        type: 'heatmap',
        data,
        label: { show: false },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } }
      }]
    };
  }, [dailyPnL]);

  if (!option) return <p className="text-sm text-[var(--gray)]">暂无数据</p>;
  return <ECharts option={option} style={{ height: 260 }} />;
}

function CapitalFlowSankey({ data }) {
  const option = useMemo(() => {
    const perf = data.performance || {};
    const nav = data.changeInNav || {};
    const realized = Math.max(0, perf.realized || nav.realized || 0);
    const dividends = Math.max(0, perf.dividends || nav.dividends || 0);
    const interest = Math.max(0, perf.interest || nav.interest || 0);
    const mtm = Math.max(0, perf.mtm || nav.mtm || 0);
    const commissions = Math.abs(perf.commissions || nav.commissions || 0);
    const fees = Math.abs(nav.brokerFees || 0) + Math.abs(nav.otherFees || 0) + Math.abs(nav.forexCommissions || 0) + Math.abs(nav.transactionTax || 0);
    const netDeposits = Math.max(0, perf.netDeposits || 0);

    const nodes = [
      { name: '已实现盈亏' },
      { name: '股息' },
      { name: '利息' },
      { name: 'MTM' },
      { name: '净入金' },
      { name: '总流入' },
      { name: '佣金费用' },
      { name: '其他费用' },
      { name: '净资产增长' },
    ];
    const links = [
      { source: '已实现盈亏', target: '总流入', value: realized },
      { source: '股息', target: '总流入', value: dividends },
      { source: '利息', target: '总流入', value: interest },
      { source: 'MTM', target: '总流入', value: mtm },
      { source: '净入金', target: '总流入', value: netDeposits },
      { source: '总流入', target: '佣金费用', value: commissions },
      { source: '总流入', target: '其他费用', value: fees },
      { source: '总流入', target: '净资产增长', value: Math.max(0, realized + dividends + interest + mtm + netDeposits - commissions - fees) },
    ].filter((l) => l.value > 0.01);

    if (links.length < 2) return null;

    return {
      tooltip: {
        trigger: 'item',
        triggerOn: 'mousemove',
        formatter: (params) => {
          if (params.dataType === 'edge') {
            return `${params.data.source} → ${params.data.target}: ${fmtCur(params.data.value)}`;
          }
          return `${params.name}: ${fmtCur(params.value)}`;
        },
      },
      series: [{
        type: 'sankey',
        layout: 'none',
        emphasis: { focus: 'adjacency' },
        data: nodes,
        links,
        lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.4 },
        itemStyle: { color: '#6366f1', borderColor: '#6366f1' },
        label: { fontSize: 11, color: '#666' },
      }],
    };
  }, [data]);

  if (!option) return <p className="text-sm text-[var(--gray)]">数据不足，无法绘制桑基图</p>;
  return <ECharts option={option} style={{ height: 280 }} />;
}

function CostBreakdownWaterfall({ costBreakdown }) {
  const option = useMemo(() => {
    if (!costBreakdown || Math.abs(costBreakdown.totalCost || 0) <= 0.01) return null;
    const map = {
      '总佣金': costBreakdown.totalCommission,
      'SEC费': costBreakdown.secFee,
      'FINRA费': costBreakdown.finraFee,
      '其他规费': costBreakdown.regOther,
      '其他': costBreakdown.other,
      '券商执行费': costBreakdown.brokerExecution,
      '第三方执行费': costBreakdown.thirdPartyExecution,
      '第三方清算费': costBreakdown.thirdPartyClearing,
      '第三方监管费': costBreakdown.thirdPartyRegulatory,
      '总成本': costBreakdown.totalCost,
    };
    const entries = Object.entries(map).filter(([_, v]) => Math.abs(v || 0) > 0.01);
    if (!entries.length) return null;
    const labels = entries.map(([k]) => k);
    const values = entries.map(([_, v]) => v || 0);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => `${params[0].name}: ${fmtCur(params[0].value)}` },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v) => fmtCur(v) } },
      yAxis: { type: 'category', data: labels },
      series: [{
        type: 'bar',
        data: values.map(v => ({ value: v, itemStyle: { color: (v || 0) >= 0 ? '#ef4444' : '#00c853' } })),
        label: { show: true, position: 'right', formatter: (p) => fmtCur(p.value) }
      }]
    };
  }, [costBreakdown]);

  if (!option) return <p className="text-sm text-[var(--gray)]">暂无交易成本明细数据</p>;
  return <ECharts option={option} style={{ height: 320 }} />;
}

function MtmPerformanceTable({ data }) {
  const rows = (data.mtmPerformanceSummary || []).slice(0, 200);
  if (!rows.length) return <p className="text-sm text-[var(--gray)]">暂无 MTM 绩效数据</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
            <th className="py-2">报告日期</th>
            <th className="py-2">标的</th>
            <th className="py-2">描述</th>
            <th className="py-2">类型</th>
            <th className="py-2 text-right">交易 MTM</th>
            <th className="py-2 text-right">期初未实现</th>
            <th className="py-2 text-right">佣金</th>
            <th className="py-2 text-right">合计</th>
            <th className="py-2 text-right">含应计合计</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[var(--lighter-gray)]">
              <td className="py-2">{fmtDate(r.reportDate)}</td>
              <td className="py-2 font-medium">{r.symbol || '-'}</td>
              <td className="py-2 text-[var(--gray)]">{r.description || '-'}</td>
              <td className="py-2">{r.assetCategory || '-'}</td>
              <td className={`py-2 text-right ${(r.transactionMtm || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                {fmtCur(r.transactionMtm || 0)}
              </td>
              <td className={`py-2 text-right ${(r.priorOpenMtm || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                {fmtCur(r.priorOpenMtm || 0)}
              </td>
              <td className="py-2 text-right text-[var(--danger)]">{fmtCur(r.commissions || 0)}</td>
              <td className={`py-2 text-right font-semibold ${(r.total || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                {fmtCur(r.total || 0)}
              </td>
              <td className={`py-2 text-right ${(r.totalWithAccruals || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                {fmtCur(r.totalWithAccruals || 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
