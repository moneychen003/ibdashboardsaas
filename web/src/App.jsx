import { useEffect, useState } from 'react';
import { Routes, Route, useParams, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useDashboardStore } from './stores/dashboardStore';
import Layout from './components/Layout';
import OverviewTab from './components/tabs/OverviewTab';
import PerformanceTab from './components/tabs/PerformanceTab';
import PositionsTab from './components/tabs/PositionsTab';
import DetailsTab from './components/tabs/DetailsTab';
import ChangesTab from './components/tabs/ChangesTab';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AdminPage from './pages/AdminPage';
import HelpPage from './pages/HelpPage';

function DashboardRoute() {
  const { account, tab } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const initAuth = useDashboardStore((s) => s.initAuth);
  const loadAccounts = useDashboardStore((s) => s.loadAccounts);
  const loadOverview = useDashboardStore((s) => s.loadOverview);
  const loadTabData = useDashboardStore((s) => s.loadTabData);
  const currentAccount = useDashboardStore((s) => s.currentAccount);
  const activeTab = useDashboardStore((s) => s.activeTab);
  const loading = useDashboardStore((s) => s.loading);
  const tabLoading = useDashboardStore((s) => s.tabLoading);
  const error = useDashboardStore((s) => s.error);
  const accounts = useDashboardStore((s) => s.accounts);
  const setStoreFromUrl = useDashboardStore((s) => s.setStoreFromUrl);

  useEffect(() => {
    initAuth().then(() => loadAccounts());
  }, []);

  useEffect(() => {
    const resolvedAccount = account || 'combined';
    const resolvedTab = tab || 'overview';
    setStoreFromUrl(resolvedAccount, resolvedTab);
  }, [account, tab]);

  useEffect(() => {
    if (currentAccount) {
      loadOverview(currentAccount);
    }
  }, [currentAccount]);

  useEffect(() => {
    if (currentAccount && activeTab) {
      loadTabData(activeTab, currentAccount);
    }
  }, [activeTab, currentAccount]);

  useEffect(() => {
    if (!accounts.length) return;
    const targetAccount = account || currentAccount || 'combined';
    const targetTab = tab || 'overview';
    const expectedPath = `/${targetAccount}/${targetTab}`;
    if (location.pathname !== expectedPath) {
      navigate(expectedPath + location.search, { replace: true });
    }
  }, [account, tab, currentAccount, accounts.length, location.pathname, navigate]);

  const loadedSlices = useDashboardStore((s) => s.loadedSlices);
  const isTabLoading = !!tabLoading[activeTab];
  const sliceMap = { overview: 'overview', positions: 'positions', performance: 'performance', details: 'details', changes: 'changes' };
  const isSliceReady = loadedSlices[sliceMap[activeTab]] === currentAccount;
  const showLoading = loading || (isTabLoading && !isSliceReady);

  return (
    <Layout>
      {showLoading && (
        <div className="py-20 text-center text-[var(--gray)]">
          <div className="mb-4 text-2xl">加载中...</div>
        </div>
      )}
      {error && !showLoading && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
          <div className="font-semibold">数据加载失败</div>
          <div className="mt-1 text-sm">{error}</div>
        </div>
      )}
      {!showLoading && !error && (
        <>
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'performance' && <PerformanceTab />}
          {activeTab === 'positions' && <PositionsTab />}
          {activeTab === 'details' && <DetailsTab />}
          {activeTab === 'changes' && <ChangesTab />}
        </>
      )}
      {isTabLoading && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-[var(--light-gray)] bg-white px-3 py-2 text-xs text-[var(--gray)] shadow">
          正在加载 {activeTab} 数据...
        </div>
      )}
    </Layout>
  );
}

function RequireAuth({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/" element={<DashboardRoute />} />
      <Route path="/:account" element={<DashboardRoute />} />
      <Route path="/:account/:tab" element={<DashboardRoute />} />
    </Routes>
  );
}
