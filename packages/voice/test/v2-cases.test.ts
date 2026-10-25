// V2 사례 표 S1~S21 (harness/sprints/V2/acceptance.md) — 표의 시각·덩어리·기대를 그대로 옮긴다.
// AC-V2-04·05·11·13·18·19·20·21 (device 몫). 화면 문구·E2E는 web·e2e 몫.
import { describe, expect, it } from 'vitest'
import { createChunkCard, chooseAction, readChunk, splitCorrections, varietyCandidates, VOICE_LOG_REASONS, type RecentRegistration, type SuggestionCard } from '../src/index.ts'
import { DICT, openCards, simulate, view } from './v2-helpers.ts'

const recentAt = (registeredAt: number): RecentRegistration => ({ id: 'p15', no: 15, name: '핑크문', price: 15000, registeredAt, undoUntil: registeredAt + 5000 })

describe('품종 바로잡기 S1·S6·S7·S8·S9·S10 (AC-V2-04·05)', () => {
  it('S1 "15번 핑크 문 만오천원" → 1800에 15번 · 핑크문 · 15,000원 HIGH', () => {
    const run = simulate([{ text: '15번 핑크 문 만오천원', at: 0 }], 1800)
    expect(run.chunks.map((c) => [c.text, c.endedAt])).toEqual([['15번 핑크 문 만오천원', 1800]])
    expect(run.cards).toHaveLength(1)
    expect(run.cards[0]).toMatchObject({ no: 15, name: '핑크문', price: 15000, confidence: 'HIGH' })
  })

  it('S1 1700에는 아직 덩어리가 없다', () => {
    expect(simulate([{ text: '15번 핑크 문 만오천원', at: 0 }], 1700).chunks).toHaveLength(0)
  })

  it.each([
    ['S6', '16번 블루 엘프 만원', { no: 16, name: '블루엘프', price: 10000, confidence: 'HIGH' }],
    ['S7', '17번 부루엘프 만원', { no: 17, name: '블루엘프', price: 10000, confidence: 'HIGH' }],
    ['S8', '18번 라운 만이천원', { no: 18, name: '라울', price: 12000, confidence: 'HIGH' }],
  ])('%s %s', (_id, text, expected) => {
    const run = simulate([{ text, at: 0 }], 1800)
    expect(run.cards).toHaveLength(1)
    expect(run.cards[0]).toMatchObject(expected)
    expect(readChunk(text, { dictionary: DICT })).toMatchObject(expected)
  })

  it('S7 별칭이 없는 사전이어도 R-17로 부루엘프 → 블루엘프 LOW', () => {
    expect(readChunk('17번 부루엘프 만원', { dictionary: ['블루엘프'] })).toMatchObject({ no: 17, name: '블루엘프', price: 10000, confidence: 'LOW' })
  })

  it('S8 데이터 사전 라울의 별칭 라운 (D-V2-12) — 별칭 없는 사전이면 R-17만으로 0.8 → LOW', () => {
    expect(readChunk('18번 라운 만이천원', { dictionary: ['라울'] })).toMatchObject({ no: 18, name: '라울', price: 12000, confidence: 'LOW' })
    const run = simulate([{ text: '18번 라운 만이천원', at: 0 }], 1800, { settings: { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 } })
    expect(run.cards[0]).toMatchObject({ confidence: 'HIGH', autoConfirmAt: 1800 + 5000 })
  })

  it('칸 이름 뒤 막는 낱말·지시어·가격 말은 품종이 되지 않는다 (TD-V2-002)', () => {
    for (const text of ['15번 품종 만원', '15번 만원 품종은 그거', '15번 만원 품종은 이거', '15번 만원 이름은 천원', '15번 만원 품종은 오천']) {
      expect(readChunk(text, { dictionary: DICT }).name, text).toBeNull()
    }
    expect(readChunk('25번 만원 품종은 하얀 별', { dictionary: DICT }).name).toBe('하얀 별')
  })

  it('취소 낱말은 다른 번호 끊기를 막지 않는다 (TD-V2-001)', () => {
    const run = simulate(
      [
        { text: '26번 엘레강스 만원', at: 0 },
        { text: '27번 라울 만원 취소', at: 1000 },
      ],
      2800,
    )
    expect(run.cards.map(view)).toEqual([{ no: 26, name: '엘레강스', price: 10000 }])
  })

  it('S9 "19번 선버스 팔천원" → 품종 빈칸, 후보 첫째 선버스트 77점', () => {
    const run = simulate([{ text: '19번 선버스 팔천원', at: 0 }], 1800)
    expect(view(run.cards[0])).toEqual({ no: 19, name: null, price: 8000 })
    const reading = readChunk('19번 선버스 팔천원', { dictionary: DICT })
    expect(reading.name).toBeNull()
    expect(reading.candidates[0]).toEqual({ name: '선버스트', score: 77, heard: '선버스' })
    const action = run.actions[0]?.action
    expect(action?.kind === 'create' && action.candidates[0]?.name).toBe('선버스트')
    expect(run.log[0]?.read?.candidates[0]).toMatchObject({ name: '선버스트', score: 77 })
  })

  it('S10 "20번 음 그거 오천원" → 20번 · 품종 빈칸 · 5,000원 카드', () => {
    const run = simulate([{ text: '20번 음 그거 오천원', at: 0 }], 1800)
    expect(view(run.cards[0])).toEqual({ no: 20, name: null, price: 5000 })
  })
})

describe('이어 붙이기 S2·S3·S16·S17·S21 (AC-V2-11·13·18)', () => {
  it('S2 십오번(0)·엘레강스(1200)·이만원(2500) → 4300에 덩어리 하나, 카드 하나', () => {
    const results = [
      { text: '십오번', at: 0 },
      { text: '엘레강스', at: 1200 },
      { text: '이만원', at: 2500 },
    ]
    expect(simulate(results, 4200).chunks).toHaveLength(0)
    const run = simulate(results, 4300)
    expect(run.chunks.map((c) => [c.text, c.endedAt])).toEqual([['십오번 엘레강스 이만원', 4300]])
    expect(run.cards.map(view)).toEqual([{ no: 15, name: '엘레강스', price: 20000 }])
  })

  it('S3 십오번(0), 엘레강스 이만원(4000) → 1800에 15번 빈 카드, 5800에 같은 카드가 채워짐', () => {
    const first = simulate([{ text: '십오번', at: 0 }], 1800)
    expect(first.cards.map(view)).toEqual([{ no: 15, name: null, price: null }])
    const action = first.actions[0]?.action
    expect(action?.kind === 'create' && action.ask).toBe('품종·가격을 말해 주세요')
    const run = simulate(
      [
        { text: '십오번', at: 0 },
        { text: '엘레강스 이만원', at: 4000 },
      ],
      5800,
    )
    expect(run.chunks.map((c) => [c.text, c.endedAt])).toEqual([
      ['십오번', 1800],
      ['엘레강스 이만원', 5800],
    ])
    expect(run.actions[1]?.action.kind).toBe('fill')
    expect(run.cards.map(view)).toEqual([{ no: 15, name: '엘레강스', price: 20000 }])
    expect(run.log[0]?.action).toBe('fill')
  })

  it('S16 26번(0)·27번(1000) → 1000에 끊고 2800에 둘째, 카드 둘', () => {
    const run = simulate(
      [
        { text: '26번 엘레강스 만원', at: 0 },
        { text: '27번 라울 이만원', at: 1000 },
      ],
      2800,
    )
    expect(run.chunks.map((c) => [c.text, c.endedAt, c.end])).toEqual([
      ['26번 엘레강스 만원', 1000, 'number'],
      ['27번 라울 이만원', 2800, 'quiet'],
    ])
    expect(run.cards.map(view)).toEqual([
      { no: 27, name: '라울', price: 20000 },
      { no: 26, name: '엘레강스', price: 10000 },
    ])
  })

  it('S17 중간 결과도 조용한 시간을 다시 센다 — 1800에 끊지 않고 4800에 카드 하나', () => {
    const results = [
      { text: '28번 핑크', at: 0, final: false },
      { text: '28번 핑크문 만', at: 1500, final: false },
      { text: '28번 핑크문 만원', at: 3000 },
    ]
    expect(simulate(results, 4700).chunks).toHaveLength(0)
    const run = simulate(results, 4800)
    expect(run.chunks.map((c) => [c.text, c.endedAt])).toEqual([['28번 핑크문 만원', 4800]])
    expect(run.cards.map(view)).toEqual([{ no: 28, name: '핑크문', price: 10000 }])
  })

  it('S21 문자찜 결과는 모은 글을 먼저 끊고 혼자 R-21로', () => {
    const run = simulate(
      [
        { text: '29번 핑크문 만원', at: 0 },
        { text: '165번 문자찜 끝자리 1234', at: 1000 },
      ],
      3000,
    )
    expect(run.chunks.map((c) => [c.text, c.endedAt, c.end])).toEqual([['29번 핑크문 만원', 1000, 'sms']])
    expect(run.sms).toEqual([{ text: '165번 문자찜 끝자리 1234', at: 1000, flushedAtEnd: false }])
    expect(run.cards.map(view)).toEqual([{ no: 29, name: '핑크문', price: 10000 }])
  })
})

describe('정정 S4·S5·S11~S15·S18~S20 (AC-V2-19·21)', () => {
  it('S4 "15번 핑크문 만오천원" + "만오천 말고 만팔천" → 2800에 15번 · 핑크문 · 18,000원 한 장', () => {
    const run = simulate(
      [
        { text: '15번 핑크문 만오천원', at: 0 },
        { text: '만오천 말고 만팔천', at: 1000 },
      ],
      2800,
    )
    expect(run.chunks.map((c) => [c.text, c.endedAt])).toEqual([['15번 핑크문 만오천원 만오천 말고 만팔천', 2800]])
    expect(run.cards.map(view)).toEqual([{ no: 15, name: '핑크문', price: 18000 }])
  })

  it('S4 splitCorrections: 말고에서 두 조각', () => {
    const split = splitCorrections('15번 핑크문 만오천원 만오천 말고 만팔천')
    expect(split.pieces.map((p) => [p.text, p.start])).toEqual([
      ['15번 핑크문 만오천원 만오천', null],
      ['만팔천', 'correction'],
    ])
    expect(split.correction).toBe(true)
    expect(split.cancel).toBe(false)
  })

  it('만오천말고 = 만오천 + 표시', () => {
    expect(splitCorrections('만오천말고 만팔천').pieces.map((p) => [p.text, p.start])).toEqual([
      ['만오천', null],
      ['만팔천', 'correction'],
    ])
  })

  it('S5 S1 카드가 열린 채 "아니 만팔천"(3000) → 4800에 같은 카드 18,000원, 고친 말, 손댄 카드', () => {
    const run = simulate(
      [
        { text: '15번 핑크 문 만오천원', at: 0 },
        { text: '아니 만팔천', at: 3000 },
      ],
      4800,
      { settings: { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 } },
    )
    expect(run.cards).toHaveLength(1)
    expect(run.cards[0]).toMatchObject({ no: 15, name: '핑크문', price: 18000, touched: true, autoConfirmAt: null })
    const action = run.actions[1]?.action
    expect(action).toMatchObject({ kind: 'edit', message: '고쳤어요: 가격 15,000원 → 18,000원' })
  })

  it('S11 "21번 핑크문 만원" + "취소"(900) → 카드 없음, 기록 버림', () => {
    const run = simulate(
      [
        { text: '21번 핑크문 만원', at: 0 },
        { text: '취소', at: 900 },
      ],
      2700,
    )
    expect(run.chunks.map((c) => [c.text, c.endedAt])).toEqual([['21번 핑크문 만원 취소', 2700]])
    expect(run.cards).toHaveLength(0)
    expect(run.log[0]?.action).toBe('discard')
    expect(splitCorrections('21번 핑크문 만원 취소').cancel).toBe(true)
  })

  it('S12 S1 카드 열림 + "취소"(3000) → 4800에 맨 앞 카드 닫힘', () => {
    const run = simulate(
      [
        { text: '15번 핑크 문 만오천원', at: 0 },
        { text: '취소', at: 3000 },
      ],
      4800,
    )
    expect(run.actions[1]?.action.kind).toBe('close')
    expect(openCards(run.cards)).toHaveLength(0)
  })

  it('S13 "22번 라울 만원" + "아니 아니 23번"(1000) → 한 덩어리, 23번 · 라울 · 10,000원', () => {
    const run = simulate(
      [
        { text: '22번 라울 만원', at: 0 },
        { text: '아니 아니 23번', at: 1000 },
      ],
      2800,
    )
    expect(run.chunks.map((c) => [c.text, c.endedAt])).toEqual([['22번 라울 만원 아니 아니 23번', 2800]])
    expect(run.cards.map(view)).toEqual([{ no: 23, name: '라울', price: 10000 }])
    expect(splitCorrections('22번 라울 만원 아니 아니 23번').pieces.map((p) => p.text)).toEqual(['22번 라울 만원', '23번'])
  })

  it('S14 "24번 핑크문 만원" + "품종은 루비" → 24번 · 루비 · 10,000원', () => {
    const run = simulate(
      [
        { text: '24번 핑크문 만원', at: 0 },
        { text: '품종은 루비', at: 1000 },
      ],
      2800,
    )
    expect(run.cards.map(view)).toEqual([{ no: 24, name: '루비', price: 10000 }])
    expect(splitCorrections('24번 핑크문 만원 품종은 루비').pieces.map((p) => [p.text, p.field])).toEqual([
      ['24번 핑크문 만원', null],
      ['루비', 'name'],
    ])
  })

  it('S15 "25번 만원" + "품종은 하얀 별" → 품종 "하얀 별"·확인 필요·자동 확정 없음', () => {
    const run = simulate(
      [
        { text: '25번 만원', at: 0 },
        { text: '품종은 하얀 별', at: 1000 },
      ],
      2800,
      { settings: { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 } },
    )
    expect(run.cards.map(view)).toEqual([{ no: 25, name: '하얀 별', price: 10000 }])
    expect(run.cards[0]).toMatchObject({ nameNeedsCheck: true, autoConfirmAt: null, confidence: 'LOW' })
    expect(splitCorrections('25번 만원 품종은 하얀 별').pieces.map((p) => [p.text, p.field])).toEqual([
      ['25번 만원', null],
      ['하얀 별', 'name'],
    ])
  })

  it('S18 열린 S1 카드 + "아니 이거 너무 예쁘죠" → 카드 그대로, 버림 "번호와 가격이 안 들렸어요"', () => {
    const run = simulate(
      [
        { text: '15번 핑크 문 만오천원', at: 0 },
        { text: '아니 이거 너무 예쁘죠', at: 3000 },
      ],
      4800,
    )
    expect(run.cards).toHaveLength(1)
    expect(run.cards[0]).toMatchObject({ no: 15, name: '핑크문', price: 15000, touched: false, status: 'OPEN' })
    expect(run.log[0]).toMatchObject({ action: 'discard', reason: '번호와 가격이 안 들렸어요' })
    const split = splitCorrections('아니 이거 너무 예쁘죠')
    expect(split.pieces.map((p) => [p.text, p.start])).toEqual([['이거 너무 예쁘죠', 'correction']])
    expect(split.startsWithCorrection).toBe(true)
  })

  it('S19 열린 카드 없음, 40초 전 등록 + "만오천 말고 만팔천" → 고칠까요 카드, 상품 그대로', () => {
    const recent = recentAt(1800 - 40_000)
    const run = simulate([{ text: '만오천 말고 만팔천', at: 0 }], 1800, { recent: [recent] })
    expect(run.actions[0]?.action).toEqual({ kind: 'offer', registrationId: 'p15', changes: { price: 18000 }, message: '방금 등록한 15번 핑크문을 18,000원으로 고칠까요?' })
    expect(run.cards).toHaveLength(0)
  })

  it('S20 등록이 70초 전 → 아무것도 안 바꿈, "고칠 카드가 없어요"', () => {
    const run = simulate([{ text: '만오천 말고 만팔천', at: 0 }], 1800, { recent: [recentAt(1800 - 70_000)] })
    expect(run.actions[0]?.action).toEqual({ kind: 'discard', reason: '고칠 카드가 없어요', cancelled: false })
    expect(run.log[0]?.reason).toBe('고칠 카드가 없어요')
  })
})

describe('등록 뒤 정정의 나머지 (AC-V2-27 device 쪽)', () => {
  const now = 10_000
  const reading = (text: string) => readChunk(text, { dictionary: DICT })
  it('"아니 16번" → 번호는 상품 목록에서 고쳐 주세요', () => {
    expect(chooseAction(reading('아니 16번'), { cards: [], recent: [recentAt(now - 3000)], now })).toEqual({ kind: 'offerNumber', registrationId: 'p15', message: '번호는 상품 목록에서 고쳐 주세요' })
  })
  it('"취소" 되돌리기 시간 안 → 되돌릴까요, 지나면 시간이 지났어요', () => {
    expect(chooseAction(reading('취소'), { cards: [], recent: [recentAt(now - 3000)], now })).toEqual({ kind: 'offerUndo', registrationId: 'p15', canUndo: true, message: '방금 등록한 15번 핑크문을 되돌릴까요?' })
    expect(chooseAction(reading('취소'), { cards: [], recent: [recentAt(now - 30_000)], now })).toEqual({
      kind: 'offerUndo',
      registrationId: 'p15',
      canUndo: false,
      message: '되돌릴 시간이 지났어요. 상품 목록에서 고쳐 주세요.',
    })
  })
})

describe('이어 채우기 경계 (AC-V2-19·20)', () => {
  // V3(D-V3-41): 번호 없는 결과는 새 카드를 만들지 않는다 — 채우지도 않고 버린다
  it('두 번째 결과가 12000이면 채우지 않고 번호 없는 결과는 버림', () => {
    const run = simulate(
      [
        { text: '십오번', at: 0 },
        { text: '엘레강스 이만원', at: 12000 },
      ],
      13800,
    )
    expect(run.cards.map(view)).toEqual([{ no: 15, name: null, price: null }])
  })

  it('손댄 카드는 채우지 않는다', () => {
    const base = simulate([{ text: '십오번', at: 0 }], 1800).cards[0] as SuggestionCard
    const touched: SuggestionCard = { ...base, touched: true }
    const action = chooseAction(readChunk('엘레강스 이만원', { dictionary: DICT }), { cards: [touched], now: 5800, chunkStartedAt: 4000 })
    // V3(D-V3-41): 채우지 않고, 번호가 없으니 새 카드도 없다
    expect(action.kind).toBe('discard')
  })

  it('이미 가격 15,000원이 있는 카드에 "이만원" → 바꾸지 않고 까닭 "이미 있는 값과 달라 쓰지 않았어요"', () => {
    const card = createChunkCard({
      id: 'a',
      action: { kind: 'create', extraction: { no: 15, name: null, price: 15000, confidence: 'LOW' }, nameExact: false, nameNeedsCheck: false, candidates: [], ask: null },
      text: '15번 만오천원',
      createdAt: 1800,
    }) as SuggestionCard
    const action = chooseAction(readChunk('이만원', { dictionary: DICT }), { cards: [card], now: 5800, chunkStartedAt: 4000 })
    expect(action).toEqual({ kind: 'discard', reason: VOICE_LOG_REASONS.conflict, cancelled: false })
  })

  it('채운 카드의 자동 확정은 채운 때부터 5초 (켬·HIGH)', () => {
    const settings = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 } as const
    const run = simulate(
      [
        { text: '십오번', at: 0 },
        { text: '엘레강스 이만원', at: 4000 },
      ],
      5800,
      { settings },
    )
    expect(run.cards[0]).toMatchObject({ confidence: 'HIGH', autoConfirmAt: 5800 + 5000 })
  })
})

describe('후보 (AC-V2-05·06)', () => {
  it('레드애보니 → 첫 후보 레드에보니 100점, R-17 name은 접기 없이 레드에보니 LOW', () => {
    expect(varietyCandidates('레드애보니', DICT)[0]).toMatchObject({ name: '레드에보니', score: 100 })
    const reading = readChunk('레드애보니', { dictionary: DICT })
    expect(reading).toMatchObject({ name: '레드에보니', confidence: 'LOW', nameExact: false })
    expect(reading.candidates).toEqual([])
  })

  it('후보는 3개 이하·점수 높은 순(같으면 이름 순)·이름당 한 번·모두 60점 이상', () => {
    for (const text of ['19번 선버스 팔천원', '핑크프리 만원', '블루스카 엘레강', '레몬로 로즈퀴 화이트로', '아메치 리틀뷰 퍼플퀴']) {
      const list = varietyCandidates(text, DICT)
      expect(list.length).toBeLessThanOrEqual(3)
      expect(new Set(list.map((c) => c.name)).size).toBe(list.length)
      for (const c of list) expect(c.score).toBeGreaterThanOrEqual(60)
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1]!
        const b = list[i]!
        expect(a.score > b.score || (a.score === b.score && a.name < b.name)).toBe(true)
      }
    }
  })

  it('1음절 창·자모 4개 이하 창은 후보가 아니다', () => {
    expect(varietyCandidates('루', DICT)).toEqual([])
    expect(varietyCandidates('로자', DICT)).toEqual([]) // 4자모
    // 자모 4개 이하 이름(로라·자보)은 후보가 되지 않는다
    expect(varietyCandidates('로라라', ['로라'])).toEqual([])
  })
})
