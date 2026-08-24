/**
 * TvChartModule — TradingView Lightweight Charts 交互式 K 线面板
 *
 * 功能：
 *   - BTC 日线蜡烛图（全历史）
 *   - 主图叠加指标（MA6/MA103/MA110/MA200/已实现价格）：toggle 按钮
 *   - 副图面板（成交量/RSI/Mayer/MVRV/NUPL/SMM/SEC/R-R/ETF）：toggle 按钮，时间轴同步
 *
 * 依赖：LightweightCharts (全局), DataModule, SmmModule
 */
const TvChartModule = {
    chart: null,
    candleSeries: null,
    volumeSeries: null,
    overlays: {},           // { key: ISeriesApi }
    panes: {},              // { key: { container, chart, series } }
    activeIndicators: new Set(),
    _container: null,
    _panesContainer: null,
    _syncing: false,

    // ─── 指标定义 ───────────────────────────────────────────────
    OVERLAYS: {
        ma6:       { label: 'MA6',   color: '#3b82f6' },
        ma103:     { label: 'MA103', color: '#ef4444' },
        ma110:     { label: 'MA110', color: '#a855f7' },
        ma200:     { label: 'MA200', color: '#f59e0b' },
        realized:  { label: '已实现价格', color: '#00d395' },
    },

    PANES: {
        volume:  { label: '成交量', type: 'histogram', color: '#6366f1' },
        rsi:     { label: 'RSI(14)', type: 'line', color: '#f59e0b', range: [0, 100] },
        mayer:   { label: 'Mayer', type: 'line', color: '#3b82f6', refLines: [1, 2.4] },
        mvrv:    { label: 'MVRV', type: 'line', color: '#8b5cf6', refLines: [1, 3.7] },
        nupl:    { label: 'NUPL', type: 'line', color: '#14b8a6', range: [-0.5, 1] },
        smm:     { label: 'SMM', type: 'line', color: '#f7931a', range: [0, 100] },
        sec:     { label: '卖方衰竭', type: 'line', color: '#ec4899' },
        rr:      { label: '风险回报', type: 'line', color: '#22c55e' },
        etf:     { label: 'ETF净流入', type: 'histogram', color: '#06b6d4' },
    },

    // ─── 初始化 ───────────────────────────────────────────────────
    init() {
        const mainEl = document.getElementById('tv-main');
        const panesEl = document.getElementById('tv-panes');
        if (!mainEl) return;
        if (typeof LightweightCharts === 'undefined') {
            mainEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6b7280;font-size:14px;">Lightweight Charts 库加载失败（需联网）</div>';
            return;
        }
        this._container = mainEl;
        this._panesContainer = panesEl;

        const isDark = document.documentElement.classList.contains('dark');
        this.chart = LightweightCharts.createChart(mainEl, this._chartOptions(isDark, 480));

        // K 线
        this.candleSeries = this.chart.addCandlestickSeries({
            upColor: '#00d395', downColor: '#ff4757',
            borderUpColor: '#00d395', borderDownColor: '#ff4757',
            wickUpColor: '#00d395', wickDownColor: '#ff4757',
        });
        this.candleSeries.setData(this._getOHLC());

        // 默认开启成交量（内嵌在主图底部）
        this.volumeSeries = this.chart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'vol',
        });
        this.chart.priceScale('vol').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
            borderVisible: false,
        });
        this.volumeSeries.setData(this._getVolumeData());
        this.activeIndicators.add('volume');

        this.chart.timeScale().fitContent();
        this._bindButtons();
        this._bindThemeObserver();
    },

    // ─── 主图叠加 toggle ──────────────────────────────────────────
    toggleOverlay(key) {
        if (this.overlays[key]) {
            this.chart.removeSeries(this.overlays[key]);
            delete this.overlays[key];
            this.activeIndicators.delete(key);
        } else {
            const cfg = this.OVERLAYS[key];
            if (!cfg) return;
            const series = this.chart.addLineSeries({
                color: cfg.color, lineWidth: 1.5, priceScaleId: 'right',
                lastValueVisible: true, priceLineVisible: false,
            });
            series.setData(this._getOverlayData(key));
            this.overlays[key] = series;
            this.activeIndicators.add(key);
        }
        this._updateButton(key);
    },

    // ─── 副图面板 toggle ──────────────────────────────────────────
    togglePane(key) {
        if (key === 'volume') {
            // 成交量特殊处理：在主图内开/关
            if (this.volumeSeries) {
                this.chart.removeSeries(this.volumeSeries);
                this.volumeSeries = null;
                this.activeIndicators.delete('volume');
            } else {
                this.volumeSeries = this.chart.addHistogramSeries({
                    priceFormat: { type: 'volume' }, priceScaleId: 'vol',
                });
                this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, borderVisible: false });
                this.volumeSeries.setData(this._getVolumeData());
                this.activeIndicators.add('volume');
            }
            this._updateButton(key);
            return;
        }

        if (this.panes[key]) {
            // 移除副图
            this.panes[key].chart.remove();
            this.panes[key].container.remove();
            delete this.panes[key];
            this.activeIndicators.delete(key);
            this._updateButton(key);
            return;
        }

        // 创建副图
        const cfg = this.PANES[key];
        if (!cfg) return;
        const container = document.createElement('div');
        container.className = 'tv-pane';
        container.style.cssText = 'width:100%;height:160px;margin-top:2px;position:relative;';
        // 标签
        const label = document.createElement('span');
        label.className = 'tv-pane-label';
        label.textContent = cfg.label;
        container.appendChild(label);

        this._panesContainer.appendChild(container);

        const isDark = document.documentElement.classList.contains('dark');
        const paneChart = LightweightCharts.createChart(container, this._chartOptions(isDark, 160));

        let series;
        const data = this._getPaneData(key);
        if (cfg.type === 'histogram') {
            series = paneChart.addHistogramSeries({ color: cfg.color, priceFormat: { type: 'volume' } });
            // ETF 可以为负，给不同颜色
            if (key === 'etf') {
                const coloredData = data.map(d => ({
                    ...d,
                    color: d.value >= 0 ? 'rgba(0,211,149,0.7)' : 'rgba(255,71,87,0.7)',
                }));
                series.setData(coloredData);
            } else {
                series.setData(data);
            }
        } else {
            series = paneChart.addLineSeries({ color: cfg.color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true });
            series.setData(data);
        }

        // 同步时间轴（需延迟一帧让 pane 完成布局）
        this.panes[key] = { container, chart: paneChart, series };
        this.activeIndicators.add(key);
        this._updateButton(key);
        this._syncTimeScales();

        requestAnimationFrame(() => {
            const visRange = this.chart.timeScale().getVisibleRange();
            if (visRange) {
                try { paneChart.timeScale().setVisibleRange(visRange); } catch (e) { /* ignore */ }
            }
        });
    },

    // ─── 时间轴同步 ──────────────────────────────────────────────
    _syncTimeScales() {
        // 只需要绑定一次主图的 range change
        if (this._syncBound) return;
        this._syncBound = true;

        this.chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
            if (this._syncing || !range) return;
            this._syncing = true;
            for (const p of Object.values(this.panes)) {
                try { p.chart.timeScale().setVisibleRange(range); } catch (e) { /* ignore */ }
            }
            this._syncing = false;
        });

        // 副图 → 主图也需同步
        const syncBack = (range) => {
            if (this._syncing || !range) return;
            this._syncing = true;
            try { this.chart.timeScale().setVisibleRange(range); } catch (e) { /* ignore */ }
            for (const p of Object.values(this.panes)) {
                try { p.chart.timeScale().setVisibleRange(range); } catch (e) { /* ignore */ }
            }
            this._syncing = false;
        };

        // 为已有副图绑定
        for (const p of Object.values(this.panes)) {
            p.chart.timeScale().subscribeVisibleTimeRangeChange(syncBack);
        }

        // 用 MutationObserver 监听新副图创建
        const observer = new MutationObserver(() => {
            for (const p of Object.values(this.panes)) {
                if (!p._syncBound) {
                    p.chart.timeScale().subscribeVisibleTimeRangeChange(syncBack);
                    p._syncBound = true;
                }
            }
        });
        observer.observe(this._panesContainer, { childList: true });
    },

    // ─── 数据准备 ─────────────────────────────────────────────────
    _getOHLC() {
        return DataModule.processedData.map(d => ({
            time: this._toUnix(d.date),
            open: d.open, high: d.high, low: d.low, close: d.close,
        }));
    },

    _getVolumeData() {
        return DataModule.processedData.map(d => ({
            time: this._toUnix(d.date),
            value: d.volume,
            color: d.close >= d.open ? 'rgba(0,211,149,0.3)' : 'rgba(255,71,87,0.3)',
        }));
    },

    _getOverlayData(key) {
        const data = DataModule.processedData;
        if (key === 'realized') {
            return DataModule.onchainData
                .filter(d => d.realizedPrice != null)
                .map(d => ({ time: this._toUnix(d.date), value: d.realizedPrice }));
        }
        const period = { ma6: 6, ma103: 103, ma110: 110, ma200: 200 }[key];
        if (!period) return [];
        const ma = DataModule.calculateMA(data, period);
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (ma[i] != null) result.push({ time: this._toUnix(data[i].date), value: ma[i] });
        }
        return result;
    },

    _getPaneData(key) {
        const data = DataModule.processedData;
        switch (key) {
            case 'rsi': {
                const rsi = DataModule.calculateRSI(data);
                return data.map((d, i) => rsi[i] != null ? { time: this._toUnix(d.date), value: rsi[i] } : null).filter(Boolean);
            }
            case 'mayer': {
                const ma200 = DataModule.calculateMA(data, 200);
                return data.map((d, i) => ma200[i] ? { time: this._toUnix(d.date), value: d.close / ma200[i] } : null).filter(Boolean);
            }
            case 'mvrv': {
                return DataModule.onchainData
                    .filter(d => d.mvrv != null)
                    .map(d => ({ time: this._toUnix(d.date), value: d.mvrv }));
            }
            case 'nupl': {
                return DataModule.onchainData
                    .filter(d => d.nupl != null)
                    .map(d => ({ time: this._toUnix(d.date), value: d.nupl }));
            }
            case 'smm': {
                const series = SmmModule._series || SmmModule.compute();
                if (!series) return [];
                return series.map(d => ({ time: this._toUnix(d.date), value: d.smm }));
            }
            case 'sec': {
                const se = DataModule.getSellerExhaustion();
                if (!se) return [];
                return se.map(d => ({ time: this._toUnix(d.date), value: d.sec }));
            }
            case 'rr': {
                const rr = DataModule.getRiskReward();
                if (!rr) return [];
                return rr.filter(d => d && d.rr != null).map(d => ({ time: this._toUnix(d.date), value: d.rr }));
            }
            case 'etf': {
                return DataModule.etfData.map(d => ({ time: this._toUnix(d.date), value: d.flow }));
            }
            default: return [];
        }
    },

    // ─── 工具 ─────────────────────────────────────────────────────
    _toUnix(date) {
        // Lightweight Charts 要求 UTC 日期字符串 'YYYY-MM-DD' 或 unix seconds
        if (typeof date === 'string') return date;
        return date.toISOString().slice(0, 10);
    },

    _chartOptions(isDark, height) {
        return {
            autoSize: true,
            height,
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
        const btns = document.querySelectorAll('[data-tv-indicator]');
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.tvIndicator;
                if (this.OVERLAYS[key]) {
                    this.toggleOverlay(key);
                } else if (this.PANES[key]) {
                    this.togglePane(key);
                }
            });
        });

        // 初始状态：成交量按钮高亮
        this._updateButton('volume');
    },

    _updateButton(key) {
        const btn = document.querySelector(`[data-tv-indicator="${key}"]`);
        if (!btn) return;
        if (this.activeIndicators.has(key)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    },

    // ─── 主题跟随 ─────────────────────────────────────────────────
    _bindThemeObserver() {
        const observer = new MutationObserver(() => {
            const isDark = document.documentElement.classList.contains('dark');
            this._applyTheme(isDark);
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    },

    _applyTheme(isDark) {
        const opts = this._chartOptions(isDark, 480);
        this.chart.applyOptions({ layout: opts.layout, grid: opts.grid });
        for (const p of Object.values(this.panes)) {
            const pOpts = this._chartOptions(isDark, 160);
            p.chart.applyOptions({ layout: pOpts.layout, grid: pOpts.grid });
        }
    },

    // ─── 全屏 ─────────────────────────────────────────────────────
    resize() {
        if (this.chart) this.chart.resize(this._container.clientWidth, 480);
        for (const p of Object.values(this.panes)) {
            p.chart.resize(p.container.clientWidth, 160);
        }
    },
};
