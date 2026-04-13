// IndexedDBManagerWithFirebase - 增强版IndexedDB管理器，支持Firebase同步
// 继承自IndexedDBManager，重写关键方法以添加云端同步

class IndexedDBManagerWithFirebase extends IndexedDBManager {
    constructor() {
        super();
        console.log('IndexedDBManagerWithFirebase 初始化');
        
        // 使用全局Firebase管理器实例
        this.firebaseManager = window.firebaseManager;
        if (!this.firebaseManager) {
            console.warn('⚠️ 全局firebaseManager未找到，将创建新实例');
            this.firebaseManager = new FirebaseManager();
            window.firebaseManager = this.firebaseManager;
        }
        
        // 同步设置 - 初始禁用，等待用户登录
        this.syncEnabled = false;
        this.syncQueue = [];
        this.isSyncing = false;
        this.realtimeListeners = new Map(); // 存储实时监听器
        this.syncInterval = null;
        
        // 监听登录状态变化
        this.setupAuthStateListener();
    }
    
    // 设置认证状态监听器
    setupAuthStateListener() {
        // 检查firebaseManager是否就绪
        if (!this.firebaseManager) {
            console.warn('firebaseManager未就绪，延迟设置认证监听器');
            setTimeout(() => this.setupAuthStateListener(), 2000);
            return;
        }
        
        console.log('设置认证状态监听器');
        
        // 初始检查
        this.checkAuthState();
        
        // 定期检查认证状态（因为Firebase的onAuthStateChanged可能不会触发自定义事件）
        this.authCheckInterval = setInterval(() => {
            this.checkAuthState();
        }, 5000);
    }
    
    // 检查认证状态
    checkAuthState() {
        if (!this.firebaseManager) return;
        
        const status = this.firebaseManager.getSyncStatus();
        const isAuthenticated = status.authenticated;
        
        if (isAuthenticated && !this.syncEnabled) {
            // 用户已登录，启用同步
            console.log('✅ 用户已登录，启用Firebase同步');
            this.syncEnabled = true;
            this.startSyncInterval();
            this.startRealtimeListeners();
        } else if (!isAuthenticated && this.syncEnabled) {
            // 用户已登出，禁用同步
            console.log('🔴 用户已登出，禁用Firebase同步');
            this.syncEnabled = false;
            this.stopSyncInterval();
            this.stopRealtimeListeners();
        }
    }
    
    // 停止定时同步
    stopSyncInterval() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('已停止定时同步');
        }
    }
    
    // 停止实时监听
    stopRealtimeListeners() {
        this.realtimeListeners.forEach((unsubscribe, key) => {
            try {
                unsubscribe();
                console.log(`已停止监听: ${key}`);
            } catch (error) {
                console.error(`停止监听${key}失败:`, error);
            }
        });
        this.realtimeListeners.clear();
    }
    
    // 启动定时同步
    startSyncInterval() {
        // 如果已经启动，则不再启动
        if (this.syncInterval) {
            console.log('定时同步已启动，跳过');
            return;
        }
        
        console.log('启动定时同步（每60秒检查一次）');
        // 每60秒检查一次同步
        this.syncInterval = setInterval(() => {
            if (this.syncEnabled && this.syncQueue.length > 0 && !this.isSyncing) {
                this.processSyncQueue();
            }
        }, 60000);
    }
    
    // ======================
    // 重写保存方法以添加同步
    // ======================
    
    async saveSchedules(schedules, storeId) {
        // 调用父类方法保存到本地
        const result = await super.saveSchedules(schedules, storeId);
        
        // 添加到同步队列
        if (this.syncEnabled && schedules.length > 0) {
            this.addToSyncQueue('schedules', schedules, storeId);
        }
        
        return result;
    }
    
    async saveOperatingCosts(costs, storeId) {
        const result = await super.saveOperatingCosts(costs, storeId);
        
        if (this.syncEnabled && costs.length > 0) {
            this.addToSyncQueue('operatingCosts', costs, storeId);
        }
        
        return result;
    }
    
    async saveAttendanceFees(fees, storeId) {
        const result = await super.saveAttendanceFees(fees, storeId);
        
        if (this.syncEnabled && fees.length > 0) {
            this.addToSyncQueue('attendanceFees', fees, storeId);
        }
        
        return result;
    }
    
    async saveEmployees(employees, storeId) {
        const result = await super.saveEmployees(employees, storeId);

        if (this.syncEnabled && employees.length > 0) {
            this.addToSyncQueue('employees', employees, storeId);
        }

        return result;
    }

    async saveProjects(projects, storeId) {
        const result = await super.saveProjects(projects, storeId);
        if (this.syncEnabled && projects.length > 0) {
            this.addToSyncQueue('projects', projects, storeId);
        }
        return result;
    }

    async saveInterviewFees(fees, storeId) {
        const result = await super.saveInterviewFees(fees, storeId);
        if (this.syncEnabled && fees.length > 0) {
            this.addToSyncQueue('interviewFees', fees, storeId);
        }
        return result;
    }

    async saveReportRebates(rebates, storeId) {
        const result = await super.saveReportRebates(rebates, storeId);
        if (this.syncEnabled && rebates.length > 0) {
            this.addToSyncQueue('reportRebates', rebates, storeId);
        }
        return result;
    }

    async saveSalaryTiers(tiers, storeId) {
        const result = await super.saveSalaryTiers(tiers, storeId);
        if (this.syncEnabled) {
            const items = Array.isArray(tiers) ? tiers : [{ id: 'salaryTiers', data: tiers }];
            this.addToSyncQueue('salaryTiers', items, storeId);
        }
        return result;
    }

    async saveCommissionConfigs(configs, storeId) {
        const result = await super.saveCommissionConfigs(configs, storeId);
        if (this.syncEnabled && configs.length > 0) {
            this.addToSyncQueue('commissionConfigs', configs, storeId);
        }
        return result;
    }
    
    // ======================
    // 重写加载方法以尝试从云端更新
    // ======================
    
    async loadSchedules(storeId) {
        return await this.loadFromCloud('schedules', storeId, super.loadSchedules.bind(this));
    }
    
    async loadOperatingCosts(storeId) {
        return await this.loadFromCloud('operatingCosts', storeId, super.loadOperatingCosts.bind(this));
    }
    
    async loadAttendanceFees(storeId) {
        return await this.loadFromCloud('attendanceFees', storeId, super.loadAttendanceFees.bind(this));
    }
    
    async loadEmployees(storeId) {
        return await this.loadFromCloud('employees', storeId, super.loadEmployees.bind(this));
    }

    async loadProjects(storeId) {
        return await this.loadFromCloud('projects', storeId, super.loadProjects.bind(this));
    }

    async loadInterviewFees(storeId) {
        return await this.loadFromCloud('interviewFees', storeId, super.loadInterviewFees.bind(this));
    }

    async loadReportRebates(storeId) {
        return await this.loadFromCloud('reportRebates', storeId, super.loadReportRebates.bind(this));
    }

    async loadCommissionConfigs(storeId) {
        return await this.loadFromCloud('commissionConfigs', storeId, super.loadCommissionConfigs.bind(this));
    }

    async loadSalaryTiers(storeId) {
        // salaryTiers 可能是对象不是数组，需要特殊处理
        const localData = await super.loadSalaryTiers(storeId);
        if (!this.syncEnabled || !this.firebaseManager || this.firebaseManager.syncStatus !== 'ready') {
            return localData;
        }
        try {
            const cloudData = await this.firebaseManager.loadCollection('salaryTiers', storeId);
            if (cloudData && cloudData.length > 0) {
                const wrapper = cloudData.find(d => d.id === 'salaryTiers');
                if (wrapper && wrapper.data) {
                    console.log('从云端加载薪资档位数据');
                    await super.saveSalaryTiers(wrapper.data, storeId);
                    return wrapper.data;
                }
            }
        } catch (error) {
            console.error('从云端加载薪资档位失败:', error);
        }
        return localData;
    }
    
    // 通用云加载方法
    async loadFromCloud(collectionName, storeId, localLoader) {
        // 先从本地加载
        const localData = await localLoader(storeId);
        
        // 如果Firebase就绪，尝试从云端加载更新
        if (this.syncEnabled && this.firebaseManager.syncStatus === 'ready') {
            try {
                // 使用通用加载方法或特定方法
                let cloudData = null;
                if (this.firebaseManager.loadCollection) {
                    cloudData = await this.firebaseManager.loadCollection(collectionName, storeId);
                } else if (collectionName === 'schedules' && this.firebaseManager.loadSchedules) {
                    cloudData = await this.firebaseManager.loadSchedules(storeId);
                }
                
                if (cloudData && cloudData.length > 0) {
                    console.log(`从云端加载到 ${cloudData.length} 条${collectionName}记录`);

                    // commissionConfigs 使用复合键，其他使用 id
                    const idField = collectionName === 'commissionConfigs' ? null : 'id';
                    const merged = idField
                        ? this.mergeData(localData, cloudData, idField)
                        : this.mergeDataByCompositeKey(localData, cloudData, ['employeeName', 'projectName']);
                    
                    // 如果有变化，更新本地
                    if (merged.length !== localData.length || JSON.stringify(merged) !== JSON.stringify(localData)) {
                        console.log(`${collectionName}数据有变化，更新本地存储`);
                        
                        // 调用对应的保存方法更新本地
                        const saveMethodMap = {
                            'schedules': super.saveSchedules.bind(this),
                            'operatingCosts': super.saveOperatingCosts.bind(this),
                            'attendanceFees': super.saveAttendanceFees.bind(this),
                            'employees': super.saveEmployees.bind(this),
                            'projects': super.saveProjects.bind(this),
                            'interviewFees': super.saveInterviewFees.bind(this),
                            'reportRebates': super.saveReportRebates.bind(this),
                            'salaryTiers': super.saveSalaryTiers.bind(this),
                            'commissionConfigs': super.saveCommissionConfigs.bind(this)
                        };
                        
                        if (saveMethodMap[collectionName]) {
                            await saveMethodMap[collectionName](merged, storeId);
                        }
                        
                        return merged;
                    }
                }
            } catch (error) {
                console.error(`从云端加载${collectionName}数据失败:`, error);
            }
        }
        
        return localData;
    }
    
    // ======================
    // 同步管理
    // ======================
    
    addToSyncQueue(collectionName, dataArray, storeId = 'default') {
        this.syncQueue.push({
            collection: collectionName,
            data: dataArray,
            storeId: storeId,
            timestamp: Date.now()
        });
        
        console.log(`添加到同步队列: ${collectionName} (${dataArray.length}条)`);
        
        // 如果队列较小，立即处理
        if (this.syncQueue.length < 3) {
            this.processSyncQueue();
        }
    }
    
    async processSyncQueue() {
        if (this.isSyncing || this.syncQueue.length === 0) {
            return;
        }
        
        this.isSyncing = true;
        
        try {
            const item = this.syncQueue[0]; // 处理第一个
            
            console.log(`处理同步: ${item.collection} (${item.data.length}条)`);
            
            let success = false;
            
            // 使用通用同步方法处理所有集合类型
            if (this.firebaseManager.syncCollection) {
                // 使用新的通用方法
                success = await this.firebaseManager.syncCollection(item.collection, item.data, item.storeId);
            } else if (item.collection === 'schedules' && this.firebaseManager.syncSchedules) {
                // 向后兼容：如果只有旧的syncSchedules方法
                success = await this.firebaseManager.syncSchedules(item.data, item.storeId);
            }
            // 其他集合类型会自动使用通用方法
            
            if (success) {
                // 移除已同步的项
                this.syncQueue.shift();
                console.log(`✅ ${item.collection}同步成功`);
                
                // 继续处理下一个
                setTimeout(() => {
                    this.isSyncing = false;
                    if (this.syncQueue.length > 0) {
                        this.processSyncQueue();
                    }
                }, 1000);
            } else {
                console.warn(`⚠️ ${item.collection}同步失败，稍后重试`);
                this.isSyncing = false;
            }
        } catch (error) {
            console.error('❌ 同步处理出错:', error);
            this.isSyncing = false;
        }
    }
    
    // ======================
    // 工具方法
    // ======================
    
    mergeData(localArray, cloudArray, idField = 'id') {
        const map = new Map();

        // 先添加本地数据
        localArray.forEach(item => {
            map.set(item[idField], item);
        });

        // 用云端数据覆盖（云端优先）
        cloudArray.forEach(item => {
            map.set(item[idField], item);
        });

        return Array.from(map.values());
    }

    // 复合键合并方法
    mergeDataByCompositeKey(localArray, cloudArray, keyFields) {
        const map = new Map();
        const makeKey = (item) => keyFields.map(f => item[f] || '').join('|');

        localArray.forEach(item => {
            map.set(makeKey(item), item);
        });

        cloudArray.forEach(item => {
            map.set(makeKey(item), item);
        });

        return Array.from(map.values());
    }
    
    // 获取同步状态
    getSyncStatus() {
        return {
            syncEnabled: this.syncEnabled,
            queueSize: this.syncQueue.length,
            isSyncing: this.isSyncing,
            firebaseStatus: this.firebaseManager.getSyncStatus()
        };
    }
    
    // 手动触发同步
    async triggerSync() {
        console.log('手动触发同步');
        return this.processSyncQueue();
    }
    
    // ======================
    // 实时同步监听
    // ======================
    
    // 启动实时监听器
    startRealtimeListeners(storeId = 'default') {
        if (!this.syncEnabled || !this.firebaseManager || this.firebaseManager.syncStatus !== 'ready') {
            console.log('Firebase未就绪，延迟启动实时监听');
            setTimeout(() => this.startRealtimeListeners(storeId), 5000);
            return;
        }
        
        console.log('🚀 启动Firebase实时监听器');
        
        // 监听排班数据变化
        this.setupRealtimeListener('schedules', storeId, (changes) => {
            console.log('📡 收到排班数据实时更新:', changes.length, '条变化');
            this.handleRealtimeChanges('schedules', changes, storeId);
        });
        
        // 监听员工数据变化
        this.setupRealtimeListener('employees', storeId, (changes) => {
            console.log('📡 收到员工数据实时更新:', changes.length, '条变化');
            this.handleRealtimeChanges('employees', changes, storeId);
        });
        
        // 监听运营成本变化
        this.setupRealtimeListener('operatingCosts', storeId, (changes) => {
            console.log('📡 收到运营成本实时更新:', changes.length, '条变化');
            this.handleRealtimeChanges('operatingCosts', changes, storeId);
        });
        
        // 监听坐班费用变化
        this.setupRealtimeListener('attendanceFees', storeId, (changes) => {
            console.log('📡 收到坐班费用实时更新:', changes.length, '条变化');
            this.handleRealtimeChanges('attendanceFees', changes, storeId);
        });

        // 监听项目数据变化
        this.setupRealtimeListener('projects', storeId, (changes) => {
            console.log('📡 收到项目数据实时更新:', changes.length, '条变化');
            this.handleRealtimeChanges('projects', changes, storeId);
        });

        // 监听面试费用变化
        this.setupRealtimeListener('interviewFees', storeId, (changes) => {
            console.log('📡 收到面试费用实时更新:', changes.length, '条变化');
            this.handleRealtimeChanges('interviewFees', changes, storeId);
        });

        // 监听报告返现变化
        this.setupRealtimeListener('reportRebates', storeId, (changes) => {
            console.log('📡 收到报告返现实时更新:', changes.length, '条变化');
            this.handleRealtimeChanges('reportRebates', changes, storeId);
        });

        // 监听薪资档位变化
        this.setupRealtimeListener('salaryTiers', storeId, (changes) => {
            console.log('📡 收到薪资档位实时更新:', changes.length, '条变化');
            this.handleRealtimeChanges('salaryTiers', changes, storeId);
        });

        // 监听提成配置变化
        this.setupRealtimeListener('commissionConfigs', storeId, (changes) => {
            console.log('📡 收到提成配置实时更新:', changes.length, '条变化');
            this.handleRealtimeChanges('commissionConfigs', changes, storeId);
        });
    }
    
    // 设置单个集合的实时监听
    setupRealtimeListener(collectionName, storeId, callback) {
        if (!this.firebaseManager.subscribeToCollection) {
            console.warn(`⚠️ FirebaseManager没有subscribeToCollection方法，无法监听${collectionName}`);
            return;
        }
        
        try {
            const unsubscribe = this.firebaseManager.subscribeToCollection(collectionName, storeId, callback);
            this.realtimeListeners.set(`${collectionName}_${storeId}`, unsubscribe);
            console.log(`✅ ${collectionName}实时监听已启动`);
        } catch (error) {
            console.error(`❌ 启动${collectionName}实时监听失败:`, error);
        }
    }
    
    // 处理实时变化
    async handleRealtimeChanges(collectionName, changes, storeId) {
        if (changes.length === 0) return;
        
        console.log(`处理${collectionName}实时变化:`, changes.length, '条');
        
        // 获取当前本地数据
        const localData = await this[`load${this.capitalizeFirst(collectionName)}`](storeId);
        const isCompositeKey = collectionName === 'commissionConfigs';
        const makeKey = isCompositeKey
            ? (item) => `${item.employeeName || ''}|${item.projectName || ''}`
            : (item) => item.id;
        const dataMap = new Map(localData.map(item => [makeKey(item), item]));
        
        // 应用变化
        let hasChanges = false;
        for (const change of changes) {
            if (change.type === 'added' || change.type === 'modified') {
                // 添加或更新数据
                const cleanData = { ...change.data };
                // 移除Firebase特有字段
                delete cleanData.userId;
                delete cleanData.storeId;
                delete cleanData.syncedAt;
                delete cleanData.updatedAt;
                
                const itemData = { ...cleanData };
                const key = isCompositeKey
                    ? `${itemData.employeeName || ''}|${itemData.projectName || ''}`
                    : change.id;
                if (!isCompositeKey) itemData.id = change.id;
                dataMap.set(key, itemData);
                hasChanges = true;
            } else if (change.type === 'removed') {
                // 删除数据
                const removeKey = isCompositeKey
                    ? `${change.data.employeeName || ''}|${change.data.projectName || ''}`
                    : change.id;
                dataMap.delete(removeKey);
                hasChanges = true;
            }
        }
        
        // 如果有变化，只保存到本地（调用父类方法，避免再次触发云端同步循环）
        if (hasChanges) {
            const updatedData = Array.from(dataMap.values());
            // 使用父类的 _saveCollection 或对应的父类方法，避免触发子类的同步队列
            const parentSaveMap = {
                'schedules': IndexedDBManager.prototype.saveSchedules,
                'operatingCosts': IndexedDBManager.prototype.saveOperatingCosts,
                'attendanceFees': IndexedDBManager.prototype.saveAttendanceFees,
                'employees': IndexedDBManager.prototype.saveEmployees,
                'projects': IndexedDBManager.prototype.saveProjects,
                'interviewFees': IndexedDBManager.prototype.saveInterviewFees,
                'reportRebates': IndexedDBManager.prototype.saveReportRebates,
                'salaryTiers': IndexedDBManager.prototype.saveSalaryTiers,
                'commissionConfigs': IndexedDBManager.prototype.saveCommissionConfigs,
            };
            const saveMethod = parentSaveMap[collectionName];
            if (saveMethod) {
                await saveMethod.call(this, updatedData, storeId);
                console.log(`✅ ${collectionName}本地数据已更新`);

                // 如果页面有ScheduleManager实例，刷新显示
                if (typeof scheduleManager !== 'undefined' && scheduleManager.refreshDisplay) {
                    scheduleManager.refreshDisplay();
                }
            }
        }
    }
    
    // 工具方法：首字母大写
    capitalizeFirst(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }
    
    // 清理监听器
    cleanupListeners() {
        this.realtimeListeners.forEach((unsubscribe, key) => {
            try {
                unsubscribe();
                console.log(`清理监听器: ${key}`);
            } catch (error) {
                console.error(`清理监听器${key}失败:`, error);
            }
        });
        this.realtimeListeners.clear();
    }
}