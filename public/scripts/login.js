import { initAccessibility } from './a11y.js';

/**
 * CSRF token for requests.
 */
let csrfToken = '';
let errorContactPrompt = '';
const PANEL_ANIM_MS = 220;
const VALID_HANDLE_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;

/**
 * Gets a CSRF token from the server.
 * @returns {Promise<string>} CSRF token
 */
async function getCsrfToken() {
    const response = await fetch('/csrf-token');
    const data = await response.json();
    return data.token;
}

/**
 * Gets initial login state (captcha requirement, registration availability, and community prompt config) from the server.
 * @returns {Promise<{requireCaptcha?: boolean, enableUserRegistration?: boolean, communityPrompt?: {enabled?: boolean, loginJumpUrl?: string, errorContactPrompt?: string}}>}
 */
async function getLoginState() {
    try {
        const response = await fetch('/api/users/login-state');
        if (!response.ok) {
            return {};
        }
        return await response.json();
    } catch {
        return {};
    }
}

async function refreshCaptcha(imgId) {
    const timestamp = new Date().getTime();
    $(`#${imgId}`).attr('src', `/api/users/captcha?t=${timestamp}`);
}

function showFlexBlock(selector) {
    const block = $(selector);
    if (block.is(':visible')) {
        block.css('display', 'flex');
        return;
    }
    block.stop(true, true).css('display', 'flex').hide().fadeIn(PANEL_ANIM_MS);
}

function hideBlock(selector) {
    $(selector).stop(true, true).fadeOut(PANEL_ANIM_MS);
}

function swapBlocks(hideSelectors, showSelectors) {
    for (const selector of hideSelectors) {
        hideBlock(selector);
    }

    window.setTimeout(() => {
        for (const selector of showSelectors) {
            showFlexBlock(selector);
        }
    }, Math.floor(PANEL_ANIM_MS * 0.45));
}

function initMouseGlow() {
    const body = document.body;
    const updateGlow = (x, y) => {
        body.style.setProperty('--mouse-x', `${x}px`);
        body.style.setProperty('--mouse-y', `${y}px`);
    };

    updateGlow(window.innerWidth / 2, window.innerHeight / 2);

    window.addEventListener('pointermove', (event) => {
        updateGlow(event.clientX, event.clientY);
    }, { passive: true });
}

function toggleRegister() {
    const isRegistering = $('#registerBlock').is(':visible');
    if (isRegistering) {
        swapBlocks(['#registerBlock', '#passwordRecoveryBlock'], ['#handleEntryBlock', '#passwordEntryBlock']);
        $('#discreetLoginPrompt').text('使用用户句柄登录');
        displayError('');
    } else {
        swapBlocks(['#handleEntryBlock', '#passwordEntryBlock', '#passwordRecoveryBlock'], ['#registerBlock']);
        $('#discreetLoginPrompt').text('创建账户');
        refreshCaptcha('regCaptchaImage');
        displayError('');
    }
}

async function performRegister() {
    const handle = String($('#regHandle').val() ?? '').trim();
    const password = String($('#regPassword').val() ?? '');
    const confirmPassword = String($('#regPasswordConfirm').val() ?? '');
    const captcha = String($('#regCaptcha').val() ?? '').trim();

    if (!handle || !password || !confirmPassword || !captcha) {
        return displayError('请填写所有字段');
    }

    if (!VALID_HANDLE_REGEX.test(handle)) {
        return displayError('用户名只能包含字母、数字、下划线或连字符，且需以字母或数字开头（1-32位）');
    }

    if (password !== confirmPassword) {
        return displayError('密码不匹配');
    }

    try {
        const response = await fetch('/api/users/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ handle, password, captcha }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            refreshCaptcha('regCaptchaImage');
            $('#regCaptcha').val('');
            return displayError(errorData.error || '注册失败，请重试', response.status >= 500);
        }

        const data = await response.json();
        if (data.handle) {
            console.log(`Successfully registered as ${data.handle}!`);
            redirectToHome();
        }
    } catch (error) {
        console.error('Error registering:', error);
        displayError(String(error), true);
    }
}

/**
 * Requests a recovery code for the user.
 * @param {string} handle User handle
 * @returns {Promise<void>}
 */
async function sendRecoveryPart1(handle) {
    const cleanHandle = String(handle ?? '').trim();
    if (!cleanHandle) {
        return displayError('请先输入用户句柄(用户名)');
    }

    const response = await fetch('/api/users/recover-step1', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ handle: cleanHandle }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return displayError(errorData.error || '请求恢复码失败', response.status >= 500);
    }

    showRecoveryBlock();
}

/**
 * Sets a new password for the user using the recovery code.
 * @param {string} handle User handle
 * @param {string} code Recovery code
 * @param {string} newPassword New password
 * @returns {Promise<void>}
 */
async function sendRecoveryPart2(handle, code, newPassword) {
    const cleanHandle = String(handle ?? '').trim();
    const cleanCode = String(code ?? '').trim();
    if (!cleanHandle || !cleanCode) {
        return displayError('请填写用户名和恢复码');
    }

    const recoveryData = {
        handle: cleanHandle,
        code: cleanCode,
        newPassword,
    };

    const response = await fetch('/api/users/recover-step2', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(recoveryData),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return displayError(errorData.error || '密码恢复失败', response.status >= 500);
    }

    console.log(`Successfully recovered password for ${cleanHandle}!`);
    await performLogin(cleanHandle, newPassword);
}

/**
 * Attempts to log in the user.
 * @param {string} handle User's handle
 * @param {string} password User's password
 * @returns {Promise<void>}
 */
async function performLogin(handle, password) {
    const cleanHandle = String(handle ?? '').trim();
    if (!cleanHandle) {
        return displayError('请输入用户句柄(用户名)');
    }

    const captcha = String($('#loginCaptcha').val() ?? '').trim();
    const userInfo = {
        handle: cleanHandle,
        password: password,
        captcha: captcha,
    };

    try {
        const response = await fetch('/api/users/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify(userInfo),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));

            if (errorData.requireCaptcha) {
                showFlexBlock('#loginCaptchaBlock');
                refreshCaptcha('loginCaptchaImage');
                $('#loginCaptcha').val('');
            }

            return displayError(errorData.error || '登录失败，请检查用户名和密码', response.status >= 500);
        }

        const data = await response.json();

        if (data.handle) {
            console.log(`Successfully logged in as ${data.handle}!`);
            redirectToHome();
        }
    } catch (error) {
        console.error('Error logging in:', error);
        displayError(String(error), true);
    }
}

/**
 * Displays an error message to the user.
 * @param {string} message Error message
 * @param {boolean} [appendContact=false] Whether to append the configured errorContactPrompt
 */
function displayError(message, appendContact = false) {
    if (!message) {
        $('#errorMessage').text('');
        return;
    }
    const finalMessage = (appendContact && errorContactPrompt)
        ? `${message}（${errorContactPrompt}）`
        : message;
    $('#errorMessage').text(finalMessage);
}

/**
 * Redirects the user to the home page.
 * Preserves the query string.
 */
function redirectToHome() {
    // Create a URL object based on the current location
    const currentUrl = new URL(window.location.href);

    // After a login there's no need to preserve the
    // noauto parameter (if present)
    currentUrl.searchParams.delete('noauto');

    // Set the pathname to root and keep the updated query string
    currentUrl.pathname = '/';

    // Redirect to the new URL
    window.location.href = currentUrl.toString();
}

/**
 * Hides the password entry block and shows the password recovery block.
 */
function showRecoveryBlock() {
    swapBlocks(['#passwordEntryBlock', '#registerBlock'], ['#passwordRecoveryBlock']);
    $('#discreetLoginPrompt').text('找回密码');
    displayError('');
}

/**
 * Hides the password recovery block and shows the password entry block.
 */
function onCancelRecoveryClick() {
    swapBlocks(['#passwordRecoveryBlock'], ['#handleEntryBlock', '#passwordEntryBlock']);
    $('#discreetLoginPrompt').text('使用用户句柄登录');
    displayError('');
}

/**
 * Configures the login page for discreet login.
 */
function configureDiscreetLogin() {
    console.log('Discreet login is enabled');
    $('#handleEntryBlock').css('display', 'flex');
    $('#normalLoginPrompt').hide();
    $('#discreetLoginPrompt').show();
    $('#userList').hide();
    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').css('display', 'flex');

    $('#loginButton').off('click').on('click', async () => {
        const handle = String($('#userHandle').val() ?? '');
        const password = String($('#userPassword').val() ?? '');
        await performLogin(handle, password);
    });

    $('#recoverPassword').off('click').on('click', async () => {
        const handle = String($('#userHandle').val() ?? '');
        await sendRecoveryPart1(handle);
    });

    $('#sendRecovery').off('click').on('click', async () => {
        const handle = String($('#userHandle').val() ?? '');
        const code = String($('#recoveryCode').val() ?? '');
        const newPassword = String($('#newPassword').val() ?? '');
        await sendRecoveryPart2(handle, code, newPassword);
    });

    $('#showRegister').off('click').on('click', toggleRegister);
    $('#cancelRegister').off('click').on('click', toggleRegister);
    $('#registerButton').off('click').on('click', performRegister);

    $('#loginCaptchaImage').off('click').on('click', () => refreshCaptcha('loginCaptchaImage'));
    $('#regCaptchaImage').off('click').on('click', () => refreshCaptcha('regCaptchaImage'));
}

/**
 * Applies optional community prompt settings from config.yaml.
 * @param {{enabled?: boolean, loginJumpUrl?: string, errorContactPrompt?: string}} [communityPrompt]
 */
function applyCommunityPromptConfig(communityPrompt) {
    if (!communityPrompt?.enabled) {
        $('#communityJumpLink').hide();
        return;
    }

    const jumpUrl = String(communityPrompt.loginJumpUrl ?? '').trim();
    if (jumpUrl) {
        $('#communityJumpLink').attr('href', jumpUrl).show();
    } else {
        $('#communityJumpLink').hide();
    }

    errorContactPrompt = String(communityPrompt.errorContactPrompt ?? '').trim();
    if (errorContactPrompt) {
        $('#recoverMessage').text(`目前仅支持管理员协助恢复，请向管理员索要恢复码（${errorContactPrompt}）`);
        $('#recoveryCode').attr('placeholder', `恢复码（${errorContactPrompt}）`);
    }
}

(async function () {
    initAccessibility();

    const [token, loginState] = await Promise.all([
        getCsrfToken(),
        getLoginState(),
    ]);
    csrfToken = token;

    // Force discreet login flow: do NOT request or display user list.
    // This prevents any call to /api/users/list from the login page and
    // always shows the handle + password inputs instead.
    configureDiscreetLogin();
    applyCommunityPromptConfig(loginState.communityPrompt);

    if (loginState.enableUserRegistration === false) {
        $('#showRegisterContainer').hide();
    }

    if (loginState.requireCaptcha) {
        showFlexBlock('#loginCaptchaBlock');
        refreshCaptcha('loginCaptchaImage');
    }

    initMouseGlow();
    document.getElementById('shadow_popup').style.opacity = '';
    $('#cancelRecovery').on('click', onCancelRecoveryClick);
    $(document).on('keydown', (evt) => {
        if (evt.key === 'Enter' && document.activeElement?.tagName === 'INPUT') {
            if ($('#passwordRecoveryBlock').is(':visible')) {
                $('#sendRecovery').trigger('click');
            } else if ($('#registerBlock').is(':visible')) {
                $('#registerButton').trigger('click');
            } else {
                $('#loginButton').trigger('click');
            }
        }
    });
})();
