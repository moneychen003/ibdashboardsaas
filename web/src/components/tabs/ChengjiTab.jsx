import { useMemo, useState, useEffect } from 'react';
import {
  Briefcase, Target, ChevronDown, ChevronRight,
  CheckCircle, Zap, Hourglass, Layers, Activity, Trophy,
} from 'lucide-react';
import { useDashboardStore } from '../../stores/dashboardStore';
import { api } from '../../api';
import { buildSymbolDigests, buildPortfolioOverview } from '../../lib/portfolio-digest';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'has-position', label: '仅持仓' },
  { key: 'has-options', label: '仅期权' },
  { key: 'profitable', label: '🟢 摊薄盈利' },
  { key: 'losing', label: '🔴 摊薄亏损' },
];

const SORTS = [
  { key: 'activity', label: '操作活跃度' },
  { key: 'pnl-desc', label: '期权 PnL ↓' },
  { key: 'pnl-asc', label: '期权 PnL ↑' },
  { key: 'premium', label: '累计权利金' },
  { key: 'operations', label: '操作笔数' },
  { key: 'value', label: '持仓市值' },
];

function fmt(n, digits = 0) {
  return Number(n || 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}
function fmtMoney(n, digits = 0) {
  const v = Number(n || 0);
  const sign = v >= 0 ? '' : '-';
  return `${sign}$${fmt(Math.abs(v), digits)}`;
}
function fmtDate(s) {
  if (!s || s.length < 8) return s || '';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
function fmtContract(sym) {
  const m = sym.match(/^([A-Z.]+)\s+(\d{6})([CP])(\d{8})$/);
  if (m) {
    const [, , ymd, pc, strikeRaw] = m;
    const strike = parseInt(strikeRaw, 10) / 1000;
    return `${ymd.slice(2, 4)}/${ymd.slice(4, 6)} ${pc}${strike}`;
  }
  return sym.trim();
}

export default function ChengjiTab() {
  const data = useDashboardStore((s) => s.data);
  const currentAccount = useDashboardStore((s) => s.currentAccount);
  const [fullData, setFullData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('activity');
  const [expanded, setExpanded] = useState(new Set());

  // 检查现有 data 是否含战绩需要的字段
  const hasAll = data
    && Array.isArray(data.trades)
    && Array.isArray(data.soldAnalysis)
    && data.optionEaeEvents
    && Array.isArray(data.costBasisHoldings);

  const effective = hasAll ? data : fullData;

  useEffect(() => {
    if (!hasAll && currentAccount && !fullData && !loading) {
      setLoading(true);
      api.dashboard(currentAccount)
        .then(setFullData)
        .catch((e) => console.error('chengji fetch failed', e))
        .finally(() => setLoading(false));
    }
  }, [hasAll, currentAccount, fullData, loading]);

  const baseCurrency = (effective && effective.baseCurrency) || 'USD';
  const digests = useMemo(() => effective ? buildSymbolDigests(effective) : [], [effective]);
  const overview = useMemo(() => buildPortfolioOverview(digests, baseCurrency), [digests, baseCurrency]);

  const activeDigests = useMemo(() => digests.filter(d => d.contracts.length > 0 || d.hasPosition), [digests]);

  const filtered = useMemo(() => {
    let r = activeDigests;
    switch (filter) {
      case 'has-position': r = r.filter(d => d.hasPosition); break;
      case 'has-options': r = r.filter(d => d.contracts.length > 0); break;
      case 'profitable': r = r.filter(d => d.hasPosition && d.dilutedPct >= 0); break;
      case 'losing': r = r.filter(d => d.hasPosition && d.dilutedPct < 0); break;
    }
    return [...r].sort((a, b) => {
      switch (sortBy) {
        case 'pnl-desc': return b.totalNetPnl - a.totalNetPnl;
        case 'pnl-asc': return a.totalNetPnl - b.totalNetPnl;
        case 'premium': return (b.totalSellPutPremium + b.totalSellCallPremium) - (a.totalSellPutPremium + a.totalSellCallPremium);
        case 'operations': return (b.optionTradeCount + b.stockTradeCount) - (a.optionTradeCount + a.stockTradeCount);
        case 'value': return b.positionValueInBase - a.positionValueInBase;
        default: {
          const aA = a.contracts.length * 3 + a.optionTradeCount + a.stockTradeCount;
          const bA = b.contracts.length * 3 + b.optionTradeCount + b.stockTradeCount;
          if (aA !== bA) return bA - aA;
          return b.positionValueInBase - a.positionValueInBase;
        }
      }
    });
  }, [activeDigests, filter, sortBy]);

  const toggle = (sym) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(sym)) next.delete(sym); else next.add(sym);
    return next;
  });

  if (!effective) {
    return <div className="py-10 text-center text-[var(--gray)]">加载战绩数据中...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Trophy size={20} /> 战绩 · 按标的复盘
          </h2>
          <p className="mt-1 text-sm text-[var(--gray)]">
            每只股票 / 期权合约的累计权利金、净 PnL、被指派次数、当前摊薄盈亏 一卡看完。
          </p>
        </div>
      </div>

      {/* 总览 stats */}
      <section className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="活跃标的" value={`${activeDigests.length}`} sub={`持仓 ${overview.positionCount} 只`} />
        <Stat label="总市值" value={fmtMoney(overview.totalMarketValueInBase, 0)} sub={baseCurrency} positive />
        <Stat
          label="未实现盈亏"
          value={fmtMoney(overview.totalUnrealizedInBase, 0)}
          sub={baseCurrency}
          positive={overview.totalUnrealizedInBase >= 0}
          negative={overview.totalUnrealizedInBase < 0}
        />
        <Stat
          label="期权合约"
          value={`${overview.totalContracts}`}
          sub={`平 ${overview.closedCount} · 派 ${overview.assignmentCount} · 废 ${overview.expirationCount} · 开 ${overview.openCount + overview.partialCount}`}
        />
        <Stat label="累计权利金" value={fmtMoney(overview.totalSellPremium, 0)} sub="USD · sell 总收入" positive />
        <Stat
          label="期权净 PnL"
          value={fmtMoney(overview.totalOptionNetPnl, 0)}
          sub="USD · 含买回成本"
          positive={overview.totalOptionNetPnl >= 0}
          negative={overview.totalOptionNetPnl < 0}
        />
      </section>

      {/* 控件 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-medium text-[var(--gray)]">筛选</span>
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-2.5 py-1 text-xs transition ${
                filter === f.key ? 'bg-black text-white' : 'bg-white text-[var(--gray)] ring-1 ring-[var(--light-gray)] hover:bg-[var(--lighter-gray)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="ml-2 mr-1 text-xs font-medium text-[var(--gray)]">排序</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-lg border border-[var(--light-gray)] bg-white px-2 py-1 text-xs outline-none focus:border-[var(--gray)]"
          >
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <span className="ml-auto text-xs text-[var(--gray)]">
          {filtered.length} / {activeDigests.length} 只
        </span>
      </div>

      {/* 卡片网格 */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--light-gray)] bg-white p-10 text-center text-sm text-[var(--gray)]">
          没有匹配结果
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map(d => (
            <SymbolCard
              key={d.symbol}
              digest={d}
              expanded={expanded.has(d.symbol)}
              onToggle={() => toggle(d.symbol)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, positive, negative }) {
  const cls = positive ? 'text-[var(--success)]' : negative ? 'text-[var(--danger)]' : '';
  return (
    <div className="rounded-xl border border-[var(--light-gray)] bg-white p-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--gray)]">{label}</div>
      <div className={`mt-1 text-base font-bold tracking-tight ${cls}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-[var(--gray)]">{sub}</div>}
    </div>
  );
}

function SymbolCard({ digest: d, expanded, onToggle }) {
  const totalPremium = d.totalSellPutPremium + d.totalSellCallPremium;
  const positivePnl = d.totalNetPnl >= 0;
  const positiveDiluted = d.dilutedPct >= 0;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--light-gray)] bg-white">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between border-b border-[var(--light-gray)] bg-gradient-to-r from-[var(--lighter-gray)] to-white px-5 py-3 text-left transition hover:from-[var(--light-gray)]"
      >
        <div className="flex min-w-0 items-center gap-2">
          {expanded ? <ChevronDown size={14} className="text-[var(--gray)]" /> : <ChevronRight size={14} className="text-[var(--gray)]" />}
          <span className="font-mono text-base font-bold">{d.symbol}</span>
          {d.assetType && (
            <span className="rounded bg-[var(--lighter-gray)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--gray)]">
              {d.assetType}
            </span>
          )}
          {d.currency && d.currency !== 'USD' && (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
              {d.currency}
            </span>
          )}
        </div>
        <span className="truncate text-[10px] text-[var(--gray)]">{d.description}</span>
      </button>

      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--gray)]">
            <Briefcase size={11} /> 当前持仓
          </div>
          {d.hasPosition ? (
            <>
              <div className="text-lg font-semibold tracking-tight">
                {fmt(d.currentQty, 0)} <span className="text-xs text-[var(--gray)]">股</span>
              </div>
              <div className="text-[11px] text-[var(--gray)]">
                @ ${fmt(d.markPrice, 2)} · {fmtMoney(d.positionValue, 0)} {d.currency}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                <span className="text-[var(--gray)]">名义成本</span>
                <span className={`text-right font-mono ${d.mwaPct >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                  ${fmt(d.avgCostPrice, 2)} · {d.mwaPct >= 0 ? '+' : ''}{Number(d.mwaPct).toFixed(2)}%
                </span>
                <span className="text-purple-700">摊薄成本</span>
                <span className={`text-right font-mono font-semibold ${positiveDiluted ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                  ${fmt(d.dilutedCostPrice, 2)} · {positiveDiluted ? '+' : ''}{Number(d.dilutedPct).toFixed(2)}%
                </span>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--light-gray)] p-3 text-center text-[11px] text-[var(--gray)]">
              当前未持仓
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--gray)]">
            <Target size={11} /> 期权累计
          </div>
          {d.contracts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--light-gray)] p-3 text-center text-[11px] text-[var(--gray)]">
              无期权操作
            </div>
          ) : (
            <>
              <div className={`text-lg font-semibold tracking-tight ${positivePnl ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                {positivePnl ? '+' : ''}{fmtMoney(d.totalNetPnl, 0)}
              </div>
              <div className="text-[11px] text-[var(--gray)]">
                {d.contracts.length} 个合约 · 累计权利金 +{fmtMoney(totalPremium, 0)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                <span className="text-[var(--gray)]">Sell Put 收入</span>
                <span className="text-right font-mono text-[var(--success)]">+{fmtMoney(d.totalSellPutPremium, 0)}</span>
                <span className="text-[var(--gray)]">Sell Call 收入</span>
                <span className="text-right font-mono text-[var(--success)]">+{fmtMoney(d.totalSellCallPremium, 0)}</span>
                {d.totalBuyback > 0 && (
                  <>
                    <span className="text-[var(--gray)]">买回成本</span>
                    <span className="text-right font-mono text-[var(--danger)]">-{fmtMoney(d.totalBuyback, 0)}</span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {(d.contracts.length > 0 || d.optionTradeCount > 0 || d.stockTradeCount > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--light-gray)] bg-[var(--lighter-gray)] px-5 py-2.5 text-[10px]">
          {d.closedCount > 0 && <Pill icon={<CheckCircle size={11} />} text={`平仓 ${d.closedCount}`} bg="bg-green-100 text-green-700" />}
          {d.assignmentCount > 0 && <Pill icon={<Zap size={11} />} text={`被指派 ${d.assignmentCount}`} bg="bg-purple-100 text-purple-700" />}
          {d.expirationCount > 0 && <Pill icon={<Hourglass size={11} />} text={`到期 ${d.expirationCount}`} bg="bg-gray-200 text-gray-700" />}
          {d.openCount + d.partialCount > 0 && (
            <Pill icon={<Layers size={11} />} text={`未平 ${d.openCount + d.partialCount}`} bg="bg-amber-100 text-amber-700" />
          )}
          <span className="ml-auto flex items-center gap-1 text-[var(--gray)]">
            <Activity size={11} /> 操作 {d.optionTradeCount + d.stockTradeCount} 笔
          </span>
        </div>
      )}

      {expanded && d.contracts.length > 0 && (
        <div className="border-t border-[var(--light-gray)] bg-[var(--lighter-gray)]/30 px-5 py-3">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--gray)]">
            合约明细 ({d.contracts.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[var(--light-gray)] text-[10px] text-[var(--gray)]">
                  <th className="py-1.5 text-left">合约</th>
                  <th className="py-1.5 text-left">状态</th>
                  <th className="py-1.5 text-right">卖/买</th>
                  <th className="py-1.5 text-right">权利金</th>
                  <th className="py-1.5 text-right">买回</th>
                  <th className="py-1.5 text-right">净 PnL</th>
                  <th className="py-1.5 text-right">日期</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--light-gray)]">
                {d.contracts.slice().sort((a, b) => a.openDate < b.openDate ? 1 : -1).map(c => (
                  <ContractRow key={c.symbol} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ContractRow({ c }) {
  const map = {
    closed: { text: '平仓', bg: 'bg-green-100 text-green-700' },
    assigned: { text: '被指派', bg: 'bg-purple-100 text-purple-700' },
    expired: { text: '到期', bg: 'bg-gray-200 text-gray-700' },
    open: { text: '未平', bg: 'bg-amber-100 text-amber-700' },
    partial: { text: '部分', bg: 'bg-blue-100 text-blue-700' },
  };
  const s = map[c.status] || map.open;
  const positive = c.netPnl >= 0;
  return (
    <tr>
      <td className="py-1.5 font-mono">{fmtContract(c.symbol)}</td>
      <td className="py-1.5">
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${s.bg}`}>{s.text}</span>
      </td>
      <td className="py-1.5 text-right font-mono text-[var(--gray)]">{c.totalSellQty}/{c.totalBuyQty}</td>
      <td className="py-1.5 text-right font-mono text-[var(--success)]">+{fmtMoney(c.totalPremium, 0)}</td>
      <td className="py-1.5 text-right font-mono text-[var(--danger)]">{c.totalBuyback > 0 ? `-${fmtMoney(c.totalBuyback, 0)}` : '—'}</td>
      <td className={`py-1.5 text-right font-mono font-semibold ${positive ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
        {positive ? '+' : ''}{fmtMoney(c.netPnl, 0)}
      </td>
      <td className="py-1.5 text-right text-[10px] text-[var(--gray)]">
        {fmtDate(c.openDate)}
        {c.closeDate && c.closeDate !== c.openDate && <><br />→ {fmtDate(c.closeDate)}</>}
      </td>
    </tr>
  );
}

function Pill({ icon, text, bg }) {
  return (
    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${bg}`}>
      {icon}
      {text}
    </span>
  );
}
