// D-SWIPE-01 (사용자 지시 2026-11-17 "상품 추가 화면에서 왼쪽 끝에서 스와이프 할 때만 뒤로 가야하는데, 어딜 스와이프해도 다 뒤로가지는 버그"):
// PanResponder의 x0은 잡기 전에는 0이라 가장자리 검사가 늘 참이었다. 손이 처음 닿은 자리(pageX)를 따로 기억해 그것으로 본다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GestureResponderEvent } from 'react-native'
import { describe, expect, it } from 'vitest'
import { edgeStartTracker, startsEdgeSwipe } from '../src/ui/kit/route-swipe.tsx'

const touch = (pageX: number, fingers = 1) => ({ nativeEvent: { pageX, touches: Array.from({ length: fingers }, () => ({ pageX })) } }) as unknown as GestureResponderEvent

describe('왼쪽 끝에서 시작한 밀기만 뒤로 (D-SWIPE-01)', () => {
  it('손이 처음 닿은 자리로 가장자리를 본다 — 화면 가운데에서 민 것은 뒤로가 아니다', () => {
    const start = edgeStartTracker()
    expect(start.onStart(touch(200))).toBe(false) // 손을 빼앗지 않는다(안쪽 단추·스크롤이 그대로 받는다)
    expect(startsEdgeSwipe(start.x(), 80, 0)).toBe(false)
    start.onStart(touch(10))
    expect(startsEdgeSwipe(start.x(), 20, 2)).toBe(true)
  })

  it('두 손가락이면 밀기로 보지 않는다, 아직 닿지 않았으면 가장자리가 아니다', () => {
    const start = edgeStartTracker()
    expect(startsEdgeSwipe(start.x(), 80, 0)).toBe(false)
    start.onStart(touch(5, 2))
    expect(startsEdgeSwipe(start.x(), 80, 0)).toBe(false)
  })

  it('상품 추가 단계 밀기·겹친 화면 밀기는 g.x0을 쓰지 않는다', () => {
    for (const file of ['../src/screens/console/ProductAdd.tsx', '../src/ui/kit/route-swipe.tsx']) {
      const code = readFileSync(join(import.meta.dirname, file), 'utf8')
      expect(code).not.toMatch(/startsEdgeSwipe\(g\.x0/)
      expect(code).toMatch(/onStartShouldSetPanResponderCapture: start\.onStart/)
    }
  })
})
