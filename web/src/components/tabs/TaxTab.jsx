import { useMemo, useState } from 'react';
import { useDashboardStore } from '../../stores/dashboardStore';
import { fmtCur, fmtNum } from '../../utils/format';

function Card({ title, children, sub }) {
  return (
    <div className="rounded-xl border border-[var(--light-gray)] p-6">
      {title && (
        <div className="mb-3">
          <div className="text-lg font-semibold">{title}</div>
          {sub && <div className="mt-1 text-xs text-[var(--gray)]">{sub}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function Stat({ label, value, colorClass = '', sub = null }) {
  return (
    <div className="rounded-xl border border-[var(--light-gray)] p-4">
      <div className="mb-1 text-xs text-[var(--gray)]">{label}</div>
      <div className={`text-xl font-bold ${colorClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--gray)]">{sub}</div>}
    </div>
  );
}

const TAX_PROFILES = [
  { id: 'cn', label: '中国籍（个人）', st: 0, lt: 0, note: '中国目前对个人二级市场股票收益暂免征收个人所得税' },
  { id: 'us-22', label: '美籍 (22% 短期 / 15% 长期)', st: 0.22, lt: 0.15, note: '中等收入区间典型税率' },
  { id: 'us-32', label: '美籍 (32% 短期 / 15% 长期)', st: 0.32, lt: 0.15, note: '高收入区间' },
  { id: 'us-37', label: '美籍 (37% 短期 / 20% 长期)', st: 0.37, lt: 0.20, note: '最高收入区间' },
];

export default function TaxTab() {
  const data = useDashboardStore((s) => s.data);
  const [profileId, setProfileId] = useState('cn');

  if (!data) return <div className="py-10 text-center text-[var(--gray)]">暂无数据</div>;

  const tv = data.taxView || {};
  const baseCurrency = data.baseCurrency || 'USD';
  const profile = TAX_PROFILES.find((p) => p.id === profileId) || TAX_PROFILES[0];

  const realizedYtd = Number(tv.realizedYtd || 0);
  const realizedLt = Number(tv.realizedLtYtd || 0);
  const realizedSt = Number(tv.realizedStYtd || 0);
  const unrealTotal = Number(tv.unrealizedTotal || 0);
  const unrealLt = Number(tv.unrealizedLtEstimate || 0);
  const unrealSt = Number(tv.unrealizedStEstimate || 0);

  // Tax estimate: gains 按对应税率纳税，losses 视为可抵扣（所以税额仍按 gain×rate，但总税额可能为负意味着省税）
  const estRealizedTaxLt = Math.max(0, realizedLt) * profile.lt;
  const estRealizedTaxSt = Math.max(0, realizedSt) * profile.st;
  const estRealizedTax = estRealizedTaxLt + estRealizedTaxSt;

  const estUnrealizedTaxLt = Math.max(0, unrealLt) * profile.lt;
  const estUnrealizedTaxSt = Math.max(0, unrealSt) * profile.st;
  const estUnrealizedTax = estUnrealizedTaxLt + estUnrealizedTaxSt;

  const holdings = tv.unrealizedByHolding || [];

  return (
    <div className="space-y-6">
      <Card
        title="税率档位"
        sub="切换不同税率档位，实时估算已实现 + 若立即清仓未实现的应纳税额。这里只是快速估算，具体请咨询税务师。"
      >
        <div className="flex flex-wrap gap-2">
          {TAX_PROFILES.map((p) => (
            <button
              key={p.id}
              onClick={() => setProfileId(p.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                profileId === p.id
                  ? 'border-black bg-black text-white'
                  : 'border-[var(--light-gray)] bg-white text-[var(--gray)] hover:border-black hover:text-black'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-2 text-xs text-[var(--gray)]">{profile.note}</div>
      </Card>

      <Card title={`已实现盈亏 YTD${tv.realizedAsOf ? ` (${tv.realizedAsOf})` : ''}`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="YTD 合计"
            value={fmtCur(realizedYtd, baseCurrency)}
            colorClass={realizedYtd >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}
          />
          <Stat
            label="短期 (≤365 天)"
            value={fmtCur(realizedSt, baseCurrency)}
            colorClass={realizedSt >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}
            sub={`估税 ${fmtCur(estRealizedTaxSt, baseCurrency)}`}
          />
          <Stat
            label="长期 (>365 天)"
            value={fmtCur(realizedLt, baseCurrency)}
            colorClass={realizedLt >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}
            sub={`估税 ${fmtCur(estRealizedTaxLt, baseCurrency)}`}
          />
          <Stat
            label="预估应纳税 (YTD 已实现)"
            value={fmtCur(estRealizedTax, baseCurrency)}
            colorClass="text-[var(--danger)]"
          />
        </div>
      </Card>

      <Card
        title={`未实现盈亏${tv.asOf ? ` (${tv.asOf})` : ''}`}
        sub={tv.note || null}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="未实现合计"
            value={fmtCur(unrealTotal, baseCurrency)}
            colorClass={unrealTotal >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}
          />
          <Stat
            label="短期 (估算)"
            value={fmtCur(unrealSt, baseCurrency)}
            colorClass={unrealSt >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}
            sub={`若立即清仓估税 ${fmtCur(estUnrealizedTaxSt, baseCurrency)}`}
          />
          <Stat
            label="长期 (估算)"
            value={fmtCur(unrealLt, baseCurrency)}
            colorClass={unrealLt >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}
            sub={`若立即清仓估税 ${fmtCur(estUnrealizedTaxLt, baseCurrency)}`}
          />
          <Stat
            label="合计估税 (若立即清仓)"
            value={fmtCur(estUnrealizedTax, baseCurrency)}
            colorClass="text-[var(--danger)]"
          />
        </div>
      </Card>

      <Card title="持仓明细（按未实现绝对值排序）">
        {holdings.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--gray)]">暂无持仓</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
                  <th className="py-2">标的</th>
                  <th className="py-2 text-right">数量</th>
                  <th className="py-2 text-right">成本价</th>
                  <th className="py-2 text-right">现价</th>
                  <th className="py-2 text-right">市值</th>
                  <th className="py-2 text-right">未实现盈亏</th>
                  <th className="py-2 text-right">最早买入</th>
                  <th className="py-2 text-right">持有天数</th>
                  <th className="py-2">长/短</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={`${h.symbol}-${h.accountId}`} className="border-b border-[var(--lighter-gray)]">
                    <td className="py-2 font-medium">{h.symbol}</td>
                    <td className="py-2 text-right">{fmtNum(h.quantity, 2)}</td>
                    <td className="py-2 text-right text-[var(--gray)]">{fmtNum(h.costBasisPrice, 4)}</td>
                    <td className="py-2 text-right">{fmtNum(h.markPrice, 4)}</td>
                    <td className="py-2 text-right">{fmtCur(h.positionValueInBase, baseCurrency)}</td>
                    <td className={`py-2 text-right font-semibold ${h.unrealizedInBase >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                      {h.unrealizedInBase >= 0 ? '+' : ''}{fmtCur(h.unrealizedInBase, baseCurrency)}
                    </td>
                    <td className="py-2 text-right text-[var(--gray)]">{h.firstBuyDate || '-'}</td>
                    <td className="py-2 text-right">{h.holdingDays || 0}</td>
                    <td className="py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${h.category === 'long' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {h.category === 'long' ? '长期' : '短期'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
