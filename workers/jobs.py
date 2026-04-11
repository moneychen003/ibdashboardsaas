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
from rq import get_current_job


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
