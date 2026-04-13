// 排班展示系统 JavaScript 功能

// 注册 datalabels 插件（如果可用）
if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
    // 全局禁用 datalabels 插件，只在需要的图表中启用
    Chart.defaults.set('plugins.datalabels', {
        display: false
    });
}

// IndexedDB工具类
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
                
                // 创建对象存储：提成配置
                if (!db.objectStoreNames.contains('commissionConfigs')) {
                    db.createObjectStore('commissionConfigs', { keyPath: ['employeeName', 'projectName'] });
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
        // 初始化IndexedDB
        this.dbManager = new IndexedDBManager();
        this.dbManager.init().catch(err => {
            console.error('IndexedDB初始化失败，将使用localStorage:', err);
        });
        
        // 初始化店铺上下文
        this.initStoreContext();
        
        // 先同步加载数据（保证界面能快速显示）
        this.schedules = this.loadSchedules();
        this.operatingCosts = this.loadOperatingCosts();
        
        // 后台异步检查和迁移数据
        setTimeout(() => {
            this.loadSchedulesAsync();
            this.loadOperatingCostsAsync();
            this.loadEmployeesAsync();
            this.loadAttendanceFeesAsync();
        }, 500);
        this.projects = this.loadProjects();
        this.employees = this.loadEmployees();
        this.attendanceFees = this.loadAttendanceFees();
        this.interviewFees = this.loadInterviewFees();
        this.operatingCosts = this.loadOperatingCosts();
        this.reportRebates = this.loadReportRebates();
        this.salaryTiers = this.loadSalaryTiers();
        this.salaryPassword = this.loadSalaryPassword();
        this.commissionConfigs = this.loadCommissionConfigs();
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
        this.renderReportRebateTable();
        this.renderEmployeeCommissionSummary();
        this.initializeSalaryManagement();
        
        // 初始化提成配置（使用try-catch防止错误影响页面加载）
        try {
            this.initializeCommissionConfig();
        } catch (error) {
            console.error('初始化提成配置失败:', error);
