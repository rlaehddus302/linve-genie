// 아이폰 쌓인 화면은 휴대폰 기본 넘김 그대로 (D-UX4-121, 사용자 지시 2026-11-10 사진 "뭘 고쳤길래 뒤로갈 때 화면이 저렇게 1자가 됐어? 원랜 안 이랬잖아"):
// D-UX4-120에서 빠른 밀기 뒤 들썩임(7pt 넘침)을 없애려고 react-native-screens simple_push로 바꿨더니, 밀 때 위 화면 가장자리가 곧은 한 줄로
// 잘리고 아래 화면이 회색으로 어두워져 아이폰 기본 넘김과 달라졌다 → 되돌린다. 넘침은 iOS 26 기본 넘김 자체의 스프링이라 앱 쪽에서 바꾸지 않는다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

describe('쌓인 화면은 기본 넘김 (D-UX4-121)', () => {
  it('_layout은 넘김 종류를 바꾸지 않는다 (탭 화면끼리 넘김 없음만)', () => {
    const layout = readFileSync(join(ROOT, 'app', '_layout.tsx'), 'utf8')
    expect(layout).not.toMatch(/simple_push|animationMatchesGesture|customAnimationOnSwipe/)
    expect(layout).toMatch(/<Stack screenOptions=\{\{ headerShown: false, fullScreenGestureEnabled: false \}\}/)
  })
})
