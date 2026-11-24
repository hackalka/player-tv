/* ===================================================================
 * TelegramService (version navegador) - portado de server/telegram.js
 * Usa GramJS cargado como window.telegram. Misma logica que el backend,
 * pero las URLs de stream/miniatura son RELATIVAS para que las capture
 * el Service Worker (stream-sw.js).
 * =================================================================== */
(function () {
    'use strict';
    let Api = null;
    function _libs() {
        Api = window.telegram.Api;
    }

    class TelegramService {
        constructor(client, cfg) {
            _libs();
            this.client = client;
            this.cfg = cfg;
            this.Api = Api;
            this.entity = null;
            this._msgCache = new Map();
            this._refCache = new Map();
            this._chanCache = new Map();
        }

        async resolveGroup() {
            if (this.entity) return this.entity;
            const raw = String(this.cfg.groupId).trim();
            const id = /^-?\d+$/.test(raw) ? parseInt(raw, 10) : raw;

            // 1) Intento directo
            try { this.entity = await this.client.getEntity(id); return this.entity; }
            catch (e) { console.warn('[tg] getEntity directo fallo:', e && e.message); }

            // 2) Tras refrescar dialogos
            try { await this.client.getDialogs({ limit: 1000 }); }
            catch (e) { console.warn('[tg] getDialogs fallo:', e && e.message); }
            try { this.entity = await this.client.getEntity(id); return this.entity; }
            catch (e) { console.warn('[tg] getEntity tras getDialogs fallo:', e && e.message); }

            // 3) Fallback: iterar dialogos buscando manualmente. Usa los datos
            //    que GramJS YA tiene en cache (sin hacer otra peticion que pueda
            //    chocar con un TL desconocido).
            const wantNum = typeof id === 'number' ? id : null;
            const wantUser = typeof id === 'string' ? id.replace(/^@/, '').toLowerCase() : '';
            try {
                for await (const dialog of this.client.iterDialogs({ limit: 5000 })) {
                    try {
                        const ent = dialog.entity; if (!ent || ent.id == null) continue;
                        const eid = Number(ent.id.toString());
                        if (wantNum != null) {
                            // Telegram representa supergrupos/canales como -100<id>
                            if (wantNum === eid || wantNum === -1000000000000 - eid || wantNum === -eid) {
                                this.entity = ent; return this.entity;
                            }
                        } else if (wantUser && (ent.username || '').toLowerCase() === wantUser) {
                            this.entity = ent; return this.entity;
                        }
                    } catch (e2) { /* saltar dialogos rotos */ }
                }
            } catch (e) { console.warn('[tg] iterDialogs fallo:', e && e.message); }

            throw new Error('Grupo no accesible para tu cuenta. Comprueba el groupId en tg-config.js o que estás suscrito al grupo.');
        }

        _cache(messages) { for (const m of messages) if (m && m.id != null) this._msgCache.set(m.id, m); }

        async getMessageById(id) {
            if (this._msgCache.has(id)) return this._msgCache.get(id);
            const entity = await this.resolveGroup();
            const res = await this.client.getMessages(entity, { ids: [Number(id)] });
            const m = res && res[0];
            if (m) this._msgCache.set(id, m);
            return m;
        }

        async _resolveChannel(channel) {
            if (this._chanCache.has(channel)) return this._chanCache.get(channel);
            const raw = String(channel);
            const id = /^-?\d+$/.test(raw) ? parseInt(raw, 10) : raw;
            let ent;
            try { ent = await this.client.getEntity(id); }
            catch (e) { await this.client.getDialogs({ limit: 1000 }); ent = await this.client.getEntity(id); }
            this._chanCache.set(channel, ent);
            return ent;
        }

        async getMessageByRef(channel, msgId) {
            const key = channel + ':' + msgId;
            if (this._refCache.has(key)) return this._refCache.get(key);
            const entity = await this._resolveChannel(channel);
            const res = await this.client.getMessages(entity, { ids: [Number(msgId)] });
            const m = res && res[0];
            if (m) this._refCache.set(key, m);
            return m;
        }

        async getForumTopics(options) {
            options = options || {};
            const tags = options.stopAfterAutoTag ? this._autoTags() : [];
            const entity = await this.resolveGroup();
            try {
                const topics = [], seen = new Set();
                let offsetDate = 0, offsetId = 0, offsetTopic = 0;
                for (let page = 0; page < 100; page++) {
                    const res = await this.client.invoke(new Api.channels.GetForumTopics({
                        channel: entity, limit: 100, offsetDate, offsetId, offsetTopic
                    }));
                    const pageTopics = (res.topics || []).filter(t => t.id !== undefined && t.title !== undefined);
                    let added = 0;
                    pageTopics.forEach(topic => {
                        const id = String(topic.id);
                        if (seen.has(id)) return;
                        seen.add(id);
                        topics.push({ id: topic.id, title: topic.title || ('Tema ' + topic.id) });
                        added++;
                    });
                    if (tags.length && pageTopics.some(topic =>
                        tags.some(tag => String(topic.title || '').toLowerCase().includes(tag))
                    )) return topics;
                    if (!added || pageTopics.length < 100 || (res.count && topics.length >= res.count)) break;

                    const last = pageTopics[pageTopics.length - 1];
                    const topMessageId = Number(last.topMessage || 0);
                    const topMessage = (res.messages || []).find(message => Number(message.id) === topMessageId);
                    offsetDate = Number((topMessage && topMessage.date) || last.date || 0);
                    offsetId = topMessageId;
                    offsetTopic = Number(last.id) || 0;
                    if (!offsetTopic) break;
                }
                return topics;
            } catch (e) {
                console.warn('GetForumTopics fallo:', e.message);
                return [];
            }
        }

        _autoTags() {
            return (this.cfg.autoTags || [])
                .map(tag => String(tag || '').trim().toLowerCase())
                .filter(Boolean);
        }

        async hasAutoTopics() {
            const tags = this._autoTags();
            if (!tags.length) return false;
            const topics = await this.getForumTopics({ stopAfterAutoTag: true });
            return topics.some(topic =>
                tags.some(tag => String(topic.title || '').toLowerCase().includes(tag))
            );
        }

        async getAutoTopics() {
            const tags = this._autoTags();
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

        _displayInfo(title, tags) {
            let name = String(title || '');
            for (const tag of (tags || [])) {
                if (!tag) continue;
                const re = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
                name = name.replace(re, '');
            }
            let forced = '';
            const fm = name.match(/@(series|tv|peliculas|pelicula|movies|movie|deportes|sports|docu|documental|anime|kids|infantil)/i);
            if (fm) {
                const t = fm[1].toLowerCase();
                if (/series|tv/.test(t)) forced = 'series';
                else if (/peliculas|pelicula|movies|movie/.test(t)) forced = 'movie';
                else if (/deportes|sports/.test(t)) forced = 'sports';
                else if (/docu/.test(t)) forced = 'docs';
                else if (/anime/.test(t)) forced = 'anime';
                else if (/kids|infantil/.test(t)) forced = 'kids';
                name = name.replace(fm[0], '');
            }
            name = name.replace(/[\-|·•:]+\s*$/g, '').replace(/^\s*[\-|·•:]+/g, '').replace(/\s{2,}/g, ' ').trim();
            if (!name) name = 'Sin nombre';
            const low = name.toLowerCase();
            let icon = '📁', type = 'other';
            if (/\bserie(s)?\b|\btemporada(s)?\b|\bcap[ií]tulos?\b/.test(low)) { icon = '📺'; type = 'series'; }
            else if (/\bpel[ií]cul(a|as)?\b|\bmovie(s)?\b|\bcine\b|\bfilm(s)?\b/.test(low)) { icon = '🎬'; type = 'movie'; }
            else if (/\bdeporte(s)?\b|\bsport(s)?\b|\bf[uú]tbol\b|\bliga\b|\bnba\b|\bufc\b|\bbox(eo)?\b/.test(low)) { icon = '⚽'; type = 'sports'; }
            else if (/\bdocu(mental(es)?)?\b|\bdocs?\b/.test(low)) { icon = '🎥'; type = 'docs'; }
            else if (/\banime\b|\bmanga\b/.test(low)) { icon = '🌸'; type = 'anime'; }
            else if (/\binfantil(es)?\b|\bkids\b|\bniñ[oa]s?\b/.test(low)) { icon = '🧸'; type = 'kids'; }
            if (forced) type = forced;
            return { name, icon, type };
        }

        async getTopicMessages(topicId, limit) {
            const entity = await this.resolveGroup();
            const target = limit || this.cfg.messagesPerTopic;
            const opts = { limit: target };
            if (topicId && Number(topicId) !== 1) opts.replyTo = Number(topicId);
            const all = [];
            try {
                for await (const m of this.client.iterMessages(entity, opts)) {
                    all.push(m);
                    if (all.length >= target) break;
                }
            } catch (e) {
                console.warn('[tg] iterMessages fallo, usando getMessages:', e.message);
                const msgs = await this.client.getMessages(entity, opts);
                if (msgs) all.push(...msgs);
            }
            this._cache(all);
            return all;
        }

        buildItem(message, topic) {
            const rawText = message.message || '';
            // Metadatos de la ficha publicados en el mensaje: linea "#tvplus:{...}"
            let embed = {};
            const emb = rawText.match(/#tvplus:(\{[\s\S]*?\})\s*$/im);
            if (emb) { try { embed = JSON.parse(emb[1]) || {}; } catch (e) { embed = {}; } }
            // Texto sin la linea de metadatos (para no ensuciar titulo/sinopsis)
            const text = rawText.replace(/\n?#tvplus:\{[\s\S]*?\}\s*$/im, '').replace(/📖\s?/g, '').trim();
            const allLines = text.split('\n').map(s => s.trim());
            const clean = s => (s || '').replace(/#[\wÀ-ÿ]+/g, '').replace(/https?:\/\/\S+/g, '').replace(/acestream:\/\/\S+/ig, '').replace(/tvgram:\/\/\S+/ig, '').trim();
            const isUrl = l => /^(acestream:\/\/|https?:\/\/|magnet:|tvgram:\/\/)/i.test(l);
            const isLocalVideoRef = l => /^url\s*=\s*\d+$/i.test(l);

            const firstIdx = allLines.findIndex(l => l);
            let title = clean(allLines[firstIdx] || '') || topic.name;
            title = title.replace(/\s*\b(19|20)\d{2}\b\s*$/, '').trim() || title;

            const links = [];
            let pendingLabel = '';
            for (let i = firstIdx + 1; i < allLines.length; i++) {
                const line = allLines[i];
                if (!line) continue;
                const localVideo = line.match(/^url\s*=\s*(\d+)\s*$/i);
                const localVideoId = localVideo ? Number(localVideo[1]) : 0;
                if (Number.isSafeInteger(localVideoId) && localVideoId > 0) {
                    links.push({
                        label: pendingLabel || 'Vídeo Telegram',
                        url: line, kind: 'tg-local', msgId: localVideoId, topicId: topic.id
                    });
                    pendingLabel = '';
                    continue;
                }
                if (isUrl(line)) {
                    let kind = /^acestream:/i.test(line) ? 'ace' : (/^tvgram:/i.test(line) ? 'tvgram' : 'http');
                    const metadataSource = this._metadataProvider(line);
                    const link = {
                        label: (pendingLabel || (metadataSource ? metadataSource.label : ('Enlace ' + (links.length + 1)))).replace(/[:：]\s*$/, '').trim(),
                        url: line, kind, metadataSource, metadataOnly: !!metadataSource
                    };
                    const tme = this._parseTme(line);
                    if (tme) { link.kind = 'tg'; link.channel = tme.channel; link.msgId = tme.msgId; }
                    links.push(link);
                    pendingLabel = '';
                } else {
                    let j = i + 1; while (j < allLines.length && !allLines[j]) j++;
                    if (j < allLines.length && isUrl(allLines[j])) pendingLabel = line;
                }
            }
            links.forEach(l => {
                if (!l.metadataOnly) Object.assign(l, this._linkPlayable(l));
            });

            const meta = {};
            const mg = text.match(/g[eé]neros?\s*:\s*([^\n]+)/i); if (mg) meta.genres = mg[1].trim();
            const mr = text.match(/puntuaci[oó]n\s*:\s*([0-9.]+\s*\/?\s*[0-9]*)/i); if (mr) meta.rating = mr[1].replace(/\s+/g, '');
            const ms = text.match(/temporadas?\s*:\s*(\d+)/i); if (ms) meta.seasons = ms[1];
            const me = text.match(/episodios?\s*:\s*(\d+)/i); if (me) meta.episodesCount = me[1];
            const mst = text.match(/\b(en emisi[oó]n|finalizad[ao]|estreno|pr[oó]ximamente)\b/i); if (mst) meta.status = mst[1];

            let description = '';
            const sinIdx = allLines.findIndex(l => /sinopsis/i.test(l));
            if (sinIdx >= 0) {
                const parts = [];
                const after = allLines[sinIdx].split(/sinopsis\s*:?/i)[1];
                if (after && after.trim()) parts.push(after.trim());
                for (let i = sinIdx + 1; i < allLines.length; i++) {
                    const line = allLines[i]; if (!line) continue;
                    if (isUrl(line) || isLocalVideoRef(line)) break;
                    let j = i + 1; while (j < allLines.length && !allLines[j]) j++;
                    if (j < allLines.length && (isUrl(allLines[j]) || isLocalVideoRef(allLines[j]))) break;
                    if (/^[]|g[eé]neros|temporadas|episodios|puntuaci|estreno/i.test(line)) continue;
                    parts.push(line);
                }
                description = clean(parts.join(' '));
            }
            if (!description) {
                const parts = [];
                for (let i = firstIdx + 1; i < allLines.length; i++) {
                    const line = allLines[i]; if (!line || isUrl(line) || isLocalVideoRef(line)) continue;
                    let j = i + 1; while (j < allLines.length && !allLines[j]) j++;
                    if (j < allLines.length && (isUrl(allLines[j]) || isLocalVideoRef(allLines[j]))) continue;
                    if (/^[]|g[eé]neros|temporadas|episodios|puntuaci|estreno|sinopsis|en emisi/i.test(line)) continue;
                    parts.push(line);
                }
                description = clean(parts.join(' '));
            }

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

            const firstAce = links.find(l => l.kind === 'ace');
            const firstTvgram = links.find(l => l.kind === 'tvgram');
            const firstHttp = links.find(l => !l.metadataOnly && (l.kind === 'http' || l.kind === 'tg'));

            const item = {
                id: message.id,
                topicId: topic.id,
                uid: doc && doc.id ? String(doc.id) : '',
                title, description, year, meta,
                metadataLinks: links.filter(l => l.metadataSource),
                date: Number(message.date) || 0,
                duration: isVideo ? this._duration(doc) : '',
                size: doc ? this._bytes(doc.size) : '',
                isVideo,
                ext: (ext || '').toLowerCase(),
                playableInBrowser,
                links: links.filter(l => !l.metadataOnly),
                aceUrl: firstAce ? firstAce.url : '',
                tvgramUrl: firstTvgram ? firstTvgram.url : '',
                externalUrl: firstHttp ? firstHttp.url : '',
                hasThumb,
                streamUrl: isVideo ? `tgstream/${topic.id}/${message.id}?group=${encodeURIComponent(String(this.cfg.groupId || ''))}` : '',
                thumbUrl: hasThumb ? `tgthumb/${topic.id}/${message.id}?group=${encodeURIComponent(String(this.cfg.groupId || ''))}` : ''
            };

            // Aplicar metadatos embebidos (#tvplus) -> mandan sobre lo detectado
            if (embed && typeof embed === 'object') {
                if (embed.title) item.title = embed.title;
                if (embed.desc) item.description = embed.desc;
                if (embed.year) item.year = String(embed.year);
                if (embed.cover) item.cover = embed.cover;       // poster (URL)
                if (embed.backdrop) item.backdrop = embed.backdrop;
                if (embed.trailer) item.trailer = embed.trailer;
                if (embed.rating) item.meta = Object.assign({}, item.meta, { rating: String(embed.rating) });
                if (embed.genres) item.meta = Object.assign({}, item.meta, { genres: embed.genres });
                // Enlace de vídeo embebido "dentro de la carátula"
                if (embed.video) {
                    const v = String(embed.video);
                    const gid = String(this.cfg.groupId).replace(/^-100/, '').replace(/^-/, '');
                    // ¿Es el enlace del PROPIO mensaje (copiar enlace)? Entonces NO
                    // añadimos un Play duplicado: la ficha ya reproduce su vídeo.
                    const isSelf = new RegExp('/c/' + gid + '/(\\d+/)?' + message.id + '/?$').test(v);
                    item.copyLink = v;
                    if (!isSelf) {
                        const k = /^tvgram:/i.test(v) ? 'tvgram' : (/^acestream:/i.test(v) ? 'ace' : 'http');
                        const lk = Object.assign({ label: item.title, url: v, kind: k }, this._linkPlayable({ url: v, kind: k }));
                        item.links = [lk].concat(item.links || []);
                        if (k === 'tvgram') item.tvgramUrl = v;
                        else if (k === 'ace') item.aceUrl = v;
                        else { item.externalUrl = v; if (/\.(mp4|m4v|webm|mov)(\?|#|$)/i.test(v)) item.playableInBrowser = true; }
                    }
                }
                item.embed = embed;
            }
            return item;
        }

        _metadataProvider(rawUrl) {
            let url;
            try { url = new URL(rawUrl); } catch (e) { return null; }
            if (url.protocol !== 'https:') return null;
            const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
            if (host === 'filmaffinity.com' && /^\/[a-z]{2}\/film\d+\.html$/i.test(url.pathname)) {
                return { kind: 'filmaffinity', label: 'FilmAffinity' };
            }
            return null;
        }

        _parseTme(url) {
            let m = url.match(/t\.me\/c\/(\d+)\/(?:\d+\/)?(\d+)/i);
            if (m) return { channel: '-100' + m[1], msgId: Number(m[2]) };
            m = url.match(/t\.me\/([A-Za-z0-9_]+)\/(?:\d+\/)?(\d+)/i);
            if (m) return { channel: m[1], msgId: Number(m[2]) };
            return null;
        }

        _linkPlayable(link) {
            if (link.kind === 'tg-local') return {
                streamUrl: `tgstream/${link.topicId}/${link.msgId}?group=${encodeURIComponent(String(this.cfg.groupId || ''))}`,
                externalUrl: '',
                thumbUrl: `tgthumb/${link.topicId}/${link.msgId}?group=${encodeURIComponent(String(this.cfg.groupId || ''))}`,
                playableInBrowser: true
            };
            if (link.kind === 'tg') return {
                streamUrl: `tgstreamlink/${encodeURIComponent(link.channel)}/${link.msgId}?group=${encodeURIComponent(String(this.cfg.groupId || ''))}`,
                externalUrl: link.url,
                thumbUrl: `tgthumblink/${encodeURIComponent(link.channel)}/${link.msgId}?group=${encodeURIComponent(String(this.cfg.groupId || ''))}`,
                playableInBrowser: true
            };
            if (link.kind === 'ace') return { aceUrl: link.url, externalUrl: '', playableInBrowser: false };
            if (link.kind === 'tvgram') return { tvgramUrl: link.url, externalUrl: '', playableInBrowser: false };
            const url = link.url || '';
            if (/\.(mp4|m4v|webm|ogg|ogv|mov)(\?|#|$)/i.test(url)) return { streamUrl: url, externalUrl: url, playableInBrowser: true };
            return { externalUrl: url, playableInBrowser: false };
        }

        _movieKey(title) {
            let t = String(title || '').toLowerCase();
            t = t.replace(/^\s*\d{2,}\s*[-_.:]\s*/, ' ');
            t = t.replace(/\b(2160p|1080p|720p|480p|4k|uhd|fhd|hdr|hd|bluray|brrip|bdrip|webrip|web-?dl|dvdrip|hdtv|x264|x265|h264|h265|hevc|aac|ac3|dts|dual|latino|castellano|espa[ñn]ol|spanish|english|vose|vos|sub(?:s|titulad[oa])?)\b/ig, ' ');
            t = t.replace(/[\[\(].*?[\]\)]/g, ' ');
            t = t.replace(/\b(19|20)\d{2}\b/g, ' ');
            const slug = this._slug(t);
            if (!slug || slug === 'x' || slug.length < 2) return 't:' + this._slug(title);
            return 't:' + slug;
        }

        _qualityTag(title) {
            const m = String(title || '').match(/\b(2160p|1080p|720p|480p|4k|uhd|hdr|latino|castellano|espa[ñn]ol|spanish|english|vose|vos|dual)\b/i);
            return m ? m[0].toUpperCase() : '';
        }

        _movieSources(it) {
            const out = [];
            if (it.links && it.links.length) {
                it.links.forEach(l => out.push({
                    label: l.label || it.title,
                    streamUrl: l.streamUrl || '',
                    externalUrl: l.externalUrl || '',
                    aceUrl: l.kind === 'ace' ? l.url : (l.aceUrl || ''),
                    tvgramUrl: l.kind === 'tvgram' ? l.url : (l.tvgramUrl || ''),
                    telegramMessageId: l.kind === 'tg-local' ? String(l.msgId) : undefined,
                    thumbUrl: l.thumbUrl || it.thumbUrl || '',
                    ext: l.ext || '',
                    playableInBrowser: l.playableInBrowser === true
                }));
                return out;
            }
            if (it.streamUrl || it.aceUrl || it.externalUrl || it.tvgramUrl) {
                out.push({
                    label: it.title,
                    streamUrl: it.streamUrl || '',
                    externalUrl: it.externalUrl || '',
                    aceUrl: it.aceUrl || '',
                    tvgramUrl: it.tvgramUrl || '',
                    thumbUrl: it.thumbUrl || '',
                    ext: it.ext || '',
                    playableInBrowser: it.playableInBrowser !== false
                });
            }
            return out;
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


        // Catalogo. Si pasas {limit: N} solo trae N mensajes por tema (carga rapida).
        // Si no, usa cfg.messagesPerTopic completo (carga total).
        async getCatalog(opts) {
            opts = opts || {};
            const perTopic = Number(opts.limit) || this.cfg.messagesPerTopic;
            const topics = await this.getAutoTopics();
            const categories = [];
            for (const topic of topics) {
                let items = [];
                try {
                    const msgs = await this.getTopicMessages(topic.id, perTopic);
                    items = this._buildTopicItems(msgs, topic);
                } catch (e) { console.warn(`Tema ${topic.name} fallo:`, e.message); }
                categories.push({ name: topic.name, icon: topic.icon, type: topic.type, id: topic.id, items });
            }
            const linkedVideoRefs = new Set();
            categories.forEach(category => category.items.forEach(item => {
                (item.links || []).forEach(link => {
                    const ref = this._telegramMessageRef(link.streamUrl);
                    if (ref) linkedVideoRefs.add(`${ref.channel}:${ref.msgId}`);
                });
            }));
            const catalogGroup = this._normalizeTelegramChannel(this.cfg.groupId);
            categories.forEach(category => {
                category.items = category.items.filter(item =>
                    !linkedVideoRefs.has(`${catalogGroup}:${item.id}`)
                );
            });
            return { categories, partial: !!opts.limit };
        }

        _normalizeTelegramChannel(channel) {
            return String(channel || '').trim().replace(/^@/, '').toLowerCase();
        }

        _telegramMessageRef(streamUrl) {
            const match = String(streamUrl || '').match(/^tgstream(link)?\/([^/]+)\/(\d+)/);
            if (!match) return null;
            const channel = match[1]
                ? decodeURIComponent(match[2])
                : this.cfg.groupId;
            return {
                channel: this._normalizeTelegramChannel(channel),
                msgId: match[3].replace(/^0+(?=\d)/, '')
            };
        }

        _buildTopicItems(msgs, topic) {
            const raw = msgs
                .filter(m => {
                    if (m.media && m.media.document) return true;
                    if (m.media) return true;
                    const t = m.message || '';
                    if (/https?:\/\//.test(t)) return true;
                    const firstLine = (t.split('\n')[0] || '').trim();
                    if (firstLine.length >= 3 && firstLine.length <= 280) return true;
                    return false;
                })
                .map(m => this.buildItem(m, topic));

            const videosById = new Map();
            const videosByCode = new Map();
            raw.forEach(item => {
                if (!item.isVideo) return;
                videosById.set(String(item.id), item);
                const code = String(item.title || '').match(/^\s*(\d+)\s*[-_.:]\s*/);
                if (code) videosByCode.set(String(Number(code[1])), item);
            });
            raw.forEach(item => {
                (item.links || []).forEach(link => {
                    if (link.kind !== 'tg-local') return;
                    const target = videosById.get(String(link.msgId)) || videosByCode.get(String(link.msgId));
                    if (!target) return;
                    link.msgId = target.id;
                    link.topicId = target.topicId;
                    Object.assign(link, this._linkPlayable(link));
                });
            });

            const seriesHint = (it) => /\btemporada\s*\d+|\bs\d{1,2}\s*e\d{1,3}\b|\b\d{1,2}\s*x\s*\d{1,3}\b|cap[ií]tulo|episodio|\bt\s*[-_.]?\s*\d{1,2}\b/i.test(it.title || '');
            const promoteToSeries = topic.type !== 'series' && raw.some(seriesHint);
            if (promoteToSeries) topic = Object.assign({}, topic, { type: 'series', _promoted: true });

            if (topic.type !== 'series') {
                const groups = new Map();
                const order = [];
                for (const it of raw) {
                    const key = this._movieKey(it.title);
                    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
                    groups.get(key).push(it);
                }
                const out = [];
                for (const key of order) {
                    const items = groups.get(key);
                    const base = items.find(x => !x.isVideo && x.hasThumb) || items.find(x => x.hasThumb) || items[0];
                    const sources = [];
                    const seenSig = new Set();
                    const seenUid = new Set();
                    for (const it of items) {
                        if (it.uid) { if (seenUid.has(it.uid)) continue; seenUid.add(it.uid); }
                        const subs = this._movieSources(it);
                        subs.forEach(s => {
                            const telegramRef = this._telegramMessageRef(s.streamUrl);
                            const sig = telegramRef
                                ? `tg:${telegramRef.channel}:${telegramRef.msgId}`
                                : (s.aceUrl || s.tvgramUrl || s.streamUrl || s.externalUrl || s.label);
                            if (!sig || seenSig.has(sig)) return;
                            seenSig.add(sig);
                            if (subs.length === 1) {
                                const q = this._qualityTag(it.title);
                                s.label = q || (items.length > 1 ? 'Opción ' + (sources.length + 1) : (s.label || it.title));
                            }
                            sources.push(s);
                        });
                    }
                    const merged = Object.assign({}, base);
                    if (sources.length) {
                        merged.links = sources;
                        if (sources.length > 1) {
                            merged.aceUrl = ''; merged.streamUrl = ''; merged.externalUrl = '';
                        } else {
                            const poster = merged.cover || merged.thumbUrl;
                            Object.assign(merged, sources[0]);
                            if (poster) merged.thumbUrl = poster;
                        }
                    }
                    out.push(merged);
                }
                return out;
            }

            const groups = new Map();
            for (const it of raw) {
                const epLinks = (it.links || []).filter(l =>
                    /\b\d{1,2}\s*x\s*\d{1,3}\b/i.test(l.label) || /cap[ií]tulo|episodio|\bep\b/i.test(l.label));
                const isSelfSeries = (it.links && it.links.length) && (it.links.length > 1 || epLinks.length > 0);
                const ep = this._parseEpisode(it.title);
                const baseRaw = (ep && ep.base) ? ep.base : it.title;
                const base = this._normalizeShowName(baseRaw);
                const key = this._slug(base);
                const postSeason = ep ? ep.season : 1;
                if (!groups.has(key)) groups.set(key, { base, eps: [] });
                const g = groups.get(key);

                if (isSelfSeries) {
                    it.links.forEach((l, i) => {
                        const lEp = this._parseEpisode(l.label);
                        const season = (lEp && lEp.season) || postSeason || 1;
                        const epNum = (lEp && lEp.ep) || (i + 1);
                        const pl = this._linkPlayable(l);
                        const pseudo = Object.assign({
                            id: it.id + '-l' + i,
                            title: this._epLabel({ season, ep: epNum }),
                            thumbUrl: pl.thumbUrl || it.thumbUrl,
                            description: it.description, year: it.year, meta: it.meta, date: it.date,
                            hasThumb: !!it.hasThumb, uid: it.uid + ':' + i, _showSeason: season, _showEp: epNum
                        }, pl);
                        g.eps.push({ it: pseudo, ep: { season, ep: epNum } });
                    });
                } else {
                    g.eps.push({ it, ep: ep || { season: 1, ep: g.eps.length + 1, guessed: true } });
                }
            }

            const shows = [];
            for (const [key, g] of groups) {
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
                    id: e.it.id, title: this._epLabel(e.ep), epNum: e.ep.ep, season: e.ep.season,
                    streamUrl: e.it.streamUrl, externalUrl: e.it.externalUrl, aceUrl: e.it.aceUrl, links: e.it.links,
                    ext: e.it.ext, playableInBrowser: e.it.playableInBrowser, thumbUrl: e.it.thumbUrl,
                    duration: e.it.duration, size: e.it.size, description: e.it.description
                }));
                shows.push({
                    id: 's-' + topic.id + '-' + key, topicId: topic.id, title: this._titleCase(g.base) || 'Serie',
                    description: (eps.find(e => e.it.description) || eps[0]).it.description || '',
                    year: (eps.find(e => e.it.year) || eps[0]).it.year || '',
                    meta: (eps.find(e => e.it.meta && Object.keys(e.it.meta).length) || eps[0]).it.meta || {},
                    date: Math.max(...eps.map(e => e.it.date || 0)),
                    isSeries: episodes.length > 1, episodeCount: episodes.length, thumbUrl: poster.thumbUrl, episodes
                });
            }
            return shows;
        }

        _showFromPost(it, topic) {
            const episodes = it.links.map((l, i) => {
                const ep = this._parseEpisode(l.label) || { season: 1, ep: i + 1 };
                const pl = this._linkPlayable(l);
                return Object.assign({
                    id: it.id + '-l' + i, title: this._epLabel(ep), epNum: ep.ep, season: ep.season,
                    thumbUrl: pl.thumbUrl || it.thumbUrl, duration: '', size: '', description: ''
                }, pl);
            }).sort((a, b) => (a.season - b.season) || (a.epNum - b.epNum));
            return {
                id: 's-' + topic.id + '-' + this._slug(it.title), topicId: topic.id, title: it.title,
                description: it.description, year: it.year, meta: it.meta || {}, date: it.date || 0,
                isSeries: episodes.length > 1, episodeCount: episodes.length, thumbUrl: it.thumbUrl, episodes
            };
        }

        _parseEpisode(title) {
            const t = String(title || '');
            let m;
            m = t.match(/\b[st]\s*\.?\s*-?\s*(\d{1,2})\s*[ex]\s*\.?\s*(\d{1,3})\b/i);
            if (m) return { season: +m[1], ep: +m[2], base: t.slice(0, m.index) };
            m = t.match(/\b(\d{1,2})\s*x\s*(\d{1,3})\b/i);
            if (m) return { season: +m[1], ep: +m[2], base: t.slice(0, m.index) };
            m = t.match(/(cap[ií]tulo|cap\.?|episodio|epis\.?|ep\.?)\s*\.?\s*(\d{1,3})/i);
            if (m) return { season: 1, ep: +m[2], base: t.slice(0, m.index) };
            m = t.match(/(?:^|[\s\(\[])temporada\s*(\d{1,2})\b/i) || t.match(/(?:^|[\s\(\[])t\s*[-_.]?\s*(\d{1,2})\b/i);
            if (m) return { season: +m[1], ep: 1, base: t.slice(0, m.index), packSeason: true };
            return null;
        }
        _normalizeShowName(s) {
            return String(s || '')
                .replace(/\([^)]*\)/g, ' ')
                .replace(/\b(19|20)\d{2}\b/g, ' ')
                .replace(/[\-–—]+\s*$/g, ' ')
                .replace(/[^a-zA-Z0-9À-ÿ\s]+/g, ' ')
                .replace(/\s{2,}/g, ' ')
                .trim();
        }
        _titleCase(s) {
            const str = String(s || '').trim();
            if (!str) return '';
            if (str === str.toUpperCase()) {
                return str.toLowerCase().replace(/\b([a-zà-ÿ])/g, c => c.toUpperCase());
            }
            return str;
        }
        _epLabel(ep) { return (ep.season && ep.season > 1) ? `T${ep.season} · Capítulo ${ep.ep}` : `Capítulo ${ep.ep}`; }
        _slug(s) {
            return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
        }

        async downloadThumb(topicId, msgId) {
            const message = await this.getMessageById(msgId);
            if (!message || !message.media) return null;
            const media = message.media;
            if (media.photo) return await this.client.downloadMedia(message, {});
            const doc = media.document;
            if (doc && doc.thumbs && doc.thumbs.length) return await this.client.downloadMedia(message, { thumb: doc.thumbs.length - 1 });
            return null;
        }

        async downloadThumbByRef(channel, msgId) {
            const message = await this.getMessageByRef(channel, msgId);
            if (!message || !message.media) return null;
            const doc = message.media.document;
            if (message.media.photo) return await this.client.downloadMedia(message, {});
            if (doc && doc.thumbs && doc.thumbs.length) return await this.client.downloadMedia(message, { thumb: doc.thumbs.length - 1 });
            return null;
        }

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

        streamRange(info, start, length) {
            // GramJS valida su propia instancia BigInteger; no acepta otra copia de la librería.
            const offset = info.location.id.subtract(info.location.id).add(start);
            return this.client.iterDownload({
                file: info.location, offset, limit: length,
                requestSize: 1024 * 1024, // 1 MB por bloque (mas velocidad)
                dcId: info.dcId
            });
        }

        // Lista los diálogos de Telegram disponibles para seleccionar un catálogo.
        async getMisGrupos() {
            const out = [];
            try {
                // Sin limite practico: 5000 dialogos cubre cualquier cuenta real.
                for await (const dialog of this.client.iterDialogs({ limit: 5000 })) {
                    try {
                        const ent = dialog.entity; if (!ent) continue;
                        const cn = ent.className || '';
                        let category = 'other';
                        let isChannel = false, isGroup = false, isBot = false, isPrivate = false, isForum = false;
                        if (cn === 'User') {
                            if (ent.bot) { isBot = true; category = 'bots'; }
                            else { isPrivate = true; category = 'private'; }
                        } else if (cn === 'Chat' || cn === 'ChatForbidden') {
                            isGroup = true; category = 'groups';
                        } else if (cn === 'Channel' || cn === 'ChannelForbidden') {
                            isForum = !!ent.forum;
                            if (ent.broadcast) { isChannel = true; category = 'channels'; }
                            else { isGroup = true; category = 'groups'; }
                        }
                        // peerId: -100<id> para canales/supergrupos, -<id> para chat clasico, <id> para usuario
                        let peerId = String(ent.id);
                        if (cn === 'Channel' || cn === 'ChannelForbidden') peerId = '-100' + String(ent.id);
                        else if (cn === 'Chat' || cn === 'ChatForbidden') peerId = '-' + String(ent.id);
                        const title = ent.title || ent.firstName || ent.username || 'Sin nombre';
                        const subtitle = ent.lastName ? (ent.firstName + ' ' + ent.lastName) : (ent.username ? '@' + ent.username : '');
                        out.push({
                            id: String(ent.id),
                            peerId,
                            title,
                            subtitle: subtitle === title ? '' : subtitle,
                            username: ent.username || '',
                            category,
                            isChannel, isGroup, isBot, isPrivate, isForum,
                            isMega: !!ent.megagroup,
                            verified: !!ent.verified,
                            premium: !!ent.premium,
                            scam: !!ent.scam,
                            fake: !!ent.fake,
                            membersCount: ent.participantsCount || 0,
                            unread: dialog.unreadCount || 0,
                            hasPhoto: !!ent.photo && ent.photo.className !== 'UserProfilePhotoEmpty' && ent.photo.className !== 'ChatPhotoEmpty',
                            // Para inicial de avatar generado
                            avatarSeed: title
                        });
                    } catch (e) { /* saltar */ }
                }
            } catch (e) { console.warn('[tg] getMisGrupos fallo:', e.message); }
            const candidates = out.filter(group => group.isForum && (group.isGroup || group.isChannel));
            const eligible = new Set();
            let index = 0;
            const workers = Array.from({ length: Math.min(4, candidates.length) }, async () => {
                while (index < candidates.length) {
                    const group = candidates[index++];
                    const service = new TelegramService(
                        this.client, Object.assign({}, this.cfg, { groupId: group.peerId })
                    );
                    try {
                        if (await service.hasAutoTopics()) eligible.add(group.peerId);
                    } catch (e) {
                        console.warn(`[tg] No se pudieron comprobar los temas de ${group.title}:`, e.message);
                    }
                }
            });
            await Promise.all(workers);
            const filtered = out.filter(group => eligible.has(group.peerId));
            filtered.sort((a, b) => (b.unread - a.unread) || a.title.localeCompare(b.title));
            return filtered;
        }

    }

    window.TelegramService = TelegramService;
})();
