#!/usr/bin/env node
/* ============================================================
   sync-daily-sale.js — Daily Sale CS auto-sync
     แทน Python ExportDailysale_CS.py + CheckBillOnline.py

   Download 4 xls from answerforsuccess.com → parse → upsert Supabase:
     sub=1   → daily_sale_bills
     sub=8   → daily_sale_payments
     sub=12  → daily_sale_topup_bills
     sub=131 → daily_sale_topup_details

   Run locally: LOCAL_TEST=1 node sync-daily-sale.js
   Run on CI:   via .github/workflows/sync-daily-sale.yml
   ============================================================ */

import { chromium } from 'playwright';
import { decrypt } from './lib/crypto.js';
import * as sb from './lib/supabase.js';
import * as ds from './lib/supabase-dailysale.js';
import { parseDailySaleXls, extractBranches } from './lib/parser-dailysale.js';
import { sendLineNotify, buildSyncMessage } from './lib/line.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOGIN_URL = 'https://www.answerforsuccess.com/branch/index.php';
const MASTER_KEY = process.env.MASTER_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';
const LOCAL = process.env.LOCAL_TEST === '1';
const FORCE = process.env.FORCE === 'true' || process.env.FORCE === '1';
const DAYS_BACK = parseInt(process.env.DAYS_BACK || '1', 10);

const JOBS = [
  { sub: 1,   type: 'bills',         label: '01-bills' },
  { sub: 8,   type: 'payments',      label: '01-payments' },
  { sub: 12,  type: 'topup_bills',   label: '08-topup-bills' },
  { sub: 131, type: 'topup_details', label: '03-topup-details' },
];

function dateRange() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - DAYS_BACK * 86400000).toISOString().slice(0, 10);
  return { from, to: today };
}

async function main() {
  const startTime = Date.now();
  const { from, to } = dateRange();

  console.log('━'.repeat(60));
  console.log('🔄 A4S-ERP Sync Daily Sale CS');
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} · ${LOCAL ? 'LOCAL' : 'CI'}`);
  console.log(`   Date range: ${from} → ${to} (${DAYS_BACK} day${DAYS_BACK>1?'s':''} back)`);
  console.log('━'.repeat(60));

  if (!MASTER_KEY) throw new Error('MASTER_KEY env missing');
  if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL env missing');
  if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY env missing');

  console.log('\n📋 Loading sync_config (shared with sync-members)...');
  const config = await sb.getConfig();
  if (!config) throw new Error('sync_config row not found');
  if (!config.username_encrypted || !config.password_encrypted) {
    throw new Error('Credentials not set in sync_config — ตั้งค่าที่ ERP UI ก่อน');
  }

  const username = decrypt(config.username_encrypted, MASTER_KEY);
  const password = decrypt(config.password_encrypted, MASTER_KEY);
  console.log(`🔐 Logged as: ${username}`);

  const logId = await sb.startLog({
    source: 'daily_sale',
    triggered_by: 'github-actions',
  });
  console.log(`📝 sync_log id=${logId}`);

  const downloadDir = LOCAL
    ? join(homedir(), 'Downloads', 'A4S-DailySale')
    : './downloads-daily-sale';
  mkdirSync(downloadDir, { recursive: true });

  let status = 'failed';
  let errorMsg = null;
  const results = {};     // per-job stats
  let totalInserted = 0, totalFailed = 0, totalSeen = 0;

  let browser;
  try {
    browser = await chromium.launch({ headless: !LOCAL, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({
      acceptDownloads: true,
      userAgent: 'Mozilla/5.0 (compatible; A4S-ERP-Sync/1.0)',
    });
    const page = await ctx.newPage();

    // ── Login ──
    console.log(`\n🌐 Login → ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('#tbx-user', username);
    await page.fill('#tbx-pwd', password);
    await page.click('#btn-logins');

    try {
      await page.waitForSelector('.swal-overlay--show-modal', { timeout: 10000 });
      await page.click('button.swal-button--confirm');
      await page.waitForSelector('.swal-overlay--show-modal', { state: 'hidden', timeout: 5000 });
    } catch {
      const captcha = await page.locator('#secur_captcha:visible').count() > 0;
      if (captcha) throw new Error('CAPTCHA appeared — too many failed logins');
      const stillLogin = await page.locator('#tbx-user:visible').count() > 0;
      if (stillLogin) throw new Error('Login failed — credentials rejected');
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 });
    console.log(`✅ Logged in — ${page.url()}`);

    // ── Loop 4 jobs ──
    for (let j = 0; j < JOBS.length; j++) {
      const job = JOBS[j];
      const url = `${LOGIN_URL}?sessiontab=3&sub=${job.sub}`;
      console.log(`\n━━━ Job ${j+1}/${JOBS.length}: ${job.label} (sub=${job.sub}) ━━━`);

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await _screenshot(page, `${job.label}-01-loaded`);

      // Expand Advance Search (if present)
      await page.evaluate(() => {
        const btn = document.querySelector('a[href="#collapseOne"]') ||
                    document.querySelector('a.accordion-toggle');
        if (btn) btn.click();
      }).catch(() => {});
      await page.waitForTimeout(1500);

      // Fill date filter (sadate1/sadate2 per Python script)
      await page.evaluate(({from, to}) => {
        for (const [id, val] of [['sadate1', from], ['sadate2', to]]) {
          const el = document.getElementById(id);
          if (el) {
            el.removeAttribute('readonly');
            el.value = val;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }, { from, to });

      // Set cancel=0 and locationbase=1 (Python did this)
      await page.evaluate(() => {
        for (const [id, val] of [['cancel', '0'], ['locationbase', '1']]) {
          const el = document.getElementById(id);
          if (el) {
            el.value = val;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }).catch(() => {});

      // Click Search
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button[type="submit"]');
        for (const btn of buttons) {
          if (btn.querySelector('i.fa-search') || /ค้นหา/.test(btn.textContent || '')) {
            btn.click();
            return;
          }
        }
      });

      // Wait table to finish
      await page.waitForTimeout(3000);
      await page.waitForSelector('#datable_processing', { state: 'hidden', timeout: 600000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await _screenshot(page, `${job.label}-02-searched`);

      // Click Export Excel
      console.log(`   📊 Export Excel...`);
      const exportClicked = await page.evaluate(() => {
        const btn = document.querySelector('a[class*="exportExcel"]');
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (!exportClicked) {
        console.log(`   ⚠️ ${job.label}: Export button not found — skipping`);
        results[job.type] = { inserted: 0, failed: 0, seen: 0, skipped: true };
        continue;
      }

      // Wait for confirm dialog + click
      const confirmSel = 'div.sa-confirm-button-container > button.confirm';
      try {
        await page.waitForSelector(confirmSel, { timeout: 15000 });
      } catch {
        console.log(`   ⚠️ ${job.label}: Confirm dialog didn't appear`);
        results[job.type] = { inserted: 0, failed: 0, seen: 0, skipped: true };
        continue;
      }

      const downloadPromise = page.waitForEvent('download', { timeout: 900000 });
      await page.waitForTimeout(1000);
      await page.evaluate((sel) => document.querySelector(sel)?.click(), confirmSel);

      const download = await downloadPromise;
      const filename = `daily-sale-${job.label}-${Date.now()}.xls`;
      const filePath = join(downloadDir, filename);
      await download.saveAs(filePath);
      console.log(`   ✅ Downloaded: ${filePath}`);

      if (DRY_RUN) {
        console.log(`   (DRY_RUN) skipped parse+upsert`);
        continue;
      }

      // Parse
      console.log(`   📖 Parsing...`);
      const records = await parseDailySaleXls(filePath, job.type);

      if (!records.length) {
        console.log(`   (empty) no rows to upsert`);
        results[job.type] = { inserted: 0, failed: 0, seen: 0 };
        continue;
      }

      // Auto-upsert branches (prevent FK fail)
      if (job.type === 'bills' || job.type === 'topup_bills') {
        const branches = extractBranches(records);
        if (branches.length) {
          await ds.ensureBranches(branches);
          console.log(`   🏢 Ensured ${branches.length} branch code(s)`);
        }
      }

      // Upsert per table
      let result;
      if (job.type === 'bills')              result = await ds.upsertBills(records);
      else if (job.type === 'payments')      result = await ds.upsertPayments(records);
      else if (job.type === 'topup_bills')   result = await ds.upsertTopupBills(records);
      else if (job.type === 'topup_details') result = await ds.insertTopupDetails(records, from, to);

      results[job.type] = { ...result, seen: records.length };
      totalInserted += result.inserted;
      totalFailed += result.failed;
      totalSeen += records.length;
      console.log(`   ✓ ${job.type}: ${result.inserted} inserted · ${result.failed} failed (of ${records.length})`);
    }

    status = totalFailed === 0 ? (totalInserted > 0 ? 'success' : 'empty') : (totalInserted === 0 ? 'failed' : 'partial');

  } catch (e) {
    errorMsg = e.message;
    console.error('\n❌ Error:', e.message);
    if (LOCAL) console.error(e.stack);
    status = 'failed';
  } finally {
    if (browser) await browser.close();
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  await sb.finishLog(logId, {
    status: status === 'empty' ? 'success' : status,
    rows_total: totalSeen,
    rows_inserted: totalInserted,
    rows_failed: totalFailed,
    error_message: errorMsg,
    duration_sec: duration,
  });

  // LINE notify on failure/partial (success only if opted-in)
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
        ranges: `Daily Sale ${from}→${to}`,
      });
      await sendLineNotify(lineToken, config.line_target_type || 'group', config.line_target_id, [msg]);
    } catch (e) {
      console.error(`📱 LINE notify error: ${e.message}`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`   Result: ${status.toUpperCase()} · ${duration}s`);
  console.log(`   Total: ${totalInserted} inserted · ${totalFailed} failed · ${totalSeen} seen`);
  for (const [type, r] of Object.entries(results)) {
    console.log(`     ${type}: ${r.inserted || 0}/${r.seen || 0} ${r.skipped ? '(skipped)' : ''}`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  process.exitCode = status === 'failed' ? 1 : 0;
}

async function _screenshot(page, name) {
  if (!LOCAL) return;
  try {
    await page.screenshot({ path: `debug-ds-${name}.png`, fullPage: true });
  } catch {}
}

main().catch(e => {
  console.error('\n💥 Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
