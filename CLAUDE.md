# İç Hatlar — Claude için çalışma notları

Bu dosya, projeye başka bir bilgisayarda (canlı sunucu dahil) devam eden Claude
oturumları içindir. Ürünün kendisi için önce [README.md](README.md), kurulum için
[docs/KURULUM.md](docs/KURULUM.md), rapor verisi için [docs/RAPOR.md](docs/RAPOR.md).

## Kullanıcıyla çalışma

- **Her zaman Türkçe yanıt ver.** Arayüz metinleri ve kod yorumları da Türkçe;
  yorum yalnızca kodun gösteremediği nedeni tek satırda söyler.
- **Her değişiklik kendi commit'iyle**, Türkçe mesajla. **Push yalnızca kullanıcı
  isteyince.** Dışarıya dönük işlerden (push, PR, birleştirme, yayın) önce sor.
- Kullanıcı kısa ve doğrudan yazar ("bunu yap", "localhostta ayaklandır"). Belirsiz
  bir karar varsa tek soru sor, seçenekleri ve önerini ver; gerisini sen karar ver.
- Yerel denemeyi telefondan görmek isterse geçici bir trycloudflare tüneli aç
  (`cloudflared tunnel --url http://127.0.0.1:3000`). Bağlantıyı bilen herkes
  istediği kişi olarak girebilir; kullanıcı bunu kabul etti. Kurumsal alan adını
  (dogancikoyu.com vb.) kullanma.
- Demo, video ya da ekran görüntüsünde **gerçek çalışan verisi kullanma**; adlar uydurma.

## Ürün kararları (kullanıcının açık seçimleri)

- **Paket:** her kuruluşa ayrı kurulum; **yalnızca PostgreSQL** (ML verisi ayrı
  SQLite'ta). Kuruluşa özgü her değer `.env` ya da `config/kurulus.json`'da, kodda değil.
- **Canlı ortam:** Windows sunucu, aynı sunucuda PostgreSQL, IIS (URL Rewrite + ARR)
  arkasında NSSM hizmeti; giriş **Active Directory (LDAP)**, ekip ve rol AD
  gruplarından, her girişte yeniden. Kurulum kiti `deploy/windows`. Kurumsal alan
  adı ve HTTPS sonra gelecek (`kur.ps1 -AppUrl https://… -SertifikaParmakIzi …`).
- **Kuruluş:** departman → ekip (iki seviye). Kayıt ve kişi ekibe bağlanır.
  Aynı `directorate` değerini taşıyan departmanlar birbirinin kayıtlarını Tüm
  Kayıtlar'da okur (Spesifik, Temel, Tüketici Sağlığı → "Saha Grubu").
- **Görünürlük:** "Yalnızca ilgili ekip görsün" kayıtları sistem yöneticisi dahil
  ekip dışına hiçbir yoldan çıkmaz (öneri, arama, rapor, ML, günlük metni). Anonim
  kaydın açanı yalnızca açana ve sistem yöneticisine görünür. Departman/direktörlük
  genelinde görme yalnızca okumadır.
- **Kullanıcıya saat vaadi yok:** arayüzde hedef süre, kalan süre, "48 saat" gibi
  ifadeler gösterilmez; onaylı ifade "Ekip tarafından en kısa sürede tamamlanır."
  SLA yalnızca iç ölçüm (yönetici, rapor). Ek bilgi beklemesine hedef süre yok.
- **Kendiliğinden kapanma:** "Çözüldü" kaydı, açan 4 mesai saati (hafta içi
  08:00–17:00, resmi tatiller sayılır) yanıt vermezse kapanır (`AUTO_CLOSE_HOURS`,
  `WORK_HOURS`). Açanın güncellemesi süreyi yeniler; kural öncesi çözülmüşlere dokunulmaz.
- **Raporlar uygulamada değil:** kullanıcı raporu dışarıda hazırlar; veri
  `rapor` şemasındaki görünümlerden, salt okunur `ichatlar_rapor` kullanıcısıyla.
  Kayıt önleme günlüğü: yardım oturumu → sorgu → gösterilen sonuç; ML ile kontrol
  edip kayıt açmayan oturum "işe yaradı" sayılır. Metinler süresiz saklanır.
- **Yetkiler ekranı** (sistem yöneticisi): ekip yöneticisi, sistem yöneticisi,
  departman sorumlusu, rapor görüntüleyici, Bilgi Bankası düzenleyici; süreli
  yetki, devretme, geçmiş. Etkin rol = AD rolü ile verilen rolün yükseği.

## Arayüz

- Tek sayfa: `public/index.html` (ekranlar, CSS, temalar), `api-store.js` (veri ve
  aksiyonlar), `modules.js` (Kaynak Bul, Bilgi Bankası, Yetkiler, geri bildirim),
  `theme.js`. Beş tema korunmalı (Aydınlık, Koyu, Yumuşak koyu, Zümrüt, Santral).
- Kullanıcı "kurumsal SaaS şablonu" görünümünü reddediyor; yeni ekranlarda konuya
  özgü bir tasarım yönü seç (frontend-design becerisi), "uygulama" havası ver.
  Kenar çubuğu: dolu Yeni Kayıt düğmesi, gruplu menü, dipte Tema kartı + kişi kartı
  + "Uygulama için geri bildirim" yazı bağlantısı; telif satırı yok.
- Logo simetrik (altı simge 60° arayla); üç kopyası var: `public/index.html`,
  `src/routes/gate.ts`, `public/icon.svg` — değişirse üçü birlikte.
- Görsel değişikliği tarayıcıda beş temada ve telefon genişliğinde doğrula.

## Geliştirme

```bash
npm install
npm run db:local        # gömülü PostgreSQL, localhost:5433
npx prisma migrate deploy
npm run db:seed         # demo verisi (config/kurulus.example.json)
npm run dev             # ya da baslat.cmd
npm test                # birim + entegrasyon (ichatlar_test veritabanı)
```

- **Göç üretme:** `prisma migrate dev` etkileşimli olduğu için kullanılmaz.
  `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`
  çıktısını `prisma/migrations/<zaman>_<ad>/migration.sql`'e yaz, gözden geçir
  (kolon tipi değişikliği veriyi silmesin), `npx prisma migrate deploy` ile uygula,
  aynı diff'in boş çıktığını doğrula. CHECK kısıtları ve kısmi index elle yazılır.
- **Windows'ta `prisma generate` öncesi** çalışan sunucuyu durdur (motor dosyası kilitli: EPERM).
- Yeni iş kuralı → `tests/unit`; yetki, kapsam ya da sorguya dokunan değişiklik →
  `tests/integration`. Önce kırmızı test, sonra kod.
- PowerShell betikleri **UTF-8 BOM** ile kaydedilir (PowerShell 5.1 BOM'suz Türkçeyi bozar).
- Kabuktan Python/heredoc ile ters eğik çizgili metin yazarken kabuk `\r` gibi
  dizileri yiyebiliyor; böyle düzenlemeleri betik dosyasına yazıp çalıştır.
- Canlı paket: `powershell -ExecutionPolicy Bypass -File .\deploy\windows\paket-hazirla.ps1`
  → `release\ichatlar-<sürüm>-<commit>.zip`.

## Kurum ağı

- SSL denetimi var: npm `~/.npmrc` içinde kurum CA dosyası; Node için
  `NODE_OPTIONS=--use-system-ca`. Git Bash `curl` HTTPS'te sertifika hatası verir;
  dış adresleri tarayıcıdan doğrula.
- Cloudflare hızlı tüneli ofis Wi-Fi'ında açılmaz (kablolu ağ ya da VPN gerekir);
  VPN'de ilk denemeler ~45 sn düşebilir, sonra bağlanır.
- `gh` CLI kurulu değil; GitHub PR'ı tarayıcıdan açıldı.

## Durum (2026-10-12)

- Dal `departman-ekip`, PR: cepni61/ichatlar#1 (`main`'e, açık, çakışma yok, CI yok).
- Geri dönüş noktası: `denetim-oncesi` etiketi (2e98278).
- **Sıradaki iş: canlıya alma.** Sunucuda `kur.ps1` ilk kez çalışacak (hiç gerçek
  sunucuda denenmedi). Gerçek veri taşınacaksa `20261011100000_help_log` göçündeki
  geçmiş veri doldurmayı önce bir kopyada dene. Rapor aracı kullanılacaksa
  `deploy\windows\rapor-kullanicisi.ps1` ve KURULUM.md'deki ağ erişimi adımları.
- Konuşulan ama yapılmayan: ServiceNow benzeri akış tasarımcısı. Öneri: önce
  ihtiyaç duyulan akışları listele, "Kurallar" (ne zaman → koşul → ne yap) ekranıyla başla.
- Bekleyen küçük işler (denetimden ertelendi):
  - `helpSessionId` 64 karakteri aşınca istek 400 dönüyor (yalnızca elle kurcalanmış istek).
  - Tohum verisi kayıt adımlarının yeni kolonlarını doldurmuyor.
  - Bazı bağlantı kolonlarında index yok (HelpQuery.selectedTeamId, RecordEvent.toTeamId/toUserId,
    InfoRequest.requestedById/answeredById/answerEventId).
  - Aynı yardım oturumuna eşzamanlı yazmalar sıralanmıyor.
  - `rapor-kullanicisi.ps1`: tanımlayıcılar tırnaksız, `--single-transaction` yok.
  - `db:seed -- --reset` Bilgi Bankası maddelerini silmiyor; `ml:eval` eski departman kimlikleriyle karşılaştırıyor.
