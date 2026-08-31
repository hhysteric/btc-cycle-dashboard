/**
 * CryptoQuant API 数据拉取模块
 *
 * Free tier 限制：最近 365 天数据。
 * 用于补充 SMM 模型的 Sentiment / Miner / Macro / Rotation / Valuation tier 指标。
 */
const CryptoQuantModule = {
    API_KEY: 'Zcv1YJjIuCB0gsF0Lj0Tq8yIN65Za09obVuD523H',
    BASE: 'https://api.cryptoquant.com/v1',

    // 缓存：{ 'YYYY-MM-DD': { sopr, nupl, puell, funding, ... } }
    _cache: null,
    _loading: false,
    _error: null,

    // 端点定义
    ENDPOINTS: [
        // Sentiment tier
        { key: 'sopr', path: '/btc/market-indicator/sopr', fields: ['sopr', 'sth_sopr', 'lth_sopr'] },
        { key: 'sopr_ratio', path: '/btc/market-indicator/sopr-ratio', fields: ['sopr_ratio'] },
        { key: 'nupl', path: '/btc/network-indicator/nupl', fields: ['nupl'] },
        { key: 'funding', path: '/btc/market-data/funding-rates', params: { exchange: 'all_exchange' }, fields: ['funding_rates'] },
        { key: 'taker', path: '/btc/market-data/taker-buy-sell-stats', params: { exchange: 'all_exchange' }, fields: ['taker_buy_sell_ratio'] },
        { key: 'coinbase_premium', path: '/btc/market-data/coinbase-premium-index', fields: ['coinbase_premium_index'] },
        // Valuation tier
        { key: 'mvrv', path: '/btc/market-indicator/mvrv', fields: ['mvrv'] },
        { key: 'nvt', path: '/btc/network-indicator/nvt', fields: ['nvt'] },
        // Miner tier
        { key: 'puell', path: '/btc/network-indicator/puell-multiple', fields: ['puell_multiple'] },
        { key: 'mpi', path: '/btc/flow-indicator/mpi', params: { miner: 'all_miner' }, fields: ['mpi'] },
        // Rotation tier
        { key: 'netflow', path: '/btc/exchange-flows/netflow', params: { exchange: 'all_exchange' }, fields: ['netflow_total'] },
        { key: 'whale_ratio', path: '/btc/flow-indicator/exchange-whale-ratio', params: { exchange: 'all_exchange' }, fields: ['exchange_whale_ratio'] },
        // Macro tier
        { key: 'ssr', path: '/btc/market-indicator/stablecoin-supply-ratio', fields: ['stablecoin_supply_ratio'] },
        { key: 'leverage', path: '/btc/market-indicator/estimated-leverage-ratio', params: { exchange: 'all_exchange' }, fields: ['estimated_leverage_ratio'] },
        { key: 'oi', path: '/btc/market-data/open-interest', params: { exchange: 'all_exchange' }, fields: ['open_interest'] },
    ],

    /**
     * 并行拉取所有端点，合并成日期索引的 Map。
     * 返回 Map<'YYYY-MM-DD', { sopr, nupl, puell_multiple, funding_rates, ... }>
     */
    async fetchAll() {
        if (this._cache) return this._cache;
        if (this._loading) {
            // 等待已有请求完成
            return new Promise(resolve => {
                const check = () => {
                    if (!this._loading) resolve(this._cache);
                    else setTimeout(check, 100);
                };
                check();
            });
        }

        this._loading = true;
        this._error = null;

        try {
            // 先检查 sessionStorage 缓存（避免频繁请求）
            const cached = this._loadSessionCache();
            if (cached) {
                this._cache = cached;
                this._loading = false;
                return cached;
            }

            const results = await Promise.allSettled(
                this.ENDPOINTS.map(ep => this._fetchEndpoint(ep))
            );

            // 合并到日期索引 Map
            const merged = new Map();
            results.forEach((result, i) => {
                if (result.status !== 'fulfilled' || !result.value) return;
                const ep = this.ENDPOINTS[i];
                for (const row of result.value) {
                    const day = row.date;
                    if (!merged.has(day)) merged.set(day, {});
                    const obj = merged.get(day);
                    for (const field of ep.fields) {
                        if (row[field] != null) obj[field] = row[field];
                    }
                }
            });

            // 统计成功/失败
            const succeeded = results.filter(r => r.status === 'fulfilled' && r.value).length;
            const failed = results.length - succeeded;
            if (failed > 0) {
                console.warn(`[CryptoQuant] ${succeeded}/${results.length} endpoints loaded, ${failed} failed`);
            }

            this._cache = merged;
            this._saveSessionCache(merged);
            return merged;
        } catch (e) {
            this._error = e.message;
            console.error('[CryptoQuant] fetchAll failed:', e);
            return new Map();
        } finally {
            this._loading = false;
        }
    },

    /**
     * 拉取单个端点（通过 CORS proxy，因为 CryptoQuant API 不支持浏览器跨域）
     */
    async _fetchEndpoint(ep) {
        const params = new URLSearchParams({ window: 'day', limit: '365', ...(ep.params || {}) });
        const directUrl = `${this.BASE}${ep.path}?${params}`;
        // 使用 CORS proxy 绕过浏览器跨域限制
        const url = `https://corsproxy.io/?url=${encodeURIComponent(directUrl)}`;
        const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${this.API_KEY}` }
        });
        if (!resp.ok) {
            console.warn(`[CryptoQuant] ${ep.key} HTTP ${resp.status}`);
            return null;
        }
        const json = await resp.json();
        if (json.status?.code !== 200 || !json.result?.data) return null;
        return json.result.data;
    },

    /**
     * sessionStorage 缓存（有效期 4 小时）
     */
    _saveSessionCache(map) {
        try {
            const obj = {};
            for (const [k, v] of map) obj[k] = v;
            sessionStorage.setItem('cq_data', JSON.stringify({ ts: Date.now(), data: obj }));
        } catch (e) { /* ignore quota errors */ }
    },

    _loadSessionCache() {
        try {
            const raw = sessionStorage.getItem('cq_data');
            if (!raw) return null;
            const { ts, data } = JSON.parse(raw);
            // 4 小时过期
            if (Date.now() - ts > 4 * 60 * 60 * 1000) {
                sessionStorage.removeItem('cq_data');
                return null;
            }
            const map = new Map();
            for (const [k, v] of Object.entries(data)) map.set(k, v);
            // 空结果视为无效缓存（可能来自之前的请求失败）
            if (map.size === 0) return null;
            return map;
        } catch (e) { return null; }
    },

    /**
     * 获取指定日期的 CQ 数据（日期格式 'YYYY-MM-DD'）
     */
    get(dateStr) {
        if (!this._cache) return null;
        return this._cache.get(dateStr) || null;
    },

    /**
     * 是否已加载
     */
    isLoaded() { return this._cache != null && this._cache.size > 0; },

    /**
     * 数据覆盖天数
     */
    coverage() { return this._cache ? this._cache.size : 0; },

    /**
     * 重置缓存（用于强制刷新）
     */
    reset() {
        this._cache = null;
        this._error = null;
        this._urpdCache = null;
        try { sessionStorage.removeItem('cq_data'); } catch (e) {}
        try { sessionStorage.removeItem('cq_urpd'); } catch (e) {}
    },

    // ===== URPD (UTXO Realized Price Age Distribution) =====
    _urpdCache: null,

    /**
     * 拉取 URPD 数据：合并「各年龄段持仓量」+「各年龄段平均成本基础」。
     * 返回 { date, currentPrice, profitPercent, bands: [{band, label, supply, costBasis}] }
     */
    async fetchUrpd() {
        if (this._urpdCache) return this._urpdCache;

        // sessionStorage 缓存
        try {
            const raw = sessionStorage.getItem('cq_urpd');
            if (raw) {
                const { ts, data } = JSON.parse(raw);
                if (Date.now() - ts < 4 * 60 * 60 * 1000 && data && data.bands?.length) {
                    this._urpdCache = data;
                    return data;
                }
                sessionStorage.removeItem('cq_urpd');
            }
        } catch (e) { /* ignore */ }

        // 年龄段 key → 可读标签
        const AGE_LABELS = {
            'range_0d_1d': '<1 天', 'range_1d_1w': '1天-1周', 'range_1w_1m': '1周-1月',
            'range_1m_3m': '1-3 月', 'range_3m_6m': '3-6 月', 'range_6m_12m': '6-12 月',
            'range_12m_18m': '1-1.5 年', 'range_18m_2y': '1.5-2 年', 'range_2y_3y': '2-3 年',
            'range_3y_5y': '3-5 年', 'range_5y_7y': '5-7 年', 'range_7y_10y': '7-10 年',
            'range_10y_inf': '>10 年',
        };
        const AGE_KEYS = Object.keys(AGE_LABELS);

        try {
            const [supplyRes, costRes, pnlRes] = await Promise.allSettled([
                this._fetchEndpoint({ key: 'urpd_supply', path: '/btc/network-indicator/utxo-age-distribution', params: { limit: 1 }, fields: [] }),
                this._fetchEndpoint({ key: 'urpd_cost', path: '/btc/market-indicator/utxo-realized-price-age-distribution', params: { limit: 1 }, fields: [] }),
                this._fetchEndpoint({ key: 'urpd_pnl', path: '/btc/network-indicator/pnl-utxo', params: { limit: 1 }, fields: [] }),
            ]);

            const supplyRow = supplyRes.status === 'fulfilled' && supplyRes.value?.[0];
            const costRow = costRes.status === 'fulfilled' && costRes.value?.[0];
            const pnlRow = pnlRes.status === 'fulfilled' && pnlRes.value?.[0];

            if (!supplyRow || !costRow) {
                console.warn('[CryptoQuant] URPD: missing supply or cost data');
                return null;
            }

            const bands = [];
            for (const key of AGE_KEYS) {
                const supply = supplyRow[key];
                const costBasis = costRow[key];
                if (supply != null && costBasis != null && supply > 0) {
                    bands.push({ band: key, label: AGE_LABELS[key], supply, costBasis });
                }
            }
            // 按成本基础从低到高排序
            bands.sort((a, b) => a.costBasis - b.costBasis);

            const currentPrice = DataModule.processedData.length
                ? DataModule.processedData[DataModule.processedData.length - 1].close
                : null;

            const result = {
                date: costRow.date,
                currentPrice,
                profitPercent: pnlRow?.profit_percent ?? null,
                bands,
            };

            this._urpdCache = result;
            try {
                sessionStorage.setItem('cq_urpd', JSON.stringify({ ts: Date.now(), data: result }));
            } catch (e) { /* ignore */ }

            console.log(`[CryptoQuant] URPD loaded: ${bands.length} age bands, date=${costRow.date}`);
            return result;
        } catch (e) {
            console.warn('[CryptoQuant] URPD fetch failed:', e);
            return null;
        }
    },
};
