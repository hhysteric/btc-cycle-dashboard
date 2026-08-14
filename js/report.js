const ReportModule = {
    // 供配置面板使用：返回全部可选指标的自动分析（含默认文案）
    getAllAnalysis() {
        return DataModule.getReportAnalysis();
    },

    // 生成周报数据：概览 + 选中指标的 {图, 位置分析, 后市展望}
    // config: {
    //   selectedKeys:[...], crops:{key:{...}}, edits:{key:{position,outlook}},
    //   uploads:{key:dataURL},          // 用户上传的图，覆盖该指标的自动图（无图指标传了即用）
    //   customSections:[{key,title,position,outlook,image}]  // 用户新增的自定义指标（图可选），追加在末尾
    // }
    generateReport(priceInfo, cycleInfo, weekdayStats, data, config = {}) {
        const now = new Date();
        const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

        const analysis = DataModule.getReportAnalysis();
        const selected = config.selectedKeys || analysis.map(a => a.key);
        const crops = config.crops || {};
        const edits = config.edits || {};
        const uploads = config.uploads || {};
        const customSections = config.customSections || [];

        const chosen = analysis.filter(a => selected.includes(a.key));
        const images = ChartsModule.reportImages(crops);

        const pattern = DataModule.getWeekdayPattern();

        // 内置指标段：单段文本 text（可被 edits[key].text 覆盖）；上传图优先，否则用自动图
        const builtinSections = chosen.map(a => ({
            ...a,
            text: (edits[a.key] && edits[a.key].text != null) ? edits[a.key].text : a.text,
            image: uploads[a.key] || images[a.key] || null,
            uploaded: !!uploads[a.key],
        }));

        // 自定义段：标题/观点/图都来自用户；图可选（上传图）
        const customs = customSections.map(c => ({
            key: c.key,
            title: c.title || '自定义指标',
            text: c.text || '',
            image: c.image || null,
            uploaded: !!c.image,
        }));

        return {
            title: `BTC 周期分析周报`,
            dateStr,
            overview: {
                price: priceInfo.price,
                change24h: priceInfo.change24h,
                marketCap: priceInfo.marketCap,
                cyclePhase: cycleInfo.phase,
                cyclePhaseColor: cycleInfo.phaseColor,
                cycleYear: cycleInfo.year,
                weekday: pattern.summary,
            },
            sections: [...builtinSections, ...customs],
        };
    },

    // 生成用于展示/导出的 HTML（离屏排版容器），返回 element
    buildReportElement(report) {
        const o = report.overview;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'width:1000px;background:#0d0d1a;color:#c9cdd4;padding:28px 32px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;';

        const changeColor = o.change24h >= 0 ? '#00d395' : '#ff4757';
        const changeSign = o.change24h >= 0 ? '+' : '';

        // === Header: 标题+价格一行 ===
        let html = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="font-size:22px;font-weight:800;color:#f7931a;letter-spacing:0.5px;">${report.title}</div>
                <div style="display:flex;align-items:baseline;gap:12px;">
                    <span style="font-size:22px;font-weight:700;color:#ffffff;">$${Math.round(o.price).toLocaleString()}</span>
                    <span style="font-size:13px;font-weight:600;color:${changeColor};">${changeSign}${o.change24h.toFixed(2)}%</span>
                    <span style="font-size:12px;color:#6b7280;">${report.dateStr}</span>
                </div>
            </div>
            <div style="height:1px;background:linear-gradient(90deg,#f7931a 0%,rgba(247,147,26,0.1) 100%);margin-bottom:12px;"></div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:22px;font-size:12px;color:#9ca3af;">
                <span style="background:#151528;border:1px solid rgba(247,147,26,0.25);border-radius:20px;padding:4px 12px;color:${o.cyclePhaseColor};font-weight:600;">${o.cyclePhase}（${o.cycleYear}年）</span>
                <span style="color:#374151;">│</span>
                <span>市值 <b style="color:#e5e7eb;">$${(o.marketCap / 1e9).toFixed(0)}B</b></span>
                <span style="color:#374151;">│</span>
                <span>${o.weekday}</span>
            </div>
        `;

        // === 指标段：图上文下 ===
        report.sections.forEach((s, i) => {
            // 每 4 段之间加分隔线，增加视觉节奏
            if (i > 0 && i % 4 === 0) {
                html += `<div style="height:1px;background:rgba(247,147,26,0.08);margin:6px 0 18px;"></div>`;
            }

            html += `<div style="background:#151528;border:1px solid rgba(247,147,26,0.12);border-radius:10px;padding:16px;margin-bottom:14px;">`;
            html += `<div style="font-size:15px;font-weight:700;color:#f7931a;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:6px;height:6px;background:#f7931a;border-radius:50%;"></span>${s.title}</div>`;

            if (s.image) {
                const imgWrapStyle = s.uploaded
                    ? 'background:#ffffff;border-radius:8px;padding:6px;box-sizing:border-box;margin-bottom:10px;'
                    : 'margin-bottom:10px;';
                const imgStyle = s.uploaded
                    ? 'width:100%;max-height:340px;object-fit:contain;border-radius:6px;display:block;'
                    : 'width:100%;border-radius:8px;display:block;';
                html += `<div style="${imgWrapStyle}"><img src="${s.image}" style="${imgStyle}"></div>`;
            }

            if (s.text) {
                html += `<div style="font-size:13px;line-height:1.75;color:#b0b5be;white-space:pre-wrap;">${s.text}</div>`;
            }
            html += `</div>`;
        });

        // === Footer ===
        html += `
            <div style="height:1px;background:rgba(247,147,26,0.15);margin-top:8px;margin-bottom:10px;"></div>
            <div style="text-align:center;font-size:11px;color:#6b7280;">
                生成于 ${new Date().toISOString().slice(0, 10)} · 不构成投资建议
            </div>
        `;

        wrap.innerHTML = html;
        return wrap;
    },

    // 在弹窗里预览
    renderReportHTML(report) {
        // 预览用轻量 HTML（图片会显示）
        const el = this.buildReportElement(report);
        el.style.width = '100%';
        el.style.padding = '0';
        el.style.background = 'transparent';
        return el.outerHTML;
    },

    getReportText(report) {
        let text = `${report.title} - ${report.dateStr}\n${'='.repeat(40)}\n\n`;
        const o = report.overview;
        text += `当前价格: $${Math.round(o.price).toLocaleString()} (${o.change24h >= 0 ? '+' : ''}${o.change24h.toFixed(2)}% 24h)\n`;
        text += `四年周期阶段: ${o.cyclePhase}（${o.cycleYear}年）\n`;
        text += `${o.weekday}\n\n`;
        for (const s of report.sections) {
            text += `【${s.title}】\n${s.text || ''}\n\n`;
        }
        text += `生成于 ${new Date().toLocaleString('zh-CN')}\n（不构成投资建议）`;
        return text;
    },

    // 导出为单张 PNG
    async downloadPNG(report) {
        const el = this.buildReportElement(report);
        // 离屏挂载
        el.style.position = 'fixed';
        el.style.left = '-99999px';
        el.style.top = '0';
        document.body.appendChild(el);

        // 等待内嵌图片加载完成
        const imgs = Array.from(el.querySelectorAll('img'));
        await Promise.all(imgs.map(img => img.complete ? Promise.resolve()
            : new Promise(res => { img.onload = img.onerror = res; })));

        const canvas = await html2canvas(el, { backgroundColor: '#0d0d1a', scale: 2, useCORS: true, logging: false });
        document.body.removeChild(el);

        const link = document.createElement('a');
        link.download = `BTC_周报_${new Date().toISOString().slice(0, 10)}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }
};
