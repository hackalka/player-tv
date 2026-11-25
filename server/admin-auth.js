'use strict';
const crypto = require('crypto');

const sessions = new Map();
const attempts = new Map();
const COOKIE = 'tvp_admin';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function digest(value) {
    return crypto.createHash('sha256').update(String(value)).digest();
}
function safeEqual(a, b) {
    return crypto.timingSafeEqual(digest(a), digest(b));
}
function cookieValue(req) {
    const raw = req.headers.cookie || '';
    const match = raw.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
    return match ? decodeURIComponent(match[1]) : '';
}
function sign(nonce, secret) {
    return crypto.createHmac('sha256', secret).update(nonce).digest('base64url');
}
function readSession(req, secret) {
    const parts = cookieValue(req).split('.');
    if (parts.length !== 2 || !parts[0] || !safeEqual(parts[1], sign(parts[0], secret))) return null;
    const record = sessions.get(parts[0]);
    return record ? { nonce: parts[0], record } : null;
}
function originAllowed(req, expected) {
    return !!expected && req.get('origin') === expected;
}
function createAdminAuth(cfg) {
    const password = cfg.adminPassword;
    const origin = cfg.adminOrigin;
    const enabled = typeof password === 'string' && password.length >= 16 &&
        typeof cfg.adminSessionSecret === 'string' && cfg.adminSessionSecret.length >= 32 &&
        typeof origin === 'string' && /^https:\/\//.test(origin);

    function setCookie(res, token) {
        res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=None; Path=/api/admin; Max-Age=28800`);
    }
    function clearCookie(res) {
        res.append('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/api/admin; Max-Age=0`);
    }
    function requireAdmin(req, res, next) {
        if (!enabled) return res.status(503).json({ error: 'Administración no configurada en el servidor.' });
        if (!originAllowed(req, origin)) return res.status(403).json({ error: 'Origen no autorizado.' });
        const session = readSession(req, cfg.adminSessionSecret);
        const record = session && session.record;
        if (!record || record.expiresAt < Date.now()) {
            if (session) sessions.delete(session.nonce);
            return res.status(401).json({ authenticated: false });
        }
        record.expiresAt = Date.now() + SESSION_TTL_MS;
        req.admin = { authenticated: true };
        next();
    }

    return {
        enabled,
        cors(req, res, next) {
            if (req.path.startsWith('/api/admin') && req.get('origin') === origin) {
                res.set('Access-Control-Allow-Origin', origin);
                res.set('Access-Control-Allow-Credentials', 'true');
                res.set('Access-Control-Allow-Headers', 'Content-Type');
                res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.vary('Origin');
                if (req.method === 'OPTIONS') return res.status(204).end();
            }
            next();
        },
        status(req, res) {
            if (!enabled) return res.json({ configured: false, authenticated: false });
            const session = readSession(req, cfg.adminSessionSecret);
            const record = session && session.record;
            const authenticated = !!record && record.expiresAt >= Date.now();
            if (!authenticated && session) sessions.delete(session.nonce);
            res.json({ configured: true, authenticated });
        },
        login(req, res) {
            if (!enabled) return res.status(503).json({ error: 'Configura ADMIN_PASSWORD, ADMIN_SESSION_SECRET y ADMIN_ORIGIN en el servidor.' });
            if (!originAllowed(req, origin)) return res.status(403).json({ error: 'Origen no autorizado.' });
            const ip = req.ip || req.socket.remoteAddress || 'unknown';
            const now = Date.now();
            let state = attempts.get(ip);
            if (!state || now - state.startedAt > WINDOW_MS) state = { count: 0, startedAt: now };
            if (state.count >= MAX_ATTEMPTS) {
                attempts.set(ip, state);
                return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
            }
            state.count += 1;
            attempts.set(ip, state);
            const supplied = typeof req.body.password === 'string' ? req.body.password : '';
            if (!safeEqual(supplied, password)) return res.status(401).json({ error: 'Credenciales incorrectas.' });
            attempts.delete(ip);
            const nonce = crypto.randomBytes(32).toString('base64url');
            sessions.set(nonce, { expiresAt: now + SESSION_TTL_MS });
            setCookie(res, nonce + '.' + sign(nonce, cfg.adminSessionSecret));
            res.set('Cache-Control', 'no-store').json({ authenticated: true });
        },
        logout(req, res) {
            if (!originAllowed(req, origin)) return res.status(403).json({ error: 'Origen no autorizado.' });
            const session = readSession(req, cfg.adminSessionSecret);
            if (session) sessions.delete(session.nonce);
            clearCookie(res);
            res.set('Cache-Control', 'no-store').json({ authenticated: false });
        },
        requireAdmin
    };
}
module.exports = { createAdminAuth };
