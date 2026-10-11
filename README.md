# İç Hatlar

Kurum içi bilgi ve öneri kayıt sistemi. Çalışan bir bilgi talebi ya da öneri
açar, kayıt ilgili ekibe düşer, ekipten biri üstlenir ve sonuçlandırır. Yeni kayıt
açılırken benzer çözülmüş kayıtlar ve hangi ekibin işi olduğu (ML) önerilir.

Fastify + Prisma + PostgreSQL; arayüz tek sayfalık HTML (`public/`). Bir **paket**
olarak tasarlandı: her kuruluşa ayrı kurulur (kendi sunucusu, kendi
veritabanı). Kuruluşa özgü her şey `.env` ve `config/kurulus.json` içindedir,
kodda değil.

- **Canlı kurulum (Windows sunucu, IIS, Active Directory):** [docs/KURULUM.md](docs/KURULUM.md)
- **Giriş:** Active Directory (LDAP) ya da Microsoft Entra ID; geliştirmede kişi seçici.
- Tasarım referansı olan prototipler (`ichatlar4.html` vb.) üst klasörde; bu
  uygulama onlardan türedi ama artık onların kopyası değil.

## Test etmek isteyenler için (Windows, 3 adım)

1. **Node.js LTS** kurun: https://nodejs.org (Node ≥ 20.11).
2. Depoyu indirin ve **OneDrive dışında** kısa bir yola açın (ör. `C:\src\ichatlar`).
3. **`baslat.cmd` dosyasına çift tıklayın.** İlk açılış birkaç dakika sürer
   (bağımlılıklar, gömülü PostgreSQL, ~300 demo kayıt). Tarayıcı kendiliğinden açılır.

Giriş sayfası "Kim olarak gireceksiniz?" diye demo kişileri listeler (parola
yok). Başka rolle denemek için sol alttaki hesap kartındaki "Kişi değiştir" düğmesi
giriş sayfasına döner.
Her test edenin verisi kendi bilgisayarındadır (`%LOCALAPPDATA%\ichatlar`).

## Geliştirme

Gerekli: **yalnızca Node ≥ 20.11** (canlı sunucuda 22.15+, KURULUM.md). PostgreSQL 17 yerelde **gömülü** çalışır
(npm paketinden gelir; Docker ya da yönetici yetkisi gerekmez).

```bash
cp .env.example .env          # SESSION_SECRET doldurun; DEV_AUTH_BYPASS=true
npm install
npm run db:local              # yerel PostgreSQL (localhost:5433, arka planda açık kalır)
npm run db:migrate            # şema
npm run db:seed               # kuruluş yapısı, demo kişiler, ~300 demo kayıt (tekrar çalıştırılabilir)
npm run dev
```

| Komut | İş |
|---|---|
| `npm run db:local` / `db:local:stop` / `db:local:status` | Yerel PostgreSQL |
| `npm run setup -- config/kurulus.json` | Departman/ekip yapısını, AD gruplarını ve SLA sürelerini işler |
| `npm run db:seed -- --reset` | Demo verisini silip baştan kurar |
| `npm test` | Bütün testler (birim + entegrasyon) |
| `npm run build` → `npm start` | Derleyip üretim kipinde çalıştırır (`dist/`) |
| `deploy\windows\paket-hazirla.ps1` | Canlı sunucu için zip paketi (KURULUM.md §3) |

Yerel PostgreSQL programları ve verisi `%LOCALAPPDATA%\ichatlar` altında:
PostgreSQL'in Windows programları yolda Türkçe karakter olunca dosyalarını
bulamıyor ve eşitlenen klasörde çalışan veritabanı bozulabilir. Veritabanı tr-TR
ICU yerel ayarıyla kurulur: arama "İZİN" ile "izin"i eşleştirir. Yalnızca
PostgreSQL desteklenir; lehçeye özgü iki davranış `src/lib/dialect.ts` içinde.

Geliştirme girişi yalnızca `NODE_ENV≠production`, `DEV_AUTH_BYPASS=true` ve
LDAP/Entra ayarlanmamışken açıktır. Üretimde giriş yöntemi yoksa sunucu açılmaz.

## Mimari

```
tarayıcı
  public/index.html   ekranlar, CSS, temalar, asistan (tek dosya)
  public/api-store.js veri katmanı: sunucudan yükleme, yenileme, kayıt aksiyonları
  public/modules.js   API'ye bağlı ekranlar: Kaynak Bul, Bilgi Bankası, Yetkiler, geri bildirim
  public/theme.js     tema seçimi (kenar çubuğundaki Tema kartı)
        │  fetch, çerezli oturum (sunucuda tutulur)
        ▼
Fastify  src/routes/*   doğrulama (zod) + yetki + serileştirme
         src/domain/*   yetki kuralları, durum makinesi, kuruluş ağacı, yetkiler, SLA, benzerlik
         src/auth/*     LDAP (AD), Entra OIDC, dizin eşleme, oturum
         src/jobs/*     SLA gözcüsü, süreli yetki, temizlik (5 dk / günlük)
         src/ml/*       ekip önerisi modeli (ayrı SQLite veritabanı)
        │  Prisma
        ▼
PostgreSQL                      deploy/windows/  canlı kurulum betikleri
```

`src/app.ts → buildApp()` uygulamayı kurar (testler bunu `inject` ile kullanır);
`src/server.ts` yalnızca dinler ve zamanlanmış işleri başlatır.

## Kuruluş yapısı

İki seviye (`src/domain/org.ts`): **departman → ekip**. İkisi de `Department`
tablosunda; ekibin `parentId`'si departmanıdır. Kayıtlar ve kişiler **ekibe**
bağlanır; ekibi olmayan departman kendisi ekip gibi kullanılır. Yapı
`config/kurulus.json`'dan `setup` ile işlenir; şablon ve demo verisinin kaynağı
`config/kurulus.example.json` (13 departman, 51 ekip).
Ekibin `group` alanı, kişinin hangi AD grubundan o ekibe atanacağını söyler.

## Kim neyi görür

| Ekran | İçerik |
|---|---|
| Açtıklarım | Kişinin açtığı kayıtlar |
| Ekibime Gelenler | Kişinin ekibine (asıl ya da ikincil ekip) düşen kayıtlar — yalnızca ekip rolündekiler (USER değil) |
| Üzerimdekiler | Kişinin üstlendiği kayıtlar |
| Tüm Kayıtlar | Kişinin **departmanındaki** bütün ekiplerin kayıtları (+ departman sorumlusu olduğu departmanlar); sistem yöneticisi bütün departmanlar |

- **"Yalnızca ilgili ekip görsün" (kısıtlı) kayıt:** yalnızca açan kişi, ilgili
  ekip ve üstlenen görür; sistem yöneticisi ve departman sorumlusu dahil kimse
  görmez. Tüm Kayıtlar'da, benzer kayıt önerilerinde, aramada, rapor konularında
  ve ML eğitiminde yer almaz; başka ekibe yönlendirilemez (ekip içinde devir serbest).
  Taslak yazılırken yapılan ML taramaları da silinir.
- **Anonim kayıt:** açanın kimliği yalnızca açana ve sistem yöneticisine gider
  (`src/lib/serialize.ts`); olaylarda ve CSV'de de gizlenir, ML taramalarından kopar.
- Departman genelinde görme **yalnızca okumadır**: yorum, ek ve aksiyonlar
  ilgili ekipte, açanda ve üstlenende kalır.

## Roller ve yetkiler

Rol kurumsal dizinden gelir (`baseRole`): AD'de ekip grubundaki kişi **ekip üyesi**,
`LDAP_MANAGER_GROUP`'taki **ekip yöneticisi**, `LDAP_ADMIN_GROUP`'taki **sistem
yöneticisi**; hiçbir ekip grubunda olmayan **çalışan** (USER). AD girişinde her
seferinde yeniden hesaplanır.

Sistem yöneticisi **Yetkiler** ekranından ayrıca yetki verir (`Grant` tablosu,
`src/domain/grants.ts`, `src/routes/grants.ts`):

| Yetki | Ne sağlar |
|---|---|
| Ekip yöneticisi / Sistem yöneticisi | Etkin rolü yükseltir (ekip yöneticiliği için kişinin ekibi olmalı) |
| Departman sorumlusu | Bir departmanın bütün ekiplerini okur (kısıtlılar hariç), raporları görür, Bilgi Bankası'nı yönetir; işlem yapmaz |
| Rapor görüntüleyici | Raporlar ve CSV |
| Bilgi Bankası düzenleyici | Bir ekibin maddeleri |

- **Etkin rol** (`User.role`) = dizin rolü ile geçerli rol yetkilerinin yükseği;
  bütün yetki kodu bunu okur. AD girişi verilen yetkiyi silmez.
- **Süreli yetki (vekâlet):** bitiş günü sonunda düşer; 5 dakikalık iş satırı siler,
  rolü düzeltir. Rol dışı yetkiler oturumla her istekte okunur, hemen düşer.
- Aynı ekranda **ayrılan çalışanın açık kayıtları** devredilir (devralanın
  ekibinde olmayanlar ekibin havuzuna döner), kişi uygulamada kapatılabilir.
- Her değişiklik denetim izine yazılır (ekranda "Yetki geçmişi") ve kişiye bildirim gider.
- Kişi kendi yetkisini değiştiremez (sistem yöneticisiz kalınmasın).

Ekranlar: **Yönetim** ekip yöneticisi ve sistem yöneticisine, **Yetkiler**
yalnızca sistem yöneticisine, **Bilgi Bankası** yöneticilere ve yetki verilenlere görünür.

## Kayıt aksiyonları

Kural `src/domain/permissions.ts`'de; arayüz düğmeleri gizler ama karar her
istekte sunucuda yeniden verilir.

| Aksiyon | Kim |
|---|---|
| Üzerime al | Kayıt açıkken, ekipten biri (ekip rolü), sahip yoksa |
| Yönlendir (ekibe / ekip içinde kişiye) | Kayıt açıkken ekipten biri ya da sistem yöneticisi. Kişiye devir yalnızca kaydın ekibindeki ekip rolündekine |
| Durum güncelle / Çözüldü / Reddet / Değerlendir (öneri) | Kayıt açıkken **sahibi** (ya da sistem yöneticisi) |
| Benzer kayıtlarda öner ("Önerilerde", ML hafızası) | Çözülmüş bilgi kaydında sahibi ya da sistem yöneticisi; kısıtlı kayıtta yok |
| Kaydı kapat / Yeniden aç (gerekçe zorunlu) | Durum "Çözüldü" iken **açan kişi** |
| Yorum / ek | Açan, sahip, ilgili ekip, sistem yöneticisi |

Geçerli durum geçişleri ayrı bir tabloda; geçersiz geçiş 409 döner. Yeniden
açılan kaydın "Önerilerde" işareti düşer.

## Güvenlik kararları

- **Yetki ve kapsam sunucuda, sorguda:** görmemesi gereken kayıt sorgudan hiç
  dönmez (`src/routes/records.ts → scopeWhere`).
- **Eşzamanlılık:** aksiyonlar `SELECT … FOR UPDATE` kilidiyle; kayıt numarası işlem içinde artar.
- **Oturumlar sunucuda** (JWT değil): iptal edilebilir, rol her istekte okunur.
- **Çapraz site isteği:** yazma isteklerinde `Sec-Fetch-Site` (yoksa `Origin`)
  denetimi; kardeş alt alan adlarından gelen istek reddedilir.
- **Giriş:** IP başına dakikada 10 deneme. LDAP'ta boş parola sunucuya hiç
  gitmez (AD'de kimliksiz bağlanma başarılı döner); kullanıcı adı süzgece
  karışmasın diye karakterler sınırlı. Dönüş adresinde açık yönlendirme yok.
- **Vekil:** üretimde `X-Forwarded-For`'da yalnızca en yakın vekilin değerine
  güvenilir; hız sınırı anahtarında IIS'in eklediği port atılır.
- **CSV:** formül olarak çalışabilecek hücreler etkisiz; kısıtlı kaydın başlığı ve kişileri gizli.
- **Ekler:** sunucunun ürettiği rastgele adla saklanır, her zaman indirme olarak döner.

## Arayüz

- **Kenar çubuğu** uygulama düzeninde: üstte logo + kuruluş adı, dolu "Yeni
  Kayıt" düğmesi, gruplu menü (Kayıtlarım, Kurum); dipte alt alta Tema, Geri
  bildirim ve hesap kartları. Hesap kartında tek düğme var (canlıda "Çıkış yap",
  testte "Kişi değiştir").
- **Beş tema:** Aydınlık, Koyu, Yumuşak koyu, Zümrüt, Santral. Tema
  `html[data-theme]` bloklarıyla token'ları yeniden tanımlar; kenar çubuğu ve
  üst bant içerikten bağımsız `--chrome-*` / `--head-*` token'larıyla temalanır
  (koyu sol + açık orta düzenler için). Tercih `localStorage`'da (`ih_theme`);
  ilk boyamadan önce satır içi betikle uygulanır. Yeni tema: `theme.js`'teki
  `THEMES`'e bir satır + CSS'e bir blok.
- **Gezici asistan** (sağ alt köşe): açılışta doğrudan köşeye oturur; konumu
  CSS tutar, animasyon döngüsü durur. Sohbet, kayıt sorularını yerel veriden ve
  sunucudaki ML'den yanıtlar.
- Detay ekranı her açılışta sunucudan tazelenir; listeler dakikada bir yenilenir
  (liste yanıtı yalnızca son olayı taşır, tam geçmiş detayda).

## Veri modeli notları

- `Department.parentId`: departman/ekip ağacı. `entraGroupId`: ekibin dizin grubu
  (config'te `group`; AD'de grup adı ya da DN, Entra'da nesne kimliği).
- `User.baseRole` dizinden gelen rol, `User.role` etkin rol; `Grant` verilen yetkiler.
- `Record.restricted` (yalnızca ilgili ekip), `anonymous`, `department2Id` (ikincil ekip).
- `slaDueAt` kolonda tutulur; `slaBreachedAt` ihlalin ne zaman olduğunu saklar.
  SLA uyumu `src/domain/sla-compliance.ts`. Hedef süreler `SlaRule`'da, `kurulus.json`'dan gelir.
- `AuditLog`: kim, ne zaman, neyi değiştirdi. `Notification`: zil.
- `Suggestion` tablosu artık yazılmıyor (aynı veri ML veritabanında); şemada duruyor.

## ML: ekip önerisi

Yeni kayıtta "ML ile Kontrol Et" benzer çözülmüş kayıtları bulur ve kaydın hangi
**ekibin** işi olduğunu önerir (ilk 3 aday, gerekçe kelimeleri).

- **Yöntem:** Multinomial Naive Bayes (`src/ml/classifier.ts`): Türkçe harfler
  katlanır, kelimeler köklenir, başlık ağırlıklı, talep dilinin genel kalıpları elenir.
- **Eğitim:** açılışta ve `ML_RETRAIN_MINUTES` aralıkla, veri değişmediyse yapılmaz.
  Sınıflar ekiplerdir. `YENI`, `REDDEDILDI` ve kısıtlı kayıtlar girmez;
  yönlendirilen kaydın etiketi yönlendirildiği ekiptir. Değerlendirme olay
  döngüsünü bloklamaz (her 100 kayıtta sıra verir).
- **Ayrı ML veritabanı** (`prisma/ml/schema.prisma` → `var/ichatlar-ml.db`, SQLite):
  model sürümleri, kelime ağırlıkları, her tarama (`Inference`, ilk 3 ekip önerisi,
  gösterilen eşleşmeler) ve sonucu (`Outcome`: hangi ekibe açıldı, sonra
  yönlendirildi mi). Kayda dönüşmeyen taramalar 90 günde silinir. Erişilemezse
  uygulama çalışır, yalnızca kayıt tutulmaz.
- Benzer kayıt ve Kaynak Bul aday havuzu bellekte tutulur; sayı + son güncelleme ile tazelenir.

```bash
npm run ml:eval       # eğitimde hiç geçmeyen elle yazılmış taleplerle isabet
npm run ml:deploy     # ML tablolarını kur / güncelle
npm run ml:studio     # ML veritabanını incele (port 5556)
```

Demo verisinde eğitim isabeti yanıltıcı derecede yüksektir (kayıtlar
şablonlardan üretildi); gerçek ölçü `ml:eval` ve sahadaki `Outcome`'lardır.

## Bildirimler

Zil `Notification` tablosundan beslenir, dakikada bir tazelenir; pencere açılınca
okundu sayılır. Metne kayıt başlığı kopyalanmaz (KVKK); kişi kaydı artık
göremiyorsa yalnızca kodu görür.

| Olay | Kime |
|---|---|
| Hedef süre aşıldı (5 dk'lık gözcü) | Sahipsizse ekibin tamamı + yöneticiler, sahipliyse sahip + yöneticiler; ikincil ekip de. Başka ekibe yönlendirilen gecikmiş kayıtta yeni ekip de |
| Çözüldü / Reddedildi / Ek bilgi istendi / Öneri değerlendirildi | Kaydı açan |
| Yeniden açıldı | Sahip |
| Yeni güncelleme | Ekip yazdıysa açana, açan yazdıysa sahibe |
| Kişiye yönlendirildi / devredildi | Atanan kişi |
| Uygulama geri bildirimi | Sistem yöneticileri |
| Yetki verildi / alındı / süresi doldu | Yetkinin sahibi |

E-posta / Teams kanalı yok; eklenecekse kaynak `Notification` tablosu.

## Ek dosyalar

Yeni kayıtta (açıldıktan sonraki 30 dk içinde, açan kişi), güncellemede ve
çözümde dosya eklenir. Güncellemede seçilen dosya hemen yüklenir, **taslak**
bekler (yalnızca yükleyen görür), gönderilince olaya bağlanır; 24 saatte
gönderilmeyen taslak silinir. Türler: PDF, Office, görseller, TXT/CSV, MSG/EML,
ZIP (HTML/SVG/betik yok). Boyut `MAX_UPLOAD_MB` (10), istekte en fazla 5 dosya.
Saklama `STORAGE_DIR`. Virüs taraması yok.

## Testler

```bash
npm test                  # hepsi
npm run test:unit         # tests/unit — veritabanısız iş kuralları
npm run test:integration  # tests/integration — gerçek Fastify + PostgreSQL (ichatlar_test)
```

Entegrasyon testleri yerel PostgreSQL'deki ayrı `ichatlar_test` veritabanını
kullanır (adı `_test` ile bitmezse çalışmaz), her testten önce tabloları boşaltır.
İstekler port açmadan `app.inject()` ile atılır; oturum gerçek girişle aynı
imzalı çerezle üretilir (`tests/integration/helpers.ts → loginAs`). LDAP testleri
`ldapts` istemcisini sahte bir dizinle değiştirir; ML DB'ye yazan yollar sahte
istemciyle sınanır.

Yeni iş kuralı `src/domain/` içindeyse birim testi, yetki veya sorgu kapsamına
dokunuyorsa entegrasyon testi yazın.

## API

| Uç | İş |
|---|---|
| `GET /giris` · `POST /giris` | Giriş sayfası: AD kullanıcı adı/parola ya da (test) kişi seçici |
| `GET /auth/login` · `/auth/callback` · `POST /auth/logout` | Kimlik (Entra yönlendirmesi / çıkış) |
| `GET /auth/dev-login` · `/auth/dev-users` | Yalnızca geliştirme girişi açıkken |
| `GET /api/bootstrap` · `GET /api/me` | Açılış verisi (ben, birimler, kişiler, sabitler, Bilgi Bankası erişimi) |
| `GET /api/records` | Liste — `scope` (`visible`/`all`/`team`/`mine`/`opened`), `type`, `status`, `root` (departman), `dept` (ekip), `q`, `open`, sayfalama |
| `GET /api/records/:code` | Detay + akış + izinler |
| `POST /api/records` | Yeni kayıt (bilgi / öneri) |
| `POST /api/records/:code/{claim,forward,status,resolve,evaluate,learn,reject,reopen,close,comments}` | Aksiyonlar |
| `POST /api/records/:code/attachments` · `GET`/`DELETE /api/attachments/:id` | Ekler |
| `POST /api/similar` | Benzer çözülmüş kayıtlar + ekip önerisi |
| `GET /api/search/resources` | Kaynak Bul: Bilgi Bankası, çözülmüş kayıtlar, Cortex |
| `GET`/`POST /api/kb` · `PUT`/`DELETE /api/kb/:id` | Bilgi Bankası |
| `GET /api/reports/summary` · `GET /api/reports/export.csv` | Raporlar (yönetici, sistem yöneticisi, rapor görüntüleyici, departman sorumlusu) |
| `GET /api/ml/stats` · `POST /api/ml/train` | ML durumu (yönetici) / zorla eğit (sistem yöneticisi) |
| `GET /api/notifications` · `POST /api/notifications/read` | Zil |
| `POST /api/feedback` · `GET /api/feedback` · `POST /api/feedback/:id/read` | Uygulama geri bildirimi (okuma: sistem yöneticisi) |
| `GET`/`POST /api/admin/grants` · `DELETE /api/admin/grants/:id` · `GET /api/admin/grants/history` | Yetkiler (sistem yöneticisi) |
| `GET /api/admin/handover/:userId` · `POST /api/admin/handover` | Ayrılan çalışanın kayıtları (sistem yöneticisi) |
| `GET /health` | Sağlık kontrolü (veritabanına bağlanır) |

## Doğrulama durumu

**Otomatik testlerle sürekli doğrulanan:** yetki ve kapsam kuralları,
departman/ekip görünürlüğü, kısıtlı ve anonim kayıt gizliliği, durum
geçişleri, bildirimler, ekler, CSV, LDAP girişi (sahte dizinle), Entra kullanıcı
eşleme, yetkiler (beş tür, süre, devretme, geçmiş), ML taslak temizliği, köken
ve dönüş adresi denetimleri.

**Elle doğrulanan:** arayüz tarayıcıda beş temada ve telefon genişliğinde;
canlı paket bu bilgisayarda üretim ayarlarıyla açıldı (göçler, kurulum, giriş
sayfası, yedek ve güncelleme/geri alma betikleri).

**Doğrulanmayan:** gerçek Active Directory ile giriş, `kur.ps1`'in gerçek bir
Windows sunucusunda çalışması (yönetici hakkı, NSSM, IIS/ARR gerektirir), Entra
akışı, çok kullanıcılı eşzamanlı yük.

## Bilinen eksikler

| Konu | Durum |
|---|---|
| E-posta / Teams bildirimi | Yalnızca uygulama içi zil. |
| Departman/ekip ve SLA düzenleme ekranı | Yok; `config/kurulus.json` + `setup`. Kişinin ekibi AD grubundan. |
| KVKK | Anonimlik ve denetim izi var; aydınlatma ekranı, saklama süresi / imha işi yok. |
| `db:seed -- --reset` | Bilgi Bankası maddeleri varken kişileri silerken takılabilir (`kbArticle` silinmiyor). |
| `ml:eval` | Beklenen değerleri eski departman kimlikleriyle karşılaştırıyor; ekip yapısına göre güncellenmeli. |
