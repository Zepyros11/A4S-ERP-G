/**
 * drive-backup-local.cjs — ดึงไฟล์ทั้งหมดจาก Shared Drive `A4S-ERP-Images` ลงเครื่อง
 * ────────────────────────────────────────────────────────────────────────────
 * ใช้เป็น (1) ตาข่ายนิรภัยก่อนย้าย  (2) ต้นทางให้ drive-upload-to-personal.cjs
 *
 *   node scripts/drive-backup-local.cjs [destDir]
 *   ค่าเริ่มต้น destDir = D:/@Projects/A4S-backups/drive-20260803
 *
 * - อ่าน env จาก ai-proxy/.env (GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY / GDRIVE_FOLDER_ID)
 * - idempotent: ไฟล์ที่มีแล้วและขนาดตรง จะข้าม (รันซ้ำได้ตลอด)
 * - เขียน manifest.json = โครงไฟล์ทั้งหมด + fileId เดิม (ใช้ทำ mapping ตอนย้าย)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_PATH = path.join(__dirname, '..', 'ai-proxy', '.env');
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const SA_EMAIL = process.env.GOOGLE_SA_EMAIL || '';
const SA_KEY = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '';
const API = 'https://www.googleapis.com/drive/v3';
const DEST = process.argv[2] || 'D:/@Projects/A4S-backups/drive-20260803';

const b64 = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let _tok = null;
async function token() {
  if (_tok && _tok.exp > Date.now() + 60000) return _tok.v;
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64(JSON.stringify({
    iss: SA_EMAIL, scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = b64(crypto.sign('RSA-SHA256', Buffer.from(`${h}.${c}`), SA_KEY));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${h}.${c}.${sig}` }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('token: ' + JSON.stringify(d).slice(0, 300));
  _tok = { v: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return _tok.v;
}

const safe = s => String(s).replace(/[<>:"|?*\\/]/g, '_').replace(/\.+$/, '');

(async () => {
  const t0 = Date.now();
  const auth = async () => ({ Authorization: `Bearer ${await token()}` });

  const root = await (await fetch(`${API}/files/${FOLDER_ID}?supportsAllDrives=true&fields=driveId`, { headers: await auth() })).json();
  const driveId = root.driveId;
  if (!driveId) throw new Error('GDRIVE_FOLDER_ID ไม่ได้อยู่ใน Shared Drive');

  // เดินทั้ง drive
  const folders = new Map(); const files = [];
  let pageToken = '';
  do {
    const url = `${API}/files?corpora=drive&driveId=${driveId}&includeItemsFromAllDrives=true&supportsAllDrives=true`
      + `&pageSize=1000&q=${encodeURIComponent('trashed=false')}`
      + `&fields=nextPageToken,files(id,name,size,mimeType,parents,md5Checksum,modifiedTime)`
      + (pageToken ? `&pageToken=${pageToken}` : '');
    const p = await (await fetch(url, { headers: await auth() })).json();
    if (p.error) throw new Error(JSON.stringify(p.error).slice(0, 300));
    for (const f of p.files || []) {
      if (f.mimeType === 'application/vnd.google-apps.folder') folders.set(f.id, f); else files.push(f);
    }
    pageToken = p.nextPageToken || '';
  } while (pageToken);

  const relPath = f => {
    const parts = []; let cur = folders.get((f.parents || [])[0]);
    while (cur) { parts.unshift(safe(cur.name)); cur = folders.get((cur.parents || [])[0]); }
    return parts.join('/');
  };

  console.log(`พบ ${files.length} ไฟล์ / ${folders.size} โฟลเดอร์ → ${DEST}`);
  fs.mkdirSync(DEST, { recursive: true });

  const manifest = [];
  let done = 0, skipped = 0, bytes = 0;
  const fail = [];

  const queue = files.slice();
  const worker = async () => {
    for (;;) {
      const f = queue.shift();
      if (!f) return;
      const dir = path.join(DEST, 'files', relPath(f));
      const dest = path.join(dir, safe(f.name));
      const size = Number(f.size || 0);
      manifest.push({ id: f.id, name: f.name, dir: relPath(f), size, md5: f.md5Checksum || null, mimeType: f.mimeType, modifiedTime: f.modifiedTime });

      if (fs.existsSync(dest) && fs.statSync(dest).size === size && size > 0) { skipped++; done++; continue; }

      // Google Docs/Sheets ฯลฯ ไม่มี byte stream — ข้าม (ระบบ ERP ไม่ได้ใช้)
      if (f.mimeType.startsWith('application/vnd.google-apps')) { skipped++; done++; continue; }

      try {
        const r = await fetch(`${API}/files/${f.id}?alt=media&supportsAllDrives=true`, { headers: await auth() });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(dest, buf);
        bytes += buf.length;
      } catch (e) {
        fail.push({ id: f.id, name: f.name, err: e.message });
      }
      done++;
      if (done % 25 === 0) process.stderr.write(`\r  ${done}/${files.length} …`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  process.stderr.write('\r');

  fs.writeFileSync(path.join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`เสร็จ: ดาวน์โหลด ${done - skipped - fail.length} · ข้าม(มีแล้ว) ${skipped} · พลาด ${fail.length}`
    + ` · ${(bytes / 1048576).toFixed(1)} MB · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (fail.length) { console.log('ไฟล์ที่พลาด:'); fail.forEach(f => console.log('  ', f.name, f.err)); process.exitCode = 1; }
  console.log('manifest:', path.join(DEST, 'manifest.json'));
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
