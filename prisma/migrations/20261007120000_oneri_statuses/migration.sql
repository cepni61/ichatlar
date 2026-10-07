-- Öneri akışı kendi durumlarına geçti (Değerlendiriliyor → Değerlendirildi /
-- Fayda Sağladı / Uygun Bulunmadı). Mevcut öneriler karşılıklarına taşınır.
-- Eski raporlar çözülen öneriyi "uygulamaya alınan öneri" saydığı için
-- çözülen / kapatılan öneri "Fayda Sağladı" olur; kabul oranı değişmez.

UPDATE "Record" SET "status" = 'DEGERLENDIRILIYOR'
WHERE "type" = 'ONERI' AND "status" IN ('UZERIME_ALINDI', 'INCELENIYOR', 'CALISILIYOR');

UPDATE "Record" SET "status" = 'FAYDA_SAGLADI', "closedAt" = COALESCE("closedAt", "resolvedAt", "updatedAt")
WHERE "type" = 'ONERI' AND "status" IN ('COZULDU', 'KAPATILDI');

UPDATE "Record" SET "status" = 'UYGUN_BULUNMADI'
WHERE "type" = 'ONERI' AND "status" = 'REDDEDILDI';
