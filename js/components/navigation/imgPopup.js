const ImgPopup = (() => {
  let images = [];
  let titles = [];
  let skus = [];
  let index = 0;
  const ZOOM_STEPS = [100, 150, 200, 250, 300];
  const DEFAULT_ZOOM = 150; // ระดับซูมเริ่มต้นเมื่อเปิดภาพ
  let zoom = DEFAULT_ZOOM;

  function ensureOverlay() {
    if (document.getElementById("imgPopupOverlay")) return;

    /* ---------- CSS ---------- */

    if (!document.getElementById("impCss")) {
      const style = document.createElement("style");
      style.id = "impCss";

      style.textContent = `

.imp-overlay{
position:fixed;
inset:0;
background:rgba(15,23,42,0.92);
backdrop-filter:blur(12px);
display:none;
flex-direction:column;
align-items:stretch;
z-index:2000;
font-family:"Sarabun",sans-serif;
}

.imp-overlay.active{
display:flex;
}

/* TOPBAR */

.imp-topbar{
display:flex;
align-items:center;
justify-content:space-between;
padding:14px 20px;
background:linear-gradient(to bottom,rgba(0,0,0,0.5),transparent);
position:relative;
z-index:30;
}

.imp-title{
color:#fff;
font-size:14px;
font-weight:600;
}

.imp-sku{
color:rgba(255,255,255,0.45);
font-size:12px;
font-family:"IBM Plex Mono",monospace;
margin-top:2px;
}

.imp-topbar-right{
display:flex;
align-items:center;
gap:6px;
}

.imp-icon-btn{
background:none;
border:none;
color:rgba(255,255,255,0.65);
width:40px;
height:40px;
border-radius:50%;
cursor:pointer;
font-size:16px;
display:flex;
align-items:center;
justify-content:center;
}

.imp-icon-btn:hover{
background:rgba(255,255,255,0.1);
color:#fff;
}

.imp-close-btn{
background:rgba(239,68,68,0.15);
border:none;
color:#f87171;
width:40px;
height:40px;
border-radius:50%;
cursor:pointer;
font-size:18px;
display:flex;
align-items:center;
justify-content:center;
}

.imp-close-btn:hover{
background:#ef4444;
color:#fff;
}

/* MAIN */

.imp-main{
flex:1;
display:flex;
overflow:auto;
padding:0 16px;
}

.imp-nav-btn{
position:fixed;
top:50%;
transform:translateY(-50%);
z-index:20;
background:rgba(255,255,255,0.08);
border:1px solid rgba(255,255,255,0.15);
color:#fff;
width:56px;
height:56px;
border-radius:16px;
font-size:28px;
cursor:pointer;
display:flex;
align-items:center;
justify-content:center;
}

.imp-nav-btn.left{left:16px;}
.imp-nav-btn.right{right:16px;}

.imp-nav-btn:hover{
background:rgba(255,255,255,0.12);
}

.imp-img-wrap{
position:relative;
margin:auto;
display:flex;
align-items:center;
justify-content:center;
}

#impZoomBtn{
width:auto;
min-width:40px;
padding:0 12px;
border-radius:20px;
font-size:13px;
font-weight:700;
gap:3px;
}

.imp-img-wrap img{
display:block;
border-radius:16px;
opacity:0;
transition:opacity .3s;
}

.imp-img-wrap img.loaded{
opacity:1;
}

/* BOTTOM */

.imp-bottom{
display:flex;
flex-direction:column;
align-items:center;
gap:14px;
padding:16px 20px 20px;
}

.imp-dots{
display:flex;
gap:9px;
align-items:center;
justify-content:center;
flex-wrap:wrap;
max-width:80vw;
}

.imp-dot{
width:9px;
height:9px;
border-radius:50%;
background:rgba(255,255,255,0.35);
cursor:pointer;
transition:background .15s, transform .15s;
}

.imp-dot:hover{
background:rgba(255,255,255,0.6);
}

.imp-dot.active{
background:#fff;
transform:scale(1.35);
}

.imp-thumbs{
display:none;
gap:8px;
padding:8px 14px;
background:rgba(0,0,0,0.45);
border-radius:14px;
backdrop-filter:blur(6px);
}

.imp-thumb{
position:relative;
width:52px;
height:70px;
border-radius:8px;
overflow:hidden;
border:2px solid transparent;
background:none;
cursor:pointer;
opacity:0.5;
transition:opacity 0.15s, border-color 0.15s, transform 0.15s;
flex-shrink:0;
padding:0;
}

.imp-thumb:hover{
opacity:0.8;
transform:translateY(-2px);
}

.imp-thumb.active{
opacity:1;
border-color:#fff;
transform:translateY(-3px);
}

.imp-thumb img{
width:100%;
height:100%;
object-fit:cover;
}

`;

      document.head.appendChild(style);
    }

    /* ---------- HTML ---------- */

    const div = document.createElement("div");

    div.innerHTML = `
<div id="imgPopupOverlay" class="imp-overlay" onclick="ImgPopup._bgClick(event)">

<div class="imp-topbar">

<div>
<div class="imp-title" id="impTitle"></div>
<div class="imp-sku" id="impSku"></div>
</div>

<div class="imp-topbar-right">
<button class="imp-icon-btn" onclick="ImgPopup._toggleZoom()" id="impZoomBtn">🔍</button>
<button class="imp-close-btn" onclick="ImgPopup.close()">✕</button>
</div>

</div>

<div class="imp-main">

<button class="imp-nav-btn left" onclick="ImgPopup.prev()">‹</button>

<div class="imp-img-wrap" id="impImgWrap">
<img id="impImage">
</div>

<button class="imp-nav-btn right" onclick="ImgPopup.next()">›</button>

</div>

<div class="imp-bottom">

<div class="imp-dots" id="impDots"></div>

<div class="imp-thumbs" id="impThumbs"></div>

</div>

</div>
`;

    document.body.appendChild(div.firstElementChild);
  }

  function open(imgList, startIndex = 0, opts = {}) {
    ensureOverlay();

    images = imgList;
    titles = opts.titles || [];
    skus = opts.skus || [];
    index = startIndex;

    render();
    _resetZoom();

    document.getElementById("imgPopupOverlay").classList.add("active");

    document.addEventListener("keydown", keyHandler);
  }

  function close() {
    document.getElementById("imgPopupOverlay")?.classList.remove("active");

    _resetZoom();

    document.removeEventListener("keydown", keyHandler);
  }

  function _bgClick(e) {
    if (e.target === document.getElementById("imgPopupOverlay")) close();
  }

  // วนระดับซูม 100 → 150 → 200 → 250 → 300 → 100
  function _toggleZoom() {
    const i = ZOOM_STEPS.indexOf(zoom);
    zoom = ZOOM_STEPS[(i + 1) % ZOOM_STEPS.length];
    _applyZoom();
  }

  function _applyZoom() {
    const img = document.getElementById("impImage");
    const btn = document.getElementById("impZoomBtn");
    if (img) {
      const baseH = Math.max(240, window.innerHeight - 130); // ขนาดพอดีจอที่ 100% (เผื่อ topbar + dots)
      if (zoom === 100) {
        // พอดีจอ — เติมเต็มพื้นที่ (ขยายภาพเล็กขึ้นได้ด้วย, คงสัดส่วนด้วย object-fit)
        img.style.maxWidth = "none";
        img.style.maxHeight = "none";
        img.style.width = "calc(100vw - 180px)";
        img.style.height = baseH + "px";
        img.style.objectFit = "contain";
      } else {
        // ขยายขนาดจริง → เลื่อน (scroll) ดูได้ใน .imp-main
        img.style.maxWidth = "none";
        img.style.maxHeight = "none";
        img.style.objectFit = "fill";
        img.style.height = Math.round(baseH * zoom / 100) + "px";
        img.style.width = "auto";
      }
    }
    if (btn) btn.textContent = zoom === 100 ? "🔍 100%" : `🔎 ${zoom}%`;
  }

  function _resetZoom() {
    zoom = DEFAULT_ZOOM;
    _applyZoom();
  }

  function keyHandler(e) {
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
    if (e.key === "Escape") close();
  }

  function next() {
    index = (index + 1) % images.length;
    _resetZoom();
    render();
  }

  function prev() {
    index = (index - 1 + images.length) % images.length;
    _resetZoom();
    render();
  }

  function go(i) {
    index = i;
    _resetZoom();
    render();
  }

  function render() {
    const img = document.getElementById("impImage");

    if (img) {
      img.src = images[index];

      img.classList.remove("loaded");

      img.onload = () => img.classList.add("loaded");
    }

    const titleEl = document.getElementById("impTitle");
    const skuEl = document.getElementById("impSku");

    if (titleEl) titleEl.textContent = titles[index] || "";
    if (skuEl) skuEl.textContent = skus[index] || "";

    const dotsEl = document.getElementById("impDots");

    if (dotsEl) {
      dotsEl.style.display = images.length > 1 ? "flex" : "none";
      dotsEl.innerHTML = images
        .map(
          (_, i) =>
            `<div class="imp-dot ${i === index ? "active" : ""}" onclick="ImgPopup.go(${i})"></div>`,
        )
        .join("");
    }

    const thumbsEl = document.getElementById("impThumbs");

    if (thumbsEl) {
      thumbsEl.innerHTML = images
        .map(
          (src, i) =>
            `<button class="imp-thumb ${i === index ? "active" : ""}" onclick="ImgPopup.go(${i})">
           <img src="${src}">
         </button>`,
        )
        .join("");
    }
  }

  return { open, close, next, prev, go, _bgClick, _toggleZoom };
})();
