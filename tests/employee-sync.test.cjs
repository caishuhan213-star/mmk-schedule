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
    for (const method of ['renderEmployeeList', 'updateAttendanceFeeSelectors', 'updateInterviewFeeSelectors', 'jlRefreshPriceStatus', 'jlRenderPriceTable', 'closeEmployeeModal', 'showSuccessMessage']) manager[method] = () => {};
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

test('a successful update refreshes the open flex-based price dialog', () => {
    const { manager, fields } = app(); let renders = 0;
    fields.jlPriceModal = { style: { display: 'flex' } };
    manager.jlRenderPriceTable = () => { renders++; };
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
