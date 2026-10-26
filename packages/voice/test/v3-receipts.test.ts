// 실방송 3회 판매자 영수증의 품종 이름 — 사전에 넣은 이름과 들린 모양(크롬 받아쓰기: 색금 → 색급, 녹금 → 녹음·높금)
import { describe, expect, it } from 'vitest'
import { DEFAULT_VARIETIES, prepareVoiceDictionary, readSegments } from '../src/index.ts'

const DICT = prepareVoiceDictionary()
const nameOf = (text: string, dictionary = DICT) => readSegments(text, { dictionary, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.price, p.name])

const RECEIPT_NAMES = [
  'BTS', 'SP', 'SP녹금', '가시꽃', '넘버원', '녹금', '녹금의 제왕', '녹색금', '레다', '로라클론', '로제수박', '로제스타수박', '리마인드', '립스틱금', '립스틱색금', '몰디브',
  '보카치노', '불꽃수박금', '빅뱅', '삼광색금', '소쇄원 녹금', '수박금', '야래향', '오스카', '인디안바손', '찐녹금', '창금', '창녹금', '창버건디', '창색금', '청개구리',
  '청개구리금', '청사과', '컬러풀', '콜리', '팔색조', '퍼플', '풀잎사랑', '하이원', '호반금', '황소',
]

describe('영수증 품종 이름', () => {
  it('모두 사전 이름이다 (녹색금은 따로 이름, 녹금 별칭 아님 — D-V3-92)', () => {
    const names = new Set(DEFAULT_VARIETIES.map((item) => item.name))
    for (const name of RECEIPT_NAMES) expect(names.has(name), name).toBe(true)
    expect(DEFAULT_VARIETIES.find((item) => item.name === '녹금')?.aliases).not.toContain('녹색금')
  })
  it.each(RECEIPT_NAMES)("'10번 %s 5만 원' → 그 이름", (name) => {
    expect(nameOf(`10번 ${name} 5만 원`)).toEqual([[10, 50_000, name]])
  })
  it('로마자 이름은 소문자·한글 읽기로도', () => {
    expect(nameOf('108번 bts 10만 원')).toEqual([[108, 100_000, 'BTS']])
    expect(nameOf('108번 비티에스 10만 원')).toEqual([[108, 100_000, 'BTS']])
    expect(nameOf('10번 sp 5만 원')).toEqual([[10, 50_000, 'SP']])
    expect(nameOf('10번 에스피 5만 원')).toEqual([[10, 50_000, 'SP']])
    expect(nameOf('10번 sp 녹금 5만 원')).toEqual([[10, 50_000, 'SP녹금']])
    expect(nameOf('10번 SP 녹음 5만 원')).toEqual([[10, 50_000, 'SP녹금']])
    expect(nameOf('10번 에스피 녹금 5만 원')).toEqual([[10, 50_000, 'SP녹금']])
  })
  it('띄어 말해도·붙여 말해도, 녹금은 녹음·높금으로 들려도', () => {
    expect(nameOf('11번 녹금의제왕 5만 원')).toEqual([[11, 50_000, '녹금의 제왕']])
    expect(nameOf('11번 녹금에 제왕 5만 원')).toEqual([[11, 50_000, '녹금의 제왕']])
    expect(nameOf('11번 녹음의 제왕 5만 원')).toEqual([[11, 50_000, '녹금의 제왕']])
    expect(nameOf('12번 소쇄원녹금 5만 원')).toEqual([[12, 50_000, '소쇄원 녹금']])
    expect(nameOf('12번 소쇄원 녹음 5만 원')).toEqual([[12, 50_000, '소쇄원 녹금']])
    expect(nameOf('20번 인디안 바손 5만 원')).toEqual([[20, 50_000, '인디안바손']])
    expect(nameOf('21번 찐 녹음 5만 원')).toEqual([[21, 50_000, '찐녹금']])
    expect(nameOf('22번 높금 5만 원')).toEqual([[22, 50_000, '녹금']])
    expect(nameOf('23번 창 높금 5만 원')).toEqual([[23, 50_000, '창녹금']])
  })
  it('긴 이름이 이긴다 — 황소개구리·청개구리금·녹금의 제왕', () => {
    expect(nameOf('13번 황소 5만 원')).toEqual([[13, 50_000, '황소']])
    expect(nameOf('13번 황소개구리 5만 원')).toEqual([[13, 50_000, '황소개구리']])
    expect(nameOf('26번 청개구리금 5만 원')).toEqual([[26, 50_000, '청개구리금']])
    expect(nameOf('15번 퍼플퀸 5만 원')).toEqual([[15, 50_000, '퍼플퀸']])
  })
  it('흔한 말에 섞인 2음절 이름은 이름이 되지 않는다', () => {
    expect(nameOf('14번 자 이거 황소처럼 튼튼해요 5만 원')).toEqual([[14, 50_000, null]])
    expect(nameOf('30번 색깔이 너무 컬러풀하죠 5만 원')).toEqual([[30, 50_000, null]])
  })
  it('2음절 이름은 비슷한 모양으로 맞추지 않는다 (적은 모양만)', () => {
    for (const heard of ['레드', '콜라', '퍼즐', '황수', '창극']) expect(nameOf(`10번 ${heard} 5만 원`), heard).toEqual([[10, 50_000, null]])
  })
})

describe("이름 끝 '색급'은 '색금'으로", () => {
  it('사전 이름', () => {
    expect(nameOf('16번 창색급 5만 원')).toEqual([[16, 50_000, '창색금']])
    expect(nameOf('16번 창 색급이고요 5만 원')).toEqual([[16, 50_000, '창색금']])
    expect(nameOf('19번 립스틱 색급 5만 원')).toEqual([[19, 50_000, '립스틱색금']])
    expect(nameOf('18번 삼광 색급 5만 원')).toEqual([[18, 50_000, '삼광색금']])
  })
  it("'X색금'이 있으면 X보다 X색금, 없으면 X", () => {
    expect(nameOf('17번 몰디브 색급 5만 원')).toEqual([[17, 50_000, '몰디브']])
    const withSaekgeum = prepareVoiceDictionary({ base: [{ name: '몰디브' }, { name: '몰디브색금' }] })
    expect(nameOf('17번 몰디브 색급 5만 원', withSaekgeum)).toEqual([[17, 50_000, '몰디브색금']])
    expect(nameOf('17번 몰디브 5만 원', withSaekgeum)).toEqual([[17, 50_000, '몰디브']])
  })
  it("'색급' 하나만으로는 이름이 아니다", () => {
    expect(nameOf('15번 색급 5만 원')).toEqual([[15, 50_000, null]])
  })
  it('같은 이름의 두 모양(상관세금·3강색급)이 함께 들리면 그 이름', () => {
    expect(nameOf('180번 상관 세금 자 요 아이 자 3강색급 35만 원')).toEqual([[180, 350_000, '삼광색금']])
  })
})

describe('녹색금은 녹금과 다른 이름 (D-V3-92)', () => {
  it('녹색금·바이칼녹색금은 따로 이름이고 녹금·바이칼녹금의 별칭이 아니다', () => {
    const names = new Set(DEFAULT_VARIETIES.map((item) => item.name))
    expect(names.has('녹색금')).toBe(true)
    expect(names.has('바이칼녹색금')).toBe(true)
    expect(DEFAULT_VARIETIES.find((item) => item.name === '바이칼녹금')?.aliases).not.toContain('바이칼 녹색금')
  })
  it('말한 이름 그대로', () => {
    expect(nameOf('430번 녹색금 5만 원')).toEqual([[430, 50_000, '녹색금']])
    expect(nameOf('89번 녹금 7만 원')).toEqual([[89, 70_000, '녹금']])
    expect(nameOf('5번 바이칼 녹색금 5만 원')).toEqual([[5, 50_000, '바이칼녹색금']])
    expect(nameOf('5번 바이칼녹금 5만 원')).toEqual([[5, 50_000, '바이칼녹금']])
  })
  it('한 조각에 녹금·녹색금이 함께 들리면 품종을 비운다 — 한 글자 다른 이름(녹색금 ↔ 창색금)으로 채우지 않는다', () => {
    expect(nameOf('89번 녹금 녹색금 7만 원')).toEqual([[89, 70_000, null]])
    expect(nameOf('89번 녹색금 녹금 7만 원')).toEqual([[89, 70_000, null]])
    expect(nameOf('89번 록금 녹색금 7만 원')).toEqual([[89, 70_000, null]])
    expect(nameOf('녹금 녹색금 89번 7만 원')).toEqual([[89, 70_000, null]])
    expect(nameOf('5번 바이칼 녹금 바이칼 녹색금 5만 원')).toEqual([[5, 50_000, null]])
  })
  it('사전 이름을 못 들었을 때만 한 글자 다른 이름·흔한 말 별칭으로 채운다 (그대로)', () => {
    expect(nameOf('89번 야래양 7만 원')).toEqual([[89, 70_000, '야래향']])
    expect(nameOf('89번 녹음 7만 원')).toEqual([[89, 70_000, '녹금']])
  })
})
