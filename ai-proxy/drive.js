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

/* ── Subfolder (nested, cache id) — จัดไฟล์เข้าโฟลเดอร์ย่อยใต้ FOLDER_ID ──
   รองรับ path หลายชั้น เช่น "event-files/posters" → สร้าง event-files แล้ว posters ใต้มัน */
const _subfolderCache = new Map();
async function _findOrCreateFolder(name, parentId) {
  const token = await _getAccessToken();
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents ` +
    `and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const sres = await fetch(
    `${API}/files?q=${encodeURIComponent(q)}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const sdata = await sres.json().catch(() => ({}));
  let id = sdata.files && sdata.files[0] && sdata.files[0].id;
  if (!id) {
    const cres = await fetch(`${API}/files?supportsAllDrives=true&fields=id`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    });
    const cdata = await cres.json().catch(() => ({}));
    if (!cres.ok || !cdata.id) throw new Error(`create subfolder ${name} ${cres.status}: ${JSON.stringify(cdata).slice(0, 200)}`);
    id = cdata.id;
  }
  return id;
}
async function ensureSubfolder(folderPath) {
  if (!folderPath) return FOLDER_ID;
  if (_subfolderCache.has(folderPath)) return _subfolderCache.get(folderPath);
  const parts = String(folderPath).split('/').filter(Boolean);
  let parentId = FOLDER_ID, cum = '';
  for (const part of parts) {
    cum = cum ? `${cum}/${part}` : part;
    if (_subfolderCache.has(cum)) { parentId = _subfolderCache.get(cum); continue; }
    parentId = await _findOrCreateFolder(part, parentId);
    _subfolderCache.set(cum, parentId);
  }
  return parentId;
}

/* ── Upload ไฟล์ (multipart) → คืน { id } ──
   name   = ชื่อไฟล์ที่แสดงใน Drive (เช่น "event-files/posters/55_....jpg")
   bucket = ชื่อโฟลเดอร์ย่อยปลายทาง (เช่น "product-images","event-files") — ไม่ใส่ = FOLDER_ID
   contentType = mime · body = Buffer */
async function uploadFile(name, contentType, body, bucket) {
  const token = await _getAccessToken();
  const parent = await ensureSubfolder(bucket);
  const boundary = 'a4s' + crypto.randomBytes(12).toString('hex');
  const metadata = JSON.stringify({ name, parents: [parent] });

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

/* ── ลบไฟล์ = ย้ายลงถังขยะ (trash) ──
   ใช้ trash แทน hard-delete เพราะ:
   - Content manager ทำได้ (hard-delete ถาวรต้อง Manager → เคยได้ 404)
   - กู้คืนได้ 30 วัน (safety) แล้ว Drive auto-purge คืนพื้นที่เอง */
async function deleteFile(id) {
  const token = await _getAccessToken();
  const res = await fetch(
    `${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    },
  );
  // 200 = trashed, 404 = ไม่มีอยู่แล้ว (idempotent)
  return { ok: res.ok || res.status === 404, status: res.status };
}

/* ── list ไฟล์ในโฟลเดอร์ (สำหรับ reorg) → [{id,name,parents}] · รองรับ paging ── */
async function listFolder(parentId) {
  const token = await _getAccessToken();
  const out = [];
  let pageToken = '';
  do {
    const q = `'${parentId}' in parents and trashed=false`;
    const url = `${API}/files?q=${encodeURIComponent(q)}&supportsAllDrives=true&includeItemsFromAllDrives=true`
      + `&fields=nextPageToken,files(id,name,mimeType,parents)&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`list ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    out.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

/* ── ย้ายไฟล์เข้า subfolder ตาม bucket (addParents/removeParents) ── */
async function moveFile(id, bucket, fromParent) {
  const token = await _getAccessToken();
  const target = await ensureSubfolder(bucket);
  if (target === fromParent) return { ok: true, status: 304 };
  const res = await fetch(
    `${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true&addParents=${target}`
    + `${fromParent ? `&removeParents=${fromParent}` : ''}&fields=id`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } },
  );
  return { ok: res.ok, status: res.status, target };
}

const ROOT_FOLDER_ID = FOLDER_ID;
module.exports = { isConfigured, uploadFile, getFile, deleteFile, ensureSubfolder, listFolder, moveFile, ROOT_FOLDER_ID };
