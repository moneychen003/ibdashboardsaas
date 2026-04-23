import { useEffect, useState, useRef } from 'react';

import { LayoutDashboard, Briefcase, TrendingUp, FileText, RefreshCw, Settings, HelpCircle, ChevronDown, Menu } from 'lucide-react';import { useNavigate, useParams } from 'react-router-dom';
import { useDashboardStore } from '../stores/dashboardStore';
import SettingsPanel from './SettingsPanel';
import { api } from '../api';
import { FEATURES } from '../config/features';
import { CommunityButton, CommunityModal } from './promotion';

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
  const bumpUploadHistory = useDashboardStore((s) => s.bumpUploadHistory);

  const [updateTime, setUpdateTime] = useState('');
  const [uploadQueue, setUploadQueue] = useState([]);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const [modalOpen, setModalOpen] = useState(false);

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
    { id: 'overview', label: '总览', icon: LayoutDashboard, show: modules.overview },
    { id: 'positions', label: '持仓', icon: Briefcase, show: modules.positions },
    { id: 'performance', label: '业绩', icon: TrendingUp, show: modules.performance },
    { id: 'details', label: '明细', icon: FileText, show: modules.details },
    { id: 'changes', label: '变动', icon: RefreshCw, show: modules.changes },
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
            bumpUploadHistory();
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
        <div className="mx-auto flex h-14 sm:h-16 max-w-[1400px] items-center justify-between px-3 md:px-6">
          <div className="flex items-center gap-4">
            <a href="/" className="flex items-center gap-2 font-semibold text-lg">
              <img src="/logo.jpg" alt="logo" className="h-8 w-8 rounded-lg object-cover" />
              <span className="hidden sm:inline">IB Dashboard</span>
            </a>
            {accounts.length > 0 && (
              <div className="relative group">
                <button className="flex items-center gap-1 rounded-lg border border-[var(--light-gray)] px-2 py-1 text-xs font-medium hover:border-black sm:px-3 sm:py-1.5 sm:text-sm">
                  <span className="max-w-[60px] truncate sm:max-w-none">{current?.label?.replace('合并总资产', '账户').replace('全部账户', '账户') || '加载中'}</span>
                  <ChevronDown size={14} />
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

          <div className="flex items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-1 md:gap-2 md:overflow-visible md:py-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => navigateToTab(t.id)}
                className={classNames(
                  'whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium transition md:px-3 md:py-2',
                  activeTab === t.id ? 'bg-[var(--lighter-gray)] text-black' : 'text-[var(--gray)] hover:bg-[var(--lighter-gray)] hover:text-black'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-[var(--gray)] md:inline">{updateTime}</span>

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
                className="rounded-lg border border-[var(--light-gray)] px-2 py-1.5 text-sm hover:border-black hover:bg-black hover:text-white md:px-3"
              >
                <span className="hidden md:inline">管理后台</span>
                <span className="md:hidden">⚙️</span>
              </button>
            )}

            {auth?.email ? (
              <>
                <span className="rounded-lg border border-[var(--light-gray)] bg-[var(--lighter-gray)] px-2 py-1.5 text-sm font-medium max-w-[120px] truncate md:px-3">
                  {auth.email}
                </span>
                <button
                  onClick={() => {
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                  }}
                  className="rounded-lg border border-[var(--light-gray)] px-2 py-1.5 text-sm hover:border-black hover:bg-black hover:text-white md:px-3"
                >
                  <span className="hidden md:inline">退出</span>
                  <span className="md:hidden">↪</span>
                </button>
              </>
            ) : (
              <a
                href="/login"
                className="rounded-lg border border-[var(--light-gray)] px-2 py-1.5 text-sm hover:border-black hover:bg-black hover:text-white md:px-3"
              >
                登录
              </a>
            )}

            {FEATURES.enablePromotion && (
              <CommunityButton onClick={() => setModalOpen(true)} />
            )}

            <button
              onClick={() => navigate('/help')}
              className="rounded-lg border border-[var(--light-gray)] px-2 py-1.5 text-sm hover:border-black hover:bg-black hover:text-white md:px-3"
            >
              ❓<span className="hidden md:inline"> 帮助</span>
            </button>
            {auth?.email && (
              <button
                onClick={toggleSettings}
                className="rounded-lg border border-[var(--light-gray)] px-2 py-1.5 text-sm hover:border-black hover:bg-black hover:text-white md:px-3"
              >
                ⚙️<span className="hidden md:inline"> 设置</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* 移动端底部导航 */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--light-gray)] bg-white/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-around h-14">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => navigateToTab(t.id)}
              className={classNames(
                'flex flex-col items-center justify-center w-full h-full text-[10px] font-medium transition gap-0.5',
                activeTab === t.id ? 'text-black' : 'text-[var(--gray)]'
              )}
            >
              <t.icon size={18} strokeWidth={activeTab === t.id ? 2.5 : 1.5} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {uploadQueue.length > 0 && (
        <div className="mx-auto max-w-[1400px] px-3 pt-4 md:px-6 md:pt-6">
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
        <div className="mx-auto max-w-[1400px] px-3 pt-3 md:px-6 md:pt-4">
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

      {FEATURES.enablePromotion && (
        <CommunityModal visible={modalOpen} onClose={() => setModalOpen(false)} />
      )}

      <main className="mx-auto max-w-[1400px] px-3 py-6 md:px-6 md:py-10">{children}</main>

      {/* Footer */}
      <footer className="border-t border-[var(--light-gray)] bg-white">
        <div className="mx-auto max-w-[1400px] px-3 py-8 md:px-6">
          <div className="flex flex-col items-center gap-6">
            <div className="text-sm font-medium text-gray-500">联系方式</div>
            <div className="flex items-start justify-center gap-8 md:gap-12">
              {/* 微信群 */}
              <div className="text-center">
                <div className="mx-auto flex h-[100px] w-[100px] items-center justify-center rounded-xl border-2 border-green-500 bg-white p-1.5">
                  <img src="/qrcode.png" alt="微信群" className="block h-full w-full object-contain" />
                </div>
                <div className="mt-2 text-xs text-gray-400">微信粉丝群</div>
              </div>
              {/* 个人微信 */}
              <div className="text-center">
                <div className="mx-auto flex h-[100px] w-[100px] items-center justify-center rounded-xl border-2 border-gray-200 bg-white p-1.5">
                  <img src="/wechat_personal.png" alt="个人微信" className="block h-full w-full object-contain" />
                </div>
                <div className="mt-2 text-xs text-gray-400">个人微信</div>
              </div>
              {/* Telegram */}
              <div className="text-center">
                <a
                  href="https://t.me/+ZPLVLJfV0lBkMzZl"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mx-auto flex h-[100px] w-[100px] items-center justify-center rounded-xl bg-[#0088cc] text-white transition hover:bg-[#0077b3]"
                >
                  <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                  </svg>
                </a>
                <div className="mt-2 text-xs text-gray-400">Telegram</div>
              </div>
              {/* Discord */}
              <div className="text-center">
                <a
                  href="https://discord.gg/YbyAww7kzm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mx-auto flex h-[100px] w-[100px] items-center justify-center rounded-xl bg-[#5865F2] text-white transition hover:bg-[#4752C4]"
                >
                  <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                </a>
                <div className="mt-2 text-xs text-gray-400">Discord</div>
              </div>
            </div>
            <a
              href="https://ib.moneychen.com/combined/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-400 underline underline-offset-2 transition hover:text-gray-600"
            >
              查看我的个人持仓 →
            </a>
          </div>
        </div>
      </footer>
      <SettingsPanel />
    </div>
  );
}
