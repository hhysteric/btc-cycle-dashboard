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

const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
        tooltip: { backgroundColor: '#1a1a2e', borderColor: '#374151', borderWidth: 1 }
    },
    scales: {
        x: { ticks: { color: '#6b7280', maxTicksLimit: 8 }, grid: { color: '#1f2937' } },
        y: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } }
    }
};

// 通用缩放/平移配置：
//  - 滚轮：默认横纵轴同时缩放（纵轴也能调）
//  - 按住 Shift 滚轮：只缩放纵轴
//  - 按住 Ctrl/Alt 滚轮：只缩放横轴
//  - 拖动：平移 xy；双指：xy 缩放
// mode 用函数实现：按修饰键动态切换缩放轴，默认 xy
const wheelMode = (ctx) => {
    const ev = ctx && ctx.event && ctx.event.native;
    if (ev && ev.shiftKey) return 'y';
    if (ev && (ev.ctrlKey || ev.altKey)) return 'x';
    return 'xy';
};
const ZOOM_CONFIG = {
    pan: { enabled: true, mode: 'xy', modifierKey: null },
    zoom: {
        wheel: { enabled: true },
        pinch: { enabled: true },
        mode: wheelMode
    }
};

const ChartsModule = {
    charts: {},

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
                ...CHART_DEFAULTS,
                plugins: { ...CHART_DEFAULTS.plugins, zoom: ZOOM_CONFIG },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: period <= 365 ? 'month' : 'year' },
                        ticks: { color: '#6b7280', maxTicksLimit: 10 },
                        grid: { color: '#1f2937' }
                    },
                    y: {
                        type: period === 'all' || period > 1460 ? 'logarithmic' : 'linear',
                        ticks: { color: '#6b7280', callback: v => '$' + v.toLocaleString() },
                        grid: { color: '#1f2937' }
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
                ...CHART_DEFAULTS,
                plugins: {
                    ...CHART_DEFAULTS.plugins,
                    legend: {
                        labels: {
                            color: '#9ca3af',
                            font: { size: 11 },
                            filter: (item) => !item.text.includes('最低点') // 图例隐藏散点系列
                        }
                    },
                    annotation: { annotations: lowAnnotations },
                    zoom: ZOOM_CONFIG
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: '距该轮最高点天数', color: '#6b7280' },
                        ticks: { color: '#6b7280' },
                        grid: { color: '#1f2937' }
                    },
                    y: {
                        type: 'logarithmic',
                        title: { display: true, text: '相对最高点 (倍)', color: '#6b7280' },
                        ticks: { color: '#6b7280', callback: v => v.toFixed(2) + 'x' },
                        grid: { color: '#1f2937' }
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
                ...CHART_DEFAULTS,
                plugins: {
                    ...CHART_DEFAULTS.plugins,
                    annotation: {
                        annotations: {
                            line50: { type: 'line', yMin: 50, yMax: 50, yScaleID: 'y', borderColor: '#6b7280', borderDash: [5, 5], borderWidth: 1 }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#6b7280' }, grid: { display: false } },
                    y: { position: 'left', min: 40, max: 60, title: { display: true, text: '上涨概率', color: '#6b7280' }, ticks: { color: '#6b7280', callback: v => v + '%' }, grid: { color: '#1f2937' } },
                    y1: { position: 'right', title: { display: true, text: '平均涨幅', color: '#f7931a' }, ticks: { color: '#f7931a', callback: v => v + '%' }, grid: { drawOnChartArea: false } }
                }
            }
        });
    },

    // 近半年 K 线（收盘价折线），标注最强/最弱星期出现的位置
    renderWeekdayPriceChart(data, pattern) {
        this.destroyChart('weekdayPrice');
        const recent = data.slice(-180);
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
                ...CHART_DEFAULTS,
                scales: {
                    x: { type: 'time', time: { unit: 'month' }, ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
                    y: { ticks: { color: '#6b7280', callback: v => '$' + (v / 1000).toFixed(0) + 'k' }, grid: { color: '#1f2937' } }
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
                ...CHART_DEFAULTS,
                plugins: {
                    ...CHART_DEFAULTS.plugins,
                    annotation: {
                        annotations: {
                            ob: { type: 'line', yMin: 70, yMax: 70, yScaleID: 'y', borderColor: 'rgba(255,71,87,0.5)', borderDash: [3, 3], borderWidth: 1 },
                            os: { type: 'line', yMin: 30, yMax: 30, yScaleID: 'y', borderColor: 'rgba(0,211,149,0.5)', borderDash: [3, 3], borderWidth: 1 }
                        }
                    },
                    zoom: ZOOM_CONFIG
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit },
                        ticks: { color: '#6b7280' },
                        grid: { color: '#1f2937' }
                    },
                    y: {
                        position: 'left',
                        min: 0, max: 100,
                        title: { display: true, text: 'RSI', color: '#a855f7' },
                        ticks: { color: '#6b7280' },
                        grid: {
                            color: (c) => (c.tick.value === 70 || c.tick.value === 30) ? '#4b5563' : '#1f2937'
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
                ...CHART_DEFAULTS,
                plugins: {
                    ...CHART_DEFAULTS.plugins,
                    annotation: {
                        annotations: {
                            hi: { type: 'line', yMin: 2.4, yMax: 2.4, yScaleID: 'y', borderColor: 'rgba(255,71,87,0.5)', borderDash: [3, 3], borderWidth: 1 },
                            lo: { type: 'line', yMin: 1, yMax: 1, yScaleID: 'y', borderColor: 'rgba(0,211,149,0.5)', borderDash: [3, 3], borderWidth: 1 }
                        }
                    },
                    zoom: ZOOM_CONFIG
                },
                scales: {
                    x: { type: 'time', time: { unit: 'year' }, ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
                    y: {
                        position: 'left',
                        title: { display: true, text: 'Mayer', color: '#6366f1' },
                        ticks: { color: '#6b7280', callback: v => v.toFixed(1) + 'x' },
                        grid: {
                            color: (c) => (Math.abs(c.tick.value - 2.4) < 0.05 || Math.abs(c.tick.value - 1) < 0.05) ? '#4b5563' : '#1f2937'
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
                ...CHART_DEFAULTS,
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'week' },
                        ticks: { color: '#6b7280' },
                        grid: { display: false }
                    },
                    y: {
                        ticks: {
                            color: '#6b7280',
                            callback: v => (v / 1e9).toFixed(1) + 'B'
                        },
                        grid: { color: '#1f2937' }
                    }
                }
            }
        });
    }
};
