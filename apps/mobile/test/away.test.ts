// 자리를 비운 동안 한 줄 (APP-04 AC3): 0인 것은 빼고, 모두 0이면 줄 없음, 10초 뒤 사라짐.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { AWAY_LINE_MS, AwayTracker } from '../src/lib/away.ts'
import { awayLine } from '../src/lib/words.ts'

describe('awayLine', () => {
  it('0인 것은 빼고 잇는다', () => {
    expect(awayLine({ labels: 3, claims: 2, voice: 1 })).toBe('자리를 비운 동안 라벨 3장·찜 2건·음성 1개')
    expect(awayLine({ labels: 0, claims: 2, voice: 0 })).toBe('자리를 비운 동안 찜 2건')
    expect(awayLine({ labels: 0, claims: 0, voice: 0 })).toBeNull()
  })
})

describe('AwayTracker', () => {
  it('뒤로 갈 때 알던 찜과 돌아온 뒤 찜을 견줘 새 찜 수를 세고, 음성 수·라벨 수를 더해 10초 보인다', () => {
    const tracker = new AwayTracker()
    const now = 1000
    tracker.leave(['c1', 'c2'], now)
    tracker.noteVoice()
    tracker.noteVoice()
    expect(tracker.back(['c1', 'c2', 'c3', 'c4', 'c5'], 2, now + 5000)).toEqual({ labels: 2, claims: 3, voice: 2 })
    expect(tracker.getSnapshot().line).toBe('자리를 비운 동안 라벨 2장·찜 3건·음성 2개')
    tracker.tick(now + 5000 + AWAY_LINE_MS - 1)
    expect(tracker.getSnapshot().line).not.toBeNull()
    tracker.tick(now + 5000 + AWAY_LINE_MS)
    expect(tracker.getSnapshot().line).toBeNull()
  })

  it('뒤로 간 적이 없으면 아무것도 없고, 모두 0이면 줄이 없다', () => {
    const tracker = new AwayTracker()
    expect(tracker.back(['c1'], 0, 1)).toBeNull()
    tracker.leave(['c1'], 1)
    expect(tracker.back(['c1'], 0, 2)).toEqual({ labels: 0, claims: 0, voice: 0 })
    expect(tracker.getSnapshot().line).toBeNull()
  })
})
