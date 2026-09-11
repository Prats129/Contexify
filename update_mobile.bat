@echo off
title Contexify - Instant Mobile Over-The-Air Update
echo ========================================================
echo    Contexify AI Mobile Instant Over-The-Air Update
echo ========================================================
echo.
echo Pushing updated code to your phone over-the-air...
echo (No APK download required!)
echo.

node scripts/update-mobile.js %*

pause
