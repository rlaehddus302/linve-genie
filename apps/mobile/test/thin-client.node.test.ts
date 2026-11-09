// D-UX4-96 (사용자 지시 2026-11-10 "듣기라고 표현하지 말고 음성 인식이라고"): 권한·알림 문구의 '듣는 중'·'듣고'를 '음성 인식'으로, '방송'을 '라이브'로 바꿔 기대 글을 맞췄다.
// 얇은 클라이언트 확인 (APP-01 AC2·AC3): 앱 소스는 판정 엔진(@livejjim/core 전체)·음성 추출(@livejjim/voice)·라벨 그리기(@livejjim/label 실행 코드)를 가져오지 않고,
// 설정·빌드 결과에 받아쓰기 서버 주소·토큰·모델 이름이 없다. 빌드 결과(dist/*.hbc)가 있으면 그 안의 글자도 본다.
// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

/** 실행 코드 import만 (import type · export type은 지워진다) */
function runtimeImports(source: string): string[] {
  const out: string[] = []
  const re = /^\s*(?:import|export)\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]/gm
  for (const match of source.matchAll(re)) out.push(match[1]!)
  for (const match of source.matchAll(/import\(['"]([^'"]+)['"]\)/g)) out.push(match[1]!)
  return out
}

const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'app'))]

describe('앱 소스에 판정·추출·그리기 코드가 없다 (APP-01 AC3)', () => {
  // 옛 기대(APP-01 AC3): 코어는 입력 읽기(quick-input)·포맷(format)만. SRV1 새 기대(D-APP-23·24, AC-SRV1-05·13): 입력 읽기도 서버 — 포맷만
  it('@livejjim/core 전체·@livejjim/voice·@livejjim/label·@livejjim/printer를 실행 코드로 가져오지 않는다 — 코어는 포맷(format)만 (입력 읽기 quick-input도 없다)', () => {
    // 방송 소리로 듣기 문구(D-LIVETEST-02)는 웹 lib/stream-audio.ts — 서버 상태를 문장으로 바꾸는 순수 함수만
    // 가게 설정 화면(D-APPX-03)은 판매 규칙 값·기본값만 쓴다 — 판정·읽기 코드가 아니다
    const allowed = new Set(['@livejjim/core/format', '@livejjim/core/settings'])
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const spec of runtimeImports(source)) {
        if (spec === '@livejjim/core' || spec === '@livejjim/voice' || spec.startsWith('@livejjim/voice/') || spec === '@livejjim/label') throw new Error(`${file}: ${spec}를 실행 코드로 가져온다`)
        if (spec.startsWith('@livejjim/core/')) expect(allowed.has(spec), `${file}: ${spec}`).toBe(true)
        // 간편 로그인 문구·공급자 목록(D-UX3-28)은 웹 lib/social-login.ts·social-logos.ts — 글·로고 경로와 작은 함수만(client·kst·brand)
        // 영수증 문자 문구(D-REAL-03·05)는 웹 lib/receipt-sms.ts — 문장·작은 함수만(kst)
        // 웹 모듈 중 코어 전체를 끌어오는 것(lib/words·derive·scope-data·quick…)은 가져오지 않는다
        if (spec.startsWith('@livejjim/web/')) expect(['@livejjim/web/src/api/client.ts', '@livejjim/web/src/lib/kst.ts', '@livejjim/web/src/lib/social-login.ts', '@livejjim/web/src/lib/social-logos.ts', '@livejjim/web/src/lib/app-tab.ts', '@livejjim/web/src/lib/report.ts', '@livejjim/web/src/lib/deposit-words.ts', '@livejjim/web/src/lib/words.ts', '@livejjim/web/src/lib/customers.ts', '@livejjim/web/src/lib/schedule.ts', '@livejjim/web/src/lib/parcel-words.ts', '@livejjim/web/src/lib/packing-words.ts', '@livejjim/web/src/lib/receipt-links.ts', '@livejjim/web/src/lib/receipt-sms.ts', '@livejjim/web/src/lib/assist-words.ts', '@livejjim/web/src/lib/review-pick.ts', '@livejjim/web/src/lib/undo-queue.ts', '@livejjim/web/src/lib/settings-fields.ts', '@livejjim/web/src/lib/shop-words.ts', '@livejjim/web/src/lib/ledger-words.ts', '@livejjim/web/src/lib/save-bar.ts', '@livejjim/web/src/lib/platforms.ts', '@livejjim/web/src/lib/stream-audio.ts', '@livejjim/web/src/lib/import-words.ts'].includes(spec), `${file}: ${spec}`).toBe(true)
      }
    }
  })

  it('앱 소스·설정에 받아쓰기 서버 주소·토큰·모델 이름이 없다 (APP-01 AC2)', () => {
    const forbidden = [/cohere/i, /whisper/i, /varieties\.ko/i, /hf_[A-Za-z0-9]{10,}/, /WORKER_TOKEN/, /sk-[A-Za-z0-9]{20,}/]
    const configs = ['app.json', 'eas.json', 'package.json'].map((name) => join(ROOT, name))
    for (const file of [...files, ...configs]) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of forbidden) expect(pattern.test(source), `${file}: ${String(pattern)}`).toBe(false)
    }
    const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as { expo: { ios: { infoPlist: Record<string, unknown> }; android: { permissions: string[] }; extra: Record<string, unknown> } }
    expect(app.expo.ios.infoPlist['NSMicrophoneUsageDescription']).toBe('라이브 중 사장님 말(상품 번호·가격)을 음성 인식해 상품을 등록하려고 마이크를 써요.')
    expect(app.expo.ios.infoPlist['NSBluetoothAlwaysUsageDescription']).toBe('라벨 프린터에 연결해 라벨을 찍으려고 블루투스를 써요.')
    expect(app.expo.ios.infoPlist['UIBackgroundModes']).toEqual(['audio', 'bluetooth-central'])
    expect(app.expo.android.permissions).toEqual(expect.arrayContaining(['android.permission.FOREGROUND_SERVICE_MICROPHONE', 'android.permission.BLUETOOTH_CONNECT', 'android.permission.BLUETOOTH_SCAN', 'android.permission.POST_NOTIFICATIONS']))
    expect(JSON.stringify(app.expo.extra)).not.toMatch(/token|secret|password/i)
  })

  it('의존성에 @livejjim/voice가 없고 EAS 프로필 셋이 있다', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain('@livejjim/voice')
    for (const version of Object.values(pkg.dependencies)) expect(version, version).toMatch(/^(\d|workspace:)/)
    const eas = JSON.parse(readFileSync(join(ROOT, 'eas.json'), 'utf8')) as { build: Record<string, unknown> }
    expect(Object.keys(eas.build)).toEqual(['development', 'preview', 'production'])
  })

  it('빌드 결과가 있으면 그 안에도 받아쓰기 서버·모델·사전 글자가 없다', () => {
    const dir = join(ROOT, 'dist', '_expo', 'static', 'js')
    if (!existsSync(dir)) return
    for (const platform of readdirSync(dir)) {
      for (const name of readdirSync(join(dir, platform))) {
        const text = readFileSync(join(dir, platform, name), 'latin1')
        for (const pattern of [/cohere/i, /whisper/i, /varieties\.ko/i]) expect(pattern.test(text), `${platform}/${name}: ${String(pattern)}`).toBe(false)
      }
    }
  })
})

describe('밀어서 뒤로는 왼쪽 가장자리에서만 (D-UX3-24·58)', () => {
  it('앱 Stack은 화면 어디서나 밀기를 끄고, 화면마다 다시 켜지 않는다', () => {
    const layout = readFileSync(join(ROOT, 'app', '_layout.tsx'), 'utf8')
    expect(layout).toMatch(/<Stack screenOptions=\{\{[^}]*fullScreenGestureEnabled: false/)
    for (const file of walk(join(ROOT, 'app')).concat(walk(join(ROOT, 'src')))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/fullScreenGestureEnabled: true|fullScreenSwipeEnabled: true/)
    }
  })
})
