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

REM 2) Localiser le projet Denge (dossier charge-pro a cote du depot git)
set "PROJ=%~dp0.."
if not exist "%PROJ%\scripts\import-logo.py" (
    echo ERREUR : dossier projet introuvable ^(%PROJ%^)
    echo Editez la ligne PROJ ci-dessus avec le chemin de votre copie du projet.
    pause
    exit /b 1
)

REM 3) Lancer l'import (Python doit etre installe : python.org)
python "%PROJ%\scripts\import-logo.py" "%IMG%"
if errorlevel 1 (
    echo.
    echo Si la commande python est introuvable : installez Python depuis https://python.org
    echo puis relancez ce script.
)
echo.
pause
