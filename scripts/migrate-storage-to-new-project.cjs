/**
 * migrate-storage-to-new-project.cjs — ก๊อป Supabase Storage ข้าม project
 * ────────────────────────────────────────────────────────────
 * ใช้ตอนย้ายไปบัญชีบริษัท (ดู docs/MIGRATION-2026-08.md Phase 2.5)
 * pg_dump/pg_restore ย้ายเฉพาะ schema public — ไม่แตะ storage.buckets/objects
 * สคริปต์นี้จึง (1) สร้าง bucket ให้ตรงต้นทาง (2) ดาวน์โหลด+อัปโหลดไฟล์ path เดิมเป๊ะ
 *
 * idempotent — รันซ้ำได้ (bucket ที่มีแล้ว = ข้าม · ไฟล์ที่มีแล้ว = ข้าม เว้นแต่ตั้ง OVERWRITE=1)
 *
 * env (บังคับ):
 *   SRC_URL, SRC_SERVICE_KEY   project ต้นทาง
 *   DST_URL, DST_SERVICE_KEY   project ปลายทาง
 * env (optional):
 *   DRY_RUN=1     แสดงอย่างเดียว ไม่เขียน
 *   OVERWRITE=1   ทับไฟล์ที่ปลายทางมีอยู่แล้ว
 *
 * รัน:  node scripts/migrate-storage-to-new-project.cjs
 */

const SRC = (process.env.SRC_URL || '').replace(/\/+$/, '');
const SRC_KEY = process.env.SRC_SERVICE_KEY || '';
const DST = (process.env.DST_URL || '').replace(/\/+$/, '');
const DST_KEY = process.env.DST_SERVICE_KEY || '';
const DRY = process.env.DRY_RUN === '1';
const OVERWRITE = process.env.OVERWRITE === '1';

if (!SRC || !SRC_KEY || !DST || !DST_KEY) {
  console.error('❌ ต้องมี SRC_URL, SRC_SERVICE_KEY, DST_URL, DST_SERVICE_KEY');
  process.exit(1);
}
const H = (k) => ({ apikey: k, Authorization: `Bearer ${k}` });

/* ── list ทุกไฟล์ใน bucket (recursive · storage list ไม่ recursive เอง) ── */
async function listAll(base, key, bucket, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(`${base}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...H(key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error(`list ${bucket}/${prefix} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    if (!rows.length) break;
    for (const it of rows) {
      const path = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) out.push(...(await listAll(base, key, bucket, path))); // โฟลเดอร์ → ลงลึก
      else out.push({ path, size: it.metadata?.size ?? 0, mime: it.metadata?.mimetype || 'application/octet-stream' });
    }
    if (rows.length < 100) break;
  }
  return out;
}

(async () => {
  /* ── 1. bucket ── */
  const bRes = await fetch(`${SRC}/storage/v1/bucket`, { headers: H(SRC_KEY) });
  if (!bRes.ok) throw new Error(`list buckets ${bRes.status}: ${(await bRes.text()).slice(0, 200)}`);
  const buckets = await bRes.json();
  const dstExisting = new Set(
    (await (await fetch(`${DST}/storage/v1/bucket`, { headers: H(DST_KEY) })).json()).map((b) => b.id)
  );

  console.log(`📦 bucket ต้นทาง ${buckets.length} อัน\n`);
  for (const b of buckets) {
    if (dstExisting.has(b.id)) { console.log(`   • ${b.id} — มีแล้ว ข้าม`); continue; }
    if (DRY) { console.log(`   • ${b.id} — [DRY] จะสร้าง (public=${b.public})`); continue; }
    const r = await fetch(`${DST}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...H(DST_KEY), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: b.id, name: b.id, public: b.public,
        file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types,
      }),
    });
    console.log(`   ${r.ok ? '✅' : '❌'} สร้าง ${b.id} (public=${b.public}) ${r.ok ? '' : await r.text()}`);
  }

  /* ── 2. ไฟล์ ── */
  let ok = 0, skip = 0, fail = 0;
  for (const b of buckets) {
    const files = await listAll(SRC, SRC_KEY, b.id);
    console.log(`\n📁 ${b.id} — ${files.length} ไฟล์`);
    const done = new Set((await listAll(DST, DST_KEY, b.id).catch(() => [])).map((f) => f.path));

    for (const f of files) {
      if (done.has(f.path) && !OVERWRITE) { skip++; continue; }
      if (DRY) { console.log(`   [DRY] ${f.path} (${f.size}B)`); ok++; continue; }
      try {
        const dl = await fetch(`${SRC}/storage/v1/object/${b.id}/${encodeURI(f.path)}`, { headers: H(SRC_KEY) });
        if (!dl.ok) throw new Error(`download ${dl.status}`);
        const buf = Buffer.from(await dl.arrayBuffer());

        const up = await fetch(`${DST}/storage/v1/object/${b.id}/${encodeURI(f.path)}`, {
          method: 'POST',
          headers: { ...H(DST_KEY), 'Content-Type': f.mime, 'x-upsert': 'true' },
          body: buf,
        });
        if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 150)}`);
        ok++;
        console.log(`   ✅ ${f.path} (${buf.length}B)`);
      } catch (e) {
        fail++;
        console.log(`   ❌ ${f.path} — ${e.message}`);
      }
    }
  }

  console.log(`\n── สรุป: ก๊อป ${ok} · ข้าม(มีแล้ว) ${skip} · พลาด ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
