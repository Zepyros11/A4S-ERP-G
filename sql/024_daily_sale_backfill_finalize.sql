-- ============================================================
-- Migration 024: Finalize + verify historical backfill (Path B)
--   Run AFTER the workflow_dispatch backfill runs complete.
--   Source of truth for backfill = answerforsuccess.com direct export
--   (scripts/sync-daily-sale.js with DATE_FROM/DATE_TO + BACKFILL=1),
--   NOT the old Google Sheet DATA_CS. Reconcile rows from 022 stay as
--   the checksum to validate bill-level totals against.
-- ============================================================

-- ── 1) Safety net: tag any historical rows still pending as "closed"
--   (covers a backfill run that forgot BACKFILL=1). Sets business_date =
--   sale_date so old bills never surface as today's pending data.
UPDATE daily_sale_bills
  SET business_date = sale_date
  WHERE business_date IS NULL AND sale_date < CURRENT_DATE;

UPDATE daily_sale_topup_bills
  SET business_date = sale_date
  WHERE business_date IS NULL AND sale_date < CURRENT_DATE;

-- ============================================================
-- VERIFICATION (run manually, compare — do not expect zero everywhere)
-- ============================================================

-- 2a) Coverage: bills per month after backfill
-- SELECT to_char(sale_date,'YYYY-MM') AS month, COUNT(*) bills, SUM(amount) amt
--   FROM daily_sale_bills
--   WHERE sale_date BETWEEN '2025-07-01' AND CURRENT_DATE
--   GROUP BY 1 ORDER BY 1;

-- 2b) Checksum vs reconcile (Table C from 022) — the key validation.
--   diff_count / diff_value should be small (staff edits, ใบยืม, cancelled
--   bills excluded by cancel=0, etc.). Large diffs = a month failed to import.
-- SELECT r.reconcile_date, r.branch,
--        r.system_count  AS reconcile_bills, s.bill_count   AS erp_bills,
--        r.system_value  AS reconcile_value, s.total_amount AS erp_value,
--        s.bill_count  - r.system_count AS diff_count,
--        s.total_amount - r.system_value AS diff_value
--   FROM daily_sale_reconcile r
--   LEFT JOIN daily_sale_summary s
--     ON s.sale_date = r.reconcile_date AND s.branch = r.branch
--   WHERE r.reconcile_date BETWEEN '2025-07-01' AND '2026-01-31'
--   ORDER BY ABS(COALESCE(s.total_amount,0) - r.system_value) DESC
--   LIMIT 40;   -- worst mismatches first → investigate those months

-- 2c) Any still-pending historical rows left? (should be 0)
-- SELECT COUNT(*) FROM daily_sale_bills
--   WHERE business_date IS NULL AND sale_date < CURRENT_DATE;

-- 2d) Source breakdown (real export vs leftover 022 sample)
-- SELECT source_file, COUNT(*) FROM daily_sale_bills GROUP BY 1 ORDER BY 2 DESC;

-- ============================================================
-- DONE — once checksums look right, the Google Sheets (DailySaleCS +
-- DATA_CS) can be archived/decommissioned. ERP is now source of truth.
-- ============================================================
