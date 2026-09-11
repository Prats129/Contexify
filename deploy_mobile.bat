@echo off
setlocal
echo ========================================
echo  Contexify Mobile Deployment
echo ========================================
node "%~dp0scripts\deploy-mobile.js" %*
pause
