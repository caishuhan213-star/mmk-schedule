// 多店铺管理中心 JavaScript

class StoreCenterManager {
    constructor() {
        this.stores = [];
        this.editingStoreId = null;
        this._unsubscribeStores = null;

        // 先用 localStorage 快速渲染（可能为空）
        const cached = localStorage.getItem('stores');
        this.stores = cached ? JSON.parse(cached) : [];
        this.renderStoreGrid();
        this.updateOverviewStats();

        // 等 Firebase 就绪后实时同步
        this._waitForFirebase();
    }

    // 等待 Firebase 初始化并监听认证状态
    _waitForFirebase() {
        const check = () => {
            if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
                firebase.auth().onAuthStateChanged((user) => {
                    if (user) {
                        console.log('StoreCenterManager: 用户已登录', user.email);
                        this._subscribeToStores();
                    } else {
                        console.log('StoreCenterManager: 用户已登出');
                        if (this._unsubscribeStores) {
                            this._unsubscribeStores();
                            this._unsubscribeStores = null;
                        }
                    }
                });
            } else {
                setTimeout(check, 500);
            }
        };
        check();
    }

    // 获取 Firestore 实例
    _db() {
        return (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore() : null;
    }

    // 实时监听 Firestore 店铺集合
    _subscribeToStores() {
        const db = this._db();
        if (!db) return;

        if (this._unsubscribeStores) {
            this._unsubscribeStores();
        }

        this._unsubscribeStores = db.collection('team/shared/stores').onSnapshot((snapshot) => {
            const stores = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.name) {
                    const { syncedAt, updatedAt, ...store } = data;
                    stores.push(store);
                }
            });
            console.log(`StoreCenterManager: onSnapshot → ${stores.length} 个店铺`);
            this.stores = stores;
            localStorage.setItem('stores', JSON.stringify(stores));
            this.renderStoreGrid();
            this.updateOverviewStats();
        }, (error) => {
            console.error('StoreCenterManager: 监听店铺失败:', error);
        });
    }

    // 保存单个店铺到 Firestore
    async _saveStoreToFirestore(store) {
        const db = this._db();
        if (!db) { console.warn('Firestore 未就绪'); return; }
        const user = firebase.auth().currentUser;
        await db.collection('team/shared/stores').doc(store.id).set({
            ...store,
            syncedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: new Date().toISOString(),
            ...(user ? { userId: user.uid } : {})
        });
    }

    // 从 Firestore 删除单个店铺
    async _deleteStoreFromFirestore(storeId) {
        const db = this._db();
        if (!db) { console.warn('Firestore 未就绪'); return; }
        await db.collection('team/shared/stores').doc(storeId).delete();
    }

    // 渲染店铺网格
    renderStoreGrid() {
        const grid = document.getElementById('storeGrid');
        
        if (this.stores.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🏪</div>
                    <h3>还没有店铺</h3>
                    <p>点击"添加新店铺"按钮创建您的第一家店铺</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.stores.map(store => {
            const stats = this.getStoreStats(store.id);
            return `
                <div class="store-card" onclick="storeCenter.enterStore('${store.id}')">
                    <div class="store-card-header">
                        <div style="display: flex; align-items: center; flex: 1;">
                            <span class="store-card-icon">🏪</span>
                            <span class="store-card-name">${store.name}</span>
                        </div>
                        <div class="store-card-actions" onclick="event.stopPropagation()">
                            <button onclick="storeCenter.editStore('${store.id}')" title="编辑">✏️</button>
                            <button onclick="storeCenter.deleteStore('${store.id}')" title="删除">🗑️</button>
                        </div>
                    </div>
                    ${store.address ? `<div style="font-size: 0.9em; color: #666; margin-bottom: 5px;">📍 ${store.address}</div>` : ''}
                    ${store.manager ? `<div style="font-size: 0.9em; color: #666;">👤 店长：${store.manager}</div>` : ''}
                    <div class="store-card-stats">
                        <div class="store-stat-item success">
                            <div class="label">今日营收</div>
                            <div class="value">¥${stats.todayRevenue.toLocaleString()}</div>
                        </div>
                        <div class="store-stat-item">
                            <div class="label">今日订单</div>
                            <div class="value">${stats.todayOrders}单</div>
                        </div>
                        <div class="store-stat-item">
                            <div class="label">总营收</div>
                            <div class="value">¥${stats.totalRevenue.toLocaleString()}</div>
                        </div>
                        <div class="store-stat-item">
                            <div class="label">员工数</div>
                            <div class="value">${stats.employeeCount}人</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 获取店铺统计数据
    getStoreStats(storeId) {
        const schedules = this.getStoreData(storeId, 'schedules') || [];
        const employees = this.getStoreData(storeId, 'employees') || [];
        
        // 今日日期
        const today = new Date().toISOString().split('T')[0];
        
        // 今日订单
        const todaySchedules = schedules.filter(s => s.scheduleDate === today);
        const todayRevenue = todaySchedules.reduce((sum, s) => sum + (parseFloat(s.payment) || 0), 0);
        const todayOrders = todaySchedules.length;
        
        // 总营收
        const totalRevenue = schedules.reduce((sum, s) => sum + (parseFloat(s.payment) || 0), 0);
        
        return {
            todayRevenue,
            todayOrders,
            totalRevenue,
            employeeCount: employees.length
        };
    }

    // 获取店铺的数据
    getStoreData(storeId, dataType) {
        const key = `store_${storeId}_${dataType}`;
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    }

    // 更新总览统计
    updateOverviewStats() {
        let totalRevenue = 0;
        let totalOrders = 0;
        let totalEmployees = 0;

        this.stores.forEach(store => {
            const stats = this.getStoreStats(store.id);
            totalRevenue += stats.todayRevenue;
            totalOrders += stats.todayOrders;
            totalEmployees += stats.employeeCount;
        });

        document.getElementById('totalStores').textContent = this.stores.length;
        document.getElementById('todayRevenue').textContent = `¥${totalRevenue.toLocaleString()}`;
        document.getElementById('todayOrders').textContent = `${totalOrders}单`;
        document.getElementById('totalEmployees').textContent = `${totalEmployees}人`;
    }

    // 打开添加店铺模态框
    openAddStoreModal() {
        this.editingStoreId = null;
        document.getElementById('storeModalTitle').textContent = '添加新店铺';
        document.getElementById('storeForm').reset();
        document.getElementById('storeModal').style.display = 'block';
    }

    // 关闭店铺模态框
    closeStoreModal() {
        document.getElementById('storeModal').style.display = 'none';
        this.editingStoreId = null;
    }

    // 保存店铺（直接写 Firestore，onSnapshot 自动刷新界面）
    async saveStore() {
        const name = document.getElementById('storeName').value.trim();
        const address = document.getElementById('storeAddress').value.trim();
        const phone = document.getElementById('storePhone').value.trim();
        const manager = document.getElementById('storeManager').value.trim();
        const description = document.getElementById('storeDescription').value.trim();

        if (!name) {
            alert('请输入店铺名称！');
            return;
        }

        // 检查店铺名称是否重复
        const exists = this.stores.some(s =>
            s.name === name && s.id !== this.editingStoreId
        );

        if (exists) {
            alert('店铺名称已存在，请使用其他名称！');
            return;
        }

        let store;
        if (this.editingStoreId) {
            // 编辑现有店铺
            store = this.stores.find(s => s.id === this.editingStoreId);
            if (store) {
                store.name = name;
                store.address = address;
                store.phone = phone;
                store.manager = manager;
                store.description = description;
            }
        } else {
            // 添加新店铺
            store = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                name,
                address,
                phone,
                manager,
                description,
                createdAt: new Date().toISOString(),
            };
        }

        try {
            await this._saveStoreToFirestore(store);
            // onSnapshot 会自动更新 this.stores 并刷新界面
            this.closeStoreModal();
            alert(this.editingStoreId ? '✅ 店铺信息已更新！' : '✅ 店铺创建成功！');
        } catch (error) {
            console.error('保存店铺失败:', error);
            alert('❌ 保存失败: ' + error.message);
        }
    }

    // 编辑店铺
    editStore(storeId) {
        const store = this.stores.find(s => s.id === storeId);
        if (!store) return;

        this.editingStoreId = storeId;
        document.getElementById('storeModalTitle').textContent = '编辑店铺信息';
        document.getElementById('storeName').value = store.name;
        document.getElementById('storeAddress').value = store.address || '';
        document.getElementById('storePhone').value = store.phone || '';
        document.getElementById('storeManager').value = store.manager || '';
        document.getElementById('storeDescription').value = store.description || '';
        document.getElementById('storeModal').style.display = 'block';
    }

    // 删除店铺（直接删 Firestore，onSnapshot 自动刷新界面）
    async deleteStore(storeId) {
        const store = this.stores.find(s => s.id === storeId);
        if (!store) return;

        const stats = this.getStoreStats(storeId);

        const message = `⚠️ 确定要删除店铺"${store.name}"吗？

店铺数据统计：
• 总营收：¥${stats.totalRevenue.toLocaleString()}
• 员工数：${stats.employeeCount}人

⚠️ 警告：删除店铺将同时删除该店铺的所有数据（排班记录、员工信息、项目等），此操作不可恢复！

建议在删除前先备份店铺数据。`;

        if (!confirm(message)) return;

        // 二次确认
        const confirmText = prompt('⚠️ 最后确认 ⚠️\n\n请输入店铺名称来确认删除：');
        if (confirmText !== store.name) {
            if (confirmText !== null) {
                alert('输入错误，操作已取消');
            }
            return;
        }

        // 清除 localStorage 中该店铺的数据
        this.deleteStoreData(storeId);

        try {
            // 从 Firestore 删除店铺文档（onSnapshot 自动刷新列表）
            await this._deleteStoreFromFirestore(storeId);
            alert('✅ 店铺已删除！');
        } catch (error) {
            console.error('删除店铺失败:', error);
            alert('❌ 删除失败: ' + error.message);
        }
    }

    // 删除店铺的所有数据
    deleteStoreData(storeId) {
        const dataTypes = [
            'schedules', 'employees', 'projects', 
            'attendanceFees', 'interviewFees', 
            'operatingCosts', 'reportRebates', 
            'salaryTiers', 'salaryPassword'
        ];
        
        dataTypes.forEach(type => {
            const key = `store_${storeId}_${type}`;
            localStorage.removeItem(key);
        });
    }

    // 进入店铺管理
    enterStore(storeId) {
        const store = this.stores.find(s => s.id === storeId);
        if (!store) return;

        // 保存当前选中的店铺
        localStorage.setItem('currentStoreId', storeId);
        
        // 跳转到店铺管理页面
        window.location.href = 'index.html';
    }

    // 备份所有店铺数据
    backupAllStoresData() {
        try {
            if (this.stores.length === 0) {
                alert('暂无店铺数据可备份！');
                return;
            }

            const allData = {
                version: '2.0',
                backupDate: new Date().toISOString(),
                stores: this.stores,
                storesData: {}
            };

            // 收集每个店铺的数据
            this.stores.forEach(store => {
                const dataTypes = [
                    'schedules', 'employees', 'projects',
                    'attendanceFees', 'interviewFees',
                    'operatingCosts', 'reportRebates',
                    'salaryTiers', 'salaryPassword'
                ];

                allData.storesData[store.id] = {
                    storeName: store.name
                };

                dataTypes.forEach(type => {
                    const data = this.getStoreData(store.id, type);
                    if (data) {
                        allData.storesData[store.id][type] = data;
                    }
                });
            });

            // 转换为JSON字符串
            const jsonString = JSON.stringify(allData, null, 2);
            
            // 创建下载
            const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            const fileName = `多店铺完整备份_${this.formatDate(new Date())}_${new Date().getHours()}${String(new Date().getMinutes()).padStart(2, '0')}.json`;
            
            link.setAttribute('href', url);
            link.setAttribute('download', fileName);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            alert(`✅ 所有店铺数据备份成功！\n\n共备份 ${this.stores.length} 家店铺的完整数据\n文件已保存到下载文件夹！`);
        } catch (error) {
            console.error('备份失败:', error);
            alert('❌ 备份失败：' + error.message);
        }
    }

    // 恢复所有店铺数据
    restoreAllStoresData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.name.endsWith('.json')) {
                alert('❌ 请选择JSON格式的备份文件！');
                return;
            }

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const backupData = JSON.parse(event.target.result);

                    if (!backupData.version) {
                        throw new Error('备份文件格式不正确！缺少版本信息。');
                    }

                    // 兼容两种格式：
                    // 1. 多店铺备份（store-center.js 生成）：有 stores + storesData
                    // 2. 单店铺备份（script-clean.js 生成）：有 storeInfo + data
                    let normalizedStores = [];
                    let normalizedStoresData = {};

                    if (backupData.stores && backupData.storesData) {
                        // 多店铺格式
                        normalizedStores = backupData.stores;
                        normalizedStoresData = backupData.storesData;
                    } else if (backupData.data && backupData.storeInfo) {
                        // 单店铺格式：转换为多店铺结构
                        const storeId = backupData.storeInfo.id || ('store_' + Date.now());
                        normalizedStores = [backupData.storeInfo];
                        normalizedStoresData = {
                            [storeId]: backupData.data
                        };
                    } else if (backupData.data && !backupData.storeInfo) {
                        // 旧版单店铺格式（无 storeInfo）：使用当前选中的店铺
                        const currentStoreId = localStorage.getItem('currentStoreId');
                        if (!currentStoreId) {
                            throw new Error('备份文件为旧版单店铺格式，请先在排班系统中选中目标店铺后再恢复。');
                        }
                        normalizedStores = [];  // 不新增/覆盖店铺信息
                        normalizedStoresData = {
                            [currentStoreId]: backupData.data
                        };
                    } else {
                        throw new Error('备份文件格式不正确！无法识别备份类型。');
                    }

                    const backupDate = new Date(backupData.backupDate).toLocaleString('zh-CN');
                    const storeCount = normalizedStores.length || Object.keys(normalizedStoresData).length;
                    const modeInput = prompt(
`📦 备份文件信息：
━━━━━━━━━━━━━━━━━━━━━━━
备份时间：${backupDate}
店铺数量：${storeCount} 家
备份类型：${backupData.stores ? '多店铺备份' : '单店铺备份'}
━━━━━━━━━━━━━━━━━━━━━━━

请选择恢复模式：

输入 1 = 合并导入（推荐）
  → 备份中的记录追加到当前数据，已有记录不受影响

输入 2 = 完全覆盖
  → 用备份数据替换当前所有店铺和数据

输入其他或取消 = 放弃操作`);

                    if (!modeInput || (modeInput !== '1' && modeInput !== '2')) return;
                    const isMerge = modeInput === '1';

                    // 覆盖模式需要二次确认
                    if (!isMerge) {
                        const confirmText = prompt('⚠️ 最后确认 ⚠️\n\n此操作将覆盖所有数据！\n请输入"确认恢复"来继续：');
                        if (confirmText !== '确认恢复') {
                            if (confirmText !== null) alert('输入错误，操作已取消');
                            return;
                        }
                    }

                    // 按 id 去重合并数组的辅助函数
                    const mergeById = (current, incoming) => {
                        if (!incoming || !Array.isArray(incoming) || incoming.length === 0) return current;
                        const existingIds = new Set((current || []).map(r => r.id));
                        const newItems = incoming.filter(r => !existingIds.has(r.id));
                        return [...(current || []), ...newItems];
                    };

                    const dataTypes = [
                        'schedules', 'employees', 'projects',
                        'attendanceFees', 'interviewFees',
                        'operatingCosts', 'reportRebates',
                        'salaryTiers', 'salaryPassword'
                    ];
                    // 非数组类型不做合并，直接以备份值为准（仅覆盖模式）
                    const nonArrayTypes = new Set(['salaryTiers', 'salaryPassword']);

                    if (isMerge) {
                        // 合并模式：先确保店铺存在，再按 id 追加各类数据
                        for (const store of normalizedStores) {
                            const exists = this.stores.some(s => s.id === store.id);
                            if (!exists) {
                                await this._saveStoreToFirestore(store);
                            }
                        }

                        Object.keys(normalizedStoresData).forEach(storeId => {
                            const storeData = normalizedStoresData[storeId];
                            dataTypes.forEach(type => {
                                if (!storeData[type]) return;
                                if (nonArrayTypes.has(type)) return;
                                const current = this.getStoreData(storeId, type) || [];
                                const merged = mergeById(current, storeData[type]);
                                const key = `store_${storeId}_${type}`;
                                localStorage.setItem(key, JSON.stringify(merged));
                            });
                        });

                        alert(`✅ 合并导入成功！\n\n已将备份数据合并到当前 ${this.stores.length} 家店铺，当前数据未丢失。`);

                    } else {
                        // 覆盖模式
                        this.stores.forEach(store => {
                            this.deleteStoreData(store.id);
                        });

                        for (const store of normalizedStores) {
                            await this._saveStoreToFirestore(store);
                        }

                        Object.keys(normalizedStoresData).forEach(storeId => {
                            const storeData = normalizedStoresData[storeId];
                            dataTypes.forEach(type => {
                                if (storeData[type]) {
                                    const key = `store_${storeId}_${type}`;
                                    localStorage.setItem(key, JSON.stringify(storeData[type]));
                                }
                            });
                        });

                        alert(`✅ 数据恢复成功！\n\n已恢复 ${normalizedStores.length} 家店铺的完整数据！`);
                    }

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

        input.click();
    }

    // 导出店铺列表
    exportStoresList() {
        if (this.stores.length === 0) {
            alert('暂无店铺数据可导出！');
            return;
        }

        const headers = ['店铺名称', '店铺地址', '联系电话', '店长姓名', '创建时间', '描述'];
        const csvContent = [
            headers.join(','),
            ...this.stores.map(store => [
                store.name,
                store.address || '',
                store.phone || '',
                store.manager || '',
                new Date(store.createdAt).toLocaleString('zh-CN'),
                store.description || ''
            ].join(','))
        ].join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `店铺列表_${this.formatDate(new Date())}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        alert('✅ 店铺列表导出成功！');
    }

    // 格式化日期
    formatDate(date) {
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
}

// 初始化店铺管理中心
const storeCenter = new StoreCenterManager();

// 点击模态框外部关闭
window.onclick = function(event) {
    const modal = document.getElementById('storeModal');
    if (event.target === modal) {
        storeCenter.closeStoreModal();
    }
};

