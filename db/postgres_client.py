"""PostgreSQL client for IB Dashboard SaaS."""
import os
import re
from contextlib import contextmanager
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

# Read from env; fallback to local docker-compose defaults
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "ib_dashboard")
DB_USER = os.environ.get("DB_USER", os.environ.get("USER", "postgres"))
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")

_connection_pool: Optional[ThreadedConnectionPool] = None


def _get_dsn():
    return f"host={DB_HOST} port={DB_PORT} dbname={DB_NAME} user={DB_USER} password={DB_PASSWORD}"


def init_pool(min_conn=1, max_conn=20):
    global _connection_pool
    if _connection_pool is None:
        _connection_pool = ThreadedConnectionPool(
            minconn=min_conn,
            maxconn=max_conn,
            dsn=_get_dsn(),
        )
    return _connection_pool


@contextmanager
def get_conn():
    """Yield a raw psycopg2 connection from the pool."""
    pool = init_pool()
    conn = pool.getconn()
    try:
        yield conn
    finally:
        pool.putconn(conn)


@contextmanager
def get_cursor(cursor_factory=RealDictCursor):
    """Yield a cursor; auto-commit on success, rollback on error."""
    with get_conn() as conn:
        cursor = conn.cursor(cursor_factory=cursor_factory)
        try:
            yield cursor
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cursor.close()


def execute(sql, params=None):
    with get_cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else []


def execute_one(sql, params=None):
    rows = execute(sql, params)
    return rows[0] if rows else None


def snake_case(name: str) -> str:
    s = re.sub(r'(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s).lower()


def ensure_archive_table(tag_name: str, attrs: list):
    """Dynamically create an archive_* table if it doesn't exist."""
    table_name = f"archive_{snake_case(tag_name)}"
    col_defs = [
        '"user_id" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE',
        '"stmt_date" DATE NOT NULL',
        '"stmt_account_id" TEXT',
    ]
    effective_attrs = list(attrs)
    if tag_name == 'Trade':
        existing = {snake_case(a) for a in effective_attrs}
        for must in ['tradeId', 'transactionId']:
            if snake_case(must) not in existing:
                effective_attrs.append(must)

    for attr in effective_attrs:
        col_defs.append(f'"{snake_case(attr)}" TEXT')

    create_sql = f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            {', '.join(col_defs)}
        )
    """
    with get_cursor() as cur:
        cur.execute(create_sql)

    # Add missing columns
    with get_cursor() as cur:
        cur.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
            (table_name,),
        )
        existing = {r['column_name'] for r in cur.fetchall()}
        for attr in attrs:
            col = snake_case(attr)
            if col not in existing:
                alter_sql = f'ALTER TABLE {table_name} ADD COLUMN "{col}" TEXT'
                cur.execute(alter_sql)
