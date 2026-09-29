@echo off
REM ---------------------------------------------------------------------------
REM İç Hatlar — yerel test sunucusunu başlatır.
REM Bu dosyaya çift tıklamak yeterli. Kapatmak için pencereyi kapatın veya Ctrl+C.
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

if not exist "var\ichatlar.db" (
  echo   Veritabani olusturuluyor...
  call npx prisma migrate deploy
  if errorlevel 1 goto :hata
  echo   Demo verisi yukleniyor...
  call npm run db:seed
  if errorlevel 1 goto :hata
  echo.
)

REM ML veritabani ana veritabanindan ayri bir dosya: var\ichatlar-ml.db
if not exist "node_modules\.prisma\ml-client" (
  echo   ML istemcisi uretiliyor...
  call npm run ml:generate
  if errorlevel 1 goto :hata
)
REM migrate deploy idempotent: yeni ML tablolari eklendiyse uygular, yoksa hicbir sey yapmaz.
call npx prisma migrate deploy --schema prisma/ml/schema.prisma >nul
if errorlevel 1 (
  echo   [UYARI] ML veritabani kurulamadi. Uygulama calisir, ML kayitlari tutulmaz.
  echo.
)

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
