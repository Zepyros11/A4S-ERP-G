/**
 * drive-upload-to-personal.cjs — อัปไฟล์จาก backup เครื่อง → My Drive ของ a4scontent
 * ────────────────────────────────────────────────────────────────────────────
 * ขั้นที่ 2 ของการย้าย Drive (ขั้นที่ 1 = scripts/drive-backup-local.cjs)
 *
 *   node scripts/drive-upload-to-personal.cjs [srcDir]   # ย้ายจริง
 *   DRY_RUN=1 node scripts/drive-upload-to-personal.cjs  # ลองก่อน ไม่เขียนอะไร
 *
 * ต้องมี env (ai-proxy/.env หรือ set ก่อนรัน):
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN
 *   (ได้จาก scripts/drive-get-refresh-token.cjs)
 *
 * - สร้างโฟลเดอร์ `A4S-ERP-Images` ใน My Drive แล้ววางโครงโฟลเดอร์เดิมไว้ข้างใน
 *   ⚠️ ต้องให้สคริปต์สร้างโฟลเดอร์เอง — scope drive.file แตะโฟลเดอร์ที่สร้างมือใน UI ไม่ได้
 * - **fileId เปลี่ยน** (ก๊อปข้ามบัญชี = ไฟล์ใหม่) → เขียน id-map.json ไว้ทำ SQL ต่อ
 * - idempotent: ไฟล์ที่อัปแล้ว (มีใน id-map.json) จะข้าม → รันซ้ำต่อจากที่ค้างได้
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_PATH = path.join(__dirname, '..', 'ai-proxy', '.env');
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const REFRESH_TOKEN = process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '';
const SRC = process.argv[2] || 'D:/@Projects/A4S-backups/drive-20260803';
const DRY = process.env.DRY_RUN === '1';
const ROOT_NAME = 'A4S-ERP-Images';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const MAP_PATH = path.join(SRC, 'id-map.json');

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('ขาด GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN — รัน scripts/drive-get-refresh-token.cjs ก่อน');
  process.exit(1);
}

let _tok = null;
async function token() {
  if (_tok && _tok.exp > Date.now() + 60000) return _tok.v;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('refresh token ใช้ไม่ได้: ' + JSON.stringify(d).slice(0, 300));
  _tok = { v: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return _tok.v;
}
const auth = async () => ({ Authorization: `Bearer ${await token()}` });

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.json': 'application/json', '.csv': 'text/csv', '.ndjson': 'application/x-ndjson',
  '.zip': 'application/zip', '.gz': 'application/gzip', '.dump': 'application/octet-stream',
};

/* สร้าง (หรือหา) โฟลเดอร์ — จำเฉพาะที่สคริปต์นี้สร้างเอง เก็บใน folders.json กันสร้างซ้ำตอนรันรอบใหม่ */
const FOLDERS_PATH = path.join(SRC, 'folders.json');
const folderIds = fs.existsSync(FOLDERS_PATH) ? JSON.parse(fs.readFileSync(FOLDERS_PATH, 'utf8')) : {};
async function ensureFolder(relPath) {
  const key = relPath || '(root)';
  if (folderIds[key]) return folderIds[key];
  const parts = relPath ? relPath.split('/').filter(Boolean) : [];
  let parentId = 'root', cum = '';
  for (const part of [ROOT_NAME, ...parts]) {
    cum = cum ? `${cum}/${part}` : part;
    if (folderIds[cum]) { parentId = folderIds[cum]; continue; }
    if (DRY) { folderIds[cum] = `DRY-${cum}`; parentId = folderIds[cum]; continue; }
    const r = await fetch(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { ...(await auth()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: part, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    });
    const d = await r.json();
    if (!d.id) throw new Error(`สร้างโฟลเดอร์ ${cum} ไม่ได้: ${JSON.stringify(d).slice(0, 300)}`);
    folderIds[cum] = d.id;
    parentId = d.id;
    if (!DRY) fs.writeFileSync(FOLDERS_PATH, JSON.stringify(folderIds, null, 2));
  }
  // key ของ relPath จริง = โฟลเดอร์สุดท้าย
  folderIds[key] = parentId;
  // ⚠️ ห้ามเขียน cache ตอน DRY — id ปลอม `DRY-*` จะค้างแล้วรอบจริงหยิบไปใช้ → upload 404 ทุกไฟล์
  if (!DRY) fs.writeFileSync(FOLDERS_PATH, JSON.stringify(folderIds, null, 2));
  return parentId;
}

async function upload(name, mime, buf, parentId) {
  const boundary = 'a4s' + crypto.randomBytes(12).toString('hex');
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
    + `${JSON.stringify({ name, parents: [parentId] })}\r\n`
    + `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8');
  const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([pre, buf, post]);
  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { ...(await auth()), 'Content-Type': `multipart/related; boundary=${boundary}`, 'Content-Length': String(body.length) },
    body,
  });
  const d = await r.json();
  if (!d.id) throw new Error(`HTTP ${r.status} ${JSON.stringify(d).slice(0, 300)}`);
  return d.id;
}

(async () => {
  const t0 = Date.now();
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const map = fs.existsSync(MAP_PATH) ? JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')) : {};

  const who = await (await fetch(`${API}/about?fields=user,storageQuota`, { headers: await auth() })).json();
  console.log('อัปเข้าบัญชี:', who.user && who.user.emailAddress,
    `· เหลือ ${((Number(who.storageQuota.limit) - Number(who.storageQuota.usage)) / 1073741824).toFixed(1)} GB`);
  if (DRY) console.log('*** DRY_RUN — ไม่เขียนอะไรจริง ***');

  const todo = manifest.filter(f => !map[f.id] && !f.mimeType.startsWith('application/vnd.google-apps'));
  console.log(`ไฟล์ทั้งหมด ${manifest.length} · อัปแล้ว ${Object.keys(map).length} · ต้องอัป ${todo.length}`);

  let done = 0, bytes = 0;
  const fail = [];
  const save = () => fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));

  for (const f of todo) {
    const local = path.join(SRC, 'files', f.dir, f.name.replace(/[<>:"|?*\\/]/g, '_'));
    if (!fs.existsSync(local)) { fail.push({ name: f.name, err: 'ไม่มีไฟล์ในเครื่อง' }); continue; }
    try {
      const parentId = await ensureFolder(f.dir);
      const buf = fs.readFileSync(local);
      const mime = f.mimeType || MIME[path.extname(f.name).toLowerCase()] || 'application/octet-stream';
      map[f.id] = DRY ? `DRY-${f.id}` : await upload(f.name, mime, buf, parentId);
      bytes += buf.length;
      done++;
      if (!DRY && done % 20 === 0) { save(); process.stderr.write(`\r  ${done}/${todo.length} …`); }
    } catch (e) {
      fail.push({ name: f.name, err: e.message });
    }
  }
  if (!DRY) save();
  process.stderr.write('\r');

  console.log(`เสร็จ: อัป ${done} ไฟล์ · ${(bytes / 1048576).toFixed(1)} MB · ${((Date.now() - t0) / 1000).toFixed(0)}s · พลาด ${fail.length}`);
  if (fail.length) { fail.slice(0, 20).forEach(f => console.log('  ✗', f.name, '—', f.err)); process.exitCode = 1; }
  console.log('id-map:', MAP_PATH, `(${Object.keys(map).length} คู่)`);
  if (!DRY) {
    console.log('\n── ค่าที่ต้องเอาไปตั้งใน Render + ai-proxy/.env ──');
    // key ใน folders.json มี ROOT_NAME นำหน้าเสมอ (สร้างจาก [ROOT_NAME, ...parts])
    console.log('GDRIVE_FOLDER_ID=' + (folderIds[`${ROOT_NAME}/uploads`] || '(ไม่พบโฟลเดอร์ uploads)'));
    console.log('  (= โฟลเดอร์ A4S-ERP-Images/uploads ใน My Drive — root ที่ proxy ใช้อัปไฟล์ใหม่)');
    console.log('\nขั้นต่อไป: node scripts/drive-gen-id-rewrite-sql.cjs');
  }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
