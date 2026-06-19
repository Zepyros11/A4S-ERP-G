/* ============================================================
   program-reports.js — เครื่องมือ "รายงาน / Export"
   รวม participant + ห้อง + โต๊ะ → เลือกคอลัมน์ → preview + CSV
   ============================================================ */

const COLS = [
  { key: "name", label: "ชื่อ" },
  { key: "role", label: "บทบาท" },
  { key: "member_code", label: "รหัสสมาชิก" },
  { key: "gender", label: "เพศ" },
  { key: "checked_in", label: "เช็คอิน" },
  { key: "room", label: "ห้อง" },
  { key: "table", label: "โต๊ะ" },
];

const state = { programId: null, program: null, rows: [] };

function getSB() { return { url: localStorage.getItem("sb_url") || "", key: localStorage.getItem("sb_key") || "" }; }
async function sbFetch(table, query = "") {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/${table}${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error("API Error");
  return res.json().catch(() => null);
}

async function init() {
  const params = new URLSearchParams(location.search);
  state.programId = parseInt(params.get("program_id"), 10);
  document.getElementById("backLink").href = state.programId ? `./program-workspace.html?program_id=${state.programId}` : "./operations-hub.html";
  if (!state.programId) { document.getElementById("progName").textContent = "⚠️ ไม่พบ program_id"; return; }
  const { url, key } = getSB();
  if (!url || !key) { showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error"); return; }

  // column checkboxes
  document.getElementById("colChks").innerHTML = COLS.map((c) =>
    `<label class="rp-chk"><input type="checkbox" value="${c.key}" checked onchange="window.render()"> ${c.label}</label>`).join("");

  showLoading(true);
  try {
    const [prog, pax, rooms, tables] = await Promise.all([
      sbFetch("programs", `?program_id=eq.${state.programId}&select=*`),
      sbFetch("program_participants", `?program_id=eq.${state.programId}&select=participant_id,name,member_code,gender,checked_in,person_role&order=person_role,participant_id`),
      sbFetch("program_rooms", `?program_id=eq.${state.programId}&select=room_id,room_name`).catch(() => []),
      sbFetch("program_seating_tables", `?program_id=eq.${state.programId}&select=table_id,table_name`).catch(() => []),
    ]);
    state.program = prog && prog[0];
    const roomIds = (rooms || []).map((r) => r.room_id);
    const tableIds = (tables || []).map((t) => t.table_id);
    const [occ, asg] = await Promise.all([
      roomIds.length ? sbFetch("program_room_occupants", `?room_id=in.(${roomIds.join(",")})&select=room_id,participant_id`).catch(() => []) : Promise.resolve([]),
      tableIds.length ? sbFetch("program_seating_assignments", `?table_id=in.(${tableIds.join(",")})&select=table_id,participant_id`).catch(() => []) : Promise.resolve([]),
    ]);
    const roomName = {}; (rooms || []).forEach((r) => (roomName[r.room_id] = r.room_name));
    const tableName = {}; (tables || []).forEach((t) => (tableName[t.table_id] = t.table_name));
    const pRoom = {}; (occ || []).forEach((o) => (pRoom[o.participant_id] = roomName[o.room_id] || ""));
    const pTable = {}; (asg || []).forEach((a) => (pTable[a.participant_id] = tableName[a.table_id] || ""));

    state.rows = (pax || []).map((x) => ({
      name: x.name || "",
      role: { primary: "หลัก", co_applicant: "ผู้ร่วม", guest: "แขก" }[x.person_role] || "หลัก",
      member_code: x.member_code || "",
      gender: x.gender === "male" ? "ชาย" : x.gender === "female" ? "หญิง" : "",
      checked_in: x.checked_in ? "✓" : "",
      room: pRoom[x.participant_id] || "",
      table: pTable[x.participant_id] || "",
    }));

    document.getElementById("progType").textContent = (state.program?.program_type || "TRIP") === "TRIP" ? "✈️ Trip" : "🎪 Event";
    document.getElementById("progName").textContent = `${state.program?.name || "—"} · รายงาน`;
    render();
  } catch (e) { showToast("โหลดข้อมูลไม่ได้: " + e.message, "error"); }
  showLoading(false);
}

function selectedCols() {
  const checked = [...document.querySelectorAll("#colChks input:checked")].map((c) => c.value);
  return COLS.filter((c) => checked.includes(c.key));
}

window.render = function () {
  const cols = selectedCols();
  const table = document.getElementById("rpTable");
  document.getElementById("cnt").textContent = `${state.rows.length} แถว`;
  table.querySelector("thead").innerHTML = `<tr><th style="width:44px;text-align:center">#</th>${cols.map((c) => `<th>${c.label}</th>`).join("")}</tr>`;
  const tb = table.querySelector("tbody");
  if (!state.rows.length) { tb.innerHTML = `<tr><td colspan="${cols.length + 1}"><div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">ยังไม่มีรายชื่อ — เพิ่มที่ "รายชื่อผู้เข้าร่วม"</div></div></td></tr>`; return; }
  tb.innerHTML = state.rows.map((r, i) =>
    `<tr><td style="text-align:center;color:var(--text3);font-size:12px">${i + 1}</td>${cols.map((c) => `<td>${escapeHtml(r[c.key])}</td>`).join("")}</tr>`).join("");
};

window.exportCsv = function () {
  const cols = selectedCols();
  if (!cols.length) { showToast("เลือกคอลัมน์อย่างน้อย 1", "error"); return; }
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.map((c) => esc(c.label)).join(",")];
  state.rows.forEach((r) => lines.push(cols.map((c) => esc(r[c.key])).join(",")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(state.program?.name || "report").replace(/[^\w฀-๿-]+/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

function escapeHtml(s) { return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]); }
function showToast(msg, type = "success") { const t = document.getElementById("toast"); if (!t) return; t.className = `toast toast-${type} show`; t.textContent = msg; setTimeout(() => t.classList.remove("show"), 3000); }
function showLoading(show) { document.getElementById("loadingOverlay")?.classList.toggle("show", show); }

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
