import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('zh-CN');
}

function fmtSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = Number(bytes);
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(2)} ${units[i]}`;
}

function classNames(...c) {
  return c.filter(Boolean).join(' ');
}

const REDIS_URL = 'redis://localhost:6379/0';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Dashboard / System
  const [system, setSystem] = useState(null);
  const [dq, setDq] = useState(null);

  // Users
  const [users, setUsers] = useState({ list: [], total: 0 });
  const [userSearch, setUserSearch] = useState('');
  const [userOffset, setUserOffset] = useState(0);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDetail, setUserDetail] = useState(null);
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserForm, setEditUserForm] = useState({});

  // Uploads
  const [uploads, setUploads] = useState({ list: [], total: 0 });
  const [uploadFilters, setUploadFilters] = useState({ status: '', user_id: '', account_id: '', search: '' });
  const [uploadOffset, setUploadOffset] = useState(0);
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [compareUploadOpen, setCompareUploadOpen] = useState(false);
  const [compareTarget, setCompareTarget] = useState(null);
  const [compareResult, setCompareResult] = useState(null);

  // Accounts
  const [accounts, setAccounts] = useState([]);
  const [accountStats, setAccountStats] = useState(null);
  const [statsAccount, setStatsAccount] = useState(null);

  // Audit logs
  const [logs, setLogs] = useState({ list: [], total: 0 });
  const [logOffset, setLogOffset] = useState(0);

  // Config
  const [config, setConfig] = useState(null);
  const [configText, setConfigText] = useState('');

  const USER_LIMIT = 20;
  const UPLOAD_LIMIT = 20;
  const LOG_LIMIT = 20;

  const showError = (msg) => { setError(msg); setTimeout(() => setError(''), 4000); };
  const showSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); };

  const loadSystem = useCallback(async () => {
    try { setSystem(await api.adminSystem()); } catch (e) { /* ignore */ }
  }, []);

  const loadDQ = useCallback(async () => {
    try { setDq(await api.adminDataQuality()); } catch (e) { /* ignore */ }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const params = `?offset=${userOffset}&limit=${USER_LIMIT}${userSearch ? `&search=${encodeURIComponent(userSearch)}` : ''}`;
      const data = await api.adminUsers(params);
      setUsers({ list: data.users || [], total: data.total || 0 });
    } catch (e) { showError(e.message); }
  }, [userOffset, userSearch]);

  const loadUploads = useCallback(async () => {
    try {
      const q = new URLSearchParams({ offset: uploadOffset, limit: UPLOAD_LIMIT });
      if (uploadFilters.status) q.set('status', uploadFilters.status);
      if (uploadFilters.user_id) q.set('user_id', uploadFilters.user_id);
      if (uploadFilters.account_id) q.set('account_id', uploadFilters.account_id);
      if (uploadFilters.search) q.set('search', uploadFilters.search);
      const data = await api.adminUploads(`?${q.toString()}`);
      setUploads({ list: data.uploads || [], total: data.total || 0 });
    } catch (e) { showError(e.message); }
  }, [uploadOffset, uploadFilters]);

  const loadAccounts = useCallback(async () => {
    try { const data = await api.adminAccounts(); setAccounts(data.accounts || []); } catch (e) { showError(e.message); }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const data = await api.adminAuditLogs(`?offset=${logOffset}&limit=${LOG_LIMIT}`);
      setLogs({ list: data.logs || [], total: data.total || 0 });
    } catch (e) { showError(e.message); }
  }, [logOffset]);

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.adminConfig();
      setConfig(data);
      setConfigText(JSON.stringify(data, null, 2));
    } catch (e) { showError(e.message); }
  }, []);

  useEffect(() => {
    loadSystem();
    loadDQ();
    loadUsers();
    loadUploads();
    loadAccounts();
    loadLogs();
    loadConfig();
  }, []);

  useEffect(() => { loadUsers(); }, [userOffset, userSearch]);
  useEffect(() => { loadUploads(); }, [uploadOffset, uploadFilters]);
  useEffect(() => { loadLogs(); }, [logOffset]);

  // User actions
  const openUserDetail = async (u) => {
    setSelectedUser(u);
    try {
      const data = await api.adminUserDetail(u.id);
      setUserDetail(data);
    } catch (e) { showError(e.message); }
  };

  const openEditUser = (u) => {
    setEditUserForm({
      is_active: u.is_active,
      is_admin: u.is_admin,
      tier: u.tier || 'free',
      max_accounts: u.max_accounts || 1,
      base_currency: u.base_currency || 'USD',
    });
    setSelectedUser(u);
    setEditUserOpen(true);
  };

  const saveUser = async () => {
    try {
      await api.adminUserUpdate(selectedUser.id, editUserForm);
      showSuccess('用户已更新');
      setEditUserOpen(false);
      loadUsers();
      if (userDetail && userDetail.user && userDetail.user.id === selectedUser.id) {
        openUserDetail(selectedUser);
      }
    } catch (e) { showError(e.message); }
  };

  const deleteUser = async (u) => {
    if (!confirm(`确定要删除用户 ${u.email} 吗？所有数据将被清除，不可恢复。`)) return;
    try {
      await api.adminUserDelete(u.id);
      showSuccess('用户已删除');
      loadUsers();
    } catch (e) { showError(e.message); }
  };

  // Upload actions
  const retryUpload = async (id) => {
    try {
      const data = await api.adminUploadRetry(id);
      showSuccess('重新处理已提交，Job: ' + data.jobId);
      loadUploads();
    } catch (e) { showError(e.message); }
  };

  const downloadUpload = (id) => {
    window.open(api.adminUploadDownload(id), '_blank');
  };

  // Upload comparison
  const runCompare = async (baseId, otherId) => {
    try {
      const data = await api.adminUploadCompare(baseId, otherId);
      setCompareResult(data);
    } catch (e) { showError(e.message); }
  };

  // Account stats
  const openAccountStats = async (acc) => {
    setStatsAccount(acc);
    try {
      const data = await api.adminAccountStats(acc.account_id, acc.user_id);
      setAccountStats(data);
    } catch (e) { showError(e.message); }
  };

  // Config save
  const saveConfig = async () => {
    try {
      const data = JSON.parse(configText);
      await api.adminSaveConfig(data);
      showSuccess('配置已保存');
      loadConfig();
    } catch (e) {
      showError(e instanceof SyntaxError ? 'JSON 格式错误: ' + e.message : e.message);
    }
  };

  const tabs = [
    { key: 'dashboard', label: '📊 概览' },
    { key: 'users', label: '👤 用户管理' },
    { key: 'uploads', label: '📤 上传中心' },
    { key: 'accounts', label: '🏦 数据浏览' },
    { key: 'diagnostics', label: '🔍 数据诊断' },
    { key: 'system', label: '⚙️ 系统监控' },
    { key: 'logs', label: '📝 操作日志' },
    { key: 'config', label: '🔧 配置' },
  ];

  return (
    <div className="min-h-screen bg-[#f8f9fa] p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">管理后台</h1>
          <a href="/" className="text-sm text-[var(--gray)] hover:text-black">← 返回 Dashboard</a>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {success && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>
        )}

        <div className="mb-6 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={classNames(
                'rounded-lg border px-3 py-2 text-sm font-medium transition',
                activeTab === t.key ? 'bg-black text-white' : 'bg-white text-[var(--gray)] hover:text-black'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Dashboard */}
        {activeTab === 'dashboard' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card label="总用户数" value={dq?.totals?.total_users ?? '-'} />
              <Card label="总上传数" value={dq?.totals?.total_uploads ?? '-'} />
              <Card label="失败上传" value={dq?.totals?.failed_count ?? '-'} tone={dq?.totals?.failed_count > 0 ? 'bad' : 'good'} />
              <Card label="待处理任务" value={system?.queue_length ?? '-'} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card label="活跃 Worker" value={system?.active_workers ?? '-'} />
              <Card label="24h 上传" value={system?.uploads_24h ?? '-'} />
              <Card label="7d 上传" value={system?.uploads_7d ?? '-'} />
              <Card label="数据库大小" value={system?.db_size_bytes != null ? fmtSize(system.db_size_bytes) : '-'} />
            </div>
            <div className="rounded-xl border border-[var(--light-gray)] bg-white p-6">
              <div className="mb-3 text-lg font-semibold">快捷入口</div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setActiveTab('users')} className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white">用户管理</button>
                <button onClick={() => setActiveTab('uploads')} className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white">上传中心</button>
                <button onClick={() => setActiveTab('diagnostics')} className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white">数据诊断</button>
                <button onClick={() => setActiveTab('accounts')} className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white">数据浏览</button>
              </div>
            </div>
          </div>
        )}

        {/* Users */}
        {activeTab === 'users' && (
          <div className="rounded-xl border border-[var(--light-gray)] bg-white p-4 md:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-lg font-semibold">用户列表（共 {users.total} 人）</div>
              <div className="flex gap-2">
                <input
                  value={userSearch}
                  onChange={(e) => { setUserSearch(e.target.value); setUserOffset(0); }}
                  placeholder="搜索邮箱、用户名或 ID"
                  className="w-full rounded-lg border px-3 py-2 text-sm sm:w-64"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--light-gray)] text-left text-[var(--gray)]">
                    <th className="py-2">邮箱</th>
                    <th className="py-2">用户名</th>
                    <th className="py-2">等级</th>
                    <th className="py-2">上传数</th>
                    <th className="py-2">最近上传</th>
                    <th className="py-2">登录 IP</th>
                    <th className="py-2">状态</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.list.map((u) => (
                    <tr key={u.id} className="border-b border-[var(--lighter-gray)]">
                      <td className="py-2">{u.email}</td>
                      <td className="py-2">{u.username || '-'}</td>
                      <td className="py-2">{u.tier || 'free'}</td>
                      <td className="py-2">{u.upload_count || 0}</td>
                      <td className="py-2">{fmtDate(u.last_upload_at)}</td>
                      <td className="py-2 text-xs text-[var(--gray)]">{u.last_login_ip || '-'}</td>
                      <td className="py-2">
                        <span className={classNames('rounded px-2 py-0.5 text-xs', u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                          {u.is_active ? '正常' : '禁用'}
                        </span>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          <button onClick={() => openUserDetail(u)} className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white">详情</button>
                          <button onClick={() => openEditUser(u)} className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white">编辑</button>
                          <button onClick={() => deleteUser(u)} className="rounded border px-2 py-1 text-xs text-red-700 hover:bg-red-600 hover:text-white">删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!users.list.length && <tr><td colSpan={8} className="py-6 text-center text-[var(--gray)]">暂无用户</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination offset={userOffset} limit={USER_LIMIT} total={users.total} onChange={setUserOffset} />
          </div>
        )}

        {/* Uploads */}
        {activeTab === 'uploads' && (
          <div className="rounded-xl border border-[var(--light-gray)] bg-white p-4 md:p-6">
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <input value={uploadFilters.search} onChange={(e) => setUploadFilters(s => ({ ...s, search: e.target.value }))} placeholder="文件名/邮箱" className="rounded-lg border px-3 py-2 text-sm" />
              <select value={uploadFilters.status} onChange={(e) => setUploadFilters(s => ({ ...s, status: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">全部状态</option>
                <option value="pending">pending</option>
                <option value="running">running</option>
                <option value="done">done</option>
                <option value="failed">failed</option>
              </select>
              <input value={uploadFilters.user_id} onChange={(e) => setUploadFilters(s => ({ ...s, user_id: e.target.value }))} placeholder="用户 ID" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={uploadFilters.account_id} onChange={(e) => setUploadFilters(s => ({ ...s, account_id: e.target.value }))} placeholder="账户 ID" className="rounded-lg border px-3 py-2 text-sm" />
              <button onClick={() => { setUploadOffset(0); loadUploads(); }} className="rounded-lg border bg-black px-3 py-2 text-sm text-white">查询</button>
            </div>
            <div className="mb-2 text-sm text-[var(--gray)]">共 {uploads.total} 条记录</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--light-gray)] text-left text-[var(--gray)]">
                    <th className="py-2">时间</th>
                    <th className="py-2">用户</th>
                    <th className="py-2">文件名</th>
                    <th className="py-2">账户</th>
                    <th className="py-2">状态</th>
                    <th className="py-2">导入行数</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.list.map((x) => (
                    <tr key={x.id} className="border-b border-[var(--lighter-gray)]">
                      <td className="py-2">{fmtDate(x.created_at)}</td>
                      <td className="py-2 max-w-xs truncate" title={x.email}>{x.email}</td>
                      <td className="py-2 max-w-xs truncate" title={x.filename}>{x.filename}</td>
                      <td className="py-2">{x.account_id || '-'}</td>
                      <td className="py-2">
                        <StatusBadge status={x.status} />
                      </td>
                      <td className="py-2">{x.rows_inserted || 0}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          <button onClick={() => setSelectedUpload(x)} className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white">详情</button>
                          <button onClick={() => retryUpload(x.id)} className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white">重试</button>
                          <button onClick={() => downloadUpload(x.id)} className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white">下载</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!uploads.list.length && <tr><td colSpan={7} className="py-6 text-center text-[var(--gray)]">暂无记录</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination offset={uploadOffset} limit={UPLOAD_LIMIT} total={uploads.total} onChange={setUploadOffset} />
          </div>
        )}

        {/* Accounts / Data Explorer */}
        {activeTab === 'accounts' && (
          <div className="rounded-xl border border-[var(--light-gray)] bg-white p-4 md:p-6">
            <div className="mb-4 text-lg font-semibold">账户数据浏览（共 {accounts.length} 个）</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--light-gray)] text-left text-[var(--gray)]">
                    <th className="py-2">用户</th>
                    <th className="py-2">账户</th>
                    <th className="py-2">标签</th>
                    <th className="py-2">上传数</th>
                    <th className="py-2">NAV 日期范围</th>
                    <th className="py-2">NAV 天数</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={`${a.user_id}-${a.account_id}`} className="border-b border-[var(--lighter-gray)]">
                      <td className="py-2 max-w-xs truncate" title={a.email}>{a.email}</td>
                      <td className="py-2 font-medium">{a.account_id}</td>
                      <td className="py-2">{a.label || '-'}</td>
                      <td className="py-2">{a.upload_count || 0}</td>
                      <td className="py-2">{a.nav_from ? `${a.nav_from} ~ ${a.nav_to}` : '-'}</td>
                      <td className="py-2">{a.nav_days || 0}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          <button onClick={() => openAccountStats(a)} className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white">统计</button>
                          <a href={`/?admin_preview_user=${a.user_id}&admin_preview_account=${a.account_id}`} target="_blank" className="inline-block rounded border px-2 py-1 text-xs hover:bg-black hover:text-white">Dashboard</a>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!accounts.length && <tr><td colSpan={7} className="py-6 text-center text-[var(--gray)]">暂无账户</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Diagnostics */}
        {activeTab === 'diagnostics' && (
          <div className="space-y-4">
            <SectionCard title="总体统计">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <Metric label="总用户" value={dq?.totals?.total_users} />
                <Metric label="总上传" value={dq?.totals?.total_uploads} />
                <Metric label="失败上传" value={dq?.totals?.failed_count} />
                <Metric label="NAV 行数" value={dq?.totals?.total_nav_rows} />
                <Metric label="持仓行数" value={dq?.totals?.total_pos_rows} />
                <Metric label="交易行数" value={dq?.totals?.total_trade_rows} />
              </div>
            </SectionCard>
            <SectionCard title={`失败上传（最近 ${(dq?.failedUploads || []).length} 条）`}>
              <SimpleTable cols={['时间', '用户', '文件名', '错误']} rows={(dq?.failedUploads || []).map(r => [fmtDate(r.created_at), r.email, r.filename, <span className="text-red-700 text-xs">{r.error_message || '-'}</span>])} />
            </SectionCard>
            <SectionCard title={`零行上传（最近 ${(dq?.zeroRowUploads || []).length} 条）`}>
              <SimpleTable cols={['时间', '用户', '文件名', '账户']} rows={(dq?.zeroRowUploads || []).map(r => [fmtDate(r.created_at), r.email, r.filename, r.account_id || '-'])} />
            </SectionCard>
            <SectionCard title={`无数据用户（最近 ${(dq?.noDataUsers || []).length} 人）`}>
              <SimpleTable cols={['邮箱', '注册时间']} rows={(dq?.noDataUsers || []).map(r => [r.email, fmtDate(r.created_at)])} />
            </SectionCard>
            <SectionCard title={`缺失持仓的 NAV 日期（最近 ${(dq?.missingPositions || []).length} 条）`}>
              <SimpleTable cols={['用户 ID', '账户', '日期']} rows={(dq?.missingPositions || []).map(r => [r.user_id, r.account_id, r.date])} />
            </SectionCard>
          </div>
        )}

        {/* System */}
        {activeTab === 'system' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card label="待处理任务" value={system?.queue_length ?? '-'} />
              <Card label="活跃 Worker" value={system?.active_workers ?? '-'} />
              <Card label="Redis 连接" value={system?.redis_connected ? '正常' : '异常'} tone={system?.redis_connected ? 'good' : 'bad'} />
              <Card label="数据库大小" value={system?.db_size_bytes != null ? fmtSize(system.db_size_bytes) : '-'} />
            </div>
            <div className="rounded-xl border border-[var(--light-gray)] bg-white p-6">
              <div className="mb-3 text-lg font-semibold">服务器信息</div>
              <div className="space-y-1 text-sm text-[var(--gray)]">
                <div>后端运行端口: 8080</div>
                <div>PostgreSQL: ib_dashboard</div>
                <div>Redis: {REDIS_URL}</div>
                <div>Python: {navigator.userAgent.includes('Macintosh') ? 'macOS' : 'Linux'}</div>
              </div>
            </div>
          </div>
        )}

        {/* Logs */}
        {activeTab === 'logs' && (
          <div className="rounded-xl border border-[var(--light-gray)] bg-white p-4 md:p-6">
            <div className="mb-4 text-lg font-semibold">操作日志（共 {logs.total} 条）</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--light-gray)] text-left text-[var(--gray)]">
                    <th className="py-2">时间</th>
                    <th className="py-2">管理员</th>
                    <th className="py-2">操作</th>
                    <th className="py-2">目标类型</th>
                    <th className="py-2">目标 ID</th>
                    <th className="py-2">IP</th>
                    <th className="py-2">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.list.map((l) => (
                    <tr key={l.id} className="border-b border-[var(--lighter-gray)]">
                      <td className="py-2">{fmtDate(l.created_at)}</td>
                      <td className="py-2">{l.admin_email}</td>
                      <td className="py-2">{l.action}</td>
                      <td className="py-2">{l.target_type || '-'}</td>
                      <td className="py-2 max-w-xs truncate" title={l.target_id}>{l.target_id || '-'}</td>
                      <td className="py-2">{l.ip_address || '-'}</td>
                      <td className="py-2 max-w-xs truncate" title={JSON.stringify(l.details)}>{JSON.stringify(l.details)}</td>
                    </tr>
                  ))}
                  {!logs.list.length && <tr><td colSpan={7} className="py-6 text-center text-[var(--gray)]">暂无记录</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination offset={logOffset} limit={LOG_LIMIT} total={logs.total} onChange={setLogOffset} />
          </div>
        )}

        {/* Config */}
        {activeTab === 'config' && (
          <div className="rounded-xl border border-[var(--light-gray)] bg-white p-4 md:p-6">
            <div className="mb-4 text-lg font-semibold">全局配置</div>
            <textarea
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              rows={20}
              className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
            />
            <div className="mt-4 flex gap-2">
              <button onClick={saveConfig} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-gray-800">保存配置</button>
              <button onClick={loadConfig} className="rounded-lg border px-4 py-2 text-sm hover:bg-black hover:text-white">重置</button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedUser && userDetail && (
        <Modal onClose={() => { setSelectedUser(null); setUserDetail(null); }} title="用户详情">
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><span className="text-[var(--gray)]">ID:</span> {userDetail.user.id}</div>
              <div><span className="text-[var(--gray)]">用户名:</span> {userDetail.user.username || '-'}</div>
              <div><span className="text-[var(--gray)]">邮箱:</span> {userDetail.user.email}</div>
              <div><span className="text-[var(--gray)]">登录 IP:</span> {userDetail.user.last_login_ip || '-'}</div>
              <div><span className="text-[var(--gray)]">等级:</span> {userDetail.user.tier || 'free'}</div>
              <div><span className="text-[var(--gray)]">最大账户:</span> {userDetail.user.max_accounts || 1}</div>
              <div><span className="text-[var(--gray)]">基础货币:</span> {userDetail.user.base_currency || 'USD'}</div>
              <div><span className="text-[var(--gray)]">状态:</span> {userDetail.user.is_active ? '正常' : '禁用'}</div>
            </div>
            <div className="pt-2 font-semibold">关联账户</div>
            <div className="max-h-40 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-[var(--lighter-gray)]"><tr><th className="px-2 py-1 text-left">账户</th><th className="px-2 py-1 text-left">标签</th></tr></thead>
                <tbody>
                  {userDetail.accounts.map(a => <tr key={a.account_id} className="border-b"><td className="px-2 py-1">{a.account_id}</td><td className="px-2 py-1">{a.label || '-'}</td></tr>)}
                  {!userDetail.accounts.length && <tr><td colSpan={2} className="px-2 py-2 text-center text-[var(--gray)]">无</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="pt-2 font-semibold">最近上传</div>
            <div className="max-h-40 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-[var(--lighter-gray)]"><tr><th className="px-2 py-1 text-left">文件名</th><th className="px-2 py-1 text-left">状态</th><th className="px-2 py-1 text-left">时间</th></tr></thead>
                <tbody>
                  {userDetail.recent_uploads.map(u => <tr key={u.id} className="border-b"><td className="px-2 py-1 max-w-xs truncate" title={u.filename}>{u.filename}</td><td className="px-2 py-1"><StatusBadge status={u.status} /></td><td className="px-2 py-1">{fmtDate(u.created_at)}</td></tr>)}
                  {!userDetail.recent_uploads.length && <tr><td colSpan={3} className="px-2 py-2 text-center text-[var(--gray)]">无</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}

      {editUserOpen && selectedUser && (
        <Modal onClose={() => setEditUserOpen(false)} title="编辑用户">
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 gap-3">
              <label className="flex items-center gap-2"><input type="checkbox" checked={editUserForm.is_active} onChange={(e) => setEditUserForm(s => ({ ...s, is_active: e.target.checked }))} /> 启用账户</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={editUserForm.is_admin} onChange={(e) => setEditUserForm(s => ({ ...s, is_admin: e.target.checked }))} /> 管理员</label>
              <div>
                <div className="mb-1 text-[var(--gray)]">等级</div>
                <select value={editUserForm.tier} onChange={(e) => setEditUserForm(s => ({ ...s, tier: e.target.value }))} className="w-full rounded-lg border px-3 py-2">
                  <option value="free">free</option>
                  <option value="pro">pro</option>
                  <option value="enterprise">enterprise</option>
                </select>
              </div>
              <div>
                <div className="mb-1 text-[var(--gray)]">最大账户数</div>
                <input type="number" min={1} value={editUserForm.max_accounts} onChange={(e) => setEditUserForm(s => ({ ...s, max_accounts: parseInt(e.target.value || '1', 10) }))} className="w-full rounded-lg border px-3 py-2" />
              </div>
              <div>
                <div className="mb-1 text-[var(--gray)]">基础货币</div>
                <input value={editUserForm.base_currency} onChange={(e) => setEditUserForm(s => ({ ...s, base_currency: e.target.value }))} className="w-full rounded-lg border px-3 py-2" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={saveUser} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-gray-800">保存</button>
              <button onClick={() => setEditUserOpen(false)} className="rounded-lg border px-4 py-2 text-sm hover:bg-black hover:text-white">取消</button>
            </div>
          </div>
        </Modal>
      )}

      {selectedUpload && (
        <Modal onClose={() => setSelectedUpload(null)} title="上传详情">
          <div className="space-y-2 text-sm">
            <div><span className="text-[var(--gray)]">ID:</span> {selectedUpload.id}</div>
            <div><span className="text-[var(--gray)]">用户:</span> {selectedUpload.email}</div>
            <div><span className="text-[var(--gray)]">文件名:</span> {selectedUpload.filename}</div>
            <div><span className="text-[var(--gray)]">账户:</span> {selectedUpload.account_id || '-'}</div>
            <div><span className="text-[var(--gray)]">状态:</span> <StatusBadge status={selectedUpload.status} /></div>
            <div><span className="text-[var(--gray)]">导入行数:</span> {selectedUpload.rows_inserted || 0}</div>
            <div><span className="text-[var(--gray)]">创建时间:</span> {fmtDate(selectedUpload.created_at)}</div>
            <div><span className="text-[var(--gray)]">完成时间:</span> {fmtDate(selectedUpload.completed_at)}</div>
            {selectedUpload.error_message && <div className="rounded bg-red-50 p-2 text-red-700"><span className="font-semibold">错误:</span> {selectedUpload.error_message}</div>}
            <div className="flex flex-wrap gap-2 pt-2">
              <button onClick={() => retryUpload(selectedUpload.id)} className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white">重新处理</button>
              <button onClick={() => downloadUpload(selectedUpload.id)} className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white">下载文件</button>
              <button onClick={() => { setCompareUploadOpen(true); setCompareTarget(null); setCompareResult(null); }} className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white">版本对比</button>
            </div>
          </div>
        </Modal>
      )}

      {compareUploadOpen && selectedUpload && (
        <Modal onClose={() => { setCompareUploadOpen(false); setCompareResult(null); }} title="选择对比版本">
          <div className="space-y-3 text-sm">
            <div className="text-[var(--gray)]">基准版本: <span className="font-medium text-black">{selectedUpload.filename}</span></div>
            <div className="max-h-48 overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-[var(--lighter-gray)]"><tr><th className="px-2 py-1 text-left">文件名</th><th className="px-2 py-1 text-left">时间</th><th className="px-2 py-1 text-left">操作</th></tr></thead>
                <tbody>
                  {uploads.list.filter(u => u.id !== selectedUpload.id && u.account_id === selectedUpload.account_id).map(u => (
                    <tr key={u.id} className="border-b">
                      <td className="px-2 py-1 max-w-[180px] truncate" title={u.filename}>{u.filename}</td>
                      <td className="px-2 py-1">{fmtDate(u.created_at)}</td>
                      <td className="px-2 py-1">
                        <button onClick={() => { setCompareTarget(u); runCompare(selectedUpload.id, u.id); }} className="rounded border px-2 py-0.5 text-xs hover:bg-black hover:text-white">对比</button>
                      </td>
                    </tr>
                  ))}
                  {!uploads.list.filter(u => u.id !== selectedUpload.id && u.account_id === selectedUpload.account_id).length && (
                    <tr><td colSpan={3} className="px-2 py-2 text-center text-[var(--gray)]">无同账户的其他上传记录</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {compareResult && (
              <div className="rounded-lg border border-[var(--light-gray)] p-3">
                <div className="mb-2 font-semibold">对比结果</div>
                <div className="mb-1 text-xs text-[var(--gray)]">{compareResult.dates?.older} → {compareResult.dates?.newer}</div>
                <div className="mb-1">持仓变化: {compareResult.positionChanges?.length || 0} 条</div>
                <div className="mb-2">交易数: {compareResult.tradeCounts?.older || 0} → {compareResult.tradeCounts?.newer || 0}</div>
                <div className="max-h-40 overflow-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="bg-[var(--lighter-gray)]"><tr><th className="px-2 py-1 text-left">标的</th><th className="px-2 py-1 text-left">变化</th><th className="px-2 py-1 text-left">前</th><th className="px-2 py-1 text-left">后</th></tr></thead>
                    <tbody>
                      {(compareResult.positionChanges || []).map((c, i) => (
                        <tr key={i} className="border-b">
                          <td className="px-2 py-1">{c.symbol}</td>
                          <td className="px-2 py-1">{c.change === 'added' ? '新增' : c.change === 'removed' ? '移除' : '变更'}</td>
                          <td className="px-2 py-1">{c.position_before}</td>
                          <td className="px-2 py-1">{c.position_after}</td>
                        </tr>
                      ))}
                      {!(compareResult.positionChanges || []).length && <tr><td colSpan={4} className="px-2 py-2 text-center text-[var(--gray)]">无持仓变化</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {statsAccount && accountStats && (
        <Modal onClose={() => { setStatsAccount(null); setAccountStats(null); }} title={`账户统计: ${statsAccount.account_id}`}>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <Metric label="NAV 天数" value={accountStats.nav?.days} />
              <Metric label="最大 NAV" value={accountStats.nav?.max_nav != null ? Number(accountStats.nav.max_nav).toFixed(2) : '-'} />
              <Metric label="持仓日期数" value={accountStats.positions?.pos_days} />
              <Metric label="持仓标的数" value={accountStats.positions?.symbols} />
              <Metric label="交易总数" value={accountStats.trades?.trades} />
              <Metric label="买入 / 卖出" value={`${accountStats.trades?.buys || 0} / ${accountStats.trades?.sells || 0}`} />
              <Metric label="上传数" value={accountStats.uploads?.uploads} />
              <Metric label="导入总行数" value={accountStats.uploads?.total_rows} />
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`/?admin_preview_user=${statsAccount.user_id}&admin_preview_account=${statsAccount.account_id}`} target="_blank" className="inline-block rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-gray-800">查看 Dashboard</a>
              <a href={api.adminExportDashboard(statsAccount.user_id, statsAccount.account_id, 'csv')} target="_blank" className="inline-block rounded-lg border px-4 py-2 text-sm hover:bg-black hover:text-white">导出 CSV</a>
              <a href={api.adminExportDashboard(statsAccount.user_id, statsAccount.account_id, 'json')} target="_blank" className="inline-block rounded-lg border px-4 py-2 text-sm hover:bg-black hover:text-white">导出 JSON</a>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Card({ label, value, tone }) {
  const toneClass = tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-green-600' : 'text-black';
  return (
    <div className="rounded-xl border border-[var(--light-gray)] bg-white p-4">
      <div className="text-xs text-[var(--gray)]">{label}</div>
      <div className={classNames('text-2xl font-semibold', toneClass)}>{value}</div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-[var(--lighter-gray)] p-3">
      <div className="text-xs text-[var(--gray)]">{label}</div>
      <div className="text-lg font-semibold">{value ?? '-'}</div>
    </div>
  );
}

function SectionCard({ title, children }) {
  return (
    <div className="rounded-xl border border-[var(--light-gray)] bg-white p-4 md:p-6">
      <div className="mb-3 text-base font-semibold">{title}</div>
      {children}
    </div>
  );
}

function SimpleTable({ cols, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--light-gray)] text-left text-[var(--gray)]">
            {cols.map((c, i) => <th key={i} className="py-2">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-[var(--lighter-gray)]">
              {row.map((cell, ci) => <td key={ci} className="py-2">{cell}</td>)}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={cols.length} className="py-4 text-center text-[var(--gray)]">暂无数据</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({ offset, limit, total, onChange }) {
  const current = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit) || 1;
  return (
    <div className="mt-4 flex items-center gap-2 text-sm">
      <button disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))} className="rounded border px-3 py-1 disabled:opacity-40 hover:bg-black hover:text-white">上一页</button>
      <span className="text-[var(--gray)]">第 {current} / {pages} 页（共 {total} 条）</span>
      <button disabled={offset + limit >= total} onClick={() => onChange(offset + limit)} className="rounded border px-3 py-1 disabled:opacity-40 hover:bg-black hover:text-white">下一页</button>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    done: 'bg-green-100 text-green-700',
    running: 'bg-blue-100 text-blue-700',
    pending: 'bg-yellow-100 text-yellow-700',
    failed: 'bg-red-100 text-red-700',
  };
  return <span className={classNames('rounded px-2 py-0.5 text-xs', map[status] || 'bg-gray-100 text-gray-700')}>{status}</span>;
}

function Modal({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-[var(--light-gray)] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-semibold">{title}</div>
          <button onClick={onClose} className="text-2xl leading-none text-[var(--gray)] hover:text-black">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}
