export function loadTopbar(title = "") {
  /* ---------------- CSS (inject ครั้งเดียว) ---------------- */

  if (!document.getElementById("topbar-style")) {
    const style = document.createElement("style");
    style.id = "topbar-style";

    style.textContent = `

.topbar{
  background:var(--accent);
  padding:0 32px;
  height:var(--topbar-h);
  display:flex;
  align-items:center;
  gap:16px;
  position:sticky;
  top:0;
  z-index:200;
  box-shadow:0 2px 8px rgba(0,0,0,0.15);
  flex-shrink:0;
}

.topbar-logo{
  font-size:15px;
  font-weight:700;
  color:#fff;
  display:flex;
  align-items:center;
  gap:6px;
}

.topbar-logo span{
  font-weight:800;
}

.topbar-sep{
  width:1px;
  height:20px;
  background:rgba(255,255,255,0.35);
}

.topbar-title{
  font-size:14px;
  color:#fff;
  font-weight:500;
}

`;

    document.head.appendChild(style);
  }

  /* ---------------- HTML ---------------- */

  const container = document.querySelector(".topbar");

  if (!container) return;

  const html = `
<div class="topbar">
  <div class="topbar-logo">📦 <span>A4S</span>-ERP</div>
  <div class="topbar-sep"></div>
  <div class="topbar-title">${title}</div>
</div>
`;

  container.outerHTML = html;
}
