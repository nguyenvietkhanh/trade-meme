import csv
import json
import uuid
import sqlite3
from datetime import datetime, timezone

FIELDS = ("time", "market_id", "condition_id", "market", "status", "reason", "ask_yes", "ask_no",
          "depth_yes", "depth_no", "max_size", "evaluated_size", "cost", "fees", "slippage", "expected_payout",
          "expected_profit", "edge_pct", "vwap_yes", "vwap_no", "yes_timestamp", "no_timestamp", "fee_rate", "fee_exponent")


class Storage:
    def __init__(self, directory):
        directory.mkdir(parents=True, exist_ok=True)
        self.csv_path = directory / "scans.csv"
        self.sample_dir = directory / "skip_samples"
        self.sampled = set()
        self.db = sqlite3.connect(directory / "scans.sqlite3")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS scans (" + ",".join(f"{key} TEXT" for key in FIELDS) + ")")

    def save(self, market, status, reason="", estimate=None, **extra):
        row = dict.fromkeys(FIELDS, "")
        row.update(time=datetime.now(timezone.utc).isoformat(), market_id=market.id,
                   condition_id=market.condition, market=market.title, status=status, reason=reason)
        if estimate: row.update(estimate.strings())
        row.update({k: str(v) for k, v in extra.items() if k in FIELDS})
        with self.db:
            self.db.execute("INSERT INTO scans VALUES (" + ",".join("?" for _ in FIELDS) + ")", [row[k] for k in FIELDS])
        new = not self.csv_path.exists() or self.csv_path.stat().st_size == 0
        with self.csv_path.open("a", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=FIELDS)
            if new: writer.writeheader()
            # CSV intended for spreadsheets: prevent formula injection from market titles.
            safe = {k: ("'" + v if k == "market" and v.lstrip().startswith(("=", "+", "-", "@")) else v) for k, v in row.items()}
            writer.writerow(safe)

    def sample(self, market, reason, details):
        key = (market.condition, reason)
        if key in self.sampled or len(self.sampled) >= 100 or not details:
            return
        self.sample_dir.mkdir(parents=True, exist_ok=True)
        row = {"captured_at": datetime.now(timezone.utc).isoformat(), "market_id": market.id,
               "condition": market.condition, "reason": reason, "public_details": details}
        # No error text, URLs with credentials, keys or private state are accepted here.
        filename = uuid.uuid4().hex + ".json"
        (self.sample_dir / filename).write_text(json.dumps(row, indent=2, default=str), encoding="utf-8")
        self.sampled.add(key)

    def api_stop(self, exc):
        row = {"time": datetime.now(timezone.utc).isoformat(), "code": exc.safe_code,
               "stage": exc.stage, "attempts": exc.attempts,
               "parameters": exc.request_parameters, "validation": exc.validation}
        (self.csv_path.parent / "api_stop.json").write_text(json.dumps(row, indent=2), encoding="utf-8")

    def close(self):
        self.db.close()
