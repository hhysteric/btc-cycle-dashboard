let currentReport = null;
let appState = { data: null, priceInfo: null, cycleInfo: null };

// 主题：默认亮色，读 localStorage。要在渲染任何图表前先确定，保证首屏配色正确。
function applyInitialTheme() {
    const saved = localStorage.getItem('theme');
    const theme = saved === 'dark' ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    ChartsModule.setTheme(theme);
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// 私人周报入口：仅当 URL 含 #report 或 ?report 时显示导出按钮
function maybeShowReportEntry() {
    const has = location.hash === '#report' || new URLSearchParams(location.search).has('report');
    if (has) document.getElementById('btn-export-report').classList.remove('hidden');
}

async function init() {
    applyInitialTheme();
    maybeShowReportEntry();

    const data = await DataModule.loadCSV();
    if (!data.length) {
        console.error('数据加载失败，请确保 data/btc_historical.csv 文件存在');
        return;
    }
    // 链上 CSV 与行情并行加载；失败不阻塞主看板
    await DataModule.loadOnchainCSV();

    // 先用 CSV 数据（本地即可得）立即渲染，不被外部 API 阻塞
    const latest = DataModule.getLatest();
    const prev = data[data.length - 2];
    let priceInfo = {
        price: latest.close,
        change24h: prev ? ((latest.close - prev.close) / prev.close) * 100 : 0,
        marketCap: latest.marketCap
    };
    const cycleInfo = DataModule.getCyclePhase();
    appState = { data, priceInfo, cycleInfo };

    updateOverview(priceInfo, cycleInfo);
    highlightCurrentPhase(cycleInfo);
    renderPriceCharts(data);
    setupEventListeners(data, priceInfo, cycleInfo);

    document.getElementById('last-update').textContent = '更新: ' + new Date().toLocaleTimeString('zh-CN');

    // 外部数据异步加载，失败时保留 CSV 数值
    loadLivePrice(cycleInfo);
    loadCapitalFlowSection();
}

async function loadLivePrice(cycleInfo) {
    const live = await DataModule.fetchLivePrice();
    if (live && live.price) {
        appState.priceInfo = live;
        updateOverview(live, cycleInfo);
        document.getElementById('last-update').textContent = '更新: ' + new Date().toLocaleTimeString('zh-CN') + '（实时）';
    }
}

function daysToNextHalving() {
    const next = new Date('2028-04-01');
    const now = new Date();
    return Math.max(0, Math.round((next - now) / (1000 * 60 * 60 * 24)));
}

function updateOverview(priceInfo, cycleInfo) {
    if (priceInfo) {
        document.getElementById('current-price').textContent = '$' + priceInfo.price.toLocaleString(undefined, { maximumFractionDigits: 0 });
        const changeEl = document.getElementById('price-change');
        const changeVal = priceInfo.change24h;
        changeEl.textContent = (changeVal >= 0 ? '+' : '') + changeVal.toFixed(2) + '% (24h)';
        changeEl.className = 'text-sm mt-1 ' + (changeVal >= 0 ? 'text-accent-green' : 'text-accent-red');
        document.getElementById('market-cap').textContent = '$' + (priceInfo.marketCap / 1e9).toFixed(0) + 'B';
    }

    const phaseEl = document.getElementById('cycle-phase');
    phaseEl.textContent = cycleInfo.phase;
    phaseEl.style.color = cycleInfo.phaseColor;
    document.getElementById('cycle-year').textContent = `${cycleInfo.year} 年 · 周期进度 ${(cycleInfo.progress * 100).toFixed(0)}%`;
    document.getElementById('next-halving').textContent = daysToNextHalving() + ' 天';

    // 周期模型说明与进度条
    document.getElementById('cycle-year-note').textContent = `当前 ${cycleInfo.year} 年（${cycleInfo.year}÷4 余 ${cycleInfo.year % 4}）→ ${cycleInfo.phase}。`;
    document.getElementById('cycle-progress-bar').style.width = (cycleInfo.progress * 100) + '%';
    document.getElementById('cycle-start-label').textContent = cycleInfo.cycleAnchorYear + '年初(减半)';
    document.getElementById('cycle-end-label').textContent = (cycleInfo.cycleAnchorYear + 4) + '年(下次减半)';
}

function highlightCurrentPhase(cycleInfo) {
    document.querySelectorAll('.phase-cell').forEach(cell => {
        cell.classList.remove('current');
        cell.style.color = '';
        if (cell.dataset.phase === cycleInfo.phaseKey) {
            cell.classList.add('current');
            cell.style.color = cycleInfo.phaseColor;
        }
    });
}

function renderPriceCharts(data) {
    ChartsModule.renderPriceChart(data, 365);
    ChartsModule.renderCycleChart(DataModule.getCycleData());

    const pattern = DataModule.getWeekdayPattern();
    ChartsModule.renderWeekdayChart(pattern.stats);
    ChartsModule.renderWeekdayPriceChart(data, pattern);
    const wsEl = document.getElementById('weekday-summary');
    if (wsEl) wsEl.textContent = pattern.summary;

    ChartsModule.renderRSIChart(data, 'weekly');
    ChartsModule.renderVolumeChart(data);
    ChartsModule.renderMayerChart(data);
    ChartsModule.renderMvrvChart(true);

    const mayer = DataModule.getMayerMultiple();
    if (mayer != null) {
        const el = document.getElementById('mayer-current');
        el.textContent = mayer.toFixed(2) + 'x';
        el.style.color = mayer > 2.4 ? '#ff4757' : mayer < 1 ? '#00d395' : '#f7931a';
    }

    const mvrvCur = DataModule.getMvrvCurrent();
    const mvrvEl = document.getElementById('mvrv-current');
    if (mvrvCur && mvrvEl) {
        mvrvEl.textContent = 'MVRV ' + mvrvCur.mvrv.toFixed(2) + '（' + mvrvCur.zone + '）';
    } else if (mvrvEl) {
        mvrvEl.textContent = '链上数据未加载';
    }
}

// 主题切换：切 class、存 localStorage、更新按钮、重渲染所有交互图（离屏周报图不受影响）
function toggleTheme() {
    const toDark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', toDark);
    localStorage.setItem('theme', toDark ? 'dark' : 'light');
    ChartsModule.setTheme(toDark ? 'dark' : 'light');
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.textContent = toDark ? '☀️' : '🌙';
    if (appState.data) renderPriceCharts(appState.data);
}

async function loadCapitalFlowSection() {
    const sc = await DataModule.fetchStablecoinSupply();
    if (sc) {
        document.getElementById('usdt-mcap').textContent = '$' + (sc.usdt / 1e9).toFixed(1) + 'B';
        document.getElementById('stablecoin-supply').textContent = '$' + (sc.total / 1e9).toFixed(1) + 'B';
    }
}

function setupEventListeners(data, priceInfo, cycleInfo) {
    document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);

    document.querySelectorAll('.chart-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.chart-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const period = btn.dataset.period === 'all' ? 'all' : parseInt(btn.dataset.period);
            ChartsModule.renderPriceChart(data, period);
        });
    });

    document.querySelectorAll('.rsi-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.rsi-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            ChartsModule.renderRSIChart(data, btn.dataset.tf);
        });
    });

    document.querySelectorAll('.zoom-reset-btn').forEach(btn => {
        btn.addEventListener('click', () => ChartsModule.resetZoom(btn.dataset.chart));
    });

    // 纵轴 线性/对数 切换
    document.querySelectorAll('.log-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const next = ChartsModule.toggleLogScale(btn.dataset.chart, btn.dataset.axis || 'y');
            if (next) btn.classList.toggle('active', next === 'logarithmic');
        });
    });

    // 全屏 / 退出全屏
    document.querySelectorAll('.fullscreen-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const el = document.getElementById(btn.dataset.target);
            if (!el) return;
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else if (el.requestFullscreen) {
                el.requestFullscreen();
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
            }
        });
    });

    // 全屏切换时重绘 Chart.js 图表以适应新尺寸，并更新按钮文案
    document.addEventListener('fullscreenchange', () => {
        const fsEl = document.fullscreenElement;
        document.querySelectorAll('.fullscreen-btn').forEach(b => {
            b.textContent = (fsEl && fsEl.id === b.dataset.target) ? '退出全屏' : '全屏';
        });
        setTimeout(() => {
            Object.values(ChartsModule.charts).forEach(c => c && c.resize());
        }, 120);
    });

    // 点私人入口 → 打开配置面板（第一步）
    document.getElementById('btn-export-report').addEventListener('click', () => {
        openReportConfig(cycleInfo, data);
    });

    // 生成预览（第二步）
    document.getElementById('btn-report-generate').addEventListener('click', () => {
        buildReportPreview(cycleInfo, data);
    });

    // 返回配置
    document.getElementById('btn-report-back').addEventListener('click', () => {
        document.getElementById('report-preview').classList.add('hidden');
        document.getElementById('report-config').classList.remove('hidden');
    });

    document.querySelectorAll('.close-modal-btn').forEach(b =>
        b.addEventListener('click', closeReportModal));

    document.getElementById('report-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('report-modal')) closeReportModal();
    });

    document.getElementById('btn-download-png').addEventListener('click', async () => {
        if (!currentReport) return;
        const btn = document.getElementById('btn-download-png');
        const orig = btn.textContent;
        btn.textContent = '生成中...';
        btn.disabled = true;
        try {
            await ReportModule.downloadPNG(currentReport);
        } catch (e) {
            console.error('PNG 导出失败', e);
            alert('PNG 导出失败: ' + e.message);
        }
        btn.textContent = orig;
        btn.disabled = false;
    });

    document.getElementById('btn-copy-text').addEventListener('click', () => {
        if (currentReport) {
            const text = ReportModule.getReportText(currentReport);
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.getElementById('btn-copy-text');
                btn.textContent = '已复制!';
                setTimeout(() => { btn.textContent = '复制文本'; }, 2000);
            });
        }
    });
}

// ===== 周报配置面板 =====
const CHARTABLE_KEYS = ['cycle', 'ma', 'mayer', 'mvrv', 'rsi']; // 有图可裁剪的指标

function closeReportModal() {
    document.getElementById('report-modal').classList.add('hidden');
    // 清理 mini 图
    CHARTABLE_KEYS.forEach(k => ChartsModule.destroyMini(k));
}

// 打开配置面板：为每个可选指标生成勾选框、可编辑观点、可裁剪小图
function openReportConfig(cycleInfo, data) {
    const modal = document.getElementById('report-modal');
    modal.classList.remove('hidden');
    document.getElementById('report-preview').classList.add('hidden');
    document.getElementById('report-config').classList.remove('hidden');

    const list = document.getElementById('report-config-list');
    list.innerHTML = '';
    const analysis = ReportModule.getAllAnalysis();

    for (const a of analysis) {
        const hasChart = CHARTABLE_KEYS.includes(a.key);
        const item = document.createElement('div');
        item.className = 'border border-gray-700 rounded-lg p-4';
        item.dataset.key = a.key;
        item.innerHTML = `
            <label class="flex items-center gap-2 mb-3 cursor-pointer">
                <input type="checkbox" class="rpt-sel w-4 h-4 accent-yellow-500" data-key="${a.key}" checked>
                <span class="font-semibold text-accent-gold">${a.title}</span>
            </label>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                    ${hasChart ? `
                    <div class="h-48 bg-dark-900 rounded mb-2"><canvas class="rpt-mini" data-key="${a.key}"></canvas></div>
                    <div class="flex gap-2 items-center">
                        <button class="rpt-crop text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded" data-key="${a.key}">用当前视图裁剪</button>
                        <button class="rpt-crop-reset text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded" data-key="${a.key}">全图</button>
                        <span class="rpt-crop-state text-xs text-gray-400" data-key="${a.key}">全图</span>
                    </div>
                    <p class="text-xs text-gray-500 mt-1">滚轮/Shift+拖框缩放，拖动平移，框好后点「用当前视图裁剪」</p>
                    ` : `<div class="text-xs text-gray-500 h-48 flex items-center justify-center bg-dark-900 rounded">该指标无本地图表</div>`}
                </div>
                <div class="space-y-2">
                    <div>
                        <div class="text-xs text-blue-300 mb-1">当前位置</div>
                        <textarea class="rpt-position w-full bg-dark-900 border border-gray-700 rounded p-2 text-sm text-gray-200" rows="4" data-key="${a.key}">${a.position}</textarea>
                    </div>
                    <div>
                        <div class="text-xs text-yellow-300 mb-1">后市展望</div>
                        <textarea class="rpt-outlook w-full bg-dark-900 border border-gray-700 rounded p-2 text-sm text-gray-200" rows="4" data-key="${a.key}">${a.outlook}</textarea>
                    </div>
                </div>
            </div>`;
        list.appendChild(item);
    }

    // 渲染 mini 图（需等 DOM 插入后）
    reportCrops = {};
    setTimeout(() => {
        document.querySelectorAll('.rpt-mini').forEach(cv => {
            ChartsModule.renderReportMini(cv.dataset.key, cv);
        });
    }, 30);

    // 裁剪按钮
    list.querySelectorAll('.rpt-crop').forEach(btn => btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const crop = ChartsModule.getMiniCrop(key);
        if (crop) {
            reportCrops[key] = crop;
            setCropState(key, '已裁剪当前视图');
        }
    }));
    list.querySelectorAll('.rpt-crop-reset').forEach(btn => btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        delete reportCrops[key];
        if (ChartsModule.miniCharts[key]) ChartsModule.miniCharts[key].resetZoom();
        setCropState(key, '全图');
    }));
}

let reportCrops = {};
function setCropState(key, text) {
    const el = document.querySelector(`.rpt-crop-state[data-key="${key}"]`);
    if (el) el.textContent = text;
}

// 读取配置 → 生成周报预览（第二步）
function buildReportPreview(cycleInfo, data) {
    const selectedKeys = Array.from(document.querySelectorAll('.rpt-sel'))
        .filter(cb => cb.checked).map(cb => cb.dataset.key);
    const edits = {};
    document.querySelectorAll('.rpt-position').forEach(t => {
        edits[t.dataset.key] = edits[t.dataset.key] || {};
        edits[t.dataset.key].position = t.value;
    });
    document.querySelectorAll('.rpt-outlook').forEach(t => {
        edits[t.dataset.key] = edits[t.dataset.key] || {};
        edits[t.dataset.key].outlook = t.value;
    });

    const weekdayStats = DataModule.getWeekdayStats();
    currentReport = ReportModule.generateReport(appState.priceInfo, cycleInfo, weekdayStats, data,
        { selectedKeys, crops: reportCrops, edits });

    const content = document.getElementById('report-content');
    content.innerHTML = '';
    const el = ReportModule.buildReportElement(currentReport);
    el.style.width = '100%';
    el.style.padding = '0';
    el.style.background = 'transparent';
    content.appendChild(el);

    document.getElementById('report-config').classList.add('hidden');
    document.getElementById('report-preview').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', init);
