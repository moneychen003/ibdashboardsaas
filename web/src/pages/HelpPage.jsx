import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import DocsTab from '../components/tabs/DocsTab';
import { useLocale } from '../lib/i18n';

function Step({ n, title, children, anchorId }) {
  return (
    <div id={anchorId} className="mb-6 flex gap-4 scroll-mt-20">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-black text-sm font-bold text-white">
        {n}
      </div>
      <div className="flex-1">
        <div className="mb-1 text-base font-semibold">{title}</div>
        <div className="text-sm leading-6 text-[var(--gray)]">{children}</div>
      </div>
    </div>
  );
}

function HelpSidebar({ items }) {
  return (
    <aside className="hidden lg:block w-56 shrink-0">
      <div className="sticky top-20 space-y-0.5">
        <div className="text-xs font-semibold text-gray-400 uppercase mb-2 px-3">目录</div>
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            className="block px-3 py-1.5 text-sm text-gray-600 rounded hover:bg-violet-50 hover:text-violet-700 transition"
          >
            {it.label}
          </a>
        ))}
      </div>
    </aside>
  );
}

const ZH_TOC = [
  { id: 'step-1', label: '1. 注册与登录' },
  { id: 'step-2', label: '2. Demo 模式' },
  { id: 'step-3', label: '3. 导出 IB XML' },
  { id: 'step-4', label: '4. 上传到本系统' },
  { id: 'step-5', label: '5. 切换账户/Tab' },
  { id: 'step-6', label: '6. 系统设置' },
  { id: 'step-7', label: '7. Telegram 机器人' },
  { id: 'step-8', label: '8. 分享面板' },
  { id: 'step-9', label: '9. 常见问题' },
  { id: 'step-10', label: '10. 最佳实践' },
  { id: 'docs', label: '── 数据原理 ──', divider: true },
];

const EN_TOC = [
  { id: 'step-1', label: '1. Sign Up & Login' },
  { id: 'step-2', label: '2. Demo Mode' },
  { id: 'step-3', label: '3. Export IB XML' },
  { id: 'step-4', label: '4. Upload to Dashboard' },
  { id: 'step-5', label: '5. Switch Accounts/Tabs' },
  { id: 'step-6', label: '6. Settings' },
  { id: 'step-7', label: '7. Telegram Bot' },
  { id: 'step-8', label: '8. Share Panel' },
  { id: 'step-9', label: '9. FAQ' },
  { id: 'step-10', label: '10. Best Practices' },
  { id: 'docs', label: '── Reference ──', divider: true },
];

function Tip({ children }) {
  return (
    <div className="my-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      💡 {children}
    </div>
  );
}

function ConfigRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded border border-[var(--lighter-gray)] bg-[var(--lighter-gray)]/40 px-3 py-2">
      <span className="text-xs text-[var(--gray)]">{label}</span>
      <span className="text-xs font-medium text-black">{value}</span>
    </div>
  );
}

export default function HelpPage() {
  const [locale] = useLocale();
  return locale === 'en' ? <HelpPageEn /> : <HelpPageZh />;
}

function HelpPageZh() {
  const navigate = useNavigate();
  return (
    <Layout>
      <div className="mx-auto max-w-[1100px] flex gap-6 px-4">
        <HelpSidebar items={ZH_TOC} />
        <div className="flex-1 min-w-0">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">新手教程</h1>
          <button
            onClick={() => navigate('/combined/overview')}
            className="rounded-lg border border-[var(--light-gray)] px-4 py-2 text-sm hover:border-black hover:bg-black hover:text-white"
          >
            ← 返回仪表盘
          </button>
        </div>

        <div className="rounded-xl border border-[var(--light-gray)] bg-white p-6 shadow-sm">
          <Step n={1} anchorId="step-1" title="注册与登录">
            首次访问时，点击页面右上角的「登录」进入账号页面。如果还没有账号，点击「立即注册」，填写邮箱和密码即可完成注册。
            <br />
            登录成功后，系统会自动记住你的身份，7 天内无需重复登录。
          </Step>

          <Step n={2} anchorId="step-2" title="了解 Demo 模式（示例数据）">
            如果你是新用户且尚未导入任何报表，系统会自动进入 <b>Demo 模式</b>。此时页面顶部会出现黄色提示条，展示的是预设的示例账户数据。
            <Tip>
              Demo 模式的目的是让你提前熟悉界面布局。所有图表、持仓、业绩数据都是模拟的，
              <b>导入真实 XML 报表后才会替换为你自己的账户信息</b>。
            </Tip>
          </Step>

          <Step n={3} anchorId="step-3" title="从 IB 后台导出 XML 对账单">
            <Tip>
              <b>重要前提</b>：IB 中文界面下通常看不到 Flex Queries 功能，请先将账户界面语言切换为 <b>English</b>（设置路径：Settings → Display → Language）。
            </Tip>

            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-2 font-semibold">1. 进入 Flex Queries 页面</div>
                <div className="text-sm text-[var(--gray)]">登录 IB 网页端后，按以下路径点击菜单：</div>
                <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
                  <span>Performance &amp; Reports</span><span className="text-blue-400">→</span>
                  <span>Flex Queries</span><span className="text-blue-400">→</span>
                  <span className="font-semibold">Activity Flex Query</span>
                </div>
              </div>
              <div>
                <div className="mb-2 font-semibold">2. 创建查询模板（首次使用）</div>
                <div className="text-sm text-[var(--gray)]">
                  如果你还没有任何 <b>Activity Flex Query</b> 模板，点击右侧的 <b>＋</b> 按钮新建一个。
                  <br />
                  <span className="font-medium text-amber-700">注意：在 Sections (Select Multiple) 页面中，所有的 Section 都必须勾选；点击任意 Section 展开后，里面的每一项子字段也必须全部勾选（可点击顶部的 Select All 一键全选）。输出格式必须选择 XML。任何一项遗漏都会导致本系统解析缺失或报错。</span>
                </div>
              </div>
              <div>
                <div className="mb-2 font-semibold">3. 配置 General Configuration</div>
                <div className="text-sm text-[var(--gray)] mb-2">在查询模板的 General Configuration 中，按下图设置（可点击右侧下拉框选择）：</div>
                <div className="rounded-lg border border-[var(--light-gray)] bg-white p-4 text-sm shadow-sm">
                  <div className="mb-3 border-b border-[var(--lighter-gray)] pb-2 font-semibold">General Configuration</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ConfigRow label="Date Format" value="yyyyMMdd" />
                    <ConfigRow label="Time Format" value="HHmmss" />
                    <ConfigRow label="Date/Time Separator" value="; (semi-colon)" />
                    <ConfigRow label="Profit and Loss" value="Default" />
                    <ConfigRow label="Include Canceled Trades?" value="No" />
                    <ConfigRow label="Include Currency Rates?" value="Yes" />
                    <ConfigRow label="Include Audit Trail Fields?" value="No" />
                    <ConfigRow label="Display Account Alias in Place of Account ID?" value="No" />
                    <ConfigRow label="Breakout by Day?" value="Yes" />
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-2 font-semibold">4. 获取 Query ID 与 Token</div>
                <div className="text-sm text-[var(--gray)]">
                  保存模板后，系统会生成一个 <b>Query ID</b>（通常是一串数字，如 <code>1460982</code>）。
                  <br />
                  然后进入 <b>Flex Web Service</b> 页面，勾选 <b>Flex Web Service Status</b> 启用服务。在页面中间的 <b>Current Token</b> 一栏会显示一长串数字，这就是你的 <b>Token</b>。请务必点击页面下方的 <b>Save</b> 按钮保存，并将这串 Token 复制记录下来，后续填入本系统「设置 → IB 自动同步」中即可实现自动拉取。
                </div>
                <Tip>在 <b>Flex Web Service → Valid for IP Address</b> 中，建议<b>留空</b>不填写任何 IP，然后点击 <b>Save</b>。如果填入了具体 IP，后续自动同步反而容易报权限错误。</Tip>
              </div>
              <div>
                <div className="mb-2 font-semibold">5. 下载 XML 文件</div>
                <div className="text-sm text-[var(--gray)]">
                  配置完成后，点击运行查询。IB 会生成 XML 文件，点击下载并保存到本地。建议下载完整的<b>历史区间</b>（从开户日至今），这样本系统的业绩归因、持仓成本、交易排名等高级分析才会准确。
                </div>
                <Tip>
                  <b>跨年查询注意事项</b>：若你的账户是在 2023 年（或更早年份）开通的，<b>不要</b>在单次查询里直接设置「开户日 → 今天」这种跨年度长区间。IB Activity Flex Query 在首次跨年时容易出现返回空数据的情况。
                  正确的做法是<b>按自然年拆分</b>，将所有年份的 XML 一次性上传到本系统即可。
                </Tip>
              </div>
            </div>
          </Step>

          <Step n={4} anchorId="step-4" title="上传到本系统">
            拿到 XML 文件后，回到本系统进行上传。方式有两种：
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><b>📤 上传 XML</b>：适合临时补传 1~3 个文件。点击后会弹出文件选择框，按住 <code>Ctrl / Cmd</code> 可同时选中多个 XML。</li>
              <li><b>📁 上传文件夹</b>：适合批量导入历史数据。直接选择存放 XML 的文件夹，系统会自动过滤出所有 <code>.xml</code> 文件并逐个处理。</li>
            </ul>
            <Tip>建议一次性把历史 XML 都传完，数据越完整，收益率、持仓归因、交易排名等高级分析就越准确。上传完成后页面会自动刷新。</Tip>
          </Step>

          <Step n={5} anchorId="step-5" title="切换账户与 Tab 导航">
            导入多个账户后，页面左上角会出现账户下拉框。可选择单个账户独立查看，或选择 <b>Combined（合并视图）</b> 查看汇总分析。顶部导航栏提供 8 大核心 Tab：总览 / 持仓 / 业绩 / 明细 / 变动 / 税务 / 战绩 / 组合。
          </Step>

          <Step n={6} anchorId="step-6" title="使用系统设置">
            点击右上角「⚙️ 设置」可打开设置面板，常用功能：系统状态、导入数据、账户与货币、IB 自动同步、市场数据、TG 机器人、分享面板。
          </Step>

          <Step n={7} anchorId="step-7" title="使用 Telegram 机器人查询账户">
            把账户绑定到 Telegram，可以随时通过聊天查询净值、持仓、成本、交易等数据，并订阅每日净值播报。
            <div className="mt-3 text-sm text-[var(--gray)]">
              绑定流程：本站「设置 → TG 机器人」→ 生成绑定码 → Telegram 搜 <b>@ibdashboard_bot</b> → 发送 <code>/bind 123456</code>。
              常用命令：<code>/nav</code> /<code>/holdings</code> /<code>/trades</code> /<code>/cost AAPL</code> /<code>/sub</code>。
            </div>
          </Step>

          <Step n={8} anchorId="step-8" title="生成只读分享面板">
            「设置 → 分享面板」+ 新建分享 → 勾选可见 Tab + 选择账户 + 有效期 → 复制 <code>https://moneychen.com/share/&lt;token&gt;</code> 链接。删除即时失效。
          </Step>

          <Step n={9} anchorId="step-9" title="常见问题">
            <div className="space-y-3 text-sm">
              <div><b className="text-black">Q: 自动同步报错 1014/1015？</b> Query ID 7 位数字 + Token 在 Flex Web Service 重新生成（IP 留空）。</div>
              <div><b className="text-black">Q: 首页净值好几天不动？</b> 看 asOfDate 是否周末/节假日；如超过 7 个工作日没动检查 IB 自动同步状态。</div>
              <div><b className="text-black">Q: 持仓页同一股票多行？</b> v1.1.1 已修，刷新即可。</div>
              <div><b className="text-black">Q: 多个 IB 子账户？</b> 每个 XML 上传后下拉多一个；Combined 跨账户合并。</div>
            </div>
          </Step>

          <Step n={10} anchorId="step-10" title="最佳实践">
            <ul className="list-disc space-y-1 pl-5 text-[var(--gray)]">
              <li><b>浏览器缓存</b>：<code>Ctrl + F5</code>（Windows）/ <code>Cmd + Shift + R</code>（Mac）强制刷新。</li>
              <li><b>XML 格式</b>：必须是 IB 官方 Activity Statement XML，非 PDF/CSV。</li>
              <li><b>数据延迟</b>：大文件处理可能几十秒，请勿重复上传。</li>
              <li><b>合并视图</b>：Combined 跨账户自动按币种折算去重。</li>
            </ul>
          </Step>
        </div>

        <div id="docs" className="mt-8 pt-6 border-t scroll-mt-20">
          <DocsTab />
        </div>
        <div className="mt-6 text-center text-sm text-[var(--gray)]">仍有疑问？请联系管理员获取更多帮助。</div>
        </div>
      </div>
    </Layout>
  );
}

function HelpPageEn() {
  const navigate = useNavigate();
  return (
    <Layout>
      <div className="mx-auto max-w-[1100px] flex gap-6 px-4">
        <HelpSidebar items={EN_TOC} />
        <div className="flex-1 min-w-0">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Getting Started</h1>
          <button
            onClick={() => navigate('/combined/overview')}
            className="rounded-lg border border-[var(--light-gray)] px-4 py-2 text-sm hover:border-black hover:bg-black hover:text-white"
          >
            ← Back to dashboard
          </button>
        </div>

        <div className="rounded-xl border border-[var(--light-gray)] bg-white p-6 shadow-sm">
          <Step n={1} anchorId="step-1" title="Sign Up & Login">
            On your first visit, click <b>Login</b> in the top-right. If you don't have an account yet, click <b>Sign Up Now</b> and fill in your email and password.
            <br />
            Once logged in, you stay signed in for 7 days.
          </Step>

          <Step n={2} anchorId="step-2" title="Demo Mode (Sample Data)">
            New users with no imported data automatically enter <b>Demo Mode</b>. A yellow banner appears at the top with simulated portfolio data.
            <Tip>
              Demo Mode is for getting familiar with the layout. All charts, holdings and performance numbers are mock data — <b>they're replaced with your real account once you import an XML statement</b>.
            </Tip>
          </Step>

          <Step n={3} anchorId="step-3" title="Export XML from IB">
            <Tip>
              <b>Important</b>: Flex Queries are usually invisible in the Chinese IB UI. Switch your IB account language to <b>English</b> first (Settings → Display → Language).
            </Tip>

            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-2 font-semibold">1. Open Flex Queries</div>
                <div className="text-sm text-[var(--gray)]">After logging into IB Web, navigate via:</div>
                <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
                  <span>Performance &amp; Reports</span><span className="text-blue-400">→</span>
                  <span>Flex Queries</span><span className="text-blue-400">→</span>
                  <span className="font-semibold">Activity Flex Query</span>
                </div>
              </div>
              <div>
                <div className="mb-2 font-semibold">2. Create a Query Template (first time)</div>
                <div className="text-sm text-[var(--gray)]">
                  Click the <b>＋</b> button to create a new template.
                  <br />
                  <span className="font-medium text-amber-700">Important: On the Sections (Select Multiple) page, ALL sections must be checked. Expand each section and tick every sub-field (use Select All at the top). Output format MUST be XML. Any missing field will cause parse errors.</span>
                </div>
              </div>
              <div>
                <div className="mb-2 font-semibold">3. Configure General Configuration</div>
                <div className="text-sm text-[var(--gray)] mb-2">Set the General Configuration as below:</div>
                <div className="rounded-lg border border-[var(--light-gray)] bg-white p-4 text-sm shadow-sm">
                  <div className="mb-3 border-b border-[var(--lighter-gray)] pb-2 font-semibold">General Configuration</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ConfigRow label="Date Format" value="yyyyMMdd" />
                    <ConfigRow label="Time Format" value="HHmmss" />
                    <ConfigRow label="Date/Time Separator" value="; (semi-colon)" />
                    <ConfigRow label="Profit and Loss" value="Default" />
                    <ConfigRow label="Include Canceled Trades?" value="No" />
                    <ConfigRow label="Include Currency Rates?" value="Yes" />
                    <ConfigRow label="Include Audit Trail Fields?" value="No" />
                    <ConfigRow label="Display Account Alias in Place of Account ID?" value="No" />
                    <ConfigRow label="Breakout by Day?" value="Yes" />
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-2 font-semibold">4. Get the Query ID and Token</div>
                <div className="text-sm text-[var(--gray)]">
                  After saving the template, IB generates a <b>Query ID</b> (a 7-digit number like <code>1460982</code>).
                  <br />
                  Go to <b>Flex Web Service</b>, enable <b>Flex Web Service Status</b>. The <b>Current Token</b> field shows a long string — that's your token. Click <b>Save</b> at the bottom and copy the token. Paste both into <i>Settings → IB Auto Sync</i> on this dashboard for automated pulling.
                </div>
                <Tip>In <b>Flex Web Service → Valid for IP Address</b>, leave this <b>empty</b> and click Save. Setting a specific IP often causes permission errors during auto-sync.</Tip>
              </div>
              <div>
                <div className="mb-2 font-semibold">5. Download the XML</div>
                <div className="text-sm text-[var(--gray)]">
                  Run the query and download the resulting XML. We recommend downloading the <b>full history</b> (from account opening to today) so performance attribution, cost basis and trade rankings are accurate.
                </div>
                <Tip>
                  <b>Multi-year tip</b>: For accounts opened in 2023 or earlier, do <b>NOT</b> set a single query covering "open date → today". IB Flex sometimes returns empty data on first multi-year crossing. Split into one query per calendar year and upload them all.
                </Tip>
              </div>
            </div>
          </Step>

          <Step n={4} anchorId="step-4" title="Upload to This Dashboard">
            Two upload methods:
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><b>📤 Upload XML</b>: For ad-hoc 1-3 files. Hold <code>Ctrl / Cmd</code> to multi-select.</li>
              <li><b>📁 Upload Folder</b>: For bulk historical import. Pick a folder; the system filters all <code>.xml</code> files automatically.</li>
            </ul>
            <Tip>Upload your full history at once — the more complete the data, the more accurate the analytics.</Tip>
          </Step>

          <Step n={5} anchorId="step-5" title="Switch Accounts & Tab Navigation">
            With multiple accounts, the top-left dropdown lets you pick a single account, or <b>Combined</b> (cross-account aggregation with currency conversion + dedup).
            <br />
            Top nav has 8 core tabs: Overview / Positions / Performance / Details / Changes / Tax / Trades / Portfolios.
          </Step>

          <Step n={6} anchorId="step-6" title="System Settings">
            Click <b>⚙️ Settings</b> top-right. Common features: System Status, Import Data, Accounts &amp; Currency, IB Auto Sync, Market Data, Telegram Bot, Share Panel.
          </Step>

          <Step n={7} anchorId="step-7" title="Telegram Bot Account Queries">
            Bind your account to Telegram for instant NAV, holdings, cost basis and trade queries, plus daily NAV broadcasts.
            <div className="mt-3 text-sm text-[var(--gray)]">
              Binding: <i>Settings → Telegram Bot</i> → Generate Code → search <b>@ibdashboard_bot</b> on Telegram → send <code>/bind 123456</code>.
              Common commands: <code>/nav</code> /<code>/holdings</code> /<code>/trades</code> /<code>/cost AAPL</code> /<code>/sub</code>.
            </div>
          </Step>

          <Step n={8} anchorId="step-8" title="Read-only Share Panel">
            <i>Settings → Share Panel</i> → New Share → pick visible tabs + account + expiry → copy the <code>https://moneychen.com/share/&lt;token&gt;</code> link. Delete to revoke instantly.
          </Step>

          <Step n={9} anchorId="step-9" title="FAQ">
            <div className="space-y-3 text-sm">
              <div><b className="text-black">Q: Auto-sync error 1014/1015?</b> Query ID is 7 digits; regenerate Token in Flex Web Service (leave Valid IP empty).</div>
              <div><b className="text-black">Q: NAV stuck for several days?</b> Check if asOfDate is on weekend/holiday. If &gt; 7 business days stale, check IB Auto Sync logs.</div>
              <div><b className="text-black">Q: Same stock shows multiple rows in Positions?</b> Fixed in v1.1.1 — refresh.</div>
              <div><b className="text-black">Q: Multiple IB sub-accounts?</b> Each XML upload adds an account to the dropdown; Combined aggregates across accounts.</div>
            </div>
          </Step>

          <Step n={10} anchorId="step-10" title="Best Practices">
            <ul className="list-disc space-y-1 pl-5 text-[var(--gray)]">
              <li><b>Browser cache</b>: Use <code>Ctrl + F5</code> (Windows) / <code>Cmd + Shift + R</code> (Mac) to force-refresh.</li>
              <li><b>XML format</b>: Must be IB Activity Statement XML (not PDF/CSV).</li>
              <li><b>Processing latency</b>: Large files take tens of seconds; don't re-upload.</li>
              <li><b>Combined view</b>: Cross-account positions are auto-converted by currency and deduped.</li>
            </ul>
          </Step>
        </div>

        <div id="docs" className="mt-8 pt-6 border-t scroll-mt-20">
          <DocsTab />
        </div>
        <div className="mt-6 text-center text-sm text-[var(--gray)]">Still need help? Contact your administrator.</div>
        </div>
      </div>
    </Layout>
  );
}
