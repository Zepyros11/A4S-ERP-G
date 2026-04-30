/* ============================================================
   promptModal.js — Promise-based custom prompt dialog
   Replace native prompt() with a styled modal (1 input + OK/Cancel)

   Usage:
     const value = await PromptModal.open({
       title: 'เหตุผลที่ปฏิเสธ',
       message: 'โปรดระบุเหตุผลให้ลูกค้าทราบ',
       icon: '✗',
       okText: 'ยืนยัน',
       cancelText: 'ยกเลิก',
       tone: 'danger',          // 'primary' | 'danger' | 'warning' | 'success'
       inputType: 'text',       // 'text' | 'date' | 'number' | 'textarea'
       placeholder: 'กรอกเหตุผล...',
       defaultValue: '',
       required: true,          // if true, OK disabled when empty
       multiline: false,        // shortcut for inputType='textarea'
     });
     if (value === null) return;   // user cancelled
   ============================================================ */

window.PromptModal = (() => {
  let resolver = null;
  let cfg = {};

  function ensureModal() {
    if (document.getElementById("pmOverlay")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="pmOverlay" class="pm-overlay">
        <div class="pm-modal">
          <div class="pm-icon-wrap" id="pmIconWrap"><span id="pmIcon">✏️</span></div>
          <div class="pm-title" id="pmTitle">กรอกข้อมูล</div>
          <p class="pm-message" id="pmMessage"></p>
          <div class="pm-input-wrap" id="pmInputWrap"></div>
          <div class="pm-footer">
            <button class="pm-btn pm-cancel" onclick="PromptModal.close(null)" id="pmCancelBtn">ยกเลิก</button>
            <button class="pm-btn pm-ok" onclick="PromptModal._submit()" id="pmOkBtn">ตกลง</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
    injectCss();
  }

  function injectCss() {
    if (document.getElementById("pmStyle")) return;
    const s = document.createElement("style");
    s.id = "pmStyle";
    s.textContent = `
      .pm-overlay {
        position: fixed; inset: 0;
        background: rgba(15, 23, 42, 0.55);
        backdrop-filter: blur(6px);
        display: none; align-items: center; justify-content: center;
        z-index: 10001;
        opacity: 0; transition: opacity .2s;
      }
      .pm-overlay.open { display: flex; opacity: 1; }
      .pm-modal {
        background: #fff;
        width: 420px; max-width: 92vw;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0,0,0,.25);
        padding: 22px 22px 16px;
        text-align: center;
        transform: scale(.9) translateY(10px);
        transition: transform .2s ease;
      }
      .pm-overlay.open .pm-modal { transform: scale(1) translateY(0); }

      .pm-icon-wrap {
        width: 50px; height: 50px;
        border-radius: 50%;
        background: #eff6ff;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 12px;
        font-size: 24px;
      }
      .pm-icon-wrap.primary { background: #dbeafe; }
      .pm-icon-wrap.danger  { background: #fee2e2; }
      .pm-icon-wrap.warning { background: #fef3c7; }
      .pm-icon-wrap.success { background: #dcfce7; }

      .pm-title {
        font-size: 16px; font-weight: 700;
        color: #0f172a;
        margin-bottom: 6px;
      }
      .pm-message {
        font-size: 13px; color: #64748b;
        margin: 0 0 14px;
        line-height: 1.5;
      }
      .pm-input-wrap { margin-bottom: 16px; text-align: left; }
      .pm-input,
      .pm-textarea {
        width: 100%;
        padding: 10px 12px;
        border: 1.5px solid #e2e8f0;
        border-radius: 8px;
        font-family: inherit;
        font-size: 14px;
        color: #0f172a;
        background: #fff;
        outline: none;
        transition: border-color .15s, box-shadow .15s;
        box-sizing: border-box;
      }
      .pm-input:focus,
      .pm-textarea:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59,130,246,.12);
      }
      .pm-textarea { min-height: 90px; resize: vertical; font-family: inherit; }

      .pm-footer {
        display: flex;
        gap: 10px;
        justify-content: center;
      }
      .pm-btn {
        padding: 9px 18px;
        border: none;
        border-radius: 10px;
        font-family: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        min-width: 100px;
        transition: all .15s;
      }
      .pm-cancel { background: #f1f5f9; color: #475569; }
      .pm-cancel:hover { background: #e2e8f0; }

      .pm-ok { color: #fff; }
      .pm-ok.primary { background: linear-gradient(135deg, #1e40af, #3b82f6); }
      .pm-ok.danger  { background: linear-gradient(135deg, #b91c1c, #ef4444); }
      .pm-ok.warning { background: linear-gradient(135deg, #b45309, #f59e0b); }
      .pm-ok.success { background: linear-gradient(135deg, #065f46, #10b981); }
      .pm-ok:hover { filter: brightness(1.08); }
      .pm-ok:disabled { opacity: .5; cursor: not-allowed; }
    `;
    document.head.appendChild(s);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") close(null);
    else if (e.key === "Enter" && !cfg.multiline && cfg.inputType !== "textarea") {
      e.preventDefault();
      submit();
    }
  }

  function open(opts = {}) {
    ensureModal();
    cfg = {
      title: "กรอกข้อมูล",
      message: "",
      icon: "✏️",
      okText: "ตกลง",
      cancelText: "ยกเลิก",
      tone: "primary",
      inputType: "text",
      placeholder: "",
      defaultValue: "",
      required: false,
      multiline: false,
      ...opts,
    };
    if (cfg.multiline) cfg.inputType = "textarea";

    document.getElementById("pmTitle").textContent = cfg.title;
    document.getElementById("pmMessage").textContent = cfg.message;
    document.getElementById("pmIcon").textContent = cfg.icon;
    document.getElementById("pmOkBtn").textContent = cfg.okText;
    document.getElementById("pmCancelBtn").textContent = cfg.cancelText;
    document.getElementById("pmIconWrap").className = "pm-icon-wrap " + cfg.tone;
    document.getElementById("pmOkBtn").className = "pm-btn pm-ok " + cfg.tone;

    const wrap = document.getElementById("pmInputWrap");
    if (cfg.inputType === "textarea") {
      wrap.innerHTML = `<textarea class="pm-textarea" id="pmInput" placeholder="${escAttr(cfg.placeholder)}">${escHtml(cfg.defaultValue)}</textarea>`;
    } else {
      wrap.innerHTML = `<input type="${cfg.inputType}" class="pm-input" id="pmInput" value="${escAttr(cfg.defaultValue)}" placeholder="${escAttr(cfg.placeholder)}" />`;
    }

    const input = document.getElementById("pmInput");
    if (cfg.required) {
      const okBtn = document.getElementById("pmOkBtn");
      const sync = () => { okBtn.disabled = !input.value.trim(); };
      input.addEventListener("input", sync);
      sync();
    }

    document.getElementById("pmOverlay").classList.add("open");
    document.addEventListener("keydown", onKeyDown);
    setTimeout(() => input.focus(), 60);

    return new Promise((resolve) => { resolver = resolve; });
  }

  function submit() {
    const val = document.getElementById("pmInput")?.value ?? "";
    if (cfg.required && !val.trim()) return;
    close(val);
  }

  function close(result) {
    document.getElementById("pmOverlay")?.classList.remove("open");
    document.removeEventListener("keydown", onKeyDown);
    if (resolver) { resolver(result); resolver = null; }
  }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escAttr(s) { return escHtml(s); }

  return { open, close, _submit: submit };
})();
