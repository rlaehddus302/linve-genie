// 빠르게 밀어 뒤로 가면 이전 화면이 오른쪽으로 들썩이던 것 (D-UX4-120, 사용자 지시 2026-11-10 "빠르게 스와이프로 뒤로가기 했을 때 페이지 오른쪽으로 들썩거리는 이슈"):
// 시뮬레이터 녹화로 잰 원인 — 넘김이 끝난 뒤 홈 화면 전체(탭 막대까지 같이)가 21px(7pt) 오른쪽으로 갔다가 약 250ms에 걸쳐 돌아왔다.
// iOS 26 기본 넘김(UINavigationController)이 손가락 속도를 스프링으로 이어받아 넘친 것(D-UX4-85의 자료 다시 받기와는 다른 원인).
// 고침 — 아이폰은 react-native-screens의 simple_push(충분히 감쇠한 스프링, 넘치지 않음)를 쓰고, 가장자리 밀기도 같은 넘김으로 한다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const layout = readFileSync(join(import.meta.dirname, '../app/_layout.tsx'), 'utf8')
const options = layout.slice(layout.indexOf('const STACK_OPTIONS = {'), layout.indexOf('\n} as const', layout.indexOf('const STACK_OPTIONS = {')))

describe('밀어 뒤로 가기 뒤 이전 화면이 넘치지 않는다 (D-UX4-120)', () => {
  it('아이폰 쌓인 화면은 simple_push + 밀기도 같은 넘김', () => {
    expect(options).toMatch(/Platform\.OS === 'ios' \? \{ animation: 'simple_push', animationMatchesGesture: true \}/)
    expect(layout).toContain('<Stack screenOptions={STACK_OPTIONS}')
  })

  it('가장자리에서만 밀기(D-UX3-24)와 머리 없음은 그대로', () => {
    expect(options).toContain('headerShown: false')
    expect(options).toContain('fullScreenGestureEnabled: false')
  })

  it('탭 화면끼리는 여전히 넘김 없이', () => {
    expect(layout).toContain("<Stack.Screen key={name} name={name} options={{ animation: 'none' }} />")
  })
})
