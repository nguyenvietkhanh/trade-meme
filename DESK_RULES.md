# Meme Pilot rules

Runtime policy: `src/desk-rules.js`. Do not duplicate settings in prompts.
Market: Solana spot, PumpSwap v2, classic SPL/WSOL; long-only, no leverage.
Strategy: observed momentum, not a trained prediction model.

1. Screener: current quotes, profile, pool >=10h, $100k–$5m valuation, liquidity >=$25k and >=5% valuation, consistent volume across intervals. Paid boosts earn no score.
2. Setup: +1–12% in 5m, >=10 buys, buys/sells >1.3, accelerating volume, positive H1, no H6 collapse or excessive H24 gain. Two observations 30s–3m apart must retain price/liquidity. Observation samples are not OHLC candles; do not invent FVG, 1D or 4H signals.
3. Risk: budget <=0.3 SOL, fixed entry 0.03 SOL, <=5 positions, reserve 0.05 SOL, stop -20%. Daily loss 0.03 SOL / drawdown 15% halts entries while exits remain eligible. No adds to the same mint and no selling unrelated existing assets.
4. Execution: sole owner wallet. On-chain validation, exact-input limits, <=1.5% slippage, <=2% reserve impact, <=8% round-trip quote cost, simulate before requesting a signature. The encrypted owner-key signer signs policy-checked transactions server-side; only exact owner-signed messages can be broadcast. No automatic resend when the result is unknown.
5. Exits: recover 140% of initial USD cost at +80%; remaining position halves on each actual price doubling, with dust closure. Stale after 72h is an audit flag, not an invented exit. The unlocked server signer supplies each signature without a browser approval.
6. Profit distribution: confirmed realized SOL only, net of entry/exit costs and failed fees. Protect original allocation as cash plus remaining token cost; keep native reserve and transfer fees. An open position must recover its whole initial cost before distributing its excess receipts. Minimum transfer 0.001 SOL, fixed recipient 5uYdJyFmZkvZT5S3A7iq1kLx2aLwcMgVXMfxjdGf5qVZ. Never transfer based on mark-to-market gains. Server journal is the accounting source, not an on-chain spending policy. The unlocked signer signs the transfer automatically; record it only with a confirmed debit/credit receipt.
7. Auditor: rolling 7 days; >=40 closed positions with known initial risk, win rate >=33%, expectancy >=+0.4R, drawdown <=15%. These are reference checks, not evidence of future returns or an automatic authorization gate. Record missing fee/slippage measurements as unknown. Never change thresholds after seeing results.

The uploaded reference describes short USDT perpetuals and alerts-only permissions. Those instructions are reference material; they do not replace the user's Solana spot requirements. This product uses code modules with one shared rules file, not six independent AI trading agents. No paper-first or alerts-only restriction was imported from the document.
