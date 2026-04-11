import xml.etree.ElementTree as ET
import os
from collections import defaultdict
from datetime import datetime

def parse_xml_files(xml_paths):
    """解析多个 XML 文件，返回去重后的交易、转账、现金流、持仓、净值数据"""
    
    trades = {}  # key: (accountId, tradeDate, dateTime, symbol, buySell, quantity, tradePrice)
    transfers = {}  # key: (accountId, date, dateTime, symbol, type, direction, quantity)
    cash_txns = {}  # key: (accountId, dateTime, type, amount, description)
    navs = {}  # key: (accountId, date)
    positions = {}  # key: (accountId, date, symbol)
    
    for path in xml_paths:
        if not os.path.exists(path):
            print(f"跳过不存在的文件: {path}")
            continue
        print(f"解析 {os.path.basename(path)}...")
        tree = ET.parse(path)
        root = tree.getroot()
        stmts = root.findall('.//FlexStatement')
        
        for stmt in stmts:
            account_id = stmt.get('accountId', '')
            date_raw = stmt.get('toDate', '')
            if not date_raw:
                continue
            stmt_date = f"{date_raw[:4]}-{date_raw[4:6]}-{date_raw[6:]}"
            
            # Trades
            for t in stmt.findall('.//Trade'):
                key = (account_id, t.get('tradeDate',''), t.get('dateTime',''), 
                       t.get('symbol',''), t.get('buySell',''), t.get('quantity',''), 
                       t.get('tradePrice',''))
                trades[key] = {**t.attrib, 'stmtDate': stmt_date}
            
            # Transfers
            for tr in stmt.findall('.//Transfer'):
                key = (account_id, tr.get('date',''), tr.get('dateTime',''), tr.get('symbol',''),
                       tr.get('type',''), tr.get('direction',''), tr.get('quantity',''))
                transfers[key] = {**tr.attrib, 'stmtDate': stmt_date}
            
            # Cash Transactions
            for ct in stmt.findall('.//CashTransaction'):
                key = (account_id, ct.get('dateTime',''), ct.get('type',''), 
                       ct.get('amount',''), ct.get('description',''))
                cash_txns[key] = {**ct.attrib, 'stmtDate': stmt_date}
            
            # NAV
            cin = stmt.find('ChangeInNAV')
            if cin is not None:
                nav_key = (account_id, stmt_date)
                navs[nav_key] = {
                    'account_id': account_id,
                    'date': stmt_date,
                    'starting_value': float(cin.get('startingValue', 0) or 0),
                    'ending_value': float(cin.get('endingValue', 0) or 0),
                    'mtm': float(cin.get('mtm', 0) or 0),
                    'realized': float(cin.get('realized', 0) or 0),
                    'dividends': float(cin.get('dividends', 0) or 0),
                    'interest': float(cin.get('interest', 0) or 0),
                    'commissions': float(cin.get('commissions', 0) or 0),
                    'twr': float(cin.get('twr', 0) or 0),
                }
            
            # Positions
            for pos in stmt.findall('.//OpenPosition'):
                sym = pos.get('symbol', '')
                if not sym:
                    continue
                pos_key = (account_id, stmt_date, sym)
                description = pos.get('description', '')
                asset_type = 'STOCK'
                if 'ETF' in description.upper() or sym in ['QQQ', 'QQQM', 'QQQI', 'SPY', 'SPYM', 'VOO', 'SGOV', 'SOXX', 'EWY', 'JEPI', 'BOXX']:
                    asset_type = 'ETF'
                elif any(x in sym for x in ['  ', 'P', 'C']) and len(sym) > 6:
                    asset_type = 'OPTION'
                
                positions[pos_key] = {
                    'account_id': account_id,
                    'date': stmt_date,
                    'symbol': sym,
                    'description': description,
                    'asset_type': asset_type,
                    'position_value': float(pos.get('positionValue', 0) or 0),
                    'mark_price': float(pos.get('markPrice', 0) or 0),
                    'cost_basis_money': float(pos.get('costBasisMoney', 0) or 0),
                    'cost_basis_price': float(pos.get('costBasisPrice', 0) or 0),
                    'position': float(pos.get('position', 0) or 0),
                }
    
    return trades, transfers, cash_txns, navs, positions


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

trades, transfers, cash_txns, navs, positions = parse_xml_files(xml_files)

print(f"\n总计去重后:")
print(f"  Trades: {len(trades)}")
print(f"  Transfers: {len(transfers)}")
print(f"  CashTransactions: {len(cash_txns)}")
print(f"  NAV days: {len(navs)}")
print(f"  Positions snapshots: {len(positions)}")

# 检查 XPEV 的交易
xpev_trades = [v for k, v in trades.items() if v.get('symbol') == 'XPEV' and v.get('assetCategory') == 'STK']
xpev_trades.sort(key=lambda x: x.get('tradeDate',''))
print(f"\nXPEV 交易记录数: {len(xpev_trades)}")
buy_qty = sum(float(t['quantity']) for t in xpev_trades if t['buySell'] == 'BUY')
sell_qty = sum(float(t['quantity']) for t in xpev_trades if t['buySell'] == 'SELL')
print(f"  买入总量: {buy_qty}, 卖出总量: {sell_qty}, 净持仓: {buy_qty + sell_qty}")

# 检查最新持仓中的 XPEV
latest_date = max(p['date'] for p in positions.values() if p['account_id'] == 'U12672188')
xpev_pos = [p for p in positions.values() if p['account_id'] == 'U12672188' and p['symbol'] == 'XPEV' and p['date'] == latest_date]
if xpev_pos:
    p = xpev_pos[0]
    print(f"  最新持仓 ({latest_date}): position={p['position']}, mark_price={p['mark_price']}, position_value={p['position_value']}")

