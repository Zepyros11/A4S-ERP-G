/* ============================================================
   import-stock-items.js — นำเข้าชีต 🧴Products → ตาราง stock_items
   (master รายการสินค้ากลาง ใช้ร่วม 3 หน้า: ตรวจนับ · เบิก · ยืม/คืน)

   ใช้: node scripts/import-stock-items.js                    → dry-run (ไม่เขียนจริง)
        node scripts/import-stock-items.js --apply            → เขียนลงฐานข้อมูล
        node scripts/import-stock-items.js path/to/file.xlsx  → ระบุไฟล์เอง

   ⚠️ ต้องรัน sql/179_stock_items.sql ก่อน (ไม่งั้นไม่มีตารางให้เขียน)

   รันซ้ำได้ — upsert ด้วย "ชื่อสินค้า" ที่ normalize แล้ว (trim + ยุบช่องว่าง +
   lowercase) ให้ตรงกับ unique index ใน sql/179 และ norm() ในหน้าเว็บ
   ชีตมี "โบว์ชัว  4TREE" เว้น 2 เคาะ — ถ้าเทียบแค่ trim จะกลายเป็นคนละตัว

   กติกาการแปลงข้อมูล:
     • SKU          → item_code    (ไม่ unique — ชีตมี TS0001.1 ซ้ำ 2 แถวจริง)
     • productName  → item_name    (คีย์ที่ใช้ upsert)
     • category     → category     (ข้อความล้วน ไม่ผูก categories)
     • Qty/Box      → pieces_per_box · ว่าง/0 → 1
       0 ในชีตแปลว่า "ขายเป็นซอง ไม่มีลัง" ไม่ใช่ "หนึ่งลังได้ศูนย์ชิ้น"
       ถ้าเก็บ 0 ตรง ๆ สูตรใบตรวจนับ (ลัง × ตัวคูณ + ชิ้น) จะกลืนจำนวนลังหายเงียบ
     • price        → price
     • status       → is_active    (Active → true · นอกนั้น false)
     • ลำดับการแสดง → sort_order   (ทศนิยม 3.1 / 5.2 = ลำดับย่อยในกลุ่ม)
       ว่าง → 999 เพื่อให้ไปต่อท้าย ไม่ใช่แทรกหน้าสุดปนกับตัวที่ตั้งลำดับไว้แล้ว

   ไม่แตะคอลัมน์ product_id (สะพานไป catalog) — ผูกเองทีหลังจากหน้าเว็บ
   ============================================================ */
import fs from 'fs';
import XLSX from 'xlsx';

const SB = 'https://egnwfmdsqtxxyhyajnnu.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnbndmbWRzcXR4eHloeWFqbm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTI4ODEsImV4cCI6MjEwMDYyODg4MX0.5R47xGBQY0Nr92AP30kSNgpYkZ6pV-al9-JGxsimifc';

const APPLY = process.argv.includes('--apply');
const SHEET = '🧴Products';
const FILE =
  process.argv.find((a) => /\.(xlsx|xls)$/i.test(a)) ||
  'C:/Users/hoppo/Downloads/DATA_STOCK.xlsx';

const clean = (s) => String(s ?? '').replace(/\u00A0/g, ' ').trim();
const norm = (s) => clean(s).toLowerCase().replace(/\s+/g, ' ');
const numOr = (v, dflt) => {
  const n = Number(clean(v));
  return Number.isFinite(n) ? n : dflt;
};

/* ── Supabase REST ── */
async function sb(path, opts = {}) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ── 1. อ่านชีต ── */
if (!fs.existsSync(FILE)) {
  console.error(`❌ ไม่พบไฟล์: ${FILE}`);
  process.exit(1);
}
const wb = XLSX.readFile(FILE);
if (!wb.SheetNames.includes(SHEET)) {
  console.error(`❌ ไม่พบชีต "${SHEET}" — ชีตในไฟล์: ${wb.SheetNames.join(' | ')}`);
  process.exit(1);
}

/* แถว 1 = เลขคอลัมน์ (1,2,3…) · แถว 2 = หัวตารางจริง · ข้อมูลเริ่มแถว 3 */
const raw = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, defval: '' });
const head = (raw[1] || []).map(clean);
const col = (re) => head.findIndex((h) => re.test(h));
const iSku = col(/^sku$/i);
const iName = col(/productname|ชื่อสินค้า/i);
const iCat = col(/category|หมวด/i);
const iBox = col(/qty\s*\/\s*box|ลัง/i);
const iPrice = col(/price|ราคา/i);
const iStatus = col(/status|สถานะ/i);
const iOrder = col(/ลำดับ/i);

if (iName < 0) {
  console.error(`❌ ไม่พบคอลัมน์ productName ในหัวตาราง: ${head.join(' | ')}`);
  process.exit(1);
}

const rows = raw.slice(2)
  .filter((r) => clean(r[iName]))
  .map((r) => ({
    item_code: clean(r[iSku]) || null,
    item_name: clean(r[iName]),
    category: clean(r[iCat]) || null,
    /* 0 / ว่าง = ไม่มีลัง → 1 (ดูหมายเหตุหัวไฟล์) */
    pieces_per_box: numOr(r[iBox], 0) > 0 ? numOr(r[iBox], 1) : 1,
    price: numOr(r[iPrice], 0),
    is_active: /^active$/i.test(clean(r[iStatus])),
    sort_order: numOr(r[iOrder], 0) || 999,
  }));

/* ชื่อซ้ำในชีตเอง = upsert จะทับกันเองรอบเดียว เตือนไว้ให้เห็น */
const seen = new Map();
const dupNames = [];
rows.forEach((r) => {
  const k = norm(r.item_name);
  if (seen.has(k)) dupNames.push(r.item_name);
  else seen.set(k, r);
});

console.log(`📄 ไฟล์  : ${FILE}`);
console.log(`📑 ชีต   : ${SHEET}`);
console.log(`📦 อ่านได้: ${rows.length} รายการ (ชื่อไม่ซ้ำ ${seen.size})`);
if (dupNames.length) console.log(`⚠️  ชื่อซ้ำในชีต: ${dupNames.join(', ')}`);

const dupCodes = Object.entries(
  rows.reduce((m, r) => (r.item_code ? ((m[r.item_code] = (m[r.item_code] || 0) + 1), m) : m), {})
).filter(([, c]) => c > 1);
if (dupCodes.length) {
  console.log(`ℹ️  SKU ซ้ำ (ยอมรับได้ — ตารางไม่บังคับ unique): ${dupCodes.map(([c, n]) => `${c}×${n}`).join(', ')}`);
}

/* ── 2. เทียบกับของที่มีอยู่ ── */
let existing;
try {
  existing = await sb('stock_items?select=id,item_code,item_name,price,pieces_per_box,category,sort_order,is_active&limit=2000');
} catch (e) {
  if (/PGRST205|404/.test(e.message)) {
    console.error('\n❌ ยังไม่มีตาราง stock_items');
    console.error('   → เปิด Supabase SQL Editor แล้วรัน sql/179_stock_items.sql ก่อน');
    process.exit(1);
  }
  throw e;
}
const byName = new Map(existing.map((e) => [norm(e.item_name), e]));

const toInsert = [];
const toUpdate = [];
for (const [, r] of seen) {
  const cur = byName.get(norm(r.item_name));
  if (!cur) { toInsert.push(r); continue; }
  /* อัปเดตเฉพาะที่ค่าต่างจริง — ไม่ยิง PATCH เปล่าให้ updated_at ขยับทั้งตาราง */
  const diff = {};
  for (const k of ['item_code', 'category', 'pieces_per_box', 'price', 'is_active', 'sort_order']) {
    const a = cur[k], b = r[k];
    const same = typeof b === 'number' ? Number(a) === Number(b) : (a ?? null) === (b ?? null);
    if (!same) diff[k] = b;
  }
  if (Object.keys(diff).length) toUpdate.push({ id: cur.id, name: r.item_name, diff });
}

console.log(`\n➕ เพิ่มใหม่ : ${toInsert.length}`);
toInsert.forEach((r) => console.log(`   ${String(r.item_code || '—').padEnd(10)} ${r.item_name}`));
console.log(`\n✏️  อัปเดต   : ${toUpdate.length}`);
toUpdate.forEach((u) =>
  console.log(`   ${u.name} → ${Object.entries(u.diff).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
);

const untouched = existing.length - toUpdate.length;
if (untouched > 0) console.log(`\n😴 ไม่แตะ    : ${untouched} รายการที่มีอยู่แล้วและค่าตรงกัน`);

if (!APPLY) {
  console.log('\n🔎 DRY-RUN — ยังไม่เขียนอะไรลงฐานข้อมูล');
  console.log('   สั่งจริง: node scripts/import-stock-items.js --apply');
  process.exit(0);
}

/* ── 3. เขียนจริง ── */
if (toInsert.length) {
  /* batch POST ต้องมีคีย์ครบเท่ากันทุกแถว ไม่งั้น Supabase ตอบ PGRST102 */
  const cols = ['item_code', 'item_name', 'category', 'pieces_per_box', 'price', 'is_active', 'sort_order'];
  const body = toInsert.map((r) => Object.fromEntries(cols.map((k) => [k, r[k] ?? null])));
  await sb('stock_items', { method: 'POST', body: JSON.stringify(body) });
  console.log(`✅ เพิ่ม ${toInsert.length} รายการ`);
}

for (const u of toUpdate) {
  await sb(`stock_items?id=eq.${u.id}`, { method: 'PATCH', body: JSON.stringify(u.diff) });
}
if (toUpdate.length) console.log(`✅ อัปเดต ${toUpdate.length} รายการ`);

const after = await sb('stock_items?select=id&limit=2000');
console.log(`\n🎉 เสร็จ — stock_items ตอนนี้มี ${after.length} รายการ`);
