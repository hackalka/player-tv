(function () {
  'use strict';

  class PlayerTVNav {
    constructor() {
      this.focused = null;
      this.zoneIndex = 0;
      this.lastRowIndex = {};
      this.inputMode = false;
      this.injectStyles();
    }

    injectStyles() {
      if (document.getElementById('tv-nav-styles')) return;
      const s = document.createElement('style');
      s.id = 'tv-nav-styles';
      s.textContent = `
        .tv-focused {
          outline: 4px solid #f5c518 !important;
          transform: scale(1.05) !important;
          z-index: 9999 !important;
          box-shadow: 0 0 20px rgba(245, 197, 24, 0.6) !important;
          transition: all 0.2s ease !important;
          position: relative;
        }
        .tv-input-active {
          outline: 4px solid #22c55e !important;
          background: rgba(34, 197, 94, 0.1) !important;
        }
      `;
      document.head.appendChild(s);
    }

    init() {
      // Usamos tanto keydown como el evento específico de Android si fuera necesario
      window.addEventListener('keydown', (e) => this.onKey(e));
      
      // Asegurar que el DOM esté cargado
      if (document.readyState === 'complete') {
        setTimeout(() => this.focusFirst(), 1000);
      } else {
        window.addEventListener('load', () => setTimeout(() => this.focusFirst(), 1000));
      }

      const observer = new MutationObserver(() => {
          if (!this.focused || !this.visible(this.focused)) {
              this.focusFirst();
          }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    getZones() {
      let zones = [];
      
      // PRIORIDAD 1: Modales activos
      const modal = document.getElementById('modal');
      if (modal && (modal.classList.contains('active') || this.visible(modal))) {
          const modalBtns = [...modal.querySelectorAll('button, .f-btn, a, input')].filter(el => this.visible(el));
          if (modalBtns.length) return [{ key: 'modal', items: modalBtns }];
      }

      // PRIORIDAD 2: Player
      const playerLayer = document.getElementById('player-layer');
      if (playerLayer && (playerLayer.style.display === 'flex' || this.visible(playerLayer))) {
          const playerBtns = [...playerLayer.querySelectorAll('button, .f-btn')].filter(el => this.visible(el));
          if (playerBtns.length) return [{ key: 'player', items: playerBtns }];
      }

      // Zona: Buscador
      const search = document.getElementById('mainSearch');
      if (search && this.visible(search)) zones.push({ key: 'search', items: [search] });

      // Zona: Nav
      const navBtns = [...document.querySelectorAll('.nav .f-btn')].filter(el => this.visible(el));
      if (navBtns.length) zones.push({ key: 'nav', items: navBtns });

      // Zona: Contenido
      const cards = [...document.querySelectorAll('#content .movie-card, #content .item, .card')].filter(el => this.visible(el));
      if (cards.length) zones.push({ key: 'content', items: cards });

      return zones;
    }

    onKey(e) {
      const key = e.keyCode || e.which;
      
      // Si el input está activo, solo permitimos salir con Back o Enter
      if (this.inputMode && key !== 27 && key !== 13 && key !== 4) return;

      switch (key) {
        case 37: this.move('left'); e.preventDefault(); break;
        case 38: this.move('up'); e.preventDefault(); break;
        case 39: this.move('right'); e.preventDefault(); break;
        case 40: this.move('down'); e.preventDefault(); break;
        case 13: this.confirm(); e.preventDefault(); break;
        case 27: 
        case 4: 
        case 10009: // Código para Smart TVs Samsung/Tizen y algunos Android
          this.back(); 
          e.preventDefault(); 
          break;
      }
    }

    move(dir) {
      const zones = this.getZones();
      if (!zones.length) return;

      if (this.zoneIndex >= zones.length) this.zoneIndex = zones.length - 1;
      const zone = zones[this.zoneIndex];
      const currentIdx = zone.items.indexOf(this.focused);
      
      if (dir === 'left') {
        if (currentIdx > 0) this.setFocus(zone.items[currentIdx - 1]);
      } else if (dir === 'right') {
        if (currentIdx < zone.items.length - 1) this.setFocus(zone.items[currentIdx + 1]);
      } else if (dir === 'up') {
        if (this.zoneIndex > 0) {
          this.lastRowIndex[zone.key] = currentIdx;
          this.zoneIndex--;
          this.focusCurrentZone(zones);
        }
      } else if (dir === 'down') {
        if (this.zoneIndex < zones.length - 1) {
          this.lastRowIndex[zone.key] = currentIdx;
          this.zoneIndex++;
          this.focusCurrentZone(zones);
        }
      }
    }

    focusCurrentZone(zones) {
      const zone = zones[this.zoneIndex];
      const savedIdx = this.lastRowIndex[zone.key] || 0;
      const idx = Math.min(savedIdx, zone.items.length - 1);
      this.setFocus(zone.items[idx]);
    }

    setFocus(el) {
      if (!el) return;
      if (this.focused) this.focused.classList.remove('tv-focused');
      this.focused = el;
      el.classList.add('tv-focused');
      
      // Importante para TV Box: scroll suave
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }

    confirm() {
      if (!this.focused) return;
      if (this.focused.tagName === 'INPUT') {
          this.inputMode = true;
          this.focused.classList.add('tv-input-active');
          this.focused.focus();
      } else {
          this.focused.click();
      }
    }

    back() {
      if (this.inputMode) {
          this.inputMode = false;
          this.focused.classList.remove('tv-input-active');
          this.focused.blur();
          this.setFocus(this.focused);
      } else {
          // Intentar cerrar capas activas
          if (typeof cerrarReproductor === 'function') cerrarReproductor();
          if (typeof cerrarModal === 'function') cerrarModal();
          // Si no hay nada abierto, podrías simular un historial atrás
          // window.history.back();
      }
    }

    focusFirst() {
      const zones = this.getZones();
      if (zones.length > 0) {
          this.zoneIndex = 0;
          this.setFocus(zones[0].items[0]);
      }
    }

    visible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return (el.offsetWidth > 0 && el.offsetHeight > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
    }
  }

  // Inicialización segura
  const tvApp = new PlayerTVNav();
  tvApp.init();
  window.tvNav = tvApp;

})();
