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

        const ref = this._collectionRef(storeId, collectionName);
        if (!ref) return;

        try {
            // 获取现有文档以进行差异更新（删除不再存在的文档）
            const existingSnapshot = await ref.get();
            const existingIds = new Set();
            existingSnapshot.forEach(doc => existingIds.add(doc.id));

            // 处理要保存的项目
            const itemArray = Array.isArray(items) ? items : [];
            const newIds = new Set();

            // Firestore batch 每次最多 500 条操作，需要分批
            const BATCH_LIMIT = 499; // 留一个给可能的删除
            let batchCount = 0;
            let batch = this._getFirestore().batch();

            // 写入/更新所有项目
            for (const item of itemArray) {
                const docId = this._generateDocId(item);
                newIds.add(docId);
                const docRef = ref.doc(docId);
                batch.set(docRef, {
                    ...item,
                    updatedAt: Date.now()
                });
                batchCount++;

                if (batchCount >= BATCH_LIMIT) {
                    await batch.commit();
                    batch = this._getFirestore().batch();
                    batchCount = 0;
                }
            }

            // 删除不再存在的文档
            for (const existingId of existingIds) {
                if (!newIds.has(existingId)) {
                    batch.delete(ref.doc(existingId));
                    batchCount++;

                    if (batchCount >= BATCH_LIMIT) {
                        await batch.commit();
                        batch = this._getFirestore().batch();
                        batchCount = 0;
                    }
                }
            }

            if (batchCount > 0) {
                await batch.commit();
            }

            console.log(`FirebaseDataManager: 已保存 ${itemArray.length} 条 ${collectionName} 到 Firestore`);
        } catch (error) {
            console.error(`FirebaseDataManager: 保存 ${collectionName} 失败:`, error);
            throw error;
        }
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
                const data = doc.data();
                // 移除内部字段
                const { updatedAt, ...item } = data;
                items.push(item);
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
                    // 导入模式下跳过 onSnapshot 回调，防止旧快照覆盖内存数据
                    if (this._importing) {
                        console.log(`FirebaseDataManager: 导入模式，跳过 onSnapshot ${collectionName}`);
                        return;
                    }

                    const items = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        const { updatedAt, ...item } = data;
                        items.push(item);
                    });

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
}
