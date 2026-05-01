"""User-defined portfolios — shared CRUD helpers for personal + SaaS.

Tables (see schema.sql):
- user_portfolios            (id, user_id, name, color, sort_order, target_pct, is_cash, notes)
- user_portfolio_holdings    (portfolio_id, user_id, symbol, asset_class, target_pct_within, added_at)

Constraint: UNIQUE (user_id, symbol) in user_portfolio_holdings — one symbol can only belong
to a single portfolio per user.
"""
from db.postgres_client import execute, execute_one
import psycopg2


def _serialize(row):
    if not row:
        return None
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "color": row.get("color"),
        "sortOrder": row.get("sort_order", 0) or 0,
        "targetPct": float(row["target_pct"]) if row.get("target_pct") is not None else None,
        "isCash": bool(row.get("is_cash")),
        "autoRule": row.get("auto_rule"),
        "notes": row.get("notes"),
        "holdings": row.get("holdings") or [],
    }


def list_portfolios(user_id):
    rows = execute(
        """
        SELECT p.id, p.name, p.color, p.sort_order, p.target_pct, p.is_cash, p.auto_rule, p.notes,
               COALESCE((
                   SELECT json_agg(json_build_object(
                       'symbol', h.symbol,
                       'assetClass', h.asset_class,
                       'targetPctWithin', h.target_pct_within,
                       'source', h.source
                   ) ORDER BY h.added_at)
                   FROM user_portfolio_holdings h WHERE h.portfolio_id = p.id
               ), '[]'::json) AS holdings
        FROM user_portfolios p
        WHERE p.user_id = %s
        ORDER BY p.sort_order, p.name
        """,
        (user_id,),
    )
    return [_serialize(r) for r in rows]


def create_portfolio(user_id, name, color=None, target_pct=None, is_cash=False, notes=None, sort_order=None, auto_rule=None):
    name = (name or "").strip()
    if not name:
        raise ValueError("name 必填")
    if sort_order is None:
        max_row = execute_one(
            "SELECT COALESCE(MAX(sort_order), -1) AS m FROM user_portfolios WHERE user_id=%s",
            (user_id,),
        )
        sort_order = (max_row["m"] if max_row else -1) + 1
    try:
        row = execute_one(
            """
            INSERT INTO user_portfolios (user_id, name, color, sort_order, target_pct, is_cash, notes, auto_rule)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, name, color, sort_order, target_pct, is_cash, notes, auto_rule
            """,
            (user_id, name, color or "#6366f1", sort_order, target_pct, bool(is_cash), notes, auto_rule),
        )
    except psycopg2.IntegrityError as e:
        raise ValueError(f"名称已存在: {name}") from e
    return _serialize({**row, "holdings": []})


def update_portfolio(user_id, pid, **fields):
    sets, values = [], []
    column_map = {
        "name": "name",
        "color": "color",
        "target_pct": "target_pct",
        "targetPct": "target_pct",
        "is_cash": "is_cash",
        "isCash": "is_cash",
        "notes": "notes",
        "sort_order": "sort_order",
        "sortOrder": "sort_order",
        "auto_rule": "auto_rule",
        "autoRule": "auto_rule",
    }
    for key, val in fields.items():
        col = column_map.get(key)
        if not col:
            continue
        sets.append(f"{col}=%s")
        if col == "is_cash":
            values.append(bool(val))
        elif col == "sort_order":
            values.append(int(val))
        else:
            values.append(val)
    if not sets:
        return None
    sets.append("updated_at=NOW()")
    values.extend([pid, user_id])
    sql = (
        f"UPDATE user_portfolios SET {', '.join(sets)} "
        f"WHERE id=%s AND user_id=%s "
        f"RETURNING id, name, color, sort_order, target_pct, is_cash, notes, auto_rule"
    )
    try:
        row = execute_one(sql, tuple(values))
    except psycopg2.IntegrityError as e:
        raise ValueError("名称冲突") from e
    return _serialize({**row, "holdings": []}) if row else None


def delete_portfolio(user_id, pid):
    row = execute_one(
        "DELETE FROM user_portfolios WHERE id=%s AND user_id=%s RETURNING id",
        (pid, user_id),
    )
    return bool(row)


def add_holdings(user_id, pid, symbols):
    """symbols: list of {symbol, assetClass} or plain str. Returns {added, conflicts}."""
    p = execute_one(
        "SELECT id FROM user_portfolios WHERE id=%s AND user_id=%s",
        (pid, user_id),
    )
    if not p:
        return None
    added, conflicts = [], []
    for s in symbols or []:
        if isinstance(s, str):
            sym, ac = s, None
        elif isinstance(s, dict):
            sym = s.get("symbol")
            ac = s.get("assetClass")
        else:
            continue
        if not sym:
            continue
        existing = execute_one(
            """
            SELECT h.symbol, p.name FROM user_portfolio_holdings h
            JOIN user_portfolios p ON p.id = h.portfolio_id
            WHERE h.user_id=%s AND h.symbol=%s
            """,
            (user_id, sym),
        )
        if existing:
            conflicts.append({"symbol": sym, "existingPortfolioName": existing["name"]})
            continue
        execute(
            """
            INSERT INTO user_portfolio_holdings (portfolio_id, user_id, symbol, asset_class)
            VALUES (%s, %s, %s, %s)
            """,
            (pid, user_id, sym, ac),
        )
        added.append({"symbol": sym, "assetClass": ac})
    return {"added": added, "conflicts": conflicts}


def remove_holding(user_id, pid, symbol):
    row = execute_one(
        """
        DELETE FROM user_portfolio_holdings
        WHERE portfolio_id=%s AND symbol=%s AND user_id=%s
        RETURNING symbol
        """,
        (pid, symbol, user_id),
    )
    return bool(row)


def add_exclusion(user_id, pid, symbol):
    """Mark a symbol as excluded from a portfolio's auto_rule (so AI auto-matching skips it)."""
    p = execute_one(
        "SELECT id FROM user_portfolios WHERE id=%s AND user_id=%s",
        (pid, user_id),
    )
    if not p:
        return False
    execute(
        """
        INSERT INTO user_portfolio_excludes (portfolio_id, user_id, symbol)
        VALUES (%s, %s, %s)
        ON CONFLICT DO NOTHING
        """,
        (pid, user_id, symbol),
    )
    return True


def get_excludes_by_portfolio(user_id):
    rows = execute(
        "SELECT portfolio_id, symbol FROM user_portfolio_excludes WHERE user_id=%s",
        (user_id,),
    )
    out = {}
    for r in rows:
        pid = str(r["portfolio_id"])
        out.setdefault(pid, set()).add(r["symbol"])
    return out


def get_strategy_overrides(user_id):
    """Return {symbol: override} map (overrides decoupled from portfolios)."""
    rows = execute(
        "SELECT symbol, strategy_override FROM user_holding_strategy_overrides WHERE user_id=%s",
        (user_id,),
    )
    return {r["symbol"]: r["strategy_override"] for r in rows}


def set_strategy_override(user_id, symbol, override):
    """override=None to clear; otherwise UPSERT."""
    if not override:
        execute(
            "DELETE FROM user_holding_strategy_overrides WHERE user_id=%s AND symbol=%s",
            (user_id, symbol),
        )
        return
    execute(
        """
        INSERT INTO user_holding_strategy_overrides (user_id, symbol, strategy_override)
        VALUES (%s, %s, %s)
        ON CONFLICT (user_id, symbol) DO UPDATE
            SET strategy_override = EXCLUDED.strategy_override, updated_at = NOW()
        """,
        (user_id, symbol, override),
    )


PRESETS = [
    {"name": "定投仓位", "color": "#6366f1", "target_pct": 70, "auto_rule": "etf_funds", "is_cash": False},
    {"name": "现金仓位", "color": "#10b981", "target_pct": 5, "auto_rule": None, "is_cash": True},
    {"name": "期权仓位", "color": "#8b5cf6", "target_pct": 20, "auto_rule": "options", "is_cash": False},
    {"name": "个股仓位", "color": "#f59e0b", "target_pct": 5, "auto_rule": "stocks", "is_cash": False},
]


def auto_setup(user_id):
    """One-click: ensure the 4 standard portfolios exist with auto_rule wired up.
    Existing portfolios with the same name are kept (just updated auto_rule + sort_order)."""
    for i, preset in enumerate(PRESETS):
        row = execute_one(
            "SELECT id FROM user_portfolios WHERE user_id=%s AND name=%s",
            (user_id, preset["name"]),
        )
        if row:
            execute(
                "UPDATE user_portfolios SET auto_rule=%s, sort_order=%s, updated_at=NOW() WHERE id=%s",
                (preset["auto_rule"], i, row["id"]),
            )
        else:
            execute(
                """
                INSERT INTO user_portfolios (user_id, name, color, sort_order, target_pct, is_cash, auto_rule)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (user_id, preset["name"], preset["color"], i, preset["target_pct"], preset["is_cash"], preset["auto_rule"]),
            )


def clear_auto_rules(user_id):
    execute("UPDATE user_portfolios SET auto_rule=NULL, updated_at=NOW() WHERE user_id=%s", (user_id,))


def reset_all(user_id):
    execute("DELETE FROM user_portfolios WHERE user_id=%s", (user_id,))


def get_holding_trades(user_id, symbol, limit=500):
    """Return BUY/SELL history for a stock/ETF symbol + same-underlying option trades,
    with running diluted cost after each event.

    Diluted cost = (total_buy_cost - total_sell_proceeds - total_option_premium) / current_qty
    Each row records the diluted cost AFTER applying that event.
    """

    def _f(v):
        try:
            return float(v) if v not in (None, "") else 0.0
        except (ValueError, TypeError):
            return 0.0

    def _fmt_date(d):
        if isinstance(d, str) and len(d) == 8 and d.isdigit():
            return f"{d[:4]}-{d[4:6]}-{d[6:8]}"
        return str(d) if d else None

    stock_rows = execute(
        """
        SELECT trade_date, stmt_date, buy_sell, quantity, trade_price, proceeds, currency,
               asset_category, open_close_indicator, fifo_pnl_realized, notes,
               symbol AS display_symbol
        FROM archive_trade
        WHERE user_id = %s AND symbol = %s AND asset_category IN ('STK', 'ETF')
        ORDER BY trade_date, stmt_date
        """,
        (user_id, symbol),
    )
    option_rows = execute(
        """
        SELECT trade_date, stmt_date, buy_sell, quantity, trade_price, proceeds, currency,
               asset_category, open_close_indicator, fifo_pnl_realized, notes,
               symbol AS display_symbol
        FROM archive_trade
        WHERE user_id = %s AND underlying_symbol = %s AND asset_category = 'OPT'
        ORDER BY trade_date, stmt_date
        """,
        (user_id, symbol),
    )

    all_rows = list(stock_rows) + list(option_rows)
    all_rows.sort(key=lambda r: ((r.get("trade_date") or ""), (r.get("stmt_date") or "")))

    cum_qty = 0.0
    cum_buy_cost = 0.0
    cum_sell_proceeds = 0.0
    cum_option_premium = 0.0  # 累计期权权利金净流入（卖+ 买-）
    realized_pnl = 0.0

    trades_chrono = []
    for r in all_rows:
        qty = _f(r["quantity"])
        price = _f(r["trade_price"])
        proceeds = _f(r["proceeds"])
        bs = (r["buy_sell"] or "").upper()
        cat = (r["asset_category"] or "").upper()
        is_option = cat == "OPT"

        if not is_option:
            if bs == "BUY":
                cum_qty += qty
                cum_buy_cost += abs(proceeds)
            elif bs == "SELL":
                cum_qty -= abs(qty)
                cum_sell_proceeds += proceeds  # positive when selling
                realized_pnl += _f(r.get("fifo_pnl_realized"))
        else:
            # 期权 trade: proceeds 直接进 premium 累计（卖出+，买入-）
            cum_option_premium += proceeds

        # 事件后摊薄成本 = (累计买入 - 卖出收入 - 期权权利金) / 当前持股
        diluted_after = ((cum_buy_cost - cum_sell_proceeds - cum_option_premium) / cum_qty) if cum_qty > 0 else 0.0

        trades_chrono.append({
            "tradeDate": _fmt_date(r.get("trade_date")),
            "buySell": bs,
            "category": "OPT" if is_option else "STK",
            "symbol": r.get("display_symbol"),
            "quantity": qty,
            "tradePrice": price,
            "proceeds": proceeds,
            "currency": r.get("currency"),
            "openClose": r.get("open_close_indicator"),
            "realizedPnl": _f(r.get("fifo_pnl_realized")),
            "notes": r.get("notes"),
            "cumQty": round(cum_qty, 4),
            "dilutedAfter": round(diluted_after, 4),
        })

    # 倒序展示（最新在上）
    trades_desc = list(reversed(trades_chrono))[:limit]

    avg_buy_price = (cum_buy_cost / sum(t["quantity"] for t in trades_chrono if t["category"] == "STK" and t["buySell"] == "BUY")) if any(t["category"] == "STK" and t["buySell"] == "BUY" for t in trades_chrono) else 0.0
    total_buy_qty = sum(t["quantity"] for t in trades_chrono if t["category"] == "STK" and t["buySell"] == "BUY")
    total_sell_qty = sum(abs(t["quantity"]) for t in trades_chrono if t["category"] == "STK" and t["buySell"] == "SELL")
    final_diluted = trades_chrono[-1]["dilutedAfter"] if trades_chrono else 0.0

    return {
        "symbol": symbol,
        "trades": trades_desc,
        "summary": {
            "totalBuyQty": round(total_buy_qty, 4),
            "totalBuyCost": round(cum_buy_cost, 2),
            "avgBuyPrice": round(avg_buy_price, 4) if total_buy_qty else 0,
            "totalSellQty": round(total_sell_qty, 4),
            "totalSellProceeds": round(cum_sell_proceeds, 2),
            "totalOptionPremium": round(cum_option_premium, 2),
            "currentDilutedCost": round(final_diluted, 4),
            "realizedPnl": round(realized_pnl, 2),
            "tradeCount": len(trades_chrono),
        },
    }


def reorder(user_id, ids):
    if not ids:
        return 0
    n = 0
    for i, pid in enumerate(ids):
        row = execute_one(
            "UPDATE user_portfolios SET sort_order=%s WHERE id=%s AND user_id=%s RETURNING id",
            (i, pid, user_id),
        )
        if row:
            n += 1
    return n


def build_portfolios_view(user_id, dashboard_data):
    """Slice generator: 基于 dashboard_data['openPositions'] + balanceBreakdown.totalCash 算占比。

    所有金额统一折算到 USD（不论用户 baseCurrency 是什么），方便统一比较。
    positionValueInBase 是 base currency，除以 fxRates['USD'] 得 USD。
    """
    portfolios_def = list_portfolios(user_id)
    if not portfolios_def:
        return {
            "portfolios": [], "uncategorized": [], "totalNav": 0,
            "unallocatedCash": 0, "hasDefinitions": False, "displayCurrency": "USD",
        }

    open_pos = dashboard_data.get("openPositions") or {}
    all_positions = []
    for bucket in ("stocks", "etfs", "options"):
        for pos in (open_pos.get(bucket) or []):
            all_positions.append(pos)

    by_symbol = {p["symbol"]: p for p in all_positions if p.get("symbol")}
    cash_total_base = (dashboard_data.get("balanceBreakdown") or {}).get("totalCash") or 0
    has_cash_portfolio = any(p["isCash"] for p in portfolios_def)

    fx_rates = dashboard_data.get("fxRates") or {}
    base_currency = dashboard_data.get("baseCurrency") or "USD"
    usd_per_base_rate = fx_rates.get("USD") if base_currency != "USD" else 1.0
    if not usd_per_base_rate or usd_per_base_rate <= 0:
        usd_per_base_rate = 1.0
    base_to_usd = 1.0 / usd_per_base_rate if base_currency != "USD" else 1.0

    cash_total = cash_total_base * base_to_usd

    def _value(pos):
        v = pos.get("positionValueInBase")
        if v is not None:
            return float(v) * base_to_usd
        v = pos.get("positionValue") or 0
        currency = pos.get("currency") or "USD"
        if currency == "USD":
            return float(v)
        rate = fx_rates.get(currency)
        if rate:
            return float(v) * rate * base_to_usd
        return float(v)

    assigned = set()
    out = []
    for p in portfolios_def:
        items, total_value = [], 0.0
        for h in p.get("holdings") or []:
            sym = h.get("symbol")
            if not sym:
                continue
            assigned.add(sym)
            pos = by_symbol.get(sym)
            if pos:
                v = _value(pos)
                items.append({
                    "symbol": sym,
                    "description": pos.get("description"),
                    "assetClass": h.get("assetClass") or pos.get("assetType"),
                    "quantity": pos.get("quantity"),
                    "currentValue": round(v, 2),
                    "markPrice": pos.get("markPrice"),
                    "currency": pos.get("currency"),
                    "avgCostBasisPrice": pos.get("avgCostBasisPrice"),
                    "dilutedCostBasisPrice": pos.get("dilutedCostBasisPrice"),
                    "source": h.get("source") or "manual",
                })
                total_value += v
            else:
                items.append({
                    "symbol": sym,
                    "description": None,
                    "assetClass": h.get("assetClass"),
                    "quantity": 0,
                    "currentValue": 0,
                    "markPrice": None,
                    "currency": None,
                    "stale": True,
                })
        if p["isCash"]:
            items.append({
                "symbol": "__CASH__",
                "description": "账户现金",
                "assetClass": "CASH",
                "quantity": None,
                "currentValue": round(cash_total, 2),
                "markPrice": None,
                "currency": None,
            })
            total_value += cash_total
        out.append({
            "id": p["id"], "name": p["name"], "color": p.get("color"),
            "isCash": p["isCash"], "targetPct": p.get("targetPct"), "notes": p.get("notes"),
            "sortOrder": p.get("sortOrder", 0),
            "holdings": items, "currentValue": round(total_value, 2),
        })

    uncategorized = []
    for pos in all_positions:
        sym = pos.get("symbol")
        if not sym or sym in assigned:
            continue
        uncategorized.append({
            "symbol": sym,
            "description": pos.get("description"),
            "assetClass": pos.get("assetType"),
            "quantity": pos.get("quantity"),
            "currentValue": round(_value(pos), 2),
            "markPrice": pos.get("markPrice"),
            "currency": pos.get("currency"),
            "avgCostBasisPrice": pos.get("avgCostBasisPrice"),
            "dilutedCostBasisPrice": pos.get("dilutedCostBasisPrice"),
        })

    # Auto-categorize: portfolios with `auto_rule` claim matching items from uncategorized
    AUTO_RULE_TO_ASSETS = {
        "etf_funds": {"ETF"},
        "stocks": {"STOCK", "STK"},
        "options": {"OPTION", "OPT"},
    }
    excludes_map = get_excludes_by_portfolio(user_id)
    for p_def, p_out in zip(portfolios_def, out):
        rule = p_def.get("autoRule")
        if not rule:
            continue
        target_classes = AUTO_RULE_TO_ASSETS.get(rule)
        if not target_classes:
            continue
        excluded_symbols = excludes_map.get(p_def["id"], set())
        kept_unc = []
        for u in uncategorized:
            cls = (u.get("assetClass") or "").upper()
            if cls in target_classes and u["symbol"] not in excluded_symbols:
                p_out["holdings"].append({**u, "autoMatched": True})
                p_out["currentValue"] = round((p_out["currentValue"] or 0) + (u.get("currentValue") or 0), 2)
            else:
                kept_unc.append(u)
        uncategorized = kept_unc

    # Sort holdings within each portfolio by currentValue desc (market-value 大到小)
    def _sort_key(h):
        v = h.get("currentValue") or 0
        # __CASH__ always last
        if h.get("symbol") == "__CASH__":
            return (1, 0)
        return (0, -float(v))
    for p_out in out:
        p_out["holdings"] = sorted(p_out.get("holdings") or [], key=_sort_key)
    uncategorized = sorted(uncategorized, key=lambda u: -(u.get("currentValue") or 0))

    # Auto-classify option strategies based on OCC + underlying stock holdings + wheel history
    try:
        from db.option_strategy import classify_strategies, detect_wheel_underlyings, LABELS as OPT_LABELS
        stock_qty_by_symbol = {}
        for pos in all_positions:
            atype = (pos.get("assetType") or "").upper()
            if atype in ("STOCK", "STK", "ETF") and pos.get("symbol"):
                stock_qty_by_symbol[pos["symbol"]] = (
                    stock_qty_by_symbol.get(pos["symbol"], 0) + (pos.get("quantity") or 0)
                )
        all_option_holdings = []
        for p in out:
            for h in (p.get("holdings") or []):
                if (h.get("assetClass") or "").upper() == "OPTION":
                    all_option_holdings.append(h)
        for u in uncategorized:
            if (u.get("assetClass") or "").upper() == "OPTION":
                all_option_holdings.append(u)
        if all_option_holdings:
            wheel_set = detect_wheel_underlyings(user_id)
            classify_strategies(all_option_holdings, stock_qty_by_symbol, wheel_underlyings=wheel_set)
            # Apply user manual overrides last (highest priority)
            overrides = get_strategy_overrides(user_id)
            for h in all_option_holdings:
                ov = overrides.get(h.get("symbol"))
                if not ov:
                    continue
                h["strategyOverride"] = ov
                if ov.startswith("wheel_"):
                    h["strategy"] = ov[6:]
                    h["isWheel"] = True
                else:
                    h["strategy"] = ov
                    if ov not in ("csp", "cc", "naked_put", "naked_call"):
                        h["isWheel"] = False
                h["strategyLabel"] = OPT_LABELS.get(h["strategy"], h["strategy"])
    except Exception as _opt_err:
        print(f"[option strategy] {_opt_err}")

    total_nav = sum(p["currentValue"] for p in out) \
        + sum(p["currentValue"] for p in uncategorized) \
        + (0 if has_cash_portfolio else cash_total)

    for p in out:
        p["currentPct"] = round(p["currentValue"] / total_nav * 100, 2) if total_nav else 0
        if p.get("targetPct") is not None:
            p["deviationPct"] = round(p["currentPct"] - float(p["targetPct"]), 2)

    rebalance_advice = _build_rebalance_advice(out, total_nav)
    concentration_alerts = _build_concentration_alerts(out, uncategorized, total_nav)

    # Account-level risk metrics from dashboard.metrics (passthrough)
    metrics = dashboard_data.get("metrics") or {}
    risk_metrics = {
        "annualizedReturn": metrics.get("annualizedReturn"),
        "annualizedVolatility": metrics.get("annualizedVolatility"),
        "sharpeRatio": metrics.get("sharpeRatio"),
        "sortinoRatio": metrics.get("sortinoRatio"),
        "calmarRatio": metrics.get("calmarRatio"),
        "maxDrawdown": metrics.get("maxDrawdown"),
        "maxConsecutiveWinMonths": metrics.get("maxConsecutiveWinMonths"),
        "maxConsecutiveLossMonths": metrics.get("maxConsecutiveLossMonths"),
    }

    return {
        "portfolios": out,
        "uncategorized": uncategorized,
        "unallocatedCash": 0 if has_cash_portfolio else round(cash_total, 2),
        "totalNav": round(total_nav, 2),
        "hasDefinitions": True,
        "displayCurrency": "USD",
        "rebalanceAdvice": rebalance_advice,
        "concentrationAlerts": concentration_alerts,
        "accountRiskMetrics": risk_metrics,
    }


def _build_rebalance_advice(out, total_nav):
    items = []
    total_abs_gap = 0.0
    if total_nav <= 0:
        return {"totalGap": 0, "items": []}
    for p in out:
        tp = p.get("targetPct")
        if tp is None:
            continue
        target_value = float(tp) / 100 * total_nav
        gap = target_value - (p.get("currentValue") or 0)
        if abs(gap) < 200:  # ignore tiny diffs
            continue
        items.append({
            "portfolioId": p["id"],
            "portfolioName": p["name"],
            "color": p.get("color"),
            "currentValue": p.get("currentValue"),
            "targetValue": round(target_value, 2),
            "gap": round(gap, 2),
            "action": "buy" if gap > 0 else "sell",
        })
        total_abs_gap += abs(gap)
    return {
        "totalGap": round(total_abs_gap, 2),
        "items": sorted(items, key=lambda x: -abs(x["gap"])),
    }


def _build_concentration_alerts(out, uncategorized, total_nav):
    alerts = []
    if total_nav <= 0:
        return alerts

    # 1) Single portfolio > 50% of NAV
    for p in out:
        pct = (p.get("currentValue") or 0) / total_nav * 100 if total_nav else 0
        if pct > 50:
            alerts.append({
                "level": "high",
                "type": "portfolio_oversize",
                "portfolioName": p["name"],
                "pct": round(pct, 1),
                "message": f"{p['name']} 占总 NAV {pct:.1f}%（>50%），组合过度集中",
            })

    # 2) Single symbol > 20% of NAV
    by_symbol = {}
    for p in out:
        for h in (p.get("holdings") or []):
            sym = h.get("symbol")
            if not sym or sym == "__CASH__":
                continue
            if (h.get("assetClass") or "").upper() == "OPTION":
                continue  # 期权独立看名义敞口，不计入个股集中度
            by_symbol[sym] = by_symbol.get(sym, 0) + (h.get("currentValue") or 0)
    for u in uncategorized:
        sym = u.get("symbol")
        if not sym:
            continue
        if (u.get("assetClass") or "").upper() == "OPTION":
            continue
        by_symbol[sym] = by_symbol.get(sym, 0) + (u.get("currentValue") or 0)
    for sym, val in by_symbol.items():
        pct = abs(val) / total_nav * 100 if total_nav else 0
        if pct > 20:
            alerts.append({
                "level": "high" if pct > 35 else "medium",
                "type": "symbol_oversize",
                "symbol": sym,
                "pct": round(pct, 1),
                "value": round(val, 2),
                "message": f"{sym} 单标的占总 NAV {pct:.1f}%（>20%），集中度过高",
            })

    # 3) Short option notional leverage
    short_put_notional = 0.0
    short_call_notional = 0.0
    all_options = []
    for p in out:
        for h in (p.get("holdings") or []):
            if (h.get("assetClass") or "").upper() == "OPTION":
                all_options.append(h)
    for u in uncategorized:
        if (u.get("assetClass") or "").upper() == "OPTION":
            all_options.append(u)
    for h in all_options:
        qty = h.get("quantity") or 0
        strike = h.get("strikeRaw") or 0
        right = h.get("right")
        if qty < 0 and right == "P":
            short_put_notional += abs(qty) * strike
        elif qty < 0 and right == "C":
            short_call_notional += abs(qty) * strike
    total_notional = short_put_notional + short_call_notional
    leverage = total_notional / total_nav if total_nav else 0
    if leverage > 2:
        alerts.append({
            "level": "high",
            "type": "option_leverage",
            "leverage": round(leverage, 2),
            "putNotional": round(short_put_notional, 0),
            "callNotional": round(short_call_notional, 0),
            "totalNotional": round(total_notional, 0),
            "message": f"期权空头名义敞口 ${total_notional:,.0f}，杠杆 {leverage:.1f}x — 风险偏高",
        })
    elif leverage > 1:
        alerts.append({
            "level": "medium",
            "type": "option_leverage",
            "leverage": round(leverage, 2),
            "putNotional": round(short_put_notional, 0),
            "callNotional": round(short_call_notional, 0),
            "totalNotional": round(total_notional, 0),
            "message": f"期权空头名义敞口 ${total_notional:,.0f}，杠杆 {leverage:.1f}x",
        })

    # Sort: high first
    alerts.sort(key=lambda a: 0 if a["level"] == "high" else 1)
    return alerts


def get_wheel_cycles(user_id):
    """For each wheel-candidate underlying (has Assignment events in EAE),
    summarize cumulative option premium + stock realized PnL + EAE event counts."""
    from db.option_strategy import detect_wheel_underlyings
    wheel_uls = detect_wheel_underlyings(user_id)
    if not wheel_uls:
        return {"underlyings": [], "totalPnl": 0, "totalPremium": 0, "totalAssignments": 0}

    cycles = []
    for ul in sorted(wheel_uls):
        trades = execute(
            """
            SELECT trade_date, asset_category, proceeds, fifo_pnl_realized
            FROM archive_trade
            WHERE user_id = %s
              AND ((asset_category IN ('STK', 'ETF') AND symbol = %s)
                   OR (asset_category = 'OPT' AND underlying_symbol = %s))
            ORDER BY trade_date
            """,
            (user_id, ul, ul),
        )
        eae_rows = execute(
            """
            SELECT transaction_type, put_call, COUNT(*) AS n
            FROM archive_option_eae
            WHERE user_id = %s AND underlying_symbol = %s
            GROUP BY transaction_type, put_call
            """,
            (user_id, ul),
        )

        opt_premium = 0.0
        stock_realized = 0.0
        first_d = None
        last_d = None
        for t in trades:
            try:
                proc = float(t["proceeds"] or 0)
            except Exception:
                proc = 0
            try:
                pnl = float(t["fifo_pnl_realized"] or 0)
            except Exception:
                pnl = 0
            cat = t.get("asset_category")
            if cat == "OPT":
                opt_premium += proc
            elif cat in ("STK", "ETF"):
                stock_realized += pnl
            d = t.get("trade_date")
            if d:
                if not first_d:
                    first_d = d
                last_d = d

        eae_stats = {"put_assigned": 0, "put_expired": 0, "call_assigned": 0, "call_expired": 0}
        for e in eae_rows:
            tt = (e.get("transaction_type") or "").strip()
            pc = (e.get("put_call") or "").strip()
            n = int(e.get("n") or 0)
            if tt == "Assignment" and pc == "P":
                eae_stats["put_assigned"] += n
            elif tt == "Assignment" and pc == "C":
                eae_stats["call_assigned"] += n
            elif tt == "Expiration" and pc == "P":
                eae_stats["put_expired"] += n
            elif tt == "Expiration" and pc == "C":
                eae_stats["call_expired"] += n

        days = 0
        if first_d and last_d and len(first_d) == 8 and len(last_d) == 8:
            try:
                from datetime import datetime
                d1 = datetime.strptime(first_d, "%Y%m%d")
                d2 = datetime.strptime(last_d, "%Y%m%d")
                days = max(1, (d2 - d1).days)
            except Exception:
                pass

        net = opt_premium + stock_realized
        # Annualized return: 用累计权利金 abs 当作"投入资本估算"
        # ann = net / capital_estimate × 365 / days
        capital_est = abs(opt_premium) if abs(opt_premium) > 0 else 1
        annualized = (net / capital_est) * (365.0 / days) * 100 if days > 0 and capital_est > 0 else 0
        cycles.append({
            "underlying": ul,
            "optionPremium": round(opt_premium, 2),
            "stockRealizedPnl": round(stock_realized, 2),
            "netPnl": round(net, 2),
            "annualizedReturnPct": round(annualized, 1),
            "firstTradeDate": (f"{first_d[:4]}-{first_d[4:6]}-{first_d[6:8]}" if first_d and len(first_d) == 8 else first_d),
            "lastTradeDate": (f"{last_d[:4]}-{last_d[4:6]}-{last_d[6:8]}" if last_d and len(last_d) == 8 else last_d),
            "durationDays": days,
            "putAssigned": eae_stats["put_assigned"],
            "putExpired": eae_stats["put_expired"],
            "callAssigned": eae_stats["call_assigned"],
            "callExpired": eae_stats["call_expired"],
            "tradeCount": len(trades),
        })

    cycles.sort(key=lambda c: -c["netPnl"])
    return {
        "underlyings": cycles,
        "totalPnl": round(sum(c["netPnl"] for c in cycles), 2),
        "totalPremium": round(sum(c["optionPremium"] for c in cycles), 2),
        "totalAssignments": sum(c["putAssigned"] + c["callAssigned"] for c in cycles),
    }


def get_unknown_options(user_id):
    """List option contracts that fail OCC parsing or aren't classified into known strategies.
    Useful for finding OCC patterns the parser doesn't handle yet."""
    from db.option_strategy import parse_occ, classify_strategies
    rows = execute(
        """
        SELECT DISTINCT symbol, underlying_symbol, asset_category
        FROM archive_trade
        WHERE user_id = %s AND asset_category = 'OPT' AND symbol IS NOT NULL AND symbol != ''
        ORDER BY symbol
        LIMIT 1000
        """,
        (user_id,),
    )
    parse_failed = []
    parsed_total = 0
    seen = set()
    for r in rows:
        sym = r["symbol"]
        if sym in seen:
            continue
        seen.add(sym)
        p = parse_occ(sym)
        if not p:
            parse_failed.append({
                "symbol": sym,
                "underlying": r.get("underlying_symbol"),
                "reason": "OCC parse failed",
            })
        else:
            parsed_total += 1
    return {
        "parseFailed": parse_failed,
        "parseFailedCount": len(parse_failed),
        "parseSuccessCount": parsed_total,
        "totalScanned": len(seen),
    }


def export_portfolios_csv(user_id):
    """Build a CSV string with all portfolios + holdings for download."""
    import io, csv
    portfolios = list_portfolios(user_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["portfolio_name", "color", "target_pct", "is_cash", "auto_rule", "notes",
                "symbol", "asset_class", "source", "target_pct_within"])
    if not portfolios:
        return buf.getvalue()
    for p in portfolios:
        if not p.get("holdings"):
            w.writerow([p["name"], p.get("color", ""), p.get("targetPct", ""),
                        p.get("isCash", False), p.get("autoRule", ""), p.get("notes", ""),
                        "", "", "", ""])
        for h in (p.get("holdings") or []):
            w.writerow([p["name"], p.get("color", ""), p.get("targetPct", ""),
                        p.get("isCash", False), p.get("autoRule", ""), p.get("notes", ""),
                        h.get("symbol", ""), h.get("assetClass", ""),
                        h.get("source", "manual"), h.get("targetPctWithin", "")])
    return buf.getvalue()


def get_option_pnl_timeline(user_id):
    rows = execute(
        """
        SELECT
            substr(trade_date, 1, 6) AS month,
            underlying_symbol,
            put_call,
            buy_sell,
            SUM(CAST(NULLIF(proceeds, '') AS NUMERIC)) AS net_proceeds,
            SUM(CAST(NULLIF(fifo_pnl_realized, '') AS NUMERIC)) AS realized_pnl,
            COUNT(*) AS trade_count
        FROM archive_trade
        WHERE user_id = %s AND asset_category = 'OPT'
        GROUP BY 1, 2, 3, 4
        ORDER BY 1
        """,
        (user_id,),
    )
    by_month = {}
    by_underlying = {}
    for r in rows:
        m = r["month"]
        if not m:
            continue
        net = float(r["net_proceeds"] or 0)
        pnl = float(r["realized_pnl"] or 0)
        cnt = int(r["trade_count"] or 0)
        if m not in by_month:
            by_month[m] = {
                "month": m,
                "premiumIncome": 0,  # net proceeds (sell - buy)
                "realizedPnl": 0,
                "tradeCount": 0,
            }
        by_month[m]["premiumIncome"] += net
        by_month[m]["realizedPnl"] += pnl
        by_month[m]["tradeCount"] += cnt

        ul = r.get("underlying_symbol") or "?"
        if ul not in by_underlying:
            by_underlying[ul] = {
                "underlying": ul,
                "premiumIncome": 0,
                "realizedPnl": 0,
                "tradeCount": 0,
            }
        by_underlying[ul]["premiumIncome"] += net
        by_underlying[ul]["realizedPnl"] += pnl
        by_underlying[ul]["tradeCount"] += cnt

    months = sorted(by_month.values(), key=lambda x: x["month"])
    for m in months:
        m["premiumIncome"] = round(m["premiumIncome"], 2)
        m["realizedPnl"] = round(m["realizedPnl"], 2)
    underlyings = sorted(by_underlying.values(), key=lambda x: -x["realizedPnl"])
    for u in underlyings:
        u["premiumIncome"] = round(u["premiumIncome"], 2)
        u["realizedPnl"] = round(u["realizedPnl"], 2)

    cumulative_pnl = 0
    for m in months:
        cumulative_pnl += m["realizedPnl"]
        m["cumulativePnl"] = round(cumulative_pnl, 2)

    return {
        "months": months,
        "byUnderlying": underlyings[:20],
        "totalRealizedPnl": round(cumulative_pnl, 2),
        "totalPremiumIncome": round(sum(m["premiumIncome"] for m in months), 2),
    }
