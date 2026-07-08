/**
 * sweep-orphan-event-files-all.cjs — กวาด orphan ทั้ง bucket event-files (ทุก prefix) ยกเว้น QR
 * ────────────────────────────────────────────────────────────
 * หลัง migrate event-files → Drive · สำเนาเก่าใน Supabase = orphan
 * script นี้ลบทุกไฟล์ที่ "ไม่มี URL อ้างใน DB" และ "ไม่ใช่ QR" (qr_* ยังใช้อยู่ · มี cron prune แยก)
 *
 * ปลอดภัย:
 *   - referencedSet = ทุก URL Supabase event-files ที่ยังอยู่ใน DB (select=* ทุกตารางที่เกี่ยว)
 *   - list storage แบบ recursive (posters/ slips/ campaigns/{token}/... ทุกชั้น)
 *   - ลบเฉพาะไฟล์ที่ (ไม่อยู่ใน referencedSet) และ (basename ไม่ขึ้นต้น qr_)
 *   - DRY_RUN=1 = รายงาน breakdown + ขนาด ไม่ลบ
 *   - ⚠️ Supabase Storage ไม่มีถังขยะ = ลบถาวร (Drive มีสำเนาแล้ว)
 *
 * รัน:
 *   DRY_RUN=1 node scripts/sweep-orphan-event-files-all.cjs
 *   node scripts/sweep-orphan-event-files-all.cjs
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
const MARKER = `/storage/v1/object/public/${BUCKET}/`;
// ทุกตารางที่อาจอ้าง URL event-files (select=* → collect ทุกคอลัมน์)
const REF_TABLES = [
  'event_attendees', 'room_booking_attendees', 'event_suppliers', 'event_logs',
  'events', 'places', 'place_room_types', 'place_rooms', 'place_dining_rooms',
  'fb_scheduled_posts', 'campaign_participants', 'campaign_submissions', 'campaigns',
];

/* prefix ที่ห้ามแตะ (อ้างจากตารางนอก REF_TABLES / ตั้งใจเก็บ / ยังใช้อยู่):
   - staff-messaging = LINE fetch URL เอง (user สั่งคงไว้ Supabase)
   - qr = QR code (มี cron prune-qr แยก)
   - media = ไม่แน่ใจตารางที่อ้าง (conservative) */
const EXCLUDE_PREFIXES = new Set(['staff-messaging', 'qr', 'media']);

if (!SB_URL || !SB_KEY) { console.error('❌ ต้องมี SUPABASE_URL + SUPABASE_SERVICE_KEY'); process.exit(1); }
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

async function listPage(prefix, offset) {
  const res = await fetch(`${SB_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!res.ok) throw new Error(`list "${prefix}" ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  return res.json();
}

/* recursive: คืน [{ path, size }] ของไฟล์จริงทุกชั้นใต้ prefix */
async function listAll(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const batch = await listPage(prefix, offset);
    for (const it of batch) {
      const full = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id) out.push({ path: full, size: (it.metadata && it.metadata.size) || 0 });
      else out.push(...await listAll(full));   // folder (id=null) → recurse
    }
    if (batch.length < 1000) break;
  }
  return out;
}

function fmtMB(bytes) { return (bytes / 1048576).toFixed(2) + ' MB'; }
function topPrefix(p) { return p.includes('/') ? p.split('/')[0] + '/' : '(root)'; }

async function main() {
  console.log(`\n🧹 Sweep orphan — bucket ${BUCKET} (ทุก prefix ยกเว้น QR)  ${DRY_RUN ? '(DRY RUN)' : '(LIVE — ลบถาวร)'}\n`);

  // 1) referencedSet
  const referenced = new Set();
  for (const t of REF_TABLES) {
    try {
      const rows = await sbGetAll(t);
      const before = referenced.size;
      rows.forEach((r) => collect(r, referenced));
      console.log(`   ref ${t}: ${rows.length} rows · +${referenced.size - before}`);
    } catch (e) { console.warn(`   ⚠️ ${t}: ${e.message} — ข้าม (conservative: อาจ keep เกิน)`); }
  }
  console.log(`   → URL event-files ที่ยังอ้างใน DB: ${referenced.size}\n`);

  // 2) list ทุกไฟล์ recursive
  const all = await listAll('');
  console.log(`   ไฟล์ทั้งหมดใน bucket: ${all.length}`);

  // 3) แยก: QR (protect) / referenced (keep) / orphan (delete)
  const orphans = [];
  const byPrefix = {};   // prefix → { del, delBytes, keep, qr, excl }
  let qrCount = 0, keepRef = 0, orphanBytes = 0, excluded = 0;
  for (const f of all) {
    const base = f.path.split('/').pop();
    const pfx = topPrefix(f.path);
    const top = f.path.includes('/') ? f.path.split('/')[0] : '';
    byPrefix[pfx] ||= { del: 0, delBytes: 0, keep: 0, qr: 0, excl: 0 };
    if (base.startsWith('qr_')) { qrCount++; byPrefix[pfx].qr++; continue; }        // protect QR
    if (EXCLUDE_PREFIXES.has(top)) { excluded++; byPrefix[pfx].excl++; continue; }  // ห้ามแตะ
    const url = `${SB_URL}${MARKER}${f.path}`;
    if (referenced.has(url)) { keepRef++; byPrefix[pfx].keep++; continue; }          // ยังอ้างอยู่
    orphans.push(f.path); orphanBytes += f.size;
    byPrefix[pfx].del++; byPrefix[pfx].delBytes += f.size;
  }

  console.log(`   QR (protect)        : ${qrCount}`);
  console.log(`   exclude (ห้ามแตะ)   : ${excluded}  [${[...EXCLUDE_PREFIXES].join(', ')}]`);
  console.log(`   ยังถูกอ้าง (keep)   : ${keepRef}`);
  console.log(`   orphan (จะลบ)       : ${orphans.length}  ·  ~${fmtMB(orphanBytes)}\n`);
  console.log('   breakdown ต่อ prefix:');
  Object.entries(byPrefix).sort().forEach(([k, v]) =>
    console.log(`     ${k.padEnd(16)} ลบ ${v.del} (${fmtMB(v.delBytes)}) · keep ${v.keep} · qr ${v.qr} · excl ${v.excl}`));
  console.log('');

  if (DRY_RUN) { console.log('[dry] ไม่ลบ — เอา DRY_RUN ออกเพื่อลบจริง (ถาวร)\n'); return; }
  if (!orphans.length) { console.log('ไม่มี orphan ให้ลบ\n'); return; }

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
  console.log(`  keep (อ้างอยู่) : ${keepRef} · QR (protect) : ${qrCount}`);
  console.log('──────────────────────');
  console.log('ℹ️ รูปเสิร์ฟจาก Drive · Supabase เหลือแค่ QR + ไฟล์ที่ยังอ้าง\n');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
