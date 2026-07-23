# BTC 周期分析 Dashboard — AI Project Handoff Document

> **交给下一个 AI 的完整交接文档**。假设你没有任何上下文，只有这份文档 + 项目代码。读完这份文档，你应当完全理解整个项目、原作者的设计思路、已完成的工作、未来计划以及所有隐含约定。
>
> **仓库**: https://github.com/hhysteric/btc-cycle-dashboard
> **在线**: https://hhysteric.github.io/btc-cycle-dashboard/ （GitHub Pages）
> **最后更新**: 2026-07-22 | 最新 commit `a97a4ec`

---

## 1. Project Overview

**一句话**：一个纯前端的 BTC 行情周期分析 Dashboard，多维度判断比特币当前处于市场周期的什么位置、后市可能怎么走，并能一键导出带前瞻分析的周报 PNG。

- **解决什么问题**：把分散在 TradingView / Glassnode / CryptoQuant / CheckOnChain / ETF 资金流等数据源的"周期判断"信息，收敛到一个页面，用统一的口径回答"BTC 现在处于周期哪个阶段、历史同期怎么走、接下来可能怎么走"。
- **为什么做**：原作者关注 BTC 的**周期性规律**（四年减半周期、星期效应、均线/估值指标的周期位置），希望有一个自己能持续迭代、可导出观点周报的工具，而不是每次手动翻十几个网站。
- **最终目标**：见 §12 Future Vision。简言之——从"图表看板"进化成"能自动生成有观点、有前瞻、可分享的周期研判报告"的个人研究工具。
- **当前完成度**：约 **85%**。核心看板 + 周期模型 + 周报 PNG 导出 + ETF 资金流三栏图 + 链上指标本地化（MVRV/NUPL/Realized Price）+ zZ 指标（MA110/MA6×MA103 信号）+ 可拖动面板分隔条 + 修饰键独立缩放各轴均已完成；期货/衍生品板块仍是占位（未接数据）。

---

## 2. Core Philosophy

整个网站的设计理念可以概括为：**"用周期视角，诚实地告诉用户 BTC 现在在哪、历史同期如何、接下来可能如何。"**

### 为什么选择这些指标
指标全部围绕**"判断周期位置"**这一个目的，分四层：
1. **时间周期**：四年大周期（减半驱动）、星期效应（短周期规律）——回答"按日历/历史节奏，现在该是什么阶段"。
2. **技术/估值周期位置**：zZ 指标（MA110 上涨信号、MA6×MA103 买入信号）、Mayer Multiple、RSI（日线+周线）——回答"价格相对成本/均线在周期中的高低"。
3. **链上估值**：MVRV、NUPL、Realized Price、Cointime Price——回答"链上持币成本视角下，市场在盈利还是亏损、离顶/底多远"。
4. **增量资金**：ETF 净流量（日柱 + 累计线 + 价格着色）——回答"资金流入流出对价格的共振影响"。

### 为什么不选其他指标
- **不做短线交易指标**（MACD、KDJ、布林带、缠论等）：项目是**周期研判**工具，不是日内交易工具。作者明确关注的是"周/月/年级别的周期位置"，不是入场点。
- **不做山寨币/合约喊单**：只聚焦 BTC 本身的周期。

### 最重要的分析思想
1. **四年周期 = 3 年涨 + 1 年跌的日历年模型**（不是"减半后天数进度条"）。这是全项目的核心认知，`year % 4` 决定阶段。**这一点曾经理解错，是本项目最关键的一次纠正**（见 §14）。
2. **"从各轮最高点对齐"做周期对比**，看见顶后的回撤/恢复形态，而不是从减半日对齐。
3. **前瞻性**：周报不只报现状，要基于历史区间**推演未来的日期和价格区间**（如"本轮低点可能在 X 月 X 日，价格 $A–$B"）。
4. **ETF 资金流是同步共振指标**：当日净流量与当日价格涨跌相关系数 ~0.39，但**近 20 日滚动净流入的正负**对未来 20 日方向有区分力（流入期平均 +2.25%，流出期 -0.64%）。

### 永远不要违反的原则
1. **诚实 > 好看**。没有数据的指标**绝不编造数字**。作者两次强烈反应：① 早期我用瞎编公式算 MVRV → 被要求全删；② 链上 API 浏览器拿不到时，作者选择"嵌入官方图 + 定性说明"而不是伪造。**这是硬底线。**
2. **数据要新**。作者会亲自核对数据日期。CSV 由 GitHub Actions 每日自动更新（行情 + CryptoQuant 链上 + Farside ETF）。**任何"周期最低点/天数"类结论必须基于最新数据。**
3. **不构成投资建议**——所有分析输出都带免责声明。
4. **纯前端、可部署到 GitHub Pages**——不引入后端（数据更新靠 GitHub Actions 定时脚本）。

### 设计取舍
- **纯前端 vs 后端**：选纯前端，代价是链上数据受 CORS/限流约束（故用本地 CSV + Actions 更新），换来零运维、GitHub Pages 直接托管。
- **本地 CSV vs 实时 API**：以本地 CSV 为主（稳定、可离线、可回溯），CoinGecko 仅补实时价格，失败时回退 CSV。
- **自绘图表 vs 嵌入官方图**：能本地算的（价格/MA/Mayer/RSI/MVRV/NUPL/ETF）自绘（可控、可缩放、可入周报）；Cointime 仍嵌入 CheckOnChain 官方图（因无免费 API 源）。
- **亮/暗主题**：默认亮色，可切换深色；图表颜色随主题自适应。

---

## 3. User Intent（最重要）

以下是从整个开发对话中提炼的、原作者**真正**在意的东西（不是功能清单）：

### 真正关注什么
- **周期位置**，而非价格预测本身。反复问的是"现在处于周期哪个阶段""历史同期怎么走""还有多久到底/顶"。
- **前瞻性、可落地的结论**。不满足于"当前 RSI=40"，要的是"若维持震荡，X 天后 X 月 X 日会怎样"。给周报时甚至亲自写了例子（周期低点日期+价格区间、MA 突破天数、Cointime 抬升逻辑）。
- **数据的真实性和新鲜度**。会亲自验算：周期4 不是 122 天（因为数据旧了），会指出周期3 跌幅标注含义不清。

### 分析风格
- **历史类比派**：用"此前 3 轮周期下跌 364–406 天、76.6%–84.5%"来推演本轮。
- **多维交叉验证**：时间周期 + 技术 + 链上 + 资金，不依赖单一指标。
- **量化 + 定性结合**：能算的给数字，不能算的给"思路"（如 Cointime 那段"如果横盘，成本线会不会抬升到跌破"）。
- **ETF 资金流看共振**：强调"近 20 日滚动净流入正负"对后市方向的区分力，而非单日噪声。

### 审美
- **深色专业金融风**（`#0f0f23` 深底、`#f7931a` 比特币金主色、绿涨红跌），但也支持亮色主题（默认白底灰字）。
- **信息密度高但不拥挤**。曾要求把拥挤的 2×2 链上图改成全宽大卡片。
- **图表要能看清、能交互**：要求可缩放（横纵轴）、对数坐标、全屏。每个多面板图（MVRV/ETF）中间有可拖动分隔条调节上下比例。

### 研究偏好
- 参考的信源：**Killa (@KillaXBT)** 短周期规律、**CheckOnChain** 链上图、**CryptoQuant** MVRV/Realized Price、**Glassnode**、**Farside** ETF 资金流。
- 喜欢"3 年涨 1 年跌"这类**简洁有力的周期框架**。
- 对"星期效应"这种短周期统计规律感兴趣（要求不是照抄 Killa，而是**自己用历史数据统计出规律并标注在 K 线上**）。

### 产品理念
- 这是**个人研究工具**，要能持续迭代、能导出可分享的观点。
- 周报是核心产出物——**一张 PNG，图 + 分析，随时可发给别人或存档**。

### 未来想做到什么程度
见 §12。核心：从"图表看板"进化成"能自动生成有观点、有前瞻、覆盖宏观→链上→情绪全链条的周期研判报告"。

---

## 4. Current Features

| 模块 | 已实现 | 为什么存在 | 解决的问题 | 不足 |
|---|---|---|---|---|
| **顶部概览卡** | BTC 当前价格/市值/四年周期阶段/距下次减半天数 | 一眼看到"现在贵不贵、在周期哪" | 快速定位 | 市值/减半天数是静态估算 |
| **zZ 指标（原"BTC 价格与均线"）** | MA110 上涨信号（价格上穿 MA110）、MA6×MA103 买入信号（金叉），含延长线预测触发日 | 替代传统 MA50/200/365，给出明确的周期信号判断 | "何时触发上涨/买入" | 标题"4Y Rolling Best MA"是示意性注释，非精确算法名 |
| **四年大周期模型（四宫格）** | `year%4` → 首轮牛/次轮牛/熊/预备牛，高亮当前，进度条 | 全项目核心认知 | 回答"今年该是什么阶段" | 模型是纯日历规律，未与价格强耦合 |
| **四年大周期对比图** | 从各轮**最高点**对齐，归一化，标注各轮最低点跌幅 | 历史类比 | "见顶后历史怎么走" | 只对齐了顶部；未做底部对齐视图 |
| **短周期规律（星期效应）** | 全历史统计各星期上涨概率+平均涨幅，K 线标注最强/最弱星期 | Killa 思路的量化实现 | "周一大概率涨"类规律 | 未做"连续 N 天""月内效应"等更多短周期 |
| **RSI（日线+周线）** | 全历史，叠加价格，超买超卖线，缩放/全屏 | 强弱与背离 | 周期性超买超卖 | — |
| **Mayer Multiple** | 价格/MA200，全历史，叠加价格，阈值线 | 简洁估值 | 相对 MA200 的高低 | — |
| **MVRV 估值带（本地自绘）** | 双面板：上=价格+已实现价格+价格 band；下=MVRV Ratio + MVRV band 曲线；可拖动分隔条调上下比例 | 链上估值核心指标 | 找顶底、看持币成本 | — |
| **NUPL 净未实现盈亏（本地自绘）** | NUPL 曲线 + 分区阈值线（欣快/贪婪/乐观/恐惧/投降） | 情绪/盈亏 | 欣快/投降区 | — |
| **已实现价格 / 全市场持币成本** | 价格 vs 已实现价格曲线，底部价位区间推算 | 链上成本基准 | 跌破=底部信号 | — |
| **4Y 已实现价格风险回报比** | R/R = 上行空间/下行风险，基于 realized price × MVRV band | 量化风险回报 | 高估/低估判断 | — |
| **ETF 资金流（增量资金）** | 三面板：上=价格（按 20 日滚动净流入绿/红着色）、中=日净流量柱、下=累计净流入线；两条可拖动分隔条调比例 | 最可靠的增量资金源 | 资金流入共振 | 仅 US Spot ETF，不含全球 |
| **Cointime Price（嵌入）** | CheckOnChain 官方 iframe | 时间加权成本 | 补充视角 | 非本地数据，无法进入周报量化 |
| **周报导出（PNG）** | 每指标单段连贯分析文字 + 对应图表，合成单张 PNG，另有复制文本 | 核心产出物 | 可分享的周期研判 | Cointime 段是定性（无本地图） |
| **配置面板** | 可选指标、可编辑分析文字、可划选图表区域入报、上传图片替换/新增 | 灵活定制周报 | 个性化输出 | — |
| **十字准线** | 鼠标悬停任意交互图显示横纵虚线跟随光标 | 辅助读数 | 精确定位 | — |
| **亮/暗主题** | 默认亮色，可切换；图表颜色随主题自适应 | 适配不同环境 | 可读性 | — |

---

## 5. Architecture

```
btc-cycle-dashboard/
├── index.html          # 单页，所有 section 布局 + CDN 引入
├── css/style.css       # 自定义样式（按钮、全屏、phase-cell、chart-split-handle 等），主体用 Tailwind CDN
├── js/
│   ├── data.js         # DataModule：CSV 解析、指标计算、周期逻辑、前瞻分析引擎、外部 API
│   ├── charts.js       # ChartsModule：所有 Chart.js 图表渲染 + 周报离屏图渲染 + attachModifierZoom
│   ├── report.js       # ReportModule：周报数据组装、HTML 排版、PNG 导出
│   └── app.js          # 入口 init()，事件绑定，把三个模块粘起来
├── data/
│   ├── btc_historical.csv   # BTC 日线历史（2010-07-13 → 最新，分号分隔，降序）
│   ├── mvrv.csv             # MVRV Ratio（CryptoQuant，2009-10 → 最新）
│   ├── realized_price.csv   # Realized Price（CryptoQuant，2014-11 → 最新）
│   ├── nupl.csv             # NUPL（CryptoQuant，2011-05 → 最新）
│   └── etf_flow.csv         # US Spot ETF Net Flow（Farside，2024-01 → 最新）
├── scripts/
│   ├── update_data.py       # 增量更新行情 CSV（CoinMarketCap + Blockchain.info）
│   ├── update_onchain.py    # 增量更新链上 CSV（CryptoQuant: MVRV/Realized/NUPL）
│   └── update_etf.py        # 增量更新 ETF CSV（Farside）
└── .github/workflows/
    └── update-data.yml      # 每天 UTC 01:07 自动跑三个更新脚本并提交
```

### 各模块作用
- **DataModule (`data.js`)** — 数据与计算的唯一来源。CSV 解析、MA/RSI 计算、周线聚合、四年周期分组、周期阶段判定、Mayer、星期统计、**周报前瞻分析引擎**（10 个 analyze 函数）、ETF 滚动净流入、链上指标加载。
- **ChartsModule (`charts.js`)** — 所有可视化。页面上的交互图（`renderPriceChart/renderCycleChart/renderRSIChart/...`），以及**周报专用的离屏图**（`reportCycleImage/reportMAImage/...`，用 `_offscreenChart` 在离屏 canvas 上深色渲染并返回 dataURL）。含 `ZOOM_CONFIG`（滚轮缩 xy，Shift 只缩 y，Ctrl 只缩 x）、`toggleLogScale`、`resetZoom`、`attachModifierZoom`（原生 wheel 处理器，支持多面板独立缩放）、`zoomOneAxis`（安全缩放单轴）。
- **ReportModule (`report.js`)** — `generateReport()` 组装数据；`buildReportElement()` 生成离屏 HTML 排版块；`downloadPNG()` 用 html2canvas 合成单张 PNG；`getReportText()` 纯文本版。
- **app.js** — `init()`：先用 CSV 立即渲染（不被外部 API 阻塞），再异步加载实时价格/稳定币。所有按钮事件（周期切换、RSI 日/周、对数、重置、全屏、导出周报、主题切换、分隔条拖动）在 `setupEventListeners`。

### 数据流
```
CSV(本地) ──► DataModule.loadCSV ──► processedData(升序)
                                       │
        ┌──────────────────────────────┼───────────────────────────┐
        ▼                              ▼                           ▼
   指标计算(MA/RSI/Mayer/周期)   前瞻分析引擎(getReportAnalysis)   页面渲染(ChartsModule)
        │                              │                           │
        ▼                              ▼                           ▼
   概览卡/图表                    ReportModule 周报               交互图表
CoinGecko(实时价) ──► 异步覆盖概览卡价格（失败回退 CSV 最新）
DefiLlama(稳定币) ──► 异步填充增量资金面板
CheckOnChain(iframe) ──► Cointime 估值区（浏览器直接嵌入，非 fetch）
CryptoQuant(API via Actions) ──► 每日更新 mvrv/realized/nupl CSV
Farside(Web scrape via Actions) ──► 每日更新 etf_flow CSV
```

### 状态管理
无框架。全局 `appState = {data, priceInfo, cycleInfo, ...}` 在 app.js。图表实例存在 `ChartsModule.charts[id]`。无响应式，重渲染靠直接调用 render 函数。

### 缓存
- CSV 由浏览器 HTTP 缓存，但加了**每日 cache-bust** (`?v=YYYYMMDD`) 确保每天拉最新。
- JS 文件也加版本号 (`js/charts.js?v=20260722b`) 强制刷新。
- 无 localStorage 缓存（早期链上 API 方案有，已随方案废弃删除）。

### 依赖（全部 CDN）
Tailwind、Chart.js 4.4、chartjs-adapter-date-fns、chartjs-plugin-annotation 3、chartjs-plugin-zoom 2 + hammerjs、html2canvas、jsPDF（**已不用，可删**）。

### 为什么这样设计
- **三模块分层**（数据/图表/报告）便于单独迭代，且周报能复用数据层的计算和图表层的渲染。
- **纯 UMD + 全局对象**（非 ES module / 无打包）：为了 GitHub Pages 直接跑，零构建。**这是刻意的取舍，别引入 webpack/vite 除非有强理由。**

---

## 6. Indicator Library

| 指标 | 用途 | 原理 | 为什么加入 | 未来优化 |
|---|---|---|---|---|
| **四年大周期（日历年模型）** | 判断当前处于牛/熊哪阶段 | `year%4`：0=首轮牛(减半年) 1=次轮牛/顶 2=熊 3=预备牛 | 作者核心框架"3涨1跌" | 结合价格实际走势动态修正语气 |
| **四年周期对比（顶部对齐）** | 历史类比见顶后走势 | 各轮从最高点归一化，横轴=距顶天数 | 推演本轮底部 | 增加"底部对齐"视图；周期4 实时更新 |
| **星期效应** | 短周期规律 | 全历史按 `getDay()` 统计涨概率+均涨幅 | Killa 思路量化 | 扩展：连涨连跌、月内效应 |
| **zZ 指标（MA110/MA6×MA103）** | 趋势与买入信号 | MA110 上穿=上涨信号；MA6 上穿 MA103=金叉买入；含延长线预测 | 替代传统 MA，给明确信号 | 加更多 MA 组合测试 |
| **Mayer Multiple** | 简洁估值 | 价格/MA200 | 无需链上数据即可算的估值 | 加历史分位带 |
| **RSI-14（日+周）** | 强弱与背离 | 标准 RSI | 周线 RSI 是周期底部信号 | 自动检测背离并标注 |
| **MVRV Pricing Bands** | 链上估值 | 已实现价格 × expanding MVRV mean±k·sd | 找顶底 | 已完善 |
| **NUPL** | 情绪/盈亏 | 未实现净盈亏比 | 欣快/投降区 | 已完善 |
| **Realized Price** | 全市场成本 | 链上已实现价格 | 跌破=底部信号 | 已完善 |
| **Cointime Price** | 时间加权成本 | `subset(f2/cumsum(f1))` | 作者文档明确点名 | 本地化（需 Coinblocks 数据） |
| **4Y Risk/Reward Ratio** | 风险回报 | 上行空间/下行风险，基于 realized price × MVRV band | 量化高估/低估 | 已完善 |
| **ETF Net Flow** | 增量资金 | Farside 每日 US Spot ETF 净流量 | 最可靠资金源 | 扩展至全球 ETF |

### 已讨论但未实现的指标
- **Open Interest / 期现溢价 / 资金费率**（期货维度，占位面板存在，未接数据）。
- **法币流入**（文档提及，未实现）。
- **Realized Cap 斜率叠加**（作者文档明确要求"画一个 Realized Cap 的斜率叠加"，未实现）。

---

## 7. Data Sources

| 数据源 | 内容 | 状态 | 备注 |
|---|---|---|---|
| **CSV 本地** (`data/btc_historical.csv`) | BTC 日线 OHLCV（2010→最新） | ✅ 主数据 | CoinMarketCap 导出 + Blockchain.info 补全 |
| **CoinGecko** | 实时价格/24h/市值 | ✅ 接入 | `simple/price`。**从作者本地网络常超时**，失败回退 CSV |
| **Blockchain.info** | 日线收盘价 | ✅ 用于增量更新 | `charts/market-price`。**唯一从作者环境稳定可达的行情源** |
| **DefiLlama** | 稳定币供应/USDT 市值 | ✅ 接入 | `stablecoins.llama.fi`，CORS 友好 |
| **CheckOnChain** | MVRV/NUPL/Realized/Cointime | ✅ iframe 嵌入 | 非 fetch，直接嵌入官方 light HTML 图 |
| **CryptoQuant** | MVRV/Realized Price/NUPL | ✅ 通过 Actions 每日更新 | API key 存为 GitHub Secret `CRYPTOQUANT_KEY` |
| **Farside** | US Spot ETF Net Flow | ✅ 通过 Actions 每日更新 | Web scrape（带浏览器 UA 可过 Cloudflare） |
| **bitcoin-data.com** | MVRV/NUPL 数值 | ❌ 放弃 | **CORS 拦截 + 10次/小时限流**，浏览器不可用（见 §14） |
| **Binance/Coinbase/Kraken/OKX** | 行情/OI | ❌ 不可达 | 作者环境 443 出口受限，全部超时 |
| **Glassnode** | 链上/宏观 | 🔲 计划/需付费 | 目前只作为参考链接 |
| **FRED（宏观）/ Yahoo** | 利率/流动性/传统市场 | 🔲 未接入 | Future Vision 提到宏观维度 |
| **CoinGlass** | OI/资金费率/清算 | 🔲 计划 | 期货面板的目标数据源 |
| **ETF 流入（Farside 等）** | 现货 ETF 资金流 | ✅ 已接入 | 仅 US Spot，可扩展 |

> **关键约束**：作者本地网络到多数交易所/链上 API 出口受限。**GitHub Actions 环境网络更宽松**（CoinGecko/CryptoQuant/Farside 通常可达）——所以数据更新放在 Actions 里跑更合适。

---

## 8. Analysis Logic

当前周报的分析顺序（`getReportAnalysis()` 返回顺序）：

```
四年大周期(时间/历史类比)
   ↓
zZ 指标(MA110 上涨/MA6×MA103 金叉)
   ↓
Mayer Multiple(估值)
   ↓
MVRV 估值带(链上)
   ↓
已实现价格(成本)
   ↓
NUPL(情绪)
   ↓
4Y Risk/Reward(风险回报)
   ↓
RSI(强弱)
   ↓
ETF 资金流(增量)
   ↓
Cointime(时间加权成本)
```

**为什么这样排序**：从**大到小、从慢变量到快变量**——先定位大周期（年级别），再看均线趋势（月级别），再看估值高低，最后看短期强弱和链上情绪。作者认可的逻辑是"先知道在周期哪，再看具体指标"。

**作者理想中的完整链条**（Future Vision，尚未全部实现）：
```
宏观(利率/流动性) → ETF/增量资金 → 链上(MVRV/NUPL/Realized) → 估值(Mayer/Cointime) → 情绪(RSI/星期) → 周期位置 → 风险 → 结论
```
即"自上而下"：宏观流动性是水源，资金流入是推力，链上/估值是位置，情绪是噪声，最终收敛到一个周期研判结论。**当前实现覆盖了大部分，宏观端待补。**

---

## 9. Prompt Memory（原作者反复强调的）

### 经常强调的话
- "**抓最新数据再分析**"——数据必须新，会亲自核对日期。
- "**按这个思路**"——给例子时是给思路模板，不是让照抄；要举一反三。
- "**瞎说的，按这个思路**"——作者会给一个瞎编的例子来传达**格式/口吻**，要理解意图而非字面。

### 不要做什么
- **不要编造数据/公式**（早期瞎编 MVRV 被删）。
- **不要照抄 Killa**（要自己统计规律）。
- **不要留错误数据**（周期4 天数因数据旧算错被指出）。
- **不要引入后端/构建工具**（保持纯前端可 Pages 部署）。

### 必须保持
- 四年周期 = **日历年 3涨1跌模型**（`year%4`），不是减半进度条。
- 诚实标注数据来源与"近似值"。
- 免责声明。

### Coding Style
- 纯 UMD + 全局模块对象（`DataModule/ChartsModule/ReportModule`），无 import/export。
- 中文注释、中文 UI。
- 提交信息用英文、规范（feat/fix/chore/ci/data 前缀），带 `Co-Authored-By: Claude`。
- 改动后**用 Playwright 无头浏览器截图/取值验证**再提交（这是本项目的验证惯例）。

### UI Style
- 深色 `#0f0f23`/`#1a1a2e`，比特币金 `#f7931a`，绿涨 `#00d395` 红跌 `#ff4757`；亮色默认白底灰字。
- 卡片式 `rounded-xl border border-gray-700`。
- 图表：可缩放、对数切换、全屏、重置。信息密度高但不拥挤。
- 多面板图（MVRV/ETF）中间有可拖动分隔条调上下比例。

### 分析原则
- 前瞻性：给日期+价格区间的推演。
- 历史类比：用过去 3 轮周期的区间推本轮。
- 多维交叉，量化+定性结合。

---

## 10. TODO

### 高优先级
- [ ] **期货面板接数据**：OI / 资金费率 / 期现溢价（CoinGlass 或其他免费源）。
- [ ] **Cointime 本地化**：找到免费 API 或数据源，自绘 Cointime Price 图，进入周报量化。
- [ ] **Realized Cap 斜率叠加**（作者文档明确要求"画一个 Realized Cap 的斜率叠加"）。

### 中优先级
- [ ] **ETF 扩展至全球**：目前仅 US Spot，可加 Canada/Europe ETF 流量。
- [ ] **星期效应扩展**：连涨连跌、月份效应。
- [ ] **RSI 背离自动检测并标注**。
- [ ] **周期对比图加"底部对齐"视图**。

### 低优先级
- [ ] **宏观维度**（利率/流动性/DXY，FRED）。
- [ ] **移动端适配细化**。
- [ ] **周报增加"综合结论"段**（把各指标收敛成一句话研判）。
- [ ] **删除无用的 jsPDF CDN**。

---

## 11. Known Problems

- **补全数据是近似 OHLC**：`update_data.py` 从 Blockchain.info 只拿到收盘价，`open=前收，high/low=收盘±1.2%，volume/marketCap=估算`。周期分析用 `close` 不受影响，但**成交量图、K 线 high/low 在补全段是假的**。footer 已标注来源。
- **Cointime 进不了周报量化**：仍是 iframe，周报里只能定性描述。
- **CoinGecko 从作者本地常超时**：已做回退（用 CSV 最新价），但"实时价"可能不是真实时。
- **期货/ETF 面板部分占位**：期货仍未接数据；ETF 仅 US Spot。
- **技术债**：`attachModifierZoom` 的 `axisAtY` 在极窄窗口下可能误判面板；JS 缓存版本号需手动 bump。
- **jsPDF 仍在 CDN**但已无用（周报改 PNG 后）。

---

## 12. Future Vision

原作者希望的最终形态（从整个对话推断）：

不只是"图表看板"，而是一个**个人化的、自动化的 BTC 周期研判系统**：
1. **覆盖完整分析链条**：宏观流动性 → 增量资金(ETF/稳定币/法币) → 链上估值(MVRV/NUPL/Realized/Cointime) → 技术估值(zZ/Mayer/RSI) → 时间周期(四年/星期) → 风险 → **自动收敛出一个周期位置结论**。
2. **前瞻性研判**：不只报现状，给出"未来 X 时间可能到 X 位置"的概率化推演。
3. **一键生成可分享的观点周报**（PNG/图文），随时发出去或存档，形成研究记录。
4. **数据自动保鲜**：无需手动，定时更新（已有 GitHub Actions 全覆盖）。
5. 最终是作者自己长期使用、持续迭代的**周期研究工作台**。

---

## 13. AI Suggestions（给接手 AI）

### 千万不要改
- **四年周期的 `year%4` 日历年模型**——这是作者的核心认知，改了就错。
- **纯前端无构建**架构——别引入打包器/框架。
- **"不编造数据"原则**——宁可留空/嵌入官方图，也不要伪造数字。
- **深色金融配色**和主色 `#f7931a`。

### 值得继续优化
- Cointime 本地化（最大价值点，能让周报完整）。
- 期货/ETF/宏观数据接入（补全分析链条）。
- 周报的"综合结论"自动生成。

### 强烈建议
- **改完必须用 Playwright 无头浏览器验证**（本项目惯例）：加载页面→取 `ChartsModule.charts`/`DataModule.getReportAnalysis()` 的值→截图确认→再提交。测试时用 `page.route` 屏蔽 `checkonchain.com`（iframe 会拖慢 networkidle）。
- **数据日期先核对**：任何周期结论前先确认 CSV 到最新。
- **推送注意**：作者网络下 `github.com` 主域时常波动（`Recv failure`/`Empty reply`），但 `api.github.com` 通。此时用 GitHub API（blob→tree→commit→update ref）推送，再在 `github.com` 恢复后 `git fetch && git reset --hard origin/master` 同步本地。

---

## 14. Conversation Insights（开发过程的关键决策与踩坑）

### 最重要的一次纠正：四年周期模型
- **最初**我把四年周期做成"减半后天数进度条 + 牛市初期/中期"。
- **作者指出"周期的计算肯定是错的"**，并让我**仔细读文档里的配图**。
- 我提取了 docx 里的 9 张图，发现真正的模型是 **Bitcoin 1W 图上的"3 年涨 + 1 年跌"日历年循环**：Bear(2014/18/22/26)、Pre-Bull(15/19/23/27)、1st Bull(16/20/24/28)、2nd Bull(17/21/25/29)。据此重写为 `year%4` 模型，2026=熊年。
- **教训**：作者给的参考文档/图必须逐一看完，不能只读文字。

### 被否决的方案
1. **瞎编 MVRV 公式**（早期）→ 作者要求全删，改嵌入官方图。**否决原因：伪造数据。**
2. **bitcoin-data.com 免费链上 API** → 实测浏览器 CORS 拦截 + 10次/小时限流；公共 CORS 代理(corsproxy.io/allorigins)也不稳定 → 放弃，改嵌入 CheckOnChain。**否决原因：不可靠。**
3. **周期对比从减半年对齐** → 作者要求改成**从各轮最高点对齐**。
4. **周期最低点标注用"剩余倍数"（0.23x）** → 含义易误解，改成**跌幅%（-76.6%）**。

### 关键踩坑
- **数据陈旧**：CSV 停在 2026-04，导致周期4 显示"122 天"错误。作者亲自算出不对。补全到 2026-07-15 后变成正确的 268 天/-53.1%。→ 催生了 `update_data.py` + GitHub Actions 自动更新。
- **CheckOnChain 图 404**：我最初猜的 iframe URL 全是 404，抓官方首页真实链接才修好。→ **不要猜第三方 URL，去抓真实的。**
- **缩放手感**：先是 `mode:'xy'`（乱跳）→ 改 `mode:'x'`（纵轴不能调，被投诉）→ 最终用原生 wheel 处理器 + `zoomScale`，支持 Shift/Ctrl 分轴。
- **网络推送**：多次 `github.com` 不可达但 `api.github.com` 通，靠 API 推送绕过。
- **RSI 缩放方向**：作者反馈"只能缩小不能放大"，实测代码双向正常，根因是浏览器缓存旧 JS。→ 加 JS 版本号 `?v=` 强制刷新。

### 经验
- 作者会**亲自验算数据**，糊弄不过去。
- 作者给"瞎编的例子"是传达**格式和思路**，要理解意图。
- 每次改动都截图验证，避免"我以为对了"。

---

## 15. Hidden Knowledge（代码里看不到、只有聊天才知道）

1. **四年周期 `year%4` 的映射**来自 docx 里一张 TradingView 周线配图（Bear/Pre-Bull/1st Bull/2nd Bull 四色分区），不是我发明的，是作者的既有框架。**改这个 = 违背作者认知。**
2. **周期对比"从最高点对齐"**是作者第二次明确要求（`C:\Users\...\Downloads\image.png` 那张带标注的参考图），且标注要显示**跌幅%**。
3. **链上指标为什么是 iframe 而不是本地算**：不是偷懒，是**实测所有免费链上 API 在浏览器都拿不到数据**（CORS+限流），作者主动选择"嵌入官方图+诚实说明"。将来若有可靠数据源，应本地化。
4. **数据源为什么是 Blockchain.info**：不是首选，是**作者本地网络下唯一稳定可达的行情源**（CoinGecko/Binance 等都超时）。GitHub Actions 里 CoinGecko/CryptoQuant/Farside 可达，所以更新脚本都用它们。
5. **补全段 OHLC 是近似的**：只有收盘价真实，high/low/volume 是估算。**周期分析故意只用 close** 就是因为这个。
6. **周报的前瞻推演算法**：用过去 3 轮周期的[见底天数区间]和[跌幅区间]，套在本轮高点日期/价格上，外推出低点的日期窗口和价格窗口。MA 突破天数是**假设价格维持不变、模拟 MA 每日把最旧一天替换成当前价**来估算收敛日。这些是"若历史规律成立"的推演，**不是预测**，措辞刻意保守。
7. **星期效应要"自己统计"**：作者明确不要照抄 Killa 的结论，要用本地历史数据算出上涨概率+平均涨幅，并**标注在真实 K 线上**。
8. **`init()` 先渲染 CSV 再异步加载外部数据**：是因为 CoinGecko 常超时，若等它会白屏——刻意让本地数据先出。
9. **GitHub Pages schedule 陷阱**：GitHub 对定时 Actions 有"仓库 60 天无 push 则暂停 schedule"的规则（已在交付时提醒作者）。
10. **作者的 PAT 在对话中多次出现**——交付时已多次建议吊销重建。接手 AI 若看到硬编码 token，应提醒作者，别复用。
11. **jsPDF 是历史遗留**：周报最初是 PDF，后改 PNG，CDN 没删干净。
12. **ETF 资金流的"同步共振"特性**：作者通过数据分析发现 ETF 净流量与当日价格涨跌相关系数 ~0.39（最高），但预测性弱；真正有信号价值的是**近 20 日滚动净流入的正负**（流入期未来 20 日平均 +2.25%，流出期 -0.64%）。这一洞察直接指导了 ETF 图的设计（价格按 20 日滚动净流入着色）。
13. **zZ 指标的命名**："zZ" 是作者随口起的代号，实际含义是"4Y Rolling Best MA"的示意性注释，非精确算法名。保留此名是为了尊重作者习惯。
14. **分隔条 UX 决策**：作者要求 MVRV/ETF 的上下图大小可调，最初用顶部滑块，后改为两图中间的悬浮拖动把手（更直观）。ETF 有三栏，故加两条分隔条。

---

# AI Quick Start（5 分钟上手）

**这是什么**：纯前端 BTC 周期分析看板 + 周报 PNG 导出。GitHub Pages 托管，零构建。

**技术栈**：原生 HTML/CSS/JS（无框架无打包）+ Tailwind CDN + Chart.js(+annotation+zoom) + html2canvas。四个全局模块：`DataModule`(data.js 数据/计算/分析) / `ChartsModule`(charts.js 图表+周报离屏图) / `ReportModule`(report.js 周报 PNG) / `app.js`(入口)。

**核心认知（别改错）**：
- 四年周期 = **日历年 3涨1跌**，`year % 4`：0=首轮牛/减半年 1=次轮牛/顶部年 2=熊市 3=预备牛。2026=熊年。
- 数据主源是 `data/` 下的五个 CSV（行情 + MVRV + Realized + NUPL + ETF），由 GitHub Actions 每日自动更新。
- 周报分析顺序：周期 → zZ → Mayer → MVRV → Realized → NUPL → R/R → RSI → ETF → Cointime。

**铁律**：
1. 不编造数据（没数据就嵌官方图/留空/定性）。
2. 数据要新（改周期结论前先确认 CSV 到最新）。
3. 纯前端、不引入构建工具。
4. 深色金融主色 `#f7931a`，但也支持亮色主题。
5. 改完 Playwright 无头验证。

**跑起来**：
```bash
cd btc-cycle-dashboard
python -m http.server 8765      # 打开 http://localhost:8765
python scripts/update_data.py   # 手动增量更新行情数据（幂等）
python scripts/update_onchain.py # 手动更新链上数据（需设 CRYPTOQUANT_KEY 环境变量）
python scripts/update_etf.py     # 手动更新 ETF 数据
```

**验证套路**（惯例）：
```python
# playwright 无头：屏蔽 checkonchain iframe，等 CSV 加载，取值/截图
page.route("**/*", lambda r: r.abort() if "checkonchain.com" in r.request.url else r.continue_())
page.wait_for_function("() => DataModule.processedData.length > 100")
page.evaluate("() => DataModule.getReportAnalysis()")   # 看分析文本
page.evaluate("() => ChartsModule.charts")              # 看图表实例
```

**推送**：正常 `git push`。若 `github.com` 超时但 `api.github.com` 通（作者网络常见），用 GitHub API（blob→tree→commit→update ref）推送，事后 `git fetch && git reset --hard origin/master` 同步本地。

**当前状态**：核心看板+周期模型+周报 PNG+ETF 三栏图+链上指标本地化+zZ 指标+可拖动分隔条+修饰键独立缩放均已完成稳定。**下一步最有价值**：Cointime 本地化、期货数据接入、宏观维度补充。
