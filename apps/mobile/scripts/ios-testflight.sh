#!/usr/bin/env bash
# 아이폰 앱을 TestFlight로 올린다 (D-REL-TF): 운영 서버 주소로 묶어 보관본(archive)을 만들고 App Store Connect에 바로 올린다.
# 같은 와이파이·케이블이 없어도 아이폰의 TestFlight 앱이 인터넷으로 받는다. 올린 뒤 애플 처리 5~30분, 내부 테스터는 심사 없이 받는다.
# 팀: 라이브지니 애플 개발자 팀(N62U2LAB66), 앱 ID kr.livegenie.app(안드로이드와 같다).
# 빌드 번호: 올릴 때마다 커야 해서 시각(YYYYMMDD.HHMM)으로 붙인다. 버전(0.1.x)은 app.json·Info.plist 그대로.
# 로그인: App Store Connect API 키가 있으면(ASC_KEY_PATH·ASC_KEY_ID·ASC_ISSUER_ID) 그걸로, 없으면 Xcode에 로그인한 계정으로.
# ios 폴더는 저장소에 없다(expo prebuild로 만든다) — Info.plist의 CFBundleVersion은 $(CURRENT_PROJECT_VERSION)이어야 시각 번호가 들어간다
set -euo pipefail
cd "$(dirname "$0")/../ios"
TEAM=N62U2LAB66
BUILD=$(date +%Y%m%d.%H%M)
OUT=build/testflight
AUTH=()
if [[ -n "${ASC_KEY_PATH:-}" && -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" ]]; then
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi
rm -rf "$OUT"
echo "보관본 만들기 (빌드 $BUILD)"
EXPO_PUBLIC_SERVER_URL=${EXPO_PUBLIC_SERVER_URL:-https://livegenie.kr} NODE_ENV=production xcodebuild \
  -workspace app.xcworkspace -scheme app -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -archivePath "$OUT/app.xcarchive" DEVELOPMENT_TEAM=$TEAM CURRENT_PROJECT_VERSION="$BUILD" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} archive | grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)"
echo "App Store Connect에 올리기"
xcodebuild -exportArchive -archivePath "$OUT/app.xcarchive" -exportOptionsPlist ../scripts/ExportOptions-testflight.plist \
  -exportPath "$OUT/export" -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} | grep -E "error:|Upload|EXPORT (SUCCEEDED|FAILED)|Uploaded"
echo "올림: 빌드 $BUILD — App Store Connect 처리 뒤 TestFlight에 뜬다"
