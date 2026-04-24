#!/usr/bin/env python3
"""
Dashboard data extensions - 14 new visualization directions.
All functions accept (conn, account_id=None) and return JSON-serializable dicts/lists.
"""

import sys
import os
from datetime import datetime, timedelta
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
def safe_float(v):
    try:
        if v is None or (isinstance(v, str) and v.strip() == ''):
            return 0.0
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def _acc_clause(acc, col='stmt_account_id'):
    return f"{col} = ?" if acc else "1=1"


def _acc_clause_core(acc, col='account_id'):
    return f"{col} = ?" if acc else "1=1"


def _acc_params(acc):
    return (acc,) if acc else ()


# ------------------------------------------------------------------
# 1. Historical Position Timeline
# ------------------------------------------------------------------
def get_position_timeline(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    # Use archive_open_position for daily snapshots (has position_value and position qty)
    cursor.execute(f'''
        SELECT symbol, MIN(stmt_date) as first_date, MAX(stmt_date) as last_date,
               MAX(CAST(position_value AS REAL)) as peak_value,
               MAX(CAST(position AS REAL)) as peak_qty,
               COUNT(DISTINCT stmt_date) as snapshot_days
        FROM archive_open_position
        WHERE {where} AND symbol IS NOT NULL AND symbol != ''
        GROUP BY symbol
    ''', params)

    holdings = {}
    symbols = []
    for row in cursor.fetchall():
        sym = row[0]
        symbols.append(sym)
        holdings[sym] = {
            'symbol': sym,
            'firstDate': row[1],
            'lastDate': row[2],
            'peakValue': safe_float(row[3]),
            'peakQuantity': safe_float(row[4]),
            'snapshotDays': int(row[5] or 0),
            'timeline': [],
            'transactions': []
        }

    if not symbols:
        return {'symbols': [], 'holdings': {}, 'turnoverRank': [], 'holdingPeriodRank': []}

    placeholders = ','.join(['?'] * len(symbols))
    # Timeline points
    cursor.execute(f'''
        SELECT symbol, stmt_date, CAST(position AS REAL), CAST(position_value AS REAL), CAST(mark_price AS REAL)
        FROM archive_open_position
        WHERE {where} AND symbol IN ({placeholders})
        ORDER BY symbol, stmt_date
    ''', params + tuple(symbols))

    for sym, d, qty, val, mark in cursor.fetchall():
        if sym in holdings:
            qty_f = safe_float(qty)
            val_f = safe_float(val)
            mark_f = safe_float(mark)
            # IB FlexQuery 2026-03 起可能丢 `position` 字段，用 positionValue / markPrice 回推 qty
            if qty_f == 0 and val_f and mark_f:
                qty_f = round(val_f / mark_f, 2)
            holdings[sym]['timeline'].append({
                'date': d,
                'quantity': qty_f,
                'value': val_f,
                'price': mark_f,
                'events': []
            })

    # Overlay transactions (trades)
    cursor.execute(f'''
        SELECT symbol, date_time, buy_sell, CAST(quantity AS REAL), CAST(trade_price AS REAL), CAST(proceeds AS REAL), asset_category
        FROM archive_trade
        WHERE {where} AND symbol IN ({placeholders}) AND date_time IS NOT NULL AND date_time != ''
        ORDER BY symbol, date_time
    ''', params + tuple(symbols))

    for sym, dt, bs, qty, tp, proceeds, cat in cursor.fetchall():
        if sym in holdings:
            holdings[sym]['transactions'].append({
                'date': dt[:8] if len(str(dt)) >= 8 else dt,
                'datetime': dt,
                'side': bs,
                'quantity': safe_float(qty),
                'price': safe_float(tp),
                'proceeds': safe_float(proceeds),
                'assetCategory': cat
            })

    # Overlay corporate actions
    cursor.execute(f'''
        SELECT symbol, date_time, action_description, CAST(amount AS REAL)
        FROM archive_corporate_action
        WHERE {where} AND symbol IN ({placeholders}) AND date_time IS NOT NULL AND date_time != ''
        ORDER BY symbol, date_time
    ''', params + tuple(symbols))

    for sym, dt, action, amt in cursor.fetchall():
        if sym in holdings:
            holdings[sym]['transactions'].append({
                'date': dt[:8] if len(str(dt)) >= 8 else dt,
                'datetime': dt,
                'side': 'CORP_ACTION',
                'quantity': safe_float(amt),
                'price': None,
                'proceeds': None,
                'assetCategory': action
            })

    # Rankings
    turnover_rank = sorted(
        [{'symbol': s, 'transactions': len(h['transactions'])} for s, h in holdings.items()],
        key=lambda x: x['transactions'], reverse=True
    )[:20]

    holding_period_rank = sorted(
        [{
            'symbol': s,
            'firstDate': h['firstDate'],
            'lastDate': h['lastDate'],
            'days': (datetime.strptime(h['lastDate'], '%Y-%m-%d') - datetime.strptime(h['firstDate'], '%Y-%m-%d')).days if h['firstDate'] and h['lastDate'] else 0
        } for s, h in holdings.items()],
        key=lambda x: x['days'], reverse=True
    )[:20]

    return {
        'symbols': symbols,
        'holdings': holdings,
        'turnoverRank': turnover_rank,
        'holdingPeriodRank': holding_period_rank
    }


# ------------------------------------------------------------------
# 2. Order Execution Quality
# ------------------------------------------------------------------
def get_order_execution_quality(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    # archive_order has limited fields in current schema; we'll use what we have + archive_trade
    # Count orders
    cursor.execute(f'''
        SELECT COUNT(*) FROM archive_order WHERE {where}
    ''', params)
    total_orders = cursor.fetchone()[0]

    # Try to get filled vs cancelled if status field exists (it may not)
    # We'll approximate using trade count vs order count
    cursor.execute(f'''
        SELECT COUNT(DISTINCT ib_order_id || '-' || brokerage_order_id) FROM archive_trade WHERE {where}
    ''', params)
    row = cursor.fetchone()
    filled_orders = int(row[0]) if row and row[0] else 0

    # Slippage proxy: compare trade_price vs prior close / open price if available
    # Use trade vs position mark_price on same day as rough benchmark
    acc_where = f"t.stmt_account_id = ?" if account_id else "1=1"
    acc_params = (account_id,) if account_id else ()
    cursor.execute(f'''
        SELECT t.symbol, t.buy_sell, t.trade_price, t.quantity, t.proceeds, p.mark_price
        FROM archive_trade t
        LEFT JOIN archive_open_position p
            ON t.symbol = p.symbol AND t.stmt_account_id = p.stmt_account_id AND t.stmt_date = p.stmt_date
        WHERE {acc_where} AND t.asset_category = 'STK'
        LIMIT 500
    ''', acc_params)
    slippages = []
    for sym, bs, tp, qty, proceeds, mp in cursor.fetchall():
        tpx = safe_float(tp)
        mpx = safe_float(mp)
        if tpx and mpx and mpx > 0:
            slippages.append(round(((tpx - mpx) / mpx) * 100, 4))

    avg_slippage = round(sum(slippages) / len(slippages), 4) if slippages else 0

    # By symbol
    cursor.execute(f'''
        SELECT symbol, COUNT(*) as cnt, AVG(CAST(trade_price AS REAL)) as avg_price
        FROM archive_trade
        WHERE {where} AND symbol IS NOT NULL AND symbol != ''
        GROUP BY symbol
        ORDER BY cnt DESC
        LIMIT 20
    ''', params)
    by_symbol = [{'symbol': r[0], 'tradeCount': r[1], 'avgTradePrice': round(safe_float(r[2]), 4)} for r in cursor.fetchall()]

    # By exchange
    cursor.execute(f'''
        SELECT exchange, COUNT(*) as cnt, AVG(CAST(trade_price AS REAL)) as avg_price
        FROM archive_trade
        WHERE {where} AND exchange IS NOT NULL AND exchange != ''
        GROUP BY exchange
        ORDER BY cnt DESC
        LIMIT 10
    ''', params)
    by_exchange = [{'exchange': r[0], 'tradeCount': r[1], 'avgTradePrice': round(safe_float(r[2]), 4)} for r in cursor.fetchall()]

    # By hour (from date_time YYYYMMDD;HHMMSS)
    cursor.execute(f'''
        SELECT SUBSTR(date_time, 10, 2) as hr, COUNT(*) as cnt
        FROM archive_trade
        WHERE {where} AND date_time IS NOT NULL AND LENGTH(date_time) >= 11
        GROUP BY hr
        ORDER BY hr
    ''', params)
    by_hour = [{'hour': r[0], 'tradeCount': r[1]} for r in cursor.fetchall()]

    return {
        'summary': {
            'totalOrders': total_orders,
            'filledOrders': filled_orders,
            'cancelledOrders': max(0, total_orders - filled_orders),
            'fillRate': round(filled_orders / total_orders * 100, 2) if total_orders else 0,
            'avgSlippagePct': avg_slippage,
            'slippageSampleSize': len(slippages)
        },
        'bySymbol': by_symbol,
        'byExchange': by_exchange,
        'byHour': by_hour
    }


# ------------------------------------------------------------------
# 3. FX Exposure & Contribution
# ------------------------------------------------------------------
def get_fx_exposure(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    # Base currency
    cursor.execute('''
        SELECT currency FROM archive_account_information
        WHERE currency IS NOT NULL AND currency != ''
        ORDER BY stmt_date DESC LIMIT 1
    ''')
    row = cursor.fetchone()
    base_currency = row[0] if row else 'CNH'

    # Latest conversion rates
    cursor.execute('''
        SELECT from_currency, rate FROM archive_conversion_rate
        WHERE to_currency = ?
        ORDER BY report_date DESC, from_currency
    ''', (base_currency,))
    fx_map = {r[0]: safe_float(r[1]) for r in cursor.fetchall() if r[0] and r[1]}

    # Positions by currency with latest values
    cursor.execute(f'''
        SELECT currency, asset_category, SUM(CAST(position_value AS REAL) * COALESCE(CAST(fx_rate_to_base AS REAL), 1.0)) as base_value
        FROM archive_open_position
        WHERE {where} AND stmt_date = (SELECT MAX(stmt_date) FROM archive_open_position WHERE {where})
        GROUP BY currency, asset_category
    ''', params + params)

    pos_by_currency = defaultdict(lambda: {'stock': 0.0, 'etf': 0.0, 'option': 0.0, 'other': 0.0, 'total': 0.0})
    for curr, cat, val in cursor.fetchall():
        curr = (curr or 'USD').upper()
        cat = (cat or 'STK').upper()
        bucket = 'etf' if cat == 'ETF' else ('option' if cat in ('OPT', 'OPTION') else ('stock' if cat in ('STK', 'STOCK') else 'other'))
        pos_by_currency[curr][bucket] += safe_float(val)
        pos_by_currency[curr]['total'] += safe_float(val)

    # Cash by currency
    cursor.execute(f'''
        SELECT currency, ending_cash FROM archive_cash_report_currency
        WHERE {where} AND currency != 'BASE_SUMMARY'
          AND stmt_date = (SELECT MAX(stmt_date) FROM archive_cash_report_currency WHERE {where})
    ''', params + params)

    cash_by_currency = {}
    for curr, ec in cursor.fetchall():
        curr = (curr or 'USD').upper()
        val = safe_float(ec)
        if val is not None:
            cash_by_currency[curr] = val

    # Build breakdown
    all_currencies = set(pos_by_currency.keys()) | set(cash_by_currency.keys())
    currency_breakdown = []
    total_nav_est = 0.0
    for curr in sorted(all_currencies):
        pos_val = pos_by_currency[curr]['total']
        cash_val = cash_by_currency.get(curr, 0.0) or 0.0
        total = pos_val + cash_val
        currency_breakdown.append({
            'currency': curr,
            'positionValue': round(pos_val, 2),
            'cashValue': round(cash_val, 2),
            'totalExposure': round(total, 2),
            'positionStock': round(pos_by_currency[curr]['stock'], 2),
            'positionEtf': round(pos_by_currency[curr]['etf'], 2),
            'positionOption': round(pos_by_currency[curr]['option'], 2),
            'positionOther': round(pos_by_currency[curr]['other'], 2),
        })
        total_nav_est += total

    for item in currency_breakdown:
        item['pctOfNav'] = round((item['totalExposure'] / total_nav_est) * 100, 2) if total_nav_est else 0

    where_core = _acc_clause_core(account_id)
    params_core = _acc_params(account_id)

    # FX contribution: compare current NAV vs what it would be if all positions were at base rate 1.0
    # This is a rough proxy. True decomposition would require historical FX rates.
    cursor.execute(f'''
        SELECT ending_value FROM daily_nav WHERE {where_core} ORDER BY date DESC LIMIT 1
    ''', params_core)
    row = cursor.fetchone()
    actual_nav = safe_float(row[0]) if row else total_nav_est

    # Estimate FX-neutral NAV by summing position values in their original currencies (treating 1 USD = 1 base)
    # This is intentionally simplistic; a better version would use average cost FX rates.
    fx_neutral_nav = sum(c['cashValue'] + c['positionStock'] + c['positionEtf'] + c['positionOther'] for c in currency_breakdown if c['currency'] == base_currency)
    for curr, data in pos_by_currency.items():
        if curr != base_currency:
            # Use the latest FX rate to convert back to "local currency" then treat as 1:1
            rate = fx_map.get(curr, 1.0) or 1.0
            fx_neutral_nav += data['total'] / rate if rate else data['total']

    fx_impact = actual_nav - fx_neutral_nav

    return {
        'baseCurrency': base_currency,
        'currencyBreakdown': currency_breakdown,
        'fxContribution': {
            'actualNav': round(actual_nav, 2),
            'fxNeutralNav': round(fx_neutral_nav, 2),
            'fxImpact': round(fx_impact, 2),
            'impactPct': round((fx_impact / fx_neutral_nav) * 100, 2) if fx_neutral_nav else 0
        },
        'latestFxRates': {k: round(v, 6) for k, v in list(fx_map.items())[:50]}
    }


# ------------------------------------------------------------------
# 4. Securities Lending Income
# ------------------------------------------------------------------
def get_slb_income(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    # Monthly income from fees
    cursor.execute(f'''
        SELECT SUBSTR(stmt_date, 1, 7) as month, SUM(CAST(fee AS REAL)) as total_fee, SUM(CAST(gross_lend_fee AS REAL)) as gross
        FROM archive_slb_fee
        WHERE {where}
        GROUP BY month
        ORDER BY month
    ''', params)
    monthly_income = []
    total_income = 0.0
    for r in cursor.fetchall():
        fee_amt = safe_float(r[1])
        gross_amt = safe_float(r[2])
        amt = fee_amt if fee_amt else gross_amt
        monthly_income.append({'month': r[0], 'income': round(amt, 2)})
        total_income += amt

    # By symbol
    cursor.execute(f'''
        SELECT symbol, SUM(CAST(fee AS REAL)) as fee, SUM(CAST(gross_lend_fee AS REAL)) as gross,
               COUNT(DISTINCT stmt_date) as days, AVG(CAST(fee_rate AS REAL)) as avg_rate
        FROM archive_slb_fee
        WHERE {where} AND symbol IS NOT NULL AND symbol != ''
        GROUP BY symbol
        ORDER BY fee DESC
    ''', params)
    by_symbol = []
    for sym, fee, gross, days, rate in cursor.fetchall():
        fee_amt = safe_float(fee)
        gross_amt = safe_float(gross)
        amt = fee_amt if fee_amt else gross_amt
        # approximate position value for yield calc from latest open contract
        cursor.execute('''
            SELECT CAST(collateral_amount AS REAL) FROM archive_slb_open_contract
            WHERE stmt_account_id = ? AND symbol = ?
            ORDER BY stmt_date DESC LIMIT 1
        ''', (account_id or '', sym))
        _row = cursor.fetchone()
        coll = safe_float(_row[0]) if (account_id and _row) else 0
        by_symbol.append({
            'symbol': sym,
            'income': round(amt, 2),
            'daysLent': days,
            'avgFeeRate': round(safe_float(rate) * 100, 4),
            'collateralAmount': round(coll, 2),
            'yieldPct': round((amt * 252 / max(coll, 1)) * 100, 4) if coll else None
        })

    # Current open contracts
    cursor.execute(f'''
        SELECT symbol, CAST(quantity AS REAL), CAST(collateral_amount AS REAL), CAST(fee_rate AS REAL), currency
        FROM archive_slb_open_contract
        WHERE {where}
          AND stmt_date = (SELECT MAX(stmt_date) FROM archive_slb_open_contract WHERE {where})
    ''', params + params)
    current = []
    for sym, qty, coll, rate, curr in cursor.fetchall():
        daily = safe_float(coll) * safe_float(rate) if coll and rate else 0
        current.append({
            'symbol': sym,
            'quantity': safe_float(qty),
            'collateralAmount': safe_float(coll),
            'feeRate': round(safe_float(rate) * 100, 4) if rate else None,
            'currency': curr,
            'estimatedDailyIncome': round(daily, 2)
        })

    return {
        'monthlyIncome': monthly_income,
        'totalIncome': round(total_income, 2),
        'bySymbol': by_symbol,
        'currentContracts': current
    }


# ------------------------------------------------------------------
# 5. Enhanced Cashflow Waterfall
# ------------------------------------------------------------------
def get_enhanced_cashflow(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    # Cash transactions by month
    cursor.execute(f'''
        SELECT SUBSTR(date_time, 1, 6) as month, type, SUM(CAST(amount AS REAL)) as amt
        FROM archive_cash_transaction
        WHERE {where} AND date_time IS NOT NULL AND date_time != '' AND type IS NOT NULL AND type != ''
        GROUP BY month, type
        ORDER BY month, type
    ''', params)

    monthly = defaultdict(lambda: {
        'deposits': 0.0, 'withdrawals': 0.0, 'dividends': 0.0, 'interest': 0.0,
        'commissions': 0.0, 'fees': 0.0, 'other': 0.0
    })
    for mon, typ, amt in cursor.fetchall():
        t = (typ or '').upper()
        a = safe_float(amt) or 0.0
        if 'DEPOSIT' in t:
            monthly[mon]['deposits'] += a
        elif 'WITHDRAWAL' in t:
            monthly[mon]['withdrawals'] += abs(a)
        elif 'DIVIDEND' in t:
            monthly[mon]['dividends'] += a
        elif 'INTEREST' in t:
            monthly[mon]['interest'] += a
        elif 'COMMISSION' in t:
            monthly[mon]['commissions'] += abs(a)
        elif 'FEE' in t:
            monthly[mon]['fees'] += abs(a)
        else:
            monthly[mon]['other'] += a

    # Trades: net purchase/sale by month
    cursor.execute(f'''
        SELECT SUBSTR(date_time, 1, 6) as month,
               SUM(CASE WHEN buy_sell = 'BUY' THEN ABS(CAST(proceeds AS REAL)) ELSE 0 END) as purchases,
               SUM(CASE WHEN buy_sell = 'SELL' THEN ABS(CAST(proceeds AS REAL)) ELSE 0 END) as sales
        FROM archive_trade
        WHERE {where} AND date_time IS NOT NULL AND date_time != ''
        GROUP BY month
        ORDER BY month
    ''', params)
    trade_flow = {r[0]: {'purchases': safe_float(r[1]), 'sales': safe_float(r[2])} for r in cursor.fetchall()}

    # SLB income by month
    cursor.execute(f'''
        SELECT SUBSTR(stmt_date, 1, 7) as month, SUM(CAST(fee AS REAL)) as fee
        FROM archive_slb_fee
        WHERE {where}
        GROUP BY month
    ''', params)
    slb_income = {r[0].replace('-', ''): safe_float(r[1]) for r in cursor.fetchall()}

    months = sorted(set(monthly.keys()) | set(trade_flow.keys()))
    waterfall = []
    external_flow = []
    for m in months:
        d = monthly.get(m, {
            'deposits': 0.0, 'withdrawals': 0.0, 'dividends': 0.0, 'interest': 0.0,
            'commissions': 0.0, 'fees': 0.0, 'other': 0.0
        })
        t = trade_flow.get(m, {'purchases': 0.0, 'sales': 0.0})
        s = slb_income.get(m, 0.0)
        ending = (
            d['deposits'] - d['withdrawals'] + d['dividends'] + d['interest']
            - d['commissions'] - d['fees'] + d['other']
            - t['purchases'] + t['sales'] + s
        )
        waterfall.append({
            'month': m,
            'deposits': round(d['deposits'], 2),
            'withdrawals': round(d['withdrawals'], 2),
            'dividends': round(d['dividends'], 2),
            'interest': round(d['interest'], 2),
            'slbIncome': round(s, 2),
            'purchases': round(t['purchases'], 2),
            'sales': round(t['sales'], 2),
            'commissions': round(d['commissions'], 2),
            'fees': round(d['fees'], 2),
            'other': round(d['other'], 2),
            'netChange': round(ending, 2)
        })
        external_flow.append({
            'month': m,
            'netExternalFlow': round(d['deposits'] - d['withdrawals'], 2)
        })

    return {
        'monthlyWaterfall': waterfall,
        'externalFlowTrend': external_flow
    }


# ------------------------------------------------------------------
# 6. Trading Behavior Heatmap
# ------------------------------------------------------------------
def get_trading_heatmap(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    cursor.execute(f'''
        SELECT SUBSTR(date_time, 1, 8) as d, SUBSTR(date_time, 10, 2) as hr,
               COUNT(*) as cnt, SUM(ABS(CAST(proceeds AS REAL))) as vol
        FROM archive_trade
        WHERE {where} AND date_time IS NOT NULL AND LENGTH(date_time) >= 11
        GROUP BY d, hr
    ''', params)

    day_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    # SQLite strftime %w: 0=Sun, 1=Mon
    heatmap = defaultdict(lambda: defaultdict(lambda: {'tradeCount': 0, 'tradeValue': 0.0}))
    for d, hr, cnt, vol in cursor.fetchall():
        try:
            dt = datetime.strptime(str(d), '%Y%m%d')
            day_idx = int(dt.strftime('%w'))
            day_name = day_names[day_idx - 1 if day_idx > 0 else 6]
        except Exception:
            continue
        heatmap[day_name][hr]['tradeCount'] += int(cnt)
        heatmap[day_name][hr]['tradeValue'] += safe_float(vol)

    # Flatten for charting
    flat = []
    for day in day_names:
        for hr in [f"{h:02d}" for h in range(24)]:
            cell = heatmap[day].get(hr, {'tradeCount': 0, 'tradeValue': 0.0})
            flat.append({
                'dayOfWeek': day,
                'hour': hr,
                'tradeCount': cell['tradeCount'],
                'tradeValue': round(cell['tradeValue'], 2)
            })

    # Find best/worst slots by a simple heuristic (higher volume = more active)
    active = [x for x in flat if x['tradeCount'] > 0]
    best = sorted(active, key=lambda x: x['tradeValue'], reverse=True)[:5]
    worst = sorted(active, key=lambda x: x['tradeValue'])[:5]

    return {
        'byDayHour': flat,
        'bestSlots': best,
        'worstSlots': worst
    }


# ------------------------------------------------------------------
# 7. Trade Hall of Fame / Shame
# ------------------------------------------------------------------
def get_trade_rankings(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    cursor.execute(f'''
        SELECT symbol, buy_sell, CAST(quantity AS REAL), CAST(trade_price AS REAL),
               CAST(proceeds AS REAL), CAST(fifo_pnl_realized AS REAL), CAST(mtm_pnl AS REAL),
               date_time, asset_category
        FROM archive_trade
        WHERE {where} AND (fifo_pnl_realized IS NOT NULL AND fifo_pnl_realized != ''
                           OR mtm_pnl IS NOT NULL AND mtm_pnl != '')
    ''', params)

    trades = []
    for sym, bs, qty, tp, proceeds, fifo, mtm, dt, cat in cursor.fetchall():
        pnl = safe_float(fifo) if fifo is not None and str(fifo).strip() != '' else safe_float(mtm)
        if pnl is None:
            continue
        trades.append({
            'symbol': sym,
            'side': bs,
            'quantity': safe_float(qty),
            'price': safe_float(tp),
            'proceeds': safe_float(proceeds),
            'pnl': pnl,
            'date': dt,
            'assetCategory': cat
        })

    top_profits = sorted([t for t in trades if t['pnl'] > 0], key=lambda x: x['pnl'], reverse=True)[:10]
    top_losses = sorted([t for t in trades if t['pnl'] < 0], key=lambda x: x['pnl'])[:10]

    # By symbol aggregate
    cursor.execute(f'''
        SELECT symbol, SUM(CAST(fifo_pnl_realized AS REAL)) as fifo_sum, SUM(CAST(mtm_pnl AS REAL)) as mtm_sum
        FROM archive_trade
        WHERE {where}
        GROUP BY symbol
        HAVING fifo_sum IS NOT NULL OR mtm_sum IS NOT NULL
        ORDER BY COALESCE(fifo_sum, mtm_sum) DESC
    ''', params)
    by_symbol = []
    for sym, fifo_sum, mtm_sum in cursor.fetchall():
        fifo_val = safe_float(fifo_sum)
        mtm_val = safe_float(mtm_sum)
        pnl = fifo_val if fifo_val else mtm_val
        by_symbol.append({'symbol': sym, 'totalPnl': round(pnl, 2)})

    return {
        'topProfits': [{**t, 'pnl': round(t['pnl'], 2)} for t in top_profits],
        'topLosses': [{**t, 'pnl': round(t['pnl'], 2)} for t in top_losses],
        'bySymbol': by_symbol
    }


# ------------------------------------------------------------------
# 8. Dividend Tracker
# ------------------------------------------------------------------
def get_dividend_tracker(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    # Historical received dividends
    cursor.execute(f'''
        SELECT pay_date, symbol, CAST(gross_amount AS REAL), CAST(net_amount AS REAL), currency
        FROM archive_change_in_dividend_accrual
        WHERE {where} AND pay_date IS NOT NULL AND pay_date != ''
        ORDER BY pay_date DESC
    ''', params)
    history = []
    monthly = defaultdict(float)
    for pd, sym, gross, net, curr in cursor.fetchall():
        amt = safe_float(net) if net is not None else safe_float(gross)
        mon = str(pd)[:7] if len(str(pd)) >= 7 else str(pd)
        history.append({'payDate': pd, 'symbol': sym, 'amount': round(amt, 2), 'currency': curr})
        monthly[mon] += amt

    # Open (pending) accruals
    cursor.execute(f'''
        SELECT pay_date, symbol, CAST(gross_amount AS REAL), CAST(net_amount AS REAL), currency, ex_date
        FROM archive_open_dividend_accrual
        WHERE {where} AND pay_date IS NOT NULL AND pay_date != ''
        ORDER BY pay_date
    ''', params)
    upcoming = []
    for pd, sym, gross, net, curr, ex in cursor.fetchall():
        amt = safe_float(net) if net is not None else safe_float(gross)
        try:
            pay_dt = datetime.strptime(str(pd), '%Y%m%d') if len(str(pd)) == 8 else datetime.strptime(str(pd), '%Y-%m-%d')
            days_until = (pay_dt - datetime.now()).days
        except Exception:
            days_until = None
        upcoming.append({
            'payDate': pd,
            'exDate': ex,
            'symbol': sym,
            'amount': round(amt, 2),
            'currency': curr,
            'daysUntil': days_until
        })

    # Yield by symbol (annual dividend / latest position value)
    cursor.execute(f'''
        SELECT symbol, SUM(CAST(net_amount AS REAL)) as annual_net
        FROM archive_change_in_dividend_accrual
        WHERE {where} AND pay_date >= DATE('now', '-1 year')
        GROUP BY symbol
    ''', params)
    yields = []
    for sym, ann in cursor.fetchall():
        cursor.execute('''
            SELECT CAST(position_value AS REAL) FROM archive_open_position
            WHERE stmt_account_id = ? AND symbol = ?
            ORDER BY stmt_date DESC LIMIT 1
        ''', (account_id or '', sym))
        _row2 = cursor.fetchone()
        pv = safe_float(_row2[0]) if (account_id and _row2) else 0
        yields.append({
            'symbol': sym,
            'annualDividend': round(safe_float(ann), 2),
            'latestPositionValue': round(pv, 2),
            'yieldPct': round((safe_float(ann) / max(pv, 1)) * 100, 2) if pv else None
        })

    return {
        'history': history[:200],
        'upcoming': upcoming,
        'monthlyIncome': [{'month': m, 'amount': round(a, 2)} for m, a in sorted(monthly.items())],
        'yieldBySymbol': yields
    }


# ------------------------------------------------------------------
# 9. Fee Erosion Dashboard
# ------------------------------------------------------------------
def get_fee_erosion(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    # From unbundled commission detail
    cursor.execute(f'''
        SELECT SUM(CAST(broker_clearing_charge AS REAL)) as clearing,
               SUM(CAST(broker_execution_charge AS REAL)) as execution
        FROM archive_unbundled_commission_detail
        WHERE {where}
    ''', params)
    row = cursor.fetchone()
    unbundled = safe_float(row[0]) + safe_float(row[1]) if row else 0.0

    # From trades (ib_commission)
    cursor.execute(f'''
        SELECT SUM(CAST(ib_commission AS REAL)) as ib_comm,
               SUM(CAST(proceeds AS REAL) * -0.001) as est_comm
        FROM archive_trade
        WHERE {where}
    ''', params)
    row = cursor.fetchone()
    trade_comm = safe_float(row[0]) if row and row[0] is not None else 0.0

    total_fees = unbundled + trade_comm

    where_core = _acc_clause_core(account_id)
    params_core = _acc_params(account_id)

    # By category/month from unbundled
    cursor.execute(f'''
        SELECT SUBSTR(date_time, 1, 6) as month,
               SUM(CAST(broker_clearing_charge AS REAL) + CAST(broker_execution_charge AS REAL)) as amt
        FROM archive_unbundled_commission_detail
        WHERE {where}
        GROUP BY month
    ''', params)
    by_month = [{'month': r[0], 'amount': round(safe_float(r[1]), 2)} for r in cursor.fetchall()]

    # Compare to total realized gain (from change_in_nav or trades)
    cursor.execute(f'''
        SELECT SUM(CAST(realized AS REAL)) FROM daily_nav WHERE {where_core}
    ''', params_core)
    row = cursor.fetchone()
    total_gain = safe_float(row[0]) if row else 0.0

    # Annualized fee rate: total fees / average NAV
    cursor.execute(f'''
        SELECT AVG(CAST(ending_value AS REAL)) FROM daily_nav WHERE {where_core}
    ''', params_core)
    row = cursor.fetchone()
    avg_nav = safe_float(row[0]) if row else 0.0
    fee_rate = (total_fees / max(avg_nav, 1)) * 100 if avg_nav else 0

    return {
        'totalFees': round(total_fees, 2),
        'totalRealizedGain': round(total_gain, 2),
        'feeToGainRatio': round((total_fees / max(abs(total_gain), 1)) * 100, 2) if total_gain != 0 else None,
        'annualizedFeeRate': round(fee_rate, 3),
        'averageNav': round(avg_nav, 2),
        'byMonth': by_month,
        'breakdown': {
            'unbundledCommissions': round(unbundled, 2),
            'tradeCommissions': round(trade_comm, 2)
        }
    }


# ------------------------------------------------------------------
# 10. Concentration & Risk Radar
# ------------------------------------------------------------------
def get_risk_radar(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    where_core_risk = _acc_clause_core(account_id)
    params_core_risk = _acc_params(account_id)

    # Latest NAV
    if account_id:
        cursor.execute(f'''
            SELECT ending_value FROM daily_nav WHERE {where_core_risk} ORDER BY date DESC LIMIT 1
        ''', params_core_risk)
        row = cursor.fetchone()
        nav = safe_float(row[0]) if row else 0.0
    else:
        # Combined 账户：取最新日期的所有账户 NAV 总和
        cursor.execute('''
            SELECT SUM(ending_value) FROM daily_nav 
            WHERE date = (SELECT MAX(date) FROM daily_nav)
        ''')
        row = cursor.fetchone()
        nav = safe_float(row[0]) if row else 0.0

    # Concentration
    cursor.execute(f'''
        SELECT symbol, SUM(CAST(position_value AS REAL) * COALESCE(CAST(fx_rate_to_base AS REAL), 1.0)) as val
        FROM archive_open_position
        WHERE {where} AND stmt_date = (SELECT MAX(stmt_date) FROM archive_open_position WHERE {where})
        GROUP BY symbol
        ORDER BY val DESC
    ''', params + params)
    pos = [(r[0], safe_float(r[1])) for r in cursor.fetchall()]
    total_pos = sum(v for _, v in pos)
    max_single = (pos[0][1] / max(nav, 1)) * 100 if pos else 0

    # Leverage
    cursor.execute(f'''
        SELECT SUM(CAST(position_value AS REAL) * COALESCE(CAST(fx_rate_to_base AS REAL), 1.0))
        FROM archive_open_position
        WHERE {where} AND put_call IN ('P', 'C')
          AND stmt_date = (SELECT MAX(stmt_date) FROM archive_open_position WHERE {where})
    ''', params + params)
    row = cursor.fetchone()
    option_exposure = safe_float(row[0]) if row else 0.0

    # Volatility from daily_nav
    if account_id:
        cursor.execute(f'''
            SELECT ending_value FROM daily_nav WHERE {where_core_risk} ORDER BY date
        ''', params_core_risk)
        navs = [safe_float(r[0]) for r in cursor.fetchall() if r[0] is not None]
    else:
        # Combined 账户：按日期汇总所有账户的 NAV
        cursor.execute('''
            SELECT date, SUM(ending_value) FROM daily_nav 
            GROUP BY date ORDER BY date
        ''')
        navs = [safe_float(r[1]) for r in cursor.fetchall() if r[1] is not None]
    returns = []
    for i in range(1, len(navs)):
        if navs[i - 1] and navs[i - 1] != 0:
            returns.append((navs[i] - navs[i - 1]) / navs[i - 1])
    vol = (sum((r - sum(returns) / len(returns)) ** 2 for r in returns) / max(len(returns), 1)) ** 0.5 * (252 ** 0.5) * 100 if returns else 0

    return {
        'concentration': {
            'singleStockMaxPct': round(max_single, 2),
            'top5Pct': round(sum(v for _, v in pos[:5]) / max(nav, 1) * 100, 2) if pos else 0,
            'totalPositions': len(pos)
        },
        'radarScores': {
            'concentration': min(100, round(max_single, 2)),
            'leverage': min(100, round((option_exposure / max(nav, 1)) * 100, 2)),
            'volatility': min(100, round(vol, 2)),
            'fxExposure': 0,  # placeholder
            'optionGreek': 0  # placeholder
        }
    }


# ------------------------------------------------------------------
# 11. Corporate Action Impact
# ------------------------------------------------------------------
def get_corporate_action_impact(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    cursor.execute(f'''
        SELECT symbol, date_time, action_description, amount
        FROM archive_corporate_action
        WHERE {where}
        ORDER BY date_time
    ''', params)

    events = []
    for sym, dt, action, amt in cursor.fetchall():
        # Try to find shares before/after from prior_period_position around the date
        d_str = str(dt)[:8] if dt else None
        events.append({
            'date': dt,
            'symbol': sym,
            'action': action,
            'amount': safe_float(amt),
            'sharesBefore': None,
            'sharesAfter': None
        })

    return {'events': events}


# ------------------------------------------------------------------
# 12. Timing vs Stock Selection Attribution
# ------------------------------------------------------------------
def get_timing_attribution(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    # Get earliest and latest NAV
    where_core_timing = _acc_clause_core(account_id)
    params_core_timing = _acc_params(account_id)

    cursor.execute(f'''
        SELECT starting_value, ending_value FROM daily_nav WHERE {where_core_timing} ORDER BY date ASC
    ''', params_core_timing)
    nav_rows = cursor.fetchall()
    cursor.execute(f'''
        SELECT ending_value FROM daily_nav WHERE {where_core_timing} ORDER BY date DESC LIMIT 1
    ''', params_core_timing)
    last = cursor.fetchone()

    if not nav_rows or not last:
        return {'buyAndHoldReturn': 0, 'actualReturn': 0, 'timingContribution': 0}

    # Skip leading zeros for start_nav
    start_nav = 0.0
    for sv, ev in nav_rows:
        evf = safe_float(ev)
        if evf != 0:
            start_nav = evf
            break
    end_nav = safe_float(last[0])
    actual_return = ((end_nav - start_nav) / max(start_nav, 1)) * 100 if start_nav else 0

    # Buy-and-hold: sum of (initial_weight_i * return_i) for each symbol in earliest snapshot
    # We approximate using archive_open_position first and last snapshots
    cursor.execute(f'''
        SELECT symbol, CAST(position_value AS REAL)
        FROM archive_open_position
        WHERE {where} AND stmt_date = (SELECT MIN(stmt_date) FROM archive_open_position WHERE {where})
    ''', params + params)
    start_vals = {r[0]: safe_float(r[1]) for r in cursor.fetchall()}
    start_total = sum(start_vals.values())

    cursor.execute(f'''
        SELECT symbol, CAST(position_value AS REAL)
        FROM archive_open_position
        WHERE {where} AND stmt_date = (SELECT MAX(stmt_date) FROM archive_open_position WHERE {where})
    ''', params + params)
    end_vals = {r[0]: safe_float(r[1]) for r in cursor.fetchall()}

    bh_return = 0.0
    for sym, sval in start_vals.items():
        eval_ = end_vals.get(sym, sval)
        w = sval / max(start_total, 1)
        r = ((eval_ - sval) / max(sval, 1)) * 100 if sval else 0
        bh_return += w * r

    timing = actual_return - bh_return

    return {
        'buyAndHoldReturn': round(bh_return, 2),
        'actualReturn': round(actual_return, 2),
        'timingContribution': round(timing, 2)
    }


# ------------------------------------------------------------------
# 13. Wash Sale Detection
# ------------------------------------------------------------------
def get_wash_sale_alerts(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    # Find all losing sells
    cursor.execute(f'''
        SELECT symbol, date_time, CAST(fifo_pnl_realized AS REAL), CAST(mtm_pnl AS REAL), quantity
        FROM archive_trade
        WHERE {where} AND buy_sell = 'SELL'
    ''', params)

    losing_sells = []
    for sym, dt, fifo, mtm, qty in cursor.fetchall():
        pnl = safe_float(fifo)
        if not pnl:
            pnl = safe_float(mtm)
        if pnl is not None and pnl < 0:
            losing_sells.append({'symbol': sym, 'date': dt, 'loss': abs(pnl), 'quantity': safe_float(qty)})

    alerts = []
    tax_loss_ops = []
    for sell in losing_sells:
        sym = sell['symbol']
        sell_dt_str = str(sell['date'])[:8]
        try:
            sell_dt = datetime.strptime(sell_dt_str, '%Y%m%d')
        except Exception:
            continue
        # Check for buy within 30 days after
        cursor.execute('''
            SELECT date_time, quantity FROM archive_trade
            WHERE stmt_account_id = ? AND symbol = ? AND buy_sell = 'BUY'
              AND date_time > ? AND date_time <= ?
            ORDER BY date_time LIMIT 1
        ''', (account_id or '', sym, sell['date'], (sell_dt + timedelta(days=30)).strftime('%Y%m%d;235959')))
        buy = cursor.fetchone()
        if buy:
            buy_dt = buy[0]
            try:
                buy_dt_parsed = datetime.strptime(str(buy_dt)[:8], '%Y%m%d')
                gap = (buy_dt_parsed - sell_dt).days
            except Exception:
                gap = None
            alerts.append({
                'sellDate': sell['date'],
                'buyDate': buy_dt,
                'symbol': sym,
                'lossAmount': round(sell['loss'], 2),
                'daysGap': gap
            })
        else:
            tax_loss_ops.append({
                'sellDate': sell['date'],
                'symbol': sym,
                'lossAmount': round(sell['loss'], 2),
                'note': '可考虑年末 tax-loss harvesting（30天内无再买）'
            })

    return {
        'potentialWashSales': alerts,
        'taxLossHarvestingOpportunities': tax_loss_ops
    }


# ------------------------------------------------------------------
# 14. Options Strategy Lens
# ------------------------------------------------------------------
def get_options_strategy_lens(conn, account_id=None):
    cursor = conn.cursor()
    where = _acc_clause(account_id, 'stmt_account_id')
    params = _acc_params(account_id)

    # Current option positions
    cursor.execute(f'''
        SELECT symbol, description, put_call, CAST(strike AS REAL), expiry, CAST(position AS REAL),
               CAST(position_value AS REAL), CAST(mark_price AS REAL), underlying_symbol, multiplier
        FROM archive_open_position
        WHERE {where} AND (asset_category = 'OPT' OR asset_category = 'OPTION')
          AND stmt_date = (SELECT MAX(stmt_date) FROM archive_open_position WHERE {where})
    ''', params + params)

    strategies = []
    expiry_calendar = defaultdict(list)
    for sym, desc, pc, strike, exp, qty, pv, mp, under, mult in cursor.fetchall():
        strategy = 'OTHER'
        qty_num = safe_float(qty) or 0
        if 'COVERED' in (desc or '').upper() or qty_num > 0 and pc == 'C':
            strategy = 'COVERED_CALL'
        elif qty_num < 0 and pc == 'P':
            strategy = 'CASH_SECURED_PUT'
        elif qty_num < 0 and pc == 'C':
            strategy = 'NAKED_CALL'
        elif qty_num > 0 and pc == 'P':
            strategy = 'LONG_PUT'

        days = None
        try:
            if exp and len(str(exp)) == 8:
                exp_dt = datetime.strptime(str(exp), '%Y%m%d')
                days = (exp_dt - datetime.now()).days
                expiry_calendar[exp].append(sym)
        except Exception:
            pass

        # Approx annualized yield: position_value / abs(notional) * 365/days
        notional = abs(safe_float(strike) * safe_float(qty) * safe_float(mult)) if strike and qty and mult else 0
        ann_yield = None
        if pv and notional and days and days > 0:
            ann_yield = (abs(safe_float(pv)) / notional) * (365 / days) * 100

        strategies.append({
            'symbol': sym,
            'underlying': under,
            'strategy': strategy,
            'putCall': pc,
            'strike': safe_float(strike),
            'expiry': exp,
            'daysToExpiry': days,
            'quantity': safe_float(qty),
            'positionValue': safe_float(pv),
            'markPrice': safe_float(mp),
            'annualizedYield': round(ann_yield, 2) if ann_yield is not None else None
        })

    # Upcoming EAE events
    cursor.execute(f'''
        SELECT date, symbol, transaction_type, quantity FROM option_eae
        WHERE {_acc_clause_core(account_id)} AND date >= DATE('now')
        ORDER BY date
    ''', _acc_params(account_id))
    upcoming_eae = [{'date': r[0], 'symbol': r[1], 'type': r[2], 'quantity': safe_float(r[3])} for r in cursor.fetchall()]

    return {
        'currentStrategies': strategies,
        'expiryCalendar': [{'date': d, 'count': len(syms), 'symbols': syms} for d, syms in sorted(expiry_calendar.items())],
        'upcomingEAE': upcoming_eae
    }
