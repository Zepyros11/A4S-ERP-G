/* ============================================================
   custom-report.lang.js — คำแปล (ไทย/อังกฤษ) ของหน้า Custom Report
   โหลด "หลัง" i18n.js และ "ก่อน" custom-report.js
   • th = ข้อความเดิมในระบบ (ตรงกับ fallback ใน HTML/JS)
   • en = คำแปลอังกฤษ
   • {n}/{name}/... = placeholder แทนค่าด้วย I18n.t(key, { n: ... })
   ============================================================ */
I18n.register({
  // ── Hero / banner ──────────────────────────────────────
  "cr.banner.back":        { th: "← รายการทริป", en: "← Trip List" },

  // ── Preset bar ─────────────────────────────────────────
  "cr.preset.label":       { th: "⭐ ชุดคอลัมน์:", en: "⭐ Column set:" },
  "cr.preset.placeholder": { th: "— เลือก preset —", en: "— Select preset —" },
  "cr.preset.save":        { th: "💾 บันทึกเป็น preset", en: "💾 Save as preset" },
  "cr.preset.saveTitle":   { th: "บันทึกคอลัมน์ที่เลือกเป็น preset ใหม่", en: "Save selected columns as a new preset" },
  "cr.preset.delete":      { th: "🗑 ลบ preset", en: "🗑 Delete preset" },
  "cr.preset.deleteTitle": { th: "ลบ preset ที่เลือก", en: "Delete the selected preset" },

  // ── Print / layout settings ────────────────────────────
  "cr.print.settingsTitle":{ th: "ตั้งจำนวนแถวต่อหน้า A4 เพื่อให้ภาพใหญ่ขึ้นเวลาพิมพ์", en: "Set rows per A4 page so images print larger" },
  "cr.print.format":       { th: "🎨 รูปแบบ:", en: "🎨 Format:" },
  "cr.layout.table":       { th: "📊 ตาราง", en: "📊 Table" },
  "cr.layout.card":        { th: "🪪 การ์ด", en: "🪪 Card" },
  "cr.print.rowsPerA4":    { th: "🖨 แถว/A4:", en: "🖨 Rows/A4:" },
  "cr.rows.auto":          { th: "อัตโนมัติ", en: "Auto" },
  "cr.rows.2":             { th: "2 (ใหญ่สุด)", en: "2 (largest)" },
  "cr.rows.8":             { th: "8 (ปกติ)", en: "8 (normal)" },
  "cr.rows.16":            { th: "16 (เล็กสุด)", en: "16 (smallest)" },
  "cr.print.cardsPerA4":   { th: "🪪 การ์ด/A4:", en: "🪪 Cards/A4:" },
  "cr.cards.1":            { th: "1 (ใหญ่สุด)", en: "1 (largest)" },
  "cr.cards.6":            { th: "6 (เล็กสุด)", en: "6 (smallest)" },
  "cr.print.fieldPos":     { th: "↕ ตำแหน่งข้อมูล:", en: "↕ Info position:" },
  "cr.fieldPos.title":     { th: "ตำแหน่งกล่องข้อมูล (ชื่อ/ฟิลด์) ในการ์ดเทียบกับภาพ", en: "Position of the info box (name/fields) in the card relative to the image" },
  "cr.fieldPos.top":       { th: "⬆ บน", en: "⬆ Top" },
  "cr.fieldPos.center":    { th: "⬌ กลาง", en: "⬌ Center" },
  "cr.fieldPos.bottom":    { th: "⬇ ล่าง", en: "⬇ Bottom" },
  "cr.ori.landscape":      { th: "แนวนอน", en: "Landscape" },
  "cr.ori.portrait":       { th: "แนวตั้ง", en: "Portrait" },

  // ── Grouping / Total ───────────────────────────────────
  "cr.group.label":        { th: "🗂 แบ่งกลุ่ม:", en: "🗂 Group by:" },
  "cr.group.title":        { th: "แบ่งตารางเป็น section ตามช่วงเที่ยวบินหรือคอลัมน์ที่เลือก", en: "Split the table into sections by flight segment or a selected column" },
  "cr.group.total":        { th: "Σ รวมยอด", en: "Σ Totals" },
  "cr.group.totalTitle":   { th: "แสดงแถวรวมจำนวนท้ายแต่ละกลุ่ม + รวมทั้งหมด", en: "Show a count row at the end of each group + grand total" },

  // ── Buttons ────────────────────────────────────────────
  "cr.btn.excel":          { th: "📥 Excel", en: "📥 Excel" },
  "cr.btn.makeLetter":     { th: "📄 สร้างเป็นจดหมาย", en: "📄 Make letter" },
  "cr.btn.makeLetterTitle":{ th: "สร้างเอกสารจดหมายจากตารางนี้ — ใส่หัวกระดาษ/ลายเซ็น/ข้อความเปิด-ปิด ในหน้าเอกสาร", en: "Create a letter document from this table — add letterhead/signature/opening-closing text in the Documents page" },
  "cr.btn.preview":        { th: "👁 Preview", en: "👁 Preview" },
  "cr.btn.previewTitle":   { th: "ดูตัวอย่างหน้ากระดาษ A4 ก่อนพิมพ์", en: "Preview the A4 page before printing" },
  "cr.btn.print":          { th: "🖨 Print / PDF", en: "🖨 Print / PDF" },
  "cr.btn.close":          { th: "✕ ปิด", en: "✕ Close" },
  "cr.btn.save":           { th: "บันทึก", en: "Save" },
  "cr.btn.cancel":         { th: "ยกเลิก", en: "Cancel" },
  "cr.btn.delete":         { th: "ลบ", en: "Delete" },

  // ── Main panels ────────────────────────────────────────
  "cr.pickCols":           { th: "เลือกคอลัมน์", en: "Select columns" },
  "cr.previewTitle":       { th: "ตัวอย่างรายงาน", en: "Report preview" },
  "cr.empty":              { th: "เลือกคอลัมน์จากด้านซ้ายเพื่อสร้างรายงาน", en: "Select columns on the left to build the report" },
  "cr.previewModal.title": { th: "👁 ตัวอย่างก่อน export", en: "👁 Preview before export" },
  "cr.img.alt":            { th: "ภาพขยาย", en: "Enlarged image" },
  "cr.img.closeTitle":     { th: "ปิด", en: "Close" },
  "cr.img.zoomTip":        { th: "คลิกเพื่อดูภาพขยาย", en: "Click to enlarge" },
  "cr.img.has":            { th: "📷 มีภาพ", en: "📷 Has image" },
  "cr.img.none":           { th: "ไม่มีภาพ", en: "No image" },

  // ── Column group labels ────────────────────────────────
  "cr.grp.checkseat":      { th: "🪑 Check Seat", en: "🪑 Check Seat" },
  "cr.grp.room":           { th: "🛏️ ห้องพัก", en: "🛏️ Rooms" },
  "cr.grp.bus":            { th: "🚌 รถบัส", en: "🚌 Bus" },
  "cr.grp.flight":         { th: "✈️ เครื่องบิน", en: "✈️ Flight" },
  "cr.grp.detail":         { th: "📋 Detail", en: "📋 Detail" },
  "cr.grp.team":           { th: "👔 ทีมงาน", en: "👔 Team" },

  // ── Column labels ──────────────────────────────────────
  "cr.col.code":               { th: "รหัส", en: "Code" },
  "cr.col.title_prefix":       { th: "คำนำหน้า", en: "Title" },
  "cr.col.name":               { th: "ชื่อ", en: "Name" },
  "cr.col.gender":             { th: "เพศ", en: "Gender" },
  "cr.col.nationality":        { th: "สัญชาติ", en: "Nationality" },
  "cr.col.pin":                { th: "ตำแหน่ง", en: "Position" },
  "cr.col.group_name":         { th: "กลุ่ม", en: "Group" },
  "cr.col.seat":               { th: "ที่นั่งเครื่องบิน", en: "Flight seat" },
  "cr.col.passport_id":        { th: "เลขพาสปอร์ต", en: "Passport no." },
  "cr.col.passport_exp_date":  { th: "พาสปอร์ตหมดอายุ", en: "Passport expiry" },
  "cr.col.passport_image_url": { th: "ภาพ passport", en: "Passport image" },
  "cr.col.visa_image_url":     { th: "ภาพสลิป/วีซ่า", en: "Slip / visa image" },
  "cr.col.tshirt_size":        { th: "ไซส์เสื้อ", en: "T-shirt size" },
  "cr.col.religion":           { th: "ศาสนา", en: "Religion" },
  "cr.col.food_allergy":       { th: "อาหารที่แพ้", en: "Food allergy" },
  "cr.col.return_flight":      { th: "ไฟลท์ขากลับ", en: "Return flight" },
  "cr.col.return_date":        { th: "วันขากลับ", en: "Return date" },
  "cr.col._hotel":             { th: "โรงแรม", en: "Hotel" },
  "cr.col._room":              { th: "ชื่อห้อง", en: "Room name" },
  "cr.col._checkin":           { th: "เช็คอิน", en: "Check-in" },
  "cr.col._checkout":          { th: "เช็คเอาท์", en: "Check-out" },
  "cr.col._bus":               { th: "รถบัส", en: "Bus" },
  "cr.col._busseat":           { th: "ที่นั่งรถบัส", en: "Bus seat" },
  "cr.col._flticket":          { th: "ตั๋วเครื่องบิน", en: "Flight ticket" },
  "cr.col._flflight":          { th: "Flight (ขาไป)", en: "Flight (outbound)" },
  "cr.col._flport":            { th: "Port", en: "Port" },
  "cr.col._fldep":             { th: "ออก (Departure)", en: "Departure" },
  "cr.col._flarr":             { th: "ถึง (Arrival)", en: "Arrival" },
  "cr.col._flcomeback":        { th: "Flight (ขากลับ)", en: "Flight (return)" },
  "cr.col._flcomebackdt":      { th: "วันเวลากลับ", en: "Return date/time" },
  "cr.col.tel":                { th: "เบอร์โทร", en: "Phone" },
  "cr.col.line_id":            { th: "LINE ID", en: "LINE ID" },
  "cr.col.home_address":       { th: "ที่อยู่", en: "Address" },
  "cr.col.medical_conditions": { th: "โรคประจำตัว", en: "Medical conditions" },
  "cr.col.daily_medication":   { th: "ยาที่ใช้ประจำ", en: "Daily medication" },
  "cr.col.emergency_contact_name":     { th: "ผู้ติดต่อฉุกเฉิน", en: "Emergency contact" },
  "cr.col.emergency_contact_phone":    { th: "เบอร์ฉุกเฉิน", en: "Emergency phone" },
  "cr.col.emergency_contact_relation": { th: "ความสัมพันธ์", en: "Relationship" },
  "cr.col.insurance_company":  { th: "บริษัทประกัน", en: "Insurance company" },
  "cr.col.insurance_policy_no":{ th: "เลขกรมธรรม์", en: "Policy no." },
  "cr.col.special_requests":   { th: "คำขอพิเศษ", en: "Special requests" },
  "cr.col._teamtype":          { th: "ประเภท", en: "Type" },
  "cr.col._role_title":        { th: "ตำแหน่งทีม", en: "Team role" },
  "cr.col._languages":         { th: "ภาษา (ทีม)", en: "Languages (team)" },
  "cr.col._team_phone":        { th: "เบอร์ทีม", en: "Team phone" },

  // ── Cell values ────────────────────────────────────────
  "cr.gender.male":        { th: "ชาย", en: "Male" },
  "cr.gender.female":      { th: "หญิง", en: "Female" },
  "cr.team.default":       { th: "ทีมงาน", en: "Team" },
  "cr.bus.no":             { th: "คันที่ {n}", en: "Bus {n}" },
  "cr.flight.ticketNo":    { th: "ตั๋ว #{id}", en: "Ticket #{id}" },
  "cr.blank":              { th: "(ว่าง)", en: "(blank)" },

  // ── Counts / notes (preview header) ───────────────────
  "cr.count.people":       { th: "{n} คน", en: "{n} people" },
  "cr.count.team":         { th: "+ {n} ทีมงาน", en: "+ {n} team" },
  "cr.count.split":        { th: "(แยกตามโรงแรม {n} แถว)", en: "(split by hotel · {n} rows)" },
  "cr.count.filter":       { th: "🔽 หลัง filter {n} แถว", en: "🔽 after filter · {n} rows" },
  "cr.count.hidden":       { th: "🙈 ซ่อน {n}", en: "🙈 {n} hidden" },
  "cr.count.columns":      { th: "{n} คอลัมน์", en: "{n} columns" },
  "cr.count.fields":       { th: "{n} ฟิลด์", en: "{n} fields" },

  // ── Filter popover ─────────────────────────────────────
  "cr.fpop.merge":         { th: "≣ ผสานเซล", en: "≣ Merge cells" },
  "cr.fpop.mergeTitle":    { th: "รวมเซลที่มีค่าเหมือนกันติดกัน (เหมือน merge cells ใน Excel)", en: "Merge adjacent cells with the same value (like Excel merge cells)" },
  "cr.fpop.searchPh":      { th: "ค้นหาค่า…", en: "Search values…" },
  "cr.fpop.selectAll":     { th: "เลือกทั้งหมด", en: "Select all" },
  "cr.fpop.clear":         { th: "ล้าง", en: "Clear" },
  "cr.fpop.removeFilter":  { th: "เอา filter ออก", en: "Remove filter" },
  "cr.fpop.apply":         { th: "ใช้", en: "Apply" },
  "cr.fpop.tooMany":       { th: "ค่าหลากหลายเกิน {n} ค่า — กรองไม่ได้", en: "More than {n} distinct values — cannot filter" },
  "cr.fpop.noMerge":       { th: "<br>(และไม่มีค่าซ้ำให้ผสาน)", en: "<br>(and no duplicate values to merge)" },
  "cr.fpop.notFound":      { th: "ไม่พบค่าที่ตรงกัน", en: "No matching values" },

  // ── Table header (sort / filter / hide) ───────────────
  "cr.th.pinTip":          { th: "เรียงตามชั้นยศ SVP→VP→AVP→SD→DR — ", en: "Sort by rank SVP→VP→AVP→SD→DR — " },
  "cr.th.sortTip":         { th: "คลิก: asc → desc → ลบออก · กดหลายคอลัมน์ = multi-sort (ลำดับ priority ตามลำดับการกด)", en: "Click: asc → desc → remove · click multiple columns = multi-sort (priority follows click order)" },
  "cr.th.filterCount":     { th: "filter: {n} ค่า", en: "filter: {n} values" },
  "cr.th.mergeOn":         { th: "ผสานเซลเปิดอยู่", en: "merge cells on" },
  "cr.th.clickEdit":       { th: " — คลิกเพื่อแก้", en: " — click to edit" },
  "cr.th.filterMergeTip":  { th: "กรองค่า / ผสานเซล", en: "Filter values / merge cells" },
  "cr.th.hideTag":         { th: "ซ่อน", en: "Hidden" },
  "cr.th.eyeHiddenTip":    { th: "ซ่อนจากรายงาน (Print/Excel/PDF) — คลิกเพื่อแสดง", en: "Hidden from report (Print/Excel/PDF) — click to show" },
  "cr.th.eyeShownTip":     { th: "แสดงในรายงาน — คลิกเพื่อซ่อน (ยังใช้เรียง/กรอง)", en: "Shown in report — click to hide (still used for sort/filter)" },

  // ── Chips ──────────────────────────────────────────────
  "cr.chip.moveLeft":      { th: "เลื่อนซ้าย", en: "Move left" },
  "cr.chip.moveRight":     { th: "เลื่อนขวา", en: "Move right" },
  "cr.chip.hideTip":       { th: "ซ่อนจากรายงาน — คลิกเพื่อแสดง", en: "Hidden from report — click to show" },
  "cr.chip.showTip":       { th: "แสดงในรายงาน — คลิกเพื่อซ่อน (ยังใช้เรียง/กรอง)", en: "Shown in report — click to hide (still used for sort/filter)" },
  "cr.chip.remove":        { th: "เอาออก", en: "Remove" },

  // ── Card mode ──────────────────────────────────────────
  "cr.card.noImage":       { th: "— ไม่มีภาพ —", en: "— No image —" },

  // ── Print output ───────────────────────────────────────
  "cr.print.extraSplit":   { th: "· {n} แถว (แยกตามโรงแรม)", en: "· {n} rows (split by hotel)" },
  "cr.print.printedAt":    { th: "พิมพ์เมื่อ {when}", en: "Printed {when}" },
  "cr.print.noData":       { th: "ไม่มีข้อมูล", en: "No data" },

  // ── Preview pages ──────────────────────────────────────
  "cr.preview.pageNum":    { th: "หน้า {p} / {total}", en: "Page {p} / {total}" },
  "cr.preview.more":       { th: "⋯ แสดง {shown} หน้าแรก · ทั้งหมด {total} หน้า ({n} {unit}) — กด Print / PDF เพื่อพิมพ์ครบ", en: "⋯ Showing first {shown} pages · {total} pages total ({n} {unit}) — click Print / PDF for all" },
  "cr.preview.cardsPer":   { th: "{n} การ์ด/หน้า", en: "{n} cards/page" },
  "cr.preview.rowsPer":    { th: "{n} แถว/หน้า", en: "{n} rows/page" },
  "cr.preview.autoTag":    { th: "อัตโนมัติ · ", en: "Auto · " },
  "cr.preview.pages":      { th: "{n} หน้า", en: "{n} pages" },
  "cr.unit.cards":         { th: "การ์ด", en: "cards" },
  "cr.unit.rows":          { th: "แถว", en: "rows" },

  // ── Toasts ─────────────────────────────────────────────
  "cr.toast.noTripId":     { th: "ไม่พบ trip_id ใน URL", en: "trip_id not found in URL" },
  "cr.toast.noSupabase":   { th: "ยังไม่ได้เชื่อมต่อ Supabase", en: "Not connected to Supabase" },
  "cr.toast.loadFail":     { th: "โหลดข้อมูลไม่สำเร็จ: {msg}", en: "Failed to load data: {msg}" },
  "cr.toast.presetApplied":{ th: "ใช้ preset \"{name}\" แล้ว", en: "Applied preset \"{name}\"" },
  "cr.toast.presetUpdated":{ th: "อัปเดต preset \"{name}\" แล้ว", en: "Updated preset \"{name}\"" },
  "cr.toast.presetSaved":  { th: "บันทึก preset \"{name}\" แล้ว", en: "Saved preset \"{name}\"" },
  "cr.toast.presetDeleted":{ th: "ลบ preset \"{name}\" แล้ว", en: "Deleted preset \"{name}\"" },
  "cr.toast.selectColsSave":{ th: "เลือกคอลัมน์ก่อนบันทึก preset", en: "Select columns before saving a preset" },
  "cr.toast.selectColsExport":{ th: "เลือกคอลัมน์ก่อน export", en: "Select columns before exporting" },
  "cr.toast.selectColsPrint":{ th: "เลือกคอลัมน์ก่อน print", en: "Select columns before printing" },
  "cr.toast.selectColsPreview":{ th: "เลือกคอลัมน์ก่อน", en: "Select columns first" },
  "cr.toast.allHidden":    { th: "ทุกคอลัมน์ถูกซ่อน (🙈) — เปิดอย่างน้อย 1 คอลัมน์", en: "All columns are hidden (🙈) — show at least 1 column" },
  "cr.toast.xlsxLoading":  { th: "XLSX ยังโหลดไม่เสร็จ — ลองใหม่", en: "XLSX not loaded yet — try again" },
  "cr.toast.cardExcel":    { th: "Excel ใช้รูปแบบตารางเสมอ — Card mode รองรับเฉพาะ Print/PDF", en: "Excel always uses table layout — Card mode is for Print/PDF only" },
  "cr.toast.excelDone":    { th: "ดาวน์โหลด Excel แล้ว", en: "Excel downloaded" },
  "cr.toast.selectPresetDelete":{ th: "เลือก preset ที่จะลบก่อน", en: "Select a preset to delete first" },
  "cr.toast.saveFail":     { th: "บันทึก preset ไม่สำเร็จ: {msg}", en: "Failed to save preset: {msg}" },
  "cr.toast.deleteFail":   { th: "ลบ preset ไม่สำเร็จ: {msg}", en: "Failed to delete preset: {msg}" },
  "cr.toast.printOpen":    { th: "เปิดหน้าต่าง print — เลือก 'Save as PDF' ได้", en: "Print dialog opened — you can choose 'Save as PDF'" },

  // ── Prompt / confirm modals ────────────────────────────
  "cr.prompt.saveTitle":   { th: "บันทึกชุดคอลัมน์เป็น preset", en: "Save column set as preset" },
  "cr.prompt.saveMsg":     { th: "ตั้งชื่อ preset — ใช้ซ้ำได้กับทุกทริป", en: "Name the preset — reusable across all trips" },
  "cr.prompt.savePlaceholder":{ th: "เช่น รายงานห้องพัก, รายงาน passport", en: "e.g. Room report, Passport report" },
  "cr.confirm.deleteTitle":{ th: "ลบ preset", en: "Delete preset" },
  "cr.confirm.deleteMsg":  { th: "ลบ preset \"{name}\"?", en: "Delete preset \"{name}\"?" },
});
