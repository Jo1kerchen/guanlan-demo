/** Values are account equity, not gross asset value. Positive netFlow is a deposit. */
const CURRENCIES = new Set(['CNY', 'USD', 'HKD', 'GBP']);
const ACCOUNT_IDS = new Set(['cicc', 'futu', 'longbridge', 'binance', 'hyperliquid', 'robinhood']);
const CSV_HEADER = ['account', 'currency', 'equity', 'opening_equity', 'net_flow', 'as_of'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const safe = value => Number.isFinite(value) ? value : null;

/**
 * fx maps one unit of each currency to CNY; positive finite rates are required.
 * Missing amounts remain unknown. Partial totals are accompanied by coverage flags.
 * dayRate/pnlRate are simple opening-equity returns, not time-weighted returns.
 */
export function summarize(accounts, fx, base = 'CNY') {
  if (!Array.isArray(accounts)) throw new TypeError('accounts 必须是数组');
  if (!CURRENCIES.has(base)) throw new RangeError('不支持的展示币种');
  const validFx = currency => finite(fx?.[currency]) && fx[currency] > 0;
  const missingFx = new Set();
  const items = accounts.map(account => {
    const missing = [];
    let rate = 1;
    if (!CURRENCIES.has(account.currency)) {
      missing.push(account.currency);
      rate = null;
    } else if (account.currency !== base) {
      for (const currency of [account.currency, base]) {
        if (!validFx(currency)) missing.push(currency);
      }
      rate = missing.length ? null : safe(fx[account.currency] / fx[base]);
      if (rate === 0) rate = null;
    }
    missing.forEach(currency => missingFx.add(currency));
    const estimated = account.id === 'cicc' && account.valuationStatus === 'estimated';
    const openingEquity = estimated ? account.estimatedOpeningEquity : account.openingEquity;
    const nativePnl = estimated ? (finite(account.estimatedDayPnl) ? account.estimatedDayPnl : null)
      : finite(account.equity) && finite(account.openingEquity) && finite(account.netFlow)
      ? safe(account.equity - account.openingEquity - account.netFlow) : null;
    const value = finite(account.equity) && rate !== null ? safe(account.equity * rate) : null;
    const dayPnl = nativePnl !== null && rate !== null ? safe(nativePnl * rate) : null;
    const dayRate = nativePnl !== null && finite(openingEquity) && openingEquity > 0
      ? safe(nativePnl / openingEquity) : null;
    return { ...account, value, dayPnl, dayRate, dayPnlEstimated: estimated, dayOpeningEquity: openingEquity, missingFx: missing };
  });
  const valued = items.filter(item => item.value !== null);
  const pnlItems = items.filter(item => item.dayPnl !== null);
  const total = valued.length ? safe(valued.reduce((sum, item) => sum + item.value, 0)) : null;
  const pnl = pnlItems.length ? safe(pnlItems.reduce((sum, item) => sum + item.dayPnl, 0)) : null;
  const complete = accounts.length > 0 && valued.length === accounts.length && total !== null;
  const pnlComplete = accounts.length > 0 && pnlItems.length === accounts.length && pnl !== null;
  // Use the same conversion rate for current and opening equity.
  const openingTotal = pnlComplete && items.every(item => finite(item.dayOpeningEquity)) ? safe(items.reduce((sum, item) => {
    const rate = item.currency === base ? 1 : fx[item.currency] / fx[base];
    return sum + item.dayOpeningEquity * rate;
  }, 0)) : null;
  const pnlRate = pnlComplete && openingTotal > 0 ? safe(pnl / openingTotal) : null;
  return {
    total, pnl, pnlRate,
    valuedCount: valued.length,
    pnlCount: pnlItems.length,
    totalCount: accounts.length,
    missingFx: [...missingFx], complete, pnlComplete, items,
  };
}

/** A strict CSV reader supporting quoted fields, escaped quotes, and CRLF. */
function readCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const pushField = () => { row.push(field); field = ''; closed = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
      continue;
    }
    if (char === ',') { pushField(); continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      pushRow();
      continue;
    }
    if (closed) {
      if (char !== ' ' && char !== '\t') throw new Error('CSV 引号结束后存在无效字符');
    } else if (char === '"') {
      if (field.length) throw new Error('CSV 引号只能出现在字段开头');
      quoted = true;
    } else field += char;
  }
  if (quoted) throw new Error('CSV 存在未闭合引号');
  if (row.length || field.length || closed) pushRow();
  return rows;
}

function isTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function readAmount(value, column, line, required = false) {
  if (value === '') {
    if (required) throw new Error(`CSV 第 ${line} 行 ${column} 不能为空`);
    return null;
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
    throw new Error(`CSV 第 ${line} 行 ${column} 必须是有限数字`);
  }
  return Number(value);
}

/**
 * Required header: account,currency,equity,opening_equity,net_flow,as_of.
 * Returns [{ id, currency, equity, openingEquity, netFlow, asOf }].
 * Timestamps must include a timezone and are preserved exactly after trimming.
 */
export function parseSnapshotCsv(text) {
  if (typeof text !== 'string') throw new TypeError('CSV 内容必须是文本');
  const rows = readCsv(text.replace(/^\uFEFF/, ''));
  const header = rows.shift()?.map(value => value.trim());
  if (!header || header.length !== CSV_HEADER.length || header.some((value, index) => value !== CSV_HEADER[index])) {
    throw new Error(`CSV 表头必须为 ${CSV_HEADER.join(',')}`);
  }
  const seen = new Set();
  const accounts = [];
  rows.forEach((raw, index) => {
    const line = index + 2;
    if (raw.length === 1 && raw[0].trim() === '') return;
    if (raw.length !== CSV_HEADER.length) throw new Error(`CSV 第 ${line} 行必须有 6 列`);
    const [id, currency, equity, openingEquity, netFlow, asOf] = raw.map(value => value.trim());
    if (!ACCOUNT_IDS.has(id)) throw new Error(`CSV 第 ${line} 行账户代码无效`);
    if (seen.has(id)) throw new Error(`CSV 第 ${line} 行账户 ${id} 重复`);
    if (!CURRENCIES.has(currency)) throw new Error(`CSV 第 ${line} 行币种必须是 CNY、USD、HKD 或 GBP`);
    if (!isTimestamp(asOf)) throw new Error(`CSV 第 ${line} 行 as_of 必须是含时区的有效 ISO 时间`);
    accounts.push({
      id, currency,
      equity: readAmount(equity, 'equity', line, true),
      openingEquity: readAmount(openingEquity, 'opening_equity', line),
      netFlow: readAmount(netFlow, 'net_flow', line),
      asOf,
    });
    seen.add(id);
  });
  if (!accounts.length) throw new Error('CSV 至少需要一行账户快照');
  return accounts;
}
