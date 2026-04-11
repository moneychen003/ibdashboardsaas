import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDashboardStore } from '../stores/dashboardStore';
import SettingsPanel from './SettingsPanel';
import { api } from '../api';

function classNames(...c) {
  return c.filter(Boolean).join(' ');
}

export default function Layout({ children }) {
  const navigate = useNavigate();
  const { account, tab } = useParams();

  const auth = useDashboardStore((s) => s.auth);
  const accounts = useDashboardStore((s) => s.accounts);
  const currentAccount = useDashboardStore((s) => s.currentAccount);
  const activeTab = useDashboardStore((s) => s.activeTab);
  const toggleSettings = useDashboardStore((s) => s.toggleSettings);
  const data = useDashboardStore((s) => s.data);
  const registerUploadFns = useDashboardStore((s) => s.registerUploadFns);

  const [updateTime, setUpdateTime] = useState('');
  const [uploadQueue, setUploadQueue] = useState([]);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  useEffect(() => {
    registerUploadFns(
      () => fileInputRef.current?.click(),
      () => folderInputRef.current?.click()
    );
  }, [registerUploadFns]);

  useEffect(() => {
    const now = new Date();
    setUpdateTime(
      '更新于：' +
        now.toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
    );
  }, [data]);

  const modules = auth?.modules || { overview: true, positions: true, performance: true, details: true, changes: true };
  const isAdmin = auth?.is_admin;
  const current = accounts.find((a) => a.alias === currentAccount);

  const tabs = [
    { id: 'overview', label: '📊 总览', show: modules.overview },
    { id: 'positions', label: '💼 持仓', show: modules.positions },
    { id: 'performance', label: '📈 业绩', show: modules.performance },
    { id: 'details', label: '📝 明细', show: modules.details },
    { id: 'changes', label: '📋 变动', show: modules.changes },
  ].filter((t) => t.show);

  function navigateToAccount(alias) {
    navigate(`/${alias}/${tab || activeTab || 'overview'}`);
  }

  function navigateToTab(tabId) {
    navigate(`/${account || currentAccount || 'combined'}/${tabId}`);
  }

  function isAnyUploading() {
    return uploadQueue.some((q) => q.status === 'uploading' || q.status === 'processing');
  }

  async function processQueueItem(id, file) {
    setUploadQueue((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: 'uploading', message: '上传中...' } : q))
    );
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.uploadXml(formData);
      const jobId = res.jobId;
      setUploadQueue((prev) =>
        prev.map((q) => (q.id === id ? { ...q, status: 'processing', message: '处理中...', jobId } : q))
      );
      const poll = setInterval(async () => {
        try {
          const job = await api.jobStatus(jobId);
          if (job.status === 'done') {
            clearInterval(poll);
            setUploadQueue((prev) =>
              prev.map((q) => (q.id === id ? { ...q, status: 'done', message: '完成' } : q))
            );
          } else if (job.status === 'failed') {
            clearInterval(poll);
            setUploadQueue((prev) =>
              prev.map((q) => (q.id === id ? { ...q, status: 'failed', message: job.error || '处理失败' } : q))
            );
          }
        } catch (err) {
          clearInterval(poll);
          setUploadQueue((prev) =>
            prev.map((q) => (q.id === id ? { ...q, status: 'failed', message: err.message || '处理失败' } : q))
          );
        }
      }, 1500);
      setTimeout(() => {
        clearInterval(poll);
        setUploadQueue((prev) =>
          prev.map((q) => (q.id === id && (q.status === 'uploading' || q.status === 'processing') ? { ...q, status: 'failed', message: '超时' } : q))
        );
      }, 300000);
    } catch (err) {
      setUploadQueue((prev) =>
        prev.map((q) => (q.id === id ? { ...q, status: 'failed', message: err.message || '上传失败' } : q))
      );
    }
  }

  async function handleFilesSelected(files) {
    const xmlFiles = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.xml'));
    if (xmlFiles.length === 0) {
      alert('未找到 .xml 文件');
      return;
    }
    const newItems = xmlFiles.map((file) => ({
      id: Math.random().toString(36).slice(2),
      name: file.name,
      status: 'pending',
      message: '等待中',
      file,
    }));
    setUploadQueue((prev) => [...prev, ...newItems]);
    // 串行处理，避免浏览器并发限制和服务器压力过大
    let hasSuccess = false;
    for (const item of newItems) {
      await processQueueItem(item.id, item.file);
    }
    // 检查最终状态
    setUploadQueue((prev) => {
      const finalSuccess = newItems.some((it) => prev.find((q) => q.id === it.id)?.status === 'done');
      if (finalSuccess) {
        setTimeout(() => window.location.reload(), 800);
      }
      return prev;
    });
  }

  async function handleFileChange(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await handleFilesSelected(files);
    e.target.value = '';
  }

  async function handleFolderChange(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await handleFilesSelected(files);
    e.target.value = '';
  }

  function removeQueueItem(id) {
    setUploadQueue((prev) => prev.filter((q) => q.id !== id));
  }

  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 border-b border-[var(--light-gray)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <a href="/" className="flex items-center gap-2 font-semibold text-lg">
              <img src="/logo.jpg" alt="logo" className="h-8 w-8 rounded-lg object-cover" />
              <span className="hidden sm:inline">IB Dashboard</span>
            </a>
            {accounts.length > 0 && (
              <div className="relative group">
                <button className="flex items-center gap-1 rounded-lg border border-[var(--light-gray)] px-3 py-1.5 pb-2 text-sm font-medium hover:border-black">
                  <span>{current?.label || '加载中'}</span>
                  <span>▾</span>
                </button>
                <div className="absolute top-full left-0 hidden min-w-[160px] rounded-lg border border-[var(--light-gray)] bg-white shadow-lg group-hover:block hover:block overflow-hidden">
                  {accounts.map((acc) => (
                    <div
                      key={acc.alias}
                      onClick={() => navigateToAccount(acc.alias)}
                      className={classNames(
                        'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--lighter-gray)]',
                        acc.alias === currentAccount && 'font-semibold'
                      )}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: acc.color }} />
                      <span>{acc.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => navigateToTab(t.id)}
                className={classNames(
                  'rounded-md px-3 py-2 text-sm font-medium transition',
                  activeTab === t.id ? 'bg-[var(--lighter-gray)] text-black' : 'text-[var(--gray)] hover:bg-[var(--lighter-gray)] hover:text-black'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--gray)]">{updateTime}</span>

            <input
              type="file"
              accept=".xml"
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              type="file"
              ref={folderInputRef}
              className="hidden"
              webkitdirectory=""
              directory=""
              onChange={handleFolderChange}
            />

            {isAdmin && (
              <button
                onClick={() => navigate('/admin')}
                className="rounded-lg border border-[var(--light-gray)] px-3 py-1.5 text-sm hover:border-black hover:bg-black hover:text-white"
              >
                管理后台
              </button>
            )}

            {auth?.email ? (
              <>
                <span className="rounded-lg border border-[var(--light-gray)] bg-[var(--lighter-gray)] px-3 py-1.5 text-sm font-medium max-w-[120px] truncate">
                  {auth.email}
                </span>
                <button
                  onClick={() => {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                  }}
                  className="rounded-lg border border-[var(--light-gray)] px-3 py-1.5 text-sm hover:border-black hover:bg-black hover:text-white"
                >
                  退出
                </button>
              </>
            ) : (
              <a
                href="/login"
                className="rounded-lg border border-[var(--light-gray)] px-3 py-1.5 text-sm hover:border-black hover:bg-black hover:text-white"
              >
                登录
              </a>
            )}
            <button
              onClick={() => navigate('/help')}
              className="rounded-lg border border-[var(--light-gray)] px-3 py-1.5 text-sm hover:border-black hover:bg-black hover:text-white"
            >
              ❓ 帮助
            </button>
            {auth?.email && (
              <button
                onClick={toggleSettings}
                className="rounded-lg border border-[var(--light-gray)] px-3 py-1.5 text-sm hover:border-black hover:bg-black hover:text-white"
              >
                ⚙️ 设置
              </button>
            )}
          </div>
        </div>
      </nav>

      {uploadQueue.length > 0 && (
        <div className="mx-auto max-w-[1400px] px-6 pt-6">
          <div className="rounded-xl border border-[var(--light-gray)] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">上传队列 ({uploadQueue.filter((q) => q.status === 'done').length}/{uploadQueue.length} 完成)</div>
              <button
                onClick={() => setUploadQueue((prev) => prev.filter((q) => q.status === 'uploading' || q.status === 'processing'))}
                className="text-xs text-[var(--gray)] hover:text-black"
              >
                清除已完成
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-auto">
              {uploadQueue.map((q) => (
                <div key={q.id} className="flex items-center justify-between rounded-lg border border-[var(--lighter-gray)] px-3 py-2 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${
                      q.status === 'done' ? 'bg-green-500' :
                      q.status === 'failed' ? 'bg-red-500' :
                      q.status === 'processing' ? 'bg-blue-500' :
                      'bg-yellow-400'
                    }`} />
                    <span className="truncate max-w-[200px] sm:max-w-xs" title={q.name}>{q.name}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-xs ${
                      q.status === 'done' ? 'text-green-600' :
                      q.status === 'failed' ? 'text-red-600' :
                      'text-[var(--gray)]'
                    }`}>{q.message}</span>
                    {(q.status === 'done' || q.status === 'failed') && (
                      <button onClick={() => removeQueueItem(q.id)} className="text-xs text-[var(--gray)] hover:text-black">×</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {data?.isDemo && (
        <div className="mx-auto max-w-[1400px] px-6 pt-4">
          <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-amber-900">
            <div className="text-sm">
              <span className="font-semibold">🎉 欢迎体验 IB Dashboard</span>
              <span className="ml-2 hidden sm:inline">当前展示的是示例数据，帮助您快速了解后台界面。导入真实报表后即可查看自己的账户。</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => folderInputRef.current?.click()}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                📁 上传文件夹
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                📤 上传 XML
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1400px] px-6 py-10">{children}</main>
      <SettingsPanel />
    </div>
  );
}
