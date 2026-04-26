#!/usr/bin/env python3
"""
SaaS 定时通知触发器。
- 每次调用：跑 send_option_alerts_job()（期权到期提醒；job 内部会按 user.option_alert_days 过滤，且自带"23h 内已发过就跳过"去重）
- 周一：为 report_schedule='weekly' 的用户跑 send_report_job(uid, 'weekly')
- 每月 1 号：为 report_schedule='monthly' 的用户跑 send_report_job(uid, 'monthly')
由 cron 每日 09:07 触发。
"""
import os
import sys
import datetime

sys.path.insert(0, '/opt/ib_dashboard')
os.chdir('/opt/ib_dashboard')

from db.postgres_client import execute
from workers.jobs import send_option_alerts_job, send_report_job


def main():
    today = datetime.date.today()
    print(f"=== {datetime.datetime.now().isoformat(timespec='seconds')} notifications run ({today}) ===")

    try:
        send_option_alerts_job()
        print("option_alerts: ok")
    except Exception as e:
        print(f"option_alerts: FAILED — {e}")

    if today.weekday() == 0:
        rows = execute(
            "SELECT p.user_id FROM user_profiles p JOIN users u ON u.id = p.user_id "
            "WHERE u.is_active = TRUE AND p.report_schedule = %s "
            "AND p.telegram_bot_token IS NOT NULL AND p.telegram_chat_id IS NOT NULL",
            ('weekly',)
        )
        for r in rows:
            try:
                res = send_report_job(str(r['user_id']), 'weekly')
                print(f"weekly report {r['user_id']}: {res}")
            except Exception as e:
                print(f"weekly report {r['user_id']}: FAILED — {e}")

    if today.day == 1:
        rows = execute(
            "SELECT p.user_id FROM user_profiles p JOIN users u ON u.id = p.user_id "
            "WHERE u.is_active = TRUE AND p.report_schedule = %s "
            "AND p.telegram_bot_token IS NOT NULL AND p.telegram_chat_id IS NOT NULL",
            ('monthly',)
        )
        for r in rows:
            try:
                res = send_report_job(str(r['user_id']), 'monthly')
                print(f"monthly report {r['user_id']}: {res}")
            except Exception as e:
                print(f"monthly report {r['user_id']}: FAILED — {e}")


if __name__ == '__main__':
    main()
