// 서버 읽기 입구 함수 readText (SRV1 약속 1, AC-SRV1-01·07·08): 칸마다 응답 모양과 지금 화면 문장. HTTP 입구 시험은 apps/server/test/srv1-read.test.ts.
// 시험은 TZ=Pacific/Honolulu에서 돈다 — 받은 시각은 늘 KST로 읽는다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { AMOUNT_UNREADABLE, PHONE_IN_TEXT, PHONE_UNREADABLE, readMoney, readText, type ReadProduct } from '../../src/read/index.ts'
import { quickSettings } from '../../src/read/quick.ts'

const kst = (iso: string): number => Date.parse(`${iso}+09:00`)
const NOW = kst('2026-10-18T12:00:00')
const thousand = quickSettings({ ...DEFAULT_SETTINGS, 'price.unit': 'THOUSAND' })
const p15: ReadProduct = { id: 'p15', no: 15, name: '핑크프릴', price: 20_000, closed: false }
const find = (no: number) => (no === 15 ? p15 : undefined)

describe('빠른 입력·고치기·가격 칸 (그 방송 설정)', () => {
  it('천원 방송 `16 핑크프릴 20` → 등록 미리 보기, 번호 찾기 미리 보기', () => {
    expect(readText('quick', '16 핑크프릴 20', { settings: thousand, findProduct: find, now: NOW })).toMatchObject({
      kind: 'quick',
      decision: 'register',
      no: 16,
      name: '핑크프릴',
      price: 20_000,
      priceWords: '20,000원',
      preview: '등록하면: 16번 핑크프릴 20,000원',
      previewNo: 16,
    })
  })

  it('있는 번호는 "고칠까요?", 번호만이면 상품 자세히 (상품 ID)', () => {
    expect(readText('quick', '15 핑크프릴 25', { settings: thousand, findProduct: find, now: NOW })).toMatchObject({ decision: 'edit', productId: 'p15', question: '15번이 이미 있어요. 고칠까요?', preview: null })
    expect(readText('quick', '15', { settings: thousand, findProduct: find, now: NOW })).toMatchObject({ decision: 'open', productId: 'p15', no: 15 })
  })

  it('고치기 칸은 세 칸을 함께 읽고 가격 미리 보기를 준다', () => {
    expect(readText('fix', { no: '16번', name: '라울', price: '5' }, { settings: thousand, now: NOW })).toMatchObject({ kind: 'fix', decision: 'register', no: 16, price: 5000, pricePreview: '= 5,000원' })
  })

  it('가격 칸은 그 방송의 가격 단위로 읽고, 비면 아무 값도 없다', () => {
    expect(readText('price', '20', { settings: thousand, now: NOW })).toMatchObject({ kind: 'price', amount: 20_000, words: '20,000원' })
    expect(readText('price', '  ', { settings: thousand, now: NOW })).toEqual({ kind: 'price', amount: null, words: null, preview: null })
  })

  it('방송 설정 없이 방송 칸을 읽지 않는다 (입구가 막는다)', () => {
    expect(() => readText('quick', '15 a 10', { now: NOW })).toThrow()
    expect(() => readText('price', '10', { now: NOW })).toThrow()
  })
})

describe('방송과 무관한 칸 (금액·받은 시각·전화번호)', () => {
  it('정산 금액은 원 단위 — 읽지 못하면 지금 화면 문장', () => {
    expect(readText('money', '1만 4천', { now: NOW })).toEqual({ kind: 'money', empty: false, amount: 14_000, words: '14,000원', message: null })
    expect(readText('money', '공짜', { now: NOW })).toEqual({ kind: 'money', empty: false, amount: null, words: null, message: AMOUNT_UNREADABLE })
    expect(readText('money', ' ', { now: NOW })).toEqual({ kind: 'money', empty: true, amount: null, words: null, message: null })
    expect(readMoney('20')).toEqual({ empty: false, amount: 20 })
  })

  it('받은 시각 `3:10`은 지금 12:00이면 오늘 15:10 (서버 시계)', () => {
    expect(readText('received', '3:10', { now: NOW })).toEqual({
      kind: 'received',
      state: 'ok',
      value: '15:10',
      minute: true,
      time: new Date(kst('2026-10-18T15:10:00')).toISOString(),
      day: '오늘',
      late: true,
      words: '오늘 15:10',
      message: null,
    })
    expect(readText('received', '', { now: NOW })).toMatchObject({ state: 'empty', message: null })
    expect(readText('received', '25:00', { now: NOW })).toMatchObject({ state: 'invalid', message: '받은 시각을 20:01처럼 적어 주세요.' })
  })

  it('전화번호는 뒤 4자리만 돌려주고 정리한 번호는 없다. 메모 칸의 전화번호는 hasPhone', () => {
    const phone = readText('phone', '010-1234-5678', { now: NOW })
    expect(phone).toEqual({ kind: 'phone', empty: false, valid: true, last4: '5678', hasPhone: true, message: null })
    expect(JSON.stringify(phone)).not.toContain('01012345678')
    expect(readText('phone', '12345', { now: NOW })).toEqual({ kind: 'phone', empty: false, valid: false, last4: null, hasPhone: false, message: PHONE_UNREADABLE })
    expect(readText('phone', '내일 오후 연락 010-9999-8888', { now: NOW })).toMatchObject({ hasPhone: true })
    expect(readText('phone', '', { now: NOW })).toEqual({ kind: 'phone', empty: true, valid: false, last4: null, hasPhone: false, message: null })
    expect(PHONE_IN_TEXT).toBe('전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.')
  })
})
