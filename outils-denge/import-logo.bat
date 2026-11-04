@echo off
REM ============================================================
REM  DENGE - Import de votre logo genere par Qwen (Windows)
REM  1) Mettez votre image (mon-logo.png ou .jpg) dans CE dossier
REM  2) Double-cliquez sur ce fichier
REM ============================================================

set "HERE=%~dp0"

REM 1) Trouver l'image dans le dossier du .bat
set "IMG="
for %%E in ("%HERE%*.png" "%HERE%*.jpg" "%HERE%*.jpeg" "%HERE%*.webp") do (
    if not defined IMG if exist "%%E" set "IMG=%%E"
)
if "%IMG%"=="" (
    echo AUCUNE IMAGE TROUVEE dans %HERE%
    echo Copiez votre logo .png ou .jpg dans ce dossier, puis relancez.
    pause
    exit /b 1
)

REM 2) Python : essayer py launcher, python, python3
where py >nul 2>nul
if %errorlevel%==0 (
    py "%HERE%import-logo.py" "%IMG%"
    goto fin
)
where python >nul 2>nul
if %errorlevel%==0 (
    python "%HERE%import-logo.py" "%IMG%"
    goto fin
)
where python3 >nul 2>nul
if %errorlevel%==0 (
    python3 "%HERE%import-logo.py" "%IMG%"
    goto fin
)

echo PYTHON INTROUVABLE. Installez Python depuis https://python.org
echo (cochez "Add Python to PATH" pendant l'installation), puis relancez.
pause
exit /b 1

:fin
if errorlevel 1 (
    echo.
    echo Si erreur "No module named PIL", lancez :  pip install pillow
)
echo.
pause
