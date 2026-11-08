// app.json 위에 빌드 스위치만 얹는다 (rel/android-build).
// LIVEGENIE_NOTICE: 휴대폰 알림 받기(문자찜·입금 알림 읽기, packages/mobile-notice).
//   기본 on(D-REAL-02 — D-REL2-01을 바꿈: 출시 빌드부터 손님 문자를 실제로 받는다). off 일 때만 뺀다.
//   안드로이드는 알림 읽기(문자 권한 아님)로 받고, 켜기 전에 "문자와 은행 앱 알림만 보내요" 안내 한 장을 먼저 보인다.
//   아이폰은 단축어 자동화가 앱 동작 "라이브지니에 문자 보내기"를 부른다(D-REAL-01).
//   off면 plugins/with-android-release.js가 알림 읽기 서비스·재부팅 수신기·권한을 매니페스트에서 빼고,
//   앱은 알림 받기 모듈을 끼우지 않고 설정 화면의 알림 받기 칸을 숨긴다(코드는 그대로).
//   prebuild와 gradle 빌드(앱 설정이 앱 안에 들어갈 때) 둘 다 같은 값으로 돌려야 한다.
// LIVEGENIE_SMS: 문자 직접 받기(문자 저장소 읽기·새 문자 수신, SMS4). on 일 때만 켠다 — 기본 off(출시 빌드).
//   이유: Play SMS 권한 정책 — 기본 문자 앱이 아니면 READ_SMS·RECEIVE_SMS는 '민감한 권한 선언' 예외 승인이 있어야 한다(D-SMS4-05).
//   off(또는 LIVEGENIE_NOTICE가 off)면 plugins/with-android-release.js가 두 권한과 새 문자 수신기를 빼고, 설정의 "문자 연동" 칸이 숨는다.
//   연습 빌드: LIVEGENIE_NOTICE=on LIVEGENIE_SMS=on
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    noticeIntake: process.env.LIVEGENIE_NOTICE === 'off' ? 'off' : 'on',
    smsIntake: process.env.LIVEGENIE_NOTICE !== 'off' && process.env.LIVEGENIE_SMS === 'on' ? 'on' : 'off',
  },
})
