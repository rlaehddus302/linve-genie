// 굳은 중간 글 (사용자 결정: "1~2초 정도 지난 말이면 그냥 확정된 단어잖아")
import { describe, expect, it } from 'vitest'
import { STABLE_EMPTY, STABLE_MS, finishStable, prepareVoiceDictionary, readSegments, stepStable, type StableState } from '../src/index.ts'

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
  it('끝이 수 낱말이면 뒤 낱말과 함께 넘긴다 (실방송 "300 5번도" = 305번, "5만 원까지")', () => {
    const a = run([[0, '자 300 5번도 다'], [1_000, '자 300 5번도 다']])
    expect(a.confirmed).toEqual(['자 300 5번도'])
    const b = run([[0, '자 300 5번도'], [1_000, '자 300 5번도']])
    expect(b.confirmed).toEqual(['자'])
    expect(b.interim).toBe('300 5번도')
    const c = run([[0, '312번 자 5만 원까지'], [1_000, '312번 자 5만 원까지']])
    expect(c.confirmed).toEqual(['312번 자'])
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

describe('stepStable — 아직 모르는 "원까지"·"원에" 줄은 원 낱말부터 남긴다 (D-V3-94 (ㄹ), AC-V3-86)', () => {
  const OPTIONS = { dictionary: prepareVoiceDictionary(), maxNumber: 999 }
  const finalPicks = (text: string) => readSegments(text, { ...OPTIONS, final: true }).picks.map((p) => [p.no, p.price])
  const held = (text: string) => run([[0, text], [STABLE_MS, text]])

  it('"… 120만 원까지 팔아"가 1,000ms 그대로면 "제가 팔색조 세금을 자"만 넘긴다', () => {
    const r = held('제가 팔색조 세금을 자 120만 원까지 팔아')
    expect(r.confirmed).toEqual(['제가 팔색조 세금을 자'])
    expect(r.interim).toBe('120만 원까지 팔아')
    expect(r.state.taken).toBe(4)
    // 999ms는 아직 아무것도 넘기지 않는다
    expect(run([[0, '제가 팔색조 세금을 자 120만 원까지 팔아'], [STABLE_MS - 1, '제가 팔색조 세금을 자 120만 원까지 팔아']]).confirmed).toEqual([])
  })
  it('"… 120만 원까지 팔아 본 적 있어요"가 1,000ms 그대로면 "… 팔아 본 적"까지 넘기고, 그 글을 최종으로 읽어도 가격이 없다', () => {
    const r = held('제가 팔색조 세금을 자 120만 원까지 팔아 본 적 있어요')
    expect(r.confirmed).toEqual(['제가 팔색조 세금을 자 120만 원까지 팔아 본 적'])
    expect(r.interim).toBe('있어요')
    expect(finalPicks(r.confirmed[0] as string)).toEqual([])
    expect(readSegments(`468번 ${r.confirmed[0] as string}`, { ...OPTIONS, final: true }).picks.some((p) => p.price === 1_200_000)).toBe(false)
  })
  it('낱말이 하나씩 늘어나도(실방송 468번 꼴) 넘긴 글은 "원까지"로 끝나지 않고, 이어 붙이면 말 그대로다', () => {
    const words = '468번은 이제 앞으로 핀이 들어오셨습니다 자 제가 팔색조 세금을 자 120만 원까지 팔아 본 적 있어요 자 저거는'.split(' ')
    let state: StableState = STABLE_EMPTY
    const confirmed: string[] = []
    let interim = ''
    for (let i = 1; i <= words.length; i++) {
      // 낱말마다 1,500ms씩 쉬며 말한다 — 앞 낱말은 매번 굳는다
      for (const now of [i * 1_500, i * 1_500 + 1_200]) {
        const step = stepStable(state, words.slice(0, i).join(' '), now)
        state = step.state
        if (step.confirm !== null) confirmed.push(step.confirm)
        interim = step.interim
      }
    }
    for (const text of confirmed) expect(text.endsWith('원까지')).toBe(false)
    expect([...confirmed.join(' ').split(' '), ...interim.split(' ')]).toEqual(words)
    for (const text of confirmed) expect(readSegments(text, { ...OPTIONS, final: true }).picks.some((p) => p.price === 1_200_000)).toBe(false)
  })
  it('"원에"·"원 까지"도 같다 — 뒤가 비었거나 군말 "자"만 오면 아직 모른다', () => {
    expect(held('제가 120만 원에 팔').confirmed).toEqual(['제가'])
    expect(held('제가 120만 원 까지 팔아').confirmed).toEqual(['제가'])
    expect(held('108번 10만 원까지 자 팔').confirmed).toEqual(['108번'])
    expect(held('108번 10만 원까지 자 자').confirmed).toEqual(['108번'])
  })
  it('경험담 앞부분이 아닌 말이 오면 지금처럼 넘긴다 ("108번 10만 원까지 예뻐요")', () => {
    expect(held('108번 10만 원까지 예뻐요').confirmed).toEqual(['108번 10만 원까지'])
    expect(finalPicks('108번 10만 원까지')).toEqual([[108, 100_000]])
    // 붙은 조사 없는 원 가격·지금의 말(팔게요)도 그대로
    expect(held('108번 10만 원 예뻐요 자').confirmed).toEqual(['108번 10만 원 예뻐요'])
    expect(held('108번 10만 원에 팔게요 자').confirmed).toEqual(['108번 10만 원에 팔게요'])
  })
  it('남긴 줄은 다른 말이 와서 정해지면 그때 넘긴다 (뒤 말은 굳을 때)', () => {
    const r = run([[0, '108번 10만 원까지 팔'], [STABLE_MS, '108번 10만 원까지 팔'], [1_200, '108번 10만 원까지 팔게요 자'], [2_200, '108번 10만 원까지 팔게요 자']])
    expect(r.confirmed).toEqual(['108번', '10만 원까지', '팔게요'])
    expect(r.interim).toBe('자')
  })
  it('굳었는데 남긴 낱말로는 지난 시각의 타이머를 걸지 않는다', () => {
    const first = stepStable(STABLE_EMPTY, '제가 팔색조 세금을 자 120만 원까지 팔아', 0)
    const step = stepStable(first.state, '제가 팔색조 세금을 자 120만 원까지 팔아', STABLE_MS)
    expect(step.confirm).toBe('제가 팔색조 세금을 자')
    expect(step.nextAt === null || step.nextAt > STABLE_MS).toBe(true)
    const c = stepStable(stepStable(STABLE_EMPTY, '312번 자 5만 원까지', 0).state, '312번 자 5만 원까지', STABLE_MS)
    expect(c.nextAt === null || c.nextAt > STABLE_MS).toBe(true)
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
