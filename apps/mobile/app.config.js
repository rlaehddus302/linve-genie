// app.json 위에 빌드 스위치만 얹는다 (rel/android-build).
// LIVEGENIE_NOTICE: 휴대폰 알림 받기(문자찜·입금 알림 읽기, packages/mobile-notice).
//   on 일 때만 켠다. 그 밖(빈 값 포함)은 off — 1차 출시 빌드 기본값.
//   이유: Play SMS·통화 기록 정책의 "대체 방법으로 문자 데이터 얻기"로 거절될 위험. 정식 출시 뒤 업데이트로 넣는다.
//   off면 plugins/with-android-release.js가 알림 읽기 서비스·재부팅 수신기·권한을 매니페스트에서 빼고,
//   앱은 알림 받기 모듈을 끼우지 않고 설정 화면의 알림 받기 칸을 숨긴다(코드는 그대로).
//   prebuild와 gradle 빌드(앱 설정이 앱 안에 들어갈 때) 둘 다 같은 값으로 돌려야 한다.
module.exports = ({ config }) => ({
  ...config,
  extra: { ...config.extra, noticeIntake: process.env.LIVEGENIE_NOTICE === 'on' ? 'on' : 'off' },
})
