window.DeleteModal = (() => {
  let callback = null;

  function ensureModal() {
    if (document.getElementById("deleteModalOverlay")) return;

    const div = document.createElement("div");

    div.innerHTML = `
<div id="deleteModalOverlay" class="dm-overlay">

  <div class="dm-modal">


    <div class="dm-body">
      <p id="dmMessage">Are you sure you want to delete this item?</p>
    </div>

    <div class="dm-footer">
    <button class="dm-btn danger" onclick="DeleteModal.confirm()">ยืนยัน</button>
      <button class="dm-btn cancel" onclick="DeleteModal.close()">ยกเลิก</button>
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

.dm-overlay{
position:fixed;
inset:0;
background:rgba(15,23,42,0.55);
backdrop-filter:blur(4px);
display:none;
align-items:center;
justify-content:center;
z-index:3000;
}

.dm-overlay.active{
display:flex;
}

/* modal */

.dm-modal{
width:420px;
max-width:90%;
background:#ffffff;
border-radius:36px;
padding:48px 40px 34px;
box-shadow:0 25px 60px rgba(0,0,0,0.25);
text-align:center;
font-family:sans-serif;
animation:dmPop .25s ease;
}

/* icon */

.dm-modal::before{
content:"🗑️";
display:flex;
align-items:center;
justify-content:center;
margin:0 auto 24px;
width:50px;
height:50px;
border-radius:15px;
background:#fde2e2;
font-size:30px;
}

/* title */

.dm-title{
font-size:30px;
font-weight:800;
color:#111827;
margin-bottom:12px;
}

/* message */

.dm-body{
font-size:16px;
color:#6b7280;
line-height:1.6;
margin-bottom:36px;
}

/* buttons */

.dm-footer{
display:flex;
flex-direction:column;
gap:14px;
}

.dm-btn{
width:100%;
padding:18px;
border-radius:30px;
border:none;
cursor:pointer;
font-size:17px;
font-weight:700;
}

/* confirm */

.dm-btn.danger{
background:#ef4444;
color:#fff;
box-shadow:0 10px 20px rgba(239,68,68,.35);
}

.dm-btn.danger:hover{
background:#dc2626;
}

/* cancel */

.dm-btn.cancel{
background:#f1f5f9;
color:#64748b;
font-weight:600;
}

.dm-btn.cancel:hover{
background:#e2e8f0;
}

/* animation */

@keyframes dmPop{
from{
transform:scale(.92);
opacity:0;
}
to{
transform:scale(1);
opacity:1;
}
}

`;

    document.head.appendChild(style);
  }

  function open(message, onConfirm) {
    ensureModal();

    callback = onConfirm;

    document.getElementById("dmMessage").textContent = message;

    document.getElementById("deleteModalOverlay").classList.add("active");
  }

  function close() {
    document.getElementById("deleteModalOverlay")?.classList.remove("active");
  }

  function confirm() {
    if (callback) callback();

    close();
  }

  return { open, close, confirm };
})();
