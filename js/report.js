const ReportModule = {
    generateReport(priceInfo, cycleInfo, weekdayStats, data) {
        const latest = data[data.length - 1];
        const week = data.slice(-7);
        const month = data.slice(-30);

        const weekChange = ((week[week.length - 1].close - week[0].close) / week[0].close * 100).toFixed(2);
        const monthChange = ((month[month.length - 1].close - month[0].close) / month[0].close * 100).toFixed(2);

        const ma50 = DataModule.calculateMA(data.slice(-50), 50);
        const ma200 = DataModule.calculateMA(data.slice(-200), 200);
        const currentMa50 = ma50[ma50.length - 1];
        const currentMa200 = ma200[ma200.length - 1];

        const rsi = DataModule.calculateRSI(data.slice(-30));
        const currentRSI = rsi[rsi.length - 1];

        const weekly = DataModule.aggregateWeekly(data);
        const weeklyRSIarr = DataModule.calculateRSI(weekly.slice(-40));
        const weeklyRSI = weeklyRSIarr[weeklyRSIarr.length - 1];

        const bestDay = weekdayStats.reduce((best, s, i) => {
            const rate = s.total > 0 ? s.up / s.total : 0;
            return rate > best.rate ? { day: i, rate } : best;
        }, { day: 0, rate: 0 });
        const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

        const now = new Date();
        const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

        let trendSignal = '中性';
        if (latest.close > currentMa50 && currentMa50 > currentMa200) trendSignal = '多头排列 (看涨)';
        else if (latest.close < currentMa50 && currentMa50 < currentMa200) trendSignal = '空头排列 (看跌)';
        else if (latest.close > currentMa200) trendSignal = '中期偏多';

        let rsiSignal = '中性';
        if (currentRSI > 70) rsiSignal = '超买区域，注意回调风险';
        else if (currentRSI < 30) rsiSignal = '超卖区域，可能存在反弹机会';
        else if (currentRSI > 55) rsiSignal = '偏强';

        const report = {
            title: `BTC 周期分析周报 - ${dateStr}`,
            sections: [
                {
                    title: '价格概览',
                    content: [
                        `当前价格: $${priceInfo.price.toLocaleString()}`,
                        `24h 变化: ${priceInfo.change24h >= 0 ? '+' : ''}${priceInfo.change24h.toFixed(2)}%`,
                        `周涨跌幅: ${weekChange >= 0 ? '+' : ''}${weekChange}%`,
                        `月涨跌幅: ${monthChange >= 0 ? '+' : ''}${monthChange}%`,
                        `市值: $${(priceInfo.marketCap / 1e9).toFixed(0)}B`,
                    ]
                },
                {
                    title: '四年周期分析',
                    content: [
                        `当前年份: ${cycleInfo.year} 年（${cycleInfo.year}÷4 余 ${cycleInfo.year % 4}）`,
                        `周期阶段: ${cycleInfo.phase}（3年涨+1年跌日历年模型）`,
                        `周期进度: ${(cycleInfo.progress * 100).toFixed(1)}%`,
                        `周期定位: ${cycleInfo.detail}`,
                    ]
                },
                {
                    title: '技术指标',
                    content: [
                        `MA50: $${currentMa50 ? currentMa50.toFixed(0) : 'N/A'} | MA200: $${currentMa200 ? currentMa200.toFixed(0) : 'N/A'}`,
                        `趋势信号: ${trendSignal}`,
                        `日线 RSI(14): ${currentRSI ? currentRSI.toFixed(1) : 'N/A'} — ${rsiSignal}`,
                        `周线 RSI(14): ${weeklyRSI ? weeklyRSI.toFixed(1) : 'N/A'}${weeklyRSI < 30 ? ' — 周线超卖，历史底部信号' : weeklyRSI > 70 ? ' — 周线超买' : ''}`,
                    ]
                },
                this.buildOnchainSection(data),
                {
                    title: 'Killa 短周期提示',
                    content: [
                        `历史最佳上涨日: ${dayNames[bestDay.day]} (${(bestDay.rate * 100).toFixed(1)}% 概率)`,
                        `本周期规律仅供参考，需结合市场环境`,
                    ]
                },
                {
                    title: '观点与提示',
                    content: this.generateInsights(cycleInfo, trendSignal, weekChange, weeklyRSI)
                }
            ].filter(Boolean)
        };

        return report;
    },

    buildOnchainSection(data) {
        const mayer = DataModule.getMayerMultiple();
        const content = [];
        if (mayer != null) {
            content.push(`Mayer Multiple (价格/MA200): ${mayer.toFixed(2)}${mayer > 2.4 ? '（偏高，历史顶部风险区）' : mayer < 1 ? '（低于1，价格低于MA200，价值区）' : '（中性区间）'}`);
        }
        content.push('链上估值指标（MVRV/NUPL/已实现价格）见页面嵌入的 CheckOnChain 官方图表');
        return { title: '市场结构指标', content };
    },

    generateInsights(cycleInfo, trendSignal, weekChange, weeklyRSI) {
        const insights = [];

        // 基于日历年周期模型
        const phaseHint = {
            '1st-bull': '减半年（÷4=0），历史上牛市在此阶段启动，中长期倾向偏多，但注意年初常有反复',
            '2nd-bull': '减半次年（÷4=1），历史多为主升与见顶年，涨幅可观但需警惕周期顶部',
            'bear': '减半第三年（÷4=2），历史上为主要下跌/筑底年，倾向防守，逢深跌分批布局',
            'pre-bull': '减半第四年（÷4=3），历史多为筑底复苏年，为下一轮减半牛蓄势',
        };
        insights.push(phaseHint[cycleInfo.phaseKey] || cycleInfo.detail);

        // 价格趋势与周期是否一致
        if (cycleInfo.phaseKey === 'bear' && trendSignal.includes('多头')) {
            insights.push('注意：日历年模型指向回调年，但当前均线仍多头排列，说明本轮节奏可能偏离历史，需以价格趋势为准');
        } else if ((cycleInfo.phaseKey === '1st-bull' || cycleInfo.phaseKey === '2nd-bull') && trendSignal.includes('空头')) {
            insights.push('注意：日历年模型指向牛市年，但当前均线空头排列，存在背离，需控制仓位');
        }

        if (trendSignal.includes('多头')) insights.push('均线多头排列，回调可关注 MA50/MA200 支撑');
        else if (trendSignal.includes('空头')) insights.push('均线空头排列，反弹关注均线压力，等待趋势反转');

        if (weeklyRSI != null && weeklyRSI < 30) insights.push('周线 RSI 超卖，历史上常对应周期性底部区域，可关注背离信号');
        else if (weeklyRSI != null && weeklyRSI > 70) insights.push('周线 RSI 超买，中期过热，注意获利了结节奏');

        // Mayer Multiple 补充
        const mayer = DataModule.getMayerMultiple();
        if (mayer != null) {
            if (mayer > 2.4) insights.push('Mayer Multiple 偏高，价格远高于 MA200，历史上属过热区');
            else if (mayer < 1) insights.push('Mayer Multiple <1，价格低于 MA200，历史上属价值/底部区');
        }

        if (parseFloat(weekChange) > 10) insights.push('本周涨幅较大，短期注意获利回吐压力');
        else if (parseFloat(weekChange) < -10) insights.push('本周跌幅较大，可能存在超跌反弹机会');

        insights.push('注意: 以上分析基于历史周期模型与链上数据，不构成投资建议');
        return insights;
    },

    renderReportHTML(report) {
        let html = `<h2 class="text-lg font-bold text-accent-gold">${report.title}</h2>`;
        for (const section of report.sections) {
            html += `<h3>${section.title}</h3><ul class="list-disc list-inside space-y-1">`;
            for (const item of section.content) {
                html += `<li>${item}</li>`;
            }
            html += '</ul>';
        }
        return html;
    },

    getReportText(report) {
        let text = report.title + '\n' + '='.repeat(40) + '\n\n';
        for (const section of report.sections) {
            text += `【${section.title}】\n`;
            for (const item of section.content) {
                text += `  - ${item}\n`;
            }
            text += '\n';
        }
        text += '\n生成时间: ' + new Date().toLocaleString('zh-CN');
        return text;
    },

    async downloadPDF(report) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');

        doc.setFont('helvetica');
        doc.setFontSize(16);
        doc.text(report.title, 15, 20);

        let y = 35;
        doc.setFontSize(10);

        for (const section of report.sections) {
            if (y > 270) { doc.addPage(); y = 20; }
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text(section.title, 15, y);
            y += 7;
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            for (const item of section.content) {
                if (y > 280) { doc.addPage(); y = 20; }
                doc.text('  * ' + item, 15, y);
                y += 5;
            }
            y += 5;
        }

        doc.setFontSize(8);
        doc.text('Generated: ' + new Date().toISOString(), 15, 290);

        doc.save(`BTC_Weekly_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
    }
};
