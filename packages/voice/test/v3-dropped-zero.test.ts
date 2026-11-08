// 빠진 0 되살리기 (실방송: "36번도 2만 원" = 306번, "38번 … 2만 원" = 308번)
import { describe, expect, it } from 'vitest'
import { fixDoubledDigit, fixDroppedZero, prepareVoiceDictionary, readSegments, type DroppedZeroProduct } from '../src/index.ts'

const products =
  (map: Record<number, number | 'closed'>) =>
  (no: number): DroppedZeroProduct => {
    const found = map[no]
    return found === undefined ? null : found === 'closed' ? 'closed' : { price: found }
  }
const LIVE = { 304: 20_000, 305: 20_000, 308: 20_000 }

describe('fixDroppedZero', () => {
  it('실방송: 304·308 다음 "36번" → 306번 (최근 등록 맥락)', () => {
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [304, 308], product: products({ 304: 20_000, 308: 20_000 }) })).toEqual({ no: 306, why: 'RECENT' })
  })
  it('실방송: 304·308·305 다음 "38번" → 308번 (같은 가격이면 바꾼다 — 같은 번호 무시가 받는다)', () => {
    expect(fixDroppedZero({ no: 38, price: 20_000, recent: [304, 308, 305], product: products(LIVE) })).toEqual({ no: 308, why: 'RECENT' })
    expect(fixDroppedZero({ no: 38, price: 20_000, recent: [304, 308, 306, 305], product: products({ ...LIVE, 306: 20_000 }) })).toEqual({ no: 308, why: 'RECENT' })
  })
  it('X0Y가 다른 가격으로 있거나 가격을 못 들었거나 판매 종료면 바꾸지 않는다', () => {
    expect(fixDroppedZero({ no: 38, price: 30_000, recent: [304, 305], product: products(LIVE) })).toBeNull()
    expect(fixDroppedZero({ no: 38, price: null, recent: [304, 305], product: products(LIVE) })).toBeNull()
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [304, 305], product: products({ 306: 'closed' }) })).toBeNull()
  })
  it('XY가 이미 상품이면(판매 종료 포함) 바꾸지 않는다', () => {
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [304, 305], product: products({ 36: 10_000 }) })).toBeNull()
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [304, 305], product: products({ 36: 'closed' }) })).toBeNull()
  })
  it('최근 등록이 하나뿐이거나, 가장 최근 둘 중 하나라도 ±20 밖이면 바꾸지 않는다', () => {
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [305], product: products({}) })).toBeNull()
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [304, 350], product: products({}) })).toBeNull()
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [350, 304], product: products({}) })).toBeNull()
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [290, 286], product: products({}) })).toEqual({ no: 306, why: 'RECENT' })
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [285, 304], product: products({}) })).toBeNull()
  })
  it('최근 등록에 XY 근처 번호가 있으면 바꾸지 않는다 (30번대를 팔다 돌아온 것)', () => {
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [35, 304, 305], product: products({}) })).toBeNull()
  })
  it('두 자리 1~9·1~9만: 한 자리·세 자리·끝이 0(30·40)은 그대로', () => {
    for (const no of [3, 6, 10, 30, 40, 100, 306, 0, -36, 3.6, Number.NaN]) expect(fixDroppedZero({ no, price: 20_000, recent: [304, 305], product: products({}) })).toBeNull()
  })
  it('번호 상한을 넘으면 바꾸지 않는다', () => {
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [304, 305], product: products({}), maxNumber: 300 })).toBeNull()
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [304, 305], product: products({}), maxNumber: 306 })).toEqual({ no: 306, why: 'RECENT' })
  })
  it('바로 앞에 들린 번호(중간 결과 "306번"·기다리는 306번)가 X0Y면 맥락 없이도 바꾼다', () => {
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [], heardBefore: [306], product: products({}) })).toEqual({ no: 306, why: 'HEARD' })
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [], heardBefore: [36, 360], product: products({}) })).toBeNull()
    // 증거가 있어도 X0Y가 다른 가격으로 있으면 그대로
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: [], heardBefore: [306], product: products({ 306: 15_000 }) })).toBeNull()
  })
  it('넘긴 값을 바꾸지 않고, 깨진 입력에 던지지 않는다', () => {
    const recent = Object.freeze([304, 305])
    expect(fixDroppedZero({ no: 36, price: 20_000, recent, product: products({}) })?.no).toBe(306)
    expect(fixDroppedZero({ no: 36, price: 20_000, recent: null as unknown as number[], product: products({}) })).toBeNull()
    expect(
      fixDroppedZero({
        no: 36,
        price: 20_000,
        recent,
        product: () => {
          throw new Error('x')
        },
      }),
    ).toBeNull()
  })
})

describe('실방송 V3 306번 — 읽기는 그대로, 몰디브 사전', () => {
  const DICT = prepareVoiceDictionary()
  const pick = (text: string) => readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.price, p.name])
  it('"36번도 2만 원"·"3 6번 2만 원"은 36번으로 읽힌다 (바꾸기는 fixDroppedZero가 맥락으로)', () => {
    expect(pick('36번도 2만 원')).toEqual([[36, 20_000, null]])
    expect(pick('3 6번 2만 원')).toEqual([[36, 20_000, null]])
  })
  it('긴 조각 안의 "몰디브"도 품종으로 잡는다', () => {
    expect(pick('38번 자 우리 박사님이래요 자 송이 송이야 이거 좀 봐 줘 봐 봐 우리 그 몰디브 박사님 자 요 아이도 자 2만 원')).toEqual([[38, 20_000, '몰디브']])
    expect(pick('306번 몰디브 2만 원')).toEqual([[306, 20_000, '몰디브']])
    expect(pick('304번 몰디부 2만 원')).toEqual([[304, 20_000, '몰디브']])
    expect(pick('305번 몰 디브 2만 원')).toEqual([[305, 20_000, '몰디브']])
  })
})

// 겹친 자리 걷어 내기 (D-V3-123, 실방송 2026-11-06: 52·54·56·57번을 팔다 "57번이구요 5만원" 뒤 "557번 녹금 요아이 5만원"이 새 상품 557번으로 등록됨)
describe('fixDoubledDigit', () => {
  const NOW = { 52: 300_000, 54: 50_000, 56: 10_000, 57: 50_000 }
  it('실방송: 557번 5만 원은 같은 가격 57번이 있고 최근 흐름이 50번대면 57번으로 본다', () => {
    expect(fixDoubledDigit({ no: 557, price: 50_000, recent: [52, 54, 56, 57], product: products(NOW) })).toEqual({ no: 57, why: 'RECENT' })
  })
  it('57번이 아직 없어도 흐름이 50번대면 57번 (새 등록)', () => {
    expect(fixDoubledDigit({ no: 557, price: 50_000, recent: [54, 56], product: products({ 54: 1, 56: 1 }) })).toEqual({ no: 57, why: 'RECENT' })
  })
  it('바로 앞에 57이 들렸으면 흐름이 모자라도 57번', () => {
    expect(fixDoubledDigit({ no: 557, price: 50_000, recent: [], heardBefore: [57], product: products({}) })).toEqual({ no: 57, why: 'HEARD' })
  })
  it('바꾸지 않는다: 557번이 있음 · 첫 두 자리가 다름 · 57번 가격이 다르거나 못 들음 · 57번 판매 종료 · 흐름이 500번대 · 흐름이 모자람', () => {
    expect(fixDoubledDigit({ no: 557, price: 50_000, recent: [52, 56], product: products({ ...NOW, 557: 50_000 }) })).toBeNull()
    expect(fixDoubledDigit({ no: 457, price: 50_000, recent: [52, 56], product: products(NOW) })).toBeNull()
    expect(fixDoubledDigit({ no: 557, price: 30_000, recent: [52, 56], product: products(NOW) })).toBeNull()
    expect(fixDoubledDigit({ no: 557, price: null, recent: [52, 56], product: products(NOW) })).toBeNull()
    expect(fixDoubledDigit({ no: 557, price: 50_000, recent: [52, 56], product: products({ ...NOW, 57: 'closed' }) })).toBeNull()
    expect(fixDoubledDigit({ no: 557, price: 50_000, recent: [550, 556], product: products({}) })).toBeNull()
    expect(fixDoubledDigit({ no: 557, price: 50_000, recent: [56], product: products({}) })).toBeNull()
    // 끝 두 자리가 한 자리 수(505 → 5)는 다루지 않는다
    expect(fixDoubledDigit({ no: 505, price: 50_000, recent: [4, 6], product: products({}) })).toBeNull()
  })
})

// 실방송 2026-11-06 품종 (D-V3-123·124): 사용자가 말한 품종이 사전에 없어 비거나(71번 황도) 틀렸다(52번·72번·76번)
describe('실방송 2026-11-06 — 사전에 더한 품종', () => {
  const DICT = prepareVoiceDictionary()
  const pick = (text: string) => readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.name, p.price])
  it('황도·순수·골드문·아사달금을 들린 그대로 품종으로', () => {
    expect(pick('이렇게 빨간 손톱이 황도입니다 황도는 3만원 71번')).toEqual([[71, '황도', 30_000]])
    expect(pick('연수조 다육에서 인사드리고요 순수 요아이 만원 72번')).toEqual([[72, '순수', 10_000]])
    expect(pick('골드문 UI 20,000원 76번')).toEqual([[76, '골드문', 20_000]])
    expect(pick('30만원 자 아사달금 52번')).toEqual([[52, '아사달금', 300_000]])
  })
  it('순수는 적은 모양으로만 — "순수하게"는 품종이 아니다', () => {
    expect(pick('자 이거 순수하게 예뻐요 3만원 80번')).toEqual([[80, null, 30_000]])
  })
})
