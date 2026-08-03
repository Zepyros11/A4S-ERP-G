/* ============================================================
   import-delivery.js — นำเข้าชีต OrderTracking_KERRY + Line_OA
   เข้าตาราง delivery_customers / delivery_orders (Supabase)

   ใช้: node scripts/import-delivery-tracking.js            → dry-run (ไม่เขียนจริง)
        node scripts/import-delivery-tracking.js --apply    → เขียนลงฐานข้อมูล

   รันจริงครั้งแรก 2026-08-02 → ลูกค้า 854 · ใบส่ง 3,298 (ชีต ม.ค.2025–ก.พ.2026)
   ⚠️ รันซ้ำ = ข้อมูลซ้ำ (ไม่มี upsert) — ถ้าจะ import ใหม่ต้องล้างตารางก่อน:
      DELETE FROM delivery_orders; DELETE FROM delivery_customers;

   กติกาการแปลงข้อมูล:
     • master (delivery_customers) = "บัญชี LINE ที่สั่ง" (คอลัมน์ Line ID) ไม่ใช่ชื่อผู้รับ
       เพราะลิงก์ Line OA ผูกกับบัญชี · ชื่อผู้รับเก็บเป็น snapshot ในแต่ละใบส่ง
     • ปี พ.ศ. (2568) แปลงเป็น ค.ศ. อัตโนมัติ · วันที่เป็น D/M/YYYY
     • ชื่อ CS ในชีตรวมรูปแบบซ้ำ (พี่เหน่ง→เหน่ง, แจ๊ค→แจ็ค, stock→สต๊อก) + map เป็น users.user_id เท่าที่ตรง
     • courier เดาจาก prefix เลขพัสดุ (ESCH→KEX, TH/LP→FLASH, OSA→JT)
   ============================================================ */
const fs = require('fs');
const path = require('path');

const SB = 'https://egnwfmdsqtxxyhyajnnu.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnbndmbWRzcXR4eHloeWFqbm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTI4ODEsImV4cCI6MjEwMDYyODg4MX0.5R47xGBQY0Nr92AP30kSNgpYkZ6pV-al9-JGxsimifc';
const APPLY = process.argv.includes('--apply');

const DIR = 'C:/Users/hoppo/Downloads';
const F_ORDER = path.join(DIR, 'Stock_Data - 🚚OrderTracking_KERRY.csv');
const F_OA = path.join(DIR, 'Stock_Data - 🟩Line_OA.csv');

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

/* ── วันที่ D/M/YYYY (รองรับปี พ.ศ.) → ISO ── */
function toISO(s) {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  let year = Number(y);
  if (year > 2400) year -= 543;                 // 2568 → 2025
  const dd = Number(d), mm = Number(mo);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function toMoney(s) {
  const t = clean(s).replace(/[^\d.]/g, '').replace(/^\.+/, '');   // ".30.00" → "30.00"
  const parts = t.split('.');
  const v = parts.length > 2 ? Number(parts[0] + '.' + parts[1]) : Number(t);
  return isFinite(v) ? v : 0;
}

/* ── CS ในชีต → users.user_id ── */
const CS_ALIAS = {
  'เหน่ง': 'เหน่ง', 'พี่เหน่ง': 'เหน่ง',
  'เกษ': 'เกษ', 'พี่เกษ': 'เกษ',
  'ตาน้ำ': 'ตาน้ำ', 'น้ำ': 'ตาน้ำ',
  'เอิง': 'เอิง',
  'แคท': 'แคท', 'เเคท': 'แคท',
  'ปิงปอง': 'ปิงปอง',
  'ภพ': 'ภพ',
  'พี่มุก': 'มุก',
  'พี่ปุ้ย': 'ปุ้ย', 'ปุ้ย': 'ปุ้ย',
  'อ.เบย์': 'เบย์',
  'แจ๊ค': 'แจ็ค', 'แจ็ค': 'แจ็ค',
  'stock': 'สต๊อก', 'สต๊อก': 'สต๊อก',
};
const CS_USER = {                                 // ชื่อย่อ → users.user_id
  'เหน่ง': 25, 'เกษ': 18, 'ตาน้ำ': 6, 'เอิง': 19,
  'แคท': 7, 'ปิงปอง': 27, 'ภพ': 2, 'มุก': 13, 'ปุ้ย': 10, 'เบย์': 8,
};
function csOf(raw) {
  const t = clean(raw);
  if (!t || t === '-') return { name: null, id: null };
  const key = CS_ALIAS[t] || CS_ALIAS[t.toLowerCase()] || t;
  return { name: key, id: CS_USER[key] ?? null };
}

/* ── โหลด Line OA ── */
const oaRows = parseCSV(fs.readFileSync(F_OA, 'utf8')).slice(2)
  .filter(r => clean(r[0]));
const oaMap = new Map();                          // norm(ชื่อ Line) → { name, url }
for (const r of oaRows) {
  const name = clean(r[0]);
  const url = clean(r[1]);
  oaMap.set(norm(name), { name, url: /^https?:\/\//i.test(url) ? url : null });
}

/* ── โหลดใบส่ง ── */
const raw = parseCSV(fs.readFileSync(F_ORDER, 'utf8')).slice(2);
const SKIP_LINE = new Set(['', '-', 'no', 'none', '.', 'stock']);   // ไม่ใช่ชื่อบัญชี LINE

const seen = new Set();
const orders = [];
const stat = { noDate: 0, noName: 0, noTrack: 0, dup: 0 };

for (const r of raw) {
  const orderDate = toISO(r[0]);
  const name = clean(r[2]);
  const tracking = clean(r[3]);
  const price = clean(r[4]);
  if (!orderDate) { if (clean(r[0]) || name) stat.noDate++; continue; }
  if (!name) { stat.noName++; continue; }
  if (!tracking && !price) { stat.noTrack++; continue; }

  const key = r.map(clean).join('|');
  if (seen.has(key)) { stat.dup++; continue; }
  seen.add(key);

  const lineRaw = clean(r[5]);
  const lineKey = SKIP_LINE.has(norm(lineRaw)) ? null : norm(lineRaw);
  const cs = csOf(r[8]);

  orders.push({
    order_date: orderDate,
    ship_date: toISO(r[1]) || orderDate,
    cs_user_id: cs.id,
    cs_name: cs.name,
    customer_name: name,
    line_key: lineKey,
    line_id: lineKey ? lineRaw : null,
    province: clean(r[6]) || null,
    phone: clean(r[7]) || null,
    courier: /^ESCH/i.test(tracking) || !tracking ? 'KEX'
      : /^TH\d/i.test(tracking) ? 'FLASH'
        : /^OSA/i.test(tracking) ? 'JT'
          : /^LP\d/i.test(tracking) ? 'FLASH' : 'OTHER',
    tracking_no: tracking || null,
    shipping_cost: toMoney(price),
    track_sent: true,                    // ข้อมูลย้อนหลัง = ส่ง track ให้ลูกค้าไปแล้ว
    note: null,
  });
}

/* ── สร้าง master ลูกค้า (คีย์ = ชื่อบัญชี LINE) ── */
const cust = new Map();   // lineKey → { line_id, customer_name, province, phone, line_oa_url, _p:{}, _ph:{} }
function bump(o, k) { if (k) o[k] = (o[k] || 0) + 1; }
function top(o) { const e = Object.entries(o).sort((a, b) => b[1] - a[1]); return e.length ? e[0][0] : null; }

for (const o of orders) {
  if (!o.line_key) continue;
  if (!cust.has(o.line_key)) {
    cust.set(o.line_key, {
      line_id: o.line_id, customer_name: o.line_id,
      line_oa_url: oaMap.get(o.line_key)?.url || null,
      _p: {}, _ph: {}, _n: 0,
    });
  }
  const c = cust.get(o.line_key);
  c._n++; bump(c._p, o.province); bump(c._ph, o.phone);
}
/* ชื่อใน Line_OA ที่ยังไม่เคยมีใบส่ง — เก็บไว้ให้ลิงก์ OA ครบ */
for (const [k, v] of oaMap) {
  if (cust.has(k) || SKIP_LINE.has(k)) continue;
  cust.set(k, { line_id: v.name, customer_name: v.name, line_oa_url: v.url, _p: {}, _ph: {}, _n: 0 });
}

const customers = [...cust.entries()].map(([k, c]) => ({
  key: k,
  row: {
    line_id: c.line_id,
    customer_name: c.customer_name,
    province: top(c._p),
    phone: top(c._ph),
    line_oa_url: c.line_oa_url,
    member_code: null,
    note: null,
    is_active: true,
  },
}));

/* ── รายงาน ── */
console.log('── สรุปก่อนนำเข้า ──');
console.log('แถวในชีตทั้งหมด        :', raw.length);
console.log('  ข้าม (ไม่มีวันที่)     :', stat.noDate);
console.log('  ข้าม (ไม่มีชื่อลูกค้า) :', stat.noName);
console.log('  ข้าม (ไม่มี track+ราคา):', stat.noTrack);
console.log('  ข้าม (ซ้ำทั้งบรรทัด)   :', stat.dup);
console.log('รายการจัดส่งที่จะนำเข้า :', orders.length);
console.log('ลูกค้า (บัญชี LINE)     :', customers.length,
  '· มีลิงก์ OA', customers.filter(c => c.row.line_oa_url).length);
console.log('ใบส่งที่ไม่มี Line ID   :', orders.filter(o => !o.line_key).length);
const byCourier = {}; orders.forEach(o => byCourier[o.courier] = (byCourier[o.courier] || 0) + 1);
console.log('ขนส่ง:', JSON.stringify(byCourier));
const csCount = {}; orders.forEach(o => { const k = o.cs_name || '(ว่าง)'; csCount[k] = (csCount[k] || 0) + 1; });
console.log('CS:', Object.entries(csCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' | '));
console.log('ช่วงวันที่:', orders.reduce((a, o) => o.order_date < a ? o.order_date : a, '9999'),
  '→', orders.reduce((a, o) => o.order_date > a ? o.order_date : a, '0000'));
console.log('ค่าส่งรวม:', orders.reduce((s, o) => s + o.shipping_cost, 0).toLocaleString());
console.log('\nตัวอย่าง 3 รายการ:');
console.log(JSON.stringify(orders.slice(0, 3), null, 1));

if (!APPLY) { console.log('\n(dry-run — ยังไม่เขียนฐานข้อมูล · ใส่ --apply เพื่อเขียนจริง)'); return; }

/* ── เขียนจริง ── */
async function post(table, rows, prefer) {
  const res = await fetch(`${SB}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: prefer || 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table} ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

(async () => {
  console.log('\n── เริ่มนำเข้า ──');
  /* 1) ลูกค้า */
  const idOf = new Map();
  for (let i = 0; i < customers.length; i += 300) {
    const chunk = customers.slice(i, i + 300);
    const out = await post('delivery_customers', chunk.map(c => c.row), 'return=representation');
    out.forEach(row => idOf.set(norm(row.line_id), row.id));
    console.log(`  ลูกค้า ${Math.min(i + 300, customers.length)}/${customers.length}`);
  }
  /* 2) ใบส่ง */
  const rows = orders.map(o => ({
    order_date: o.order_date,
    ship_date: o.ship_date,
    cs_user_id: o.cs_user_id,
    cs_name: o.cs_name,
    customer_id: o.line_key ? (idOf.get(o.line_key) ?? null) : null,
    customer_name: o.customer_name,
    line_id: o.line_id,
    province: o.province,
    phone: o.phone,
    courier: o.courier,
    tracking_no: o.tracking_no,
    shipping_cost: o.shipping_cost,
    track_sent: o.track_sent,
    track_sent_at: null,
    note: o.note,
    created_by: null,
  }));
  for (let i = 0; i < rows.length; i += 400) {
    await post('delivery_orders', rows.slice(i, i + 400));
    console.log(`  ใบส่ง ${Math.min(i + 400, rows.length)}/${rows.length}`);
  }
  console.log('เสร็จแล้ว ✅');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
