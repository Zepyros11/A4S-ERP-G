/* ============================================================
   Settings — Notification Triggers (เหตุการณ์แจ้งเตือน) CRUD
   ------------------------------------------------------------
   หน้าแยกสำหรับจัดการ notification_triggers (sql/067)
   master-detail · เขียน DB ตรง + auto-gen SQL/โค้ดยิง (in-context)
   ใช้ร่วมกับ bell-rules (กระดิ่ง) + notification-rules (LINE)
   ============================================================ */

// ── Supabase helper ───────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}
async function sbFetch(path, opts = {}) {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: opts.method && opts.method !== "GET" ? "return=representation" : undefined,
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// ── State ─────────────────────────────────────────────────
let TRIGGERS = {};        // trigger_key → meta
let rulesUsing = {};      // trigger_key → จำนวนกฎที่ใช้ (กระดิ่ง+LINE) สำหรับเตือนตอนลบ
let trigEditKey = null;   // null = สร้างใหม่ · key = แก้ไข · undefined = ยังไม่เลือก
let trigPH = [];          // placeholders ระหว่างแก้ไข
let _trigSQL = "";
let _trigSnippet = "";

// ── Init ──────────────────────────────────────────────────
async function init() {
  showLoading(true);
  try {
    await Promise.all([loadTriggers(), loadUsage()]);
    renderList();
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

async function loadTriggers() {
  // เฉพาะ on_status (instant) — กระดิ่งยังไม่รองรับ scheduled
  const rows = (await sbFetch("notification_triggers?select=*&kind=eq.on_status&order=sort_order.asc")) || [];
  const map = {};
  for (const r of rows) {
    map[r.trigger_key] = {
      label:        r.label,
      kind:         r.kind,
      placeholders: Array.isArray(r.placeholders) ? r.placeholders : [],
      sample:       r.sample && typeof r.sample === "object" ? r.sample : {},
      description:  r.description || "",
      is_active:    r.is_active !== false,
      is_builtin:   r.is_builtin === true,
      sort_order:   r.sort_order ?? 100,
    };
  }
  TRIGGERS = map;
}

// นับกฎที่ใช้แต่ละ trigger (กระดิ่ง + LINE) — best-effort, ไม่ throw
async function loadUsage() {
  const count = {};
  try {
    const bell = (await sbFetch("bell_notification_rules?select=trigger_key")) || [];
    const line = (await sbFetch("notification_rules?select=trigger_key")) || [];
    for (const r of [...bell, ...line]) {
      if (r.trigger_key) count[r.trigger_key] = (count[r.trigger_key] || 0) + 1;
    }
  } catch (_) { /* ตารางอาจไม่มี — ข้าม */ }
  rulesUsing = count;
}

// ── Left list ─────────────────────────────────────────────
function renderList() {
  const wrap = document.getElementById("trigList");
  const entries = Object.entries(TRIGGERS).sort((a, b) => (a[1].sort_order ?? 100) - (b[1].sort_order ?? 100));
  if (!entries.length) {
    wrap.innerHTML = `<div class="trig-list-empty">ยังไม่มีเหตุการณ์ — กด "＋ เพิ่มเหตุการณ์"</div>`;
    return;
  }
  wrap.innerHTML = entries.map(([k, m]) => {
    const badges = [
      m.is_builtin ? `<span class="trig-badge lock">🔒</span>` : "",
      !m.is_active ? `<span class="trig-badge off">ปิด</span>` : "",
    ].join("");
    const active = trigEditKey === k ? "active" : "";
    const delBtn = m.is_builtin
      ? `<button class="trig-card-del" title="builtin ลบไม่ได้" disabled>🗑️</button>`
      : `<button class="trig-card-del" title="ลบ" onclick="event.stopPropagation();window.deleteTrigger('${escapeAttr(k)}')">🗑️</button>`;
    return `
      <div class="trig-card ${active} ${m.is_active ? "" : "off"}" onclick="window.selectTrig('${escapeAttr(k)}')">
        <div class="trig-card-main">
          <div class="trig-card-label">${escapeHtml(m.label)}</div>
          <div class="trig-card-meta"><span class="br-trigger-chip">${escapeHtml(k)}</span>${badges}</div>
        </div>
        ${delBtn}
      </div>`;
  }).join("");
}

// ── Editor (right) ────────────────────────────────────────
function showEmpty() {
  document.getElementById("trigEmpty").style.display = "";
  document.getElementById("trigEditor").style.display = "none";
}
function showEditor() {
  document.getElementById("trigEmpty").style.display = "none";
  document.getElementById("trigEditor").style.display = "";
}

function selectTrig(key) { openEditor(key); }
function newTrig() { openEditor(null); }

function openEditor(key) {
  trigEditKey = key;
  const m = key ? TRIGGERS[key] : null;
  document.getElementById("trigEditTitle").textContent = key ? `✏️ แก้ไข: ${m.label}` : "＋ เพิ่มเหตุการณ์";
  document.getElementById("tLabel").value = m?.label || "";
  const keyInput = document.getElementById("tKey");
  keyInput.value = key || "custom.";
  keyInput.readOnly = !!key;
  keyInput.style.opacity = key ? ".6" : "1";
  keyInput.dataset.touched = key ? "1" : "";
  trigPH = m ? [...m.placeholders] : [];
  document.getElementById("tSample").value = JSON.stringify(m?.sample || {}, null, 2);
  document.getElementById("tDesc").value = m?.description || "";
  document.getElementById("tSort").value = m?.sort_order ?? 100;
  document.getElementById("tActive").checked = m ? m.is_active : true;
  document.getElementById("trigCode").innerHTML = "";
  renderTrigPH();
  renderPHRef();
  showEditor();
  renderList(); // อัปเดต .active highlight
  if (!key) setTimeout(() => document.getElementById("tLabel").focus(), 0);
}

// auto-suggest key จาก label (เฉพาะตอนสร้างใหม่ + ยังไม่แก้ key เอง)
function onTrigLabelInput() {
  const keyInput = document.getElementById("tKey");
  if (trigEditKey) return;
  if (keyInput.dataset.touched === "1") return;
  const slug = slugifyKey(document.getElementById("tLabel").value);
  keyInput.value = slug ? `custom.${slug}` : "custom.";
}
function slugifyKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

// ── placeholder tag input ──
function renderTrigPH() {
  const wrap = document.getElementById("tPHWrap");
  wrap.innerHTML = trigPH.map((p, i) =>
    `<span class="trig-ph-tag">${escapeHtml(p)}<span class="trig-ph-x" onclick="window.removeTrigPH(${i})">×</span></span>`
  ).join("") +
    `<input type="text" class="trig-ph-input" id="tPHInput" placeholder="พิมพ์ชื่อตัวแปร + Enter" spellcheck="false" onkeydown="window.onTrigPHKey(event)" autocomplete="off">`;
}
function onTrigPHKey(ev) {
  if (ev.key === "Backspace" && !ev.target.value && trigPH.length) {
    trigPH.pop(); renderTrigPH(); renderPHRef(); focusPHInput(); syncTrigSample(); return;
  }
  if (ev.key !== "Enter" && ev.key !== "," && ev.key !== " ") return;
  ev.preventDefault();
  const raw = ev.target.value.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  if (!raw) return;
  if (!trigPH.includes(raw)) trigPH.push(raw);
  renderTrigPH(); renderPHRef(); focusPHInput(); syncTrigSample();
}
function removeTrigPH(i) {
  trigPH.splice(i, 1);
  renderTrigPH(); renderPHRef(); focusPHInput(); syncTrigSample();
}
function focusPHInput() { setTimeout(() => document.getElementById("tPHInput")?.focus(), 0); }

// อัปเดต sample JSON ให้ตรง placeholders (เก็บค่าที่พิมพ์ไว้แล้ว)
function syncTrigSample() {
  let cur = {};
  try { cur = JSON.parse(document.getElementById("tSample").value || "{}"); } catch (_) { cur = {}; }
  const next = {};
  for (const p of trigPH) next[p] = cur[p] != null ? cur[p] : "";
  document.getElementById("tSample").value = JSON.stringify(next, null, 2);
}
function regenTrigSample() {
  const next = {};
  for (const p of trigPH) next[p] = "ตัวอย่าง";
  document.getElementById("tSample").value = JSON.stringify(next, null, 2);
}

// ── reference table ──
function smpText(m, p) {
  const v = m.sample ? m.sample[p] : undefined;
  if (v == null || v === "") return "—";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}
function renderPHRef() {
  const ref = document.getElementById("tPHRef");
  if (!ref) return;
  const entries = Object.entries(TRIGGERS)
    .filter(([k, m]) => k !== trigEditKey && m.placeholders.length)
    .sort((a, b) => (a[1].sort_order ?? 100) - (b[1].sort_order ?? 100));
  if (!entries.length) {
    ref.innerHTML = `<div class="br-hint" style="padding:12px">ยังไม่มีเหตุการณ์อื่นให้อ้างอิง — ตัวแปรของเหตุการณ์ใหม่ๆ โปรแกรมเมอร์เป็นคนกำหนดตอนเขียนโค้ดยิง</div>`;
    return;
  }
  const rows = entries.map(([k, m]) => {
    const group = `<tr class="trig-ref-group"><td colspan="3">${escapeHtml(m.label)}</td></tr>`;
    const vars = m.placeholders.map((p) => {
      const has = trigPH.includes(p);
      const click = has ? "" : `onclick="window.addPHFromRef('${escapeAttr(p)}')"`;
      return `<tr class="trig-ref-row ${has ? "added" : ""}" ${click} title="${has ? "เพิ่มแล้ว" : "คลิกเพื่อเพิ่ม"}">
        <td><code>${escapeHtml(p)}</code></td>
        <td class="smp">${escapeHtml(smpText(m, p))}</td>
        <td class="act">${has ? "✓" : "＋"}</td>
      </tr>`;
    }).join("");
    return group + vars;
  }).join("");
  ref.innerHTML = `<table class="trig-ref-table">
      <thead><tr><th>ตัวแปร</th><th>ตัวอย่างค่า / ความหมาย</th><th class="act">เพิ่ม</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
function addPHFromRef(name) {
  if (!trigPH.includes(name)) trigPH.push(name);
  renderTrigPH(); renderPHRef(); syncTrigSample();
}

// ── save ──
async function saveTrigger() {
  const label = document.getElementById("tLabel").value.trim();
  const key = document.getElementById("tKey").value.trim();
  const desc = document.getElementById("tDesc").value.trim();
  const sort = parseInt(document.getElementById("tSort").value, 10);
  const isActive = document.getElementById("tActive").checked;

  if (!label) return showToast("กรุณาใส่ชื่อเหตุการณ์", "error");
  if (!trigEditKey) {
    if (!key || key === "custom.") return showToast("กรุณาใส่รหัสเหตุการณ์ (key)", "error");
    if (!/^[a-z0-9]+([._][a-z0-9]+)*$/.test(key)) return showToast("key ต้องเป็นตัวพิมพ์เล็ก/ตัวเลข/จุด/ขีดล่าง เช่น custom.trip_created", "error");
    if (TRIGGERS[key]) return showToast(`มี key "${key}" อยู่แล้ว`, "error");
  }
  let sample;
  try {
    sample = JSON.parse(document.getElementById("tSample").value || "{}");
    if (typeof sample !== "object" || Array.isArray(sample)) throw new Error();
  } catch (_) {
    return showToast("ตัวอย่างข้อมูล (Sample) ไม่ใช่ JSON ที่ถูกต้อง", "error");
  }

  const btn = document.getElementById("btnSaveTrig");
  btn.disabled = true;
  try {
    if (trigEditKey) {
      await sbFetch(`notification_triggers?trigger_key=eq.${encodeURIComponent(trigEditKey)}`, {
        method: "PATCH",
        body: { label, placeholders: trigPH, sample, description: desc || null, sort_order: isNaN(sort) ? 100 : sort, is_active: isActive },
      });
    } else {
      await sbFetch("notification_triggers", {
        method: "POST",
        body: {
          trigger_key: key, label, kind: "on_status", anchor: null,
          placeholders: trigPH, sample, description: desc || null,
          is_builtin: false, is_active: isActive, sort_order: isNaN(sort) ? 100 : sort,
        },
      });
    }
    const savedKey = trigEditKey || key;
    await loadTriggers();
    trigEditKey = savedKey;
    document.getElementById("trigEditTitle").textContent = `✏️ แก้ไข: ${TRIGGERS[savedKey].label}`;
    document.getElementById("tKey").readOnly = true;
    document.getElementById("tKey").style.opacity = ".6";
    renderList();
    renderPHRef();
    showTrigCode();
    showToast("บันทึกเหตุการณ์แล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function deleteTrigger(key) {
  const m = TRIGGERS[key];
  if (m?.is_builtin) return showToast("เหตุการณ์ builtin ลบไม่ได้ (ผูกกับโค้ด)", "error");
  const used = rulesUsing[key] || 0;
  const warn = used ? `\n\n⚠️ มี ${used} กฎใช้เหตุการณ์นี้อยู่ — กฎจะยังอยู่แต่จะ "หลุด"` : "";
  const ok = await window.ConfirmModal.open({
    title: "ลบเหตุการณ์นี้?",
    message: `ลบ "${m?.label || key}" (${key}) — กู้คืนไม่ได้${warn}`,
    confirmText: "ลบ", danger: true,
  });
  if (!ok) return;
  try {
    await sbFetch(`notification_triggers?trigger_key=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
    await loadTriggers();
    if (trigEditKey === key) { trigEditKey = null; showEmpty(); }
    renderList();
    showToast("ลบแล้ว", "success");
  } catch (e) { showToast("ลบไม่สำเร็จ: " + e.message, "error"); }
}

// ── auto-gen SQL + โค้ดยิง ──
function sqlStr(s) { return "'" + String(s ?? "").replace(/'/g, "''") + "'"; }
function genTriggerSQL(key, m) {
  const arr = m.placeholders.length
    ? `ARRAY[${m.placeholders.map((p) => sqlStr(p)).join(", ")}]`
    : "ARRAY[]::TEXT[]";
  const sampleSql = sqlStr(JSON.stringify(m.sample || {})) + "::jsonb";
  return `INSERT INTO notification_triggers
  (trigger_key, label, kind, placeholders, sample, description, is_builtin, sort_order)
VALUES (
  ${sqlStr(key)}, ${sqlStr(m.label)}, 'on_status',
  ${arr},
  ${sampleSql},
  ${sqlStr(m.description || "")}, false, ${m.sort_order ?? 100}
)
ON CONFLICT (trigger_key) DO UPDATE SET
  label        = EXCLUDED.label,
  placeholders = EXCLUDED.placeholders,
  sample       = EXCLUDED.sample,
  description  = EXCLUDED.description,
  is_active    = EXCLUDED.is_active,
  sort_order   = EXCLUDED.sort_order;

NOTIFY pgrst, 'reload schema';`;
}
function genFireSnippet(key, m) {
  if (!m.placeholders.length) return `window.Notify?.notifyBell('${key}', {});`;
  const lines = m.placeholders.map((p) => `  ${p}: /* ค่า ${p} */,`).join("\n");
  return `window.Notify?.notifyBell('${key}', {\n${lines}\n});`;
}

// แสดงโค้ดของเหตุการณ์ที่กำลังแก้ — สร้าง meta จากฟอร์มปัจจุบัน (เห็นผลก่อนบันทึกได้)
function showTrigCode() {
  const key = (document.getElementById("tKey").value || "").trim();
  if (!key || key === "custom.") return showToast("ใส่รหัสเหตุการณ์ (key) ก่อน", "error");
  let sample = {};
  try { sample = JSON.parse(document.getElementById("tSample").value || "{}"); } catch (_) { sample = {}; }
  const m = {
    label: document.getElementById("tLabel").value.trim() || key,
    placeholders: trigPH,
    sample,
    description: document.getElementById("tDesc").value.trim(),
    sort_order: parseInt(document.getElementById("tSort").value, 10) || 100,
  };
  _trigSQL = genTriggerSQL(key, m);
  _trigSnippet = genFireSnippet(key, m);
  const box = document.getElementById("trigCode");
  box.innerHTML = `
    <div class="trig-code">
      <div class="trig-code-hd">
        🗄️ SQL สำหรับ DB — <span style="font-weight:400;color:var(--text3)">${escapeHtml(key)}</span>
        <button class="btn btn-ghost" onclick="window.copyTrigCode('sql')">📋 ก็อป SQL</button>
      </div>
      <pre>${escapeHtml(_trigSQL)}</pre>
      <details>
        <summary>&lt;/&gt; โค้ดยิงสำหรับโปรแกรมเมอร์ (ขั้นที่ทำให้กระดิ่งเด้งจริง)</summary>
        <div class="trig-code-hd" style="border-top:none">
          แปะตรงจุดที่เหตุการณ์เกิด
          <button class="btn btn-ghost" onclick="window.copyTrigCode('snippet')">📋 ก็อปโค้ด</button>
        </div>
        <pre>${escapeHtml(_trigSnippet)}</pre>
      </details>
    </div>`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
async function copyTrigCode(which) {
  const txt = which === "sql" ? _trigSQL : _trigSnippet;
  try {
    await navigator.clipboard.writeText(txt);
    showToast("ก็อปแล้ว", "success");
  } catch (_) {
    showToast("ก็อปไม่สำเร็จ — เลือกข้อความแล้วกด Ctrl+C", "error");
  }
}

// ── Helpers ───────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function showLoading(on) { const el = document.getElementById("loadingOverlay"); if (el) el.style.display = on ? "flex" : "none"; }
function showToast(msg, type = "success") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast toast-" + (type === "error" ? "error" : "success");
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
}

// mark ว่าผู้ใช้พิมพ์ key เอง (กัน auto-suggest ทับ)
document.addEventListener("DOMContentLoaded", () => {
  const k = document.getElementById("tKey");
  if (k) k.addEventListener("input", () => { k.dataset.touched = "1"; });
});

// ── Globals ───────────────────────────────────────────────
window.newTrig = newTrig;
window.selectTrig = selectTrig;
window.openTrigForm = openEditor;
window.onTrigLabelInput = onTrigLabelInput;
window.onTrigPHKey = onTrigPHKey;
window.removeTrigPH = removeTrigPH;
window.addPHFromRef = addPHFromRef;
window.regenTrigSample = regenTrigSample;
window.saveTrigger = saveTrigger;
window.deleteTrigger = deleteTrigger;
window.showTrigCode = showTrigCode;
window.copyTrigCode = copyTrigCode;

document.addEventListener("DOMContentLoaded", init);
