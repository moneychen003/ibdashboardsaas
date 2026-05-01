import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, PieChart } from 'lucide-react';
import { useDashboardStore } from '../../stores/dashboardStore';
import { api } from '../../api';

function fmtMoney(v) {
  const n = Number(v || 0);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtPct(v, d = 1) {
  return v == null ? '-' : Number(v).toFixed(d) + '%';
}

export default function MyPortfoliosCard() {
  const currentAccount = useDashboardStore((s) => s.currentAccount);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);
  const [view, setView] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!currentAccount) return;
    let cancelled = false;
    api.dashboardPortfolios(currentAccount)
      .then((d) => { if (!cancelled) setView(d.portfolios); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentAccount]);

  if (!view || !view.hasDefinitions) return null;
  const portfolios = view.portfolios || [];
  if (!portfolios.length) return null;

  function gotoTab() {
    if (typeof setActiveTab === 'function') setActiveTab('portfolios');
    navigate(`/${currentAccount}/portfolios`);
  }

  return (
    <div className="bg-white rounded-2xl border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-700 flex items-center gap-2">
          <PieChart size={16} className="text-violet-500" />
          我的组合
        </h3>
        <button className="text-xs text-violet-600 hover:underline" onClick={gotoTab}>查看全部 →</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {portfolios.map((p) => {
          const dev = p.deviationPct;
          const devBad = dev != null && Math.abs(dev) > 5;
          return (
            <button key={p.id} className="text-left p-3 rounded-xl border bg-gray-50/50 hover:bg-violet-50 hover:border-violet-200 transition-all" onClick={gotoTab}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                <span className="font-medium text-sm truncate">{p.name}</span>
                {p.isCash && <Wallet size={10} className="text-gray-400 flex-shrink-0" />}
              </div>
              <div className="text-base font-semibold leading-tight">{fmtMoney(p.currentValue)}</div>
              <div className="mt-1 text-xs text-gray-500 flex items-center justify-between gap-1">
                <span>占 {fmtPct(p.currentPct)}</span>
                {p.targetPct != null && (
                  <span className={devBad ? 'text-orange-600' : 'text-emerald-600'}>
                    目标 {fmtPct(p.targetPct, 0)}
                  </span>
                )}
              </div>
              {p.targetPct != null && (
                <div className="mt-1 h-1 bg-gray-200 rounded overflow-hidden">
                  <div className="h-full transition-all" style={{
                    width: `${Math.min(100, (p.currentPct / p.targetPct) * 100)}%`,
                    backgroundColor: devBad ? '#f97316' : (p.color || '#10b981')
                  }} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
