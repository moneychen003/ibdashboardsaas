"""MCP (Model Context Protocol) HTTP server.

Implements JSON-RPC 2.0 dispatch for tools/list + tools/call. Designed for
streamable_http transport (Claude Desktop, Cursor, ChatGPT Desktop with mcp-remote).

8 read-only tools expose IB Dashboard data so an LLM can query holdings, trades,
portfolios, wheel cycles, option PnL, etc., without copy-pasting CSVs.
"""
import datetime
import json
from typing import Any, Dict, List, Optional

PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "ib-dashboard"
SERVER_VERSION = "1.0.0"

TOOLS: List[Dict[str, Any]] = [
    {
        "name": "get_overview",
        "description": "Account snapshot: total NAV, balanceBreakdown (cash/stocks/options), risk metrics (Sharpe/volatility/drawdown), base currency, asOfDate. Use this for 'how much do I have / current value / total assets'.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "account": {"type": "string", "description": "Account alias or 'combined'", "default": "combined"}
            },
        },
    },
    {
        "name": "get_period_returns",
        "description": "Returns for standard periods: 1W (1 week), MTD (month-to-date), 1M, 3M, YTD (year-to-date), 1Y (last 12 months), All (since inception). Each entry has: startNav, endNav, gain (absolute $), gainPct (%), netFlow (deposits-withdrawals). Use this for 'how much did I gain last year / YTD / this month'.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "account": {"type": "string", "default": "combined"}
            },
        },
    },
    {
        "name": "get_yearly_returns",
        "description": "Calendar-year returns aggregated from daily NAV history. Returns each year's start/end NAV, gain $, gain %, net deposits. Use for 'returns by year / 2024 vs 2025 / which year was best'.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "account": {"type": "string", "default": "combined"}
            },
        },
    },
    {
        "name": "get_monthly_returns",
        "description": "Monthly returns + monthly trade statistics (count, win rate, realized P&L). Use for 'best/worst months / monthly heatmap'.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "account": {"type": "string", "default": "combined"},
                "months": {"type": "integer", "description": "Number of recent months", "default": 24, "maximum": 60}
            },
        },
    },
    {
        "name": "get_dividends",
        "description": "Dividend income history: per-symbol cash dividend payments. Use for 'dividend income / which stocks pay dividends / total dividend last year'.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "account": {"type": "string", "default": "combined"},
                "limit": {"type": "integer", "default": 100, "maximum": 500}
            },
        },
    },
    {
        "name": "get_tax_summary",
        "description": "Tax view: YTD realized gains (long-term + short-term breakdown), unrealized gain estimates by holding period, estimated tax liability at 4 rate brackets (China 0% / US 22%/32%/37%). Use for 'tax estimation / capital gains / how much tax do I owe'.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "account": {"type": "string", "default": "combined"}
            },
        },
    },
    {
        "name": "get_strategy_breakdown",
        "description": "Option strategy classification breakdown: count + total notional + premium per strategy type (CSP / CC / spreads / iron condor / wheel / etc). Use for 'how am I distributed across option strategies / what's my wheel exposure'.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_holdings",
        "description": "Current holdings (stocks/ETFs/options) with market value, quantity, cost basis, fx_rate.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "account": {"type": "string", "default": "combined"},
                "asset_type": {
                    "type": "string",
                    "enum": ["stocks", "etfs", "options", "all"],
                    "default": "all",
                },
            },
        },
    },
    {
        "name": "get_portfolios",
        "description": "User-defined portfolios with holdings, target percentages, current values, deviation, rebalance advice, concentration alerts.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_wheel_cycles",
        "description": "Wheel strategy tracker: cumulative net P&L, premium income, PUT assignments / CC called away counts per underlying. Annualized return.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_holding_trades",
        "description": "Full trade history for a stock/ETF symbol with diluted cost trajectory after each event (buy/sell/option premium).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "Stock or ETF symbol, e.g. 'QQQ', 'LI'"}
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "get_recent_trades",
        "description": "Recent trades across all symbols within last N days.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "default": 30, "minimum": 1, "maximum": 365},
                "limit": {"type": "integer", "default": 100, "maximum": 500},
            },
        },
    },
    {
        "name": "get_option_pnl_timeline",
        "description": "Monthly net option premium income timeline + breakdown by underlying (top 20).",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "search_symbol",
        "description": "Search a symbol/keyword in current holdings. Returns matched positions with cost, qty, value.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search keyword (case-insensitive substring)"}
            },
            "required": ["query"],
        },
    },
    # ===== Tier 1 advanced tools =====
    {
        "name": "get_symbol_full_context",
        "description": "ONE-SHOT comprehensive analysis of a single symbol: current position + cost basis (FIFO/diluted) + recent trades + wheel cycle history + same-underlying options + realtime price. Use when user asks 'analyze X / how is X doing / full picture of X'.",
        "inputSchema": {
            "type": "object",
            "properties": {"symbol": {"type": "string", "description": "Stock/ETF symbol (e.g. 'LI', 'QQQ')"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "suggest_sell_put_candidates",
        "description": "Heuristic-based candidates for selling cash-secured PUTs: looks at current holdings (you'd be willing to add to existing positions) + cash available. Ranks by: stock you already own (would extend position), is wheel underlying (track record), reasonable size. Returns recommended underlyings to consider for sell-PUT (does NOT recommend specific strikes/expirations).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "max_candidates": {"type": "integer", "default": 10, "maximum": 20}
            },
        },
    },
    {
        "name": "get_cash_flow",
        "description": "Cash flow timeline aggregated from archive_cash_transaction: deposits / withdrawals / dividends / interest / commissions / taxes. Returns monthly buckets + grand totals. Use for 'how much did I deposit / interest income / commissions paid'.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "months": {"type": "integer", "default": 12, "maximum": 60}
            },
        },
    },
    {
        "name": "get_winners_losers",
        "description": "Top winners + losers ranked by historical realized P&L (preferred) or net trade flow (fallback). Use for 'best/worst trades / which stocks made me the most money'.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 10, "maximum": 30}
            },
        },
    },
    {
        "name": "get_open_options_risk",
        "description": "Risk profile of currently open options: DTE buckets (0-7d / 7-30d / 30-90d / 90+d), ITM vs OTM analysis (strike vs current price), total notional short PUT/CALL exposure. Use for 'how much option risk do I have / when do options expire / am I over-leveraged'.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_position_changes",
        "description": "Position changes since N days ago (using daily snapshots). New positions, closed positions, increased / decreased holdings. Note: snapshot data only available since 2026-04-27.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "default": 7, "maximum": 90}
            },
        },
    },
    # ===== Tier 2 mid-value tools =====
    {
        "name": "get_realtime_price",
        "description": "Current realtime price for a symbol (from market_prices table, refreshed every 30 min via Yahoo/Finnhub).",
        "inputSchema": {
            "type": "object",
            "properties": {"symbol": {"type": "string"}},
            "required": ["symbol"],
        },
    },
    {
        "name": "compare_periods",
        "description": "Compare returns of two arbitrary date ranges. Useful for 'YTD vs same period last year / Q3 vs Q4 / before vs after a specific date'.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "from1": {"type": "string", "description": "Period 1 start, ISO date YYYY-MM-DD"},
                "to1": {"type": "string", "description": "Period 1 end"},
                "from2": {"type": "string", "description": "Period 2 start"},
                "to2": {"type": "string", "description": "Period 2 end"},
            },
            "required": ["from1", "to1", "from2", "to2"],
        },
    },
    {
        "name": "get_drawdown_periods",
        "description": "Top N drawdown periods (peak to trough) sorted by depth. Useful for 'when was my worst losing streak / max drawdown history'.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 5, "maximum": 20}
            },
        },
    },
    {
        "name": "get_assignment_history",
        "description": "Historical option Exercise/Assignment/Expiration events from archive_option_eae. Use for 'how many times did I get assigned / which PUTs got exercised / wheel history detail'.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "underlying": {"type": "string", "description": "Optional underlying filter"},
                "limit": {"type": "integer", "default": 100, "maximum": 500}
            },
        },
    },
    {
        "name": "get_account_metadata",
        "description": "Account info: opening date (from earliest trade), days active, base currency, available accounts/aliases, user profile preferences.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_available_accounts",
        "description": "List all IB account aliases/IDs the user has imported, with summary stats per account (latest NAV, asOfDate, total trades).",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def _content(data: Any) -> Dict[str, Any]:
    """Wrap data into MCP tools/call response content format."""
    text = json.dumps(data, indent=2, default=str, ensure_ascii=False)
    if len(text) > 200_000:
        text = text[:200_000] + "\n... (truncated)"
    return {"content": [{"type": "text", "text": text}]}


def _err(msg: str) -> Dict[str, Any]:
    return {"isError": True, "content": [{"type": "text", "text": f"Error: {msg}"}]}


def call_tool(name: str, args: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    if not user_id:
        return _err("missing user_id")
    try:
        # Lazy imports to keep cold start fast
        import sys
        sys.path.insert(0, "/opt/ibdashboardpersonal/scripts") if "ibdashboardpersonal" in sys.path[0] else sys.path.insert(0, "/opt/ib_dashboard/scripts")
        import scripts.postgres_to_dashboard as pgdash  # type: ignore
        from db import portfolios as pf  # type: ignore
        from db.postgres_client import execute, execute_one  # type: ignore

        if name == "get_overview":
            account = args.get("account") or "combined"
            data = pgdash.generate_dashboard_data(user_id, account)
            if not data:
                return _err("no dashboard data")
            return _content({
                "totalNav": (data.get("summary") or {}).get("totalNav"),
                "asOfDate": data.get("asOfDate"),
                "baseCurrency": data.get("baseCurrency"),
                "metrics": data.get("metrics"),
                "balanceBreakdown": data.get("balanceBreakdown"),
                "summary": data.get("summary"),
            })

        if name == "get_period_returns":
            account = args.get("account") or "combined"
            data = pgdash.generate_dashboard_data(user_id, account)
            if not data:
                return _err("no dashboard data")
            rs = data.get("rangeSummaries") or {}
            label_map = {
                "nav1Week": "1W", "navMTD": "MTD", "nav1Month": "1M",
                "nav3Months": "3M", "navYTD": "YTD", "nav1Year": "1Y",
                "navAll": "AllTime",
            }
            out = {}
            for k, label in label_map.items():
                v = rs.get(k) or {}
                out[label] = {
                    "label": label,
                    "startNav": v.get("startNav"),
                    "endNav": v.get("endNav"),
                    "gain": v.get("gain"),
                    "gainPct": v.get("gainPct"),
                    "rawGain": v.get("rawGain"),
                    "rawGainPct": v.get("rawGainPct"),
                    "netFlow": v.get("netFlow"),
                    "fromDate": v.get("fromDate"),
                    "toDate": v.get("toDate"),
                }
            return _content({
                "asOfDate": data.get("asOfDate"),
                "baseCurrency": data.get("baseCurrency"),
                "periods": out,
                "note": "gain = net of deposits/withdrawals; rawGain = raw NAV change; gainPct uses gain/initialCapital basis.",
            })

        if name == "get_yearly_returns":
            account = args.get("account") or "combined"
            data = pgdash.generate_dashboard_data(user_id, account)
            hist = data.get("history") or {}
            nav_all = hist.get("navAll") or []
            if not nav_all:
                return _err("no NAV history (navAll empty)")
            from collections import OrderedDict
            yearly = OrderedDict()
            for h in nav_all:
                if not isinstance(h, dict):
                    continue
                date = h.get("date") or ""
                val = h.get("nav") if "nav" in h else h.get("value")
                if not date or val is None:
                    continue
                year = date[:4]
                if year not in yearly:
                    yearly[year] = {"year": year, "startDate": date, "startNav": val, "endDate": date, "endNav": val}
                yearly[year]["endDate"] = date
                yearly[year]["endNav"] = val
            results = []
            for year, info in yearly.items():
                start = info["startNav"] or 0
                end = info["endNav"] or 0
                gain = end - start
                gain_pct = (gain / start * 100) if start else 0
                results.append({
                    "year": year,
                    "startDate": info["startDate"],
                    "endDate": info["endDate"],
                    "startNav": round(start, 2),
                    "endNav": round(end, 2),
                    "rawGain": round(gain, 2),
                    "rawGainPct": round(gain_pct, 2),
                })
            return _content({"years": results, "note": "rawGain ignores deposits/withdrawals — just NAV start vs end."})

        if name == "get_monthly_returns":
            account = args.get("account") or "combined"
            n = int(args.get("months") or 24)
            data = pgdash.generate_dashboard_data(user_id, account)
            mr = data.get("monthlyReturns") or []
            mts = data.get("monthlyTradeStats") or []
            mts_by_month = {m.get("month"): m for m in mts}
            out = []
            for m in mr[-n:]:
                month = m.get("month")
                row = {"month": month, "twrPct": m.get("twrPct") or m.get("twr"), "navStart": m.get("navStart"), "navEnd": m.get("navEnd"), "gain": m.get("gain")}
                if month in mts_by_month:
                    s = mts_by_month[month]
                    row["tradeCount"] = s.get("tradeCount")
                    row["realizedPnl"] = s.get("realizedPnl")
                    row["winRate"] = s.get("winRate")
                out.append(row)
            return _content({"months": out, "count": len(out)})

        if name == "get_dividends":
            account = args.get("account") or "combined"
            limit = int(args.get("limit") or 100)
            data = pgdash.generate_dashboard_data(user_id, account)
            div = data.get("dividends") or []
            return _content({"dividends": div[:limit], "count": len(div)})

        if name == "get_tax_summary":
            account = args.get("account") or "combined"
            data = pgdash.generate_dashboard_data(user_id, account)
            return _content(data.get("taxView") or {"note": "no tax data"})

        if name == "get_strategy_breakdown":
            data = pgdash.generate_dashboard_data(user_id, "combined")
            pv = data.get("portfolios") or {}
            from collections import defaultdict
            by_strategy = defaultdict(lambda: {"count": 0, "totalValue": 0, "wheelCount": 0, "underlyings": set()})
            for p in (pv.get("portfolios") or []) + (([{"holdings": pv.get("uncategorized", [])}] ) if pv.get("uncategorized") else []):
                for h in (p.get("holdings") or []):
                    if (h.get("assetClass") or "").upper() != "OPTION":
                        continue
                    strat = h.get("strategy") or "unknown"
                    by_strategy[strat]["count"] += 1
                    by_strategy[strat]["totalValue"] += float(h.get("currentValue") or 0)
                    if h.get("isWheel"):
                        by_strategy[strat]["wheelCount"] += 1
                    if h.get("underlying"):
                        by_strategy[strat]["underlyings"].add(h["underlying"])
            result = []
            for k, v in by_strategy.items():
                result.append({
                    "strategy": k,
                    "count": v["count"],
                    "totalValue": round(v["totalValue"], 2),
                    "wheelCount": v["wheelCount"],
                    "underlyings": sorted(v["underlyings"]),
                })
            result.sort(key=lambda x: -x["count"])
            return _content({"strategies": result, "note": "totalValue may be negative for short options."})

        if name == "get_holdings":
            account = args.get("account") or "combined"
            asset_type = args.get("asset_type") or "all"
            data = pgdash.generate_dashboard_data(user_id, account)
            op = data.get("openPositions") or {}
            if asset_type == "all":
                return _content({
                    "stocks": op.get("stocks", []),
                    "etfs": op.get("etfs", []),
                    "options": op.get("options", []),
                })
            return _content(op.get(asset_type, []))

        if name == "get_portfolios":
            data = pgdash.generate_dashboard_data(user_id, "combined")
            pv = data.get("portfolios") or {}
            return _content(pv)

        if name == "get_wheel_cycles":
            return _content(pf.get_wheel_cycles(user_id))

        if name == "get_holding_trades":
            sym = (args.get("symbol") or "").strip().upper()
            if not sym:
                return _err("symbol required")
            return _content(pf.get_holding_trades(user_id, sym, limit=300))

        if name == "get_recent_trades":
            days = int(args.get("days") or 30)
            limit = int(args.get("limit") or 100)
            cutoff = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime("%Y%m%d")
            rows = execute(
                """
                SELECT trade_date, symbol, underlying_symbol, buy_sell, quantity, trade_price,
                       proceeds, asset_category, fifo_pnl_realized, open_close_indicator, currency
                FROM archive_trade
                WHERE user_id = %s AND trade_date >= %s AND trade_date IS NOT NULL
                ORDER BY trade_date DESC, stmt_date DESC
                LIMIT %s
                """,
                (user_id, cutoff, limit),
            )
            trades = [dict(r) for r in rows]
            return _content({"trades": trades, "count": len(trades), "cutoffDate": cutoff})

        if name == "get_option_pnl_timeline":
            return _content(pf.get_option_pnl_timeline(user_id))

        if name == "search_symbol":
            q = (args.get("query") or "").strip().upper()
            if not q:
                return _err("query required")
            data = pgdash.generate_dashboard_data(user_id, "combined")
            op = data.get("openPositions") or {}
            results = []
            for bucket in ("stocks", "etfs", "options"):
                for h in (op.get(bucket) or []):
                    sym = (h.get("symbol") or "").upper()
                    desc = (h.get("description") or "").upper()
                    if q in sym or q in desc:
                        results.append({**h, "bucket": bucket})
            pv = data.get("portfolios") or {}
            for u in (pv.get("uncategorized") or []):
                sym = (u.get("symbol") or "").upper()
                if q in sym:
                    results.append({**u, "bucket": "uncategorized"})
            return _content({"matches": results, "count": len(results)})

        # ===== Tier 1 advanced tools =====

        if name == "get_symbol_full_context":
            sym = (args.get("symbol") or "").strip().upper()
            if not sym:
                return _err("symbol required")
            data = pgdash.generate_dashboard_data(user_id, "combined")
            op = data.get("openPositions") or {}
            current_position = None
            for bucket in ("stocks", "etfs"):
                for h in (op.get(bucket) or []):
                    if (h.get("symbol") or "").upper() == sym:
                        current_position = {**h, "bucket": bucket}
                        break
                if current_position:
                    break
            same_underlying_options = []
            for h in (op.get("options") or []):
                ul = (h.get("symbol") or "").split()[0]
                if ul.upper() == sym:
                    same_underlying_options.append(h)
            trades = pf.get_holding_trades(user_id, sym, limit=50)
            wheel = pf.get_wheel_cycles(user_id)
            wheel_entry = next((w for w in (wheel.get("underlyings") or []) if w["underlying"] == sym), None)
            try:
                price_row = execute(
                    "SELECT price, updated_at, source FROM market_prices WHERE symbol=%s ORDER BY updated_at DESC LIMIT 1",
                    (sym,),
                )
                realtime = price_row[0] if price_row else None
            except Exception:
                realtime = None
            return _content({
                "symbol": sym,
                "currentPosition": current_position,
                "openOptionsOnUnderlying": same_underlying_options,
                "wheelStatus": wheel_entry,
                "tradesSummary": trades.get("summary"),
                "recentTrades": (trades.get("trades") or [])[:20],
                "realtimePrice": realtime,
            })

        if name == "suggest_sell_put_candidates":
            max_n = int(args.get("max_candidates") or 10)
            data = pgdash.generate_dashboard_data(user_id, "combined")
            op = data.get("openPositions") or {}
            cash = (data.get("balanceBreakdown") or {}).get("totalCash") or 0
            wheel = pf.get_wheel_cycles(user_id)
            wheel_set = {w["underlying"] for w in (wheel.get("underlyings") or [])}
            candidates = []
            for bucket in ("stocks", "etfs"):
                for h in (op.get(bucket) or []):
                    sym = h.get("symbol") or ""
                    val = h.get("positionValue") or 0
                    if val < 100:
                        continue
                    candidates.append({
                        "symbol": sym,
                        "description": h.get("description"),
                        "currentValue": val,
                        "quantity": h.get("quantity"),
                        "isWheelUnderlying": sym in wheel_set,
                        "score": (2 if sym in wheel_set else 0) + (1 if val > 50000 else 0),
                    })
            candidates.sort(key=lambda c: (-c["score"], -c["currentValue"]))
            candidates = candidates[:max_n]
            return _content({
                "candidates": candidates,
                "availableCash": cash,
                "criteria": "Holdings you'd be willing to add to (you already own them) + wheel underlyings ranked higher.",
                "note": "MCP server doesn't have option chain data — pick a strike 5-10% below current price with 30-45 DTE for typical CSP entry. Use us-options.moneych.top to screen actual contracts.",
            })

        if name == "get_cash_flow":
            n_months = int(args.get("months") or 12)
            from datetime import datetime as _dt, timedelta as _td
            cutoff = (_dt.now() - _td(days=n_months * 31)).strftime("%Y-%m-%d")
            rows = execute(
                """
                SELECT type, currency, SUM(NULLIF(amount, '')::numeric) AS total, COUNT(*) AS n,
                       to_char(stmt_date, 'YYYY-MM') AS month
                FROM archive_cash_transaction
                WHERE user_id = %s AND stmt_date >= %s::date
                  AND (level_of_detail = 'DETAIL' OR level_of_detail IS NULL OR level_of_detail = '')
                GROUP BY 1, 2, 5
                ORDER BY 5 DESC, 1
                """,
                (user_id, cutoff),
            )
            from collections import defaultdict
            by_month = defaultdict(lambda: {"month": None, "deposits": 0, "withdrawals": 0,
                                             "dividends": 0, "interest": 0, "commissions": 0,
                                             "taxes": 0, "other": 0})
            grand = {"deposits": 0, "withdrawals": 0, "dividends": 0, "interest": 0, "commissions": 0, "taxes": 0, "other": 0}
            for r in rows:
                t = (r.get("type") or "").lower()
                amt = float(r.get("total") or 0)
                m = r.get("month") or "unknown"
                by_month[m]["month"] = m
                key = ("deposits" if "deposit" in t else
                       "withdrawals" if "withdraw" in t else
                       "dividends" if "dividend" in t else
                       "interest" if "interest" in t else
                       "commissions" if "commission" in t else
                       "taxes" if "tax" in t or "withholding" in t else
                       "other")
                by_month[m][key] += amt
                grand[key] += amt
            months = sorted(by_month.values(), key=lambda x: x["month"], reverse=True)
            for m in months:
                for k in m:
                    if k != "month":
                        m[k] = round(m[k], 2)
            grand = {k: round(v, 2) for k, v in grand.items()}
            return _content({"months": months, "totals": grand, "lookbackMonths": n_months})

        if name == "get_winners_losers":
            limit = int(args.get("limit") or 10)
            rows = execute(
                """
                SELECT symbol, SUM(NULLIF(fifo_pnl_realized, '')::numeric) AS realized,
                       SUM(NULLIF(proceeds, '')::numeric) AS net_proceeds,
                       COUNT(*) AS trade_count
                FROM archive_trade
                WHERE user_id = %s AND symbol IS NOT NULL
                GROUP BY symbol
                ORDER BY realized DESC NULLS LAST
                """,
                (user_id,),
            )
            ranked = [dict(r) for r in rows]
            for r in ranked:
                r["realized"] = float(r["realized"]) if r.get("realized") is not None else 0
                r["net_proceeds"] = float(r["net_proceeds"]) if r.get("net_proceeds") is not None else 0
                r["trade_count"] = int(r["trade_count"] or 0)
            has_realized = any(abs(r["realized"]) > 0.01 for r in ranked)
            metric = "fifo_pnl_realized" if has_realized else "net_proceeds (premium income)"
            sort_key = "realized" if has_realized else "net_proceeds"
            ranked.sort(key=lambda r: -r[sort_key])
            return _content({
                "winners": ranked[:limit],
                "losers": [r for r in ranked[::-1] if r[sort_key] < 0][:limit],
                "metric": metric,
                "note": "If fifo_pnl_realized is missing (IB Flex export), falls back to net proceeds (sell - buy + premium).",
            })

        if name == "get_open_options_risk":
            data = pgdash.generate_dashboard_data(user_id, "combined")
            op = data.get("openPositions") or {}
            options = op.get("options") or []
            from datetime import datetime as _dt, date
            today = date.today()
            buckets = {"0-7d": [], "7-30d": [], "30-90d": [], "90d+": []}
            short_put_notional = 0.0
            short_call_notional = 0.0
            itm_count = 0
            otm_count = 0
            stock_prices = {}
            for h in (op.get("stocks") or []) + (op.get("etfs") or []):
                if h.get("symbol") and h.get("markPrice"):
                    stock_prices[h["symbol"]] = float(h["markPrice"])

            from db.option_strategy import parse_occ
            for opt in options:
                sym = opt.get("symbol") or ""
                qty = opt.get("quantity") or 0
                p = parse_occ(sym)
                if not p:
                    continue
                ul = p["underlying"]
                strike = p["strike"]
                right = p["right"]
                dte = (p["expiry"] - today).days
                if qty < 0 and right == "P":
                    short_put_notional += abs(qty) * strike
                elif qty < 0 and right == "C":
                    short_call_notional += abs(qty) * strike
                cur_price = stock_prices.get(ul) or 0
                if cur_price > 0:
                    if right == "P":
                        is_itm = cur_price < strike
                    else:
                        is_itm = cur_price > strike
                    if is_itm:
                        itm_count += 1
                    else:
                        otm_count += 1
                bucket = ("0-7d" if dte <= 7 else "7-30d" if dte <= 30 else "30-90d" if dte <= 90 else "90d+")
                buckets[bucket].append({
                    "symbol": sym, "underlying": ul, "right": right, "strike": strike,
                    "dte": dte, "quantity": qty, "currentValue": opt.get("positionValue"),
                    "currentPrice": cur_price,
                })
            total_nav = (data.get("summary") or {}).get("totalNav") or 0
            return _content({
                "byDteBuckets": buckets,
                "shortPutNotional": round(short_put_notional, 2),
                "shortCallNotional": round(short_call_notional, 2),
                "totalNotional": round(short_put_notional + short_call_notional, 2),
                "leverage": round((short_put_notional + short_call_notional) / total_nav, 2) if total_nav else None,
                "totalNav": total_nav,
                "openOptionsCount": len(options),
                "itmCount": itm_count,
                "otmCount": otm_count,
            })

        if name == "get_position_changes":
            n_days = int(args.get("days") or 7)
            from datetime import date, timedelta
            cutoff = (date.today() - timedelta(days=n_days)).isoformat()
            rows = execute(
                """
                SELECT symbol, asset_type,
                       SUM(CASE WHEN snapshot_date = (SELECT MAX(snapshot_date) FROM user_position_snapshots WHERE user_id=%s) THEN quantity ELSE 0 END) AS now_qty,
                       SUM(CASE WHEN snapshot_date = (SELECT MAX(snapshot_date) FROM user_position_snapshots WHERE user_id=%s AND snapshot_date <= %s) THEN quantity ELSE 0 END) AS then_qty,
                       SUM(CASE WHEN snapshot_date = (SELECT MAX(snapshot_date) FROM user_position_snapshots WHERE user_id=%s) THEN position_value_in_base ELSE 0 END) AS now_value,
                       SUM(CASE WHEN snapshot_date = (SELECT MAX(snapshot_date) FROM user_position_snapshots WHERE user_id=%s AND snapshot_date <= %s) THEN position_value_in_base ELSE 0 END) AS then_value
                FROM user_position_snapshots
                WHERE user_id = %s
                GROUP BY symbol, asset_type
                """,
                (user_id, user_id, cutoff, user_id, user_id, cutoff, user_id),
            )
            changes = []
            for r in rows:
                now_q = float(r.get("now_qty") or 0)
                then_q = float(r.get("then_qty") or 0)
                if abs(now_q - then_q) < 0.01 and now_q == then_q:
                    continue
                if then_q == 0 and now_q > 0:
                    change_type = "new_position"
                elif then_q > 0 and now_q == 0:
                    change_type = "closed_position"
                elif now_q > then_q:
                    change_type = "increased"
                elif now_q < then_q:
                    change_type = "decreased"
                else:
                    continue
                changes.append({
                    "symbol": r["symbol"],
                    "assetType": r["asset_type"],
                    "changeType": change_type,
                    "qtyBefore": then_q,
                    "qtyNow": now_q,
                    "qtyDelta": now_q - then_q,
                    "valueBefore": float(r.get("then_value") or 0),
                    "valueNow": float(r.get("now_value") or 0),
                })
            changes.sort(key=lambda c: -abs(c["qtyDelta"]))
            return _content({
                "changes": changes,
                "count": len(changes),
                "lookbackDays": n_days,
                "note": "Position snapshots only available since 2026-04-27. If lookback exceeds available data, returns full history.",
            })

        # ===== Tier 2 mid-value tools =====

        if name == "get_realtime_price":
            sym = (args.get("symbol") or "").strip().upper()
            if not sym:
                return _err("symbol required")
            row = execute(
                "SELECT symbol, price, updated_at, source FROM market_prices WHERE symbol=%s ORDER BY updated_at DESC LIMIT 1",
                (sym,),
            )
            if not row:
                return _content({"symbol": sym, "price": None, "note": "no realtime data — symbol may not be in market_prices table or refresh hasn't run"})
            return _content(dict(row[0]))

        if name == "compare_periods":
            from datetime import datetime as _dt
            f1 = args.get("from1"); t1 = args.get("to1")
            f2 = args.get("from2"); t2 = args.get("to2")
            if not all([f1, t1, f2, t2]):
                return _err("from1, to1, from2, to2 required")
            data = pgdash.generate_dashboard_data(user_id, "combined")
            hist = (data.get("history") or {}).get("navAll") or []
            def find_at(target):
                # Find closest history entry on or after target
                for h in hist:
                    if h.get("date", "") >= target:
                        return h
                return hist[-1] if hist else None
            def find_before(target):
                last = None
                for h in hist:
                    if h.get("date", "") <= target:
                        last = h
                    else:
                        break
                return last
            def period_summary(start, end):
                a = find_at(start); b = find_before(end)
                if not a or not b:
                    return None
                sn = a.get("nav") or 0; en = b.get("nav") or 0
                return {
                    "from": start, "to": end,
                    "startDate": a.get("date"), "endDate": b.get("date"),
                    "startNav": sn, "endNav": en,
                    "rawGain": round(en - sn, 2),
                    "rawGainPct": round((en - sn) / sn * 100, 2) if sn else 0,
                }
            p1 = period_summary(f1, t1); p2 = period_summary(f2, t2)
            return _content({"period1": p1, "period2": p2,
                             "diffPct": round((p1["rawGainPct"] - p2["rawGainPct"]), 2) if p1 and p2 else None})

        if name == "get_drawdown_periods":
            limit = int(args.get("limit") or 5)
            data = pgdash.generate_dashboard_data(user_id, "combined")
            hist = (data.get("history") or {}).get("navAll") or []
            if not hist:
                return _err("no NAV history")
            drawdowns = []
            peak = None; peak_date = None
            cur_dd_start = None
            for h in hist:
                nav = h.get("nav"); date = h.get("date")
                if nav is None or date is None:
                    continue
                if peak is None or nav >= peak:
                    if cur_dd_start and peak:
                        drawdowns.append({
                            "peakDate": cur_dd_start["peakDate"],
                            "peakNav": cur_dd_start["peakNav"],
                            "troughDate": cur_dd_start["troughDate"],
                            "troughNav": cur_dd_start["troughNav"],
                            "recoveryDate": date,
                            "drawdownPct": round((cur_dd_start["troughNav"] - cur_dd_start["peakNav"]) / cur_dd_start["peakNav"] * 100, 2),
                            "drawdownAbs": round(cur_dd_start["troughNav"] - cur_dd_start["peakNav"], 2),
                        })
                    peak = nav; peak_date = date; cur_dd_start = None
                else:
                    if cur_dd_start is None:
                        cur_dd_start = {"peakDate": peak_date, "peakNav": peak, "troughDate": date, "troughNav": nav}
                    elif nav < cur_dd_start["troughNav"]:
                        cur_dd_start["troughDate"] = date
                        cur_dd_start["troughNav"] = nav
            if cur_dd_start and peak:
                drawdowns.append({
                    "peakDate": cur_dd_start["peakDate"], "peakNav": cur_dd_start["peakNav"],
                    "troughDate": cur_dd_start["troughDate"], "troughNav": cur_dd_start["troughNav"],
                    "recoveryDate": None, "ongoing": True,
                    "drawdownPct": round((cur_dd_start["troughNav"] - cur_dd_start["peakNav"]) / cur_dd_start["peakNav"] * 100, 2),
                    "drawdownAbs": round(cur_dd_start["troughNav"] - cur_dd_start["peakNav"], 2),
                })
            drawdowns.sort(key=lambda d: d["drawdownPct"])
            return _content({"drawdowns": drawdowns[:limit], "count": len(drawdowns)})

        if name == "get_assignment_history":
            ul_filter = (args.get("underlying") or "").strip().upper() or None
            limit = int(args.get("limit") or 100)
            sql = """
                SELECT date, underlying_symbol, transaction_type, put_call, description,
                       strike, expiry, quantity, cost_basis, currency
                FROM archive_option_eae
                WHERE user_id = %s
                  AND transaction_type IN ('Assignment', 'Exercise', 'Expiration')
            """
            params = [user_id]
            if ul_filter:
                sql += " AND underlying_symbol = %s"
                params.append(ul_filter)
            sql += " ORDER BY date DESC LIMIT %s"
            params.append(limit)
            rows = execute(sql, tuple(params))
            return _content({"events": [dict(r) for r in rows], "count": len(rows)})

        if name == "get_account_metadata":
            data = pgdash.generate_dashboard_data(user_id, "combined")
            history_range = data.get("historyRange") or {}
            row = execute_one(
                "SELECT MIN(trade_date) AS first_trade, MAX(trade_date) AS last_trade, COUNT(*) AS trade_count FROM archive_trade WHERE user_id = %s",
                (user_id,),
            )
            profile = execute_one(
                "SELECT base_currency, max_history_months, max_accounts FROM user_profiles WHERE user_id = %s",
                (user_id,),
            ) or {}
            return _content({
                "userId": user_id,
                "baseCurrency": data.get("baseCurrency"),
                "historyRange": history_range,
                "firstTradeDate": row.get("first_trade") if row else None,
                "lastTradeDate": row.get("last_trade") if row else None,
                "tradeCount": int(row.get("trade_count") or 0) if row else 0,
                "profile": dict(profile) if profile else None,
                "metrics": data.get("metrics"),
            })

        if name == "list_available_accounts":
            rows = execute(
                """
                SELECT account_id, MAX(date) AS latest_date, COUNT(DISTINCT date) AS days_with_data
                FROM positions
                WHERE user_id = %s
                GROUP BY account_id
                ORDER BY latest_date DESC
                """,
                (user_id,),
            )
            accounts = [dict(r) for r in rows]
            for a in accounts:
                tr = execute_one(
                    "SELECT COUNT(*) AS n FROM archive_trade WHERE user_id = %s AND stmt_account_id = %s",
                    (user_id, a["account_id"]),
                )
                a["tradeCount"] = int(tr.get("n") or 0) if tr else 0
            return _content({"accounts": accounts, "count": len(accounts), "combinedAvailable": True})

        return _err(f"unknown tool: {name}")
    except Exception as e:
        import traceback
        return _err(f"{type(e).__name__}: {e}\n{traceback.format_exc()[:1000]}")


def handle_jsonrpc(req: Dict[str, Any], user_id: str) -> Optional[Dict[str, Any]]:
    method = req.get("method", "")
    msg_id = req.get("id")
    params = req.get("params") or {}

    # Notifications (no response)
    if method.startswith("notifications/"):
        return None

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            },
        }

    if method == "ping":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {}}

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS}}

    if method == "tools/call":
        name = params.get("name") or ""
        args = params.get("arguments") or {}
        result = call_tool(name, args, user_id)
        return {"jsonrpc": "2.0", "id": msg_id, "result": result}

    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }
