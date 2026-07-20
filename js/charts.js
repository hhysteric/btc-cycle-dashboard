const CHART_COLORS = {
    gold: '#f7931a',
    green: '#00d395',
    red: '#ff4757',
    blue: '#6366f1',
    purple: '#a855f7',
    gray: '#6b7280',
    ma50: '#3b82f6',
    ma200: '#ef4444',
    ma365: '#8b5cf6',
    cycleColors: ['#60a5fa', '#34d399', '#fbbf24', '#f87171'],
};

// 页面主题色板（随亮/暗主题切换）。离屏周报图不用这里，始终深色。
const THEMES = {
    dark: { tick: '#6b7280', grid: '#1f2937', gridStrong: '#4b5563', legend: '#9ca3af', tooltipBg: '#1a1a2e', tooltipBorder: '#374151', crosshair: 'rgba(148,163,184,0.7)' },
    light: { tick: '#64748b', grid: '#e5e7eb', gridStrong: '#94a3b8', legend: '#475569', tooltipBg: '#ffffff', tooltipBorder: '#cbd5e1', crosshair: 'rgba(100,116,139,0.7)' },
};

// 十字准线插件：鼠标在图表区域内移动时，画跟随光标的横线+竖线。
// 仅对交互图启用（options.plugins.crosshair.enabled=true）；离屏周报图不启用。
const crosshairPlugin = {
    id: 'crosshair',
    afterEvent(chart, args) {
        const e = args.event;
        const area = chart.chartArea;
        if (!area) return;
        if (e.type === 'mousemove' && e.x >= area.left && e.x <= area.right && e.y >= area.top && e.y <= area.bottom) {
            chart._crosshair = { x: e.x, y: e.y };
        } else if (e.type === 'mouseout' || e.type === 'mousemove') {
            // 移出绘图区则清除
            if (!(e.x >= area.left && e.x <= area.right && e.y >= area.top && e.y <= area.bottom)) {
                chart._crosshair = null;
            }
        }
        chart.draw();
    },
    afterDraw(chart, args, opts) {
        if (!opts || !opts.enabled) return;
        const p = chart._crosshair;
        const area = chart.chartArea;
        if (!p || !area) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = opts.color || 'rgba(148,163,184,0.7)';
        ctx.moveTo(p.x, area.top); ctx.lineTo(p.x, area.bottom);   // 竖线
        ctx.moveTo(area.left, p.y); ctx.lineTo(area.right, p.y);   // 横线
        ctx.stroke();
        ctx.restore();
    },
};
if (typeof Chart !== 'undefined') Chart.register(crosshairPlugin);

// 通用缩放/平移配置（工厂函数：每张图独立一份，避免共享引用问题）：
//  单轴图：滚轮=横纵同时；Shift=只纵轴；Ctrl/Alt=只横轴。
//  双轴图（传 leftAxis/rightAxis）：Shift=只左轴；Alt=只右轴；Ctrl=只横轴；无修饰键=纵横同时。
// mode 决定 x/y/xy；scaleMode 进一步把纵向缩放限定到某一条 y 轴（plugin-zoom v2 支持）。
const wheelMode = (ctx) => {
    const ev = ctx && ctx.event && ctx.event.native;
    if (ev && ev.shiftKey) return 'y';
    if (ev && ev.altKey) return 'y';
    if (ev && ev.ctrlKey) return 'x';
    return 'xy';
};
const makeZoomConfig = (axes) => {
    const zoom = {
        wheel: { enabled: true },
        pinch: { enabled: true },
        mode: wheelMode,
    };
    // 双轴：按 Shift/Alt 把纵向缩放限定到左/右轴
    if (axes && axes.leftAxis && axes.rightAxis) {
        zoom.scaleMode = (ctx) => {
            const ev = ctx && ctx.event && ctx.event.native;
            if (ev && ev.shiftKey) return axes.leftAxis;
            if (ev && ev.altKey) return axes.rightAxis;
            return 'xy';
        };
    }
    return { pan: { enabled: true, mode: 'xy', modifierKey: null }, zoom };
};

const ChartsModule = {
    charts: {},
    themeName: 'light',   // 'light' | 'dark'，默认亮色

    t() { return THEMES[this.themeName] || THEMES.dark; },

    setTheme(name) { this.themeName = (name === 'dark') ? 'dark' : 'light'; },

    // 历史各轮周期底部日期（当前周期未见底，不标）。用于时间轴图的竖线标注，
    // 让用户直观看到每轮周期的起点/底部。
    CYCLE_BOTTOM_DATES: [
        { date: '2015-01-14', label: '周期1底' },
        { date: '2018-12-15', label: '周期2底' },
        { date: '2022-11-21', label: '周期3底' },
    ],

    // 生成时间轴图的周期底部竖线注解（annotation 插件）。
    // 用 scaleID:'x' + value 画贯穿整个绘图区的竖线——即便双轴 stack（如 MVRV 上下栏）也能跨两栏。
    cycleBottomAnnotations(labelPos = 'start') {
        const ann = {};
        this.CYCLE_BOTTOM_DATES.forEach((b, i) => {
            ann['cb' + i] = {
                type: 'line',
                scaleID: 'x', value: b.date,
                borderColor: 'rgba(0,211,149,0.55)',
                borderWidth: 1.5,
                borderDash: [5, 4],
                label: { display: true, content: b.label, position: labelPos, color: '#00d395', backgroundColor: 'rgba(0,0,0,0)', font: { size: 9 } },
            };
        });
        return ann;
    },

    // 生成主题相关的通用 options（原 CHART_DEFAULTS 的动态版）
    defaults() {
        const c = this.t();
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: c.legend, font: { size: 11 } } },
                tooltip: { backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1 },
                crosshair: { enabled: true, color: c.crosshair }
            },
            scales: {
                x: { ticks: { color: c.tick, maxTicksLimit: 8 }, grid: { color: c.grid } },
                y: { ticks: { color: c.tick }, grid: { color: c.grid } }
            }
        };
    },

    destroyChart(id) {
        if (this.charts[id]) {
            this.charts[id].destroy();
            delete this.charts[id];
        }
    },

    resetZoom(id) {
        if (this.charts[id] && this.charts[id].resetZoom) this.charts[id].resetZoom();
    },

    // 切换某个图指定纵轴的 线性/对数，返回切换后的类型
    toggleLogScale(id, axis = 'y') {
        const chart = this.charts[id];
        if (!chart || !chart.options.scales[axis]) return null;
        const cur = chart.options.scales[axis].type;
        const next = cur === 'logarithmic' ? 'linear' : 'logarithmic';
        chart.options.scales[axis].type = next;
        chart.update();
        return next;
    },

    renderPriceChart(data, period = 365) {
        this.destroyChart('price');
        // MA 需要完整历史做前置窗口，再截取显示区间，避免开头一段为 null
        const ma50Full = DataModule.calculateMA(data, 50);
        const ma200Full = DataModule.calculateMA(data, 200);
        const ma365Full = DataModule.calculateMA(data, 365);
        const startIdx = period === 'all' ? 0 : Math.max(0, data.length - period);
        const chartData = data.slice(startIdx);
        const ma50 = ma50Full.slice(startIdx);
        const ma200 = ma200Full.slice(startIdx);
        const ma365 = ma365Full.slice(startIdx);

        const ctx = document.getElementById('price-chart').getContext('2d');
        this.charts['price'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.map(d => d.date),
                datasets: [
                    {
                        label: 'BTC Price',
                        data: chartData.map(d => d.close),
                        borderColor: CHART_COLORS.gold,
                        backgroundColor: 'rgba(247, 147, 26, 0.05)',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        fill: true
                    },
                    {
                        label: 'MA50',
                        data: ma50,
                        borderColor: CHART_COLORS.ma50,
                        borderWidth: 1,
                        pointRadius: 0,
                        borderDash: [3, 3]
                    },
                    {
                        label: 'MA200',
                        data: ma200,
                        borderColor: CHART_COLORS.ma200,
                        borderWidth: 1,
                        pointRadius: 0,
                        borderDash: [5, 5]
                    },
                    {
                        label: 'MA365',
                        data: ma365,
                        borderColor: CHART_COLORS.ma365,
                        borderWidth: 1,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                ...this.defaults(),
                plugins: { ...this.defaults().plugins, annotation: { annotations: this.cycleBottomAnnotations('start') }, zoom: makeZoomConfig() },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: period <= 365 ? 'month' : 'year' },
                        ticks: { color: this.t().tick, maxTicksLimit: 10 },
                        grid: { color: this.t().grid }
                    },
                    y: {
                        type: period === 'all' || period > 1460 ? 'logarithmic' : 'linear',
                        ticks: { color: this.t().tick, callback: v => this._fmtPrice(v) },
                        grid: { color: this.t().grid }
                    }
                }
            }
        });
    },

    renderCycleChart(cycles) {
        this.destroyChart('cycle');
        const ctx = document.getElementById('cycle-chart').getContext('2d');

        const datasets = [];
        const lowAnnotations = {};
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

            // 找该轮最低点并用散点+标签标注（标注显示"从最高点的跌幅"）
            let low = cycle.data[0];
            for (const p of cycle.data) if (p.normalized < low.normalized) low = p;
            const drawdown = (1 - low.normalized) * 100; // 跌幅%
            datasets.push({
                label: cycle.label + ' 最低点',
                data: [{ x: low.day, y: low.normalized }],
                borderColor: color,
                backgroundColor: color,
                pointRadius: 6,
                pointStyle: 'triangle',
                rotation: 180,
                showLine: false,
                pointHoverRadius: 7
            });
            lowAnnotations['low' + i] = {
                type: 'label',
                xValue: low.day,
                yValue: low.normalized,
                content: `${cycle.label.replace(/ .*/, '')}: -${drawdown.toFixed(1)}% (第${low.day}天)`,
                color: '#fff',
                font: { size: 10, weight: 'bold' },
                position: 'center',
                // 交错纵向偏移，避免周期1/2 在对数轴底部彼此重叠而看不见
                xAdjust: 40,
                yAdjust: -8 - i * 16,
                backgroundColor: color,
                borderRadius: 3,
                padding: 3
            };
        });

        this.charts['cycle'] = new Chart(ctx, {
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
                            filter: (item) => !item.text.includes('最低点') // 图例隐藏散点系列
                        }
                    },
                    annotation: { annotations: lowAnnotations },
                    zoom: makeZoomConfig()
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: '距该轮最高点天数', color: this.t().tick },
                        ticks: { color: this.t().tick },
                        grid: { color: this.t().grid }
                    },
                    y: {
                        type: 'logarithmic',
                        title: { display: true, text: '相对最高点 (倍)', color: this.t().tick },
                        ticks: { color: this.t().tick, callback: v => v.toFixed(2) + 'x' },
                        grid: { color: this.t().grid }
                    }
                }
            }
        });
    },

    renderWeekdayChart(stats) {
        this.destroyChart('weekday');
        const ctx = document.getElementById('weekday-chart').getContext('2d');
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const upRates = stats.map(s => +(s.upRate * 100).toFixed(1));
        const avgRets = stats.map(s => +(s.avgRet * 100).toFixed(3));

        this.charts['weekday'] = new Chart(ctx, {
            data: {
                labels: days,
                datasets: [
                    {
                        type: 'bar',
                        label: '上涨概率 (%)',
                        data: upRates,
                        backgroundColor: upRates.map(r => r >= 50 ? 'rgba(0, 211, 149, 0.7)' : 'rgba(255, 71, 87, 0.7)'),
                        borderColor: upRates.map(r => r >= 50 ? '#00d395' : '#ff4757'),
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        type: 'line',
                        label: '平均涨幅 (%)',
                        data: avgRets,
                        borderColor: CHART_COLORS.gold,
                        backgroundColor: CHART_COLORS.gold,
                        borderWidth: 2,
                        pointRadius: 3,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                ...this.defaults(),
                plugins: {
                    ...this.defaults().plugins,
                    tooltip: {
                        ...this.defaults().plugins.tooltip,
                        callbacks: {
                            // 概率柱：≥50% 显示「上涨概率」，<50% 显示「下跌概率」(=100-上涨)
                            label: (ctx) => {
                                if (ctx.dataset.label === '上涨概率 (%)') {
                                    const up = ctx.parsed.y;
                                    return up >= 50 ? `上涨概率 ${up.toFixed(1)}%` : `下跌概率 ${(100 - up).toFixed(1)}%`;
                                }
                                return `平均涨幅 ${ctx.parsed.y.toFixed(2)}%`;
                            }
                        }
                    },
                    annotation: {
                        annotations: {
                            line50: { type: 'line', yMin: 50, yMax: 50, yScaleID: 'y', borderColor: this.t().tick, borderDash: [5, 5], borderWidth: 1 }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: this.t().tick }, grid: { display: false } },
                    y: { position: 'left', min: 40, max: 60, title: { display: true, text: '涨/跌概率', color: this.t().tick }, ticks: { color: this.t().tick, callback: v => v + '%' }, grid: { color: this.t().grid } },
                    y1: { position: 'right', title: { display: true, text: '平均涨幅', color: '#f7931a' }, ticks: { color: '#f7931a', callback: v => v.toFixed(2) + '%' }, grid: { drawOnChartArea: false } }
                }
            }
        });
    },

    // 近 3 个月 K 线（收盘价折线），标注最强/最弱星期出现的位置
    renderWeekdayPriceChart(data, pattern) {
        this.destroyChart('weekdayPrice');
        const recent = data.slice(-91);
        const ctx = document.getElementById('weekday-price-chart').getContext('2d');

        const bestPts = recent.filter(d => d.date.getDay() === pattern.bestDay).map(d => ({ x: d.date, y: d.close }));
        const worstPts = recent.filter(d => d.date.getDay() === pattern.worstDay).map(d => ({ x: d.date, y: d.close }));

        this.charts['weekdayPrice'] = new Chart(ctx, {
            data: {
                datasets: [
                    { type: 'line', label: 'BTC 收盘价', data: recent.map(d => ({ x: d.date, y: d.close })), borderColor: CHART_COLORS.gray, borderWidth: 1, pointRadius: 0 },
                    { type: 'scatter', label: `最强 ${pattern.dayNames[pattern.bestDay]}`, data: bestPts, backgroundColor: CHART_COLORS.green, pointRadius: 3, pointStyle: 'triangle' },
                    { type: 'scatter', label: `最弱 ${pattern.dayNames[pattern.worstDay]}`, data: worstPts, backgroundColor: CHART_COLORS.red, pointRadius: 3, pointStyle: 'triangle', rotation: 180 }
                ]
            },
            options: {
                ...this.defaults(),
                scales: {
                    x: { type: 'time', time: { unit: 'month' }, ticks: { color: this.t().tick }, grid: { color: this.t().grid } },
                    y: { ticks: { color: this.t().tick, callback: v => this._fmtPrice(v) }, grid: { color: this.t().grid } }
                }
            }
        });
    },

    renderRSIChart(data, timeframe = 'daily') {
        this.destroyChart('rsi');
        // 显示全历史，配合缩放/平移查看历轮周期
        let series;
        const unit = 'year';
        if (timeframe === 'weekly') {
            series = DataModule.aggregateWeekly(data);
        } else {
            series = data;
        }
        const rsi = DataModule.calculateRSI(series);
        const ctx = document.getElementById('rsi-chart').getContext('2d');

        this.charts['rsi'] = new Chart(ctx, {
            data: {
                labels: series.map(d => d.date),
                datasets: [
                    {
                        type: 'line',
                        label: 'BTC 价格',
                        data: series.map(d => d.close),
                        borderColor: 'rgba(247,147,26,0.5)',
                        borderWidth: 1,
                        pointRadius: 0,
                        yAxisID: 'yPrice'
                    },
                    {
                        type: 'line',
                        label: `RSI-14 (${timeframe === 'weekly' ? '周线' : '日线'})`,
                        data: rsi,
                        borderColor: CHART_COLORS.purple,
                        borderWidth: 1.5,
                        pointRadius: 0,
                        yAxisID: 'y'
                    }
                ]
            },
            options: {
                ...this.defaults(),
                plugins: {
                    ...this.defaults().plugins,
                    annotation: {
                        annotations: {
                            ob: { type: 'line', yMin: 70, yMax: 70, yScaleID: 'y', borderColor: 'rgba(255,71,87,0.5)', borderDash: [3, 3], borderWidth: 1 },
                            os: { type: 'line', yMin: 30, yMax: 30, yScaleID: 'y', borderColor: 'rgba(0,211,149,0.5)', borderDash: [3, 3], borderWidth: 1 },
                            ...this.cycleBottomAnnotations('start')
                        }
                    },
                    zoom: makeZoomConfig({ leftAxis: 'y', rightAxis: 'yPrice' })
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit },
                        ticks: { color: this.t().tick },
                        grid: { color: this.t().grid }
                    },
                    y: {
                        position: 'left',
                        min: 0, max: 100,
                        title: { display: true, text: 'RSI', color: '#a855f7' },
                        ticks: { color: this.t().tick },
                        grid: {
                            color: (c) => (c.tick.value === 70 || c.tick.value === 30) ? this.t().gridStrong : this.t().grid
                        }
                    },
                    yPrice: {
                        position: 'right',
                        type: 'logarithmic',
                        title: { display: true, text: 'BTC', color: '#f7931a' },
                        ticks: { color: '#f7931a', callback: v => this._fmtPrice(v) },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    },

    // Mayer Multiple = 价格 / MA200，基于 CSV 稳定计算（全历史，可缩放）
    renderMayerChart(data) {
        this.destroyChart('mayer');
        const ma200Full = DataModule.calculateMA(data, 200);
        const mayer = data.map((d, i) => {
            const ma = ma200Full[i];
            return ma ? d.close / ma : null;
        });
        const ctx = document.getElementById('mayer-chart').getContext('2d');
        this.charts['mayer'] = new Chart(ctx, {
            data: {
                labels: data.map(d => d.date),
                datasets: [
                    {
                        type: 'line',
                        label: 'BTC 价格',
                        data: data.map(d => d.close),
                        borderColor: 'rgba(247,147,26,0.5)',
                        borderWidth: 1,
                        pointRadius: 0,
                        yAxisID: 'yPrice'
                    },
                    {
                        type: 'line',
                        label: 'Mayer Multiple',
                        data: mayer,
                        borderColor: CHART_COLORS.blue,
                        borderWidth: 1.5,
                        pointRadius: 0,
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        fill: true,
                        yAxisID: 'y'
                    }
                ]
            },
            options: {
                ...this.defaults(),
                plugins: {
                    ...this.defaults().plugins,
                    annotation: {
                        annotations: {
                            hi: { type: 'line', yMin: 2.4, yMax: 2.4, yScaleID: 'y', borderColor: 'rgba(255,71,87,0.5)', borderDash: [3, 3], borderWidth: 1 },
                            lo: { type: 'line', yMin: 1, yMax: 1, yScaleID: 'y', borderColor: 'rgba(0,211,149,0.5)', borderDash: [3, 3], borderWidth: 1 },
                            ...this.cycleBottomAnnotations('start')
                        }
                    },
                    zoom: makeZoomConfig({ leftAxis: 'y', rightAxis: 'yPrice' })
                },
                scales: {
                    x: { type: 'time', time: { unit: 'year' }, ticks: { color: this.t().tick }, grid: { color: this.t().grid } },
                    y: {
                        position: 'left',
                        title: { display: true, text: 'Mayer', color: '#6366f1' },
                        ticks: { color: this.t().tick, callback: v => v.toFixed(1) + 'x' },
                        grid: {
                            color: (c) => (Math.abs(c.tick.value - 2.4) < 0.05 || Math.abs(c.tick.value - 1) < 0.05) ? this.t().gridStrong : this.t().grid
                        }
                    },
                    yPrice: {
                        position: 'right',
                        type: 'logarithmic',
                        title: { display: true, text: 'BTC', color: '#f7931a' },
                        ticks: { color: '#f7931a', callback: v => this._fmtPrice(v) },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    },

    // 对数轴刻度格式化：$1.2k / $980 / $83（避免放大时出现 $83.36810381153265）
    _fmtPrice(v) {
        if (v >= 1000) return '$' + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k';
        if (v >= 1) return '$' + Math.round(v);
        return '$' + v.toPrecision(2);
    },

    // 本地自绘 MVRV，对齐 CheckOnChain：单张图上下两栏（Chart.js 轴 stack），共享横轴。
    //   上栏 y(对数,价格)：BTC 价格 + 已实现价格 + 价格估值带（已实现价 × 当日 MVRV band 系数）
    //   下栏 yMvrv(对数,紫)：MVRV Ratio 曲线 + MVRV 估值带曲线（当日 expanding mean/std → 曲线）
    // band 系数逐日变化（getMvrvBands().series[i].coef），因此是曲线而非直线。
    // 上下栏高度比（可由调节器修改）。priceWeight+mvrvWeight 决定 stack 比例。
    mvrvWeights: { price: 3, mvrv: 2 },

    renderMvrvChart(logScale = true) {
        // 记住当前对数状态，供调节器重绘时保持
        this._mvrvLog = logScale;
        this.destroyChart('mvrv');
        const el = document.getElementById('mvrv-chart');
        if (!el) return;
        const onchain = DataModule.onchainData;
        const bandInfo = DataModule.getMvrvBands();
        if (!onchain.length || !bandInfo) return;
        const { defs, series } = bandInfo;

        const priceByDay = new Map();
        for (const d of DataModule.processedData) priceByDay.set(d.date.toISOString().slice(0, 10), d.close);
        const labels = onchain.map(d => d.date);
        const priceData = onchain.map(d => {
            const p = priceByDay.get(d.date.toISOString().slice(0, 10));
            return p != null ? p : d.mvrv * d.realizedPrice;
        });

        // 上栏：价格 + 已实现价格 + 价格 band 曲线（已实现价 × 当日系数）
        const priceBandDatasets = defs.map(def => ({
            type: 'line', label: def.key, yAxisID: 'y',
            data: onchain.map((d, i) => d.realizedPrice * series[i].coef[def.key]),
            borderColor: def.color, borderWidth: 1, borderDash: [4, 3], pointRadius: 0, fill: false,
        }));
        // 下栏：MVRV Ratio + MVRV band 曲线（当日系数）
        const mvrvBandDatasets = defs.map(def => ({
            type: 'line', label: `MVRV ${def.key}`, yAxisID: 'yMvrv',
            data: onchain.map((d, i) => series[i].coef[def.key]),
            borderColor: def.color, borderWidth: 1, borderDash: [6, 3], pointRadius: 0, fill: false,
        }));

        this.charts['mvrv'] = new Chart(el.getContext('2d'), {
            data: {
                labels,
                datasets: [
                    { type: 'line', label: 'BTC 价格', data: priceData, yAxisID: 'y', borderColor: CHART_COLORS.gold, borderWidth: 1.5, pointRadius: 0 },
                    { type: 'line', label: '已实现价格', data: onchain.map(d => d.realizedPrice), yAxisID: 'y', borderColor: CHART_COLORS.purple, borderWidth: 2.5, pointRadius: 0 },
                    ...priceBandDatasets,
                    { type: 'line', label: 'MVRV Ratio', data: onchain.map(d => d.mvrv), yAxisID: 'yMvrv', borderColor: '#7c5cff', borderWidth: 1.3, pointRadius: 0 },
                    ...mvrvBandDatasets,
                ]
            },
            options: {
                ...this.defaults(),
                plugins: { ...this.defaults().plugins, annotation: { annotations: this.cycleBottomAnnotations('start') }, zoom: makeZoomConfig({ leftAxis: 'y', rightAxis: 'yMvrv' }) },
                scales: {
                    x: { type: 'time', time: { unit: 'year' }, ticks: { color: this.t().tick }, grid: { color: this.t().grid } },
                    // 轴 stack：Chart.js 把「后声明」的轴叠在上方，故先声明 yMvrv(下栏) 再声明 y(上栏价格)。
                    // 上栏价格 : 下栏 MVRV = 3 : 2，让 MVRV 面板更大、band 更清晰。
                    yMvrv: {
                        stack: 'mvrv', stackWeight: this.mvrvWeights.mvrv, offset: true,
                        type: 'logarithmic',
                        title: { display: true, text: 'MVRV', color: '#7c5cff' },
                        ticks: { color: '#7c5cff', callback: v => v.toFixed(1) },
                        grid: { color: this.t().grid }
                    },
                    y: {
                        stack: 'mvrv', stackWeight: this.mvrvWeights.price, offset: true,
                        type: logScale ? 'logarithmic' : 'linear',
                        title: { display: true, text: '价格 (USD)', color: this.t().tick },
                        ticks: { color: this.t().tick, callback: v => this._fmtPrice(v) },
                        grid: { color: this.t().grid }
                    }
                }
            }
        });
    },

    // 调节 MVRV 上下栏高度比：priceRatio ∈ [0.2,0.8]，为价格栏占比。重绘保持对数状态。
    setMvrvSplit(priceRatio) {
        const r = Math.min(0.8, Math.max(0.2, priceRatio));
        this.mvrvWeights = { price: r, mvrv: 1 - r };
        this.renderMvrvChart(this._mvrvLog !== false);
    },

    // NUPL 阈值线（分区）配置，供交互图与离屏图共用
    _nuplAnnotations() {
        const line = (y, color, label) => ({ type: 'line', yMin: y, yMax: y, yScaleID: 'y', borderColor: color, borderDash: [4, 4], borderWidth: 1,
            label: { display: true, content: label, position: 'start', color, backgroundColor: 'rgba(0,0,0,0)', font: { size: 9 } } });
        return {
            euphoria: line(0.75, 'rgba(236,72,153,0.6)', '欣快 0.75'),
            greed: line(0.5, 'rgba(245,158,11,0.6)', '贪婪 0.5'),
            optimism: line(0.25, 'rgba(234,179,8,0.5)', '乐观 0.25'),
            zero: line(0, 'rgba(107,114,128,0.7)', '0'),
        };
    },

    // 本地自绘 NUPL（净未实现盈亏）：右轴价格(对数) + 左轴 NUPL，分区阈值线。保留 CheckOnChain 嵌入。
    renderNuplChart() {
        this.destroyChart('nupl');
        const el = document.getElementById('nupl-chart');
        if (!el) return;
        const onchain = DataModule.onchainData.filter(d => d.nupl != null);
        if (!onchain.length) return;
        const priceByDay = new Map();
        for (const d of DataModule.processedData) priceByDay.set(d.date.toISOString().slice(0, 10), d.close);
        const labels = onchain.map(d => d.date);
        this.charts['nupl'] = new Chart(el.getContext('2d'), {
            data: {
                labels,
                datasets: [
                    { type: 'line', label: 'BTC 价格', yAxisID: 'yPrice', data: onchain.map(d => { const p = priceByDay.get(d.date.toISOString().slice(0, 10)); return p != null ? p : null; }), borderColor: 'rgba(247,147,26,0.5)', borderWidth: 1, pointRadius: 0 },
                    { type: 'line', label: 'NUPL', yAxisID: 'y', data: onchain.map(d => d.nupl), borderColor: '#7c5cff', borderWidth: 1.4, pointRadius: 0 },
                ]
            },
            options: {
                ...this.defaults(),
                plugins: { ...this.defaults().plugins, annotation: { annotations: { ...this._nuplAnnotations(), ...this.cycleBottomAnnotations('start') } }, zoom: makeZoomConfig({ leftAxis: 'y', rightAxis: 'yPrice' }) },
                scales: {
                    x: { type: 'time', time: { unit: 'year' }, ticks: { color: this.t().tick }, grid: { color: this.t().grid } },
                    y: { position: 'left', title: { display: true, text: 'NUPL', color: '#7c5cff' }, ticks: { color: '#7c5cff' }, grid: { color: this.t().grid } },
                    yPrice: { position: 'right', type: 'logarithmic', title: { display: true, text: 'BTC', color: '#f7931a' }, ticks: { color: '#f7931a', callback: v => this._fmtPrice(v) }, grid: { drawOnChartArea: false } }
                }
            }
        });
    },

    // 4Y Rolling Realized Price Risk/Reward Ratio：R/R 比(对数,左轴) + 价格(对数,右轴) + 1.0 参考线
    renderRiskRewardChart(logScale = true) {
        this.destroyChart('riskreward');
        const el = document.getElementById('riskreward-chart');
        if (!el) return;
        const series = DataModule.getRiskReward();
        if (!series) return;
        const pts = series.filter(s => s.rr != null && s.rr > 0);
        if (!pts.length) return;
        this.charts['riskreward'] = new Chart(el.getContext('2d'), {
            data: {
                labels: pts.map(s => s.date),
                datasets: [
                    { type: 'line', label: 'BTC 价格', yAxisID: 'yPrice', data: pts.map(s => s.price), borderColor: 'rgba(247,147,26,0.5)', borderWidth: 1, pointRadius: 0 },
                    { type: 'line', label: 'R/R 比', yAxisID: 'y', data: pts.map(s => s.rr), borderColor: '#7c5cff', borderWidth: 1.4, pointRadius: 0 },
                ]
            },
            options: {
                ...this.defaults(),
                plugins: {
                    ...this.defaults().plugins,
                    annotation: { annotations: {
                        one: { type: 'line', yMin: 1, yMax: 1, yScaleID: 'y', borderColor: 'rgba(107,114,128,0.7)', borderDash: [4, 4], borderWidth: 1, label: { display: true, content: '1.0', position: 'start', color: '#9ca3af', backgroundColor: 'rgba(0,0,0,0)', font: { size: 9 } } },
                        three: { type: 'line', yMin: 3, yMax: 3, yScaleID: 'y', borderColor: 'rgba(0,211,149,0.4)', borderDash: [3, 3], borderWidth: 1, label: { display: true, content: '3（价值区）', position: 'end', color: '#00d395', backgroundColor: 'rgba(0,0,0,0)', font: { size: 9 } } },
                        ...this.cycleBottomAnnotations('start')
                    } },
                    zoom: makeZoomConfig({ leftAxis: 'y', rightAxis: 'yPrice' })
                },
                scales: {
                    x: { type: 'time', time: { unit: 'year' }, ticks: { color: this.t().tick }, grid: { color: this.t().grid } },
                    y: { position: 'left', type: logScale ? 'logarithmic' : 'linear', title: { display: true, text: 'R/R 比', color: '#7c5cff' }, ticks: { color: '#7c5cff', callback: v => v >= 1 ? v.toFixed(0) : v.toFixed(2) }, grid: { color: this.t().grid } },
                    yPrice: { position: 'right', type: 'logarithmic', title: { display: true, text: 'BTC', color: '#f7931a' }, ticks: { color: '#f7931a', callback: v => this._fmtPrice(v) }, grid: { drawOnChartArea: false } }
                }
            }
        });
    },

    renderVolumeChart(data) {
        this.destroyChart('volume');
        const recent = data.slice(-90);
        const ctx = document.getElementById('volume-chart').getContext('2d');

        this.charts['volume'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: recent.map(d => d.date),
                datasets: [{
                    label: '成交量 (USD)',
                    data: recent.map(d => d.volume),
                    backgroundColor: recent.map(d => d.close >= d.open ? 'rgba(0, 211, 149, 0.5)' : 'rgba(255, 71, 87, 0.5)'),
                    borderWidth: 0
                }]
            },
            options: {
                ...this.defaults(),
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'week' },
                        ticks: { color: this.t().tick },
                        grid: { display: false }
                    },
                    y: {
                        ticks: {
                            color: this.t().tick,
                            callback: v => (v / 1e9).toFixed(1) + 'B'
                        },
                        grid: { color: this.t().grid }
                    }
                }
            }
        });
    },

    // ===== 周报用：离屏渲染每个指标的重点图，返回 PNG dataURL =====
    _offscreenChart(config, w = 920, h = 420) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        // 深色背景插件
        const bgPlugin = {
            id: 'bg',
            beforeDraw: (c) => {
                const ctx = c.canvas.getContext('2d');
                ctx.save();
                ctx.fillStyle = '#0f0f23';
                ctx.fillRect(0, 0, c.width, c.height);
                ctx.restore();
            }
        };
        config.options = config.options || {};
        config.options.responsive = false;
        config.options.animation = false;
        config.options.devicePixelRatio = 2;
        const chart = new Chart(canvas.getContext('2d'), { ...config, plugins: [bgPlugin, ...(config.plugins || [])] });
        chart.update();
        const url = canvas.toDataURL('image/png');
        chart.destroy();
        return url;
    },

    reportCycleImage(crop) {
        const cycles = DataModule.getCycleData();
        const datasets = [];
        const ann = {};
        cycles.forEach((cy, i) => {
            const color = CHART_COLORS.cycleColors[i];
            datasets.push({ label: cy.label, data: cy.data.map(d => ({ x: d.day, y: d.normalized })),
                borderColor: color, borderWidth: 1.4, pointRadius: 0, tension: 0.1 });
            let low = cy.data[0];
            for (const p of cy.data) if (p.normalized < low.normalized) low = p;
            const dd = (1 - low.normalized) * 100;
            ann['l' + i] = { type: 'label', xValue: low.day, yValue: low.normalized,
                content: `${cy.label.replace(/ .*/, '')}: -${dd.toFixed(1)}% (第${low.day}天)`,
                color: '#fff', font: { size: 12, weight: 'bold' }, xAdjust: 46, yAdjust: -8 - i * 18,
                backgroundColor: color, borderRadius: 3, padding: 4 };
        });
        return this._offscreenChart({
            type: 'line',
            data: { datasets },
            options: {
                plugins: {
                    legend: { labels: { color: '#cbd5e1', font: { size: 11 } } },
                    annotation: { annotations: ann }
                },
                scales: {
                    x: this._cropScale({ type: 'linear', title: { display: true, text: '距该轮最高点天数', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                    y: this._cropScale({ type: 'logarithmic', title: { display: true, text: '相对最高点(倍)', color: '#94a3b8' }, ticks: { color: '#94a3b8', callback: v => v.toFixed(2) + 'x' }, grid: { color: '#1f2937' } }, crop, 'y')
                }
            }
        });
    },

    reportMAImage(crop) {
        const data = DataModule.processedData.slice(-730);
        const full = DataModule.processedData;
        const s = full.length - data.length;
        const ma50 = DataModule.calculateMA(full, 50).slice(s);
        const ma200 = DataModule.calculateMA(full, 200).slice(s);
        const ma365 = DataModule.calculateMA(full, 365).slice(s);
        return this._offscreenChart({
            type: 'line',
            data: {
                labels: data.map(d => d.date),
                datasets: [
                    { label: 'BTC', data: data.map(d => d.close), borderColor: CHART_COLORS.gold, borderWidth: 1.6, pointRadius: 0 },
                    { label: 'MA50', data: ma50, borderColor: CHART_COLORS.ma50, borderWidth: 1, pointRadius: 0, borderDash: [3, 3] },
                    { label: 'MA200', data: ma200, borderColor: CHART_COLORS.ma200, borderWidth: 1, pointRadius: 0, borderDash: [5, 5] },
                    { label: 'MA365', data: ma365, borderColor: CHART_COLORS.ma365, borderWidth: 1, pointRadius: 0 },
                ]
            },
            options: {
                plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
                scales: {
                    x: this._cropScale({ type: 'time', time: { unit: 'quarter' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                    y: this._cropScale({ ticks: { color: '#94a3b8', callback: v => '$' + (v / 1000).toFixed(0) + 'k' }, grid: { color: '#1f2937' } }, crop, 'y')
                }
            }
        });
    },

    reportMayerImage(crop) {
        const full = DataModule.processedData;
        const data = full.slice(-1460);
        const s = full.length - data.length;
        const ma200Full = DataModule.calculateMA(full, 200);
        const mayer = data.map((d, i) => { const ma = ma200Full[s + i]; return ma ? d.close / ma : null; });
        return this._offscreenChart({
            data: {
                labels: data.map(d => d.date),
                datasets: [
                    { type: 'line', label: 'BTC', data: data.map(d => d.close), borderColor: 'rgba(247,147,26,0.5)', borderWidth: 1, pointRadius: 0, yAxisID: 'yP' },
                    { type: 'line', label: 'Mayer', data: mayer, borderColor: CHART_COLORS.blue, borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
                ]
            },
            options: {
                plugins: {
                    legend: { labels: { color: '#cbd5e1', font: { size: 11 } } },
                    annotation: { annotations: {
                        hi: { type: 'line', yMin: 2.4, yMax: 2.4, yScaleID: 'y', borderColor: 'rgba(255,71,87,0.5)', borderDash: [3, 3], borderWidth: 1 },
                        lo: { type: 'line', yMin: 1, yMax: 1, yScaleID: 'y', borderColor: 'rgba(0,211,149,0.5)', borderDash: [3, 3], borderWidth: 1 }
                    } }
                },
                scales: {
                    x: this._cropScale({ type: 'time', time: { unit: 'year' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                    y: { position: 'left', title: { display: true, text: 'Mayer', color: '#6366f1' }, ticks: { color: '#94a3b8', callback: v => v.toFixed(1) + 'x' }, grid: { color: '#1f2937' } },
                    yP: { position: 'right', type: 'logarithmic', ticks: { color: '#f7931a', callback: v => this._fmtPrice(v) }, grid: { drawOnChartArea: false } }
                }
            }
        });
    },

    reportRSIImage(crop) {
        const full = DataModule.processedData;
        const weekly = DataModule.aggregateWeekly(full);
        const rsi = DataModule.calculateRSI(weekly);
        return this._offscreenChart({
            data: {
                labels: weekly.map(d => d.date),
                datasets: [
                    { type: 'line', label: 'BTC价格', data: weekly.map(d => d.close), borderColor: 'rgba(247,147,26,0.5)', borderWidth: 1, pointRadius: 0, yAxisID: 'yP' },
                    { type: 'line', label: '周线RSI-14', data: rsi, borderColor: CHART_COLORS.purple, borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
                ]
            },
            options: {
                plugins: {
                    legend: { labels: { color: '#cbd5e1', font: { size: 11 } } },
                    annotation: { annotations: {
                        ob: { type: 'line', yMin: 70, yMax: 70, yScaleID: 'y', borderColor: 'rgba(255,71,87,0.5)', borderDash: [3, 3], borderWidth: 1 },
                        os: { type: 'line', yMin: 30, yMax: 30, yScaleID: 'y', borderColor: 'rgba(0,211,149,0.5)', borderDash: [3, 3], borderWidth: 1 }
                    } }
                },
                scales: {
                    x: this._cropScale({ type: 'time', time: { unit: 'year' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                    y: { position: 'left', min: 0, max: 100, title: { display: true, text: 'RSI', color: '#a855f7' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } },
                    yP: { position: 'right', type: 'logarithmic', ticks: { color: '#f7931a', callback: v => this._fmtPrice(v) }, grid: { drawOnChartArea: false } }
                }
            }
        });
    },

    // ===== 周报配置面板：可交互的小图，供用户缩放/拖动框定「进入周报的区域」=====
    // 复用页面主色，drag 缩放选区；返回的 chart 实例存在 this.miniCharts[key]。
    miniCharts: {},

    destroyMini(key) {
        if (this.miniCharts[key]) { this.miniCharts[key].destroy(); delete this.miniCharts[key]; }
    },

    // 在指定 canvas 上渲染某指标的可交互小图（cointime 无图返回 false）
    renderReportMini(key, canvas) {
        this.destroyMini(key);
        const c = this.t();
        const zoom = {
            pan: { enabled: true, mode: 'xy' },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, drag: { enabled: true, modifierKey: 'shift' }, mode: wheelMode },
        };
        const common = (scales) => ({ responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { display: false }, zoom }, scales });

        let cfg = null;
        if (key === 'cycle') {
            const cycles = DataModule.getCycleData();
            cfg = { type: 'line', data: { datasets: cycles.map((cy, i) => ({ label: cy.label,
                data: cy.data.map(d => ({ x: d.day, y: d.normalized })), borderColor: CHART_COLORS.cycleColors[i],
                borderWidth: 1.2, pointRadius: 0, tension: 0.1 })) },
                options: common({ x: { type: 'linear', ticks: { color: c.tick }, grid: { color: c.grid } },
                    y: { type: 'logarithmic', ticks: { color: c.tick, callback: v => v.toFixed(1) + 'x' }, grid: { color: c.grid } } }) };
        } else if (key === 'ma') {
            const data = DataModule.processedData.slice(-730);
            const full = DataModule.processedData; const s = full.length - data.length;
            const ma200 = DataModule.calculateMA(full, 200).slice(s);
            cfg = { type: 'line', data: { labels: data.map(d => d.date), datasets: [
                { label: 'BTC', data: data.map(d => d.close), borderColor: CHART_COLORS.gold, borderWidth: 1.4, pointRadius: 0 },
                { label: 'MA200', data: ma200, borderColor: CHART_COLORS.ma200, borderWidth: 1, pointRadius: 0, borderDash: [5, 5] } ] },
                options: common({ x: { type: 'time', time: { unit: 'quarter' }, ticks: { color: c.tick }, grid: { color: c.grid } },
                    y: { ticks: { color: c.tick, callback: v => this._fmtPrice(v) }, grid: { color: c.grid } } }) };
        } else if (key === 'mayer') {
            const full = DataModule.processedData; const data = full.slice(-1460); const s = full.length - data.length;
            const ma200Full = DataModule.calculateMA(full, 200);
            const mayer = data.map((d, i) => { const ma = ma200Full[s + i]; return ma ? d.close / ma : null; });
            cfg = { type: 'line', data: { labels: data.map(d => d.date), datasets: [
                { label: 'Mayer', data: mayer, borderColor: CHART_COLORS.blue, borderWidth: 1.4, pointRadius: 0 } ] },
                options: common({ x: { type: 'time', time: { unit: 'year' }, ticks: { color: c.tick }, grid: { color: c.grid } },
                    y: { ticks: { color: c.tick, callback: v => v.toFixed(1) + 'x' }, grid: { color: c.grid } } }) };
        } else if (key === 'mvrv') {
            // mvrv 小图 = MVRV 面板（MVRV Ratio + MVRV band 曲线），与周报图一致
            const onchain = DataModule.onchainData; const bandInfo = DataModule.getMvrvBands();
            if (!onchain.length || !bandInfo) return false;
            const { defs, series } = bandInfo;
            cfg = { type: 'line', data: { labels: onchain.map(d => d.date), datasets: [
                { label: 'MVRV', data: onchain.map(d => d.mvrv), borderColor: '#7c5cff', borderWidth: 1.3, pointRadius: 0 },
                ...defs.map(def => ({ label: def.key, data: onchain.map((d, i) => series[i].coef[def.key]), borderColor: def.color, borderWidth: 0.8, borderDash: [3, 2], pointRadius: 0 })) ] },
                options: common({ x: { type: 'time', time: { unit: 'year' }, ticks: { color: c.tick }, grid: { color: c.grid } },
                    y: { type: 'logarithmic', ticks: { color: c.tick, callback: v => v.toFixed(1) }, grid: { color: c.grid } } }) };
        } else if (key === 'realized') {
            // realized 小图 = 价格 + 已实现价格成本线
            const onchain = DataModule.onchainData;
            if (!onchain.length) return false;
            const priceByDay = new Map();
            for (const d of DataModule.processedData) priceByDay.set(d.date.toISOString().slice(0, 10), d.close);
            cfg = { type: 'line', data: { labels: onchain.map(d => d.date), datasets: [
                { label: 'BTC', data: onchain.map(d => { const p = priceByDay.get(d.date.toISOString().slice(0, 10)); return p != null ? p : d.mvrv * d.realizedPrice; }), borderColor: CHART_COLORS.gold, borderWidth: 1.2, pointRadius: 0 },
                { label: 'RP', data: onchain.map(d => d.realizedPrice), borderColor: CHART_COLORS.purple, borderWidth: 2, pointRadius: 0 } ] },
                options: common({ x: { type: 'time', time: { unit: 'year' }, ticks: { color: c.tick }, grid: { color: c.grid } },
                    y: { type: 'logarithmic', ticks: { color: c.tick, callback: v => this._fmtPrice(v) }, grid: { color: c.grid } } }) };
        } else if (key === 'nupl') {
            const onchain = DataModule.onchainData.filter(d => d.nupl != null);
            if (!onchain.length) return false;
            cfg = { type: 'line', data: { labels: onchain.map(d => d.date), datasets: [
                { label: 'NUPL', data: onchain.map(d => d.nupl), borderColor: '#7c5cff', borderWidth: 1.3, pointRadius: 0 } ] },
                options: common({ x: { type: 'time', time: { unit: 'year' }, ticks: { color: c.tick }, grid: { color: c.grid } },
                    y: { ticks: { color: c.tick }, grid: { color: c.grid } } }) };
        } else if (key === 'riskreward') {
            const series = DataModule.getRiskReward();
            if (!series) return false;
            const pts = series.filter(s => s.rr != null && s.rr > 0);
            if (!pts.length) return false;
            cfg = { type: 'line', data: { labels: pts.map(s => s.date), datasets: [
                { label: 'R/R', data: pts.map(s => s.rr), borderColor: '#7c5cff', borderWidth: 1.3, pointRadius: 0 } ] },
                options: common({ x: { type: 'time', time: { unit: 'year' }, ticks: { color: c.tick }, grid: { color: c.grid } },
                    y: { type: 'logarithmic', ticks: { color: c.tick, callback: v => v >= 1 ? v.toFixed(0) : v.toFixed(2) }, grid: { color: c.grid } } }) };
        } else if (key === 'rsi') {
            const weekly = DataModule.aggregateWeekly(DataModule.processedData);
            const rsi = DataModule.calculateRSI(weekly);
            cfg = { type: 'line', data: { labels: weekly.map(d => d.date), datasets: [
                { label: 'RSI', data: rsi, borderColor: CHART_COLORS.purple, borderWidth: 1.4, pointRadius: 0 } ] },
                options: common({ x: { type: 'time', time: { unit: 'year' }, ticks: { color: c.tick }, grid: { color: c.grid } },
                    y: { min: 0, max: 100, ticks: { color: c.tick }, grid: { color: c.grid } } }) };
        } else {
            return false; // cointime 等无图
        }
        this.miniCharts[key] = new Chart(canvas.getContext('2d'), cfg);
        return true;
    },

    // 从 mini 图当前视图读取 crop（x 轴 min/max；cycle 额外含 y）
    getMiniCrop(key) {
        const chart = this.miniCharts[key];
        if (!chart) return null;
        const xs = chart.scales.x, ys = chart.scales.y;
        const crop = { xMin: xs.min, xMax: xs.max };
        if (key === 'cycle') { crop.yMin = ys.min; crop.yMax = ys.max; }
        return crop;
    },

    // MVRV 估值带离屏图（周报用，深色）。crop: {xMin,xMax,yMin,yMax} 可选。
    // 周报里 MVRV 用「MVRV 面板」（对应页面 MVRV 卡片的下图）：MVRV Ratio + MVRV 估值带曲线，
    // 与已实现价格图（价格+成本线）区分开。
    reportMvrvImage(crop) {
        const onchain = DataModule.onchainData;
        const bandInfo = DataModule.getMvrvBands();
        if (!onchain.length || !bandInfo) return null;
        const { defs, series } = bandInfo;
        const mvrvBandDatasets = defs.map(def => ({
            type: 'line', label: `MVRV ${def.key}`, data: onchain.map((d, i) => series[i].coef[def.key]),
            borderColor: def.color, borderWidth: 1, borderDash: [6, 3], pointRadius: 0,
        }));
        return this._offscreenChart({
            data: {
                labels: onchain.map(d => d.date),
                datasets: [
                    { type: 'line', label: 'MVRV Ratio', data: onchain.map(d => d.mvrv), borderColor: '#7c5cff', borderWidth: 1.6, pointRadius: 0 },
                    ...mvrvBandDatasets,
                ]
            },
            options: {
                plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
                scales: {
                    x: this._cropScale({ type: 'time', time: { unit: 'year' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                    y: this._cropScale({ type: 'logarithmic', title: { display: true, text: 'MVRV', color: '#a855f7' }, ticks: { color: '#94a3b8', callback: v => v.toFixed(1) }, grid: { color: '#1f2937' } }, crop, 'y'),
                }
            }
        });
    },

    // 已实现价格离屏图（周报用）：只画 价格 + 已实现价格（成本线），不含 ±sd 带，
    // 与 MVRV 估值带图区分开，突出「价格 vs 全市场成本」的关系。
    reportRealizedImage(crop) {
        const onchain = DataModule.onchainData;
        if (!onchain.length) return null;
        const priceByDay = new Map();
        for (const d of DataModule.processedData) priceByDay.set(d.date.toISOString().slice(0, 10), d.close);
        const priceData = onchain.map(d => {
            const p = priceByDay.get(d.date.toISOString().slice(0, 10));
            return p != null ? p : d.mvrv * d.realizedPrice;
        });
        return this._offscreenChart({
            data: {
                labels: onchain.map(d => d.date),
                datasets: [
                    { type: 'line', label: 'BTC 价格', data: priceData, borderColor: CHART_COLORS.gold, borderWidth: 1.6, pointRadius: 0 },
                    { type: 'line', label: '已实现价格（成本线）', data: onchain.map(d => d.realizedPrice), borderColor: CHART_COLORS.purple, borderWidth: 2.5, pointRadius: 0 },
                ]
            },
            options: {
                plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
                scales: {
                    x: this._cropScale({ type: 'time', time: { unit: 'year' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                    y: this._cropScale({ type: 'logarithmic', title: { display: true, text: '价格', color: '#94a3b8' }, ticks: { color: '#94a3b8', callback: v => this._fmtPrice(v) }, grid: { color: '#1f2937' } }, crop, 'y'),
                }
            }
        });
    },

    // 把 crop 的 min/max 套到某个轴配置上（x 轴 crop 值为时间戳，y 为数值）
    _cropScale(scale, crop, axis) {
        if (!crop) return scale;
        const out = { ...scale };
        if (axis === 'x') {
            if (crop.xMin != null) out.min = crop.xMin;
            if (crop.xMax != null) out.max = crop.xMax;
        } else {
            if (crop.yMin != null) out.min = crop.yMin;
            if (crop.yMax != null) out.max = crop.yMax;
        }
        return out;
    },

    // NUPL 离屏图（周报用，深色）
    reportNuplImage(crop) {
        const onchain = DataModule.onchainData.filter(d => d.nupl != null);
        if (!onchain.length) return null;
        const priceByDay = new Map();
        for (const d of DataModule.processedData) priceByDay.set(d.date.toISOString().slice(0, 10), d.close);
        return this._offscreenChart({
            data: {
                labels: onchain.map(d => d.date),
                datasets: [
                    { type: 'line', label: 'BTC', yAxisID: 'yP', data: onchain.map(d => { const p = priceByDay.get(d.date.toISOString().slice(0, 10)); return p != null ? p : null; }), borderColor: 'rgba(247,147,26,0.5)', borderWidth: 1, pointRadius: 0 },
                    { type: 'line', label: 'NUPL', yAxisID: 'y', data: onchain.map(d => d.nupl), borderColor: '#7c5cff', borderWidth: 1.4, pointRadius: 0 },
                ]
            },
            options: {
                plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } }, annotation: { annotations: this._nuplAnnotations() } },
                scales: {
                    x: this._cropScale({ type: 'time', time: { unit: 'year' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                    y: { position: 'left', title: { display: true, text: 'NUPL', color: '#a855f7' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } },
                    yP: { position: 'right', type: 'logarithmic', ticks: { color: '#f7931a', callback: v => this._fmtPrice(v) }, grid: { drawOnChartArea: false } },
                }
            }
        });
    },

    // R/R 离屏图（周报用，深色）
    reportRiskRewardImage(crop) {
        const series = DataModule.getRiskReward();
        if (!series) return null;
        const pts = series.filter(s => s.rr != null && s.rr > 0);
        if (!pts.length) return null;
        return this._offscreenChart({
            data: {
                labels: pts.map(s => s.date),
                datasets: [
                    { type: 'line', label: 'BTC', yAxisID: 'yP', data: pts.map(s => s.price), borderColor: 'rgba(247,147,26,0.5)', borderWidth: 1, pointRadius: 0 },
                    { type: 'line', label: 'R/R', yAxisID: 'y', data: pts.map(s => s.rr), borderColor: '#7c5cff', borderWidth: 1.4, pointRadius: 0 },
                ]
            },
            options: {
                plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } }, annotation: { annotations: {
                    one: { type: 'line', yMin: 1, yMax: 1, yScaleID: 'y', borderColor: 'rgba(148,163,184,0.6)', borderDash: [4, 4], borderWidth: 1 },
                    three: { type: 'line', yMin: 3, yMax: 3, yScaleID: 'y', borderColor: 'rgba(0,211,149,0.4)', borderDash: [3, 3], borderWidth: 1 },
                } } },
                scales: {
                    x: this._cropScale({ type: 'time', time: { unit: 'year' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                    y: { position: 'left', type: 'logarithmic', title: { display: true, text: 'R/R', color: '#a855f7' }, ticks: { color: '#94a3b8', callback: v => v >= 1 ? v.toFixed(0) : v.toFixed(2) }, grid: { color: '#1f2937' } },
                    yP: { position: 'right', type: 'logarithmic', ticks: { color: '#f7931a', callback: v => this._fmtPrice(v) }, grid: { drawOnChartArea: false } },
                }
            }
        });
    },

    // 返回各指标 dataURL 映射。crops: { key: {xMin,xMax,yMin,yMax} } 可选，用于「划选区域入周报」。
    // realized（已实现价格）复用 MVRV 价格面板图；nupl / riskreward 用专门离屏图。
    reportImages(crops = {}) {
        return {
            cycle: this.reportCycleImage(crops.cycle),
            ma: this.reportMAImage(crops.ma),
            mayer: this.reportMayerImage(crops.mayer),
            mvrv: this.reportMvrvImage(crops.mvrv),
            realized: this.reportRealizedImage(crops.realized),
            nupl: this.reportNuplImage(crops.nupl),
            riskreward: this.reportRiskRewardImage(crops.riskreward),
            rsi: this.reportRSIImage(crops.rsi),
        };
    }
};
