// ========================================================
// Custom Image Popup (NO THUMBNAIL)
// ========================================================

window.CustomPopup = {
  open(src) {
    // สร้าง overlay
    const overlay = document.createElement("div");
    overlay.className = "custom-popup-overlay";

    overlay.innerHTML = `
      <div class="custom-popup-container">
        <img src="${src}" class="custom-popup-img" />
        <button class="custom-popup-close">✕</button>
      </div>
    `;

    // ปิด popup
    overlay.querySelector(".custom-popup-close").onclick = () => {
      overlay.remove();
    };

    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    document.body.appendChild(overlay);
  },
};
