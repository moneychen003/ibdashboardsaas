/**
 * 按标的（underlying）汇总：持仓 + 该标的所有期权合约 + 操作笔数。
 * 跨数据源融合：costBasisHoldings + optionContracts + trades。
 *
 * JS 版（无类型），用于 IB Dashboard React 前端 (Personal + SaaS 共用)。
 */

function num(v) {
  if (v == null) return 0;
  return typeof v === 'number' ? v : (parseFloat(v) || 0);
}

function extractRoot(sym) {
  const m = sym.match(/^([A-Z.]+)\s+\d{6}[CP]\d{8}$/);
  if (m) return m[1];
  return sym.trim();
}

function eaeAction(tt, putCall) {
  switch ((tt || '').toLowerCase()) {
    case 'assignment': return 'assignment';
    case 'expiration': return 'expiration';
    case 'buy': return putCall ? 'opt_close' : 'buy';
    case 'sell': return putCall ? 'opt_open_short' : 'sell';
    default: return 'buy';
  }
}

/**
 * 按 OCC symbol 配对所有期权 sell+buy+EAE，算每个合约的 net PnL 与状态。
 */
export function buildOptionContracts(d) {
  const buckets = new Map();

  for (const t of d.trades ?? []) {
    if (t.assetCategory !== 'OPT') continue;
    const sym = (t.symbol || '').trim();
    if (!buckets.has(sym)) {
      buckets.set(sym, { symbol: sym, sells: [], buys: [], eaeTypes: [], eaeDates: [] });
    }
    const b = buckets.get(sym);
    const tup = {
      date: t.tradeDate,
      qty: Math.abs(num(t.quantity)),
      proceeds: Math.abs(num(t.proceeds)),
    };
    if (t.buySell === 'SELL') b.sells.push(tup);
    else b.buys.push(tup);
  }

  const events = (d.optionEaeEvents && d.optionEaeEvents.events) || [];
  for (const e of events) {
    const sym = (e.symbol || '').trim();
    const b = buckets.get(sym);
    if (!b) continue;
    b.eaeTypes.push(e.transactionType || '');
    b.eaeDates.push(e.date || '');
  }

  const result = new Map();
  for (const [sym, b] of buckets) {
    if (b.sells.length === 0) continue; // 只对卖方起家的合约配对

    const totalPremium = b.sells.reduce((s, x) => s + x.proceeds, 0);
    const totalBuyback = b.buys.reduce((s, x) => s + x.proceeds, 0);
    const totalSellQty = b.sells.reduce((s, x) => s + x.qty, 0);
    const totalBuyQty = b.buys.reduce((s, x) => s + x.qty, 0);

    const hasAssignment = b.eaeTypes.some((t) => /assignment/i.test(t));
    const hasExpiration = b.eaeTypes.some((t) => /expiration/i.test(t));

    let status;
    if (hasAssignment) status = 'assigned';
    else if (hasExpiration) status = 'expired';
    else if (totalBuyQty >= totalSellQty - 0.001) status = 'closed';
    else if (totalBuyQty > 0.001) status = 'partial';
    else status = 'open';

    const netPnl =
      status === 'assigned' || status === 'expired'
        ? totalPremium
        : totalPremium - totalBuyback;

    const sortedSellDates = b.sells.map((x) => x.date).sort();
    const sortedBuyDates = b.buys.map((x) => x.date).sort();
    const sortedEaeDates = b.eaeDates.filter(Boolean).sort();

    const openDate = sortedSellDates[0] || '';
    let closeDate;
    if (status === 'closed' && sortedBuyDates.length > 0) {
      closeDate = sortedBuyDates[sortedBuyDates.length - 1];
    } else if ((status === 'assigned' || status === 'expired') && sortedEaeDates.length > 0) {
      closeDate = sortedEaeDates[sortedEaeDates.length - 1];
    } else if (status === 'partial' && sortedBuyDates.length > 0) {
      closeDate = sortedBuyDates[sortedBuyDates.length - 1];
    }

    result.set(sym, {
      symbol: sym,
      status,
      netPnl,
      totalPremium,
      totalBuyback,
      totalSellQty,
      totalBuyQty,
      openDate,
      closeDate,
    });
  }
  return result;
}

/**
 * 按标的汇总：持仓 + 该标的所有期权合约 + 操作笔数。
 */
export function buildSymbolDigests(d) {
  const cbhBySymbol = new Map();
  for (const c of d.costBasisHoldings ?? []) {
    cbhBySymbol.set(c.symbol, c);
  }

  const fxBySymbol = new Map();
  const allPositions = [
    ...(d.openPositions?.stocks ?? []),
    ...(d.openPositions?.etfs ?? []),
    ...(d.openPositions?.options ?? []),
  ];
  for (const p of allPositions) {
    fxBySymbol.set(p.symbol, {
      fxRateToBase: num(p.fxRateToBase) || 1,
      currency: p.currency || 'USD',
      positionValue: num(p.positionValue),
      positionValueInBase: num(p.positionValueInBase),
    });
  }

  const allContracts = buildOptionContracts(d);

  const contractsByRoot = new Map();
  for (const [, c] of allContracts) {
    const root = extractRoot(c.symbol);
    if (!contractsByRoot.has(root)) contractsByRoot.set(root, []);
    contractsByRoot.get(root).push(c);
  }

  const optionTradeCountByRoot = new Map();
  const stockTradeCountByRoot = new Map();
  for (const t of d.trades ?? []) {
    const root = extractRoot(t.symbol || '');
    if (t.assetCategory === 'OPT') {
      optionTradeCountByRoot.set(root, (optionTradeCountByRoot.get(root) ?? 0) + 1);
    } else if (t.assetCategory === 'STK' || t.assetCategory === 'ETF') {
      stockTradeCountByRoot.set(root, (stockTradeCountByRoot.get(root) ?? 0) + 1);
    }
  }

  const allRoots = new Set();
  cbhBySymbol.forEach((_, sym) => allRoots.add(sym));
  contractsByRoot.forEach((_, root) => allRoots.add(root));
  optionTradeCountByRoot.forEach((_, root) => allRoots.add(root));
  stockTradeCountByRoot.forEach((_, root) => allRoots.add(root));

  const digests = [];
  for (const root of allRoots) {
    const cbh = cbhBySymbol.get(root);
    const fx = fxBySymbol.get(root);
    const contracts = contractsByRoot.get(root) || [];

    let totalSellPutPremium = 0;
    let totalSellCallPremium = 0;
    let totalBuyback = 0;
    let totalNetPnl = 0;
    let assignmentCount = 0;
    let expirationCount = 0;
    let closedCount = 0;
    let openCount = 0;
    let partialCount = 0;

    for (const c of contracts) {
      const isPut = /\d{6}P\d{8}$/.test(c.symbol);
      if (isPut) totalSellPutPremium += c.totalPremium;
      else totalSellCallPremium += c.totalPremium;
      totalBuyback += c.totalBuyback;
      totalNetPnl += c.netPnl;
      switch (c.status) {
        case 'assigned': assignmentCount++; break;
        case 'expired': expirationCount++; break;
        case 'closed': closedCount++; break;
        case 'open': openCount++; break;
        case 'partial': partialCount++; break;
      }
    }

    const currentQty = num(cbh && cbh.currentQty);
    digests.push({
      symbol: root,
      description: cbh && cbh.description,
      assetType: cbh && cbh.assetType,
      currency: (fx && fx.currency) || 'USD',
      hasPosition: currentQty > 0,
      currentQty,
      markPrice: num(cbh && cbh.markPrice),
      positionValue: (fx && fx.positionValue) || 0,
      positionValueInBase: (fx && fx.positionValueInBase) || 0,
      fxRateToBase: (fx && fx.fxRateToBase) || 1,
      avgCostPrice: num(cbh && cbh.avgCostPrice),
      dilutedCostPrice: num(cbh && cbh.dilutedCostPrice),
      mwaPnl: num(cbh && cbh.mwaPnl),
      mwaPct: num(cbh && cbh.mwaPct),
      dilutedPnl: num(cbh && cbh.dilutedPnl),
      dilutedPct: num(cbh && cbh.dilutedPct),
      contracts,
      totalSellPutPremium,
      totalSellCallPremium,
      totalBuyback,
      totalNetPnl,
      assignmentCount,
      expirationCount,
      closedCount,
      openCount,
      partialCount,
      optionTradeCount: optionTradeCountByRoot.get(root) || 0,
      stockTradeCount: stockTradeCountByRoot.get(root) || 0,
    });
  }

  digests.sort((a, b) => {
    const aA = a.contracts.length * 3 + a.optionTradeCount + a.stockTradeCount;
    const bA = b.contracts.length * 3 + b.optionTradeCount + b.stockTradeCount;
    if (aA !== bA) return bA - aA;
    return b.positionValueInBase - a.positionValueInBase;
  });

  return digests;
}

export function buildPortfolioOverview(digests, baseCurrency = 'USD') {
  const positions = digests.filter((d) => d.hasPosition);
  const totalMarketValueInBase = positions.reduce((s, d) => s + d.positionValueInBase, 0);
  const totalUnrealizedInBase = positions.reduce((s, d) => s + d.mwaPnl * d.fxRateToBase, 0);

  let totalContracts = 0;
  let totalSellPremium = 0;
  let totalBuyback = 0;
  let totalOptionNetPnl = 0;
  let closedCount = 0;
  let assignmentCount = 0;
  let expirationCount = 0;
  let openCount = 0;
  let partialCount = 0;
  let optionTradeCount = 0;
  let stockTradeCount = 0;

  for (const d of digests) {
    totalContracts += d.contracts.length;
    totalSellPremium += d.totalSellPutPremium + d.totalSellCallPremium;
    totalBuyback += d.totalBuyback;
    totalOptionNetPnl += d.totalNetPnl;
    closedCount += d.closedCount;
    assignmentCount += d.assignmentCount;
    expirationCount += d.expirationCount;
    openCount += d.openCount;
    partialCount += d.partialCount;
    optionTradeCount += d.optionTradeCount;
    stockTradeCount += d.stockTradeCount;
  }

  return {
    symbolCount: digests.length,
    positionCount: positions.length,
    totalMarketValueInBase,
    totalUnrealizedInBase,
    baseCurrency,
    totalContracts,
    totalSellPremium,
    totalBuyback,
    totalOptionNetPnl,
    closedCount,
    assignmentCount,
    expirationCount,
    openCount,
    partialCount,
    optionTradeCount,
    stockTradeCount,
  };
}
