// Position-relative prices only. Discovery prices and scanner highs are not entry anchors.
export function lockPositionEntry(p, {principalLamports = null} = {}) {
  if (p.entryAnchor) {
    const a = p.entryAnchor;
    if (a.positionId !== p.id || a.mint !== p.mint || a.at !== p.openedAt || !(a.priceSol > 0) || !Number.isFinite(a.priceSol)) throw Error('PAPER_ENTRY_ANCHOR_INVALID');
    if (a.principalLamports !== null && a.principalLamports !== undefined) {
      const quantity = Number(a.initialRaw) / 10 ** a.decimals;
      const expected = a.principalLamports / 1e9 / quantity;
      if (!Number.isSafeInteger(a.principalLamports) || !(a.principalLamports > 0) || !(quantity > 0) || !Number.isFinite(expected) || Math.abs(expected - a.priceSol) > Math.abs(expected) * 1e-12) throw Error('PAPER_ENTRY_ANCHOR_INVALID');
    }
    if (!Object.isFrozen(a)) Object.freeze(a);
    if (Object.getOwnPropertyDescriptor(p,'entryAnchor')?.configurable !== false) Object.defineProperty(p,'entryAnchor',{value:a,enumerable:true,writable:false,configurable:false});
    p.entry = a.priceSol;
    return a;
  }
  if (!(p.entry > 0) || !Number.isFinite(p.entry) || !Number.isFinite(p.openedAt)) throw Error('PAPER_ENTRY_ANCHOR_INVALID');
  const anchor = Object.freeze({version:1, positionId:p.id, mint:p.mint, at:p.openedAt,
    priceSol:p.entry, initialRaw:p.initialRaw, decimals:p.decimals, principalLamports,
    source:principalLamports===null?'persisted BUY entry; not repriced':'simulated BUY principal / actual modeled received quantity',
    excludesNetworkFee:true, excludesRefundableRent:true});
  Object.defineProperty(p, 'entryAnchor', {value:anchor, enumerable:true, writable:false, configurable:false});
  return anchor;
}

export const entryPrice = p => p.entryAnchor?.priceSol ?? p.entry;
export function positionReturn(p, price, observedAt) {
  const entry = entryPrice(p), from = p.entryAnchor?.at ?? p.openedAt;
  if (!(entry > 0) || !(price > 0) || !Number.isFinite(price) || !Number.isFinite(observedAt) || observedAt < from) return null;
  const multiple = price / entry;
  return {multiple, changePct:(multiple-1)*100, entryPriceSol:entry, entryAt:from, priceAt:observedAt,
    basis:'this position BUY fill; price return, not net realized PnL'};
}
