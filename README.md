# İç Hatlar

Kurum içi bilgi ve öneri kayıt sistemi. `ichatlar4.html` prototipinin arkasına
gerçek bir sistem konulmuş hâli: PostgreSQL, Fastify API, Microsoft Entra ID ile
kurumsal giriş.

Bir **paket** olarak tasarlandı: her kuruluşa ayrı kurulur (kendi sunucusu,
kendi PostgreSQL veritabanı, kendi Entra kaydı). Kuruluşa özgü her şey — ad,
departmanlar, SLA süreleri, Entra grupları — `.env` ve `config/kurulus.json`
içindedir, kodda değil. **Sunucu kurulumu: [docs/KURULUM.md](docs/KURULUM.md).**

## Test etmek isteyenler için (Windows, 3 adım)

1. **Node.js LTS** kurun: https://nodejs.org (Node ≥ 20.12).
2. Depoyu indirin — GitHub'da **Code → Download ZIP**, ya da `git clone`.
   Klasörü **OneDrive dışında** kısa bir yola açın (ör. `C:\src\ichatlar`).
3. **`baslat.cmd` dosyasına çift tıklayın.** İlk açılış birkaç dakika sürer
   (bağımlılıklar, gömülü PostgreSQL, 300 demo kayıt). Tarayıcı kendiliğinden açılır.

Farklı rollerle denemek için: `http://localhost:3000/auth/dev-users` listesindeki
e-postayla `http://localhost:3000/auth/dev-login?email=...` açın.

> Her test eden kişinin verisi **kendi bilgisayarındadır** (`%LOCALAPPDATA%\ichatlar`);
> başkasının açtığı kaydı görmez. Ortak test için uygulama tek bir makinede
> çalıştırılıp diğerleri ona bağlanmalıdır.
>
> Geliştirme girişinde parola yoktur — yalnızca demo verisiyle kullanın.

## Nasıl çalıştırılır (geliştirme)

Gerekli: **yalnızca Node ≥ 20.12.** Veritabanı PostgreSQL 17 — yerelde
**gömülü** çalışır: programlar npm paketinden gelir, kurulum, Docker ya da
yönetici yetkisi gerekmez.

```bash
cd ichatlar-app
cp .env.example .env          # SESSION_SECRET'i doldurun:  openssl rand -base64 48
npm install
npm run db:local              # yerel PostgreSQL'i başlatır (localhost:5433, arka planda açık kalır)
npm run db:migrate            # şemayı kurar
npm run db:seed               # departmanlar, SLA kuralları, demo kullanıcılar, 300 demo kayıt
npm run dev
```

| Komut | İş |
|---|---|
| `npm run db:local` / `db:local:stop` / `db:local:status` | Yerel PostgreSQL'i başlat / durdur / durumu |
| `npm run setup -- config/kurulus.json` | Kuruluşun departmanlarını ve SLA sürelerini işler |
| `npm run db:seed -- --reset` | Demo verisini silip baştan kurar (canlıda ve demo dışı kullanıcı varken çalışmaz) |
| `npm run build` → `npm start` | Derleyip sunucu kipinde çalıştırır (`dist/`) |

**Yerel PostgreSQL nerede:** programlar ve veri proje klasöründe değil,
`%LOCALAPPDATA%\ichatlar` altında (macOS/Linux: `~/.ichatlar`). İki neden:
PostgreSQL'in Windows programları yolda Türkçe karakter ("Masaüstü",
"Topluluğu") olunca kendi dosyalarını bulamıyor; ve çalışan bir veritabanının
OneDrive gibi eşitlenen bir klasörde durması veri bozabilir. Veritabanı tr-TR
ICU yerel ayarıyla kurulur — arama "İZİN" ile "izin"i eşleştirir.

Yalnızca PostgreSQL desteklenir. Lehçeye özgü iki davranış (harf duyarsız
arama, `SELECT … FOR UPDATE` satır kilidi) `src/lib/dialect.ts` içinde.

`http://localhost:3000` açılır. Entra ID henüz yapılandırılmadıysa geliştirme
girişi kullanılır:

```
http://localhost:3000/auth/dev-users                             # kullanıcı listesi
http://localhost:3000/auth/dev-login?email=omer.uygun@ornek.com  # giriş
```

Geliştirme girişi `NODE_ENV=production` olduğunda kodun kendisi tarafından
kapatılır; ayrıca üretimde Entra ayarları eksikse sunucu hiç başlamaz.

> **OneDrive uyarısı.** Bu klasör OneDrive içinde. `node_modules` senkronizasyonu
> hem yavaşlatır hem kilit hatası üretebilir. Depoyu OneDrive dışına almanız
> (ör. `C:\src\ichatlar`) önerilir.

## Mimari

```
tarayıcı
  public/index.html      ← ichatlar4.html'in kopyası, TEK satır eklendi
  public/api-store.js    ← veri katmanı köprüsü (aşağıda)
        │  fetch, çerez tabanlı oturum
        ▼
Fastify  src/routes/*    ← doğrulama (zod) + yetki + serileştirme
         src/domain/*    ← durum makinesi, SLA, yetki kuralları, eşleştirme
         src/auth/*      ← Entra OIDC + sunucu tarafı oturum
        │  Prisma
        ▼
PostgreSQL
```

### Arayüz nasıl bağlandı

Prototipin kodunda **tek satır** değişti: en sona bir `<script src="/api-store.js">`
etiketi eklendi. Geri kalan her şey `api-store.js` içinde devralınıyor. Bunu üç
şey mümkün kılıyor:

1. `const Store` yeniden atanamaz ama **özellikleri** değiştirilebilir.
2. `const DEPARTMENTS` / `USERS` dizileri **yerinde** doldurulabilir.
3. Klasik betikte `function foo(){}` tanımları `window` üzerindedir, üzerine
   yazılabilir.

Böylece `Store.load/create/find`, `actClaim/actForward/actStatus/actResolve/
actReject/actClose/actComment`, `createRecord`, `runMl` ve `exportCsv`
fonksiyonları API çağrılarıyla değiştirildi. Prototipin bütün render kodu,
CSS'i ve gezinme mantığı dokunulmadan çalışıyor.

`ichatlar4.html` **değiştirilmedi** — tasarım referansı olarak kalıyor.

## Temalar

Dort tema var. Secici kenar cubugundaki profil blogunda ve **katlanabilir**:
kapali dururken yalnizca mevcut temayi gosterir, tiklanınca listeyi acar.
Menu YUKARI acilir cunku profil blogu kenar cubugunun dibinde; asagi acilsa
gorunur alandan tasardi. Escape ile kapanir, disina tiklanınca kapanir,
ok tuslariyla dolasilabilir. Tercih `localStorage`'da (`ih_theme`) saklanir.

Secici ve kenar cubugundaki cikis butonu ICERIK degil CHROME token'larini
kullanir — yoksa zumrut ve soft dark'ta koyu kenar cubugunun uzerinde beyaz
kutular olarak duruyorlardi.

| Tema | Duzen |
|---|---|
| **Aydinlik** | Varsayilan. Her yer acik. |
| **Koyu** | Her yer koyu. |
| **Soft dark** | **Ust ve sol koyu, orta alan acik.** |
| **Zumrut** | `ichatlarzumrut.html` referansindan birebir: capraz zumrut→beyaz gradyan, yari saydam koyu kenar cubugu, beyaz ust bant. |

Tema `index.html` icindeki kucuk bir satir ici betikle **ilk boyamadan once**
uygulanir — sonradan uygulansa aydinlik tema bir kare gorunup goz alan bir
sicrama olurdu.

Tema eklemek icin `theme.js` icindeki `THEMES` dizisine bir satir ve CSS'e bir
`html[data-theme="..."]` blogu eklemek yeterli.

### Chrome token katmani

Zumrut ve soft dark "koyu sol + acik orta" duzeni kullaniyor. Bunun icin kenar
cubugu ve ust bant, icerik alanindan **bagimsiz** temalanabilmeli. O yuzden
ayri bir token ailesi var:

- `--chrome-*` — kenar cubugu (zemin, blur, metin, hover, aktif oge, rozet,
  profil karti, girdi, alt bilgi)
- `--head-*` — ust bant (baslik, alt metin, arama girdisi, ikon)
- `--page-layer` / `--page-glow` — `body::before` / `body::after` katmanlari
- `--main-layer` — `.main` ustundeki koyu bant (soft dark)

Varsayilanlar mevcut degerlere isaret ediyor (`--chrome-bg:var(--panel)` gibi),
bu yuzden **aydinlik ve koyu temalar bu katmandan hic etkilenmedi** — dolayli
referans sayesinde koyu tema chrome'u kendiliginden koyu oldu.

Soft dark'taki ust bant `.main` uzerinde bir gradyan. Sabit (`fixed`) degil,
icerikle birlikte kayar; yumusak gecisli oldugu icin ust bant yuksekligi
degistiginde (mobilde sarma) sert kenar olusmaz.

### Zumrut: referanstan birebir alinanlar

Renklerin otesinde su token'lar da referanstan geldi:

- Zumrut skalasi (`#032b21` … `#ecfdf5`), `--panel2:#f1f7f4`, rgba kenarliklar
- Uc duraklı gradyan `#047857 → #0d9488 → #10b981`
- **Yaricap skalasi 12/18/26** (varsayilan 10/14/20'den yumusak)
- Iki katmanli, zumrut tonlu golgeler
- **Display fontu Fraunces (serif)** — basliklar bu temada serif
- Harf araliklari (`--ls-tight:-.028em` vb.)
- Sayfa genisliginde 13 duraklı capraz gradyan + iki radyal isik huzmesi
- KPI kartlarinin ustundeki 2px gradyan cizgi, ust banttaki cam efektleri

### Tema eklerken cikan yapisal sorunlar

Prototipin token'lari iki yerde **tek token iki is** yapiyordu; koyu temada
ikisi ayni yone gitmedigi icin ayristirildi:

1. **Mavi skala (`--b-50` … `--b-900`).** `--b-700` metin rengi, `--b-50`/
   `--b-100` yumusak zemin. Koyu temada skala **ters cevrildi** — duz cevirme
   yapilsa metin okunmaz hale gelirdi.

2. **`--brand-blue-2`.** Hem `--primary2` zemini uzerindeki metin, hem
   `btn-primary:hover` zemini. Metin icin `--on-soft`, hover icin
   `--primary-hover` acildi.

Ayrica `--brand-blue` hem logo kimligi hem birincil aksiyon rengiydi.
Etkilesimli kullanimlar `--primary`'ye baglandi; KPI aksan halkalari logonun
bes rengi oldugu icin `--brand-*` uzerinde birakildi.

Sabit kodlanmis 14 yuzey rengi token'a baglandi; renkli zemin ustundeki beyaz
metinlere (buton, avatar, rozet) dokunulmadi.

Odak halkasi token'i bilincli olarak `--focus-ring`: gezici asistan
(`.agent.st-*`) kendi `--ring` degiskenini tanimliyor, ayni ad kullanilsa
asistanin icinde yanlis degere cozulurdu.

## Gezici asistan

Asistan rozeti ilk **10 saniye** sag bolgede dolasir, sonra sag alt koseye
gecip orada bekler (`Agent.DOCK_MS`). Surekli ekranda gezinmesi dikkat
dagitiyordu.

- Koseye gidis sabit hiz yerine yumusak lerp — kosede sert duracak gibi
  gorunmesin; yaklasik 2 saniye surer.
- Yerlestikten sonra pencere yeniden boyutlanirsa kosede kalir: hedef her
  karede `bounds()` ile yeniden hesaplanir.
- Yerlesikken yildiz tozu uretilmez. Sabit bir rozetten surekli toz dokulmesi
  anlamsiz olurdu.
- `prefers-reduced-motion: reduce` ise hic dolasmadan dogrudan koseye oturur.
- Sohbet acikken sayac beklemez, kapaninca kaldigi yerden devam eder. Sohbet
  kapaninca yerlesik asistan tekrar dolasmaya baslamaz.
- Kosede ipucu balonu ortalanirsa ekrandan ~46px tasiyordu (rozet merkezi
  `pencere-44`, balon ~180px). `.agent.docked` sinifi balonu ve okunu saga
  hizalar.

**Test notu:** headless tarayicida `requestAnimationFrame` ilerlemedigi icin
hareket ekran goruntusuyle dogrulanamadi — asistan her karede ilk yerlesme
noktasinda gorunuyor. Bunun yerine `Agent.tick()` elle sentetik zaman
damgalariyla suruldu: ilk 9 saniyede 299 farkli konum, `t=10.2s` ->
`docking=true`, `t=12s` -> `docked=true` ve hedef kosede (1218,360),
`t=14s` -> ayni yerde.

Bu testte ayrica bir bosluk ortaya cikti: `renderDashboard`, bootstrap
tamamlanmadan bos `DEPARTMENTS` dizisiyle calisip `perDept.sort()[0].d`
uzerinde patliyordu ("reading 'd'"). `USERS` icin yer tutucu koymustum,
`DEPARTMENTS` icin koymayi atlamisim; eklendi.

## Güvenlik kararları

**Yetki kararı asla arayüzde verilmez.** `api-store.js` düğmeleri gizler ama bu
yalnızca kolaylık; her aksiyon çağrısında sunucu `src/domain/permissions.ts`
içindeki aynı fonksiyonlarla yeniden karar verir. Betik kurcalansa bile veri
korunur.

**Anonim gönderim gerçekten anonim.** `createdById` denetim için saklanır ama
kaydı açan ve sistem yöneticisi dışında kimseye **gönderilmez** — gizleme
`src/lib/serialize.ts` içinde, sunucu tarafında yapılır. Akış olaylarındaki
kimlikler ve CSV çıktısı da aynı kuraldan geçer. Arayüzde gizlemek yetersizdi:
ağ sekmesini açan biri kimliği görebilirdi.

**Kapsam süzgeci veritabanı seviyesinde.** Kullanıcının görmemesi gereken kayıt
sorgudan hiç dönmez (`src/routes/records.ts` → `scopeWhere`).

**Eşzamanlılık.** İki kişi aynı anda "Üzerime Al" derse yalnızca biri kazanır:
mutasyonlar `SELECT … FOR UPDATE` ile satır kilidi altında yapılır. Kayıt
numarası da işlem içinde atomik olarak artırılır.

**Oturumlar sunucuda.** JWT değil, iptal edilebilir oturum kaydı — bir kişinin
erişimi anında kesilebilir.

## Durum makinesi

Prototipteki yetki koşulları birebir korundu (`src/domain/permissions.ts`):

| Aksiyon | Kim yapabilir |
|---|---|
| Üzerime al | Kayıt açıkken, ekipten biri, sahip yoksa |
| Yönlendir | Kayıt açıkken, ekipten biri |
| Durum güncelle / Çözüldü / Reddet | Kayıt açıkken, **yalnızca sahibi** |
| Kaydı kapat | Durum "Çözüldü" iken, **yalnızca açan kişi** |
| Yeniden aç ("Çözüm işe yaramadı") | Durum "Çözüldü" iken, **yalnızca açan kişi**, gerekçe zorunlu → Çalışılıyor |
| Yorum / dosya | Kaydı görebilen herkes |

Geçerli geçişler ayrı bir tabloda; yetkisi olan biri de geçersiz bir geçiş
yapamaz (409 döner).

## Entra ID kurulumu

BT'den istenecekler:

1. Entra portalında **App registration** (tek kiracı)
2. **Redirect URI (Web):** `${APP_URL}/auth/callback`
3. **Client secret**
4. Token yapılandırmasında opsiyonel claim: **groups**

Sonra `.env`: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`.

Departman eşlemesi: `ENTRA_USE_GROUPS=true` yapıp her departmanın
`entraGroupId` alanına Entra grup kimliğini yazın. Kapalıysa kullanıcı ilk
girişte **departmansız ve USER rolüyle** açılır, yönetici elle atar — yetkinin
sessizce genişlemesindense bu tercih edildi. Elle verilen rol/departman sonraki
girişlerde ezilmez.

## Veri modeli notları

- `slaDueAt` kolonda tutulur (her istekte hesaplanmaz) — "geciken kayıtlar"
  sorgusu indeksten döner ve SLA gözcüsü ihlalleri bulabilir.
- `slaBreachedAt` ihlalin **ne zaman** olduğunu saklar; bildirim ve gecikme
  raporu buna dayanır.
- `SlaRule` tablosu: SLA hedefleri yönetim ekranından değiştirilebilir, kodda
  sabit değil.
- `Suggestion`: kayıt açılırken gösterilen öneriler kaydedilir. Kullanıcı yine
  de kayıt açtıysa `accepted=false` — eşleştirmenin işe yarayıp yaramadığını
  ölçmenin tek yolu bu.
- `AuditLog`: kim, ne zaman, neyi değiştirdi (öncesi/sonrası).

## ML: ekip önerisi ve ML veritabanı

**İsabet nasıl okunmalı.** Eğitimde raporlanan birini-dışarıda-bırak isabeti demo
verisinde yanıltıcı derecede yüksektir (%97+): demo kayıtları konu şablonlarından
üretildiği için model test edilen kaydın benzerini zaten görmüştür. Gerçek ölçü
`npm run ml:eval`: şablonlardan bağımsız yazılmış 26 talepte (Set B) ilk öneri
%81, ilk 3 aday içinde %92 doğru (2026-10-06, 300 demo kayıt, 13 ünite). Demo
verisinde model yanlış önerilerde de yüksek güven gösterebilir; güven ayarı
gerçek kayıtlar biriktikçe düzelir. Yokluk eki (-sız/-siz) ayrı özellik olarak
tutulur: "reçetesiz" ile "reçete" karışmaz.

"ML ile Kontrol Et" artık iki iş yapar: benzer çözülmüş kayıtları bulur
(eski davranış) **ve kaydın hangi ekiple ilgili olduğunu önerir** — ekip
seçilmeden de. Arayüzde öneri, gerekçe kelimeleri ve ilk 3 aday görünür;
"Bu ekibi seç" formu doldurur.

**Yöntem:** Multinomial Naive Bayes (`src/ml/classifier.ts`). Türkçe harfler
katlanır, kelimeler ilk 5 harfe köklenir ("bordro/bordrom/bordroya" aynı),
başlık 3 kat ağırlıklıdır, talep dilinin genel kalıpları ("talebi",
"görünüyor", "gerekiyor") elenir. Ekip dağılımı dengesiz olduğu için ön
olasılık kullanılmaz; kullanılsaydı azınlık ekiplerin kayıtları İK'ya
öneriliyordu. Parametreler iki veri setinde birini-dışarıda-bırak ile
tarandı (bkz. dosyadaki açıklama).

**Eğitim:** açılışta, sonra `ML_RETRAIN_MINUTES` aralıkla — veri
değişmediyse eğitim yapılmaz, etkin sürüm ML veritabanından yüklenir.
Yalnızca etiketi güvenilir kayıtlar girer: `YENI` (ekip henüz görmedi) ve
`REDDEDILDI` (sebep belirsiz) hariç. Yönlendirilen kaydın etiketi
yönlendirildiği ekiptir.

**Ayrı ML veritabanı** (`prisma/ml/schema.prisma` → `var/ichatlar-ml.db`).
Ana veritabanına yabancı anahtar yoktur; erişilemezse uygulama çalışır,
öneri bellekteki modelle sürer, yalnızca kayıt tutulmaz.

| Tablo | Ne tutar |
|---|---|
| `ModelVersion` | Eğitilmiş sürümler, LOO isabeti, parametreler, veri parmak izi (son 10 saklanır) |
| `DepartmentPrior` | Sürüm başına ekip istatistiği |
| `TermWeight` | Modelin öğrendiği: kök × ekip ağırlığı |
| `TrainingSample` | Sürümün hangi kayıtlardan öğrendiği + LOO tahmini |
| `Inference` | Her "ML ile Kontrol Et" çağrısı: metin, tahmin, güven, süre |
| `DepartmentPrediction` | O çağrıdaki her ekip önerisi (ayrı satır, sıralı) |
| `SimilarityMatch` | O çağrıda gösterilen benzer kayıtlar |
| `Outcome` | Kayıt açıldı mı, hangi ekibe, öneri uygulandı mı, **sonra yönlendirildi mi** |

Sahadaki gerçek isabet `Outcome`'dan ölçülür: doğru ekip = yönlendirildiyse
yönlendirilen, değilse seçilen. Anonim açılan kayıtta çalıştırmadaki
kullanıcı kimliği silinir — ML veritabanı başka ekiplerce okunabilir.

```bash
npm run ml:eval       # gerçek isabet: eğitimde hiç geçmeyen elle yazılmış taleplerle
npm run ml:deploy     # ML tablolarını kur / güncelle
npm run ml:studio     # ML veritabanını tarayıcıda incele (port 5556)
npm run ml:reset      # ML veritabanını sıfırla (ana veriye dokunmaz)
```

ML veritabanı ana veritabanından ayrı bir SQLite dosyasıdır (`var/ichatlar-ml.db`);
sunucuda `var/` klasörü yedeğe dahil edilmelidir.

## Bildirimler

SLA gözcüsü (5 dakikada bir) hedefi aşan açık kaydı işaretlerken aynı
işlemde `Notification` tablosuna kişi başına bir satır yazar. Zil bu
tablodan beslenir, dakikada bir tazelenir; pencere açılınca bildirimler
okundu sayılır.

| Kayıt durumu | Kim bildirim alır |
|---|---|
| Kimsenin üzerinde değil | Ekibin tüm etkin üyeleri + ekip yöneticileri |
| Birinin üzerinde | Sahibi + ekip yöneticileri |

Pasif kullanıcılar ve kaydı açan kişi SLA bildirimi almaz.

Kayıt olaylarında karşı taraf da bildirilir (aynı işlemde yazılır; işlemi
yapan kişi kendine bildirim almaz):

| Olay | Kime |
|---|---|
| Çözüldü / Reddedildi / Ek bilgi istendi | Kaydı açan |
| Yeniden açıldı | Kaydın sahibi |
| Yeni güncelleme (yorum) | Ekip yazdıysa açana, açan yazdıysa sahibe |
| Kişiye yönlendirildi | Atanan kişi |

Aynı kayıtta aynı türde yeni olay olursa eski bildirim güncellenip yeniden
okunmamış yapılır; zil şişmez. Aynı kişiye aynı kayıt
için ikinci bildirim yazılmaz. Metne kayıt başlığı kopyalanmaz (KVKK: imhada
unutulan bir kopyası kalmasın); başlık kayıttan okunur. Kayıt sonradan
başka ekibe yönlendirildiyse eski alıcı yalnızca kayıt kodunu görür.

## Ek dosyalar

Güncelleme ve çözüm yazılırken dosya eklenebilir. Dosya seçilince hemen
yüklenir ve **taslak** olarak bekler (yalnızca yükleyen görür); güncelleme ya
da çözüm gönderilince o olaya bağlanır ve zaman çizelgesinde onun altında
görünür. 24 saat içinde gönderilmeyen taslaklar silinir.

| Kural | Değer |
|---|---|
| Kim yükler / indirir | Kaydı görebilen herkes; taslağı yalnızca yükleyen |
| Türler | PDF, Word/Excel/PowerPoint, PNG/JPG/GIF/WEBP, TXT/CSV, MSG/EML, ZIP — HTML/SVG/betik/çalıştırılabilir yok |
| Boyut | Dosya başına `MAX_UPLOAD_MB` (10), istekte en fazla 5 dosya |
| Saklama | `STORAGE_DIR` (varsayılan `var/uploads`), sunucunun ürettiği rastgele adla; kullanıcının dosya adı diske yazılmaz |
| İndirme | Her zaman `attachment` (tarayıcıda açılmaz), `nosniff`, tür uzantıdan; görme yetkisi yoksa 404 |

Virüs taraması yok; kurumda bir tarayıcı varsa `STORAGE_DIR` ona açılmalı.
Kayıt silinirse ek satırları da silinir, diskteki dosya imha işinde temizlenmeli
(KVKK prosedürü).

## Testler

```bash
npm test                  # hepsi
npm run test:unit         # tests/unit — veritabanısız iş kuralları
npm run test:integration  # tests/integration — gerçek Fastify + PostgreSQL (ichatlar_test)
npm run test:watch        # değişiklikte yeniden çalıştır
```

Entegrasyon testleri yerel PostgreSQL'deki ayrı `ichatlar_test` veritabanını
kullanır (kapalıysa açılır; göçler uygulanır, tohum yüklenmez) ve her testten
önce tabloları boşaltır. Bu yüzden veritabanı adı `_test` ile bitmiyorsa testler
çalışmayı reddeder — yanlış ayarla asıl veri silinemez. Başka bir sunucu için
`TEST_DATABASE_URL` verin. Testler
istekleri port açmadan `app.inject()` ile atar — bunun için uygulama kurulumu
`src/app.ts` → `buildApp()` içindedir, `server.ts` yalnızca dinlemeyi ve
zamanlanmış işleri başlatır. Oturum, gerçek girişle aynı imzalı çerezle
üretilir (`tests/integration/helpers.ts` → `loginAs`).

Yeni bir iş kuralı eklerken: kural `src/domain/` içindeyse birim testi,
yetki veya sorgu kapsamına dokunuyorsa entegrasyon testi yazın.

## API

| Uç | İş |
|---|---|
| `GET /api/bootstrap` | Arayüzün açılış verisi (ben, departmanlar, kullanıcılar, sabitler) |
| `GET /api/records` | Liste — `scope`, `type`, `status`, `dept`, `q`, `open`, sayfalama |
| `GET /api/records/:code` | Detay + akış + izinler |
| `POST /api/records` | Yeni kayıt |
| `POST /api/records/:code/{claim,forward,status,resolve,reject,close,comments}` | Aksiyonlar |
| `POST /api/similar` | Benzer çözülmüş kayıtlar + ML ekip önerisi + `inferenceId` |
| `GET /api/ml/stats` | ML modeli ve sahadaki isabet (MANAGER/ADMIN) |
| `POST /api/ml/train` | Modeli zorla yeniden eğit (ADMIN) |
| `GET /api/reports/summary` | Toplu ölçümler (MANAGER/ADMIN) |
| `GET /api/reports/export.csv` | CSV (MANAGER/ADMIN, denetim izine yazar) |
| `GET /auth/login` · `/auth/callback` · `POST /auth/logout` | Kimlik |
| `GET /api/notifications` | Kişinin son 30 bildirimi + okunmamış sayısı |
| `POST /api/notifications/read` | Okundu işareti (`ids` boşsa hepsi) — yalnızca kişinin kendi bildirimleri |
| `GET /health` | Sağlık kontrolü |

## Doğrulanan davranışlar

Aşağıdakiler ilk sürümde çalışan sistem üzerinde elle denendi (SQLite, 51 kayıt).
Bugün bunların çoğu otomatik testlerle PostgreSQL üzerinde sürekli doğrulanıyor
(`npm test`).

| Test | Sonuç |
|---|---|
| Göç + tohumlama | 50 kayıt, 6 departman, 13 kullanıcı |
| Kapsam süzgeci | Ömer'e 51 kaydın 24'ü görünüyor (hepsi değil) |
| Anonim gizleme | 3 anonim kayıt görünür, **0 kimlik sızıntısı** |
| Yetki reddi | Kalite üyesi İK kaydını devralmaya çalıştı → **403** |
| Yetkili devralma | `yeni → uzerime_alindi`, sahip atandı, izinler döndü |
| Tam döngü | devral → çalışılıyor → çözüldü → (sahip kapatamaz, **403**) → açan kapattı |
| Rapor yetkisi | Ekip üyesi **403**, yönetici 200 |
| CSV | 52 satır, 6 anonim satırda ad yerine "Anonim" |
| Benzer kayıt | "Yillik izin bakiyem eksik" → %47 doğru eşleşme |
| SLA gözcüsü | Açılışta 5 geciken kayıt bulup işaretledi |
| Arayüz | Gerçek API verisiyle yükleniyor, API'den açılan kayıt tabloda göründü |

Yol boyunca çıkan ve düzeltilen hatalar: `.env` yükleyicisi bağlanmamıştı, SLA
işi bağlantı kontrolünden önce başlıyordu, benzer kayıt eşleştirmesi Türkçe
karakter kullanılmadan yazılan metni yakalamıyordu (%22 → %47), ve prototipin
`init()` fonksiyonu bootstrap'tan önce çalışıp hata bandı açıyordu.

**Doğrulanmayan:** Entra ID akışı (uygulama kaydı yok — geliştirme girişiyle
test edildi), BT'nin PostgreSQL sunucusunda çalışma, çok kullanıcılı eşzamanlı yük.

## Henüz yapılmayanlar

| Konu | Durum |
|---|---|
| Yeni kayıtta dosya eki | Ekler güncelleme ve çözümle birlikte eklenebiliyor; yeni kayıt formunda henüz yok (kayıt açılmadan yükleme yeri yok). |
| E-posta / Teams bildirimi | Uygulama içi bildirim (zil) çalışıyor. E-posta veya Teams eklenecekse kaynak `Notification` tablosu; kanal BT kararı. |
| Yönetim ekranı yazma uçları | Departman/SLA/rol düzenleme API'si yok. Departman ve SLA şimdilik `config/kurulus.json` + `setup` ile, rol Entra yönetici grubuyla. |
| KVKK | Anonimlik ve denetim izi hazır. Prosedür taslağı yazıldı; saklama/imha işi, aydınlatma ekranı ve log maskeleme kodda yok. |
