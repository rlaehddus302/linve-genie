// 자리를 비운 동안 한 줄 (APP-04 AC3): 0인 것은 빼고, 모두 0이면 줄 없음, 10초 뒤 사라짐.
// D-PRINTALL-01 (사용자 지시 2026-11-17): 라벨 장 수는 뺐다 — 옛 D-RETRO-141(라벨이 남으면 줄을 두고 누르면 대기 라벨 뽑기로 감) 시험은 스펙이 바뀌어 없앴다.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { AWAY_LINE_MS, AwayTracker } from '../src/lib/away.ts'
import { awayLine } from '../src/lib/words.ts'

describe('awayLine', () => {
  it('0인 것은 빼고 잇는다 — 라벨 장 수는 없다', () => {
    expect(awayLine({ claims: 2, voice: 1 })).toBe('자리를 비운 동안 찜 2건·음성 1개')
    expect(awayLine({ claims: 2, voice: 0 })).toBe('자리를 비운 동안 찜 2건')
    expect(awayLine({ claims: 0, voice: 0 })).toBeNull()
  })
})

describe('AwayTracker', () => {
  it('뒤로 갈 때 알던 찜과 돌아온 뒤 찜을 견줘 새 찜 수를 세고, 음성 수를 더해 10초 보인다', () => {
    const tracker = new AwayTracker()
    const now = 1000
    tracker.leave(['c1', 'c2'], now)
    tracker.noteVoice()
    tracker.noteVoice()
    expect(tracker.back(['c1', 'c2', 'c3', 'c4', 'c5'], now + 5000)).toEqual({ claims: 3, voice: 2 })
    expect(tracker.getSnapshot()).toEqual({ line: '자리를 비운 동안 찜 3건·음성 2개', until: now + 5000 + AWAY_LINE_MS })
    tracker.tick(now + 5000 + AWAY_LINE_MS - 1)
    expect(tracker.getSnapshot().line).not.toBeNull()
    tracker.tick(now + 5000 + AWAY_LINE_MS)
    expect(tracker.getSnapshot().line).toBeNull()
  })

  it('뒤로 간 적이 없으면 아무것도 없고, 모두 0이면 줄이 없다', () => {
    const tracker = new AwayTracker()
    expect(tracker.back(['c1'], 1)).toBeNull()
    tracker.leave(['c1'], 1)
    expect(tracker.back(['c1'], 2)).toEqual({ claims: 0, voice: 0 })
    expect(tracker.getSnapshot().line).toBeNull()
  })
})
