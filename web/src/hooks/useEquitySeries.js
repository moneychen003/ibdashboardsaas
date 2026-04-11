import { useMemo } from 'react';
import { parseDate } from '../utils/format';
import { useDashboardStore } from '../stores/dashboardStore';

export function useEquitySeries(data, range) {
  const customNavStart = useDashboardStore((s) => s.customNavStart);
  const customNavEnd = useDashboardStore((s) => s.customNavEnd);

  return useMemo(() => {
    if (!data) return [];

    let hist;
    if (range === 'custom' && customNavStart) {
      hist = data.history?.navAll || [];
    } else {
      hist = data.history?.[range] || data.history?.navAll || [];
    }
    if (!hist.length) return [];

    const series = hist.map((h) => ({
      date: h.date ? parseDate(h.date) : new Date(),
      value: h.nav || 0,
    }));

    const pnlMap = {};
    (data.dailyPnL || []).forEach((d) => {
      const normDate = d.date ? parseDate(d.date).toISOString().slice(0, 10) : '';
      if (normDate) pnlMap[normDate] = d.pnl;
    });

    for (let i = 0; i < series.length; i++) {
      const dateStr = series[i].date.toISOString().slice(0, 10);
      series[i].dailyPL = pnlMap[dateStr] ?? 0;
    }

    if (range === 'navAll' || !range) return series;

    if (range === 'custom') {
      if (!customNavStart) return series;
      let filtered = series.filter((s) => s.date.toISOString().slice(0, 10) >= customNavStart);
      if (customNavEnd) {
        filtered = filtered.filter((s) => s.date.toISOString().slice(0, 10) <= customNavEnd);
      }
      return filtered;
    }

    const now = new Date();
    let cutoff = new Date();
    if (range === 'nav1Week') cutoff.setDate(now.getDate() - 7);
    else if (range === 'navMTD') cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (range === 'nav1Month') cutoff.setDate(now.getDate() - 30);
    else if (range === 'nav3Months') cutoff.setDate(now.getDate() - 90);
    else if (range === 'nav1Year') cutoff.setFullYear(now.getFullYear() - 1);
    else if (range === 'navYTD') cutoff = new Date(now.getFullYear(), 0, 1);

    return series.filter((s) => s.date >= cutoff);
  }, [data, range, customNavStart, customNavEnd]);
}
