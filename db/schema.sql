-- IB Dashboard SaaS PostgreSQL Schema
-- Multi-tenant design with incremental cost-basis support

-- ------------------------------------------------------------------
-- 1. Users & Profiles
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    last_login_ip TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tier TEXT DEFAULT 'free', -- free, pro, admin
    display_name TEXT,
    base_currency TEXT DEFAULT 'USD',
    fx_overrides JSONB DEFAULT '{}',
    retention_days INT DEFAULT 30,
    max_accounts INT DEFAULT 99,
    max_history_months INT DEFAULT 99999,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------
-- 2. User-linked IBKR Accounts
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL, -- e.g. U12672188
    label TEXT,
    color TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, account_id)
);

-- ------------------------------------------------------------------
-- 3. XML Upload Audit
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS xml_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_md5 TEXT NOT NULL,
    storage_path TEXT,
    stmt_date DATE,
    account_id TEXT,
    rows_inserted INT DEFAULT 0,
    status TEXT DEFAULT 'pending', -- pending, running, done, failed
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_xml_uploads_user ON xml_uploads(user_id, created_at DESC);

-- ------------------------------------------------------------------
-- 4. Core Dashboard Tables (multi-tenant)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_nav (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    date DATE NOT NULL,
    starting_value NUMERIC,
    ending_value NUMERIC,
    mtm NUMERIC,
    realized NUMERIC,
    dividends NUMERIC,
    interest NUMERIC,
    commissions NUMERIC,
    twr NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, account_id, date)
);

CREATE TABLE IF NOT EXISTS positions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    date DATE NOT NULL,
    symbol TEXT NOT NULL,
    description TEXT,
    asset_type TEXT,
    position_value NUMERIC,
    mark_price NUMERIC,
    PRIMARY KEY (user_id, account_id, date, symbol)
);

CREATE TABLE IF NOT EXISTS option_eae (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    date DATE NOT NULL,
    symbol TEXT NOT NULL,
    description TEXT,
    underlying_symbol TEXT,
    strike NUMERIC,
    expiry TEXT,
    put_call TEXT,
    transaction_type TEXT NOT NULL,
    quantity NUMERIC,
    trade_price NUMERIC,
    mark_price NUMERIC,
    mtm_pnl NUMERIC,
    currency TEXT,
    PRIMARY KEY (user_id, account_id, date, symbol, transaction_type)
);

CREATE TABLE IF NOT EXISTS cash_report (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    date DATE NOT NULL,
    currency TEXT NOT NULL,
    cash NUMERIC,
    PRIMARY KEY (user_id, account_id, date, currency)
);

-- ------------------------------------------------------------------
-- 5. Archive Tables (multi-tenant mirrors of IBKR XML nodes)
-- ------------------------------------------------------------------
-- These tables mirror whatever the XML parser discovers.
-- We create the most common ones explicitly; the parser can create
-- missing archive_* tables dynamically or we can pre-define them.

CREATE TABLE IF NOT EXISTS archive_trade (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    account_id TEXT,
    accrued_int TEXT,
    acct_alias TEXT,
    asset_category TEXT,
    brokerage_order_id TEXT,
    buy_sell TEXT,
    change_in_price TEXT,
    change_in_quantity TEXT,
    clearing_firm_id TEXT,
    close_price TEXT,
    commodity_type TEXT,
    conid TEXT,
    cost TEXT,
    currency TEXT,
    cusip TEXT,
    date_time TEXT,
    delivery_type TEXT,
    description TEXT,
    exch_order_id TEXT,
    exchange TEXT,
    expiry TEXT,
    ext_exec_id TEXT,
    fifo_pnl_realized TEXT,
    figi TEXT,
    fineness TEXT,
    fx_rate_to_base TEXT,
    holding_period_date_time TEXT,
    ib_commission TEXT,
    ib_commission_currency TEXT,
    ib_exec_id TEXT,
    ib_order_id TEXT,
    initial_investment TEXT,
    is_api_order TEXT,
    isin TEXT,
    issuer TEXT,
    issuer_country_code TEXT,
    level_of_detail TEXT,
    listing_exchange TEXT,
    model TEXT,
    mtm_pnl TEXT,
    multiplier TEXT,
    net_cash TEXT,
    notes TEXT,
    open_close_indicator TEXT,
    open_date_time TEXT,
    order_reference TEXT,
    order_time TEXT,
    order_type TEXT,
    orig_order_id TEXT,
    orig_trade_date TEXT,
    orig_trade_id TEXT,
    orig_trade_price TEXT,
    orig_transaction_id TEXT,
    position_action_id TEXT,
    principal_adjust_factor TEXT,
    proceeds TEXT,
    put_call TEXT,
    quantity TEXT,
    related_trade_id TEXT,
    related_transaction_id TEXT,
    report_date TEXT,
    rtn TEXT,
    security_id TEXT,
    security_id_type TEXT,
    serial_number TEXT,
    settle_date_target TEXT,
    strike TEXT,
    sub_category TEXT,
    symbol TEXT,
    taxes TEXT,
    trade_date TEXT,
    trade_id TEXT,
    trade_money TEXT,
    trade_price TEXT,
    trader_id TEXT,
    transaction_id TEXT,
    transaction_type TEXT,
    underlying_conid TEXT,
    underlying_listing_exchange TEXT,
    underlying_security_id TEXT,
    underlying_symbol TEXT,
    volatility_order_link TEXT,
    weight TEXT,
    when_realized TEXT,
    when_reopened TEXT
);
CREATE INDEX idx_archive_trade_pk ON archive_trade(user_id, stmt_date, symbol, trade_date, trade_id);
CREATE INDEX idx_archive_trade_unique ON archive_trade(user_id, stmt_date, symbol, date_time, buy_sell, quantity);

CREATE TABLE IF NOT EXISTS archive_option_eae (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    account_id TEXT,
    acct_alias TEXT,
    asset_category TEXT,
    commisions_and_tax TEXT,
    commodity_type TEXT,
    conid TEXT,
    cost_basis TEXT,
    currency TEXT,
    cusip TEXT,
    date TEXT,
    delivery_type TEXT,
    description TEXT,
    expiry TEXT,
    figi TEXT,
    fineness TEXT,
    fx_pnl TEXT,
    fx_rate_to_base TEXT,
    isin TEXT,
    issuer TEXT,
    issuer_country_code TEXT,
    listing_exchange TEXT,
    mark_price TEXT,
    model TEXT,
    mtm_pnl TEXT,
    multiplier TEXT,
    principal_adjust_factor TEXT,
    proceeds TEXT,
    put_call TEXT,
    quantity TEXT,
    realized_pnl TEXT,
    security_id TEXT,
    security_id_type TEXT,
    serial_number TEXT,
    strike TEXT,
    sub_category TEXT,
    symbol TEXT,
    trade_id TEXT,
    trade_price TEXT,
    transaction_type TEXT,
    underlying_conid TEXT,
    underlying_listing_exchange TEXT,
    underlying_security_id TEXT,
    underlying_symbol TEXT,
    weight TEXT
);
CREATE INDEX idx_archive_option_eae_pk ON archive_option_eae(user_id, stmt_date, symbol, transaction_type);
CREATE INDEX idx_archive_option_eae_unique ON archive_option_eae(user_id, stmt_date, underlying_symbol, date, symbol, transaction_type, quantity);

CREATE TABLE IF NOT EXISTS archive_open_position (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    account_id TEXT,
    accrued_int TEXT,
    acct_alias TEXT,
    asset_category TEXT,
    code TEXT,
    commodity_type TEXT,
    conid TEXT,
    cost_basis_money TEXT,
    cost_basis_price TEXT,
    currency TEXT,
    cusip TEXT,
    delivery_type TEXT,
    description TEXT,
    expiry TEXT,
    fifo_pnl_unrealized TEXT,
    figi TEXT,
    fineness TEXT,
    fx_rate_to_base TEXT,
    holding_period_date_time TEXT,
    isin TEXT,
    issuer TEXT,
    issuer_country_code TEXT,
    level_of_detail TEXT,
    listing_exchange TEXT,
    mark_price TEXT,
    model TEXT,
    multiplier TEXT,
    open_date_time TEXT,
    open_price TEXT,
    originating_order_id TEXT,
    originating_transaction_id TEXT,
    percent_of_nav TEXT,
    position TEXT,
    position_value TEXT,
    principal_adjust_factor TEXT,
    put_call TEXT,
    report_date TEXT,
    security_id TEXT,
    security_id_type TEXT,
    serial_number TEXT,
    side TEXT,
    strike TEXT,
    sub_category TEXT,
    symbol TEXT NOT NULL,
    underlying_conid TEXT,
    underlying_listing_exchange TEXT,
    underlying_security_id TEXT,
    underlying_symbol TEXT,
    vesting_date TEXT,
    weight TEXT
);
CREATE INDEX idx_archive_open_position_pk ON archive_open_position(user_id, stmt_date, symbol);

CREATE TABLE IF NOT EXISTS archive_transfer (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    account_id TEXT,
    acct_alias TEXT,
    asset_category TEXT,
    code TEXT,
    commodity_type TEXT,
    conid TEXT,
    cost_basis_money TEXT,
    currency TEXT,
    cusip TEXT,
    date TEXT,
    delivery_type TEXT,
    description TEXT,
    direction TEXT,
    figi TEXT,
    fineness TEXT,
    fx_rate_to_base TEXT,
    isin TEXT,
    issuer TEXT,
    issuer_country_code TEXT,
    level_of_detail TEXT,
    listing_exchange TEXT,
    model TEXT,
    multiplier TEXT,
    notes TEXT,
    open_date_time TEXT,
    position_amount TEXT,
    position_type TEXT,
    principal_adjust_factor TEXT,
    put_call TEXT,
    quantity TEXT,
    report_date TEXT,
    security_id TEXT,
    security_id_type TEXT,
    serial_number TEXT,
    side TEXT,
    strike TEXT,
    sub_category TEXT,
    symbol TEXT,
    trade_id TEXT,
    transaction_id TEXT,
    transaction_type TEXT,
    type TEXT,
    underlying_conid TEXT,
    underlying_listing_exchange TEXT,
    underlying_security_id TEXT,
    underlying_symbol TEXT,
    when_realized TEXT
);
CREATE INDEX idx_archive_transfer_pk ON archive_transfer(user_id, stmt_date, symbol, date, direction, quantity);

CREATE TABLE IF NOT EXISTS archive_cash_report_currency (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    account_id TEXT,
    acct_alias TEXT,
    cash_balance TEXT,
    currency TEXT NOT NULL,
    ending_cash TEXT,
    ending_settled_cash TEXT,
    report_date TEXT,
    starting_cash TEXT,
    starting_settled_cash TEXT,
    total TEXT
);
CREATE INDEX idx_archive_cash_report_currency_pk ON archive_cash_report_currency(user_id, stmt_date, currency);

CREATE TABLE IF NOT EXISTS archive_change_in_nav (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    account_id TEXT,
    acct_alias TEXT,
    commissions TEXT,
    dividends TEXT,
    ending_value TEXT,
    interest TEXT,
    mtm TEXT,
    realized TEXT,
    starting_value TEXT,
    twr TEXT
);
CREATE INDEX idx_archive_change_in_nav_pk ON archive_change_in_nav(user_id, stmt_date);

CREATE TABLE IF NOT EXISTS archive_statement_of_funds_line (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    account_id TEXT,
    acct_alias TEXT,
    activity_code TEXT,
    asset_category TEXT,
    currency TEXT,
    date TEXT,
    description TEXT,
    quantity TEXT,
    symbol TEXT,
    trade_id TEXT,
    transaction_id TEXT,
    type TEXT
);
CREATE INDEX idx_archive_statement_of_funds_line_pk ON archive_statement_of_funds_line(user_id, stmt_date, date, symbol, type, transaction_id);

CREATE TABLE IF NOT EXISTS archive_corporate_action (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    account_id TEXT,
    acct_alias TEXT,
    action_description TEXT,
    action_id TEXT,
    amount TEXT,
    asset_category TEXT,
    code TEXT,
    commodity_type TEXT,
    conid TEXT,
    cost_basis TEXT,
    currency TEXT,
    cusip TEXT,
    date_time TEXT,
    delivery_type TEXT,
    description TEXT,
    expiry TEXT,
    fifo_pnl_realized TEXT,
    figi TEXT,
    fineness TEXT,
    isin TEXT,
    issuer TEXT,
    issuer_country_code TEXT,
    listing_exchange TEXT,
    multiplier TEXT,
    principal_adjust_factor TEXT,
    proceeds TEXT,
    put_call TEXT,
    quantity TEXT,
    security_id TEXT,
    security_id_type TEXT,
    serial_number TEXT,
    strike TEXT,
    sub_category TEXT,
    symbol TEXT,
    transaction_id TEXT,
    transaction_type TEXT,
    underlying_conid TEXT,
    underlying_listing_exchange TEXT,
    underlying_security_id TEXT,
    underlying_symbol TEXT,
    when_realized TEXT,
    when_reopened TEXT
);
CREATE INDEX idx_archive_corporate_action_pk ON archive_corporate_action(user_id, stmt_date, symbol, date_time, transaction_id);

CREATE TABLE IF NOT EXISTS archive_mtm_performance_summary_underlying (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    account_id TEXT,
    acct_alias TEXT,
    asset_category TEXT,
    close_price TEXT,
    cost_basis_money TEXT,
    cost_basis_price TEXT,
    currency TEXT,
    description TEXT,
    fifo_pnl_unrealized TEXT,
    mtm_pnl TEXT,
    multiplier TEXT,
    orig_closing_price TEXT,
    position TEXT,
    position_value TEXT,
    prior_close_price TEXT,
    prior_position TEXT,
    prior_position_value TEXT,
    realized_pnl TEXT,
    symbol TEXT,
    underlying_conid TEXT
);
CREATE INDEX idx_archive_mtm_performance_summary_underlying_pk ON archive_mtm_performance_summary_underlying(user_id, stmt_date, symbol);

CREATE TABLE IF NOT EXISTS archive_net_stock_position (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    account_id TEXT,
    acct_alias TEXT,
    asset_category TEXT,
    currency TEXT,
    description TEXT,
    isin TEXT,
    issuer TEXT,
    issuer_country_code TEXT,
    listing_exchange TEXT,
    mark_price TEXT,
    multiplier TEXT,
    position TEXT,
    position_value TEXT,
    symbol TEXT
);
CREATE INDEX idx_archive_net_stock_position_pk ON archive_net_stock_position(user_id, stmt_date, symbol);

CREATE TABLE IF NOT EXISTS archive_prior_period_position (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    account_id TEXT,
    acct_alias TEXT,
    asset_category TEXT,
    commodity_type TEXT,
    conid TEXT,
    currency TEXT,
    cusip TEXT,
    date TEXT,
    delivery_type TEXT,
    description TEXT,
    expiry TEXT,
    figi TEXT,
    fineness TEXT,
    isin TEXT,
    issuer TEXT,
    issuer_country_code TEXT,
    listing_exchange TEXT,
    mark_price TEXT,
    model TEXT,
    multiplier TEXT,
    open_date_time TEXT,
    open_price TEXT,
    price TEXT,
    prior_mtm_pnl TEXT,
    principal_adjust_factor TEXT,
    put_call TEXT,
    security_id TEXT,
    security_id_type TEXT,
    serial_number TEXT,
    strike TEXT,
    sub_category TEXT,
    symbol TEXT,
    underlying_conid TEXT,
    underlying_listing_exchange TEXT,
    underlying_security_id TEXT,
    underlying_symbol TEXT,
    vesting_date TEXT,
    weight TEXT
);
CREATE INDEX idx_archive_prior_period_position_pk ON archive_prior_period_position(user_id, stmt_date, symbol);

CREATE TABLE IF NOT EXISTS archive_conversion_rate (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stmt_date DATE NOT NULL,
    stmt_account_id TEXT,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate TEXT,
    report_date TEXT
);
CREATE INDEX idx_archive_conversion_rate_pk ON archive_conversion_rate(user_id, stmt_date, from_currency, to_currency);

-- ------------------------------------------------------------------
-- 6. Incremental Cost Basis Snapshot
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_basis_snapshots (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    total_qty NUMERIC DEFAULT 0,
    total_cost_avg NUMERIC DEFAULT 0,      -- Moving Weighted Average total cost
    total_cost_diluted NUMERIC DEFAULT 0,  -- Diluted Cost Basis total cost
    last_trade_date DATE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, account_id, symbol)
);

CREATE INDEX idx_cost_basis_user ON cost_basis_snapshots(user_id, account_id);

-- ------------------------------------------------------------------
-- 7. Cost Basis History (optional, for rollback/debug)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_basis_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    total_qty NUMERIC,
    total_cost_avg NUMERIC,
    total_cost_diluted NUMERIC,
    trade_date DATE,
    event_type TEXT, -- BUY, SELL, ASSIGNMENT, TRANSFER
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cost_basis_history_lookup ON cost_basis_history(user_id, account_id, symbol, trade_date);

-- ------------------------------------------------------------------
-- 8. Import Audit & Schema Meta
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _schema_meta (
    tag_name TEXT PRIMARY KEY,
    table_name TEXT,
    attributes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------
-- 9. Admin Audit Logs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target_type TEXT, -- user, upload, config, system
    target_id TEXT,
    details JSONB DEFAULT '{}',
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_admin_audit_logs_admin ON admin_audit_logs(admin_id, created_at DESC);
CREATE INDEX idx_admin_audit_logs_target ON admin_audit_logs(target_type, target_id, created_at DESC);

-- ------------------------------------------------------------------
-- 10. FlexQuery Credentials & Sync Logs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_flex_credentials (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    query_id TEXT NOT NULL,
    token_encrypted TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    auto_sync BOOLEAN DEFAULT FALSE,
    last_sync_at TIMESTAMPTZ,
    last_sync_status TEXT,
    last_sync_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flex_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL, -- running, done, failed, cancelled
    message TEXT,
    rows_inserted INT DEFAULT 0,
    account_id TEXT,
    upload_id UUID REFERENCES xml_uploads(id) ON DELETE SET NULL,
    job_id TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX idx_flex_sync_logs_user ON flex_sync_logs(user_id, started_at DESC);

-- ------------------------------------------------------------------
-- 11. Indexes for common queries
-- ------------------------------------------------------------------
CREATE INDEX idx_archive_trade_user_account ON archive_trade(user_id, account_id);
CREATE INDEX idx_archive_trade_user_symbol ON archive_trade(user_id, symbol, trade_date);
CREATE INDEX idx_archive_option_eae_user_underlying ON archive_option_eae(user_id, underlying_symbol, date);
CREATE INDEX idx_archive_open_position_user_account ON archive_open_position(user_id, stmt_account_id);
CREATE INDEX idx_daily_nav_user_account ON daily_nav(user_id, account_id, date);
CREATE INDEX idx_positions_user_account ON positions(user_id, account_id, date);
CREATE INDEX idx_option_eae_user_account ON option_eae(user_id, account_id, date);
CREATE INDEX idx_cash_report_user_account ON cash_report(user_id, account_id, date);

-- Real-time market prices from external data sources (Finnhub / Yahoo)
CREATE TABLE IF NOT EXISTS market_prices (
    user_id uuid,
    symbol text NOT NULL,
    price numeric,
    updated_at timestamp with time zone DEFAULT NOW(),
    source text,
    PRIMARY KEY (user_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_market_prices_user ON market_prices(user_id);

-- ------------------------------------------------------------------
-- Share Links (公开分享面板)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    allowed_tabs TEXT[] DEFAULT ARRAY['overview'],
    account_id TEXT DEFAULT 'combined',
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_share_links_token ON share_links(token);
CREATE INDEX idx_share_links_user ON share_links(user_id, created_at DESC);

-- ------------------------------------------------------------------
-- User Notifications (Telegram)
-- ------------------------------------------------------------------
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT,
    ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
    ADD COLUMN IF NOT EXISTS report_schedule TEXT DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS option_alert_days JSONB DEFAULT '[7,3,1]';

CREATE TABLE IF NOT EXISTS user_notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- 'option_alert', 'weekly_report', 'monthly_report'
    payload JSONB,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_notif_logs_user_type ON user_notification_logs(user_id, type, sent_at);
