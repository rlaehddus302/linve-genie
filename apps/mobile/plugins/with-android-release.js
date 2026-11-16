// 안드로이드 출시 빌드 설정 플러그인 (rel/android-build).
// `npx expo prebuild -p android --clean`이 만드는 android/ 폴더는 커밋하지 않으므로,
// 손으로 고칠 것(권한 정리·업로드 서명)은 모두 여기서 다시 만든다.
//
// 1) 권한 정리 (구글 Play 정책)
//    - BLUETOOTH_SCAN: neverForLocation — 블루투스로 위치를 알아내지 않는다.
//    - 위치(ACCESS_FINE_LOCATION): 안드로이드 11(API 30) 이하에서만. 12+는 SCAN·CONNECT만 묻는다(src/native/production.tsx).
//      ACCESS_COARSE_LOCATION은 쓰지 않으므로 뺀다(라이브러리 매니페스트에서 합쳐져도 tools:node="remove").
//    - BLUETOOTH·BLUETOOTH_ADMIN: 옛 권한이라 API 30 이하에서만.
//    - REMOVED_PERMISSIONS: 앱이 쓰지 않는 권한(라이브러리가 끼워 넣어도 뺀다). VIBRATE는 손맛(햅틱)이 써서 남긴다(D-UX3-67).
//    - 알림 받기 스위치(LIVEGENIE_NOTICE, app.config.js): off면 알림 읽기 서비스·재부팅 수신기·RECEIVE_BOOT_COMPLETED를 뺀다.
//    - 문자 직접 받기 스위치(LIVEGENIE_SMS, app.config.js, SMS4): on일 때만 READ_SMS·RECEIVE_SMS와 새 문자 수신기를 앱 매니페스트에 넣는다.
//      모듈 매니페스트(packages/mobile-notice)에는 두 권한이 없다 — off 빌드에는 아예 들어가지 않고, 다른 라이브러리가 넣어도 지운다.
//      Play SMS 권한 정책 — 기본 문자 앱이 아니면 '민감한 권한 선언'으로 예외 승인을 받아야 한다(D-SMS4-05). 알림 받기가 off면 문자도 off(같은 대기열을 쓴다).
// 2) 업로드 서명: 저장소 밖 속성 파일(storeFile·storePassword·keyAlias·keyPassword)을 읽는다.
//    경로 = 환경변수 LIVEJJIM_UPLOAD_PROPERTIES → gradle 속성 livejjimUploadProperties → ~/.livejjim-release/upload.properties.
//    파일이 없으면 출시(release) 작업을 멈춘다 — 개발용 열쇠로 서명된 파일을 사장님 폰·Play에 잘못 올리지 않게.
// 3) 코드 줄이기(R8) 지킴 규칙: 출시 빌드는 R8로 코드를 줄인다. WorkManager가 안에서 쓰는 Room 데이터베이스(WorkDatabase_Impl)는
//    리플렉션으로 만들어서 R8이 생성자를 지우면 앱이 켜자마자 꺼진다(2026-11-01 연습 APK 0.1.2·0.1.3 실측, D-APPX-02).
const { withAndroidManifest, withAppBuildGradle, withDangerousMod, AndroidConfig } = require('expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const LEGACY_MAX_SDK = '30'

/** 쓰지 않는 권한 — 이름이 매니페스트에 들어와도 지운다 */
const REMOVED_PERMISSIONS = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  // VIBRATE는 지우지 않는다 — 안드로이드 손맛(expo-haptics)이 진동기를 써서 이 권한이 없으면 아무 느낌이 없다(D-UX3-67)
  // FOREGROUND_SERVICE_CONNECTED_DEVICE·WAKE_LOCK은 지우지 않는다 — 출력 기기 백그라운드 인쇄 서비스(packages/mobile-ble PrintStationService,
  // connectedDevice 종류 + 머리 없는 JS 작업의 깨어 있기)가 쓴다. 지우면 안드로이드 14+에서 프린터를 잇자마자 앱이 꺼진다(D-PRN-FGS-01)
]

const SDK23_LOCATION = ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION']

/** 이름 → 덮어쓸 속성 (tools:node="replace"로 라이브러리 것보다 앞선다) */
const PERMISSION_OVERRIDES = {
  'android.permission.BLUETOOTH_SCAN': { 'android:usesPermissionFlags': 'neverForLocation', 'tools:targetApi': '31' },
  'android.permission.BLUETOOTH_CONNECT': { 'tools:targetApi': '31' },
  'android.permission.BLUETOOTH': { 'android:maxSdkVersion': LEGACY_MAX_SDK },
  'android.permission.BLUETOOTH_ADMIN': { 'android:maxSdkVersion': LEGACY_MAX_SDK },
  'android.permission.ACCESS_FINE_LOCATION': { 'android:maxSdkVersion': LEGACY_MAX_SDK },
}

/** 알림 받기를 뺀 빌드(LIVEGENIE_NOTICE=off, app.config.js의 extra.noticeIntake)에서 지우는 것 — packages/mobile-notice 매니페스트 */
const NOTICE_SERVICE = 'com.livejjim.notice.NoticeListenerService'
const NOTICE_BOOT_RECEIVER = 'com.livejjim.notice.NoticeBootReceiver'
const NOTICE_PERMISSIONS = ['android.permission.RECEIVE_BOOT_COMPLETED']

/** 문자 직접 받기(LIVEGENIE_SMS=on, extra.smsIntake)에서만 넣는 것 — 수신기 클래스는 packages/mobile-notice SmsLink.kt (SMS4) */
const SMS_RECEIVER = 'com.livejjim.notice.SmsReceivedReceiver'
const SMS_PERMISSIONS = ['android.permission.READ_SMS', 'android.permission.RECEIVE_SMS']

/** on: 두 권한 + 새 문자 수신기(BROADCAST_SMS를 가진 시스템만 보낼 수 있다) · off: 수신기를 지운다(권한은 normalizePermissions가 지운다) */
function applySmsIntake(manifest, on) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest)
  const others = (app.receiver ?? []).filter((item) => item.$['android:name'] !== SMS_RECEIVER)
  if (!on) {
    app.receiver = [...others, { $: { 'android:name': SMS_RECEIVER, 'tools:node': 'remove' } }]
    return manifest
  }
  const root = manifest.manifest
  const listed = new Set((root['uses-permission'] ?? []).map((item) => item.$['android:name']))
  root['uses-permission'] = [...(root['uses-permission'] ?? []), ...SMS_PERMISSIONS.filter((name) => !listed.has(name)).map((name) => ({ $: { 'android:name': name } }))]
  app.receiver = [
    ...others,
    {
      $: { 'android:name': SMS_RECEIVER, 'android:exported': 'true', 'android:permission': 'android.permission.BROADCAST_SMS' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.provider.Telephony.SMS_RECEIVED' } }] }],
    },
  ]
  return manifest
}

function removeNoticeIntake(manifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest)
  const strip = (key, name) => {
    app[key] = [...(app[key] ?? []).filter((item) => item.$['android:name'] !== name), { $: { 'android:name': name, 'tools:node': 'remove' } }]
  }
  strip('service', NOTICE_SERVICE)
  strip('receiver', NOTICE_BOOT_RECEIVER)
  return manifest
}

function normalizePermissions(manifest, removed) {
  AndroidConfig.Manifest.ensureToolsAvailable(manifest)
  const root = manifest.manifest
  const listed = [...(root['uses-permission'] ?? []), ...(root['uses-permission-sdk-23'] ?? [])]
  const names = new Set(listed.map((item) => item.$['android:name']))
  for (const name of Object.keys(PERMISSION_OVERRIDES)) names.add(name)

  const next = []
  for (const name of names) {
    if (removed.includes(name)) continue
    const override = PERMISSION_OVERRIDES[name]
    next.push({ $: override ? { 'android:name': name, ...override, 'tools:node': 'replace' } : { 'android:name': name } })
  }
  for (const name of removed) next.push({ $: { 'android:name': name, 'tools:node': 'remove' } })
  root['uses-permission'] = next
  // rxandroidble(ble-plx 안)가 uses-permission-sdk-23으로 위치 권한을 상한 없이 넣는다 — 지운다.
  // API 30 이하는 위의 uses-permission(maxSdkVersion 30)이 맡는다.
  root['uses-permission-sdk-23'] = SDK23_LOCATION.map((name) => ({ $: { 'android:name': name, 'tools:node': 'remove' } }))
  return manifest
}

const SIGNING_MARK = '// livejjim-upload-signing'

const SIGNING_LOAD = `
${SIGNING_MARK}: 업로드 열쇠 속성 파일 (저장소 밖, 비밀번호를 여기 적지 않는다)
def livejjimUploadPropsPath = System.getenv("LIVEJJIM_UPLOAD_PROPERTIES") ?: (project.findProperty("livejjimUploadProperties") ?: "\${System.getProperty("user.home")}/.livejjim-release/upload.properties")
def livejjimUploadPropsFile = file(livejjimUploadPropsPath)
def livejjimUploadProps = new Properties()
if (livejjimUploadPropsFile.exists()) {
    livejjimUploadPropsFile.withInputStream { livejjimUploadProps.load(it) }
}
gradle.taskGraph.whenReady { graph ->
    def wantsRelease = graph.allTasks.any { it.project == project && it.name.toLowerCase().contains("release") && (it.name.startsWith("assemble") || it.name.startsWith("bundle") || it.name.startsWith("package")) }
    if (wantsRelease && !livejjimUploadPropsFile.exists()) {
        throw new GradleException("업로드 서명 속성 파일이 없어요: \${livejjimUploadPropsPath} (LIVEJJIM_UPLOAD_PROPERTIES로 경로를 알려 주세요)")
    }
}
`

const SIGNING_CONFIG = `
        upload {
            if (livejjimUploadPropsFile.exists()) {
                storeFile file(livejjimUploadProps.getProperty("storeFile"))
                storePassword livejjimUploadProps.getProperty("storePassword")
                keyAlias livejjimUploadProps.getProperty("keyAlias")
                keyPassword livejjimUploadProps.getProperty("keyPassword")
            }
        }`

function addUploadSigning(gradle) {
  if (gradle.includes(SIGNING_MARK)) return gradle
  let out = gradle.replace(/\nandroid\s*\{/, (m) => `${SIGNING_LOAD}${m}`)
  out = out.replace(/signingConfigs\s*\{/, (m) => `${m}${SIGNING_CONFIG}`)
  // release buildType의 서명만 바꾼다 (debug는 그대로 개발 열쇠)
  out = out.replace(/(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/, '$1signingConfig signingConfigs.upload')
  if (!out.includes('signingConfig signingConfigs.upload') || !out.includes(SIGNING_MARK)) {
    throw new Error('with-android-release: app/build.gradle 모양이 달라 업로드 서명을 넣지 못했어요')
  }
  return out
}

/** R8 지킴 규칙 (android/app/proguard-rules.pro 끝에 한 번만 붙인다) */
const KEEP_MARK = '# livejjim: R8 지킴 규칙 (with-android-release)'
const KEEP_RULES = `
${KEEP_MARK}
# WorkManager·Room: 데이터베이스 구현은 리플렉션으로 만든다 — 생성자를 지우면 시작하자마자 꺼진다
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
-keep class androidx.work.** { *; }
`

function addKeepRules(text) {
  return text.includes(KEEP_MARK) ? text : `${text.trimEnd()}\n${KEEP_RULES}`
}

module.exports = function withAndroidRelease(config) {
  const noticeOn = config.extra?.noticeIntake !== 'off'
  // 문자 직접 받기는 명시적으로 on일 때만 (기본 off)
  const smsOn = noticeOn && config.extra?.smsIntake === 'on'
  config = withAndroidManifest(config, (c) => {
    c.modResults = applySmsIntake(c.modResults, smsOn)
    const removed = [...REMOVED_PERMISSIONS, ...(noticeOn ? [] : NOTICE_PERMISSIONS), ...(smsOn ? [] : SMS_PERMISSIONS)]
    c.modResults = normalizePermissions(c.modResults, removed)
    if (!noticeOn) c.modResults = removeNoticeIntake(c.modResults)
    return c
  })
  config = withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') throw new Error('with-android-release: groovy build.gradle만 지원해요')
    c.modResults.contents = addUploadSigning(c.modResults.contents)
    return c
  })
  config = withDangerousMod(config, [
    'android',
    (c) => {
      const file = path.join(c.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro')
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
      fs.writeFileSync(file, addKeepRules(text))
      return c
    },
  ])
  return config
}

module.exports.addKeepRules = addKeepRules
module.exports.KEEP_MARK = KEEP_MARK

module.exports.REMOVED_PERMISSIONS = REMOVED_PERMISSIONS
module.exports.PERMISSION_OVERRIDES = PERMISSION_OVERRIDES
module.exports.SMS_PERMISSIONS = SMS_PERMISSIONS
