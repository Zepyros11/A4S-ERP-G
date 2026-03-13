/* =========================================================
   modalControl.js
   Global Modal Controller for A4S-ERP
   ========================================================= */

(function () {
  function closeAllModals() {
    document
      .querySelectorAll(".modal-overlay.open")
      .forEach((m) => m.classList.remove("open"));
  }

  /* ESC Close */

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      const modal = document.querySelector(".modal-overlay.open");

      if (modal) {
        modal.classList.remove("open");
      }
    }
  });

  /* Prevent background click close */

  document.querySelectorAll(".modal-overlay").forEach((modal) => {
    modal.addEventListener("click", function (e) {
      if (e.target === modal) {
        /* intentionally do nothing */
      }
    });
  });

  /* expose global */

  window.closeAllModals = closeAllModals;
})();
