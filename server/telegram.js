'use strict';
const { Api } = require('telegram');
const bigInt = require('big-integer');

/**
 * Motor de Telegram ligado al cliente de UN usuario.
 * Se crea uno por sesión de usuario (ver sessions.js).
 */
class TelegramService {
    constructor(client, cfg) {
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
        try {
            this.entity = await this.client.getEntity(id);
        } catch (e) {
            await this.client.getDialogs({ limit: 200 });
            this.entity = await this.client.getEntity(id);
        }
        return this.entity;
    }

    // ¿La cuenta del usuario es administrador/creador del grupo?
    async isGroupAdmin() {
        try {
            const entity = await this.resolveGroup();
            const p = await this.client.invoke(new Api.channels.GetParticipant({ channel: entity, participant: 'me' }));
            const cn = p && p.participant && p.participant.className;
            return cn === 'ChannelParticipantCreator' || cn === 'ChannelParticipantAdmin';
        } catch (e) { return false; }
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
        catch (e) { await this.client.getDialogs({ limit: 50 }); ent = await this.client.getEntity(id); }
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

    // ---- SOLO los temas etiquetados, con el nombre ya "limpio" ----
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

    _displayInfo(title, tags) {
        let name = String(title || '');
        for (const tag of (tags || [])) {
            if (!tag) continue;
            const re = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
            name = name.replace(re, '');
        }
        // Tipo forzado por etiqueta del propio tema (gana siempre): @series, @peliculas, @deportes, @docu, @anime, @kids
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
        // Detectores por palabra (con \b para evitar falsos positivos)
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
        const all = [];
        let offsetId = 0;
        while (all.length < target) {
            const opts = { limit: Math.min(100, target - all.length), offsetId };
            if (topicId && Number(topicId) !== 1) opts.replyTo = Number(topicId);
            const batch = await this.client.getMessages(entity, opts);
            if (!batch || !batch.length) break;
            all.push(...batch);
            offsetId = batch[batch.length - 1].id;
            if (batch.length < (opts.limit || 100)) break;
        }
        this._cache(all);
        return all;
    }

    buildItem(message, topic) {
        const text = message.message || '';
        const allLines = text.split('\n').map(s => s.trim());
        const clean = s => (s || '').replace(/#[\wÀ-ÿ]+/g, '').replace(/https?:\/\/\S+/g, '').replace(/acestream:\/\/\S+/ig, '').trim();
        const isUrl = l => /^(acestream:\/\/|https?:\/\/|magnet:)/i.test(l);

        const firstIdx = allLines.findIndex(l => l);
        let title = clean(allLines[firstIdx] || '') || topic.name;
        title = title.replace(/\s*\b(19|20)\d{2}\b\s*$/, '').trim() || title;

        const links = [];
        let pendingLabel = '';
        for (let i = firstIdx + 1; i < allLines.length; i++) {
            const line = allLines[i];
            if (!line) continue;
            if (isUrl(line)) {
                let kind = /^acestream:/i.test(line) ? 'ace' : 'http';
                const link = { label: (pendingLabel || ('Enlace ' + (links.length + 1))).replace(/[:：]\s*$/, '').trim(), url: line, kind };
                const tme = this._parseTme(line);
                if (tme) { link.kind = 'tg'; link.channel = tme.channel; link.msgId = tme.msgId; }
                links.push(link);
                pendingLabel = '';
            } else {
                let j = i + 1; while (j < allLines.length && !allLines[j]) j++;
                if (j < allLines.length && isUrl(allLines[j])) pendingLabel = line;
            }
        }
        links.forEach(l => Object.assign(l, this._linkPlayable(l)));

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
                if (isUrl(line)) break;
                let j = i + 1; while (j < allLines.length && !allLines[j]) j++;
                if (j < allLines.length && isUrl(allLines[j])) break;
                if (/^[]|g[eé]neros|temporadas|episodios|puntuaci|estreno/i.test(line)) continue;
                parts.push(line);
            }
            description = clean(parts.join(' '));
        }
        if (!description) {
            const parts = [];
            for (let i = firstIdx + 1; i < allLines.length; i++) {
                const line = allLines[i]; if (!line || isUrl(line)) continue;
                let j = i + 1; while (j < allLines.length && !allLines[j]) j++;
                if (j < allLines.length && isUrl(allLines[j])) continue;
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
        const firstHttp = links.find(l => l.kind === 'http' || l.kind === 'tg');

        return {
            id: message.id,
            topicId: topic.id,
            uid: doc && doc.id ? String(doc.id) : '',
            title, description, year, meta,
            date: Number(message.date) || 0,
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

    _parseTme(url) {
        let m = url.match(/t\.me\/c\/(\d+)\/(?:\d+\/)?(\d+)/i);
        if (m) return { channel: '-100' + m[1], msgId: Number(m[2]) };
        m = url.match(/t\.me\/([A-Za-z0-9_]+)\/(?:\d+\/)?(\d+)/i);
        if (m) return { channel: m[1], msgId: Number(m[2]) };
        return null;
    }

    _linkPlayable(link) {
        if (link.kind === 'tg') return {
            streamUrl: `/api/stream-link/${encodeURIComponent(link.channel)}/${link.msgId}`,
            externalUrl: link.url,
            thumbUrl: `/api/thumb-link/${encodeURIComponent(link.channel)}/${link.msgId}`,
            playableInBrowser: true
        };
        if (link.kind === 'ace') return { aceUrl: link.url, externalUrl: '', playableInBrowser: false };
        const url = link.url || '';
        if (/\.(mp4|m4v|webm|ogg|ogv|mov)(\?|#|$)/i.test(url)) return { streamUrl: url, externalUrl: url, playableInBrowser: true };
        return { externalUrl: url, playableInBrowser: false };
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

    async getCatalog() {
        const topics = await this.getAutoTopics();
        const categories = [];
        for (const topic of topics) {
            let items = [];
            try {
                const msgs = await this.getTopicMessages(topic.id, this.cfg.messagesPerTopic);
                items = this._buildTopicItems(msgs, topic);
            } catch (e) { console.warn(`Tema ${topic.name} falló:`, e.message); }
            // Enriquecer con TMDB (solo películas y series)
            if ((this.cfg.tmdbKey || this.cfg.tmdbToken) && typeof fetch === 'function' && (topic.type === 'movie' || topic.type === 'series')) {
                const isTv = topic.type === 'series';
                await Promise.all(items.map(it => this.tmdbEnrich(it, isTv).catch(() => {})));
            }
            categories.push({ name: topic.name, icon: topic.icon, type: topic.type, id: topic.id, items });
        }
        return { categories };
    }

    _tmdbHeaders() {
        return this.cfg.tmdbToken ? { 'Authorization': 'Bearer ' + this.cfg.tmdbToken, 'accept': 'application/json' } : { 'accept': 'application/json' };
    }
    _tmdbAuthQuery() { return this.cfg.tmdbToken ? '' : ('&api_key=' + (this.cfg.tmdbKey || '')); }

    async _tmdbGenres() {
        if (this._genres) return this._genres;
        this._genres = {};
        try {
            for (const t of ['movie', 'tv']) {
                const r = await fetch(`https://api.themoviedb.org/3/genre/${t}/list?language=es-ES${this._tmdbAuthQuery()}`, { headers: this._tmdbHeaders() });
                const d = await r.json();
                (d.genres || []).forEach(g => { this._genres[g.id] = g.name; });
            }
        } catch {}
        return this._genres;
    }

    async tmdbEnrich(item, isTv) {
        if (typeof fetch !== 'function' || !item.title) return;
        if (!this.cfg.tmdbKey && !this.cfg.tmdbToken) return;
        if (!this._tmdbCache) this._tmdbCache = new Map();
        const ck = (isTv ? 'tv' : 'movie') + ':' + item.title.toLowerCase() + ':' + (item.year || '');
        let info = this._tmdbCache.get(ck);
        if (info === undefined) {
            info = null;
            try {
                const gmap = await this._tmdbGenres();
                const type = isTv ? 'tv' : 'movie';
                // Limpiar título (quitar calidad/lenguaje/extensiones)
                const cleanTitle = String(item.title)
                    .replace(/\b(1080p|720p|480p|2160p|4k|hd|hdr|bluray|brrip|webrip|dvdrip|hdtv|x264|x265|h264|h265|hevc|aac|ac3|dts|latino|castellano|espa[ñn]ol|spanish|english|sub|subs|temporada\s*\d+|t\d+|s\d+|cap[ií]tulo\s*\d+|cap\s*\d+|ep\.?\s*\d+|episodio\s*\d+)\b/ig, ' ')
                    .replace(/[\[\(].*?[\]\)]/g, ' ')
                    .replace(/[._-]+/g, ' ')
                    .replace(/\s{2,}/g, ' ').trim();
                // Intentos: con año + es, con año + en, sin año + es, sin año + en, título limpio + es
                const attempts = [];
                if (item.year) attempts.push({ q: item.title, lang: 'es-ES', year: item.year });
                if (item.year) attempts.push({ q: item.title, lang: 'en-US', year: item.year });
                attempts.push({ q: item.title, lang: 'es-ES' });
                attempts.push({ q: item.title, lang: 'en-US' });
                if (cleanTitle && cleanTitle !== item.title) {
                    attempts.push({ q: cleanTitle, lang: 'es-ES' });
                    attempts.push({ q: cleanTitle, lang: 'en-US' });
                }
                let hit = null;
                for (const a of attempts) {
                    const url = `https://api.themoviedb.org/3/search/${type}?language=${a.lang}&include_adult=false&query=${encodeURIComponent(a.q)}` + (a.year ? `&year=${a.year}` : '') + this._tmdbAuthQuery();
                    try {
                        const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 5000);
                        const r = await fetch(url, { signal: ctrl.signal, headers: this._tmdbHeaders() }); clearTimeout(tm);
                        const d = await r.json();
                        if (d.results && d.results.length) { hit = d.results[0]; break; }
                    } catch {}
                }
                if (hit) {
                    // Pedir detalles en español para sinopsis traducida y título oficial
                    let det = hit;
                    try {
                        const r2 = await fetch(`https://api.themoviedb.org/3/${type}/${hit.id}?language=es-ES${this._tmdbAuthQuery()}`, { headers: this._tmdbHeaders() });
                        const d2 = await r2.json(); if (d2 && d2.id) det = d2;
                    } catch {}
                    const date = det.release_date || det.first_air_date || hit.release_date || hit.first_air_date || '';
                    info = {
                        overview: det.overview || hit.overview || '',
                        year: (String(date).match(/^(\d{4})/) || [])[1] || '',
                        rating: (det.vote_average || hit.vote_average) ? String(Math.round((det.vote_average || hit.vote_average) * 10) / 10) : '',
                        genres: ((det.genres && det.genres.map(g => g.name)) || (hit.genre_ids || []).map(id => gmap[id])).filter(Boolean).join(', '),
                        poster: (det.poster_path || hit.poster_path) ? ('https://image.tmdb.org/t/p/w500' + (det.poster_path || hit.poster_path)) : '',
                        backdrop: (det.backdrop_path || hit.backdrop_path) ? ('https://image.tmdb.org/t/p/w780' + (det.backdrop_path || hit.backdrop_path)) : ''
                    };
                }
            } catch {}
            this._tmdbCache.set(ck, info);
        }
        if (!info) return;
        if (info.overview) item.description = info.overview;
        if (info.year) item.year = info.year;
        item.meta = item.meta || {};
        if (info.rating) item.meta.rating = info.rating;
        if (info.genres) item.meta.genres = info.genres;
        if (info.poster) { item.thumbUrl = info.poster; item.tmdbPoster = info.poster; }
        if (info.backdrop) item.backdropUrl = info.backdrop;
    }

    _buildTopicItems(msgs, topic) {
        const raw = msgs
            // Mantenemos cualquier mensaje que tenga: media, una URL, acestream, o texto con TÍTULO real (>= 4 chars no espacios)
            .filter(m => {
                if (m.media && m.media.document) return true;
                if (m.media) return true; // foto = posible carátula
                const t = m.message || '';
                if (/https?:\/\//.test(t)) return true;
                if (/acestream/i.test(t)) return true;
                // Posts solo de texto que parezcan ficha (línea con título): se quedan
                const firstLine = (t.split('\n')[0] || '').trim();
                if (firstLine.length >= 4 && firstLine.length <= 120) return true;
                return false;
            })
            .map(m => this.buildItem(m, topic));

        // Si el tema NO es serie pero los items parecen serie (Temporada N / T-1 / 1x01 / Capítulo), tratarlos como series
        const seriesHint = (it) => /\btemporada\s*\d+|\bs\d{1,2}\s*e\d{1,3}\b|\b\d{1,2}\s*x\s*\d{1,3}\b|cap[ií]tulo|episodio|\bt\s*[-_.]?\s*\d{1,2}\b/i.test(it.title || '');
        const promoteToSeries = topic.type !== 'series' && raw.some(seriesHint);
        if (promoteToSeries) topic = Object.assign({}, topic, { type: 'series', _promoted: true });

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

        const groups = new Map();
        for (const it of raw) {
            const epLinks = (it.links || []).filter(l =>
                /\b\d{1,2}\s*x\s*\d{1,3}\b/i.test(l.label) || /cap[ií]tulo|episodio|\bep\b/i.test(l.label));
            const isSelfSeries = (it.links && it.links.length) && (it.links.length > 1 || epLinks.length > 0);

            // Calcular nombre BASE (sin "T-1", "(2023)", etc.) y temporada por defecto del post
            const ep = this._parseEpisode(it.title);
            const baseRaw = (ep && ep.base) ? ep.base : it.title;
            const base = this._normalizeShowName(baseRaw);
            const key = this._slug(base);
            const postSeason = ep ? ep.season : 1;
            if (!groups.has(key)) groups.set(key, { base, eps: [] });
            const g = groups.get(key);

            if (isSelfSeries) {
                // Cada link del post es un episodio; usamos la temporada del propio link si la trae,
                // o la del título del post (T-1 -> season 1).
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
        // S01E02, T1E02
        m = t.match(/\b[st]\s*\.?\s*-?\s*(\d{1,2})\s*[ex]\s*\.?\s*(\d{1,3})\b/i);
        if (m) return { season: +m[1], ep: +m[2], base: t.slice(0, m.index) };
        // 1x02
        m = t.match(/\b(\d{1,2})\s*x\s*(\d{1,3})\b/i);
        if (m) return { season: +m[1], ep: +m[2], base: t.slice(0, m.index) };
        // Capítulo 3 / Episodio 3
        m = t.match(/(cap[ií]tulo|cap\.?|episodio|epis\.?|ep\.?)\s*\.?\s*(\d{1,3})/i);
        if (m) return { season: 1, ep: +m[2], base: t.slice(0, m.index) };
        // Temporada 1 / T-1 / T1 / T 1 — paquete de temporada completa (sin episodio)
        m = t.match(/(?:^|[\s\(\[])temporada\s*(\d{1,2})\b/i) || t.match(/(?:^|[\s\(\[])t\s*[-_.]?\s*(\d{1,2})\b/i);
        if (m) return { season: +m[1], ep: 1, base: t.slice(0, m.index), packSeason: true };
        return null;
    }
    _normalizeShowName(s) {
        return String(s || '')
            .replace(/\([^)]*\)/g, ' ')           // (2023)
            .replace(/\b(19|20)\d{2}\b/g, ' ')    // años sueltos
            .replace(/[\-–—]+\s*$/g, ' ')
            .replace(/[^a-zA-Z0-9À-ÿ\s]+/g, ' ')  // signos
            .replace(/\s{2,}/g, ' ')
            .trim();
    }
    _titleCase(s) {
        const str = String(s || '').trim();
        if (!str) return '';
        // Si está TODO en mayúsculas, ponemos Title Case; si tiene mezcla, lo respetamos
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
        return this.client.iterDownload({
            file: info.location, offset: bigInt(start), limit: length, requestSize: 512 * 1024, dcId: info.dcId
        });
    }

    async editMessageText(msgId, text) {
        const entity = await this.resolveGroup();
        await this.client.editMessage(entity, { message: Number(msgId), text: String(text) });
        this._msgCache.delete(Number(msgId));
    }
    async deleteMessage(msgId) {
        const entity = await this.resolveGroup();
        await this.client.deleteMessages(entity, [Number(msgId)], { revoke: true });
        this._msgCache.delete(Number(msgId));
    }
}

module.exports = { TelegramService };
