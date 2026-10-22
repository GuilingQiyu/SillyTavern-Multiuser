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
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
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

/**
 * Reads optional Cloudflare Turnstile configuration from config.yaml.
 * Turnstile is active only when enabled=true and both siteKey and secretKey are non-empty.
 * @returns {{enabled: boolean, siteKey: string, secretKey: string}}
 */
function getTurnstileConfig() {
    const enabled = !!getConfigValue('turnstile.enabled', false, 'boolean');
    const siteKey = String(getConfigValue('turnstile.siteKey', '') ?? '').trim();
    const secretKey = String(getConfigValue('turnstile.secretKey', '') ?? '').trim();
    const active = enabled && Boolean(siteKey) && Boolean(secretKey);
    return {
        enabled: active,
        siteKey: active ? siteKey : '',
        secretKey: active ? secretKey : '',
    };
}

/**
 * Verifies a Cloudflare Turnstile token on the backend via Cloudflare's siteverify API.
 * @param {string} token Turnstile response token submitted by the client
 * @param {string} secretKey Turnstile secret key configured on the server
 * @param {string} [remoteip] Client IP address
 * @returns {Promise<boolean>} True if Cloudflare confirmed the token is valid
 */
async function verifyTurnstileToken(token, secretKey, remoteip) {
    if (!token || !secretKey) {
        return false;
    }

    try {
        const params = new URLSearchParams();
        params.append('secret', secretKey);
        params.append('response', token);
        if (remoteip) {
            params.append('remoteip', remoteip);
        }

        const verifyResponse = await fetch(TURNSTILE_VERIFY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
        });

        if (!verifyResponse.ok) {
            console.error('Turnstile siteverify HTTP error:', verifyResponse.status);
            return false;
        }

        const data = /** @type {{success?: boolean, 'error-codes'?: string[]}} */ (await verifyResponse.json());
        if (!data?.success) {
            console.warn('Turnstile verification rejected:', data?.['error-codes']);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Turnstile siteverify request failed:', error);
        return false;
    }
}

/**
 * Verifies either the Cloudflare Turnstile token or the built-in session SVG captcha on the backend.
 * @param {import('express').Request} request Express request
 * @param {string} ip Client IP address
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function verifyHumanChallenge(request, ip) {
    const turnstile = getTurnstileConfig();

    if (turnstile.enabled) {
        const rawToken = typeof request.body?.turnstileToken === 'string'
            ? request.body.turnstileToken.trim()
            : (typeof request.body?.captcha === 'string' ? request.body.captcha.trim() : '');

        if (!rawToken) {
            return { ok: false, error: 'Please complete the Turnstile verification' };
        }

        const verified = await verifyTurnstileToken(rawToken, turnstile.secretKey, ip);
        if (!verified) {
            return { ok: false, error: 'Turnstile verification failed, please try again' };
        }

        return { ok: true };
    }

    const expectedCaptcha = request.session?.captcha;
    if (request.session) {
        delete request.session.captcha;
    }

    const providedCaptcha = typeof request.body?.captcha === 'string' ? request.body.captcha.trim() : '';
    if (!providedCaptcha) {
        return { ok: false, error: 'Please enter the verification code' };
    }

    if (!expectedCaptcha) {
        return { ok: false, error: 'Captcha expired, please refresh and try again' };
    }

    if (providedCaptcha.toUpperCase() !== expectedCaptcha) {
        return { ok: false, error: 'Incorrect captcha' };
    }

    return { ok: true };
}

export const router = express.Router();
const loginLimiter = new RateLimiterMemory({
    points: LOGIN_POINTS > 0 ? LOGIN_POINTS : Number.MAX_SAFE_INTEGER,
    duration: 300,
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
    const turnstile = getTurnstileConfig();
    return response.json({
        requireCaptcha: (request.session?.loginFailures || 0) >= 1,
        enableUserRegistration: ENABLE_REGISTRATION,
        enableDiscreetLogin: DISCREET_LOGIN,
        defaultLanguage: 'zh-cn',
        turnstile: {
            enabled: turnstile.enabled,
            siteKey: turnstile.siteKey,
        },
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
            return response.status(403).json({ error: 'Public registration is currently disabled on this server' });
        }

        const { handle, password } = request.body ?? {};

        if (typeof handle !== 'string' || typeof password !== 'string') {
            return response.status(400).json({ error: 'Please fill in all required fields' });
        }

        const cleanHandle = handle.trim();
        if (!cleanHandle || !password) {
            return response.status(400).json({ error: 'Please fill in all required fields' });
        }

        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        const challengeResult = await verifyHumanChallenge(request, ip);
        if (!challengeResult.ok) {
            return response.status(400).json({ error: challengeResult.error });
        }

        if (!VALID_HANDLE_REGEX.test(cleanHandle)) {
            return response.status(400).json({ error: 'User handle can only contain letters, numbers, underscores, or hyphens, and must start with a letter or number (1-32 characters)' });
        }

        if (password.length < 1 || password.length > MAX_PASSWORD_LENGTH) {
            return response.status(400).json({ error: 'Password length must be between 1 and 256 characters' });
        }

        await registerLimiter.consume(ip);

        const key = toKey(cleanHandle);
        const existingUser = await storage.getItem(key);
        const existingHandles = await getAllUserHandles();

        if (existingUser || existingHandles.some(h => h.toLowerCase() === cleanHandle.toLowerCase())) {
            return response.status(409).json({ error: 'User already exists' });
        }

        const directories = ensureUserDirectoriesExist(cleanHandle);
        if (!isPathUnderParent(globalThis.DATA_ROOT, path.resolve(directories.root))) {
            return response.status(400).json({ error: 'Invalid user handle' });
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
            return retryAfter(response, error).status(429).send({ error: 'Too many registration attempts, please try again later' });
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
        /** @type {import('../users.js').UserViewModel[]} */
        let userViewModels = [];

        for (const user of users.filter(x => x.enabled)) {
            const avatar = await getUserAvatar(user.handle);
            userViewModels.push({
                handle: user.handle,
                name: user.name,
                avatar: avatar,
                password: !!user.password,
                admin: user.admin,
                created: user.created,
            });
        }

        userViewModels.sort((x, y) => (x.created ?? 0) - (y.created ?? 0));
        return response.json(userViewModels);
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
            return response.status(400).json({ error: 'Please enter your user handle' });
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
            const challengeResult = await verifyHumanChallenge(request, ip);
            if (!challengeResult.ok) {
                return response.status(400).json({ error: challengeResult.error, requireCaptcha: true });
            }
        }

        const passwordInput = typeof request.body?.password === 'string' ? request.body.password : '';
        if (passwordInput.length > MAX_PASSWORD_LENGTH) {
            request.session.loginFailures = loginFailures + 1;
            return response.status(403).json({ error: 'Incorrect user handle or password', requireCaptcha: request.session.loginFailures >= 1 });
        }

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(rawHandle));

        if (!user) {
            console.error('Login failed: User', rawHandle, 'not found');
            // Don't reveal user existence, but increment failure count
            request.session.loginFailures = loginFailures + 1;
            return response.status(403).json({ error: 'Incorrect user handle or password', requireCaptcha: request.session.loginFailures >= 1 });
        }

        if (!user.enabled) {
            console.warn('Login failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: 'User account is disabled' });
        }

        if (user.password && user.password !== getPasswordHash(passwordInput, user.salt)) {
            console.warn('Login failed: Incorrect password for', user.handle);
            request.session.loginFailures = loginFailures + 1;
            return response.status(403).json({ error: 'Incorrect user handle or password', requireCaptcha: request.session.loginFailures >= 1 });
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
            return retryAfter(response, error).status(429).send({ error: 'Too many attempts. Try again later or recover your password.' });
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
            return response.status(400).json({ error: 'Please enter your user handle' });
        }

        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        await recoverLimiter.consume(ip);

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(rawHandle));

        if (!user) {
            console.error('Recover step 1 failed: User', rawHandle, 'not found');
            return response.status(404).json({ error: 'User not found' });
        }

        if (!user.enabled) {
            console.error('Recover step 1 failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: 'User account is disabled' });
        }

        const mfaCode = generateRecoveryCode();
        console.log(`${color.blue}Recovery code for ${user.handle}: ${color.yellow}${mfaCode}${color.reset}`);
        MFA_CACHE.set(user.handle, mfaCode);

        return response.sendStatus(204);
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Recover step 1 failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: 'Too many attempts. Try again later or contact your admin.' });
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
            return response.status(400).json({ error: 'Please enter your user handle and recovery code' });
        }

        const newPassword = typeof request.body?.newPassword === 'string' ? request.body.newPassword : '';
        if (newPassword.length > MAX_PASSWORD_LENGTH) {
            return response.status(400).json({ error: 'Password length cannot exceed 256 characters' });
        }

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(rawHandle));
        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        const rateLimit = await recoverLimiter.get(ip);

        if (rateLimit && rateLimit.remainingPoints <= 0) {
            return retryAfter(response, rateLimit).status(429).send({ error: 'Too many attempts. Try again later or contact your admin.' });
        }

        if (!user) {
            console.error('Recover step 2 failed: User', rawHandle, 'not found');
            return response.status(404).json({ error: 'User not found' });
        }

        if (!user.enabled) {
            console.warn('Recover step 2 failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: 'User account is disabled' });
        }

        const mfaCode = MFA_CACHE.get(user.handle);

        if (!mfaCode || rawCode !== mfaCode) {
            await recoverLimiter.consume(ip);
            console.warn('Recover step 2 failed: Incorrect code');
            return response.status(403).json({ error: 'Incorrect or expired recovery code' });
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

        await loginLimiter.delete(ip);
        await recoverLimiter.delete(ip);
        MFA_CACHE.remove(user.handle);

        console.info('Password recovery successful for', user.handle);
        return response.sendStatus(204);
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Recover step 2 failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: 'Too many attempts. Try again later or contact your admin.' });
        }

        console.error('Recover step 2 failed:', error);
        return response.sendStatus(500);
    }
});
