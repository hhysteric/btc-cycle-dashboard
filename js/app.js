let currentReport = null;
let appState = { data: null, priceInfo: null, cycleInfo: null };

async function init() {
    const data = await DataModule.loadCSV();
    if (!data.length) {
        document.getElementById('summary-content').innerHTML = '<p class="text-red-400">数据加载失败，请确保 data/btc_historical.csv 文件存在</p>';
        return;
    }

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
    updateAnalysisSummary(priceInfo, cycleInfo, data);
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
    ChartsModule.renderWeekdayChart(DataModule.getWeekdayStats());
    ChartsModule.renderRSIChart(data, 'daily');
    ChartsModule.renderVolumeChart(data);
    ChartsModule.renderMayerChart(data);

    const mayer = DataModule.getMayerMultiple();
    if (mayer != null) {
        const el = document.getElementById('mayer-current');
        el.textContent = mayer.toFixed(2) + 'x';
        el.style.color = mayer > 2.4 ? '#ff4757' : mayer < 1 ? '#00d395' : '#f7931a';
    }
}

async function loadCapitalFlowSection() {
    const sc = await DataModule.fetchStablecoinSupply();
    if (sc) {
        document.getElementById('usdt-mcap').textContent = '$' + (sc.usdt / 1e9).toFixed(1) + 'B';
        document.getElementById('stablecoin-supply').textContent = '$' + (sc.total / 1e9).toFixed(1) + 'B';
    }
}

function updateAnalysisSummary(priceInfo, cycleInfo, data) {
    const trend = DataModule.getTrendState();
    const latest = data[data.length - 1];

    let trendLabel = '中性';
    let trendColor = 'text-gray-300';
    if (trend.aboveMA50 && trend.aboveMA200 && trend.ma50 > trend.ma200) {
        trendLabel = '多头排列'; trendColor = 'text-accent-green';
    } else if (!trend.aboveMA50 && !trend.aboveMA200 && trend.ma50 < trend.ma200) {
        trendLabel = '空头排列'; trendColor = 'text-accent-red';
    } else if (trend.aboveMA200) {
        trendLabel = '中期偏多'; trendColor = 'text-accent-green';
    }

    const html = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="p-3 bg-dark-700 rounded-lg">
                <p class="text-gray-400 text-xs">趋势判断（均线）</p>
                <p class="font-semibold ${trendColor}">${trendLabel}</p>
            </div>
            <div class="p-3 bg-dark-700 rounded-lg">
                <p class="text-gray-400 text-xs">四年周期年份（${cycleInfo.year}）</p>
                <p class="font-semibold" style="color:${cycleInfo.phaseColor}">${cycleInfo.phase}</p>
            </div>
            <div class="p-3 bg-dark-700 rounded-lg">
                <p class="text-gray-400 text-xs">周期进度</p>
                <p class="font-semibold">${(cycleInfo.progress * 100).toFixed(1)}%</p>
            </div>
        </div>
        <div class="mt-3 p-3 bg-dark-700 rounded-lg">
            <p class="text-gray-400 text-xs mb-1">周期定位</p>
            <p>${cycleInfo.detail}</p>
        </div>
        <div class="mt-3 p-3 bg-dark-700 rounded-lg">
            <p class="text-gray-400 text-xs mb-1">均线水平</p>
            <p>MA50: $${trend.ma50 ? trend.ma50.toFixed(0) : 'N/A'} · MA200: $${trend.ma200 ? trend.ma200.toFixed(0) : 'N/A'} · 现价: $${latest.close.toFixed(0)}</p>
        </div>
    `;
    document.getElementById('summary-content').innerHTML = html;
}

function setupEventListeners(data, priceInfo, cycleInfo) {
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

    document.getElementById('btn-export-report').addEventListener('click', () => {
        const weekdayStats = DataModule.getWeekdayStats();
        currentReport = ReportModule.generateReport(appState.priceInfo, cycleInfo, weekdayStats, data);
        document.getElementById('report-content').innerHTML = ReportModule.renderReportHTML(currentReport);
        document.getElementById('report-modal').classList.remove('hidden');
    });

    document.getElementById('close-modal').addEventListener('click', () => {
        document.getElementById('report-modal').classList.add('hidden');
    });

    document.getElementById('report-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('report-modal')) {
            document.getElementById('report-modal').classList.add('hidden');
        }
    });

    document.getElementById('btn-download-pdf').addEventListener('click', () => {
        if (currentReport) ReportModule.downloadPDF(currentReport);
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

document.addEventListener('DOMContentLoaded', init);
