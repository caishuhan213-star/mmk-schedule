// DeepSeek AI 数据分析模块
// 封装 DeepSeek API 调用 + 经营数据摘要构建 + 分析 prompt

class AIAnalyst {
    constructor() {
        this.apiKey = localStorage.getItem('deepseek_api_key') || 'sk-763be806772748208e0b3c431d901fb6';
        this.model = 'deepseek-chat';
        this.endpoint = 'https://api.deepseek.com/chat/completions';
        this.chatHistory = []; // 对话历史（方案B）
        this._currentDataSummary = null;
    }

    // 保存 API Key
    saveApiKey(key) {
        this.apiKey = key.trim();
        localStorage.setItem('deepseek_api_key', this.apiKey);
    }

    // ============================================================
    // 核心 API 调用（支持流式输出）
    // onChunk(text) 每次收到新内容时调用
    // ============================================================
    async chat(messages, onChunk) {
        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                messages,
                stream: true,
                max_tokens: 2048,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`DeepSeek API 错误 ${response.status}: ${err}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;

                try {
                    const json = JSON.parse(data);
                    const delta = json.choices?.[0]?.delta?.content;
                    if (delta) {
                        fullText += delta;
                        if (onChunk) onChunk(delta, fullText);
                    }
                } catch (_) {
                    // 忽略解析错误的行
                }
            }
        }

        return fullText;
    }

    // ============================================================
    // 从 ScheduleManager 构建数据摘要（只发聚合统计，不发原始数据）
    // dateRange: 天数(number) | 'all' | { custom: true, startDate, endDate }
    // ============================================================
    buildDataSummary(manager, dateRange) {
        const schedules = manager.schedules || [];
        const operatingCosts = manager.operatingCosts || [];
        const attendanceFees = manager.attendanceFees || [];
        const interviewFees = manager.interviewFees || [];
        const reportRebates = manager.reportRebates || [];

        // 计算日期范围
        const today = new Date();
        let startDate = null;
        let endDate = today;

        if (dateRange === 'all') {
            startDate = null;
        } else if (typeof dateRange === 'number') {
            startDate = new Date(today);
            startDate.setDate(today.getDate() - dateRange + 1);
        } else if (dateRange && dateRange.custom) {
            startDate = new Date(dateRange.startDate);
            endDate = new Date(dateRange.endDate);
        }

        const toDateStr = (d) => d.toISOString().split('T')[0];
        const startStr = startDate ? toDateStr(startDate) : null;
        const endStr = toDateStr(endDate);

        // 过滤当期排班
        const filtered = schedules.filter(s => {
            if (!s.scheduleDate) return false;
            if (startStr && s.scheduleDate < startStr) return false;
            if (s.scheduleDate > endStr) return false;
            return true;
        });

        // 计算上期同比（相同时长的上一个周期）
        let prevFiltered = [];
        if (startStr) {
            const periodDays = Math.round((endDate - startDate) / 86400000) + 1;
            const prevEnd = new Date(startDate);
            prevEnd.setDate(prevEnd.getDate() - 1);
            const prevStart = new Date(prevEnd);
            prevStart.setDate(prevEnd.getDate() - periodDays + 1);
            const prevStartStr = toDateStr(prevStart);
            const prevEndStr = toDateStr(prevEnd);
            prevFiltered = schedules.filter(s =>
                s.scheduleDate >= prevStartStr && s.scheduleDate <= prevEndStr
            );
        }

        const sumRevenue = (list) => list.reduce((t, s) => t + (parseFloat(s.payment) || 0), 0);
        const sumCommission = (list) => list.reduce((t, s) => t + (parseFloat(s.commission) || 0), 0);

        const totalRevenue = sumRevenue(filtered);
        const totalCommission = sumCommission(filtered);

        // 运营成本（当期）
        const filteredCosts = operatingCosts.filter(c => {
            if (!c.date) return false;
            if (startStr && c.date < startStr) return false;
            if (c.date > endStr) return false;
            return true;
        });
        const totalCosts = filteredCosts.reduce((t, c) => t + (parseFloat(c.amount) || 0), 0);
        const costByCategory = {};
        filteredCosts.forEach(c => {
            const cat = c.category || '其他';
            costByCategory[cat] = (costByCategory[cat] || 0) + (parseFloat(c.amount) || 0);
        });

        // 坐班费 + 面试费（当期）
        const filteredAttendance = attendanceFees.filter(f => {
            if (!f.date) return false;
            if (startStr && f.date < startStr) return false;
            if (f.date > endStr) return false;
            return true;
        });
        const totalAttendanceFee = filteredAttendance.reduce((t, f) => t + (parseFloat(f.fee) || 0), 0);

        const filteredInterview = interviewFees.filter(f => {
            if (!f.date) return false;
            if (startStr && f.date < startStr) return false;
            if (f.date > endStr) return false;
            return true;
        });
        const totalInterviewFee = filteredInterview.reduce((t, f) => t + (parseFloat(f.fee) || 0), 0);

        // 报告返现
        const filteredRebates = reportRebates.filter(r => {
            if (!r.date) return false;
            if (startStr && r.date < startStr) return false;
            if (r.date > endStr) return false;
            return true;
        });
        const totalRebates = filteredRebates.reduce((t, r) => t + (parseFloat(r.amount) || 0), 0);

        const netProfit = totalRevenue - totalCommission - totalCosts - totalAttendanceFee - totalInterviewFee - totalRebates;
        const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0';

        // 上期对比
        const prevRevenue = sumRevenue(prevFiltered);
        const prevOrders = prevFiltered.length;
        const revenueChange = prevRevenue > 0
            ? ((totalRevenue - prevRevenue) / prevRevenue * 100).toFixed(1)
            : null;
        const ordersChange = prevOrders > 0
            ? ((filtered.length - prevOrders) / prevOrders * 100).toFixed(1)
            : null;

        // 员工 TOP10
        const employeeMap = {};
        filtered.forEach(s => {
            const name = s.employeeName || '未知';
            if (!employeeMap[name]) employeeMap[name] = { name, revenue: 0, commission: 0, orders: 0 };
            employeeMap[name].revenue += parseFloat(s.payment) || 0;
            employeeMap[name].commission += parseFloat(s.commission) || 0;
            employeeMap[name].orders++;
        });
        const topEmployees = Object.values(employeeMap)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10)
            .map(e => ({
                name: e.name,
                revenue: Math.round(e.revenue),
                commission: Math.round(e.commission),
                orders: e.orders,
                avgPerOrder: e.orders > 0 ? Math.round(e.revenue / e.orders) : 0,
            }));

        // 客户 TOP10
        const clientMap = {};
        filtered.forEach(s => {
            const name = s.clientName || '未知';
            if (!clientMap[name]) clientMap[name] = { name, visits: 0, totalSpent: 0 };
            clientMap[name].visits++;
            clientMap[name].totalSpent += parseFloat(s.payment) || 0;
        });
        const topClients = Object.values(clientMap)
            .sort((a, b) => b.totalSpent - a.totalSpent)
            .slice(0, 10)
            .map(c => ({ name: c.name, visits: c.visits, totalSpent: Math.round(c.totalSpent) }));

        // 来源渠道
        const channelMap = {};
        filtered.forEach(s => {
            const ch = s.clientSource || '未知';
            if (!channelMap[ch]) channelMap[ch] = { name: ch, orders: 0, revenue: 0 };
            channelMap[ch].orders++;
            channelMap[ch].revenue += parseFloat(s.payment) || 0;
        });
        const channels = Object.values(channelMap)
            .sort((a, b) => b.revenue - a.revenue)
            .map(c => ({
                name: c.name,
                orders: c.orders,
                revenue: Math.round(c.revenue),
                share: totalRevenue > 0 ? (c.revenue / totalRevenue * 100).toFixed(1) + '%' : '0%',
            }));

        // 每日收入趋势（最多 60 天）
        const dailyMap = {};
        filtered.forEach(s => {
            if (!s.scheduleDate) return;
            dailyMap[s.scheduleDate] = (dailyMap[s.scheduleDate] || 0) + (parseFloat(s.payment) || 0);
        });
        const dailyTrend = Object.entries(dailyMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-60)
            .map(([date, revenue]) => ({ date: date.slice(5), revenue: Math.round(revenue) }));

        // 按月汇总趋势
        const monthlyMap = {};
        filtered.forEach(s => {
            if (!s.scheduleDate) return;
            const month = s.scheduleDate.slice(0, 7); // "YYYY-MM"
            if (!monthlyMap[month]) monthlyMap[month] = { revenue: 0, orders: 0, commission: 0 };
            monthlyMap[month].revenue += parseFloat(s.payment) || 0;
            monthlyMap[month].orders++;
            monthlyMap[month].commission += parseFloat(s.commission) || 0;
        });
        const monthlyTrend = Object.entries(monthlyMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, d]) => ({
                month,
                revenue: Math.round(d.revenue),
                orders: d.orders,
                commission: Math.round(d.commission),
                avgOrderValue: d.orders > 0 ? Math.round(d.revenue / d.orders) : 0,
            }));

        // 按月员工绩效（每位员工每月数据，用于趋势分析）
        const empMonthMap = {};
        filtered.forEach(s => {
            if (!s.scheduleDate || !s.employeeName) return;
            const month = s.scheduleDate.slice(0, 7);
            const name = s.employeeName;
            const key = `${name}|${month}`;
            if (!empMonthMap[key]) empMonthMap[key] = { name, month, revenue: 0, orders: 0 };
            empMonthMap[key].revenue += parseFloat(s.payment) || 0;
            empMonthMap[key].orders++;
        });
        // 只保留 TOP10 员工的月度数据，避免数据量过大
        const top10Names = new Set(topEmployees.map(e => e.name));
        const employeeMonthlyStats = Object.values(empMonthMap)
            .filter(e => top10Names.has(e.name))
            .sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name))
            .map(e => ({ name: e.name, month: e.month, revenue: Math.round(e.revenue), orders: e.orders }));

        // 项目分布
        const projectMap = {};
        filtered.forEach(s => {
            const p = s.projectName || '未知';
            if (!projectMap[p]) projectMap[p] = { name: p, orders: 0, revenue: 0 };
            projectMap[p].orders++;
            projectMap[p].revenue += parseFloat(s.payment) || 0;
        });
        const topProjects = Object.values(projectMap)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 8)
            .map(p => ({ name: p.name, orders: p.orders, revenue: Math.round(p.revenue) }));

        // 时段分布（高峰时段）
        const hourMap = {};
        filtered.forEach(s => {
            if (!s.startTime) return;
            const hour = parseInt(s.startTime.split(':')[0]);
            if (!isNaN(hour)) hourMap[hour] = (hourMap[hour] || 0) + 1;
        });
        const peakHours = Object.entries(hourMap)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([h, cnt]) => `${h}:00(${cnt}单)`);

        // 计算有效工作天数
        const uniqueDates = new Set(filtered.map(s => s.scheduleDate).filter(Boolean));
        const activeDays = uniqueDates.size;

        const periodLabel = startStr
            ? `${startStr} ~ ${endStr}`
            : `全部时间（截至 ${endStr}）`;

        return {
            period: periodLabel,
            activeDays,
            overview: {
                totalRevenue: Math.round(totalRevenue),
                totalOrders: filtered.length,
                totalCommission: Math.round(totalCommission),
                totalCosts: Math.round(totalCosts),
                totalAttendanceFee: Math.round(totalAttendanceFee),
                totalInterviewFee: Math.round(totalInterviewFee),
                totalRebates: Math.round(totalRebates),
                netProfit: Math.round(netProfit),
                profitMargin: profitMargin + '%',
                avgDailyRevenue: activeDays > 0 ? Math.round(totalRevenue / activeDays) : 0,
                avgOrderValue: filtered.length > 0 ? Math.round(totalRevenue / filtered.length) : 0,
            },
            vsLastPeriod: {
                revenueChange: revenueChange !== null ? (revenueChange > 0 ? '+' : '') + revenueChange + '%' : '无对比数据',
                ordersChange: ordersChange !== null ? (ordersChange > 0 ? '+' : '') + ordersChange + '%' : '无对比数据',
                prevRevenue: Math.round(prevRevenue),
                prevOrders,
            },
            topEmployees,
            topClients,
            channels,
            topProjects,
            peakHours,
            costSummary: {
                total: Math.round(totalCosts),
                categories: Object.fromEntries(
                    Object.entries(costByCategory).map(([k, v]) => [k, Math.round(v)])
                ),
            },
            dailyTrend,
            monthlyTrend,
            employeeMonthlyStats,
        };
    }

    // ============================================================
    // 分析报告的 system prompt
    // ============================================================
    buildReportSystemPrompt() {
        return `你是一位专业的服务型企业经营顾问，精通员工排班管理、绩效分析和客户运营。
用户经营一家服务型店铺，使用排班系统管理员工工作安排和客户预约，主要收入来源是员工为客户提供服务（按单收费），员工获得提成。

请基于我提供的经营数据摘要，生成一份专业的经营分析报告，按以下结构输出（使用 Markdown 格式）：

## 📈 经营概况
简述本期整体经营状况，收入规模、利润水平，用具体数字说话。

## 🏆 员工绩效分析
- 明星员工（高收入高订单）的特点
- 需要关注的员工（低绩效），分析可能原因
- 团队整体效率评估

## 👥 客户价值分析
- 高价值客户识别
- 新客 vs 复购情况判断
- 流失风险客户提示（高频客户如果本期出现则不提，否则可能流失）

## 📡 获客渠道分析
- 各渠道的订单占比和收入贡献
- 增长渠道 vs 萎缩渠道判断
- 渠道资源分配建议

## 💰 成本与利润分析
- 当前利润率是否健康（同类业务参考 30%~50%）
- 运营成本结构是否合理
- 员工提成占收入比例分析

## 🎯 本期重点建议
列出 **3条** 最重要、最可执行的建议（要具体，不要泛泛而谈）

请用简洁专业的中文，所有数字必须从数据中来，不要编造。`;
    }

    // ============================================================
    // 对话助手的 system prompt（携带数据摘要）
    // ============================================================
    buildChatSystemPrompt(summary) {
        return `你是一位专业的经营数据分析助手，帮助服务型店铺老板分析经营数据、发现问题、给出建议。

以下是当前店铺的经营数据摘要（${summary.period}）：
${JSON.stringify(summary, null, 2)}

数据字段说明：
- monthlyTrend：按月汇总的营业趋势（每月收入、订单数、佣金、平均客单价）
- employeeMonthlyStats：TOP10员工的每月绩效（每位员工每月的收入和订单数），可用于分析员工在不同月份的表现变化
- dailyTrend：近期每日总营收趋势
- topEmployees：员工排名（累计总数据）
- topClients：客户排名
- channels：获客渠道分析

请根据这些真实数据回答用户的问题：
- 回答要简洁、具体，引用数据中的具体数字
- 使用中文回答
- 可以适当使用 Markdown 格式（加粗、列表等）增强可读性
- 当用户问到某员工在哪个月表现最好/最差时，请查阅 employeeMonthlyStats 按月数据进行分析
- 当用户问到月度趋势、环比变化时，请查阅 monthlyTrend 数据
- 如果用户问的内容在数据中找不到答案，诚实说明，不要编造数据`;
    }

    // ============================================================
    // 方案A：生成分析报告（流式）
    // onChunk(delta, fullText) 实时回调
    // ============================================================
    async generateReport(manager, dateRange, onChunk) {
        const summary = this.buildDataSummary(manager, dateRange);
        this._currentDataSummary = summary;

        const messages = [
            { role: 'system', content: this.buildReportSystemPrompt() },
            {
                role: 'user',
                content: `请分析以下经营数据，生成完整的经营分析报告：\n\n${JSON.stringify(summary, null, 2)}`,
            },
        ];

        return this.chat(messages, onChunk);
    }

    // ============================================================
    // 方案B：初始化对话（清空历史，注入数据上下文）
    // ============================================================
    initChat(manager, dateRange) {
        const summary = this.buildDataSummary(manager, dateRange);
        this._currentDataSummary = summary;
        this.chatHistory = [
            { role: 'system', content: this.buildChatSystemPrompt(summary) },
        ];
    }

    // ============================================================
    // 方案B：发送对话消息（流式）
    // ============================================================
    async sendMessage(userMessage, onChunk) {
        if (this.chatHistory.length === 0) {
            throw new Error('请先初始化对话（调用 initChat）');
        }

        this.chatHistory.push({ role: 'user', content: userMessage });

        // 超过 20 轮时，保留 system + 最近 18 条
        if (this.chatHistory.length > 21) {
            this.chatHistory = [
                this.chatHistory[0],
                ...this.chatHistory.slice(-18),
            ];
        }

        const fullText = await this.chat(this.chatHistory, onChunk);
        this.chatHistory.push({ role: 'assistant', content: fullText });
        return fullText;
    }

    // 清空对话历史
    clearChat() {
        this.chatHistory = [];
        this._currentDataSummary = null;
    }
}

// 全局单例
const aiAnalyst = new AIAnalyst();
