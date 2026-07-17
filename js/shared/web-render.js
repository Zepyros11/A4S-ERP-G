/* ============================================================
   web-render.js — Renderer: blocks JSON → HTML
   ============================================================
   ใช้ร่วมกัน 2 ที่ (นี่คือหัวใจ — เขียนครั้งเดียว ใช้ทั้งคู่):
     - web-editor.js  → วาด canvas ให้เห็นของจริงตอนแก้
     - web-view.js    → วาดหน้าเว็บจริงให้คนนอกดู
   ถ้าแก้ HTML ที่นี่ ทั้ง editor และเว็บจริงเปลี่ยนพร้อมกันเสมอ

   สไตล์ = inline style ตาม design (A4S Academy) — ยังไม่แยก theme token
   (ขั้นถัดไปค่อยเปลี่ยน hex เป็น var(--c-primary) แล้วสลับ theme ได้)
   ============================================================ */

window.WebRender = (() => {
  /* ── escape — props มาจาก user ห้ามยิงเข้า innerHTML ดิบๆ ── */
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  /* ── sanitize ค่าที่จะยิงเข้า style attribute ──
     ⚠️ esc() กัน HTML ได้ แต่กัน CSS injection ไม่ได้
     ถ้าปล่อยค่าดิบเข้า style="color:${v}" คนกรอก "red;background:url(...)" จะแทรก CSS ได้
     → ค่าที่ลงใน style ต้องผ่าน 2 ตัวนี้เท่านั้น ค่าผิดรูป = ใช้ default เงียบๆ */
  const num = (v, def, min = 1, max = 200) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : def;
  };
  const col = (v, def) => (/^#[0-9a-f]{3,8}$/i.test(String(v || "").trim()) ? String(v).trim() : def);

  /* ── placeholder ลายทาง (ใช้เมื่อยังไม่มีรูป — ตรงกับ design เดิม) ── */
  function ph(label, a, b, step, fontSize) {
    return `background:repeating-linear-gradient(135deg,${a},${a} ${step}px,${b} ${step}px,${b} ${step * 2}px);display:flex;align-items:center;justify-content:center;font:600 ${fontSize}px/1 ui-monospace,monospace;color:#7c9070`;
  }
  /* รูปจริง → cover, ไม่มีรูป → ลายทาง + label */
  function imgBox(url, label, style, phStyle) {
    if (url) {
      return `<div style="${style};background-image:url('${esc(url)}');background-size:cover;background-position:center"></div>`;
    }
    return `<div style="${style};${phStyle}">${esc(label)}</div>`;
  }

  const B = {
    site_header: (p) => `
  <div style="background:#ffffff;padding:26px 44px 18px;display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid #e6e9e0">
    <div style="display:flex;align-items:center;gap:14px">
      ${p.logo
        ? `<img src="${esc(p.logo)}" alt="${esc(p.brand)}" style="height:46px;width:auto;flex:none;display:block" />`
        : ""}
      <div>
        <div style="font:700 ${num(p.brandSize, 30)}px/1.15 'Anuphan',sans-serif;color:${col(p.brandColor, "#16240f")};letter-spacing:-.01em">${esc(p.brand)} <span style="font-size:${num(p.accentSize, 30)}px;color:${col(p.accentColor, "#71bf44")}">${esc(p.brandAccent)}</span></div>
        <div style="font:500 ${num(p.taglineSize, 13)}px/1.3 'Sarabun',sans-serif;color:${col(p.taglineColor, "#7c8a72")};margin-top:8px;letter-spacing:.02em">${esc(p.tagline)}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;font:600 13px/1 'Anuphan',sans-serif">
      <span style="color:#9aa691;margin-right:4px">ภาษา</span>
      ${(p.langs || []).map((l) =>
        l.active
          ? `<span style="background:#71bf44;color:#fff;padding:6px 12px;border-radius:999px">${esc(l.code)}</span>`
          : `<span style="color:#5a6551;padding:6px 12px;border-radius:999px;border:1px solid #dfe4d8">${esc(l.code)}</span>`
      ).join("")}
    </div>
  </div>`,

    nav_bar: (p) => `
  <div style="background:#16240f;padding:0 44px;display:flex;justify-content:space-between;align-items:center">
    <div style="display:flex;gap:28px;font:600 15px/1 'Anuphan',sans-serif">
      ${(p.items || []).map((i) =>
        `<span style="color:${i.active ? "#fff" : "#c3cbba"};padding:18px 0;border-bottom:3px solid ${i.active ? "#71bf44" : "transparent"}">${esc(i.label)}</span>`
      ).join("")}
    </div>
    <span style="background:#71bf44;color:#0f2109;font:700 14px/1 'Anuphan',sans-serif;padding:11px 20px;border-radius:8px">${esc(p.ctaText)}</span>
  </div>`,

    ticker: (p) => `
  <div style="background:#fff;padding:12px 44px;display:flex;gap:16px;align-items:center;border-bottom:1px solid #e6e9e0">
    <span style="background:#1c3d12;color:#71bf44;font:700 12px/1 'Anuphan',sans-serif;letter-spacing:.1em;padding:7px 11px;border-radius:6px">${esc(p.label)}</span>
    <span style="font:600 14px/1.3 'Sarabun',sans-serif;color:#2f3a28">${esc(p.text)}</span>
  </div>`,

    hero_news: (p) => `
  <div style="padding:36px 44px;display:grid;grid-template-columns:1.55fr 1fr;gap:34px;align-items:start">
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px"><span style="font:700 18px/1 'Anuphan',sans-serif;color:#16240f">${esc(p.sectionTitle)}</span><span style="flex:1;height:2px;background:#71bf44"></span></div>
      ${imgBox(p.image, "feature banner 1600×900",
        "aspect-ratio:16/9;border-radius:12px",
        ph("", "#dbe6d2", "#d2e0c7", 12, 13) + ";letter-spacing:.05em;color:#6f8a63")}
      <div style="margin-top:18px">
        <span style="font:600 12px/1 'Anuphan',sans-serif;color:#71bf44;letter-spacing:.08em;text-transform:uppercase">${esc(p.category)}</span>
        <div style="font:700 26px/1.28 'Anuphan',sans-serif;color:#16240f;margin-top:8px;text-wrap:pretty">${esc(p.title)}</div>
        <div style="font:400 15px/1.6 'Sarabun',sans-serif;color:#5a6551;margin-top:10px">${esc(p.excerpt)}</div>
        <div style="font:500 13px/1 'Sarabun',sans-serif;color:#9aa691;margin-top:12px">${esc(p.meta)}</div>
      </div>
    </div>
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px"><span style="font:700 18px/1 'Anuphan',sans-serif;color:#16240f">${esc(p.sidebarTitle)}</span><span style="flex:1;height:2px;background:#e0e5d9"></span></div>
      <div style="display:flex;flex-direction:column;gap:14px">
        ${(p.items || []).map((i) => `
        <div style="display:flex;gap:14px;align-items:center;background:#fff;border:1px solid #eceee7;border-radius:12px;padding:12px">
          ${imgBox(i.image, i.category, "width:96px;height:72px;flex:none;border-radius:8px", ph("", "#e4ece0", "#dbe5d5", 8, 10))}
          <div><div style="font:600 12px/1 'Anuphan',sans-serif;color:#71bf44">${esc(i.category)}</div><div style="font:600 15px/1.35 'Sarabun',sans-serif;color:#2f3a28;margin-top:5px">${esc(i.title)}</div></div>
        </div>`).join("")}
      </div>
    </div>
  </div>`,

    product_grid: (p) => `
  <div style="background:#fff;padding:34px 44px;border-top:1px solid #e6e9e0">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><span style="font:700 18px/1 'Anuphan',sans-serif;color:#16240f">${esc(p.title)}</span><span style="font:600 13px/1 'Anuphan',sans-serif;color:#71bf44">${esc(p.linkText)}</span></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px">
      ${(p.items || []).map((i) => `
      <div>${imgBox(i.image, i.title, "aspect-ratio:1;border-radius:12px", ph("", "#eef2ea", "#e5ece0", 10, 11))}<div style="font:600 15px/1.4 'Sarabun',sans-serif;color:#2f3a28;margin-top:10px">${esc(i.title)}</div></div>`).join("")}
    </div>
  </div>`,

    event_lessons: (p) => `
  <div style="padding:34px 44px;display:grid;grid-template-columns:1fr 1fr;gap:34px;background:#f6f7f3">
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px"><span style="font:700 18px/1 'Anuphan',sans-serif;color:#16240f">${esc(p.leftTitle)}</span><span style="flex:1;height:2px;background:#e0e5d9"></span></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${(p.events || []).map((e) => `
        <div style="display:flex;gap:14px;background:#fff;border-radius:12px;padding:12px;border:1px solid #eceee7"><div style="width:60px;height:64px;flex:none;background:#16240f;border-radius:8px;color:#71bf44;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Anuphan',sans-serif"><span style="font:700 22px/1">${esc(e.day)}</span><span style="font:600 11px/1;margin-top:3px">${esc(e.month)}</span></div><div><div style="font:600 15px/1.35 'Sarabun',sans-serif;color:#2f3a28">${esc(e.title)}</div><div style="font:500 13px/1 'Sarabun',sans-serif;color:#9aa691;margin-top:6px">${esc(e.sub)}</div></div></div>`).join("")}
      </div>
    </div>
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px"><span style="font:700 18px/1 'Anuphan',sans-serif;color:#16240f">${esc(p.rightTitle)}</span><span style="flex:1;height:2px;background:#e0e5d9"></span></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${(p.lessons || []).map((l) => `
        <div style="display:flex;gap:14px;background:#fff;border-radius:12px;padding:12px;border:1px solid #eceee7">${imgBox(l.image, "▶ วิดีโอ", "width:84px;height:60px;flex:none;border-radius:8px", ph("", "#e4ece0", "#dbe5d5", 8, 10))}<div><div style="font:600 15px/1.35 'Sarabun',sans-serif;color:#2f3a28">${esc(l.title)}</div><div style="font:500 13px/1 'Sarabun',sans-serif;color:#9aa691;margin-top:6px">${esc(l.sub)}</div></div></div>`).join("")}
      </div>
    </div>
  </div>`,

    download_grid: (p) => `
  <div style="background:#fff;padding:34px 44px;border-top:1px solid #e6e9e0">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><span style="font:700 18px/1 'Anuphan',sans-serif;color:#16240f">${esc(p.title)}</span><span style="font:600 13px/1 'Anuphan',sans-serif;color:#71bf44">${esc(p.linkText)}</span></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
      ${(p.items || []).map((i) => `
      <div style="border:1px solid #e6e9e0;border-radius:12px;padding:18px"><div style="width:40px;height:40px;background:#eef4ea;color:#4f9e2e;border-radius:10px;display:flex;align-items:center;justify-content:center;font:700 ${String(i.type || "").length > 3 ? 12 : 13}px/1 'Anuphan',sans-serif">${esc(i.type)}</div><div style="font:600 15px/1.35 'Sarabun',sans-serif;color:#2f3a28;margin-top:12px">${esc(i.title)}</div><div style="font:500 12px/1 'Sarabun',sans-serif;color:#9aa691;margin-top:6px">${esc(i.sub)}</div></div>`).join("")}
    </div>
  </div>`,

    cta_banner: (p) => `
  <div style="margin:34px 44px 40px;background:#16240f;border-radius:16px;padding:36px 40px;display:flex;justify-content:space-between;align-items:center;gap:24px">
    <div><div style="font:700 24px/1.3 'Anuphan',sans-serif;color:#fff">${esc(p.title)}</div><div style="font:400 15px/1.5 'Sarabun',sans-serif;color:#a9b8a0;margin-top:8px">${esc(p.sub)}</div></div>
    <div style="display:flex;gap:12px;flex:none"><span style="background:#71bf44;color:#0f2109;font:700 15px/1 'Anuphan',sans-serif;padding:15px 26px;border-radius:10px">${esc(p.primaryText)}</span><span style="background:transparent;color:#fff;border:1px solid #3d5a30;font:700 15px/1 'Anuphan',sans-serif;padding:15px 26px;border-radius:10px">${esc(p.secondaryText)}</span></div>
  </div>`,

    site_footer: (p) => `
  <div style="background:#0f2109;padding:36px 44px;display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:28px">
    <div><div style="font:700 22px/1 'Anuphan',sans-serif;color:#fff">${esc(p.brand)} <span style="color:#71bf44">${esc(p.brandAccent)}</span></div><div style="font:400 13px/1.6 'Sarabun',sans-serif;color:#8fa382;margin-top:12px;max-width:240px">${esc(p.about)}</div></div>
    ${(p.cols || []).map((c) => `
    <div><div style="font:600 13px/1 'Anuphan',sans-serif;color:#71bf44;margin-bottom:12px">${esc(c.title)}</div><div style="display:flex;flex-direction:column;gap:8px;font:400 13px/1 'Sarabun',sans-serif;color:#c3cbba">${String(c.links || "").split(",").map((s) => `<span>${esc(s.trim())}</span>`).join("")}</div></div>`).join("")}
  </div>`,
  };

  return {
    esc,
    /* block เดียว → HTML (type ที่ไม่รู้จัก = ข้าม ไม่ทำหน้าพัง) */
    block(b) {
      const fn = B[b.type];
      if (!fn) return "";
      return fn(window.WebBlocks.withDefaults(b).props);
    },
    /* ทั้งหน้า → HTML */
    page(blocks) {
      return (blocks || []).map((b) => this.block(b)).join("\n");
    },
  };
})();
