#!/usr/bin/env bash
# 케이블로 연결한 아이폰에 지금 코드를 바로 깐다 (D-REL-DEV): TestFlight(업로드 + 애플 처리 5~30분) 없이 몇 분.
# 운영 서버 주소로 묶은 Release 빌드를 라이브지니 팀(N62U2LAB66) 개발 서명으로 만들어 devicectl로 설치·실행한다.
# TestFlight로 깐 앱과 같은 앱 ID(kr.livegenie.app)라 그 자리에 덮어쓰고 로그인·자료는 그대로다.
# 화면 업데이트(D-OTA-01)를 계속 받도록 지문은 맥 미니와 같은 방식으로 미리 계산해 못 박는다.
# 처음 한 번은 Xcode가 이 아이폰을 팀 기기로 등록하고 개발 프로필을 새로 받는다(-allowProvisioningUpdates).
# 아이폰에서 "개발자 모드"가 꺼져 있으면 설정 > 개인정보 보호 및 보안 > 개발자 모드를 켜야 한다.
# 주의: 설치하는 순간 켜져 있던 운영 앱이 꺼졌다 다시 켜진다 — 방송·라벨 인쇄 중에는 돌리지 않는다.
# 쓰는 법: apps/mobile/scripts/ios-device.sh [기기 UDID]   (없으면 연결된 실제 아이폰 첫 대)
set -euo pipefail
cd "$(dirname "$0")/.."
TEAM=N62U2LAB66
UDID=${1:-$(xcrun devicectl list devices 2>/dev/null | awk '/physical/ && /connected/ {for(i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) {print $i; exit}}')}
[ -n "$UDID" ] || { echo "연결된 아이폰이 없어요 — 케이블을 꽂고 아이폰에서 '이 컴퓨터 신뢰'를 눌러 주세요"; exit 1; }
echo "기기 $UDID"
# 지문은 맥 미니가 화면 업데이트를 발행할 때 쓰는 값과 같아야 그 업데이트를 받는다. 이 맥에서 계산한 값은 저장소에 없는 파일
# (ios/Pods·ios/build·.xcode.env.local·packages/mobile-notice/ios/.build 등) 때문에 달라질 수 있다(2026-11-13 실제로 달랐다).
# LG_IOS_FP에 맥 미니의 값(맥 미니 ~/.livegenie-ci/built-ios)을 주면 그 값을 쓴다.
FP=${LG_IOS_FP:-$(npx expo-updates fingerprint:generate --platform ios | python3 -c 'import json,sys;print(json.load(sys.stdin)["hash"])')}
echo "앱 지문 $FP"
BUILD=$(date +%Y%m%d.%H%M)
OUT=ios/build/device
echo "빌드 $BUILD (Release, 운영 서버)"
cd ios
EXPO_UPDATES_FINGERPRINT_OVERRIDE="$FP" EXPO_PUBLIC_SERVER_URL=${EXPO_PUBLIC_SERVER_URL:-https://livegenie.kr} NODE_ENV=production \
  xcodebuild -workspace app.xcworkspace -scheme app -configuration Release -sdk iphoneos -destination "id=$UDID" \
  -derivedDataPath build/device DEVELOPMENT_TEAM=$TEAM CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION="$BUILD" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration build > build/device.log 2>&1 \
  || { grep -E "error:|BUILD FAILED" build/device.log | head -20; echo "전체 기록: apps/mobile/ios/build/device.log"; exit 1; }
cd ..
APP=$(ls -d "$OUT"/Build/Products/Release-iphoneos/*.app | head -1)
echo "설치 $APP"
xcrun devicectl device install app --device "$UDID" "$APP" | tail -3
xcrun devicectl device process launch --device "$UDID" kr.livegenie.app >/dev/null 2>&1 \
  && echo "아이폰에서 앱을 켰어요" || echo "설치 끝 — 아이폰에서 앱을 직접 켜 주세요(잠겨 있으면 못 켭니다)"
