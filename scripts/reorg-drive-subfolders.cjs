/**
 * reorg-drive-subfolders.cjs — ย้ายไฟล์เก่าใน Drive root (uploads/) เข้า subfolder ตาม bucket
 * ────────────────────────────────────────────────────────────
 * หลังเปลี่ยนชื่อโฟลเดอร์ product-images → uploads แล้ว ไฟล์เก่า ~205 ใบ
 * ยังอยู่ root · สคริปต์นี้ย้ายเข้า subfolder ตาม prefix ของชื่อไฟล์:
 *   products/... , product-images/...  → subfolder "product-images"
 *   event-files/...                    → subfolder "event-files"
 *
 * ปลอดภัย: move (addParents/removeParents) ไม่เปลี่ยน file id → URL /drive/file/{id} เดิมใช้ได้ต่อ
 *   DRY_RUN=1 = แสดงแผนอย่างเดียว ไม่ย้าย
 *
 * รัน:
 *   DRY_RUN=1 node scripts/reorg-drive-subfolders.cjs   # ดูแผน + เทสสิทธิ์
 *   node scripts/reorg-drive-subfolders.cjs             # ย้ายจริง
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
const DRY_RUN = process.env.DRY_RUN === '1';

const FOLDER = 'application/vnd.google-apps.folder';

/* map prefix ชื่อไฟล์ → subfolder ปลายทาง */
function bucketOf(name) {
  if (name.startsWith('event-files/')) return 'event-files';
  if (name.startsWith('products/') || name.startsWith('product-images/')) return 'product-images';
  return null; // ไม่รู้จัก → ข้าม
}

async function main() {
  if (!drive.isConfigured()) { console.error('❌ Drive ยังไม่ตั้งค่า (env ไม่ครบ)'); process.exit(1); }
  console.log(`\n🗂️  Reorg Drive → subfolders  ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}\n`);

  const items = await drive.listFolder(drive.ROOT_FOLDER_ID);
  const files = items.filter(f => f.mimeType !== FOLDER);   // ข้าม subfolder เอง
  console.log(`พบไฟล์ที่ root: ${files.length} (ข้ามโฟลเดอร์ย่อย ${items.length - files.length})\n`);

  const plan = { 'product-images': 0, 'event-files': 0 };
  const unknown = [];
  for (const f of files) {
    const b = bucketOf(f.name || '');
    if (!b) { unknown.push(f.name); continue; }
    plan[b]++;
  }
  console.log('แผนย้าย:');
  console.log(`   → product-images : ${plan['product-images']}`);
  console.log(`   → event-files    : ${plan['event-files']}`);
  if (unknown.length) console.log(`   ⚠️ ไม่รู้จัก prefix (ข้าม): ${unknown.length} — ${unknown.slice(0, 5).join(', ')}`);
  console.log('');

  if (DRY_RUN) { console.log('[dry] ไม่ย้าย — เอา DRY_RUN ออกเพื่อย้ายจริง\n'); return; }

  let moved = 0, failed = 0, first = true;
  for (const f of files) {
    const b = bucketOf(f.name || '');
    if (!b) continue;
    const fromParent = (f.parents && f.parents[0]) || drive.ROOT_FOLDER_ID;
    try {
      const r = await drive.moveFile(f.id, b, fromParent);
      if (r.ok || r.status === 304) { moved++; }
      else {
        failed++;
        if (first) { // เทสสิทธิ์จากไฟล์แรก
          console.error(`\n❌ move ไม่สำเร็จ (status ${r.status}) — Content manager อาจย้ายไม่ได้`);
          console.error('   ทางแก้: เปลี่ยน service account เป็น "ผู้จัดการ (Manager)" ใน Manage members ของ Shared Drive แล้วรันใหม่\n');
          process.exit(1);
        }
      }
    } catch (e) { failed++; console.warn(`  ⚠️ ${f.name}: ${e.message}`); }
    first = false;
    if (moved % 25 === 0 && moved) console.log(`  moved ${moved}...`);
  }

  console.log(`\n──────── สรุป ────────`);
  console.log(`  ย้ายสำเร็จ : ${moved}`);
  console.log(`  ล้มเหลว   : ${failed}`);
  console.log(`  ข้าม unknown: ${unknown.length}`);
  console.log('──────────────────────');
  console.log('ℹ️ file id ไม่เปลี่ยน → URL /drive/file/{id} เดิมยังใช้ได้ทั้งหมด\n');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
