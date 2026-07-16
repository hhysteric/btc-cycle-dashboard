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

    // 加载链上 CSV（MVRV Ratio + Realized Price），按日期 join。格式：逗号分隔、降序、
    // 首行表头、日期形如 2026-07-15T00:00:00Z。缺任一值的日期跳过。
    async loadOnchainCSV() {
        try {
            const [mvrvText, rpText] = await Promise.all([
                fetch('data/mvrv.csv').then(r => r.text()),
                fetch('data/realized_price.csv').then(r => r.text()),
            ]);
            const mvrv = this._parseOnchainCol(mvrvText);
            const rp = this._parseOnchainCol(rpText);
            const merged = [];
            for (const [day, m] of mvrv) {
                const r = rp.get(day);
                if (r == null) continue;
                merged.push({ date: new Date(day), mvrv: m, realizedPrice: r });
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

        const position = `当前距本轮高点已下跌 ${curDay} 天，期间最大跌幅 ${curDrawdown.toFixed(1)}%（最低出现在第 ${curLow.day} 天）。此前 3 轮周期见底耗时 ${dayMin}–${dayMax} 天，跌幅 ${ddMin.toFixed(1)}%–${ddMax.toFixed(1)}%。`;

        let outlook;
        if (curDay >= dayMax) {
            outlook = `本轮下跌天数已超过历史区间上限（${dayMax} 天），若历史规律仍成立，周期底部大概率已在近期出现或临近，可重点关注筑底信号。`;
        } else {
            outlook = `若按历史区间推演，本轮低点可能落在 ${lowDateStart} 至 ${lowDateEnd}，对应价格约 $${Math.round(priceLow).toLocaleString()}–$${Math.round(priceHigh).toLocaleString()}。当前跌幅 ${curDrawdown.toFixed(1)}% 仍浅于历史（${ddMin.toFixed(1)}%+），需警惕进一步下探。`;
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

        const position = `当前 Mayer Multiple = ${m.toFixed(2)}（价格 $${Math.round(price).toLocaleString()} / MA200 $${Math.round(ma200).toLocaleString()}）。历史上 >2.4 为过热顶部区，<1 为价值/底部区。`;
        let outlook;
        if (m > 2.4) outlook = `已进入历史过热区间，向上空间受限，需警惕均值回归带来的回调压力。`;
        else if (m < 1) outlook = `价格位于 MA200 下方（Mayer <1），历史上此区间多为中长期价值区，但也可能在熊市中继续磨底，需结合周期位置判断。`;
        else outlook = `处于 1–2.4 的中性区间，方向性不强，跟随大周期与均线趋势运行。`;
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

        const position = `当前 MVRV = ${cur.mvrv.toFixed(2)}（已实现价格 $${Math.round(cur.realizedPrice).toLocaleString()}，隐含市场均价约 $${Math.round(impliedPrice).toLocaleString()}），处于 ${cur.zone}。历史均值 ${cur.mean.toFixed(2)}，+2.0sd 顶部带 ${topCoef.toFixed(2)}（≈$${Math.round(topPrice).toLocaleString()}），-1.0sd 底部带 ${bottomCoef.toFixed(2)}（≈$${Math.round(bottomPrice).toLocaleString()}）。`;

        let outlook;
        if (cur.mvrv >= topCoef) outlook = `MVRV 已触及 +2.0sd 过热带，历史上此区间对应周期顶部风险，链上持币者浮盈丰厚、抛压易积累。`;
        else if (cur.mvrv <= bottomCoef) outlook = `MVRV 跌破 -1.0sd 底部带，全市场平均处于亏损，历史上是周期底部的价值区，但磨底可能持续。`;
        else if (cur.mvrv < cur.mean) outlook = `MVRV 低于历史均值，市场情绪偏冷，向下距 -1.0sd 底部带（≈$${Math.round(bottomPrice).toLocaleString()}）尚有空间，若继续回落将逼近历史价值区。`;
        else outlook = `MVRV 高于历史均值但未到过热带，中性偏暖，向上距 +2.0sd 顶部带（≈$${Math.round(topPrice).toLocaleString()}）仍有空间。`;
        return { key: 'mvrv', title: 'MVRV 估值带（本地自绘）', position, outlook };
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
        let outlook;
        if (wRsi < 30) outlook = `周线 RSI 已进入超卖区，历史上常对应周期性底部，若出现价格新低而 RSI 不创新低的背离，是较强的反转信号。`;
        else if (wRsi > 70) outlook = `周线 RSI 超买，中期过热，上行动能可能衰减，注意高位波动放大。`;
        else outlook = `RSI 处于中性区间，短期动能不极端，趋势由更高级别的周期/均线主导。`;
        return { key: 'rsi', title: 'RSI 强弱指标', position, outlook };
    },

    // Cointime / 链上成本线（本地无数据，做定性思路描述）
    analyzeCointime() {
        const position = `Cointime Price / 已实现价格是全市场时间加权持币成本线（本地无该链上数据，图见嵌入的 CheckOnChain 官方图表）。`;
        const outlook = `历史上每轮周期最低点都曾跌破 Cointime Price / 已实现价格。当前若 BTC 持续在成本线上方震荡，成本线会随时间缓慢抬升；若价格横盘而成本线上移并最终交叉，往往意味着市场进入亏损主导、逼近周期底部区域。建议对照嵌入图观察价格与成本线的相对位置与斜率。`;
        return { key: 'cointime', title: 'Cointime Price / 链上成本线', position, outlook };
    },

    // 汇总所有分析
    getReportAnalysis() {
        return [
            this.analyzeCycle(),
            this.analyzeMA(),
            this.analyzeMayer(),
            this.analyzeMvrv(),
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
