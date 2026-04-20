/* ============================================================
   confirmModal.js — Promise-based custom confirm dialog
   Replace native confirm() with a styled modal

   Usage:
     const ok = await ConfirmModal.open({
       title: 'ยืนยัน',
       message: 'ส่งข้อความให้ 10 คน?',
       icon: '📱',           // optional emoji
       okText: 'ส่งเลย',
       cancelText: 'ยกเลิก',
       tone: 'primary',      // 'primary' | 'danger' | 'warning' | 'success'
       details: {            // optional — key-value grid (shown below message)
         'รหัสสมาชิก': '84968',
         'ชื่อ': 'นาย ปฐกพ มีโภคา',
       },
       note: '⚠️ การกระทำนี้ถาวร',  // optional — warning panel (HTML allowed)
       hideCancel: false,    // true → alert-mode (single OK button, no cancel)
     });
     if (!ok) return;
   ============================================================ */

window.ConfirmModal = (() => {
  let resolver = null;

  function ensureModal() {
    if (document.getElementById("cmOverlay")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="cmOverlay" class="cm-overlay">
        <div class="cm-modal">
          <div class="cm-icon-wrap" id="cmIconWrap"><span id="cmIcon">❓</span></div>
          <div class="cm-title" id="cmTitle">ยืนยัน</div>
          <div class="cm-body">
            <p id="cmMessage"></p>
            <div class="cm-details" id="cmDetails" style="display:none"></div>
            <div class="cm-note" id="cmNote" style="display:none"></div>
          </div>
          <div class="cm-footer">
            <button class="cm-btn cm-cancel" onclick="ConfirmModal.close(false)" id="cmCancelBtn">ยกเลิก</button>
            <button class="cm-btn cm-ok" onclick="ConfirmModal.close(true)" id="cmOkBtn">ตกลง</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
    injectCss();
  }

  function injectCss() {
    if (document.getElementById("cmStyle")) return;
    const s = document.createElement("style");
    s.id = "cmStyle";
    s.textContent = `
      .cm-overlay {
        position: fixed; inset: 0;
        background: rgba(15, 23, 42, 0.55);
        backdrop-filter: blur(6px);
        display: none; align-items: center; justify-content: center;
        z-index: 10000;
        opacity: 0; transition: opacity .2s;
      }
      .cm-overlay.open { display: flex; opacity: 1; }
      .cm-modal {
        background: #fff;
        width: 380px; max-width: 92vw;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0,0,0,.25);
        padding: 24px 22px 18px;
        text-align: center;
        transform: scale(.9) translateY(10px);
        transition: transform .2s ease;
      }
      .cm-overlay.open .cm-modal { transform: scale(1) translateY(0); }

      .cm-icon-wrap {
        width: 56px; height: 56px;
        border-radius: 50%;
        background: #eff6ff;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 14px;
        font-size: 28px;
      }
      .cm-icon-wrap.primary { background: #dbeafe; }
      .cm-icon-wrap.danger { background: #fee2e2; }
      .cm-icon-wrap.warning { background: #fef3c7; }
      .cm-icon-wrap.success { background: #dcfce7; }

      .cm-title {
        font-size: 17px;
        font-weight: 700;
        color: #0f172a;
        margin-bottom: 8px;
      }
      .cm-body {
        font-size: 13.5px;
        color: #475569;
        line-height: 1.6;
        margin-bottom: 18px;
        word-break: break-word;
      }
      .cm-body p { margin: 0; white-space: pre-line; text-align: center; }

      .cm-details {
        margin-top: 14px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px 14px;
        font-size: 12.5px;
        line-height: 1.7;
        font-family: 'IBM Plex Mono', monospace;
        text-align: left;
      }
      .cm-details .row {
        display: flex;
        justify-content: space-between;
        gap: 14px;
      }
      .cm-details .k {
        color: #64748b;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .3px;
      }
      .cm-details .v {
        color: #0f172a;
        font-weight: 600;
        text-align: right;
        word-break: break-all;
      }

      .cm-note {
        margin-top: 12px;
        padding: 10px 14px;
        background: #fef2f2;
        border-left: 3px solid #dc2626;
        border-radius: 6px;
        font-size: 12px;
        color: #7f1d1d;
        line-height: 1.6;
        text-align: left;
      }
      .cm-note.info { background: #eff6ff; border-left-color: #3b82f6; color: #1e40af; }
      .cm-note.warning { background: #fffbeb; border-left-color: #f59e0b; color: #92400e; }

      .cm-footer {
        display: flex;
        gap: 10px;
        justify-content: center;
      }
      .cm-btn {
        padding: 10px 20px;
        border: none;
        border-radius: 10px;
        font-family: inherit;
        font-size: 13.5px;
        font-weight: 700;
        cursor: pointer;
        min-width: 110px;
        transition: all .15s;
      }
      .cm-cancel {
        background: #f1f5f9;
        color: #475569;
      }
      .cm-cancel:hover { background: #e2e8f0; }

      .cm-ok { color: #fff; }
      .cm-ok.primary { background: linear-gradient(135deg, #1e40af, #3b82f6); }
      .cm-ok.primary:hover { filter: brightness(1.08); }
      .cm-ok.danger { background: linear-gradient(135deg, #b91c1c, #ef4444); }
      .cm-ok.warning { background: linear-gradient(135deg, #b45309, #f59e0b); }
      .cm-ok.success { background: linear-gradient(135deg, #065f46, #10b981); }

      @keyframes cmPop {
        0% { transform: scale(.7); opacity: 0; }
        60% { transform: scale(1.05); opacity: 1; }
        100% { transform: scale(1); }
      }
      .cm-overlay.open .cm-icon-wrap { animation: cmPop .35s ease; }
    `;
    document.head.appendChild(s);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") close(false);
    else if (e.key === "Enter") close(true);
  }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }

  function open(opts = {}) {
    ensureModal();
    const {
      title = "ยืนยัน",
      message = "คุณแน่ใจหรือไม่?",
      icon = "❓",
      okText = "ตกลง",
      cancelText = "ยกเลิก",
      tone = "primary",
      details = null,
      note = null,
      noteTone = "",       // "" (danger) | "info" | "warning"
      hideCancel = false,
    } = opts;

    document.getElementById("cmTitle").textContent = title;
    document.getElementById("cmMessage").textContent = message;
    document.getElementById("cmIcon").textContent = icon;
    document.getElementById("cmOkBtn").textContent = okText;
    document.getElementById("cmCancelBtn").textContent = cancelText;
    document.getElementById("cmCancelBtn").style.display = hideCancel ? "none" : "";

    const detailsEl = document.getElementById("cmDetails");
    if (details && Object.keys(details).length) {
      detailsEl.innerHTML = Object.entries(details)
        .map(([k, v]) => `<div class="row"><span class="k">${escHtml(k)}</span><span class="v">${escHtml(v)}</span></div>`)
        .join("");
      detailsEl.style.display = "block";
    } else {
      detailsEl.style.display = "none";
    }

    const noteEl = document.getElementById("cmNote");
    if (note) {
      noteEl.innerHTML = note;
      noteEl.className = "cm-note" + (noteTone ? " " + noteTone : "");
      noteEl.style.display = "block";
    } else {
      noteEl.style.display = "none";
    }

    const iconWrap = document.getElementById("cmIconWrap");
    iconWrap.className = "cm-icon-wrap " + tone;
    document.getElementById("cmOkBtn").className = "cm-btn cm-ok " + tone;

    document.getElementById("cmOverlay").classList.add("open");
    document.addEventListener("keydown", onKeyDown);

    return new Promise((resolve) => { resolver = resolve; });
  }

  function close(result) {
    document.getElementById("cmOverlay")?.classList.remove("open");
    document.removeEventListener("keydown", onKeyDown);
    if (resolver) { resolver(result); resolver = null; }
  }

  return { open, close };
})();
