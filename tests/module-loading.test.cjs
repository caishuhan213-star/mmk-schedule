const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Loader = require('../module-data-loader.js');
const copy = value => structuredClone(value);
const snap = (items, metadata = {}) => ({ metadata: { fromCache: false, hasPendingWrites: false, ...metadata }, forEach: fn => items.forEach(item => fn({ id: String(item.id), data: () => copy(item) })) });
function harness() {
    const listeners = [], reads = [], writes = [], data = new Map();
    let auth;
    const query = (p, predicates = []) => ({
        where: (field, op, value) => query(p, [...predicates, [field, op, value]]),
        doc: id => ({ path: p + '/' + id }),
        get: async options => { reads.push({ path: p, predicates, options }); if (h.fail) throw h.fail; return snap(select(p, predicates)); },
        onSnapshot: (options, next, error) => {
            const listener = { path: p, predicates, next, error, closed: false }; listeners.push(listener);
            return () => { listener.closed = true; };
        }
    });
    const select = (p, predicates) => (data.get(p) || []).filter(row => predicates.every(([field, op, value]) => op === '>=' ? row[field] >= value : row[field] < value));
    const db = { collection: query, batch: () => ({ set: (ref, value) => writes.push(['set', ref.path, value]), delete: ref => writes.push(['delete', ref.path]), commit: async () => {} }) };
    const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, structuredClone,
        firebase: { apps: [{}], firestore: () => db, auth: () => ({ onAuthStateChanged: fn => { auth = fn; } }) } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../firebase-data-manager.js'), 'utf8') + '\nglobalThis.Manager = FirebaseDataManager;', context);
    const manager = new context.Manager(); auth({ uid: 'user-a' });
    const h = { manager, listeners, reads, writes, data, auth,
        seed: (store, collection, rows) => data.set(`team/shared/stores/${store}/${collection}`, rows),
        emit: (index, metadata) => { const l = listeners[index]; l.next(snap(select(l.path, l.predicates), metadata)); }
    };
    return h;
}
const november = { start: '2026-11-01', end: '2026-12-01' };

test('calendar month bounds cover leap February, December, and an exclusive end', () => {
    assert.deepEqual(Loader.monthRange('2024-02'), { start: '2024-02-01', end: '2024-03-01' });
    assert.deepEqual(Loader.monthRange('2026-12'), { start: '2026-12-01', end: '2027-01-01' });
    assert.deepEqual(Loader.monthsCovering({ start: '2026-12-28', end: '2027-01-04' }), { start: '2026-12-01', end: '2027-02-01' });
    assert.deepEqual(Loader.monthsCovering(november), november);
    assert.throws(() => Loader.monthRange('2026-13'));
    assert.equal(Loader.weekKey(new Date(2021, 0, 1)), '2020-W53');
});

test('month listeners exclude both earlier history and the first day of the next month', () => {
    const h = harness(); let rows;
    h.seed('a', 'schedules', [{ id: 'old', scheduleDate: '2026-10-31' }, { id: 'first', scheduleDate: '2026-11-01' }, { id: 'last', scheduleDate: '2026-11-30' }, { id: 'next', scheduleDate: '2026-12-01' }]);
    h.manager.subscribeToStore('a', { schedules: value => rows = value }, { scopes: { schedules: november } }); h.emit(0);
    assert.deepEqual(Array.from(rows, row => row.id), ['first', 'last']);
    assert.deepEqual(h.listeners[0].predicates, [['scheduleDate', '>=', november.start], ['scheduleDate', '<', november.end]]);
    assert.equal(h.manager._getCollectionState('a', 'schedules').ready, false);
    h.manager.unsubscribeAll();
});

test('switching to employees closes dated listeners and performs no history read', () => {
    const h = harness();
    h.manager.subscribeToStore('a', { schedules() {}, operatingCosts() {} }, { scopes: { schedules: november, operatingCosts: november } });
    h.manager.subscribeToStore('a', { employees() {} }, { scopes: { employees: null } });
    assert.ok(h.listeners.slice(0, 2).every(l => l.closed));
    assert.equal(h.listeners.filter(l => !l.closed).length, 1);
    assert.ok(h.listeners.at(-1).path.endsWith('/employees')); assert.equal(h.reads.length, 0);
    h.manager.unsubscribeAll();
});

test('same-month filter changes reuse a query; month changes retire it and ignore late results', () => {
    const h = harness(); let delivered = 0;
    const callbacks = { schedules: () => delivered++ };
    h.manager.subscribeToStore('a', callbacks, { scopes: { schedules: november } }); h.emit(0);
    h.manager.subscribeToStore('a', callbacks, { scopes: { schedules: november } });
    assert.equal(h.listeners.length, 1);
    h.manager.subscribeToStore('a', callbacks, { scopes: { schedules: Loader.monthRange('2026-10') } });
    assert.equal(h.listeners.length, 2); assert.ok(h.listeners[0].closed);
    const before = delivered; h.emit(0); assert.equal(delivered, before);
    h.emit(1); assert.equal(delivered, before + 1); h.manager.unsubscribeAll();
});

test('all-history scope includes records without dates and restores full coverage', () => {
    const h = harness(); let rows;
    h.seed('a', 'schedules', [{ id: 'old', scheduleDate: '2019-02-02' }, { id: 'legacy' }]);
    h.manager.subscribeToStore('a', { schedules: value => rows = value }, { scopes: { schedules: november } }); h.emit(0);
    assert.equal(rows.length, 0);
    h.manager.subscribeToStore('a', { schedules: value => rows = value }, { scopes: { schedules: null } }); h.emit(1);
    assert.equal(rows.length, 2); assert.equal(h.manager._getCollectionState('a', 'schedules').ready, true);
    h.manager.unsubscribeAll();
});

test('a monthly cache cannot satisfy a full export; a covered day can reuse it', async () => {
    const h = harness();
    h.seed('a', 'schedules', [{ id: 'old', scheduleDate: '2020-01-01' }, { id: 'now', scheduleDate: '2026-11-17' }]);
    h.manager.subscribeToStore('a', { schedules() {} }, { scopes: { schedules: november } }); h.emit(0);
    const day = await h.manager.readCollectionRange('schedules', 'a', { start: '2026-11-17', end: '2026-11-18' });
    assert.equal(day.length, 1); assert.equal(h.reads.length, 0);
    const all = await h.manager.readCollectionRange('schedules', 'a');
    assert.equal(all.length, 2); assert.equal(h.reads.length, 1); assert.equal(h.reads[0].options.source, 'server');
    h.manager.unsubscribeAll();
});

test('failed history reads reject, release the shared request, and can retry', async () => {
    const h = harness(); h.fail = Object.assign(new Error('quota'), { code: 'resource-exhausted' });
    await assert.rejects(h.manager.readCollectionRange('schedules', 'a'), /quota/);
    assert.equal(h.manager._collectionReads.size, 0); h.fail = null;
    h.seed('a', 'schedules', [{ id: 'ok' }]);
    assert.equal((await h.manager.readCollectionRange('schedules', 'a')).length, 1);
});

test('scoped imports upsert only supplied IDs and never read or delete older records', async () => {
    const h = harness();
    h.seed('a', 'schedules', [{ id: 'historic', scheduleDate: '2020-01-01' }]);
    await h.manager.saveSchedules([{ id: 'nov', scheduleDate: '2026-11-17' }], 'a');
    assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0][0], 'set'); assert.ok(h.writes[0][1].endsWith('/nov'));
    await h.manager.saveSchedules([], 'a'); assert.equal(h.writes.length, 1);
});

test('old-store listeners close immediately for scoped views; authentication clears all sessions', () => {
    const h = harness();
    h.manager.subscribeToStore('a', { schedules() {} }, { scopes: { schedules: november } });
    h.manager.subscribeToStore('b', { schedules() {} }, { scopes: { schedules: november } });
    assert.ok(h.listeners[0].closed); assert.equal(h.manager._storeSubscriptions.size, 1);
    h.auth({ uid: 'user-b' }); assert.equal(h.manager._storeSubscriptions.size, 0); assert.ok(h.listeners[1].closed);
});

test('listener failures notify the view and do not automatically loop into new reads', () => {
    const h = harness(); let errors = 0;
    h.manager.subscribeToStore('a', { schedules() {} }, { scopes: { schedules: november }, onError: () => errors++ });
    h.listeners[0].error(new Error('quota')); assert.equal(errors, 1); assert.equal(h.listeners.length, 1);
    assert.equal(h.manager._storeSubscriptions.get('a').snapshots.size, 0); h.manager.unsubscribeAll();
});

test('no scoped callback is treated as an authoritative cached or pending result', () => {
    const h = harness(); let calls = 0;
    h.manager.subscribeToStore('a', { schedules: () => calls++ }, { scopes: { schedules: november } });
    h.emit(0, { fromCache: true }); h.emit(0, { hasPendingWrites: true }); assert.equal(calls, 0);
    h.emit(0); assert.equal(calls, 1); h.manager.unsubscribeAll();
});

function loaderHarness(tab = 'schedule') {
    const values = { filterDate: '2026-11-17', filterMonth: '2026-11', operatingCostChartDateRange: 'selected' };
    for (const prefix of Loader.charts) { values[prefix + 'DateRange'] = 'custom'; values[prefix + 'StartDate'] = '2026-11-01'; values[prefix + 'EndDate'] = '2026-11-30'; }
    const manager = { currentStoreId: 'a', currentViewMode: 'day', reportRebateFilter: { mode: 'month', month: '2026-11' }, dbManager: { _currentUser: { uid: 'a' } } };
    const loader = Object.create(Loader.prototype);
    Object.assign(loader, { manager, costMonth: '2026-11', tab: () => tab, value: id => values[id] || '' });
    return { loader, manager, values, setTab: value => { tab = value; } };
}

test('plans load only module dependencies and use the same month for all financial inputs', () => {
    const h = loaderHarness('management'); assert.deepEqual(h.loader.plan().scopes, { employees: null });
    h.setTab('schedule'); const plan = h.loader.plan();
    for (const name of Loader.dated) assert.deepEqual(plan.scopes[name], november);
    assert.equal(plan.scopes.salaryTiers, undefined);
    h.setTab('rebate'); assert.deepEqual(h.loader.plan().scopes, { reportRebates: november });
    h.setTab('operating-cost'); assert.deepEqual(h.loader.plan().scopes, { operatingCosts: november });
    h.setTab('ai-analysis'); assert.deepEqual(h.loader.plan().scopes, {});
});

test('charts request every selected period; any all-history chart expands coverage', () => {
    const h = loaderHarness('charts'); h.values.heatmapStartDate = '2026-10-28';
    assert.deepEqual(h.loader.plan().scopes.schedules, { start: '2026-10-01', end: '2026-12-01' });
    h.values.employeeRankingDateRange = 'all'; assert.equal(h.loader.plan().scopes.schedules, null);
});

test('AI range includes the entire preceding comparison period', () => {
    const h = loaderHarness('ai-analysis');
    h.manager._getAIDateRange = () => ({ custom: true, startDate: '2026-11-01', endDate: '2026-11-30' });
    assert.deepEqual(h.loader.aiRange('unused'), { start: '2026-10-02', end: '2026-12-01' });
});

test('period clipping keeps totals exact even when the transport fetched whole boundary months', () => {
    const rows = [{ date: '2026-10-31', amount: 1 }, { date: '2026-11-01', amount: 2 }, { date: '2026-11-02', amount: 4 }, { date: '2026-11-03', amount: 8 }];
    const result = Loader.within(rows, 'operatingCosts', { start: '2026-10-31', end: '2026-11-03' });
    assert.equal(result.reduce((sum, row) => sum + row.amount, 0), 7);
});

test('a view waits for every dependency, discards failed inputs, and ignores retired callbacks', () => {
    const h = loaderHarness('schedule'), calls = [];
    Object.assign(h.loader, { started: true, generation: 0, key: '', status() {}, applyRows: () => calls.push('render') });
    h.manager._getSubscribeCallbacks = () => ({ employees() {} });
    let callbacks, options;
    h.manager.dbManager.subscribeToStore = (_, cb, opts) => { callbacks = cb; options = opts; };
    h.loader.refresh(); const names = Object.keys(callbacks);
    for (const name of names.slice(0, -1)) callbacks[name]([]);
    assert.equal(calls.length, 0);
    callbacks[names.at(-1)]([]); assert.equal(calls.length, 1);
    options.onError(new Error('quota'), 'reportRebates');
    callbacks.schedules([]); assert.equal(calls.length, 1);
    const retired = callbacks;
    h.manager.currentStoreId = 'b'; h.loader.refresh();
    retired.reportRebates([]); assert.equal(calls.length, 1);
    clearTimeout(h.loader.slowTimer);
});

test('exports use complete isolated inputs and abort on failed or wrong-store reads', async () => {
    const h = loaderHarness('schedule');
    Object.assign(h.loader, { status() {}, ready: false });
    h.manager.schedules = [{ id: 'visible-month' }];
    h.manager.dbManager.readCollectionRange = async () => [{ id: 'historic' }, { id: 'visible-month' }];
    let exported = 0;
    await h.loader.withData(['schedules'], null, context => { exported++; assert.equal(context.schedules.length, 2); });
    assert.equal(h.manager.schedules.length, 1); assert.equal(exported, 1);
    h.manager.dbManager.readCollectionRange = async () => { throw new Error('quota'); };
    assert.equal(await h.loader.withData(['schedules'], null, () => exported++), false);
    h.manager.dbManager.readCollectionRange = async () => { h.manager.currentStoreId = 'b'; return []; };
    assert.equal(await h.loader.withData(['schedules'], null, () => exported++), false);
    assert.equal(exported, 1); assert.equal(h.manager._dataActionPending, false);
});
