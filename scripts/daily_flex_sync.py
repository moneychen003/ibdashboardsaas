#!/usr/bin/env python3
"""Daily auto-sync for all users with auto_sync enabled."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import redis
from rq import Queue
from db.postgres_client import execute
from workers.jobs import flex_sync_job

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
queue = Queue(connection=redis.from_url(REDIS_URL))

def main():
    # Find all users with auto_sync enabled and active credentials
    rows = execute('''
        SELECT user_id FROM user_flex_credentials
        WHERE auto_sync = TRUE AND is_active = TRUE
    ''')
    
    if not rows:
        print("No users with auto_sync enabled.")
        return
    
    for row in rows:
        user_id = row["user_id"]
        job = queue.enqueue(flex_sync_job, user_id, job_timeout=600)
        print(f"Enqueued flex_sync_job for {user_id}, job_id={job.id}")

if __name__ == "__main__":
    main()
