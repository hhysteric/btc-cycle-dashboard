// 四年大周期对比（从各轮减半日对齐）—— 独立扩展模块
// 与 renderCycleChart（顶部对齐）、renderCycleTroughChart（底部对齐）并列的第三视角：
//   以「减半日」为起点(第0天, 归一化=1.0)，到「下一次减半」为终点，展示一个减半周期内的完整轨迹。
// 每条曲线在其周期内标注：最高点(牛市顶, 相对减半日的最大倍数) 与 最低点(相对减半日的最小倍数)。
// 复用 charts.js 全局 helper：CHART_COLORS / makeZoomConfig / attachModifierZoom；
// 复用 data.js 全局常量：HALVING_DATES / NEXT_HALVING_ESTIMATE。
// 本文件在 index.html 中于 charts.js、cycle-trough.js 之后引入。

// ===== 数据：从各轮「减半日」对齐到「下一次减半」 =====
// 减半日期 HALVING_DATES = [2012-11-28, 2016-07-09, 2020-05-11, 2024-04-19]，
// 第4轮终点用 NEXT_HALVING_ESTIMATE(2028-04-01) 估算；周期4 仍进行中，随每日数据自动推进。
DataModule.getCycleDataFromHalving = function () {
    const bounds = [...HALVING_DATES, NEXT_HALVING_ESTIMATE];
    const cycles = [];
    for (let c = 0; c < HALVING_DATES.length; c++) {
        const start = bounds[c];
        const end = bounds[c + 1];
        // 起点价：减半日当天（或之后第一条有数据的）收盘价，作为归一化基准
        const inRange = this.processedData.filter(d => d.date >= start && d.date < end);
        if (inRange.length === 0) continue;
        const startPrice = inRange[0].close;
        const data = inRange.map(d => ({
            day: Math.floor((d.date - start) / (1000 * 60 * 60 * 24)),
            normalized: d.close / startPrice,
        }));
        cycles.push({
            label: `减半${c + 1} (${start.getFullYear()})`,
            startDate: start,
            data,
        });
    }
    return cycles;
};

// ===== 图表：减半日对齐，标注各轮周期内的最高点与最低点 =====
ChartsModule.renderCycleHalvingChart = function (cycles) {
    this.destroyChart('cycle-halving');
    const el = document.getElementById('cycle-halving-chart');
    if (!el) return;
    const ctx = el.getContext('2d');

    const datasets = [];
    const annotations = {};
    cycles.forEach((cycle, i) => {
        const color = CHART_COLORS.cycleColors[i];
        datasets.push({
            label: cycle.label,
            data: cycle.data.map(d => ({ x: d.day, y: d.normalized })),
            borderColor: color,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.1,
        });

        // 该轮周期内的最高点与最低点（相对减半日=1.0 的倍数）
        let high = cycle.data[0], low = cycle.data[0];
        for (const p of cycle.data) {
            if (p.normalized > high.normalized) high = p;
            if (p.normalized < low.normalized) low = p;
        }
        const name = cycle.label.replace(/ .*/, '');

        // 最高点：三角散点 + 标签（显示倍数与天数）
        datasets.push({
            label: cycle.label + ' 最高点', data: [{ x: high.day, y: high.normalized }],
            borderColor: color, backgroundColor: color, pointRadius: 6, pointStyle: 'triangle',
            showLine: false, pointHoverRadius: 7,
        });
        annotations['high' + i] = {
            type: 'label', xValue: high.day, yValue: high.normalized,
            content: `${name} 顶: ${high.normalized.toFixed(1)}x (第${high.day}天)`,
            color: '#fff', font: { size: 10, weight: 'bold' }, position: 'center',
            xAdjust: -40, yAdjust: 8 + i * 16, backgroundColor: color, borderRadius: 3, padding: 3,
        };

        // 最低点：圆点散点 + 标签（显示倍数与天数）
        datasets.push({
            label: cycle.label + ' 最低点', data: [{ x: low.day, y: low.normalized }],
            borderColor: '#fff', backgroundColor: color, pointRadius: 5, pointStyle: 'circle',
            borderWidth: 1.5, showLine: false, pointHoverRadius: 7,
        });
        annotations['low' + i] = {
            type: 'label', xValue: low.day, yValue: low.normalized,
            content: `${name} 底: ${low.normalized.toFixed(2)}x (第${low.day}天)`,
            color: '#fff', font: { size: 9, weight: 'bold' }, position: 'center',
            xAdjust: 44, yAdjust: 8 + i * 14, backgroundColor: color, borderRadius: 3, padding: 3,
        };
    });

    this.charts['cycle-halving'] = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            ...this.defaults(),
            plugins: {
                ...this.defaults().plugins,
                legend: {
                    labels: {
                        color: '#9ca3af', font: { size: 11 },
                        filter: (item) => !item.text.includes('最高点') && !item.text.includes('最低点'),
                    }
                },
                annotation: { annotations },
                zoom: makeZoomConfig(),
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: '距该轮减半日天数', color: this.t().tick },
                    ticks: { color: this.t().tick },
                    grid: { color: this.t().grid },
                },
                y: {
                    type: 'logarithmic',
                    title: { display: true, text: '相对减半日 (倍)', color: this.t().tick },
                    ticks: { color: this.t().tick, callback: v => v.toFixed(2) + 'x' },
                    grid: { color: this.t().grid },
                }
            }
        }
    });
    attachModifierZoom(this.charts['cycle-halving']);
};

// ===== 挂到渲染流程 =====
// 包裹 ChartsModule.renderCycleChart（首屏 + 主题切换都会经它），随后渲染减半对齐图，
// 保证三张周期对比图始终同步、随亮/暗主题自适应。
(function () {
    if (typeof ChartsModule === 'undefined' || !ChartsModule.renderCycleChart) return;
    if (ChartsModule._cycleHalvingHooked) return;
    ChartsModule._cycleHalvingHooked = true;
    const orig = ChartsModule.renderCycleChart;
    ChartsModule.renderCycleChart = function (cycles) {
        orig.call(this, cycles);
        try {
            this.renderCycleHalvingChart(DataModule.getCycleDataFromHalving());
        } catch (e) {
            console.warn('cycle-halving render failed', e);
        }
    };
})();
