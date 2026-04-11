import { fmtCur, fmtNum, fmtPct } from '../utils/format';

export default function OrderExecutionPanel({ data }) {
  const exec = data?.orderExecution || {};
  const summary = exec.summary || {};
  const bySymbol = exec.bySymbol || [];
  const byExchange = exec.byExchange || [];
  const byHour = exec.byHour || [];

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">订单执行质量</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="总订单" value={summary.totalOrders || 0} />
        <Stat label="成交率" value={fmtPct(summary.fillRate)} />
        <Stat label="平均滑点" value={`${fmtNum(summary.avgSlippagePct, 4)}%`} />
        <Stat label="滑点样本" value={summary.slippageSampleSize || 0} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SimpleTable title="按标的" rows={bySymbol.slice(0, 5)} cols={[{k:'symbol',l:'标的'},{k:'tradeCount',l:'次数'}]} />
        <SimpleTable title="按交易所" rows={byExchange.slice(0, 5)} cols={[{k:'exchange',l:'交易所'},{k:'tradeCount',l:'次数'}]} />
        <SimpleTable title="按时段" rows={byHour.slice(0, 5)} cols={[{k:'hour',l:'小时'},{k:'tradeCount',l:'次数'}]} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded border border-[var(--light-gray)] p-2 text-center">
      <div className="text-xs text-[var(--gray)]">{label}</div>
      <div className="text-base font-bold">{value}</div>
    </div>
  );
}

function SimpleTable({ title, rows, cols }) {
  return (
    <div className="rounded border border-[var(--light-gray)] p-2">
      <div className="mb-1 text-xs font-semibold">{title}</div>
      <div className="max-h-[140px] overflow-auto space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex justify-between text-xs">
            <span>{r[cols[0].k]}</span>
            <span className="text-[var(--gray)]">{r[cols[1].k]}</span>
          </div>
        ))}
        {!rows.length && <div className="text-xs text-[var(--gray)]">暂无数据</div>}
      </div>
    </div>
  );
}
