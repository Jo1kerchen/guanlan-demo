import {summarize} from './finance.mjs';
import {createHoldingsUI} from './holdings.js';
import {renderAssetChart} from './asset-chart.js';
import {FX,META,ACCOUNTS,AS_OF,adjustedPnl} from './demo-data.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let base='USD',hidden=false,range='1M';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tone=n=>Number.isFinite(n)?n<0?'loss':'gain':'';
function money(n,{currency=base,signed=false,digits=2}={}){
 if(hidden)return '••••••'; if(!Number.isFinite(n))return '—';
 const symbol={USD:'$',CNY:'¥',HKD:'HK$',GBP:'£','':''}[currency]??currency;
 return `${n<0?'−':signed&&n>0?'+':''}${symbol}${Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits})}`;
}
const timestamp=v=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));
const names={overview:'资产总览',holdings:'持仓明细',accounts:'账户覆盖',method:'盈亏口径',about:'项目说明'};
const subtitles={overview:'看见每一份变化。',holdings:'看清账户里持有什么。',accounts:'所有账户，一处掌握。',method:'净值变动，不等于投资收益。',about:'从业务问题，到产品验证。'};
function navigate(v,updateHash=true){
 if(!names[v])v='overview';
 for(const key of Object.keys(names))$(`#${key}View`).hidden=key!==v;
 $$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===v);if(b.dataset.view===v)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 $('#viewCrumb').textContent=names[v];$('#pageTitle').innerHTML=names[v]+`<span>${subtitles[v]}</span>`;
 if(updateHash)history.replaceState(null,'','#'+v);
 window.scrollTo({top:0,behavior:'instant'});
}
const holdings=createHoldingsUI({meta:META,esc,money,timestamp,getAccounts:()=>ACCOUNTS,getFx:()=>FX,getBase:()=>base,isHidden:()=>hidden,onTrade:()=>{},onAccount:()=>{}});
function renderAllocation(s){
 let offset=0;
 const segments=s.items.map(a=>{const p=a.value/s.total,m=META.find(m=>m.id===a.id);const c=`<circle cx="90" cy="90" r="67" fill="none" stroke="${m.color}" stroke-width="17" stroke-dasharray="${p*420.974} ${420.974-p*420.974}" stroke-dashoffset="${-offset*420.974}"/>`;offset+=p;return c;}).join('');
 $('#allocation').innerHTML=`<div class="donut-wrap"><svg viewBox="0 0 180 180" role="img" aria-label="六个示例账户的资产占比">${segments}</svg><div class="donut-center">统一视角<strong>6</strong>示例账户</div></div><div class="legend">${s.items.map(a=>{const m=META.find(m=>m.id===a.id);return `<div class="legend-row"><i style="--c:${m.color}"></i><span>${m.name.replace('牛牛','').replace('证券','')}</span><span>${hidden?'•••':(a.value/s.total*100).toFixed(1)+'%'}</span></div>`;}).join('')}</div>`;
}
function renderChart(s){
 const count=range==='1W'?7:range==='1M'?30:60;
 const points=Array.from({length:count},(_,i)=>{const back=count-1-i;return {time:Date.parse(AS_OF)-back*86400000,value:s.total*(1-back*.0012+Math.sin(back*1.3)*.0035),count:6,accountIds:META.map(m=>m.id)};});
 renderAssetChart({wrap:$('#chartWrap'),points,hidden,money,timestamp,esc,range,demo:true});
 $('#chartNote').textContent=`${count} 个虚拟日度样本 · 非实际收益记录`;
}
function renderCalculator(){
 const read=id=>{const value=$(id).value;return value.trim()===''?NaN:Number(value);};
 const opening=read('#openingInput'),closing=read('#closingInput'),flow=read('#flowInput');
 const valid=[opening,closing,flow].every(Number.isFinite)&&opening>=0&&closing>=0;
 const result=adjustedPnl(opening,closing,flow,$('#missingInput').checked);
 $('#navChange').textContent=money(valid?closing-opening:null,{currency:'USD',signed:true});
 $('#adjustedPnl').textContent=money(result,{currency:'USD',signed:true});$('#adjustedPnl').className=tone(result);
 $('#calcExplanation').textContent=!valid?'请填写有效数字；期初和期末净值不能为负数。':$('#missingInput').checked?'资金流水不完整：保留净值变动，参考盈亏显示未知，不将缺失资金流当作零。':`净值变动中包含本金转入或转出，扣除已记录净转入后得到参考盈亏。此简化示例采用相同账户范围，不计算年化或时间加权收益率。`;
}
function render(){
 const s=summarize(ACCOUNTS,FX,base);
 $('#totalValue').textContent=money(s.total);$('#totalCaption').textContent=`统一折算为 ${base} · 固定示例汇率`;
 $('#dayPnl').textContent=money(s.pnl,{signed:true});$('#dayPnl').className='metric-number '+tone(s.pnl);
 $('#pnlCaption').textContent=hidden?'已隐藏金额':`${s.pnlRate>=0?'+':''}${(s.pnlRate*100).toFixed(2)}% · 按期初净值计算`;
 $('#tableCurrency').textContent=base;$('#fxNote').textContent='虚拟汇率：1 USD = 7.10 CNY';
 $('#accountRows').innerHTML=s.items.map(a=>{const m=META.find(m=>m.id===a.id);return `<tr><td><div class="account-cell"><span class="platform-icon" style="--c:${m.color}">${m.icon}</span><div class="account-name">${m.name}<small>${m.sub}</small></div></div></td><td class="money">${money(a.value)}<small>${money(a.equity,{currency:a.currency})} ${a.currency}</small></td><td class="money ${tone(a.dayPnl)}">${money(a.dayPnl,{signed:true})}<small>${hidden?'•••':(a.dayRate*100).toFixed(2)+'%'}</small></td><td><div class="percentage"><span>${hidden?'•••':(a.value/s.total*100).toFixed(1)+'%'}</span><div class="mini-bar"><i style="--c:${m.color};width:${a.value/s.total*100}%"></i></div></div></td><td><span class="state-badge">虚拟样本</span></td></tr>`;}).join('');
 renderAllocation(s);renderChart(s);holdings.render();renderCalculator();
 $('#privacyBtn').setAttribute('aria-label',hidden?'显示金额':'隐藏金额');$('#privacyBtn').title=hidden?'显示金额':'隐藏金额';
}
$('#accountCards').innerHTML=META.map(m=>`<article class="panel connect-card"><div class="connect-title"><span class="platform-icon" style="--c:${m.color}">${m.icon}</span><div><h3>${m.name}</h3><small>${m.method}</small></div></div><p>${m.desc}</p><div class="demo-source">当前演示：独立虚拟样本 · 未连接真实账户</div></article>`).join('');
$$('[data-view]').forEach(b=>b.onclick=()=>navigate(b.dataset.view));
$$('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));
$('#baseCurrency').onchange=e=>{base=e.target.value;render();};
$('#privacyBtn').onclick=()=>{hidden=!hidden;render();};
$$('[data-range]').forEach(b=>b.onclick=()=>{range=b.dataset.range;$$('[data-range]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});renderChart(summarize(ACCOUNTS,FX,base));});
['#openingInput','#closingInput','#flowInput','#missingInput'].forEach(id=>$(id).addEventListener('input',renderCalculator));
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1),false));
render();navigate(location.hash.slice(1)||'overview',false);
