import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useDashboardStore } from '../stores/dashboardStore';
import OverviewTab from '../components/tabs/OverviewTab';
import PositionsTab from '../components/tabs/PositionsTab';
import PerformanceTab from '../components/tabs/PerformanceTab';
import DetailsTab from '../components/tabs/DetailsTab';
import ChangesTab from '../components/tabs/ChangesTab';
import TaxTab from '../components/tabs/TaxTab';

const TAB_COMPONENTS = {
  overview: OverviewTab,
  positions: PositionsTab,
  performance: PerformanceTab,
  details: DetailsTab,
  changes: ChangesTab,
  tax: TaxTab,
};

const TAB_LABELS = {
  overview: '总览',
  positions: '持仓',
  performance: '业绩',
  details: '明细',
  changes: '变动',
  tax: '税务',
};

export default function SharePage() {
  const { token } = useParams();
  const [meta, setMeta] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  const [error, setError] = useState(null);
  const [loadingSlice, setLoadingSlice] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .getShareMeta(token)
      .then((m) => {
        setMeta(m);
        const tabs = m?.allowed_tabs || [];
        setActiveTab(tabs[0] || 'overview');
      })
      .catch((e) => setError(e.message || '链接无效'));
  }, [token]);

  useEffect(() => {
    if (!meta || !activeTab) return;
    setLoadingSlice(true);
    api
      .getShareSlice(token, meta.account_id || 'combined', activeTab)
      .then((d) => useDashboardStore.setState({ data: d }))
      .catch((e) => setError(e.message || '该页未授权'))
      .finally(() => setLoadingSlice(false));
  }, [meta, activeTab, token]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center">
        <div>
          <div className="mb-2 text-2xl">😶</div>
          <div className="text-base font-semibold">{error}</div>
          <div className="mt-2 text-sm text-[var(--gray)]">分享链接可能已过期或被撤销，请联系分享者获取新链接。</div>
          <a href="/" className="mt-4 inline-block text-xs text-[var(--gray)] underline">回到首页</a>
        </div>
      </div>
    );
  }

  if (!meta) {
    return <div className="flex min-h-screen items-center justify-center p-8 text-sm text-[var(--gray)]">加载中...</div>;
  }

  const allowed = meta.allowed_tabs || [];
  const Comp = TAB_COMPONENTS[activeTab];

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-[var(--light-gray)] bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">📊 IB Dashboard</span>
            <span className="rounded bg-[var(--lighter-gray)] px-2 py-0.5 text-xs text-[var(--gray)]">分享只读视图</span>
          </div>
          <a href="https://moneychen.com" className="text-xs text-[var(--gray)] underline hover:text-black">moneychen.com</a>
        </div>
      </header>

      <nav className="border-b border-[var(--light-gray)] bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center gap-1 overflow-x-auto px-6 py-2">
          {allowed.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
                activeTab === t ? 'bg-black text-white' : 'text-[var(--gray)] hover:bg-[var(--lighter-gray)]'
              }`}
            >
              {TAB_LABELS[t] || t}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {loadingSlice && <div className="py-10 text-center text-sm text-[var(--gray)]">加载中...</div>}
        {!loadingSlice && Comp && <Comp />}
        {!loadingSlice && !Comp && <div className="py-10 text-center text-sm text-[var(--gray)]">该页面不可见</div>}
      </main>

      <footer className="mt-12 border-t border-[var(--light-gray)] py-6 text-center text-xs text-[var(--gray)]">
        本页为只读分享，由 IB Dashboard 生成。{meta.expires_at ? `到期时间 ${new Date(meta.expires_at).toLocaleDateString('zh-CN')}` : ''}
      </footer>
    </div>
  );
}
