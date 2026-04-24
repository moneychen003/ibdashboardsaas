#!/usr/bin/env python3
"""实时行情拉取：支持多数据源配置（Finnhub / Yahoo Finance / Polygon / Alpaca）。"""

import os
import sys
import time
import json
import requests
import re
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from db.postgres_client import get_cursor, execute


CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config")
MARKET_SETTINGS_FILE = os.path.join(CONFIG_DIR, "market_data_settings.json")

DEFAULT_SETTINGS = {
    "sources": ["finnhub", "yahoo", "webull", "tradier"],
    "finnhub": {"enabled": True, "api_key": os.environ.get("FINNHUB_API_KEY", "")},
    "yahoo": {"enabled": True, "api_key": ""},
    "webull": {"enabled": True, "api_key": ""},
    "tradier": {"enabled": False, "api_key": ""},
    "polygon": {"enabled": False, "api_key": ""},
    "alpaca": {"enabled": False, "api_key": ""}
}


def _load_settings(user_id=None):
    if user_id:
        row = execute('''
            SELECT sources, finnhub, yahoo, webull, tradier, polygon, alpaca
            FROM user_market_settings WHERE user_id = %s
        ''', (user_id,))
        if row:
            r = row[0]
            return {
                "sources": r.get("sources", DEFAULT_SETTINGS["sources"]),
                "finnhub": r.get("finnhub", DEFAULT_SETTINGS["finnhub"]),
                "yahoo": r.get("yahoo", DEFAULT_SETTINGS["yahoo"]),
                "webull": r.get("webull", DEFAULT_SETTINGS["webull"]),
                "tradier": r.get("tradier", DEFAULT_SETTINGS["tradier"]),
                "polygon": r.get("polygon", DEFAULT_SETTINGS["polygon"]),
                "alpaca": r.get("alpaca", DEFAULT_SETTINGS["alpaca"]),
            }
    if os.path.exists(MARKET_SETTINGS_FILE):
        with open(MARKET_SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return DEFAULT_SETTINGS.copy()


def _save_settings(data):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(MARKET_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _is_us_market_open(d: date = None) -> bool:
    """判断美股是否开盘（仅简单排除周末和常见法定假日，不调休）。"""
    d = d or date.today()
    if d.weekday() >= 5:
        return False
    fixed_holidays = {(1, 1), (6, 19), (7, 4), (12, 25)}
    if (d.month, d.day) in fixed_holidays:
        return False
    if d.weekday() == 0:
        if d.month == 1 and 15 <= d.day <= 21:
            return False
        if d.month == 2 and 15 <= d.day <= 21:
            return False
        if d.month == 5 and d.day >= 25:
            return False
        if d.month == 9 and d.day <= 7:
            return False
    if d.weekday() == 3 and d.month == 11 and 22 <= d.day <= 28:
        return False
    return True


def _is_equity_symbol(sym):
    """过滤掉明显是期权、债券的 symbol，只保留股票/ETF。"""
    if not sym:
        return False
    if ' ' in sym:
        return False
    if re.match(r'^\d+$', sym):
        return False
    return True


# ------------------------------------------------------------------
# Data source implementations
# ------------------------------------------------------------------
def _fetch_finnhub_prices(symbols, api_key):
    prices = {}
    if not api_key or not symbols:
        return prices
    # Validate key on first symbol to avoid wasting quota
    try:
        resp = requests.get(
            "https://finnhub.io/api/v1/quote",
            params={"symbol": symbols[0], "token": api_key},
            timeout=8,
        )
        data = resp.json()
        if "error" in data or (data.get("c") == 0 and len(data) <= 2):
            print(f"[market] Finnhub key invalid or empty response: {data}")
            return prices
        if data.get("c") is not None and float(data["c"]) > 0:
            prices[symbols[0]] = float(data["c"])
    except Exception as e:
        print(f"[market] Finnhub error for {symbols[0]}: {e}")

    for sym in symbols[1:]:
        time.sleep(1.05)  # stay under 60 calls/minute
        try:
            resp = requests.get(
                "https://finnhub.io/api/v1/quote",
                params={"symbol": sym, "token": api_key},
                timeout=8,
            )
            data = resp.json()
            price = data.get("c")
            if price is not None and float(price) > 0:
                prices[sym] = float(price)
        except Exception as e:
            print(f"[market] Finnhub error for {sym}: {e}")
    return prices


def _fetch_yahoo_option_prices(option_symbols):
    """使用 yfinance 1.2+ 获取期权实时价格（通过 option_chain）。"""
    prices = {}
    if not option_symbols:
        return prices
    try:
        import yfinance as yf
    except ImportError:
        print("[market] yfinance not installed, skipping Yahoo options")
        return prices

    from collections import defaultdict

    def _parse_ib_option(sym):
        parts = sym.strip().split()
        if len(parts) != 2:
            return None
        underlying = parts[0]
        code = parts[1]
        if len(code) < 15:
            return None
        yr = '20' + code[0:2]
        mon = code[2:4]
        day = code[4:6]
        pc = code[6].upper()
        strike = int(code[7:]) / 1000
        expiry = f"{yr}-{mon}-{day}"
        return underlying, expiry, strike, pc

    groups = defaultdict(list)
    for sym in option_symbols:
        parsed = _parse_ib_option(sym)
        if parsed:
            groups[(parsed[0], parsed[1])].append((sym, parsed[2], parsed[3]))

    for (underlying, expiry), opts in groups.items():
        try:
            chain = yf.Ticker(underlying).option_chain(expiry)
            for sym, strike, pc in opts:
                df = chain.puts if pc == 'P' else chain.calls
                row = df[df['strike'] == strike]
                if not row.empty:
                    last = float(row['lastPrice'].values[0])
                    bid = float(row['bid'].values[0]) if row['bid'].values[0] is not None else 0
                    ask = float(row['ask'].values[0]) if row['ask'].values[0] is not None else 0
                    price = last
                    if bid > 0 and ask > 0:
                        midpoint = round((bid + ask) / 2, 2)
                        if price == 0 or price != price or abs(price - midpoint) > midpoint * 0.5:
                            price = midpoint
                    if (price == 0 or price != price) and bid > 0 and ask > 0:
                        price = round((bid + ask) / 2, 2)
                    if price > 0:
                        prices[sym] = price
        except Exception as e:
            print(f"[market] Yahoo option error for {underlying} {expiry}: {e}")
    return prices


_YAHOO_SUFFIX_BY_CURRENCY = {
    'EUR': '.F',   # Frankfurt (FWB)
    'HKD': '.HK',  # Hong Kong
    'JPY': '.T',   # Tokyo
    'GBP': '.L',   # London
    'AUD': '.AX',  # Australia
    'CAD': '.TO',  # Toronto
    'CHF': '.SW',  # Swiss
    'SGD': '.SI',  # Singapore
    'KRW': '.KS',  # Korea
    'TWD': '.TW',  # Taiwan
    'INR': '.NS',  # India NSE
}


def _build_yahoo_symbol_overrides(symbols):
    """Map plain symbol → Yahoo ticker for non-USD instruments based on IB trade records.

    Returns dict {plain_symbol: yahoo_symbol}. Symbols already in USD or unknown
    currency are left out (caller falls back to the plain symbol).
    """
    overrides = {}
    if not symbols:
        return overrides
    try:
        rows = execute(
            "SELECT DISTINCT symbol, currency FROM archive_trade "
            "WHERE asset_category IN ('STK','ETF') AND symbol = ANY(%s) "
            "AND currency IS NOT NULL AND currency != '' AND currency != 'USD'",
            (list(symbols),),
        )
    except Exception as e:
        print(f"[market] Yahoo override lookup failed: {e}")
        return overrides
    for r in rows:
        sym = r.get("symbol")
        curr = (r.get("currency") or "").upper()
        suffix = _YAHOO_SUFFIX_BY_CURRENCY.get(curr)
        if sym and suffix:
            overrides[sym] = f"{sym}{suffix}"
    return overrides


def _fetch_yahoo_prices(symbols):
    """使用 yfinance 获取股价，优先取盘后/盘前价，否则取常规收盘价。
    非美股（EUR/HKD/JPY/GBP/... ）按 IB 交易记录的 currency 自动加 Yahoo 后缀。
    """
    prices = {}
    if not symbols:
        return prices
    try:
        import yfinance as yf
    except ImportError:
        print("[market] yfinance not installed, skipping Yahoo fallback")
        return prices

    # plain → yahoo；没有 override 的就用 plain 本身去查
    overrides = _build_yahoo_symbol_overrides(symbols)
    yahoo_of = lambda s: overrides.get(s, s)
    plain_of = {yahoo_of(s): s for s in symbols}
    fetch_syms = list(plain_of.keys())
    if overrides:
        print(f"[market] Yahoo non-US symbol overrides: {overrides}")

    # 1. 批量获取常规收盘价作为 fallback
    try:
        df = yf.download(
            fetch_syms,
            period="5d",
            interval="1d",
            group_by="ticker",
            progress=False,
            threads=True,
        )
        if len(fetch_syms) == 1:
            ysym = fetch_syms[0]
            try:
                last = df["Close"].dropna().iloc[-1]
                if float(last) > 0:
                    prices[plain_of[ysym]] = float(last)
            except Exception:
                pass
        else:
            for ysym in fetch_syms:
                try:
                    last = df[ysym]["Close"].dropna().iloc[-1]
                    if float(last) > 0:
                        prices[plain_of[ysym]] = float(last)
                except Exception:
                    pass
    except Exception as e:
        print(f"[market] Yahoo batch error: {e}")

    # 2. 逐个尝试获取盘后/盘前价并覆盖
    extended_count = 0
    for ysym in fetch_syms:
        try:
            ticker = yf.Ticker(ysym)
            info = ticker.info
            ext_price = None
            if info.get("postMarketPrice"):
                ext_price = float(info["postMarketPrice"])
            elif info.get("preMarketPrice"):
                ext_price = float(info["preMarketPrice"])
            if ext_price and ext_price > 0:
                prices[plain_of[ysym]] = ext_price
                extended_count += 1
        except Exception:
            pass

    if extended_count:
        print(f"[market] Yahoo extended-hours prices for {extended_count} symbols")
    return prices


def _fetch_polygon_prices(symbols, api_key):
    prices = {}
    if not api_key or not symbols:
        return prices
    for sym in symbols:
        try:
            resp = requests.get(
                f"https://api.polygon.io/v2/aggs/ticker/{sym}/prev",
                params={"apiKey": api_key},
                timeout=10,
            )
            data = resp.json()
            results = data.get("results", [])
            if results:
                price = results[0].get("c")
                if price is not None and float(price) > 0:
                    prices[sym] = float(price)
        except Exception as e:
            print(f"[market] Polygon error for {sym}: {e}")
    return prices


def _fetch_webull_prices(symbols):
    """使用 webull 非官方库获取美股/中概股实时价格（无需 API Key）。"""
    prices = {}
    if not symbols:
        return prices
    try:
        from webull import webull
    except ImportError:
        print("[market] webull not installed, skipping Webull fallback")
        return prices
    wb = webull()
    for sym in symbols:
        try:
            resp = wb.get_quote(sym)
            price = resp.get('close')
            if price is not None and float(price) > 0:
                prices[sym] = float(price)
        except Exception as e:
            print(f"[market] Webull error for {sym}: {e}")
    return prices


def _fetch_tradier_prices(symbols, api_key):
    """Tradier API：支持美股/ETF/期权实时行情。免费个人账户可用。"""
    prices = {}
    if not api_key or not symbols:
        return prices
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    base_url = "https://api.tradier.com/v1/markets/quotes"

    def _to_tradier_sym(sym):
        # IB symbol: "AAPL 260417C00250000" -> Tradier: "AAPL260417C00250000"
        if " " in sym and len(sym.split(" ", 1)[1]) >= 7:
            return sym.replace(" ", "")
        return sym

    batch = ",".join([_to_tradier_sym(s) for s in symbols])
    try:
        resp = requests.get(base_url, params={"symbols": batch}, headers=headers, timeout=15)
        data = resp.json()
        quotes = data.get("quotes", {})
        quote_list = quotes.get("quote", [])
        if isinstance(quote_list, dict):
            quote_list = [quote_list]
        for q in quote_list:
            sym = q.get("symbol", "").replace(" ", "")
            # 优先 last，fallback bid/ask midpoint
            price = q.get("last")
            if price is None:
                bid = safe_float(q.get("bid"))
                ask = safe_float(q.get("ask"))
                if bid and ask:
                    price = round((bid + ask) / 2, 2)
            if price is not None and float(price) > 0:
                # Tradier 期权 symbol 格式是 AAPL260417C00250000，加回空格和 IB 对齐
                ib_sym = sym
                if len(sym) > 15 and any(c in sym for c in ["C", "P"]):
                    # AAPL260417C00250000 -> AAPL 260417C00250000
                    idx = 0
                    for i, ch in enumerate(sym):
                        if ch.isdigit():
                            idx = i
                            break
                    if idx > 0:
                        ib_sym = sym[:idx] + " " + sym[idx:]
                prices[ib_sym] = float(price)
    except Exception as e:
        print(f"[market] Tradier batch error: {e}")
    return prices


def _fetch_alpaca_prices(symbols, api_key):
    """Alpaca free tier: use their trade API. api_key here is actually the key pair 'PKID:SECRET'."""
    prices = {}
    if not api_key or not symbols or ":" not in api_key:
        return prices
    key_id, secret = api_key.split(":", 1)
    headers = {"APCA-API-KEY-ID": key_id, "APCA-API-SECRET-KEY": secret}
    for sym in symbols:
        try:
            resp = requests.get(
                f"https://data.alpaca.markets/v2/stocks/{sym}/trades/latest",
                headers=headers,
                timeout=10,
            )
            data = resp.json()
            trade = data.get("trade", {})
            price = trade.get("p")
            if price is not None and float(price) > 0:
                prices[sym] = float(price)
        except Exception as e:
            print(f"[market] Alpaca error for {sym}: {e}")
    return prices


# ------------------------------------------------------------------
# Main orchestrator
# ------------------------------------------------------------------
def get_unique_symbols(user_id=None):
    """返回所有需要刷新价格的 symbol 列表（当前持仓中的股票/ETF，不含期权）。"""
    if user_id:
        rows = execute(
            "SELECT DISTINCT symbol FROM positions WHERE user_id = %s AND asset_type IN ('STOCK','ETF')",
            (user_id,),
        )
    else:
        rows = execute(
            "SELECT DISTINCT symbol FROM positions WHERE asset_type IN ('STOCK','ETF')"
        )
    return [r["symbol"] for r in rows if r["symbol"]]


def _get_users_with_positions():
    rows = execute("SELECT DISTINCT user_id FROM positions")
    return [str(r["user_id"]) for r in rows if r["user_id"]]


def update_market_prices(user_id=None):
    """按配置顺序拉取实时价格并写入 market_prices 表。"""
    target_users = [user_id] if user_id else _get_users_with_positions()
    for uid in target_users:
        settings = _load_settings(uid)
        configured_sources = settings.get("sources", ["finnhub", "yahoo"])

        raw_symbols = get_unique_symbols(uid)
        symbols = [s for s in raw_symbols if _is_equity_symbol(s)]
        skipped = [s for s in raw_symbols if not _is_equity_symbol(s)]
        if skipped:
            print(f"[market] Skipped non-equity symbols for {uid}: {skipped}")
        if not symbols:
            print(f"[market] No equity symbols to update for {uid}.")
            continue

        print(f"[market] Updating {len(symbols)} symbols for user {uid}...")
        fetched = {}

        for src_name in configured_sources:
            src_cfg = settings.get(src_name, {})
            if not src_cfg.get("enabled"):
                continue
            missing = [s for s in symbols if s not in fetched]
            if not missing:
                break
            print(f"[market] Trying {src_name} for {len(missing)} symbols...")
            if src_name == "finnhub":
                prices = _fetch_finnhub_prices(missing, src_cfg.get("api_key", ""))
            elif src_name == "yahoo":
                prices = _fetch_yahoo_prices(missing)
            elif src_name == "polygon":
                prices = _fetch_polygon_prices(missing, src_cfg.get("api_key", ""))
            elif src_name == "webull":
                prices = _fetch_webull_prices(missing)
            elif src_name == "tradier":
                equity_missing = [s for s in symbols if s not in fetched]
                option_rows = execute(
                    "SELECT DISTINCT symbol FROM positions WHERE user_id = %s AND asset_type = 'OPTION'",
                    (uid,),
                )
                option_symbols = [r["symbol"] for r in option_rows if r["symbol"]]
                all_missing = equity_missing + option_symbols
                prices = _fetch_tradier_prices(all_missing, src_cfg.get("api_key", ""))
            elif src_name == "alpaca":
                prices = _fetch_alpaca_prices(missing, src_cfg.get("api_key", ""))
            else:
                prices = {}
            for sym, price in prices.items():
                fetched[sym] = (price, src_name)

        # Write to DB (personal mode: ignore user_id in PK)
        with get_cursor() as cur:
            # 动态检测 market_prices 主键，以适配不同 schema
            try:
                cur.execute("""
                    SELECT a.attname
                    FROM pg_index i
                    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                    WHERE i.indrelid = 'market_prices'::regclass
                      AND i.indisprimary
                    ORDER BY array_position(i.indkey, a.attnum)
                """)
                pk_cols = [r[0] for r in cur.fetchall()]
                conflict_target = ", ".join(f'"{c}"' for c in pk_cols) if pk_cols else '"symbol"'
            except Exception:
                conflict_target = '"symbol"'

            for sym, (price, src_name) in fetched.items():
                cur.execute(
                    f"""
                    INSERT INTO market_prices (symbol, price, updated_at, source, user_id)
                    VALUES (%s, %s, NOW(), %s, %s)
                    ON CONFLICT ({conflict_target}) DO UPDATE SET
                        price = EXCLUDED.price,
                        updated_at = EXCLUDED.updated_at,
                        source = EXCLUDED.source,
                        user_id = EXCLUDED.user_id
                    """,
                    (sym, price, src_name, uid),
                )

        print(f"[market] Updated {len(fetched)} equity prices for {uid}.")

        # Update option prices via Yahoo Finance option chains
        option_rows = execute(
            "SELECT DISTINCT symbol FROM positions WHERE user_id = %s AND asset_type = 'OPTION'",
            (uid,)
        )
        option_symbols = [r["symbol"] for r in option_rows if r["symbol"]]
        if option_symbols:
            print(f"[market] Updating {len(option_symbols)} option prices via Yahoo for {uid}...")
            option_prices = _fetch_yahoo_option_prices(option_symbols)
            if option_prices:
                with get_cursor() as cur:
                    for sym, price in option_prices.items():
                        cur.execute(
                            f"""
                            INSERT INTO market_prices (symbol, price, updated_at, source, user_id)
                            VALUES (%s, %s, NOW(), %s, %s)
                            ON CONFLICT ({conflict_target}) DO UPDATE SET
                                price = EXCLUDED.price,
                                updated_at = EXCLUDED.updated_at,
                                source = EXCLUDED.source,
                                user_id = EXCLUDED.user_id
                            """,
                            (sym, price, "yahoo-options", uid),
                        )
                print(f"[market] Updated {len(option_prices)} option prices for {uid}.")

        if fetched:
            _regenerate_dashboards_for_user(uid)
            _invalidate_dashboard_cache(uid)


def _regenerate_dashboards_for_user(user_id):
    """股价更新后自动重新生成 Dashboard JSON。"""
    import json
    import os
    # SaaS: market_data.py lives at project root (/opt/ib_dashboard/), so one dirname
    # gives the project dir. Personal variant sits under scripts/ and still uses two.
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(data_dir, exist_ok=True)
    try:
        from scripts import postgres_to_dashboard as pgdash
        from db.postgres_client import execute
        rows = execute("SELECT DISTINCT account_id FROM daily_nav WHERE user_id = %s", (user_id,))
        aliases = [r['account_id'] for r in rows] if rows else []
        for alias in aliases:
            try:
                data = pgdash.generate_dashboard_data(user_id, alias)
                if data:
                    path = os.path.join(data_dir, f"dashboard_{alias}_{user_id}.json")
                    with open(path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
                    print(f"[market] Regenerated dashboard for {alias}")
            except Exception as e:
                print(f"[market] Dashboard regen failed for {alias}: {e}")
        # combined
        try:
            data = pgdash.generate_dashboard_data(user_id, 'combined')
            if data:
                path = os.path.join(data_dir, f"dashboard_combined_{user_id}.json")
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False, default=str)
                print(f"[market] Regenerated dashboard for combined")
        except Exception as e:
            print(f"[market] Dashboard regen failed for combined: {e}")
    except Exception as e:
        print(f"[market] Dashboard regen error: {e}")


def _invalidate_dashboard_cache(user_id):
    """清除 Redis 中的 dashboard 缓存。"""
    try:
        import redis
        redis_conn = redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
        pattern = f"dashboard:{user_id}:*"
        for key in redis_conn.scan_iter(match=pattern):
            redis_conn.delete(key)
    except Exception:
        pass


def scheduled_update_all():
    """Cron / scheduler entry point: update all users."""
    if not _is_us_market_open():
        print(f"[market] US market is closed today ({date.today()}), skip update.")
        return
    update_market_prices()


if __name__ == "__main__":
    scheduled_update_all()
