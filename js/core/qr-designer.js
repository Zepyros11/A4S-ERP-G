/* ============================================================
   qr-designer.js — Shared QR Code rendering (lib: qr-code-styling)
   ------------------------------------------------------------
   Exposes window.QRDesigner with:
     renderQR(targetEl, payload, config, overrides?) → { instance, download }
     getDefaultConfig()   — fallback config (Classic preset)
     mergeConfig(baseCfg, userCfg)
     listPresets() → Promise<preset[]>
     getEventConfig(eventId) → Promise<config|null>
     saveEventConfig(eventId, config) → Promise
     getBasePath()        — figure out repo base for assets/logo/logo-a4s.png

   Depends on:
     qr-code-styling UMD loaded via CDN (see LOGO_PATH below)
     localStorage sb_url / sb_key
   ============================================================ */

(function () {
  const QR_CDN = "https://cdn.jsdelivr.net/npm/qr-code-styling@1.6.0-rc.1/lib/qr-code-styling.js";

  // Work out repo base path (same logic as sidebar.js)
  function getBasePath() {
    return window.location.hostname.includes("github.io")
      ? "/" + window.location.pathname.split("/")[1]
      : "";
  }

  const LOGO_URL = () => `${getBasePath()}/assets/logo/logo-a4s.png`;

  /* ── Load CDN once (idempotent) ── */
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

  /* ── Supabase helpers ── */
  const SB = () => ({
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  });

  async function sbGet(path) {
    const { url, key } = SB();
    if (!url || !key) throw new Error("ยังไม่ตั้งค่า Supabase");
    const r = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text().catch(() => "")}`);
    return r.json();
  }

  async function sbPatch(path, body) {
    const { url, key } = SB();
    const r = await fetch(`${url}/rest/v1/${path}`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text().catch(() => "")}`);
  }

  async function sbPost(path, body) {
    const { url, key } = SB();
    const r = await fetch(`${url}/rest/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text().catch(() => "")}`);
    return r.json();
  }

  async function sbDelete(path) {
    const { url, key } = SB();
    const r = await fetch(`${url}/rest/v1/${path}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`${r.status}: ${await r.text().catch(() => "")}`);
  }

  /* ── Config helpers ── */
  function getDefaultConfig() {
    return {
      width: 300,
      height: 300,
      margin: 10,
      qrOptions: { errorCorrectionLevel: "H" },
      dotsOptions: { type: "rounded", color: "#06c755" },
      backgroundOptions: { color: "#ffffff" },
      cornersSquareOptions: { type: "extra-rounded", color: "#065f46" },
      cornersDotOptions: { type: "dot", color: "#06c755" },
      imageOptions: {
        hideBackgroundDots: true,
        imageSize: 0.38,
        margin: 8,
        crossOrigin: "anonymous",
      },
      useLogo: true,
    };
  }

  function deepMerge(target, src) {
    if (!src) return target;
    const out = { ...target };
    for (const k of Object.keys(src)) {
      if (src[k] && typeof src[k] === "object" && !Array.isArray(src[k])) {
        out[k] = deepMerge(target?.[k] || {}, src[k]);
      } else {
        out[k] = src[k];
      }
    }
    return out;
  }

  function mergeConfig(baseCfg, userCfg) {
    return deepMerge(baseCfg || getDefaultConfig(), userCfg || {});
  }

  /* ── Render ── */
  async function renderQR(targetEl, payload, config, overrides = {}) {
    if (!targetEl) throw new Error("ต้องระบุ target element");
    const QRCodeStyling = await ensureLib();
    const finalCfg = mergeConfig(config, overrides);

    const options = {
      width: finalCfg.width || 300,
      height: finalCfg.height || 300,
      margin: finalCfg.margin ?? 10,
      type: finalCfg.type || "canvas",
      data: String(payload || ""),
      qrOptions: finalCfg.qrOptions || { errorCorrectionLevel: "H" },
      dotsOptions: finalCfg.dotsOptions,
      backgroundOptions: finalCfg.backgroundOptions,
      cornersSquareOptions: finalCfg.cornersSquareOptions,
      cornersDotOptions: finalCfg.cornersDotOptions,
      imageOptions: finalCfg.imageOptions,
    };
    if (finalCfg.useLogo) options.image = LOGO_URL();

    targetEl.innerHTML = "";
    const instance = new QRCodeStyling(options);
    instance.append(targetEl);

    return {
      instance,
      download: (name = "qr", ext = "png") =>
        instance.download({ name, extension: ext }),
      updatePayload: (newPayload) => instance.update({ data: String(newPayload || "") }),
      updateConfig: (newCfg) => {
        const merged = mergeConfig(newCfg, {});
        instance.update({
          width: merged.width,
          height: merged.height,
          margin: merged.margin,
          qrOptions: merged.qrOptions,
          dotsOptions: merged.dotsOptions,
          backgroundOptions: merged.backgroundOptions,
          cornersSquareOptions: merged.cornersSquareOptions,
          cornersDotOptions: merged.cornersDotOptions,
          imageOptions: merged.imageOptions,
          image: merged.useLogo ? LOGO_URL() : undefined,
        });
      },
    };
  }

  /* ── Presets CRUD ── */
  async function listPresets() {
    return sbGet("qr_style_presets?select=*&order=is_default.desc,is_system.desc,id.asc");
  }

  async function savePreset({ id, name, description, config, is_default }) {
    if (id) {
      await sbPatch(`qr_style_presets?id=eq.${id}`, { name, description, config, is_default });
      return id;
    }
    const rows = await sbPost("qr_style_presets", {
      name, description, config, is_default: !!is_default, is_system: false,
    });
    return rows?.[0]?.id;
  }

  async function deletePreset(id) {
    await sbDelete(`qr_style_presets?id=eq.${id}&is_system=eq.false`);
  }

  async function setDefaultPreset(id) {
    // unset all defaults → set this one
    await sbPatch(`qr_style_presets?is_default=eq.true`, { is_default: false });
    await sbPatch(`qr_style_presets?id=eq.${id}`, { is_default: true });
  }

  /* ── Event config ── */
  async function getEventConfig(eventId) {
    if (!eventId) return null;
    const rows = await sbGet(
      `events?event_id=eq.${encodeURIComponent(eventId)}&select=qr_style_config&limit=1`,
    );
    return rows?.[0]?.qr_style_config || null;
  }

  async function saveEventConfig(eventId, config) {
    if (!eventId) throw new Error("ต้องระบุ event_id");
    await sbPatch(`events?event_id=eq.${encodeURIComponent(eventId)}`, {
      qr_style_config: config,
    });
  }

  /* ── Get effective config for an event (event override → default preset → hard default) ── */
  async function getEffectiveConfig(eventId) {
    if (eventId) {
      try {
        const cfg = await getEventConfig(eventId);
        if (cfg) return cfg;
      } catch {}
    }
    try {
      const presets = await listPresets();
      const def = presets.find((p) => p.is_default) || presets[0];
      if (def) return def.config;
    } catch {}
    return getDefaultConfig();
  }

  window.QRDesigner = {
    renderQR,
    getDefaultConfig,
    mergeConfig,
    listPresets,
    savePreset,
    deletePreset,
    setDefaultPreset,
    getEventConfig,
    saveEventConfig,
    getEffectiveConfig,
    getBasePath,
    ensureLib,
    LOGO_URL,
  };
})();
