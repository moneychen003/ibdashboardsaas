import { useEffect, useState } from 'react';
import { X, Sparkles, Zap, Palette, Bug } from 'lucide-react';
import { api } from '../api';

const TYPE_STYLE = {
  fix: { icon: Bug, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
  feature: { icon: Sparkles, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  perf: { icon: Zap, color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  ui: { icon: Palette, color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
};

export default function ReleaseNotesModal({ open, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    setLoading(true);
    api.releaseNotes()
      .then((d) => setData(d))
      .catch(() => setData({ versions: [] }))
      .finally(() => setLoading(false));
  }, [open, data]);

  if (!open) return null;

  const versions = data?.versions || [];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--light-gray)] px-5 py-4">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles size={20} className="text-amber-500" />
            更新日志
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[var(--gray)] transition hover:bg-[var(--lighter-gray)] hover:text-black"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {loading && <div className="py-10 text-center text-sm text-[var(--gray)]">加载中...</div>}
          {!loading && versions.length === 0 && (
            <div className="py-10 text-center text-sm text-[var(--gray)]">暂无更新日志</div>
          )}
          {versions.map((v) => (
            <div key={v.version} className="border-b border-[var(--lighter-gray)] pb-5 last:border-0 last:pb-0">
              <div className="mb-2 flex flex-wrap items-baseline gap-3">
                <span className="rounded-md bg-black px-2 py-1 text-sm font-bold text-white">v{v.version}</span>
                <span className="text-sm text-[var(--gray)]">{v.date}</span>
              </div>
              <div className="mb-2 text-base font-semibold">{v.title}</div>
              {v.summary && <div className="mb-3 text-sm text-[var(--gray)]">{v.summary}</div>}
              <div className="space-y-3">
                {(v.sections || []).map((sec, si) => {
                  const style = TYPE_STYLE[sec.type] || TYPE_STYLE.ui;
                  const Icon = style.icon;
                  return (
                    <div
                      key={si}
                      className={`rounded-lg border ${style.border} ${style.bg} p-3`}
                    >
                      <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${style.color}`}>
                        <Icon size={16} />
                        {sec.label}
                      </div>
                      <ul className="space-y-1.5 pl-1 text-sm leading-relaxed text-gray-800">
                        {sec.items.map((it, ii) => (
                          <li key={ii}>· {it}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
