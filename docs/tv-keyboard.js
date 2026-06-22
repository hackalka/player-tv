/* ===================================================================
 * Teclado virtual on-screen para TV-boxes.
 *
 * Se activa cuando el dispositivo NO tiene puntero fino (mando DPad)
 * y el usuario enfoca cualquier <input type="text|tel|number|search|...">.
 * Tiene navegacion DPad (flechas + OK), modo numerico para tel/number,
 * boton borrar, espacio, mayus y OK.
 * =================================================================== */
(function () {
    'use strict';

    // Detectar mando/TV: punto fino ausente (no hay raton ni dedo).
    // Tambien activamos si el UA dice 'TV', 'Box', 'AFTM' (Fire TV), etc.
    function isTV() {
        try {
            const ua = (navigator.userAgent || '').toLowerCase();
            if (/android tv|smart-tv|smarttv|googletv|hbbtv|netcast|webos|crkey|aft[a-z]|chromecast|tvplayer-app/i.test(ua)) return true;
            if (window.matchMedia && window.matchMedia('(pointer: none), (pointer: coarse) and (hover: none)').matches && /android/.test(ua) && !/mobile/.test(ua)) return true;
        } catch (e) { }
        return false;
    }
    // Permitir forzar/desactivar con ?tv=1 o ?tv=0
    const force = new URLSearchParams(location.search).get('tv');
    const tvMode = force === '1' || (force !== '0' && isTV());
    if (!tvMode) return; // en moviles/PC, NO mostrar teclado virtual

    document.documentElement.classList.add('tv-mode');

    const NUMERIC_LAYOUT = [
        ['1', '2', '3'],
        ['4', '5', '6'],
        ['7', '8', '9'],
        ['+', '0', '⌫']
    ];
    const QWERTY_LAYOUT_LOWER = [
        ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
        ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
        ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
        ['123', '@', '_', '-', '.', 'espacio', 'OK']
    ];
    const QWERTY_LAYOUT_UPPER = [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['⇧', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫'],
        ['123', '@', '_', '-', '.', 'espacio', 'OK']
    ];
    const NUMSYM_LAYOUT = [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        ['!', '"', '#', '$', '%', '&', '/', '(', ')', '='],
        ['?', '¿', '¡', '+', '*', ':', ';', ',', '.', '⌫'],
        ['ABC', '@', '_', '-', '/', 'espacio', 'OK']
    ];

    let target = null;       // input/textarea actual
    let layout = 'qwerty';   // 'numeric' | 'qwerty' | 'numsym'
    let upper = false;
    let kbEl = null;

    function build() {
        if (kbEl) return kbEl;
        kbEl = document.createElement('div');
        kbEl.id = 'tvkb';
        kbEl.hidden = true;
        kbEl.innerHTML = '<div class="tvkb-card"><div class="tvkb-preview" id="tvkb-preview"></div><div class="tvkb-rows" id="tvkb-rows"></div><div class="tvkb-foot">Mando: usa flechas + OK · Atrás cierra el teclado</div></div>';
        document.body.appendChild(kbEl);
        return kbEl;
    }

    function getLayout() {
        if (layout === 'numeric') return NUMERIC_LAYOUT;
        if (layout === 'numsym') return NUMSYM_LAYOUT;
        return upper ? QWERTY_LAYOUT_UPPER : QWERTY_LAYOUT_LOWER;
    }

    function render() {
        build();
        const rows = document.getElementById('tvkb-rows');
        const lay = getLayout();
        rows.innerHTML = lay.map((row, ri) =>
            '<div class="tvkb-row">' + row.map((k, ci) => {
                const wide = (k === 'espacio') ? 'wide' : (['⌫', 'OK', '⇧', '123', 'ABC'].includes(k) ? 'med' : '');
                return `<button class="tvkb-key ${wide}" data-key="${k.replace(/"/g, '&quot;')}" data-pos="${ri}-${ci}">${k === 'espacio' ? '␣ Espacio' : k}</button>`;
            }).join('') + '</div>'
        ).join('');
        // Conectar eventos
        Array.prototype.forEach.call(rows.querySelectorAll('.tvkb-key'), btn => {
            btn.addEventListener('click', () => press(btn.dataset.key));
        });
        updatePreview();
        // Foco al primero
        const first = rows.querySelector('.tvkb-key'); if (first) setTimeout(() => first.focus(), 30);
    }

    function updatePreview() {
        const p = document.getElementById('tvkb-preview');
        if (!p || !target) return;
        const v = target.value || '';
        p.textContent = v || '(escribe…)';
        p.dataset.empty = v ? '0' : '1';
    }

    function press(k) {
        if (!target) return;
        switch (k) {
            case '⌫': insert('', true); break;
            case '⇧': upper = !upper; render(); break;
            case '123': layout = 'numsym'; render(); break;
            case 'ABC': layout = 'qwerty'; render(); break;
            case 'espacio': insert(' '); break;
            case 'OK': close(true); break;
            default: insert(k); break;
        }
    }
    function insert(s, del) {
        const v = target.value || '';
        if (del) target.value = v.slice(0, -1);
        else target.value = v + s;
        try { target.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { }
        try { target.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { }
        updatePreview();
    }

    function open(input) {
        target = input;
        const t = (input.type || '').toLowerCase();
        const im = (input.inputMode || '').toLowerCase();
        layout = (t === 'tel' || t === 'number' || im === 'numeric' || im === 'tel') ? 'numeric' : 'qwerty';
        upper = false;
        render();
        kbEl.hidden = false;
        document.body.classList.add('tvkb-open');
    }
    function close(commit) {
        if (kbEl) kbEl.hidden = true;
        document.body.classList.remove('tvkb-open');
        if (commit && target) {
            try { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } catch (e) { }
        }
        target = null;
    }

    // Atajos: tecla atrás (ESC/back) cierra el teclado, no la app
    document.addEventListener('keydown', (e) => {
        if (kbEl && !kbEl.hidden) {
            if (e.key === 'Escape' || e.key === 'GoBack' || e.keyCode === 4) {
                e.preventDefault(); close(false);
            }
        }
    });

    // Abrir el teclado al enfocar un input/textarea
    document.addEventListener('focusin', (e) => {
        const el = e.target;
        if (!el || !el.tagName) return;
        const tag = el.tagName.toLowerCase();
        if ((tag === 'input' && /^(text|search|tel|number|email|password|url)$/.test((el.type || 'text').toLowerCase()))
            || tag === 'textarea') {
            open(el);
        }
    });
})();
