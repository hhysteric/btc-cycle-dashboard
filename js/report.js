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

        // 内置指标段：上传图优先，否则用自动图（可能为 null）。uploaded 标记用于排版（上传图可能含白底）
        const builtinSections = chosen.map(a => ({
            ...a,
            position: (edits[a.key] && edits[a.key].position != null) ? edits[a.key].position : a.position,
            outlook: (edits[a.key] && edits[a.key].outlook != null) ? edits[a.key].outlook : a.outlook,
            image: uploads[a.key] || images[a.key] || null,
            uploaded: !!uploads[a.key],
        }));

        // 自定义段：标题/观点/图都来自用户；图可选（上传图）
        const customs = customSections.map(c => ({
            key: c.key,
            title: c.title || '自定义指标',
            position: c.position || '',
            outlook: c.outlook || '',
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
        wrap.style.cssText = 'width:1000px;background:#0f0f23;color:#e5e7eb;padding:32px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;';

        const changeColor = o.change24h >= 0 ? '#00d395' : '#ff4757';
        let html = `
            <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #f7931a;padding-bottom:14px;margin-bottom:20px;">
                <div>
                    <div style="font-size:26px;font-weight:800;color:#f7931a;">${report.title}</div>
                    <div style="font-size:13px;color:#9ca3af;margin-top:4px;">${report.dateStr}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:22px;font-weight:700;">$${Math.round(o.price).toLocaleString()}</div>
                    <div style="font-size:13px;color:${changeColor};">${o.change24h >= 0 ? '+' : ''}${o.change24h.toFixed(2)}% (24h)</div>
                </div>
            </div>
            <div style="display:flex;gap:16px;margin-bottom:22px;font-size:13px;flex-wrap:wrap;">
                <div style="background:#1a1a2e;border:1px solid #374151;border-radius:10px;padding:10px 14px;">
                    <span style="color:#9ca3af;">四年周期阶段</span><br>
                    <span style="font-size:16px;font-weight:700;color:${o.cyclePhaseColor};">${o.cyclePhase}（${o.cycleYear}年）</span>
                </div>
                <div style="background:#1a1a2e;border:1px solid #374151;border-radius:10px;padding:10px 14px;">
                    <span style="color:#9ca3af;">市值</span><br>
                    <span style="font-size:16px;font-weight:700;">$${(o.marketCap / 1e9).toFixed(0)}B</span>
                </div>
                <div style="background:#1a1a2e;border:1px solid #374151;border-radius:10px;padding:10px 14px;flex:1;min-width:280px;">
                    <span style="color:#9ca3af;">短周期规律</span><br>
                    <span style="font-size:13px;">${o.weekday}</span>
                </div>
            </div>
        `;

        for (const s of report.sections) {
            // 图左观点右：有图时两列布局（图 58% / 观点 42%）；无图（如 Cointime）时观点占满
            const opinionHtml = `
                <div style="margin-bottom:10px;">
                    <span style="display:inline-block;background:#252547;color:#93c5fd;font-size:12px;padding:2px 8px;border-radius:4px;margin-bottom:4px;">当前位置</span>
                    <div style="font-size:14px;line-height:1.6;color:#d1d5db;white-space:pre-wrap;">${s.position}</div>
                </div>
                <div>
                    <span style="display:inline-block;background:#252547;color:#fbbf24;font-size:12px;padding:2px 8px;border-radius:4px;margin-bottom:4px;">后市展望</span>
                    <div style="font-size:14px;line-height:1.6;color:#d1d5db;white-space:pre-wrap;">${s.outlook}</div>
                </div>`;

            html += `<div style="background:#1a1a2e;border:1px solid #374151;border-radius:12px;padding:18px;margin-bottom:18px;">
                <div style="font-size:17px;font-weight:700;color:#f7931a;margin-bottom:12px;">${s.title}</div>`;
            if (s.image) {
                // 上传图可能含白底/透明：放到白色卡片里加内边距，保证白图也可见；
                // object-fit:contain + max-height 保持原始比例、避免被拉伸或过大。
                // 自动生成的图表本身是深色成品，直接铺满即可。
                const imgWrapStyle = s.uploaded
                    ? 'background:#ffffff;border-radius:8px;padding:8px;box-sizing:border-box;'
                    : '';
                const imgStyle = s.uploaded
                    ? 'width:100%;max-height:360px;object-fit:contain;border-radius:4px;display:block;'
                    : 'width:100%;border-radius:8px;display:block;';
                html += `<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;">
                    <div style="flex:1 1 58%;min-width:340px;"><div style="${imgWrapStyle}"><img src="${s.image}" style="${imgStyle}"></div></div>
                    <div style="flex:1 1 38%;min-width:220px;">${opinionHtml}</div>
                </div>`;
            } else {
                html += opinionHtml;
            }
            html += `</div>`;
        }

        html += `<div style="font-size:11px;color:#6b7280;text-align:center;margin-top:8px;">
            本周报基于历史周期模型与本地行情数据自动生成，价格/日期为区间推演，不构成投资建议 · 生成于 ${new Date().toLocaleString('zh-CN')}
        </div>`;

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
            text += `【${s.title}】\n`;
            text += `- 当前位置: ${s.position}\n`;
            text += `- 后市展望: ${s.outlook}\n\n`;
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

        const canvas = await html2canvas(el, { backgroundColor: '#0f0f23', scale: 2, useCORS: true, logging: false });
        document.body.removeChild(el);

        const link = document.createElement('a');
        link.download = `BTC_周报_${new Date().toISOString().slice(0, 10)}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }
};
