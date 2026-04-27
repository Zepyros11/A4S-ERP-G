#!/usr/bin/env node
/* ============================================================
   sync-members.js — Main entry for auto-sync
   Run locally: node sync-members.js
   Run on CI:   via .github/workflows/sync-members.yml

   ⚠️ Phase 2B skeleton:
      - Login answerforsuccess.com ✅
      - Check session ✅
      - Export flow  ⏳ ต้องรอ user แจ้ง step-by-step
      - Parse+upsert ⏳ พร้อมแล้ว (ใช้ได้เมื่อมีไฟล์)
   ============================================================ */

import { chromium } from 'playwright';
import { decrypt } from './lib/crypto.js';
import * as sb from './lib/supabase.js';
import { parseXlsToRecords } from './lib/parser.js';
import { sendLineNotify, buildSyncMessage } from './lib/line.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOGIN_URL = 'https://www.answerforsuccess.com/branch/index.php';
const MEMBER_LIST_URL = `${LOGIN_URL}?sessiontab=1&sub=1&typereport=1`;
const MASTER_KEY = process.env.MASTER_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';
const LOCAL = process.env.LOCAL_TEST === '1';
const TEST_LINE = process.env.TEST_LINE === 'true' || process.env.TEST_LINE === '1';
const FORCE = process.env.FORCE === 'true' || process.env.FORCE === '1';

/* ── Date ranges — auto-split into 1-year buckets ──
   Default: skip legacy 2015-2020 bucket (data static, already imported).
   Set env INCLUDE_LEGACY=1 to re-import legacy (e.g. on first setup).

   Examples (default, no legacy):
     2026: [2021, 2022, 2023, 2024, 2025, 2026-now]
   With legacy:
     2026: [2015, 2016, 2017, 2018, 2019, 2020, 2021, ..., 2026-now]
*/
const INCLUDE_LEGACY = process.env.INCLUDE_LEGACY === '1' || process.env.INCLUDE_LEGACY === 'true';
const BUCKET_YEARS = 1;

function buildDateRanges() {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const currentYear = today.getFullYear();
  const ranges = [];

  const startYear = INCLUDE_LEGACY ? 2015 : 2021;

  let start = startYear;
  while (start <= currentYear) {
    const end = Math.min(start + BUCKET_YEARS - 1, currentYear);
    const isCurrent = end === currentYear;
    ranges.push({
      label: isCurrent ? `${start}-now` : `${start}-${end}`,
      from: `${start}-01-01`,
      to: isCurrent ? todayIso : `${end}-12-31`,
    });
    start = end + 1;
  }
  return ranges;
}

const DATE_RANGES = buildDateRanges();

async function main() {
  const startTime = Date.now();
  console.log('━'.repeat(60));
  console.log('🔄 A4S-ERP Sync Members');
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} · ${LOCAL ? 'LOCAL' : 'CI'}`);
  console.log('━'.repeat(60));

  // 1. Validate env
  if (!MASTER_KEY) throw new Error('MASTER_KEY env missing');
  if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL env missing');
  if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY env missing');

  // 2. Load config
  console.log('\n📋 Loading sync_config...');
  const config = await sb.getConfig();
  if (!config) throw new Error('sync_config row not found — run 001_members.sql');
  if (!config.enabled && !FORCE) {
    console.log('⏸️  Auto-sync disabled (sync_config.enabled=false) — exiting (use FORCE=1 to override)');
    return;
  }
  if (!config.username_encrypted || !config.password_encrypted) {
    throw new Error('Credentials not set in sync_config — ไปตั้งค่าที่ ERP UI ก่อน');
  }

  // Respect per-task schedule + pause flag from automation_tasks
  const gate = await sb.gateScheduledRun('sync-members.yml', FORCE || TEST_LINE);
  console.log(`   ${gate.reason}`);
  if (!gate.shouldRun) return;
  const task = gate.task;

  // ── TEST_LINE mode: send test message + exit ──
  if (TEST_LINE) {
    console.log('\n🧪 TEST_LINE mode — sending test message only (no sync)');
    if (!config.line_token_encrypted) {
      console.error('❌ No LINE token configured');
      process.exit(1);
    }
    const lineToken = decrypt(config.line_token_encrypted, MASTER_KEY);
    const r = await sendLineNotify(
      lineToken,
      config.line_target_type || 'group',
      config.line_target_id,
      [{ type: 'text', text: '🧪 [A4S-ERP] Test message — LINE Notify ทำงานปกติ ✅' }]
    );
    if (r.ok) {
      console.log('✅ Test message sent');
      process.exit(0);
    } else {
      console.error('❌ LINE send failed:', r.error);
      process.exit(1);
    }
  }

  // 3. Decrypt credentials
  const username = decrypt(config.username_encrypted, MASTER_KEY);
  const password = decrypt(config.password_encrypted, MASTER_KEY);
  console.log(`🔐 Logged as: ${username}`);

  // 4. Start sync_log
  const logId = await sb.startLog({
    source: 'auto_sync',
    triggered_by: 'github-actions',
  });
  console.log(`📝 sync_log id=${logId}`);

  let status = 'failed';
  let errorMsg = null;
  let totalInserted = 0, totalFailed = 0, totalSeen = 0;

  // 5. Browser automation
  let browser;
  try {
    browser = await chromium.launch({
      headless: !LOCAL,                       // show browser only in local mode
      args: ['--no-sandbox'],
    });
    const ctx = await browser.newContext({
      acceptDownloads: true,
      userAgent: 'Mozilla/5.0 (compatible; A4S-ERP-Sync/1.0)',
    });
    const page = await ctx.newPage();

    // ── Login ──
    console.log(`\n🌐 Navigating to ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await _screenshot(page, '01-login-page');

    // ── Selectors verified from DOM inspection ──
    console.log('🔑 Attempting login...');
    await page.fill('#tbx-user', username);
    await page.fill('#tbx-pwd', password);
    await page.click('#btn-logins');
    await _screenshot(page, '02-after-login-click');

    // ── Handle SweetAlert "ทำรายการสำเร็จ" popup ──
    console.log('⏳ Waiting for success popup...');
    try {
      await page.waitForSelector('.swal-overlay--show-modal', { timeout: 10000 });
      console.log('   ✓ Success popup appeared');
      await _screenshot(page, '03-success-popup');
      await page.click('button.swal-button--confirm');
      console.log('   ✓ Clicked OK');
      // Wait for popup to close
      await page.waitForSelector('.swal-overlay--show-modal', { state: 'hidden', timeout: 5000 });
    } catch (e) {
      // Popup อาจไม่ขึ้น (session เก่ายังอยู่) หรือ login fail
      const captchaVisible = await page.locator('#secur_captcha:visible').count() > 0;
      if (captchaVisible) throw new Error('CAPTCHA appeared — too many failed logins');
      const stillLogin = await page.locator('#tbx-user:visible').count() > 0;
      if (stillLogin) throw new Error('Login failed — credentials rejected (no success popup)');
      console.log('   (no popup — possibly logged in via existing session)');
    }

    // ── Wait for dashboard to settle ──
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await _screenshot(page, '04-dashboard');

    // Verify login success via user badge (Phop (BKK01))
    const userBadge = await page.locator('text=/\\([A-Z]{2,}\\d+\\)/').first().textContent().catch(() => null);
    if (userBadge) console.log(`   User badge: ${userBadge.trim()}`);
    console.log(`✅ Logged in — current URL: ${page.url()}`);

    // ── Step 3: Navigate to member list ──
    console.log('\n📋 Navigating to member list (01 รายชื่อสมาชิก)...');
    await page.goto(MEMBER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await _screenshot(page, '05-member-list');
    console.log(`   ✓ Reached: ${page.url()}`);

    // ── Step 4: Expand Advance Search (JS click — more reliable) ──
    console.log('\n🔍 Expanding Advance Search panel...');
    await page.evaluate(() => {
      const btn = document.querySelector('a[href="#collapseOne"]') ||
                  document.querySelector('a.accordion-toggle');
      if (btn) btn.click();
    });
    await page.waitForTimeout(1500);
    await _screenshot(page, '06-advance-search');

    // ── Step 5+: Loop date ranges with per-bucket retry (partial success allowed) ──
    const failedBuckets = [];
    const MAX_ATTEMPTS = 2;       // 1 retry per bucket

    for (let i = 0; i < DATE_RANGES.length; i++) {
      const range = DATE_RANGES[i];
      console.log(`\n━━━ Round ${i+1}/${DATE_RANGES.length}: ${range.label} (${range.from} → ${range.to}) ━━━`);

      let bucketOk = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
          console.log(`   🔁 Retry ${attempt-1}/${MAX_ATTEMPTS-1} for ${range.label} — re-navigating...`);
          try {
            await page.goto(MEMBER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await page.evaluate(() => {
              const btn = document.querySelector('a[href="#collapseOne"]') ||
                          document.querySelector('a.accordion-toggle');
              if (btn) btn.click();
            });
            await page.waitForTimeout(1500);
          } catch (navErr) {
            console.error(`   ⚠️ Re-nav failed: ${navErr.message}`);
          }
        }
        try {
          const r = await processBucket(page, range);
          totalInserted += r.inserted;
          totalFailed += r.failed;
          totalSeen += r.seen;
          bucketOk = true;
          break;
        } catch (e) {
          console.error(`   ❌ Attempt ${attempt}/${MAX_ATTEMPTS} for ${range.label}: ${e.message}`);
          if (attempt === MAX_ATTEMPTS) {
            failedBuckets.push({ label: range.label, error: e.message });
          }
        }
      }

      // Navigate back to member list for next round (failed retries already navigated)
      if (i < DATE_RANGES.length - 1 && bucketOk) {
        await page.goto(MEMBER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        await page.evaluate(() => {
          const btn = document.querySelector('a[href="#collapseOne"]') ||
                      document.querySelector('a.accordion-toggle');
          if (btn) btn.click();
        });
        await page.waitForTimeout(1500);
      }
    }

    if (failedBuckets.length === 0) {
      status = 'success';
    } else if (failedBuckets.length === DATE_RANGES.length) {
      status = 'failed';
      errorMsg = `All ${DATE_RANGES.length} buckets failed. First: ${failedBuckets[0].error}`;
    } else {
      status = 'partial';
      errorMsg = `${failedBuckets.length}/${DATE_RANGES.length} buckets failed: ${failedBuckets.map(b => `${b.label}(${b.error.slice(0, 60)})`).join('; ')}`;
    }

  } catch (e) {
    errorMsg = e.message;
    console.error('\n❌ Error:', e.message);
    if (LOCAL) console.error(e.stack);
    status = 'failed';
  } finally {
    if (browser) await browser.close();
  }

  // 6. Finalize log
  const duration = Math.round((Date.now() - startTime) / 1000);
  await sb.finishLog(logId, {
    status,
    rows_total: totalSeen,
    rows_inserted: totalInserted,
    rows_failed: totalFailed,
    error_message: errorMsg,
    duration_sec: duration,
  });

  // 7. Update next_sync_at (legacy field — kept for any other consumers)
  if (status !== 'failed') {
    const nextMs = {
      '1h': 3600e3, '6h': 6*3600e3, '24h': 86400e3, 'weekly': 7*86400e3,
    }[config.frequency] || 86400e3;
    await sb.updateConfig({
      last_sync_at: new Date().toISOString(),
      next_sync_at: new Date(Date.now() + nextMs).toISOString(),
    });
  }

  // Update automation_tasks (last_run_at always; rows + status reflect outcome)
  if (task) {
    try {
      await sb.updateAutomationTask(task.id, {
        last_run_at: new Date().toISOString(),
        last_row_count: totalInserted,
        status: status === 'failed' ? 'error' : (task.status === 'error' ? 'active' : task.status),
        last_error: errorMsg || null,
      });
    } catch (e) { console.warn('automation_tasks update:', e.message); }
  }

  // 8. LINE notify (fail always · success only if opted in)
  const shouldNotify = (status === 'failed' || status === 'partial') ||
                       (status === 'success' && config.line_notify_on_success);
  if (shouldNotify && config.line_token_encrypted) {
    try {
      const lineToken = decrypt(config.line_token_encrypted, MASTER_KEY);
      const msg = buildSyncMessage({
        status,
        durationSec: duration,
        rowsInserted: totalInserted,
        rowsFailed: totalFailed,
        errorMessage: errorMsg,
        ranges: DATE_RANGES.map(r => r.label).join(', '),
      });
      const r = await sendLineNotify(
        lineToken,
        config.line_target_type || 'group',
        config.line_target_id,
        [msg]
      );
      if (r.ok) console.log(`📱 LINE notify sent`);
      else console.error(`📱 LINE notify failed: ${r.error}`);
    } catch (e) {
      console.error(`📱 LINE notify error: ${e.message}`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`   Result: ${status.toUpperCase()} · ${duration}s`);
  console.log(`   Rows: ${totalInserted} inserted · ${totalFailed} failed`);
  if (errorMsg) console.log(`   Note: ${errorMsg}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  process.exitCode = status === 'failed' ? 1 : 0;
}

/* ── Process one date-range bucket: search → export → download → parse → upsert ──
   Throws on any error so caller can retry. */
async function processBucket(page, range) {
  // Fill date range (datepicker is readonly — must remove first)
  await page.evaluate(({from, to}) => {
    for (const [id, val] of [['mdate1', from], ['mdate2', to]]) {
      const el = document.getElementById(id);
      if (el) {
        el.removeAttribute('readonly');
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }, { from: range.from, to: range.to });
  await _screenshot(page, `07-filter-${range.label}`);

  console.log(`   🔍 Clicking ค้นหา...`);
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button[type="submit"]');
    for (const btn of buttons) {
      if (btn.querySelector('i.fa-search') || btn.querySelector('i[class*="fa-search"]')) {
        btn.click();
        return;
      }
    }
    for (const btn of buttons) {
      if (/ค้นหา/.test(btn.textContent || '')) {
        btn.click();
        return;
      }
    }
  });

  console.log(`   ⏳ Waiting for table to load...`);
  await page.waitForTimeout(3000);
  await page.waitForSelector('#datable_processing', {
    state: 'hidden',
    timeout: 600000,
  }).catch(() => {});
  await page.waitForTimeout(2000);
  await _screenshot(page, `08-searched-${range.label}`);

  console.log(`   📊 Clicking Export Excel...`);
  await page.evaluate(() => {
    const btn = document.querySelector('a[class*="exportExcel"]');
    if (btn) btn.click();
    else throw new Error('Export Excel button not found');
  });

  console.log(`   ✓ Waiting for confirm dialog...`);
  const confirmSel = 'div.sa-confirm-button-container > button.confirm';
  await page.waitForSelector(confirmSel, { timeout: 15000 });
  await _screenshot(page, `09-confirm-${range.label}`);

  // Click confirm → wait for download (10 min — typical 1y bucket finishes <2 min)
  const downloadDir = LOCAL
    ? join(homedir(), 'Downloads', 'A4S')
    : './downloads';
  mkdirSync(downloadDir, { recursive: true });

  const downloadPromise = page.waitForEvent('download', { timeout: 600000 });
  await page.waitForTimeout(1000);
  await page.evaluate((sel) => { document.querySelector(sel)?.click(); }, confirmSel);
  console.log(`   ⏳ Generating .xls (typical 1-3 min)...`);

  const download = await downloadPromise;
  const filename = `members-${range.label}-${Date.now()}.xls`;
  const filePath = join(downloadDir, filename);
  await download.saveAs(filePath);
  console.log(`   ✅ Downloaded: ${filePath}`);

  if (DRY_RUN) {
    console.log(`   (DRY_RUN) skipped parse+upsert`);
    return { inserted: 0, failed: 0, seen: 0 };
  }

  console.log(`   📖 Parsing + upserting...`);
  const records = await parseXlsToRecords(filePath, {
    masterKey: MASTER_KEY,
    sourceFile: filename,
  });
  console.log(`      Parsed ${records.length} rows`);
  const result = await sb.upsertMembers(records, 500);
  console.log(`      Upserted ${result.inserted} · Failed ${result.failed}`);
  return { inserted: result.inserted, failed: result.failed, seen: records.length };
}

/* ── Screenshot helper (only saved when LOCAL=1) ── */
async function _screenshot(page, name) {
  if (!LOCAL) return;
  try {
    await page.screenshot({ path: `debug-${name}.png`, fullPage: true });
    console.log(`   📸 debug-${name}.png`);
  } catch {}
}

main().catch(e => {
  console.error('\n💥 Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
