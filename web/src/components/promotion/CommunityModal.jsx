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
