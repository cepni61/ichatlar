-- Rapor katmanı (docs/RAPOR.md). Prisma bu şemayı yönetmez. Görünümler
-- uygulama hesabının yetkisiyle çalışır; rapor kullanıcısı yalnızca bu şemayı okur.
CREATE SCHEMA IF NOT EXISTS rapor;

CREATE TABLE rapor.etiket (
  alan   text NOT NULL,
  kod    text NOT NULL,
  etiket text NOT NULL,
  PRIMARY KEY (alan, kod)
);
INSERT INTO rapor.etiket (alan, kod, etiket) VALUES
  ('durum', 'YENI', 'Yeni'), ('durum', 'UZERIME_ALINDI', 'Sahiplenildi'), ('durum', 'INCELENIYOR', 'İnceleniyor'),
  ('durum', 'CALISILIYOR', 'Çalışılıyor'), ('durum', 'EK_BILGI', 'Ek Bilgi Bekleniyor'), ('durum', 'COZULDU', 'Çözüldü'),
  ('durum', 'KAPATILDI', 'Kapatıldı'), ('durum', 'REDDEDILDI', 'Reddedildi'), ('durum', 'DEGERLENDIRILIYOR', 'Değerlendiriliyor'),
  ('durum', 'DEGERLENDIRILDI', 'Değerlendirildi'), ('durum', 'FAYDA_SAGLADI', 'Fayda Sağladı'), ('durum', 'UYGUN_BULUNMADI', 'Uygun Bulunmadı'),
  ('tur', 'BILGI', 'Bilgi talebi'), ('tur', 'ONERI', 'Öneri'),
  ('oncelik', 'NORMAL', 'Normal'), ('oncelik', 'YUKSEK', 'Yüksek'), ('oncelik', 'KRITIK', 'Kritik'),
  ('rol', 'USER', 'Çalışan'), ('rol', 'TEAM_MEMBER', 'Ekip üyesi'), ('rol', 'MANAGER', 'Ekip yöneticisi'), ('rol', 'ADMIN', 'Sistem yöneticisi'),
  ('kanal', 'YENI_KAYIT', 'Yeni Kayıt'), ('kanal', 'KAYNAK_BUL', 'Kaynak Bul'), ('kanal', 'ASISTAN', 'Asistan'),
  ('sorgu_turu', 'ML_TARAMA', 'ML taraması'), ('sorgu_turu', 'ARAMA', 'Arama'), ('sorgu_turu', 'ASISTAN', 'Asistan sorusu'),
  ('kaynak', 'KAYIT', 'Çözülmüş kayıt'), ('kaynak', 'BILGI_BANKASI', 'Bilgi Bankası'), ('kaynak', 'CORTEX', 'Kurumsal kaynak'),
  ('adim_turu', 'CREATE', 'Açılış'), ('adim_turu', 'ASSIGN', 'Üstlenme / paylaşım'), ('adim_turu', 'FORWARD', 'Yönlendirme'),
  ('adim_turu', 'STATUS', 'Durum değişikliği'), ('adim_turu', 'COMMENT', 'Güncelleme'), ('adim_turu', 'ATTACH', 'Dosya'),
  ('adim_turu', 'SLA_BREACH', 'Hedef süre aşımı'), ('adim_turu', 'REOPEN', 'Yeniden açılma'), ('adim_turu', 'LEARN', 'Önerilere ekleme'),
  ('adim_turu', 'INFO_REQUEST', 'Ek bilgi isteği'), ('adim_turu', 'INFO_RESPONSE', 'Ek bilgi yanıtı'),
  ('adim_turu', 'INFO_CANCEL', 'Ek bilgi isteği kapandı');

-- Ekip: alt birimi olmayan birim (ekibi olmayan departman kendisi ekiptir).
CREATE VIEW rapor.ekip AS
SELECT d."id" AS ekip_id, d."name" AS ekip,
       COALESCE(p."id", d."id") AS departman_id, COALESCE(p."name", d."name") AS departman,
       d."active" AS aktif
FROM "Department" d
LEFT JOIN "Department" p ON p."id" = d."parentId"
WHERE NOT EXISTS (SELECT 1 FROM "Department" c WHERE c."parentId" = d."id");

CREATE VIEW rapor.kisi AS
SELECT u."id" AS kisi_id, u."name" AS ad, u."email" AS eposta, u."departmentId" AS ekip_id,
       COALESCE(e.etiket, u."role") AS rol, u."role" AS rol_kod, u."active" AS aktif
FROM "User" u
LEFT JOIN rapor.etiket e ON e.alan = 'rol' AND e.kod = u."role";

CREATE VIEW rapor.kayit AS
SELECT r."id" AS kayit_id, r."code" AS kod,
       COALESCE(et.etiket, r."type") AS tur, r."type" AS tur_kod,
       CASE WHEN r."restricted" THEN NULL ELSE r."title" END AS baslik,
       CASE WHEN r."restricted" THEN NULL ELSE r."description" END AS aciklama,
       COALESCE(eo.etiket, r."priority") AS oncelik, r."priority" AS oncelik_kod,
       COALESCE(ed.etiket, r."status") AS durum, r."status" AS durum_kod,
       r."departmentId" AS ekip_id, r."department2Id" AS ekip2_id,
       CASE WHEN r."anonymous" THEN NULL ELSE r."createdById" END AS acan_id,
       r."assigneeId" AS sahip_id, r."anonymous" AS anonim, r."restricted" AS kisitli,
       r."createdAt" AT TIME ZONE 'UTC' AS acilis,
       r."firstResponseAt" AT TIME ZONE 'UTC' AS ilk_donus,
       r."resolvedAt" AT TIME ZONE 'UTC' AS cozulme,
       r."closedAt" AT TIME ZONE 'UTC' AS kapanis,
       hs."id" AS oturum_id
FROM "Record" r
LEFT JOIN rapor.etiket et ON et.alan = 'tur' AND et.kod = r."type"
LEFT JOIN rapor.etiket eo ON eo.alan = 'oncelik' AND eo.kod = r."priority"
LEFT JOIN rapor.etiket ed ON ed.alan = 'durum' AND ed.kod = r."status"
LEFT JOIN "HelpSession" hs ON hs."recordId" = r."id";

CREATE VIEW rapor.kayit_adimi AS
SELECT e."id" AS adim_id, e."recordId" AS kayit_id, e."at" AT TIME ZONE 'UTC' AS zaman,
       COALESCE(et.etiket, e."type") AS tur, e."type" AS tur_kod,
       COALESCE(ef.etiket, e."fromStatus") AS onceki_durum, e."fromStatus" AS onceki_durum_kod,
       COALESCE(es.etiket, e."toStatus") AS sonraki_durum, e."toStatus" AS sonraki_durum_kod,
       e."toTeamId" AS hedef_ekip_id, e."toUserId" AS hedef_kisi_id,
       CASE WHEN r."anonymous" AND e."byId" = r."createdById" THEN NULL ELSE e."byId" END AS yapan_id,
       CASE WHEN r."restricted" THEN NULL ELSE e."text" END AS metin
FROM "RecordEvent" e
JOIN "Record" r ON r."id" = e."recordId"
LEFT JOIN rapor.etiket et ON et.alan = 'adim_turu' AND et.kod = e."type"
LEFT JOIN rapor.etiket ef ON ef.alan = 'durum' AND ef.kod = e."fromStatus"
LEFT JOIN rapor.etiket es ON es.alan = 'durum' AND es.kod = e."toStatus";

CREATE VIEW rapor.ek_bilgi AS
SELECT i."id" AS istek_id, i."recordId" AS kayit_id, i."requestedById" AS isteyen_id,
       i."requestedAt" AT TIME ZONE 'UTC' AS istek_zamani,
       CASE WHEN r."restricted" THEN NULL ELSE i."question" END AS soru,
       CASE WHEN r."anonymous" AND i."answeredById" = r."createdById" THEN NULL ELSE i."answeredById" END AS yanitlayan_id,
       i."answeredAt" AT TIME ZONE 'UTC' AS yanit_zamani,
       CASE WHEN r."restricted" THEN NULL ELSE i."answer" END AS yanit,
       i."cancelledAt" AT TIME ZONE 'UTC' AS iptal_zamani,
       CASE WHEN i."answeredAt" IS NOT NULL THEN 'yanıtlandı'
            WHEN i."cancelledAt" IS NOT NULL THEN 'iptal'
            ELSE 'bekliyor' END AS sonuc,
       COALESCE(i."answeredAt", i."cancelledAt") - i."requestedAt" AS bekleme_suresi
FROM "InfoRequest" i
JOIN "Record" r ON r."id" = i."recordId";

CREATE VIEW rapor.yardim_sorgusu AS
SELECT q."id" AS sorgu_id, q."sessionId" AS oturum_id, q."at" AT TIME ZONE 'UTC' AS zaman,
       COALESCE(ek.etiket, q."kind") AS tur, q."kind" AS tur_kod,
       q."title" AS baslik, q."text" AS metin, q."recordType" AS kayit_turu_kod,
       q."selectedTeamId" AS secili_ekip_id, q."predictedTeamId" AS onerilen_ekip_id,
       q."confidence" AS guven, q."lowConfidence" AS dusuk_guven,
       q."resultCount" AS sonuc_sayisi, q."durationMs" AS sure_ms, q."mlInferenceId" AS ml_calistirma_id
FROM "HelpQuery" q
LEFT JOIN rapor.etiket ek ON ek.alan = 'sorgu_turu' AND ek.kod = q."kind";

CREATE VIEW rapor.yardim_sonucu AS
SELECT s."id" AS sonuc_id, s."queryId" AS sorgu_id, s."rank"::int AS sira,
       COALESCE(ek.etiket, s."source") AS kaynak, s."source" AS kaynak_kod,
       r."code" AS kayit_kodu, k."seq" AS bb_madde_no, s."externalUrl" AS baglanti,
       COALESCE(r."title", k."title", s."externalTitle") AS baslik,
       s."similarity"::int AS benzerlik,
       s."openedAt" AT TIME ZONE 'UTC' AS acildi_zamani,
       s."helpfulAt" AT TIME ZONE 'UTC' AS isime_yaradi_zamani
FROM "HelpResult" s
LEFT JOIN "Record" r ON r."id" = s."recordId"
LEFT JOIN "KbArticle" k ON k."id" = s."kbArticleId"
LEFT JOIN rapor.etiket ek ON ek.alan = 'kaynak' AND ek.kod = s."source";

-- Kayıt önleme: bir satır = bir tekil yardım oturumu. Takip penceresi sorguda verilir (docs/RAPOR.md).
CREATE VIEW rapor.yardim_oturumu AS
WITH q AS (
  SELECT "sessionId",
         count(*)::int AS sorgu_sayisi,
         (count(*) FILTER (WHERE "kind" IN ('ML_TARAMA', 'ASISTAN')))::int AS tarama_sayisi,
         bool_or("kind" IN ('ML_TARAMA', 'ASISTAN') AND "resultCount" > 0) AS oneri_gosterildi
  FROM "HelpQuery" GROUP BY "sessionId"
), h AS (
  SELECT hq."sessionId",
         bool_or(s."helpfulAt" IS NOT NULL) AS isime_yaradi,
         bool_or(s."openedAt" IS NOT NULL) AS sonuc_acildi
  FROM "HelpResult" s JOIN "HelpQuery" hq ON hq."id" = s."queryId"
  GROUP BY hq."sessionId"
), son AS (
  SELECT DISTINCT ON ("sessionId") "sessionId", "predictedTeamId"
  FROM "HelpQuery" WHERE "predictedTeamId" IS NOT NULL
  ORDER BY "sessionId", "at" DESC
)
SELECT o."id" AS oturum_id, o."userId" AS kisi_id,
       COALESCE(ek.etiket, o."channel") AS kanal, o."channel" AS kanal_kod,
       o."startedAt" AT TIME ZONE 'UTC' AS baslangic,
       o."lastActivityAt" AT TIME ZONE 'UTC' AS son_hareket,
       COALESCE(q.sorgu_sayisi, 0) AS sorgu_sayisi,
       COALESCE(q.tarama_sayisi, 0) AS tarama_sayisi,
       COALESCE(q.oneri_gosterildi, false) AS oneri_gosterildi,
       COALESCE(h.isime_yaradi, false) AS isime_yaradi_beyani,
       COALESCE(h.sonuc_acildi, false) AS sonuc_acildi,
       o."recordId" AS kayit_id, r."code" AS kayit_kodu, o."recordId" IS NOT NULL AS kayit_acildi,
       son."predictedTeamId" AS onerilen_ekip_id,
       -- Anonim kayıtlar sayılmaz: zamanı rapor.kayit ile eşleştirilip açan bulunurdu.
       (SELECT min(x."createdAt") FROM "Record" x
         WHERE x."createdById" = o."userId" AND NOT x."anonymous"
           AND x."createdAt" > o."startedAt" AND x."id" IS DISTINCT FROM o."recordId"
       ) AT TIME ZONE 'UTC' AS sonraki_kayit_zamani,
       (SELECT min(x."createdAt") FROM "Record" x
         WHERE x."createdById" = o."userId" AND NOT x."anonymous"
           AND x."createdAt" > o."startedAt" AND x."id" IS DISTINCT FROM o."recordId"
           AND (x."departmentId" = son."predictedTeamId" OR x."department2Id" = son."predictedTeamId")
       ) AT TIME ZONE 'UTC' AS sonraki_ayni_ekip_kaydi_zamani
FROM "HelpSession" o
LEFT JOIN q ON q."sessionId" = o."id"
LEFT JOIN h ON h."sessionId" = o."id"
LEFT JOIN son ON son."sessionId" = o."id"
LEFT JOIN "Record" r ON r."id" = o."recordId"
LEFT JOIN rapor.etiket ek ON ek.alan = 'kanal' AND ek.kod = o."channel";

-- Rapor kullanıcısı önceden oluşturulduysa yeni görünümleri de okusun.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ichatlar_rapor') THEN
    GRANT USAGE ON SCHEMA rapor TO ichatlar_rapor;
    GRANT SELECT ON ALL TABLES IN SCHEMA rapor TO ichatlar_rapor;
  END IF;
END $$;
