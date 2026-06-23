/* ============================================================================
 * artplayer-bridge.js — Integracion de Artplayer + hls.js como reproductor
 * principal de player-tv. Inspirado en la arquitectura de iptvnator (MIT)
 * https://github.com/4gray/iptvnator
 *
 * Estrategia:
 *  - Detecta tipo de stream segun la extension del URL.
 *  - Para .m3u8 usa hls.js; para resto usa <video> nativo (que ya soporta MP4,
 *    WebM y muchas veces MKV con codec H264/AAC).
 *  - Para .mkv/.avi/.flv NO se usa este puente: sigue mandando MkvPlayer con
 *    FFmpeg.wasm (mejor experiencia en navegador).
 *  - Mantiene la misma API que el `<video id="player-video">` para que
 *    Player._tick(), flushProgress() y los callbacks de progreso/onended
 *    sigan funcionando sin tocar mucho codigo.
 *
 * Expone window.ArtBridge con metodos:
 *  - load(url, opts)   : monta el reproductor y empieza a cargar
 *  - destroy()         : limpia la instancia (libera memoria)
 *  - getVideoEl()      : devuelve el <video> interno de artplayer (para
 *                        Player._tick() y guardar progreso)
 *  - on(name, fn)      : suscribirse a 'ready' | 'timeupdate' | 'ended' |
 *                        'error' | 'volumechange'
 *  - currentTime / duration / volume / paused : passthrough al <video>
 *  - play() / pause() / seek(t)
 * ============================================================================ */
(function () {
    'use strict';

    // === Helpers ===
    function detectType(url) {
        const u = String(url || '').toLowerCase().split('?')[0].split('#')[0];
        if (u.endsWith('.m3u8')) return 'm3u8';
        if (u.endsWith('.mpd')) return 'mpd';
        if (u.endsWith('.ts')) return 'ts';
        if (u.endsWith('.flv')) return 'flv';
        if (u.endsWith('.webm')) return 'webm';
        if (u.endsWith('.mp4') || u.endsWith('.m4v') || u.endsWith('.mov')) return 'mp4';
        // tgstream/... no tiene extension, asumimos mp4 (es lo mas comun en Telegram)
        return '';
    }

    // Logo TV+ verde sobre transparente para la esquina del reproductor (24x24 SVG)
    const TVPLUS_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" rx="10" fill="#0a1a3a"/>' +
        '<text x="32" y="44" font-family="Arial Black,sans-serif" font-size="32" font-weight="900" fill="#3ee65c" text-anchor="middle">TV+</text>' +
        '</svg>'
    );

    // === ArtBridge (singleton) ===
    const ArtBridge = {
        art: null,
        hls: null,
        listeners: { ready: [], timeupdate: [], ended: [], error: [], volumechange: [] },
        _ready: false,

        // Inicializar / reusar la instancia. Si ya hay una con el mismo container,
        // solo cambiamos la url (mas rapido y conserva el componente).
        load(url, opts) {
            opts = opts || {};
            if (typeof Artplayer === 'undefined') {
                console.warn('[ArtBridge] Artplayer aun no cargado; usando <video> nativo de fallback');
                return false;
            }
            const container = document.getElementById('artplayer-mount');
            if (!container) { console.warn('[ArtBridge] no hay #artplayer-mount'); return false; }

            // Limpiar instancia previa por completo (para evitar fugas con hls)
            this.destroy();

            container.hidden = false;
            container.innerHTML = '';

            const type = detectType(url);
            const customType = {};
            // hls.js para .m3u8 (los demas formatos van directos al <video>)
            if (type === 'm3u8' && window.Hls && window.Hls.isSupported()) {
                customType.m3u8 = (video, mediaUrl) => {
                    if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
                    const hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
                    hls.loadSource(mediaUrl);
                    hls.attachMedia(video);
                    hls.on(window.Hls.Events.ERROR, (_e, data) => {
                        if (data.fatal) {
                            this._emit('error', new Error(data.details || 'HLS error'));
                        }
                    });
                    this.hls = hls;
                };
            }

            // === Construccion de Artplayer ===
            // Las opciones siguen el patron documentado en https://artplayer.org/
            try {
                this.art = new Artplayer({
                    container,
                    url,
                    type,
                    customType,
                    poster: opts.poster || '',
                    title: opts.title || '',
                    volume: typeof opts.volume === 'number' ? opts.volume : 1,
                    autoplay: true,
                    pip: true,
                    autoSize: false,
                    autoMini: false,
                    screenshot: true,
                    setting: true,
                    flip: true,
                    playbackRate: true,
                    aspectRatio: true,
                    fullscreen: true,
                    fullscreenWeb: true,
                    miniProgressBar: true,
                    mutex: true,
                    backdrop: true,
                    playsInline: true,
                    autoPlayback: true,
                    airplay: true,
                    theme: '#3ee65c',
                    moreVideoAttr: { crossOrigin: 'anonymous', preload: 'auto', playsinline: 'true' },
                    icons: { state: TVPLUS_LOGO },
                    // Atajos teclado/mando estandar (Artplayer ya los trae, los amplio):
                    hotkey: true,
                    // Posicion del logo: esquina superior derecha
                    layers: [{
                        name: 'tvplus-watermark',
                        html: '<div style="position:absolute;top:14px;right:14px;font:700 14px sans-serif;color:#3ee65c;text-shadow:0 1px 3px rgba(0,0,0,0.7)">TV+</div>',
                        click: () => {}
                    }],
                    // Mensajes en castellano
                    i18n: {
                        es: {
                            'Show subtitles': 'Mostrar subtitulos',
                            'Hide subtitles': 'Ocultar subtitulos',
                            'Show settings': 'Ajustes',
                            'Show danmuku': 'Mostrar danmuku',
                            'Hide danmuku': 'Ocultar danmuku',
                            'Subtitle': 'Subtitulos',
                            'Speed': 'Velocidad',
                            'Aspect Ratio': 'Relacion de aspecto',
                            'Default': 'Por defecto',
                            'Normal': 'Normal',
                            'Open': 'Abrir',
                            'Close': 'Cerrar',
                            'Switch Video': 'Cambiar video',
                            'Switch Subtitle': 'Cambiar subtitulos',
                            'Fullscreen': 'Pantalla completa',
                            'Exit Fullscreen': 'Salir de pantalla completa',
                            'Mini Player': 'Mini reproductor',
                            'PIP Mode': 'Pantalla en pantalla',
                            'Exit PIP Mode': 'Salir de PIP',
                            'PIP Not Supported': 'PIP no soportado',
                            'Fullscreen Not Supported': 'Pantalla completa no soportada',
                            'Video Info': 'Info del video',
                            'Close Video Info': 'Cerrar info',
                            'Video Load Failed': 'Error al cargar el video',
                            'Volume': 'Volumen',
                            'Play': 'Reproducir',
                            'Pause': 'Pausa',
                            'Rate': 'Velocidad',
                            'Mute': 'Silenciar',
                            'Video Flip': 'Voltear video',
                            'Horizontal': 'Horizontal',
                            'Vertical': 'Vertical',
                            'Reconnect': 'Reconectar',
                            'Show/Hide Danmuku': 'Mostrar/Ocultar danmuku',
                            'Show/Hide Subtitle': 'Mostrar/Ocultar subtitulos',
                            'Screenshot': 'Captura',
                            'Loop': 'Bucle'
                        }
                    },
                    lang: 'es'
                });
            } catch (e) {
                console.error('[ArtBridge] error montando Artplayer:', e);
                container.hidden = true;
                return false;
            }

            // Eventos pasados al exterior
            this.art.on('ready', () => { this._ready = true; this._emit('ready'); });
            this.art.on('video:timeupdate', () => this._emit('timeupdate'));
            this.art.on('video:ended', () => this._emit('ended'));
            this.art.on('video:error', (err) => this._emit('error', err));
            this.art.on('video:volumechange', () => this._emit('volumechange'));

            // Reanudar si nos pasaron resume time
            if (opts.resume && opts.resume > 8) {
                const onMeta = () => {
                    try {
                        if (this.art && this.art.video && opts.resume < this.art.video.duration - 5) {
                            this.art.video.currentTime = opts.resume;
                        }
                    } catch {}
                    this.art.video.removeEventListener('loadedmetadata', onMeta);
                };
                this.art.video.addEventListener('loadedmetadata', onMeta);
            }

            return true;
        },

        destroy() {
            this._ready = false;
            try {
                if (this.art) {
                    // Pause + remove listeners ANTES de destruir
                    try { this.art.pause(); } catch {}
                    this.art.destroy(false);
                }
            } catch (e) { console.warn('[ArtBridge] destroy art:', e); }
            this.art = null;
            try {
                if (this.hls) this.hls.destroy();
            } catch (e) { console.warn('[ArtBridge] destroy hls:', e); }
            this.hls = null;
            const c = document.getElementById('artplayer-mount');
            if (c) { c.innerHTML = ''; c.hidden = true; }
        },

        getVideoEl() { return this.art && this.art.video ? this.art.video : null; },
        get currentTime() { return this.getVideoEl() ? this.getVideoEl().currentTime : 0; },
        get duration() { return this.getVideoEl() ? this.getVideoEl().duration : 0; },
        get volume() { return this.getVideoEl() ? this.getVideoEl().volume : 1; },
        get paused() { return this.getVideoEl() ? this.getVideoEl().paused : true; },
        get hidden() {
            const c = document.getElementById('artplayer-mount');
            return !c || c.hidden;
        },
        play() { try { return this.art && this.art.play(); } catch { return Promise.resolve(); } },
        pause() { try { this.art && this.art.pause(); } catch {} },
        seek(t) { try { if (this.art && this.art.video) this.art.video.currentTime = Number(t) || 0; } catch {} },

        on(name, fn) {
            if (!this.listeners[name]) this.listeners[name] = [];
            this.listeners[name].push(fn);
        },
        off(name, fn) {
            if (!this.listeners[name]) return;
            this.listeners[name] = this.listeners[name].filter(f => f !== fn);
        },
        _emit(name, payload) {
            (this.listeners[name] || []).forEach(fn => { try { fn(payload); } catch (e) { console.warn(e); } });
        }
    };

    window.ArtBridge = ArtBridge;
})();
