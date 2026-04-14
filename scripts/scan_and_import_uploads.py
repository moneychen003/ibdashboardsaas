#!/usr/bin/env python3
import os
import sys
import argparse
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from db.postgres_client import execute
from scripts.xml_to_postgres import run_import
import scripts.postgres_to_dashboard as pgdash
from scripts.generate_dashboards import _write_json_and_cache

UPLOADS_DIR = Path('uploads')


def guess_user_id_from_filename(filename):
    if '_personal.xml' in filename:
        rows = execute("""
            SELECT uc.user_id::text as user_id
            FROM user_flex_credentials uc
            JOIN user_accounts ua ON uc.user_id = ua.user_id
            WHERE ua.label = 'personal'
            LIMIT 1
        """)
        if rows:
            return str(rows[0]['user_id'])
    return None


def get_already_imported_filenames():
    rows = execute('SELECT filename FROM xml_uploads')
    return {r['filename'] for r in rows}


def scan_and_import(user_id=None, dry_run=False):
    imported = []
    skipped = []
    errors = []

    already_imported = get_already_imported_filenames()
    xml_files = sorted(UPLOADS_DIR.glob('*.xml'))
    if not xml_files:
        print('⚠️ uploads 目录下没有 .xml 文件')
        return

    print(f'🔍 扫描到 {len(xml_files)} 个 XML 文件，已导入 {len(already_imported)} 个')

    for xml_path in xml_files:
        filename = xml_path.name
        if filename in already_imported:
            skipped.append(filename)
            continue

        target_user_id = user_id or guess_user_id_from_filename(filename)
        if not target_user_id:
            rows = execute('SELECT user_id::text as user_id FROM user_flex_credentials LIMIT 1')
            if rows:
                target_user_id = str(rows[0]['user_id'])
            else:
                errors.append(f'{filename}: 无法确定 user_id')
                continue

        if dry_run:
            print(f'[DRY-RUN] 将导入 {filename} -> user_id={target_user_id}')
            continue

        print(f'📥 导入 {filename} (user_id={target_user_id})...')
        try:
            result = run_import(target_user_id, str(xml_path))
            if result['status'] == 'done':
                imported.append(filename)
                account_id = result.get('account_id')
                if account_id:
                    try:
                        data = pgdash.generate_dashboard_data(target_user_id, account_id)
                        if data:
                            _write_json_and_cache(account_id, data, target_user_id)
                            print(f'   ✅ {account_id} dashboard 已刷新')
                    except Exception as e:
                        print(f'   ⚠️ {account_id} dashboard 刷新失败: {e}')

                    try:
                        combined = pgdash.generate_dashboard_data(target_user_id, 'combined')
                        if combined:
                            _write_json_and_cache('combined', combined, target_user_id)
                            print(f'   ✅ combined dashboard 已刷新')
                    except Exception as e:
                        print(f'   ⚠️ combined dashboard 刷新失败: {e}')
            else:
                errors.append(f"{filename}: {result.get('error_message', 'unknown error')}")
        except Exception as e:
            errors.append(f'{filename}: {e}')
            import traceback
            traceback.print_exc()

    print()
    print('=' * 50)
    print(f'✅ 成功导入: {len(imported)} 个')
    print(f'⏭️  已存在跳过: {len(skipped)} 个')
    print(f'❌ 失败: {len(errors)} 个')
    if errors:
        print()
        print('失败详情:')
        for e in errors:
            print(f'   - {e}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='扫描并自动导入 uploads 目录中的 XML')
    parser.add_argument('--user-id', help='强制指定 user_id')
    parser.add_argument('--dry-run', action='store_true', help='只扫描不导入')
    args = parser.parse_args()
    scan_and_import(user_id=args.user_id, dry_run=args.dry_run)
