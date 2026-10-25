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
    ['R49 실방송 4차', '자 컬러풀 약간 자 컬러풀 이거 네 10만 원 75번입니다', 75, 100_000],
    ['실제 방송 2 (bts 두 번)', '자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번', 108, 100_000],
    ['실제 방송 1', '네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요', 108, 100_000],
    ['붙어·한번·생활과', '46번 붙어 한번 생활과 붙어 생활과 야량 5만 원', 46, 50_000],
  ])('%s → 품종 미입력으로 등록', (_title, text, no, price) => {
    const ready = readRegistration(text, { dictionary: DICT, final: true }).ready
    expect(ready).toEqual({ no, price, name: null, nameNeedsCheck: false, numberFrom: 'marker' })
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

  it('R51 "15번" → 작은 카드 하나 "가격을 말하면 바로 등록돼요", 이어서 "엘레강스 이만원"이면 채워진다', () => {
    const r = simulate([{ text: '15번', at: 0 }], 3000)
    expect(openCards(r.cards).map(view)).toEqual([{ no: 15, name: null, price: null }])
    const create = r.actions[0]?.action
    expect(create?.kind === 'create' ? create.ask : null).toBe('가격을 말하면 바로 등록돼요')
    const filled = simulate([{ text: '엘레강스 이만원', at: 4000 }], 7000, { cards: r.cards })
    expect(openCards(filled.cards).map(view)).toEqual([{ no: 15, name: '엘레강스', price: 20_000 }])
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
