/* ===================================================================
 * MKV Player — reproductor avanzado para formatos no compatibles con el
 * navegador (MKV, AVI, FLV, etc.). Usa FFmpeg.wasm para hacer remux a
 * MP4 fragmentado al vuelo, y reproduce el resultado con <video>.
 *
 * IMPORTANTE: FFmpeg.wasm pesa ~30 MB; lo cargamos LAZY, solo la primera
 * vez que el usuario pulsa "Reproducir aquí (avanzado)". Despues queda
 * cacheado en el navegador.
 * =================================================================== */
(function () {
    'use strict';
    let ffmpeg = null;
    let coreLoaded = false;
    let loading = false;

    // CDN de FFmpeg.wasm (UMD). Tres mirrors para no depender de uno solo.
    const FFMPEG_SRC = [
        'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js',
        'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js',
        'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js'
    ];
    const UTIL_SRC = [
        'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/umd/index.js',
        'https://unpkg.com/@ffmpeg/util@0.12.2/dist/umd/index.js',
        'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js',
        'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js'
    ];
    const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';

    function loadScript(src) {
        return new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = src; s.async = false;
            s.onload = res;
            s.onerror = () => rej(new Error('No se pudo cargar ' + src));
            document.head.appendChild(s);
        });
    }

    async function loadFFmpeg(progressCb) {
        if (coreLoaded) return ffmpeg;
        if (loading) {
            // Esperar al cargador en curso
            while (loading) await new Promise(r => setTimeout(r, 100));
            return ffmpeg;
        }
        loading = true;
        try {
            progressCb && progressCb('Descargando FFmpeg.wasm (~30 MB)...');
            // Probamos varios CDN de FFmpeg.js
            let okFf = false;
            for (const u of FFMPEG_SRC) {
                try { await loadScript(u); okFf = true; break; }
                catch (e) { console.warn('[mkv] FFmpeg fallo en', u); }
            }
            if (!okFf) throw new Error('No se pudo cargar FFmpeg.wasm desde ningún CDN');
            // Y varios mirrors de @ffmpeg/util
            let okU = false;
            for (const u of UTIL_SRC) {
                try { await loadScript(u); okU = true; break; }
                catch (e) { console.warn('[mkv] util fallo en', u); }
            }
            if (!okU) throw new Error('No se pudo cargar @ffmpeg/util desde ningún CDN');
            const FFmpegLib = window.FFmpegWASM || window.FFmpeg;
            const Util = window.FFmpegUtil;
            if (!FFmpegLib || !Util) throw new Error('FFmpeg/Util no se expusieron globalmente');
            ffmpeg = new FFmpegLib.FFmpeg();
            ffmpeg.on('progress', (p) => {
                if (p.progress != null && progressCb) progressCb('Convirtiendo: ' + Math.round(p.progress * 100) + '%');
            });
            progressCb && progressCb('Inicializando motor (primera vez puede tardar)...');
            await ffmpeg.load({
                coreURL: await Util.toBlobURL(CORE_BASE + '/ffmpeg-core.js', 'text/javascript'),
                wasmURL: await Util.toBlobURL(CORE_BASE + '/ffmpeg-core.wasm', 'application/wasm')
            });
            coreLoaded = true;
            return ffmpeg;
        } finally {
            loading = false;
        }
    }

    // UI: overlay propio para mostrar el video remuxeado y el progreso.
    function ensureUI() {
        let m = document.getElementById('mkv-overlay');
        if (m) return m;
        const html = `
        <div id="mkv-overlay" hidden>
            <div class="mkv-back"></div>
            <div class="mkv-card">
                <button class="mkv-close" type="button" aria-label="Cerrar">&times;</button>
                <h3 class="mkv-title">Reproductor avanzado</h3>
                <p class="mkv-status">Preparando…</p>
                <div class="mkv-bar"><div class="mkv-bar-fill"></div></div>
                <video id="mkv-video" controls playsinline hidden></video>
                <p class="mkv-hint">Esto convierte el archivo en el navegador. Para vídeos largos puede tardar.<br>Si tu equipo es lento, usa la opción de descargar y abrirlo con un reproductor del sistema.</p>
            </div>
        </div>`;
        const wrap = document.createElement('div'); wrap.innerHTML = html;
        document.body.appendChild(wrap.firstElementChild);
        m = document.getElementById('mkv-overlay');
        m.querySelector('.mkv-close').addEventListener('click', closeUI);
        m.querySelector('.mkv-back').addEventListener('click', closeUI);
        return m;
    }
    function setStatus(t) { const s = document.querySelector('#mkv-overlay .mkv-status'); if (s) s.innerText = t || ''; }
    function setBar(pct) { const b = document.querySelector('#mkv-overlay .mkv-bar-fill'); if (b) b.style.width = (pct || 0) + '%'; }
    function showVideo(url) {
        const v = document.getElementById('mkv-video'); if (!v) return;
        v.hidden = false; v.src = url; v.play().catch(() => { });
    }
    function closeUI() {
        const m = document.getElementById('mkv-overlay'); if (!m) return;
        const v = document.getElementById('mkv-video');
        if (v) { try { v.pause(); } catch (e) { } v.removeAttribute('src'); v.load(); v.hidden = true; }
        const cur = m.dataset.objectUrl;
        if (cur) { try { URL.revokeObjectURL(cur); } catch (e) { } delete m.dataset.objectUrl; }
        m.hidden = true; setBar(0); setStatus('Preparando…');
    }

    // Carga el archivo desde su streamUrl y lo remuxea a MP4 con FFmpeg
    async function play(playable) {
        const m = ensureUI();
        m.hidden = false;
        setStatus('Iniciando...');
        setBar(0);

        try {
            const url = playable && playable.streamUrl;
            if (!url) throw new Error('Sin URL de video');

            // 1) Cargar FFmpeg si no lo está
            const ff = await loadFFmpeg(setStatus);

            // 2) Descargar el archivo (con progreso)
            setStatus('Descargando vídeo...');
            const dlUrl = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'download=1';
            const r = await fetch(dlUrl);
            if (!r.ok) throw new Error('No se pudo descargar (HTTP ' + r.status + ')');
            const total = Number(r.headers.get('content-length') || 0);
            const reader = r.body && r.body.getReader ? r.body.getReader() : null;
            let buf;
            if (reader) {
                const chunks = []; let received = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value); received += value.length;
                    if (total) setBar(Math.min(40, Math.round((received / total) * 40)));
                }
                buf = new Uint8Array(received);
                let off = 0;
                for (const c of chunks) { buf.set(c, off); off += c.length; }
            } else {
                const ab = await r.arrayBuffer();
                buf = new Uint8Array(ab);
            }

            // 3) Remux con FFmpeg (sin recodificar -> rapido)
            const inName = (playable.filename || 'in').replace(/[^\w.-]+/g, '_') || 'in';
            const ext = (playable.ext || 'mkv').replace(/[^a-z0-9]/gi, '');
            const inFile = inName.includes('.') ? inName : (inName + '.' + ext);
            const outFile = 'out.mp4';
            setStatus('Convirtiendo (remux a MP4, sin recodificar)...');
            await ff.writeFile(inFile, buf);
            try {
                // -c copy: solo cambia contenedor; -movflags faststart: para reproducir mientras descarga.
                await ff.exec(['-i', inFile, '-c', 'copy', '-movflags', '+faststart', outFile]);
            } catch (e) {
                // Si falla el remux puro (codec incompatible con MP4), intenta transcodificar audio
                setStatus('Codec poco compatible, recodificando audio (puede tardar)...');
                await ff.exec(['-i', inFile, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outFile]);
            }
            setBar(95);
            const outData = await ff.readFile(outFile);
            try { await ff.deleteFile(inFile); } catch (e) { }
            try { await ff.deleteFile(outFile); } catch (e) { }
            const blob = new Blob([outData.buffer], { type: 'video/mp4' });
            const objectUrl = URL.createObjectURL(blob);
            const overlay = document.getElementById('mkv-overlay');
            if (overlay) overlay.dataset.objectUrl = objectUrl;
            setBar(100); setStatus('Reproduciendo');
            showVideo(objectUrl);
        } catch (e) {
            setStatus('Error: ' + (e && e.message || e));
            console.error('[mkv]', e);
        }
    }

    window.MkvPlayer = { play };
})();
