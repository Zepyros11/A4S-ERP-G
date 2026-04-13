/* =========================================================
   floatingSave.js — Floating Save Button Component
   Auto-injects a floating 💾 button at bottom-right.

   Usage (in HTML):
   <script src="../../js/components/ui/floatingSave.js"
     data-save-fn="window.savePlace"
     data-label="💾">
   </script>

   Or call manually:
   FloatingSave.init({ saveFn: "window.savePlace" });
========================================================= */

(function () {
  // read config from script tag attributes
  const script = document.currentScript;
  const saveFnName = script?.getAttribute("data-save-fn") || null;
  const label = script?.getAttribute("data-label") || "💾";

  function init(opts = {}) {
    const fnName = opts.saveFn || saveFnName;
    if (!fnName) return;

    // don't create duplicate
    if (document.getElementById("floatingSaveBtn")) return;

    const btn = document.createElement("button");
    btn.id = "floatingSaveBtn";
    btn.className = "floating-save-btn";
    btn.title = "บันทึก";
    btn.textContent = opts.label || label;
    btn.addEventListener("click", () => {
      // resolve function from string like "window.savePlace"
      const parts = fnName.split(".");
      let fn = window;
      for (const p of parts) {
        if (p === "window") continue;
        fn = fn?.[p];
      }
      if (typeof fn === "function") fn();
    });

    document.body.appendChild(btn);
  }

  // auto-init if data-save-fn is set
  if (saveFnName) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init());
    } else {
      init();
    }
  }

  // expose for manual init
  window.FloatingSave = { init };
})();
