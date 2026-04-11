import { fmtCur } from '../utils/format';

export default function WashSaleAlerts({ data }) {
  const ws = data?.washSaleAlerts || {};
  const alerts = ws.potentialWashSales || [];
  const ops = ws.taxLossHarvestingOpportunities || [];

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">税务优化提醒</div>

      {alerts.length > 0 && (
        <div className="rounded border border-orange-200 bg-orange-50 p-3">
          <div className="mb-2 text-xs font-semibold text-orange-700">
            潜在 Wash Sale 警告 ({alerts.length} 条)
          </div>
          <div className="max-h-[160px] overflow-auto space-y-2">
            {alerts.slice(0, 5).map((a, i) => (
              <div key={i} className="text-xs">
                <span className="font-medium">{a.symbol}</span> · 卖出 {a.sellDate} · 亏损 {fmtCur(a.lossAmount)} ·
                <span className="text-red-600"> {a.daysGap} 天后又买入</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ops.length > 0 && (
        <div className="rounded border border-green-200 bg-green-50 p-3">
          <div className="mb-2 text-xs font-semibold text-green-700">Tax Loss Harvesting 机会</div>
          <div className="max-h-[160px] overflow-auto space-y-2">
            {ops.slice(0, 5).map((o, i) => (
              <div key={i} className="text-xs">
                <span className="font-medium">{o.symbol}</span> · 可抵扣亏损 {fmtCur(o.lossAmount)} · {o.note}
              </div>
            ))}
          </div>
        </div>
      )}

      {!alerts.length && !ops.length && (
        <div className="text-sm text-[var(--gray)]">暂无税务相关提醒</div>
      )}
    </div>
  );
}
