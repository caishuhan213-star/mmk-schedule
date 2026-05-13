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
        '751496696@qq.com',
    ];

    const ALLOWED_EMAILS = Array.from(new Set([...ADMIN_EMAILS, ...STAFF_EMAILS]));

    // 是否启用白名单（true = 只允许名单内的邮箱登录；false = 任何 Google 账号都能登录）
    const WHITELIST_ENABLED = ALLOWED_EMAILS.length > 0;

    function normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    function getUserEmail(user) {
        if (!user) return '';
        if (user.email) return user.email;
        const provider = Array.isArray(user.providerData)
            ? user.providerData.find(item => item && item.email)
            : null;
        return provider ? provider.email : '';
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
        const email = getUserEmail(user);
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

        if (window.firebaseManager && window.firebaseManager.updateLoginUI) {
            window.firebaseManager.updateLoginUI();
        }
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
    let authStateResolved = false;

    function shouldDelayOverlay() {
        const lastAllowedAt = Number(sessionStorage.getItem(AUTH_OK_KEY) || 0);
        return lastAllowedAt && Date.now() - lastAllowedAt < 10 * 60 * 1000;
    }

    function scheduleOverlay(delayOverride) {
        if (overlayTimer || document.getElementById(OVERLAY_ID)) return;

        const delay = typeof delayOverride === 'number'
            ? delayOverride
            : (shouldDelayOverlay() ? 4000 : 8000);
        overlayTimer = setTimeout(() => {
            overlayTimer = null;
            if (authStateResolved) return;
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
                    margin: 0 0 20px; color: var(--color-text-secondary, #4B5563);
                    font-size: var(--font-size-sm, 13px); line-height: 1.6;
                ">请使用授权邮箱登录后继续操作。</p>
                <form id="authGuardEmailForm" style="display: grid; gap: 12px; margin: 0;">
                    <input id="authGuardEmail" type="email" autocomplete="email" placeholder="邮箱地址" required style="
                        width: 100%; box-sizing: border-box; border: 1px solid var(--color-border, #E5E7EB);
                        border-radius: var(--radius-md, 8px); padding: 10px 12px;
                        font-size: var(--font-size-sm, 13px); color: var(--color-text, #1F2937);
                        background: var(--color-surface, #ffffff);
                    ">
                    <input id="authGuardPassword" type="password" autocomplete="current-password" placeholder="密码" required style="
                        width: 100%; box-sizing: border-box; border: 1px solid var(--color-border, #E5E7EB);
                        border-radius: var(--radius-md, 8px); padding: 10px 12px;
                        font-size: var(--font-size-sm, 13px); color: var(--color-text, #1F2937);
                        background: var(--color-surface, #ffffff);
                    ">
                    <button id="authGuardEmailLoginBtn" type="submit" style="
                        background: var(--color-cta, #2563EB); color: white;
                        border: 1px solid var(--color-cta, #2563EB);
                        padding: 10px 16px; border-radius: var(--radius-md, 8px);
                        font-size: var(--font-size-sm, 13px); cursor: pointer; width: 100%;
                        font-weight: 700; transition: background var(--transition-fast, 120ms ease), border-color var(--transition-fast, 120ms ease);
                    " onmouseover="this.style.background='var(--color-cta-dark, #1D4ED8)';this.style.borderColor='var(--color-cta-dark, #1D4ED8)'" onmouseout="this.style.background='var(--color-cta, #2563EB)';this.style.borderColor='var(--color-cta, #2563EB)'">
                        邮箱密码登录
                    </button>
                </form>
                <button id="authGuardResetBtn" type="button" style="
                    margin-top: 10px; background: transparent; color: var(--color-primary, #2563EB);
                    border: 0; padding: 4px 0; font-size: var(--font-size-xs, 12px);
                    cursor: pointer; font-weight: 600;
                ">忘记密码？发送重置邮件</button>
                <div style="
                    display: flex; align-items: center; gap: 10px; margin: 16px 0;
                    color: var(--color-text-tertiary, #6B7280); font-size: var(--font-size-xs, 12px);
                ">
                    <span style="height: 1px; flex: 1; background: var(--color-border, #E5E7EB);"></span>
                    <span>或</span>
                    <span style="height: 1px; flex: 1; background: var(--color-border, #E5E7EB);"></span>
                </div>
                <button id="authGuardLoginBtn" type="button" style="
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

        document.getElementById('authGuardEmailForm').addEventListener('submit', (event) => {
            event.preventDefault();
            triggerEmailPasswordLogin();
        });

        document.getElementById('authGuardResetBtn').addEventListener('click', () => {
            triggerPasswordReset();
        });

        document.getElementById('authGuardLoginBtn').addEventListener('click', () => {
            triggerGoogleLogin();
        });
    }

    function hideOverlay() {
        cancelOverlayTimer();
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.remove();
    }

    function showError(msg) {
        showMessage(msg, 'error');
    }

    function showInfo(msg) {
        showMessage(msg, 'info');
    }

    function showMessage(msg, type) {
        createOverlay();
        const el = document.getElementById('authGuardError');
        if (el) {
            el.textContent = msg;
            el.style.color = type === 'info'
                ? 'var(--color-primary, #2563EB)'
                : 'var(--color-danger, #DC2626)';
            el.style.display = 'block';
        }
    }

    function showLoginOverlay() {
        cancelOverlayTimer();
        createOverlay();
        const emailInput = document.getElementById('authGuardEmail');
        if (emailInput) emailInput.focus();
    }

    window.MMK_SHOW_LOGIN = showLoginOverlay;

    // =============================================
    // 触发登录
    // =============================================
    function triggerGoogleLogin() {
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

    function triggerEmailPasswordLogin() {
        const emailInput = document.getElementById('authGuardEmail');
        const passwordInput = document.getElementById('authGuardPassword');
        const submitButton = document.getElementById('authGuardEmailLoginBtn');
        const email = emailInput ? emailInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';

        const tryLogin = (retries) => {
            if (window.firebaseManager && window.firebaseManager.signInWithEmailPassword) {
                if (submitButton) {
                    submitButton.disabled = true;
                    submitButton.textContent = '登录中...';
                    submitButton.style.opacity = '0.72';
                    submitButton.style.cursor = 'wait';
                }

                window.firebaseManager.signInWithEmailPassword(email, password)
                    .catch(error => {
                        showError(error && error.message ? error.message : '邮箱密码登录失败');
                    })
                    .finally(() => {
                        if (submitButton) {
                            submitButton.disabled = false;
                            submitButton.textContent = '邮箱密码登录';
                            submitButton.style.opacity = '1';
                            submitButton.style.cursor = 'pointer';
                        }
                    });
            } else if (retries > 0) {
                setTimeout(() => tryLogin(retries - 1), 500);
            } else {
                showError('Firebase 未初始化，请刷新页面重试');
            }
        };
        tryLogin(20);
    }

    function triggerPasswordReset() {
        const emailInput = document.getElementById('authGuardEmail');
        const email = emailInput ? emailInput.value.trim() : '';

        if (!email) {
            showError('请先输入邮箱地址');
            if (emailInput) emailInput.focus();
            return;
        }

        const tryReset = (retries) => {
            if (window.firebaseManager && window.firebaseManager.sendPasswordReset) {
                window.firebaseManager.sendPasswordReset(email)
                    .then(() => {
                        showInfo('重置密码邮件已发送，请检查邮箱');
                    })
                    .catch(error => {
                        showError(error && error.message ? error.message : '重置邮件发送失败');
                    });
            } else if (retries > 0) {
                setTimeout(() => tryReset(retries - 1), 500);
            } else {
                showError('Firebase 未初始化，请刷新页面重试');
            }
        };
        tryReset(20);
    }

    // =============================================
    // 白名单校验
    // =============================================
    function isAllowed(email) {
        if (!WHITELIST_ENABLED) return true;
        return getRoleForEmail(email) !== 'denied';
    }

    function ensureLocalPersistence(auth) {
        if (!auth || !auth.setPersistence || !firebase.auth.Auth || !firebase.auth.Auth.Persistence) {
            return Promise.resolve();
        }

        return auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
            .catch(error => {
                console.warn('auth-guard: 本地登录保持设置失败，将继续使用默认登录状态', error);
            });
    }

    // =============================================
    // 主逻辑：监听认证状态
    // =============================================
    function setupGuard() {
        // 等待 Firebase 恢复登录态，避免已登录用户在页面跳转时看到登录遮罩闪一下
        if (document.body) {
            scheduleOverlay(8000);
        } else {
            document.addEventListener('DOMContentLoaded', () => scheduleOverlay(8000));
        }

        // 轮询等待 firebase.auth 就绪
        const waitForAuth = (retries) => {
            if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
                try {
                    const auth = firebase.auth();
                    ensureLocalPersistence(auth).finally(() => auth.onAuthStateChanged((user) => {
                        authStateResolved = true;
                        if (user) {
                            const email = getUserEmail(user);
                            if (email && isAllowed(email)) {
                                // 允许进入
                                publishRole(user);
                                sessionStorage.setItem(AUTH_OK_KEY, String(Date.now()));
                                hideOverlay();
                            } else if (!email) {
                                console.warn('auth-guard: 当前用户没有可识别邮箱，暂不强制登出', user);
                                publishRole(null);
                                showError('当前账号没有可识别邮箱，请刷新页面或重新登录');
                            } else {
                                // 不在白名单，强制登出
                                auth.signOut();
                                showError(`账号 ${email} 无权访问，请联系管理员`);
                            }
                        } else {
                            // 未登录，确保遮罩显示
                            publishRole(null);
                            cancelOverlayTimer();
                            createOverlay();
                        }
                    }));
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
