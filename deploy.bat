@echo off
chcp 65001 > nul
title Discord Bot - Dolia Command Deployer
echo ===================================================
echo       DISCORD BOT DOLIA - COMMAND DEPLOYER         
echo ===================================================
echo.
echo [*] Dang deploy slash commands...
echo.

node deployOnly.js

echo.
echo [V] Hoan tat deploy!
pause
