/**
 * drive.js — Google Drive storage backend (Shared Drive)
 * ────────────────────────────────────────────────────────────
 * ใช้แทน Supabase Storage เพื่อลดค่า egress/storage
 *
 * ต้องใช้ Google Workspace + Shared Drive:
 *   - service account เป็น "Content manager" ของ Shared Drive
 *   - ไฟล์ถูกเก็บใน Shared Drive (owner = องค์กร, โควต้าใช้พูล Workspace)
 *     ไม่ติดเพดาน 15GB และไม่มีปัญหา ownership แบบ personal Drive
 *
 * Env vars (Render):
 *   GOOGLE_SA_EMAIL        — service account email (xxx@yyy.iam.gserviceaccount.com)
 *   GOOGLE_SA_PRIVATE_KEY  — private key จาก JSON key (คง \n ไว้ ระบบจะ unescape ให้)
 *   GDRIVE_FOLDER_ID       — โฟลเดอร์ปลายทางใน Shared Drive (root ของรูป)
 *
 * ไม่มี dependency ใหม่ — ใช้ crypto (JWT RS256) + global fetch (Node 18+)
 */

const crypto = require('crypto');

const SA_EMAIL   = process.env.GOOGLE_SA_EMAIL || '';
// env เก็บ private key แบบ \n escaped → แปลงกลับเป็น newline จริง
const SA_KEY     = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const FOLDER_ID  = process.env.GDRIVE_FOLDER_ID || '';
const SCOPE      = 'https://www.googleapis.com/auth/drive';
const TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const API        = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

function isConfigured() {
  return !!(SA_EMAIL && SA_KEY && FOLDER_ID);
}

/* ── Access token (cache in-memory จนกว่าจะใกล้หมดอายุ) ── */
let _token = null;      // { value, expiresAt }

function _b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function _getAccessToken() {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;
  if (!isConfigured()) throw new Error('Drive not configured (missing SA_EMAIL/SA_KEY/FOLDER_ID)');

  const now = Math.floor(Date.now() / 1000);
  const header = _b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim  = _b64url(JSON.stringify({
    iss:   SA_EMAIL,
    scope: SCOPE,
    aud:   TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const signature = _b64url(
    crypto.sign('RSA-SHA256', Buffer.from(signingInput), SA_KEY)
  );
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Drive token error ${res.status}: ${data.error_description || data.error || 'unknown'}`);
  }
  _token = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return _token.value;
}

/* ── Upload ไฟล์ (multipart) → คืน { id } ──
   name = ชื่อไฟล์ที่จะแสดงใน Drive (เช่น "products/123_0_....jpg")
   contentType = mime (image/jpeg ฯลฯ)
   body = Buffer */
async function uploadFile(name, contentType, body) {
  const token = await _getAccessToken();
  const boundary = 'a4s' + crypto.randomBytes(12).toString('hex');
  const metadata = JSON.stringify({ name, parents: [FOLDER_ID] });

  const pre = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const multipart = Buffer.concat([pre, body, post]);

  const res = await fetch(
    `${UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=id`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(multipart.length),
      },
      body: multipart,
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`Drive upload ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { id: data.id };
}

/* ── ดึงไฟล์ (สำหรับ serve) → คืน { ok, status, contentType, buffer } ── */
async function getFile(id) {
  const token = await _getAccessToken();
  const res = await fetch(
    `${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { ok: true, status: 200, contentType, buffer };
}

/* ── ลบไฟล์ ── */
async function deleteFile(id) {
  const token = await _getAccessToken();
  const res = await fetch(
    `${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  // 204 = ลบสำเร็จ, 404 = ไม่มีอยู่แล้ว (ถือว่าสำเร็จเชิง idempotent)
  return { ok: res.ok || res.status === 404, status: res.status };
}

module.exports = { isConfigured, uploadFile, getFile, deleteFile };
