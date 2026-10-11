<#
.SYNOPSIS
  İç Hatlar'ı bu Windows sunucusuna kurar ya da ayarlarını tazeler.

.DESCRIPTION
  Paketin açıldığı klasör kurulum klasörüdür (ör. C:\IcHatlar). Yönetici
  PowerShell'inde çalıştırın. Tekrar çalıştırılabilir: var olan .env,
  veritabanı ve hizmet korunur, eksik olan tamamlanır.

  Yaptıkları: .env (ilk kurulumda sorarak), PostgreSQL rolü ve tr-TR ICU
  veritabanı, şema göçleri, departman/ekip yapısı, Windows hizmeti (NSSM),
  dosya izinleri, IIS ters vekil sitesi, gece yedeği zamanlanmış görevi.

  Önce hazır olmalı: Node.js 22 LTS (≥ 22.15), PostgreSQL ≥ 15, NSSM;
  -IisYok verilmediyse IIS + URL Rewrite + Application Request Routing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\windows\kur.ps1 -AppUrl http://ichatlar.eczacibasi.local -Nssm C:\Araclar\nssm.exe

.EXAMPLE
  # Kurumsal alan adı ve sertifika geldiğinde: adres, IIS bağlantısı ve HTTPS yönlendirmesi güncellenir.
  .\deploy\windows\kur.ps1 -AppUrl https://ichatlar.eczacibasi.com.tr -SertifikaParmakIzi 0123ABCD...
#>
[CmdletBinding()]
param(
  # Kullanıcıların tarayıcıda açacağı adres. Verilirse .env'deki APP_URL güncellenir.
  [string]$AppUrl,
  # nssm.exe yolu (PATH'te değilse).
  [string]$Nssm,
  # HTTPS için LocalMachine\My deposundaki sertifikanın parmak izi.
  [string]$SertifikaParmakIzi,
  [int]$Port = 3000,
  [int]$PgPort = 5432,
  [string]$PgYonetici = 'postgres',
  [string]$YedekDizini = 'C:\IcHatlarYedek',
  [string]$YedekSaati = '02:00',
  # Hizmetin çalıştığı hesap. Sanal hizmet hesabı yalnızca kurulum klasörünü okur, var\ ve logs\'a yazar.
  [string]$HizmetHesabi = 'NT SERVICE\IcHatlar',
  # IIS kullanmadan Node'u doğrudan ağa aç (geçici iç ağ denemesi; HTTPS olmaz).
  [switch]$IisYok
)

. (Join-Path $PSScriptRoot 'ortak.ps1')
YoneticiMi
Set-Location $Kok
if ($Kok -match 'OneDrive') { throw 'Kurulum klasörü OneDrive gibi eşitlenen bir yerde olamaz.' }
if (-not (Test-Path (Join-Path $Kok 'dist\server.js'))) { throw 'dist\server.js yok: bu klasör hazırlanmış kurulum paketi değil (bkz. paket-hazirla.ps1).' }

function Rastgele([int]$Bayt) {
  $b = New-Object byte[] $Bayt
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return -join ($b | ForEach-Object { $_.ToString('x2') })
}
function Sor([string]$Soru, [string]$Ornek) {
  do { $c = (Read-Host "$Soru (ör. $Ornek)").Trim() } while (-not $c)
  return $c
}
function DuzMetin([Security.SecureString]$S) {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($S))
}
function DosyaYaz([string]$Yol, [string]$Metin) {
  [IO.File]::WriteAllText($Yol, $Metin, (New-Object Text.UTF8Encoding $false))
}

# ------------------------------------------------------------------ Node.js
Adim 'Node.js'
$node = NodeYolu
$nv = [version]((& $node --version).TrimStart('v'))
# --use-system-ca: ldaps sertifikası kurumun kendi otoritesinden, Windows deposunda.
if ($nv -lt [version]'22.15.0') { throw "Node.js $nv eski; en az 22.15 gerekli (Windows sertifika deposu desteği)." }
Write-Host "Node.js $nv  ($node)"

# ------------------------------------------------------------------ .env
Adim 'Ayarlar (.env)'
$envYol = Join-Path $Kok '.env'
$kokIleri = $Kok -replace '\\', '/'
if (-not (Test-Path $envYol)) {
  if (-not $AppUrl) { $AppUrl = Sor 'Kullanıcıların açacağı adres' 'http://ichatlar.eczacibasi.local' }
  $kurum = (Read-Host 'Kuruluş adı (başlıkta görünür; boş geçilebilir)').Trim()
  Write-Host 'Active Directory bilgileri (BT''den alın):'
  $ldapUrl = Sor '  LDAP sunucusu' 'ldaps://dc01.eczacibasi.local:636'
  $ldapAlan = Sor '  Etki alanının kısa adı' 'ECZACIBASI'
  $ldapKok = Sor '  Kişilerin aranacağı kök' 'DC=eczacibasi,DC=local'
  $ldapSistem = Sor '  Sistem yöneticisi grubu' 'IcHatlar-Sistem'
  $ldapYonetici = Sor '  Ekip yöneticisi grubu' 'IcHatlar-Yoneticiler'
  $dinle = if ($IisYok) { '0.0.0.0' } else { '127.0.0.1' }
  DosyaYaz $envYol @"
# kur.ps1 tarafından $(Get-Date -Format 'yyyy-MM-dd') tarihinde oluşturuldu. Açıklamalar: .env.example
NODE_ENV=production
PORT=$Port
HOST=$dinle
APP_URL=$AppUrl
ORG_NAME=$kurum

DATABASE_URL=postgresql://ichatlar_app:$(Rastgele 24)@localhost:$PgPort/ichatlar?schema=public
ML_DATABASE_URL=file:$kokIleri/var/ichatlar-ml.db
ML_RETRAIN_MINUTES=30

SESSION_SECRET=$(Rastgele 48)
SESSION_TTL_HOURS=12

LDAP_URL=$ldapUrl
LDAP_DOMAIN=$ldapAlan
LDAP_BASE_DN=$ldapKok
LDAP_ADMIN_GROUP=$ldapSistem
LDAP_MANAGER_GROUP=$ldapYonetici

DEV_AUTH_BYPASS=false
ACCESS_CODE=

STORAGE_DIR=$kokIleri/var/uploads
MAX_UPLOAD_MB=10

CORTEX_URL=
CORTEX_TOKEN=
"@
  Write-Host '.env oluşturuldu (veritabanı parolası ve oturum anahtarı rastgele üretildi).'
} else {
  Write-Host '.env var, korunuyor.'
  if ($AppUrl) {
    $metin = [IO.File]::ReadAllText($envYol) -replace '(?m)^APP_URL=.*$', "APP_URL=$AppUrl"
    DosyaYaz $envYol $metin
    Write-Host "APP_URL güncellendi: $AppUrl"
  }
}
$e = EnvOku
$appUri = [uri]$e['APP_URL']
if ($appUri.Scheme -ne 'https') {
  Uyari 'APP_URL https değil: Windows parolaları ağda şifresiz gider. Sertifika gelince -AppUrl https://... -SertifikaParmakIzi ile yeniden çalıştırın.'
}
foreach ($d in @('var', 'var\uploads', 'logs', 'iis')) { New-Item -ItemType Directory -Force (Join-Path $Kok $d) | Out-Null }

# ------------------------------------------------------------------ PostgreSQL
Adim 'PostgreSQL'
$db = VeritabaniBilgisi $e['DATABASE_URL']
if ($db.Sunucu -notin @('localhost', '127.0.0.1')) {
  Write-Host "Veritabanı başka sunucuda ($($db.Sunucu)); rol ve veritabanını BT oluşturur (docs\KURULUM.md)."
} else {
  $psql = PgAraci 'psql'
  $env:PGPASSWORD = DuzMetin (Read-Host "PostgreSQL '$PgYonetici' kullanıcısının parolası" -AsSecureString)
  try {
    function Sql([string]$Komut, [string]$Vt = 'postgres') {
      $c = & $psql -h localhost -p $db.Port -U $PgYonetici -d $Vt -v ON_ERROR_STOP=1 -tAc $Komut
      if ($LASTEXITCODE -ne 0) { throw "psql hata verdi: $Komut" }
      return "$c".Trim()
    }
    $rol = $db.Kullanici
    if ((Sql "SELECT 1 FROM pg_roles WHERE rolname = '$rol'") -ne '1') {
      Sql "CREATE ROLE $rol LOGIN PASSWORD '$($db.Parola)'" | Out-Null
      Write-Host "Rol oluşturuldu: $rol"
    } else {
      # .env yeniden üretildiyse parola onunla eşleşsin.
      Sql "ALTER ROLE $rol WITH LOGIN PASSWORD '$($db.Parola)'" | Out-Null
    }
    if ((Sql "SELECT 1 FROM pg_database WHERE datname = '$($db.Ad)'") -ne '1') {
      # Türkçe büyük/küçük harf: "İZİN" ile "izin" eşleşsin diye ICU tr-TR.
      Sql "CREATE DATABASE $($db.Ad) OWNER $rol TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'tr-TR' LOCALE 'C'" | Out-Null
      Write-Host "Veritabanı oluşturuldu: $($db.Ad)"
    }
    # 'Yıllık İZİN' ILIKE '%izin%' — komut satırı kod sayfasına takılmasın diye harf kodlarıyla.
    $dogru = Sql "SELECT ('Y' || chr(305) || 'll' || chr(305) || 'k ' || chr(304) || 'Z' || chr(304) || 'N') ILIKE '%izin%'" $db.Ad
    if ($dogru -ne 't') { throw 'Veritabanı tr-TR ICU ile oluşturulmamış: Türkçe arama çalışmaz (docs\KURULUM.md §2).' }
    Write-Host 'Türkçe harf denetimi geçti.'
  } finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  }
}

# ------------------------------------------------------------------ şema ve kuruluş yapısı
Adim 'Veritabanı şeması'
Gocler $node

Adim 'Departmanlar, ekipler ve AD grupları (config\kurulus.json)'
$cfg = Join-Path $Kok 'config\kurulus.json'
if (-not (Test-Path $cfg)) {
  Copy-Item (Join-Path $Kok 'config\kurulus.example.json') $cfg
  Uyari 'config\kurulus.json örnekten oluşturuldu.'
}
if (-not (Select-String -Path $cfg -Pattern '"group"\s*:' -Quiet)) {
  Uyari 'kurulus.json''da hiçbir ekibe AD grubu ("group") yazılmamış: kişiler ekipsiz açılır, kayıt üstlenemez.'
}
Push-Location $Kok
try { Calistir $node @('dist\cli\setup.js', 'config\kurulus.json') } finally { Pop-Location }

# ------------------------------------------------------------------ Windows hizmeti
Adim 'Windows hizmeti (NSSM)'
if (-not $Nssm) { $g = Get-Command nssm -ErrorAction SilentlyContinue; if ($g) { $Nssm = $g.Source } }
if (-not $Nssm -or -not (Test-Path $Nssm)) {
  throw 'nssm.exe bulunamadı. BT''nin onayladığı NSSM''i bir klasöre koyup -Nssm C:\Araclar\nssm.exe ile verin.'
}
if (Get-Service $Hizmet -ErrorAction SilentlyContinue) {
  Stop-Service $Hizmet -ErrorAction SilentlyContinue
} else {
  Calistir $Nssm @('install', $Hizmet, $node)
}
$ayarlar = @(
  @('Application', $node),
  # Windows sertifika deposu: ldaps sertifikası kurumun kendi otoritesinden.
  @('AppParameters', '--use-system-ca dist\server.js'),
  @('AppDirectory', $Kok),
  @('AppEnvironmentExtra', 'NODE_ENV=production'),
  @('DisplayName', 'İç Hatlar'),
  @('Description', 'İç Hatlar bilgi ve öneri sistemi (Node.js). Kurulum: ' + $Kok),
  @('Start', 'SERVICE_DELAYED_AUTO_START'),
  @('AppStdout', (Join-Path $Kok 'logs\ichatlar.log')),
  @('AppStderr', (Join-Path $Kok 'logs\ichatlar.log')),
  @('AppRotateFiles', '1'),
  @('AppRotateOnline', '1'),
  @('AppRotateSeconds', '86400'),
  @('AppRotateBytes', '20971520'),
  @('AppExit', 'Default', 'Restart'),
  @('AppRestartDelay', '5000'),
  @('AppStopMethodConsole', '15000')
)
foreach ($a in $ayarlar) { Calistir $Nssm (@('set', $Hizmet) + $a) | Out-Null }
$pg = Get-Service 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pg -and $db.Sunucu -in @('localhost', '127.0.0.1')) { Calistir $Nssm @('set', $Hizmet, 'DependOnService', $pg.Name) | Out-Null }
Calistir 'sc.exe' @('config', $Hizmet, 'obj=', $HizmetHesabi) | Out-Null
Write-Host "Hizmet: $Hizmet ($HizmetHesabi), günlük: logs\ichatlar.log"

Adim 'Dosya izinleri'
# Yöneticiler ve SYSTEM tam yetkili; hizmet hesabı kodu okur, yalnızca var\ ve logs\'a yazar.
$yon = '*S-1-5-32-544'; $sis = '*S-1-5-18'
if ($HizmetHesabi -ne 'LocalSystem') {
  Calistir 'icacls.exe' @($Kok, '/grant', "${HizmetHesabi}:(OI)(CI)RX", '/Q') | Out-Null
  foreach ($d in @('var', 'logs')) { Calistir 'icacls.exe' @((Join-Path $Kok $d), '/grant', "${HizmetHesabi}:(OI)(CI)M", '/Q') | Out-Null }
}
# .env parolaları taşır: yalnızca yöneticiler, SYSTEM ve hizmet okur.
$envIzin = @($envYol, '/inheritance:r', '/grant:r', "${yon}:F", "${sis}:F")
if ($HizmetHesabi -ne 'LocalSystem') { $envIzin += "${HizmetHesabi}:R" }
Calistir 'icacls.exe' ($envIzin + '/Q') | Out-Null

# ------------------------------------------------------------------ IIS ya da doğrudan erişim
if ($IisYok) {
  Adim 'Güvenlik duvarı (IIS yok, Node doğrudan ağda)'
  if (-not (Get-NetFirewallRule -Name 'IcHatlar-Node' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'IcHatlar-Node' -DisplayName 'İç Hatlar (Node.js)' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain | Out-Null
  }
  Uyari "Geçici düzen: HTTPS yok. Kalıcı kurulumda IIS ile yeniden çalıştırın (HOST=127.0.0.1)."
} else {
  Adim 'IIS ters vekil'
  if (-not (Get-Module -ListAvailable WebAdministration)) {
    throw 'IIS kurulu değil. Kurmak için: Install-WindowsFeature Web-Server -IncludeManagementTools'
  }
  if (-not (Test-Path "$env:windir\System32\inetsrv\rewrite.dll")) {
    throw 'IIS URL Rewrite modülü kurulu değil: https://www.iis.net/downloads/microsoft/url-rewrite'
  }
  $arrSema = "$env:windir\System32\inetsrv\config\schema\arr_schema.xml"
  if (-not (Test-Path $arrSema)) {
    throw 'IIS Application Request Routing (ARR) kurulu değil: https://www.iis.net/downloads/microsoft/application-request-routing'
  }
  if ($e['HOST'] -ne '127.0.0.1') { Uyari ".env HOST=$($e['HOST']): IIS varken 127.0.0.1 olmalı, uygulama portu ağa açık kalır." }
  Import-Module WebAdministration

  # ARR vekilliği: istemci IP'si X-Forwarded-For'da, portsuz (hız sınırı IP başına).
  $ust = 'MACHINE/WEBROOT/APPHOST'
  Set-WebConfigurationProperty -PSPath $ust -Filter 'system.webServer/proxy' -Name 'enabled' -Value $true
  Set-WebConfigurationProperty -PSPath $ust -Filter 'system.webServer/proxy' -Name 'preserveHostHeader' -Value $true
  Set-WebConfigurationProperty -PSPath $ust -Filter 'system.webServer/proxy' -Name 'reverseRewriteHostInResponseHeaders' -Value $false
  if (Select-String -Path $arrSema -Pattern 'includePortInXForwardedFor' -Quiet) {
    Set-WebConfigurationProperty -PSPath $ust -Filter 'system.webServer/proxy' -Name 'includePortInXForwardedFor' -Value $false
  }

  $https = $appUri.Scheme -eq 'https'
  $yonlendir = ''
  if ($https) {
    $yonlendir = @'
        <rule name="HTTPS" stopProcessing="true">
          <match url=".*" />
          <conditions><add input="{HTTPS}" pattern="off" /></conditions>
          <action type="Redirect" url="https://{HTTP_HOST}{UNENCODED_URL}" appendQueryString="false" redirectType="Permanent" />
        </rule>
'@
  }
  DosyaYaz (Join-Path $Kok 'iis\web.config') @"
<?xml version="1.0" encoding="utf-8"?>
<!-- deploy\windows\kur.ps1 üretir; elle değiştirmeyin, yeniden çalıştırınca ezilir. -->
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
$yonlendir        <rule name="IcHatlar" stopProcessing="true">
          <match url=".*" />
          <action type="Rewrite" url="http://127.0.0.1:$Port{UNENCODED_URL}" appendQueryString="false" />
        </rule>
      </rules>
    </rewrite>
    <security>
      <requestFiltering allowDoubleEscaping="true">
        <requestLimits maxAllowedContentLength="104857600" />
      </requestFiltering>
    </security>
    <httpErrors existingResponse="PassThrough" />
  </system.webServer>
</configuration>
"@
  # IIS çalışan süreçleri (IIS_IUSRS) yalnızca bu klasörü okur.
  Calistir 'icacls.exe' @((Join-Path $Kok 'iis'), '/grant', '*S-1-5-32-568:(OI)(CI)RX', '/Q') | Out-Null

  $site = 'IcHatlar'
  if (-not (Test-Path "IIS:\AppPools\$site")) { New-WebAppPool -Name $site | Out-Null }
  Set-ItemProperty "IIS:\AppPools\$site" -Name managedRuntimeVersion -Value ''
  $alan = $appUri.Host
  if (-not (Get-Website -Name $site)) {
    New-Website -Name $site -PhysicalPath (Join-Path $Kok 'iis') -ApplicationPool $site -Port 80 -HostHeader $alan | Out-Null
  }
  if (-not (Get-WebBinding -Name $site -Protocol http -HostHeader $alan)) {
    New-WebBinding -Name $site -Protocol http -Port 80 -HostHeader $alan
  }
  if ($https) {
    if (-not $SertifikaParmakIzi) {
      Uyari 'APP_URL https ama -SertifikaParmakIzi verilmedi: 443 bağlantısı kurulmadı.'
    } else {
      $iz = $SertifikaParmakIzi -replace '\s', ''
      if (-not (Test-Path "Cert:\LocalMachine\My\$iz")) { throw "Sertifika bulunamadı: Cert:\LocalMachine\My\$iz" }
      if (-not (Get-WebBinding -Name $site -Protocol https -HostHeader $alan)) {
        New-WebBinding -Name $site -Protocol https -Port 443 -HostHeader $alan -SslFlags 1
      }
      (Get-WebBinding -Name $site -Protocol https -HostHeader $alan).AddSslCertificate($iz, 'My')
    }
  }
  Start-Website -Name $site
  Write-Host "IIS sitesi: $site ($alan) → http://127.0.0.1:$Port"
}

# ------------------------------------------------------------------ başlat ve denetle
Adim 'Hizmet başlatılıyor'
Start-Service $Hizmet
if (SaglikBekle $Port) {
  Write-Host 'Uygulama ayakta (/health).' -ForegroundColor Green
} else {
  Get-Content (Join-Path $Kok 'logs\ichatlar.log') -Tail 40 -ErrorAction SilentlyContinue
  throw 'Uygulama açılmadı; yukarıdaki günlüğe bakın (logs\ichatlar.log).'
}

# ------------------------------------------------------------------ gece yedeği
Adim "Gece yedeği ($YedekSaati → $YedekDizini)"
New-Item -ItemType Directory -Force $YedekDizini | Out-Null
# Yedek kişisel veri ve parolalar taşır: yalnızca yöneticiler ve SYSTEM.
Calistir 'icacls.exe' @($YedekDizini, '/inheritance:r', '/grant:r', "${yon}:(OI)(CI)F", "${sis}:(OI)(CI)F", '/Q') | Out-Null
$betik = Join-Path $Kok 'deploy\windows\yedekle.ps1'
$eylem = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$betik`" -YedekDizini `"$YedekDizini`""
$tetik = New-ScheduledTaskTrigger -Daily -At $YedekSaati
Register-ScheduledTask -TaskName 'IcHatlar Gece Yedegi' -Action $eylem -Trigger $tetik -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Write-Host 'Yedek bir kez deneniyor...'
& $betik -YedekDizini $YedekDizini

Write-Host ''
Write-Host 'Kurulum tamam.' -ForegroundColor Green
Write-Host "  Adres     : $($e['APP_URL'])"
Write-Host "  Hizmet    : $Hizmet  (Get-Service $Hizmet)"
Write-Host "  Günlük    : $Kok\logs\ichatlar.log"
Write-Host "  Yedek     : $YedekDizini  (her gün $YedekSaati)"
Write-Host '  Sırada    : DNS kaydı, AD grupları (kurulus.json), bir kişiyle giriş denemesi — docs\KURULUM.md §8'
Write-Host '  Rapor     : rapor aracı bağlanacaksa salt okunur kullanıcı için .\deploy\windows\rapor-kullanicisi.ps1 (docs\RAPOR.md)'
