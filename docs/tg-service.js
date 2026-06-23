/* ===================================================================
 * TelegramService (version navegador) - portado de server/telegram.js
 * Usa GramJS cargado como window.telegram. Misma logica que el backend,
 * pero las URLs de stream/miniatura son RELATIVAS para que las capture
 * el Service Worker (stream-sw.js).
 * =================================================================== */
(function () {
    'use strict';
    let Api = null;
    let bigInt = null;
    function _libs() {
        Api = window.telegram.Api;
        bigInt = window.bigInt || (window.telegram && window.telegram.bigInt);
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
                console.warn('GetForumTopics fallo:', e.message);
                return [];
            }
        }

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
            const text = message.message || '';
            const allLines = text.split('\n').map(s => s.trim());
            const clean = s => (s || '').replace(/#[\wÀ-ÿ]+/g, '').replace(/https?:\/\/\S+/g, '').replace(/acestream:\/\/\S+/ig, '').replace(/tvgram:\/\/\S+/ig, '').trim();
            const isUrl = l => /^(acestream:\/\/|https?:\/\/|magnet:|tvgram:\/\/)/i.test(l);

            const firstIdx = allLines.findIndex(l => l);
            let title = clean(allLines[firstIdx] || '') || topic.name;
            title = title.replace(/\s*\b(19|20)\d{2}\b\s*$/, '').trim() || title;

            const links = [];
            let pendingLabel = '';
            for (let i = firstIdx + 1; i < allLines.length; i++) {
                const line = allLines[i];
                if (!line) continue;
                if (isUrl(line)) {
                    let kind = /^acestream:/i.test(line) ? 'ace' : (/^tvgram:/i.test(line) ? 'tvgram' : 'http');
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
            const firstTvgram = links.find(l => l.kind === 'tvgram');
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
                tvgramUrl: firstTvgram ? firstTvgram.url : '',
                externalUrl: firstHttp ? firstHttp.url : '',
                hasThumb,
                streamUrl: isVideo ? `tgstream/${topic.id}/${message.id}` : '',
                thumbUrl: hasThumb ? `tgthumb/${topic.id}/${message.id}` : ''
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
                streamUrl: `tgstreamlink/${encodeURIComponent(link.channel)}/${link.msgId}`,
                externalUrl: link.url,
                thumbUrl: `tgthumblink/${encodeURIComponent(link.channel)}/${link.msgId}`,
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
                if ((this.cfg.tmdbKey || this.cfg.tmdbToken) && typeof fetch === 'function' && (topic.type === 'movie' || topic.type === 'series')) {
                    const isTv = topic.type === 'series';
                    await Promise.all(items.map(it => this.tmdbEnrich(it, isTv).catch(() => {})));
                }
                categories.push({ name: topic.name, icon: topic.icon, type: topic.type, id: topic.id, items });
            }
            return { categories, partial: !!opts.limit };
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
                    const cleanTitle = String(item.title)
                        .replace(/\b(1080p|720p|480p|2160p|4k|hd|hdr|bluray|brrip|webrip|dvdrip|hdtv|x264|x265|h264|h265|hevc|aac|ac3|dts|latino|castellano|espa[ñn]ol|spanish|english|sub|subs|temporada\s*\d+|t\d+|s\d+|cap[ií]tulo\s*\d+|cap\s*\d+|ep\.?\s*\d+|episodio\s*\d+)\b/ig, ' ')
                        .replace(/[\[\(].*?[\]\)]/g, ' ')
                        .replace(/[._-]+/g, ' ')
                        .replace(/\s{2,}/g, ' ').trim();
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
                        let det = hit; let trailerKey = ''; let logoUrl = '';
                        try {
                            const r2 = await fetch(`https://api.themoviedb.org/3/${type}/${hit.id}?language=es-ES&append_to_response=videos,images&include_image_language=es,en,null${this._tmdbAuthQuery()}`, { headers: this._tmdbHeaders() });
                            const d2 = await r2.json(); if (d2 && d2.id) det = d2;
                            const pickTrailer = (videos) => {
                                if (!videos || !videos.results) return '';
                                const r = videos.results;
                                const t = r.find(v => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ||
                                         r.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
                                         r.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
                                         r.find(v => v.site === 'YouTube');
                                return t ? t.key : '';
                            };
                            trailerKey = pickTrailer(det.videos);
                            if (!trailerKey) {
                                try {
                                    const r3 = await fetch(`https://api.themoviedb.org/3/${type}/${hit.id}/videos?language=en-US${this._tmdbAuthQuery()}`, { headers: this._tmdbHeaders() });
                                    const d3 = await r3.json();
                                    trailerKey = pickTrailer(d3);
                                } catch {}
                            }
                            if (det.images && det.images.logos && det.images.logos.length) {
                                const order = ['es', 'en', null];
                                for (const lang of order) {
                                    const found = det.images.logos.find(l => l.iso_639_1 === lang);
                                    if (found) { logoUrl = 'https://image.tmdb.org/t/p/w500' + found.file_path; break; }
                                }
                                if (!logoUrl) logoUrl = 'https://image.tmdb.org/t/p/w500' + det.images.logos[0].file_path;
                            }
                        } catch {}
                        const date = det.release_date || det.first_air_date || hit.release_date || hit.first_air_date || '';
                        info = {
                            tmdbId: det.id || hit.id,
                            type,
                            overview: det.overview || hit.overview || '',
                            year: (String(date).match(/^(\d{4})/) || [])[1] || '',
                            rating: (det.vote_average || hit.vote_average) ? String(Math.round((det.vote_average || hit.vote_average) * 10) / 10) : '',
                            genres: ((det.genres && det.genres.map(g => g.name)) || (hit.genre_ids || []).map(id => gmap[id])).filter(Boolean).join(', '),
                            poster: (det.poster_path || hit.poster_path) ? ('https://image.tmdb.org/t/p/w500' + (det.poster_path || hit.poster_path)) : '',
                            backdrop: (det.backdrop_path || hit.backdrop_path) ? ('https://image.tmdb.org/t/p/w1280' + (det.backdrop_path || hit.backdrop_path)) : '',
                            trailerKey,
                            logo: logoUrl,
                            runtime: det.runtime || (det.episode_run_time && det.episode_run_time[0]) || 0,
                            budget: det.budget || 0,
                            revenue: det.revenue || 0
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
            if (info.trailerKey) item.trailerKey = info.trailerKey;
            if (info.tmdbId) { item.tmdbId = info.tmdbId; item.tmdbType = info.type; }
            if (info.logo) item.tmdbLogo = info.logo;
            if (info.runtime) item.tmdbRuntime = info.runtime;
            if (info.budget) item.tmdbBudget = info.budget;
            if (info.revenue) item.tmdbRevenue = info.revenue;
        }

        async tmdbSearch(query, type) {
            if ((!this.cfg.tmdbKey && !this.cfg.tmdbToken) || typeof fetch !== 'function' || !query) return [];
            const gmap = await this._tmdbGenres();
            const types = type === 'tv' ? ['tv'] : type === 'movie' ? ['movie'] : ['movie', 'tv'];
            const out = [];
            for (const t of types) {
                const url = `https://api.themoviedb.org/3/search/${t}?language=es-ES&include_adult=false&query=${encodeURIComponent(query)}${this._tmdbAuthQuery()}`;
                try {
                    const r = await fetch(url, { headers: this._tmdbHeaders() });
                    const d = await r.json();
                    (d.results || []).slice(0, 12).forEach(x => {
                        const date = x.release_date || x.first_air_date || '';
                        out.push({
                            id: x.id, type: t,
                            title: x.title || x.name || '',
                            year: (String(date).match(/^(\d{4})/) || [])[1] || '',
                            overview: x.overview || '',
                            poster: x.poster_path ? ('https://image.tmdb.org/t/p/w300' + x.poster_path) : '',
                            backdrop: x.backdrop_path ? ('https://image.tmdb.org/t/p/w780' + x.backdrop_path) : '',
                            rating: x.vote_average ? String(Math.round(x.vote_average * 10) / 10) : '',
                            genres: (x.genre_ids || []).map(id => gmap[id]).filter(Boolean).join(', '),
                            popularity: x.popularity || 0
                        });
                    });
                } catch {}
            }
            out.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
            return out.slice(0, 16);
        }

        async tmdbDetails(type, id) {
            if ((!this.cfg.tmdbKey && !this.cfg.tmdbToken) || typeof fetch !== 'function') return null;
            type = type === 'tv' ? 'tv' : 'movie';
            let det = null;
            try {
                const r = await fetch(`https://api.themoviedb.org/3/${type}/${id}?language=es-ES&append_to_response=videos,images&include_image_language=es,en,null${this._tmdbAuthQuery()}`, { headers: this._tmdbHeaders() });
                det = await r.json();
            } catch {}
            if (!det || !det.id) return null;
            const pickTrailer = (videos) => {
                if (!videos || !videos.results) return '';
                const r = videos.results;
                const t = r.find(v => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ||
                         r.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
                         r.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
                         r.find(v => v.site === 'YouTube');
                return t ? t.key : '';
            };
            let trailerKey = pickTrailer(det.videos);
            if (!trailerKey) {
                try {
                    const r3 = await fetch(`https://api.themoviedb.org/3/${type}/${id}/videos?language=en-US${this._tmdbAuthQuery()}`, { headers: this._tmdbHeaders() });
                    trailerKey = pickTrailer(await r3.json());
                } catch {}
            }
            let logoUrl = '';
            if (det.images && det.images.logos && det.images.logos.length) {
                for (const lang of ['es', 'en', null]) {
                    const found = det.images.logos.find(l => l.iso_639_1 === lang);
                    if (found) { logoUrl = 'https://image.tmdb.org/t/p/w500' + found.file_path; break; }
                }
                if (!logoUrl) logoUrl = 'https://image.tmdb.org/t/p/w500' + det.images.logos[0].file_path;
            }
            const date = det.release_date || det.first_air_date || '';
            return {
                tmdbId: det.id, type,
                overview: det.overview || '',
                year: (String(date).match(/^(\d{4})/) || [])[1] || '',
                rating: det.vote_average ? String(Math.round(det.vote_average * 10) / 10) : '',
                genres: (det.genres || []).map(g => g.name).filter(Boolean).join(', '),
                poster: det.poster_path ? ('https://image.tmdb.org/t/p/w500' + det.poster_path) : '',
                backdrop: det.backdrop_path ? ('https://image.tmdb.org/t/p/w1280' + det.backdrop_path) : '',
                trailerKey, logo: logoUrl,
                runtime: det.runtime || (det.episode_run_time && det.episode_run_time[0]) || 0,
                budget: det.budget || 0, revenue: det.revenue || 0
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
                    const base = items.find(x => x.hasThumb) || items[0];
                    const sources = [];
                    const seenSig = new Set();
                    const seenUid = new Set();
                    for (const it of items) {
                        if (it.uid) { if (seenUid.has(it.uid)) continue; seenUid.add(it.uid); }
                        const subs = this._movieSources(it);
                        subs.forEach(s => {
                            const sig = s.aceUrl || s.tvgramUrl || s.streamUrl || s.externalUrl || s.label;
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
                    if (sources.length > 1) {
                        merged.links = sources;
                        merged.aceUrl = ''; merged.streamUrl = ''; merged.externalUrl = '';
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
            return this.client.iterDownload({
                file: info.location, offset: bigInt(start), limit: length,
                requestSize: 1024 * 1024, // 1 MB por bloque (mas velocidad)
                dcId: info.dcId
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

        // ================== HERRAMIENTAS DE ADMIN GENERICO ==================
        // (cualquier grupo donde el usuario tenga permisos, no solo el del config)

        // Lista TODOS los dialogos del usuario (privados, grupos, canales, bots),
        // ya categorizados al estilo Telegram. Para cada uno calcula el rol
        // (admin/dueno) y datos para mostrar avatar.
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
                        const isAdmin = !!(ent.creator || (ent.adminRights && Object.values(ent.adminRights).some(v => v === true)));
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
                            isAdmin, isCreator: !!ent.creator,
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
            // Orden: admin primero, luego no leidos, luego alfabetico
            out.sort((a, b) => (b.isAdmin - a.isAdmin) || (b.unread - a.unread) || a.title.localeCompare(b.title));
            return out;
        }

        // Descarga la foto de perfil (avatar) de un peer en pequeño.
        async downloadAvatar(peer) {
            const ent = await this.resolvePeer(peer);
            try {
                const data = await this.client.downloadProfilePhoto(ent, { isBig: false });
                return data;
            } catch (e) { return null; }
        }

        // Resuelve un peer arbitrario (id numerico, -100..., @usuario)
        async resolvePeer(peer) {
            const raw = String(peer).trim();
            const id = /^-?\d+$/.test(raw) ? parseInt(raw, 10) : raw;
            try { return await this.client.getEntity(id); }
            catch (e) {
                await this.client.getDialogs({ limit: 1000 });
                return await this.client.getEntity(id);
            }
        }

        // Historial de mensajes de un peer (con tope opcional). Soporta tópicos
        // del foro pasando topicId (replyTo) y paginacion hacia atras con offsetId.
        async getChatHistory(peer, limit, topicId, offsetId) {
            const entity = await this.resolvePeer(peer);
            const opts = { limit: Number(limit) || 50 };
            if (topicId && Number(topicId) !== 1) opts.replyTo = Number(topicId);
            if (offsetId && Number(offsetId) > 0) opts.offsetId = Number(offsetId);
            const all = [];
            try {
                for await (const m of this.client.iterMessages(entity, opts)) {
                    all.push(m);
                    if (all.length >= opts.limit) break;
                }
            } catch (e) {
                console.warn('[tg] iterMessages fallo, usando getMessages:', e.message);
                const msgs = await this.client.getMessages(entity, opts);
                if (msgs) all.push(...msgs);
            }
            return all.map(m => this.serializeMsg(m, peer));
        }

        // Convierte un mensaje GramJS a un objeto sencillo para el frontend.
        serializeMsg(m, peer) {
            const doc = m.media && m.media.document;
            const ph = m.media && m.media.photo;
            const isVideo = !!(doc && /video|mp4|matroska|x-msvideo|quicktime/.test(doc.mimeType || ''));
            const isImage = !!ph || !!(doc && /image\//.test(doc.mimeType || ''));
            const hasThumb = !!(ph || (doc && doc.thumbs && doc.thumbs.length));
            let filename = '';
            if (doc) {
                const fn = (doc.attributes || []).find(a => a.className === 'DocumentAttributeFilename');
                if (fn) filename = fn.fileName || '';
            }
            return {
                id: m.id,
                date: Number(m.date) || 0,
                fromId: m.fromId ? String(m.fromId.userId || m.fromId.channelId || m.fromId.chatId || '') : '',
                text: m.message || '',
                hasMedia: !!m.media,
                isVideo, isImage,
                mimeType: doc ? doc.mimeType : (ph ? 'image/jpeg' : ''),
                size: doc ? Number(doc.size) : 0,
                filename,
                duration: this._duration(doc || {}),
                hasThumb,
                editedAt: Number(m.editDate) || 0,
                replyToMsgId: m.replyTo && m.replyTo.replyToMsgId ? Number(m.replyTo.replyToMsgId) : 0
            };
        }

        // Enviar texto a un peer (con respuesta opcional).
        async sendTextTo(peer, text, replyTo) {
            const entity = await this.resolvePeer(peer);
            const opts = {};
            if (replyTo) opts.replyTo = Number(replyTo);
            const msg = await this.client.sendMessage(entity, Object.assign({ message: String(text || '') }, opts));
            return this.serializeMsg(msg, peer);
        }

        // Subir y enviar un archivo (Blob/File). Para videos pone soporte de streaming.
        async sendFileTo(peer, file, caption, replyTo, onProgress) {
            const entity = await this.resolvePeer(peer);
            const opts = {
                file: file,
                caption: caption || '',
                forceDocument: false,
                supportsStreaming: /^video\//.test(file.type || '') ? true : undefined,
                fileName: file.name || undefined,
                workers: 4, // 4 chunks en paralelo (mas rapido en redes con buena subida)
                progressCallback: typeof onProgress === 'function'
                    ? (sent, total) => { try { onProgress(Number(sent), Number(total)); } catch (e) { } }
                    : undefined
            };
            if (replyTo) opts.replyTo = Number(replyTo);
            const msg = await this.client.sendFile(entity, opts);
            return this.serializeMsg(msg, peer);
        }

        // Editar el texto/leyenda de un mensaje en cualquier peer.
        async editTextIn(peer, msgId, text) {
            const entity = await this.resolvePeer(peer);
            await this.client.editMessage(entity, { message: Number(msgId), text: String(text || '') });
        }

        // Reemplazar el archivo de un mensaje (cambiar el video).
        async replaceFileIn(peer, msgId, newFile, caption) {
            const entity = await this.resolvePeer(peer);
            await this.client.editMessage(entity, {
                message: Number(msgId),
                file: newFile,
                text: caption || '',
                supportsStreaming: /^video\//.test(newFile.type || '') ? true : undefined,
                fileName: newFile.name || undefined
            });
        }

        // Borrar uno o varios mensajes (revoke = borrar para todos).
        async deleteMessagesIn(peer, msgIds) {
            const entity = await this.resolvePeer(peer);
            await this.client.deleteMessages(entity, msgIds.map(Number), { revoke: true });
        }

        // Reenviar mensajes de un peer a otro (forward o copy oculto).
        // asCopy=true → usa Api.messages.ForwardMessages con dropAuthor para
        // que NO se vea el origen ni el autor (estilo "Copiar y pegar").
        // topMsgId (opcional) → enviar dentro de un tema (foro) concreto del destino.
        async forwardMessages(fromPeer, msgIds, toPeer, asCopy, topMsgId) {
            const from = await this.resolvePeer(fromPeer);
            const to = await this.resolvePeer(toPeer);
            const topId = topMsgId && Number(topMsgId) > 1 ? Number(topMsgId) : 0;
            // RAW API siempre — soporta topMsgId y dropAuthor en una sola llamada.
            const ids = msgIds.map(Number);
            // randomId int64 aleatorio. Combinamos dos enteros 32-bit aleatorios
            // y los pasamos a bigInt (la libreria global big-integer expuesta en index.html).
            const rand64 = () => {
                const hi = (Math.random() * 0x100000000) >>> 0;
                const lo = (Math.random() * 0x100000000) >>> 0;
                return bigInt(hi).shiftLeft(32).add(bigInt(lo));
            };
            const randomIds = ids.map(rand64);
            const params = {
                fromPeer: from, toPeer: to,
                id: ids, randomId: randomIds,
                dropAuthor: !!asCopy, dropMediaCaptions: false,
                silent: false, background: false, withMyScore: false, noforwards: false
            };
            if (topId) params.topMsgId = topId;
            await this.client.invoke(new Api.messages.ForwardMessages(params));
        }

        // Lista los tópicos (foros) de un grupo, paginando para traer TODOS.
        async getGroupTopics(peer) {
            const entity = await this.resolvePeer(peer);
            const all = [];
            let offsetDate = 0, offsetId = 0, offsetTopic = 0;
            // 200 paginas x 100 = hasta 20.000 topicos (limite practicamente infinito)
            for (let page = 0; page < 200; page++) {
                let res;
                try {
                    res = await this.client.invoke(new Api.channels.GetForumTopics({
                        channel: entity, limit: 100,
                        offsetDate, offsetId, offsetTopic
                    }));
                } catch (e) { console.warn('[tg] getGroupTopics page', page, 'fallo:', e.message); break; }
                const items = (res.topics || []).filter(t => t.id !== undefined);
                if (!items.length) break;
                items.forEach(t => all.push({
                    id: Number(t.id),
                    title: t.title || ('Tema ' + t.id),
                    iconColor: t.iconColor || 0,
                    unread: t.unreadCount || 0,
                    closed: !!t.closed,
                    pinned: !!t.pinned,
                    fromId: t.fromId ? String(t.fromId.userId || t.fromId.channelId || '') : ''
                }));
                if (items.length < 100) break;
                // Preparar offset para la siguiente pagina (ultimo topic)
                const last = items[items.length - 1];
                offsetTopic = Number(last.id);
                // Para paginacion correcta tambien hace falta offsetDate del ultimo top message
                if (res.messages && res.messages.length) {
                    const lm = res.messages[res.messages.length - 1];
                    offsetDate = Number(lm.date) || 0;
                    offsetId = Number(lm.id) || 0;
                }
                if (offsetTopic === 0) break;
            }
            // Quitar duplicados conservando orden
            const seen = new Set(); const out = [];
            for (const t of all) { if (!seen.has(t.id)) { seen.add(t.id); out.push(t); } }
            return out;
        }

        // Crear un nuevo tópico (foro) en un grupo.
        async createTopic(peer, title, iconColor) {
            const entity = await this.resolvePeer(peer);
            const colors = [0x6FB9F0, 0xFFD67E, 0xCB86DB, 0x8EEE98, 0xFF93B2, 0xFB6F5F];
            const color = iconColor != null ? Number(iconColor) : colors[Math.floor(Math.random() * colors.length)];
            const random = bigInt(Math.floor(Math.random() * 0x100000000)).shiftLeft(32)
                .add(bigInt(Math.floor(Math.random() * 0x100000000)));
            const res = await this.client.invoke(new Api.channels.CreateForumTopic({
                channel: entity,
                title: String(title || '').slice(0, 128) || 'Nuevo tema',
                iconColor: color,
                randomId: random
            }));
            // res.updates contiene el topic creado; devolvemos un topicId aproximado
            return { ok: true };
        }

        // Datos de la cuenta logueada (premium, etc.)
        async getMyAccount() {
            try {
                const me = await this.client.getMe();
                return {
                    id: String(me.id || ''),
                    firstName: me.firstName || '',
                    lastName: me.lastName || '',
                    username: me.username || '',
                    premium: !!me.premium,
                    verified: !!me.verified,
                    phone: me.phone || ''
                };
            } catch (e) { return null; }
        }

        // Busqueda global de mensajes en TODOS los chats donde participa el usuario.
        // Usa la API raw messages.SearchGlobal con filtro opcional ('all' | 'photos'
        // | 'videos' | 'docs' | 'links').
        async searchGlobal(query, limit, filterKind) {
            const q = String(query || '').trim();
            if (!q) return [];
            const Filters = {
                all: new Api.InputMessagesFilterEmpty(),
                photos: new Api.InputMessagesFilterPhotos(),
                videos: new Api.InputMessagesFilterVideo(),
                docs: new Api.InputMessagesFilterDocument(),
                links: new Api.InputMessagesFilterUrl(),
                music: new Api.InputMessagesFilterMusic(),
                voice: new Api.InputMessagesFilterVoice()
            };
            const filter = Filters[filterKind] || Filters.all;
            let res;
            try {
                res = await this.client.invoke(new Api.messages.SearchGlobal({
                    q,
                    filter,
                    minDate: 0, maxDate: 0,
                    offsetRate: 0,
                    offsetPeer: new Api.InputPeerEmpty(),
                    offsetId: 0,
                    limit: Math.min(Number(limit) || 30, 100),
                    folderId: 0
                }));
            } catch (e) {
                console.warn('[tg] searchGlobal fallo:', e.message);
                return [];
            }
            // res.messages, res.chats, res.users → construir indice de peers
            const peerIndex = new Map();
            for (const c of (res.chats || [])) peerIndex.set(String(c.id), c);
            for (const u of (res.users || [])) peerIndex.set(String(u.id), u);

            const out = [];
            for (const m of (res.messages || [])) {
                if (!m || m.id == null) continue;
                // Identificar el peer del mensaje
                let peer = m.peerId; let pid = '', pTitle = '', pType = 'other';
                if (peer && peer.userId) { pid = String(peer.userId); }
                else if (peer && peer.chatId) { pid = '-' + String(peer.chatId); }
                else if (peer && peer.channelId) { pid = '-100' + String(peer.channelId); }
                const ent = peerIndex.get(pid.replace(/^-100|^-/, ''));
                if (ent) {
                    pTitle = ent.title || ent.firstName || ent.username || 'Sin nombre';
                    if (ent.broadcast) pType = 'channel';
                    else if (ent.megagroup || ent.className === 'Chat') pType = 'group';
                    else if (ent.bot) pType = 'bot';
                    else if (ent.className === 'User') pType = 'private';
                }
                const doc = m.media && m.media.document;
                const ph = m.media && m.media.photo;
                const isVideo = !!(doc && /video|mp4|matroska|x-msvideo|quicktime/.test(doc.mimeType || ''));
                const isImage = !!ph || !!(doc && /image\//.test(doc.mimeType || ''));
                const hasThumb = !!(ph || (doc && doc.thumbs && doc.thumbs.length));
                let filename = '';
                if (doc) {
                    const fn = (doc.attributes || []).find(a => a.className === 'DocumentAttributeFilename');
                    if (fn) filename = fn.fileName || '';
                }
                out.push({
                    id: m.id,
                    peerId: pid,
                    peerTitle: pTitle,
                    peerType: pType,
                    date: Number(m.date) || 0,
                    text: m.message || '',
                    hasMedia: !!m.media, isVideo, isImage,
                    filename, size: doc ? Number(doc.size) : 0,
                    hasThumb
                });
            }
            return out;
        }

        // Descarga el contenido (thumbnail) de un mensaje cualquiera (Buffer/Uint8Array).
        async downloadAnyThumb(peer, msgId) {
            const entity = await this.resolvePeer(peer);
            const res = await this.client.getMessages(entity, { ids: [Number(msgId)] });
            const m = res && res[0]; if (!m || !m.media) return null;
            if (m.media.photo) return await this.client.downloadMedia(m, {});
            const doc = m.media.document;
            if (doc && doc.thumbs && doc.thumbs.length) return await this.client.downloadMedia(m, { thumb: doc.thumbs.length - 1 });
            return null;
        }
    }

    window.TelegramService = TelegramService;
})();
