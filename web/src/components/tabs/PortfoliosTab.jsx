import { Fragment, useEffect, useMemo, useState } from 'react';
import { Plus, X, Edit2, Trash2, Wallet, ArrowUp, ArrowDown, PieChart, ChevronRight, ChevronDown as ChevronDownIcon, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import ECharts from '../ECharts';
import { useDashboardStore } from '../../stores/dashboardStore';
import { api } from '../../api';
import ChengjiTab from './ChengjiTab';

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#6b7280'];

function cn(...args) { return args.filter(Boolean).join(' '); }

const STRATEGY_OPTIONS = [
  { value: '', label: '自动识别（默认）' },
  { value: 'wheel_csp', label: '🎡 轮子 - 现金担保 PUT' },
  { value: 'wheel_cc', label: '🎡 轮子 - 备兑看涨' },
  { value: 'csp', label: '现金担保 PUT (CSP)' },
  { value: 'cc', label: '备兑看涨 (CC)' },
  { value: 'naked_put', label: '裸卖 PUT' },
  { value: 'naked_call', label: '裸卖看涨' },
  { value: 'protective_put', label: '保护性看跌' },
  { value: 'leaps_call', label: 'LEAPS 看涨' },
  { value: 'leaps_put', label: 'LEAPS 看跌' },
  { value: 'long_call', label: '看涨投机' },
  { value: 'long_put', label: '看跌投机' },
  { value: 'bull_put_spread', label: '牛市看跌价差' },
  { value: 'bear_call_spread', label: '熊市看涨价差' },
  { value: 'bull_call_spread', label: '牛市看涨价差' },
  { value: 'bear_put_spread', label: '熊市看跌价差' },
  { value: 'iron_condor', label: '铁鹰' },
  { value: 'iron_butterfly', label: '铁蝶' },
  { value: 'collar', label: '领口' },
  { value: 'synthetic_long', label: '合成多头' },
  { value: 'synthetic_short', label: '合成空头' },
];

const STRATEGY_ICON = {
  csp: '🔄', naked_put: '⚠️', cc: '🛡️', naked_call: '⚠️',
  protective_put: '🛡️', leaps_call: '🚀', leaps_put: '🪂',
  long_call: '📈', long_put: '📉',
  bull_put_spread: '💰', bear_call_spread: '💰',
  bull_call_spread: '💸', bear_put_spread: '💸',
  iron_condor: '🦋', iron_butterfly: '🦋',
  straddle_long: '⚡', straddle_short: '⚡',
  strangle_long: '⚡', strangle_short: '⚡',
  collar: '🔒', synthetic_long: '🔁', synthetic_short: '🔁',
  calendar: '📅', unknown: '❓',
  wheel: '🎡',
};
const STRATEGY_ORDER = [
  'cc', 'csp', 'collar', 'protective_put',
  'bull_put_spread', 'bear_call_spread', 'bull_call_spread', 'bear_put_spread',
  'iron_condor', 'iron_butterfly',
  'leaps_call', 'leaps_put', 'long_call', 'long_put',
  'straddle_long', 'strangle_long', 'straddle_short', 'strangle_short',
  'synthetic_long', 'synthetic_short',
  'naked_put', 'naked_call', 'unknown',
];
function fmtContract(sym) {
  const m = (sym || '').match(/^([A-Z.]+)\s+(\d{6})([CP])(\d{8})$/);
  if (!m) return sym;
  const [, , ymd, pc, strikeRaw] = m;
  const strike = parseInt(strikeRaw, 10) / 1000;
  return `${ymd.slice(2,4)}/${ymd.slice(4,6)} ${pc}${strike}`;
}

function PortfoliosDonut({ portfolios, uncategorized, totalNav, activeId, onSelect }) {
  const data = portfolios.map(p => ({
    value: Math.max(0, p.currentValue || 0),
    name: p.name,
    id: p.id,
    itemStyle: { color: p.color },
    raw: p,
  }));
  const uncatTotal = (uncategorized || []).reduce((s, u) => s + (u.currentValue || 0), 0);
  if (uncatTotal > 0) {
    data.push({ value: uncatTotal, name: '未分类', id: '__uncat__', itemStyle: { color: '#cbd5e1' } });
  }
  const option = {
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const pct = totalNav > 0 ? (p.value / totalNav * 100).toFixed(2) : 0;
        return `<b>${p.name}</b><br/>$${Number(p.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}<br/>占总 NAV ${pct}%`;
      },
    },
    series: [{
      type: 'pie',
      radius: ['58%', '82%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      emphasis: { scaleSize: 6, label: { show: true, fontSize: 11, fontWeight: 'bold', formatter: '{b}\n{d}%' } },
      labelLine: { show: false },
      data: data.map(d => ({ ...d, selected: d.id === activeId })),
    }],
    graphic: [{
      type: 'group', left: 'center', top: 'center', children: [
        { type: 'text', style: { text: '总 NAV', fill: '#94a3b8', font: '10px sans-serif', textAlign: 'center' }, top: -10 },
        { type: 'text', style: { text: '$' + (totalNav || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }), fill: '#0f172a', font: 'bold 14px sans-serif', textAlign: 'center' }, top: 5 },
      ]
    }],
  };
  return (
    <div className="mb-4">
      <ECharts
        option={option}
        style={{ height: 200, width: '100%' }}
        onEvents={{
          click: (params) => {
            const id = params.data?.id;
            if (id && id !== '__uncat__') onSelect(id);
          },
        }}
      />
    </div>
  );
}

function RebalanceCard({ advice, portfolios }) {
  const [sellModal, setSellModal] = useState(null);
  if (!advice || !advice.items || advice.items.length === 0) return null;

  function topUnderlying(portfolioId) {
    const p = (portfolios || []).find(x => x.id === portfolioId);
    if (!p) return null;
    // 优先该组合内最大持仓的 underlying（股票/ETF），找不到 fallback
    const sorted = (p.holdings || [])
      .filter(h => (h.assetClass === 'STOCK' || h.assetClass === 'STK' || h.assetClass === 'ETF') && h.symbol !== '__CASH__')
      .sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0));
    return sorted[0]?.symbol || null;
  }
  function sellableHoldings(portfolioId) {
    const p = (portfolios || []).find(x => x.id === portfolioId);
    if (!p) return [];
    return (p.holdings || [])
      .filter(h => h.symbol !== '__CASH__' && (h.currentValue || 0) > 0)
      .sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0));
  }

  return (
    <>
      <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">💡</span>
          <h4 className="font-medium text-blue-900">再平衡建议</h4>
          <span className="ml-auto text-xs text-blue-700">总偏离 {fmtMoney(advice.totalGap)}</span>
        </div>
        <div className="space-y-1.5">
          {advice.items.map((it) => {
            const ticker = topUnderlying(it.portfolioId);
            const buyUrl = ticker
              ? `https://us-options.moneych.top/options/us?ticker=${encodeURIComponent(ticker)}`
              : 'https://us-options.moneych.top';
            return (
              <div key={it.portfolioId} className="flex items-center gap-2 text-sm">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: it.color }} />
                <span className="font-medium flex-1 truncate">{it.portfolioName}</span>
                <span className="text-xs text-gray-500 hidden md:inline">现 {fmtMoney(it.currentValue)} / 目标 {fmtMoney(it.targetValue)}</span>
                {it.action === 'buy' ? (
                  <a
                    href={buyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 font-mono whitespace-nowrap hover:underline"
                    title={ticker ? `去 us-options 卖 ${ticker} PUT 收权利金加仓` : '去 us-options 选标的卖 PUT 加仓'}
                  >
                    <TrendingUp size={12} className="inline" /> 加仓 {fmtMoney(Math.abs(it.gap))} {ticker ? `(${ticker})` : ''} ↗
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSellModal({ portfolio: it, holdings: sellableHoldings(it.portfolioId) })}
                    className="text-rose-700 font-mono whitespace-nowrap hover:underline"
                    title="点击查看该组合可减仓标的"
                  >
                    <TrendingDown size={12} className="inline" /> 减仓 {fmtMoney(Math.abs(it.gap))} →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {sellModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSellModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-[560px] max-w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">
                <TrendingDown size={16} className="inline mr-1 text-rose-600" />
                减仓建议：{sellModal.portfolio.portfolioName}
              </h3>
              <button onClick={() => setSellModal(null)}><X size={18} /></button>
            </div>
            <div className="text-sm text-gray-600 mb-3">
              建议减仓 <b className="text-rose-700 font-mono">{fmtMoney(Math.abs(sellModal.portfolio.gap))}</b>
              （目前 {fmtMoney(sellModal.portfolio.currentValue)} → 目标 {fmtMoney(sellModal.portfolio.targetValue)}）。
              下表按市值降序，请去 IB 平台手动卖出（本工具不直连下单）。
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500 border-b">
                <tr>
                  <th className="p-2">Symbol</th>
                  <th className="p-2 text-right">市值</th>
                  <th className="p-2 text-right">建议减比</th>
                  <th className="p-2 text-right">建议减额</th>
                </tr>
              </thead>
              <tbody>
                {sellModal.holdings.slice(0, 15).map((h) => {
                  const targetSell = Math.abs(sellModal.portfolio.gap);
                  const totalValue = sellModal.holdings.reduce((s, x) => s + (x.currentValue || 0), 0);
                  const proportional = totalValue > 0 ? (h.currentValue / totalValue) * targetSell : 0;
                  return (
                    <tr key={h.symbol} className="border-b hover:bg-gray-50">
                      <td className="p-2 font-mono">{h.symbol}</td>
                      <td className="p-2 text-right">{fmtMoney(h.currentValue)}</td>
                      <td className="p-2 text-right text-gray-500">{fmtPct((proportional / h.currentValue) * 100, 1)}</td>
                      <td className="p-2 text-right font-mono text-rose-700">{fmtMoney(proportional)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="text-xs text-gray-400 mt-3">
              💡 提示：按市值比例减仓最简单。如果想优化税务（先卖亏损 / 长期持有），可以参考「税务」tab 的成本基础数据手动选择。
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RiskMetricsCard({ metrics }) {
  if (!metrics) return null;
  const items = [
    { key: 'annualizedReturn', label: '年化收益', suffix: '%', good: (v) => v > 0 },
    { key: 'annualizedVolatility', label: '年化波动率', suffix: '%', good: (v) => v < 30 },
    { key: 'sharpeRatio', label: '夏普比率', good: (v) => v > 1 },
    { key: 'sortinoRatio', label: '索提诺比率', good: (v) => v > 1 },
    { key: 'calmarRatio', label: '卡玛比率', good: (v) => v > 0.5 },
    { key: 'maxDrawdown', label: '最大回撤', suffix: '%', good: (v) => v > -20, isNeg: true },
  ];
  const has = items.some(i => metrics[i.key] != null);
  if (!has) return null;
  return (
    <div className="bg-indigo-50/40 border border-indigo-200 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">📐</span>
        <h4 className="font-medium text-indigo-900">账户级风险参数</h4>
        <span className="ml-auto text-[10px] text-indigo-700">基于全账户 NAV</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {items.map((it) => {
          const v = metrics[it.key];
          if (v == null) return null;
          const num = Number(v);
          const isGood = it.good ? it.good(num) : true;
          return (
            <div key={it.key} className="bg-white rounded p-2">
              <div className="text-gray-500 text-[10px]">{it.label}</div>
              <div className={cn('font-mono text-sm font-semibold', isGood ? 'text-emerald-700' : 'text-rose-700')}>
                {it.isNeg && num > 0 ? '-' : ''}{Math.abs(num).toFixed(2)}{it.suffix || ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConcentrationCard({ alerts }) {
  if (!alerts || alerts.length === 0) return null;
  return (
    <div className="bg-orange-50/60 border border-orange-200 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={16} className="text-orange-600" />
        <h4 className="font-medium text-orange-900">集中度风险</h4>
        <span className="ml-auto text-xs text-orange-700">{alerts.length} 项</span>
      </div>
      <div className="space-y-1.5 text-sm">
        {alerts.map((a, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className={cn('inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', a.level === 'high' ? 'bg-red-500' : 'bg-orange-400')} />
            <span className={a.level === 'high' ? 'text-red-700' : 'text-orange-800'}>{a.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WheelCyclesPanel() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.portfolioWheelCycles()
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!data || !data.underlyings || data.underlyings.length === 0) return null;
  return (
    <div className="mt-4 border border-violet-200 rounded-xl p-4 bg-violet-50/30">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">🎡</span>
        <h4 className="font-medium">Wheel 轮子追踪</h4>
        <span className="ml-auto text-xs">
          累计净盈亏 <b className={data.totalPnl >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{fmtMoney(data.totalPnl)}</b>
          {' · '}累计权利金 <b>{fmtMoney(data.totalPremium)}</b>
          {' · '}{data.totalAssignments} 次接股/交付
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="p-1">底层</th>
              <th className="p-1 text-right">期权权利金</th>
              <th className="p-1 text-right">股票已实现</th>
              <th className="p-1 text-right">合计</th>
              <th className="p-1 text-center" title="PUT 被指派接股">PUT 接股</th>
              <th className="p-1 text-center" title="PUT 到期作废">PUT 到期</th>
              <th className="p-1 text-center" title="CC 被行权交付">CC 行权</th>
              <th className="p-1 text-center" title="CC 到期作废">CC 到期</th>
              <th className="p-1 text-right">活跃天数</th>
            </tr>
          </thead>
          <tbody>
            {data.underlyings.map((u) => (
              <tr key={u.underlying} className="border-t hover:bg-white">
                <td className="p-1 font-mono font-medium">{u.underlying}</td>
                <td className={cn('p-1 text-right font-mono', u.optionPremium >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmtMoney(u.optionPremium)}</td>
                <td className={cn('p-1 text-right font-mono', u.stockRealizedPnl >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmtMoney(u.stockRealizedPnl)}</td>
                <td className={cn('p-1 text-right font-mono font-semibold', u.netPnl >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                  {fmtMoney(u.netPnl)}
                  {u.annualizedReturnPct != null && Math.abs(u.annualizedReturnPct) > 0.1 && (
                    <div className={cn('text-[10px] font-normal', u.annualizedReturnPct >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                      年化 {u.annualizedReturnPct > 0 ? '+' : ''}{u.annualizedReturnPct}%
                    </div>
                  )}
                </td>
                <td className="p-1 text-center">{u.putAssigned || '-'}</td>
                <td className="p-1 text-center text-gray-400">{u.putExpired || '-'}</td>
                <td className="p-1 text-center">{u.callAssigned || '-'}</td>
                <td className="p-1 text-center text-gray-400">{u.callExpired || '-'}</td>
                <td className="p-1 text-right text-gray-500">{u.durationDays}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-gray-400 mt-2">
        说明：合计 = 期权权利金 + 股票已实现盈亏。"PUT 接股"= 卖 PUT 被指派次数，"CC 行权"= 持股+卖 CC 被行权交付次数。
      </div>
    </div>
  );
}

function OptionPnlTimeline() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    api.portfolioOptionPnlTimeline()
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setErr(prettyErr(e)); });
    return () => { cancelled = true; };
  }, []);
  if (err) return null;
  if (!data) return <div className="text-xs text-gray-400 mt-4">加载期权 PnL 时间线…</div>;
  const months = data.months || [];
  if (months.length === 0) return null;

  const months24 = months.slice(-24);
  const xData = months24.map(m => `${m.month.slice(2,4)}/${m.month.slice(4,6)}`);
  const yData = months24.map(m => ({
    value: m.premiumIncome,
    itemStyle: { color: m.premiumIncome >= 0 ? '#10b981' : '#f43f5e', borderRadius: m.premiumIncome >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] },
  }));
  const monthOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = params[0];
        const m = months24[p.dataIndex];
        const sign = p.value >= 0 ? '+' : '';
        return `<b>20${m.month.slice(0,2)}-${m.month.slice(2,4)}-${m.month.slice(4,6).padEnd(2,'0')}</b><br/>权利金净流入 ${sign}$${Number(p.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}<br/>${m.tradeCount} 笔交易`;
      },
    },
    grid: { left: 50, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: xData, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => '$' + (v / 1000).toFixed(0) + 'k', fontSize: 10 } },
    series: [{ type: 'bar', data: yData, barWidth: '60%' }],
    dataZoom: months24.length > 12 ? [{ type: 'inside', start: 50, end: 100 }] : undefined,
  };

  return (
    <div className="mt-4 border rounded-xl p-4 bg-gray-50/40">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">📊</span>
        <h4 className="font-medium">期权月度权利金净流入</h4>
        <span className="ml-auto text-xs">
          累计 <span className={data.totalPremiumIncome >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{fmtMoney(data.totalPremiumIncome)}</span>
        </span>
      </div>
      <ECharts option={monthOption} style={{ height: 220, width: '100%' }} />
      {(data.byUnderlying || []).length > 0 && (
        <div className="mt-4 pt-3 border-t">
          <div className="text-xs text-gray-500 mb-2">按底层 Top 10（累计权利金）</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            {data.byUnderlying.slice(0, 10).sort((a,b)=>b.premiumIncome-a.premiumIncome).map((u) => (
              <div key={u.underlying} className="bg-white border rounded p-2">
                <div className="font-mono font-medium">{u.underlying}</div>
                <div className={cn('font-mono', u.premiumIncome >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                  {fmtMoney(u.premiumIncome)}
                </div>
                <div className="text-gray-400">{u.tradeCount} 笔</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="text-[10px] text-gray-400 mt-3">说明：权利金净流入 = 卖期权收入 - 买入/平仓花费。这是 wheel/CSP 用户最关心的"已实现现金流"指标（你的 IB Flex 没 export FIFO PnL 字段，所以用净权利金代替）。</div>
    </div>
  );
}

function prettyErr(e) {
  if (e?.body) {
    try {
      const parsed = JSON.parse(e.body);
      if (parsed?.error) return parsed.error;
    } catch {}
  }
  return e?.message || '未知错误';
}
function fmtMoney(v, digits = 0) {
  const n = Number(v || 0);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function fmtPct(v, digits = 2) {
  return v == null ? '-' : Number(v).toFixed(digits) + '%';
}

const AUTO_RULES = [
  { value: '', label: '— 不自动归类（纯手动）—' },
  { value: 'etf_funds', label: '所有 ETF / 基金（自动）' },
  { value: 'stocks', label: '所有个股（自动）' },
  { value: 'options', label: '所有期权（自动）' },
];

function PortfolioEditModal({ portfolio, onClose, onSave }) {
  const [name, setName] = useState(portfolio?.name || '');
  const [color, setColor] = useState(portfolio?.color || PALETTE[0]);
  const [targetPct, setTargetPct] = useState(portfolio?.targetPct ?? '');
  const [isCash, setIsCash] = useState(portfolio?.isCash || false);
  const [autoRule, setAutoRule] = useState(portfolio?.autoRule || '');
  const [notes, setNotes] = useState(portfolio?.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim()) { setErr('名称必填'); return; }
    setSaving(true); setErr('');
    try {
      const body = { name: name.trim(), color, isCash, notes: notes.trim() || null, autoRule: autoRule || null };
      if (targetPct !== '' && !isNaN(Number(targetPct))) body.targetPct = Number(targetPct);
      const result = portfolio?.id
        ? await api.portfolioUpdate(portfolio.id, body)
        : await api.portfolioCreate(body);
      onSave(result);
    } catch (e) { setErr(prettyErr(e)); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[480px] max-w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-medium mb-4">{portfolio?.id ? '编辑组合' : '新建组合'}</h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-600 block mb-1">名称</label>
            <input className="w-full border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 定投仓位" autoFocus />
          </div>
          <div>
            <label className="text-sm text-gray-600 block mb-1">颜色</label>
            <div className="flex gap-2 flex-wrap">
              {PALETTE.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)} className={cn('w-8 h-8 rounded-full transition-transform', color === c && 'ring-2 ring-offset-2 ring-gray-700 scale-110')} style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm text-gray-600 block mb-1">目标占比 % (可选)</label>
            <input type="number" min="0" max="100" step="0.01" className="w-full border rounded px-3 py-2" value={targetPct} onChange={(e) => setTargetPct(e.target.value)} placeholder="70" />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={isCash} onChange={(e) => setIsCash(e.target.checked)} />
              <span>标记为现金仓位（自动包含 IB 账户余额）</span>
            </label>
          </div>
          <div>
            <label className="text-sm text-gray-600 block mb-1">自动归类规则（可选）</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={autoRule} onChange={(e) => setAutoRule(e.target.value)}>
              {AUTO_RULES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <div className="text-xs text-gray-400 mt-1">符合规则的未分类持仓会自动加入此组合（已被其他组合手动 claim 的不受影响）</div>
          </div>
          <div>
            <label className="text-sm text-gray-600 block mb-1">备注 (可选)</label>
            <textarea className="w-full border rounded px-3 py-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {err && <div className="text-red-600 text-sm">{err}</div>}
          <div className="flex gap-2 pt-2">
            <button className="px-4 py-2 bg-violet-600 text-white rounded disabled:opacity-50" disabled={saving} onClick={submit}>{saving ? '保存中…' : '保存'}</button>
            <button className="px-4 py-2 border rounded" onClick={onClose}>取消</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddHoldingsSheet({ portfolio, uncategorized, onClose, onAdded }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');

  function toggle(s) {
    const next = new Set(selected);
    if (next.has(s)) next.delete(s); else next.add(s);
    setSelected(next);
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(p => p.symbol)));
  }

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return uncategorized;
    return uncategorized.filter(p => (p.symbol || '').toLowerCase().includes(f) || (p.description || '').toLowerCase().includes(f));
  }, [uncategorized, filter]);

  async function commit() {
    if (selected.size === 0) return;
    setBusy(true); setErr('');
    try {
      const symbols = uncategorized.filter(p => selected.has(p.symbol)).map(p => ({ symbol: p.symbol, assetClass: p.assetClass }));
      const res = await api.portfolioAddHoldings(portfolio.id, symbols);
      if (res.conflicts && res.conflicts.length > 0) {
        const msg = res.conflicts.map(c => `${c.symbol} 已在「${c.existingPortfolioName}」`).join('\n');
        alert(`${res.added.length} 个已添加，${res.conflicts.length} 个冲突：\n${msg}`);
      }
      onAdded(res);
    } catch (e) {
      if (e.status === 409 && e.body) {
        try {
          const parsed = JSON.parse(e.body);
          if (parsed.conflicts && parsed.conflicts.length) {
            const msg = parsed.conflicts.map(c => `${c.symbol} 已在「${c.existingPortfolioName}」`).join('\n');
            setErr(`所选标的全部冲突：\n${msg}`);
            return;
          }
        } catch {}
      }
      setErr(prettyErr(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[640px] max-w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">添加持仓到「{portfolio.name}」</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <input className="border rounded px-3 py-2 mb-3 text-sm" placeholder="搜索 Symbol 或名称…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="flex-1 overflow-auto border rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="p-2 w-8"><input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={toggleAll} /></th>
                <th className="p-2 text-left">Symbol</th>
                <th className="p-2 text-left">名称</th>
                <th className="p-2 text-left">类型</th>
                <th className="p-2 text-right">市值</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center text-gray-500 p-6">{uncategorized.length === 0 ? '无未分类持仓（全部已属其他组合）' : '搜索无结果'}</td></tr>
              )}
              {filtered.map((p) => (
                <tr key={p.symbol} className={cn('hover:bg-violet-50 cursor-pointer', selected.has(p.symbol) && 'bg-violet-100')} onClick={() => toggle(p.symbol)}>
                  <td className="p-2"><input type="checkbox" checked={selected.has(p.symbol)} onChange={() => toggle(p.symbol)} onClick={(e) => e.stopPropagation()} /></td>
                  <td className="p-2 font-mono">{p.symbol}</td>
                  <td className="p-2 text-gray-500 truncate max-w-[200px]">{p.description || ''}</td>
                  <td className="p-2 text-gray-500">{p.assetClass}</td>
                  <td className="p-2 text-right">{fmtMoney(p.currentValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {err && <div className="text-red-600 text-sm mt-2">{err}</div>}
        <div className="flex gap-2 pt-3 mt-2 border-t">
          <button className="px-4 py-2 bg-violet-600 text-white rounded disabled:opacity-50" disabled={busy || selected.size === 0} onClick={commit}>添加 {selected.size} 项</button>
          <button className="px-4 py-2 border rounded" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

function TradeHistory({ symbol, markPrice, fifoCost, dilutedCost, currentQty }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    api.portfolioHoldingTrades(symbol)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setErr(prettyErr(e)); });
    return () => { cancelled = true; };
  }, [symbol]);
  if (err) return <div className="text-xs text-red-500">{err}</div>;
  if (!data) return <div className="text-xs text-gray-400">加载历史交易…</div>;
  const trades = data.trades || [];
  const s = data.summary || {};
  const cur = markPrice || 0;
  const pnlPctAvgBuy = s.avgBuyPrice ? ((cur - s.avgBuyPrice) / s.avgBuyPrice * 100) : null;
  const pnlPctFifo = fifoCost ? ((cur - fifoCost) / fifoCost * 100) : null;
  const pnlPctDiluted = dilutedCost ? ((cur - dilutedCost) / dilutedCost * 100) : null;
  if (trades.length === 0) return <div className="text-xs text-gray-400">无历史交易记录</div>;
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3 text-xs">
        <div className="p-2 bg-blue-50 rounded">
          <div className="text-gray-500">历史买入均价</div>
          <div className="font-semibold text-base leading-tight">{fmtMoney(s.avgBuyPrice, 2)}<span className="text-xs text-gray-400">/股</span></div>
          <div className="text-[10px] text-gray-500 mt-0.5">所有 BUY 简单加权</div>
          {pnlPctAvgBuy != null && (
            <div className={cn('mt-0.5 text-xs', pnlPctAvgBuy >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
              浮盈 {pnlPctAvgBuy > 0 ? '+' : ''}{pnlPctAvgBuy.toFixed(1)}%
            </div>
          )}
        </div>
        {fifoCost > 0 && (
          <div className="p-2 bg-emerald-50 rounded">
            <div className="text-gray-500">FIFO 持仓成本</div>
            <div className="font-semibold text-base leading-tight">{fmtMoney(fifoCost, 2)}<span className="text-xs text-gray-400">/股</span></div>
            <div className="text-[10px] text-gray-500 mt-0.5">剩余股的真实成本</div>
            {pnlPctFifo != null && (
              <div className={cn('mt-0.5 text-xs', pnlPctFifo >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                浮盈 {pnlPctFifo > 0 ? '+' : ''}{pnlPctFifo.toFixed(1)}%
              </div>
            )}
          </div>
        )}
        {dilutedCost > 0 && (
          <div className="p-2 bg-violet-50 rounded">
            <div className="text-gray-500">股票摊薄</div>
            <div className="font-semibold text-base leading-tight">{fmtMoney(dilutedCost, 2)}<span className="text-xs text-gray-400">/股</span></div>
            <div className="text-[10px] text-gray-500 mt-0.5">卖出后调整·不含期权</div>
            {pnlPctDiluted != null && (
              <div className={cn('mt-0.5 text-xs', pnlPctDiluted >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                浮盈 {pnlPctDiluted > 0 ? '+' : ''}{pnlPctDiluted.toFixed(1)}%
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-2 text-gray-600">
        <span>累计买入 <b>{Number(s.totalBuyQty).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> 股</span>
        <span>总投入 <b>{fmtMoney(s.totalBuyCost)}</b></span>
        {currentQty != null && <span>当前持有 <b>{Number(currentQty).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> 股</span>}
        {s.totalSellQty > 0 && <span>已卖 <b>{Number(s.totalSellQty).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> 股</span>}
        {s.totalOptionPremium != null && Math.abs(s.totalOptionPremium) > 0 && (
          <span className={s.totalOptionPremium > 0 ? 'text-emerald-700' : 'text-rose-700'}>
            期权累计权利金 <b>{s.totalOptionPremium > 0 ? '+' : ''}{fmtMoney(s.totalOptionPremium)}</b>
          </span>
        )}
        {s.currentDilutedCost > 0 && <span>综合摊薄 <b className="text-violet-700">{fmtMoney(s.currentDilutedCost, 2)}</b>/股<span className="text-gray-400 ml-0.5">（含期权）</span></span>}
      </div>
      <div className="max-h-72 overflow-y-auto border rounded bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0 text-gray-500">
            <tr>
              <th className="p-1 text-left">日期</th>
              <th className="p-1 text-left">操作</th>
              <th className="p-1 text-left">标的</th>
              <th className="p-1 text-right">数量</th>
              <th className="p-1 text-right">价格</th>
              <th className="p-1 text-right">总额</th>
              <th className="p-1 text-right">事件后摊薄</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => {
              const next = trades[i + 1];
              const trend = (next && next.dilutedAfter && t.dilutedAfter) ? (t.dilutedAfter - next.dilutedAfter) : 0;
              const isOpt = t.category === 'OPT';
              return (
                <tr key={i} className={cn('border-t hover:bg-gray-50', isOpt && 'bg-violet-50/20')}>
                  <td className="p-1 font-mono whitespace-nowrap">{t.tradeDate}</td>
                  <td className="p-1 whitespace-nowrap">
                    <span className={cn('px-1 rounded text-[10px]', t.buySell === 'BUY' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700')}>
                      {t.buySell}
                    </span>
                    {isOpt && <span className="ml-1 text-[10px] px-1 bg-violet-100 text-violet-700 rounded">期权</span>}
                    {t.openClose === 'O' && <span className="ml-1 text-[10px] text-gray-400">开</span>}
                    {t.openClose === 'C' && <span className="ml-1 text-[10px] text-gray-400">平</span>}
                  </td>
                  <td className="p-1 font-mono text-[10px] truncate max-w-[120px]" title={t.symbol}>
                    {isOpt ? fmtContract(t.symbol) : t.symbol}
                  </td>
                  <td className="p-1 text-right">{Number(t.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="p-1 text-right font-mono">{fmtMoney(t.tradePrice, 2)}</td>
                  <td className={cn('p-1 text-right font-mono', t.proceeds > 0 ? 'text-emerald-700' : 'text-gray-700')}>
                    {t.proceeds > 0 ? '+' : ''}{fmtMoney(t.proceeds)}
                  </td>
                  <td className="p-1 text-right font-mono whitespace-nowrap">
                    {t.dilutedAfter > 0 ? fmtMoney(t.dilutedAfter, 2) : '-'}
                    {trend < -0.01 && <span className="text-emerald-600 ml-0.5" title="综合摊薄下降">↓</span>}
                    {trend > 0.01 && <span className="text-orange-600 ml-0.5" title="综合摊薄上升">↑</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PortfoliosTab() {
  const data = useDashboardStore((s) => s.data);
  const currentAccount = useDashboardStore((s) => s.currentAccount);
  const isLoggedIn = typeof localStorage !== 'undefined' && (!!localStorage.getItem('ib_jwt') || !!localStorage.getItem('token'));
  const [activeId, setActiveId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(null);
  const [expandedSymbol, setExpandedSymbol] = useState(null);
  const [showAi, setShowAi] = useState(false);
  const [showMatch, setShowMatch] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [overrideHolding, setOverrideHolding] = useState(null);
  function toggleExpand(sym) {
    setExpandedSymbol((cur) => cur === sym ? null : sym);
  }

  const view = data?.portfolios || { portfolios: [], uncategorized: [], totalNav: 0, hasDefinitions: false };
  const portfolios = view.portfolios || [];
  const uncategorized = view.uncategorized || [];

  const active = useMemo(() => portfolios.find(p => p.id === activeId) || portfolios[0], [portfolios, activeId]);

  async function reloadView() {
    try {
      const payload = await api.dashboardPortfolios(currentAccount);
      useDashboardStore.setState((s) => ({ data: { ...(s.data || {}), ...payload } }));
    } catch (e) { console.error('reload portfolios failed', e); }
  }

  async function deletePortfolio(p) {
    if (!confirm(`确定删除「${p.name}」？组合内 ${p.holdings.filter(h => h.symbol !== '__CASH__').length} 个标的会变为「未分类」。`)) return;
    try {
      await api.portfolioDelete(p.id);
      if (active?.id === p.id) setActiveId(null);
      await reloadView();
    } catch (e) { alert(prettyErr(e)); }
  }

  async function removeHolding(p, sym) {
    if (sym === '__CASH__') return;
    try {
      await api.portfolioRemoveHolding(p.id, sym);
    } catch (e) {
      if (e.status !== 404) {
        alert(prettyErr(e));
      }
    }
    await reloadView();
  }

  async function moveOrder(p, dir) {
    const ids = portfolios.map(x => x.id);
    const i = ids.indexOf(p.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api.portfoliosReorder(ids);
      await reloadView();
    } catch (e) { alert(prettyErr(e)); }
  }

  if (!view.hasDefinitions) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="bg-gradient-to-br from-violet-50 to-rose-50 border border-violet-100 rounded-2xl p-12 text-center">
          <PieChart size={48} className="mx-auto text-violet-400 mb-4" />
          <h2 className="text-2xl font-medium mb-2">还没有自定义组合</h2>
          <p className="text-gray-600 mb-6">把 IB 持仓按你自己的逻辑分组（定投仓位 / 策略仓位 / 现金仓位），看到目标占比 vs 实际偏离。</p>
          {isLoggedIn ? (
            <div className="flex flex-wrap justify-center gap-2">
              <button className="px-6 py-3 bg-violet-600 text-white rounded-xl" onClick={() => setShowAi(true)}>
                🤖 AI 一键分组
              </button>
              <button className="px-6 py-3 border border-violet-200 bg-white text-violet-700 rounded-xl" onClick={() => setEditing('new')}>
                <Plus size={18} className="inline mr-1" /> 新建组合
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500">登录后才能创建组合</p>
          )}
        </div>
        {editing && <PortfolioEditModal portfolio={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={async () => { setEditing(null); await reloadView(); }} />}
        {showAi && <AiSuggestModal onClose={() => setShowAi(false)} onApplied={async () => { setShowAi(false); setActiveId(null); await reloadView(); }} />}
        {showPromptEditor && <PromptEditorModal onClose={() => setShowPromptEditor(false)} onOpenAi={() => { setShowPromptEditor(false); setShowAi(true); }} />}
      </div>
    );
  }

  const uncategorizedTotal = uncategorized.reduce((s, p) => s + (p.currentValue || 0), 0);

  return (
    <div className="p-4">
      <PortfoliosDonut
        portfolios={portfolios}
        uncategorized={uncategorized}
        totalNav={view.totalNav}
        activeId={active?.id}
        onSelect={setActiveId}
      />

      {(view.rebalanceAdvice || (view.concentrationAlerts && view.concentrationAlerts.length > 0) || view.accountRiskMetrics) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <RebalanceCard advice={view.rebalanceAdvice} portfolios={portfolios} />
          <ConcentrationCard alerts={view.concentrationAlerts} />
          <RiskMetricsCard metrics={view.accountRiskMetrics} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 mt-4">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-gray-700">我的组合</h2>
          {isLoggedIn && (
            <button className="px-3 py-1 text-sm bg-violet-600 text-white rounded" onClick={() => setEditing('new')}>
              <Plus size={14} className="inline mr-1" />新建
            </button>
          )}
        </div>
        {isLoggedIn && (
          <div className="flex flex-wrap gap-1.5 mb-3 text-xs">
            <button className="px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100" onClick={async () => {
              if (!confirm('规则整理：创建 4 个标准组合（定投/现金/期权/个股）并自动归类所有持仓。已有同名组合保留。继续？')) return;
              try { await api.portfoliosAutoSetup(); await reloadView(); } catch (e) { alert(prettyErr(e)); }
            }}>⚡ 规则整理</button>
            <button className="px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100" title="保留现有组合，让 AI 把所有持仓分配到现有组合中（覆盖手动归类）" onClick={() => setShowMatch(true)}>🎯 AI 匹配现有</button>
            <button className="px-2 py-1 bg-gradient-to-r from-violet-100 to-rose-100 text-violet-700 border border-violet-200 rounded hover:from-violet-200 hover:to-rose-200" onClick={() => setShowAi(true)}>🤖 AI 整理</button>
            <button className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100" onClick={() => setShowPromptEditor(true)}>📝 提示词</button>
            <button className="px-2 py-1 bg-gray-50 border rounded hover:bg-gray-100" onClick={async () => {
              if (!confirm('关闭所有自动归类规则后，需要你手动把每个标的添加到组合。继续？')) return;
              try { await api.portfoliosClearAutoRules(); await reloadView(); } catch (e) { alert(prettyErr(e)); }
            }}>🧹 关闭自动</button>
            <button className="px-2 py-1 bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100" onClick={async () => {
              if (!confirm('⚠️ 删除所有组合及其持仓归类（不影响 IB 实际持仓）。无法撤销，确定继续？')) return;
              try { await api.portfoliosResetAll(); setActiveId(null); await reloadView(); } catch (e) { alert(prettyErr(e)); }
            }}>♻️ 重置</button>
            <a className="px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100" href="/api/portfolios/export.csv" download="portfolios.csv">📥 导出 CSV</a>
          </div>
        )}
        <div className="space-y-2">
          {portfolios.map((p, i) => (
            <div key={p.id} className={cn('p-3 rounded-xl border cursor-pointer transition-all', active?.id === p.id ? 'bg-white border-violet-300 ring-2 ring-violet-100' : 'bg-gray-50 hover:bg-white border-transparent')} onClick={() => setActiveId(p.id)}>
              <div className="flex items-start gap-2">
                <div className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: p.color }} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {p.name}
                    {p.isCash && <Wallet size={12} className="inline ml-1 text-gray-400" />}
                  </div>
                  <div className="text-xs text-gray-500">{fmtMoney(p.currentValue)} · {fmtPct(p.currentPct)}</div>
                  {p.targetPct != null && (
                    <div className="text-xs">
                      目标 {fmtPct(p.targetPct)}
                      <span className={cn('ml-1', Math.abs(p.deviationPct || 0) > 5 ? 'text-orange-600' : 'text-emerald-600')}>
                        ({(p.deviationPct || 0) > 0 ? '+' : ''}{fmtPct(p.deviationPct, 1)})
                      </span>
                    </div>
                  )}
                </div>
                {isLoggedIn && (
                  <div className="flex flex-col gap-0.5 opacity-30 hover:opacity-100">
                    {i > 0 && <button onClick={(e) => { e.stopPropagation(); moveOrder(p, -1); }}><ArrowUp size={12} /></button>}
                    {i < portfolios.length - 1 && <button onClick={(e) => { e.stopPropagation(); moveOrder(p, 1); }}><ArrowDown size={12} /></button>}
                  </div>
                )}
              </div>
            </div>
          ))}
          {uncategorized.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <div className="text-sm text-amber-800">
                <div className="font-medium">未分类</div>
                <div className="text-xs">{uncategorized.length} 个标的，{fmtMoney(uncategorizedTotal)}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        {active ? (
          <div className="bg-white rounded-2xl border p-6">
            <div className="flex items-start justify-between mb-6 gap-2">
              <div className="min-w-0">
                <h1 className="text-2xl font-medium flex items-center gap-2 flex-wrap">
                  <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: active.color }} />
                  {active.name}
                  {active.isCash && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">现金</span>}
                </h1>
                {active.notes && <p className="text-sm text-gray-500 mt-1">{active.notes}</p>}
              </div>
              {isLoggedIn && (
                <div className="flex gap-2 flex-shrink-0">
                  <button className="px-3 py-1.5 border rounded text-sm" onClick={() => setEditing(active)}><Edit2 size={14} className="inline mr-1" />编辑</button>
                  <button className="px-3 py-1.5 border rounded text-sm text-red-600" onClick={() => deletePortfolio(active)}><Trash2 size={14} className="inline mr-1" />删除</button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-violet-50 rounded-xl p-3">
                <div className="text-xs text-gray-500">当前金额</div>
                <div className="text-xl font-medium">{fmtMoney(active.currentValue)}</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-3">
                <div className="text-xs text-gray-500">占总 NAV</div>
                <div className="text-xl font-medium">{fmtPct(active.currentPct)}</div>
              </div>
              {active.targetPct != null ? (
                <>
                  <div className="bg-emerald-50 rounded-xl p-3">
                    <div className="text-xs text-gray-500">目标占比</div>
                    <div className="text-xl font-medium">{fmtPct(active.targetPct)}</div>
                  </div>
                  <div className={cn('rounded-xl p-3', Math.abs(active.deviationPct || 0) > 5 ? 'bg-orange-50' : 'bg-green-50')}>
                    <div className="text-xs text-gray-500">偏离</div>
                    <div className={cn('text-xl font-medium', Math.abs(active.deviationPct || 0) > 5 ? 'text-orange-700' : 'text-green-700')}>
                      {(active.deviationPct || 0) > 0 ? '+' : ''}{fmtPct(active.deviationPct, 1)}
                    </div>
                  </div>
                </>
              ) : (
                <div className="col-span-2 bg-gray-50 rounded-xl p-3 text-sm text-gray-400 flex items-center justify-center">
                  未设目标占比
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">持仓 ({active.holdings.length})</h3>
              {isLoggedIn && (
                <button className="px-3 py-1.5 bg-violet-600 text-white text-sm rounded" onClick={() => setAdding(active)}><Plus size={14} className="inline mr-1" />添加持仓</button>
              )}
            </div>
            {(() => {
              const nonOptions = active.holdings.filter(h => h.assetClass !== 'OPTION');
              const options = active.holdings.filter(h => h.assetClass === 'OPTION');
              const groups = {};
              for (const h of options) {
                // Wheel holdings go into a synthetic "wheel" group
                if (h.isWheel) {
                  if (!groups.wheel) groups.wheel = { strategy: 'wheel', label: '轮子策略 (Wheel)', items: [], isWheel: true };
                  groups.wheel.items.push(h);
                  continue;
                }
                const key = h.strategy || 'unknown';
                if (!groups[key]) groups[key] = { strategy: key, label: h.strategyLabel || '未识别', items: [] };
                groups[key].items.push(h);
              }
              const orderedGroups = Object.values(groups).sort((a, b) => {
                if (a.isWheel) return -1;
                if (b.isWheel) return 1;
                const ia = STRATEGY_ORDER.indexOf(a.strategy);
                const ib = STRATEGY_ORDER.indexOf(b.strategy);
                return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
              });
              return (
                <div>
                  {(nonOptions.length > 0 || options.length === 0) && (
                    <div className="overflow-x-auto mb-3">
                      <table className="w-full text-sm">
                        <thead className="text-left text-gray-500 border-b">
                          <tr>
                            <th className="p-2">Symbol</th>
                            <th className="p-2">名称</th>
                            <th className="p-2 text-right">数量</th>
                            <th className="p-2 text-right">市值</th>
                            <th className="p-2 text-right">组合内占比</th>
                            <th className="p-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {nonOptions.map((h) => {
                            const pct = active.currentValue ? (h.currentValue / active.currentValue * 100) : 0;
                            const isCash = h.symbol === '__CASH__';
                            const isAuto = h.autoMatched || h.source === 'ai';
                            const expandable = !isCash;
                            const isOpen = expandedSymbol === h.symbol;
                            return (
                              <Fragment key={h.symbol}>
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="p-2 font-mono">
                                    {expandable && (
                                      <button className="mr-1 text-gray-400 hover:text-gray-700 inline-block align-middle" onClick={() => toggleExpand(h.symbol)} title="查看买入历史">
                                        {isOpen ? <ChevronDownIcon size={12} /> : <ChevronRight size={12} />}
                                      </button>
                                    )}
                                    {isCash ? <span className="text-gray-600">账户现金</span> : h.symbol}
                                    {(isAuto || h.source === 'ai') && <span className="ml-1 text-xs px-1 py-0.5 bg-violet-100 text-violet-700 rounded">{h.source === 'ai' ? 'AI' : '自动'}</span>}
                                    {h.stale && <span className="ml-1 text-xs text-gray-400">(已无持仓)</span>}
                                  </td>
                                  <td className="p-2 text-gray-500 truncate max-w-[200px]">{isCash ? '' : (h.description || '')}</td>
                                  <td className="p-2 text-right">{h.quantity != null ? Number(h.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}</td>
                                  <td className="p-2 text-right">{fmtMoney(h.currentValue)}</td>
                                  <td className="p-2 text-right">{fmtPct(pct, 1)}</td>
                                  <td className="p-2 text-right">{!isCash && isLoggedIn && (
                                    <button className="text-red-500 hover:text-red-700" onClick={() => removeHolding(active, h.symbol)} title={isAuto ? '从此组合自动归类中排除' : '移除'}>
                                      <X size={14} />
                                    </button>
                                  )}</td>
                                </tr>
                                {isOpen && (
                                  <tr>
                                    <td colSpan={6} className="bg-gray-50/60 p-3">
                                      <TradeHistory
                                        symbol={h.symbol}
                                        markPrice={h.markPrice}
                                        fifoCost={h.avgCostBasisPrice}
                                        dilutedCost={h.dilutedCostBasisPrice}
                                        currentQty={h.quantity}
                                      />
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                          {active.holdings.length === 0 && (
                            <tr><td colSpan={6} className="text-center text-gray-500 p-6">该组合暂无持仓，点「添加持仓」从未分类列表选择</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {orderedGroups.length > 0 && options.length > 0 && (
                    <>
                      <OptionPnlTimeline />
                      <WheelCyclesPanel />
                    </>
                  )}
                  {orderedGroups.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs text-gray-500 mt-2">期权策略（自动识别）</div>
                      {orderedGroups.map((g) => {
                        const sum = g.items.reduce((s, h) => s + (h.currentValue || 0), 0);
                        const sumPct = active.currentValue ? (sum / active.currentValue * 100) : 0;
                        return (
                          <details key={g.strategy} className={cn('border rounded-xl', g.isWheel ? 'border-violet-200 bg-violet-50/40' : 'bg-gray-50/50')} open={g.items.length <= 4}>
                            <summary className="cursor-pointer px-3 py-2 flex items-center gap-2 text-sm hover:bg-violet-100/50 rounded-xl">
                              <span className="text-base">{STRATEGY_ICON[g.strategy] || '❓'}</span>
                              <span className="font-medium flex-1">{g.label}</span>
                              <span className="text-gray-500">{g.items.length} 笔</span>
                              <span className="font-mono w-28 text-right">{fmtMoney(sum)}</span>
                              <span className="text-gray-400 w-16 text-right text-xs">{fmtPct(sumPct, 1)}</span>
                            </summary>
                            <div className="overflow-x-auto px-2 pb-2">
                              <table className="w-full text-sm">
                                <thead className="text-left text-gray-400 text-xs">
                                  <tr>
                                    <th className="p-1 pl-3">合约</th>
                                    <th className="p-1">底层</th>
                                    <th className="p-1">阶段</th>
                                    <th className="p-1 text-right">DTE</th>
                                    <th className="p-1 text-right">数量</th>
                                    <th className="p-1 text-right">市值</th>
                                    <th className="p-1 w-8"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.items.map((h) => (
                                    <tr key={h.symbol} className="border-t border-gray-200 hover:bg-white">
                                      <td className="p-1 pl-3 font-mono text-xs" title={h.symbol}>
                                        {fmtContract(h.symbol)}
                                        {(h.autoMatched || h.source === 'ai') && <span className="ml-1 text-[10px] px-1 bg-violet-100 text-violet-700 rounded">{h.source === 'ai' ? 'AI' : '自动'}</span>}
                                        {h.strategyOverride && <span className="ml-1 text-[10px] px-1 bg-amber-100 text-amber-700 rounded" title="已手动覆盖策略">手动</span>}
                                      </td>
                                      <td className="p-1 font-medium">{h.underlying || ''}</td>
                                      <td className="p-1 text-xs text-gray-500">{g.isWheel ? (h.strategyLabel || '') : ''}</td>
                                      <td className="p-1 text-right">{h.dte != null ? `${h.dte}d` : '-'}</td>
                                      <td className="p-1 text-right">{h.quantity != null ? Number(h.quantity).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '-'}</td>
                                      <td className="p-1 text-right font-mono">{fmtMoney(h.currentValue)}</td>
                                      <td className="p-1 text-right">
                                        {isLoggedIn && (
                                          <button className="text-gray-400 hover:text-violet-700 mr-1" onClick={() => setOverrideHolding(h)} title="修改策略分类">
                                            <Edit2 size={11} />
                                          </button>
                                        )}
                                        {!h.autoMatched && isLoggedIn && (
                                          <button className="text-red-500 hover:text-red-700" onClick={() => removeHolding(active, h.symbol)} title="移除"><X size={12} /></button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border p-12 text-center text-gray-500">
            点击左侧组合查看详情
          </div>
        )}
      </div>

      {editing && <PortfolioEditModal portfolio={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={async (saved) => { setEditing(null); if (saved?.id) setActiveId(saved.id); await reloadView(); }} />}
      {adding && <AddHoldingsSheet portfolio={adding} uncategorized={uncategorized} onClose={() => setAdding(null)} onAdded={async () => { setAdding(null); await reloadView(); }} />}
      {showAi && <AiSuggestModal onClose={() => setShowAi(false)} onApplied={async () => { setShowAi(false); setActiveId(null); await reloadView(); }} />}
      {showMatch && <MatchSuggestModal portfolios={portfolios} onClose={() => setShowMatch(false)} onApplied={async () => { setShowMatch(false); setActiveId(null); await reloadView(); }} />}
      {showPromptEditor && <PromptEditorModal onClose={() => setShowPromptEditor(false)} onOpenAi={() => { setShowPromptEditor(false); setShowAi(true); }} />}
      {overrideHolding && <StrategyOverrideModal holding={overrideHolding} onClose={() => setOverrideHolding(null)} onSaved={async () => { setOverrideHolding(null); await reloadView(); }} />}

      <div className="border-t border-[var(--light-gray)] pt-6 mt-6 lg:col-span-2">
        <ChengjiTab />
      </div>
    </div>
    </div>
  );
}

function StrategyOverrideModal({ holding, onClose, onSaved }) {
  const current = holding.strategyOverride || '';
  const [override, setOverride] = useState(current);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setSaving(true); setErr('');
    try {
      await api.portfolioSetStrategyOverride(holding.symbol, override || null);
      onSaved();
    } catch (e) { setErr(prettyErr(e)); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[480px] max-w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium">修改策略分类</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="text-xs text-gray-500 mb-3">
          合约 <span className="font-mono">{holding.symbol}</span><br />
          自动识别：<b>{holding.strategyLabel || '未识别'}</b>
          {holding.isWheel && !holding.strategyOverride && <span className="ml-1 text-violet-700">🎡 轮子</span>}
        </div>
        <div className="space-y-2">
          <label className="text-sm text-gray-600 block">手动指定策略：</label>
          <select className="w-full border rounded px-3 py-2 text-sm" value={override} onChange={(e) => setOverride(e.target.value)}>
            {STRATEGY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="text-xs text-gray-400">「自动识别」会清除手动覆盖，让规则重新判定</div>
        </div>
        {err && <div className="text-red-600 text-sm mt-2">{err}</div>}
        <div className="flex gap-2 pt-4 mt-3 border-t">
          <button className="px-4 py-2 bg-violet-600 text-white rounded disabled:opacity-50" disabled={saving} onClick={submit}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button className="px-4 py-2 border rounded" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

function AiSuggestModal({ onClose, onApplied }) {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.portfoliosAiSuggest()
      .then((r) => { if (!cancelled) setPlan(r.plan); })
      .catch((e) => { if (!cancelled) setErr(prettyErr(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function apply() {
    if (!confirm('应用此方案将清空当前所有组合并按 AI 建议重建。继续？')) return;
    setApplying(true);
    try {
      await api.portfoliosAiApply(plan);
      onApplied();
    } catch (e) { setErr(prettyErr(e)); } finally { setApplying(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[720px] max-w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium">🤖 AI 推荐分类方案</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        {loading && (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div>
              <div className="text-2xl mb-2">🤔</div>
              <div className="text-sm">AI 正在分析你的持仓…（约 10-30 秒）</div>
            </div>
          </div>
        )}
        {err && <div className="text-red-600 text-sm mb-2 p-3 bg-red-50 rounded">{err}</div>}
        {plan && (
          <>
            {plan.summary && (
              <div className="text-sm text-gray-600 bg-violet-50 p-3 rounded mb-3">{plan.summary}</div>
            )}
            <div className="flex-1 overflow-auto space-y-2">
              {(plan.portfolios || []).map((p, i) => (
                <div key={i} className="border rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color || '#6366f1' }} />
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-auto text-sm text-gray-500">target {p.target_pct}%</span>
                    {p.is_cash && <span className="text-xs px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">现金</span>}
                    {p.auto_rule && <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">{p.auto_rule}</span>}
                  </div>
                  {p.reasoning && <div className="text-xs text-gray-500 mb-1">{p.reasoning}</div>}
                  <div className="text-xs font-mono text-gray-600 break-all">{(p.holdings || []).join(', ') || (p.is_cash ? '(自动包含账户现金)' : '(无)')}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-3 mt-3 border-t">
              <button className="px-4 py-2 bg-violet-600 text-white rounded disabled:opacity-50" disabled={applying} onClick={apply}>
                {applying ? '应用中…' : '应用此方案（替换现有）'}
              </button>
              <button className="px-4 py-2 border rounded" onClick={onClose}>取消</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MatchSuggestModal({ portfolios, onClose, onApplied }) {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.portfoliosMatchSuggest()
      .then((r) => { if (!cancelled) setPlan(r.plan); })
      .catch((e) => { if (!cancelled) setErr(prettyErr(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const colorByName = useMemo(() => {
    const map = {};
    (portfolios || []).forEach((p) => { map[p.name] = p.color || '#6366f1'; });
    return map;
  }, [portfolios]);

  const grouped = useMemo(() => {
    if (!plan?.assignments) return [];
    const m = {};
    plan.assignments.forEach((a) => {
      const k = a.portfolio_name || '(未指定)';
      if (!m[k]) m[k] = [];
      m[k].push(a);
    });
    return Object.entries(m).map(([name, items]) => ({ name, items }));
  }, [plan]);

  async function apply() {
    if (!confirm(`将 ${plan?.assignments?.length || 0} 笔持仓写入对应组合（覆盖现有手动归类）。继续？`)) return;
    setApplying(true);
    try {
      await api.portfoliosMatchApply(plan);
      onApplied();
    } catch (e) { setErr(prettyErr(e)); } finally { setApplying(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[760px] max-w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium">🎯 AI 匹配现有组合</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="text-xs text-gray-500 mb-3">保留你已有的组合，让 AI 把每笔持仓分配进去。不认识的标的会进 unassigned，需要你手动归类。</div>
        {loading && (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div>
              <div className="text-2xl mb-2">🤔</div>
              <div className="text-sm">AI 正在为你分配持仓…（约 10-30 秒）</div>
            </div>
          </div>
        )}
        {err && <div className="text-red-600 text-sm mb-2 p-3 bg-red-50 rounded">{err}</div>}
        {plan && (
          <>
            {plan.summary && (
              <div className="text-sm text-gray-600 bg-violet-50 p-3 rounded mb-3">{plan.summary}</div>
            )}
            <div className="flex-1 overflow-auto space-y-2">
              {grouped.map(({ name, items }) => (
                <div key={name} className="border rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colorByName[name] || '#9ca3af' }} />
                    <span className="font-medium">{name}</span>
                    <span className="ml-auto text-xs text-gray-500">{items.length} 个标的</span>
                  </div>
                  <div className="space-y-1">
                    {items.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="font-mono text-gray-700 w-20 flex-shrink-0">{a.symbol}</span>
                        <span className="text-xs text-gray-500 flex-1">{a.reasoning || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {(plan.unassigned || []).length > 0 && (
                <div className="border-2 border-amber-200 bg-amber-50 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-amber-800">未分配（AI 不确定）</span>
                    <span className="ml-auto text-xs text-amber-700">{plan.unassigned.length} 个</span>
                  </div>
                  <div className="text-xs text-amber-700 mb-2">这些标的应用后会保持原状不动，需要你手动加到合适的组合。</div>
                  <div className="text-xs font-mono text-amber-900 break-all">{plan.unassigned.join(', ')}</div>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-3 mt-3 border-t">
              <button className="px-4 py-2 bg-violet-600 text-white rounded disabled:opacity-50" disabled={applying || !plan?.assignments?.length} onClick={apply}>
                {applying ? '应用中…' : `应用（写入 ${plan?.assignments?.length || 0} 笔）`}
              </button>
              <button className="px-4 py-2 border rounded" onClick={onClose}>取消</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PromptEditorModal({ onClose, onOpenAi }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.portfoliosAiPromptGet()
      .then((r) => { setPrompt(r.prompt || ''); })
      .catch(() => {})
      .finally(() => { setLoading(false); });
  }, []);

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      await api.portfoliosAiPromptSave(prompt);
      setMsg('已保存');
    } catch (e) { setMsg(prettyErr(e)); }
    finally { setSaving(false); }
  }

  async function saveAndRun() {
    setSaving(true);
    setMsg('');
    try {
      await api.portfoliosAiPromptSave(prompt);
      onOpenAi();
    } catch (e) { setMsg(prettyErr(e)); setSaving(false); }
  }

  async function clear() {
    if (!confirm('清除已保存的提示词？')) return;
    setSaving(true);
    setMsg('');
    try {
      await api.portfoliosAiPromptSave('');
      setPrompt('');
      setMsg('已清除');
    } catch (e) { setMsg(prettyErr(e)); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[640px] max-w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium">📝 自定义 AI 分类提示词</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <p className="text-sm text-gray-500 mb-3">
          告诉 AI 你希望如何归类持仓，AI 整理时会优先按你的规则分类。留空则使用默认智能分类。
        </p>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">加载中…</div>
        ) : (
          <>
            <textarea
              className="flex-1 min-h-[180px] border rounded-xl p-4 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-violet-200 mb-3"
              placeholder={`例如：
把 AAPL、MSFT、GOOGL 归到「科技巨头」
把 JEPI、JEPQ、DIVO 归到「期权收入策略」
把所有 LEAPS 期权归到「长期看涨」
其余按行业或策略自动归类`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />

            {msg && (
              <div className={cn('text-sm mb-2 p-2 rounded', msg === '已保存' || msg === '已清除' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>
                {msg}
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t">
              <button className="px-4 py-2 bg-violet-600 text-white rounded disabled:opacity-50" disabled={saving} onClick={save}>
                {saving ? '保存中…' : '保存'}
              </button>
              <button className="px-4 py-2 bg-gradient-to-r from-violet-100 to-rose-100 text-violet-700 border border-violet-200 rounded disabled:opacity-50" disabled={saving} onClick={saveAndRun}>
                {saving ? '处理中…' : '保存并 AI 整理'}
              </button>
              <button className="px-4 py-2 border rounded text-gray-600 disabled:opacity-50" disabled={saving} onClick={clear}>
                清除
              </button>
              <button className="px-4 py-2 border rounded ml-auto" onClick={onClose}>取消</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
