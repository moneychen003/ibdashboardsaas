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
            where_clauses = ["user_id = %s"]
            params = [user_id]
            if account_col and not is_combined:
                where_clauses.append(f"{account_col} = %s")
                params.append(account_id)

            where = " AND ".join(where_clauses)
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

    cur_sql.execute("PRAGMA foreign_keys = ON")
    return conn_sql


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
        try:
            data = sqlite_to_dashboard.generate_dashboard_data(conn, pg_account, pg_label)
        finally:
            sys.stdout = old_stdout
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
