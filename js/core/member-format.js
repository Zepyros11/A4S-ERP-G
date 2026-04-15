/* ============================================================
   member-format.js — Display name helper for members
   Rule:
     ถ้า member_name เป็นรูปแบบบริษัท + มี full_name → ใช้ full_name
     ไม่งั้น → ใช้ member_name (fallback: full_name → "—")
   ============================================================ */

(function () {
  /* คำที่บ่งบอกว่าเป็นนิติบุคคล (จะ trigger ใช้ full_name แทน) */
  const COMPANY_RE = /บริษัท|จำกัด|ห้างหุ้นส่วน|หจก|บจก|ห้างฯ|มูลนิธิ|สมาคม|กรุ๊ป|กลุ่ม|ร้าน|โรงงาน|Co\.|Ltd|Inc\.|LLC|Corporation|Corp\.|Group/i;

  /** Return best display name for a member object */
  function displayName(m) {
    if (!m) return '—';
    const member = String(m.member_name || '').trim();
    const full = String(m.full_name || '').trim();
    if (COMPANY_RE.test(member) && full) return full;
    return member || full || '—';
  }

  /** Same rule but takes (member_name, full_name) directly — for SQL view rows */
  function displayNameFromPair(memberName, fullName) {
    return displayName({ member_name: memberName, full_name: fullName });
  }

  /** True if name matches company patterns */
  function isCompany(name) {
    return COMPANY_RE.test(String(name || ''));
  }

  window.MemberFmt = { displayName, displayNameFromPair, isCompany };
})();
