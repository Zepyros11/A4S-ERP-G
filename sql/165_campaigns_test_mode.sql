-- Migration 165: โหมดทดสอบ (test_mode) สำหรับ campaign
-- เปิดเพื่อให้หน้า public register เปิดรับลงทะเบียนได้ทุกเวลา
-- (ข้ามการเช็คช่วงเวลากิจกรรม / reg_open / ENDED) ใช้ทดสอบก่อนเริ่มหรือหลังจบ
-- ต้องรันมือใน Supabase SQL editor
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT false;
