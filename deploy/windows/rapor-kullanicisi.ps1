<#
.SYNOPSIS
  Rapor araçları için salt okunur PostgreSQL kullanıcısı (ichatlar_rapor).
.DESCRIPTION
  Kullanıcı yalnızca "rapor" şemasındaki görünümleri okur (docs\RAPOR.md); ham
  tablolara erişimi yoktur. Yoksa oluşturur, varsa parolasını yeniler ve
  bağlantı bilgisini ekrana yazar. Kurulum klasöründen, göçler uygulandıktan
  sonra çalıştırın.
.EXAMPLE
  .\deploy\windows\rapor-kullanicisi.ps1
#>
[CmdletBinding()]
param(
  [string]$PgYonetici = 'postgres',
  [string]$Kullanici = 'ichatlar_rapor'
)

. (Join-Path $PSScriptRoot 'ortak.ps1')
Set-Location $Kok
if ($Kullanici -notmatch '^[a-z_][a-z0-9_]{0,62}$') { throw 'Kullanıcı adı küçük harf, rakam ve _ olmalı.' }

$e = EnvOku
$db = VeritabaniBilgisi $e['DATABASE_URL']
$psql = PgAraci 'psql'

$b = New-Object byte[] 18
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$parola = -join ($b | ForEach-Object { $_.ToString('x2') })

$sifre = Read-Host "PostgreSQL '$PgYonetici' kullanıcısının parolası" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sifre))
try {
  $sql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$Kullanici') THEN
    CREATE ROLE $Kullanici LOGIN PASSWORD '$parola';
  ELSE
    ALTER ROLE $Kullanici WITH LOGIN PASSWORD '$parola';
  END IF;
END `$`$;
ALTER ROLE $Kullanici SET timezone = 'Europe/Istanbul';
ALTER ROLE $Kullanici SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE $($db.Ad) TO $Kullanici;
GRANT USAGE ON SCHEMA rapor TO $Kullanici;
GRANT SELECT ON ALL TABLES IN SCHEMA rapor TO $Kullanici;
ALTER DEFAULT PRIVILEGES FOR ROLE $($db.Kullanici) IN SCHEMA rapor GRANT SELECT ON TABLES TO $Kullanici;
"@
  $sql | & $psql -h $db.Sunucu -p $db.Port -U $PgYonetici -d $db.Ad -v ON_ERROR_STOP=1 -q
  if ($LASTEXITCODE -ne 0) { throw 'psql hata verdi; rapor şeması var mı (göçler uygulandı mı)?' }
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Rapor kullanıcısı hazır (yalnızca rapor şemasını okur):'
# Rapor aracı başka bilgisayarda çalışır: "localhost" ona bu sunucuyu değil kendisini gösterir.
$sunucu = $db.Sunucu
if ($sunucu -in @('localhost', '127.0.0.1')) { $sunucu = [Net.Dns]::GetHostEntry($env:COMPUTERNAME).HostName }
Write-Host "  Sunucu:     ${sunucu}:$($db.Port)"
Write-Host "  Veritabanı: $($db.Ad)"
Write-Host "  Kullanıcı:  $Kullanici"
Write-Host "  Parola:     $parola"
Write-Host 'Parolayı rapor aracına girip bu pencereyi kapatın; bir yere kaydedilmedi. Yeniden çalıştırmak parolayı yeniler.'
Write-Host 'Rapor aracı başka bir bilgisayardaysa PostgreSQL ağ erişimi ayrıca açılmalı (docs\KURULUM.md, Rapor kullanıcısı).'
