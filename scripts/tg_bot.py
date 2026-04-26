#!/usr/bin/env python3
"""IB Dashboard SaaS Telegram Bot - long polling, per-user binding."""
import os
import sys
import json
import logging

sys.path.insert(0, "/opt/ib_dashboard")

import redis
from telegram import Update, BotCommand
from telegram.ext import Application, CommandHandler, ContextTypes
from telegram.constants import ParseMode

from db.postgres_client import get_cursor, execute, execute_one
from scripts import postgres_to_dashboard as pgdash

BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
DATA_DIR = os.environ.get("DATA_DIR", "/opt/ib_dashboard/data")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
SITE_URL = os.environ.get("SITE_URL", "https://moneychen.com")

rds = redis.from_url(REDIS_URL)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
log = logging.getLogger("tg_bot")


# ---- helpers ----

def get_user_by_chat(chat_id):
    rows = execute("SELECT user_id FROM user_telegram_bindings WHERE chat_id = %s", (chat_id,))
    if rows:
        return str(rows[0]["user_id"])
    return None


def load_dashboard(user_id, alias="combined"):
    path = os.path.join(DATA_DIR, f"dashboard_{alias}_{user_id}.json")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    try:
        return pgdash.generate_dashboard_data(user_id, alias)
    except Exception as e:
        log.exception("generate_dashboard_data failed for %s/%s: %s", user_id, alias, e)
        return None


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


async def require_bind(update: Update):
    chat_id = update.effective_chat.id
    user_id = get_user_by_chat(chat_id)
    if not user_id:
        await update.message.reply_text(
            "你还没有绑定 IB Dashboard 账户。\n\n"
            f"请到 {SITE_URL} 登录，在「设置 → Telegram」生成 6 位绑定码，"
            "然后在这里发 `/bind <code>`。",
            parse_mode=ParseMode.MARKDOWN,
        )
        return None
    try:
        with get_cursor() as cur:
            cur.execute(
                "UPDATE user_telegram_bindings SET last_interaction_at = NOW() WHERE chat_id = %s",
                (chat_id,),
            )
    except Exception:
        pass
    return user_id


# ---- handlers ----

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    text = (
        "👋 *欢迎使用 IB Dashboard Bot*\n\n"
        "通过这个 Bot 随时查询自己的 IB 账户数据。\n\n"
        "*📌 第一步：绑定账户*\n"
        f"1. 登录 {SITE_URL}\n"
        "2. 「设置 → Telegram」生成 6 位绑定码\n"
        "3. 这里发 `/bind 123456`\n\n"
        "*💡 可用命令*\n"
        "`/nav` — 当前净值 + 当日 / 累计盈亏\n"
        "`/holdings` — Top 10 持仓（带浮盈）\n"
        "`/cost AAPL` — 查某标的摊薄 / 移动加权成本\n"
        "`/trades` — 最近交易日操作\n"
        "`/pnl7` — 近 7 日盈亏\n"
        "`/tax` — YTD 已实现（长/短期）\n"
        "`/sub` / `/unsub` — 订阅 / 取消每日播报\n"
        "`/status` — 查看绑定状态\n"
        "`/unbind` — 解绑"
    )
    await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)


async def cmd_bind(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not ctx.args:
        await update.message.reply_text(
            "用法：`/bind 123456`\n\n"
            f"到 {SITE_URL} 「设置 → Telegram」生成码。",
            parse_mode=ParseMode.MARKDOWN,
        )
        return
    code = ctx.args[0].strip()
    user_id_bytes = rds.get(f"tgbind:{code}")
    if not user_id_bytes:
        await update.message.reply_text("⚠️ 绑定码无效或已过期（10 分钟有效）。请到网站重新生成。")
        return
    user_id = user_id_bytes.decode()
    chat = update.effective_chat
    user = update.effective_user
    try:
        with get_cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_telegram_bindings
                    (chat_id, user_id, telegram_username, telegram_first_name, bound_at, last_interaction_at)
                VALUES (%s, %s, %s, %s, NOW(), NOW())
                ON CONFLICT (chat_id) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    telegram_username = EXCLUDED.telegram_username,
                    telegram_first_name = EXCLUDED.telegram_first_name,
                    bound_at = NOW(),
                    last_interaction_at = NOW()
                """,
                (chat.id, user_id, user.username, user.first_name),
            )
        rds.delete(f"tgbind:{code}")
        await update.message.reply_text(
            "✅ 绑定成功！\n\n"
            "现在你可以用所有命令查询自己的数据。\n"
            "`/nav` 看当前净值，`/holdings` 看持仓，更多命令 `/start`。",
            parse_mode=ParseMode.MARKDOWN,
        )
    except Exception as e:
        log.exception("bind failed")
        await update.message.reply_text(f"❌ 绑定失败：{e}")


async def cmd_unbind(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    with get_cursor() as cur:
        cur.execute("DELETE FROM user_telegram_bindings WHERE chat_id = %s", (chat_id,))
        removed = cur.rowcount
    if removed:
        await update.message.reply_text("✅ 已解绑。需要再用请发 /bind 重新绑定。")
    else:
        await update.message.reply_text("当前 chat 没有绑定记录。")


async def cmd_status(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    row = execute_one(
        """
        SELECT u.email, b.bound_at, b.subscribed_daily, b.last_interaction_at
        FROM user_telegram_bindings b
        JOIN users u ON u.id = b.user_id
        WHERE b.chat_id = %s
        """,
        (chat_id,),
    )
    if not row:
        await update.message.reply_text("当前未绑定。发 /bind <code> 开始绑定。")
        return
    text = (
        "📋 *绑定状态*\n\n"
        f"账户：`{row['email']}`\n"
        f"绑定时间：{row['bound_at'].strftime('%Y-%m-%d %H:%M') if row['bound_at'] else '-'}\n"
        f"每日播报：{'✅ 已订阅' if row['subscribed_daily'] else '❌ 未订阅'}\n"
        f"上次查询：{row['last_interaction_at'].strftime('%Y-%m-%d %H:%M') if row['last_interaction_at'] else '-'}"
    )
    await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)


async def cmd_nav(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user_id = await require_bind(update)
    if not user_id:
        return
    data = load_dashboard(user_id)
    if not data:
        await update.message.reply_text("暂无数据（可能还没上传任何 XML 报表）。")
        return
    summary = data.get("summary", {})
    cn = data.get("changeInNav", {})
    curr = data.get("baseCurrency", "USD")
    total_gain = summary.get("totalGain") or 0
    total_gain_pct = summary.get("totalGainPct") or 0

    daily_pnl_list = data.get("dailyPnL") or []
    last_daily = daily_pnl_list[-1] if daily_pnl_list else None
    today_pnl = (last_daily or {}).get("pnl") if last_daily else None
    today_date = (last_daily or {}).get("date") if last_daily else None
    today_pnl_flex = (last_daily or {}).get("pnlFlex") if last_daily else None

    lines = [
        "💰 *当前净值*",
        "",
        f"账户：`{data.get('accountId', '-')}`",
        f"总净值：*{fmt_cur(summary.get('totalNav'), curr)}*",
    ]
    if today_pnl is not None:
        em = "🟢" if today_pnl > 0 else ("🔴" if today_pnl < 0 else "⚪")
        d_str = f" ({today_date})" if today_date else ""
        lines.append(f"{em} 当日盈亏{d_str}：{fmt_cur(today_pnl, curr)}")
        if today_pnl_flex is not None and abs(today_pnl_flex - today_pnl) > 0.01:
            lines.append(f"     Flex 口径：{fmt_cur(today_pnl_flex, curr)}")
    emoji_total = "📈" if total_gain >= 0 else "📉"
    lines += [
        f"{emoji_total} 累计盈亏：{fmt_cur(total_gain, curr)} ({fmt_pct(total_gain_pct)})",
        "",
        "*YTD 已实现*",
        f"合计：{fmt_cur(cn.get('realizedYtd'), curr)}",
        f"长期：{fmt_cur(cn.get('realizedLtYtd'), curr)}",
        f"短期：{fmt_cur(cn.get('realizedStYtd'), curr)}",
        "",
        f"更新于 {data.get('asOfDate', '-')}",
    ]
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)


async def cmd_holdings(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user_id = await require_bind(update)
    if not user_id:
        return
    data = load_dashboard(user_id)
    if not data:
        return
    costs = data.get("costBasisHoldings", []) or []
    if not costs:
        await update.message.reply_text("当前无持仓数据。")
        return
    curr = data.get("baseCurrency", "USD")
    top = sorted(costs, key=lambda h: -(float(h.get("currentValue") or 0)))[:10]
    lines = ["📊 *Top 10 持仓*", ""]
    for h in top:
        sym = h.get("symbol", "-")
        cv = h.get("currentValue") or 0
        pnl = h.get("mwaPnl") or 0
        pct = h.get("mwaPct") or 0
        emoji = "🟢" if pnl >= 0 else "🔴"
        lines.append(f"{emoji} `{sym}`  市值 {fmt_cur(cv, curr)}")
        lines.append(f"     浮盈 {fmt_cur(pnl, curr)} ({fmt_pct(pct)})")
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)


async def cmd_cost(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user_id = await require_bind(update)
    if not user_id:
        return
    if not ctx.args:
        await update.message.reply_text("用法：`/cost AAPL`", parse_mode=ParseMode.MARKDOWN)
        return
    sym = ctx.args[0].upper().strip()
    data = load_dashboard(user_id)
    if not data:
        return
    costs = data.get("costBasisHoldings", []) or []
    match = next((h for h in costs if (h.get("symbol") or "").upper() == sym), None)
    if not match:
        await update.message.reply_text(f"没找到 `{sym}`。发 /holdings 看持仓列表。", parse_mode=ParseMode.MARKDOWN)
        return
    curr = data.get("baseCurrency", "USD")
    lines = [
        f"📈 *{match.get('symbol')}*",
        f"{match.get('description') or ''}",
        "",
        f"当前数量：{float(match.get('currentQty') or 0):,.2f}",
        f"当前市值：{fmt_cur(match.get('currentValue'), curr)}",
        f"市价：{fmt_cur(match.get('markPrice'), curr)}",
        "",
        "*移动加权成本*",
        f"成本价：{fmt_cur(match.get('avgCostPrice'), curr)}",
        f"浮盈：{fmt_cur(match.get('mwaPnl'), curr)} ({fmt_pct(match.get('mwaPct'))})",
        "",
        "*摊薄成本*",
        f"成本价：{fmt_cur(match.get('dilutedCostPrice'), curr)}",
        f"浮盈：{fmt_cur(match.get('dilutedPnl'), curr)} ({fmt_pct(match.get('dilutedPct'))})",
    ]
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)


async def cmd_trades(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user_id = await require_bind(update)
    if not user_id:
        return
    data = load_dashboard(user_id)
    if not data:
        return
    lt = data.get("latestDayTrades", {}) or {}
    trades = lt.get("trades", []) or []
    if not trades:
        await update.message.reply_text("最近无交易记录。")
        return
    lines = [f"📝 *最近交易（{lt.get('tradeDate', '-')}）*", ""]
    for t in trades[:20]:
        side_raw = t.get("buySell", "")
        side = "🟢 买入" if side_raw == "BUY" else ("🔴 卖出" if side_raw == "SELL" else side_raw)
        sym = t.get("symbol", "-")
        qty = abs(float(t.get("quantity") or 0))
        price = float(t.get("tradePrice") or 0)
        proceeds = abs(float(t.get("proceeds") or 0))
        cc = t.get("currency", "USD")
        lines.append(f"{side} `{sym}`")
        lines.append(f"     {qty:,.0f} @ {price:.4f} = {fmt_cur(proceeds, cc)}")
        mtm = t.get("mtmPnl")
        if mtm:
            lines.append(f"     MTM {fmt_cur(mtm, cc)}")
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)


async def cmd_pnl7(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user_id = await require_bind(update)
    if not user_id:
        return
    data = load_dashboard(user_id)
    if not data:
        return
    dp = (data.get("dailyPnL") or [])[-7:]
    if not dp:
        await update.message.reply_text("暂无盈亏数据。")
        return
    curr = data.get("baseCurrency", "USD")
    total = sum(float(r.get("pnl") or 0) for r in dp)
    total_flex = sum(float(r.get("pnlFlex") or 0) for r in dp if r.get("pnlFlex") is not None)
    lines = ["📅 *近 7 日盈亏*", ""]
    for r in dp:
        pnl = float(r.get("pnl") or 0)
        mark = "🟢" if pnl > 0 else ("🔴" if pnl < 0 else "⚪")
        flex = r.get("pnlFlex")
        flex_str = f"  Flex {fmt_cur(flex, curr)}" if flex is not None else ""
        lines.append(f"{mark} {r.get('date')}  {fmt_cur(pnl, curr)}{flex_str}")
    lines.append("")
    lines.append(f"合计 *{fmt_cur(total, curr)}*")
    if total_flex:
        lines.append(f"Flex 合计 {fmt_cur(total_flex, curr)}")
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)


async def cmd_tax(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user_id = await require_bind(update)
    if not user_id:
        return
    data = load_dashboard(user_id)
    if not data:
        return
    tv = data.get("taxView", {}) or {}
    curr = data.get("baseCurrency", "USD")
    lines = [
        "🧾 *税务视图 (YTD)*",
        "",
        "*已实现 YTD*",
        f"合计：{fmt_cur(tv.get('realizedYtd'), curr)}",
        f"长期 (>365d)：{fmt_cur(tv.get('realizedLtYtd'), curr)}",
        f"短期 (≤365d)：{fmt_cur(tv.get('realizedStYtd'), curr)}",
        "",
        "*未实现（估算）*",
        f"合计：{fmt_cur(tv.get('unrealizedTotal'), curr)}",
        f"长期：{fmt_cur(tv.get('unrealizedLtEstimate'), curr)}",
        f"短期：{fmt_cur(tv.get('unrealizedStEstimate'), curr)}",
        "",
        f"详情 + 税率估算：{SITE_URL}/combined/tax",
    ]
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)


async def cmd_sub(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    with get_cursor() as cur:
        cur.execute(
            "UPDATE user_telegram_bindings SET subscribed_daily = TRUE WHERE chat_id = %s",
            (chat_id,),
        )
        affected = cur.rowcount
    if affected == 0:
        await update.message.reply_text("请先 /bind 绑定账户。")
        return
    await update.message.reply_text("✅ 已订阅每日净值播报（每天 22:00）。/unsub 取消。")


async def cmd_unsub(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    with get_cursor() as cur:
        cur.execute(
            "UPDATE user_telegram_bindings SET subscribed_daily = FALSE WHERE chat_id = %s",
            (chat_id,),
        )
    await update.message.reply_text("已取消每日播报订阅。")


# ---- main ----

async def post_init(app):
    await app.bot.set_my_commands([
        BotCommand("start", "欢迎 + 命令说明"),
        BotCommand("bind", "绑定账户 /bind <code>"),
        BotCommand("nav", "当前净值 + 当日 / 累计盈亏"),
        BotCommand("holdings", "Top 10 持仓"),
        BotCommand("cost", "查单标的成本 /cost AAPL"),
        BotCommand("trades", "最近交易"),
        BotCommand("pnl7", "近 7 日盈亏"),
        BotCommand("tax", "YTD 已实现"),
        BotCommand("sub", "订阅每日播报"),
        BotCommand("unsub", "取消订阅"),
        BotCommand("status", "绑定状态"),
        BotCommand("unbind", "解绑"),
    ])


def main():
    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()
    handlers = [
        ("start", cmd_start), ("help", cmd_start),
        ("bind", cmd_bind), ("unbind", cmd_unbind), ("status", cmd_status),
        ("nav", cmd_nav), ("holdings", cmd_holdings), ("cost", cmd_cost),
        ("trades", cmd_trades), ("pnl7", cmd_pnl7), ("tax", cmd_tax),
        ("sub", cmd_sub), ("unsub", cmd_unsub),
    ]
    for cmd, handler in handlers:
        app.add_handler(CommandHandler(cmd, handler))
    log.info("IB Dashboard SaaS Bot starting polling...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
