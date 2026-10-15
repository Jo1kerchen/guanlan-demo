const ownOr = (row, key, fallback) => Object.hasOwn(row, key) ? row[key] : fallback;
const finite = Number.isFinite;
const amount = value => finite(value) && value >= 0 ? value : null;
const sum = values => values.every(finite) && finite(values.reduce((total, value) => total + value, 0)) ? values.reduce((total, value) => total + value, 0) : null;
const currency = value => typeof value === 'string' && /^[A-Z][A-Z0-9]{1,14}$/.test(value) ? value : null;

function supportsPriceReturn(p, a) {
  // This is a price return, never a margin/leverage return or an option ROI.
  if (finite(p.leverage) && p.leverage > 1) return false;
  if (finite(p.quantity) && p.quantity < 0) return false;
  if (p.side && !['LONG', 'UNKNOWN'].includes(String(p.side).toUpperCase())) return false;
  const symbol = typeof p.symbol === 'string' ? p.symbol.trim().toUpperCase() : '';
  const usCode = symbol.startsWith('US.') ? symbol.slice(3) : symbol.endsWith('.US') ? symbol.slice(0, -3) : null;
  // Some brokers label their option positions as stock records. A stock label
  // alone must not turn an option premium into an ordinary-share price return.
  if ((usCode !== null && !/^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/.test(usCode)) || /[A-Z]\s*\d{6}[CP]\d+/.test(symbol)) return false;
  if (['stock', 'etf', 'crypto', 'spot'].includes(p.kind)) return true;
  if (p.kind) return false;
  if (a.id === 'cicc') return true; // Legacy screenshot securities have no kind.
  if (a.id !== 'futu') return false;
  return /^(?:US\.[A-Z]{1,5}(?:[.-][A-Z]{1,2})?|[A-Z]{1,5}(?:[.-][A-Z]{1,2})?\.US|MSFT|NVDA)$/.test(symbol);
}

/** A same-quote-currency price return. Missing quantity does not prevent a
 * single-row return, but does prevent estimating its monetary P&L. Reported
 * brokerage P&L is selected separately by holdingAmounts below.
 */
export function holdingPerformance(p, a = {}) {
  const price = amount(ownOr(p, 'price', p.lastPrice));
  const costPrice = amount(ownOr(p, 'costPrice', p.averageCost));
  const priceCurrency = currency(ownOr(p, 'priceCurrency', ownOr(p, 'quoteCurrency', p.currency)));
  const supported = supportsPriceReturn(p, a);
  let returnRate = null, returnStatus = supported ? 'unknown' : 'unsupported';
  if (supported && priceCurrency && costPrice === 0) returnStatus = 'zero-cost';
  else if (supported && priceCurrency && price !== null && costPrice !== null && costPrice > 0) {
    const result = (price - costPrice) / costPrice;
    if (finite(result)) { returnRate = result; returnStatus = 'available'; }
  }
  const difference = supported && priceCurrency && price !== null && costPrice !== null && finite(p.quantity) && p.quantity >= 0 ? (price - costPrice) * p.quantity : null;
  const computedPnl = finite(difference) ? difference : null;
  return { price, costPrice, priceCurrency, returnRate, returnStatus, computedPnl, computedPnlCurrency: computedPnl === null ? null : priceCurrency };
}

export function convertHoldingValue(value, currency, account, base, rates = {}) {
  if (!finite(value) || !currency) return null;
  if (currency === base) return value;
  if (currency === 'USDT' || currency === 'USDC') {
    if (account.originalCurrency !== currency || !finite(account.conversionRate) || account.conversionRate <= 0) return null;
    value *= account.conversionRate; currency = 'USD';
  }
  if (currency !== base) {
    if (![rates[currency], rates[base]].every(rate => finite(rate) && rate > 0)) return null;
    value *= rates[currency] / rates[base];
  }
  return finite(value) ? value : null;
}

/** Use reported P&L, including zero, before the optional price estimate. */
export function holdingAmounts(p, a = {}) {
  const reported = finite(p.unrealizedPnl) ? p.unrealizedPnl : finite(p.pnl) ? p.pnl : null;
  // A partially valued consolidated row must not be silently filled from a
  // different price-based measure when its original P&L lacks an FX quote.
  const calculated = reported === null && a.id !== 'consolidated' ? holdingPerformance(p, a) : null;
  const pnl = reported ?? calculated?.computedPnl ?? null;
  return {
    marketValue: p.kind === 'derivative' ? null : ownOr(p, 'marketValue', p.value),
    marketValueCurrency: ownOr(p, 'marketValueCurrency', p.currency),
    marketValueSource: p.valuationStatus === 'estimated' ? 'calculated' : ['calculated', 'mixed'].includes(p.marketValueSource) ? p.marketValueSource : 'reported',
    pnl,
    pnlCurrency: reported !== null ? ownOr(p, 'pnlCurrency', a.id === 'cicc' ? 'CNY' : p.currency) : calculated?.computedPnlCurrency ?? null,
    pnlSource: reported !== null ? p.valuationStatus === 'estimated' ? 'calculated' : ['calculated', 'mixed'].includes(p.pnlSource) ? p.pnlSource : 'reported' : pnl !== null ? 'calculated' : 'unknown',
  };
}

/** Weighted unit prices and total price P&L / total cost. Every component must
 * have a known quantity and the relevant quote; no average of percentages.
 * Component snapshots may have different timestamps, retained by the caller.
 */
export function groupHoldingPerformance(members, base, rates = {}) {
  const parts = members.map(({ p, a }) => ({ p, a, performance: holdingPerformance(p, a) }));
  const totalQuantity = members.length ? sum(parts.map(({ p }) => finite(p.quantity) && p.quantity >= 0 ? p.quantity : null)) : null;
  const total = field => sum(parts.map(({ p, a, performance }) => {
    if (!finite(p.quantity) || p.quantity < 0 || performance[field] === null) return null;
    return convertHoldingValue(performance[field] * p.quantity, performance.priceCurrency, a, base, rates);
  }));
  const currentValue = members.length ? total('price') : null;
  const totalCost = members.length ? total('costPrice') : null;
  const price = totalQuantity > 0 && currentValue !== null ? currentValue / totalQuantity : null;
  const costPrice = totalQuantity > 0 && totalCost !== null ? totalCost / totalQuantity : null;
  const supported = members.length > 0 && parts.every(({ performance }) => performance.returnStatus !== 'unsupported');
  const pricePnl = supported && totalQuantity > 0 ? sum(parts.map(({ a, performance }) => convertHoldingValue(performance.computedPnl, performance.computedPnlCurrency, a, base, rates))) : null;
  const computedPnl = finite(pricePnl) ? pricePnl : null;
  let returnRate = null, returnStatus = supported ? 'unknown' : 'unsupported';
  if (supported && totalQuantity > 0 && totalCost === 0) returnStatus = 'zero-cost';
  else if (supported && totalQuantity > 0 && totalCost > 0 && computedPnl !== null && finite(computedPnl / totalCost)) {
    returnRate = computedPnl / totalCost; returnStatus = 'available';
  }
  return { price: finite(price) ? price : null, costPrice: finite(costPrice) ? costPrice : null, priceCurrency: base, returnRate, returnStatus, computedPnl, computedPnlCurrency: computedPnl === null ? null : base };
}
