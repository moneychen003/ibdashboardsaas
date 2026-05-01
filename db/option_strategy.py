"""Option strategy auto-classifier.

Given a list of option holdings (with OCC symbols + signed quantity) and the
underlying stock quantities by symbol, infer a strategy tag for each option:

Single-leg:
- csp                 short PUT (treated as CSP, user manages cash separately)
- naked_call          short CALL, stock < 100×|contracts|
- cc                  short CALL, stock ≥ 100×|contracts|
- protective_put      long PUT + stock ≥ 100×|contracts|
- leaps_call/leaps_put  long C/P, DTE > 365
- long_call/long_put  long C/P, DTE ≤ 365 (no stock or insufficient)

Multi-leg (same underlying + same expiry):
- bull_put_spread     short PUT high + long PUT low
- bear_put_spread     long PUT high + short PUT low
- bull_call_spread    long CALL low + short CALL high
- bear_call_spread    short CALL low + long CALL high
- synthetic_long      long CALL + short PUT same strike
- straddle_long       long CALL + long PUT same strike
- straddle_short      short CALL + short PUT same strike
- strangle_long       long CALL + long PUT diff strikes
- strangle_short      short CALL + short PUT diff strikes
- iron_condor         4 legs: long-short-short-long across PUT then CALL
- iron_butterfly      iron_condor with put_short_strike == call_short_strike
- collar              stock + long PUT + short CALL (only when same expiry)

Holdings dict is mutated in place; new fields:
  underlying, right, dte, strategy, strategyLabel, strikeRaw

Returns nothing.
"""
import re
from collections import defaultdict
from datetime import date, datetime

OCC_RE = re.compile(r"^([A-Z]+(?:\.[A-Z])?)\s+(\d{6})([CP])(\d{8})$")

LABELS = {
    "csp": "现金担保 PUT",
    "naked_put": "裸卖 PUT",
    "cc": "备兑看涨",
    "naked_call": "裸卖看涨",
    "protective_put": "保护性看跌",
    "leaps_call": "LEAPS 看涨",
    "leaps_put": "LEAPS 看跌",
    "long_call": "看涨投机",
    "long_put": "看跌投机",
    "bull_put_spread": "牛市看跌价差",
    "bear_put_spread": "熊市看跌价差",
    "bull_call_spread": "牛市看涨价差",
    "bear_call_spread": "熊市看涨价差",
    "synthetic_long": "合成多头",
    "synthetic_short": "合成空头",
    "straddle_long": "跨式多头",
    "straddle_short": "跨式空头",
    "strangle_long": "宽跨式多头",
    "strangle_short": "宽跨式空头",
    "iron_condor": "铁鹰",
    "iron_butterfly": "铁蝶",
    "collar": "领口",
    "calendar": "日历价差",
    "unknown": "未识别",
}


def parse_occ(symbol):
    if not symbol:
        return None
    m = OCC_RE.match(symbol.strip())
    if not m:
        return None
    underlying, ymd, right, strike_raw = m.groups()
    try:
        expiry = datetime.strptime(ymd, "%y%m%d").date()
    except ValueError:
        return None
    return {
        "underlying": underlying,
        "expiry": expiry,
        "right": right,
        "strike": int(strike_raw) / 1000.0,
    }


def _set(legs, strategy):
    for l in legs:
        l["strategy"] = strategy
        l["strategyLabel"] = LABELS.get(strategy, strategy)


def _classify_single_leg(h, stock_qty):
    qty = h.get("quantity") or 0
    if qty == 0:
        return
    right = h["right"]
    dte = h["dte"]
    # IB option quantity is shares-equivalent (contracts * 100), so coverage_needed == abs(qty)
    coverage_needed = abs(qty)

    if qty < 0 and right == "P":
        h["strategy"] = "csp"
    elif qty < 0 and right == "C":
        h["strategy"] = "cc" if stock_qty >= coverage_needed else "naked_call"
    elif qty > 0 and right == "C":
        h["strategy"] = "leaps_call" if dte > 365 else "long_call"
    elif qty > 0 and right == "P":
        if stock_qty >= coverage_needed:
            h["strategy"] = "protective_put"
        elif dte > 365:
            h["strategy"] = "leaps_put"
        else:
            h["strategy"] = "long_put"
    if h.get("strategy"):
        h["strategyLabel"] = LABELS[h["strategy"]]


def _classify_two_legs(legs, stock_qty):
    a, b = legs
    qa, qb = (a.get("quantity") or 0), (b.get("quantity") or 0)
    if qa == 0 or qb == 0:
        return
    ra, rb = a["right"], b["right"]
    sa, sb = a["_parsed"]["strike"], b["_parsed"]["strike"]

    # Same-strike, opposite right -> synthetic
    if sa == sb and ra != rb:
        long_call = a if (ra == "C" and qa > 0) else (b if (rb == "C" and qb > 0) else None)
        short_put = a if (ra == "P" and qa < 0) else (b if (rb == "P" and qb < 0) else None)
        if long_call and short_put:
            _set(legs, "synthetic_long")
            return
        long_put = a if (ra == "P" and qa > 0) else (b if (rb == "P" and qb > 0) else None)
        short_call = a if (ra == "C" and qa < 0) else (b if (rb == "C" and qb < 0) else None)
        if long_put and short_call:
            _set(legs, "synthetic_short")
            return

    # Both same right -> vertical spread
    if ra == rb:
        if qa * qb >= 0:  # both same direction = not a spread
            return
        short_leg = a if qa < 0 else b
        long_leg = a if qa > 0 else b
        ks, kl = short_leg["_parsed"]["strike"], long_leg["_parsed"]["strike"]
        if ra == "P":
            _set(legs, "bull_put_spread" if ks > kl else "bear_put_spread")
        else:  # CALL
            _set(legs, "bear_call_spread" if ks < kl else "bull_call_spread")
        return

    # Different right -> straddle / strangle / collar
    if ra != rb:
        # Collar: stock + long PUT + short CALL
        long_put = a if (ra == "P" and qa > 0) else (b if (rb == "P" and qb > 0) else None)
        short_call = a if (ra == "C" and qa < 0) else (b if (rb == "C" and qb < 0) else None)
        if long_put and short_call:
            # IB qty is shares-equivalent already
            need = max(abs(qa), abs(qb))
            if stock_qty >= need:
                _set(legs, "collar")
                return

        if qa > 0 and qb > 0:
            _set(legs, "straddle_long" if sa == sb else "strangle_long")
        elif qa < 0 and qb < 0:
            _set(legs, "straddle_short" if sa == sb else "strangle_short")


def _classify_four_legs(legs, stock_qty):
    puts = [l for l in legs if l["right"] == "P"]
    calls = [l for l in legs if l["right"] == "C"]
    if len(puts) != 2 or len(calls) != 2:
        return
    put_short = next((l for l in puts if (l.get("quantity") or 0) < 0), None)
    put_long = next((l for l in puts if (l.get("quantity") or 0) > 0), None)
    call_short = next((l for l in calls if (l.get("quantity") or 0) < 0), None)
    call_long = next((l for l in calls if (l.get("quantity") or 0) > 0), None)
    if not all([put_short, put_long, call_short, call_long]):
        return
    pl, ps = put_long["_parsed"]["strike"], put_short["_parsed"]["strike"]
    cs, cl = call_short["_parsed"]["strike"], call_long["_parsed"]["strike"]
    if pl < ps <= cs < cl:
        _set(legs, "iron_butterfly" if ps == cs else "iron_condor")


def classify_strategies(option_holdings, stock_qty_by_symbol, today=None, wheel_underlyings=None):
    """wheel_underlyings: set of symbols that have historical PUT/CALL assignment events.
    Holdings on these underlyings whose strategy is csp/cc/naked_put/naked_call get
    `isWheel=True` flag (front-end groups them under "轮子策略")."""
    today = today or date.today()
    wheel_set = set(wheel_underlyings or [])
    parsed_list = []
    for h in option_holdings:
        p = parse_occ(h.get("symbol", ""))
        if not p:
            h["strategy"] = "unknown"
            h["strategyLabel"] = LABELS["unknown"]
            continue
        h["underlying"] = p["underlying"]
        h["right"] = p["right"]
        h["dte"] = (p["expiry"] - today).days
        h["strikeRaw"] = p["strike"]
        h["_parsed"] = p
        parsed_list.append(h)

    # Group by (underlying, expiry) for multi-leg detection
    groups = defaultdict(list)
    for h in parsed_list:
        groups[(h["_parsed"]["underlying"], h["_parsed"]["expiry"])].append(h)

    for (underlying, _expiry), legs in groups.items():
        sq = stock_qty_by_symbol.get(underlying, 0) or 0
        if len(legs) == 2:
            _classify_two_legs(legs, sq)
        elif len(legs) == 4:
            _classify_four_legs(legs, sq)
        # 3 or 5+ legs: leave as single-leg fallthrough

    # Single-leg fallthrough for any not yet classified
    for h in parsed_list:
        if not h.get("strategy"):
            _classify_single_leg(h, stock_qty_by_symbol.get(h["underlying"], 0) or 0)

    # Mark wheel candidates
    WHEEL_STRATEGIES = {"csp", "cc", "naked_put", "naked_call"}
    for h in parsed_list:
        if h.get("strategy") in WHEEL_STRATEGIES and h.get("underlying") in wheel_set:
            h["isWheel"] = True

    for h in parsed_list:
        h.pop("_parsed", None)


def detect_wheel_underlyings(user_id):
    """Detect underlyings that have PUT/CALL Assignment events in archive_option_eae.
    These are 'wheel candidates' — historically went through CSP→assigned or CC→called away."""
    try:
        from db.postgres_client import execute
        rows = execute(
            """
            SELECT DISTINCT underlying_symbol AS sym
            FROM archive_option_eae
            WHERE user_id = %s
              AND transaction_type = 'Assignment'
              AND underlying_symbol IS NOT NULL
              AND underlying_symbol != ''
            """,
            (user_id,),
        )
        return {r["sym"] for r in rows if r.get("sym")}
    except Exception as e:
        print(f"[detect_wheel_underlyings] {e}")
        return set()
