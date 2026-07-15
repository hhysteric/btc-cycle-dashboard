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

    getWeekdayStats() {
        const stats = Array.from({ length: 7 }, () => ({ up: 0, down: 0, total: 0 }));
        for (let i = 1; i < this.processedData.length; i++) {
            const d = this.processedData[i];
            const prev = this.processedData[i - 1];
            const day = d.date.getDay();
            stats[day].total++;
            if (d.close > prev.close) stats[day].up++;
            else stats[day].down++;
        }
        return stats;
    },

    // 按"减半周期"分组，用于四年周期叠加对比图。每个周期从减半年1月1日起，横轴对齐为"周期内第几天"
    getCycleData() {
        const cycleStarts = [
            { year: 2012, label: '周期1 (2012减半)' },
            { year: 2016, label: '周期2 (2016减半)' },
            { year: 2020, label: '周期3 (2020减半)' },
            { year: 2024, label: '周期4 (2024减半·当前)' },
        ];
        const cycles = [];
        for (let i = 0; i < cycleStarts.length; i++) {
            const startYear = cycleStarts[i].year;
            const start = new Date(`${startYear}-01-01`);
            const end = new Date(`${startYear + 4}-01-01`);
            const cycleData = this.processedData.filter(d => d.date >= start && d.date < end);
            if (cycleData.length === 0) continue;
            const startPrice = cycleData[0].close;
            cycles.push({
                label: cycleStarts[i].label,
                data: cycleData.map(d => ({
                    day: Math.floor((d.date - start) / (1000 * 60 * 60 * 24)),
                    normalized: d.close / startPrice
                }))
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
