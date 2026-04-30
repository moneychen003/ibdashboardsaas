#!/usr/bin/env python3
"""
PostgreSQL → Dashboard JSON 生成器（桥接版 v2）

策略：把当前用户/账户在 PostgreSQL 中的数据同步到一个内存 SQLite 数据库，
然后复用已有的 sqlite_to_dashboard.py 生成完整 Dashboard JSON。
不再依赖磁盘上的 ib_history.db 文件。
"""
import os
import sys
import sqlite3
import uuid
from decimal import Decimal
from datetime import date, datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from db.postgres_client import get_cursor

# 旧版 dashboard 生成器（SQLite）
from scripts import sqlite_to_dashboard


def _convert_value(v):
    """把 PostgreSQL 返回值转成 SQLite 友好类型。"""
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (list, dict)):
        import json
        return json.dumps(v, ensure_ascii=False, default=str)
    # yfinance/pandas 导入后可能引入 numpy 类型
    try:
        import numpy as np
        if isinstance(v, np.generic):
            return v.item()
    except Exception:
        pass
    return v


def _pg_type_to_sqlite(data_type):
    dt = (data_type or '').lower()
    if dt in ('integer', 'bigint', 'smallint', 'serial', 'bigserial'):
        return 'INTEGER'
    if dt in ('numeric', 'decimal', 'real', 'double precision', 'float'):
        return 'REAL'
    if dt in ('timestamp with time zone', 'timestamp without time zone', 'date'):
        return 'TEXT'
    return 'TEXT'


def _create_sqlite_table(cur_sql, table_name, pg_columns):
    """根据 PG 列信息在 SQLite 中创建表（排除 user_id）。"""
    col_defs = []
    for col in pg_columns:
        col_name = col['column_name']
        if col_name == 'user_id':
            continue
        sqlite_type = _pg_type_to_sqlite(col['data_type'])
        col_defs.append(f'"{col_name}" {sqlite_type}')
    if not col_defs:
        return False
    cols_sql = ', '.join(col_defs)
    create_sql = f'CREATE TABLE IF NOT EXISTS {table_name} ({cols_sql})'
    cur_sql.execute(create_sql)
    return True


def _sync_account_to_temp_sqlite(user_id: str, account_id: str, is_combined: bool = False):
    """
    1. 创建内存 SQLite
    2. 根据 PostgreSQL schema 自动创建对应 SQLite 表
    3. 把 PostgreSQL 中该 user_id (+ account_id) 的数据同步进去
    返回 sqlite3 connection
    """
    conn_sql = sqlite3.connect(':memory:')
    cur_sql = conn_sql.cursor()
    cur_sql.execute("PRAGMA foreign_keys = OFF")

    # 获取 PostgreSQL 中所有业务表
    with get_cursor() as cur_pg:
        cur_pg.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        """)
        pg_table_set = {r['table_name'] for r in cur_pg.fetchall()}

    # 要同步的表（排除系统/用户/审计表）
    exclude_tables = {
        '_schema_meta', 'import_audit', 'sqlite_sequence',
        'users', 'user_profiles', 'user_accounts', 'user_flex_credentials',
        'xml_uploads', 'flex_sync_logs', 'admin_audit_logs'
    }
    sync_tables = sorted(pg_table_set - exclude_tables)

    for table in sync_tables:
        with get_cursor() as cur_pg:
            # 获取列信息
            cur_pg.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = %s AND table_schema = 'public'
                ORDER BY ordinal_position
            """, (table,))
            col_info = cur_pg.fetchall()
            if not col_info:
                continue

            pg_cols = [r['column_name'] for r in col_info]

            # 创建 SQLite 表
            if not _create_sqlite_table(cur_sql, table, col_info):
                continue

            # 查找 account 相关列
            account_col = None
            for c in pg_cols:
                if c.lower() in ('account_id', 'accountid', 'stmt_account_id', 'acctid'):
                    account_col = c
                    break

            # 构建 WHERE 条件
            # market_prices.symbol 是单列 PK，user_id 列会被最后一个 upsert 的用户覆盖，
            # 按 user_id 过滤会导致某些 symbol 彻底丢给其他用户 —— 但价格本身是全局共享的。
            # 这里跳过 user 过滤，让所有 symbol 的最新价都进 temp SQLite。
            if table == 'market_prices':
                where_clauses = []
                params = []
            else:
                where_clauses = ["user_id = %s"]
                params = [user_id]
            if account_col and not is_combined:
                where_clauses.append(f"{account_col} = %s")
                params.append(account_id)

            where = " AND ".join(where_clauses) if where_clauses else "1=1"
            common_cols = [c for c in pg_cols if c != 'user_id']
            cols_str = ",".join(common_cols)

            cur_pg.execute(f"SELECT {cols_str} FROM {table} WHERE {where}", tuple(params))
            rows = cur_pg.fetchall()

            if rows:
                placeholders = ",".join(["?"] * len(common_cols))
                converted = []
                for r in rows:
                    row_vals = []
                    for c, v in zip(common_cols, r.values()):
                        val = _convert_value(v)
                        # cost_basis 表的日期字段统一为 YYYYMMDD，与 archive_trade 保持一致
                        if c in ('trade_date', 'last_trade_date') and isinstance(val, str) and len(val) == 10 and val[4] == '-' and val[7] == '-':
                            val = val.replace('-', '')
                        row_vals.append(val)
                    converted.append(tuple(row_vals))
                cur_sql.executemany(
                    f"INSERT OR IGNORE INTO {table} ({cols_str}) VALUES ({placeholders})",
                    converted
                )

        conn_sql.commit()

    # 多账户不同本币时归一化到同一目标币种
    if is_combined:
        _normalize_currencies_in_sqlite(conn_sql, user_id)

    cur_sql.execute("PRAGMA foreign_keys = ON")
    return conn_sql


def _normalize_currencies_in_sqlite(conn_sql, user_id):
    """多账户跨币种归一化。

    当用户有不同本币的账户（如 HKD + USD）时，各账户 daily_nav 等表的
    金额以各自本币计价。直接 SUM 会得到无意义的混合币种数字。
    这里在内存 SQLite 中把非目标币种账户的金额字段统一换算到目标币种。
    """
    cur = conn_sql.cursor()

    # Step 1: 每个账户的本币
    cur.execute("""
        SELECT a.stmt_account_id, a.currency
        FROM archive_account_information a
        JOIN (
            SELECT stmt_account_id, MAX(stmt_date) AS max_date
            FROM archive_account_information
            WHERE currency IS NOT NULL AND currency != ''
            GROUP BY stmt_account_id
        ) latest
        ON a.stmt_account_id = latest.stmt_account_id
            AND a.stmt_date = latest.max_date
    """)
    account_currencies = {}
    for row in cur.fetchall():
        acc_id, curr = row[0], (row[1] or '').strip().upper()
        if acc_id and curr:
            account_currencies[acc_id] = curr

    # 补充 daily_nav 中有但 archive_account_information 中没有的账户
    cur.execute("SELECT DISTINCT account_id FROM daily_nav")
    for (acc_id,) in cur.fetchall():
        if acc_id and acc_id not in account_currencies:
            cur.execute("""
                SELECT currency FROM archive_equity_summary_by_report_date_in_base
                WHERE stmt_account_id = ? ORDER BY report_date DESC LIMIT 1
            """, (acc_id,))
            row = cur.fetchone()
            if row and row[0]:
                account_currencies[acc_id] = str(row[0]).strip().upper()

    if len(account_currencies) < 2:
        return

    unique_currencies = set(account_currencies.values())
    if len(unique_currencies) <= 1:
        return  # 所有账户同币种，无需处理

    # Step 2: 确定目标币种
    target = 'USD'
    try:
        user_base = getattr(sqlite_to_dashboard._cb_context, 'user_base_currency', None)
        if user_base:
            target = str(user_base).strip().upper()
    except Exception:
        pass
    if target not in unique_currencies:
        target = 'USD'  # 回退到 USD

    # Step 3: 计算每个账户的转换因子
    # IB archive_conversion_rate: from_currency → to_currency (account base)
    # rate 含义: 1 from_currency = ? to_currency
    # 要把 account_curr 转成 target: account_value / rate, 即 factor = 1/rate

    # 硬编码常用货币对 USD 的汇率，作为 archive 表缺数据时的兜底
    _USD_RATES = {
        'USD': 1.0, 'HKD': 7.85, 'CNH': 7.1887, 'CNY': 7.23,
        'EUR': 0.92, 'GBP': 0.79, 'JPY': 149.0, 'SGD': 1.34,
        'CHF': 0.88, 'CAD': 1.37, 'AUD': 1.53, 'KRW': 1350.0,
        'INR': 83.0, 'MXN': 17.0, 'NOK': 10.5, 'SEK': 10.3,
        'DKK': 6.9, 'NZD': 1.63, 'ZAR': 18.0, 'TRY': 32.0,
    }

    def _get_factor_from_db(from_cur, to_cur):
        cur.execute("""
            SELECT c.rate FROM archive_conversion_rate c
            JOIN (
                SELECT stmt_account_id, MAX(stmt_date) AS max_date
                FROM archive_conversion_rate
                WHERE from_currency = ? AND to_currency = ?
                GROUP BY stmt_account_id
            ) latest ON c.stmt_account_id = latest.stmt_account_id
                AND c.stmt_date = latest.max_date
            WHERE c.from_currency = ? AND c.to_currency = ?
            LIMIT 1
        """, (from_cur, to_cur, from_cur, to_cur))
        row = cur.fetchone()
        if row and row[0]:
            try:
                return float(row[0])
            except (ValueError, TypeError):
                pass
        return None

    conversion_factors = {}
    for acc_id, acc_curr in account_currencies.items():
        if acc_curr == target:
            continue

        factor = None

        # 方法1: 直接查 target → acc_curr
        rate = _get_factor_from_db(target, acc_curr)
        if rate and rate > 0:
            factor = 1.0 / rate

        # 方法2: 三角换算 through USD
        if factor is None and target != 'USD' and acc_curr != 'USD':
            acc_usd_rate = _get_factor_from_db('USD', acc_curr)
            usd_target_rate = _get_factor_from_db('USD', target)
            if acc_usd_rate and usd_target_rate and acc_usd_rate > 0:
                factor = usd_target_rate / acc_usd_rate

        # 方法3: 硬编码兜底
        if factor is None:
            acc_to_usd = _USD_RATES.get(acc_curr)
            target_to_usd = _USD_RATES.get(target)
            if acc_to_usd and target_to_usd and acc_to_usd > 0:
                factor = target_to_usd / acc_to_usd

        if factor is not None and abs(factor - 1.0) > 0.0001:
            conversion_factors[acc_id] = factor

    if not conversion_factors:
        return

    # Step 4: 归一化 daily_nav（核心：NAV/NetLiq/收益计算全依赖此表）
    monetary_cols = ['ending_value', 'starting_value', 'mtm',
                     'realized', 'dividends', 'interest', 'commissions']
    for acc_id, factor in conversion_factors.items():
        for col in monetary_cols:
            cur.execute(
                f"UPDATE daily_nav SET {col} = CAST(COALESCE({col},'0') AS REAL) * ? "
                f"WHERE account_id = ?",
                (factor, acc_id))

    # Step 4b: 更新 archive_account_information.currency 为目标币种，
    # 避免 sqlite_to_dashboard 聚合层重复换算（双层防线协调）。
    for acc_id in conversion_factors:
        cur.execute(
            "UPDATE archive_account_information SET currency = ? "
            "WHERE stmt_account_id = ?", (target, acc_id))
        # 同时更新 archive_equity_summary_by_report_date_in_base 的 currency 列（如有）
        try:
            cur.execute(
                "UPDATE archive_equity_summary_by_report_date_in_base "
                "SET currency = ? WHERE stmt_account_id = ?", (target, acc_id))
        except sqlite3.OperationalError:
            pass

    # Step 5: 归档 open_position 的 position_value / fifo_pnl_unrealized
    # 是证券交易币种（如美股是 USD），不是账户本币，跳过不换算。
    # 合并视图的跨币种换算由 sqlite_to_dashboard 聚合层处理。

    # Step 6: 归一化 positions 表（实时持仓视角）
    # position_value 是证券交易币种不动；position_value_in_base / mark_price_in_base 是本币需换算。
    cur.execute("PRAGMA table_info(positions)")
    pos2_cols = {row[1] for row in cur.fetchall()}
    pos2_monetary = ['position_value_in_base', 'mark_price_in_base']
    for acc_id, factor in conversion_factors.items():
        for col in pos2_monetary:
            if col in pos2_cols:
                try:
                    cur.execute(
                        f"UPDATE positions SET {col} = "
                        f"CAST(COALESCE({col},'0') AS REAL) * ? "
                        f"WHERE account_id = ?",
                        (factor, acc_id))
                except sqlite3.OperationalError:
                    pass

    # Step 7: 归一化 archive_equity_summary_by_report_date_in_base（"in base" = 本币）
    cur.execute("PRAGMA table_info(archive_equity_summary_by_report_date_in_base)")
    eq_cols = {row[1] for row in cur.fetchall()}
    eq_monetary = ['cash', 'stock', 'funds', 'bonds', 'options', 'commodities',
                   'cfd_unrealized_pl', 'dividend_accruals', 'interest_accruals',
                   'total', 'previous_day_equity']
    for acc_id, factor in conversion_factors.items():
        for col in eq_monetary:
            if col in eq_cols:
                try:
                    cur.execute(
                        f"UPDATE archive_equity_summary_by_report_date_in_base "
                        f"SET {col} = CAST(COALESCE({col},'0') AS REAL) * ? "
                        f"WHERE stmt_account_id = ?",
                        (factor, acc_id))
                except sqlite3.OperationalError:
                    pass

    # Step 8: archive_cash_report_currency 每行有独立 currency 字段，
    # 值为该币种面额（USD 现金是 USD，HKD 现金是 HKD），不随账户本币变化。
    # 跨账户同币种直接 SUM 即正确，无需换算。

    # Step 9: cash_report 表同理，值为各币种面额，跳过不换算。

    conn_sql.commit()


def generate_dashboard_data(user_id: str, account_id: str):
    """
    生成完整 Dashboard JSON。
    对于 'combined' 账户，先同步该用户全部账户的数据到内存 SQLite，再调用合并视图逻辑。
    """
    user_id = str(user_id)
    account_id = str(account_id) if account_id else 'combined'

    conn = _sync_account_to_temp_sqlite(user_id, account_id, is_combined=(account_id == 'combined'))
    try:
        pg_account = None if account_id == 'combined' else account_id
        pg_label = account_id if account_id == 'combined' else account_id
        # 屏蔽旧版脚本里的 print 输出，避免污染返回值/日志
        import io
        old_stdout = sys.stdout
        sys.stdout = io.StringIO()
        # 注入用户偏好基础货币（user_profiles.base_currency）。失败时不阻塞生成。
        user_base = None
        try:
            with get_cursor() as cur_pg:
                cur_pg.execute("SELECT base_currency FROM user_profiles WHERE user_id = %s", (user_id,))
                row = cur_pg.fetchone()
                if row:
                    user_base = (row.get('base_currency') if isinstance(row, dict) else row[0]) or None
        except Exception:
            user_base = None
        sqlite_to_dashboard.set_cost_basis_user_context(user_id)
        sqlite_to_dashboard.set_user_base_currency(user_base)
        try:
            data = sqlite_to_dashboard.generate_dashboard_data(conn, pg_account, pg_label)
        finally:
            sys.stdout = old_stdout
            sqlite_to_dashboard.set_cost_basis_user_context(None)
            sqlite_to_dashboard.set_user_base_currency(None)
    finally:
        conn.close()
    return data


if __name__ == '__main__':
    import json
    uid = sys.argv[1] if len(sys.argv) > 1 else None
    acc = sys.argv[2] if len(sys.argv) > 2 else 'combined'
    if not uid:
        print("Usage: python3 postgres_to_dashboard.py <user_id> [account_id]")
        sys.exit(1)
    data = generate_dashboard_data(uid, acc)
    print(json.dumps(data, indent=2, ensure_ascii=False, default=str))
