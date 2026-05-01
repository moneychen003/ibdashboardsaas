#!/usr/bin/env python3
"""Clean up users who registered ≥ N days ago and never uploaded / synced anything.

A user is considered "abandoned" when ALL of the following hold:
  - is_admin = FALSE
  - created_at < NOW() - INTERVAL '<grace> days'
  - 0 rows in xml_uploads
  - 0 rows in daily_nav
  - 0 rows in user_accounts
  - 0 rows in user_flex_credentials with non-empty query_id

Each run dumps the rows that will be deleted (users + user_profiles + user_accounts +
user_flex_credentials) to /opt/ib_dashboard/cleanup_users_<date>.sql.gz before DELETE,
in case we need to revive someone. CASCADE on users.id removes related rows.

Usage: cleanup_zero_upload_users.py [grace_days=7]
"""
import gzip
import os
import subprocess
import sys
from datetime import datetime

import psycopg2
import psycopg2.extras

DB = dict(host="localhost", dbname="ib_dashboard", user="ibuser", password="ibpass123")
BACKUP_DIR = "/opt/ib_dashboard"


def find_targets(cur, grace_days):
    cur.execute(
        """
        SELECT u.id, u.email, u.username, u.created_at
        FROM users u
        WHERE u.is_admin = FALSE
          AND u.created_at < NOW() - (%s || ' days')::interval
          AND NOT EXISTS (SELECT 1 FROM xml_uploads WHERE user_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM daily_nav WHERE user_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM user_accounts WHERE user_id = u.id)
          AND NOT EXISTS (
            SELECT 1 FROM user_flex_credentials
            WHERE user_id = u.id AND query_id IS NOT NULL AND query_id <> ''
          )
        ORDER BY u.created_at
        """,
        (str(grace_days),),
    )
    return cur.fetchall()


def backup_targets(target_ids):
    if not target_ids:
        return None
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(BACKUP_DIR, f"cleanup_users_{stamp}.sql.gz")
    id_list = ",".join("'" + tid + "'" for tid in target_ids)
    sql = f"""
\\copy (SELECT * FROM users WHERE id IN ({id_list})) TO STDOUT WITH CSV HEADER;
\\copy (SELECT * FROM user_profiles WHERE user_id IN ({id_list})) TO STDOUT WITH CSV HEADER;
\\copy (SELECT * FROM user_accounts WHERE user_id IN ({id_list})) TO STDOUT WITH CSV HEADER;
\\copy (SELECT * FROM user_flex_credentials WHERE user_id IN ({id_list})) TO STDOUT WITH CSV HEADER;
"""
    env = os.environ.copy()
    env["PGPASSWORD"] = DB["password"]
    proc = subprocess.run(
        ["psql", "-h", DB["host"], "-U", DB["user"], "-d", DB["dbname"], "-v", "ON_ERROR_STOP=1"],
        input=sql.encode("utf-8"),
        capture_output=True,
        env=env,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"backup failed: {proc.stderr.decode()}")
    with gzip.open(path, "wb") as f:
        f.write(proc.stdout)
    return path


def main(grace_days):
    started = datetime.now()
    print(f"[{started.isoformat(timespec='seconds')}] cleanup_zero_upload_users grace={grace_days}d")
    conn = psycopg2.connect(**DB)
    conn.autocommit = False
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            targets = find_targets(cur, grace_days)
            if not targets:
                print("[cleanup] no abandoned users found")
                return 0
            print(f"[cleanup] {len(targets)} abandoned users to delete:")
            for r in targets:
                print(f"  - {r['email']} / {r['username'] or '-'} (reg {r['created_at'].date()})")
            ids = [r["id"] for r in targets]
            backup_path = backup_targets(ids)
            print(f"[cleanup] backup → {backup_path}")
            cur.execute("DELETE FROM users WHERE id = ANY(%s) AND is_admin = FALSE", (ids,))
            deleted = cur.rowcount
            conn.commit()
            print(f"[cleanup] DELETED {deleted} users (CASCADE)")
            return deleted
    except Exception as e:
        conn.rollback()
        print(f"[cleanup] ERROR: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    grace = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    sys.exit(0 if main(grace) >= 0 else 1)
