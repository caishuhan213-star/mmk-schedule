/* Read scopes belong to a view, never to a whole-collection replacement. */
class ModuleDataLoader {
    static dated = ['schedules', 'attendanceFees', 'interviewFees', 'operatingCosts', 'reportRebates'];
    static charts = ['chart', 'heatmap', 'sourceChannel', 'employeePerformance', 'clientEmployeeCollaboration', 'employeeClient', 'customerStatus', 'employeeRanking'];
    static dateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    static nextDay(key) {
        const date = new Date(key + 'T00:00:00'); date.setDate(date.getDate() + 1);
        return this.dateKey(date);
    }
    static monthRange(month) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('请选择有效月份');
        const [year, number] = month.split('-').map(Number);
        return { start: month + '-01', end: this.dateKey(new Date(year, number, 1)) };
    }
    static monthsCovering(range) {
        if (!range) return null;
        if (!range.start || !range.end || range.start >= range.end) throw new Error('请选择完整且有效的日期范围');
        const last = new Date(range.end + 'T00:00:00'); last.setDate(last.getDate() - 1);
        return { start: range.start.slice(0, 7) + '-01', end: this.monthRange(this.dateKey(last).slice(0, 7)).end };
    }
    static union(ranges) {
        if (ranges.some(range => !range)) return null;
        return { start: ranges.map(r => r.start).sort()[0], end: ranges.map(r => r.end).sort().at(-1) };
    }
    static within(rows, collection, range) {
        if (!range) return rows;
        const field = collection === 'schedules' ? 'scheduleDate' : 'date';
        return rows.filter(row => row[field] >= range.start && row[field] < range.end);
    }
    static weekKey(date) {
        const thursday = new Date(date); thursday.setHours(0, 0, 0, 0);
        thursday.setDate(thursday.getDate() + 3 - ((thursday.getDay() + 6) % 7));
        const year = thursday.getFullYear();
        const week = 1 + Math.round((thursday - new Date(year, 0, 4) + ((new Date(year, 0, 4).getDay() + 6) % 7) * 86400000 - 3 * 86400000) / 604800000);
        return `${year}-W${String(week).padStart(2, '0')}`;
    }
    constructor(manager) {
        this.manager = manager;
        this.started = false;
        this.ready = false;
        this.generation = 0;
        this.key = '';
        this.actionDepth = 0;
        this.costMonth = ModuleDataLoader.dateKey(new Date()).slice(0, 7);
        this.installRenderGuards();
        manager.dbManager.onImportEnd = () => { manager._dataActionPending = false; this.refresh(true); };
    }
    value(id) { return document.getElementById(id)?.value || ''; }
    tab() { return document.querySelector('.tab-btn.active')?.dataset.tab || 'schedule'; }
    rangeFor(mode, value) {
        if (!value || mode === 'all') return null;
        if (mode === 'month') return ModuleDataLoader.monthRange(value);
        if (mode === 'day') return { start: value, end: ModuleDataLoader.nextDay(value) };
        const [year, week] = value.split('-W').map(Number);
        const start = this.manager.getWeekStartDate(year, week);
        const end = new Date(start); end.setDate(end.getDate() + 7);
        return { start: ModuleDataLoader.dateKey(start), end: ModuleDataLoader.dateKey(end) };
    }
    chartRange(prefix) {
        const value = this.value(prefix + 'DateRange') || '30';
        if (value === 'all') return null;
        if (value === 'custom') {
            const start = this.value(prefix + 'StartDate'), end = this.value(prefix + 'EndDate');
            if (!start || !end || start > end) throw new Error('请选择完整且有效的起止日期');
            return { start, end: ModuleDataLoader.nextDay(end) };
        }
        return this.recentRange(Number(value));
    }
    recentRange(days) {
        const now = new Date(), start = new Date(now);
        start.setDate(start.getDate() - (days || 30));
        return { start: ModuleDataLoader.dateKey(start), end: ModuleDataLoader.nextDay(ModuleDataLoader.dateKey(now)) };
    }
    plan() {
        const tab = this.tab(), m = this.manager;
        let range = null, collections = [];
        if (tab === 'schedule') {
            const mode = m.currentViewMode;
            range = this.rangeFor(mode, this.value({ day: 'filterDate', week: 'filterWeek', month: 'filterMonth' }[mode]));
            collections = [...ModuleDataLoader.dated, 'employees', 'projects'];
        } else if (tab === 'management' || tab === 'data-convert') {
            collections = ['employees'];
        } else if (tab === 'rebate') {
            const filter = m.reportRebateFilter;
            range = filter.mode === 'custom' ? { start: filter.startDate, end: ModuleDataLoader.nextDay(filter.endDate) } :
                this.rangeFor(filter.mode, filter[{ day: 'date', week: 'week', month: 'month' }[filter.mode]]);
            collections = ['reportRebates'];
        } else if (tab === 'operating-cost') {
            const value = this.value('operatingCostChartDateRange');
            range = value === 'selected' ? ModuleDataLoader.monthRange(this.costMonth) : value === 'all' ? null : this.recentRange(Number(value));
            collections = ['operatingCosts'];
        } else if (tab === 'charts') {
            range = ModuleDataLoader.union(ModuleDataLoader.charts.map(prefix => this.chartRange(prefix)));
            collections = [...ModuleDataLoader.dated];
        }
        const scopes = Object.fromEntries(collections.map(name => [name, ModuleDataLoader.dated.includes(name) ? ModuleDataLoader.monthsCovering(range) : null]));
        return { tab, storeId: m.currentStoreId, uid: m.dbManager._currentUser?.uid, range, scopes };
    }
    setup() {
        const month = this.costMonth;
        document.getElementById('clearFilter').textContent = '全部历史';
        this.manager.reportRebateFilter = { ...this.manager.reportRebateFilter, mode: 'month', month };
        document.getElementById('reportRebateFilterMode').value = 'month';
        document.getElementById('reportRebateFilterMonth').value = month;
        this.manager.updateReportRebateFilterInputs();
        const costSelect = document.getElementById('operatingCostChartDateRange');
        costSelect.insertAdjacentHTML('afterbegin', '<option value="selected">所选月份</option>');
        costSelect.value = 'selected';
        for (const tab of ['schedule', 'management', 'data-convert', 'rebate', 'charts', 'operating-cost', 'ai-analysis', 'store-center']) {
            const panel = document.getElementById(tab + '-tab');
            if (!panel) continue;
            const bar = document.createElement('div');
            bar.className = 'module-data-status'; bar.dataset.tab = tab;
            const status = document.createElement('span'); status.className = 'module-data-message'; status.setAttribute('role', 'status'); bar.append(status);
            if (tab === 'operating-cost' || tab === 'charts') {
                const label = document.createElement('label'); label.textContent = '月份 ';
                const input = document.createElement('input'); input.type = 'month'; input.value = month; input.setAttribute('aria-label', tab === 'charts' ? '图表月份' : '运营成本月份');
                input.addEventListener('change', () => {
                    if (!input.value) return;
                    if (tab === 'charts') this.setChartMonth(input.value);
                    else { this.costMonth = input.value; costSelect.value = 'selected'; }
                    this.refresh();
                }); label.append(input); bar.append(label);
                const all = document.createElement('button'); all.type = 'button'; all.className = 'btn btn-secondary'; all.textContent = '全部历史';
                all.addEventListener('click', () => {
                    if (tab === 'charts') {
                        for (const prefix of ModuleDataLoader.charts) document.getElementById(prefix + 'DateRange').value = 'all';
                        document.getElementById('globalChartDateRange').value = 'all';
                    } else costSelect.value = 'all';
                    this.refresh();
                }); bar.append(all);
            }
            const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn btn-secondary'; retry.textContent = '重新加载';
            retry.addEventListener('click', () => this.refresh(true)); bar.append(retry);
            panel.prepend(bar);
        }
        this.setChartMonth(month);
        document.addEventListener('change', event => {
            if (event.target.closest?.('.tab-content.active') && !event.target.closest('form')) this.scheduleRefresh();
        });
        // Capture blocks navigation/filters while a write or export is using a fixed scope.
        document.addEventListener('click', event => {
            if ((this.manager._recordSavePending || this.manager._dataActionPending) && event.target.closest?.('.tab-btn, .module-data-status, #clearFilter, #viewMode')) {
                event.preventDefault(); event.stopImmediatePropagation();
            }
        }, true);
        this.status('正在连接云端…', true);
    }
    setChartMonth(month) {
        const range = ModuleDataLoader.monthRange(month), last = new Date(range.end + 'T00:00:00'); last.setDate(last.getDate() - 1);
        for (const prefix of [...ModuleDataLoader.charts, 'globalChart']) {
            document.getElementById(prefix + 'DateRange').value = 'custom';
            document.getElementById(prefix + 'StartDate').value = range.start;
            document.getElementById(prefix + 'EndDate').value = ModuleDataLoader.dateKey(last);
        }
        document.querySelectorAll('[id$="CustomDateRangeContainer"], #customDateRangeContainer, #globalCustomDateRangeContainer').forEach(el => { el.style.display = 'inline-flex'; });
    }
    status(message, busy = false, error = false) {
        const panel = document.getElementById(this.tab() + '-tab');
        if (!panel) return;
        const bar = panel.querySelector('.module-data-status');
        if (bar) { bar.querySelector('.module-data-message').textContent = message; bar.dataset.state = error ? 'error' : busy ? 'loading' : 'ready'; }
        panel.classList.toggle('module-data-incomplete', busy || error);
        panel.setAttribute('aria-busy', String(busy));
    }
    scheduleRefresh() {
        if (this.queued || this.actionDepth) return;
        this.queued = true;
        queueMicrotask(() => { this.queued = false; this.refresh(); });
    }
    canRender(tabs) {
        if (!tabs.includes(this.tab())) return false;
        if (this.actionDepth) return true;
        let key;
        try { key = JSON.stringify(this.plan()); } catch (_) { this.scheduleRefresh(); return false; }
        if (this.ready && this.key === key) return true;
        this.scheduleRefresh(); return false;
    }
    installRenderGuards() {
        const groups = {
            schedule: ['renderTable', 'renderFilteredTable', 'updateStats', 'renderAttendanceFeeTable', 'renderInterviewFeeTable', 'renderEmployeeCommissionSummary', 'renderClientTop20'],
            rebate: ['renderReportRebateTable', 'updateRebateStats'],
            'operating-cost': ['renderOperatingCostTable', 'updateOperatingCostStats', 'updateOperatingCostCharts'],
            charts: ['updateIncomeChart', 'updateHeatmapChart', 'updateSourceChannelCharts', 'updateEmployeePerformanceChart', 'updateClientEmployeeCollaborationChart', 'updateEmployeeClientChart', 'updateCustomerStatusCharts', 'updateEmployeeRanking'],
            'store-center': ['renderStoresList', 'renderAllStoresSummary', 'renderStoreComparisonChart']
        };
        for (const [tab, names] of Object.entries(groups)) for (const name of names) {
            const original = this.manager[name];
            this.manager[name] = (...args) => this.canRender([tab]) ? original.apply(this.manager, args) : undefined;
        }
    }
    refresh(force = false) {
        if (!this.started || this.actionDepth || this.manager._recordSavePending || this.manager._dataActionPending) return;
        let plan;
        try { plan = this.plan(); } catch (error) { this.ready = false; this.status(error.message, false, true); return; }
        const key = JSON.stringify(plan);
        if (!force && this.key === key) return;
        const generation = ++this.generation;
        this.key = key; this.ready = false; this.current = plan; this.rows = {};
        clearTimeout(this.slowTimer);
        this.status('正在加载所选范围，统计将在数据齐全后显示…', true);
        this.slowTimer = setTimeout(() => {
            if (generation === this.generation && !this.ready) this.status('尚未收到云端数据，请检查网络或额度后点击重新加载。', false, true);
        }, 15000);
        const m = this.manager;
        const callbacks = {};
        const legacy = m._getSubscribeCallbacks();
        const names = Object.keys(plan.scopes);
        for (const name of names) callbacks[name] = (data, metadata = {}) => {
            if (generation !== this.generation || plan.storeId !== m.currentStoreId) return;
            if (name === 'employees') legacy.employees(data, metadata);
            if (metadata.fromCache || metadata.pending) return;
            this.rows[name] = data;
            if (names.every(n => Object.hasOwn(this.rows, n))) this.applyRows(plan, generation);
        };
        m.dbManager.subscribeToStore(plan.storeId, callbacks, { scopes: plan.scopes, onError: (error, collection) => {
            if (generation !== this.generation) return;
            delete this.rows[collection];
            this.ready = false; clearTimeout(this.slowTimer);
            const quota = String(error.code || '').includes('resource-exhausted');
            this.status(quota ? '云数据库额度受限，暂时无法加载；当前统计不完整，请额度恢复后重试。' : '数据加载失败，请检查网络后重新加载。', false, true);
        } });
        if (plan.tab === 'store-center') {
            const stores = m.loadStores();
            Promise.all(stores.map(async store => [store.id, await m.dbManager.readCollectionRange('schedules', store.id)]))
                .then(entries => {
                    if (generation !== this.generation) return;
                    m._storeSummaryRows = Object.fromEntries(entries); this.applyRows(plan, generation);
                }).catch(error => { if (generation === this.generation) { clearTimeout(this.slowTimer); this.status('店铺历史汇总加载失败，请重新加载。', false, true); } });
        } else if (!names.length) this.applyRows(plan, generation);
    }
    applyRows(plan, generation) {
        if (generation !== this.generation || this.actionDepth || this.manager.dbManager._importing) return;
        const m = this.manager;
        for (const [name, rows] of Object.entries(this.rows)) {
            if (name === 'employees') continue;
            // Schedule predicates are retained by existing renderers. Fee tables show the same selected period.
            m[name] = ModuleDataLoader.dated.includes(name) ? ModuleDataLoader.within(rows, name, plan.range) : rows;
        }
        this.ready = true; clearTimeout(this.slowTimer);
        const end = plan.range && new Date(plan.range.end + 'T00:00:00'); if (end) end.setDate(end.getDate() - 1);
        const label = plan.range ? `${plan.range.start} 至 ${ModuleDataLoader.dateKey(end)}` : '全部历史';
        this.status(plan.tab === 'management' || plan.tab === 'data-convert' ? '员工名单与价格表同步' : plan.tab === 'ai-analysis' ? '生成分析时加载所选时间范围的数据' : `统计范围：${label}`);
        if (plan.tab === 'schedule') { m.updateProjectSelectors(); m.renderTableWithCurrentFilter(); m.renderAttendanceFeeTable(); m.renderInterviewFeeTable(); m.updateStats(); }
        if (plan.tab === 'rebate') m.renderReportRebateTable();
        if (plan.tab === 'operating-cost') { m.renderOperatingCostTable(); m.updateOperatingCostStats(); m.updateOperatingCostCharts(); }
        if (plan.tab === 'charts') {
            m.updateEmployeeClientSelector();
            for (const name of ['updateIncomeChart', 'updateHeatmapChart', 'updateSourceChannelCharts', 'updateEmployeePerformanceChart', 'updateClientEmployeeCollaborationChart', 'updateEmployeeClientChart', 'updateCustomerStatusCharts', 'updateEmployeeRanking']) m[name]();
        }
        if (plan.tab === 'store-center') { m.renderStoresList(); m.renderAllStoresSummary(); m.renderStoreComparisonChart(); }
    }
    clipCurrentRows() {
        if (!this.current) return;
        for (const name of ModuleDataLoader.dated) {
            if (Object.hasOwn(this.current.scopes, name)) this.manager[name] = ModuleDataLoader.within(this.manager[name], name, this.current.range);
        }
    }
    // Fetch a complete, isolated input for exports/AI. Do not replace the visible month.
    async withData(collections, range, operation) {
        const m = this.manager, store = m.currentStoreId, uid = m.dbManager._currentUser?.uid;
        if (m._dataActionPending || m._recordSavePending) return;
        m._dataActionPending = true;
        this.status('正在准备完整数据，请稍候…', true);
        let succeeded = false;
        try {
            const rows = await Promise.all(collections.map(name => m.dbManager.readCollectionRange(name, store, range && ModuleDataLoader.dated.includes(name) ? range : null)));
            if (store !== m.currentStoreId || uid !== m.dbManager._currentUser?.uid) throw new Error('店铺或登录状态已变化，请重试');
            const context = Object.create(m);
            context._completeDataAction = true;
            collections.forEach((name, i) => { context[name] = rows[i]; });
            if (collections.includes('employees')) {
                context._employeeProfiles = context.employees;
                context.employees = EmployeeRoster.reconcile(m.jlPriceTable, context._employeeProfiles, m._employeeReferrers);
            }
            if (collections.includes('salaryTiers')) context.salaryTiers = context.salaryTiers[0]?.data || {};
            const result = await operation(context);
            succeeded = true;
            return result;
        } catch (error) {
            this.status('未完成：' + error.message + '；没有使用不完整的数据。', false, true);
            return false;
        } finally {
            m._dataActionPending = false;
            if (succeeded && this.ready) this.applyRows(this.current, this.generation);
        }
    }
    costExportRange() {
        const start = this.value('ocExportStartDate'), end = this.value('ocExportEndDate');
        return start && end ? { start, end: ModuleDataLoader.nextDay(end) } : null;
    }
    aiRange(id) {
        const range = this.manager._getAIDateRange(id);
        if (range === 'all') return null;
        const current = typeof range === 'object' ? { start: range.startDate, end: ModuleDataLoader.nextDay(range.endDate) } : this.recentRange(range);
        const start = new Date(current.start + 'T00:00:00'), end = new Date(current.end + 'T00:00:00');
        // Include the previous period used by AI comparisons.
        return { start: ModuleDataLoader.dateKey(new Date(start.getTime() - (end - start))), end: current.end };
    }
    async backupStores() {
        const m = this.manager, uid = m.dbManager._currentUser?.uid;
        if (m._dataActionPending || m._recordSavePending) return;
        m._dataActionPending = true; this.status('正在读取各店铺的完整备份数据…', true);
        try {
            const storesData = {};
            const names = [...ModuleDataLoader.dated, 'employees', 'projects', 'salaryTiers'];
            for (const store of m.loadStores()) {
                const rows = await Promise.all(names.map(name => m.dbManager.readCollectionRange(name, store.id)));
                storesData[store.id] = Object.fromEntries(names.map((name, i) => [name, rows[i]]));
                storesData[store.id].salaryTiers = storesData[store.id].salaryTiers[0]?.data || {};
                storesData[store.id].salaryPassword = localStorage.getItem(`store_${store.id}_salaryPassword`) || 'admin123';
            }
            if (uid !== m.dbManager._currentUser?.uid) throw new Error('登录状态已变化');
            const context = Object.create(m); context._backupStoresData = storesData;
            context.backupAllStoresData();
            if (this.ready) this.applyRows(this.current, this.generation);
        } catch (error) { this.status('完整备份未生成：' + error.message, false, true); }
        finally { m._dataActionPending = false; }
    }
    async prepareSave(collection, inputId) {
        const m = this.manager, date = this.value(inputId), store = m.currentStoreId;
        if (!date) return true; // Let the form provide its existing validation message.
        if (m._recordSavePending || m._dataActionPending) return false;
        m._dataActionPending = true;
        try {
            const rows = await m.dbManager.readCollectionRange(collection, store, { start: date, end: ModuleDataLoader.nextDay(date) });
            if (store !== m.currentStoreId || date !== this.value(inputId)) throw new Error('日期已变化，请重新保存');
            if (collection === 'schedules') m._conflictCheckSchedules = rows;
            if (collection === 'attendanceFees') m._validationAttendanceFees = rows;
            return true;
        } catch (error) { alert('暂时无法核对该日期的已有记录：' + error.message + '。本次输入已保留。'); return false; }
        finally { m._dataActionPending = false; }
    }
    async prepareImport(collections) {
        const m = this.manager, store = m.currentStoreId;
        if (m._dataActionPending || m._recordSavePending) return false;
        m._dataActionPending = true;
        try {
            const data = await Promise.all(collections.map(name => m.dbManager.readCollectionRange(name, store)));
            if (m.currentStoreId !== store) throw new Error('店铺已变化');
            collections.forEach((name, i) => { m[name] = data[i]; });
            if (collections.includes('employees')) { m._employeeProfiles = m.employees; m.employees = EmployeeRoster.reconcile(m.jlPriceTable, m._employeeProfiles, m._employeeReferrers); }
            if (collections.includes('salaryTiers')) m.salaryTiers = m.salaryTiers[0]?.data || {};
            m._dataActionPending = false;
            return true;
        } catch (error) { m._dataActionPending = false; alert('导入前无法取得完整数据，未修改云端：' + error.message); return false; }
    }
}
if (typeof module !== 'undefined') module.exports = ModuleDataLoader;
