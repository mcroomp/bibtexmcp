@echo off
:: Install the BibTeX MCP server into Claude Code (user scope)
:: Run this once from any directory.

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
