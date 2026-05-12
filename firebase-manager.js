// Firebase实时同步管理器 - Firebase v9兼容版本（支持Google登录）
class FirebaseManager {
    constructor() {
        console.log('FirebaseManager v9 Google登录版构造函数调用');
        this.firestore = null;
        this.auth = null;
        this.user = null;
        this.isOnline = navigator.onLine;
        this.pendingSync = [];
        this.syncEnabled = true;
        this.syncStatus = 'disconnected';
        this.googleProvider = null;

        // 团队共享模式：所有登录用户共享同一份数据
        // 使用固定的团队 ID 替代 user.uid 作为数据路径
        this.teamId = 'shared';
        
        // 延迟初始化Firebase（但不自动登录）
        setTimeout(() => {
            this.initFirebase();
        }, 1000);
        
        // 监听网络状态
        window.addEventListener('online', () => this.handleNetworkOnline());
        window.addEventListener('offline', () => this.handleNetworkOffline());
    }
    
    // 初始化Firebase
    async initFirebase() {
        console.log('开始初始化Firebase v9（Google登录版）...');
        
        // 检查Firebase SDK是否加载
        if (typeof firebase === "undefined") {
            console.error("❌ Firebase SDK未加载！");
            this.syncStatus = "sdk-not-loaded";
            this.syncEnabled = false;
            this.showErrorStatus("SDK加载失败");
            this.updateLoginUI(); // 更新登录UI
            return;
        }
        
        console.log('✅ Firebase SDK已加载');
        
        try {
            // 检查配置
            if (!firebaseConfig || !firebaseConfig.apiKey) {
                console.error('❌ Firebase配置缺失');
                this.syncStatus = 'config-error';
                this.showErrorStatus("配置错误");
                this.updateLoginUI();
                return;
            }
            
            console.log('✅ Firebase配置有效');
            
            // 初始化Firebase应用（v9兼容模式）
            try {
                // 检查是否已经初始化
                if (firebase.apps.length > 0) {
                    console.log('Firebase应用已存在，使用现有实例');
                } else {
                    firebase.initializeApp(firebaseConfig);
                    console.log('✅ Firebase应用初始化成功');
                }
            } catch (initError) {
                // 如果初始化失败，可能是重复初始化
                if (initError.code === 'app/duplicate-app') {
                    console.log('Firebase应用已初始化（重复调用）');
                } else {
                    throw initError;
                }
            }
            
            // 获取Firestore和Auth实例（v9兼容模式）
            this.firestore = firebase.firestore();
            this.auth = firebase.auth();
            
            // 创建Google登录提供方
            this.googleProvider = new firebase.auth.GoogleAuthProvider();
            // 可选：添加scope
            this.googleProvider.addScope('profile');
            this.googleProvider.addScope('email');
            
            console.log('✅ Firestore、Auth实例和Google提供方已获取');
            
            // 设置初始状态
            this.syncStatus = 'connected';
            this.showSyncStatus();
            
            // 监听认证状态变化
            this.auth.onAuthStateChanged((user) => {
                this.handleAuthStateChanged(user);
            });
            
            // 更新登录UI
            this.updateLoginUI();
            
        } catch (error) {
            console.error('❌ Firebase初始化失败:', error);
            this.syncStatus = 'error';
            this.showErrorStatus("初始化失败");
            this.updateLoginUI();
        }
    }
    
    // 处理认证状态变化
    handleAuthStateChanged(user) {
        console.log('认证状态变化:', user ? `用户已登录 (${user.email})` : '用户未登录');
        this.user = user;
        
        if (user) {
            // 用户已登录
            console.log('✅ Google登录成功，用户:', user.email);
            console.log('用户ID:', user.uid.substring(0, 8) + '...');
            this.syncStatus = 'authenticated';
            this.showSyncStatus();
            
            // 测试Firestore连接
            this.testFirestoreConnection();
        } else {
            // 用户未登录
            this.syncStatus = 'connected';
            this.showSyncStatus();
        }
        
        // 更新登录UI
        this.updateLoginUI();
    }
    
    // Google登录
    async signInWithGoogle() {
        if (!this.auth) {
            console.error('❌ Auth未初始化');
            this.showErrorStatus("认证未初始化");
            return;
        }
        
        try {
            console.log('开始Google登录...');
            this.syncStatus = 'signing-in';
            this.showSyncStatus();
            
            const result = await this.auth.signInWithPopup(this.googleProvider);
            console.log('✅ Google登录成功');
            
            // handleAuthStateChanged会自动调用，所以这里不需要额外处理
            
        } catch (error) {
            console.error('❌ Google登录失败:', error);
            
            // 处理特定错误
            let errorMessage = "登录失败";
            let detailedHelp = "";
            
            if (error.code === 'auth/popup-blocked') {
                errorMessage = "弹窗被阻止，请允许弹窗";
                detailedHelp = "或者尝试点击这里使用重定向登录";
            } else if (error.code === 'auth/popup-closed-by-user') {
                errorMessage = "登录弹窗被关闭";
            } else if (error.code === 'auth/cancelled-popup-request') {
                errorMessage = "登录请求被取消";
            } else if (error.code === 'auth/unauthorized-domain') {
                errorMessage = "域名未授权";
                detailedHelp = "请在Firebase控制台 → Authentication → Sign-in method → Authorized domains 中添加: 'caishuhan213-star.github.io'（不带https://）";
            }
            
            this.syncStatus = 'auth-error';
            this.showErrorStatus(errorMessage);
            
            // 如果是域名错误，提供更多帮助
            if (error.code === 'auth/unauthorized-domain') {
                console.error('🔥 域名授权问题详情：');
                console.error('1. 请访问：https://console.firebase.google.com/');
                console.error('2. 选择项目：mmk1-4a2b7');
                console.error('3. 进入 Authentication → Sign-in method');
                console.error('4. 滚动到底部找到 "Authorized domains"');
                console.error('5. 添加域名：caishuhan213-star.github.io（不带https://）');
                console.error('6. 等待1-5分钟后重试');
                console.error('7. 清除浏览器缓存（Ctrl+F5）');
            }
            
            this.updateLoginUI();
        }
    }
    
    // 登出
    async signOut() {
        if (!this.auth) {
            console.warn('Auth未初始化，无法登出');
            return;
        }
        
        try {
            await this.auth.signOut();
            console.log('✅ 已登出');
            // handleAuthStateChanged会自动处理
        } catch (error) {
            console.error('❌ 登出失败:', error);
        }
    }
    
    // 更新登录UI
    updateLoginUI() {
        // 延迟执行以确保DOM已加载
        setTimeout(() => {
            const loginButton = document.getElementById('googleLoginBtn');
            const userInfo = document.getElementById('userInfo');
            const logoutButton = document.getElementById('logoutBtn');
            
            if (!loginButton || !userInfo || !logoutButton) {
                // 如果UI元素不存在，可能还没有创建，稍后重试
                return;
            }
            
            if (this.user) {
                // 用户已登录
                loginButton.style.display = 'none';
                userInfo.style.display = 'inline-block';
                logoutButton.style.display = 'inline-block';
                
                // 显示用户邮箱（前部分）
                const email = this.user.email;
                const displayEmail = email.length > 20 ? email.substring(0, 20) + '...' : email;
                userInfo.textContent = `👤 ${displayEmail}`;
                userInfo.title = `已登录: ${email}`;
                
            } else {
                // 用户未登录
                loginButton.style.display = 'inline-block';
                userInfo.style.display = 'none';
                logoutButton.style.display = 'none';
            }
        }, 100);
    }
    
    // 测试Firestore连接
    async testFirestoreConnection() {
        if (!this.firestore || !this.user) {
            console.warn('Firestore或用户未就绪，跳过连接测试');
            return;
        }
        
        try {
            console.log('测试Firestore连接...');
            // 使用轻量读取测试连接，避免每次登录都写入/删除文档触发额外同步压力
            await this.firestore.collection(`team/${this.teamId}/stores`).limit(1).get();
            
            console.log('✅ Firestore连接测试成功');
            this.syncStatus = 'ready';
            this.showSyncStatus();
            
        } catch (error) {
            console.error('❌ Firestore连接测试失败:', error);
            this.syncStatus = 'firestore-error';
            this.showErrorStatus("数据库连接失败");
            
            // 检查是否是安全规则问题
            if (error.code === 'permission-denied') {
                console.error('⚠️ 可能是安全规则问题，请检查Firestore规则');
                this.showErrorStatus("权限被拒绝，检查安全规则");
            }
        }
    }
    
    // 处理网络恢复
    handleNetworkOnline() {
        console.log('网络已恢复');
        this.isOnline = true;
        this.syncStatus = this.user ? 'authenticated' : 'connected';
        this.showSyncStatus();
    }
    
    // 处理网络断开
    handleNetworkOffline() {
        console.log('网络已断开');
        this.isOnline = false;
        this.syncStatus = 'offline';
        this.showSyncStatus();
    }
    
    // 显示错误状态
    showErrorStatus(message) {
        console.log('显示错误状态:', message);
        const statusElement = document.getElementById('syncStatus');
        if (statusElement) {
            statusElement.innerHTML = `❌ ${message}`;
            statusElement.className = 'sync-status sync-status-error';
            statusElement.title = '点击查看控制台错误详情';
            statusElement.style.cursor = 'pointer';
        }
    }
    
    // 显示同步状态
    showSyncStatus() {
        const statusElement = document.getElementById('syncStatus');
        if (!statusElement) return;
        
        let statusText = '🟢 已同步';
        let statusClass = 'sync-status-connected';
        
        switch (this.syncStatus) {
            case 'disconnected':
                statusText = '🔴 未连接';
                statusClass = 'sync-status-offline';
                break;
            case 'sdk-not-loaded':
                statusText = '❌ SDK加载失败';
                statusClass = 'sync-status-error';
                break;
            case 'config-error':
                statusText = '❌ 配置错误';
                statusClass = 'sync-status-error';
                break;
            case 'connected':
                statusText = '🔵 已连接（请登录）';
                statusClass = 'sync-status-offline';
                break;
            case 'signing-in':
                statusText = '🟡 登录中...';
                statusClass = 'sync-status-syncing';
                break;
            case 'authenticated':
                statusText = '🟡 已认证';
                statusClass = 'sync-status-syncing';
                break;
            case 'ready':
                statusText = '🟢 已就绪';
                statusClass = 'sync-status-connected';
                break;
            case 'offline':
                statusText = '🔴 离线';
                statusClass = 'sync-status-offline';
                break;
            case 'error':
                statusText = '❌ 错误';
                statusClass = 'sync-status-error';
                break;
            case 'auth-error':
                statusText = '❌ 登录失败';
                statusClass = 'sync-status-error';
                break;
            case 'firestore-error':
                statusText = '❌ 数据库错误';
                statusClass = 'sync-status-error';
                break;
            default:
                statusText = `🟡 ${this.syncStatus}`;
                statusClass = 'sync-status-syncing';
        }
        
        statusElement.innerHTML = statusText;
        statusElement.className = `sync-status ${statusClass}`;
    }
    
    // 获取同步状态
    getSyncStatus() {
        return {
            enabled: this.syncEnabled,
            status: this.syncStatus,
            online: this.isOnline,
            authenticated: !!this.user,
            pendingSync: this.pendingSync.length,
            userId: this.user ? this.user.uid : null,
            userEmail: this.user ? this.user.email : null
        };
    }
    
    // ======================
    // 以下同步方法与原始版本相同
    // ======================
    
    // 同步排班数据到云端
    async syncSchedules(schedules, storeId = 'default') {
        if (!this.syncEnabled || !this.user || !this.firestore || this.syncStatus !== 'ready') {
            console.log('同步未就绪，跳过云端同步');
            return false;
        }
        
        console.log(`开始同步 ${schedules.length} 条排班记录到云端...`);
        
        try {
            const collectionRef = this.firestore.collection(`team/${this.teamId}/stores/${storeId}/schedules`);
            
            // 使用批处理
            const batch = this.firestore.batch();
            
            // 添加所有文档
            schedules.forEach(schedule => {
                const docRef = collectionRef.doc(schedule.id);
                batch.set(docRef, {
                    ...schedule,
                    storeId: storeId,
                    userId: this.user.uid,
                    syncedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: Date.now()
                });
            });
            
            await batch.commit();
            console.log(`✅ 排班数据同步成功: ${schedules.length}条记录`);
            return true;
            
        } catch (error) {
            console.error('❌ 排班数据同步失败:', error);
            return false;
        }
    }
    
    // 从云端加载排班数据
    async loadSchedules(storeId = 'default') {
        if (!this.syncEnabled || !this.user || !this.firestore || this.syncStatus !== 'ready') {
            console.log('同步未就绪，使用本地数据');
            return null;
        }
        
        try {
            const collectionRef = this.firestore.collection(`team/${this.teamId}/stores/${storeId}/schedules`);
            const querySnapshot = await collectionRef.get();
            
            const schedules = [];
            querySnapshot.forEach(doc => {
                const data = doc.data();
                // 移除Firebase特有的字段
                const { storeId: _, userId: __, syncedAt: ___, updatedAt: ____, ...schedule } = data;
                schedules.push(schedule);
            });
            
            console.log(`✅ 从云端加载排班数据: ${schedules.length}条记录`);
            return schedules;
            
        } catch (error) {
            console.error('❌ 从云端加载排班数据失败:', error);
            return null;
        }
    }
    
    // 通用同步方法：同步任意集合到云端
    async syncCollection(collectionName, dataArray, storeId = 'default') {
        if (!this.syncEnabled || !this.user || !this.firestore || this.syncStatus !== 'ready') {
            console.log(`同步未就绪，跳过${collectionName}云端同步`);
            return false;
        }
        
        console.log(`开始同步 ${dataArray.length} 条${collectionName}记录到云端...`);
        
        try {
            const collectionRef = this.firestore.collection(`team/${this.teamId}/stores/${storeId}/${collectionName}`);
            
            // 使用批处理
            const batch = this.firestore.batch();
            
            // 添加所有文档
            dataArray.forEach(item => {
                const docRef = collectionRef.doc(item.id || this.generateId(item));
                batch.set(docRef, {
                    ...item,
                    storeId: storeId,
                    userId: this.user.uid,
                    syncedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: Date.now()
                });
            });
            
            await batch.commit();
            console.log(`✅ ${collectionName}数据同步成功: ${dataArray.length}条记录`);
            return true;
            
        } catch (error) {
            console.error(`❌ ${collectionName}数据同步失败:`, error);
            return false;
        }
    }
    
    // 通用加载方法：从云端加载任意集合
    async loadCollection(collectionName, storeId = 'default') {
        if (!this.syncEnabled || !this.user || !this.firestore || this.syncStatus !== 'ready') {
            console.log('同步未就绪，使用本地数据');
            return null;
        }
        
        try {
            const collectionRef = this.firestore.collection(`team/${this.teamId}/stores/${storeId}/${collectionName}`);
            const querySnapshot = await collectionRef.get();
            
            const items = [];
            querySnapshot.forEach(doc => {
                const data = doc.data();
                // 移除Firebase特有的字段
                const { storeId: _, userId: __, syncedAt: ___, updatedAt: ____, ...item } = data;
                items.push(item);
            });
            
            console.log(`✅ 从云端加载${collectionName}数据: ${items.length}条记录`);
            return items;
            
        } catch (error) {
            console.error(`❌ 从云端加载${collectionName}数据失败:`, error);
            return null;
        }
    }
    
    // 监听集合变化（实时同步）
    subscribeToCollection(collectionName, storeId = 'default', callback) {
        if (!this.syncEnabled || !this.user || !this.firestore || this.syncStatus !== 'ready') {
            console.log('同步未就绪，无法监听');
            return () => {};
        }
        
        try {
            const collectionRef = this.firestore.collection(`team/${this.teamId}/stores/${storeId}/${collectionName}`);
            
            return collectionRef.onSnapshot((snapshot) => {
                const changes = snapshot.docChanges();
                if (changes.length > 0) {
                    const updatedItems = changes.map(change => ({
                        type: change.type, // 'added', 'modified', 'removed'
                        id: change.doc.id,
                        data: change.doc.data()
                    }));
                    callback(updatedItems);
                }
            });
        } catch (error) {
            console.error(`❌ 监听${collectionName}变化失败:`, error);
            return () => {};
        }
    }
    
    // 生成ID（如果数据没有id字段）
    generateId(item) {
        // 如果有id字段，使用它
        if (item.id) return item.id;

        // commissionConfigs使用复合键生成确定性ID
        if (item.employeeName && item.projectName) {
            return `${item.employeeName}_${item.projectName}`;
        }

        // 否则生成一个基于时间和随机数的ID
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
}

// 创建全局实例
window.firebaseManager = new FirebaseManager();
