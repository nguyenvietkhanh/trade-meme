import {createHash} from 'node:crypto';
const round=x=>Math.round(x*1e9)/1e9;
const fail=code=>Object.assign(Error(code),{code});
const pending=s=>Object.values(s.orders).some(o=>!o.terminal)||!!s.aiProfit?.pending;
// Parent treasury lock required. A failed/partial RPC response never means zero.
export async function reconcileExternalInventory(t,{force=false}={}){
 if(!t.s.positions.length||pending(t.s)||typeof t.execution.confirmedInventory!=='function')return;
 const now=t.clock();if(!force&&now<(t.inventoryNextAt??0))return;t.inventoryNextAt=now+5000;
 const mints=[...new Set(t.s.positions.map(p=>p.mint))];
 const snapshot=await t.execution.confirmedInventory(t.owner,mints,t.s.lastReceiptSlot||0);
 if(!snapshot||snapshot.complete!==true||!Number.isSafeInteger(snapshot.slot)||snapshot.slot<(t.s.lastReceiptSlot||0))throw fail('LIVE_INVENTORY_UNVERIFIED');
 t.inventoryProbes??=new Map();
 for(const mint of mints){
  const row=snapshot.balances?.[mint];if(!row||!/^\d+$/.test(row.rawAmount)||!Number.isSafeInteger(row.rentLamports)||row.rentLamports<0)throw fail('LIVE_INVENTORY_UNVERIFIED');
  const lots=t.s.positions.filter(p=>p.mint===mint),tracked=lots.reduce((n,p)=>n+BigInt(p.rawQuantity),0n),held=BigInt(row.rawAmount);
  if(held>=tracked){t.inventoryProbes.delete(mint);continue;}
  const missing=tracked-held,known=new Set([...t.s.trades.map(f=>f.signature),...Object.values(t.s.orders).map(o=>o.signature),...(t.s.aiProfit?.payouts??[]).map(p=>p.signature)].filter(Boolean));let receipt=null;
  // Full receipt attribution is only safe for one lot and one unambiguous sale.
  if(lots.length===1&&typeof t.execution.externalSaleReceipt==='function'){
   const p=lots[0],entry=t.s.trades.find(f=>f.side==='BUY'&&f.positionId===p.paperPositionId);
   try{receipt=await t.execution.externalSaleReceipt(t.owner,mint,{sinceSlot:entry?.slot??0,sinceAt:p.openedAt,knownSignatures:[...known],missingAmount:String(missing),maxSlot:snapshot.slot});}catch{receipt=null;}
   if(receipt&&(!Number.isSafeInteger(receipt.slot)||receipt.slot>snapshot.slot||known.has(receipt.signature)||receipt.tokenDelta!==String(-missing)||!(receipt.solDelta>0)||!Number.isFinite(receipt.feeSol)||receipt.feeSol<0||!Number.isSafeInteger(receipt.rentDeltaLamports)||receipt.rentDeltaLamports>0||-receipt.rentDeltaLamports>(t.s.rentByMint[mint]?.lamports??0)))receipt=null;
  }
  if(receipt){
   const nativeBalance=await t.execution.balance(t.owner,Math.max(t.s.lastReceiptSlot||0,receipt.slot));
   if(!Number.isFinite(nativeBalance)||nativeBalance<0||!Number.isSafeInteger(Math.round(nativeBalance*1e9)))throw fail('LIVE_INVENTORY_UNVERIFIED');
   const p=lots[0],id='live:'+p.agentId+':external:'+receipt.signature,original=t.s;
   t.s=structuredClone(original);
   try{
    const order={id,side:'SELL',agentId:p.agentId,mint,pairAddress:p.pairAddress,symbol:p.symbol,positionId:p.paperPositionId,amount:String(missing),decisionAt:now,signature:receipt.signature,reason:'manual-wallet-sale',decisionEngine:'external-wallet',terminal:false};
    t.s.orders[id]=order;t.applyReceipt(order,{...receipt,status:'confirmed'});
    // A prior wallet sync may already have seen the sale proceeds as a deposit.
    // Reclassify that difference with the receipt in the same durable update.
    const flow=round(nativeBalance-t.s.cashSol);t.s.cashSol=nativeBalance;
    if(flow){t.s.netDepositsSol=round(t.s.netDepositsSol+flow);t.s.capitalFlows.push({at:now,amountSol:flow,kind:'external-native-reclassification',signature:receipt.signature});}
    t.observedLamports=Math.round(nativeBalance*1e9);t.balanceAt=now;await t.save();
   }catch(error){t.s=original;throw error;}
  }else{
   const probe=t.inventoryProbes.get(mint);t.inventoryProbes.set(mint,{raw:row.rawAmount,slot:snapshot.slot,at:now});
   if(!probe||probe.raw!==row.rawAmount||snapshot.slot<probe.slot||now-probe.at<1000)continue;
   const original=t.s;t.s=structuredClone(original);
   try{
    let remove=missing,basis=0;const ids=[];
    for(const p of t.s.positions.filter(p=>p.mint===mint)){
     if(!remove)break;const before=BigInt(p.rawQuantity),take=remove<before?remove:before;
     const cost=take===before?p.costSol:Number(BigInt(Math.round(p.costSol*1e9))*take/before)/1e9;
     basis=round(basis+cost);p.rawQuantity=String(before-take);p.quantity=Number(before-take)/10**p.decimals;p.costSol=round(p.costSol-cost);p.externalAdjusted=true;ids.push(p.paperPositionId);remove-=take;
    }
    t.s.positions=t.s.positions.filter(p=>p.rawQuantity!=='0');
    const rent=t.s.rentByMint[mint];let removedRent=0;
    if(rent&&row.rentLamports<rent.lamports){removedRent=rent.lamports-row.rentLamports;rent.lamports=row.rentLamports;if(!rent.lamports)delete t.s.rentByMint[mint];}
    const id='external-inventory:'+createHash('sha256').update(JSON.stringify([mint,lots.map(p=>[p.paperPositionId,p.rawQuantity]),row.rawAmount])).digest('hex').slice(0,24);
    const event={id,type:'fill',at:now,agentId:lots[0].agentId,side:'EXTERNAL',mint,pairAddress:lots[0].pairAddress,symbol:lots[0].symbol,rawRemoved:String(missing),remainingRaw:row.rawAmount,removedCostSol:basis,rentReleasedSol:removedRent/1e9,positionIds:ids,pnlSol:null,positionPnlSol:null,closed:held===0n,reason:'Ví đã đổi số dư token bên ngoài AI; PnL chưa xác minh',decisionEngine:'external-wallet',quoteSource:'confirmed-inventory',mode:'live',slot:snapshot.slot};
    t.s.externalAdjustments??=[];t.s.externalAdjustments.push(event);t.s.trades=[event,...t.s.trades].slice(0,5000);t.s.outbox.push(event);
    // Remove a transferred/otherwise unverified asset at basis as a capital flow,
    // never as a fictional zero-price sale or an entitlement to profit payouts.
    const flow=round(-basis-removedRent/1e9);t.s.netDepositsSol=round(t.s.netDepositsSol+flow);t.s.capitalFlows.push({at:now,amountSol:flow,kind:'external-token-adjustment',mint,pnlUnknown:true});
    t.s.telegramOutbox??=[];t.s.telegramOutbox.push({id,createdAt:now,status:'queued',attempts:0,nextAttemptAt:0,text:['Meme Pilot · ĐỒNG BỘ VÍ BÊN NGOÀI',mint,'Token giảm: '+missing.toString(),'Token còn: '+row.rawAmount,'Đã cập nhật vị thế và bỏ SELL cũ. Chưa xác minh giá bán/PnL; không tính thành lợi nhuận.'].join('\n')});await t.save();
   }catch(error){t.s=original;throw error;}
  }
  t.inventoryProbes.delete(mint);t.s.externalInventoryRevision=(t.s.externalInventoryRevision??0)+1;
  if(t.lastError==='LIVE_TOKEN_BALANCE_CONFLICT')t.lastError=null;await t.save();
 }
}
