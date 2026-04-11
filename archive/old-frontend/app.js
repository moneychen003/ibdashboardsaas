// IB 投资组合仪表盘 - 增强版（多账户 + K 线 + 实时行情）

let portfolioData = null;
let currentCurrency = 'USD';  // 默认显示 USD（IB 数据实际是 USD 基准）
let currentFilter = 'all';
let currentPage = 1;
let currentNavRange = 'nav1Month';
const ITEMS_PER_PAGE = 15;

// 汇率配置（USD 为基准）
const EXCHANGE_RATES = {
    'USD': 1.0,
    'CNH': 7.1887,  // 1 USD = 7.1887 CNH (IB 汇率)
    'HKD': 7.85,
    'CNY': 7.23
};

// 多账户支持
let accountsConfig = null;
let currentAccountId = 'account1';
let klineData = null;
let currentKlineSymbol = null;

// 格式化数字
function formatNumber(num, decimals = 0) {
    return new Intl.NumberFormat('zh-CN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(num);
}

// 格式化货币（带汇率转换）
function formatCurrency(num, currency = 'USD') {
    const symbols = { CNH: '¥', USD: '$', HKD: 'HK$', CNY: '¥' };
    const symbol = symbols[currency] || '$';
    
    // 如果当前货币不是 USD，需要转换
    // IB 数据默认是 USD 基准，所以从 USD 转换到目标货币
    const rate = EXCHANGE_RATES[currency] || 1.0;
    const convertedNum = num * rate;
    
    return symbol + formatNumber(Math.abs(convertedNum), 0);
}

// 转换货币值（用于计算）
function convertCurrency(num, fromCurrency, toCurrency) {
    // 先转换到 USD，再转换到目标货币
    const usdValue = num / (EXCHANGE_RATES[fromCurrency] || 1.0);
    return usdValue * (EXCHANGE_RATES[toCurrency] || 1.0);
}

// 格式化百分比
function formatPercent(num) {
    const sign = num >= 0 ? '+' : '';
    return sign + num.toFixed(2) + '%';
}

// 格式化日期
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// 格式化 IB 日期 (YYYYMMDD → YYYY-MM-DD)
function formatIBDate(dateStr) {
    if (!dateStr || dateStr.length !== 8) return dateStr;
    return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
}

// 获取标的类型
function getSecurityType(symbol, description) {
    if (description.includes('ETF') || description.includes('Fund')) return 'etf';
    if (symbol.includes('P') || symbol.includes('C')) return 'option';
    return 'stock';
}

// 获取标的图标颜色
function getIconColor(symbol) {
    const colors = {
        'XPEV': '#3b82f6', 'QQQ': '#8b5cf6', 'LI': '#10b981',
        'BABA': '#f59e0b', 'MU': '#ef4444', 'MSFT': '#06b6d4',
        'SPY': '#6366f1', 'COIN': '#1d4ed8', 'NVDA': '#22c55e'
    };
    return colors[symbol] || '#' + Math.floor(Math.random()*16777215).toString(16);
}

// 加载账户配置
async function loadAccountsConfig() {
    try {
        const response = await fetch('/api/accounts');
        const data = await response.json();
        // 适配后端 API 格式到前端内部格式
        accountsConfig = {
            accounts: data.accounts.map(acc => ({
                id: acc.alias,
                name: acc.label,
                accountId: acc.alias,
                color: acc.color,
                isDefault: acc.isDefault
            }))
        };
        // 设置默认账户
        const defaultAcc = accountsConfig.accounts.find(a => a.isDefault) || accountsConfig.accounts[0];
        if (defaultAcc) {
            currentAccountId = defaultAcc.id;
        }
        renderAccountDropdown();
    } catch (error) {
        console.log('未找到账户配置，使用单账户模式');
        accountsConfig = null;
    }
}

// 渲染账户下拉菜单
function renderAccountDropdown() {
    if (!accountsConfig) return;
    
    const dropdown = document.getElementById('accountDropdown');
    let html = '';
    
    accountsConfig.accounts.forEach(account => {
        const isActive = account.id === currentAccountId;
        html += `
            <div class="account-item ${isActive ? 'active' : ''}" onclick="switchAccount('${account.id}')">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="account-color-dot" style="background: ${account.color};"></div>
                    <div class="account-item-info">
                        <div class="account-item-name">${account.name}</div>
                        <div class="account-item-id">${account.accountId}</div>
                    </div>
                </div>
                ${isActive ? '✓' : ''}
            </div>
        `;
    });
    
    dropdown.innerHTML = html;
    
    // 更新当前账户显示
    const currentAccount = accountsConfig.accounts.find(a => a.id === currentAccountId);
    if (currentAccount) {
        document.getElementById('currentAccountName').textContent = currentAccount.name;
        document.getElementById('currentAccountDot').style.background = currentAccount.color;
    }
}

// 切换账户
async function switchAccount(accountId) {
    currentAccountId = accountId;
    renderAccountDropdown();
    
    // 通过 API 加载新账户数据
    try {
        const response = await fetch(`/api/dashboard/${accountId}?` + Date.now());
        portfolioData = await response.json();
        renderDashboard();
        
        // 加载 K 线数据
        loadKlineData();
    } catch (error) {
        console.error('加载账户数据失败:', error);
    }
    
    // 关闭下拉菜单
    document.getElementById('accountDropdown').classList.remove('show');
}

// 切换账户下拉菜单
function toggleAccountDropdown() {
    document.getElementById('accountDropdown').classList.toggle('show');
}

// 点击外部关闭下拉菜单
document.addEventListener('click', (e) => {
    if (!e.target.closest('.account-selector')) {
        document.getElementById('accountDropdown').classList.remove('show');
    }
});

// 加载数据
async function loadData() {
    try {
        // 等待账户配置加载完成（如果 loadAccountsConfig 是异步的）
        let waitCount = 0;
        while (!accountsConfig && waitCount < 20) {
            await new Promise(r => setTimeout(r, 50));
            waitCount++;
        }
        
        let alias = 'combined';
        if (accountsConfig) {
            const account = accountsConfig.accounts.find(a => a.id === currentAccountId);
            if (account) alias = account.id;
        }
        
        const response = await fetch(`/api/dashboard/${alias}?` + Date.now());
        portfolioData = await response.json();
        console.log('✅ 加载数据:', portfolioData.accountId);
        
        renderDashboard();
        updateUpdateTime();
        loadKlineData();
        
        // 初始化净值范围按钮状态
        document.querySelectorAll('.range-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.range === currentNavRange);
        });
    } catch (error) {
        console.error('加载数据失败:', error);
        // fallback to sample data
        try {
            const response = await fetch('data/sample_data.json');
            portfolioData = await response.json();
            renderDashboard();
        } catch (e) {
            console.error('示例数据也加载失败:', e);
        }
    }
}

// 加载 K 线数据
async function loadKlineData() {
    try {
        const response = await fetch('data/kline_data.json');
        klineData = await response.json();
    } catch (error) {
        console.log('K 线数据未加载');
        klineData = null;
    }
}

// 更新更新时间
function updateUpdateTime() {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
    document.getElementById('updateTime').textContent = `更新于：${timeStr}`;
}

// 刷新数据
function refreshData() {
    const btn = document.querySelector('.refresh-btn');
    btn.textContent = '🔄 加载中...';
    btn.disabled = true;
    
    setTimeout(() => {
        loadData();
        btn.textContent = '🔄 刷新';
        btn.disabled = false;
    }, 1000);
}

// 渲染仪表盘
function renderDashboard() {
    if (!portfolioData) return;
    
    // 支持 IB 数据结构和旧数据结构
    const summary = portfolioData.summary || portfolioData.netAssetValue;
    const positions = portfolioData.openPositions || { stocks: [], etfs: [], options: [] };
    const perf = portfolioData.performance || portfolioData.performanceSummary || {};
    
    // Hero 区域（IB 数据是 USD 基准）
    const totalNav = summary.totalNav || summary.total || 0;
    const navChange = summary.totalGain || summary.changeToday || 0;
    const navChangePct = summary.totalGainPct || summary.changeTodayPct || 0;
    
    document.getElementById('totalNav').textContent = formatCurrency(totalNav, currentCurrency);
    document.getElementById('navChange').textContent = (navChange >= 0 ? '+' : '') + formatCurrency(navChange, currentCurrency);
    document.getElementById('navChangePct').textContent = formatPercent(navChangePct);
    document.getElementById('navChangePct').className = navChangePct >= 0 ? 'change-positive' : 'change-negative';
    
    // 统计卡片（所有数值都是 USD 基准，需要转换）
    const stocksValue = positions.stocks ? positions.stocks.reduce((sum, p) => sum + (p.positionValue || p.marketValue || 0), 0) : 0;
    const etfsValue = positions.etfs ? positions.etfs.reduce((sum, p) => sum + (p.positionValue || p.marketValue || 0), 0) : 0;
    const optionsValue = positions.options ? positions.options.reduce((sum, p) => sum + (p.positionValue || p.marketValue || 0), 0) : 0;
    const cashValue = summary.cash || 0;
    
    document.getElementById('equityValue').textContent = formatCurrency(stocksValue + etfsValue, currentCurrency);
    document.getElementById('equityValue').dataset.value = stocksValue + etfsValue;
    document.getElementById('optionsValue').textContent = '-' + formatCurrency(Math.abs(optionsValue), currentCurrency);
    document.getElementById('cashValue').textContent = formatCurrency(cashValue, currentCurrency);
    
    // 现金余额分货币显示
    const cashReport = portfolioData.cashReport || [];
    const cashBreakdown = document.getElementById('cashBreakdown');
    if (cashBreakdown) {
        const activeCurrencies = cashReport.filter(c => Math.abs(c.cash || c.amount || 0) > 0.01);
        if (activeCurrencies.length > 1) {
            cashBreakdown.innerHTML = activeCurrencies.map(c => {
                const amt = c.cash || c.amount || 0;
                return `<span>${c.currency}: ${formatCurrency(amt, c.currency)}</span>`;
            }).join('<span style="margin: 0 6px;">•</span>');
        } else if (activeCurrencies.length === 1) {
            cashBreakdown.innerHTML = `<span>${activeCurrencies[0].currency} 100%</span>`;
        } else {
            cashBreakdown.innerHTML = '';
        }
    }
    
    document.getElementById('periodPL').textContent = (perf.mtm >= 0 ? '+' : '') + formatCurrency(perf.mtm || 0, currentCurrency);
    document.getElementById('periodPLPct').textContent = formatPercent((perf.mtm / totalNav) * 100 || 0);
    document.getElementById('periodPLPct').className = (perf.mtm || 0) >= 0 ? 'change-positive' : 'change-negative';
    
    // 业绩摘要（所有数值都是 USD 基准）
    const realizedPL = perf.realized || 0;
    const unrealizedPL = perf.mtm || 0;
    const totalPL = perf.endingValue - perf.startingValue || 0;
    const dividends = perf.dividends || 0;
    const commissions = Math.abs(perf.commissions || 0);
    
    document.getElementById('realizedPL').textContent = (realizedPL >= 0 ? '+' : '') + formatCurrency(realizedPL, currentCurrency);
    document.getElementById('unrealizedPL').textContent = (unrealizedPL >= 0 ? '+' : '') + formatCurrency(unrealizedPL, currentCurrency);
    document.getElementById('totalPL').textContent = (totalPL >= 0 ? '+' : '') + formatCurrency(totalPL, currentCurrency);
    document.getElementById('totalPL').dataset.pct = formatPercent(perf.twr * 100 || 0);
    document.getElementById('dividendIncome').textContent = formatCurrency(dividends, currentCurrency);
    document.getElementById('commissionFees').textContent = formatCurrency(commissions, currentCurrency);
    document.getElementById('mtmMonth').textContent = '-' + formatCurrency(Math.abs(perf.mtm || 0), currentCurrency);
    
    // 资产分布
    renderCategoryBreakdown();
    
    // 期权到期提醒
    renderExpiryAlerts();
    
    // 持仓表格
    renderPositionsTable();
    
    // 净值图表
    renderNavChart();
    updateNavRangeSummary();
}

// 获取分类数据（供进度条和饼图复用）
function getCategories() {
    // 支持 IB 数据结构
    if (portfolioData.categoryBreakdown) {
        const result = {};
        for (const [name, data] of Object.entries(portfolioData.categoryBreakdown)) {
            result[name] = data.value;
        }
        return result;
    }
    
    // 从 IB 持仓数据计算分类
    const positions = portfolioData.openPositions || { stocks: [], etfs: [], options: [] };
    const categories = {};
    
    const chinaStocks = positions.stocks.filter(p => 
        ['XPEV', 'LI', 'BABA', 'XIACY', 'MPNGY', 'TCOM'].includes(p.symbol)
    );
    categories['中概股'] = chinaStocks.reduce((sum, p) => sum + (p.positionValue || p.marketValue || 0), 0);
    
    const indexETFs = positions.etfs.filter(p => 
        ['QQQ', 'QQQM', 'QQQI', 'SPY', 'SPYM', 'VOO'].includes(p.symbol)
    );
    categories['指数 ETF'] = indexETFs.reduce((sum, p) => sum + (p.positionValue || p.marketValue || 0), 0);
    
    const techStocks = positions.stocks.filter(p => 
        ['MU', 'MSFT', 'COIN', 'HY9H', 'SOXX'].includes(p.symbol)
    );
    categories['科技/半导体'] = techStocks.reduce((sum, p) => sum + (p.positionValue || p.marketValue || 0), 0);
    
    const cashEquivalents = positions.etfs.filter(p => 
        ['SGOV'].includes(p.symbol)
    );
    categories['现金等价物'] = cashEquivalents.reduce((sum, p) => sum + (p.positionValue || p.marketValue || 0), 0);
    
    categories['期权空头'] = positions.options.reduce((sum, p) => sum + (p.positionValue || p.marketValue || 0), 0);
    
    const allSymbols = [...chinaStocks, ...indexETFs, ...techStocks, ...cashEquivalents].map(p => p.symbol);
    const otherStocks = positions.stocks.filter(p => !allSymbols.includes(p.symbol));
    const otherETFs = positions.etfs.filter(p => !['SGOV', 'QQQ', 'QQQM', 'QQQI', 'SPY', 'SPYM', 'VOO'].includes(p.symbol));
    categories['其他'] = 
        otherStocks.reduce((sum, p) => sum + (p.positionValue || p.marketValue || 0), 0) +
        otherETFs.reduce((sum, p) => sum + (p.positionValue || p.marketValue || 0), 0);
    
    return categories;
}

// 渲染资产分布
function renderCategoryBreakdown() {
    const container = document.getElementById('categoryBreakdown');
    const categories = getCategories();
    const total = Object.values(categories).reduce((a, b) => a + Math.abs(b), 0);
    
    const categoryNames = {
        '中概股': '中概股',
        '指数 ETF': '指数 ETF',
        '科技/半导体': '科技/半导体',
        '现金等价物': '现金等价物',
        '期权空头': '期权空头',
        '其他': '其他'
    };
    
    let html = '';
    for (const [key, value] of Object.entries(categories)) {
        const pct = (value / total) * 100;
        const color = value < 0 ? '#fca5a5' : '#6366f1';
        html += `
            <div style="margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px; gap: 8px;">
                    <span style="font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${categoryNames[key] || key}</span>
                    <span style="font-size: 14px; font-weight: 600; white-space: nowrap;">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${Math.abs(pct)}%; background: ${color};"></div>
                </div>
                <div style="font-size: 12px; color: var(--gray); margin-top: 4px;">
                    $${formatNumber(Math.abs(value))}
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

// 解析 IB 期权数据（兼容旧格式）
function normalizeOption(opt) {
    if (opt.daysToExpiry !== undefined) return opt; // 已经是旧格式
    
    const desc = opt.description || '';
    const marketPrice = opt.markPrice || opt.marketPrice || 0;
    
    // 尝试从 description 解析，例如 "AVGO 18JUN26 400 P" 或 "LI 01MAY26 19.5 C"
    const match = desc.match(/(\d{2}[A-Z]{3}\d{2})\s+([\d\.]+)\s+([PC])$/i);
    let expiry = '';
    let strike = 0;
    let type = '';
    let daysToExpiry = 999;
    
    if (match) {
        const dateStr = match[1]; // 18JUN26
        strike = parseFloat(match[2]);
        type = match[3].toUpperCase() === 'P' ? 'Put' : 'Call';
        
        const monthMap = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
        const day = dateStr.substring(0, 2);
        const month = monthMap[dateStr.substring(2, 5).toUpperCase()] || '01';
        const year = '20' + dateStr.substring(5, 7);
        expiry = `${year}-${month}-${day}`;
        
        const expiryDate = new Date(expiry);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        daysToExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
        if (daysToExpiry < 0) daysToExpiry = 0;
    }
    
    // 盈亏平衡价（粗略估算）
    const breakEven = type === 'Put' ? (strike - marketPrice) : (strike + marketPrice);
    
    return {
        ...opt,
        symbol: opt.underlyingSymbol || opt.symbol.split(' ')[0] || opt.symbol,
        type: type || (opt.putCall === 'P' ? 'Put' : (opt.putCall === 'C' ? 'Call' : '')),
        strike: strike || opt.strike || 0,
        expiry: expiry || opt.expiry || '',
        daysToExpiry: daysToExpiry,
        marketPrice: marketPrice,
        breakEven: breakEven,
        inTheMoney: opt.inTheMoney || false
    };
}

// 渲染期权到期提醒
let currentExpiryFilter = 'all';
const MAX_DAYS = 365; // 最大参考天数（用于进度条计算）

function renderExpiryAlerts() {
    const container = document.getElementById('expiryAlerts');
    const rawOptions = portfolioData.openPositions?.options || [];
    
    if (rawOptions.length === 0) {
        container.innerHTML = '<div class="expiry-item" style="color: var(--gray); text-align: center; padding: 20px;">暂无期权持仓</div>';
        return;
    }
    
    // 标准化期权数据
    const options = rawOptions.map(normalizeOption);
    
    // 按到期日排序
    const sorted = [...options].sort((a, b) => a.daysToExpiry - b.daysToExpiry);
    
    // 筛选
    let filtered = sorted;
    const today = new Date();
    if (currentExpiryFilter === 'urgent') {
        filtered = sorted.filter(o => o.daysToExpiry <= 7);
    } else if (currentExpiryFilter === 'month') {
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const daysToEndOfMonth = Math.ceil((endOfMonth - today) / (1000 * 60 * 60 * 24));
        filtered = sorted.filter(o => o.daysToExpiry <= daysToEndOfMonth);
    }
    
    let html = '';
    
    // 表头
    html += `
        <div class="expiry-item header-row" style="background: var(--lighter-gray); font-weight: 600; font-size: 12px; color: var(--gray);">
            <div style="text-align: center;">天数</div>
            <div>标的</div>
            <div>类型</div>
            <div>详情</div>
            <div style="text-align: right;">行权价</div>
            <div style="text-align: right;">市值</div>
        </div>
    `;
    
    filtered.forEach(opt => {
        const isUrgent = opt.daysToExpiry <= 7;
        const itmClass = opt.inTheMoney ? 'itm' : 'otm';
        const itmText = opt.inTheMoney ? '实值' : '虚值';
        const typeClass = opt.type === 'Put' ? 'put' : 'call';
        
        // 计算进度条（剩余天数占比，越少越短）
        const progressPct = Math.min(opt.daysToExpiry / MAX_DAYS * 100, 100);
        const progressClass = opt.daysToExpiry <= 7 ? 'low' : (opt.daysToExpiry <= 30 ? 'mid' : 'high');
        
        const marketValue = opt.positionValue || opt.marketValue || 0;
        html += `
            <div class="expiry-item ${isUrgent ? 'urgent' : ''}">
                <div class="expiry-days-box">
                    <div class="expiry-days">${opt.daysToExpiry}天</div>
                </div>
                <div class="expiry-symbol">${opt.symbol}</div>
                <div><span class="expiry-type ${typeClass}">${opt.type}</span></div>
                <div class="expiry-info">
                    <div class="expiry-detail">到期：${opt.expiry}</div>
                    <div class="expiry-meta">
                        <span>现价：$${opt.marketPrice.toFixed(2)}</span>
                        <span>•</span>
                        <span>盈亏平衡：$${opt.breakEven.toFixed(2)}</span>
                        <span>•</span>
                        <span class="expiry-status ${itmClass}">${itmText}</span>
                    </div>
                </div>
                <div style="text-align: right;" class="expiry-strike">$${opt.strike.toFixed(0)}</div>
                <div style="text-align: right; font-size: 13px; font-weight: 500; color: ${marketValue >= 0 ? 'var(--success)' : 'var(--danger)'};">${formatCurrency(Math.abs(marketValue), currentCurrency)}</div>
                <div class="expiry-progress">
                    <div class="expiry-progress-bar ${progressClass}" style="width: ${progressPct}%;"></div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// 期权筛选事件
document.querySelectorAll('[data-expiry-filter]').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('[data-expiry-filter]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentExpiryFilter = tab.dataset.expiryFilter;
        renderExpiryAlerts();
    });
});

// 渲染持仓表格
function renderPositionsTable() {
    const tbody = document.getElementById('positionsBody');
    
    // 支持 IB 数据结构
    const stocks = portfolioData.openPositions.stocks || [];
    const etfs = portfolioData.openPositions.etfs || [];
    const options = portfolioData.openPositions.options || [];
    
    // 合并所有持仓（标准化期权数据以兼容 IB 格式）
    const allPositions = [
        ...stocks.map(p => ({...p, securityType: 'stock'})),
        ...etfs.map(p => ({...p, securityType: 'etf'})),
        ...options.map(p => ({...normalizeOption(p), securityType: 'option'}))
    ];
    
    // 筛选
    let filtered = allPositions;
    if (currentFilter === 'stock') {
        filtered = allPositions.filter(p => p.securityType === 'stock');
    } else if (currentFilter === 'etf') {
        filtered = allPositions.filter(p => p.securityType === 'etf');
    } else if (currentFilter === 'option') {
        filtered = allPositions.filter(p => p.securityType === 'option');
    } else if (currentFilter === 'china') {
        filtered = allPositions.filter(p => ['XPEV', 'LI', 'BABA', 'XIACY', 'MPNGY', 'TCOM'].includes(p.symbol));
    }
    
    // 分页
    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageData = filtered.slice(start, start + ITEMS_PER_PAGE);
    
    let html = '';
    pageData.forEach(p => {
        // IB 数据字段映射
        const marketValue = p.positionValue || p.marketValue || 0;
        const costBasis = p.costBasis || p.averageCost || 0;
        const marketPrice = p.markPrice || p.marketPrice || 0;
        const quantity = p.quantity || (marketValue / marketPrice) || 0;
        const unrealizedPL = p.unrealizedPL || (marketValue - costBasis) || 0;
        const unrealizedPLPct = p.unrealizedPLPct || ((unrealizedPL / costBasis) * 100) || 0;
        
        // 计算权重
        const totalValue = allPositions.reduce((sum, pos) => sum + Math.abs(pos.positionValue || pos.marketValue || 0), 0);
        const weight = (marketValue / totalValue) * 100 || 0;
        
        // 盈亏数据可能不存在（IB 原始数据缺少 costBasis/unrealizedPL）
        const hasPLData = p.unrealizedPL !== undefined || p.unrealizedPLPct !== undefined || p.costBasis !== undefined || p.averageCost !== undefined;
        const plClass = unrealizedPL >= 0 ? 'pl-positive' : 'pl-negative';
        
        const optionTypeCode = p.putCall || (p.type === 'Put' ? 'P' : (p.type === 'Call' ? 'C' : p.type));
        const badgeClass = p.securityType === 'option' 
            ? (optionTypeCode === 'P' ? 'badge-put' : 'badge-call')
            : (p.securityType === 'etf' ? 'badge-etf' : 'badge-stock');
        const typeLabel = p.securityType === 'option' 
            ? `${optionTypeCode} ${p.strike || ''}`
            : p.securityType.toUpperCase();
        
        html += `
            <tr>
                <td>
                    <div class="symbol-cell">
                        <div class="symbol-icon" style="background: ${getIconColor(p.symbol)}20; color: ${getIconColor(p.symbol)};">
                            ${p.symbol.substring(0, 2)}
                        </div>
                        <div class="symbol-info">
                            <div class="symbol-name">${p.symbol}</div>
                            <div class="symbol-desc">${p.description || ''}</div>
                        </div>
                    </div>
                </td>
                <td><span class="badge ${badgeClass}">${typeLabel}</span></td>
                <td>${quantity > 0 ? formatNumber(quantity) : '-'}</td>
                <td>${formatCurrency(costBasis > 0 ? costBasis : 0, currentCurrency)}</td>
                <td>${formatCurrency(marketPrice, currentCurrency)}</td>
                <td>${formatCurrency(Math.abs(marketValue), currentCurrency)}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div class="progress-bar" style="width: 100px; height: 6px;">
                            <div class="progress-fill" style="width: ${Math.min(Math.abs(weight), 100)}%;"></div>
                        </div>
                        <span style="font-size: 12px;">${weight.toFixed(1)}%</span>
                    </div>
                </td>
                <td class="${hasPLData ? plClass : ''}">
                    ${hasPLData ? `
                        <div style="font-weight: 600;">${unrealizedPL >= 0 ? '+' : ''}${formatCurrency(Math.abs(unrealizedPL), currentCurrency)}</div>
                        <div style="font-size: 12px;">${formatPercent(unrealizedPLPct)}</div>
                    ` : '<div style="color: var(--gray);">-</div>'}
                </td>
                <td>
                    ${p.securityType !== 'option' ? `
                        <button class="filter-tab" onclick="openKlineModal('${p.symbol}')" style="padding: 4px 8px; font-size: 12px;">
                            📈 K 线
                        </button>
                    ` : '-'}
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    
    // 分页
    renderPagination(totalPages);
}

// 渲染分页
function renderPagination(totalPages) {
    const container = document.getElementById('pagination');
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }
    container.innerHTML = html;
}

// 跳转页面
function goToPage(page) {
    currentPage = page;
    renderPositionsTable();
    const element = document.getElementById('positionsBody')?.closest('.content-card');
    if (element) {
        const navbarHeight = document.querySelector('.navbar')?.offsetHeight || 70;
        const top = element.getBoundingClientRect().top + window.pageYOffset - navbarHeight - 16;
        window.scrollTo({ top: top, behavior: 'smooth' });
    }
}

// 渲染净值图表
function renderNavChart() {
    const canvas = document.getElementById('navChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const history = portfolioData?.history?.[currentNavRange] || portfolioData?.history?.nav30Days || [];
    
    // 清空画布
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    const padding = 40;
    
    ctx.clearRect(0, 0, width, height);
    
    // 空数据保护
    if (history.length < 2) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无历史数据', width / 2, height / 2);
        return;
    }
    
    // 计算数据范围
    const values = history.map(h => h.nav);
    const minVal = Math.min(...values) * 0.995;
    const maxVal = Math.max(...values) * 1.005;
    
    // 绘制网格线
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding + (height - 2 * padding) * i / 4;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }
    
    // 绘制折线（黑色风格）
    const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.beginPath();
    history.forEach((h, i) => {
        const x = padding + (width - 2 * padding) * i / (history.length - 1);
        const y = height - padding - (h.nav - minVal) / (maxVal - minVal) * (height - 2 * padding);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // 填充区域
    ctx.lineTo(width - padding, height - padding);
    ctx.lineTo(padding, height - padding);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // 绘制数据点
    history.forEach((h, i) => {
        const x = padding + (width - 2 * padding) * i / (history.length - 1);
        const y = height - padding - (h.nav - minVal) / (maxVal - minVal) * (height - 2 * padding);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.fill();
    });
    
    // 绘制标签
    ctx.fillStyle = '#64748b';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    history.forEach((h, i) => {
        if (i % 5 === 0 || i === history.length - 1) {
            const x = padding + (width - 2 * padding) * i / (history.length - 1);
            ctx.fillText(formatDate(h.date), x, height - 15);
        }
    });
    
    // Y 轴标签
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const val = maxVal - (maxVal - minVal) * i / 4;
        const y = padding + (height - 2 * padding) * i / 4;
        ctx.fillText('$' + formatNumber(val / 1000) + 'K', padding - 10, y + 4);
    }
}

// 切换净值时间范围
function setNavRange(range) {
    currentNavRange = range;
    
    // 更新按钮样式
    document.querySelectorAll('.range-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === range);
    });
    
    renderNavChart();
    updateNavRangeSummary();
}

// 更新净值范围统计信息
function updateNavRangeSummary() {
    const el = document.getElementById('navRangeSummary');
    if (!el || !portfolioData?.rangeSummaries) return;
    
    const summary = portfolioData.rangeSummaries[currentNavRange];
    if (!summary || summary.days === 0) {
        el.innerHTML = '';
        return;
    }
    
    const gainClass = summary.gain >= 0 ? 'sum-positive' : 'sum-negative';
    const gainSign = summary.gain >= 0 ? '+' : '';
    
    el.innerHTML = `
        <span>${summary.days} 个交易日</span>
        <span class="${gainClass}">${gainSign}${formatCurrency(summary.gain, currentCurrency)}</span>
        <span class="${gainClass}">(${gainSign}${formatPercent(summary.gainPct)})</span>
    `;
}

// K 线图表
let klineChartInstance = null;

// 打开 K 线模态框
function openKlineModal(symbol) {
    currentKlineSymbol = symbol;
    document.getElementById('klineSymbol').textContent = symbol;
    document.getElementById('klineModal').classList.add('show');
    
    // 加载 K 线数据
    renderKlineChart('3mo');
}

// 关闭 K 线模态框
function closeKlineModal() {
    document.getElementById('klineModal').classList.remove('show');
}

// 渲染 K 线图表
function renderKlineChart(period) {
    if (!klineData || !klineData.symbols[currentKlineSymbol]) {
        console.log('无 K 线数据');
        return;
    }
    
    const klines = klineData.symbols[currentKlineSymbol];
    const canvas = document.getElementById('klineChart');
    const ctx = canvas.getContext('2d');
    
    // 设置 canvas 尺寸
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 60, bottom: 30, left: 10 };
    
    // 清空画布
    ctx.clearRect(0, 0, width, height);
    
    // 计算数据范围
    const prices = klines.map(k => k.close);
    const minPrice = Math.min(...prices) * 0.95;
    const maxPrice = Math.max(...prices) * 1.05;
    
    // 蜡烛图宽度
    const candleWidth = (width - padding.left - padding.right) / klines.length * 0.8;
    
    // 绘制 K 线
    klines.forEach((k, i) => {
        const x = padding.left + (width - padding.left - padding.right) * i / klines.length + candleWidth / 2;
        const openY = height - padding.bottom - (k.open - minPrice) / (maxPrice - minPrice) * (height - padding.top - padding.bottom);
        const closeY = height - padding.bottom - (k.close - minPrice) / (maxPrice - minPrice) * (height - padding.top - padding.bottom);
        const highY = height - padding.bottom - (k.high - minPrice) / (maxPrice - minPrice) * (height - padding.top - padding.bottom);
        const lowY = height - padding.bottom - (k.low - minPrice) / (maxPrice - minPrice) * (height - padding.top - padding.bottom);
        
        const isUp = k.close >= k.open;
        ctx.strokeStyle = isUp ? '#000000' : '#666666';
        ctx.fillStyle = isUp ? '#000000' : '#666666';
        
        // 影线
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();
        
        // 实体
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
        ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
    });
    
    // 绘制价格标签
    ctx.fillStyle = '#64748b';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
        const price = maxPrice - (maxPrice - minPrice) * i / 4;
        const y = padding.top + (height - padding.top - padding.bottom) * i / 4;
        ctx.fillText('$' + price.toFixed(0), width - padding.right + 5, y + 4);
    }
    
    // 更新技术指标
    const lastKline = klines[klines.length - 1];
    if (lastKline) {
        document.getElementById('ma5Value').textContent = lastKline.ma5 ? '$' + lastKline.ma5.toFixed(2) : '--';
        document.getElementById('ma10Value').textContent = lastKline.ma10 ? '$' + lastKline.ma10.toFixed(2) : '--';
        document.getElementById('ma20Value').textContent = lastKline.ma20 ? '$' + lastKline.ma20.toFixed(2) : '--';
        document.getElementById('ma60Value').textContent = lastKline.ma60 ? '$' + lastKline.ma60.toFixed(2) : '--';
    }
}

// K 线周期切换
document.querySelectorAll('.kline-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.kline-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (currentKlineSymbol) {
            renderKlineChart(btn.dataset.period);
        }
    });
});

// 顶部导航切换
let navPage = 'overview';

function switchPage(page) {
    navPage = page;
    
    // 更新导航按钮状态
    document.querySelectorAll('.nav-menu-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('href') === `#${page}` || 
            (page === 'overview' && item.textContent === '总览') ||
            (page === 'positions' && item.textContent === '持仓') ||
            (page === 'options' && item.textContent === '期权') ||
            (page === 'performance' && item.textContent === '业绩') ||
            (page === 'settings' && item.textContent === '设置')) {
            item.classList.add('active');
        }
    });
    
    // 隐藏所有页面容器
    document.querySelectorAll('.page-container').forEach(container => {
        if (container.id !== 'klineModal') {
            container.style.display = 'none';
        }
    });
    
    // 显示主仪表盘或期权历史页面
    if (page === 'optionHistory') {
        document.querySelector('.dashboard-container').style.display = 'none';
        document.getElementById('optionHistoryPage').style.display = 'block';
        renderOptionEaeTable();
        requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    } else {
        // 显示主仪表盘
        document.querySelector('.dashboard-container').style.display = 'block';
        document.getElementById('optionHistoryPage').style.display = 'none';
        
        // 滚动到对应区域
        const sectionMap = {
            'overview': 'top',
            'positions': 'positionsTable',
            'options': 'expiryAlerts',
            'performance': 'performanceSection',
            'settings': 'top'
        };
        
        const targetId = sectionMap[page] || 'top';
        if (targetId === 'top') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            const element = document.getElementById(targetId);
            if (element) {
                const navbarHeight = document.querySelector('.navbar')?.offsetHeight || 70;
                const top = element.getBoundingClientRect().top + window.pageYOffset - navbarHeight - 16;
                window.scrollTo({ top: top, behavior: 'smooth' });
            }
        }
    }
}

// 绑定导航事件
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM 加载完成');
    
    // 加载账户配置
    loadAccountsConfig();
    
    // 导航菜单点击
    document.querySelectorAll('.nav-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const href = item.getAttribute('href');
            console.log('导航点击:', href);
            if (href === '#positions') switchPage('positions');
            else if (href === '#options') switchPage('options');
            else if (href === '#performance') switchPage('performance');
            else if (href === '#settings') switchPage('settings');
            else if (href === '#optionHistory') switchPage('optionHistory');
            else switchPage('overview');
        });
    });
    
    // 货币切换
    document.querySelectorAll('.currency-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.currency-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCurrency = btn.dataset.currency;
            renderDashboard();
        });
    });
    
    // 筛选标签
    document.querySelectorAll('#positionFilters .filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#positionFilters .filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            currentPage = 1;
            renderPositionsTable();
            const element = document.getElementById('positionsBody')?.closest('.content-card');
            if (element) {
                const navbarHeight = document.querySelector('.navbar')?.offsetHeight || 70;
                const top = element.getBoundingClientRect().top + window.pageYOffset - navbarHeight - 16;
                window.scrollTo({ top: top, behavior: 'smooth' });
            }
        });
    });
    
    // 移动端导航
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.mobile-nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
    });
    
    // 加载数据
    console.log('开始加载数据...');
    loadData();
});

// 窗口大小变化时重绘图表
window.addEventListener('resize', () => {
    if (portfolioData) renderNavChart();
    if (currentKlineSymbol) renderKlineChart('3mo');
});

// ========== 期权历史表格 ==========
let currentEaeFilter = 'all';

function renderOptionEaeTable() {
    const tbody = document.getElementById('optionEaeBody');
    const countSpan = document.getElementById('optionEaeCount');
    
    if (!portfolioData || !portfolioData.optionEAE) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--gray);">暂无期权事件数据</td></tr>';
        countSpan.textContent = '0';
        return;
    }
    
    const allEvents = portfolioData.optionEAE;
    
    // 筛选
    let filtered = allEvents;
    if (currentEaeFilter !== 'all') {
        filtered = allEvents.filter(e => e.transactionType === currentEaeFilter);
    }
    
    // 按日期排序（最新的在前）
    filtered.sort((a, b) => b.date.localeCompare(a.date));
    
    countSpan.textContent = filtered.length;
    
    let html = '';
    filtered.forEach(event => {
        const dateFormatted = formatIBDate(event.date);
        const expiryFormatted = event.expiry ? formatIBDate(event.expiry) : '-';
        const typeClass = event.transactionType || '';
        const underlying = event.underlyingSymbol || event.symbol || '-';
        const strike = event.strike > 0 ? `$${event.strike.toFixed(0)}` : '-';
        const putCall = event.putCall ? (event.putCall === 'P' ? 'PUT' : 'CALL') : '';
        const typeLabel = putCall ? `${typeClass} ${putCall}` : typeClass;
        
        // 市值盈亏（IB 数据中期权事件的 mtmPnl 是已实现盈亏）
        const realizedPnl = event.mtmPnl || 0;
        const marketPnl = event.mtmPnl || 0;
        const pnlClass = realizedPnl >= 0 ? 'pl-positive' : 'pl-negative';
        
        html += `
            <tr>
                <td style="font-family: monospace;">${dateFormatted}</td>
                <td style="font-weight: 600;">${underlying}</td>
                <td><span class="transaction-type ${typeClass}">${typeLabel}</span></td>
                <td>${formatNumber(Math.abs(event.quantity || 0))}</td>
                <td>${strike}</td>
                <td style="font-family: monospace;">${expiryFormatted}</td>
                <td style="color: var(--gray);">$0</td>
                <td class="${pnlClass}" style="font-weight: 600;">
                    ${marketPnl >= 0 ? '+' : ''}$${formatNumber(Math.abs(marketPnl))}
                </td>
            </tr>
        `;
    });
    
    if (filtered.length === 0) {
        html = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--gray);">暂无数据</td></tr>';
    }
    
    tbody.innerHTML = html;
}

// 期权历史筛选事件
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-eae-filter]').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('[data-eae-filter]').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentEaeFilter = tab.dataset.eaeFilter;
            renderOptionEaeTable();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
});
