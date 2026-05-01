import { useEffect, useState, useRef } from 'react';

import { LayoutDashboard, Briefcase, TrendingUp, FileText, RefreshCw, Receipt, Settings, HelpCircle, ChevronDown, Menu, PartyPopper, FolderUp, Upload, Sparkles, Trophy, AlertTriangle, X, PieChart } from 'lucide-react';import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useDashboardStore } from '../stores/dashboardStore';
import SettingsPanel from './SettingsPanel';
import ReleaseNotesModal from './ReleaseNotesModal';
import { api } from '../api';
import { FEATURES } from '../config/features';
import { CommunityButton, CommunityModal } from './promotion';

function classNames(...c) {
  return c.filter(Boolean).join(' ');
}

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { account, tab } = useParams();

  const auth = useDashboardStore((s) => s.auth);
  const accounts = useDashboardStore((s) => s.accounts);
  const currentAccount = useDashboardStore((s) => s.currentAccount);
  const activeTab = useDashboardStore((s) => s.activeTab);
  const toggleSettings = useDashboardStore((s) => s.toggleSettings);
  const data = useDashboardStore((s) => s.data);
  const registerUploadFns = useDashboardStore((s) => s.registerUploadFns);
  const bumpUploadHistory = useDashboardStore((s) => s.bumpUploadHistory);

  const [uploadQueue, setUploadQueue] = useState([]);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target)) setAccountMenuOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    registerUploadFns(
      () => fileInputRef.current?.click(),
      () => folderInputRef.current?.click()
    );
  }, [registerUploadFns]);


  const modules = auth?.modules || { overview: true, positions: true, performance: true, details: true, changes: true };
  const isAdmin = auth?.is_admin;
  const current = accounts.find((a) => a.alias === currentAccount);

  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [hasNewVersion, setHasNewVersion] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(null);

  useEffect(() => {
    api.releaseNotes().then((d) => {
      const ver = d?.currentVersion;
      if (!ver) return;
      setCurrentVersion(ver);
      try {
        const seen = localStorage.getItem('lastSeenReleaseVersion');
        if (seen !== ver) setHasNewVersion(true);
      } catch (e) { /* ignore */ }
    }).catch(() => {});
  }, []);

  function openReleaseNotes() {
    setReleaseNotesOpen(true);
    if (currentVersion) {
      try { localStorage.setItem('lastSeenReleaseVersion', currentVersion); } catch (e) {}
    }
    setHasNewVersion(false);
  }

  const tabs = [
    { id: 'overview', label: '总览', icon: LayoutDashboard, show: modules.overview },
    { id: 'positions', label: '持仓', icon: Briefcase, show: modules.positions },
    { id: 'performance', label: '业绩', icon: TrendingUp, show: modules.performance },
    { id: 'details', label: '明细', icon: FileText, show: modules.details },
    { id: 'changes', label: '变动', icon: RefreshCw, show: modules.changes },
    { id: 'tax', label: '税务', icon: Receipt, show: modules.tax !== false },
    { id: 'chengji', label: '战绩', icon: Trophy, show: modules.chengji !== false },
    { id: 'portfolios', label: '组合', icon: PieChart, show: modules.portfolios !== false },
  ].filter((t) => t.show);

  function navigateToAccount(alias) {
    navigate(`/${alias}/${tab || activeTab || 'overview'}${location.search}`);
  }

  function navigateToTab(tabId) {
    navigate(`/${account || currentAccount || 'combined'}/${tabId}${location.search}`);
  }

  function isAnyUploading() {
    return uploadQueue.some((q) => q.status === 'uploading' || q.status === 'processing');
  }

  async function processQueueItem(id, file) {
    setUploadQueue((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: 'uploading', progress: 0, speed: 0, message: '上传中 0%' } : q))
    );
    try {
      const formData = new FormData();
      formData.append('file', file);
      let lastT = Date.now(), lastL = 0, curSpeed = 0;
      const res = await api.uploadXmlWithProgress(formData, ({ loaded, total }) => {
        const now = Date.now();
        const dt = (now - lastT) / 1000;
        if (dt >= 0.4) {
          curSpeed = (loaded - lastL) / dt;
          lastT = now;
          lastL = loaded;
        }
        const pct = total > 0 ? Math.floor((loaded / total) * 100) : 0;
        const sp = curSpeed > 0 ? (curSpeed >= 1024*1024 ? `${(curSpeed/1024/1024).toFixed(1)} MB/s` : `${(curSpeed/1024).toFixed(0)} KB/s`) : '';
        setUploadQueue((prev) =>
          prev.map((q) => q.id === id ? { ...q, status: 'uploading', progress: pct, speed: curSpeed, message: sp ? `上传中 ${pct}% \u00b7 ${sp}` : `上传中 ${pct}%` } : q)
        );
      });
      const jobId = res.jobId;
      setUploadQueue((prev) =>
        prev.map((q) => (q.id === id ? { ...q, status: 'processing', progress: 100, message: '处理中...', jobId } : q))
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
              <img src="/logo.jpg" alt="logo" className="h-8 w-8 rounded-lg object-cover ring-2 ring-violet-100" />
              <span className="hidden sm:inline bg-gradient-to-r from-violet-600 via-rose-500 to-amber-500 bg-clip-text text-transparent">IB Dashboard</span>
            </a>
            {accounts.length > 0 && (
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={() => setAccountMenuOpen((o) => !o)}
                  className="flex items-center gap-1 rounded-lg border border-[var(--light-gray)] px-2 py-1 text-xs font-medium transition-colors hover:border-black sm:px-3 sm:py-1.5 sm:text-sm"
                >
                  <span className="max-w-[60px] truncate sm:max-w-none">{current?.label?.replace('合并总资产', '账户').replace('全部账户', '账户') || '加载中'}</span>
                  <ChevronDown size={14} className={classNames('transition-transform', accountMenuOpen && 'rotate-180')} />
                </button>
                {accountMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 min-w-[160px] rounded-lg border border-[var(--light-gray)] bg-white shadow-lg overflow-hidden z-50">
                    {accounts.map((acc) => (
                      <div
                        key={acc.alias}
                        onClick={() => { navigateToAccount(acc.alias); setAccountMenuOpen(false); }}
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
                )}
              </div>
            )}
          </div>

          <div className="hidden md:flex items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-1 md:gap-2 md:overflow-visible md:py-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => navigateToTab(t.id)}
                className={classNames(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-sm font-medium transition md:px-3 md:py-1.5',
                  activeTab === t.id ? 'bg-gradient-to-r from-violet-50 to-rose-50 text-zinc-900 ring-1 ring-violet-100' : 'text-[var(--gray)] hover:bg-[var(--lighter-gray)] hover:text-black'
                )}
              >
                <t.icon size={16} strokeWidth={activeTab === t.id ? 2.5 : 1.5} /> {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
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

            <button
              onClick={openReleaseNotes}
              className="relative flex items-center gap-1 rounded-lg border border-[var(--light-gray)] px-2 py-1.5 text-xs font-medium text-[var(--gray)] transition-colors hover:border-black hover:text-black md:px-3 md:text-sm"
              title="更新日志"
            >
              <Sparkles size={14} />
              <span className="hidden sm:inline">v{currentVersion || ""}</span>
              {hasNewVersion && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
              )}
            </button>

            {FEATURES.enablePromotion && (
              <CommunityButton onClick={() => setModalOpen(true)} />
            )}

            {auth?.email ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen((o) => !o)}
                  className="flex items-center gap-1 rounded-lg border border-[var(--light-gray)] bg-[var(--lighter-gray)] px-2 py-1.5 text-sm font-medium transition-colors hover:border-black md:px-3"
                >
                  <span className="max-w-[100px] truncate">{auth.email}</span>
                  <ChevronDown size={14} className={classNames('transition-transform', userMenuOpen && 'rotate-180')} />
                </button>
                {userMenuOpen && (
                  <div className="absolute top-full right-0 mt-1 min-w-[180px] rounded-lg border border-[var(--light-gray)] bg-white shadow-lg overflow-hidden py-1 z-50">
                    <div className="px-3 py-2 text-xs text-[var(--gray)] border-b border-[var(--lighter-gray)]">
                      {auth.email}
                    </div>
                    {isAdmin && (
                      <div
                        onClick={() => { navigate('/admin'); setUserMenuOpen(false); }}
                        className="cursor-pointer px-3 py-2 text-sm hover:bg-[var(--lighter-gray)]"
                      >
                        管理后台
                      </div>
                    )}
                    <div
                      onClick={() => { navigate('/help'); setUserMenuOpen(false); }}
                      className="cursor-pointer px-3 py-2 text-sm hover:bg-[var(--lighter-gray)]"
                    >
                      帮助
                    </div>
                    <div
                      onClick={() => { toggleSettings(); setUserMenuOpen(false); }}
                      className="cursor-pointer px-3 py-2 text-sm hover:bg-[var(--lighter-gray)]"
                    >
                      设置
                    </div>
                    <div className="border-t border-[var(--lighter-gray)]">
                      <div
                        onClick={() => {
                          localStorage.removeItem('token');
                          window.location.href = '/login';
                        }}
                        className="cursor-pointer px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        退出
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <a
                  href="/help"
                  className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-[var(--light-gray)] px-2 py-1.5 text-sm transition-colors hover:border-black md:px-3"
                >
                  <HelpCircle size={14} />
                  帮助
                </a>
                <a
                  href="/help"
                  aria-label="帮助"
                  className="sm:hidden inline-flex items-center justify-center rounded-lg border border-[var(--light-gray)] p-1.5 text-sm transition-colors hover:border-black"
                >
                  <HelpCircle size={16} />
                </a>
                <a
                  href="/login"
                  className="rounded-lg border border-[var(--light-gray)] px-2 py-1.5 text-sm transition-colors hover:border-black hover:bg-black hover:text-white md:px-3"
                >
                  登录
                </a>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* 移动端底部导航 */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--light-gray)] bg-white/95 backdrop-blur md:hidden">
        <div className="flex items-stretch overflow-x-auto h-14 no-scrollbar">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => navigateToTab(t.id)}
              className={classNames(
                'flex flex-col items-center justify-center flex-shrink-0 min-w-[64px] flex-1 h-full text-[10px] font-medium transition gap-0.5',
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
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${
                      q.status === 'done' ? 'bg-green-500' :
                      q.status === 'failed' ? 'bg-red-500' :
                      q.status === 'processing' ? 'bg-blue-500' :
                      'bg-yellow-400'
                    }`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate max-w-[200px] sm:max-w-xs" title={q.name}>{q.name}</div>
                      {q.status === 'uploading' && (
                        <div className="mt-1 h-1 w-full max-w-[260px] rounded-full bg-[var(--lighter-gray)] overflow-hidden">
                          <div className="h-full bg-blue-500 transition-all" style={{ width: `${q.progress || 0}%` }} />
                        </div>
                      )}
                    </div>
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
              <span className="inline-flex items-center gap-1.5 font-semibold"><PartyPopper size={16} /> 欢迎体验 IB Dashboard</span>
              <span className="ml-2 hidden sm:inline">当前展示的是示例数据，帮助您快速了解后台界面。导入真实报表后即可查看自己的账户。</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => folderInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100"
              >
                <FolderUp size={14} /> 上传文件夹
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700"
              >
                <Upload size={14} /> 上传 XML
              </button>
            </div>
          </div>
        </div>
      )}

      {FEATURES.enablePromotion && (
        <CommunityModal visible={modalOpen} onClose={() => setModalOpen(false)} />
      )}

      <main className="mx-auto max-w-[1400px] px-3 py-6 pb-24 md:px-6 md:py-10 md:pb-10">
        <DataQualityBanner warning={data?.dataQualityWarning} />
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--light-gray)] bg-white">
        <div className="mx-auto max-w-[1400px] px-3 py-8 md:px-6">
          <div className="flex flex-col items-center gap-6">
            <div className="text-sm font-medium text-gray-500">联系方式</div>
            <div className="flex flex-wrap items-start justify-center gap-8 md:gap-12">
              {/* 个人微信 */}
              <div className="text-center">
                <div className="mx-auto flex h-[120px] w-[120px] items-center justify-center rounded-xl border-2 border-gray-200 bg-white p-1.5">
                  <img
                    src="/wechat_personal.png"
                    alt="个人微信"
                    className="block h-full w-full object-contain"
                  />
                </div>
                <div className="mt-2 text-xs text-gray-400">个人微信</div>
              </div>
              {/* 微信群 */}
              <div className="text-center">
                <div className="mx-auto flex h-[120px] w-[120px] items-center justify-center rounded-xl border-2 border-green-500 bg-white p-1.5">
                  <img
                    src="/qrcode.png"
                    alt="微信群"
                    className="block h-full w-full object-contain"
                  />
                </div>
                <div className="mt-2 text-xs text-gray-400">微信群</div>
              </div>
              {/* Telegram */}
              <div className="text-center">
                <a
                  href="https://t.me/+ZPLVLJfV0lBkMzZl"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mx-auto flex h-[120px] w-[120px] items-center justify-center rounded-xl bg-[#0088cc] text-white transition hover:bg-[#0077b3]"
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
                  className="mx-auto flex h-[120px] w-[120px] items-center justify-center rounded-xl bg-[#5865F2] text-white transition hover:bg-[#4752C4]"
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
      <ReleaseNotesModal open={releaseNotesOpen} onClose={() => setReleaseNotesOpen(false)} />
    </div>
  );
}

function DataQualityBanner({ warning }) {
  const [dismissed, setDismissed] = useState(false);
  if (!warning || dismissed) return null;
  const m = warning.metrics || {};
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-amber-900">{warning.title || '数据可能不完整'}</h3>
            <button
              onClick={() => setDismissed(true)}
              className="flex-shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100"
              aria-label="关闭提示"
              title="本次会话内不再显示"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {warning.message && (
            <p className="mt-1 text-sm text-amber-800">{warning.message}</p>
          )}
          {warning.suggestion && (
            <p className="mt-2 whitespace-pre-line text-sm text-amber-700">{warning.suggestion}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-700/80">
            {m.flexFromDate && m.flexToDate && (
              <span>当前 Flex 窗口：{m.flexFromDate} → {m.flexToDate}（{m.flexWindowDays} 天）</span>
            )}
            <span>持仓 {m.openPositions ?? 0} · 交易 {m.tradeCount ?? 0} · 佣金明细 {m.unbundledCommissionCount ?? 0} · 资金报表 {m.stmtFundsCount ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
