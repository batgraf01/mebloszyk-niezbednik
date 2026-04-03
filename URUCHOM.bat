@echo off
title Magazyn SuuHouse - z katalogu mag1
color 0B
cls

echo.
echo   ========================================
echo   MAGAZYN SUUHOUSE - SERWER FLASK
echo   ========================================
echo.
echo   Uruchamianie serwera z katalogu mag1...
echo.
echo   URL: http://localhost:5000/magazyn
echo.
echo   ========================================
echo.

cd /d "%~dp0"

REM Uruchom serwer w nowym oknie
start "Serwer Flask - Magazyn" cmd /k "python app.py"

REM Poczekaj 3 sekundy az serwer sie uruchomi
timeout /t 3 /nobreak >nul

REM Otworz przegladarke
start "" http://localhost:5000/magazyn

echo.
echo   Serwer uruchomiony w osobnym oknie!
echo   Mozesz zamknac to okno.
echo.
echo   Aby zatrzymac serwer, zamknij okno "Serwer Flask - Magazyn"
echo.
pause

