import json

with open('data/dashboard_data.json') as f:
    data = json.load(f)

print('账户:', data['accountId'])
print('净值:', data['summary']['totalNav'])
print('股票:', len(data['openPositions']['stocks']))
print('ETF:', len(data['openPositions']['etfs']))
print('期权:', len(data['openPositions']['options']))
print()
print('前 3 只股票:')
for s in data['openPositions']['stocks'][:3]:
    print(f"  {s['symbol']}: ${s['positionValue']:,.0f}")
