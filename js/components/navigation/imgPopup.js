const ImgPopup = (() => {
  let images = [];
  let titles = [];
  let skus = [];
  let index = 0;

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
align-items:center;
justify-content:center;
gap:16px;
padding:0 16px;
}

.imp-nav-btn{
background:rgba(255,255,255,0.05);
border:1px solid rgba(255,255,255,0.1);
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

.imp-nav-btn:hover{
background:rgba(255,255,255,0.12);
}

.imp-img-wrap{
position:relative;
display:flex;
align-items:center;
justify-content:center;
max-width:calc(100% - 160px);
}

.imp-img-wrap.zoomed{
transform:scale(1.3);
}

.imp-img-wrap img{
max-width:100%;
max-height:calc(100vh - 210px);
object-fit:contain;
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
display:none;
}

.imp-thumbs{
display:flex;
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

    document.getElementById("imgPopupOverlay").classList.add("active");

    document.addEventListener("keydown", keyHandler);
  }

  function close() {
    document.getElementById("imgPopupOverlay")?.classList.remove("active");

    document.getElementById("impImgWrap")?.classList.remove("zoomed");

    document.removeEventListener("keydown", keyHandler);
  }

  function _bgClick(e) {
    if (e.target === document.getElementById("imgPopupOverlay")) close();
  }

  function _toggleZoom() {
    const wrap = document.getElementById("impImgWrap");
    const btn = document.getElementById("impZoomBtn");

    if (!wrap) return;

    wrap.classList.toggle("zoomed");

    btn.textContent = wrap.classList.contains("zoomed") ? "🔎" : "🔍";
  }

  function keyHandler(e) {
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
    if (e.key === "Escape") close();
  }

  function next() {
    index = (index + 1) % images.length;

    render();
  }

  function prev() {
    index = (index - 1 + images.length) % images.length;

    render();
  }

  function go(i) {
    index = i;

    document.getElementById("impImgWrap")?.classList.remove("zoomed");

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
