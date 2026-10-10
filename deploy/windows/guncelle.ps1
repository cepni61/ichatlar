<#
.SYNOPSIS
  Kurulu İç Hatlar'ı yeni pakete günceller.

.DESCRIPTION
  1. Yedek alır.  2. Paketi kurulum klasörünün içinde açar (dosyalar klasörün
  izinlerini alsın).  3. Hizmeti durdurur, kod parçalarını değiştirir (eski
  sürüm onceki-surum\ klasörüne).  4. Şema göçlerini uygular.  5. Hizmeti
  başlatıp /health'i bekler; açılmazsa eski kodu geri koyar.

  .env, var\ (ekler, ML veritabanı), logs\, iis\ ve config\kurulus.json'a
  dokunulmaz. Göçler yalnızca ileri yönlüdür: geri dönüşte veritabanı yeni
  şemada kalır; gerekirse yedekten geri yüklenir (docs\KURULUM.md §7).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\IcHatlar\deploy\windows\guncelle.ps1 -Paket D:\ichatlar-0.2.0-abc1234.zip
#>
param(
  [Parameter(Mandatory = $true)][string]$Paket,
  [string]$YedekDizini = 'C:\IcHatlarYedek'
)

. (Join-Path $PSScriptRoot 'ortak.ps1')
YoneticiMi
if (-not (Test-Path $Paket)) { throw "Paket bulunamadı: $Paket" }
$e = EnvOku
$port = [int]$e['PORT']
$node = NodeYolu

Adim 'Yedek'
& (Join-Path $PSScriptRoot 'yedekle.ps1') -YedekDizini $YedekDizini

Adim 'Paket açılıyor'
$yeni = Join-Path $Kok '.guncelleme'
if (Test-Path $yeni) { Remove-Item $yeni -Recurse -Force }
New-Item -ItemType Directory $yeni | Out-Null
ZipAc (Resolve-Path $Paket).Path $yeni
if (-not (Test-Path (Join-Path $yeni 'dist\server.js'))) { throw 'Paket geçersiz: dist\server.js yok.' }
Write-Host (Get-Content (Join-Path $yeni 'SURUM.txt') -Encoding UTF8 | Select-Object -First 1)

Adim 'Hizmet durduruluyor'
Stop-Service $Hizmet

$onceki = Join-Path $Kok 'onceki-surum'
function Degistir([string]$Kaynak, [string]$Hedef) {
  foreach ($p in $KodParcalari) {
    $k = Join-Path $Kaynak $p
    if (Test-Path $k) { Move-Item $k (Join-Path $Hedef $p) }
  }
}
if (Test-Path $onceki) { Remove-Item $onceki -Recurse -Force }
New-Item -ItemType Directory $onceki | Out-Null
Degistir $Kok $onceki
Degistir $yeni $Kok
Copy-Item (Join-Path $yeni 'config\kurulus.example.json') (Join-Path $Kok 'config') -Force
Remove-Item $yeni -Recurse -Force

try {
  Adim 'Veritabanı şeması'
  Gocler $node

  Adim 'Hizmet başlatılıyor'
  Start-Service $Hizmet
  if (-not (SaglikBekle $port)) { throw 'Uygulama /health yanıtı vermedi.' }
} catch {
  Get-Content (Join-Path $Kok 'logs\ichatlar.log') -Tail 40 -ErrorAction SilentlyContinue
  Uyari "Güncelleme başarısız ($($_.Exception.Message)); önceki sürüm geri konuyor."
  Stop-Service $Hizmet -ErrorAction SilentlyContinue
  $bozuk = Join-Path $Kok '.bozuk-surum'
  if (Test-Path $bozuk) { Remove-Item $bozuk -Recurse -Force }
  New-Item -ItemType Directory $bozuk | Out-Null
  Degistir $Kok $bozuk
  Degistir $onceki $Kok
  Start-Service $Hizmet
  if (SaglikBekle $port) { Write-Host 'Önceki sürüm ayakta.' -ForegroundColor Green }
  else { Uyari 'Önceki sürüm de açılmadı: logs\ichatlar.log ve yedekten geri yükleme (docs\KURULUM.md §7).' }
  throw 'Güncelleme geri alındı. Göç uygulandıysa veritabanı yeni şemada kalmış olabilir (docs\KURULUM.md §7).'
}

Write-Host ''
Write-Host "Güncellendi: $(Get-Content (Join-Path $Kok 'SURUM.txt') -Encoding UTF8 | Select-Object -First 1)" -ForegroundColor Green
Write-Host "Önceki sürüm: $onceki (bir sonraki güncellemede silinir)"
