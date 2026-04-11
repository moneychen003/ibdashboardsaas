#!/usr/bin/env python3
"""Generate dashboard JSON files directly from PostgreSQL and write to Redis."""
import os
import sys
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import redis
from db.postgres_client import execute
import scripts.postgres_to_dashboard as pgdash

DEFAULT_USER_ID = os.environ.get("DEFAULT_USER_ID", "5800d4ba-84f1-453b-9238-101462eaf139")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
redis_conn = redis.from_url(REDIS_URL)


def _write_json_and_cache(account_id, data, user_id=DEFAULT_USER_ID):
    output = f"data/dashboard_{account_id}_{user_id}.json"
    with open(output, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    cache_key = f"dashboard:{user_id}:{account_id}"
    try:
        redis_conn.setex(cache_key, 300, json.dumps(data, ensure_ascii=False, default=str))
    except Exception as e:
        print(f"   ⚠️ Redis 缓存写入失败: {e}")


def main():
    rows = execute("SELECT DISTINCT account_id FROM daily_nav ORDER BY account_id")
    account_ids = [row['account_id'] for row in rows]

    for acc in account_ids:
        data = pgdash.generate_dashboard_data(DEFAULT_USER_ID, acc)
        if data:
            _write_json_and_cache(acc, data)
            print(f"✅ {acc}: {data['historyRange']['fromDate']} ~ {data['historyRange']['toDate']} ({data['historyRange']['totalDays']}天)")
            print(f"   最大回撤: {data['metrics']['maxDrawdown']:.2f}% | 年化收益: {data['metrics']['annualizedReturn']:.2f}% | 年化波动: {data['metrics']['annualizedVolatility']:.2f}%")

    combined = pgdash.generate_dashboard_data(DEFAULT_USER_ID, "combined")
    if combined:
        _write_json_and_cache("combined", combined)
        print(f"✅ COMBINED: {combined['historyRange']['fromDate']} ~ {combined['historyRange']['toDate']} ({combined['historyRange']['totalDays']}天)")
        print(f"   合并总资产: ${combined['summary']['totalNav']:,.0f}")
        print(f"   最大回撤: {combined['metrics']['maxDrawdown']:.2f}% | 年化收益: {combined['metrics']['annualizedReturn']:.2f}% | 年化波动: {combined['metrics']['annualizedVolatility']:.2f}%")
        for k, v in combined['rangeSummaries'].items():
            if v.get('days', 0) > 0:
                print(f"   {k}: {v['days']}天 收益 ${v['gain']:,.0f} ({v['gainPct']:.2f}%)")

    print("\n💾 所有 JSON 已保存到 data/ 目录")


if __name__ == "__main__":
    main()
