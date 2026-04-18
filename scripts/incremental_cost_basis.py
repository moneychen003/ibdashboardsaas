#!/usr/bin/env python3
"""
Incremental Cost Basis Engine (PostgreSQL version)
Supports Moving Weighted Average and Diluted Cost Basis.
"""
import sys
import os
from typing import List, Dict, Any
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from db.postgres_client import get_cursor


def safe_float(v):
    try:
        return float(v) if v is not None else 0.0
    except (ValueError, TypeError):
        return 0.0


def _build_events(cursor, user_id: str, account_id: str, symbol: str, since_date: str):
    """Fetch all new trade/transfer/option events for a symbol since snapshot date."""
    events = []

    where_account = "account_id = %s" if account_id else "1=1"
    params_trade = [user_id, symbol]
    params_opt = [user_id, symbol]
    params_transfer = [user_id, symbol]
    if account_id:
        params_trade.append(account_id)
        params_opt.append(account_id)
        params_transfer.append(account_id)
    params_trade.append(since_date)
    params_opt.append(since_date)
    params_transfer.append(since_date)

    # Normalize since_date: archive_trade/tranfer dates are YYYYMMDD text,
    # while snapshot last_trade_date may be YYYY-MM-DD. Unify to YYYYMMDD for text cols.
    since_date_text = since_date.replace('-', '') if isinstance(since_date, str) else str(since_date).replace('-', '')
    params_trade_text = params_trade[:-1] + [since_date_text]
    params_transfer_text = params_transfer[:-1] + [since_date_text]

    # 1. Option assignments
    cursor.execute(f'''
        SELECT underlying_symbol, symbol, quantity, mtm_pnl, date, put_call, strike
        FROM option_eae
        WHERE user_id = %s AND underlying_symbol = %s AND {where_account}
          AND transaction_type = 'Assignment' AND date > %s
        ORDER BY date
    ''', params_opt)
    assignments_by_date = {}
    for row in cursor.fetchall():
        underlying = row['underlying_symbol']
        opt_sym = row['symbol']
        qty_str = row['quantity']
        mtm_str = row['mtm_pnl']
        date = row['date']
        # Normalize to YYYYMMDD string to match archive_trade.trade_date format
        if hasattr(date, 'strftime'):
            date = date.strftime('%Y%m%d')
        else:
            date = str(date).replace('-', '')
        pc = row['put_call']
        strike_str = row['strike']
        contracts = abs(safe_float(qty_str)) if qty_str else 0
        shares = contracts * 100
        mtm = safe_float(mtm_str)
        strike = safe_float(strike_str)
        key = (underlying, date)
        assignments_by_date.setdefault(key, []).append({
            'symbol': opt_sym, 'shares': shares, 'premium': mtm,
            'put_call': pc, 'strike': strike
        })

    # 2. Trades
    cursor.execute(f'''
        SELECT symbol, buy_sell, quantity, trade_price, trade_money, ib_commission, taxes, trade_date
        FROM archive_trade
        WHERE user_id = %s AND symbol = %s AND {where_account}
          AND asset_category IN ('STK', 'ETF') AND trade_date > %s::text
        ORDER BY trade_date
    ''', params_trade_text)
    for row in cursor.fetchall():
        symbol = row['symbol']
        bs = row['buy_sell']
        qty = row['quantity']
        price = row['trade_price']
        trade_money = row['trade_money']
        commission = row['ib_commission']
        taxes = row['taxes']
        date = row['trade_date']
        qty = abs(safe_float(qty))
        tm = safe_float(trade_money)
        comm = abs(safe_float(commission)) if commission else 0
        tax = abs(safe_float(taxes)) if taxes else 0

        premium_adj_diluted = 0.0
        if bs == 'BUY' and qty > 0:
            assigns = assignments_by_date.get((symbol, date), [])
            if assigns:
                best = min(assigns, key=lambda a: abs(a['shares'] - qty))
                if abs(best['shares'] - qty) < 1:
                    if best['put_call'] == 'P' and best['premium'] > 0:
                        premium_adj_diluted = -best['premium']
                    elif best['put_call'] == 'C' and best['premium'] < 0:
                        premium_adj_diluted = -best['premium']
                    assigns.remove(best)

        if bs == 'BUY':
            cost_avg = abs(tm) + comm + tax
            cost_diluted = abs(tm) + comm + tax + premium_adj_diluted
            events.append({'type': 'BUY', 'qty': qty, 'cost_avg': cost_avg, 'cost_diluted': cost_diluted, 'net_proceeds': 0, 'date': date})
        else:
            cost_avg = abs(tm)
            net_proceeds = cost_avg - comm - tax
            events.append({'type': 'SELL', 'qty': qty, 'cost_avg': cost_avg, 'cost_diluted': cost_avg, 'net_proceeds': net_proceeds, 'date': date})

    # 3. Supplement unmatched assignments as BUY events
    for key, assigns in assignments_by_date.items():
        sym = key[0]
        date = key[1]
        for a in assigns:
            if a['put_call'] == 'P' and a['premium'] > 0:
                cost_avg = a['strike'] * a['shares']
                cost_diluted = a['strike'] * a['shares'] - a['premium']
                events.append({'type': 'BUY', 'qty': a['shares'], 'cost_avg': cost_avg, 'cost_diluted': cost_diluted, 'net_proceeds': 0, 'date': date})
            elif a['put_call'] == 'C' and a['premium'] < 0:
                cost_avg = a['strike'] * a['shares']
                cost_diluted = a['strike'] * a['shares'] + abs(a['premium'])
                events.append({'type': 'BUY', 'qty': a['shares'], 'cost_avg': cost_avg, 'cost_diluted': cost_diluted, 'net_proceeds': 0, 'date': date})

    # 4. Transfers
    cursor.execute(f'''
        SELECT symbol, direction, quantity, position_amount, date
        FROM archive_transfer
        WHERE user_id = %s AND symbol = %s AND {where_account}
          AND asset_category IN ('STK', 'ETF') AND date > %s::text
        ORDER BY date
    ''', params_transfer_text)
    for row in cursor.fetchall():
        symbol = row['symbol']
        direction = row['direction']
        qty = row['quantity']
        pos_amt = row['position_amount']
        date = row['date']
        qty = abs(safe_float(qty))
        cost = abs(safe_float(pos_amt)) if pos_amt else 0
        t = 'TRANSFER_IN' if direction == 'IN' else ('TRANSFER_OUT' if direction == 'OUT' else 'OTHER')
        net_proceeds = cost if direction == 'OUT' else 0
        events.append({'type': t, 'qty': qty, 'cost_avg': cost, 'cost_diluted': cost, 'net_proceeds': net_proceeds, 'date': date})

    for e in events:
        if not isinstance(e['date'], str):
            e['date'] = str(e['date'])
    events.sort(key=lambda x: x['date'])
    return events


def _apply_events(events: List[Dict], total_cost_avg: float, total_qty_avg: float,
                  total_cost_diluted: float, total_qty_diluted: float):
    for e in events:
        if e['type'] in ('BUY', 'TRANSFER_IN'):
            total_cost_avg += e['cost_avg']
            total_qty_avg += e['qty']
            total_cost_diluted += e['cost_diluted']
            total_qty_diluted += e['qty']
        elif e['type'] in ('SELL', 'TRANSFER_OUT'):
            if total_qty_avg > 0:
                ratio = min(e['qty'] / total_qty_avg, 1)
                total_cost_avg *= (1 - ratio)
                total_qty_avg -= e['qty']
            if total_qty_avg <= 0:
                total_qty_avg = 0
                total_cost_avg = 0

            proceeds = e.get('net_proceeds', e['cost_diluted'])
            total_cost_diluted -= proceeds
            total_qty_diluted -= e['qty']
            if total_qty_diluted <= 0:
                total_qty_diluted = 0
                total_cost_diluted = 0

    return total_cost_avg, total_qty_avg, total_cost_diluted, total_qty_diluted


def update_symbol(user_id: str, account_id: str, symbol: str):
    with get_cursor() as cur:
        # Load snapshot
        cur.execute('''
            SELECT total_qty, total_cost_avg, total_cost_diluted, last_trade_date
            FROM cost_basis_snapshots
            WHERE user_id = %s AND account_id = %s AND symbol = %s
        ''', (user_id, account_id, symbol))
        row = cur.fetchone()
        if row:
            total_qty_avg = safe_float(row['total_qty'])
            total_cost_avg = safe_float(row['total_cost_avg'])
            total_qty_diluted = safe_float(row['total_qty'])
            total_cost_diluted = safe_float(row['total_cost_diluted'])
            last_trade_date = row['last_trade_date'] or '1900-01-01'
        else:
            total_qty_avg = total_cost_avg = total_qty_diluted = total_cost_diluted = 0.0
            last_trade_date = '1900-01-01'

        events = _build_events(cur, user_id, account_id, symbol, last_trade_date)
        if not events:
            return None

        # 逐事件应用并写入历史，确保 history 记录每一步的中间状态
        for e in events:
            if e['type'] in ('BUY', 'TRANSFER_IN'):
                total_cost_avg += e['cost_avg']
                total_qty_avg += e['qty']
                total_cost_diluted += e['cost_diluted']
                total_qty_diluted += e['qty']
            elif e['type'] in ('SELL', 'TRANSFER_OUT'):
                if total_qty_avg > 0:
                    ratio = min(e['qty'] / total_qty_avg, 1)
                    total_cost_avg *= (1 - ratio)
                    total_qty_avg -= e['qty']
                if total_qty_avg <= 0:
                    total_qty_avg = 0
                    total_cost_avg = 0

                proceeds = e.get('net_proceeds', e['cost_diluted'])
                total_cost_diluted -= proceeds
                total_qty_diluted -= e['qty']
                if total_qty_diluted <= 0:
                    total_qty_diluted = 0
                    total_cost_diluted = 0

            cur.execute('''
                INSERT INTO cost_basis_history
                (user_id, account_id, symbol, total_qty, total_cost_avg, total_cost_diluted, trade_date, event_type)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ''', (user_id, account_id, symbol, total_qty_avg, total_cost_avg, total_cost_diluted, e['date'], e['type']))

        new_last_date = events[-1]['date']

        # Write snapshot
        cur.execute('''
            INSERT INTO cost_basis_snapshots
            (user_id, account_id, symbol, total_qty, total_cost_avg, total_cost_diluted, last_trade_date, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (user_id, account_id, symbol) DO UPDATE SET
                total_qty = EXCLUDED.total_qty,
                total_cost_avg = EXCLUDED.total_cost_avg,
                total_cost_diluted = EXCLUDED.total_cost_diluted,
                last_trade_date = EXCLUDED.last_trade_date,
                updated_at = NOW()
        ''', (user_id, account_id, symbol, total_qty_avg, total_cost_avg, total_cost_diluted, new_last_date))

    return {
        'symbol': symbol,
        'total_qty': total_qty_avg,
        'avg_price': round(total_cost_avg / total_qty_avg, 6) if total_qty_avg > 0 else 0,
        'avg_money': round(total_cost_avg, 2),
        'diluted_price': round(total_cost_diluted / total_qty_diluted, 6) if total_qty_diluted > 0 else 0,
        'diluted_money': round(total_cost_diluted, 2),
    }


def refresh_user_account(user_id: str, account_id: str):
    """Recompute cost basis for all symbols under a user account (full rebuild)."""
    with get_cursor() as cur:
        # 先清空旧数据，确保全量重算
        cur.execute('''
            DELETE FROM cost_basis_snapshots WHERE user_id = %s AND account_id = %s
        ''', (user_id, account_id))
        cur.execute('''
            DELETE FROM cost_basis_history WHERE user_id = %s AND account_id = %s
        ''', (user_id, account_id))

        # Gather all symbols from trades + transfers + option_eae
        cur.execute('''
            SELECT DISTINCT symbol FROM archive_trade
            WHERE user_id = %s AND account_id = %s AND asset_category IN ('STK', 'ETF')
            UNION
            SELECT DISTINCT symbol FROM archive_transfer
            WHERE user_id = %s AND account_id = %s AND asset_category IN ('STK', 'ETF')
            UNION
            SELECT DISTINCT underlying_symbol FROM option_eae
            WHERE user_id = %s AND account_id = %s AND transaction_type = 'Assignment'
        ''', (user_id, account_id, user_id, account_id, user_id, account_id))
        symbols = [r['symbol'] for r in cur.fetchall()]

    results = []
    for sym in symbols:
        res = update_symbol(user_id, account_id, sym)
        if res:
            results.append(res)
    return results


def get_cost_basis_map(user_id: str, account_id: str) -> Dict[str, Dict[str, Any]]:
    """Return {symbol: {'avgCostBasisPrice': ..., 'avgCostBasisMoney': ..., ...}}"""
    with get_cursor() as cur:
        cur.execute('''
            SELECT symbol, total_qty, total_cost_avg, total_cost_diluted
            FROM cost_basis_snapshots
            WHERE user_id = %s AND account_id = %s
        ''', (user_id, account_id))
        result = {}
        for row in cur.fetchall():
            qty = safe_float(row['total_qty'])
            avg_cost = safe_float(row['total_cost_avg'])
            diluted_cost = safe_float(row['total_cost_diluted'])
            result[row['symbol']] = {
                'avgCostBasisPrice': round(avg_cost / qty, 6) if qty > 0 else 0,
                'avgCostBasisMoney': round(avg_cost, 2),
                'dilutedCostBasisPrice': round(diluted_cost / qty, 6) if qty > 0 else 0,
                'dilutedCostBasisMoney': round(diluted_cost, 2),
            }
        return result


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("用法: python3 incremental_cost_basis.py <user_id> <account_id>")
        sys.exit(1)
    uid = sys.argv[1]
    acc = sys.argv[2]
    results = refresh_user_account(uid, acc)
    print(f"Updated {len(results)} symbols for {uid}/{acc}")
