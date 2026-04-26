import { useMemo } from 'react';
import { fmtCur, fmtNum } from '../utils/format';

/**
 * 持仓 tab 饼图卡内嵌：集中度诊断 + 资产类型二级占比条
 */
export function ConcentrationAndAssetType({ data }) {
  const concentration = data?.riskRadar?.concentration || {};
  const bb = data?.balanceBreakdown || {};

  const top1 = Number(concentration.singleStockMaxPct ?? 0);
  const top5 = Number(concentration.top5Pct ?? 0);
  const total = Number(concentration.totalPositions ?? 0);

  const top1Tone = top1 >= 30 ? 'red' : top1 >= 20 ? 'amber' : 'emerald';
  const top5Tone = top5 >= 70 ? 'red' : top5 >= 50 ? 'amber' : 'emerald';
  const totalTone = total <= 10 ? 'amber' : 'emerald';

  // 资产类型占比条（按绝对值算总盘子）
  const assets = [
    { key: 'stock', label: '股票', value: bb.stockValue || 0, color: '#3b82f6' },
    { key: 'etf', label: 'ETF', value: bb.etfValue || 0, color: '#10b981' },
    { key: 'option', label: '期权', value: bb.optionValue || 0, color: '#a855f7' },
    { key: 'cash', label: '现金', value: bb.totalCash || 0, color: '#f59e0b' },
    { key: 'fund', label: '基金', value: bb.fundValue || 0, color: '#06b6d4' },
    { key: 'bond', label: '债券', value: bb.bondValue || 0, color: '#64748b' },
  ];
  const totalAbs = assets.reduce((s, a) => s + Math.abs(a.value), 0);
  const visible = assets.filter((a) => Math.abs(a.value) > 0.01);

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--light-gray)] pt-4">
      {/* 集中度诊断 4 stats */}
      <div>
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--gray)]">
          📊 集中度诊断
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DiagnosticStat
            label="第一重仓"
            value={`${top1.toFixed(2)}%`}
            verdict={
              top1Tone === 'red' ? '过于集中' : top1Tone === 'amber' ? '略偏高' : '健康'
            }
            tone={top1Tone}
          />
          <DiagnosticStat
            label="Top 5"
            value={`${top5.toFixed(2)}%`}
            verdict={
              top5Tone === 'red' ? '集中度高' : top5Tone === 'amber' ? '需关注' : '分散得当'
            }
            tone={top5Tone}
          />
          <DiagnosticStat
            label="总持仓"
            value={`${total} 只`}
            verdict={totalTone === 'amber' ? '偏少' : '充足'}
            tone={totalTone}
          />
          <DiagnosticStat
            label="期权敞口"
            value={fmtCur(Math.abs(bb.optionValue || 0))}
            verdict={(bb.optionValue || 0) < 0 ? '净空头' : '净多头'}
            tone={(bb.optionValue || 0) < 0 ? 'amber' : 'emerald'}
          />
        </div>
      </div>

      {/* 资产类型二级占比条 */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-[var(--gray)]">
          <span>🥧 资产类型分布</span>
          <span className="text-[var(--gray)] normal-case">
            净值 {fmtCur(bb.netLiquidation || 0)}
          </span>
        </div>
        {totalAbs > 0 ? (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-[var(--lighter-gray)]">
              {visible.map((a) => {
                const w = (Math.abs(a.value) / totalAbs) * 100;
                return (
                  <div
                    key={a.key}
                    title={`${a.label}: ${fmtCur(a.value)} (${w.toFixed(1)}%)`}
                    style={{ width: `${w}%`, background: a.color }}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
              {visible.map((a) => {
                const w = (Math.abs(a.value) / totalAbs) * 100;
                return (
                  <span key={a.key} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
                    <span className="text-[var(--gray)]">{a.label}</span>
                    <span className="font-mono font-semibold">{w.toFixed(1)}%</span>
                    <span className="font-mono text-[10px] text-[var(--gray)]">
                      {a.value < 0 ? '-' : ''}{fmtCur(Math.abs(a.value))}
                    </span>
                  </span>
                );
              })}
            </div>
          </>
        ) : (
          <div className="text-xs text-[var(--gray)]">暂无资产明细</div>
        )}
      </div>
    </div>
  );
}

function DiagnosticStat({ label, value, verdict, tone }) {
  const palette = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    red: 'bg-red-50 text-red-700 ring-red-100',
  }[tone];
  return (
    <div className={`rounded-lg p-2 ring-1 ${palette}`}>
      <div className="text-[10px] text-[var(--gray)]">{label}</div>
      <div className="mt-0.5 text-sm font-bold">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium opacity-90">{verdict}</div>
    </div>
  );
}

/**
 * 整行：Top 5 winners + Top 5 losers
 */
export function TopWinnersLosers({ data }) {
  const items = data?.costBasisHoldings || [];

  const sorted = useMemo(() => {
    return items
      .filter((c) => Number(c.currentQty) > 0 && c.dilutedPct != null)
      .map((c) => ({
        symbol: c.symbol,
        description: c.description,
        markPrice: Number(c.markPrice || 0),
        currentQty: Number(c.currentQty || 0),
        dilutedCostPrice: Number(c.dilutedCostPrice || 0),
        dilutedPnl: Number(c.dilutedPnl || 0),
        dilutedPct: Number(c.dilutedPct || 0),
        mwaPct: Number(c.mwaPct || 0),
        mwaPnl: Number(c.mwaPnl || 0),
      }))
      .sort((a, b) => b.dilutedPct - a.dilutedPct);
  }, [items]);

  if (sorted.length === 0) {
    return <div className="text-sm text-[var(--gray)]">暂无持仓</div>;
  }

  const winners = sorted.slice(0, 5);
  const losers = sorted.slice(-5).reverse();

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <RankList title="🟢 摊薄盈利 Top 5" items={winners} positive />
      <RankList title="🔴 摊薄亏损 Top 5" items={losers} positive={false} />
    </div>
  );
}

function RankList({ title, items, positive }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-[var(--gray)]">{title}</div>
      <div className="space-y-1.5">
        {items.map((c) => {
          const pct = c.dilutedPct;
          const pnl = c.dilutedPnl;
          // mini bar 宽度（以 ±60% 为满刻度）
          const w = Math.min(Math.abs(pct) / 60, 1) * 100;
          const color = pct >= 0 ? '#10b981' : '#ef4444';
          return (
            <div key={c.symbol} className="flex items-center gap-2 rounded border border-[var(--light-gray)] bg-white p-2 text-xs">
              <div className="w-16 shrink-0 font-mono font-semibold">{c.symbol}</div>
              <div className="min-w-0 flex-1">
                <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--lighter-gray)]">
                  <div style={{ width: `${w}%`, background: color }} />
                </div>
                <div className="mt-0.5 truncate text-[10px] text-[var(--gray)]">
                  摊薄 ${fmtNum(c.dilutedCostPrice, 2)} → 现 ${fmtNum(c.markPrice, 2)}
                </div>
              </div>
              <div className="text-right">
                <div className={`font-mono text-sm font-bold ${pct >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                </div>
                <div className="font-mono text-[10px] text-[var(--gray)]">
                  {pnl >= 0 ? '+' : ''}{fmtCur(pnl)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
