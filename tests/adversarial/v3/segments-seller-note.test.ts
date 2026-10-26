// V3 적대 시험 (test-domain, R-17 8 조각, D-V3-46·47·48·51·68, 사례 R54~R68): 덩어리 조각 소비(readSegments)를 공격하고, 판매자 채팅 읽기(R-23)가 없어졌는지 본다(D-V3-68).
// 노리는 것: 이어 말한 여러 상품이 엉뚱하게 짝지어짐, 대화 속 '아니'·'다시'가 정정이 됨, 가격 뒤 번호가 중간 결과에서 짝지어짐, 원 없는 수가 가격이 됨,
// 판매자 글이 아닌 모양에서 품종을 배움, 대괄호·₩ 여럿, 품종 글에 태그·이모지.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readSegments, prepareVoiceDictionary, type SegmentOptions } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const DICT = prepareVoiceDictionary()
const ROOT = join(import.meta.dirname, '../../..')
const seg = (text: string, options: SegmentOptions = {}) => readSegments(text, { dictionary: DICT, final: true, ...options })
const picks = (text: string, options: SegmentOptions = {}) => seg(text, options).picks.map((p) => ({ no: p.no, name: p.name, price: p.price }))

describe('조각 소비 — 사례 표 R54~R68', () => {
  it.each([
    ['R54 이어 말한 두 상품', '93번 청개구리 7만 원 97번 23만 원', [{ no: 93, name: '청개구리', price: 70_000 }, { no: 97, name: null, price: 230_000 }], []],
    ['R55 앞 번호는 가격 없이 버림 + 알림', '93번 청개구리 97번 23만 원', [{ no: 97, name: null, price: 230_000 }], [93]],
    ['R56 번호 없던 앞 가격은 버림', '만 원짜리 아니고요 97번 23만 원', [{ no: 97, name: null, price: 230_000 }], []],
    ['R57 남은 번호는 알림', '108번 10만 원 109번', [{ no: 108, name: null, price: 100_000 }], [109]],
    ['R58 조각 둘', '107번 10만 원 108번 12만 원', [{ no: 107, name: null, price: 100_000 }, { no: 108, name: null, price: 120_000 }], []],
    ['R65 대화 속 아니', '자 55번 갑니다 55번 자 요거 만 원 아니 가격이 좀 있는 거부터 달라니까', [{ no: 55, name: null, price: 10_000 }], []],
    ['R68 대화 속 다시', '자 다시 보여 드릴게요 15번 라울 만 원', [{ no: 15, name: '라울', price: 10_000 }], []],
    // D-V3-74(TE-V3-013): 번호보다 먼저 말한 품종도 조각 범위 안에서 잡는다 → 139번 · 빅뱅금 (처음 기대 "품종 없음"을 바꿈)
    ['실제 방송 6 (189·139)', '어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요', [{ no: 139, name: '빅뱅금', price: 500_000 }], [189]],
  ] as const)('%s: "%s"', (_title, text, want, others) => {
    const r = seg(text)
    expect(r.picks.map((p) => ({ no: p.no, name: p.name, price: p.price }))).toEqual(want)
    expect(r.others).toEqual(others)
  })

  // D-V3-74: 번호 앞 품종은 조각 범위 안에서만 — 앞 'N번' 바로 뒤 품종은 그 번호 것이라 다음 번호에 붙지 않는다
  it.each([
    ['93번 청개구리 97번 23만 원', [{ no: 97, name: null, price: 230_000 }]],
    ['라울 15번 16번 2만 원', [{ no: 16, name: null, price: 20_000 }]],
    ['라울 15번 2만 원', [{ no: 15, name: '라울', price: 20_000 }]],
    ['라울 자 요거 15번 2만 원', [{ no: 15, name: '라울', price: 20_000 }]],
    ['15번 라울 2만 원 16번 3만 원', [{ no: 15, name: '라울', price: 20_000 }, { no: 16, name: null, price: 30_000 }]],
    ['15번 2만 원 라울 16번 3만 원', [{ no: 15, name: null, price: 20_000 }, { no: 16, name: '라울', price: 30_000 }]],
    ['녹음 89번 3만 원', [{ no: 89, name: null, price: 30_000 }]], // 흔한 말 별칭은 N번 조각 안(번호 뒤)에서만 (D-V3-54)
  ] as const)('D-V3-74 번호 앞 품종 "%s"', (text, want) => {
    expect(seg(text).picks.map((p) => ({ no: p.no, name: p.name, price: p.price }))).toEqual(want)
  })

  // D-V3-73: '번' 없는 번호는 덩어리의 첫 조각에서만 — 등록으로 소비된 뒤 남은 조각의 맨 수는 번호가 아니다 (TE-V3-012, R6)
  it.each([
    ['R6 실제 방송 5', '자 9cm에 자 9cm에 3번 자 3강 세금 뿌리 다 남았고요 얘는 자 25만 원 170 자 요런 색금 예쁘게 나왔습니다 이거 25만 원 3강 세금 170 자 이 703강 세금이 자 25만 원까지', [[3, '삼광색금', 250_000]]],
    ['남은 조각 "170 25만 원"', '15번 2만 원 170 25만 원', [[15, null, 20_000]]],
    ['남은 조각 "자 170 자 25만 원"', '15번 2만 원 자 170 자 25만 원', [[15, null, 20_000]]],
    ['남은 조각 "일육팔 25만 원"', '15번 2만 원 일육팔 25만 원', [[15, null, 20_000]]],
    ['첫 조각의 맨 수는 그대로 번호 (N번 없는 덩어리)', '170 25만 원', [[170, null, 250_000]]],
  ] as const)('D-V3-73 %s', (_t, text, want) => {
    expect(seg(text).picks.map((p) => [p.no, p.name, p.price])).toEqual(want)
  })

  it('R59 등록 뒤 같은 덩어리의 원 없는 수(110)는 가격이 아니고 80번은 가격 없음 → 고를 것 없음, 80번 알림만', () => {
    const r = seg('97번 23만 원 자 요거 갑니다 자 110 자 갑니다 요거는 수수료도 안 나오겠네 자 9cm 자 9cm 80번 자요렇게 해주시고요')
    expect(r.picks.map((p) => [p.no, p.price])).toEqual([[97, 230_000]])
    expect(r.others).toEqual([80])
    expect(r.tail).toBeNull()
  })

  it.each([
    ['R60', '108번 10만원 아니 12만원', 108, 100_000, 'correction'],
    ['R66', '55번 만 원 아니 만오천 원', 55, 10_000, 'correction'],
    ['R20', '21번 핑크문 만원 취소', 21, 10_000, 'cancel'],
  ] as const)('%s "%s" → %i번 %i원 고르고, 남은 조각이 정정·취소면 그 번호로 tail', (_t, text, no, price, kind) => {
    const r = seg(text)
    expect(r.picks.map((p) => [p.no, p.price])).toEqual([[no, price]])
    expect(r.tail?.kind).toBe(kind)
    expect(r.tail?.no).toBe(no)
  })

  it.each([
    ['R61 최종 "92번 빅뱅 60"(천원) → 60,000원', '92번 빅뱅 60', true, [{ no: 92, name: '빅뱅', price: 60_000 }]],
    ['R62 중간 결과 "92번 빅뱅 60"은 기다림', '92번 빅뱅 60', false, []],
    ['R62 이어 "92번 빅뱅 60만 원" → 600,000원', '92번 빅뱅 60만 원', false, [{ no: 92, name: '빅뱅', price: 600_000 }]],
    ['R63 "92번 빅뱅 6만 자" → 60,000원(적힌 대로)', '92번 빅뱅 6만 자', false, [{ no: 92, name: '빅뱅', price: 60_000 }]],
    // D-V3-63: 품종 없는 "N번 수"도 조각 끝 + 최종이면 가격 단위로 확정 (처음 기대 "확정 아님"을 바꿈), 중간 결과면 기다림
    ['R64 품종 없음 "92번 60"(최종)', '92번 60', true, [{ no: 92, name: null, price: 60_000 }]],
    ['R64 군말만 "92번 저거 60"(최종)', '92번 저거 60', true, [{ no: 92, name: null, price: 60_000 }]],
    ['R64 중간 결과 "92번 60"', '92번 60', false, []],
  ] as const)('%s', (_t, text, final, want) => {
    expect(picks(text, { final, priceUnit: 'THOUSAND' })).toEqual(want)
  })

  it('R62 낱말 하나씩 늘려 넣기 "92번 빅뱅 60만 원"(천원): 어느 중간 결과에서도 60,000원을 고르지 않는다', () => {
    const tokens = '92번 빅뱅 60만 원'.split(' ')
    for (let k = 1; k <= tokens.length; k++) {
      for (const p of seg(tokens.slice(0, k).join(' '), { final: k === tokens.length, priceUnit: 'THOUSAND' }).picks) expect(p.price).toBe(600_000)
    }
    const spaced = '92번 빅뱅 60 만 원'.split(' ')
    for (let k = 1; k <= spaced.length; k++) {
      for (const p of seg(spaced.slice(0, k).join(' '), { final: k === spaced.length, priceUnit: 'THOUSAND' }).picks) expect(p.price, spaced.slice(0, k).join(' ')).toBe(600_000)
    }
  })

  it.each([
    ['R69 "육십팔번 이십오"(만원, 최종) → 68번 · 250,000원', '육십팔번 이십오', true, [{ no: 68, name: null, price: 250_000 }]],
    ['R70 중간 결과 "육십팔번 이십오" → 기다림', '육십팔번 이십오', false, []],
    ['R70 이어 "육십팔번 이십오만 원" → 250,000원', '육십팔번 이십오만 원', false, [{ no: 68, name: null, price: 250_000 }]],
    ['R71 뒤 단위 낱말 "68번 25 개" → 가격 아님', '68번 25 개', true, []],
    ['뒤 단위 낱말 "68번 25 마리"·"68번 9 cm"', '68번 25 마리', true, []],
    ['R72 수 뒤 군말만 "68번 이십오 자 요거" → 250,000원', '68번 이십오 자 요거', true, [{ no: 68, name: null, price: 250_000 }]],
    ['R73 한 자리 수 "68번 3" → 번호 비움', '68번 3', true, []],
    ['한 글자 한글 수 "68번 오" → 번호 비움', '68번 오', true, []],
    ['수 뒤에 다른 낱말 "68번 25 뿌리" → 조각 끝 아님', '68번 25 뿌리', true, []],
  ] as const)('D-V3-63 %s', (_t, text, final, want) => {
    expect(picks(text, { final, priceUnit: 'TEN_THOUSAND' })).toEqual(want)
  })

  // D-V3-64: 가격 크기로 막지 않는다 — 300만 원 넘으면 바로 등록하고 R-25 "크게 바뀜" 표시만 (처음 기대 "막힘"을 바꿈)
  it('D-V3-63·64 만원 단위 "68번 400"(최종) → 4,000,000원 바로 등록 + 크게 바뀜, 딱 300 = 3,000,000원은 표시 없음', () => {
    const over = seg('68번 400', { priceUnit: 'TEN_THOUSAND' }).picks
    expect(over.map((p) => [p.no, p.price, p.blocked, p.bigChange])).toEqual([[68, 4_000_000, null, true]])
    const edge = seg('68번 300', { priceUnit: 'TEN_THOUSAND' }).picks
    expect(edge.map((p) => [p.no, p.price, p.blocked, p.bigChange])).toEqual([[68, 3_000_000, null, false]])
  })

  it('D-V3-63 낱말 하나씩 늘려 넣기: 품종 없는 "N번 수"는 어느 중간 결과에서도 고르지 않는다', () => {
    for (const text of ['육십팔번 이십오', '68번 25', '자 92번 저거 60', '92번 60 자']) {
      const tokens = text.split(' ')
      for (let k = 1; k <= tokens.length; k++) {
        const quick = seg(tokens.slice(0, k).join(' '), { final: false, priceUnit: 'TEN_THOUSAND' }).picks.filter((p) => p.priceFrom === 'quick' && p.name === null)
        expect(quick, tokens.slice(0, k).join(' ')).toEqual([])
      }
    }
  })

  it('가격 뒤 번호 꼴("10만 원 108번")은 덩어리 끝(final)에서만 짝짓는다 (D-V3-46, 실제 방송 2)', () => {
    expect(picks('10만 원 108번', { final: false })).toEqual([])
    expect(picks('10만 원 108번', { final: true })).toEqual([{ no: 108, name: null, price: 100_000 }])
    // BTS는 영수증으로 사전 품종(be4400ab) — 품종 칸은 BTS, 사전 밖 낱말(ufo)이면 빈칸
    expect(picks('자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번', { final: false })).toEqual([])
    expect(picks('자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번', { final: true })).toEqual([{ no: 108, name: 'BTS', price: 100_000 }])
    expect(picks('자 ufo는 자 ufo 요거 그대로 보냅니다 요 아이 자 10만 원 108번', { final: false })).toEqual([])
    expect(picks('자 ufo는 자 ufo 요거 그대로 보냅니다 요 아이 자 10만 원 108번', { final: true })).toEqual([{ no: 108, name: null, price: 100_000 }])
  })

  // 시청자 번호 섞임 위험: 판매자가 시청자 말을 읽으면 그 번호가 원 가격 바로 앞 N번이 되어 짝지어진다(스펙대로). 앞 번호는 알림(others)으로 반드시 남아야 한다.
  it('위험 사례: "15번 라울 지영님 3번 달래요 만 원" → 스펙대로 3번 · 10,000원이고 15번은 알림에 남는다', () => {
    const r = seg('15번 라울 지영님 3번 달래요 만 원')
    expect(r.picks.map((p) => [p.no, p.price])).toEqual([[3, 10_000]])
    expect(r.others).toEqual([15])
  })
  // D-V3-54: `1 5번`은 앞 수와 합쳐 15번 — 같은 번호 되풀이라 15번 · 10,000원 하나 (처음 기대 "고르지 않음"을 바꿈). 자리가 겹치면 비움
  it('"15번 1 5번 만 원" → 15번 · 10,000원, 겹치는 "오 13번 만 원"·"50 13번 만 원" → 고르지 않음', () => {
    expect(picks('15번 1 5번 만 원')).toEqual([{ no: 15, name: null, price: 10_000 }])
    expect(picks('오 13번 만 원')).toEqual([])
    expect(picks('50 13번 만 원')).toEqual([])
  })
})

describe('조각 소비 — 성질', () => {
  const VOCAB = [
    '15번', '16번', '93번', '97번', '108번', '15 번', '일육팔번', '170', '1', '5번', '만 원', '23만 원', '10만원', '7만 원까지', '만오천', '60', '6만', '605만 원', '라울', '청개구리', '빅뱅',
    '자', '요거', '갑니다', '아니', '아니고요', '다시', '말고', '취소', '가격이', '보여', '9cm', '지영님', '달래요', '그런가요',
  ] as const
  it('고른 값: 번호 1..999 · 가격 100원 이상 · 어떤 가격도 막지 않고 300만 원 넘으면 크게 바뀜(D-V3-64) · 조각이 겹치지 않고 차례대로 · 원 가격이면 조각 안에 원 토큰, 품종 없는 빠른 꼴은 최종만', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...VOCAB), { minLength: 1, maxLength: 14 }), fc.boolean(), fc.constantFrom<'WON' | 'THOUSAND' | 'TEN_THOUSAND' | 'AUTO'>('WON', 'THOUSAND', 'TEN_THOUSAND', 'AUTO'), (parts, final, priceUnit) => {
        const r = readSegments(parts.join(' '), { dictionary: DICT, final, priceUnit })
        let last = -1
        for (const p of r.picks) {
          expect(p.no).toBeGreaterThanOrEqual(1)
          expect(p.no).toBeLessThanOrEqual(999)
          expect(p.price).toBeGreaterThanOrEqual(100)
          expect(Number.isSafeInteger(p.price)).toBe(true)
          expect(p.blocked).toBeNull()
          expect(p.bigChange).toBe(p.price > 3_000_000)
          expect(p.start).toBeGreaterThan(last)
          expect(p.end).toBeGreaterThanOrEqual(p.start)
          last = p.end
          const piece = r.tokens.slice(p.start, p.end + 1)
          if (p.priceFrom === 'won') expect(piece.some((t) => /원/.test(t)), piece.join(' ')).toBe(true)
          // 번호는 N번 표시, 아니면 가격 앞의 '번' 없는 번호(R-17 3, `170 25만 원` — D-V3-25 자리 겹침)
          if (p.numberFrom === 'marker') expect(piece.some((t) => /번/.test(t)), `번호 없는 조각: ${piece.join(' ')}`).toBe(true)
          else expect(piece.findIndex((t) => /^[0-9일이삼사오육칠팔구십백천]+$/.test(t))).toBeLessThan(piece.findIndex((t) => /원/.test(t)))
          // D-V3-63: 품종 없는 빠른 꼴은 최종일 때만 (D-V3-48 품종 있는 꼴은 수가 글 끝이 아니면 중간 결과도)
          if (p.priceFrom === 'quick' && p.name === null) expect(final, `중간 결과에서 품종 없는 빠른 꼴: ${piece.join(' ')}`).toBe(true)
        }
        // 중간 결과에서 가격 뒤 번호 꼴은 짝짓지 않는다: 원 토큰보다 번호가 뒤에만 있는 조각은 final일 때만
        if (!final) for (const p of r.picks) {
          const piece = r.tokens.slice(p.start, p.end + 1)
          const firstWon = piece.findIndex((t) => /원/.test(t))
          if (p.priceFrom === 'won' && p.numberFrom === 'marker' && firstWon >= 0) expect(piece.slice(0, firstWon).some((t) => /번/.test(t)), `중간 결과에서 가격 뒤 번호: ${piece.join(' ')}`).toBe(true)
        }
      }),
      { numRuns: 1500 },
    )
  })

  it('어떤 입력에도 예외를 던지지 않는다', () => {
    for (const x of [null, undefined, 3, {}, [], '', '   ', '번 원', 'a'.repeat(5000), '15번 '.repeat(200) + '만 원']) expect(() => readSegments(x, { dictionary: DICT })).not.toThrow()
  })
})

// D-V3-68(결정 변경 — 약화 아님): 판매자 채팅 읽기(R-23)를 없앴다. 판매자 채팅 "N번[품종] ₩가격 …님 감사합니다"는 라이브지니가 감사 메시지로
// 대신 올릴 글이라, 읽어 배우면 자기 글을 되먹는 고리가 된다. 그래서 지난 readSellerNote 공격(TD-V3-004 포함)은 "없음 확인"으로 바꾼다.
describe('D-V3-68 판매자 채팅 읽기 없음', () => {
  it('음성 패키지에 판매자 채팅 읽기가 없다 (함수·하위 경로·골든)', async () => {
    const voice = (await import('@livejjim/voice')) as Record<string, unknown>
    expect(Object.keys(voice).filter((key) => /seller/i.test(key))).toEqual([])
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages/voice/package.json'), 'utf8')) as { exports: Record<string, string> }
    expect(Object.keys(manifest.exports).filter((key) => /seller/i.test(key))).toEqual([])
    expect(existsSync(join(ROOT, 'packages/voice/src/seller-note.ts'))).toBe(false)
    expect(existsSync(join(ROOT, 'tests/golden/voice-register/seller-note.json'))).toBe(false)
  })

  it('판매자 채팅 꼴을 음성으로 말해도 "₩"·대괄호 글은 품종이 되지 않는다 (사전 맞춤만)', () => {
    const picks = readSegments('93번 [청개구리] ₩70,000 [용용]님 감사합니다 93번 7만 원', { dictionary: DICT, final: true }).picks
    expect(picks.every((p) => p.name === null || !/[[\]₩]/.test(p.name))).toBe(true)
  })
})
