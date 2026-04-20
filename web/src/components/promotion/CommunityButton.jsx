export default function CommunityButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-green-500 bg-green-500 px-2 py-1.5 text-sm font-medium text-white hover:bg-green-600 md:px-3"
    >
      💬<span className="hidden md:inline"> 加入群聊</span>
    </button>
  );
}
