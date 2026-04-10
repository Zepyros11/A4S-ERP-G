window.DeleteModal = (() => {
  let callback = null;

  function ensureModal() {
    if (document.getElementById("deleteModalOverlay")) return;

    const div = document.createElement("div");

    div.innerHTML = `
<div id="deleteModalOverlay" class="dm-overlay">
  <div class="dm-modal">
    <div class="dm-icon-wrap">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>
    </div>
    <div class="dm-title">ยืนยันการลบ</div>
    <div class="dm-body">
      <p id="dmMessage">Are you sure you want to delete this item?</p>
    </div>
    <div class="dm-footer">
      <button class="dm-btn cancel" onclick="DeleteModal.close()">ยกเลิก</button>
      <button class="dm-btn danger" onclick="DeleteModal.confirm()">ลบรายการ</button>
    </div>
  </div>
</div>
`;

    document.body.appendChild(div.firstElementChild);

    injectCSS();
  }

  function injectCSS() {
    if (document.getElementById("deleteModalStyle")) return;

    const style = document.createElement("style");

    style.id = "deleteModalStyle";

    style.textContent = `
.dm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(6px);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}
.dm-overlay.active {
  display: flex;
}
.dm-modal {
  width: 380px;
  max-width: 92vw;
  background: #fff;
  border-radius: 16px;
  padding: 32px 28px 24px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.14), 0 1.5px 4px rgba(0,0,0,0.07);
  text-align: center;
  font-family: 'Sarabun', sans-serif;
  animation: dmPop 0.2s cubic-bezier(0.34,1.56,0.64,1);
}
.dm-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: #fef2f2;
  margin-bottom: 16px;
}
.dm-title {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 6px;
}
.dm-body {
  font-size: 14px;
  color: #6b7280;
  line-height: 1.6;
  margin-bottom: 24px;
}
.dm-body p { margin: 0; }
.dm-footer {
  display: flex;
  flex-direction: row;
  gap: 10px;
}
.dm-btn {
  flex: 1;
  padding: 10px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  font-family: 'Sarabun', sans-serif;
  transition: background 0.15s, box-shadow 0.15s;
}
.dm-btn.cancel {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #e2e8f0;
}
.dm-btn.cancel:hover {
  background: #e2e8f0;
}
.dm-btn.danger {
  background: #dc2626;
  color: #fff;
  box-shadow: 0 2px 8px rgba(220,38,38,0.25);
}
.dm-btn.danger:hover {
  background: #b91c1c;
  box-shadow: 0 4px 12px rgba(220,38,38,0.35);
}
@keyframes dmPop {
  from { transform: scale(0.94) translateY(8px); opacity: 0; }
  to   { transform: scale(1)    translateY(0);   opacity: 1; }
}
`;

    document.head.appendChild(style);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") close();
  }

  function open(message, onConfirm) {
    ensureModal();

    callback = onConfirm;

    document.getElementById("dmMessage").textContent = message;

    document.getElementById("deleteModalOverlay").classList.add("active");
    document.addEventListener("keydown", onKeyDown);
  }

  function close() {
    document.getElementById("deleteModalOverlay")?.classList.remove("active");
    document.removeEventListener("keydown", onKeyDown);
  }

  function confirm() {
    if (callback) callback();

    close();
  }

  return { open, close, confirm };
})();
