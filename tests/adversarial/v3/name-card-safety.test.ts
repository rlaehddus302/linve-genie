// V3 적대 시험 (test-domain, D-V3-37·38·40·41, R-17 5·7·8, AC-V3-50, 사례 R7·R34·R35·R44·R49~R51): 품종 칸과 카드 만들기를 공격한다.
// 노리는 것: 사전 밖 추측이 등록 품종이 됨, 흔한 말이 배운 별칭·비슷한 품종으로 맞춰짐(보니까 → 보니타), 번호 없는·번호 둘·가격 뒤 맨 수 결과로 카드가 생김.
import { canLearnAlias, prepareVoiceDictionary, readLearnedAliases, readRegistration, readSentence } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { openCards, simulate, view } from '../v2/sim.ts'

const DICT = prepareVoiceDictionary()
const SMALL = ['라울', '핑크프릴', '삼광색금', '보니타', '선버스트'] as const

describe('D-V3-37 — 바로 등록 품종은 사전 이름 또는 빈칸뿐', () => {
  const VOCAB = [
    '15번', '108번', '일육팔', '170', '25만', '원', '10만', '원까지', '만원', '자', '요 아이', '이거', '그대로', 'bts', 'bts는', '컬러풀', '약간', '한번', '붙어',
    '생활과', '야량', '나왔네요', '보니까', '설비', '라울', '라울이고', '핑크 프릴', '삼광 색금', '3강 세금', '상관 세금', '보니타', '선버스', '75번입니다', '네',
  ] as const
  it('무작위 문장·낱말 하나씩 늘려 넣기: 등록 품종 = 그 글의 사전 맞춤(name), 작은 사전이면 그 목록 안 이름이거나 null, "품종 확인 필요" 없음', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...VOCAB), { minLength: 1, maxLength: 14 }), fc.boolean(), (parts, small) => {
        const tokens = parts.join(' ').split(' ')
        for (let k = 1; k <= tokens.length; k++) {
          const prefix = tokens.slice(0, k).join(' ')
          const dictionary = small ? [...SMALL] : DICT
          const reading = readRegistration(prefix, { dictionary, final: k === tokens.length })
          const ready = reading.ready
          if (ready === null) continue
          expect(ready.name, prefix).toBe(reading.extraction.name)
          expect(ready.nameNeedsCheck, prefix).toBe(false)
          if (small && ready.name !== null) expect(SMALL as readonly string[]).toContain(ready.name)
          if (ready.name === null) continue
          // 사전 맞춤은 사전 그대로의 이름이다 (추측 낱말·들은 글 조각이 아님)
          expect(readSentence(prefix, { dictionary }).extraction.name).toBe(ready.name)
        }
      }),
      { numRuns: 800 },
    )
  })

  it.each([
    // 컬러풀·BTS는 영수증으로 사전 품종이 되어(be4400ab) 이 줄들은 사전 밖 낱말(우주선·zeta)로 같은 꼴을 본다 — 사전 이름은 아래 시험
    // 예전 낱말 ufo는 대소문자 무시로 영수증 품종 UFO와 맞게 되어(D-V3-120) 사전에 없는 zeta로 바꿈 — 시험 뜻(사전 밖 낱말 → 품종 비움)은 그대로
    ['R49 실방송 4차 꼴 (사전 밖 우주선)', '자 우주선 약간 자 우주선 이거 네 10만 원 75번입니다', 75, 100_000],
    ['실제 방송 2 꼴 (사전 밖 zeta 두 번)', '자 zeta는 자 zeta 요거 그대로 보냅니다 요 아이 자 10만 원 108번', 108, 100_000],
    ['실제 방송 1 꼴 (사전 밖 zeta)', '네 108번 zeta 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요', 108, 100_000],
    ['붙어·한번·생활과', '46번 붙어 한번 생활과 붙어 생활과 야량 5만 원', 46, 50_000],
  ])('%s → 품종 미입력으로 등록', (_title, text, no, price) => {
    const ready = readRegistration(text, { dictionary: DICT, final: true }).ready
    expect(ready).toEqual({ no, price, name: null, nameNeedsCheck: false, numberFrom: 'marker' })
  })

  it.each([
    ['R49 실방송 4차', '자 컬러풀 약간 자 컬러풀 이거 네 10만 원 75번입니다', 75, 100_000, '컬러풀'],
    ['실제 방송 2 (bts 두 번)', '자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번', 108, 100_000, 'BTS'],
    ['실제 방송 1', '네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요', 108, 100_000, 'BTS'],
  ])('%s → 사전 품종(영수증)으로 등록', (_title, text, no, price, name) => {
    const ready = readRegistration(text, { dictionary: DICT, final: true }).ready
    expect(ready).toEqual({ no, price, name, nameNeedsCheck: false, numberFrom: 'marker' })
  })
})

describe('D-V3-40 — 풀이말 끝으로 끝나는 창은 비슷함 맞추기를 하지 않는다', () => {
  it.each([
    ['15번 보니까 만오천 원', null],
    ['15번 그런데 만오천 원', null],
    ['15번 보니타 만오천 원', '보니타'],
    ['15번 보니타요 만오천 원', '보니타'],
    ['15번 라울이고 만원', '라울'],
    ['15번 나울 오천 원', '라울'],
  ])('"%s" → 품종 %s', (text, name) => {
    expect(readSentence(text, { dictionary: DICT }).extraction.name).toBe(name)
  })
})

describe('D-V3-38 — 흔한 말은 배운 별칭이 되지 않는다 (AC-V3-50)', () => {
  it.each(['보니까', '그런데', '있고요', '한번', '약간', '요거', '3강', 'UI', '이렇게', '나왔네'])('"%s"는 배우지 않는다', (heard) => {
    expect(canLearnAlias(heard, '보니타')).toBe(false)
  })
  it('선버스 → 선버스트는 그대로 배운다 (AC-V2-09)', () => {
    expect(canLearnAlias('선버스', '선버스트')).toBe(true)
  })
  it('저장소의 "보니까 → 보니타"는 읽을 때 버려지고, "15번 보니까 만오천 원"은 품종 미입력으로 등록된다', () => {
    const learned = readLearnedAliases([
      { heard: '보니까', name: '보니타', usedAt: 1 },
      { heard: '한번', name: '라울', usedAt: 2 },
      { heard: '선버스', name: '선버스트', usedAt: 3 },
    ])
    expect(learned.map((item) => item.heard)).toEqual(['선버스'])
    const dictionary = prepareVoiceDictionary({ learned })
    expect(readRegistration('15번 보니까 만오천 원', { dictionary, final: true }).ready).toEqual({ no: 15, price: 15_000, name: null, nameNeedsCheck: false, numberFrom: 'marker' })
    expect(readRegistration('15번 선버스 만오천 원', { dictionary, final: true }).ready?.name).toBe('선버스트')
  })
})

describe('D-V3-41 — 확정된 번호가 있을 때만 카드', () => {
  const R6 = '어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요'
  it.each([
    ['R7 실제 방송 6 (번호 둘)', R6, '번호가 여럿 들렸어요: 189·139'],
    ['R34 가격 뒤 맨 수', '자 9cm에 이거 25만 원 170', '번호가 가격 뒤에 들렸어요'],
    ['R44 실방송 3차', '요 아이는 65만 원까지 자 색감이 이렇게 예쁘게 나왔네요 자 60 어 자', '번호가 가격 뒤에 들렸어요'],
    ['R35 3강', '삼광색금 3강 25만 원', '번호를 못 들었어요'],
    ['R50 칠만 원', '칠만 원', '번호를 못 들었어요'],
    ['R50 핑크문 만원', '핑크문 만원', '번호를 못 들었어요'],
  ])('%s → 카드 0, 기록 까닭', (_title, text, reason) => {
    const r = simulate([{ text, at: 0 }], 3000)
    expect(openCards(r.cards)).toEqual([])
    expect(r.actions.map(({ action }) => action)).toEqual([{ kind: 'discard', reason, cancelled: false }])
  })

  // D-V3-44: 바로 등록 켬이면 번호만·원 없는 가격 결과는 카드 0(기록 "가격을 못 들었어요"), 덩어리 사이 이어 채우기 없음. 끔은 V2 그대로
  it('R51 켬: "15번" 뒤 4초에 "엘레강스 이만원" → 쓰기 0, 카드 0, 기록 "가격을 못 들었어요"·"번호를 못 들었어요"', () => {
    const r = simulate([{ text: '15번', at: 0 }, { text: '엘레강스 이만원', at: 4000 }], 8000, { autoRegister: true })
    expect(r.cards).toEqual([])
    expect(r.registered).toEqual([])
    expect(r.actions.map(({ action }) => (action.kind === 'discard' ? action.reason : action.kind))).toEqual(['가격을 못 들었어요', '번호를 못 들었어요'])
  })

  it.each(['이 10번 오타 하나 지우신 거예요 아 그런가요', '15번 핑크프릴 만오천'])('R52 켬: "%s" → 쓰기 0, 카드 0, 기록 "가격을 못 들었어요"', (text) => {
    const r = simulate([{ text, at: 0 }], 3000, { autoRegister: true })
    expect([r.cards, r.registered]).toEqual([[], []])
    expect(r.actions.map(({ action }) => (action.kind === 'discard' ? action.reason : action.kind))).toEqual(['가격을 못 들었어요'])
  })

  it('R25 켬: 한 덩어리 안 "15번 엘레강스"(1.5초 쉼) "이만원" → 15번 · 엘레강스 · 20,000원 등록, 카드 0', () => {
    const r = simulate([{ text: '15번 엘레강스', at: 0 }, { text: '이만원', at: 1500 }], 5000, { autoRegister: true })
    expect(r.cards).toEqual([])
    expect(r.registered.map(({ no, name, price }) => ({ no, name, price }))).toEqual([{ no: 15, name: '엘레강스', price: 20_000 }])
  })

  it('R53 끔: "15번" → 카드 "품종·가격을 말해 주세요"(V2 문구), 이어서 "엘레강스 이만원"이면 채움 (V2 S3)', () => {
    const r = simulate([{ text: '15번', at: 0 }], 3000)
    expect(openCards(r.cards).map(view)).toEqual([{ no: 15, name: null, price: null }])
    const create = r.actions[0]?.action
    expect(create?.kind === 'create' ? create.ask : null).toBe('품종·가격을 말해 주세요')
    const filled = simulate([{ text: '엘레강스 이만원', at: 4000 }], 7000, { cards: r.cards })
    expect(openCards(filled.cards).map(view)).toEqual([{ no: 15, name: '엘레강스', price: 20_000 }])
  })

  // TD-V3-003: 켬에서 정정 덩어리의 새 카드는 '원' 가격이 있을 때만 남는다(D-V3-44 "정정 덩어리로 만든 새 카드(D-V2-14)…처럼 원 가격은 있는데
  // 바로 등록하지 않는 카드"). 구현(target.ts createOrRemember)은 정정 말만 있으면 원 없는 가격(만오천·만팔천)으로도 카드를 만든다.
  it.each(['15번 만오천 아니 만팔천', '만팔천 말고 15번', '15번 라울 만오천말고 만팔천', '15번 만오천 다시 만팔천'])('TD-V3-003 켬: 원 없는 정정 덩어리 "%s" → 카드 0, 기록 "가격을 못 들었어요"', (text) => {
    const r = simulate([{ text, at: 0 }], 3000, { autoRegister: true })
    expect(r.cards).toEqual([])
    expect(r.actions.map(({ action }) => (action.kind === 'discard' ? action.reason : action.kind))).toEqual(['가격을 못 들었어요'])
  })

  it('켬: 원 가격이 든 정정 덩어리 "15번 만오천원 아니 만팔천원" → 카드 15번 · 18,000원은 남는다 (D-V2-14, D-V3-44)', () => {
    const r = simulate([{ text: '15번 만오천원 아니 만팔천원', at: 0 }], 3000, { autoRegister: true })
    expect(openCards(r.cards).map(view)).toEqual([{ no: 15, name: null, price: 18_000 }])
  })

  it("켬에서 '원' 가격 없는 결과는 어떤 말이어도 카드 0 (덩어리 둘 이어도, 정정 말이 섞여도)", () => {
    const words = fc.constantFrom(
      '15번', '십오번', '108번', '15 번', '일육팔', '170', '168은', '핑크문', '라울', '핑크프릴', '엘레강스', '만오천', '만팔천', '오천', '이만', '10만', '25만', '자', '요 아이', '3강', '9cm에',
      'bts', '이번', '한 번', '아니', '말고', '만오천말고', '다시', '품종은', '가격은', '취소', '그런가요', '오타', '하나',
    )
    fc.assert(
      fc.property(fc.array(fc.array(words, { minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 3 }), (chunks) => {
        const results = chunks.map((parts, i) => ({ text: parts.join(' '), at: i * 4000 }))
        const r = simulate(results, chunks.length * 4000 + 3000, { autoRegister: true })
        expect(r.cards, JSON.stringify(results.map((x) => x.text))).toEqual([])
        expect(r.registered).toEqual([])
      }),
      { numRuns: 500 },
    )
  })

  it('번호 없는 덩어리는 어떤 말이어도 새 카드를 만들지 않는다 (채울 카드가 없을 때)', () => {
    const words = fc.constantFrom('핑크문', '라울', '만원', '25만 원', '칠만 원', '자', '요 아이', '3강', '9cm에', 'bts', '오천', '삼광색금', '예쁘게')
    fc.assert(
      fc.property(fc.array(words, { minLength: 1, maxLength: 8 }), (parts) => {
        const r = simulate([{ text: parts.join(' '), at: 0 }], 3000)
        expect(r.cards).toEqual([])
      }),
      { numRuns: 300 },
    )
  })
})
