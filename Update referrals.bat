@echo off
REM Double-click this file to pull the latest referrals from the website
REM and rebuild the Obsidian vault. No VS Code or typing needed.

cd /d "%~dp0"

echo ============================================================
echo  Step 1 of 2: downloading new referrals from the website...
echo ============================================================
python pull_referrals.py
if errorlevel 1 goto failed

echo.
echo ============================================================
echo  Step 2 of 2: rebuilding the Obsidian vault...
echo ============================================================
python obsidian_export\build_vault.py
if errorlevel 1 goto failed

echo.
echo ============================================================
echo  Done. Open the vault in Obsidian:
echo  obsidian_export\obsidian-vault
echo ============================================================
echo.
echo Press any key to close.
pause >nul
exit /b 0

:failed
echo.
echo ************************************************************
echo  Something went wrong. Take a screenshot of the red text
echo  above and send it over.
echo ************************************************************
echo.
echo Press any key to close.
pause >nul
exit /b 1
