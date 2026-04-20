/* ============================================================
   qr-designer.js — QR Code rendering helper (B&W locked)
   ------------------------------------------------------------
   Design fix: ขาว-ดำ + logo A4S กลาง
   จุดประสงค์: scan ได้ทุกอุปกรณ์ (notebook camera, scanner gun, มือถือ)
   API:
     renderQR(targetEl, payload) → { instance, download, ... }
   ============================================================ */

(function () {
  const QR_CDN = "https://cdn.jsdelivr.net/npm/qr-code-styling@1.6.0-rc.1/lib/qr-code-styling.js";

  function getBasePath() {
    return window.location.hostname.includes("github.io")
      ? "/" + window.location.pathname.split("/")[1]
      : "";
  }
  const LOGO_URL = () => `${getBasePath()}/assets/logo/logo-a4s.png`;

  /* ── Load CDN once ── */
  let _libPromise = null;
  function ensureLib() {
    if (window.QRCodeStyling) return Promise.resolve(window.QRCodeStyling);
    if (_libPromise) return _libPromise;
    _libPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = QR_CDN;
      s.async = true;
      s.onload = () => resolve(window.QRCodeStyling);
      s.onerror = () => reject(new Error("ไม่สามารถโหลด qr-code-styling lib"));
      document.head.appendChild(s);
    });
    return _libPromise;
  }

  /* ── Locked design: ขาว-ดำ + logo A4S ── */
  const NEON_CYBER_CONFIG = {
    width: 600,
    height: 600,
    margin: 16,
    qrOptions: { errorCorrectionLevel: "H" },
    dotsOptions: { type: "square", color: "#000000" },
    backgroundOptions: { color: "#ffffff" },
    cornersSquareOptions: { type: "square", color: "#000000" },
    cornersDotOptions: { type: "square", color: "#000000" },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: 0.28,
      margin: 10,
      crossOrigin: "anonymous",
    },
    useLogo: true,
  };

  function getConfig() {
    // deep clone so callers can't mutate the locked config
    return JSON.parse(JSON.stringify(NEON_CYBER_CONFIG));
  }

  /* ── Render ── */
  async function renderQR(targetEl, payload) {
    if (!targetEl) throw new Error("ต้องระบุ target element");
    const QRCodeStyling = await ensureLib();
    const cfg = getConfig();

    const options = {
      width: cfg.width,
      height: cfg.height,
      margin: cfg.margin,
      type: "canvas",
      data: String(payload || ""),
      qrOptions: cfg.qrOptions,
      dotsOptions: cfg.dotsOptions,
      backgroundOptions: cfg.backgroundOptions,
      cornersSquareOptions: cfg.cornersSquareOptions,
      cornersDotOptions: cfg.cornersDotOptions,
      imageOptions: cfg.imageOptions,
    };
    if (cfg.useLogo) options.image = LOGO_URL();

    targetEl.innerHTML = "";
    const instance = new QRCodeStyling(options);
    instance.append(targetEl);

    return {
      instance,
      download: (name = "qr", ext = "png") =>
        instance.download({ name, extension: ext }),
      updatePayload: (newPayload) =>
        instance.update({ data: String(newPayload || "") }),
    };
  }

  window.QRDesigner = {
    renderQR,
    getConfig,
    ensureLib,
    LOGO_URL,
    getBasePath,
  };
})();
