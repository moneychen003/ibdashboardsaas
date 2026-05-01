import { useMemo, useState } from 'react';
import { useDashboardStore } from '../../stores/dashboardStore';
import { fmtCur, fmtDate, fmtNum } from '../../utils/format';
import OrderExecutionPanel from '../OrderExecutionPanel';
import WashSaleAlerts from '../WashSaleAlerts';
import ChangesTab from './ChangesTab';

function tradeKindTag(t) {
  const codes = (t.notes || '').split(';').map((c) => c.trim());
  if (codes.includes('A')) return { label: '指派', cls: 'bg-amber-100 text-amber-700' };
  if (codes.includes('Ep')) return { label: '到期', cls: 'bg-slate-100 text-slate-600' };
  if (codes.includes('Ex')) return { label: '行权', cls: 'bg-amber-100 text-amber-700' };
  if (t.openCloseIndicator === 'O') return { label: '开仓', cls: 'bg-blue-100 text-blue-700' };
  if (t.openCloseIndicator === 'C') return { label: '平仓', cls: 'bg-slate-100 text-slate-600' };
  return null;
}

function OcTag({ trade }) {
  const tag = tradeKindTag(trade);
  if (!tag) return null;
  return (
    <span className={`ml-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${tag.cls}`}>
      {tag.label}
    </span>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-xl border border-[var(--light-gray)] p-6">
      {title && <div className="mb-4 text-lg font-semibold">{title}</div>}
      {children}
    </div>
  );
}

function Badge({ children, active, onClick, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={[
        'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition',
        active ? 'border-black bg-black text-white' : 'border-[var(--light-gray)] bg-white text-[var(--gray)] hover:border-black hover:text-black',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function SelectFilter({ label, value, options, onChange }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg border border-[var(--light-gray)] bg-white px-3 py-2 pr-8 text-sm font-medium outline-none hover:border-black"
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--gray)]">▾</span>
    </div>
  );
}

function useFilterState() {
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [symbol, setSymbol] = useState('');
  const [currencies, setCurrencies] = useState([]);
  const [types, setTypes] = useState([]);

  const reset = () => {
    setSearch('');
    setYear('');
    setSymbol('');
    setCurrencies([]);
    setTypes([]);
  };

  return { search, setSearch, year, setYear, symbol, setSymbol, currencies, setCurrencies, types, setTypes, reset };
}

function FilterBar({
  search,
  setSearch,
  year,
  setYear,
  symbol,
  setSymbol,
  currencies,
  setCurrencies,
  types,
  setTypes,
  yearOptions,
  symbolOptions,
  currencyOptions,
  typeOptions,
  showTypeAll = true,
}) {
  const toggleCurrency = (c) => {
    setCurrencies((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };
  const toggleType = (t) => {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const hasFilters = search || year || symbol || currencies.length || types.length;

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {yearOptions.length > 0 && (
          <SelectFilter label="全部年份" value={year} options={yearOptions} onChange={setYear} />
        )}
        {symbolOptions.length > 0 && (
          <SelectFilter label="全部标的" value={symbol} options={symbolOptions} onChange={setSymbol} />
        )}
        {currencyOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge active={currencies.length === 0} onClick={() => setCurrencies([])}>
              原始
            </Badge>
            {currencyOptions.map((c) => (
              <Badge key={c} active={currencies.includes(c)} onClick={() => toggleCurrency(c)}>
                {c}
              </Badge>
            ))}
          </div>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索描述、日期、标的..."
          className="w-48 rounded-lg border border-[var(--light-gray)] px-3 py-2 text-sm outline-none hover:border-black"
        />
        {hasFilters && (
          <button
            onClick={() => {
              setSearch('');
              setYear('');
              setSymbol('');
              setCurrencies([]);
              setTypes([]);
            }}
            className="text-xs text-[var(--gray)] underline hover:text-black"
          >
            重置筛选
          </button>
        )}
      </div>

      {typeOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {showTypeAll && (
            <Badge active={types.length === 0} onClick={() => setTypes([])}>
              全部
            </Badge>
          )}
          {typeOptions.map((t) => (
            <Badge key={t.key || t} active={types.includes(t.key || t)} onClick={() => toggleType(t.key || t)}>
              {t.label || t}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCards({ items }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-[var(--light-gray)] bg-[#fafafa] p-4">
          <div className="text-xs text-[var(--gray)]">{it.label}</div>
          <div className={`mt-1 text-lg font-bold ${it.colorClass || ''}`}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function TableWrap({ children, empty }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-[var(--light-gray)]">
      {children}
      {empty && <div className="py-8 text-center text-sm text-[var(--gray)]">无匹配数据</div>}
    </div>
  );
}

function extractYear(dateStr) {
  const d = String(dateStr || '').slice(0, 10);
  return d ? d.slice(0, 4) : '';
}

function useCommonFilters(items, { dateField = 'date', symbolField = 'symbol', typeField = 'type', typeFn } = {}) {
  const f = useFilterState();
  const yearOptions = useMemo(() => {
    const set = new Set(items.map((x) => extractYear(x[dateField])).filter(Boolean));
    return Array.from(set).sort().reverse();
  }, [items, dateField]);
  const symbolOptions = useMemo(() => {
    const set = new Set(items.map((x) => x[symbolField]).filter(Boolean));
    return Array.from(set).sort();
  }, [items, symbolField]);
  const currencyOptions = useMemo(() => {
    const set = new Set(items.map((x) => x.currency).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  const filtered = items.filter((x) => {
    if (f.year && extractYear(x[dateField]) !== f.year) return false;
    if (f.symbol && x[symbolField] !== f.symbol) return false;
    if (f.currencies.length && !f.currencies.includes(x.currency)) return false;
    const t = typeFn ? typeFn(x) : x[typeField];
    if (f.types.length && !f.types.includes(t)) return false;
    if (f.search) {
      const str = JSON.stringify(x).toLowerCase();
      if (!str.includes(f.search.toLowerCase())) return false;
    }
    return true;
  });

  return { ...f, yearOptions, symbolOptions, currencyOptions, filtered };
}

function TradeTable({ trades }) {
  const typeOptions = useMemo(
    () =>
      Array.from(new Set(trades.map((t) => t.buySell).filter(Boolean)))
        .sort()
        .map((k) => ({ key: k, label: k === 'BUY' ? '买入' : k === 'SELL' ? '卖出' : k })),
    [trades]
  );
  const { filtered, ...filterProps } = useCommonFilters(trades, { dateField: 'tradeDate', typeOptions, typeFn: (t) => t.buySell });

  const totalPnl = filtered.reduce((s, t) => s + (Number(t.realizedPnl || t.mtmPnl || 0)), 0);
  const totalQty = filtered.reduce((s, t) => s + Math.abs(Number(t.quantity) || 0), 0);

  return (
    <div>
      <FilterBar {...filterProps} typeOptions={typeOptions} />
      <SummaryCards
        items={[
          { label: '筛选笔数', value: filtered.length },
          { label: '总数量', value: fmtNum(totalQty, 0) },
          { label: '总盈亏', value: (totalPnl >= 0 ? '+' : '') + fmtCur(totalPnl), colorClass: totalPnl >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]' },
        ]}
      />
      <TableWrap empty={!filtered.length}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
              <th className="py-2 pl-3">日期</th>
              <th className="py-2">标的</th>
              <th className="py-2">方向</th>
              <th className="py-2 text-right">数量</th>
              <th className="py-2 text-right">价格</th>
              <th className="py-2">币种</th>
              <th className="py-2 text-right">盈亏</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((t, i) => (
              <tr key={i} className="border-b border-[var(--lighter-gray)]">
                <td className="py-2 pl-3">{fmtDate(t.tradeDate || t.date)}</td>
                <td className="py-2 font-medium">{t.symbol}</td>
                <td className="py-2 whitespace-nowrap">{t.buySell}<OcTag trade={t} /></td>
                <td className="py-2 text-right">{t.quantity}</td>
                <td className="py-2 text-right">{fmtCur(t.tradePrice || 0)}</td>
                <td className="py-2">{t.currency}</td>
                <td className={`py-2 text-right font-semibold ${(t.realizedPnl || t.mtmPnl || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                  {fmtCur(t.realizedPnl || t.mtmPnl || 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

function DividendTable({ dividends }) {
  const typeOptions = useMemo(
    () =>
      Array.from(new Set(dividends.map((d) => d.type || d.dividendType || '分红').filter(Boolean)))
        .sort()
        .map((k) => ({ key: k, label: k })),
    [dividends]
  );
  const { filtered, ...filterProps } = useCommonFilters(dividends, { typeOptions, typeFn: (d) => d.type || d.dividendType || '分红' });

  const totalAmount = filtered.reduce((s, d) => s + Math.abs(Number(d.amount) || 0), 0);

  return (
    <div>
      <FilterBar {...filterProps} typeOptions={typeOptions} />
      <SummaryCards
        items={[
          { label: '筛选笔数', value: filtered.length },
          { label: '总分红金额', value: fmtCur(totalAmount) },
        ]}
      />
      <TableWrap empty={!filtered.length}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
              <th className="py-2 pl-3">日期</th>
              <th className="py-2">标的</th>
              <th className="py-2">类型</th>
              <th className="py-2">币种</th>
              <th className="py-2 text-right">金额</th>
              <th className="py-2">描述</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d, i) => (
              <tr key={i} className="border-b border-[var(--lighter-gray)]">
                <td className="py-2 pl-3">{fmtDate(d.date)}</td>
                <td className="py-2 font-medium">{d.symbol}</td>
                <td className="py-2">{d.type || d.dividendType || '分红'}</td>
                <td className="py-2">{d.currency}</td>
                <td className="py-2 text-right font-semibold text-[var(--success)]">+{fmtCur(Math.abs(Number(d.amount) || 0))}</td>
                <td className="py-2 text-[var(--gray)]">{d.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

function classifyStmtType(r) {
  const d = (r.activityDescription || '').toLowerCase();
  if (d.includes('dividend')) return '股息';
  if (d.includes('coupon')) return '债券利息';
  if (d.includes('interest')) return '利息';
  if (d.includes('buy')) return '买入';
  if (d.includes('sell')) return '卖出';
  if (d.includes('deposit') || d.includes('withdrawal')) return '存取款';
  if (d.includes('fee') || d.includes('commission')) return '费用';
  if (d.includes('transfer')) return '转账';
  if (d.includes('maturity') || d.includes('redemption') || d.includes('call')) return '到期/赎回';
  return '其他';
}

function StmtFundsTable({ stmtFunds }) {
  if (!stmtFunds?.length) return <p className="text-sm text-[var(--gray)]">暂无资金流水数据</p>;

  const items = useMemo(() => stmtFunds.map((r) => ({ ...r, _type: classifyStmtType(r) })), [stmtFunds]);
  const typeOptions = useMemo(
    () =>
      Array.from(new Set(items.map((r) => r._type)))
        .sort()
        .map((k) => ({ key: k, label: k })),
    [items]
  );
  const { filtered, ...filterProps } = useCommonFilters(items, { typeOptions, typeFn: (r) => r._type });
  const sorted = [...filtered].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const totalDebit = sorted.reduce((s, r) => s + Math.abs(Number(r.debit) || 0), 0);
  const totalCredit = sorted.reduce((s, r) => s + Math.abs(Number(r.credit) || 0), 0);
  const totalAmount = sorted.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <div>
      <FilterBar {...filterProps} typeOptions={typeOptions} />
      <SummaryCards
        items={[
          { label: '筛选笔数', value: sorted.length },
          { label: '总借记', value: fmtCur(totalDebit) },
          { label: '总贷记', value: fmtCur(totalCredit), colorClass: 'text-[var(--success)]' },
          { label: '净额', value: fmtCur(totalAmount), colorClass: totalAmount >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]' },
        ]}
      />
      <TableWrap empty={!sorted.length}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
              <th className="py-2 pl-3">日期</th>
              <th className="py-2">标的</th>
              <th className="py-2">描述</th>
              <th className="py-2 text-right">借记</th>
              <th className="py-2 text-right">贷记</th>
              <th className="py-2 text-right">余额</th>
              <th className="py-2 text-right">交易总额</th>
              <th className="py-2">币种</th>
              <th className="py-2 text-right">金额</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map((r, i) => (
              <tr key={i} className="border-b border-[var(--lighter-gray)]">
                <td className="py-2 pl-3">{fmtDate(r.date)}</td>
                <td className="py-2 font-medium">{r.symbol || '-'}</td>
                <td className="py-2 text-[var(--gray)]">{r.activityDescription || '-'}</td>
                <td className="py-2 text-right">{fmtCur(Number(r.debit) || 0)}</td>
                <td className="py-2 text-right">{fmtCur(Number(r.credit) || 0)}</td>
                <td className="py-2 text-right">{fmtCur(Number(r.balance) || 0)}</td>
                <td className="py-2 text-right">{fmtCur(Number(r.tradeGross) || 0)}</td>
                <td className="py-2">{r.currency || '-'}</td>
                <td className={`py-2 text-right font-semibold ${(Number(r.amount) || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                  {fmtCur(Number(r.amount) || 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

function ChangeInNavDetailsCard({ details }) {
  if (!details || typeof details !== 'object') {
    return <p className="text-sm text-[var(--gray)]">暂无 NAV 明细数据</p>;
  }

  const labelMap = {
    withholding_tax: '预扣税',
    broker_fees: '券商费用',
    forex_commissions: '外汇佣金',
    corporate_action_proceeds: '公司行动收益',
    net_fx_trading: '外汇交易净额',
    fx_translation: '外汇折算',
    transaction_tax: '交易税',
    sales_tax: '销售税',
    client_fees: '客户费用',
    advisor_fees: '顾问费用',
    other_fees: '其他费用',
    commissions: '佣金',
    deposits_withdrawals: '存取款',
    asset_transfers: '资产转账',
    internal_cash_transfers: '内部现金转账',
    change_in_unrealized: '未实现变动',
    change_in_dividend_accruals: '股息应计变动',
    change_in_interest_accruals: '利息应计变动',
    change_in_broker_fee_accruals: '券商费用应计变动',
    change_in_cgt_withholding_accruals: '资本利得税预扣应计变动',
    change_in_incentive_coupon_accruals: '激励券应计变动',
    change_in_lite_surcharge_accruals: 'Lite附加费应计变动',
    cost_adjustments: '成本调整',
    linking_adjustments: '链接调整',
    referral_fee: '推荐费',
    other_income: '其他收入',
    other: '其他',
    paxos_transfers: 'Paxos转账',
    grant_activity: '赠款活动',
    debit_card_activity: '借记卡活动',
    bill_pay: '账单支付',
    donations: '捐赠',
    excess_fund_sweep: '超额资金划转',
    commission_credits_redemption: '佣金积分兑换',
    withholding871m: '871(m)预扣税',
    carbon_credits: '碳信用',
    billable_sales_tax: '可征收销售税',
    starting_value: '起始价值',
    ending_value: '结束价值',
    mtm: '市值重估',
    realized: '已实现',
    dividends: '股息',
    interest: '利息',
    twr: '时间加权收益',
    fees_receivables: '费用应收款',
    commission_receivables: '佣金应收款',
    tax_receivables: '税款应收款',
    soft_dollars: '软美元',
    mtm_at_paxos: 'Paxos市值重估',
    commissions_at_paxos: 'Paxos佣金',
    transferred_pnl_adjustments: '转移PnL调整',
    withholding_tax_collected: '已收预扣税',
  };

  const getLabel = (key) => {
    const snake = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()).replace(/^_/, '');
    return labelMap[key] || labelMap[snake] || key;
  };

  const getGroup = (key) => {
    const snake = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()).replace(/^_/, '');
    const taxKeys = new Set([
      'withholding_tax', 'transaction_tax', 'sales_tax', 'billable_sales_tax',
      'withholding871m', 'withholding_tax_collected', 'tax_receivables',
      'change_in_cgt_withholding_accruals',
    ]);
    const feeKeys = new Set([
      'broker_fees', 'forex_commissions', 'client_fees', 'advisor_fees',
      'other_fees', 'commissions', 'commissions_at_paxos', 'referral_fee',
      'commission_credits_redemption', 'fees_receivables',
      'change_in_broker_fee_accruals', 'change_in_lite_surcharge_accruals',
    ]);
    const fxKeys = new Set(['net_fx_trading', 'fx_translation']);
    const incomeKeys = new Set([
      'corporate_action_proceeds', 'change_in_unrealized',
      'change_in_dividend_accruals', 'change_in_interest_accruals',
      'change_in_incentive_coupon_accruals', 'other_income',
      'dividends', 'interest', 'realized', 'mtm', 'mtm_at_paxos',
    ]);
    const transferKeys = new Set([
      'deposits_withdrawals', 'asset_transfers', 'internal_cash_transfers',
      'paxos_transfers', 'grant_activity', 'debit_card_activity',
      'bill_pay', 'donations', 'excess_fund_sweep',
    ]);
    const adjustmentKeys = new Set([
      'cost_adjustments', 'linking_adjustments', 'other', 'carbon_credits',
      'transferred_pnl_adjustments', 'soft_dollars',
    ]);
    if (taxKeys.has(snake)) return '税费';
    if (feeKeys.has(snake)) return '费用';
    if (fxKeys.has(snake)) return '外汇';
    if (incomeKeys.has(snake)) return '收益/损益';
    if (transferKeys.has(snake)) return '转账/存取';
    if (adjustmentKeys.has(snake)) return '调整';
    return '其他';
  };

  const excludeKeys = new Set(['starting_value', 'ending_value', 'twr']);
  const entries = Object.entries(details)
    .filter(([k, v]) => !excludeKeys.has(k) && !excludeKeys.has(k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()).replace(/^_/, '')) && Math.abs(Number(v) || 0) > 0);

  if (!entries.length) return <p className="text-sm text-[var(--gray)]">无有效 NAV 变动明细</p>;

  const byGroup = {};
  entries.forEach(([k, v]) => {
    const g = getGroup(k);
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push({ key: k, value: Number(v) || 0, label: getLabel(k) });
  });

  const groupOrder = ['税费', '费用', '外汇', '收益/损益', '转账/存取', '调整', '其他'];
  const groupTotals = {};
  Object.entries(byGroup).forEach(([g, arr]) => {
    groupTotals[g] = arr.reduce((s, item) => s + item.value, 0);
  });
  const grandTotal = Object.values(groupTotals).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm">
        {groupOrder.filter((g) => byGroup[g]?.length).map((g) => (
          <div key={g} className="rounded-lg border border-[var(--light-gray)] px-3 py-2">
            <span className="text-xs text-[var(--gray)]">{g}:</span>{' '}
            <span className={`font-semibold ${groupTotals[g] >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
              {fmtCur(groupTotals[g])}
            </span>
          </div>
        ))}
        <div className="rounded-lg bg-black px-3 py-2 text-white">
          <span className="text-xs">合计:</span>{' '}
          <span className="font-semibold">{fmtCur(grandTotal)}</span>
        </div>
      </div>
      {groupOrder
        .filter((g) => byGroup[g]?.length)
        .map((g) => (
          <div key={g}>
            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-[var(--gray)]">
              <span>{g}</span>
              <span className={groupTotals[g] >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
                {fmtCur(groupTotals[g])}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {byGroup[g].map((item) => (
                <div key={item.key} className="rounded-lg border border-[var(--light-gray)] p-3">
                  <div className="mb-1 truncate text-xs text-[var(--gray)]">{item.label}</div>
                  <div className={`text-sm font-semibold ${item.value >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                    {fmtCur(item.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

function ConversionRatesTable({ rates }) {
  if (!rates?.length) return <p className="text-sm text-[var(--gray)]">暂无汇率数据</p>;
  return (
    <div className="max-h-[300px] overflow-auto rounded-lg border border-[var(--light-gray)]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
            <th className="py-2 pl-3">日期</th>
            <th className="py-2">从币种</th>
            <th className="py-2">到币种</th>
            <th className="py-2 text-right">汇率</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r, i) => (
            <tr key={i} className="border-b border-[var(--lighter-gray)]">
              <td className="py-2 pl-3">{fmtDate(r.reportDate)}</td>
              <td className="py-2 font-medium">{r.fromCurrency}</td>
              <td className="py-2">{r.toCurrency}</td>
              <td className="py-2 text-right font-medium">{fmtNum(r.rate, 6)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function deriveFeeType(f) {
  const types = [];
  if (Math.abs(Number(f.brokerExecution || 0)) > 0 || Math.abs(Number(f.brokerClearing || 0)) > 0) types.push('券商');
  if (
    Math.abs(Number(f.thirdPartyExecution || 0)) > 0 ||
    Math.abs(Number(f.thirdPartyClearing || 0)) > 0 ||
    Math.abs(Number(f.thirdPartyRegulatory || 0)) > 0
  ) types.push('第三方');
  if (Math.abs(Number(f.finraFee || 0)) > 0 || Math.abs(Number(f.secFee || 0)) > 0 || Math.abs(Number(f.regOther || 0)) > 0) types.push('监管');
  if (Math.abs(Number(f.other || 0)) > 0) types.push('其他');
  return types.length ? types.join('+') + '费用' : '交易费用';
}

function TransactionFeesTable({ fees }) {
  const typeOptions = useMemo(
    () =>
      Array.from(new Set(fees.map((f) => deriveFeeType(f))))
        .sort()
        .map((k) => ({ key: k, label: k })),
    [fees]
  );
  const { filtered, ...filterProps } = useCommonFilters(fees, { typeOptions, typeFn: deriveFeeType });

  const totalAmount = filtered.reduce((s, f) => s + Math.abs(Number(f.amount) || 0), 0);

  return (
    <div>
      <FilterBar {...filterProps} typeOptions={typeOptions} />
      <SummaryCards
        items={[
          { label: '筛选笔数', value: filtered.length },
          { label: '总费用', value: fmtCur(totalAmount), colorClass: 'text-[var(--danger)]' },
        ]}
      />
      <TableWrap empty={!filtered.length}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
              <th className="py-2 pl-3">日期</th>
              <th className="py-2">类型</th>
              <th className="py-2">币种</th>
              <th className="py-2 text-right">金额</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((f, i) => (
              <tr key={i} className="border-b border-[var(--lighter-gray)]">
                <td className="py-2 pl-3">{fmtDate((f.date || '').split(';')[0])}</td>
                <td className="py-2">{deriveFeeType(f)}</td>
                <td className="py-2">{f.currency || '-'}</td>
                <td className="py-2 text-right font-semibold text-[var(--danger)]">{fmtCur(Number(f.amount) || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}


function DataQualityCard({ dq }) {
  const tables = (dq && dq.tables) || [];
  if (!tables.length) return <p className="text-sm text-[var(--gray)]">暂无数据质量信息</p>;
  return (
    <div>
      <div className="mb-2 text-xs text-[var(--gray)]">数据快照生成时间 {dq.generatedAt || '-'}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--light-gray)] text-left text-xs text-[var(--gray)]">
              <th className="py-2">表</th>
              <th className="py-2 text-right">行数</th>
              <th className="py-2">最新日期</th>
              <th className="py-2">状态</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t.table} className="border-b border-[var(--lighter-gray)]">
                <td className="py-2 font-mono text-xs">{t.table}</td>
                <td className="py-2 text-right">{fmtNum(t.rowCount, 0)}</td>
                <td className="py-2 text-xs">{t.latestDate || '—'}</td>
                <td className="py-2 text-xs">
                  {t.error ? (
                    <span className="rounded bg-red-50 px-2 py-0.5 text-red-600">{t.error}</span>
                  ) : t.rowCount > 0 ? (
                    <span className="rounded bg-green-50 px-2 py-0.5 text-green-600">OK</span>
                  ) : (
                    <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-600">空</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DetailsTab() {
  const data = useDashboardStore((s) => s.data);
  if (!data) return <div className="py-10 text-center text-[var(--gray)]">暂无数据</div>;

  return (
    <div className="space-y-6">
      <Card title="📝 交易记录">
        <TradeTable trades={data.trades || []} />
      </Card>
      <Card title="💵 分红数据">
        <DividendTable dividends={data.dividends || []} />
      </Card>
      <Card title="🔍 费用明细">
        <TransactionFeesTable fees={data.transactionFees || []} />
      </Card>
      <Card title="💰 资金流水">
        <StmtFundsTable stmtFunds={data.stmtFunds || []} />
      </Card>
      <Card title="📊 NAV 变动明细">
        <ChangeInNavDetailsCard details={data.changeInNavDetails} />
      </Card>
      <Card title="🌐 汇率数据">
        <ConversionRatesTable rates={data.conversionRates || []} />
      </Card>
      <Card title="📈 订单执行质量">
        <OrderExecutionPanel data={data} />
      </Card>
      <Card title="⚠️ 税务优化提醒">
        <WashSaleAlerts data={data} />
      </Card>
      <Card title="🛠️ 数据质量">
        <DataQualityCard dq={data.dataQuality} />
      </Card>

      <div className="border-t border-[var(--light-gray)] pt-6">
        <ChangesTab />
      </div>
    </div>
  );
}
