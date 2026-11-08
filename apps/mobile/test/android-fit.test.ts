// 안드로이드 실기기 고침 (D-UX3-67): 손맛 권한 · 키보드 피하기 · 단추 막대와 아래 탭
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { BUTTON_NAV_MIN_INSET, tabBarBottom } from '../src/ui/kit/app.tsx'
import { keyboardAvoidFor } from '../src/ui/kit/sheets.tsx'
import { SPACE } from '../src/ui/kit/tokens.ts'

const require = createRequire(import.meta.url)
const plugin = require('../plugins/with-android-release.js') as { REMOVED_PERMISSIONS: string[] }
const appJson = require('../app.json') as { expo: { android: { permissions: string[] } } }

describe('손맛(햅틱) 권한', () => {
  it('출시 빌드가 VIBRATE를 지우지 않고, 앱이 직접 적어 둔다', () => {
    expect(plugin.REMOVED_PERMISSIONS).not.toContain('android.permission.VIBRATE')
    expect(appJson.expo.android.permissions).toContain('android.permission.VIBRATE')
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
    expect(tabBarBottom(0)).toBe(SPACE.sm)
    expect(tabBarBottom(16)).toBe(SPACE.sm)
    expect(tabBarBottom(24)).toBe(10)
    expect(tabBarBottom(34)).toBe(20)
  })

  it('안드로이드 단추 막대(◁ ○ ▢)는 덮지 않고 그 위로 띄운다', () => {
    for (const inset of [BUTTON_NAV_MIN_INSET, 48, 56]) {
      expect(tabBarBottom(inset)).toBe(inset + SPACE.sm)
      expect(tabBarBottom(inset)).toBeGreaterThan(inset)
    }
  })
})
