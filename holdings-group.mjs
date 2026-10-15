import { holdingAmounts, convertHoldingValue } from './holdings-sort.mjs';
import { groupHoldingPerformance, holdingPerformance } from './holdings-performance.mjs';

const BROKERS = new Set(['cicc', 'futu', 'longbridge', 'robinhood']);
const ALIASES = {
  MSFT: ['微软', 'Microsoft', 'Microsoft Corporation', 'Microsoft Corp', 'Microsoft Corp.'],
  NVDA: ['英伟达', 'NVIDIA', 'NVIDIA Corporation', 'NVIDIA Corp', 'NVIDIA Corp.'],
};
const normalized = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
const US_CODE = /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/;

function listedCode(row) {
  const { a, p } = row;
  if (typeof p.symbol !== 'string' || !p.symbol.trim()) return null;
  const raw = p.symbol.trim().toUpperCase();
  let market, code;
  const prefix = /^(US|HK|SH|SZ)\.(.+)$/.exec(raw);
  const suffix = /^(.+)\.(US|HK|SH|SZ)$/.exec(raw);
  if (prefix) [, market, code] = prefix;
  else if (suffix) [, code, market] = suffix;
  else if ((a.id === 'robinhood' && ['stock', 'etf'].includes(p.kind)) || (BROKERS.has(a.id) && Object.hasOwn(ALIASES, raw))) {
    market = 'US'; code = raw;
  } else return null;
  if (market === 'US' && !US_CODE.test(code)) return null;
  if (market === 'HK') {
    if (!/^\d{1,5}$/.test(code) || Number(code) === 0) return null;
    code = code.padStart(5, '0');
  }
  if (['SH', 'SZ'].includes(market) && !/^\d{6}$/.test(code)) return null;
  return { market, code };
}

function identity(row) {
  const { a, p } = row;
  const crypto = cryptoIdentity(row);
  if (crypto) return crypto;
  if (!BROKERS.has(a.id)) return null;
  const listed = listedCode(row);
  if (!listed) return null;
  let kind = p.kind;
  if (kind == null || kind === '') {
    // Futu does not supply kind. Its US option codes contain digits and cannot
    // pass US_CODE; untyped HK codes could instead be warrants, so stay separate.
    if (a.id === 'futu' && listed.market === 'US') kind = 'stock';
    else return null;
  }
  if (!['stock', 'etf'].includes(kind)) return null;
  const explicitSide = typeof p.side === 'string' ? p.side.trim().toUpperCase() : '';
  if (!['', 'UNKNOWN', 'LONG', 'SHORT'].includes(explicitSide)) return null;
  const quantityKnown = Number.isFinite(p.quantity);
  if (explicitSide === 'LONG' && quantityKnown && p.quantity < 0) return null;
  let side;
  if (explicitSide === 'SHORT') {
    // Some sources sign short quantities, others use a positive number plus
    // side. Keep those conventions separate rather than cancelling shares.
    side = quantityKnown && p.quantity < 0 ? 'short-signed' : 'short';
  } else if (quantityKnown) side = p.quantity < 0 ? 'short-signed' : 'long';
  else if (explicitSide === 'LONG' || (a.id === 'robinhood' && !explicitSide)) side = 'long';
  else side = 'unknown';
  return { ...listed, kind, side, key: `${listed.market}:${listed.code}:${kind}:${side}` };
}

function cryptoIdentity({ a, p }) {
  const allowed = a.id === 'binance' ? ['spot', 'earn-flexible', 'earn-locked', 'futures-collateral']
    : a.id === 'robinhood' ? ['crypto', 'spot'] : a.id === 'hyperliquid' ? ['spot'] : [];
  if (!allowed.includes(p.kind) || (p.side && !['LONG', 'UNKNOWN'].includes(p.side.toUpperCase())) || p.quantity < 0) return null;
  const code = typeof p.symbol === 'string' ? p.symbol.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{1,30}$/.test(code)) return null;
  // Centralized exchange tickers identify their ledger assets. Hyperliquid
  // permits duplicate tickers, so use token identity except for native USDC.
  let asset = code;
  if (a.id === 'hyperliquid' && !(code === 'USDC' && p.tokenIndex === 0)) {
    if (!p.tokenId && !Number.isSafeInteger(p.tokenIndex)) return null;
    asset = `hyperliquid:${p.tokenId || p.tokenIndex}`;
  }
  return { market: 'CRYPTO', code, kind: 'crypto', side: 'long', key: `CRYPTO:${asset}` };
}

function aggregate(values) {
  const valid = values.filter(Number.isFinite);
  const sum = valid.reduce((total, value) => total + value, 0);
  const known = valid.length && Number.isFinite(sum) ? sum : null;
  return { known, total: values.length, count: valid.length, complete: valid.length === values.length && known !== null };
}

// A listing has one reference quote, independent of how many accounts hold it.
// Keep this separate from the quantity-weighted prices used for cost/return math.
function referencePrice(members) {
  const labels = { futu: '富途', longbridge: '长桥', cicc: '中金财富', robinhood: 'Robinhood UK' };
  const priority = { futu: 0, longbridge: 1, cicc: 2, robinhood: 3 };
  const candidates = members.flatMap(({ a, p }, index) => {
    const { price, priceCurrency } = holdingPerformance(p, a);
    if (!Number.isFinite(price) || !priceCurrency) return [];
    const stamp = p.priceAsOf ?? a.positionsAsOf ?? a.asOf;
    const time = typeof stamp === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) ? Date.parse(stamp) : NaN;
    if (stamp != null && (!Number.isFinite(time) || time > Date.now())) return [];
    return [{ price, priceCurrency, originalCurrency: a.originalCurrency, conversionRate: a.conversionRate, asOf: Number.isFinite(time) ? stamp : null,
      source: p.priceSource || p.valuationSource || `${labels[a.id] || a.name || a.id}持仓参考价`,
      time: Number.isFinite(time) ? time : -Infinity, priority: priority[a.id] ?? 4, index }];
  });
  candidates.sort((a, b) => (a.time === b.time ? 0 : a.time > b.time ? -1 : 1) || a.priority - b.priority || a.index - b.index);
  const selected = candidates[0];
  return selected ? { price: selected.price, priceCurrency: selected.priceCurrency, ...(selected.originalCurrency ? { originalCurrency: selected.originalCurrency, conversionRate: selected.conversionRate } : {}), asOf: selected.asOf, source: selected.source } : null;
}

/** Consolidate confirmed identical listings only; input rows remain untouched.
 * Missing components never become zero. A singleton remains the original row.
 * Group members retain their original account/channel and original currencies.
 */
export function groupHoldings(rows, base, rates = {}) {
  const groups = new Map();
  const ordered = [];
  for (const row of rows) {
    const id = identity(row);
    if (!id) { ordered.push({ members: [row] }); continue; }
    let group = groups.get(id.key);
    if (!group) {
      group = { id, members: [] };
      groups.set(id.key, group);
      ordered.push(group);
    }
    group.members.push(row);
  }
  return ordered.map(({ id, members }) => {
    if (members.length === 1) return members[0];
    const quantity = aggregate(members.map(({ p }) => p.quantity));
    const components = members.map(({ a, p }) => {
      const amounts = holdingAmounts(p, a);
      return {
        marketValue: convertHoldingValue(amounts.marketValue, amounts.marketValueCurrency, a, base, rates),
        marketValueSource: amounts.marketValueSource,
        pnl: convertHoldingValue(amounts.pnl, amounts.pnlCurrency, a, base, rates),
        pnlSource: amounts.pnlSource,
      };
    });
    const marketValue = aggregate(components.map(item => item.marketValue));
    const valueSources = new Set(components.filter(item => Number.isFinite(item.marketValue)).map(item => item.marketValueSource));
    const marketValueSource = valueSources.size > 1 ? 'mixed' : valueSources.values().next().value || 'unknown';
    const pnl = aggregate(components.map(item => item.pnl));
    const sources = new Set(components.filter(item => Number.isFinite(item.pnl)).map(item => item.pnlSource));
    const pnlSource = sources.size > 1 ? 'mixed' : sources.values().next().value || 'unknown';
    const performance = groupHoldingPerformance(members, base, rates);
    const quote = referencePrice(members);
    const canonical = id.market === 'US' && id.kind === 'stock' ? ALIASES[id.code]?.[0] : undefined;
    return {
      a: { id: 'consolidated' },
      p: {
        name: canonical || members.find(({ p }) => p.name)?.p.name || id.code,
        symbol: id.code, kind: id.kind,
        side: id.side.startsWith('short') ? 'SHORT' : id.side === 'long' ? 'LONG' : 'UNKNOWN',
        quantity: quantity.complete ? quantity.known : null,
        price: quote ? convertHoldingValue(quote.price, quote.priceCurrency, quote, base, rates) : null,
        costPrice: performance.costPrice, priceCurrency: base,
        marketValue: marketValue.complete ? marketValue.known : null,
        marketValueCurrency: base,
        marketValueSource,
        pnl: pnl.complete ? pnl.known : null, pnlCurrency: base, pnlSource, currency: base,
      },
      group: { key: id.key, members, quantity, marketValue, pnl, performance, referencePrice: quote },
    };
  });
}

/** Uniform display only: never invent a code from a company's name. */
export function holdingDisplaySymbol(row) {
  const listed = listedCode(row);
  if (listed) return listed.code;
  return typeof row.p.symbol === 'string' && row.p.symbol.trim() ? row.p.symbol.trim().toUpperCase() : '代码待补';
}

function searchable(row) {
  const { a, p } = row;
  const terms = [p.name, p.symbol, p.accountChannel, a.id, a.name];
  const listed = listedCode(row);
  if (listed?.market === 'US' && Object.hasOwn(ALIASES, listed.code)) terms.push(listed.code, ...ALIASES[listed.code]);
  // Name aliases improve search only; names without a listing never authorize
  // consolidation (e.g. a similarly named depositary receipt or share class).
  if (!p.symbol && (!p.kind || p.kind === 'stock')) {
    for (const [code, aliases] of Object.entries(ALIASES)) {
      if (aliases.some(alias => normalized(alias) === normalized(p.name))) terms.push(code, ...aliases);
    }
  }
  return terms.map(normalized).join('\n');
}

/** Search the canonical display and every component after grouping. */
export function matchesHolding(row, query) {
  const term = normalized(query);
  if (!term) return true;
  return [row, ...(row.group?.members || [])].some(member => searchable(member).includes(term));
}
