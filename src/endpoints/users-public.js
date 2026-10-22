import crypto from 'node:crypto';
import path from 'node:path';

import storage from 'node-persist';
import express from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getIpAddress, retryAfter } from '../express-common.js';
import { color, Cache, getConfigValue, isPathUnderParent } from '../util.js';
import { checkForNewContent, CONTENT_TYPES } from './content-manager.js';
import {
    KEY_PREFIX,
    getUserAvatar,
    toKey,
    getPasswordHash,
    getPasswordSalt,
    getAllUserHandles,
    ensureUserDirectoriesExist,
    getAccountVersion,
} from '../users.js';

const DISCREET_LOGIN = getConfigValue('enableDiscreetLogin', false, 'boolean');
const ENABLE_REGISTRATION = getConfigValue('enableUserRegistration', true, 'boolean');
const PREFER_REAL_IP_HEADER = getConfigValue('rateLimiting.preferRealIpHeader', false, 'boolean');
const LOGIN_POINTS = getConfigValue('rateLimiting.accountsLoginMaxAttempts', 5, 'number');
const RECOVER_POINTS = getConfigValue('rateLimiting.accountsRecoverMaxAttempts', 5, 'number');
const REGISTER_POINTS = getConfigValue('rateLimiting.accountsRegisterMaxAttempts', 5, 'number');
const MFA_CACHE = new Cache(5 * 60 * 1000);

const VALID_HANDLE_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;
const MAX_PASSWORD_LENGTH = 256;
const INITIAL_USER_CONTENT_TYPES = [
    CONTENT_TYPES.SETTINGS,
    CONTENT_TYPES.THEME,
    CONTENT_TYPES.CHARACTER,
    CONTENT_TYPES.WORLD,
    CONTENT_TYPES.SPRITES,
];

const generateRecoveryCode = () => Array.from({ length: 6 }, () => crypto.randomInt(0, 10)).join('');

/**
 * Reads optional community prompt configuration from config.yaml.
 * @returns {{enabled: boolean, loginJumpUrl: string, popupMessage: string, errorContactPrompt: string}}
 */
function getCommunityPromptConfig() {
    const enabled = !!getConfigValue('communityPrompt.enabled', false, 'boolean');
    return {
        enabled,
        loginJumpUrl: enabled ? String(getConfigValue('communityPrompt.loginJumpUrl', '') ?? '').trim() : '',
        popupMessage: enabled ? String(getConfigValue('communityPrompt.popupMessage', '') ?? '').trim() : '',
        errorContactPrompt: enabled ? String(getConfigValue('communityPrompt.errorContactPrompt', '') ?? '').trim() : '',
    };
}

export const router = express.Router();
const loginLimiter = new RateLimiterMemory({
    points: LOGIN_POINTS > 0 ? LOGIN_POINTS : Number.MAX_SAFE_INTEGER,
    duration: 60,
});
const recoverLimiter = new RateLimiterMemory({
    points: RECOVER_POINTS > 0 ? RECOVER_POINTS : Number.MAX_SAFE_INTEGER,
    duration: 300,
});
const registerLimiter = new RateLimiterMemory({
    points: REGISTER_POINTS > 0 ? REGISTER_POINTS : Number.MAX_SAFE_INTEGER,
    duration: 300,
});

function generateCaptcha() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let text = '';
    for (let i = 0; i < 4; i++) {
        text += chars.charAt(crypto.randomInt(0, chars.length));
    }

    const width = 120;
    const height = 40;
    let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="background-color: #f0f0f0; border-radius: 4px;">`;

    // Add noise lines
    for (let i = 0; i < 7; i++) {
        const x1 = crypto.randomInt(0, width);
        const y1 = crypto.randomInt(0, height);
        const x2 = crypto.randomInt(0, width);
        const y2 = crypto.randomInt(0, height);
        const stroke = crypto.randomInt(0x100000, 0x999999).toString(16).padStart(6, '0');
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#${stroke}" stroke-width="1" opacity="0.5" />`;
    }

    // Add text
    for (let i = 0; i < text.length; i++) {
        const x = 15 + i * 25 + crypto.randomInt(0, 6);
        const y = 28 + crypto.randomInt(0, 6);
        const fontSize = 22 + crypto.randomInt(0, 5);
        const rotate = crypto.randomInt(-20, 21);
        const fill = crypto.randomInt(0x100000, 0x777777).toString(16).padStart(6, '0');
        svg += `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#${fill}" transform="rotate(${rotate}, ${x}, ${y})">${text[i]}</text>`;
    }

    svg += '</svg>';
    return { text, svg };
}

router.get('/captcha', (request, response) => {
    const { text, svg } = generateCaptcha();
    if (request.session) {
        request.session.captcha = text;
    }
    response.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.set('Pragma', 'no-cache');
    response.type('svg');
    response.send(svg);
});

router.get('/login-state', (request, response) => {
    response.set('Cache-Control', 'no-store');
    const communityPrompt = getCommunityPromptConfig();
    return response.json({
        requireCaptcha: (request.session?.loginFailures || 0) >= 1,
        enableUserRegistration: ENABLE_REGISTRATION,
        enableDiscreetLogin: DISCREET_LOGIN,
        communityPrompt: {
            enabled: communityPrompt.enabled,
            loginJumpUrl: communityPrompt.loginJumpUrl,
            errorContactPrompt: communityPrompt.errorContactPrompt,
        },
    });
});

router.post('/register', async (request, response) => {
    try {
        if (!ENABLE_REGISTRATION) {
            return response.status(403).json({ error: '当前服务器已关闭公开注册' });
        }

        const { handle, password, captcha } = request.body ?? {};

        if (typeof handle !== 'string' || typeof password !== 'string' || typeof captcha !== 'string') {
            return response.status(400).json({ error: '请填写所有必填字段' });
        }

        const cleanHandle = handle.trim();
        if (!cleanHandle || !password || !captcha.trim()) {
            return response.status(400).json({ error: '请填写所有必填字段' });
        }

        const expectedCaptcha = request.session?.captcha;
        if (request.session) {
            delete request.session.captcha;
        }

        if (!expectedCaptcha) {
            return response.status(400).json({ error: '验证码已过期，请刷新重试' });
        }

        if (captcha.trim().toUpperCase() !== expectedCaptcha) {
            return response.status(400).json({ error: '验证码错误' });
        }

        if (!VALID_HANDLE_REGEX.test(cleanHandle)) {
            return response.status(400).json({ error: '用户名只能包含字母、数字、下划线或连字符，且必须以字母或数字开头（1-32位）' });
        }

        if (password.length < 1 || password.length > MAX_PASSWORD_LENGTH) {
            return response.status(400).json({ error: `密码长度需在 1 到 ${MAX_PASSWORD_LENGTH} 个字符之间` });
        }

        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        await registerLimiter.consume(ip);

        const key = toKey(cleanHandle);
        const existingUser = await storage.getItem(key);
        const existingHandles = await getAllUserHandles();

        if (existingUser || existingHandles.some(h => h.toLowerCase() === cleanHandle.toLowerCase())) {
            return response.status(409).json({ error: '用户已存在！' });
        }

        const directories = ensureUserDirectoriesExist(cleanHandle);
        if (!isPathUnderParent(globalThis.DATA_ROOT, path.resolve(directories.root))) {
            return response.status(400).json({ error: '非法用户名' });
        }

        const salt = getPasswordSalt();
        const passwordHash = getPasswordHash(password, salt);

        const newUser = {
            handle: cleanHandle,
            name: cleanHandle,
            created: Date.now(),
            password: passwordHash,
            salt: salt,
            enabled: true,
            admin: false,
        };

        await storage.setItem(key, newUser);
        console.info('User registered:', cleanHandle);

        // Initialize user default content
        try {
            await checkForNewContent([directories], INITIAL_USER_CONTENT_TYPES);
        } catch (err) {
            console.error('Failed to seed user content:', err);
        }

        // Auto login after register
        request.session.handle = cleanHandle;
        request.session.loginFailures = 0;
        request.session.version = getAccountVersion(newUser);
        return response.json({ handle: cleanHandle });
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Registration failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: '注册请求过于频繁，请稍后再试' });
        }

        console.error('Registration failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/list', async (_request, response) => {
    try {
        if (DISCREET_LOGIN) {
            return response.sendStatus(204);
        }

        /** @type {import('../users.js').User[]} */
        const users = await storage.values(x => x.key.startsWith(KEY_PREFIX));

        /** @type {Promise<import('../users.js').UserViewModel>[]} */
        const viewModelPromises = users
            .filter(x => x.enabled)
            .map(user => new Promise(async (resolve) => {
                getUserAvatar(user.handle).then(avatar =>
                    resolve({
                        handle: user.handle,
                        name: user.name,
                        created: user.created,
                        avatar: avatar,
                        password: !!user.password,
                    }),
                );
            }));

        const viewModels = await Promise.all(viewModelPromises);
        viewModels.sort((x, y) => (x.created ?? 0) - (y.created ?? 0));
        return response.json(viewModels);
    } catch (error) {
        console.error('User list failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/login', async (request, response) => {
    try {
        const rawHandle = typeof request.body?.handle === 'string' ? request.body.handle.trim() : '';
        if (!rawHandle) {
            console.warn('Login failed: Missing required fields');
            return response.status(400).json({ error: '请输入用户名' });
        }

        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        await loginLimiter.consume(ip);

        if (!request.session) {
            console.error('Session not available');
            return response.sendStatus(500);
        }

        const loginFailures = request.session.loginFailures || 0;
        const requireCaptcha = loginFailures >= 1;

        if (requireCaptcha) {
            const expectedCaptcha = request.session.captcha;
            delete request.session.captcha;

            const providedCaptcha = typeof request.body?.captcha === 'string' ? request.body.captcha.trim() : '';
            if (!providedCaptcha) {
                return response.status(400).json({ error: '请输入验证码', requireCaptcha: true });
            }
            if (!expectedCaptcha || providedCaptcha.toUpperCase() !== expectedCaptcha) {
                return response.status(400).json({ error: '验证码错误或已过期', requireCaptcha: true });
            }
        }

        const passwordInput = typeof request.body?.password === 'string' ? request.body.password : '';
        if (passwordInput.length > MAX_PASSWORD_LENGTH) {
            request.session.loginFailures = loginFailures + 1;
            return response.status(403).json({ error: '用户名或密码错误', requireCaptcha: request.session.loginFailures >= 1 });
        }

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(rawHandle));

        if (!user) {
            console.error('Login failed: User', rawHandle, 'not found');
            // Don't reveal user existence, but increment failure count
            request.session.loginFailures = loginFailures + 1;
            return response.status(403).json({ error: '用户名或密码错误', requireCaptcha: request.session.loginFailures >= 1 });
        }

        if (!user.enabled) {
            console.warn('Login failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: '该账户已被禁用' });
        }

        if (user.password && user.password !== getPasswordHash(passwordInput, user.salt)) {
            console.warn('Login failed: Incorrect password for', user.handle);
            request.session.loginFailures = loginFailures + 1;
            return response.status(403).json({ error: '用户名或密码错误', requireCaptcha: request.session.loginFailures >= 1 });
        }

        await loginLimiter.delete(ip);
        request.session.handle = user.handle;
        request.session.loginFailures = 0; // Reset failures on success
        request.session.version = getAccountVersion(user);
        console.info('Login successful:', user.handle, 'from', ip, 'at', new Date().toLocaleString());
        return response.json({ handle: user.handle });
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Login failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: '尝试次数过多，请稍后再试或使用密码恢复' });
        }

        console.error('Login failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/recover-step1', async (request, response) => {
    try {
        const rawHandle = typeof request.body?.handle === 'string' ? request.body.handle.trim() : '';
        if (!rawHandle) {
            console.warn('Recover step 1 failed: Missing required fields');
            return response.status(400).json({ error: '请输入用户名' });
        }

        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        await recoverLimiter.consume(ip);

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(rawHandle));

        if (!user) {
            console.error('Recover step 1 failed: User', rawHandle, 'not found');
            return response.status(404).json({ error: '未找到该用户' });
        }

        if (!user.enabled) {
            console.error('Recover step 1 failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: '该账户已被禁用' });
        }

        const mfaCode = generateRecoveryCode();
        console.log();
        console.log(color.blue(`${user.name}, your password recovery code is: `) + color.magenta(mfaCode));
        console.log();
        MFA_CACHE.set(user.handle, mfaCode);
        return response.sendStatus(204);
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Recover step 1 failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: '尝试次数过多，请稍后再试或联系管理员' });
        }

        console.error('Recover step 1 failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/recover-step2', async (request, response) => {
    try {
        const rawHandle = typeof request.body?.handle === 'string' ? request.body.handle.trim() : '';
        const rawCode = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
        if (!rawHandle || !rawCode) {
            console.warn('Recover step 2 failed: Missing required fields');
            return response.status(400).json({ error: '请填写恢复码' });
        }

        const newPassword = typeof request.body?.newPassword === 'string' ? request.body.newPassword : '';
        if (newPassword.length > MAX_PASSWORD_LENGTH) {
            return response.status(400).json({ error: `密码长度不能超过 ${MAX_PASSWORD_LENGTH} 个字符` });
        }

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(rawHandle));
        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        const rateLimit = await recoverLimiter.get(ip);

        if (rateLimit !== null && rateLimit.consumedPoints > recoverLimiter.points) {
            throw rateLimit;
        }

        if (!user) {
            console.error('Recover step 2 failed: User', rawHandle, 'not found');
            return response.status(404).json({ error: '未找到该用户' });
        }

        if (!user.enabled) {
            console.warn('Recover step 2 failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: '该账户已被禁用' });
        }

        const mfaCode = MFA_CACHE.get(user.handle);

        if (!mfaCode || rawCode !== mfaCode) {
            await recoverLimiter.consume(ip);
            console.warn('Recover step 2 failed: Incorrect code');
            return response.status(403).json({ error: '恢复码错误或已过期' });
        }

        if (newPassword) {
            const salt = getPasswordSalt();
            user.password = getPasswordHash(newPassword, salt);
            user.salt = salt;
            await storage.setItem(toKey(user.handle), user);
        } else {
            user.password = '';
            user.salt = '';
            await storage.setItem(toKey(user.handle), user);
        }

        if (request.session && request.session.handle === user.handle) {
            request.session.version = getAccountVersion(user);
        }

        await recoverLimiter.delete(ip);
        MFA_CACHE.remove(user.handle);
        return response.sendStatus(204);
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Recover step 2 failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: '尝试次数过多，请稍后再试或联系管理员' });
        }

        console.error('Recover step 2 failed:', error);
        return response.sendStatus(500);
    }
});
