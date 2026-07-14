/* ============================================================================
 * shaka-bridge.js — Integración de Shaka Player UI + Prioridad NativeHost (APK)
 * ============================================================================ */
(function () {
    'use strict';

    const ShakaBridge = {
        player: null,
        ui: null,
        videoEl: null,
        listeners: { ready: [], timeupdate: [], ended: [], error: [], volumechange: [] },

        async load(url, opts) {
            opts = opts || {};
            const cleanUrl = url || '';

            // =================================================================
            // 1. INTERCEPCIÓN NATIVA (Para pantalla completa real en APK)
            // =================================================================
            if (window.NativeHost && NativeHost.isAvailable()) {
                const title = opts.title || 'Streaming';
                const engine = cleanUrl.includes('.mp4') ? 'exo' : 'vlc';
                
                // Envía la señal a la APK para abrir ExoPlayer o VLC
                NativeHost.playUrl(cleanUrl, title, "video/mp4", engine);
                return true; 
            }

            // =================================================================
            // 2. REPRODUCTOR WEB (Shaka Player UI)
            // =================================================================
            this.videoEl = document.getElementById('player-video');
            const container = document.getElementById('shaka-container');
            
            if (!this.videoEl || !container || typeof shaka === 'undefined') {
                console.error("Faltan dependencias de Shaka Player o contenedores HTML.");
                return false;
            }

            this.destroy();

            // Instanciamos el reproductor de Shaka
            this.player = new shaka.Player(this.videoEl);

            // Configuramos la interfaz de usuario (UI) oficial de Shaka
            this.ui = new shaka.ui.Overlay(this.player, container, this.videoEl);
            
            // Forzamos la configuración de los controles en español y añadimos botón Fullscreen
            const config = {
                'controlPanelElements': ['play_pause', 'time_and_duration', 'spacer', 'volume', 'fullscreen', 'overflow_menu'],
                'addLanguage': 'es',
                'language': 'es'
            };
            this.ui.configure(config);

            // Escuchar eventos para la pasarela de Telegram (guardar progreso, etc.)
            this.videoEl.addEventListener('timeupdate', () => this._emit('timeupdate'));
            this.videoEl.addEventListener('ended', () => this._emit('ended'));
            this.videoEl.addEventListener('error', (err) => this._emit('error', err));

            try {
                // Cargamos la URL del stream
                await this.player.load(cleanUrl);
                this._emit('ready');

                // Aplicar volumen inicial
                this.videoEl.volume = typeof opts.volume === 'number' ? opts.volume : 1;
                
                // Reproducción automática
                this.videoEl.play();

            } catch (error) {
                console.error("Error al cargar el video en Shaka:", error);
                this._emit('error', error);
                
                // Fallback clásico si Shaka falla con el stream
                this.videoEl.src = cleanUrl;
                this.videoEl.play();
            }
            
            return true;
        },

        destroy() {
            // Destrucción limpia del entorno de Shaka para liberar memoria
            if (this.ui) {
                this.ui.destroy();
                this.ui = null;
            }
            if (this.player) {
                this.player.destroy();
                this.player = null;
            }
            if (this.videoEl) {
                this.videoEl.removeAttribute('src');
                this.videoEl.load();
            }
        },

        getVideoEl() { return this.videoEl; },
        get currentTime() { return this.videoEl ? this.videoEl.currentTime : 0; },
        get duration() { return this.videoEl ? this.videoEl.duration : 0; },
        get hidden() { return !this.player; },
        _emit(name, payload) { (this.listeners[name] || []).forEach(fn => fn(payload)); },
        on(name, fn) { if (this.listeners[name]) this.listeners[name].push(fn); }
    };

    // Mantenemos el alias para compatibilidad absoluta con tg-app.js
    window.ArtBridge = ShakaBridge;
})();
