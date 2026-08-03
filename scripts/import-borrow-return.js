/* ============================================================
   import-borrow-return.js — นำเข้าชีต 📤↩️Borrow_Return
   เข้าตาราง borrow_items / borrow_persons / borrow_txns / borrow_txn_lines

   ใช้: node scripts/import-borrow-return.js            → dry-run (ไม่เขียนจริง)
        node scripts/import-borrow-return.js --apply    → เขียนลงฐานข้อมูล

   ⚠️ รันซ้ำ = ข้อมูลซ้ำ (ไม่มี upsert) — ถ้าจะ import ใหม่ต้องล้างก่อน:
      DELETE FROM borrow_txns;      -- lines ลบตาม (ON DELETE CASCADE)
      DELETE FROM borrow_items; DELETE FROM borrow_persons;

   กติกาการแปลงข้อมูล:
     • ชีตเดิม lookup ด้วย "ชื่อ" ล้วน (ไม่มีรหัสสินค้า/รหัสคน) → master ทั้ง 2 ชุด
       สร้างจากชื่อที่ไม่ซ้ำในชีต แล้วผูกกลับด้วยชื่อที่ normalize แล้ว
       (trim + ยุบช่องว่างซ้อน + lowercase) เพราะในชีตมีเว้นวรรคเกิน เช่น "โบว์ชัว  4TREE"
     • ชีตไม่มีคอลัมน์ราคา → borrow_items.price = 0 ทุกตัว
       (กรอกราคาทีหลังได้ที่หน้า ยืม/คืน → ⚙️ จัดการสินค้า · รายการเก่าเก็บ snapshot 0 ไว้
        รายงานคิด "มูลค่าคงเหลือ" จากราคา master ปัจจุบัน จึงอัปเดตตามให้เอง)
     • 1 txn = (วันที่ + ชื่อคน + ประเภท) เดียวกัน → รวมสินค้าหลายบรรทัดไว้ใบเดียว
       เหมือนตอนกด "Save ข้อมูล" ครั้งเดียวในหน้าเว็บ
     • สินค้าซ้ำในใบเดียวกัน (เช่น 3/7/2024 คืน 4Soil 1 + 4Soil 5) → รวมเป็นบรรทัดเดียว qty=6
       เพราะฟอร์มแก้ไขเก็บจำนวนต่อสินค้าได้ค่าเดียว ถ้าปล่อยไว้ 2 บรรทัดจะหายตอนกดแก้
     • person_type = company ถ้าชื่อขึ้นต้นด้วย บริษัท/หจก/บจก/ห้าง/สาขา · นอกนั้น person
     • วันที่เป็น D/M/YYYY หรือ DD/MM/YYYY (รองรับปี พ.ศ. เผื่อไว้ แม้ชีตนี้เป็น ค.ศ. ล้วน)
   ============================================================ */
import fs from 'fs';   // scripts/package.json = "type": "module" → ต้องใช้ import ไม่ใช่ require

const SB = 'https://egnwfmdsqtxxyhyajnnu.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnbndmbWRzcXR4eHloeWFqbm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTI4ODEsImV4cCI6MjEwMDYyODg4MX0.5R47xGBQY0Nr92AP30kSNgpYkZ6pV-al9-JGxsimifc';
const APPLY = process.argv.includes('--apply');

const FILE =
  process.argv.find((a) => a.endsWith('.csv')) ||
  'C:/Users/hoppo/Downloads/Stock_Data - 📤↩️Borrow_Return.csv';

/* ── CSV parser (รองรับ quote + comma ในฟิลด์) ── */
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (s) => String(s ?? '').replace(/\u00A0/g, ' ').trim();
const norm = (s) => clean(s).toLowerCase().replace(/\s+/g, ' ');

/* ── วันที่ D/M/YYYY → ISO ── */
function toISO(s) {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  let year = Number(y);
  if (year > 2400) year -= 543;
  const dd = Number(d), mm = Number(mo);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

const TYPE_MAP = { 'ยืม': 'borrow', 'คืน': 'return' };
const isCompany = (name) => /^(บริษัท|บจก|หจก|ห้าง|สาขา)/.test(clean(name));

/* ── Supabase REST ── */
async function sb(path, opts = {}) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function insertAll(table, rows, chunk = 500, representation = false) {
  const out = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const got = await sb(table, {
      method: 'POST',
      headers: representation ? { Prefer: 'return=representation' } : {},
      body: JSON.stringify(part),
    });
    if (got) out.push(...got);
  }
  return out;
}

/* ============================================================ */
(async () => {
  console.log(`📄 อ่านไฟล์: ${FILE}`);
  const raw = fs.readFileSync(FILE, 'utf8');
  const rows = parseCSV(raw);

  /* แถวที่ 1 = เลขคอลัมน์ (1,2,3,4,5) · แถวที่ 2 = หัวตาราง → ข้อมูลเริ่มแถวที่ 3 */
  const head = rows.findIndex((r) => norm(r[0]) === 'date');
  if (head < 0) throw new Error('ไม่พบแถวหัวตาราง (คอลัมน์แรกต้องเป็น "Date")');
  const data = rows.slice(head + 1).filter((r) => clean(r[0]) || clean(r[1]));

  /* ── แปลงแถว + เก็บแถวที่ใช้ไม่ได้ ── */
  const good = [], bad = [];
  for (const [i, r] of data.entries()) {
    const date = toISO(r[0]);
    const person = clean(r[1]);
    const type = TYPE_MAP[clean(r[2])];
    const product = clean(r[3]);
    const qty = Number(clean(r[4]).replace(/,/g, ''));
    if (!date || !person || !type || !product || !isFinite(qty) || qty <= 0) {
      bad.push({ line: head + 2 + i, row: r.join(' | ') });
      continue;
    }
    good.push({ date, person, type, product, qty });
  }

  /* ── master จากชื่อที่ไม่ซ้ำ (ชีตเดิมไม่มีรหัส) ── */
  const personByKey = new Map();   // norm(ชื่อ) → { person_name, person_type }
  const itemByKey = new Map();     // norm(ชื่อ) → { item_name }
  for (const g of good) {
    if (!personByKey.has(norm(g.person)))
      personByKey.set(norm(g.person), { person_name: g.person, person_type: isCompany(g.person) ? 'company' : 'person' });
    if (!itemByKey.has(norm(g.product)))
      itemByKey.set(norm(g.product), { item_name: g.product, price: 0 });
  }

  /* ── จัดกลุ่มเป็นใบ: วันที่ + คน + ประเภท ── */
  const txnMap = new Map();
  let merged = 0;
  for (const g of good) {
    const key = `${g.date}|${norm(g.person)}|${g.type}`;
    let t = txnMap.get(key);
    if (!t) {
      t = { txn_date: g.date, personKey: norm(g.person), person_name: g.person, txn_type: g.type, lines: new Map() };
      txnMap.set(key, t);
    }
    const ik = norm(g.product);
    if (t.lines.has(ik)) { t.lines.get(ik).qty += g.qty; merged++; }
    else t.lines.set(ik, { itemKey: ik, item_name: g.product, qty: g.qty });
  }
  const txns = [...txnMap.values()].sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1));

  /* ── สรุป ── */
  const nLines = txns.reduce((s, t) => s + t.lines.size, 0);
  const byType = { borrow: 0, return: 0 };
  txns.forEach((t) => (byType[t.txn_type] += 1));
  const dates = good.map((g) => g.date).sort();

  console.log('\n──────── สรุปข้อมูลที่จะนำเข้า ────────');
  console.log(`แถวในชีต        : ${data.length}  (ใช้ได้ ${good.length} · ข้าม ${bad.length})`);
  console.log(`ผู้ยืม (master)  : ${personByKey.size}  (บริษัท/สาขา ${[...personByKey.values()].filter((p) => p.person_type === 'company').length})`);
  console.log(`สินค้า (master)  : ${itemByKey.size}  — ราคา 0 ทุกตัว (ชีตไม่มีคอลัมน์ราคา)`);
  console.log(`ใบยืม/คืน        : ${txns.length}  (ยืม ${byType.borrow} · คืน ${byType.return})`);
  console.log(`บรรทัดสินค้า     : ${nLines}${merged ? `  (รวมสินค้าซ้ำในใบเดียวกัน ${merged} แถว)` : ''}`);
  console.log(`ช่วงวันที่       : ${dates[0]} → ${dates[dates.length - 1]}`);
  if (bad.length) {
    console.log(`\n⚠️ แถวที่ข้าม (${bad.length}):`);
    bad.slice(0, 20).forEach((b) => console.log(`   บรรทัด ${b.line}: ${b.row}`));
    if (bad.length > 20) console.log(`   …อีก ${bad.length - 20} แถว`);
  }

  if (!APPLY) {
    console.log('\n🟡 DRY-RUN — ยังไม่เขียนอะไรลงฐานข้อมูล');
    console.log('   สั่งจริงด้วย: node scripts/import-borrow-return.js --apply');
    return;
  }

  /* ── เขียนจริง ── */
  console.log('\n🚀 เริ่มเขียนลงฐานข้อมูล…');

  const existP = await sb('borrow_persons?select=id,person_name');
  const existI = await sb('borrow_items?select=id,item_name');
  if (existP.length || existI.length) {
    console.log(`⚠️ พบ master เดิมอยู่แล้ว (ผู้ยืม ${existP.length} · สินค้า ${existI.length}) — จะใช้ตัวเดิมถ้าชื่อตรงกัน`);
  }
  const pId = new Map(existP.map((p) => [norm(p.person_name), p.id]));
  const iId = new Map(existI.map((i) => [norm(i.item_name), i.id]));

  const newPersons = [...personByKey.entries()].filter(([k]) => !pId.has(k)).map(([, v]) => v);
  const newItems = [...itemByKey.entries()].filter(([k]) => !iId.has(k)).map(([, v]) => v);

  if (newPersons.length) {
    const got = await insertAll('borrow_persons', newPersons, 500, true);
    got.forEach((p) => pId.set(norm(p.person_name), p.id));
    console.log(`   ✅ ผู้ยืม +${got.length}`);
  }
  if (newItems.length) {
    const got = await insertAll('borrow_items', newItems, 500, true);
    got.forEach((i) => iId.set(norm(i.item_name), i.id));
    console.log(`   ✅ สินค้า +${got.length}`);
  }

  /* header — ต้องได้ id กลับมาเพื่อผูก lines จึงขอ return=representation
     แล้วจับคู่ด้วย (วันที่+คน+ประเภท) ซึ่ง unique อยู่แล้วจากการ group ข้างบน
     (ไม่พึ่งลำดับแถวที่ PostgREST ส่งกลับ) */
  const headerRows = txns.map((t) => ({
    txn_date: t.txn_date,
    txn_type: t.txn_type,
    person_id: pId.get(t.personKey) ?? null,
    person_name: t.person_name,
    note: null,
    created_by: null,
    created_by_name: 'นำเข้าจากชีต',
  }));
  const createdTxns = await insertAll('borrow_txns', headerRows, 300, true);
  console.log(`   ✅ ใบยืม/คืน +${createdTxns.length}`);

  const txnId = new Map(
    createdTxns.map((t) => [`${t.txn_date}|${norm(t.person_name)}|${t.txn_type}`, t.id])
  );

  /* ทุกแถวต้องมี key ชุดเดียวกัน ไม่งั้น batch insert เจอ PGRST102 */
  const lineRows = [];
  for (const t of txns) {
    const id = txnId.get(`${t.txn_date}|${t.personKey}|${t.txn_type}`);
    if (!id) { console.log(`   ⚠️ หา txn ไม่เจอ: ${t.txn_date} ${t.person_name} ${t.txn_type}`); continue; }
    [...t.lines.values()].forEach((l, i) => {
      lineRows.push({
        txn_id: id,
        item_id: iId.get(l.itemKey) ?? null,
        item_name: l.item_name,
        price: 0,
        qty: l.qty,
        line_no: i + 1,
      });
    });
  }
  await insertAll('borrow_txn_lines', lineRows, 500);
  console.log(`   ✅ บรรทัดสินค้า +${lineRows.length}`);

  console.log('\n🎉 นำเข้าเรียบร้อย — เปิดหน้า ยืม / คืน สินค้า เพื่อตรวจสอบ');
  console.log('   ราคายังเป็น 0 ทุกตัว → กรอกที่ ⚙️ จัดการสินค้า แล้วรายงานจะคิดมูลค่าให้เอง');
})().catch((e) => {
  console.error('\n❌ ล้มเหลว:', e.message);
  process.exit(1);
});
