/* ============================================================
   web-pages.js — จัดการหน้าเว็บ (list + ข้อมูลหน้า)
   ============================================================
   หน้านี้คุมแค่ "มีหน้าอะไรบ้าง" (ชื่อ/URL/สถานะ/หน้าแรก)
   ส่วน layout + เนื้อหาข้างในไปแก้ที่ web-editor.html?id=<id>
   ============================================================ */

const state = { pages: [], editId: null };

/* ── Supabase REST (idiom เดียวกับ units-list.js) ── */
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function showLoading(show) {
  document.getElementById("loadingOverlay")?.classList.toggle("show", show);
}

/* ============================================================
   Load + render
   ============================================================ */
async function loadPages() {
  try {
    showLoading(true);
    state.pages = (await sbFetch("web_pages", "?select=*&order=is_home.desc,title")) || [];
    renderTable();
  } catch (e) {
    console.error(e);
    showToast("โหลดไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

function visiblePages() {
  const q = (document.getElementById("searchInput").value || "").trim().toLowerCase();
  const st = document.getElementById("filterStatus").value;
  return state.pages.filter((p) => {
    if (st && p.status !== st) return false;
    if (!q) return true;
    return (p.title || "").toLowerCase().includes(q) || (p.slug || "").toLowerCase().includes(q);
  });
}

function renderTable() {
  const tbody = document.getElementById("tableBody");
  const rows = visiblePages();
  const fmt = (window.DateFmt && window.DateFmt.formatDMYTime) || ((s) => s || "");

  document.getElementById("tableCount").textContent = `${rows.length} หน้า`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-title">ยังไม่มีหน้าเว็บ</div>
        <div class="empty-state-hint">กด "＋ เพิ่มหน้า" เพื่อเริ่มต้น — ถ้าเพิ่งติดตั้ง ให้รัน sql/171_web_pages.sql ก่อน</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (p) => `<tr>
      <td class="col-center r-card-corner" onclick="event.stopPropagation()">
        <input type="checkbox" class="row-check" value="${p.id}" onchange="window.updateDeleteButton()" />
      </td>
      <td data-label="ชื่อหน้า">
        <strong>${esc(p.title)}</strong>
        ${p.is_home ? '<span class="status-badge status-active" style="margin-left:6px">🏠 หน้าแรก</span>' : ""}
      </td>
      <td data-label="URL" style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text2)">/${esc(p.slug)}</td>
      <td class="col-center" data-label="สถานะ">
        <span class="status-badge ${p.status === "published" ? "status-active" : "status-inactive"}">
          ${p.status === "published" ? "● เผยแพร่" : "● ฉบับร่าง"}
        </span>
      </td>
      <td class="col-center" data-label="แก้ไขล่าสุด" style="white-space:nowrap;color:var(--text2);font-size:12px">
        ${fmt(p.updated_at)}${p.updated_by ? `<br /><span style="font-size:11px">${esc(p.updated_by)}</span>` : ""}
      </td>
      <td class="col-center" data-label="จัดการ">
        <div class="action-group">
          <button class="btn-icon" title="แก้ไข layout + เนื้อหา" data-perm="web_pages_edit"
            onclick="location.href='./web-editor.html?id=${p.id}'">✏️</button>
          <button class="btn-icon" title="ดูหน้านี้" onclick="window.open('./web-view.html?slug=${encodeURIComponent(p.slug)}','_blank','noopener')">👁️</button>
          <button class="btn-icon" title="แก้ข้อมูลหน้า" data-perm="web_pages_edit"
            onclick="window.openPageModal(${p.id})">⚙️</button>
          <button class="btn-icon danger" title="ลบ" data-perm="web_pages_delete"
            onclick="window.deletePage(${p.id})">🗑️</button>
        </div>
      </td>
    </tr>`
    )
    .join("");

  /* DOMContentLoaded ยิงไปแล้ว — แถวที่เพิ่งวาดต้อง apply perm เอง */
  if (window.AuthZ) window.AuthZ.applyDomPerms(tbody);
}

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* ============================================================
   Selection + bulk delete
   ============================================================ */
function getSelectedIds() {
  return Array.from(document.querySelectorAll(".row-check:checked")).map((c) => parseInt(c.value));
}

function syncSelectAllState() {
  const all = document.querySelectorAll(".row-check");
  const checked = document.querySelectorAll(".row-check:checked");
  const selectAll = document.getElementById("selectAllCheckbox");
  if (!selectAll) return;
  selectAll.checked = all.length > 0 && checked.length === all.length;
  selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
}

window.updateDeleteButton = function () {
  const btn = document.getElementById("btnDeleteSelected");
  const ids = getSelectedIds();
  if (btn) {
    btn.style.display = ids.length ? "inline-flex" : "none";
    btn.textContent = `🗑 ลบที่เลือก (${ids.length})`;
  }
  syncSelectAllState();
};

window.toggleAllCheckbox = function (el) {
  document.querySelectorAll(".row-check").forEach((c) => (c.checked = el.checked));
  window.updateDeleteButton();
};

window.deleteSelectedPages = function () {
  const ids = getSelectedIds();
  if (!ids.length) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const hasHome = state.pages.some((p) => ids.includes(p.id) && p.is_home);
  const warn = hasHome
    ? " ⚠️ มีหน้า default อยู่ในรายการที่เลือก — ลบแล้วเว็บจะไม่มีหน้าแรก"
    : "";
  opener(`ลบหน้าเว็บ ${ids.length} หน้า? เนื้อหาทั้งหมดในหน้านั้นจะหายถาวร${warn}`, async () => {
    try {
      showLoading(true);
      for (const id of ids) await sbFetch("web_pages", `?id=eq.${id}`, { method: "DELETE" });
      const selectAll = document.getElementById("selectAllCheckbox");
      if (selectAll) selectAll.checked = false;
      showToast(`ลบแล้ว ${ids.length} หน้า`);
      await loadPages();
      window.updateDeleteButton();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    } finally {
      showLoading(false);
    }
  });
};

window.deletePage = function (id) {
  const p = state.pages.find((x) => x.id === id);
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  /* ลบหน้า default = เว็บไม่เหลือหน้าแรก → ปุ่ม Website จะขึ้นหน้าว่าง ต้องเตือนก่อน */
  const warn = p?.is_home
    ? " ⚠️ หน้านี้เป็นหน้า default — ลบแล้วเว็บจะไม่มีหน้าแรก ต้องไปตั้งหน้าอื่นแทน"
    : "";
  opener(`ลบหน้า "${p?.title || id}"? เนื้อหาทั้งหมดในหน้านี้จะหายถาวร${warn}`, async () => {
    try {
      showLoading(true);
      await sbFetch("web_pages", `?id=eq.${id}`, { method: "DELETE" });
      showToast("ลบแล้ว");
      await loadPages();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    } finally {
      showLoading(false);
    }
  });
};

/* ============================================================
   Form modal — ข้อมูลหน้า (ไม่ใช่เนื้อหา)
   ============================================================ */
window.openPageModal = function (id) {
  state.editId = id || null;
  const p = id ? state.pages.find((x) => x.id === id) : null;

  document.getElementById("pageModalTitle").textContent = p ? "แก้ข้อมูลหน้า" : "เพิ่มหน้าใหม่";
  document.getElementById("fTitle").value = p?.title || "";
  document.getElementById("fSlug").value = p?.slug || "";
  document.getElementById("fStatus").value = p?.status || "draft";

  /* ── หน้า default ──
     ถ้าหน้านี้เป็นหน้าแรกอยู่ → ล็อกไว้ ปลดติ๊กไม่ได้
     ไม่งั้นจะไม่เหลือหน้า default แล้วปุ่ม Website (เปิดโดยไม่ใส่ ?slug=) จะขึ้นหน้าว่าง
     ย้ายหน้าแรก = ไปติ๊กที่หน้าอื่นแทน (savePageInfo ปลดของเดิมให้เอง) */
  const chk = document.getElementById("fHome");
  const hint = document.getElementById("fHomeHint");
  const text = document.getElementById("fHomeText");
  const label = document.getElementById("fHomeLabel");
  const isHome = !!p?.is_home;

  chk.checked = isHome;
  chk.disabled = isHome;
  label.style.cursor = isHome ? "default" : "pointer";
  label.style.opacity = isHome ? ".75" : "1";
  text.textContent = isHome ? "🏠 หน้านี้เป็นหน้า default อยู่" : "ตั้งเป็นหน้าแรก";
  hint.style.display = isHome ? "block" : "none";
  if (isHome)
    hint.textContent =
      "ย้ายหน้า default โดยเปิดหน้าที่ต้องการแล้วติ๊ก “ตั้งเป็นหน้าแรก” — หน้านี้จะถูกปลดให้อัตโนมัติ";

  document.getElementById("pageOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fTitle").focus(), 50);
};

window.closePageModal = function () {
  document.getElementById("pageOverlay").classList.remove("open");
  state.editId = null;
};

window.savePageInfo = async function () {
  const title = document.getElementById("fTitle").value.trim();
  const slug = document.getElementById("fSlug").value.trim().toLowerCase();
  const status = document.getElementById("fStatus").value;
  const is_home = document.getElementById("fHome").checked;

  if (!title) return showToast("กรุณากรอกชื่อหน้า", "error");
  if (!/^[a-z0-9-]+$/.test(slug)) return showToast("URL ใช้ได้เฉพาะ a-z, 0-9 และ -", "error");

  const user = window.ERP_USER || JSON.parse(localStorage.getItem("erp_session") || "{}");
  const payload = {
    title, slug, status, is_home,
    updated_by: user.full_name || user.username || null,
    updated_at: new Date().toISOString(),
  };

  try {
    showLoading(true);
    /* หน้าแรกมีได้หน้าเดียว — ปลดของเดิมก่อน ไม่งั้น web-view จะสุ่มได้หน้าใดหน้าหนึ่ง */
    if (is_home) {
      const others = state.pages.filter((p) => p.is_home && p.id !== state.editId);
      for (const o of others)
        await sbFetch("web_pages", `?id=eq.${o.id}`, { method: "PATCH", body: { is_home: false } });
    }

    if (state.editId) {
      await sbFetch("web_pages", `?id=eq.${state.editId}`, { method: "PATCH", body: payload });
      showToast("บันทึกแล้ว");
      window.closePageModal();
      await loadPages();
    } else {
      const created = await sbFetch("web_pages", "", { method: "POST", body: { ...payload, blocks: [] } });
      showToast("สร้างหน้าแล้ว — ไปแก้เนื้อหาต่อได้เลย");
      window.closePageModal();
      const newId = created?.[0]?.id;
      if (newId) location.href = `./web-editor.html?id=${newId}`;
      else await loadPages();
    }
  } catch (e) {
    console.error(e);
    const msg = /duplicate key/i.test(e.message) ? `URL "${slug}" ถูกใช้ไปแล้ว` : e.message;
    showToast("บันทึกไม่สำเร็จ: " + msg, "error");
  } finally {
    showLoading(false);
  }
};

/* ── ปุ่ม Website บน hero → เปิดหน้าแรกที่เผยแพร่ ── */
window.openWebsite = function () {
  window.open("./web-view.html", "_blank", "noopener");
};

/* ============================================================
   Init
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("searchInput").addEventListener("input", renderTable);
  document.getElementById("filterStatus").addEventListener("change", renderTable);
  loadPages();
});
