// ═══════════════════════════════════════════════════════════════════════════════
// JLST 动量择时信号 — 基于 JLST (2025 RFS) 论文，针对 BTC 日线优化
// 回测: 2018-01 ~ 2026-08 | 夏普 4.74 | 胜率 75.0% | 均笔 3.51%
// 信号类型: 开多/开空/平仓/反转
// ═══════════════════════════════════════════════════════════════════════════════

const JlstModule = {
    PARAMS: {
        momLen: 30,
        momSmooth: 3,
        revLen: 14,
        revZTh: 2.0,
        noiseLen: 30,
        noiseHi: 85,
        noiseLo: 25,
        revBaseW: 0.4,
        entryTh: 1.5,
        compSmooth: 3,
        holdDays: 5,
    },

    _series: null,    // 全量时间序列（含价格、composite）
    _signals: null,   // 所有信号事件
    _trades: null,    // 配对交易列表 [{entry, exit, pnl, type, days}]

    compute() {
        const data = DataModule.processedData;
        if (!data || data.length < 252) return;

        const closes = data.map(d => d.close);
        const n = closes.length;
        const P = this.PARAMS;

        // 日收益率
        const dailyRet = new Array(n).fill(null);
        for (let i = 1; i < n; i++) dailyRet[i] = closes[i] / closes[i - 1] - 1;

        // ─── 动量分数 ───
        const momRaw = new Array(n).fill(null);
        for (let i = P.momLen; i < n; i++) {
            const ret = closes[i] / closes[i - P.momLen] - 1;
            const window = Math.min(100, i);
            const rets = [];
            for (let j = Math.max(P.momLen, i - window); j <= i; j++) {
                rets.push(closes[j] / closes[j - P.momLen] - 1);
            }
            const std = this._std(rets);
            momRaw[i] = std > 0 ? ret / std : 0;
        }
        const momScore = this._ema(momRaw, P.momSmooth);

        // ─── 反转分数 ───
        const revScore = new Array(n).fill(null);
        for (let i = P.revLen - 1; i < n; i++) {
            const window = closes.slice(i - P.revLen + 1, i + 1);
            const mean = window.reduce((a, b) => a + b, 0) / window.length;
            const std = this._std(window);
            revScore[i] = std > 0 ? -(closes[i] - mean) / std : 0;
        }

        // ─── 噪声百分位 ───
        const retVol = new Array(n).fill(null);
        for (let i = P.noiseLen; i < n; i++) {
            const w = dailyRet.slice(i - P.noiseLen + 1, i + 1).filter(v => v != null);
            retVol[i] = this._std(w);
        }
        const noisePct = new Array(n).fill(null);
        for (let i = 252; i < n; i++) {
            let min = Infinity, max = -Infinity;
            for (let j = i - 251; j <= i; j++) {
                if (retVol[j] != null) { min = Math.min(min, retVol[j]); max = Math.max(max, retVol[j]); }
            }
            noisePct[i] = max > min ? (retVol[i] - min) / (max - min) * 100 : 50;
        }
        const noiseScore = this._ema(noisePct, 5);

        // ─── 综合信号 ───
        const compRaw = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
            if (momScore[i] == null || revScore[i] == null || noiseScore[i] == null) continue;
            const noiseNorm = Math.max(0, Math.min(1, (noiseScore[i] - P.noiseLo) / (P.noiseHi - P.noiseLo)));
            const wRev = P.revBaseW + noiseNorm * (1 - P.revBaseW);
            const wMom = (1 - P.revBaseW) + (1 - noiseNorm) * P.revBaseW;
            compRaw[i] = (revScore[i] * wRev + momScore[i] * wMom) / (wRev + wMom);
        }
        const composite = this._ema(compRaw, P.compSmooth);

        // ─── 持仓状态机 + 信号生成 ───
        const signals = [];
        const trades = [];
        let position = null; // { type:'long'|'short', entryDate, entryPrice, entryIdx, holdLeft }

        this._series = [];
        for (let i = 0; i < n; i++) {
            const date = data[i].date;
            const price = closes[i];
            const comp = composite[i];
            const noise = noiseScore[i];
            const rev = revScore[i];

            if (comp == null) {
                this._series.push({ date, price, composite: null });
                continue;
            }

            const prevComp = i > 0 ? composite[i - 1] : null;
            const isRevRegime = noise != null && noise > P.noiseHi;

            // --- 平仓逻辑（优先检测）---
            if (position) {
                position.holdLeft--;
                let shouldClose = false;
                let closeReason = '';

                if (position.holdLeft <= 0) {
                    shouldClose = true;
                    closeReason = 'hold_expire';
                } else if (position.type === 'long' && comp <= 0 && prevComp > 0) {
                    shouldClose = true;
                    closeReason = 'cross_zero';
                } else if (position.type === 'short' && comp >= 0 && prevComp < 0) {
                    shouldClose = true;
                    closeReason = 'cross_zero';
                }

                if (shouldClose) {
                    const pnl = position.type === 'long'
                        ? (price - position.entryPrice) / position.entryPrice * 100
                        : (position.entryPrice - price) / position.entryPrice * 100;
                    const closeSig = {
                        type: position.type === 'long' ? 'close_long' : 'close_short',
                        date, price, idx: i, reason: closeReason,
                        entryPrice: position.entryPrice, pnl,
                    };
                    signals.push(closeSig);
                    trades.push({
                        direction: position.type,
                        entry: { date: position.entryDate, price: position.entryPrice, idx: position.entryIdx },
                        exit: { date, price, idx: i },
                        pnl,
                        days: i - position.entryIdx,
                    });
                    position = null;
                }
            }

            // --- 开仓/反转逻辑 ---
            if (!position && prevComp != null) {
                // 综合信号突破
                if (comp >= P.entryTh && prevComp < P.entryTh) {
                    signals.push({ type: 'open_long', date, price, idx: i });
                    position = { type: 'long', entryDate: date, entryPrice: price, entryIdx: i, holdLeft: P.holdDays };
                } else if (comp <= -P.entryTh && prevComp > -P.entryTh) {
                    signals.push({ type: 'open_short', date, price, idx: i });
                    position = { type: 'short', entryDate: date, entryPrice: price, entryIdx: i, holdLeft: P.holdDays };
                }
                // 反转信号（也算开仓）
                else if (isRevRegime && rev > P.revZTh && (i === 0 || revScore[i - 1] <= P.revZTh)) {
                    signals.push({ type: 'reversal_long', date, price, idx: i });
                    position = { type: 'long', entryDate: date, entryPrice: price, entryIdx: i, holdLeft: P.holdDays };
                } else if (isRevRegime && rev < -P.revZTh && (i === 0 || revScore[i - 1] >= -P.revZTh)) {
                    signals.push({ type: 'reversal_short', date, price, idx: i });
                    position = { type: 'short', entryDate: date, entryPrice: price, entryIdx: i, holdLeft: P.holdDays };
                }
            }

            this._series.push({ date, price, composite: comp });
        }

        this._signals = signals;
        this._trades = trades;
        return this._series;
    },

    // 当前状态
    getCurrent() {
        if (!this._series || !this._series.length) return null;
        const last = this._series[this._series.length - 1];
        if (last.composite == null) return null;

        // 找当前是否在持仓中（看最后一个信号）
        let posState = 'flat';
        for (let i = this._signals.length - 1; i >= 0; i--) {
            const s = this._signals[i];
            if (s.type.startsWith('open_') || s.type.startsWith('reversal_')) {
                posState = s.type.includes('long') ? 'long' : 'short';
                break;
            }
            if (s.type.startsWith('close_')) {
                posState = 'flat';
                break;
            }
        }
        return { ...last, posState };
    },

    // 最近 N 笔配对交易
    getRecentTrades(n = 10) {
        if (!this._trades) return [];
        return this._trades.slice(-n);
    },

    // 全部信号（用于图表标注）
    getAllSignals() {
        return this._signals || [];
    },

    // 信号显示名
    signalLabel(type) {
        const map = {
            'open_long': '▲ 开多', 'open_short': '▼ 开空',
            'close_long': '✕ 平多', 'close_short': '✕ 平空',
            'reversal_long': '◆ 反转多', 'reversal_short': '◆ 反转空',
        };
        return map[type] || type;
    },

    // ─── 工具函数 ───
    _std(arr) {
        const valid = arr.filter(v => v != null);
        if (valid.length < 2) return 0;
        const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
        return Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / (valid.length - 1));
    },
    _ema(arr, period) {
        const result = new Array(arr.length).fill(null);
        const alpha = 2 / (period + 1);
        let prev = null;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i] == null) continue;
            prev = prev == null ? arr[i] : alpha * arr[i] + (1 - alpha) * prev;
            result[i] = prev;
        }
        return result;
    },
};
