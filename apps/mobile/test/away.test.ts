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
  // D-RETRO-141로 바뀐 기대 (옛: 라벨이 남아 있어도 10초 뒤 줄이 사라졌다): 라벨이 남아 있으면 줄을 둔다 — 다 뽑으면 사라진다
  it('뒤로 갈 때 알던 찜과 돌아온 뒤 찜을 견줘 새 찜 수를 세고, 음성 수·라벨 수를 더해 보인다 — 라벨이 남아 있으면 10초가 지나도 두고, 다 뽑으면 사라진다', () => {
    const tracker = new AwayTracker()
    const now = 1000
    tracker.leave(['c1', 'c2'], now)
    tracker.noteVoice()
    tracker.noteVoice()
    expect(tracker.back(['c1', 'c2', 'c3', 'c4', 'c5'], 2, now + 5000)).toEqual({ labels: 2, claims: 3, voice: 2 })
    expect(tracker.getSnapshot().line).toBe('자리를 비운 동안 라벨 2장·찜 3건·음성 2개')
    expect(tracker.getSnapshot().labels).toBe(2)
    tracker.tick(now + 5000 + AWAY_LINE_MS - 1)
    expect(tracker.getSnapshot().line).not.toBeNull()
    tracker.tick(now + 5000 + AWAY_LINE_MS)
    expect(tracker.getSnapshot().line).toBe('자리를 비운 동안 라벨 2장·찜 3건·음성 2개')
    // 한 장 뽑힘 → 줄어든다. 새 라벨이 생겨도 늘지 않는다(자리를 비운 동안의 것만)
    tracker.labelsNow(1, now + 20_000)
    expect(tracker.getSnapshot().line).toBe('자리를 비운 동안 라벨 1장·찜 3건·음성 2개')
    tracker.labelsNow(4, now + 21_000)
    expect(tracker.getSnapshot().labels).toBe(1)
    // 다 뽑음 → 10초가 지났으므로 줄이 사라진다
    tracker.labelsNow(0, now + 22_000)
    expect(tracker.getSnapshot().line).toBeNull()
  })

  it('라벨 없는 줄은 10초 뒤 사라진다', () => {
    const tracker = new AwayTracker()
    tracker.leave(['c1'], 0)
    tracker.back(['c1', 'c2'], 0, 1000)
    expect(tracker.getSnapshot()).toEqual({ line: '자리를 비운 동안 찜 1건', until: 1000 + AWAY_LINE_MS, labels: 0 })
    tracker.tick(1000 + AWAY_LINE_MS - 1)
    expect(tracker.getSnapshot().line).not.toBeNull()
    tracker.tick(1000 + AWAY_LINE_MS)
    expect(tracker.getSnapshot().line).toBeNull()
  })

  it('10초 안에 라벨을 다 뽑으면 라벨 몫만 빠지고 나머지는 10초까지 보인다 · 라벨만이면 바로 사라진다', () => {
    const tracker = new AwayTracker()
    tracker.leave(['c1'], 0)
    tracker.back(['c1', 'c2'], 3, 1000)
    tracker.labelsNow(0, 2000)
    expect(tracker.getSnapshot()).toEqual({ line: '자리를 비운 동안 찜 1건', until: 1000 + AWAY_LINE_MS, labels: 0 })
    tracker.tick(1000 + AWAY_LINE_MS)
    expect(tracker.getSnapshot().line).toBeNull()

    const only = new AwayTracker()
    only.leave([], 0)
    only.back([], 2, 1000)
    expect(only.getSnapshot().line).toBe('자리를 비운 동안 라벨 2장')
    // 라벨 출력을 끄면 화면이 0을 넘긴다 → 장 수가 사라진다
    only.labelsNow(0, 1500)
    expect(only.getSnapshot().line).toBeNull()
  })

  it('줄이 없을 때 남은 라벨 수가 와도 줄을 만들지 않는다', () => {
    const tracker = new AwayTracker()
    tracker.labelsNow(5, 0)
    expect(tracker.getSnapshot().line).toBeNull()
    tracker.leave(['c1'], 0)
    tracker.back(['c1', 'c2'], 0, 1000)
    tracker.labelsNow(5, 1500)
    expect(tracker.getSnapshot()).toEqual({ line: '자리를 비운 동안 찜 1건', until: 1000 + AWAY_LINE_MS, labels: 0 })
  })

  it('뒤로 간 적이 없으면 아무것도 없고, 모두 0이면 줄이 없다', () => {
    const tracker = new AwayTracker()
    expect(tracker.back(['c1'], 0, 1)).toBeNull()
    tracker.leave(['c1'], 1)
    expect(tracker.back(['c1'], 0, 2)).toEqual({ labels: 0, claims: 0, voice: 0 })
    expect(tracker.getSnapshot().line).toBeNull()
  })
})
