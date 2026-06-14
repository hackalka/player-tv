/* =====================================================================
 * Tv Player — Motor de Telegram EN EL NAVEGADOR (modelo 100% cliente)
 * Cada usuario usa su propia cuenta; el vídeo va directo a su dispositivo.
 * ===================================================================== */
(function () {
    const Engine = {
        client: null, Api: null, cfg: null, entity: null,
        msgCache: new Map(), refCache: new Map(), chanCache: new Map(),
        thumbCache: new Map(), streams: new Map(),
        isAdmin: false, name: '', authorized: false,

        async waitLib() {
            const ok = () => !!(window.telegram && window.telegram.TelegramClient && window.telegram.sessions && window.telegram.sessions.StringSession);
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            // El bundle local (vendor/telegram.bundle.js) ya incluye GramJS + polyfills (Buffer, etc.)
            let n = 0; while (!ok() && n < 40) { await sleep(250); n++; }
            return ok();
        },

        async init(cfg) {
            this.cfg = cfg;
            if (!await this.waitLib()) throw new Error('Falta el bundle de Telegram (public/vendor/telegram.bundle.js). Ejecuta la GitHub Action "Build Telegram bundle" para generarlo y vuelve a desplegar.');
            const { TelegramClient, sessions } = window.telegram;
            this.Api = window.telegram.Api;
            const saved = localStorage.getItem('tvp_session') || '';
            this.session = new sessions.StringSession(saved);
            this.client = new TelegramClient(this.session, cfg.apiId, cfg.apiHash, { connectionRetries: 3, useWSS: true });
            await this.client.connect();
            this.authorized = await this.client.checkAuthorization();
            if (this.authorized) { this._save(); await this.afterAuth(); }
            return this.authorized;
        },
        _save() { try { localStorage.setItem('tvp_session', this.client.session.save()); } catch {} },
        async afterAuth() {
            try { const me = await this.client.getMe(); this.name = (me && (me.firstName || me.username)) || ''; } catch {}
            try { this.isAdmin = await this.isGroupAdmin(); } catch { this.isAdmin = false; }
        },

        // ---- login por teléfono ----
        async sendCode(phone) {
            const r = await this.client.sendCode({ apiId: this.cfg.apiId, apiHash: this.cfg.apiHash }, phone);
            this._phone = phone; this._hash = r.phoneCodeHash;
        },
        async signIn(code) {
            try {
                await this.client.invoke(new this.Api.auth.SignIn({ phoneNumber: this._phone, phoneCodeHash: this._hash, phoneCode: String(code).replace(/\s+/g, '') }));
            } catch (e) {
                if ((e.errorMessage || e.message || '').includes('SESSION_PASSWORD_NEEDED')) return { needPassword: true };
                throw e;
            }
            await this._finish(); return { ok: true };
        },
        async signInPassword(pwd) {
            let used = false;
            await this.client.signInWithPassword(
                { apiId: this.cfg.apiId, apiHash: this.cfg.apiHash },
                { password: async () => { if (used) throw new Error('Contraseña 2FA incorrecta.'); used = true; return pwd; }, onError: (e) => { throw e; } }
            );
            await this._finish(); return { ok: true };
        },
        async _finish() { this.authorized = true; this._save(); await this.afterAuth(); },
        async logout() { try { await this.client.invoke(new this.Api.auth.LogOut()); } catch {} try { localStorage.removeItem('tvp_session'); } catch {} },

        // ---- grupo / admin ----
        async resolveGroup() {
            if (this.entity) return this.entity;
            const raw = String(this.cfg.groupId).trim();
            const id = /^-?\d+$/.test(raw) ? parseInt(raw, 10) : raw;
            try { this.entity = await this.client.getEntity(id); }
            catch (e) { await this.client.getDialogs({ limit: 200 }); this.entity = await this.client.getEntity(id); }
            return this.entity;
        },
        async isGroupAdmin() {
            try {
                const entity = await this.resolveGroup();
                const p = await this.client.invoke(new this.Api.channels.GetParticipant({ channel: entity, participant: 'me' }));
                const cn = p && p.participant && p.participant.className;
                return cn === 'ChannelParticipantCreator' || cn === 'ChannelParticipantAdmin';
            } catch { return false; }
        },

        _cache(msgs) { for (const m of msgs) if (m && m.id != null) this.msgCache.set(m.id, m); },
        async getMessageById(id) {
            if (this.msgCache.has(Number(id))) return this.msgCache.get(Number(id));
            const entity = await this.resolveGroup();
            const r = await this.client.getMessages(entity, { ids: [Number(id)] });
            const m = r && r[0]; if (m) this.msgCache.set(Number(id), m); return m;
        },
        async _resolveChannel(channel) {
            if (this.chanCache.has(channel)) return this.chanCache.get(channel);
            const raw = String(channel); const id = /^-?\d+$/.test(raw) ? parseInt(raw, 10) : raw;
            let ent; try { ent = await this.client.getEntity(id); } catch { await this.client.getDialogs({ limit: 50 }); ent = await this.client.getEntity(id); }
            this.chanCache.set(channel, ent); return ent;
        },
        async getMessageByRef(channel, msgId) {
            const key = channel + ':' + msgId;
            if (this.refCache.has(key)) return this.refCache.get(key);
            const entity = await this._resolveChannel(channel);
            const r = await this.client.getMessages(entity, { ids: [Number(msgId)] });
            const m = r && r[0]; if (m) this.refCache.set(key, m); return m;
        },

        // ---- temas ----
        async getForumTopics() {
            const entity = await this.resolveGroup();
            try {
                const res = await this.client.invoke(new this.Api.channels.GetForumTopics({ channel: entity, limit: 100, offsetDate: 0, offsetId: 0, offsetTopic: 0 }));
                return (res.topics || []).filter(t => t.id !== undefined && t.title !== undefined).map(t => ({ id: t.id, title: t.title || ('Tema ' + t.id) }));
            } catch (e) { console.warn('GetForumTopics', e.message); return []; }
        },
        async getAutoTopics() {
            const tags = (this.cfg.autoTags || []).map(t => t.toLowerCase()).filter(Boolean);
            const all = await this.getForumTopics();
            return all.filter(t => { const low = (t.title || '').toLowerCase(); return tags.some(tag => low.includes(tag)); })
                .map(t => { const info = this._displayInfo(t.title, tags); return { id: t.id, name: info.name, icon: info.icon, type: info.type }; });
        },
        _displayInfo(title, tags) {
            let name = String(title || '');
            for (const tag of (tags || [])) { if (!tag) continue; const re = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'); name = name.replace(re, ''); }
            name = name.replace(/[\-|·•:]+\s*$/g, '').replace(/^\s*[\-|·•:]+/g, '').replace(/\s{2,}/g, ' ').trim();
            if (!name) name = 'Sin nombre';
            const low = name.toLowerCase(); let icon = '📁', type = 'other';
            if (/pel[ií]cul|movie|cine|film/.test(low)) { icon = '🎬'; type = 'movie'; }
            else if (/serie|series|temporada|tv\b/.test(low)) { icon = '📺'; type = 'series'; }
            else if (/deporte|sport|f[uú]tbol|liga|nba|ufc|box/.test(low)) { icon = '⚽'; type = 'sports'; }
            else if (/doc(u|s)|documental/.test(low)) { icon = '🎥'; type = 'docs'; }
            else if (/anime|manga/.test(low)) { icon = '🌸'; type = 'anime'; }
            return { name, icon, type };
        },
        async getTopicMessages(topicId, limit) {
            const entity = await this.resolveGroup();
            const opts = { limit: limit || this.cfg.messagesPerTopic };
            if (topicId && Number(topicId) !== 1) opts.replyTo = Number(topicId);
            const msgs = await this.client.getMessages(entity, opts);
            this._cache(msgs); return msgs;
        },

        // ---- catálogo ----
        async getCatalog() {
            const topics = await this.getAutoTopics();
            const categories = [];
            for (const topic of topics) {
                let items = [];
                try { const msgs = await this.getTopicMessages(topic.id, this.cfg.messagesPerTopic); items = this._buildTopicItems(msgs, topic); }
                catch (e) { console.warn('tema', topic.name, e.message); }
                categories.push({ name: topic.name, icon: topic.icon, type: topic.type, id: topic.id, items });
            }
            return { categories };
        },

        buildItem(message, topic) {
            const text = message.message || '';
            const allLines = text.split('\n').map(s => s.trim());
            const clean = s => (s || '').replace(/#[\wÀ-ÿ]+/g, '').replace(/https?:\/\/\S+/g, '').replace(/acestream:\/\/\S+/ig, '').trim();
            const isUrl = l => /^(acestream:\/\/|https?:\/\/|magnet:)/i.test(l);
            const firstIdx = allLines.findIndex(l => l);
            let title = clean(allLines[firstIdx] || '') || topic.name;
            title = title.replace(/\s*\b(19|20)\d{2}\b\s*$/, '').trim() || title;

            const links = []; let pendingLabel = '';
            for (let i = firstIdx + 1; i < allLines.length; i++) {
                const line = allLines[i]; if (!line) continue;
                if (isUrl(line)) {
                    let kind = /^acestream:/i.test(line) ? 'ace' : 'http';
                    const link = { label: (pendingLabel || ('Enlace ' + (links.length + 1))).replace(/[:：]\s*$/, '').trim(), url: line, kind };
                    const tme = this._parseTme(line);
                    if (tme) { link.kind = 'tg'; link.channel = tme.channel; link.msgId = tme.msgId; }
                    links.push(link); pendingLabel = '';
                } else { let j = i + 1; while (j < allLines.length && !allLines[j]) j++; if (j < allLines.length && isUrl(allLines[j])) pendingLabel = line; }
            }
            links.forEach(l => Object.assign(l, this._linkSrc(l)));

            const meta = {};
            const mg = text.match(/g[eé]neros?\s*:\s*([^\n]+)/i); if (mg) meta.genres = mg[1].trim();
            const mr = text.match(/puntuaci[oó]n\s*:\s*([0-9.]+\s*\/?\s*[0-9]*)/i); if (mr) meta.rating = mr[1].replace(/\s+/g, '');
            const mse = text.match(/temporadas?\s*:\s*(\d+)/i); if (mse) meta.seasons = mse[1];
            const mst = text.match(/\b(en emisi[oó]n|finalizad[ao]|estreno|pr[oó]ximamente)\b/i); if (mst) meta.status = mst[1];

            let description = '';
            const sinIdx = allLines.findIndex(l => /sinopsis/i.test(l));
            if (sinIdx >= 0) {
                const parts = []; const after = allLines[sinIdx].split(/sinopsis\s*:?/i)[1]; if (after && after.trim()) parts.push(after.trim());
                for (let i = sinIdx + 1; i < allLines.length; i++) {
                    const line = allLines[i]; if (!line) continue; if (isUrl(line)) break;
                    let j = i + 1; while (j < allLines.length && !allLines[j]) j++; if (j < allLines.length && isUrl(allLines[j])) break;
                    if (/^[📅📺🎭🎬🌟⭐📝🎥]|g[eé]neros|temporadas|episodios|puntuaci|estreno/i.test(line)) continue;
                    parts.push(line);
                }
                description = clean(parts.join(' '));
            }
            if (!description) {
                const parts = [];
                for (let i = firstIdx + 1; i < allLines.length; i++) {
                    const line = allLines[i]; if (!line || isUrl(line)) continue;
                    let j = i + 1; while (j < allLines.length && !allLines[j]) j++; if (j < allLines.length && isUrl(allLines[j])) continue;
                    if (/^[📅📺🎭🎬🌟⭐📝🎥]|g[eé]neros|temporadas|episodios|puntuaci|estreno|sinopsis|en emisi/i.test(line)) continue;
                    parts.push(line);
                }
                description = clean(parts.join(' '));
            }

            const year = (text.match(/\b(19|20)\d{2}\b/) || [])[0] || '';
            const doc = message.media && message.media.document;
            const isVideo = !!(doc && /video|mp4|matroska|x-msvideo|quicktime/.test(doc.mimeType || ''));
            const hasThumb = !!(message.media && (message.media.photo || (doc && doc.thumbs && doc.thumbs.length)));
            let filename = ''; if (doc) { const fn = (doc.attributes || []).find(a => a.className === 'DocumentAttributeFilename'); if (fn) filename = fn.fileName || ''; }
            const ext = (filename.match(/\.([a-z0-9]{2,4})$/i) || [])[1] || ((doc && (doc.mimeType || '').split('/')[1]) || '').toLowerCase();
            const BROWSER_OK = ['mp4', 'm4v', 'webm', 'ogg', 'ogv', 'mov', 'quicktime'];
            const playableInBrowser = isVideo && BROWSER_OK.includes((ext || '').toLowerCase());

            return {
                id: message.id, topicId: topic.id, uid: doc && doc.id ? String(doc.id) : '',
                title, description, year, meta, date: Number(message.date) || 0,
                duration: isVideo ? this._duration(doc) : '', size: doc ? this._bytes(doc.size) : '',
                isVideo, ext: (ext || '').toLowerCase(), playableInBrowser, links,
                thumb: hasThumb ? { t: 'g', id: message.id } : null,
                src: isVideo ? { t: 'doc', id: message.id, browser: playableInBrowser } : (links[0] ? links[0].src : null)
            };
        },

        _parseTme(url) {
            let m = url.match(/t\.me\/c\/(\d+)\/(?:\d+\/)?(\d+)/i); if (m) return { channel: '-100' + m[1], msgId: Number(m[2]) };
            m = url.match(/t\.me\/([A-Za-z0-9_]+)\/(?:\d+\/)?(\d+)/i); if (m) return { channel: m[1], msgId: Number(m[2]) };
            return null;
        },
        // Normaliza un enlace en {src, thumb, playableInBrowser, aceUrl, externalUrl}
        _linkSrc(link) {
            if (link.kind === 'tg') return { playableInBrowser: true, src: { t: 'l', ch: link.channel, m: link.msgId, browser: true }, thumb: { t: 'l', ch: link.channel, m: link.msgId } };
            if (link.kind === 'ace') return { playableInBrowser: false, aceUrl: link.url, src: { ace: link.url } };
            const url = link.url || '';
            if (/\.(mp4|m4v|webm|ogg|ogv|mov)(\?|#|$)/i.test(url)) return { playableInBrowser: true, src: { t: 'url', url, browser: true }, externalUrl: url };
            return { playableInBrowser: false, externalUrl: url, src: { ext: url } };
        },

        _buildTopicItems(msgs, topic) {
            const raw = msgs.filter(m => (m.media && m.media.document) || m.media || (m.message && /https?:\/\//.test(m.message)) || (m.message && /acestream/i.test(m.message))).map(m => this.buildItem(m, topic));
            if (topic.type !== 'series') {
                const seen = new Set(), out = [];
                for (const it of raw) { const k1 = 't:' + this._slug(it.title); const k2 = it.uid ? 'u:' + it.uid : null; if (seen.has(k1) || (k2 && seen.has(k2))) continue; seen.add(k1); if (k2) seen.add(k2); out.push(it); }
                return out;
            }
            const groups = new Map(); const shows = [];
            for (const it of raw) {
                const epLinks = (it.links || []).filter(l => /\b\d{1,2}\s*x\s*\d{1,3}\b/i.test(l.label) || /cap[ií]tulo|episodio|\bep\b/i.test(l.label));
                if ((it.links && it.links.length) && (it.links.length > 1 || epLinks.length > 0)) { shows.push(this._showFromPost(it, topic)); continue; }
                const ep = this._parseEpisode(it.title); const base = (ep && ep.base) ? ep.base : it.title; const key = this._slug(base);
                if (!groups.has(key)) groups.set(key, { base, eps: [] });
                groups.get(key).eps.push({ it, ep: ep || { season: 1, ep: groups.get(key).eps.length + 1 } });
            }
            for (const [key, g] of groups) {
                const sorted = g.eps.sort((a, b) => (a.ep.season - b.ep.season) || (a.ep.ep - b.ep.ep));
                const seenEp = new Set(); const eps = [];
                for (const e of sorted) { const kn = e.ep.season + '-' + e.ep.ep; const ku = e.it.uid ? 'u:' + e.it.uid : null; if (seenEp.has(kn) || (ku && seenEp.has(ku))) continue; seenEp.add(kn); if (ku) seenEp.add(ku); eps.push(e); }
                const poster = (eps.find(e => e.it.thumb) || eps[0]).it;
                const episodes = eps.map(e => ({ id: e.it.id, title: this._epLabel(e.ep), epNum: e.ep.ep, season: e.ep.season, src: e.it.src, thumb: e.it.thumb, aceUrl: e.it.aceUrl, externalUrl: e.it.externalUrl, playableInBrowser: e.it.playableInBrowser, duration: e.it.duration, size: e.it.size, description: e.it.description }));
                shows.push({ id: 's-' + topic.id + '-' + key, topicId: topic.id, title: g.base || 'Serie', description: (eps.find(e => e.it.description) || eps[0]).it.description || '', year: (eps.find(e => e.it.year) || eps[0]).it.year || '', meta: (eps.find(e => e.it.meta && Object.keys(e.it.meta).length) || eps[0]).it.meta || {}, date: Math.max.apply(null, eps.map(e => e.it.date || 0)), isSeries: episodes.length > 1, episodeCount: episodes.length, thumb: poster.thumb, episodes });
            }
            return shows;
        },
        _showFromPost(it, topic) {
            const episodes = it.links.map((l, i) => { const ep = this._parseEpisode(l.label) || { season: 1, ep: i + 1 }; return { id: it.id + '-l' + i, title: this._epLabel(ep), epNum: ep.ep, season: ep.season, src: l.src, thumb: l.thumb || it.thumb, aceUrl: l.aceUrl, externalUrl: l.externalUrl, playableInBrowser: l.playableInBrowser, duration: '', size: '', description: '' }; }).sort((a, b) => (a.season - b.season) || (a.epNum - b.epNum));
            return { id: 's-' + topic.id + '-' + this._slug(it.title), topicId: topic.id, title: it.title, description: it.description, year: it.year, meta: it.meta || {}, date: it.date || 0, isSeries: episodes.length > 1, episodeCount: episodes.length, thumb: it.thumb, episodes };
        },
        _parseEpisode(title) {
            const t = String(title || ''); let m;
            m = t.match(/\b[st](\d{1,2})\s*[ex](\d{1,3})\b/i); if (m) return { season: +m[1], ep: +m[2], base: t.slice(0, m.index).trim() };
            m = t.match(/\b(\d{1,2})\s*x\s*(\d{1,3})\b/i); if (m) return { season: +m[1], ep: +m[2], base: t.slice(0, m.index).trim() };
            m = t.match(/(cap[ií]tulo|cap\.?|episodio|epis\.?|ep\.?)\s*\.?\s*(\d{1,3})/i); if (m) return { season: 1, ep: +m[2], base: t.slice(0, m.index).trim() };
            return null;
        },
        _epLabel(ep) { return (ep.season && ep.season > 1) ? ('T' + ep.season + ' · Capítulo ' + ep.ep) : ('Capítulo ' + ep.ep); },
        _slug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'; },
        _duration(doc) { const a = (doc.attributes || []).find(x => x.className === 'DocumentAttributeVideo'); if (!a || !a.duration) return ''; const t = Number(a.duration), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60); return h ? (h + 'h ' + m + 'm') : (m + ' min'); },
        _bytes(n) { if (!n) return ''; const u = ['B', 'KB', 'MB', 'GB']; let v = Number(n), i = 0; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + u[i]; },

        // ---- miniaturas (blob URL cacheado) ----
        async getThumb(ref) {
            if (!ref) return null;
            const key = ref.t === 'l' ? ('l:' + ref.ch + ':' + ref.m) : ('g:' + ref.id);
            if (this.thumbCache.has(key)) return this.thumbCache.get(key);
            try {
                const message = ref.t === 'l' ? await this.getMessageByRef(ref.ch, ref.m) : await this.getMessageById(ref.id);
                if (!message || !message.media) return null;
                let buf; const doc = message.media.document;
                if (message.media.photo) buf = await this.client.downloadMedia(message, {});
                else if (doc && doc.thumbs && doc.thumbs.length) buf = await this.client.downloadMedia(message, { thumb: doc.thumbs.length - 1 });
                if (!buf) return null;
                const url = URL.createObjectURL(new Blob([buf]));
                this.thumbCache.set(key, url); return url;
            } catch (e) { console.warn('thumb', e.message); return null; }
        },

        // ---- streaming (vía Service Worker) ----
        async _resolveSrcMessage(src) {
            if (src.t === 'l') return await this.getMessageByRef(src.ch, src.m);
            if (src.t === 'doc') return await this.getMessageById(src.id);
            return null;
        },
        async registerStream(src) {
            const message = await this._resolveSrcMessage(src);
            if (!message) throw new Error('No se encontró el vídeo.');
            const doc = message.media && message.media.document;
            if (!doc) throw new Error('No es un vídeo reproducible.');
            const streamId = 's' + Date.now() + Math.floor(Math.random() * 1e6);
            const size = Number(doc.size); const mime = doc.mimeType || 'video/mp4';
            this.streams.set(streamId, { message, size, mime });
            // Registrar en el SW y ESPERAR confirmación (evita carrera con el <video>)
            await new Promise((res) => {
                const ctrl = navigator.serviceWorker.controller;
                if (!ctrl) return res();
                const ch = new MessageChannel();
                ch.port1.onmessage = () => res();
                try { ctrl.postMessage({ type: 'REGISTER', streamId, size, mime }, [ch.port2]); } catch { res(); }
                setTimeout(res, 800);
            });
            return { url: 'tg-stream/' + streamId, size, mime };
        },
        async streamRange(streamId, start, end) {
            const s = this.streams.get(streamId);
            if (!s) throw new Error('stream desconocido');
            const doc = s.message.media.document;
            const Api = this.Api; const BIG = window.bigInt;
            const ALIGN = 4096;
            const alignedStart = Math.floor(start / ALIGN) * ALIGN;
            const skip = start - alignedStart;
            const need = end - start + 1;
            let limit = Math.ceil((skip + need) / ALIGN) * ALIGN;
            const location = new Api.InputDocumentFileLocation({ id: doc.id, accessHash: doc.accessHash, fileReference: doc.fileReference, thumbSize: '' });
            const chunks = [];
            for await (const c of this.client.iterDownload({ file: location, offset: alignedStart, limit, requestSize: 1024 * 1024, dcId: doc.dcId })) {
                chunks.push(c instanceof Uint8Array ? c : new Uint8Array(c));
            }
            let total = 0; chunks.forEach(c => total += c.byteLength);
            const merged = new Uint8Array(total); let off = 0; chunks.forEach(c => { merged.set(c, off); off += c.byteLength; });
            return { chunk: merged.slice(skip, skip + need), size: s.size, mime: s.mime };
        },

        // ---- descarga completa (fallback de reproducción interna) ----
        async downloadFull(src, onProgress) {
            const m = await this._resolveSrcMessage(src);
            if (!m) throw new Error('No se encontró el archivo.');
            const buf = await this.client.downloadMedia(m, { progressCallback: (d, t) => { try { onProgress && onProgress(Number(d), Number(t)); } catch {} } });
            const doc = m.media.document;
            return URL.createObjectURL(new Blob([buf], { type: (doc && doc.mimeType) || 'video/mp4' }));
        },
        // ---- blob + nombre (para "abrir en otra app" / compartir) ----
        async downloadBlob(src, onProgress) {
            const m = await this._resolveSrcMessage(src);
            if (!m) throw new Error('No se encontró el archivo.');
            const buf = await this.client.downloadMedia(m, { progressCallback: (d, t) => { try { onProgress && onProgress(Number(d), Number(t)); } catch {} } });
            const doc = m.media && m.media.document;
            const mime = (doc && doc.mimeType) || 'video/mp4';
            let name = 'video.' + ((mime.split('/')[1] || 'mp4'));
            const fn = doc && (doc.attributes || []).find(a => a.className === 'DocumentAttributeFilename');
            if (fn && fn.fileName) name = fn.fileName;
            return { blob: new Blob([buf], { type: mime }), name, mime };
        },

        // ---- admin: editar / borrar ----
        async editMessage(msgId, text) { const e = await this.resolveGroup(); await this.client.editMessage(e, { message: Number(msgId), text: String(text) }); this.msgCache.delete(Number(msgId)); },
        async deleteMessage(msgId) { const e = await this.resolveGroup(); await this.client.deleteMessages(e, [Number(msgId)], { revoke: true }); this.msgCache.delete(Number(msgId)); },

        async getChatMessages(topicId) {
            const msgs = await this.getTopicMessages(topicId, 60);
            return msgs.map(m => { const doc = m.media && m.media.document; const isVideo = !!(doc && /video/.test(doc.mimeType || '')); return { id: m.id, text: m.message || '', date: m.date, hasMedia: !!m.media, isVideo, thumb: (m.media && (m.media.photo || (doc && doc.thumbs && doc.thumbs.length))) ? { t: 'g', id: m.id } : null, src: isVideo ? { t: 'doc', id: m.id, browser: true } : null }; });
        }
    };
    window.Engine = Engine;
})();
