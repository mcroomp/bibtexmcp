@echo off
:: Install the BibTeX MCP server into Claude Code (user scope)
:: Run this once from any directory.

:: Check for Node.js and install via winget if missing
node --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Node.js not found. Installing via winget...
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    if %ERRORLEVEL% neq 0 (
        echo Failed to install Node.js. Install it manually from https://nodejs.org and re-run this script.
        exit /b 1
    )
    echo Node.js installed. You may need to restart your terminal for PATH changes to take effect.
    echo Re-run this script after restarting.
    exit /b 0
)

set SCRIPT_DIR=%~dp0
set SERVER=%SCRIPT_DIR%src\index.js

echo Installing bibtex MCP server...
echo   Server: %SERVER%
echo.

claude mcp add --scope user bibtex -- node "%SERVER%"

if %ERRORLEVEL% equ 0 (
    echo.
    echo Done. Verify with:  claude mcp get bibtex
) else (
    echo.
    echo Install failed. Is 'claude' on your PATH?
    exit /b 1
)
