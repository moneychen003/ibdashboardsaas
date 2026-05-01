const API_BASE = '';
const DEFAULT_TIMEOUT = 30000;

function getToken() {
  return localStorage.getItem('token') || '';
}

async function fetchJson(path, options = {}) {
  const controller = new AbortController();
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const timer = setTimeout(() => controller.abort(), timeout);

  const headers = {
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = await resp.text();
      if (resp.status === 401) {
        localStorage.removeItem('token');
        const friendly = token
          ? '登录已过期，请重新登录'
          : '需要先注册账号或登录后才能使用此功能';
        if (typeof window !== 'undefined') {
          try { alert(friendly + '\n\n点击确定前往注册/登录页'); } catch {}
          window.location.href = '/login';
        }
        const e = new Error(friendly);
        e.status = 401;
        throw e;
      }
      // 4xx/5xx：尝试从 JSON body 取后端的 friendly error 字段，没有再 fall back 到原始文本
      let friendlyMsg = '';
      try {
        const j = JSON.parse(err);
        friendlyMsg = j.error || j.message || '';
      } catch {}
      const e = new Error(friendlyMsg || `HTTP ${resp.status}: ${err}`);
      e.status = resp.status;
      throw e;
    }
    return resp.json();
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  // Auth
  login: (data) => fetchJson('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  register: (data) => fetchJson('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  me: () => fetchJson('/api/auth/me'),

  // Dashboard
  accounts: (params = '') => fetchJson('/api/accounts' + params),
  dashboard: (alias, params = '') => fetchJson(`/api/dashboard/${alias}${params}`),
  dashboardOverview: (alias, params = '') => fetchJson(`/api/dashboard/${alias}/overview${params}`),
  dashboardPositions: (alias, params = '') => fetchJson(`/api/dashboard/${alias}/positions${params}`),
  dashboardPerformance: (alias, params = '') => fetchJson(`/api/dashboard/${alias}/performance${params}`),
  dashboardDetails: (alias, params = '') => fetchJson(`/api/dashboard/${alias}/details${params}`),
  dashboardChanges: (alias, params = '') => fetchJson(`/api/dashboard/${alias}/changes${params}`),
  dashboardTax: (alias, params = '') => fetchJson(`/api/dashboard/${alias}/tax${params}`),
  dashboardChengji: (alias, params = '') => fetchJson(`/api/dashboard/${alias}/chengji${params}`),
  dashboardPortfolios: (alias, params = '') => fetchJson(`/api/dashboard/${alias}/portfolios${params}`),
  portfoliosList: () => fetchJson('/api/portfolios'),
  portfolioCreate: (data) => fetchJson('/api/portfolios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  portfolioUpdate: (id, data) => fetchJson(`/api/portfolios/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  portfolioDelete: (id) => fetchJson(`/api/portfolios/${id}`, { method: 'DELETE' }),
  portfolioAddHoldings: (id, symbols) => fetchJson(`/api/portfolios/${id}/holdings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols }) }),
  portfolioRemoveHolding: (id, sym) => fetchJson(`/api/portfolios/${id}/holdings/${encodeURIComponent(sym)}`, { method: 'DELETE' }),
  portfoliosReorder: (ids) => fetchJson('/api/portfolios/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }),
  portfoliosAutoSetup: () => fetchJson('/api/portfolios/auto-setup', { method: 'POST' }),
  portfoliosMatchSuggest: (locale) => fetchJson('/api/portfolios/match-suggest' + (locale ? ('?locale=' + locale) : ''), { method: 'POST', timeout: 90000 }),
  portfoliosMatchApply: (plan) => fetchJson('/api/portfolios/match-apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }), timeout: 60000 }),
  portfoliosClearAutoRules: () => fetchJson('/api/portfolios/clear-auto-rules', { method: 'POST' }),
  portfoliosResetAll: () => fetchJson('/api/portfolios/reset-all', { method: 'POST' }),
  portfolioHoldingTrades: (symbol) => fetchJson(`/api/portfolios/holding-trades/${encodeURIComponent(symbol)}`),
  portfoliosAiSuggest: (locale) => fetchJson('/api/portfolios/ai-suggest' + (locale ? ('?locale=' + locale) : ''), { method: 'POST', timeout: 90000 }),
  portfoliosAiApply: (plan) => fetchJson('/api/portfolios/ai-apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }), timeout: 60000 }),
  portfoliosAiPromptGet: () => fetchJson('/api/portfolios/ai-prompt'),
  portfoliosAiPromptSave: (prompt) => fetchJson('/api/portfolios/ai-prompt', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) }),
  portfolioOptionPnlTimeline: () => fetchJson('/api/portfolios/option-pnl-timeline'),
  portfolioSetStrategyOverride: (symbol, override) => fetchJson(`/api/portfolios/holdings/${encodeURIComponent(symbol)}/strategy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ override }) }),
  portfolioWheelCycles: () => fetchJson('/api/portfolios/wheel-cycles'),
  releaseNotes: () => fetchJson('/api/release-notes'),
  telegramStatus: () => fetchJson('/api/telegram/status'),
  telegramGenerateCode: () => fetchJson('/api/telegram/generate-code', { method: 'POST' }),
  telegramUnbind: (chatId) => fetchJson('/api/telegram/unbind', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId }) }),
  telegramSubscription: (chatId, subscribed) => fetchJson('/api/telegram/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, subscribed }) }),

  // Share links
  createShare: (data) => fetchJson('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  listShares: () => fetchJson('/api/share'),
  deleteShare: (token) => fetchJson(`/api/share/${token}`, { method: 'DELETE' }),
  getShareMeta: (token) => fetch(`/api/share/${token}`).then(r => r.ok ? r.json() : Promise.reject(new Error('链接无效或已过期'))),
  getShareSlice: (token, alias, slice) => fetch(`/api/share/${token}/dashboard/${alias}/${slice}`).then(r => r.ok ? r.json() : Promise.reject(new Error('该页未授权'))),

  // Upload
  uploadXml: (formData) => fetchJson('/api/upload/xml', { method: 'POST', body: formData, timeout: 600000 }),
  uploadXmlWithProgress: (formData, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/upload/xml`);
    const t = getToken();
    if (t) xhr.setRequestHeader('Authorization', `Bearer ${t}`);
    xhr.timeout = 600000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress({ loaded: e.loaded, total: e.total });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch (err) { reject(new Error('Invalid JSON response')); }
      } else {
        if (xhr.status === 401) {
          localStorage.removeItem('token');
          const friendly = t
            ? '登录已过期，请重新登录后再上传'
            : '上传 XML 需要先注册账号并登录，请前往注册/登录页';
          try { alert(friendly + '\n\n点击确定前往注册/登录页'); } catch {}
          window.location.href = '/login';
          reject(new Error(friendly));
          return;
        }
        // 后端的 4xx/5xx 通常带 JSON {error: friendlyMsg}
        let friendlyMsg = '';
        try {
          const j = JSON.parse(xhr.responseText);
          friendlyMsg = j.error || j.message || '';
        } catch {}
        reject(new Error(friendlyMsg || `HTTP ${xhr.status}: ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error('网络中断或连接被重置，请检查网络后重试'));
    xhr.ontimeout = () => reject(new Error('上传超时（10 分钟）：文件可能过大或网络太慢，建议拆分 Flex Query 时间段'));
    xhr.onabort = () => reject(new Error('上传被取消'));
    xhr.send(formData);
  }),
  jobStatus: (jobId) => fetchJson(`/api/jobs/${jobId}`),

  // FlexQuery
  flexCredentialsGet: () => fetchJson('/api/flex-credentials'),
  flexCredentialsSave: (data) => fetchJson('/api/flex-credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  flexCredentialsSync: () => fetchJson('/api/flex-credentials/sync', { method: 'POST' }),
  flexCredentialsLogs: (params = '') => fetchJson(`/api/flex-credentials/sync-logs${params}`),
  flexCredentialsDeleteLog: (logId) => fetchJson(`/api/flex-credentials/sync-logs/${logId}`, { method: 'DELETE' }),
  flexCredentialsCancelSync: () => fetchJson('/api/flex-credentials/sync/cancel', { method: 'POST' }),

  // Admin
  adminUsers: (params = '') => fetchJson(`/api/admin/users${params}`),
  adminUserDetail: (id) => fetchJson(`/api/admin/users/${id}`),
  adminUserUpdate: (id, data) => fetchJson(`/api/admin/users/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  adminUserDelete: (id) => fetchJson(`/api/admin/users/${id}/delete`, { method: 'POST' }),
  adminUploads: (params = '') => fetchJson(`/api/admin/uploads${params}`),
  adminUploadDetail: (id) => fetchJson(`/api/admin/uploads/${id}`),
  adminUploadRetry: (id) => fetchJson(`/api/admin/uploads/${id}/retry`, { method: 'POST' }),
  adminUploadDownload: (id) => `${API_BASE}/api/admin/uploads/${id}/download`,
  adminAccounts: () => fetchJson('/api/admin/accounts'),
  adminAccountStats: (accountId, userId) => fetchJson(`/api/admin/accounts/${accountId}/stats?user_id=${encodeURIComponent(userId)}`),
  adminDashboard: (userId, accountId = 'combined') => fetchJson(`/api/admin/dashboard?user_id=${encodeURIComponent(userId)}&account_id=${encodeURIComponent(accountId)}`),
  adminDataQuality: () => fetchJson('/api/admin/data-quality'),
  adminSystem: () => fetchJson('/api/admin/system'),
  // User uploads
  userUploads: () => fetchJson("/api/uploads"),
  userUploadDelete: (id) => fetchJson(`/api/uploads/${id}`, { method: "DELETE" }),
  userUploadReset: () => fetchJson("/api/uploads/reset", { method: "POST" }),
  adminAuditLogs: (params = '') => fetchJson(`/api/admin/audit-logs${params}`),
  adminConfig: () => fetchJson('/api/admin/config'),
  adminSaveConfig: (data) => fetchJson('/api/admin/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),

  // System / SettingsPanel legacy compatibility
  status: () => fetchJson('/api/system/status'),
  adminImports: (params = '') => fetchJson(`/api/admin/imports${params}`),
  adminBackups: () => fetchJson('/api/admin/backups'),
  restoreBackup: (data) => fetchJson('/api/admin/restore-backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  downloadBackupUrl: (timestamp) => `/api/admin/backups/${timestamp}/download`,
  latestDQ: () => fetchJson('/api/admin/latest-dq'),
  runDQCheck: () => fetchJson('/api/admin/run-dq-check', { method: 'POST' }),
  runCleanup: () => fetchJson('/api/admin/run-cleanup', { method: 'POST' }),
  refresh: () => fetchJson('/api/admin/refresh', { method: 'POST' }),
  testWebhook: () => fetchJson('/api/admin/test-webhook', { method: 'POST' }),

  // Admin accounts management (legacy)
  adminAccountsAction: (data) => fetchJson('/api/admin/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),

  // Export
  adminExportDashboard: (userId, accountId, format = 'csv') =>
    `/api/admin/export/dashboard?user_id=${encodeURIComponent(userId)}&account_id=${encodeURIComponent(accountId)}&format=${format}`,

  // Upload comparison
  adminUploadCompare: (uploadId, otherUploadId) => fetchJson(`/api/admin/uploads/${uploadId}/compare/${otherUploadId}`),

  // Alert runner
  adminRunAlerts: () => fetchJson('/api/admin/run-alerts', { method: 'POST' }),

  // Market data settings
  marketSettingsGet: () => fetchJson('/api/market/settings'),
  marketSettingsSave: (data) => fetchJson('/api/market/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  marketUpdate: () => fetchJson('/api/market/update', { method: 'POST' }),
  marketUpdateStatus: (jobId) => fetchJson(`/api/market/update/status/${jobId}`),
  marketTest: (source, apiKey) => fetchJson(`/api/market/test/${source}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: apiKey }) }),
};
