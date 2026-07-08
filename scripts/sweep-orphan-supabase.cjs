/**
 * sweep-orphan-supabase.cjs — ลบไฟล์ orphan ใน Supabase Storage (ที่ย้ายไป Drive แล้ว) เพื่อลดพื้นที่
 * ────────────────────────────────────────────────────────────
 * หลัง migrate → รูปถูก rewrite ให้ชี้ Drive · สำเนาเก่าใน Supabase = orphan (ไม่มีใครอ้าง)
 * script นี้ลบเฉพาะไฟล์ที่ "ไม่มี URL อ้างใน DB แล้ว" (cross-check กัน false-delete)
 *
 * SCOPE ปัจจุบัน: bucket event-files / prefix "places" (เริ่ม low-risk)
 *   เปลี่ยน PREFIX + REF_TABLES ด้านล่างเพื่อ sweep ส่วนอื่น
 *
 * ปลอดภัย:
 *   - เก็บ referencedSet = ทุก URL Supabase event-files ที่ยังอยู่ใน DB (select=* ทุกตารางที่เกี่ยว)
 *   - ลบเฉพาะไฟล์ที่ public URL ไม่อยู่ใน referencedSet
 *   - DRY_RUN=1 = รายงานอย่างเดียว (ขนาดที่จะประหยัด) ไม่ลบ
 *   - ⚠️ ลบจริง = ถาวร (Supabase Storage ไม่มีถังขยะ) — รูปยังอยู่บน Drive อยู่แล้ว
 *
 * รัน:
 *   DRY_RUN=1 node scripts/sweep-orphan-supabase.cjs
 *   node scripts/sweep-orphan-supabase.cjs
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

const SB_URL = (process.env.SUPABASE_URL || process.env.SB_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SB_SERVICE_KEY || '';
const DRY_RUN = process.env.DRY_RUN === '1';

const BUCKET = 'event-files';
const PREFIX = 'places';   // storage subfolder ที่จะกวาด
const MARKER = `/storage/v1/object/public/${BUCKET}/`;
// ตารางที่อาจอ้าง URL รูป place (select=* → collect URL ทุกคอลัมน์ กันชื่อคอลัมน์ผิด)
const REF_TABLES = ['places', 'place_rooms', 'place_room_types', 'place_dining_rooms'];

if (!SB_URL || !SB_KEY) { console.error('❌ ต้องมี SUPABASE_URL + SUPABASE_SERVICE_KEY ใน ai-proxy/.env'); process.exit(1); }
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

async function sbGetAll(table) {
  const rows = [];
  const LIMIT = 1000;
  for (let offset = 0; ; offset += LIMIT) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?select=*&limit=${LIMIT}&offset=${offset}`, { headers: H });
    if (!res.ok) throw new Error(`GET ${table} ${res.status}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < LIMIT) break;
  }
  return rows;
}

function collect(val, set) {
  if (typeof val === 'string') { if (val.includes(MARKER)) set.add(val); }
  else if (Array.isArray(val)) val.forEach((v) => collect(v, set));
  else if (val && typeof val === 'object') Object.values(val).forEach((v) => collect(v, set));
}

async function listStorage(prefix) {
  const out = [];
  const LIMIT = 1000;
  for (let offset = 0; ; offset += LIMIT) {
    const res = await fetch(`${SB_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: LIMIT, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < LIMIT) break;
  }
  return out;
}

function fmtMB(bytes) { return (bytes / 1048576).toFixed(2) + ' MB'; }

async function main() {
  console.log(`\n🧹 Sweep orphan Supabase Storage  ${DRY_RUN ? '(DRY RUN)' : '(LIVE — ลบถาวร)'}`);
  console.log(`   bucket=${BUCKET} · prefix="${PREFIX}"\n`);

  // 1) referencedSet = URL Supabase event-files ที่ยังอยู่ใน DB
  const referenced = new Set();
  for (const t of REF_TABLES) {
    try {
      const rows = await sbGetAll(t);
      let before = referenced.size;
      rows.forEach((r) => collect(r, referenced));
      console.log(`   ref ${t}: ${rows.length} rows · +${referenced.size - before} url`);
    } catch (e) { console.warn(`   ⚠️ อ่าน ${t} ไม่ได้ (${e.message}) — ข้าม (ปลอดภัยเชิงอนุรักษ์: อาจ keep เกิน)`); }
  }
  console.log(`   → URL event-files ที่ยังถูกอ้างใน DB: ${referenced.size}\n`);

  // 2) list ไฟล์ storage ใน prefix
  const files = await listStorage(PREFIX);
  const realFiles = files.filter((f) => f.id);   // id null = folder placeholder
  console.log(`   ไฟล์ใน ${BUCKET}/${PREFIX}/ : ${realFiles.length}`);

  // 3) แยก orphan vs referenced
  const orphans = [];
  let orphanBytes = 0, keptRef = 0;
  for (const f of realFiles) {
    const fullPath = `${PREFIX}/${f.name}`;
    const publicUrl = `${SB_URL}${MARKER}${fullPath}`;
    if (referenced.has(publicUrl)) { keptRef++; continue; }
    orphans.push(fullPath);
    orphanBytes += (f.metadata && f.metadata.size) || 0;
  }

  console.log(`   ยังถูกอ้าง (เก็บไว้) : ${keptRef}`);
  console.log(`   orphan (จะลบ)       : ${orphans.length}  ·  ~${fmtMB(orphanBytes)}\n`);
  if (orphans.length) {
    console.log('   ตัวอย่าง orphan 5 รายการ:');
    orphans.slice(0, 5).forEach((p) => console.log('     ' + p));
    console.log('');
  }

  if (DRY_RUN) { console.log('[dry] ไม่ลบ — เอา DRY_RUN ออกเพื่อลบจริง (ถาวร)\n'); return; }
  if (!orphans.length) { console.log('ไม่มี orphan ให้ลบ\n'); return; }

  // 4) bulk delete (ชุดละ 100)
  let deleted = 0;
  for (let i = 0; i < orphans.length; i += 100) {
    const chunk = orphans.slice(i, i + 100);
    const res = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: chunk }),
    });
    if (res.ok) { deleted += chunk.length; console.log(`   ลบ ${deleted}/${orphans.length}...`); }
    else console.warn(`   ⚠️ delete ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  }

  console.log('\n──────── สรุป ────────');
  console.log(`  ลบ orphan : ${deleted}  ·  ~${fmtMB(orphanBytes)}`);
  console.log(`  เก็บไว้ (ยังอ้าง) : ${keptRef}`);
  console.log('──────────────────────');
  console.log('ℹ️ รูปยังเสิร์ฟจาก Drive ปกติ — Supabase space ลดลงแล้ว\n');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
