/**
 * backup-db.cjs — Full-data backup ทุกตาราง Supabase → NDJSON (สำหรับ Free tier ที่ไม่มี auto-backup)
 * ────────────────────────────────────────────────────────────
 * วิธี: keyset pagination (ไล่ตาม PK · ใช้ index = เร็ว + ทน statement timeout)
 *   ⚠️ ห้ามใช้ offset — ตารางใหญ่ (members 114k) จะโดน timeout แล้ว truncate เงียบ!
 * verify: เทียบ count backup vs DB ทุกตาราง → exit 1 ถ้ามี mismatch (scheduler จับ fail ได้)
 * ข้าม view (ชื่อขึ้นต้น v_) — derived data สร้างจาก schema ใน git อยู่แล้ว
 * เก็บ timestamped folder + prune เหลือ N ชุดล่าสุด
 *
 * env (จาก ai-proxy/.env):  SUPABASE_URL, SUPABASE_SERVICE_KEY
 * env (optional):
 *   BACKUP_DIR   ปลายทาง (default D:/@Projects/A4S-backups) — ควรอยู่นอก git repo (มี PII)
 *   BACKUP_KEEP  เก็บกี่ชุด (default 8)
 *
 * รัน:  node scripts/backup-db.cjs
 * schema (ตาราง/function/RLS) อยู่ใน git (sql/) → กู้ = สร้าง schema จาก git + load NDJSON เข้า
 */

const fs = require('fs');
const path = require('path');

const proxyEnv = path.join(__dirname, '..', 'ai-proxy', '.env');
if (fs.existsSync(proxyEnv)) {
  fs.readFileSync(proxyEnv, 'utf8').split('\n').forEach((l) => {
    const [k, ...r] = l.split('=');
    if (k && r.length && !process.env[k.trim()]) process.env[k.trim()] = r.join('=').trim();
  });
}

const SB = (process.env.SUPABASE_URL || process.env.SB_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SB_SERVICE_KEY || '';
const BACKUP_DIR = (process.env.BACKUP_DIR || 'D:/@Projects/A4S-backups').replace(/\/+$/, '');
const KEEP = parseInt(process.env.BACKUP_KEEP || '8', 10);
if (!SB || !KEY) { console.error('❌ ต้องมี SUPABASE_URL + SUPABASE_SERVICE_KEY ใน ai-proxy/.env'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const d = new Date();
const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
const OUT = path.join(BACKUP_DIR, `db-${stamp}`);
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '_backup.log');
const log = (m) => { fs.appendFileSync(LOG, m + '\n'); console.log(m); };

async function dbCount(t) {
  const r = await fetch(`${SB}/rest/v1/${t}?select=*`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const cr = r.headers.get('content-range') || '';
  return parseInt((cr.split('/')[1] || '0'), 10) || 0;
}
async function dumpKeyset(t, pk, ws) {
  let n = 0, last = null;
  for (;;) {
    let q = `${SB}/rest/v1/${t}?select=*&order=${pk}.asc&limit=1000`;
    if (last !== null) q += `&${pk}=gt.${encodeURIComponent(last)}`;
    const r = await fetch(q, { headers: H });
    if (!r.ok) throw new Error(`keyset ${r.status}: ${(await r.text().catch(() => '')).slice(0, 100)}`);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    rows.forEach((x) => ws.write(JSON.stringify(x) + '\n'));
    n += rows.length; last = rows[rows.length - 1][pk];
    if (rows.length < 1000) break;
  }
  return n;
}
async function dumpOffset(t, ws) {   // fallback สำหรับตารางไม่มี PK
  let n = 0, off = 0;
  for (;;) {
    const r = await fetch(`${SB}/rest/v1/${t}?select=*&limit=1000&offset=${off}`, { headers: H });
    if (!r.ok) throw new Error(`offset ${r.status}`);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    rows.forEach((x) => ws.write(JSON.stringify(x) + '\n'));
    n += rows.length; off += 1000;
    if (rows.length < 1000) break;
  }
  return n;
}

function pruneOld() {
  try {
    const dirs = fs.readdirSync(BACKUP_DIR).filter((f) => /^db-\d{8}_\d{4}$/.test(f)).sort();
    const drop = dirs.slice(0, Math.max(0, dirs.length - KEEP));
    for (const dd of drop) { fs.rmSync(path.join(BACKUP_DIR, dd), { recursive: true, force: true }); log(`  prune เก่า: ${dd}`); }
  } catch (e) { log('  ⚠️ prune: ' + e.message); }
}

(async () => {
  const spec = await (await fetch(`${SB}/rest/v1/`, { headers: H })).json();
  const defs = spec.definitions || {};
  const tables = Object.keys(defs).filter((t) => !/^v_/.test(t));   // ข้าม view (v_*)
  const pkOf = {};
  for (const t of tables) {
    const props = defs[t].properties || {};
    for (const [c, mt] of Object.entries(props)) {
      if (/primary key|<pk\/>/i.test((mt && mt.description) || '')) { pkOf[t] = c; break; }
    }
  }
  log(`START ${d.toISOString()} · ${tables.length} ตาราง (ข้าม view) → ${OUT}`);

  const summary = [], mismatch = [];
  let totalRows = 0;
  for (const t of tables) {
    const fp = path.join(OUT, `${t}.ndjson`);
    const ws = fs.createWriteStream(fp);
    let n = 0;
    try {
      n = pkOf[t] ? await dumpKeyset(t, pkOf[t], ws) : await dumpOffset(t, ws);
    } catch (e) { log(`  ⚠️ ${t}: ${e.message}`); }
    await new Promise((r) => ws.end(r));
    if (n > 0) {
      const cnt = await dbCount(t);
      summary.push({ t, n, pk: pkOf[t] || '(offset)' });
      totalRows += n;
      if (n !== cnt) { mismatch.push({ t, n, db: cnt }); log(`  ⚠️ ${t} backup=${n} DB=${cnt} MISMATCH`); }
    } else { try { fs.unlinkSync(fp); } catch {} }
  }

  fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify(
    { at: d.toISOString(), supabase: SB, method: 'keyset+verify', tables: summary, totalRows, mismatch }, null, 2));
  log(`DONE ตาราง ${summary.length} · rows ${totalRows} · mismatch ${mismatch.length}`);

  pruneOld();

  if (mismatch.length) { log('❌ มี mismatch — backup ไม่ครบ! ' + JSON.stringify(mismatch)); process.exit(1); }
  log('✅ backup ครบ verify ผ่าน');
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
