// 회색 바탕 화면의 양옆 여백은 하나 (D-UX4-74, 사용자 지시 2026-11-10 "라이브 화면 안과 밖에서의 섹션 너비가 달라 … 섹션 너비 통일"):
// 흰 카드가 화면 끝에서 GUTTER(12, 토스 홈 카드)만큼 떨어진다. 탭 화면·쌓인 화면·설정·방송 화면의 바깥 스크롤 여백을 소스에서 확인한다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUTTER, SPACE } from '../src/ui/kit/tokens.ts'
import { SETTINGS_GUTTER } from '../src/screens/settings/Group.tsx'

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', 'src', path), 'utf8')

/** 회색 바탕 + 흰 카드 화면 — 바깥 스크롤 여백이 GUTTER여야 한다 */
const GRAY_SCREENS = [
  'screens/ConsoleScreen.tsx',
  'screens/HomeScreen.tsx',
  'screens/MoreScreen.tsx',
  'screens/BroadcastList.tsx',
  'screens/ParcelsScreen.tsx',
  'screens/PackingScreen.tsx',
  'screens/LabelsScreen.tsx',
  'screens/BuyersScreen.tsx',
  'screens/CustomersScreen.tsx',
  'screens/ReviewsScreen.tsx',
  'screens/SettingsScreen.tsx',
  'screens/ShopSettingsScreen.tsx',
  'screens/ScheduleScreen.tsx',
  'screens/VarietiesScreen.tsx',
  'screens/LinkedAccountsScreen.tsx',
  'ui/parts.tsx',
]

describe('회색 바탕 화면 양옆 여백 통일 (D-UX4-74)', () => {
  it('여백은 12 하나 — 설정도 같다', () => {
    expect(GUTTER).toBe(SPACE.md)
    expect(GUTTER).toBe(12)
    expect(SETTINGS_GUTTER).toBe(GUTTER)
  })

  it.each(GRAY_SCREENS)('%s: 바깥 스크롤 여백이 GUTTER', (path) => {
    const source = read(path)
    // 화면 바깥 스크롤 = style에 flex: 1이 있는 세로 ScrollView의 contentContainerStyle
    const outer = [...source.matchAll(/contentContainerStyle=\{\{([^}]*)\}\}/g)].flatMap((match) => {
      const start = source.lastIndexOf('<ScrollView', match.index)
      const head = start === -1 ? '' : source.slice(start, match.index)
      return head.includes('flex: 1') && !head.includes('horizontal') ? [match[1] ?? ''] : []
    })
    expect(outer.length).toBeGreaterThan(0)
    for (const style of outer) expect(style).toMatch(/paddingHorizontal: (GUTTER|SETTINGS_GUTTER)\b/)
  })

  it('회색 쌓인 화면(StackPage·SlidePage)도 GUTTER, 흰 화면은 그대로 16', () => {
    for (const path of ['ui/kit/stack-page.tsx', 'screens/console/parts.tsx']) expect(read(path)).toContain('paddingHorizontal: gray ? GUTTER : SPACE.lg')
  })
})
