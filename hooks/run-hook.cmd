: << 'CMDBLOCK'
@echo off
REM Cross-platform polyglot wrapper for hook scripts.
REM On Windows: cmd.exe runs the batch portion, which finds and calls node.
REM On Unix: the shell interprets this as a script (: is a no-op in bash).
REM
REM Hook scripts are .mjs files under lib/ (e.g. "lib/session-start.mjs").
REM
REM Usage: run-hook.cmd <hook-name> [args...]

if "%~1"=="" (
    echo run-hook.cmd: missing hook name >&2
    exit /b 1
)

set "SCRIPT_DIR=%~dp0"
set "PLUGIN_ROOT=%SCRIPT_DIR%.."
set "HOOK_NAME=%~1"
shift

REM Try node on PATH
where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    node "%PLUGIN_ROOT%\lib\%HOOK_NAME%.mjs" %1 %2 %3 %4 %5 %6 %7 %8
    exit /b %ERRORLEVEL%
)

REM No node found - exit silently
exit /b 0
CMDBLOCK

# Unix: dispatch to the corresponding .mjs file under lib/
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOOK_NAME="$1"
shift
exec node "${PLUGIN_ROOT}/lib/${HOOK_NAME}.mjs" "$@"
