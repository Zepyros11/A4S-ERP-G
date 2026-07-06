/**
 * migrate-images-to-drive.js — ย้ายรูป product-images จาก Supabase → Google Drive
 * ────────────────────────────────────────────────────────────
 * PILOT: bucket "product-images" (ตาราง product_images คอลัมน์ url)
 *
 * ทำอะไร (ต่อ 1 row):
 *   1. ดาวน์โหลดรูปจาก Supabase public URL
 *   2. อัปโหลดขึ้น Shared Drive (ผ่าน ../ai-proxy/drive.js)
 *   3. PATCH product_images.url → {PUBLIC_PROXY_URL}/drive/file/{id}
 *
 * ปลอดภัย/idempotent:
 *   - ข้าม row ที่ url ชี้ /drive/file/ อยู่แล้ว (รันซ้ำได้)
 *   - DRY_RUN=1 = แสดงอย่างเดียว ไม่เขียนอะไร
 *   - ของเก่าใน Supabase ไม่ถูกลบ (rollback ได้ด้วยการ restore url เดิม)
 *
 * รัน:
 *   DRY_RUN=1 node scripts/migrate-images-to-drive.js      # ลองก่อน
 *   node scripts/migrate-images-to-drive.js                # ย้ายจริง
 *
 * Env ที่ต้องมี (โหลดจาก ai-proxy/.env อัตโนมัติ ถ้ามี):
 *   SUPABASE_URL / SB_URL, SUPABASE_SERVICE_KEY / SB_SERVICE_KEY
 *   GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GDRIVE_FOLDER_ID, PUBLIC_PROXY_URL
 */

const fs   = require('fs');
const path = require('path');

/* ── โหลด ai-proxy/.env (ใช้ credential ชุดเดียวกับ proxy) ก่อน require drive.js ── */
const proxyEnv = path.join(__dirname, '..', 'ai-proxy', '.env');
if (fs.existsSync(proxyEnv)) {
  fs.readFileSync(proxyEnv, 'utf8').split('\n').forEach((line) => {
    const [k, ...rest] = line.split('=');
    if (k && rest.length && !process.env[k.trim()]) {
      process.env[k.trim()] = rest.join('=').trim();
    }
  });
}

const drive = require('../ai-proxy/drive');

const SB_URL  = (process.env.SUPABASE_URL || process.env.SB_URL || '').replace(/\/+$/, '');
const SB_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SB_SERVICE_KEY || '';
const PROXY   = (process.env.PUBLIC_PROXY_URL || '').replace(/\/+$/, '');
const DRY_RUN = process.env.DRY_RUN === '1';
const CONCURRENCY = 3;   // เบามือกับ Drive API + Supabase egress

function assertEnv() {
  const missing = [];
  if (!SB_URL) missing.push('SUPABASE_URL/SB_URL');
  if (!SB_KEY) missing.push('SUPABASE_SERVICE_KEY/SB_SERVICE_KEY');
  if (!PROXY)  missing.push('PUBLIC_PROXY_URL');
  if (!drive.isConfigured()) missing.push('GOOGLE_SA_EMAIL/GOOGLE_SA_PRIVATE_KEY/GDRIVE_FOLDER_ID');
  if (missing.length) {
    console.error('❌ env ไม่ครบ:', missing.join(', '));
    process.exit(1);
  }
}

async function sbGet(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`SB GET ${table} → ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

async function sbPatch(table, query, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SB PATCH ${table} → ${res.status}: ${await res.text().catch(() => '')}`);
}

function fileNameFromUrl(u) {
  try {
    const p = new URL(u).pathname;               // /storage/v1/object/public/product-images/products/xxx.jpg
    const base = p.split('/').pop() || 'image.jpg';
    return `products/${decodeURIComponent(base)}`;
  } catch { return `products/img_${Date.now()}.jpg`; }
}

async function migrateRow(row, stats) {
  const url = row.url || '';
  if (!url) { stats.skipped++; return; }
  if (url.includes('/drive/file/')) { stats.already++; return; }   // ย้ายไปแล้ว

  // 1) ดาวน์โหลดจาก Supabase
  const dl = await fetch(url);
  if (!dl.ok) {
    console.warn(`  ⚠️  [${row.image_id}] download ${dl.status} — ข้าม: ${url.slice(0, 80)}`);
    stats.failed++; return;
  }
  const contentType = dl.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await dl.arrayBuffer());
  const name = fileNameFromUrl(url);

  if (DRY_RUN) {
    console.log(`  [dry] image_id=${row.image_id} → ${name} (${(buffer.length / 1024).toFixed(0)}KB)`);
    stats.migrated++; return;
  }

  // 2) อัปโหลดขึ้น Drive
  const { id } = await drive.uploadFile(name, contentType, buffer, 'product-images');
  const newUrl = `${PROXY}/drive/file/${id}`;

  // 3) rewrite url ใน DB
  await sbPatch('product_images', `image_id=eq.${encodeURIComponent(row.image_id)}`, { url: newUrl });
  console.log(`  ✅ image_id=${row.image_id} → ${newUrl}`);
  stats.migrated++;
}

async function runPool(items, worker, concurrency) {
  let i = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx]); }
      catch (e) { console.warn(`  ⚠️  row error: ${e.message}`); }
    }
  });
  await Promise.all(runners);
}

async function main() {
  assertEnv();
  console.log(`\n🚀 Migrate product-images → Drive  ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
  console.log(`   Supabase: ${SB_URL}`);
  console.log(`   Proxy   : ${PROXY}\n`);

  const rows = await sbGet('product_images', 'select=image_id,url&order=image_id.asc');
  console.log(`พบ ${rows.length} รูปในตาราง product_images\n`);

  const stats = { migrated: 0, already: 0, skipped: 0, failed: 0 };
  await runPool(rows, (row) => migrateRow(row, stats), CONCURRENCY);

  console.log('\n──────── สรุป ────────');
  console.log(`  ย้ายสำเร็จ : ${stats.migrated}${DRY_RUN ? ' (dry)' : ''}`);
  console.log(`  ย้ายแล้วก่อนหน้า: ${stats.already}`);
  console.log(`  ข้าม (ไม่มี url): ${stats.skipped}`);
  console.log(`  ล้มเหลว   : ${stats.failed}`);
  console.log('──────────────────────\n');
  if (!DRY_RUN && stats.migrated > 0) {
    console.log('ℹ️  ของเก่าใน Supabase ยังอยู่ (ยังไม่ลบ) — ตรวจหน้า catalog ให้ครบก่อนค่อยลบ bucket');
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
