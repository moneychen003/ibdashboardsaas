export function fmtNum(n, d = 2) {
  if (n == null || isNaN(n)) return '--';
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n));
}

export const FX_RATES = {
  USD: 1,
  CNH: 7.1887,
  CNY: 7.23,
  HKD: 7.85,
};

export function convertCurrency(value, targetCurrency, baseCurrency = 'BASE', fxRates = {}) {
  if (value == null || isNaN(value)) return value;
  if (targetCurrency === 'BASE') targetCurrency = baseCurrency;
  if (targetCurrency === baseCurrency) return Number(value);

  // Backend fxRates means: 1 unit of foreign currency = ? base currency units
  // If base=CNH and fxRates.USD=7.1887, then 1 USD = 7.1887 CNH
  // So to convert value (in base) to target: value / fxRates[target]
  const targetRate = fxRates?.[targetCurrency];
  if (targetRate != null && targetRate !== 0) {
    return Number(value) / targetRate;
  }

  // Fallback for when fxRates is empty: assume hardcoded rates are USD-based
  const fallbackRates = { USD: 1, CNH: 7.1887, CNY: 7.23, HKD: 7.85 };
  const fbTargetRate = fallbackRates[targetCurrency];
  const fbBaseRate = fallbackRates[baseCurrency];

  if (fbTargetRate && fbBaseRate) {
    // Convert base -> USD -> target
    const usdValue = Number(value) / fbBaseRate;
    return usdValue * fbTargetRate;
  }

  return Number(value);
}

export function fmtCur(n, currency = null) {
  if (n == null || isNaN(n)) return '--';
  const cur = currency || 'BASE';
  const sym = cur === 'USD' ? '$' : (cur === 'CNH' || cur === 'CNY' ? '¥' : (cur === 'EUR' ? '€' : (cur === 'HKD' ? 'HK$' : '')));
  const val = Number(n);
  return (val < 0 ? '-' : '') + sym + fmtNum(Math.abs(val), 2);
}

export function fmtPct(n) {
  if (n == null || isNaN(n)) return '--';
  const v = Number(n) * 100;
  return (v >= 0 ? '+' : '') + fmtNum(v, 2) + '%';
}

export function fmtDate(s) {
  if (!s) return '--';
  if (/^\d{8}$/.test(String(s))) {
    const y = String(s).slice(0, 4), m = String(s).slice(4, 6), d = String(s).slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  const dt = new Date(s);
  if (isNaN(dt)) return s;
  return dt.toLocaleDateString('zh-CN');
}

export function parseDate(s) {
  if (/^\d{8}$/.test(String(s))) {
    return new Date(`${String(s).slice(0, 4)}-${String(s).slice(4, 6)}-${String(s).slice(6, 8)}`);
  }
  return new Date(s);
}
