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

  /* ── ค่าเปิด/ปิด ──
     ห้ามใช้ truthy เปล่าๆ — string "0" เป็น truthy ใน JS
     ข้อมูลเก่าเก็บเป็น "1"/"" ของใหม่เป็น boolean → ต้องรับได้ทั้งคู่ */
  const on = (v) => v === true || v === 1 || v === "1" || v === "true";
  /* น้ำหนักตัวอักษร: บาง/ปกติ/หนา → ค่า CSS */
  const wt = (v) => ({ light: 300, normal: 400, bold: 700 }[v] || 400);
  const al = (v) => (["left", "center", "right"].includes(v) ? v : "left");

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

  /* ── ตัวช่วยของโมเดล 3 ชั้น ── */
  const alignSelf = { left: "flex-start", center: "center", right: "flex-end" };
  /* px แบบยอมให้เป็น 0 ได้ (num() ตั้ง min=1 เป็นค่าเริ่มต้น → padding:0 จะโดนตีกลับเป็น default) */
  const px0 = (v, def, max = 200) => num(v, def, 0, max);

  const B = {
    /* ── section: แถบเต็มจอ → กริดคอลัมน์ ──
       รับ node + wrap มาด้วย (นอกจาก props) เพราะต้องวาดลูกต่อ
       wrap มีเฉพาะตอน editor เรียก → ใช้เป็นสัญญาณว่า "อยู่โหมดแก้ไข" ได้ด้วย
       wv-grid = hook ให้ CSS ยุบเหลือคอลัมน์เดียวบนมือถือ (media query ทำใน inline style ไม่ได้) */
    section: (p, node, wrap) => {
      const st = [
        `background:${col(p.bg, "#ffffff")}`,
        `padding:${px0(p.padY, 40, 160)}px ${px0(p.padX, 44, 120)}px`,
      ].join(";");
      const grid = [
        "display:grid",
        /* สัดส่วนคอลัมน์มาจาก layout ("2-1" → 2fr 1fr) — colParts กรองค่าเพี้ยนให้แล้ว
           จึงต่อเข้า style ได้ตรงๆ โดยไม่ต้อง sanitize ซ้ำ */
        `grid-template-columns:${window.WebBlocks.colParts(p.layout).map((n) => n + "fr").join(" ")}`,
        `gap:${px0(p.gap, 24, 80)}px`,
        `align-items:${["start", "center", "stretch"].includes(p.vAlign) ? p.vAlign : "start"}`,
        `max-width:${num(p.maxWidth, 1200, 320, 1600)}px`,
        "margin:0 auto",
      ].join(";");
      return `
  <div style="${st}"><div class="wv-grid" style="${grid}">${renderList(node.children, wrap)}</div></div>`;
    },

    /* ── column: ช่องในแถบ → เรียง element แนวตั้ง ──
       คอลัมน์ว่างต้อง "มองเห็นได้" เฉพาะตอนแก้ไข (wrap มีค่า) — หน้าจริงต้องว่างเปล่าสนิท */
    column: (p, node, wrap) => {
      const kids = node.children || [];
      const st = [
        "display:flex", "flex-direction:column",
        `gap:${px0(p.gap, 14, 48)}px`,
        `align-items:${alignSelf[al(p.align)]}`,
        `text-align:${al(p.align)}`,
        `padding:${px0(p.pad, 0, 60)}px`,
        p.bg ? `background:${col(p.bg, "transparent")}` : "",
        `border-radius:${px0(p.radius, 0, 32)}px`,
      ].filter(Boolean).join(";");
      const empty = !kids.length && wrap
        ? `<div class="wv-col-empty">ลากองค์ประกอบมาวางที่นี่</div>`
        : "";
      return `<div class="wv-col" style="${st}">${renderList(kids, wrap)}${empty}</div>`;
    },

    /* ── element: ใบไม้ ไม่มีลูก ── */
    el_text: (p) => `<div style="font-family:'Sarabun',sans-serif;font-weight:${wt(p.weight)};font-size:${num(p.size, 16, 11, 72)}px;line-height:${num(p.lh, 1.6, 1, 2.4)};color:${col(p.color, "#2f3a28")};text-align:${al(p.align)};white-space:pre-wrap;width:100%">${esc(p.text)}</div>`,

    el_image: (p) => {
      const ratio = ["16/9", "4/3", "1/1", "3/4"].includes(p.ratio) ? p.ratio : "";
      const st = [
        `width:${num(p.width, 100, 20, 100)}%`,
        ratio ? `aspect-ratio:${ratio}` : "",
        `border-radius:${px0(p.radius, 12, 40)}px`,
        /* จัดวางด้วย margin เพราะตัวมันเองเป็นลูกของ flex column ที่ align-items ตั้งไว้แล้ว
           (margin auto ชนะ align-items → ปุ่ม "จัดวาง" ของรูปเองมีผลจริง) */
        p.align === "center" ? "margin:0 auto" : p.align === "right" ? "margin-left:auto" : "margin-right:auto",
        "display:block",
      ].filter(Boolean).join(";");
      const inner = p.src
        ? `<img src="${esc(p.src)}" alt="${esc(p.alt)}" style="${st};object-fit:cover;height:${ratio ? "100%" : "auto"}" />`
        : `<div style="${st};${ph("", "#e4ece0", "#dbe5d5", 10, 12)};${ratio ? "" : "height:180px"}">${esc(p.alt || "ยังไม่ได้เลือกรูป")}</div>`;
      return p.link
        ? `<a href="web-view.html?slug=${esc(p.link)}" style="display:block;width:100%">${inner}</a>`
        : inner;
    },

    el_button: (p) => {
      const solid = p.variant !== "outline";
      const bg = col(p.bg, "#71bf44");
      const st = [
        "display:inline-block", "text-decoration:none",
        `font:700 ${num(p.size, 15, 12, 22)}px/1 'Anuphan',sans-serif`,
        `padding:${num(p.size, 15, 12, 22)}px ${num(p.size, 15, 12, 22) * 1.7}px`,
        `border-radius:${px0(p.radius, 10, 999)}px`,
        solid ? `background:${bg};color:${col(p.fg, "#0f2109")};border:2px solid ${bg}`
              : `background:transparent;color:${bg};border:2px solid ${bg}`,
      ].join(";");
      const wrapSt = `width:100%;text-align:${al(p.align)}`;
      const btn = p.link
        ? `<a href="web-view.html?slug=${esc(p.link)}" style="${st}">${esc(p.label)}</a>`
        : `<span style="${st}">${esc(p.label)}</span>`;
      return `<div style="${wrapSt}">${btn}</div>`;
    },

    site_header: (p) => {
      const center = p.logoPos === "center";
      const sticky = on(p.sticky);
      const brandInner = `
        ${p.logo ? `<img class="wv-logo" src="${esc(p.logo)}" alt="${esc(p.brand)}" style="height:46px;width:auto;flex:none;display:block" />` : ""}
        <div>
          <div style="font-family:'Anuphan',sans-serif;font-weight:${wt(p.brandWeight)};font-size:${num(p.brandSize, 30)}px;line-height:1.15;color:${col(p.brandColor, "#16240f")};letter-spacing:-.01em;text-align:${al(p.brandAlign)}">${esc(p.brand)} <span style="font-weight:${wt(p.accentWeight)};font-size:${num(p.accentSize, 30)}px;color:${col(p.accentColor, "#71bf44")}">${esc(p.brandAccent)}</span></div>
          <div style="font-family:'Sarabun',sans-serif;font-weight:${wt(p.taglineWeight)};font-size:${num(p.taglineSize, 13)}px;line-height:1.3;color:${col(p.taglineColor, "#7c8a72")};margin-top:6px;letter-spacing:.02em;text-align:${al(p.taglineAlign)}">${esc(p.tagline)}</div>
        </div>`;
      /* คลิกโลโก้ → ไปหน้าที่เลือก (logoLink = slug) · ไม่มี = ไม่ทำลิงก์ */
      const brand = p.logoLink
        ? `<a href="web-view.html?slug=${esc(p.logoLink)}" style="display:flex;align-items:center;gap:14px;text-decoration:none">${brandInner}</a>`
        : `<div style="display:flex;align-items:center;gap:14px">${brandInner}</div>`;
      /* ตำแหน่งกลาง = brand อยู่กลาง · langs ลอยไปขวาสุดด้วย absolute (ไม่งั้นจะเบียดกลาง) */
      const langs = on(p.showLangs)
        ? `<div style="display:flex;gap:8px;align-items:center;font:600 13px/1 'Anuphan',sans-serif${center ? ";position:absolute;right:44px;top:50%;transform:translateY(-50%)" : ""}">
        <span style="color:#9aa691;margin-right:4px">ภาษา</span>
        ${(p.langs || []).map((l) =>
          on(l.active)
            ? `<span style="background:#71bf44;color:#fff;padding:6px 12px;border-radius:999px">${esc(l.code)}</span>`
            : `<span style="color:#5a6551;padding:6px 12px;border-radius:999px;border:1px solid #dfe4d8">${esc(l.code)}</span>`
        ).join("")}
      </div>`
        : "";
      const st = [
        `background:${col(p.bgColor, "#ffffff")}`,
        `min-height:${num(p.height, 90, 40, 300)}px`,
        "padding:0 44px",
        "display:flex", "align-items:center", "gap:14px",
        `justify-content:${center ? "center" : "space-between"}`,
        on(p.showBorder) ? "border-bottom:1px solid #e6e9e0" : "",
        /* sticky ต้อง position:sticky · ไม่งั้น relative (ให้ langs absolute ตอน center อ้างอิงได้) */
        sticky ? "position:sticky;top:0;z-index:50" : "position:relative",
      ].filter(Boolean).join(";");
      /* hideMobile/shrink = พฤติกรรมที่ต้องมี CSS/JS นอก inline → ใส่ class+data-attr ให้ web-view/editor จับ */
      const cls = "wv-header" + (on(p.hideMobile) ? " wv-hide-sm" : "");
      return `
  <div class="${cls}"${on(p.shrinkOnScroll) ? ' data-shrink="1"' : ""} style="${st}">
    ${brand}
    ${langs}
  </div>`;
    },

    nav_bar: (p) => `
  <div style="background:#16240f;padding:0 44px;display:flex;justify-content:space-between;align-items:center">
    <div style="display:flex;gap:28px;font:600 15px/1 'Anuphan',sans-serif">
      ${(p.items || []).map((i) => {
        const st = `color:${on(i.active) ? "#fff" : "#c3cbba"};padding:18px 0;border-bottom:3px solid ${on(i.active) ? "#71bf44" : "transparent"}`;
        /* เมนูที่ยังไม่ผูกหน้า (หรือของเก่าที่ไม่มี key นี้) = ข้อความเฉยๆ ไม่ต้องมี <a> ว่าง */
        return i.link
          ? `<a href="web-view.html?slug=${esc(i.link)}" style="${st};text-decoration:none">${esc(i.label)}</a>`
          : `<span style="${st}">${esc(i.label)}</span>`;
      }).join("")}
    </div>
    <div style="display:flex;gap:10px;align-items:center">
      ${(p.ctaItems || []).filter((c) => on(c.enabled) && c.label).map((c) => {
        const st = "background:#71bf44;color:#0f2109;font:700 14px/1 'Anuphan',sans-serif;padding:11px 20px;border-radius:8px";
        return c.link
          ? `<a href="web-view.html?slug=${esc(c.link)}" style="${st};text-decoration:none">${esc(c.label)}</a>`
          : `<span style="${st}">${esc(c.label)}</span>`;
      }).join("")}
    </div>
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

    /* ── spacer ──
       ความสูงมือถือแยกไม่ได้ด้วย inline style (media query ทำใน style="" ไม่ได้)
       → ส่งค่าเป็น CSS var แล้วให้ CSS ฝั่ง editor/view สลับที่ 767px
       data-h = ตัวเลขให้ CSS โหมดแก้ไขเอาไปโชว์ (content: attr(data-h)) */
    spacer: (p) => {
      const h = num(p.height, 48, 8, 200);
      const hm = num(p.mobileHeight, 32, 8, 120);
      return `
  <div class="wv-spacer" data-h="${h}" style="--sp-h:${h}px;--sp-hm:${hm}px;height:var(--sp-h)"></div>`;
    },

    /* ── divider ── */
    divider: (p) => {
      /* lineStyle ยิงเข้า border-top ตรงๆ → ต้อง whitelist ไม่ใช่ esc (กัน CSS injection) */
      const ls = ["solid", "dashed", "dotted"].includes(p.lineStyle) ? p.lineStyle : "solid";
      return `
  <div style="padding:${num(p.spacing, 32, 0, 96)}px 44px">
    <div style="width:${num(p.width, 100, 20, 100)}%;margin:0 auto;border-top:${num(p.thickness, 1, 1, 8)}px ${ls} ${col(p.color, "#e3e5e0")}"></div>
  </div>`;
    },

    site_footer: (p) => `
  <div style="background:#0f2109;padding:36px 44px;display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:28px">
    <div><div style="font:700 22px/1 'Anuphan',sans-serif;color:#fff">${esc(p.brand)} <span style="color:#71bf44">${esc(p.brandAccent)}</span></div><div style="font:400 13px/1.6 'Sarabun',sans-serif;color:#8fa382;margin-top:12px;max-width:240px">${esc(p.about)}</div></div>
    ${(p.cols || []).map((c) => `
    <div><div style="font:600 13px/1 'Anuphan',sans-serif;color:#71bf44;margin-bottom:12px">${esc(c.title)}</div><div style="display:flex;flex-direction:column;gap:8px;font:400 13px/1 'Sarabun',sans-serif;color:#c3cbba">${String(c.links || "").split(",").map((s) => `<span>${esc(s.trim())}</span>`).join("")}</div></div>`).join("")}
  </div>`,
  };

  /* ── แกนกลางของการวาด (recursive) ──
     wrap = ฟังก์ชันของ "คนเรียก" ที่ได้โอกาสห่อ HTML ของทุก node ก่อนส่งต่อ
       · web-view (หน้าจริง) ไม่ส่ง wrap → ได้ HTML สะอาด ไม่มีของ editor ปน
       · web-editor ส่ง wrap → ห่อทุกชั้นด้วยกรอบเลือก/ปุ่มจัดการ
     นี่คือเหตุผลที่ nesting ทำงานได้ทุกความลึกโดย editor ไม่ต้องรู้จักโครงสร้างของ block เลย
     — section วาดลูกด้วย renderList(children, wrap) ตัวเดียวกัน */
  function renderOne(b, wrap) {
    const fn = B[b?.type];
    if (!fn) return "";
    const nb = window.WebBlocks.withDefaults(b);
    const html = fn(nb.props, nb, wrap);
    return wrap ? wrap(nb, html) : html;
  }
  function renderList(list, wrap) {
    return (list || []).map((b) => renderOne(b, wrap)).join("\n");
  }

  return {
    esc,
    on, /* editor ใช้ตัวนี้ตัดสินว่า toggle ติ๊กไว้ไหม — ต้องใช้กติกาเดียวกับ renderer เป๊ะ */
    /* block เดียว → HTML (type ที่ไม่รู้จัก = ข้าม ไม่ทำหน้าพัง) */
    block: (b, wrap) => renderOne(b, wrap),
    /* ทั้งหน้า → HTML */
    page: (blocks, wrap) => renderList(blocks, wrap),
  };
})();
