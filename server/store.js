'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Almacen de sesiones persistidas (token -> cadena de sesion de Telegram).
 *
 * Dos modos:
 *  - Postgres  (si existe DATABASE_URL): sobrevive a redeploys y discos efimeros.
 *               Ideal para Koyeb / Render free, donde el disco local NO persiste.
 *  - Fichero   (por defecto): guarda en dataDir/sessions.json. Igual que siempre.
 *
 * El objeto vive en memoria en SessionManager; este store solo se encarga de
 * cargarlo una vez al arrancar (loadAll) y de escribir cuando hay cambios (saveAll).
 */
class SessionStore {
    constructor(cfg) {
        this.cfg = cfg;
        this.usePg = !!cfg.databaseUrl;
        this.file = path.join(cfg.dataDir, 'sessions.json');
        this.pool = null;
        this._saveTimer = null;
        this._pending = null;
        if (this.usePg) {
            const { Pool } = require('pg');
            this.pool = new Pool({
                connectionString: cfg.databaseUrl,
                ssl: { rejectUnauthorized: false },
                max: 3
            });
        }
    }

    mode() { return this.usePg ? 'postgres' : 'file'; }

    async init() {
        if (!this.usePg) return;
        await this.pool.query(
            'CREATE TABLE IF NOT EXISTS tvp_kv (k text PRIMARY KEY, v text NOT NULL, updated_at timestamptz DEFAULT now())'
        );
    }

    /** Devuelve el objeto { token: session, ... } (o {} si no hay nada). */
    async loadAll() {
        if (this.usePg) {
            try {
                const r = await this.pool.query("SELECT v FROM tvp_kv WHERE k = 'sessions'");
                if (r.rows.length) {
                    const obj = JSON.parse(r.rows[0].v);
                    console.log('[store/pg] Cargadas ' + Object.keys(obj).length + ' sesiones desde Postgres');
                    return obj;
                }
                console.log('[store/pg] Sin sesiones previas en Postgres');
                return {};
            } catch (e) {
                console.warn('[store/pg] ERROR al cargar:', e.message);
                return {};
            }
        }
        try {
            const obj = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            console.log('[store/file] Cargadas ' + Object.keys(obj).length + ' sesiones desde ' + this.file);
            return obj;
        } catch {
            console.log('[store/file] Sin sesiones previas en ' + this.file);
            return {};
        }
    }

    /** Guarda el objeto completo. En Postgres hace upsert; en fichero escribe el JSON. */
    saveAll(obj) {
        if (this.usePg) {
            // Pequeno debounce para no machacar la BD en logins seguidos.
            this._pending = obj;
            if (this._saveTimer) return;
            this._saveTimer = setTimeout(() => {
                const data = JSON.stringify(this._pending || {});
                this._saveTimer = null; this._pending = null;
                this.pool.query(
                    "INSERT INTO tvp_kv (k, v, updated_at) VALUES ('sessions', $1, now()) " +
                    "ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()",
                    [data]
                ).then(() => {
                    console.log('[store/pg] Guardadas ' + Object.keys(JSON.parse(data)).length + ' sesiones en Postgres');
                }).catch(e => console.warn('[store/pg] ERROR al guardar:', e.message));
            }, 500);
            if (this._saveTimer.unref) this._saveTimer.unref();
            return;
        }
        try {
            fs.writeFileSync(this.file, JSON.stringify(obj));
            console.log('[store/file] Guardadas ' + Object.keys(obj).length + ' sesiones en ' + this.file);
        } catch (e) {
            console.warn('[store/file] ERROR al guardar:', e.message);
        }
    }
}

module.exports = { SessionStore };
