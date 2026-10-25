"""Load a local dotenv file as data, never execute shell commands."""
import os
from pathlib import Path


def load_env(path=Path(".env")):
    if not path.exists(): return
    allowed = {"DRY_RUN", "FORCE_IPV4", "PUBLIC_HTTP_BACKEND", "MIN_LIQUIDITY", "MIN_VOLUME", "MIN_EDGE_PCT", "SLIPPAGE_BPS",
               "MAX_USD_PER_TRADE", "MAX_OPEN_EXPOSURE", "DAILY_LOSS_LIMIT", "INTERVAL",
               "MAX_BOOK_AGE", "MAX_BOOK_SKEW", "REQUEST_SPACING", "MAX_MARKETS", "MAX_PAGES",
               "RETRIES", "OUTPUT_DIR", "STOP_FILE"}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"): continue
        if "=" not in line: raise ValueError("Invalid .env line")
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if key not in allowed: continue  # Never load a wallet key in the scanner.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in (chr(34), chr(39)):
            value = value[1:-1]
        os.environ.setdefault(key, value)


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parent)
    load_env()
    from polymarket_arb.main import main
    raise SystemExit(main())
