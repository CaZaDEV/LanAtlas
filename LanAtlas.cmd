@echo off
rem LanAtlas: doble clic per engegar-lo i obrir-lo al navegador.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher.ps1" %*
