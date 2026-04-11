import { useMemo, useState } from 'react';
import ECharts from './ECharts';
import { fmtNum, fmtCur, parseDate } from '../utils/format';
import { useDashboardStore } from '../stores/dashboardStore';
import { getCustomRangeSummary, calcAdjustedReturns, rebaseCumulativeSeries } from '../utils/navRange';

const MODES = [
  { key: 'simple', label: '简单加权' },
  { key: 'twr', label: '时间加权' },
  { key: 'mwr', label: '现金加权' },
];

const BENCH_META = [
  { key: 'HSI', label: '恒生指数', color: '#2563eb' },
  { key: 'SP500', label: '标普500', color: '#ef4444' },
  { key: 'CSI300', label: '沪深300', color: '#7c3aed' },
  { key: 'N225', label: '日经225', color: '#f59e0b' },
  { key: 'STI', label: '海峡指数', color: '#10b981' },
  { key: 'NASDAQ', label: '纳斯达克', color: '#db2777' },
  { key: 'QQQ', label: 'QQQ', color: '#6366f1' },
];

function getSeriesForRange(data, range, mode, customStart, customEnd) {
  if (!data) return [];

  // Custom range handling
  if (range === 'custom') {
    if (!customStart) {
      // customStart 未设置时 fallback 到全部数据
      let hist = mode === 'twr'
        ? (data.historyTwr?.navAll || [])
        : mode === 'mwr'
          ? (data.historyMwr?.navAll || [])
          : (data.historySimpleReturns?.navAll || data.history?.navAll || []);
      return hist.map((h) => ({
        date: h.date ? parseDate(h.date) : new Date(),
        value: h.nav || 0,
      }));
    }

    const flowMap = {};
    (data.dailyFlow || []).forEach((d) => (flowMap[d.date] = d.flow || 0));

    let rawHist;
    if (mode === 'twr') {
      rawHist = data.historyTwr?.navAll || [];
      rawHist = rebaseCumulativeSeries(rawHist, customStart, customEnd);
    } else if (mode === 'mwr') {
      rawHist = data.historyMwr?.navAll || [];
      rawHist = rebaseCumulativeSeries(rawHist, customStart, customEnd);
    } else {
      rawHist = calcAdjustedReturns(data.history?.navAll || [], flowMap, customStart, customEnd);
    }
    return rawHist.map((h) => ({
      date: h.date ? parseDate(h.date) : new Date(),
      value: h.nav || 0,
    }));
  }

  let hist;
  if (mode === 'twr') {
    hist = data.historyTwr?.[range] || data.historyTwr?.navAll || [];
  } else if (mode === 'mwr') {
    hist = data.historyMwr?.[range] || data.historyMwr?.navAll || [];
  } else {
    // navAll 使用全程累计真实收益率；区间视图使用区间起点 0% 的真实收益率
    if (range === 'navAll' || !range) {
      hist = data.historySimpleReturns?.navAll || data.history?.navAll || [];
    } else {
      hist = data.historyAdjustedReturns?.[range] || data.historyAdjustedReturns?.navAll || data.history?.[range] || data.history?.navAll || [];
    }
  }
  if (!hist.length) return [];

  const series = hist.map((h) => ({
    date: h.date ? parseDate(h.date) : new Date(),
    value: h.nav || 0,
  }));

  if (range === 'navAll' || !range) return series;

  const now = new Date();
  let cutoff = new Date();
  if (range === 'nav1Week') cutoff.setDate(now.getDate() - 7);
  else if (range === 'navMTD') cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (range === 'nav1Month') cutoff.setDate(now.getDate() - 30);
  else if (range === 'nav3Months') cutoff.setDate(now.getDate() - 90);
  else if (range === 'nav1Year') cutoff.setFullYear(now.getFullYear() - 1);
  else if (range === 'navYTD') cutoff = new Date(now.getFullYear(), 0, 1);

  return series.filter((s) => s.date >= cutoff);
}

export default function NavChart({ data, range }) {
  const [mode, setMode] = useState('simple');
  const [hiddenBenches, setHiddenBenches] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('benchmarkVisibility') || '[]'));
    } catch {
      return new Set();
    }
  });
  const customNavStart = useDashboardStore((s) => s.customNavStart);
  const customNavEnd = useDashboardStore((s) => s.customNavEnd);

  const series = useMemo(() => getSeriesForRange(data, range, mode, customNavStart, customNavEnd), [data, range, mode, customNavStart, customNavEnd]);

  const toggleBench = (key) => {
    setHiddenBenches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem('benchmarkVisibility', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const { labels, accountReturns, benchSeries, stats } = useMemo(() => {
    if (!series.length) {
      return { labels: [], accountReturns: [], benchSeries: {}, stats: {} };
    }
    const labels = series.map((s) => s.date.toISOString().slice(0, 10));
    const firstValue = series[0].value;

    // For simple mode the backend already gives us cashflow-adjusted return % values.
    // For twr/mwr modes the backend also gives us return % values (starting from 0).
    const accountReturns = series.map((s) => s.value);

    function getBenchmarkSeries(key) {
      const raw = data.benchmarks?.[key];
      if (!raw || !raw.length) return null;
      const priceMap = {};
      raw.forEach((r) => (priceMap[r.date] = r.price));
      let firstPrice = priceMap[labels[0]];
      if (firstPrice == null) {
        // 找到第一个 <= labels[0] 的数据点
        for (let i = 0; i < raw.length; i++) {
          if (raw[i].date <= labels[0]) {
            firstPrice = raw[i].price;
            break;
          }
        }
      }
      // fallback: 如果 labels[0] 比 benchmark 最早数据还早，用最早的数据点
      if (firstPrice == null && raw.length) {
        firstPrice = raw[0].price;
      }
      if (!firstPrice) return null;
      const vals = labels.map((d) => {
        const p = priceMap[d];
        if (p == null) return null;
        return ((p / firstPrice) - 1) * 100;
      });
      return vals;
    }

    const benchSeries = {};
    BENCH_META.forEach((bm) => {
      const vals = getBenchmarkSeries(bm.key);
      if (vals) benchSeries[bm.key] = vals;
    });

    let rangeSummary;
    if (range === 'custom' && customNavStart) {
      rangeSummary = getCustomRangeSummary(data, customNavStart, customNavEnd);
    } else {
      rangeSummary = data.rangeSummaries?.[range] || {};
    }
    // simple 模式用 rangeSummary（已扣除出入金），twr/mwr 用当前序列最后一个值
    const totalReturn = mode === 'simple'
      ? (rangeSummary.gainPct != null ? rangeSummary.gainPct : (accountReturns[accountReturns.length - 1] || 0))
      : (accountReturns[accountReturns.length - 1] || 0);
    // 金额收益与模式无关，必须使用原始 NAV 序列（history）计算，不能用收益率序列
    const rawNavSeries = range === 'custom' && customNavStart
      ? (data.history?.navAll || []).filter((h) => h.date >= customNavStart && (!customNavEnd || h.date <= customNavEnd))
      : (data.history?.[range] || data.history?.navAll || []);
    const totalReturnMoney = rangeSummary.gain != null
      ? rangeSummary.gain
      : (rawNavSeries.length ? (rawNavSeries[rawNavSeries.length - 1].nav - rawNavSeries[0].nav) : 0);

    const stats = {
      days: series.length,
      totalReturn,
      totalReturnMoney,
    };

    BENCH_META.forEach((bm) => {
      const vals = benchSeries[bm.key];
      if (vals) {
        const lastValid = vals.filter((v) => v != null).pop();
        stats[bm.key] = lastValid ?? 0;
      }
    });

    return { labels, accountReturns, benchSeries, stats };
  }, [series, data, range, mode, customNavStart, customNavEnd]);

  if (!series.length) {
    return <div className="py-10 text-center text-sm text-[var(--gray)]">暂无净值数据</div>;
  }

  const echartsSeries = [
    {
      name: '我的账户',
      type: 'line',
      data: accountReturns,
      smooth: false,
      showSymbol: false,
      lineStyle: { color: '#000000', width: 3 },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(0,0,0,0.08)' },
            { offset: 1, color: 'rgba(0,0,0,0)' },
          ],
        },
      },
      z: 10,
    },
  ];

  BENCH_META.forEach((bm) => {
    const vals = benchSeries[bm.key];
    if (!vals || hiddenBenches.has(bm.key)) return;
    echartsSeries.push({
      name: bm.label,
      type: 'line',
      data: vals,
      smooth: false,
      showSymbol: false,
      connectNulls: true,
      lineStyle: { color: bm.color, width: 1.5, type: [4, 4] },
      z: 5,
    });
  });

  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30,30,30,0.92)',
      borderColor: '#333',
      textStyle: { color: '#fff' },
      axisPointer: { type: 'line', lineStyle: { color: '#999', width: 1, type: 'dashed' } },
      formatter: (params) => {
        let html = `<div style="font-weight:600;margin-bottom:4px;">${params[0].axisValue}</div>`;
        params.forEach((p) => {
          const val = p.value;
          if (val == null) return;
          const sign = val >= 0 ? '+' : '';
          html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};"></span>
            <span style="flex:1;">${p.seriesName}:</span>
            <span style="font-weight:600;">${sign}${fmtNum(val, 2)}%</span>
          </div>`;
        });
        return html;
      },
    },
    legend: { show: false },
    grid: { left: '2%', right: '3%', bottom: '3%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#666', formatter: (v) => v.slice(5) },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v) => (v >= 0 ? '+' : '') + fmtNum(v, 1) + '%',
        color: '#666',
      },
      splitLine: { lineStyle: { color: '#f0f0f0' } },
    },
    series: echartsSeries.map((s) => ({
      ...s,
      markLine: s.name === '我的账户' ? {
        symbol: 'none',
        data: [{ yAxis: 0, lineStyle: { color: '#000', width: 2 }, label: { show: false } }],
        animation: false,
      } : undefined,
    })),
  };

  const returnPositive = stats.totalReturn >= 0;

  return (
    <div className="rounded-xl border border-[var(--light-gray)] bg-white p-6">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="text-lg font-semibold">净值历史趋势</div>

        <div className="flex flex-col gap-3 md:items-end">
          {/* Top controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 text-sm text-[var(--gray)]">
              <span>收益:</span>
              {MODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    mode === m.key
                      ? 'bg-black text-white'
                      : 'bg-[var(--lighter-gray)] text-[var(--gray)] hover:bg-[var(--light-gray)]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-[var(--light-gray)]" />

            <div className="flex flex-wrap items-center gap-2">
              {BENCH_META.map((bm) => {
                const hasData = !!benchSeries[bm.key];
                const hidden = hiddenBenches.has(bm.key);
                if (!hasData) return null;
                return (
                  <button
                    key={bm.key}
                    onClick={() => toggleBench(bm.key)}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                      hidden
                        ? 'border-[var(--light-gray)] bg-white text-[var(--gray)] opacity-60'
                        : 'border-transparent bg-[var(--lighter-gray)] text-black'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: bm.color }} />
                    <span>{bm.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary text */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[var(--gray)]">{stats.days} 个交易日</span>
            <span className={returnPositive ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
              {returnPositive ? '+' : ''}
              {fmtCur(stats.totalReturnMoney)}
            </span>
            <span className={returnPositive ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
              ({returnPositive ? '+' : ''}
              {fmtNum(stats.totalReturn, 2)}%)
            </span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-80">
        <ECharts option={option} style={{ height: '100%' }} />
      </div>

      {/* Bottom stat cards */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <div className="rounded-lg border border-[var(--light-gray)] p-3 text-center">
          <div className="mb-1 flex items-center justify-center gap-1.5 text-xs font-medium">
            <span className="h-2 w-2 rounded-full bg-black" />
            我的账户 · {MODES.find((m) => m.key === mode)?.label}
          </div>
          <div className={`text-sm font-bold ${returnPositive ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
            {returnPositive ? '+' : ''}
            {fmtNum(stats.totalReturn, 2)}%
          </div>
        </div>

        {BENCH_META.map((bm) => {
          const val = stats[bm.key];
          if (val == null) return null;
          const positive = val >= 0;
          return (
            <div key={bm.key} className="rounded-lg border border-[var(--light-gray)] p-3 text-center">
              <div className="mb-1 flex items-center justify-center gap-1.5 text-xs font-medium">
                <span className="h-2 w-2 rounded-full" style={{ background: bm.color }} />
                {bm.label}
              </div>
              <div className={`text-sm font-bold ${positive ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                {positive ? '+' : ''}
                {fmtNum(val, 2)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
