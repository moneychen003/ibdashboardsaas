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
    "sources": ["finnhub", "yahoo"],
    "finnhub": {"enabled": True, "api_key": os.environ.get("FINNHUB_API_KEY", "")},
    "yahoo": {"enabled": True, "api_key": ""},
    "polygon": {"enabled": False, "api_key": ""},
    "alpaca": {"enabled": False, "api_key": ""}
}


def _load_settings():
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


def _fetch_yahoo_prices(symbols):
    """Fallback using yfinance batch download (much faster than per-ticker .info)."""
    prices = {}
    if not symbols:
        return prices
    try:
        import yfinance as yf
    except ImportError:
        print("[market] yfinance not installed, skipping Yahoo fallback")
        return prices

    try:
        df = yf.download(
            symbols,
            period="5d",
            interval="1d",
            group_by="ticker",
            progress=False,
            threads=True,
        )
        # yfinance returns a MultiIndex DataFrame for multiple tickers,
        # and a flat DataFrame for a single ticker.
        if len(symbols) == 1:
            sym = symbols[0]
            try:
                last = df["Close"].dropna().iloc[-1]
                if float(last) > 0:
                    prices[sym] = float(last)
            except Exception:
                pass
        else:
            for sym in symbols:
                try:
                    last = df[sym]["Close"].dropna().iloc[-1]
                    if float(last) > 0:
                        prices[sym] = float(last)
                except Exception as e:
                    print(f"[market] Yahoo error for {sym}: {e}")
    except Exception as e:
        print(f"[market] Yahoo batch error: {e}")
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
    settings = _load_settings()
    configured_sources = settings.get("sources", ["finnhub", "yahoo"])

    target_users = [user_id] if user_id else _get_users_with_positions()
    for uid in target_users:
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
            elif src_name == "alpaca":
                prices = _fetch_alpaca_prices(missing, src_cfg.get("api_key", ""))
            else:
                prices = {}
            for sym, price in prices.items():
                fetched[sym] = (price, src_name)

        # Write to DB
        with get_cursor() as cur:
            for sym, (price, src_name) in fetched.items():
                cur.execute(
                    """
                    INSERT INTO market_prices (user_id, symbol, price, updated_at, source)
                    VALUES (%s, %s, %s, NOW(), %s)
                    ON CONFLICT (user_id, symbol) DO UPDATE SET
                        price = EXCLUDED.price,
                        updated_at = EXCLUDED.updated_at,
                        source = EXCLUDED.source
                    """,
                    (uid, sym, price, src_name),
                )
        print(f"[market] Updated {len(fetched)} prices for {uid}.")


def scheduled_update_all():
    """Cron / scheduler entry point: update all users."""
    if not _is_us_market_open():
        print(f"[market] US market is closed today ({date.today()}), skip update.")
        return
    update_market_prices()


if __name__ == "__main__":
    scheduled_update_all()
