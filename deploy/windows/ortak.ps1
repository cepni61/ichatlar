# İç Hatlar Windows betiklerinin ortak yardımcıları. Diğer betikler bunu
# ". (Join-Path $PSScriptRoot 'ortak.ps1')" ile yükler; tek başına çalıştırılmaz.
# Windows PowerShell 5.1 ile uyumlu yazıldı (Windows Server'ın varsayılanı).

$ErrorActionPreference = 'Stop'
$Kok = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Hizmet = 'IcHatlar'

function Adim([string]$Metin) { Write-Host ''; Write-Host "==> $Metin" -ForegroundColor Cyan }
function Uyari([string]$Metin) { Write-Host "UYARI: $Metin" -ForegroundColor Yellow }

# Zip işleri .NET ile: Windows'un tar.exe'si node_modules'ta çöküyor ve
# Türkçe karakterli yolu açamıyor.
# PowerShell 5.1 (.NET 4.5 hedefli) klasör ayracını "\" yazar; standart "/" olsun.
[AppContext]::SetSwitch('Switch.System.IO.Compression.ZipFile.UseBackslash', $false)
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Sikistir([string]$Klasor, [string]$Zip) {
  if (Test-Path $Zip) { Remove-Item $Zip -Force }
  [IO.Compression.ZipFile]::CreateFromDirectory($Klasor, $Zip, [IO.Compression.CompressionLevel]::Optimal, $false)
}
function ZipAc([string]$Zip, [string]$Klasor) {
  [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Klasor)
}

function YoneticiMi {
  $p = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Bu betik yönetici olarak çalıştırılmalı (PowerShell: Yönetici olarak çalıştır).'
  }
}

# Dış programı çalıştırır; sıfır dışı çıkış kodunda durur.
function Calistir([string]$Program, [string[]]$Argumanlar) {
  & $Program @Argumanlar
  if ($LASTEXITCODE -ne 0) { throw "$Program hata verdi (çıkış kodu $LASTEXITCODE): $($Argumanlar -join ' ')" }
}

function NodeYolu {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { throw 'Node.js bulunamadı. Node.js 22 LTS (en az 22.15) kurun: https://nodejs.org' }
  return $n.Source
}

# PostgreSQL araçları (psql, pg_dump): kurulu en yeni sürüm.
function PgAraci([string]$Ad) {
  $adaylar = Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin\$Ad.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace '\D.*$', '') } -Descending
  if ($adaylar) { return @($adaylar)[0].FullName }
  $g = Get-Command $Ad -ErrorAction SilentlyContinue
  if ($g) { return $g.Source }
  throw "$Ad.exe bulunamadı. PostgreSQL bu sunucuya kurulu mu?"
}

function EnvOku {
  $h = @{}
  Get-Content (Join-Path $Kok '.env') -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $h[$Matches[1]] = $Matches[2].Trim() }
  }
  return $h
}

# postgresql://kullanici:parola@sunucu:5432/veritabani?schema=public
function VeritabaniBilgisi([string]$Url) {
  $u = [uri]($Url -replace '^postgres(ql)?://', 'http://')
  $kim = $u.UserInfo.Split(':', 2)
  $port = 5432
  if ($u.Port -gt 0 -and $Url -match '@[^/]+:\d+/') { $port = $u.Port }
  return @{
    Kullanici = [uri]::UnescapeDataString($kim[0])
    Parola    = [uri]::UnescapeDataString($kim[1])
    Sunucu    = $u.Host
    Port      = $port
    Ad        = $u.AbsolutePath.TrimStart('/')
  }
}

function SaglikBekle([int]$Port, [int]$Saniye = 90) {
  $son = (Get-Date).AddSeconds($Saniye)
  while ((Get-Date) -lt $son) {
    try {
      $r = Invoke-WebRequest "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

# Kurulumun kod parçaları: güncellemede değişen her şey. .env, var\, logs\,
# iis\ ve config\kurulus.json kuruluşa aittir, güncellemede dokunulmaz.
$KodParcalari = @('dist', 'public', 'prisma', 'node_modules', 'deploy', 'docs', 'package.json', 'package-lock.json', '.env.example', 'SURUM.txt')

function Gocler([string]$Node) {
  $prisma = Join-Path $Kok 'node_modules\prisma\build\index.js'
  $env:PRISMA_HIDE_UPDATE_MESSAGE = '1'
  Push-Location $Kok
  try {
    Calistir $Node @($prisma, 'migrate', 'deploy')
    Calistir $Node @($prisma, 'migrate', 'deploy', '--schema', 'prisma\ml\schema.prisma')
  } finally { Pop-Location }
}
