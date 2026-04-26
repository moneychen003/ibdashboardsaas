#!/usr/bin/env python3
"""
SQLite → Dashboard JSON 生成器（多账户版）
支持单账户和合并视图输出
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sqlite3

import json
import sys
import math
import threading
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

_cb_context = threading.local()

def set_cost_basis_user_context(user_id):
    """pgdash 在调用 generate_dashboard_data 前后设置/清除，用于 cost_basis Redis 缓存命名。"""
    _cb_context.user_id = user_id

def set_user_base_currency(currency):
    """pgdash 在调用前后注入用户偏好货币（user_profiles.base_currency），优先级高于 IB 账户实际货币与全局 config。None 表示清除。"""
    _cb_context.user_base_currency = currency or None


def _cb_cache_get(user_id, account_id, max_stmt_date):
    try:
        import redis
        r = redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
                           socket_timeout=0.5, socket_connect_timeout=0.5)
        val = r.get(f"costbasis:{user_id}:{account_id}:{max_stmt_date}")
        return json.loads(val) if val else None
    except Exception:
        return None


def _cb_cache_set(user_id, account_id, max_stmt_date, result):
    try:
        import redis
        r = redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
                           socket_timeout=0.5, socket_connect_timeout=0.5)
        r.setex(f"costbasis:{user_id}:{account_id}:{max_stmt_date}",
                7 * 24 * 3600, json.dumps(result, default=str))
    except Exception:
        pass

from scripts.dashboard_extensions import (
    get_position_timeline,
    get_order_execution_quality,
    get_fx_exposure,
    get_slb_income,
    get_enhanced_cashflow,
    get_trading_heatmap,
    get_trade_rankings,
    get_dividend_tracker,
    get_fee_erosion,
    get_risk_radar,
    get_corporate_action_impact,
    get_timing_attribution,
    get_wash_sale_alerts,
    get_options_strategy_lens,
)

DB_PATH = 'data/ib_history.db'


def _load_config():
    config_path = os.path.join(os.path.dirname(__file__), '..', 'config', 'server_config.json')
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        settings = cfg.get('settings', {})
        return settings.get('baseCurrency'), settings.get('fxOverrides', {})
    except Exception:
        return None, {}

_CONFIG_BASE_CURRENCY, _CONFIG_FX_OVERRIDES = _load_config()


def get_nav_history(conn, account_id=None, start_date=None):
    """获取净值历史。account_id=None 时返回合并视图"""
    cursor = conn.cursor()
    if account_id:
        cursor.execute('''
            SELECT date, ending_value FROM daily_nav
            WHERE account_id = ? AND date >= ? ORDER BY date
        ''', (account_id, start_date or '1900-01-01'))
    else:
        cursor.execute('''
            SELECT date, SUM(ending_value) 
            FROM daily_nav 
            WHERE date >= ?
            GROUP BY date 
            ORDER BY date
        ''', (start_date or '1900-01-01',))
    return [{'date': row[0], 'nav': round(row[1], 2)} for row in cursor.fetchall()]


def get_all_nav_history(conn, account_id=None):
    cursor = conn.cursor()
    if account_id:
        cursor.execute('SELECT date, ending_value FROM daily_nav WHERE account_id = ? ORDER BY date', (account_id,))
    else:
        cursor.execute('''
            SELECT d.date, SUM(d.ending_value)
            FROM daily_nav d
            WHERE d.account_id NOT IN (
                SELECT DISTINCT account_id FROM daily_nav
                WHERE date = (SELECT MAX(date) FROM daily_nav)
                AND ABS(ending_value) < 1
            )
            GROUP BY d.date ORDER BY d.date
        ''')
    return [{'date': row[0], 'nav': round(row[1], 2)} for row in cursor.fetchall()]


def get_flow_series(conn, account_id=None):
    """
    每日外部现金流（deposits/withdrawals/transfers/grants/corp-action 等）。
    优先从 archive_change_in_nav 按 stmt_date 聚合显式字段；
    无 CIN 数据时回落到基于 daily_nav.twr 的反推（老数据兼容路径）。
    返回 [(date, flow, ending), ...]
    """
    cursor = conn.cursor()

    # Step 1: 尝试从 archive_change_in_nav 聚合显式 flow（精确口径）
    flow_sum_expr = (
        "CAST(COALESCE(deposits_withdrawals,'0') AS REAL) + "
        "CAST(COALESCE(asset_transfers,'0') AS REAL) + "
        "CAST(COALESCE(internal_cash_transfers,'0') AS REAL) + "
        "CAST(COALESCE(grant_activity,'0') AS REAL) + "
        "CAST(COALESCE(transferred_pnl_adjustments,'0') AS REAL) + "
        "CAST(COALESCE(linking_adjustments,'0') AS REAL)"
    )
    cin_flow_map = {}
    try:
        if account_id:
            cursor.execute(
                f"SELECT stmt_date, SUM({flow_sum_expr}) FROM archive_change_in_nav "
                f"WHERE stmt_account_id = ? GROUP BY stmt_date",
                (account_id,))
        else:
            cursor.execute(
                f"SELECT stmt_date, SUM({flow_sum_expr}) FROM archive_change_in_nav "
                f"GROUP BY stmt_date")
        for stmt_date, flow_sum in cursor.fetchall():
            if stmt_date is None:
                continue
            cin_flow_map[stmt_date] = float(flow_sum or 0)
    except sqlite3.OperationalError:
        cin_flow_map = {}
    # Step 1b: 补充 archive_cash_transaction 的 Deposits/Withdrawals —— 2026-03 起 IB FlexQuery
    # 配置掉了 ChangeInNav.deposits_withdrawals 字段，只能从 cash_transaction 拿原始现金流。
    # cash_transaction 按 original currency × fx_rate_to_base 换到 base。settle_date 是 YYYYMMDD。
    ct_flow_map = {}
    try:
        if account_id:
            cursor.execute(
                "SELECT settle_date, SUM(CAST(amount AS REAL) * "
                "COALESCE(CAST(NULLIF(fx_rate_to_base,'') AS REAL), 1)) "
                "FROM archive_cash_transaction WHERE stmt_account_id = ? "
                "AND type = 'Deposits/Withdrawals' "
                "AND settle_date IS NOT NULL AND settle_date <> '' "
                "GROUP BY settle_date",
                (account_id,))
        else:
            cursor.execute(
                "SELECT settle_date, SUM(CAST(amount AS REAL) * "
                "COALESCE(CAST(NULLIF(fx_rate_to_base,'') AS REAL), 1)) "
                "FROM archive_cash_transaction WHERE type = 'Deposits/Withdrawals' "
                "AND settle_date IS NOT NULL AND settle_date <> '' GROUP BY settle_date")
        for sd, flow_sum in cursor.fetchall():
            if not sd:
                continue
            sd_str = str(sd)
            if len(sd_str) == 8 and sd_str.isdigit():
                sd_norm = f"{sd_str[:4]}-{sd_str[4:6]}-{sd_str[6:]}"
            else:
                sd_norm = sd_str
            ct_flow_map[sd_norm] = ct_flow_map.get(sd_norm, 0.0) + float(flow_sum or 0)
    except sqlite3.OperationalError:
        ct_flow_map = {}

    # 若 cash_transaction 有数据，视为权威源（更细粒度）。
    # 否则继续用 change_in_nav。
    if ct_flow_map:
        cin_flow_map = ct_flow_map
    has_cin = bool(cin_flow_map)

    # Step 2: 遍历 daily_nav 生成 flow_series
    if account_id:
        cursor.execute('SELECT date, ending_value, twr FROM daily_nav WHERE account_id = ? ORDER BY date', (account_id,))
        rows = cursor.fetchall()
        result = []
        prev_ending = 0.0
        for i, (date, ending, twr) in enumerate(rows):
            ending_val = float(ending or 0)
            if i == 0:
                flow = 0.0
            elif has_cin:
                flow = cin_flow_map.get(date, 0.0)
            else:
                if twr is None:
                    flow = ending_val - prev_ending
                else:
                    flow = ending_val - prev_ending * (1 + float(twr) / 100)
            result.append((date, flow, ending_val))
            prev_ending = ending_val
        return result
    else:
        cursor.execute('SELECT date, account_id, ending_value, twr FROM daily_nav ORDER BY date, account_id')
        rows = cursor.fetchall()
        cursor.execute('''
            SELECT DISTINCT account_id FROM daily_nav
            WHERE date = (SELECT MAX(date) FROM daily_nav)
            AND ABS(ending_value) < 1
        ''')
        exclude_accounts = {r[0] for r in cursor.fetchall()}
        date_map = {}
        for date, acc, ending, twr in rows:
            if acc in exclude_accounts:
                continue
            if date not in date_map:
                date_map[date] = {}
            date_map[date][acc] = (ending, twr)
        result = []
        prev_accounts = {}
        for date in sorted(date_map.keys()):
            accounts = date_map[date]
            combined_ending = sum(float(v[0] or 0) for v in accounts.values())
            if not prev_accounts:
                flow = 0.0
            elif has_cin:
                flow = cin_flow_map.get(date, 0.0)
            else:
                expected = 0.0
                for acc, (prev_ending, prev_twr) in prev_accounts.items():
                    if acc not in accounts:
                        continue
                    ending_acc, twr_acc = accounts[acc]
                    prev_ending_val = float(prev_ending or 0)
                    if twr_acc is None:
                        expected += prev_ending_val
                    else:
                        expected += prev_ending_val * (1 + float(twr_acc) / 100)
                flow = combined_ending - expected
            result.append((date, flow, combined_ending))
            prev_accounts = {acc: (v[0], v[1]) for acc, v in accounts.items()}
        return result

def get_nav_history_with_metrics(conn, account_id=None):
    """
    返回每日的净值、TWR 累积收益率、MWR 累积收益率。
    twr 字段在 daily_nav 中为百分比形式（如 0.15 表示 0.15%）。
    mwr 使用 (ending_value / invested_capital - 1) * 100，
    其中 invested_capital = initial_capital + cumulative_flow（基于 twr 反推的出入金）。
    """
    flow_series = get_flow_series(conn, account_id)
    if not flow_series:
        return [], [], []

    flow_map = {d: f for d, f, e in flow_series}
    cursor = conn.cursor()
    if account_id:
        cursor.execute('''
            SELECT date, ending_value, twr
            FROM daily_nav
            WHERE account_id = ? ORDER BY date
        ''', (account_id,))
        nav_rows = cursor.fetchall()
    else:
        cursor.execute('''
            SELECT date, SUM(ending_value)
            FROM daily_nav
            WHERE account_id NOT IN (
                SELECT DISTINCT account_id FROM daily_nav
                WHERE date = (SELECT MAX(date) FROM daily_nav)
                AND ABS(ending_value) < 1
            )
            GROUP BY date ORDER BY date
        ''')
        nav_rows = cursor.fetchall()
    if not nav_rows:
        return [], [], []

    simple = []
    twr = []
    mwr = []

    initial_capital = 0
    for i, row in enumerate(nav_rows):
        date, ending = row[0], row[1]
        ending_val = float(ending or 0)
        if initial_capital == 0 and ending_val != 0:
            initial_capital = ending_val
        simple.append({'date': date, 'nav': round(ending_val, 2)})

    # TWR cumulative
    cum_twr = 0.0
    prev_ending = 0.0
    for i, row in enumerate(nav_rows):
        date, ending = row[0], row[1]
        ending_val = float(ending or 0)
        if account_id:
            dtwr = float(row[2] or 0)
        else:
            # Combined daily TWR = NAV-weighted average of account TWRs
            # 等价于 (combined_ending - combined_flow - prev_combined) / prev_combined
            if i == 0 or prev_ending == 0:
                dtwr = 0.0
            else:
                flow = flow_map.get(date, 0)
                dtwr = ((ending_val - prev_ending - flow) / prev_ending) * 100
        if i == 0:
            cum_twr = 0.0
        else:
            cum_twr = (1 + cum_twr / 100) * (1 + dtwr / 100) * 100 - 100
        twr.append({'date': date, 'nav': round(cum_twr, 4)})
        prev_ending = ending_val

    # MWR cumulative
    cum_flow = 0.0
    for i, row in enumerate(nav_rows):
        date, ending = row[0], row[1]
        ending_val = float(ending or 0)
        cum_flow += flow_map.get(date, 0)
        invested = initial_capital + cum_flow
        if invested != 0:
            mwr_val = (ending_val / invested - 1) * 100
        else:
            mwr_val = 0.0
        mwr.append({'date': date, 'nav': round(mwr_val, 4)})

    # Simple real returns (cashflow-adjusted)
    simple_returns = []
    cum_flow = 0.0
    for i, row in enumerate(nav_rows):
        date, ending = row[0], row[1]
        ending_val = float(ending or 0)
        cum_flow += flow_map.get(date, 0)
        invested = initial_capital + cum_flow
        if ending_val == 0:
            ret = 0.0
        elif invested != 0:
            ret = (ending_val - invested) / invested * 100
        else:
            ret = 0.0
        simple_returns.append({'date': date, 'nav': round(ret, 4)})

    return simple, twr, mwr, simple_returns


def _nav_to_series(nav_list):
    """将 NAV 列表转换为 pandas Series，index 为日期"""
    if not nav_list:
        return pd.Series(dtype=float)
    df = pd.DataFrame(nav_list)
    df['date'] = pd.to_datetime(df['date'])
    return df.set_index('date')['nav'].sort_index()


def get_latest_date(conn, account_id=None):
    cursor = conn.cursor()
    if account_id:
        cursor.execute('SELECT MAX(date) FROM daily_nav WHERE account_id = ?', (account_id,))
    else:
        cursor.execute('SELECT MAX(date) FROM daily_nav')
    row = cursor.fetchone()
    return row[0] if row else None


def get_earliest_date(conn, account_id=None):
    cursor = conn.cursor()
    if account_id:
        cursor.execute('SELECT MIN(date) FROM daily_nav WHERE account_id = ?', (account_id,))
    else:
        cursor.execute('SELECT MIN(date) FROM daily_nav')
    row = cursor.fetchone()
    return row[0] if row else None


def get_range_summary(nav_list, net_flow=0):
    if not nav_list or len(nav_list) < 2:
        start = nav_list[0]['nav'] if nav_list else 0
        end = start
        return {
            'startNav': round(start, 2), 'endNav': round(end, 2),
            'gain': 0, 'gainPct': 0,
            'rawGain': 0, 'rawGainPct': 0, 'netFlow': round(net_flow or 0, 2),
            'days': len(nav_list)
        }
    start = nav_list[0]['nav']
    end = nav_list[-1]['nav']
    gain = end - start - net_flow           # 扣净入金后的真实收益
    invested = start + net_flow
    gain_pct = (gain / invested * 100) if invested else 0
    raw_gain = end - start                  # 绝对变化（含净入金）
    raw_gain_pct = (raw_gain / start * 100) if start else 0
    return {
        'startNav': round(start, 2),
        'endNav': round(end, 2),
        'gain': round(gain, 2),
        'gainPct': round(gain_pct, 2),
        'rawGain': round(raw_gain, 2),
        'rawGainPct': round(raw_gain_pct, 2),
        'netFlow': round(net_flow or 0, 2),
        'days': len(nav_list)
    }


def sanitize_nav_list(nav_list):
    """过滤掉非正净值数据，避免起始零值和负值干扰计算"""
    return [n for n in nav_list if n['nav'] and n['nav'] > 0]


def calc_max_drawdown(nav_list):
    """计算最大回撤（百分比）"""
    clean = sanitize_nav_list(nav_list)
    if len(clean) < 2:
        return 0.0
    peak = clean[0]['nav']
    max_dd = 0.0
    for n in clean:
        v = n['nav']
        if v > peak:
            peak = v
        dd = (peak - v) / peak
        if dd > max_dd:
            max_dd = dd
    return round(max_dd * 100, 2)


def calc_annualized_metrics(nav_list):
    """计算年化收益率、年化波动率、夏普比率"""
    clean = sanitize_nav_list(nav_list)
    if len(clean) < 2:
        return {'annualizedReturn': 0.0, 'annualizedVolatility': 0.0, 'sharpeRatio': 0.0}
    start = clean[0]['nav']
    end = clean[-1]['nav']
    n = len(clean)
    # CAGR 年化收益率
    if start and start > 0:
        ann_return = ((end / start) ** (252 / n) - 1)
    else:
        ann_return = 0.0
    # 日收益率序列
    returns = []
    for i in range(1, n):
        prev = clean[i-1]['nav']
        curr = clean[i]['nav']
        if prev and prev > 0:
            returns.append((curr - prev) / prev)
        else:
            returns.append(0.0)
    avg_daily = sum(returns) / len(returns) if returns else 0.0
    variance = sum((r - avg_daily) ** 2 for r in returns) / len(returns) if returns else 0.0
    std_daily = math.sqrt(variance)
    ann_vol = std_daily * math.sqrt(252)
    sharpe = ann_return / ann_vol if ann_vol > 0 else 0.0
    return {
        'annualizedReturn': round(ann_return * 100, 2),
        'annualizedVolatility': round(ann_vol * 100, 2),
        'sharpeRatio': round(sharpe, 2)
    }


def get_cumulative_realized(conn, account_id=None):
    """
    计算累计已实现盈亏。
    由于当前 IB FlexQuery 配置中 fifo_pnl_realized 全为 0，
    我们使用 mtm_pnl 作为 best-effort 的平仓盈亏估计：
    只累加那些减少持仓方向（即平仓）交易的 mtm_pnl，
    并排除 CASH（外汇兑换）等纯现金流交易。
    """
    cursor = conn.cursor()
    where = 'stmt_account_id = ?' if account_id else '1=1'
    params = (account_id,) if account_id else ()

    cursor.execute(f'''
        SELECT symbol, quantity, mtm_pnl, asset_category
        FROM archive_trade
        WHERE asset_category IN ('STK','OPT','BOND','BILL','FUND') AND ({where})
        ORDER BY COALESCE(date_time, trade_date), trade_id
    ''', params)

    from collections import defaultdict
    holdings = defaultdict(float)
    total_realized = 0.0

    for row in cursor.fetchall():
        symbol, qty_str, mtm_str, asset_category = row
        qty = safe_float(qty_str)
        mtm = safe_float(mtm_str)
        if qty == 0:
            continue

        pos = holdings[symbol]
        # 当交易方向与当前持仓方向相反时，视为减少持仓（平仓），其 mtm_pnl 计入已实现盈亏
        if pos != 0 and (qty > 0) != (pos > 0):
            total_realized += mtm

        holdings[symbol] += qty

    return round(total_realized, 2)


def get_realized_ytd(conn, account_id=None):
    """从 archive_mtdytd_performance_summary_underlying 读取 YTD 已实现盈亏（含长/短期拆分）。
    IB Flex 的 archive_change_in_nav.realized 字段近两年都是 0，这里取 mtdytd 表最新
    stmt_date 的 SUM(realized_pnl_ytd) / SUM(real_ltytd) / SUM(real_stytd)。
    返回 {ytd, lt, st, asOf}；无数据时全 0。"""
    cursor = conn.cursor()
    where = "stmt_account_id = ?" if account_id else "1=1"
    params = (account_id,) if account_id else ()
    try:
        cursor.execute(f"SELECT MAX(stmt_date) FROM archive_mtdytd_performance_summary_underlying WHERE {where}", params)
        row = cursor.fetchone()
        latest = row[0] if row else None
        if not latest:
            return {"ytd": 0, "lt": 0, "st": 0, "asOf": None}
        cursor.execute(
            f"SELECT SUM(CAST(NULLIF(realized_pnl_ytd,'') AS REAL)), "
            f"SUM(CAST(NULLIF(real_ltytd,'') AS REAL)), "
            f"SUM(CAST(NULLIF(real_stytd,'') AS REAL)) "
            f"FROM archive_mtdytd_performance_summary_underlying "
            f"WHERE stmt_date = ? AND {where}",
            (latest,) + params)
        r = cursor.fetchone() or (0, 0, 0)
        return {"ytd": safe_float(r[0]), "lt": safe_float(r[1]), "st": safe_float(r[2]), "asOf": latest}
    except sqlite3.OperationalError:
        return {"ytd": 0, "lt": 0, "st": 0, "asOf": None}


def get_data_quality(conn, account_id=None):
    """数据质量：各关键表的条数 + 最新日期，帮用户定位 Flex 同步是否断档。"""
    cursor = conn.cursor()
    # 表 → 取哪个列作为"最新日期"
    plan = [
        ('archive_trade', 'trade_date', 'stmt_account_id'),
        ('archive_cash_transaction', 'report_date', 'stmt_account_id'),
        ('archive_change_in_nav', 'stmt_date', 'stmt_account_id'),
        ('archive_open_position', 'stmt_date', 'stmt_account_id'),
        ('archive_statement_of_funds_line', 'date', 'stmt_account_id'),
        ('archive_unbundled_commission_detail', 'stmt_date', 'stmt_account_id'),
        ('archive_mtm_performance_summary_underlying', 'report_date', 'stmt_account_id'),
        ('archive_mtdytd_performance_summary_underlying', 'stmt_date', 'stmt_account_id'),
        ('archive_option_eae', 'stmt_date', 'stmt_account_id'),
        ('archive_slb_fee', 'stmt_date', 'stmt_account_id'),
        ('archive_slb_open_contract', 'stmt_date', 'stmt_account_id'),
        ('archive_tier_interest_detail', 'stmt_date', 'stmt_account_id'),
        ('archive_corporate_action', 'report_date', 'stmt_account_id'),
        ('archive_conversion_rate', 'date', None),
        ('archive_equity_summary_by_report_date_in_base', 'report_date', 'stmt_account_id'),
        ('daily_nav', 'date', 'account_id'),
        ('cost_basis_history', 'trade_date', 'account_id'),
        ('positions', 'date', 'account_id'),
        ('market_prices', 'last_updated', None),
    ]
    result = []
    for table, date_col, acc_col in plan:
        try:
            if account_id and acc_col:
                cursor.execute(f"SELECT COUNT(*), MAX({date_col}) FROM {table} WHERE {acc_col} = ?", (account_id,))
            else:
                cursor.execute(f"SELECT COUNT(*), MAX({date_col}) FROM {table}")
            row = cursor.fetchone()
            cnt = int(row[0] or 0)
            latest = row[1]
            result.append({'table': table, 'rowCount': cnt, 'latestDate': str(latest) if latest else None})
        except sqlite3.OperationalError as e:
            result.append({'table': table, 'rowCount': 0, 'latestDate': None, 'error': str(e)[:80]})
    return {
        'tables': result,
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }


def get_data_quality_warning(conn, account_id=None):
    """检测 Flex Query 数据是否完整。返回 banner 提示对象，或 None。

    典型问题：用户在 IB Flex Query 把 Period 设成 "Last 1 Calendar Day"，
    当日没下单时 Trades / UnbundledCommissionDetails / StatementOfFunds 全空，
    导致佣金、交易等字段长期为 0。
    """
    cursor = conn.cursor()
    is_combined = (not account_id) or str(account_id).lower() == 'combined'

    def _count(table, where_extra=""):
        try:
            if is_combined:
                cursor.execute(f"SELECT COUNT(*) FROM {table} {('WHERE ' + where_extra) if where_extra else ''}")
            else:
                clause = "stmt_account_id = ?"
                if where_extra:
                    clause = f"{clause} AND {where_extra}"
                cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE {clause}", (account_id,))
            row = cursor.fetchone()
            return int(row[0] or 0) if row else 0
        except sqlite3.OperationalError:
            return 0

    open_pos = _count('archive_open_position')
    if open_pos == 0:
        return None  # 新用户/无持仓不打扰

    trade_count = _count('archive_trade')
    cash_tx_count = _count('archive_cash_transaction')
    stmt_funds_count = _count('archive_statement_of_funds_line')
    unbundled_count = _count('archive_unbundled_commission_detail')

    # Flex 时间窗口：取所有 flex_statement 里 from_date / to_date 的并集跨度
    from_date = to_date = None
    try:
        if is_combined:
            cursor.execute("SELECT MIN(from_date), MAX(to_date) FROM archive_flex_statement")
        else:
            cursor.execute("SELECT MIN(from_date), MAX(to_date) FROM archive_flex_statement WHERE account_id = ?", (account_id,))
        row = cursor.fetchone()
        if row:
            from_date, to_date = row[0], row[1]
    except sqlite3.OperationalError:
        pass

    window_days = None
    if from_date and to_date:
        try:
            from datetime import datetime as _dt
            f = _dt.strptime(str(from_date)[:10], '%Y-%m-%d').date() if '-' in str(from_date) else _dt.strptime(str(from_date), '%Y%m%d').date()
            t = _dt.strptime(str(to_date)[:10], '%Y-%m-%d').date() if '-' in str(to_date) else _dt.strptime(str(to_date), '%Y%m%d').date()
            window_days = (t - f).days + 1
        except Exception:
            window_days = None

    # 触发条件：有持仓 + （没有任何交易明细 或 时间窗口 ≤ 7 天 或 完全没有佣金/资金报表）
    no_trade_data = (trade_count == 0)
    short_window = (window_days is not None and window_days <= 7)
    no_commission_detail = (unbundled_count == 0 and stmt_funds_count == 0)

    if not (no_trade_data or short_window or (no_commission_detail and trade_count < 5)):
        return None

    return {
        'severity': 'warning',
        'code': 'incomplete_flex_window',
        'title': '数据可能不完整：佣金/交易等字段显示为 0',
        'message': '检测到您的 IB Flex Query 时间窗口过短，或部分 Sections 输出为空，因此佣金、交易明细等字段无法填充。',
        'suggestion': '请打开 IB Account Management → Reports → Flex Queries，编辑当前的 Activity Flex Query：\n1) 把 Period 改为 Year to Date 或 Last 365 Calendar Days；\n2) 确认 Sections 已勾选 Trades、Unbundled Commission Details、Statement of Funds、Change in NAV、MTD/YTD Performance Summary；\n3) 保存后回到本站「设置 → Flex 同步」点一次手动同步，或重新上传一份 XML 即可恢复。',
        'metrics': {
            'openPositions': open_pos,
            'tradeCount': trade_count,
            'cashTransactionCount': cash_tx_count,
            'stmtFundsCount': stmt_funds_count,
            'unbundledCommissionCount': unbundled_count,
            'flexWindowDays': window_days,
            'flexFromDate': str(from_date) if from_date else None,
            'flexToDate': str(to_date) if to_date else None,
        }
    }


def get_tax_view(conn, account_id=None):
    """税务视图：已实现（YTD，长/短期）+ 未实现（按每个持仓最早 BUY 日期估算长/短期）。

    IB Flex 默认未启 Lot Detail，所以未实现按长/短期的拆分是近似：以 cost_basis_history
    中每个 symbol+account 的最早 BUY trade_date 为基准，若 > 365 天则整个持仓归为长期。
    多批买入的 FIFO lot-level 精度需要启用 Lot Detail section 才能做到。
    """
    import datetime as _dt
    cursor = conn.cursor()
    where_pos = "account_id = ?" if account_id else "1=1"
    where_cb = "account_id = ?" if account_id else "1=1"
    params = (account_id,) if account_id else ()

    realized = get_realized_ytd(conn, account_id)

    try:
        cursor.execute(f"SELECT symbol, account_id, MIN(trade_date) FROM cost_basis_history WHERE {where_cb} AND event_type = 'BUY' GROUP BY symbol, account_id", params)
        first_buy_map = {(r[0], r[1]): r[2] for r in cursor.fetchall()}
    except sqlite3.OperationalError:
        first_buy_map = {}

    cursor.execute(f"SELECT MAX(date) FROM positions WHERE {where_pos}", params)
    row = cursor.fetchone()
    latest_date = row[0] if row else None
    if not latest_date:
        return {
            'realizedYtd': realized.get('ytd', 0),
            'realizedLtYtd': realized.get('lt', 0),
            'realizedStYtd': realized.get('st', 0),
            'realizedAsOf': realized.get('asOf'),
            'unrealizedTotal': 0, 'unrealizedLtEstimate': 0, 'unrealizedStEstimate': 0,
            'unrealizedByHolding': [], 'asOf': None,
            'note': '无持仓数据'
        }

    cursor.execute(f"SELECT symbol, account_id, asset_type, quantity, cost_basis_price, mark_price, COALESCE(position_value_in_base, position_value), COALESCE(mark_price_in_base, mark_price) FROM positions WHERE {where_pos} AND date = ?", params + (latest_date,))
    pos_rows = cursor.fetchall()

    # cost_basis_history 最新 total_qty/total_cost_avg per (symbol, account)
    try:
        cursor.execute(f"SELECT symbol, account_id, total_qty, total_cost_avg FROM cost_basis_history h WHERE {where_cb} AND trade_date = (SELECT MAX(trade_date) FROM cost_basis_history h2 WHERE h2.symbol = h.symbol AND h2.account_id = h.account_id)", params)
        cb_map = {(r[0], r[1]): (float(r[2] or 0), float(r[3] or 0)) for r in cursor.fetchall()}
    except sqlite3.OperationalError:
        cb_map = {}

    today = _dt.date.today()
    holdings = []
    lt_total = 0.0
    st_total = 0.0
    total = 0.0

    for sym, acc, at, qty, cb_price_pos, mp, pv_base, mp_base in pos_rows:
        qty = float(qty or 0)
        mp = float(mp or 0)
        pv_base = float(pv_base or 0)
        if qty == 0 or mp == 0:
            continue
        # 优先从 cost_basis_history 取成本，否则用 positions.cost_basis_price
        cb_total_qty, cb_total_cost = cb_map.get((sym, acc), (0, 0))
        if cb_total_qty and cb_total_cost:
            cb_price = cb_total_cost / cb_total_qty
        elif cb_price_pos:
            cb_price = float(cb_price_pos)
        else:
            cb_price = 0
        if cb_price == 0:
            continue
        pv_native = qty * mp
        fx = pv_base / pv_native if pv_native else 1.0
        unrealized = (mp - cb_price) * qty * fx
        total += unrealized

        first_buy = first_buy_map.get((sym, acc))
        holding_days = 0
        if first_buy:
            try:
                if isinstance(first_buy, _dt.date):
                    fb_date = first_buy
                else:
                    s = str(first_buy)
                    if len(s) == 8 and s.isdigit():
                        fb_date = _dt.date(int(s[:4]), int(s[4:6]), int(s[6:8]))
                    else:
                        fb_date = _dt.datetime.strptime(s[:10], '%Y-%m-%d').date()
                holding_days = (today - fb_date).days
            except Exception:
                holding_days = 0

        category = 'long' if holding_days > 365 else 'short'
        if category == 'long':
            lt_total += unrealized
        else:
            st_total += unrealized

        holdings.append({
            'symbol': sym, 'accountId': acc, 'assetType': at,
            'quantity': round(qty, 4),
            'costBasisPrice': round(cb_price, 4),
            'markPrice': round(mp, 4),
            'positionValueInBase': round(pv_base, 2),
            'unrealizedInBase': round(unrealized, 2),
            'firstBuyDate': str(first_buy) if first_buy else None,
            'holdingDays': holding_days,
            'category': category
        })

    holdings.sort(key=lambda h: -abs(h['unrealizedInBase']))

    return {
        'realizedYtd': realized.get('ytd', 0),
        'realizedLtYtd': realized.get('lt', 0),
        'realizedStYtd': realized.get('st', 0),
        'realizedAsOf': realized.get('asOf'),
        'unrealizedTotal': round(total, 2),
        'unrealizedLtEstimate': round(lt_total, 2),
        'unrealizedStEstimate': round(st_total, 2),
        'unrealizedByHolding': holdings,
        'asOf': str(latest_date),
        'note': '未实现盈亏的长/短期拆分基于 cost_basis_history 中每标的最早一笔 BUY 的日期；IB FlexQuery 需启用 Lot Detail section 才能做严格 FIFO lot-level 计算'
    }


def get_option_eae_events(conn, account_id=None):
    """期权 Exercise/Assignment/Expiration 事件 + 权利金归因"""
    from collections import defaultdict
    cursor = conn.cursor()
    where = "stmt_account_id = ?" if account_id else "1=1"
    params = (account_id,) if account_id else ()
    try:
        cursor.execute(f"SELECT date, stmt_date, symbol, underlying_symbol, put_call, strike, expiry, transaction_type, quantity, proceeds, realized_pnl, mtm_pnl, cost_basis, mark_price FROM archive_option_eae WHERE {where} AND transaction_type IS NOT NULL AND transaction_type != '' ORDER BY date DESC, symbol", params)
        raw = cursor.fetchall()
    except sqlite3.OperationalError:
        return {'events': [], 'totalEvents': 0, 'summary': {}, 'byUnderlying': []}

    events = []
    for r in raw:
        events.append({
            'date': r[0],
            'stmtDate': str(r[1]) if r[1] else None,
            'symbol': r[2],
            'underlyingSymbol': r[3],
            'putCall': r[4],
            'strike': safe_float(r[5]) if r[5] else None,
            'expiry': r[6],
            'transactionType': r[7],
            'quantity': safe_float(r[8]),
            'proceeds': safe_float(r[9]),
            'realizedPnl': safe_float(r[10]),
            'mtmPnl': safe_float(r[11]),
            'costBasis': safe_float(r[12]),
            'markPrice': safe_float(r[13]),
        })

    summary = defaultdict(lambda: {'count': 0, 'totalMtm': 0.0, 'totalProceeds': 0.0})
    for e in events:
        key = f"{e['transactionType']}_{e['putCall'] or '-'}"
        summary[key]['count'] += 1
        summary[key]['totalMtm'] += e['mtmPnl'] or 0
        summary[key]['totalProceeds'] += e['proceeds'] or 0

    by_underlying = defaultdict(lambda: {'events': 0, 'netMtm': 0.0, 'premiums': 0.0})
    for e in events:
        u = e['underlyingSymbol'] or e['symbol'] or '-'
        by_underlying[u]['events'] += 1
        by_underlying[u]['netMtm'] += e['mtmPnl'] or 0
        by_underlying[u]['premiums'] += e['proceeds'] or 0

    return {
        'events': events[:200],
        'totalEvents': len(events),
        'summary': {k: {'count': v['count'], 'totalMtm': round(v['totalMtm'], 2), 'totalProceeds': round(v['totalProceeds'], 2)} for k, v in summary.items()},
        'byUnderlying': sorted(
            [{'symbol': s, 'events': v['events'], 'netMtm': round(v['netMtm'], 2), 'premiums': round(v['premiums'], 2)} for s, v in by_underlying.items()],
            key=lambda x: -abs(x['netMtm'])
        )
    }


def get_cash_opportunity(conn, account_id=None):
    """闲置现金机会成本：按月聚合利息 + 与 SGOV 年化对比"""
    from collections import defaultdict
    cursor = conn.cursor()
    where = "stmt_account_id = ?" if account_id else "1=1"
    params = (account_id,) if account_id else ()
    try:
        cursor.execute(f"SELECT SUBSTR(CAST(stmt_date AS TEXT),1,7) AS month, currency, interest_type, SUM(CAST(NULLIF(total_interest,'') AS REAL)) AS interest, AVG(CAST(NULLIF(total_principal,'') AS REAL)) AS avg_principal, AVG(CAST(NULLIF(rate,'') AS REAL)) AS avg_rate FROM archive_tier_interest_detail WHERE {where} GROUP BY month, currency, interest_type ORDER BY month DESC", params)
        rows = cursor.fetchall()
    except sqlite3.OperationalError:
        return {'monthly': [], 'totalCredit': 0, 'totalDebit': 0, 'totalNet': 0}

    monthly = defaultdict(lambda: defaultdict(lambda: {'credit': 0.0, 'debit': 0.0, 'principal': 0.0, 'rate': 0.0}))
    total_credit = 0.0
    total_debit = 0.0
    for month, curr, itype, interest, principal, rate in rows:
        curr = curr or 'USD'
        key = 'credit' if itype == 'Credit Interest' else 'debit'
        interest = float(interest or 0)
        if key == 'credit':
            total_credit += interest
        else:
            total_debit += interest
        monthly[month][curr][key] += interest
        monthly[month][curr]['principal'] = max(monthly[month][curr].get('principal', 0), float(principal or 0))
        monthly[month][curr]['rate'] = float(rate or 0)

    monthly_list = []
    for month in sorted(monthly.keys(), reverse=True):
        month_credit = sum(v['credit'] for v in monthly[month].values())
        month_debit = sum(v['debit'] for v in monthly[month].values())
        monthly_list.append({
            'month': month,
            'byCurrency': {curr: {'credit': round(v['credit'], 2), 'debit': round(v['debit'], 2), 'principal': round(v['principal'], 2), 'rate': round(v['rate'], 4)} for curr, v in monthly[month].items()},
            'monthCredit': round(month_credit, 2),
            'monthDebit': round(month_debit, 2),
            'monthNet': round(month_credit + month_debit, 2),
        })

    return {
        'monthly': monthly_list,
        'totalCredit': round(total_credit, 2),
        'totalDebit': round(total_debit, 2),
        'totalNet': round(total_credit + total_debit, 2),
        'note': 'IB 分层利息（Credit = 你收到的，Debit = 你借保证金付的）。对比 SGOV 年化 ~4.8%，每 $100k 闲置一个月约 $400 收益。'
    }


def get_base_currency(conn, account_id=None):
    # 1) 用户偏好（pgdash 注入，user_profiles.base_currency）优先
    user_base = getattr(_cb_context, "user_base_currency", None)
    if user_base:
        return user_base
    cursor = conn.cursor()
    if account_id:
        cursor.execute('''
            SELECT currency FROM archive_account_information
            WHERE stmt_account_id = ? AND currency IS NOT NULL AND currency != ''
            ORDER BY stmt_date DESC LIMIT 1
        ''', (account_id,))
        row = cursor.fetchone()
        if row and row[0]:
            return row[0]
    else:
        cursor.execute('''
            SELECT currency FROM archive_account_information
            WHERE currency IS NOT NULL AND currency != ''
            ORDER BY stmt_date DESC LIMIT 1
        ''')
        row = cursor.fetchone()
        if row and row[0]:
            return row[0]
    if _CONFIG_BASE_CURRENCY:
        return _CONFIG_BASE_CURRENCY
    return 'USD'


def _get_base_currency(cursor, account_id=None):
    cursor.execute("PRAGMA table_info(archive_account_information)")
    cols = {row[1] for row in cursor.fetchall()}
    if 'currency' in cols:
        if account_id:
            cursor.execute("SELECT currency FROM archive_account_information WHERE stmt_account_id = ? ORDER BY stmt_date DESC LIMIT 1", (account_id,))
        else:
            cursor.execute("SELECT currency FROM archive_account_information ORDER BY stmt_date DESC LIMIT 1")
        row = cursor.fetchone()
        if row and row[0]:
            return row[0]
    cursor.execute("PRAGMA table_info(archive_equity_summary_by_report_date_in_base)")
    cols = {row[1] for row in cursor.fetchall()}
    if 'currency' in cols:
        if account_id:
            cursor.execute("SELECT currency FROM archive_equity_summary_by_report_date_in_base WHERE stmt_account_id = ? ORDER BY stmt_date DESC LIMIT 1", (account_id,))
        else:
            cursor.execute("SELECT currency FROM archive_equity_summary_by_report_date_in_base ORDER BY stmt_date DESC LIMIT 1")
        row = cursor.fetchone()
        if row and row[0]:
            return row[0]
    return None

def get_fx_rates(conn, account_id=None):
    """获取最新外汇汇率 (fx_rate_to_base: 1外币 = ?本币)。优先从 archive_conversion_rate 读取。"""
    cursor = conn.cursor()
    rates = {}
    base_currency = _get_base_currency(cursor, account_id)
    if base_currency:
        if account_id:
            cursor.execute("SELECT from_currency, rate FROM archive_conversion_rate WHERE stmt_account_id = ? AND to_currency = ?", (account_id, base_currency))
        else:
            cursor.execute("SELECT from_currency, rate FROM archive_conversion_rate WHERE to_currency = ?", (base_currency,))
    else:
        if account_id:
            cursor.execute("SELECT from_currency, rate FROM archive_conversion_rate WHERE stmt_account_id = ?", (account_id,))
        else:
            cursor.execute("SELECT from_currency, rate FROM archive_conversion_rate")
    for row in cursor.fetchall():
        try:
            rates[row[0]] = float(row[1])
        except (ValueError, TypeError):
            pass
    # 2. Fallback 到 archive_cash_transaction 补充缺失的币种
    if account_id:
        cursor.execute('''
            SELECT c.currency, c.fx_rate_to_base
            FROM archive_cash_transaction c
            INNER JOIN (
                SELECT currency, MAX(stmt_date) as max_date
                FROM archive_cash_transaction
                WHERE stmt_account_id = ? AND fx_rate_to_base IS NOT NULL AND fx_rate_to_base != ''
                GROUP BY currency
            ) m ON c.currency = m.currency AND c.stmt_date = m.max_date
        ''', (account_id,))
    else:
        cursor.execute('''
            SELECT c.currency, c.fx_rate_to_base
            FROM archive_cash_transaction c
            INNER JOIN (
                SELECT currency, MAX(stmt_date) as max_date
                FROM archive_cash_transaction
                WHERE fx_rate_to_base IS NOT NULL AND fx_rate_to_base != ''
                GROUP BY currency
            ) m ON c.currency = m.currency AND c.stmt_date = m.max_date
        ''')
    for row in cursor.fetchall():
        if row[0] not in rates:
            try:
                rates[row[0]] = float(row[1])
            except (ValueError, TypeError):
                pass
    if _CONFIG_FX_OVERRIDES:
        rates.update(_CONFIG_FX_OVERRIDES)
    return rates


def get_option_premium_adjustments(conn, account_id=None):
    """基于 archive_option_eae 中的 Assignment 记录计算期权行权带来的权利金抵扣。
    对于 Sell Put 被行权（买入股票），收到的权利金可以抵扣股票成本。
    直接读取 OptionEAE 的 mtmPnl 作为权利金（Short Put 通常为正值收入）。
    """
    cursor = conn.cursor()
    where = 'account_id = ?' if account_id else '1=1'
    params = (account_id,) if account_id else ()

    cursor.execute(f'''
        SELECT underlying_symbol, symbol, quantity, mtm_pnl, date
        FROM option_eae
        WHERE {where} AND transaction_type = 'Assignment'
    ''', params)

    adjustments = {}
    for row in cursor.fetchall():
        underlying, opt_symbol, qty_str, mtm_str, date = row
        qty = safe_float(qty_str) if qty_str else 0
        mtm = safe_float(mtm_str) if mtm_str else 0
        if not underlying or qty == 0:
            continue
        # mtmPnl 对 Sell Put Assignment 通常是正值（权利金收入），可用于抵扣成本
        # 如果 mtm 为 0，尝试从 symbol 判断是否是 Put
        parts = opt_symbol.split() if opt_symbol else []
        is_put = False
        if len(parts) >= 2:
            code = parts[1]
            if len(code) >= 7 and code[6].upper() == 'P':
                is_put = True
        # 只有 Put 行权买入股票才抵扣成本；Call 行权卖出股票不在这里处理（成本影响不同）
        if is_put and mtm > 0:
            adjustments[underlying] = adjustments.get(underlying, 0.0) + mtm

    return adjustments


def _calc_cost_basis_for_account(conn, account_id):
    """Helper: calculate cost basis for a single account."""
    cursor = conn.cursor()
    where_trade = 't.stmt_account_id = ?'
    where_transfer = 'stmt_account_id = ?'
    where_opt = 'account_id = ?'
    params = (account_id,)

    uid = getattr(_cb_context, 'user_id', None)
    max_stmt_date = None
    if uid:
        try:
            cursor.execute(
                'SELECT MAX(stmt_date) FROM archive_trade WHERE stmt_account_id = ?',
                (account_id,),
            )
            row = cursor.fetchone()
            max_stmt_date = row[0] if row and row[0] else None
            if max_stmt_date:
                cached = _cb_cache_get(uid, account_id, max_stmt_date)
                if cached is not None:
                    return cached
        except Exception:
            max_stmt_date = None

    # 1. 读取期权行权 Assignment 记录
    cursor.execute(f'''
        SELECT underlying_symbol, symbol, quantity, mtm_pnl, date, put_call, strike
        FROM option_eae
        WHERE {where_opt} AND transaction_type = 'Assignment'
    ''', params)
    assignments_by_date_sym = {}
    for row in cursor.fetchall():
        underlying, opt_sym, qty_str, mtm_str, date, pc, strike_str = row
        contracts = abs(safe_float(qty_str)) if qty_str else 0
        shares = contracts * 100
        mtm = safe_float(mtm_str) if mtm_str else 0
        strike = safe_float(strike_str) if strike_str else 0
        # Normalize date to YYYYMMDD to match archive_trade.trade_date format
        if date and len(str(date)) == 10 and str(date)[4] == '-':
            date = str(date).replace('-', '')
        key = (underlying, date)
        assignments_by_date_sym.setdefault(key, []).append({
            'symbol': opt_sym, 'shares': shares, 'premium': mtm, 'put_call': pc,
            'strike': strike
        })

    # 2. 读取股票交易（含佣金税费）
    events = []
    cursor.execute(f'''
        SELECT t.symbol, t.buy_sell, t.quantity, t.trade_price, t.trade_money, t.ib_commission, t.taxes, t.trade_date
        FROM archive_trade t
        WHERE {where_trade} AND t.asset_category IN ('STK', 'ETF')
        ORDER BY t.trade_date
    ''', params)
    for row in cursor.fetchall():
        symbol, bs, qty, price, trade_money, commission, taxes, date = row
        qty = abs(safe_float(qty))
        tm = safe_float(trade_money)
        comm = abs(safe_float(commission)) if commission else 0
        tax = abs(safe_float(taxes)) if taxes else 0

        premium_adj_diluted = 0.0
        if bs == 'BUY' and qty > 0:
            assigns = assignments_by_date_sym.get((symbol, date), [])
            if assigns:
                price_f = safe_float(price)
                strike_match = [a for a in assigns
                                if price_f > 0
                                and abs(a['strike'] - price_f) < 0.01
                                and abs(a['shares'] - qty) < 1]
                best = strike_match[0] if strike_match else min(assigns, key=lambda a: abs(a['shares'] - qty))
                if abs(best['shares'] - qty) < 1:
                    if best['put_call'] == 'P' and best['premium'] > 0:
                        premium_adj_diluted = -best['premium']
                    elif best['put_call'] == 'C' and best['premium'] < 0:
                        premium_adj_diluted = -best['premium']
                    assigns.remove(best)

        if bs == 'BUY':
            cost_avg = abs(tm) + comm + tax
            cost_diluted = abs(tm) + comm + tax + premium_adj_diluted
            net_proceeds = 0
            events.append({'symbol': symbol, 'type': 'BUY', 'qty': qty, 'cost_avg': cost_avg, 'cost_diluted': cost_diluted, 'net_proceeds': 0, 'date': date or '1900-01-01'})
        else:
            cost_avg = abs(tm)
            net_proceeds = cost_avg - comm - tax
            events.append({'symbol': symbol, 'type': 'SELL', 'qty': qty, 'cost_avg': cost_avg, 'cost_diluted': cost_avg, 'net_proceeds': net_proceeds, 'date': date or '1900-01-01'})

    # 3. 读取期权交易（BUY/SELL 都算入成本基础）
    cursor.execute(f'''
        SELECT t.symbol, t.buy_sell, t.quantity, t.trade_price, t.trade_money, t.ib_commission, t.taxes, t.trade_date
        FROM archive_trade t
        WHERE {where_trade} AND t.asset_category = 'OPT'
        ORDER BY t.trade_date
    ''', params)
    for row in cursor.fetchall():
        symbol, bs, qty, price, trade_money, commission, taxes, date = row
        qty = abs(safe_float(qty))
        tm = safe_float(trade_money)
        comm = abs(safe_float(commission)) if commission else 0
        tax = abs(safe_float(taxes)) if taxes else 0
        if bs == 'BUY':
            cost_avg = abs(tm) + comm + tax
            events.append({'symbol': symbol, 'type': 'BUY', 'qty': qty, 'cost_avg': cost_avg, 'cost_diluted': cost_avg, 'net_proceeds': 0, 'date': date or '1900-01-01'})
        else:
            cost_avg = abs(tm)
            net_proceeds = cost_avg - comm - tax
            events.append({'symbol': symbol, 'type': 'SELL', 'qty': qty, 'cost_avg': cost_avg, 'cost_diluted': cost_avg, 'net_proceeds': net_proceeds, 'date': date or '1900-01-01'})

    # 4. 补充未匹配的 Option Assignment
    for key, assigns in assignments_by_date_sym.items():
        symbol = key[0]
        date = key[1]
        for a in assigns:
            if a['put_call'] == 'P' and a['premium'] > 0:
                cost_avg = a['strike'] * a['shares']
                cost_diluted = a['strike'] * a['shares'] - a['premium']
                events.append({'symbol': symbol, 'type': 'BUY', 'qty': a['shares'], 'cost_avg': cost_avg, 'cost_diluted': cost_diluted, 'net_proceeds': 0, 'date': date or '1900-01-01'})
            elif a['put_call'] == 'C' and a['premium'] < 0:
                cost_avg = a['strike'] * a['shares']
                cost_diluted = a['strike'] * a['shares'] + abs(a['premium'])
                events.append({'symbol': symbol, 'type': 'BUY', 'qty': a['shares'], 'cost_avg': cost_avg, 'cost_diluted': cost_diluted, 'net_proceeds': 0, 'date': date or '1900-01-01'})

    # 5. 读取转入记录
    cursor.execute(f'''
        SELECT symbol, direction, quantity, position_amount, date
        FROM archive_transfer
        WHERE {where_transfer} AND asset_category IN ('STK', 'ETF')
        ORDER BY date
    ''', params)
    for row in cursor.fetchall():
        symbol, direction, qty, pos_amt, date = row
        qty = abs(safe_float(qty))
        cost = abs(safe_float(pos_amt)) if pos_amt else 0
        t = 'TRANSFER_IN' if direction == 'IN' else ('TRANSFER_OUT' if direction == 'OUT' else 'OTHER')
        net_proceeds = cost if direction == 'OUT' else 0
        events.append({'symbol': symbol, 'type': t, 'qty': qty, 'cost_avg': cost, 'cost_diluted': cost, 'net_proceeds': net_proceeds, 'date': date or '1900-01-01'})

    by_symbol = {}
    for e in events:
        s = e['symbol']
        by_symbol.setdefault(s, []).append(e)

    result = {}
    for s, elist in by_symbol.items():
        elist.sort(key=lambda x: x['date'])
        total_cost_avg = 0
        total_qty_avg = 0
        total_cost_diluted = 0
        total_qty_diluted = 0

        for e in elist:
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

        if total_qty_avg > 0:
            avg_price = round(total_cost_avg / total_qty_avg, 6)
            avg_money = round(total_cost_avg, 2)
        else:
            avg_price = 0
            avg_money = 0

        if total_qty_diluted > 0:
            diluted_price = round(total_cost_diluted / total_qty_diluted, 6)
            diluted_money = round(total_cost_diluted, 2)
        else:
            diluted_price = 0
            diluted_money = 0

        result[s] = {
            'avgCostBasisPrice': avg_price,
            'avgCostBasisMoney': avg_money,
            'dilutedCostBasisPrice': diluted_price,
            'dilutedCostBasisMoney': diluted_money,
            'totalQty': total_qty_avg,
        }

    if uid and max_stmt_date:
        _cb_cache_set(uid, account_id, max_stmt_date, result)
    return result


def get_cost_basis(conn, account_id=None):
    """基于历史交易、转账和期权行权记录计算每只股票的摊薄成本（移动加权平均）、FIFO成本"""
    if account_id:
        return _calc_cost_basis_for_account(conn, account_id)

    cursor = conn.cursor()
    cursor.execute('SELECT DISTINCT stmt_account_id FROM archive_trade UNION SELECT DISTINCT stmt_account_id FROM archive_transfer')
    accounts = list({r[0] for r in cursor.fetchall() if r[0]})
    merged = {}
    for acc in accounts:
        acc_result = _calc_cost_basis_for_account(conn, acc)
        for sym, cb in acc_result.items():
            if sym not in merged:
                merged[sym] = cb.copy()
            else:
                existing = merged[sym]
                total_qty = existing.get('totalQty', 0) + cb.get('totalQty', 0)
                existing['avgCostBasisMoney'] = round(existing.get('avgCostBasisMoney', 0) + cb.get('avgCostBasisMoney', 0), 2)
                existing['dilutedCostBasisMoney'] = round(existing.get('dilutedCostBasisMoney', 0) + cb.get('dilutedCostBasisMoney', 0), 2)
                if total_qty > 0:
                    existing['avgCostBasisPrice'] = round(existing['avgCostBasisMoney'] / total_qty, 6)
                    existing['dilutedCostBasisPrice'] = round(existing['dilutedCostBasisMoney'] / total_qty, 6)
                existing['totalQty'] = total_qty
    return merged


def get_latest_positions(conn, account_id=None):
    """获取最新持仓。account_id=None 时合并所有账户的最新持仓（按基础货币汇总）"""
    cursor = conn.cursor()
    cost_map = get_cost_basis(conn, account_id)

    def _fx_map_for_account(acc, stmt_date):
        fx_map = {}
        cursor.execute('''
            SELECT from_currency, rate FROM archive_conversion_rate
            WHERE stmt_account_id = ? AND stmt_date = ?
        ''', (acc, stmt_date))
        for curr, rate in cursor.fetchall():
            try:
                fx_map[curr] = float(rate)
            except (ValueError, TypeError):
                pass
        return fx_map

    if account_id:
        cursor.execute('''
            SELECT p.symbol, p.description, p.asset_type, p.position_value, p.mark_price,
                   aop.currency, aop.fx_rate_to_base,
                   aop.cost_basis_money, aop.cost_basis_price, aop.fifo_pnl_unrealized
            FROM positions p
            LEFT JOIN archive_open_position aop
                ON p.symbol = aop.symbol
                AND p.account_id = aop.stmt_account_id
                AND p.date = aop.stmt_date
                AND (aop.level_of_detail = 'SUMMARY' OR aop.level_of_detail IS NULL OR aop.level_of_detail = '')
            WHERE p.account_id = ? AND p.date = (SELECT MAX(date) FROM positions WHERE account_id = ?)
            ORDER BY p.asset_type, p.symbol
        ''', (account_id, account_id))
        processed_rows = cursor.fetchall()
    else:
        cursor.execute('SELECT DISTINCT account_id FROM positions')
        accounts = [r[0] for r in cursor.fetchall() if r[0]]
        # Global latest date across all positions for staleness filtering
        cursor.execute('SELECT MAX(date) FROM positions')
        global_max_date = cursor.fetchone()[0]
        agg = {}
        for acc in accounts:
            cursor.execute('SELECT MAX(date) FROM positions WHERE account_id = ?', (acc,))
            max_date = cursor.fetchone()[0]
            if not max_date:
                continue
            if global_max_date and max_date:
                try:
                    from datetime import datetime
                    d1 = datetime.strptime(str(global_max_date), '%Y-%m-%d')
                    d2 = datetime.strptime(str(max_date), '%Y-%m-%d')
                    if (d1 - d2).days > 7:
                        continue
                except Exception:
                    pass
            fx_map = _fx_map_for_account(acc, max_date)
            cursor.execute('''
                SELECT p.symbol, p.description, p.asset_type, p.position_value, p.mark_price,
                       p.position_value_in_base, p.mark_price_in_base,
                       aop.currency, aop.fx_rate_to_base,
                       aop.cost_basis_money, aop.cost_basis_price, aop.fifo_pnl_unrealized
                FROM positions p
                LEFT JOIN archive_open_position aop
                    ON p.symbol = aop.symbol
                    AND p.account_id = aop.stmt_account_id
                    AND p.date = aop.stmt_date
                    AND (aop.level_of_detail = 'SUMMARY' OR aop.level_of_detail IS NULL OR aop.level_of_detail = '')
                WHERE p.account_id = ? AND p.date = ?
                ORDER BY p.asset_type, p.symbol
            ''', (acc, max_date))
            for row in cursor.fetchall():
                symbol = row[0]
                pv_local = safe_float(row[3]) if row[3] is not None else 0
                mp_local = safe_float(row[4]) if row[4] is not None else 0
                pv_base_stored = safe_float(row[5]) if row[5] is not None else None
                mp_base_stored = safe_float(row[6]) if row[6] is not None else None
                currency = (row[7] or 'USD').upper()
                fx = safe_float(row[8]) if row[8] is not None else None
                if fx is None:
                    fx = fx_map.get(currency, 1.0)

                pv = pv_base_stored if pv_base_stored is not None else (pv_local * fx)
                mp = mp_base_stored if mp_base_stored is not None else (mp_local * fx if mp_local else 0)
                qty = pv_local / mp_local if mp_local else 0

                cbm_local = safe_float(row[9]) if row[9] is not None else 0
                cbp_local = safe_float(row[10]) if row[10] is not None else 0
                fpu_local = safe_float(row[11]) if row[11] is not None else 0

                existing = agg.get(symbol)
                if existing is None:
                    agg[symbol] = {
                        'symbol': symbol,
                        'description': row[1],
                        'assetType': row[2],
                        'positionValue': pv_local,
                        'markPrice': mp_local,
                        'positionValueInBase': pv,
                        '_qty': qty,
                        'currency': currency,
                        'costBasisMoney': cbm_local,
                        'costBasisPrice': cbp_local,
                        'fifoPnlUnrealized': fpu_local,
                    }
                else:
                    existing['positionValue'] += pv_local
                    existing['positionValueInBase'] = existing.get('positionValueInBase', 0) + pv
                    existing['costBasisMoney'] += cbm_local
                    existing['fifoPnlUnrealized'] += fpu_local
                    existing['_qty'] += qty
        processed_rows = []
        for v in agg.values():
            qty = v['_qty']
            v['markPrice'] = (v['positionValue'] / qty) if qty else 0
            v['costBasisPrice'] = (v['costBasisMoney'] / qty) if qty else 0
            v['quantity'] = qty
            del v['_qty']
            processed_rows.append((
                v['symbol'], v['description'], v['assetType'], v['positionValue'],
                v['markPrice'], v['currency'], None, v['costBasisMoney'],
                v['costBasisPrice'], v['fifoPnlUnrealized'], v['quantity'], v.get('positionValueInBase')
            ))

    # Best-effort 期权盈亏估算（基于 archive_trade proceeds 累计净现金流 + 当前市值）
    option_symbols = [row[0] for row in processed_rows if row[2] == 'OPTION']
    option_pnl_map = {}
    option_avg_price_map = {}
    if option_symbols:
        placeholders = ','.join(['?'] * len(option_symbols))
        where_acc = 'stmt_account_id = ?' if account_id else '1=1'
        params = [account_id] if account_id else []
        params.extend(option_symbols)
        cursor.execute(f'''
            SELECT symbol, SUM(CAST(proceeds AS REAL)) as net_premium
            FROM archive_trade
            WHERE {where_acc} AND asset_category = 'OPT' AND symbol IN ({placeholders})
            GROUP BY symbol
        ''', tuple(params))
        option_pnl_map = {r[0]: safe_float(r[1]) for r in cursor.fetchall()}
        # 计算原始开仓的平均每股权益金（不受平仓/行权影响）
        # 兼容 quantity 为股数或张数两种单位：
        # 若 proceeds/quantity ≈ trade_price，则为股数；否则为张数（需乘100）
        cursor.execute(f'''
            SELECT symbol,
                   CASE WHEN SUM(ABS(CAST(quantity AS REAL))) > 0
                        THEN SUM(CAST(proceeds AS REAL)) /
                             SUM(CASE
                                 WHEN ABS(CAST(proceeds AS REAL)) / NULLIF(ABS(CAST(quantity AS REAL)), 0)
                                      BETWEEN CAST(trade_price AS REAL) * 0.9 AND CAST(trade_price AS REAL) * 1.1
                                 THEN ABS(CAST(quantity AS REAL))
                                 ELSE ABS(CAST(quantity AS REAL)) * 100
                             END)
                        ELSE 0
                   END as avg_premium_per_share
            FROM archive_trade
            WHERE {where_acc} AND asset_category = 'OPT' AND buy_sell = 'SELL' AND symbol IN ({placeholders})
            GROUP BY symbol
        ''', tuple(params))
        option_avg_price_map = {r[0]: safe_float(r[1]) for r in cursor.fetchall()}

    # 拉取实时价格覆盖
    live_price_map = {}
    try:
        cursor.execute("SELECT symbol, price FROM market_prices")
        live_price_map = {r[0]: safe_float(r[1]) for r in cursor.fetchall() if r[1] is not None}
    except Exception:
        pass

    stocks, etfs, options = [], [], []
    for row in processed_rows:
        symbol = row[0]
        cb = cost_map.get(symbol, {})
        qty = row[10] if len(row) > 10 else (safe_float(row[3]) / safe_float(row[4]) if safe_float(row[4]) else 0)
        item = {
            'symbol': symbol,
            'description': row[1],
            'assetType': row[2],
            'positionValue': row[3],
            'markPrice': row[4],
            'quantity': round(qty, 2) if qty else 0,
            'currency': row[5] or 'USD',
            'fxRateToBase': safe_float(row[6]) if row[6] else None,
            'costBasisMoney': safe_float(row[7]) if row[7] is not None else None,
            'costBasisPrice': safe_float(row[8]) if row[8] is not None else None,
            'fifoPnlUnrealized': safe_float(row[9]) if row[9] is not None else None,
            'positionValueInBase': safe_float(row[11]) if len(row) > 11 and row[11] is not None else None,
            'avgCostBasisPrice': cb.get('avgCostBasisPrice'),
            'avgCostBasisMoney': cb.get('avgCostBasisMoney'),
            'dilutedCostBasisPrice': cb.get('dilutedCostBasisPrice'),
            'dilutedCostBasisMoney': cb.get('dilutedCostBasisMoney'),
            'fifoCostBasisPrice': cb.get('fifoCostBasisPrice'),
            'fifoCostBasisMoney': cb.get('fifoCostBasisMoney'),
            'capitalCostBasisPrice': cb.get('capitalCostBasisPrice'),
            'capitalCostBasisMoney': cb.get('capitalCostBasisMoney')
        }
        live_price = live_price_map.get(symbol)
        if live_price and row[2] in ('STOCK', 'ETF'):
            old_pv = safe_float(row[3]) if row[3] is not None else 0
            old_mp = safe_float(row[4]) if row[4] is not None else 0
            qty = old_pv / old_mp if old_mp else 0
            item['positionValue'] = round(qty * live_price, 2)
            item['markPrice'] = round(live_price, 4)
        if live_price and row[2] == 'OPTION':
            old_pv = safe_float(row[3]) if row[3] is not None else 0
            old_mp = safe_float(row[4]) if row[4] is not None else 0
            contracts = old_pv / old_mp / 100 if old_mp else 0
            item['positionValue'] = round(contracts * live_price * 100, 2)
            item['markPrice'] = round(live_price, 4)
        if row[2] == 'OPTION':
            # 使用实时价格覆盖后的 positionValue 计算 estimatedPnl
            current_pv = item.get('positionValue', safe_float(row[3]) if row[3] is not None else 0)
            mp = item.get('markPrice', safe_float(row[4]) if row[4] is not None else 0)
            pv = item.get('positionValue', safe_float(row[3]) if row[3] is not None else 0)
            contracts = round(abs(pv) / abs(mp) / 100, 0) if mp else 0
            item['contracts'] = contracts
            # 权益金计算：使用原始开仓平均价，不受平仓/行权影响
            avg_premium_per_share = option_avg_price_map.get(symbol, 0)
            if avg_premium_per_share > 0 and contracts > 0:
                premium_per_contract = avg_premium_per_share * 100
                net_premium = premium_per_contract * contracts
                item['premiumPerShare'] = round(avg_premium_per_share, 4)
                item['premiumPerContract'] = round(premium_per_contract, 2)
                item['netPremium'] = round(net_premium, 2)
                item['estimatedPnl'] = round(net_premium + current_pv, 2)
            else:
                # fallback 到旧逻辑
                net_premium = option_pnl_map.get(symbol, 0)
                item['estimatedPnl'] = round(net_premium + current_pv, 2)
                item['netPremium'] = round(net_premium, 2)
                item['premiumPerContract'] = round(net_premium / contracts, 2) if contracts else 0
                item['premiumPerShare'] = round(net_premium / contracts / 100, 4) if contracts else 0
        if row[2] == 'ETF':
            etfs.append(item)
        elif row[2] == 'OPTION':
            options.append(item)
        else:
            stocks.append(item)
    return stocks, etfs, options


def get_cash_report(conn, account_id=None):
    cursor = conn.cursor()
    if account_id:
        cursor.execute('''
            SELECT currency, cash FROM cash_report 
            WHERE account_id = ? AND date = (SELECT MAX(date) FROM cash_report WHERE account_id = ?)
        ''', (account_id, account_id))
    else:
        cursor.execute('''
            SELECT currency, SUM(cash) as cash 
            FROM cash_report 
            WHERE date = (SELECT MAX(date) FROM cash_report WHERE account_id = cash_report.account_id)
            GROUP BY currency
        ''')
    return [{'currency': row[0], 'cash': row[1]} for row in cursor.fetchall()]


def get_option_eae(conn, account_id=None):
    cursor = conn.cursor()
    if account_id:
        cursor.execute('''
            SELECT date, symbol, description, underlying_symbol, strike, expiry, put_call,
                   transaction_type, quantity, trade_price, mark_price, mtm_pnl, currency
            FROM option_eae WHERE account_id = ? ORDER BY date DESC
        ''', (account_id,))
    else:
        cursor.execute('''
            SELECT date, symbol, description, underlying_symbol, strike, expiry, put_call,
                   transaction_type, quantity, trade_price, mark_price, mtm_pnl, currency
            FROM option_eae ORDER BY date DESC
        ''')
    return [{
        'date': row[0], 'symbol': row[1], 'description': row[2], 'underlyingSymbol': row[3],
        'strike': row[4], 'expiry': row[5], 'putCall': row[6], 'transactionType': row[7],
        'quantity': row[8], 'tradePrice': row[9], 'markPrice': row[10], 'mtmPnl': row[11], 'currency': row[12]
    } for row in cursor.fetchall()]


def get_performance(conn, account_id=None, latest_date=None):
    cursor = conn.cursor()
    if account_id:
        cursor.execute('''
            SELECT starting_value, ending_value, mtm, realized, dividends, interest, commissions, twr
            FROM daily_nav WHERE account_id = ? AND date = ?
        ''', (account_id, latest_date))
        row = cursor.fetchone()
        twr_val = row[7] or 0 if row else 0
    else:
        cursor.execute('''
            SELECT SUM(starting_value), SUM(ending_value), SUM(mtm), SUM(realized),
                   SUM(dividends), SUM(interest), SUM(commissions)
            FROM daily_nav
            WHERE date = ?
        ''', (latest_date,))
        row = cursor.fetchone()
        starting = safe_float(row[0]) if row else 0
        ending = safe_float(row[1]) if row else 0
        cursor.execute('''
            SELECT SUM(CAST(deposits_withdrawals AS REAL))
            FROM archive_change_in_nav
            WHERE stmt_date = ?
        ''', (latest_date,))
        dep_row = cursor.fetchone()
        deposit = safe_float(dep_row[0]) if dep_row else 0
        if starting != 0:
            twr_val = ((ending - starting - deposit) / starting) * 100
        else:
            twr_val = 0.0
        # combined 模式下 mtm/realized/dividends/interest/commissions 展示累计值，避免单日为 0
        cursor.execute('''
            SELECT SUM(CAST(mtm AS REAL)), SUM(CAST(realized AS REAL)),
                   SUM(CAST(dividends AS REAL)), SUM(CAST(interest AS REAL)),
                   SUM(CAST(commissions AS REAL))
            FROM archive_change_in_nav
        ''')
        cum = cursor.fetchone() or (0, 0, 0, 0, 0)
        if row:
            row = (row[0], row[1], safe_float(cum[0]), safe_float(cum[1]),
                   safe_float(cum[2]), safe_float(cum[3]), safe_float(cum[4]))
    if row and row[0] is not None:
        return {
            'startingValue': row[0] or 0,
            'endingValue': row[1] or 0,
            'mtm': row[2] or 0,
            'realized': row[3] or 0,
            'dividends': row[4] or 0,
            'interest': row[5] or 0,
            'commissions': row[6] or 0,
            'twr': twr_val
        }
    return {}


def get_true_performance(conn, account_id=None):
    """计算真实业绩（投入本金 = 初始净值 + 累计外部现金流，基于 twr 反推）"""
    flow_series = get_flow_series(conn, account_id)
    if not flow_series:
        return {
            'latestEnding': 0, 'initialCapital': 0, 'investedCapital': 0,
            'netDeposits': 0, 'netTransfers': 0, 'totalGain': 0,
            'totalGainPct': 0, 'firstDate': None
        }
    
    initial_capital = 0
    for date, flow, ending in flow_series:
        if ending != 0:
            initial_capital = ending
            break
    
    total_flow = sum(f for d, f, e in flow_series)
    latest_ending = flow_series[-1][2]
    invested = initial_capital + total_flow
    total_gain = latest_ending - invested
    gain_pct = (total_gain / invested * 100) if invested != 0 else 0
    
    return {
        'latestEnding': latest_ending,
        'initialCapital': initial_capital,
        'investedCapital': invested,
        'netDeposits': total_flow,
        'netTransfers': 0,
        'totalGain': total_gain,
        'totalGainPct': gain_pct,
        'firstDate': flow_series[0][0]
    }


def get_flow_summary(conn, account_id=None):
    cursor = conn.cursor()
    if account_id:
        cursor.execute('''
            SELECT SUM(deposits_withdrawals), SUM(dividends), SUM(interest), 
                   SUM(commissions + other_fees + broker_fees), SUM(fx_translation)
            FROM archive_change_in_nav 
            WHERE stmt_account_id = ?
        ''', (account_id,))
    else:
        cursor.execute('''
            SELECT SUM(deposits_withdrawals), SUM(dividends), SUM(interest), 
                   SUM(commissions + other_fees + broker_fees), SUM(fx_translation)
            FROM archive_change_in_nav
        ''')
    row = cursor.fetchone()
    if row:
        return {
            'depositsWithdrawals': round(float(row[0] or 0), 2),
            'dividends': round(float(row[1] or 0), 2),
            'interest': round(float(row[2] or 0), 2),
            'fees': round(float(row[3] or 0), 2),
            'fxTranslation': round(float(row[4] or 0), 2)
        }
    return {}


def get_trades(conn, account_id=None, limit=2000):
    cursor = conn.cursor()
    sql = '''
        SELECT trade_date, symbol, buy_sell, quantity, trade_price, proceeds,
               fifo_pnl_realized, asset_category, currency, description, mtm_pnl, notes,
               open_close_indicator
        FROM archive_trade
        WHERE {where}
        ORDER BY trade_date DESC
        LIMIT ?
    '''
    params = [limit]
    if account_id:
        where = 'stmt_account_id = ?'
        params.insert(0, account_id)
    else:
        where = '1=1'
    cursor.execute(sql.format(where=where), params)
    return [{
        'tradeDate': row[0], 'date': row[0], 'symbol': row[1], 'buySell': row[2],
        'quantity': row[3], 'tradePrice': row[4], 'proceeds': row[5],
        'realizedPnl': row[6], 'assetCategory': row[7], 'currency': row[8], 'description': row[9],
        'mtmPnl': safe_float(row[10]) if row[10] is not None else 0.0,
        'notes': row[11] or '',
        'openCloseIndicator': row[12] or ''
    } for row in cursor.fetchall()]


def get_daily_pnl(nav_all, flow_map=None, flex_pnl_map=None):
    """每日盈亏。
    pnl      = NAV 差 - 当日外部现金流（含 FX translation，钱包口径）
    pnlFlex  = daily_nav 的 mtm+realized+dividends+interest+commissions（Flex 五列口径，不含 FX）
    """
    s = _nav_to_series(nav_all)
    if s.empty:
        return []
    diff = s.diff().dropna()
    valid = ~((s.shift(1).fillna(0) == 0) & (s == 0))
    diff = diff[valid]
    result = []
    for d, v in diff.items():
        date_str = d.strftime('%Y-%m-%d')
        flow = flow_map.get(date_str, 0.0) if flow_map else 0.0
        real_pnl = v - flow
        row = {'date': date_str, 'pnl': round(real_pnl, 2)}
        if flex_pnl_map is not None and date_str in flex_pnl_map:
            row['pnlFlex'] = round(flex_pnl_map[date_str], 2)
        result.append(row)
    return result


def get_position_changes(conn, account_id=None):
    """对比最近两个交易日的持仓变化，返回市值、数量变动"""
    cursor = conn.cursor()
    where = 'account_id = ?' if account_id else '1=1'
    where_stmt = 'stmt_account_id = ?' if account_id else '1=1'
    params = (account_id,) if account_id else ()
    cursor.execute(f'''
        SELECT DISTINCT date FROM positions WHERE {where} ORDER BY date DESC LIMIT 2
    ''', params)
    dates = [r[0] for r in cursor.fetchall()]
    if len(dates) < 2:
        return {'latestDate': dates[0] if dates else None, 'prevDate': None, 'changes': []}
    latest_date, prev_date = dates[0], dates[1]

    cursor.execute(f'''
        SELECT symbol, description,
               COALESCE(position_value_in_base, position_value) AS position_value,
               COALESCE(mark_price_in_base, mark_price) AS mark_price
        FROM positions WHERE {where} AND date = ?
    ''', params + (latest_date,))
    latest_map = {r[0]: {'description': r[1], 'positionValue': safe_float(r[2]) if r[2] is not None else 0,
                         'markPrice': safe_float(r[3]) if r[3] is not None else 0} for r in cursor.fetchall()}

    cursor.execute(f'''
        SELECT symbol, description,
               COALESCE(position_value_in_base, position_value) AS position_value,
               COALESCE(mark_price_in_base, mark_price) AS mark_price
        FROM positions WHERE {where} AND date = ?
    ''', params + (prev_date,))
    prev_map = {r[0]: {'description': r[1], 'positionValue': safe_float(r[2]) if r[2] is not None else 0,
                       'markPrice': safe_float(r[3]) if r[3] is not None else 0} for r in cursor.fetchall()}

    all_symbols = set(latest_map.keys()) | set(prev_map.keys())
    changes = []
    for sym in all_symbols:
        l = latest_map.get(sym, {'description': prev_map.get(sym, {}).get('description'), 'positionValue': 0, 'markPrice': 0})
        p = prev_map.get(sym, {'description': l.get('description'), 'positionValue': 0, 'markPrice': 0})
        qty_l = l['positionValue'] / l['markPrice'] if l['markPrice'] else 0
        qty_p = p['positionValue'] / p['markPrice'] if p['markPrice'] else 0
        pv_diff = l['positionValue'] - p['positionValue']
        qty_diff = qty_l - qty_p
        if abs(pv_diff) < 0.01 and abs(qty_diff) < 0.0001:
            continue
        changes.append({
            'symbol': sym,
            'description': l['description'] or p['description'] or sym,
            'latestValue': round(l['positionValue'], 2),
            'prevValue': round(p['positionValue'], 2),
            'valueDiff': round(pv_diff, 2),
            'latestQty': round(qty_l, 4),
            'prevQty': round(qty_p, 4),
            'qtyDiff': round(qty_diff, 4),
            'latestMarkPrice': round(l['markPrice'], 4) if l['markPrice'] else (round(p['markPrice'], 4) if p['markPrice'] else 0),
            'action': '新增' if sym not in prev_map else ('清仓' if sym not in latest_map else ('增持' if qty_diff > 0 else '减持'))
        })
    changes.sort(key=lambda x: abs(x['valueDiff']), reverse=True)
    return {'latestDate': latest_date, 'prevDate': prev_date, 'changes': changes}


def get_latest_day_trades(conn, account_id=None):
    """获取最近一个交易日的交易记录"""
    cursor = conn.cursor()
    where = 'stmt_account_id = ?' if account_id else '1=1'
    params = (account_id,) if account_id else ()
    cursor.execute(f'''
        SELECT MAX(trade_date) FROM archive_trade WHERE {where}
    ''', params)
    row = cursor.fetchone()
    latest_trade_date = row[0] if row else None
    if not latest_trade_date:
        return {'tradeDate': None, 'trades': []}
    cursor.execute(f'''
        SELECT trade_date, symbol, buy_sell, quantity, trade_price, proceeds,
               fifo_pnl_realized, asset_category, currency, description, mtm_pnl, notes,
               open_close_indicator
        FROM archive_trade
        WHERE {where} AND trade_date = ?
        ORDER BY symbol, buy_sell
    ''', params + (latest_trade_date,))
    trades = []
    for r in cursor.fetchall():
        qty = safe_float(r[3])
        trades.append({
            'tradeDate': r[0], 'symbol': r[1], 'buySell': r[2],
            'quantity': qty, 'tradePrice': safe_float(r[4]),
            'proceeds': safe_float(r[5]), 'realizedPnl': safe_float(r[6]) if r[6] is not None else None,
            'assetCategory': r[7], 'currency': r[8], 'description': r[9],
            'mtmPnl': safe_float(r[10]) if r[10] is not None else 0.0,
            'notes': r[11] or '',
            'openCloseIndicator': r[12] or ''
        })
    return {'tradeDate': latest_trade_date, 'trades': trades}


def get_cost_basis_holdings(conn, account_id=None):
    """获取当前持仓的成本分析（移动加权 vs 摊薄）"""
    cursor = conn.cursor()
    where_cb = 'account_id = ?' if account_id else '1=1'
    where_pos = 'account_id = ?' if account_id else '1=1'
    params = (account_id,) if account_id else ()

    cursor.execute(f'''
        SELECT symbol, total_qty, total_cost_avg, total_cost_diluted, last_trade_date
        FROM cost_basis_snapshots
        WHERE {where_cb}
    ''', params)
    cb_map = {}
    for r in cursor.fetchall():
        qty = safe_float(r[1])
        cb_map[r[0]] = {
            'symbol': r[0],
            'totalQty': qty,
            'totalCostAvg': safe_float(r[2]),
            'totalCostDiluted': safe_float(r[3]),
            'lastTradeDate': r[4],
            'avgCostPrice': safe_float(r[2]) / qty if qty else 0,
            'dilutedCostPrice': safe_float(r[3]) / qty if qty else 0,
        }

    cursor.execute(f'''
        SELECT p.symbol, p.description, p.asset_type, p.position_value, p.mark_price
        FROM positions p
        WHERE {where_pos} AND p.date = (SELECT MAX(date) FROM positions WHERE {where_pos})
    ''', params + (params if account_id else ()))
    holdings = []
    for r in cursor.fetchall():
        sym = r[0]
        cb = cb_map.get(sym, {})
        pv = safe_float(r[3]) if r[3] is not None else 0
        qty = cb.get('totalQty', 0)
        if abs(qty) < 0.0001 and abs(pv) < 0.01:
            continue
        avg_cost = cb.get('totalCostAvg', 0)
        diluted_cost = cb.get('totalCostDiluted', 0)
        mwa_pnl = pv - avg_cost
        diluted_pnl = pv - diluted_cost
        avg_price = cb.get('avgCostPrice', 0)
        diluted_price = cb.get('dilutedCostPrice', 0)
        mwa_pct = (mwa_pnl / avg_cost * 100) if avg_cost else 0
        diluted_pct = (diluted_pnl / diluted_cost * 100) if diluted_cost else 0
        holdings.append({
            'symbol': sym,
            'description': r[1] or sym,
            'assetType': r[2] or 'STK',
            'currentQty': round(qty, 4),
            'currentValue': round(pv, 2),
            'markPrice': round(safe_float(r[4]), 4) if r[4] is not None else 0,
            'avgCostBasis': round(avg_cost, 2),
            'avgCostPrice': round(avg_price, 4),
            'dilutedCostBasis': round(diluted_cost, 2),
            'dilutedCostPrice': round(diluted_price, 4),
            'mwaPnl': round(mwa_pnl, 2),
            'mwaPct': round(mwa_pct, 2),
            'dilutedPnl': round(diluted_pnl, 2),
            'dilutedPct': round(diluted_pct, 2),
        })
    holdings.sort(key=lambda x: abs(x['currentValue']), reverse=True)
    return holdings


def get_sold_positions_analysis(conn, account_id=None, lookback_days=30):
    """分析近期卖出：按移动加权成本和摊薄成本分别计算盈亏"""
    cursor = conn.cursor()
    where_stmt = 'stmt_account_id = ?' if account_id else '1=1'
    where_cb = 'account_id = ?' if account_id else '1=1'
    params = (account_id,) if account_id else ()
    from datetime import datetime, timedelta
    cutoff = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y%m%d')

    cursor.execute(f'''
        SELECT trade_date, symbol, buy_sell, quantity, trade_price, proceeds, mtm_pnl, currency, description
        FROM archive_trade
        WHERE {where_stmt} AND trade_date >= ? AND buy_sell = 'SELL'
        ORDER BY trade_date DESC, symbol
    ''', params + (cutoff,))
    rows = cursor.fetchall()
    if not rows:
        return []

    # 读取 cost_basis_history 获取卖出时的成本（修复后每条记录为该事件应用后的中间状态）
    cursor.execute(f'''
        SELECT symbol, trade_date, total_qty, total_cost_avg, total_cost_diluted, event_type
        FROM cost_basis_history
        WHERE {where_cb}
        ORDER BY symbol, trade_date
    ''', params)
    cb_history = {}
    for r in cursor.fetchall():
        sym = r[0]
        if sym not in cb_history:
            cb_history[sym] = []
        cb_history[sym].append({
            'tradeDate': r[1],
            'totalQty': safe_float(r[2]),
            'totalCostAvg': safe_float(r[3]),
            'totalCostDiluted': safe_float(r[4]),
            'eventType': r[5]
        })

    sold_map = {}
    for r in rows:
        sym = r[1]
        qty = abs(safe_float(r[3]))
        proceeds = safe_float(r[5])
        trade_date = r[0]
        key = (sym, trade_date)
        if key not in sold_map:
            sold_map[key] = {
                'symbol': sym,
                'description': r[8] or sym,
                'tradeDate': trade_date,
                'currency': r[7] or 'USD',
                'totalQty': 0,
                'totalProceeds': 0,
                'avgPrice': 0,
                'mtmPnl': 0,
            }
        sold_map[key]['totalQty'] += qty
        sold_map[key]['totalProceeds'] += proceeds
        sold_map[key]['mtmPnl'] += safe_float(r[6]) if r[6] is not None else 0

    # 为没有 cost_basis_history 的 symbol 准备简单 fallback 成本（从 archive_trade BUY 记录累计）
    missing_symbols = {item['symbol'] for item in sold_map.values()} - set(cb_history.keys())
    fallback_costs = {}
    if missing_symbols:
        placeholders = ','.join('?' * len(missing_symbols))
        cursor.execute(f'''
            SELECT symbol, buy_sell, quantity, trade_money, ib_commission, taxes
            FROM archive_trade
            WHERE {where_stmt} AND symbol IN ({placeholders})
            ORDER BY symbol, trade_date
        ''', params + tuple(missing_symbols))
        sym_events = {}
        for r in cursor.fetchall():
            sym = r[0]
            bs = r[1]
            qty = abs(safe_float(r[2]))
            tm = abs(safe_float(r[3]))
            comm = abs(safe_float(r[4])) if r[4] else 0
            tax = abs(safe_float(r[5])) if r[5] else 0
            cost = tm + comm + tax
            if sym not in sym_events:
                sym_events[sym] = {'buy_qty': 0, 'buy_cost': 0}
            if bs == 'BUY':
                sym_events[sym]['buy_qty'] += qty
                sym_events[sym]['buy_cost'] += cost
        for sym, ev in sym_events.items():
            if ev['buy_qty'] > 0:
                fallback_costs[sym] = {
                    'avg_price': ev['buy_cost'] / ev['buy_qty'],
                    'total_cost': ev['buy_cost']
                }

    results = []
    for item in sold_map.values():
        sym = item['symbol']
        qty = item['totalQty']
        proceeds = item['totalProceeds']
        avg_price = proceeds / qty if qty else 0
        hist = cb_history.get(sym, [])

        # 查找卖出前状态：找到 sell_date 当天的第一条 SELL/TRANSFER_OUT 记录，取它前一条
        pre_state = None
        for i, h in enumerate(hist):
            if h['tradeDate'] > item['tradeDate']:
                break
            if h['tradeDate'] == item['tradeDate'] and h['eventType'] in ('SELL', 'TRANSFER_OUT'):
                if i > 0:
                    pre_state = hist[i - 1]
                break
            pre_state = h

        if pre_state and pre_state['totalQty'] > 0 and pre_state['totalQty'] >= qty * 0.99:
            pre_cost_avg = pre_state['totalCostAvg']
            pre_cost_diluted = pre_state['totalCostDiluted']
            prev_qty = pre_state['totalQty']
        else:
            # fallback: 尝试用 archive_trade 的 BUY 计算简单平均
            fc = fallback_costs.get(sym)
            if fc and fc["total_cost"] > 0:
                pre_cost_avg = fc['total_cost']
                pre_cost_diluted = fc['total_cost']
                prev_qty = qty
            else:
                # 完全无成本数据，用 proceeds 使盈亏为 0
                pre_cost_avg = proceeds
                pre_cost_diluted = proceeds
                prev_qty = qty

        cost_ratio = min(qty / prev_qty, 1.0) if prev_qty > 0 else 1.0
        sold_cost_avg = pre_cost_avg * cost_ratio
        sold_cost_diluted = pre_cost_diluted * cost_ratio

        mwa_pnl = proceeds - sold_cost_avg
        diluted_pnl = proceeds - sold_cost_diluted
        mwa_pct = (mwa_pnl / sold_cost_avg * 100) if sold_cost_avg else 0
        diluted_pct = (diluted_pnl / sold_cost_diluted * 100) if sold_cost_diluted else 0

        results.append({
            'symbol': sym,
            'description': item['description'],
            'tradeDate': item['tradeDate'],
            'currency': item['currency'],
            'soldQty': round(qty, 4),
            'proceeds': round(proceeds, 2),
            'avgSellPrice': round(avg_price, 4),
            'mwaCost': round(sold_cost_avg, 2),
            'mwaPnl': round(mwa_pnl, 2),
            'mwaPct': round(mwa_pct, 2),
            'dilutedCost': round(sold_cost_diluted, 2),
            'dilutedPnl': round(diluted_pnl, 2),
            'dilutedPct': round(diluted_pct, 2),
            'mtmPnl': round(item['mtmPnl'], 2),
        })
    results.sort(key=lambda x: x['tradeDate'], reverse=True)
    return results


def get_trade_pnl_analysis(trades):
    """已实现盈亏分析。优先用 IB 标好的 fifo_pnl_realized；
    回退 mtm_pnl 仅在持仓方向反转且 IB 未填 fifo 时使用。
    Assignment / Exercise（notes 含 'A' 或 'Ex'）即使建仓方向也按平仓计入，
    防止 short option 被指派后股票腿因 pos==0 漏算。"""
    from collections import defaultdict

    # 重建持仓以识别平仓交易
    holdings = defaultdict(float)
    closing_trades = []

    # trades 是按日期降序的，我们需要按日期升序处理
    sorted_trades = sorted(trades, key=lambda t: (t.get('date') or '9999-12-31', t.get('tradeId') or ''))

    for t in sorted_trades:
        qty = safe_float(t.get('quantity', 0))
        if qty == 0:
            continue
        mtm = safe_float(t.get('mtmPnl', 0))
        realized_raw = t.get('realizedPnl')
        try:
            realized = float(realized_raw) if realized_raw not in (None, '') else None
        except (TypeError, ValueError):
            realized = None
        notes = (t.get('notes') or '').upper()
        is_corporate = ('A' in notes) or ('EX' in notes) or ('EP' in notes)  # Assignment / Exercise / Expired
        has_realized = realized is not None and realized != 0

        symbol = t.get('symbol', 'OTHER')
        cat = (t.get('assetCategory') or 'OTHER').upper()
        pos = holdings[symbol]
        direction_closing = pos != 0 and (qty > 0) != (pos > 0)
        is_closing = direction_closing or has_realized or is_corporate

        if is_closing:
            if realized is not None:
                # IB 已经按 FIFO 算好的真实平仓盈亏（含 0），权威口径
                closing_pnl = realized
            elif direction_closing:
                # IB 未填 fifo，回退按比例缩放 mtm
                closed_qty = min(abs(qty), abs(pos))
                closing_pnl = mtm * (closed_qty / abs(qty))
            else:
                closing_pnl = mtm
            closing_trades.append({
                'symbol': symbol,
                'assetCategory': cat,
                'mtmPnl': closing_pnl,
                'date': t.get('date')
            })
        holdings[symbol] += qty

    # 总体统计
    total_pnl = sum(t['mtmPnl'] for t in closing_trades)
    profit_trades = [t for t in closing_trades if t['mtmPnl'] > 0]
    loss_trades = [t for t in closing_trades if t['mtmPnl'] < 0]
    zero_trades = [t for t in closing_trades if t['mtmPnl'] == 0]

    profit_count = len(profit_trades)
    loss_count = len(loss_trades)
    total_count = profit_count + loss_count + len(zero_trades)

    avg_profit = sum(t['mtmPnl'] for t in profit_trades) / profit_count if profit_count else 0
    avg_loss = sum(t['mtmPnl'] for t in loss_trades) / loss_count if loss_count else 0

    # 按 symbol 统计
    symbol_stats = defaultdict(lambda: {'profit': 0.0, 'loss': 0.0, 'win': 0, 'loss': 0, 'total': 0})
    for t in closing_trades:
        s = symbol_stats[t['symbol']]
        s['total'] += 1
        if t['mtmPnl'] > 0:
            s['profit'] += t['mtmPnl']
            s['win'] += 1
        elif t['mtmPnl'] < 0:
            s['loss'] += t['mtmPnl']
            s['loss_count'] = s.get('loss_count', 0) + 1
        else:
            s['loss_count'] = s.get('loss_count', 0)

    symbol_list = []
    for sym, s in symbol_stats.items():
        symbol_list.append({
            'symbol': sym,
            'totalPnl': round(s['profit'] + s['loss'], 2),
            'profit': round(s['profit'], 2),
            'loss': round(abs(s['loss']), 2),
            'winRate': round(s['win'] / s['total'] * 100, 1) if s['total'] else 0,
            'tradeCount': s['total']
        })

    # 按资产类别统计
    asset_stats = defaultdict(lambda: {'profit': 0.0, 'loss': 0.0})
    for t in closing_trades:
        a = asset_stats[t['assetCategory']]
        if t['mtmPnl'] > 0:
            a['profit'] += t['mtmPnl']
        elif t['mtmPnl'] < 0:
            a['loss'] += t['mtmPnl']

    asset_list = []
    for cat, a in asset_stats.items():
        asset_list.append({
            'category': cat,
            'profit': round(a['profit'], 2),
            'loss': round(abs(a['loss']), 2),
            'total': round(a['profit'] + a['loss'], 2)
        })

    return {
        'totalPnl': round(total_pnl, 2),
        'profitCount': profit_count,
        'lossCount': loss_count,
        'totalCount': total_count,
        'winRate': round(profit_count / total_count * 100, 1) if total_count else 0,
        'profitLossRatio': round(abs(avg_profit / avg_loss), 2) if avg_loss != 0 else (999 if avg_profit > 0 else 0),
        'avgProfit': round(avg_profit, 2),
        'avgLoss': round(avg_loss, 2),
        'symbolStats': sorted(symbol_list, key=lambda x: x['totalPnl'], reverse=True),
        'assetStats': asset_list
    }


def get_trade_behavior_analysis(trades):
    """交易行为深度分析：持仓周期、择时、无效交易识别"""
    if not trades:
        return {}
    df = pd.DataFrame(trades)
    if df.empty:
        return {}
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df.dropna(subset=['date'])
    df['qty'] = pd.to_numeric(df.get('quantity', 0), errors='coerce').fillna(0)
    df['mtmPnl'] = pd.to_numeric(df.get('mtmPnl', 0), errors='coerce').fillna(0)
    df['realizedPnl'] = pd.to_numeric(df.get('realizedPnl', 0), errors='coerce').fillna(0)
    if 'notes' not in df.columns:
        df['notes'] = ''
    df['notes'] = df['notes'].fillna('').astype(str).str.upper()

    # 已实现盈亏：fifo 优先 + Assignment/Exercise 旁路 pos==0
    from collections import defaultdict
    holdings = defaultdict(float)
    close_events = []
    sorted_df = df.sort_values('date')
    for _, row in sorted_df.iterrows():
        qty = row['qty']
        symbol = row['symbol'] or 'OTHER'
        if qty == 0:
            continue
        pos = holdings[symbol]
        notes = row['notes']
        is_corporate = ('A' in notes) or ('EX' in notes) or ('EP' in notes)
        realized = row['realizedPnl']
        has_realized = realized != 0
        direction_closing = pos != 0 and (qty > 0) != (pos > 0)
        is_closing = direction_closing or has_realized or is_corporate
        if is_closing:
            if has_realized:
                closing_pnl = realized
            elif direction_closing:
                closed_qty = min(abs(qty), abs(pos))
                closing_pnl = row['mtmPnl'] * (closed_qty / abs(qty))
            else:
                closing_pnl = row['mtmPnl']
            close_events.append({'symbol': symbol, 'date': row['date'], 'mtmPnl': closing_pnl, 'assetCategory': row.get('assetCategory', 'OTHER')})
        holdings[symbol] += qty

    close_df = pd.DataFrame(close_events)
    if close_df.empty:
        return {'monthlyTradePerformance': [], 'timingCurve': {}, 'inefficientTrades': []}

    # 持仓周期分布（用 trade_date 估算，实际应从建仓日到平仓日；这里简化为按交易密度估算）
    # 由于没有精确的建仓日期，改用 close_events 的月度统计代替
    monthly_perf = close_df.set_index('date').resample('ME')['mtmPnl'].agg(['count', 'sum', 'mean'])
    monthly_perf = monthly_perf.reset_index()
    monthly_perf['month'] = monthly_perf['date'].dt.strftime('%Y-%m')
    monthly_perf = monthly_perf[monthly_perf['count'] > 0]

    # 择时曲线：买入后不同持有期收益（简化为月度收益分布）
    def _safe_num(v):
        if isinstance(v, (float, np.floating)) and (math.isnan(v) or math.isinf(v)):
            return 0.0
        return v

    timing = {
        'labels': [_safe_num(m) for m in monthly_perf['month'].tolist()],
        'counts': [int(_safe_num(c)) for c in monthly_perf['count'].tolist()],
        'avgPnl': [round(_safe_num(v), 2) for v in monthly_perf['mean'].tolist()]
    }

    # 无效交易：胜率 < 50% 且盈亏比 < 1 的交易类型/月份
    inefficient = []
    cat_stats = close_df.groupby('assetCategory')['mtmPnl'].agg(['count', lambda x: (x > 0).sum(), 'sum'])
    cat_stats.columns = ['total', 'wins', 'pnl']
    for cat, row in cat_stats.iterrows():
        wr = row['wins'] / row['total'] * 100 if row['total'] else 0
        avg_p = close_df[(close_df['assetCategory'] == cat) & (close_df['mtmPnl'] > 0)]['mtmPnl'].mean()
        avg_l = close_df[(close_df['assetCategory'] == cat) & (close_df['mtmPnl'] < 0)]['mtmPnl'].mean()
        avg_p = 0.0 if pd.isna(avg_p) else float(avg_p)
        avg_l = 0.0 if pd.isna(avg_l) else float(avg_l)
        plr = abs(avg_p / avg_l) if avg_l != 0 else 999
        if wr < 50 and plr < 1 and row['total'] >= 3:
            inefficient.append({'category': cat, 'winRate': round(wr, 1), 'plRatio': round(plr, 2), 'totalTrades': int(row['total'])})

    records = monthly_perf[['month', 'count', 'sum', 'mean']].rename(columns={'count': 'tradeCount', 'sum': 'totalPnl', 'mean': 'avgPnl'}).to_dict('records')
    for r in records:
        for k in r:
            r[k] = _safe_num(r[k])

    return {
        'monthlyTradePerformance': records,
        'timingCurve': timing,
        'inefficientTrades': inefficient,
        'totalCloseTrades': len(close_events)
    }


def get_cost_breakdown(conn, account_id=None):
    """全成本拆解：佣金、SEC费、FINRA费、其他费用"""
    cursor = conn.cursor()
    sql = '''
        SELECT 
            COALESCE(SUM(total_commission), 0),
            COALESCE(SUM(reg_section31_transaction_fee), 0),
            COALESCE(SUM(reg_finra_trading_activity_fee), 0),
            COALESCE(SUM(reg_other), 0),
            COALESCE(SUM(other), 0),
            COALESCE(SUM(broker_execution_charge), 0),
            COALESCE(SUM(third_party_execution_charge), 0),
            COALESCE(SUM(third_party_clearing_charge), 0),
            COALESCE(SUM(third_party_regulatory_charge), 0)
        FROM archive_unbundled_commission_detail
        WHERE {where}
    '''
    if account_id:
        cursor.execute(sql.format(where='stmt_account_id = ?'), (account_id,))
    else:
        cursor.execute(sql.format(where='1=1'))
    row = cursor.fetchone()
    total_cost = sum(abs(safe_float(v)) for v in row)
    return {
        'totalCommission': safe_float(row[0]),
        'secFee': safe_float(row[1]),
        'finraFee': safe_float(row[2]),
        'regOther': safe_float(row[3]),
        'other': safe_float(row[4]),
        'brokerExecution': safe_float(row[5]),
        'thirdPartyExecution': safe_float(row[6]),
        'thirdPartyClearing': safe_float(row[7]),
        'thirdPartyRegulatory': safe_float(row[8]),
        'totalCost': round(total_cost, 2)
    }


def get_leverage_metrics(conn, account_id=None):
    """杠杆与资金效率：融资利息、做空成本、现金闲置"""
    cursor = conn.cursor()
    # 最新权益摘要（取最近一日）
    es_sql = '''
        SELECT report_date, cash, total, stock
        FROM archive_equity_summary_by_report_date_in_base
        WHERE {where}
        ORDER BY report_date DESC
        LIMIT 1
    '''
    if account_id:
        cursor.execute(es_sql.format(where='stmt_account_id = ?'), (account_id,))
    else:
        cursor.execute(es_sql.format(where='1=1'))
    es_row = cursor.fetchone()

    # 利息应计（融资成本）
    int_sql = '''
        SELECT COALESCE(SUM(interest_accrued), 0)
        FROM archive_interest_accruals_currency
        WHERE {where}
    '''
    if account_id:
        cursor.execute(int_sql.format(where='stmt_account_id = ?'), (account_id,))
    else:
        cursor.execute(int_sql.format(where='1=1'))
    interest_cost = safe_float(cursor.fetchone()[0])

    # 做空成本：NetStockPosition 中 shares_borrowed > 0 的标的
    short_sql = '''
        SELECT COALESCE(SUM(CAST(shares_borrowed AS REAL)), 0)
        FROM archive_net_stock_position
        WHERE {where}
    '''
    if account_id:
        cursor.execute(short_sql.format(where='stmt_account_id = ? AND CAST(shares_borrowed AS REAL) > 0'), (account_id,))
    else:
        cursor.execute(short_sql.format(where='CAST(shares_borrowed AS REAL) > 0'))
    short_shares = safe_float(cursor.fetchone()[0])

    net_liq = safe_float(es_row[2]) if es_row else 0
    stock_mv = safe_float(es_row[3]) if es_row else 0
    leverage = (stock_mv / net_liq) if net_liq else 0

    return {
        'netLiquidation': round(net_liq, 2),
        'stockMarketValue': round(stock_mv, 2),
        'leverageRatio': round(leverage, 2),
        'totalInterestCost': round(abs(interest_cost), 2),
        'shortSharesTotal': round(short_shares, 0),
        'asOfDate': es_row[0] if es_row else None
    }


def get_tax_summary(conn, account_id=None):
    """基础税务：短期/长期资本利得分类（基于持仓周期 > 365 天）"""
    cursor = conn.cursor()
    # 这里用 archive_trade 的 fifo_pnl_realized 和交易日期做简化估算
    # 真实 Tax Lot 数据需要更详细的 FIFO 表，这里用 open/prior 表做近似
    sql = '''
        SELECT 
            t.fifo_pnl_realized,
            t.trade_date,
            p.open_date
        FROM archive_trade t
        LEFT JOIN (
            SELECT symbol, stmt_account_id, MIN(date) as open_date
            FROM archive_prior_period_position
            GROUP BY symbol, stmt_account_id
        ) p 
            ON t.symbol = p.symbol AND t.stmt_account_id = p.stmt_account_id
        WHERE t.fifo_pnl_realized IS NOT NULL AND t.fifo_pnl_realized != 0 AND {where}
    '''
    if account_id:
        cursor.execute(sql.format(where='t.stmt_account_id = ?'), (account_id,))
    else:
        cursor.execute(sql.format(where='1=1'))

    short_term = 0.0
    long_term = 0.0
    for row in cursor.fetchall():
        pnl = safe_float(row[0])
        trade_date = row[1]
        open_date = row[2]
        if open_date and trade_date:
            try:
                td = datetime.strptime(str(trade_date)[:10], '%Y-%m-%d')
                od = datetime.strptime(str(open_date)[:10], '%Y-%m-%d')
                days = (td - od).days
                if days > 365:
                    long_term += pnl
                else:
                    short_term += pnl
            except Exception:
                short_term += pnl
        else:
            short_term += pnl

    return {
        'shortTermGain': round(short_term, 2),
        'longTermGain': round(long_term, 2),
        'totalRealizedGain': round(short_term + long_term, 2)
    }


def get_risk_metrics(nav_all, ann_return_pct):
    """风险指标：卡玛比率、索提诺比率、连续盈亏月份"""
    s = _nav_to_series(sanitize_nav_list(nav_all))
    if s.empty or len(s) < 2:
        return {'calmarRatio': 0, 'sortinoRatio': 0, 'maxConsecutiveWinMonths': 0, 'maxConsecutiveLossMonths': 0}

    returns = s.pct_change().dropna()
    if returns.empty:
        return {'calmarRatio': 0, 'sortinoRatio': 0, 'maxConsecutiveWinMonths': 0, 'maxConsecutiveLossMonths': 0}

    # Calmar = 年化收益 / 最大回撤
    max_dd = calc_max_drawdown(nav_all)  # 已经是百分比
    calmar = (ann_return_pct / max_dd) if max_dd else 0

    # Sortino = 年化收益 / 下行波动率
    downside = returns[returns < 0]
    downside_std = downside.std() * np.sqrt(252) if not downside.empty else 0.0
    sortino = (returns.mean() * 252 / downside_std) if downside_std and not math.isnan(downside_std) else 0.0

    # 连续盈亏月份
    monthly = s.resample('ME').last().pct_change(fill_method=None).dropna()
    monthly_positive = (monthly > 0).astype(int)
    monthly_negative = (monthly < 0).astype(int)

    def max_consecutive(series):
        if series.empty:
            return 0
        max_streak = 0
        current = 0
        for v in series:
            if v:
                current += 1
                max_streak = max(max_streak, current)
            else:
                current = 0
        return max_streak

    return {
        'calmarRatio': round(calmar, 2),
        'sortinoRatio': round(sortino, 2),
        'maxConsecutiveWinMonths': max_consecutive(monthly_positive),
        'maxConsecutiveLossMonths': max_consecutive(monthly_negative)
    }


def get_monthly_returns(nav_all):
    """月度收益序列，用于热力图"""
    s = _nav_to_series(nav_all)
    if s.empty:
        return []
    monthly = s.resample('ME').last().pct_change(fill_method=None).dropna()
    result = []
    for d, v in monthly.items():
        ret = v * 100
        if math.isnan(ret) or math.isinf(ret):
            ret = 0.0
        result.append({'month': d.strftime('%Y-%m'), 'return': round(ret, 2)})
    return result


def get_monthly_real_gains(nav_all, flow_map):
    """月度真实收益（扣除出入金），用于月度收益柱状图"""
    if not nav_all:
        return []
    monthly = {}
    for n in nav_all:
        date = n['date']
        key = date[:7]
        if key not in monthly:
            monthly[key] = {'first': n['nav'], 'last': n['nav'], 'flow': 0.0}
        monthly[key]['last'] = n['nav']
        monthly[key]['flow'] += flow_map.get(date, 0.0)
    result = []
    for key in sorted(monthly.keys()):
        m = monthly[key]
        gain = m['last'] - m['first'] - m['flow']
        result.append({'month': key, 'gain': round(gain, 2)})
    return result


def get_position_attribution(conn, account_id=None):
    """持仓集中度与收益贡献分析（去重 + FX 转换 + unrealizedPnl 估算）"""
    cursor = conn.cursor()

    def _fx_map(acc, stmt_date):
        fx_map = {}
        cursor.execute('''
            SELECT from_currency, rate FROM archive_conversion_rate
            WHERE stmt_account_id = ? AND stmt_date = ?
        ''', (acc, stmt_date))
        for curr, rate in cursor.fetchall():
            try:
                fx_map[curr] = float(rate)
            except (ValueError, TypeError):
                pass
        return fx_map

    def _fetch_latest(acc):
        cursor.execute('SELECT MAX(stmt_date) FROM archive_open_position WHERE stmt_account_id = ?', (acc,))
        row = cursor.fetchone()
        return row[0] if row else None

    raw_rows = []
    if account_id:
        max_date = _fetch_latest(account_id)
        if max_date:
            fx_map = _fx_map(account_id, max_date)
            cursor.execute('''
                SELECT symbol, description, asset_category, currency, fx_rate_to_base,
                       position_value, fifo_pnl_unrealized, mark_price, cost_basis_price
                FROM archive_open_position
                WHERE stmt_account_id = ? AND stmt_date = ?
            ''', (account_id, max_date))
            for r in cursor.fetchall():
                raw_rows.append((account_id, max_date, r))
    else:
        cursor.execute('SELECT DISTINCT stmt_account_id FROM archive_open_position')
        accounts = [r[0] for r in cursor.fetchall() if r[0]]
        cursor.execute('SELECT MAX(stmt_date) FROM archive_open_position')
        global_max = cursor.fetchone()[0]
        for acc in accounts:
            max_date = _fetch_latest(acc)
            if not max_date:
                continue
            if global_max and max_date:
                try:
                    from datetime import datetime
                    d1 = datetime.strptime(str(global_max), '%Y-%m-%d')
                    d2 = datetime.strptime(str(max_date), '%Y-%m-%d')
                    if (d1 - d2).days > 7:
                        continue
                except Exception:
                    pass
            fx_map = _fx_map(acc, max_date)
            cursor.execute('''
                SELECT symbol, description, asset_category, currency, fx_rate_to_base,
                       position_value, fifo_pnl_unrealized, mark_price, cost_basis_price
                FROM archive_open_position
                WHERE stmt_account_id = ? AND stmt_date = ?
            ''', (acc, max_date))
            for r in cursor.fetchall():
                raw_rows.append((acc, max_date, r))

    # Best-effort fallback: use computed cost basis when IB XML lacks fifo_pnl_unrealized
    cost_map = get_cost_basis(conn, account_id)

    # Aggregate by symbol (deduplicate duplicates from same-date imports)
    agg = {}
    for acc, max_date, r in raw_rows:
        symbol = r[0]
        desc = r[1]
        cat = r[2]
        currency = (r[3] or 'USD').upper()
        fx = safe_float(r[4]) if r[4] is not None else None
        if fx is None:
            fx = _fx_map(acc, max_date).get(currency, 1.0)
        pv_local = safe_float(r[5]) if r[5] is not None else 0
        fifo = safe_float(r[6]) if r[6] is not None else None
        mp_local = safe_float(r[7]) if r[7] is not None else 0
        cbp_local = safe_float(r[8]) if r[8] is not None else 0

        pv = pv_local * fx
        mp = mp_local * fx if mp_local else 0
        cbp = cbp_local * fx if cbp_local else 0
        qty = pv_local / mp_local if mp_local else 0

        # Estimate unrealized PnL if missing
        if fifo is None or fifo == 0:
            if cbp_local and mp_local:
                fifo_est = (mp_local - cbp_local) * qty
                fifo = fifo_est * fx
            else:
                fifo = 0.0
            # Fallback to computed cost basis when XML lacks cost data
            if fifo == 0:
                cb_local = cost_map.get(symbol, {})
                cb_money = cb_local.get('avgCostBasisMoney') or cb_local.get('dilutedCostBasisMoney')
                if cb_money:
                    fifo = pv_local * fx - cb_money * fx
        else:
            fifo = fifo * fx

        if symbol not in agg:
            agg[symbol] = {
                'symbol': symbol,
                'description': desc,
                'assetCategory': cat,
                'currency': currency,
                'marketValue': pv,
                'unrealizedPnl': fifo,
                'markPrice': mp,
                'costBasisPrice': cbp,
                '_qty': qty,
            }
        else:
            existing = agg[symbol]
            existing['marketValue'] += pv
            existing['unrealizedPnl'] += fifo
            existing['_qty'] += qty

    rows = []
    total_mv = 0.0
    for v in agg.values():
        qty = v['_qty']
        v['markPrice'] = (v['marketValue'] / qty) if qty else 0
        v['costBasisPrice'] = ((v['marketValue'] - v['unrealizedPnl']) / qty) if qty else 0
        del v['_qty']
        total_mv += abs(v['marketValue'])
        rows.append(v)

    if not rows:
        return {'positions': [], 'concentration': {}, 'topContributors': [], 'topDrags': [], 'rebalanceSignals': []}

    # 集中度
    sorted_by_mv = sorted(rows, key=lambda x: abs(x['marketValue']), reverse=True)
    top5 = sum(abs(r['marketValue']) for r in sorted_by_mv[:5])
    top10 = sum(abs(r['marketValue']) for r in sorted_by_mv[:10])
    cr5 = round(top5 / total_mv * 100, 1) if total_mv else 0
    cr10 = round(top10 / total_mv * 100, 1) if total_mv else 0

    # 收益贡献榜
    sorted_by_pnl = sorted(rows, key=lambda x: x['unrealizedPnl'], reverse=True)
    contributors = sorted_by_pnl[:10]
    drags = [r for r in sorted_by_pnl[-10:] if r['unrealizedPnl'] < 0]

    # 再平衡信号
    n = len(rows)
    target = 100 / n if n else 0
    rebalance = []
    for r in sorted_by_mv:
        weight = abs(r['marketValue']) / total_mv * 100 if total_mv else 0
        deviation = weight - target
        if abs(deviation) > 5:
            rebalance.append({
                'symbol': r['symbol'],
                'currentWeight': round(weight, 1),
                'targetWeight': round(target, 1),
                'deviation': round(deviation, 1),
                'action': '减持' if deviation > 0 else '增持'
            })

    return {
        'positions': rows,
        'concentration': {'cr5': cr5, 'cr10': cr10, 'totalPositions': n, 'totalMarketValue': round(total_mv, 2)},
        'topContributors': contributors,
        'topDrags': drags,
        'rebalanceSignals': rebalance[:10]
    }


def get_cashflow_waterfall(conn, account_id=None):
    """资金流水瀑布图数据"""
    cursor = conn.cursor()
    sql = '''
        SELECT 
            activity_description,
            COALESCE(SUM(CAST(debit AS REAL)), 0),
            COALESCE(SUM(CAST(credit AS REAL)), 0)
        FROM archive_statement_of_funds_line
        WHERE {where} AND activity_description != ''
        GROUP BY activity_description
    '''
    if account_id:
        cursor.execute(sql.format(where='stmt_account_id = ?'), (account_id,))
    else:
        cursor.execute(sql.format(where='1=1'))

    items = []
    for row in cursor.fetchall():
        desc = row[0]
        debit = safe_float(row[1])
        credit = safe_float(row[2])
        net = round(credit - debit, 2)
        if abs(net) > 0.01:
            items.append({'description': desc, 'net': net})
    items.sort(key=lambda x: abs(x['net']), reverse=True)
    return items[:15]


def get_dividends(conn, account_id=None, limit=2000):
    cursor = conn.cursor()
    sql = '''
        SELECT report_date, symbol, description, amount, currency, type
        FROM archive_cash_transaction
        WHERE {where} AND type IN ('Dividends', 'Payment In Lieu Of Dividends', 'Broker Interest Received', 'Bond Interest Received')
        ORDER BY report_date DESC
        LIMIT ?
    '''
    params = [limit]
    if account_id:
        where = 'stmt_account_id = ?'
        params.insert(0, account_id)
    else:
        where = '1=1'
    cursor.execute(sql.format(where=where), params)
    return [{
        'date': row[0], 'symbol': row[1], 'description': row[2],
        'amount': row[3], 'currency': row[4], 'dividendType': row[5]
    } for row in cursor.fetchall()]


def get_cash_transactions(conn, account_id=None, limit=2000):
    cursor = conn.cursor()
    sql = '''
        SELECT report_date, symbol, description, amount, currency, type
        FROM archive_cash_transaction
        WHERE {where}
        ORDER BY report_date DESC
        LIMIT ?
    '''
    params = [limit]
    if account_id:
        where = 'stmt_account_id = ?'
        params.insert(0, account_id)
    else:
        where = '1=1'
    cursor.execute(sql.format(where=where), params)
    return [{
        'date': row[0], 'symbol': row[1], 'description': row[2],
        'amount': row[3], 'currency': row[4], 'type': row[5]
    } for row in cursor.fetchall()]


def get_transaction_fees(conn, account_id=None, limit=2000):
    cursor = conn.cursor()
    sql = '''
        SELECT trade_id, symbol, date_time, total_commission, currency,
               broker_execution_charge, broker_clearing_charge, third_party_execution_charge,
               third_party_clearing_charge, third_party_regulatory_charge, reg_finra_trading_activity_fee,
               reg_section31_transaction_fee, reg_other, other
        FROM archive_unbundled_commission_detail
        WHERE {where}
        ORDER BY date_time DESC
        LIMIT ?
    '''
    params = [limit]
    if account_id:
        where = 'stmt_account_id = ?'
        params.insert(0, account_id)
    else:
        where = '1=1'
    cursor.execute(sql.format(where=where), params)
    return [{
        'tradeId': row[0], 'symbol': row[1], 'date': row[2], 'amount': row[3], 'currency': row[4],
        'brokerExecution': row[5], 'brokerClearing': row[6], 'thirdPartyExecution': row[7],
        'thirdPartyClearing': row[8], 'thirdPartyRegulatory': row[9], 'finraFee': row[10],
        'secFee': row[11], 'regOther': row[12], 'other': row[13]
    } for row in cursor.fetchall()]


def get_corporate_actions(conn, account_id=None, limit=2000):
    cursor = conn.cursor()
    sql = '''
        SELECT report_date, symbol, type, description, action_description, quantity, proceeds, value
        FROM archive_corporate_action
        WHERE {where}
        ORDER BY report_date DESC
        LIMIT ?
    '''
    params = [limit]
    if account_id:
        where = 'stmt_account_id = ?'
        params.insert(0, account_id)
    else:
        where = '1=1'
    cursor.execute(sql.format(where=where), params)
    return [{
        'date': row[0], 'symbol': row[1], 'type': row[2], 'description': row[3],
        'actionDescription': row[4], 'quantity': row[5], 'proceeds': row[6], 'value': row[7]
    } for row in cursor.fetchall()]


def get_slb_data(conn, account_id=None):
    cursor = conn.cursor()
    open_contracts = []
    activities = []
    fees = []
    tables = [
        ('archive_slb_open_contract', open_contracts),
        ('archive_slb_activity', activities),
        ('archive_slb_fee', fees)
    ]
    for table_name, lst in tables:
        where = 'stmt_account_id = ?' if account_id else '1=1'
        sql = f'SELECT * FROM {table_name} WHERE {where} ORDER BY date DESC LIMIT 500'
        params = (account_id,) if account_id else ()
        try:
            cursor.execute(sql, params)
            cols = [d[0] for d in cursor.description]
            for row in cursor.fetchall():
                lst.append(dict(zip(cols, row)))
        except sqlite3.OperationalError:
            pass  # table or column may not exist for this dataset
    return {'openContracts': open_contracts, 'activities': activities, 'fees': fees}


def get_prior_period_positions(conn, account_id=None, limit=1000):
    cursor = conn.cursor()
    sql = '''
        SELECT date, symbol, description, price, prior_mtm_pnl, asset_category
        FROM archive_prior_period_position
        WHERE {where}
        ORDER BY date DESC
        LIMIT ?
    '''
    params = [limit]
    if account_id:
        where = 'stmt_account_id = ?'
        params.insert(0, account_id)
    else:
        where = '1=1'
    cursor.execute(sql.format(where=where), params)
    return [{
        'date': row[0], 'symbol': row[1], 'description': row[2],
        'price': row[3], 'priorMtmPnl': row[4], 'assetCategory': row[5]
    } for row in cursor.fetchall()]


def get_net_stock_positions(conn, account_id=None, limit=2000):
    cursor = conn.cursor()
    sql = '''
        SELECT account_id, symbol, description, currency, shares_at_ib, shares_borrowed, shares_lent, net_shares, report_date
        FROM archive_net_stock_position
        WHERE {where} AND (CAST(net_shares AS REAL) != 0 OR CAST(shares_borrowed AS REAL) != 0 OR CAST(shares_lent AS REAL) != 0)
        ORDER BY report_date DESC, symbol
        LIMIT ?
    '''
    params = [limit]
    if account_id:
        where = 'stmt_account_id = ?'
        params.insert(0, account_id)
    else:
        where = '1=1'
    cursor.execute(sql.format(where=where), params)
    return [{
        'accountId': row[0], 'symbol': row[1], 'description': row[2], 'currency': row[3],
        'sharesAtIb': safe_float(row[4]), 'sharesBorrowed': safe_float(row[5]),
        'sharesLent': safe_float(row[6]), 'netShares': safe_float(row[7]), 'reportDate': row[8]
    } for row in cursor.fetchall()]


def get_stmt_funds(conn, account_id=None, limit=3000):
    cursor = conn.cursor()
    sql = '''
        SELECT date, symbol, activity_description, debit, credit, balance, trade_gross, currency, amount
        FROM archive_statement_of_funds_line
        WHERE {where}
        ORDER BY date DESC
        LIMIT ?
    '''
    params = [limit]
    if account_id:
        where = 'stmt_account_id = ?'
        params.insert(0, account_id)
    else:
        where = '1=1'
    cursor.execute(sql.format(where=where), params)
    return [{
        'date': row[0], 'symbol': row[1], 'activityDescription': row[2],
        'debit': safe_float(row[3]), 'credit': safe_float(row[4]),
        'balance': safe_float(row[5]), 'tradeGross': safe_float(row[6]),
        'currency': row[7], 'amount': safe_float(row[8])
    } for row in cursor.fetchall()]


def get_mtm_performance_summary(conn, account_id=None, limit=3000):
    cursor = conn.cursor()
    sql = '''
        SELECT symbol, description, asset_category, transaction_mtm, prior_open_mtm,
               commissions, total, total_with_accruals, report_date
        FROM archive_mtm_performance_summary_underlying
        WHERE {where} AND symbol != ''
        ORDER BY ABS(CAST(total AS REAL)) DESC
        LIMIT ?
    '''
    params = [limit]
    if account_id:
        where = 'stmt_account_id = ?'
        params.insert(0, account_id)
    else:
        where = '1=1'
    cursor.execute(sql.format(where=where), params)
    return [{
        'symbol': row[0], 'description': row[1], 'assetCategory': row[2],
        'transactionMtm': safe_float(row[3]), 'priorOpenMtm': safe_float(row[4]),
        'commissions': safe_float(row[5]), 'total': safe_float(row[6]),
        'totalWithAccruals': safe_float(row[7]), 'reportDate': row[8]
    } for row in cursor.fetchall()]


def get_change_in_nav_details(conn, account_id=None):
    cursor = conn.cursor()
    skip_cols = {'stmt_date', 'stmt_account_id', 'account_id', 'acct_alias',
                 'currency', 'from_date', 'to_date', 'model'}
    try:
        if account_id:
            cursor.execute('''
                SELECT * FROM archive_change_in_nav
                WHERE stmt_account_id = ?
                ORDER BY to_date DESC
                LIMIT 1
            ''', (account_id,))
            cols = [d[0] for d in cursor.description]
            row = cursor.fetchone()
            if not row:
                return {}
            data = dict(zip(cols, row))
        else:
            # combined: 累加所有期间的数值字段，避免只取最后一行造成其他字段=0
            cursor.execute('SELECT * FROM archive_change_in_nav LIMIT 1')
            cols = [d[0] for d in cursor.description]
            numeric_cols = [c for c in cols if c not in skip_cols]
            if not numeric_cols:
                return {}
            sum_expr = ', '.join(f'SUM(CAST({c} AS REAL))' for c in numeric_cols)
            cursor.execute(f'SELECT {sum_expr} FROM archive_change_in_nav')
            srow = cursor.fetchone() or tuple(0 for _ in numeric_cols)
            data = dict(zip(numeric_cols, srow))
        # Remove metadata keys and convert numeric fields to float
        numeric_keys = [
            'starting_value', 'ending_value', 'mtm', 'realized', 'dividends', 'interest',
            'commissions', 'twr', 'withholding_tax', 'broker_fees', 'forex_commissions',
            'corporate_action_proceeds', 'net_fx_trading', 'fx_translation', 'other_fees',
            'transaction_tax', 'sales_tax', 'client_fees', 'advisor_fees', 'deposits_withdrawals',
            'asset_transfers', 'internal_cash_transfers', 'change_in_unrealized',
            'change_in_dividend_accruals', 'change_in_interest_accruals', 'change_in_broker_fee_accruals',
            'cost_adjustments', 'linking_adjustments', 'referral_fee', 'other_income',
            'other', 'paxos_transfers', 'grant_activity', 'debit_card_activity',
            'bill_pay', 'donations', 'excess_fund_sweep', 'commission_credits_redemption',
            'withholding871m', 'carbon_credits', 'billable_sales_tax'
        ]
        result = {}
        for k, v in data.items():
            if k in ('stmt_date', 'stmt_account_id', 'account_id', 'acct_alias', 'currency', 'from_date', 'to_date', 'model'):
                continue
            if k in numeric_keys:
                result[k] = safe_float(v)
            else:
                result[k] = safe_float(v) if v not in (None, '') else 0.0
        return result
    except sqlite3.OperationalError:
        return {}


def get_conversion_rates(conn, account_id=None, limit=500):
    cursor = conn.cursor()
    sql = '''
        SELECT from_currency, to_currency, rate, report_date
        FROM archive_conversion_rate
        WHERE {where}
        ORDER BY report_date DESC, from_currency
        LIMIT ?
    '''
    params = [limit]
    if account_id:
        where = 'stmt_account_id = ?'
        params.insert(0, account_id)
    else:
        where = '1=1'
    cursor.execute(sql.format(where=where), params)
    return [{
        'fromCurrency': row[0], 'toCurrency': row[1],
        'rate': safe_float(row[2]), 'reportDate': row[3]
    } for row in cursor.fetchall()]


def safe_float(v):
    import math
    try:
        f = float(v) if v is not None else 0.0
        if math.isnan(f) or math.isinf(f):
            return 0.0
        return f
    except (ValueError, TypeError):
        return 0.0


def get_balance_breakdown(conn, account_id=None):
    """从多个 archive 表提取余额明细"""
    cursor = conn.cursor()
    
    def get_net_liquidation(acc):
        if acc:
            cursor.execute('SELECT ending_value FROM daily_nav WHERE account_id = ? ORDER BY date DESC LIMIT 1', (acc,))
        else:
            # Combined: sum each account's latest ending_value (accounts may have
            # different max dates; do NOT require the global MAX(date)).
            cursor.execute('''
                SELECT COALESCE(SUM(d.ending_value), 0)
                FROM daily_nav d
                JOIN (
                    SELECT account_id, MAX(date) AS mx FROM daily_nav GROUP BY account_id
                ) latest ON latest.account_id = d.account_id AND latest.mx = d.date
            ''')
        row = cursor.fetchone()
        return safe_float(row[0]) if row else 0.0
    
    def get_open_pos_breakdown(acc):
        etf_symbols = {'QQQ', 'QQQM', 'QQQI', 'SPY', 'SPYM', 'VOO', 'SGOV', 'SOXX', 'EWY', 'JEPI', 'BOXX'}

        def infer_category(symbol, description):
            desc = (description or '').upper()
            sym = symbol or ''
            if 'ETF' in desc or sym in etf_symbols:
                return 'ETF'
            if any(x in sym for x in ['  ', 'P', 'C']) and len(sym) > 6:
                return 'OPT'
            return 'STK'

        def get_fx_map(stmt_date, stmt_account):
            fx_map = {}
            cursor.execute('''
                SELECT from_currency, rate FROM archive_conversion_rate
                WHERE stmt_date = ? AND stmt_account_id = ?
            ''', (stmt_date, stmt_account))
            for curr, rate in cursor.fetchall():
                try:
                    fx_map[curr] = float(rate) if rate else 0.0
                except (ValueError, TypeError):
                    pass
            return fx_map

        if acc:
            cursor.execute('''
                SELECT MAX(stmt_date) FROM archive_open_position WHERE stmt_account_id = ?
            ''', (acc,))
            row = cursor.fetchone()
            max_date = row[0] if row else None
            if not max_date:
                return {}, 0.0
            fx_map = get_fx_map(max_date, acc)

            cursor.execute('''
                SELECT symbol, description, asset_category, currency, fx_rate_to_base, position_value, fifo_pnl_unrealized
                FROM archive_open_position
                WHERE stmt_account_id = ? AND stmt_date = ?
            ''', (acc, max_date))
            breakdown = {}
            total_unrealized = 0.0
            for symbol, description, asset_category, currency, fx_rate_to_base, position_value, fifo_pnl_unrealized in cursor.fetchall():
                cat = (asset_category or '').upper()
                if not cat:
                    cat = infer_category(symbol, description)
                fx = safe_float(fx_rate_to_base) if fx_rate_to_base else None
                if fx is None:
                    curr = (currency or '').upper()
                    if not curr:
                        curr = 'USD'
                    fx = fx_map.get(curr, 1.0)
                val = safe_float(position_value) * fx if position_value else 0.0
                breakdown[cat] = breakdown.get(cat, 0.0) + val
                total_unrealized += safe_float(fifo_pnl_unrealized) if fifo_pnl_unrealized else 0.0
            return breakdown, total_unrealized
        else:
            cursor.execute('SELECT DISTINCT stmt_account_id FROM archive_open_position')
            accounts = [r[0] for r in cursor.fetchall()]
            # Determine the global newest date and a 7-day tolerance window
            cursor.execute('SELECT MAX(stmt_date) FROM archive_open_position')
            global_max_row = cursor.fetchone()
            global_max_date = global_max_row[0] if global_max_row else None
            breakdown = {}
            total_unrealized = 0.0
            for a in accounts:
                cursor.execute('''
                    SELECT MAX(stmt_date) FROM archive_open_position WHERE stmt_account_id = ?
                ''', (a,))
                row = cursor.fetchone()
                max_date = row[0] if row else None
                if not max_date:
                    continue
                # Skip stale accounts (>7 days behind the global max) to avoid ghost changes
                if global_max_date and max_date:
                    try:
                        from datetime import datetime
                        d1 = datetime.strptime(str(global_max_date), '%Y-%m-%d')
                        d2 = datetime.strptime(str(max_date), '%Y-%m-%d')
                        if (d1 - d2).days > 7:
                            continue
                    except Exception:
                        pass
                fx_map = get_fx_map(max_date, a)
                cursor.execute('''
                    SELECT symbol, description, asset_category, currency, fx_rate_to_base, position_value, fifo_pnl_unrealized
                    FROM archive_open_position
                    WHERE stmt_account_id = ? AND stmt_date = ?
                ''', (a, max_date))
                for symbol, description, asset_category, currency, fx_rate_to_base, position_value, fifo_pnl_unrealized in cursor.fetchall():
                    cat = (asset_category or '').upper()
                    if not cat:
                        cat = infer_category(symbol, description)
                    fx = safe_float(fx_rate_to_base) if fx_rate_to_base else None
                    if fx is None:
                        curr = (currency or '').upper()
                        if not curr:
                            curr = 'USD'
                        fx = fx_map.get(curr, 1.0)
                    val = safe_float(position_value) * fx if position_value else 0.0
                    breakdown[cat] = breakdown.get(cat, 0.0) + val
                    total_unrealized += safe_float(fifo_pnl_unrealized) if fifo_pnl_unrealized else 0.0
            return breakdown, total_unrealized
    
    def get_equity_summary(acc):
        fields = ['cash', 'stock', 'options', 'funds', 'bonds', 'commodities', 'dividend_accruals', 'interest_accruals', 'cfd_unrealized_pl']
        if acc:
            # Dup rows for same stmt_date exist; rowid DESC picks the last inserted
            # which corresponds to the day's ending snapshot, not the starting one.
            cursor.execute(f'''
                SELECT {','.join(fields)}
                FROM archive_equity_summary_by_report_date_in_base
                WHERE stmt_account_id = ?
                ORDER BY stmt_date DESC, rowid DESC
                LIMIT 1
            ''', (acc,))
            row = cursor.fetchone()
            if row:
                return dict(zip(fields, [safe_float(v) for v in row]))
            return {f: 0.0 for f in fields}
        else:
            cursor.execute('SELECT DISTINCT stmt_account_id FROM archive_equity_summary_by_report_date_in_base')
            accounts = [r[0] for r in cursor.fetchall()]
            result = {}
            for a in accounts:
                cursor.execute(f'''
                    SELECT {','.join(fields)}
                    FROM archive_equity_summary_by_report_date_in_base
                    WHERE stmt_account_id = ?
                    ORDER BY stmt_date DESC, rowid DESC
                    LIMIT 1
                ''', (a,))
                row = cursor.fetchone()
                if not row:
                    continue
                for f, v in zip(fields, row):
                    result[f] = result.get(f, 0.0) + safe_float(v)
            return result
    
    def get_cash_by_currency(acc):
        # 获取各币种现金
        if acc:
            cursor.execute('''
                SELECT currency, ending_cash, ending_settled_cash, starting_cash
                FROM archive_cash_report_currency
                WHERE stmt_account_id = ?
                  AND stmt_date = (SELECT MAX(stmt_date) FROM archive_cash_report_currency WHERE stmt_account_id = ?)
                  AND currency != 'BASE_SUMMARY'
                ORDER BY currency
            ''', (acc, acc))
            cash_rows = cursor.fetchall()
            # Fallback to equity summary cash if no valid cash report data
            if not any(v is not None and str(v).strip() != '' for row in cash_rows for v in row[1:]):
                cursor.execute('''
                    SELECT cash FROM archive_equity_summary_by_report_date_in_base
                    WHERE stmt_account_id = ? ORDER BY stmt_date DESC LIMIT 1
                ''', (acc,))
                row = cursor.fetchone()
                if row and row[0] is not None and str(row[0]).strip() != '':
                    cash_rows = [('BASE', row[0], None, None)]
        else:
            cursor.execute('SELECT DISTINCT stmt_account_id FROM archive_cash_report_currency')
            accounts = [r[0] for r in cursor.fetchall()]
            currencies = {}
            for a in accounts:
                cursor.execute('''
                    SELECT currency, ending_cash, ending_settled_cash, starting_cash
                    FROM archive_cash_report_currency
                    WHERE stmt_account_id = ?
                      AND stmt_date = (SELECT MAX(stmt_date) FROM archive_cash_report_currency WHERE stmt_account_id = ?)
                      AND currency != 'BASE_SUMMARY'
                ''', (a, a))
                for row in cursor.fetchall():
                    curr = row[0]
                    val = None
                    for v in row[1:]:
                        if v is not None and str(v).strip() != '':
                            val = safe_float(v)
                            break
                    if curr in currencies:
                        if val is not None:
                            currencies[curr] = (currencies[curr] or 0.0) + val
                    else:
                        currencies[curr] = val
            cash_rows = [(k, v, None, None) for k, v in sorted(currencies.items()) if v is not None]
            # Fallback to equity summary cash for combined —— 只聚合每个账户最新 stmt_date 的 cash，
            # 避免把历史快照全部累加（cash 列已折算到 base currency）
            cr_total = sum(v for _, v, _, _ in cash_rows if v is not None) if cash_rows else 0
            cursor.execute('SELECT DISTINCT stmt_account_id FROM archive_equity_summary_by_report_date_in_base')
            _eq_total = 0.0
            for (_ea,) in cursor.fetchall():
                # Dup rows exist for same (account, stmt_date). rowid DESC picks
                # the day's last inserted row = ending cash, not a day-start / delta.
                cursor.execute(
                    "SELECT CAST(cash AS REAL) FROM archive_equity_summary_by_report_date_in_base "
                    "WHERE stmt_account_id = ? "
                    "AND cash IS NOT NULL AND cash != '' "
                    "ORDER BY stmt_date DESC, rowid DESC LIMIT 1",
                    (_ea,)
                )
                _r = cursor.fetchone()
                if _r and _r[0] is not None:
                    _eq_total += safe_float(_r[0])
            eq_total = _eq_total
            if abs(eq_total) > 0.01 and (not cash_rows or abs(eq_total) > abs(cr_total)):
                cash_rows = [('BASE', eq_total, None, None)]
        
        # 获取各币种持仓市值（原币种）
        if acc:
            cursor.execute('''
                SELECT currency, SUM(position_value)
                FROM archive_open_position
                WHERE stmt_account_id = ?
                  AND stmt_date = (SELECT MAX(stmt_date) FROM archive_open_position WHERE stmt_account_id = ?)
                GROUP BY currency
            ''', (acc, acc))
            pos_by_currency = {row[0]: safe_float(row[1]) for row in cursor.fetchall()}
        else:
            # Combined: aggregate per-account latest date to avoid missing stale accounts
            cursor.execute('SELECT DISTINCT stmt_account_id FROM archive_open_position')
            pos_accounts = [r[0] for r in cursor.fetchall()]
            cursor.execute('SELECT MAX(stmt_date) FROM archive_open_position')
            global_max_pos = cursor.fetchone()[0]
            pos_by_currency = {}
            for a in pos_accounts:
                cursor.execute('SELECT MAX(stmt_date) FROM archive_open_position WHERE stmt_account_id = ?', (a,))
                max_date = cursor.fetchone()[0]
                if not max_date:
                    continue
                if global_max_pos and max_date:
                    try:
                        from datetime import datetime
                        d1 = datetime.strptime(str(global_max_pos), '%Y-%m-%d')
                        d2 = datetime.strptime(str(max_date), '%Y-%m-%d')
                        if (d1 - d2).days > 7:
                            continue
                    except Exception:
                        pass
                cursor.execute('''
                    SELECT currency, SUM(position_value)
                    FROM archive_open_position
                    WHERE stmt_account_id = ? AND stmt_date = ?
                    GROUP BY currency
                ''', (a, max_date))
                for curr, val in cursor.fetchall():
                    pos_by_currency[curr] = pos_by_currency.get(curr, 0.0) + safe_float(val)
        
        result = []
        for row in cash_rows:
            curr = row[0]
            cash_val = next((safe_float(v) for v in row[1:] if v is not None and str(v).strip() != ''), None)
            pos_val = pos_by_currency.get(curr, 0.0)
            denom = abs(cash_val or 0) + abs(pos_val)
            ratio = (abs(cash_val) / denom) * 100 if (denom and cash_val is not None) else 0
            result.append({'currency': curr, 'cash': cash_val, 'positionValue': pos_val, 'ratio': round(ratio, 1)})
        return result
    
    def get_realized(acc):
        # 累计已实现盈亏（从开仓到最新）
        if acc:
            cursor.execute('SELECT SUM(realized) FROM daily_nav WHERE account_id = ?', (acc,))
        else:
            cursor.execute('SELECT SUM(realized) FROM daily_nav')
        row = cursor.fetchone()
        return safe_float(row[0]) if row else 0.0
    
    net_liquidation = get_net_liquidation(account_id)
    pos_breakdown, pos_unrealized = get_open_pos_breakdown(account_id)
    equity = get_equity_summary(account_id)
    cash_by_currency = get_cash_by_currency(account_id)
    realized_pnl = get_realized(account_id)
    
    stock_value = pos_breakdown.get('STK', 0.0) + pos_breakdown.get('STOCK', 0.0)
    etf_value = pos_breakdown.get('ETF', 0.0)
    option_value = pos_breakdown.get('OPT', 0.0) + pos_breakdown.get('OPTION', 0.0)
    fund_value = pos_breakdown.get('FUND', 0.0) + equity.get('funds', 0.0)
    bond_value = pos_breakdown.get('BOND', 0.0) + equity.get('bonds', 0.0)
    commodity_value = pos_breakdown.get('CMDTY', 0.0) + pos_breakdown.get('COMMODITY', 0.0) + equity.get('commodities', 0.0)
    
    position_total = stock_value + etf_value + option_value + fund_value + bond_value + commodity_value
    
    # Cash priority:
    # 1. Sum from cash_by_currency (if archive_cash_report_currency had valid data)
    # 2. equity summary cash
    # 3. estimated from net liquidation minus positions
    settled_cash = None
    has_valid_cash_report = False
    for c in cash_by_currency:
        if c['cash'] is not None and abs(c['cash']) > 0.01:
            settled_cash = (settled_cash or 0.0) + c['cash']
            has_valid_cash_report = True
    
    equity_cash = equity.get('cash', 0.0)
    estimated_cash = net_liquidation - position_total
    
    if has_valid_cash_report and settled_cash is not None:
        total_cash = settled_cash
    elif equity_cash != 0:
        total_cash = equity_cash
        settled_cash = equity_cash
    else:
        total_cash = estimated_cash
        settled_cash = estimated_cash
    
    unrealized_pnl = pos_unrealized if pos_unrealized != 0 else equity.get('cfd_unrealized_pl', 0.0)
    
    return {
        'netLiquidation': round(net_liquidation, 2),
        'unrealizedPnl': round(unrealized_pnl, 2),
        'realizedPnl': round(realized_pnl, 2),
        'totalCash': round(total_cash, 2),
        'settledCash': round(settled_cash, 2),
        'stockValue': round(stock_value, 2),
        'etfValue': round(etf_value, 2),
        'optionValue': round(option_value, 2),
        'fundValue': round(fund_value, 2),
        'bondValue': round(bond_value, 2),
        'commodityValue': round(commodity_value, 2),
        'dividendAccruals': round(equity.get('dividend_accruals', 0.0), 2),
        'interestAccruals': round(equity.get('interest_accruals', 0.0), 2),
        'cashByCurrency': cash_by_currency,
        'positionTotal': round(position_total, 2)
    }


def get_monthly_trade_stats(conn, account_id=None):
    cursor = conn.cursor()
    sql = '''
        SELECT 
            CASE 
                WHEN LENGTH(trade_date) = 8 THEN 
                    SUBSTR(trade_date, 1, 4) || '-' || SUBSTR(trade_date, 5, 2)
                ELSE strftime('%Y-%m', trade_date)
            END as month,
            COUNT(*) as trade_count,
            COALESCE(SUM(ABS(proceeds)), 0) as turnover,
            COALESCE(SUM(ABS(quantity)), 0) as total_quantity,
            COALESCE(SUM(fifo_pnl_realized), 0) as realized_pnl
        FROM archive_trade
        WHERE trade_date IS NOT NULL AND trade_date != '' AND {where}
        GROUP BY month
        HAVING month IS NOT NULL
        ORDER BY month
    '''
    if account_id:
        cursor.execute(sql.format(where='stmt_account_id = ?'), (account_id,))
    else:
        cursor.execute(sql.format(where='1=1'))
    return [{
        'month': row[0],
        'tradeCount': row[1],
        'turnover': round(float(row[2]), 2),
        'totalQuantity': round(float(row[3]), 2),
        'realizedPnl': round(float(row[4]), 2)
    } for row in cursor.fetchall()]




def fetch_yahoo_prices(symbol, start_date, end_date):
    """从 Yahoo Finance 获取历史价格，返回 {date_str: price}"""
    import urllib.request
    try:
        start_ts = int(datetime.strptime(start_date, '%Y-%m-%d').timestamp())
        end_ts = int(datetime.strptime(end_date, '%Y-%m-%d').timestamp()) + 86400
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1={start_ts}&period2={end_ts}&interval=1d'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        result = data['chart']['result'][0]
        timestamps = result['timestamp']
        prices = result['indicators']['adjclose'][0]['adjclose']
        raw = {}
        for ts, price in zip(timestamps, prices):
            if price is None:
                continue
            d = datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
            raw[d] = price
        # Forward fill any gaps in range
        filled = {}
        cur = datetime.strptime(start_date, '%Y-%m-%d')
        end = datetime.strptime(end_date, '%Y-%m-%d')
        last_price = None
        while cur <= end:
            d = cur.strftime('%Y-%m-%d')
            if d in raw:
                last_price = raw[d]
            filled[d] = last_price
            cur += timedelta(days=1)
        return filled
    except Exception as e:
        print(f'   ⚠️ 获取 {symbol} 数据失败: {e}')
        return {}


BENCHMARK_CACHE_PATH = os.path.join(os.path.dirname(DB_PATH), 'benchmark_cache.json')
BENCHMARK_CACHE_TTL_HOURS = 24

def _load_benchmark_cache(start_date, end_date):
    if not os.path.exists(BENCHMARK_CACHE_PATH):
        return None
    try:
        with open(BENCHMARK_CACHE_PATH, 'r', encoding='utf-8') as f:
            cache = json.load(f)
        updated = datetime.strptime(cache.get('updatedAt', '2000-01-01'), '%Y-%m-%d %H:%M:%S')
        if (datetime.now() - updated).total_seconds() > BENCHMARK_CACHE_TTL_HOURS * 3600:
            return None
        if cache.get('start_date') != start_date or cache.get('end_date') != end_date:
            return None
        return cache.get('data')
    except Exception:
        return None

def _save_benchmark_cache(start_date, end_date, data):
    try:
        with open(BENCHMARK_CACHE_PATH, 'w', encoding='utf-8') as f:
            json.dump({
                'updatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'start_date': start_date,
                'end_date': end_date,
                'data': data
            }, f, ensure_ascii=False)
    except Exception as e:
        print(f'   ⚠️ 保存 benchmark 缓存失败: {e}')

def get_benchmarks(start_date, end_date):
    cached = _load_benchmark_cache(start_date, end_date)
    if cached is not None:
        print('   ✅ 使用缓存的 benchmark 数据')
        return cached

    benchmarks = {}
    mapping = {
        'HSI': '^HSI',
        'SP500': '^GSPC',
        'CSI300': '000300.SS',
        'N225': '^N225',
        'STI': '^STI',
        'NASDAQ': '^IXIC',
        'QQQ': 'QQQ'
    }
    for name, symbol in mapping.items():
        prices = fetch_yahoo_prices(symbol, start_date, end_date)
        if prices:
            arr = [{'date': d, 'price': round(p, 4)} for d, p in sorted(prices.items()) if p is not None]
            benchmarks[name] = arr
    _save_benchmark_cache(start_date, end_date, benchmarks)
    return benchmarks

def generate_dashboard_data(conn, account_id=None, label='COMBINED'):
    latest_date = get_latest_date(conn, account_id)
    earliest_date = get_earliest_date(conn, account_id)
    
    if not latest_date:
        return None
    
    simple_all, twr_all, mwr_all, simple_returns_all = get_nav_history_with_metrics(conn, account_id)
    nav_all = simple_all
    today = datetime.strptime(latest_date, '%Y-%m-%d')
    
    ranges = {
        'nav1Week': (today - timedelta(days=7)).strftime('%Y-%m-%d'),
        'navMTD': f"{today.year}-{today.month:02d}-01",
        'nav1Month': (today - timedelta(days=30)).strftime('%Y-%m-%d'),
        'nav3Months': (today - timedelta(days=90)).strftime('%Y-%m-%d'),
        'nav1Year': (today - timedelta(days=365)).strftime('%Y-%m-%d'),
        'navYTD': f"{today.year}-01-01",
    }
    
    computation_errors = {}

    def _compute(name, fn, default):
        try:
            return fn()
        except Exception as e:
            msg = str(e)
            computation_errors[name] = msg
            print(f"⚠️ Computation error for {name}: {msg}")
            return default

    # 提前计算 true_perf，供 range summaries 使用
    true_perf = _compute('true_perf_early', lambda: get_true_performance(conn, account_id), {
        'totalGain': 0, 'totalGainPct': 0, 'investedCapital': 0,
        'initialCapital': 0, 'latestEnding': 0, 'netDeposits': 0, 'netTransfers': 0
    })
    total_gain = true_perf['totalGain']
    total_gain_pct = true_perf['totalGainPct']
    perf_starting_value = true_perf['investedCapital']
    
    history = {}
    historyTwr = {}
    historyMwr = {}
    historySimpleReturns = {}
    range_summaries = {}
    
    flow_series = get_flow_series(conn, account_id)
    flow_map = {d: f for d, f, e in flow_series}
    
    def calc_adjusted_returns(start_date):
        interval_nav = [n for n in simple_all if n['date'] >= start_date]
        start_nav_val = 0.0
        start_idx = 0
        for i, n in enumerate(interval_nav):
            if n['nav'] != 0:
                start_nav_val = n['nav']
                start_idx = i
                break
        cum_flow = 0.0
        adjusted = []
        for i, n in enumerate(interval_nav):
            flow = flow_map.get(n['date'], 0)
            # 如果这是区间内第一个非零 NAV 日，且 flow 约等于 start_nav_val，
            # 说明这个 flow 是初始本金，不应重复计算
            if i == start_idx and abs(flow - start_nav_val) < 1:
                flow = 0
            cum_flow += flow
            if i < start_idx or start_nav_val == 0:
                adjusted.append({'date': n['date'], 'nav': 0.0})
            else:
                invested = start_nav_val + cum_flow
                if invested != 0:
                    ret = (n['nav'] - invested) / invested * 100
                else:
                    ret = 0.0
                adjusted.append({'date': n['date'], 'nav': round(ret, 4)})
        return adjusted
    
    historyAdjustedReturns = {}
    for key, start_date in ranges.items():
        simple_list = [n for n in simple_all if n['date'] >= start_date]
        history[key] = simple_list
        historyTwr[key] = [n for n in twr_all if n['date'] >= start_date]
        historyMwr[key] = [n for n in mwr_all if n['date'] >= start_date]
        historySimpleReturns[key] = [n for n in simple_returns_all if n['date'] >= start_date]
        historyAdjustedReturns[key] = calc_adjusted_returns(start_date)
        range_flow = sum(f for d, f, e in flow_series if d >= start_date)
        range_summaries[key] = get_range_summary(simple_list, range_flow)
    
    history['navAll'] = simple_all
    historyTwr['navAll'] = twr_all
    historyMwr['navAll'] = mwr_all
    historySimpleReturns['navAll'] = simple_returns_all
    historyAdjustedReturns['navAll'] = calc_adjusted_returns(simple_all[0]['date'] if simple_all else '1900-01-01')
    # navAll 的 net_flow 需要和 true_perf 一致
    nav_all_flow = true_perf['investedCapital'] - true_perf['initialCapital'] if simple_all and simple_all[0]['nav'] != 0 else true_perf['investedCapital']
    range_summaries['navAll'] = get_range_summary(simple_all, nav_all_flow)
    history['nav30Days'] = simple_all[-30:] if len(simple_all) > 30 else simple_all
    historyTwr['nav30Days'] = twr_all[-30:] if len(twr_all) > 30 else twr_all
    historyMwr['nav30Days'] = mwr_all[-30:] if len(mwr_all) > 30 else mwr_all
    historySimpleReturns['nav30Days'] = simple_returns_all[-30:] if len(simple_returns_all) > 30 else simple_returns_all
    historyAdjustedReturns['nav30Days'] = calc_adjusted_returns((simple_all[-30]['date'] if len(simple_all) > 30 else simple_all[0]['date']) if simple_all else '1900-01-01')
    
    benchmarks = get_benchmarks(earliest_date, latest_date)
    
    stocks, etfs, options = get_latest_positions(conn, account_id)
    cash_report = get_cash_report(conn, account_id)
    total_cash_report = sum(c['cash'] for c in cash_report)
    
    # Use base-currency values from balance_breakdown for summary consistency
    # (balance_breakdown handles FX conversion; get_latest_positions uses original currency)
    total_stocks_raw = sum(p['positionValue'] for p in stocks)
    total_etfs_raw = sum(p['positionValue'] for p in etfs)
    total_options_raw = sum(p['positionValue'] for p in options)
    total_cash_raw = total_cash_report
    total_nav_raw = total_stocks_raw + total_etfs_raw + total_options_raw + total_cash_raw
    
    perf = _compute('perf', lambda: get_performance(conn, account_id, latest_date), {})
    
    base_currency = get_base_currency(conn, account_id)
    fx_rates = get_fx_rates(conn, account_id)
    
    option_eae = get_option_eae(conn, account_id)
    flow_summary = get_flow_summary(conn, account_id)
    
    max_dd = _compute('max_dd', lambda: calc_max_drawdown(nav_all), 0.0)
    
    # Annualized return based on true performance (cashflow-adjusted)
    n_days = len(nav_all)
    base = 1 + total_gain_pct / 100
    if n_days > 1 and perf_starting_value > 0 and base > 0:
        ann_return = (base ** (252 / n_days) - 1) * 100
    else:
        ann_return = 0.0
    
    # Volatility still from NAV series (market movement risk)
    ann_metrics = _compute('ann_metrics', lambda: calc_annualized_metrics(nav_all), {'annualizedReturn': 0.0, 'annualizedVolatility': 0.0, 'sharpeRatio': 0.0})
    cum_realized = _compute('cum_realized', lambda: get_cumulative_realized(conn, account_id), 0.0)
    monthly_trade_stats = _compute('monthly_trade_stats', lambda: get_monthly_trade_stats(conn, account_id), [])
    
    trades = _compute('trades', lambda: get_trades(conn, account_id), [])
    # Flex 口径每日 PnL（daily_nav.mtm+realized+div+int+comm）
    flex_pnl_map = {}
    try:
        _cur = conn.cursor()
        if account_id:
            _cur.execute("SELECT date, CAST(mtm AS REAL)+CAST(realized AS REAL)+CAST(dividends AS REAL)+CAST(interest AS REAL)+CAST(commissions AS REAL) FROM daily_nav WHERE account_id = ?", (account_id,))
        else:
            _cur.execute("SELECT date, SUM(CAST(mtm AS REAL)+CAST(realized AS REAL)+CAST(dividends AS REAL)+CAST(interest AS REAL)+CAST(commissions AS REAL)) FROM daily_nav GROUP BY date")
        for _d, _p in _cur.fetchall():
            if _d is not None:
                flex_pnl_map[_d] = float(_p or 0)
    except Exception:
        flex_pnl_map = {}
    daily_pnl = _compute('daily_pnl', lambda: get_daily_pnl(nav_all, flow_map, flex_pnl_map), [])
    trade_pnl_analysis = _compute('trade_pnl_analysis', lambda: get_trade_pnl_analysis(trades), {})
    trade_behavior = _compute('trade_behavior', lambda: get_trade_behavior_analysis(trades), {})
    cost_breakdown = _compute('cost_breakdown', lambda: get_cost_breakdown(conn, account_id), {})
    leverage_metrics = _compute('leverage_metrics', lambda: get_leverage_metrics(conn, account_id), {})
    tax_summary = _compute('tax_summary', lambda: get_tax_summary(conn, account_id), {})
    risk_metrics = _compute('risk_metrics', lambda: get_risk_metrics(nav_all, ann_return), {'calmarRatio': 0, 'sortinoRatio': 0, 'maxConsecutiveWinMonths': 0, 'maxConsecutiveLossMonths': 0})
    monthly_returns = _compute('monthly_returns', lambda: get_monthly_returns(nav_all), [])
    monthly_real_gains = _compute('monthly_real_gains', lambda: get_monthly_real_gains(nav_all, flow_map), [])
    position_attribution = _compute('position_attribution', lambda: get_position_attribution(conn, account_id), {'positions': [], 'concentration': {}, 'topContributors': [], 'topDrags': [], 'rebalanceSignals': []})
    cashflow_waterfall = _compute('cashflow_waterfall', lambda: get_cashflow_waterfall(conn, account_id), [])
    dividends = _compute('dividends', lambda: get_dividends(conn, account_id), [])
    cash_transactions = _compute('cash_transactions', lambda: get_cash_transactions(conn, account_id), [])
    transaction_fees = _compute('transaction_fees', lambda: get_transaction_fees(conn, account_id), [])
    corporate_actions = _compute('corporate_actions', lambda: get_corporate_actions(conn, account_id), [])
    slb = _compute('slb', lambda: get_slb_data(conn, account_id), {'openContracts': [], 'activities': [], 'fees': []})
    prior_positions = _compute('prior_positions', lambda: get_prior_period_positions(conn, account_id), [])
    net_stock_positions = _compute('net_stock_positions', lambda: get_net_stock_positions(conn, account_id), [])
    stmt_funds = _compute('stmt_funds', lambda: get_stmt_funds(conn, account_id), [])
    position_changes = _compute('position_changes', lambda: get_position_changes(conn, account_id), {'latestDate': None, 'prevDate': None, 'changes': []})
    latest_day_trades = _compute('latest_day_trades', lambda: get_latest_day_trades(conn, account_id), {'tradeDate': None, 'trades': []})
    cost_basis_holdings = _compute('cost_basis_holdings', lambda: get_cost_basis_holdings(conn, account_id), [])
    sold_analysis = _compute('sold_analysis', lambda: get_sold_positions_analysis(conn, account_id), [])
    mtm_performance = _compute('mtm_performance', lambda: get_mtm_performance_summary(conn, account_id), [])
    change_in_nav_details = _compute('change_in_nav_details', lambda: get_change_in_nav_details(conn, account_id), {})
    conversion_rates = _compute('conversion_rates', lambda: get_conversion_rates(conn, account_id), [])
    balance_breakdown = _compute('balance_breakdown', lambda: get_balance_breakdown(conn, account_id), {
        'netLiquidation': 0, 'totalCash': 0, 'unrealizedPnl': 0, 'realizedPnl': 0,
        'settledCash': 0, 'stockValue': 0, 'etfValue': 0, 'optionValue': 0,
        'fundValue': 0, 'bondValue': 0, 'commodityValue': 0, 'dividendAccruals': 0,
        'interestAccruals': 0, 'cashByCurrency': [], 'positionTotal': 0
    })

    # Fix leverage_metrics to be consistent with balance_breakdown
    # (get_leverage_metrics may return 0 for combined accounts due to SQL quirks)
    leverage_metrics['netLiquidation'] = round(balance_breakdown.get('netLiquidation', leverage_metrics.get('netLiquidation', 0)), 2)
    leverage_metrics['stockMarketValue'] = round(balance_breakdown.get('stockValue', leverage_metrics.get('stockMarketValue', 0)), 2)
    leverage_metrics['etfMarketValue'] = round(balance_breakdown.get('etfValue', leverage_metrics.get('etfMarketValue', 0)), 2)
    leverage_metrics['optionMarketValue'] = round(balance_breakdown.get('optionValue', leverage_metrics.get('optionMarketValue', 0)), 2)
    gross_exp = abs(leverage_metrics.get('stockMarketValue', 0)) + abs(leverage_metrics.get('etfMarketValue', 0)) + abs(leverage_metrics.get('optionMarketValue', 0))
    leverage_metrics['grossExposure'] = round(gross_exp, 2)
    net_liq_val = leverage_metrics.get('netLiquidation', 0)
    leverage_metrics['leverageRatio'] = round(gross_exp / net_liq_val, 2) if net_liq_val else 0

    # New extension data
    position_timeline = _compute('position_timeline', lambda: get_position_timeline(conn, account_id), {'symbols': [], 'holdings': {}, 'turnoverRank': [], 'holdingPeriodRank': []})
    order_execution = _compute('order_execution', lambda: get_order_execution_quality(conn, account_id), {'summary': {}, 'bySymbol': [], 'byExchange': [], 'byHour': []})
    fx_exposure = _compute('fx_exposure', lambda: get_fx_exposure(conn, account_id), {'baseCurrency': 'CNH', 'currencyBreakdown': [], 'fxContribution': {}, 'latestFxRates': {}})
    slb_income = _compute('slb_income', lambda: get_slb_income(conn, account_id), {'monthlyIncome': [], 'totalIncome': 0, 'bySymbol': [], 'currentContracts': []})
    enhanced_cashflow = _compute('enhanced_cashflow', lambda: get_enhanced_cashflow(conn, account_id), {'monthlyWaterfall': [], 'externalFlowTrend': []})
    trading_heatmap = _compute('trading_heatmap', lambda: get_trading_heatmap(conn, account_id), {'byDayHour': [], 'bestSlots': [], 'worstSlots': []})
    trade_rankings = _compute('trade_rankings', lambda: get_trade_rankings(conn, account_id), {'topProfits': [], 'topLosses': [], 'bySymbol': []})
    dividend_tracker = _compute('dividend_tracker', lambda: get_dividend_tracker(conn, account_id), {'history': [], 'upcoming': [], 'monthlyIncome': [], 'yieldBySymbol': []})
    fee_erosion = _compute('fee_erosion', lambda: get_fee_erosion(conn, account_id), {'totalFees': 0, 'totalRealizedGain': 0, 'feeToGainRatio': 0, 'annualizedFeeRate': 0, 'byMonth': [], 'breakdown': {}})
    risk_radar = _compute('risk_radar', lambda: get_risk_radar(conn, account_id), {'concentration': {}, 'radarScores': {}})
    corporate_action_impact = _compute('corporate_action_impact', lambda: get_corporate_action_impact(conn, account_id), {'events': []})
    timing_attribution = _compute('timing_attribution', lambda: get_timing_attribution(conn, account_id), {'buyAndHoldReturn': 0, 'actualReturn': 0, 'timingContribution': 0})
    wash_sale_alerts = _compute('wash_sale_alerts', lambda: get_wash_sale_alerts(conn, account_id), {'potentialWashSales': [], 'taxLossHarvestingOpportunities': []})
    options_strategy_lens = _compute('options_strategy_lens', lambda: get_options_strategy_lens(conn, account_id), {'currentStrategies': [], 'expiryCalendar': [], 'upcomingEAE': []})

    _tax_view = _compute('tax_view', lambda: get_tax_view(conn, account_id), {'realizedYtd': 0, 'unrealizedByHolding': []})
    _option_eae = _compute('option_eae', lambda: get_option_eae_events(conn, account_id), {'events': [], 'totalEvents': 0, 'summary': {}, 'byUnderlying': []})
    _cash_opp = _compute('cash_opportunity', lambda: get_cash_opportunity(conn, account_id), {'monthly': [], 'totalCredit': 0, 'totalDebit': 0, 'totalNet': 0})
    _data_quality = _compute('data_quality', lambda: get_data_quality(conn, account_id), {'tables': []})
    _data_quality_warning = _compute('data_quality_warning', lambda: get_data_quality_warning(conn, account_id), None)
    _realized_ytd = _compute('realized_ytd', lambda: get_realized_ytd(conn, account_id), {'ytd': 0, 'lt': 0, 'st': 0, 'asOf': None})
    change_in_nav = {
        'startingValue': round(perf_starting_value, 2),
        'endingValue': round(true_perf['latestEnding'], 2),
        'mtm': perf.get('mtm', 0),
        'realized': perf.get('realized', 0),
        'dividends': perf.get('dividends', 0),
        'interest': perf.get('interest', 0),
        'commissions': perf.get('commissions', 0),
        'twr': perf.get('twr', 0),
        'netDeposits': round(true_perf['netDeposits'], 2),
        'netTransfers': round(true_perf['netTransfers'], 2),
        'initialCapital': round(true_perf['initialCapital'], 2),
        'totalGain': round(total_gain, 2),
        'totalGainPct': round(total_gain_pct, 2),
        'changeInUnrealized': change_in_nav_details.get('change_in_unrealized', 0),
        'brokerFees': change_in_nav_details.get('broker_fees', 0),
        'forexCommissions': change_in_nav_details.get('forex_commissions', 0),
        'transactionTax': change_in_nav_details.get('transaction_tax', 0),
        'salesTax': change_in_nav_details.get('sales_tax', 0),
        'otherFees': change_in_nav_details.get('other_fees', 0),
        'clientFees': change_in_nav_details.get('client_fees', 0),
        'advisorFees': change_in_nav_details.get('advisor_fees', 0),
        'withholdingTax': change_in_nav_details.get('withholding_tax', 0),
        'corporateActionProceeds': change_in_nav_details.get('corporate_action_proceeds', 0),
        'netFxTrading': change_in_nav_details.get('net_fx_trading', 0),
        'fxTranslation': change_in_nav_details.get('fx_translation', 0),
        'realizedYtd': _realized_ytd.get('ytd', 0),
        'realizedLtYtd': _realized_ytd.get('lt', 0),
        'realizedStYtd': _realized_ytd.get('st', 0),
        'realizedYtdAsOf': _realized_ytd.get('asOf')
    }

    # 如果存在实时市场价格，将 asOfDate 更新为当前时间（精确到分钟）
    # 并基于 positions 表单独计算股价变动对净值的净影响，只调整 netLiquidation
    try:
        _cur = conn.cursor()
        _cur.execute("SELECT 1 FROM market_prices LIMIT 1")
        if _cur.fetchone():
            latest_date = datetime.now().strftime('%Y-%m-%d %H:%M')
            try:
                _cur.execute("SELECT symbol, price FROM market_prices")
                mp_map = {r[0]: safe_float(r[1]) for r in _cur.fetchall() if r[1] is not None}
                _cur.execute(
                    "SELECT DISTINCT symbol, asset_type, position_value, position_value_in_base, mark_price "
                    "FROM positions p1 WHERE date = ("
                    "SELECT MAX(date) FROM positions p2 WHERE p2.account_id = p1.account_id)"
                )
                delta = 0.0
                for sym, at, pv, pv_base, mp in _cur.fetchall():
                    pv = safe_float(pv)
                    pv_base = safe_float(pv_base)
                    mp = safe_float(mp)
                    live_price = mp_map.get(sym)
                    if live_price and at in ('STOCK', 'ETF') and pv and mp:
                        qty = pv / mp
                        fx = pv_base / pv if pv else 1.0
                        live_pv_base = qty * live_price * fx
                        delta += live_pv_base - pv_base
                    elif live_price and at == 'OPTION' and pv and mp:
                        contracts = pv / mp / 100
                        fx = pv_base / pv if pv else 1.0
                        live_pv_base = contracts * live_price * 100 * fx
                        delta += live_pv_base - pv_base
                if delta:
                    balance_breakdown['netLiquidation'] = round(balance_breakdown['netLiquidation'] + delta, 2)
                    # 同步实时 NAV 变化到依赖 netLiquidation 的其他字段，保持页面内一致
                    try:
                        leverage_metrics['netLiquidation'] = round(leverage_metrics.get('netLiquidation', 0) + delta, 2)
                        _nl = leverage_metrics['netLiquidation']
                        _ge = leverage_metrics.get('grossExposure', 0)
                        leverage_metrics['leverageRatio'] = round(_ge / _nl, 2) if _nl else 0
                    except Exception:
                        pass
                    try:
                        change_in_nav['endingValue'] = round(change_in_nav.get('endingValue', 0) + delta, 2)
                        _old_cg = change_in_nav.get('totalGain', 0)
                        _old_cgp = change_in_nav.get('totalGainPct', 0)
                        change_in_nav['totalGain'] = round(_old_cg + delta, 2)
                        if abs(_old_cgp) > 1e-9 and abs(_old_cg) > 1e-9:
                            _inv = _old_cg * 100.0 / _old_cgp
                            if _inv:
                                change_in_nav['totalGainPct'] = round(change_in_nav['totalGain'] / _inv * 100.0, 2)
                    except Exception:
                        pass
                    try:
                        for _rs in range_summaries.values():
                            _old_end = _rs.get('endNav', 0)
                            _old_gain = _rs.get('gain', 0)
                            _old_gp = _rs.get('gainPct', 0)
                            _rs['endNav'] = round(_old_end + delta, 2)
                            _rs['gain'] = round(_old_gain + delta, 2)
                            if abs(_old_gp) > 1e-9 and abs(_old_gain) > 1e-9:
                                _inv2 = _old_gain * 100.0 / _old_gp
                                if _inv2:
                                    _rs['gainPct'] = round(_rs['gain'] / _inv2 * 100.0, 2)
                    except Exception:
                        pass
            except Exception:
                pass
    except Exception:
        pass

    data = {
        'accountId': label,
        'asOfDate': latest_date,
        'generatedAt': datetime.now().strftime('%Y%m%d;%H%M%S'),
        'baseCurrency': base_currency,
        'fxRates': fx_rates,
        'historyRange': {
            'fromDate': earliest_date,
            'toDate': latest_date,
            'totalDays': len(nav_all)
        },
        'rangeSummaries': range_summaries,
        'summary': {
            'totalNav': round(balance_breakdown['netLiquidation'], 2),
            'stocks': round(balance_breakdown.get('stockValue', total_stocks_raw), 2),
            'etfs': round(balance_breakdown.get('etfValue', total_etfs_raw), 2),
            'options': round(balance_breakdown.get('optionValue', total_options_raw), 2),
            'cash': round(balance_breakdown['totalCash'], 2),
            'totalGain': round(total_gain, 2),
            'totalGainPct': round(total_gain_pct, 2)
        },
        'changeInNav': change_in_nav,
        'performance': {
            'startingValue': round(perf_starting_value, 2),
            'endingValue': round(true_perf['latestEnding'], 2),
            'mtm': perf.get('mtm', 0),
            'realized': perf.get('realized', 0),
            'dividends': perf.get('dividends', 0),
            'interest': perf.get('interest', 0),
            'commissions': perf.get('commissions', 0),
            'twr': perf.get('twr', 0),
            'netDeposits': round(true_perf['netDeposits'], 2),
            'netTransfers': round(true_perf['netTransfers'], 2),
            'initialCapital': round(true_perf['initialCapital'], 2)
        },
        'flowSummary': flow_summary,
        'dailyFlow': [{'date': d, 'flow': round(f, 2)} for d, f, e in flow_series],
        'history': history,
        'historyTwr': historyTwr,
        'historyMwr': historyMwr,
        'historySimpleReturns': historySimpleReturns,
        'historyAdjustedReturns': historyAdjustedReturns,
        'benchmarks': benchmarks,
        'openPositions': {'stocks': stocks, 'etfs': etfs, 'options': options},
        'optionEAE': option_eae,
        'cashReport': cash_report,
        'balanceBreakdown': balance_breakdown,
        'metrics': {
            'maxDrawdown': max_dd,
            'annualizedReturn': round(ann_return, 2),
            'annualizedVolatility': ann_metrics['annualizedVolatility'],
            'sharpeRatio': ann_metrics['sharpeRatio'],
            'calmarRatio': risk_metrics['calmarRatio'],
            'sortinoRatio': risk_metrics['sortinoRatio'],
            'maxConsecutiveWinMonths': risk_metrics['maxConsecutiveWinMonths'],
            'maxConsecutiveLossMonths': risk_metrics['maxConsecutiveLossMonths'],
            'cumulativeRealized': cum_realized,
            'totalTrades': sum(m['tradeCount'] for m in monthly_trade_stats)
        },
        'monthlyTradeStats': monthly_trade_stats,
        'monthlyReturns': monthly_returns,
        'monthlyRealGains': monthly_real_gains,
        'dailyPnL': daily_pnl,
        'tradePnLAnalysis': trade_pnl_analysis,
        'tradeBehavior': trade_behavior,
        'costBreakdown': cost_breakdown,
        'leverageMetrics': leverage_metrics,
        'taxSummary': tax_summary,
        'positionAttribution': position_attribution,
        'cashflowWaterfall': cashflow_waterfall,
        'trades': trades,
        'dividends': dividends,
        'cashTransactions': cash_transactions,
        'transactionFees': transaction_fees,
        'corporateActions': corporate_actions,
        'slb': slb,
        'priorPeriodPositions': prior_positions,
        'netStockPositions': net_stock_positions,
        'stmtFunds': stmt_funds,
        'mtmPerformanceSummary': mtm_performance,
        'changeInNavDetails': change_in_nav_details,
        'conversionRates': conversion_rates,
        'computationErrors': computation_errors,
        'positionChanges': position_changes,
        'latestDayTrades': latest_day_trades,
        'costBasisHoldings': cost_basis_holdings,
        'soldAnalysis': sold_analysis,
        'taxView': _tax_view,
        'optionEaeEvents': _option_eae,
        'cashOpportunity': _cash_opp,
        'dataQuality': _data_quality,
        'dataQualityWarning': _data_quality_warning,
        'positionTimeline': position_timeline,
        'orderExecution': order_execution,
        'fxExposure': fx_exposure,
        'slbIncome': slb_income,
        'enhancedCashflow': enhanced_cashflow,
        'tradingHeatmap': trading_heatmap,
        'tradeRankings': trade_rankings,
        'dividendTracker': dividend_tracker,
        'feeErosion': fee_erosion,
        'riskRadar': risk_radar,
        'corporateActionImpact': corporate_action_impact,
        'timingAttribution': timing_attribution,
        'washSaleAlerts': wash_sale_alerts,
        'optionsStrategyLens': options_strategy_lens,
    }
    return data


def generate_account_comparison(conn):
    cursor = conn.cursor()
    cursor.execute('''
        SELECT account_id, COUNT(*), MIN(date), MAX(date), SUM(ending_value)
        FROM daily_nav GROUP BY account_id ORDER BY account_id
    ''')
    accounts = []
    for row in cursor.fetchall():
        accounts.append({
            'accountId': row[0],
            'days': row[1],
            'fromDate': row[2],
            'toDate': row[3],
            'latestNav': round(row[4], 2)
        })
    return accounts


def _sanitize_json(obj):
    """递归清理 NaN / Infinity，使其符合标准 JSON"""
    if isinstance(obj, dict):
        return {k: _sanitize_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_json(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, np.floating):
        v = float(obj)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    if isinstance(obj, np.integer):
        return int(obj)
    return obj


def main():
    conn = sqlite3.connect(DB_PATH)
    
    cursor = conn.cursor()
    cursor.execute('SELECT DISTINCT account_id FROM daily_nav ORDER BY account_id')
    account_ids = [row[0] for row in cursor.fetchall()]
    
    print(f"🗄️  发现账户: {', '.join(account_ids)}")
    
    for acc in account_ids:
        output = f'data/dashboard_{acc}.json'
        data = generate_dashboard_data(conn, acc, acc)
        if data:
            data = _sanitize_json(data)
            with open(output, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            print(f"✅ {acc}: {data['historyRange']['fromDate']} ~ {data['historyRange']['toDate']} ({data['historyRange']['totalDays']}天)")
            print(f"   最大回撤: {data['metrics']['maxDrawdown']:.2f}% | 年化收益: {data['metrics']['annualizedReturn']:.2f}% | 年化波动: {data['metrics']['annualizedVolatility']:.2f}%")
    
    combined = generate_dashboard_data(conn, None, 'COMBINED')
    if combined:
        combined = _sanitize_json(combined)
        with open('data/dashboard_combined.json', 'w', encoding='utf-8') as f:
            json.dump(combined, f, indent=2, ensure_ascii=False)
        print(f"✅ COMBINED: {combined['historyRange']['fromDate']} ~ {combined['historyRange']['toDate']} ({combined['historyRange']['totalDays']}天)")
        print(f"   合并总资产: ${combined['summary']['totalNav']:,.0f}")
        print(f"   最大回撤: {combined['metrics']['maxDrawdown']:.2f}% | 年化收益: {combined['metrics']['annualizedReturn']:.2f}% | 年化波动: {combined['metrics']['annualizedVolatility']:.2f}%")
        for k, v in combined['rangeSummaries'].items():
            if v['days'] > 0:
                print(f"   {k}: {v['days']}天 收益 ${v['gain']:,.0f} ({v['gainPct']:.2f}%)")
    
    conn.close()
    print("\n💾 所有 JSON 已保存到 data/ 目录")


if __name__ == '__main__':
    main()
