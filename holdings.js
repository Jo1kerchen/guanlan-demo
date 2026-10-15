import { holdingAmounts, convertHoldingValue, sortHoldings } from './holdings-sort.mjs';
import { groupHoldings, holdingDisplaySymbol, matchesHolding } from './holdings-group.mjs';
import { holdingPerformance } from './holdings-performance.mjs';

const scopeNames = {spot:'现货',usdm:'U 本位合约',coinm:'币本位合约',earn:'简单赚币',perp:'永续合约',perps:'永续合约'};
const kindNames = {etf:'ETF',stock:'股票',fund:'基金',crypto:'加密资产',cash:'现金',spot:'现货',derivative:'合约仓位','futures-collateral':'合约保证金',earn:'理财'};
const pnlLabels = {reported:'账户报告',calculated:'按价格估算',mixed:'含价格估算'};
const tone = value => Number.isFinite(value) ? value < 0 ? 'loss' : value > 0 ? 'gain' : '' : '';

export function createHoldingsUI({meta,esc,money,timestamp,getAccounts,getFx,getBase,isHidden,onTrade,onAccount}) {
 let filter='all',query='',sortOrder='default',viewMode='merged';
 const expanded=new Set();
 const valueInBase=(value,currency,account)=>convertHoldingValue(value,currency,account,getBase(),getFx());
 const platform=a=>meta.find(m=>m.id===a.id)?.name||a.id;
 const quantity=value=>money(value,{currency:'',digits:Number.isInteger(value)?0:6});
 function rows(){return getAccounts().flatMap(a=>(a.positions||[]).filter(p=>p.quantity!==0).map(p=>({a,p})));}
 function displayRows(items){return viewMode==='merged'?groupHoldings(items,getBase(),getFx()):items;}
 function securityName(row,merged=false){
  const symbol=holdingDisplaySymbol(row),{p}=row;
  const secondary=p.name&&p.name!==symbol?p.name:'';
  return `<div class="asset-name asset-symbol">${esc(symbol)}${merged?' <span class="holding-merged-badge">合并</span>':''}</div>${secondary?`<small class="asset-secondary">${esc(secondary)}${p.nameTruncated?'（名称截断）':''}</small>`:''}`;
 }
 function returnCell(performance,grouped=false){
  const {returnRate,returnStatus}=performance;
  let label='—',note='';
  if(returnStatus==='zero-cost')label=isHidden()?'•••':'零成本';
  else if(Number.isFinite(returnRate))label=isHidden()?'•••':`${returnRate>0?'+':''}${(returnRate*100).toFixed(2)}%`;
  else if(grouped&&returnStatus==='unknown')note='<small>分账户查看</small>';
  return `<td class="money holding-return ${tone(returnRate)}">${label}${note}</td>`;
 }
 function rawRow(row,showTime=false){
  const {a,p}=row,derivative=p.kind==='derivative',amounts=holdingAmounts(p,a),performance=holdingPerformance(p,a);
  const value=derivative?p.notional:amounts.marketValue;
  const currency=derivative?(Object.hasOwn(p,'notionalCurrency')?p.notionalCurrency:p.currency):amounts.marketValueCurrency;
  const converted=valueInBase(value,currency,a),{price,costPrice,priceCurrency}=performance;
  const {pnl,pnlCurrency,pnlSource}=amounts,convertedPnl=valueInBase(pnl,pnlCurrency,a);
  const side=String(p.side||'').toLowerCase(),label=scopeNames[p.scope]||kindNames[p.kind]||(a.id==='cicc'?'证券':'持仓');
  const time=p.priceAsOf||a.positionsAsOf||a.asOf;
  const quoteNote=[p.priceSource||p.valuationSource,p.priceAsOf?timestamp(p.priceAsOf):''].filter(Boolean).map(esc).join(' · ');
  const quantityNote=p.quantityAdjusted?`<small class="small-warn">${p.valuationStatus==='estimated'?'数量已按交易记录更新 · 行情估算':'数量已按交易记录更新 · 估值待更新'}</small>`:'';
  const unavailable=p.valuationStatus==='unavailable'?'<small class="small-warn">行情未取得 · 未估值</small>':'';
  return `<tr><td>${securityName(row)}<small class="asset-meta">${esc([platform(a),label,['robinhood','binance'].includes(a.id)?p.accountChannel:'',p.accountSuffix?'尾号 '+p.accountSuffix:''].filter(Boolean).join(' · '))}</small>${showTime?`<small class="asset-meta">${a.source==='api'?'接口快照':'持仓快照'} · ${time?esc(timestamp(time)):'时点未提供'}</small>`:''}${quantityNote}${unavailable}</td>
   <td class="money">${quantity(p.quantity)}${['long','short'].includes(side)?`<small>${side==='short'?'空头':'多头'}</small>`:''}</td>
   <td class="money">${money(converted)}<small>${derivative?'名义价值 · 不计入净值':currency?money(value,{currency})+' '+esc(currency):'暂无估值'}</small>${amounts.marketValueSource==='calculated'?'<small class="small-warn">参考价估算 · 数量 × 价格</small>':''}</td>
   <td class="money">${money(price,{currency:priceCurrency||'',digits:3})}<small>${priceCurrency?esc(priceCurrency):'币种未提供'}</small>${quoteNote?`<small class="holding-quote-time">${quoteNote}</small>`:''}</td>
   <td class="money">${money(costPrice,{currency:priceCurrency||'',digits:3})}<small>${priceCurrency?esc(priceCurrency):'币种未提供'}</small></td>
   <td class="money ${tone(convertedPnl)}">${money(convertedPnl,{signed:true})}<small>${pnlCurrency?`${pnlLabels[pnlSource]||''} · ${money(pnl,{currency:pnlCurrency,signed:true})} ${esc(pnlCurrency)}`:'暂无可用盈亏'}</small></td>
   ${returnCell(performance)}
   <td></td></tr>`;
 }
 function coverage(amount,format){
  return amount.complete?'':`<small class="small-warn">${amount.count?`已知 ${format(amount.known)} · ${amount.count}/${amount.total} 笔`:'待补充'}</small>`;
 }
 function weightedCell(performance,field){
  const value=performance[field];
  return Number.isFinite(value)?`<td class="money">${money(value,{currency:performance.priceCurrency,digits:3})}<small>数量加权 · ${esc(performance.priceCurrency)}</small></td>`:'<td class="money">—<small class="holding-per-account">分账户查看</small></td>';
 }
 function referencePriceCell(quote){
  if(!quote)return '<td class="money">—<small>暂无参考行情</small></td>';
  return `<td class="money">${money(quote.price,{currency:quote.priceCurrency,digits:3})}<small>统一参考价 · ${esc(quote.priceCurrency)}</small><small class="holding-quote-time">${esc(quote.source)} · ${quote.asOf?esc(timestamp(quote.asOf)):'时间未提供'}</small></td>`;
 }
 function groupedRow(row,prefix,index){
  const {p,group}=row,key=group.key,open=expanded.has(key),detailId=`${prefix}-detail-${index}`;
  const platforms=[...new Set(group.members.map(({a})=>platform(a)))],symbol=holdingDisplaySymbol(row);
  return `<tr class="holding-aggregate"><td>${securityName(row,true)}<small class="asset-meta">${group.members.length} 笔持仓 · ${esc(platforms.join(' + '))}</small></td>
   <td class="money">${quantity(group.quantity.known)}${group.quantity.complete?'<small>持有数量合计</small>':`<small class="small-warn">${group.quantity.count?`已知小计 · ${group.quantity.count}/${group.quantity.total} 笔 · ${group.quantity.total-group.quantity.count} 笔数量待补`:'数量待补'}</small>`}</td>
   <td class="money">${money(group.marketValue.known)}${group.marketValue.complete?`<small>合计 · ${esc(getBase())}</small>`:`<small class="small-warn">${group.marketValue.count?`已知小计 · ${group.marketValue.count}/${group.marketValue.total} 笔 · ${group.marketValue.total-group.marketValue.count} 笔待估值`:'待补充估值'}</small>`}${['calculated','mixed'].includes(p.marketValueSource)?'<small class="small-warn">含参考价估算</small>':''}</td>
   ${referencePriceCell(group.referencePrice)}${weightedCell(group.performance,'costPrice')}
   <td class="money ${tone(p.pnl)}">${money(p.pnl,{signed:true})}${group.pnl.complete?`<small>持仓盈亏合计${p.pnlSource==='reported'?'':' · '+(pnlLabels[p.pnlSource]||'')}</small>`:coverage(group.pnl,value=>money(value,{signed:true}))}</td>
   ${returnCell(group.performance,true)}
   <td><button class="text-button holding-expand" data-holding-group="${esc(key)}" aria-expanded="${open}" aria-controls="${detailId}" aria-label="${esc(symbol)}：${open?'收起':'展开'} ${group.members.length} 笔持仓">${open?'收起':'展开'} ${group.members.length} 笔 <span aria-hidden="true">${open?'⌃':'⌄'}</span></button></td></tr>
   <tr id="${detailId}" class="holding-detail" ${open?'':'hidden'}><td colspan="8"><div class="holding-detail-label">${esc(symbol)} · 分账户明细 <span>按各账户快照汇总，时点可能不同</span></div>${table(group.members,false,detailId,true)}</td></tr>`;
 }
 function table(items,sortable=false,prefix='holdings',showTime=false){
  const header=(field,label)=>{
   if(!sortable)return `<th scope="col">${label}</th>`;
   const active=sortOrder.startsWith(field+'-'),ascending=active&&sortOrder.endsWith('-asc');
   const direction=active?(ascending?'ascending':'descending'):'none';
   const next=active&&!ascending?'从低到高':'从高到低';
   return `<th scope="col" aria-sort="${direction}"><button type="button" class="holding-sort-button" data-holding-sort="${field}" aria-label="${label}：点击${next}排序" aria-describedby="holdingSortNote">${label}<span aria-hidden="true">${active?(ascending?'↑':'↓'):'↕'}</span></button></th>`;
  };
  return `<div class="table-scroll"><table class="holdings-table"><thead><tr><th scope="col">资产代码 / 所属账户</th><th scope="col">持有数量</th>${header('marketValue','市值 · '+esc(getBase()))}${header('price','参考现价')}${header('costPrice','参考成本')}${header('pnl','持仓盈亏 · '+esc(getBase()))}${header('returnRate','收益率')}<th scope="col"><span class="holding-visually-hidden">操作</span></th></tr></thead><tbody>${items.map((row,index)=>row.group?groupedRow(row,prefix,index):rawRow(row,showTime)).join('')||'<tr><td colspan="8" class="empty-table">没有匹配的持仓。</td></tr>'}</tbody></table></div>`;
 }
 function wire(root){
  root.querySelectorAll('[data-holding-trade]').forEach(b=>b.onclick=()=>onTrade(b.dataset.holdingTrade));
  root.querySelectorAll('[data-holding-account]').forEach(b=>b.onclick=()=>onAccount(b.dataset.holdingAccount));
  function rerenderAndFocus(attribute,key){
   const scroll=root.querySelector('.table-scroll')?.scrollLeft||0;
   render();
   const scroller=root.querySelector('.table-scroll');if(scroller)scroller.scrollLeft=scroll;
   [...root.querySelectorAll(`[data-${attribute}]`)].find(button=>button.getAttribute(`data-${attribute}`)===key)?.focus({preventScroll:true});
  }
  root.querySelectorAll('[data-holding-group]').forEach(b=>b.onclick=()=>{
   const key=b.dataset.holdingGroup;expanded.has(key)?expanded.delete(key):expanded.add(key);
   rerenderAndFocus('holding-group',key);
  });
  root.querySelectorAll('[data-holding-sort]').forEach(b=>b.onclick=()=>{
   const field=b.dataset.holdingSort;
   sortOrder=`${field}-${sortOrder===field+'-desc'?'asc':'desc'}`;
   rerenderAndFocus('holding-sort',field);
  });
 }
 function render(){
  const all=rows(),merged=groupHoldings(all,getBase(),getFx());
  const selected=displayRows(all.filter(({a})=>filter==='all'||a.id===filter)).filter(row=>matchesHolding(row,query));
  document.querySelector('#holdingsCount').textContent=`${merged.length} 项资产 · ${all.length} 笔持仓`;
  const preview=document.querySelector('#holdingsPreview');preview.innerHTML=table(merged.slice(0,6),false,'preview');wire(preview);
  const tabs=document.querySelector('#holdingFilters');tabs.innerHTML=[{id:'all',name:'全部'},...meta].map(m=>`<button class="${filter===m.id?'active':''}" data-filter="${m.id}" aria-pressed="${filter===m.id}">${esc(m.name)} <span>${displayRows(all.filter(r=>m.id==='all'||r.a.id===m.id)).length}</span></button>`).join('');
  tabs.querySelectorAll('button').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();document.querySelector('#holdingFilters').querySelector(`[data-filter="${filter}"]`)?.focus({preventScroll:true});});
  const root=document.querySelector('#holdingsTable');root.innerHTML=table(sortHoldings(selected,sortOrder,getBase(),getFx()),true);wire(root);
  document.querySelector('#holdingSortNote').textContent=`${viewMode==='merged'?'相同证券及币种已合并，数量直接相加，缺项显示已知小计；现价独立显示该股票已取得的最新参考价及时间，无需展开账户。':'逐笔展示各账户持仓。'}点击表头可切换高低排序；金额按 ${getBase()} 换算比较，市值缺项时按已知小计排序，完全未知置后。示例价格及金额均为虚拟数据；账户净值与持仓市值分别展示，避免重复累加。收益率按现价与成本价计算；合并收益率按总成本计算，缺少资料时不平均。合约名义价值不参与市值排序。`;
  const accounts=getAccounts().filter(a=>filter==='all'||a.id===filter);
  document.querySelector('#holdingsStatus').innerHTML=accounts.map(a=>{
   const m=meta.find(m=>m.id===a.id),count=(a.positions||[]).filter(p=>p.quantity!==0).length;
   const ready=a.positionsStatus==='ready'||(a.id==='cicc'&&Array.isArray(a.positions));
   const message=a.positionsStatus==='error'?'明细读取失败':a.positionsStatus==='partial'?(a.id==='robinhood'?'手动持仓 · 未确认完整':'明细未完整读取'):ready?count?count+' 笔持仓':'无持仓':a.source==='demo'?'示例账户未提供持仓':a.source==='api'?'等待下一次同步持仓':a.id==='robinhood'?'待手动录入持仓':'待录入或连接';
   const sourceTime=a.id==='cicc'&&a.valuationStatus==='estimated'?`行情估算 ${a.valuationTradeDate||''}${a.valuationSource?' · '+a.valuationSource:''}`:a.id==='cicc'&&a.tradeDate?'估值 '+a.tradeDate:a.asOf?timestamp(a.asOf):'';
   return `<div class="holding-source"><i style="--c:${m?.color||'#82927d'}"></i><strong>${esc(m?.name||a.id)}</strong><span>${message}</span><small>${esc(sourceTime)}</small></div>`;
  }).join('');
 }
 document.querySelector('#holdingViewMode').onchange=e=>{viewMode=e.target.value;render();};
 document.querySelector('#holdingSearch').oninput=e=>{query=e.target.value;render();};
 return {render,select(id){filter=id;query='';document.querySelector('#holdingSearch').value='';render();}};
}
