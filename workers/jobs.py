"""RQ background jobs for IB Dashboard SaaS."""
import os
import sys
import time
import uuid
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import requests
from db.postgres_client import get_cursor, execute_one
from scripts.xml_to_postgres import run_import
from scripts.incremental_cost_basis import refresh_user_account
from scripts.generate_dashboards import _write_json_and_cache
import scripts.postgres_to_dashboard as pgdash
from utils.crypto_token import decrypt_token
from utils.quotas import enforce_history_retention, get_user_limits, check_account_limit
from utils.telegram import send_telegram_message
from rq import get_current_job
from db.postgres_client import execute


def import_xml_job(user_id: str, upload_id: str, file_path: str):
    """Background job: import XML into PostgreSQL and refresh cost basis."""
    # Update status to running
    with get_cursor() as cur:
        cur.execute(
            "UPDATE xml_uploads SET status = 'running' WHERE id = %s",
            (upload_id,)
        )

    # Run import
    result = run_import(user_id, file_path, upload_id)

    if result['status'] == 'done' and result.get('account_id'):
        # Refresh cost basis for the affected account
        account_id = result['account_id']
        # Check account limit before creating new account record
        ok, err = check_account_limit(user_id, account_id)
        if ok:
            with get_cursor() as cur:
                cur.execute('''
                    INSERT INTO user_accounts (user_id, account_id, label)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id, account_id) DO NOTHING
                ''', (user_id, account_id, account_id))
        else:
            # Log warning but still import data; just don't create the account entry
            result['warning'] = err

        # Enforce history retention BEFORE refresh, so cost basis uses full history
        limits = get_user_limits(user_id)
        enforce_history_retention(user_id, account_id, limits.get("max_history_months", 3))

        refresh_user_account(user_id, account_id)

        # Refresh dashboard cache for the affected account and combined view
        try:
            data = pgdash.generate_dashboard_data(user_id, account_id)
            if data:
                _write_json_and_cache(account_id, data, user_id)
            combined = pgdash.generate_dashboard_data(user_id, "combined")
            if combined:
                _write_json_and_cache("combined", combined, user_id)
        except Exception as e:
            # Dashboard generation failure should not fail the import job
            print(f"Dashboard cache refresh failed: {e}")

        # Update upload with account info
        with get_cursor() as cur:
            cur.execute(
                "UPDATE xml_uploads SET account_id = %s WHERE id = %s",
                (account_id, upload_id)
            )

    return result


def _update_sync_status(user_id: str, status: str, message: str = None, rows_inserted: int = 0, account_id: str = None, upload_id: str = None):
    with get_cursor() as cur:
        cur.execute('''
            UPDATE user_flex_credentials
            SET last_sync_status = %s,
                last_sync_message = %s,
                last_sync_at = NOW(),
                updated_at = NOW()
            WHERE user_id = %s
        ''', (status, message, user_id))
        if upload_id:
            cur.execute('''
                INSERT INTO flex_sync_logs (user_id, status, message, rows_inserted, account_id, upload_id, completed_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ''', (user_id, status, message, rows_inserted, account_id, upload_id))
        else:
            cur.execute('''
                INSERT INTO flex_sync_logs (user_id, status, message, rows_inserted, account_id, completed_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
            ''', (user_id, status, message, rows_inserted, account_id))


def flex_sync_job(user_id: str):
    """Background job: pull IB FlexQuery XML and import it for a user."""
    # Fetch credentials
    cred = execute_one('''
        SELECT query_id, token_encrypted, is_active
        FROM user_flex_credentials
        WHERE user_id = %s
    ''', (user_id,))
    if not cred:
        return {"status": "failed", "error": "No FlexQuery credentials found"}
    if not cred.get("is_active"):
        return {"status": "failed", "error": "Credentials are inactive"}

    query_id = cred["query_id"]
    token = decrypt_token(cred["token_encrypted"])
    if not query_id or not token:
        return {"status": "failed", "error": "Incomplete credentials"}

    # Update running status in credentials table and create log entry
    with get_cursor() as cur:
        cur.execute('''
            UPDATE user_flex_credentials
            SET last_sync_status = 'running',
                last_sync_message = 'Pulling data from IB...',
                last_sync_at = NOW(),
                updated_at = NOW()
            WHERE user_id = %s
        ''', (user_id,))
        cur.execute('''
            INSERT INTO flex_sync_logs (user_id, status, message)
            VALUES (%s, %s, %s)
            RETURNING id
        ''', (user_id, 'running', 'Started IB FlexQuery pull'))
        log_row = cur.fetchone()
        log_id = log_row["id"] if log_row else None

    # Record RQ job id in log
    current_job = get_current_job()
    job_id = current_job.id if current_job else None
    if log_id and job_id:
        with get_cursor() as cur:
            cur.execute('''
                UPDATE flex_sync_logs SET job_id = %s WHERE id = %s
            ''', (job_id, log_id))

    # Step 1: SendRequest to get ReferenceCode
    send_request_url = f"https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t={token}&q={query_id}&v=3"
    try:
        resp = requests.get(send_request_url, headers={"User-Agent": "Python/3.11"}, timeout=60)
        resp.raise_for_status()
        send_text = resp.text
    except requests.RequestException as e:
        msg = f"SendRequest failed: {e}"
        _update_sync_status(user_id, 'failed', msg)
        if log_id:
            with get_cursor() as cur:
                cur.execute('''
                    UPDATE flex_sync_logs
                    SET status = 'failed', message = %s, completed_at = NOW()
                    WHERE id = %s
                ''', (msg, log_id))
        return {"status": "failed", "error": msg}

    import re
    ref_match = re.search(r'<ReferenceCode>([^<]+)</ReferenceCode>', send_text)
    if not ref_match:
        msg = f"SendRequest did not return ReferenceCode: {send_text[:500]}"
        _update_sync_status(user_id, 'failed', msg)
        if log_id:
            with get_cursor() as cur:
                cur.execute('''
                    UPDATE flex_sync_logs
                    SET status = 'failed', message = %s, completed_at = NOW()
                    WHERE id = %s
                ''', (msg, log_id))
        return {"status": "failed", "error": msg}

    reference_code = ref_match.group(1)

    # Step 2: GetStatement with ReferenceCode
    ib_url = f"https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?q={reference_code}&t={token}&v=3"

    MAX_RETRIES = 30
    RETRY_DELAY = 15
    response_text = None
    error_msg = None

    try:
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = requests.get(ib_url, headers={"User-Agent": "Python/3.11"}, timeout=120)
                resp.raise_for_status()
                text = resp.text
            except requests.RequestException as e:
                error_msg = f"HTTP error on attempt {attempt}: {e}"
                time.sleep(RETRY_DELAY)
                continue

            if "ErrorCode>1019" in text:
                error_msg = f"Attempt {attempt}: Report still generating (1019), retrying..."
                time.sleep(RETRY_DELAY)
                continue
            if "ErrorCode>1018" in text:
                error_msg = f"Attempt {attempt}: Rate limited (1018), retrying..."
                time.sleep(RETRY_DELAY)
                continue
            if "ErrorCode>" in text:
                # Generic IB error
                error_msg = f"IB API error: {text[:500]}"
                break
            if "FlexStatement" in text or "FlexQueryResponse" in text:
                response_text = text
                break
            else:
                error_msg = f"Unexpected response: {text[:500]}"
                break
    except Exception as e:
        error_msg = f"Exception during pull: {e}"

    if response_text is None:
        msg = error_msg or "Failed to pull data after all retries"
        with get_cursor() as cur:
            cur.execute('''
                UPDATE user_flex_credentials
                SET last_sync_status = 'failed',
                    last_sync_message = %s,
                    updated_at = NOW()
                WHERE user_id = %s
            ''', (msg, user_id))
            if log_id:
                cur.execute('''
                    UPDATE flex_sync_logs
                    SET status = 'failed', message = %s, completed_at = NOW()
                    WHERE id = %s
                ''', (msg, log_id))
        return {"status": "failed", "error": msg}

    # Save XML file
    APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    UPLOAD_DIR = os.path.join(APP_DIR, "uploads")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"flex_sync_{timestamp}_{user_id[:8]}.xml"
    save_path = os.path.join(UPLOAD_DIR, filename)
    with open(save_path, "w", encoding="utf-8") as f:
        f.write(response_text)

    # Create upload audit
    upload_id = str(uuid.uuid4())
    with get_cursor() as cur:
        cur.execute('''
            INSERT INTO xml_uploads (id, user_id, filename, file_md5, storage_path, status, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ''', (upload_id, user_id, filename, "", save_path, "pending"))

    # Run inline import (same logic as import_xml_job but without enqueuing another job)
    result = run_import(user_id, save_path, upload_id)
    account_id = result.get('account_id')

    if result['status'] == 'done' and account_id:
        ok, err = check_account_limit(user_id, account_id)
        if ok:
            with get_cursor() as cur:
                cur.execute('''
                    INSERT INTO user_accounts (user_id, account_id, label)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id, account_id) DO NOTHING
                ''', (user_id, account_id, account_id))
        else:
            result['warning'] = err
        # Enforce history retention BEFORE refresh, so cost basis uses full history
        limits = get_user_limits(user_id)
        enforce_history_retention(user_id, account_id, limits.get("max_history_months", 3))

        refresh_user_account(user_id, account_id)

        # Refresh dashboard cache for the affected account and combined view
        try:
            data = pgdash.generate_dashboard_data(user_id, account_id)
            if data:
                _write_json_and_cache(account_id, data, user_id)
            combined = pgdash.generate_dashboard_data(user_id, "combined")
            if combined:
                _write_json_and_cache("combined", combined, user_id)
        except Exception as e:
            print(f"Dashboard cache refresh failed: {e}")

        with get_cursor() as cur:
            cur.execute(
                "UPDATE xml_uploads SET account_id = %s WHERE id = %s",
                (account_id, upload_id)
            )
        msg = f"Sync completed. Account {account_id}. Rows inserted: {result.get('rows_inserted', 0)}"
        if result.get('warning'):
            msg += f" | Warning: {result['warning']}"
        _update_sync_status(user_id, 'done', msg, result.get('rows_inserted', 0), account_id, upload_id)
        if log_id:
            with get_cursor() as cur:
                cur.execute('''
                    UPDATE flex_sync_logs
                    SET status = 'done', message = %s, rows_inserted = %s, account_id = %s, upload_id = %s, completed_at = NOW()
                    WHERE id = %s
                ''', (msg, result.get('rows_inserted', 0), account_id, upload_id, log_id))
        return {"status": "done", "upload_id": upload_id, "account_id": account_id, "rows_inserted": result.get('rows_inserted', 0)}
    else:
        msg = result.get('error') or result.get('message') or 'Import failed'
        _update_sync_status(user_id, 'failed', msg, 0, account_id, upload_id)
        if log_id:
            with get_cursor() as cur:
                cur.execute('''
                    UPDATE flex_sync_logs
                    SET status = 'failed', message = %s, account_id = %s, upload_id = %s, completed_at = NOW()
                    WHERE id = %s
                ''', (msg, account_id, upload_id, log_id))
        return {"status": "failed", "error": msg, "upload_id": upload_id}


# ------------------------------------------------------------------
# Telegram Notifications
# ------------------------------------------------------------------
def send_option_alerts_job():
    """Scan all users' options and send Telegram alerts for near-expiry positions."""
    import json
    from datetime import datetime, timedelta

    users = execute("""
        SELECT p.user_id, p.telegram_bot_token, p.telegram_chat_id, p.option_alert_days, p.base_currency
        FROM user_profiles p
        JOIN users u ON u.id = p.user_id
        WHERE u.is_active = TRUE
          AND p.telegram_bot_token IS NOT NULL
          AND p.telegram_chat_id IS NOT NULL
    """)

    today = datetime.now().date()
    for user in users:
        user_id = user["user_id"]
        bot_token = user["telegram_bot_token"]
        chat_id = user["telegram_chat_id"]
        alert_days = user.get("option_alert_days") or [7, 3, 1]
        if isinstance(alert_days, str):
            alert_days = json.loads(alert_days)
        base_currency = user.get("base_currency") or "USD"

        # Find option positions nearing expiry
        rows = execute("""
            SELECT symbol, quantity, strike, expiry, option_type, position_value, unrealized_pnl, account_id
            FROM positions
            WHERE user_id = %s
              AND symbol LIKE '% %'
              AND expiry IS NOT NULL
              AND date = (SELECT MAX(date) FROM positions WHERE user_id = %s)
            ORDER BY expiry ASC
        """, (user_id, user_id))

        alerts = []
        for r in rows:
            if not r["expiry"]:
                continue
            expiry_date = r["expiry"]
            if isinstance(expiry_date, str):
                expiry_date = datetime.strptime(expiry_date, "%Y-%m-%d").date()
            elif hasattr(expiry_date, 'date'):
                expiry_date = expiry_date.date()

            days_to_expiry = (expiry_date - today).days
            if days_to_expiry < 0:
                continue
            if days_to_expiry not in alert_days:
                continue

            # Check if we already sent this alert today
            already_sent = execute_one("""
                SELECT 1 FROM user_notification_logs
                WHERE user_id = %s AND type = 'option_alert'
                  AND payload->>'symbol' = %s
                  AND payload->>'expiry' = %s
                  AND sent_at > NOW() - INTERVAL '23 hours'
            """, (user_id, r["symbol"], str(expiry_date)))
            if already_sent:
                continue

            pnL_str = f"{r['unrealized_pnl']:+.2f}" if r["unrealized_pnl"] else "-"
            alerts.append(
                f"• <b>{r['symbol']}</b> ({r['option_type'] or 'OPT'})\n"
                f"  到期: {expiry_date} (还有 {days_to_expiry} 天)\n"
                f"  行权价: {r['strike'] or '-'}  数量: {r['quantity']}  盈亏: {pnL_str}"
            )

            # Log that we sent it
            with get_cursor() as cur:
                cur.execute("""
                    INSERT INTO user_notification_logs (user_id, type, payload)
                    VALUES (%s, 'option_alert', %s)
                """, (user_id, json.dumps({"symbol": r["symbol"], "expiry": str(expiry_date), "days": days_to_expiry})))

        if alerts:
            msg = (
                f"⏰ <b>期权到期提醒</b>\n\n"
                f"{'\n\n'.join(alerts)}\n\n"
                f"请及时关注到期风险。"
            )
            try:
                send_telegram_message(bot_token, chat_id, msg)
            except Exception as e:
                print(f"[option_alert] Failed to send to {user_id}: {e}")


def send_report_job(user_id: str, report_type: str = "weekly"):
    """Generate and send a portfolio summary report via Telegram."""
    import json
    from datetime import datetime, timedelta
    import scripts.postgres_to_dashboard as pgdash

    user = execute_one("""
        SELECT p.telegram_bot_token, p.telegram_chat_id, p.base_currency
        FROM user_profiles p
        JOIN users u ON u.id = p.user_id
        WHERE p.user_id = %s AND u.is_active = TRUE
    """, (user_id,))
    if not user or not user.get("telegram_bot_token") or not user.get("telegram_chat_id"):
        return {"status": "skipped", "reason": "no telegram config"}

    bot_token = user["telegram_bot_token"]
    chat_id = user["telegram_chat_id"]
    base_currency = user.get("base_currency") or "USD"

    # Generate dashboard data
    try:
        data = pgdash.generate_dashboard_data(user_id, "combined")
    except Exception as e:
        return {"status": "failed", "error": f"dashboard generation failed: {e}"}

    if not data:
        return {"status": "failed", "error": "no data"}

    summary = data.get("summary", {})
    total_value = summary.get("totalValue") or summary.get("endingValue") or 0
    total_gain = summary.get("totalGain", 0)
    total_gain_pct = summary.get("totalGainPct", 0)

    # Recent 7-day P&L
    history = data.get("history", [])
    recent_change = 0
    if len(history) >= 2:
        recent_change = history[-1].get("endingValue", 0) - history[-2].get("endingValue", 0)

    # Top positions
    positions = data.get("openPositions", [])
    top_positions = sorted(positions, key=lambda x: abs(x.get("positionValue", 0)), reverse=True)[:5]
    pos_lines = []
    for p in top_positions:
        pos_lines.append(f"• {p.get('symbol', '-')}: {p.get('positionValue', 0):,.0f}")

    if report_type == "weekly":
        title = "📊 <b>周报</b>"
    else:
        title = "📊 <b>月报</b>"

    prefix = "¥" if base_currency == "CNH" else "$"
    gain_emoji = "🟢" if total_gain >= 0 else "🔴"
    recent_emoji = "🟢" if recent_change >= 0 else "🔴"

    msg = (
        f"{title}\n"
        f"截止 {datetime.now().strftime('%Y-%m-%d')}\n\n"
        f"<b>总资产:</b> {prefix}{total_value:,.2f}\n"
        f"<b>总盈亏:</b> {gain_emoji} {prefix}{total_gain:,.2f} ({total_gain_pct:+.2%})\n"
        f"<b>近7日:</b> {recent_emoji} {prefix}{recent_change:,.2f}\n\n"
        f"<b>Top 持仓</b>\n"
        f"{'\n'.join(pos_lines)}"
    )

    try:
        send_telegram_message(bot_token, chat_id, msg)
        with get_cursor() as cur:
            cur.execute("""
                INSERT INTO user_notification_logs (user_id, type, payload)
                VALUES (%s, %s, %s)
            """, (user_id, f"{report_type}_report", json.dumps({"total_value": float(total_value), "total_gain": float(total_gain)})))
        return {"status": "sent"}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
