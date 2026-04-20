/* ============================================================
   qr-designer.js — QR Code rendering helper (Neon Cyber locked)
   ------------------------------------------------------------
   Design ของ QR ถูก fix เป็น "Neon Cyber" (พื้นดำ + dots นีออน
   cyan-magenta + logo A4S) ตามคำสั่งผู้ใช้
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

  /* ── Locked design: "Neon Cyber" ── */
  const NEON_CYBER_CONFIG = {
    width: 300,
    height: 300,
    margin: 10,
    qrOptions: { errorCorrectionLevel: "H" },
    dotsOptions: {
      type: "dots",
      color: "#06b6d4",
      gradient: {
        type: "linear",
        rotation: 45,
        colorStops: [
          { offset: 0, color: "#06b6d4" },
          { offset: 1, color: "#d946ef" },
        ],
      },
    },
    backgroundOptions: { color: "#0f172a" },
    cornersSquareOptions: { type: "extra-rounded", color: "#06b6d4" },
    cornersDotOptions: { type: "dot", color: "#d946ef" },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: 0.38,
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
