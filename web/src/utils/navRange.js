import { fmtNum, fmtCur } from './format';

export function getCustomRangeSummary(data, startDateStr, endDateStr) {
  const simpleAll = data?.history?.navAll || [];
  const flowMap = {};
  (data?.dailyFlow || []).forEach((d) => {
    flowMap[d.date] = d.flow || 0;
  });

  let interval = simpleAll.filter((n) => n.date >= startDateStr);
  if (endDateStr) {
    interval = interval.filter((n) => n.date <= endDateStr);
  }
  if (!interval.length) {
    return { gain: 0, gainPct: 0, days: 0 };
  }

  let startNavVal = 0;
  let startIdx = 0;
  for (let i = 0; i < interval.length; i++) {
    if (interval[i].nav !== 0) {
      startNavVal = interval[i].nav;
      startIdx = i;
      break;
    }
  }

  let netFlow = 0;
  interval.forEach((n, i) => {
    let flow = flowMap[n.date] || 0;
    if (i === startIdx && Math.abs(flow - startNavVal) < 1) flow = 0;
    if (i >= startIdx) netFlow += flow;
  });

  const endNav = interval[interval.length - 1].nav;
  const gain = endNav - startNavVal - netFlow;
  const gainPct = startNavVal + netFlow !== 0 ? (gain / (startNavVal + netFlow)) * 100 : 0;

  return {
    gain: Math.round(gain * 100) / 100,
    gainPct: Math.round(gainPct * 100) / 100,
    days: interval.length,
  };
}

export function calcAdjustedReturns(navAll, flowMap, startDateStr, endDateStr) {
  let interval = navAll.filter((n) => n.date >= startDateStr);
  if (endDateStr) {
    interval = interval.filter((n) => n.date <= endDateStr);
  }
  let startNavVal = 0;
  let startIdx = 0;
  for (let i = 0; i < interval.length; i++) {
    if (interval[i].nav !== 0) {
      startNavVal = interval[i].nav;
      startIdx = i;
      break;
    }
  }

  let cumFlow = 0;
  return interval.map((n, i) => {
    let flow = flowMap[n.date] || 0;
    if (i === startIdx && Math.abs(flow - startNavVal) < 1) flow = 0;
    cumFlow += flow;
    if (i < startIdx || startNavVal === 0) {
      return { date: n.date, nav: 0 };
    }
    const invested = startNavVal + cumFlow;
    const ret = invested !== 0 ? (n.nav - invested) / invested * 100 : 0;
    return { date: n.date, nav: Math.round(ret * 10000) / 10000 };
  });
}

export function rebaseCumulativeSeries(series, startDateStr, endDateStr) {
  let filtered = series.filter((s) => s.date >= startDateStr);
  if (endDateStr) {
    filtered = filtered.filter((s) => s.date <= endDateStr);
  }
  if (!filtered.length) return [];
  const startVal = filtered[0].nav;
  if (startVal == null || Math.abs(1 + startVal / 100) < 1e-9) {
    return filtered.map((s) => ({ date: s.date, nav: 0 }));
  }
  return filtered.map((s) => ({
    date: s.date,
    nav: Math.round((((1 + s.nav / 100) / (1 + startVal / 100)) - 1) * 10000) / 10000,
  }));
}
