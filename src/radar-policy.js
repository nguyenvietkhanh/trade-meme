// Display-only LIVE radar filter. Never used for entries or held-position exits.
export const RADAR_MIN_PAIR_AGE_MS=10*60*60*1000;
export function radarPairAgeEligible(m,now=Date.now()){
 return Number.isFinite(m.pairCreatedAt)&&m.pairCreatedAt>0&&m.pairCreatedAt<=now&&now-m.pairCreatedAt>=RADAR_MIN_PAIR_AGE_MS;
}
