// 涨跌强弱对比（低点→高点两端对齐 0→1，再看回落）—— 独立扩展模块
// 目的：对比各轮「见顶后下跌的强弱/快慢」。
//   做法：每轮把「最低点→最高点」这段牛市两端归一化为 低=0、高=1（x=距该轮最低点天数）；
//   过高点后曲线继续画进入回落段，跌破 0 = 跌回甚至低于本轮起始低点。
//   因各轮顶点都对齐在 y=1，从顶点往右下的回落曲线可直接叠比，一眼看出哪轮跌得更深/更狠。
// 复用 charts.js 全局 helper：CHART_COLORS / makeZoomConfig / attachModifierZoom；
//   数据复用 DataModule.getCycleDataFromTrough（已优雅处理进行中的周期4，且从低点向后延伸含回落段）。
// 本文件在 index.html 中于 charts.js、cycle-trough.js 之后引入。

// ===== 数据：低点→高点两端归一化 + 回落 =====
// 返回 [{label, data:[{day, y}]}]，y 已按 (v-低点)/(高点-低点) 归一（低=0 高=1）。
DataModule.getCycleStrengthData = function () {
    const src = (typeof this.getCycleDataFromTrough === 'function') ? this.getCycleDataFromTrough() : null;
    if (!src || !src.length) return [];
    return src.map(cy => {
        // cy.data：从该轮最低点起（day=0, normalized=1.0），向后含涨到顶再回落
        let peak = cy.data[0];
        for (const p of cy.data) if (p.normalized > peak.normalized) peak = p;
        const base = cy.data[0].normalized;          // 最低点值（=1.0）
        const span = (peak.normalized - base) || 1;  // 低→高 涨幅跨度
        return {
            label: cy.label,
            peakDay: peak.day,
            data: cy.data.map(d => ({ day: d.day, y: (d.normalized - base) / span })),
        };
    });
};

// ===== 图表：低=0 高=1，标注各轮高点(顶)与高点之后的最低点(回落底) =====
ChartsModule.renderCycleStrengthChart = function (cycles) {
    this.destroyChart('cycle-strength');
    const el = document.getElementById('cycle-strength-chart');
    if (!el) return;
    const ctx = el.getContext('2d');

    const datasets = [];
    const annotations = {};
    cycles.forEach((cycle, i) => {
        const color = CHART_COLORS.cycleColors[i];
        const name = cycle.label.replace(/ .*/, '');

        datasets.push({
            label: cycle.label,
            data: cycle.data.map(d => ({ x: d.day, y: d.y })),
            borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.1,
        });

        // 高点（y≈1）：三角
        const high = cycle.data.find(d => d.day === cycle.peakDay) || cycle.data[0];
        datasets.push({
            label: cycle.label + ' 高点', data: [{ x: high.day, y: high.y }],
            borderColor: color, backgroundColor: color, pointRadius: 6, pointStyle: 'triangle', showLine: false,
        });
        annotations['h' + i] = {
            type: 'label', xValue: high.day, yValue: high.y,
            content: `${name} 顶 (第${high.day}天)`,
            color: '#fff', font: { size: 9, weight: 'bold' }, position: 'center',
            xAdjust: -34, yAdjust: -8 - i * 14, backgroundColor: color, borderRadius: 3, padding: 3,
        };

        // 高点之后的回落最低点：圆点 + 标注回撤深度（相对涨幅的比例）
        let fallLow = high;
        for (const d of cycle.data) if (d.day > high.day && d.y < fallLow.y) fallLow = d;
        if (fallLow !== high) {
            const dropPct = (1 - fallLow.y) * 100; // 从顶(=1)回落到 fallLow.y 的比例
            datasets.push({
                label: cycle.label + ' 回落底', data: [{ x: fallLow.day, y: fallLow.y }],
                borderColor: '#fff', backgroundColor: color, pointRadius: 5, pointStyle: 'circle', borderWidth: 1.5, showLine: false,
            });
            annotations['f' + i] = {
                type: 'label', xValue: fallLow.day, yValue: fallLow.y,
                content: `${name} 回落 -${dropPct.toFixed(0)}% (第${fallLow.day}天)`,
                color: '#fff', font: { size: 9, weight: 'bold' }, position: 'center',
                xAdjust: 52, yAdjust: 8 + i * 14, backgroundColor: color, borderRadius: 3, padding: 3,
            };
        }
    });

    this.charts['cycle-strength'] = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            ...this.defaults(),
            plugins: {
                ...this.defaults().plugins,
                legend: {
                    labels: {
                        color: '#9ca3af', font: { size: 11 },
                        filter: (item) => !item.text.includes(' 高点') && !item.text.includes(' 回落底'),
                    }
                },
                annotation: { annotations },
                zoom: makeZoomConfig(),
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: '距该轮最低点天数', color: this.t().tick },
                    ticks: { color: this.t().tick },
                    grid: { color: this.t().grid },
                },
                y: {
                    // 含 0/负值（回落跌破起点），用线性轴
                    type: 'linear',
                    title: { display: true, text: '低点→高点 归一化 (0→1，跌破0=低于起点)', color: this.t().tick },
                    ticks: { color: this.t().tick, callback: v => v.toFixed(2) },
                    grid: { color: this.t().grid },
                }
            }
        }
    });
    attachModifierZoom(this.charts['cycle-strength']);
};

// ===== 周报分析：对比各轮见顶后的下跌强弱 =====
DataModule.analyzeCycleStrength = function () {
    const cycles = this.getCycleStrengthData();
    if (!cycles || cycles.length < 2) return null;
    const info = cycles.map(cy => {
        const high = cy.data.find(d => d.day === cy.peakDay) || cy.data[0];
        let fallLow = high;
        for (const d of cy.data) if (d.day > high.day && d.y < fallLow.y) fallLow = d;
        return { name: cy.label.replace(/ .*/, ''), drop: (1 - fallLow.y) * 100, fallDays: fallLow.day - high.day, hasFall: fallLow !== high };
    });
    const past = info.slice(0, 3).filter(x => x.hasFall);
    const cur = info[info.length - 1];
    const dropList = past.map(p => `${p.name} -${p.drop.toFixed(0)}%（顶后${p.fallDays}天）`).join('、');
    let text = `本图把各轮「最低点→最高点」归一化为 低=0、高=1，各轮顶点对齐在 1.0，从顶点往右下的回落曲线可直接叠比下跌强弱（曲线越陡/越低=跌得越快越深；跌破 0 = 已低于本轮起始低点）。`;
    if (past.length) text += `此前几轮见顶后的最深回落：${dropList}。`;
    if (cur && cur.hasFall) text += `本轮见顶后至今最深回落约 -${cur.drop.toFixed(0)}%（顶后 ${cur.fallDays} 天），可与历史区间横比当前下跌处于偏强或偏弱（历史类比，非预测）。`;
    return { key: 'cyclestrength', title: '涨跌强弱对比（低→高对齐，看回落深度）', text };
};

// ===== 周报离屏图（深色）=====
ChartsModule.reportCycleStrengthImage = function (crop) {
    const cycles = DataModule.getCycleStrengthData();
    if (!cycles || !cycles.length) return null;
    const datasets = [];
    const ann = {};
    cycles.forEach((cy, i) => {
        const color = CHART_COLORS.cycleColors[i];
        const name = cy.label.replace(/ .*/, '');
        datasets.push({ label: cy.label, data: cy.data.map(d => ({ x: d.day, y: d.y })), borderColor: color, borderWidth: 1.4, pointRadius: 0, tension: 0.1 });
        const high = cy.data.find(d => d.day === cy.peakDay) || cy.data[0];
        datasets.push({ label: cy.label + ' 顶', data: [{ x: high.day, y: high.y }], borderColor: color, backgroundColor: color, pointRadius: 6, pointStyle: 'triangle', showLine: false });
        let fallLow = high;
        for (const d of cy.data) if (d.day > high.day && d.y < fallLow.y) fallLow = d;
        if (fallLow !== high) {
            const dropPct = (1 - fallLow.y) * 100;
            datasets.push({ label: cy.label + ' 回落底', data: [{ x: fallLow.day, y: fallLow.y }], borderColor: '#fff', backgroundColor: color, pointRadius: 5, pointStyle: 'circle', borderWidth: 1.5, showLine: false });
            ann['f' + i] = { type: 'label', xValue: fallLow.day, yValue: fallLow.y, content: `${name} -${dropPct.toFixed(0)}% (第${fallLow.day}天)`,
                color: '#fff', font: { size: 10, weight: 'bold' }, xAdjust: 52, yAdjust: 8 + i * 14, backgroundColor: color, borderRadius: 3, padding: 3 };
        }
    });
    return this._offscreenChart({
        type: 'line', data: { datasets },
        options: {
            plugins: {
                legend: { labels: { color: '#cbd5e1', font: { size: 11 }, filter: (item) => !item.text.includes(' 顶') && !item.text.includes(' 回落底') } },
                annotation: { annotations: ann }
            },
            scales: {
                x: this._cropScale({ type: 'linear', title: { display: true, text: '距该轮最低点天数', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                y: this._cropScale({ type: 'linear', title: { display: true, text: '低→高 归一化(0→1)', color: '#94a3b8' }, ticks: { color: '#94a3b8', callback: v => v.toFixed(2) }, grid: { color: '#1f2937' } }, crop, 'y')
            }
        }
    });
};

// ===== 挂到渲染流程 =====
(function () {
    if (typeof ChartsModule === 'undefined' || !ChartsModule.renderCycleChart) return;
    if (ChartsModule._cycleStrengthHooked) return;
    ChartsModule._cycleStrengthHooked = true;
    const orig = ChartsModule.renderCycleChart;
    ChartsModule.renderCycleChart = function (cycles) {
        orig.call(this, cycles);
        try {
            this.renderCycleStrengthChart(DataModule.getCycleStrengthData());
        } catch (e) {
            console.warn('cycle-strength render failed', e);
        }
    };
})();
