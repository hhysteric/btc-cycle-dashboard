/**
 * SatoshiMacro Model (SMM) — 自研简化版复合周期评分
 *
 * 复刻 https://satoshimacro.com/tools/crypto/satoshimacro-model/ 的方法论：
 *   - 48 个指标 → 简化为 ~13 个可本地计算的核心指标
 *   - 6 个 tier 加权合成（Timing 30%, Valuation 25%, Sentiment 20%, Rotation 10%, Miner 10%, Macro 5%）
 *   - expanding-window percentile rank（无前视偏差）
 *   - 分段校准曲线（拉伸上半区以匹配历史顶/底标定）
 *
 * 依赖：DataModule（btc_historical.csv / mvrv.csv / etf_flow.csv 已加载）
 */
const SmmModule = {
    // 缓存
    _series: null,   // [{date, smm, raw_smm, tiers:{...}, price}]
    _current: null,

    // Tier 权重（与原版一致）
    WEIGHTS: { timing: 0.30, valuation: 0.25, sentiment: 0.20, rotation: 0.10, miner: 0.10, macro: 0.05 },

    // Zone 定义
    ZONES: [
        { min: 0, max: 15, label: '极度低估', color: '#0d7d5a' },
        { min: 15, max: 30, label: '积累区', color: '#3da06b' },
        { min: 30, max: 50, label: '中性', color: '#c9a961' },
        { min: 50, max: 70, label: '警戒', color: '#d97758' },
        { min: 70, max: 85, label: '派发', color: '#bc5c3f' },
        { min: 85, max: 100, label: '周期顶部', color: '#a53b3b' },
    ],

    // ===== 核心入口 =====
    /**
     * 计算全历史 SMM series。依赖 DataModule 已加载。
     * 返回 [{date, smm, raw_smm, tiers, price}] 升序。
     */
    compute() {
        if (this._series) return this._series;

        const data = DataModule.processedData;
        if (!data || data.length < 400) { this._series = []; return []; }

        // 建立日期 → 索引映射
        const dateKey = d => d.toISOString().slice(0, 10);

        // 预计算所有日级原始指标值
        const rawIndicators = this._computeRawIndicators(data);

        // MVRV 数据（可选，缺失时 valuation tier 少一个指标）
        const mvrvByDay = new Map();
        for (const d of DataModule.onchainData) {
            mvrvByDay.set(dateKey(d.date), d.mvrv);
        }

        // ETF 数据（可选，2024 起）
        const etfByDay = new Map();
        let etfCum = 0;
        const etfSorted = [...DataModule.etfData].sort((a, b) => a.date - b.date);
        for (const d of etfSorted) {
            etfCum += d.flow;
            etfByDay.set(dateKey(d.date), { flow: d.flow, cumulative: etfCum, roll20: d.roll20 });
        }

        // 逐日计算 expanding percentile rank 并聚合
        const n = rawIndicators.length;
        const series = [];

        // 指标历史值缓冲（用于 expanding percentile）
        const history = {
            drawdown: [], days_since_ath: [], profitable_days: [], quarterly_return: [],
            mayer: [], pi_cycle: [], two_year_ma: [], week200_dist: [], mvrv_z: [],
            puell: [],
            etf_30d: [], etf_cum: [],
            four_year: [],
        };

        for (let i = 0; i < n; i++) {
            const r = rawIndicators[i];
            const day = dateKey(r.date);

            // --- Timing Tier ---
            const timingScores = [];
            if (r.four_year != null) { history.four_year.push(r.four_year); timingScores.push(this._expandingPctRank(history.four_year)); }
            if (r.drawdown != null) { history.drawdown.push(r.drawdown); timingScores.push(this._expandingPctRank(history.drawdown)); }
            if (r.days_since_ath != null) { history.days_since_ath.push(r.days_since_ath); timingScores.push(this._expandingPctRank(history.days_since_ath)); }
            if (r.profitable_days != null) { history.profitable_days.push(r.profitable_days); timingScores.push(this._expandingPctRank(history.profitable_days)); }
            if (r.quarterly_return != null) { history.quarterly_return.push(r.quarterly_return); timingScores.push(this._expandingPctRank(history.quarterly_return)); }

            // --- Valuation Tier ---
            const valuationScores = [];
            if (r.mayer != null) { history.mayer.push(r.mayer); valuationScores.push(this._expandingPctRank(history.mayer)); }
            if (r.pi_cycle != null) { history.pi_cycle.push(r.pi_cycle); valuationScores.push(this._expandingPctRank(history.pi_cycle)); }
            if (r.two_year_ma != null) { history.two_year_ma.push(r.two_year_ma); valuationScores.push(this._expandingPctRank(history.two_year_ma)); }
            if (r.week200_dist != null) { history.week200_dist.push(r.week200_dist); valuationScores.push(this._expandingPctRank(history.week200_dist)); }
            // MVRV Z-Score proxy
            const mvrv = mvrvByDay.get(day);
            if (mvrv != null) {
                // expanding Z = (mvrv - mean) / sd，再 percentile rank 该 Z 值
                history.mvrv_z.push(mvrv);
                valuationScores.push(this._expandingPctRank(history.mvrv_z));
            }

            // --- Sentiment Tier (placeholder: 50) ---
            const sentimentScore = 50;

            // --- Rotation Tier (ETF-based) ---
            const rotationScores = [];
            const etf = etfByDay.get(day);
            if (etf != null) {
                if (etf.roll20 != null) { history.etf_30d.push(etf.roll20); rotationScores.push(this._expandingPctRank(history.etf_30d)); }
                if (etf.cumulative != null) { history.etf_cum.push(etf.cumulative); rotationScores.push(this._expandingPctRank(history.etf_cum)); }
            }

            // --- Miner Tier (Puell proxy) ---
            const minerScores = [];
            if (r.puell != null) { history.puell.push(r.puell); minerScores.push(this._expandingPctRank(history.puell)); }

            // --- Macro Tier (placeholder: 50) ---
            const macroScore = 50;

            // --- Aggregate ---
            const tierScores = {
                timing: timingScores.length ? this._avg(timingScores) : null,
                valuation: valuationScores.length ? this._avg(valuationScores) : null,
                sentiment: sentimentScore,
                rotation: rotationScores.length ? this._avg(rotationScores) : 50,
                miner: minerScores.length ? this._avg(minerScores) : null,
                macro: macroScore,
            };

            // 只有 timing + valuation 都有值时才出分
            if (tierScores.timing == null || tierScores.valuation == null) {
                series.push({ date: r.date, smm: null, raw_smm: null, tiers: tierScores, price: r.price });
                continue;
            }
            // miner 缺失时用 50
            if (tierScores.miner == null) tierScores.miner = 50;

            const raw = this._weightedSum(tierScores);
            const calibrated = this._calibrate(raw);

            series.push({
                date: r.date,
                smm: Math.round(calibrated * 10) / 10,
                raw_smm: Math.round(raw * 10) / 10,
                tiers: tierScores,
                price: r.price,
            });
        }

        this._series = series;
        this._current = series.length ? series[series.length - 1] : null;
        return series;
    },

    getCurrent() {
        if (!this._series) this.compute();
        return this._current;
    },

    getZone(score) {
        if (score == null) return null;
        for (const z of this.ZONES) {
            if (score >= z.min && score < z.max) return z;
        }
        return this.ZONES[this.ZONES.length - 1]; // 100 falls into last zone
    },

    reset() {
        this._series = null;
        this._current = null;
    },

    // ===== 指标原始值计算 =====
    _computeRawIndicators(data) {
        const n = data.length;
        const result = [];

        // 预计算 MA 系列（需要的窗口：200, 111, 350, 730, 1400）
        const closes = data.map(d => d.close);
        const ma200 = this._rollMA(closes, 200);
        const ma111 = this._rollMA(closes, 111);
        const ma350 = this._rollMA(closes, 350);
        const ma730 = this._rollMA(closes, 730);
        const ma1400 = this._rollMA(closes, 1400);

        // 日产出估算（supply 差值，用于 Puell proxy）
        const dailyIssuance = new Array(n).fill(null);
        for (let i = 1; i < n; i++) {
            const diff = data[i].supply - data[i - 1].supply;
            if (diff > 0 && diff < 2000) dailyIssuance[i] = diff; // 合理范围
        }
        // 日产出收入 = 日产出 BTC × 当日价格
        const dailyRevenue = dailyIssuance.map((d, i) => d != null ? d * closes[i] : null);
        // 365 日均值（expanding 或 rolling）
        const revenueMA365 = this._rollMA(dailyRevenue, 365);

        // ATH tracker
        let ath = 0, athDate = data[0].date;
        // Profitable days buffer (最近 365 天收盘价)
        const priceWindow = [];

        for (let i = 0; i < n; i++) {
            const d = data[i];
            const price = d.close;

            // ATH
            if (price > ath) { ath = price; athDate = d.date; }

            // Drawdown from ATH (越大=越熊，rank 越高表示越接近历史底部)
            const drawdown = 1 - price / ath;

            // Days since ATH
            const daysSinceAth = Math.floor((d.date - athDate) / (1000 * 60 * 60 * 24));

            // Profitable days (past 1Y: 占比)
            priceWindow.push(price);
            if (priceWindow.length > 365) priceWindow.shift();
            const profitableDays = priceWindow.length >= 30 ? priceWindow.filter(p => p > price).length / priceWindow.length : null;

            // Quarterly return (90D)
            const quarterlyReturn = i >= 90 ? (price - data[i - 90].close) / data[i - 90].close : null;

            // 4-Year Cycle position
            const fourYear = this._fourYearScore(d.date);

            // Mayer Multiple
            const mayer = ma200[i] ? price / ma200[i] : null;

            // Pi Cycle Top: 111DMA / (350DMA × 2)
            const piCycle = (ma111[i] && ma350[i]) ? ma111[i] / (ma350[i] * 2) : null;

            // 2-Year MA Multiplier: price / MA730
            const twoYearMa = ma730[i] ? price / ma730[i] : null;

            // 200-Week MA Distance: price / MA1400
            const week200Dist = ma1400[i] ? price / ma1400[i] : null;

            // Puell Multiple proxy: daily revenue / 365d avg revenue
            const puell = (dailyRevenue[i] != null && revenueMA365[i]) ? dailyRevenue[i] / revenueMA365[i] : null;

            result.push({
                date: d.date,
                price,
                four_year: fourYear,
                drawdown,
                days_since_ath: daysSinceAth,
                profitable_days: profitableDays,
                quarterly_return: quarterlyReturn,
                mayer,
                pi_cycle: piCycle,
                two_year_ma: twoYearMa,
                week200_dist: week200Dist,
                puell,
            });
        }
        return result;
    },

    // 4-Year Cycle Score: 距最近减半的天数 → 高斯映射
    // 峰值~500天 post-halving（历史顶部 488-549 天），谷值~850天
    _fourYearScore(date) {
        // 找最近一次已发生的减半
        let lastHalving = null;
        for (const h of HALVING_DATES) {
            if (date >= h) lastHalving = h;
        }
        if (!lastHalving) return 50; // 第一次减半前，中性
        const daysSince = Math.floor((date - lastHalving) / (1000 * 60 * 60 * 24));
        // 高斯：峰值在 ~500 天（σ=150），最高映射到 ~95；底在 ~850天 σ=100 映射到 ~5
        // 用双高斯混合：上升段 + 下降段
        const peakCenter = 520, peakSigma = 180;
        const score = Math.exp(-Math.pow(daysSince - peakCenter, 2) / (2 * peakSigma * peakSigma)) * 100;
        return Math.max(0, Math.min(100, score));
    },

    // ===== 统计工具 =====

    /**
     * Expanding-window percentile rank: 当前值在到目前为止所有值中的百分位。
     * 返回 0-100。用简单 count(< current) / (n-1) 方法。
     */
    _expandingPctRank(arr) {
        const n = arr.length;
        if (n <= 1) return 50;
        const current = arr[n - 1];
        let below = 0;
        for (let i = 0; i < n - 1; i++) {
            if (arr[i] < current) below++;
        }
        return (below / (n - 1)) * 100;
    },

    _avg(arr) {
        if (!arr.length) return null;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    },

    _weightedSum(tiers) {
        let sum = 0;
        for (const [key, weight] of Object.entries(this.WEIGHTS)) {
            sum += (tiers[key] ?? 50) * weight;
        }
        return sum;
    },

    /**
     * 校准曲线（适配简化版更窄的动态范围）：
     * 由于 Sentiment/Rotation/Macro 占 35% 权重但固定为 50，我们的 raw 范围被压缩到 ~25-61。
     * 需要一条更积极的拉伸曲线将此映射到完整 0-100 zone 体系。
     *
     * 分段设计（基于实测分布）：
     *   Raw ≤30: 线性映射到 0-15（Deep Value zone）
     *   Raw 30-40: 映射到 15-30（Accumulation）
     *   Raw 40-48: 映射到 30-50（Neutral）
     *   Raw 48-55: 映射到 50-70（Caution）
     *   Raw 55-60: 映射到 70-90（Distribution）
     *   Raw >60: 映射到 90-100（Cycle Top），clamp 100
     */
    _calibrate(raw) {
        if (raw <= 30) return raw * (15 / 30);                       // 0-30 → 0-15
        if (raw <= 40) return 15 + (raw - 30) * (15 / 10);          // 30-40 → 15-30
        if (raw <= 48) return 30 + (raw - 40) * (20 / 8);           // 40-48 → 30-50
        if (raw <= 55) return 50 + (raw - 48) * (20 / 7);           // 48-55 → 50-70
        if (raw <= 60) return 70 + (raw - 55) * (20 / 5);           // 55-60 → 70-90
        if (raw <= 65) return 90 + (raw - 60) * (10 / 5);           // 60-65 → 90-100
        return 100;
    },

    /**
     * Rolling MA (handles nulls)
     */
    _rollMA(arr, period) {
        const result = new Array(arr.length).fill(null);
        let sum = 0, count = 0;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i] != null) { sum += arr[i]; count++; }
            if (i >= period) {
                const old = arr[i - period];
                if (old != null) { sum -= old; count--; }
            }
            if (i >= period - 1 && count === period) {
                result[i] = sum / period;
            }
        }
        return result;
    },

    // ===== 周报分析 =====
    analyzeSmm() {
        const cur = this.getCurrent();
        if (!cur || cur.smm == null) return null;
        const zone = this.getZone(cur.smm);
        const tiers = cur.tiers;

        // 找出贡献最大的 tier
        const tierEntries = Object.entries(tiers).filter(([, v]) => v != null);
        const maxTier = tierEntries.reduce((a, b) => (b[1] * this.WEIGHTS[b[0]] > a[1] * this.WEIGHTS[a[0]]) ? b : a);
        const tierNames = { timing: '周期时序', valuation: '估值', sentiment: '情绪', rotation: '资金轮动', miner: '矿工', macro: '宏观' };

        let text = `当前自研 SMM 复合评分 = ${cur.smm.toFixed(1)}（raw ${cur.raw_smm.toFixed(1)}），处于「${zone.label}」区间。`;
        text += `各 tier 得分：`;
        for (const [key, val] of tierEntries) {
            text += `${tierNames[key] || key} ${val != null ? val.toFixed(1) : 'N/A'}、`;
        }
        text = text.slice(0, -1) + '。';
        text += `当前主导因子为「${tierNames[maxTier[0]]}」(score ${maxTier[1].toFixed(1)}, weight ${(this.WEIGHTS[maxTier[0]] * 100).toFixed(0)}%)。`;

        // Zone 语义
        if (cur.smm <= 15) text += '处于历史极度低估区，与周期底部高度吻合，积极关注筑底信号。';
        else if (cur.smm <= 30) text += '处于积累区间，风险回报比有利。';
        else if (cur.smm <= 50) text += '处于中性区间，无明显方向性边际，跟随周期趋势。';
        else if (cur.smm <= 70) text += '进入警戒区间，周期后半段，宜逐步减仓、保护利润。';
        else if (cur.smm <= 85) text += '派发区间，历史周期顶部前 6-12 个月常见的读数区间，大幅减仓。';
        else text += '已进入历史周期顶部区间，极度谨慎。';

        return { key: 'smm', title: 'SMM 复合周期评分（自研简化版）', text };
    },
};
