-- ============================================================
-- Migration 011: Add steps JSONB column to automation_tasks
--   Stores the step wizard flow configuration
-- ============================================================

ALTER TABLE automation_tasks ADD COLUMN IF NOT EXISTS steps JSONB DEFAULT '[]';

-- Seed default steps for "Export All Member" task
UPDATE automation_tasks
SET steps = '[
  {
    "id": "step-1",
    "type": "login",
    "label": "Login answerforsuccess",
    "config": {
      "url": "https://www.answerforsuccess.com/branch/index.php",
      "username_selector": "#tbx-user",
      "password_selector": "#tbx-pwd",
      "submit_selector": "#btn-logins",
      "popup_selector": "button.swal-button--confirm",
      "wait_after": 2000
    }
  },
  {
    "id": "step-2",
    "type": "navigate",
    "label": "ไปหน้ารายชื่อสมาชิก",
    "config": {
      "url": "https://www.answerforsuccess.com/branch/index.php?sessiontab=1&sub=1&typereport=1",
      "wait": "networkidle",
      "timeout": 20000
    }
  },
  {
    "id": "step-3",
    "type": "click",
    "label": "เปิด Advance Search",
    "config": {
      "selector": "a[href=\"#collapseOne\"]",
      "use_js_click": true,
      "wait_after": 1500
    }
  },
  {
    "id": "step-4",
    "type": "fill_form",
    "label": "กรอกวันที่ + ค้นหา",
    "config": {
      "fields": [
        { "selector": "#mdate1", "value": "{{date_from}}", "remove_readonly": true },
        { "selector": "#mdate2", "value": "{{date_to}}", "remove_readonly": true }
      ],
      "submit_selector": "button[type=submit]:has(i.fa-search)",
      "use_js_click": true,
      "wait_processing": "#datable_processing",
      "wait_timeout": 600000
    }
  },
  {
    "id": "step-5",
    "type": "export",
    "label": "Export Excel",
    "config": {
      "export_selector": "a[class*=exportExcel]",
      "confirm_selector": "div.sa-confirm-button-container > button.confirm",
      "download_timeout": 1800000,
      "filename_pattern": "members-{{range_label}}-{{timestamp}}.xls"
    }
  },
  {
    "id": "step-6",
    "type": "import_db",
    "label": "Import เข้า Supabase",
    "config": {
      "parser": "xlsx",
      "target_table": "members",
      "conflict_key": "member_code",
      "batch_size": 500,
      "encrypt_fields": ["__password_plain", "__national_id_plain"]
    }
  }
]'::jsonb
WHERE name = 'Export All Member';

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT name, jsonb_array_length(steps) AS step_count FROM automation_tasks;
-- ============================================================
