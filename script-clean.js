// 排班展示系统 JavaScript 功能

// 注册 datalabels 插件（如果可用）
if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
    // 全局禁用 datalabels 插件，只在需要的图表中启用
    Chart.defaults.set('plugins.datalabels', {
        display: false
    });
}

// 从 CSS 变量读取颜色，以便跟随 dark/light 系统主题
function getCSSVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// 根据当前主题生成 Chart.js 通用配置
function getChartTheme() {
    const textColor    = getCSSVar('--color-text-secondary') || '#6B7280';
    const mutedColor   = getCSSVar('--color-text-muted')     || '#9CA3AF';
    const gridColor    = getCSSVar('--color-border')         || '#E5E7EB';
    const surfaceAlt   = getCSSVar('--color-surface-alt')    || '#F9FAFB';
    return {
        color: textColor,
        borderColor: gridColor,
        scale: {
            grid:  { color: gridColor },
            ticks: { color: mutedColor, font: { size: 11 } }
        },
        plugins: {
            legend: { labels: { color: textColor, font: { size: 11 } } }
        }
    };
}

// 将主题应用到 Chart.js 全局默认值
function applyChartDefaults() {
    const theme = getChartTheme();
    Chart.defaults.color = theme.color;
    Chart.defaults.borderColor = theme.borderColor;
    Chart.defaults.plugins.legend.labels.color = theme.plugins.legend.labels.color;
    Chart.defaults.scale.grid.color = theme.scale.grid.color;
    Chart.defaults.scale.ticks.color = theme.scale.ticks.color;
}

// 监听系统主题变化，实时更新图表颜色
if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        applyChartDefaults();
        // 重新渲染图表（如果 scheduleManager 已初始化）
        if (typeof scheduleManager !== 'undefined' && scheduleManager) {
            const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
            if (activeTab === 'charts') {
                scheduleManager.initializeIncomeChart();
                scheduleManager.initializeHeatmapChart();
                scheduleManager.initializeSourceChannelCharts();
                scheduleManager.initializeEmployeePerformanceChart();
                scheduleManager.initializeCustomerStatusCharts();
            }
            if (activeTab === 'operating-cost') {
                scheduleManager.initializeOperatingCostCharts();
            }
        }
    });
}

// IndexedDB工具类（已不再使用，保留代码仅供参考）
class IndexedDBManager {
    constructor() {
        this.dbName = 'ScheduleManagerDB';
        this.dbVersion = 2; // 恢复版本 2，因为数据库已经升级过了
        this.db = null;
    }

    // 初始化数据库
    async init() {
        if (this.db) {
            return this.db;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => {
                console.error('IndexedDB打开失败:', request.error);
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                console.log('IndexedDB初始化成功');
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // 创建对象存储：排班数据
                if (!db.objectStoreNames.contains('schedules')) {
                    const scheduleStore = db.createObjectStore('schedules', { keyPath: 'id' });
                    scheduleStore.createIndex('storeId', 'storeId', { unique: false });
                    scheduleStore.createIndex('date', 'scheduleDate', { unique: false });
                    scheduleStore.createIndex('employee', 'employeeName', { unique: false });
                }
                
                // 创建对象存储：项目数据
                if (!db.objectStoreNames.contains('projects')) {
                    db.createObjectStore('projects', { keyPath: 'id' });
                }
                
                // 创建对象存储：员工数据
                if (!db.objectStoreNames.contains('employees')) {
                    db.createObjectStore('employees', { keyPath: 'id' });
                }
                
                // 创建对象存储：坐班费用
                if (!db.objectStoreNames.contains('attendanceFees')) {
                    db.createObjectStore('attendanceFees', { keyPath: 'id' });
                }
                
                // 创建对象存储：面试费用
                if (!db.objectStoreNames.contains('interviewFees')) {
                    db.createObjectStore('interviewFees', { keyPath: 'id' });
                }
                
                // 创建对象存储：运营成本
                if (!db.objectStoreNames.contains('operatingCosts')) {
                    db.createObjectStore('operatingCosts', { keyPath: 'id' });
                }
                
                // 创建对象存储：报告返现
                if (!db.objectStoreNames.contains('reportRebates')) {
                    db.createObjectStore('reportRebates', { keyPath: 'id' });
                }
                
                // 创建对象存储：薪资档位
                if (!db.objectStoreNames.contains('salaryTiers')) {
                    db.createObjectStore('salaryTiers', { keyPath: 'id' });
                }
                
                console.log('IndexedDB数据库结构创建完成');
            };
        });
    }

    // 保存排班数据
    async saveSchedules(schedules, storeId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['schedules'], 'readwrite');
            const store = transaction.objectStore('schedules');
            const index = store.index('storeId');
            
            // 先检查现有数据数量，如果新数据明显少于旧数据，发出警告
            const checkRequest = index.getAll(storeId || '');
            checkRequest.onsuccess = () => {
                const existingSchedules = checkRequest.result || [];
                const existingCount = existingSchedules.length;
                const newCount = schedules.length;
                
                // 如果新数据明显少于旧数据（少于50%），记录警告
                if (existingCount > 0 && newCount > 0 && newCount < existingCount * 0.5) {
                    console.warn(`⚠️ 数据保存警告：新数据(${newCount}条)明显少于旧数据(${existingCount}条)，可能存在数据丢失风险！`);
                }
                
                // 先删除该店铺的所有旧数据
                const deleteRequest = index.openCursor(IDBKeyRange.only(storeId));
                deleteRequest.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    } else {
                        // 删除完成后，添加新数据
                        let completed = 0;
                        let hasError = false;
                        
                        if (schedules.length === 0) {
                            resolve();
                            return;
                        }
                        
                        schedules.forEach((schedule, index) => {
                            const scheduleWithStoreId = { ...schedule, storeId: storeId || '' };
                            const request = store.add(scheduleWithStoreId);
                            
                            request.onsuccess = () => {
                                completed++;
                                if (completed === schedules.length && !hasError) {
                                    resolve();
                                }
                            };
                            
                            request.onerror = () => {
                                if (!hasError) {
                                    hasError = true;
                                    reject(request.error);
                                }
                            };
                        });
                    }
                };
                deleteRequest.onerror = () => reject(deleteRequest.error);
            };
            checkRequest.onerror = () => reject(checkRequest.error);
        });
    }

    // 加载排班数据
    async loadSchedules(storeId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['schedules'], 'readonly');
            const store = transaction.objectStore('schedules');
            const index = store.index('storeId');
            
            const request = index.getAll(storeId || '');
            request.onsuccess = () => {
                const schedules = request.result || [];
                // 移除storeId字段（保持数据格式一致）
                const cleanedSchedules = schedules.map(s => {
                    const { storeId, ...rest } = s;
                    return rest;
                });
                resolve(cleanedSchedules);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // 保存运营成本数据
    async saveOperatingCosts(costs, storeId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['operatingCosts'], 'readwrite');
            const store = transaction.objectStore('operatingCosts');
            
            // 先删除该店铺的所有旧数据（通过storeId字段）
            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
                const allCosts = getAllRequest.result || [];
                const storeCosts = allCosts.filter(c => (c.storeId || '') === (storeId || ''));
                
                let deleteCount = 0;
                if (storeCosts.length === 0) {
                    // 没有旧数据，直接添加新数据
                    addNewData();
                } else {
                    storeCosts.forEach(cost => {
                        const deleteRequest = store.delete(cost.id);
                        deleteRequest.onsuccess = () => {
                            deleteCount++;
                            if (deleteCount === storeCosts.length) {
                                addNewData();
                            }
                        };
                        deleteRequest.onerror = () => reject(deleteRequest.error);
                    });
                }
                
                function addNewData() {
                    if (costs.length === 0) {
                        resolve();
                        return;
                    }
                    
                    let completed = 0;
                    let hasError = false;
                    
                    costs.forEach((cost) => {
                        const costWithStoreId = { ...cost, storeId: storeId || '' };
                        const request = store.add(costWithStoreId);
                        
                        request.onsuccess = () => {
                            completed++;
                            if (completed === costs.length && !hasError) {
                                resolve();
                            }
                        };
                        
                        request.onerror = () => {
                            if (!hasError) {
                                hasError = true;
                                reject(request.error);
                            }
                        };
                    });
                }
            };
            getAllRequest.onerror = () => reject(getAllRequest.error);
        });
    }

    // 加载运营成本数据
    async loadOperatingCosts(storeId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['operatingCosts'], 'readonly');
            const store = transaction.objectStore('operatingCosts');
            
            const request = store.getAll();
            request.onsuccess = () => {
                const allCosts = request.result || [];
                // 筛选当前店铺的数据
                const storeCosts = allCosts.filter(c => (c.storeId || '') === (storeId || ''));
                // 移除storeId字段
                const cleanedCosts = storeCosts.map(c => {
                    const { storeId, ...rest } = c;
                    return rest;
                });
                resolve(cleanedCosts);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // 保存坐班费用数据
    async saveAttendanceFees(fees, storeId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['attendanceFees'], 'readwrite');
            const store = transaction.objectStore('attendanceFees');
            
            // 先删除该店铺的所有旧数据（通过storeId字段）
            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
                const allFees = getAllRequest.result || [];
                const storeFees = allFees.filter(f => (f.storeId || '') === (storeId || ''));
                
                let deleteCount = 0;
                if (storeFees.length === 0) {
                    // 没有旧数据，直接添加新数据
                    addNewData();
                } else {
                    storeFees.forEach(fee => {
                        const deleteRequest = store.delete(fee.id);
                        deleteRequest.onsuccess = () => {
                            deleteCount++;
                            if (deleteCount === storeFees.length) {
                                addNewData();
                            }
                        };
                        deleteRequest.onerror = () => reject(deleteRequest.error);
                    });
                }
                
                function addNewData() {
                    if (fees.length === 0) {
                        resolve();
                        return;
                    }
                    
                    let completed = 0;
                    let hasError = false;
                    
                    fees.forEach((fee) => {
                        const feeWithStoreId = { ...fee, storeId: storeId || '' };
                        const request = store.add(feeWithStoreId);
                        
                        request.onsuccess = () => {
                            completed++;
                            if (completed === fees.length && !hasError) {
                                resolve();
                            }
                        };
                        
                        request.onerror = () => {
                            if (!hasError) {
                                hasError = true;
                                reject(request.error);
                            }
                        };
                    });
                }
            };
            getAllRequest.onerror = () => reject(getAllRequest.error);
        });
    }

    // 加载坐班费用数据
    async loadAttendanceFees(storeId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['attendanceFees'], 'readonly');
            const store = transaction.objectStore('attendanceFees');
            
            const request = store.getAll();
            request.onsuccess = () => {
                const allFees = request.result || [];
                // 筛选当前店铺的数据
                const storeFees = allFees.filter(f => (f.storeId || '') === (storeId || ''));
                // 移除storeId字段
                const cleanedFees = storeFees.map(f => {
                    const { storeId, ...rest } = f;
                    return rest;
                });
                resolve(cleanedFees);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // 保存员工数据
    async saveEmployees(employees, storeId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['employees'], 'readwrite');
            const store = transaction.objectStore('employees');
            
            // 先删除该店铺的所有旧数据
            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
                const allEmployees = getAllRequest.result || [];
                const storeEmployees = allEmployees.filter(e => (e.storeId || '') === (storeId || ''));
                
                let deleteCount = 0;
                if (storeEmployees.length === 0) {
                    addNewData();
                } else {
                    storeEmployees.forEach(emp => {
                        const deleteRequest = store.delete(emp.id);
                        deleteRequest.onsuccess = () => {
                            deleteCount++;
                            if (deleteCount === storeEmployees.length) {
                                addNewData();
                            }
                        };
                        deleteRequest.onerror = () => reject(deleteRequest.error);
                    });
                }
                
                function addNewData() {
                    if (employees.length === 0) {
                        resolve();
                        return;
                    }
                    
                    let completed = 0;
                    let hasError = false;
                    
                    employees.forEach((employee) => {
                        const employeeWithStoreId = { ...employee, storeId: storeId || '' };
                        const request = store.add(employeeWithStoreId);
                        
                        request.onsuccess = () => {
                            completed++;
                            if (completed === employees.length && !hasError) {
                                resolve();
                            }
                        };
                        
                        request.onerror = () => {
                            if (!hasError) {
                                hasError = true;
                                reject(request.error);
                            }
                        };
                    });
                }
            };
            getAllRequest.onerror = () => reject(getAllRequest.error);
        });
    }

    // 加载员工数据
    async loadEmployees(storeId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['employees'], 'readonly');
            const store = transaction.objectStore('employees');
            
            const request = store.getAll();
            request.onsuccess = () => {
                const allEmployees = request.result || [];
                // 筛选当前店铺的数据
                const storeEmployees = allEmployees.filter(e => (e.storeId || '') === (storeId || ''));
                // 移除storeId字段
                const cleanedEmployees = storeEmployees.map(e => {
                    const { storeId, ...rest } = e;
                    return rest;
                });
                resolve(cleanedEmployees);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // 通用保存方法（适用于没有storeId索引的对象存储）
    async _saveCollection(storeName, items, storeId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
                const allItems = getAllRequest.result || [];
                const storeItems = allItems.filter(item => (item.storeId || '') === (storeId || ''));

                let deleteCount = 0;
                if (storeItems.length === 0) {
                    addNewData();
                } else {
                    storeItems.forEach(item => {
                        const key = item.id;
                        const deleteRequest = store.delete(key);
                        deleteRequest.onsuccess = () => {
                            deleteCount++;
                            if (deleteCount === storeItems.length) {
                                addNewData();
                            }
                        };
                        deleteRequest.onerror = () => reject(deleteRequest.error);
                    });
                }

                function addNewData() {
                    if (items.length === 0) {
                        resolve();
                        return;
                    }

                    let completed = 0;
                    let hasError = false;

                    items.forEach(item => {
                        const itemWithStoreId = { ...item, storeId: storeId || '' };
                        const request = store.add(itemWithStoreId);

                        request.onsuccess = () => {
                            completed++;
                            if (completed === items.length && !hasError) {
                                resolve();
                            }
                        };

                        request.onerror = () => {
                            if (!hasError) {
                                hasError = true;
                                reject(request.error);
                            }
                        };
                    });
                }
            };
            getAllRequest.onerror = () => reject(getAllRequest.error);
        });
    }

    // 通用加载方法（适用于没有storeId索引的对象存储）
    async _loadCollection(storeName, storeId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);

            const request = store.getAll();
            request.onsuccess = () => {
                const allItems = request.result || [];
                const storeItems = allItems.filter(item => (item.storeId || '') === (storeId || ''));
                const cleanedItems = storeItems.map(item => {
                    const { storeId, ...rest } = item;
                    return rest;
                });
                resolve(cleanedItems);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // 保存项目数据
    async saveProjects(projects, storeId) {
        return this._saveCollection('projects', projects, storeId);
    }

    // 加载项目数据
    async loadProjects(storeId) {
        return this._loadCollection('projects', storeId);
    }

    // 保存面试费用数据
    async saveInterviewFees(fees, storeId) {
        return this._saveCollection('interviewFees', fees, storeId);
    }

    // 加载面试费用数据
    async loadInterviewFees(storeId) {
        return this._loadCollection('interviewFees', storeId);
    }

    // 保存报告返现数据
    async saveReportRebates(rebates, storeId) {
        return this._saveCollection('reportRebates', rebates, storeId);
    }

    // 加载报告返现数据
    async loadReportRebates(storeId) {
        return this._loadCollection('reportRebates', storeId);
    }

    // 保存薪资档位数据（注意：salaryTiers 可能是对象不是数组，需要包装）
    async saveSalaryTiers(tiers, storeId) {
        // salaryTiers 可能是对象，包装成数组存储
        const items = Array.isArray(tiers) ? tiers : [{ id: 'salaryTiers', data: tiers }];
        return this._saveCollection('salaryTiers', items, storeId);
    }

    // 加载薪资档位数据
    async loadSalaryTiers(storeId) {
        const items = await this._loadCollection('salaryTiers', storeId);
        // 如果是包装过的对象格式，还原
        if (items.length === 1 && items[0].id === 'salaryTiers' && items[0].data) {
            return items[0].data;
        }
        return items.length > 0 ? items : {};
    }

    // 迁移localStorage数据到IndexedDB
    async migrateFromLocalStorage(storeId, localStorageKey) {
        try {
            const data = localStorage.getItem(localStorageKey);
            if (!data) return;
            
            const schedules = JSON.parse(data);
            if (Array.isArray(schedules) && schedules.length > 0) {
                await this.saveSchedules(schedules, storeId);
                console.log(`已迁移 ${schedules.length} 条排班记录到IndexedDB`);
                return true;
            }
        } catch (error) {
            console.error('迁移数据失败:', error);
        }
        return false;
    }
}

class ScheduleManager {
    constructor() {
        // 应用 Chart.js 主题（跟随系统 dark/light 模式）
        applyChartDefaults();

        // 使用纯 Firebase 数据管理器（替代 IndexedDB）
        this.dbManager = new FirebaseDataManager();

        // 初始化店铺上下文
        this.initStoreContext();

        // 先从 localStorage 快速加载（保证界面能快速显示）
        this.schedules = this.loadSchedules();
        this.operatingCosts = this.loadOperatingCosts();
        this.projects = this.loadProjects();
        this.employees = this.loadEmployees();
        this.attendanceFees = this.loadAttendanceFees();
        this.interviewFees = this.loadInterviewFees();
        this.operatingCosts = this.loadOperatingCosts();
        this.reportRebates = this.loadReportRebates();
        this.salaryTiers = this.loadSalaryTiers();
        this.salaryPassword = this.loadSalaryPassword();
        this.jlPriceTable = this.jlLoadPriceTable();
        this.currentSort = { field: null, direction: 'asc' };
        this.editingId = null;
        this.editingProjectId = null;
        this.editingEmployeeId = null;
        this.editingAttendanceFeeId = null;
        this.editingInterviewFeeId = null;
        this.editingOperatingCostId = null;
        this.editingReportRebateId = null;
        this.editingSalaryTierId = null;
        this.currentViewMode = 'day';
        this.currentSalaryProject = null;
        this.currentSalaryTier = null;
        this.pendingSalaryAction = null;
        this.isAuthenticated = false;
        this.incomeChart = null;
        this.heatmapChart = null;
        this.sourceChannelOrderChart = null;
        this.sourceChannelIncomeChart = null;
        this.employeePerformanceChart = null;
        this.clientEmployeeCollaborationChart = null;
        this.employeeClientChart = null;
        this.customerCountPieChart = null;
        this.customerIncomePieChart = null;
        this.customerStatusBarChart = null;
        this.operatingCostCategoryChart = null;
        this.operatingCostTrendChart = null;
        this.initializeEventListeners();
        // 默认筛选到今天，避免一次性渲染全部数据（1000+条很慢）
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('filterDate').value = today;
        this.filterByDate(today);
        this.renderProjectList();
        this.updateProjectSelectors();
        this.renderEmployeeList();
        this.updateEmployeeSelectors().catch(err => console.error('更新员工选择器失败:', err));
        this.renderAttendanceFeeTable();
        this.updateAttendanceFeeSelectors();
        this.renderInterviewFeeTable();
        this.updateInterviewFeeSelectors();
        this.renderOperatingCostTable();
        this.updateOperatingCostStats();
        this.renderReportRebateTable();
        this.renderEmployeeCommissionSummary();
        this.initializeSalaryManagement();

        // 初始化接龙数据转换工具
        try { this.jlInit(); } catch (e) { console.error('接龙转换工具初始化失败:', e); }

        this.checkBackupReminder();
        this.setupStoreContextUI();

        // 初始化自动导入
        this.initAutoImport();

        // Firebase 登录后，通过 onSnapshot 实时同步数据
        this.dbManager.onReady(() => {
            this.jlInitPriceTableSync();

            // 先从 Firestore 加载店铺列表（localStorage 可能是新域名/空的）
            this._loadStoresFromFirestore().then(() => {
                // 店铺加载完成后再订阅当前店铺的数据
                this.dbManager.subscribeToStore(this.currentStoreId, this._getSubscribeCallbacks());
            });
        });
    }

    // 从 Firestore 加载店铺列表并更新 UI
    async _loadStoresFromFirestore() {
        const db = this.dbManager._getFirestore();
        if (!db) return;
        try {
            const snapshot = await db.collection('team/shared/stores').get();
            if (snapshot.empty) return;
            const stores = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                // 过滤掉子集合路径文档（只取有 name 字段的店铺文档）
                if (data.name) {
                    const { userId, syncedAt, updatedAt, ...store } = data;
                    stores.push(store);
                }
            });
            if (stores.length === 0) return;
            // 更新 localStorage
            localStorage.setItem('stores', JSON.stringify(stores));
            // 如果当前没有有效的 currentStoreId，设置第一个店铺
            const validStore = stores.find(s => s.id === this.currentStoreId) || stores[0];
            if (validStore) {
                this.currentStoreId = validStore.id;
                this.currentStore = validStore;
                this.dataKeyPrefix = `store_${validStore.id}_`;
                this.saveCurrentStoreIdSafely(validStore.id);
                this.setupStoreContextUI();
                this.updateStoreSelector();
            }
            console.log(`从 Firestore 加载了 ${stores.length} 个店铺`);
        } catch (e) {
            console.error('从 Firestore 加载店铺失败:', e);
        }
    }

    // 获取 subscribeToStore 的回调对象（提取为方法避免重复）
    // 首次 onSnapshot 时：如果 Firestore 为空而 localStorage 有数据，自动上传（迁移）
    _getSubscribeCallbacks() {
        // 记录每个集合是否已完成首次同步（防止重复迁移）
        const migrated = {};

        // 通用处理：Firestore 空 → 检查 localStorage 是否有数据需要迁移
        const handleSnapshot = (collectionName, data, fieldName, saveFn, renderFns) => {
            if (!migrated[collectionName] && data.length === 0) {
                migrated[collectionName] = true;
                // 检查 localStorage 中是否有数据
                const localData = this[fieldName];
                const isArray = Array.isArray(localData);
                const hasData = isArray ? localData.length > 0 : (localData && Object.keys(localData).length > 0);
                if (hasData) {
                    console.log(`onSnapshot ${collectionName}: Firestore 为空，从 localStorage 迁移 ${isArray ? localData.length : 1} 条数据`);
                    Promise.resolve(saveFn.call(this)).catch(error => {
                        console.error(`迁移 ${collectionName} 到 Firestore 失败:`, error);
                    });
                    return; // 迁移后 onSnapshot 会再次触发，届时会走下面的更新逻辑
                }
            }
            migrated[collectionName] = true;
            this[fieldName] = data;
            renderFns.forEach(fn => {
                try { fn.call(this); } catch (e) { console.error(`渲染 ${collectionName} 出错:`, e); }
            });
        };

        return {
            schedules: (data) => handleSnapshot('schedules', data, 'schedules',
                this.saveSchedules, [this.renderTableWithCurrentFilter, this.updateStats, this.renderEmployeeCommissionSummary]),
            employees: (data) => handleSnapshot('employees', data, 'employees',
                this.saveEmployees, [function() { this.updateEmployeeSelectors().catch(() => {}); }]),
            projects: (data) => handleSnapshot('projects', data, 'projects',
                this.saveProjects, [this.renderProjectList, this.updateProjectSelectors]),
            attendanceFees: (data) => handleSnapshot('attendanceFees', data, 'attendanceFees',
                this.saveAttendanceFees, [this.renderAttendanceFeeTable]),
            interviewFees: (data) => handleSnapshot('interviewFees', data, 'interviewFees',
                this.saveInterviewFees, [this.renderInterviewFeeTable]),
            operatingCosts: (data) => handleSnapshot('operatingCosts', data, 'operatingCosts',
                this.saveOperatingCosts, [this.renderOperatingCostTable, this.updateOperatingCostStats]),
            reportRebates: (data) => handleSnapshot('reportRebates', data, 'reportRebates',
                this.saveReportRebates, [this.renderReportRebateTable]),
            salaryTiers: (data) => {
                if (!migrated['salaryTiers'] && (!data || (Array.isArray(data) && data.length === 0) || (typeof data === 'object' && Object.keys(data).length === 0))) {
                    migrated['salaryTiers'] = true;
                    const local = this.salaryTiers;
                    if (local && Object.keys(local).length > 0) {
                        console.log('onSnapshot salaryTiers: Firestore 为空，从 localStorage 迁移');
                        this.saveSalaryTiersData().catch(error => {
                            console.error('迁移 salaryTiers 到 Firestore 失败:', error);
                        });
                        return;
                    }
                }
                migrated['salaryTiers'] = true;
                this.salaryTiers = data;
            },
        };
    }

    // 初始化店铺上下文
    initStoreContext() {
        // 加载所有店铺
        let stores = this.loadStores();
        
        // 如果没有店铺，创建默认店铺
        if (stores.length === 0) {
            this.createDefaultStore();
            stores = this.loadStores();
        }
        
        // 获取当前店铺ID（使用 try-catch 防止空间不足导致崩溃）
        try {
            this.currentStoreId = localStorage.getItem('currentStoreId');
        } catch (error) {
            console.warn('读取 currentStoreId 失败，使用默认值:', error);
            this.currentStoreId = null;
        }
        this.currentStore = null;
        
        // 如果有店铺ID，加载店铺信息
        if (this.currentStoreId) {
            this.currentStore = stores.find(s => s.id === this.currentStoreId);
            
            // 如果找不到店铺，设置第一个为当前店铺
            if (!this.currentStore && stores.length > 0) {
                this.currentStoreId = stores[0].id;
                this.currentStore = stores[0];
                this.saveCurrentStoreIdSafely(this.currentStoreId);
            }
        } else if (stores.length > 0) {
            // 如果没有当前店铺ID，设置第一个为当前店铺
            this.currentStoreId = stores[0].id;
            this.currentStore = stores[0];
            this.saveCurrentStoreIdSafely(this.currentStoreId);
        }
        
        // 设置数据键前缀
        this.dataKeyPrefix = this.currentStoreId ? `store_${this.currentStoreId}_` : '';
        
        // 初始化店铺选择器（延迟执行以确保DOM已加载）
        setTimeout(() => {
            try {
            this.updateStoreSelector();
            } catch (error) {
                console.error('初始化店铺选择器失败:', error);
            }
        }, 100);
    }

    // 安全保存当前店铺ID（如果空间不足，只保存在内存中）
    saveCurrentStoreIdSafely(storeId) {
        try {
            localStorage.setItem('currentStoreId', storeId);
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                console.warn('⚠️ localStorage 空间不足，无法保存 currentStoreId，尝试清理空间');
                // 同步尝试清理空间后重试
                const cleared = this.tryClearLocalStorageSpaceSync();
                if (cleared) {
                    try {
                        localStorage.setItem('currentStoreId', storeId);
                        console.log('清理空间后成功保存 currentStoreId');
                    } catch (retryError) {
                        console.warn('清理后仍无法保存 currentStoreId，仅保存在内存中');
                    }
                } else {
                    console.warn('清理空间失败，currentStoreId 仅保存在内存中');
                }
            } else {
                console.warn('保存 currentStoreId 失败:', error);
            }
        }
    }

    // 尝试清理 localStorage 空间
    async tryClearLocalStorageSpace() {
        // 尝试删除一些非关键数据来释放空间
        const keysToTryDelete = [
            'lastBackupDate',
            'lastBackupReminder',
            'indexeddb_migrated_',
            'indexeddb_schedules_migrated_',
            'indexeddb_operatingCosts_migrated_',
            'indexeddb_employees_migrated_'
        ];
        
        let clearedCount = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) {
                for (const pattern of keysToTryDelete) {
                    if (key.includes(pattern)) {
                        try {
                            localStorage.removeItem(key);
                            clearedCount++;
                            break;
                        } catch (e) {
                            // 忽略删除错误
                        }
                    }
                }
            }
        }
        
        console.log(`清理了 ${clearedCount} 个非关键 localStorage 键`);
        return clearedCount > 0;
    }

    // 设置店铺上下文界面
    setupStoreContextUI() {
        try {
        const storeInfo = document.getElementById('storeContextInfo');
        const backButton = document.getElementById('backToStoreCenter');
            
            if (!storeInfo) {
                console.warn('店铺信息元素不存在');
                return;
            }
        
        if (this.currentStore) {
            // 显示当前店铺信息
            storeInfo.innerHTML = `🏪 当前店铺：<strong>${this.currentStore.name}</strong>`;
            if (this.currentStore.manager) {
                storeInfo.innerHTML += ` | 店长：${this.currentStore.manager}`;
            }
            
            // 显示返回按钮
            if (backButton) {
                backButton.style.display = 'inline-block';
                backButton.onclick = () => {
                    this.switchTab('store-center');
                };
            }
        } else {
            storeInfo.textContent = '员工排班管理与项目跟踪';
            if (backButton) {
                backButton.style.display = 'none';
            }
            }
        } catch (error) {
            console.error('设置店铺上下文界面失败:', error);
        }
    }

    // 获取存储键名（带店铺前缀）
    getStorageKey(key) {
        // 确保dataKeyPrefix已初始化
        if (this.dataKeyPrefix === undefined) {
            this.dataKeyPrefix = '';
        }
        return this.dataKeyPrefix + key;
    }

    // ==================== 店铺管理功能 ====================
    
    // 加载所有店铺
    loadStores() {
        const saved = localStorage.getItem('stores');
        return saved ? JSON.parse(saved) : [];
    }

    // 保存店铺列表
    saveStores(stores) {
        try {
            const dataString = JSON.stringify(stores);
            localStorage.setItem('stores', dataString);
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                console.error('❌ localStorage 空间不足，无法保存店铺列表！');
                // 同步尝试清理一些空间
                const cleared = this.tryClearLocalStorageSpaceSync();
                if (cleared) {
                    // 重试保存
                    try {
                        localStorage.setItem('stores', JSON.stringify(stores));
                        console.log('清理空间后成功保存店铺列表');
                        return;
                    } catch (retryError) {
                        console.error('清理后仍然无法保存:', retryError);
                        alert('❌ 存储空间严重不足，无法保存店铺列表！\n\n建议：\n1. 使用"完整备份"功能备份数据\n2. 清除浏览器缓存\n3. 或者联系技术支持');
                        throw retryError;
                    }
                } else {
                    alert('❌ 存储空间不足且无法清理，无法保存店铺列表！\n\n请使用"完整备份"功能备份数据，然后清除浏览器缓存。');
                    throw error;
                }
            } else {
                console.error('保存店铺列表失败:', error);
                throw error;
            }
        }
    }

    // 同步清理 localStorage 空间
    tryClearLocalStorageSpaceSync() {
        // 尝试删除一些非关键数据来释放空间
        const keysToTryDelete = [
            'lastBackupDate',
            'lastBackupReminder',
            'indexeddb_migrated_',
            'indexeddb_schedules_migrated_',
            'indexeddb_operatingCosts_migrated_',
            'indexeddb_employees_migrated_'
        ];
        
        let clearedCount = 0;
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key) {
                    for (const pattern of keysToTryDelete) {
                        if (key.includes(pattern)) {
                            try {
                                localStorage.removeItem(key);
                                clearedCount++;
                                break;
                            } catch (e) {
                                // 忽略删除错误
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('清理空间时出错:', e);
        }
        
        console.log(`清理了 ${clearedCount} 个非关键 localStorage 键`);
        return clearedCount > 0;
    }

    // 尝试清理 localStorage 空间
    async tryClearLocalStorageSpace() {
        // 尝试删除一些非关键数据来释放空间
        const keysToTryDelete = [
            'lastBackupDate',
            'lastBackupReminder',
            'indexeddb_migrated_',
            'indexeddb_schedules_migrated_',
            'indexeddb_operatingCosts_migrated_',
            'indexeddb_employees_migrated_'
        ];
        
        let clearedCount = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) {
                for (const pattern of keysToTryDelete) {
                    if (key.includes(pattern)) {
                        try {
                            localStorage.removeItem(key);
                            clearedCount++;
                            break;
                        } catch (e) {
                            // 忽略删除错误
                        }
                    }
                }
            }
        }
        
        console.log(`清理了 ${clearedCount} 个非关键 localStorage 键`);
        return clearedCount > 0;
    }

    // 创建默认店铺
    createDefaultStore() {
        const defaultStore = {
            id: 'store_' + Date.now(),
            name: '默认店铺',
            address: '',
            phone: '',
            manager: '',
            openDate: new Date().toISOString().split('T')[0],
            notes: '系统自动创建的默认店铺',
            createdAt: new Date().toISOString()
        };
        
        const stores = this.loadStores();
        stores.push(defaultStore);
        this.saveStores(stores);
        
        // 设置为当前店铺
        this.currentStoreId = defaultStore.id;
        this.saveCurrentStoreIdSafely(defaultStore.id);
        this.currentStore = defaultStore;
        this.dataKeyPrefix = `store_${defaultStore.id}_`;
        
        return defaultStore;
    }

    // 加载当前店铺ID
    loadCurrentStore() {
        try {
            return localStorage.getItem('currentStoreId');
        } catch (error) {
            console.warn('读取 currentStoreId 失败:', error);
            return null;
        }
    }

    // 保存当前店铺ID（使用安全方法）
    saveCurrentStore() {
        if (this.currentStore && this.currentStore.id) {
            this.saveCurrentStoreIdSafely(this.currentStore.id);
        }
    }

    // 切换店铺
    switchStore(storeId) {
        const stores = this.loadStores();
        const store = stores.find(s => s.id === storeId);
        
        if (!store) {
            alert('店铺不存在！');
            return;
        }

        if (storeId === this.currentStoreId) {
            return;
        }

        // 保存当前店铺ID（使用安全方法）
        this.saveCurrentStoreIdSafely(storeId);
        this.currentStoreId = storeId;
        this.currentStore = store;
        this.dataKeyPrefix = `store_${storeId}_`;
        
        // 不刷新页面，避免 auth-guard 重新显示登录遮罩；直接切换数据上下文并重订阅。
        this.loadStoreDataFromCache();
        this.refreshCurrentStoreView();

        if (this.dbManager && this.dbManager.subscribeToStore) {
            this.dbManager.subscribeToStore(this.currentStoreId, this._getSubscribeCallbacks());
        }

        this.showSuccessMessage(`已切换到店铺：${store.name}`);
    }

    readStoreCache(key, fallback) {
        try {
            const value = localStorage.getItem(this.getStorageKey(key));
            return value ? JSON.parse(value) : fallback;
        } catch (error) {
            console.warn(`读取 ${key} 缓存失败:`, error);
            return fallback;
        }
    }

    loadStoreDataFromCache() {
        this.schedules = this.readStoreCache('schedules', []);
        this.operatingCosts = this.readStoreCache('operatingCosts', []);
        this.projects = this.readStoreCache('projects', []);
        this.employees = this.readStoreCache('employees', []);
        this.attendanceFees = this.readStoreCache('attendanceFees', []);
        this.interviewFees = this.readStoreCache('interviewFees', []);
        this.reportRebates = this.readStoreCache('reportRebates', []);
        this.salaryTiers = this.readStoreCache('salaryTiers', {});
        this.salaryPassword = localStorage.getItem(this.getStorageKey('salaryPassword')) || 'admin123';
    }

    refreshCurrentStoreView() {
        this.setupStoreContextUI();
        this.updateStoreSelector();
        this.renderTableWithCurrentFilter();
        this.updateStats();
        this.renderProjectList();
        this.updateProjectSelectors();
        this.renderEmployeeList();
        this.updateEmployeeSelectors().catch(err => console.error('更新员工选择器失败:', err));
        this.renderAttendanceFeeTable();
        this.updateAttendanceFeeSelectors();
        this.renderInterviewFeeTable();
        this.updateInterviewFeeSelectors();
        this.renderOperatingCostTable();
        this.updateOperatingCostStats();
        this.renderReportRebateTable();
        this.renderEmployeeCommissionSummary();
        this.initializeSalaryManagement();

        const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
        if (activeTab === 'store-center') {
            this.renderStoresList();
            this.renderAllStoresSummary();
            this.renderStoreComparisonChart();
        } else if (activeTab === 'charts') {
            this.initializeIncomeChart();
            this.initializeHeatmapChart();
            this.initializeSourceChannelCharts();
            this.initializeEmployeePerformanceChart();
            this.initializeClientEmployeeCollaborationChart();
            this.updateEmployeeClientSelector();
            this.initializeEmployeeClientChart();
            this.initializeCustomerStatusCharts();
        } else if (activeTab === 'operating-cost') {
            this.initializeOperatingCostCharts();
        }
    }

    // 打开店铺管理模态框（添加）
    openStoreModal() {
        this.editingStoreId = null;
        document.getElementById('storeModalTitle').textContent = '添加店铺';
        document.getElementById('storeForm').reset();
        document.getElementById('storeModal').style.display = 'block';
    }

    // 打开店铺管理模态框（编辑）
    editStore(storeId) {
        const stores = this.loadStores();
        const store = stores.find(s => s.id === storeId);
        
        if (!store) {
            alert('店铺不存在！');
            return;
        }

        this.editingStoreId = storeId;
        document.getElementById('storeModalTitle').textContent = '编辑店铺';
        document.getElementById('storeNameInput').value = store.name;
        document.getElementById('storeAddress').value = store.address || '';
        document.getElementById('storePhone').value = store.phone || '';
        document.getElementById('storeManager').value = store.manager || '';
        document.getElementById('storeOpenDate').value = store.openDate || '';
        document.getElementById('storeNotes').value = store.notes || '';
        document.getElementById('storeModal').style.display = 'block';
    }

    // 关闭店铺管理模态框
    closeStoreModal() {
        document.getElementById('storeModal').style.display = 'none';
        document.getElementById('storeForm').reset();
        this.editingStoreId = null;
    }

    // 保存店铺
    async saveStore(e) {
        if (e) e.preventDefault();

        const formData = {
            name: document.getElementById('storeNameInput').value.trim(),
            address: document.getElementById('storeAddress').value.trim(),
            phone: document.getElementById('storePhone').value.trim(),
            manager: document.getElementById('storeManager').value.trim(),
            openDate: document.getElementById('storeOpenDate').value,
            notes: document.getElementById('storeNotes').value.trim()
        };

        if (!formData.name) {
            alert('请输入店铺名称！');
            return;
        }

        const stores = this.loadStores();
        let storeToSave;

        if (this.editingStoreId) {
            // 编辑现有店铺
            const index = stores.findIndex(s => s.id === this.editingStoreId);
            if (index !== -1) {
                stores[index] = {
                    ...stores[index],
                    ...formData,
                    updatedAt: new Date().toISOString()
                };
                storeToSave = stores[index];
                this.saveStores(stores);
                this.showSuccessMessage('店铺信息已更新！');

                // 如果编辑的是当前店铺，更新店铺信息
                if (this.editingStoreId === this.currentStoreId) {
                    this.currentStore = stores[index];
                    this.setupStoreContextUI();
                }
            }
        } else {
            // 添加新店铺
            storeToSave = {
                id: 'store_' + Date.now(),
                ...formData,
                createdAt: new Date().toISOString()
            };
            stores.push(storeToSave);
            this.saveStores(stores);
            this.showSuccessMessage('店铺添加成功！');
        }

        // 同步到 Firestore
        if (storeToSave) {
            try {
                const db = this.dbManager._getFirestore();
                if (db) {
                    const user = firebase.auth().currentUser;
                    await db.collection('team/shared/stores').doc(storeToSave.id).set({
                        ...storeToSave,
                        syncedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: new Date().toISOString(),
                        ...(user ? { userId: user.uid } : {})
                    });
                }
            } catch (e) {
                console.error('Firestore 保存店铺失败:', e);
            }
        }

        this.closeStoreModal();
        this.renderStoresList();
        this.updateStoreSelector();
    }

    // 删除店铺
    async deleteStore(storeId) {
        const stores = this.loadStores();
        const store = stores.find(s => s.id === storeId);

        if (!store) {
            alert('店铺不存在！');
            return;
        }

        // 不能删除当前正在使用的店铺
        if (storeId === this.currentStoreId) {
            alert('⚠️ 无法删除当前正在使用的店铺！\n\n请先切换到其他店铺后再删除。');
            return;
        }

        // 不能删除最后一个店铺
        if (stores.length === 1) {
            alert('⚠️ 无法删除最后一个店铺！\n\n系统至少需要保留一个店铺。');
            return;
        }

        if (!confirm(`确定要删除店铺"${store.name}"吗？\n\n⚠️ 警告：删除店铺将同时删除该店铺的所有数据，此操作不可恢复！`)) {
            return;
        }

        // 二次确认
        const confirmText = prompt('⚠️ 最后确认 ⚠️\n\n此操作将永久删除该店铺及其所有数据！\n\n请输入"确认删除"来继续：');
        if (confirmText !== '确认删除') {
            if (confirmText !== null) {
                alert('输入错误，操作已取消');
            }
            return;
        }

        // 从 Firestore 删除店铺文档
        try {
            const db = this.dbManager._getFirestore();
            if (db) {
                await db.collection('team/shared/stores').doc(storeId).delete();
            }
        } catch (e) {
            console.error('Firestore 删除店铺失败:', e);
        }

        // 同时从 localStorage 删除店铺
        const index = stores.findIndex(s => s.id === storeId);
        if (index !== -1) {
            stores.splice(index, 1);
            this.saveStores(stores);
        }

        // 删除该店铺的所有本地数据
        const prefix = `store_${storeId}_`;
        const keysToDelete = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(prefix)) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => localStorage.removeItem(key));

        this.showSuccessMessage('店铺已删除！');
        this.renderStoresList();
        this.updateStoreSelector();
    }

    // 渲染店铺列表（店铺中心页面）
    renderStoresList() {
        const container = document.getElementById('storesList');
        if (!container) return;

        const stores = this.loadStores();
        
        if (stores.length === 0) {
            container.innerHTML = '<p class="no-data">暂无店铺，请添加第一个店铺</p>';
            return;
        }

        container.innerHTML = '';

        stores.forEach(store => {
            // 计算该店铺的统计数据
            const storeStats = this.getStoreStats(store.id);
            
            const storeCard = document.createElement('div');
            storeCard.className = 'store-card';
            storeCard.innerHTML = `
                <div class="store-card-header">
                    <h3>🏪 ${store.name}</h3>
                    ${store.id === this.currentStoreId ? '<span class="current-store-badge">当前店铺</span>' : ''}
                </div>
                <div class="store-card-info">
                    ${store.manager ? `<p><strong>店长：</strong>${store.manager}</p>` : ''}
                    ${store.address ? `<p><strong>地址：</strong>${store.address}</p>` : ''}
                    ${store.phone ? `<p><strong>电话：</strong>${store.phone}</p>` : ''}
                    ${store.openDate ? `<p><strong>开业时间：</strong>${this.formatDate(store.openDate)}</p>` : ''}
                </div>
                <div class="store-card-stats">
                    <div class="stat-item">
                        <span class="stat-label">排班记录</span>
                        <span class="stat-value">${storeStats.totalSchedules}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">总营收</span>
                        <span class="stat-value">¥${storeStats.totalRevenue.toLocaleString()}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">员工数</span>
                        <span class="stat-value">${storeStats.totalEmployees}</span>
                    </div>
                </div>
                <div class="store-card-actions">
                    ${store.id !== this.currentStoreId ? `<button class="btn btn-primary" onclick="scheduleManager.switchStore('${store.id}')">进入管理</button>` : '<button class="btn btn-secondary" disabled>当前店铺</button>'}
                    <button class="btn btn-info" onclick="scheduleManager.editStore('${store.id}')">编辑</button>
                    <button class="btn btn-danger" onclick="scheduleManager.deleteStore('${store.id}')">删除</button>
                </div>
            `;
            container.appendChild(storeCard);
        });
    }

    // 获取店铺统计数据
    getStoreStats(storeId) {
        const prefix = `store_${storeId}_`;
        const schedules = JSON.parse(localStorage.getItem(prefix + 'schedules') || '[]');
        const employees = JSON.parse(localStorage.getItem(prefix + 'employees') || '[]');
        
        const totalRevenue = schedules.reduce((sum, s) => sum + (parseFloat(s.payment) || 0), 0);
        
        return {
            totalSchedules: schedules.length,
            totalRevenue: totalRevenue,
            totalEmployees: employees.length
        };
    }

    // 更新店铺选择器
    updateStoreSelector() {
        try {
        const selector = document.getElementById('currentStoreSelect');
            if (!selector) {
                console.warn('店铺选择器元素不存在');
                return;
            }

        const stores = this.loadStores();
        selector.innerHTML = '';

        if (stores.length === 0) {
            selector.innerHTML = '<option value="">暂无店铺</option>';
            return;
        }

        stores.forEach(store => {
            const option = document.createElement('option');
            option.value = store.id;
            option.textContent = store.name;
            if (store.id === this.currentStoreId) {
                option.selected = true;
            }
            selector.appendChild(option);
        });
        } catch (error) {
            console.error('更新店铺选择器失败:', error);
            const selector = document.getElementById('currentStoreSelect');
            if (selector) {
                selector.innerHTML = '<option value="">加载失败</option>';
            }
        }
    }

    // 渲染全店汇总数据
    renderAllStoresSummary() {
        const stores = this.loadStores();
        
        let totalRevenue = 0;
        let totalOrders = 0;
        let totalEmployees = 0;
        let totalCommission = 0;
        let totalProfit = 0;

        stores.forEach(store => {
            const stats = this.getStoreStats(store.id);
            const prefix = `store_${store.id}_`;
            const schedules = JSON.parse(localStorage.getItem(prefix + 'schedules') || '[]');
            const employees = JSON.parse(localStorage.getItem(prefix + 'employees') || '[]');
            
            totalRevenue += stats.totalRevenue;
            totalOrders += schedules.length;
            totalEmployees += employees.length;
            
            const commission = schedules.reduce((sum, s) => sum + (parseFloat(s.commission) || 0), 0);
            totalCommission += commission;
            totalProfit += (stats.totalRevenue - commission);
        });

        document.getElementById('totalStores').textContent = stores.length;
        document.getElementById('allStoresTotalRevenue').textContent = `¥${totalRevenue.toLocaleString()}`;
        document.getElementById('allStoresTotalOrders').textContent = totalOrders;
        document.getElementById('allStoresTotalEmployees').textContent = totalEmployees;
        document.getElementById('allStoresTotalCommission').textContent = `¥${totalCommission.toLocaleString()}`;
        document.getElementById('allStoresTotalProfit').textContent = `¥${totalProfit.toLocaleString()}`;
    }

    // 渲染店铺对比图表
    renderStoreComparisonChart() {
        const canvas = document.getElementById('storeComparisonChart');
        if (!canvas) return;

        const stores = this.loadStores();
        const labels = stores.map(s => s.name);
        const revenues = stores.map(s => this.getStoreStats(s.id).totalRevenue);
        const orders = stores.map(s => this.getStoreStats(s.id).totalSchedules);

        if (this.storeComparisonChart) {
            this.storeComparisonChart.destroy();
        }

        const ctx = canvas.getContext('2d');
        this.storeComparisonChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '营收（元）',
                        data: revenues,
                        backgroundColor: 'rgba(102, 126, 234, 0.6)',
                        borderColor: 'rgba(102, 126, 234, 1)',
                        borderWidth: 2,
                        yAxisID: 'y'
                    },
                    {
                        label: '订单数',
                        data: orders,
                        backgroundColor: 'rgba(237, 100, 166, 0.6)',
                        borderColor: 'rgba(237, 100, 166, 1)',
                        borderWidth: 2,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: '营收（元）'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: '订单数'
                        },
                        grid: {
                            drawOnChartArea: false,
                        }
                    }
                }
            }
        });
    }

    // 检查存储空间并显示警告
    checkStorageSpace() {
        try {
            // 计算当前使用的存储空间
            let totalSize = 0;
            let storeData = {};
            
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const value = localStorage.getItem(key);
                const size = new Blob([value]).size;
                totalSize += size;
                
                // 按数据类型分类
                if (key.includes('employees')) {
                    storeData.employees = (storeData.employees || 0) + size;
                } else if (key.includes('schedules')) {
                    storeData.schedules = (storeData.schedules || 0) + size;
                } else {
                    storeData.other = (storeData.other || 0) + size;
                }
            }
            
            const totalMB = (totalSize / (1024 * 1024)).toFixed(2);
            const maxMB = 10; // 假设最大10MB
            const usagePercent = ((totalSize / (maxMB * 1024 * 1024)) * 100).toFixed(1);
            
            // 如果使用超过80%，显示警告
            if (usagePercent > 80) {
                console.warn(`⚠️ 存储空间使用率：${usagePercent}% (${totalMB}MB / ${maxMB}MB)`);
                
                if (usagePercent > 90) {
                    alert(
                        `⚠️ 存储空间告急！\n\n` +
                        `当前使用：${totalMB}MB / ${maxMB}MB (${usagePercent}%)\n\n` +
                        `建议操作：\n` +
                        `1. 清除员工头像（通常占用最大）\n` +
                        `2. 删除不需要的历史数据\n` +
                        `3. 清除浏览器缓存\n\n` +
                        `数据管理 → 清理存储空间`
                    );
                }
            }
            
            return {
                totalSize: totalSize,
                totalMB: totalMB,
                usagePercent: usagePercent,
                breakdown: storeData
            };
        } catch (error) {
            console.error('检查存储空间失败:', error);
            return null;
        }
    }

    // 清理员工头像（释放存储空间）
    removeAllEmployeePhotos() {
        if (!confirm(
            '⚠️ 确认清理员工头像？\n\n' +
            '这将移除所有员工的头像数据以释放存储空间。\n' +
            '员工其他信息（姓名、电话等）不会受影响。\n\n' +
            '您可以稍后重新上传头像。\n\n' +
            '是否继续？'
        )) {
            return;
        }

        try {
            let removedCount = 0;
            let savedSpace = 0;
            
            this.employees.forEach(emp => {
                if (emp.photo) {
                    savedSpace += new Blob([emp.photo]).size;
                    delete emp.photo;
                    removedCount++;
                }
            });
            
            // 异步保存，不等待（清理操作）
            this.saveEmployees().then(() => {
                const savedMB = (savedSpace / (1024 * 1024)).toFixed(2);
                alert(
                    `✅ 清理完成！\n\n` +
                    `已移除 ${removedCount} 个员工头像\n` +
                    `释放空间：约 ${savedMB}MB\n\n` +
                    `您可以在员工管理中重新上传头像。`
                );
                
                this.renderEmployeeList();
                this.renderEmployeeListModal();
            }).catch((error) => {
                console.error('保存失败:', error);
                // 即使保存失败，也更新界面
                this.renderEmployeeList();
                this.renderEmployeeListModal();
            });
        } catch (error) {
            console.error('清理失败:', error);
            alert('❌ 清理失败：' + error.message);
        }
    }

    // 显示存储空间信息
    showStorageInfo() {
        const info = this.checkStorageSpace();
        if (!info) {
            alert('无法获取存储空间信息');
            return;
        }

        const employeeMB = ((info.breakdown.employees || 0) / (1024 * 1024)).toFixed(2);
        const schedulesMB = ((info.breakdown.schedules || 0) / (1024 * 1024)).toFixed(2);
        const otherMB = ((info.breakdown.other || 0) / (1024 * 1024)).toFixed(2);

        const message = `
📊 存储空间使用情况

━━━━━━━━━━━━━━━━━━━━━━━
总使用量：${info.totalMB}MB / 10MB
使用率：${info.usagePercent}%

详细分类：
• 员工数据：${employeeMB}MB ${info.breakdown.employees ? '(含头像)' : ''}
• 排班记录：${schedulesMB}MB
• 其他数据：${otherMB}MB
━━━━━━━━━━━━━━━━━━━━━━━

${info.usagePercent > 80 ? '⚠️ 存储空间紧张，建议清理！' : '✅ 存储空间充足'}

提示：员工头像通常占用最多空间，
建议定期清理或使用较小的图片。
        `;

        alert(message);

        // 如果空间紧张，询问是否清理
        if (info.usagePercent > 80) {
            if (confirm('是否立即清理员工头像以释放空间？')) {
                this.removeAllEmployeePhotos();
            }
        }
    }

    // ==================== 店铺管理功能结束 ====================

    // 检查备份提醒
    checkBackupReminder() {
        // 获取最后备份时间
        const lastBackupDate = localStorage.getItem('lastBackupDate');
        const reminderInterval = 7; // 7天提醒一次
        
        // 如果有数据但从未备份过
        if (!lastBackupDate && this.schedules.length > 0) {
            setTimeout(() => {
                if (confirm('💾 数据备份提醒\n\n检测到您还没有备份过数据！\n\n为了防止数据丢失，建议立即备份所有数据。\n\n是否现在备份？')) {
                    this.backupAllData();
                } else {
                    // 用户选择不备份，设置一个时间避免频繁提醒
                    localStorage.setItem('lastBackupReminder', new Date().toISOString());
                }
            }, 3000); // 延迟3秒显示，避免页面加载时立即弹窗
            return;
        }
        
        // 检查是否需要提醒
        if (lastBackupDate) {
            const daysSinceBackup = Math.floor((Date.now() - new Date(lastBackupDate).getTime()) / (1000 * 60 * 60 * 24));
            
            if (daysSinceBackup >= reminderInterval && this.schedules.length > 0) {
                setTimeout(() => {
                    if (confirm(`💾 数据备份提醒\n\n距离上次备份已经过去 ${daysSinceBackup} 天了！\n\n建议定期备份数据以防止意外丢失。\n\n是否现在备份？`)) {
                        this.backupAllData();
                    } else {
                        // 记录提醒时间，避免每次加载都提醒
                        localStorage.setItem('lastBackupReminder', new Date().toISOString());
                    }
                }, 3000);
            }
        }
    }

    // 初始化事件监听器
    initializeEventListeners() {
        // 表单提交
        document.getElementById('scheduleForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addSchedule();
        });

        // 日期筛选
        document.getElementById('filterDate').addEventListener('change', (e) => {
            this.filterByDate(e.target.value);
        });

        // 周筛选
        document.getElementById('filterWeek').addEventListener('change', (e) => {
            this.filterByWeek(e.target.value);
        });

        // 月筛选
        document.getElementById('filterMonth').addEventListener('change', (e) => {
            this.filterByMonth(e.target.value);
        });

        // 展示模式切换
        document.getElementById('viewMode').addEventListener('change', (e) => {
            this.switchViewMode(e.target.value);
        });

        // 清除筛选
        document.getElementById('clearFilter').addEventListener('click', () => {
            this.clearFilter();
        });

        // 可折叠模块展开/收起（状态存 localStorage）
        document.querySelectorAll('.collapsible-header').forEach(header => {
            const section = header.closest('.collapsible-section');
            if (!section) return;
            const key = 'collapse_' + (section.id || header.querySelector('h2,h3')?.textContent?.trim());
            if (localStorage.getItem(key) === '1') {
                section.classList.add('collapsed');
            }
            header.addEventListener('click', () => {
                section.classList.toggle('collapsed');
                localStorage.setItem(key, section.classList.contains('collapsed') ? '1' : '0');
            });
        });

        // 移动端操作按钮折叠/展开
        document.getElementById('actionToggle')?.addEventListener('click', () => {
            const panel = document.getElementById('actionButtonsPanel');
            const btn = document.getElementById('actionToggle');
            panel.classList.toggle('open');
            btn.textContent = panel.classList.contains('open') ? '⚙️ 收起 ▴' : '⚙️ 更多操作 ▾';
        });

        // 导出数据
        document.getElementById('exportData').addEventListener('click', () => {
            this.exportData();
        });

        // 批量导入数据
        document.getElementById('importData').addEventListener('click', () => {
            this.openImportModal();
        });

        // 导出到文件
        const exportToFileBtn = document.getElementById('exportToFile');
        if (exportToFileBtn) {
            exportToFileBtn.addEventListener('click', () => {
                this.exportSchedulesToFile();
            });
        }

        // 从文件加载
        const loadFromFileBtn = document.getElementById('loadFromFile');
        if (loadFromFileBtn) {
            loadFromFileBtn.addEventListener('click', () => {
                this.loadSchedulesFromFileUI();
            });
        }

        // 完整数据备份
        document.getElementById('backupAllData').addEventListener('click', () => {
            this.backupAllData();
        });

        // 恢复数据
        document.getElementById('restoreAllData').addEventListener('click', () => {
            this.restoreAllData();
        });

        // 清除所有数据
        document.getElementById('clearAllData').addEventListener('click', () => {
            this.clearAllData();
        });

        // 开始时间变化时自动设置结束时间
        document.getElementById('startTime').addEventListener('change', (e) => {
            this.autoSetEndTime(e.target.value);
        });

        // 编辑模态框中的开始时间变化时自动设置结束时间
        document.getElementById('editStartTime').addEventListener('change', (e) => {
            this.autoSetEditEndTime(e.target.value);
        });

        // 坐班费用表单提交
        document.getElementById('attendanceFeeForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addAttendanceFee();
        });

        // 清除所有坐班费用
        document.getElementById('clearAttendanceFee').addEventListener('click', () => {
            this.clearAllAttendanceFees();
        });

        // 面试费用表单提交
        document.getElementById('interviewFeeForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addInterviewFee();
        });

        // 清除所有面试费用
        document.getElementById('clearInterviewFee').addEventListener('click', () => {
            this.clearAllInterviewFees();
        });

        // 运营成本表单提交
        document.getElementById('operatingCostForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addOperatingCost();
        });

        // 清除所有运营成本
        document.getElementById('clearOperatingCost').addEventListener('click', () => {
            this.clearAllOperatingCosts();
        });

        // 运营成本图表控制器
        const operatingCostChartDateRange = document.getElementById('operatingCostChartDateRange');
        const operatingCostChartType = document.getElementById('operatingCostChartType');
        if (operatingCostChartDateRange) {
            operatingCostChartDateRange.addEventListener('change', () => {
                this.updateOperatingCostCharts();
            });
        }
        if (operatingCostChartType) {
            operatingCostChartType.addEventListener('change', () => {
                this.updateOperatingCostCharts();
            });
        }

        // 报告返现事件
        document.getElementById('reportRebateForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addReportRebate();
        });

        // 清除所有报告返现
        document.getElementById('clearReportRebate').addEventListener('click', () => {
            this.clearAllReportRebates();
        });

        // 项目管理事件
        document.getElementById('addProjectBtn').addEventListener('click', () => {
            this.openAddProjectModal();
        });

        document.getElementById('manageProjectsBtn').addEventListener('click', () => {
            this.openProjectListModal();
        });

        document.getElementById('addNewProjectBtn').addEventListener('click', () => {
            this.openAddProjectModal();
        });

        // 项目表单提交
        document.getElementById('projectForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveProject();
        });

        // 员工管理事件
        document.getElementById('addEmployeeBtn').addEventListener('click', () => {
            this.openAddEmployeeModal();
        });

        document.getElementById('manageEmployeesBtn').addEventListener('click', () => {
            this.openEmployeeListModal();
        });

        document.getElementById('addNewEmployeeBtn').addEventListener('click', () => {
            this.openAddEmployeeModal();
        });

        // 员工表单提交
        document.getElementById('employeeForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveEmployee();
        });

        // 图片上传功能
        document.getElementById('photoUploadArea').addEventListener('click', () => {
            document.getElementById('employeePhoto').click();
        });

        document.getElementById('employeePhoto').addEventListener('change', (e) => {
            this.handlePhotoUpload(e);
        });

        document.getElementById('removePhoto').addEventListener('click', (e) => {
            e.stopPropagation();
            this.removePhoto();
        });

        // Tab切换功能
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // 店铺管理相关事件
        const storeSelect = document.getElementById('currentStoreSelect');
        if (storeSelect) {
            storeSelect.addEventListener('change', (e) => {
                const storeId = e.target.value;
                if (storeId && storeId !== this.currentStoreId) {
                    this.switchStore(storeId);
                }
            });
        }

        const addNewStoreBtn = document.getElementById('addNewStore');
        if (addNewStoreBtn) {
            addNewStoreBtn.addEventListener('click', () => {
                this.openStoreModal();
            });
        }

        const storeForm = document.getElementById('storeForm');
        if (storeForm) {
            storeForm.addEventListener('submit', (e) => {
                this.saveStore(e);
            });
        }

        const backToStoreCenter = document.getElementById('backToStoreCenter');
        if (backToStoreCenter) {
            backToStoreCenter.addEventListener('click', () => {
                this.switchTab('store-center');
            });
        }

        const backupAllStoresBtn = document.getElementById('backupAllStores');
        if (backupAllStoresBtn) {
            backupAllStoresBtn.addEventListener('click', () => {
                this.backupAllStoresData();
            });
        }

        // 存储空间管理
        const checkStorageBtn = document.getElementById('checkStorageBtn');
        if (checkStorageBtn) {
            checkStorageBtn.addEventListener('click', () => {
                this.showStorageInfo();
            });
        }

        const cleanPhotosBtn = document.getElementById('cleanPhotosBtn');
        if (cleanPhotosBtn) {
            cleanPhotosBtn.addEventListener('click', () => {
                this.removeAllEmployeePhotos();
            });
        }

        // 图表时间范围选择
        document.getElementById('chartDateRange').addEventListener('change', (e) => {
            const customContainer = document.getElementById('customDateRangeContainer');
            if (e.target.value === 'custom') {
                customContainer.style.display = 'inline-flex';
            } else {
                customContainer.style.display = 'none';
                this.updateIncomeChart();
            }
        });

        // 自定义日期范围选择
        document.getElementById('chartStartDate').addEventListener('change', (e) => {
            const rangeSelect = document.getElementById('chartDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateIncomeChart();
            }
        });

        document.getElementById('chartEndDate').addEventListener('change', (e) => {
            const rangeSelect = document.getElementById('chartDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateIncomeChart();
            }
        });

        // 热力图时间范围选择
        document.getElementById('heatmapDateRange').addEventListener('change', (e) => {
            const customContainer = document.getElementById('heatmapCustomDateRangeContainer');
            if (e.target.value === 'custom') {
                customContainer.style.display = 'inline-flex';
            } else {
                customContainer.style.display = 'none';
                this.updateHeatmapChart();
            }
        });

        // 热力图自定义日期范围选择
        document.getElementById('heatmapStartDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('heatmapDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateHeatmapChart();
            }
        });

        document.getElementById('heatmapEndDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('heatmapDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateHeatmapChart();
            }
        });

        // 渠道分析时间范围选择
        document.getElementById('sourceChannelDateRange').addEventListener('change', (e) => {
            const customContainer = document.getElementById('sourceChannelCustomDateRangeContainer');
            if (e.target.value === 'custom') {
                customContainer.style.display = 'inline-flex';
            } else {
                customContainer.style.display = 'none';
                this.updateSourceChannelCharts();
            }
        });

        // 客户来源渠道自定义日期范围选择
        document.getElementById('sourceChannelStartDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('sourceChannelDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateSourceChannelCharts();
            }
        });

        document.getElementById('sourceChannelEndDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('sourceChannelDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateSourceChannelCharts();
            }
        });

        // 员工业绩对比时间范围选择
        document.getElementById('employeePerformanceDateRange').addEventListener('change', (e) => {
            const customContainer = document.getElementById('employeePerformanceCustomDateRangeContainer');
            if (e.target.value === 'custom') {
                customContainer.style.display = 'inline-flex';
            } else {
                customContainer.style.display = 'none';
                this.updateEmployeePerformanceChart();
            }
        });

        // 员工业绩对比自定义日期范围选择
        document.getElementById('employeePerformanceStartDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('employeePerformanceDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateEmployeePerformanceChart();
            }
        });

        document.getElementById('employeePerformanceEndDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('employeePerformanceDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateEmployeePerformanceChart();
            }
        });

        // 客户合作员工数量时间范围选择
        document.getElementById('clientEmployeeCollaborationDateRange').addEventListener('change', (e) => {
            const customContainer = document.getElementById('clientEmployeeCollaborationCustomDateRangeContainer');
            if (e.target.value === 'custom') {
                customContainer.style.display = 'inline-flex';
            } else {
                customContainer.style.display = 'none';
                this.updateClientEmployeeCollaborationChart();
            }
        });

        // 客户合作员工数量自定义日期范围选择
        document.getElementById('clientEmployeeCollaborationStartDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('clientEmployeeCollaborationDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateClientEmployeeCollaborationChart();
            }
        });

        document.getElementById('clientEmployeeCollaborationEndDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('clientEmployeeCollaborationDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateClientEmployeeCollaborationChart();
            }
        });

        // 员工客户合作员工选择
        document.getElementById('employeeClientEmployee').addEventListener('change', (e) => {
            this.updateEmployeeClientChart();
        });

        // 员工客户合作时间范围选择
        document.getElementById('employeeClientDateRange').addEventListener('change', (e) => {
            const customContainer = document.getElementById('employeeClientCustomDateRangeContainer');
            if (e.target.value === 'custom') {
                customContainer.style.display = 'inline-flex';
            } else {
                customContainer.style.display = 'none';
                this.updateEmployeeClientChart();
            }
        });

        // 员工客户合作自定义日期范围选择
        document.getElementById('employeeClientStartDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('employeeClientDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateEmployeeClientChart();
            }
        });

        document.getElementById('employeeClientEndDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('employeeClientDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateEmployeeClientChart();
            }
        });

        // 客户活跃度分析时间范围选择
        document.getElementById('customerStatusDateRange').addEventListener('change', (e) => {
            const customContainer = document.getElementById('customerStatusCustomDateRangeContainer');
            if (e.target.value === 'custom') {
                customContainer.style.display = 'inline-flex';
            } else {
                customContainer.style.display = 'none';
                this.updateCustomerStatusCharts();
            }
        });

        // 客户活跃度分层分析自定义日期范围选择
        document.getElementById('customerStatusStartDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('customerStatusDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateCustomerStatusCharts();
            }
        });

        document.getElementById('customerStatusEndDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('customerStatusDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateCustomerStatusCharts();
            }
        });

        // 员工排行榜事件监听
        document.getElementById('employeeRankingDateRange').addEventListener('change', (e) => {
            const customContainer = document.getElementById('employeeRankingCustomDateRangeContainer');
            if (e.target.value === 'custom') {
                customContainer.style.display = 'inline-flex';
            } else {
                customContainer.style.display = 'none';
                this.updateEmployeeRanking();
            }
        });

        // 员工业绩排行榜自定义日期范围选择
        document.getElementById('employeeRankingStartDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('employeeRankingDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateEmployeeRanking();
            }
        });

        document.getElementById('employeeRankingEndDate').addEventListener('change', () => {
            const rangeSelect = document.getElementById('employeeRankingDateRange');
            if (rangeSelect.value === 'custom') {
                this.updateEmployeeRanking();
            }
        });

        document.getElementById('employeeRankingSortBy').addEventListener('change', (e) => {
            this.updateEmployeeRanking();
        });

        // 全局图表时间范围选择
        document.getElementById('globalChartDateRange').addEventListener('change', (e) => {
            const customContainer = document.getElementById('globalCustomDateRangeContainer');
            if (e.target.value === 'custom') {
                customContainer.style.display = 'inline-flex';
            } else {
                customContainer.style.display = 'none';
                this.applyGlobalChartDateRange();
            }
        });
        document.getElementById('globalChartStartDate').addEventListener('change', () => {
            if (document.getElementById('globalChartDateRange').value === 'custom') {
                this.applyGlobalChartDateRange();
            }
        });
        document.getElementById('globalChartEndDate').addEventListener('change', () => {
            if (document.getElementById('globalChartDateRange').value === 'custom') {
                this.applyGlobalChartDateRange();
            }
        });

        // AI 报告自定义日期范围切换
        const aiReportRange = document.getElementById('aiReportDateRange');
        if (aiReportRange) {
            aiReportRange.addEventListener('change', (e) => {
                const container = document.getElementById('aiReportCustomRange');
                if (container) container.style.display = e.target.value === 'custom' ? 'flex' : 'none';
            });
        }

        // 表格排序
        document.querySelectorAll('.sortable').forEach(header => {
            header.addEventListener('click', (e) => {
                const sortField = e.currentTarget.dataset.sort;
                this.sortTable(sortField);
            });
        });

        // 编辑表单提交
        document.getElementById('editForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateSchedule();
        });

        // 点击模态框外部关闭
        document.getElementById('editModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('editModal')) {
                this.closeEditModal();
            }
        });
    }

    // 添加排班记录
    addSchedule() {
        const formData = {
            id: Date.now().toString(),
            employeeName: document.getElementById('employeeName').value.trim(),
            scheduleDate: document.getElementById('scheduleDate').value,
            startTime: document.getElementById('startTime').value,
            endTime: document.getElementById('endTime').value,
            projectName: document.getElementById('projectName').value.trim(),
            clientName: document.getElementById('clientName').value.trim(),
            clientSource: document.getElementById('clientSource').value,
            payment: parseFloat(document.getElementById('payment').value),
            commission: parseFloat(document.getElementById('commission').value),
            createdAt: new Date().toISOString()
        };

        // 验证数据
        if (!this.validateFormData(formData)) {
            return;
        }

        // 添加到数组
        this.schedules.push(formData);

        // 日常新增只写入这一条 Firestore 文档，避免重写整个 schedules 集合
        this.saveScheduleItem(formData, 'add').catch(error => {
            console.error('保存新增排班到 Firestore 失败:', error);
        });

        // 智能显示逻辑：如果有筛选条件，保持筛选状态；否则显示新添加的记录
        this.handlePostAddDisplay(formData);

        // 更新统计信息
        this.updateStats();

        // 显示成功消息
        this.showSuccessMessage(`排班记录添加成功！已为 ${formData.employeeName} 添加 ${this.formatDate(formData.scheduleDate)} ${this.formatTimeRange(formData.startTime, formData.endTime)} 的排班`);

        // 清空表单
        this.clearForm();
    }

    // 验证表单数据
    validateFormData(data) {
        if (!data.employeeName) {
            alert('请输入员工姓名');
            return false;
        }
        if (!data.scheduleDate) {
            alert('请选择排班日期');
            return false;
        }
        if (!data.startTime) {
            alert('请选择开始时间');
            return false;
        }
        if (!data.endTime) {
            alert('请选择结束时间');
            return false;
        }
        if (data.startTime >= data.endTime) {
            alert('结束时间必须晚于开始时间');
            return false;
        }
        if (!data.projectName) {
            alert('请输入项目名称');
            return false;
        }
        if (!data.clientName) {
            alert('请输入对接客户');
            return false;
        }
        if (!data.payment || data.payment <= 0) {
            alert('请输入有效的付款金额');
            return false;
        }
        if (!data.commission || data.commission < 0) {
            alert('请输入有效的员工提成金额');
            return false;
        }
        
        // 检查时间段冲突
        if (this.hasTimeConflict(data)) {
            alert('该员工在此时间段已有排班，请选择其他时间');
            return false;
        }
        
        return true;
    }

    // 清空表单
    clearForm() {
        document.getElementById('scheduleForm').reset();
    }

    // 处理添加记录后的显示逻辑
    handlePostAddDisplay(newSchedule) {
        // 检查是否有筛选条件
        const hasDateFilter = document.getElementById('filterDate').value;
        const hasWeekFilter = document.getElementById('filterWeek').value;
        const hasMonthFilter = document.getElementById('filterMonth').value;
        
        if (hasDateFilter || hasWeekFilter || hasMonthFilter) {
            // 如果有筛选条件，保持当前筛选状态并重新渲染
            if (hasDateFilter) {
                this.filterByDate(hasDateFilter);
            } else if (hasWeekFilter) {
                this.filterByWeek(hasWeekFilter);
            } else if (hasMonthFilter) {
                this.filterByMonth(hasMonthFilter);
            }
        } else {
            // 没有筛选条件，显示新添加记录对应的日期筛选
            this.showNewRecord(newSchedule);
        }
    }

    // 显示新添加的记录
    showNewRecord(newSchedule) {
        // 设置筛选器为记录日期
        document.getElementById('filterDate').value = newSchedule.scheduleDate;
        document.getElementById('filterWeek').value = '';
        document.getElementById('filterMonth').value = '';
        
        // 按日期筛选显示
        this.filterByDate(newSchedule.scheduleDate);
        
        // 高亮显示新添加的记录
        setTimeout(() => {
            this.highlightNewRecord(newSchedule.id);
        }, 100);
    }

    // 高亮显示新添加的记录
    highlightNewRecord(recordId) {
        const tbody = document.getElementById('scheduleTableBody');
        const rows = tbody.querySelectorAll('tr');
        
        rows.forEach(row => {
            if (row.innerHTML.includes(`editSchedule('${recordId}')`)) {
                // 添加高亮效果
                row.classList.add('new-record-highlight');
                
                // 滚动到该行
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // 3秒后移除高亮
                setTimeout(() => {
                    row.classList.remove('new-record-highlight');
                }, 3000);
            }
        });
    }

    // 显示成功消息（浮动 toast，不依赖特定容器）
    showSuccessMessage(message) {
        let successDiv = document.getElementById('_globalSuccessToast');
        if (!successDiv) {
            successDiv = document.createElement('div');
            successDiv.id = '_globalSuccessToast';
            successDiv.className = 'success-message';
            document.body.appendChild(successDiv);
        }
        successDiv.textContent = message;
        successDiv.classList.add('show');
        clearTimeout(successDiv._hideTimer);
        successDiv._hideTimer = setTimeout(() => {
            successDiv.classList.remove('show');
        }, 3000);
    }

    // 渲染表格
    renderTable() {
        const tbody = document.getElementById('scheduleTableBody');
        tbody.innerHTML = '';

        if (this.schedules.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="empty-state">
                        <h3>暂无排班记录</h3>
                        <p>请添加第一条排班记录</p>
                    </td>
                </tr>
            `;
            return;
        }

        // 根据当前排序设置进行排序
        const sortedSchedules = this.getSortedSchedules();

        sortedSchedules.forEach(schedule => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${this.formatDate(schedule.scheduleDate)}</td>
                <td>${this.formatTimeRange(schedule.startTime, schedule.endTime)}</td>
                <td>${schedule.employeeName}</td>
                <td>${schedule.projectName}</td>
                <td>${schedule.clientName}</td>
                <td>${schedule.clientSource || '未设置'}</td>
                <td>¥${schedule.payment.toLocaleString()}</td>
                <td>¥${(schedule.commission || 0).toLocaleString()}</td>
                <td>
                    <button class="btn btn-edit" onclick="scheduleManager.editSchedule('${schedule.id}')">
                        编辑
                    </button>
                    <button class="btn btn-danger" onclick="scheduleManager.deleteSchedule('${schedule.id}')">
                        删除
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // 删除排班记录
    deleteSchedule(id) {
        if (confirm('确定要删除这条排班记录吗？')) {
            this.schedules = this.schedules.filter(schedule => schedule.id !== id);
            this.deleteScheduleItem(id).catch(error => {
                console.error('从 Firestore 删除排班失败:', error);
            });
            this.renderTableWithCurrentFilter();
            this.updateStats();
            this.showSuccessMessage('排班记录删除成功！');
        }
    }

    // 编辑排班记录
    editSchedule(id) {
        const schedule = this.schedules.find(s => s.id === id);
        if (!schedule) {
            alert('未找到要编辑的记录');
            return;
        }

        this.editingId = id;
        
        // 填充编辑表单
        document.getElementById('editEmployeeName').value = schedule.employeeName;
        document.getElementById('editScheduleDate').value = schedule.scheduleDate;
        document.getElementById('editStartTime').value = schedule.startTime;
        document.getElementById('editEndTime').value = schedule.endTime;
        document.getElementById('editProjectName').value = schedule.projectName;
        document.getElementById('editClientName').value = schedule.clientName;
        document.getElementById('editClientSource').value = schedule.clientSource || '';
        document.getElementById('editPayment').value = schedule.payment;
        document.getElementById('editCommission').value = schedule.commission || 0;

        // 显示模态框
        document.getElementById('editModal').style.display = 'block';
    }

    // 更新排班记录
    updateSchedule() {
        if (!this.editingId) {
            alert('编辑状态异常');
            return;
        }

        const formData = {
            employeeName: document.getElementById('editEmployeeName').value.trim(),
            scheduleDate: document.getElementById('editScheduleDate').value,
            startTime: document.getElementById('editStartTime').value,
            endTime: document.getElementById('editEndTime').value,
            projectName: document.getElementById('editProjectName').value.trim(),
            clientName: document.getElementById('editClientName').value.trim(),
            clientSource: document.getElementById('editClientSource').value,
            payment: parseFloat(document.getElementById('editPayment').value),
            commission: parseFloat(document.getElementById('editCommission').value)
        };

        // 验证数据
        if (!this.validateEditFormData(formData)) {
            return;
        }

        // 更新数据
        const scheduleIndex = this.schedules.findIndex(s => s.id === this.editingId);
        if (scheduleIndex !== -1) {
            const updatedSchedule = {
                ...this.schedules[scheduleIndex],
                ...formData,
                updatedAt: new Date().toISOString()
            };
            this.schedules[scheduleIndex] = updatedSchedule;

            // 日常编辑只更新这一条 Firestore 文档
            this.saveScheduleItem(updatedSchedule, 'update').catch(error => {
                console.error('保存修改后的排班到 Firestore 失败:', error);
            });

            // 重新渲染表格和统计
            this.renderTableWithCurrentFilter();
            this.updateStats();

            // 关闭模态框
            this.closeEditModal();

            // 显示成功消息
            this.showSuccessMessage('排班记录修改成功！');
        }
    }

    // 验证编辑表单数据
    validateEditFormData(data) {
        if (!data.employeeName) {
            alert('请输入员工姓名');
            return false;
        }
        if (!data.scheduleDate) {
            alert('请选择排班日期');
            return false;
        }
        if (!data.startTime) {
            alert('请选择开始时间');
            return false;
        }
        if (!data.endTime) {
            alert('请选择结束时间');
            return false;
        }
        if (data.startTime >= data.endTime) {
            alert('结束时间必须晚于开始时间');
            return false;
        }
        if (!data.projectName) {
            alert('请输入项目名称');
            return false;
        }
        if (!data.clientName) {
            alert('请输入对接客户');
            return false;
        }
        if (!data.clientSource) {
            alert('请选择客户来源渠道');
            return false;
        }
        if (!data.payment || data.payment <= 0) {
            alert('请输入有效的付款金额');
            return false;
        }
        if (!data.commission || data.commission < 0) {
            alert('请输入有效的员工提成金额');
            return false;
        }
        
        // 检查时间段冲突（排除当前编辑的记录）
        if (this.hasEditTimeConflict(data)) {
            alert('该员工在此时间段已有排班，请选择其他时间');
            return false;
        }
        
        return true;
    }

    // 检查编辑时的时间段冲突
    hasEditTimeConflict(newData) {
        return this.schedules.some(existingSchedule => {
            // 排除当前编辑的记录
            if (existingSchedule.id === this.editingId) {
                return false;
            }
            
            // 检查是否是同一天和同一个员工
            if (existingSchedule.scheduleDate !== newData.scheduleDate || 
                existingSchedule.employeeName !== newData.employeeName) {
                return false;
            }
            
            // 检查时间段是否重叠
            const newStart = this.timeToMinutes(newData.startTime);
            const newEnd = this.timeToMinutes(newData.endTime);
            const existingStart = this.timeToMinutes(existingSchedule.startTime);
            const existingEnd = this.timeToMinutes(existingSchedule.endTime);
            
            // 时间段重叠判断：新开始时间 < 现有结束时间 且 新结束时间 > 现有开始时间
            return newStart < existingEnd && newEnd > existingStart;
        });
    }

    // 关闭编辑模态框
    closeEditModal() {
        document.getElementById('editModal').style.display = 'none';
        this.editingId = null;
        document.getElementById('editForm').reset();
    }

    // 按日期筛选
    filterByDate(date) {
        if (!date) {
            this.renderTable();
            this.updateStats();
            return;
        }

        const filteredSchedules = this.schedules.filter(schedule => 
            schedule.scheduleDate === date
        );

        this.renderFilteredTable(filteredSchedules);
        this.updateStats();
    }

    // 清除筛选
    clearFilter() {
        document.getElementById('filterDate').value = '';
        document.getElementById('filterWeek').value = '';
        document.getElementById('filterMonth').value = '';
        this.renderTable();
        this.updateStats();
    }

    // 切换展示模式
    switchViewMode(mode) {
        this.currentViewMode = mode;
        
        // 隐藏所有筛选器
        document.getElementById('filterDate').style.display = 'none';
        document.getElementById('filterWeek').style.display = 'none';
        document.getElementById('filterMonth').style.display = 'none';
        
        // 显示对应的筛选器
        switch (mode) {
            case 'day':
                document.getElementById('filterDate').style.display = 'block';
                break;
            case 'week':
                document.getElementById('filterWeek').style.display = 'block';
                break;
            case 'month':
                document.getElementById('filterMonth').style.display = 'block';
                break;
        }
        
        // 清除筛选值
        document.getElementById('filterDate').value = '';
        document.getElementById('filterWeek').value = '';
        document.getElementById('filterMonth').value = '';
        
        // 重新渲染表格和更新统计
        this.renderTable();
        this.updateStats();
        
        // 清除当前筛选并重新渲染
        this.clearFilter();
    }

    // 按周筛选
    filterByWeek(weekValue) {
        if (!weekValue) {
            this.renderTable();
            this.updateStats();
            return;
        }

        // 解析周值 (格式: YYYY-WXX)
        const [year, week] = weekValue.split('-W');
        const startDate = this.getWeekStartDate(parseInt(year), parseInt(week));
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);

        const filteredSchedules = this.schedules.filter(schedule => {
            const scheduleDate = new Date(schedule.scheduleDate);
            return scheduleDate >= startDate && scheduleDate <= endDate;
        });

        this.renderFilteredTable(filteredSchedules);
        this.updateStats();
    }

    // 按月筛选
    filterByMonth(monthValue) {
        if (!monthValue) {
            this.renderTable();
            this.updateStats();
            return;
        }

        // 解析月值 (格式: YYYY-MM)
        const [year, month] = monthValue.split('-');
        const yearNum = parseInt(year);
        const monthNum = parseInt(month);
        
        // 开始日期：该月第一天 00:00:00
        const startDate = new Date(yearNum, monthNum - 1, 1);
        startDate.setHours(0, 0, 0, 0);
        
        // 结束日期：该月最后一天 23:59:59
        const endDate = new Date(yearNum, monthNum, 0); // monthNum月的第0天 = (monthNum-1)月的最后一天
        endDate.setHours(23, 59, 59, 999);

        const filteredSchedules = this.schedules.filter(schedule => {
            const scheduleDate = new Date(schedule.scheduleDate);
            scheduleDate.setHours(0, 0, 0, 0); // 重置时间部分，只比较日期
            return scheduleDate >= startDate && scheduleDate <= endDate;
        });

        this.renderFilteredTable(filteredSchedules);
        this.updateStats();
    }

    // 获取周的开始日期
    getWeekStartDate(year, week) {
        const date = new Date(year, 0, 1);
        const dayOfWeek = date.getDay();
        const daysToAdd = (week - 1) * 7 - dayOfWeek + 1;
        date.setDate(daysToAdd);
        return date;
    }

    // 渲染筛选后的表格
    renderFilteredTable(filteredSchedules) {
        const tbody = document.getElementById('scheduleTableBody');
        tbody.innerHTML = '';

        if (filteredSchedules.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="empty-state">
                        <h3>该时间段无排班记录</h3>
                        <p>请选择其他时间段或添加新的排班记录</p>
                    </td>
                </tr>
            `;
            return;
        }

        // 对筛选后的数据进行排序
        const sortedFilteredSchedules = this.getSortedSchedulesFromArray(filteredSchedules);

        sortedFilteredSchedules.forEach(schedule => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${this.formatDate(schedule.scheduleDate)}</td>
                <td>${this.formatTimeRange(schedule.startTime, schedule.endTime)}</td>
                <td>${schedule.employeeName}</td>
                <td>${schedule.projectName}</td>
                <td>${schedule.clientName}</td>
                <td>${schedule.clientSource || '未设置'}</td>
                <td>¥${schedule.payment.toLocaleString()}</td>
                <td>¥${(schedule.commission || 0).toLocaleString()}</td>
                <td>
                    <button class="btn btn-edit" onclick="scheduleManager.editSchedule('${schedule.id}')">
                        编辑
                    </button>
                    <button class="btn btn-danger" onclick="scheduleManager.deleteSchedule('${schedule.id}')">
                        删除
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // 表格排序功能
    sortTable(field) {
        // 如果点击的是当前排序字段，则切换排序方向
        if (this.currentSort.field === field) {
            this.currentSort.direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            // 否则设置为新的排序字段，默认为升序
            this.currentSort.field = field;
            this.currentSort.direction = 'asc';
        }

        // 更新排序图标
        this.updateSortIcons();
        
        // 智能重新渲染：保持当前筛选状态
        this.renderTableWithCurrentFilter();
    }

    // 获取排序后的数据
    getSortedSchedules() {
        return this.getSortedSchedulesFromArray(this.schedules);
    }

    // 智能渲染表格：保持当前筛选状态
    renderTableWithCurrentFilter() {
        // 检查当前是否有筛选条件
        const hasDateFilter = document.getElementById('filterDate').value;
        const hasWeekFilter = document.getElementById('filterWeek').value;
        const hasMonthFilter = document.getElementById('filterMonth').value;
        
        if (hasDateFilter || hasWeekFilter || hasMonthFilter) {
            // 如果有筛选条件，重新应用筛选
            if (hasDateFilter) {
                this.filterByDate(hasDateFilter);
            } else if (hasWeekFilter) {
                this.filterByWeek(hasWeekFilter);
            } else if (hasMonthFilter) {
                this.filterByMonth(hasMonthFilter);
            }
        } else {
            // 没有筛选条件，显示所有记录
            this.renderTable();
        }
    }

    // 对指定数组进行排序
    getSortedSchedulesFromArray(schedules) {
        if (!this.currentSort.field) {
            // 默认按日期降序排序
            return [...schedules].sort((a, b) => 
                new Date(b.scheduleDate) - new Date(a.scheduleDate)
            );
        }

        return [...schedules].sort((a, b) => {
            let aValue, bValue;

            switch (this.currentSort.field) {
                case 'date':
                    aValue = new Date(a.scheduleDate);
                    bValue = new Date(b.scheduleDate);
                    break;
                case 'time':
                    aValue = this.timeToMinutes(a.startTime);
                    bValue = this.timeToMinutes(b.startTime);
                    break;
                case 'employee':
                    aValue = a.employeeName.toLowerCase();
                    bValue = b.employeeName.toLowerCase();
                    break;
                case 'client':
                    // 按客户出现次数排序，次数相同时按姓名排序
                    const aCount = this.getClientCount(a.clientName);
                    const bCount = this.getClientCount(b.clientName);
                    
                    if (aCount !== bCount) {
                        aValue = aCount;
                        bValue = bCount;
                    } else {
                        aValue = a.clientName.toLowerCase();
                        bValue = b.clientName.toLowerCase();
                    }
                    break;
                case 'payment':
                    aValue = a.payment;
                    bValue = b.payment;
                    break;
                case 'commission':
                    aValue = a.commission || 0;
                    bValue = b.commission || 0;
                    break;
                default:
                    return 0;
            }

            if (aValue < bValue) {
                return this.currentSort.direction === 'asc' ? -1 : 1;
            }
            if (aValue > bValue) {
                return this.currentSort.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });
    }

    // 更新排序图标
    updateSortIcons() {
        // 清除所有排序图标
        document.querySelectorAll('.sort-icon').forEach(icon => {
            icon.textContent = '↕';
            icon.className = 'sort-icon';
        });

        // 设置当前排序字段的图标
        if (this.currentSort.field) {
            const currentHeader = document.querySelector(`[data-sort="${this.currentSort.field}"] .sort-icon`);
            if (currentHeader) {
                currentHeader.textContent = this.currentSort.direction === 'asc' ? '↑' : '↓';
                currentHeader.className = `sort-icon active ${this.currentSort.direction}`;
            }
        }
    }

    // 更新统计信息
    updateStats() {
        // 根据当前展示模式获取对应的数据
        let filteredSchedules = this.schedules;
        let filteredAttendanceFees = this.attendanceFees;
        let filteredInterviewFees = this.interviewFees;
        let filteredOperatingCosts = this.operatingCosts;
        let filteredReportRebates = this.reportRebates;

        if (this.currentViewMode === 'day') {
            const selectedDate = document.getElementById('filterDate').value;
            if (selectedDate) {
                filteredSchedules = this.schedules.filter(schedule => schedule.scheduleDate === selectedDate);
                filteredAttendanceFees = this.attendanceFees.filter(fee => fee.date === selectedDate);
                filteredInterviewFees = this.interviewFees.filter(fee => fee.date === selectedDate);
                filteredOperatingCosts = this.operatingCosts.filter(cost => cost.date === selectedDate);
                filteredReportRebates = this.reportRebates.filter(rebate => rebate.date === selectedDate);
            }
        } else if (this.currentViewMode === 'week') {
            const selectedWeek = document.getElementById('filterWeek').value;
            if (selectedWeek) {
                const weekStart = this.getWeekStartDate(selectedWeek);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 6);
                
                filteredSchedules = this.schedules.filter(schedule => {
                    const scheduleDate = new Date(schedule.scheduleDate);
                    return scheduleDate >= weekStart && scheduleDate <= weekEnd;
                });
                
                filteredAttendanceFees = this.attendanceFees.filter(fee => {
                    const feeDate = new Date(fee.date);
                    return feeDate >= weekStart && feeDate <= weekEnd;
                });
                
                filteredInterviewFees = this.interviewFees.filter(fee => {
                    const feeDate = new Date(fee.date);
                    return feeDate >= weekStart && feeDate <= weekEnd;
                });
                
                filteredOperatingCosts = this.operatingCosts.filter(cost => {
                    const costDate = new Date(cost.date);
                    return costDate >= weekStart && costDate <= weekEnd;
                });
                
                filteredReportRebates = this.reportRebates.filter(rebate => {
                    const rebateDate = new Date(rebate.date);
                    return rebateDate >= weekStart && rebateDate <= weekEnd;
                });
            }
        } else if (this.currentViewMode === 'month') {
            const selectedMonth = document.getElementById('filterMonth').value;
            if (selectedMonth) {
                const [year, month] = selectedMonth.split('-');
                const yearNum = parseInt(year);
                const monthNum = parseInt(month);
                
                filteredSchedules = this.schedules.filter(schedule => {
                    const scheduleDate = new Date(schedule.scheduleDate);
                    return scheduleDate.getFullYear() === yearNum && scheduleDate.getMonth() === (monthNum - 1);
                });
                
                filteredAttendanceFees = this.attendanceFees.filter(fee => {
                    const feeDate = new Date(fee.date);
                    return feeDate.getFullYear() == year && feeDate.getMonth() == (month - 1);
                });
                
                filteredInterviewFees = this.interviewFees.filter(fee => {
                    const feeDate = new Date(fee.date);
                    return feeDate.getFullYear() == year && feeDate.getMonth() == (month - 1);
                });
                
                filteredOperatingCosts = this.operatingCosts.filter(cost => {
                    const costDate = new Date(cost.date);
                    return costDate.getFullYear() == year && costDate.getMonth() == (month - 1);
                });
                
                filteredReportRebates = this.reportRebates.filter(rebate => {
                    const rebateDate = new Date(rebate.date);
                    return rebateDate.getFullYear() == year && rebateDate.getMonth() == (month - 1);
                });
            }
        }

        // 计算统计数据
        const totalRecords = filteredSchedules.length;
        const totalAmount = filteredSchedules.reduce((sum, schedule) => sum + schedule.payment, 0);
        const totalCommissionFromSchedules = filteredSchedules.reduce((sum, schedule) => sum + (schedule.commission || 0), 0);
        const uniqueEmployees = new Set(filteredSchedules.map(schedule => schedule.employeeName)).size;
        const totalAttendanceFee = filteredAttendanceFees.reduce((sum, fee) => sum + fee.fee, 0);
        const totalInterviewFee = filteredInterviewFees.reduce((sum, fee) => sum + fee.fee, 0);
        const totalOperatingCost = filteredOperatingCosts.reduce((sum, cost) => sum + cost.amount, 0);
        const totalReportRebate = filteredReportRebates.reduce((sum, rebate) => sum + rebate.amount, 0);

        // 总提成 = 排班提成 + 坐班费用
        const totalCommission = totalCommissionFromSchedules + totalAttendanceFee;

        // 更新显示
        document.getElementById('totalRecords').textContent = totalRecords;
        document.getElementById('totalAmount').textContent = `¥${totalAmount.toLocaleString()}`;
        document.getElementById('totalCommission').textContent = `¥${totalCommission.toLocaleString()}`;
        document.getElementById('employeeCount').textContent = uniqueEmployees;
        document.getElementById('totalAttendanceFee').textContent = `¥${totalAttendanceFee.toLocaleString()}`;
        document.getElementById('totalInterviewFee').textContent = `¥${totalInterviewFee.toLocaleString()}`;
        document.getElementById('totalOperatingCost').textContent = `¥${totalOperatingCost.toLocaleString()}`;
        
        // 计算净收益（总金额 - 总提成（已包含坐班费用）- 面试费用 - 报告返现）
        const netProfit = totalAmount - totalCommission - totalInterviewFee - totalReportRebate;
        document.getElementById('netProfit').textContent = `¥${netProfit.toLocaleString()}`;
        
        // 计算净利润（净收益 - 运营成本）
        const netProfitFinal = netProfit - totalOperatingCost;
        document.getElementById('netProfitFinal').textContent = `¥${netProfitFinal.toLocaleString()}`;
        
        // 更新员工提成统计
        this.renderEmployeeCommissionSummary();
        
        // 更新客户TOP20统计
        this.renderClientTop20();
    }

    // 导出数据
    exportData() {
        if (this.schedules.length === 0) {
            alert('暂无数据可导出');
            return;
        }

        // 准备CSV数据
        const headers = ['日期', '时间段', '员工姓名', '项目名称', '对接客户', '客户来源渠道', '付款金额(元)', '员工提成(元)', '创建时间'];
        const csvContent = [
            headers.join(','),
            ...this.schedules.map(schedule => [
                schedule.scheduleDate,
                this.formatTimeRange(schedule.startTime, schedule.endTime),
                schedule.employeeName,
                schedule.projectName,
                schedule.clientName,
                schedule.clientSource || '未设置',
                schedule.payment,
                schedule.commission || 0,
                this.formatDateTime(schedule.createdAt)
            ].join(','))
        ].join('\n');

        // 创建下载链接
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `排班记录_${this.formatDate(new Date())}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.showSuccessMessage('数据导出成功！');
    }

    // 完整数据备份 - 导出所有数据到本地JSON文件
    backupAllData() {
        try {
            // 收集所有数据
            const allData = {
                version: '2.0',
                backupType: this.currentStoreId ? 'single_store' : 'legacy',
                backupDate: new Date().toISOString(),
                storeInfo: this.currentStore ? {
                    id: this.currentStore.id,
                    name: this.currentStore.name,
                    address: this.currentStore.address,
                    manager: this.currentStore.manager
                } : null,
                data: {
                    schedules: this.schedules,
                    employees: this.employees,
                    projects: this.projects,
                    attendanceFees: this.attendanceFees,
                    interviewFees: this.interviewFees,
                    operatingCosts: this.operatingCosts,
                    reportRebates: this.reportRebates,
                    salaryTiers: this.salaryTiers,
                    salaryPassword: this.salaryPassword
                },
                statistics: {
                    totalSchedules: this.schedules.length,
                    totalEmployees: this.employees.length,
                    totalProjects: this.projects.length,
                    totalAttendanceFees: this.attendanceFees.length,
                    totalInterviewFees: this.interviewFees.length,
                    totalOperatingCosts: this.operatingCosts.length,
                    totalReportRebates: this.reportRebates.length
                }
            };

            // 转换为JSON字符串（格式化以便阅读）
            const jsonString = JSON.stringify(allData, null, 2);
            
            // 创建Blob对象
            const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
            
            // 创建下载链接
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            const storeName = this.currentStore ? `_${this.currentStore.name}` : '';
            const fileName = `完整备份${storeName}_${this.formatDate(new Date())}_${new Date().getHours()}${String(new Date().getMinutes()).padStart(2, '0')}.json`;
            
            link.setAttribute('href', url);
            link.setAttribute('download', fileName);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            // 保存最后备份时间
            localStorage.setItem('lastBackupDate', new Date().toISOString());

            // 显示成功消息
            const storeText = this.currentStore ? `\n店铺：${this.currentStore.name}\n` : '';
            const message = `✅ 完整数据备份成功！${storeText}
备份内容：
• 排班记录：${allData.statistics.totalSchedules} 条
• 员工信息：${allData.statistics.totalEmployees} 人
• 项目信息：${allData.statistics.totalProjects} 个
• 坐班费用：${allData.statistics.totalAttendanceFees} 条
• 面试费用：${allData.statistics.totalInterviewFees} 条
• 运营成本：${allData.statistics.totalOperatingCosts} 条
• 报告返现：${allData.statistics.totalReportRebates} 条

文件已保存到下载文件夹！`;
            alert(message);
        } catch (error) {
            console.error('备份失败:', error);
            alert('❌ 备份失败：' + error.message);
        }
    }

    // 全店铺数据备份 - 导出所有店铺的数据
    backupAllStoresData() {
        try {
            const stores = this.loadStores();
            
            if (stores.length === 0) {
                alert('暂无店铺数据可备份！');
                return;
            }

            // 收集所有店铺的数据
            const allStoresData = {
                version: '2.0',
                backupType: 'all_stores',
                backupDate: new Date().toISOString(),
                stores: stores,
                storesData: {}
            };

            let totalStats = {
                totalSchedules: 0,
                totalEmployees: 0,
                totalProjects: 0,
                totalAttendanceFees: 0,
                totalInterviewFees: 0,
                totalOperatingCosts: 0,
                totalReportRebates: 0
            };

            // 遍历每个店铺，收集数据
            stores.forEach(store => {
                const prefix = `store_${store.id}_`;
                const storeData = {
                    schedules: JSON.parse(localStorage.getItem(prefix + 'schedules') || '[]'),
                    employees: JSON.parse(localStorage.getItem(prefix + 'employees') || '[]'),
                    projects: JSON.parse(localStorage.getItem(prefix + 'projects') || '[]'),
                    attendanceFees: JSON.parse(localStorage.getItem(prefix + 'attendanceFees') || '[]'),
                    interviewFees: JSON.parse(localStorage.getItem(prefix + 'interviewFees') || '[]'),
                    operatingCosts: JSON.parse(localStorage.getItem(prefix + 'operatingCosts') || '[]'),
                    reportRebates: JSON.parse(localStorage.getItem(prefix + 'reportRebates') || '[]'),
                    salaryTiers: JSON.parse(localStorage.getItem(prefix + 'salaryTiers') || '{}'),
                    salaryPassword: localStorage.getItem(prefix + 'salaryPassword') || 'admin123'
                };

                allStoresData.storesData[store.id] = storeData;

                // 累加统计
                totalStats.totalSchedules += storeData.schedules.length;
                totalStats.totalEmployees += storeData.employees.length;
                totalStats.totalProjects += storeData.projects.length;
                totalStats.totalAttendanceFees += storeData.attendanceFees.length;
                totalStats.totalInterviewFees += storeData.interviewFees.length;
                totalStats.totalOperatingCosts += storeData.operatingCosts.length;
                totalStats.totalReportRebates += storeData.reportRebates.length;
            });

            allStoresData.statistics = totalStats;

            // 转换为JSON字符串（格式化以便阅读）
            const jsonString = JSON.stringify(allStoresData, null, 2);
            
            // 创建Blob对象
            const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
            
            // 创建下载链接
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            const fileName = `全店铺备份_${this.formatDate(new Date())}_${new Date().getHours()}${String(new Date().getMinutes()).padStart(2, '0')}.json`;
            
            link.setAttribute('href', url);
            link.setAttribute('download', fileName);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            // 保存最后备份时间
            localStorage.setItem('lastBackupDate', new Date().toISOString());

            // 显示成功消息
            const message = `✅ 全店铺数据备份成功！

备份店铺数：${stores.length} 家
总排班记录：${totalStats.totalSchedules} 条
总员工数：${totalStats.totalEmployees} 人
总项目数：${totalStats.totalProjects} 个
总坐班费用：${totalStats.totalAttendanceFees} 条
总面试费用：${totalStats.totalInterviewFees} 条
总运营成本：${totalStats.totalOperatingCosts} 条
总报告返现：${totalStats.totalReportRebates} 条

文件已保存到下载文件夹！`;
            alert(message);
        } catch (error) {
            console.error('全店铺备份失败:', error);
            alert('❌ 全店铺备份失败：' + error.message);
        }
    }

    // 恢复数据 - 从本地JSON文件导入所有数据
    restoreAllData() {
        // 创建文件选择器
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // 检查文件扩展名
            if (!file.name.endsWith('.json')) {
                alert('❌ 请选择JSON格式的备份文件！');
                return;
            }

            // 读取文件
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    // 解析JSON数据
                    const backupData = JSON.parse(event.target.result);
                    
                    // 验证数据格式
                    if (!backupData.version || !backupData.data) {
                        throw new Error('备份文件格式不正确！');
                    }

                    // 显示备份信息，让用户选择恢复模式
                    const backupDate = new Date(backupData.backupDate).toLocaleString('zh-CN');
                    const modeMessage = `
📦 备份文件信息：
━━━━━━━━━━━━━━━━━━━━━━━
备份时间：${backupDate}
━━━━━━━━━━━━━━━━━━━━━━━
包含数据：
• 排班记录：${backupData.statistics?.totalSchedules || 0} 条
• 员工信息：${backupData.statistics?.totalEmployees || 0} 人
• 项目信息：${backupData.statistics?.totalProjects || 0} 个
• 坐班费用：${backupData.statistics?.totalAttendanceFees || 0} 条
• 面试费用：${backupData.statistics?.totalInterviewFees || 0} 条
• 运营成本：${backupData.statistics?.totalOperatingCosts || 0} 条
• 报告返现：${backupData.statistics?.totalReportRebates || 0} 条
━━━━━━━━━━━━━━━━━━━━━━━

请选择恢复模式：

输入 1 = 合并导入（推荐）
  → 备份数据与当前数据合并，已有记录不会丢失

输入 2 = 完全覆盖
  → 用备份数据替换当前所有数据

输入其他或取消 = 放弃操作`;

                    const modeInput = prompt(modeMessage);
                    if (!modeInput || (modeInput !== '1' && modeInput !== '2')) {
                        return;
                    }
                    const isMerge = modeInput === '1';

                    // 覆盖模式需要二次确认
                    if (!isMerge) {
                        const confirmText = prompt('⚠️ 最后确认 ⚠️\n\n此操作将覆盖当前所有数据！\n请输入"确认恢复"来继续：');
                        if (confirmText !== '确认恢复') {
                            if (confirmText !== null) {
                                alert('输入错误，操作已取消');
                            }
                            return;
                        }
                    }

                    // 恢复数据
                    const data = backupData.data;
                    
                    // 检查员工数据中是否有头像
                    const employeesWithPhoto = (data.employees || []).filter(e => e.photo);
                    let shouldRemovePhotos = true; // 默认不恢复头像
                    
                    if (employeesWithPhoto.length > 0) {
                        // 询问用户是否需要恢复头像（默认选择为"否"）
                        const photoOption = confirm(
                            `💡 恢复数据提示\n\n` +
                            `备份中包含 ${employeesWithPhoto.length} 个员工头像。\n\n` +
                            `为节省存储空间，系统默认不恢复员工头像。\n` +
                            `其他所有数据（姓名、电话、排班记录等）都会完整恢复。\n\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `是否需要恢复员工头像？\n\n` +
                            `• 点击"取消"：不恢复头像（默认，推荐 ✅）\n` +
                            `• 点击"确定"：恢复头像（可能因空间不足而失败）`
                        );
                        shouldRemovePhotos = !photoOption;
                        
                        if (!shouldRemovePhotos) {
                            alert(
                                `⚠️ 注意\n\n` +
                                `您选择了恢复员工头像。\n\n` +
                                `如果恢复过程中出现"存储空间不足"错误，\n` +
                                `系统会自动移除头像并重新尝试恢复。`
                            );
                        }
                    }
                    
                    // 合并辅助函数：按 id 去重，当前已有的记录优先保留
                    const mergeById = (current, incoming) => {
                        if (!incoming || incoming.length === 0) return current;
                        const existingIds = new Set(current.map(r => r.id));
                        const newItems = incoming.filter(r => !existingIds.has(r.id));
                        return [...current, ...newItems];
                    };

                    if (isMerge) {
                        // 合并模式：只追加当前没有的记录
                        this.schedules = mergeById(this.schedules, data.schedules);
                        this.attendanceFees = mergeById(this.attendanceFees, data.attendanceFees);
                        this.interviewFees = mergeById(this.interviewFees, data.interviewFees);
                        this.operatingCosts = mergeById(this.operatingCosts, data.operatingCosts);
                        this.reportRebates = mergeById(this.reportRebates, data.reportRebates);
                        // 员工/项目也按 id 去重合并
                        this.employees = mergeById(this.employees, data.employees);
                        this.projects = mergeById(this.projects, data.projects);
                        // 薪资档位和密码：合并模式不覆盖
                    } else {
                        // 覆盖模式：原有逻辑
                        this.schedules = data.schedules || [];
                        this.employees = data.employees || [];
                        this.projects = data.projects || [];
                        this.attendanceFees = data.attendanceFees || [];
                        this.interviewFees = data.interviewFees || [];
                        this.operatingCosts = data.operatingCosts || [];
                        this.reportRebates = data.reportRebates || [];
                        this.salaryTiers = data.salaryTiers || {};
                        if (data.salaryPassword) {
                            this.salaryPassword = data.salaryPassword;
                        }
                    }
                    
                    // 如果用户选择不恢复头像，移除所有员工头像
                    if (shouldRemovePhotos) {
                        this.employees.forEach(emp => {
                            delete emp.photo;
                        });
                    }

                    // 导入模式：暂停 onSnapshot 回调，防止写入过程中旧快照覆盖内存数据
                    this.dbManager.beginImport();
                    try {
                        await this.saveSchedules();
                        await this.saveProjects();
                        await this.saveAttendanceFees();
                        await this.saveInterviewFees();
                        await this.saveOperatingCosts();
                        await this.saveReportRebates();
                        await this.saveSalaryTiersData();
                        if (data.salaryPassword) {
                            this.saveSalaryPassword(data.salaryPassword);
                        }

                        // 最后保存员工数据（最可能出错的部分）
                        await this.saveEmployees();
                        
                    } catch (storageError) {
                        console.error('存储失败:', storageError);

                        if (storageError.name === 'QuotaExceededError' || storageError.message.includes('存储空间不足')) {
                            // 存储空间不足，提供解决方案
                            const cleanupOption = confirm(
                                `❌ 存储空间不足！\n\n` +
                                `当前数据量超过浏览器存储限制。\n\n` +
                                `建议解决方案：\n` +
                                `1. 移除所有员工头像（推荐）\n` +
                                `2. 清除浏览器缓存后重试\n` +
                                `3. 分批次恢复数据\n\n` +
                                `是否自动移除员工头像并重试？`
                            );

                            if (cleanupOption) {
                                // 移除所有员工头像并重试
                                this.employees.forEach(emp => {
                                    delete emp.photo;
                                });

                                try {
                                    await this.saveEmployees();
                                    alert('✅ 已移除员工头像，数据恢复成功！\n\n您可以稍后重新上传员工头像。');
                                } catch (retryError) {
                                    throw new Error('即使移除头像后仍然存储失败，请清除浏览器缓存后重试。');
                                }
                            } else {
                                throw new Error('存储空间不足，恢复已取消。请清除浏览器缓存或移除员工头像后重试。');
                            }
                        } else {
                            throw storageError;
                        }
                    } finally {
                        // 恢复 onSnapshot 正常工作
                        this.dbManager.endImport();
                    }

                    // 刷新所有界面
                    this.renderTable();
                    this.updateStats();
                    this.renderProjectList();
                    this.updateProjectSelectors();
                    this.renderEmployeeList();
                    this.updateEmployeeSelectors().catch(err => console.error('更新员工选择器失败:', err));
                    this.renderAttendanceFeeTable();
                    this.updateAttendanceFeeSelectors();
                    this.renderInterviewFeeTable();
                    this.updateInterviewFeeSelectors();
                    this.renderOperatingCostTable();
                    this.updateOperatingCostStats();
                    this.updateOperatingCostCharts();
                    this.renderReportRebateTable();
                    this.renderEmployeeCommissionSummary();
                    this.renderClientTop20();
                    this.initializeSalaryManagement();

                    // 刷新图表（如果在图表页面）
                    if (this.incomeChart) {
                        this.updateIncomeChart();
                    }

                    // 显示成功消息
                    const hasPhotos = this.employees.some(e => e.photo);
                    const photoStatus = shouldRemovePhotos ?
                        '⚠️ 员工头像未恢复（可在员工管理中重新上传）' :
                        (hasPhotos ? '✅ 员工头像已恢复' : '');
                    const modeLabel = isMerge ? '合并导入' : '完全覆盖';

                    const successMessage = `
✅ 数据${isMerge ? '合并' : '恢复'}成功！（${modeLabel}）

当前数据：
• 排班记录：${this.schedules.length} 条
• 员工信息：${this.employees.length} 人
• 项目信息：${this.projects.length} 个
• 坐班费用：${this.attendanceFees.length} 条
• 面试费用：${this.interviewFees.length} 条
• 运营成本：${this.operatingCosts.length} 条
• 报告返现：${this.reportRebates.length} 条

${photoStatus}`;
                    alert(successMessage);

                } catch (error) {
                    console.error('恢复数据失败:', error);
                    alert('❌ 恢复数据失败：' + error.message + '\n\n请确保选择的是正确的备份文件！');
                }
            };

            reader.onerror = () => {
                alert('❌ 文件读取失败！');
            };

            reader.readAsText(file);
        };

        // 触发文件选择
        input.click();
    }

    // 清除所有数据
    clearAllData() {
        if (this.schedules.length === 0) {
            alert('当前没有数据需要清除');
            return;
        }

        // 双重确认机制
        const firstConfirm = confirm(`确定要清除所有 ${this.schedules.length} 条排班记录吗？\n\n此操作将删除所有数据，包括：\n- 所有排班记录\n- 员工信息\n- 项目信息\n- 客户信息\n- 付款和提成数据\n\n此操作不可撤销！`);
        
        if (!firstConfirm) {
            return;
        }

        // 第二次确认 - 使用prompt要求用户输入确认文字
        const confirmText = prompt('⚠️ 最后确认 ⚠️\n\n您真的要删除所有数据吗？\n\n此操作将永久删除所有排班记录，无法恢复！\n\n请输入"确认删除"来继续：');
        
        if (confirmText !== '确认删除') {
            if (confirmText !== null) {
                alert('输入错误，操作已取消');
            }
            return;
        }

        // 清空数据
        this.schedules = [];
        this.saveSchedules();
        
        // 重新渲染界面
        this.renderTableWithCurrentFilter();
        this.updateStats();
        
        // 显示成功消息
        this.showSuccessMessage('所有排班记录已清除！');
    }

    // 检查时间段冲突
    hasTimeConflict(newSchedule) {
        return this.schedules.some(existingSchedule => {
            // 检查是否是同一天和同一个员工
            if (existingSchedule.scheduleDate !== newSchedule.scheduleDate || 
                existingSchedule.employeeName !== newSchedule.employeeName) {
                return false;
            }
            
            // 检查时间段是否重叠
            const newStart = this.timeToMinutes(newSchedule.startTime);
            const newEnd = this.timeToMinutes(newSchedule.endTime);
            const existingStart = this.timeToMinutes(existingSchedule.startTime);
            const existingEnd = this.timeToMinutes(existingSchedule.endTime);
            
            // 时间段重叠判断：新开始时间 < 现有结束时间 且 新结束时间 > 现有开始时间
            return newStart < existingEnd && newEnd > existingStart;
        });
    }

    // 将时间字符串转换为分钟数
    timeToMinutes(timeString) {
        const [hours, minutes] = timeString.split(':').map(Number);
        return hours * 60 + minutes;
    }

    // 格式化时间段显示
    formatTimeRange(startTime, endTime) {
        return `${startTime} - ${endTime}`;
    }

    // 格式化日期
    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    }

    // 格式化日期（带星期）
    formatDateWithWeekday(dateString) {
        const date = new Date(dateString);
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const formattedDate = date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const weekday = weekdays[date.getDay()];
        return `${formattedDate} (${weekday})`;
    }

    // 格式化日期时间
    formatDateTime(dateString) {
        const date = new Date(dateString);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // 保存数据到本地文件（当localStorage空间不足时使用）
    saveSchedulesToFile() {
        try {
            const storeName = this.currentStore ? this.currentStore.name : '默认店铺';
            const data = {
                version: '1.0',
                storeId: this.currentStoreId,
                storeName: storeName,
                exportDate: new Date().toISOString(),
                schedules: this.schedules
            };
            
            const dataString = JSON.stringify(data, null, 2);
            const blob = new Blob([dataString], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            
            const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '_');
            link.download = `排班数据_${storeName}_${dateStr}.json`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            
            // 记录文件保存信息到localStorage（只保存元数据，不保存实际数据）
            const fileInfo = {
                fileName: link.download,
                saveDate: new Date().toISOString(),
                recordCount: this.schedules.length,
                storeId: this.currentStoreId
            };
            localStorage.setItem(this.getStorageKey('schedules_file_info'), JSON.stringify(fileInfo));
            
            return true;
        } catch (error) {
            console.error('保存到文件失败:', error);
            return false;
        }
    }

    // 从本地文件加载数据
    loadSchedulesFromFile() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) {
                    resolve(null);
                    return;
                }
                
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const data = JSON.parse(event.target.result);
                        if (data.schedules && Array.isArray(data.schedules)) {
                            resolve(data.schedules);
                        } else {
                            reject(new Error('文件格式错误：找不到排班数据'));
                        }
                    } catch (error) {
                        reject(new Error('文件解析失败：' + error.message));
                    }
                };
                reader.onerror = () => {
                    reject(new Error('文件读取失败'));
                };
                reader.readAsText(file);
            };
            input.click();
        });
    }

    // 保存排班数据到 Firestore（直接写入，无需 IndexedDB 中转）
    async saveSchedules() {
        await this.dbManager.saveSchedules(this.schedules, this.currentStoreId);
        this.cacheSchedules();
    }

    cacheSchedules() {
        try { localStorage.setItem(this.getStorageKey('schedules'), JSON.stringify(this.schedules)); } catch (e) {}
    }

    async saveScheduleItem(schedule, mode = 'update') {
        this.cacheSchedules();

        if (mode === 'add' && this.dbManager.addSchedule) {
            await this.dbManager.addSchedule(schedule, this.currentStoreId);
            return;
        }

        if (this.dbManager.updateSchedule) {
            await this.dbManager.updateSchedule(schedule, this.currentStoreId);
            return;
        }

        await this.dbManager.saveSchedules(this.schedules, this.currentStoreId);
    }

    async saveScheduleItems(schedules) {
        this.cacheSchedules();

        if (this.dbManager.updateSchedules) {
            await this.dbManager.updateSchedules(schedules, this.currentStoreId);
            return;
        }

        await this.dbManager.saveSchedules(this.schedules, this.currentStoreId);
    }

    async deleteScheduleItem(scheduleId) {
        this.cacheSchedules();

        if (this.dbManager.deleteSchedule) {
            await this.dbManager.deleteSchedule(scheduleId, this.currentStoreId);
            return;
        }

        await this.dbManager.saveSchedules(this.schedules, this.currentStoreId);
    }

    // 导出排班数据到文件（手动导出）
    exportSchedulesToFile() {
        if (this.schedules.length === 0) {
            alert('暂无排班数据可导出！');
            return;
        }
        
        if (this.saveSchedulesToFile()) {
            this.showSuccessMessage(`成功导出 ${this.schedules.length} 条排班记录到本地文件！`);
        } else {
            alert('导出失败，请重试');
        }
    }

    // 从文件加载排班数据（UI界面）
    async loadSchedulesFromFileUI() {
        try {
            const fileSchedules = await this.loadSchedulesFromFile();
            if (!fileSchedules) {
                return; // 用户取消了文件选择
            }
            
            if (!Array.isArray(fileSchedules) || fileSchedules.length === 0) {
                alert('文件中没有有效的排班数据！');
                return;
            }

            const modeInput = prompt(
                `文件中包含 ${fileSchedules.length} 条排班记录。\n` +
                `当前已有 ${this.schedules.length} 条记录。\n\n` +
                `请选择导入模式：\n\n` +
                `输入 1 = 合并导入（推荐）\n` +
                `  → 追加文件中新的记录，当前数据不受影响\n\n` +
                `输入 2 = 完全覆盖\n` +
                `  → 用文件数据替换当前所有排班记录\n\n` +
                `输入其他或取消 = 放弃操作`
            );
            if (!modeInput || (modeInput !== '1' && modeInput !== '2')) {
                return;
            }
            const isMerge = modeInput === '1';

            let addedCount = 0;
            if (isMerge) {
                const existingIds = new Set(this.schedules.map(r => r.id));
                const newItems = fileSchedules.filter(r => !existingIds.has(r.id));
                addedCount = newItems.length;
                this.schedules = [...this.schedules, ...newItems];
            } else {
                this.schedules = fileSchedules;
            }

            // 导入模式防止 onSnapshot 覆盖
            this.dbManager.beginImport();
            try {
                await this.saveSchedules();
                this.renderTableWithCurrentFilter();
                this.updateStats();
                const loadMsg = isMerge
                    ? `合并完成！新增 ${addedCount} 条，当前共 ${this.schedules.length} 条记录`
                    : `成功从文件加载 ${fileSchedules.length} 条排班记录！`;
                this.showSuccessMessage(loadMsg);
            } catch (error) {
                // 如果localStorage空间不足，提示用户数据已加载但需要保存到文件
                if (error.message.includes('存储空间') || error.message.includes('quota')) {
                    const shouldSaveToFile = confirm(
                        `数据已加载，但无法保存到浏览器存储（空间不足）。\n\n` +
                        `是否立即保存到本地文件？\n\n` +
                        `点击"确定"：保存到文件\n` +
                        `点击"取消"：数据仅在内存中（刷新页面后会丢失）`
                    );

                    if (shouldSaveToFile) {
                        this.saveSchedulesToFile();
                    }

                    this.renderTableWithCurrentFilter();
                    this.updateStats();
                    this.showSuccessMessage(`已从文件加载 ${fileSchedules.length} 条记录！`);
                } else {
                    throw error;
                }
            } finally {
                this.dbManager.endImport();
            }
        } catch (error) {
            alert('从文件加载失败：' + error.message);
        }
    }

    // 异步加载排班数据（由 onSnapshot 自动处理，保留空方法防止调用报错）
    async loadSchedulesAsync() { }

    // 同步加载方法（保持向后兼容）
    loadSchedules() {
        // 如果IndexedDB已经加载了数据，直接返回
        if (this.schedules && this.schedules.length > 0) {
            return this.schedules;
        }
        
        // 否则从localStorage加载
        const saved = localStorage.getItem(this.getStorageKey('schedules'));
        return saved ? JSON.parse(saved) : [];
    }

    // 从本地存储加载项目数据（同步版本，初始化用）
    loadProjects() {
        if (this.projects && this.projects.length > 0) {
            return this.projects;
        }
        const saved = localStorage.getItem(this.getStorageKey('projects'));
        return saved ? JSON.parse(saved) : [];
    }

    // 异步加载项目数据（由 onSnapshot 自动处理）
    async loadProjectsAsync() { }

    // 保存项目数据到 Firestore
    async saveProjects() {
        await this.dbManager.saveProjects(this.projects, this.currentStoreId);
        try { localStorage.setItem(this.getStorageKey('projects'), JSON.stringify(this.projects)); } catch (e) {}
    }

    // 渲染项目列表
    renderProjectList() {
        const projectList = document.getElementById('projectList');
        projectList.innerHTML = '';

        if (this.projects.length === 0) {
            projectList.innerHTML = '<p class="no-projects">暂无项目，请添加项目</p>';
            return;
        }

        this.projects.forEach(project => {
            const projectItem = document.createElement('div');
            projectItem.className = 'project-item';
            projectItem.innerHTML = `
                <div class="project-info">
                    <h4>${project.name}</h4>
                    <p>${project.description || '暂无描述'}</p>
                </div>
                <div class="project-actions">
                    <button class="btn btn-edit" onclick="scheduleManager.editProject('${project.id}')">编辑</button>
                    <button class="btn btn-danger" onclick="scheduleManager.deleteProject('${project.id}')">删除</button>
                </div>
            `;
            projectList.appendChild(projectItem);
        });
    }

    // 更新项目选择器
    updateProjectSelectors() {
        const selectors = [
            document.getElementById('projectName'),
            document.getElementById('editProjectName')
        ];

        selectors.forEach(selector => {
            if (selector) {
                // 保留第一个选项（请选择项目）
                const firstOption = selector.querySelector('option[value=""]');
                selector.innerHTML = '';
                if (firstOption) {
                    selector.appendChild(firstOption);
                }

                // 添加项目选项
                this.projects.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project.name;
                    option.textContent = project.name;
                    selector.appendChild(option);
                });
            }
        });
    }

    // 打开添加项目模态框
    openAddProjectModal() {
        this.editingProjectId = null;
        document.getElementById('projectModalTitle').textContent = '添加项目';
        document.getElementById('projectForm').reset();
        document.getElementById('projectModal').style.display = 'block';
    }

    // 打开项目管理列表模态框
    openProjectListModal() {
        this.renderProjectListModal();
        document.getElementById('projectListModal').style.display = 'block';
    }

    // 渲染项目管理列表模态框
    renderProjectListModal() {
        const container = document.getElementById('projectListContainer');
        container.innerHTML = '';

        if (this.projects.length === 0) {
            container.innerHTML = '<p class="no-projects">暂无项目，请添加项目</p>';
            return;
        }

        this.projects.forEach(project => {
            const projectItem = document.createElement('div');
            projectItem.className = 'project-list-item';
            projectItem.innerHTML = `
                <div class="project-details">
                    <h4>${project.name}</h4>
                    <p>${project.description || '暂无描述'}</p>
                    <small>创建时间: ${this.formatDateTime(project.createdAt)}</small>
                </div>
                <div class="project-actions">
                    <button class="btn btn-edit" onclick="scheduleManager.editProject('${project.id}')">编辑</button>
                    <button class="btn btn-danger" onclick="scheduleManager.deleteProject('${project.id}')">删除</button>
                </div>
            `;
            container.appendChild(projectItem);
        });
    }

    // 保存项目
    saveProject() {
        const formData = {
            name: document.getElementById('projectNameInput').value.trim(),
            description: document.getElementById('projectDescription').value.trim()
        };

        if (!formData.name) {
            alert('请输入项目名称');
            return;
        }

        // 检查项目名称是否已存在（编辑时排除当前项目）
        const existingProject = this.projects.find(p => 
            p.name === formData.name && p.id !== this.editingProjectId
        );

        if (existingProject) {
            alert('项目名称已存在，请使用其他名称');
            return;
        }

        if (this.editingProjectId) {
            // 编辑现有项目
            const projectIndex = this.projects.findIndex(p => p.id === this.editingProjectId);
            if (projectIndex !== -1) {
                this.projects[projectIndex] = {
                    ...this.projects[projectIndex],
                    ...formData,
                    updatedAt: new Date().toISOString()
                };
            }
        } else {
            // 添加新项目
            const newProject = {
                id: Date.now().toString(),
                ...formData,
                createdAt: new Date().toISOString()
            };
            this.projects.push(newProject);
        }

        this.saveProjects();
        this.renderProjectList();
        this.updateProjectSelectors();
        this.updateSalaryProjectSelector(); // 更新薪资管理的项目选择器
        this.closeProjectModal();
        this.showSuccessMessage(this.editingProjectId ? '项目修改成功！' : '项目添加成功！');
    }

    // 编辑项目
    editProject(id) {
        const project = this.projects.find(p => p.id === id);
        if (!project) {
            alert('未找到要编辑的项目');
            return;
        }

        this.editingProjectId = id;
        document.getElementById('projectModalTitle').textContent = '编辑项目';
        document.getElementById('projectNameInput').value = project.name;
        document.getElementById('projectDescription').value = project.description || '';
        document.getElementById('projectModal').style.display = 'block';
    }

    // 删除项目
    deleteProject(id) {
        const project = this.projects.find(p => p.id === id);
        if (!project) {
            alert('未找到要删除的项目');
            return;
        }

        // 检查是否有排班记录使用此项目
        const usedInSchedules = this.schedules.some(schedule => schedule.projectName === project.name);
        
        if (usedInSchedules) {
            alert(`项目"${project.name}"正在被排班记录使用，无法删除。请先修改相关排班记录。`);
            return;
        }

        if (confirm(`确定要删除项目"${project.name}"吗？该项目的薪资档位设置也将被删除。`)) {
            this.projects = this.projects.filter(p => p.id !== id);
            this.saveProjects();
            
            // 删除该项目的薪资档位数据
            if (this.salaryTiers[id]) {
                delete this.salaryTiers[id];
                this.saveSalaryTiersData();
            }
            
            // 如果当前选择的是被删除的项目，清空选择
            if (this.currentSalaryProject === id) {
                this.currentSalaryProject = null;
                this.currentSalaryTier = null;
                document.getElementById('salaryProjectSelect').value = '';
                this.renderSalaryTiers();
                this.renderSalaryEmployeeAssignment();
            }
            
            this.renderProjectList();
            this.updateProjectSelectors();
            this.updateSalaryProjectSelector(); // 更新薪资管理的项目选择器
            this.showSuccessMessage('项目删除成功！');
        }
    }

    // 关闭项目模态框
    closeProjectModal() {
        document.getElementById('projectModal').style.display = 'none';
        this.editingProjectId = null;
        document.getElementById('projectForm').reset();
    }

    // 关闭项目列表模态框
    closeProjectListModal() {
        document.getElementById('projectListModal').style.display = 'none';
    }

    // 异步加载员工数据（由 onSnapshot 自动处理）
    async loadEmployeesAsync() { }

    // 同步加载方法（保持向后兼容）
    loadEmployees() {
        // 如果IndexedDB已经加载了数据，直接返回
        if (this.employees && this.employees.length >= 0) {
            return this.employees;
        }
        
        // 否则从localStorage加载
        const saved = localStorage.getItem(this.getStorageKey('employees'));
        return saved ? JSON.parse(saved) : [];
    }

    // 保存员工数据到 Firestore
    async saveEmployees() {
        await this.dbManager.saveEmployees(this.employees, this.currentStoreId);
        try {
            const dataString = JSON.stringify(this.employees);
            if (new Blob([dataString]).size < 3 * 1024 * 1024) {
                localStorage.setItem(this.getStorageKey('employees'), dataString);
            }
        } catch (e) {}
    }

    // 从本地存储加载坐班费用数据（同步版本，用于初始化）
    loadAttendanceFees() {
        const saved = localStorage.getItem(this.getStorageKey('attendanceFees'));
        return saved ? JSON.parse(saved) : [];
    }

    // 异步加载坐班费用数据（优先从IndexedDB，如果没有则从localStorage并迁移）
    // 异步加载坐班费用数据（由 onSnapshot 自动处理）
    async loadAttendanceFeesAsync() { }

    // 保存坐班费用数据（优先到IndexedDB，localStorage作为备用）
    // 保存坐班费用数据到 Firestore
    async saveAttendanceFees() {
        await this.dbManager.saveAttendanceFees(this.attendanceFees, this.currentStoreId);
        try { localStorage.setItem(this.getStorageKey('attendanceFees'), JSON.stringify(this.attendanceFees)); } catch (e) {}
    }

    // 从本地存储加载面试费用数据（同步版本，初始化用）
    loadInterviewFees() {
        if (this.interviewFees && this.interviewFees.length > 0) {
            return this.interviewFees;
        }
        const saved = localStorage.getItem(this.getStorageKey('interviewFees'));
        return saved ? JSON.parse(saved) : [];
    }

    // 异步加载面试费用数据（优先从IndexedDB + Firebase）
    // 异步加载面试费用数据（由 onSnapshot 自动处理）
    async loadInterviewFeesAsync() { }

    // 保存面试费用数据到 Firestore
    async saveInterviewFees() {
        await this.dbManager.saveInterviewFees(this.interviewFees, this.currentStoreId);
        try { localStorage.setItem(this.getStorageKey('interviewFees'), JSON.stringify(this.interviewFees)); } catch (e) {}
    }

    // 异步加载运营成本数据（由 onSnapshot 自动处理）
    async loadOperatingCostsAsync() { }

    // 同步加载方法（保持向后兼容）
    loadOperatingCosts() {
        // 如果IndexedDB已经加载了数据，直接返回
        if (this.operatingCosts && this.operatingCosts.length >= 0) {
            return this.operatingCosts;
        }
        
        // 否则从localStorage加载
        const saved = localStorage.getItem(this.getStorageKey('operatingCosts'));
        return saved ? JSON.parse(saved) : [];
    }

    // 保存运营成本数据到 Firestore
    async saveOperatingCosts() {
        await this.dbManager.saveOperatingCosts(this.operatingCosts, this.currentStoreId);
        try { localStorage.setItem(this.getStorageKey('operatingCosts'), JSON.stringify(this.operatingCosts)); } catch (e) {}
    }

    // 加载报告返现数据（同步版本，初始化用）
    loadReportRebates() {
        if (this.reportRebates && this.reportRebates.length > 0) {
            return this.reportRebates;
        }
        const saved = localStorage.getItem(this.getStorageKey('reportRebates'));
        return saved ? JSON.parse(saved) : [];
    }

    // 异步加载报告返现数据（由 onSnapshot 自动处理）
    async loadReportRebatesAsync() { }

    // 保存报告返现数据到 Firestore
    async saveReportRebates() {
        await this.dbManager.saveReportRebates(this.reportRebates, this.currentStoreId);
        try { localStorage.setItem(this.getStorageKey('reportRebates'), JSON.stringify(this.reportRebates)); } catch (e) {}
    }

    // 渲染员工列表
    renderEmployeeList() {
        const employeeList = document.getElementById('employeeList');
        employeeList.innerHTML = '';

        if (this.employees.length === 0) {
            employeeList.innerHTML = '<p class="no-employees">暂无员工，请添加员工</p>';
            return;
        }

        this.employees.forEach(employee => {
            const employeeItem = document.createElement('div');
            employeeItem.className = 'employee-item';
            employeeItem.innerHTML = `
                <div class="employee-info">
                    <div class="employee-avatar">
                        ${employee.photo ? `<img src="${employee.photo}" alt="${employee.name}">` : '<div class="default-avatar">👤</div>'}
                    </div>
                    <div class="employee-details">
                        <h4>${employee.name}</h4>
                        <p>${employee.phone || '未设置电话'}</p>
                        ${employee.hireDate ? `<p class="hire-date">入职时间: ${this.formatDate(employee.hireDate)}</p>` : ''}
                        <small>${employee.notes || '暂无备注'}</small>
                    </div>
                </div>
                <div class="employee-actions">
                    <button class="btn btn-edit" onclick="scheduleManager.editEmployee('${employee.id}')">编辑</button>
                    <button class="btn btn-danger" onclick="scheduleManager.deleteEmployee('${employee.id}')">删除</button>
                </div>
            `;
            employeeList.appendChild(employeeItem);
        });
    }

    // 更新员工选择器（员工数据由 onSnapshot 实时推送，this.employees 始终最新）
    async updateEmployeeSelectors() {
        const selectors = [
            document.getElementById('employeeName'),
            document.getElementById('editEmployeeName'),
            document.getElementById('attendanceEmployee'),
            document.getElementById('interviewEmployee'),
            document.getElementById('reportRebateEmployee')
        ];

        selectors.forEach(selector => {
            if (selector) {
                // 保留第一个选项（请选择员工）
                const firstOption = selector.querySelector('option[value=""]');
                const currentValue = selector.value; // 保存当前选中的值
                selector.innerHTML = '';
                if (firstOption) {
                    selector.appendChild(firstOption);
                }

                // 添加员工选项
                this.employees.forEach(employee => {
                    const option = document.createElement('option');
                    option.value = employee.name;
                    option.textContent = employee.name;
                    selector.appendChild(option);
                });

                // 恢复之前选中的值（如果还存在）
                if (currentValue && Array.from(selector.options).some(opt => opt.value === currentValue)) {
                    selector.value = currentValue;
                }
            }
        });
    }

    // 打开添加员工模态框
    openAddEmployeeModal() {
        this.editingEmployeeId = null;
        document.getElementById('employeeModalTitle').textContent = '添加员工';
        document.getElementById('employeeForm').reset();
        document.getElementById('employeeModal').style.display = 'block';
    }

    // 打开员工管理列表模态框
    openEmployeeListModal() {
        this.renderEmployeeListModal();
        document.getElementById('employeeListModal').style.display = 'block';
    }

    // 渲染员工管理列表模态框
    renderEmployeeListModal() {
        const container = document.getElementById('employeeListContainer');
        container.innerHTML = '';

        if (this.employees.length === 0) {
            container.innerHTML = '<p class="no-employees">暂无员工，请添加员工</p>';
            return;
        }

        this.employees.forEach(employee => {
            const employeeItem = document.createElement('div');
            employeeItem.className = 'employee-list-item';
            employeeItem.innerHTML = `
                <div class="employee-details">
                    <div class="employee-avatar-large">
                        ${employee.photo ? `<img src="${employee.photo}" alt="${employee.name}">` : '<div class="default-avatar-large">👤</div>'}
                    </div>
                    <div class="employee-info-text">
                        <h4>${employee.name}</h4>
                        <p><strong>电话：</strong>${employee.phone || '未设置'}</p>
                        ${employee.hireDate ? `<p><strong>入职时间：</strong>${this.formatDate(employee.hireDate)}</p>` : ''}
                        <p><strong>备注：</strong>${employee.notes || '暂无备注'}</p>
                        <small>创建时间: ${this.formatDateTime(employee.createdAt)}</small>
                    </div>
                </div>
                <div class="employee-actions">
                    <button class="btn btn-edit" onclick="scheduleManager.editEmployee('${employee.id}')">编辑</button>
                    <button class="btn btn-danger" onclick="scheduleManager.deleteEmployee('${employee.id}')">删除</button>
                </div>
            `;
            container.appendChild(employeeItem);
        });
    }

    // 保存员工
    saveEmployee() {
        const formData = {
            name: document.getElementById('employeeNameInput').value.trim(),
            phone: document.getElementById('employeePhone').value.trim(),
            hireDate: document.getElementById('employeeHireDate').value,
            notes: document.getElementById('employeeNotes').value.trim(),
            photo: this.currentPhotoData || null
        };

        console.log('保存员工数据:', formData); // 调试信息

        if (!formData.name) {
            alert('请输入员工姓名');
            return;
        }

        // 检查员工姓名是否已存在（编辑时排除当前员工）
        const existingEmployee = this.employees.find(e => 
            e.name === formData.name && e.id !== this.editingEmployeeId
        );

        if (existingEmployee) {
            alert('员工姓名已存在，请使用其他姓名');
            return;
        }

        // 验证手机号码格式（如果填写了）
        if (formData.phone && !this.validatePhone(formData.phone)) {
            alert('请输入正确的手机号码格式');
            return;
        }

        if (this.editingEmployeeId) {
            // 编辑现有员工
            const employeeIndex = this.employees.findIndex(e => e.id === this.editingEmployeeId);
            if (employeeIndex !== -1) {
                const oldEmployee = this.employees[employeeIndex];
                const oldName = oldEmployee.name;
                const newName = formData.name;
                
                // 更新员工信息
                this.employees[employeeIndex] = {
                    ...this.employees[employeeIndex],
                    ...formData,
                    updatedAt: new Date().toISOString()
                };
                
                // 如果员工姓名发生变化，更新所有相关的排班记录
                if (oldName !== newName) {
                    this.updateScheduleEmployeeNames(oldName, newName);
                }
            }
        } else {
            // 添加新员工
            const newEmployee = {
                id: Date.now().toString(),
                ...formData,
                createdAt: new Date().toISOString()
            };
            this.employees.push(newEmployee);
        }

        // 异步保存（不阻塞界面）
        this.saveEmployees().then(() => {
            // 保存成功，更新界面
            this.renderEmployeeList();
            this.updateEmployeeSelectors().catch(err => console.error('更新员工选择器失败:', err));
            this.updateAttendanceFeeSelectors();
            this.updateInterviewFeeSelectors();
            this.closeEmployeeModal();
            this.showSuccessMessage(this.editingEmployeeId ? '员工信息修改成功！' : '员工添加成功！');
        }).catch((error) => {
            // 保存失败
            console.error('保存员工失败:', error);
            // saveEmployees已经显示了错误提示，这里只更新界面（数据在内存中）
            this.renderEmployeeList();
            this.updateEmployeeSelectors().catch(err => console.error('更新员工选择器失败:', err));
            this.updateAttendanceFeeSelectors();
            this.updateInterviewFeeSelectors();
        });
    }

    // 验证手机号码格式
    validatePhone(phone) {
        const phoneRegex = /^1[3-9]\d{9}$/;
        return phoneRegex.test(phone);
    }

    // 编辑员工
    editEmployee(id) {
        const employee = this.employees.find(e => e.id === id);
        if (!employee) {
            alert('未找到要编辑的员工');
            return;
        }

        this.editingEmployeeId = id;
        this.currentPhotoData = employee.photo || null;
        
        document.getElementById('employeeModalTitle').textContent = '编辑员工';
        document.getElementById('employeeNameInput').value = employee.name;
        document.getElementById('employeePhone').value = employee.phone || '';
        document.getElementById('employeeHireDate').value = employee.hireDate || '';
        document.getElementById('employeeNotes').value = employee.notes || '';
        
        // 显示现有头像
        this.displayPhoto(employee.photo);
        
        document.getElementById('employeeModal').style.display = 'block';
    }

    // 删除员工
    deleteEmployee(id) {
        const employee = this.employees.find(e => e.id === id);
        if (!employee) {
            alert('未找到要删除的员工');
            return;
        }

        // 检查是否有排班记录使用此员工
        const usedInSchedules = this.schedules.some(schedule => schedule.employeeName === employee.name);
        
        if (usedInSchedules) {
            alert(`员工"${employee.name}"正在被排班记录使用，无法删除。请先修改相关排班记录。`);
            return;
        }

        if (confirm(`确定要删除员工"${employee.name}"吗？`)) {
            this.employees = this.employees.filter(e => e.id !== id);
            this.saveEmployees().then(() => {
                this.renderEmployeeList();
                this.updateEmployeeSelectors().catch(err => console.error('更新员工选择器失败:', err));
                this.updateAttendanceFeeSelectors();
                this.updateInterviewFeeSelectors();
                this.showSuccessMessage('员工删除成功！');
            }).catch((error) => {
                console.error('保存失败:', error);
                // 即使保存失败，也更新界面（数据已在内存中删除）
                this.renderEmployeeList();
                this.updateEmployeeSelectors().catch(err => console.error('更新员工选择器失败:', err));
                this.updateAttendanceFeeSelectors();
                this.updateInterviewFeeSelectors();
            });
        }
    }

    // 关闭员工模态框
    closeEmployeeModal() {
        document.getElementById('employeeModal').style.display = 'none';
        this.editingEmployeeId = null;
        this.currentPhotoData = null;
        document.getElementById('employeeForm').reset();
        this.resetPhotoUpload();
    }

    // 关闭员工列表模态框
    closeEmployeeListModal() {
        document.getElementById('employeeListModal').style.display = 'none';
    }

    // 处理图片上传
    handlePhotoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // 验证文件类型
        if (!file.type.startsWith('image/')) {
            alert('请选择图片文件');
            return;
        }

        // 验证文件大小 (最大2MB)
        if (file.size > 2 * 1024 * 1024) {
            alert('图片大小不能超过2MB');
            return;
        }

        // 压缩图片
        this.compressImage(file, (compressedData) => {
            this.currentPhotoData = compressedData;
            this.displayPhoto(compressedData);
        });
    }

    // 压缩图片
    compressImage(file, callback) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
            // 设置最大尺寸
            const maxWidth = 200;
            const maxHeight = 200;
            
            let { width, height } = img;
            
            // 计算压缩后的尺寸
            if (width > height) {
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = (width * maxHeight) / height;
                    height = maxHeight;
                }
            }

            canvas.width = width;
            canvas.height = height;

            // 绘制压缩后的图片
            ctx.drawImage(img, 0, 0, width, height);
            
            // 转换为base64，质量设置为0.8
            const compressedData = canvas.toDataURL('image/jpeg', 0.8);
            callback(compressedData);
        };

        img.onerror = () => {
            alert('图片加载失败，请选择其他图片');
        };

        // 读取文件
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target.result;
        };
        reader.onerror = () => {
            alert('文件读取失败');
        };
        reader.readAsDataURL(file);
    }

    // 显示图片预览
    displayPhoto(photoData) {
        const preview = document.getElementById('photoPreview');
        const placeholder = document.getElementById('photoUploadPlaceholder');
        const previewImg = document.getElementById('photoPreviewImg');

        if (photoData) {
            previewImg.src = photoData;
            preview.style.display = 'block';
            placeholder.style.display = 'none';
        } else {
            preview.style.display = 'none';
            placeholder.style.display = 'block';
        }
    }

    // 移除图片
    removePhoto() {
        this.currentPhotoData = null;
        this.resetPhotoUpload();
    }

    // 重置图片上传区域
    resetPhotoUpload() {
        document.getElementById('employeePhoto').value = '';
        document.getElementById('photoPreview').style.display = 'none';
        document.getElementById('photoUploadPlaceholder').style.display = 'block';
    }

    // 获取客户出现次数
    getClientCount(clientName) {
        return this.schedules.filter(schedule => schedule.clientName === clientName).length;
    }

    // 更新排班记录中的员工姓名
    updateScheduleEmployeeNames(oldName, newName) {
        let updatedCount = 0;
        const changedSchedules = [];
        
        // 更新排班记录中的员工姓名
        this.schedules.forEach(schedule => {
            if (schedule.employeeName === oldName) {
                schedule.employeeName = newName;
                schedule.updatedAt = new Date().toISOString();
                changedSchedules.push(schedule);
                updatedCount++;
            }
        });
        
        // 更新坐班费用记录中的员工姓名
        this.attendanceFees.forEach(fee => {
            if (fee.employeeName === oldName) {
                fee.employeeName = newName;
                fee.updatedAt = new Date().toISOString();
            }
        });
        
        // 只保存受影响的排班记录，避免员工改名时重写整个 schedules 集合
        this.saveScheduleItems(changedSchedules).catch(err => console.error('保存关联排班失败:', err));
        this.saveAttendanceFees().catch(err => console.error('保存坐班费用失败:', err));
        
        // 更新显示
        this.renderTableWithCurrentFilter();
        this.renderAttendanceFeeTable();
        this.updateStats();
        this.renderEmployeeCommissionSummary();
        
        // 显示更新结果
        if (updatedCount > 0) {
            this.showSuccessMessage(`员工姓名已更新！已同步更新 ${updatedCount} 条排班记录`);
        }
    }

    // 自动设置结束时间（开始时间后1小时）
    autoSetEndTime(startTime) {
        if (!startTime) return;
        
        try {
            // 解析开始时间
            const [hours, minutes] = startTime.split(':').map(Number);
            
            // 计算结束时间（加1小时）
            let endHours = hours + 1;
            let endMinutes = minutes;
            
            // 处理跨天情况（24小时制）
            if (endHours >= 24) {
                endHours = endHours - 24;
            }
            
            // 格式化为HH:MM
            const endTime = `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
            
            // 设置结束时间
            document.getElementById('endTime').value = endTime;
        } catch (error) {
            console.error('自动设置结束时间失败:', error);
        }
    }

    // 自动设置编辑模态框的结束时间（开始时间后1小时）
    autoSetEditEndTime(startTime) {
        if (!startTime) return;
        
        try {
            // 解析开始时间
            const [hours, minutes] = startTime.split(':').map(Number);
            
            // 计算结束时间（加1小时）
            let endHours = hours + 1;
            let endMinutes = minutes;
            
            // 处理跨天情况（24小时制）
            if (endHours >= 24) {
                endHours = endHours - 24;
            }
            
            // 格式化为HH:MM
            const endTime = `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
            
            // 设置编辑模态框的结束时间
            document.getElementById('editEndTime').value = endTime;
        } catch (error) {
            console.error('自动设置编辑结束时间失败:', error);
        }
    }

    // 添加坐班费用
    addAttendanceFee() {
        const formData = {
            date: document.getElementById('attendanceDate').value,
            employeeName: document.getElementById('attendanceEmployee').value,
            fee: parseFloat(document.getElementById('attendanceFee').value)
        };

        if (!formData.date) {
            alert('请选择坐班日期');
            return;
        }
        if (!formData.employeeName) {
            alert('请选择员工');
            return;
        }
        if (!formData.fee || formData.fee < 0) {
            alert('请输入有效的坐班费用');
            return;
        }

        // 如果是编辑模式
        if (this.editingAttendanceFeeId) {
            const existingFee = this.attendanceFees.find(fee => fee.id === this.editingAttendanceFeeId);
            if (existingFee) {
                existingFee.date = formData.date;
                existingFee.employeeName = formData.employeeName;
                existingFee.fee = formData.fee;
                existingFee.updatedAt = new Date().toISOString();
                this.showSuccessMessage('坐班费用修改成功！');
            }
        } else {
            // 检查是否已存在相同日期和员工的记录
            const existingFee = this.attendanceFees.find(fee => 
                fee.date === formData.date && fee.employeeName === formData.employeeName
            );

            if (existingFee) {
                if (confirm('该员工在该日期已有坐班费用记录，是否要更新？')) {
                    existingFee.fee = formData.fee;
                    existingFee.updatedAt = new Date().toISOString();
                } else {
                    return;
                }
            } else {
                const attendanceFee = {
                    id: Date.now().toString(),
                    ...formData,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                this.attendanceFees.push(attendanceFee);
                console.log('添加坐班费用:', attendanceFee);
                console.log('当前坐班费用总数:', this.attendanceFees.length);
            }
            this.showSuccessMessage('坐班费用添加成功！');
        }

        // 保存数据（异步保存，但立即渲染表格）
        this.saveAttendanceFees().then(() => {
            console.log('保存后的坐班费用总数:', this.attendanceFees.length);
            console.log('保存后的坐班费用数据:', this.attendanceFees);
        }).catch(error => {
            console.error('保存坐班费用失败:', error);
            // 即使保存失败，也显示数据（数据已在内存中）
        });
        
        // 立即渲染表格（数据已经在 this.attendanceFees 中）
        this.renderAttendanceFeeTable();
        this.updateStats();
        this.clearAttendanceFeeForm();
    }

    // 渲染坐班费用表格
    renderAttendanceFeeTable() {
        const tbody = document.getElementById('attendanceFeeTableBody');
        if (!tbody) {
            console.error('找不到坐班费用表格元素 attendanceFeeTableBody');
            return;
        }

        // 确保 attendanceFees 是数组
        if (!Array.isArray(this.attendanceFees)) {
            console.error('attendanceFees 不是数组:', this.attendanceFees);
            this.attendanceFees = [];
        }

        tbody.innerHTML = '';

        if (this.attendanceFees.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="no-data">暂无坐班费用记录</td></tr>';
            return;
        }

        // 按日期排序
        const sortedFees = [...this.attendanceFees].sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB - dateA;
        });

        sortedFees.forEach(fee => {
            if (!fee || !fee.id || !fee.date || !fee.employeeName || fee.fee === undefined) {
                console.warn('坐班费用数据格式不正确:', fee);
                return;
            }
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${this.formatDate(fee.date)}</td>
                <td>${fee.employeeName}</td>
                <td>¥${parseFloat(fee.fee).toFixed(2)}</td>
                <td>
                    <button class="btn btn-edit" onclick="scheduleManager.editAttendanceFee('${fee.id}')">编辑</button>
                    <button class="btn btn-danger" onclick="scheduleManager.deleteAttendanceFee('${fee.id}')">删除</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // 更新坐班费用员工选择器
    updateAttendanceFeeSelectors() {
        const selectors = [
            document.getElementById('attendanceEmployee')
        ];

        selectors.forEach(selector => {
            if (selector) {
                // 保存当前选中的值
                const currentValue = selector.value;
                
                // 清空选项（保留第一个默认选项）
                selector.innerHTML = '<option value="">请选择员工</option>';
                
                // 添加员工选项
                this.employees.forEach(employee => {
                    const option = document.createElement('option');
                    option.value = employee.name;
                    option.textContent = employee.name;
                    selector.appendChild(option);
                });
                
                // 恢复之前选中的值
                if (currentValue) {
                    selector.value = currentValue;
                }
            }
        });
    }

    // 编辑坐班费用
    editAttendanceFee(id) {
        const fee = this.attendanceFees.find(f => f.id === id);
        if (!fee) {
            alert('未找到要编辑的坐班费用记录');
            return;
        }

        // 填充表单
        document.getElementById('attendanceDate').value = fee.date;
        document.getElementById('attendanceEmployee').value = fee.employeeName;
        document.getElementById('attendanceFee').value = fee.fee;

        // 标记为编辑模式
        this.editingAttendanceFeeId = id;

        // 滚动到表单位置
        document.querySelector('.attendance-fee-form').scrollIntoView({ behavior: 'smooth' });
    }

    // 删除坐班费用
    deleteAttendanceFee(id) {
        const fee = this.attendanceFees.find(f => f.id === id);
        if (!fee) {
            alert('未找到要删除的坐班费用记录');
            return;
        }

        if (confirm(`确定要删除 ${fee.employeeName} 在 ${this.formatDate(fee.date)} 的坐班费用记录吗？`)) {
            this.attendanceFees = this.attendanceFees.filter(f => f.id !== id);
            this.saveAttendanceFees().catch(err => {
                console.error('保存坐班费用失败:', err);
                alert('删除坐班费用失败：' + err.message);
            });
            this.renderAttendanceFeeTable();
            this.updateStats();
            this.showSuccessMessage('坐班费用删除成功！');
        }
    }

    // 清除所有坐班费用
    clearAllAttendanceFees() {
        if (this.attendanceFees.length === 0) {
            alert('当前没有坐班费用记录需要清除');
            return;
        }

        if (confirm('确定要清除所有坐班费用记录吗？此操作不可恢复！')) {
            const confirmText = prompt('请输入"确认清除"来确认此操作：');
            if (confirmText === '确认清除') {
                this.attendanceFees = [];
                this.saveAttendanceFees().catch(err => {
                    console.error('保存坐班费用失败:', err);
                    alert('清除坐班费用失败：' + err.message);
                });
                this.renderAttendanceFeeTable();
                this.updateStats();
                this.showSuccessMessage('所有坐班费用记录已清除！');
            } else {
                alert('操作已取消');
            }
        }
    }

    // 清空坐班费用表单
    clearAttendanceFeeForm() {
        document.getElementById('attendanceFeeForm').reset();
        this.editingAttendanceFeeId = null;
    }

    // 添加面试费用
    addInterviewFee() {
        const formData = {
            date: document.getElementById('interviewDate').value,
            employeeName: document.getElementById('interviewEmployee').value,
            fee: parseFloat(document.getElementById('interviewFee').value)
        };

        if (!formData.date) {
            alert('请选择面试日期');
            return;
        }
        if (!formData.employeeName) {
            alert('请选择员工');
            return;
        }
        if (!formData.fee || formData.fee < 0) {
            alert('请输入有效的面试费用');
            return;
        }

        // 如果是编辑模式
        if (this.editingInterviewFeeId) {
            const existingFee = this.interviewFees.find(fee => fee.id === this.editingInterviewFeeId);
            if (existingFee) {
                existingFee.date = formData.date;
                existingFee.employeeName = formData.employeeName;
                existingFee.fee = formData.fee;
                existingFee.updatedAt = new Date().toISOString();
                this.showSuccessMessage('面试费用修改成功！');
            }
        } else {
            // 检查是否已存在相同日期和员工的记录
            const existingFee = this.interviewFees.find(fee => 
                fee.date === formData.date && fee.employeeName === formData.employeeName
            );

            if (existingFee) {
                if (confirm('该员工在该日期已有面试费用记录，是否要更新？')) {
                    existingFee.fee = formData.fee;
                    existingFee.updatedAt = new Date().toISOString();
                } else {
                    return;
                }
            } else {
                const interviewFee = {
                    id: Date.now().toString(),
                    ...formData,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                this.interviewFees.push(interviewFee);
            }
            this.showSuccessMessage('面试费用添加成功！');
        }

        this.saveInterviewFees();
        this.renderInterviewFeeTable();
        this.updateStats();
        this.clearInterviewFeeForm();
    }

    // 渲染面试费用表格
    renderInterviewFeeTable() {
        const tbody = document.getElementById('interviewFeeTableBody');
        tbody.innerHTML = '';

        if (this.interviewFees.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="no-data">暂无面试费用记录</td></tr>';
            return;
        }

        // 按日期排序
        const sortedFees = [...this.interviewFees].sort((a, b) => new Date(b.date) - new Date(a.date));

        sortedFees.forEach(fee => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${this.formatDate(fee.date)}</td>
                <td>${fee.employeeName}</td>
                <td>¥${fee.fee.toFixed(2)}</td>
                <td>
                    <button class="btn btn-edit" onclick="scheduleManager.editInterviewFee('${fee.id}')">编辑</button>
                    <button class="btn btn-danger" onclick="scheduleManager.deleteInterviewFee('${fee.id}')">删除</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // 更新面试费用员工选择器
    updateInterviewFeeSelectors() {
        const selectors = [
            document.getElementById('interviewEmployee')
        ];

        selectors.forEach(selector => {
            if (selector) {
                // 保存当前选中的值
                const currentValue = selector.value;
                
                // 清空选项（保留第一个默认选项）
                selector.innerHTML = '<option value="">请选择员工</option>';
                
                // 添加员工选项
                this.employees.forEach(employee => {
                    const option = document.createElement('option');
                    option.value = employee.name;
                    option.textContent = employee.name;
                    selector.appendChild(option);
                });
                
                // 恢复之前选中的值
                if (currentValue) {
                    selector.value = currentValue;
                }
            }
        });
    }

    // 编辑面试费用
    editInterviewFee(id) {
        const fee = this.interviewFees.find(f => f.id === id);
        if (!fee) {
            alert('未找到要编辑的面试费用记录');
            return;
        }

        // 填充表单
        document.getElementById('interviewDate').value = fee.date;
        document.getElementById('interviewEmployee').value = fee.employeeName;
        document.getElementById('interviewFee').value = fee.fee;

        // 标记为编辑模式
        this.editingInterviewFeeId = id;

        // 滚动到表单位置
        document.querySelector('.interview-fee-form').scrollIntoView({ behavior: 'smooth' });
    }

    // 删除面试费用
    deleteInterviewFee(id) {
        const fee = this.interviewFees.find(f => f.id === id);
        if (!fee) {
            alert('未找到要删除的面试费用记录');
            return;
        }

        if (confirm(`确定要删除 ${fee.employeeName} 在 ${this.formatDate(fee.date)} 的面试费用记录吗？`)) {
            this.interviewFees = this.interviewFees.filter(f => f.id !== id);
            this.saveInterviewFees();
            this.renderInterviewFeeTable();
            this.updateStats();
            this.showSuccessMessage('面试费用删除成功！');
        }
    }

    // 清除所有面试费用
    clearAllInterviewFees() {
        if (this.interviewFees.length === 0) {
            alert('当前没有面试费用记录需要清除');
            return;
        }

        if (confirm('确定要清除所有面试费用记录吗？此操作不可恢复！')) {
            const confirmText = prompt('请输入"确认清除"来确认此操作：');
            if (confirmText === '确认清除') {
                this.interviewFees = [];
                this.saveInterviewFees();
                this.renderInterviewFeeTable();
                this.updateStats();
                this.showSuccessMessage('所有面试费用记录已清除！');
            } else {
                alert('操作已取消');
            }
        }
    }

    // 清空面试费用表单
    clearInterviewFeeForm() {
        document.getElementById('interviewFeeForm').reset();
        this.editingInterviewFeeId = null;
    }

    // 添加运营成本
    addOperatingCost() {
        // 检查表单元素是否存在
        const dateEl = document.getElementById('operatingCostDate');
        const categoryEl = document.getElementById('operatingCostCategory');
        const itemEl = document.getElementById('operatingCostItem');
        const noteEl = document.getElementById('operatingCostNote');
        const amountEl = document.getElementById('operatingCostAmount');
        
        if (!dateEl || !categoryEl || !itemEl || !noteEl || !amountEl) {
            console.error('运营成本表单元素不存在:', { dateEl, categoryEl, itemEl, noteEl, amountEl });
            alert('表单元素加载失败，请刷新页面重试');
            return;
        }
        
        const formData = {
            date: dateEl.value,
            category: categoryEl.value,
            item: itemEl.value.trim(),
            note: noteEl.value.trim(),
            amount: parseFloat(amountEl.value)
        };

        if (!formData.date) {
            alert('请选择时间');
            return;
        }
        if (!formData.category) {
            alert('请选择分类');
            return;
        }
        if (!formData.item) {
            alert('请输入费用项目名称');
            return;
        }
        if (!formData.amount || formData.amount < 0) {
            alert('请输入有效的金额');
            return;
        }

        // 如果是编辑模式
        if (this.editingOperatingCostId) {
            const existingCost = this.operatingCosts.find(cost => cost.id === this.editingOperatingCostId);
            if (existingCost) {
                existingCost.date = formData.date;
                existingCost.category = formData.category;
                existingCost.item = formData.item;
                existingCost.note = formData.note;
                existingCost.amount = formData.amount;
                existingCost.updatedAt = new Date().toISOString();
                this.showSuccessMessage('运营成本修改成功！');
            }
        } else {
            // 添加新记录
            const operatingCost = {
                id: Date.now().toString(),
                ...formData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            this.operatingCosts.push(operatingCost);
            this.showSuccessMessage('运营成本添加成功！');
        }

        // 异步保存（不阻塞界面）
        this.saveOperatingCosts().then(() => {
            // 保存成功，更新界面
            this.renderOperatingCostTable();
            this.updateStats();
            this.updateOperatingCostStats();
            this.updateOperatingCostCharts();
            this.clearOperatingCostForm();
        }).catch((error) => {
            // 保存失败，但数据已在内存中
            console.error('保存运营成本失败:', error);
            // saveOperatingCosts已经显示了错误提示，这里只更新界面（数据在内存中）
            this.renderOperatingCostTable();
            this.updateStats();
            this.updateOperatingCostStats();
            this.updateOperatingCostCharts();
            this.clearOperatingCostForm();
        });
    }

    // 渲染运营成本表格
    renderOperatingCostTable() {
        const tbody = document.getElementById('operatingCostTableBody');
        tbody.innerHTML = '';

        if (this.operatingCosts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">暂无运营成本记录</td></tr>';
            return;
        }

        // 按日期排序
        const sortedCosts = [...this.operatingCosts].sort((a, b) => new Date(b.date) - new Date(a.date));

        sortedCosts.forEach(cost => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${this.formatDate(cost.date)}</td>
                <td>${cost.category || '-'}</td>
                <td>${cost.item}</td>
                <td>${cost.note || '-'}</td>
                <td>¥${cost.amount.toFixed(2)}</td>
                <td>
                    <button class="btn btn-edit" onclick="scheduleManager.editOperatingCost('${cost.id}')">编辑</button>
                    <button class="btn btn-danger" onclick="scheduleManager.deleteOperatingCost('${cost.id}')">删除</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // 更新运营成本统计卡片
    updateOperatingCostStats() {
        if (this.operatingCosts.length === 0) {
            document.getElementById('totalOperatingCostAmount').textContent = '¥0';
            document.getElementById('monthlyOperatingCost').textContent = '¥0';
            document.getElementById('avgDailyOperatingCost').textContent = '¥0';
            document.getElementById('topOperatingCostCategory').textContent = '--';
            return;
        }

        // 总成本金额
        const totalAmount = this.operatingCosts.reduce((sum, cost) => sum + cost.amount, 0);
        document.getElementById('totalOperatingCostAmount').textContent = `¥${totalAmount.toFixed(2)}`;

        // 本月成本
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthlyCosts = this.operatingCosts.filter(cost => {
            const costDate = new Date(cost.date);
            return costDate >= firstDayOfMonth;
        });
        const monthlyAmount = monthlyCosts.reduce((sum, cost) => sum + cost.amount, 0);
        document.getElementById('monthlyOperatingCost').textContent = `¥${monthlyAmount.toFixed(2)}`;

        // 平均日成本
        const dates = [...new Set(this.operatingCosts.map(cost => cost.date))];
        const avgDaily = dates.length > 0 ? totalAmount / dates.length : 0;
        document.getElementById('avgDailyOperatingCost').textContent = `¥${avgDaily.toFixed(2)}`;

        // 成本最高分类
        const categoryStats = {};
        this.operatingCosts.forEach(cost => {
            const category = cost.category || '未分类';
            if (!categoryStats[category]) {
                categoryStats[category] = 0;
            }
            categoryStats[category] += cost.amount;
        });
        const topCategory = Object.keys(categoryStats).reduce((a, b) => 
            categoryStats[a] > categoryStats[b] ? a : b, Object.keys(categoryStats)[0]
        );
        const topCategoryAmount = categoryStats[topCategory] || 0;
        document.getElementById('topOperatingCostCategory').textContent = 
            topCategory ? `${topCategory} (¥${topCategoryAmount.toFixed(2)})` : '--';
    }

    // 初始化运营成本图表
    initializeOperatingCostCharts() {
        // 如果图表已存在，先销毁并置空，确保重新创建
        if (this.operatingCostCategoryChart) {
            this.operatingCostCategoryChart.destroy();
            this.operatingCostCategoryChart = null;
        }
        if (this.operatingCostTrendChart) {
            this.operatingCostTrendChart.destroy();
            this.operatingCostTrendChart = null;
        }

        this.updateOperatingCostCharts();
    }

    // 更新运营成本图表
    updateOperatingCostCharts() {
        const dateRangeValue = document.getElementById('operatingCostChartDateRange')?.value || 'all';
        const chartType = document.getElementById('operatingCostChartType')?.value || 'month';
        
        // 筛选数据
        let filteredCosts = this.operatingCosts;
        if (dateRangeValue !== 'all') {
            const days = parseInt(dateRangeValue);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            filteredCosts = this.operatingCosts.filter(cost => {
                const costDate = new Date(cost.date);
                return costDate >= cutoffDate;
            });
        }

        // 更新分类占比饼图
        this.updateOperatingCostCategoryChart(filteredCosts);
        
        // 更新趋势图
        this.updateOperatingCostTrendChart(filteredCosts, chartType);
    }

    // 更新成本分类水平条形图
    updateOperatingCostCategoryChart(costs) {
        const categoryMap = {};
        costs.forEach(cost => {
            const category = cost.category || '其他';
            categoryMap[category] = (categoryMap[category] || 0) + cost.amount;
        });

        // 按金额降序排列
        const sorted = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
        const labels = sorted.map(e => e[0]);
        const data = sorted.map(e => e[1]);

        const barColor = 'rgba(37, 99, 235, 0.75)';
        const barHover = 'rgba(37, 99, 235, 1)';

        const ctx = document.getElementById('operatingCostCategoryChart');
        if (!ctx) return;

        if (this.operatingCostCategoryChart) {
            this.operatingCostCategoryChart.data.labels = labels;
            this.operatingCostCategoryChart.data.datasets[0].data = data;
            this.operatingCostCategoryChart.update();
        } else {
            this.operatingCostCategoryChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: barColor,
                        hoverBackgroundColor: barHover,
                        borderRadius: 4,
                        barThickness: 28
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `¥${context.parsed.x.toLocaleString()}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.04)' },
                            ticks: {
                                callback: v => '¥' + v.toLocaleString(),
                                font: { size: 11 }
                            }
                        },
                        y: {
                            grid: { display: false },
                            ticks: { font: { size: 12 } }
                        }
                    }
                }
            });
        }
    }

    // 更新成本趋势柱状图（按周/月分组，各分类堆叠）
    updateOperatingCostTrendChart(costs, chartType) {
        const categories = ['推广费用', '人力成本', '房租租金', '损耗开销', '其他'];
        const categoryColors = {
            '推广费用': 'rgba(37, 99, 235, 0.8)',
            '人力成本': 'rgba(16, 185, 129, 0.8)',
            '房租租金': 'rgba(245, 158, 11, 0.8)',
            '损耗开销': 'rgba(239, 68, 68, 0.8)',
            '其他':     'rgba(156, 163, 175, 0.8)'
        };

        // 按时间段 + 分类聚合
        const grouped = {}; // { key: { category: amount } }
        costs.forEach(cost => {
            const date = new Date(cost.date);
            let key;
            if (chartType === 'day') {
                key = date.toISOString().split('T')[0];
            } else if (chartType === 'week') {
                const weekStart = new Date(date);
                weekStart.setDate(date.getDate() - date.getDay());
                key = weekStart.toISOString().split('T')[0];
            } else {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            }
            const cat = categories.includes(cost.category) ? cost.category : '其他';
            if (!grouped[key]) grouped[key] = {};
            grouped[key][cat] = (grouped[key][cat] || 0) + cost.amount;
        });

        const sortedKeys = Object.keys(grouped).sort();
        const labels = sortedKeys.map(key => {
            if (chartType === 'month') {
                const [year, month] = key.split('-');
                return `${year}/${parseInt(month)}月`;
            } else if (chartType === 'week') {
                return key.slice(5); // MM-DD
            } else {
                return key.slice(5); // MM-DD
            }
        });

        // 只保留有数据的分类
        const activeCategories = categories.filter(cat =>
            sortedKeys.some(k => grouped[k][cat] > 0)
        );

        const datasets = activeCategories.map(cat => ({
            label: cat,
            data: sortedKeys.map(k => grouped[k][cat] || 0),
            backgroundColor: categoryColors[cat],
            borderRadius: 3,
            borderSkipped: false
        }));

        const ctx = document.getElementById('operatingCostTrendChart');
        if (!ctx) return;

        if (this.operatingCostTrendChart) {
            this.operatingCostTrendChart.data.labels = labels;
            this.operatingCostTrendChart.data.datasets = datasets;
            this.operatingCostTrendChart.update();
        } else {
            this.operatingCostTrendChart = new Chart(ctx, {
                type: 'bar',
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: { font: { size: 11 }, padding: 10, boxWidth: 12 }
                        },
                        tooltip: {
                            callbacks: {
                                label: ctx => `${ctx.dataset.label}: ¥${ctx.parsed.y.toLocaleString()}`
                            }
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            grid: { display: false },
                            ticks: { font: { size: 11 } }
                        },
                        y: {
                            stacked: true,
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.04)' },
                            ticks: {
                                callback: v => '¥' + v.toLocaleString(),
                                font: { size: 11 }
                            }
                        }
                    }
                }
            });
        }
    }

    // 编辑运营成本
    editOperatingCost(id) {
        const cost = this.operatingCosts.find(c => c.id === id);
        if (!cost) {
            alert('未找到要编辑的运营成本记录');
            return;
        }

        // 填充表单
        document.getElementById('operatingCostDate').value = cost.date;
        document.getElementById('operatingCostCategory').value = cost.category || '';
        document.getElementById('operatingCostItem').value = cost.item;
        document.getElementById('operatingCostNote').value = cost.note || '';
        document.getElementById('operatingCostAmount').value = cost.amount;

        // 标记为编辑模式
        this.editingOperatingCostId = id;

        // 滚动到表单位置
        document.querySelector('.operating-cost-form').scrollIntoView({ behavior: 'smooth' });
    }

    // 删除运营成本
    deleteOperatingCost(id) {
        const cost = this.operatingCosts.find(c => c.id === id);
        if (!cost) {
            alert('未找到要删除的运营成本记录');
            return;
        }

        if (confirm(`确定要删除"${cost.item}"在 ${this.formatDate(cost.date)} 的运营成本记录吗？`)) {
            this.operatingCosts = this.operatingCosts.filter(c => c.id !== id);
            this.saveOperatingCosts().then(() => {
                this.renderOperatingCostTable();
                this.updateStats();
                this.updateOperatingCostStats();
                this.updateOperatingCostCharts();
                this.showSuccessMessage('运营成本删除成功！');
            }).catch((error) => {
                console.error('保存失败:', error);
                // 即使保存失败，也更新界面（数据已在内存中删除）
                this.renderOperatingCostTable();
                this.updateStats();
                this.updateOperatingCostStats();
                this.updateOperatingCostCharts();
            });
        }
    }

    // 清除所有运营成本
    clearAllOperatingCosts() {
        if (this.operatingCosts.length === 0) {
            alert('当前没有运营成本记录需要清除');
            return;
        }

        if (confirm('确定要清除所有运营成本记录吗？此操作不可恢复！')) {
            const confirmText = prompt('请输入"确认清除"来确认此操作：');
            if (confirmText === '确认清除') {
                this.operatingCosts = [];
                this.saveOperatingCosts().then(() => {
                    this.renderOperatingCostTable();
                    this.updateStats();
                    this.updateOperatingCostStats();
                    this.updateOperatingCostCharts();
                    this.showSuccessMessage('所有运营成本记录已清除！');
                }).catch((error) => {
                    console.error('保存失败:', error);
                    // 即使保存失败，也更新界面
                    this.renderOperatingCostTable();
                    this.updateStats();
                    this.updateOperatingCostStats();
                    this.updateOperatingCostCharts();
                });
            } else {
                alert('操作已取消');
            }
        }
    }

    // 清空运营成本表单
    clearOperatingCostForm() {
        document.getElementById('operatingCostForm').reset();
        this.editingOperatingCostId = null;
    }

    // 添加报告返现
    addReportRebate() {
        const date = document.getElementById('reportRebateDate').value;
        const userName = document.getElementById('reportRebateUserName').value.trim();
        const employeeName = document.getElementById('reportRebateEmployee').value;
        const content = document.getElementById('reportRebateContent').value.trim();
        const amount = parseFloat(document.getElementById('reportRebateAmount').value);

        if (!date || !userName || !employeeName || !content || isNaN(amount) || amount < 0) {
            alert('请填写所有必填字段，并确保金额为有效数字！');
            return;
        }

        // 如果是编辑模式
        if (this.editingReportRebateId) {
            const index = this.reportRebates.findIndex(r => r.id === this.editingReportRebateId);
            if (index !== -1) {
                this.reportRebates[index] = {
                    id: this.editingReportRebateId,
                    date: date,
                    userName: userName,
                    employeeName: employeeName,
                    content: content,
                    amount: amount
                };
                this.saveReportRebates();
                this.renderReportRebateTable();
                this.updateStats();
                this.clearReportRebateForm();
                this.showSuccessMessage('报告返现记录更新成功！');
            }
        } else {
            // 新增模式
            const reportRebate = {
                id: Date.now(),
                date: date,
                userName: userName,
                employeeName: employeeName,
                content: content,
                amount: amount
            };

            this.reportRebates.push(reportRebate);
            this.saveReportRebates();
            this.renderReportRebateTable();
            this.updateStats();
            this.clearReportRebateForm();
            this.showSuccessMessage('报告返现记录添加成功！');
        }
    }

    // 编辑报告返现记录
    editReportRebate(id) {
        const rebate = this.reportRebates.find(r => r.id === id);
        
        if (!rebate) {
            alert('未找到要编辑的报告返现记录');
            return;
        }

        // 填充表单
        document.getElementById('reportRebateDate').value = rebate.date;
        document.getElementById('reportRebateUserName').value = rebate.userName;
        document.getElementById('reportRebateEmployee').value = rebate.employeeName;
        document.getElementById('reportRebateContent').value = rebate.content;
        document.getElementById('reportRebateAmount').value = rebate.amount;

        // 标记为编辑模式
        this.editingReportRebateId = id;

        // 更新表单标题和按钮文本
        const formTitle = document.querySelector('.rebate-form-container h3');
        const submitButton = document.querySelector('#reportRebateForm button[type="submit"]');
        
        if (formTitle) {
            formTitle.innerHTML = '编辑返现记录 <button type="button" class="btn-cancel-edit" onclick="scheduleManager.cancelEditReportRebate()">取消编辑</button>';
        }
        if (submitButton) {
            submitButton.textContent = '更新返现记录';
            submitButton.classList.add('btn-warning');
            submitButton.classList.remove('btn-primary');
        }

        // 滚动到表单顶部
        document.querySelector('.rebate-form-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // 取消编辑报告返现
    cancelEditReportRebate() {
        this.clearReportRebateForm();
        this.showSuccessMessage('已取消编辑');
    }

    // 渲染报告返现表格
    renderReportRebateTable() {
        const tbody = document.getElementById('reportRebateTableBody');
        
        if (!tbody) {
            return;
        }

        if (this.reportRebates.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">暂无报告返现记录</td></tr>';
            this.updateRebateStats();
            return;
        }

        // 按日期排序（最新的在前）
        const sortedRebates = [...this.reportRebates].sort((a, b) => {
            return new Date(b.date) - new Date(a.date);
        });

        tbody.innerHTML = sortedRebates.map(rebate => `
            <tr>
                <td>${this.formatDate(rebate.date)}</td>
                <td>${rebate.userName}</td>
                <td>${rebate.employeeName}</td>
                <td style="max-width: 200px; white-space: pre-wrap; word-wrap: break-word;">${rebate.content}</td>
                <td style="color: #dc3545; font-weight: 600;">¥${rebate.amount.toFixed(2)}</td>
                <td>
                    <button class="btn btn-edit" onclick="scheduleManager.editReportRebate(${rebate.id})">编辑</button>
                    <button class="btn btn-danger" onclick="scheduleManager.deleteReportRebate(${rebate.id})">删除</button>
                </td>
            </tr>
        `).join('');

        this.updateRebateStats();
    }

    // 更新报告返现统计信息
    updateRebateStats() {
        const totalAmount = this.reportRebates.reduce((sum, rebate) => sum + rebate.amount, 0);
        const totalCount = this.reportRebates.length;
        const uniqueUsers = new Set(this.reportRebates.map(rebate => rebate.userName)).size;

        const totalAmountElement = document.getElementById('totalRebateAmount');
        const totalCountElement = document.getElementById('totalRebateCount');
        const totalUsersElement = document.getElementById('totalRebateUsers');

        if (totalAmountElement) {
            totalAmountElement.textContent = `¥${totalAmount.toLocaleString()}`;
        }
        if (totalCountElement) {
            totalCountElement.textContent = totalCount;
        }
        if (totalUsersElement) {
            totalUsersElement.textContent = uniqueUsers;
        }
    }

    // 删除报告返现记录
    deleteReportRebate(id) {
        const rebate = this.reportRebates.find(r => r.id === id);
        
        if (!rebate) {
            alert('未找到要删除的报告返现记录');
            return;
        }

        if (confirm(`确定要删除用户"${rebate.userName}"在 ${this.formatDate(rebate.date)} 的报告返现记录吗？`)) {
            this.reportRebates = this.reportRebates.filter(r => r.id !== id);
            this.saveReportRebates();
            this.renderReportRebateTable();
            this.updateStats();
            this.showSuccessMessage('报告返现记录删除成功！');
        }
    }

    // 清除所有报告返现记录
    clearAllReportRebates() {
        if (this.reportRebates.length === 0) {
            alert('当前没有报告返现记录需要清除');
            return;
        }

        if (confirm('确定要清除所有报告返现记录吗？此操作不可恢复！')) {
            const confirmText = prompt('请输入"确认清除"来确认此操作：');
            if (confirmText === '确认清除') {
                this.reportRebates = [];
                this.saveReportRebates();
                this.renderReportRebateTable();
                this.updateStats();
                this.showSuccessMessage('所有报告返现记录已清除！');
            } else {
                alert('操作已取消');
            }
        }
    }

    // 清空报告返现表单
    clearReportRebateForm() {
        document.getElementById('reportRebateForm').reset();
        this.editingReportRebateId = null;

        // 恢复表单标题和按钮
        const formTitle = document.querySelector('.rebate-form-container h3');
        const submitButton = document.querySelector('#reportRebateForm button[type="submit"]');
        
        if (formTitle) {
            formTitle.textContent = '添加返现记录';
        }
        if (submitButton) {
            submitButton.textContent = '添加返现记录';
            submitButton.classList.remove('btn-warning');
            submitButton.classList.add('btn-primary');
        }
    }

    // 渲染员工提成统计
    renderEmployeeCommissionSummary() {
        const container = document.getElementById('commissionCards');
        const timeRangeElement = document.getElementById('commissionTimeRange');
        
        if (!container || !timeRangeElement) {
            return;
        }

        // 获取当前筛选的数据
        let filteredSchedules = this.getCurrentFilteredSchedules();
        
        // 更新时间范围描述
        this.updateCommissionTimeRange(timeRangeElement);

        // 按员工分组计算提成
        const employeeCommissions = this.calculateEmployeeCommissions(filteredSchedules);

        if (Object.keys(employeeCommissions).length === 0) {
            container.innerHTML = `
                <div class="no-commission-data">
                    <h4>暂无提成数据</h4>
                    <p>当前时间维度下没有排班记录</p>
                </div>
            `;
            return;
        }

        // 渲染员工提成卡片
        container.innerHTML = '';
        Object.values(employeeCommissions).forEach(employeeData => {
            const card = this.createCommissionCard(employeeData);
            container.appendChild(card);
        });
    }

    // 获取当前筛选的数据
    getCurrentFilteredSchedules() {
        const hasDateFilter = document.getElementById('filterDate').value;
        const hasWeekFilter = document.getElementById('filterWeek').value;
        const hasMonthFilter = document.getElementById('filterMonth').value;
        
        if (hasDateFilter) {
            return this.schedules.filter(schedule => schedule.scheduleDate === hasDateFilter);
        } else if (hasWeekFilter) {
            const [year, week] = hasWeekFilter.split('-W');
            const startDate = this.getWeekStartDate(parseInt(year), parseInt(week));
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            
            return this.schedules.filter(schedule => {
                const scheduleDate = new Date(schedule.scheduleDate);
                return scheduleDate >= startDate && scheduleDate <= endDate;
            });
        } else if (hasMonthFilter) {
            const [year, month] = hasMonthFilter.split('-');
            return this.schedules.filter(schedule => {
                const scheduleDate = new Date(schedule.scheduleDate);
                return scheduleDate.getFullYear() == year && scheduleDate.getMonth() == (month - 1);
            });
        }
        
        return this.schedules;
    }

    // 按员工计算提成
    calculateEmployeeCommissions(schedules) {
        const employeeData = {};
        
        // 获取当前筛选的坐班费用、面试费用和报告返现数据
        let filteredAttendanceFees = this.attendanceFees;
        let filteredInterviewFees = this.interviewFees;
        let filteredReportRebates = this.reportRebates;
        
        // 根据当前筛选条件过滤费用数据
        const hasDateFilter = document.getElementById('filterDate').value;
        const hasWeekFilter = document.getElementById('filterWeek').value;
        const hasMonthFilter = document.getElementById('filterMonth').value;
        
        if (hasDateFilter) {
            filteredAttendanceFees = this.attendanceFees.filter(fee => fee.date === hasDateFilter);
            filteredInterviewFees = this.interviewFees.filter(fee => fee.date === hasDateFilter);
            filteredReportRebates = this.reportRebates.filter(rebate => rebate.date === hasDateFilter);
        } else if (hasWeekFilter) {
            const [year, week] = hasWeekFilter.split('-W');
            const startDate = this.getWeekStartDate(parseInt(year), parseInt(week));
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            
            filteredAttendanceFees = this.attendanceFees.filter(fee => {
                const feeDate = new Date(fee.date);
                return feeDate >= startDate && feeDate <= endDate;
            });
            
            filteredInterviewFees = this.interviewFees.filter(fee => {
                const feeDate = new Date(fee.date);
                return feeDate >= startDate && feeDate <= endDate;
            });
            
            filteredReportRebates = this.reportRebates.filter(rebate => {
                const rebateDate = new Date(rebate.date);
                return rebateDate >= startDate && rebateDate <= endDate;
            });
        } else if (hasMonthFilter) {
            const [year, month] = hasMonthFilter.split('-');
            filteredAttendanceFees = this.attendanceFees.filter(fee => {
                const feeDate = new Date(fee.date);
                return feeDate.getFullYear() == year && feeDate.getMonth() == (month - 1);
            });
            
            filteredInterviewFees = this.interviewFees.filter(fee => {
                const feeDate = new Date(fee.date);
                return feeDate.getFullYear() == year && feeDate.getMonth() == (month - 1);
            });
            
            filteredReportRebates = this.reportRebates.filter(rebate => {
                const rebateDate = new Date(rebate.date);
                return rebateDate.getFullYear() == year && rebateDate.getMonth() == (month - 1);
            });
        }
        
        // 计算每个员工的坐班费用、面试费用和报告返现
        const employeeAttendanceFees = {};
        const employeeInterviewFees = {};
        const employeeReportRebates = {};
        
        filteredAttendanceFees.forEach(fee => {
            if (!employeeAttendanceFees[fee.employeeName]) {
                employeeAttendanceFees[fee.employeeName] = 0;
            }
            employeeAttendanceFees[fee.employeeName] += fee.fee;
        });
        
        filteredInterviewFees.forEach(fee => {
            if (!employeeInterviewFees[fee.employeeName]) {
                employeeInterviewFees[fee.employeeName] = 0;
            }
            employeeInterviewFees[fee.employeeName] += fee.fee;
        });
        
        filteredReportRebates.forEach(rebate => {
            if (!employeeReportRebates[rebate.employeeName]) {
                employeeReportRebates[rebate.employeeName] = 0;
            }
            employeeReportRebates[rebate.employeeName] += rebate.amount;
        });
        
        // 计算每个员工的出席天数（按日期去重）
        const employeeAttendanceDays = {};
        
        schedules.forEach(schedule => {
            const employeeName = schedule.employeeName;
            const scheduleDate = schedule.scheduleDate;
            
            if (!employeeAttendanceDays[employeeName]) {
                employeeAttendanceDays[employeeName] = new Set();
            }
            employeeAttendanceDays[employeeName].add(scheduleDate);
        });
        
        schedules.forEach(schedule => {
            const employeeName = schedule.employeeName;
            const commission = schedule.commission || 0;
            const attendanceFee = employeeAttendanceFees[employeeName] || 0;
            const interviewFee = employeeInterviewFees[employeeName] || 0;
            const reportRebate = employeeReportRebates[employeeName] || 0;
            
            if (!employeeData[employeeName]) {
                employeeData[employeeName] = {
                    name: employeeName,
                    totalCommission: 0,
                    totalAttendanceFee: 0,
                    totalInterviewFee: 0,
                    totalReportRebate: 0,
                    recordCount: 0,
                    totalPayment: 0,
                    avgCommission: 0,
                    profit: 0,
                    attendanceDays: 0
                };
            }
            
            employeeData[employeeName].totalCommission += commission;
            employeeData[employeeName].totalAttendanceFee = attendanceFee;
            employeeData[employeeName].totalInterviewFee = interviewFee;
            employeeData[employeeName].totalReportRebate = reportRebate;
            employeeData[employeeName].totalPayment += schedule.payment;
            employeeData[employeeName].recordCount += 1;
        });
        
        // 设置每个员工的出席天数
        Object.keys(employeeData).forEach(employeeName => {
            employeeData[employeeName].attendanceDays = employeeAttendanceDays[employeeName] ? employeeAttendanceDays[employeeName].size : 0;
        });

        // 计算平均提成和收益
        Object.values(employeeData).forEach(employee => {
            employee.avgCommission = employee.recordCount > 0 ? 
                employee.totalCommission / employee.recordCount : 0;
            // 收益 = 总收款 - 坐班费 - 面试费 - 提成 - 报告返现
            employee.profit = employee.totalPayment - employee.totalAttendanceFee - employee.totalInterviewFee - employee.totalCommission - employee.totalReportRebate;
        });

        // 按总提成降序排序
        return Object.values(employeeData).sort((a, b) => b.totalCommission - a.totalCommission);
    }

    // 更新时间范围描述
    updateCommissionTimeRange(timeRangeElement) {
        const hasDateFilter = document.getElementById('filterDate').value;
        const hasWeekFilter = document.getElementById('filterWeek').value;
        const hasMonthFilter = document.getElementById('filterMonth').value;
        
        let timeRangeText = '';
        
        if (hasDateFilter) {
            timeRangeText = `${this.formatDate(hasDateFilter)} 的员工提成汇总`;
        } else if (hasWeekFilter) {
            const [year, week] = hasWeekFilter.split('-W');
            timeRangeText = `${year}年第${week}周 的员工提成汇总`;
        } else if (hasMonthFilter) {
            const [year, month] = hasMonthFilter.split('-');
            timeRangeText = `${year}年${month}月 的员工提成汇总`;
        } else {
            timeRangeText = '所有时间 的员工提成汇总';
        }
        
        timeRangeElement.textContent = timeRangeText;
    }

    // 创建员工提成卡片
    createCommissionCard(employeeData) {
        const card = document.createElement('div');
        card.className = 'commission-card';
        
        // 计算员工总薪资（提成 + 坐班费 + 面试费）
        const totalSalary = employeeData.totalCommission + employeeData.totalAttendanceFee + employeeData.totalInterviewFee;
        
        card.innerHTML = `
            <div class="commission-card-header">
                <h4 class="employee-name">${employeeData.name}</h4>
                <span class="record-count">${employeeData.recordCount}条记录</span>
            </div>
            <div class="commission-amount">
                ¥${totalSalary.toLocaleString()}
                <div class="salary-breakdown">
                    <small>提成: ¥${employeeData.totalCommission.toLocaleString()} + 坐班费: ¥${employeeData.totalAttendanceFee.toLocaleString()} + 面试费: ¥${employeeData.totalInterviewFee.toLocaleString()}</small>
                </div>
            </div>
            <div class="commission-details">
                <div class="commission-detail-item">
                    <span class="commission-detail-label">平均提成</span>
                    <span class="commission-detail-value">¥${employeeData.avgCommission.toFixed(2)}</span>
                </div>
                <div class="commission-detail-item">
                    <span class="commission-detail-label">总收款</span>
                    <span class="commission-detail-value">¥${employeeData.totalPayment.toLocaleString()}</span>
                </div>
                <div class="commission-detail-item">
                    <span class="commission-detail-label">出席天数</span>
                    <span class="commission-detail-value">${employeeData.attendanceDays}天</span>
                </div>
                <div class="commission-detail-item">
                    <span class="commission-detail-label">坐班费</span>
                    <span class="commission-detail-value">¥${employeeData.totalAttendanceFee.toLocaleString()}</span>
                </div>
                <div class="commission-detail-item">
                    <span class="commission-detail-label">面试费</span>
                    <span class="commission-detail-value">¥${employeeData.totalInterviewFee.toLocaleString()}</span>
                </div>
                <div class="commission-detail-item">
                    <span class="commission-detail-label">报告返现</span>
                    <span class="commission-detail-value">¥${employeeData.totalReportRebate.toLocaleString()}</span>
                </div>
                <div class="commission-detail-item">
                    <span class="commission-detail-label">收益</span>
                    <span class="commission-detail-value ${employeeData.profit >= 0 ? 'profit-positive' : 'profit-negative'}">¥${employeeData.profit.toLocaleString()}</span>
                </div>
                <div class="commission-detail-item">
                    <span class="commission-detail-label">日平均收益</span>
                    <span class="commission-detail-value ${employeeData.profit >= 0 ? 'profit-positive' : 'profit-negative'}">¥${employeeData.attendanceDays > 0 ? (employeeData.profit / employeeData.attendanceDays).toFixed(2) : '0'}</span>
                </div>
                <div class="commission-detail-item">
                    <span class="commission-detail-label">提成率</span>
                    <span class="commission-detail-value">${employeeData.totalPayment > 0 ? ((employeeData.totalCommission / employeeData.totalPayment) * 100).toFixed(1) : 0}%</span>
                </div>
            </div>
        `;
        
        return card;
    }

    // 渲染客户TOP20统计
    renderClientTop20() {
        const timeRangeElement = document.getElementById('clientTimeRange');
        const countContainer = document.getElementById('clientCountTop20');
        const amountContainer = document.getElementById('clientAmountTop20');
        
        if (!timeRangeElement || !countContainer || !amountContainer) {
            return;
        }

        // 获取当前筛选的数据
        let filteredSchedules = this.getCurrentFilteredSchedules();
        
        // 更新时间范围描述
        this.updateClientTimeRange(timeRangeElement);

        // 计算客户统计数据
        const clientStats = this.calculateClientStats(filteredSchedules);

        // 渲染按次数排序的TOP20
        this.renderClientCountTop20(clientStats, countContainer);

        // 渲染按金额排序的TOP20
        this.renderClientAmountTop20(clientStats, amountContainer);
    }

    // 更新客户时间范围描述
    updateClientTimeRange(timeRangeElement) {
        const hasDateFilter = document.getElementById('filterDate').value;
        const hasWeekFilter = document.getElementById('filterWeek').value;
        const hasMonthFilter = document.getElementById('filterMonth').value;
        
        let timeRangeText = '';
        
        if (hasDateFilter) {
            timeRangeText = `${this.formatDate(hasDateFilter)} 的客户活跃度与消费分析`;
        } else if (hasWeekFilter) {
            const [year, week] = hasWeekFilter.split('-W');
            timeRangeText = `${year}年第${week}周 的客户活跃度与消费分析`;
        } else if (hasMonthFilter) {
            const [year, month] = hasMonthFilter.split('-');
            timeRangeText = `${year}年${month}月 的客户活跃度与消费分析`;
        } else {
            timeRangeText = '所有时间 的客户活跃度与消费分析';
        }
        
        timeRangeElement.textContent = timeRangeText;
    }

    // 计算客户统计数据
    calculateClientStats(schedules) {
        const clientData = {};
        
        schedules.forEach(schedule => {
            const clientName = schedule.clientName;
            const payment = schedule.payment;
            const employeeName = schedule.employeeName;
            
            if (!clientData[clientName]) {
                clientData[clientName] = {
                    name: clientName,
                    count: 0,
                    totalAmount: 0,
                    employees: {} // 记录每个员工的服务次数
                };
            }
            
            clientData[clientName].count += 1;
            clientData[clientName].totalAmount += payment;
            
            // 统计员工服务次数
            if (!clientData[clientName].employees[employeeName]) {
                clientData[clientName].employees[employeeName] = 0;
            }
            clientData[clientName].employees[employeeName] += 1;
        });

        // 为每个客户计算top3员工
        Object.values(clientData).forEach(client => {
            const employeeArray = Object.entries(client.employees).map(([name, count]) => ({
                name,
                count
            }));
            
            // 按次数降序排序，取前3个
            client.topEmployees = employeeArray
                .sort((a, b) => b.count - a.count)
                .slice(0, 3);
        });

        return Object.values(clientData);
    }

    // 渲染按次数排序的TOP20
    renderClientCountTop20(clientStats, container) {
        if (clientStats.length === 0) {
            container.innerHTML = '<div class="no-client-data">暂无客户数据</div>';
            return;
        }

        // 按次数排序，取前20名
        const top20ByCount = clientStats
            .sort((a, b) => {
                if (b.count !== a.count) {
                    return b.count - a.count;
                }
                return a.name.localeCompare(b.name);
            })
            .slice(0, 20);

        container.innerHTML = '';
        top20ByCount.forEach((client, index) => {
            const item = this.createClientTop20Item(client, index + 1, 'count');
            container.appendChild(item);
        });
    }

    // 渲染按金额排序的TOP20
    renderClientAmountTop20(clientStats, container) {
        if (clientStats.length === 0) {
            container.innerHTML = '<div class="no-client-data">暂无客户数据</div>';
            return;
        }

        // 按金额排序，取前20名
        const top20ByAmount = clientStats
            .sort((a, b) => {
                if (b.totalAmount !== a.totalAmount) {
                    return b.totalAmount - a.totalAmount;
                }
                return a.name.localeCompare(b.name);
            })
            .slice(0, 20);

        container.innerHTML = '';
        top20ByAmount.forEach((client, index) => {
            const item = this.createClientTop20Item(client, index + 1, 'amount');
            container.appendChild(item);
        });
    }

    // 创建客户TOP20项目
    createClientTop20Item(client, rank, type) {
        const item = document.createElement('div');
        item.className = `client-top20-item rank-${rank <= 3 ? rank : ''}`;
        
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        
        // 生成常合作员工列表HTML
        let topEmployeesHtml = '';
        if (client.topEmployees && client.topEmployees.length > 0) {
            topEmployeesHtml = `
                <div class="client-top-employees">
                    <div class="top-employees-label">常合作员工</div>
                    <div class="top-employees-list">
                        ${client.topEmployees.map((emp, index) => `
                            <span class="top-employee-badge">
                                ${emp.name}(${emp.count}次)
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        item.innerHTML = `
            <div class="client-info">
                <div class="client-rank ${rankClass}">${rank}</div>
                <div class="client-details">
                    <div class="client-name">${client.name}</div>
                    ${topEmployeesHtml}
                </div>
            </div>
            <div class="client-stats">
                ${type === 'count' ? 
                    `<div class="client-count">${client.count}次</div>
                     <div class="client-label">排班次数</div>` :
                    `<div class="client-amount">¥${client.totalAmount.toLocaleString()}</div>
                     <div class="client-label">消费金额</div>`
                }
            </div>
        `;
        
        return item;
    }

    // 打开批量导入模态框
    openImportModal() {
        // 设置默认日期为今天
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('importDate').value = today;
        
        // 清空文本框
        document.getElementById('importDataText').value = '';
        
        // 显示模态框
        document.getElementById('importModal').style.display = 'block';
    }

    // 关闭批量导入模态框
    closeImportModal() {
        document.getElementById('importModal').style.display = 'none';
        document.getElementById('importDataText').value = '';
    }

    // 处理批量导入数据
    async processImportData() {
        const importDate = document.getElementById('importDate').value;
        const importText = document.getElementById('importDataText').value.trim();

        if (!importDate) {
            alert('请选择排班日期');
            return;
        }

        if (!importText) {
            alert('请输入要导入的数据');
            return;
        }

        // 解析导入数据
        const lines = importText.split('\n').filter(line => line.trim());
        const newSchedules = [];
        const errors = [];

        lines.forEach((line, index) => {
            const lineNum = index + 1;
            const trimmedLine = line.trim();
            
            // 跳过空行
            if (!trimmedLine) {
                return;
            }
            
            try {
                const schedule = this.parseImportLine(trimmedLine, importDate);
                if (schedule) {
                    newSchedules.push(schedule);
                } else {
                    errors.push(`第${lineNum}行: 解析返回空结果`);
                }
            } catch (error) {
                errors.push(`第${lineNum}行格式错误: ${error.message}\n   内容: ${trimmedLine}`);
                console.error(`导入错误 - 第${lineNum}行:`, error, '\n原始数据:', trimmedLine);
            }
        });

        if (errors.length > 0) {
            const errorMessage = '以下行格式错误，请检查：\n\n' + errors.join('\n\n');
            console.error('导入错误详情:', errors);
            alert(errorMessage);
            return;
        }

        if (newSchedules.length === 0) {
            alert('没有有效的数据可以导入');
            return;
        }

        // 确认导入
        const confirmMessage = `准备导入 ${newSchedules.length} 条记录：\n\n` +
            newSchedules.map(s => `• ${s.employeeName} - ${s.clientName} (¥${s.payment})`).join('\n') +
            `\n\n确定要导入这些记录吗？`;
        
        if (!confirm(confirmMessage)) {
            return;
        }

        // 批量添加记录
        let successCount = 0;
        newSchedules.forEach(schedule => {
            if (!this.hasTimeConflict(schedule)) {
                this.schedules.push(schedule);
                successCount++;
            } else {
                console.warn(`时间段冲突，跳过记录: ${schedule.employeeName} - ${schedule.scheduleDate} ${schedule.startTime}-${schedule.endTime}`);
            }
        });

        // 保存数据（带错误处理），导入模式防止 onSnapshot 覆盖
        this.dbManager.beginImport();
        try {
            await this.saveSchedules();
        } catch (error) {
            alert(`❌ 保存失败：${error.message}\n\n已成功解析 ${newSchedules.length} 条记录，但未能保存到存储。\n\n建议操作：\n1. 清理员工头像以释放空间\n2. 清除浏览器缓存\n3. 删除旧的历史数据\n\n清理后请重新导入。`);
            return;
        } finally {
            this.dbManager.endImport();
        }

        // 更新显示
        this.renderTableWithCurrentFilter();
        this.updateStats();

        // 关闭模态框
        this.closeImportModal();

        // 显示结果
        this.showSuccessMessage(`批量导入完成！成功导入 ${successCount} 条记录，共 ${newSchedules.length} 条记录`);
    }

    // 解析时间范围（支持 am/pm 和 24小时制）
    parseTimeRange(timeRange) {
        // 移除多余空格
        timeRange = timeRange.trim();
        
        // 匹配格式1：HH:MM-HH:MM（标准时间格式）
        // 如：07:20-08:28, 12:45-13:45, 18:00-19:00, 23:00-24:00
        const timeMatchWithMinutes = timeRange.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
        
        if (timeMatchWithMinutes) {
            let startHour = parseInt(timeMatchWithMinutes[1]);
            const startMinute = parseInt(timeMatchWithMinutes[2]);
            let endHour = parseInt(timeMatchWithMinutes[3]);
            let endMinute = parseInt(timeMatchWithMinutes[4]);
            
            // 特殊处理：24:00 转换为 23:59（在验证之前处理）
            if (endHour === 24 && endMinute === 0) {
                endHour = 23;
                endMinute = 59;
            }
            
            // 验证时间范围（在转换之后验证）
            if (startHour < 0 || startHour >= 24) {
                throw new Error('开始时间小时数应在0-23之间');
            }
            
            if (endHour < 0 || endHour >= 24) {
                throw new Error('结束时间小时数应在0-23之间（24:00会自动转换为23:59）');
            }
            
            if (startMinute < 0 || startMinute >= 60 || endMinute < 0 || endMinute >= 60) {
                throw new Error('分钟数应在0-59之间');
            }
            
            // 转换为24小时制的小数
            const start24Hour = startHour + startMinute / 60;
            const end24Hour = endHour + endMinute / 60;
            
            if (start24Hour >= end24Hour) {
                throw new Error('结束时间应大于开始时间');
            }
            
            // 转换为 HH:MM 格式
            const startTime = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;
            const endTime = `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`;
            
            return { startTime, endTime };
        }
        
        // 匹配格式2：数字-数字 am/pm（12小时制）
        // 支持整数和小数，如：1-2 am, 7.5-8.5 pm, 5-6 pm
        const timeMatchWithPeriod = timeRange.match(/^([\d.]+)-([\d.]+)\s*(am|pm)$/i);
        
        // 匹配格式3：纯数字-数字（24小时制）
        // 如：17-18, 13-14, 9-10
        const timeMatchWithout = timeRange.match(/^([\d.]+)-([\d.]+)$/);
        
        let start24Hour, end24Hour;
        
        if (timeMatchWithPeriod) {
            // 12小时制格式处理
            const startHour = parseFloat(timeMatchWithPeriod[1]);
            const endHour = parseFloat(timeMatchWithPeriod[2]);
            const period = timeMatchWithPeriod[3].toLowerCase();
            
            // 验证时间范围
            if (startHour < 1 || startHour > 12 || endHour < 1 || endHour > 12) {
                throw new Error('12小时制时间范围应在1-12之间');
            }
            
            if (startHour >= endHour) {
                throw new Error('结束时间应大于开始时间');
            }
            
            // 转换为24小时制
            start24Hour = startHour;
            end24Hour = endHour;
            
            if (period === 'pm' && start24Hour !== 12) {
                start24Hour += 12;
            } else if (period === 'am' && start24Hour === 12) {
                start24Hour = 0;
            }
            
            if (period === 'pm' && end24Hour !== 12) {
                end24Hour += 12;
            } else if (period === 'am' && end24Hour === 12) {
                end24Hour = 0;
            }
        } else if (timeMatchWithout) {
            // 24小时制格式处理
            start24Hour = parseFloat(timeMatchWithout[1]);
            end24Hour = parseFloat(timeMatchWithout[2]);
            
            // 验证时间范围
            if (start24Hour < 0 || start24Hour >= 24 || end24Hour < 0 || end24Hour >= 24) {
                throw new Error('24小时制时间范围应在0-23之间');
            }
            
            if (start24Hour >= end24Hour) {
                throw new Error('结束时间应大于开始时间');
            }
        } else {
            throw new Error('时间段格式错误，支持格式：HH:MM-HH:MM（如：07:20-08:28）、数字-数字（如：17-18）或 数字-数字 am/pm（如：5-6 pm）');
        }
        
        // 转换为 HH:MM 格式
        const startTime = this.decimalHourToTime(start24Hour);
        const endTime = this.decimalHourToTime(end24Hour);
        
        return { startTime, endTime };
    }
    
    // 将小数时间转换为 HH:MM 格式
    decimalHourToTime(decimalHour) {
        const hours = Math.floor(decimalHour);
        const minutes = Math.round((decimalHour - hours) * 60);
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    // 解析单行导入数据
    parseImportLine(line, defaultDate) {
        // 支持两种格式：
        // 格式1：员工姓名，时间段，项目名称（提成），客户名称（付款金额），客户来源渠道
        // 例如：开心，17-18，sss（260），Jackson（408），微信群
        // 格式2：员工姓名，项目名称（提成），时间段，客户名称（付款金额），客户来源渠道
        // 例如：小萍，ssss（300），2-3 pm，张（658），抖音
        
        const parts = line.split('，');
        if (parts.length !== 5) {
            throw new Error('格式不正确，应为5个部分（用中文逗号分隔）');
        }

        const [employeeName, part2, part3, clientInfo, clientSource] = parts.map(part => part.trim());

        // 智能检测格式：判断part2和part3哪个是时间段，哪个是项目名称
        // 时间段的特征：HH:MM-HH:MM格式、包含am/pm，或者是纯数字-数字格式（如17-18）
        const timeRangePattern = /^(\d{1,2}:\d{2}-\d{1,2}:\d{2}|[\d.]+-[\d.]+(\s*(am|pm))?)$/i;
        
        let timeRange, projectInfo;
        
        // 检测part2是否是时间段
        if (timeRangePattern.test(part2)) {
            // 格式1：part2是时间段，part3是项目名称
            timeRange = part2;
            projectInfo = part3;
        } else if (timeRangePattern.test(part3)) {
            // 格式2：part3是时间段，part2是项目名称
            timeRange = part3;
            projectInfo = part2;
        } else {
            throw new Error('无法识别时间段格式，支持格式：HH:MM-HH:MM（如：07:20-08:28）、数字-数字（如：17-18）或 数字-数字 am/pm（如：5-6 pm）');
        }

        // 解析时间段（支持 am/pm 和纯数字时间）
        const { startTime, endTime } = this.parseTimeRange(timeRange);

        // 解析项目信息和提成
        const projectMatch = projectInfo.match(/^(.+)（(\d+(?:\.\d+)?)）$/);
        if (!projectMatch) {
            throw new Error('项目信息格式错误，应为：项目名称（提成）');
        }

        const projectName = projectMatch[1];
        const commission = parseFloat(projectMatch[2]);

        if (isNaN(commission) || commission < 0) {
            throw new Error('提成必须是大于等于0的数字');
        }

        // 解析客户信息和付款金额
        const clientMatch = clientInfo.match(/^(.+)（(\d+(?:\.\d+)?)）$/);
        if (!clientMatch) {
            throw new Error('客户信息格式错误，应为：客户名称（付款金额）');
        }

        const clientName = clientMatch[1];
        const payment = parseFloat(clientMatch[2]);

        if (isNaN(payment) || payment <= 0) {
            throw new Error('付款金额必须是大于0的数字');
        }

        return {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            employeeName,
            scheduleDate: defaultDate,
            startTime,
            endTime,
            projectName,
            clientName,
            clientSource: clientSource || '批量导入',
            payment,
            commission,
            createdAt: new Date().toISOString()
        };
    }

    // 初始化收入图表
    initializeIncomeChart() {
        // 如果图表已存在，先销毁
        if (this.incomeChart) {
            this.incomeChart.destroy();
        }

        this.updateIncomeChart();
    }

    // ============================================================
    // AI 分析相关方法
    // ============================================================

    // 获取 AI 页面的日期范围
    _getAIDateRange(selectId) {
        const el = document.getElementById(selectId);
        if (!el) return 30;
        const val = el.value;
        if (val === 'all') return 'all';
        if (val === 'custom') {
            const start = document.getElementById('aiReportStartDate')?.value;
            const end = document.getElementById('aiReportEndDate')?.value;
            if (start && end) return { custom: true, startDate: start, endDate: end };
            return 30;
        }
        return parseInt(val) || 30;
    }

    // 保存 API Key
    saveAIApiKey() {
        const input = document.getElementById('aiApiKey');
        const status = document.getElementById('aiConfigStatus');
        if (!input) return;
        const key = input.value.trim();
        if (!key) { alert('请输入 API Key'); return; }
        aiAnalyst.saveApiKey(key);
        if (status) {
            status.textContent = '✅ 已保存';
            setTimeout(() => { status.textContent = ''; }, 2000);
        }
    }

    // 方案A：生成 AI 分析报告
    async generateAIReport() {
        const outputEl = document.getElementById('aiReportOutput');
        const btn = document.getElementById('aiGenerateReportBtn');
        if (!outputEl) return;

        const dateRange = this._getAIDateRange('aiReportDateRange');

        // 检查是否有数据
        if (!this.schedules || this.schedules.length === 0) {
            outputEl.innerHTML = '<div class="ai-report-placeholder"><p>⚠️ 当前没有排班数据，请先添加排班记录再生成报告</p></div>';
            return;
        }

        // 显示加载状态
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-icon">⏳</span> 分析中...';
        outputEl.innerHTML = '<div class="ai-loading"><span>🤖 AI 正在分析你的经营数据</span><div class="dot-pulse"><span></span><span></span><span></span></div></div>';

        try {
            let fullMarkdown = '';
            await aiAnalyst.generateReport(this, dateRange, (delta, fullText) => {
                fullMarkdown = fullText;
                // 流式渲染 Markdown
                if (typeof marked !== 'undefined') {
                    outputEl.innerHTML = marked.parse(fullMarkdown);
                } else {
                    outputEl.textContent = fullMarkdown;
                }
                // 自动滚动到底部
                outputEl.scrollTop = outputEl.scrollHeight;
            });
        } catch (error) {
            console.error('AI 报告生成失败:', error);
            outputEl.innerHTML = `<div class="ai-report-placeholder"><p>❌ 生成失败：${error.message}</p><p style="font-size:0.85em;margin-top:8px;">请检查 API Key 是否正确，或网络是否畅通</p></div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">🚀</span> 生成报告';
        }
    }

    // 复制 AI 报告
    copyAIReport() {
        const outputEl = document.getElementById('aiReportOutput');
        if (!outputEl) return;
        const text = outputEl.innerText || outputEl.textContent;
        if (!text || text.includes('选择时间范围')) {
            alert('暂无报告内容可复制');
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            alert('✅ 报告已复制到剪贴板');
        }).catch(() => {
            // fallback
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            alert('✅ 报告已复制');
        });
    }

    // 清空 AI 报告
    clearAIReport() {
        const outputEl = document.getElementById('aiReportOutput');
        if (outputEl) {
            outputEl.innerHTML = '<div class="ai-report-placeholder"><div class="ai-placeholder-icon">🤖</div><p>选择时间范围，点击「生成报告」，AI 将基于你的真实经营数据生成深度分析报告</p><div class="ai-placeholder-features"><span>📈 收入趋势</span><span>🏆 员工绩效</span><span>👥 客户分析</span><span>📡 渠道 ROI</span><span>💰 利润诊断</span><span>🎯 可执行建议</span></div></div>';
        }
    }

    // 方案B：发送对话
    async sendAIChat(msg) {
        const inputEl = document.getElementById('aiChatInput');
        const sendBtn = document.getElementById('aiSendBtn');
        const messagesEl = document.getElementById('aiChatMessages');
        if (!messagesEl) return;

        const message = msg || (inputEl ? inputEl.value.trim() : '');
        if (!message) return;

        // 清空输入
        if (inputEl) inputEl.value = '';

        // 初始化对话上下文（如果还没有）
        if (aiAnalyst.chatHistory.length === 0) {
            const dateRange = this._getAIDateRange('aiChatDateRange');
            aiAnalyst.initChat(this, dateRange);
        }

        // 添加用户气泡
        this._appendChatBubble('user', message, messagesEl);

        // 添加 AI 加载占位
        const aiBubble = this._appendChatBubble('assistant', '', messagesEl);
        aiBubble.innerHTML = '<div class="ai-loading" style="padding:0"><div class="dot-pulse"><span></span><span></span><span></span></div></div>';

        // 禁用发送
        if (sendBtn) sendBtn.disabled = true;

        try {
            let fullText = '';
            await aiAnalyst.sendMessage(message, (delta, accumulated) => {
                fullText = accumulated;
                if (typeof marked !== 'undefined') {
                    aiBubble.innerHTML = marked.parse(fullText);
                } else {
                    aiBubble.textContent = fullText;
                }
                messagesEl.scrollTop = messagesEl.scrollHeight;
            });
        } catch (error) {
            console.error('AI 对话失败:', error);
            aiBubble.innerHTML = `❌ 回复失败：${error.message}`;
        } finally {
            if (sendBtn) sendBtn.disabled = false;
            if (inputEl) inputEl.focus();
        }
    }

    // 快捷提问
    quickAIChat(prompt) {
        const inputEl = document.getElementById('aiChatInput');
        if (inputEl) inputEl.value = prompt;
        this.sendAIChat(prompt);
    }

    // Enter 发送
    handleAIChatKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendAIChat();
        }
    }

    // 清空对话
    clearAIChat() {
        aiAnalyst.clearChat();
        const messagesEl = document.getElementById('aiChatMessages');
        if (messagesEl) {
            messagesEl.innerHTML = '<div class="ai-chat-welcome"><div class="ai-avatar">🤖</div><div class="ai-bubble ai-bubble-assistant">你好！我是你的 AI 经营助手。<br>点击上方的快捷问题，或者直接告诉我你想了解什么，我会基于你的真实经营数据来回答。</div></div>';
        }
    }

    // 添加对话气泡
    _appendChatBubble(role, content, container) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `ai-chat-msg ${role === 'user' ? 'user-msg' : ''}`;

        const avatar = document.createElement('div');
        avatar.className = 'ai-avatar';
        avatar.textContent = role === 'user' ? '👤' : '🤖';

        const bubble = document.createElement('div');
        bubble.className = `ai-bubble ai-bubble-${role === 'user' ? 'user' : 'assistant'}`;

        if (content) {
            if (role === 'user') {
                bubble.textContent = content;
            } else if (typeof marked !== 'undefined') {
                bubble.innerHTML = marked.parse(content);
            } else {
                bubble.textContent = content;
            }
        }

        msgDiv.appendChild(avatar);
        msgDiv.appendChild(bubble);
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
        return bubble;
    }

    // 全局时间范围：同步到所有图表并刷新
    applyGlobalChartDateRange() {
        const globalValue = document.getElementById('globalChartDateRange').value;
        const globalStart = document.getElementById('globalChartStartDate').value;
        const globalEnd = document.getElementById('globalChartEndDate').value;

        // 所有图表的日期范围 select ID 列表
        const rangeSelectors = [
            'chartDateRange',
            'heatmapDateRange',
            'sourceChannelDateRange',
            'employeePerformanceDateRange',
            'clientEmployeeCollaborationDateRange',
            'employeeClientDateRange',
            'customerStatusDateRange',
            'employeeRankingDateRange',
        ];

        // 自定义日期容器及对应的起止日期 input 映射
        const customDateMap = {
            'chartDateRange': { container: 'customDateRangeContainer', start: 'chartStartDate', end: 'chartEndDate' },
            'heatmapDateRange': { container: 'heatmapCustomDateRangeContainer', start: 'heatmapStartDate', end: 'heatmapEndDate' },
            'sourceChannelDateRange': { container: 'sourceChannelCustomDateRangeContainer', start: 'sourceChannelStartDate', end: 'sourceChannelEndDate' },
            'employeePerformanceDateRange': { container: 'employeePerformanceCustomDateRangeContainer', start: 'employeePerformanceStartDate', end: 'employeePerformanceEndDate' },
            'clientEmployeeCollaborationDateRange': { container: 'clientEmployeeCollaborationCustomDateRangeContainer', start: 'clientEmployeeCollaborationStartDate', end: 'clientEmployeeCollaborationEndDate' },
            'employeeClientDateRange': { container: 'employeeClientCustomDateRangeContainer', start: 'employeeClientStartDate', end: 'employeeClientEndDate' },
            'customerStatusDateRange': { container: 'customerStatusCustomDateRangeContainer', start: 'customerStatusStartDate', end: 'customerStatusEndDate' },
            'employeeRankingDateRange': { container: 'employeeRankingCustomDateRangeContainer', start: 'employeeRankingStartDate', end: 'employeeRankingEndDate' },
        };

        // 同步每个图表的 select 值和自定义日期
        rangeSelectors.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = globalValue;

            const map = customDateMap[id];
            if (map) {
                const container = document.getElementById(map.container);
                if (globalValue === 'custom') {
                    if (container) container.style.display = 'inline-flex';
                    const startEl = document.getElementById(map.start);
                    const endEl = document.getElementById(map.end);
                    if (startEl) startEl.value = globalStart;
                    if (endEl) endEl.value = globalEnd;
                } else {
                    if (container) container.style.display = 'none';
                }
            }
        });

        // 如果是自定义日期但还没选全，不触发更新
        if (globalValue === 'custom' && (!globalStart || !globalEnd)) {
            return;
        }

        // 刷新全部图表
        try { this.updateIncomeChart(); } catch (e) { console.error('更新收入图表失败:', e); }
        try { this.updateHeatmapChart(); } catch (e) { console.error('更新热力图失败:', e); }
        try { this.updateSourceChannelCharts(); } catch (e) { console.error('更新渠道图表失败:', e); }
        try { this.updateEmployeePerformanceChart(); } catch (e) { console.error('更新员工业绩图表失败:', e); }
        try { this.updateClientEmployeeCollaborationChart(); } catch (e) { console.error('更新客户合作图表失败:', e); }
        try { this.updateEmployeeClientChart(); } catch (e) { console.error('更新员工客户图表失败:', e); }
        try { this.updateCustomerStatusCharts(); } catch (e) { console.error('更新客户状态图表失败:', e); }
        try { this.updateEmployeeRanking(); } catch (e) { console.error('更新员工排行榜失败:', e); }
    }

    // 更新收入图表
    updateIncomeChart() {
        const dateRangeValue = document.getElementById('chartDateRange').value;
        let dateRange;
        
        if (dateRangeValue === 'custom') {
            const startDate = document.getElementById('chartStartDate').value;
            const endDate = document.getElementById('chartEndDate').value;
            
            if (!startDate || !endDate) {
                return; // 如果日期未完整选择，不更新图表
            }
            
            dateRange = { custom: true, startDate, endDate };
        } else {
            dateRange = dateRangeValue === 'all' ? 'all' : parseInt(dateRangeValue);
        }
        
        const dailyIncomeData = this.calculateDailyIncome(dateRange);

        // 更新统计卡片
        this.updateChartStats(dailyIncomeData);

        // 准备图表数据
        const labels = dailyIncomeData.map(item => item.date);
        const incomeData = dailyIncomeData.map(item => item.income);
        const netProfitData = dailyIncomeData.map(item => item.netProfit);
        const employeeCountData = dailyIncomeData.map(item => item.employeeCount);
        const orderCountData = dailyIncomeData.map(item => item.orderCount);

        // 获取canvas上下文
        const ctx = document.getElementById('incomeChart').getContext('2d');

        // 创建或更新图表
        if (this.incomeChart) {
            this.incomeChart.data.labels = labels;
            this.incomeChart.data.datasets[0].data = incomeData;
            this.incomeChart.data.datasets[1].data = netProfitData;
            this.incomeChart.data.datasets[2].data = employeeCountData;
            this.incomeChart.data.datasets[3].data = orderCountData;
            this.incomeChart.config._dailyIncomeData = dailyIncomeData;
            this.incomeChart.update();
        } else {
            this.incomeChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '每日收入',
                        data: incomeData,
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        pointBackgroundColor: '#667eea',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverBackgroundColor: '#764ba2',
                        pointHoverBorderColor: '#fff',
                        yAxisID: 'y'
                    }, {
                        label: '每日净收益',
                        data: netProfitData,
                        borderColor: '#28a745',
                        backgroundColor: 'rgba(40, 167, 69, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        pointBackgroundColor: '#28a745',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverBackgroundColor: '#20c997',
                        pointHoverBorderColor: '#fff',
                        yAxisID: 'y'
                    }, {
                        label: '每日出席员工人数',
                        data: employeeCountData,
                        borderColor: '#ff6b6b',
                        backgroundColor: 'rgba(255, 107, 107, 0.1)',
                        borderWidth: 3,
                        fill: false,
                        tension: 0.4,
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        pointBackgroundColor: '#ff6b6b',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverBackgroundColor: '#ee5a52',
                        pointHoverBorderColor: '#fff',
                        yAxisID: 'y1'
                    }, {
                        label: '每日订单数',
                        data: orderCountData,
                        borderColor: '#ffa500',
                        backgroundColor: 'rgba(255, 165, 0, 0.1)',
                        borderWidth: 3,
                        fill: false,
                        tension: 0.4,
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        pointBackgroundColor: '#ffa500',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverBackgroundColor: '#ff8c00',
                        pointHoverBorderColor: '#fff',
                        yAxisID: 'y1'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                font: {
                                    size: 14,
                                    weight: 'bold'
                                },
                                color: '#4a5568',
                                padding: 20,
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleFont: {
                                size: 14,
                                weight: 'bold'
                            },
                            bodyFont: {
                                size: 13
                            },
                            footerFont: {
                                size: 12,
                                weight: 'normal'
                            },
                            padding: 12,
                            cornerRadius: 8,
                            displayColors: true,
                            callbacks: {
                                label: function(context) {
                                    const label = context.dataset.label || '';
                                    const value = context.parsed.y;
                                    if (label === '每日出席员工人数') {
                                        return label + ': ' + value + '人';
                                    }
                                    if (label === '每日订单数') {
                                        return label + ': ' + value + '单';
                                    }
                                    return label + ': ¥' + value.toLocaleString();
                                },
                                footer: function(tooltipItems) {
                                    // 获取当前日期索引
                                    const index = tooltipItems[0].dataIndex;
                                    // 从图表数据中获取员工名单
                                    const chart = tooltipItems[0].chart;
                                    const dailyIncomeData = chart.config._dailyIncomeData;
                                    if (dailyIncomeData && dailyIncomeData[index]) {
                                        const employeeNames = dailyIncomeData[index].employeeNames;
                                        if (employeeNames && employeeNames.length > 0) {
                                            return '\n出席员工:\n' + employeeNames.join('、');
                                        }
                                    }
                                    return '';
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)',
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12
                                },
                                color: '#718096',
                                callback: function(value) {
                                    return '¥' + value.toLocaleString();
                                }
                            },
                            title: {
                                display: true,
                                text: '收入金额（元）',
                                color: '#4a5568',
                                font: {
                                    size: 12,
                                    weight: 'bold'
                                }
                            }
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            beginAtZero: true,
                            grid: {
                                drawOnChartArea: false,
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12
                                },
                                color: '#ff6b6b',
                                callback: function(value) {
                                    return value;
                                },
                                stepSize: 1
                            },
                            title: {
                                display: true,
                                text: '员工人数 / 订单数',
                                color: '#ff6b6b',
                                font: {
                                    size: 12,
                                    weight: 'bold'
                                }
                            }
                        },
                        x: {
                            grid: {
                                display: false,
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 10
                                },
                                color: '#718096',
                                maxRotation: 60,
                                minRotation: 45,
                                autoSkip: true,
                                maxTicksLimit: 15
                            }
                        }
                    },
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    }
                }
            });
            // 保存数据供tooltip使用
            this.incomeChart.config._dailyIncomeData = dailyIncomeData;
        }
    }

    // 计算每日收入数据
    calculateDailyIncome(dateRange) {
        // 按日期分组统计收入、提成、费用
        const dailyData = {};
        
        // 获取日期范围
        let startDate, endDate;
        
        if (typeof dateRange === 'object' && dateRange.custom) {
            // 自定义日期范围
            startDate = new Date(dateRange.startDate);
            endDate = new Date(dateRange.endDate);
            // 设置时间到当天结束
            endDate.setHours(23, 59, 59, 999);
        } else if (dateRange === 'all') {
            startDate = null;
            endDate = null;
        } else {
            // 最近N天
            const today = new Date();
            startDate = new Date(today.getTime() - (dateRange - 1) * 24 * 60 * 60 * 1000);
            endDate = today;
        }

        // 统计每日收入和提成
        this.schedules.forEach(schedule => {
            const scheduleDate = new Date(schedule.scheduleDate);
            
            // 如果指定了日期范围，过滤数据
            if (startDate && scheduleDate < startDate) {
                return;
            }
            if (endDate && scheduleDate > endDate) {
                return;
            }

            const dateKey = schedule.scheduleDate;
            if (!dailyData[dateKey]) {
                dailyData[dateKey] = {
                    income: 0,
                    commission: 0,
                    attendanceFee: 0,
                    interviewFee: 0,
                    employees: new Set(),
                    orderCount: 0
                };
            }
            dailyData[dateKey].income += schedule.payment;
            dailyData[dateKey].commission += (schedule.commission || 0);
            dailyData[dateKey].employees.add(schedule.employeeName);
            dailyData[dateKey].orderCount += 1;
        });

        // 统计每日坐班费用
        this.attendanceFees.forEach(fee => {
            const feeDate = new Date(fee.date);
            
            if (startDate && feeDate < startDate) {
                return;
            }
            if (endDate && feeDate > endDate) {
                return;
            }

            const dateKey = fee.date;
            if (!dailyData[dateKey]) {
                dailyData[dateKey] = {
                    income: 0,
                    commission: 0,
                    attendanceFee: 0,
                    interviewFee: 0,
                    employees: new Set(),
                    orderCount: 0
                };
            }
            dailyData[dateKey].attendanceFee += fee.fee;
            dailyData[dateKey].employees.add(fee.employeeName);
        });

        // 统计每日面试费用
        this.interviewFees.forEach(fee => {
            const feeDate = new Date(fee.date);
            
            if (startDate && feeDate < startDate) {
                return;
            }
            if (endDate && feeDate > endDate) {
                return;
            }

            const dateKey = fee.date;
            if (!dailyData[dateKey]) {
                dailyData[dateKey] = {
                    income: 0,
                    commission: 0,
                    attendanceFee: 0,
                    interviewFee: 0,
                    employees: new Set(),
                    orderCount: 0
                };
            }
            dailyData[dateKey].interviewFee += fee.fee;
            dailyData[dateKey].employees.add(fee.employeeName);
        });

        // 转换为数组并按日期排序，计算净收益
        const result = Object.keys(dailyData)
            .sort((a, b) => new Date(a) - new Date(b))
            .map(date => {
                const data = dailyData[date];
                const netProfit = data.income - data.attendanceFee - data.interviewFee - data.commission;
                return {
                    date: this.formatDateWithWeekday(date),
                    income: data.income,
                    netProfit: netProfit,
                    commission: data.commission,
                    attendanceFee: data.attendanceFee,
                    interviewFee: data.interviewFee,
                    employeeCount: data.employees.size,
                    employeeNames: Array.from(data.employees),
                    orderCount: data.orderCount,
                    rawDate: date
                };
            });

        // 如果没有数据，返回当天的空数据
        if (result.length === 0) {
            const today = new Date();
            return [{
                date: this.formatDateWithWeekday(today.toISOString().split('T')[0]),
                income: 0,
                netProfit: 0,
                commission: 0,
                attendanceFee: 0,
                interviewFee: 0,
                employeeCount: 0,
                employeeNames: [],
                orderCount: 0
            }];
        }

        return result;
    }

    // 更新图表统计信息
    updateChartStats(dailyIncomeData) {
        const incomes = dailyIncomeData.map(item => item.income);
        const netProfits = dailyIncomeData.map(item => item.netProfit);
        
        const totalIncome = incomes.reduce((sum, income) => sum + income, 0);
        const avgIncome = incomes.length > 0 ? totalIncome / incomes.length : 0;
        const maxIncome = incomes.length > 0 ? Math.max(...incomes) : 0;
        const minIncome = incomes.length > 0 ? Math.min(...incomes) : 0;

        const totalNetProfit = netProfits.reduce((sum, profit) => sum + profit, 0);
        const avgNetProfit = netProfits.length > 0 ? totalNetProfit / netProfits.length : 0;

        document.getElementById('chartTotalIncome').textContent = `¥${totalIncome.toLocaleString()}`;
        document.getElementById('chartAvgIncome').textContent = `¥${avgIncome.toFixed(2).toLocaleString()}`;
        document.getElementById('chartMaxIncome').textContent = `¥${maxIncome.toLocaleString()}`;
        document.getElementById('chartMinIncome').textContent = `¥${minIncome.toLocaleString()}`;
        document.getElementById('chartTotalNetProfit').textContent = `¥${totalNetProfit.toLocaleString()}`;
        document.getElementById('chartAvgNetProfit').textContent = `¥${avgNetProfit.toFixed(2).toLocaleString()}`;
    }

    // Tab切换功能
    switchTab(tabName) {
        // 隐藏所有tab内容
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        // 如果切换到店铺中心页面
        if (tabName === 'store-center') {
            this.renderStoresList();
            this.renderAllStoresSummary();
            this.renderStoreComparisonChart();
            this.updateStoreSelector();
        }

        // 移除所有tab按钮的active状态
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // 显示选中的tab内容
        document.getElementById(`${tabName}-tab`).classList.add('active');

        // 激活选中的tab按钮
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // 如果切换到管理页面，刷新员工和项目列表
        if (tabName === 'management') {
            this.renderEmployeeList();
            this.renderProjectList();
        }

        // 如果切换到图表页面，初始化/更新图表
        if (tabName === 'charts') {
            this.initializeIncomeChart();
            this.initializeHeatmapChart();
            this.initializeSourceChannelCharts();
            this.initializeEmployeePerformanceChart();
            this.initializeClientEmployeeCollaborationChart();
            this.updateEmployeeClientSelector();
            this.initializeEmployeeClientChart();
            this.initializeCustomerStatusCharts();
        }

        // 如果切换到运营成本页面，刷新运营成本表格和图表
        if (tabName === 'operating-cost') {
            this.renderOperatingCostTable();
            this.updateOperatingCostStats();
            this.initializeOperatingCostCharts();
        }

        // 如果切换到 AI 分析页面，恢复保存的 API Key
        if (tabName === 'ai-analysis') {
            const savedKey = localStorage.getItem('deepseek_api_key');
            const keyInput = document.getElementById('aiApiKey');
            if (keyInput && savedKey) keyInput.value = savedKey;
        }

        if (tabName === 'data-convert') {
            this.jlRefreshPriceStatus();
        }

    }

    // 初始化热力图
    initializeHeatmapChart() {
        // 如果图表已存在，先销毁
        if (this.heatmapChart) {
            this.heatmapChart.destroy();
        }

        this.updateHeatmapChart();
    }

    // 更新热力图
    updateHeatmapChart() {
        const dateRangeValue = document.getElementById('heatmapDateRange').value;
        let dateRange;
        
        if (dateRangeValue === 'custom') {
            const startDate = document.getElementById('heatmapStartDate').value;
            const endDate = document.getElementById('heatmapEndDate').value;
            
            if (!startDate || !endDate) {
                return; // 如果日期未完整选择，不更新图表
            }
            
            dateRange = { custom: true, startDate, endDate };
        } else {
            dateRange = dateRangeValue === 'all' ? 'all' : parseInt(dateRangeValue);
        }
        
        const hourlyData = this.calculateHourlyData(dateRange);

        // 更新统计卡片
        this.updateHeatmapStats(hourlyData);

        // 准备图表数据
        const labels = hourlyData.map(item => item.hour);
        const orderCounts = hourlyData.map(item => item.count);
        const incomeData = hourlyData.map(item => item.income);

        // 获取canvas上下文
        const ctx = document.getElementById('heatmapChart').getContext('2d');

        // 创建或更新图表
        if (this.heatmapChart) {
            this.heatmapChart.data.labels = labels;
            this.heatmapChart.data.datasets[0].data = orderCounts;
            this.heatmapChart.data.datasets[1].data = incomeData;
            this.heatmapChart.update();
        } else {
            this.heatmapChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '订单数量',
                        data: orderCounts,
                        backgroundColor: 'rgba(102, 126, 234, 0.8)',
                        borderColor: '#667eea',
                        borderWidth: 2,
                        yAxisID: 'y',
                        order: 2
                    }, {
                        label: '收入金额',
                        data: incomeData,
                        type: 'line',
                        borderColor: '#28a745',
                        backgroundColor: 'rgba(40, 167, 69, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        pointBackgroundColor: '#28a745',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        yAxisID: 'y1',
                        order: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                font: {
                                    size: 14,
                                    weight: 'bold'
                                },
                                color: '#4a5568',
                                padding: 20,
                                usePointStyle: true
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleFont: {
                                size: 14,
                                weight: 'bold'
                            },
                            bodyFont: {
                                size: 13
                            },
                            padding: 12,
                            cornerRadius: 8,
                            displayColors: true,
                            callbacks: {
                                label: function(context) {
                                    const label = context.dataset.label || '';
                                    if (label === '订单数量') {
                                        return label + ': ' + context.parsed.y + '单';
                                    } else {
                                        return label + ': ¥' + context.parsed.y.toLocaleString();
                                    }
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '订单数量',
                                color: '#667eea',
                                font: {
                                    size: 13,
                                    weight: 'bold'
                                }
                            },
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)',
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12
                                },
                                color: '#718096',
                                stepSize: 1
                            }
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '收入金额（¥）',
                                color: '#28a745',
                                font: {
                                    size: 13,
                                    weight: 'bold'
                                }
                            },
                            grid: {
                                drawOnChartArea: false,
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12
                                },
                                color: '#718096',
                                callback: function(value) {
                                    return '¥' + value.toLocaleString();
                                }
                            }
                        },
                        x: {
                            grid: {
                                display: false,
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 11
                                },
                                color: '#718096'
                            }
                        }
                    },
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    }
                }
            });
        }
    }

    // 计算每小时数据
    calculateHourlyData(dateRange) {
        // 初始化24小时的数据结构
        const hourlyStats = {};
        for (let i = 0; i < 24; i++) {
            hourlyStats[i] = {
                hour: `${i.toString().padStart(2, '0')}:00`,
                count: 0,
                income: 0
            };
        }

        // 获取日期范围
        let startDate = null;
        let endDate = null;
        
        if (typeof dateRange === 'object' && dateRange.custom) {
            // 自定义日期范围
            startDate = new Date(dateRange.startDate);
            endDate = new Date(dateRange.endDate);
            // 设置时间到当天结束
            endDate.setHours(23, 59, 59, 999);
        } else if (dateRange === 'all') {
            startDate = null;
            endDate = null;
        } else {
            // 最近N天
            const today = new Date();
            startDate = new Date(today.getTime() - (dateRange - 1) * 24 * 60 * 60 * 1000);
            endDate = null;
        }

        // 统计每个时段的订单和收入
        this.schedules.forEach(schedule => {
            const scheduleDate = new Date(schedule.scheduleDate);
            
            // 如果指定了日期范围，过滤数据
            if (startDate && scheduleDate < startDate) {
                return;
            }
            if (endDate && scheduleDate > endDate) {
                return;
            }

            // 解析开始时间，获取小时
            const startHour = parseInt(schedule.startTime.split(':')[0]);
            
            if (startHour >= 0 && startHour < 24) {
                hourlyStats[startHour].count += 1;
                hourlyStats[startHour].income += schedule.payment;
            }
        });

        // 转换为数组
        const result = [];
        for (let i = 0; i < 24; i++) {
            result.push(hourlyStats[i]);
        }

        return result;
    }

    // 更新热力图统计信息
    updateHeatmapStats(hourlyData) {
        // 找出最忙和最闲的时段
        let maxCount = 0;
        let minCount = Infinity;
        let busiestHour = '--';
        let quietestHour = '--';
        let peakIncome = 0;
        let totalOrders = 0;

        hourlyData.forEach(item => {
            totalOrders += item.count;
            
            if (item.count > 0) {
                if (item.count > maxCount) {
                    maxCount = item.count;
                    busiestHour = item.hour;
                    peakIncome = item.income;
                }
                
                if (item.count < minCount) {
                    minCount = item.count;
                    quietestHour = item.hour;
                }
            }
        });

        // 如果没有订单，重置最闲时段
        if (minCount === Infinity) {
            quietestHour = '--';
        }

        document.getElementById('busiestHour').textContent = busiestHour + (maxCount > 0 ? ` (${maxCount}单)` : '');
        document.getElementById('quietestHour').textContent = quietestHour + (minCount !== Infinity && minCount > 0 ? ` (${minCount}单)` : '');
        document.getElementById('totalOrders').textContent = totalOrders + '单';
        document.getElementById('peakHourIncome').textContent = `¥${peakIncome.toLocaleString()}`;
    }

    // 初始化客户来源渠道图表
    initializeSourceChannelCharts() {
        // 如果图表已存在，先销毁
        if (this.sourceChannelOrderChart) {
            this.sourceChannelOrderChart.destroy();
        }
        if (this.sourceChannelIncomeChart) {
            this.sourceChannelIncomeChart.destroy();
        }

        this.updateSourceChannelCharts();
    }

    // 更新客户来源渠道图表
    updateSourceChannelCharts() {
        const dateRangeValue = document.getElementById('sourceChannelDateRange').value;
        let dateRange;
        
        if (dateRangeValue === 'custom') {
            const startDate = document.getElementById('sourceChannelStartDate').value;
            const endDate = document.getElementById('sourceChannelEndDate').value;
            
            if (!startDate || !endDate) {
                return; // 如果日期未完整选择，不更新图表
            }
            
            dateRange = { custom: true, startDate, endDate };
        } else {
            dateRange = dateRangeValue === 'all' ? 'all' : parseInt(dateRangeValue);
        }
        
        const channelData = this.calculateChannelData(dateRange);

        // 更新统计卡片
        this.updateSourceChannelStats(channelData);

        // 准备图表数据
        const labels = channelData.map(item => item.channel);
        const orderCounts = channelData.map(item => item.count);
        const incomeData = channelData.map(item => item.income);

        // 定义渠道颜色映射
        const channelColors = {
            '小红书': '#FF2442',
            '微信群': '#07C160',
            'tg': '#0088CC',
            'TG': '#0088CC',
            '抖音': '#000000',
            '视频号': '#07C160',
            '美团': '#FFC300',
            '批量导入': '#999999'
        };

        const backgroundColors = labels.map(label => channelColors[label] || '#667eea');
        const borderColors = backgroundColors;

        // 创建订单数量饼图
        const orderCtx = document.getElementById('sourceChannelOrderChart').getContext('2d');
        if (this.sourceChannelOrderChart) {
            this.sourceChannelOrderChart.data.labels = labels;
            this.sourceChannelOrderChart.data.datasets[0].data = orderCounts;
            this.sourceChannelOrderChart.data.datasets[0].backgroundColor = backgroundColors;
            this.sourceChannelOrderChart.data.datasets[0].borderColor = borderColors;
            this.sourceChannelOrderChart.update();
        } else {
            this.sourceChannelOrderChart = new Chart(orderCtx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '订单数量',
                        data: orderCounts,
                        backgroundColor: backgroundColors,
                        borderColor: borderColors,
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: {
                                font: {
                                    size: 13,
                                    weight: 'bold'
                                },
                                color: '#4a5568',
                                padding: 15,
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleFont: {
                                size: 14,
                                weight: 'bold'
                            },
                            bodyFont: {
                                size: 13
                            },
                            padding: 12,
                            cornerRadius: 8,
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return label + ': ' + value + '单 (' + percentage + '%)';
                                }
                            }
                        },
                        datalabels: {
                            display: true,
                            color: '#fff',
                            font: {
                                size: 13,
                                weight: 'bold',
                                lineHeight: 1.4
                            },
                            formatter: function(value, context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                if (percentage < 3) {
                                    return ''; // 小于3%不显示，避免拥挤
                                }
                                const label = context.chart.data.labels[context.dataIndex];
                                return label + '\n' + value + '单 (' + percentage + '%)';
                            },
                            textAlign: 'center',
                            anchor: 'end',
                            align: 'end',
                            offset: 10,
                            padding: {
                                top: 4,
                                bottom: 4,
                                left: 6,
                                right: 6
                            },
                            backgroundColor: 'rgba(0, 0, 0, 0.75)',
                            borderRadius: 4,
                            borderColor: '#fff',
                            borderWidth: 1
                        }
                    }
                }
            });
        }

        // 创建收入金额饼图
        const incomeCtx = document.getElementById('sourceChannelIncomeChart').getContext('2d');
        if (this.sourceChannelIncomeChart) {
            this.sourceChannelIncomeChart.data.labels = labels;
            this.sourceChannelIncomeChart.data.datasets[0].data = incomeData;
            this.sourceChannelIncomeChart.data.datasets[0].backgroundColor = backgroundColors;
            this.sourceChannelIncomeChart.data.datasets[0].borderColor = borderColors;
            this.sourceChannelIncomeChart.update();
        } else {
            this.sourceChannelIncomeChart = new Chart(incomeCtx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '收入金额',
                        data: incomeData,
                        backgroundColor: backgroundColors,
                        borderColor: borderColors,
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: {
                                font: {
                                    size: 13,
                                    weight: 'bold'
                                },
                                color: '#4a5568',
                                padding: 15,
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleFont: {
                                size: 14,
                                weight: 'bold'
                            },
                            bodyFont: {
                                size: 13
                            },
                            padding: 12,
                            cornerRadius: 8,
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return label + ': ¥' + value.toLocaleString() + ' (' + percentage + '%)';
                                }
                            }
                        },
                        datalabels: {
                            display: true,
                            color: '#fff',
                            font: {
                                size: 13,
                                weight: 'bold',
                                lineHeight: 1.4
                            },
                            formatter: function(value, context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                if (percentage < 3) {
                                    return ''; // 小于3%不显示，避免拥挤
                                }
                                const label = context.chart.data.labels[context.dataIndex];
                                return label + '\n¥' + value.toLocaleString() + ' (' + percentage + '%)';
                            },
                            textAlign: 'center',
                            anchor: 'end',
                            align: 'end',
                            offset: 10,
                            padding: {
                                top: 4,
                                bottom: 4,
                                left: 6,
                                right: 6
                            },
                            backgroundColor: 'rgba(0, 0, 0, 0.75)',
                            borderRadius: 4,
                            borderColor: '#fff',
                            borderWidth: 1
                        }
                    }
                }
            });
        }
    }

    // 计算客户来源渠道数据
    calculateChannelData(dateRange) {
        // 按渠道分组统计
        const channelStats = {};

        // 获取日期范围
        let startDate = null;
        let endDate = null;
        
        if (typeof dateRange === 'object' && dateRange.custom) {
            // 自定义日期范围
            startDate = new Date(dateRange.startDate);
            endDate = new Date(dateRange.endDate);
            // 设置时间到当天结束
            endDate.setHours(23, 59, 59, 999);
        } else if (dateRange === 'all') {
            startDate = null;
            endDate = null;
        } else {
            // 最近N天
            const today = new Date();
            startDate = new Date(today.getTime() - (dateRange - 1) * 24 * 60 * 60 * 1000);
            endDate = null;
        }

        // 统计每个渠道的订单和收入
        this.schedules.forEach(schedule => {
            const scheduleDate = new Date(schedule.scheduleDate);
            
            // 如果指定了日期范围，过滤数据
            if (startDate && scheduleDate < startDate) {
                return;
            }
            if (endDate && scheduleDate > endDate) {
                return;
            }

            const channel = schedule.clientSource || '未知渠道';
            
            if (!channelStats[channel]) {
                channelStats[channel] = {
                    channel: channel,
                    count: 0,
                    income: 0
                };
            }
            
            channelStats[channel].count += 1;
            channelStats[channel].income += schedule.payment;
        });

        // 转换为数组并按订单数量降序排序
        const result = Object.values(channelStats).sort((a, b) => b.count - a.count);

        return result;
    }

    // 更新客户来源渠道统计信息
    updateSourceChannelStats(channelData) {
        if (channelData.length === 0) {
            document.getElementById('topChannel').textContent = '--';
            document.getElementById('channelCount').textContent = '0';
            document.getElementById('topChannelOrders').textContent = '0单';
            document.getElementById('topChannelIncome').textContent = '¥0';
            return;
        }

        // 找出最佳渠道（按订单数量）
        const topChannel = channelData[0];
        
        // 找出收入最高的渠道
        const topIncomeChannel = [...channelData].sort((a, b) => b.income - a.income)[0];

        document.getElementById('topChannel').textContent = topChannel.channel;
        document.getElementById('channelCount').textContent = channelData.length + '个';
        document.getElementById('topChannelOrders').textContent = topChannel.count + '单';
        document.getElementById('topChannelIncome').textContent = '¥' + topIncomeChannel.income.toLocaleString();
    }

    // 初始化员工业绩对比图表
    initializeEmployeePerformanceChart() {
        // 如果图表已存在，先销毁
        if (this.employeePerformanceChart) {
            this.employeePerformanceChart.destroy();
        }

        this.updateEmployeePerformanceChart();
    }

    // 更新员工业绩对比图表
    updateEmployeePerformanceChart() {
        const dateRangeValue = document.getElementById('employeePerformanceDateRange').value;
        let dateRange;
        
        if (dateRangeValue === 'custom') {
            const startDate = document.getElementById('employeePerformanceStartDate').value;
            const endDate = document.getElementById('employeePerformanceEndDate').value;
            
            if (!startDate || !endDate) {
                return; // 如果日期未完整选择，不更新图表
            }
            
            dateRange = { custom: true, startDate, endDate };
        } else {
            dateRange = dateRangeValue === 'all' ? 'all' : parseInt(dateRangeValue);
        }
        
        const employeeData = this.calculateEmployeePerformanceData(dateRange);

        // 更新统计卡片
        this.updateEmployeePerformanceStats(employeeData);

        // 准备图表数据
        const labels = employeeData.map(item => item.name);
        const incomeData = employeeData.map(item => item.income);
        const orderCounts = employeeData.map(item => item.orderCount);
        const commissionData = employeeData.map(item => item.commission);

        // 获取canvas上下文
        const ctx = document.getElementById('employeePerformanceChart').getContext('2d');

        // 创建或更新图表
        if (this.employeePerformanceChart) {
            this.employeePerformanceChart.data.labels = labels;
            this.employeePerformanceChart.data.datasets[0].data = incomeData;
            this.employeePerformanceChart.data.datasets[1].data = orderCounts;
            this.employeePerformanceChart.data.datasets[2].data = commissionData;
            this.employeePerformanceChart.update();
        } else {
            this.employeePerformanceChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '总收入',
                        data: incomeData,
                        backgroundColor: 'rgba(102, 126, 234, 0.8)',
                        borderColor: '#667eea',
                        borderWidth: 2,
                        yAxisID: 'y'
                    }, {
                        label: '订单数量',
                        data: orderCounts,
                        backgroundColor: 'rgba(255, 193, 7, 0.8)',
                        borderColor: '#ffc107',
                        borderWidth: 2,
                        yAxisID: 'y1'
                    }, {
                        label: '员工提成',
                        data: commissionData,
                        backgroundColor: 'rgba(40, 167, 69, 0.8)',
                        borderColor: '#28a745',
                        borderWidth: 2,
                        yAxisID: 'y'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                font: {
                                    size: 14,
                                    weight: 'bold'
                                },
                                color: '#4a5568',
                                padding: 20,
                                usePointStyle: true
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleFont: {
                                size: 14,
                                weight: 'bold'
                            },
                            bodyFont: {
                                size: 13
                            },
                            padding: 12,
                            cornerRadius: 8,
                            displayColors: true,
                            callbacks: {
                                label: function(context) {
                                    const label = context.dataset.label || '';
                                    if (label === '订单数量') {
                                        return label + ': ' + context.parsed.y + '单';
                                    } else {
                                        return label + ': ¥' + context.parsed.y.toLocaleString();
                                    }
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '金额（¥）',
                                color: '#667eea',
                                font: {
                                    size: 13,
                                    weight: 'bold'
                                }
                            },
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)',
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12
                                },
                                color: '#718096',
                                callback: function(value) {
                                    return '¥' + value.toLocaleString();
                                }
                            }
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '订单数量',
                                color: '#ffc107',
                                font: {
                                    size: 13,
                                    weight: 'bold'
                                }
                            },
                            grid: {
                                drawOnChartArea: false,
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12
                                },
                                color: '#718096',
                                stepSize: 1
                            }
                        },
                        x: {
                            grid: {
                                display: false,
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12,
                                    weight: 'bold'
                                },
                                color: '#718096'
                            }
                        }
                    },
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    }
                }
            });
        }
    }

    // 计算员工业绩数据
    calculateEmployeePerformanceData(dateRange) {
        // 按员工分组统计
        const employeeStats = {};

        // 获取日期范围
        let startDate = null;
        let endDate = null;
        
        if (typeof dateRange === 'object' && dateRange.custom) {
            // 自定义日期范围
            startDate = new Date(dateRange.startDate);
            endDate = new Date(dateRange.endDate);
            // 设置时间到当天结束
            endDate.setHours(23, 59, 59, 999);
        } else if (dateRange === 'all') {
            startDate = null;
            endDate = null;
        } else {
            // 最近N天
            const today = new Date();
            startDate = new Date(today.getTime() - (dateRange - 1) * 24 * 60 * 60 * 1000);
            endDate = null;
        }

        // 统计每个员工的业绩
        this.schedules.forEach(schedule => {
            const scheduleDate = new Date(schedule.scheduleDate);
            
            // 如果指定了日期范围，过滤数据
            if (startDate && scheduleDate < startDate) {
                return;
            }
            if (endDate && scheduleDate > endDate) {
                return;
            }

            const employeeName = schedule.employeeName;
            
            if (!employeeStats[employeeName]) {
                employeeStats[employeeName] = {
                    name: employeeName,
                    income: 0,
                    orderCount: 0,
                    commission: 0
                };
            }
            
            employeeStats[employeeName].income += schedule.payment;
            employeeStats[employeeName].orderCount += 1;
            employeeStats[employeeName].commission += (schedule.commission || 0);
        });

        // 转换为数组并按收入降序排序
        const result = Object.values(employeeStats).sort((a, b) => b.income - a.income);

        return result;
    }

    // 更新员工业绩统计信息
    updateEmployeePerformanceStats(employeeData) {
        if (employeeData.length === 0) {
            document.getElementById('topEmployee').textContent = '--';
            document.getElementById('employeeTotal').textContent = '0人';
            document.getElementById('topEmployeeIncome').textContent = '¥0';
            document.getElementById('avgEmployeeIncome').textContent = '¥0';
            return;
        }

        // 最佳员工（按收入）
        const topEmployee = employeeData[0];
        
        // 计算平均业绩
        const totalIncome = employeeData.reduce((sum, emp) => sum + emp.income, 0);
        const avgIncome = totalIncome / employeeData.length;

        document.getElementById('topEmployee').textContent = topEmployee.name + ` (${topEmployee.orderCount}单)`;
        document.getElementById('employeeTotal').textContent = employeeData.length + '人';
        document.getElementById('topEmployeeIncome').textContent = '¥' + topEmployee.income.toLocaleString();
        document.getElementById('avgEmployeeIncome').textContent = '¥' + avgIncome.toFixed(2).toLocaleString();
    }

    // 初始化客户合作员工数量图表
    initializeClientEmployeeCollaborationChart() {
        // 如果图表已存在，先销毁
        if (this.clientEmployeeCollaborationChart) {
            this.clientEmployeeCollaborationChart.destroy();
        }

        this.updateClientEmployeeCollaborationChart();
    }

    // 更新客户合作员工数量图表
    updateClientEmployeeCollaborationChart() {
        const dateRangeValue = document.getElementById('clientEmployeeCollaborationDateRange').value;
        let dateRange;
        
        if (dateRangeValue === 'custom') {
            const startDate = document.getElementById('clientEmployeeCollaborationStartDate').value;
            const endDate = document.getElementById('clientEmployeeCollaborationEndDate').value;
            
            if (!startDate || !endDate) {
                return; // 如果日期未完整选择，不更新图表
            }
            
            dateRange = { custom: true, startDate, endDate };
        } else {
            dateRange = dateRangeValue === 'all' ? 'all' : parseInt(dateRangeValue);
        }
        
        const collaborationData = this.calculateClientEmployeeCollaborationData(dateRange);

        // 更新统计卡片
        this.updateClientCollaborationStats(collaborationData);

        // 准备图表数据 - 只取前10个
        const top10Data = collaborationData.slice(0, 10);
        const labels = top10Data.map(item => item.clientName);
        const employeeCounts = top10Data.map(item => item.employeeCount);
        const orderCounts = top10Data.map(item => item.orderCount);

        // 获取canvas上下文
        const ctx = document.getElementById('clientEmployeeCollaborationChart').getContext('2d');

        // 创建或更新图表
        if (this.clientEmployeeCollaborationChart) {
            this.clientEmployeeCollaborationChart.data.labels = labels;
            this.clientEmployeeCollaborationChart.data.datasets[0].data = employeeCounts;
            this.clientEmployeeCollaborationChart.data.datasets[1].data = orderCounts;
            this.clientEmployeeCollaborationChart.update();
        } else {
            this.clientEmployeeCollaborationChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '合作员工数量',
                        data: employeeCounts,
                        backgroundColor: 'rgba(102, 126, 234, 0.8)',
                        borderColor: '#667eea',
                        borderWidth: 2,
                        borderRadius: 6,
                        yAxisID: 'y'
                    }, {
                        label: '订单数量',
                        data: orderCounts,
                        backgroundColor: 'rgba(255, 193, 7, 0.8)',
                        borderColor: '#ffc107',
                        borderWidth: 2,
                        borderRadius: 6,
                        yAxisID: 'y1'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: '客户合作员工数量 TOP10',
                            font: {
                                size: 16,
                                weight: 'bold'
                            },
                            color: '#2d3748',
                            padding: {
                                top: 10,
                                bottom: 20
                            }
                        },
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                font: {
                                    size: 13
                                },
                                color: '#4a5568',
                                padding: 15,
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleFont: {
                                size: 14,
                                weight: 'bold'
                            },
                            bodyFont: {
                                size: 13
                            },
                            padding: 12,
                            cornerRadius: 8,
                            displayColors: true,
                            callbacks: {
                                label: function(context) {
                                    const label = context.dataset.label || '';
                                    const value = context.parsed.y;
                                    if (label.includes('员工')) {
                                        return ` ${label}: ${value}人`;
                                    } else {
                                        return ` ${label}: ${value}单`;
                                    }
                                },
                                afterLabel: function(context) {
                                    const dataIndex = context.dataIndex;
                                    const clientData = top10Data[dataIndex];
                                    if (clientData && clientData.employees && clientData.employees.length > 0) {
                                        const employeeList = clientData.employees.join(', ');
                                        return `合作员工: ${employeeList}`;
                                    }
                                    return '';
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '合作员工数量（人）',
                                color: '#667eea',
                                font: {
                                    size: 13,
                                    weight: 'bold'
                                }
                            },
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)',
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12
                                },
                                color: '#718096',
                                stepSize: 1
                            }
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '订单数量（单）',
                                color: '#ffc107',
                                font: {
                                    size: 13,
                                    weight: 'bold'
                                }
                            },
                            grid: {
                                drawOnChartArea: false,
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12
                                },
                                color: '#718096',
                                stepSize: 1
                            }
                        },
                        x: {
                            grid: {
                                display: false,
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 11,
                                    weight: 'bold'
                                },
                                color: '#718096',
                                maxRotation: 45,
                                minRotation: 45
                            }
                        }
                    },
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    }
                }
            });
        }
    }

    // 计算客户合作员工数据
    calculateClientEmployeeCollaborationData(dateRange) {
        // 筛选指定时间范围内的数据
        let filteredSchedules = this.schedules;
        
        if (typeof dateRange === 'object' && dateRange.custom) {
            // 自定义日期范围
            const startDate = new Date(dateRange.startDate);
            const endDate = new Date(dateRange.endDate);
            endDate.setHours(23, 59, 59, 999);
            
            filteredSchedules = this.schedules.filter(schedule => {
                const scheduleDate = new Date(schedule.scheduleDate);
                return scheduleDate >= startDate && scheduleDate <= endDate;
            });
        } else if (dateRange !== 'all') {
            // 最近N天
            const today = new Date();
            const startDate = new Date(today);
            startDate.setDate(today.getDate() - dateRange);
            
            filteredSchedules = this.schedules.filter(schedule => {
                const scheduleDate = new Date(schedule.scheduleDate);
                return scheduleDate >= startDate && scheduleDate <= today;
            });
        }

        // 按客户分组统计合作的员工
        const clientStats = {};

        filteredSchedules.forEach(schedule => {
            const clientName = schedule.clientName;
            const employeeName = schedule.employeeName;

            if (!clientStats[clientName]) {
                clientStats[clientName] = {
                    clientName: clientName,
                    employees: new Set(),
                    orderCount: 0
                };
            }

            clientStats[clientName].employees.add(employeeName);
            clientStats[clientName].orderCount += 1;
        });

        // 转换为数组并计算员工数量
        const collaborationData = Object.values(clientStats).map(client => ({
            clientName: client.clientName,
            employeeCount: client.employees.size,
            orderCount: client.orderCount,
            employees: Array.from(client.employees)
        }));

        // 按合作员工数量降序排序
        collaborationData.sort((a, b) => {
            if (b.employeeCount !== a.employeeCount) {
                return b.employeeCount - a.employeeCount;
            }
            // 如果员工数量相同，按订单数量排序
            return b.orderCount - a.orderCount;
        });

        return collaborationData;
    }

    // 更新客户合作统计卡片
    updateClientCollaborationStats(collaborationData) {
        if (collaborationData.length === 0) {
            document.getElementById('topCollaborationClient').textContent = '--';
            document.getElementById('totalCollaborationClients').textContent = '0';
            document.getElementById('maxCollaborationEmployees').textContent = '0人';
            document.getElementById('avgCollaborationEmployees').textContent = '0人';
            return;
        }

        const topClient = collaborationData[0];
        const totalClients = collaborationData.length;
        const maxEmployees = topClient.employeeCount;
        const avgEmployees = collaborationData.reduce((sum, client) => sum + client.employeeCount, 0) / totalClients;

        document.getElementById('topCollaborationClient').textContent = topClient.clientName + ` (${topClient.employeeCount}人)`;
        document.getElementById('totalCollaborationClients').textContent = totalClients.toString();
        document.getElementById('maxCollaborationEmployees').textContent = maxEmployees + '人';
        document.getElementById('avgCollaborationEmployees').textContent = avgEmployees.toFixed(1) + '人';
    }

    // 更新员工客户图表的员工选择器
    updateEmployeeClientSelector() {
        const select = document.getElementById('employeeClientEmployee');
        select.innerHTML = '<option value="">请选择员工</option>';
        
        this.employees.forEach(employee => {
            const option = document.createElement('option');
            option.value = employee.name;
            option.textContent = employee.name;
            select.appendChild(option);
        });

        // 默认选择第一个员工
        if (this.employees.length > 0) {
            select.value = this.employees[0].name;
        }
    }

    // 初始化员工客户合作图表
    initializeEmployeeClientChart() {
        // 如果图表已存在，先销毁
        if (this.employeeClientChart) {
            this.employeeClientChart.destroy();
        }

        this.updateEmployeeClientChart();
    }

    // 更新员工客户合作图表
    updateEmployeeClientChart() {
        const employeeName = document.getElementById('employeeClientEmployee').value;
        
        if (!employeeName) {
            // 如果没有选择员工，清空图表
            document.getElementById('topEmployeeClient').textContent = '--';
            document.getElementById('totalEmployeeClients').textContent = '0';
            document.getElementById('totalEmployeeOrders').textContent = '0单';
            document.getElementById('totalEmployeeIncome').textContent = '¥0';
            
            const ctx = document.getElementById('employeeClientChart').getContext('2d');
            if (this.employeeClientChart) {
                this.employeeClientChart.destroy();
                this.employeeClientChart = null;
            }
            
            // 显示提示信息
            ctx.font = '16px Arial';
            ctx.fillStyle = '#718096';
            ctx.textAlign = 'center';
            ctx.fillText('请选择员工查看数据', ctx.canvas.width / 2, ctx.canvas.height / 2);
            return;
        }

        const dateRangeValue = document.getElementById('employeeClientDateRange').value;
        let dateRange;
        
        if (dateRangeValue === 'custom') {
            const startDate = document.getElementById('employeeClientStartDate').value;
            const endDate = document.getElementById('employeeClientEndDate').value;
            
            if (!startDate || !endDate) {
                return; // 如果日期未完整选择，不更新图表
            }
            
            dateRange = { custom: true, startDate, endDate };
        } else {
            dateRange = dateRangeValue === 'all' ? 'all' : parseInt(dateRangeValue);
        }
        
        const clientData = this.calculateEmployeeClientData(employeeName, dateRange);

        // 更新统计卡片
        this.updateEmployeeClientStats(clientData);

        // 准备图表数据 - 只取前10个
        const top10Data = clientData.slice(0, 10);
        const labels = top10Data.map(item => item.clientName);
        const orderCounts = top10Data.map(item => item.orderCount);
        const incomeData = top10Data.map(item => item.totalIncome);

        // 获取canvas上下文
        const ctx = document.getElementById('employeeClientChart').getContext('2d');

        // 创建或更新图表
        if (this.employeeClientChart) {
            this.employeeClientChart.data.labels = labels;
            this.employeeClientChart.data.datasets[0].data = orderCounts;
            this.employeeClientChart.data.datasets[1].data = incomeData;
            this.employeeClientChart.update();
        } else {
            this.employeeClientChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '合作次数',
                        data: orderCounts,
                        backgroundColor: 'rgba(102, 126, 234, 0.8)',
                        borderColor: '#667eea',
                        borderWidth: 2,
                        borderRadius: 6,
                        yAxisID: 'y'
                    }, {
                        label: '收入金额',
                        data: incomeData,
                        backgroundColor: 'rgba(40, 167, 69, 0.8)',
                        borderColor: '#28a745',
                        borderWidth: 2,
                        borderRadius: 6,
                        yAxisID: 'y1'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: `${employeeName} - 客户合作 TOP10`,
                            font: {
                                size: 16,
                                weight: 'bold'
                            },
                            color: '#2d3748',
                            padding: {
                                top: 10,
                                bottom: 20
                            }
                        },
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                font: {
                                    size: 13
                                },
                                color: '#4a5568',
                                padding: 15,
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleFont: {
                                size: 14,
                                weight: 'bold'
                            },
                            bodyFont: {
                                size: 13
                            },
                            padding: 12,
                            cornerRadius: 8,
                            displayColors: true,
                            callbacks: {
                                label: function(context) {
                                    const label = context.dataset.label || '';
                                    const value = context.parsed.y;
                                    if (label.includes('次数')) {
                                        return ` ${label}: ${value}单`;
                                    } else {
                                        return ` ${label}: ¥${value.toLocaleString()}`;
                                    }
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '合作次数（单）',
                                color: '#667eea',
                                font: {
                                    size: 13,
                                    weight: 'bold'
                                }
                            },
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)',
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12
                                },
                                color: '#718096',
                                stepSize: 1
                            }
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '收入金额（元）',
                                color: '#28a745',
                                font: {
                                    size: 13,
                                    weight: 'bold'
                                }
                            },
                            grid: {
                                drawOnChartArea: false,
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12
                                },
                                color: '#718096',
                                callback: function(value) {
                                    return '¥' + value.toLocaleString();
                                }
                            }
                        },
                        x: {
                            grid: {
                                display: false,
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 11,
                                    weight: 'bold'
                                },
                                color: '#718096',
                                maxRotation: 45,
                                minRotation: 45
                            }
                        }
                    },
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    }
                }
            });
        }
    }

    // 计算员工客户合作数据
    calculateEmployeeClientData(employeeName, dateRange) {
        // 筛选指定时间范围内的数据
        let filteredSchedules = this.schedules.filter(schedule => 
            schedule.employeeName === employeeName
        );
        
        if (typeof dateRange === 'object' && dateRange.custom) {
            // 自定义日期范围
            const startDate = new Date(dateRange.startDate);
            const endDate = new Date(dateRange.endDate);
            endDate.setHours(23, 59, 59, 999);
            
            filteredSchedules = filteredSchedules.filter(schedule => {
                const scheduleDate = new Date(schedule.scheduleDate);
                return scheduleDate >= startDate && scheduleDate <= endDate;
            });
        } else if (dateRange !== 'all') {
            // 最近N天
            const today = new Date();
            const startDate = new Date(today);
            startDate.setDate(today.getDate() - dateRange);
            
            filteredSchedules = filteredSchedules.filter(schedule => {
                const scheduleDate = new Date(schedule.scheduleDate);
                return scheduleDate >= startDate && scheduleDate <= today;
            });
        }

        // 按客户分组统计
        const clientStats = {};

        filteredSchedules.forEach(schedule => {
            const clientName = schedule.clientName;

            if (!clientStats[clientName]) {
                clientStats[clientName] = {
                    clientName: clientName,
                    orderCount: 0,
                    totalIncome: 0
                };
            }

            clientStats[clientName].orderCount += 1;
            clientStats[clientName].totalIncome += parseFloat(schedule.payment || 0);
        });

        // 转换为数组
        const clientData = Object.values(clientStats);

        // 按合作次数降序排序
        clientData.sort((a, b) => {
            if (b.orderCount !== a.orderCount) {
                return b.orderCount - a.orderCount;
            }
            // 如果合作次数相同，按收入金额排序
            return b.totalIncome - a.totalIncome;
        });

        return clientData;
    }

    // 更新员工客户合作统计卡片
    updateEmployeeClientStats(clientData) {
        if (clientData.length === 0) {
            document.getElementById('topEmployeeClient').textContent = '--';
            document.getElementById('totalEmployeeClients').textContent = '0';
            document.getElementById('totalEmployeeOrders').textContent = '0单';
            document.getElementById('totalEmployeeIncome').textContent = '¥0';
            return;
        }

        const topClient = clientData[0];
        const totalClients = clientData.length;
        const totalOrders = clientData.reduce((sum, client) => sum + client.orderCount, 0);
        const totalIncome = clientData.reduce((sum, client) => sum + client.totalIncome, 0);

        document.getElementById('topEmployeeClient').textContent = topClient.clientName + ` (${topClient.orderCount}单)`;
        document.getElementById('totalEmployeeClients').textContent = totalClients.toString();
        document.getElementById('totalEmployeeOrders').textContent = totalOrders + '单';
        document.getElementById('totalEmployeeIncome').textContent = '¥' + totalIncome.toLocaleString();
    }

    // 初始化客户活跃度分析图表
    initializeCustomerStatusCharts() {
        // 如果图表已存在，先销毁
        if (this.customerCountPieChart) {
            this.customerCountPieChart.destroy();
        }
        if (this.customerIncomePieChart) {
            this.customerIncomePieChart.destroy();
        }
        if (this.customerStatusBarChart) {
            this.customerStatusBarChart.destroy();
        }

        this.updateCustomerStatusCharts();
    }

    // 更新客户活跃度分析图表
    updateCustomerStatusCharts() {
        const dateRangeValue = document.getElementById('customerStatusDateRange').value;
        let dateRange;
        
        if (dateRangeValue === 'custom') {
            const startDate = document.getElementById('customerStatusStartDate').value;
            const endDate = document.getElementById('customerStatusEndDate').value;
            
            if (!startDate || !endDate) {
                return; // 如果日期未完整选择，不更新图表
            }
            
            dateRange = { custom: true, startDate, endDate };
        } else {
            dateRange = dateRangeValue === 'all' ? 'all' : parseInt(dateRangeValue);
        }
        
        const statusData = this.calculateCustomerStatusData(dateRange);

        // 更新统计卡片
        this.updateCustomerStatusStats(statusData);

        // 更新饼图
        this.updateCustomerCountPieChart(statusData);
        this.updateCustomerIncomePieChart(statusData);

        // 更新柱状图
        this.updateCustomerStatusBarChart(statusData);

        // 更新客户详细列表
        this.updateCustomerDetailLists(statusData);
    }

    // 计算客户活跃度数据
    calculateCustomerStatusData(dateRange) {
        // 筛选指定时间范围内的数据
        let filteredSchedules = this.schedules;
        
        if (typeof dateRange === 'object' && dateRange.custom) {
            // 自定义日期范围
            const startDate = new Date(dateRange.startDate);
            const endDate = new Date(dateRange.endDate);
            endDate.setHours(23, 59, 59, 999);
            
            filteredSchedules = this.schedules.filter(schedule => {
                const scheduleDate = new Date(schedule.scheduleDate);
                return scheduleDate >= startDate && scheduleDate <= endDate;
            });
        } else if (dateRange !== 'all') {
            // 最近N天
            const today = new Date();
            const startDate = new Date(today);
            startDate.setDate(today.getDate() - dateRange);
            
            filteredSchedules = this.schedules.filter(schedule => {
                const scheduleDate = new Date(schedule.scheduleDate);
                return scheduleDate >= startDate && scheduleDate <= today;
            });
        }

        // 按客户统计
        const clientStats = {};

        filteredSchedules.forEach(schedule => {
            const clientName = schedule.clientName;
            const scheduleDate = new Date(schedule.scheduleDate);

            if (!clientStats[clientName]) {
                clientStats[clientName] = {
                    clientName: clientName,
                    orderCount: 0,
                    totalIncome: 0,
                    lastOrderDate: scheduleDate
                };
            }

            clientStats[clientName].orderCount += 1;
            clientStats[clientName].totalIncome += parseFloat(schedule.payment || 0);
            
            // 记录最近的订单日期
            if (scheduleDate > clientStats[clientName].lastOrderDate) {
                clientStats[clientName].lastOrderDate = scheduleDate;
            }
        });

        // 分类客户
        const today = new Date();
        const tenDaysAgo = new Date(today);
        tenDaysAgo.setDate(today.getDate() - 10);

        const newCustomers = [];
        const returningCustomers = [];
        const activeOldCustomers = [];
        const inactiveOldCustomers = [];

        Object.values(clientStats).forEach(client => {
            if (client.orderCount <= 2) {
                // 新客户：合作次数 ≤ 2次
                newCustomers.push(client);
            } else if (client.orderCount === 3) {
                // 回头客：合作次数 = 3次
                returningCustomers.push(client);
            } else if (client.lastOrderDate >= tenDaysAgo) {
                // 活跃老客户：合作 > 3次，且最近10天有合作
                activeOldCustomers.push(client);
            } else {
                // 沉睡老客户：合作 > 3次，但最近10天无合作
                inactiveOldCustomers.push(client);
            }
        });

        return {
            newCustomers: newCustomers,
            returningCustomers: returningCustomers,
            activeOldCustomers: activeOldCustomers,
            inactiveOldCustomers: inactiveOldCustomers
        };
    }

    // 更新客户活跃度统计卡片
    updateCustomerStatusStats(statusData) {
        const newCount = statusData.newCustomers.length;
        const returningCount = statusData.returningCustomers.length;
        const activeCount = statusData.activeOldCustomers.length;
        const inactiveCount = statusData.inactiveOldCustomers.length;

        const newIncome = statusData.newCustomers.reduce((sum, client) => sum + client.totalIncome, 0);
        const returningIncome = statusData.returningCustomers.reduce((sum, client) => sum + client.totalIncome, 0);
        const activeIncome = statusData.activeOldCustomers.reduce((sum, client) => sum + client.totalIncome, 0);
        const inactiveIncome = statusData.inactiveOldCustomers.reduce((sum, client) => sum + client.totalIncome, 0);

        document.getElementById('newCustomerCount').textContent = newCount.toString();
        document.getElementById('returningCustomerCount').textContent = returningCount.toString();
        document.getElementById('activeCustomerCount').textContent = activeCount.toString();
        document.getElementById('inactiveCustomerCount').textContent = inactiveCount.toString();
        document.getElementById('newCustomerIncome').textContent = '¥' + newIncome.toLocaleString();
        document.getElementById('returningCustomerIncome').textContent = '¥' + returningIncome.toLocaleString();
        document.getElementById('activeCustomerIncome').textContent = '¥' + activeIncome.toLocaleString();
        document.getElementById('inactiveCustomerIncome').textContent = '¥' + inactiveIncome.toLocaleString();
    }

    // 更新客户数量饼图
    updateCustomerCountPieChart(statusData) {
        const newCount = statusData.newCustomers.length;
        const returningCount = statusData.returningCustomers.length;
        const activeCount = statusData.activeOldCustomers.length;
        const inactiveCount = statusData.inactiveOldCustomers.length;

        const ctx = document.getElementById('customerCountPieChart').getContext('2d');

        if (this.customerCountPieChart) {
            this.customerCountPieChart.data.datasets[0].data = [newCount, returningCount, activeCount, inactiveCount];
            this.customerCountPieChart.update();
        } else {
            this.customerCountPieChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['🆕 新客户', '🔄 回头客', '✅ 活跃老客户', '😴 沉睡老客户'],
                    datasets: [{
                        data: [newCount, returningCount, activeCount, inactiveCount],
                        backgroundColor: [
                            'rgba(102, 126, 234, 0.8)',
                            'rgba(23, 162, 184, 0.8)',
                            'rgba(40, 167, 69, 0.8)',
                            'rgba(255, 193, 7, 0.8)'
                        ],
                        borderColor: [
                            '#667eea',
                            '#17a2b8',
                            '#28a745',
                            '#ffc107'
                        ],
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                font: {
                                    size: 13
                                },
                                color: '#4a5568',
                                padding: 15,
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleFont: {
                                size: 14,
                                weight: 'bold'
                            },
                            bodyFont: {
                                size: 13
                            },
                            padding: 12,
                            cornerRadius: 8,
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                    return ` ${label}: ${value}个 (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // 更新客户收入饼图
    updateCustomerIncomePieChart(statusData) {
        const newIncome = statusData.newCustomers.reduce((sum, client) => sum + client.totalIncome, 0);
        const returningIncome = statusData.returningCustomers.reduce((sum, client) => sum + client.totalIncome, 0);
        const activeIncome = statusData.activeOldCustomers.reduce((sum, client) => sum + client.totalIncome, 0);
        const inactiveIncome = statusData.inactiveOldCustomers.reduce((sum, client) => sum + client.totalIncome, 0);

        const ctx = document.getElementById('customerIncomePieChart').getContext('2d');

        if (this.customerIncomePieChart) {
            this.customerIncomePieChart.data.datasets[0].data = [newIncome, returningIncome, activeIncome, inactiveIncome];
            this.customerIncomePieChart.update();
        } else {
            this.customerIncomePieChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['🆕 新客户', '🔄 回头客', '✅ 活跃老客户', '😴 沉睡老客户'],
                    datasets: [{
                        data: [newIncome, returningIncome, activeIncome, inactiveIncome],
                        backgroundColor: [
                            'rgba(102, 126, 234, 0.8)',
                            'rgba(23, 162, 184, 0.8)',
                            'rgba(40, 167, 69, 0.8)',
                            'rgba(255, 193, 7, 0.8)'
                        ],
                        borderColor: [
                            '#667eea',
                            '#17a2b8',
                            '#28a745',
                            '#ffc107'
                        ],
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                font: {
                                    size: 13
                                },
                                color: '#4a5568',
                                padding: 15,
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleFont: {
                                size: 14,
                                weight: 'bold'
                            },
                            bodyFont: {
                                size: 13
                            },
                            padding: 12,
                            cornerRadius: 8,
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                    return ` ${label}: ¥${value.toLocaleString()} (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // 更新客户活跃度对比柱状图
    updateCustomerStatusBarChart(statusData) {
        const newCount = statusData.newCustomers.length;
        const returningCount = statusData.returningCustomers.length;
        const activeCount = statusData.activeOldCustomers.length;
        const inactiveCount = statusData.inactiveOldCustomers.length;

        const newOrders = statusData.newCustomers.reduce((sum, client) => sum + client.orderCount, 0);
        const returningOrders = statusData.returningCustomers.reduce((sum, client) => sum + client.orderCount, 0);
        const activeOrders = statusData.activeOldCustomers.reduce((sum, client) => sum + client.orderCount, 0);
        const inactiveOrders = statusData.inactiveOldCustomers.reduce((sum, client) => sum + client.orderCount, 0);

        const newIncome = statusData.newCustomers.reduce((sum, client) => sum + client.totalIncome, 0);
        const returningIncome = statusData.returningCustomers.reduce((sum, client) => sum + client.totalIncome, 0);
        const activeIncome = statusData.activeOldCustomers.reduce((sum, client) => sum + client.totalIncome, 0);
        const inactiveIncome = statusData.inactiveOldCustomers.reduce((sum, client) => sum + client.totalIncome, 0);

        const ctx = document.getElementById('customerStatusBarChart').getContext('2d');

        if (this.customerStatusBarChart) {
            this.customerStatusBarChart.data.datasets[0].data = [newCount, returningCount, activeCount, inactiveCount];
            this.customerStatusBarChart.data.datasets[1].data = [newOrders, returningOrders, activeOrders, inactiveOrders];
            this.customerStatusBarChart.data.datasets[2].data = [newIncome, returningIncome, activeIncome, inactiveIncome];
            this.customerStatusBarChart.update();
        } else {
            this.customerStatusBarChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['🆕 新客户', '🔄 回头客', '✅ 活跃老客户', '😴 沉睡老客户'],
                    datasets: [{
                        label: '客户数量',
                        data: [newCount, returningCount, activeCount, inactiveCount],
                        backgroundColor: 'rgba(102, 126, 234, 0.8)',
                        borderColor: '#667eea',
                        borderWidth: 2,
                        borderRadius: 6
                    }, {
                        label: '订单数量',
                        data: [newOrders, returningOrders, activeOrders, inactiveOrders],
                        backgroundColor: 'rgba(255, 193, 7, 0.8)',
                        borderColor: '#ffc107',
                        borderWidth: 2,
                        borderRadius: 6
                    }, {
                        label: '收入金额',
                        data: [newIncome, returningIncome, activeIncome, inactiveIncome],
                        backgroundColor: 'rgba(40, 167, 69, 0.8)',
                        borderColor: '#28a745',
                        borderWidth: 2,
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: '客户分类数据对比',
                            font: {
                                size: 16,
                                weight: 'bold'
                            },
                            color: '#2d3748',
                            padding: {
                                top: 10,
                                bottom: 20
                            }
                        },
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                font: {
                                    size: 13
                                },
                                color: '#4a5568',
                                padding: 15,
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleFont: {
                                size: 14,
                                weight: 'bold'
                            },
                            bodyFont: {
                                size: 13
                            },
                            padding: 12,
                            cornerRadius: 8,
                            callbacks: {
                                label: function(context) {
                                    const label = context.dataset.label || '';
                                    const value = context.parsed.y;
                                    if (label.includes('客户数量')) {
                                        return ` ${label}: ${value}个`;
                                    } else if (label.includes('订单数量')) {
                                        return ` ${label}: ${value}单`;
                                    } else {
                                        return ` ${label}: ¥${value.toLocaleString()}`;
                                    }
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)',
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12
                                },
                                color: '#718096'
                            }
                        },
                        x: {
                            grid: {
                                display: false,
                                drawBorder: false
                            },
                            ticks: {
                                font: {
                                    size: 12,
                                    weight: 'bold'
                                },
                                color: '#718096'
                            }
                        }
                    },
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    }
                }
            });
        }
    }

    // 切换客户列表展开/折叠
    toggleCustomerList(type) {
        const listContent = document.getElementById(`${type}CustomerList`);
        const toggleIcon = document.getElementById(`${type}CustomerToggle`);
        
        if (listContent.style.display === 'none' || listContent.style.display === '') {
            listContent.style.display = 'block';
            listContent.classList.add('expanded');
            toggleIcon.classList.add('expanded');
        } else {
            listContent.style.display = 'none';
            listContent.classList.remove('expanded');
            toggleIcon.classList.remove('expanded');
        }
    }

    // 更新客户详细列表
    updateCustomerDetailLists(statusData) {
        // 更新列表计数
        document.getElementById('newCustomerListCount').textContent = statusData.newCustomers.length;
        document.getElementById('returningCustomerListCount').textContent = statusData.returningCustomers.length;
        document.getElementById('activeCustomerListCount').textContent = statusData.activeOldCustomers.length;
        document.getElementById('inactiveCustomerListCount').textContent = statusData.inactiveOldCustomers.length;

        // 更新新客户列表
        this.renderCustomerList('newCustomerTableBody', statusData.newCustomers, 'new');
        
        // 更新回头客列表
        this.renderCustomerList('returningCustomerTableBody', statusData.returningCustomers, 'returning');
        
        // 更新活跃老客户列表
        this.renderCustomerList('activeCustomerTableBody', statusData.activeOldCustomers, 'active');
        
        // 更新沉睡老客户列表
        this.renderCustomerList('inactiveCustomerTableBody', statusData.inactiveOldCustomers, 'inactive');
    }

    // 渲染客户列表
    renderCustomerList(tableBodyId, customers, type) {
        const tbody = document.getElementById(tableBodyId);
        tbody.innerHTML = '';

        if (customers.length === 0) {
            const colspan = type === 'inactive' ? 5 : 4;
            tbody.innerHTML = `<tr><td colspan="${colspan}" class="no-data">暂无数据</td></tr>`;
            return;
        }

        // 按合作次数降序排序
        customers.sort((a, b) => {
            if (b.orderCount !== a.orderCount) {
                return b.orderCount - a.orderCount;
            }
            return b.totalIncome - a.totalIncome;
        });

        customers.forEach((customer, index) => {
            const row = document.createElement('tr');
            
            // 客户名称
            const nameCell = document.createElement('td');
            nameCell.innerHTML = `<span class="customer-name-highlight">${customer.clientName}</span>`;
            row.appendChild(nameCell);

            // 合作次数
            const orderCell = document.createElement('td');
            orderCell.innerHTML = `<span class="order-count-badge">${customer.orderCount}次</span>`;
            row.appendChild(orderCell);

            // 最后合作日期
            const dateCell = document.createElement('td');
            const lastDate = new Date(customer.lastOrderDate);
            const formattedDate = lastDate.toLocaleDateString('zh-CN', { 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit' 
            });
            dateCell.textContent = formattedDate;
            row.appendChild(dateCell);

            // 如果是沉睡客户，添加沉睡天数列
            if (type === 'inactive') {
                const sleepDaysCell = document.createElement('td');
                const today = new Date();
                const sleepDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
                
                let className = '';
                if (sleepDays > 30) {
                    className = 'sleep-days-warning';
                } else if (sleepDays > 15) {
                    className = 'sleep-days-alert';
                }
                
                sleepDaysCell.innerHTML = `<span class="${className}">${sleepDays}天</span>`;
                row.appendChild(sleepDaysCell);
            }

            // 总收入
            const incomeCell = document.createElement('td');
            incomeCell.innerHTML = `<span class="income-highlight">¥${customer.totalIncome.toLocaleString()}</span>`;
            row.appendChild(incomeCell);

            tbody.appendChild(row);
        });
    }

    // ==================== 员工排行榜功能 ====================
    
    // 更新员工排行榜
    updateEmployeeRanking() {
        const dateRangeValue = document.getElementById('employeeRankingDateRange').value;
        const sortBy = document.getElementById('employeeRankingSortBy').value;
        
        // 获取筛选后的数据
        let dateRange;
        
        if (dateRangeValue === 'custom') {
            const startDate = document.getElementById('employeeRankingStartDate').value;
            const endDate = document.getElementById('employeeRankingEndDate').value;
            
            if (!startDate || !endDate) {
                return; // 如果日期未完整选择，不更新图表
            }
            
            dateRange = { custom: true, startDate, endDate };
        } else {
            dateRange = dateRangeValue === 'all' ? 'all' : parseInt(dateRangeValue);
        }
        
        const rankingData = this.calculateEmployeeRankingData(dateRange, sortBy);
        
        // 更新统计卡片
        this.updateEmployeeRankingStats(rankingData);
        
        // 更新排行榜表格
        this.renderEmployeeRankingTable(rankingData, sortBy);
    }
    
    // 计算员工排行榜数据
    calculateEmployeeRankingData(dateRange, sortBy) {
        // 筛选数据
        let filteredSchedules = this.schedules;
        let filteredAttendanceFees = this.attendanceFees;
        let filteredReportRebates = this.reportRebates;
        
        if (typeof dateRange === 'object' && dateRange.custom) {
            // 自定义日期范围
            const startDate = new Date(dateRange.startDate);
            const endDate = new Date(dateRange.endDate);
            endDate.setHours(23, 59, 59, 999);
            
            filteredSchedules = this.schedules.filter(schedule => {
                const scheduleDate = new Date(schedule.scheduleDate);
                return scheduleDate >= startDate && scheduleDate <= endDate;
            });
            
            filteredAttendanceFees = this.attendanceFees.filter(fee => {
                const feeDate = new Date(fee.date);
                return feeDate >= startDate && feeDate <= endDate;
            });
            
            filteredReportRebates = this.reportRebates.filter(rebate => {
                const rebateDate = new Date(rebate.date);
                return rebateDate >= startDate && rebateDate <= endDate;
            });
        } else if (dateRange !== 'all') {
            // 最近N天
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - dateRange);
            
            filteredSchedules = this.schedules.filter(schedule => {
                const scheduleDate = new Date(schedule.scheduleDate);
                return scheduleDate >= cutoffDate;
            });
            
            filteredAttendanceFees = this.attendanceFees.filter(fee => {
                const feeDate = new Date(fee.date);
                return feeDate >= cutoffDate;
            });
            
            filteredReportRebates = this.reportRebates.filter(rebate => {
                const rebateDate = new Date(rebate.date);
                return rebateDate >= cutoffDate;
            });
        }
        
        // 按员工分组计算数据
        const employeeMap = {};
        
        // 计算坐班费用
        const attendanceFeeMap = {};
        filteredAttendanceFees.forEach(fee => {
            if (!attendanceFeeMap[fee.employeeName]) {
                attendanceFeeMap[fee.employeeName] = 0;
            }
            attendanceFeeMap[fee.employeeName] += fee.fee;
        });
        
        // 计算报告费用
        const reportRebateMap = {};
        filteredReportRebates.forEach(rebate => {
            if (!reportRebateMap[rebate.employeeName]) {
                reportRebateMap[rebate.employeeName] = 0;
            }
            reportRebateMap[rebate.employeeName] += rebate.amount;
        });
        
        // 计算每个员工的数据
        filteredSchedules.forEach(schedule => {
            const employeeName = schedule.employeeName;
            
            if (!employeeMap[employeeName]) {
                employeeMap[employeeName] = {
                    name: employeeName,
                    orderCount: 0,
                    totalRevenue: 0,
                    totalCommission: 0,
                    attendanceFee: 0,
                    reportRebate: 0,
                    profit: 0,
                    commissionRate: 0
                };
            }
            
            employeeMap[employeeName].orderCount += 1;
            employeeMap[employeeName].totalRevenue += schedule.payment || 0;
            employeeMap[employeeName].totalCommission += schedule.commission || 0;
        });
        
        // 设置坐班费用和报告费用，计算利润和提成比例
        Object.keys(employeeMap).forEach(employeeName => {
            const employee = employeeMap[employeeName];
            employee.attendanceFee = attendanceFeeMap[employeeName] || 0;
            employee.reportRebate = reportRebateMap[employeeName] || 0;
            
            // 计算利润 = 总收入 - 提成 - 坐班费 - 报告费
            employee.profit = employee.totalRevenue - employee.totalCommission - employee.attendanceFee - employee.reportRebate;
            
            // 计算提成比例 = 提成 / 总收入 * 100
            employee.commissionRate = employee.totalRevenue > 0 
                ? (employee.totalCommission / employee.totalRevenue * 100) 
                : 0;
        });
        
        // 排序
        const employeeArray = Object.values(employeeMap);
        
        switch (sortBy) {
            case 'profit':
                employeeArray.sort((a, b) => b.profit - a.profit);
                break;
            case 'orders':
                employeeArray.sort((a, b) => b.orderCount - a.orderCount);
                break;
            case 'commission':
                employeeArray.sort((a, b) => b.totalCommission - a.totalCommission);
                break;
            case 'commissionRate':
                employeeArray.sort((a, b) => b.commissionRate - a.commissionRate);
                break;
            default:
                employeeArray.sort((a, b) => b.profit - a.profit);
        }
        
        return employeeArray;
    }
    
    // 更新员工排行榜统计卡片
    updateEmployeeRankingStats(rankingData) {
        if (rankingData.length === 0) {
            document.getElementById('topProfitEmployee').textContent = '--';
            document.getElementById('topOrdersEmployee').textContent = '--';
            document.getElementById('topCommissionRateEmployee').textContent = '--';
            document.getElementById('totalCompanyProfit').textContent = '¥0';
            return;
        }
        
        // 按利润排序找榜首
        const profitSorted = [...rankingData].sort((a, b) => b.profit - a.profit);
        const topProfitEmployee = profitSorted[0];
        document.getElementById('topProfitEmployee').textContent = 
            `${topProfitEmployee.name} (¥${topProfitEmployee.profit.toLocaleString()})`;
        
        // 按订单数排序找榜首
        const ordersSorted = [...rankingData].sort((a, b) => b.orderCount - a.orderCount);
        const topOrdersEmployee = ordersSorted[0];
        document.getElementById('topOrdersEmployee').textContent = 
            `${topOrdersEmployee.name} (${topOrdersEmployee.orderCount}单)`;
        
        // 按提成比例排序找榜首
        const rateSorted = [...rankingData].sort((a, b) => b.commissionRate - a.commissionRate);
        const topRateEmployee = rateSorted[0];
        document.getElementById('topCommissionRateEmployee').textContent = 
            `${topRateEmployee.name} (${topRateEmployee.commissionRate.toFixed(1)}%)`;
        
        // 计算总利润
        const totalProfit = rankingData.reduce((sum, emp) => sum + emp.profit, 0);
        document.getElementById('totalCompanyProfit').textContent = 
            `¥${totalProfit.toLocaleString()}`;
    }
    
    // 渲染员工排行榜表格
    renderEmployeeRankingTable(rankingData, sortBy) {
        const tbody = document.getElementById('employeeRankingTableBody');
        
        if (!tbody) {
            return;
        }
        
        if (rankingData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="no-data">暂无数据</td></tr>';
            return;
        }
        
        tbody.innerHTML = '';
        
        rankingData.forEach((employee, index) => {
            const row = document.createElement('tr');
            
            // 排名
            const rankCell = document.createElement('td');
            const rank = index + 1;
            let rankClass = 'rank-other';
            if (rank === 1) rankClass = 'rank-1';
            else if (rank === 2) rankClass = 'rank-2';
            else if (rank === 3) rankClass = 'rank-3';
            
            rankCell.innerHTML = `<span class="rank-badge ${rankClass}">${rank}</span>`;
            row.appendChild(rankCell);
            
            // 员工姓名
            const nameCell = document.createElement('td');
            nameCell.className = 'employee-name-cell';
            nameCell.textContent = employee.name;
            row.appendChild(nameCell);
            
            // 订单数量
            const ordersCell = document.createElement('td');
            ordersCell.className = 'orders-count-cell';
            ordersCell.textContent = `${employee.orderCount}单`;
            row.appendChild(ordersCell);
            
            // 总收入
            const revenueCell = document.createElement('td');
            revenueCell.textContent = `¥${employee.totalRevenue.toLocaleString()}`;
            row.appendChild(revenueCell);
            
            // 员工提成
            const commissionCell = document.createElement('td');
            commissionCell.textContent = `¥${employee.totalCommission.toLocaleString()}`;
            row.appendChild(commissionCell);
            
            // 提成比例
            const rateCell = document.createElement('td');
            rateCell.className = 'commission-rate-cell';
            rateCell.textContent = `${employee.commissionRate.toFixed(1)}%`;
            row.appendChild(rateCell);
            
            // 坐班费
            const attendanceCell = document.createElement('td');
            attendanceCell.textContent = `¥${employee.attendanceFee.toLocaleString()}`;
            row.appendChild(attendanceCell);
            
            // 报告费
            const rebateCell = document.createElement('td');
            rebateCell.textContent = `¥${employee.reportRebate.toLocaleString()}`;
            row.appendChild(rebateCell);
            
            // 为公司赚利润
            const profitCell = document.createElement('td');
            profitCell.className = 'highlight-column';
            let profitClass = 'profit-positive';
            if (employee.profit < 0) profitClass = 'profit-negative';
            else if (employee.profit === 0) profitClass = 'profit-zero';
            
            profitCell.innerHTML = `<span class="profit-value ${profitClass}">¥${employee.profit.toLocaleString()}</span>`;
            row.appendChild(profitCell);
            
            tbody.appendChild(row);
        });
    }

    // ========================================
    // 员工薪资管理功能
    // ========================================

    // 初始化薪资管理
    initializeSalaryManagement() {
        this.updateSalaryProjectSelector();
        this.renderSalaryTiers();
        
        // 项目选择事件
        document.getElementById('salaryProjectSelect').addEventListener('change', (e) => {
            this.currentSalaryProject = e.target.value;
            this.currentSalaryTier = null;
            this.renderSalaryTiers();
            this.renderSalaryEmployeeAssignment();
            document.getElementById('addSalaryTierBtn').disabled = !this.currentSalaryProject;
        });
        
        // 添加档位按钮
        document.getElementById('addSalaryTierBtn').addEventListener('click', () => {
            this.checkSalaryAuthAndExecute(() => this.openAddSalaryTierModal());
        });
        
        // 薪资档位表单提交
        document.getElementById('salaryTierForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveSalaryTier();
        });
        
        // 权限验证表单提交
        document.getElementById('salaryAuthForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.verifySalaryPassword();
        });
    }

    // 加载薪资档位数据（同步版本，初始化用）
    loadSalaryTiers() {
        if (this.salaryTiers && Object.keys(this.salaryTiers).length > 0) {
            return this.salaryTiers;
        }
        const data = localStorage.getItem(this.getStorageKey('salaryTiers'));
        return data ? JSON.parse(data) : {};
    }

    // 异步加载薪资档位数据（优先从IndexedDB + Firebase）
    // 异步加载薪资档位数据（由 onSnapshot 自动处理）
    async loadSalaryTiersAsync() { }

    // 保存薪资档位数据到 Firestore
    async saveSalaryTiersData() {
        await this.dbManager.saveSalaryTiers(this.salaryTiers, this.currentStoreId);
        try { localStorage.setItem(this.getStorageKey('salaryTiers'), JSON.stringify(this.salaryTiers)); } catch (e) {}
    }

    // 加载薪资密码
    loadSalaryPassword() {
        return localStorage.getItem(this.getStorageKey('salaryPassword')) || 'admin123';
    }

    // 保存薪资密码
    saveSalaryPassword(password) {
        this.salaryPassword = password;
        localStorage.setItem(this.getStorageKey('salaryPassword'), password);
    }

    // 更新项目选择器
    updateSalaryProjectSelector() {
        const select = document.getElementById('salaryProjectSelect');
        select.innerHTML = '<option value="">请选择项目</option>';
        
        this.projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = project.name;
            select.appendChild(option);
        });
    }

    // 检查权限并执行操作
    checkSalaryAuthAndExecute(callback) {
        if (this.isAuthenticated) {
            callback();
        } else {
            this.pendingSalaryAction = callback;
            this.openSalaryAuthModal();
        }
    }

    // 打开权限验证模态框
    openSalaryAuthModal() {
        document.getElementById('salaryAuthModal').style.display = 'block';
        document.getElementById('salaryAuthPassword').value = '';
        document.getElementById('salaryAuthPassword').focus();
    }

    // 关闭权限验证模态框
    closeSalaryAuthModal() {
        document.getElementById('salaryAuthModal').style.display = 'none';
        this.pendingSalaryAction = null;
    }

    // 验证密码
    verifySalaryPassword() {
        const password = document.getElementById('salaryAuthPassword').value;
        
        if (password === this.salaryPassword) {
            this.isAuthenticated = true;
            this.closeSalaryAuthModal();
            
            // 执行待处理的操作
            if (this.pendingSalaryAction) {
                this.pendingSalaryAction();
                this.pendingSalaryAction = null;
            }
            
            // 30分钟后自动登出
            setTimeout(() => {
                this.isAuthenticated = false;
            }, 30 * 60 * 1000);
            
            alert('验证成功！权限将在30分钟后过期。');
        } else {
            alert('密码错误，请重试！');
        }
    }

    // 打开添加档位模态框
    openAddSalaryTierModal() {
        if (!this.currentSalaryProject) {
            alert('请先选择一个项目！');
            return;
        }
        
        this.editingSalaryTierId = null;
        document.getElementById('salaryTierModalTitle').textContent = '添加薪资档位';
        document.getElementById('salaryTierName').value = '';
        document.getElementById('salaryTierAmount').value = '';
        document.getElementById('salaryTierDescription').value = '';
        document.getElementById('salaryTierModal').style.display = 'block';
    }

    // 打开编辑档位模态框
    openEditSalaryTierModal(tierId) {
        const tier = this.getSalaryTierById(tierId);
        if (!tier) return;
        
        this.editingSalaryTierId = tierId;
        document.getElementById('salaryTierModalTitle').textContent = '编辑薪资档位';
        document.getElementById('salaryTierName').value = tier.name;
        document.getElementById('salaryTierAmount').value = tier.amount;
        document.getElementById('salaryTierDescription').value = tier.description || '';
        document.getElementById('salaryTierModal').style.display = 'block';
    }

    // 关闭薪资档位模态框
    closeSalaryTierModal() {
        document.getElementById('salaryTierModal').style.display = 'none';
        this.editingSalaryTierId = null;
    }

    // 保存薪资档位
    saveSalaryTier() {
        const name = document.getElementById('salaryTierName').value.trim();
        const amount = parseFloat(document.getElementById('salaryTierAmount').value);
        const description = document.getElementById('salaryTierDescription').value.trim();
        
        if (!name || isNaN(amount)) {
            alert('请填写完整的档位信息！');
            return;
        }
        
        if (!this.salaryTiers[this.currentSalaryProject]) {
            this.salaryTiers[this.currentSalaryProject] = [];
        }
        
        if (this.editingSalaryTierId) {
            // 编辑现有档位
            const tier = this.getSalaryTierById(this.editingSalaryTierId);
            if (tier) {
                tier.name = name;
                tier.amount = amount;
                tier.description = description;
            }
        } else {
            // 添加新档位
            const newTier = {
                id: Date.now().toString(),
                projectId: this.currentSalaryProject,
                name: name,
                amount: amount,
                description: description,
                employees: []
            };
            this.salaryTiers[this.currentSalaryProject].push(newTier);
        }
        
        this.saveSalaryTiersData();
        this.closeSalaryTierModal();
        this.renderSalaryTiers();
        
        alert(this.editingSalaryTierId ? '档位更新成功！' : '档位添加成功！');
    }

    // 删除薪资档位
    deleteSalaryTier(tierId) {
        if (!confirm('确定要删除这个薪资档位吗？档位下的员工分配也将被删除。')) {
            return;
        }
        
        const projectTiers = this.salaryTiers[this.currentSalaryProject];
        if (projectTiers) {
            const index = projectTiers.findIndex(t => t.id === tierId);
            if (index !== -1) {
                projectTiers.splice(index, 1);
                this.saveSalaryTiersData();
                
                if (this.currentSalaryTier === tierId) {
                    this.currentSalaryTier = null;
                    this.renderSalaryEmployeeAssignment();
                }
                
                this.renderSalaryTiers();
                alert('档位删除成功！');
            }
        }
    }

    // 根据ID获取档位
    getSalaryTierById(tierId) {
        const projectTiers = this.salaryTiers[this.currentSalaryProject];
        if (projectTiers) {
            return projectTiers.find(t => t.id === tierId);
        }
        return null;
    }

    // 渲染薪资档位列表
    renderSalaryTiers() {
        const container = document.getElementById('salaryTiersContainer');
        
        if (!this.currentSalaryProject) {
            container.innerHTML = '<div class="empty-state"><p>👆 请先选择一个项目</p></div>';
            return;
        }
        
        const projectTiers = this.salaryTiers[this.currentSalaryProject] || [];
        
        if (projectTiers.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>暂无薪资档位<br>点击上方按钮添加第一个档位</p></div>';
            return;
        }
        
        container.innerHTML = '';
        
        projectTiers.forEach((tier, index) => {
            const card = document.createElement('div');
            card.className = `salary-tier-card ${this.currentSalaryTier === tier.id ? 'active' : ''}`;
            card.onclick = () => this.selectSalaryTier(tier.id);
            
            const badge = this.getTierBadgeColor(index);
            
            card.innerHTML = `
                <div class="salary-tier-header">
                    <div class="salary-tier-name">
                        <span class="salary-tier-badge" style="background: ${badge}">${tier.name}</span>
                    </div>
                    <div class="salary-tier-actions" onclick="event.stopPropagation()">
                        <button onclick="scheduleManager.checkSalaryAuthAndExecute(() => scheduleManager.openEditSalaryTierModal('${tier.id}'))">✏️ 编辑</button>
                        <button onclick="scheduleManager.checkSalaryAuthAndExecute(() => scheduleManager.deleteSalaryTier('${tier.id}'))">🗑️ 删除</button>
                    </div>
                </div>
                <div class="salary-tier-amount">¥${tier.amount.toLocaleString()}</div>
                ${tier.description ? `<div class="salary-tier-description">${tier.description}</div>` : ''}
                <div class="salary-tier-employee-count">👥 已分配 ${tier.employees.length} 名员工</div>
            `;
            
            container.appendChild(card);
        });
    }

    // 获取档位徽章颜色
    getTierBadgeColor(index) {
        const colors = ['#FFD700', '#C0C0C0', '#CD7F32', '#667eea', '#764ba2'];
        return colors[index % colors.length];
    }

    // 选择档位
    selectSalaryTier(tierId) {
        this.currentSalaryTier = tierId;
        this.renderSalaryTiers();
        this.renderSalaryEmployeeAssignment();
    }

    // 渲染员工分配区域
    renderSalaryEmployeeAssignment() {
        const container = document.getElementById('salaryEmployeeAssignment');
        
        if (!this.currentSalaryTier) {
            container.innerHTML = '<div class="empty-state"><p>👈 请先选择一个薪资档位</p></div>';
            return;
        }
        
        const tier = this.getSalaryTierById(this.currentSalaryTier);
        if (!tier) {
            container.innerHTML = '<div class="empty-state"><p>❌ 档位数据错误</p></div>';
            return;
        }
        
        const project = this.projects.find(p => p.id === this.currentSalaryProject);
        
        container.innerHTML = `
            <div class="salary-assignment-header">
                <div class="salary-assignment-title">${tier.name}</div>
                <div class="salary-assignment-info">
                    <span>项目：${project ? project.name : '未知'}</span>
                    <span>薪资：¥${tier.amount.toLocaleString()}</span>
                </div>
            </div>
            
            <div class="salary-employee-list" id="salaryEmployeeList"></div>
            
            <button class="salary-add-employee-btn" onclick="scheduleManager.checkSalaryAuthAndExecute(() => scheduleManager.showAddEmployeeSection())">
                ➕ 添加员工到此档位
            </button>
            
            <div id="addEmployeeSection" style="display: none;"></div>
        `;
        
        this.renderAssignedEmployees(tier);
    }

    // 渲染已分配的员工
    renderAssignedEmployees(tier) {
        const list = document.getElementById('salaryEmployeeList');
        
        if (tier.employees.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>暂无员工<br>点击下方按钮添加员工</p></div>';
            return;
        }
        
        list.innerHTML = '';
        
        tier.employees.forEach(employeeId => {
            const employee = this.employees.find(e => e.id === employeeId);
            if (!employee) return;
            
            const item = document.createElement('div');
            item.className = 'salary-employee-item';
            
            item.innerHTML = `
                <div class="salary-employee-info">
                    ${employee.photo ? 
                        `<img src="${employee.photo}" alt="${employee.name}" class="salary-employee-avatar">` :
                        `<div class="salary-employee-avatar-placeholder">${employee.name.charAt(0)}</div>`
                    }
                    <div class="salary-employee-details">
                        <div class="salary-employee-name">${employee.name}</div>
                        <div class="salary-employee-meta">
                            ${employee.phone || '未设置电话'} • 
                            ${employee.hireDate ? '入职：' + employee.hireDate : '未设置入职日期'}
                        </div>
                    </div>
                </div>
                <button class="salary-employee-remove" onclick="scheduleManager.checkSalaryAuthAndExecute(() => scheduleManager.removeEmployeeFromTier('${employee.id}'))">
                    移除
                </button>
            `;
            
            list.appendChild(item);
        });
    }

    // 显示添加员工区域
    showAddEmployeeSection() {
        const section = document.getElementById('addEmployeeSection');
        section.style.display = 'block';
        
        const tier = this.getSalaryTierById(this.currentSalaryTier);
        const availableEmployees = this.getAvailableEmployees(tier);
        
        section.innerHTML = `
            <div class="salary-add-employee-section">
                <h3>选择要添加的员工</h3>
                <div class="salary-available-employees" id="availableEmployeesList">
                    ${availableEmployees.length === 0 ? 
                        '<div class="empty-state"><p>所有员工都已分配到档位</p></div>' :
                        ''
                    }
                </div>
                <button class="btn btn-secondary" style="margin-top: 10px; width: 100%;" onclick="scheduleManager.hideAddEmployeeSection()">
                    取消
                </button>
            </div>
        `;
        
        const employeesList = document.getElementById('availableEmployeesList');
        
        availableEmployees.forEach(employee => {
            const item = document.createElement('div');
            item.className = 'salary-available-employee-item';
            item.onclick = () => this.addEmployeeToTier(employee.id);
            
            item.innerHTML = `
                ${employee.photo ? 
                    `<img src="${employee.photo}" alt="${employee.name}" class="salary-employee-avatar">` :
                    `<div class="salary-employee-avatar-placeholder">${employee.name.charAt(0)}</div>`
                }
                <div class="salary-employee-name">${employee.name}</div>
            `;
            
            employeesList.appendChild(item);
        });
    }

    // 隐藏添加员工区域
    hideAddEmployeeSection() {
        document.getElementById('addEmployeeSection').style.display = 'none';
    }

    // 获取可用的员工（未在当前项目的任何档位中的员工）
    getAvailableEmployees(currentTier) {
        const projectTiers = this.salaryTiers[this.currentSalaryProject] || [];
        const assignedEmployeeIds = new Set();
        
        // 收集当前项目所有档位中已分配的员工
        projectTiers.forEach(tier => {
            tier.employees.forEach(empId => assignedEmployeeIds.add(empId));
        });
        
        // 返回未分配的员工
        return this.employees.filter(emp => !assignedEmployeeIds.has(emp.id));
    }

    // 添加员工到档位
    addEmployeeToTier(employeeId) {
        const tier = this.getSalaryTierById(this.currentSalaryTier);
        if (!tier) return;
        
        if (tier.employees.includes(employeeId)) {
            alert('该员工已在此档位中！');
            return;
        }
        
        tier.employees.push(employeeId);
        this.saveSalaryTiersData();
        this.hideAddEmployeeSection();
        this.renderSalaryEmployeeAssignment();
        this.renderSalaryTiers(); // 更新档位卡片的员工数量
        
        const employee = this.employees.find(e => e.id === employeeId);
        alert(`已将 ${employee.name} 添加到此档位！`);
    }

    // 从档位移除员工
    removeEmployeeFromTier(employeeId) {
        const tier = this.getSalaryTierById(this.currentSalaryTier);
        if (!tier) return;
        
        const employee = this.employees.find(e => e.id === employeeId);
        if (!confirm(`确定要将 ${employee.name} 从此档位移除吗？`)) {
            return;
        }
        
        const index = tier.employees.indexOf(employeeId);
        if (index !== -1) {
            tier.employees.splice(index, 1);
            this.saveSalaryTiersData();
            this.renderSalaryEmployeeAssignment();
            this.renderSalaryTiers(); // 更新档位卡片的员工数量
            alert('员工已移除！');
        }
    }

    // ==================== 接龙数据转换工具 ====================

    // --- 价格表：本地缓存 + Firebase 团队通用同步 ---
    get _jlPriceKey() { return 'jl_price_table'; }

    _jlNormalizePriceRows(rows) {
        if (!Array.isArray(rows)) return [];
        return rows
            .map(row => ({
                name: String(row.name || '').trim(),
                grade: String(row.grade || '').trim().toUpperCase(),
                price: parseFloat(row.price),
            }))
            .filter(row => row.name && row.grade && !isNaN(row.price));
    }

    jlLoadPriceTable() {
        if (Array.isArray(this.jlPriceTable)) {
            return this.jlPriceTable;
        }

        try {
            const raw = localStorage.getItem(this._jlPriceKey);
            return this._jlNormalizePriceRows(raw ? JSON.parse(raw) : []);
        } catch (e) { return []; }
    }

    _jlCachePriceTable(rows) {
        try {
            localStorage.setItem(this._jlPriceKey, JSON.stringify(rows));
        } catch (error) {
            console.warn('接龙价格表本地缓存失败:', error);
        }
    }

    _jlApplyPriceTableRows(rows) {
        const cleanRows = this._jlNormalizePriceRows(rows);
        this.jlPriceTable = cleanRows;
        this._jlCachePriceTable(cleanRows);
        this.jlRefreshPriceStatus();

        const modal = document.getElementById('jlPriceModal');
        if (modal && modal.style.display !== 'none') {
            this.jlRenderPriceTable();
        }
    }

    jlSavePriceTable(rows, options = {}) {
        const cleanRows = this._jlNormalizePriceRows(rows);
        this.jlPriceTable = cleanRows;
        this._jlCachePriceTable(cleanRows);

        if (options.sync !== false && this.dbManager && this.dbManager.saveJlPriceTable) {
            this.dbManager.saveJlPriceTable(cleanRows).catch(error => {
                console.error('同步接龙价格表到 Firebase 失败:', error);
            });
        }
    }

    jlInitPriceTableSync() {
        if (!this.dbManager || !this.dbManager.subscribeToJlPriceTable) return;

        const localRows = this.jlLoadPriceTable();
        let firstSnapshot = true;

        this.dbManager.subscribeToJlPriceTable((rows) => {
            if (firstSnapshot) {
                firstSnapshot = false;

                if (rows.length === 0 && localRows.length > 0) {
                    this.dbManager.saveJlPriceTable(localRows).catch(error => {
                        console.error('迁移接龙价格表到 Firebase 失败:', error);
                    });
                    return;
                }
            }

            this._jlApplyPriceTableRows(rows);
        });
    }

    // --- 状态栏刷新 ---
    jlRefreshPriceStatus() {
        const rows = this.jlLoadPriceTable();
        const statusEl = document.getElementById('jlPriceStatus');
        const empEl = document.getElementById('jlEmployeeCount');
        const gradeEl = document.getElementById('jlGradeCount');
        if (!statusEl) return;
        if (rows.length === 0) {
            statusEl.textContent = '未加载价格表';
            statusEl.className = 'jl-price-status';
            if (empEl) empEl.textContent = '员工: 0';
            if (gradeEl) gradeEl.textContent = '等级: 0';
        } else {
            const names = new Set(rows.map(r => r.name));
            const grades = new Set(rows.map(r => r.grade.toUpperCase()));
            statusEl.textContent = `✅ 已加载 ${names.size} 位员工`;
            statusEl.className = 'jl-price-status loaded';
            if (empEl) empEl.textContent = `员工: ${names.size}`;
            if (gradeEl) gradeEl.textContent = `等级: ${grades.size}`;
        }
    }

    // --- 初始化事件绑定 ---
    jlInit() {
        document.getElementById('jlImportCsv')?.addEventListener('click', () => this.jlImportCsv());
        document.getElementById('jlManagePrice')?.addEventListener('click', () => this.jlOpenPriceModal());
        document.getElementById('jlExportCsv')?.addEventListener('click', () => this.jlExportCsv());
        document.getElementById('jlConvertBtn')?.addEventListener('click', () => this.jlConvert());
        document.getElementById('jlCopyResult')?.addEventListener('click', () => this.jlCopyResult());
        document.getElementById('jlCopyDetailAll')?.addEventListener('click', () => this.jlCopyResult());
        document.getElementById('jlClearInput')?.addEventListener('click', () => {
            const el = document.getElementById('jlRawInput'); if (el) el.value = '';
        });
        document.getElementById('jlClearOutput')?.addEventListener('click', () => {
            const el = document.getElementById('jlConvertedOutput'); if (el) el.value = '';
            const s = document.getElementById('jlStats'); if (s) s.style.display = 'none';
            const d = document.getElementById('jlDetailSection'); if (d) d.style.display = 'none';
            const st = document.getElementById('jlConvertStatus'); if (st) st.textContent = '';
        });
        document.getElementById('jlClosePriceModal')?.addEventListener('click', () => this.jlClosePriceModal());
        document.getElementById('jlPriceModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'jlPriceModal') this.jlClosePriceModal();
        });
        this.jlRefreshPriceStatus();
    }

    // --- 导入CSV价格表 ---
    jlImportCsv() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,.txt';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const text = ev.target.result;
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                    if (lines.length < 2) { alert('文件内容为空或格式错误'); return; }
                    const sep = lines[0].includes('\t') ? '\t' : ',';
                    const rows = [];
                    for (let i = 1; i < lines.length; i++) {
                        const cols = lines[i].split(sep).map(c => c.trim());
                        if (cols.length < 3) continue;
                        const name = cols[0];
                        const grade = cols[1].toUpperCase();
                        const price = parseFloat(cols[2]);
                        if (name && grade && !isNaN(price)) rows.push({ name, grade, price });
                    }
                    if (rows.length === 0) { alert('未解析到有效数据，请检查格式：员工姓名\\t等级\\t价格'); return; }
                    this.jlSavePriceTable(rows);
                    this.jlRefreshPriceStatus();
                    this.showSuccessMessage(`✅ 价格表导入成功！共 ${rows.length} 条记录`);
                } catch (err) { alert('导入失败：' + err.message); }
            };
            reader.readAsText(file, 'UTF-8');
        };
        input.click();
    }

    // --- 导出CSV价格表 ---
    jlExportCsv() {
        const rows = this.jlLoadPriceTable();
        if (rows.length === 0) { alert('暂无价格表数据'); return; }
        const lines = ['员工姓名\t等级\t价格'];
        rows.forEach(r => lines.push(`${r.name}\t${r.grade}\t${r.price}`));
        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `价格表_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    }

    // --- 价格表弹窗 ---
    jlOpenPriceModal() {
        const m = document.getElementById('jlPriceModal');
        if (m) { m.style.display = 'flex'; this.jlRenderPriceTable(); }
    }

    jlClosePriceModal() {
        const m = document.getElementById('jlPriceModal');
        if (m) m.style.display = 'none';
        this.jlRefreshPriceStatus();
    }

    jlRenderPriceTable() {
        const rows = this.jlLoadPriceTable();
        const allGrades = [...new Set(rows.map(r => r.grade.toUpperCase()))].sort();
        const grades = allGrades.length > 0 ? allGrades : ['S', 'SS', 'SSS', 'SSSS', 'SX'];
        const empMap = {};
        rows.forEach(r => {
            if (!empMap[r.name]) empMap[r.name] = {};
            empMap[r.name][r.grade.toUpperCase()] = r.price;
        });
        const empNames = Object.keys(empMap);

        const thead = document.getElementById('jlPriceTableHead');
        const tbody = document.getElementById('jlPriceTableBody');
        if (!thead || !tbody) return;

        thead.innerHTML = `<tr><th>员工姓名</th>${grades.map(g => `<th>${g}</th>`).join('')}<th>操作</th></tr>`;
        tbody.innerHTML = '';

        empNames.forEach(name => {
            const tr = document.createElement('tr');
            const nameTd = document.createElement('td');
            nameTd.innerHTML = `<input type="text" value="${name}" data-field="name" style="width:80px" />`;
            tr.appendChild(nameTd);
            grades.forEach(g => {
                const td = document.createElement('td');
                const val = empMap[name][g] !== undefined ? empMap[name][g] : '';
                td.innerHTML = `<input type="number" value="${val}" data-grade="${g}" min="0" placeholder="-" />`;
                tr.appendChild(td);
            });
            const actionTd = document.createElement('td');
            const delBtn = document.createElement('button');
            delBtn.className = 'jl-btn-del';
            delBtn.textContent = '删除';
            delBtn.onclick = () => { tr.remove(); this._jlSaveFromModal(grades); };
            actionTd.appendChild(delBtn);
            tr.appendChild(actionTd);
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('change', () => this._jlSaveFromModal(grades));
        });

        document.getElementById('jlAddPriceRow').onclick = () => {
            const newName = prompt('请输入员工姓名：');
            if (!newName) return;
            const existing = this.jlLoadPriceTable();
            if (!existing.some(r => r.name === newName)) {
                grades.forEach(g => existing.push({ name: newName, grade: g, price: 0 }));
                this.jlSavePriceTable(existing);
            }
            this.jlRenderPriceTable();
        };

        document.getElementById('jlAddGrade').onclick = () => {
            const ng = prompt('请输入等级名称（如 S、SS、SSS...）：');
            if (!ng) return;
            const g = ng.toUpperCase();
            const existing = this.jlLoadPriceTable();
            const names = [...new Set(existing.map(r => r.name))];
            names.forEach(n => {
                if (!existing.some(r => r.name === n && r.grade === g)) existing.push({ name: n, grade: g, price: 0 });
            });
            this.jlSavePriceTable(existing);
            this.jlRenderPriceTable();
        };
    }

    _jlSaveFromModal(grades) {
        const tbody = document.getElementById('jlPriceTableBody');
        if (!tbody) return;
        const rows = [];
        tbody.querySelectorAll('tr').forEach(tr => {
            const nameInput = tr.querySelector('input[data-field="name"]');
            if (!nameInput) return;
            const name = nameInput.value.trim();
            if (!name) return;
            grades.forEach(g => {
                const inp = tr.querySelector(`input[data-grade="${g}"]`);
                const val = inp ? parseFloat(inp.value) : NaN;
                if (!isNaN(val)) rows.push({ name, grade: g, price: val });
            });
        });
        this.jlSavePriceTable(rows);
    }

    // ---- 时间转换引擎 ----

    _jlParseTime(raw) {
        const s = String(raw).trim().replace(':', '.');
        const parts = s.split('.');
        const h = parseInt(parts[0].replace(/[^\d]/g, ''));
        const mStr = parts[1] ? parts[1].replace(/[^\d]/g, '').padEnd(2, '0').slice(0, 2) : '00';
        const m = parseInt(mStr) || 0;
        return { h, m };
    }

    // 12h → 24h：1~12 视为下午/晚上，12=午夜0点
    _jlTo24(h) {
        if (h === 12) return 0;
        if (h >= 1 && h <= 11) return h + 12;
        return h;
    }

    // 解析时间段，返回 [{ start, end }]（可能拆分多条）
    _jlParseTimeRange(rawRange) {
        const range = rawRange.trim().replace(/[－—–]/g, '-');
        const dashIdx = range.lastIndexOf('-');
        if (dashIdx <= 0) return null;

        const startRaw = range.slice(0, dashIdx).trim().replace(/[^\d.:]/g, '');
        const endRaw = range.slice(dashIdx + 1).trim().replace(/[^\d.:]/g, '');
        const sp = this._jlParseTime(startRaw);
        const ep = this._jlParseTime(endRaw);
        const startH24 = this._jlTo24(sp.h);
        const endH24 = this._jlTo24(ep.h);
        // 特殊规则：
        // - 开始时间是12 → 视为午夜0:00（如 12-1 = 0:00-1:00）
        // - 结束时间是12 → 视为深夜24:00（如 10-12 = 22:00-24:00，需拆分且最后截为23:59）
        const rawStartH = sp.h;
        const rawEndH = ep.h;

        let startMins, endMins, endIs24;

        if (rawStartH === 12) {
            // 开始是12，代表午夜0点
            startMins = 0 + sp.m;
        } else {
            startMins = this._jlTo24(rawStartH) * 60 + sp.m;
        }

        if (rawEndH === 12 && rawStartH !== 12) {
            // 结束是12且开始不是12，代表深夜24:00
            endMins = 24 * 60 + ep.m;
            endIs24 = true;
        } else if (rawEndH === 12 && rawStartH === 12) {
            // 12-12 没意义，结束=1小时后
            endMins = 60;
            endIs24 = false;
        } else {
            endMins = this._jlTo24(rawEndH) * 60 + ep.m;
            endIs24 = false;
        }

        // 如果结束<=开始（且不是24:00情况），可能是跨午夜的普通时段（如2-3已经正确了）
        // 但对于12-1（start=0, end=_jlTo24(1)*60=780？不对，需要重新处理）
        // 实际上 rawEndH=1 → _jlTo24(1)=13 → endMins=780，而 startMins=0，差780分钟，会被拆成13段
        // 修正：若开始是0点（原始12），结束用实际小时（1→1小时后=60分钟）
        if (rawStartH === 12) {
            // 开始是午夜0点时，结束时间按小时数的自然值（1点=1小时=60分钟）
            endMins = rawEndH * 60 + ep.m;
            endIs24 = false;
        }

        const durationMins = endMins - startMins;
        if (durationMins <= 0) return null;

        const fmt = (totalMins) => {
            // 24:00 → 显示为 23:59
            if (totalMins >= 24 * 60) totalMins = 23 * 60 + 59;
            const hh = Math.floor(totalMins / 60) % 24;
            const mm = totalMins % 60;
            return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        };

        if (durationMins >= 120) {
            const segs = [];
            let cur = startMins;
            while (cur < endMins) {
                const next = Math.min(cur + 60, endMins);
                segs.push({ start: fmt(cur), end: fmt(next) });
                cur = next;
            }
            return segs;
        }
        return [{ start: fmt(startMins), end: fmt(endMins) }];
    }

    // 清洗金额
    _jlCleanAmount(raw) {
        if (!raw) return null;
        const cleaned = String(raw).replace(/[卷后猫咖优惠特价折扣]+/g, '').trim();
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
    }

    // 解析一行接龙数据 → [{ name, grade, gradePrice, timeStart, timeEnd, client, amount, platform, isSplit, segIndex, totalSegs }]
    _jlParseLine(line, priceRows) {
        let s = line.trim().replace(/^\d+[.、。]\s*/, '');
        if (!s) return null;

        const parts = s.split(/[，,]/).map(p => p.trim());
        if (parts.length < 3) return null;

        const namePart = parts[0];
        const timePart = parts[1];
        const clientPart = parts.slice(2).join('，');

        // 姓名+等级
        const gradeMatch = namePart.match(/^(.+?)\s*(S{1,4}|SX)$/i);
        if (!gradeMatch) return null;
        const name = gradeMatch[1].trim();
        const grade = gradeMatch[2].toUpperCase();

        // 查找等级价格
        let gradePrice = null;
        if (priceRows && priceRows.length > 0) {
            const found = priceRows.find(r => r.name === name && r.grade.toUpperCase() === grade);
            if (found) gradePrice = found.price;
            if (gradePrice === null) {
                const byGrade = priceRows.find(r => r.grade.toUpperCase() === grade);
                if (byGrade) gradePrice = byGrade.price;
            }
        }

        // 解析时间段
        const timeSegs = this._jlParseTimeRange(timePart);
        if (!timeSegs || timeSegs.length === 0) return null;
        const isSplit = timeSegs.length > 1;

        // 解析客户+金额+平台
        const cam = clientPart.match(/^(.+?)[（(]([\d.,]+)[）)]\s*(.*)$/);
        let client = '', amount = null, platform = '';
        if (cam) {
            client = cam[1].trim();
            amount = this._jlCleanAmount(cam[2]);
            platform = cam[3].trim();
        } else {
            const tokens = clientPart.split(/\s+/);
            if (tokens.length > 1) {
                platform = tokens[tokens.length - 1];
                client = tokens.slice(0, -1).join(' ');
            } else {
                client = clientPart;
            }
        }

        const amtPer = (amount !== null && isSplit) ? Math.round(amount / timeSegs.length) : amount;
        return timeSegs.map((seg, idx) => ({
            name, grade, gradePrice,
            timeStart: seg.start, timeEnd: seg.end,
            client, amount: amtPer, platform,
            isSplit, segIndex: idx, totalSegs: timeSegs.length,
        }));
    }

    // --- 主转换入口 ---
    jlConvert() {
        const rawInput = document.getElementById('jlRawInput');
        if (!rawInput || !rawInput.value.trim()) { alert('请先粘贴接龙数据'); return; }

        const priceRows = this.jlLoadPriceTable();
        const lines = rawInput.value.trim().split('\n').map(l => l.trim()).filter(l => l);
        const results = [];
        let parseErrors = 0;

        lines.forEach(line => {
            const parsed = this._jlParseLine(line, priceRows);
            if (parsed) results.push(...parsed);
            else parseErrors++;
        });

        if (results.length === 0) {
            const st = document.getElementById('jlConvertStatus');
            if (st) st.textContent = '⚠️ 未能解析任何数据，请检查格式';
            return;
        }

        // 生成输出文本
        const outputLines = results.map(r => {
            const gradeStr = r.gradePrice !== null ? `${r.grade}（${r.gradePrice}）` : r.grade;
            const timeStr = `${r.timeStart}-${r.timeEnd}`;
            const amtStr = r.amount !== null ? `（${r.amount}）` : '';
            const clientStr = r.client ? `${r.client}${amtStr}` : '';
            return [r.name, gradeStr, timeStr, clientStr, r.platform].filter(Boolean).join('，');
        });

        const outEl = document.getElementById('jlConvertedOutput');
        if (outEl) outEl.value = outputLines.join('\n');

        // 状态
        const splitCount = results.filter(r => r.isSplit).length;
        let statusMsg = `✅ 转换完成：${lines.length} 条 → ${results.length} 条`;
        if (splitCount > 0) statusMsg += `（含 ${splitCount} 条拆分）`;
        if (parseErrors > 0) statusMsg += `，${parseErrors} 条跳过`;
        const stEl = document.getElementById('jlConvertStatus');
        if (stEl) stEl.textContent = statusMsg;

        // 统计
        const totalAmt = results.reduce((s, r) => s + (r.amount || 0), 0);
        const empSet = new Set(results.map(r => r.name));
        const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        setEl('jlStatInput', lines.length);
        setEl('jlStatOutput', results.length);
        setEl('jlStatEmployees', empSet.size);
        setEl('jlStatAmount', '¥' + totalAmt);
        setEl('jlStatSplit', splitCount);
        const statsEl = document.getElementById('jlStats');
        if (statsEl) statsEl.style.display = 'grid';

        // 明细表格
        this._jlRenderDetail(results);
        this._jlLastResults = results;
    }

    _jlRenderDetail(results) {
        const tbody = document.getElementById('jlDetailBody');
        const section = document.getElementById('jlDetailSection');
        if (!tbody || !section) return;
        tbody.innerHTML = '';
        results.forEach((r, i) => {
            const tr = document.createElement('tr');
            if (r.isSplit) tr.classList.add('jl-split-row');
            const splitTag = r.isSplit ? `<span class="jl-split-tag">拆${r.segIndex + 1}/${r.totalSegs}</span>` : '';
            tr.innerHTML = `
                <td>${i + 1}</td>
                <td>${r.name}</td>
                <td><span class="jl-grade-badge">${r.grade}</span>${splitTag}</td>
                <td>${r.gradePrice !== null ? '¥' + r.gradePrice : '<span style="color:var(--color-text-muted)">-</span>'}</td>
                <td>${r.timeStart}-${r.timeEnd}</td>
                <td>${r.client || '-'}</td>
                <td>${r.amount !== null ? '¥' + r.amount : '-'}</td>
                <td>${r.platform || '-'}</td>`;
            tbody.appendChild(tr);
        });
        section.style.display = 'block';
    }

    jlCopyResult() {
        const el = document.getElementById('jlConvertedOutput');
        if (!el || !el.value) { alert('暂无转换结果'); return; }
        navigator.clipboard.writeText(el.value).then(() => {
            this.showSuccessMessage('✅ 已复制到剪贴板');
        }).catch(() => {
            el.select();
            document.execCommand('copy');
            this.showSuccessMessage('✅ 已复制');
        });
    }

    // ======================
    // 自动导入功能
    // ======================

    // 设置自动导入UI
    setupAutoImportUI() {
        return; // 数据整理模块已移除，自动导入UI暂不挂载

        // 创建自动导入面板
        const autoImportPanel = document.createElement('div');
        autoImportPanel.className = 'auto-import-panel';
        autoImportPanel.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 12px;
            margin-top: 20px;
            box-shadow: 0 10px 20px rgba(0,0,0,0.1);
        `;

        autoImportPanel.innerHTML = `
            <h3 style="margin: 0 0 15px 0; font-size: 1.2rem; display: flex; align-items: center; gap: 10px;">
                <span>🤖 自动同步</span>
                <span id="autoImportStatus" style="font-size: 0.8rem; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 10px;">未连接</span>
            </h3>
            
            <p style="margin: 0 0 15px 0; font-size: 0.9rem; opacity: 0.9;">
                每日自动同步排班数据，无需手动导入
            </p>
            
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 15px;">
                <button id="checkAutoImportBtn" class="btn" style="background: white; color: #667eea; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold;">
                    🔄 检查更新
                </button>
                <button id="importLatestBtn" class="btn" style="background: #4CAF50; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold;">
                    📥 导入最新数据
                </button>
                <button id="autoImportToggle" class="btn" style="background: #FF9800; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold;">
                    ⚡ 启用自动同步
                </button>
            </div>
            
            <div id="autoImportLog" style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; font-family: monospace; font-size: 0.85rem; max-height: 200px; overflow-y: auto; margin-top: 10px; display: none;">
                <div style="color: #ccc;">等待操作...</div>
            </div>
            
            <div style="margin-top: 15px; font-size: 0.8rem; opacity: 0.8; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 10px;">
                <div>数据源: <span id="dataSourceInfo">GitHub 仓库</span></div>
                <div>最后检查: <span id="lastCheckTime">从未</span></div>
                <div>最后导入: <span id="lastImportTime">从未</span></div>
            </div>
        `;

        // 插入到分析区域之后
        analysisSection.parentNode.insertBefore(autoImportPanel, analysisSection.nextSibling);

        // 绑定事件
        setTimeout(() => {
            document.getElementById('checkAutoImportBtn').addEventListener('click', () => {
                this.checkAutoImport(true); // true 表示显示日志
            });
            
            document.getElementById('importLatestBtn').addEventListener('click', () => {
                this.importLatestData();
            });
            
            document.getElementById('autoImportToggle').addEventListener('click', (e) => {
                this.toggleAutoImport(e.target);
            });
        }, 100);
    }

    // 添加日志
    addAutoImportLog(message, type = 'info') {
        const logContainer = document.getElementById('autoImportLog');
        if (!logContainer) return;
        
        const colors = {
            info: '#4FC3F7',
            success: '#4CAF50',
            warning: '#FF9800',
            error: '#F44336'
        };
        
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.style.cssText = `margin: 2px 0; color: ${colors[type] || colors.info};`;
        logEntry.textContent = `[${timestamp}] ${message}`;
        
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
        
        // 显示日志容器
        logContainer.style.display = 'block';
    }

    // 检查自动导入
    async checkAutoImport(showLog = false) {
        if (showLog) {
            this.addAutoImportLog('开始检查数据更新...', 'info');
        }
        
        try {
            // 数据源URL（GitHub Raw）
            const dataUrl = 'https://raw.githubusercontent.com/caishuhan213-star/mmk/main/data/latest.txt';
            const metaUrl = 'https://raw.githubusercontent.com/caishuhan213-star/mmk/main/data/meta.json';
            
            // 获取元数据
            const metaResponse = await fetch(metaUrl + '?t=' + Date.now());
            let meta = { lastUpdated: null, count: 0 };
            
            if (metaResponse.ok) {
                meta = await metaResponse.json();
            }
            
            // 更新UI状态
            const lastCheckTime = document.getElementById('lastCheckTime');
            if (lastCheckTime) {
                lastCheckTime.textContent = new Date().toLocaleString();
            }
            
            const statusEl = document.getElementById('autoImportStatus');
            if (statusEl) {
                statusEl.textContent = '🟢 已连接';
                statusEl.style.background = 'rgba(76, 175, 80, 0.3)';
            }
            
            if (showLog) {
                if (meta.lastUpdated) {
                    const lastUpdate = new Date(meta.lastUpdated).toLocaleString();
                    this.addAutoImportLog(`数据源状态正常，最后更新: ${lastUpdate}，共 ${meta.count} 条记录`, 'success');
                } else {
                    this.addAutoImportLog('数据源状态正常，暂无可用数据', 'warning');
                }
            }
            
            return meta;
            
        } catch (error) {
            console.error('检查自动导入失败:', error);
            
            const statusEl = document.getElementById('autoImportStatus');
            if (statusEl) {
                statusEl.textContent = '🔴 连接失败';
                statusEl.style.background = 'rgba(244, 67, 54, 0.3)';
            }
            
            if (showLog) {
                this.addAutoImportLog(`连接失败: ${error.message}`, 'error');
            }
            
            return null;
        }
    }

    // 导入最新数据
    async importLatestData() {
        const logContainer = document.getElementById('autoImportLog');
        if (logContainer) {
            logContainer.innerHTML = '<div style="color: #ccc;">开始导入...</div>';
            logContainer.style.display = 'block';
        }
        
        this.addAutoImportLog('开始下载最新数据...', 'info');
        
        try {
            // 数据源URL
            const dataUrl = 'https://raw.githubusercontent.com/caishuhan213-star/mmk/main/data/latest.txt';
            const metaUrl = 'https://raw.githubusercontent.com/caishuhan213-star/mmk/main/data/meta.json';
            
            // 获取元数据
            const metaResponse = await fetch(metaUrl + '?t=' + Date.now());
            if (!metaResponse.ok) {
                throw new Error('无法获取元数据');
            }
            
            const meta = await metaResponse.json();
            
            // 获取数据
            const dataResponse = await fetch(dataUrl + '?t=' + Date.now());
            if (!dataResponse.ok) {
                throw new Error('无法获取数据');
            }
            
            const dataText = await dataResponse.text();
            const lines = dataText.split('\n').filter(line => line.trim());
            
            if (lines.length === 0) {
                this.addAutoImportLog('数据为空，没有可导入的记录', 'warning');
                return;
            }
            
            this.addAutoImportLog(`下载成功，共 ${lines.length} 条记录`, 'success');
            
            // 使用今天的日期作为导入日期
            const importDate = new Date().toISOString().split('T')[0];
            
            // 使用现有的批量导入逻辑
            const newSchedules = [];
            const errors = [];
            
            lines.forEach((line, index) => {
                const lineNum = index + 1;
                const trimmedLine = line.trim();
                
                if (!trimmedLine) return;
                
                try {
                    const schedule = this.parseImportLine(trimmedLine, importDate);
                    if (schedule) {
                        newSchedules.push(schedule);
                    } else {
                        errors.push(`第${lineNum}行: 解析返回空结果`);
                    }
                } catch (error) {
                    errors.push(`第${lineNum}行格式错误: ${error.message}`);
                    console.error(`导入错误 - 第${lineNum}行:`, error, '原始数据:', trimmedLine);
                }
            });
            
            if (errors.length > 0) {
                const errorMessage = '以下行格式错误，请检查：\n\n' + errors.join('\n\n');
                this.addAutoImportLog(`发现 ${errors.length} 个格式错误`, 'error');
                console.error('导入错误详情:', errors);
                alert('部分数据格式错误，导入已取消。请检查数据格式。');
                return;
            }
            
            if (newSchedules.length === 0) {
                this.addAutoImportLog('没有有效的数据可以导入', 'warning');
                return;
            }
            
            this.addAutoImportLog(`解析成功，准备导入 ${newSchedules.length} 条记录...`, 'info');
            
            // 检查时间冲突
            const conflictFreeSchedules = [];
            newSchedules.forEach(schedule => {
                if (!this.hasTimeConflict(schedule)) {
                    conflictFreeSchedules.push(schedule);
                } else {
                    this.addAutoImportLog(`跳过冲突记录: ${schedule.employeeName} ${schedule.startTime}-${schedule.endTime}`, 'warning');
                }
            });
            
            if (conflictFreeSchedules.length === 0) {
                this.addAutoImportLog('所有记录都存在时间冲突，导入取消', 'warning');
                return;
            }
            
            // 确认导入
            const confirmMessage = `准备导入 ${conflictFreeSchedules.length} 条记录：\n\n` +
                conflictFreeSchedules.slice(0, 5).map(s => `• ${s.employeeName} - ${s.clientName} (¥${s.payment})`).join('\n') +
                (conflictFreeSchedules.length > 5 ? `\n... 等共 ${conflictFreeSchedules.length} 条记录` : '') +
                `\n\n确定要导入这些记录吗？`;
            
            if (!confirm(confirmMessage)) {
                this.addAutoImportLog('用户取消导入', 'info');
                return;
            }
            
            // 批量添加记录
            let successCount = 0;
            conflictFreeSchedules.forEach(schedule => {
                if (!this.hasTimeConflict(schedule)) {
                    this.schedules.push(schedule);
                    successCount++;
                }
            });
            
            // 保存数据，导入模式防止 onSnapshot 覆盖
            this.dbManager.beginImport();
            try {
                await this.saveSchedules();
                this.addAutoImportLog(`✅ 导入成功！成功导入 ${successCount} 条记录`, 'success');

                // 更新显示
                this.renderTableWithCurrentFilter();
                this.updateStats();

                // 更新最后导入时间
                const lastImportTime = document.getElementById('lastImportTime');
                if (lastImportTime) {
                    lastImportTime.textContent = new Date().toLocaleString();
                }

                // 显示成功消息
                this.showSuccessMessage(`批量导入完成！成功导入 ${successCount} 条记录`);

            } catch (error) {
                this.addAutoImportLog(`❌ 保存失败：${error.message}`, 'error');
                alert(`❌ 保存失败：${error.message}\n\n建议清理存储空间后重试。`);
            } finally {
                this.dbManager.endImport();
            }
            
        } catch (error) {
            console.error('导入失败:', error);
            this.addAutoImportLog(`导入失败: ${error.message}`, 'error');
            alert(`导入失败：${error.message}`);
        }
    }

    // 切换自动导入状态
    toggleAutoImport(button) {
        const isEnabled = button.textContent.includes('启用');
        
        if (isEnabled) {
            button.textContent = '⏸️ 禁用自动同步';
            button.style.background = '#F44336';
            this.addAutoImportLog('自动同步已启用，将每30分钟检查一次更新', 'success');
            
            // 启动定时检查
            if (this.autoImportInterval) {
                clearInterval(this.autoImportInterval);
            }
            
            this.autoImportInterval = setInterval(() => {
                this.checkAutoImport(false);
                this.addAutoImportLog('定时检查数据更新...', 'info');
            }, 30 * 60 * 1000); // 30分钟
            
            // 立即检查一次
            setTimeout(() => this.checkAutoImport(false), 1000);
            
        } else {
            button.textContent = '⚡ 启用自动同步';
            button.style.background = '#FF9800';
            this.addAutoImportLog('自动同步已禁用', 'info');
            
            // 清除定时器
            if (this.autoImportInterval) {
                clearInterval(this.autoImportInterval);
                this.autoImportInterval = null;
            }
        }
    }

    // 初始化自动导入（在应用初始化时调用）
    initAutoImport() {
        // 延迟设置UI，确保页面完全加载
        setTimeout(() => {
            this.setupAutoImportUI();
            
            // 初始检查一次
            this.checkAutoImport(false);
            
            // 恢复自动同步状态（从本地存储）
            const autoImportEnabled = localStorage.getItem('autoImportEnabled') === 'true';
            if (autoImportEnabled) {
                const toggleBtn = document.getElementById('autoImportToggle');
                if (toggleBtn) {
                    setTimeout(() => toggleBtn.click(), 1000);
                }
            }
        }, 2000);
    }
}

// 初始化应用
let scheduleManager;

document.addEventListener('DOMContentLoaded', () => {
    scheduleManager = new ScheduleManager();
    
    // 设置默认日期为今天
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('scheduleDate').value = today;
    
    // 设置默认时间
    document.getElementById('startTime').value = '09:00';
    document.getElementById('endTime').value = '10:00';
    
    // 初始化员工排行榜
    scheduleManager.updateEmployeeRanking();
});
