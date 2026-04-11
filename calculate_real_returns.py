import sys
import os
import pandas as pd
from datetime import datetime

# Use native psycopg2 connection for pandas
import psycopg2

DB_DSN = "host=localhost port=5432 dbname=ib_dashboard user=mc password="
conn = psycopg2.connect(DB_DSN)

# ============================================
# 1. 读取外部现金流（Deposits/Withdrawals）
# ============================================
cash_flow_sql = """
SELECT account_id, date_time, currency, amount, fx_rate_to_base, description
FROM archive_cash_transaction
WHERE type = 'Deposits/Withdrawals'
  AND (description LIKE '%CASH RECEIPTS%'
       OR description LIKE '%DISBURSEMENT%'
       OR description LIKE '%DEPOSIT%'
       OR description LIKE '%WITHDRAWAL%')
ORDER BY date_time
"""
df_cf = pd.read_sql(cash_flow_sql, conn)
df_cf['amount'] = pd.to_numeric(df_cf['amount'], errors='coerce')
df_cf['fx_rate_to_base'] = pd.to_numeric(df_cf['fx_rate_to_base'], errors='coerce').fillna(1.0)
df_cf['cny_amount'] = df_cf['amount'] * df_cf['fx_rate_to_base']
df_cf['date'] = pd.to_datetime(df_cf['date_time'].str.split(';').str[0], format='%Y%m%d')

# 汇总
print("=" * 60)
print("一、外部现金流汇总（折算为 CNY）")
print("=" * 60)
cf_summary = df_cf.groupby('account_id')['cny_amount'].sum().reset_index()
cf_summary.columns = ['账户', '净投入CNY']
print(cf_summary.to_string(index=False))
total_net_invest = cf_summary['净投入CNY'].sum()
print(f"\n总净投入: {total_net_invest:,.2f} CNY")

# ============================================
# 2. 读取每日净值
# ============================================
nav_sql = """
SELECT account_id, date, ending_value
FROM daily_nav
WHERE date = (SELECT MAX(date) FROM daily_nav)
"""
df_nav = pd.read_sql(nav_sql, conn)
df_nav['ending_value'] = pd.to_numeric(df_nav['ending_value'], errors='coerce')

print("\n" + "=" * 60)
print("二、最新账户市值（CNY）")
print("=" * 60)
print(df_nav.to_string(index=False))
total_ending = df_nav['ending_value'].sum()
print(f"\n总市值: {total_ending:,.2f} CNY")

# ============================================
# 3. 计算简单真实收益率
# ============================================
simple_return = (total_ending - total_net_invest) / total_net_invest if total_net_invest != 0 else 0
print("\n" + "=" * 60)
print("三、真实收益率（简单法）")
print("=" * 60)
print(f"真实收益率 = (期末市值 - 总净投入) / 总净投入")
print(f"           = ({total_ending:,.2f} - {total_net_invest:,.2f}) / {total_net_invest:,.2f}")
print(f"           = {simple_return:.2%}")

# ============================================
# 4. 计算 Modified Dietz 收益率
# ============================================
# 需要合并所有现金流，按时间计算权重
all_cf = df_cf.groupby('date')['cny_amount'].sum().reset_index()
if len(all_cf) > 0:
    start_date = all_cf['date'].min()
    end_date = pd.to_datetime(df_nav.iloc[0]['date'])
    total_days = (end_date - start_date).days

    if total_days > 0:
        all_cf['days_remaining'] = (end_date - all_cf['date']).dt.days
        all_cf['weight'] = all_cf['days_remaining'] / total_days
        weighted_cf = (all_cf['cny_amount'] * all_cf['weight']).sum()
        denominator = total_net_invest * (start_date == start_date)  # V_b = 0
        # Modified Dietz: R = (V_e - V_b - CF) / (V_b + sum(w_i * CF_i))
        md_denom = weighted_cf
        md_return = (total_ending - total_net_invest) / md_denom if md_denom != 0 else 0
        print(f"\nModified Dietz 收益率:")
        print(f"  期间: {start_date.date()} ~ {end_date.date()} ({total_days} 天)")
        print(f"  加权平均投入 = {md_denom:,.2f} CNY")
        print(f"  Modified Dietz 收益率 = {md_return:.2%}")
    else:
        print("\n期间过短，无法计算 Modified Dietz")

# ============================================
# 5. 计算摊薄成本
# ============================================
print("\n" + "=" * 60)
print("四、持仓摊薄成本（基于交易记录 + 转入记录）")
print("=" * 60)

# 5a. 读取所有交易（U12672188 为主，加上 U11181997 的早期交易）
trades_sql = """
SELECT account_id, trade_date, symbol, buy_sell,
       CAST(quantity AS REAL) as qty,
       CAST(trade_price AS REAL) as price,
       CAST(trade_money AS REAL) as trade_money,
       CAST(ib_commission AS REAL) as commission,
       CAST(taxes AS REAL) as taxes,
       asset_category
FROM archive_trade
WHERE asset_category IN ('STK', 'ETF')
  AND symbol NOT LIKE '%.%'
ORDER BY trade_date, symbol
"""
df_trades = pd.read_sql(trades_sql, conn)
df_trades['qty'] = df_trades['qty'].abs()
df_trades['commission'] = df_trades['commission'].fillna(0)
df_trades['taxes'] = df_trades['taxes'].fillna(0)

# 5b. 读取转入记录（internal/FOP in）
transfer_in_sql = """
SELECT account_id, date, symbol,
       CAST(quantity AS REAL) as qty,
       CAST(position_amount AS REAL) as position_amount,
       asset_category,
       type
FROM archive_transfer
WHERE direction IN ('IN', 'IN ')
  AND asset_category IN ('STK', 'ETF')
  AND (type = 'INTERNAL' OR type = 'FOP')
ORDER BY date, symbol
"""
df_transfers = pd.read_sql(transfer_in_sql, conn)
df_transfers['qty'] = df_transfers['qty'].abs()
df_transfers['price'] = df_transfers['position_amount'] / df_transfers['qty']
df_transfers['commission'] = 0
df_transfers['taxes'] = 0
df_transfers['trade_money'] = -df_transfers['position_amount']
df_transfers['buy_sell'] = 'BUY'
df_transfers['trade_date'] = df_transfers['date']

# 合并交易和转入
df_all = pd.concat([
    df_trades[['account_id', 'trade_date', 'symbol', 'buy_sell', 'qty', 'price', 'trade_money', 'commission', 'taxes']],
    df_transfers[['account_id', 'trade_date', 'symbol', 'buy_sell', 'qty', 'price', 'trade_money', 'commission', 'taxes']]
], ignore_index=True)

# 5c. 计算每个 symbol 的摊薄成本
cost_basis = {}

for symbol, group in df_all.groupby('symbol'):
    group = group.sort_values('trade_date')
    total_qty = 0.0
    avg_cost = 0.0

    for _, row in group.iterrows():
        qty = row['qty']
        # 计算每股总成本（含佣金税费）
        if row['buy_sell'] == 'BUY':
            total_cost = abs(row['trade_money']) + abs(row['commission']) + abs(row['taxes'])
            if qty > 0:
                cost_per_share = total_cost / qty
            else:
                cost_per_share = 0

            if total_qty + qty > 0:
                avg_cost = (total_qty * avg_cost + qty * cost_per_share) / (total_qty + qty)
            else:
                avg_cost = 0
            total_qty += qty

        elif row['buy_sell'] == 'SELL':
            total_qty -= qty
            if total_qty <= 0.0001:
                total_qty = 0
                avg_cost = 0

    cost_basis[symbol] = {
        'qty': round(total_qty, 4),
        'avg_cost': round(avg_cost, 4) if total_qty > 0 else 0,
        'total_cost': round(total_qty * avg_cost, 2) if total_qty > 0 else 0
    }

# 5d. 读取最新持仓，匹配摊薄成本
positions_sql = """
SELECT account_id, date, symbol, description, asset_type, position_value, mark_price
FROM positions
WHERE date = (SELECT MAX(date) FROM positions)
  AND asset_type IN ('STOCK', 'ETF')
ORDER BY symbol
"""
df_pos = pd.read_sql(positions_sql, conn)

results = []
for _, row in df_pos.iterrows():
    sym = row['symbol']
    cb = cost_basis.get(sym, {'qty': 0, 'avg_cost': 0, 'total_cost': 0})
    if cb['qty'] > 0:
        unrealized = row['position_value'] - cb['total_cost']
        return_pct = (row['mark_price'] - cb['avg_cost']) / cb['avg_cost'] if cb['avg_cost'] > 0 else 0
        results.append({
            'Symbol': sym,
            '名称': row['description'][:25] if row['description'] else '',
            '持仓量': cb['qty'],
            '现价': round(row['mark_price'], 2),
            '市值': round(row['position_value'], 2),
            '摊薄成本': cb['avg_cost'],
            '总成本': cb['total_cost'],
            '未实现盈亏': round(unrealized, 2),
            '盈亏比例': f"{return_pct:.2%}"
        })

df_result = pd.DataFrame(results)
if not df_result.empty:
    df_result = df_result.sort_values('市值', ascending=False)
    print(df_result.to_string(index=False))
    print(f"\n总持仓市值: {df_result['市值'].sum():,.2f} USD")
    print(f"总持仓成本: {df_result['总成本'].sum():,.2f} USD")
    print(f"总未实现盈亏: {df_result['未实现盈亏'].sum():,.2f} USD")
else:
    print("未找到匹配的持仓数据")

conn.close()
