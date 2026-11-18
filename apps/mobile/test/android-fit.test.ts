// 안드로이드 실기기 고침 (D-UX3-67·68): 손맛 권한 · 키보드 피하기 · 단추·제스처 막대와 아래 탭
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUTTON_NAV_MIN_INSET, TAB_BAR_SHADOW, headerTop, tabBarBottom, tabBarSide } from '../src/ui/kit/app.tsx'
import { keyboardAvoidFor } from '../src/ui/kit/sheets.tsx'
import { MAX_FONT_SCALE, SPACE } from '../src/ui/kit/tokens.ts'

const require = createRequire(import.meta.url)
const plugin = require('../plugins/with-android-release.js') as { REMOVED_PERMISSIONS: string[] }
const appJson = require('../app.json') as { expo: { android: { permissions: string[] } } }

describe('손맛(햅틱) 권한', () => {
  it('출시 빌드가 VIBRATE를 지우지 않고, 앱이 직접 적어 둔다', () => {
    expect(plugin.REMOVED_PERMISSIONS).not.toContain('android.permission.VIBRATE')
    expect(appJson.expo.android.permissions).toContain('android.permission.VIBRATE')
  })
})

describe('출력 기기 백그라운드 인쇄 서비스 권한 (D-PRN-FGS-01)', () => {
  const library = readFileSync(join(__dirname, '../../../packages/mobile-ble/android/src/main/AndroidManifest.xml'), 'utf8')
  const appManifest = readFileSync(join(__dirname, '../android/app/src/main/AndroidManifest.xml'), 'utf8')
  // 서비스가 쓰는 권한: connectedDevice 종류 포그라운드 서비스 + 머리 없는 JS 작업의 깨어 있기 잠금 — 지우면 안드로이드 14+에서 프린터를 잇자마자 앱이 꺼진다
  const needed = ['android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE', 'android.permission.WAKE_LOCK']

  it('모듈이 connectedDevice 서비스와 그 권한을 선언한다', () => {
    expect(library).toContain('android:foregroundServiceType="connectedDevice"')
    for (const name of needed) expect(library).toContain(`android:name="${name}"`)
  })

  it('출시 빌드 플러그인과 앱 매니페스트가 그 권한을 지우지 않는다', () => {
    for (const name of needed) {
      expect(plugin.REMOVED_PERMISSIONS).not.toContain(name)
      expect(appManifest).not.toMatch(new RegExp(`android:name="${name.replace(/\./g, '\\.')}"[^>]*tools:node="remove"`))
    }
  })
})

describe('키보드 피하기', () => {
  it('아이폰·안드로이드 모두 padding, 웹은 없음', () => {
    expect(keyboardAvoidFor('ios')).toBe('padding')
    expect(keyboardAvoidFor('android')).toBe('padding')
    expect(keyboardAvoidFor('web')).toBeUndefined()
  })
})

describe('아래 탭과 기기 아래 막대', () => {
  it('홈 막대·제스처 막대는 그 자리까지 내려 앉는다 (D-UX3-41 그대로)', () => {
    expect(tabBarBottom(0, 'ios')).toBe(SPACE.sm)
    expect(tabBarBottom(16, 'ios')).toBe(SPACE.sm)
    expect(tabBarBottom(34, 'ios')).toBe(20)
  })

  it('안드로이드 제스처 막대는 덮지 않고 그 위로 띄운다 (D-UX3-68)', () => {
    for (const inset of [0, 16, 24, 34]) {
      expect(tabBarBottom(inset, 'android')).toBe(inset + SPACE.sm)
    }
  })

  it('안드로이드 단추 막대(◁ ○ ▢)는 덮지 않고 그 위로 띄운다', () => {
    for (const inset of [BUTTON_NAV_MIN_INSET, 48, 56]) {
      for (const os of ['ios', 'android']) {
        expect(tabBarBottom(inset, os)).toBe(inset + SPACE.sm)
        expect(tabBarBottom(inset, os)).toBeGreaterThan(inset)
      }
    }
  })
})

describe('아래 탭 그림자 (D-UX3-71)', () => {
  it('안드로이드 elevation 대신 boxShadow 하나로 — 위쪽으로 아주 옅게', () => {
    expect(TAB_BAR_SHADOW).toBe('0px -4px 8px rgba(0, 0, 0, 0.03)')
    const source = readFileSync(join(import.meta.dirname, '../src/ui/kit/app.tsx'), 'utf8')
    const tabBar = source.slice(source.indexOf('export function TabBar('), source.indexOf('/** 큰 초록 카드 버튼'))
    expect(tabBar).toContain('boxShadow: TAB_BAR_SHADOW')
    expect(tabBar).not.toMatch(/elevation:|shadowOpacity:|SHADOW\./)
  })
})

describe('안드로이드 위 여백·아래 탭 너비·큰 글자 (D-ANDTOP-01, D-TABFIT-01, D-FONTCAP-01)', () => {
  it('머리 줄은 안드로이드에서만 상태 막대 아래로 12 더 띄운다', () => {
    expect(headerTop('android')).toBe(SPACE.md)
    expect(headerTop('ios')).toBe(0)
  })

  it('좁은 화면(400 미만)은 아래 탭 양옆을 12로 줄이고, 넓은 화면은 20 그대로', () => {
    expect(tabBarSide(360)).toBe(SPACE.md)
    expect(tabBarSide(393)).toBe(SPACE.md)
    expect(tabBarSide(430)).toBe(SPACE.xl)
    expect(tabBarSide(0)).toBe(SPACE.xl)
  })

  it('아래 탭 글자는 시스템 큰 글자를 따르지 않는다', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/ui/kit/app.tsx'), 'utf8')
    const tabBar = source.slice(source.indexOf('export function TabBar('), source.indexOf('/** 큰 초록 카드 버튼'))
    expect(tabBar).toMatch(/<Txt step="tab"[^>]*\bfixed\b/)
  })

  it('시스템 큰 글자는 1.15배까지만 따른다', () => {
    expect(MAX_FONT_SCALE).toBe(1.15)
  })
})
