import xml.etree.ElementTree as ET
import os
import csv
from collections import defaultdict
from datetime import datetime

# ===================== 1. 解析所有 XML =====================
def parse_all_xmls():
    xml_files = [
        '/Users/mc/kimicode/20240412-20250411.xml',
        '/Users/mc/kimicode/20240801-20250801.xml',
        '/Users/mc/kimicode/20250408-20260408.xml',
        '/Users/mc/kimicode/U12672188_U12672188_20250408_20260407_AF_1460982_6068ad86dc98bcc76901ffc0202790c5(1).xml',
        '/Users/mc/kimicode/moneychen(5).xml',
        '/Users/mc/kimicode/moneychen(4).xml',
        '/Users/mc/kimicode/moneychen(3).xml',
        '/Users/mc/kimicode/moneychen(2).xml',
        '/Users/mc/kimicode/ib_dashboard/data/ib_history.xml',
    ]
    
    trades = {}
    transfers = {}
    cash_txns = {}
    navs = {}
    positions_map = {}  # key=(account_id, date, symbol) -> pos dict
    
    for path in xml_files:
        if not os.path.exists(path):
            continue
        tree = ET.parse(path)
        root = tree.getroot()
        stmts = root.findall('.//FlexStatement')
        
        for stmt in stmts:
            account_id = stmt.get('accountId', '')
            date_raw = stmt.get('toDate', '')
            if not date_raw:
                continue
            stmt_date = f"{date_raw[:4]}-{date_raw[4:6]}-{date_raw[6:]}"
            
            for t in stmt.findall('.//Trade'):
                key = (account_id, t.get('tradeDate',''), t.get('dateTime',''), 
                       t.get('symbol',''), t.get('buySell',''), t.get('quantity',''), 
                       t.get('tradePrice',''))
                trades[key] = {**t.attrib, 'stmtDate': stmt_date}
            
            for tr in stmt.findall('.//Transfer'):
                key = (account_id, tr.get('date',''), tr.get('dateTime',''), tr.get('symbol',''),
                       tr.get('type',''), tr.get('direction',''), tr.get('quantity',''))
                transfers[key] = {**tr.attrib, 'stmtDate': stmt_date}
            
            for ct in stmt.findall('.//CashTransaction'):
                key = (account_id, ct.get('dateTime',''), ct.get('type',''), 
                       ct.get('amount',''), ct.get('description',''))
                cash_txns[key] = {**ct.attrib, 'stmtDate': stmt_date}
            
            cin = stmt.find('ChangeInNAV')
            if cin is not None:
                navs[(account_id, stmt_date)] = {
                    'account_id': account_id,
                    'date': stmt_date,
                    'ending_value': float(cin.get('endingValue', 0) or 0),
                }
            
            for pos in stmt.findall('.//OpenPosition'):
                sym = pos.get('symbol', '')
                if not sym:
                    continue
                description = pos.get('description', '')
                asset_type = 'STOCK'
                if 'ETF' in description.upper() or sym in ['QQQ', 'QQQM', 'QQQI', 'SPY', 'SPYM', 'VOO', 'SGOV', 'SOXX', 'EWY', 'JEPI', 'BOXX']:
                    asset_type = 'ETF'
                elif any(x in sym for x in ['  ', 'P', 'C']) and len(sym) > 6:
                    asset_type = 'OPTION'
                
                pos_key = (account_id, stmt_date, sym)
                if pos_key not in positions_map:
                    positions_map[pos_key] = {
                        'account_id': account_id,
                        'date': stmt_date,
                        'symbol': sym,
                        'description': description,
                        'asset_type': asset_type,
                        'position_value': float(pos.get('positionValue', 0) or 0),
                        'mark_price': float(pos.get('markPrice', 0) or 0),
                        'position': float(pos.get('position', 0) or 0) if pos.get('position') else None,
                    }
    
    return trades, transfers, cash_txns, navs, positions_map

print("正在解析 XML 文件...")
trades, transfers, cash_txns, navs, positions_map = parse_all_xmls()
positions_list = list(positions_map.values())
print(f"解析完成: {len(trades)} 笔交易, {len(cash_txns)} 笔现金流, {len(navs)} 天净值, {len(positions_list)} 个持仓快照")

# ===================== 2. 计算真实收益率 =====================
print("\n" + "="*70)
print("一、真实收益率计算")
print("="*70)

# 外部现金流
cf_records = []
for k, v in cash_txns.items():
    if v.get('type') == 'Deposits/Withdrawals':
        desc = v.get('description', '')
        if 'CASH RECEIPTS' in desc or 'DISBURSEMENT' in desc or 'DEPOSIT' in desc or 'WITHDRAWAL' in desc:
            amount = float(v.get('amount', 0) or 0)
            fx = float(v.get('fxRateToBase', 1) or 1)
            cny = amount * fx
            date_str = v.get('dateTime', '')[:8]
            if len(date_str) == 8:
                dt = datetime(int(date_str[:4]), int(date_str[4:6]), int(date_str[6:]))
            else:
                dt = datetime(1900,1,1)
            cf_records.append({
                'account_id': v.get('accountId', ''),
                'date': dt,
                'currency': v.get('currency', ''),
                'amount': amount,
                'cny_amount': cny,
                'description': desc,
            })

df_cf = sorted(cf_records, key=lambda x: x['date'])

cf_by_account = defaultdict(float)
for r in df_cf:
    cf_by_account[r['account_id']] += r['cny_amount']

print("\n外部现金流汇总（折算为 CNH，基础货币）:")
for acc, amt in sorted(cf_by_account.items()):
    print(f"  {acc}: {amt:>15,.2f} CNH")
total_cf = sum(cf_by_account.values())
print(f"  {'合计':<10}: {total_cf:>15,.2f} CNH")

# 最新市值
latest_nav_date = max(n['date'] for n in navs.values())
latest_navs = {k: v for k, v in navs.items() if v['date'] == latest_nav_date}
print(f"\n最新账户市值 ({latest_nav_date}):")
total_market = 0
for (acc, d), v in sorted(latest_navs.items()):
    print(f"  {acc}: {v['ending_value']:>15,.2f} CNH")
    total_market += v['ending_value']
print(f"  {'合计':<10}: {total_market:>15,.2f} CNH")

# 简单收益率
simple_return = (total_market - total_cf) / total_cf if total_cf != 0 else 0
print(f"\n>>> 简单真实收益率 = {simple_return:.2%}")

# Modified Dietz 收益率
if df_cf:
    start_date = min(r['date'] for r in df_cf)
    end_date = datetime.strptime(latest_nav_date, '%Y-%m-%d')
    total_days = (end_date - start_date).days
    if total_days > 0:
        weighted_cf = sum(r['cny_amount'] * ((end_date - r['date']).days / total_days) for r in df_cf)
        md_denom = weighted_cf
        md_return = (total_market - total_cf) / md_denom if md_denom != 0 else 0
        print(f">>> Modified Dietz 收益率 = {md_return:.2%}")
        print(f"    (期间: {start_date.date()} ~ {end_date.date()}, {total_days} 天, 加权平均投入={md_denom:,.2f})")

# ===================== 3. 计算摊薄成本 =====================
print("\n" + "="*70)
print("二、持仓摊薄成本计算")
print("="*70)

target_account = 'U12672188'

# 收集所有成本记录
cost_records = []

# 转入记录
for k, v in transfers.items():
    if v.get('accountId') == target_account and v.get('direction') in ('IN', 'IN '):
        if v.get('assetCategory') in ('STK', 'ETF'):
            qty = abs(float(v.get('quantity', 0) or 0))
            pos_amt = abs(float(v.get('positionAmount', 0) or 0))
            cost_records.append({
                'date': v.get('date', ''),
                'symbol': v.get('symbol', ''),
                'buy_sell': 'BUY',
                'qty': qty,
                'trade_money': -pos_amt,
                'commission': 0.0,
                'taxes': 0.0,
            })

# 交易记录
for k, v in trades.items():
    if v.get('accountId') == target_account and v.get('assetCategory') in ('STK', 'ETF'):
        qty = abs(float(v.get('quantity', 0) or 0))
        trade_money = float(v.get('tradeMoney', 0) or 0)
        commission = float(v.get('ibCommission', 0) or 0)
        taxes = float(v.get('taxes', 0) or 0)
        cost_records.append({
            'date': v.get('tradeDate', ''),
            'symbol': v.get('symbol', ''),
            'buy_sell': v.get('buySell', ''),
            'qty': qty,
            'trade_money': trade_money,
            'commission': commission,
            'taxes': taxes,
        })

# 按 symbol 分组计算
symbol_records = defaultdict(list)
for r in cost_records:
    symbol_records[r['symbol']].append(r)

cost_basis_by_symbol = {}
for symbol, records in symbol_records.items():
    records.sort(key=lambda x: x['date'])
    total_qty = 0.0
    avg_cost = 0.0
    for r in records:
        qty = r['qty']
        if r['buy_sell'] == 'BUY':
            total_cost = abs(r['trade_money']) + abs(r['commission']) + abs(r['taxes'])
            cost_per_share = total_cost / qty if qty > 0 else 0
            if total_qty + qty > 0:
                avg_cost = (total_qty * avg_cost + qty * cost_per_share) / (total_qty + qty)
            else:
                avg_cost = 0
            total_qty += qty
        elif r['buy_sell'] == 'SELL':
            total_qty -= qty
            if total_qty <= 0.0001:
                total_qty = 0
                avg_cost = 0
    
    cost_basis_by_symbol[symbol] = {
        'qty': total_qty,
        'avg_cost': avg_cost,
        'total_cost': total_qty * avg_cost
    }

# 匹配最新持仓（已去重）
latest_pos = [p for p in positions_list if p['account_id'] == target_account and p['date'] == latest_nav_date and p['asset_type'] in ('STOCK', 'ETF')]
latest_pos.sort(key=lambda x: x['position_value'], reverse=True)

csv_rows = []
for p in latest_pos:
    sym = p['symbol']
    cb = cost_basis_by_symbol.get(sym)
    if not cb or cb['qty'] <= 0.0001:
        continue
    
    qty = cb['qty']
    market_value = qty * p['mark_price']
    unrealized = market_value - cb['total_cost']
    return_pct = (p['mark_price'] - cb['avg_cost']) / cb['avg_cost'] if cb['avg_cost'] > 0 else 0
    
    csv_rows.append({
        'Symbol': sym,
        '名称': p['description'][:30],
        '持仓量': round(qty, 4),
        '现价(USD)': round(p['mark_price'], 2),
        '市值(USD)': round(market_value, 2),
        '摊薄成本(USD)': round(cb['avg_cost'], 4),
        '总成本(USD)': round(cb['total_cost'], 2),
        '未实现盈亏(USD)': round(unrealized, 2),
        '盈亏比例': return_pct,
    })

print(f"\n当前持仓 ({target_account}, 日期: {latest_nav_date}):\n")
print(f"{'Symbol':<10} {'持仓量':>10} {'现价':>10} {'市值(USD)':>14} {'摊薄成本':>10} {'总成本(USD)':>14} {'未实现盈亏':>14} {'盈亏':>8}")
print("-" * 100)
total_mv = 0
total_cost = 0
for row in csv_rows:
    print(f"{row['Symbol']:<10} {row['持仓量']:>10.2f} {row['现价(USD)']:>10.2f} {row['市值(USD)']:>14,.2f} {row['摊薄成本(USD)']:>10.4f} {row['总成本(USD)']:>14,.2f} {row['未实现盈亏(USD)']:>14,.2f} {row['盈亏比例']:>8.2%}")
    total_mv += row['市值(USD)']
    total_cost += row['总成本(USD)']
print("-" * 100)
print(f"{'合计':<10} {'':>10} {'':>10} {total_mv:>14,.2f} {'':>10} {total_cost:>14,.2f} {total_mv - total_cost:>14,.2f}")

# 保存 CSV
csv_path = '/Users/mc/kimicode/ib_dashboard/cost_basis_report.csv'
with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
    fieldnames = ['Symbol', '名称', '持仓量', '现价(USD)', '市值(USD)', '摊薄成本(USD)', '总成本(USD)', '未实现盈亏(USD)', '盈亏比例']
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    for row in csv_rows:
        row_out = row.copy()
        row_out['盈亏比例'] = f"{row['盈亏比例']:.2%}"
        writer.writerow(row_out)
print(f"\n✅ 摊薄成本报告已保存至: {csv_path}")

