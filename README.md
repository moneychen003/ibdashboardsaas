# IB Dashboard

SaaS 版 IB 投资组合看板，支持多账户、多租户、IB FlexQuery 自动同步。

---

## 技术栈

- **后端**: Python 3.11 + Flask + Gunicorn
- **数据库**: PostgreSQL 15
- **缓存/队列**: Redis
- **前端**: React + Vite
- **任务队列**: RQ (Redis Queue)
- **代理（可选）**: Clash Meta (Docker)

---

## 本地开发（macOS）

### 1. 安装依赖

```bash
cd ib_dashboard
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cd web
npm install
```

### 2. 启动 PostgreSQL & Redis

确保本地已安装并启动服务：

```bash
brew services start postgresql@15
brew services start redis
```

创建数据库：

```bash
createdb ib_dashboard
psql -d ib_dashboard -f db/schema.sql
```

### 3. 启动开发服务器

**前端（端口 5173）**

```bash
cd web
npm run dev
```

**后端（端口 8080）**

```bash
cd ib_dashboard
source .venv/bin/activate
python server_saas.py
```

**RQ Worker（后台任务）**

```bash
cd ib_dashboard
source .venv/bin/activate
rq worker --url redis://localhost:6379/0
```

### 4. 本地访问

打开浏览器访问 `http://localhost:5173`（前端 DevServer 会代理 API 到 8080）。

---

## NAS 生产部署（Debian / Linux）

### 环境信息

- **NAS IP**: `192.168.68.117`
- **域名**: `https://ib.moneychen.com`（通过 Cloudflare Tunnel）
- **后端端口**: `1995`（Gunicorn）
- **数据库**: PostgreSQL 15 @ `localhost:5432`
- **缓存**: Redis @ `localhost:6379`
- **代理**: Clash Meta @ `localhost:7890`

### 1. 初始化数据库

```bash
sudo -u postgres psql -c "CREATE DATABASE ib_dashboard;"
sudo -u postgres psql -d ib_dashboard -f /home/moneychen/ib_dashboard/db/schema.sql
```

### 2. 安装 Python 依赖

```bash
cd /home/moneychen/ib_dashboard
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. 编译前端静态资源

```bash
cd /home/moneychen/ib_dashboard/web
npm install
npm run build
```

### 4. Gunicorn 启动

```bash
cd /home/moneychen/ib_dashboard
source .venv/bin/activate
gunicorn -w 2 -b 0.0.0.0:1995 --timeout 120 server_saas:app
```

### 5. Systemd 服务（已配置）

已注册两个 systemd 服务并 `enable`：

- **`ib-dashboard.service`** — Gunicorn Web 服务
- **`ib-dashboard-worker.service`** — RQ Worker

管理命令：

```bash
sudo systemctl restart ib-dashboard.service
sudo systemctl restart ib-dashboard-worker.service
sudo systemctl status ib-dashboard.service
```

### 6. Cloudflare Tunnel 域名配置

使用已有的 `nas-tunnel`（Tunnel ID: `2d63cb9c-...`）。

在 Cloudflare Zero Trust Dashboard → Networks → Tunnels → `nas-tunnel` → **Public Hostname** 中添加：

- **Subdomain**: `ib`
- **Domain**: `moneychen.com`
- **Type**: HTTP
- **URL**: `localhost:1995`

NAS 本地 `/etc/cloudflared/config.yml` 已包含对应 ingress 规则。

### 7. Clash 代理（用于 IB FlexQuery）

IB Flex Web Service 在中国大陆访问可能超时，NAS 上部署了 Clash 容器作为出站代理。

**代理地址**: `http://127.0.0.1:7890`
**Web 面板**: `http://192.168.68.117:9090/ui/`

管理：

```bash
cd ~/clash
docker compose restart
docker logs clash -f
```

后端代码已配置 `IB_PROXIES = {"http": "http://127.0.0.1:7890", ...}`，自动对 IB API 请求走代理。

---

## 已知问题与修复记录

### 1. `positions` 表缺失列导致导入失败

**现象**: 自动同步/上传 XML 后显示 `Import failed`

**原因**: `positions` 表缺少 `position_value_in_base` 和 `mark_price_in_base`

**修复**:

```sql
ALTER TABLE positions
ADD COLUMN IF NOT EXISTS position_value_in_base numeric,
ADD COLUMN IF NOT EXISTS mark_price_in_base numeric;
```

### 2. Dashboard 500：`no such column: currency`

**现象**: 数据导入成功后，打开看板显示 `数据加载失败 HTTP 500`

**原因**: `sqlite_to_dashboard.py` 的 `get_fx_rates` 直接从 `archive_account_information` 读取 `currency`，但部分 IB XML 里该表没有这个字段。

**修复**: 在 `scripts/sqlite_to_dashboard.py` 中增加 `_get_base_currency` 兼容函数，优先读 `archive_account_information`，fallback 到 `archive_equity_summary_by_report_date_in_base`。

### 3. 历史数据只有 65 天

**现象**: 明明上传了几百天的 XML，但 NAV 只显示最近几十天

**原因**: `utils/quotas.py` 中免费用户默认 `max_history_months = 3`，每次导入后会自动清理 3 个月前的数据。

**修复**: 将 `max_history_months` 默认值改为 `99999`（或在数据库里针对具体用户修改）：

```sql
UPDATE user_profiles SET max_history_months = 99999 WHERE user_id = 'YOUR_USER_ID';
```

### 4. Worker 报错被吞成 "Import failed"

**原因**: `workers/jobs.py` 读取错误时只检查了 `result['error']`，但实际字段是 `error_message`。

**修复**: 将 `msg = result.get('error') or result.get('message') or 'Import failed'` 改为同时读取 `error_message`。

### 5. 游客切换 Tab 无反应 / Demo 数据空白

**现象**: 未登录游客可以看到所有导航标签，但点击「持仓 / 业绩 / 明细 / 变动」后页面没切换，或切换后显示大量空白。

**原因**（两层）：
1. **前端路由**: `App.jsx` 在同步 URL Tab 参数时加了 `if (!accounts.length) return;`，游客 `accounts` 为空导致 `activeTab` 永远卡在 `overview`。
2. **后端切片**: `_slice_payload` 按 `DASHBOARD_SLICES` 过滤 Demo 数据，导致不同 Tab 拿到的字段被截断；例如 `positions` slice 里没有 `summary`，`performance` slice 里没有 `trades` / `metrics`。

**修复**:
- 前端：移除 `accounts.length` 判断，URL Tab 无条件同步到 store；同时修复 `loadOverview` 覆盖式 set 造成的并发竞态。
- 后端：`_slice_payload` 对 `isDemo: true` 的 payload 直接返回完整 JSON，不再切片。
- Demo 数据：给 `demo_dashboard.json` 补全了原本为空的示例字段（benchmarks、leverageMetrics、mtmPerformanceSummary、tradingHeatmap、tradeRankings、washSaleAlerts、orderExecution.fills、positionChanges.changes、changeInNavDetails、taxSummary、cashflowWaterfall、corporateActionImpact.events、feeErosion.byMonth 等）。

---

## 目录结构

```
ib_dashboard/
├── server_saas.py          # Flask 后端入口
├── workers/
│   ├── jobs.py             # RQ 后台任务（导入、FlexQuery 同步）
├── scripts/
│   ├── xml_to_postgres.py  # XML 导入器
│   ├── sqlite_to_dashboard.py  # Dashboard JSON 生成器（SQLite 桥接）
│   ├── postgres_to_dashboard.py  # PG → 临时 SQLite → JSON
│   ├── auto_sync.py        # 定时自动同步脚本
│   └── generate_dashboards.py
├── db/
│   ├── schema.sql          # PostgreSQL 建表脚本
│   └── postgres_client.py  # DB 连接封装
├── web/                    # React 前端
│   ├── src/
│   └── dist/               # 生产构建产物
└── uploads/                # 上传的 XML / Flex 同步文件
```

---

## 常用命令

### 重新导入某用户全部 XML

```bash
cd /home/moneychen/ib_dashboard
source .venv/bin/activate
python3 reimport_all.py
```

### 手动触发 FlexQuery 同步（测试用）

```bash
cd /home/moneychen/ib_dashboard
source .venv/bin/activate
python3 -c "
from workers.jobs import flex_sync_job
print(flex_sync_job('YOUR_USER_ID'))
"
```

### 查看 RQ 队列状态

```bash
rq info --url redis://localhost:6379/0
```

---

## 实时行情刷新（Finnhub + Yahoo）

### 原理

- 系统每 **30 分钟** 自动从 **Finnhub** 拉取持仓中股票/ETF 的实时报价（free tier: 60 calls/minute）
- Finnhub 找不到的 symbol 自动 fallback 到 **Yahoo Finance** (`yfinance`)
- 期权、债券类 symbol 会被过滤，不参与实时刷新
- 价格写入 `market_prices` 表，Dashboard 生成时优先用实时价覆盖 XML 中的 `mark_price` 和 `position_value`

### 本地开发启动时

`server_saas.py` 的 `if __name__ == '__main__':` 块会自动启动 `BackgroundScheduler`：

```
📈 Market data scheduler started (every 30 min)
```

### 生产环境（NAS）

Gunicorn 多 worker 不会执行 `__main__` 块，所以不会重复启动 scheduler。推荐用 **systemd timer** 或 **cron** 代替：

```bash
# /etc/cron.d/ib-market-data
*/30 * * * * cd /home/moneychen/ib_dashboard && source .venv/bin/activate && python3 -c "from scripts.market_data import scheduled_update_all; scheduled_update_all()" >> /tmp/ib_market.log 2>&1
```

### 手动执行一次

```bash
cd /home/moneychen/ib_dashboard
source .venv/bin/activate
python3 -c "from scripts.market_data import scheduled_update_all; scheduled_update_all()"
```

---

## 更新记录

### 2025-04-19

**修复：成本基础重复计算导致持仓盈亏显示错误**

- **问题**：`option_eae`（期权行权）与 `archive_trade`（股票交易）的日期格式不一致（前者为 `YYYY-MM-DD` / `datetime.date`，后者为 `YYYYMMDD` 字符串）。这导致期权 Assignment（行权买入股票）无法与 `archive_trade` 中对应的股票买入记录匹配，被重复计算为独立的 BUY 事件。表现为：持仓"盈亏%"为正，但"未实现盈亏"为负。
- **影响范围**：所有通过 Put 行权获得股票的持仓（如 QQQ、XPEV 等）。
- **修复文件**：
  - `scripts/incremental_cost_basis.py`：统一 `option_eae.date` 为 `YYYYMMDD` 字符串后再匹配。
  - `scripts/sqlite_to_dashboard.py`：同上。
  - `web/src/components/tabs/PositionsTab.jsx`：前端增加兜底逻辑，`未实现盈亏 = 市值 - 成本价 × 当前数量`，确保即使后端数据异常，盈亏金额与盈亏百分比也不会矛盾。

