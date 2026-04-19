/* ============================================================
   line-channels-ui.js — UI for managing LINE OA channels
   Requires: crypto.js (ERPCrypto), line.js (LineAPI)
   ============================================================ */

(function () {
  const PURPOSE_LABELS = {
    event: "event",
    sync: "sync",
    announcement: "announcement",
  };

  const PURPOSE_COLORS = {
    event: { bg: "#dbeafe", fg: "#1e40af" },
    sync: { bg: "#fef3c7", fg: "#92400e" },
    announcement: { bg: "#fce7f3", fg: "#9d174d" },
  };

  /* ══════════ Proxy URL / Master Key ══════════ */
  window.saveProxyUrl = function () {
    const v = (document.getElementById("proxyUrl").value || "").trim().replace(/\/+$/, "");
    if (!v) { showToast("กรอก URL ก่อน", "error"); return; }
    localStorage.setItem("erp_proxy_url", v);
    showToast("✅ บันทึกแล้ว — ลองทดสอบ", "success");
    testProxy();
  };

  window.testProxy = async function () {
    const base = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
    const el = document.getElementById("proxyStatus");
    if (!base) {
      el.className = "status-dot dot-disconnected";
      el.innerHTML = '<span class="dot-pulse"></span> ยังไม่ตั้ง URL';
      return;
    }
    el.className = "status-dot dot-disconnected";
    el.innerHTML = '<span class="dot-pulse"></span> กำลังทดสอบ...';
    try {
      const r = await fetch(base + "/");
      if (!r.ok) throw new Error("status " + r.status);
      const d = await r.json().catch(() => ({}));
      el.className = "status-dot dot-connected";
      el.innerHTML = `<span class="dot-pulse"></span> ${d.message || "ต่อได้"}`;
    } catch (e) {
      el.className = "status-dot dot-disconnected";
      el.innerHTML = `<span class="dot-pulse"></span> ต่อไม่ได้ (${e.message})`;
    }
  };

  window.toggleMasterKeyVisibility = function () {
    const el = document.getElementById("masterKey");
    el.type = el.type === "password" ? "text" : "password";
  };

  window.saveMasterKey = async function () {
    const v = (document.getElementById("masterKey").value || "").trim();
    if (v.length < 8) { showToast("Master key ต้องยาว ≥ 8 ตัวอักษร", "error"); return; }
    try {
      window.ERPCrypto.setMasterKey(v);
      const ok = await window.ERPCrypto.verifyMasterKey();
      if (!ok) throw new Error("verify failed");
      showToast("✅ ตั้ง master key แล้ว", "success");
      _updateMasterKeyStatus();
      document.getElementById("masterKey").value = "";
    } catch (e) {
      showToast("บันทึกไม่ได้: " + e.message, "error");
    }
  };

  window.clearMasterKey = function () {
    if (!confirm("ล้าง master key? ถ้ามี token encrypted อยู่จะ decrypt ไม่ได้")) return;
    window.ERPCrypto.clearMasterKey();
    _updateMasterKeyStatus();
    showToast("ล้าง master key แล้ว", "success");
  };

  function _updateMasterKeyStatus() {
    const el = document.getElementById("masterKeyStatus");
    if (window.ERPCrypto?.hasMasterKey()) {
      el.className = "status-dot dot-connected";
      el.innerHTML = '<span class="dot-pulse"></span> ตั้งแล้ว';
    } else {
      el.className = "status-dot dot-disconnected";
      el.innerHTML = '<span class="dot-pulse"></span> ยังไม่ตั้ง';
    }
  }

  /* ══════════ LINE Channels list ══════════ */
  async function _renderList() {
    const box = document.getElementById("lineChannelList");
    try {
      const channels = await window.LineAPI.listChannels({ force: true });
      if (!channels.length) {
        box.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text3)">
          <div style="font-size:28px;margin-bottom:8px">📡</div>
          <div style="font-size:13px">ยังไม่มี channel — กด "เพิ่ม Channel" เพื่อเริ่ม</div>
        </div>`;
        return;
      }
      box.innerHTML = channels.map(_renderRow).join("");
    } catch (e) {
      box.innerHTML = `<div style="color:var(--danger);padding:12px;font-size:13px">โหลดไม่ได้: ${e.message}</div>`;
    }
  }

  function _renderRow(c) {
    const col = PURPOSE_COLORS[c.purpose] || PURPOSE_COLORS.event;
    const defaultBadge = c.is_default
      ? `<span style="padding:2px 8px;border-radius:12px;background:#dcfce7;color:#15803d;font-size:10.5px;font-weight:700">DEFAULT</span>`
      : "";
    const inactiveBadge = !c.is_active
      ? `<span style="padding:2px 8px;border-radius:12px;background:#fee2e2;color:#991b1b;font-size:10.5px;font-weight:700">inactive</span>`
      : "";
    const liffBadge = c.liff_id
      ? `<span style="padding:2px 8px;border-radius:12px;background:#f0fdf4;color:#065f46;font-size:10.5px;font-weight:700">LIFF</span>`
      : "";
    return `<div class="lc-row" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:#fff">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:14px">${_esc(c.name)}</span>
          <span style="padding:2px 10px;border-radius:12px;background:${col.bg};color:${col.fg};font-size:11px;font-weight:700">${c.purpose}</span>
          ${defaultBadge}${inactiveBadge}${liffBadge}
        </div>
        <div style="font-size:11.5px;color:var(--text3);margin-top:4px;font-family:'IBM Plex Mono',monospace">
          ${c.channel_id ? `ch:${_esc(c.channel_id)} · ` : ""}${c.liff_id ? `liff:${_esc(c.liff_id)} · ` : ""}token:••••
        </div>
        ${c.note ? `<div style="font-size:11px;color:var(--text2);margin-top:4px">${_esc(c.note)}</div>` : ""}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${!c.is_default ? `<button class="btn btn-sm btn-outline" onclick="setLineChannelDefault(${c.id}, '${c.purpose}')" title="ตั้งเป็น default">⭐</button>` : ""}
        <button class="btn btn-sm btn-outline" onclick="editLineChannel(${c.id})" title="แก้ไข">✏️</button>
        <button class="btn btn-sm btn-sm-danger" onclick="deleteLineChannel(${c.id})" title="ลบ">🗑</button>
      </div>
    </div>`;
  }

  function _esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ══════════ Form modal ══════════ */
  window.openLineChannelForm = function () {
    if (!_preflightChecks()) return;
    _clearForm();
    document.getElementById("lineChannelModalTitle").textContent = "เพิ่ม LINE Channel";
    document.getElementById("lcTokenHint").textContent = "";
    document.getElementById("lineChannelModal").classList.add("open");
  };

  window.editLineChannel = async function (id) {
    if (!_preflightChecks()) return;
    const ch = await window.LineAPI.getChannel(id, { force: true });
    if (!ch) { showToast("ไม่พบ channel", "error"); return; }
    _clearForm();
    document.getElementById("lineChannelModalTitle").textContent = "แก้ไข " + ch.name;
    document.getElementById("lcId").value = ch.id;
    document.getElementById("lcName").value = ch.name || "";
    document.getElementById("lcPurpose").value = ch.purpose || "event";
    document.getElementById("lcChannelId").value = ch.channel_id || "";
    document.getElementById("lcLiffId").value = ch.liff_id || "";
    document.getElementById("lcLiffEndpoint").value = ch.liff_endpoint || "";
    document.getElementById("lcFriendUrl").value = ch.friend_url || "";
    document.getElementById("lcNote").value = ch.note || "";
    document.getElementById("lcIsDefault").checked = !!ch.is_default;
    document.getElementById("lcIsActive").checked = ch.is_active !== false;
    document.getElementById("lcTokenHint").textContent = ch.token_encrypted
      ? "🔒 token เก่าบันทึกไว้แล้ว — เว้นว่างถ้าไม่ต้องการเปลี่ยน"
      : "";
    document.getElementById("lineChannelModal").classList.add("open");
  };

  window.closeLineChannelForm = function () {
    document.getElementById("lineChannelModal").classList.remove("open");
  };

  window.toggleLcTokenVisibility = function () {
    const el = document.getElementById("lcToken");
    el.type = el.type === "password" ? "text" : "password";
  };

  function _clearForm() {
    ["lcId","lcName","lcToken","lcChannelId","lcLiffId","lcLiffEndpoint","lcFriendUrl","lcNote"]
      .forEach(id => document.getElementById(id).value = "");
    document.getElementById("lcPurpose").value = "event";
    document.getElementById("lcIsDefault").checked = false;
    document.getElementById("lcIsActive").checked = true;
  }

  function _preflightChecks() {
    if (!localStorage.getItem("sb_url")) { showToast("ยังไม่ได้เชื่อม Supabase", "error"); return false; }
    if (!window.ERPCrypto?.hasMasterKey()) { showToast("ตั้ง Master Key ก่อน", "error"); return false; }
    return true;
  }

  window.saveLineChannel = async function () {
    const id = document.getElementById("lcId").value;
    const name = document.getElementById("lcName").value.trim();
    const purpose = document.getElementById("lcPurpose").value;
    const token = document.getElementById("lcToken").value.trim();

    if (!name) { showToast("กรอกชื่อ channel", "error"); return; }
    if (!id && !token) { showToast("ต้องใส่ Channel Access Token", "error"); return; }

    const body = {
      name,
      purpose,
      channel_id: document.getElementById("lcChannelId").value.trim() || null,
      liff_id: document.getElementById("lcLiffId").value.trim() || null,
      liff_endpoint: document.getElementById("lcLiffEndpoint").value.trim() || null,
      friend_url: document.getElementById("lcFriendUrl").value.trim() || null,
      note: document.getElementById("lcNote").value.trim() || null,
      is_default: document.getElementById("lcIsDefault").checked,
      is_active: document.getElementById("lcIsActive").checked,
    };
    if (id) body.id = Number(id);

    try {
      const saved = await window.LineAPI.saveChannel(body, { plaintextToken: token || null });
      // If marked is_default, enforce uniqueness in the table
      if (saved && saved.is_default) {
        await window.LineAPI.setDefaultChannel(saved.id, saved.purpose);
      }
      showToast("✅ บันทึกแล้ว", "success");
      closeLineChannelForm();
      _renderList();
    } catch (e) {
      showToast("บันทึกไม่ได้: " + e.message, "error");
    }
  };

  window.deleteLineChannel = async function (id) {
    if (!confirm("ลบ channel นี้? การกระทำนี้ย้อนกลับไม่ได้")) return;
    try {
      await window.LineAPI.deleteChannel(id);
      showToast("ลบแล้ว", "success");
      _renderList();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
  };

  window.setLineChannelDefault = async function (id, purpose) {
    try {
      await window.LineAPI.setDefaultChannel(id, purpose);
      showToast("⭐ ตั้งเป็น default แล้ว", "success");
      _renderList();
    } catch (e) {
      showToast("ตั้งไม่ได้: " + e.message, "error");
    }
  };

  /* ══════════ Import from sync_config (LINE Notify in dev-tool) ══════════ */
  window.importFromSyncConfig = async function () {
    if (!_preflightChecks()) return;
    const url = localStorage.getItem("sb_url");
    const key = localStorage.getItem("sb_key");
    try {
      const r = await fetch(`${url}/rest/v1/sync_config?id=eq.1&select=line_token_encrypted,line_target_id,line_target_type&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      const rows = await r.json();
      const cfg = rows?.[0];
      if (!cfg?.line_token_encrypted) {
        showToast("ยังไม่มี LINE token ใน dev-tool settings", "error");
        return;
      }

      // Verify we can decrypt (correct master key)
      let token = "";
      try {
        token = await window.ERPCrypto.decrypt(cfg.line_token_encrypted);
        if (!token) throw new Error("decrypt returned empty");
      } catch (e) {
        showToast("Decrypt ไม่ได้ — master key ผิด?", "error");
        return;
      }

      // Pre-fill form
      _clearForm();
      document.getElementById("lineChannelModalTitle").textContent = "📥 Import จาก LINE Notify";
      document.getElementById("lcName").value = "Bot-Assistant (imported)";
      document.getElementById("lcPurpose").value = "sync";
      document.getElementById("lcToken").value = token;
      document.getElementById("lcNote").value = `Imported from sync_config · target=${cfg.line_target_type || "?"}${cfg.line_target_id ? ":" + cfg.line_target_id.slice(0, 8) + "…" : ""}`;
      document.getElementById("lcIsDefault").checked = true;
      document.getElementById("lcIsActive").checked = true;
      document.getElementById("lcTokenHint").style.color = "var(--success)";
      document.getElementById("lcTokenHint").textContent = "✅ decrypt สำเร็จ — ปรับชื่อ/purpose ตามต้องการ แล้วกดบันทึก";
      document.getElementById("lineChannelModal").classList.add("open");
    } catch (e) {
      showToast("อ่าน sync_config ไม่ได้: " + e.message, "error");
    }
  };

  /* ══════════ Token test ══════════ */
  window.testLineChannelToken = async function () {
    const base = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
    if (!base) { showToast("ตั้ง Proxy URL ก่อน", "error"); return; }
    const id = document.getElementById("lcId").value;
    const tokenInput = document.getElementById("lcToken").value.trim();
    const hintEl = document.getElementById("lcTokenHint");

    let token = tokenInput;
    if (!token && id) {
      // decrypt existing
      try {
        const ch = await window.LineAPI.getChannel(id);
        if (ch?.token_encrypted) {
          token = await window.ERPCrypto.decrypt(ch.token_encrypted);
        }
      } catch (e) {
        hintEl.style.color = "var(--danger)";
        hintEl.textContent = "decrypt ไม่ได้: " + e.message;
        return;
      }
    }
    if (!token) { hintEl.textContent = "ใส่ token ก่อน"; return; }

    hintEl.style.color = "var(--text3)";
    hintEl.textContent = "⏳ กำลังทดสอบ...";
    try {
      const r = await fetch(base + "/line/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "status " + r.status);
      hintEl.style.color = "var(--success)";
      hintEl.textContent = `✅ OK — ${d.displayName || "(no name)"} · userId=${d.basicId || "?"}`;
    } catch (e) {
      hintEl.style.color = "var(--danger)";
      hintEl.textContent = "❌ " + e.message;
    }
  };

  /* ══════════ Init ══════════ */
  window.addEventListener("DOMContentLoaded", () => {
    document.getElementById("proxyUrl").value = localStorage.getItem("erp_proxy_url") || "";
    _updateMasterKeyStatus();
    if (localStorage.getItem("erp_proxy_url")) window.testProxy();
    if (localStorage.getItem("sb_url") && localStorage.getItem("sb_key")) {
      _renderList();
    }
  });
})();
