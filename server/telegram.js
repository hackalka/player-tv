'use strict';
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const bigInt = require('big-integer');

/**
 * Motor de Telegram del lado servidor.
 * Mantiene una única conexión con la sesión guardada y expone helpers
 * para listar temas, traer mensajes, miniaturas y hacer streaming por rangos.
 */
class TelegramService {
    constructor(cfg) {
        this.cfg = cfg;
        this.client = null;
        this.entity = null;
        this._msgCache = new Map(); // id -> message (para streaming/thumbs)
        this.ready = false;
    }

    async start() {
        if (!this.cfg.session) {
            throw new Error('Falta TG_SESSION. Genera la sesión con "npm run login" y ponla como variable de entorno.');
        }
        const session = new StringSession(this.cfg.session);
        this.client = new TelegramClient(session, this.cfg.apiId, this.cfg.apiHash, {
            connectionRetries: 5,
            useWSS: false,
            autoReconnect: true
        });
        await this.client.connect();
        const authorized = await this.client.checkAuthorization();
        if (!authorized) throw new Error('La sesión TG_SESSION no es válida o expiró. Genera una nueva con "npm run login".');
        this.ready = true;
        console.log('✅ Conectado a Telegram');
        await this.resolveGroup();
    }

    async resolveGroup() {
        if (this.entity) return this.entity;
        const raw = String(this.cfg.groupId).trim();
        const id = /^-?\d+$/.test(raw) ? parseInt(raw, 10) : raw;
        try {
            this.entity = await this.client.getEntity(id);
        } catch (e) {
            // poblar caché con diálogos y reintentar
            await this.client.getDialogs({ limit: 200 });
            this.entity = await this.client.getEntity(id);
        }
        return this.entity;
    }

    _cache(messages) {
        for (const m of messages) if (m && m.id != null) this._msgCache.set(m.id, m);
    }

    async getMessageById(id) {
        if (this._msgCache.has(id)) return this._msgCache.get(id);
        const entity = await this.resolveGroup();
        const res = await this.client.getMessages(entity, { ids: [Number(id)] });
        const m = res && res[0];
        if (m) this._msgCache.set(id, m);
        return m;
    }

    // ---- temas del foro ----
    async getForumTopics() {
        const entity = await this.resolveGroup();
        try {
            const res = await this.client.invoke(new Api.channels.GetForumTopics({
                channel: entity, limit: 100, offsetDate: 0, offsetId: 0, offsetTopic: 0
            }));
            return (res.topics || [])
                .filter(t => t.id !== undefined)
                .map(t => ({ id: t.id, title: t.title || ('Tema ' + t.id) }));
        } catch (e) {
            console.warn('GetForumTopics falló:', e.message);
            return [];
        }
    }

    // ---- mensajes de un tema ----
    async getTopicMessages(topicId, limit) {
        const entity = await this.resolveGroup();
        const opts = { limit: limit || this.cfg.messagesPerTopic };
        if (topicId && Number(topicId) !== 1) opts.replyTo = Number(topicId);
        const msgs = await this.client.getMessages(entity, opts);
        this._cache(msgs);
        return msgs;
    }

    // ---- construir un item de catálogo a partir de un mensaje ----
    buildItem(message, topic) {
        const text = message.message || '';
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        const clean = s => (s || '').replace(/#[\wÀ-ÿ]+/g, '').replace(/https?:\/\/\S+/g, '').trim();
        const title = clean(lines[0]) || topic.name;
        const description = clean(lines.slice(1).join(' '));
        const year = (text.match(/\b(19|20)\d{2}\b/) || [])[0] || '';
        const urlMatch = text.match(/https?:\/\/\S+/);
        const doc = message.media && message.media.document;
        const isVideo = !!(doc && /video|mp4|matroska|x-msvideo|quicktime/.test(doc.mimeType || ''));
        const hasThumb = !!(message.media && (message.media.photo ||
            (doc && doc.thumbs && doc.thumbs.length)));
        return {
            id: message.id,
            topicId: topic.id,
            title,
            description,
            year,
            duration: isVideo ? this._duration(doc) : '',
            size: doc ? this._bytes(doc.size) : '',
            isVideo,
            externalUrl: urlMatch ? urlMatch[0] : '',
            hasThumb,
            streamUrl: isVideo ? `/api/stream/${topic.id}/${message.id}` : '',
            thumbUrl: hasThumb ? `/api/thumb/${topic.id}/${message.id}` : ''
        };
    }

    _duration(doc) {
        const attr = (doc.attributes || []).find(a => a.className === 'DocumentAttributeVideo');
        if (!attr || !attr.duration) return '';
        const t = Number(attr.duration), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
        return h ? `${h}h ${m}m` : `${m} min`;
    }
    _bytes(n) {
        if (!n) return '';
        const u = ['B', 'KB', 'MB', 'GB']; let v = Number(n), i = 0;
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
        return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
    }

    // ---- catálogo completo (todas las categorías Netflix) ----
    async getCatalog() {
        const categories = [];
        for (const topic of this.cfg.topics) {
            let items = [];
            try {
                const msgs = await this.getTopicMessages(topic.id, this.cfg.messagesPerTopic);
                items = msgs
                    .filter(m => (m.media && m.media.document) || m.media || (m.message && /https?:\/\//.test(m.message)))
                    .map(m => this.buildItem(m, topic));
            } catch (e) {
                console.warn(`Tema ${topic.name} falló:`, e.message);
            }
            categories.push({ name: topic.name, icon: topic.icon, type: topic.type, id: topic.id, items });
        }
        return { categories };
    }

    // ---- miniatura ----
    async downloadThumb(topicId, msgId) {
        const message = await this.getMessageById(msgId);
        if (!message || !message.media) return null;
        const media = message.media;
        if (media.photo) {
            return await this.client.downloadMedia(message, {});
        }
        const doc = media.document;
        if (doc && doc.thumbs && doc.thumbs.length) {
            return await this.client.downloadMedia(message, { thumb: doc.thumbs.length - 1 });
        }
        return null;
    }

    // ---- info del documento para el streaming ----
    docInfo(message) {
        const doc = message.media && message.media.document;
        if (!doc) return null;
        return {
            size: Number(doc.size),
            mimeType: doc.mimeType || 'video/mp4',
            location: new Api.InputDocumentFileLocation({
                id: doc.id, accessHash: doc.accessHash, fileReference: doc.fileReference, thumbSize: ''
            }),
            dcId: doc.dcId
        };
    }

    // ---- iterador de descarga para un rango [start, start+length) ----
    streamRange(info, start, length) {
        return this.client.iterDownload({
            file: info.location,
            offset: bigInt(start),
            limit: length,
            requestSize: 512 * 1024,
            dcId: info.dcId
        });
    }
}

module.exports = { TelegramService };
