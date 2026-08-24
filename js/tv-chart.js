/**
 * TvChartModule — TradingView Lightweight Charts 交互式 K 线面板
 *
 * 所有指标均叠加在主图上（无副图），不同量纲的指标用独立 priceScale 显示
 *
 * 依赖：LightweightCharts (全局), DataModule, SmmModule
 */
const TvChartModule = {
    chart: null,
    candleSeries: null,
    indicators: {},         // { key: { series, scaleId } }
    activeIndicators: new Set(),
    _container: null,

    // ─── 指标定义 ───────────────────────────────────────────────
    // scaleId: 'right' = 与 BTC 价格共用右轴（同量纲的线）
    //          其他字符串 = 独立 priceScale（不同量纲，显示在左侧或隐藏）
    INDICATORS: {
        // 主图同轴（价格量纲）
        ma6:       { label: 'MA6',       color: '#3b82f6', type: 'line', scaleId: 'right' },
        ma103:     { label: 'MA103',     color: '#ef4444', type: 'line', scaleId: 'right' },
        ma110:     { label: 'MA110',     color: '#a855f7', type: 'line', scaleId: 'right' },
        ma200:     { label: 'MA200',     color: '#f59e0b', type: 'line', scaleId: 'right' },
        realized:  { label: '已实现价格', color: '#00d395', type: 'line', scaleId: 'right' },
        // 独立轴（非价格量纲）
        volume:    { label: '成交量',    color: '#6366f1', type: 'histogram', scaleId: 'vol' },
        rsi:       { label: 'RSI(14)',   color: '#f59e0b', type: 'line', scaleId: 'rsi' },
        mayer:     { label: 'Mayer',     color: '#06b6d4', type: 'line', scaleId: 'mayer' },
        mvrv:      { label: 'MVRV',      color: '#8b5cf6', type: 'line', scaleId: 'mvrv' },
        nupl:      { label: 'NUPL',      color: '#14b8a6', type: 'line', scaleId: 'nupl' },
        smm:       { label: 'SMM',       color: '#f7931a', type: 'line', scaleId: 'smm' },
        sec:       { label: '卖方衰竭',  color: '#ec4899', type: 'line', scaleId: 'sec' },
        rr:        { label: '风险回报',  color: '#22c55e', type: 'line', scaleId: 'rr' },
        etf:       { label: 'ETF净流入', color: '#06b6d4', type: 'histogram', scaleId: 'etf' },
    },

    // ─── 初始化 ───────────────────────────────────────────────────
    init() {
        const mainEl = document.getElementById('tv-main');
        if (!mainEl) return;
        if (typeof LightweightCharts === 'undefined') {
            mainEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6b7280;font-size:14px;">Lightweight Charts 库加载失败（需联网）</div>';
            return;
        }
        this._container = mainEl;

        const isDark = document.documentElement.classList.contains('dark');
        this.chart = LightweightCharts.createChart(mainEl, this._chartOptions(isDark));

        // K 线
        this.candleSeries = this.chart.addCandlestickSeries({
            upColor: '#00d395', downColor: '#ff4757',
            borderUpColor: '#00d395', borderDownColor: '#ff4757',
            wickUpColor: '#00d395', wickDownColor: '#ff4757',
        });
        this.candleSeries.setData(this._getOHLC());

        // 默认开启成交量
        this._addIndicator('volume');

        this.chart.timeScale().fitContent();
        this._bindButtons();
        this._bindThemeObserver();
    },

    // ─── 指标开关 ──────────────────────────────────────────────────
    toggle(key) {
        if (this.indicators[key]) {
            this._removeIndicator(key);
        } else {
            this._addIndicator(key);
        }
        this._updateButton(key);
    },

    _addIndicator(key) {
        const cfg = this.INDICATORS[key];
        if (!cfg || !this.chart) return;

        const data = this._getData(key);
        if (!data || !data.length) return;

        let series;
        if (cfg.type === 'histogram') {
            series = this.chart.addHistogramSeries({
                color: cfg.color,
                priceScaleId: cfg.scaleId,
                priceFormat: cfg.scaleId === 'vol' ? { type: 'volume' } : { type: 'price', precision: 0, minMove: 1 },
            });
            // 成交量和 ETF 用颜色区分
            if (key === 'volume') {
                const ohlc = DataModule.processedData;
                series.setData(data.map((d, i) => ({
                    ...d,
                    color: (ohlc[i] && ohlc[i].close >= ohlc[i].open) ? 'rgba(0,211,149,0.25)' : 'rgba(255,71,87,0.25)',
                })));
            } else if (key === 'etf') {
                series.setData(data.map(d => ({
                    ...d,
                    color: d.value >= 0 ? 'rgba(0,211,149,0.6)' : 'rgba(255,71,87,0.6)',
                })));
            } else {
                series.setData(data);
            }
        } else {
            series = this.chart.addLineSeries({
                color: cfg.color,
                lineWidth: 1.5,
                priceScaleId: cfg.scaleId,
                lastValueVisible: true,
                priceLineVisible: false,
            });
            series.setData(data);
        }

        // 配置独立 priceScale（非主轴的指标）
        if (cfg.scaleId !== 'right') {
            const scaleOpts = {};
            if (cfg.scaleId === 'vol' || cfg.scaleId === 'etf') {
                // 成交量/ETF：压缩到底部 20%
                scaleOpts.scaleMargins = { top: 0.8, bottom: 0 };
                scaleOpts.visible = false;
            } else {
                // 其他指标（RSI/Mayer/MVRV等）：使用全区域，显示左侧刻度
                scaleOpts.scaleMargins = { top: 0.05, bottom: 0.05 };
                scaleOpts.visible = true;
                scaleOpts.alignLabels = true;
            }
            this.chart.priceScale(cfg.scaleId).applyOptions(scaleOpts);
        }

        this.indicators[key] = { series, scaleId: cfg.scaleId };
        this.activeIndicators.add(key);
    },

    _removeIndicator(key) {
        if (!this.indicators[key]) return;
        this.chart.removeSeries(this.indicators[key].series);
        delete this.indicators[key];
        this.activeIndicators.delete(key);
    },

    // ─── 数据准备 ─────────────────────────────────────────────────
    _getOHLC() {
        return DataModule.processedData.map(d => ({
            time: this._toDay(d.date),
            open: d.open, high: d.high, low: d.low, close: d.close,
        }));
    },

    _getData(key) {
        const data = DataModule.processedData;
        switch (key) {
            case 'ma6': case 'ma103': case 'ma110': case 'ma200': {
                const period = { ma6: 6, ma103: 103, ma110: 110, ma200: 200 }[key];
                const ma = DataModule.calculateMA(data, period);
                return data.map((d, i) => ma[i] != null ? { time: this._toDay(d.date), value: ma[i] } : null).filter(Boolean);
            }
            case 'realized': {
                return DataModule.onchainData
                    .filter(d => d.realizedPrice != null)
                    .map(d => ({ time: this._toDay(d.date), value: d.realizedPrice }));
            }
            case 'volume': {
                return data.map(d => ({ time: this._toDay(d.date), value: d.volume }));
            }
            case 'rsi': {
                const rsi = DataModule.calculateRSI(data);
                return data.map((d, i) => rsi[i] != null ? { time: this._toDay(d.date), value: rsi[i] } : null).filter(Boolean);
            }
            case 'mayer': {
                const ma200 = DataModule.calculateMA(data, 200);
                return data.map((d, i) => ma200[i] ? { time: this._toDay(d.date), value: d.close / ma200[i] } : null).filter(Boolean);
            }
            case 'mvrv': {
                return DataModule.onchainData
                    .filter(d => d.mvrv != null)
                    .map(d => ({ time: this._toDay(d.date), value: d.mvrv }));
            }
            case 'nupl': {
                return DataModule.onchainData
                    .filter(d => d.nupl != null)
                    .map(d => ({ time: this._toDay(d.date), value: d.nupl }));
            }
            case 'smm': {
                const series = SmmModule._series || SmmModule.compute();
                if (!series) return [];
                return series.map(d => ({ time: this._toDay(d.date), value: d.smm }));
            }
            case 'sec': {
                const se = DataModule.getSellerExhaustion();
                if (!se) return [];
                return se.map(d => ({ time: this._toDay(d.date), value: d.sec }));
            }
            case 'rr': {
                const rr = DataModule.getRiskReward();
                if (!rr) return [];
                return rr.filter(d => d && d.rr != null).map(d => ({ time: this._toDay(d.date), value: d.rr }));
            }
            case 'etf': {
                return DataModule.etfData.map(d => ({ time: this._toDay(d.date), value: d.flow }));
            }
            default: return [];
        }
    },

    // ─── 工具 ─────────────────────────────────────────────────────
    _toDay(date) {
        return date.toISOString().slice(0, 10);
    },

    _chartOptions(isDark) {
        return {
            autoSize: true,
            height: 560,
            layout: {
                background: { color: isDark ? '#0f0f23' : '#ffffff' },
                textColor: isDark ? '#9ca3af' : '#374151',
            },
            grid: {
                vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)' },
                horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)' },
            },
            timeScale: {
                borderColor: isDark ? '#374151' : '#e5e7eb',
                rightOffset: 5,
                timeVisible: false,
            },
            rightPriceScale: {
                borderColor: isDark ? '#374151' : '#e5e7eb',
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
            },
            handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
        };
    },

    // ─── 按钮绑定 ─────────────────────────────────────────────────
    _bindButtons() {
        document.querySelectorAll('[data-tv-indicator]').forEach(btn => {
            btn.addEventListener('click', () => this.toggle(btn.dataset.tvIndicator));
        });
        // 初始状态：成交量按钮高亮
        this._updateButton('volume');
    },

    _updateButton(key) {
        const btn = document.querySelector(`[data-tv-indicator="${key}"]`);
        if (!btn) return;
        btn.classList.toggle('active', this.activeIndicators.has(key));
    },

    // ─── 主题跟随 ─────────────────────────────────────────────────
    _bindThemeObserver() {
        new MutationObserver(() => {
            const isDark = document.documentElement.classList.contains('dark');
            const opts = this._chartOptions(isDark);
            this.chart.applyOptions({ layout: opts.layout, grid: opts.grid });
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    },
};
