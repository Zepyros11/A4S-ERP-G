/* ============================================================
   loadingButton.js — Loading Button Utility
   ============================================================
   Usage:
     import { withLoading } from "../../js/components/ui/loadingButton.js";

     btn.addEventListener("click", () => {
       withLoading(btn, async () => {
         await saveData();
       });
     });

   Options:
     withLoading(btn, asyncFn, {
       text: "กำลังบันทึก...",   // loading text (default: "กำลังดำเนินการ...")
       successText: "สำเร็จ!",   // flash text on success (default: null = restore original)
       successMs: 1000,           // how long to show success text (default: 1000)
       disableForm: "#myForm",    // selector to disable all inputs in (default: null)
     });
============================================================ */

export async function withLoading(btn, asyncFn, opts = {}) {
  const {
    text = "กำลังดำเนินการ...",
    successText = null,
    successMs = 1000,
    disableForm = null,
  } = opts;

  const originalText = btn.innerHTML;
  const originalDisabled = btn.disabled;

  // disable
  btn.disabled = true;
  btn.innerHTML = `<span class="lb-spinner"></span> ${text}`;
  btn.classList.add("lb-loading");

  // disable form inputs if specified
  let formInputs = [];
  if (disableForm) {
    const form = typeof disableForm === "string"
      ? document.querySelector(disableForm)
      : disableForm;
    if (form) {
      formInputs = [...form.querySelectorAll("input,select,textarea,button")];
      formInputs.forEach((el) => { el._lbWasDisabled = el.disabled; el.disabled = true; });
    }
  }

  try {
    await asyncFn();

    // success flash
    if (successText) {
      btn.innerHTML = `✅ ${successText}`;
      btn.classList.remove("lb-loading");
      btn.classList.add("lb-success");
      await new Promise((r) => setTimeout(r, successMs));
      btn.classList.remove("lb-success");
    }
  } catch (err) {
    btn.classList.add("lb-error");
    btn.innerHTML = `❌ ผิดพลาด`;
    await new Promise((r) => setTimeout(r, 1500));
    btn.classList.remove("lb-error");
    throw err;
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = originalDisabled;
    btn.classList.remove("lb-loading");

    // restore form inputs
    formInputs.forEach((el) => { el.disabled = el._lbWasDisabled || false; delete el._lbWasDisabled; });
  }
}

/* ── inject CSS once ── */
if (!document.getElementById("lb-style")) {
  const style = document.createElement("style");
  style.id = "lb-style";
  style.textContent = `
    .lb-loading { opacity: 0.85; cursor: wait !important; }
    .lb-success { background: #22c55e !important; border-color: #22c55e !important; color: #fff !important; }
    .lb-error { background: #ef4444 !important; border-color: #ef4444 !important; color: #fff !important; }
    .lb-spinner {
      display: inline-block;
      width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: lb-spin 0.6s linear infinite;
      vertical-align: middle;
    }
    @keyframes lb-spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
}
