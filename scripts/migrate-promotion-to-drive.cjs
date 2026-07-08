/**
 * migrate-promotion-to-drive.cjs — ย้ายรูป bucket "promotion-files" → Google Drive
 * ────────────────────────────────────────────────────────────
 * table promotions.poster_url (full public URL) → download → upload Drive → rewrite
 * โครงเดียวกับ migrate-tour-seat/event-files (recursive collect/remap · PK จาก OpenAPI)
 *
 * ปลอดภัย/idempotent: URL ที่ย้ายแล้ว (/drive/file/) ไม่มี "/promotion-files/" → ข้าม · DRY_RUN=1 preview
 *   ของเก่าใน Supabase ไม่ถูกลบ (rollback ได้)
 *
 * รัน:  DRY_RUN=1 node scripts/migrate-promotion-to-drive.cjs   |   node scripts/migrate-promotion-to-drive.cjs
 */

const fs = require('fs');
const path = require('path');
const proxyEnv = path.join(__dirname, '..', 'ai-proxy', '.env');
if (fs.existsSync(proxyEnv)) {
  fs.readFileSync(proxyEnv, 'utf8').split('\n').forEach((line) => {
    const [k, ...rest] = line.split('=');
    if (k && rest.length && !process.env[k.trim()]) process.env[k.trim()] = rest.join('=').trim();
  });
}
const drive = require('../ai-proxy/drive');

const SB_URL = (process.env.SUPABASE_URL || process.env.SB_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SB_SERVICE_KEY || '';
const PROXY = (process.env.PUBLIC_PROXY_URL || '').replace(/\/+$/, '');
const DRY_RUN = process.env.DRY_RUN === '1';

const BUCKET = 'promotion-files';
const MARKER = `/storage/v1/object/public/${BUCKET}/`;
const TARGETS = [{ table: 'promotions', cols: ['poster_url'] }];
const PK_FALLBACK = { promotions: 'promotion_id' };

function assertEnv() {
  const miss = [];
  if (!SB_URL) miss.push('SUPABASE_URL');
  if (!SB_KEY) miss.push('SUPABASE_SERVICE_KEY');
  if (!PROXY) miss.push('PUBLIC_PROXY_URL');
  if (!drive.isConfigured()) miss.push('GOOGLE_SA_* / GDRIVE_FOLDER_ID');
  if (miss.length) { console.error('❌ env ไม่ครบ:', miss.join(', ')); process.exit(1); }
}
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

async function sbGetAll(table, select) {
  const rows = [];
  const LIMIT = 1000;
  for (let offset = 0; ; offset += LIMIT) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?select=${select}&limit=${LIMIT}&offset=${offset}`, { headers: H });
    if (!res.ok) throw new Error(`GET ${table} ${res.status}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < LIMIT) break;
  }
  return rows;
}
async function sbPatch(table, pkCol, pkVal, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${pkCol}=eq.${encodeURIComponent(pkVal)}`, {
    method: 'PATCH',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${table} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
}
async function loadSchema() {
  const pk = {}, realCols = {};
  try {
    const spec = await (await fetch(`${SB_URL}/rest/v1/`, { headers: H })).json();
    const defs = spec.definitions || {};
    for (const { table } of TARGETS) {
      const props = (defs[table] && defs[table].properties) || {};
      realCols[table] = new Set(Object.keys(props));
      for (const [col, meta] of Object.entries(props)) {
        if (/primary key|<pk\/>/i.test((meta && meta.description) || '')) { pk[table] = col; break; }
      }
      if (!pk[table]) pk[table] = PK_FALLBACK[table];
    }
  } catch (e) {
    console.warn('⚠️ OpenAPI อ่านไม่ได้ ใช้ fallback PK:', e.message);
    for (const { table } of TARGETS) { pk[table] = PK_FALLBACK[table]; realCols[table] = null; }
  }
  return { pk, realCols };
}
function collect(val, set) {
  if (typeof val === 'string') { if (val.includes(MARKER)) set.add(val); }
  else if (Array.isArray(val)) val.forEach((v) => collect(v, set));
  else if (val && typeof val === 'object') Object.values(val).forEach((v) => collect(v, set));
}
function remap(val, map) {
  if (typeof val === 'string') return map[val] || val;
  if (Array.isArray(val)) return val.map((v) => remap(v, map));
  if (val && typeof val === 'object') { const o = {}; for (const k of Object.keys(val)) o[k] = remap(val[k], map); return o; }
  return val;
}
function hasMarker(val) {
  if (typeof val === 'string') return val.includes(MARKER);
  if (Array.isArray(val)) return val.some(hasMarker);
  if (val && typeof val === 'object') return Object.values(val).some(hasMarker);
  return false;
}
function driveNameFromUrl(u) {
  const i = u.indexOf(MARKER);
  const rel = i >= 0 ? u.slice(i + MARKER.length) : u.split('/').pop();
  return `${BUCKET}/${decodeURIComponent(rel.split('?')[0])}`;
}

async function main() {
  assertEnv();
  console.log(`\n🚀 Migrate ${BUCKET} → Drive  ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}\n`);
  const { pk, realCols } = await loadSchema();
  const effTargets = [];
  for (const t of TARGETS) {
    const real = realCols[t.table];
    const cols = real ? t.cols.filter((c) => real.has(c)) : t.cols;
    if (!cols.length) { console.log(`   ${t.table} → ไม่มีคอลัมน์ที่ใช้ได้ ข้าม`); continue; }
    console.log(`   ${t.table} [pk=${pk[t.table]}] → ${cols.join(', ')}`);
    effTargets.push({ table: t.table, cols });
  }

  const urlSet = new Set();
  const tableRows = {};
  for (const { table, cols } of effTargets) {
    const rows = await sbGetAll(table, `${pk[table]},${cols.join(',')}`);
    tableRows[table] = rows;
    let n = 0;
    for (const row of rows) for (const c of cols) { collect(row[c], urlSet); if (hasMarker(row[c])) n++; }
    console.log(`  ${table}: ${rows.length} rows · มี ${BUCKET} ~${n} จุด`);
  }
  const urls = [...urlSet];
  console.log(`\nพบ URL ${BUCKET} ที่ต้องย้าย: ${urls.length} ไฟล์`);

  if (DRY_RUN) {
    urls.slice(0, 5).forEach((u) => console.log('   ' + u));
    console.log('\n[dry] ไม่ upload / ไม่ PATCH\n');
    return;
  }

  const map = {};
  let done = 0, failed = 0;
  for (const u of urls) {
    try {
      const dl = await fetch(u);
      if (!dl.ok) { console.warn(`  ⚠️ download ${dl.status}: ${u.slice(-40)}`); failed++; continue; }
      const ct = dl.headers.get('content-type') || 'application/octet-stream';
      const buf = Buffer.from(await dl.arrayBuffer());
      const { id } = await drive.uploadFile(driveNameFromUrl(u), ct, buf, BUCKET);
      map[u] = `${PROXY}/drive/file/${id}`;
      done++;
      if (done % 10 === 0) console.log(`  upload ${done}/${urls.length}...`);
    } catch (e) { console.warn(`  ⚠️ upload fail: ${e.message}`); failed++; }
  }
  console.log(`\nUpload เสร็จ: ${done} สำเร็จ · ${failed} ล้มเหลว`);

  let patched = 0, skipped = 0;
  for (const { table, cols } of effTargets) {
    for (const row of tableRows[table]) {
      const body = {};
      for (const c of cols) {
        if (!hasMarker(row[c])) continue;
        const next = remap(row[c], map);
        if (hasMarker(next)) { body._skip = true; break; }
        body[c] = next;
      }
      if (body._skip) { skipped++; continue; }
      if (!Object.keys(body).length) continue;
      try { await sbPatch(table, pk[table], row[pk[table]], body); patched++; }
      catch (e) { console.warn(`  ⚠️ PATCH ${table}=${row[pk[table]]}: ${e.message}`); skipped++; }
    }
  }
  console.log(`\n──────── สรุป ────────\n  ย้าย Drive : ${done} (fail ${failed})\n  rewrite    : ${patched}\n  ข้าม       : ${skipped}\n──────────────────────`);
  console.log('ℹ️ ของเก่า Supabase ยังอยู่ — ตรวจหน้าโปรโมชั่นก่อนลบ bucket\n');
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
