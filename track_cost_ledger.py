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
    option_eae = {}
    
    for path in xml_files:
        if not os.path.exists(path):
            continue
        tree = ET.parse(path)
        root = tree.getroot()
        stmts = root.findall('.//FlexStatement')
        
        for stmt in stmts:
            account_id = stmt.get('accountId', '')
            
            for t in stmt.findall('.//Trade'):
                key = (account_id, t.get('tradeDate',''), t.get('dateTime',''), 
                       t.get('symbol',''), t.get('buySell',''), t.get('quantity',''), 
                       t.get('tradePrice',''))
                trades[key] = t.attrib
            
            for tr in stmt.findall('.//Transfer'):
                key = (account_id, tr.get('date',''), tr.get('dateTime',''), tr.get('symbol',''),
                       tr.get('type',''), tr.get('direction',''), tr.get('quantity',''))
                transfers[key] = tr.attrib
            
            for opt in stmt.findall('.//OptionEAE'):
                tx_type = opt.get('transactionType', '')
                if tx_type != 'Assignment':
                    continue
                key = (account_id, opt.get('date',''), opt.get('symbol',''), opt.get('transactionType',''))
                option_eae[key] = opt.attrib
    
    return trades, transfers, option_eae

print("正在解析 XML 文件...")
trades, transfers, option_eae = parse_all_xmls()

# ===================== 2. 构建所有账户的完整交易流水 =====================
all_accounts = ['U11181997', 'U12672188']

def build_ledger_for_account(account_id):
    records = []
    
    # 转入
    for k, v in transfers.items():
        if v.get('accountId') == account_id and v.get('direction') in ('IN', 'IN '):
            if v.get('assetCategory') in ('STK', 'ETF'):
                qty = abs(float(v.get('quantity', 0) or 0))
                pos_amt = abs(float(v.get('positionAmount', 0) or 0))
                records.append({
                    'date': v.get('date', ''),
                    'time': v.get('dateTime', ''),
                    'symbol': v.get('symbol', ''),
                    'action': '转入',
                    'qty': qty,
                    'price': pos_amt / qty if qty > 0 else 0,
                    'commission': 0.0,
                    'taxes': 0.0,
                    'trade_money': -pos_amt,
                    'note': f"Transfer {v.get('type','')}"
                })
    
    # 期权行权 lookup
    assignments_by_date_sym = defaultdict(list)
    for k, v in option_eae.items():
        if v.get('accountId') == account_id:
            date = v.get('date', '')
            underlying = v.get('underlyingSymbol', '')
            put_call = v.get('putCall', '')
            qty_contracts = float(v.get('quantity', 0) or 0)
            shares = qty_contracts * 100
            premium = float(v.get('mtmPnl', 0) or 0)
            assignments_by_date_sym[(date, underlying)].append({
                'put_call': put_call,
                'shares': shares,
                'premium': premium,
                'symbol': v.get('symbol', ''),
            })
    
    # 股票交易
    for k, v in trades.items():
        if v.get('accountId') == account_id and v.get('assetCategory') in ('STK', 'ETF'):
            date = v.get('tradeDate', '')
            symbol = v.get('symbol', '')
            qty = abs(float(v.get('quantity', 0) or 0))
            trade_money = float(v.get('tradeMoney', 0) or 0)
            commission = float(v.get('ibCommission', 0) or 0)
            taxes = float(v.get('taxes', 0) or 0)
            bs = v.get('buySell', '')
            time = v.get('dateTime', '')
            
            # 期权行权调整
            assignments = assignments_by_date_sym.get((date, symbol), [])
            premium_adjustment = 0.0
            note = ''
            if assignments and qty > 0:
                best_match = min(assignments, key=lambda a: abs(a['shares'] - qty))
                if abs(best_match['shares'] - qty) < 1:
                    put_call = best_match['put_call']
                    premium = best_match['premium']
                    if bs == 'BUY':
                        if put_call == 'P':
                            premium_adjustment = -premium
                            note = f"Put行权({best_match['symbol']})"
                        elif put_call == 'C':
                            premium_adjustment = -premium if premium < 0 else premium
                            note = f"Call行权({best_match['symbol']})"
                    elif bs == 'SELL':
                        if put_call == 'C':
                            premium_adjustment = premium
                            note = f"Call行权({best_match['symbol']})"
                        elif put_call == 'P':
                            premium_adjustment = -premium if premium < 0 else premium
                            note = f"Put行权({best_match['symbol']})"
                    assignments.remove(best_match)
            
            adjusted_trade_money = trade_money + premium_adjustment
            
            records.append({
                'date': date,
                'time': time,
                'symbol': symbol,
                'action': '买入' if bs == 'BUY' else '卖出',
                'qty': qty,
                'price': float(v.get('tradePrice', 0) or 0),
                'commission': commission,
                'taxes': taxes,
                'trade_money': adjusted_trade_money,
                'note': note
            })
    
    records.sort(key=lambda x: (x['date'], x['time'] or ''))
    return records

# ===================== 3. 计算动态持仓成本 =====================
def compute_cost_ledger(records):
    """按symbol分组，逐笔计算持仓量和平均成本"""
    ledger = []
    symbol_state = {}  # symbol -> {'qty': float, 'avg_cost': float}
    
    for r in records:
        sym = r['symbol']
        state = symbol_state.get(sym, {'qty': 0.0, 'avg_cost': 0.0})
        
        action = r['action']
        qty = r['qty']
        pre_qty = state['qty']
        pre_avg = state['avg_cost']
        
        if action in ('买入', '转入'):
            total_cost = abs(r['trade_money']) + abs(r['commission']) + abs(r['taxes'])
            cost_per_share = total_cost / qty if qty > 0 else 0
            if state['qty'] + qty > 0:
                new_avg = (state['qty'] * state['avg_cost'] + qty * cost_per_share) / (state['qty'] + qty)
            else:
                new_avg = cost_per_share
            state['qty'] += qty
            state['avg_cost'] = new_avg
            
        elif action == '卖出':
            state['qty'] -= qty
            if state['qty'] <= 0.0001:
                state['qty'] = 0.0
                state['avg_cost'] = 0.0
            new_avg = state['avg_cost']
        
        ledger.append({
            '日期': r['date'],
            '时间': r['time'] or '',
            'Symbol': sym,
            '操作': action,
            '数量': round(qty, 4),
            '成交价': round(r['price'], 4),
            '佣金税费': round(abs(r['commission']) + abs(r['taxes']), 2),
            '操作前持仓': round(pre_qty, 4),
            '操作前成本': round(pre_avg, 4),
            '操作后持仓': round(state['qty'], 4),
            '操作后成本': round(state['avg_cost'], 4),
            '备注': r['note'],
        })
        
        symbol_state[sym] = state
    
    return ledger

# ===================== 4. 输出 =====================
all_ledgers = {}
for acc in all_accounts:
    recs = build_ledger_for_account(acc)
    ledger = compute_cost_ledger(recs)
    all_ledgers[acc] = ledger
    print(f"\n{'='*80}")
    print(f"账户 {acc} 的成本变动流水（共 {len(ledger)} 笔）")
    print(f"{'='*80}")
    
    # 只打印交易次数>=3的symbol作为示例
    symbol_counts = defaultdict(int)
    for row in ledger:
        symbol_counts[row['Symbol']] += 1
    
    for sym, cnt in sorted(symbol_counts.items(), key=lambda x: -x[1]):
        if cnt < 2:
            continue
        rows = [r for r in ledger if r['Symbol'] == sym]
        print(f"\n--- {sym} ({cnt}笔交易) ---")
        print(f"{'日期':<12} {'操作':<6} {'数量':>10} {'成交价':>10} {'前持仓':>10} {'前成本':>10} {'后持仓':>10} {'后成本':>10} {'备注'}")
        for r in rows:
            print(f"{r['日期']:<12} {r['操作']:<6} {r['数量']:>10.2f} {r['成交价']:>10.2f} {r['操作前持仓']:>10.2f} {r['操作前成本']:>10.4f} {r['操作后持仓']:>10.2f} {r['操作后成本']:>10.4f} {r['备注']}")

# 保存全部到CSV
csv_path = '/Users/mc/kimicode/ib_dashboard/cost_ledger_all_accounts.csv'
with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
    fieldnames = ['账户', '日期', '时间', 'Symbol', '操作', '数量', '成交价', '佣金税费', '操作前持仓', '操作前成本', '操作后持仓', '操作后成本', '备注']
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    for acc, ledger in all_ledgers.items():
        for row in ledger:
            writer.writerow({**{'账户': acc}, **row})

print(f"\n\n✅ 全部成本变动流水已保存至: {csv_path}")

