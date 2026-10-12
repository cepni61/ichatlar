<#
.SYNOPSIS
  İç Hatlar yedeği: veritabanı, ekler + ML veritabanı (var\), .env ve kuruluş ayarı.

.DESCRIPTION
  kur.ps1 bunu her gece SYSTEM hesabıyla çalışan zamanlanmış görev olarak
  kurar ("IcHatlar Gece Yedegi"). Elle de çalıştırılabilir (yönetici).
  Veritabanı ve ekler aynı anda alınır: biri olmadan diğeri eksik geri yüklenir.
  GunSayisi'ndan eski yedekler ve 30 günden eski günlükler (KVKK) silinir.

  Yedek klasörü başka bir diske ya da BT'nin yedeklediği bir paylaşıma
  alınmalıdır; sunucu diski bozulursa yedek de gider.
#>
param(
  [string]$YedekDizini = 'C:\IcHatlarYedek',
  [int]$GunSayisi = 30
)

. (Join-Path $PSScriptRoot 'ortak.ps1')

$e = EnvOku
$db = VeritabaniBilgisi $e['DATABASE_URL']
$hedef = Join-Path $YedekDizini (Get-Date -Format 'yyyyMMdd-HHmm')
New-Item -ItemType Directory -Force $hedef | Out-Null

$env:PGPASSWORD = $db.Parola
try {
  Calistir (PgAraci 'pg_dump') @('-h', $db.Sunucu, '-p', "$($db.Port)", '-U', $db.Kullanici, '-Fc', '-f', (Join-Path $hedef 'ichatlar.dump'), $db.Ad)
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# Ekler (var\uploads) ve ML veritabanı (var\ichatlar-ml.db). Uygulama açıkken
# dosyalar kullanımda: önce kopyalanır (Copy-Item okuyabiliyor), sonra sıkıştırılır.
# STORAGE_DIR başka yerdeyse orası da alınır.
function KlasorYedegi([string]$Klasor, [string]$Zip) {
  $kopya = Join-Path $env:TEMP ('ichatlar-yedek-' + [guid]::NewGuid())
  Copy-Item $Klasor $kopya -Recurse
  try { Sikistir $kopya $Zip } finally { Remove-Item $kopya -Recurse -Force }
}
KlasorYedegi (Join-Path $Kok 'var') (Join-Path $hedef 'var.zip')
$ekler = $e['STORAGE_DIR'] -replace '/', '\'
if ($ekler -and -not $ekler.StartsWith((Join-Path $Kok 'var'), [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $ekler)) {
  KlasorYedegi $ekler (Join-Path $hedef 'ekler.zip')
}
Copy-Item (Join-Path $Kok '.env') (Join-Path $hedef 'env.txt')
Copy-Item (Join-Path $Kok 'config\kurulus.json') $hedef -ErrorAction SilentlyContinue

$sinir = (Get-Date).AddDays(-$GunSayisi)
Get-ChildItem $YedekDizini -Directory | Where-Object { $_.CreationTime -lt $sinir } | Remove-Item -Recurse -Force
Get-ChildItem (Join-Path $Kok 'logs') -File -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force

$mb = [math]::Round(((Get-ChildItem $hedef -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host "Yedek alındı: $hedef ($mb MB)"
