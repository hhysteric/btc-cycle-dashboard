// MVRV 四年大周期对比 —— 独立扩展模块
// 在同一张图上把各轮周期的 MVRV Ratio 曲线按「距锚点天数」对齐，比较各轮同期的 MVRV 水平。
// 三种对齐锚点（按钮切换）：
//   peak    从各轮最高点对齐（价格顶）—— 看见顶时/顶后 MVRV 如何回落
//   trough  从各轮最低点对齐（熊市大底）—— 看见底时 MVRV 有多低、之后如何抬升
//   halving 从各轮减半日对齐 —— 看减半后 MVRV 的演化节奏
// MVRV 是无量纲比值，直接画原始值（不归一化），纵轴对数便于看跨周期高低。
// 复用 charts.js 全局 helper：CHART_COLORS / makeZoomConfig / attachModifierZoom；
//   复用 data.js：HALVING_DATES / onchainData / processedData。
// 本文件在 index.html 中于 charts.js 之后引入。

// ===== 数据：按指定锚点对齐各轮 MVRV =====
// mode: 'peak' | 'trough' | 'halving'。返回 [{label, data:[{day, mvrv}]}]。
DataModule.getMvrvCycleData = function (mode) {
    if (!this.onchainData || !this.onchainData.length) return [];
    const maxDays = 1600;
    // MVRV 日期 → 值 查表（用于按锚点日取 MVRV）
    const mvrvByDay = new Map();
    for (const d of this.onchainData) mvrvByDay.set(d.date.toISOString().slice(0, 10), d.mvrv);

    // 求各轮锚点日期
    let anchors = [];
    if (mode === 'halving') {
        anchors = HALVING_DATES.map((d, i) => ({ date: d, label: `减半${i + 1} (${d.getFullYear()})` }));
    } else {
        // peak / trough：在各减半周期区间内先定位价格最高点(牛市顶)
        const ranges = (mode === 'trough')
            ? [
                { start: '2011-01-01', end: '2015-07-01', label: '周期1 (2015底)' },
                { start: '2015-01-01', end: '2019-07-01', label: '周期2 (2018底)' },
                { start: '2019-01-01', end: '2023-07-01', label: '周期3 (2022底)' },
                { start: '2023-01-01', end: '2027-01-01', label: '周期4 (当前)' },
            ]
            : [
                { start: '2011-01-01', end: '2015-01-01', label: '周期1 (2013顶)' },
                { start: '2015-01-01', end: '2019-01-01', label: '周期2 (2017顶)' },
                { start: '2019-01-01', end: '2023-01-01', label: '周期3 (2021顶)' },
                { start: '2023-01-01', end: '2027-01-01', label: '周期4 (当前)' },
            ];
        for (const r of ranges) {
            const start = new Date(r.start), end = new Date(r.end);
            const inRange = this.processedData.filter(d => d.date >= start && d.date < end);
            if (!inRange.length) continue;
            let peakIdx = 0;
            for (let i = 1; i < inRange.length; i++) if (inRange[i].close > inRange[peakIdx].close) peakIdx = i;
            if (mode === 'peak') {
                anchors.push({ date: inRange[peakIdx].date, label: r.label });
            } else {
                // trough：最高点之后的最低收盘价 = 该轮熊市大底（周期4=见顶后至今最低）
                let troughIdx = peakIdx;
                for (let i = peakIdx + 1; i < inRange.length; i++) if (inRange[i].close < inRange[troughIdx].close) troughIdx = i;
                anchors.push({ date: inRange[troughIdx].date, label: r.label });
            }
        }
    }

    // 从每个锚点向后取 MVRV，day=距锚点天数
    const cycles = [];
    for (const a of anchors) {
        const anchorDate = a.date;
        const pts = this.onchainData
            .filter(d => d.date >= anchorDate)
            .map(d => ({ day: Math.floor((d.date - anchorDate) / 86400000), mvrv: d.mvrv }))
            .filter(p => p.day <= maxDays && p.mvrv != null);
        if (pts.length) cycles.push({ label: a.label, data: pts });
    }
    return cycles;
};

// ===== 图表 =====
ChartsModule._mvrvCycleMode = 'peak';   // 默认从最高点对齐
ChartsModule._mvrvCycleAxisText = { peak: '距该轮最高点天数', trough: '距该轮最低点天数', halving: '距该轮减半日天数' };

ChartsModule.renderMvrvCycleChart = function (mode) {
    if (mode) this._mvrvCycleMode = mode;
    const m = this._mvrvCycleMode;
    this.destroyChart('mvrv-cycle');
    const el = document.getElementById('mvrv-cycle-chart');
    if (!el) return;
    const cycles = DataModule.getMvrvCycleData(m);
    if (!cycles.length) return;

    const datasets = [];
    const annotations = {};
    cycles.forEach((cycle, i) => {
        const color = CHART_COLORS.cycleColors[i];
        datasets.push({
            label: cycle.label,
            data: cycle.data.map(d => ({ x: d.day, y: d.mvrv })),
            borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0.1,
        });
        // 标注该轮 MVRV 峰值（对齐锚点后同一时窗内的最高 MVRV）
        let hi = cycle.data[0];
        for (const p of cycle.data) if (p.mvrv > hi.mvrv) hi = p;
        annotations['h' + i] = {
            type: 'label', xValue: hi.day, yValue: hi.mvrv,
            content: `${cycle.label.replace(/ .*/, '')}: MVRV ${hi.mvrv.toFixed(1)} (第${hi.day}天)`,
            color: '#fff', font: { size: 9, weight: 'bold' }, position: 'center',
            xAdjust: -30, yAdjust: 8 + i * 15, backgroundColor: color, borderRadius: 3, padding: 3,
        };
    });

    // MVRV 关键阈值参考线（顶部风险 / 底部区）
    const line = (y, color, label) => ({ type: 'line', yMin: y, yMax: y, yScaleID: 'y', borderColor: color, borderDash: [4, 4], borderWidth: 1,
        label: { display: true, content: label, position: 'end', color, backgroundColor: 'rgba(0,0,0,0)', font: { size: 9 } } });
    Object.assign(annotations, {
        t37: line(3.7, 'rgba(236,72,153,0.6)', 'MVRV 3.7 顶部风险'),
        t1: line(1, 'rgba(107,114,128,0.7)', 'MVRV 1.0'),
        t07: line(0.7, 'rgba(0,211,149,0.6)', 'MVRV 0.7 底部区'),
    });

    this.charts['mvrv-cycle'] = new Chart(el.getContext('2d'), {
        type: 'line',
        data: { datasets },
        options: {
            ...this.defaults(),
            plugins: {
                ...this.defaults().plugins,
                annotation: { annotations },
                zoom: makeZoomConfig(),
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: this._mvrvCycleAxisText[m], color: this.t().tick },
                    ticks: { color: this.t().tick },
                    grid: { color: this.t().grid },
                },
                y: {
                    type: 'logarithmic',
                    title: { display: true, text: 'MVRV Ratio', color: this.t().tick },
                    ticks: { color: this.t().tick, callback: v => v.toFixed(1) },
                    grid: { color: this.t().grid },
                }
            }
        }
    });
    attachModifierZoom(this.charts['mvrv-cycle']);
};

// ===== 周报分析 =====
DataModule.analyzeMvrvCycle = function () {
    const mode = (typeof ChartsModule !== 'undefined' && ChartsModule._mvrvCycleMode) || 'peak';
    const cycles = this.getMvrvCycleData(mode);
    if (!cycles || cycles.length < 2) return null;
    const modeText = { peak: '从各轮最高点对齐', trough: '从各轮最低点对齐', halving: '从各轮减半日对齐' }[mode];
    const peaks = cycles.map(cy => { let hi = cy.data[0]; for (const p of cy.data) if (p.mvrv > hi.mvrv) hi = p; return hi.mvrv; });
    const past = peaks.slice(0, 3).map(v => v.toFixed(1)).join(' / ');
    const cur = cycles[cycles.length - 1];
    const curLast = cur.data[cur.data.length - 1];
    let curHi = cur.data[0]; for (const p of cur.data) if (p.mvrv > curHi.mvrv) curHi = p;
    let text = `本图把各轮周期的 MVRV Ratio 按「${modeText}」叠在一起对比同期水平（MVRV>3.7 常见顶部风险、<0.7 常见底部区、1.0 为盈亏平衡）。`;
    text += `此前 3 轮对齐后窗口内的 MVRV 峰值约 ${past}，逐轮走低（增量放缓、顶部 MVRV 递减）。`;
    text += `本轮当前 MVRV ${curLast.mvrv.toFixed(2)}，对齐窗口内最高 ${curHi.mvrv.toFixed(2)}。可横比本轮相对历史处于偏高估还是偏低估（历史类比，非预测）。`;
    return { key: 'mvrvcycle', title: `MVRV 四年大周期对比（${modeText}）`, text };
};

// ===== 周报离屏图（深色，跟随当前对齐模式）=====
ChartsModule.reportMvrvCycleImage = function (crop) {
    const m = this._mvrvCycleMode || 'peak';
    const cycles = DataModule.getMvrvCycleData(m);
    if (!cycles || !cycles.length) return null;
    const datasets = [];
    const ann = {};
    cycles.forEach((cy, i) => {
        const color = CHART_COLORS.cycleColors[i];
        datasets.push({ label: cy.label, data: cy.data.map(d => ({ x: d.day, y: d.mvrv })), borderColor: color, borderWidth: 1.4, pointRadius: 0, tension: 0.1 });
        let hi = cy.data[0]; for (const p of cy.data) if (p.mvrv > hi.mvrv) hi = p;
        ann['h' + i] = { type: 'label', xValue: hi.day, yValue: hi.mvrv, content: `${cy.label.replace(/ .*/, '')}: ${hi.mvrv.toFixed(1)} (第${hi.day}天)`,
            color: '#fff', font: { size: 10, weight: 'bold' }, xAdjust: -30, yAdjust: 8 + i * 15, backgroundColor: color, borderRadius: 3, padding: 3 };
    });
    const line = (y, color, label) => ({ type: 'line', yMin: y, yMax: y, yScaleID: 'y', borderColor: color, borderDash: [4, 4], borderWidth: 1,
        label: { display: true, content: label, position: 'end', color, backgroundColor: 'rgba(0,0,0,0)', font: { size: 9 } } });
    Object.assign(ann, { t37: line(3.7, 'rgba(236,72,153,0.6)', '3.7 顶部'), t07: line(0.7, 'rgba(0,211,149,0.6)', '0.7 底部') });
    const axisText = { peak: '距该轮最高点天数', trough: '距该轮最低点天数', halving: '距该轮减半日天数' }[m];
    return this._offscreenChart({
        type: 'line', data: { datasets },
        options: {
            plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } }, annotation: { annotations: ann } },
            scales: {
                x: this._cropScale({ type: 'linear', title: { display: true, text: axisText, color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                y: this._cropScale({ type: 'logarithmic', title: { display: true, text: 'MVRV Ratio', color: '#94a3b8' }, ticks: { color: '#94a3b8', callback: v => v.toFixed(1) }, grid: { color: '#1f2937' } }, crop, 'y')
            }
        }
    });
};

// ===== 挂到渲染流程 =====
(function () {
    if (typeof ChartsModule === 'undefined' || !ChartsModule.renderMvrvChart) return;
    if (ChartsModule._mvrvCycleHooked) return;
    ChartsModule._mvrvCycleHooked = true;
    const orig = ChartsModule.renderMvrvChart;
    ChartsModule.renderMvrvChart = function (logScale) {
        orig.call(this, logScale);
        try {
            this.renderMvrvCycleChart();
        } catch (e) {
            console.warn('mvrv-cycle render failed', e);
        }
    };
})();
