import ECharts from './ECharts';
import { fmtNum, fmtPct } from '../utils/format';

export default function RiskRadar({ data }) {
  const risk = data?.riskRadar || {};
  const scores = risk.radarScores || {};
  const concentration = risk.concentration || {};

  const option = {
    tooltip: {},
    radar: {
      indicator: [
        { name: '集中度', max: 100 },
        { name: '杠杆', max: 100 },
        { name: '波动率', max: 100 },
        { name: '外汇敞口', max: 100 },
        { name: '期权希腊', max: 100 },
      ],
      radius: '65%',
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: [
              scores.concentration || 0,
              scores.leverage || 0,
              scores.volatility || 0,
              scores.fxExposure || 0,
              scores.optionGreek || 0,
            ],
            name: '风险指标',
            areaStyle: { opacity: 0.2 },
          },
        ],
      },
    ],
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="最大个股占比" value={pctStr(concentration.singleStockMaxPct)} />
        <Stat label="Top5 占比" value={pctStr(concentration.top5Pct)} />
        <Stat label="总持仓数" value={concentration.totalPositions || 0} />
        <Stat label="年化波动" value={pctStr(scores.volatility)} />
      </div>
      <ECharts option={option} style={{ height: 300 }} />
    </div>
  );
}

function pctStr(n) {
  if (n == null || isNaN(n)) return '--';
  return Number(n).toFixed(2) + '%';
}

function Stat({ label, value }) {
  return (
    <div className="rounded border border-[var(--light-gray)] p-3 text-center">
      <div className="text-xs text-[var(--gray)]">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
