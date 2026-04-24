import { useState } from 'react';
import { useDashboardStore } from '../../stores/dashboardStore';
import { fmtCur, fmtPct, fmtNum, convertCurrency, parseDate } from '../../utils/format';
import { useEquitySeries } from '../../hooks/useEquitySeries';
import { getCustomRangeSummary } from '../../utils/navRange';
import NavChart from '../NavChart';
import DailyPLChart from '../DailyPLChart';
import MonthlyChart from '../MonthlyChart';
import ECharts from '../ECharts';
import FxExposurePanel from '../FxExposurePanel';
import SlbIncomePanel from '../SlbIncomePanel';
import EnhancedCashflowPanel from '../EnhancedCashflowPanel';
import DividendTracker from '../DividendTracker';

const RANGES = [
  { key: 'nav1Week', label: '1周' },
  { key: 'navMTD', label: '本月迄今' },
  { key: 'nav1Month', label: '1个月' },
  { key: 'nav3Months', label: '3个月' },
  { key: 'navYTD', label: '本年迄今' },
  { key: 'nav1Year', label: '1年' },
  { key: 'navAll', label: '全部' },
  { key: 'custom', label: '自定义' },
];

function HeroMiniChart({ data, range, isPerformance, gainPct }) {
  const series = useEquitySeries(data, range);
  if (!series.length) return null;
  const labels = series.map((s) => s.date.toISOString().slice(0, 10));
  const baseValue = series[0].value || 1;
  const values = isPerformance
    ? series.map((s, i) => {
        // 如果后端提供了精确的区间收益百分比，用最后一个点的值对齐它，避免与 Hero 大数字不一致
        if (i === series.length - 1 && gainPct != null) return gainPct;
        return ((s.value / baseValue) - 1) * 100;
      })
    : series.map((s) => s.value);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0,0,0,0.7)',
      borderColor: '#333',
      textStyle: { color: '#fff' },
      formatter: (params) => {
        const p = params[0];
        const valText = isPerformance
          ? `${(p.value >= 0 ? '+' : '') + fmtNum(p.value, 2)}%`
          : fmtCur(p.value);
        return `<div style="font-weight:600;">${p.axisValue}</div><div>${valText}</div>`;
      },
    },
    grid: { left: 0, right: 0, top: 8, bottom: 8 },
    xAxis: { type: 'category', data: labels, show: false, boundaryGap: false },
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'line',
      data: values,
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#ffffff', width: 2 },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(255,255,255,0.15)' },
            { offset: 1, color: 'rgba(255,255,255,0)' },
          ],
        },
      },
    }],
  };
  return <ECharts option={option} style={{ height: '100%' }} />;
}

export default function OverviewTab() {
  const data = useDashboardStore((s) => s.data);
  const currentNavRange = useDashboardStore((s) => s.currentNavRange);
  const setCurrentNavRange = useDashboardStore((s) => s.setCurrentNavRange);
  const customNavStart = useDashboardStore((s) => s.customNavStart);
  const setCustomNavStart = useDashboardStore((s) => s.setCustomNavStart);
  const customNavEnd = useDashboardStore((s) => s.customNavEnd);
  const setCustomNavEnd = useDashboardStore((s) => s.setCustomNavEnd);
  const currentCurrency = useDashboardStore((s) => s.currentCurrency);
  const setCurrentCurrency = useDashboardStore((s) => s.setCurrentCurrency);
  const [heroTab, setHeroTab] = useState('value');

  if (!data) return <div className="py-10 text-center text-[var(--gray)]">暂无数据</div>;

  const summary = data.summary || {};
  const baseCurrency = data.baseCurrency || 'BASE';
  const displayCurrency = currentCurrency === 'BASE' ? baseCurrency : currentCurrency;
  const fxRates = data.fxRates || {};

  const totalNav = convertCurrency(summary.totalNav || 0, displayCurrency, baseCurrency, fxRates);
  const totalGain = convertCurrency(summary.totalGain || 0, displayCurrency, baseCurrency, fxRates);
  const totalGainPct = summary.totalGainPct || 0;
  const bb = data.balanceBreakdown || {};

  const cashRaw = bb.cashByCurrency || data.cashReport || [];
  const cashArr = cashRaw
    .map((c) => ({ ...c, cash: c.cash != null && Math.abs(Number(c.cash)) >= 0.01 ? Number(c.cash) : null }))
    .filter((c) => c.cash != null);

  const equitySeries = useEquitySeries(data, currentNavRange);
  const rangeSummary =
    currentNavRange === 'custom' && customNavStart
      ? getCustomRangeSummary(data, customNavStart, customNavEnd)
      : (data.rangeSummaries?.[currentNavRange] || {});
  const perfPct = rangeSummary.gainPct != null
    ? rangeSummary.gainPct
    : (equitySeries.length && (equitySeries[0].value || 0) !== 0
        ? (((equitySeries[equitySeries.length - 1].value / equitySeries[0].value) - 1) * 100)
        : 0);
  const rangeTotalGain = rangeSummary.gain != null
    ? convertCurrency(rangeSummary.gain, displayCurrency, baseCurrency, fxRates)
    : (equitySeries.length
        ? convertCurrency(equitySeries[equitySeries.length - 1].value - equitySeries[0].value, displayCurrency, baseCurrency, fxRates)
        : 0);
  const rangeNetFlow = rangeSummary.netFlow != null
    ? convertCurrency(rangeSummary.netFlow, displayCurrency, baseCurrency, fxRates)
    : null;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="rounded-xl bg-black p-6 text-white lg:p-8">
        {/* Mode tabs */}
        <div className="mb-4 inline-flex border-b border-white/20">
          <button
            onClick={() => setHeroTab('value')}
            className={`relative px-4 py-2 text-base font-medium transition ${heroTab === 'value' ? 'text-white' : 'text-white/50 hover:text-white/80'}`}
          >
            价值
            {heroTab === 'value' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />}
          </button>
          <button
            onClick={() => setHeroTab('performance')}
            className={`relative px-4 py-2 text-base font-medium transition ${heroTab === 'performance' ? 'text-white' : 'text-white/50 hover:text-white/80'}`}
          >
            业绩
            {heroTab === 'performance' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />}
          </button>
        </div>

        {/* Label */}
        <div className="mb-1 text-sm text-white/60">
          {heroTab === 'value' ? '账户总净值' : '账户收益率'} ({data.accountId || '--'}) {data.asOfDate ? `截止 ${data.asOfDate}` : ''}
        </div>

        {/* Currency toggle */}
        {heroTab === 'value' && (
          <div className="mb-3 flex gap-2">
            {Array.from(new Set([baseCurrency, 'USD', 'CNH'])).map((c) => {
              const isBase = c === baseCurrency;
              const active = currentCurrency === c || (currentCurrency === 'BASE' && isBase);
              return (
                <button
                  key={c}
                  onClick={() => setCurrentCurrency(isBase ? 'BASE' : c)}
                  className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                    active
                      ? 'border-white bg-white text-black'
                      : 'border-white/30 text-white/70 hover:border-white hover:text-white'
                  }`}
                >
                  {c}
                </button>
                
              );
            })}
          </div>
        )}

        {/* Value / Performance */}
        {heroTab === 'value' ? (
          <div className="text-4xl font-bold tracking-tight lg:text-5xl">{fmtCur(totalNav, displayCurrency)}</div>
        ) : (
          <div className={`text-4xl font-bold tracking-tight lg:text-5xl ${perfPct >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
            {perfPct >= 0 ? '+' : ''}{fmtNum(perfPct, 2)}%
          </div>
        )}

        {/* Change */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-base">
          {heroTab === 'value' && (
            <span className={rangeTotalGain >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
              {rangeTotalGain >= 0 ? '+' : ''}{fmtCur(rangeTotalGain, displayCurrency)}
            </span>
          )}
          <span className={perfPct >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
            {(perfPct >= 0 ? '+' : '') + fmtNum(perfPct, 2)}%
          </span>
          <span className="text-white/60">
            {currentNavRange === 'custom' && customNavStart
              ? `${customNavStart} ~ ${customNavEnd || '今'}`
              : (RANGES.find((r) => r.key === currentNavRange)?.label || '全部时间')}
          </span>
        </div>
        {rangeNetFlow && Math.abs(rangeNetFlow) > 0.01 && (
          <div className="mt-1 text-xs text-white/50">
            区间净入金 {(rangeNetFlow >= 0 ? '+' : '')}{fmtCur(rangeNetFlow, displayCurrency)}（已扣除）
          </div>
        )}

        {/* Mini chart */}
        <div className="mt-4 h-40 w-full lg:h-52">
          <HeroMiniChart data={data} range={currentNavRange} isPerformance={heroTab === 'performance'} gainPct={rangeSummary.gainPct} />
        </div>

        {/* Range buttons */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => {
                if (r.key === 'custom') {
                  const defaultStart = new Date();
                  defaultStart.setDate(defaultStart.getDate() - 30);
                  const startStr = defaultStart.toISOString().slice(0, 10);
                  const endStr = data.asOfDate || new Date().toISOString().slice(0, 10);
                  if (!customNavStart) setCustomNavStart(startStr);
                  if (!customNavEnd) setCustomNavEnd(endStr);
                }
                setCurrentNavRange(r.key);
              }}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                currentNavRange === r.key
                  ? 'border-white bg-white text-black'
                  : 'border-white/20 bg-white/10 text-white hover:border-white/40'
              }`}
            >
              {r.label}
            </button>
          ))}
          {currentNavRange === 'custom' && (
            <>
              <input
                type="date"
                value={customNavStart || ''}
                max={customNavEnd || data.asOfDate || new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomNavStart(v);
                  if (customNavEnd && v > customNavEnd) {
                    setCustomNavEnd(v);
                  }
                }}
                className="rounded-md border border-white/30 bg-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white"
              />
              <span className="text-xs text-white/60">~</span>
              <input
                type="date"
                value={customNavEnd || ''}
                min={customNavStart || ''}
                max={data.asOfDate || new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomNavEnd(v);
                  if (customNavStart && v < customNavStart) {
                    setCustomNavStart(v);
                  }
                }}
                className="rounded-md border border-white/30 bg-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white"
              />
            </>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: '最新净值', value: fmtCur(totalNav, displayCurrency) },
          { label: '股票市值', value: fmtCur(convertCurrency(summary.stocks || 0, displayCurrency, baseCurrency, fxRates), displayCurrency) },
          { label: 'ETF 市值', value: fmtCur(convertCurrency(summary.etfs || 0, displayCurrency, baseCurrency, fxRates), displayCurrency) },
          { label: '期权市值', value: fmtCur(convertCurrency(summary.options || 0, displayCurrency, baseCurrency, fxRates), displayCurrency) },
          { label: '现金', value: fmtCur(convertCurrency(summary.cash || 0, displayCurrency, baseCurrency, fxRates), displayCurrency) },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-[var(--light-gray)] p-6 transition hover:border-black hover:shadow-md">
            <div className="mb-2 text-sm text-[var(--gray)]">{k.label}</div>
            <div className="text-2xl font-bold">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Nav Chart full card */}
      <NavChart data={data} range={currentNavRange} />

      {/* Daily PL + Monthly */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--light-gray)] p-6">
          <div className="mb-4 text-lg font-semibold">每日盈亏曲线</div>
          <DailyPLChart data={data} range={currentNavRange} />
        </div>
        <div className="rounded-xl border border-[var(--light-gray)] p-6">
          <div className="mb-4 text-lg font-semibold">月度收益柱状图</div>
          <MonthlyChart data={data} range={currentNavRange} />
        </div>
      </div>

      {/* Balance Breakdown */}
      <div className="rounded-xl border border-[var(--light-gray)] p-6">
        <div className="mb-4 text-lg font-semibold">账户余额明细</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { label: '净清算值', value: bb.netLiquidation },
            { label: '未实现盈亏', value: bb.unrealizedPnl },
            { label: '已实现盈亏', value: bb.realizedPnl },
            { label: '总现金', value: bb.totalCash },
            { label: '已结算现金', value: bb.settledCash },
            { label: '股票市值', value: bb.stockValue },
            { label: 'ETF 市值', value: bb.etfValue },
            { label: '期权市值', value: bb.optionValue },
            { label: '基金市值', value: bb.fundValue },
            { label: '债券市值', value: bb.bondValue },
            { label: '大宗商品', value: bb.commodityValue },
            { label: '应计股息', value: bb.dividendAccruals },
            { label: '应计利息', value: bb.interestAccruals },
          ]
            .filter((x) => x.value != null && !isNaN(Number(x.value)))
            .map((x) => {
              const num = convertCurrency(Number(x.value), displayCurrency, baseCurrency, fxRates);
              return (
                <div key={x.label} className="rounded-lg border border-[var(--light-gray)] p-3">
                  <div className="text-xs text-[var(--gray)]">{x.label}</div>
                  <div className={`text-lg font-bold ${num >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                    {fmtCur(num, displayCurrency)}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Cash by Currency */}
      <div className="rounded-xl border border-[var(--light-gray)] p-6">
        <div className="mb-4 text-lg font-semibold">各币种现金占比</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                <th className="py-2">币种</th>
                <th className="py-2">现金 (折算)</th>
                <th className="py-2">现金 (原币种)</th>
                <th className="py-2">现金占比</th>
              </tr>
            </thead>
            <tbody>
              {cashArr.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-sm text-[var(--gray)]">暂无现金数据</td>
                </tr>
              )}
              {cashArr.map((c) => {
                const pct = c.ratio != null ? c.ratio : 0;
                return (
                  <tr key={c.currency} className="border-b border-[var(--lighter-gray)]">
                    <td className="py-2 font-medium">{c.currency || '-'}</td>
                    <td className="py-2">{fmtCur(convertCurrency(c.cash, displayCurrency, baseCurrency, fxRates), displayCurrency)}</td>
                    <td className="py-2 text-xs text-[var(--gray)]">{fmtCur(c.cash, c.currency)}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded bg-[#f0f0f0]">
                          <div className="h-full rounded bg-black" style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className="text-xs">{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Professional Dashboard Modules */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 资产增长归因 */}
        <div className="rounded-xl border border-[var(--light-gray)] p-6 lg:col-span-2">
          <div className="mb-4 text-lg font-semibold">资产增长归因</div>
          {(() => {
            const cn = data.changeInNav || {};
            const start = Number(cn.startingValue) || 0;
            const realized = Number(cn.realized) || 0;
            const mtm = Number(cn.mtm) || 0;
            const dividends = Number(cn.dividends) || 0;
            const interest = Number(cn.interest) || 0;
            const fx = Number(cn.fxTranslation) || 0;
            const commissions = Number(cn.commissions) || 0;
            const end = Number(cn.endingValue) || 0;

            const categories = ['起始净值', '已实现盈亏', 'MTM', '股息', '利息', '外汇折算', '佣金费用', '结束净值'];
            const values = [start, realized, mtm, dividends, interest, fx, commissions, end];
            const helper = [0];
            let cum = start;
            for (let i = 1; i < values.length - 1; i++) {
              helper.push(cum);
              cum += values[i];
            }
            helper.push(0);

            const posColor = 'var(--success)';
            const negColor = 'var(--danger)';
            const totalColor = '#3b82f6';

            const option = {
              tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
                const p = params.find((x) => x.seriesIndex === 1);
                if (!p) return '';
                return `${p.name}<br/>${fmtCur(p.value, displayCurrency)}`;
              } },
              grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
              xAxis: { type: 'category', data: categories },
              yAxis: { type: 'value', axisLabel: { formatter: (v) => fmtCur(v, displayCurrency) } },
              series: [
                {
                  type: 'bar',
                  stack: 'Total',
                  itemStyle: { borderColor: 'transparent', color: 'transparent' },
                  emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } },
                  data: helper,
                },
                {
                  type: 'bar',
                  stack: 'Total',
                  data: values,
                  itemStyle: {
                    color: (params) => {
                      if (params.dataIndex === 0) return '#64748b';
                      if (params.dataIndex === values.length - 1) return totalColor;
                      const v = values[params.dataIndex];
                      return v >= 0 ? posColor : negColor;
                    },
                  },
                },
              ],
            };
            return <ECharts option={option} style={{ height: 360 }} />;
          })()}
        </div>

        {/* 月度资金流水瀑布 */}
        <div className="rounded-xl border border-[var(--light-gray)] p-6">
          <div className="mb-4 text-lg font-semibold">月度资金流水瀑布</div>
          {(() => {
            const wf = (data.cashflowWaterfall || []).slice(0, 10);
            if (wf.length === 0) return <div className="py-10 text-center text-[var(--gray)]">暂无数据</div>;
            const descriptions = wf.map((i) => i.description);
            const nets = wf.map((i) => Number(i.net) || 0);
            const option = {
              tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
              grid: { left: '3%', right: '8%', bottom: '3%', containLabel: true },
              xAxis: { type: 'value', axisLabel: { formatter: (v) => fmtCur(v, displayCurrency) } },
              yAxis: { type: 'category', data: descriptions.reverse(), axisLabel: { width: 140, overflow: 'truncate' } },
              series: [
                {
                  type: 'bar',
                  data: nets.reverse(),
                  itemStyle: {
                    color: (params) => {
                      const v = nets[params.dataIndex];
                      return v >= 0 ? 'var(--success)' : 'var(--danger)';
                    },
                  },
                },
              ],
            };
            return <ECharts option={option} style={{ height: 360 }} />;
          })()}
        </div>

        {/* 杠杆 & 资金效率 */}
        <div className="rounded-xl border border-[var(--light-gray)] p-6">
          <div className="mb-4 text-lg font-semibold">杠杆 & 资金效率</div>
          {(() => {
            const lm = data.leverageMetrics || {};
            const hasData = (lm.netLiquidation || 0) !== 0;
            if (!hasData) return <div className="py-10 text-center text-[var(--gray)]">暂无杠杆数据</div>;
            const stats = [
              { label: '净资产', value: fmtCur(lm.netLiquidation, displayCurrency) },
              { label: '股票市值', value: fmtCur(lm.stockMarketValue, displayCurrency) },
              { label: '杠杆率', value: `${fmtNum(lm.leverageRatio, 2)}x` },
              { label: '累计利息成本', value: fmtCur(lm.totalInterestCost, displayCurrency), danger: Number(lm.totalInterestCost) > 0 },
              { label: '做空股数合计', value: fmtNum(lm.shortSharesTotal, 0) },
            ];
            return (
              <div className="grid grid-cols-2 gap-4">
                {stats.map((s) => (
                  <div key={s.label} className="rounded-lg border border-[var(--light-gray)] p-4">
                    <div className="mb-1 text-xs text-[var(--gray)]">{s.label}</div>
                    <div className={`text-xl font-bold ${s.danger ? 'text-[var(--danger)]' : ''}`}>{s.value}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* 风控预警 */}
        <div className="rounded-xl border border-[var(--light-gray)] p-6 lg:col-span-2">
          <div className="mb-4 text-lg font-semibold">风控预警</div>
          {(() => {
            const pa = data.positionAttribution || {};
            const conc = pa.concentration || {};
            const reb = (pa.rebalanceSignals || []).slice(0, 5);
            const m = data.metrics || {};
            const cr5 = Number(conc.cr5) || 0;
            const cr10 = Number(conc.cr10) || 0;
            const maxDd = Number(m.maxDrawdown) || 0;
            const lossMonths = Number(m.maxConsecutiveLossMonths) || 0;

            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-[var(--gray)]">持仓集中度 CR5:</span>
                  <span className="font-semibold">{fmtNum(cr5, 2)}%</span>
                  {cr5 > 20 && <span className="rounded bg-[var(--danger)] px-2 py-0.5 text-xs text-white">高度集中</span>}
                  <span className="mx-2 hidden text-[var(--light-gray)] sm:inline">|</span>
                  <span className="text-sm text-[var(--gray)]">CR10:</span>
                  <span className="font-semibold">{fmtNum(cr10, 2)}%</span>
                  <span className="mx-2 hidden text-[var(--light-gray)] sm:inline">|</span>
                  <span className="text-sm text-[var(--gray)]">最大回撤:</span>
                  <span className="font-semibold">{fmtNum(maxDd, 2)}%</span>
                  {maxDd > 20 && <span className="rounded bg-[var(--danger)] px-2 py-0.5 text-xs text-white">警告</span>}
                  <span className="mx-2 hidden text-[var(--light-gray)] sm:inline">|</span>
                  <span className="text-sm text-[var(--gray)]">连续亏损月数:</span>
                  <span className="font-semibold">{lossMonths}</span>
                  {lossMonths >= 3 && <span className="rounded bg-[var(--danger)] px-2 py-0.5 text-xs text-white">警告</span>}
                </div>

                {reb.length > 0 && (
                  <div>
                    <div className="mb-2 text-sm font-medium">再平衡信号</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                            <th className="py-2">标的</th>
                            <th className="py-2">当前权重</th>
                            <th className="py-2">目标权重</th>
                            <th className="py-2">偏离</th>
                            <th className="py-2">建议</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reb.map((r, idx) => (
                            <tr key={idx} className="border-b border-[var(--lighter-gray)]">
                              <td className="py-2 font-medium">{r.symbol}</td>
                              <td className="py-2">{fmtPct(Number(r.currentWeight) / 100)}</td>
                              <td className="py-2">{fmtPct(Number(r.targetWeight) / 100)}</td>
                              <td className="py-2">{fmtPct(Number(r.deviation) / 100)}</td>
                              <td className="py-2">
                                <span className={`rounded px-2 py-0.5 text-xs text-white ${r.action === '减持' ? 'bg-[var(--danger)]' : 'bg-[var(--success)]'}`}>
                                  {r.action}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--light-gray)] p-5">
          <FxExposurePanel data={data} />
        </div>
        <div className="rounded-xl border border-[var(--light-gray)] p-5">
          <SlbIncomePanel data={data} />
        </div>
        <div className="rounded-xl border border-[var(--light-gray)] p-5 lg:col-span-2">
          <EnhancedCashflowPanel data={data} />
        </div>
        <div className="rounded-xl border border-[var(--light-gray)] p-5">
          <DividendTracker data={data} />
        </div>
      </div>
    </div>
  );
}
