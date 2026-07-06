/**
 * migrate-event-files-to-drive.cjs — ย้ายรูป bucket "event-files" → Google Drive
 * ────────────────────────────────────────────────────────────
 * ต่างจาก product-images: event-files กระจายอยู่ ~14 จุด ข้าม 10 ตาราง
 * มีทั้ง text / array / JSONB ซ้อนลึก → ใช้ recursive replace (จัดการทุกชนิดพร้อมกัน)
 *
 * วิธีทำ:
 *   Pass A (collect) : ไล่ทุกตาราง+คอลัมน์ → เก็บ URL ที่มี "/event-files/" เป็น Set
 *   Upload           : แต่ละ URL → download จาก Supabase → upload Drive → map[old]=new
 *   Pass B (rewrite) : แต่ละ row → recursive replace ทุก col → PATCH by pk (เฉพาะที่เปลี่ยน)
 *
 * PK: ตรวจจาก PostgREST OpenAPI อัตโนมัติ + fallback map (จากโค้ดจริง)
 *
 * ปลอดภัย/idempotent:
 *   - URL ที่ย้ายแล้ว (/drive/file/) ไม่มี "/event-files/" → ไม่ถูกเก็บ → รันซ้ำได้
 *   - DRY_RUN=1 = collect + รายงานอย่างเดียว ไม่ upload ไม่ PATCH
 *   - ของเก่าใน Supabase ไม่ถูกลบ (rollback ได้)
 *
 * รัน:
 *   DRY_RUN=1 node scripts/migrate-event-files-to-drive.cjs   # ดูก่อน
 *   node scripts/migrate-event-files-to-drive.cjs             # ย้ายจริง
 */

const fs = require('fs');
const path = require('path');

/* ── โหลด ai-proxy/.env (ชุดเดียวกับ migrate product) ── */
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

const BUCKET = 'event-files';
const MARKER = `/storage/v1/object/public/${BUCKET}/`;

/* ตาราง + คอลัมน์ที่เก็บ URL (จาก survey) — ครอบคลุม text/array/jsonb */
const TARGETS = [
  { table: 'event_attendees',        cols: ['slip_url'] },
  { table: 'room_booking_attendees', cols: ['slip_url'] },
  { table: 'event_suppliers',        cols: ['doc_url'] },
  { table: 'event_logs',             cols: ['attachment_url'] },
  { table: 'events',                 cols: ['poster_url', 'image_urls'] },
  { table: 'places',                 cols: ['image_urls', 'cover_image_url', 'document_urls', 'bank_image_urls'] },
  { table: 'place_room_types',       cols: ['image_urls'] },
  { table: 'place_rooms',            cols: ['image_url', 'image_urls'] },
  { table: 'place_dining_rooms',     cols: ['image_urls'] },
  { table: 'fb_scheduled_posts',     cols: ['media_urls'] },
  { table: 'campaign_participants',  cols: ['facebook_img', 'tiktok_img', 'ig_img'] },
  { table: 'campaign_submissions',   cols: ['proof_url'] },
  { table: 'campaigns',              cols: ['cover_url', 'media', 'requirements_images', 'rewards'] },
];

/* fallback PK (จากโค้ดจริง) — ใช้เมื่อ OpenAPI ตรวจไม่เจอ */
const PK_FALLBACK = {
  events: 'event_id', places: 'place_id', event_attendees: 'attendee_id',
  event_suppliers: 'ev_supplier_id', campaigns: 'campaign_id',
  campaign_participants: 'participant_id', campaign_submissions: 'submission_id',
  fb_scheduled_posts: 'id', place_dining_rooms: 'dining_id',
  event_logs: 'id', room_booking_attendees: 'id',
  place_room_types: 'id', place_rooms: 'id',
};

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
    if (!res.ok) throw new Error(`GET ${table} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
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

/* ตรวจ PK + คอลัมน์จริง จาก OpenAPI (กันชื่อคอลัมน์ผิด) */
async function loadSchema() {
  const pk = {}, realCols = {};
  try {
    const res = await fetch(`${SB_URL}/rest/v1/`, { headers: H });
    const spec = await res.json();
    const defs = spec.definitions || {};
    for (const { table } of TARGETS) {
      const props = (defs[table] && defs[table].properties) || {};
      realCols[table] = new Set(Object.keys(props));
      for (const [col, meta] of Object.entries(props)) {
        const d = (meta && meta.description) || '';
        if (/primary key|<pk\/>/i.test(d)) { pk[table] = col; break; }
      }
      if (!pk[table]) pk[table] = PK_FALLBACK[table];
    }
  } catch (e) {
    console.warn('⚠️ อ่าน OpenAPI ไม่ได้ ใช้ fallback PK + ไม่ validate คอลัมน์:', e.message);
    for (const { table } of TARGETS) { pk[table] = PK_FALLBACK[table]; realCols[table] = null; }
  }
  return { pk, realCols };
}

/* ── recursive collect / replace (จัดการ text/array/object เหมือนกันหมด) ── */
function collect(val, set) {
  if (typeof val === 'string') { if (val.includes(MARKER)) set.add(val); }
  else if (Array.isArray(val)) val.forEach(v => collect(v, set));
  else if (val && typeof val === 'object') Object.values(val).forEach(v => collect(v, set));
}
function remap(val, map) {
  if (typeof val === 'string') return map[val] || val;
  if (Array.isArray(val)) return val.map(v => remap(v, map));
  if (val && typeof val === 'object') {
    const o = {}; for (const k of Object.keys(val)) o[k] = remap(val[k], map); return o;
  }
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
  console.log(`\n🚀 Migrate event-files → Drive  ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
  console.log(`   Supabase: ${SB_URL}\n   Proxy   : ${PROXY}\n`);

  const { pk, realCols } = await loadSchema();

  // กรอง cols ให้เหลือเฉพาะที่มีจริง (กันชื่อคอลัมน์ผิดจาก survey)
  const effTargets = [];
  console.log('ตาราง / PK / คอลัมน์ที่จะย้าย:');
  for (const t of TARGETS) {
    const real = realCols[t.table];
    const cols = real ? t.cols.filter(c => real.has(c)) : t.cols;
    const missing = real ? t.cols.filter(c => !real.has(c)) : [];
    const warn = missing.length ? `  ⚠️ ข้ามคอลัมน์ไม่มีจริง: ${missing.join(', ')}` : '';
    if (!cols.length) { console.log(`   ${t.table} → (ไม่มีคอลัมน์ที่ใช้ได้ ข้ามตาราง)${warn}`); continue; }
    console.log(`   ${t.table} [pk=${pk[t.table]}] → ${cols.join(', ')}${warn}`);
    effTargets.push({ table: t.table, cols });
  }
  console.log('');

  // ── Pass A: fetch ทุก row + collect URL ──
  const urlSet = new Set();
  const tableRows = {}; // table → rows (เก็บไว้ใช้ pass B)
  for (const { table, cols } of effTargets) {
    const rows = await sbGetAll(table, `${pk[table]},${cols.join(',')}`);
    tableRows[table] = rows;
    let n = 0;
    for (const row of rows) for (const c of cols) { collect(row[c], urlSet); if (hasMarker(row[c])) n++; }
    console.log(`  ${table}: ${rows.length} rows · มี event-files ~${n} จุด`);
  }
  const urls = [...urlSet];
  console.log(`\nพบ URL event-files ที่ต้องย้าย: ${urls.length} ไฟล์`);

  if (DRY_RUN) {
    console.log('\n[dry] ตัวอย่าง URL 5 รายการ:');
    urls.slice(0, 5).forEach(u => console.log('   ' + u));
    console.log('\n[dry] ไม่ upload / ไม่ PATCH — เอา DRY_RUN ออกเพื่อย้ายจริง\n');
    return;
  }

  // ── Upload แต่ละ URL → Drive → map ──
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
  if (failed) console.log('  (row ที่อ้าง URL ที่ล้มเหลวจะถูกข้าม ไม่ patch ครึ่งๆ)');

  // ── Pass B: rewrite + PATCH ──
  let patched = 0, skipped = 0;
  for (const { table, cols } of effTargets) {
    for (const row of tableRows[table]) {
      const body = {};
      for (const c of cols) {
        if (!hasMarker(row[c])) continue;
        const next = remap(row[c], map);
        // ถ้ายังมี MARKER เหลือ = มี url ที่ upload ไม่สำเร็จ → ข้าม row นี้ทั้งแถว (กัน half-migrate)
        if (hasMarker(next)) { body._skip = true; break; }
        body[c] = next;
      }
      if (body._skip) { skipped++; continue; }
      if (!Object.keys(body).length) continue;
      try { await sbPatch(table, pk[table], row[pk[table]], body); patched++; }
      catch (e) { console.warn(`  ⚠️ PATCH ${table}.${pk[table]}=${row[pk[table]]}: ${e.message}`); skipped++; }
    }
  }

  console.log('\n──────── สรุป ────────');
  console.log(`  ไฟล์ย้ายขึ้น Drive : ${done} (ล้มเหลว ${failed})`);
  console.log(`  row rewrite สำเร็จ : ${patched}`);
  console.log(`  row ข้าม          : ${skipped}`);
  console.log('──────────────────────');
  console.log('ℹ️ ของเก่าใน Supabase ยังอยู่ — ตรวจหน้า event/campaign ให้ครบก่อนลบ bucket\n');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
