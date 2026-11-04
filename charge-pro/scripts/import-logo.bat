@echo off
REM ============================================================
REM  DENGE - Import de votre logo genere par Qwen (Windows)
REM  Usage : double-cliquez sur ce fichier, OU dans une fenetre
REM  cmd :  import-logo.bat  C:\ai\denge\mon-logo.png
REM ============================================================

REM 1) Image fournie en parametre ? sinon on cherche dans C:\ai\denge
set "IMG=%~1"
if "%IMG%"=="" (
    for %%E in (*.png *.jpg *.jpeg *.webp) do (
        if not defined IMG set "IMG=C:\ai\denge\%%E"
    )
)
if "%IMG%"=="" (
    echo AUCUNE IMAGE TROUVEE dans C:\ai\denge
    echo Mettez votre logo .png ou .jpg dans ce dossier puis relancez.
    pause
    exit /b 1
)

REM 2) Localiser le projet Denge (dossier charge-pro contenant scripts)
set "PROJ=%~dp0.."
if not exist "%PROJ%\scripts\import-logo.py" (
    echo ERREUR : scripts\import-logo.py introuvable a cote de ce .bat
    echo Placez ce fichier dans le dossier scripts du projet Denge.
    pause
    exit /b 1
)

REM 3) Lancer l'import avec python ou python3 selon l'installation
where python >nul 2>nul
if %errorlevel%==0 (
    python "%PROJ%\scripts\import-logo.py" "%IMG%"
) else (
    python3 "%PROJ%\scripts\import-logo.py" "%IMG%"
)
if errorlevel 1 (
    echo.
    echo Si Python est introuvable : installez-le depuis https://python.org
    echo puis relancez ce script.
)
echo.
pause
