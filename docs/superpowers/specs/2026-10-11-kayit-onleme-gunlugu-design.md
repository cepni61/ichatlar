# Kayıt önleme günlüğü ve ek bilgi akışı — tasarım

Tarih: 2026-10-11 · Durum: onaylandı (konuşmada, bölüm bölüm; §12 plan yazılırken netleşenler)

## 1. Amaç

Kurum, kayıt önleme oranını (deflection) ölçmek istiyor: çalışan uygulamadaki
yardımla sorununu çözüp kayıt açmadı mı, kaç kişi kaç kez yararlandı. Rapor
uygulamada **yapılmayacak**; kullanıcı raporu dışarıda hazırlayıp PostgreSQL'den
okuyacak. Bu iş, o raporun dayanacağı **düzgün ilişkisel günlüğü** ve okuma
katmanını kurar. Ayrıca kaydı üstlenen kişinin açandan ek bilgi istemesi
gerçek bir akışa dönüşür.

Kullanıcının koyduğu ölçüt:

> Kayıt önleme oranı = "işe yaradı" sayılan ve takip penceresinde aynı konuda
> talep açılmayan tekil yardım oturumları / çözüm önerilen oturumlar.

Kullanıcı kararları:
- ML ile kontrol edip kayıt açmayan oturum "işe yaradı" sayılır. Yeni beyan
  düğmesi eklenmez; var olan "Bu çözüm işime yaradı" düğmesi açık beyan olarak
  ayrıca kaydedilir.
- Takip penceresi ve "aynı konu" kuralı raporda parametredir; uygulama yalnızca
  gereken işaretleri saklar.
- Metinler süresiz saklanır (saklama süresi yok).
- Ek bilgi beklemesi için hedef süre konmaz; mevcut SLA'ya dokunulmaz.
- Tek tablolu olay günlüğü değil, varlık başına tablolar, tipli kolonlar, FK ve
  kısıtlar; rapor için ayrı görünüm katmanı.

## 2. Kapsam

Kapsamda:
- Yeni tablolar: `HelpSession`, `HelpQuery`, `HelpResult`, `InfoRequest`.
- `RecordEvent`'e tipli kolonlar, `meta` → `jsonb`.
- Yardım yüzeylerinin (Yeni Kayıt ML kontrolü, asistan, Kaynak Bul) günlüğe yazması.
- Ek bilgi akışı (istek, yanıt, iptal).
- `rapor` şeması: görünümler + etiket sözlüğü; salt okunur `ichatlar_rapor` kullanıcısı.
- Mevcut veri için geçiş (backfill).
- Testler ve belgeler (`docs/RAPOR.md`, README, KURULUM).

Kapsam dışı:
- Uygulama içi rapor ekranı.
- ML veritabanının (SQLite) PostgreSQL'e taşınması.
- Mevcut tabloların kod kolonlarını (durum, tür, öncelik) sözlük tablolarına
  dönüştürmek.
- Geçmiş ML taramalarının yardım oturumu olarak aktarılması: ölçüm kurulumdan
  itibaren başlar.

## 3. Tanımlar

**Yardım oturumu (tekil oturum).** Bir kişinin ardışık yardım adımları. Web
analitiğindeki olağan tanım: **30 dakika hareketsizlik** ya da **kayıt
açılması** oturumu kapatır. Oturum kimliğini sunucu üretir; tarayıcı sekme
boyunca taşır ve geri gönderir.

- Gelen kimlik şu koşullarda kullanılır: oturum bu kişinin, `recordId` boş,
  `lastActivityAt` son 30 dakikada. Değilse yeni oturum açılır ve yeni kimlik döner.
- Kayıt açılışında bağlama daha geniştir: kişinin, kayda bağlanmamış ve son
  **24 saatte** hareket görmüş oturumu kabul edilir. (Taramadan sonra formu
  uzun süre yazan kişinin kaydı, taramanın oturumuna bağlanmalı.)
- "İşime yaradı" ile form temizlenince tarayıcı oturum kimliğini bırakır;
  "Geri al" kimliği de geri getirir. Kayıt açılınca kimlik bırakılır.
- Asistandan "Bu konuda kayıt aç" ile forma geçen kişi aynı oturumda kalır.

**Kanal** (`channel`): oturumun başladığı yüzey — `YENI_KAYIT`, `KAYNAK_BUL`, `ASISTAN`.

**Önleme ölçüsü** (raporda hesaplanır; aşağıdaki varsayılan tanımdır, Kaynak
Bul aramaları da günlükte olduğundan rapor tarafında genişletilebilir):
- Payda: en az bir sonucun gösterildiği ML taraması (`ML_TARAMA` ya da `ASISTAN`) içeren oturumlar.
- Pay: bunlardan `recordId` boş olan ve takip penceresinde aynı kişinin aynı
  ekibe kaydı olmayanlar. `HelpResult.helpfulAt` dolu olanlar açık beyanlı alt kümedir.
- Kaç kişi: `count(distinct userId)`; kaç kez: oturum sayısı.

## 4. Veri modeli

Kimlikler mevcut tablolardaki gibi `cuid` metin; zamanlar mevcut tablolarla aynı
tipte (`timestamp(3)`, UTC). Kod kolonları metin + **CHECK kısıtı** (migration
SQL'inde; Prisma şeması bunları göstermez). Her FK ve zaman kolonunda index.

### HelpSession — tekil yardım oturumu

| Kolon | Tip | Not |
|---|---|---|
| `id` | text PK | |
| `userId` | text FK → User, null olabilir, `ON DELETE SET NULL` | Anonim kayıtta boşaltılır |
| `channel` | text, CHECK (`YENI_KAYIT`,`KAYNAK_BUL`,`ASISTAN`) | Başlangıç yüzeyi |
| `startedAt` | timestamp | |
| `lastActivityAt` | timestamp | Her sorgu, tıklama, beyan günceller |
| `recordId` | text FK → Record, **UNIQUE**, null olabilir, `ON DELETE SET NULL` | Bu oturumdan açılan kayıt |

Index: (`userId`, `startedAt`), (`startedAt`).

### HelpQuery — oturumdaki tarama, arama ya da asistan sorusu

| Kolon | Tip | Not |
|---|---|---|
| `id` | text PK | |
| `sessionId` | text FK → HelpSession, `ON DELETE CASCADE` | |
| `at` | timestamp | Kaynak Bul birleştirmesinde son hâlin zamanı |
| `kind` | text, CHECK (`ML_TARAMA`,`ARAMA`,`ASISTAN`) | |
| `title` | text null | Yeni Kayıt başlığı; arama ve asistan için boş |
| `text` | text null | Açıklama / arama sözcükleri / asistan sorusu. Kısıtlı kayıtta boş |
| `recordType` | text null, CHECK (`BILGI`,`ONERI`) | Yalnız ML_TARAMA |
| `selectedTeamId` | text FK → Department null | Taramada formda seçili ekip |
| `predictedTeamId` | text FK → Department null | Modelin ilk önerisi |
| `confidence` | double precision null | 0–1 |
| `lowConfidence` | boolean null | |
| `resultCount` | integer | Gösterilen sonuç sayısı |
| `durationMs` | integer null | |
| `mlInferenceId` | text null | SQLite ML veritabanındaki `Inference.id` (FK değil: ayrı veritabanı) |

Index: (`sessionId`, `at`), (`at`), (`predictedTeamId`).

### HelpResult — sorguda gösterilen sonuç

| Kolon | Tip | Not |
|---|---|---|
| `id` | text PK | |
| `queryId` | text FK → HelpQuery, `ON DELETE CASCADE` | |
| `rank` | smallint | 1'den başlar, ekrandaki sıra |
| `source` | text, CHECK (`KAYIT`,`BILGI_BANKASI`,`CORTEX`) | |
| `recordId` | text FK → Record null, `ON DELETE SET NULL` | source = KAYIT |
| `kbArticleId` | text FK → KbArticle null, `ON DELETE SET NULL` | source = BILGI_BANKASI |
| `externalUrl` | text null | source = CORTEX |
| `externalTitle` | text null | source = CORTEX (başlık veritabanında başka yerde yok) |
| `similarity` | smallint null | Yüzde, 0–100 (ML eşleşmelerinde) |
| `openedAt` | timestamp null | Bağlantıya ilk tıklama |
| `helpfulAt` | timestamp null | "Bu çözüm işime yaradı" |

CHECK: yalnızca kaynağa uyan hedef kolon dolu olabilir — `recordId` yalnız
KAYIT'ta, `kbArticleId` yalnız BILGI_BANKASI'nda, `externalUrl`/`externalTitle`
yalnız CORTEX'te. (Kayıt/madde sonradan silinirse FK boşalabildiği, Cortex
sonucunun bağlantısı da boş gelebildiği için "dolu olmalı" kısıtı konmaz.)

Index: (`queryId`), (`recordId`), (`kbArticleId`).

### InfoRequest — ek bilgi isteği

| Kolon | Tip | Not |
|---|---|---|
| `id` | text PK | |
| `recordId` | text FK → Record, `ON DELETE CASCADE` | |
| `requestedById` | text FK → User null, `ON DELETE SET NULL` | |
| `requestedAt` | timestamp | |
| `question` | text | 5–1000 karakter |
| `statusBefore` | text | İstekten önceki durum; yanıtla buna dönülür |
| `answeredById` | text FK → User null, `ON DELETE SET NULL` | |
| `answeredAt` | timestamp null | |
| `answer` | text null | |
| `answerEventId` | text FK → RecordEvent null, `ON DELETE SET NULL` | Yanıtın ekleri bu olaya bağlı |
| `cancelledAt` | timestamp null | Yanıt beklenmeden devam edildi |

CHECK: `answeredAt` ile `cancelledAt` aynı anda dolu olamaz; `answeredAt` doluysa `answer` dolu.
**Kısmi unique index:** `recordId` üzerinde, `answeredAt IS NULL AND cancelledAt IS NULL`
koşuluyla — kayıt başına en fazla bir açık istek. (Ayrıca istek, kayıt satırı
kilitliyken açılır.) Index: (`recordId`, `requestedAt`).

### RecordEvent — eklenen kolonlar

| Kolon | Tip | Not |
|---|---|---|
| `fromStatus` | text null | Durum değiştiyse önceki |
| `toStatus` | text null | Durum değiştiyse sonraki; kayıt açılışında `YENI` |
| `toTeamId` | text FK → Department null | Açılış ve yönlendirmede hedef ekip |
| `toUserId` | text FK → User null, `ON DELETE SET NULL` | Üstlenme ve kişiye yönlendirmede hedef kişi |
| `meta` | **jsonb** (metinden dönüştürülür) | |

Index: (`recordId`, `at`) zaten var; (`toStatus`, `at`) eklenir.

Yeni `EventType` değerleri: `INFO_REQUEST`, `INFO_RESPONSE`, `INFO_CANCEL`.
Yeni `NotificationType`: `INFO_PROVIDED`.

## 5. Yazma noktaları

Günlük yazımı yardımın kendisini bozmaz: yardım yüzeylerinde günlük yazılamazsa
hata kaydedilir (`log.warn`) ve sonuçlar yine döner (yanıtta `helpSessionId`
boş olur). Kayıt açılışında oturum bağlama kayıtla aynı işlemdedir ama geçersiz
oturum kimliği kaydı engellemez, yalnızca bağlanmaz.

| Adım | Uç | Yazılan |
|---|---|---|
| ML ile Kontrol Et | `POST /api/similar` + `helpSessionId?`, `channel` (`YENI_KAYIT` varsayılan) | Oturum çözülür/açılır; `HelpQuery` (ML_TARAMA) + her eşleşme için `HelpResult` (KAYIT ya da BILGI_BANKASI). Yanıta `helpSessionId` ve her eşleşmeye `resultId` eklenir |
| Asistana serbest soru | Aynı uç, `channel: 'ASISTAN'`, `limit: 1` | `HelpQuery` (ASISTAN) + gösterilen tek sonuç |
| Kaynak Bul araması | `GET /api/search/resources?q&helpSessionId` | `HelpQuery` (ARAMA) + sonuçlar (KAYIT / BILGI_BANKASI / CORTEX). Boş sorgu yazılmaz. **Birleştirme:** oturumun son sorgusu ARAMA ise, 10 saniye içindeyse ve yeni metin eskisinin önekiyse ya da tersi, yeni satır açılmaz; o sorgu güncellenir ve sonuçları yenilenir (henüz tıklanmamış/beyan almamışsa; aksi hâlde yeni satır) |
| Bağlantıya tıklama | `POST /api/help/results/:id` `{action:'open'}` | `openedAt` (ilk tıklama) |
| İşime yaradı | aynı uç `{action:'helpful'}` | `helpfulAt` |
| Geri al | aynı uç `{action:'unhelpful'}` | `helpfulAt` boşalır |
| Kayıt açılışı | `POST /api/records` + `helpSessionId?` | Aynı işlemde `HelpSession.recordId`. Geçerli oturum yoksa sorgusuz bir oturum (`YENI_KAYIT`) açılıp bağlanır. Anonimse oturumun `userId`'si boşaltılır; kısıtlıysa oturumdaki sorguların `title`/`text`'i boşaltılır. Açılış olayı `toStatus=YENI`, `toTeamId=ekip` taşır |
| Kayıt aksiyonları | mevcut uçlar (`mutate`) | `RecordEvent`'in yeni kolonları `mutate` içinde tek noktada: `nextStatus` mevcut durumdan farklıysa `fromStatus`/`toStatus`; plan `toTeamId`/`toUserId` verir (üstlenme, yönlendirme) |

`/api/help/results/:id` yalnızca sonucu kendi oturumunda olan kişiye açıktır
(değilse 404); oturumun `lastActivityAt`'ini günceller; 204 döner.

Kısıtlı taslak: Yeni Kayıt'ta "Yalnızca ilgili ekip görsün" işaretliyken yapılan
taramada `title`/`text` baştan boş yazılır (ML veritabanındaki mevcut kuralla aynı).

## 6. Ek bilgi akışı

- **Kim:** kaydın sahibi (üstlenen) ya da sistem yöneticisi, kayıt açıkken.
  Yeni aksiyon `infoRequest`, izin kuralı `status` ile aynı.
- **İstek:** `POST /api/records/:code/info-request` `{question}` (5–1000 karakter).
  Açık istek varsa 409. Aynı işlemde: `InfoRequest` (statusBefore = mevcut
  durum), durum → `EK_BILGI`, `RecordEvent` (`INFO_REQUEST`, metin "Ek bilgi
  istendi: <soru>"), açana `INFO_REQUESTED` bildirimi (metinde soru yok).
- **"Durum güncelle"** artık `EK_BILGI` kabul etmez (400); arayüz listesinden kalkar.
  Detayda sahibine "Ek Bilgi İste" düğmesi çıkar.
- **Yanıt:** açık istek varken açan kişinin eklediği güncelleme (`/comments`,
  ekleriyle) yanıttır. Aynı işlemde: istek yanıtlandı (`answeredAt`, `answer`,
  `answerEventId`), olay `INFO_RESPONSE`, durum → `statusBefore` (geçiş tablosu
  izin vermiyorsa öneride `DEGERLENDIRILIYOR`, bilgide `CALISILIYOR`), sahibine
  `INFO_PROVIDED` bildirimi ("ek bilgi geldi"). Arayüzde açan kişi soruyu
  kaydın üstünde görür; güncelleme alanının başlığı "Yanıtla" olur.
- **İptal:** açık istek varken kayıt `EK_BILGI`'den başka duruma geçerse (durum
  güncelleme, çözüm, ret, yönlendirme) istek `cancelledAt` ile kapanır ve
  `INFO_CANCEL` olayı yazılır. `mutate` içinde tek noktada.
- **Süre:** hedef süre, hatırlatma, otomatik kapanma yok.

## 7. Gizlilik kuralları

Uygulamanın iki sözü günlükte de korunur:
- **Kısıtlı kayıt** ("Yalnızca ilgili ekip görsün"): sorgu metinleri saklanmaz
  ya da kayıt açılınca silinir; görünümlerde kaydın başlık/açıklama, ek bilgi
  soru/yanıt ve adım metinleri boştur.
- **Anonim kayıt:** oturumun kişisi silinir; görünümlerde açan kişi ve açanın
  yaptığı adımlarda kişi boştur.

Ham tablolar yalnızca uygulama hesabına açıktır; rapor kullanıcısı yalnızca
`rapor` görünümlerini okur.

## 8. Rapor katmanı

Ayrı `rapor` şeması (Prisma bu şemayı yönetmez; migration SQL'inde kurulur).
Görünümler uygulama hesabının sahipliğindedir ve onun yetkisiyle çalışır.
Zaman kolonları `timestamptz` döner (`at AT TIME ZONE 'UTC'`).

| Nesne | Satır | Ana kolonlar |
|---|---|---|
| `rapor.etiket` (tablo) | kod → etiket | `alan` (durum, tur, oncelik, kanal, sorgu_turu, kaynak, adim_turu), `kod`, `etiket`; PK (`alan`,`kod`). Migration doldurur |
| `rapor.ekip` | ekip | `ekip_id`, `ekip`, `departman_id`, `departman` |
| `rapor.kisi` | kişi | `kisi_id`, `ad`, `eposta`, `ekip_id`, `rol`, `aktif` |
| `rapor.yardim_oturumu` | oturum | `oturum_id`, `kisi_id`, `kanal`, `baslangic`, `son_hareket`, `sorgu_sayisi`, `tarama_sayisi`, `oneri_gosterildi`, `isime_yaradi_beyani`, `kayit_id`, `kayit_kodu`, `kayit_acildi`, `onerilen_ekip_id` (son taramanın), `sonraki_kayit_zamani`, `sonraki_ayni_ekip_kaydi_zamani` (aynı kişinin bu oturumdan sonra açtığı ilk kayıt; ikincisi `onerilen_ekip_id`'ye) |
| `rapor.yardim_sorgusu` | sorgu | `sorgu_id`, `oturum_id`, `zaman`, `tur`, `baslik`, `metin`, `kayit_turu`, `secili_ekip`, `onerilen_ekip`, `guven`, `dusuk_guven`, `sonuc_sayisi`, `sure_ms` |
| `rapor.yardim_sonucu` | sonuç | `sonuc_id`, `sorgu_id`, `sira`, `kaynak`, `kayit_kodu`, `bb_madde_no`, `baglanti`, `baslik`, `benzerlik`, `acildi_zamani`, `isime_yaradi_zamani` |
| `rapor.kayit` | kayıt | `kayit_id`, `kod`, `tur`, `baslik`, `aciklama`, `oncelik`, `durum`, `ekip_id`, `ekip2_id`, `acan_id`, `sahip_id`, `anonim`, `kisitli`, `acilis`, `ilk_donus`, `cozum`, `kapanis`, `oturum_id` |
| `rapor.kayit_adimi` | adım | `adim_id`, `kayit_id`, `zaman`, `tur`, `onceki_durum`, `sonraki_durum`, `hedef_ekip_id`, `hedef_kisi_id`, `yapan_id`, `metin` |
| `rapor.ek_bilgi` | istek | `istek_id`, `kayit_id`, `isteyen_id`, `istek_zamani`, `soru`, `yanitlayan_id`, `yanit_zamani`, `yanit`, `iptal_zamani`, `sonuc` (yanıtlandı / iptal / bekliyor), `bekleme_suresi` (interval) |

Etiket kolonları (`tur`, `durum`, `kanal`, `kaynak`…) Türkçe etikettir; kodu
isteyen için ayrıca `*_kod` kolonu bulunur.

**Salt okunur kullanıcı.** `deploy/windows/rapor-kullanicisi.ps1`:
`ichatlar_rapor` rolünü oluşturur ya da parolasını yeniler (rastgele parola),
`USAGE ON SCHEMA rapor`, `SELECT ON ALL TABLES IN SCHEMA rapor`, `ALTER DEFAULT
PRIVILEGES` (sonraki görünümler için), `ALTER ROLE … SET timezone =
'Europe/Istanbul'`, `CONNECT` veritabanına; `public` şemasında yetkisi yoktur.
Bağlantı bilgisini ekrana yazar. `kur.ps1` yeni kurulumda bu betiği çağırır;
mevcut sunucuda tek başına çalıştırılır.

## 9. Geçiş

Tek migration (`prisma migrate diff` ile üretilen SQL + elle eklenenler):
1. Yeni tablolar, FK'ler, index'ler, CHECK kısıtları, kısmi unique index.
2. `RecordEvent.meta` → `jsonb` (`USING meta::jsonb`), yeni kolonlar.
3. Backfill — `RecordEvent`:
   - `STATUS` olaylarında `meta->>'from'`/`'to'` → `fromStatus`/`toStatus`.
   - `FORWARD` olaylarında `meta->>'departmentId'` → `toTeamId`, `meta->>'assigneeId'` → `toUserId` (yalnızca var olan kimlikler).
   - `CREATE` olaylarında `toStatus='YENI'`. `toTeamId`: kaydın hiç `FORWARD`
     olayı yoksa kaydın ekibi; varsa boş (ilk ekip hiçbir yerde saklanmamış,
     bugünkü ekip yanlış olur).
4. Backfill — `InfoRequest`: şu an `EK_BILGI` durumundaki her kayıt için, en
   son `toStatus='EK_BILGI'` olayından açık bir istek (soru: olay notu, yoksa
   "Ek bilgi istendi."; `statusBefore`: olayın `fromStatus`'u, yoksa `CALISILIYOR`).
5. `rapor` şeması, `rapor.etiket` verisi, görünümler.

**Doğrulanacak:** Prisma `migrate diff` elle eklenen kısmi index'i ve CHECK
kısıtlarını sonraki migration'larda silmeye çalışmamalı. Silmeye çalışırsa kısmi
index kaldırılır, tek açık istek kuralı kayıt satırı kilidiyle (`mutate` zaten
`FOR UPDATE` alıyor) korunur ve bu belge güncellenir.

## 10. Testler

Birim (`tests/unit`):
- Oturum geçerliliği: sahibi, kayda bağlı mı, 30 dk / 24 saat sınırları.
- Kaynak Bul birleştirme kuralı (önek, 10 sn, tıklanmış sonuç).

Entegrasyon (`tests/integration`):
- `/api/similar`: oturum + sorgu + sonuçlar; ikinci çağrı aynı oturum; başkasının
  oturum kimliği yeni oturum açar; 30 dk sonrası yeni oturum; kısıtlı taslakta metin boş.
- Kaynak Bul: sorgu ve sonuç satırları; birleştirme; boş sorgu yazılmaz.
- `/api/help/results/:id`: open, helpful, unhelpful; başkasının sonucu 404.
- Kayıt açılışı: oturuma bağlanır; oturumsuz kayıtta sorgusuz oturum; anonimde
  kişi boş; kısıtlıda metinler boş; geçersiz oturum kimliği kaydı engellemez.
- `RecordEvent` kolonları: açılış, üstlenme, yönlendirme, durum değişikliği.
- Ek bilgi: istek (yetki, zorunlu soru, açık istek varken 409), "Durum güncelle"
  `EK_BILGI` reddi, açanın güncellemesi yanıt olur ve durum geri döner,
  `INFO_PROVIDED` bildirimi, çözüm/yönlendirme açık isteği iptal eder.
- Görünümler: `yardim_oturumu` türetilmiş kolonları; kısıtlı ve anonim kayıtta
  gizleme; `ek_bilgi` sonucu ve bekleme süresi.

## 11. Belgeler

- `docs/RAPOR.md`: bağlantı (rapor kullanıcısı), bütün görünümlerin kolon
  sözlüğü, tanımlar (oturum, kanal, önleme), örnek sorgular: takip penceresi
  parametreli kayıt önleme oranı (haftalık), kaç kişi kaç kez yararlandı, ek
  bilgi bekleme süreleri, durum geçiş süreleri.
- README: veri modeli, API ve ek bilgi bölümleri.
- KURULUM.md: rapor kullanıcısı adımı.

## 12. Plan yazılırken netleşenler (2026-10-11)

- **ML taraması da birleşir.** Yeni Kayıt'taki tarama yazarken her 0,9 sn
  duraklamada kendiliğinden çalışıyor. Aynı oturumda son sorgu ML_TARAMA ise,
  60 sn içindeyse ve sonuçlarına dokunulmamışsa yeni satır açılmaz, o sorgu
  güncellenir. Kaynak Bul kuralı aynı (10 sn + önek). Asistan soruları
  birleşmez.
- **Oturum bağlama kayıt işleminden sonra**, ayrı ve hata yutan bir adımda
  (ML sonucunun yazıldığı yer gibi). Aynı oturum kimliğiyle iki kayıt
  eşzamanlı gelirse ikincisi `recordId` tekilliğine takılıp kaydın kendisini
  geri almasın; ikinci kayıt kendi sorgusuz oturumuna bağlanır.
- **Cortex sonucunun bağlantısı boş olabilir**; CHECK kısıtı buna göre (§4).
- **Rapor kullanıcısı:** `kur.ps1` betiği PostgreSQL yönetici parolasını
  ikinci kez sormasın diye çağırmaz, kurulum sonunda hatırlatır;
  `rapor-kullanicisi.ps1` ayrı çalıştırılır (KURULUM.md).
- **`rapor.kayit`** zaman kolonları: `acilis`, `ilk_donus`, `cozulme`,
  `kapanis` (`cozum` adı çözüm metniyle karışıyordu).
- **`sonraki_*` kolonları** oturumun başlangıcından sonra aynı kişinin açtığı
  ilk kaydı verir, oturumun kendi kaydı hariç. **Anonim kayıtlar sayılmaz**:
  sayılsaydı zamanı `rapor.kayit` ile eşleştirilip açan kişi bulunurdu.
- Ek bilgi yanıtında kayıt `statusBefore`'a döner; o durum `EK_BILGI` ise ya
  da geçiş tablosu izin vermiyorsa (ör. `UZERIME_ALINDI`) bilgide
  `CALISILIYOR`, öneride `DEGERLENDIRILIYOR`.
- Yöneticinin devretme ekranı (Yetkiler) kaydı ekip havuzuna döndürürse
  (`YENI`) açık ek bilgi isteği iptal olur; başka kişiye devrederse istek
  açık kalır, yanıt yeni sahibe gider.
