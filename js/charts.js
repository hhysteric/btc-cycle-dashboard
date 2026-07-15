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

const ChartsModule = {
    charts: {},

    destroyChart(id) {
        if (this.charts[id]) {
            this.charts[id].destroy();
            delete this.charts[id];
        }
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

        const datasets = cycles.map((cycle, i) => ({
            label: cycle.label,
            data: cycle.data.map(d => ({ x: d.day, y: d.normalized })),
            borderColor: CHART_COLORS.cycleColors[i],
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.1
        }));

        this.charts['cycle'] = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                ...CHART_DEFAULTS,
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: '减半后天数', color: '#6b7280' },
                        ticks: { color: '#6b7280' },
                        grid: { color: '#1f2937' }
                    },
                    y: {
                        type: 'logarithmic',
                        title: { display: true, text: '相对涨幅 (倍)', color: '#6b7280' },
                        ticks: { color: '#6b7280', callback: v => v.toFixed(1) + 'x' },
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
        const upRates = stats.map(s => s.total > 0 ? (s.up / s.total * 100).toFixed(1) : 0);

        this.charts['weekday'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: days,
                datasets: [{
                    label: '上涨概率 (%)',
                    data: upRates,
                    backgroundColor: upRates.map(r => r >= 50 ? 'rgba(0, 211, 149, 0.7)' : 'rgba(255, 71, 87, 0.7)'),
                    borderColor: upRates.map(r => r >= 50 ? '#00d395' : '#ff4757'),
                    borderWidth: 1
                }]
            },
            options: {
                ...CHART_DEFAULTS,
                plugins: {
                    ...CHART_DEFAULTS.plugins,
                    annotation: {
                        annotations: {
                            line50: { type: 'line', yMin: 50, yMax: 50, borderColor: '#6b7280', borderDash: [5, 5] }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#6b7280' }, grid: { display: false } },
                    y: { min: 40, max: 60, ticks: { color: '#6b7280', callback: v => v + '%' }, grid: { color: '#1f2937' } }
                }
            }
        });
    },

    renderRSIChart(data, timeframe = 'daily') {
        this.destroyChart('rsi');
        let series, unit;
        if (timeframe === 'weekly') {
            const weekly = DataModule.aggregateWeekly(data);
            series = weekly.slice(-260); // ~5年周线
            unit = 'year';
        } else {
            series = data.slice(-180);
            unit = 'month';
        }
        const rsi = DataModule.calculateRSI(series);
        const ctx = document.getElementById('rsi-chart').getContext('2d');

        this.charts['rsi'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: series.map(d => d.date),
                datasets: [{
                    label: `RSI-14 (${timeframe === 'weekly' ? '周线' : '日线'})`,
                    data: rsi,
                    borderColor: CHART_COLORS.purple,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false
                }]
            },
            options: {
                ...CHART_DEFAULTS,
                scales: {
                    x: {
                        type: 'time',
                        time: { unit },
                        ticks: { color: '#6b7280' },
                        grid: { color: '#1f2937' }
                    },
                    y: {
                        min: 0, max: 100,
                        ticks: { color: '#6b7280' },
                        grid: {
                            color: (c) => (c.tick.value === 70 || c.tick.value === 30) ? '#4b5563' : '#1f2937'
                        }
                    }
                }
            }
        });
    },

    // Mayer Multiple = 价格 / MA200，基于 CSV 稳定计算
    renderMayerChart(data) {
        this.destroyChart('mayer');
        const recent = data.slice(-730);
        const ma200Full = DataModule.calculateMA(data, 200);
        const startIdx = data.length - recent.length;
        const mayer = recent.map((d, i) => {
            const ma = ma200Full[startIdx + i];
            return ma ? d.close / ma : null;
        });
        const ctx = document.getElementById('mayer-chart').getContext('2d');
        this.charts['mayer'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: recent.map(d => d.date),
                datasets: [{
                    label: 'Mayer Multiple',
                    data: mayer,
                    borderColor: CHART_COLORS.blue,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    fill: true
                }]
            },
            options: {
                ...CHART_DEFAULTS,
                scales: {
                    x: { type: 'time', time: { unit: 'quarter' }, ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
                    y: {
                        ticks: { color: '#6b7280', callback: v => v.toFixed(1) + 'x' },
                        grid: {
                            color: (c) => (Math.abs(c.tick.value - 2.4) < 0.05 || Math.abs(c.tick.value - 1) < 0.05) ? '#4b5563' : '#1f2937'
                        }
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
