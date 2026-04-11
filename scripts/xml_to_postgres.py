#!/usr/bin/env python3
"""IB FlexQuery XML → PostgreSQL 导入器（多租户版）"""

import xml.etree.ElementTree as ET
import sys
import os
import hashlib
import re
from collections import defaultdict
from datetime import datetime

# Add parent dir to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from db.postgres_client import get_cursor, snake_case, ensure_archive_table

CONTAINER_TAGS = {
    'FlexQueryResponse', 'FlexStatements',
    'EquitySummaryInBase', 'FIFOPerformanceSummaryInBase',
    'MTMPerformanceSummaryInBase', 'CashReport', 'StmtFunds',
    'ChangeInPositionValues'
}


def discover_schema(statements):
    attrs_by_tag = defaultdict(set)
    for stmt in statements:
        for elem in stmt.iter():
            tag = elem.tag
            if tag in CONTAINER_TAGS:
                continue
            for attr in elem.attrib:
                attrs_by_tag[tag].add(attr)
    return {tag: sorted(attrs) for tag, attrs in attrs_by_tag.items()}


def import_all_nodes(cursor, user_id, statements, schema, insert_stmts):
    counts = defaultdict(int)
    for stmt in statements:
        date_raw = stmt.get('toDate')
        if not date_raw:
            continue
        statement_date = f"{date_raw[:4]}-{date_raw[4:6]}-{date_raw[6:]}"
        account_id = stmt.get('accountId', '')

        import_core_tables(cursor, user_id, stmt, statement_date, account_id)

        # Remove existing archive rows for this statement to ensure idempotency
        for tag in schema:
            table_name = f"archive_{snake_case(tag)}"
            cursor.execute(
                f"DELETE FROM {table_name} WHERE user_id = %s AND stmt_date = %s AND stmt_account_id = %s",
                (user_id, statement_date, account_id)
            )

        for elem in stmt.iter():
            tag = elem.tag
            if tag in CONTAINER_TAGS or tag not in schema:
                continue

            attrs = schema[tag]
            effective_attrs = list(attrs)
            if tag == 'Trade':
                existing_snake = {snake_case(a) for a in effective_attrs}
                for must_have in ['tradeId', 'transactionId']:
                    if snake_case(must_have) not in existing_snake:
                        effective_attrs.append(must_have)

            values = [user_id, statement_date, account_id]
            for attr in effective_attrs:
                values.append(elem.get(attr, ''))

            table_name = f"archive_{snake_case(tag)}"
            sql = insert_stmts.get(table_name)
            if not sql:
                continue
            cursor.execute(sql, values)
            counts[tag] += 1

    return counts


def _collect_symbol_fx_rates(stmt):
    """从 Trade / OptionEAE 节点收集 symbol -> fx_rate_to_base 映射。"""
    fx_map = {}
    for tag in ['Trade', 'OptionEAE']:
        for elem in stmt.findall(f'.//{tag}'):
            symbol = elem.get('symbol', '') or elem.get('underlyingSymbol', '')
            fx = elem.get('fxRateToBase', '')
            if symbol and fx:
                try:
                    fx_map[symbol] = float(fx)
                except (ValueError, TypeError):
                    pass
    return fx_map


def _collect_currency_fx_rates(stmt):
    """从 ConversionRate 节点收集 currency -> fx_rate_to_base 映射（toCurrency 为基准货币）。"""
    fx_map = {}
    for elem in stmt.findall('.//ConversionRate'):
        from_currency = elem.get('fromCurrency', '')
        rate = elem.get('rate', '')
        if from_currency and rate:
            try:
                fx_map[from_currency] = float(rate)
            except (ValueError, TypeError):
                pass
    return fx_map


def import_core_tables(cursor, user_id, stmt, statement_date, account_id):
    symbol_fx_map = _collect_symbol_fx_rates(stmt)
    currency_fx_map = _collect_currency_fx_rates(stmt)

    # daily_nav
    change_in_nav = stmt.find('ChangeInNAV')
    if change_in_nav is not None:
        cursor.execute('''
            INSERT INTO daily_nav
            (user_id, account_id, date, starting_value, ending_value, mtm, realized, dividends, interest, commissions, twr, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, account_id, date) DO UPDATE SET
                starting_value = EXCLUDED.starting_value,
                ending_value = EXCLUDED.ending_value,
                mtm = EXCLUDED.mtm,
                realized = EXCLUDED.realized,
                dividends = EXCLUDED.dividends,
                interest = EXCLUDED.interest,
                commissions = EXCLUDED.commissions,
                twr = EXCLUDED.twr,
                created_at = EXCLUDED.created_at
        ''', (
            user_id, account_id, statement_date,
            float(change_in_nav.get('startingValue', 0) or 0),
            float(change_in_nav.get('endingValue', 0) or 0),
            float(change_in_nav.get('mtm', 0) or 0),
            float(change_in_nav.get('realized', 0) or 0),
            float(change_in_nav.get('dividends', 0) or 0),
            float(change_in_nav.get('interest', 0) or 0),
            float(change_in_nav.get('commissions', 0) or 0),
            float(change_in_nav.get('twr', 0) or 0),
            datetime.now().isoformat()
        ))

    # positions
    for pos in stmt.findall('.//OpenPosition'):
        symbol = pos.get('symbol', '')
        if not symbol:
            continue
        description = pos.get('description', '')
        position_value = float(pos.get('positionValue', 0) or 0)
        mark_price = float(pos.get('markPrice', 0) or 0)
        fx_rate = symbol_fx_map.get(symbol, 0)
        if not fx_rate:
            currency = pos.get('currency', '')
            if not currency:
                currency = 'USD'
            fx_rate = currency_fx_map.get(currency, 0)
        position_value_in_base = position_value * fx_rate if fx_rate else None
        mark_price_in_base = mark_price * fx_rate if fx_rate else None
        asset_type = 'STOCK'
        etf_symbols = {'QQQ', 'QQQM', 'QQQI', 'SPY', 'SPYM', 'VOO', 'SGOV', 'SOXX', 'EWY', 'JEPI', 'BOXX'}
        if 'ETF' in description.upper() or symbol in etf_symbols:
            asset_type = 'ETF'
        elif any(x in symbol for x in ['  ', 'P', 'C']) and len(symbol) > 6:
            asset_type = 'OPTION'

        cursor.execute('''
            INSERT INTO positions (user_id, account_id, date, symbol, description, asset_type, position_value, mark_price, position_value_in_base, mark_price_in_base)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, account_id, date, symbol) DO UPDATE SET
                description = EXCLUDED.description,
                asset_type = EXCLUDED.asset_type,
                position_value = EXCLUDED.position_value,
                mark_price = EXCLUDED.mark_price,
                position_value_in_base = EXCLUDED.position_value_in_base,
                mark_price_in_base = EXCLUDED.mark_price_in_base
        ''', (user_id, account_id, statement_date, symbol, description, asset_type, position_value, mark_price, position_value_in_base, mark_price_in_base))

    # cash_report
    for cash in stmt.findall('.//CashReportCurrency'):
        currency = cash.get('currency')
        if currency:
            cursor.execute('''
                INSERT INTO cash_report (user_id, account_id, date, currency, cash)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id, account_id, date, currency) DO UPDATE SET
                    cash = EXCLUDED.cash
            ''', (user_id, account_id, statement_date, currency, float(cash.get('cash', 0) or 0)))

    for cash in stmt.findall('.//CashReport'):
        currency = cash.get('currency')
        if currency:
            cursor.execute('''
                INSERT INTO cash_report (user_id, account_id, date, currency, cash)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id, account_id, date, currency) DO UPDATE SET
                    cash = EXCLUDED.cash
            ''', (user_id, account_id, statement_date, currency, float(cash.get('cash', 0) or 0)))

    # option_eae
    for opt in stmt.findall('.//OptionEAE'):
        def safe_float(val):
            try:
                return float(val) if val else 0
            except (ValueError, TypeError):
                return 0

        tx_type = opt.get('transactionType', '')
        symbol = opt.get('symbol', '')
        date = opt.get('date', '')
        if not tx_type or not symbol or not date:
            continue
        if tx_type not in ('Assignment', 'Exercise', 'Expiration'):
            continue

        cursor.execute('''
            INSERT INTO option_eae
            (user_id, account_id, date, symbol, description, underlying_symbol, strike, expiry, put_call, transaction_type, quantity, trade_price, mark_price, mtm_pnl, currency)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, account_id, date, symbol, transaction_type) DO UPDATE SET
                description = EXCLUDED.description,
                underlying_symbol = EXCLUDED.underlying_symbol,
                strike = EXCLUDED.strike,
                expiry = EXCLUDED.expiry,
                put_call = EXCLUDED.put_call,
                quantity = EXCLUDED.quantity,
                trade_price = EXCLUDED.trade_price,
                mark_price = EXCLUDED.mark_price,
                mtm_pnl = EXCLUDED.mtm_pnl,
                currency = EXCLUDED.currency
        ''', (
            user_id, account_id, date, symbol, opt.get('description', ''),
            opt.get('underlyingSymbol', ''),
            safe_float(opt.get('strike')),
            opt.get('expiry', ''),
            opt.get('putCall', ''),
            tx_type,
            safe_float(opt.get('quantity')),
            safe_float(opt.get('tradePrice')),
            safe_float(opt.get('markPrice')),
            safe_float(opt.get('mtmPnl')),
            opt.get('currency', '')
        ))


def build_insert_sql(tag, attrs):
    effective_attrs = list(attrs)
    if tag == 'Trade':
        existing_snake = {snake_case(a) for a in effective_attrs}
        for must_have in ['tradeId', 'transactionId']:
            if snake_case(must_have) not in existing_snake:
                effective_attrs.append(must_have)

    col_names = ['"user_id"', '"stmt_date"', '"stmt_account_id"'] + [f'"{snake_case(a)}"' for a in effective_attrs]
    table_name = f"archive_{snake_case(tag)}"
    placeholders = ', '.join(['%s'] * len(col_names))

    sql = f'''
        INSERT INTO {table_name} ({', '.join(col_names)})
        VALUES ({placeholders})
    '''
    return table_name, sql


def init_db_from_schema(schema):
    """Ensure all archive tables exist."""
    for tag, attrs in schema.items():
        ensure_archive_table(tag, attrs)

    with get_cursor() as cur:
        # Update schema meta
        for tag, attrs in schema.items():
            table_name = f"archive_{snake_case(tag)}"
            cur.execute('''
                INSERT INTO _schema_meta (tag_name, table_name, attributes, created_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (tag_name) DO UPDATE SET
                    table_name = EXCLUDED.table_name,
                    attributes = EXCLUDED.attributes,
                    updated_at = NOW()
            ''', (tag, table_name, ','.join(attrs), datetime.now().isoformat()))


def run_import(user_id: str, xml_file: str, upload_id: str = None):
    with open(xml_file, 'rb') as f:
        file_md5 = hashlib.md5(f.read()).hexdigest()
    file_name = os.path.basename(xml_file)

    stmt_date = ''
    account_id = ''
    counts = {}
    rows_inserted = 0
    status = 'failed'
    error_message = ''

    try:
        print(f"📥 解析 XML: {xml_file}")
        tree = ET.parse(xml_file)
        root = tree.getroot()
        statements = root.findall('.//FlexStatement')
        print(f"   发现 {len(statements)} 个 FlexStatement")

        if statements:
            date_raw = statements[0].get('toDate', '')
            if date_raw:
                stmt_date = f"{date_raw[:4]}-{date_raw[4:6]}-{date_raw[6:]}"
            account_id = statements[0].get('accountId', '')

        print("🔍 扫描 Schema...")
        schema = discover_schema(statements)
        print(f"   发现 {len(schema)} 种节点类型")

        print("🗄️  初始化 PostgreSQL 表...")
        init_db_from_schema(schema)

        # Build insert statements
        insert_stmts = {}
        for tag, attrs in schema.items():
            table_name, sql = build_insert_sql(tag, attrs)
            insert_stmts[table_name] = sql

        print("📝 导入所有节点数据...")
        with get_cursor() as cur:
            counts = import_all_nodes(cur, user_id, statements, schema, insert_stmts)
            rows_inserted = sum(counts.values())

        status = 'done'
        print(f"\n✅ 导入完成")
        print(f"   核心 daily_nav: {len(statements)} 条")
        for tag, count in sorted(counts.items(), key=lambda x: -x[1])[:15]:
            print(f"     archive_{snake_case(tag)}: {count} 条")

    except Exception as e:
        error_message = str(e)
        status = 'failed'
        import traceback
        traceback.print_exc()
    finally:
        if upload_id:
            with get_cursor() as cur:
                cur.execute('''
                    UPDATE xml_uploads
                    SET rows_inserted = %s,
                        status = %s,
                        error_message = %s,
                        completed_at = NOW()
                    WHERE id = %s
                ''', (rows_inserted, status, error_message, upload_id))

    return {
        'status': status,
        'rows_inserted': rows_inserted,
        'error_message': error_message,
        'stmt_date': stmt_date,
        'account_id': account_id,
        'counts': dict(counts)
    }


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("用法: python3 xml_to_postgres.py <user_id> <xml_file> [upload_id]")
        sys.exit(1)
    user_id = sys.argv[1]
    xml_file = sys.argv[2]
    upload_id = sys.argv[3] if len(sys.argv) > 3 else None
    result = run_import(user_id, xml_file, upload_id)
    print(result)
