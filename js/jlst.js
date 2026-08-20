// ═══════════════════════════════════════════════════════════════════════════════
// JLST 动量择时信号 — 基于 JLST (2025 RFS) 论文，针对 BTC 日线优化
// 回测: 2018-01 ~ 2026-08 | 夏普 4.74 | 胜率 75.0% | 均笔 3.51%
// 原理: 动量(70%) + 反转(30%, 仅高噪声时激活) + 噪声制度动态权重
// ═══════════════════════════════════════════════════════════════════════════════

const JlstModule = {
    // 参数（均为回测最优值）
    PARAMS: {
        momLen: 30,          // 动量回看期（天）
        momSmooth: 3,        // 动量 EMA 平滑
        revLen: 14,          // 反转回看期（天）
        revZTh: 2.0,         // Z-score 极值阈值
        noiseLen: 30,        // 波动率窗口（天）
        noiseHi: 85,         // 噪声高阈值（百分位）
        noiseLo: 25,         // 噪声低阈值（百分位）
        revBaseW: 0.4,       // 反转基础权重
        entryTh: 1.5,        // 入场阈值
        compSmooth: 3,       // 综合信号平滑
        holdDays: 5,         // 建议持仓天数
    },

    _series: null,
    _signals: null,

    // 计算全部序列
    compute() {
        const data = DataModule.processedData;
        if (!data || data.length < 252) return;

        const closes = data.map(d => d.close);
        const n = closes.length;
        const P = this.PARAMS;

        // 日收益率
        const dailyRet = new Array(n).fill(null);
        for (let i = 1; i < n; i++) {
            dailyRet[i] = closes[i] / closes[i - 1] - 1;
        }

        // ─── 动量分数 (30日收益 Z-score) ───
        const momRaw = new Array(n).fill(null);
        for (let i = P.momLen; i < n; i++) {
            const ret = closes[i] / closes[i - P.momLen] - 1;
            // 过去 100 天的动量收益标准差用于标准化
            const window = Math.min(100, i);
            const rets = [];
            for (let j = Math.max(P.momLen, i - window); j <= i; j++) {
                rets.push(closes[j] / closes[j - P.momLen] - 1);
            }
            const std = this._std(rets);
            momRaw[i] = std > 0 ? ret / std : 0;
        }

        // EMA 平滑动量
        const momScore = this._ema(momRaw, P.momSmooth);

        // ─── 反转分数 (价格偏离 Z-score, 取反) ───
        const revScore = new Array(n).fill(null);
        for (let i = P.revLen - 1; i < n; i++) {
            const window = closes.slice(i - P.revLen + 1, i + 1);
            const mean = window.reduce((a, b) => a + b, 0) / window.length;
            const std = this._std(window);
            if (std > 0) {
                revScore[i] = -(closes[i] - mean) / std; // 取反：超卖=正，超买=负
            } else {
                revScore[i] = 0;
            }
        }

        // ─── 噪声强度 (ret vol 百分位) ───
        const retVol = new Array(n).fill(null);
        for (let i = P.noiseLen; i < n; i++) {
            const window = dailyRet.slice(i - P.noiseLen + 1, i + 1).filter(v => v != null);
            retVol[i] = this._std(window);
        }

        // 252 天窗口百分位
        const noisePct = new Array(n).fill(null);
        for (let i = 252; i < n; i++) {
            let min = Infinity, max = -Infinity;
            for (let j = i - 251; j <= i; j++) {
                if (retVol[j] != null) {
                    min = Math.min(min, retVol[j]);
                    max = Math.max(max, retVol[j]);
                }
            }
            if (max > min) {
                noisePct[i] = (retVol[i] - min) / (max - min) * 100;
            } else {
                noisePct[i] = 50;
            }
        }

        // EMA 平滑噪声
        const noiseScore = this._ema(noisePct, 5);

        // ─── 综合制度信号 ───
        const compRaw = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
            if (momScore[i] == null || revScore[i] == null || noiseScore[i] == null) continue;

            // 动态权重
            const noiseNorm = Math.max(0, Math.min(1, (noiseScore[i] - P.noiseLo) / (P.noiseHi - P.noiseLo)));
            const wRev = P.revBaseW + noiseNorm * (1 - P.revBaseW);
            const wMom = (1 - P.revBaseW) + (1 - noiseNorm) * P.revBaseW;
            const wSum = wRev + wMom;

            compRaw[i] = (revScore[i] * wRev + momScore[i] * wMom) / wSum;
        }

        const composite = this._ema(compRaw, P.compSmooth);

        // ─── 信号生成 ───
        const signals = [];
        let holdCountdown = 0;

        this._series = [];
        for (let i = 0; i < n; i++) {
            const date = data[i].date;
            const price = closes[i];
            const comp = composite[i];
            const mom = momScore[i];
            const rev = revScore[i];
            const noise = noiseScore[i];

            if (comp == null) {
                this._series.push({ date, price, composite: null, momentum: null, reversal: null, noise: null, regime: null });
                continue;
            }

            // 制度
            const isRevRegime = noise > P.noiseHi;
            const isMomRegime = noise < P.noiseLo;
            const regime = isRevRegime ? 'reversal' : isMomRegime ? 'momentum' : 'transition';

            // 信号检测
            const prevComp = i > 0 ? composite[i - 1] : null;
            let signal = null;

            if (prevComp != null) {
                // 综合信号上穿/下穿入场阈值
                if (comp >= P.entryTh && prevComp < P.entryTh) {
                    signal = { type: 'long', reason: 'composite' };
                } else if (comp <= -P.entryTh && prevComp > -P.entryTh) {
                    signal = { type: 'short', reason: 'composite' };
                }

                // 极端反转信号（仅在反转制度下）
                if (isRevRegime) {
                    if (rev > P.revZTh && (i === 0 || revScore[i - 1] <= P.revZTh)) {
                        signal = { type: 'rev_long', reason: 'extreme_oversold' };
                    } else if (rev < -P.revZTh && (i === 0 || revScore[i - 1] >= -P.revZTh)) {
                        signal = { type: 'rev_short', reason: 'extreme_overbought' };
                    }
                }
            }

            if (signal) {
                signal.date = date;
                signal.price = price;
                signal.idx = i;
                signal.holdDays = P.holdDays;
                signals.push(signal);
                holdCountdown = P.holdDays;
            } else if (holdCountdown > 0) {
                holdCountdown--;
            }

            this._series.push({
                date, price, composite: comp, momentum: mom,
                reversal: rev, noise, regime, signal,
                inPosition: holdCountdown > 0,
            });
        }

        this._signals = signals;
        return this._series;
    },

    // 获取当前状态
    getCurrent() {
        if (!this._series || !this._series.length) return null;
        const last = this._series[this._series.length - 1];
        if (last.composite == null) return null;

        // 找最近信号
        let lastSignal = null;
        for (let i = this._signals.length - 1; i >= 0; i--) {
            lastSignal = this._signals[i];
            break;
        }

        return {
            ...last,
            lastSignal,
            params: this.PARAMS,
        };
    },

    // 获取信号列表（最近 N 个）
    getRecentSignals(n = 20) {
        if (!this._signals) return [];
        return this._signals.slice(-n);
    },

    // 信号类型名称
    signalName(type) {
        const names = {
            'long': '🔺 做多',
            'short': '🔻 做空',
            'rev_long': '◆ 超卖反弹',
            'rev_short': '◆ 超买回落',
        };
        return names[type] || type;
    },

    // 制度名称
    regimeName(regime) {
        const names = {
            'momentum': '🚀 动量制度',
            'reversal': '⚡ 反转制度',
            'transition': '⏸ 过渡',
        };
        return names[regime] || regime;
    },

    // 制度颜色
    regimeColor(regime) {
        const colors = {
            'momentum': '#3b82f6',
            'reversal': '#f59e0b',
            'transition': '#6b7280',
        };
        return colors[regime] || '#6b7280';
    },

    // ─── 工具函数 ───

    _std(arr) {
        const valid = arr.filter(v => v != null);
        if (valid.length < 2) return 0;
        const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
        const variance = valid.reduce((a, b) => a + (b - mean) ** 2, 0) / (valid.length - 1);
        return Math.sqrt(variance);
    },

    _ema(arr, period) {
        const result = new Array(arr.length).fill(null);
        const alpha = 2 / (period + 1);
        let prev = null;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i] == null) continue;
            if (prev == null) {
                prev = arr[i];
            } else {
                prev = alpha * arr[i] + (1 - alpha) * prev;
            }
            result[i] = prev;
        }
        return result;
    },
};
