/* Referral bonuses use confirmed, date-scoped schedules and the shared roster. */
(function (root) {
    'use strict';
    const roster = root.EmployeeRoster || (typeof require === 'function' && require('./employee-roster.js'));
    const text = value => String(value ?? '').trim();
    const money = cents => (cents / 100).toFixed(2).replace(/\.00$/, '');

    function validDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(value + 'T00:00:00Z');
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }

    function validate({ referrer, rate, start, end }) {
        if (!roster.normalizeReferrer(referrer)) throw new Error('请选择推荐人');
        if (!validDate(start) || !validDate(end) || start > end) throw new Error('请选择有效的起止日期，结束日期不能早于开始日期');
        const value = text(rate);
        if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('每单奖金请输入大于或等于 0 的金额，最多保留两位小数');
        const cents = Math.round(Number(value) * 100);
        if (!Number.isSafeInteger(cents)) throw new Error('每单奖金金额过大');
        return cents;
    }

    function people(rows, referrers = {}) {
        return roster.roster(rows).map(person => ({ ...person, referrer: Object.hasOwn(referrers, person.employeeId)
            ? roster.normalizeReferrer(referrers[person.employeeId]) : person.referrer }));
    }

    function calculate({ rows, referrers = {}, schedules, referrer, rate, start, end }) {
        const rateCents = validate({ referrer, rate, start, end });
        const selected = roster.normalizeReferrer(referrer), all = people(rows, referrers);
        const exact = new Map(all.map(person => [person.name, person]));
        const ids = new Map(all.map(person => [person.employeeId, person]));
        const aliases = new Map();
        for (const person of all) for (const alias of person.aliases) {
            if (!aliases.has(alias)) aliases.set(alias, []);
            aliases.get(alias).push(person);
        }
        const counts = new Map(all.filter(person => person.referrer === selected).map(person => [person.employeeId, { name: person.name, count: 0 }]));
        const seen = new Set(), unmatched = new Set();
        let unmatchedCount = 0, storeOrders = 0;
        for (const record of schedules) {
            if (record.scheduleDate < start || record.scheduleDate > end || !validDate(record.scheduleDate)) continue;
            const id = text(record.id);
            if (id && seen.has(id)) continue;
            if (id) seen.add(id);
            storeOrders++;
            const name = text(record.employeeName), identity = text(record.employeeId || record.rosterId);
            let person = identity ? ids.get(identity) : exact.get(name);
            if (!identity && !person) {
                const candidates = aliases.get(name) || [];
                if (candidates.length > 1) throw new Error(`“${name}”对应多个员工，请先核对员工姓名后再计算`);
                person = candidates[0];
            }
            if (!person) { unmatchedCount++; unmatched.add(name || '未填写姓名'); continue; }
            if (counts.has(person.employeeId)) counts.get(person.employeeId).count++;
        }
        const employees = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
        const totalOrders = employees.reduce((sum, person) => sum + person.count, 0);
        const totalCents = totalOrders * rateCents;
        if (!Number.isSafeInteger(totalCents)) throw new Error('奖金合计金额过大，请缩小计算范围');
        const active = employees.filter(person => person.count);
        const formula = `${active.map(person => person.name + person.count).join(' ')}${active.length ? ' ' : ''}（${active.map(person => person.count).join('+') || '0'}）×${money(rateCents)}=${money(totalCents)}元`;
        return { employees, totalOrders, totalCents, rateCents, formula, storeOrders, unmatchedCount, unmatchedNames: [...unmatched] };
    }

    class Panel {
        constructor(manager, prefix = 'referralBonus') {
            this.manager = manager;
            this.prefix = prefix;
            this.form = this.el('Form');
            this.generation = 0;
            if (!this.form) return;
            this.form.addEventListener('submit', event => { event.preventDefault(); this.run(); });
            this.form.addEventListener('input', () => this.invalidate());
            this.form.addEventListener('change', () => this.invalidate());
            this.el('ThisMonth').addEventListener('click', () => this.setMonth(0));
            this.el('LastMonth').addEventListener('click', () => this.setMonth(-1));
            this.el('Refresh').addEventListener('click', () => this.run(true));
            this.el('Copy').addEventListener('click', () => this.copy());
            window.addEventListener('mmk-auth-role-change', () => { this.signature = ''; this.sync(); });
            this.setMonth(0);
            this.sync();
        }
        el(suffix) { return document.getElementById(this.prefix + suffix); }
        get subject() { return '奖金'; }
        get instructions() { return '按员工当前推荐人归属统计，一条排班记录计一单。'; }
        prepare(values) { validate(values); return values; }
        compute(values, schedules) {
            return calculate({ ...values, rows: this.manager.jlLoadPriceTable(), referrers: this.manager._employeeReferrers, schedules });
        }
        values() {
            return { referrer: this.el('Referrer').value, rate: this.el('Rate').value, start: this.el('Start').value, end: this.el('End').value };
        }
        setMonth(offset) {
            const now = new Date(), first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
            const last = offset === 0 ? now : new Date(first.getFullYear(), first.getMonth() + 1, 0);
            this.el('Start').value = ModuleDataLoader.dateKey(first);
            this.el('End').value = ModuleDataLoader.dateKey(last);
            this.invalidate();
        }
        invalidate(message = this.instructions) {
            this.generation++;
            this.result = null;
            this.el('Result').hidden = true;
            this.el('Calculate').disabled = false;
            this.el('Refresh').disabled = false;
            this.el('Calculate').textContent = '计算' + this.subject;
            this.form.setAttribute('aria-busy', 'false');
            this.status(message);
        }
        status(message, error = false) {
            this.el('Status').textContent = message;
            this.el('Status').dataset.error = String(error);
        }
        sync() {
            if (!this.form) return;
            const m = this.manager, list = people(m.jlLoadPriceTable(), m._employeeReferrers);
            const signature = JSON.stringify([m.currentStoreId, m.dbManager._currentUser?.uid, m._jlPriceReady, list]);
            const name = m.currentStore?.name || m.loadStores().find(store => store.id === m.currentStoreId)?.name || '当前店铺';
            this.el('Store').textContent = name;
            if (this.signature === signature) return;
            this.signature = signature;
            const select = this.el('Referrer'), previous = select.value;
            select.replaceChildren(...roster.referrerOptions(m.jlLoadPriceTable(), m._employeeReferrers).map(name => {
                const option = document.createElement('option'); option.value = name; option.textContent = name; return option;
            }));
            if ([...select.options].some(option => option.value === previous)) select.value = previous;
            this.invalidate(m._jlPriceReady ? this.instructions : '正在连接员工名单，连接成功后即可计算。');
        }
        async run(force = false) {
            this.sync();
            const m = this.manager, values = this.values();
            this.invalidate();
            const generation = this.generation, store = m.currentStoreId, uid = m.dbManager._currentUser?.uid;
            let timer;
            try {
                const criteria = this.prepare(values);
                if (!uid || !store || !m._jlPriceReady || m._jlPriceWritePending) throw new Error('员工名单尚未完成云端同步，请稍后再计算');
                this.form.setAttribute('aria-busy', 'true');
                this.el('Calculate').disabled = this.el('Refresh').disabled = true;
                this.el('Calculate').textContent = '正在计算…';
                this.status('正在读取所选日期内的排班…');
                let readAt = Date.now();
                const schedules = await Promise.race([
                    m.dbManager.readCollectionRange('schedules', store, { start: criteria.start, end: ModuleDataLoader.nextDay(criteria.end) }, {
                        cacheMaxAgeMs: 60000, force, onCache: time => { readAt = time; }
                    }),
                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('排班读取超时，请检查网络后重试')), 20000); })
                ]);
                if (generation !== this.generation || store !== m.currentStoreId || uid !== m.dbManager._currentUser?.uid) return;
                if (!m._jlPriceReady || m._jlPriceWritePending) throw new Error('员工名单正在更新，请稍后重新计算');
                const result = this.compute(criteria, schedules);
                this.render(result, criteria);
                this.status(`已计算 · 排班数据更新于 ${new Date(readAt).toLocaleTimeString('zh-CN')}；需要最新数据可点击“刷新重算”。`);
            } catch (error) {
                if (generation !== this.generation || store !== m.currentStoreId || uid !== m.dbManager._currentUser?.uid) return;
                this.status(String(error.code || '').includes('resource-exhausted')
                    ? `云数据库额度受限，本次未能计算${this.subject}，请额度恢复后重试。`
                    : `未能计算：${error.message || '请检查网络后重试'}`, true);
            } finally {
                clearTimeout(timer);
                if (generation === this.generation) {
                    this.el('Calculate').disabled = this.el('Refresh').disabled = false;
                    this.el('Calculate').textContent = '计算' + this.subject;
                    this.form.setAttribute('aria-busy', 'false');
                }
            }
        }
        render(result, values) {
            this.result = result;
            this.el('Period').textContent = `${values.referrer} · ${values.start} 至 ${values.end}`;
            this.el('Total').textContent = `¥${money(result.totalCents)}`;
            this.el('Orders').textContent = `${result.totalOrders} 单 × ${money(result.rateCents)} 元/单`;
            this.el('People').textContent = `${result.employees.filter(person => person.count).length} 位员工有上钟记录`;
            this.el('Rows').replaceChildren(...result.employees.map(person => {
                const tr = document.createElement('tr');
                for (const value of [person.name, person.count, `¥${money(person.count * result.rateCents)}`]) {
                    const td = document.createElement('td'); td.textContent = value; tr.append(td);
                }
                return tr;
            }));
            this.el('Empty').hidden = result.employees.length > 0;
            this.el('Table').hidden = result.employees.length === 0;
            this.el('Formula').textContent = result.formula;
            this.el('Notice').hidden = !result.unmatchedCount;
            this.el('Notice').textContent = result.unmatchedCount ? `所选范围另有 ${result.unmatchedCount} 单未对应当前员工名单（${result.unmatchedNames.join('、')}），未计入奖金。` : '';
            this.el('Result').hidden = false;
        }
        async copy() {
            if (!this.result) return;
            const value = `${this.el('Store').textContent} · ${this.el('Period').textContent}\n${this.result.formula}`;
            try { await navigator.clipboard.writeText(value); this.status(this.subject + '明细已复制。'); }
            catch (_) { this.status('未能自动复制，可选中下方明细算式手动复制。', true); }
        }
    }
    root.ReferralBonus = { calculate, validate, Panel };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.ReferralBonus;
})(typeof globalThis !== 'undefined' ? globalThis : window);
