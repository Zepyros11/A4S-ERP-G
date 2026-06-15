/* ============================================================
   bahtText.js — แปลงจำนวนเงินเป็นตัวหนังสือภาษาไทย (global helper)
   ------------------------------------------------------------
   ใช้ในเอกสารที่ต้องมี "จำนวนเงินเป็นตัวอักษร" เช่น
   ใบรับรองแทนใบเสร็จรับเงิน / ใบสำคัญเงินสดย่อย

   API (global · window.BahtText):
     BahtText(1234.5)  → "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์"
     BahtText(4673)    → "สี่พันหกร้อยเจ็ดสิบสามบาทถ้วน"
     BahtText(0)       → "ศูนย์บาทถ้วน"
   ============================================================ */
(function () {
  "use strict";

  const NUM = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
  const POS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"]; // ตำแหน่งภายในกลุ่มล้าน

  // อ่านจำนวนเต็ม → ตัวหนังสือ (รองรับหลักล้านแบบ recursive)
  function readNumber(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return "";
    // หลักล้าน (และมากกว่า) — แยกซ้ำเป็นกลุ่มละ 6 หลัก
    if (n > 999999) {
      const millions = Math.floor(n / 1000000);
      const rest = n % 1000000;
      let r = readNumber(millions) + "ล้าน";
      if (rest > 0) r += readNumber(rest);
      return r;
    }
    const digits = String(n).split("").reverse(); // index 0 = หลักหน่วย
    let result = "";
    for (let i = digits.length - 1; i >= 0; i--) {
      const d = parseInt(digits[i], 10);
      if (d === 0) continue;
      if (i === 1 && d === 1) {
        result += "สิบ"; // ไม่ใช่ "หนึ่งสิบ"
      } else if (i === 1 && d === 2) {
        result += "ยี่สิบ"; // ยี่สิบ
      } else if (i === 0 && d === 1 && digits.length > 1) {
        result += "เอ็ด"; // หลักหน่วย = 1 และมีหลักสิบขึ้นไป → เอ็ด
      } else {
        result += NUM[d] + POS[i];
      }
    }
    return result;
  }

  function bahtText(value) {
    let num = parseFloat(value);
    if (isNaN(num)) num = 0;
    const isNeg = num < 0;
    num = Math.round(Math.abs(num) * 100) / 100; // ปัดเป็น 2 ตำแหน่ง
    const baht = Math.floor(num);
    const satang = Math.round((num - baht) * 100);

    let text = baht === 0 ? "ศูนย์บาท" : readNumber(baht) + "บาท";
    text += satang === 0 ? "ถ้วน" : readNumber(satang) + "สตางค์";
    return (isNeg ? "ลบ" : "") + text;
  }

  window.BahtText = bahtText;
})();
