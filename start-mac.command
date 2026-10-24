#!/bin/bash
# 더블클릭으로 한끼 최저가 서버를 켜고 브라우저를 엽니다
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 가 설치되어 있지 않습니다. 열리는 사이트에서 LTS 버전을 설치한 뒤 다시 실행해 주세요."
  open "https://nodejs.org"
  read -n 1 -s -r -p "아무 키나 누르면 닫힙니다"
  exit 1
fi
node server.js --open
