# İç Hatlar — Windows sunucuya kurulum (BT için)

İç Hatlar her kuruluşa **ayrı kurulur**: kendi sunucusu, kendi PostgreSQL
veritabanı. Kuruluşlar arasında veri paylaşılmaz. Bu belge bir Windows
sunucusunu sıfırdan canlıya almayı anlatır; adımların çoğunu
`deploy\windows\` altındaki betikler yapar.

```
kullanıcı ──HTTP(S) 80/443──▶ IIS (URL Rewrite + ARR) ──▶ Node.js 127.0.0.1:3000 ──▶ PostgreSQL localhost:5432
                                                              │
                                                              └──LDAPS 636──▶ Etki alanı denetleyicisi (Active Directory)
```

Kullanıcılar Windows kullanıcı adı ve parolasıyla girer. Kişinin ekibi ve
rolü AD gruplarından gelir, her girişte yeniden okunur.

## 1. Gereksinimler

| Bileşen | Sürüm / not |
|---|---|
| Sunucu | Windows Server 2019 veya üstü; 2 çekirdek, 4 GB bellek ile başlayıp izleyin (yük testi yapılmadı) |
| Node.js | **22 LTS, en az 22.15** (MSI ile). Daha eskisi ldaps için Windows sertifika deposunu kullanamaz |
| PostgreSQL | 15 veya üstü (EDB Windows kurulumu; ICU içerir) — aynı sunucuya |
| NSSM | 2.24 — Node'u Windows hizmeti olarak çalıştırır. BT'nin onayladığı kopya, ör. `C:\Araclar\nssm.exe` |
| IIS | Web-Server rolü + **URL Rewrite 2.1** + **Application Request Routing 3.0** |
| Ağ | Kullanıcılardan sunucuya 80/443 · sunucudan etki alanı denetleyicisine 636 · PostgreSQL yalnızca localhost |

Sunucuda internet ya da npm gerekmez: paket bütün bağımlılıklarla gelir.

IIS kurulumu (yönetici PowerShell):

```powershell
Install-WindowsFeature Web-Server -IncludeManagementTools
```

URL Rewrite ve ARR'ı Microsoft'un sayfasından kurun:
<https://www.iis.net/downloads/microsoft/url-rewrite> ·
<https://www.iis.net/downloads/microsoft/application-request-routing>

PostgreSQL kurulurken verilen `postgres` parolası kurulumda bir kez sorulur.
Uygulama aynı sunucuda olduğu için PostgreSQL'i dışarıya kapatın:
`postgresql.conf` içinde `listen_addresses = 'localhost'`, sonra hizmeti
yeniden başlatın. (Rapor aracına ağdan erişim gerekirse yalnızca rapor
kullanıcısı için açılır: §7, Rapor kullanıcısı.)

## 2. BT'den istenecekler (Active Directory)

| Ne | Örnek | Neden |
|---|---|---|
| LDAPS adresi | `ldaps://dc01.eczacibasi.local:636` | Parolalar denetleyiciye şifreli gider. Denetleyicinin sertifikası kurumun sertifika otoritesinden imzalı ve bu sunucuda güvenilir olmalı |
| Etki alanının kısa adı | `ECZACIBASI` | Kullanıcı `ECZACIBASI\ad` olarak doğrulanır |
| Arama kökü | `DC=eczacibasi,DC=local` | Kişinin e-postası, adı ve grupları buradan okunur |
| Her ekip için bir AD grubu | `IcHatlar-BT-Destek` | Gruptaki kişi o ekibe atanır (51 ekip) |
| Sistem yöneticisi grubu | `IcHatlar-Sistem` | Yönetim ekranı, bütün departmanlar |
| Ekip yöneticisi grubu | `IcHatlar-Yoneticiler` | Bu gruptaki kişi, üyesi olduğu ekibin yöneticisi olur (raporlar, Bilgi Bankası) |
| DNS kaydı | `ichatlar.eczacibasi.local` → sunucu | Kullanıcıların açacağı adres |

AD gruplarına ek olarak sistem yöneticisi, uygulamadaki **Yetkiler** ekranından yetki
verir:

| Yetki | Ne sağlar |
|---|---|
| Ekip yöneticisi | Kişinin kendi ekibinde yönetici (raporlar, Bilgi Bankası, gecikme bildirimleri) |
| Sistem yöneticisi | Bütün departmanlar, Yönetim ve Yetkiler ekranları |
| Departman sorumlusu | Seçilen departmanın bütün ekiplerini okur, raporları görür, maddelerini yönetir; işlem yapmaz |
| Rapor görüntüleyici | Raporlar ve CSV |
| Bilgi Bankası düzenleyici | Seçilen ekibin maddeleri |

Verilen yetki AD'deki rolün üstüne eklenir, AD girişinde silinmez; geri alınınca kişi
AD'deki rolüne döner. Bitiş tarihi verilebilir (vekâlet): yetki o günün sonunda kendiliğinden
düşer. Aynı ekranda ayrılan çalışanın açık kayıtları devredilir ve kişi uygulamada
kapatılabilir. Her değişiklik denetim izine yazılır, ekranda "Yetki geçmişi" olarak
görünür ve kişiye bildirim gider. İlk sistem yöneticisi yine AD grubundan
(`LDAP_ADMIN_GROUP`) gelmelidir. "Yalnızca ilgili ekip görsün" işaretli kayıtlar hiçbir
yetkiyle ekip dışına açılmaz.

Hizmet hesabı **gerekmez**: kişi kendi hesabıyla bağlanır ve yalnızca kendi
kaydını okur. Grup üyeliği **doğrudan** olmalı (iç içe grup sayılmaz).
Her kişi tek bir ekip grubunda olmalı; birden çoğundaysa ilk eşleşen
ekip alınır.

## 3. Paketi hazırlamak (geliştirme bilgisayarında)

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\paket-hazirla.ps1
```

Kodu derler, yalnızca çalışma bağımlılıklarını toplar ve
`release\ichatlar-<sürüm>-<commit>.zip` üretir (~130 MB).

## 4. Kurulum (sunucuda)

1. Zip'i sunucuya kopyalayın, Windows'un "internetten geldi" işaretini
   kaldırıp kurulum klasörüne açın. Klasör OneDrive gibi eşitlenen bir yerde
   olmamalı:

   ```powershell
   Unblock-File .\ichatlar-0.1.0-abc1234.zip
   Expand-Archive .\ichatlar-0.1.0-abc1234.zip C:\IcHatlar
   ```

2. Ekiplerin AD gruplarını yazın. `C:\IcHatlar\config\kurulus.json` yoksa
   `kurulus.example.json`'u bu adla kopyalayın; her ekibe `"group"` ekleyin
   (grubun adı ya da tam DN'i):

   ```json
   { "id": "bt-bilgi-teknolojileri", "name": "Bilgi Teknolojileri", "short": "BT", "group": "IcHatlar-BT", "main": true }
   ```

3. Yönetici PowerShell'inde kurulum betiği:

   ```powershell
   cd C:\IcHatlar
   powershell -ExecutionPolicy Bypass -File .\deploy\windows\kur.ps1 -AppUrl http://ichatlar.eczacibasi.local -Nssm C:\Araclar\nssm.exe
   ```

   İlk çalıştırmada kuruluş adını, §2'deki AD bilgilerini ve `postgres`
   parolasını sorar. Sonra sırayla:

   - `.env` yazar; veritabanı parolası ve oturum anahtarı rastgele üretilir.
   - PostgreSQL'de `ichatlar_app` rolünü ve tr-TR ICU veritabanını oluşturur.
     Türkçe harf denetimini yapar ("İZİN" = "izin").
   - Şema göçlerini uygular, departman/ekip yapısını ve grupları işler.
   - `IcHatlar` Windows hizmetini kurar: sanal hizmet hesabıyla, gecikmeli
     otomatik başlar, çökerse 5 sn sonra yeniden başlar.
   - Dosya izinlerini daraltır: hizmet kodu okur, yalnızca `var\` ve `logs\`'a
     yazar; `.env`'yi yalnızca yöneticiler okur.
   - IIS'te `IcHatlar` sitesini ve ters vekili kurar. İstemci IP'si
     X-Forwarded-For'da portsuz taşınır; hız sınırı IP başına işler.
   - Hizmeti başlatır, `/health` yanıtını bekler.
   - Gece yedeği görevini kurar ve bir yedeği hemen dener.

   Betik tekrar çalıştırılabilir: var olan `.env`, veritabanı ve hizmet
   korunur, eksik olan tamamlanır.

4. Bir kişiyle giriş yapın. Ekibinin ve rolünün doğru geldiğini Yönetim
   ekranından kontrol edin.

> **`npm run db:seed` canlıda çalıştırılmaz** (pakette yok). Kullanıcılar
> ilk girişte AD'den oluşur.

IIS'i henüz kuramadıysanız geçici iç ağ denemesi için `-IisYok` verin. Node
doğrudan `:3000` portunda dinler, güvenlik duvarında Domain profili açılır.
HTTPS olmaz. Kalıcı kurulumda IIS'le yeniden çalıştırın ve `.env`'de
`HOST=127.0.0.1` yapın.

## 5. Ayarlar (.env)

`kur.ps1` yazar; açıklamalar `.env.example` içinde. Değiştirince hizmeti
yeniden başlatın (`Restart-Service IcHatlar`).

| Değişken | Değer |
|---|---|
| `NODE_ENV` | `production` — giriş yöntemi (LDAP ya da Entra) yoksa sunucu açılmaz; test girişi kapalıdır |
| `HOST` / `PORT` | `127.0.0.1` / `3000` — uygulama yalnızca IIS'e açık |
| `APP_URL` | Kullanıcıların tarayıcıda gördüğü adres. `https://` ile başlarsa çerezler yalnızca HTTPS'te gider |
| `DATABASE_URL` | `postgresql://ichatlar_app:<parola>@localhost:5432/ichatlar?schema=public` |
| `SESSION_SECRET` | Rastgele; değişirse herkesin oturumu düşer |
| `LDAP_URL` | `ldaps://…:636`. `ldap://` parolayı şifresiz yollar; açılışta uyarı verir |
| `LDAP_DOMAIN`, `LDAP_BASE_DN` | §2 |
| `LDAP_ADMIN_GROUP`, `LDAP_MANAGER_GROUP` | Sistem yöneticisi ve ekip yöneticisi grupları (ad ya da DN) |
| `ACCESS_CODE` | **Boş** (yalnızca internete açık geçici test yayını içindir) |
| `STORAGE_DIR` | Ekler; varsayılan `C:\IcHatlar\var\uploads` |
| `CORTEX_URL`, `CORTEX_TOKEN` | Kurumsal arama kaynağı; boşsa Kaynak Bul yalnızca Bilgi Bankası ve çözülmüş kayıtlarla çalışır |

Node, ldaps sertifikasını Windows sertifika deposundan doğrular (hizmet
`node --use-system-ca` ile başlar). Kurumun kök sertifikası sunucuda
"Güvenilen Kök Sertifika Yetkilileri"nde olmalı.

## 6. Kurumsal alan adı ve HTTPS

Alan adı ve sertifika geldiğinde:

1. Sertifikayı (özel anahtarıyla) sunucunun **Yerel Bilgisayar → Kişisel**
   deposuna alın, parmak izini kopyalayın.
2. DNS kaydını sunucuya yönlendirin.
3. Kurulum betiğini yeni adresle çalıştırın:

   ```powershell
   .\deploy\windows\kur.ps1 -AppUrl https://ichatlar.eczacibasi.com.tr -SertifikaParmakIzi 0123ABCD... -Nssm C:\Araclar\nssm.exe
   ```

   `.env`'deki `APP_URL` güncellenir. IIS'e 443 bağlantısı ve HTTP→HTTPS
   yönlendirmesi eklenir, hizmet yeniden başlar.

**HTTPS olmadan Windows parolaları ağda şifresiz gider.** HTTP ile başlamak
ancak kısa bir iç ağ denemesi için kabul edilebilir. Uygulama internete
açılacaksa HTTPS zorunludur.

## 7. Günlük işler

| İş | Nasıl |
|---|---|
| Durum / yeniden başlatma | `Get-Service IcHatlar` · `Restart-Service IcHatlar` |
| Sağlık | `http://127.0.0.1:3000/health` → 200 (veritabanına da bağlanır) |
| Günlük | `C:\IcHatlar\logs\ichatlar.log`: JSON satırlar, her gün ya da 20 MB'ta döner. İstemci IP'si ve kullanıcı kimliği içerir; 30 günden eskileri gece yedeği siler (KVKK) |
| Denetim izi | Veritabanında (`AuditLog` tablosu) |
| Yedek | Her gece 02:00, `C:\IcHatlarYedek\<tarih>\`: `ichatlar.dump` (veritabanı), `var.zip` (ekler + ML), `env.txt`, `kurulus.json`. 30 gün tutulur |

**Yedek klasörünü başka bir diske ya da BT'nin yedeklediği bir paylaşıma
taşıyın.** Sunucu diski giderse aynı diskteki yedek de gider:
`kur.ps1 -YedekDizini E:\IcHatlarYedek`. Yedek kişisel veri ve parola
taşır; klasörü yalnızca yöneticiler ve SYSTEM okur. Elle yedek:
`.\deploy\windows\yedekle.ps1`.

**Geri yükleme** (en az bir kez deneyin):

```powershell
Stop-Service IcHatlar
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" --clean --if-exists --no-owner --role=ichatlar_app -h localhost -U postgres -d ichatlar C:\IcHatlarYedek\<tarih>\ichatlar.dump
Remove-Item C:\IcHatlar\var -Recurse; Expand-Archive C:\IcHatlarYedek\<tarih>\var.zip C:\IcHatlar\var
Start-Service IcHatlar
```

Veritabanı ve `var` aynı yedekten alınmalı; biri olmadan diğeri eksik geri
yüklenir.

### Rapor kullanıcısı (isteğe bağlı)

Kayıt önleme ve ek bilgi raporları dışarıdaki bir araçla okunur (`docs\RAPOR.md`).
Araç uygulamanın kendi veritabanı hesabıyla değil, salt okunur kullanıcıyla bağlanır:

```powershell
.\deploy\windows\rapor-kullanicisi.ps1
```

PostgreSQL yönetici parolasını sorar; `ichatlar_rapor` kullanıcısını oluşturur ve
parolasını **bir kez** gösterir. Kullanıcı yalnızca `rapor` şemasındaki görünümleri
okur, uygulama tablolarına erişemez ve yazamaz. Yeniden çalıştırmak parolayı yeniler.

Rapor aracı (Power BI, Excel) başka bir bilgisayarda çalışıyorsa PostgreSQL'e ağdan
yalnızca bu kullanıcıyla ve yalnızca analistlerin ağından erişilsin. Uygulama hesabı
yerelde kalır:

1. `postgresql.conf`: `listen_addresses = 'localhost,<sunucunun IP'si>'`.
2. `pg_hba.conf` sonuna, analistlerin alt ağıyla (örnek `10.20.30.0/24`):

   ```
   hostssl  ichatlar  ichatlar_rapor  10.20.30.0/24  scram-sha-256
   ```

   `hostssl` için PostgreSQL'de sertifika tanımlı olmalı (`ssl = on`); yoksa BT ile
   birlikte karar verin, parola ağda şifresiz gider.
3. Güvenlik duvarı: 5432 yalnızca o alt ağa açık.

   ```powershell
   New-NetFirewallRule -Name IcHatlar-Rapor -DisplayName 'İç Hatlar rapor (PostgreSQL)' -Direction Inbound -Protocol TCP -LocalPort 5432 -RemoteAddress 10.20.30.0/24 -Action Allow
   ```

4. PostgreSQL hizmetini yeniden başlatın. Betiğin yazdığı sunucu adı ve parola rapor
   aracına girilir.

## 8. Güncelleme

Geliştirme bilgisayarında yeni paketi hazırlayın (§3), sunucuya kopyalayın:

```powershell
powershell -ExecutionPolicy Bypass -File C:\IcHatlar\deploy\windows\guncelle.ps1 -Paket D:\ichatlar-0.2.0-def5678.zip
```

Önce yedek alır, sonra hizmeti durdurup kodu değiştirir. Eski kod
`onceki-surum\` klasörüne gider. Ardından göçleri uygular ve hizmeti başlatır.
Uygulama açılmazsa eski kodu kendiliğinden geri koyar. `.env`, `var\`,
`logs\`, `iis\` ve `config\kurulus.json`'a dokunmaz.

Göçler yalnızca ileri yönlüdür ve veri silmez. Geri alınan güncellemede
veritabanı yeni şemada kalabilir; o durumda güncellemenin başında alınan
yedekten geri yükleyin (§7).

## 9. Canlıya almadan önce

- [ ] `kur.ps1` hatasız bitti, Türkçe harf denetimi geçti
- [ ] PostgreSQL yalnızca localhost'ta dinliyor (`listen_addresses = 'localhost'`)
- [ ] `config\kurulus.json`'da her ekibin `group` alanı dolu; BT grupları oluşturdu
- [ ] Bir ekip üyesi, bir ekip yöneticisi ve bir sistem yöneticisi giriş yaptı; roller doğru
- [ ] HTTPS çalışıyor (ya da HTTP'nin geçici olduğu yazılı kabul edildi)
- [ ] Uygulama portu (3000) dışarıdan kapalı; yalnızca IIS erişiyor
- [ ] Yedek klasörü başka diskte; bir kez geri yükleme denendi
- [ ] KVKK prosedüründeki açık işler (aydınlatma metni, saklama/imha) gözden geçirildi
- [ ] Rapor aracı kullanılacaksa `rapor-kullanicisi.ps1` çalıştırıldı, parola rapor aracına girildi

## Ek A — Microsoft Entra ID ile giriş (AD yerine)

`.env`'de `LDAP_URL` boş bırakılıp `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
`ENTRA_CLIENT_SECRET` doldurulur (ikisi birden ayarlanamaz). Entra kaydı:

1. App registrations → New registration, tek kiracı.
2. Redirect URI (Web): `<APP_URL>/auth/callback` (HTTPS zorunlu).
3. Certificates & secrets → client secret; bitiş tarihini takvime ekleyin.
4. Token configuration → `groups` isteğe bağlı talebi.

Ekip eşlemesi için `ENTRA_USE_GROUPS=true` ve kurulus.json'da `group` alanına
grubun nesne kimliği yazılır. Sistem yöneticisi grubu: `ENTRA_ADMIN_GROUP_ID`.
Entra'da grup listesi eksik gelebildiği için ekip ve rol yalnızca boşsa
doldurulur, AD'deki gibi her girişte yeniden yazılmaz.

## Ek B — Ters vekil ve güvenlik notları

- Uygulama `X-Forwarded-For` başlığında yalnızca en yakın vekilin (IIS)
  eklediği adrese güvenir. Uygulama portu yalnızca IIS'e açık olmalı;
  aksi hâlde istemci IP'si taklit edilip hız sınırı atlatılabilir.
- Yazma istekleri (POST/PATCH/DELETE) tarayıcının gönderdiği `Sec-Fetch-Site`
  (yoksa `Origin`) başlığıyla denetlenir. Başka siteden, kardeş alt alan adları
  dahil, gelen istek reddedilir. Vekil bu başlıkları silmemeli.
- Giriş sayfası IP başına dakikada 10 denemeyle sınırlı. AD'nin hesap
  kilitleme politikası ayrıca işler; kilitlenen kişiye nedeni söylenir.
