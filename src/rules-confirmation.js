export function validEntryConfirmation(i){
 const p=i.entry_confirmation,n=i.current_time_ms;
 return !!p&&p.mint===i.token&&p.pool===i.pool&&typeof i.pool==='string'&&Number.isFinite(n)&&
  ['firstAt','secondAt','firstPrice','secondPrice','firstBuys','secondBuys','firstSells','secondSells'].every(k=>Number.isFinite(p[k]))&&
  p.firstAt>=0&&p.secondAt-p.firstAt>=5000&&p.secondAt-p.firstAt<=60000&&n>=p.secondAt&&n-p.secondAt<=30000&&
  p.firstPrice>0&&p.secondPrice>=p.firstPrice*1.0025&&p.secondPrice<=p.firstPrice*1.15&&
  p.secondBuys===i.buys_5m&&p.secondSells===i.sells_5m&&p.firstBuys>=0&&p.firstSells>=0&&p.secondBuys-p.firstBuys>=2&&p.secondSells>=p.firstSells&&p.secondSells-p.firstSells<=p.secondBuys-p.firstBuys;
}
export function confirmEntry(history,c,inputs,now){
 const m=c.rawMarket,at=Math.min(m.priceAt??m.updatedAt,m.activityCheckedAt??m.marketObservedAt??m.updatedAt),price=m.spotPriceSol??m.priceUsd/c.solUsd;
 const row={at,price,buys:m.buys5m,sells:m.sells5m};const key=c.mint+':'+c.pool,old=history.get(key);
 if(![at,price,row.buys,row.sells].every(Number.isFinite)||at>now||now-at>30000||price<=0)return null;
 if(!old||at-old.at>60000||price<old.price||row.buys<old.buys||row.sells<old.sells){history.set(key,row);while(history.size>128)history.delete(history.keys().next().value);return null;}
 const proof={mint:c.mint,pool:c.pool,firstAt:old.at,secondAt:at,firstPrice:old.price,secondPrice:price,firstBuys:old.buys,secondBuys:row.buys,firstSells:old.sells,secondSells:row.sells};
 return validEntryConfirmation({token:c.mint,pool:c.pool,current_time_ms:now,buys_5m:row.buys,sells_5m:row.sells,entry_confirmation:proof})?proof:null;
}
