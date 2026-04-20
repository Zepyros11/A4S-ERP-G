/* ============================================================
   ticket-generator.js — สร้างบัตรผู้เข้าร่วมพร้อม QR (styled)
   ------------------------------------------------------------
   ใช้:
     ?event=123  (required)
   แสดงรายชื่อ attendees → เลือก → preview บัตรด้วย event.qr_style_config
   Actions: Download PNG / Print / ส่ง LINE (ทีละคน หรือหมด)
   ============================================================ */

const qs = new URLSearchParams(location.search);
const EVENT_ID = qs.get("event") || qs.get("event_id") || "";

const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";

let currentEvent = null;
let qrConfig = null;
let attendees = [];
let selectedAtt = null;

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function showLoading(on) {
  document.getElementById("loadingOverlay")?.classList.toggle("active", on);
}

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

function escapeHtml(s) {
  return String(s || "").replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function formatEventDate(dateStr, endStr) {
  if (!dateStr) return "—";
  try {
    const fmt = window.DateFmt?.formatDMY ? window.DateFmt.formatDMY : (d) => d;
    const s = fmt(dateStr);
    if (endStr && endStr !== dateStr) return `${s} – ${fmt(endStr)}`;
    return s;
  } catch { return dateStr; }
}

/* ── Init ── */
document.addEventListener("DOMContentLoaded", async () => {
  if (!EVENT_ID) {
    showToast("ไม่พบ event_id ใน URL", "error");
    return;
  }
  showLoading(true);
  try {
    // 1) Load event + config
    const rows = await sbGet(
      `events?event_id=eq.${encodeURIComponent(EVENT_ID)}&select=event_id,event_name,event_date,end_date,qr_style_config,poster_url,image_urls&limit=1`,
    );
    currentEvent = rows?.[0];
    if (!currentEvent) {
      showToast("ไม่พบ event นี้", "error");
      return;
    }
    qrConfig = currentEvent.qr_style_config
      || (await window.QRDesigner.getEffectiveConfig(EVENT_ID));
    currentEvent.posterUrl = currentEvent.poster_url
      || (Array.isArray(currentEvent.image_urls) ? currentEvent.image_urls[0] : null)
      || null;

    // Update header
    document.getElementById("tkEventChip").textContent = currentEvent.event_name;
    document.getElementById("tkEventChip").style.display = "inline-block";
    document.getElementById("tkEventName").textContent = currentEvent.event_name;
    document.getElementById("tkEventDate").innerHTML =
      `<span>📅</span><span>${formatEventDate(currentEvent.event_date, currentEvent.end_date)}</span>`;

    // 2) Load attendees
    await loadAttendees();
    bindSearch();
  } catch (e) {
    console.error(e);
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  } finally {
    showLoading(false);
  }
});

async function loadAttendees() {
  const rows = await sbGet(
    `event_attendees?event_id=eq.${encodeURIComponent(EVENT_ID)}&select=attendee_id,name,member_code,ticket_no,line_user_id,tier_id&order=attendee_id.asc`,
  );
  attendees = rows || [];
  document.getElementById("tkCount").textContent = `${attendees.length} คน`;
  renderList();
  if (attendees.length) selectAttendee(attendees[0]);
}

function renderList() {
  const q = document.getElementById("tkSearch").value.trim().toLowerCase();
  const list = document.getElementById("tkList");
  const filtered = !q
    ? attendees
    : attendees.filter((a) => {
        const hay = [a.name, a.member_code, a.ticket_no].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
  if (!filtered.length) {
    list.innerHTML = `<div class="tk-empty">ไม่พบผู้เข้าร่วม</div>`;
    return;
  }
  list.innerHTML = filtered.map((a) => {
    const isActive = selectedAtt?.attendee_id === a.attendee_id;
    const lineTag = a.line_user_id ? '<span class="tk-att-tag" style="background:#dcfce7;color:#15803d;">💬</span>' : "";
    return `<div class="tk-att ${isActive ? "active" : ""}" onclick="selectAttendeeById(${a.attendee_id})">
      <div class="tk-att-name">${escapeHtml(a.name || "—")} ${lineTag}</div>
      <div class="tk-att-meta">
        ${a.member_code ? `#${escapeHtml(a.member_code)} · ` : ""}${escapeHtml(a.ticket_no || `ID-${a.attendee_id}`)}
      </div>
    </div>`;
  }).join("");
}

function bindSearch() {
  document.getElementById("tkSearch").addEventListener("input", renderList);
}

window.selectAttendeeById = function (id) {
  const a = attendees.find((x) => x.attendee_id === id);
  if (a) selectAttendee(a);
};

async function selectAttendee(a) {
  selectedAtt = a;
  // update UI meta
  document.getElementById("tkAttName").textContent = a.name || "—";
  document.getElementById("tkAttCode").textContent =
    (a.member_code ? `รหัสสมาชิก ${a.member_code}` : "") || "";
  document.getElementById("tkTicketNo").textContent = a.ticket_no || `ID-${a.attendee_id}`;
  // disable LINE button if no line_user_id
  document.getElementById("tkBtnLine").disabled = !a.line_user_id;
  document.getElementById("tkBtnLine").style.opacity = a.line_user_id ? "1" : "0.5";
  renderList();
  await renderTicketQR(a);
}

async function renderTicketQR(att) {
  const wrap = document.getElementById("tkQrWrap");
  const payload = att.ticket_no || `A4S-ATT-${att.attendee_id}`;
  wrap.innerHTML = "";
  try {
    await window.QRDesigner.renderQR(wrap, payload, qrConfig, {
      posterUrl: currentEvent?.posterUrl,
    });
  } catch (e) {
    wrap.innerHTML = `<div style="padding:30px;color:#dc2626;font-size:12px;">${e.message}</div>`;
  }
}

/* ── Download ticket as PNG (whole ticket as image) ── */
async function ticketToCanvas(ticketEl) {
  // Use html2canvas if available; else fallback to manual canvas composition
  if (!window.html2canvas) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return await window.html2canvas(ticketEl, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });
}

window.downloadTicket = async function (ext = "png") {
  if (!selectedAtt) return showToast("ยังไม่ได้เลือกผู้เข้าร่วม", "warning");
  showLoading(true);
  try {
    const canvas = await ticketToCanvas(document.getElementById("tkTicket"));
    const ticketNo = selectedAtt.ticket_no || `ATT${selectedAtt.attendee_id}`;
    const safeName = `ticket-${String(ticketNo).replace(/[^a-z0-9-_]/gi, "_")}`;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${safeName}.png`;
    a.click();
  } catch (e) {
    showToast("ดาวน์โหลดไม่ได้: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

window.printTicket = function () {
  if (!selectedAtt) return showToast("ยังไม่ได้เลือกผู้เข้าร่วม", "warning");
  // Use browser print (CSS @media print hides everything except tk-ticket)
  const original = document.getElementById("tkPrintArea").style.display;
  document.getElementById("tkPrintArea").style.display = "block";
  document.getElementById("tkPrintArea").innerHTML = document.getElementById("tkTicket").outerHTML;
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.getElementById("tkPrintArea").style.display = original;
      document.getElementById("tkPrintArea").innerHTML = "";
    }, 200);
  }, 100);
};

/* ── Bulk download ── */
window.downloadAllTickets = async function () {
  if (!attendees.length) return;
  if (!confirm(`ดาวน์โหลดบัตร ${attendees.length} ใบ (ไฟล์ละ PNG)?`)) return;
  showBulkBar(true);
  let ok = 0;
  for (let i = 0; i < attendees.length; i++) {
    const a = attendees[i];
    updateBulkStatus(`${i + 1} / ${attendees.length} — ${a.name || a.attendee_id}`, (i + 1) / attendees.length);
    await selectAttendee(a);
    // wait a tick for QR to render
    await new Promise((r) => setTimeout(r, 250));
    try {
      const canvas = await ticketToCanvas(document.getElementById("tkTicket"));
      const ticketNo = a.ticket_no || `ATT${a.attendee_id}`;
      const safeName = `ticket-${String(ticketNo).replace(/[^a-z0-9-_]/gi, "_")}`;
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `${safeName}.png`;
      link.click();
      ok++;
      await new Promise((r) => setTimeout(r, 200));
    } catch (e) {
      console.warn("download fail", a.attendee_id, e);
    }
  }
  showBulkBar(false);
  showToast(`ดาวน์โหลดเสร็จ ${ok} / ${attendees.length} ใบ`, "success");
};

window.printAllTickets = async function () {
  if (!attendees.length) return;
  if (!confirm(`พิมพ์บัตร ${attendees.length} ใบ (2 ใบ/หน้า A4)?`)) return;
  showBulkBar(true);
  const area = document.getElementById("tkPrintArea");
  area.innerHTML = "";
  area.style.display = "block";
  for (let i = 0; i < attendees.length; i++) {
    const a = attendees[i];
    updateBulkStatus(`สร้าง ${i + 1} / ${attendees.length}`, (i + 1) / attendees.length);
    await selectAttendee(a);
    await new Promise((r) => setTimeout(r, 250));
    const clone = document.getElementById("tkTicket").cloneNode(true);
    // convert QR canvas to img to survive print
    const canvas = clone.querySelector("canvas");
    if (canvas) {
      const img = document.createElement("img");
      img.src = canvas.toDataURL("image/png");
      img.style.cssText = canvas.style.cssText;
      img.width = canvas.width; img.height = canvas.height;
      canvas.parentNode.replaceChild(img, canvas);
    }
    area.appendChild(clone);
  }
  showBulkBar(false);
  setTimeout(() => {
    window.print();
    setTimeout(() => { area.style.display = "none"; area.innerHTML = ""; }, 500);
  }, 300);
};

function showBulkBar(show) {
  document.getElementById("tkBulkBar").style.display = show ? "flex" : "none";
  if (!show) {
    document.getElementById("tkProgress").style.width = "0";
    document.getElementById("tkBulkStatus").textContent = "-";
  }
}
function updateBulkStatus(text, ratio) {
  document.getElementById("tkBulkStatus").textContent = text;
  document.getElementById("tkProgress").style.width = `${Math.round(ratio * 100)}%`;
}

/* ── Send LINE (uses existing LineAPI for one attendee) ── */
window.sendTicketLine = async function () {
  if (!selectedAtt?.line_user_id) return showToast("ผู้เข้าร่วมคนนี้ยังไม่ผูก LINE", "warning");
  if (!confirm(`ส่งบัตรไปให้ ${selectedAtt.name} ผ่าน LINE?`)) return;
  showLoading(true);
  try {
    if (!window.ERPCrypto?.hasMasterKey()) {
      throw new Error("ยังไม่ได้ตั้ง Master Key — ไปที่หน้าตั้งค่า");
    }
    const channel = await window.LineAPI.getChannelForEvent(currentEvent);
    if (!channel) throw new Error("ไม่มี LINE channel ที่ใช้ได้");
    // Build ticket as PNG, upload somewhere... simplest: send as text with ticket_no + Flex with QR
    // For now: send a text message + let admin use separate bulk Flex flow (already exists in attendees.js)
    const msg = `🎫 บัตร ${currentEvent.event_name}\n\n👤 ${selectedAtt.name}\n🎟 Ticket: ${selectedAtt.ticket_no || "ID-" + selectedAtt.attendee_id}\n\n👉 แสดงบัตรนี้ที่หน้างานเพื่อ check-in`;
    await window.LineAPI.push({ channel, to: selectedAtt.line_user_id, message: msg });
    showToast(`ส่งให้ ${selectedAtt.name} แล้ว`, "success");
  } catch (e) {
    showToast("ส่งไม่ได้: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

window.openDesigner = function () {
  if (!EVENT_ID) return;
  location.href = `event-qr-designer.html?event_id=${EVENT_ID}`;
};
