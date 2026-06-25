-- ============================================================
-- เพิ่มคอลัมน์ line_chat_id ให้ members
--
-- Why:
--   chat.line.biz (OA Manager) ใช้ user id "คนละชุด" กับ line_user_id
--   (Messaging API) ที่ webhook เก็บ → deep-link แชท 1:1 ด้วย line_user_id
--   จะ 404 เสมอ และ LINE ไม่มี API แปลงข้ามให้
--
--   line_user_id  = ใช้ "ส่งข้อความ" (push) — ห้ามแก้ทับ ไม่งั้นส่ง LINE พัง
--   line_chat_id  = id ที่ก๊อปจาก URL chat.line.biz (.../chat/<ID>) — ใช้เปิดแชทตรงคน
--
-- วิธีกรอกค่า (ทำมือเฉพาะคนที่ต้องการ):
--   1) เปิดแชทคนนั้นใน A4S_Lyra OA Manager
--   2) ก๊อปส่วนท้าย URL: chat.line.biz/<acct>/chat/<ID>  ← เอา <ID>
--   3) วางลง members.line_chat_id ของ member_code นั้น (Supabase Table editor)
--
-- ⚠️ ถ้า LINE migrate channel อีก id อาจเปลี่ยน ต้องกรอกใหม่
-- ============================================================

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS line_chat_id TEXT;

COMMENT ON COLUMN members.line_chat_id IS
  'chat.line.biz user id (จาก URL OA Manager) สำหรับ deep-link แชท 1:1 · คนละค่ากับ line_user_id (ห้ามสับ)';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  รัน SQL นี้ก่อน แล้วค่อยรีเฟรชหน้า campaign-detail
-- ============================================================
