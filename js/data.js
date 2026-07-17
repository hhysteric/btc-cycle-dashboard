const HALVING_DATES = [
    new Date('2012-11-28'),
    new Date('2016-07-09'),
    new Date('2020-05-11'),
    new Date('2024-04-19'),
];

const NEXT_HALVING_ESTIMATE = new Date('2028-04-01');

// 四年大周期 = 3年涨 + 1年跌 的日历年模型（参考文档四年大周期图）
// year % 4: 0 = 减半年/首轮牛, 1 = 次轮牛(顶部年), 2 = 熊年, 3 = 预备牛
const CYCLE_YEAR_PHASES = {
    0: { key: '1st-bull', name: '首轮牛市', color: '#14b8a6', desc: '减半年，牛市启动，趋势通常向上' },
    1: { key: '2nd-bull', name: '次轮牛市/顶部', color: '#22c55e', desc: '牛市延续与见顶年，注意周期顶部风险' },
    2: { key: 'bear', name: '熊市回调', color: '#ef4444', desc: '主要下跌年，历史上此阶段承压筑底' },
    3: { key: 'pre-bull', name: '预备牛市', color: '#3b82f6', desc: '筑底与复苏年，为下一轮减半牛蓄势' },
};

const DataModule = {
    rawData: [],
    processedData: [],
    onchainData: [],   // [{date, mvrv, realizedPrice}] 升序
    _mvrvBands: null,

    async loadCSV() {
        try {
            const response = await fetch('data/btc_historical.csv');
            const text = await response.text();
            this.rawData = this.parseCSV(text);
            this.processedData = this.rawData.sort((a, b) => a.date - b.date);
            return this.processedData;
        } catch (e) {
            console.error('Failed to load CSV:', e);
            return [];
        }
    },

    // 加载链上 CSV（MVRV Ratio + Realized Price + NUPL），按日期 join。格式：逗号分隔、降序、
    // 首行表头、日期形如 2026-07-15T00:00:00Z。缺 MVRV/Realized 的日期跳过；NUPL 可缺（null）。
    async loadOnchainCSV() {
        try {
            const [mvrvText, rpText, nuplText] = await Promise.all([
                fetch('data/mvrv.csv').then(r => r.text()),
                fetch('data/realized_price.csv').then(r => r.text()),
                fetch('data/nupl.csv').then(r => r.text()).catch(() => ''),
            ]);
            const mvrv = this._parseOnchainCol(mvrvText);
            const rp = this._parseOnchainCol(rpText);
            const nupl = this._parseOnchainCol(nuplText);
            const merged = [];
            for (const [day, m] of mvrv) {
                const r = rp.get(day);
                if (r == null) continue;
                merged.push({ date: new Date(day), mvrv: m, realizedPrice: r, nupl: nupl.has(day) ? nupl.get(day) : null });
            }
            this.onchainData = merged.sort((a, b) => a.date - b.date);
            this._mvrvBands = null; // 失效重算
            return this.onchainData;
        } catch (e) {
            console.warn('Failed to load on-chain CSV:', e.message);
            this.onchainData = [];
            return [];
        }
    },

    // 解析「Datetime,Value」两列 CSV，返回 Map<YYYY-MM-DD, number>（跳过空值）
    _parseOnchainCol(text) {
        const map = new Map();
        const lines = text.trim().split('\n');
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            if (cols.length < 2) continue;
            const day = cols[0].trim().slice(0, 10);
            const v = parseFloat(cols[1]);
            if (!day || isNaN(v)) continue;
            map.set(day, v);
        }
        return map;
    },

    parseCSV(text) {
        const lines = text.trim().split('\n');
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(';');
            if (cols.length < 12) continue;
            const dateStr = cols[0].replace(/"/g, '');
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) continue;
            data.push({
                date,
                open: parseFloat(cols[5]),
                high: parseFloat(cols[6]),
                low: parseFloat(cols[7]),
                close: parseFloat(cols[8]),
                volume: parseFloat(cols[9]),
                marketCap: parseFloat(cols[10]),
                supply: parseFloat(cols[11]),
            });
        }
        return data;
    },

    getLatest() {
        if (!this.processedData.length) return null;
        return this.processedData[this.processedData.length - 1];
    },

    getDataForPeriod(days) {
        if (days === 'all') return this.processedData;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        return this.processedData.filter(d => d.date >= cutoff);
    },

    calculateMA(data, period) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) {
                result.push(null);
            } else {
                let sum = 0;
                for (let j = i - period + 1; j <= i; j++) {
                    sum += data[j].close;
                }
                result.push(sum / period);
            }
        }
        return result;
    },

    // 把日线聚合成周线（以周一为起点）
    aggregateWeekly(data) {
        const weeks = new Map();
        for (const d of data) {
            const dt = new Date(d.date);
            const day = dt.getDay();
            const diff = (day === 0 ? 6 : day - 1); // 周一为一周起点
            const weekStart = new Date(dt);
            weekStart.setDate(dt.getDate() - diff);
            const key = weekStart.toISOString().slice(0, 10);
            if (!weeks.has(key)) {
                weeks.set(key, { date: new Date(key), open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume });
            } else {
                const w = weeks.get(key);
                w.high = Math.max(w.high, d.high);
                w.low = Math.min(w.low, d.low);
                w.close = d.close;
                w.volume += d.volume;
            }
        }
        return Array.from(weeks.values()).sort((a, b) => a.date - b.date);
    },

    calculateRSI(data, period = 14) {
        const result = [];
        for (let i = 0; i < period; i++) result.push(null);

        let avgGain = 0, avgLoss = 0;
        for (let i = 1; i <= period; i++) {
            const change = data[i].close - data[i - 1].close;
            if (change > 0) avgGain += change;
            else avgLoss -= change;
        }
        avgGain /= period;
        avgLoss /= period;

        for (let i = period; i < data.length; i++) {
            if (i === period) {
                const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                result.push(100 - 100 / (1 + rs));
            } else {
                const change = data[i].close - data[i - 1].close;
                const gain = change > 0 ? change : 0;
                const loss = change < 0 ? -change : 0;
                avgGain = (avgGain * (period - 1) + gain) / period;
                avgLoss = (avgLoss * (period - 1) + loss) / period;
                const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                result.push(100 - 100 / (1 + rs));
            }
        }
        return result;
    },

    // 链上指标（MVRV/NUPL/已实现价格）经实测无法从浏览器直连免费 API
    // （CORS 拦截 + 严格限流），故在页面中改为嵌入官方图表（iframe）。
    // 这里保留基于 CSV 可稳定计算的市场结构指标供概览与周报使用。

    // Mayer Multiple = 价格 / MA200，历史上 >2.4 偏高(顶部风险)，<1 偏低(价值区)
    getMayerMultiple() {
        const data = this.processedData;
        if (data.length < 200) return null;
        const ma200arr = this.calculateMA(data.slice(-200), 200);
        const ma200 = ma200arr[ma200arr.length - 1];
        if (!ma200) return null;
        return data[data.length - 1].close / ma200;
    },

    // ===== MVRV Pricing Bands（本地自绘，数据来自 CryptoQuant 导出的 CSV）=====
    // 模型（对齐 CheckOnChain MVRV Pricing Bands）：
    //   逐日用「从最早到当天」的累计(expanding) MVRV 均值 mean_i 与总体标准差 std_i，
    //   MVRV band_i = mean_i + k·std_i（随时间收敛的曲线，非固定直线）；
    //   价格 band_i = 已实现价格_i × (mean_i + k·std_i)。
    // 实测与 CheckOnChain 官方图逐点吻合（价格带 rel-MAE≈0.03%）。
    MVRV_BAND_DEFS: [
        { key: '+2.0sd', k: 2, color: '#ec4899' },
        { key: '+1.0sd', k: 1, color: '#f43f5e' },
        { key: '+0.5sd', k: 0.5, color: '#f59e0b' },
        { key: 'mean', k: 0, color: '#eab308' },
        { key: '-0.5sd', k: -0.5, color: '#3b82f6' },
        { key: '-1.0sd', k: -1, color: '#10b981' },
    ],

    // 返回 { defs, series }：series[i] = { mean, sd, coef:{key->值} } 对应 onchainData[i]。
    // coef 是当日 MVRV band 值；价格 band 由调用方乘以当日 realizedPrice。
    getMvrvBands() {
        if (this._mvrvBands) return this._mvrvBands;
        if (!this.onchainData.length) return null;
        const n = this.onchainData.length;
        const series = new Array(n);
        let sum = 0, sumSq = 0;
        for (let i = 0; i < n; i++) {
            const v = this.onchainData[i].mvrv;
            sum += v; sumSq += v * v;
            const cnt = i + 1;
            const mean = sum / cnt;
            const variance = Math.max(0, sumSq / cnt - mean * mean); // 总体方差
            const sd = Math.sqrt(variance);
            const coef = {};
            for (const def of this.MVRV_BAND_DEFS) coef[def.key] = mean + def.k * sd;
            series[i] = { mean, sd, coef };
        }
        this._mvrvBands = { defs: this.MVRV_BAND_DEFS, series };
        return this._mvrvBands;
    },

    // 最新 MVRV 值 + 落在哪个 band 区间（用当日的 band 系数判断）
    getMvrvCurrent() {
        if (!this.onchainData.length) return null;
        const bandInfo = this.getMvrvBands();
        if (!bandInfo) return null;
        const i = this.onchainData.length - 1;
        const latest = this.onchainData[i];
        const cur = bandInfo.series[i];              // 当日 band 系数
        const defs = bandInfo.defs;                  // 高→低
        const top = defs[0], bottom = defs[defs.length - 1];
        let zone = `低于 ${bottom.key}`;
        if (latest.mvrv >= cur.coef[top.key]) zone = `高于 ${top.key}`;
        else {
            for (let j = 0; j < defs.length - 1; j++) {
                if (latest.mvrv < cur.coef[defs[j].key] && latest.mvrv >= cur.coef[defs[j + 1].key]) {
                    zone = `${defs[j + 1].key} ~ ${defs[j].key} 之间`;
                    break;
                }
            }
        }
        return {
            date: latest.date, mvrv: latest.mvrv, realizedPrice: latest.realizedPrice, zone,
            mean: cur.mean, sd: cur.sd, coef: cur.coef,
            nupl: latest.nupl,
        };
    },

    // 当前 NUPL（最新一条）
    getNuplCurrent() {
        if (!this.onchainData.length) return null;
        for (let i = this.onchainData.length - 1; i >= 0; i--) {
            if (this.onchainData[i].nupl != null) {
                return { date: this.onchainData[i].date, nupl: this.onchainData[i].nupl };
            }
        }
        return null;
    },

    // ===== 底部研判共享上下文 =====
    // 汇总「历史各轮周期底部」的链上特征（价格/已实现价格比、MVRV、NUPL），供多个指标分析复用，
    // 据此给出「若历史规律重演」的底部价位区间。历轮底部经数据核对：
    //   周期1底 2015-01 P/R≈0.57 MVRV≈0.56 NUPL≈-0.77
    //   周期2底 2018-12 P/R≈0.70 MVRV≈0.69 NUPL≈-0.45
    //   周期3底 2022-11 P/R≈0.78 MVRV≈0.78 NUPL≈-0.29
    // 规律：每轮底部「跌破已实现价格」的幅度逐轮收敛（0.57→0.70→0.78），MVRV/NUPL 底部同步抬升。
    HISTORICAL_BOTTOMS: [
        { label: '周期1 (2015底)', pr: 0.571, mvrv: 0.564, nupl: -0.774 },
        { label: '周期2 (2018底)', pr: 0.701, mvrv: 0.691, nupl: -0.447 },
        { label: '周期3 (2022底)', pr: 0.779, mvrv: 0.778, nupl: -0.285 },
    ],

    getBottomContext() {
        const latest = this.getLatest();
        const mvrvCur = this.getMvrvCurrent();
        if (!latest || !mvrvCur) return null;
        const price = latest.close;
        const realized = mvrvCur.realizedPrice;
        const b = this.HISTORICAL_BOTTOMS;
        const prMin = Math.min(...b.map(x => x.pr));   // 最深（0.571）
        const prMax = Math.max(...b.map(x => x.pr));   // 最浅（0.779）
        // 底部价位区间：已实现价格 × 历轮 P/R（下限用最深、上限用最浅）
        const bottomLow = realized * prMin;
        const bottomHigh = realized * prMax;
        return {
            price, realized,
            priceToRealized: price / realized,
            mvrv: mvrvCur.mvrv,
            nupl: mvrvCur.nupl,
            bottoms: b,
            prMin, prMax,
            bottomLow, bottomHigh,
            aboveRealized: price > realized,
        };
    },

    getWeekdayStats() {
        // 短周期规律仅分析近 3 个月（约 90 天）——比全历史更贴近当下节奏
        const recent = this.processedData.slice(-91);
        const stats = Array.from({ length: 7 }, () => ({ up: 0, down: 0, total: 0, sumRet: 0 }));
        for (let i = 1; i < recent.length; i++) {
            const d = recent[i];
            const prev = recent[i - 1];
            const day = d.date.getDay();
            const ret = (d.close - prev.close) / prev.close;
            stats[day].total++;
            stats[day].sumRet += ret;
            if (d.close > prev.close) stats[day].up++;
            else stats[day].down++;
        }
        for (const s of stats) {
            s.upRate = s.total ? s.up / s.total : 0;
            s.avgRet = s.total ? s.sumRet / s.total : 0;
        }
        return stats;
    },

    // 分析短周期规律：找出上涨概率最高/最低的星期，生成可读结论
    getWeekdayPattern() {
        const stats = this.getWeekdayStats();
        const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        let best = 0, worst = 0;
        for (let i = 1; i < 7; i++) {
            if (stats[i].upRate > stats[best].upRate) best = i;
            if (stats[i].upRate < stats[worst].upRate) worst = i;
        }
        // 语义：某星期上涨概率≥50% 描述为「上涨概率」，否则描述为「下跌概率」(=1-上涨概率)
        const fmtDay = (i) => {
            const up = stats[i].upRate;
            const ret = stats[i].avgRet;
            if (up >= 0.5) return `${dayNames[i]}偏涨（上涨概率 ${(up * 100).toFixed(1)}%，平均 ${(ret * 100).toFixed(2)}%）`;
            return `${dayNames[i]}偏跌（下跌概率 ${((1 - up) * 100).toFixed(1)}%，平均 ${(ret * 100).toFixed(2)}%）`;
        };
        return {
            stats,
            dayNames,
            bestDay: best,
            worstDay: worst,
            bestRate: stats[best].upRate,
            worstRate: stats[worst].upRate,
            bestAvgRet: stats[best].avgRet,
            worstAvgRet: stats[worst].avgRet,
            summary: `近 3 个月数据显示：最强 ${fmtDay(best)}；最弱 ${fmtDay(worst)}。`
        };
    },

    // 四年周期叠加对比图：每条曲线从该轮周期的最高点(day 0, 归一化=1)开始绘制，
    // 展示见顶后的回撤与恢复过程。横轴为"距该轮最高点的天数"，纵轴为相对最高点的倍数（对数）。
    getCycleData() {
        // 各减半周期区间，用于在区间内定位历史最高点
        const cycleRanges = [
            { start: '2011-01-01', end: '2015-01-01', label: '周期1 (2013顶)' },
            { start: '2015-01-01', end: '2019-01-01', label: '周期2 (2017顶)' },
            { start: '2019-01-01', end: '2023-01-01', label: '周期3 (2021顶)' },
            { start: '2023-01-01', end: '2027-01-01', label: '周期4 (当前)' },
        ];
        const cycles = [];
        for (const r of cycleRanges) {
            const start = new Date(r.start);
            const end = new Date(r.end);
            const inRange = this.processedData.filter(d => d.date >= start && d.date < end);
            if (inRange.length === 0) continue;

            // 找该区间内最高收盘价的位置作为起点
            let peakIdx = 0;
            for (let i = 1; i < inRange.length; i++) {
                if (inRange[i].close > inRange[peakIdx].close) peakIdx = i;
            }
            const peakDate = inRange[peakIdx].date;
            const peakPrice = inRange[peakIdx].close;

            // 从最高点开始，向后取全部数据（跨到下一区间也继续，直到数据结束或到达约1600天）
            const fromPeak = this.processedData.filter(d => d.date >= peakDate);
            const maxDays = 1600;
            cycles.push({
                label: r.label,
                data: fromPeak
                    .map(d => ({
                        day: Math.floor((d.date - peakDate) / (1000 * 60 * 60 * 24)),
                        normalized: d.close / peakPrice
                    }))
                    .filter(p => p.day <= maxDays)
            });
        }
        return cycles;
    },

    // 四年大周期定位：基于日历年（3涨1跌模型），语气结合价格与均线趋势
    getCyclePhase() {
        const latest = this.getLatest();
        const now = latest ? latest.date : new Date();
        const year = now.getFullYear();
        const phaseInfo = CYCLE_YEAR_PHASES[year % 4];

        // 计算年内进度
        const yearStart = new Date(`${year}-01-01`);
        const yearEnd = new Date(`${year + 1}-01-01`);
        const yearProgress = (now - yearStart) / (yearEnd - yearStart);

        // 结合价格趋势判断（是否站上 MA200）以调整语气
        const trend = this.getTrendState();

        // 整体四年进度：以最近一次减半年为起点
        const cycleAnchorYear = year - (year % 4); // 减半年
        const cycleStart = new Date(`${cycleAnchorYear}-01-01`);
        const cycleEnd = new Date(`${cycleAnchorYear + 4}-01-01`);
        const cycleProgress = (now - cycleStart) / (cycleEnd - cycleStart);

        let tone = phaseInfo.desc;
        if (phaseInfo.key === 'bear' && trend.aboveMA200) {
            tone = '按日历年模型属回调年，但当前价格仍在 MA200 上方，趋势尚未完全转弱';
        } else if ((phaseInfo.key === '1st-bull' || phaseInfo.key === '2nd-bull') && !trend.aboveMA200) {
            tone = phaseInfo.desc + '；但当前价格已跌破 MA200，需警惕趋势背离';
        }

        return {
            year,
            phase: phaseInfo.name,
            phaseKey: phaseInfo.key,
            phaseColor: phaseInfo.color,
            detail: tone,
            yearProgress: Math.min(Math.max(yearProgress, 0), 1),
            progress: Math.min(Math.max(cycleProgress, 0), 1),
            cycleAnchorYear,
        };
    },

    getTrendState() {
        const data = this.processedData;
        if (data.length < 200) return { aboveMA200: false, aboveMA50: false, ma50: null, ma200: null };
        const ma50arr = this.calculateMA(data.slice(-50), 50);
        const ma200arr = this.calculateMA(data.slice(-200), 200);
        const ma50 = ma50arr[ma50arr.length - 1];
        const ma200 = ma200arr[ma200arr.length - 1];
        const price = data[data.length - 1].close;
        return { aboveMA200: price > ma200, aboveMA50: price > ma50, ma50, ma200, price };
    },

    // 工具：把 Date 加 n 天并格式化为 "YYYY年M月D日"
    fmtDate(date) {
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    },
    addDays(date, n) {
        const d = new Date(date);
        d.setDate(d.getDate() + n);
        return d;
    },

    // ===== 周报前瞻分析引擎：每个指标产出 {title, position, outlook} =====

    // 四年周期：当前距高点天数/跌幅，对比历史 → 推算本轮最低点日期与价格区间
    analyzeCycle() {
        const cycles = this.getCycleData();
        if (cycles.length < 2) return null;
        const latest = this.getLatest();

        // 前 3 轮（已完成）的最低点：天数 + 跌幅
        const past = cycles.slice(0, 3).map(c => {
            let low = c.data[0];
            for (const p of c.data) if (p.normalized < low.normalized) low = p;
            return { day: low.day, drawdown: (1 - low.normalized) * 100 };
        });
        const cur = cycles[cycles.length - 1];
        let curLow = cur.data[0];
        for (const p of cur.data) if (p.normalized < curLow.normalized) curLow = p;
        const curDay = cur.data[cur.data.length - 1].day; // 距高点已过天数
        const curDrawdown = (1 - curLow.normalized) * 100;

        // 本轮高点日期与价格
        const peakDate = this.addDays(latest.date, -curDay);
        // 峰值价：curLow.normalized 是相对峰值，反推峰值
        const peakPrice = curLow.normalized > 0 ? (latest.close / (cur.data[cur.data.length - 1].normalized)) : null;

        const dayMin = Math.min(...past.map(p => p.day));
        const dayMax = Math.max(...past.map(p => p.day));
        const ddMin = Math.min(...past.map(p => p.drawdown));
        const ddMax = Math.max(...past.map(p => p.drawdown));

        const lowDateStart = this.fmtDate(this.addDays(peakDate, dayMin));
        const lowDateEnd = this.fmtDate(this.addDays(peakDate, dayMax));
        const priceLow = peakPrice * (1 - ddMax / 100);
        const priceHigh = peakPrice * (1 - ddMin / 100);

        const position = `当前距本轮高点已下跌 ${curDay} 天，期间最大跌幅 ${curDrawdown.toFixed(1)}%（最低出现在第 ${curLow.day} 天）。此前 3 轮周期见底耗时 ${dayMin}–${dayMax} 天，跌幅 ${ddMin.toFixed(1)}%–${ddMax.toFixed(1)}%（分别为 ${past.map(p => p.drawdown.toFixed(0) + '%').join(' / ')}，跌幅逐轮收敛）。`;

        // 底部价位/时间区间：结合链上底部规律（若可用）给更贴合的价位
        const ctx = this.getBottomContext();
        const bandNote = ctx ? `链上视角下（已实现价格 $${Math.round(ctx.realized).toLocaleString()}），若按历轮底部「价格/已实现价格 ${ctx.prMin}–${ctx.prMax}」测算，底部价位约 $${Math.round(ctx.bottomLow).toLocaleString()}–$${Math.round(ctx.bottomHigh).toLocaleString()}。` : '';

        let outlook;
        if (curDay >= dayMax) {
            outlook = `本轮下跌天数已超过历史区间上限（${dayMax} 天），若历史规律仍成立，周期底部大概率已在近期出现或临近，可重点关注筑底信号。${bandNote}`;
        } else {
            outlook = `【时间区间】若按历史见底耗时推演，本轮低点可能落在 ${lowDateStart} 至 ${lowDateEnd}。【价位区间】按跌幅法约 $${Math.round(priceLow).toLocaleString()}–$${Math.round(priceHigh).toLocaleString()}。${bandNote}当前跌幅 ${curDrawdown.toFixed(1)}% 仍浅于历史（${ddMin.toFixed(1)}%+），若趋势转弱需警惕进一步下探。`;
        }
        return { key: 'cycle', title: '四年大周期对比（从各轮最高点对齐）', position, outlook };
    },

    // MA 分析：当前价相对 MA50/200/365 的位置；若维持当前价震荡，推算何时上穿/下穿最近的关键均线
    analyzeMA() {
        const data = this.processedData;
        if (data.length < 365) return null;
        const price = data[data.length - 1].close;
        const maVals = {};
        for (const p of [50, 200, 365]) {
            const arr = this.calculateMA(data.slice(-p), p);
            maVals[p] = arr[arr.length - 1];
        }

        const pos = [];
        for (const p of [50, 200, 365]) {
            pos.push(`MA${p} $${Math.round(maVals[p]).toLocaleString()}（价格${price > maVals[p] ? '上方' : '下方'}）`);
        }
        const position = `当前价 $${Math.round(price).toLocaleString()}。${pos.join('，')}。`;

        // 找一条价格尚未突破、且最接近的关键均线，估算"若价格维持震荡"何时穿越
        // 用 MA 近 N 日斜率外推：MA 会朝价格收敛。取 MA200 举例（最有周期意义）
        const proj = [];
        for (const p of [200, 365]) {
            const ma = maVals[p];
            const gap = price - ma; // 正=价在均线上方
            // MA 每日变化 ≈ (今日价 - period 天前的价) / period；用"维持当前价"假设：
            // 若未来每天都收在 price，则 MA 每天变化 = (price - 被移出的那天旧价)/period
            const oldPrices = data.slice(-p).map(d => d.close); // 最近 p 天，将逐日被 price 替换
            // 估算跨越所需天数：模拟维持 price 时 MA 的走向
            let simMa = ma;
            let cross = null;
            const window = oldPrices.slice(); // 复制
            for (let day = 1; day <= 400; day++) {
                // 移出最旧一天，加入 price
                const removed = window.shift();
                window.push(price);
                simMa += (price - removed) / p;
                if ((gap > 0 && price < simMa) || (gap < 0 && price > simMa) ||
                    Math.abs(price - simMa) / price < 0.005) {
                    cross = day;
                    break;
                }
            }
            if (cross) {
                const d = this.fmtDate(this.addDays(data[data.length - 1].date, cross));
                proj.push(`若维持当前价格震荡，约 ${cross} 天后（${d}）价格将与 MA${p} 收敛${gap > 0 ? '（均线上移逼近）' : '（有望上穿）'}`);
            }
        }
        const outlook = proj.length ? proj.join('；') + '。' :
            '当前价格与主要均线偏离较大，短期内难以收敛，趋势延续为主。';
        return { key: 'ma', title: 'MA 均线分析', position, outlook };
    },

    // Mayer Multiple 分析
    analyzeMayer() {
        const m = this.getMayerMultiple();
        if (m == null) return null;
        const data = this.processedData;
        const price = data[data.length - 1].close;
        const ma200arr = this.calculateMA(data.slice(-200), 200);
        const ma200 = ma200arr[ma200arr.length - 1];

        // 历史周期底部 Mayer 多在 0.5–0.7；据此推底部价位 = MA200 × [0.5, 0.7]
        const bLo = ma200 * 0.5, bHi = ma200 * 0.7;
        const position = `当前 Mayer Multiple = ${m.toFixed(2)}（价格 $${Math.round(price).toLocaleString()} / MA200 $${Math.round(ma200).toLocaleString()}）。历史上 >2.4 为过热顶部区，<1 为价值区，周期底部多落在 0.5–0.7。`;
        let outlook;
        if (m > 2.4) outlook = `已进入历史过热区间，向上空间受限，需警惕均值回归带来的回调压力。`;
        else if (m < 1) outlook = `价格位于 MA200 下方（Mayer <1），已进入历史价值区。若按周期底部 Mayer 0.5–0.7 测算，【价位区间】约 $${Math.round(bLo).toLocaleString()}–$${Math.round(bHi).toLocaleString()}（随 MA200 下移）；此区间可能磨底，需结合周期位置判断。`;
        else outlook = `处于 1–2.4 的中性区间，方向性不强，跟随大周期与均线趋势运行。若后续转弱回到价值区，按 Mayer 0.5–0.7 对应【价位区间】约 $${Math.round(bLo).toLocaleString()}–$${Math.round(bHi).toLocaleString()}。`;
        return { key: 'mayer', title: 'Mayer Multiple（价格/MA200）', position, outlook };
    },

    // MVRV 分析（本地自绘 Pricing Bands）：当前 MVRV 值、所处 band 区间、离顶/底 band 的距离
    // 用当日 expanding 均值/标准差推得的 band（getMvrvCurrent 已返回当日 coef）。
    analyzeMvrv() {
        const cur = this.getMvrvCurrent();
        if (!cur) return null;
        const topCoef = cur.coef['+2.0sd'];
        const bottomCoef = cur.coef['-1.0sd'];
        const impliedPrice = cur.mvrv * cur.realizedPrice;
        const topPrice = topCoef * cur.realizedPrice;
        const bottomPrice = bottomCoef * cur.realizedPrice;

        // 历史周期底部 MVRV：0.56 / 0.69 / 0.78（逐轮抬升）。据此推底部价位 = 已实现价 × [0.56, 0.78]
        const bt = this.HISTORICAL_BOTTOMS;
        const mvLo = Math.min(...bt.map(x => x.mvrv)), mvHi = Math.max(...bt.map(x => x.mvrv));
        const btPriceLo = mvLo * cur.realizedPrice, btPriceHi = mvHi * cur.realizedPrice;
        const position = `当前 MVRV = ${cur.mvrv.toFixed(2)}（已实现价格 $${Math.round(cur.realizedPrice).toLocaleString()}，隐含市场均价约 $${Math.round(impliedPrice).toLocaleString()}），处于 ${cur.zone}。历史周期底部 MVRV 约 ${mvLo.toFixed(2)}–${mvHi.toFixed(2)}（${bt.map(x => x.mvrv.toFixed(2)).join(' / ')}，逐轮抬升）；顶部带 +2.0sd=${topCoef.toFixed(2)}。`;

        let outlook;
        if (cur.mvrv >= topCoef) outlook = `MVRV 已触及 +2.0sd 过热带，历史上对应周期顶部风险，链上浮盈丰厚、抛压易积累。`;
        else if (cur.mvrv <= mvHi) outlook = `MVRV 已进入历史底部区间（${mvLo.toFixed(2)}–${mvHi.toFixed(2)}），全市场平均接近或处于亏损，是周期价值区，但磨底可能持续。`;
        else outlook = `MVRV=${cur.mvrv.toFixed(2)} 高于历史底部区。若历史规律重演，周期底部 MVRV 落在 ${mvLo.toFixed(2)}–${mvHi.toFixed(2)}，对应【价位区间】约 $${Math.round(btPriceLo).toLocaleString()}–$${Math.round(btPriceHi).toLocaleString()}（以当前已实现价 $${Math.round(cur.realizedPrice).toLocaleString()} 测算，实际随已实现价变化）。`;
        return { key: 'mvrv', title: 'MVRV 估值带（本地自绘）', position, outlook };
    },

    // 已实现价格分析（链上全市场持币成本）：历轮周期底部 BTC 价格均跌破已实现价格，据此研判底部
    analyzeRealizedPrice() {
        const ctx = this.getBottomContext();
        if (!ctx) return null;
        const bt = ctx.bottoms;
        const position = `当前 BTC 价格 $${Math.round(ctx.price).toLocaleString()}，已实现价格（全市场平均持币成本）$${Math.round(ctx.realized).toLocaleString()}，价格/已实现价格 = ${ctx.priceToRealized.toFixed(2)}（价格${ctx.aboveRealized ? '在成本线上方，市场整体盈利' : '已跌破成本线，市场整体亏损'}）。`;

        // 规律：此前 3 轮周期底部，价格都跌破已实现价格，比值 0.57 / 0.70 / 0.78（逐轮抬升）
        const ratios = bt.map(x => x.pr);
        let outlook;
        if (ctx.aboveRealized) {
            outlook = `【历史规律】此前 3 轮周期底部，BTC 价格均跌破已实现价格，价格/已实现价格分别为 ${ratios.map(r => r.toFixed(2)).join(' / ')}（跌破幅度逐轮收敛）。当前价格仍在成本线上方（${ctx.priceToRealized.toFixed(2)}），尚未出现历史级别的底部信号。若重演该规律，【价位区间】约 $${Math.round(ctx.bottomLow).toLocaleString()}–$${Math.round(ctx.bottomHigh).toLocaleString()}（已实现价格 $${Math.round(ctx.realized).toLocaleString()} × ${ctx.prMin}–${ctx.prMax}）；由于已实现价格随时间缓慢变化，实际底部价位会随之调整。`;
        } else {
            outlook = `【历史规律】价格已跌破已实现价格——此前 3 轮周期底部均出现此现象（比值 ${ratios.map(r => r.toFixed(2)).join(' / ')}）。当前比值 ${ctx.priceToRealized.toFixed(2)}，已进入历史底部特征区；若比值向 ${ctx.prMin} 靠拢，对应价位约 $${Math.round(ctx.bottomLow).toLocaleString()}，是历史级别的深度价值区。`;
        }
        return { key: 'realized', title: '已实现价格 / 全市场持币成本', position, outlook };
    },

    // NUPL 分析（净未实现盈亏）：分区 + 历史底部 NUPL 转负特征
    analyzeNupl() {
        const cur = this.getNuplCurrent();
        if (!cur) return null;
        const nupl = cur.nupl;
        const bt = this.HISTORICAL_BOTTOMS;
        const nuplBottoms = bt.map(x => x.nupl);
        // NUPL 分区（CheckOnChain 口径）
        let zoneLabel;
        if (nupl >= 0.75) zoneLabel = '欣快（>0.75，顶部风险区）';
        else if (nupl >= 0.5) zoneLabel = '贪婪（0.5–0.75）';
        else if (nupl >= 0.25) zoneLabel = '乐观/焦虑（0.25–0.5）';
        else if (nupl >= 0) zoneLabel = '希望/恐惧（0–0.25）';
        else zoneLabel = '投降（<0，市场整体亏损）';
        const position = `当前 NUPL = ${nupl.toFixed(3)}，处于「${zoneLabel}」。NUPL 衡量全市场未实现盈亏占市值比例。历史周期底部 NUPL 约 ${Math.min(...nuplBottoms).toFixed(2)}–${Math.max(...nuplBottoms).toFixed(2)}（${nuplBottoms.map(v => v.toFixed(2)).join(' / ')}，逐轮抬升）。`;
        let outlook;
        if (nupl < 0) outlook = `NUPL 已转负，市场整体亏损——这是历史周期底部的典型特征（此前 3 轮底部 NUPL 分别为 ${nuplBottoms.map(v => v.toFixed(2)).join(' / ')}）。当前已进入投降区，属历史价值区间，但仍需结合价格与已实现价格确认筑底。`;
        else if (nupl >= 0.75) outlook = `NUPL 进入欣快区（>0.75），历史上对应周期顶部，浮盈过高、获利抛压风险大。`;
        else outlook = `NUPL=${nupl.toFixed(3)} 尚未转负，距历史底部（NUPL 转负、约 ${Math.max(...nuplBottoms).toFixed(2)} 以下）仍有距离，若市场进一步走弱、NUPL 逐步下探至 0 以下，才是接近周期底部的链上信号。`;
        return { key: 'nupl', title: 'NUPL 净未实现盈亏', position, outlook };
    },

    // RSI 分析（日线 + 周线）
    analyzeRSI() {
        const data = this.processedData;
        const dRsiArr = this.calculateRSI(data.slice(-60));
        const dRsi = dRsiArr[dRsiArr.length - 1];
        const weekly = this.aggregateWeekly(data);
        const wRsiArr = this.calculateRSI(weekly.slice(-60));
        const wRsi = wRsiArr[wRsiArr.length - 1];

        const position = `日线 RSI-14 = ${dRsi ? dRsi.toFixed(1) : 'N/A'}，周线 RSI-14 = ${wRsi ? wRsi.toFixed(1) : 'N/A'}。（>70 超买，<30 超卖）`;
        // RSI 本身不直接推导底部价位，给「见底信号特征」而非硬编价位
        let outlook;
        if (wRsi < 30) outlook = `【见底信号】周线 RSI 已进入超卖区（<30），历史上常对应周期性底部；若同时出现「价格创新低而 RSI 不创新低」的正向背离，是较强的反转信号，可与周期/MVRV/已实现价格的价位区间交叉验证。`;
        else if (wRsi > 70) outlook = `周线 RSI 超买（>70），中期过热，上行动能可能衰减，注意高位波动放大。`;
        else outlook = `RSI 处于中性区间，短期动能不极端。【见底信号】关注周线 RSI 是否下探至 30 以下并出现正向背离——这是底部的动能信号（不直接对应具体价位，需配合估值类指标定位）。`;
        return { key: 'rsi', title: 'RSI 强弱指标', position, outlook };
    },

    // Cointime Price（时间加权持币成本，本地无该数据，做定性思路描述，图见嵌入的 CheckOnChain）
    analyzeCointime() {
        const ctx = this.getBottomContext();
        const anchor = ctx ? `（当前已实现价格 $${Math.round(ctx.realized).toLocaleString()} 可作近似参照）` : '';
        const position = `Cointime Price 是按币龄时间加权的全市场持币成本线，比已实现价格更强调长期持有者成本${anchor}。本地无该链上数据，图见嵌入的 CheckOnChain 官方图表。`;
        const outlook = `【见底信号】历史上每轮周期最低点都曾跌破 Cointime Price / 已实现价格。若价格横盘而成本线随时间上移并最终交叉（价格跌破成本线），往往意味着市场进入亏损主导、逼近周期底部区域。具体价位请参照「已实现价格」与「MVRV」给出的底部区间，并对照嵌入图观察价格与成本线的相对位置与斜率。`;
        return { key: 'cointime', title: 'Cointime Price / 时间加权成本线', position, outlook };
    },

    // 汇总所有分析。顺序：大周期 → 均线 → 估值(Mayer/MVRV) → 链上成本(已实现价格) → 情绪(NUPL/RSI) → Cointime
    getReportAnalysis() {
        return [
            this.analyzeCycle(),
            this.analyzeMA(),
            this.analyzeMayer(),
            this.analyzeMvrv(),
            this.analyzeRealizedPrice(),
            this.analyzeNupl(),
            this.analyzeRSI(),
            this.analyzeCointime(),
        ].filter(Boolean);
    },

    async fetchStablecoinSupply() {
        try {
            const resp = await fetch('https://stablecoins.llama.fi/stablecoins?includePrices=false');
            const json = await resp.json();
            const list = json.peggedAssets || [];
            let total = 0, usdt = 0;
            for (const a of list) {
                const cur = a.circulating && (a.circulating.peggedUSD || 0);
                if (!cur) continue;
                total += cur;
                if (a.symbol === 'USDT') usdt = cur;
            }
            return { total, usdt };
        } catch (e) {
            console.warn('Stablecoin fetch failed:', e.message);
            return null;
        }
    },

    async fetchLivePrice() {
        try {
            const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true');
            const data = await resp.json();
            return {
                price: data.bitcoin.usd,
                change24h: data.bitcoin.usd_24h_change,
                marketCap: data.bitcoin.usd_market_cap
            };
        } catch (e) {
            console.warn('Live price fetch failed, using CSV data');
            const latest = this.getLatest();
            if (!latest) return null;
            const prev = this.processedData[this.processedData.length - 2];
            return {
                price: latest.close,
                change24h: prev ? ((latest.close - prev.close) / prev.close) * 100 : 0,
                marketCap: latest.marketCap
            };
        }
    }
};
