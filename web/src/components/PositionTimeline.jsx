import { useMemo, useState } from 'react';
import ECharts from './ECharts';
import { fmtCur, fmtNum, fmtDate, parseDate } from '../utils/format';

export default function PositionTimeline({ data }) {
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const timeline = data?.positionTimeline || { symbols: [], holdings: {} };
  const { symbols, holdings } = timeline;

  const sortedSymbols = useMemo(() => {
    return [...symbols].sort((a, b) => {
      const ha = holdings[a] || {};
      const hb = holdings[b] || {};
      return (hb.peakValue || 0) - (ha.peakValue || 0);
    });
  }, [symbols, holdings]);

  const currentHolding = selectedSymbol ? holdings[selectedSymbol] : null;

  const chartOption = useMemo(() => {
    if (!currentHolding || !currentHolding.timeline.length) return null;
    const dates = currentHolding.timeline.map((t) => t.date);
    const qtyData = currentHolding.timeline.map((t) => t.quantity);
    const valData = currentHolding.timeline.map((t) => t.value);

    // Build markPoints for transactions
    const markPoints = currentHolding.transactions
      .filter((tx) => tx.side && tx.side !== 'CORP_ACTION')
      .map((tx) => {
        const idx = dates.indexOf(tx.date);
        if (idx < 0) return null;
        return {
          xAxis: idx,
          yAxis: valData[idx],
          value: tx.side === 'BUY' ? '买' : '卖',
          itemStyle: { color: tx.side === 'BUY' ? '#ef4444' : '#10b981' },
        };
      })
      .filter(Boolean);

    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['持仓市值', '持仓数量'] },
      grid: { left: 60, right: 60, bottom: 40, top: 30 },
      xAxis: { type: 'category', data: dates },
      yAxis: [
        { type: 'value', name: '市值', axisLabel: { formatter: (v) => fmtCur(v, 0) } },
        { type: 'value', name: '数量', axisLabel: { formatter: (v) => fmtNum(v, 0) } },
      ],
      series: [
        {
          name: '持仓市值',
          type: 'line',
          data: valData,
          smooth: true,
          areaStyle: { opacity: 0.1 },
          markPoint: { data: markPoints, symbolSize: 40 },
        },
        {
          name: '持仓数量',
          type: 'line',
          yAxisIndex: 1,
          data: qtyData,
          smooth: true,
          lineStyle: { type: 'dashed' },
        },
      ],
    };
  }, [currentHolding]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">股票时间轴</span>
        <select
          value={selectedSymbol}
          onChange={(e) => setSelectedSymbol(e.target.value)}
          className="rounded border border-[var(--light-gray)] px-2 py-1 text-sm"
        >
          <option value="">选择股票...</option>
          {sortedSymbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {currentHolding && (
          <div className="text-xs text-[var(--gray)]">
            首次持有: {currentHolding.firstDate} | 峰值: {fmtCur(currentHolding.peakValue)} | 交易次数: {currentHolding.transactions?.length || 0}
          </div>
        )}
      </div>

      {chartOption ? (
        <ECharts option={chartOption} style={{ height: 360 }} />
      ) : (
        <div className="flex h-[200px] items-center justify-center rounded border border-[var(--light-gray)] text-sm text-[var(--gray)]">
          请选择一只股票查看持仓演变
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded border border-[var(--light-gray)] p-3">
          <div className="mb-2 text-xs font-semibold text-[var(--gray)]">交易最活跃 Top 5</div>
          <div className="space-y-1">
            {(data?.positionTimeline?.turnoverRank || []).slice(0, 5).map((r, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span>{r.symbol}</span>
                <span className="text-[var(--gray)]">{r.transactions} 笔</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded border border-[var(--light-gray)] p-3">
          <div className="mb-2 text-xs font-semibold text-[var(--gray)]">持仓周期最长 Top 5</div>
          <div className="space-y-1">
            {(data?.positionTimeline?.holdingPeriodRank || []).slice(0, 5).map((r, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span>{r.symbol}</span>
                <span className="text-[var(--gray)]">{r.days} 天</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
