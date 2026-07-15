const HALVING_DATES = [
    new Date('2012-11-28'),
    new Date('2016-07-09'),
    new Date('2020-05-11'),
    new Date('2024-04-19'),
];

const NEXT_HALVING_ESTIMATE = new Date('2028-04-01');

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

    calculateSimpleMVRV(data) {
        const result = [];
        let realizedSum = 0;
        let supplyTracked = 0;

        for (let i = 0; i < data.length; i++) {
            supplyTracked = data[i].supply || supplyTracked;
            const dailyMoved = data[i].volume / data[i].close * 0.01;
            realizedSum += dailyMoved * data[i].close;

            if (i > 30 && supplyTracked > 0) {
                const realizedPrice = realizedSum / supplyTracked;
                const mvrv = data[i].close / realizedPrice;
                result.push(Math.min(Math.max(mvrv, 0), 10));
            } else {
                result.push(null);
            }
        }
        return result;
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

    getCycleData() {
        const cycles = [];
        for (let i = 0; i < HALVING_DATES.length; i++) {
            const start = HALVING_DATES[i];
            const end = HALVING_DATES[i + 1] || new Date();
            const cycleData = this.processedData.filter(d => d.date >= start && d.date < end);
            if (cycleData.length === 0) continue;
            const startPrice = cycleData[0].close;
            cycles.push({
                label: `周期${i + 1} (${start.getFullYear()}-${end.getFullYear()})`,
                data: cycleData.map((d, idx) => ({
                    day: idx,
                    normalized: d.close / startPrice
                }))
            });
        }
        return cycles;
    },

    getCyclePhase() {
        const now = new Date();
        const lastHalving = HALVING_DATES[HALVING_DATES.length - 1];
        const daysSinceHalving = Math.floor((now - lastHalving) / (1000 * 60 * 60 * 24));
        const cycleLengthDays = Math.floor((NEXT_HALVING_ESTIMATE - lastHalving) / (1000 * 60 * 60 * 24));
        const progress = daysSinceHalving / cycleLengthDays;

        let phase, detail;
        if (progress < 0.25) { phase = '积累期'; detail = '减半后早期积累阶段'; }
        else if (progress < 0.5) { phase = '牛市初期'; detail = '上升趋势确立中'; }
        else if (progress < 0.75) { phase = '牛市中后期'; detail = '注意风险管理'; }
        else { phase = '周期尾声'; detail = '历史高点区域，保持警惕'; }

        return { phase, detail, progress: Math.min(progress, 1), daysSinceHalving, daysToNext: cycleLengthDays - daysSinceHalving };
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
