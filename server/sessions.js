'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { TelegramService } = require('./telegram');

/**
 * Gestiona una sesión de Telegram POR usuario.
 *  - logins:  flujos de login en curso (loginId -> cliente temporal)
 *  - users:   sesiones activas (token -> { service, client, isAdmin, name })
 *  - persist: token -> cadena de sesión, guardado en disco para sobrevivir reinicios
 */
class SessionManager {
    constructor(cfg) {
        this.cfg = cfg;
        this.users = new Map();
        this.logins = new Map();
        this.storeFile = path.join(cfg.dataDir, 'sessions.json');
        try { fs.mkdirSync(cfg.dataDir, { recursive: true }); } catch {}
        this.persisted = this._load();
        const t = setInterval(() => this._cleanupLogins(), 60000);
        if (t.unref) t.unref();
    }

    _load() { try { const d = JSON.parse(fs.readFileSync(this.storeFile, 'utf8')); console.log('[sessions] Cargadas ' + Object.keys(d).length + ' sesiones desde ' + this.storeFile); return d; } catch (e) { console.log('[sessions] Sin sesiones previas en ' + this.storeFile); return {}; } }
    _save() { try { fs.writeFileSync(this.storeFile, JSON.stringify(this.persisted)); console.log('[sessions] Guardadas ' + Object.keys(this.persisted).length + ' sesiones en ' + this.storeFile); } catch (e) { console.warn('[sessions] ERROR al guardar:', e.message); } }
    persistedCount() { return Object.keys(this.persisted || {}).length; }
    canWrite() { try { const p = path.join(this.cfg.dataDir, '.wtest'); fs.writeFileSync(p, '1'); fs.unlinkSync(p); return true; } catch { return false; } }

    newClient(session) {
        return new TelegramClient(new StringSession(session || ''), this.cfg.apiId, this.cfg.apiHash, {
            connectionRetries: 3, useWSS: false, autoReconnect: true, timeout: 15
        });
    }

    async startLogin() {
        const id = crypto.randomBytes(16).toString('hex');
        const client = this.newClient('');
        await client.connect();
        this.logins.set(id, { client, ts: Date.now() });
        return id;
    }

    async sendCode(loginId, phone) {
        const l = this.logins.get(loginId);
        if (!l) throw new Error('La sesión de acceso caducó, recarga la página.');
        const r = await l.client.sendCode({ apiId: this.cfg.apiId, apiHash: this.cfg.apiHash }, phone);
        l.phone = phone; l.hash = r.phoneCodeHash; l.ts = Date.now();
    }

    async signIn(loginId, code) {
        const l = this.logins.get(loginId);
        if (!l) throw new Error('La sesión de acceso caducó, recarga la página.');
        try {
            await l.client.invoke(new Api.auth.SignIn({
                phoneNumber: l.phone, phoneCodeHash: l.hash, phoneCode: String(code).replace(/\s+/g, '')
            }));
        } catch (e) {
            if ((e.errorMessage || e.message || '').includes('SESSION_PASSWORD_NEEDED')) return { needPassword: true };
            throw e;
        }
        return await this._finalize(loginId);
    }

    async signInPassword(loginId, password) {
        const l = this.logins.get(loginId);
        if (!l) throw new Error('La sesión de acceso caducó, recarga la página.');
        let used = false;
        await l.client.signInWithPassword(
            { apiId: this.cfg.apiId, apiHash: this.cfg.apiHash },
            {
                password: async () => { if (used) throw new Error('Contraseña 2FA incorrecta.'); used = true; return password; },
                onError: (e) => { throw e; }
            }
        );
        return await this._finalize(loginId);
    }

    async _finalize(loginId) {
        const l = this.logins.get(loginId);
        const session = l.client.session.save();
        const token = crypto.randomBytes(24).toString('hex');
        const service = new TelegramService(l.client, this.cfg);
        let isAdmin = false, name = '', inGroup = false;
        try { await service.resolveGroup(); inGroup = true; } catch {}
        try { isAdmin = await service.isGroupAdmin(); } catch {}
        try { const me = await l.client.getMe(); name = (me && (me.firstName || me.username)) || ''; } catch {}
        this.users.set(token, { service, client: l.client, isAdmin, name, inGroup, lastUsed: Date.now() });
        this.persisted[token] = session; this._save();
        this.logins.delete(loginId);
        return { token, isAdmin, name };
    }

    async getByToken(token) {
        if (!token) return null;
        if (this.users.has(token)) { const u = this.users.get(token); u.lastUsed = Date.now(); return u; }
        const session = this.persisted[token];
        if (!session) { console.log('[sessions] Token recibido pero NO está en persisted (' + token.slice(0, 8) + '...). Total guardadas: ' + Object.keys(this.persisted).length); return null; }
        console.log('[sessions] Restaurando sesion del token ' + token.slice(0, 8) + '...');
        const client = this.newClient(session);
        try {
            // Conectamos pero NO verificamos cada F5 — confiamos en la sesión guardada.
            // Si fuera realmente inválida, las llamadas downstream (catalog, stream...) lo revelarán.
            await Promise.race([
                client.connect(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('connect timeout')), 8000))
            ]);
        } catch (e) {
            console.warn('[sessions] Error al conectar (transitorio):', e.message, '— mantengo sesion en disco');
            try { await client.disconnect(); } catch {}
            return null;
        }
        const service = new TelegramService(client, this.cfg);
        let isAdmin = false, name = '', inGroup = false;
        try { await service.resolveGroup(); inGroup = true; } catch (e) { console.warn('[sessions] resolveGroup falló:', e.message); }
        try { isAdmin = await service.isGroupAdmin(); } catch {}
        try { const me = await client.getMe(); name = (me && (me.firstName || me.username)) || ''; } catch (e) { console.warn('[sessions] getMe falló:', e.message); }
        const u = { service, client, isAdmin, name, inGroup, lastUsed: Date.now() };
        this.users.set(token, u);
        return u;
    }

    async logout(token) {
        const u = this.users.get(token);
        if (u) {
            try { await u.client.invoke(new Api.auth.LogOut()); } catch {}
            try { await u.client.disconnect(); } catch {}
            this.users.delete(token);
        }
        delete this.persisted[token]; this._save();
    }

    _cleanupLogins() {
        const now = Date.now();
        for (const [id, l] of this.logins) {
            if (now - l.ts > 600000) { try { l.client.disconnect(); } catch {} this.logins.delete(id); }
        }
    }
}

module.exports = { SessionManager };
