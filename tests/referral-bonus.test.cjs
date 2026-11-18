const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, validate } = require('../referral-bonus.js');
const rows = [
    { name: '甲', grade: 'S', price: 100, employeeId: 'a', aliases: ['旧甲'], referrer: '圆圆' },
    { name: '甲', grade: 'SS', price: 200, employeeId: 'a', aliases: ['旧甲'], referrer: '圆圆' },
    { name: '乙', grade: 'S', price: 100, employeeId: 'b', referrer: '点点' },
    { name: '丙', grade: 'S', price: 100, employeeId: 'c', referrer: '圆圆' }
];
const run = changes => calculate({ rows, schedules: [], referrer: '圆圆', rate: '20', start: '2026-10-01', end: '2026-10-31', ...changes });
const order = (id, employeeName, scheduleDate) => ({ id, employeeName, scheduleDate });

test('counts both inclusive boundaries and every distinct order once, not grade rows or hours', () => {
    const result = run({ schedules: [order('1','甲','2026-09-30'), order('2','甲','2026-10-01'),
        order('3','甲','2026-10-31'), order('3','甲','2026-10-31'), order('4','甲','2026-11-01'), order('5','乙','2026-10-12')] });
    assert.equal(result.totalOrders, 2); assert.equal(result.totalCents, 4000);
    assert.deepEqual(result.employees, [{name:'甲',count:2}, {name:'丙',count:0}]);
    assert.equal(result.formula, '甲2 （2）×20=40元');
});

test('the canonical referral map overrides legacy tags, including an explicitly cleared tag', () => {
    const schedules = [order('1','甲','2026-10-05'), order('2','乙','2026-10-05')];
    const result = run({ schedules, referrers: { a:'', b:'元元' } });
    assert.equal(result.totalOrders, 1); assert.equal(result.employees[0].name, '乙');
    assert.equal(run({ schedules, referrers: { a:'', b:'嘉嘉' } }).totalOrders, 0);
});

test('renamed employees retain old-name orders; exact names and stable identities take precedence', () => {
    const result = run({ schedules: [order('1','旧甲','2026-10-02'), { ...order('2','任意旧名','2026-10-03'), employeeId:'a' }] });
    assert.equal(result.totalOrders, 2);
    const reused = [...rows, {name:'旧甲',grade:'S',price:100,employeeId:'d',referrer:'杨总'}];
    assert.equal(run({rows:reused,schedules:[order('1','旧甲','2026-10-02')]}).totalOrders, 0);
});

test('ambiguous historical aliases fail instead of paying the same order to an arbitrary employee', () => {
    const ambiguous = [...rows, {name:'丁',grade:'S',price:100,employeeId:'d',aliases:['旧甲'],referrer:'点点'}];
    assert.throws(() => run({rows:ambiguous,schedules:[order('1','旧甲','2026-10-02')]}), /多个员工/);
});

test('empty and unmatched records are explicit, while invalid or out-of-range dates are ignored', () => {
    const result = run({ schedules: [order('1','补录','2026-10-10'), order('2','甲','2026-10-32'), order('3','甲','')] });
    assert.equal(result.totalCents, 0); assert.equal(result.formula, '（0）×20=0元');
    assert.equal(result.unmatchedCount, 1); assert.deepEqual(result.unmatchedNames, ['补录']);
    assert.deepEqual(run({referrer:'无关联'}).employees, []);
});

test('validates dates, leap days, reversed ranges and cents without floating point accumulation', () => {
    for (const rate of ['', '-1', 'abc', '1.234', 'Infinity']) assert.throws(() => run({rate}), /奖金/);
    assert.throws(() => run({start:'2026-02-29'}), /日期/);
    assert.throws(() => run({start:'2026-11-01'}), /日期/);
    assert.throws(() => run({referrer:''}), /推荐人/);
    assert.equal(validate({referrer:'圆圆',rate:'0.10',start:'2024-02-29',end:'2024-02-29'}), 10);
    const result = run({rate:'0.10',schedules:[1,2,3].map(i=>order(String(i),'甲','2026-10-02'))});
    assert.equal(result.totalCents,30); assert.equal(result.formula,'甲3 （3）×0.10=0.30元');
    assert.equal(run({rate:'0',schedules:[order('1','甲','2026-10-02')]}).totalCents,0);
});

test('cross-year ranges include the full selected interval without mutating source records', () => {
    const schedules = [order('1','甲','2025-12-31'), order('2','甲','2026-01-01'),order('3','甲','2026-01-02')];
    const before = JSON.stringify({rows,schedules});
    assert.equal(run({schedules,start:'2025-12-31',end:'2026-01-01'}).totalOrders,2);
    assert.equal(JSON.stringify({rows,schedules}), before);
});
