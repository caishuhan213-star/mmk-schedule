const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const copy = value => structuredClone(value);
const quiet = { log() {}, warn() {}, error() {} };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const snapshot = (items, metadata = {}) => ({
    metadata: { fromCache: false, hasPendingWrites: false, ...metadata },
    forEach: fn => items.forEach(item => fn({ id: item.id, data: () => copy(item) }))
});

function harness() {
    const listeners = [], timers = new Map(), authCallbacks = [];
    let timerId = 0, gets = 0, getResult = () => Promise.resolve(snapshot([]));
    const db = { collection: collectionPath => ({
        get: options => { gets++; return getResult(collectionPath, options); },
        onSnapshot: (options, next, error) => {
            const listener = { path: collectionPath, options, next, error, closed: false };
            listeners.push(listener);
            return () => { listener.closed = true; };
        }
    }) };
    const context = vm.createContext({ console: quiet, structuredClone,
        setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
        clearTimeout: id => timers.delete(id),
        firebase: { apps: [{}], firestore: () => db, auth: () => ({ onAuthStateChanged: fn => authCallbacks.push(fn) }) }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../firebase-data-manager.js'), 'utf8') + '\nglobalThis.Manager = FirebaseDataManager;', context);
    const manager = new context.Manager();
    const auth = user => authCallbacks.forEach(fn => fn(user));
    auth({ uid: 'test-user' });
    return { manager, db, listeners, timers, auth,
        get gets() { return gets; },
        setGet: fn => { getResult = fn; },
        emit(store, items, metadata = {}, collection = 'schedules') {
            listeners.filter(l => !l.closed && l.path === `team/shared/stores/${store}/${collection}`)
                .forEach(l => l.next(snapshot(items, metadata)));
        },
        expireTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.fn()); }
    };
}

test('five A-B-A round trips reuse two store listeners instead of creating eleven', () => {
    const h = harness(); let current = [];
    const show = { schedules: rows => { current = rows; } };
    const a = Array.from({ length: 3000 }, (_, i) => ({ id: `a-${i}` }));
    const b = Array.from({ length: 2000 }, (_, i) => ({ id: `b-${i}` }));
    h.manager.subscribeToStore('a', show); h.emit('a', a);
    for (let i = 0; i < 5; i++) {
        h.manager.subscribeToStore('b', show); if (i === 0) h.emit('b', b);
        assert.equal(current.length, 2000);
        h.manager.subscribeToStore('a', show); assert.equal(current.length, 3000);
    }
    assert.equal(h.listeners.length, 2); assert.equal(h.gets, 0);
    assert.equal(h.manager._storeSubscriptions.size, 2);
    assert.equal(h.timers.size, 1);
    assert.equal([...h.timers.values()][0].ms, 120000);
});

test('inactive-store changes stay isolated and are current immediately on return', () => {
    const h = harness(); let current, oldCallbackCalls = 0;
    h.manager.subscribeToStore('a', { schedules: () => { oldCallbackCalls++; } });
    h.emit('a', [{ id: 'old-a' }]);
    h.manager.subscribeToStore('b', { schedules: rows => { current = rows; } });
    h.emit('b', [{ id: 'b' }]); h.emit('a', [{ id: 'new-a' }]);
    assert.equal(current[0].id, 'b'); assert.equal(oldCallbackCalls, 1);
    h.manager.subscribeToStore('a', { schedules: rows => { current = rows; } });
    assert.equal(current[0].id, 'new-a'); assert.equal(h.listeners.length, 2);
    h.manager.subscribeToStore('a', { schedules: rows => { current = rows; } });
    assert.equal(h.listeners.length, 2);
});

test('warm stores expire, at most two remain subscribed and retired callbacks are ignored', () => {
    const h = harness(); let current;
    const show = { schedules: rows => { current = rows; } };
    h.manager.subscribeToStore('a', show); h.emit('a', [{ id: 'a' }]);
    h.manager.subscribeToStore('b', show); h.emit('b', [{ id: 'b' }]);
    h.manager.subscribeToStore('c', show); h.emit('c', [{ id: 'c' }]);
    assert.equal(h.listeners[0].closed, true); assert.equal(h.manager._storeSubscriptions.size, 2);
    h.listeners[0].next(snapshot([{ id: 'late-a' }])); assert.equal(current[0].id, 'c');
    h.expireTimers();
    assert.equal(h.listeners[1].closed, true); assert.equal(h.listeners[2].closed, false);
    assert.equal(h.manager._getCollectionState('b', 'schedules').ready, false);
    h.manager.subscribeToStore('b', show); assert.equal(h.listeners.length, 4);
});

test('sign-out and account changes discard all warm sessions and pending timers', () => {
    const h = harness(); let delivered = 0;
    h.manager.subscribeToStore('a', { schedules: () => { delivered++; } });
    h.emit('a', [{ id: 'a' }]);
    h.manager.subscribeToStore('b', { schedules: () => { delivered++; } });
    h.auth(null);
    assert.equal(h.timers.size, 0); assert.equal(h.manager._storeSubscriptions.size, 0);
    assert.equal(h.manager._collectionStates.size, 0); assert.ok(h.listeners.every(l => l.closed));
    h.listeners[0].next(snapshot([{ id: 'late' }])); assert.equal(delivered, 1);
    h.auth({ uid: 'new-user' });
    h.manager.subscribeToStore('a', { schedules: () => { delivered++; } });
    assert.equal(h.listeners.length, 3);
    h.auth({ uid: 'another-user' });
    assert.equal(h.manager._storeSubscriptions.size, 0);
});

test('sign-out rejects queued saves instead of leaving their callers waiting forever', async () => {
    const h = harness();
    const pending = h.manager._scheduleCollectionSave('schedules', 'a', new Map());
    const rejected = assert.rejects(pending, /登录状态已变化/);
    h.auth(null);
    await rejected;
    assert.equal(h.timers.size, 0);
});

test('cache-only and pending snapshots cannot become authoritative or replace schedules', () => {
    const h = harness(); let schedules, employeeMetadata;
    h.manager.subscribeToStore('a', { schedules: rows => { schedules = rows; }, employees: (_, metadata) => { employeeMetadata = metadata; } });
    h.emit('a', [{ id: 'saved' }]);
    h.emit('a', [], { fromCache: true });
    assert.equal(schedules[0].id, 'saved');
    assert.equal(h.manager._getCollectionState('a', 'schedules').ready, false);
    h.emit('a', [], { fromCache: true }, 'employees');
    assert.equal(employeeMetadata.fromCache, true);
    h.emit('a', [{ id: 'pending' }], { hasPendingWrites: true });
    assert.equal(schedules[0].id, 'saved');
    h.emit('a', [{ id: 'confirmed' }]);
    assert.equal(schedules[0].id, 'confirmed');
    assert.equal(h.manager._getCollectionState('a', 'schedules').ready, true);
    assert.ok(h.listeners.every(l => l.options.includeMetadataChanges));
});

test('active snapshots satisfy load calls without new reads and do not expose mutable baseline objects', async () => {
    const h = harness();
    h.manager.subscribeToStore('a', { schedules: rows => { rows[0].nested.value = 'ui-edited'; } });
    h.emit('a', [{ id: 'a', nested: { value: 'saved' } }]);
    const result = await h.manager.loadSchedules('a');
    assert.equal(result[0].nested.value, 'saved'); result[0].nested.value = 'caller-edited';
    assert.equal((await h.manager.loadSchedules('a'))[0].nested.value, 'saved');
    assert.equal(h.gets, 0);
    h.manager.unsubscribeAll();
    await h.manager.loadSchedules('a'); assert.equal(h.gets, 1);
});

test('concurrent cold loads share one request, return separate objects and allow fresh later reads', async () => {
    const h = harness(), request = deferred();
    h.setGet(() => request.promise);
    const a = h.manager.loadSchedules('a'), b = h.manager.loadSchedules('a');
    assert.equal(h.gets, 1);
    request.resolve(snapshot([{ id: 'a' }]));
    const [one, two] = await Promise.all([a, b]); one[0].id = 'changed'; assert.equal(two[0].id, 'a');
    assert.equal(h.manager._collectionReads.size, 0);
    await h.manager.loadSchedules('a'); assert.equal(h.gets, 2);
});

test('failed reads release their in-flight slot for a later retry', async () => {
    const h = harness(); h.setGet(() => Promise.reject(new Error('offline')));
    await h.manager.loadSchedules('a'); assert.equal(h.manager._collectionReads.size, 0);
    h.setGet(() => Promise.resolve(snapshot([{ id: 'recovered' }])));
    assert.equal((await h.manager.loadSchedules('a'))[0].id, 'recovered'); assert.equal(h.gets, 2);
});

test('concurrent baseline reads are merged and cannot overwrite a newer server snapshot', async () => {
    const h = harness(), request = deferred(); let source;
    h.setGet((_, options) => { source = options.source; return request.promise; });
    const ref = h.manager._collectionRef('a', 'schedules'), state = h.manager._getCollectionState('a', 'schedules');
    const first = h.manager._primeCollectionState(ref, state), second = h.manager._primeCollectionState(ref, state);
    assert.equal(h.gets, 1); assert.equal(source, 'server');
    h.manager._updateCollectionStateFromSnapshot('a', 'schedules', snapshot([{ id: 'newer' }]));
    request.resolve(snapshot([{ id: 'older' }])); await Promise.all([first, second]);
    assert.deepEqual([...state.docs.keys()], ['newer']); assert.equal(state.priming, null);
});

test('a failed baseline read never falls back to incomplete cached data', async () => {
    const h = harness(); h.setGet(() => Promise.reject(new Error('quota')));
    const state = h.manager._getCollectionState('a', 'schedules');
    h.manager._updateCollectionStateFromSnapshot('a', 'schedules', snapshot([], { fromCache: true }));
    await assert.rejects(h.manager._primeCollectionState(h.manager._collectionRef('a', 'schedules'), state), /quota/);
    assert.equal(state.ready, false); assert.equal(state.priming, null);
});

test('a failed listener is invalidated and can be recreated on a later visit', () => {
    const h = harness(); h.manager.subscribeToStore('a', { schedules() {} }); h.emit('a', [{ id: 'a' }]);
    h.listeners[0].error(new Error('offline'));
    assert.equal(h.manager._getCollectionState('a', 'schedules').ready, false);
    h.manager.subscribeToStore('a', { schedules() {} }); assert.equal(h.listeners.length, 2);
});

test('persistent multi-tab cache is initialized before auth queries; unavailable storage does not block login', async () => {
    for (const fail of [false, true]) {
        const calls = [];
        const auth = { setPersistence: async () => calls.push('auth-persistence'), onAuthStateChanged: () => calls.push('auth-listen') };
        const authFactory = () => auth;
        authFactory.Auth = { Persistence: { LOCAL: 'local' } };
        authFactory.GoogleAuthProvider = class { addScope() {} };
        const context = vm.createContext({ console: quiet, firebaseConfig: { apiKey: 'synthetic' },
            firebase: { apps: [{}], auth: authFactory, firestore: () => ({ enablePersistence: async options => {
                assert.equal(options.synchronizeTabs, true); calls.push('cache');
                if (fail) throw Object.assign(new Error('no indexeddb'), { code: 'unimplemented' });
            } }) }
        });
        const source = fs.readFileSync(path.join(__dirname, '../firebase-manager.js'), 'utf8')
            .replace('window.firebaseManager = new FirebaseManager();', 'globalThis.Manager = FirebaseManager;');
        vm.runInContext(source, context);
        const manager = Object.create(context.Manager.prototype);
        manager.showSyncStatus = manager.updateLoginUI = () => {};
        manager.showErrorStatus = () => { throw new Error('unexpected init failure'); };
        await manager.initFirebase();
        assert.deepEqual(calls, ['cache', 'auth-persistence', 'auth-listen']);
    }
});
