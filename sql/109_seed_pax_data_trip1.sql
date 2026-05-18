-- ============================================================
-- Migration 109: Seed pax data for trip_id=1 (Africa Hero Thailand Trip)
--               จาก PDF export "report_total_2026-04-29"
--
-- Why:
--   ข้อมูลเดิมส่วนใหญ่ pin/nationality/tshirt_size มีอยู่แล้ว
--   แต่ religion + food_allergy + tel ยังว่างเกือบทั้งหมด
--   ใช้ PDF เป็น source of truth เติมข้อมูลที่ขาด
--
-- Safety:
--   ใช้ COALESCE(NULLIF(v.x,''), t.x) → "fill only if empty"
--   ถ้า DB มีค่าอยู่แล้ว จะไม่ overwrite (กันทับข้อมูลเก่าด้วยค่าว่าง)
--   ถ้า PDF มีค่าและ DB ว่าง → เติม
--   ถ้าทั้งคู่มีค่า → DB ชนะ (เพราะแก้ไขใน UI ล่าสุดน่าจะถูกกว่า PDF เก่า)
--
-- Note:
--   • Phone numbers — clean leading "," ก่อน (CSV artifact)
--   • VISA column ใน PDF (มีแค่ 1 row = 80952) ไม่ผูกกับ column ใน DB
--     → ไม่ seed · ถ้าต้องการเก็บ ให้ใส่ใน special_requests แยกต่างหาก
--   • Gender ไม่อยู่ใน PDF → ไม่แตะ (รักษาค่า male/female ที่มีอยู่)
--
-- Idempotent — รันซ้ำได้ (COALESCE จะให้ผลเดิม)
-- ============================================================

UPDATE tour_seat_check t
SET
  pin          = COALESCE(NULLIF(v.pin, ''), t.pin),
  nationality  = COALESCE(NULLIF(v.nationality, ''), t.nationality),
  tshirt_size  = COALESCE(NULLIF(v.tshirt_size, ''), t.tshirt_size),
  food_allergy = COALESCE(NULLIF(v.food_allergy, ''), t.food_allergy),
  religion     = COALESCE(NULLIF(v.religion, ''), t.religion),
  tel          = COALESCE(NULLIF(v.tel, ''), t.tel),
  updated_at   = now()
FROM (VALUES
  -- code,       pin,   nationality,    tshirt, food_allergy,     religion,        tel
  ('80952',     'SVP',  'Ivoirienne',   '2XL',  '',               'Christianity',  '2250787487918'),
  ('80952-1',   '',     'Ivoirienne',   '2XL',  '',               'Christianity',  '225'),
  ('81916',     'AVP',  'Nigerian',     '2XL',  'HONEY IN FOOD',  'Islam',         '8066752584'),
  ('81916-1',   '',     'Nigerian',     '3XL',  '',               'Islam',         ''),
  ('82270',     'AVP',  'Nigerian',     '2XL',  'None',           'Islam',         ''),
  ('82270-1',   '',     'Nigerian',     '2XL',  'None',           'Islam',         ''),
  ('82372',     'AVP',  'Nigerian',     '2XL',  '',               'Islam',         ''),
  ('82372-1',   '',     'Ivoirienne',   'L',    '',               'Islam',         ''),
  ('82554',     'AVP',  'Ivoirienne',   '3XL',  '',               'Christianity',  '2250711313873'),
  ('82554-1',   '',     'Ivoirienne',   'XL',   '',               'Christianity',  '2250799899733'),
  ('82770',     'SVP',  'Ivoirienne',   'XL',   '',               'Christianity',  '2250749211020'),
  ('82770-1',   '',     'Ivoirienne',   'L',    '',               'Christianity',  '2250758951399'),
  ('83894',     'SD',   'Ghanaian',     'XL',   '',               'Christianity',  ''),
  ('84354',     'SD',   'Ivoirienne',   '3XL',  '',               'Islam',         '2250707972559'),
  ('84354-1',   '',     'Ivoirienne',   '2XL',  '',               'Islam',         '2250102767672'),
  ('84401',     'AVP',  'Ivoirienne',   'M',    '',               'Christianity',  '2250747729713'),
  ('84401-1',   '',     'Ivoirienne',   'M',    '',               'Christianity',  '2250787865070'),
  ('84404',     'SD',   'Ivoirienne',   'L',    '',               'Christianity',  '2250708857081'),
  ('84406',     'SD',   'Ivoirienne',   'M',    '',               'Islam',         '2250707495916'),
  ('84406-1',   '',     'Ivoirienne',   'L',    '',               'Christianity',  '2250709128474'),
  ('84408',     'SD',   'Ivoirienne',   'L',    '',               'Christianity',  '2250707313505'),
  ('84415',     'SD',   'Ivoirienne',   'XL',   '',               'Islam',         '2250707296215'),
  ('84415-1',   '',     'Ivoirienne',   '3XL',  '',               'Islam',         '2250708545259'),
  ('84416',     'AVP',  'Beninese',     'M',    '',               'Christianity',  '2250574426184'),
  ('84416-1',   '',     'Beninese',     'L',    '',               'Christianity',  '2250709702925'),
  ('84589',     'DR',   'Ivoirienne',   '2XL',  '',               'Christianity',  '2250747196839'),
  ('84905',     'AVP',  'Nigerian',     '2XL',  'FISH ONLY',      'Islam',         '8130683035'),
  ('84905-1',   '',     'Nigerian',     '2XL',  'Sea food',       'Islam',         '8094695356'),
  ('85154',     'DR',   'Ivoirienne',   '2XL',  '',               'Christianity',  '2250777878788'),
  ('85154-1',   '',     'Ivoirienne',   '2XL',  'shrimp;crabs',   'Islam',         '2550707086704'),
  ('85193',     'VP',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250707068849'),
  ('85193-1',   '',     'Ivoirienne',   'XL',   '',               'Christianity',  '2250708569303'),
  ('85194',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250707060320'),
  ('85194-1',   '',     'Ivoirienne',   'XL',   '',               '',              ''),
  ('85228',     'AVP',  'Ivoirienne',   '2XL',  '',               'Christianity',  '2250787199201'),
  ('85228-1',   '',     'Ivoirienne',   'XL',   '',               '',              ''),
  ('85397',     'SD',   'Ivoirienne',   '2XL',  '',               'Christianity',  '2250758454182'),
  ('85397-1',   '',     'Ivoirienne',   '3XL',  '',               'Christianity',  '2250709511475'),
  ('85431',     'SD',   'Ivoirienne',   '2XL',  '',               '',              ''),
  ('85431-1',   '',     'Ivoirienne',   'XL',   '',               'Christianity',  '707968727'),
  ('85497',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250709127647'),
  ('85497-1',   '',     'Ivoirienne',   'XL',   '',               'Christianity',  '2250758305308'),
  ('85498',     'DR',   'Ivoirienne',   '3XL',  '',               '',              ''),
  ('85516',     'SD',   'Ivoirienne',   'XL',   '',               'Islam',         ''),
  ('85517',     'SD',   'Nigerian',     'L',    '',               'Islam',         ''),
  ('85560',     'DR',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250706046920'),
  ('85561',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250748711001'),
  ('85561-1',   '',     'Ivoirienne',   'XL',   '',               'Islam',         '2250758634624'),
  ('85635',     'AVP',  'Ivoirienne',   '2XL',  '',               '',              ''),
  ('85635-1',   '',     'Ivoirienne',   '2XL',  '',               '',              ''),
  ('85640',     'DR',   'Beninese',     '2XL',  '',               'Islam',         '+2250505591314'),
  ('85691',     'DR',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250749235367'),
  ('85754',     'SD',   'Ivoirienne',   '2XL',  '',               '',              ''),
  ('85754-1',   '',     'Ivoirienne',   '2XL',  '',               '',              ''),
  ('85757',     'AVP',  'Ivoirienne',   '2XL',  '',               'Islam',         '2250707438196'),
  ('85757-1',   '',     'Ivoirienne',   '3XL',  '',               'Christianity',  '225070790706'),
  ('85777',     'SD',   'Ivoirienne',   'L',    '',               'Christianity',  '2250711388501'),
  ('85777-1',   '',     'Ivoirienne',   '2XL',  '',               '',              ''),
  ('85801',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250707858836'),
  ('85998',     'SD',   'Ivoirienne',   'L',    '',               'Christianity',  '2250707530409'),
  ('86034',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250709205240'),
  ('86042',     'SD',   'Nigerian',     'L',    '',               'Christianity',  ''),
  ('86042-1',   '',     'Nigerian',     'L',    '',               'Christianity',  ''),
  ('86046',     'DR',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250709759889'),
  ('86052',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250554354403'),
  ('86052-1',   '',     'Ivoirienne',   'XL',   '',               'Christianity',  '+2250709987943'),
  ('86074',     'SD',   'Ivoirienne',   '2XL',  '',               'Christianity',  ''),
  ('86074-1',   '',     'Ivoirienne',   '5XL',  '',               'Christianity',  '2250748943711'),
  ('86125',     'VP',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250749147701'),
  ('86125-1',   '',     'Ivoirienne',   'XL',   '',               'Christianity',  '2550749147701'),
  ('86132',     'SD',   'Ivoirienne',   '2XL',  '',               'Islam',         '2250707848572'),
  ('86132-1',   '',     'Ivoirienne',   'XL',   '',               'Christianity',  '2250707303579'),
  ('86208',     'SD',   'Ivoirienne',   '2XL',  '',               'Christianity',  '2250709566522'),
  ('86212',     'DR',   'Ivoirienne',   'XL',   '',               'Christianity',  '+22507076778809'),
  ('86258',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  ''),
  ('86479',     'SD',   'Ivoirienne',   '2XL',  '',               'Christianity',  ''),
  ('86502',     'SD',   'Ivoirienne',   'M',    '',               'Christianity',  '2250747327039'),
  ('86507',     'DR',   'Ivoirienne',   'M',    '',               'Christianity',  '2250758261401'),
  ('86556',     'SD',   'Ivoirienne',   '2XL',  '',               'Christianity',  ''),
  ('86611',     'DR',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250714011243'),
  ('86855',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250747601642'),
  ('86876',     'SD',   'Ivoirienne',   '2XL',  '',               'Islam',         '2250555457451'),
  ('86927',     'SD',   'Ivoirienne',   'L',    '',               'Christianity',  '2250707018884'),
  ('87214',     'DR',   'Ivoirienne',   '2XL',  '',               'Christianity',  '2250708169694'),
  ('87331',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250574452307'),
  ('87331-1',   '',     'Ivoirienne',   'L',    '',               'Christianity',  '2250778577677'),
  ('87390',     'SD',   'Ivoirienne',   'M',    '',               'Christianity',  '2250787487918'),
  ('87390-1',   '',     'Ivoirienne',   'XL',   '',               'Christianity',  '2250759626142'),
  ('87391',     'DR',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250507973312'),
  ('87392',     'DR',   'Ivoirienne',   '2XL',  '',               'Christianity',  '2250709511475'),
  ('87399',     'SD',   'Ivoirienne',   'L',    '',               'Christianity',  '2250707108698'),
  ('87399-1',   '',     'Ivoirienne',   '3XL',  '',               'Christianity',  '2250709490401'),
  ('87461',     'SD',   'Nigerian',     '2XL',  '',               'Christianity',  '8024133656'),
  ('87590',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250778352957'),
  ('87837',     'SD',   'Ivoirienne',   '2XL',  '',               'Islam',         ''),
  ('87837-1',   '',     'Ivoirienne',   'XL',   '',               'Christianity',  ''),
  ('88017',     'SD',   'Beninese',     '2XL',  '',               'Christianity',  '22940196307'),
  ('88017-1',   '',     'Beninese',     '2XL',  '',               'Christianity',  '22948646378'),
  ('88018',     'SD',   'Togolese',     '3XL',  '',               'Christianity',  ''),
  ('88018-1',   '',     'Togolese',     '2XL',  '',               'Christianity',  ''),
  ('88019',     'SD',   'Togolese',     '2XL',  '',               'Christianity',  ''),
  ('88019-1',   '',     'Togolese',     'XL',   '',               'Christianity',  ''),
  ('88196',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  ''),
  ('88196-1',   '',     'Ivoirienne',   'XL',   '',               'Christianity',  ''),
  ('88212',     'SD',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250787329581'),
  ('88225',     'SD',   'Ivoirienne',   '2XL',  '',               'Christianity',  '2250707462162'),
  ('88281',     'SD',   'Ivoirienne',   '2XL',  '',               'Christianity',  '2250707071419'),
  ('88466',     'SD',   'Beninese',     '2XL',  '',               'Christianity',  ''),
  ('88466-1',   '',     'Beninese',     '3XL',  '',               'Christianity',  ''),
  ('88656',     'DR',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250747339242'),
  ('89002',     'SD',   'Ivoirienne',   '2XL',  '',               'Christianity',  '2250747613242'),
  ('89390',     'SD',   'France',       '2XL',  '',               'Christianity',  ''),
  ('89528',     'SD',   'Ivoirienne',   '2XL',  '',               'Christianity',  ''),
  ('90754',     'DR',   'Burkinabé',    '2XL',  '',               'Islam',         '26676429860'),
  ('91689',     'DR',   'Ivoirienne',   'XL',   '',               'Christianity',  '2250758201607'),
  ('92750',     'DR',   'Cameroonian',  'XL',   '',               'Christianity',  '674215462'),
  ('92750-1',   '',     'Cameroonian',  'XL',   '',               'Christianity',  '652409188'),
  ('93595',     'DR',   'Burkinabé',    '2XL',  '',               'Christianity',  '22651373378'),
  ('93629',     '',     'Ivoirienne',   '2XL',  '',               'Christianity',  ''),
  ('101713',    'DR',   'Ivoirienne',   '2XL',  '',               'Christianity',  '2250778158424'),
  ('AGRI',      '',     'Ivoirienne',   'XL',   '',               'Christianity',  ''),
  ('STAFF',     '',     'Nigerian',     '2XL',  '',               'Christianity',  ''),
  ('STAFF-2',   '',     'Nigerian',     'XL',   '',               'Christianity',  ''),
  ('STAFF-4',   '',     'Ivoirienne',   'XL',   '',               'Christianity',  ''),
  ('85540',     '',     'Nigerian',     'L',    '',               'Christianity',  '')
) AS v(code, pin, nationality, tshirt_size, food_allergy, religion, tel)
WHERE t.code = v.code AND t.trip_id = 1;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify (รัน query นี้ก่อน + หลัง เพื่อเทียบ):
--
--   SELECT
--     COUNT(*) FILTER (WHERE religion IS NOT NULL AND religion <> '')         AS has_religion,
--     COUNT(*) FILTER (WHERE food_allergy IS NOT NULL AND food_allergy <> '') AS has_allergy,
--     COUNT(*) FILTER (WHERE tel IS NOT NULL AND tel <> '')                   AS has_tel,
--     COUNT(*) FILTER (WHERE nationality IS NOT NULL AND nationality <> '')   AS has_nat,
--     COUNT(*) FILTER (WHERE tshirt_size IS NOT NULL AND tshirt_size <> '')   AS has_shirt,
--     COUNT(*)                                                                AS total
--   FROM tour_seat_check WHERE trip_id = 1;
--
-- Expected after seed:
--   has_religion ≥ 116 (9 rows ใน PDF ยังว่าง)
--   has_allergy  ≥ 7   (rows with non-empty allergy)
--   has_tel      ≥ 76  (rows with phone)
--   has_nat      = 125
--   has_shirt    = 125
--   total        = 125
-- ============================================================
