from decimal import Decimal
from .config import number


def admission(config, *, cost, open_exposure, realized_pnl, balance):
    """Pure future risk check; does not read wallet, reserve funds or enable execution."""
    if config.stop_file.exists():
        return False, "STOP_FILE"
    cost, exposure, pnl, balance = map(number, (cost, open_exposure, realized_pnl, balance))
    if cost <= 0 or exposure < 0 or balance < 0:
        return False, "INVALID_AMOUNT"
    if pnl <= -config.daily_loss_limit:
        return False, "DAILY_LOSS_LIMIT"
    if cost > config.max_usd_per_trade:
        return False, "TRADE_LIMIT"
    if exposure + cost > config.max_open_exposure:
        return False, "EXPOSURE_LIMIT"
    if cost > balance:
        return False, "INSUFFICIENT_BALANCE"
    return True, "OK"
