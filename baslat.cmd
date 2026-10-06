@echo off
REM ---------------------------------------------------------------------------
REM Ic Hatlar - yerel test sunucusunu baslatir (gomulu PostgreSQL ile).
REM Bu dosyaya cift tiklamak yeterli. Kapatmak icin pencereyi kapatin veya Ctrl+C.
REM Veritabani arka planda acik kalir; durdurmak icin: npm run db:local:stop
REM
REM Kurulus sunucusu icin bu dosya KULLANILMAZ - bkz. docs\KURULUM.md
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo.
echo   IC HATLAR - yerel test sunucusu
echo   ------------------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [HATA] Node.js bulunamadi.
  echo   https://nodejs.org adresinden LTS surumunu kurun ve tekrar deneyin.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo   .env bulunamadi, ornekten olusturuluyor...
  copy /y ".env.example" ".env" >nul
  echo   [UYARI] .env icindeki SESSION_SECRET degerini degistirin.
  echo.
)

if not exist "node_modules" (
  echo   Bagimliliklar kuruluyor, bu birkac dakika surebilir...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :hata
  echo.
)

echo   Yerel PostgreSQL baslatiliyor...
call npm run --silent db:local
if errorlevel 1 goto :hata

REM migrate deploy idempotent: yeni gocler varsa uygular, yoksa hicbir sey yapmaz.
echo   Veritabani semasi guncelleniyor...
call npx prisma migrate deploy >nul
if errorlevel 1 goto :hata

REM Tohum betigi idempotent: kayit varsa ornek kayit uretmez.
call npm run --silent db:seed >nul
if errorlevel 1 goto :hata

REM ML veritabani ana veritabanindan ayri bir dosya: var\ichatlar-ml.db
if not exist "node_modules\.prisma\ml-client" (
  echo   ML istemcisi uretiliyor...
  call npm run ml:generate
  if errorlevel 1 goto :hata
)
call npx prisma migrate deploy --schema prisma/ml/schema.prisma >nul
if errorlevel 1 (
  echo   [UYARI] ML veritabani kurulamadi. Uygulama calisir, ML kayitlari tutulmaz.
  echo.
)

echo.
echo   Sunucu baslatiliyor...
echo.
echo   Tarayicida acin:
echo     http://localhost:3000/auth/dev-login?email=omer.uygun@ornek.com
echo.
echo   Diger kullanicilar:  http://localhost:3000/auth/dev-users
echo   Durdurmak icin:      Ctrl+C
echo   ------------------------------------------------
echo.

REM Tarayiciyi 3 saniye sonra ac, sunucu ayaga kalkacak zamani bulsun.
start "" /b cmd /c "timeout /t 3 >nul & start "" "http://localhost:3000/auth/dev-login?email=omer.uygun@ornek.com""

call npm run dev
goto :son

:hata
echo.
echo   [HATA] Kurulum tamamlanamadi. Yukaridaki mesaja bakin.
echo.
pause
exit /b 1

:son
endlocal
