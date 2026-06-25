/* ============================================================
   survey-fill.js — Public satisfaction survey (no login)
   ใช้ anon key จาก register-config.js (window.REGISTER_CONFIG)
   เปิดได้ 2 แบบ:
     ?event=<event_id>  → resolve ฟอร์มจาก events.survey_form_id (ผูกกับงาน)
     ?form=<token>      → standalone (public_token) · event_id = null
============================================================ */

const SB_URL = localStorage.getItem("sb_url") || window.REGISTER_CONFIG?.sb_url || "";
const SB_KEY = localStorage.getItem("sb_key") || window.REGISTER_CONFIG?.sb_key || "";

let _form = null;       // survey_forms row
let _eventId = null;    // ผูกกับงาน (ถ้ามี)
const _answers = {};    // { question_id: value }

// ── REST helpers ───────────────────────────────────────────
async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ (${res.status})`);
  return res.json();
}
async function sbPost(path, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || `Error ${res.status}`);
  }
  return res.json().catch(() => null);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3200);
}
function show(id) {
  ["stateLoading", "stateClosed", "stateDone", "content"].forEach(s =>
    document.getElementById(s).classList.toggle("hidden", s !== id));
}
function closed(msg, icon = "🔒") {
  document.getElementById("closedIcon").textContent = icon;
  document.getElementById("closedMsg").textContent = msg;
  show("stateClosed");
}

// ── Boot ───────────────────────────────────────────────────
async function boot() {
  if (!SB_URL || !SB_KEY) return closed("ระบบยังไม่พร้อมใช้งาน", "⚙️");
  const params = new URLSearchParams(location.search);
  const token = params.get("form");
  const eventId = params.get("event");

  try {
    if (eventId) {
      const rows = await sbGet(
        `events?select=event_id,event_name,survey_form_id&event_id=eq.${encodeURIComponent(eventId)}&limit=1`);
      const ev = rows && rows[0];
      if (!ev) return closed("ไม่พบกิจกรรม");
      if (!ev.survey_form_id) return closed("กิจกรรมนี้ยังไม่ได้ตั้งแบบประเมิน", "📝");
      _eventId = ev.event_id;
      const forms = await sbGet(`survey_forms?select=*&id=eq.${ev.survey_form_id}&limit=1`);
      _form = forms && forms[0];
      if (_form) _form._event_name = ev.event_name;
    } else if (token) {
      const forms = await sbGet(
        `survey_forms?select=*&public_token=eq.${encodeURIComponent(token)}&limit=1`);
      _form = forms && forms[0];
    } else {
      return closed("ลิงก์ไม่ถูกต้อง — ไม่มีรหัสแบบประเมิน");
    }

    if (!_form) return closed("ไม่พบแบบประเมิน");
    if (_form.is_active === false) return closed("แบบประเมินนี้ปิดรับความเห็นแล้ว");
    if (!Array.isArray(_form.questions) || !_form.questions.length)
      return closed("แบบประเมินนี้ยังไม่มีคำถาม", "📝");

    renderForm();
    show("content");
  } catch (e) {
    closed("เกิดข้อผิดพลาด: " + e.message, "⚠️");
  }
}

// ── Render ─────────────────────────────────────────────────
function renderForm() {
  document.getElementById("svTitle").textContent = _form.title || "แบบประเมิน";
  const introEl = document.getElementById("svIntro");
  if (_form.intro_text) { introEl.textContent = _form.intro_text; introEl.classList.remove("hidden"); }
  else introEl.classList.add("hidden");

  const evEl = document.getElementById("svEvent");
  if (_form._event_name) { evEl.textContent = "🎪 " + _form._event_name; evEl.classList.remove("hidden"); }

  const wrap = document.getElementById("svQuestions");
  wrap.innerHTML = _form.questions.map((q, i) => renderQuestion(q, i + 1)).join("");
}

function renderQuestion(q, num) {
  const reqStar = q.required !== false ? ' <span class="req">*</span>' : ' <span class="opt">(ไม่บังคับ)</span>';
  const head = `<label><span class="sv-q-num">${num}.</span>${esc(q.label)}${reqStar}</label>`;
  let body = "";

  if (q.type === "rating") {
    const max = q.scale_max || 5;
    if ((q.scale_style || "star") === "number") {
      let pills = "";
      for (let n = 1; n <= max; n++)
        pills += `<button type="button" class="sv-num" data-v="${n}" onclick="pickRating('${q.id}',${n})">${n}</button>`;
      body = `<div class="sv-numscale" id="rate_${q.id}">${pills}</div>`;
    } else {
      let stars = "";
      for (let n = 1; n <= max; n++)
        stars += `<span class="sv-star" data-v="${n}" onclick="pickRating('${q.id}',${n})">⭐</span>`;
      body = `<div class="sv-stars" id="rate_${q.id}">${stars}</div>`;
    }
    if (q.scale_min_label || q.scale_max_label) {
      body += `<div class="sv-scale-labels"><span>${esc(q.scale_min_label || "")}</span><span>${esc(q.scale_max_label || "")}</span></div>`;
    }
  } else if (q.type === "choice" || q.type === "multichoice") {
    const inputType = q.type === "choice" ? "radio" : "checkbox";
    body = (q.options || []).map((opt, oi) =>
      `<label class="sv-opt" id="opt_${q.id}_${oi}">
        <input type="${inputType}" name="q_${q.id}" value="${esc(opt)}"
          onchange="pickOption('${q.id}','${q.type}', this)">
        <span>${esc(opt)}</span>
      </label>`).join("");
  } else if (q.type === "textarea") {
    body = `<textarea oninput="setText('${q.id}', this.value)" placeholder="พิมพ์ความเห็นของท่าน..."></textarea>`;
  } else if (q.type === "number") {
    body = `<input type="number" oninput="setText('${q.id}', this.value)" placeholder="ระบุตัวเลข" />`;
  } else { // text
    body = `<input type="text" oninput="setText('${q.id}', this.value)" placeholder="พิมพ์คำตอบ" />`;
  }

  return `<div class="sv-fg sv-q" id="qwrap_${q.id}">${head}${body}</div>`;
}

// ── Input handlers ─────────────────────────────────────────
window.pickRating = function (qid, val) {
  _answers[qid] = val;
  const box = document.getElementById("rate_" + qid);
  if (!box) return;
  box.querySelectorAll("[data-v]").forEach(el => {
    el.classList.toggle("on", parseInt(el.dataset.v) <= val);
  });
  clearInvalid(qid);
};
window.pickOption = function (qid, type, input) {
  if (type === "choice") {
    _answers[qid] = input.value;
    const wrap = document.getElementById("qwrap_" + qid);
    wrap.querySelectorAll(".sv-opt").forEach(o => o.classList.remove("on"));
    input.closest(".sv-opt").classList.add("on");
  } else {
    const wrap = document.getElementById("qwrap_" + qid);
    const vals = [...wrap.querySelectorAll("input:checked")].map(i => i.value);
    _answers[qid] = vals;
    input.closest(".sv-opt").classList.toggle("on", input.checked);
  }
  clearInvalid(qid);
};
window.setText = function (qid, val) {
  _answers[qid] = val;
  if (String(val).trim()) clearInvalid(qid);
};
function clearInvalid(qid) {
  document.getElementById("qwrap_" + qid)?.classList.remove("invalid");
}

// ── Submit ─────────────────────────────────────────────────
function isAnswered(q) {
  const v = _answers[q.id];
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== "";
}

window.doSubmit = async function () {
  const msg = document.getElementById("svMsg");
  msg.innerHTML = "";

  // validate required
  const missing = _form.questions.filter(q => q.required !== false && !isAnswered(q));
  if (missing.length) {
    missing.forEach(q => document.getElementById("qwrap_" + q.id)?.classList.add("invalid"));
    msg.innerHTML = `<div class="sv-err">กรุณาตอบคำถามที่บังคับให้ครบ (${missing.length} ข้อ)</div>`;
    document.getElementById("qwrap_" + missing[0].id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const btn = document.getElementById("svSubmit");
  btn.disabled = true;
  btn.textContent = "กำลังส่ง...";
  try {
    await sbPost("survey_responses", {
      form_id: _form.id,
      event_id: _eventId,
      answers: _answers,
      respondent_name: document.getElementById("svName").value.trim() || null,
    });
    document.getElementById("doneMsg").textContent =
      _form.thank_you_text || "ขอบคุณสำหรับความคิดเห็นของท่านค่ะ 🙏";
    show("stateDone");
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "✅ ส่งแบบประเมิน";
    msg.innerHTML = `<div class="sv-err">ส่งไม่สำเร็จ: ${esc(e.message)}</div>`;
  }
};

boot();
