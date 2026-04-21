import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { fmtCur, fmtPct, fmtNum } from '../utils/format';
import ECharts from '../components/ECharts';

const TAB_LABELS = {
  overview: '📊 总览',
  positions: '💼 持仓',
  performance: '📈 业绩',
  details: '📝 明细',
  changes: '📋 变动',
};

function ShareHero({ data }) {
  const summary = data?.summary || {};
  const baseCurrency = data?.baseCurrency || 'CNH';
  const totalValue = summary?.totalValue || summary?.endingValue || 0;
  const totalGain = summary?.totalGain || 0;
  const totalGainPct = summary?.totalGainPct || 0;

  return (
    <div className="rounded-2xl bg-black p-6 text-white">
      <div className="mb-2 text-sm text-gray-400">
        账户总净值 ({data?.accountId || 'combined'}) 截止 {data?.asOfDate?.slice(0, 10) || '-'}
      </div>
      <div className="mb-1 text-4xl font-bold tracking-tight">
        {fmtCur(totalValue, baseCurrency)}
      </div>
      <div className={`text-lg font-medium ${totalGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
        {(totalGain >= 0 ? '+' : '') + fmtCur(totalGain, baseCurrency)} {fmtPct(totalGainPct)}
      </div>
    </div>
  );
}

function ShareOverview({ data }) {
  const summary = data?.summary || {};
  const baseCurrency = data?.baseCurrency || 'CNH';
  const history = data?.history || [];

  const chartData = history.map((h) => ({
    date: h.date,
    value: h.endingValue || h.value || 0,
  }));

  const chartOption = chartData.length > 0 ? {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const p = params[0];
        return `<div style="font-weight:600;">${p.axisValue}</div><div>${fmtCur(p.value)}</div>`;
      },
    },
    grid: { left: 16, right: 16, top: 16, bottom: 16 },
    xAxis: { type: 'category', data: chartData.map((d) => d.date), show: false },
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'line',
      data: chartData.map((d) => d.value),
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#000', width: 2 },
      areaStyle: {
        color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: 'rgba(0,0,0,0.1)' }, { offset: 1, color: 'rgba(0,0,0,0)' }]
        }
      },
    }],
  } : null;

  const cards = [
    { label: '最新净值', value: summary?.endingValue || summary?.totalValue || 0 },
    { label: '股票市值', value: summary?.stockValue || 0 },
    { label: 'ETF 市值', value: summary?.etfValue || 0 },
    { label: '期权市值', value: summary?.optionValue || 0 },
    { label: '现金', value: summary?.cash || 0 },
  ];

  return (
    <div className="space-y-6">
      <ShareHero data={data} />
      {chartOption && (
        <div className="h-64 rounded-2xl border border-[var(--light-gray)] p-4">
          <ECharts option={chartOption} style={{ height: '100%' }} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-[var(--light-gray)] p-4">
            <div className="mb-1 text-sm text-[var(--gray)]">{c.label}</div>
            <div className="text-xl font-semibold">{fmtCur(c.value, baseCurrency)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SharePositions({ data }) {
  const positions = data?.openPositions || [];
  const baseCurrency = data?.baseCurrency || 'CNH';

  return (
    <div className="rounded-xl border border-[var(--light-gray)] overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--lighter-gray)]">
          <tr>
            <th className="px-4 py-2 text-left">标的</th>
            <th className="px-4 py-2 text-right">数量</th>
            <th className="px-4 py-2 text-right">市值</th>
            <th className="px-4 py-2 text-right">成本价</th>
            <th className="px-4 py-2 text-right">盈亏</th>
            <th className="px-4 py-2 text-right">盈亏%</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => (
            <tr key={i} className="border-b">
              <td className="px-4 py-2 font-medium">{p.symbol || '-'}</td>
              <td className="px-4 py-2 text-right">{fmtNum(p.quantity, 0)}</td>
              <td className="px-4 py-2 text-right">{fmtCur(p.positionValue, baseCurrency)}</td>
              <td className="px-4 py-2 text-right">{fmtCur(p.costBasis, baseCurrency)}</td>
              <td className={`px-4 py-2 text-right ${(p.unrealizedPnL || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {fmtCur(p.unrealizedPnL, baseCurrency)}
              </td>
              <td className={`px-4 py-2 text-right ${(p.unrealizedPnLPct || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {fmtPct(p.unrealizedPnLPct)}
              </td>
            </tr>
          ))}
          {!positions.length && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-[var(--gray)]">暂无持仓</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SharePerformance({ data }) {
  const baseCurrency = data?.baseCurrency || 'CNH';
  const stats = data?.monthlyTradeStats || [];

  return (
    <div className="rounded-xl border border-[var(--light-gray)] overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--lighter-gray)]">
          <tr>
            <th className="px-4 py-2 text-left">月份</th>
            <th className="px-4 py-2 text-right">交易额</th>
            <th className="px-4 py-2 text-right">盈亏</th>
            <th className="px-4 py-2 text-right">交易次数</th>
            <th className="px-4 py-2 text-right">胜率</th>
          </tr>
        </thead>
        <tbody>
          {stats.slice(0, 12).map((s, i) => (
            <tr key={i} className="border-b">
              <td className="px-4 py-2">{s.month || '-'}</td>
              <td className="px-4 py-2 text-right">{fmtCur(s.tradeVolume, baseCurrency)}</td>
              <td className={`px-4 py-2 text-right ${(s.pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {fmtCur(s.pnl, baseCurrency)}
              </td>
              <td className="px-4 py-2 text-right">{s.tradeCount || 0}</td>
              <td className="px-4 py-2 text-right">{fmtPct(s.winRate)}</td>
            </tr>
          ))}
          {!stats.length && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-[var(--gray)]">暂无数据</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ShareDetails({ data }) {
  const trades = data?.trades || [];
  const baseCurrency = data?.baseCurrency || 'CNH';

  return (
    <div className="rounded-xl border border-[var(--light-gray)] overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--lighter-gray)]">
          <tr>
            <th className="px-4 py-2 text-left">日期</th>
            <th className="px-4 py-2 text-left">标的</th>
            <th className="px-4 py-2 text-left">方向</th>
            <th className="px-4 py-2 text-right">数量</th>
            <th className="px-4 py-2 text-right">价格</th>
            <th className="px-4 py-2 text-right">金额</th>
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 50).map((t, i) => (
            <tr key={i} className="border-b">
              <td className="px-4 py-2">{t.tradeDate || t.date || '-'}</td>
              <td className="px-4 py-2 font-medium">{t.symbol || '-'}</td>
              <td className="px-4 py-2">{t.buySell || '-'}</td>
              <td className="px-4 py-2 text-right">{fmtNum(t.quantity, 0)}</td>
              <td className="px-4 py-2 text-right">{fmtCur(t.tradePrice, baseCurrency)}</td>
              <td className="px-4 py-2 text-right">{fmtCur(t.proceeds, baseCurrency)}</td>
            </tr>
          ))}
          {!trades.length && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-[var(--gray)]">暂无交易</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ShareChanges({ data }) {
  const changes = data?.positionChanges?.changes || [];
  const baseCurrency = data?.baseCurrency || 'CNH';

  return (
    <div className="rounded-xl border border-[var(--light-gray)] overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--lighter-gray)]">
          <tr>
            <th className="px-4 py-2 text-left">日期</th>
            <th className="px-4 py-2 text-left">标的</th>
            <th className="px-4 py-2 text-left">类型</th>
            <th className="px-4 py-2 text-right">变动数量</th>
            <th className="px-4 py-2 text-right">市值</th>
          </tr>
        </thead>
        <tbody>
          {changes.slice(0, 50).map((c, i) => (
            <tr key={i} className="border-b">
              <td className="px-4 py-2">{c.date || '-'}</td>
              <td className="px-4 py-2 font-medium">{c.symbol || '-'}</td>
              <td className="px-4 py-2">{c.type || '-'}</td>
              <td className="px-4 py-2 text-right">{fmtNum(c.quantityChange, 0)}</td>
              <td className="px-4 py-2 text-right">{fmtCur(c.marketValue, baseCurrency)}</td>
            </tr>
          ))}
          {!changes.length && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-[var(--gray)]">暂无变动</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function PublicSharePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const cfg = await api.getShareConfig(token);
        if (cancelled) return;
        const defaultTab = cfg.allowed_tabs?.[0] || 'overview';
        navigate(`/${cfg.account_id || 'combined'}/${defaultTab}?share_token=${encodeURIComponent(token)}`, { replace: true });
      } catch (e) {
        if (!cancelled) setError(e.message || '链接无效或已过期');
      }
    }
    init();
    return () => { cancelled = true; };
  }, [token, navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center text-red-600">
          <div className="mb-2 text-xl font-semibold">链接无效或已过期</div>
          <div className="text-sm">该分享链接可能已被删除或超过有效期</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-2 text-2xl">加载中...</div>
        <div className="text-[var(--gray)]">正在获取分享数据</div>
      </div>
    </div>
  );
}
