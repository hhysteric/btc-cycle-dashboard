// 四年大周期对比（从各轮最低点对齐）—— 独立扩展模块
// 与 charts.js 的 renderCycleChart（从各轮最高点对齐）互为镜像：
//   顶部对齐图 展示"见顶后的回撤与恢复"；本图 展示"见底后的复苏与上涨"。
// 复用 charts.js 已定义的全局 helper：CHART_COLORS / makeZoomConfig / attachModifierZoom。
// 该文件在 index.html 中于 charts.js 之后引入，因此可安全扩展 DataModule / ChartsModule。

// ===== 数据：从各轮"熊市大底"对齐 =====
// 关键：先在减半周期区间内定位最高点(牛市顶)，再取"最高点之后"的最低收盘价作为该轮大底。
//   - 周期1/2/3 → 各自熊市大底（2015初 / 2018末 / 2022末，均已在 CSV 中经数据核对）；
//   - 周期4    → 熊市大底尚未形成（2026=熊年），"见顶后至今的最低收盘"即"当下可看到的最低点"，
//                随每日数据自动推进，绝不预设/编造未来底部。
DataModule.getCycleDataFromTrough = function () {
    // 区间右界较顶部对齐图后移半年，确保能覆盖到跨年的熊市大底（如 2015-01、2018-12、2022-11）
    const cycleRanges = [
        { start: '2011-01-01', end: '2015-07-01', label: '周期1 (2015底)' },
        { start: '2015-01-01', end: '2019-07-01', label: '周期2 (2018底)' },
        { start: '2019-01-01', end: '2023-07-01', label: '周期3 (2022底)' },
        { start: '2023-01-01', end: '2027-01-01', label: '周期4 (当前)' },
    ];
    const cycles = [];
    for (const r of cycleRanges) {
        const start = new Date(r.start);
        const end = new Date(r.end);
        const inRange = this.processedData.filter(d => d.date >= start && d.date < end);
        if (inRange.length === 0) continue;

        // 先找区间内最高收盘价(牛市顶)的位置
        let peakIdx = 0;
        for (let i = 1; i < inRange.length; i++) {
            if (inRange[i].close > inRange[peakIdx].close) peakIdx = i;
        }
        // 在"最高点之后"的数据里找最低收盘价 = 该轮熊市大底（周期4=见顶后至今最低点）
        let troughIdx = peakIdx;
        for (let i = peakIdx + 1; i < inRange.length; i++) {
            if (inRange[i].close < inRange[troughIdx].close) troughIdx = i;
        }
        const troughDate = inRange[troughIdx].date;
        const troughPrice = inRange[troughIdx].close;

        // 从最低点开始向后取全部数据（跨到下一区间也继续），展示复苏，最多约 1600 天
        const fromTrough = this.processedData.filter(d => d.date >= troughDate);
        const maxDays = 1600;
        cycles.push({
            label: r.label,
            data: fromTrough
                .map(d => ({
                    day: Math.floor((d.date - troughDate) / (1000 * 60 * 60 * 24)),
                    normalized: d.close / troughPrice
                }))
                .filter(p => p.day <= maxDays)
        });
    }
    return cycles;
};

// ===== 图表：镜像 renderCycleChart，标注各轮从最低点的最高涨幅（倍数）=====
ChartsModule.renderCycleTroughChart = function (cycles) {
    this.destroyChart('cycle-trough');
    const el = document.getElementById('cycle-trough-chart');
    if (!el) return;
    const ctx = el.getContext('2d');

    const datasets = [];
    const highAnnotations = {};
    cycles.forEach((cycle, i) => {
        const color = CHART_COLORS.cycleColors[i];
        datasets.push({
            label: cycle.label,
            data: cycle.data.map(d => ({ x: d.day, y: d.normalized })),
            borderColor: color,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.1
        });

        // 找该轮最高点（相对最低点的最大倍数）并用散点+标签标注（标注显示"从最低点的涨幅倍数"）
        let high = cycle.data[0];
        for (const p of cycle.data) if (p.normalized > high.normalized) high = p;
        const gain = high.normalized; // 相对最低点的倍数
        datasets.push({
            label: cycle.label + ' 最高点',
            data: [{ x: high.day, y: high.normalized }],
            borderColor: color,
            backgroundColor: color,
            pointRadius: 6,
            pointStyle: 'triangle',
            showLine: false,
            pointHoverRadius: 7
        });
        highAnnotations['high' + i] = {
            type: 'label',
            xValue: high.day,
            yValue: high.normalized,
            content: `${cycle.label.replace(/ .*/, '')}: ${gain.toFixed(1)}x (第${high.day}天)`,
            color: '#fff',
            font: { size: 10, weight: 'bold' },
            position: 'center',
            // 交错纵向偏移，避免多轮标注在对数轴顶部彼此重叠
            xAdjust: -40,
            yAdjust: 8 + i * 16,
            backgroundColor: color,
            borderRadius: 3,
            padding: 3
        };
    });

    this.charts['cycle-trough'] = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            ...this.defaults(),
            plugins: {
                ...this.defaults().plugins,
                legend: {
                    labels: {
                        color: '#9ca3af',
                        font: { size: 11 },
                        filter: (item) => !item.text.includes('最高点') // 图例隐藏散点系列
                    }
                },
                annotation: { annotations: highAnnotations },
                zoom: makeZoomConfig()
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: '距该轮最低点天数', color: this.t().tick },
                    ticks: { color: this.t().tick },
                    grid: { color: this.t().grid }
                },
                y: {
                    type: 'logarithmic',
                    title: { display: true, text: '相对最低点 (倍)', color: this.t().tick },
                    ticks: { color: this.t().tick, callback: v => v.toFixed(2) + 'x' },
                    grid: { color: this.t().grid }
                }
            }
        }
    });
    attachModifierZoom(this.charts['cycle-trough']);
};

// ===== 挂到渲染流程 =====
// 包裹 ChartsModule.renderCycleChart：每当"顶部对齐图"渲染（首屏 init + 主题切换重渲染
// 都会经 renderPriceCharts → ChartsModule.renderCycleChart 调用），随即渲染"底部对齐图"，
// 保证两图始终同步、且随亮/暗主题自适应。
(function () {
    if (typeof ChartsModule === 'undefined' || !ChartsModule.renderCycleChart) return;
    if (ChartsModule._cycleTroughHooked) return;
    ChartsModule._cycleTroughHooked = true;
    const orig = ChartsModule.renderCycleChart;
    ChartsModule.renderCycleChart = function (cycles) {
        orig.call(this, cycles);
        try {
            this.renderCycleTroughChart(DataModule.getCycleDataFromTrough());
        } catch (e) {
            console.warn('cycle-trough render failed', e);
        }
    };
})();
