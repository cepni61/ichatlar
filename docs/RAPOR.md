# Rapor verisi

Kayıt önleme, ek bilgi ve kayıt adımları PostgreSQL'de tutulur; raporlar
dışarıdaki bir araçla (Power BI, Excel, SQL istemcisi) `rapor` şemasından
okunur. Uygulamada rapor ekranı yoktur.

## Bağlantı

Sunucuda bir kez: `.\deploy\windows\rapor-kullanicisi.ps1` (bkz. KURULUM.md).
Betik `ichatlar_rapor` kullanıcısını oluşturur ve parolasını bir kez gösterir.

- Yalnızca `rapor` şemasını okur; uygulama tablolarına erişemez, yazamaz.
- Zamanlar İstanbul saatiyle döner (`timestamptz`).
- Kısıtlı kayıtların ("Yalnızca ilgili ekip görsün") başlık, açıklama, adım
  metni, ek bilgi soru/yanıtı boştur. Anonim kayıtların açanı ve açanın
  adımlarındaki kişi boştur.
- Yardım oturumları sürüm kurulduğu günden itibaren tutulur; öncesi yoktur.

## Tanımlar

- **Yardım oturumu (tekil oturum):** Bir kişinin ardışık yardım adımları.
  30 dakika hareketsizlik ya da kayıt açılması oturumu kapatır. "İşime
  yaradı" ile form kapanınca da yeni oturum başlar. Taslak yazılırken uzun
  ara verildiği için açılmış oturumlar, kayıt açılınca o kaydın oturumunda
  toplanır; taslağın kendisi olmayan bir oturum (asistan, Kaynak Bul) kayda
  yalnızca son 30 dakikada kullanıldıysa bağlanır.
- **Kanal:** Oturumun başladığı yer — Yeni Kayıt, Kaynak Bul, Asistan.
- **Sorgu:** Oturumdaki bir ML taraması, arama ya da asistan sorusu. Yazarken
  kendiliğinden yenilenen tarama ve aramalar tek sorgu satırında güncellenir.
- **Çözüm önerilen oturum:** En az bir sonucun gösterildiği ML taraması ya da
  asistan sorusu içeren oturum (`oneri_gosterildi`).
- **İşe yaradı (varsayılan tanım):** Çözüm önerilen, kayda dönüşmeyen
  (`kayit_acildi = false`) ve takip penceresinde aynı kişinin önerilen ekibe
  kaydı olmayan oturum. "Bu çözüm işime yaradı" diyenler (`isime_yaradi_beyani`)
  bunun açık beyanlı alt kümesidir.

## Görünümler

### rapor.yardim_oturumu — bir satır = bir tekil yardım oturumu

| Kolon | Anlamı |
|---|---|
| oturum_id | Oturum |
| kisi_id | Kişi (`rapor.kisi`); anonim kayıtla biten oturumda boş |
| kanal, kanal_kod | Başladığı yer |
| baslangic, son_hareket | İlk ve son adım zamanı |
| sorgu_sayisi, tarama_sayisi | Bütün sorgular; ML taraması + asistan soruları |
| oneri_gosterildi | En az bir taramada sonuç gösterildi |
| isime_yaradi_beyani | Bir sonuca "Bu çözüm işime yaradı" denildi |
| sonuc_acildi | Bir sonucun bağlantısına tıklandı |
| kayit_id, kayit_kodu, kayit_acildi | Bu oturumdan açılan kayıt |
| onerilen_ekip_id | Son taramada ML'in önerdiği ekip (`rapor.ekip`) |
| sonraki_kayit_zamani | Oturum başladıktan sonra aynı kişinin açtığı ilk kayıt (bu oturumun kaydı ve anonim kayıtlar hariç) |
| sonraki_ayni_ekip_kaydi_zamani | Aynısı, yalnızca önerilen ekibe açılmış kayıtlar |

### rapor.yardim_sorgusu — bir satır = bir sorgu

`sorgu_id`, `oturum_id`, `zaman`, `tur` (ML taraması / Arama / Asistan sorusu), `tur_kod`,
`baslik` (Yeni Kayıt başlığı), `metin` (açıklama / arama sözcükleri / asistan sorusu),
`kayit_turu_kod` (BILGI/ONERI), `secili_ekip_id` (formda seçili ekip), `onerilen_ekip_id`,
`guven` (0–1), `dusuk_guven`, `sonuc_sayisi`, `sure_ms`, `ml_calistirma_id` (ML veritabanındaki çalıştırma).

### rapor.yardim_sonucu — bir satır = gösterilen bir sonuç

`sonuc_id`, `sorgu_id`, `sira`, `kaynak` (Çözülmüş kayıt / Bilgi Bankası / Kurumsal kaynak),
`kaynak_kod`, `kayit_kodu`, `bb_madde_no`, `baglanti`, `baslik`, `benzerlik` (yüzde),
`acildi_zamani` (ilk tıklama), `isime_yaradi_zamani`.

### rapor.kayit — bir satır = bir kayıt

`kayit_id`, `kod`, `tur`, `baslik`, `aciklama`, `oncelik`, `durum` (+ `_kod` kolonları),
`ekip_id`, `ekip2_id`, `acan_id`, `sahip_id`, `anonim`, `kisitli`,
`acilis`, `ilk_donus`, `cozulme`, `kapanis`, `oturum_id` (açıldığı yardım oturumu).

### rapor.kayit_adimi — bir satır = kaydın bir adımı

`adim_id`, `kayit_id`, `zaman`, `tur` (Açılış, Üstlenme / paylaşım, Yönlendirme, Durum değişikliği,
Güncelleme, Ek bilgi isteği/yanıtı…), `onceki_durum`, `sonraki_durum` (+ `_kod`),
`hedef_ekip_id`, `hedef_kisi_id`, `yapan_id`, `metin`.
Durum değiştirmeyen adımlarda önceki/sonraki durum boştur. Bu sürümden önceki
adımlarda yalnızca eski kayıttan çıkarılabilenler doludur.

### rapor.ek_bilgi — bir satır = bir ek bilgi isteği

`istek_id`, `kayit_id`, `isteyen_id`, `istek_zamani`, `soru`, `yanitlayan_id`, `yanit_zamani`,
`yanit`, `iptal_zamani`, `sonuc` (yanıtlandı / iptal / bekliyor),
`bekleme_suresi` (yanıt ya da iptale kadar; bekleyenlerde boş).

### rapor.ekip, rapor.kisi, rapor.etiket

`rapor.ekip`: `ekip_id`, `ekip`, `departman_id`, `departman`, `aktif`.
`rapor.kisi`: `kisi_id`, `ad`, `eposta`, `ekip_id`, `rol`, `rol_kod`, `aktif`.
`rapor.etiket`: `alan`, `kod`, `etiket` — görünümlerdeki Türkçe etiketlerin sözlüğü.

## Örnek sorgular

Kayıt önleme oranı, haftalık, takip penceresi 7 gün:

```sql
WITH o AS (
  SELECT date_trunc('week', baslangic) AS hafta, *,
         NOT kayit_acildi
           AND (sonraki_ayni_ekip_kaydi_zamani IS NULL
                OR sonraki_ayni_ekip_kaydi_zamani > son_hareket + interval '7 days') AS onlendi
  FROM rapor.yardim_oturumu
  WHERE oneri_gosterildi
)
SELECT hafta,
       count(*) AS cozum_onerilen_oturum,
       count(*) FILTER (WHERE onlendi) AS onlenen_oturum,
       round(100.0 * count(*) FILTER (WHERE onlendi) / nullif(count(*), 0), 1) AS onleme_orani_yuzde,
       count(DISTINCT kisi_id) FILTER (WHERE onlendi) AS yararlanan_kisi,
       count(*) FILTER (WHERE onlendi AND isime_yaradi_beyani) AS acik_beyanli
FROM o
GROUP BY hafta
ORDER BY hafta;
```

Kim kaç kez yararlandı (son 30 gün):

```sql
SELECT k.ad, e.ekip, count(*) AS onlenen_oturum
FROM rapor.yardim_oturumu o
JOIN rapor.kisi k ON k.kisi_id = o.kisi_id
LEFT JOIN rapor.ekip e ON e.ekip_id = k.ekip_id
WHERE o.oneri_gosterildi AND NOT o.kayit_acildi
  AND (o.sonraki_ayni_ekip_kaydi_zamani IS NULL OR o.sonraki_ayni_ekip_kaydi_zamani > o.son_hareket + interval '7 days')
  AND o.baslangic > now() - interval '30 days'
GROUP BY k.ad, e.ekip
ORDER BY onlenen_oturum DESC;
```

Ek bilgi bekleme süresi, ekip bazında:

```sql
SELECT e.ekip, count(*) AS istek,
       count(*) FILTER (WHERE b.sonuc = 'yanıtlandı') AS yanitlanan,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY b.bekleme_suresi) AS medyan_bekleme
FROM rapor.ek_bilgi b
JOIN rapor.kayit r ON r.kayit_id = b.kayit_id
JOIN rapor.ekip e ON e.ekip_id = r.ekip_id
GROUP BY e.ekip
ORDER BY istek DESC;
```

Bir kaydın durumlarda geçirdiği süre:

```sql
SELECT kayit_id, sonraki_durum AS durum, zaman AS giris,
       lead(zaman) OVER (PARTITION BY kayit_id ORDER BY zaman) - zaman AS sure
FROM rapor.kayit_adimi
WHERE sonraki_durum IS NOT NULL
ORDER BY kayit_id, zaman;
```
