@echo off
chcp 65001 > nul
title Discord Bot - Dolia
echo ===================================================
echo           DISCORD BOT DOLIA - RUNNER               
echo ===================================================
echo.
echo [*] Dang khoi chay bot Dolia...
echo.

node index.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Bot da dung lai voi loi (Code %ERRORLEVEL%).
    echo [!] Nhan phim bat ky de thoat...
    pause > nul
)
