const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const roster = require('../employee-roster.js');
const original = [{ name: '小林', grade: 'S', price: 100 }, { name: '小林', grade: 'SS', price: 180 }, { name: '小夏', grade: 'S', price: 200 }];
const prices = () => roster.normalize(original);
const copy = value => JSON.parse(JSON.stringify(value));

function app() {
    const cache = new Map(), alerts = [];
    const fields = {};
    const document = { addEventListener() {}, getElementById: id => fields[id] || null, querySelectorAll: () => [] };
    const context = vm.createContext({ console, window: {}, document, EmployeeRoster: roster, crypto: require('node:crypto').webcrypto,
        localStorage: { getItem: key => cache.get(key) || null, setItem: (key, value) => cache.set(key, value) },
        alert: message => alerts.push(message), confirm: () => true });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../script-clean.js'), 'utf8') + '\nglobalThis.Manager = ScheduleManager;', context);
    const manager = Object.create(context.Manager.prototype);
    Object.assign(manager, { jlPriceTable: prices(), _employeeProfiles: [], employees: [], currentStoreId: 'a', dataKeyPrefix: 'store_a_', _jlPriceReady: true, _employeeProfilesReady: true, dbManager: {} });
    for (const method of ['renderEmployeeList', 'updateAttendanceFeeSelectors', 'updateInterviewFeeSelectors', 'jlRefreshPriceStatus', 'closeEmployeeModal', 'showSuccessMessage']) manager[method] = () => {};
    manager.updateEmployeeSelectors = async () => {};
    manager.canModifyData = () => true;
    manager._refreshEmployeeRoster();
    return { manager, context, fields, alerts, cache };
}

test('price names replace inconsistent store rosters without mutating profile records', () => {
    const profilesA = [{ id: 'a1', name: '小林', photo: 'photo', phone: '13800000000', hireDate: '2024-01-01', notes: '保留' }, { id: 'a2', name: '旧员工', notes: '历史资料' }];
    const profilesB = [{ id: 'b1', name: '小夏', phone: '13900000000' }];
    const before = copy(profilesA);
    const a = roster.reconcile(prices(), profilesA), b = roster.reconcile(prices(), profilesB);
    assert.deepEqual(a.map(p => p.name), ['小林', '小夏']);
    assert.deepEqual(a.map(p => p.name), b.map(p => p.name));
    assert.equal(a[0].photo, 'photo'); assert.equal(a[0].notes, '保留');
    assert.equal(b[1].phone, '13900000000'); assert.deepEqual(profilesA, before);
});

test('manual renames retain identity, prices and profiles even in a store never opened during the rename', () => {
    const rows = prices(), id = rows[0].employeeId;
    const renamed = roster.rename(roster.rename(rows, id, '林林'), id, '小林新名');
    const profile = roster.reconcile(renamed, [{ id: 'old', name: '小林', photo: 'portrait', phone: '123' }])[0];
    assert.equal(profile.name, '小林新名'); assert.equal(profile.id, 'old'); assert.equal(profile.photo, 'portrait');
    assert.deepEqual(renamed.filter(row => row.employeeId === id).map(row => row.price), [100, 180]);
    assert.throws(() => roster.rename(renamed, id, '小夏'), /已存在/);
});

test('remove and re-import never erase archived details; empty prices give an empty active roster', () => {
    const profiles = [{ id: 'a', name: '小林', phone: '123' }];
    assert.deepEqual(roster.reconcile([], profiles), []);
    const saved = roster.mergeProfiles(profiles, roster.reconcile(prices().filter(r => r.name === '小夏'), profiles));
    assert.equal(saved.find(p => p.id === 'a').phone, '123');
    assert.equal(roster.reconcile(prices(), saved)[0].phone, '123');
});

test('trimmed duplicate rows collapse, blank prices remain unset and zero remains valid', () => {
    const rows = roster.normalize([{ name: ' 小林 ', grade: 's', price: 10 }, { name: '小林', grade: 'S', price: 0 }, { name: '新员工', grade: 'S', price: '' }, { name: '无效', grade: 'S', price: -1 }, null]);
    assert.equal(rows.length, 2); assert.equal(rows[0].price, 0); assert.equal(rows[1].price, null);
});

test('an employee reusing a previous name does not steal the renamed employee profile', () => {
    let rows = roster.rename(prices(), prices()[0].employeeId, '林林');
    rows = roster.normalize([...rows, { name: '小林', grade: 'S', price: null, employeeId: 'new-identity' }]);
    const profiles = [{ id: 'p', name: '小林', rosterId: prices()[0].employeeId, phone: '123' }];
    const people = roster.reconcile(rows, profiles);
    assert.equal(people.find(p => p.name === '林林').phone, '123');
    assert.equal(people.find(p => p.name === '小林').phone, undefined);
    const legacy = roster.reconcile(rows, [{ id: 'legacy', name: '小林', phone: 'legacy-phone' }]);
    assert.equal(legacy.find(p => p.name === '林林').phone, 'legacy-phone');
    assert.equal(legacy.find(p => p.name === '小林').phone, undefined);
});

test('unset rates never borrow another employee price; an explicit zero is kept', () => {
    const { manager } = app();
    const rows = roster.normalize([...original, { name: '新人', grade: 'S', price: null }, { name: '零价', grade: 'S', price: 0 }]);
    assert.equal(manager._jlParseLine('新人S，9-10，测试客户（200）美团', rows)[0].gradePrice, null);
    assert.equal(manager._jlParseLine('零价S，9-10，测试客户（200）美团', rows)[0].gradePrice, 0);
});

test('a successful price update refreshes the inline employee directory', () => {
    const { manager } = app(); let renders = 0;
    manager.renderEmployeeList = () => { renders++; };
    manager._jlApplyPriceTableRows(original);
    assert.equal(renders, 1);
});

test('server price snapshot and employee snapshot can arrive in either order', () => {
    for (const priceFirst of [true, false]) {
        const { manager } = app();
        manager.jlPriceTable = []; manager._employeeProfiles = [];
        const callback = manager._getSubscribeCallbacks().employees;
        const employeeSnapshot = () => callback([{ id: 'a', name: '小林', photo: 'kept' }, { id: 'x', name: '旧员工' }], { fromCache: false });
        const priceSnapshot = () => manager._jlApplyPriceTableRows(original);
        if (priceFirst) { priceSnapshot(); employeeSnapshot(); } else { employeeSnapshot(); priceSnapshot(); }
        assert.deepEqual(manager.employees.map(p => p.name), ['小林', '小夏']);
        assert.equal(manager.employees[0].photo, 'kept');
    }
});

test('late callbacks from a previous store cannot replace current-store employee details', () => {
    const { manager } = app();
    const old = manager._getSubscribeCallbacks().employees;
    manager.currentStoreId = 'b'; manager._employeeProfiles = [{ id: 'b', name: '小林', phone: 'current' }];
    old([{ id: 'a', name: '小林', phone: 'old' }], { fromCache: false });
    manager._refreshEmployeeRoster(); assert.equal(manager.employees[0].phone, 'current');
});

test('cached empty collections cannot migrate old local schedules or replace another store', () => {
    const { manager, cache } = app();
    let writes = 0;
    manager.schedules = [{ id: 'local-schedule' }];
    manager.saveSchedules = () => { writes++; };
    manager.renderTableWithCurrentFilter = manager.updateStats = manager.renderEmployeeCommissionSummary = () => {};
    const callback = manager._getSubscribeCallbacks().schedules;
    callback([], { fromCache: true });
    callback([], { fromCache: false, pending: true });
    assert.equal(writes, 0); assert.equal(manager.schedules[0].id, 'local-schedule');
    callback([{ id: 'server-schedule' }], { fromCache: false });
    assert.equal(manager.schedules[0].id, 'server-schedule');
    assert.deepEqual(JSON.parse(cache.get('store_a_schedules')), [{ id: 'server-schedule' }]);
    manager.currentStoreId = 'b'; manager.schedules = [{ id: 'store-b' }];
    callback([{ id: 'late-store-a' }], { fromCache: false });
    assert.equal(manager.schedules[0].id, 'store-b');
});

test('failed save does not change names, price cache, or profile data and releases saving controls', async () => {
    const { manager, alerts, cache } = app();
    manager.dbManager.saveJlPriceTable = async () => { throw new Error('offline'); };
    const before = copy(manager.jlPriceTable);
    const result = await manager.jlSavePriceTable([]);
    assert.equal(result, false); assert.deepEqual(manager.jlPriceTable, before);
    assert.equal(cache.has('jl_price_table'), false); assert.equal(manager._jlPriceWritePending, false);
    assert.match(alerts[0], /尚未保存/);
});

test('employee form saves profile and shared price name together, preserving existing rates', async () => {
    const { manager, fields } = app();
    manager._employeeProfiles = [{ id: 'profile', name: '小林', photo: 'old-photo', phone: '13800000000' }];
    manager._refreshEmployeeRoster(); manager.editingEmployeeId = 'profile'; manager.currentPhotoData = 'old-photo';
    Object.assign(fields, { employeeNameInput: { value: '林林' }, employeePhone: { value: '13800000000' }, employeeHireDate: { value: '2024-01-01' }, employeeNotes: { value: '备注' } });
    let write;
    manager.dbManager.saveJlPriceTable = async (rows, options) => { write = { rows, options }; };
    await manager.saveEmployee();
    assert.equal(write.options.profile.photo, 'old-photo'); assert.equal(write.options.storeId, 'a');
    assert.deepEqual(write.rows.filter(row => row.name === '林林').map(row => row.price), [100, 180]);
    assert.equal(manager.employees[0].name, '林林');
});

test('new employee creates a shared identity and unset prices, without inheriting another employee photo', async () => {
    const { manager, fields } = app();
    manager.editingEmployeeId = null; manager.currentPhotoData = null;
    Object.assign(fields, { employeeNameInput: { value: '新人' }, employeePhone: { value: '' }, employeeHireDate: { value: '' }, employeeNotes: { value: '' } });
    manager.dbManager.saveJlPriceTable = async () => {};
    await manager.saveEmployee();
    assert.equal(manager.employees.find(p => p.name === '新人').photo, null);
    assert.ok(manager.jlPriceTable.filter(r => r.name === '新人').every(r => r.price === null));
});

test('removing an employee updates the shared roster without deleting the profile or historical schedules', async () => {
    const { manager } = app();
    manager._employeeProfiles = [{ id: 'profile', name: '小林', photo: 'retained' }];
    manager.schedules = [{ id: 'history', employeeName: '小林', payment: 300 }];
    manager._refreshEmployeeRoster();
    let options;
    manager.dbManager.saveJlPriceTable = async (rows, value) => { options = value; };
    await manager.deleteEmployee('profile');
    assert.equal(manager.employees.some(p => p.name === '小林'), false);
    assert.equal(manager._employeeProfiles[0].photo, 'retained');
    assert.equal(manager.schedules[0].employeeName, '小林');
    assert.equal(options.profile, undefined);
});

test('an intentionally empty server price table never resurrects a stale local table', () => {
    const { manager } = app(); let callback, writes = 0;
    manager.dbManager.subscribeToJlPriceTable = fn => { callback = fn; };
    manager.dbManager.saveJlPriceTable = async () => { writes++; };
    manager.jlInitPriceTableSync(); callback([], { exists: true, fromCache: false });
    assert.equal(writes, 0); assert.equal(manager.employees.length, 0);
});

test('offline snapshots cannot trigger migration or allow employee edits', () => {
    const { manager } = app(); let callback, writes = 0;
    manager.dbManager.subscribeToJlPriceTable = fn => { callback = fn; };
    manager.dbManager.saveJlPriceTable = async () => { writes++; };
    manager.jlInitPriceTableSync(); callback([], { exists: false, fromCache: true });
    assert.equal(writes, 0); assert.equal(manager._requireEmployeeSyncReady(false), false);
    assert.equal(manager.employees.length, 2);
});

test('Firestore transaction rejects a stale roster and writes no partial profile on conflict', async () => {
    const context = vm.createContext({ console, EmployeeRoster: roster });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../firebase-data-manager.js'), 'utf8') + '\nglobalThis.DataManager = FirebaseDataManager;', context);
    const manager = Object.create(context.DataManager.prototype);
    const writes = []; let serverRows = [...original, { name: '另一设备', grade: 'S', price: 200 }];
    const transaction = { get: async () => ({ exists: true, data: () => ({ rows: serverRows }) }), set: (...args) => writes.push(args) };
    manager._currentUser = { uid: 'test' }; manager._readOnly = false;
    manager._getFirestore = () => ({ runTransaction: fn => fn(transaction) });
    manager._settingsDocRef = () => 'prices'; manager._collectionRef = () => ({ doc: id => `employees/${id}` });
    const options = { expectedRows: prices(), profile: { id: 'p', name: '小林' }, storeId: 'a' };
    await assert.rejects(manager.saveJlPriceTable([], options), /其他设备更新/);
    assert.equal(writes.length, 0);
    serverRows = original.map(row => ({ ...row, referrer: '点点' }));
    await assert.rejects(manager.saveJlPriceTable(prices(), options), /其他设备更新/);
    assert.equal(writes.length, 0);
    serverRows = original;
    await manager.saveJlPriceTable(prices(), options);
    assert.equal(writes.length, 2); assert.equal(writes[1][0], 'employees/p');
});

test('restored browser values and delayed credential autofill cannot become the default employee filter', () => {
    const { manager, fields, context } = app();
    const inputEvents = {}, pageEvents = {};
    const input = { value: 'saved-account@example.invalid', matches: () => true,
        addEventListener: (name, handler) => { inputEvents[name] = handler; } };
    fields.employeeSearch = input;
    context.window.addEventListener = (name, handler) => { pageEvents[name] = handler; };
    manager.initializeEmployeeSearch();
    assert.equal(input.value, ''); assert.equal(manager._employeeSearchQuery, '');
    input.value = 'saved-account@example.invalid'; inputEvents.input();
    assert.equal(input.value, ''); assert.equal(manager._employeeSearchQuery, '');
    input.value = 'silent-autofill@example.invalid';
    inputEvents.animationstart({ animationName: 'employee-search-autofill' });
    assert.equal(input.value, '');
    input.value = 'restored-query'; manager._employeeSearchQuery = 'restored-query'; pageEvents.pageshow();
    assert.equal(input.value, ''); assert.equal(manager._employeeSearchQuery, '');
});

test('intentional employee searches survive cloud updates and can be cleared normally', () => {
    const { manager, fields } = app();
    const input = { value: '小林', matches: () => false };
    fields.employeeSearch = input;
    manager.updateEmployeeSearch(input);
    manager._jlApplyPriceTableRows(original);
    assert.equal(manager._employeeSearchQuery, '小林');
    input.value = '138'; manager.updateEmployeeSearch(input);
    assert.equal(manager._employeeSearchQuery, '138');
    input.value = ''; manager.updateEmployeeSearch(input);
    assert.equal(manager._employeeSearchQuery, '');
    input.value = '小夏'; manager.updateEmployeeSearch(input); manager.resetEmployeeSearch();
    assert.equal(input.value, ''); assert.equal(manager._employeeSearchQuery, '');
});

test('inline edits save only changed cells while retaining filtered-out employees and new remote prices', async () => {
    const { manager } = app();
    const id = manager.jlPriceTable[0].employeeId;
    manager._employeeSearchQuery = '小林';
    manager._setEmployeePriceDraft(id, 'S', '125.5', 100);
    manager._jlApplyPriceTableRows(original.map(row => row.grade === 'SS' ? { ...row, price: 210 } : row));
    let write;
    manager.dbManager.saveJlPriceTable = async rows => { write = copy(rows); };
    assert.equal(await manager.saveEmployeePrices(id), true);
    assert.deepEqual(write.map(row => row.price), [125.5, 210, 200]);
    assert.equal(manager._employeePriceDrafts.size, 0);
});

test('inline rates allow zero and blank and can fill a previously missing grade', async () => {
    const { manager } = app();
    const id = manager.jlPriceTable[2].employeeId;
    manager.dbManager.saveJlPriceTable = async () => {};
    manager._setEmployeePriceDraft(id, 'S', '0', 200);
    manager._setEmployeePriceDraft(id, 'SS', '160', null);
    assert.equal(await manager.saveEmployeePrices(id), true);
    assert.deepEqual(manager.jlPriceTable.filter(row => row.employeeId === id).map(row => row.price), [0, 160]);
    manager._setEmployeePriceDraft(id, 'SS', '', 160);
    assert.equal(await manager.saveEmployeePrices(id), true);
    assert.equal(manager.jlPriceTable.find(row => row.employeeId === id && row.grade === 'SS').price, null);
});

test('invalid inline prices are rejected and failed saves retain edits for retry', async () => {
    const { manager, alerts } = app();
    const id = manager.jlPriceTable[0].employeeId;
    let writes = 0;
    manager.dbManager.saveJlPriceTable = async () => { writes++; throw new Error('offline'); };
    for (const [value, invalid] of [['-1', false], ['Infinity', false], ['', true]]) {
        manager._setEmployeePriceDraft(id, 'S', value, 100, invalid);
        assert.equal(await manager.saveEmployeePrices(id), false);
    }
    assert.equal(writes, 0);
    manager._setEmployeePriceDraft(id, 'S', '130', 100);
    assert.equal(await manager.saveEmployeePrices(id), false);
    assert.equal(writes, 1);
    assert.equal(manager._employeePriceDrafts.get(id).get('S').value, '130');
    assert.equal(manager.jlPriceTable[0].price, 100);
    assert.match(alerts.at(-1), /尚未保存/);
});

test('same-cell remote changes cannot be overwritten, including a price that was initially blank', async () => {
    for (const initial of [100, null]) {
        const { manager, alerts } = app();
        manager._jlApplyPriceTableRows(original.map((row, i) => i === 0 ? { ...row, price: initial } : row));
        const id = manager.jlPriceTable[0].employeeId;
        manager._setEmployeePriceDraft(id, 'S', '130', initial);
        manager._jlApplyPriceTableRows(original.map((row, i) => i === 0 ? { ...row, price: 140 } : row));
        // The next input event comes from a newly rendered field with the latest saved value.
        manager._setEmployeePriceDraft(id, 'S', '150', 140);
        let writes = 0;
        manager.dbManager.saveJlPriceTable = async () => { writes++; };
        assert.equal(await manager.saveEmployeePrices(id), false);
        assert.equal(writes, 0);
        assert.equal(manager._employeePriceDrafts.get(id).get('S').originalPrice, initial);
        assert.match(alerts.at(-1), /其他设备更新/);
    }
});

test('returning an inline price to its original value discards the pending edit', () => {
    const { manager } = app();
    const id = manager.jlPriceTable[0].employeeId;
    manager._setEmployeePriceDraft(id, 'S', '130', 100);
    manager._setEmployeePriceDraft(id, 'S', '100', 100);
    assert.equal(manager._employeePriceDrafts.size, 0);
});

test('referrer presets do not assign existing employees and custom labels remain available', () => {
    assert.deepEqual(roster.referrerOptions(original), ['圆圆', '杨总', '嘉嘉', '点点']);
    assert.ok(roster.roster(original).every(person => person.referrer === ''));
    const tagged = roster.normalize(original.map(row => ({ ...row, referrer: row.name === '小林' ? ' 其他推荐人 ' : '圆圆' })));
    assert.deepEqual(roster.referrerOptions(tagged), ['圆圆', '杨总', '嘉嘉', '点点', '其他推荐人']);
    assert.equal(roster.reconcile(tagged, [{ id: 'p', name: '小林', referrer: '旧标签', phone: '123' }])[0].referrer, '其他推荐人');
    assert.equal(roster.reconcile(tagged, [])[0].referrer, '其他推荐人');
});

test('corrected referrer names also normalize saved tags without changing employee identities or prices', () => {
    const legacy = prices().map(row => ({ ...row, referrer: row.name === '小林' ? ' 元元 ' : '加加' }));
    const corrected = roster.normalize(legacy);
    assert.deepEqual(corrected.map(row => row.referrer), ['圆圆', '圆圆', '嘉嘉']);
    assert.deepEqual(corrected.map(row => [row.employeeId, row.name, row.grade, row.price]), legacy.map(row => [row.employeeId, row.name, row.grade, row.price]));
    assert.deepEqual(roster.referrerOptions(legacy), ['圆圆', '杨总', '嘉嘉', '点点']);
    assert.deepEqual(roster.normalize(original, legacy).map(row => row.referrer), ['圆圆', '圆圆', '嘉嘉']);
    assert.equal(roster.normalizeReferrer(' 其他推荐人 '), '其他推荐人');
    assert.equal(roster.normalizeReferrer(''), '');
});

test('referrers survive price-only imports, renames and added grades; explicit clearing is preserved', () => {
    const tagged = roster.normalize(original.map(row => ({ ...row, referrer: row.name === '小林' ? '圆圆' : '杨总' })));
    const imported = roster.normalize(original.map(row => ({ ...row, price: 150 })), tagged);
    const renamed = roster.rename(imported, imported[0].employeeId, '林林');
    const extended = roster.normalize([...renamed, ...roster.roster(renamed).map(person => ({ ...person, grade: 'SSS', price: null }))]);
    assert.ok(extended.filter(row => row.name === '林林').every(row => row.referrer === '圆圆'));
    const cleared = roster.normalize(extended.map(row => row.employeeId === imported[0].employeeId ? { ...row, referrer: '' } : row), extended);
    assert.ok(cleared.filter(row => row.name === '林林').every(row => row.referrer === ''));
    assert.ok(cleared.filter(row => row.name === '小夏').every(row => row.referrer === '杨总'));
});

test('referrer filtering combines with name or phone search, keeps newest-first order and supports unassigned', () => {
    const { manager } = app();
    const rows = [...original, { name: '新人', grade: 'S', price: null }, { name: '未标记', grade: 'S', price: null }];
    manager._employeeProfiles = [{ id: 'p', name: '小林', phone: '13812345678' }];
    manager._jlApplyPriceTableRows(rows.map(row => ({ ...row, referrer: ['小林', '新人'].includes(row.name) ? '圆圆' : '' })));
    const before = copy(manager.employees);
    manager._employeeReferrerFilter = 'name:圆圆';
    assert.deepEqual(manager._employeeDirectoryMatches().map(p => p.name), ['新人', '小林']);
    manager._employeeSearchQuery = '138';
    assert.deepEqual(manager._employeeDirectoryMatches().map(p => p.name), ['小林']);
    manager._employeeSearchQuery = '小夏';
    assert.equal(manager._employeeDirectoryMatches().length, 0);
    manager._employeeSearchQuery = ''; manager._employeeReferrerFilter = 'unset';
    assert.deepEqual(manager._employeeDirectoryMatches().map(p => p.name), ['未标记', '小夏']);
    manager._employeeReferrerFilter = '';
    assert.deepEqual(manager._employeeDirectoryMatches().map(p => p.name), ['未标记', '新人', '小夏', '小林']);
    assert.deepEqual(manager.employees, before);
});

function employeeFields(fields, referrer) {
    Object.assign(fields, { employeeNameInput: { value: '小林' }, employeePhone: { value: '' }, employeeHireDate: { value: '' }, employeeNotes: { value: '' }, employeeReferrer: { value: referrer } });
}

test('saving a referrer updates every grade and every store without changing prices or roster order', async () => {
    const { manager, fields } = app();
    const id = manager.employees[0].id;
    manager.editingEmployeeId = id; manager._editingEmployeeReferrer = '';
    employeeFields(fields, '圆圆');
    let write;
    manager.dbManager.saveJlPriceTable = async rows => { write = copy(rows); };
    await manager.saveEmployee();
    assert.deepEqual(write.map(row => row.price), original.map(row => row.price));
    assert.deepEqual(write.map(row => row.name), original.map(row => row.name));
    assert.ok(write.filter(row => row.name === '小林').every(row => row.referrer === '圆圆'));
    assert.equal(roster.reconcile(write, [{ id: 'other', name: '小林', phone: '13900000000', referrer: '过期标签' }])[0].referrer, '圆圆');
    fields.employeeReferrer.value = ''; manager._editingEmployeeReferrer = '圆圆';
    await manager.saveEmployee();
    assert.equal(manager.employees[0].referrer, '');
});

test('failed referral saves retain the previous tag and newer remote referrals cannot be overwritten by a stale form', async () => {
    const { manager, fields, alerts } = app();
    manager.editingEmployeeId = manager.employees[0].id; manager._editingEmployeeReferrer = '';
    employeeFields(fields, '嘉嘉');
    manager.dbManager.saveJlPriceTable = async () => { throw new Error('offline'); };
    await manager.saveEmployee();
    assert.equal(manager.employees[0].referrer, '');
    assert.equal(fields.employeeReferrer.value, '嘉嘉');
    manager._jlApplyPriceTableRows(original.map(row => ({ ...row, referrer: '点点' })));
    let writes = 0;
    manager.dbManager.saveJlPriceTable = async () => { writes++; };
    await manager.saveEmployee();
    assert.equal(writes, 0); assert.match(alerts.at(-1), /推荐人已在其他设备更新/);
    // Editing an unrelated field leaves the new remote referral in place.
    fields.employeeReferrer.value = ''; fields.employeeNotes.value = '新备注';
    await manager.saveEmployee();
    assert.equal(writes, 1); assert.equal(manager.employees[0].referrer, '点点');
});

test('quota errors keep the referral draft, remain visible after a server snapshot and clear after a successful retry', async () => {
    const { manager, fields, cache, context, alerts } = app();
    const badges = [];
    context.window.firebaseManager = { setEmployeeSaveError: message => badges.push(message) };
    fields.employeeFormError = { hidden: true, textContent: '' };
    employeeFields(fields, '嘉嘉');
    manager.editingEmployeeId = manager.employees[0].id;
    manager._editingEmployeeReferrer = '';
    let closeCount = 0;
    manager.closeEmployeeModal = () => { closeCount++; };
    manager.dbManager.saveJlPriceTable = async () => { throw Object.assign(new Error('Quota exceeded.'), { code: 'resource-exhausted' }); };
    const before = copy(manager.jlPriceTable);
    await manager.saveEmployee();
    assert.match(fields.employeeFormError.textContent, /额度受限/);
    assert.match(fields.employeeFormError.textContent, /尚未保存/);
    assert.equal(fields.employeeFormError.hidden, false);
    assert.equal(fields.employeeReferrer.value, '嘉嘉');
    assert.equal(closeCount, 0); assert.equal(alerts.length, 0);
    assert.equal(manager._jlPriceWritePending, false);
    assert.equal(cache.has('store_a_employees'), false);
    assert.deepEqual(manager.jlPriceTable, before);
    let snapshot;
    manager.dbManager.subscribeToJlPriceTable = callback => { snapshot = callback; };
    manager.jlInitPriceTableSync(); snapshot(before, { exists: true, fromCache: false });
    assert.match(manager._employeeSaveError, /尚未保存/);
    assert.equal(manager.employees[0].referrer, '');
    manager.dbManager.saveJlPriceTable = async () => {};
    await manager.saveEmployee();
    assert.equal(manager.employees[0].referrer, '嘉嘉');
    assert.equal(manager._employeeSaveError, '');
    assert.equal(fields.employeeFormError.hidden, true); assert.equal(closeCount, 1);
    assert.deepEqual(badges, ['云端额度受限', '']);
});

test('permission failures are distinguished from quota failures', async () => {
    const { manager, alerts } = app();
    manager.dbManager.saveJlPriceTable = async () => { throw Object.assign(new Error('Missing permissions.'), { code: 'permission-denied' }); };
    assert.equal(await manager.jlSavePriceTable(prices()), false);
    assert.match(alerts[0], /没有云端写入权限/);
    assert.doesNotMatch(alerts[0], /额度/);
});

test('background connection updates cannot replace a failed save badge with ready', () => {
    const status = { style: {} };
    const context = vm.createContext({ console, document: { getElementById: () => status } });
    const source = fs.readFileSync(path.join(__dirname, '../firebase-manager.js'), 'utf8')
        .replace('window.firebaseManager = new FirebaseManager();', 'globalThis.Manager = FirebaseManager;');
    vm.runInContext(source, context);
    const manager = Object.create(context.Manager.prototype);
    manager.syncStatus = 'ready';
    manager.setEmployeeSaveError('云端额度受限');
    manager.showSyncStatus();
    assert.match(status.innerHTML, /云端额度受限/);
    manager.setEmployeeSaveError('');
    assert.match(status.innerHTML, /已就绪/);
});

test('the real path builders target shared prices and the selected store profile; quota read failure writes nothing', async () => {
    const context = vm.createContext({ console, EmployeeRoster: roster });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../firebase-data-manager.js'), 'utf8') + '\nglobalThis.DataManager = FirebaseDataManager;', context);
    const manager = Object.create(context.DataManager.prototype);
    Object.assign(manager, { teamId: 'shared', _currentUser: { uid: 'test-only' }, _readOnly: false });
    const reads = [], writes = [];
    let rejectRead = true;
    const transaction = {
        get: async ref => {
            reads.push(ref.path);
            if (rejectRead) throw Object.assign(new Error('Quota exceeded.'), { code: 'resource-exhausted' });
            return { exists: true, data: () => ({ rows: original }) };
        },
        set: (ref, data) => writes.push({ path: ref.path, data })
    };
    manager._getFirestore = () => ({
        collection: path => ({ doc: id => ({ path: `${path}/${id}` }) }),
        runTransaction: callback => callback(transaction)
    });
    const options = { expectedRows: prices(), profile: { id: 'employee-test', referrer: '嘉嘉' }, storeId: 'test-store' };
    await assert.rejects(manager.saveJlPriceTable(prices(), options), { code: 'resource-exhausted' });
    assert.deepEqual(reads, ['team/shared/settings/jlPriceTable']);
    assert.equal(writes.length, 0);
    rejectRead = false;
    await manager.saveJlPriceTable(prices(), options);
    assert.deepEqual(writes.map(write => write.path), [
        'team/shared/settings/jlPriceTable', 'team/shared/stores/test-store/employees/employee-test'
    ]);
});
