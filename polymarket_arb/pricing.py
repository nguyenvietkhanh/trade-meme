from dataclasses import dataclass, asdict
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from .config import number

D = Decimal
QUANTUM = D("0.000001")  # conservative estimator precision, not a venue lot-size claim


@dataclass(frozen=True)
class Fees:
    rate: Decimal
    exponent: int

    def __post_init__(self):
        object.__setattr__(self, "rate", number(self.rate))
        if not 0 <= self.rate <= 1 or type(self.exponent) is not int or not 0 <= self.exponent <= 10:
            raise ValueError("Unsupported fee parameters")

    def per_share(self, price):
        # Official V2 SDK fees.adjust_buy_amount_for_fees, platform fee per share.
        p = number(price)
        if not 0 < p < 1:
            raise ValueError("Invalid binary share price")
        return self.rate * (p * (1 - p)) ** self.exponent


def levels(raw):
    if not isinstance(raw, list):
        raise ValueError("Missing asks")
    merged = {}
    for row in raw:
        p, q = number(row["price"]), number(row["size"])
        if not 0 < p < 1 or q < 0:
            raise ValueError("Invalid order-book level")
        if q:
            merged[p] = merged.get(p, D(0)) + q
    return sorted(merged.items())


@dataclass
class Estimate:
    ask_yes: Decimal
    ask_no: Decimal
    depth_yes: Decimal
    depth_no: Decimal
    max_size: Decimal
    evaluated_size: Decimal
    cost: Decimal
    fees: Decimal
    slippage: Decimal
    expected_payout: Decimal
    expected_profit: Decimal
    edge_pct: Decimal
    vwap_yes: Decimal
    vwap_no: Decimal

    def strings(self):
        return {k: str(v) for k, v in asdict(self).items()}


def evaluate(yes, no, fee_yes, fee_no, *, budget, min_edge_pct, slippage_bps, profitable_only=True):
    y, n = levels(yes), levels(no)
    if not y or not n:
        return None
    budget, target, slip_rate = number(budget), number(min_edge_pct) / 100, number(slippage_bps) / 10000
    if budget <= 0 or not 0 <= target < 1 or not 0 <= slip_rate <= 1:
        raise ValueError("Invalid estimation limits")
    i = j = 0
    yr, nr = y[0][1], n[0][1]
    size = cy = cn = fy = fn = slip = D(0)
    while i < len(y) and j < len(n):
        py, pn = y[i][0], n[j][0]
        fyp, fnp = fee_yes.per_share(py), fee_no.per_share(pn)
        per_slip = (py + pn) * slip_rate
        unit_cost = py + pn + fyp + fnp + per_slip
        # Only accept marginal tranches meeting threshold; conservative if fee curve isn't monotonic.
        if profitable_only and (1 - unit_cost < target or unit_cost >= 1):
            break
        # Reserve up to one fee quantum per leg, then round quantity down.
        available = budget - cy - cn - fy - fn - slip - 2 * QUANTUM
        q = min(yr, nr, max(D(0), available / unit_cost)).quantize(QUANTUM, rounding=ROUND_FLOOR)
        if q <= 0:
            break
        size += q; cy += q * py; cn += q * pn
        fy += q * fyp; fn += q * fnp; slip += q * per_slip
        yr -= q; nr -= q
        if yr <= 0:
            i += 1
            if i < len(y): yr = y[i][1]
        if nr <= 0:
            j += 1
            if j < len(n): nr = n[j][1]
    if not size:
        return None
    fees = fy.quantize(QUANTUM, rounding=ROUND_CEILING) + fn.quantize(QUANTUM, rounding=ROUND_CEILING)
    cost = cy + cn + fees + slip
    profit = size - cost
    edge = profit / size * 100
    if cost > budget or (profitable_only and (profit <= 0 or edge < target * 100)):
        return None
    return Estimate(y[0][0], n[0][0], sum(q for _, q in y), sum(q for _, q in n),
                    size if profitable_only else D(0), size, cost, fees, slip, size, profit, edge, cy / size, cn / size)
