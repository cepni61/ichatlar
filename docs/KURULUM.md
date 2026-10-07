# İç Hatlar — Sunucu kurulumu (BT için)

İç Hatlar her kuruluşa **ayrı kurulur**: kendi sunucusu, kendi PostgreSQL
veritabanı, kendi Entra ID uygulama kaydı. Kuruluşlar arasında veri paylaşılmaz.
Bu belge bir kurulumu sıfırdan canlıya almayı anlatır.

```
kullanıcı ──HTTPS──▶ ters vekil (IIS / nginx) ──HTTP──▶ Node.js uygulaması :3000 ──▶ PostgreSQL :5432
                                                          │
                                                          └──HTTPS──▶ login.microsoftonline.com (Entra ID)
```

## 1. Gereksinimler

| Bileşen | Sürüm / not |
|---|---|
| Sunucu | Windows Server veya Linux; tek Node.js süreci çalışır |
| Node.js | ≥ 20.12 (22 LTS önerilir) |
| PostgreSQL | ≥ 15, **ICU desteğiyle** derlenmiş (resmi paketlerin hepsi öyle) |
| Ağ | Kullanıcılardan vekile 443 · uygulamadan `login.microsoftonline.com`'a 443 çıkış · PostgreSQL 5432 yalnızca uygulama sunucusundan |
| Git | Kurulum ve güncelleme için (veya teslim edilen zip) |

Uygulama yük testinden geçmedi; küçük bir sanal makine ile başlayıp izleyin.

## 2. PostgreSQL hazırlığı

Veritabanı **tr-TR ICU yerel ayarıyla** oluşturulmalı. Aksi hâlde arama Türkçe
harflerde büyük/küçük ayırır ("İZİN" ile "izin" eşleşmez).

```sql
CREATE ROLE ichatlar_app LOGIN PASSWORD '<güçlü parola>';

CREATE DATABASE ichatlar
  OWNER ichatlar_app
  TEMPLATE template0
  ENCODING 'UTF8'
  LOCALE_PROVIDER icu
  ICU_LOCALE 'tr-TR'
  LOCALE 'C';
```

Doğrulama (`ichatlar` veritabanına bağlıyken `t` dönmeli):

```sql
SELECT 'Yıllık İZİN' ILIKE '%izin%';
```

Uygulama rolünün veritabanının sahibi olması yeterli; tabloları göçler kurar.
Süper kullanıcı yetkisi gerekmez.

## 3. Uygulamayı kurmak

```bash
git clone https://github.com/cepni61/ichatlar.git
cd ichatlar
npm ci
npm run build
```

`npm ci` geliştirme araçlarını da kurar (derleme için TypeScript gerekir).
Derlemeden sonra isterseniz `npm prune --omit=dev` ile kaldırabilirsiniz; bu,
yalnızca yerel geliştirmede kullanılan gömülü PostgreSQL'i (~100 MB) de siler.

### .env

`.env.example` dosyasını `.env` olarak kopyalayıp doldurun. Canlıda gerekenler:

| Değişken | Değer |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Uygulamanın dinleyeceği port (varsayılan 3000) |
| `APP_URL` | Kullanıcıların açtığı HTTPS adres, ör. `https://ichatlar.kurum.com.tr` — Entra'daki redirect URI bununla birebir aynı olmalı |
| `ORG_NAME` | Kuruluşun adı (başlıkta ve alt bilgide görünür) |
| `DATABASE_URL` | `postgresql://ichatlar_app:<parola>@<sunucu>:5432/ichatlar?schema=public&sslmode=require` |
| `SESSION_SECRET` | Rastgele en az 32 karakter: `openssl rand -base64 48` |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Bölüm 5 |
| `ENTRA_USE_GROUPS` | `true` → departman Entra grubundan atanır; `false` → yönetici elle atar |
| `ENTRA_ADMIN_GROUP_ID` | Bu gruptakiler sistem yöneticisi olur |
| `ACCESS_CODE` | **Boş** — yalnızca internete açık geçici test yayını içindir |
| `CORTEX_URL`, `CORTEX_TOKEN` | Kurumsal arama kaynağı (Cortex). Boşsa Arama yalnızca Bilgi Bankası ve çözülmüş kayıtlarla çalışır; sözleşme `src/lib/cortex.ts` |

**Bilgi Bankası ve geri bildirim.** Bilgi Bankası'nı departman yöneticileri
(kendi ekipleri için) ve sistem yöneticisinin yetki verdiği kişiler yönetir;
yetki uygulamadan, Bilgi Bankası ekranındaki "Düzenleme yetkileri" kartından
verilir. Kenar çubuğundaki "Uygulama için geri bildirim" metinleri `Feedback`
tablosuna yazılır ve yalnızca sistem yöneticileri Yönetim ekranında görür —
serbest metin olduğu için kişisel veri içerebilir, KVKK envanterine ekleyin.

`NODE_ENV=production` iken geliştirme girişi (`DEV_AUTH_BYPASS`) kod tarafından
kapatılır; Entra ayarları eksikse sunucu hiç başlamaz.

### Veritabanı şeması ve kuruluş ayarları

```bash
npx prisma migrate deploy                                   # ana veritabanı tabloları
npx prisma migrate deploy --schema prisma/ml/schema.prisma  # ML yardımcı veritabanı (var/ altında dosya)
cp config/kurulus.example.json config/kurulus.json          # departmanlar ve SLA süreleri — düzenleyin
node dist/cli/setup.js config/kurulus.json
```

`config/kurulus.json`:

| Alan | Anlamı |
|---|---|
| `departments[].id` | Kalıcı kısa kimlik (`ik`, `bt`…). Kayıtlar buna bağlanır, **sonradan değiştirmeyin** |
| `departments[].name` / `short` | Görünen ad / kısa ad |
| `departments[].entraGroupId` | `ENTRA_USE_GROUPS=true` ise bu Entra grubunun nesne kimliği |
| `sla.NORMAL` / `YUKSEK` / `KRITIK` | Hedef süre (saat). Kritik ≤ Yüksek ≤ Normal olmalı |
| `sla.warnRatio` | Sürenin bu oranı geçilince kayıt sarıya döner (0.7 = %70) |

`setup` tekrar çalıştırılabilir. Dosyadan çıkarılan departman **silinmez**
(üzerinde kayıt olabilir), yalnızca uyarı verir. Her çalıştırma denetim izine yazılır.

> **`npm run db:seed` canlıda çalıştırılmaz.** Demo kullanıcılar ve örnek
> kayıtlar üretir; yalnızca geliştirme içindir. Canlıda kullanıcılar ilk
> girişte Entra'dan oluşur.

## 4. Servis olarak çalıştırmak

Komut her ortamda aynı: kurulum klasöründe `node dist/server.js`,
`NODE_ENV=production` ile. Uygulama `.env`'yi çalışma klasöründen okur.

**Linux (systemd)** — `/etc/systemd/system/ichatlar.service`:

```ini
[Unit]
Description=İç Hatlar
After=network.target

[Service]
WorkingDirectory=/opt/ichatlar
ExecStart=/usr/bin/node dist/server.js
Environment=NODE_ENV=production
User=ichatlar
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

**Windows** — bir servis sarmalayıcı (ör. NSSM) ile:

```bat
nssm install IcHatlar "C:\Program Files\nodejs\node.exe" dist\server.js
nssm set IcHatlar AppDirectory C:\ichatlar
nssm set IcHatlar AppEnvironmentExtra NODE_ENV=production
nssm start IcHatlar
```

Kurulum klasörünü OneDrive gibi eşitlenen bir yere koymayın.

## 5. HTTPS ve Entra ID

**Ters vekil.** Uygulama HTTP konuşur; TLS'i önündeki vekil (IIS + ARR, nginx…)
sonlandırır. Canlıda uygulama vekilden gelen `X-Forwarded-For` başlığına güvenir
— bu yüzden **uygulama portuna yalnızca vekil erişebilmeli** (güvenlik duvarı
veya `localhost`'a bağlı vekil). Aksi hâlde istemci IP'si taklit edilip hız
sınırı atlatılabilir.

**Entra ID uygulama kaydı** (kiracı yöneticisi):

1. App registrations → New registration, tek kiracı.
2. Redirect URI (Web): `<APP_URL>/auth/callback`
3. Certificates & secrets → client secret; `.env`'ye yazın, bitiş tarihini takvime ekleyin.
4. Token configuration → `groups` isteğe bağlı talebi (departman ve yönetici grubu kullanılacaksa).

## 6. Günlükler, yedek, sağlık kontrolü

- **Günlükler** standart çıktıya JSON olarak yazılır; systemd'de journald,
  NSSM'de yapılandırdığınız dosya toplar. İstemci IP'si ve kullanıcı kimliği
  içerir — KVKK prosedürüne göre **30 gün** saklayın.
- **Denetim izi** veritabanındadır (`AuditLog` tablosu).
- **Yedek:** her gece `pg_dump -Fc ichatlar > ichatlar-YYYYMMDD.dump`, ayrıca
  kurulum klasöründeki `var/` (ML veritabanı ve `var/uploads` ek dosyaları — ya da
  `STORAGE_DIR` başka yerdeyse orası) ve `.env`. Veritabanı ve ek klasörü aynı
  anda yedeklenmeli; biri olmadan diğeri eksik geri yüklenir. Yedekler şifreli ve
  30 gün dönüşümlü tutulur. Geri yüklemeyi en az bir kez deneyin.
- **Sağlık kontrolü:** `GET /health` → 200 (veritabanına da bağlanır).

## 7. Güncelleme

```bash
git pull                      # veya yeni sürüm zip'i
npm ci
npm run build
npx prisma migrate deploy
npx prisma migrate deploy --schema prisma/ml/schema.prisma
# servisi yeniden başlatın
```

Göçler yalnızca ileri yönlüdür ve veri silmez; yine de güncellemeden önce yedek alın.

## 8. Canlıya almadan önce

- [ ] `NODE_ENV=production`, `ACCESS_CODE` boş
- [ ] Veritabanı tr-TR ICU ile oluşturuldu, doğrulama sorgusu `t` döndü
- [ ] `npm run db:seed` **çalıştırılmadı**
- [ ] HTTPS çalışıyor, uygulama portuna doğrudan erişim kapalı
- [ ] Entra ile giriş denendi; yönetici grubundaki kişi yönetici olarak açıldı
- [ ] Gece yedeği kuruldu, bir kez geri yükleme denendi
- [ ] KVKK prosedüründeki açık işler (aydınlatma metni, saklama/imha) gözden geçirildi
