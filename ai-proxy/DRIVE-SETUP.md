# Google Drive Storage — Setup Checklist

ย้ายรูปจาก Supabase Storage → Google Drive (Shared Drive) เพื่อลดค่า egress/storage
**Pilot: bucket `product-images` (รูปสินค้า)**

> โค้ดฝั่งระบบทำเสร็จแล้ว (`drive.js`, endpoints ใน `server.js`, `ImageCompressor.uploadToDrive`,
> flag ที่ `products-api.js`, migration script) — เหลือแค่ **ตั้งค่า Google + Render** ตามนี้

---

## A. Google Cloud + Shared Drive (ทำครั้งเดียว)

1. **สร้าง Google Cloud project** → https://console.cloud.google.com → New Project (เช่น `a4s-storage`)
2. **เปิด Drive API** → APIs & Services → Library → ค้น "Google Drive API" → **Enable**
3. **สร้าง Service Account** → IAM & Admin → Service Accounts → Create
   - ตั้งชื่อ เช่น `a4s-drive-uploader` → Create → ข้าม role → Done
   - คลิก service account → แท็บ **Keys** → Add Key → **JSON** → ดาวน์โหลดไฟล์ (เก็บลับ!)
   - จดค่า `client_email` (เช่น `a4s-drive-uploader@a4s-storage.iam.gserviceaccount.com`)
     และ `private_key` (ขึ้นต้น `-----BEGIN PRIVATE KEY-----`)
4. **สร้าง Shared Drive** (ต้องใช้ Google Workspace) → drive.google.com → Shared drives →
   New → เช่น `A4S-ERP-Images`
5. **เพิ่ม service account เป็นสมาชิก Shared Drive**
   - เปิด Shared Drive → Manage members → วาง `client_email` ของ service account →
     สิทธิ์ **Content manager** → Send
   - ⚠️ ข้อนี้สำคัญสุด — ถ้าลืม service account จะอัปโหลดไม่ได้ (403)
6. **สร้างโฟลเดอร์** ใน Shared Drive เช่น `product-images` → เปิดโฟลเดอร์ →
   คัดลอก **folder ID** จาก URL (`https://drive.google.com/drive/folders/<FOLDER_ID>`)

---

## B. ตั้ง Env vars ใน Render (dashboard → service `a4s-erp-proxy` → Environment)

| key | ค่า |
|-----|-----|
| `GOOGLE_SA_EMAIL` | `client_email` จากข้อ A3 |
| `GOOGLE_SA_PRIVATE_KEY` | `private_key` จาก JSON — **วางทั้งก้อนรวม `\n`** (Render เก็บ literal `\n` ได้ โค้ด unescape ให้เอง) |
| `GDRIVE_FOLDER_ID` | folder ID จากข้อ A6 |
| `DRIVE_UPLOAD_KEY` | สุ่มสตริงยาวๆ เช่น `openssl rand -hex 24` (กัน bot อัปมั่ว) |
| `PUBLIC_PROXY_URL` | `https://a4s-erp-proxy.onrender.com` |

Deploy ใหม่ (auto เมื่อ push หรือ Manual Deploy) แล้วเช็ค:
```
curl https://a4s-erp-proxy.onrender.com/drive/health
# → {"ok":true,"configured":true}
```

---

## C. เปิดใช้ฝั่ง frontend (เครื่องที่จะทดสอบ)

ตั้ง localStorage 2 ค่า (Console บนเว็บ ERP):
```js
localStorage.setItem('erp_drive_storage', '1');           // เปิด Drive mode (ปิด = กลับ Supabase)
localStorage.setItem('erp_drive_key', '<DRIVE_UPLOAD_KEY>'); // ค่าเดียวกับ Render
// erp_proxy_url ตั้งไว้อยู่แล้ว (LINE ใช้ร่วมกัน)
```
> **reversible**: ลบ `erp_drive_storage` = อัปโหลดกลับไป Supabase ทันที (ของที่ย้ายแล้วยังอ่านจาก Drive ได้)

---

## D. ย้ายรูปเก่า (migration)

```bash
# .env ใช้ ai-proxy/.env ชุดเดียวกับ proxy (ต้องมี SUPABASE_URL, SUPABASE_SERVICE_KEY,
# GOOGLE_SA_*, GDRIVE_FOLDER_ID, PUBLIC_PROXY_URL)

DRY_RUN=1 node scripts/migrate-images-to-drive.js   # ลองก่อน — ไม่เขียนอะไร
node scripts/migrate-images-to-drive.js             # ย้ายจริง (rewrite product_images.url)
```
- idempotent — รันซ้ำได้ (ข้าม url ที่เป็น `/drive/file/` แล้ว)
- ของเก่าใน Supabase **ไม่ถูกลบ** — เก็บไว้ rollback จนกว่าจะมั่นใจ

---

## E. ตรวจ + Cutover

1. เปิดหน้า **catalog** → รูปสินค้าต้องขึ้นครบ (ตอนนี้ src ชี้ `/drive/file/...`)
2. เพิ่มสินค้าใหม่ + อัปรูป → ต้องได้ url `/drive/file/...` และแสดงได้
3. เช็คลบสินค้า → รูปยังลบได้ (ปัจจุบันลบแค่ row DB; ลบไฟล์ Drive จริงเป็น Phase ถัดไป)
4. เมื่อครบทั้ง bucket + นิ่ง 2-3 วัน → ค่อยลบ bucket `product-images` ใน Supabase

---

## ⚠️ ข้อควรระวัง (คุยกันไว้ก่อน)

- **Render free = คอขวด**: รูปทุกใบวิ่งผ่าน Render (512MB, หลับ 15 นาที) แทน Supabase CDN
  → ถ้า pilot ช้า/ล่ม ให้พิจารณา upgrade Render (หรือ Cloudflare หน้า cache proxy)
- **ยังไม่ย้าย IBD (PII)**: passport/ใบร้องเรียน ยังอยู่ Supabase signed URL — เฟสหลัง
  ต้องมี access control ที่ proxy ก่อนย้าย
- **Serve endpoint ตอนนี้เป็น public** (เหมาะรูปสินค้า) — ห้ามเอาไปใช้กับไฟล์ลับตรงๆ
