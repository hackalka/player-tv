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

    // ---- temas del foro (crudos) ----
    async getForumTopics() {
        const entity = await this.resolveGroup();
        try {
            const res = await this.client.invoke(new Api.channels.GetForumTopics({
                channel: entity, limit: 100, offsetDate: 0, offsetId: 0, offsetTopic: 0
            }));
            return (res.topics || [])
                .filter(t => t.id !== undefined && t.title !== undefined)
                .map(t => ({ id: t.id, title: t.title || ('Tema ' + t.id) }));
        } catch (e) {
            console.warn('GetForumTopics falló:', e.message);
            return [];
        }
    }

    // ---- SOLO los temas etiquetados con alguna autoTag, con el nombre ya "limpio" ----
    async getAutoTopics() {
        const tags = (this.cfg.autoTags || []).map(t => t.toLowerCase()).filter(Boolean);
        const all = await this.getForumTopics();
        const matched = all.filter(t => {
            const low = (t.title || '').toLowerCase();
            return tags.some(tag => low.includes(tag));
        });
        return matched.map(t => {
            const info = this._displayInfo(t.title, tags);
            return { id: t.id, rawTitle: t.title, name: info.name, icon: info.icon, type: info.type };
        });
    }

    // Quita las etiquetas del título y deduce un icono según el nombre.
    _displayInfo(title, tags) {
        let name = String(title || '');
        for (const tag of (tags || [])) {
            if (!tag) continue;
            const re = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
            name = name.replace(re, '');
        }
        name = name.replace(/[\-|·•:]+\s*$/g, '').replace(/^\s*[\-|·•:]+/g, '').replace(/\s{2,}/g, ' ').trim();
        if (!name) name = 'Sin nombre';
        const low = name.toLowerCase();
        let icon = '📁', type = 'other';
        if (/pel[ií]cul|movie|cine|film/.test(low)) { icon = '🎬'; type = 'movie'; }
        else if (/serie|series|temporada|tv\b/.test(low)) { icon = '📺'; type = 'series'; }
        else if (/deporte|sport|f[uú]tbol|liga|nba|ufc|box/.test(low)) { icon = '⚽'; type = 'sports'; }
        else if (/doc(u|s)|documental/.test(low)) { icon = '🎥'; type = 'docs'; }
        else if (/anime|manga/.test(low)) { icon = '🌸'; type = 'anime'; }
        else if (/infantil|kids|niñ/.test(low)) { icon = '🧸'; type = 'kids'; }
        return { name, icon, type };
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
        const allLines = text.split('\n').map(s => s.trim());
        const clean = s => (s || '').replace(/#[\wÀ-ÿ]+/g, '').replace(/https?:\/\/\S+/g, '').replace(/acestream:\/\/\S+/ig, '').trim();
        const isUrl = l => /^(acestream:\/\/|https?:\/\/|magnet:)/i.test(l);

        const firstIdx = allLines.findIndex(l => l);
        const title = clean(allLines[firstIdx] || '') || topic.name;

        // Parsear enlaces (varios por post) + sinopsis (lo que no es enlace ni etiqueta de enlace)
        const links = [];
        const synopsisParts = [];
        let pendingLabel = '';
        for (let i = firstIdx + 1; i < allLines.length; i++) {
            const line = allLines[i];
            if (!line) continue;
            if (isUrl(line)) {
                const kind = /^acestream:/i.test(line) ? 'ace' : 'http';
                const label = (pendingLabel || ('Enlace ' + (links.length + 1))).replace(/[:：]\s*$/, '').trim();
                links.push({ label, url: line, kind });
                pendingLabel = '';
            } else {
                // ¿es la etiqueta del siguiente enlace?
                let j = i + 1; while (j < allLines.length && !allLines[j]) j++;
                if (j < allLines.length && isUrl(allLines[j])) pendingLabel = line;
                else synopsisParts.push(line);
            }
        }
        const description = clean(synopsisParts.join(' '));
        const year = (text.match(/\b(19|20)\d{2}\b/) || [])[0] || '';

        const doc = message.media && message.media.document;
        const isVideo = !!(doc && /video|mp4|matroska|x-msvideo|quicktime/.test(doc.mimeType || ''));
        const hasThumb = !!(message.media && (message.media.photo || (doc && doc.thumbs && doc.thumbs.length)));

        let filename = '';
        if (doc) {
            const fn = (doc.attributes || []).find(a => a.className === 'DocumentAttributeFilename');
            if (fn) filename = fn.fileName || '';
        }
        const ext = (filename.match(/\.([a-z0-9]{2,4})$/i) || [])[1]
            || ((doc && (doc.mimeType || '').split('/')[1]) || '').toLowerCase();
        const BROWSER_OK = ['mp4', 'm4v', 'webm', 'ogg', 'ogv', 'mov', 'quicktime'];
        const playableInBrowser = isVideo && BROWSER_OK.includes((ext || '').toLowerCase());

        // compatibilidad: primer ace / primer http sueltos
        const firstAce = links.find(l => l.kind === 'ace');
        const firstHttp = links.find(l => l.kind === 'http');

        return {
            id: message.id,
            topicId: topic.id,
            uid: doc && doc.id ? String(doc.id) : '',
            title,
            description,
            year,
            duration: isVideo ? this._duration(doc) : '',
            size: doc ? this._bytes(doc.size) : '',
            isVideo,
            ext: (ext || '').toLowerCase(),
            playableInBrowser,
            links,
            aceUrl: firstAce ? firstAce.url : '',
            externalUrl: firstHttp ? firstHttp.url : '',
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

    // ---- catálogo completo: una categoría por cada tema etiquetado ----
    async getCatalog() {
        const topics = await this.getAutoTopics();
        const categories = [];
        for (const topic of topics) {
            let items = [];
            try {
                const msgs = await this.getTopicMessages(topic.id, this.cfg.messagesPerTopic);
                items = this._buildTopicItems(msgs, topic);
            } catch (e) {
                console.warn(`Tema ${topic.name} falló:`, e.message);
            }
            categories.push({ name: topic.name, icon: topic.icon, type: topic.type, id: topic.id, items });
        }
        return { categories };
    }

    // Construye los items de un tema. Las SERIES se agrupan en "shows" con episodios.
    _buildTopicItems(msgs, topic) {
        const raw = msgs
            .filter(m => (m.media && m.media.document) || m.media || (m.message && /https?:\/\//.test(m.message)) || (m.message && /acestream/i.test(m.message)))
            .map(m => this.buildItem(m, topic));

        // SIN series -> lista plana SIN duplicados (mismo título o mismo vídeo)
        if (topic.type !== 'series') {
            const seen = new Set();
            const out = [];
            for (const it of raw) {
                const kTitle = 't:' + this._slug(it.title);
                const kUid = it.uid ? 'u:' + it.uid : null;
                if (seen.has(kTitle) || (kUid && seen.has(kUid))) continue;
                seen.add(kTitle); if (kUid) seen.add(kUid);
                out.push(it);
            }
            return out;
        }

        // SERIES -> agrupar por nombre base
        const groups = new Map();
        for (const it of raw) {
            const ep = this._parseEpisode(it.title);
            const base = (ep && ep.base) ? ep.base : it.title;
            const key = this._slug(base);
            if (!groups.has(key)) groups.set(key, { base, eps: [] });
            const g = groups.get(key);
            g.eps.push({ it, ep: ep || { season: 1, ep: g.eps.length + 1, guessed: true } });
        }

        const shows = [];
        for (const [key, g] of groups) {
            // ordenar y quitar capítulos duplicados (mismo nº o mismo vídeo)
            const sorted = g.eps.sort((a, b) => (a.ep.season - b.ep.season) || (a.ep.ep - b.ep.ep));
            const seenEp = new Set();
            const eps = [];
            for (const e of sorted) {
                const kNum = `${e.ep.season}-${e.ep.ep}`;
                const kUid = e.it.uid ? 'u:' + e.it.uid : null;
                if (seenEp.has(kNum) || (kUid && seenEp.has(kUid))) continue;
                seenEp.add(kNum); if (kUid) seenEp.add(kUid);
                eps.push(e);
            }
            const poster = (eps.find(e => e.it.hasThumb) || eps[0]).it;
            const episodes = eps.map(e => ({
                id: e.it.id,
                title: this._epLabel(e.ep),
                epNum: e.ep.ep,
                season: e.ep.season,
                streamUrl: e.it.streamUrl,
                externalUrl: e.it.externalUrl,
                aceUrl: e.it.aceUrl,
                links: e.it.links,
                ext: e.it.ext,
                playableInBrowser: e.it.playableInBrowser,
                thumbUrl: e.it.thumbUrl,
                duration: e.it.duration,
                size: e.it.size,
                description: e.it.description
            }));
            shows.push({
                id: 's-' + topic.id + '-' + key,
                topicId: topic.id,
                title: g.base || 'Serie',
                description: (eps.find(e => e.it.description) || eps[0]).it.description || '',
                year: (eps.find(e => e.it.year) || eps[0]).it.year || '',
                isSeries: episodes.length > 1,
                episodeCount: episodes.length,
                thumbUrl: poster.thumbUrl,
                episodes
            });
        }
        return shows;
    }

    // Detecta el número de episodio en un título: S01E02 / T1E02 / 1x02 / Capítulo 3 ...
    _parseEpisode(title) {
        const t = String(title || '');
        let m;
        m = t.match(/\b[st](\d{1,2})\s*[ex](\d{1,3})\b/i);          // s01e02 / t1e02
        if (m) return { season: +m[1], ep: +m[2], base: t.slice(0, m.index).trim() };
        m = t.match(/\b(\d{1,2})\s*x\s*(\d{1,3})\b/i);              // 1x02
        if (m) return { season: +m[1], ep: +m[2], base: t.slice(0, m.index).trim() };
        m = t.match(/(cap[ií]tulo|cap\.?|episodio|epis\.?|ep\.?)\s*\.?\s*(\d{1,3})/i); // capítulo 3
        if (m) return { season: 1, ep: +m[2], base: t.slice(0, m.index).trim() };
        return null;
    }

    _epLabel(ep) {
        return (ep.season && ep.season > 1)
            ? `T${ep.season} · Capítulo ${ep.ep}`
            : `Capítulo ${ep.ep}`;
    }

    _slug(s) {
        return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
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

    // ---- ADMIN: editar el texto/caption de un mensaje ----
    async editMessageText(msgId, text) {
        const entity = await this.resolveGroup();
        await this.client.editMessage(entity, { message: Number(msgId), text: String(text) });
        this._msgCache.delete(Number(msgId));
    }

    // ---- ADMIN: borrar un mensaje ----
    async deleteMessage(msgId) {
        const entity = await this.resolveGroup();
        await this.client.deleteMessages(entity, [Number(msgId)], { revoke: true });
        this._msgCache.delete(Number(msgId));
    }
}

module.exports = { TelegramService };
