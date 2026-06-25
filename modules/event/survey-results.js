/* ============================================================
   survey-results.js — สรุป + รายคำตอบของฟอร์มประเมิน
   ?form_id=<id>  [&event=<event_id>]
============================================================ */

let _form = null;
let _allResponses = [];      // คำตอบทั้งหมดของฟอร์ม
let _events = {};            // { event_id: event_name } (ที่มีคำตอบ)
let _filterEvent = "";       // "" = ทุกกิจกรรม

function getSB() {
  return { url: localStorage.getItem("sb_url") || "", key: localStorage.getItem("sb_key") || "" };
}
async function sbGet(path) {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove("show"), 2400);
}
function showLoading(on) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.toggle("show", on);
}
// DD/MM/YYYY HH:mm (Asia/Bangkok)
function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
  } catch { return String(iso).slice(0, 16).replace("T", " "); }
}

const Q_TYPE_LABEL = {
  rating: "ให้คะแนน", choice: "ตัวเลือกเดียว", multichoice: "หลายตัวเลือก",
  text: "ข้อความสั้น", textarea: "ข้อความยาว", number: "ตัวเลข",
};

// ── Boot ───────────────────────────────────────────────────
async function boot() {
  const params = new URLSearchParams(location.search);
  const formId = parseInt(params.get("form_id") || "", 10);
  _filterEvent = params.get("event") || "";
  if (isNaN(formId)) { showToast("ไม่พบรหัสฟอร์ม", "error"); return; }

  showLoading(true);
  try {
    const [forms, responses] = await Promise.all([
      sbGet(`survey_forms?select=*&id=eq.${formId}&limit=1`),
      sbGet(`survey_responses?select=*&form_id=eq.${formId}&order=submitted_at.desc`),
    ]);
    _form = forms && forms[0];
    if (!_form) { showToast("ไม่พบฟอร์ม", "error"); showLoading(false); return; }
    _allResponses = responses || [];

    // ดึงชื่อ event ที่มีคำตอบ
    const evIds = [...new Set(_allResponses.map(r => r.event_id).filter(Boolean))];
    if (evIds.length) {
      const evs = await sbGet(`events?select=event_id,event_name&event_id=in.(${evIds.join(",")})`);
      (evs || []).forEach(e => { _events[e.event_id] = e.event_name; });
    }

    document.getElementById("srTitle").textContent = "📊 " + _form.title;
    buildEventFilter();
    document.getElementById("srEventFilter").value = _filterEvent;
    render();
  } catch (e) {
    showToast("โหลดผลไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
}

function buildEventFilter() {
  const sel = document.getElementById("srEventFilter");
  const evIds = [...new Set(_allResponses.map(r => r.event_id).filter(Boolean))];
  const hasStandalone = _allResponses.some(r => !r.event_id);
  sel.innerHTML = `<option value="">ทุกกิจกรรม (${_allResponses.length})</option>` +
    evIds.map(id => {
      const n = _allResponses.filter(r => String(r.event_id) === String(id)).length;
      return `<option value="${id}">${esc(_events[id] || ("event #" + id))} (${n})</option>`;
    }).join("") +
    (hasStandalone ? `<option value="__none">ลิงก์ทั่วไป (ไม่ผูกงาน)</option>` : "");
}

function filteredResponses() {
  if (!_filterEvent) return _allResponses;
  if (_filterEvent === "__none") return _allResponses.filter(r => !r.event_id);
  return _allResponses.filter(r => String(r.event_id) === String(_filterEvent));
}

window.srApplyFilter = function () {
  _filterEvent = document.getElementById("srEventFilter").value;
  render();
};

// ── Render ─────────────────────────────────────────────────
function render() {
  const rows = filteredResponses();
  const questions = Array.isArray(_form.questions) ? _form.questions : [];

  document.getElementById("srSub").textContent =
    `${rows.length} คำตอบ · ${questions.length} คำถาม`;
  document.getElementById("srRespCount").textContent = `${rows.length} รายการ`;

  renderStats(rows, questions);
  renderQuestionSummaries(rows, questions);
  renderTable(rows, questions);
}

function renderStats(rows, questions) {
  const ratingQs = questions.filter(q => q.type === "rating");
  let overallAvg = null;
  if (ratingQs.length && rows.length) {
    let sum = 0, count = 0;
    rows.forEach(r => ratingQs.forEach(q => {
      const v = Number(r.answers?.[q.id]);
      if (v > 0) { sum += v / (q.scale_max || 5); count++; }   // normalize 0–1
    }));
    if (count) overallAvg = (sum / count) * 5; // เป็นสเกล /5
  }
  const lastAt = rows.length ? fmtDateTime(rows[0].submitted_at) : "—";
  const stat = (cls, icon, label, val) => `
    <div class="stat-card ${cls}">
      <div class="stat-icon">${icon}</div>
      <div class="stat-info">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${val}</div>
      </div>
    </div>`;
  document.getElementById("srStats").innerHTML =
    stat("blue", "📨", "จำนวนคำตอบ", rows.length) +
    stat("amber", "⭐", "คะแนนเฉลี่ยรวม (เต็ม 5)", overallAvg != null ? overallAvg.toFixed(2) : "—") +
    stat("green", "🕒", "คำตอบล่าสุด", `<span style="font-size:15px">${lastAt}</span>`);
}

function renderQuestionSummaries(rows, questions) {
  const wrap = document.getElementById("srQuestions");
  if (!rows.length) {
    wrap.innerHTML = `<div class="sr-q-card" style="text-align:center;color:var(--text3);padding:30px">ยังไม่มีคำตอบ</div>`;
    return;
  }
  wrap.innerHTML = questions.map((q, i) => {
    const head = `<div class="sr-q-hd">
      <span class="sr-q-num">${i + 1}.</span>
      <span class="sr-q-label">${esc(q.label)}</span>
      <span class="sr-q-type">${Q_TYPE_LABEL[q.type] || q.type}</span>
    </div>`;
    return `<div class="sr-q-card">${head}${renderQBody(q, rows)}</div>`;
  }).join("");
}

function bar(label, n, total) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return `<div class="sr-bar-row">
    <div class="sr-bar-label">${esc(label)}</div>
    <div class="sr-bar-track"><div class="sr-bar-fill" style="width:${pct}%"></div></div>
    <div class="sr-bar-val">${n} (${pct}%)</div>
  </div>`;
}

function renderQBody(q, rows) {
  const vals = rows.map(r => r.answers?.[q.id]).filter(v => v != null && v !== "");

  if (q.type === "rating") {
    const max = q.scale_max || 5;
    const nums = vals.map(Number).filter(n => n > 0);
    const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
    let bars = "";
    for (let n = max; n >= 1; n--) {
      const c = nums.filter(x => x === n).length;
      bars += bar(`${"⭐".repeat(Math.min(n, 5))} ${n}`, c, nums.length);
    }
    return `<div style="display:flex;align-items:flex-end;gap:8px;margin-bottom:12px">
        <span class="sr-avg">${avg.toFixed(2)}</span><small>/ ${max} · ${nums.length} คำตอบ</small>
      </div>${bars}`;
  }

  if (q.type === "choice" || q.type === "multichoice") {
    const counts = {};
    (q.options || []).forEach(o => counts[o] = 0);
    let totalSelections = 0;
    vals.forEach(v => {
      const arr = Array.isArray(v) ? v : [v];
      arr.forEach(x => { counts[x] = (counts[x] || 0) + 1; totalSelections++; });
    });
    const denom = q.type === "multichoice" ? totalSelections : vals.length;
    return Object.entries(counts).map(([opt, c]) => bar(opt, c, denom)).join("")
      || `<div style="color:var(--text3)">— ยังไม่มีคำตอบ —</div>`;
  }

  // text / textarea / number → list
  if (!vals.length) return `<div style="color:var(--text3)">— ยังไม่มีคำตอบ —</div>`;
  return `<div class="sr-text-list">${vals.map(v =>
    `<div class="sr-text-item">${esc(Array.isArray(v) ? v.join(", ") : v)}</div>`).join("")}</div>`;
}

function answerToText(q, v) {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function renderTable(rows, questions) {
  const thead = document.getElementById("srThead");
  const tbody = document.getElementById("srTbody");
  thead.innerHTML = `<tr>
    <th style="width:50px;text-align:center">#</th>
    <th style="min-width:140px">ผู้ตอบ</th>
    <th style="min-width:150px">กิจกรรม</th>
    <th style="min-width:150px">เวลา</th>
    ${questions.map((q, i) => `<th style="min-width:120px">${i + 1}. ${esc(q.label)}</th>`).join("")}
  </tr>`;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${4 + questions.length}"><div class="empty-state" style="padding:24px"><div class="empty-text">ยังไม่มีคำตอบ</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r, i) => {
    const evName = r.event_id ? (_events[r.event_id] || ("event #" + r.event_id)) : "— ลิงก์ทั่วไป —";
    return `<tr>
      <td class="col-center" style="color:var(--text3)">${i + 1}</td>
      <td>${esc(r.respondent_name || "ไม่ระบุชื่อ")}</td>
      <td style="font-size:12.5px">${esc(evName)}</td>
      <td style="font-size:12.5px;font-family:'IBM Plex Mono',monospace">${fmtDateTime(r.submitted_at)}</td>
      ${questions.map(q => `<td style="font-size:12.5px">${esc(answerToText(q, r.answers?.[q.id]))}</td>`).join("")}
    </tr>`;
  }).join("");
}

// ── Export CSV ─────────────────────────────────────────────
window.srExportCsv = function () {
  const rows = filteredResponses();
  const questions = Array.isArray(_form.questions) ? _form.questions : [];
  if (!rows.length) { showToast("ไม่มีคำตอบให้ export", "warning"); return; }
  const cell = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const header = ["ลำดับ", "ผู้ตอบ", "กิจกรรม", "เวลา", ...questions.map((q, i) => `${i + 1}. ${q.label}`)];
  const lines = [header.map(cell).join(",")];
  rows.forEach((r, i) => {
    const evName = r.event_id ? (_events[r.event_id] || ("event #" + r.event_id)) : "ลิงก์ทั่วไป";
    const row = [i + 1, r.respondent_name || "ไม่ระบุชื่อ", evName, fmtDateTime(r.submitted_at),
      ...questions.map(q => answerToText(q, r.answers?.[q.id]))];
    lines.push(row.map(cell).join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `survey_${_form.id}_${_form.title}.csv`.replace(/[^\w.\-]+/g, "_");
  a.click();
  URL.revokeObjectURL(a.href);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
