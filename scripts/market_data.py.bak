#!/usr/bin/env python3
"""实时行情拉取：Finnhub + Yahoo Finance fallback。"""

import os
import sys
import time
import requests
import re
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from db.postgres_client import get_cursor, execute


def _is_us_market_open(d: date = None) -> bool:
    """判断美股是否开盘（仅简单排除周末和常见法定假日，不调休）。"""
    d = d or date.today()
    # 周末休市
    if d.weekday() >= 5:
        return False
    # 固定日期假日（简化版，不考虑调休）
    fixed_holidays = {(1, 1), (6, 19), (7, 4), (12, 25)}
    if (d.month, d.day) in fixed_holidays:
        return False
    # 周一假日：MLK（1月第3个周一）、总统日（2月第3个周一）、阵亡将士纪念日（5月最后一个周一）、劳动节（9月第一个周一）
    if d.weekday() == 0:
        if d.month == 1 and 15 <= d.day <= 21:
            return False
        if d.month == 2 and 15 <= d.day <= 21:
            return False
        if d.month == 5 and d.day >= 25:
            return False
        if d.month == 9 and d.day <= 7:
            return False
    # 周四假日：感恩节（11月第4个周四）
    if d.weekday() == 3 and d.month == 11 and 22 <= d.day <= 28:
        return False
    # 耶稣受难日（Good Friday）通常在3月或4月的一个周五，日期不固定，简单排除3-4月部分周五不够准，这里暂不处理
    return True


def _is_equity_symbol(sym):
    """过滤掉明显是期权、债券的 symbol，只保留股票/ETF。"""
    if not sym:
        return False
    # 排除含空格的期权/债券代码，如 "T 3 07/15/25"
    if ' ' in sym:
        return False
    # 排除纯数字的债券 CUSIP
    if re.match(r'^\d+$', sym):
        return False
    return True

FINNHUB_API_KEY = os.environ.get("FINNHUB_API_KEY", "d2paoqhr01qnhraqbfn0d2paoqhr01qnhraqbfng")


def _fetch_finnhub_prices(symbols):
    """Batch fetch stock quotes from Finnhub. Free tier: 60 calls/minute."""
    prices = {}
    if not FINNHUB_API_KEY or not symbols:
        return prices
    for sym in symbols:
        try:
            resp = requests.get(
                "https://finnhub.io/api/v1/quote",
                params={"symbol": sym, "token": FINNHUB_API_KEY},
                timeout=10,
            )
            data = resp.json()
            price = data.get("c")
            if price is not None and float(price) > 0:
                prices[sym] = float(price)
        except Exception as e:
            print(f"[market] Finnhub error for {sym}: {e}")
        time.sleep(1.05)  # stay under 60 calls/minute
    return prices


def _fetch_yahoo_prices(symbols):
    """Fallback using yfinance for any missing symbols."""
    prices = {}
    try:
        import yfinance as yf
    except ImportError:
        return prices

    for sym in symbols:
        try:
            ticker = yf.Ticker(sym)
            info = ticker.info or {}
            price = info.get("regularMarketPrice") or info.get("previousClose")
            if price is not None and float(price) > 0:
                prices[sym] = float(price)
        except Exception as e:
            print(f"[market] Yahoo error for {sym}: {e}")
    return prices


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
    """返回所有有持仓的用户 ID 列表。"""
    rows = execute("SELECT DISTINCT user_id FROM positions")
    return [str(r["user_id"]) for r in rows if r["user_id"]]


def update_market_prices(user_id=None):
    """拉取实时价格并写入 market_prices 表。"""
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
        finnhub_prices = _fetch_finnhub_prices(symbols)

        missing = [s for s in symbols if s not in finnhub_prices]
        yahoo_prices = {}
        if missing:
            print(f"[market] Finnhub missed {len(missing)} symbols, trying Yahoo...")
            yahoo_prices = _fetch_yahoo_prices(missing)

        with get_cursor() as cur:
            for sym, price in finnhub_prices.items():
                cur.execute(
                    """
                    INSERT INTO market_prices (user_id, symbol, price, updated_at, source)
                    VALUES (%s, %s, %s, NOW(), %s)
                    ON CONFLICT (user_id, symbol) DO UPDATE SET
                        price = EXCLUDED.price,
                        updated_at = EXCLUDED.updated_at,
                        source = EXCLUDED.source
                    """,
                    (uid, sym, price, "finnhub"),
                )
            for sym, price in yahoo_prices.items():
                cur.execute(
                    """
                    INSERT INTO market_prices (user_id, symbol, price, updated_at, source)
                    VALUES (%s, %s, %s, NOW(), %s)
                    ON CONFLICT (user_id, symbol) DO UPDATE SET
                        price = EXCLUDED.price,
                        updated_at = EXCLUDED.updated_at,
                        source = EXCLUDED.source
                    """,
                    (uid, sym, price, "yahoo"),
                )
        print(f"[market] Updated {len(finnhub_prices) + len(yahoo_prices)} prices for {uid}.")


def scheduled_update_all():
    """Cron / scheduler entry point: update all users."""
    if not _is_us_market_open():
        print(f"[market] US market is closed today ({date.today()}), skip update.")
        return
    update_market_prices()


if __name__ == "__main__":
    scheduled_update_all()
