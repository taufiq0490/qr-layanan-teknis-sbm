@echo off
title SBM ITB - QR Layanan Teknis Kelas
echo =======================================================
echo    Menjalankan Server QR Layanan Teknis SBM ITB...
echo =======================================================
echo.
echo Membuka browser ke http://localhost:3000 ...
start http://localhost:3000
echo.
echo Server sedang berjalan. JANGAN TUTUP jendela ini!
echo =======================================================
node server.js
pause
