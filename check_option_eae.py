import json

with open('data/dashboard_data.json') as f:
    data = json.load(f)

print('期权事件总数:', len(data['optionEAE']))
print()
print('前 5 条:')
for e in data['optionEAE'][:5]:
    print(f"  {e['date']} {e['underlyingSymbol']} {e['transactionType']} qty={e['quantity']} strike={e['strike']} mtmPnl={e['mtmPnl']}")
