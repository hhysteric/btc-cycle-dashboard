let currentReport = null;

async function init() {
    const data = await DataModule.loadCSV();
    if (!data.length) {
        document.getElementById('summary-content').innerHTML = '<p class="text-red-400">数据加载失败，请确保 data/btc_historical.csv 文件存在</p>';
        return;
    }

    const priceInfo = await DataModule.fetchLivePrice();
    const cycleInfo = DataModule.getCyclePhase();

    updateOverview(priceInfo, cycleInfo);
    renderAllCharts(data);
    updateAnalysisSummary(priceInfo, cycleInfo, data);
    setupEventListeners(data, priceInfo, cycleInfo);

    document.getElementById('last-update').textContent = '更新: ' + new Date().toLocaleTimeString('zh-CN');
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

    document.getElementById('cycle-phase').textContent = cycleInfo.phase;
    document.getElementById('cycle-detail').textContent = cycleInfo.detail;
    document.getElementById('cycle-progress-bar').style.width = (cycleInfo.progress * 100) + '%';
    document.getElementById('next-halving').textContent = cycleInfo.daysToNext + ' 天';
}

function renderAllCharts(data) {
    ChartsModule.renderPriceChart(data, 365);
    ChartsModule.renderCycleChart(DataModule.getCycleData());
    ChartsModule.renderWeekdayChart(DataModule.getWeekdayStats());
    ChartsModule.renderRSIChart(data);
    ChartsModule.renderMVRVChart(data);
    ChartsModule.renderVolumeChart(data);
}

function updateAnalysisSummary(priceInfo, cycleInfo, data) {
    const latest = data[data.length - 1];
    const ma50 = DataModule.calculateMA(data.slice(-50), 50);
    const ma200 = DataModule.calculateMA(data.slice(-200), 200);
    const currentMa50 = ma50[ma50.length - 1];
    const currentMa200 = ma200[ma200.length - 1];

    let trend = '中性';
    let trendColor = 'text-gray-300';
    if (latest.close > currentMa50 && currentMa50 > currentMa200) {
        trend = '多头排列'; trendColor = 'text-accent-green';
    } else if (latest.close < currentMa50 && currentMa50 < currentMa200) {
        trend = '空头排列'; trendColor = 'text-accent-red';
    }

    const html = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="p-3 bg-dark-700 rounded-lg">
                <p class="text-gray-400 text-xs">趋势判断</p>
                <p class="font-semibold ${trendColor}">${trend}</p>
            </div>
            <div class="p-3 bg-dark-700 rounded-lg">
                <p class="text-gray-400 text-xs">周期阶段</p>
                <p class="font-semibold text-accent-gold">${cycleInfo.phase}</p>
            </div>
            <div class="p-3 bg-dark-700 rounded-lg">
                <p class="text-gray-400 text-xs">周期进度</p>
                <p class="font-semibold">${(cycleInfo.progress * 100).toFixed(1)}%</p>
            </div>
        </div>
        <div class="mt-3 p-3 bg-dark-700 rounded-lg">
            <p class="text-gray-400 text-xs mb-1">分析提示</p>
            <p>${cycleInfo.detail}。MA50: $${currentMa50 ? currentMa50.toFixed(0) : 'N/A'}, MA200: $${currentMa200 ? currentMa200.toFixed(0) : 'N/A'}</p>
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

    document.getElementById('btn-export-report').addEventListener('click', () => {
        const weekdayStats = DataModule.getWeekdayStats();
        currentReport = ReportModule.generateReport(priceInfo, cycleInfo, weekdayStats, data);
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
