// PAPER strategy only. This module has no wallet, network or execution capability.
export const MOMENTUM_VERSION = 'paper-momentum-5m-v2';
export const MOMENTUM_V1 = 'paper-momentum-5m-v1';
export const isMomentumPosition = p => [MOMENTUM_VERSION, MOMENTUM_V1].includes(p.exitPolicy?.version);
export const WSOL = 'So11111111111111111111111111111111111111112';

export function momentumConfig() {
  return {
    version: MOMENTUM_VERSION,
    momentumOnly: true,
    guardedEntry: true,
    confirmationSamples: 3,
    confirmationSpanMs: 10000,
    confirmationWindowMs: 120000,
    minConfirmedRisePct: 0.5,
    maxPullbackPct: 1.5,
    maxEntryQuoteAgeMs: 5000,
    maxSellQuoteAgeMs: 3000,
    maxTrackedMints: 2048,
    maxRoundTripLossPct: 12,
    maxImpactPct: 3,
    sameSignalReentry: false,
    calibration: 'unvalidated research defaults, not fitted to the losing-trade dataset',
    orderSol: 1,
    stopLossPct: 30,
    tpMultiples: [2, 3, 5, 10],
    tpFractions: [0.5, 0.2, 0.2, 0.1],
    pollMs: 1000,
    maxSignalAgeMs: 45000,
    maxPriceAgeMs: 5000,
    maxPositions: null,
    entryHours: '24/7',
    cooldownMs: 0,
    safetyResearch: 'not an entry gate; unverified remains unverified',
    simulationOnly: true,
  };
}

export function momentumEvidence(m) {
  return {
    source: 'observed 5m public market signal; no holder/social certification',
    inputs: {
      change_5m_pct: m.change5mPct ?? null,
      volume_5m_sol: m.volume5mSol ?? null,
      volume_5m_usd: m.volume5mUsd ?? null,
      buys_5m: m.buys5m ?? null,
      sells_5m: m.sells5m ?? null,
      curve_progress_pct: m.curveProgressPct ?? null,
      change_1m_pct: m.change1mPct ?? null,
      liquidity_quote_sol: m.liquidityQuoteSol ?? null,
      holder_safety: 'unverified / not required by this paper strategy',
      source_venue: m.dexId,
      migrated_pool: m.migratedPool ?? null,
      signal_at: m.activityCheckedAt ?? m.marketObservedAt ?? m.updatedAt,
      signal_window_coverage: m.dexId === 'pumpfun'
        ? (m.historyComplete === true ? 'source history complete; young-token window may be shorter than 5m' : 'partial source history')
        : 'provider-reported 5m change; not reconstructed candles',
    },
  };
}

export function evaluateMomentum(m, { now, cash, fee, rent, held = false, confirmation = null, entryLock = null, ledgerVerified = true, entryRegistryAvailable = true }, policy = momentumConfig(), { requirePrice = true } = {}) {
  const signalAt = m.activityCheckedAt ?? m.marketObservedAt ?? m.updatedAt;
  const priceAt = m.priceAt ?? m.updatedAt;
  const price = m.spotPriceSol ?? (m.solUsd > 0 ? m.priceUsd / m.solUsd : null);
  const fresh = (at, age) => Number.isFinite(at) && at <= now && now - at <= age;
  const checks = {
    venue: ['pumpfun', 'pumpswap'].includes(m.dexId) && (!m.quoteMint || m.quoteMint === WSOL),
    up_5m: Number.isFinite(m.change5mPct) && m.change5mPct > 0,
    signal_fresh: fresh(signalAt, policy.maxSignalAgeMs),
    price_fresh: !requirePrice || (Number.isFinite(price) && price > 0 && fresh(priceAt, policy.maxPriceAgeMs)),
    cash: Number.isSafeInteger(cash) && cash >= 1e9 + fee + rent,
    duplicate_position: !held,
    ...(policy.guardedEntry ? {
      ledger: ledgerVerified === true,
      registry_capacity: entryRegistryAvailable,
      new_signal_cycle: !entryLock || entryLock.armed === true,
      entry_confirmation: confirmation?.confirmed === true,
    } : {}),
  };
  const failed = Object.keys(checks).filter(key => !checks[key]);
  return {
    policyVersion: policy.version,
    verdict: failed.length ? 'SKIP' : 'VALID_SETUP',
    code: failed.length ? 'MOMENTUM_' + failed[0].toUpperCase() : 'VALID_SETUP',
    rule_check: Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, value ? 'pass' : 'fail'])),
    confirmation,
    diagnostic: { failed, source: 'paper momentum only; not PROJECT RULES validation' },
    R1_detail: { proposed_size_sol: failed.length ? 0 : 1 },
    exit_plan: momentumExitPolicy(policy),
  };
}

export function momentumExitPolicy(policy = momentumConfig()) {
  return { version: policy.version ?? MOMENTUM_VERSION, stopLossPct: 30, tpMultiples: [...policy.tpMultiples], tpFractions: [...policy.tpFractions], fractionsOf: 'initial token quantity' };
}

export function momentumExit(p, price) {
  const policy = p.exitPolicy;
  if (!(price > 0) || !(p.entry > 0)) return null;
  p.memory ??= {};
  p.memory.stopTriggered ||= price <= p.entry * 0.7;
  if (p.memory.stopTriggered) return { reason: 'stop-loss', fraction: 1 };
  // A crossed target remains due until its sale is recorded successfully.
  const step = p.tpSoldSteps ?? 0;
  if (step >= policy.tpMultiples.length) return null;
  if (Math.max(p.peak ?? price, price) < p.entry * policy.tpMultiples[step]) return null;
  return { reason: 'momentum-tp' + (step + 1), fraction: policy.tpFractions[step], step, final: step === policy.tpMultiples.length - 1 };
}

export function exitRawAmount(p, plan) {
  const remaining = BigInt(p.raw);
  if (plan.fraction === 1 || plan.final) return remaining;
  const target = BigInt(p.initialRaw) * BigInt(Math.round(plan.fraction * 100)) / 100n;
  return target < remaining ? target : remaining;
}

// Confirm a current rise, rather than treating a positive trailing 5m statistic
// as proof that the price is still rising now. No external social data required.
export class MomentumConfirmation {
  constructor(policy) { this.policy = policy; this.history = new Map(); }
  observe(m, now) {
    const price = m.spotPriceSol, at = m.priceAt ?? m.updatedAt;
    if (!(price > 0) || !Number.isFinite(price) || !Number.isFinite(at) || at > now || now - at > this.policy.maxPriceAgeMs) return;
    const key = m.mint + ':' + m.pairAddress;
    const rows = (this.history.get(key) ?? []).filter(p => now - p.at <= this.policy.confirmationWindowMs);
    if (!rows.length || at > rows.at(-1).at) rows.push({ price, at });
    this.history.delete(key);
    this.history.set(key, rows.slice(-16));
    while (this.history.size > 128) this.history.delete(this.history.keys().next().value);
  }
  clear(mint) { for (const key of this.history.keys()) if (key.startsWith(mint + ':')) this.history.delete(key); }
  read(m, now, maxAgeMs = this.policy.maxPriceAgeMs) {
    const rows = (this.history.get(m.mint + ':' + m.pairAddress) ?? []).filter(p => now >= p.at && now - p.at <= this.policy.confirmationWindowMs);
    const first = rows[0], last = rows.at(-1), previous = rows.at(-2);
    const risePct = first && last ? (last.price / first.price - 1) * 100 : null;
    const peak = rows.length ? Math.max(...rows.map(p => p.price)) : null;
    const pullbackPct = peak ? (1 - last.price / peak) * 100 : null;
    const spanMs = first && last ? last.at - first.at : 0;
    return { samples: rows.length, spanMs, risePct, pullbackPct, lastAt: last?.at ?? null,
      confirmed: rows.length >= this.policy.confirmationSamples && spanMs >= this.policy.confirmationSpanMs &&
        now - last.at <= maxAgeMs && risePct >= this.policy.minConfirmedRisePct &&
        last.price >= previous.price && pullbackPct <= this.policy.maxPullbackPct };
  }
}

export function seedEntryLocks(state) {
  state.entryLocks ??= {};
  const missing = new Map();
  for (const t of state.trades ?? []) if (t.side === 'BUY' && typeof t.mint === 'string' && Number.isFinite(t.at)) {
    if (!missing.has(t.mint) || t.at > missing.get(t.mint)) missing.set(t.mint, t.at);
  }
  for (const p of state.positions ?? []) if (!missing.has(p.mint)) missing.set(p.mint, p.openedAt);
  for (const [mint, at] of missing) if (!Object.hasOwn(state.entryLocks, mint)) {
    const closedAt = Math.max(0, ...(state.trades ?? []).filter(t => t.mint === mint && t.closed).map(t => t.at));
    state.entryLocks[mint] = { armed: false, lastBuyAt: at, lastExitAt: closedAt || at };
  }
}

export function resetEntrySignal(state, m, now, policy) {
  const lock = state.entryLocks?.[m.mint], at = m.activityCheckedAt ?? m.marketObservedAt ?? m.updatedAt;
  if (!lock || lock.armed || state.positions.some(p => p.mint === m.mint)) return false;
  if (!Number.isFinite(m.change5mPct) || m.change5mPct > 0 || !Number.isFinite(at) || at > now || now - at > policy.maxSignalAgeMs || at <= (lock.lastExitAt ?? lock.lastBuyAt)) return false;
  lock.armed = true; lock.resetAt = at;
  return true;
}

export function paperLedgerCheck(state) {
  const valid = [state.initial, state.cash, state.realized].every(Number.isSafeInteger) && state.cash >= 0 &&
    state.positions.every(p => [p.basis, p.rent].every(n => Number.isSafeInteger(n) && n >= 0));
  if (!valid) return { verified: false, differenceLamports: null };
  const basis = state.positions.reduce((n, p) => n + p.basis, 0), rent = state.positions.reduce((n, p) => n + p.rent, 0);
  const difference = state.initial + state.realized - state.cash - basis - rent;
  return { verified: Number.isSafeInteger(difference) && difference === 0, differenceLamports: difference,
    openCostBasisSol: basis / 1e9, lockedRentSol: rent / 1e9,
    equation: 'initial + realized PnL = cash + remaining entry cost basis + locked rent; not market equity' };
}

export function validateEntryRoundTrip(order, quote, fee, now, policy) {
  const r = quote.roundTrip, amount = Number(order.amount);
  if (!r || r.mint !== order.mint || r.pool !== order.pool || r.inAmount !== order.amount || r.sellInput !== quote.out ||
      !/^[1-9]\d{0,19}$/.test(r.sellOut ?? '') || !Number.isFinite(r.at) || r.at < quote.at || r.at > now || now - quote.at > policy.maxEntryQuoteAgeMs) {
    return { ok: false, code: 'ROUNDTRIP_UNVERIFIED' };
  }
  const sellOut = Number(r.sellOut);
  if (!Number.isSafeInteger(sellOut) || !Number.isSafeInteger(amount) || amount <= 0) return { ok: false, code: 'ROUNDTRIP_UNVERIFIED' };
  const lossPct = (1 - (sellOut - 2 * fee) / amount) * 100;
  const impactOk = [quote.impactPct, r.impactPct].every(v => Number.isFinite(v) && v >= 0 && v <= policy.maxImpactPct);
  return { ok: impactOk && lossPct <= policy.maxRoundTripLossPct,
    code: !impactOk ? 'ROUNDTRIP_IMPACT' : lossPct > policy.maxRoundTripLossPct ? 'ROUNDTRIP_COST' : 'ROUNDTRIP_OK',
    lossPct, conservativeMinOutput: true, assumedFeeSolPerLeg: fee / 1e9 };
}
