# Fix: กฎแจ้งเตือน LINE แบบตั้งเวลา (cron) ไม่ยิง

- **วันที่:** 2026-07-10
- **Commit:** `8e19a61`
- **ไฟล์:** `ai-proxy/server.js`
- **สถานะ:** แก้แล้ว + ยืนยันข้อความเข้ากลุ่มจริง

## อาการ

กฎ 2 อันนี้ไม่ทำงาน (ไม่ส่งเข้ากลุ่ม LINE `BRE ประสานงาน`):

- **แจ้ง Event ล่วงหน้า 1 วัน** — trigger `event.scheduled` (anchor `event_date`, ก่อน 1d · 09:00)
- **แจ้งจองห้อง ล่วงหน้า 1 วัน** — trigger `booking.scheduled` (anchor `booking_date`, ก่อน 1d · 09:00)

ขณะที่กฎแบบ event-driven (เช่น "แจ้งทีม: จองห้องประชุมอนุมัติแล้ว") ที่ยิงเข้ากลุ่ม/channel เดียวกัน **ทำงานปกติ**

## สาเหตุที่แท้จริง

**ด่านเวลาแบบสองฝั่ง (strict window) + GitHub Actions cron มาสาย**

- cron notifications เช็คเวลาด้วย `_timeInWindow` ที่ต้องให้ `now ∈ [09:00, 09:15)` **เป๊ะทั้งสองฝั่ง**
- แต่ GitHub Actions scheduled cron (`*/15 * * * *`) มักดีเลย์ โดยเฉพาะช่วงต้นชั่วโมง (09:00) หลายครั้งสาย 15–40 นาที
- พอไม่มี tick ไหนตกในช่วง 15 นาทีนั้นเลย → กฎถูกข้ามทั้งวัน แบบเงียบ ๆ (ไม่ log ด้วย เพราะ return ก่อนถึงขั้นส่ง)

### สิ่งที่ทำให้วิเคราะห์พลาดตอนแรก

- คิดว่าเป็นปัญหา token/channel — cron ใช้ `LINE_CHANNEL_TOKEN` (คอมเมนต์ในโค้ดติดป้าย "Bot-Assistant") ไม่ใช่ token ของ channel `A4S Lyra`
- **แต่จริง ๆ `LINE_CHANNEL_TOKEN` = token ของ A4S_Lyra** — พิสูจน์จากฟีเจอร์ line-promote (`/cron/line-promote`) ที่ใช้ `_pushLineMessages()` ตัวเดียวกัน + token เดียวกัน และส่งเข้ากลุ่มได้สำเร็จ
- line-promote ไม่เจอปัญหานี้เพราะมันส่ง post ที่ `scheduled_at <= now + 15min` (**ไม่มีขอบล่าง → ส่ง overdue ได้**) จึงทนดีเลย์ของ cron

## วิธีแก้

เปลี่ยนจาก strict window เป็น **one-sided window** — ยิงเมื่อ `now >= เวลาที่ตั้ง` ของวันนั้น แล้วอาศัย `_checkDedupe` (มีอยู่แล้ว: กันซ้ำต่อ rule+record ภายใน 24 ชม.) กันส่งซ้ำ

```js
// เดิม: _timeInWindow — ต้องอยู่ใน [wantMin, wantMin+15) เป๊ะ
// ใหม่:
function _timeReached(wantTimeStr, now) {
  if (!wantTimeStr) return false;
  const m = String(wantTimeStr).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return false;
  const wantMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return now.totalMinutes >= wantMin;
}
```

ปรับ 3 anchor: `event_date`, `booking_date`, `daily_summary`
(ไม่แตะ `booking_start_time` เพราะมัน logic นาทีจริง "ก่อนเริ่ม X นาที")

### พฤติกรรมหลังแก้

- cron มาสายแค่ไหนก็ยังส่ง — tick แรกหลังเวลาที่ตั้งจะยิง
- tick อื่นในวันเดียวกัน → `_checkDedupe` บล็อก (เช็ค `status='sent'` ภายใน 24 ชม.)
- ถ้าส่ง fail → retry รอบถัดไป (เพราะ dedupe เช็คเฉพาะ 'sent')
- **Trade-off:** ถ้า cron ล่มยาวทั้งเช้า ข้อความ "เตือน 09:00" อาจไปถึงสายกว่านั้น — แต่ดีกว่าไม่ส่งเลย

## Deploy & Verify

- **Deploy:** ai-proxy รันบน Render (`a4s-erp-proxy.onrender.com`) — push ขึ้น `origin/main` แล้ว Render auto-deploy
- **Verify:** ตั้งเวลากฎเป็น "เวลาปัจจุบันลบ ~2 นาที" ชั่วคราว → GitHub Actions → "Scheduled LINE Notifications" → Run workflow → เช็ค response `details[]` (`sent > 0`) และข้อความเข้ากลุ่ม → ตั้งเวลากลับตามเดิม
- ✅ ยืนยันแล้ว 2026-07-10: ข้อความแจ้งจองห้อง + แจ้งกิจกรรมของวัน 11/07/2026 เข้ากลุ่ม BRE ประสานงาน สำเร็จ

## เกี่ยวข้อง / จุดที่ควรรู้

- ด่านเวลาเดิมไม่ log ตอน skip → ถ้ากฎ scheduled เงียบ ให้ดูว่า cron ยิงตรงเวลาไหม ไม่ใช่แค่ดู `notification_log`
- คอมเมนต์ `LINE_CHANNEL_TOKEN = "Bot-Assistant"` ใน `server.js` ทำให้เข้าใจผิด — จริง ๆ เป็น token ของ A4S_Lyra (ควรแก้คอมเมนต์ในอนาคต)
