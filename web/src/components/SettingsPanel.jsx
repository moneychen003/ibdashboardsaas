import { useEffect, useState, useMemo } from 'react';
import { useDashboardStore } from '../stores/dashboardStore';
import { api } from '../api';

const TABS = [
  { id: 'status', label: '系统状态' },
  { id: 'upload', label: '导入数据' },
  { id: 'ops', label: '数据运维' },
  { id: 'backups', label: '备份恢复' },
  { id: 'accounts', label: '账户与货币' },
  { id: 'flex', label: 'IB 自动同步' },
  { id: 'market', label: '市场数据' },
  { id: 'guest', label: '游客权限' },
  { id: 'cleanup', label: '系统清理' },
  { id: 'webhook', label: 'Webhook' },
];

const GUEST_TABS = [
  { key: 'overview', label: '📊 总览' },
  { key: 'performance', label: '📈 业绩' },
  { key: 'positions', label: '💼 持仓' },
  { key: 'details', label: '📝 明细' },
];

function useAdminConfig() {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(false);
  const settingsOpen = useDashboardStore((s) => s.settingsOpen);

  const fetchCfg = async () => {
    setLoading(true);
    try {
      const data = await api.adminConfig();
      setCfg(data);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const save = async (patch) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    await api.saveAdminConfig(patch);
    return next;
  };

  useEffect(() => {
    if (settingsOpen) fetchCfg();
  }, [settingsOpen]);

  return { cfg, loading, fetchCfg, save };
}

export default function SettingsPanel() {
  const settingsOpen = useDashboardStore((s) => s.settingsOpen);
  const toggleSettings = useDashboardStore((s) => s.toggleSettings);
  const auth = useDashboardStore((s) => s.auth);
  const isAdmin = auth?.user === 'moneychen';
  const [activeTab, setActiveTab] = useState('status');

  if (!settingsOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[998] bg-black/20" onClick={toggleSettings} />
      <aside className="fixed right-0 top-16 z-[999] h-[calc(100vh-64px)] w-full sm:w-[560px] overflow-hidden border-l border-[var(--light-gray)] bg-white shadow-[-10px_0_40px_rgba(0,0,0,0.1)]">
        <div className="flex items-center justify-between border-b border-[var(--light-gray)] px-5 py-4">
          <span className="font-semibold">系统设置</span>
          <button onClick={toggleSettings} className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--light-gray)] bg-white text-lg">×</button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--light-gray)] px-4 py-2">
          {TABS.filter((t) => isAdmin || t.id !== 'guest').map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeTab === t.id ? 'bg-black text-white' : 'text-[var(--gray)] hover:bg-[var(--lighter-gray)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="h-[calc(100vh-64px-120px)] overflow-y-auto p-5">
          {activeTab === 'status' && <StatusTab />}
          {activeTab === 'upload' && <UploadTab />}
          {activeTab === 'ops' && <OpsTab />}
          {activeTab === 'backups' && <BackupsTab />}
          {activeTab === 'accounts' && <AccountsTab />}
          {activeTab === 'flex' && <FlexTab />}
          {activeTab === 'guest' && <GuestTab isAdmin={isAdmin} />}
          {activeTab === 'cleanup' && <CleanupTab />}
          {activeTab === 'market' && <MarketTab />}
          {activeTab === 'webhook' && <WebhookTab />}
        </div>
      </aside>
    </>
  );
}

// ---------- Status Tab ----------
function StatusTab() {
  const systemStatus = useDashboardStore((s) => s.systemStatus);
  const loadSystemStatus = useDashboardStore((s) => s.loadSystemStatus);
  const refreshJob = useDashboardStore((s) => s.refreshJob);
  const triggerRefresh = useDashboardStore((s) => s.triggerRefresh);

  useEffect(() => {
    loadSystemStatus();
  }, []);

  const freshness = systemStatus?.dataFreshnessHours;
  const stale = freshness == null || freshness > 24;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="最新刷新" value={systemStatus?.latestRefresh || '--'} />
        <StatCard label="数据新鲜度" value={freshness != null ? `${freshness} 小时` : '--'} alert={stale} />
        <StatCard label="DB 大小" value={systemStatus?.dbSizeMB != null ? `${systemStatus.dbSizeMB} MB` : '--'} />
        <StatCard label="磁盘剩余" value={systemStatus?.diskFreeGB != null ? `${systemStatus.diskFreeGB} GB` : '--'} />
        <StatCard label="成功导入次数" value={systemStatus?.importCount ?? '--'} />
        <StatCard label="后台任务" value={refreshJob?.status ? (refreshJob.status === 'running' ? '刷新中' : refreshJob.message) : '空闲'} />
      </div>
      <div className="rounded-lg border border-[var(--light-gray)] p-4">
        <div className="mb-2 text-sm font-semibold">最新导入</div>
        {systemStatus?.latestImport ? (
          <div className="text-sm">
            <div className="text-[var(--gray)]">{systemStatus.latestImport.time}</div>
            <div>{systemStatus.latestImport.file} <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${systemStatus.latestImport.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{systemStatus.latestImport.status}</span></div>
          </div>
        ) : (
          <div className="text-sm text-[var(--gray)]">暂无导入记录</div>
        )}
      </div>
      <button
        onClick={triggerRefresh}
        disabled={refreshJob?.status === 'running'}
        className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {refreshJob?.status === 'running' ? '刷新中...' : '立即刷新数据'}
      </button>
      {refreshJob?.status === 'failed' && <div className="text-xs text-red-600">{refreshJob.message}</div>}
      {refreshJob?.status === 'done' && <div className="text-xs text-green-600">{refreshJob.message}</div>}
    </div>
  );
}

function StatCard({ label, value, alert }) {
  return (
    <div className={`rounded-lg border p-3 ${alert ? 'border-red-200 bg-red-50' : 'border-[var(--light-gray)]'}`}>
      <div className="text-xs text-[var(--gray)]">{label}</div>
      <div className={`text-sm font-semibold ${alert ? 'text-red-700' : ''}`}>{value}</div>
    </div>
  );
}

// ---------- Ops Tab ----------
function OpsTab() {
  const imports = useDashboardStore((s) => s.imports);
  const dqReport = useDashboardStore((s) => s.dqReport);
  const loadImports = useDashboardStore((s) => s.loadImports);
  const loadDQReport = useDashboardStore((s) => s.loadDQReport);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    loadImports();
    loadDQReport();
  }, []);

  const runCheck = async () => {
    setChecking(true);
    try {
      await api.runDQCheck();
      await loadDQReport();
    } catch (e) {
      // ignore
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-sm font-semibold">数据质量检查</div>
        <div className="rounded-lg border border-[var(--light-gray)] p-3">
          {dqReport ? (
            <div className="space-y-2">
              <div className="text-xs text-[var(--gray)]">检查时间: {new Date(dqReport.checkedAt).toLocaleString()}</div>
              {dqReport.issues?.length === 0 ? (
                <div className="text-sm text-green-600">✅ 所有检查项通过</div>
              ) : (
                <div className="max-h-[180px] overflow-auto space-y-1">
                  {dqReport.issues.map((issue, i) => (
                    <div key={i} className={`rounded px-2 py-1.5 text-xs ${issue.severity === 'error' ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'}`}>
                      [{issue.category}] {issue.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-[var(--gray)]">尚未运行检查</div>
          )}
          <button onClick={runCheck} disabled={checking} className="mt-3 w-full rounded border border-[var(--light-gray)] px-3 py-1.5 text-xs font-medium hover:border-black disabled:opacity-50">
            {checking ? '检查中...' : '重新运行检查'}
          </button>
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">导入历史 <span className="text-xs font-normal text-[var(--gray)]">(最近 20 条)</span></div>
        <div className="max-h-[240px] overflow-auto rounded-lg border border-[var(--light-gray)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[var(--light-gray)] text-left text-[var(--gray)]">
                <th className="px-2 py-1.5">时间</th>
                <th className="px-2 py-1.5">文件</th>
                <th className="px-2 py-1.5">状态</th>
              </tr>
            </thead>
            <tbody>
              {imports.list.map((imp) => (
                <tr key={imp.id} className="border-b border-[var(--lighter-gray)]">
                  <td className="px-2 py-1.5">{new Date(imp.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-1.5" title={imp.fileName}>{imp.fileName?.split('_').pop()}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 ${imp.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{imp.status}</span>
                  </td>
                </tr>
              ))}
              {imports.list.length === 0 && (
                <tr><td colSpan={3} className="px-2 py-3 text-center text-[var(--gray)]">无记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- Backups Tab ----------
function BackupsTab() {
  const backups = useDashboardStore((s) => s.backups);
  const loadBackups = useDashboardStore((s) => s.loadBackups);
  const loadSystemStatus = useDashboardStore((s) => s.loadSystemStatus);
  const [restoring, setRestoring] = useState(null);

  useEffect(() => {
    loadBackups();
  }, []);

  const doRestore = async (ts) => {
    if (!confirm(`确定恢复到 ${ts} 的备份？当前数据将被覆盖。`)) return;
    setRestoring(ts);
    try {
      await api.restoreBackup(ts);
      alert('恢复成功，页面即将重载');
      window.location.reload();
    } catch (e) {
      alert('恢复失败');
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">备份列表</div>
      <div className="max-h-[400px] overflow-auto rounded-lg border border-[var(--light-gray)]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-[var(--light-gray)] text-left text-[var(--gray)]">
              <th className="px-2 py-1.5">时间</th>
              <th className="px-2 py-1.5">类型</th>
              <th className="px-2 py-1.5">大小</th>
              <th className="px-2 py-1.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.timestamp} className="border-b border-[var(--lighter-gray)]">
                <td className="px-2 py-1.5">{b.timestamp}</td>
                <td className="px-2 py-1.5 capitalize">{b.type}</td>
                <td className="px-2 py-1.5">{b.sizeMB} MB</td>
                <td className="px-2 py-1.5 text-right">
                  <a href={api.downloadBackupUrl(b.timestamp)} className="mr-2 text-blue-600 hover:underline">下载</a>
                  <button onClick={() => doRestore(b.timestamp)} disabled={restoring === b.timestamp} className="text-red-600 hover:underline disabled:opacity-50">{restoring === b.timestamp ? '恢复中' : '恢复'}</button>
                </td>
              </tr>
            ))}
            {backups.length === 0 && (
              <tr><td colSpan={4} className="px-2 py-3 text-center text-[var(--gray)]">无备份</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Accounts Tab ----------
function AccountsTab() {
  const { cfg, fetchCfg, save } = useAdminConfig();
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [fxOverrides, setFxOverrides] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [newAcc, setNewAcc] = useState({ alias: '', label: '', color: '#000000' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (cfg) {
      setBaseCurrency(cfg.settings?.baseCurrency || 'USD');
      const overrides = cfg.settings?.fxOverrides || {};
      setFxOverrides(Object.entries(overrides).map(([k, v]) => ({ currency: k, rate: v })));
      setAccounts(Object.entries(cfg.accounts || {}).map(([alias, info]) => ({ alias, ...info })));
    }
  }, [cfg]);

  const saveSettings = async () => {
    setSaving(true);
    const fx = {};
    fxOverrides.forEach((o) => { if (o.currency) fx[o.currency] = Number(o.rate) || 0; });
    await save({ settings: { ...cfg.settings, baseCurrency, fxOverrides: fx } });
    setSaving(false);
  };

  const addAccount = async () => {
    if (!newAcc.alias || !newAcc.label) return;
    await api.adminAccountsAction({ action: 'create', ...newAcc });
    await fetchCfg();
    setNewAcc({ alias: '', label: '', color: '#000000' });
  };

  const deleteAccount = async (alias) => {
    if (!confirm(`删除账户 ${alias}？`)) return;
    await api.adminAccountsAction({ action: 'delete', alias });
    await fetchCfg();
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-sm font-semibold">基础货币</div>
        <select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} className="w-full rounded-lg border border-[var(--light-gray)] px-3 py-2 text-sm">
          <option value="USD">USD</option>
          <option value="CNH">CNH</option>
          <option value="HKD">HKD</option>
          <option value="CNY">CNY</option>
        </select>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">FX 汇率覆盖</div>
        <div className="space-y-2">
          {fxOverrides.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input value={o.currency} onChange={(e) => setFxOverrides((prev) => prev.map((p, idx) => idx === i ? { ...p, currency: e.target.value.toUpperCase() } : p))} placeholder="币种" className="w-24 rounded border border-[var(--light-gray)] px-2 py-1 text-sm" />
              <input value={o.rate} onChange={(e) => setFxOverrides((prev) => prev.map((p, idx) => idx === i ? { ...p, rate: e.target.value } : p))} placeholder="汇率" className="flex-1 rounded border border-[var(--light-gray)] px-2 py-1 text-sm" />
              <button onClick={() => setFxOverrides((prev) => prev.filter((_, idx) => idx !== i))} className="rounded border border-[var(--light-gray)] px-2 text-xs hover:border-black">删除</button>
            </div>
          ))}
          <button onClick={() => setFxOverrides((prev) => [...prev, { currency: '', rate: '' }])} className="text-xs text-blue-600 hover:underline">+ 添加覆盖</button>
        </div>
      </div>

      <button onClick={saveSettings} disabled={saving} className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? '保存中...' : '保存货币设置'}</button>

      <div className="border-t border-[var(--light-gray)] pt-4">
        <div className="mb-2 text-sm font-semibold">账户管理</div>
        <div className="mb-3 space-y-2">
          {accounts.map((a) => (
            <div key={a.alias} className="flex items-center justify-between rounded border border-[var(--light-gray)] px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="font-medium">{a.label}</span>
                <span className="text-xs text-[var(--gray)]">({a.alias})</span>
              </div>
              <button onClick={() => deleteAccount(a.alias)} className="text-xs text-red-600 hover:underline">删除</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newAcc.alias} onChange={(e) => setNewAcc((p) => ({ ...p, alias: e.target.value }))} placeholder="别名" className="w-24 rounded border border-[var(--light-gray)] px-2 py-1 text-sm" />
          <input value={newAcc.label} onChange={(e) => setNewAcc((p) => ({ ...p, label: e.target.value }))} placeholder="显示名" className="flex-1 rounded border border-[var(--light-gray)] px-2 py-1 text-sm" />
          <input type="color" value={newAcc.color} onChange={(e) => setNewAcc((p) => ({ ...p, color: e.target.value }))} className="h-8 w-10 rounded border border-[var(--light-gray)]" />
          <button onClick={addAccount} className="rounded border border-[var(--light-gray)] px-3 text-xs font-medium hover:border-black">添加</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Guest Tab ----------
function GuestTab({ isAdmin }) {
  const publicConfig = useDashboardStore((s) => s.publicConfig);
  const savePublicConfig = useDashboardStore((s) => s.savePublicConfig);
  const loadPublicConfig = useDashboardStore((s) => s.loadPublicConfig);
  const [guestModules, setGuestModules] = useState({ overview: true, performance: true, positions: false, details: false });
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (isAdmin) loadPublicConfig();
  }, [isAdmin]);

  useEffect(() => {
    if (publicConfig?.modules) {
      setGuestModules(publicConfig.modules);
    }
  }, [publicConfig]);

  if (!isAdmin) {
    return <div className="text-sm text-[var(--gray)]">仅管理员可见</div>;
  }

  const handleSave = async () => {
    setSaving(true);
    setSavedMsg('');
    try {
      await savePublicConfig({ ...(publicConfig || {}), modules: guestModules });
      setSavedMsg('保存成功');
      setTimeout(() => setSavedMsg(''), 2000);
    } catch (e) {
      setSavedMsg('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-[var(--gray)]">配置游客（未登录用户）可见的页面模块。</div>
      <div className="space-y-2">
        {GUEST_TABS.map((t) => (
          <label key={t.key} className="flex cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-black" checked={!!guestModules[t.key]} onChange={(e) => setGuestModules((prev) => ({ ...prev, [t.key]: e.target.checked }))} />
            <span>{t.label}</span>
          </label>
        ))}
      </div>
      <button onClick={handleSave} disabled={saving} className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? '保存中...' : '保存游客设置'}</button>
      {savedMsg && <div className={`text-xs ${savedMsg.includes('失败') ? 'text-red-600' : 'text-green-600'}`}>{savedMsg}</div>}
    </div>
  );
}

// ---------- Cleanup Tab ----------
function CleanupTab() {
  const systemStatus = useDashboardStore((s) => s.systemStatus);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const doCleanup = async () => {
    setRunning(true);
    try {
      const data = await api.runCleanup();
      setResult(data);
    } catch (e) {
      setResult({ error: e.message || '清理失败' });
    } finally {
      setRunning(false);
    }
  };

  const settings = systemStatus?.settings || {};
  const retention = settings.retention || { backups: 15, uploads: 30, logs: 90 };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--light-gray)] p-4">
        <div className="mb-2 text-sm font-semibold">当前清理策略</div>
        <ul className="space-y-1 text-sm text-[var(--gray)]">
          <li>• 保留最近 <span className="font-medium text-black">{retention.backups}</span> 份备份</li>
          <li>• 保留最近 <span className="font-medium text-black">{retention.uploads}</span> 天的上传文件</li>
          <li>• 保留最近 <span className="font-medium text-black">{retention.logs}</span> 天的日志文件</li>
        </ul>
      </div>
      <button onClick={doCleanup} disabled={running} className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{running ? '清理中...' : '立即执行清理'}</button>
      {result && !result.error && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-700">
          清理完成：上传文件 {result.uploadsRemoved} 个，日志文件 {result.logsRemoved} 个，旧备份 {result.backupsRemoved} 个
        </div>
      )}
      {result?.error && <div className="text-xs text-red-600">{result.error}</div>}
    </div>
  );
}

// ---------- Flex Tab ----------
function FlexTab() {
  const [credentials, setCredentials] = useState(null);
  const [logs, setLogs] = useState({ list: [], total: 0 });
  const [form, setForm] = useState({ query_id: '', token: '', auto_sync: false, is_active: true });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const credRes = await api.flexCredentialsGet();
      setCredentials(credRes.credentials);
      if (credRes.credentials) {
        setForm({
          query_id: credRes.credentials.query_id || '',
          token: credRes.credentials.token || '',
          auto_sync: credRes.credentials.auto_sync || false,
          is_active: credRes.credentials.is_active !== false,
        });
      }
      const logsRes = await api.flexCredentialsLogs();
      setLogs({ list: logsRes.logs || [], total: logsRes.total || 0 });
    } catch (e) {
      setMessage(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const save = async () => {
    setLoading(true);
    try {
      await api.flexCredentialsSave(form);
      setMessage('保存成功');
      await fetchData();
    } catch (e) {
      setMessage(e.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await api.flexCredentialsTest({ query_id: form.query_id, token: form.token });
      setMessage(res.message || '连接成功');
    } catch (e) {
      setMessage(e.message || '连接失败');
    } finally {
      setTesting(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await api.flexCredentialsSync();
      setMessage('同步任务已提交: ' + res.jobId);
    } catch (e) {
      setMessage(e.message || '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const statusBadge = (status) => {
    const map = {
      done: 'bg-green-100 text-green-700',
      running: 'bg-blue-100 text-blue-700',
      failed: 'bg-red-100 text-red-700',
      pending: 'bg-yellow-100 text-yellow-700',
      cancelled: 'bg-gray-100 text-gray-600',
    };
    return <span className={`rounded px-1.5 py-0.5 text-xs ${map[status] || 'bg-gray-100 text-gray-700'}`}>{status}</span>;
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-sm font-semibold">IB FlexQuery 凭证</div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-[var(--gray)]">Query ID</div>
            <input value={form.query_id} onChange={(e) => setForm((s) => ({ ...s, query_id: e.target.value }))} placeholder="例如 1460982" className="w-full rounded-lg border border-[var(--light-gray)] px-3 py-2 text-sm" />
          </div>
          <div>
            <div className="mb-1 text-xs text-[var(--gray)]">Token</div>
            <input type="password" value={form.token} onChange={(e) => setForm((s) => ({ ...s, token: e.target.value }))} placeholder="你的 FlexQuery Token" className="w-full rounded-lg border border-[var(--light-gray)] px-3 py-2 text-sm" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={form.auto_sync} onChange={(e) => setForm((s) => ({ ...s, auto_sync: e.target.checked }))} className="h-4 w-4 accent-black" />
            启用自动同步（需配合服务器定时任务）
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((s) => ({ ...s, is_active: e.target.checked }))} className="h-4 w-4 accent-black" />
            凭证有效
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={save} disabled={loading} className="rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{loading ? '保存中...' : '保存凭证'}</button>
          <button onClick={test} disabled={testing || !form.query_id || !form.token} className="rounded-lg border border-[var(--light-gray)] px-3 py-2 text-sm font-medium hover:border-black disabled:opacity-50">{testing ? '测试中...' : '测试连接'}</button>
          <button onClick={syncNow} disabled={syncing} className="rounded-lg border border-[var(--light-gray)] px-3 py-2 text-sm font-medium hover:border-black disabled:opacity-50">{syncing ? '同步中...' : '立即同步'}</button>
        </div>
        {message && <div className="mt-2 text-xs text-[var(--gray)]">{message}</div>}
      </div>

      {credentials && (
        <div className="rounded-lg border border-[var(--light-gray)] p-3">
          <div className="mb-2 text-sm font-semibold">当前同步状态</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>上次同步: {credentials.last_sync_at ? new Date(credentials.last_sync_at).toLocaleString('zh-CN') : '从未同步'}</div>
            <div>状态: {credentials.last_sync_status ? statusBadge(credentials.last_sync_status) : '-'}</div>
            <div className="col-span-2 text-[var(--gray)]">{credentials.last_sync_message || ''}</div>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-sm font-semibold">同步日志（最近 20 条）</div>
        <div className="max-h-[240px] overflow-auto rounded-lg border border-[var(--light-gray)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[var(--light-gray)] text-left text-[var(--gray)]">
                <th className="px-2 py-1.5">时间</th>
                <th className="px-2 py-1.5">状态</th>
                <th className="px-2 py-1.5">消息</th>
                <th className="px-2 py-1.5">账户</th>
                <th className="px-2 py-1.5">行数</th>
                <th className="px-2 py-1.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {logs.list.map((l) => (
                <tr key={l.id} className="border-b border-[var(--lighter-gray)]">
                  <td className="px-2 py-1.5">{new Date(l.started_at).toLocaleString('zh-CN')}</td>
                  <td className="px-2 py-1.5">{statusBadge(l.status)}</td>
                  <td className="px-2 py-1.5 max-w-[160px] truncate" title={l.message}>{l.message || '-'}</td>
                  <td className="px-2 py-1.5">{l.account_id || '-'}</td>
                  <td className="px-2 py-1.5">{l.rows_inserted || 0}</td>
                  <td className="px-2 py-1.5 text-right">
                    {l.status === 'running' && (
                      <button
                        onClick={async () => {
                          if (!confirm('确定停止当前正在运行的同步任务？')) return;
                          try {
                            await api.flexCredentialsCancelSync();
                            setMessage('同步任务已取消');
                            await fetchData();
                          } catch (e) {
                            setMessage(e.message || '取消失败');
                          }
                        }}
                        className="mr-2 text-red-600 hover:underline"
                      >停止</button>
                    )}
                    <button
                      onClick={async () => {
                        if (!confirm('确定删除这条同步日志？')) return;
                        try {
                          await api.flexCredentialsDeleteLog(l.id);
                          setLogs((prev) => ({ ...prev, list: prev.list.filter((x) => x.id !== l.id), total: prev.total - 1 }));
                        } catch (e) {
                          setMessage(e.message || '删除失败');
                        }
                      }}
                      className="text-gray-500 hover:text-red-600 hover:underline"
                    >删除</button>
                  </td>
                </tr>
              ))}
              {logs.list.length === 0 && <tr><td colSpan={6} className="px-2 py-3 text-center text-[var(--gray)]">无记录</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- Webhook Tab ----------
function WebhookTab() {
  const { cfg, fetchCfg, save } = useAdminConfig();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (cfg) {
      const wh = cfg.settings?.webhook || {};
      setUrl(wh.url || '');
      setEvents(wh.events || []);
    }
  }, [cfg]);

  const allEvents = [
    { key: 'refresh_failed', label: '刷新失败' },
    { key: 'import_failed', label: '导入失败' },
    { key: 'disk_low', label: '磁盘空间不足' },
    { key: 'stale_data', label: '数据过期' },
  ];

  const toggleEvent = (key) => {
    setEvents((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const saveWebhook = async () => {
    setSaving(true);
    const nextSettings = { ...cfg.settings, webhook: { url, events } };
    await save({ settings: nextSettings });
    setSaving(false);
  };

  const testWebhook = async () => {
    setTesting(true);
    try {
      await api.testWebhook();
      alert('测试消息已发送，请检查你的 webhook 端点');
    } catch (e) {
      alert('发送失败');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 text-sm font-semibold">Webhook URL</div>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="w-full rounded-lg border border-[var(--light-gray)] px-3 py-2 text-sm" />
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold">订阅事件</div>
        <div className="space-y-2">
          {allEvents.map((e) => (
            <label key={e.key} className="flex cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-black" checked={events.includes(e.key)} onChange={() => toggleEvent(e.key)} />
              <span>{e.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={saveWebhook} disabled={saving} className="flex-1 rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? '保存中...' : '保存 Webhook'}</button>
        <button onClick={testWebhook} disabled={testing} className="rounded-lg border border-[var(--light-gray)] px-3 py-2 text-sm font-medium hover:border-black disabled:opacity-50">{testing ? '发送中' : '测试'}</button>
      </div>
    </div>
  );
}


// ---------- Market Data Tab ----------
function MarketTab() {
  const [marketSources, setMarketSources] = useState(['finnhub', 'yahoo']);
  const [marketFinnhub, setMarketFinnhub] = useState({ enabled: true, api_key: '' });
  const [marketYahoo, setMarketYahoo] = useState({ enabled: true, api_key: '' });
  const [marketPolygon, setMarketPolygon] = useState({ enabled: false, api_key: '' });
  const [marketAlpaca, setMarketAlpaca] = useState({ enabled: false, api_key: '' });
  const [saving, setSaving] = useState(false);
  const [marketStatus, setMarketStatus] = useState('idle');
  const [marketMessage, setMarketMessage] = useState('');
  const [testStatus, setTestStatus] = useState({});

  useEffect(() => {
    api.marketSettingsGet().then((data) => {
      setMarketSources(data.sources || ['finnhub', 'yahoo']);
      setMarketFinnhub(data.finnhub || { enabled: true, api_key: '' });
      setMarketYahoo(data.yahoo || { enabled: true, api_key: '' });
      setMarketPolygon(data.polygon || { enabled: false, api_key: '' });
      setMarketAlpaca(data.alpaca || { enabled: false, api_key: '' });
    }).catch(() => {});
  }, []);

  const toggleSource = (src) => {
    setMarketSources((prev) => {
      const exists = prev.includes(src);
      if (exists) return prev.filter((s) => s !== src);
      return [...prev, src];
    });
  };

  const moveSource = (src, direction) => {
    setMarketSources((prev) => {
      const idx = prev.indexOf(src);
      if (idx === -1) return prev;
      const next = [...prev];
      if (direction === 'up' && idx > 0) {
        [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
      } else if (direction === 'down' && idx < next.length - 1) {
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.marketSettingsSave({
        sources: marketSources,
        finnhub: marketFinnhub,
        yahoo: marketYahoo,
        polygon: marketPolygon,
        alpaca: marketAlpaca,
      });
      alert('市场数据源保存成功');
    } catch (e) {
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    setMarketStatus('running');
    setMarketMessage('正在刷新股价...');
    try {
      const { jobId } = await api.marketUpdate();
      const timer = setInterval(async () => {
        try {
          const data = await api.marketUpdateStatus(jobId);
          const job = data.job;
          if (job.status === 'done') {
            clearInterval(timer);
            setMarketStatus('done');
            setMarketMessage('股价刷新完成，请稍后查看最新净值');
          } else if (job.status === 'failed') {
            clearInterval(timer);
            setMarketStatus('failed');
            setMarketMessage(job.message || '刷新失败');
          }
        } catch (e) {
          // keep polling
        }
      }, 1500);
    } catch (e) {
      setMarketStatus('failed');
      setMarketMessage(e.message || '启动刷新失败');
    }
  };

  const handleTestMarket = async (source, apiKey) => {
    setTestStatus((prev) => ({ ...prev, [source]: { status: 'running', message: '测试中...' } }));
    try {
      const data = await api.marketTest(source, apiKey);
      if (data.success) {
        setTestStatus((prev) => ({ ...prev, [source]: { status: 'success', message: `✓ 连通成功 AAPL=${data.price}` } }));
      } else {
        setTestStatus((prev) => ({ ...prev, [source]: { status: 'error', message: `✗ ${data.error || '测试失败'}` } }));
      }
    } catch (e) {
      setTestStatus((prev) => ({ ...prev, [source]: { status: 'error', message: `✗ ${e.message || '网络错误'}` } }));
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--gray)]">配置实时股价数据源，用于更新首页净值。系统按下方优先级顺序依次尝试。</p>

      <div className="space-y-3">
        {/* Finnhub */}
        <div className="rounded-lg border border-[var(--light-gray)] p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input id="src_finnhub" type="checkbox" checked={marketSources.includes('finnhub')} onChange={() => toggleSource('finnhub')} className="h-4 w-4" />
              <label htmlFor="src_finnhub" className="text-sm font-medium">Finnhub</label>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => moveSource('finnhub', 'up')} disabled={marketSources.indexOf('finnhub') <= 0} className="rounded border border-[var(--light-gray)] px-2 py-0.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-40">▲</button>
              <button onClick={() => moveSource('finnhub', 'down')} disabled={marketSources.indexOf('finnhub') >= marketSources.length - 1 || marketSources.indexOf('finnhub') === -1} className="rounded border border-[var(--light-gray)] px-2 py-0.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-40">▼</button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input type="text" value={marketFinnhub.api_key || ''} onChange={(e) => setMarketFinnhub((s) => ({ ...s, api_key: e.target.value }))} placeholder="Finnhub API Key（免费 60 calls/min）" className="flex-1 rounded border border-[var(--light-gray)] px-2 py-1.5 text-xs outline-none focus:border-black" />
            <button onClick={() => handleTestMarket('finnhub', marketFinnhub.api_key || '')} disabled={testStatus['finnhub']?.status === 'running'} className="rounded border border-[var(--light-gray)] px-3 py-1.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-50">{testStatus['finnhub']?.status === 'running' ? '测试中...' : '测试连接'}</button>
          </div>
          {testStatus['finnhub']?.status && (
            <div className={`mt-1.5 text-xs ${testStatus['finnhub'].status === 'success' ? 'text-green-600' : testStatus['finnhub'].status === 'error' ? 'text-red-600' : 'text-blue-600'}`}>{testStatus['finnhub'].message}</div>
          )}
        </div>

        {/* Yahoo */}
        <div className="rounded-lg border border-[var(--light-gray)] p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input id="src_yahoo" type="checkbox" checked={marketSources.includes('yahoo')} onChange={() => toggleSource('yahoo')} className="h-4 w-4" />
              <label htmlFor="src_yahoo" className="text-sm font-medium">Yahoo Finance</label>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => moveSource('yahoo', 'up')} disabled={marketSources.indexOf('yahoo') <= 0} className="rounded border border-[var(--light-gray)] px-2 py-0.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-40">▲</button>
              <button onClick={() => moveSource('yahoo', 'down')} disabled={marketSources.indexOf('yahoo') >= marketSources.length - 1 || marketSources.indexOf('yahoo') === -1} className="rounded border border-[var(--light-gray)] px-2 py-0.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-40">▼</button>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--gray)]">完全免费，无需 API Key</p>
            <button onClick={() => handleTestMarket('yahoo', '')} disabled={testStatus['yahoo']?.status === 'running'} className="rounded border border-[var(--light-gray)] px-3 py-1.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-50">{testStatus['yahoo']?.status === 'running' ? '测试中...' : '测试连接'}</button>
          </div>
          {testStatus['yahoo']?.status && (
            <div className={`mt-1.5 text-xs ${testStatus['yahoo'].status === 'success' ? 'text-green-600' : testStatus['yahoo'].status === 'error' ? 'text-red-600' : 'text-blue-600'}`}>{testStatus['yahoo'].message}</div>
          )}
        </div>

        {/* Polygon */}
        <div className="rounded-lg border border-[var(--light-gray)] p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input id="src_polygon" type="checkbox" checked={marketSources.includes('polygon')} onChange={() => toggleSource('polygon')} className="h-4 w-4" />
              <label htmlFor="src_polygon" className="text-sm font-medium">Polygon</label>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => moveSource('polygon', 'up')} disabled={marketSources.indexOf('polygon') <= 0} className="rounded border border-[var(--light-gray)] px-2 py-0.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-40">▲</button>
              <button onClick={() => moveSource('polygon', 'down')} disabled={marketSources.indexOf('polygon') >= marketSources.length - 1 || marketSources.indexOf('polygon') === -1} className="rounded border border-[var(--light-gray)] px-2 py-0.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-40">▼</button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input type="text" value={marketPolygon.api_key || ''} onChange={(e) => setMarketPolygon((s) => ({ ...s, api_key: e.target.value }))} placeholder="Polygon API Key" className="flex-1 rounded border border-[var(--light-gray)] px-2 py-1.5 text-xs outline-none focus:border-black" />
            <button onClick={() => handleTestMarket('polygon', marketPolygon.api_key || '')} disabled={testStatus['polygon']?.status === 'running'} className="rounded border border-[var(--light-gray)] px-3 py-1.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-50">{testStatus['polygon']?.status === 'running' ? '测试中...' : '测试连接'}</button>
          </div>
          {testStatus['polygon']?.status && (
            <div className={`mt-1.5 text-xs ${testStatus['polygon'].status === 'success' ? 'text-green-600' : testStatus['polygon'].status === 'error' ? 'text-red-600' : 'text-blue-600'}`}>{testStatus['polygon'].message}</div>
          )}
        </div>

        {/* Alpaca */}
        <div className="rounded-lg border border-[var(--light-gray)] p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input id="src_alpaca" type="checkbox" checked={marketSources.includes('alpaca')} onChange={() => toggleSource('alpaca')} className="h-4 w-4" />
              <label htmlFor="src_alpaca" className="text-sm font-medium">Alpaca</label>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => moveSource('alpaca', 'up')} disabled={marketSources.indexOf('alpaca') <= 0} className="rounded border border-[var(--light-gray)] px-2 py-0.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-40">▲</button>
              <button onClick={() => moveSource('alpaca', 'down')} disabled={marketSources.indexOf('alpaca') >= marketSources.length - 1 || marketSources.indexOf('alpaca') === -1} className="rounded border border-[var(--light-gray)] px-2 py-0.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-40">▼</button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input type="text" value={marketAlpaca.api_key || ''} onChange={(e) => setMarketAlpaca((s) => ({ ...s, api_key: e.target.value }))} placeholder="PKID:SECRET（用冒号分隔）" className="flex-1 rounded border border-[var(--light-gray)] px-2 py-1.5 text-xs outline-none focus:border-black" />
            <button onClick={() => handleTestMarket('alpaca', marketAlpaca.api_key || '')} disabled={testStatus['alpaca']?.status === 'running'} className="rounded border border-[var(--light-gray)] px-3 py-1.5 text-xs hover:bg-[var(--lighter-gray)] disabled:opacity-50">{testStatus['alpaca']?.status === 'running' ? '测试中...' : '测试连接'}</button>
          </div>
          {testStatus['alpaca']?.status && (
            <div className={`mt-1.5 text-xs ${testStatus['alpaca'].status === 'success' ? 'text-green-600' : testStatus['alpaca'].status === 'error' ? 'text-red-600' : 'text-blue-600'}`}>{testStatus['alpaca'].message}</div>
          )}
        </div>
      </div>

      <div className="text-sm">
        {marketStatus === 'running' ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-blue-600">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600" />
            {marketMessage || '刷新中...'}
          </span>
        ) : marketStatus === 'done' ? (
          <span className="font-medium text-green-600">✓ {marketMessage}</span>
        ) : marketStatus === 'failed' ? (
          <span className="font-medium text-red-600">✗ {marketMessage}</span>
        ) : null}
      </div>

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? '保存中...' : '保存数据源'}</button>
        <button onClick={handleUpdate} disabled={marketStatus === 'running'} className="flex-1 rounded-lg border border-[var(--light-gray)] px-3 py-2 text-sm font-medium hover:border-black disabled:opacity-50">{marketStatus === 'running' ? '刷新中...' : '立即刷新股价'}</button>
      </div>
    </div>
  );
}

// ---------- Upload Tab ----------
function UploadTab() {
  const triggerUploadXml = useDashboardStore((s) => s.triggerUploadXml);
  const triggerUploadFolder = useDashboardStore((s) => s.triggerUploadFolder);

  return (
    <div className="space-y-5">
      <div className="text-sm text-[var(--gray)]">
        上传盈透证券（Interactive Brokers）的月度/年度 XML 对账单，系统会自动解析并生成仪表盘数据。
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={triggerUploadXml}
          className="rounded-lg border border-[var(--light-gray)] px-4 py-6 text-sm font-medium hover:border-black hover:bg-black hover:text-white"
        >
          📤 上传 XML
        </button>
        <button
          onClick={triggerUploadFolder}
          className="rounded-lg border border-[var(--light-gray)] px-4 py-6 text-sm font-medium hover:border-black hover:bg-black hover:text-white"
        >
          📁 上传文件夹
        </button>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        💡 建议一次性把历史 XML 都传完，数据越完整，收益率、持仓归因、交易排名等高级分析就越准确。上传完成后页面会自动刷新。
      </div>
    </div>
  );
}
