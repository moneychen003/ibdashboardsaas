import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login({ username, password });
      if (res.token) {
        localStorage.setItem('token', res.token);
        navigate('/');
      }
    } catch (err) {
      setError(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--light-gray)] bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-bold">欢迎回来</h1>
        <p className="mb-6 text-sm text-[var(--gray)]">登录您的 IB Dashboard 账户</p>
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--gray)]">用户名 / 邮箱</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-[var(--light-gray)] px-4 py-2 text-sm outline-none focus:border-black"
              placeholder="your_username 或 your@email.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--gray)]">密码</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[var(--light-gray)] px-4 py-2 text-sm outline-none focus:border-black"
              placeholder="******"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-black py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
        <div className="mt-6 text-center text-sm text-[var(--gray)]">
          还没有账户？{' '}
          <Link to="/register" className="font-medium text-black underline">
            立即注册
          </Link>
        </div>
      </div>
    </div>
  );
}
