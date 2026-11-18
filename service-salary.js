/* Monthly customer-service pay: only orders beyond 200 receive 15 yuan. */
(function (root) {
    'use strict';
    const bonus = root.ReferralBonus || (typeof require === 'function' && require('./referral-bonus.js'));
    const money = cents => (cents / 100).toFixed(2).replace(/\.00$/, '');
    const rules = Object.freeze({ threshold: 200, firstRateCents: 1000, extraRateCents: 1500 });
    const defaults = Object.freeze({ referrer: '点点', baseSalary: '3000', allowance: '500', rate: '15' });

    function amount(value, label) {
        const input = String(value ?? '').trim();
        const cents = Math.round(Number(input) * 100);
        if (!/^\d+(\.\d{1,2})?$/.test(input) || !Number.isSafeInteger(cents)) throw new Error(`${label}请输入有效的非负金额，最多保留两位小数`);
        return cents;
    }
    function prepare(values) {
        values = { ...defaults, ...values };
        if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(values.month)) throw new Error('请选择有效的工资月份');
        const start = values.month + '-01';
        const last = new Date(start + 'T00:00:00Z');
        last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
        const end = last.toISOString().slice(0, 10);
        bonus.validate({ referrer: values.referrer, rate: values.rate, start, end });
        return { ...values, start, end, baseCents: amount(values.baseSalary, '底薪'), allowanceCents: amount(values.allowance, '补贴') };
    }
    function calculate(values) {
        const input = prepare(values);
        const referral = bonus.calculate(input);
        const firstOrders = Math.min(referral.storeOrders, rules.threshold);
        const extraOrders = Math.max(referral.storeOrders - rules.threshold, 0);
        const firstCents = firstOrders * rules.firstRateCents, extraCents = extraOrders * rules.extraRateCents;
        const totalCents = input.baseCents + input.allowanceCents + firstCents + extraCents + referral.totalCents;
        if (!Number.isSafeInteger(totalCents)) throw new Error('工资合计金额过大，请检查输入');
        const formula = `底薪${money(input.baseCents)} + 补贴${money(input.allowanceCents)} + 前200单提成${firstOrders}×10 + 超出部分提成${extraOrders}×${money(rules.extraRateCents)} + 推荐人奖金${money(referral.totalCents)} = ${money(totalCents)}元`;
        return { baseCents: input.baseCents, allowanceCents: input.allowanceCents, storeOrders: referral.storeOrders,
            firstOrders, extraOrders, firstCents, extraCents, totalCents, referral,
            formula: formula + '\n推荐人奖金明细：' + referral.formula };
    }

    class Panel extends bonus.Panel {
        constructor(manager) {
            super(manager, 'serviceSalary');
            this.el('LiveRetry')?.addEventListener('click', () => this.manager.dataLoader.refresh(true));
            window.addEventListener('offline', () => this.liveState('offline'));
            window.addEventListener('online', () => this.liveState('loading'));
            document.addEventListener('visibilitychange', () => { if (!document.hidden) this.checkLiveMonth(); });
        }
        get subject() { return '工资'; }
        get instructions() { return '按当前店铺整月总单量分段计提成，再加上该客服的推荐人奖金。'; }
        currentMonth() { return ModuleDataLoader.dateKey(new Date()).slice(0, 7); }
        sync() { super.sync(); this.renderLive(); }
        invalidate(message) { super.invalidate(message); this.renderLive(); }
        setLiveActive(active) {
            if (this.liveActive === active) return;
            this.liveActive = active;
            clearTimeout(this.liveTimer);
            if (!active) { this.live = null; this.renderLive(); return; }
            const tick = () => {
                if (!this.liveActive) return;
                this.checkLiveMonth();
                this.liveTimer = setTimeout(tick, 60000); this.liveTimer.unref?.();
            };
            this.liveTimer = setTimeout(tick, 60000); this.liveTimer.unref?.();
        }
        checkLiveMonth() {
            // Only check the local calendar. No polling reads within a month.
            if (this.liveActive && this.live?.month !== this.currentMonth()) this.manager.dataLoader.refresh();
        }
        beginLive(plan) {
            this.live = { storeId: plan.storeId, uid: plan.uid, month: plan.salaryMonth, phase: 'loading', rows: null };
            this.renderLive();
        }
        receiveLive(rows, plan) {
            this.live = { storeId: plan.storeId, uid: plan.uid, month: plan.salaryMonth, phase: 'ready', rows, updatedAt: Date.now() };
            this.renderLive();
        }
        liveState(phase, error) {
            if (!this.liveActive || !this.live) return;
            // A terminal listener error needs an explicit reconnect; a browser
            // online event alone does not restore that Firestore listener.
            if (this.live.phase === 'error' && phase !== 'error') return;
            this.live.phase = phase; this.live.error = error;
            this.renderLive();
        }
        renderLive() {
            if (!this.form || !this.el('Live')) return;
            const live = this.live, m = this.manager, values = { ...this.values(), month: this.currentMonth() };
            this.el('LiveTitle').textContent = `${values.referrer || '客服'} · 本月工资预估`;
            this.el('LiveMonth').textContent = values.month;
            const validContext = this.liveActive && live && live.storeId === m.currentStoreId
                && live.uid === m.dbManager._currentUser?.uid && live.month === values.month;
            let phase = validContext ? live.phase : 'loading';
            let message = '正在同步本月排班…', result;
            if (validContext && Array.isArray(live.rows) && m._jlPriceReady) {
                try { result = this.compute(values, live.rows); }
                catch (error) { phase = 'invalid'; message = error.message; }
            }
            if (validContext && phase !== 'invalid') {
                if (!m._jlPriceReady) { phase = 'loading'; message = '员工推荐人名单尚未完成同步。'; }
                else if (phase === 'ready') message = `实时同步 · 更新于 ${new Date(live.updatedAt).toLocaleTimeString('zh-CN')}`;
                else if (phase === 'offline') message = '连接中断，等待联网同步。';
                else if (phase === 'pending') message = '修改正在等待云端确认。';
                else if (phase === 'error') message = String(live.error?.code || '').includes('resource-exhausted')
                    ? '云端额度受限，实时更新已暂停，请额度恢复后重试。' : '本月排班同步失败，请检查网络后重试。';
                if (result && phase !== 'ready') message += ' 以下为上次已确认的数据。';
            }
            this.el('Live').dataset.state = phase;
            this.el('LiveStatus').textContent = message;
            this.el('LiveRetry').hidden = phase !== 'error';
            const total = this.el('LiveTotal'), next = result ? `¥${money(result.totalCents)}` : '—';
            if (total.textContent !== next && result && phase === 'ready' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                total.animate?.([{ opacity: 0.5, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 280 });
            }
            total.textContent = next;
            this.el('LiveOrders').textContent = result ? `${result.storeOrders} 单` : '—';
            this.el('LiveReferralOrders').textContent = result ? `${result.referral.totalOrders} 单` : '—';
            this.el('LiveBreakdown').textContent = result
                ? `底薪 ${money(result.baseCents)} + 补贴 ${money(result.allowanceCents)} + 单量提成 ${money(result.firstCents + result.extraCents)} + 推荐奖金 ${money(result.referral.totalCents)}` : '';
            this.el('LiveRule').textContent = result
                ? `单量提成：${result.firstOrders}×10 + ${result.extraOrders}×${money(rules.extraRateCents)}；推荐奖金：${result.referral.totalOrders}×${money(result.referral.rateCents)}。`
                : `前200单10元/单，超出的部分${money(rules.extraRateCents)}元/单。`;
        }
        values() {
            return { referrer: this.el('Referrer').value, month: this.el('Month').value,
                baseSalary: this.el('Base').value, allowance: this.el('Allowance').value, rate: this.el('Rate').value };
        }
        setMonth(offset) {
            const now = new Date(), first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
            this.el('Month').value = ModuleDataLoader.dateKey(first).slice(0, 7);
            this.invalidate();
        }
        prepare(values) { return prepare(values); }
        compute(values, schedules) {
            return calculate({ ...values, rows: this.manager.jlLoadPriceTable(), referrers: this.manager._employeeReferrers, schedules });
        }
        render(result, values) {
            this.result = result;
            const currentMonth = ModuleDataLoader.dateKey(new Date()).slice(0, 7);
            const estimate = values.month >= currentMonth;
            this.el('Period').textContent = `${values.referrer} · ${values.month} · ${estimate ? '工资预估' : '月工资核算'}`;
            this.el('Total').textContent = `¥${money(result.totalCents)}`;
            this.el('Orders').textContent = `店铺总单量 ${result.storeOrders} 单 · 推荐员工单量 ${result.referral.totalOrders} 单`;
            const entries = [
                ['底薪', '按整月计算', result.baseCents],
                ['补贴', '按整月计算', result.allowanceCents],
                ['前200单提成', `${result.firstOrders} 单 × 10 元`, result.firstCents],
                ['超出200单的提成', `${result.extraOrders} 单 × ${money(rules.extraRateCents)} 元`, result.extraCents],
                ['推荐人奖金', `${result.referral.totalOrders} 单 × ${money(result.referral.rateCents)} 元`, result.referral.totalCents]
            ];
            this.el('Rows').replaceChildren(...entries.map(([label, rule, cents]) => {
                const tr = document.createElement('tr');
                for (const value of [label, rule, `¥${money(cents)}`]) {
                    const td = document.createElement('td'); td.textContent = value; tr.append(td);
                }
                return tr;
            }));
            this.el('Formula').textContent = result.formula;
            this.el('Notice').hidden = !result.referral.unmatchedCount;
            this.el('Notice').textContent = result.referral.unmatchedCount
                ? `另有 ${result.referral.unmatchedCount} 单未对应当前员工名单（${result.referral.unmatchedNames.join('、')}）：已计入店铺总单量，未计入推荐人奖金。` : '';
            this.el('Estimate').textContent = estimate
                ? '本月及未来月份为预估，按已录入排班计算；底薪和补贴按整月计入，尚未记入成本。'
                : '按所选月份已录入排班核算；底薪和补贴按整月计入，尚未记入成本。';
            this.el('Result').hidden = false;
        }
    }
    root.ServiceSalary = { prepare, calculate, rules, defaults, Panel };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.ServiceSalary;
})(typeof globalThis !== 'undefined' ? globalThis : window);
