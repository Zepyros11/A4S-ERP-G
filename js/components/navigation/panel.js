// ============================================================
// A4S-ERP — Shared Side Panel Engine v4
// ไฟล์นี้คือ "โครงสร้างหลัก" (Skeleton) จัดการเรื่องความสวยงามและการเคลื่อนไหว
// ============================================================

class ERPPanelEngine {
  constructor() {
    this.isOpen = false;
    this.injectStyles();
    this.createSkeleton();
  }

  // 1. จัดการเรื่องความสวยงาม (CSS) — ความโค้งมน และ Animation
  injectStyles() {
    if (document.getElementById("erp-panel-engine-styles")) return;
    const style = document.createElement("style");
    style.id = "erp-panel-engine-styles";
    style.textContent = `
      :root {
        --panel-width: 480px;
        --panel-radius: 45px; /* ความโค้งมน (Mollness) */
        --panel-speed: 0.5s;
        --panel-easing: cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      /* Overlay Layer (พื้นหลังเบลอ) */
      #panel-overlay {
        position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4);
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        z-index: 9000; opacity: 0; visibility: hidden;
        transition: opacity 0.4s ease, visibility 0.4s ease;
      }
      #panel-overlay.active { opacity: 1; visibility: visible; }

      /* Panel Container (กล่องที่เลื่อนออกมา) */
      #panel-container {
        position: fixed; right: 0; top: 0; bottom: 0;
        width: var(--panel-width); max-width: 95%;
        background: #ffffff;
        box-shadow: -20px 0 60px rgba(0, 0, 0, 0.1);
        z-index: 9001;
        display: flex; flex-direction: column;
        transform: translateX(110%);
        transition: transform var(--panel-speed) var(--panel-easing);
        
        /* Mollness Design - มนด้านซ้าย */
        border-radius: var(--panel-radius) 0 0 var(--panel-radius);
        overflow: hidden;
        font-family: 'Sarabun', sans-serif;
      }
      #panel-overlay.active #panel-container { transform: translateX(0); }

      /* Header */
      .panel-header {
        height: 90px; padding: 0 35px;
        display: flex; align-items: center; justify-content: space-between;
        border-bottom: 1px solid #f1f5f9; background: #fff;
      }
      .panel-title-area h2 { margin: 0; font-size: 22px; font-weight: 800; color: #0f172a; }
      .panel-title-area p { margin: 4px 0 0 0; font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }

      .panel-close-btn {
        width: 45px; height: 45px; border-radius: 18px; border: none;
        background: #f8fafc; color: #94a3b8; cursor: pointer;
        display: flex; align-items: center; justify-content: center; transition: all 0.2s;
      }
      .panel-close-btn:hover { background: #fee2e2; color: #ef4444; transform: rotate(90deg); }

      /* Body */
      .panel-body { flex: 1; overflow-y: auto; padding: 35px; }
      .panel-body::-webkit-scrollbar { width: 4px; }
      .panel-body::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }

      /* Footer (Sticky) */
      .panel-footer {
        padding: 25px 35px; border-top: 1px solid #f1f5f9;
        background: #f8fafc; display: flex; gap: 12px;
      }
    `;
    document.head.appendChild(style);
  }

  // 2. สร้างโครงสร้าง HTML รอไว้ในหน้าเว็บ
  createSkeleton() {
    const overlay = document.createElement("div");
    overlay.id = "panel-overlay";
    overlay.innerHTML = `
      <div id="panel-container">
        <header class="panel-header">
          <div class="panel-title-area">
            <h2 id="p-engine-title">Title</h2>
            <p id="p-engine-subtitle">Subtitle</p>
          </div>
          <button class="panel-close-btn" onclick="Panel.close()">✕</button>
        </header>
        <div class="panel-body" id="p-engine-body"></div>
        <footer class="panel-footer" id="p-engine-footer"></footer>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target.id === "panel-overlay") this.close();
    });
  }

  /**
   * คำสั่งเปิด Panel
   * @param {Object} config { title, subtitle, content, footer }
   */
  open({ title = "", subtitle = "", content = "", footer = "" }) {
    document.getElementById("p-engine-title").innerText = title;
    document.getElementById("p-engine-subtitle").innerText = subtitle;

    const body = document.getElementById("p-engine-body");
    const foot = document.getElementById("p-engine-footer");

    if (typeof content === "string") body.innerHTML = content;
    else {
      body.innerHTML = "";
      body.appendChild(content);
    }

    if (footer) {
      foot.style.display = "flex";
      if (typeof footer === "string") foot.innerHTML = footer;
      else {
        foot.innerHTML = "";
        foot.appendChild(footer);
      }
    } else {
      foot.style.display = "none";
    }

    document.getElementById("panel-overlay").classList.add("active");
    this.isOpen = true;
  }

  close() {
    document.getElementById("panel-overlay").classList.remove("active");
    this.isOpen = false;
  }
}

export function openPanel(html) {
  Panel.open({
    title: "",
    content: html,
    footer: "",
  });
}

// ประกาศตัวแปร Global เพื่อให้ไฟล์อื่นๆ เรียกใช้ได้
window.Panel = new ERPPanelEngine();
