// Completely synthetic values. No real user assets, prices or account IDs.
export const FX={CNY:1,USD:7.1,HKD:.91,GBP:9.5};
export const AS_OF='2026-10-15T16:00:00+08:00';
export const META=[
 {id:'cicc',name:'中金财富',sub:'A 股 · 手工快照',color:'#b5a176',icon:'中',method:'手工快照与交易记录',desc:'原项目通过资产快照与已完成的交易记录更新持仓数量，核对估值与时点；不自动提交交易。'},
 {id:'futu',name:'富途牛牛',sub:'证券 · 多市场',color:'#e69c60',icon:'牛',method:'授权后的只读查询',desc:'原项目按账户授权读取资产与持仓，分别核验资产范围、行情权限与返回时点。'},
 {id:'longbridge',name:'长桥证券',sub:'证券 · 多市场',color:'#8499c7',icon:'L',method:'授权后的只读查询',desc:'原项目通过账户授权读取净值及证券持仓；账户净值与持仓市值分别展示。'},
 {id:'binance',name:'币安',sub:'加密资产 · 分范围展示',color:'#d9b54b',icon:'◈',method:'按授权范围读取',desc:'原项目按接入范围区分现货、合约及部分理财资产；查询失败时保留上次成功值，并说明状态。'},
 {id:'hyperliquid',name:'Hyperliquid',sub:'链上资产 · 部分范围',color:'#69a895',icon:'≈',method:'公开地址只读查询',desc:'原项目按公开地址读取受支持的主账户资产；合约名义价值与权益分开，不代表覆盖所有链上产品。'},
 {id:'robinhood',name:'Robinhood UK',sub:'英国账户 · 手动录入',color:'#79a45a',icon:'R',method:'手工净值与持仓',desc:'原项目手工录入USD或GBP净值及逐项持仓，保留快照时间；未将其描述为自动API接入。'}
];
function stock(symbol,name,quantity,price,costPrice,currency='USD',kind='stock'){
 return {symbol,name,quantity,price,costPrice,currency,priceCurrency:currency,marketValue:price===null?null:quantity*price,kind,priceSource:'虚拟样本',priceAsOf:AS_OF};
}
export const ACCOUNTS=[
 {id:'cicc',currency:'CNY',equity:343000,openingEquity:330000,netFlow:10000,positions:[stock('SH.600519','贵州茅台',100,1500,1430,'CNY'),stock('SZ.000858','五粮液',500,140,145,'CNY')]},
 {id:'futu',currency:'USD',equity:48000,openingEquity:47400,netFlow:0,positions:[stock('US.NVDA','英伟达',120,130,116),stock('US.MSFT','微软',40,420,400),stock('US.VOO','标普500 ETF',20,500,480,'USD','etf')]},
 {id:'longbridge',currency:'HKD',equity:180000,openingEquity:179000,netFlow:0,positions:[stock('NVDA.US','英伟达',60,130,125),stock('HK.00700','腾讯控股',100,400,380,'HKD'),stock('HK.09988','阿里巴巴',200,90,95,'HKD')]},
 {id:'binance',currency:'USD',equity:22000,openingEquity:21600,netFlow:0,positions:[stock('BTC','比特币',.15,80000,75000,'USD','spot'),stock('ETH','以太坊',2,3000,3200,'USD','spot')]},
 {id:'hyperliquid',currency:'USD',equity:10500,openingEquity:10300,netFlow:0,positions:[{symbol:'ETH-PERP',name:'以太坊永续（虚拟）',quantity:2,kind:'derivative',currency:'USD',side:'long',price:3000,priceCurrency:'USD',notional:6000,notionalCurrency:'USD',unrealizedPnl:200,pnlCurrency:'USD',priceSource:'虚拟样本',priceAsOf:AS_OF}]},
 {id:'robinhood',currency:'GBP',equity:12500,openingEquity:12400,netFlow:0,positions:[stock('NVDA','英伟达',25,130,120),stock('MSFT','微软',10,420,410),stock('BTC','比特币',.02,80000,76000,'USD','crypto'),stock('ALPHA','示例基金（价格待补）',20,null,50,'USD','fund')]}
].map(a=>({...a,source:'demo',positionsStatus:'ready',asOf:AS_OF,positionsAsOf:AS_OF}));
export function adjustedPnl(opening,closing,flow,missing=false){
 if(missing||![opening,closing,flow].every(Number.isFinite)||opening<0||closing<0)return null;
 return closing-opening-flow;
}
