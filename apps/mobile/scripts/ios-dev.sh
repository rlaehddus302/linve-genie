#!/usr/bin/env bash
# 개발 모드 (D-REL-DEV): 코드를 저장하면 1~2초 안에 아이폰 화면이 바뀐다(빠른 새로 고침).
# 아이폰에 "라이브지니 개발" 앱(kr.livegenie.app.dev — 운영 앱과 따로 깔린다)을 두고, 이 맥의 Metro에서 화면 코드를 받는다.
# - 운영 앱(TestFlight·ios-device.sh)은 건드리지 않는다. 개발 앱은 따로 로그인한다.
# - 서버는 운영 서버(https://livegenie.kr)가 기본 — 실제 자료다. 연습 서버는 EXPO_PUBLIC_SERVER_URL=http://<이 맥 IP>:3000.
# - 아이폰과 이 맥이 같은 와이파이여야 한다(케이블만으로는 Metro에 못 붙는다). 처음 켤 때 "로컬 네트워크" 허용을 눌러야 한다.
# - 네이티브(Swift·Pods·app.json 플러그인)가 바뀌면 --install로 개발 앱을 다시 만든다. 화면 코드만이면 그대로.
# 쓰는 법: apps/mobile/scripts/ios-dev.sh [--install] [기기 UDID]
#   개발 앱이 없으면 먼저 만들어 깔고(처음 4분 안팎), Metro를 켠다. 끄려면 Ctrl+C.
#   앱은 저절로 켜지 않는다(방송 중 화면을 빼앗지 않게) — 아이폰에서 '라이브지니 개발'을 직접 켠다.
#   실제 방송·라벨 인쇄는 운영 앱으로만(개발 앱은 맥·와이파이가 끊기면 멈춘다).
#   Metro 창에서 r = 다시 불러오기. 아이폰을 흔들면 개발 메뉴(번들 주소 바꾸기 포함).
set -euo pipefail
cd "$(dirname "$0")/.."
TEAM=N62U2LAB66
DEV_ID=kr.livegenie.app.dev
DEV_NAME="라이브지니 개발"
INSTALL=no
[ "${1:-}" = --install ] && { INSTALL=yes; shift; }
UDID=${1:-$(xcrun devicectl list devices 2>/dev/null | awk '/physical/ && /connected/ {for(i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) {print $i; exit}}')}
SERVER=${EXPO_PUBLIC_SERVER_URL:-https://livegenie.kr}

if [ -n "$UDID" ] && [ "$INSTALL" = no ]; then
  J=$(mktemp)
  xcrun devicectl device info apps --device "$UDID" --bundle-id "$DEV_ID" --json-output "$J" >/dev/null 2>&1 || true
  python3 -c 'import json,sys;sys.exit(0 if json.load(open(sys.argv[1]))["result"]["apps"] else 1)' "$J" 2>/dev/null || INSTALL=yes
  rm -f "$J"
fi

if [ "$INSTALL" = yes ]; then
  [ -n "$UDID" ] || { echo "연결된 아이폰이 없어요 — 케이블을 꽂고 아이폰에서 '이 컴퓨터 신뢰'를 눌러 주세요"; exit 1; }
  echo "개발 앱 만들기 (기기 $UDID)"
  ( cd ios && xcodebuild -workspace app.xcworkspace -scheme app -configuration Debug -sdk iphoneos -destination "id=$UDID" \
      -derivedDataPath build/dev DEVELOPMENT_TEAM=$TEAM CODE_SIGN_STYLE=Automatic PRODUCT_BUNDLE_IDENTIFIER=$DEV_ID \
      -allowProvisioningUpdates -allowProvisioningDeviceRegistration build > build/dev.log 2>&1 ) \
    || { grep -E "error:|BUILD FAILED" ios/build/dev.log | head -20; echo "전체 기록: apps/mobile/ios/build/dev.log"; exit 1; }
  APP=$(ls -d ios/build/dev/Build/Products/Debug-iphoneos/*.app | head -1)
  # 홈 화면 이름만 바꾸고 같은 인증서·권한으로 다시 서명한다(Info.plist는 운영과 같은 것을 쓴다 — 앱 지문 그대로)
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $DEV_NAME" "$APP/Info.plist"
  ID=$(codesign -dvv "$APP" 2>&1 | sed -n 's/^Authority=\(Apple Development: .*\)$/\1/p' | head -1)
  codesign -d --entitlements - --xml "$APP" > ios/build/dev-ents.plist 2>/dev/null
  codesign -f -s "$ID" --entitlements ios/build/dev-ents.plist --generate-entitlement-der "$APP" 2>/dev/null
  xcrun devicectl device install app --device "$UDID" "$APP" >/dev/null
  echo "개발 앱 설치 끝 — 아이폰 홈 화면의 '$DEV_NAME'"
fi

echo "Metro 켜기 — 서버 $SERVER · 이 맥 $(ipconfig getifaddr en0 || ipconfig getifaddr en1 || echo '?'):8081"
EXPO_PUBLIC_SERVER_URL="$SERVER" exec npx expo start --port 8081
