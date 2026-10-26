import argparse
import time
import sys
from collections import Counter
from .config import Config
from .market_data import MarketData, APIError, DataError
from .pricing import evaluate
from .storage import Storage


def safe_title(value):
    return "".join(c if c.isprintable() else " " for c in value)[:64]


def scan(config, data, storage):
    markets = data.markets()
    best, errors = [], 0
    counts, reasons = Counter(), Counter()
    def record(market, status, reason="", **kwargs):
        counts[status] += 1
        if reason: reasons[reason] += 1
        storage.save(market, status, reason, **kwargs)
    for market in markets:
        if config.stop_file.exists(): raise InterruptedError("STOP_FILE")
        try:
            yes, no, fees, minimum, yt, nt = data.snapshot(market)
            estimate = evaluate(yes["asks"], no["asks"], fees, fees, budget=config.max_usd_per_trade,
                                min_edge_pct=config.min_edge_pct, slippage_bps=config.slippage_bps)
            status = "ESTIMATE_UNVERIFIED_DOCS" if estimate else "NO_EDGE"
            if estimate and estimate.max_size < minimum:
                status = "BELOW_MIN_ORDER_SIZE"; estimate = None
            diagnostic = estimate or evaluate(yes["asks"], no["asks"], fees, fees,
                budget=config.max_usd_per_trade, min_edge_pct=config.min_edge_pct,
                slippage_bps=config.slippage_bps, profitable_only=False)
            record(market, status, estimate=diagnostic, yes_timestamp=yt, no_timestamp=nt,
                         fee_rate=fees.rate, fee_exponent=fees.exponent)
            if estimate: best.append((market, estimate))
            errors = 0
        except APIError as exc:
            errors += 1
            reason = f"{exc.safe_code} stage={exc.stage} attempts={exc.attempts}"
            record(market, "API_ERROR", reason)
            storage.sample(market, "API_ERROR", {"code": exc.safe_code, "stage": exc.stage,
                "http_status": exc.http_status, "attempts": exc.attempts})
            print(f"API ERROR | market={market.id} | {reason} | consecutive={errors}/3", flush=True)
            if errors >= 3:
                raise APIError("Three consecutive market API failures; last=" + reason)
        except DataError as exc:
            errors = 0
            record(market, "SKIP_DATA", str(exc))
            storage.sample(market, str(exc), exc.details)
        except (ValueError, TypeError, KeyError, ArithmeticError):
            errors = 0
            record(market, "SKIP_DATA", "Missing, stale, inconsistent or unsupported data")
    print(f"READ ONLY | scanned {len(markets)} | estimates {len(best)} | fees/docs not production-verified")
    print("RESULTS | " + " | ".join(f"{key}={value}" for key, value in sorted(counts.items())))
    if reasons:
        print("BLOCKS  | " + " | ".join(f"{key}={value}" for key, value in reasons.most_common()))
    print(f"{'Market':64} {'Edge/payout':>12} {'Max pairs':>12} {'Cost pUSD':>12} {'Profit est.':>12}")
    for market, e in sorted(best, key=lambda x: x[1].expected_profit, reverse=True)[:10]:
        print(f"{safe_title(market.title):64} {e.edge_pct:11.4f}% {e.max_size:12.6f} {e.cost:12.6f} {e.expected_profit:12.6f}")
    print("Estimates are NOT fills, paper PnL, guaranteed arbitrage or order recommendations.")
    return best


def main():
    parser = argparse.ArgumentParser(description="Stage 1: read-only binary-market scanner")
    parser.add_argument("--loop", action="store_true", help="Repeat scans at INTERVAL seconds")
    args = parser.parse_args()
    storage = None
    try:
        config = Config.from_env()
        if config.stop_file.exists(): raise InterruptedError("STOP_FILE")
        data = MarketData(config)
        storage = Storage(config.output_dir)
        while True:
            started = time.monotonic()
            scan(config, data, storage)
            if not args.loop: return 0
            while time.monotonic() - started < config.interval:
                if config.stop_file.exists(): raise InterruptedError("STOP_FILE")
                time.sleep(min(1, config.interval))
    except (KeyboardInterrupt, InterruptedError):
        print("Scanner stopped; no order sent."); return 0
    except APIError as exc:
        print("Scanner stopped: " + str(exc) + "; check network policy and official API availability.", file=sys.stderr)
        return 1
    except (RuntimeError, ValueError):
        print("Scanner stopped: invalid configuration, unavailable SDK/API or output failure. See README.", file=sys.stderr)
        return 1
    except OSError:
        print("Scanner stopped: storage/network unavailable; no order sent.", file=sys.stderr); return 1
    finally:
        if storage: storage.close()
        from .browser_data import close_browser
        close_browser()


if __name__ == "__main__":
    raise SystemExit(main())
