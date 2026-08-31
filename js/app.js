let currentReport = null;
let appState = { data: null, priceInfo: null, cycleInfo: null };

// 主题：默认亮色，读 localStorage。要在渲染任何图表前先确定，保证首屏配色正确。
function applyInitialTheme() {
    const saved = localStorage.getItem('theme');
    const theme = saved === 'dark' ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    ChartsModule.setTheme(theme);
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// 私人周报入口：仅当 URL 含 #report 或 ?report 时显示导出按钮 + JLST 指标
function maybeShowReportEntry() {
    const has = location.hash === '#report' || new URLSearchParams(location.search).has('report');
    if (has) {
        document.getElementById('btn-export-report').classList.remove('hidden');
        const jlst = document.getElementById('card-jlst');
        if (jlst) jlst.classList.remove('hidden');
    }
}

async function init() {
    applyInitialTheme();
    maybeShowReportEntry();

    const data = await DataModule.loadCSV();
    if (!data.length) {
        console.error('数据加载失败，请确保 data/btc_historical.csv 文件存在');
        return;
    }
    // 链上 CSV + ETF 资金流 CSV + BTC/AAPL + Dominance 与行情并行加载；失败不阻塞主看板
    await Promise.all([DataModule.loadOnchainCSV(), DataModule.loadEtfCSV(), DataModule.loadBtcAaplCSV(), DataModule.loadDominanceCSV()]);

    // 先用 CSV 数据（本地即可得）立即渲染，不被外部 API 阻塞
    const latest = DataModule.getLatest();
    const prev = data[data.length - 2];
    let priceInfo = {
        price: latest.close,
        change24h: prev ? ((latest.close - prev.close) / prev.close) * 100 : 0,
        marketCap: latest.marketCap
    };
    const cycleInfo = DataModule.getCyclePhase();
    appState = { data, priceInfo, cycleInfo };

    updateOverview(priceInfo, cycleInfo);
    highlightCurrentPhase(cycleInfo);
    renderPriceCharts(data);
    // SMM 复合周期评分（依赖所有数据已加载）
    if (typeof SmmModule !== 'undefined') {
        try {
            SmmModule.compute();       // 先用本地数据渲染
            renderSmmSection();
        } catch (e) { console.warn('SMM compute failed:', e); }
        // 异步加载 CryptoQuant 数据，到达后用真实链上指标重算
        if (typeof CryptoQuantModule !== 'undefined') {
            CryptoQuantModule.fetchAll().then(cqData => {
                if (cqData && cqData.size > 0) {
                    SmmModule.reset();
                    SmmModule.compute(cqData);
                    renderSmmSection();
                    console.log(`[SMM] CryptoQuant data loaded (${cqData.size} days), tiers updated`);
                }
            }).catch(e => console.warn('[SMM] CryptoQuant fetch failed, using local data:', e));
            // URPD（独立端点，不影响 fetchAll）
            ChartsModule._urpdStatus('URPD 数据加载中…');
            CryptoQuantModule.fetchUrpd().then(urpd => {
                if (urpd && urpd.bands?.length) {
                    ChartsModule.renderUrpdChart(urpd);
                    const el = document.getElementById('urpd-current');
                    if (el) {
                        const parts = [`日期 ${urpd.date}`];
                        if (urpd.profitPercent != null) parts.push(`盈利 UTXO ${urpd.profitPercent.toFixed(1)}%`);
                        el.textContent = parts.join(' · ');
                    }
                } else {
                    ChartsModule.renderUrpdChart(null); // show failure message
                }
            }).catch(e => {
                console.warn('[URPD] fetch failed:', e);
                ChartsModule.renderUrpdChart(null);
            });
        }
    }
    // JLST 动量择时信号（仅依赖本地历史数据）
    if (typeof JlstModule !== 'undefined') {
        try {
            JlstModule.compute();
            renderJlstSection();
        } catch (e) { console.warn('JLST compute failed:', e); }
    }
    setupEventListeners(data, priceInfo, cycleInfo);

    document.getElementById('last-update').textContent = '更新: ' + new Date().toLocaleTimeString('zh-CN');

    // 外部数据异步加载，失败时保留 CSV 数值
    loadLivePrice(cycleInfo);
}

async function loadLivePrice(cycleInfo) {
    const live = await DataModule.fetchLivePrice();
    if (live && live.price) {
        DataModule.livePrice = live.price;   // 供各分析函数统一取价（周报「当前价」= 实时价）
        appState.priceInfo = live;
        updateOverview(live, cycleInfo);
        document.getElementById('last-update').textContent = '更新: ' + new Date().toLocaleTimeString('zh-CN') + '（实时）';
    }
}

function daysToNextHalving() {
    const next = new Date('2028-04-01');
    const now = new Date();
    return Math.max(0, Math.round((next - now) / (1000 * 60 * 60 * 24)));
}

function updateOverview(priceInfo, cycleInfo) {
    if (priceInfo) {
        document.getElementById('current-price').textContent = '$' + priceInfo.price.toLocaleString(undefined, { maximumFractionDigits: 0 });
        const changeEl = document.getElementById('price-change');
        const changeVal = priceInfo.change24h;
        changeEl.textContent = (changeVal >= 0 ? '+' : '') + changeVal.toFixed(2) + '% (24h)';
        changeEl.className = 'text-sm mt-1 ' + (changeVal >= 0 ? 'text-accent-green' : 'text-accent-red');
        document.getElementById('market-cap').textContent = '$' + (priceInfo.marketCap / 1e9).toFixed(0) + 'B';
    }

    const phaseEl = document.getElementById('cycle-phase');
    phaseEl.textContent = cycleInfo.phase;
    phaseEl.style.color = cycleInfo.phaseColor;
    document.getElementById('cycle-year').textContent = `${cycleInfo.year} 年 · 周期进度 ${(cycleInfo.progress * 100).toFixed(0)}%`;
    document.getElementById('next-halving').textContent = daysToNextHalving() + ' 天';

    // 周期模型说明与进度条
    document.getElementById('cycle-year-note').textContent = `当前 ${cycleInfo.year} 年（${cycleInfo.year}÷4 余 ${cycleInfo.year % 4}）→ ${cycleInfo.phase}。`;
    document.getElementById('cycle-progress-bar').style.width = (cycleInfo.progress * 100) + '%';
    document.getElementById('cycle-start-label').textContent = cycleInfo.cycleAnchorYear + '年初(减半)';
    document.getElementById('cycle-end-label').textContent = (cycleInfo.cycleAnchorYear + 4) + '年(下次减半)';
}

function highlightCurrentPhase(cycleInfo) {
    document.querySelectorAll('.phase-cell').forEach(cell => {
        cell.classList.remove('current');
        cell.style.color = '';
        if (cell.dataset.phase === cycleInfo.phaseKey) {
            cell.classList.add('current');
            cell.style.color = cycleInfo.phaseColor;
        }
    });
}

function renderPriceCharts(data) {
    ChartsModule.renderPriceChart(data, 'all');
    ChartsModule.renderCycleChart(DataModule.getCycleData());

    const pattern = DataModule.getWeekdayPattern();
    ChartsModule.renderWeekdayChart(pattern.stats);
    ChartsModule.renderWeekdayPriceChart(data, pattern);
    const wsEl = document.getElementById('weekday-summary');
    if (wsEl) wsEl.textContent = pattern.summary;

    ChartsModule.renderRSIChart(data, 'weekly');
    ChartsModule.renderVolumeChart(data);
    ChartsModule.renderMayerChart(data);
    ChartsModule.renderMvrvChart(true);
    ChartsModule.renderNuplChart();
    ChartsModule.renderRiskRewardChart(true);
    ChartsModule.renderSellerExhaustionChart();
    ChartsModule.renderEtfChart();
    ChartsModule.renderEtfSlopeChart();
    ChartsModule.renderDominanceChart();
    ChartsModule.renderBtcAaplChart();
    if (typeof TvChartModule !== 'undefined') TvChartModule.init();
    if (typeof repositionAllSplitHandles === 'function') setTimeout(repositionAllSplitHandles, 150);

    const etf = DataModule.etfData;
    const etfEl = document.getElementById('etf-current');
    if (etf && etf.length && etfEl) {
        const last = etf[etf.length - 1];
        const fmt = v => (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(0) + 'M';
        etfEl.textContent = '最新 ' + fmt(last.flow) + ' · 累计 $' + (last.cumulative / 1000).toFixed(1) + 'B';
        etfEl.style.color = last.flow >= 0 ? '#00d395' : '#ff4757';
    } else if (etfEl) {
        etfEl.textContent = 'ETF 数据未加载';
    }

    const slopeSeries = DataModule.getEtfSlopeSeries();
    const slopeEl = document.getElementById('etfslope-current');
    if (slopeSeries && slopeSeries.length && slopeEl) {
        const last = slopeSeries[slopeSeries.length - 1];
        if (last.slope30 != null) {
            const fmt = v => (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(0) + 'M/日';
            slopeEl.textContent = '30日斜率 ' + fmt(last.slope30);
            slopeEl.style.color = last.slope30 >= 0 ? '#00d395' : '#ff4757';
        } else {
            slopeEl.textContent = '数据不足';
        }
    } else if (slopeEl) {
        slopeEl.textContent = 'ETF 数据未加载';
    }

    const mayer = DataModule.getMayerMultiple();
    if (mayer != null) {
        const el = document.getElementById('mayer-current');
        el.textContent = mayer.toFixed(2) + 'x';
        el.style.color = mayer > 2.4 ? '#ff4757' : mayer < 1 ? '#00d395' : '#f7931a';
    }

    const mvrvCur = DataModule.getMvrvCurrent();
    const mvrvEl = document.getElementById('mvrv-current');
    if (mvrvCur && mvrvEl) {
        mvrvEl.textContent = 'MVRV ' + mvrvCur.mvrv.toFixed(2) + '（' + mvrvCur.zone + '）';
    } else if (mvrvEl) {
        mvrvEl.textContent = '链上数据未加载';
    }

    const nuplCur = DataModule.getNuplCurrent();
    const nuplEl = document.getElementById('nupl-current');
    if (nuplCur && nuplEl) {
        nuplEl.textContent = 'NUPL ' + nuplCur.nupl.toFixed(3);
        nuplEl.style.color = nuplCur.nupl < 0 ? '#00d395' : nuplCur.nupl >= 0.75 ? '#ff4757' : '#f7931a';
    } else if (nuplEl) {
        nuplEl.textContent = '链上数据未加载';
    }

    const rrCur = DataModule.getRiskRewardCurrent();
    const rrEl = document.getElementById('riskreward-current');
    if (rrCur && rrEl) {
        rrEl.textContent = 'R/R ' + rrCur.rr.toFixed(2);
        rrEl.style.color = rrCur.rr >= 3 ? '#00d395' : rrCur.rr <= 0.3 ? '#ff4757' : '#f7931a';
    } else if (rrEl) {
        rrEl.textContent = '链上数据未加载';
    }

    const secCur = DataModule.getSellerExhaustionCurrent();
    const secEl = document.getElementById('sec-current');
    if (secCur && secEl) {
        secEl.textContent = 'SEC ' + secCur.sec.toFixed(3);
        secEl.style.color = secCur.sec < 0.20 ? '#ff6b81' : secCur.sec < 0.40 ? '#f7931a' : '#3b82f6';
    } else if (secEl) {
        secEl.textContent = '计算中...';
    }

    // Dominance current values
    const domData = DataModule.dominanceData;
    const domEl = document.getElementById('dominance-current');
    if (domData && domData.length && domEl) {
        const last = domData[domData.length - 1];
        const parts = [`BTC.D ${last.btcD.toFixed(1)}%`];
        if (last.usdtD != null) parts.push(`USDT.D ${last.usdtD.toFixed(1)}%`);
        domEl.textContent = parts.join(' · ');
    }

    const btcAaplCur = DataModule.getBtcAaplCurrent();
    const btcAaplEl = document.getElementById('btcaapl-current');
    if (btcAaplCur && btcAaplEl) {
        btcAaplEl.textContent = 'BTC/AAPL ' + btcAaplCur.ratio.toFixed(1);
        btcAaplEl.style.color = '#6366f1';
    } else if (btcAaplEl) {
        btcAaplEl.textContent = '数据未加载';
    }
}

// ===== SMM 复合周期评分 Section =====
function renderSmmSection() {
    const cur = SmmModule.getCurrent();
    if (!cur || cur.smm == null) return;
    const zone = SmmModule.getZone(cur.smm);

    // 概览卡片
    const scoreEl = document.getElementById('smm-score');
    const zoneEl = document.getElementById('smm-zone');
    const rawEl = document.getElementById('smm-raw');
    if (scoreEl) { scoreEl.textContent = cur.smm.toFixed(1); scoreEl.style.color = zone.color; }
    if (zoneEl) { zoneEl.textContent = zone.label; zoneEl.style.color = zone.color; }
    if (rawEl) rawEl.textContent = 'raw ' + cur.raw_smm.toFixed(1);

    // CQ 数据状态指示
    const cqStatus = document.getElementById('smm-cq-status');
    if (cqStatus) {
        if (SmmModule.isCqActive()) {
            const days = typeof CryptoQuantModule !== 'undefined' ? CryptoQuantModule.coverage() : 0;
            cqStatus.innerHTML = `<span class="text-green-600 dark:text-green-400">✓ CryptoQuant ${days}天</span>`;
        } else {
            cqStatus.innerHTML = `<span class="text-gray-400">仅本地数据</span>`;
        }
    }

    // Tier 细分进度条（5 级颜色，加粗条）
    const tierNames = { timing: '周期时序', valuation: '估值', sentiment: '情绪', rotation: '资金轮动', miner: '矿工', macro: '宏观' };
    const tierColor = (v) => v >= 80 ? '#a53b3b' : v >= 60 ? '#d97758' : v >= 40 ? '#c9a961' : v >= 20 ? '#3da06b' : '#0d7d5a';
    const tierGrid = document.getElementById('smm-tier-grid');
    if (tierGrid) {
        tierGrid.innerHTML = Object.entries(SmmModule.WEIGHTS).map(([key, weight]) => {
            const val = cur.tiers[key];
            const pct = val != null ? val : 50;
            const color = tierColor(pct);
            return `<div class="flex items-center gap-2 py-0.5">
                <span class="w-16 text-xs font-medium text-gray-600 dark:text-gray-300 truncate">${tierNames[key]}</span>
                <span class="text-xs text-gray-400 dark:text-gray-500 w-7 text-right">${(weight * 100).toFixed(0)}%</span>
                <div class="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div class="h-full rounded-full transition-all" style="width:${pct}%;background:${color}"></div>
                </div>
                <span class="w-9 text-right text-sm font-semibold" style="color:${color}">${val != null ? val.toFixed(0) : '—'}</span>
            </div>`;
        }).join('');
    }

    // 图表渲染
    ChartsModule.renderSmmChart(SmmModule._series);
}

// ===== JLST 动量择时信号 Section =====
function renderJlstSection() {
    // 仅在 ?report 模式下渲染（section 默认 hidden，由 maybeShowReportEntry 控制）
    const card = document.getElementById('card-jlst');
    if (!card || card.classList.contains('hidden')) return;

    const cur = JlstModule.getCurrent();
    if (!cur) return;

    // 当前持仓状态
    const signalEl = document.getElementById('jlst-signal');
    if (signalEl) {
        if (cur.posState === 'long') {
            signalEl.textContent = '▲ 持多';
            signalEl.style.color = '#00E676';
        } else if (cur.posState === 'short') {
            signalEl.textContent = '▼ 持空';
            signalEl.style.color = '#FF1744';
        } else {
            signalEl.textContent = '— 空仓';
            signalEl.style.color = '';
        }
    }

    // 最近交易配对（开仓→平仓，含盈亏）
    const listEl = document.getElementById('jlst-recent-signals');
    if (listEl) {
        const trades = JlstModule.getRecentTrades(8);
        if (trades.length) {
            listEl.innerHTML = `<div class="flex flex-wrap gap-2 text-xs">` +
                trades.slice().reverse().map(t => {
                    const dirColor = t.direction === 'long' ? '#00E676' : '#FF1744';
                    const pnlColor = t.pnl >= 0 ? '#00E676' : '#FF1744';
                    const dirLabel = t.direction === 'long' ? '多' : '空';
                    const dateStr = t.entry.date.toISOString().slice(5, 10);
                    const pnlStr = (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(1) + '%';
                    return `<span class="px-2 py-1 rounded border" style="border-color:${dirColor}40;color:${pnlColor}">${dirLabel} ${dateStr} <b>${pnlStr}</b> (${t.days}d)</span>`;
                }).join('') + `</div>`;
        } else {
            listEl.innerHTML = '<span class="text-xs text-gray-400">暂无交易记录</span>';
        }
    }

    // 图表
    ChartsModule.renderJlstChart(JlstModule._series);
}

// 主题切换：切 class、存 localStorage、更新按钮、重渲染所有交互图（离屏周报图不受影响）
function toggleTheme() {
    const toDark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', toDark);
    localStorage.setItem('theme', toDark ? 'dark' : 'light');
    ChartsModule.setTheme(toDark ? 'dark' : 'light');
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.textContent = toDark ? '☀️' : '🌙';
    if (appState.data) renderPriceCharts(appState.data);
    renderSmmSection(); // SMM 图需要重绘以适配主题色
    renderJlstSection(); // JLST 图需要重绘以适配主题色
}

function setupEventListeners(data, priceInfo, cycleInfo) {
    document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);

    // MVRV / ETF 上下图之间的可拖动分隔把手
    setupSplitHandles();

    document.querySelectorAll('.chart-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.chart-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const period = btn.dataset.period === 'all' ? 'all' : parseInt(btn.dataset.period);
            ChartsModule.renderPriceChart(data, period);
        });
    });

    document.querySelectorAll('.rsi-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.rsi-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            ChartsModule.renderRSIChart(data, btn.dataset.tf);
        });
    });

    document.querySelectorAll('.zoom-reset-btn').forEach(btn => {
        btn.addEventListener('click', () => ChartsModule.resetZoom(btn.dataset.chart));
    });

    // 减半对齐图「峰值对齐」切换：各轮峰值统一为 1.0（对数显示），再点恢复
    const halvingPeakBtn = document.getElementById('btn-halving-peak');
    if (halvingPeakBtn) {
        halvingPeakBtn.addEventListener('click', () => {
            const on = ChartsModule.toggleHalvingPeakMode();
            halvingPeakBtn.classList.toggle('active', on);
            halvingPeakBtn.textContent = on ? '恢复(相对减半日)' : '两端对齐(减半=0 峰=1)';
            // 两端对齐用线性轴（含0/负值），对数按钮此时不适用：禁用并置灰；恢复时解禁
            const logBtn = document.querySelector('.log-btn[data-chart="cycle-halving"]');
            if (logBtn) {
                logBtn.disabled = on;
                logBtn.classList.toggle('opacity-40', on);
                logBtn.classList.toggle('cursor-not-allowed', on);
                if (!on) logBtn.classList.add('active');   // 恢复后普通模式默认对数
            }
        });
    }

    // MVRV 四年大周期对比：三种对齐方式切换（最高点/最低点/减半日）
    document.querySelectorAll('.mvrv-cycle-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mvrv-cycle-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (ChartsModule.renderMvrvCycleChart) ChartsModule.renderMvrvCycleChart(btn.dataset.mode);
        });
    });

    // 纵轴 线性/对数 切换
    document.querySelectorAll('.log-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const next = ChartsModule.toggleLogScale(btn.dataset.chart, btn.dataset.axis || 'y');
            if (next) btn.classList.toggle('active', next === 'logarithmic');
        });
    });

    // 全屏 / 退出全屏
    document.querySelectorAll('.fullscreen-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const el = document.getElementById(btn.dataset.target);
            if (!el) return;
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else if (el.requestFullscreen) {
                el.requestFullscreen();
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
            }
        });
    });

    // 全屏切换时重绘 Chart.js 图表以适应新尺寸，并更新按钮文案
    document.addEventListener('fullscreenchange', () => {
        const fsEl = document.fullscreenElement;
        document.querySelectorAll('.fullscreen-btn').forEach(b => {
            b.textContent = (fsEl && fsEl.id === b.dataset.target) ? '退出全屏' : '全屏';
        });
        setTimeout(() => {
            Object.values(ChartsModule.charts).forEach(c => c && c.resize());
            // Lightweight Charts 使用 autoSize，但全屏时容器高度变化需手动触发
            if (typeof TvChartModule !== 'undefined' && TvChartModule.chart) {
                const el = document.getElementById('tv-main');
                if (el) {
                    const h = document.fullscreenElement ? el.clientHeight : 560;
                    TvChartModule.chart.applyOptions({ height: h });
                }
            }
        }, 120);
    });

    // 点私人入口 → 打开配置面板（第一步）
    document.getElementById('btn-export-report').addEventListener('click', () => {
        openReportConfig(cycleInfo, data);
    });

    // 生成预览（第二步）
    document.getElementById('btn-report-generate').addEventListener('click', () => {
        buildReportPreview(cycleInfo, data);
    });

    // 添加自定义指标
    document.getElementById('btn-add-custom').addEventListener('click', addCustomSection);

    // 返回配置
    document.getElementById('btn-report-back').addEventListener('click', () => {
        document.getElementById('report-preview').classList.add('hidden');
        document.getElementById('report-config').classList.remove('hidden');
    });

    document.querySelectorAll('.close-modal-btn').forEach(b =>
        b.addEventListener('click', closeReportModal));

    document.getElementById('report-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('report-modal')) closeReportModal();
    });

    document.getElementById('btn-download-png').addEventListener('click', async () => {
        if (!currentReport) return;
        const btn = document.getElementById('btn-download-png');
        const orig = btn.textContent;
        btn.textContent = '生成中...';
        btn.disabled = true;
        try {
            await ReportModule.downloadPNG(currentReport);
        } catch (e) {
            console.error('PNG 导出失败', e);
            alert('PNG 导出失败: ' + e.message);
        }
        btn.textContent = orig;
        btn.disabled = false;
    });

    document.getElementById('btn-copy-text').addEventListener('click', () => {
        if (currentReport) {
            const text = ReportModule.getReportText(currentReport);
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.getElementById('btn-copy-text');
                btn.textContent = '已复制!';
                setTimeout(() => { btn.textContent = '复制文本'; }, 2000);
            });
        }
    });
}

// ===== 周报配置面板 =====
const CHARTABLE_KEYS = ['smm', 'cycle', 'cycletrough', 'cyclehalving', 'cyclestrength', 'ma', 'mayer', 'mvrv', 'mvrvcycle', 'realized', 'nupl', 'riskreward', 'rsi', 'etf', 'etfslope', 'btcaapl']; // 有图可裁剪的指标

let reportCrops = {};
let reportUploads = {};   // key -> dataURL（内置指标上传的覆盖图）
let customCounter = 0;    // 自定义指标计数器（生成唯一 key）

function closeReportModal() {
    document.getElementById('report-modal').classList.add('hidden');
    CHARTABLE_KEYS.forEach(k => ChartsModule.destroyMini(k));
}

// 把 file input 读成 dataURL 并回调
function readImageFile(input, onData) {
    const f = input.files && input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => onData(reader.result);
    reader.readAsDataURL(f);
}

// 内置指标项的上传区（无图则用、有图则覆盖）
function uploadBlockHtml(key) {
    return `
        <div class="mt-2 flex items-center gap-2 flex-wrap">
            <label class="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded cursor-pointer">
                上传图片<input type="file" accept="image/*" class="rpt-upload hidden" data-key="${key}">
            </label>
            <button class="rpt-upload-clear text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded hidden" data-key="${key}">清除上传</button>
            <span class="rpt-upload-state text-xs text-gray-400" data-key="${key}"></span>
        </div>`;
}

// 打开配置面板
function openReportConfig(cycleInfo, data) {
    const modal = document.getElementById('report-modal');
    modal.classList.remove('hidden');
    document.getElementById('report-preview').classList.add('hidden');
    document.getElementById('report-config').classList.remove('hidden');

    reportCrops = {};
    reportUploads = {};
    customCounter = 0;

    const list = document.getElementById('report-config-list');
    list.innerHTML = '';
    const analysis = ReportModule.getAllAnalysis();

    for (const a of analysis) {
        const hasChart = CHARTABLE_KEYS.includes(a.key);
        const item = document.createElement('div');
        item.className = 'border border-gray-700 rounded-lg p-4';
        item.dataset.key = a.key;
        item.innerHTML = `
            <label class="flex items-center gap-2 mb-3 cursor-pointer">
                <input type="checkbox" class="rpt-sel w-4 h-4 accent-yellow-500" data-key="${a.key}" checked>
                <span class="font-semibold text-accent-gold">${a.title}</span>
            </label>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                    ${hasChart ? `
                    <div class="h-48 bg-dark-900 rounded mb-2"><canvas class="rpt-mini" data-key="${a.key}"></canvas></div>
                    <div class="flex gap-2 items-center">
                        <button class="rpt-crop text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded" data-key="${a.key}">用当前视图裁剪</button>
                        <button class="rpt-crop-reset text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded" data-key="${a.key}">全图</button>
                        <span class="rpt-crop-state text-xs text-gray-400" data-key="${a.key}">全图</span>
                    </div>
                    <p class="text-xs text-gray-500 mt-1">滚轮/Shift+拖框缩放，拖动平移，框好后点「用当前视图裁剪」。也可上传图片覆盖本图。</p>
                    ` : `<div class="text-xs text-gray-500 h-48 flex items-center justify-center bg-dark-900 rounded text-center px-3">该指标无本地图表，可上传一张图片进周报</div>`}
                    ${uploadBlockHtml(a.key)}
                </div>
                <div class="space-y-2">
                    <div>
                        <div class="text-xs text-blue-300 mb-1">分析（可编辑）</div>
                        <textarea class="rpt-text w-full bg-dark-900 border border-gray-700 rounded p-2 text-sm text-gray-200" rows="7" data-key="${a.key}">${a.text || ''}</textarea>
                    </div>
                </div>
            </div>`;
        list.appendChild(item);
    }

    // 渲染 mini 图
    setTimeout(() => {
        document.querySelectorAll('.rpt-mini').forEach(cv => {
            ChartsModule.renderReportMini(cv.dataset.key, cv);
        });
    }, 30);

    wireCropButtons(list);
    wireUploadInputs(list);
}

function setCropState(key, text) {
    const el = document.querySelector(`.rpt-crop-state[data-key="${key}"]`);
    if (el) el.textContent = text;
}

// 裁剪按钮（对 root 范围内的按钮生效，供初始与新增自定义项复用）
function wireCropButtons(root) {
    root.querySelectorAll('.rpt-crop').forEach(btn => btn.onclick = () => {
        const key = btn.dataset.key;
        const crop = ChartsModule.getMiniCrop(key);
        if (crop) { reportCrops[key] = crop; setCropState(key, '已裁剪当前视图'); }
    });
    root.querySelectorAll('.rpt-crop-reset').forEach(btn => btn.onclick = () => {
        const key = btn.dataset.key;
        delete reportCrops[key];
        if (ChartsModule.miniCharts[key]) ChartsModule.miniCharts[key].resetZoom();
        setCropState(key, '全图');
    });
}

// 上传图片输入（内置指标 + 自定义指标都用这套 class）
function wireUploadInputs(root) {
    root.querySelectorAll('.rpt-upload').forEach(inp => inp.onchange = () => {
        const key = inp.dataset.key;
        readImageFile(inp, (dataURL) => {
            reportUploads[key] = dataURL;
            const st = root.querySelector(`.rpt-upload-state[data-key="${key}"]`);
            if (st) st.textContent = '已上传，将覆盖本图';
            const clr = root.querySelector(`.rpt-upload-clear[data-key="${key}"]`);
            if (clr) clr.classList.remove('hidden');
        });
    });
    root.querySelectorAll('.rpt-upload-clear').forEach(btn => btn.onclick = () => {
        const key = btn.dataset.key;
        delete reportUploads[key];
        const st = root.querySelector(`.rpt-upload-state[data-key="${key}"]`);
        if (st) st.textContent = '';
        btn.classList.add('hidden');
        const inp = root.querySelector(`.rpt-upload[data-key="${key}"]`);
        if (inp) inp.value = '';
    });
}

// 「+ 添加自定义指标」：追加一个 标题+图(可选)+观点 的可删项
function addCustomSection() {
    const key = `custom-${++customCounter}`;
    const list = document.getElementById('report-config-list');
    const item = document.createElement('div');
    item.className = 'border border-yellow-600/50 rounded-lg p-4';
    item.dataset.key = key;
    item.dataset.custom = '1';
    item.innerHTML = `
        <div class="flex items-center justify-between mb-3 gap-2">
            <input type="text" class="rpt-title flex-1 bg-dark-900 border border-gray-700 rounded p-2 text-sm font-semibold text-accent-gold" data-key="${key}" placeholder="自定义指标标题（如：ETF 净流入、宏观流动性…）" value="自定义指标 ${customCounter}">
            <button class="rpt-remove text-xs bg-red-600/80 hover:bg-red-600 px-2 py-1 rounded" data-key="${key}">删除</button>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
                <div class="text-xs text-gray-500 h-48 flex items-center justify-center bg-dark-900 rounded text-center px-3">可上传一张图片（可选）</div>
                ${uploadBlockHtml(key)}
            </div>
            <div class="space-y-2">
                <div>
                    <div class="text-xs text-blue-300 mb-1">分析（可编辑）</div>
                    <textarea class="rpt-text w-full bg-dark-900 border border-gray-700 rounded p-2 text-sm text-gray-200" rows="7" data-key="${key}" placeholder="填写该指标的分析…"></textarea>
                </div>
            </div>
        </div>`;
    list.appendChild(item);
    wireUploadInputs(item);
    item.querySelector('.rpt-remove').onclick = () => {
        delete reportUploads[key];
        item.remove();
    };
}

// 读取配置 → 生成周报预览（第二步）
function buildReportPreview(cycleInfo, data) {
    const selectedKeys = Array.from(document.querySelectorAll('.rpt-sel'))
        .filter(cb => cb.checked).map(cb => cb.dataset.key);
    const edits = {};
    document.querySelectorAll('.rpt-text').forEach(t => {
        edits[t.dataset.key] = { text: t.value };
    });

    // 自定义段：从带 data-custom 的项收集标题/分析/图
    const customSections = [];
    document.querySelectorAll('#report-config-list [data-custom="1"]').forEach(item => {
        const key = item.dataset.key;
        const title = item.querySelector('.rpt-title').value.trim() || '自定义指标';
        const e = edits[key] || {};
        customSections.push({
            key, title,
            text: e.text || '',
            image: reportUploads[key] || null,
        });
    });

    const weekdayStats = DataModule.getWeekdayStats();
    currentReport = ReportModule.generateReport(appState.priceInfo, cycleInfo, weekdayStats, data,
        { selectedKeys, crops: reportCrops, edits, uploads: reportUploads, customSections });

    const content = document.getElementById('report-content');
    content.innerHTML = '';
    const el = ReportModule.buildReportElement(currentReport);
    el.style.width = '100%';
    el.style.padding = '0';
    el.style.background = 'transparent';
    content.appendChild(el);

    document.getElementById('report-config').classList.add('hidden');
    document.getElementById('report-preview').classList.remove('hidden');
}

// ===== 图表面板可拖动分隔把手（MVRV 1 条 / ETF 2 条）=====
// 把手定位到它所在的两栏边界像素 y。data-split 指明边界：
//   MVRV 无 data-split：yMvrv(下栏)顶；ETF 'pd'：yDaily(中栏)顶；'dc'：yCum(下栏)顶。
function splitBoundaryScale(chart, handle) {
    const which = handle.dataset.split;
    if (which === 'pd') return chart.scales.yDaily;   // 价格↔日净流量 边界 = yDaily 顶
    if (which === 'dc') return chart.scales.yCum;     // 日净流量↔累计 边界 = yCum 顶
    return chart.scales.yMvrv;                        // MVRV 单条
}
function positionSplitHandle(handle) {
    const chart = ChartsModule.charts[handle.dataset.chart];
    if (!chart || !chart.scales) return;
    const sc = splitBoundaryScale(chart, handle);
    if (!sc || sc.top == null) return;
    handle.style.top = sc.top + 'px';
}

function repositionAllSplitHandles() {
    document.querySelectorAll('.chart-split-handle').forEach(positionSplitHandle);
}

function setupSplitHandles() {
    document.querySelectorAll('.chart-split-handle').forEach(handle => {
        const chartId = handle.dataset.chart;
        const which = handle.dataset.split;
        const wrap = handle.parentElement;
        let dragging = false;
        let rafPending = false;
        let lastY = 0;
        // 实际应用拖动结果。用 rAF 节流：mousemove 每秒可触发 60+ 次，
        // 若每次都更新图表会堆积；一帧只处理最后一次位置。
        const apply = () => {
            rafPending = false;
            if (!dragging) return;
            const rect = wrap.getBoundingClientRect();
            const y = lastY - rect.top;
            const ratio = y / rect.height;   // 边界在整卡中的位置占比
            if (chartId === 'mvrv') {
                ChartsModule.setMvrvSplit(ratio);
            } else if (chartId === 'etf') {
                // ETF：把 ratio 换算成「上侧栏在这两栏合计高度中的占比」
                const chart = ChartsModule.charts.etf;
                if (chart && chart.scales) {
                    const upScale = which === 'pd' ? chart.scales.yPrice : chart.scales.yDaily;
                    const dnScale = which === 'pd' ? chart.scales.yDaily : chart.scales.yCum;
                    const top = upScale.top, bottom = dnScale.bottom;
                    const local = Math.min(1, Math.max(0, (y - top) / (bottom - top)));
                    ChartsModule.setEtfSplit(which, local);
                }
            }
            repositionAllSplitHandles();
        };
        const onMove = (e) => {
            if (!dragging) return;
            lastY = e.touches ? e.touches[0].clientY : e.clientY;
            if (!rafPending) { rafPending = true; requestAnimationFrame(apply); }
        };
        const stop = () => { dragging = false; document.body.style.userSelect = ''; };
        handle.addEventListener('mousedown', (e) => { dragging = true; document.body.style.userSelect = 'none'; e.preventDefault(); });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', stop);
    });
    // 首次 + 窗口变化时定位
    setTimeout(repositionAllSplitHandles, 200);
    window.addEventListener('resize', () => setTimeout(repositionAllSplitHandles, 100));
}

document.addEventListener('DOMContentLoaded', init);
