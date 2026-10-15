/** Display partial coverage immediately, even for a single observation. */
export function renderAssetChart({ wrap, points, hidden, money, timestamp, esc, range, demo = false, accountName = id => id }) {
  wrap.onpointermove = null; wrap.onpointerleave = null;
  if (!points.length) {
    wrap.innerHTML = '<div class="empty"><strong>从第一笔资产开始记录</strong><span>录入或接入任意一个账户即可显示走势，无需全部接入。<br>跨币账户需要可用汇率。</span></div>';
    return;
  }
  const W = 680, H = 236, left = 14, right = 61, top = 20, bottom = 28;
  const values = points.map(p => p.value), min = Math.min(...values), max = Math.max(...values);
  const pad = Math.max((max - min) * .2, Math.abs(max) * .002, 1), lo = min - pad, hi = max + pad;
  const start = points[0].time, span = points.at(-1).time - start;
  const x = i => span ? left + (points[i].time - start) / span * (W - left - right) : (left + W - right) / 2;
  const y = v => top + (hi - v) / (hi - lo) * (H - top - bottom);
  const path = points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  // Join every observed point. A different stroke makes coverage changes explicit,
  // rather than dropping the interval or inventing intermediate observations.
  const paths = points.length > 1 ? `<path d="${path} L ${x(points.length-1)},${H-bottom} L ${x(0)},${H-bottom} Z" fill="url(#chartFade)"/><path class="chart-line" d="${path}"/>` : '';
  const transitions=points.map((p,i)=>i&&p.scopeChanged?`<path class="chart-transition" d="M${x(i-1)},${y(points[i-1].value)} L${x(i)},${y(p.value)}"/>`:'').join('');
  const grids = Array.from({ length: 4 }, (_, i) => {
    const yy = top + i * (H - top - bottom) / 3, v = hi - i * (hi - lo) / 3;
    return `<line class="chart-grid" x1="${left}" x2="${W - right}" y1="${yy}" y2="${yy}"/><text class="chart-text" x="${W - right + 12}" y="${yy + 3}">${hidden ? '•••' : Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(1)}</text>`;
  }).join('');
  // Evenly spaced time ticks avoid overlapping labels when observations cluster
  // around the latest sync, while the actual observations retain their time axis.
  const tickCount = span ? Math.min(5, points.length) : 1, seenLabels = new Set();
  const labels = Array.from({ length: tickCount }, (_, n) => {
    const ratio = tickCount === 1 ? .5 : n / (tickCount - 1);
    const date = new Date(start + span * ratio), label = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', ...(range === '1D' ? { hour: '2-digit', minute: '2-digit', hour12: false } : { month: '2-digit', day: '2-digit' }) }).format(date);
    if (seenLabels.has(label)) return '';
    seenLabels.add(label);
    return `<text class="chart-text" x="${left + ratio * (W - left - right)}" y="${H - 7}" text-anchor="${tickCount === 1 ? 'middle' : n === 0 ? 'start' : n === tickCount - 1 ? 'end' : 'middle'}">${label}</text>`;
  }).join('');
  const markers = points.map((p, i) => p.scopeChanged || p.flows?.length ? `<line x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${H - bottom}" stroke="#b5a176" stroke-dasharray="3 4"><title>${p.scopeChanged?`账户范围变化 · ${p.count} 个账户`:`资金变动 · ${p.flows.map(f=>esc(f.label)).join("、")}`}</title></line>` : '').join('');
  const dots = [...new Set([0,points.length-1,...points.flatMap((p,i)=>p.scopeChanged||p.flows?.length?[i]:[])])].map(i => `<circle cx="${x(i)}" cy="${y(points[i].value)}" r="3.7" fill="#769969" stroke="white" stroke-width="2"/>`).join('');
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${demo ? '示例资产走势' : points.length === 1 ? '首笔资产快照' : '已知资产快照走势'}"><defs><linearGradient id="chartFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#aac09b" stop-opacity=".27"/><stop offset="100%" stop-color="#aac09b" stop-opacity=".02"/></linearGradient></defs>${grids}${paths}${transitions}${markers}${dots}${labels}</svg><div class="chart-tooltip" hidden></div>`;
  const tooltip = wrap.querySelector('.chart-tooltip');
  wrap.onpointermove = e => {
    if (hidden) return;
    const rect = wrap.getBoundingClientRect(), px = (e.clientX - rect.left) / rect.width * W;
    let nearest = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(nearest) - px)) nearest = i; });
    const p = points[nearest];
    tooltip.hidden = false;
    tooltip.innerHTML = `${esc(timestamp(p.time))}<b>${money(p.value)}</b>${demo ? '' : `<small>${p.count} 个账户${p.partial ? ' · 含部分范围' : ''}<br>${p.accountIds.map(id => esc(accountName(id))).join('、')}${p.scopeChanged ? '<br>账户范围变化 · 非投资收益' : ''}${p.flows?.length?'<br>已记录资金变动：'+p.flows.map(f=>esc(f.label)).join('、'):''}</small>`}`;
    tooltip.style.left = Math.min(Math.max(0, e.clientX - rect.left - 75), Math.max(0, rect.width - 180)) + 'px'; tooltip.style.top = '18px';
  };
  wrap.onpointerleave = () => { tooltip.hidden = true; };
}
