/* =========================================================
   modalManager.js
   Global Modal/Popup ESC-close Controller for A4S-ERP
   ========================================================= */

(function () {
  // ── SELECTORS for all modal/popup patterns in the system ──
  // Priority: close the topmost (last matched) first
  const MODAL_SELECTORS = [
    // Pattern 0: .promo-modal-overlay.open (promotion modals)
    { selector: ".promo-modal-overlay.open", close: (el) => el.classList.remove("open") },
    // Pattern 1: .modal-overlay.open (standard modals)
    { selector: ".modal-overlay.open", close: (el) => el.classList.remove("open") },
    // Pattern 2: .pt-modal-overlay.show (place type manager)
    { selector: ".pt-modal-overlay.show", close: (el) => el.classList.remove("show") },
    // Pattern 3: [id*="Modal"]:not(.hidden) (booking room modals using hidden class)
    { selector: "#bookingModal:not(.hidden)", close: (el) => el.classList.add("hidden") },
    { selector: "#conflictModal:not(.hidden)", close: (el) => el.classList.add("hidden") },
    { selector: "#requestDetailModal:not(.hidden)", close: (el) => el.classList.add("hidden") },
    // Pattern 4: #popup:not(.hidden) (poster gallery popup)
    { selector: "#popup:not(.hidden)", close: (el) => el.classList.add("hidden") },
    // Pattern 5: panels with .open class
    { selector: ".ev-side-panel.open", close: (el) => {
      el.classList.remove("open");
      const overlay = document.getElementById("plPanelOverlay");
      if (overlay) overlay.style.display = "none";
    }},
    // Pattern 6: icon picker
    { selector: ".icon-picker-overlay.show", close: (el) => el.classList.remove("show") },
    // Pattern 7: imgPopup
    { selector: "#imgPopupOverlay.show, #imgPopupOverlay[style*='display: flex']", close: (el) => {
      if (typeof ImgPopup !== "undefined" && ImgPopup.close) ImgPopup.close();
      else el.style.display = "none";
    }},
    // Pattern 8: delete modal
    { selector: "#deleteModalOverlay.open, .del-modal-overlay.open", close: (el) => el.classList.remove("open") },
  ];

  /* ── ESC handler ── */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;

    // find first visible modal and close it
    for (const pattern of MODAL_SELECTORS) {
      const el = document.querySelector(pattern.selector);
      if (el) {
        e.preventDefault();
        e.stopPropagation();
        pattern.close(el);
        return;
      }
    }
  });

  /* ── Close all modals (utility) ── */
  function closeAllModals() {
    MODAL_SELECTORS.forEach((pattern) => {
      document.querySelectorAll(pattern.selector).forEach((el) => pattern.close(el));
    });
  }

  /* ── Click overlay to close ── */
  document.addEventListener("click", function (e) {
    // only close if clicking directly on the overlay background
    if (e.target.classList.contains("modal-overlay") && e.target.classList.contains("open")) {
      e.target.classList.remove("open");
    }
    if (e.target.classList.contains("pt-modal-overlay") && e.target.classList.contains("show")) {
      e.target.classList.remove("show");
    }
  });

  /* expose global */
  window.closeAllModals = closeAllModals;
})();
