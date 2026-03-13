/* ============================================================
   responsive.js — Mobile responsive helpers
   Include after sidebar.js in every page that has .side-panel
   ============================================================ */

(function () {
  const MOBILE_BP = 767;

  function ensureBackdrop() {
    if (!document.getElementById('panelBackdrop')) {
      const bd = document.createElement('div');
      bd.id = 'panelBackdrop';
      bd.className = 'panel-backdrop';
      bd.addEventListener('click', () => {
        const panel = document.querySelector('.side-panel');
        if (panel) panel.classList.remove('open');
        bd.classList.remove('show');
        document.body.style.overflow = '';
        // Let the page's own closePanel() handle selectedId
        if (typeof closePanel === 'function') closePanel();
      });
      document.body.appendChild(bd);
    }
    return document.getElementById('panelBackdrop');
  }

  function observePanel() {
    const panel = document.querySelector('.side-panel');
    if (!panel) return;
    const observer = new MutationObserver(() => {
      if (window.innerWidth > MOBILE_BP) return;
      const bd = ensureBackdrop();
      if (panel.classList.contains('open')) {
        bd.classList.add('show');
        document.body.style.overflow = 'hidden';
      } else {
        bd.classList.remove('show');
        document.body.style.overflow = '';
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  function injectFab() {
    if (document.querySelector('.fab')) return;
    if (typeof openModal !== 'function') return;
    const topbarBtn = document.querySelector('.btn-topbar.btn-white');
    if (!topbarBtn) return;
    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.setAttribute('aria-label', 'เพิ่มรายการ');
    fab.innerHTML = '＋';
    fab.addEventListener('click', () => openModal());
    document.body.appendChild(fab);
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth > MOBILE_BP) {
        const bd = document.getElementById('panelBackdrop');
        if (bd) bd.classList.remove('show');
        document.body.style.overflow = '';
      }
    }, 100);
  });

  window.addEventListener('DOMContentLoaded', () => {
    ensureBackdrop();
    observePanel();
    setTimeout(injectFab, 80);
  });
})();