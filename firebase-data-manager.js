// 纯 Firebase Firestore 数据管理器
// 替代 IndexedDB + Firebase 双层存储，直接读写 Firestore
// 使用 onSnapshot 实现跨设备实时同步

class FirebaseDataManager {
    constructor() {
        this.teamId = 'shared';
        this.unsubscribers = [];
        this._readyCallbacks = [];
        this._isReady = false;
        this._currentUser = null;
        this._collectionStates = new Map();
        this._commitChain = Promise.resolve();
        this._saveDebounceMs = 250;
        this._jlPriceTableUnsubscribe = null;
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

        const snapshot = await ref.get();
        state.docs = new Map();
        snapshot.forEach(doc => {
            state.docs.set(doc.id, this._stripInternalFields(doc.data()));
        });
        state.ready = true;
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

        state.docs = docs;
        state.ready = true;
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

        try {
            const snapshot = await ref.get();
            const items = [];
            snapshot.forEach(doc => {
                items.push(this._stripInternalFields(doc.data()));
            });
            console.log(`FirebaseDataManager: 从 Firestore 加载了 ${items.length} 条 ${collectionName}`);
            return items;
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

    async saveJlPriceTable(rows) {
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

    subscribeToJlPriceTable(callback) {
        const ref = this._settingsDocRef('jlPriceTable');
        if (!ref || !this._currentUser) {
            console.warn('FirebaseDataManager: Firestore 或用户未就绪，跳过订阅接龙价格表');
            return;
        }

        this.unsubscribeJlPriceTable();

        this._jlPriceTableUnsubscribe = ref.onSnapshot((doc) => {
            const exists = typeof doc.exists === 'function' ? doc.exists() : doc.exists;
            const data = exists ? (doc.data() || {}) : {};
            const rows = Array.isArray(data.rows) ? data.rows : [];

            try {
                callback(rows);
            } catch (error) {
                console.error('FirebaseDataManager: 接龙价格表回调失败:', error);
            }

            console.log(`FirebaseDataManager: onSnapshot jlPriceTable → ${rows.length} 条记录`);
        }, (error) => {
            console.error('FirebaseDataManager: 监听接龙价格表出错:', error);
        });
    }

    // ====== 实时监听 ======
    subscribeToStore(storeId, callbacks) {
        if (!storeId) {
            console.warn('FirebaseDataManager: 无 storeId，跳过订阅');
            return;
        }

        // 先取消旧的订阅
        this.unsubscribeAll();

        const db = this._getFirestore();
        if (!db || !this._currentUser) {
            console.warn('FirebaseDataManager: Firestore 或用户未就绪，跳过订阅');
            return;
        }

        console.log(`FirebaseDataManager: 开始订阅店铺 ${storeId} 的所有集合`);

        const collections = Object.keys(callbacks);
        for (const collectionName of collections) {
            const callback = callbacks[collectionName];
            if (!callback) continue;

            try {
                const ref = this._collectionRef(storeId, collectionName);
                if (!ref) continue;

                const unsubscribe = ref.onSnapshot((snapshot) => {
                    const items = this._updateCollectionStateFromSnapshot(storeId, collectionName, snapshot);

                    // 导入模式下跳过 onSnapshot 回调，防止旧快照覆盖内存数据
                    if (this._importing) {
                        console.log(`FirebaseDataManager: 导入模式，跳过 onSnapshot ${collectionName}`);
                        return;
                    }

                    // salaryTiers 特殊处理：还原对象格式
                    if (collectionName === 'salaryTiers') {
                        if (items.length === 1 && items[0].id === 'salaryTiers' && items[0].data) {
                            callback(items[0].data);
                        } else {
                            callback(items.length > 0 ? items : {});
                        }
                    } else {
                        callback(items);
                    }

                    console.log(`FirebaseDataManager: onSnapshot ${collectionName} → ${items.length} 条记录`);
                }, (error) => {
                    console.error(`FirebaseDataManager: 监听 ${collectionName} 出错:`, error);
                });

                this.unsubscribers.push(unsubscribe);
            } catch (error) {
                console.error(`FirebaseDataManager: 订阅 ${collectionName} 失败:`, error);
            }
        }

        console.log(`FirebaseDataManager: 已订阅 ${collections.length} 个集合`);
    }

    // 取消所有订阅
    unsubscribeAll() {
        this.unsubscribers.forEach(unsub => {
            try { unsub(); } catch (e) {}
        });
        this.unsubscribers = [];
    }

    unsubscribeJlPriceTable() {
        if (this._jlPriceTableUnsubscribe) {
            try { this._jlPriceTableUnsubscribe(); } catch (e) {}
            this._jlPriceTableUnsubscribe = null;
        }
    }
}
