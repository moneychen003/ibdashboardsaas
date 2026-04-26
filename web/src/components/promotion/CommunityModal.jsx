import { useEffect, useState, useCallback } from 'react';
import { FEATURES } from '../../config/features';

const { promotion } = FEATURES;

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function shouldAutoShow() {
  try {
    const saved = localStorage.getItem(promotion.noDisturbKey);
    return saved !== getToday();
  } catch {
    return true;
  }
}

function saveNoDisturb() {
  try {
    localStorage.setItem(promotion.noDisturbKey, getToday());
  } catch {
    // ignore
  }
}

export default function CommunityModal({ visible: forceOpen, onClose }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showContent, setShowContent] = useState(false);

  // 自动弹出逻辑内置在组件里
  const [autoShow, setAutoShow] = useState(false);
  const [wasClosed, setWasClosed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (shouldAutoShow() && !wasClosed) {
        setAutoShow(true);
      }
    }, promotion.autoShowDelay);
    return () => clearTimeout(timer);
  }, [wasClosed]);

  const effectiveVisible = forceOpen || (autoShow && !wasClosed);

  useEffect(() => {
    if (effectiveVisible) {
      setIsOpen(true);
      const t = setTimeout(() => setShowContent(true), 10);
      document.body.style.overflow = 'hidden';
      return () => clearTimeout(t);
    } else {
      setShowContent(false);
      const t = setTimeout(() => {
        setIsOpen(false);
        document.body.style.overflow = '';
      }, 300);
      return () => clearTimeout(t);
    }
  }, [effectiveVisible]);

  const handleClose = useCallback(() => {
    setWasClosed(true);
    onClose?.();
  }, [onClose]);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) handleClose();
  }, [handleClose]);

  const handleNoDisturb = useCallback(() => {
    saveNoDisturb();
    handleClose();
  }, [handleClose]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-5 transition-opacity duration-300 ${
        showContent ? 'bg-black/75 opacity-100' : 'bg-black/75 opacity-0'
      }`}
      style={{ backdropFilter: 'blur(4px)' }}
      onClick={handleOverlayClick}
    >
      <div
        className={`w-full max-w-[380px] overflow-hidden rounded-[20px] bg-white shadow-2xl transition-transform duration-300 ${
          showContent ? 'scale-100 translate-y-0' : 'scale-90 translate-y-5'
        }`}
      >
        {/* Header */}
        <div className="relative px-6 pt-6">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-green-500">
            {promotion.brandLabel}
          </div>
          <div className="text-xl font-bold text-gray-900">{promotion.modalTitle}</div>
          <button
            onClick={handleClose}
            className="absolute right-0 top-6 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm text-gray-500 transition hover:bg-gray-200 hover:text-gray-900"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="mx-6 my-4 h-px bg-gray-100" />

        {/* Body */}
        <div className="px-6 pb-5">
          <div className="rounded-2xl bg-gray-50 p-6 text-center">
            <h3 className="mb-2 text-xl font-bold text-gray-900">{promotion.groupName}</h3>
            <div className="mb-5 text-sm text-gray-500">{promotion.groupSubtitle}</div>
            <div className="mx-auto flex h-[186px] w-[186px] items-center justify-center rounded-2xl border-4 border-green-500 bg-white p-2">
              <img
                src={promotion.qrCodePath}
                alt="群二维码"
                className="block h-full w-full object-contain"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <div
                className="hidden h-full w-full items-center justify-center text-xs text-gray-400"
                style={{ display: 'none' }}
              >
                请放置二维码图片到
                <br />
                public/qrcode.png
              </div>
            </div>
            <div className="mt-3.5 text-[13px] text-gray-400">{promotion.freeSupportText}</div>

            {/* 更多联系方式 */}
            <div className="mt-5 border-t border-gray-200 pt-4">
              <div className="mb-3 text-xs font-medium text-gray-400">更多联系方式</div>
              <div className="flex items-center justify-center gap-6">
                {/* 个人微信 */}
                <div className="text-center">
                  <div className="mx-auto flex h-[80px] w-[80px] items-center justify-center rounded-xl border-2 border-gray-200 bg-white p-1">
                    <img
                      src={promotion.wechatPersonalPath}
                      alt="个人微信"
                      className="block h-full w-full object-contain"
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-gray-400">个人微信</div>
                </div>
                {/* Telegram */}
                <div className="text-center">
                  <a
                    href={promotion.telegramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-auto flex h-[80px] w-[80px] items-center justify-center rounded-xl bg-[#0088cc] text-white transition hover:bg-[#0077b3]"
                  >
                    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                    </svg>
                  </a>
                  <div className="mt-1 text-[11px] text-gray-400">Telegram</div>
                </div>
                {/* Discord */}
                <div className="text-center">
                  <a
                    href="https://discord.gg/YbyAww7kzm"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-auto flex h-[80px] w-[80px] items-center justify-center rounded-xl bg-[#5865F2] text-white transition hover:bg-[#4752C4]"
                  >
                    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                    </svg>
                  </a>
                  <div className="mt-1 text-[11px] text-gray-400">Discord</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 text-center">
          <p className="mb-4 text-[13px] text-gray-400">{promotion.footerText}</p>
          <button
            onClick={handleClose}
            className="w-full rounded-xl bg-green-500 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-green-600"
          >
            进入平台
          </button>
          <button
            onClick={handleNoDisturb}
            className="mt-3 text-[13px] text-gray-300 underline underline-offset-[3px] transition hover:text-gray-400"
          >
            今日不再提示
          </button>
        </div>
      </div>
    </div>
  );
}
