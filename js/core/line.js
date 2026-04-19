/* ============================================================
   A4S-ERP — LINE Messaging API client abstraction
   --------------------------------------------------------------
   - Fetches line_channels from Supabase (line_channels table)
   - Decrypts Channel Access Token using ERPCrypto (master key)
   - Proxies Messaging API calls through ai-proxy (CORS workaround)

   localStorage keys used:
     sb_url / sb_key       — Supabase REST endpoint + anon key
     erp_master_key        — AES passphrase (via ERPCrypto)
     erp_proxy_url         — ai-proxy base URL (e.g. http://localhost:3001)

   Channel purposes:
     'event'        — attendee messaging (register + bulk push)
     'sync'         — internal sync notifications (groups)
     'announcement' — company-wide broadcasts
   ============================================================ */

(function () {
  const SB = () => ({
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  });

  function getProxyBase() {
    const v = (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
    return v;
  }

  async function _sbGet(path) {
    const { url, key } = SB();
    if (!url || !key) throw new Error("sb_url / sb_key ยังไม่ตั้งค่า");
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text().catch(() => "")}`);
    return res.json();
  }

  /* ── Channel cache (per-session, invalidate on explicit refresh) ── */
  let _channelCache = null;
  let _channelCacheAt = 0;
  const CACHE_TTL_MS = 60_000;

  async function _loadAllChannels(force = false) {
    const now = Date.now();
    if (!force && _channelCache && now - _channelCacheAt < CACHE_TTL_MS) {
      return _channelCache;
    }
    const rows = await _sbGet(
      "line_channels?select=*&is_active=eq.true&order=is_default.desc,id.asc",
    );
    _channelCache = rows || [];
    _channelCacheAt = now;
    return _channelCache;
  }

  function _clearCache() {
    _channelCache = null;
    _channelCacheAt = 0;
  }

  async function listChannels(opts = {}) {
    return _loadAllChannels(!!opts.force);
  }

  async function getChannel(id, opts = {}) {
    if (!id) return null;
    const all = await _loadAllChannels(!!opts.force);
    return all.find((c) => c.id === Number(id)) || null;
  }

  async function getDefaultChannel(purpose = "event", opts = {}) {
    const all = await _loadAllChannels(!!opts.force);
    return (
      all.find((c) => c.purpose === purpose && c.is_default) ||
      all.find((c) => c.purpose === purpose) ||
      null
    );
  }

  async function getChannelForEvent(event) {
    if (!event) return getDefaultChannel("event");
    if (event.line_channel_id) {
      const ch = await getChannel(event.line_channel_id);
      if (ch) return ch;
    }
    return getDefaultChannel("event");
  }

  /* ── Decrypt token (requires master key set) ── */
  async function _decryptToken(channel) {
    if (!channel || !channel.token_encrypted) throw new Error("channel token ว่าง");
    if (!window.ERPCrypto) throw new Error("ERPCrypto ไม่ได้โหลด");
    if (!window.ERPCrypto.hasMasterKey()) throw new Error("ยังไม่ได้ตั้ง master key");
    const tok = await window.ERPCrypto.decrypt(channel.token_encrypted);
    if (!tok) throw new Error("decrypt token ไม่สำเร็จ — master key ผิด?");
    return tok;
  }

  /* ── Proxy call: POST {base}/line/push ── */
  async function _callProxy(endpoint, payload) {
    const base = getProxyBase();
    if (!base) {
      throw new Error("ยังไม่ได้ตั้ง erp_proxy_url — ไปที่หน้า settings");
    }
    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || `proxy ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  /* ── Message builders ── */
  function textMessage(text) {
    return { type: "text", text: String(text).slice(0, 5000) };
  }

  function _toMessages(msgOrArr) {
    if (!msgOrArr) return [];
    const arr = Array.isArray(msgOrArr) ? msgOrArr : [msgOrArr];
    return arr.map((m) => (typeof m === "string" ? textMessage(m) : m));
  }

  /* ── Push to a single user ── */
  async function push({ channel, to, message, messages }) {
    if (!channel) throw new Error("ต้องระบุ channel");
    if (!to) throw new Error("ต้องระบุ to (userId)");
    const token = await _decryptToken(channel);
    const msgs = _toMessages(messages || message);
    if (!msgs.length) throw new Error("ข้อความว่าง");
    return _callProxy("/line/push", { token, to, messages: msgs });
  }

  /* ── Multicast: up to 500 userIds, same message ── */
  async function multicast({ channel, to, message, messages }) {
    if (!channel) throw new Error("ต้องระบุ channel");
    if (!Array.isArray(to) || !to.length) throw new Error("ต้องระบุ to (array of userIds)");
    if (to.length > 500) throw new Error("multicast รองรับ <= 500 คนต่อครั้ง");
    const token = await _decryptToken(channel);
    const msgs = _toMessages(messages || message);
    if (!msgs.length) throw new Error("ข้อความว่าง");
    return _callProxy("/line/multicast", { token, to, messages: msgs });
  }

  /* ── Broadcast to all friends of the OA ── */
  async function broadcast({ channel, message, messages }) {
    if (!channel) throw new Error("ต้องระบุ channel");
    const token = await _decryptToken(channel);
    const msgs = _toMessages(messages || message);
    if (!msgs.length) throw new Error("ข้อความว่าง");
    return _callProxy("/line/broadcast", { token, messages: msgs });
  }

  /* ── Send personalized messages to many users (wraps multicast + push) ──
     targets: [{ userId, message }]  — per-recipient customized text
     Groups same-message into multicast batches, sends unique ones via push
  */
  async function sendPersonalized({ channel, targets, onProgress }) {
    if (!channel) throw new Error("ต้องระบุ channel");
    if (!Array.isArray(targets) || !targets.length) throw new Error("ไม่มีเป้าหมาย");

    let ok = 0, fail = 0;
    const errors = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t.userId) { fail++; errors.push({ i, error: "no userId" }); continue; }
      try {
        await push({ channel, to: t.userId, message: t.message });
        ok++;
      } catch (e) {
        fail++;
        errors.push({ i, userId: t.userId, error: e.message });
      }
      if (onProgress) onProgress({ done: i + 1, total: targets.length, ok, fail });
    }
    return { ok, fail, errors };
  }

  /* ── LIFF helpers ── */
  function getLiffId(channel) {
    return channel?.liff_id || null;
  }

  /* ── Save / update channel (writes to Supabase) ── */
  async function saveChannel(channel, { plaintextToken } = {}) {
    const { url, key } = SB();
    if (!url || !key) throw new Error("sb_url / sb_key ยังไม่ตั้งค่า");
    const body = { ...channel };
    delete body.id;
    delete body.created_at;
    delete body.updated_at;

    if (plaintextToken) {
      if (!window.ERPCrypto?.hasMasterKey()) throw new Error("ยังไม่ได้ตั้ง master key");
      body.token_encrypted = await window.ERPCrypto.encrypt(plaintextToken);
    }

    let res;
    if (channel.id) {
      res = await fetch(`${url}/rest/v1/line_channels?id=eq.${channel.id}`, {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      });
    } else {
      res = await fetch(`${url}/rest/v1/line_channels`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      });
    }
    if (!res.ok) throw new Error(`save channel failed: ${await res.text()}`);
    _clearCache();
    const rows = await res.json();
    return rows?.[0] || null;
  }

  async function deleteChannel(id) {
    const { url, key } = SB();
    const res = await fetch(`${url}/rest/v1/line_channels?id=eq.${id}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`delete failed: ${await res.text()}`);
    _clearCache();
    return true;
  }

  async function setDefaultChannel(id, purpose) {
    const { url, key } = SB();
    // 1) unset existing default for this purpose
    await fetch(
      `${url}/rest/v1/line_channels?purpose=eq.${encodeURIComponent(purpose)}&is_default=eq.true`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_default: false }),
      },
    );
    // 2) set the new one
    const res = await fetch(`${url}/rest/v1/line_channels?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_default: true }),
    });
    if (!res.ok) throw new Error(`set default failed: ${await res.text()}`);
    _clearCache();
    return true;
  }

  /* ── Export ── */
  window.LineAPI = {
    // channel management
    listChannels,
    getChannel,
    getDefaultChannel,
    getChannelForEvent,
    saveChannel,
    deleteChannel,
    setDefaultChannel,
    clearCache: _clearCache,

    // messaging
    push,
    multicast,
    broadcast,
    sendPersonalized,

    // helpers
    textMessage,
    getLiffId,
    getProxyBase,
  };
})();
