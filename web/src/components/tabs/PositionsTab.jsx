import { useMemo, useState } from 'react';
import { useDashboardStore } from '../../stores/dashboardStore';
import { fmtCur, fmtNum, fmtDate, parseDate } from '../../utils/format';
import ECharts from '../ECharts';
import PositionTimeline from '../PositionTimeline';
import RiskRadar from '../RiskRadar';
import CorporateActionTimeline from '../CorporateActionTimeline';
import OptionsStrategyLens from '../OptionsStrategyLens';

function Card({ title, children }) {
  return (
    <div className="rounded-xl border border-[var(--light-gray)] p-6">
      {title && <div className="mb-4 text-lg font-semibold">{title}</div>}
      {children}
    </div>
  );
}

function parseOptionFromSymbol(symbol = '', description = '') {
  const parts = (symbol || '').trim().split(/\s+/);
  let underlying = parts[0] || '';
  let expiry = '';
  let putCall = '';
  let strike = 0;

  if (description) {
    const dparts = description.trim().split(/\s+/);
    if (dparts.length >= 4) {
      underlying = dparts[0];
      const expiryStr = dparts[1];
      strike = parseFloat(dparts[2]) || 0;
      putCall = dparts[3]?.toUpperCase();
      if (expiryStr && expiryStr.length === 6) {
        const day = expiryStr.substring(0, 2);
        const monthMap = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
        const mon = monthMap[expiryStr.substring(2, 5).toUpperCase()];
        const yr = '20' + expiryStr.substring(5, 7);
        if (mon) expiry = `${yr}-${mon}-${day}`;
      }
    }
  }

  if (!expiry && parts[1] && parts[1].length === 15) {
    const code = parts[1];
    const yr = '20' + code.substring(0, 2);
    const mon = code.substring(2, 4);
    const day = code.substring(4, 6);
    putCall = code.substring(6, 7).toUpperCase();
    strike = (parseFloat(code.substring(7)) || 0) / 1000;
    expiry = `${yr}-${mon}-${day}`;
  }

  return { underlying, expiry, putCall, strike };
}

function PositionPie({ positions, mode, totalCash }) {
  const groups = usePieGroups(positions, mode, totalCash);
  const data = Object.entries(groups).map(([name, value]) => ({ name, value }));
  const colors = ['#000000', '#6366f1', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316'];

  if (!data.length) return <p className="text-sm text-[var(--gray)]">暂无数据</p>;

  const option = {
    tooltip: { trigger: 'item', formatter: (params) => `${params.name}: ${fmtCur(params.value)} (${params.percent}%)` },
    legend: { orient: 'vertical', right: 0, top: 'middle', itemWidth: 10, textStyle: { fontSize: 11, color: '#666' } },
    color: colors,
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['38%', '50%'],
      data,
      label: {
        show: true,
        formatter: '{b}\n{d}%',
        fontSize: 11,
        color: '#333',
      },
      emphasis: {
        label: { show: true, fontSize: 12, fontWeight: 'bold' },
        itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' },
      },
    }],
  };

  return (
    <div style={{ height: 280, position: 'relative' }}>
      <ECharts option={option} style={{ height: 280 }} />
    </div>
  );
}

function PositionPieStats({ positions, mode, totalCash }) {
  const groups = usePieGroups(positions, mode, totalCash);
  const total = Object.values(groups).reduce((s, v) => s + v, 0);
  const colors = { 股票: '#000000', ETF: '#6366f1', 期权: '#ef4444', 现金: '#10b981' };

  const todayPnl = positions.reduce((s, p) => s + (p.dailyPnl || 0), 0);
  const unrealizedPnl = positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
  const pnl = todayPnl !== 0 ? todayPnl : unrealizedPnl;
  const pnlLabel = todayPnl !== 0 ? '今日盈亏' : '未实现盈亏';
  const pnlPositive = pnl >= 0;

  const items = Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      name,
      value,
      pct: total > 0 ? (value / total) * 100 : 0,
      color: colors[name] || '#94a3b8',
    }));

  return (
    <div className="flex h-full flex-col justify-between">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-[var(--light-gray)] p-4">
          <div className="text-xs text-[var(--gray)]">总持仓市值</div>
          <div className="mt-1 text-lg font-semibold">{fmtCur(total)}</div>
        </div>
        <div className="rounded-lg border border-[var(--light-gray)] p-4">
          <div className="text-xs text-[var(--gray)]">{pnlLabel}</div>
          <div className={`mt-1 text-lg font-semibold ${pnlPositive ? 'text-green-600' : 'text-red-500'}`}>
            {pnlPositive ? '+' : ''}{fmtCur(pnl)}
          </div>
        </div>
      </div>

      <div className="mt-4 flex-1 overflow-auto">
        <div className="mb-2 text-xs font-medium text-[var(--gray)]">分类明细</div>
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.name} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
                <span className="text-[var(--dark)]">{it.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium">{fmtCur(it.value)}</span>
                <span className="w-12 text-right text-xs text-[var(--gray)]">{it.pct.toFixed(2)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OptionExpiry({ options }) {
  const opts = [];
  (options || []).forEach((p) => {
    const parsed = parseOptionFromSymbol(p.symbol, p.description);
    const expiryStr = parsed.expiry;
    const strike = parsed.strike || 0;
    const putCall = parsed.putCall || '';
    const underlying = parsed.underlying || p.symbol?.split(' ')[0] || '';
    const parsedDate = expiryStr ? parseDate(expiryStr) : null;
    const days = parsedDate && !isNaN(parsedDate) ? Math.max(0, Math.ceil((parsedDate - new Date()) / 86400000)) : 999;
    const posValue = p.positionValue || 0;
    const markPrice = p.markPrice || 0;
    const estPnl = p.estimatedPnl || 0;
    const netPremium = p.netPremium != null ? p.netPremium : (estPnl - posValue);
    const premiumPerContract = p.premiumPerContract != null ? p.premiumPerContract : (netPremium && p.contracts ? netPremium / p.contracts : 0);
    const premiumPerShare = p.premiumPerShare != null ? p.premiumPerShare : (netPremium && p.contracts ? netPremium / p.contracts / 100 : 0);
    const calculatedContracts = markPrice ? Math.round(Math.abs(posValue) / Math.abs(markPrice) / 100) : 0;
    const contracts = p.contracts || calculatedContracts;

    opts.push({
        symbol: underlying,
        rawSymbol: p.symbol || underlying,
        type: putCall === 'C' ? 'Call' : 'Put',
        expiry: expiryStr,
        strike,
        days,
        markPrice,
        premiumPerShare,
        contracts,
        costBasis: netPremium,
        premiumPerContract,
        netPremium,
        value: posValue,
        pnl: estPnl
      });
  });
  if (!opts.length) return <p className="text-sm text-[var(--gray)]">暂无期权到期数据</p>;
  opts.sort((a, b) => a.days - b.days);

  return (
    <div>
      <div className="mb-2 grid grid-cols-[50px_70px_50px_1fr_50px_70px_80px_60px_80px_85px_85px_85px] gap-2 rounded-t-lg bg-[var(--lighter-gray)] px-3 py-2 text-xs font-semibold text-[var(--gray)]">
        <div className="text-center">天数</div>
        <div>标的</div>
        <div>类型</div>
        <div>详情</div>
        <div className="text-center">张数</div>
        <div className="text-right">行权价</div>
        <div className="text-right">成本基础</div>
        <div className="text-right">现价</div>
        <div className="text-right">权益金</div>
        <div className="text-right">权益金现金</div>
        <div className="text-right">市值</div>
        <div className="text-right">未实现盈亏</div>
      </div>
      {opts.map((o, i) => {
        const urgent = o.days <= 7;
        return (
          <div
            key={i}
            className={`grid grid-cols-[50px_70px_50px_1fr_50px_70px_80px_60px_80px_85px_85px_85px] gap-2 border-b border-[var(--lighter-gray)] px-3 py-3 text-sm ${urgent ? 'bg-red-50' : ''}`}
          >
            <div className={`text-center font-bold ${urgent ? 'text-[var(--danger)]' : 'text-[var(--gray)]'}`}>{o.days}天</div>
            <div>
              <div className="font-semibold">{o.symbol}</div>
              <div className="mt-0.5 text-[10px] text-[var(--gray)]" title="Yahoo API 代码">{o.rawSymbol}</div>
            </div>
            <div>
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${o.type === 'Put' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                {o.type}
              </span>
            </div>
            <div className="text-xs text-[var(--gray)]">到期：{fmtDate(o.expiry)}</div>
            <div className="text-center text-sm font-medium">{o.contracts}</div>
            <div className="text-right text-sm">${fmtNum(o.strike, 0)}</div>
            <div className="text-right text-sm font-medium">{fmtCur(o.costBasis)}</div>
            <div className="text-right text-sm font-medium">{fmtCur(o.markPrice)}</div>
            <div className="text-right text-sm font-medium">{fmtCur(o.premiumPerShare)}</div>
            <div className="text-right text-sm font-medium">{fmtCur(o.netPremium)}</div>
            <div className="text-right text-sm font-medium">{fmtCur(o.value)}</div>
            <div className={`text-right text-sm font-medium ${o.pnl >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{fmtCur(o.pnl)}</div>
          </div>
        );
      })}
    </div>
  );
}

function PositionPnl({ positions, costMode }) {
  const rows = positions
    .map((p) => {
      const costMoney = costMode === 'diluted' ? (p.dilutedCostBasisMoney || 0) : (p.avgCostBasisMoney || 0);
      const unrealized = (p.positionValue || 0) - costMoney;
      return {
        symbol: p.symbol,
        marketValue: p.positionValue || 0,
        unrealized,
      };
    })
    .sort((a, b) => b.marketValue - a.marketValue);

  const labels = rows.map((r) => r.symbol);
  const vals = rows.map((r) => r.unrealized);

  const option = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => `${params[0].name}<br/>${fmtCur(params[0].value)}` },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => fmtCur(v) } },
    yAxis: { type: 'category', data: labels, axisLabel: { width: 80, overflow: 'truncate' } },
    series: [{
      type: 'bar',
      data: vals.map((v) => ({ value: v, itemStyle: { color: v >= 0 ? '#00c853' : '#ff3d00', borderRadius: [0, 4, 4, 0] } })),
    }],
  };

  return (
    <Card title="持仓盈亏透视">
      <div style={{ height: 220, overflow: 'hidden' }}>
        <ECharts option={option} style={{ height: 220 }} />
      </div>
    </Card>
  );
}

const TYPE_OPTIONS = [
  { key: 'STOCK', label: '股票' },
  { key: 'ETF', label: 'ETF' },
  { key: 'OPTION', label: '期权' },
];

export default function PositionsTab() {
  const data = useDashboardStore((s) => s.data);
  const [pieMode, setPieMode] = useState('positions');
  const [selectedTypes, setSelectedTypes] = useState(['STOCK', 'ETF', 'OPTION']);
  const [costMode, setCostMode] = useState('avg');
  const [sort, setSort] = useState({ key: 'positionValue', order: 'desc' });

  if (!data) return <div className="py-10 text-center text-[var(--gray)]">暂无数据</div>;

  const allPositions = useMemo(() => [
    ...(data.openPositions?.stocks || []),
    ...(data.openPositions?.etfs || []),
    ...(data.openPositions?.options || [])
  ], [data.openPositions]);

  const filteredPositions = allPositions.filter((p) => {
    const type = p.assetType || p.assetCategory || 'STOCK';
    return selectedTypes.includes(type);
  });

  const summary = data.summary || {};
  const totalCash = summary.cash || 0;

  const totalUnrealized = filteredPositions.reduce((s, p) => {
    const costMoney = costMode === 'diluted' ? (p.dilutedCostBasisMoney || 0) : (p.avgCostBasisMoney || 0);
    return s + ((p.positionValue || 0) - costMoney);
  }, 0);

  const sortedPositions = useMemo(() => {
    const enriched = filteredPositions.map((p) => {
      const qty = p.markPrice ? p.positionValue / p.markPrice : 0;
      const costPrice = costMode === 'diluted' ? (p.dilutedCostBasisPrice || 0) : (p.avgCostBasisPrice || 0);
      const costMoney = costMode === 'diluted' ? (p.dilutedCostBasisMoney || 0) : (p.avgCostBasisMoney || 0);
      const unrealized = (p.positionValue || 0) - costMoney;
      const gainPct = costPrice ? ((p.markPrice - costPrice) / costPrice) * 100 : 0;
      return { ...p, qty, costPrice, costMoney, unrealized, gainPct };
    });
    enriched.sort((a, b) => {
      const key = sort.key;
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      let diff;
      if (typeof av === 'string' && typeof bv === 'string') {
        diff = av.localeCompare(bv);
      } else {
        diff = Number(av) - Number(bv);
      }
      return sort.order === 'asc' ? diff : -diff;
    });
    return enriched;
  }, [filteredPositions, sort, costMode]);

  const toggleSort = (key) => {
    setSort((prev) => ({
      key,
      order: prev.key === key && prev.order === 'desc' ? 'asc' : 'desc',
    }));
  };

  const SortHeader = ({ label, sortKey }) => {
    const active = sort.key === sortKey;
    return (
      <th
        className={`cursor-pointer select-none py-2 ${sortKey === 'symbol' || sortKey === 'assetCategory' ? '' : 'text-right'}`}
        onClick={() => toggleSort(sortKey)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active && (
            <span className="text-[10px]">{sort.order === 'desc' ? '▼' : '▲'}</span>
          )}
        </span>
      </th>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title={pieMode === 'options' ? '期权市值分布' : pieMode === 'symbols' ? '个股市值分布' : '持仓市值分布'}>
          <div className="mb-3 flex gap-2">
            {[
              { key: 'positions', label: '分类' },
              { key: 'symbols', label: '个股' },
              { key: 'options', label: '期权' },
            ].map((m) => (
              <button
                key={m.key}
                onClick={() => setPieMode(m.key)}
                className={`rounded border px-3 py-1 text-xs font-medium ${
                  pieMode === m.key ? 'bg-black text-white' : 'border-[var(--light-gray)] bg-white text-[var(--gray)]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <PositionPie positions={allPositions} mode={pieMode} totalCash={totalCash} />
        </Card>
        <Card title="持仓概览">
          <PositionPieStats positions={allPositions} mode={pieMode} totalCash={totalCash} />
        </Card>
      </div>

      <Card title="⚠️ 期权到期提醒">
        <OptionExpiry options={data.openPositions?.options || []} />
      </Card>

      <Card title="持仓明细">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--gray)]">类型</span>
            {TYPE_OPTIONS.map((t) => (
              <button
                key={t.key}
                onClick={() =>
                  setSelectedTypes((prev) =>
                    prev.includes(t.key) ? prev.filter((x) => x !== t.key) : [...prev, t.key]
                  )
                }
                className={`rounded border px-3 py-1 text-xs font-medium transition ${
                  selectedTypes.includes(t.key)
                    ? 'bg-black text-white'
                    : 'border-[var(--light-gray)] bg-white text-[var(--gray)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--gray)]">成本价</span>
            {[
              { key: 'avg', label: '移动加权' },
              { key: 'diluted', label: '摊薄成本' },
            ].map((m) =>(
              <button
                key={m.key}
                onClick={() => setCostMode(m.key)}
                className={`rounded border px-3 py-1 text-xs font-medium transition ${
                  costMode === m.key
                    ? 'bg-black text-white'
                    : 'border-[var(--light-gray)] bg-white text-[var(--gray)]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3 text-sm">
          筛选结果: <span className="font-semibold">{filteredPositions.length}</span> 只持仓
          <span className="mx-2 text-[var(--gray)]">|</span>
          总市值: <span className="font-semibold">{fmtCur(filteredPositions.reduce((s, p) => s + (p.positionValue || 0), 0))}</span>
          <span className="mx-2 text-[var(--gray)]">|</span>
          未实现盈亏:
          <span className={`ml-1 font-semibold ${totalUnrealized >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
            {totalUnrealized >= 0 ? '+' : ''}{fmtCur(totalUnrealized)}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                <SortHeader label="标的" sortKey="symbol" />
                <SortHeader label="类型" sortKey="assetCategory" />
                <th className="py-2">币种</th>
                <th className="py-2 text-right">数量</th>
                <th className="py-2 text-right">成本价</th>
                <th className="py-2 text-right">市价</th>
                <SortHeader label="市值" sortKey="positionValue" />
                <SortHeader label="未实现盈亏" sortKey="unrealized" />
                <SortHeader label="盈亏%" sortKey="gainPct" />
              </tr>
            </thead>
            <tbody>
              {sortedPositions.map((p) => (
                <tr key={p.symbol} className="border-b border-[var(--lighter-gray)]">
                  <td className="py-2 font-medium">{p.symbol}</td>
                  <td className="py-2">{p.assetCategory || p.assetType}</td>
                  <td className="py-2">{p.currency}</td>
                  <td className="py-2 text-right">{p.qty.toFixed(2)}</td>
                  <td className="py-2 text-right">{fmtCur(p.costPrice)}</td>
                  <td className="py-2 text-right">{fmtCur(p.markPrice || 0)}</td>
                  <td className="py-2 text-right">{fmtCur(p.positionValue || 0)}</td>
                  <td className={`py-2 text-right font-semibold ${p.unrealized >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                    {p.unrealized >= 0 ? '+' : ''}{fmtCur(p.unrealized)}
                  </td>
                  <td className={`py-2 text-right font-semibold ${p.gainPct >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                    {p.gainPct >= 0 ? '+' : ''}{p.gainPct.toFixed(2)}%
                  </td>
                </tr>
              ))}
              {!sortedPositions.length && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-[var(--gray)]">无匹配持仓</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <PositionPnl positions={filteredPositions} costMode={costMode} />

      <Card title="融券/借券明细 (Net Stock Position)">
        <NetStockPositionTable data={data} />
      </Card>

      <Card title="持仓集中度分析">
        {(() => {
          const pa = data.positionAttribution;
          const c = pa?.concentration || {};
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="rounded-lg border border-[var(--lighter-gray)] p-4">
                  <div className="text-xs text-[var(--gray)]">总持仓数</div>
                  <div className="text-xl font-semibold">{c.totalPositions ?? 0}</div>
                </div>
                <div className="rounded-lg border border-[var(--lighter-gray)] p-4">
                  <div className="text-xs text-[var(--gray)]">总市值</div>
                  <div className="text-xl font-semibold">{fmtCur(c.totalMarketValue || 0)}</div>
                </div>
                <div className="rounded-lg border border-[var(--lighter-gray)] p-4">
                  <div className="text-xs text-[var(--gray)]">CR5 集中度</div>
                  <div className={`text-xl font-semibold ${(c.cr5 || 0) > 20 ? 'text-[var(--danger)]' : ''}`}>
                    {fmtNum(c.cr5 || 0, 2)}%
                  </div>
                  {(c.cr5 || 0) > 20 && <div className="mt-1 text-xs text-[var(--danger)]">仓位过度集中</div>}
                </div>
                <div className="rounded-lg border border-[var(--lighter-gray)] p-4">
                  <div className="text-xs text-[var(--gray)]">CR10 集中度</div>
                  <div className="text-xl font-semibold">{fmtNum(c.cr10 || 0, 2)}%</div>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span>CR5</span>
                    <span>{fmtNum(c.cr5 || 0, 2)}%</span>
                  </div>
                  <div className="h-2 w-full rounded bg-[var(--lighter-gray)]">
                    <div className="h-2 rounded bg-[var(--danger)]" style={{ width: `${Math.min(100, Math.max(0, c.cr5 || 0))}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span>CR10</span>
                    <span>{fmtNum(c.cr10 || 0, 2)}%</span>
                  </div>
                  <div className="h-2 w-full rounded bg-[var(--lighter-gray)]">
                    <div className="h-2 rounded bg-black" style={{ width: `${Math.min(100, Math.max(0, c.cr10 || 0))}%` }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </Card>

      <Card title="持仓收益贡献榜">
        {(() => {
          const pa = data.positionAttribution;
          const topContributors = pa?.topContributors || [];
          const topDrags = pa?.topDrags || [];
          return (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <div className="mb-3 text-base font-semibold">🏆 TOP 盈利贡献</div>
                {topContributors.length === 0 ? (
                  <p className="text-sm text-[var(--gray)]">暂无盈利贡献数据</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                          <th className="py-2">标的</th>
                          <th className="py-2">市值</th>
                          <th className="py-2">未实现盈亏</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topContributors.slice(0, 10).map((item, i) => (
                          <tr key={i} className="border-b border-[var(--lighter-gray)]">
                            <td className="py-2 font-medium">{item.symbol || '-'}</td>
                            <td className="py-2">{fmtCur(item.marketValue || 0)}</td>
                            <td className="py-2 font-semibold text-[var(--success)]">+{fmtCur(item.unrealizedPnl || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div>
                <div className="mb-3 text-base font-semibold">📉 TOP 亏损拖累</div>
                {topDrags.length === 0 ? (
                  <p className="text-sm text-[var(--gray)]">暂无亏损拖累数据</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                          <th className="py-2">标的</th>
                          <th className="py-2">市值</th>
                          <th className="py-2">未实现盈亏</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topDrags.slice(0, 10).map((item, i) => (
                          <tr key={i} className="border-b border-[var(--lighter-gray)]">
                            <td className="py-2 font-medium">{item.symbol || '-'}</td>
                            <td className="py-2">{fmtCur(item.marketValue || 0)}</td>
                            <td className="py-2 font-semibold text-[var(--danger)]">{fmtCur(item.unrealizedPnl || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Card>

      <Card title="再平衡信号">
        {(() => {
          const pa = data.positionAttribution;
          const signals = pa?.rebalanceSignals || [];
          if (signals.length === 0) {
            return <p className="text-sm text-[var(--gray)]">所有持仓权重在目标范围内，无需再平衡</p>;
          }
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                    <th className="py-2">标的</th>
                    <th className="py-2">当前权重</th>
                    <th className="py-2">目标权重</th>
                    <th className="py-2">偏离度</th>
                    <th className="py-2">操作建议</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.slice(0, 10).map((s, i) => (
                    <tr key={i} className="border-b border-[var(--lighter-gray)]">
                      <td className="py-2 font-medium">{s.symbol || '-'}</td>
                      <td className="py-2">{(s.currentWeight || 0).toFixed(2)}%</td>
                      <td className="py-2">{(s.targetWeight || 0).toFixed(2)}%</td>
                      <td className="py-2">{fmtNum(s.deviation || 0, 2)}%</td>
                      <td className="py-2">
                        {s.action === '减持' ? (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">减持</span>
                        ) : s.action === '增持' ? (
                          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">增持</span>
                        ) : (
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">{s.action || '-'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Card>

      <Card title="历史持仓时间轴">
        <PositionTimeline data={data} />
      </Card>
      <Card title="风险雷达">
        <RiskRadar data={data} />
      </Card>
      <Card title="期权策略透视">
        <OptionsStrategyLens data={data} />
      </Card>
      <Card title="公司行动">
        <CorporateActionTimeline data={data} />
      </Card>
    </div>
  );
}

function NetStockPositionTable({ data }) {
  const [page, setPage] = useState(1);
  const rows = (data.netStockPositions || []).slice(0, 200);
  if (!rows.length) return <p className="text-sm text-[var(--gray)]">暂无融券/借券数据</p>;

  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="mb-2 text-xs text-[var(--gray)]">共 {rows.length} 条记录</div>
      <div className="max-h-[320px] overflow-auto rounded-lg border border-[var(--light-gray)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
              <th className="py-2 pl-3">日期</th>
              <th className="py-2">标的</th>
              <th className="py-2">描述</th>
              <th className="py-2">币种</th>
              <th className="py-2 text-right">IB 持有股数</th>
              <th className="py-2 text-right">借入股数</th>
              <th className="py-2 text-right">借出股数</th>
              <th className="py-2 pr-3 text-right">净股数</th>
            </tr>
          </thead>
          <tbody>
            {currentRows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--lighter-gray)]">
                <td className="py-2 pl-3">{fmtDate(r.reportDate)}</td>
                <td className="py-2 font-medium">{r.symbol}</td>
                <td className="py-2 text-[var(--gray)]">{r.description || '-'}</td>
                <td className="py-2">{r.currency || '-'}</td>
                <td className="py-2 text-right">{fmtNum(r.sharesAtIb, 0)}</td>
                <td className="py-2 text-right">{fmtNum(r.sharesBorrowed, 0)}</td>
                <td className="py-2 text-right">{fmtNum(r.sharesLent, 0)}</td>
                <td className={`py-2 pr-3 text-right font-semibold ${r.netShares >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                  {fmtNum(r.netShares, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded border border-[var(--light-gray)] px-3 py-1 text-xs font-medium disabled:opacity-40 hover:border-black"
          >
            上一页
          </button>
          <span className="text-xs text-[var(--gray)]">
            第 {page} / {totalPages} 页
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="rounded border border-[var(--light-gray)] px-3 py-1 text-xs font-medium disabled:opacity-40 hover:border-black"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
