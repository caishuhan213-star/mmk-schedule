// 纯 Firebase Firestore 数据管理器
// 替代 IndexedDB + Firebase 双层存储，直接读写 Firestore
// 使用 onSnapshot 实现跨设备实时同步

class FirebaseDataManager {
    constructor() {
        this.teamId = 'shared';
        this._storeSubscriptions = new Map();
        this._activeStoreId = null;
        this._inactiveStoreTtlMs = 2 * 60 * 1000;
        this._collectionReads = new Map();
        this._readyCallbacks = [];
        this._isReady = false;
        this._currentUser = null;
        this._collectionStates = new Map();
        this._commitChain = Promise.resolve();
        this._saveDebounceMs = 250;
        this._jlPriceTableUnsubscribe = null;
        this._readOnly = false;
        // 导入模式：true 时 onSnapshot 回调不更新内存数据（防止批量写入时被旧快照覆盖）
        this._importing = false;

        // 监听 Firebase 认证状态
        this._waitForAuth();
    }

    // 开始导入模式（暂停 onSnapshot 对内存的覆盖）
    beginImport() {
        this._importing = true;
    }

    // 结束导入模式（恢复 onSnapshot 正常工作）
    endImport() {
        this._importing = false;
    }

    // 等待 Firebase SDK 和认证就绪
    _waitForAuth() {
        const check = () => {
            // 必须等 Firebase App 初始化完成（firebase.apps.length > 0）后才能调用 firebase.auth()
            if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
                firebase.auth().onAuthStateChanged((user) => {
                    if (this._currentUser?.uid !== user?.uid) {
                        this.unsubscribeAll();
                        this.unsubscribeJlPriceTable();
                        for (const state of this._collectionStates.values()) {
                            clearTimeout(state.timer);
                            state.pendingPayload = null;
                            const error = new Error('登录状态已变化，本次排队保存已取消，请重新登录后保存。');
                            state.waiters.splice(0).forEach(waiter => waiter.reject(error));
                        }
                        this._collectionStates.clear();
                        this._collectionReads.clear();
                        this._isReady = false;
                    }
                    this._currentUser = user;
                    if (user && !this._isReady) {
                        this._isReady = true;
                        console.log('FirebaseDataManager: 用户已登录，数据层就绪', user.email);
                        this._readyCallbacks.forEach(cb => {
                            try { cb(); } catch (e) { console.error('onReady callback error:', e); }
                        });
                    }
                    if (!user) {
                        this._isReady = false;
                        this.unsubscribeAll();
                        this.unsubscribeJlPriceTable();
                    }
                });
            } else {
                setTimeout(check, 500);
            }
        };
        check();
    }

    // 注册就绪回调（Firebase 登录后触发）
    onReady(callback) {
        if (this._isReady) {
            try { callback(); } catch (e) { console.error('onReady callback error:', e); }
        } else {
            this._readyCallbacks.push(callback);
        }
    }

    // 返回 init() 以兼容旧的调用 (this.dbManager.init())
    async init() {
        // 不需要初始化 IndexedDB，Firebase 由 SDK 自动初始化
        return Promise.resolve();
    }

    setReadOnly(readOnly) {
        this._readOnly = !!readOnly;
    }

    // 获取 Firestore 实例
    _getFirestore() {
        if (typeof firebase !== 'undefined' && firebase.firestore) {
            return firebase.firestore();
        }
        return null;
    }

    // 检查是否可以操作 Firestore
    _canOperate() {
        return this._currentUser && this._getFirestore();
    }

    _canWrite(collectionName) {
        if (this._readOnly) {
            console.warn(`FirebaseDataManager: 当前账号为只读模式，跳过写入 ${collectionName}`);
            return false;
        }
        return true;
    }

    // 获取集合引用
    _collectionRef(storeId, collectionName) {
        const db = this._getFirestore();
        if (!db) return null;
        return db.collection(`team/${this.teamId}/stores/${storeId}/${collectionName}`);
    }

    _collectionKey(storeId, collectionName) {
        return `${storeId || 'default'}::${collectionName}`;
    }

    _settingsDocRef(docId) {
        const db = this._getFirestore();
        if (!db) return null;
        return db.collection(`team/${this.teamId}/settings`).doc(docId);
    }

    _getCollectionState(storeId, collectionName) {
        const key = this._collectionKey(storeId, collectionName);
        if (!this._collectionStates.has(key)) {
            this._collectionStates.set(key, {
                docs: new Map(),
                ready: false,
                saving: false,
                timer: null,
                pendingPayload: null,
                waiters: [],
                priming: null,
                revision: 0,
            });
        }
        return this._collectionStates.get(key);
    }

    _stripInternalFields(data) {
        const { updatedAt, syncedAt, userId, storeId, ...item } = data || {};
        return item;
    }

    _stableStringify(value) {
        if (value === null || typeof value !== 'object') {
            return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
            return `[${value.map(item => this._stableStringify(item)).join(',')}]`;
        }
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${this._stableStringify(value[key])}`).join(',')}}`;
    }

    async _primeCollectionState(ref, state) {
        if (state.ready) return;
        if (!state.priming) {
            const revision = state.revision;
            state.priming = (async () => {
                const snapshot = await ref.get({ source: 'server' });
                // A newer listener result is already the authoritative baseline.
                if (state.revision !== revision && state.ready) return;
                state.docs = new Map();
                snapshot.forEach(doc => {
                    state.docs.set(doc.id, this._stripInternalFields(doc.data()));
                });
                state.ready = true;
                state.revision++;
            })().finally(() => { state.priming = null; });
        }
        return state.priming;
    }

    _updateCollectionStateFromSnapshot(storeId, collectionName, snapshot) {
        const state = this._getCollectionState(storeId, collectionName);
        const docs = new Map();
        const items = [];

        snapshot.forEach(doc => {
            const item = this._stripInternalFields(doc.data());
            docs.set(doc.id, item);
            items.push(item);
        });

        // Partial/offline cache results must never be used as a bulk-write
        // baseline, or trigger migration of stale local records into the cloud.
        if (!snapshot.metadata?.fromCache && !snapshot.metadata?.hasPendingWrites) {
            state.docs = docs;
            state.ready = true;
            state.revision++;
        } else if (snapshot.metadata?.fromCache) {
            state.ready = false;
        }
        return items;
    }

    async _commitOperations(operations) {
        if (operations.length === 0) return;

        const db = this._getFirestore();
        const BATCH_LIMIT = 450;

        for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
            const batch = db.batch();
            operations.slice(i, i + BATCH_LIMIT).forEach(operation => {
                if (operation.type === 'set') {
                    batch.set(operation.ref, operation.data);
                } else {
                    batch.delete(operation.ref);
                }
            });
            await batch.commit();
        }
    }

    _queueCommitTask(task) {
        const run = this._commitChain.then(task, task);
        this._commitChain = run.catch(() => {});
        return run;
    }

    _scheduleCollectionSave(collectionName, storeId, payload) {
        const state = this._getCollectionState(storeId, collectionName);

        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }

        state.pendingPayload = payload;

        const promise = new Promise((resolve, reject) => {
            state.waiters.push({ resolve, reject });
        });

        state.timer = setTimeout(() => {
            state.timer = null;
            this._flushCollectionSave(collectionName, storeId).catch(error => {
                console.error(`FirebaseDataManager: 刷新 ${collectionName} 保存队列失败:`, error);
            });
        }, this._saveDebounceMs);

        return promise;
    }

    async _setDocument(collectionName, item, storeId) {
        if (!this._canWrite(collectionName)) return;

        if (!this._canOperate()) {
            console.warn(`FirebaseDataManager: 未登录，跳过保存 ${collectionName} 单条记录`);
            return;
        }

        const ref = this._collectionRef(storeId, collectionName);
        if (!ref) return;

        const docId = this._generateDocId(item);
        const cleanItem = {
            ...item,
            id: item.id || docId,
        };
        const state = this._getCollectionState(storeId, collectionName);

        if (state.pendingPayload) {
            state.pendingPayload.set(docId, cleanItem);
            return this._scheduleCollectionSave(collectionName, storeId, state.pendingPayload);
        }

        if (state.ready && this._stableStringify(state.docs.get(docId)) === this._stableStringify(cleanItem)) {
            return;
        }

        await this._queueCommitTask(() => this._commitOperations([{
            type: 'set',
            ref: ref.doc(docId),
            data: {
                ...cleanItem,
                updatedAt: Date.now(),
            },
        }]));

        if (state.ready) {
            state.docs.set(docId, cleanItem);
        }

        console.log(`FirebaseDataManager: 已保存 ${collectionName}/${docId}`);
    }

    async _setDocuments(collectionName, items, storeId) {
        if (!this._canWrite(collectionName)) return;

        if (!this._canOperate()) {
            console.warn(`FirebaseDataManager: 未登录，跳过保存 ${collectionName} 多条记录`);
            return;
        }

        const ref = this._collectionRef(storeId, collectionName);
        if (!ref) return;

        const itemArray = Array.isArray(items) ? items : [];
        if (itemArray.length === 0) return;

        const state = this._getCollectionState(storeId, collectionName);

        if (state.pendingPayload) {
            itemArray.forEach(item => {
                const docId = this._generateDocId(item);
                state.pendingPayload.set(docId, {
                    ...item,
                    id: item.id || docId,
                });
            });
            return this._scheduleCollectionSave(collectionName, storeId, state.pendingPayload);
        }

        const now = Date.now();
        const cleanItems = [];
        const operations = [];

        itemArray.forEach(item => {
            const docId = this._generateDocId(item);
            const cleanItem = {
                ...item,
                id: item.id || docId,
            };

            cleanItems.push([docId, cleanItem]);

            if (!state.ready || this._stableStringify(state.docs.get(docId)) !== this._stableStringify(cleanItem)) {
                operations.push({
                    type: 'set',
                    ref: ref.doc(docId),
                    data: {
                        ...cleanItem,
                        updatedAt: now,
                    },
                });
            }
        });

        await this._queueCommitTask(() => this._commitOperations(operations));

        if (state.ready) {
            cleanItems.forEach(([docId, cleanItem]) => state.docs.set(docId, cleanItem));
        }

        console.log(`FirebaseDataManager: 已保存 ${collectionName} ${operations.length} 条变更`);
    }

    async _deleteDocument(collectionName, docId, storeId) {
        if (!this._canWrite(collectionName)) return;

        if (!this._canOperate()) {
            console.warn(`FirebaseDataManager: 未登录，跳过删除 ${collectionName} 单条记录`);
            return;
        }

        const ref = this._collectionRef(storeId, collectionName);
        if (!ref || !docId) return;

        const state = this._getCollectionState(storeId, collectionName);

        if (state.pendingPayload) {
            state.pendingPayload.delete(String(docId));
            return this._scheduleCollectionSave(collectionName, storeId, state.pendingPayload);
        }

        if (state.ready && !state.docs.has(String(docId))) {
            return;
        }

        await this._queueCommitTask(() => this._commitOperations([{
            type: 'delete',
            ref: ref.doc(String(docId)),
        }]));

        if (state.ready) {
            state.docs.delete(String(docId));
        }

        console.log(`FirebaseDataManager: 已删除 ${collectionName}/${docId}`);
    }

    async _flushCollectionSave(collectionName, storeId) {
        if (!this._canWrite(collectionName)) return;

        const state = this._getCollectionState(storeId, collectionName);
        if (state.saving || !state.pendingPayload) return;

        const payload = state.pendingPayload;
        const waiters = state.waiters.splice(0);
        state.pendingPayload = null;
        state.saving = true;

        try {
            const ref = this._collectionRef(storeId, collectionName);
            if (!ref) {
                throw new Error(`Firestore 集合不可用: ${collectionName}`);
            }

            await this._primeCollectionState(ref, state);

            const now = Date.now();
            const operations = [];

            payload.forEach((item, docId) => {
                const existing = state.docs.get(docId);
                if (this._stableStringify(existing) !== this._stableStringify(item)) {
                    operations.push({
                        type: 'set',
                        ref: ref.doc(docId),
                        data: {
                            ...item,
                            updatedAt: now,
                        },
                    });
                }
            });

            state.docs.forEach((_, existingId) => {
                if (!payload.has(existingId)) {
                    operations.push({
                        type: 'delete',
                        ref: ref.doc(existingId),
                    });
                }
            });

            await this._queueCommitTask(() => this._commitOperations(operations));
            state.docs = new Map(payload);
            state.ready = true;

            console.log(`FirebaseDataManager: ${collectionName} 保存完成，写入/删除 ${operations.length} 项`);
            waiters.forEach(({ resolve }) => resolve());
        } catch (error) {
            waiters.forEach(({ reject }) => reject(error));
            throw error;
        } finally {
            state.saving = false;
            if (state.pendingPayload) {
                this._flushCollectionSave(collectionName, storeId).catch(error => {
                    console.error(`FirebaseDataManager: 继续刷新 ${collectionName} 保存队列失败:`, error);
                });
            }
        }
    }

    // 生成文档 ID
    _generateDocId(item) {
        if (item.id) return String(item.id);
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // ====== 通用 save 方法 ======
    async _saveCollection(collectionName, items, storeId) {
        if (!this._canWrite(collectionName)) return;

        if (!this._canOperate()) {
            console.warn(`FirebaseDataManager: 未登录，跳过保存 ${collectionName}`);
            return;
        }

        const itemArray = Array.isArray(items) ? items : [];
        const payload = new Map();

        itemArray.forEach(item => {
            const docId = this._generateDocId(item);
            payload.set(docId, {
                ...item,
                id: item.id || docId,
            });
        });

        return this._scheduleCollectionSave(collectionName, storeId, payload);
    }

    // ====== 通用 load 方法 ======
    async _loadCollection(collectionName, storeId) {
        if (!this._canOperate()) {
            console.warn(`FirebaseDataManager: 未登录，跳过加载 ${collectionName}`);
            return [];
        }

        const ref = this._collectionRef(storeId, collectionName);
        if (!ref) return [];

        const state = this._getCollectionState(storeId, collectionName);
        const session = this._storeSubscriptions.get(storeId);
        if (state.ready && session?.listeners.has(collectionName)) {
            return this._copyCollectionItems([...state.docs.values()]);
        }
        const key = this._collectionKey(storeId, collectionName);

        try {
            if (!this._collectionReads.has(key)) {
                const request = ref.get().then(snapshot => {
                    const items = [];
                    snapshot.forEach(doc => items.push(this._stripInternalFields(doc.data())));
                    return items;
                }).finally(() => {
                    if (this._collectionReads.get(key) === request) this._collectionReads.delete(key);
                });
                this._collectionReads.set(key, request);
            }
            const items = await this._collectionReads.get(key);
            console.log(`FirebaseDataManager: 从 Firestore 加载了 ${items.length} 条 ${collectionName}`);
            return this._copyCollectionItems(items);
        } catch (error) {
            console.error(`FirebaseDataManager: 加载 ${collectionName} 失败:`, error);
            return [];
        }
    }

    // ====== 各集合的 save 方法 ======
    async saveSchedules(schedules, storeId) {
        return this._saveCollection('schedules', schedules, storeId);
    }

    async addSchedule(schedule, storeId) {
        return this._setDocument('schedules', schedule, storeId);
    }

    async updateSchedule(schedule, storeId) {
        return this._setDocument('schedules', schedule, storeId);
    }

    async updateSchedules(schedules, storeId) {
        return this._setDocuments('schedules', schedules, storeId);
    }

    async deleteSchedule(scheduleId, storeId) {
        return this._deleteDocument('schedules', scheduleId, storeId);
    }

    async saveEmployees(employees, storeId) {
        return this._saveCollection('employees', employees, storeId);
    }

    async saveProjects(projects, storeId) {
        return this._saveCollection('projects', projects, storeId);
    }

    async saveAttendanceFees(fees, storeId) {
        return this._saveCollection('attendanceFees', fees, storeId);
    }

    async saveInterviewFees(fees, storeId) {
        return this._saveCollection('interviewFees', fees, storeId);
    }

    async saveOperatingCosts(costs, storeId) {
        return this._saveCollection('operatingCosts', costs, storeId);
    }

    async saveReportRebates(rebates, storeId) {
        return this._saveCollection('reportRebates', rebates, storeId);
    }

    async saveSalaryTiers(tiers, storeId) {
        // salaryTiers 是对象不是数组，包装为单条记录
        const items = Array.isArray(tiers) ? tiers : [{ id: 'salaryTiers', data: tiers }];
        return this._saveCollection('salaryTiers', items, storeId);
    }

    // ====== 各集合的 load 方法 ======
    async loadSchedules(storeId) {
        return this._loadCollection('schedules', storeId);
    }

    async loadEmployees(storeId) {
        return this._loadCollection('employees', storeId);
    }

    async loadProjects(storeId) {
        return this._loadCollection('projects', storeId);
    }

    async loadAttendanceFees(storeId) {
        return this._loadCollection('attendanceFees', storeId);
    }

    async loadInterviewFees(storeId) {
        return this._loadCollection('interviewFees', storeId);
    }

    async loadOperatingCosts(storeId) {
        return this._loadCollection('operatingCosts', storeId);
    }

    async loadReportRebates(storeId) {
        return this._loadCollection('reportRebates', storeId);
    }

    async loadSalaryTiers(storeId) {
        const items = await this._loadCollection('salaryTiers', storeId);
        // 还原包装过的对象格式
        if (items.length === 1 && items[0].id === 'salaryTiers' && items[0].data) {
            return items[0].data;
        }
        return items.length > 0 ? items : {};
    }

    async saveJlPriceTable(rows, options = {}) {
        // Compare against the version the editor saw. A transaction also keeps
        // profile edits and name/price changes together when both are supplied.
        if (options.expectedRows) {
            if (!this._canOperate() || !this._canWrite('jlPriceTable')) throw new Error('请登录后再保存');
            const ref = this._settingsDocRef('jlPriceTable');
            return this._getFirestore().runTransaction(async transaction => {
                const doc = await transaction.get(ref);
                const actual = EmployeeRoster.normalize(doc.exists ? (doc.data().rows || []) : []);
                const expected = EmployeeRoster.normalize(options.expectedRows);
                if (this._stableStringify(actual) !== this._stableStringify(expected)) {
                    const error = new Error('价格表已在其他设备更新，请查看最新内容后重新保存。');
                    error.latestRows = actual;
                    throw error;
                }
                transaction.set(ref, { rows, updatedAt: Date.now(), userId: this._currentUser.uid }, { merge: true });
                if (options.profile) {
                    const profileRef = this._collectionRef(options.storeId, 'employees').doc(String(options.profile.id));
                    transaction.set(profileRef, options.profile, { merge: true });
                }
            });
        }
        if (!this._canWrite('jlPriceTable')) return;

        if (!this._canOperate()) {
            console.warn('FirebaseDataManager: 未登录，跳过保存接龙价格表');
            return;
        }

        const ref = this._settingsDocRef('jlPriceTable');
        if (!ref) return;

        const cleanRows = Array.isArray(rows) ? rows : [];
        await ref.set({
            rows: cleanRows,
            updatedAt: Date.now(),
            userId: this._currentUser ? this._currentUser.uid : null,
        }, { merge: true });

        console.log(`FirebaseDataManager: 已保存接龙价格表 ${cleanRows.length} 条`);
    }

    async loadJlPriceTable() {
        if (!this._canOperate()) {
            console.warn('FirebaseDataManager: 未登录，跳过加载接龙价格表');
            return [];
        }

        const ref = this._settingsDocRef('jlPriceTable');
        if (!ref) return [];

        try {
            const doc = await ref.get();
            const exists = typeof doc.exists === 'function' ? doc.exists() : doc.exists;
            if (!exists) return [];
            const data = doc.data() || {};
            const rows = Array.isArray(data.rows) ? data.rows : [];
            console.log(`FirebaseDataManager: 从 Firestore 加载了 ${rows.length} 条接龙价格表`);
            return rows;
        } catch (error) {
            console.error('FirebaseDataManager: 加载接龙价格表失败:', error);
            return [];
        }
    }

    subscribeToJlPriceTable(callback, onError) {
        const ref = this._settingsDocRef('jlPriceTable');
        if (!ref || !this._currentUser) {
            console.warn('FirebaseDataManager: Firestore 或用户未就绪，跳过订阅接龙价格表');
            return;
        }

        this.unsubscribeJlPriceTable();

        this._jlPriceTableUnsubscribe = ref.onSnapshot({ includeMetadataChanges: true }, (doc) => {
            const exists = typeof doc.exists === 'function' ? doc.exists() : doc.exists;
            const data = exists ? (doc.data() || {}) : {};
            const rows = Array.isArray(data.rows) ? data.rows : [];

            try {
                callback(rows, { exists, fromCache: doc.metadata.fromCache, pending: doc.metadata.hasPendingWrites });
            } catch (error) {
                console.error('FirebaseDataManager: 接龙价格表回调失败:', error);
            }

            console.log(`FirebaseDataManager: onSnapshot jlPriceTable → ${rows.length} 条记录`);
        }, (error) => {
            console.error('FirebaseDataManager: 监听接龙价格表出错:', error);
            if (onError) onError(error);
        });
    }

    // ====== 实时监听 ======
    _copyCollectionItems(items) {
        // View code may edit records in place. Never expose the diff baseline.
        return typeof structuredClone === 'function' ? structuredClone(items) : JSON.parse(JSON.stringify(items));
    }

    _deliverStoreSnapshot(storeId, session, collectionName) {
        if (this._storeSubscriptions.get(storeId) !== session || this._activeStoreId !== storeId
            || session.uid !== this._currentUser?.uid || this._importing) return;
        const snapshot = session.snapshots.get(collectionName);
        const callback = session.callbacks[collectionName];
        if (!snapshot || !callback || snapshot.metadata.pending) return;
        // Keep existing UI/cache during offline/partial snapshots. Employees
        // still receive metadata so their cloud-save readiness can be disabled.
        if (snapshot.metadata.fromCache && collectionName !== 'employees') return;
        const items = this._copyCollectionItems(snapshot.items);
        const data = collectionName === 'salaryTiers'
            ? (items.length === 1 && items[0].id === 'salaryTiers' && items[0].data ? items[0].data : items.length ? items : {})
            : items;
        try { callback(data, { ...snapshot.metadata }); }
        catch (error) { console.error(`FirebaseDataManager: ${collectionName} 回调失败:`, error); }
    }

    _closeStoreSubscription(storeId) {
        const session = this._storeSubscriptions.get(storeId);
        if (!session) return;
        this._storeSubscriptions.delete(storeId); // invalidate queued callbacks first
        clearTimeout(session.timer);
        for (const [name, unsubscribe] of session.listeners) {
            try { unsubscribe(); } catch (_) {}
            this._getCollectionState(storeId, name).ready = false;
        }
    }

    subscribeToStore(storeId, callbacks) {
        if (!storeId) {
            console.warn('FirebaseDataManager: 无 storeId，跳过订阅');
            return;
        }

        const db = this._getFirestore();
        if (!db || !this._currentUser) {
            console.warn('FirebaseDataManager: Firestore 或用户未就绪，跳过订阅');
            return;
        }

        const previousId = this._activeStoreId;
        const previous = this._storeSubscriptions.get(previousId);
        if (previous && previousId !== storeId) {
            clearTimeout(previous.timer);
            previous.timer = setTimeout(() => {
                if (this._activeStoreId !== previousId) this._closeStoreSubscription(previousId);
            }, this._inactiveStoreTtlMs);
        }
        this._activeStoreId = storeId;
        let session = this._storeSubscriptions.get(storeId);
        if (session && session.uid !== this._currentUser.uid) {
            this._closeStoreSubscription(storeId);
            session = null;
        }
        if (!session) session = { uid: this._currentUser.uid, callbacks, listeners: new Map(), snapshots: new Map(), timer: null };
        clearTimeout(session.timer);
        session.timer = null;
        session.callbacks = callbacks;
        this._storeSubscriptions.delete(storeId);
        this._storeSubscriptions.set(storeId, session);
        // At most the active store plus one recently visited store stays warm.
        while (this._storeSubscriptions.size > 2) this._closeStoreSubscription(this._storeSubscriptions.keys().next().value);

        for (const [name, unsubscribe] of session.listeners) {
            if (!callbacks[name]) {
                unsubscribe(); session.listeners.delete(name); session.snapshots.delete(name);
                this._getCollectionState(storeId, name).ready = false;
            }
        }

        const collections = Object.keys(callbacks);
        for (const collectionName of collections) {
            const callback = callbacks[collectionName];
            if (!callback) continue;
            if (session.listeners.has(collectionName)) {
                this._deliverStoreSnapshot(storeId, session, collectionName);
                continue;
            }

            try {
                const ref = this._collectionRef(storeId, collectionName);
                if (!ref) continue;

                let listening = true;
                const unsubscribe = ref.onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
                    if (!listening || this._storeSubscriptions.get(storeId) !== session) return;
                    const items = this._updateCollectionStateFromSnapshot(storeId, collectionName, snapshot);
                    session.snapshots.set(collectionName, { items, metadata: {
                        fromCache: snapshot.metadata.fromCache, pending: snapshot.metadata.hasPendingWrites
                    } });
                    this._deliverStoreSnapshot(storeId, session, collectionName);

                    console.log(`FirebaseDataManager: onSnapshot ${collectionName} → ${items.length} 条记录`);
                }, (error) => {
                    if (!listening || this._storeSubscriptions.get(storeId) !== session) return;
                    listening = false;
                    session.listeners.delete(collectionName);
                    session.snapshots.delete(collectionName);
                    this._getCollectionState(storeId, collectionName).ready = false;
                    console.error(`FirebaseDataManager: 监听 ${collectionName} 出错:`, error);
                });

                if (listening) session.listeners.set(collectionName, () => { listening = false; unsubscribe(); });
                else unsubscribe();
            } catch (error) {
                console.error(`FirebaseDataManager: 订阅 ${collectionName} 失败:`, error);
            }
        }

        console.log(`FirebaseDataManager: 已订阅 ${collections.length} 个集合`);
    }

    // 取消所有订阅
    unsubscribeAll() {
        for (const storeId of this._storeSubscriptions.keys()) this._closeStoreSubscription(storeId);
        this._activeStoreId = null;
    }

    unsubscribeJlPriceTable() {
        if (this._jlPriceTableUnsubscribe) {
            try { this._jlPriceTableUnsubscribe(); } catch (e) {}
            this._jlPriceTableUnsubscribe = null;
        }
    }
}
