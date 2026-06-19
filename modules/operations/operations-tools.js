/* ============================================================
   operations-tools.js — 🧰 Utility Tools launcher + Simulator
   ------------------------------------------------------------
   หน้า "รวมเครื่องมือ" — แสดงเครื่องมือทุกตัวเป็น list
   กดแถวไหน → เปิด "simulator" (iframe พรีวิวหน้าเครื่องมือจริง) ใน modal
   · เครื่องมือ Utility (standalone) → โหลดหน้าได้เลย
   · เครื่องมือระดับโปรแกรม → มี dropdown เลือกโปรแกรม เพื่อจำลองด้วยข้อมูลจริง

   ┌── เพิ่มเครื่องมือ Utility = เพิ่ม 1 object ใน TOOLS ด้านล่าง ──┐
   │   {                                                          │
   │     icon:    "🪪",         // emoji ไอคอน                     │
   │     label:   "ชื่อเครื่องมือ",                                │
   │     desc:    "คำอธิบายสั้นๆ",                                 │
   │     href:    "../event/namecard-generator.html",             │
   │              // path relative จาก modules/operations/        │
   │     perm:    "events_view",// perm ที่ต้องมีถึงเห็นการ์ด       │
   │              //  (เว้นว่าง "" = ทุกคนเห็น)                     │
   │     section: "doc",        // อยู่กลุ่มไหน (ดู SECTIONS)        │
   │     ready:   true,         // false = ขึ้น "เร็วๆ นี้" กดไม่ได้ │
   │   }                                                          │
   └─ เพิ่มกลุ่มใหม่ = เพิ่ม 1 entry ใน SECTIONS ─────────────────┘
   เครื่องมือระดับโปรแกรม (participants/rooming/...) ดึงจาก
   js/shared/program-tools.js อัตโนมัติ — ไม่ต้องมาเพิ่มที่นี่
   ============================================================ */
(function () {
  "use strict";

  // กลุ่มเครื่องมือ Utility — เรียงตามลำดับที่อยากให้แสดง
  const SECTIONS = [
    { key: "doc",  label: "📄 เอกสาร & งานพิมพ์" },
  ];

  // เครื่องมือ Utility ทั้งหมด (เพิ่ม/ลบ/แก้ได้ตามต้องการ)
  const TOOLS = [
    // ── เอกสาร & งานพิมพ์ ──
    { icon: "🪪", label: "พิมพ์ป้าย & ใบประกาศ",
      desc: "ออกแบบ/พิมพ์ป้ายชื่อ ป้ายตั้งโต๊ะ และใบประกาศ",
      href: "../event/namecard-generator.html", perm: "events_view", section: "doc", ready: true },
    { icon: "📄", label: "สร้างเอกสาร / จดหมาย",
      desc: "ออกจดหมายหัวกระดาษจากเทมเพลต {{placeholder}} แล้วพิมพ์",
      href: "../trip/trip-docs.html", perm: "trip_docs_view", section: "doc", ready: true },
    { icon: "🪧", label: "ป้ายตั้งโต๊ะ (รายชื่อ)",
      desc: "ป้ายรายชื่อกลุ่ม/VIP บน A4 · โลโก้ + ภาพพื้นหลัง + เลขลำดับ",
      href: "../event/table-tent-generator.html", perm: "events_view", section: "doc", ready: true },
  ];

  /* ── perm check (degrade gracefully ถ้าไม่มี AuthZ) ── */
  function can(perm) {
    if (!perm) return true;
    return !window.AuthZ || window.AuthZ.hasPerm(perm);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  /* ── Supabase helper (ใช้ดึงรายการ programs ให้ simulator) ── */
  function getSB() {
    return {
      url: localStorage.getItem("sb_url") || "",
      key: localStorage.getItem("sb_key") || "",
    };
  }
  async function sbFetch(table, query = "", opts = {}) {
    const { url, key } = getSB();
    if (!url || !key) throw new Error("no-supabase");
    const { method = "GET", body } = opts;
    const res = await fetch(`${url}/rest/v1/${table}${query}`, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
        Prefer: (method === "POST" || method === "PATCH") ? "return=representation" : "" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error("api-error");
    return method === "DELETE" ? null : res.json().catch(() => null);
  }

  /* ════════════ RENDER (list) ════════════ */
  // registry รวมทุกเครื่องมือที่ render ออกมา (id → ข้อมูลสำหรับ simulator)
  const ITEMS = {};
  let _idSeq = 0;

  // util tool → item · url = href (relative จาก operations dir)
  function utilItem(t) {
    return { kind: "util", icon: t.icon, label: t.label, desc: t.desc,
      url: t.href, needsProgram: false, types: [], ready: t.ready !== false };
  }
  // program tool → item · url = ./path (อยู่ dir เดียวกัน) · ต้องมี program_id
  function progItem(t) {
    return { kind: "prog", icon: t.icon, label: t.label, desc: t.desc,
      url: t.path ? "./" + t.path : "", needsProgram: true,
      types: Array.isArray(t.types) ? t.types : [], ready: t.ready !== false };
  }

  // แถวเครื่องมือ (กดเพื่อเปิด simulator)
  function rowHTML(item, id) {
    const dead = !item.ready || !item.url;          // ยังไม่พร้อม/ไม่มีหน้า → กดไม่ได้
    const cls = "tool-card" + (dead ? " is-soon" : "");
    const onclick = dead ? "" : ` onclick="OperationsTools.openSim('${id}')"`;
    const status = item.kind === "prog"
      ? (dead ? '<span class="soon-tag">เร็วๆ นี้</span>'
              : '<span class="ready-tag">พร้อมใช้</span>')
      : "";
    const types = (item.types || [])
      .map((ty) => ty === "TRIP"
        ? '<span class="type-badge t-trip">✈️ Trip</span>'
        : '<span class="type-badge t-event">🎪 Event</span>')
      .join("");
    const tags = types ? `<div class="tool-card-tags">${types}</div>` : "";
    const arrow = dead ? "" : '<span class="tool-card-arrow" title="ดูตัวอย่าง">▶</span>';
    return `
      <div class="${cls}"${onclick}>
        <div class="tool-card-ic">${esc(item.icon)}</div>
        <div class="tool-card-body">
          <div class="tool-card-title">${esc(item.label)}${status}</div>
          <div class="tool-card-desc">${esc(item.desc)}</div>
        </div>
        <div class="tool-card-right">${tags}${arrow}</div>
      </div>`;
  }

  function sectionWrap(label, hint, rowsHTML) {
    const h = hint ? ` <span class="tools-section-hint">${hint}</span>` : "";
    return `
      <div class="tools-section">
        <div class="tools-section-hdr">${label}${h}<span class="ts-line"></span></div>
        <div class="tools-list">${rowsHTML}</div>
      </div>`;
  }

  function addRow(item) {
    const id = "t" + _idSeq++;
    ITEMS[id] = item;
    return rowHTML(item, id);
  }

  function render() {
    const root = document.getElementById("toolsContainer");
    if (!root) return;
    _idSeq = 0;
    for (const k in ITEMS) delete ITEMS[k];

    let html = "";
    const known = new Set(SECTIONS.map((s) => s.key));
    const visible = TOOLS.filter((t) => can(t.perm));

    // ── เครื่องมือ Utility (กรองตามสิทธิ์) ──
    for (const sec of SECTIONS) {
      const items = visible.filter((t) => t.section === sec.key);
      if (items.length)
        html += sectionWrap(sec.label, "", items.map((t) => addRow(utilItem(t))).join(""));
    }
    const orphans = visible.filter((t) => !known.has(t.section));
    if (orphans.length)
      html += sectionWrap("🧩 อื่นๆ", "", orphans.map((t) => addRow(utilItem(t))).join(""));

    // ── catalog เครื่องมือระดับโปรแกรม (ดึงจาก ProgramTools) ──
    const PT = window.ProgramTools;
    if (PT && Array.isArray(PT.TOOLS) && PT.TOOLS.length) {
      html += sectionWrap("🧭 เครื่องมือในโปรแกรม",
        "(กดเพื่อดูตัวอย่าง · เปิดใช้จริงในแต่ละโปรแกรม Trip/Event)",
        PT.TOOLS.map((t) => addRow(progItem(t))).join(""));
    }

    root.innerHTML = html || `<div class="tools-empty">ยังไม่มีเครื่องมือ</div>`;
  }

  /* ════════════ SIMULATOR (iframe พรีวิว + Sandbox ทดสอบ) ════════════
     เครื่องมือระดับโปรแกรม → ชี้ไปที่ "โปรแกรม Sandbox" (dummy · แยกจากของจริง)
     auto-create + seed ครั้งแรก · ปุ่ม ♻️ รีเซ็ตได้ทุกเมื่อ
     Sandbox ถูกซ่อนจากหน้า Operations Hub (filter ชื่อขึ้นต้น "🧪 Sandbox") */
  const SANDBOX_NAME = "🧪 Sandbox ทดสอบ";
  const SANDBOX_TOOLS = ["participants", "rooming", "buses", "flights", "seating", "staff", "tasks", "namecard", "reports"];
  let _sandboxId = null;
  let _simItem = null;

  async function seedSandbox(programId) {
    const names = [
      "สมชาย ใจดี", "สมหญิง รักเรียน", "อนันต์ มั่งมี", "พิมพ์ใจ ศรีสุข",
      "วิชัย ทองคำ", "มาลี ดอกไม้", "ธนา รุ่งเรือง", "กานดา แสงทอง",
      "ประยุทธ์ ก้าวหน้า", "ศิริพร ใจงาม", "ณัฐพล เพชรงาม", "อรอุมา ทิพย์",
    ];
    const rows = names.map((n, i) => ({
      program_id: programId, name: n,
      person_role: i % 5 === 4 ? "guest" : "primary",
      gender: i % 2 === 0 ? "male" : "female",
    }));
    await sbFetch("program_participants", "", { method: "POST", body: rows });
  }

  // หา Sandbox program (สร้าง+seed ถ้ายังไม่มี) → คืน program_id
  async function ensureSandbox() {
    if (_sandboxId) return _sandboxId;
    try {
      const found = await sbFetch("programs",
        `?select=program_id&name=eq.${encodeURIComponent(SANDBOX_NAME)}&limit=1`);
      if (Array.isArray(found) && found.length) { _sandboxId = found[0].program_id; return _sandboxId; }
      const created = await sbFetch("programs", "", {
        method: "POST",
        body: { name: SANDBOX_NAME, program_type: "TRIP", status: "ACTIVE", enabled_tools: SANDBOX_TOOLS },
      });
      const row = Array.isArray(created) ? created[0] : created;
      _sandboxId = row && row.program_id;
      if (_sandboxId) await seedSandbox(_sandboxId);
      return _sandboxId;
    } catch (e) { return null; }
  }

  function setFrame(url) {
    const fr = document.getElementById("simFrame");
    const ld = document.getElementById("simLoading");
    const open = document.getElementById("simOpen");
    if (ld) ld.style.display = url === "about:blank" ? "none" : "flex";
    if (fr) {
      fr.onload = () => {
        if (ld) ld.style.display = "none";
        // ซ่อน sidebar ใน iframe ให้พรีวิวสะอาด (same-origin) — เงียบถ้าทำไม่ได้
        try {
          const doc = fr.contentDocument;
          if (doc && doc.head && !doc.getElementById("__simEmbed")) {
            const st = doc.createElement("style");
            st.id = "__simEmbed";
            st.textContent =
              "#erp-sidebar,#sb-hamburger,#sb-overlay{display:none!important}";
            doc.head.appendChild(st);
          }
        } catch (e) {}
      };
      fr.src = url;
    }
    if (open) {
      if (url === "about:blank") open.removeAttribute("href");
      else open.href = url;
    }
  }

  async function openSim(id) {
    const item = ITEMS[id];
    if (!item || !item.url) return;
    _simItem = item;

    document.getElementById("simIcon").textContent = item.icon || "🧰";
    document.getElementById("simName").textContent = item.label || "เครื่องมือ";
    const badge = document.getElementById("simSandboxBadge");
    const resetBtn = document.getElementById("simResetBtn");
    const note = document.getElementById("simNote");
    note.className = "sim-note"; note.textContent = "";
    badge.style.display = "none"; resetBtn.style.display = "none";

    document.getElementById("simOverlay").classList.add("open");

    if (!item.needsProgram) {
      setFrame(item.url);   // เครื่องมือ standalone — โหลดได้เลย
      return;
    }

    // เครื่องมือระดับโปรแกรม → ใช้ Sandbox (ข้อมูล dummy · ไม่กระทบของจริง)
    badge.style.display = "";
    setFrame("about:blank");
    const sbId = await ensureSandbox();
    if (_simItem !== item) return;   // race: ผู้ใช้กดเครื่องมืออื่นระหว่างรอ
    if (!sbId) {
      note.className = "sim-note show";
      note.textContent = "สร้าง Sandbox ไม่สำเร็จ — เช็คการเชื่อมต่อ Supabase แล้วลองใหม่";
      return;
    }
    resetBtn.style.display = "";
    note.className = "sim-note show";
    note.textContent = "🧪 โหมดทดสอบ — ข้อมูลทั้งหมดอยู่ใน Sandbox แยกต่างหาก ไม่กระทบทริป/อีเวนต์จริง · กด ♻️ เพื่อล้างข้อมูลทดสอบ";
    setFrame(item.url + "?program_id=" + sbId);
  }

  // ลบ Sandbox (cascade ลบลูกหมด) แล้วสร้าง+seed ใหม่ → reset ข้อมูลทดสอบ
  async function resetSandbox() {
    if (!_sandboxId) return;
    const ok = window.ConfirmModal
      ? await window.ConfirmModal.open({ title: "♻️ รีเซ็ต Sandbox", message: "ล้างข้อมูลทดสอบทั้งหมดใน Sandbox แล้วเริ่มใหม่?" })
      : true;
    if (!ok) return;
    const fr = document.getElementById("simFrame");
    if (fr) fr.src = "about:blank";
    try { await sbFetch("programs", `?program_id=eq.${_sandboxId}`, { method: "DELETE" }); } catch (e) {}
    _sandboxId = null;
    const sbId = await ensureSandbox();
    if (_simItem && _simItem.needsProgram && sbId) setFrame(_simItem.url + "?program_id=" + sbId);
  }

  function closeSim() {
    const ov = document.getElementById("simOverlay");
    if (ov) ov.classList.remove("open");
    const fr = document.getElementById("simFrame");
    if (fr) fr.src = "about:blank";   // หยุด iframe คืน resource
    _simItem = null;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }

  // expose
  window.OperationsTools = {
    TOOLS, SECTIONS, render,
    openSim, closeSim, resetSandbox,
  };
})();
