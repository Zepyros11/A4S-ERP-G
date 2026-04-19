/* ============================================================
   A4S-ERP — Client-side AES-GCM helper
   ใช้สำหรับ encrypt/decrypt field ที่ sensitive
   (รหัสผ่าน, เลขบัตรประชาชน, credentials ฯลฯ)

   Pattern:
     master key เก็บใน localStorage key "erp_master_key"
     (ผู้ใช้กรอกครั้งเดียวตอน setup — reference pattern เดียวกับ sb_url/sb_key)
   ============================================================ */

(function () {
  const LS_KEY = "erp_master_key";
  const SALT   = "A4S-ERP-salt-v1";                 // ค่าคงที่ — เปลี่ยนแล้วจะ decrypt ของเก่าไม่ได้
  const ITERS  = 100000;

  /* ── Derive AES key จาก passphrase ── */
  async function _deriveKey(passphrase) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode(SALT),
        iterations: ITERS,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  /* ── Cache key in-memory (derive ครั้งเดียวต่อ session) ── */
  let _cachedKey = null;
  let _cachedPassphrase = null;
  async function _getKey() {
    const passphrase = localStorage.getItem(LS_KEY);
    if (!passphrase) throw new Error("ยังไม่ได้ตั้ง master key — ไปที่หน้าตั้งค่า");
    if (passphrase !== _cachedPassphrase) {
      _cachedKey = await _deriveKey(passphrase);
      _cachedPassphrase = passphrase;
    }
    return _cachedKey;
  }

  /* ── Helpers: base64 ↔ Uint8Array ── */
  function _b64encode(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function _b64decode(str) {
    const s = atob(str);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  /* ── Encrypt: string → base64(iv|ciphertext) ── */
  async function encrypt(plaintext) {
    if (plaintext == null || plaintext === "") return null;
    const key = await _getKey();
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const ct  = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(String(plaintext))
    );
    /* รวม iv + ciphertext ใน buffer เดียว */
    const combined = new Uint8Array(iv.length + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), iv.length);
    return _b64encode(combined);
  }

  /* ── Decrypt: base64(iv|ciphertext) → string ── */
  async function decrypt(ciphertextB64) {
    if (!ciphertextB64) return null;
    const key = await _getKey();
    const combined = _b64decode(ciphertextB64);
    const iv = combined.slice(0, 12);
    const ct = combined.slice(12);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ct
    );
    return new TextDecoder().decode(pt);
  }

  /* ── Set / check master key ── */
  function setMasterKey(passphrase) {
    if (!passphrase || passphrase.length < 8)
      throw new Error("master key ต้องยาวอย่างน้อย 8 ตัวอักษร");
    localStorage.setItem(LS_KEY, passphrase);
    _cachedKey = null; _cachedPassphrase = null;
  }
  function hasMasterKey() {
    return !!localStorage.getItem(LS_KEY);
  }
  function clearMasterKey() {
    localStorage.removeItem(LS_KEY);
    _cachedKey = null; _cachedPassphrase = null;
  }

  /* ── Self-test: ลอง encrypt+decrypt "test" ── */
  async function verifyMasterKey() {
    try {
      const enc = await encrypt("test");
      const dec = await decrypt(enc);
      return dec === "test";
    } catch (e) {
      return false;
    }
  }

  /* ── SHA-256 hash (one-way, no master key needed) ── */
  async function hash(plaintext) {
    if (plaintext == null || plaintext === "") return null;
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(String(plaintext))
    );
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /* ── Export ── */
  window.ERPCrypto = {
    encrypt,
    decrypt,
    hash,
    setMasterKey,
    hasMasterKey,
    clearMasterKey,
    verifyMasterKey,
  };
})();
