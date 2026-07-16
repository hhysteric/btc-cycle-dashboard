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
    dark: { tick: '#6b7280', grid: '#1f2937', gridStrong: '#4b5563', legend: '#9ca3af', tooltipBg: '#1a1a2e', tooltipBorder: '#374151' },
    light: { tick: '#64748b', grid: '#e5e7eb', gridStrong: '#94a3b8', legend: '#475569', tooltipBg: '#ffffff', tooltipBorder: '#cbd5e1' },
};

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

    // 生成主题相关的通用 options（原 CHART_DEFAULTS 的动态版）
    defaults() {
        const c = this.t();
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: c.legend, font: { size: 11 } } },
                tooltip: { backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1 }
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
        // 'mvrv' 是双图卡片的别名，重置上下两张
        const ids = id === 'mvrv' ? ['mvrvPrice', 'mvrvRatio'] : [id];
        for (const k of ids) {
            if (this.charts[k] && this.charts[k].resetZoom) this.charts[k].resetZoom();
        }
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
                plugins: { ...this.defaults().plugins, zoom: makeZoomConfig() },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: period <= 365 ? 'month' : 'year' },
                        ticks: { color: this.t().tick, maxTicksLimit: 10 },
                        grid: { color: this.t().grid }
                    },
                    y: {
                        type: period === 'all' || period > 1460 ? 'logarithmic' : 'linear',
                        ticks: { color: this.t().tick, callback: v => '$' + v.toLocaleString() },
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
                    annotation: {
                        annotations: {
                            line50: { type: 'line', yMin: 50, yMax: 50, yScaleID: 'y', borderColor: this.t().tick, borderDash: [5, 5], borderWidth: 1 }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: this.t().tick }, grid: { display: false } },
                    y: { position: 'left', min: 40, max: 60, title: { display: true, text: '上涨概率', color: this.t().tick }, ticks: { color: this.t().tick, callback: v => v + '%' }, grid: { color: this.t().grid } },
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
                    y: { ticks: { color: this.t().tick, callback: v => '$' + (v / 1000).toFixed(0) + 'k' }, grid: { color: this.t().grid } }
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
                            os: { type: 'line', yMin: 30, yMax: 30, yScaleID: 'y', borderColor: 'rgba(0,211,149,0.5)', borderDash: [3, 3], borderWidth: 1 }
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
                        ticks: { color: '#f7931a', callback: v => '$' + (v / 1000).toFixed(0) + 'k' },
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
                            lo: { type: 'line', yMin: 1, yMax: 1, yScaleID: 'y', borderColor: 'rgba(0,211,149,0.5)', borderDash: [3, 3], borderWidth: 1 }
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
                        ticks: { color: '#f7931a', callback: v => '$' + (v / 1000).toFixed(0) + 'k' },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    },

    // 本地自绘 MVRV，对齐 CheckOnChain 的双面板结构，拆成上下两张共享横轴的图：
    //   上(mvrvPrice)：BTC 价格 + 已实现价格 + 价格估值带（已实现价 × MVRV 系数），左轴对数价格
    //   下(mvrvRatio)：MVRV Ratio 曲线 + 水平 MVRV band 线（系数常量），对数 MVRV 轴
    // 数据来自 data/mvrv.csv + realized_price.csv。
    renderMvrvChart(logScale = true) {
        this.renderMvrvPriceChart(logScale);
        this.renderMvrvRatioChart();
    },

    renderMvrvPriceChart(logScale = true) {
        this.destroyChart('mvrvPrice');
        const el = document.getElementById('mvrv-price-chart');
        if (!el) return;
        const onchain = DataModule.onchainData;
        const bandInfo = DataModule.getMvrvBands();
        if (!onchain.length || !bandInfo) return;

        const priceByDay = new Map();
        for (const d of DataModule.processedData) priceByDay.set(d.date.toISOString().slice(0, 10), d.close);
        const labels = onchain.map(d => d.date);
        const priceData = onchain.map(d => {
            const p = priceByDay.get(d.date.toISOString().slice(0, 10));
            return p != null ? p : d.mvrv * d.realizedPrice;
        });
        const priceBandDatasets = bandInfo.bands.map(b => ({
            type: 'line', label: b.key, data: onchain.map(d => d.realizedPrice * b.coef),
            borderColor: b.color, borderWidth: 1, borderDash: [4, 3], pointRadius: 0, fill: false,
        }));

        this.charts['mvrvPrice'] = new Chart(el.getContext('2d'), {
            data: {
                labels,
                datasets: [
                    { type: 'line', label: 'BTC 价格', data: priceData, borderColor: CHART_COLORS.gold, borderWidth: 1.5, pointRadius: 0 },
                    { type: 'line', label: '已实现价格', data: onchain.map(d => d.realizedPrice), borderColor: CHART_COLORS.purple, borderWidth: 2.5, pointRadius: 0 },
                    ...priceBandDatasets,
                ]
            },
            options: {
                ...this.defaults(),
                plugins: { ...this.defaults().plugins, zoom: makeZoomConfig() },
                scales: {
                    x: { type: 'time', time: { unit: 'year' }, ticks: { color: this.t().tick }, grid: { color: this.t().grid } },
                    y: {
                        type: logScale ? 'logarithmic' : 'linear',
                        title: { display: true, text: '价格 (USD)', color: this.t().tick },
                        ticks: { color: this.t().tick, callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) },
                        grid: { color: this.t().grid }
                    }
                }
            }
        });
    },

    renderMvrvRatioChart() {
        this.destroyChart('mvrvRatio');
        const el = document.getElementById('mvrv-ratio-chart');
        if (!el) return;
        const onchain = DataModule.onchainData;
        const bandInfo = DataModule.getMvrvBands();
        if (!onchain.length || !bandInfo) return;

        const labels = onchain.map(d => d.date);
        const mvrvBandDatasets = bandInfo.bands.map(b => ({
            type: 'line', label: `MVRV ${b.key}`, data: onchain.map(() => b.coef),
            borderColor: b.color, borderWidth: 1, borderDash: [6, 3], pointRadius: 0, fill: false,
        }));

        this.charts['mvrvRatio'] = new Chart(el.getContext('2d'), {
            data: {
                labels,
                datasets: [
                    { type: 'line', label: 'MVRV Ratio', data: onchain.map(d => d.mvrv), borderColor: '#7c5cff', borderWidth: 1.3, pointRadius: 0, fill: false },
                    ...mvrvBandDatasets,
                ]
            },
            options: {
                ...this.defaults(),
                plugins: { ...this.defaults().plugins, zoom: makeZoomConfig() },
                scales: {
                    x: { type: 'time', time: { unit: 'year' }, ticks: { color: this.t().tick }, grid: { color: this.t().grid } },
                    y: {
                        type: 'logarithmic',
                        title: { display: true, text: 'MVRV', color: '#7c5cff' },
                        ticks: { color: '#7c5cff', callback: v => v.toFixed(1) },
                        grid: { color: this.t().grid }
                    }
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
                    yP: { position: 'right', type: 'logarithmic', ticks: { color: '#f7931a', callback: v => '$' + (v / 1000).toFixed(0) + 'k' }, grid: { drawOnChartArea: false } }
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
                    yP: { position: 'right', type: 'logarithmic', ticks: { color: '#f7931a', callback: v => '$' + (v / 1000).toFixed(0) + 'k' }, grid: { drawOnChartArea: false } }
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
                    y: { ticks: { color: c.tick, callback: v => '$' + (v / 1000).toFixed(0) + 'k' }, grid: { color: c.grid } } }) };
        } else if (key === 'mayer') {
            const full = DataModule.processedData; const data = full.slice(-1460); const s = full.length - data.length;
            const ma200Full = DataModule.calculateMA(full, 200);
            const mayer = data.map((d, i) => { const ma = ma200Full[s + i]; return ma ? d.close / ma : null; });
            cfg = { type: 'line', data: { labels: data.map(d => d.date), datasets: [
                { label: 'Mayer', data: mayer, borderColor: CHART_COLORS.blue, borderWidth: 1.4, pointRadius: 0 } ] },
                options: common({ x: { type: 'time', time: { unit: 'year' }, ticks: { color: c.tick }, grid: { color: c.grid } },
                    y: { ticks: { color: c.tick, callback: v => v.toFixed(1) + 'x' }, grid: { color: c.grid } } }) };
        } else if (key === 'mvrv') {
            const onchain = DataModule.onchainData; const bandInfo = DataModule.getMvrvBands();
            if (!onchain.length || !bandInfo) return false;
            const priceByDay = new Map();
            for (const d of DataModule.processedData) priceByDay.set(d.date.toISOString().slice(0, 10), d.close);
            cfg = { type: 'line', data: { labels: onchain.map(d => d.date), datasets: [
                { label: 'BTC', data: onchain.map(d => { const p = priceByDay.get(d.date.toISOString().slice(0, 10)); return p != null ? p : d.mvrv * d.realizedPrice; }), borderColor: CHART_COLORS.gold, borderWidth: 1.2, pointRadius: 0 },
                { label: 'RP', data: onchain.map(d => d.realizedPrice), borderColor: CHART_COLORS.purple, borderWidth: 2, pointRadius: 0 },
                ...bandInfo.bands.map(b => ({ label: b.key, data: onchain.map(d => d.realizedPrice * b.coef), borderColor: b.color, borderWidth: 0.8, borderDash: [3, 2], pointRadius: 0 })) ] },
                options: common({ x: { type: 'time', time: { unit: 'year' }, ticks: { color: c.tick }, grid: { color: c.grid } },
                    y: { type: 'logarithmic', ticks: { color: c.tick, callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) }, grid: { color: c.grid } } }) };
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
    reportMvrvImage(crop) {
        const onchain = DataModule.onchainData;
        const bandInfo = DataModule.getMvrvBands();
        if (!onchain.length || !bandInfo) return null;
        const priceByDay = new Map();
        for (const d of DataModule.processedData) priceByDay.set(d.date.toISOString().slice(0, 10), d.close);
        const labels = onchain.map(d => d.date);
        const priceData = onchain.map(d => {
            const p = priceByDay.get(d.date.toISOString().slice(0, 10));
            return p != null ? p : d.mvrv * d.realizedPrice;
        });
        // 周报里 MVRV 用价格面板（价格 + 已实现价格 + 价格估值带），信息最直观且与文字量化对应
        const priceBandDatasets = bandInfo.bands.map(b => ({
            type: 'line', label: b.key, data: onchain.map(d => d.realizedPrice * b.coef),
            borderColor: b.color, borderWidth: 1, borderDash: [4, 3], pointRadius: 0,
        }));
        return this._offscreenChart({
            data: {
                labels,
                datasets: [
                    { type: 'line', label: 'BTC', data: priceData, borderColor: CHART_COLORS.gold, borderWidth: 1.6, pointRadius: 0 },
                    { type: 'line', label: '已实现价格', data: onchain.map(d => d.realizedPrice), borderColor: CHART_COLORS.purple, borderWidth: 2.5, pointRadius: 0 },
                    ...priceBandDatasets,
                ]
            },
            options: {
                plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
                scales: {
                    x: this._cropScale({ type: 'time', time: { unit: 'year' }, ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } }, crop, 'x'),
                    y: this._cropScale({ type: 'logarithmic', title: { display: true, text: '价格', color: '#94a3b8' }, ticks: { color: '#94a3b8', callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) }, grid: { color: '#1f2937' } }, crop, 'y'),
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

    // 返回各指标 dataURL 映射。crops: { key: {xMin,xMax,yMin,yMax} } 可选，用于「划选区域入周报」。
    reportImages(crops = {}) {
        return {
            cycle: this.reportCycleImage(crops.cycle),
            ma: this.reportMAImage(crops.ma),
            mayer: this.reportMayerImage(crops.mayer),
            mvrv: this.reportMvrvImage(crops.mvrv),
            rsi: this.reportRSIImage(crops.rsi),
        };
    }
};
