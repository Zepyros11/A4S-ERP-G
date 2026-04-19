/* =========================================================
   modalManager.js
   Global Modal/Popup ESC-close Controller for A4S-ERP

   Auto-handles ESC keypress on any element matching overlay
   class patterns. Also provides closeAllModals() utility.

   Generic rules cover *-overlay classes toggled with .open/.show.
   Special rules handle non-overlay modals (id + .hidden pattern,
   side panels, imgPopup, etc.).
   ========================================================= */

(function () {
  // ── SPECIAL patterns (non-overlay or non-standard) ──
  // These run BEFORE the generic rules; order defines priority
  // when multiple modals are open (last-opened should close first).
  const SPECIAL_PATTERNS = [
    // Booking/conflict/request modals using id + .hidden toggle
    { selector: "#bookingModal:not(.hidden)", close: (el) => el.classList.add("hidden") },
    { selector: "#conflictModal:not(.hidden)", close: (el) => el.classList.add("hidden") },
    { selector: "#requestDetailModal:not(.hidden)", close: (el) => el.classList.add("hidden") },
    // Poster gallery popup
    { selector: "#popup:not(.hidden)", close: (el) => el.classList.add("hidden") },
    // Event side panel (with backing overlay element)
    {
      selector: ".ev-side-panel.open",
      close: (el) => {
        el.classList.remove("open");
        const overlay = document.getElementById("plPanelOverlay");
        if (overlay) overlay.style.display = "none";
      },
    },
    // Image popup (inline style driven)
    {
      selector: "#imgPopupOverlay.show, #imgPopupOverlay[style*='display: flex']",
      close: (el) => {
        if (typeof ImgPopup !== "undefined" && ImgPopup.close) ImgPopup.close();
        else el.style.display = "none";
      },
    },
  ];

  // ── GENERIC patterns ──
  // Any element with a class ending in "-overlay" that is toggled
  // with .open or .show counts as a modal. Exclude loading spinners.
  const GENERIC_PATTERNS = [
    {
      selector: '[class*="-overlay"].open:not(.loading-overlay):not(.plPanelOverlay)',
      close: (el) => el.classList.remove("open"),
    },
    {
      selector: '[class*="-overlay"].show:not(.loading-overlay):not(.plPanelOverlay)',
      close: (el) => el.classList.remove("show"),
    },
  ];

  const ALL_PATTERNS = [...SPECIAL_PATTERNS, ...GENERIC_PATTERNS];

  /* ── ESC handler ── */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;

    // Ignore ESC when user is in an input and their IME might be composing,
    // or when focus is on something that expects ESC (shouldn't apply here)
    if (e.isComposing) return;

    // Collect all currently-open modals across all patterns
    const openEls = [];
    for (const pattern of ALL_PATTERNS) {
      document.querySelectorAll(pattern.selector).forEach((el) => {
        openEls.push({ el, close: pattern.close });
      });
    }
    if (!openEls.length) return;

    // Close the topmost visible modal — use highest z-index, fallback to last in DOM
    openEls.sort((a, b) => {
      const za = parseInt(getComputedStyle(a.el).zIndex, 10) || 0;
      const zb = parseInt(getComputedStyle(b.el).zIndex, 10) || 0;
      if (za !== zb) return zb - za;
      // fallback: later in DOM wins
      const pos = a.el.compareDocumentPosition(b.el);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
    });

    e.preventDefault();
    e.stopPropagation();
    openEls[0].close(openEls[0].el);
  });

  /* ── closeAllModals utility ── */
  function closeAllModals() {
    ALL_PATTERNS.forEach((pattern) => {
      document.querySelectorAll(pattern.selector).forEach((el) => pattern.close(el));
    });
  }

  /* ── Click overlay background to close (legacy behavior kept for compatibility) ── */
  document.addEventListener("click", function (e) {
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
