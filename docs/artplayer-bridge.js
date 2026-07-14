/* ============================================================================
 * artplayer-bridge.js — Integracion de Artplayer + hls.js + Prioridad NativeHost
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
            const cleanUrl = url || '';

            // =================================================================
            // 1. INTERCEPCIÓN NATIVA (Para pantalla completa real en APK)
            // =================================================================
            if (window.NativeHost && NativeHost.isAvailable()) {
                const title = opts.title || 'Streaming';
                // Usamos ExoPlayer para MP4 y VLC para el resto (.m3u8, etc.)
                const engine = cleanUrl.includes('.mp4') ? 'exo' : 'vlc';
                
                // Enviamos la orden a la APK y cancelamos la carga de ArtPlayer
                NativeHost.playUrl(cleanUrl, title, "video/mp4", engine);
                return true; 
            }

            // =================================================================
            // 2. REPRODUCTOR WEB (Si no estamos en la APK, monta Artplayer/Shaka)
            // =================================================================
            const container = document.getElementById('artplayer-mount');
            if (!container || typeof Artplayer === 'undefined') return false;

            this.destroy();
            container.hidden = false;

            const type = detectType(cleanUrl);

            this.art = new Artplayer({
                container,
                url: cleanUrl,
                type,
                poster: opts.poster || '',
                title: opts.title || '',
                volume: typeof opts.volume === 'number' ? opts.volume : 1,
                autoplay: true,
                playbackRate: true,
                aspectRatio: true,
                fullscreen: true,       // Activa botón de pantalla completa nativa
                fullscreenWeb: true,    // Pantalla completa en web/navegador
                miniProgressBar: true,
                theme: '#3ee65c',
                plugins: [
                    artplayerPluginCast({
                        button: true,
                        metadata: { title: opts.title || 'Tv Player', subtitle: 'Streaming TV+' }
                    }),
                ],
                customType: {
                    // Fuerza Shaka Player en la web para archivos DASH (.mpd)
                    mpd: (video, url, art) => {
                        const p = new shaka.Player(video);
                        p.load(url).catch(e => console.error(e));
                        art.on('destroy', () => p.destroy());
                    },
                    // Usa Shaka Player como alternativa de reproducción de HLS (.m3u8)
                    m3u8: (video, url, art) => {
                        if (Hls.isSupported()) {
                            const hls = new Hls(); 
                            hls.loadSource(url); 
                            hls.attachMedia(video);
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

            // Forzar pantalla completa nativa del navegador al reproducir en Web
            this.art.on('ready', () => {
                this._emit('ready');
                if (this.art.fullscreen) {
                    this.art.fullscreen = true; // Intenta auto-pantalla completa
                }
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
