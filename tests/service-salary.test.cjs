const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, prepare } = require('../service-salary.js');
const rows = [
    {name:'小甲',grade:'S',price:100,employeeId:'a',referrer:'点点'},
    {name:'小甲',grade:'SS',price:200,employeeId:'a',referrer:'点点'},
    {name:'点点',grade:'S',price:100,employeeId:'b',referrer:'圆圆'}
];
const order = (id, employeeName='点点', scheduleDate='2026-10-01') => ({id,employeeName,scheduleDate});
const run = overrides => calculate({rows,schedules:[],referrer:'点点',month:'2026-10',baseSalary:'3000',allowance:'500',rate:'20',...overrides});

for (const [count, first, extra, total] of [[0,0,0,3500],[199,199,0,5490],[200,200,0,5500],[201,200,1,5515],[250,200,50,6250]]) {
    test(`${count} monthly orders: only the ${extra} excess orders earn 15 yuan`, () => {
        const result = run({schedules:Array.from({length:count},(_,i)=>order(String(i)))});
        assert.equal(result.storeOrders,count); assert.equal(result.firstOrders,first); assert.equal(result.extraOrders,extra);
        assert.equal(result.totalCents,total*100); assert.equal(result.referral.totalOrders,0);
        assert.ok(result.formula.includes(`超出部分提成${extra}×15`));
    });
}

test('store orders include all employees; referral bonus includes only employees introduced by the chosen service worker', () => {
    const result = run({schedules:[order('1','小甲'),order('2','点点'),order('3','未登记员工')]});
    assert.equal(result.storeOrders,3); assert.equal(result.referral.totalOrders,1);
    assert.equal(result.referral.totalCents,2000); assert.equal(result.totalCents,355000);
    assert.equal(result.referral.unmatchedCount,1);
    assert.match(result.formula,/前200单提成3×10.*推荐人奖金20 = 3550元/);
});

test('one confirmed referral update changes only the referral component', () => {
    const schedules=[order('1','小甲'),order('2','点点')];
    const result=run({schedules,referrers:{a:'圆圆',b:'点点'}});
    assert.equal(result.referral.employees.find(person=>person.name==='点点').count,1);
    assert.equal(run({schedules,referrers:{a:'',b:''}}).totalCents,352000);
});

test('monthly boundaries, duplicate IDs and invalid dates cannot inflate monthly tiers', () => {
    const result=run({month:'2024-02',schedules:[order('1','点点','2024-01-31'),order('2','点点','2024-02-01'),
        order('3','点点','2024-02-29'),order('3','点点','2024-02-29'),order('4','点点','2024-03-01'),order('5','点点','2024-02-30')]});
    assert.equal(result.storeOrders,2); assert.equal(result.totalCents,352000);
    assert.equal(prepare({month:'2026-12',referrer:'点点',rate:'20',baseSalary:'3000',allowance:'500'}).end,'2026-12-31');
});

test('editable salary components use integer cents, validation rejects invalid money and non-month ranges', () => {
    const result=run({baseSalary:'3000.01',allowance:'500.02',rate:'0.10',schedules:[order('1','小甲')]});
    assert.equal(result.totalCents,351013);
    for(const value of ['','-1','abc','1.234']) {
        assert.throws(()=>run({baseSalary:value}),/底薪/);
        assert.throws(()=>run({allowance:value}),/补贴/);
    }
    for(const month of ['','2026-13','2026-01-01','2026-1']) assert.throws(()=>run({month}),/月份/);
    assert.throws(()=>run({rate:'-1'}),/奖金/);
});

test('customer-service referral default is 15 yuan while the general referral calculator keeps its own rate', () => {
    const result=calculate({month:'2026-11',rows,schedules:[order('1','小甲','2026-11-01')]});
    assert.equal(result.referral.rateCents,1500);assert.equal(result.totalCents,352500);
    assert.equal(run({schedules:[order('1','小甲')]}).referral.totalCents,2000);
});
