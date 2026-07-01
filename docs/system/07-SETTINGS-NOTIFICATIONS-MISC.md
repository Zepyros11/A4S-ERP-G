# 07 — Settings, Permissions, Notifications, Work Plan & Misc

> [modules/settings/](../../modules/settings/) (~26), [modules/notifications/](../../modules/notifications/), [modules/work-plan/](../../modules/work-plan/), [modules/manual/](../../modules/manual/), [modules/dev-tool/](../../modules/dev-tool/), [modules/dashboard/](../../modules/dashboard/), [modules/account/](../../modules/account/), [modules/report/](../../modules/report/)
> ตารางหลัก: ดู [02-DATABASE.md](02-DATABASE.md) §2, §9, §12, §14

---

## 1. Settings — ผู้ใช้ / Role / Permission

| ไฟล์ | หน้าที่ | ตาราง |
|------|---------|-------|
| `settings.html/.js` | Supabase URL/Key, prefix (PO/SO/REQ), test connection | localStorage |
| `company-settings.html/.js` | ข้อมูลบริษัท (ชื่อ, โลโก้ → app_settings.company_logo_url) | `app_settings` |
| `users.html/.js` | CRUD user + assign role (multi-slot) + department + country; **CRUD departments ในโมดัล** | `users`, `role_configs`, `departments`, `countries` |
| `roles.html/.js` | จัดการ role + permission tree + เลือก landing page ต่อ role | `role_configs` |
| `db_viewer.html` | viewer ตาราง DB (admin debug) | all (read) |

### Permission System (3-level)
1. **Global:** `role_configs` (role_key, permissions JSONB[], landing_path)
2. **Module:** `data-perm="key"` บน DOM element
3. **Runtime:** `AuthZ.applyDomPerms()` ซ่อน/ปิด (ดู [01-ARCHITECTURE.md](01-ARCHITECTURE.md) §3)

- **users:** มี `full_name` + `roles` JSONB (multi-role) — **ไม่มี** first_name/last_name (login select=*)
- **ADMIN = all-access** (โมดูลใหม่โผล่เองไม่ต้องติ๊ก)
- **Department filter:** กรอง "user ในแผนก X" ใช้ role หลัก (slot 1) ที่ key/label ขึ้นต้นด้วยชื่อแผนก (ไม่ใช่ permission)
- `departments` ไม่ใช่ FK (users.department = dept_code)

---

## 2. Notifications — LINE + กระดิ่ง (แยกกัน)

> ⚠️ 2 ระบบแยกขาด: **LINE** (`notification_rules` → multicast) และ **กระดิ่ง in-app** (`bell_notification_rules` → `user_notifications`)

### LINE notifications (settings)
| ไฟล์ | หน้าที่ | ตาราง |
|------|---------|-------|
| `notification-rules.html/.js` | กฎแจ้งเตือน LINE (trigger → target → channel → template + schedule) | `notification_rules`, `notification_triggers` |
| `line-templates.html/.js` | ตอบกลับอัตโนมัติ LINE | `line_reply_templates`, `line_channels` |
| `staff-messaging.html/.js` | ส่งข้อความพนักงานเป็นกลุ่ม | `users`, `line_channels` |
| `staff-groups.html/.js` | กลุ่มพนักงาน (สำหรับ target) | `staff_groups` / notification_groups |

### กระดิ่ง (Bell)
| ไฟล์ | หน้าที่ | ตาราง |
|------|---------|-------|
| `bell-rules.html/.js` | กฎแจ้งเตือนกระดิ่ง | `bell_notification_rules` |
| `bell-triggers.html/.js` | เหตุการณ์ trigger | `notification_triggers` |
| `notifications/notifications.html/.js` | inbox กระดิ่ง (topbar) — polling 30s + เสียง + filter | `user_notifications` |

- กระดิ่งอยู่ topbar; cascade-delete; trigger เช่น event.confirmed, booking.approved, ibd.complaint.created
- ส่งผ่าน proxy `/bell/notify`, `/ibd/notify`, cron `/cron/notifications` (รายละเอียดใน [08](08-BACKEND-AUTOMATION.md))
- `notify.js` (`Notify.evaluateRules`, `Notify.notifyBell`) — fire-and-forget

---

## 3. Work Plan — [modules/work-plan/](../../modules/work-plan/)
- `work-plan-list.html/.js` (+ `work-plan-api.js`) — ตาราง spreadsheet ต่อ scope/dept/year + autosave + JSONB columns/rows
- scope: **event / cs** (Trip ลบแล้ว 2026-05-01); dept สีต่อ scope; place autocomplete; duration chips
- เปิดจาก events-list (`event_id`) → auto-create plan
- **ตาราง:** `work_departments`, `work_plans`, `work_plan_rows`, `places`

---

## 4. Manual — [modules/manual/](../../modules/manual/)
- `manual-list.html/.js` (+ api/edit/view) — คู่มือแบบ chapter → page, block-based (JSONB), is_published, reading_minutes
- **ตาราง:** `manual_chapters`, `manual_pages`

---

## 5. Dev Tool — [modules/dev-tool/](../../modules/dev-tool/)
| ไฟล์ | หน้าที่ | ตาราง |
|------|---------|-------|
| `automation.html/.js` | จัดการงาน sync (web automation) + trigger GitHub Actions + log | `automation_tasks`, `sync_log` |
| `wizard.html/.js` | Step Wizard (Phase 1 UI เสร็จ, รอ Phase 2 script generator — paused) | `automation_steps` |
| `settings.html/.js` | ตั้งค่า automation | localStorage |
| `autocheck.html/.js` | System Health Check (scan ตาราง/คอลัมน์/permission) | all (read) |
| `test-members.html/.js` | gen member ทดสอบ (mock) | `test_members`/`member_persons` |
| (sidebar) Component Library | `docs/templates/component-library.html` | — |

---

## 6. Dashboard / Account / Report
- `dashboard/dashboard.html/.js` — ภาพรวม KPI (read หลายตาราง)
- `account/account.html/.js` — โปรไฟล์ + เปลี่ยนรหัส + session
- `report/reports.html/.js` — รายงาน Stock (query builder + export); ดู template ที่ `docs/templates/REPORT-MODULE-TEMPLATE.md`
