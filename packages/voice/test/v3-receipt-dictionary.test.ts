// AC-V3-100 (a)~(d) 판매자 제공 판매 영수증 거래명 사전 (R-17 5, D-V3-115). 성능 (e)는 receipt-dictionary.perf.test.ts(pnpm perf).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compact, DEFAULT_VARIETIES, extractVoice, prepareVoiceDictionary, readSegments, varietyFromContext } from '../src/index.ts'

interface Entry {
  readonly name: string
  readonly aliases: readonly string[]
  readonly exactOnly?: boolean
  readonly receipt?: boolean
}
const file = JSON.parse(readFileSync(new URL('../data/varieties.ko.json', import.meta.url), 'utf8')) as { varieties: Entry[] }
// 영수증 거래명은 데이터 끝에 이어 붙였다 — 그 앞 마지막 이름은 실방송 3회 영수증의 '황소'
const start = file.varieties.findIndex((item) => item.name === '황소') + 1
const added = file.varieties.slice(start)
const DICT = prepareVoiceDictionary()
const nameOf = (text: string) => readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => p.name)

describe('AC-V3-100 영수증 거래명 사전 (D-V3-115)', () => {
  it('(a) 거른 이름 677개(681개에서 재생 점수를 떨어뜨린 4개를 뺌 — D-V3-115 (나)·(라), 창무지는 D-V3-116으로 다시 넣음)를 별칭 없이 이름으로, 출처 표기는 판매자 제공 판매 영수증 거래명', () => {
    expect(start).toBeGreaterThan(0)
    expect(added).toHaveLength(677)
    for (const item of added) expect(item.receipt, item.name).toBe(true)
    for (const item of file.varieties.slice(0, start)) expect(item.receipt, item.name).toBeUndefined()
    for (const item of added) expect(item.aliases, item.name).toEqual([])
    for (const name of ['SP색금', '슈빌', '보스실생', '퍼플마리아 금', '환엽마리아', '몰디브색금', '녹금철화']) expect(added.map((item) => item.name)).toContain(name)
    expect(readFileSync(new URL('../src/default-dictionary.ts', import.meta.url), 'utf8')).toContain('판매자 제공 판매 영수증 거래명')
    expect(DEFAULT_VARIETIES).toHaveLength(file.varieties.length)
  })

  it('(b) 지금 이름과 공백 뺀 모양(로마자 대소문자 무시)이 같은 것·흔한 말 하나뿐인 것·화분·크기 같은 일반 낱말은 없다', () => {
    const keys = file.varieties.map((item) => compact(item.name).toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
    const names = new Set(file.varieties.map((item) => item.name))
    for (const word of ['환엽', '돌기', '핏줄', '쪽빛', '골드빛', '골드', '크랙', '손톱', '수박', '복륜금', '군생', '특이종', '교배종', '수입종', '명품', '순수', '아래', '이름표', '접시', '망치', '사각롱분', '핀셋 소형', '색금 자구'])
      expect(names.has(word), word).toBe(false)
  })

  // D-V3-116: 처음 기대 "3글자 이상은 exactOnly 아님"을 바꿈 — (c)는 (g)에 든다
  it('(c)·(g) 이번에 더한 영수증 이름은 길이와 상관없이 모두 exactOnly, 손으로 고른 이름의 exactOnly 표시는 그대로(콜리·퍼플·창금·황소·레다·SP)', () => {
    for (const item of added) expect(item.exactOnly, item.name).toBe(true)
    const hand = file.varieties.slice(0, start).filter((item) => item.exactOnly === true).map((item) => item.name)
    expect(hand.sort()).toEqual(['SP', '레다', '창금', '콜리', '퍼플', '황소'].sort())
    for (const item of DEFAULT_VARIETIES.slice(start)) expect(item.exactOnly, item.name).toBe(true)
    for (const item of DEFAULT_VARIETIES.slice(0, start)) expect(item.exactOnly, item.name).toBeUndefined()
    expect(nameOf('10번 슈빌 5만 원')).toEqual(['슈빌'])
    // 슈빌 ↔ 슈발(한 자모 차이)은 맞추지 않는다
    expect(nameOf('10번 슈발 5만 원')).toEqual([null])
  })

  it('긴 거래명은 들린 대로(공백만 다른 모양) 맞고, 한 자모 다른 모양으로는 맞지 않는다 (D-V3-116)', () => {
    expect(nameOf('10번 퍼플마리아 금 5만 원')).toEqual(['퍼플마리아 금'])
    expect(nameOf('10번 퍼플 마리아금 5만 원')).toEqual(['퍼플마리아 금'])
    expect(nameOf('10번 환엽마리아 5만 원')).toEqual(['환엽마리아'])
    expect(nameOf('10번 환엽마리야 5만 원')).toEqual([null])
  })

  describe('(h)~(j) 사전 [창무지(영수증 이름, exactOnly), 라울]', () => {
    const receipt = prepareVoiceDictionary({ base: [{ name: '창무지', exactOnly: true }, { name: '라울' }] })
    const seg = (text: string, dictionary = receipt) => readSegments(text, { dictionary, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.name, p.price])
    it('(h) "15번 근무지 5만 원" → 품종 빈 칸(한 글자 다른 이름에 영수증 이름을 쓰지 않음), 공백만 다른 모양·끝말 뗀 모양은 창무지', () => {
      expect(seg('15번 근무지 5만 원')).toEqual([[15, null, 50_000]])
      expect(seg('15번 창무지 5만 원')).toEqual([[15, '창무지', 50_000]])
      expect(seg('15번 창 무지 5만 원')).toEqual([[15, '창무지', 50_000]])
      expect(seg('15번 창무지이 5만 원')).toEqual([[15, '창무지', 50_000]])
      // 손으로 고른 이름은 한 글자 다른 이름 그대로 (라울은 3음절이 아니라 해당 없음 — 영수증 이름만 바뀐다)
      expect(seg('15번 라울 5만 원')).toEqual([[15, '라울', 50_000]])
    })
    it('(i) 같은 사전에서 창무지가 exactOnly가 아니면(손으로 고른 이름처럼) "15번 근무지 5만 원" → 창무지 — 지금 1a 그대로', () => {
      const hand = prepareVoiceDictionary({ base: [{ name: '창무지' }, { name: '라울' }] })
      expect(seg('15번 근무지 5만 원', hand)).toEqual([[15, '창무지', 50_000]])
    })
    it('(j) R-17 extract "15번 창무치 5만 원" → 품종 빈 칸(0.8 후보 아님), 판매 이력에 창무지가 있으면 창무지(이력은 그대로)', () => {
      expect(extractVoice('15번 창무치 5만 원', { dictionary: receipt }).name).toBeNull()
      const withHistory = prepareVoiceDictionary({ history: ['창무지'], base: [{ name: '창무지', exactOnly: true }, { name: '라울' }] })
      expect(extractVoice('15번 창무치 5만 원', { dictionary: withHistory }).name).toBe('창무지')
      const hand = prepareVoiceDictionary({ base: [{ name: '창무지' }, { name: '라울' }] })
      expect(extractVoice('15번 창무치 5만 원', { dictionary: hand }).name).toBe('창무지')
    })
  })
})

describe('재생 점수를 떨어뜨린 영수증 이름은 뺀다 (D-V3-115 (라) — 만든 문장)', () => {
  const names = new Set(file.varieties.map((item) => item.name))
  it('빛깔을 말하는 흔한 말 하나뿐인 이름(찐녹)은 없다 — 맥락 품종이 동점으로 비지 않는다 (D-V3-115 (나))', () => {
    expect(names.has('찐녹')).toBe(false)
    const context = ['요거 창금 보세요', '창금이에요 예쁘죠', '찐녹에 가까운 물듬 찐녹에 가까운 컬러']
    expect(varietyFromContext({ name: null, context, dictionary: DICT })).toBe('창금')
    // 찐녹이 이름이면 창금과 같은 점수로 갈려 빈 칸이 된다(뺀 까닭)
    const withColor = prepareVoiceDictionary({ base: [...DEFAULT_VARIETIES, { name: '찐녹', aliases: [] }] })
    expect(varietyFromContext({ name: null, context, dictionary: withColor })).toBeNull()
  })
  it('무늬 빛깔을 말하는 흔한 말(백금 — 흰 무늬)은 없다 — 설명으로 말한 것이 맥락 품종이 되고, 상품 이름이 되면 판매 이력처럼 0.8로 `색금`에 맞아 번져 나간다 (D-V3-115 (나))', () => {
    expect(names.has('백금')).toBe(false)
    // 설명으로 말한 "백금"이 번호 없는 따로 든 글이면 맥락 품종이 되던 것
    expect(varietyFromContext({ name: null, context: [], between: ['안쪽을 보시면 백금 약간 줄무늬가 선명해요'], dictionary: DICT })).toBeNull()
    const withWord = prepareVoiceDictionary({ base: [...DEFAULT_VARIETIES, { name: '백금', exactOnly: true }] })
    expect(varietyFromContext({ name: null, context: [], between: ['안쪽을 보시면 백금 약간 줄무늬가 선명해요'], dictionary: withWord })).toBe('백금')
    // 이 방송 상품 이름(판매 이력 자리)에 백금이 들면 0.8로 `색금`에 맞는다 — 이력은 지금 그대로(D-V3-116 (다))라 데이터에서 뺀다
    const text = '색금 잘 들었어요 자 25만원까지 143번'
    expect(readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.name])).toEqual([[143, null]])
    const asHistory = prepareVoiceDictionary({ history: ['백금'] })
    expect(readSegments(text, { dictionary: asHistory, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.name])).toEqual([[143, '백금']])
    // 백금이 든 긴 영수증 이름은 그대로
    expect(names.has('쿠스백금')).toBe(true)
  })
  it('번호 옆에서 들린 이름이 앞 말의 영수증 이름(앞에 SP가 붙은 것)으로 넓혀지지 않는다', () => {
    expect(names.has('SP찐녹금')).toBe(false)
    const context = ['자 SP 찐녹금 보세요', '요아이는 진해요']
    expect(varietyFromContext({ name: '찐녹금', context, dictionary: DICT })).toBe('찐녹금')
    // 있으면 맥락의 더 긴 이름으로 넓혀진다(품는 이름 규칙 — 뺀 까닭)
    const withSp = prepareVoiceDictionary({ base: [...DEFAULT_VARIETIES, { name: 'SP찐녹금', aliases: [] }] })
    expect(varietyFromContext({ name: '찐녹금', context, dictionary: withSp })).toBe('SP찐녹금')
  })
  it('한 글자 다른 흔한 낱말이 영수증 이름이 되지 않는다 — 창무지는 exactOnly로 다시 넣음 (D-V3-116)', () => {
    expect(names.has('창무지')).toBe(true)
    expect(nameOf('42번 사과 근무지 10만 원')).toEqual([null])
    expect(nameOf('42번 창무지 10만 원')).toEqual(['창무지'])
  })
  it('앞 상품 이름(번호 없이 가격과 함께 말함)이 맥락에서 따로 든 이름을 이기지 않는다', () => {
    expect(names.has('매직킹')).toBe(false)
    const context = ['매직킹은 5만까지', '자 매직킹 이렇게 5만 원 그리고 옵니다']
    expect(varietyFromContext({ name: null, context, between: ['소쇄원 녹금 보세요'], dictionary: DICT })).toBe('소쇄원 녹금')
    // 있으면 앞 상품 이름이 두 번 세어져 이긴다 — 뺀 까닭
    const withIt = prepareVoiceDictionary({ base: [...DEFAULT_VARIETIES, { name: '매직킹', aliases: [] }] })
    expect(varietyFromContext({ name: null, context: [...context, '매직킹 매직킹'], between: ['소쇄원 녹금 보세요'], dictionary: withIt })).toBe('매직킹')
  })
  it('얻은 것은 그대로 — 2글자 영수증 이름은 똑같이 들리면 맞는다', () => {
    expect(nameOf('10번 불꽃 5만 원')).toEqual(['불꽃'])
    expect(nameOf('10번 로제 5만 원')).toEqual(['로제'])
  })
})
