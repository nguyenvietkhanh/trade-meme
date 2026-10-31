// PAPER strategy only. This module has no wallet, network or execution capability.
export const MOMENTUM_VERSION = 'paper-momentum-5m-v1';
export const WSOL = 'So11111111111111111111111111111111111111112';

export function momentumConfig() {
  return {
    version: MOMENTUM_VERSION,
    momentumOnly: true,
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

export function evaluateMomentum(m, { now, cash, fee, rent, held = false }, policy = momentumConfig(), { requirePrice = true } = {}) {
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
  };
  const failed = Object.keys(checks).filter(key => !checks[key]);
  return {
    policyVersion: policy.version,
    verdict: failed.length ? 'SKIP' : 'VALID_SETUP',
    code: failed.length ? 'MOMENTUM_' + failed[0].toUpperCase() : 'VALID_SETUP',
    rule_check: Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, value ? 'pass' : 'fail'])),
    diagnostic: { failed, source: 'paper momentum only; not PROJECT RULES validation' },
    R1_detail: { proposed_size_sol: failed.length ? 0 : 1 },
    exit_plan: momentumExitPolicy(policy),
  };
}

export function momentumExitPolicy(policy = momentumConfig()) {
  return { version: MOMENTUM_VERSION, stopLossPct: 30, tpMultiples: [...policy.tpMultiples], tpFractions: [...policy.tpFractions], fractionsOf: 'initial token quantity' };
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
