import { initAccessibility } from './a11y.js';

/**
 * CSRF token for requests.
 */
let csrfToken = '';
let errorContactPrompt = '';
let loginCaptchaRequired = false;
const PANEL_ANIM_MS = 220;
const VALID_HANDLE_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** @type {Record<string, string>} */
let loginLocaleData = {};
let activeLocale = 'zh-cn';

/**
 * Cloudflare Turnstile runtime state.
 */
let turnstileConfig = {
    enabled: false,
    siteKey: '',
};
/** @type {Promise<void>|null} */
let turnstileScriptPromise = null;
/** @type {string|null} */
let loginTurnstileWidgetId = null;
/** @type {string|null} */
let regTurnstileWidgetId = null;
let loginTurnstileToken = '';
let regTurnstileToken = '';

/**
 * Translates a key using the loaded locale dictionary, or falls back to the English key itself.
 * @param {string} key English translation key
 * @returns {string}
 */
function translate(key) {
    if (!key) {
        return '';
    }
    if (activeLocale.startsWith('en')) {
        return key;
    }
    return loginLocaleData?.[key] || key;
}

/**
 * Tagged template literal helper matching SillyTavern's `t` function.
 * @param {TemplateStringsArray} strings
 * @param  {...any} values
 * @returns {string}
 */
function t(strings, ...values) {
    const str = strings.reduce((result, string, i) => result + string + (values[i] !== undefined ? `\${${i}}` : ''), '');
    const translatedStr = translate(str);
    return translatedStr.replace(/\$\{(\d+)\}/g, (_match, index) => values[index]);
}

/**
 * Translates a DOM element with `data-i18n` attributes (supports `[attr]Key` and plain text keys).
 * @param {Element} element
 */
function translateElement(element) {
    const rawAttr = element.getAttribute('data-i18n');
    if (!rawAttr) {
        return;
    }
    const keys = rawAttr.split(';');
    for (const key of keys) {
        const attributeMatch = key.match(/^\[(\S+)\](.+)$/);
        if (attributeMatch) {
            const attrName = attributeMatch[1];
            const lookupKey = attributeMatch[2];
            const localizedValue = translate(lookupKey);
            if (localizedValue) {
                element.setAttribute(attrName, localizedValue);
            }
        } else {
            const localizedValue = translate(key);
            if (localizedValue) {
                element.textContent = localizedValue;
            }
        }
    }
}

/**
 * Loads the locale dictionary for the login page and translates all `[data-i18n]` elements.
 * @param {string} [defaultLang='zh-cn']
 */
async function initLoginLocales(defaultLang = 'zh-cn') {
    const storedLang = localStorage.getItem('language');
    const rawLang = String(storedLang || defaultLang || navigator.language || 'zh-cn').toLowerCase();

    try {
        const langsResponse = await fetch('/locales/lang.json');
        const langs = langsResponse.ok ? await langsResponse.json() : [];
        const exactMatch = Array.isArray(langs) ? langs.find(x => x.lang === rawLang) : null;
        if (exactMatch) {
            activeLocale = exactMatch.lang;
        } else if (rawLang.startsWith('zh-tw') || rawLang.startsWith('zh-hk') || rawLang.startsWith('zh-hant')) {
            activeLocale = 'zh-tw';
        } else if (rawLang.startsWith('zh')) {
            activeLocale = 'zh-cn';
        } else if (rawLang.startsWith('en')) {
            activeLocale = 'en';
        } else {
            activeLocale = defaultLang || 'zh-cn';
        }

        document.documentElement.lang = activeLocale;

        if (!activeLocale.startsWith('en')) {
            const localeResponse = await fetch(`/locales/${activeLocale}.json`);
            if (localeResponse.ok) {
                loginLocaleData = await localeResponse.json();
            }
        }
    } catch (error) {
        console.warn('Failed to load login locale data:', error);
    }

    document.querySelectorAll('[data-i18n]').forEach(el => translateElement(el));
}

/**
 * Dynamically loads the Cloudflare Turnstile script when Turnstile is enabled.
 * @returns {Promise<void>}
 */
function loadTurnstileScript() {
    if (window.turnstile) {
        return Promise.resolve();
    }
    if (turnstileScriptPromise) {
        return turnstileScriptPromise;
    }

    turnstileScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => {
            turnstileScriptPromise = null;
            reject(new Error(t`Failed to load Turnstile widget, please check your network connection`));
        };
        document.head.appendChild(script);
    });

    return turnstileScriptPromise;
}

/**
 * Renders or resets the Cloudflare Turnstile widget for either 'login' or 'register'.
 * @param {'login'|'register'} mode
 */
async function ensureTurnstileWidget(mode) {
    if (!turnstileConfig.enabled || !turnstileConfig.siteKey) {
        return;
    }

    try {
        await loadTurnstileScript();
        if (!window.turnstile) {
            return;
        }

        if (mode === 'login') {
            loginTurnstileToken = '';
            if (loginTurnstileWidgetId !== null) {
                window.turnstile.reset(loginTurnstileWidgetId);
            } else {
                loginTurnstileWidgetId = window.turnstile.render('#loginTurnstileContainer', {
                    sitekey: turnstileConfig.siteKey,
                    theme: 'dark',
                    callback: (token) => {
                        loginTurnstileToken = String(token ?? '');
                    },
                    'expired-callback': () => {
                        loginTurnstileToken = '';
                    },
                    'error-callback': () => {
                        loginTurnstileToken = '';
                    },
                });
            }
        } else if (mode === 'register') {
            regTurnstileToken = '';
            if (regTurnstileWidgetId !== null) {
                window.turnstile.reset(regTurnstileWidgetId);
            } else {
                regTurnstileWidgetId = window.turnstile.render('#regTurnstileContainer', {
                    sitekey: turnstileConfig.siteKey,
                    theme: 'dark',
                    callback: (token) => {
                        regTurnstileToken = String(token ?? '');
                    },
                    'expired-callback': () => {
                        regTurnstileToken = '';
                    },
                    'error-callback': () => {
                        regTurnstileToken = '';
                    },
                });
            }
        }
    } catch (error) {
        console.error('Turnstile initialization error:', error);
        displayError(error?.message || t`Failed to load Turnstile widget, please check your network connection`);
    }
}

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
 * Gets initial login state (captcha requirement, registration availability, Turnstile, and community prompt config) from the server.
 * @returns {Promise<{requireCaptcha?: boolean, enableUserRegistration?: boolean, defaultLanguage?: string, turnstile?: {enabled?: boolean, siteKey?: string}, communityPrompt?: {enabled?: boolean, loginJumpUrl?: string, errorContactPrompt?: string}}>}
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
    if (turnstileConfig.enabled) {
        await ensureTurnstileWidget(imgId === 'loginCaptchaImage' ? 'login' : 'register');
        return;
    }
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
        $('#discreetLoginPrompt').attr('data-i18n', 'Sign in with User Handle').text(t`Sign in with User Handle`);
        displayError('');
    } else {
        swapBlocks(['#handleEntryBlock', '#passwordEntryBlock', '#passwordRecoveryBlock'], ['#registerBlock']);
        $('#discreetLoginPrompt').attr('data-i18n', 'Create Account').text(t`Create Account`);
        refreshCaptcha('regCaptchaImage');
        displayError('');
    }
}

async function performRegister() {
    const handle = String($('#regHandle').val() ?? '').trim();
    const password = String($('#regPassword').val() ?? '');
    const confirmPassword = String($('#regPasswordConfirm').val() ?? '');
    const captcha = String($('#regCaptcha').val() ?? '').trim();

    if (!handle || !password || !confirmPassword) {
        return displayError(t`Please fill in all required fields`);
    }

    if (turnstileConfig.enabled) {
        if (!regTurnstileToken) {
            return displayError(t`Please complete the Turnstile verification`);
        }
    } else if (!captcha) {
        return displayError(t`Please fill in all required fields`);
    }

    if (!VALID_HANDLE_REGEX.test(handle)) {
        return displayError(t`User handle can only contain letters, numbers, underscores, or hyphens, and must start with a letter or number (1-32 characters)`);
    }

    if (password !== confirmPassword) {
        return displayError(t`Passwords do not match`);
    }

    try {
        const response = await fetch('/api/users/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({
                handle,
                password,
                captcha,
                turnstileToken: turnstileConfig.enabled ? regTurnstileToken : undefined,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            refreshCaptcha('regCaptchaImage');
            $('#regCaptcha').val('');
            return displayError(errorData.error || t`Registration failed, please try again`, response.status >= 500);
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
        return displayError(t`Please enter your user handle first`);
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
        return displayError(errorData.error || t`Failed to request recovery code`, response.status >= 500);
    }

    showRecoveryBlock();
}

/**
 * Sends the recovery code and new password to the server.
 * @param {string} handle User handle
 * @param {string} code Recovery code
 * @param {string} newPassword New password
 * @returns {Promise<void>}
 */
async function sendRecoveryPart2(handle, code, newPassword) {
    const cleanHandle = String(handle ?? '').trim();
    const cleanCode = String(code ?? '').trim();
    if (!cleanHandle || !cleanCode) {
        return displayError(t`Please enter your user handle and recovery code`);
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
        return displayError(errorData.error || t`Password recovery failed`, response.status >= 500);
    }

    console.log(`Successfully recovered password for ${cleanHandle}!`);
    await performLogin(cleanHandle, newPassword);
}

/**
 * Logs the user in with the given handle and password.
 * @param {string} handle User handle
 * @param {string} password Password
 * @returns {Promise<void>}
 */
async function performLogin(handle, password) {
    const cleanHandle = String(handle ?? '').trim();
    if (!cleanHandle) {
        return displayError(t`Please enter your user handle`);
    }

    const captcha = String($('#loginCaptcha').val() ?? '').trim();
    if (loginCaptchaRequired) {
        if (turnstileConfig.enabled && !loginTurnstileToken) {
            return displayError(t`Please complete the Turnstile verification`);
        }
        if (!turnstileConfig.enabled && !captcha) {
            return displayError(t`Please enter the verification code`);
        }
    }

    const userInfo = {
        handle: cleanHandle,
        password: password,
        captcha: captcha,
        turnstileToken: turnstileConfig.enabled ? loginTurnstileToken : undefined,
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
                loginCaptchaRequired = true;
                showFlexBlock('#loginCaptchaBlock');
                refreshCaptcha('loginCaptchaImage');
                $('#loginCaptcha').val('');
            }

            return displayError(errorData.error || t`Login failed, please check your user handle and password`, response.status >= 500);
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
 * Displays a localized error message to the user.
 * @param {string} message Error message or i18n key
 * @param {boolean} [appendContact=false] Whether to append the configured errorContactPrompt
 */
function displayError(message, appendContact = false) {
    if (!message) {
        $('#errorMessage').text('');
        return;
    }
    const localizedMessage = translate(message);
    const finalMessage = (appendContact && errorContactPrompt)
        ? `${localizedMessage}（${errorContactPrompt}）`
        : localizedMessage;
    $('#errorMessage').text(finalMessage);
}

/**
 * Redirects the user to the home page.
 */
function redirectToHome() {
    window.location.href = '/';
}

/**
 * Hides the password entry block and shows the password recovery block.
 */
function showRecoveryBlock() {
    swapBlocks(['#passwordEntryBlock', '#registerBlock'], ['#passwordRecoveryBlock']);
    $('#discreetLoginPrompt').attr('data-i18n', 'Password Recovery').text(t`Password Recovery`);
    displayError('');
}

/**
 * Hides the password recovery block and shows the password entry block.
 */
function onCancelRecoveryClick() {
    swapBlocks(['#passwordRecoveryBlock'], ['#handleEntryBlock', '#passwordEntryBlock']);
    $('#discreetLoginPrompt').attr('data-i18n', 'Sign in with User Handle').text(t`Sign in with User Handle`);
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
 * Configures human verification UI (Cloudflare Turnstile vs built-in backend SVG captcha).
 * @param {{enabled?: boolean, siteKey?: string}} [turnstile]
 */
function applyTurnstileConfig(turnstile) {
    if (turnstile?.enabled && turnstile?.siteKey) {
        turnstileConfig = {
            enabled: true,
            siteKey: String(turnstile.siteKey).trim(),
        };
        $('#loginSvgCaptchaRow').hide();
        $('#regSvgCaptchaRow').hide();
        $('#loginTurnstileContainer').show();
        $('#regTurnstileContainer').show();
    } else {
        turnstileConfig = {
            enabled: false,
            siteKey: '',
        };
        $('#loginTurnstileContainer').hide();
        $('#regTurnstileContainer').hide();
        $('#loginSvgCaptchaRow').show();
        $('#regSvgCaptchaRow').show();
    }
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
        const baseRecoverMsg = t`Password recovery currently requires administrator assistance. Please contact the administrator for a recovery code.`;
        const baseRecoverPlaceholder = t`Recovery code`;
        $('#recoverMessage').text(`${baseRecoverMsg}（${errorContactPrompt}）`);
        $('#recoveryCode').attr('placeholder', `${baseRecoverPlaceholder}（${errorContactPrompt}）`);
    }
}

(async function () {
    initAccessibility();

    const [token, loginState] = await Promise.all([
        getCsrfToken(),
        getLoginState(),
    ]);
    csrfToken = token;

    await initLoginLocales(loginState.defaultLanguage || 'zh-cn');

    // Force discreet login flow: do NOT request or display user list.
    // This prevents any call to /api/users/list from the login page and
    // always shows the handle + password inputs instead.
    configureDiscreetLogin();
    applyTurnstileConfig(loginState.turnstile);
    applyCommunityPromptConfig(loginState.communityPrompt);

    if (loginState.enableUserRegistration === false) {
        $('#showRegisterContainer').hide();
    }

    if (loginState.requireCaptcha) {
        loginCaptchaRequired = true;
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
