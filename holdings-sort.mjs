import { holdingAmounts, convertHoldingValue, holdingPerformance } from './holdings-performance.mjs';
// Preserve the existing import path for callers of these shared primitives.
export { holdingAmounts, convertHoldingValue } from './holdings-performance.mjs';

export function sortHoldings(rows, order, base, rates) {
  if (!/^(marketValue|price|costPrice|pnl|returnRate)-(asc|desc)$/.test(order)) return [...rows];
  const [field, direction] = order.split('-');
  return rows.map((row, index) => {
    let value;
    if (field === 'price' && row.group) {
      const quote = row.group.referencePrice;
      value = quote ? convertHoldingValue(quote.price, quote.priceCurrency, quote, base, rates) : null;
    } else if (['price', 'costPrice', 'returnRate'].includes(field)) {
      const performance = row.group?.performance || holdingPerformance(row.p, row.a);
      value = field === 'returnRate' ? performance.returnRate : convertHoldingValue(performance[field], performance.priceCurrency, row.a, base, rates);
    } else {
      const amounts = holdingAmounts(row.p, row.a);
      // The market-value column displays a labelled known subtotal when some
      // components are missing; sort by that visible amount, not an empty total.
      const visible = field === 'marketValue' && row.group ? row.group.marketValue.known : amounts[field];
      value = convertHoldingValue(visible, amounts[field + 'Currency'], row.a, base, rates);
    }
    return { row, index, value: Number.isFinite(value) ? value : null };
  }).sort((left, right) => {
    // Unknown values stay last in BOTH directions, including missing FX.
    if (left.value === null) return right.value === null ? left.index - right.index : 1;
    if (right.value === null) return -1;
    if (left.value === right.value) return left.index - right.index;
    const comparison = left.value < right.value ? -1 : 1;
    return direction === 'asc' ? comparison : -comparison;
  }).map(item => item.row);
}
