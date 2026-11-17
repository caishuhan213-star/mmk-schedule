const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../confirmed-query-cache.js'), 'utf8');
function harness(storage = new Map()) {
    let now = 1000;
    const context = vm.createContext({ Date: { now: () => now }, localStorage: {
        getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)
    } });
    vm.runInContext(source, context);
    return { cache: new context.ConfirmedQueryCache(), clock: value => { now = value; }, storage };
}
test('confirmed query cache reuses copies, isolates scopes and ranges, and expires', async () => {
    const h = harness(); let calls = 0; const load = async () => [{ id: ++calls }], options = { maxAgeMs: 60000 };
    const first = await h.cache.load('user-a/store-a', null, load, options); first[0].id = 'mutated';
    assert.equal((await h.cache.load('user-a/store-a', null, load, options))[0].id, 1);
    await h.cache.load('user-b/store-a', null, load, options);
    await h.cache.load('user-a/store-b', null, load, options);
    await h.cache.load('user-a/store-a', { start: '2026-11-01', end: '2026-12-01' }, load, options);
    assert.equal(calls, 4);
    h.clock(61000); await h.cache.load('user-a/store-a', null, load, options); assert.equal(calls, 5);
});
test('manual refresh and strict reads bypass cache; errors never masquerade as fresh results', async () => {
    const { cache } = harness(); let calls = 0; const load = async () => [++calls];
    await cache.load('scope', null, load, { maxAgeMs: 60000 });
    await cache.load('scope', null, load); assert.equal(calls, 2);
    await cache.load('scope', null, load, { maxAgeMs: 60000, force: true }); assert.equal(calls, 3);
    await assert.rejects(cache.load('scope', null, async () => { throw new Error('quota'); }, { maxAgeMs: 60000, force: true }), /quota/);
});
test('writes invalidate other tab caches and late reads cannot repopulate a changed scope', async () => {
    const storage = new Map(), a = harness(storage), b = harness(storage);
    let calls = 0; const load = async () => [++calls], options = { maxAgeMs: 60000 };
    await a.cache.load('scope', null, load, options); b.cache.invalidate('scope');
    await a.cache.load('scope', null, load, options); assert.equal(calls, 2);
    let finish; const pending = a.cache.load('scope', 'late', () => new Promise(resolve => { finish = resolve; }), options);
    await new Promise(resolve => setImmediate(resolve)); b.cache.invalidate('scope'); finish(['old']); await pending;
    assert.equal((await a.cache.load('scope', 'late', load, options))[0], 3);
});
test('simultaneous loads share a request and failures release it for retry', async () => {
    const { cache } = harness(); let calls = 0, finish;
    const load = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    const a = cache.load('scope', null, load), b = cache.load('scope', null, load);
    await new Promise(resolve => setImmediate(resolve)); finish([1]); await Promise.all([a, b]); assert.equal(calls, 1);
    await assert.rejects(cache.load('new', null, async () => { throw new Error('offline'); }), /offline/);
    assert.equal((await cache.load('new', null, async () => [2]))[0], 2);
});
