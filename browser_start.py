"""Reuse the same isolated Chrome session for preflight and read-only scanning."""
import os
from pathlib import Path
from run_local import load_env
from local_verify import main as verify
from polymarket_arb.main import main as scanner
from polymarket_arb.browser_data import close_browser


def main():
    os.chdir(Path(__file__).resolve().parent)
    os.environ["PUBLIC_HTTP_BACKEND"] = "browser"
    os.environ["DRY_RUN"] = "true"
    load_env()
    try:
        result = verify(["--api-only", "--backend", "browser"])
        if result:
            print("Preflight failed after bounded retries. Scanner not started. No order sent.")
            return result
        print("Preflight passed. Reusing the SAME Chrome session. READ ONLY; Ctrl+C stops.", flush=True)
        return scanner(["--loop"])
    except KeyboardInterrupt:
        print("Stopped; no order sent.")
        return 0
    finally:
        close_browser()


if __name__ == "__main__":
    raise SystemExit(main())
