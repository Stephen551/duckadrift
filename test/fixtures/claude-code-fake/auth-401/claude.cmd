@echo off
node "%~dp0emit.mjs" %*
exit /b %errorlevel%
