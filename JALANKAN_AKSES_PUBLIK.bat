@echo off
title SBM ITB - QR Layanan Teknis (Mode Akses Publik Cloudflare)
echo =======================================================
echo    Menjalankan Server QR Layanan Teknis SBM ITB
echo              (Cloudflare Online Mode)
echo =======================================================
echo.
echo Sedang menghubungkan server dan membuat URL Publik...
echo Jendela browser akan terbuka otomatis setelah terhubung.
echo.
node tunnel.js
pause
