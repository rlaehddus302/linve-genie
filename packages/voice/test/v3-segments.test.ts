// AC-V3-52·53 덩어리 조각 소비 (R-17 8, D-V3-46·48) — 사례 R54~R64, 실방송 8차, 실제 방송 1~6.
import { describe, expect, it } from 'vitest'
import { extractVoice, prepareVoiceDictionary, readSegments, type SegmentOptions } from '../src/index.ts'

const DICT = prepareVoiceDictionary()
const seg = (text: string, options: SegmentOptions = {}) => readSegments(text, { dictionary: DICT, ...options })
const picks = (text: string, options: SegmentOptions = {}) => seg(text, options).picks.map((p) => [p.no, p.price, p.name, p.end])

describe('AC-V3-52 조각 소비 (R54~R60)', () => {
  it('R54 "93번 청개구리 7만 원 97번 23만 원" → 등록 둘, 조각 경계 3·6', () => {
    expect(picks('93번 청개구리 7만 원 97번 23만 원')).toEqual([
      [93, 70000, '청개구리', 3],
      [97, 230000, null, 6],
    ])
    // 중간 결과 "93번 청개구리 7만 원"에서 이미 첫 등록
    expect(picks('93번 청개구리 7만 원 97번')).toEqual([[93, 70000, '청개구리', 3]])
  })
  it('R55 "93번 청개구리 97번 23만 원" → 97번만, 93번 알림', () => {
    const r = seg('93번 청개구리 97번 23만 원')
    expect(r.picks.map((p) => [p.no, p.price, p.name, p.end])).toEqual([[97, 230000, null, 4]])
    expect(r.others).toEqual([93])
  })
  it('R56 "만 원짜리 아니고요 97번 23만 원" → 97번 230,000원 (앞의 만 원은 버림)', () => {
    expect(picks('만 원짜리 아니고요 97번 23만 원')).toEqual([[97, 230000, null, 5]])
  })
  it('R57 "108번 10만 원 109번" → 108번, 109번 알림', () => {
    const r = seg('108번 10만 원 109번')
    expect(r.picks.map((p) => [p.no, p.price, p.end])).toEqual([[108, 100000, 2]])
    expect(r.others).toEqual([109])
  })
  it('R58 "107번 10만 원 108번 12만 원" → 조각 둘', () => {
    expect(picks('107번 10만 원 108번 12만 원')).toEqual([
      [107, 100000, null, 2],
      [108, 120000, null, 5],
    ])
  })
  it('R59 등록 뒤 "… 110 … 9cm 80번 …" → 더 등록 없음(원 없는 수는 가격 아님), 80번 알림', () => {
    const r = seg('97번 23만 원 자 요거 갑니다 자 110 자 갑니다 요거는 수수료도 안 나오겠네 자 9cm 자 9cm 80번 자요렇게 해주시고요', { final: true })
    expect(r.picks.map((p) => [p.no, p.price])).toEqual([[97, 230000]])
    expect(r.others).toEqual([80])
    expect(r.tail).toBeNull()
  })
  it('R60 "108번 10만원 아니 12만원" → 108번 100,000원 뒤 정정 조각(R-22로 120,000원)', () => {
    const r = seg('108번 10만원 아니 12만원', { final: true })
    expect(r.picks.map((p) => [p.no, p.price, p.end])).toEqual([[108, 100000, 1]])
    expect(r.tail).toEqual({ kind: 'correction', no: 108, text: '아니 12만원' })
    expect(seg('108번 10만원 취소').tail).toEqual({ kind: 'cancel', no: 108, text: '취소' })
  })
})

describe('AC-V3-53 "N번 품종 수" (R61~R64, D-V3-48)', () => {
  const thousand: SegmentOptions = { priceUnit: 'THOUSAND' }
  it('R61 천원 단위 "92번 빅뱅 60"(최종) → 92번 빅뱅 60,000원', () => {
    expect(seg('92번 빅뱅 60', { ...thousand, final: true }).picks).toMatchObject([{ no: 92, name: '빅뱅', price: 60000, priceFrom: 'quick' }])
  })
  it('R62 중간 결과 "92번 빅뱅 60"은 기다리고, 최종 "92번 빅뱅 60만 원"은 600,000원', () => {
    expect(seg('92번 빅뱅 60', thousand).picks).toEqual([])
    expect(seg('92번 빅뱅 60만 원', thousand).picks).toMatchObject([{ no: 92, name: '빅뱅', price: 600000, priceFrom: 'won' }])
  })
  it('R63 "92번 빅뱅 6만 자" → 60,000원 (단위 붙은 금액은 적힌 대로, 뒤에 군말만)', () => {
    expect(seg('92번 빅뱅 6만 자', thousand).picks).toMatchObject([{ no: 92, name: '빅뱅', price: 60000 }])
  })
  it('R64 사전 품종이 없으면 확정 아님', () => {
    expect(seg('92번 60', { ...thousand, final: true }).picks).toEqual([])
    expect(seg('92번 저거 60', { ...thousand, final: true }).picks).toEqual([])
  })
  it('원 단위: 60000은 60,000원, 60은 100원 미만이라 아님. 만원 단위: 6 = 60,000원', () => {
    expect(seg('92번 빅뱅 60000', { final: true }).picks).toMatchObject([{ price: 60000 }])
    expect(seg('92번 빅뱅 60', { final: true }).picks).toEqual([])
    expect(seg('92번 빅뱅 6', { priceUnit: 'TEN_THOUSAND', final: true }).picks).toMatchObject([{ price: 60000 }])
  })
})

describe('실제 방송 문장 — 조각으로', () => {
  it('2. "… 10만 원 108번" → 덩어리 끝에서만 108번', () => {
    const text = '자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번'
    expect(seg(text).picks).toEqual([])
    expect(seg(text, { final: true }).picks).toMatchObject([{ no: 108, price: 100000 }])
  })
  it('3. 180번 … 35만 원까지 → 180번 350,000원 삼광색금', () => {
    expect(seg('자 180번 상관 세금 자 요 아이 자 유아이 35만 원까지 네 요 아이는 35만 원까지 그대로 봅니다 색금 이렇게 잘 들었어요 자 3강색급 요 아이는 30 5만 원').picks).toMatchObject([
      { no: 180, price: 350000, name: '삼광색금' },
    ])
  })
  it('4. "28만 원 174번 … 이거 28만 원" → 174번 280,000원', () => {
    expect(seg('자 파이텐트까지 나오는 상강색 게임 잘 들었어요 자 상강 색금 자 요 아이 자 28만 원 174번 자 174 자 이거 28만 원 자 3강색은 요 아이 28마리까지').picks).toMatchObject([
      { no: 174, price: 280000 },
    ])
  })
  it('6. "189번인데 … 139번 얘 50만 원" → 139번 500,000원, 189번 알림', () => {
    const r = seg('어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요')
    expect(r.picks).toMatchObject([{ no: 139, price: 500000 }])
    expect(r.others).toEqual([189])
  })
  it('일육팔 삼광색금 이십오만 원 → 168번 (번 없는 번호, 조각 안)', () => {
    expect(seg('일육팔 삼광색금 이십오만 원').picks).toMatchObject([{ no: 168, price: 250000, name: '삼광색금', numberFrom: 'bare' }])
  })
})

describe('실방송 8차 — 대화 속 "아니"', () => {
  const text =
    '자 55번 갑니다 55번 자 요거 만 원 아니 가격이 좀 있는 거부터 달라니까 너무 착한 거 줘요 어 84번 누르셨네요 네 45분 패스하고 자 84번 자 요거 85번 갖다 주세요 어 전개구리 갖다 주세요 자 요거 취급주 있는 갑니다 감사합니다 야 요거 만 원이에요 여러분 이거 패스'
  it('55번 10,000원 바로 등록(중간 결과에서도), "아니 가격이…"는 정정 아님', () => {
    expect(seg('자 55번 갑니다 55번 자 요거 만 원').picks).toMatchObject([{ no: 55, price: 10000 }])
    const r = seg(text, { final: true })
    expect(r.picks[0]).toMatchObject({ no: 55, price: 10000 })
    expect(r.tail).toBeNull()
  })
  it('위험(스펙대로): 시청자 찜을 말한 84번이 섞여도 85번 10,000원이 짝, 84번은 알림', () => {
    const r = seg(text, { final: true })
    expect(r.picks.map((p) => [p.no, p.price])).toEqual([
      [55, 10000],
      [85, 10000],
    ])
    expect(r.others).toEqual([84])
  })
  it('"55번 만 원 아니 만오천 원" → 정정 조각(가격이 바로 따라옴)', () => {
    expect(seg('55번 만 원 아니 만오천 원', { final: true }).tail).toEqual({ kind: 'correction', no: 55, text: '아니 만오천 원' })
  })
  it('같이 들어온 "대구 74번 갑니다 12만 원" → 74번 120,000원', () => {
    expect(seg('대구 74번 갑니다 12만 원').picks).toMatchObject([{ no: 74, price: 120000 }])
  })
})

describe('AC-V3-54 readSellerNote·readSegments는 어떤 글에도 예외 없음', () => {
  it('무작위 1,000개', async () => {
    const fc = (await import('fast-check')).default
    const { readSellerNote } = await import('../src/index.ts')
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 60 }), fc.string({ unit: 'grapheme', maxLength: 60 }), fc.constantFrom('', '₩', '[', '93번[', '₩,', '<b>93번</b>[x] ₩1')), (text) => {
        expect(() => readSellerNote(text)).not.toThrow()
        const note = readSellerNote(text)
        if (note !== null) expect(note.price).toBeGreaterThanOrEqual(100)
        expect(() => readSegments(text, { dictionary: DICT, final: true })).not.toThrow()
      }),
      { numRuns: 1000 },
    )
  })
})

describe('실방송 8차 — 끊긴 번호("오십삼번"→13번, "63번"→60번)는 뒤·앞 조각만 번호로 쓰지 않는다', () => {
  const no = (text: string) => extractVoice(`${text} 라울 만원`, { dictionary: DICT }).no
  const sure = (text: string) => readSegments(`${text} 라울 만원`, { dictionary: DICT, final: true }).picks.map((p) => p.no)
  // D-V3-54: 앞 수와 합치기 — 자리가 내려가면 더하고, 숫자 한 개 둘은 두 자리
  it.each([
    ['53번', 53],
    ['오십삼번', 53],
    ['오십 삼번', 53],
    ['50 3번', 53],
    ['63번', 63],
    ['육십삼번', 63],
    ['육십 삼번', 63],
    ['60 3번', 63],
    ['60 삼번', 63],
    ['육십 3번', 63],
    ['6 3번', 63],
  ])('%s → %i', (text, want) => {
    expect(no(text)).toBe(want)
    expect(sure(text)).toEqual([want])
  })
  // 겹쳐 합칠 수 없거나(`5 13번`) 번호 뒤 한 자리 수(`60번 3`)면 번호를 비운다 — 13·3·60만 번호가 되지 않는다
  it.each(['5 13번', '오 13번', '50 13번', '오십 13번', '5십삼번', '60번 3'])('%s → 번호 없음, 바로 등록 없음', (text) => {
    expect(no(text)).toBeNull()
    expect(sure(text)).toEqual([])
  })
  it('번호 뒤 한 자리 수 다음이 단위면 애매하지 않다: "15번 3 개 라울 만원" → 15', () => {
    expect(extractVoice('15번 3 개 라울 만원', { dictionary: DICT }).no).toBe(15)
    expect(extractVoice('이 15번 라울 만원', { dictionary: DICT }).no).toBe(15)
    expect(extractVoice('15번 이 아이 만원', { dictionary: DICT }).no).toBe(15)
  })
})

describe('TD-V3-004 판매자 채팅 가격은 0으로 시작하지 않는다', () => {
  it('₩0500·₩070,000 → null', async () => {
    const { readSellerNote } = await import('../src/index.ts')
    expect(readSellerNote('93번 [청개구리] ₩0500')).toBeNull()
    expect(readSellerNote('93번 [청개구리] ₩070,000')).toBeNull()
    expect(readSellerNote('93번 [청개구리] ₩70,000')).toEqual({ no: 93, name: '청개구리', price: 70000 })
  })
})

describe('AC-V3-65 흔한 말 별칭 녹음 → 녹금은 N번 조각 안에서만', () => {
  it('"89번 녹음 7만 원" → 녹금, 번호 없는 "녹음 잘 되고 있죠"는 품종 아님', () => {
    expect(seg('89번 녹음 7만 원').picks).toMatchObject([{ no: 89, name: '녹금', price: 70000 }])
    expect(seg('89번 녹음 60', { priceUnit: 'THOUSAND', final: true }).picks).toMatchObject([{ no: 89, name: '녹금', price: 60000 }])
    expect(extractVoice('녹음 잘 되고 있죠', { dictionary: DICT }).name).toBeNull()
  })
})

describe('AC-V3-66 음성 인식 기록 가리기·내려받기 형식', () => {
  it('가리기: 8자리 이상 숫자, 끝자리 낱말 뒤 4숫자', async () => {
    const { maskArchiveText } = await import('../src/index.ts')
    expect(maskArchiveText('끝자리 1234 김민지님')).toBe('끝자리 **** 김민지님')
    expect(maskArchiveText('010-1234-5678')).toBe('****')
    expect(maskArchiveText('뒷 번호 5678 문자찜')).toBe('뒷 번호 **** 문자찜')
    expect(maskArchiveText('15번 라울 만원')).toBe('15번 라울 만원')
  })
  it('내려받기 JSON 모양과 30일 지우기', async () => {
    const { createArchiveExport, pruneArchive, VOICE_ARCHIVE_KEEP_MS } = await import('../src/index.ts')
    const value = createArchiveExport(
      [{ broadcastId: 'b1', title: '방송', date: '2026-10-25', chunks: [{ at: 1, text: '끝자리 1234', reading: { no: 15, price: 10000, name: null, numberFrom: 'marker', priceFrom: 'won' }, action: 'REGISTERED', reason: null, undone: false, edited: false }] }],
      0,
    )
    expect(value).toEqual({
      format: 'livegenie-voice-log',
      version: 1,
      exportedAt: '1970-01-01T00:00:00.000Z',
      broadcasts: [{ broadcastId: 'b1', title: '방송', date: '2026-10-25', chunks: [{ at: 1, text: '끝자리 ****', reading: { no: 15, price: 10000, name: null, numberFrom: 'marker', priceFrom: 'won' }, action: 'REGISTERED', reason: null, undone: false, edited: false }] }],
    })
    expect(pruneArchive([{ at: 0 }, { at: 10 }], VOICE_ARCHIVE_KEEP_MS + 5)).toEqual([{ at: 10 }])
  })
})
