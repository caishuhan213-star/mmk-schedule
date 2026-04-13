// Firebase实时同步管理器 - Firebase v9兼容版本
class FirebaseManager {
    constructor() {
        console.log('FirebaseManager v9构造函数调用');
        this.firestore = null;
        this.auth = null;
        this.user = null;
        this.isOnline = navigator.onLine;
        this.pendingSync = [];
        this.syncEnabled = true;
        this.syncStatus = 'disconnected';
        
        // 延迟初始化，避免阻塞页面加载
        setTimeout(() => {
            this.initFirebase();
        }, 1000);
        
        // 监听网络状态
        window.addEventListener('online', () => this.handleNetworkOnline());
        window.addEventListener('offline', () => this.handleNetworkOffline());
    }
    
    // 初始化Firebase
    async initFirebase() {
        console.log('开始初始化Firebase v9...');
        
        // 检查Firebase SDK是否加载
        if (typeof firebase === "undefined") {
            console.error("❌ Firebase SDK未加载！");
            this.syncStatus = "sdk-not-loaded";
            this.syncEnabled = false;
            this.showErrorStatus("SDK加载失败");
            return;
        }
        
        console.log('✅ Firebase SDK已加载');
        
        try {
            // 检查配置
            if (!firebaseConfig || !firebaseConfig.apiKey) {
                console.error('❌ Firebase配置缺失');
                this.syncStatus = 'config-error';
                this.showErrorStatus("配置错误");
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
            
            console.log('✅ Firestore和Auth实例已获取');
            
            // 设置初始状态
            this.syncStatus = 'connected';
            this.showSyncStatus();
            
            // 尝试匿名登录
            this.signInAnonymously();
            
        } catch (error) {
            console.error('❌ Firebase初始化失败:', error);
            this.syncStatus = 'error';
            this.showErrorStatus("初始化失败");
        }
    }
    
    // 匿名登录
    async signInAnonymously() {
        if (!this.auth) {
            console.warn('Auth未初始化，跳过匿名登录');
            return;
        }
        
        try {
            const userCredential = await this.auth.signInAnonymously();
            this.user = userCredential.user;
            console.log('✅ 匿名登录成功，用户ID:', this.user.uid.substring(0, 8) + '...');
            this.syncStatus = 'authenticated';
            this.showSyncStatus();
            
            // 测试Firestore连接
            this.testFirestoreConnection();
            
        } catch (error) {
            console.error('❌ 匿名登录失败:', error);
            this.syncStatus = 'auth-error';
            this.showErrorStatus("登录失败");
        }
    }
    
    // 测试Firestore连接
    async testFirestoreConnection() {
        if (!this.firestore || !this.user) {
            console.warn('Firestore或用户未就绪，跳过连接测试');
            return;
        }
        
        try {
            console.log('测试Firestore连接...');
            // 创建一个测试文档
            const testRef = this.firestore.collection('_test').doc('connection');
            await testRef.set({
                test: true,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                userId: this.user.uid
            });
            
            console.log('✅ Firestore连接测试成功');
            this.syncStatus = 'ready';
            this.showSyncStatus();
            
            // 清理测试文档
            await testRef.delete();
            
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
        this.syncStatus = 'connected';
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
        if (!statusElement) {
            console.warn('同步状态元素未找到');
            return;
        }
        
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
                statusText = '🟡 连接中...';
                statusClass = 'sync-status-syncing';
                break;
            case 'authenticated':
                statusText = '🟡 认证完成';
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
            userId: this.user ? this.user.uid : null
        };
    }
    
    // 同步排班数据到云端
    async syncSchedules(schedules, storeId = 'default') {
        if (!this.syncEnabled || !this.user || !this.firestore || this.syncStatus !== 'ready') {
            console.log('同步未就绪，跳过云端同步');
            return false;
        }
        
        console.log(`开始同步 ${schedules.length} 条排班记录到云端...`);
        
        try {
            const collectionRef = this.firestore.collection(`users/${this.user.uid}/stores/${storeId}/schedules`);
            
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
            const collectionRef = this.firestore.collection(`users/${this.user.uid}/stores/${storeId}/schedules`);
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
}
