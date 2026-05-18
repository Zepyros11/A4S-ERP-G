-- ============================================================
-- Migration 110: Seed sub-row pax data — match by NAME (not code)
--                สำหรับ trip_id=1
--
-- Why:
--   PDF/Excel ใช้ code pattern "{parent}-1" สำหรับ sub-row
--   แต่ DB เก็บ sub-row ด้วย code อื่น (เช่น 11938 ไม่ใช่ 85154-1)
--   → migration 109 (match by code) เลย miss sub-row ที่ DB ใช้ code อื่น
--
--   Solution: match by NAME แทน — เฉพาะ sub-row (is_sub_row=true)
--   เพื่อไม่ให้ accidentally update parent ที่อาจชื่อซ้ำกัน
--
-- Safety:
--   • COALESCE(NULLIF(v.x,''), t.x) — fill only if empty (idempotent)
--   • UPPER(TRIM(...)) — case/whitespace tolerant
--   • is_sub_row = true filter — กันชน parent (มี edge case 2 รายที่ชื่อซ้ำ
--     KOUADIO BROU NESTOR — แต่ทั้งคู่เป็น parent ไม่ใช่ sub)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

UPDATE tour_seat_check t
SET
  nationality  = COALESCE(NULLIF(v.nationality, ''), t.nationality),
  tshirt_size  = COALESCE(NULLIF(v.tshirt_size, ''), t.tshirt_size),
  food_allergy = COALESCE(NULLIF(v.food_allergy, ''), t.food_allergy),
  religion     = COALESCE(NULLIF(v.religion, ''), t.religion),
  tel          = COALESCE(NULLIF(v.tel, ''), t.tel),
  updated_at   = now()
FROM (VALUES
  -- name (sub-row),                                  nationality,    tshirt, food_allergy,    religion,        tel
  ('MAO GUY ELVIS LEMANOY',                           'Ivoirienne',   '2XL',  '',              'Christianity',  '225'),
  ('OKECHUKWU-NWANNE NNEKA FIDELIA',                  'Nigerian',     '3XL',  '',              'Islam',         ''),
  ('HORY JANADA JOHN',                                'Nigerian',     '2XL',  'None',          'Islam',         ''),
  ('AMINU FIDDAUSI',                                  'Ivoirienne',   'L',    '',              'Islam',         ''),
  ('KRANGBA MARCEL',                                  'Ivoirienne',   'XL',   '',              'Christianity',  '2250799899733'),
  ('KOUASSI SAFFO MARCELLIN',                         'Ivoirienne',   'L',    '',              'Christianity',  '2250758951399'),
  ('SIRIKI EPSE KONAN ADJOUA MATTATA',                'Ivoirienne',   '2XL',  '',              'Islam',         '2250102767672'),
  ('SANGE YAH CLARISSE',                              'Ivoirienne',   'M',    '',              'Christianity',  '2250787865070'),
  ('KOFFI KOUASSI NOEL',                              'Ivoirienne',   'L',    '',              'Christianity',  '2250709128474'),
  ('KONE SEKOU',                                      'Ivoirienne',   '3XL',  '',              'Islam',         '2250708545259'),
  ('HESSOU ZACHARIE COMLAN',                          'Beninese',     'L',    '',              'Christianity',  '2250709702925'),
  ('SAMINU MUSA MUHAMMAD',                            'Nigerian',     '2XL',  'Sea food',      'Islam',         '8094695356'),
  ('KOUAO ASSI SAMSON',                               'Ivoirienne',   '2XL',  'shrimp;crabs',  'Islam',         '2550707086704'),
  ('FOSSOU BAHE MARINE NOELLE',                       'Ivoirienne',   'XL',   '',              'Christianity',  '2250708569303'),
  ('N''GUESSAN KOFFI SAMUEL',                         'Ivoirienne',   'XL',   '',              '',              ''),
  ('SOUMAHORO MOUSSA',                                'Ivoirienne',   'XL',   '',              '',              ''),
  ('YEDOH NOMEL KEVIN',                               'Ivoirienne',   '3XL',  '',              'Christianity',  '2250709511475'),
  ('N''GORAN KOUAME DESIRE',                          'Ivoirienne',   'XL',   '',              'Christianity',  '707968727'),
  ('KOUASSI N''ZIBLA ROSEMONDE PARISELLE',            'Ivoirienne',   'XL',   '',              'Christianity',  '2250758305308'),
  ('COULIBALY MOUSSA',                                'Ivoirienne',   'XL',   '',              'Islam',         '2250758634624'),
  ('AYEHUI OLGA MIREILLE',                            'Ivoirienne',   '2XL',  '',              '',              ''),
  ('ASSEU ASSAMOI ALAIN',                             'Ivoirienne',   '2XL',  '',              '',              ''),
  ('KONAN BROU KAN LOUIS',                            'Ivoirienne',   '3XL',  '',              'Christianity',  '225070790706'),
  ('KOFFI KOUASSI CYPRIEN',                           'Ivoirienne',   '2XL',  '',              '',              ''),
  ('MBA FRANCISCA OKOMWA',                            'Nigerian',     'L',    '',              'Christianity',  ''),
  ('KOUASSI GOORE ROMEO FIDELE',                      'Ivoirienne',   'XL',   '',              'Christianity',  '+2250709987943'),
  ('YAO KONAN JOSUE',                                 'Ivoirienne',   '5XL',  '',              'Christianity',  '2250748943711'),
  ('KOUADIO YAO ALPHONSE',                            'Ivoirienne',   'XL',   '',              'Christianity',  '2550749147701'),
  ('KREME AKOUA PATRICIA ISABELLE',                   'Ivoirienne',   'XL',   '',              'Christianity',  '2250707303579'),
  ('GUE COMMI LAMBERT',                               'Ivoirienne',   'L',    '',              'Christianity',  '2250778577677'),
  ('GBELE WALET RENE',                                'Ivoirienne',   'XL',   '',              'Christianity',  '2250759626142'),
  ('TAHI PATRICE',                                    'Ivoirienne',   '3XL',  '',              'Christianity',  '2250709490401'),
  ('KOUASSI AMOIN AGNES',                             'Ivoirienne',   'XL',   '',              'Christianity',  ''),
  ('AKITAN EPOUSE ASSOGBA KEHINDA ESTHER',            'Beninese',     '2XL',  '',              'Christianity',  '22948646378'),
  ('AVITY ELOM',                                      'Togolese',     '2XL',  '',              'Christianity',  ''),
  ('DEGBESSE KOKOUVI',                                'Togolese',     'XL',   '',              'Christianity',  ''),
  ('ANGBOMON AYA SYNTHIA BENEDICTE LUCETTE',          'Ivoirienne',   'XL',   '',              'Christianity',  ''),
  ('BAKARI LASSISSI TCHEYE',                          'Beninese',     '3XL',  '',              'Christianity',  ''),
  ('BOJA HARIETTA ASHIE',                             'Cameroonian',  'XL',   '',              'Christianity',  '652409188')
) AS v(name, nationality, tshirt_size, food_allergy, religion, tel)
WHERE UPPER(TRIM(t.name)) = UPPER(TRIM(v.name))
  AND t.trip_id = 1
  AND t.is_sub_row = true;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify (ก่อน+หลังเทียบดู):
--
--   SELECT
--     COUNT(*) FILTER (WHERE is_sub_row = true) AS sub_count,
--     COUNT(*) FILTER (WHERE is_sub_row = true AND religion IS NOT NULL AND religion <> '')   AS sub_has_religion,
--     COUNT(*) FILTER (WHERE is_sub_row = true AND tel IS NOT NULL AND tel <> '')             AS sub_has_tel,
--     COUNT(*) FILTER (WHERE is_sub_row = true AND tshirt_size IS NOT NULL AND tshirt_size <> '') AS sub_has_shirt
--   FROM tour_seat_check WHERE trip_id = 1;
--
-- หาแถวที่ name ใน PDF ไม่ match กับ DB (debug):
--
--   WITH pdf_names(name) AS (VALUES
--     ('MAO GUY ELVIS LEMANOY'),('OKECHUKWU-NWANNE NNEKA FIDELIA'),
--     ('HORY JANADA JOHN'),('AMINU FIDDAUSI'),
--     ... (paste จาก VALUES ด้านบน) ...
--   )
--   SELECT p.name
--   FROM pdf_names p
--   LEFT JOIN tour_seat_check t
--     ON UPPER(TRIM(t.name)) = UPPER(TRIM(p.name))
--    AND t.trip_id = 1
--    AND t.is_sub_row = true
--   WHERE t.id IS NULL;
-- ============================================================
