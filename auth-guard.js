// auth-guard.js — 登录拦截 + 白名单校验
// 在每个页面的 <body> 最前面引入此文件

(function () {
    // =============================================
    // ⚙️ 配置：在这里添加/删除允许访问的 Google 邮箱
    // =============================================
    const ADMIN_EMAILS = [
        'caishuhan213@gmail.com',
    ];

    const STAFF_EMAILS = [
        'vincent.c0540@gmail.com',
    ];

    const ALLOWED_EMAILS = Array.from(new Set([...ADMIN_EMAILS, ...STAFF_EMAILS]));

    // 是否启用白名单（true = 只允许名单内的邮箱登录；false = 任何 Google 账号都能登录）
    const WHITELIST_ENABLED = ALLOWED_EMAILS.length > 0;

    function normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    function includesEmail(list, email) {
        const normalized = normalizeEmail(email);
        return list.some(item => normalizeEmail(item) === normalized);
    }

    function getRoleForEmail(email) {
        if (includesEmail(ADMIN_EMAILS, email)) return 'admin';
        if (includesEmail(STAFF_EMAILS, email)) return 'staff';
        return WHITELIST_ENABLED ? 'denied' : 'staff';
    }

    function publishRole(user) {
        const email = user && user.email ? user.email : '';
        const role = getRoleForEmail(email);

        window.MMK_CURRENT_USER_ROLE = role;
        window.MMK_CURRENT_USER_EMAIL = email;

        if (document.body) {
            document.body.dataset.accessRole = role;
            document.body.dataset.userEmail = email;
        }

        window.dispatchEvent(new CustomEvent('mmk-auth-role-change', {
            detail: { role, email }
        }));
    }

    window.MMK_ACCESS_CONTROL = {
        ADMIN_EMAILS,
        STAFF_EMAILS,
        getRoleForEmail,
        canWrite(email) {
            return getRoleForEmail(email) === 'admin';
        }
    };

    // =============================================
    // 登录遮罩 HTML
    // =============================================
    const OVERLAY_ID = 'authOverlay';
    const AUTH_OK_KEY = 'authGuardLastAllowedAt';
    let overlayTimer = null;

    function shouldDelayOverlay() {
        const lastAllowedAt = Number(sessionStorage.getItem(AUTH_OK_KEY) || 0);
        return lastAllowedAt && Date.now() - lastAllowedAt < 10 * 60 * 1000;
    }

    function scheduleOverlay() {
        if (overlayTimer || document.getElementById(OVERLAY_ID)) return;

        const delay = shouldDelayOverlay() ? 2500 : 700;
        overlayTimer = setTimeout(() => {
            overlayTimer = null;
            createOverlay();
        }, delay);
    }

    function cancelOverlayTimer() {
        if (overlayTimer) {
            clearTimeout(overlayTimer);
            overlayTimer = null;
        }
    }

    function createOverlay() {
        if (document.getElementById(OVERLAY_ID)) return;

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: color-mix(in srgb, var(--color-bg, #ffffff) 94%, var(--color-primary, #2563EB) 6%);
            display: flex; align-items: center; justify-content: center;
            z-index: 99999; flex-direction: column; padding: 24px;
            font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
        `;
        overlay.innerHTML = `
            <div style="
                background: var(--color-surface, #ffffff); border: 1px solid var(--color-border, #E5E7EB);
                border-radius: var(--radius-lg, 12px); padding: 32px;
                text-align: left; max-width: 420px; width: min(100%, 420px);
                box-shadow: var(--shadow-xl, 0 8px 24px rgba(0, 0, 0, 0.08));
            ">
                <div style="
                    display: inline-flex; align-items: center; gap: 8px;
                    padding: 6px 10px; border-radius: var(--radius-full, 9999px);
                    background: var(--color-primary-bg, rgba(37, 99, 235, 0.05));
                    color: var(--color-primary, #2563EB); font-size: var(--font-size-xs, 12px);
                    font-weight: 700; margin-bottom: 18px;
                ">排班系统</div>
                <h2 style="
                    margin: 0 0 8px; font-size: var(--font-size-2xl, 24px);
                    line-height: 1.25; color: var(--color-text, #1F2937);
                    font-weight: 700;
                ">内部系统登录</h2>
                <p style="
                    margin: 0 0 24px; color: var(--color-text-secondary, #4B5563);
                    font-size: var(--font-size-sm, 13px); line-height: 1.6;
                ">请使用授权的 Google 账号登录后继续操作。</p>
                <button id="authGuardLoginBtn" style="
                    background: var(--color-cta, #2563EB); color: white;
                    border: 1px solid var(--color-cta, #2563EB);
                    padding: 10px 16px; border-radius: var(--radius-md, 8px);
                    font-size: var(--font-size-sm, 13px); cursor: pointer; width: 100%;
                    font-weight: 700; transition: background var(--transition-fast, 120ms ease), border-color var(--transition-fast, 120ms ease);
                " onmouseover="this.style.background='var(--color-cta-dark, #1D4ED8)';this.style.borderColor='var(--color-cta-dark, #1D4ED8)'" onmouseout="this.style.background='var(--color-cta, #2563EB)';this.style.borderColor='var(--color-cta, #2563EB)'">
                    使用 Google 登录
                </button>
                <p id="authGuardError" style="
                    margin: 14px 0 0; color: var(--color-danger, #DC2626);
                    font-size: var(--font-size-xs, 12px); display: none;
                "></p>
            </div>
        `;
        document.body.prepend(overlay);

        document.getElementById('authGuardLoginBtn').addEventListener('click', () => {
            triggerLogin();
        });
    }

    function hideOverlay() {
        cancelOverlayTimer();
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.remove();
    }

    function showError(msg) {
        createOverlay();
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
        return getRoleForEmail(email) !== 'denied';
    }

    // =============================================
    // 主逻辑：监听认证状态
    // =============================================
    function setupGuard() {
        // 等待 Firebase 恢复登录态，避免已登录用户在页面跳转时看到登录遮罩闪一下
        if (document.body) {
            scheduleOverlay();
        } else {
            document.addEventListener('DOMContentLoaded', scheduleOverlay);
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
                                publishRole(user);
                                sessionStorage.setItem(AUTH_OK_KEY, String(Date.now()));
                                hideOverlay();
                            } else {
                                // 不在白名单，强制登出
                                auth.signOut();
                                showError(`账号 ${user.email} 无权访问，请联系管理员`);
                            }
                        } else {
                            // 未登录，确保遮罩显示
                            publishRole(null);
                            cancelOverlayTimer();
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
