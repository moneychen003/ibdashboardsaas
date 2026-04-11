"""User quota enforcement helpers."""
from db.postgres_client import get_cursor, execute_one


def check_account_limit(user_id: str, account_id: str = None) -> tuple[bool, str]:
    """Returns (ok, error_message).
    If account_id is provided and already exists, always returns True.
    Otherwise checks if user has reached max_accounts.
    """
    profile = execute_one('''
        SELECT max_accounts FROM user_profiles WHERE user_id = %s
    ''', (user_id,))
    max_accounts = profile.get("max_accounts") or 1 if profile else 1
    if account_id:
        existing = execute_one('''
            SELECT 1 FROM user_accounts WHERE user_id = %s AND account_id = %s
        ''', (user_id, account_id))
        if existing:
            return True, ""
    current = execute_one('''
        SELECT COUNT(*) AS c FROM user_accounts WHERE user_id = %s
    ''', (user_id,))
    current_count = current["c"] if current else 0
    if current_count >= max_accounts:
        return False, f"Account limit reached ({current_count}/{max_accounts}). Upgrade your plan to add more accounts."
    return True, ""


def enforce_history_retention(user_id: str, account_id: str, max_months: int):
    """Delete data older than max_months for the given user/account."""
    if not max_months or max_months <= 0:
        return
    with get_cursor() as cur:
        cur.execute('''
            DELETE FROM daily_nav
            WHERE user_id = %s AND account_id = %s
              AND date < (CURRENT_DATE - INTERVAL '%s months')
        ''', (user_id, account_id, max_months))
    with get_cursor() as cur:
        cur.execute('''
            DELETE FROM positions
            WHERE user_id = %s AND account_id = %s
              AND date < (CURRENT_DATE - INTERVAL '%s months')
        ''', (user_id, account_id, max_months))
    with get_cursor() as cur:
        cur.execute('''
            DELETE FROM option_eae
            WHERE user_id = %s AND account_id = %s
              AND date < (CURRENT_DATE - INTERVAL '%s months')
        ''', (user_id, account_id, max_months))
    with get_cursor() as cur:
        cur.execute('''
            DELETE FROM cash_report
            WHERE user_id = %s AND account_id = %s
              AND date < (CURRENT_DATE - INTERVAL '%s months')
        ''', (user_id, account_id, max_months))
    with get_cursor() as cur:
        cur.execute('''
            DELETE FROM archive_trade
            WHERE user_id = %s AND stmt_account_id = %s
              AND trade_date < ((CURRENT_DATE - INTERVAL '%s months')::text)
        ''', (user_id, account_id, max_months))
    with get_cursor() as cur:
        cur.execute('''
            DELETE FROM archive_cash_transaction
            WHERE user_id = %s AND stmt_account_id = %s
              AND date_time < ((CURRENT_DATE - INTERVAL '%s months')::text)
        ''', (user_id, account_id, max_months))


def get_user_limits(user_id: str) -> dict:
    profile = execute_one('''
        SELECT tier, max_accounts, max_history_months
        FROM user_profiles WHERE user_id = %s
    ''', (user_id,))
    if not profile:
        return {"tier": "free", "max_accounts": 1, "max_history_months": 99999}
    return {
        "tier": profile.get("tier") or "free",
        "max_accounts": profile.get("max_accounts") or 1,
        "max_history_months": profile.get("max_history_months") or 99999,
    }
