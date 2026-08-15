@echo off
setlocal
cd /d "%~dp0"

npx playwright test --config=playwright.rh.config.js --project=chromium --workers=1
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
