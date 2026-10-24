@echo off
chcp 65001 > nul
cd /d "%~dp0"
title 한끼 최저가
where node > nul 2> nul
if errorlevel 1 (
  echo.
  echo  Node.js 가 설치되어 있지 않습니다.
  echo  열리는 사이트에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행해 주세요.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node server.js --open
pause
