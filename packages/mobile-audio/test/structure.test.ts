// D-UX4-96 (사용자 지시 2026-11-10 "듣기라고 표현하지 말고 음성 인식이라고"): 권한·알림 문구의 '듣는 중'·'듣고'를 '음성 인식'으로, '방송'을 '라이브'로 바꿔 기대 글을 맞췄다.
// 네이티브는 여기서 빌드하지 못한다 — 파일 구조·권한 선언·문장·비밀 없음·소리 저장 없음을 소스 검사로 확인한다
// (APP-01 AC2, APP-02 고정 알림·D-APP-11, D-APP-03, D-APP-04).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANDROID_PERMISSIONS, IOS_INFO_PLIST, LISTENING_NOTIFICATION_LINE, LISTENING_NOTIFICATION_TEXT, LISTENING_NOTIFICATION_TITLE, MIC_PERMISSION_MESSAGE, NOTIFICATION_PERMISSION_MESSAGE } from '../src/index.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

describe('Expo 모듈 구조', () => {
  it('expo-module.config.json: 안드로이드·아이폰 모듈 이름이 Kotlin·Swift 클래스와 같다', () => {
    const config = JSON.parse(read('expo-module.config.json')) as { platforms: string[]; android: { modules: string[] }; ios: { modules: string[] } }
    expect(config.platforms).toEqual(['android', 'ios'])
    expect(config.android.modules).toEqual(['com.livejjim.audio.LivejjimAudioModule'])
    expect(config.ios.modules).toEqual(['LivejjimAudioModule'])
    const kotlin = read('android', 'src', 'main', 'java', 'com', 'livejjim', 'audio', 'LivejjimAudioModule.kt')
    expect(kotlin).toContain('package com.livejjim.audio')
    expect(kotlin).toContain('class LivejjimAudioModule : Module()')
    expect(kotlin).toContain('Name("LivejjimAudio")')
    const swift = read('ios', 'LivejjimAudioModule.swift')
    expect(swift).toContain('public class LivejjimAudioModule: Module')
    expect(swift).toContain('Name("LivejjimAudio")')
    // JS가 쓰는 이름과 같다
    expect(read('src', 'native.ts')).toContain("NATIVE_MODULE_NAME = 'LivejjimAudio'")
    expect(existsSync(join(ROOT, 'ios', 'LivejjimAudio.podspec'))).toBe(true)
    expect(read('ios', 'LivejjimAudio.podspec')).toContain("s.dependency 'ExpoModulesCore'")
    expect(read('android', 'build.gradle')).toContain("apply plugin: 'expo-module-gradle-plugin'")
  })

  it('네이티브 양쪽이 같은 사건 이름(frame·state)과 같은 함수(start·stop·getPermission·requestPermission)를 낸다', () => {
    const kotlin = read('android', 'src', 'main', 'java', 'com', 'livejjim', 'audio', 'LivejjimAudioModule.kt')
    const swift = read('ios', 'LivejjimAudioModule.swift')
    for (const source of [kotlin, swift]) {
      expect(source).toContain('Events("frame", "state")')
      for (const fn of ['start', 'stop', 'getPermission', 'requestPermission']) expect(source).toContain(`AsyncFunction("${fn}")`)
      expect(source).toContain('"capturedAtMs"')
      expect(source).toContain('"pcm"')
    }
  })
})

describe('안드로이드 선언 (APP-02 포그라운드 서비스·D-APP-11)', () => {
  const manifest = read('android', 'src', 'main', 'AndroidManifest.xml')

  it('권한: RECORD_AUDIO·FOREGROUND_SERVICE·FOREGROUND_SERVICE_MICROPHONE·POST_NOTIFICATIONS — JS 상수와 같다', () => {
    for (const permission of ANDROID_PERMISSIONS) expect(manifest).toContain(`<uses-permission android:name="${permission}" />`)
    // 위치 권한처럼 필요 없는 권한은 없다
    expect(manifest).not.toMatch(/ACCESS_(FINE|COARSE)_LOCATION|BLUETOOTH|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/)
  })

  it('서비스: 마이크 종류 포그라운드 서비스, 밖에 드러내지 않음', () => {
    expect(manifest).toContain('android:name="com.livejjim.audio.LivejjimAudioService"')
    expect(manifest).toContain('android:foregroundServiceType="microphone"')
    expect(manifest).toContain('android:exported="false"')
    const service = read('android', 'src', 'main', 'java', 'com', 'livejjim', 'audio', 'LivejjimAudioService.kt')
    expect(service).toContain('FOREGROUND_SERVICE_TYPE_MICROPHONE')
    expect(service).toContain('AudioRecord(')
    expect(service).toContain('SAMPLE_RATE = 16000')
    expect(service).toContain('BYTES_PER_MS = 32')
    expect(service).toContain('ENCODING_PCM_16BIT')
    expect(service).toContain('CHANNEL_IN_MONO')
  })

  it('고정 알림: 끄기 단추 없음(눌러서 돌아가기만), 기본 문장은 "라이브지니 · 음성 인식 중 · 눌러서 돌아가기"', () => {
    const service = read('android', 'src', 'main', 'java', 'com', 'livejjim', 'audio', 'LivejjimAudioService.kt')
    const module = read('android', 'src', 'main', 'java', 'com', 'livejjim', 'audio', 'LivejjimAudioModule.kt')
    expect(service).toContain('setOngoing(true)')
    expect(service).toContain('setContentIntent(tap)')
    expect(service).not.toContain('addAction(')
    expect(LISTENING_NOTIFICATION_LINE).toBe('라이브지니 · 음성 인식 중 · 눌러서 돌아가기')
    expect(module).toContain(`"${LISTENING_NOTIFICATION_TITLE}"`)
    expect(module).toContain(`"${LISTENING_NOTIFICATION_TEXT}"`)
    expect(service).toContain(`"${LISTENING_NOTIFICATION_TITLE}"`)
    expect(service).toContain(`"${LISTENING_NOTIFICATION_TEXT}"`)
  })

  it('stop 동작이 서비스를 멈추고 알림을 거둔다 (APP-02 AC2)', () => {
    const service = read('android', 'src', 'main', 'java', 'com', 'livejjim', 'audio', 'LivejjimAudioService.kt')
    expect(service).toContain('ACTION_STOP ->')
    expect(service).toContain('stopForegroundCompat()')
    expect(service).toContain('stopSelf()')
    expect(service).toContain('STOP_FOREGROUND_REMOVE')
  })
})

describe('아이폰 선언 (APP-02 백그라운드 오디오·D-APP-11)', () => {
  it('앱 Info.plist 값: 마이크 설명 문장 그대로 + UIBackgroundModes audio', () => {
    expect(IOS_INFO_PLIST.NSMicrophoneUsageDescription).toBe('라이브 중 사장님 말(상품 번호·가격)을 음성 인식해 상품을 등록하려고 마이크를 써요.')
    expect(MIC_PERMISSION_MESSAGE).toBe(IOS_INFO_PLIST.NSMicrophoneUsageDescription)
    expect([...IOS_INFO_PLIST.UIBackgroundModes]).toEqual(['audio'])
    expect(NOTIFICATION_PERMISSION_MESSAGE).toBe('음성 인식 중이라는 알림을 보여 드리려고 해요.')
  })

  it('PcmCapture: 16kHz Int16 모노 변환, 끼어들기 알림 처리, 세션 .playAndRecord', () => {
    const swift = read('ios', 'PcmCapture.swift')
    expect(swift).toContain('static let sampleRate = 16000')
    expect(swift).toContain('static let bytesPerMs = 32')
    expect(swift).toContain('.pcmFormatInt16')
    expect(swift).toContain('channels: 1')
    expect(swift).toContain('AVAudioConverter(')
    expect(swift).toContain('AVAudioSession.interruptionNotification')
    expect(swift).toContain('AVAudioSession.routeChangeNotification')
    expect(swift).toContain('setCategory(.playAndRecord')
    expect(swift).toContain('installTap(onBus: 0')
  })
})

describe('비밀·소리 저장 없음 (APP-01 AC2, D-APP-03, D-APP-04)', () => {
  const files = walk(ROOT).filter((f) => !f.includes('/test/') && /\.(ts|kt|swift|json|gradle|podspec|md)$/.test(f))

  it('받아쓰기 서버 주소·일꾼 토큰·일꾼 경로·환경변수 이름이 소스에 없다', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/\/api\/voice\/worker/)
      expect(text, file).not.toMatch(/LIVEJJIM_TRANSCRIBE_WORKER_TOKEN|Bearer\s/)
      expect(text, file).not.toMatch(/wss?:\/\/(?!example\.invalid)[a-z0-9.-]+\.[a-z]{2,}/i)
    }
  })

  it('네이티브·JS가 소리를 파일·로그에 쓰지 않는다', () => {
    const native = files.filter((f) => /\.(kt|swift)$/.test(f))
    for (const file of native) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/FileOutputStream|openFileOutput|\.write\(.*pcm|FileManager|AVAudioFile|Data\(contentsOf|\.write\(to:/)
      // 로그 줄에 소리 바이트·base64가 들어가지 않는다 (셈만)
      for (const line of text.split('\n').filter((l) => /Log\.|NSLog\(|println\(|print\(/.test(l))) {
        expect(line, file).not.toMatch(/pcm|frame\b|base64|Base64/)
      }
    }
    const js = files.filter((f) => f.endsWith('.ts'))
    for (const file of js) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/console\.|localStorage|AsyncStorage|writeFile/)
    }
  })
})
