import os
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from .network import default_public_backend


def number(value):
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("Invalid numeric input") from exc
    if not d.is_finite():
        raise ValueError("Non-finite numeric input")
    return d


@dataclass(frozen=True)
class Config:
    min_liquidity: Decimal = Decimal("10000")
    min_volume: Decimal = Decimal("10000")
    min_edge_pct: Decimal = Decimal("0.5")
    slippage_bps: Decimal = Decimal("20")
    max_usd_per_trade: Decimal = Decimal("25")
    max_open_exposure: Decimal = Decimal("100")
    daily_loss_limit: Decimal = Decimal("10")
    interval: float = 30
    max_book_age: float = 10
    max_book_skew: float = 2
    request_spacing: float = 0.25
    max_markets: int = 50
    max_pages: int = 10
    retries: int = 3
    output_dir: Path = Path("data")
    stop_file: Path = Path("STOP")
    dry_run: bool = True
    force_ipv4: bool = True
    public_http_backend: str = default_public_backend()

    def __post_init__(self):
        for name in ("min_liquidity", "min_volume", "min_edge_pct", "slippage_bps",
                     "max_usd_per_trade", "max_open_exposure", "daily_loss_limit"):
            value = number(getattr(self, name))
            object.__setattr__(self, name, value)
            if value < 0:
                raise ValueError(name + " must be nonnegative")
        if self.slippage_bps > 10000 or self.min_edge_pct >= 100:
            raise ValueError("Invalid percentage")
        for name in ("interval", "max_book_age", "max_book_skew", "request_spacing"):
            if number(getattr(self, name)) <= 0:
                raise ValueError(name + " must be positive")
        for name in ("max_markets", "max_pages"):
            if getattr(self, name) <= 0:
                raise ValueError(name + " must be positive")
        if self.retries < 0 or self.retries > 8:
            raise ValueError("retries must be 0..8")
        if self.public_http_backend not in ("python", "curl"):
            raise ValueError("PUBLIC_HTTP_BACKEND must be python or curl")
        if not self.dry_run:
            raise ValueError("Stage 1 is read-only: DRY_RUN=false is forbidden")
        if self.max_usd_per_trade <= 0:
            raise ValueError("MAX_USD_PER_TRADE must be positive")

    @classmethod
    def from_env(cls):
        values = {"public_http_backend": os.getenv("PUBLIC_HTTP_BACKEND", default_public_backend())}
        decimals = ("min_liquidity", "min_volume", "min_edge_pct", "slippage_bps",
                    "max_usd_per_trade", "max_open_exposure", "daily_loss_limit")
        for name in decimals:
            if name.upper() in os.environ:
                values[name] = number(os.environ[name.upper()])
        for name in ("interval", "max_book_age", "max_book_skew", "request_spacing"):
            if name.upper() in os.environ:
                values[name] = float(number(os.environ[name.upper()]))
        for name in ("max_markets", "max_pages", "retries"):
            if name.upper() in os.environ:
                values[name] = int(os.environ[name.upper()])
        for name in ("output_dir", "stop_file"):
            if name.upper() in os.environ:
                values[name] = Path(os.environ[name.upper()])
        ipv4 = os.getenv("FORCE_IPV4", "true").lower()
        if ipv4 not in ("true", "false"):
            raise ValueError("FORCE_IPV4 must be true or false")
        values["force_ipv4"] = ipv4 == "true"
        flag = os.getenv("DRY_RUN", "true").lower()
        if flag not in ("true", "false"):
            raise ValueError("DRY_RUN must be true or false")
        return cls(**values, dry_run=flag == "true")
