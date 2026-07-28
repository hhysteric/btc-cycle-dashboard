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

// ===== 周报分析：从减半日到下一减半，各轮周期内的顶/底形态 =====
DataModule.analyzeCycleHalving = function () {
    const cycles = this.getCycleDataFromHalving();
    if (!cycles || cycles.length < 2) return null;
    const stat = c => {
        let high = c.data[0], low = c.data[0];
        for (const p of c.data) { if (p.normalized > high.normalized) high = p; if (p.normalized < low.normalized) low = p; }
        return { gain: high.normalized, gainDay: high.day, low: low.normalized, lowDay: low.day };
    };
    const past = cycles.slice(0, 3).map(stat);
    const cur = stat(cycles[cycles.length - 1]);
    const curDays = cycles[cycles.length - 1].data[cycles[cycles.length - 1].data.length - 1].day;
    const gList = past.map(p => p.gain.toFixed(1) + 'x').join(' / ');
    const gDayList = past.map(p => p.gainDay).join(' / ');
    let text = `以每轮减半日为起点（第0天=1.0）到下一次减半：此前 3 轮减半后至周期顶的最大涨幅约 ${gList}，见顶分别在减半后第 ${gDayList} 天；涨幅逐轮递减，见顶时间大致集中在减半后约 1 年至 1 年半。`;
    text += `本轮（2024-04-19 减半）至今 ${curDays} 天，期间最高 ${cur.gain.toFixed(2)}x（第 ${cur.gainDay} 天）、最低 ${cur.low.toFixed(2)}x（第 ${cur.lowDay} 天）。`;
    text += `按「峰值对齐」视角看，各轮从减半日涨到顶的比例在收敛，可据此横比本轮相对历史处于偏早/偏晚位置（历史类比，非预测）。`;
    return { key: 'cyclehalving', title: '四年大周期对比（从各轮减半日对齐）', text };
};

// ===== 图表：减半日对齐，标注各轮周期内的最高点与最低点 =====
ChartsModule.renderCycleHalvingChart = function (cycles) {
    this.destroyChart('cycle-halving');
    const el = document.getElementById('cycle-halving-chart');
    if (!el) return;
    const ctx = el.getContext('2d');

    // peakMode=true：每轮除以自身最高点，使各轮峰值统一为 1.0（减半日仍为 x=0 起点），
    //   便于对比"从减半日涨到顶的比例"与"顶后回撤深度"的形态；否则以减半日价=1.0 归一。
    const peakMode = !!this._halvingPeakMode;
    const datasets = [];
    const annotations = {};
    cycles.forEach((cycle, i) => {
        const color = CHART_COLORS.cycleColors[i];
        // 先找该轮原始（相对减半日）最高/最低点
        let high = cycle.data[0], low = cycle.data[0];
        for (const p of cycle.data) {
            if (p.normalized > high.normalized) high = p;
            if (p.normalized < low.normalized) low = p;
        }
        const peakVal = high.normalized || 1;
        // 显示用换算：peakMode 下所有值除以峰值（峰=1.0）
        const yOf = v => peakMode ? v / peakVal : v;
        const name = cycle.label.replace(/ .*/, '');

        datasets.push({
            label: cycle.label,
            data: cycle.data.map(d => ({ x: d.day, y: yOf(d.normalized) })),
            borderColor: color,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.1,
        });

        // 最高点：三角散点 + 标签
        datasets.push({
            label: cycle.label + ' 最高点', data: [{ x: high.day, y: yOf(high.normalized) }],
            borderColor: color, backgroundColor: color, pointRadius: 6, pointStyle: 'triangle',
            showLine: false, pointHoverRadius: 7,
        });
        annotations['high' + i] = {
            type: 'label', xValue: high.day, yValue: yOf(high.normalized),
            content: peakMode ? `${name} 顶: 1.00 (第${high.day}天)` : `${name} 顶: ${high.normalized.toFixed(1)}x (第${high.day}天)`,
            color: '#fff', font: { size: 10, weight: 'bold' }, position: 'center',
            xAdjust: -40, yAdjust: 8 + i * 16, backgroundColor: color, borderRadius: 3, padding: 3,
        };

        // 最低点：圆点散点 + 标签
        datasets.push({
            label: cycle.label + ' 最低点', data: [{ x: low.day, y: yOf(low.normalized) }],
            borderColor: '#fff', backgroundColor: color, pointRadius: 5, pointStyle: 'circle',
            borderWidth: 1.5, showLine: false, pointHoverRadius: 7,
        });
        annotations['low' + i] = {
            type: 'label', xValue: low.day, yValue: yOf(low.normalized),
            content: peakMode ? `${name} 底: ${yOf(low.normalized).toFixed(2)} (第${low.day}天)` : `${name} 底: ${low.normalized.toFixed(2)}x (第${low.day}天)`,
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
                    type: 'logarithmic',   // 两种模式均对数显示
                    title: { display: true, text: peakMode ? '相对各轮峰值 (峰=1.0)' : '相对减半日 (倍)', color: this.t().tick },
                    ticks: { color: this.t().tick, callback: v => v.toFixed(2) + (peakMode ? '' : 'x') },
                    grid: { color: this.t().grid },
                }
            }
        }
    });
    attachModifierZoom(this.charts['cycle-halving']);
};

// 切换「峰值对齐」模式（各轮峰值统一为 1.0）并重绘，返回切换后的状态（true=峰值对齐）
ChartsModule.toggleHalvingPeakMode = function () {
    this._halvingPeakMode = !this._halvingPeakMode;
    this.renderCycleHalvingChart(DataModule.getCycleDataFromHalving());
    return this._halvingPeakMode;
};

// ===== 周报离屏图（深色）：从各轮减半日对齐，标注各轮周期内最高/最低点。
// 跟随当前「峰值对齐」开关，保证周报与页面所见一致。 =====
ChartsModule.reportCycleHalvingImage = function (crop) {
    const cycles = DataModule.getCycleDataFromHalving();
    if (!cycles || !cycles.length) return null;
    const peakMode = !!this._halvingPeakMode;
    const datasets = [];
    const ann = {};
    cycles.forEach((cy, i) => {
        const color = CHART_COLORS.cycleColors[i];
        let high = cy.data[0], low = cy.data[0];
        for (const p of cy.data) { if (p.normalized > high.normalized) high = p; if (p.normalized < low.normalized) low = p; }
        const peakVal = high.normalized || 1;
        const yOf = v => peakMode ? v / peakVal : v;
        const name = cy.label.replace(/ .*/, '');
        datasets.push({ label: cy.label, data: cy.data.map(d => ({ x: d.day, y: yOf(d.normalized) })),
            borderColor: color, borderWidth: 1.4, pointRadius: 0, tension: 0.1 });
        datasets.push({ label: cy.label + ' 顶', data: [{ x: high.day, y: yOf(high.normalized) }], borderColor: color, backgroundColor: color, pointRadius: 6, pointStyle: 'triangle', showLine: false });
        datasets.push({ label: cy.label + ' 底', data: [{ x: low.day, y: yOf(low.normalized) }], borderColor: '#fff', backgroundColor: color, pointRadius: 5, pointStyle: 'circle', borderWidth: 1.5, showLine: false });
        ann['h' + i] = { type: 'label', xValue: high.day, yValue: yOf(high.normalized),
            content: peakMode ? `${name} 顶: 1.00 (第${high.day}天)` : `${name} 顶: ${high.normalized.toFixed(1)}x (第${high.day}天)`,
            color: '#fff', font: { size: 11, weight: 'bold' }, xAdjust: -40, yAdjust: 8 + i * 16, backgroundColor: color, borderRadius: 3, padding: 3 };
        ann['l' + i] = { type: 'label', xValue: low.day, yValue: yOf(low.normalized),
            content: peakMode ? `${name} 底: ${yOf(low.normalized).toFixed(2)} (第${low.day}天)` : `${name} 底: ${low.normalized.toFixed(2)}x (第${low.day}天)`,
            color: '#fff', font: { size: 9, weight: 'bold' }, xAdjust: 44, yAdjust: 8 + i * 14, backgroundColor: color, borderRadius: 3, padding: 3 };
    });
    return this._offscreenChart({
        type: 'line', data: { datasets },
        options: {
            plugins: {
                legend: { labels: { color: '#cbd5e1', font: { size: 11 }, filter: (item) => !item.text.includes(' 顶') && !item.text.includes(' 底') } },
                annotation: { annotations: ann }
            },
            scales: {
                x: this._cropScale({ type: 'linear', title: { display: true, text: '距该轮减半日天数', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                y: this._cropScale({ type: 'logarithmic', title: { display: true, text: peakMode ? '相对各轮峰值(峰=1.0)' : '相对减半日(倍)', color: '#94a3b8' }, ticks: { color: '#94a3b8', callback: v => v.toFixed(2) + (peakMode ? '' : 'x') }, grid: { color: '#1f2937' } }, crop, 'y')
            }
        }
    });
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
