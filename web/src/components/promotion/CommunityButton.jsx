import { useT } from '../../lib/i18n';

export default function CommunityButton({ onClick }) {
  const t = useT();
  return (
    <button
      onClick={onClick}
      title={t('加入群聊')}
      className="flex items-center justify-center rounded-lg border border-green-500 bg-green-500 text-white hover:bg-green-600 transition shrink-0
                 h-8 w-8 sm:h-auto sm:w-auto sm:px-3 sm:py-1.5 sm:text-sm sm:font-medium"
    >
      <span>💬</span>
      <span className="hidden sm:inline ml-1">{t('加入群聊')}</span>
    </button>
  );
}
