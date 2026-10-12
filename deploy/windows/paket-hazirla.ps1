<#
.SYNOPSIS
  Canlı sunucuya götürülecek kurulum paketini (zip) hazırlar.

.DESCRIPTION
  Geliştirme bilgisayarında, projenin kökünden çalıştırılır. Kod derlenir,
  yalnızca çalışma bağımlılıkları pakete girer; sunucuda npm ya da internet
  gerekmez. Paket release\ klasörüne yazılır.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\windows\paket-hazirla.ps1
#>
param([string]$Cikti)

. (Join-Path $PSScriptRoot 'ortak.ps1')
if (-not $Cikti) { $Cikti = Join-Path $Kok 'release' }
Set-Location $Kok

$surum = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$commit = (& git rev-parse --short HEAD)
$degisiklik = (& git status --porcelain)
if ($degisiklik) { Uyari 'Commit edilmemiş değişiklik var; paket çalışma klasöründeki hâliyle hazırlanır.' }
$ad = "ichatlar-$surum-$commit"
$sahne = Join-Path $env:TEMP $ad

Adim 'Derleniyor'
Calistir 'npm.cmd' @('run', 'build')

Adim "Paket klasörü: $sahne"
if (Test-Path $sahne) { Remove-Item $sahne -Recurse -Force }
New-Item -ItemType Directory $sahne | Out-Null
foreach ($p in @('dist', 'public', 'prisma', 'config', 'docs', 'deploy', 'package.json', 'package-lock.json', '.env.example')) {
  Copy-Item (Join-Path $Kok $p) -Destination $sahne -Recurse
}
# Geliştirme veritabanları ve kuruluşa özgü olmayan artıklar pakete girmez.
Get-ChildItem $sahne -Recurse -Include '*.db', '*.db-journal' | Remove-Item -Force
Remove-Item (Join-Path $sahne 'prisma\var') -Recurse -Force -ErrorAction SilentlyContinue
"$ad`r`nHazırlandı: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Set-Content (Join-Path $sahne 'SURUM.txt') -Encoding UTF8

Adim 'Çalışma bağımlılıkları (geliştirme araçları hariç)'
Push-Location $sahne
try {
  # Prisma motorları kurulumda indirilir; kurum sertifikası Windows deposunda.
  $eski = $env:NODE_OPTIONS
  $env:NODE_OPTIONS = '--use-system-ca'
  Calistir 'npm.cmd' @('ci', '--omit=dev', '--no-audit', '--no-fund')
  Calistir 'node' @('node_modules\prisma\build\index.js', 'generate')
  Calistir 'node' @('node_modules\prisma\build\index.js', 'generate', '--schema', 'prisma\ml\schema.prisma')
} finally {
  $env:NODE_OPTIONS = $eski
  Pop-Location
}

Adim 'Sıkıştırılıyor'
New-Item -ItemType Directory -Force $Cikti | Out-Null
$zip = Join-Path $Cikti "$ad.zip"
Sikistir $sahne $zip
Remove-Item $sahne -Recurse -Force

$mb = [math]::Round((Get-Item $zip).Length / 1MB)
Write-Host ''
Write-Host "Paket hazır: $zip ($mb MB)" -ForegroundColor Green
Write-Host 'Sunucuda: zip''i kurulum klasörüne (ör. C:\IcHatlar) açın, ardından docs\KURULUM.md.'
