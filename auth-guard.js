// auth-guard.js — 登录拦截 + 白名单校验
// 在每个页面的 <body> 最前面引入此文件

(function () {
    // =============================================
    // ⚙️ 配置：在这里添加/删除允许访问的 Google 邮箱
    // =============================================
    const ALLOWED_EMAILS = [
        'caishuhan213@gmail.com',
        'vincent.c0540@gmail.com',
    ];

    // 是否启用白名单（true = 只允许名单内的邮箱登录；false = 任何 Google 账号都能登录）
    const WHITELIST_ENABLED = ALLOWED_EMAILS.length > 0;

    // =============================================
    // 登录遮罩 HTML
    // =============================================
    const OVERLAY_ID = 'authOverlay';

    function createOverlay() {
        if (document.getElementById(OVERLAY_ID)) return;

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex; align-items: center; justify-content: center;
            z-index: 99999; flex-direction: column;
        `;
        overlay.innerHTML = `
            <div style="
                background: white; border-radius: 16px; padding: 48px 40px;
                text-align: center; max-width: 400px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            ">
                <div style="font-size: 48px; margin-bottom: 16px;">🔐</div>
                <h2 style="margin: 0 0 8px; font-size: 24px; color: #333;">内部系统登录</h2>
                <p style="margin: 0 0 32px; color: #888; font-size: 14px;">请使用授权的 Google 账号登录</p>
                <button id="authGuardLoginBtn" style="
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white; border: none; padding: 14px 32px; border-radius: 8px;
                    font-size: 16px; cursor: pointer; width: 100%; font-weight: bold;
                    transition: opacity 0.2s;
                " onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
                    🔑 使用 Google 账号登录
                </button>
                <p id="authGuardError" style="
                    margin: 16px 0 0; color: #e53e3e; font-size: 13px; display: none;
                "></p>
            </div>
        `;
        document.body.prepend(overlay);

        document.getElementById('authGuardLoginBtn').addEventListener('click', () => {
            triggerLogin();
        });
    }

    function hideOverlay() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.remove();
    }

    function showError(msg) {
        const el = document.getElementById('authGuardError');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
        }
    }

    // =============================================
    // 触发登录
    // =============================================
    function triggerLogin() {
        // 等待 firebaseManager 就绪后调用
        const tryLogin = (retries) => {
            if (window.firebaseManager && window.firebaseManager.signInWithGoogle) {
                window.firebaseManager.signInWithGoogle();
            } else if (retries > 0) {
                setTimeout(() => tryLogin(retries - 1), 500);
            } else {
                showError('Firebase 未初始化，请刷新页面重试');
            }
        };
        tryLogin(20);
    }

    // =============================================
    // 白名单校验
    // =============================================
    function isAllowed(email) {
        if (!WHITELIST_ENABLED) return true;
        return ALLOWED_EMAILS.some(e => e.toLowerCase() === email.toLowerCase());
    }

    // =============================================
    // 主逻辑：监听认证状态
    // =============================================
    function setupGuard() {
        // 先显示遮罩，等待认证结果
        if (document.body) {
            createOverlay();
        } else {
            document.addEventListener('DOMContentLoaded', createOverlay);
        }

        // 轮询等待 firebase.auth 就绪
        const waitForAuth = (retries) => {
            if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
                try {
                    const auth = firebase.auth();
                    auth.onAuthStateChanged((user) => {
                        if (user) {
                            if (isAllowed(user.email)) {
                                // 允许进入
                                hideOverlay();
                            } else {
                                // 不在白名单，强制登出
                                auth.signOut();
                                showError(`❌ 账号 ${user.email} 无权访问，请联系管理员`);
                            }
                        } else {
                            // 未登录，确保遮罩显示
                            createOverlay();
                        }
                    });
                } catch (e) {
                    console.error('auth-guard: firebase.auth() 调用失败', e);
                }
            } else if (retries > 0) {
                setTimeout(() => waitForAuth(retries - 1), 300);
            } else {
                console.error('auth-guard: Firebase 在超时内未初始化');
                showError('Firebase 加载超时，请刷新页面');
            }
        };

        // Firebase SDK 加载后最多等待 6 秒（20 次 × 300ms）
        waitForAuth(20);
    }

    // DOM 加载后启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupGuard);
    } else {
        setupGuard();
    }
})();
