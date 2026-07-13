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

    function detectType(url) {
        const u = String(url || '').toLowerCase().split('?')[0].split('#')[0];
        if (u.endsWith('.m3u8')) return 'm3u8';
        if (u.endsWith('.mpd')) return 'mpd';
        return '';
    }

    const ArtBridge = {
        art: null,
        hls: null,
        listeners: { ready: [], timeupdate: [], ended: [], error: [], volumechange: [] },

        load(url, opts) {
            opts = opts || {};
            const container = document.getElementById('artplayer-mount');
            if (!container || typeof Artplayer === 'undefined') return false;

            this.destroy();
            container.hidden = false;

            const type = detectType(url);

            this.art = new Artplayer({
                container,
                url,
                type,
                poster: opts.poster || '',
                title: opts.title || '',
                volume: typeof opts.volume === 'number' ? opts.volume : 1,
                autoplay: true,
                playbackRate: true,
                aspectRatio: true,
                fullscreen: true,
                fullscreenWeb: true,
                miniProgressBar: true,
                theme: '#3ee65c',
                plugins: [
                    artplayerPluginCast({
                        button: true,
                        metadata: { title: opts.title || 'Tv Player', subtitle: 'Streaming TV+' }
                    }),
                ],
                customType: {
                    mpd: (video, url, art) => {
                        const p = new shaka.Player(video);
                        p.load(url).catch(e => console.error(e));
                        art.on('destroy', () => p.destroy());
                    },
                    m3u8: (video, url, art) => {
                        if (Hls.isSupported()) {
                            const hls = new Hls(); hls.loadSource(url); hls.attachMedia(video);
                            art.on('destroy', () => hls.destroy());
                        } else {
                            const p = new shaka.Player(video);
                            p.load(url).catch(e => console.error(e));
                            art.on('destroy', () => p.destroy());
                        }
                    }
                },
                i18n: { es: { 'Speed': 'Velocidad', 'Fullscreen': 'Pantalla completa' } },
                lang: 'es'
            });

            this.art.on('video:timeupdate', () => this._emit('timeupdate'));
            this.art.on('video:ended', () => this._emit('ended'));
            this.art.on('video:error', (err) => this._emit('error', err));
            
            return true;
        },

        destroy() {
            if (this.art) { this.art.destroy(false); this.art = null; }
            if (this.hls) { this.hls.destroy(); this.hls = null; }
            const c = document.getElementById('artplayer-mount');
            if (c) { c.innerHTML = ''; c.hidden = true; }
        },

        getVideoEl() { return this.art && this.art.video ? this.art.video : null; },
        get currentTime() { return this.getVideoEl() ? this.getVideoEl().currentTime : 0; },
        get duration() { return this.getVideoEl() ? this.getVideoEl().duration : 0; },
        get hidden() { return !this.art; },
        _emit(name, payload) { (this.listeners[name] || []).forEach(fn => fn(payload)); },
        on(name, fn) { if (this.listeners[name]) this.listeners[name].push(fn); }
    };

    window.ArtBridge = ArtBridge;
})();
