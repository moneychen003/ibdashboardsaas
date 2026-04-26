#!/usr/bin/env python3
"""Daily TG broadcast - send NAV + today's PnL to all subscribed users.

Run via cron at 22:00 local time.
Reads BOT_TOKEN from env (same as tg_bot.service).
"""
import os
import sys
import json
import logging
import asyncio

sys.path.insert(0, "/opt/ib_dashboard")

import telegram
from telegram.constants import ParseMode

from db.postgres_client import execute

BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
DATA_DIR = os.environ.get("DATA_DIR", "/opt/ib_dashboard/data")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("tg_broadcast")


def fmt_cur(v, curr="USD"):
    if v is None:
        return "-"
    try:
        v = float(v)
    except (ValueError, TypeError):
        return "-"
    return f"{curr} {v:,.2f}"


def fmt_pct(v):
    if v is None:
        return "-"
    try:
        v = float(v)
    except (ValueError, TypeError):
        return "-"
    sign = "+" if v >= 0 else ""
    return f"{sign}{v:.2f}%"


def load_dashboard(user_id):
    path = os.path.join(DATA_DIR, f"dashboard_combined_{user_id}.json")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None


def build_message(data):
    summary = data.get("summary", {}) or {}
    cn = data.get("changeInNav", {}) or {}
    curr = data.get("baseCurrency", "USD")
    total_gain = summary.get("totalGain") or 0
    total_gain_pct = summary.get("totalGainPct") or 0
    emoji_total = "📈" if total_gain >= 0 else "📉"

    dp = data.get("dailyPnL") or []
    last_daily = dp[-1] if dp else None
    last_pnl = last_daily.get("pnl") if last_daily else None
    last_date = last_daily.get("date") if last_daily else None

    lines = [
        "🌙 *每日净值播报*",
        "",
        f"总净值：*{fmt_cur(summary.get('totalNav'), curr)}*",
    ]
    if last_pnl is not None:
        em = "🟢" if last_pnl > 0 else ("🔴" if last_pnl < 0 else "⚪")
        d_str = f" ({last_date})" if last_date else ""
        lines.append(f"{em} 当日盈亏{d_str}：{fmt_cur(last_pnl, curr)}")
    lines.append(f"{emoji_total} 累计盈亏：{fmt_cur(total_gain, curr)} ({fmt_pct(total_gain_pct)})")
    lines += [
        "",
        f"YTD 已实现：{fmt_cur(cn.get('realizedYtd'), curr)}",
        f"  长期 {fmt_cur(cn.get('realizedLtYtd'), curr)} · 短期 {fmt_cur(cn.get('realizedStYtd'), curr)}",
        "",
        f"_{data.get('asOfDate', '-')}_",
        "",
        "命令一览发 /start，或 /unsub 取消订阅。",
    ]
    return "\n".join(lines)


async def main():
    rows = execute("SELECT chat_id, user_id FROM user_telegram_bindings WHERE subscribed_daily = TRUE")
    if not rows:
        log.info("No subscribed users.")
        return
    bot = telegram.Bot(token=BOT_TOKEN)
    sent = 0
    failed = 0
    for r in rows:
        chat_id = r["chat_id"]
        user_id = str(r["user_id"])
        data = load_dashboard(user_id)
        if not data:
            log.warning("No dashboard for user %s, skip", user_id[:8])
            continue
        msg = build_message(data)
        try:
            async with bot:
                await bot.send_message(chat_id=chat_id, text=msg, parse_mode=ParseMode.MARKDOWN)
            sent += 1
        except Exception as e:
            failed += 1
            log.warning("send failed chat=%s user=%s: %s", chat_id, user_id[:8], e)
    log.info("Daily broadcast done. sent=%d failed=%d", sent, failed)


if __name__ == "__main__":
    asyncio.run(main())
