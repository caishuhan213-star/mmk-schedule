const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const copy = value => structuredClone(value);
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const quiet = {log(){},warn(){},error(){}};

function harness() {
    const fields = {}, cache = new Map(), alerts = [], success = [], feedback = [], timers = new Map();
    const field = (id, value='') => fields[id] = {value,disabled:false};
    for (const [id,value] of Object.entries({employeeName:'小林',scheduleDate:'2026-11-16',startTime:'09:00',endTime:'10:00',projectName:'S',clientName:'测试客户',clientSource:'美团',payment:'200',commission:'100',attendanceDate:'2026-11-16',attendanceEmployee:'小林',attendanceFee:'100',interviewDate:'2026-11-16',interviewEmployee:'小林',interviewFee:'50',operatingCostDate:'2026-11-16',operatingCostCategory:'其他',operatingCostItem:'测试费用',operatingCostNote:'保留备注',operatingCostAmount:'99',reportRebateDate:'2026-11-16',reportRebateUserName:'测试客户',reportRebateEmployee:'小林',reportRebateContent:'保留内容',reportRebateAmount:'10'})) field(id,value);
    const groups = { scheduleForm:['employeeName','clientName','payment'], editForm:['editEmployeeName'], attendanceFeeForm:['attendanceDate','attendanceEmployee','attendanceFee'], interviewFeeForm:['interviewDate','interviewEmployee','interviewFee'], operatingCostForm:['operatingCostItem','operatingCostNote','operatingCostAmount'], reportRebateForm:['reportRebateUserName','reportRebateContent','reportRebateAmount'] };
    field('editEmployeeName','小林');
    for(const [id,ids] of Object.entries(groups)) fields[id]={querySelectorAll:()=>ids.map(id=>fields[id]),reset(){ids.forEach(id=>fields[id].value='');}};
    const context=vm.createContext({console:quiet,document:{addEventListener(){},getElementById:id=>fields[id]||null,querySelectorAll:()=>[]},window:{addEventListener(){},removeEventListener(){}},navigator:{onLine:true},localStorage:{setItem:(k,v)=>cache.set(k,v),getItem:k=>cache.get(k)},setTimeout:fn=>{timers.set(fn,fn);return fn;},clearTimeout:id=>timers.delete(id),alert:m=>alerts.push(m),confirm:()=>true,prompt:()=> '确认清除'});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../script-clean.js'),'utf8')+'\nglobalThis.Manager=ScheduleManager;',context);
    const manager=Object.create(context.Manager.prototype);
    Object.assign(manager,{currentStoreId:'a',dbManager:{_currentUser:{uid:'u'}},schedules:[],attendanceFees:[],interviewFees:[],operatingCosts:[],reportRebates:[]});
    manager._setRecordSaveFeedback=(...args)=>feedback.push(args);
    manager.showSuccessMessage=m=>success.push(m);
    manager._renderConfirmedRecords=()=>{};
    manager.validateFormData=()=>true;
    manager.handlePostAddDisplay=()=>{};
    manager.clearForm=()=>fields.scheduleForm.reset();
    manager.updateReportRebateModalState=()=>{};
    manager.closeReportRebateModal=()=>{};
    return {manager,fields,cache,alerts,success,feedback,timers,context};
}

const forms=[['addSchedule','schedules','scheduleForm','clientName'],['addAttendanceFee','attendanceFees','attendanceFeeForm','attendanceFee'],['addInterviewFee','interviewFees','interviewFeeForm','interviewFee'],['addOperatingCost','operatingCosts','operatingCostForm','operatingCostNote'],['addReportRebate','reportRebates','reportRebateForm','reportRebateContent']];
for(const [method,collection,formId,input] of forms) {
    test(`${collection}: delayed acknowledgement prevents premature success and duplicate writes; rejection preserves input, retry succeeds`,async()=>{
        const h=harness(), first=deferred(), calls=[];
        h.manager.dbManager.saveRecord=(...args)=>{calls.push(copy(args));return first.promise;};
        const value=h.fields[input].value;
        const pending=h.manager[method]();
        assert.equal(h.success.length,0); assert.equal(h.manager[collection].length,0);
        assert.equal(h.fields[input].disabled,true);
        await h.manager[method](); assert.equal(calls.length,1);
        first.reject(Object.assign(new Error('quota'),{code:'resource-exhausted'}));
        await pending;
        assert.equal(h.success.length,0); assert.equal(h.manager[collection].length,0);
        assert.equal(h.fields[input].value,value); assert.equal(h.fields[input].disabled,false);
        assert.equal(h.cache.size,0); assert.match(h.feedback.at(-1)[1],/额度受限.*输入内容已保留/);
        const retry=deferred(); h.manager.dbManager.saveRecord=(...args)=>{calls.push(copy(args));return retry.promise;};
        const second=h.manager[method]();
        assert.equal(calls[0][1].id,calls[1][1].id);
        retry.resolve(); await second;
        assert.equal(h.success.length,1); assert.equal(h.manager[collection].length,1);
        assert.equal(JSON.parse(h.cache.get(`store_a_${collection}`)).length,1);
        assert.equal(h.fields[input].value,''); assert.equal(h.timers.size,0);
    });
}

test('failed edits leave the old row intact and preserve a concurrently received different row',async()=>{
    const h=harness(), pending=deferred();
    h.manager.attendanceFees=[{id:'old',date:'2026-11-16',employeeName:'小林',fee:30}];
    h.manager.editingAttendanceFeeId='old';
    h.manager.dbManager.saveRecord=()=>pending.promise;
    const saving=h.manager.addAttendanceFee();
    assert.equal(h.manager.attendanceFees[0].fee,30);
    h.manager.attendanceFees.push({id:'remote',fee:20});
    pending.reject(Object.assign(new Error('denied'),{code:'permission-denied'}));await saving;
    assert.equal(h.manager.attendanceFees[0].fee,30); assert.equal(h.manager.attendanceFees[1].id,'remote');
    assert.equal(h.manager.editingAttendanceFeeId,'old');assert.match(h.feedback.at(-1)[1],/权限/);
});

test('offline save fails visibly, retains the form and never queues a duplicate write',async()=>{
    const h=harness();h.context.navigator.onLine=false;let writes=0;
    h.manager.dbManager.saveRecord=async()=>{writes++;};
    await h.manager.addOperatingCost();assert.equal(writes,0);assert.equal(h.success.length,0);
    assert.equal(h.fields.operatingCostNote.value,'保留备注');assert.match(h.feedback.at(-1)[1],/网络/);
});

test('a store or account change during acknowledgement cannot alter the current store or clear its form',async()=>{
    for(const change of ['store','account']) {
        const h=harness(), pending=deferred();h.manager.dbManager.saveRecord=()=>pending.promise;
        const saving=h.manager.addInterviewFee();
        if(change==='store')h.manager.currentStoreId='b';else h.manager.dbManager._currentUser={uid:'other'};
        h.manager.interviewFees=[{id:'other-store'}];
        pending.resolve(); await saving;
        assert.equal(h.manager.interviewFees[0].id,'other-store');assert.equal(h.manager.interviewFees.length,1);
        assert.equal(h.fields.interviewFee.value,'50');assert.equal(h.success.length,0);assert.equal(h.cache.size,0);
    }
});

test('failed deletes keep rows visible; confirmed batches alone are removed',async()=>{
    const h=harness();h.manager.operatingCosts=[{id:'a'},{id:'b'}];
    h.manager.dbManager.deleteRecords=async(collection,ids,store,onConfirmed)=>{onConfirmed(['a']);throw Object.assign(new Error('quota'),{code:'resource-exhausted',partial:true});};
    await h.manager._deleteDailyRecords('operatingCosts',['a','b'],'done');
    assert.deepEqual(h.manager.operatingCosts.map(x=>x.id),['b']);assert.equal(h.success.length,0);
    assert.match(h.feedback.at(-1)[1],/部分记录已处理/);
    h.manager.dbManager.deleteRecords=async()=>{throw new Error('denied');};
    await h.manager.deleteOperatingCost('b');assert.equal(h.manager.operatingCosts[0].id,'b');
});

function dataHarness(){
    const writes=[],pending=deferred();let reads=0,failBatch=0,batches=0;
    const db={collection:p=>({doc:id=>({path:`${p}/${id}`}),get:()=>{reads++;throw new Error('full scan forbidden');}}),batch:()=>{const batch=[];return {set:(ref,data)=>batch.push({type:'set',path:ref.path,data:copy(data)}),delete:ref=>batch.push({type:'delete',path:ref.path}),commit:async()=>{batches++;if(batches===failBatch)throw new Error('batch failed');writes.push(...batch);}};}};
    const ctx=vm.createContext({console:quiet,structuredClone,firebase:{firestore:()=>db}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../firebase-data-manager.js'),'utf8')+'\nglobalThis.Manager=FirebaseDataManager;',ctx);
    const manager=Object.create(ctx.Manager.prototype);
    Object.assign(manager,{teamId:'shared',_currentUser:{uid:'u'},_commitChain:Promise.resolve()});
    return {manager,writes,pending,get reads(){return reads;},failBatch:n=>failBatch=n};
}

test('all daily collections use exactly the selected-store document, without a baseline read or unrelated deletions',async()=>{
    const h=dataHarness();
    for(const collection of forms.map(x=>x[1])) await h.manager.saveRecord(collection,{id:'only-row',amount:10},'store-b');
    assert.equal(h.reads,0);assert.equal(h.writes.length,5);
    assert.ok(h.writes.every(w=>w.type==='set'&&w.path.startsWith('team/shared/stores/store-b/')&&w.path.endsWith('/only-row')));
});

test('signed-out, read-only and missing-store writes reject instead of silently succeeding',async()=>{
    const h=dataHarness();h.manager._currentUser=null;
    await assert.rejects(h.manager.saveRecord('schedules',{id:'x'},'a'),{code:'unauthenticated'});
    h.manager._currentUser={uid:'u'};h.manager._readOnly=true;
    await assert.rejects(h.manager.saveRecord('schedules',{id:'x'},'a'),{code:'permission-denied'});
    h.manager._readOnly=false;
    await assert.rejects(h.manager.saveRecord('schedules',{id:'x'},''),/店铺/);assert.equal(h.writes.length,0);
});

test('queued records cannot be written under a different account',async()=>{
    const h=dataHarness();h.manager._commitChain=h.pending.promise;
    const saving=h.manager.saveRecord('schedules',{id:'x'},'a');
    h.manager._currentUser={uid:'different'};h.pending.resolve();
    await assert.rejects(saving,{code:'unauthenticated'});assert.equal(h.writes.length,0);
});

test('bulk deletion stops on failure and reports exactly the confirmed 450-record batch',async()=>{
    const h=dataHarness(),confirmed=[];h.failBatch(2);
    await assert.rejects(h.manager.deleteRecords('schedules',Array.from({length:600},(_,i)=>`id-${i}`),'a',ids=>confirmed.push(...ids)),error=>error.partial===true);
    assert.equal(h.writes.length,450);assert.equal(confirmed.length,450);assert.equal(h.reads,0);
});
