import { create } from 'zustand';
import { api } from '../api';

export const useDashboardStore = create((set, get) => ({
  // Auth
  auth: null,
  setAuth: (auth) => set({ auth }),

  // Accounts
  accounts: [],
  currentAccount: 'combined',
  setCurrentAccount: (acc) => set({ currentAccount: acc }),

  // Data
  data: null,
  loading: false,
  error: null,
  tabLoading: {},
  loadedSlices: {},

  // UI State
  currentCurrency: 'BASE',
  setCurrentCurrency: (c) => set({ currentCurrency: c }),
  currentNavRange: 'nav1Year',
  setCurrentNavRange: (r) => set({ currentNavRange: r }),
  customNavStart: null,
  setCustomNavStart: (date) => set({ customNavStart: date }),
  customNavEnd: null,
  setCustomNavEnd: (date) => set({ customNavEnd: date }),
  activeTab: 'overview',
  setActiveTab: (t) => set({ activeTab: t }),

  // Settings visibility
  settingsOpen: false,
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),

  // Upload triggers (registered by Layout)
  uploadXmlFn: null,
  uploadFolderFn: null,
  registerUploadFns: (xmlFn, folderFn) => set({ uploadXmlFn: xmlFn, uploadFolderFn: folderFn }),
  triggerUploadXml: () => { const fn = get().uploadXmlFn; if (fn) fn(); },
  triggerUploadFolder: () => { const fn = get().uploadFolderFn; if (fn) fn(); },
  uploadHistoryVersion: 0,
  bumpUploadHistory: () => set((s) => ({ uploadHistoryVersion: s.uploadHistoryVersion + 1 })),

  // Public config (guest tab visibility)
  publicConfig: null,
  loadPublicConfig: async () => {
    try {
      const cfg = await api.adminConfig();
      set({ publicConfig: cfg.public || null });
    } catch (e) {
      // ignore permission errors
    }
  },
  savePublicConfig: async (publicCfg) => {
    await api.saveAdminConfig({ public: publicCfg });
    set({ publicConfig: publicCfg });
  },

  // Admin / System State
  systemStatus: null,
  imports: { list: [], total: 0 },
  backups: [],
  dqReport: null,
  refreshJob: null,
  loadSystemStatus: async () => {
    try {
      const status = await api.status();
      set({ systemStatus: status });
    } catch (e) {
      // ignore
    }
  },
  loadImports: async (offset = 0, limit = 20) => {
    try {
      const data = await api.adminImports(`?offset=${offset}&limit=${limit}`);
      set({ imports: { list: data.imports || [], total: data.total || 0 } });
    } catch (e) {
      // ignore
    }
  },
  loadBackups: async () => {
    try {
      const data = await api.adminBackups();
      set({ backups: data.backups || [] });
    } catch (e) {
      // ignore
    }
  },
  loadDQReport: async () => {
    try {
      const data = await api.latestDQ();
      set({ dqReport: data });
    } catch (e) {
      // ignore
    }
  },
  triggerRefresh: async () => {
    try {
      const result = await api.refresh();
      const jobId = result.jobId;
      if (!jobId) return;
      set({ refreshJob: { jobId, status: 'running', message: '刷新中...' } });
      const poll = setInterval(async () => {
        try {
          const job = await fetch(`/api/jobs/${jobId}`).then((r) => r.json());
          if (job.status === 'done') {
            clearInterval(poll);
            set({ refreshJob: { jobId, status: 'done', message: '刷新完成' } });
            get().loadSystemStatus();
          } else if (job.status === 'failed') {
            clearInterval(poll);
            set({ refreshJob: { jobId, status: 'failed', message: job.error || '刷新失败' } });
          }
        } catch (e) {
          clearInterval(poll);
          set({ refreshJob: { jobId, status: 'failed', message: '轮询失败' } });
        }
      }, 1500);
      // auto stop after 5 minutes
      setTimeout(() => {
        clearInterval(poll);
        set((s) => {
          if (s.refreshJob?.status === 'running') {
            return { refreshJob: { jobId, status: 'timeout', message: '刷新超时，请稍后查看状态' } };
          }
          return {};
        });
      }, 300000);
    } catch (e) {
      set({ refreshJob: { status: 'failed', message: e.message || '请求失败' } });
    }
  },

  // URL sync
  setStoreFromUrl: (account, tab) => {
    set({
      currentAccount: account,
      activeTab: tab,
      // Don't clear data/loadedSlices if only tab changed on same account
    });
  },

  // Actions
  initAuth: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ auth: null });
      return;
    }
    try {
      const auth = await api.me();
      set({ auth: { ...auth.user, modules: { overview: true, performance: true, positions: true, details: true, changes: true } } });
    } catch (e) {
      localStorage.removeItem('token');
      set({ auth: null });
    }
  },

  loadAccounts: async () => {
    const { accounts } = await api.accounts(get()._adminParams());
    set({ accounts });
    const current = get().currentAccount;
    // Only default to combined if no account is currently selected
    if (!current || current === 'combined') {
      const def = accounts.find((a) => a.isDefault) || accounts[0];
      if (def) {
        set({ currentAccount: def.alias });
      } else {
        // No accounts yet: fallback to demo combined view
        set({ currentAccount: 'combined' });
      }
    }
  },

  _adminParams: () => {
    // Don't gate on auth.is_admin: initAuth resolves async and dashboard slice
    // calls fire before it. Backend _resolve_preview_user_id already validates
    // the caller is an admin before honoring the param, so it is safe to always
    // forward when present.
    const params = new URLSearchParams(window.location.search);
    const previewUser = params.get('admin_preview_user');
    if (previewUser) {
      return `?preview_user_id=${encodeURIComponent(previewUser)}`;
    }
    return '';
  },

  loadOverview: async (alias) => {
    const target = alias || get().currentAccount;
    set({ loading: true, error: null });
    try {
      const payload = await api.dashboardOverview(target, get()._adminParams());
      set((s) => ({
        data: { ...(s.data || {}), ...payload },
        loading: false,
        loadedSlices: { ...s.loadedSlices, overview: target }
      }));
    } catch (e) {
      set({ error: e.message, loading: false });
    }
  },

  loadTabData: async (tab, alias) => {
    const target = alias || get().currentAccount;
    const sliceMap = {
      overview: 'overview',
      positions: 'positions',
      performance: 'performance',
      details: 'details',
      changes: 'changes',
      tax: 'tax',
      chengji: 'chengji',
      portfolios: 'portfolios'
    };
    const sliceName = sliceMap[tab];
    if (!sliceName) return;

    // If account changed, clear data and loaded slices for the new account context
    const prevLoaded = get().loadedSlices;
    if (prevLoaded.overview && prevLoaded.overview !== target) {
      set({ data: null, loadedSlices: {} });
    }

    if (prevLoaded[sliceName] === target) return;

    set((s) => ({ tabLoading: { ...s.tabLoading, [tab]: true } }));
    try {
      let payload;
      if (tab === 'overview') {
        payload = await api.dashboardOverview(target, get()._adminParams());
      } else if (tab === 'positions') {
        payload = await api.dashboardPositions(target, get()._adminParams());
      } else if (tab === 'performance') {
        payload = await api.dashboardPerformance(target, get()._adminParams());
      } else if (tab === 'details') {
        payload = await api.dashboardDetails(target, get()._adminParams());
      } else if (tab === 'changes') {
        payload = await api.dashboardChanges(target, get()._adminParams());
      } else if (tab === 'tax') {
        payload = await api.dashboardTax(target, get()._adminParams());
      } else if (tab === 'chengji') {
        payload = await api.dashboardChengji(target, get()._adminParams());
      } else if (tab === 'portfolios') {
        payload = await api.dashboardPortfolios(target, get()._adminParams());
      }
      set((s) => ({
        data: { ...(s.data || {}), ...payload },
        tabLoading: { ...s.tabLoading, [tab]: false },
        loadedSlices: { ...s.loadedSlices, [sliceName]: target }
      }));
    } catch (e) {
      set((s) => ({
        tabLoading: { ...s.tabLoading, [tab]: false },
        error: e.message
      }));
    }
  },

  switchAccount: (alias) => {
    set({ currentAccount: alias, data: null, loadedSlices: {}, error: null });
    // Navigation is handled by Layout via react-router navigate
  },

  // Back-compat alias for any code still calling loadDashboard
  loadDashboard: async (alias) => {
    await get().loadOverview(alias);
  }
}));
