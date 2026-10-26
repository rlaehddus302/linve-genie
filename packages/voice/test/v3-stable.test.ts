// 굳은 중간 글 (사용자 결정: "1~2초 정도 지난 말이면 그냥 확정된 단어잖아")
import { describe, expect, it } from 'vitest'
import { STABLE_EMPTY, STABLE_MS, finishStable, stepStable, type StableState } from '../src/index.ts'

/** 중간 글을 차례로 넣고 넘긴 글을 모은다 */
function run(steps: readonly (readonly [number, string])[]): { state: StableState; confirmed: string[]; interim: string } {
  let state: StableState = STABLE_EMPTY
  const confirmed: string[] = []
  let interim = ''
  for (const [now, text] of steps) {
    const step = stepStable(state, text, now)
    state = step.state
    if (step.confirm !== null) confirmed.push(step.confirm)
    interim = step.interim
  }
  return { state, confirmed, interim }
}

describe('stepStable', () => {
  it('1,000ms 그대로인 앞 낱말은 넘기고 마지막 낱말은 남긴다 — 999ms는 아직', () => {
    expect(run([[0, '312번 자 수박금'], [999, '312번 자 수박금']]).confirmed).toEqual([])
    const r = run([[0, '312번 자 수박금'], [STABLE_MS, '312번 자 수박금']])
    expect(r.confirmed).toEqual(['312번 자'])
    expect(r.interim).toBe('수박금')
  })
  it('달라진 자리부터 다시 센다 (크롬이 고쳐 쓴 낱말)', () => {
    const r = run([[0, '312번 자 수박 금'], [600, '312번 자 수박금 자'], [1_000, '312번 자 수박금 자'], [1_599, '312번 자 수박금 자'], [1_600, '312번 자 수박금 자']])
    expect(r.confirmed).toEqual(['312번 자', '수박금'])
    expect(r.interim).toBe('자')
  })
  it('끝나지 않는 긴 말: 낱말이 굳는 대로 조금씩 넘긴다', () => {
    const steps: [number, string][] = []
    const text = '312번 자 수박금 자 ui 5만 원까지 드려볼게요 312번입니다 자 수박이'.split(' ')
    for (let i = 1; i <= text.length; i++) steps.push([i * 300, text.slice(0, i).join(' ')])
    const r = run(steps)
    expect([...r.confirmed.join(' ').split(' '), ...r.interim.split(' ')]).toEqual(text)
    expect(r.confirmed.join(' ')).toContain('5만 원까지')
  })
  it('넘긴 앞부분은 크롬이 고쳐 써도 되돌리지 않는다 — 남은 중간 글만 보인다', () => {
    const r = run([[0, '36번 2만 원 자'], [1_000, '36번 2만 원 자'], [1_200, '306번 2만 원 자 요']])
    // 첫 낱말부터 달라졌다 = 새 결과로 보고 처음부터 센다
    expect(r.confirmed).toEqual(['36번 2만 원'])
    expect(r.state.taken).toBe(0)
    expect(r.interim).toBe('306번 2만 원 자 요')
    const s = run([[0, '36번 2만 원 자'], [1_000, '36번 2만 원 자'], [1_200, '36번 2만 원이요 자 요']])
    expect(s.state.taken).toBe(3)
    expect(s.interim).toBe('자 요')
  })
  it('nextAt = 아직 안 넘긴 낱말(마지막 빼고)이 가장 먼저 굳는 시각', () => {
    expect(stepStable(STABLE_EMPTY, '312번 자 수박금', 100).nextAt).toBe(100 + STABLE_MS)
    expect(stepStable(STABLE_EMPTY, '312번', 100).nextAt).toBeNull()
  })
  it('넘긴 상태를 바꾸지 않고 깨진 입력에 던지지 않는다', () => {
    const state = Object.freeze({ tokens: Object.freeze(['a', 'b']), since: Object.freeze([0, 0]), taken: 0 })
    expect(stepStable(state, 'a b c', 2_000).confirm).toBe('a b')
    expect(state.taken).toBe(0)
    expect(stepStable(null, 'a b', 0).confirm).toBeNull()
    expect(stepStable({ tokens: ['a'], since: [], taken: 9 }, 'a b', 5_000).confirm).toBeNull()
    expect(stepStable(STABLE_EMPTY, 42 as unknown as string, 0).interim).toBe('')
    expect(stepStable(STABLE_EMPTY, 'a b', Number.NaN).confirm).toBeNull()
  })
})

describe('finishStable', () => {
  it('넘긴 낱말 수만큼 떼고 남은 글을 최종으로', () => {
    const r = run([[0, '304번 2만 원 다음'], [1_000, '304번 2만 원 다음']])
    expect(finishStable(r.state, '304번 2만 원 다음은 305번').text).toBe('다음은 305번')
    expect(finishStable(r.state, '304번 2만 원').text).toBe('')
    expect(finishStable(STABLE_EMPTY, '304번 2만 원').text).toBe('304번 2만 원')
    expect(finishStable(r.state, '304번 2만 원 다음').state).toEqual(STABLE_EMPTY)
  })
})
