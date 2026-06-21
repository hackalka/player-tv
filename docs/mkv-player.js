/* ===================================================================
 * MKV Player AVANZADO — reproduce MKV/AVI/etc. paralelizando:
 *   1) Carga de FFmpeg.wasm (~30 MB la primera vez).
 *   2) Descarga del vídeo (con velocidad + ETA en pantalla).
 *   3) Cuando ambas cosas terminan: remux (cambio de contenedor)
 *      casi instantáneo y reproducción.
 *
 * Para MP4 / WebM, no se usa este reproductor: el HTML5 nativo +
 * Service Worker ya hacen "ver mientras se descarga" de serie.
 *
 * Nota: MKV/AVI verdadero "ver mientras se descarga" requiere libav.js
 * con streaming output, que es un cambio grande. Esta version paraleliza
 * todo lo posible para minimizar la espera.
 * =================================================================== */
(function () {
    'use strict';
    let ffmpeg = null;
    let coreLoaded = false;
    let loading = false;

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
    function fmtBytes(n) { if (!n) return '0 B'; const u=['B','KB','MB','GB']; let v=Number(n),i=0; while(v>=1024 && i<u.length-1){v/=1024;i++} return v.toFixed(v<10&&i?1:0)+' '+u[i]; }
    function fmtETA(secs) { secs = Math.max(0, Math.round(secs)); if (secs < 60) return secs + 's'; const m = Math.floor(secs/60), s = secs%60; if (m < 60) return m + 'm ' + s + 's'; const h = Math.floor(m/60); return h + 'h ' + (m%60) + 'm'; }

    async function loadFFmpeg(progressCb) {
        if (coreLoaded) return ffmpeg;
        if (loading) {
            while (loading) await new Promise(r => setTimeout(r, 100));
            return ffmpeg;
        }
        loading = true;
        try {
            progressCb && progressCb({ stage: 'engine', text: 'Descargando motor (~30 MB)...' });
            let okFf = false;
            for (const u of FFMPEG_SRC) { try { await loadScript(u); okFf = true; break; } catch (e) { } }
            if (!okFf) throw new Error('No se pudo cargar FFmpeg.wasm');
            let okU = false;
            for (const u of UTIL_SRC) { try { await loadScript(u); okU = true; break; } catch (e) { } }
            if (!okU) throw new Error('No se pudo cargar @ffmpeg/util');
            const FFmpegLib = window.FFmpegWASM || window.FFmpeg;
            const Util = window.FFmpegUtil;
            if (!FFmpegLib || !Util) throw new Error('FFmpeg/Util no se expusieron');
            ffmpeg = new FFmpegLib.FFmpeg();
            ffmpeg.on('progress', (p) => {
                if (p.progress != null && progressCb) progressCb({ stage: 'remux-progress', pct: Math.round(p.progress * 100) });
            });
            progressCb && progressCb({ stage: 'engine', text: 'Inicializando motor...' });
            await ffmpeg.load({
                coreURL: await Util.toBlobURL(CORE_BASE + '/ffmpeg-core.js', 'text/javascript'),
                wasmURL: await Util.toBlobURL(CORE_BASE + '/ffmpeg-core.wasm', 'application/wasm')
            });
            coreLoaded = true;
            progressCb && progressCb({ stage: 'engine-ready' });
            return ffmpeg;
        } finally { loading = false; }
    }

    function ensureUI() {
        let m = document.getElementById('mkv-overlay');
        if (m) return m;
        const html = `
        <div id="mkv-overlay" hidden>
            <div class="mkv-back"></div>
            <div class="mkv-card">
                <button class="mkv-close" type="button" aria-label="Cerrar">&times;</button>
                <h3 class="mkv-title">▶ Reproductor avanzado</h3>
                <video id="mkv-video" controls playsinline hidden></video>

                <div class="mkv-progress" id="mkv-progress">
                    <div class="mkv-row">
                        <div class="mkv-label">⬇ Descargando vídeo</div>
                        <div class="mkv-bar"><div class="mkv-bar-fill" id="mkv-bar-dl"></div></div>
                        <div class="mkv-stats" id="mkv-stats-dl">esperando…</div>
                    </div>
                    <div class="mkv-row">
                        <div class="mkv-label">⚙ Motor de conversión</div>
                        <div class="mkv-bar"><div class="mkv-bar-fill engine" id="mkv-bar-eng"></div></div>
                        <div class="mkv-stats" id="mkv-stats-eng">esperando…</div>
                    </div>
                    <div class="mkv-row">
                        <div class="mkv-label">🎬 Conversión</div>
                        <div class="mkv-bar"><div class="mkv-bar-fill remux" id="mkv-bar-rem"></div></div>
                        <div class="mkv-stats" id="mkv-stats-rem">esperando…</div>
                    </div>
                </div>

                <p class="mkv-hint" id="mkv-hint">Estamos descargando el vídeo y preparando el motor en paralelo. La conversión empieza en cuanto ambos terminen.</p>
            </div>
        </div>`;
        const wrap = document.createElement('div'); wrap.innerHTML = html;
        document.body.appendChild(wrap.firstElementChild);
        m = document.getElementById('mkv-overlay');
        m.querySelector('.mkv-close').addEventListener('click', closeUI);
        m.querySelector('.mkv-back').addEventListener('click', closeUI);
        return m;
    }
    function setBar(id, pct) { const b = document.getElementById(id); if (b) b.style.width = Math.min(100, Math.max(0, pct || 0)) + '%'; }
    function setText(id, t) { const e = document.getElementById(id); if (e) e.innerText = t || ''; }
    function setHint(t) { setText('mkv-hint', t); }

    function closeUI() {
        const m = document.getElementById('mkv-overlay'); if (!m) return;
        const v = document.getElementById('mkv-video');
        if (v) { try { v.pause(); } catch (e) { } v.removeAttribute('src'); v.load(); v.hidden = true; }
        const cur = m.dataset.objectUrl;
        if (cur) { try { URL.revokeObjectURL(cur); } catch (e) { } delete m.dataset.objectUrl; }
        m.hidden = true;
        // reset barras
        ['mkv-bar-dl', 'mkv-bar-eng', 'mkv-bar-rem'].forEach(id => setBar(id, 0));
        ['mkv-stats-dl', 'mkv-stats-eng', 'mkv-stats-rem'].forEach(id => setText(id, 'esperando…'));
        setText('mkv-hint', 'Estamos descargando el vídeo y preparando el motor en paralelo.');
        // mostrar progreso
        const p = document.getElementById('mkv-progress'); if (p) p.style.display = '';
    }

    // Descarga el archivo con barra de progreso, velocidad y ETA.
    async function downloadFile(url, onProgress) {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const total = Number(r.headers.get('content-length') || 0);
        const reader = r.body && r.body.getReader ? r.body.getReader() : null;
        const t0 = Date.now();
        const chunks = []; let received = 0; let lastT = t0; let lastReceived = 0; let speed = 0;
        if (reader) {
            while (true) {
                const { done, value } = await reader.read(); if (done) break;
                chunks.push(value); received += value.length;
                const now = Date.now();
                if (now - lastT > 400) {
                    const dt = (now - lastT) / 1000;
                    speed = (received - lastReceived) / dt;
                    lastT = now; lastReceived = received;
                }
                if (onProgress) onProgress({ received, total, speed });
            }
        } else {
            const ab = await r.arrayBuffer();
            chunks.push(new Uint8Array(ab)); received = ab.byteLength; speed = received / Math.max(0.1, (Date.now() - t0) / 1000);
            if (onProgress) onProgress({ received, total: received, speed });
        }
        const buf = new Uint8Array(received); let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
        return buf;
    }

    async function play(playable) {
        const m = ensureUI();
        m.hidden = false;
        ['mkv-bar-dl', 'mkv-bar-eng', 'mkv-bar-rem'].forEach(id => setBar(id, 0));
        setText('mkv-stats-dl', 'iniciando…');
        setText('mkv-stats-eng', 'cargando motor…');
        setText('mkv-stats-rem', 'a la espera de los pasos previos…');

        try {
            const url = playable && playable.streamUrl;
            if (!url) throw new Error('Sin URL de vídeo');
            const dlUrl = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'download=1';

            // Lanzar FFmpeg + descarga EN PARALELO
            const ffPromise = loadFFmpeg(p => {
                if (p.stage === 'engine') setText('mkv-stats-eng', p.text || 'Cargando…');
                if (p.stage === 'engine-ready') { setBar('mkv-bar-eng', 100); setText('mkv-stats-eng', '✅ listo'); }
                if (p.stage === 'remux-progress') {
                    setBar('mkv-bar-rem', p.pct);
                    setText('mkv-stats-rem', p.pct + '%');
                }
            });

            const dlPromise = downloadFile(dlUrl, ({ received, total, speed }) => {
                const pct = total ? Math.round((received / total) * 100) : 0;
                setBar('mkv-bar-dl', pct);
                const eta = (speed && total) ? fmtETA((total - received) / speed) : '?';
                setText('mkv-stats-dl', `${pct}% · ${fmtBytes(received)}/${fmtBytes(total) || '?'} · ${fmtBytes(speed)}/s · ETA ${eta}`);
            });

            // Esperar a las dos
            const [ff, buf] = await Promise.all([ffPromise, dlPromise]);
            setBar('mkv-bar-dl', 100);
            setBar('mkv-bar-eng', 100);

            // Remux (sin recodificar) — rapidisimo
            setHint('Remux a MP4 (sin recodificar)... casi instantáneo si el codec es H.264/AAC.');
            const ext = (playable.ext || 'mkv').replace(/[^a-z0-9]/gi, '') || 'mkv';
            const inFile = 'in.' + ext;
            const outFile = 'out.mp4';
            await ff.writeFile(inFile, buf);
            try {
                // -c copy + faststart + frag_keyframe (fragmented MP4 = empieza a reproducir antes)
                await ff.exec([
                    '-i', inFile,
                    '-c', 'copy',
                    '-movflags', '+faststart+frag_keyframe+empty_moov',
                    '-f', 'mp4',
                    outFile
                ]);
            } catch (e) {
                setHint('El codec de audio necesita conversión. Recodificando audio (puede tardar)...');
                await ff.exec([
                    '-i', inFile,
                    '-c:v', 'copy',
                    '-c:a', 'aac', '-b:a', '192k',
                    '-movflags', '+faststart+frag_keyframe+empty_moov',
                    '-f', 'mp4',
                    outFile
                ]);
            }
            setBar('mkv-bar-rem', 100);
            setText('mkv-stats-rem', '✅ completado');

            const outData = await ff.readFile(outFile);
            try { await ff.deleteFile(inFile); } catch (e) { }
            try { await ff.deleteFile(outFile); } catch (e) { }
            const blob = new Blob([outData.buffer], { type: 'video/mp4' });
            const objectUrl = URL.createObjectURL(blob);
            m.dataset.objectUrl = objectUrl;

            // Reproducir, ocultar barras
            const v = document.getElementById('mkv-video');
            v.hidden = false;
            v.src = objectUrl;
            v.play().catch(() => { });
            const p = document.getElementById('mkv-progress'); if (p) p.style.display = 'none';
            setHint('▶ Reproduciendo. Si quieres descargar el original, cierra y usa "⬇ Descargar".');
        } catch (e) {
            setHint('❌ Error: ' + (e && e.message || e));
            console.error('[mkv]', e);
        }
    }

    window.MkvPlayer = { play };
})();
