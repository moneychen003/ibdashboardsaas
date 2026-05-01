import { useState, useEffect } from 'react';
import { BookOpen, Database, Layers, Bell, HelpCircle, Code, Sparkles, Shield } from 'lucide-react';

const CLAUDE_CFG = `{
  "mcpServers": {
    "ib-dashboard": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://moneychen.com/mcp",
        "--header",
        "Authorization: Bearer YOUR_TOKEN_HERE"
      ]
    }
  }
}`;

function Section({ icon: Icon, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="border rounded-2xl bg-white">
      <summary className="cursor-pointer px-5 py-4 flex items-center gap-3 hover:bg-gray-50 rounded-2xl">
        <Icon size={18} className="text-violet-600" />
        <span className="font-medium text-base">{title}</span>
      </summary>
      <div className="px-6 pb-5 pt-1 text-sm text-gray-700 leading-relaxed space-y-3">
        {children}
      </div>
    </details>
  );
}

function Code2({ children }) {
  return <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-violet-700">{children}</code>;
}

function Field({ name, desc }) {
  return (
    <div className="flex gap-3 py-1">
      <Code2>{name}</Code2>
      <span className="text-gray-600">{desc}</span>
    </div>
  );
}

export default function DocsTab() {
  return (
    <div className="p-4 max-w-4xl mx-auto space-y-3">
      <div className="bg-gradient-to-br from-violet-50 via-white to-rose-50 border border-violet-100 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen size={22} className="text-violet-600" />
          <h1 className="text-2xl font-medium">使用说明 · 数据原理 · 路线图</h1>
        </div>
        <p className="text-sm text-gray-600">
          理解每个 tab 在算什么、数据从哪来、有哪些功能、未来还会做什么。
          点开任意一节展开查看。
        </p>
      </div>

      <Section icon={Sparkles} title="平台是什么" defaultOpen>
        <p>
          IB Dashboard 是一个 <b>Interactive Brokers 持仓 + 收益 + 期权策略追踪平台</b>。把你 IB 账户的 Flex Query XML
          报表上传后，自动解析到 PostgreSQL，生成多 tab 的可视化分析。
        </p>
        <div className="bg-gray-50 rounded p-3 font-mono text-xs">
          数据流：IB Flex XML → archive_* 表 → 业务表 (daily_nav / positions / archive_trade)<br />
          → postgres_to_dashboard.py 生成 dashboard JSON → 前端读 slice
        </div>
        <p className="text-xs text-gray-500">
          更新频率：① 你手动上传 XML / 触发 Flex Sync — 当天起<br />
          ② 30 分钟实时价格刷新（Yahoo / Finnhub / Webull）— 总 NAV 跟盘动<br />
          ③ 用户操作（创建组合、添加持仓等）— 即时（&lt; 200ms）
        </p>
      </Section>

      <Section icon={Layers} title="各 tab 功能 + 数据原理">
        <div>
          <h3 className="font-semibold mt-2 mb-1">📊 总览</h3>
          <p>展示 IB 账户当前状态和长期表现。</p>
          <ul className="list-disc list-inside text-xs text-gray-600 space-y-1">
            <li><b>总 NAV</b> = <Code2>daily_nav.ending_value</Code2> + 实时价格 delta（30min timer 拉 Yahoo 价×当前持仓）</li>
            <li><b>TWR</b>（时间加权收益率）= 排除外部资金影响，纯反映投资能力</li>
            <li><b>MWR</b>（资金加权收益率）= IRR 算法，含外部入金时机的影响</li>
            <li><b>区间收益</b>：默认显示<b>原始变化</b>（绝对涨跌），副标显示<b>扣净入金口径</b>（更接近"投资真实回报"）</li>
            <li>"今日盈亏"= 实时净值 − 上一日 ending_value</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold mt-3 mb-1">📦 持仓</h3>
          <p>当前所有持仓按 ETF / 股票 / 期权三桶。</p>
          <ul className="list-disc list-inside text-xs text-gray-600 space-y-1">
            <li>数据源 <Code2>archive_open_position</Code2>（SUMMARY level，避免 LOT 行翻倍）</li>
            <li>多账户 combined 时按 symbol 跨账户聚合，自动按各账户 fx_rate 折算到 baseCurrency</li>
            <li>positionValueInBase = 已折算到 base currency（默认 CNH 或 USD）</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold mt-3 mb-1">📈 业绩</h3>
          <p>每日盈亏 / 月度统计 / benchmark 对比 / 期权 EAE 归因。</p>
          <ul className="list-disc list-inside text-xs text-gray-600 space-y-1">
            <li>日 PnL 两口径：<b>钱包口径</b>（NAV 差 − 外部流入）vs <b>Flex 口径</b>（mtm + realized + dividends + interest + commissions）</li>
            <li>月度收益矩阵：<Code2>daily_nav</Code2> 按月聚合 TWR</li>
            <li>"期权 EAE 归因" = <Code2>archive_option_eae</Code2> 按 transaction_type 汇总（卖 PUT / 被指派 / 到期废 / 行权）</li>
            <li>"闲置现金机会成本" = <Code2>archive_tier_interest_detail</Code2> vs SGOV 4.8% 年化对比</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold mt-3 mb-1">📃 明细</h3>
          <p>原始记录：trades / dividends / cash transactions / corporate actions。</p>
          <ul className="list-disc list-inside text-xs text-gray-600 space-y-1">
            <li><Code2>archive_trade</Code2> 含 BUY/SELL × 股票/期权，标 open_close_indicator 区分开仓平仓</li>
            <li>分红 = <Code2>archive_cash_transaction</Code2> WHERE type='Dividends'</li>
            <li>"数据质量"卡片 = 19 张关键表条数 + MAX(stmt_date)，OK / 空 / 异常一目了然</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold mt-3 mb-1">🔄 变动</h3>
          <p>持仓变化（前后比较）+ 近期卖出盈亏分析。</p>
          <ul className="list-disc list-inside text-xs text-gray-600 space-y-1">
            <li>"今日成交"= <Code2>latestDayTrades.trades</Code2>，每条标开/平 chip + asset class</li>
            <li>"卖出分析"= 30 天内 SELL 单的 fifo_pnl_realized 排序，看哪些止盈/止损</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold mt-3 mb-1">🏆 战绩</h3>
          <p>期权胜率 + 轮子追踪 + 标的级别累计盈亏。</p>
          <ul className="list-disc list-inside text-xs text-gray-600 space-y-1">
            <li>按 symbol 聚合：期权交易笔数 / 累计权利金 / 摊薄盈亏 / 胜率</li>
            <li>过滤："仅持仓" / "仅期权" / "盈利" / "亏损"</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold mt-3 mb-1">💰 税务</h3>
          <p>YTD 已实现盈亏 + 长短期估算 + 4 档税率档位（中国 0% / 美 22%/32%/37%）。</p>
          <ul className="list-disc list-inside text-xs text-gray-600 space-y-1">
            <li>YTD 已实现 = <Code2>archive_mtdytd_performance_summary_underlying</Code2> 最新 stmt_date 的 SUM(realized_pnl_ytd)</li>
            <li>未实现长/短期估算 = 按持仓最早 BUY 日（cost_basis_history.trade_date）距今 ≥ 365 天判定</li>
            <li>预估应纳税 = 选中税率 × 未实现长期×0.5 + 未实现短期 + YTD 已实现</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold mt-3 mb-1 text-violet-700">⭐ 组合（v1.3 重点）</h3>
          <p>把 IB 持仓按业务用途自由分组，看到目标占比 vs 实际偏离 + 期权策略 + 摊薄轨迹。</p>
          <ul className="list-disc list-inside text-xs text-gray-600 space-y-1">
            <li><b>一码一组合</b>：同一 symbol 只能在一个组合里（UNIQUE 约束），避免占比 &gt;100%</li>
            <li><b>三种整理</b>：手动 / ⚡规则（4 标准组合 + auto_rule）/ 🤖AI（接 Kimi K2.6）</li>
            <li><b>auto_rule</b>：组合可设 <Code2>etf_funds</Code2> / <Code2>stocks</Code2> / <Code2>options</Code2>，对应类型自动归位（用户 exclude 的不再被吸入）</li>
            <li><b>16 种期权策略自动识别</b>：解析 OCC（标的/到期/right/strike）+ 看同 underlying 股票够不够覆盖 → CC vs naked</li>
            <li><b>Wheel 识别</b>：扫 <Code2>archive_option_eae</Code2> Assignment 事件，标过的 underlying 上的 csp/cc 标"轮子"</li>
            <li><b>三种成本口径</b>：
              <ul className="list-disc list-inside ml-4 mt-1">
                <li>历史买入均价 = 总买入金额 / 总买股数（不剔除卖出）</li>
                <li>FIFO 持仓成本 = IB 标准 FIFO，剩余股的真实成本基础</li>
                <li><b>股票摊薄</b> = (买入 − 卖出) / 当前持股，纯股票视角，<b>不含期权权利金</b></li>
                <li><b>综合摊薄</b> = 股票摊薄 − 期权累计权利金 / 当前持股，<b>含期权全口径</b>（即表格"事件后摊薄"列）</li>
              </ul>
            </li>
            <li><b>摊薄轨迹</b>：合并股票 + 同 underlying 期权交易按时间正序，每个事件后重算摊薄；UI 上 ↓ 绿色（卖期权降）/ ↑ 橙色（接股升）</li>
            <li><b>再平衡建议</b>：每个组合 gap = (target_pct/100 × totalNav) − currentValue，输出"加仓 $X / 减仓 $Y"</li>
            <li><b>集中度警告</b>：单 symbol &gt; 20% / 单组合 &gt; 50% / 期权空头杠杆 &gt; 2x 三类</li>
            <li><b>金额单位</b>：所有数字统一折算到 USD（不论 baseCurrency 是 CNH 还是其他），通过 fxRates['USD'] 反向折算</li>
          </ul>
        </div>
      </Section>

      <Section icon={Database} title="数据库表 & 计算公式">
        <div>
          <h3 className="font-semibold mt-2 mb-1">关键 archive_* 表</h3>
          <Field name="archive_open_position" desc="持仓快照（每日），SUMMARY/LOT 双 level，必须按 SUMMARY 取" />
          <Field name="archive_trade" desc="交易明细，含股票 + 期权，notes 字段含 A/Ep/Ex 等 codes" />
          <Field name="archive_cash_transaction" desc="现金流：分红/利息/入金/出金，DETAIL/SUMMARY 必选 DETAIL" />
          <Field name="archive_option_eae" desc="期权 Exercise/Assignment/Expiration 事件" />
          <Field name="archive_change_in_nav" desc="每日 NAV 变化各组成（mtm/realized/dividends/interest/commissions）" />
          <Field name="cost_basis_history" desc="历史成本基础（每笔 trade 后的累计 qty / 加权 / 摊薄）" />
          <Field name="archive_mtdytd_performance_summary_underlying" desc="每个 underlying 的 MTD/YTD 已实现盈亏" />
        </div>
        <div className="mt-3">
          <h3 className="font-semibold mb-1">公式速查</h3>
          <div className="bg-gray-50 rounded p-3 font-mono text-xs space-y-1">
            <div>TWR_period = ∏ (1 + daily_return_i) − 1</div>
            <div>MWR_period = IRR(cash_flows + ending_value)</div>
            <div>diluted_cost = (cum_buy − cum_sell − cum_option_premium) / cum_qty</div>
            <div>portfolio_pct = portfolio_value / total_nav</div>
            <div>option_notional = |contracts| × 100 × strike</div>
            <div>leverage = (short_put_notional + short_call_notional) / total_nav</div>
          </div>
        </div>
      </Section>

      <Section icon={Bell} title="通知机制">
        <ul className="list-disc list-inside text-xs text-gray-600 space-y-1">
          <li><b>每日播报</b> — cron <Code2>0 22 * * *</Code2>，flex-sync → market_data → telegram 推净值 + 今日 PnL + YTD 已实现</li>
          <li><b>Trade 推送</b> — cron <Code2>*/15 * * * *</Code2>，新成交按日聚合一条消息，含<b>标的摊薄汇总</b>段（累计权利金 + 实时摊薄）</li>
          <li><b>期权到期提醒</b> — 每日 9:07 跑，桶 30/14/7/3/1 天，<Code2>user_notification_logs</Code2> 23h 内同 symbol+expiry 跳过</li>
          <li><b>SaaS bot</b> — 平台 bot <Code2>@ibdashboard_bot</Code2>，用户 /bind 6 位码即可接收通知</li>
        </ul>
      </Section>

      <Section icon={Code} title="路线图（部分已上线）">
        <div className="space-y-3">
          <div>
            <h4 className="font-semibold text-emerald-700 mb-1">🥇 高价值短期（1-3 天）</h4>
            <ol className="list-decimal list-inside text-xs space-y-1 text-gray-600">
              <li><s className="text-gray-400">期权策略手动 override</s> ✅ — 加 schema 列让用户否决 AI 识别（如把 csp 强标 wheel）</li>
              <li><s className="text-gray-400">未识别期权策略名单</s> ✅ — PortfoliosTab 底部「未识别期权策略」折叠卡片，OCC 解析详情 + 失败原因 hint + 复制 OCC 按钮，规则数据驱动 (<Code2>STRATEGY_RULES</Code2>) 加规则只追加 entry 不动主逻辑</li>
              <li><s className="text-gray-400">轮子单循环追踪</s> ✅ — lifetime 汇总 + 真 cycle 分解（按持股 0→正→0 切段算独立年化）</li>
              <li><b>再平衡一键执行</b> — "减仓 $X" 按钮跳到 us-options 网页填好参数</li>
            </ol>
          </div>
          <div>
            <h4 className="font-semibold text-blue-700 mb-1">🥈 中价值（3-7 天）</h4>
            <ol className="list-decimal list-inside text-xs space-y-1 text-gray-600" start={5}>
              <li><b>历史 holdings 快照</b> — 每天写一次 snapshot，组合 NAV 时间序列才精确</li>
              <li><b>风险参数</b> — β / σ / Sharpe per 组合</li>
              <li><b>多语言</b>（中/英 切换） — 全站 i18n</li>
              <li><s className="text-gray-400">数据导出 CSV</s> ✅ · Excel / PDF 待做</li>
              <li><b>税务报告 PDF</b> — 1099-B 风格自动生成给 CPA</li>
            </ol>
          </div>
          <div>
            <h4 className="font-semibold text-rose-700 mb-1">🥉 美观 / 体验（1-3 天）</h4>
            <ol className="list-decimal list-inside text-xs space-y-1 text-gray-600" start={10}>
              <li><b>移动端 H5 优化</b></li>
              <li><b>暗色模式</b></li>
              <li><b>首页 onboarding tour</b> — 新用户 5 步介绍</li>
              <li><b>图表交互升级</b> — 用 echarts 替代手搓 SVG</li>
            </ol>
          </div>
          <div>
            <h4 className="font-semibold text-purple-700 mb-1">🎯 重型（&gt;1 周）</h4>
            <ol className="list-decimal list-inside text-xs space-y-1 text-gray-600" start={14}>
              <li><s className="text-gray-400">真 wheel 自动化</s> ✅ — 每段 cycle 独立结算 PnL/天数/年化，可在「我的组合 → Wheel 轮子追踪」展开查看</li>
              <li><s className="text-gray-400">第三方券商接入</s> (用户决定跳过 - 多数券商无 Flex Query)</li>
              <li><b>MCP server</b> — 让 Claude / Kimi / GPT 直接读你的持仓做分析</li>
              <li><b>社区功能</b> — 用户匿名分享组合方案</li>
            </ol>
          </div>
        </div>
      </Section>

      <Section icon={Code} title="🤖 AI/MCP 接入（高级）">
        <p>把 IB Dashboard 接入 Claude Desktop / Cursor / Hermes / 其他 MCP 客户端，让 AI 直接读你的持仓数据，无需手动导出 CSV。</p>

        <div className="mt-3">
          <h4 className="font-semibold mb-2">📦 8 个可调 Tools</h4>
          <ul className="list-disc list-inside text-xs text-gray-600 space-y-0.5">
            <li><Code2>get_overview</Code2> — 总 NAV / 各期间收益 / 风险参数 / 现金分布</li>
            <li><Code2>get_holdings</Code2> — 当前持仓（stocks/etfs/options 三桶）</li>
            <li><Code2>get_portfolios</Code2> — 自定义组合 + 再平衡建议 + 集中度风险</li>
            <li><Code2>get_wheel_cycles</Code2> — Wheel 追踪（含年化收益）</li>
            <li><Code2>get_holding_trades</Code2> — 单标的 trade 历史 + 摊薄轨迹</li>
            <li><Code2>get_recent_trades</Code2> — 近 N 天所有交易</li>
            <li><Code2>get_option_pnl_timeline</Code2> — 期权月度权利金 + Top 20 底层</li>
            <li><Code2>search_symbol</Code2> — 关键词搜持仓</li>
          </ul>
        </div>

        <div className="mt-4">
          <h4 className="font-semibold mb-2">⚙️ 一键复制配置（已含你的 token）</h4>
          <p className="text-xs text-gray-600 mb-2">登录后复制下面整段 JSON，粘贴到 Claude Desktop / Hermes / Cursor 配置文件。</p>
          <McpConfigBlock />
        </div>

        <div className="mt-4">
          <h4 className="font-semibold mb-2">📍 各客户端配置文件位置</h4>
          <ul className="text-xs text-gray-600 space-y-1">
            <li><b>Claude Desktop (Mac)</b>: <Code2>~/Library/Application Support/Claude/claude_desktop_config.json</Code2></li>
            <li><b>Claude Desktop (Win)</b>: <Code2>%APPDATA%\Claude\claude_desktop_config.json</Code2></li>
            <li><b>Hermes</b>: <Code2>~/.hermes/config.yaml</Code2> 的 <Code2>mcp_servers</Code2> 块（YAML 格式，参考已有 jin10 配置）</li>
            <li><b>Cursor</b>: 设置 → MCP → Add Server</li>
          </ul>
          <p className="text-xs text-gray-400 mt-1">配置完后重启客户端生效。</p>
        </div>

        <div className="mt-4">
          <h4 className="font-semibold mb-2">💬 杀手 Demo</h4>
          <p className="text-xs text-gray-600">配好后问 AI：</p>
          <div className="bg-gray-50 p-3 rounded mt-1 text-xs space-y-2 text-gray-700">
            <div>「分析我账户最近 30 天交易，哪个 wheel underlying 表现最好？建议下周该卖什么期权？」</div>
            <div>AI 会自动串调 <Code2>get_recent_trades</Code2> + <Code2>get_wheel_cycles</Code2> + <Code2>get_holdings</Code2>，几秒给出综合建议。</div>
          </div>
        </div>

        <div className="mt-4">
          <h4 className="font-semibold mb-2">🔒 安全说明</h4>
          <ul className="list-disc list-inside text-xs text-gray-600 space-y-0.5">
            <li>所有 tool 都是 <b>read-only</b>，AI 只能查不能改</li>
            <li>JWT token 7 天过期（配置块里的是临时短效），过期后重新登录拿新 token</li>
            <li>Token 仅本地 MCP client 持有，<b>不上传到 OpenAI/Anthropic</b></li>
            <li>每次 tool 调用根据 token 自动路由到你的 user_id，绝对拿不到别人数据</li>
          </ul>
        </div>
      </Section>

      <Section icon={Shield} title="数据安全 & 隐私">
        <ul className="list-disc list-inside text-xs text-gray-600 space-y-1">
          <li>XML 报表只在你账户的 PG schema 内，不外发</li>
          <li>JWT 鉴权，写接口（创建组合/上传 XML/改 settings）必须登录</li>
          <li>读接口公开（dashboard、accounts、guest_config 控制访客可见 tab）</li>
          <li>SaaS 站每用户独立 user_id 隔离，CASCADE delete 用户时清掉所有数据</li>
          <li>Kimi AI 整理：发送的内容仅 symbol + 类型 + 市值，不发送账户号 / 真实姓名</li>
        </ul>
      </Section>

      <Section icon={HelpCircle} title="常见问题">
        <div>
          <p className="font-semibold">Q: AI 整理是真 AI 吗？</p>
          <p className="text-xs text-gray-600">是。接 Kimi K2.6（kimi-for-coding 模型，Anthropic 协议接入）。把你持仓 + 类型 + 市值发给模型，让它推荐 4-6 个组合分类方案。</p>
        </div>
        <div>
          <p className="font-semibold mt-2">Q: 摊薄成本和 IB 自己算的为什么不一样？</p>
          <p className="text-xs text-gray-600">IB 用 FIFO + commission/已实现盈亏精细处理。这里是直观版：(买入 − 卖出 − 权利金) / 持股，可能差几个点但变化趋势对。</p>
        </div>
        <div>
          <p className="font-semibold mt-2">Q: 上传 XML 后多久能看到？</p>
          <p className="text-xs text-gray-600">几秒到几分钟。XML 进入 RQ worker 队列异步解析；解析完触发 dashboard 重生。</p>
        </div>
        <div>
          <p className="font-semibold mt-2">Q: 一码多组合？</p>
          <p className="text-xs text-gray-600">不支持，UNIQUE(user_id, symbol) 约束。如果想"既算定投又算期权"，目前只能选一个。可以未来加跨组合 tag 系统。</p>
        </div>
        <div>
          <p className="font-semibold mt-2">Q: 期权月度图全是 0？</p>
          <p className="text-xs text-gray-600">早期用 fifo_pnl_realized，但 IB Flex 没 export 这字段（全 0）。已切换到 net premium proceeds。</p>
        </div>
      </Section>

      <div className="text-center text-xs text-gray-400 py-4">
        遇到 bug 或想加新功能？告诉我。
      </div>
    </div>
  );
}

function McpConfigBlock() {
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [host, setHost] = useState('');
  useEffect(() => {
    try {
      setToken(localStorage.getItem('ib_jwt') || localStorage.getItem('token') || '');
      setHost(window.location.host);
    } catch {}
  }, []);
  const url = host ? `https://${host}/mcp` : '';
  const claudeJson = `{
  "mcpServers": {
    "ib-dashboard": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "${url || 'https://your-host/mcp'}",
        "--header",
        "Authorization: Bearer ${token || 'YOUR_TOKEN'}"
      ]
    }
  }
}`;
  const hermesYaml = `ib_dashboard:
  enabled: true
  timeout: 120
  connect_timeout: 60
  url: ${url || 'https://your-host/mcp'}
  headers:
    Content-Type: application/json
    Authorization: Bearer ${token || 'YOUR_TOKEN'}`;
  const [tab, setTab] = useState('claude');
  const text = tab === 'claude' ? claudeJson : hermesYaml;
  function copy() {
    if (!token) return;
    try {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }
  if (!token) {
    return <div className="text-xs text-orange-600 p-3 bg-orange-50 rounded">⚠️ 未登录或 token 丢失。请登录后回到此页查看完整配置。</div>;
  }
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex bg-gray-100 border-b">
        <button
          onClick={() => setTab('claude')}
          className={'px-4 py-2 text-xs font-medium ' + (tab === 'claude' ? 'bg-white text-gray-900 border-b-2 border-violet-600' : 'text-gray-500 hover:text-gray-900')}
        >Claude Desktop / Cursor (JSON)</button>
        <button
          onClick={() => setTab('hermes')}
          className={'px-4 py-2 text-xs font-medium ' + (tab === 'hermes' ? 'bg-white text-gray-900 border-b-2 border-violet-600' : 'text-gray-500 hover:text-gray-900')}
        >Hermes (YAML)</button>
        <div className="flex-1" />
        <button
          onClick={copy}
          className={'px-3 my-1.5 mr-1.5 text-xs rounded ' + (copied ? 'bg-emerald-600 text-white' : 'bg-violet-600 text-white hover:bg-violet-700')}
        >
          {copied ? '✓ 已复制' : '📋 一键复制'}
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 text-xs p-4 overflow-auto m-0 max-h-80">{text}</pre>
      <div className="bg-amber-50 px-3 py-2 text-[10px] text-amber-800 border-t">
        ⚠️ token 等同账号密码，不要分享。7 天有效期，过期后重新登录回到此页可拿新 token。
      </div>
    </div>
  );
}
