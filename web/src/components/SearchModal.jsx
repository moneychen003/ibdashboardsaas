import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function SearchModal({ visible, onClose }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ positions: [], trades: [] });
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults({ positions: [], trades: [] });
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [visible, onClose]);

  useEffect(() => {
    if (!query.trim()) {
      setResults({ positions: [], trades: [] });
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.search(query);
        setResults(data);
      } catch (e) {
        setResults({ positions: [], trades: [] });
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  if (!visible) return null;

  const goToPositions = () => {
    onClose();
    navigate('/combined/positions');
  };

  const goToDetails = () => {
    onClose();
    navigate('/combined/details');
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--light-gray)] bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[var(--light-gray)] px-4 py-3">
          <span className="text-[var(--gray)]">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入股票代码搜索持仓或交易..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--gray)]"
          />
          <kbd className="hidden rounded border border-[var(--light-gray)] bg-[var(--lighter-gray)] px-1.5 py-0.5 text-[10px] text-[var(--gray)] sm:inline">ESC</kbd>
        </div>

        <div className="max-h-[50vh] overflow-auto p-2">
          {loading && (
            <div className="py-6 text-center text-xs text-[var(--gray)]">搜索中...</div>
          )}

          {!loading && query.trim() && results.positions.length === 0 && results.trades.length === 0 && (
            <div className="py-6 text-center text-xs text-[var(--gray)]">无结果</div>
          )}

          {results.positions.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gray)]">持仓</div>
              {results.positions.map((p, i) => (
                <button
                  key={i}
                  onClick={goToPositions}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--lighter-gray)]"
                >
                  <div>
                    <span className="font-semibold">{p.symbol}</span>
                    <span className="ml-2 text-xs text-[var(--gray)]">{p.account_id}</span>
                  </div>
                  <div className="text-right text-xs">
                    <div>{p.quantity} 股</div>
                    <div className={p.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {p.unrealized_pnl >= 0 ? '+' : ''}{p.unrealized_pnl?.toFixed?.(2) || p.unrealized_pnl}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {results.trades.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gray)]">交易记录</div>
              {results.trades.map((t, i) => (
                <button
                  key={i}
                  onClick={goToDetails}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--lighter-gray)]"
                >
                  <div>
                    <span className="font-semibold">{t.symbol}</span>
                    <span className="ml-2 text-xs text-[var(--gray)]">{t.trade_date?.slice?.(0, 10)}</span>
                  </div>
                  <div className="text-right text-xs">
                    <span className={t.buy_sell === 'BUY' ? 'text-green-600' : 'text-red-600'}>
                      {t.buy_sell === 'BUY' ? '买入' : '卖出'}
                    </span>
                    <span className="ml-2">{t.quantity}@{t.trade_price}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
