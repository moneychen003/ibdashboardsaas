#!/usr/bin/env python3
"""
Daily auto-sync script for IB Dashboard SaaS.
Enqueues flex_sync_job for all users with auto_sync enabled.
Usage:
    python3 scripts/auto_sync.py
Or via cron:
    0 3 * * * cd /path/to/ib_dashboard && python3 scripts/auto_sync.py >> /tmp/ib_auto_sync.log 2>&1
"""
import os
import sys
import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import redis
from rq import Queue
from db.postgres_client import execute
from workers.jobs import flex_sync_job


def main():
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    q = Queue(connection=redis.from_url(redis_url))

    rows = execute('''
        SELECT user_id, query_id
        FROM user_flex_credentials
        WHERE is_active = TRUE AND auto_sync = TRUE
    ''')

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] Auto-sync started. Users to sync: {len(rows)}")

    for r in rows:
        user_id = str(r['user_id'])
        query_id = r['query_id']
        job = q.enqueue(flex_sync_job, user_id, job_timeout=600)
        print(f"[{now}] Enqueued sync for user {user_id} (query {query_id}), job_id={job.id}")

    print(f"[{now}] Auto-sync finished.")


if __name__ == "__main__":
    main()
