// 빠른 입력 (AC-S05-10~13, D-084): 해석은 코어 parseQuickInput에 그 방송 스냅샷의 price.unit·claim.maxNumber를 넣은 결과와 같다.
// SRV1 (D-APP-23·24): 읽기 함수는 서버 전용 자리(packages/voice-session/src/read)로 옮겼다 — 기대값은 그대로, 서버 읽기 함수를 본다.
import { DEFAULT_SETTINGS, parseQuickInput } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import type { Product } from '../src/api/types.ts'
import { changedFields } from '../src/lib/quick.ts'
import { decideFixForm, decideQuickInput, numberErrorFill, previewNumber, quickErrorMessage, quickSettings } from '../../../packages/voice-session/src/read/index.ts'
import { product } from './support.ts'

const settings = quickSettings(DEFAULT_SETTINGS)
const none = (): Product | undefined => undefined

describe('빠른 입력 → 등록 (AC-S05-10)', () => {
  it.each([
    ['15 핑크프릴 10000', 15],
    ['16 핑크프릴 1만', 16],
    ['17번 핑크프릴 만원', 17],
    ['18/핑크프릴/10', 18],
  ])('%s → 핑크프릴 10,000원', (line, no) => {
    expect(decideQuickInput(line, settings, none)).toEqual({ kind: 'register', no, name: '핑크프릴', price: 10000 })
  })

  it('31 방울복랑 금 15000 → 품종 "방울복랑 금", 품종이 비면 빈 품종', () => {
    expect(decideQuickInput('31 방울복랑 금 15000', settings, none)).toEqual({ kind: 'register', no: 31, name: '방울복랑 금', price: 15000 })
    expect(decideQuickInput('15 10000', settings, none)).toEqual({ kind: 'register', no: 15, name: '', price: 10000 })
  })

  it('코어 parseQuickInput과 같은 결과다 (스냅샷 설정을 넣어서)', () => {
    const won = quickSettings({ ...DEFAULT_SETTINGS, 'price.unit': 'WON', 'claim.maxNumber': 50 })
    for (const line of ['15 핑크 10', '15 핑크 1만', '51 핑크 10000', '50번 핑크 오천', '7/a/300', '  ', '핑크 10000']) {
      const parsed = parseQuickInput(line, won)
      const decision = decideQuickInput(line, won, none)
      if ('error' in parsed) {
        if (parsed.error === 'EMPTY') expect(decision).toEqual({ kind: 'none' })
        else expect(decision).toMatchObject({ kind: 'fix', error: parsed.error })
      } else {
        expect(decision).toEqual({ kind: 'register', ...parsed })
      }
    }
  })
})

describe('오류 → 고칠 칸 (AC-S05-11)', () => {
  it.each([
    ['15 핑크프릴', 'PRICE_MISSING', 'price', '가격을 알아보지 못했어요. 가격 칸에 적어 주세요.', 15, '핑크프릴'],
    ['15 핑크프릴 50원', 'PRICE_TOO_LOW', 'price', '가격이 100원보다 적어요. 가격을 확인해 주세요.', 15, '핑크프릴'],
  ])('%s → %s, 커서 %s', (line, error, focus, message, no, name) => {
    expect(decideQuickInput(line, settings, none)).toEqual({ kind: 'fix', error, focus, message, no, name })
  })

  // AC-S06-65 (UX-S05-009): 번호 오류면 번호 칸은 비우고(범위 밖이면 친 첫 토큰 그대로) 품종·가격은 번호 자리를 뺀 나머지를 코어로 읽어 채운다
  it.each([
    ['핑크프릴 10000', 'NUMBER_MISSING', '맨 앞에 상품 번호를 적어 주세요. 예: 15 핑크프릴 10000', '', '핑크프릴', '10,000원'],
    ['1000 핑크프릴 10', 'NUMBER_INVALID', '번호는 1부터 999까지예요. 번호를 확인해 주세요.', '1000', '핑크프릴', '10,000원'],
    ['0 핑크프릴 10', 'NUMBER_INVALID', '번호는 1부터 999까지예요. 번호를 확인해 주세요.', '0', '핑크프릴', '10,000원'],
    ['1000/핑크프릴/10', 'NUMBER_INVALID', '번호는 1부터 999까지예요. 번호를 확인해 주세요.', '1000', '핑크프릴', '10,000원'],
    ['방울복랑 금 만오천', 'NUMBER_MISSING', '맨 앞에 상품 번호를 적어 주세요. 예: 15 핑크프릴 10000', '', '방울복랑 금', '15,000원'],
    ['핑크프릴 예쁜거', 'NUMBER_MISSING', '맨 앞에 상품 번호를 적어 주세요. 예: 15 핑크프릴 10000', '', '핑크프릴 예쁜거', ''],
    ['1000번 핑크프릴', 'NUMBER_INVALID', '번호는 1부터 999까지예요. 번호를 확인해 주세요.', '1000번', '핑크프릴', ''],
  ])('%s → %s, 번호 칸 "%s"·품종·가격을 나머지로 채우고 커서는 번호 칸', (line, error, message, noText, name, priceText) => {
    expect(decideQuickInput(line, settings, none)).toEqual({ kind: 'fix', error, focus: 'no', message, no: null, name, noText, priceText })
  })

  it('번호 오류의 나머지 읽기는 코어 parseQuickInput이다 (그 방송의 가격 단위: 원 단위면 10 → 읽지 못함은 아니고 100원 미만)', () => {
    const won = { 'price.unit': 'WON', 'claim.maxNumber': 999 } as const
    expect(numberErrorFill('핑크프릴 10000', 'NUMBER_MISSING', won)).toEqual({ noText: '', name: '핑크프릴', priceText: '10,000원' })
    expect(numberErrorFill('핑크프릴 10', 'NUMBER_MISSING', won)).toEqual({ noText: '', name: '핑크프릴 10', priceText: '' })
    expect(numberErrorFill('1000', 'NUMBER_INVALID', won)).toEqual({ noText: '1000', name: '', priceText: '' })
  })

  it('빈 줄은 아무 일도 없다', () => {
    expect(decideQuickInput('   ', settings, none)).toEqual({ kind: 'none' })
  })

  it('최대 번호는 그 방송 스냅샷의 값', () => {
    expect(quickErrorMessage('NUMBER_INVALID', 50)).toBe('번호는 1부터 50까지예요. 번호를 확인해 주세요.')
  })

  it('고치기 칸: 가격은 같은 금액 해석(parseAmount), 실패하면 같은 문장', () => {
    expect(decideFixForm({ no: '15', name: '핑크', price: '1만' }, settings, none)).toEqual({ kind: 'register', no: 15, name: '핑크', price: 10000 })
    expect(decideFixForm({ no: '15', name: '핑크', price: '10' }, settings, none)).toEqual({ kind: 'register', no: 15, name: '핑크', price: 10000 })
    expect(decideFixForm({ no: '15', name: '핑크', price: '모름' }, settings, none)).toMatchObject({ kind: 'fix', error: 'PRICE_MISSING', focus: 'price' })
    expect(decideFixForm({ no: '15', name: '핑크', price: '50원' }, settings, none)).toMatchObject({ kind: 'fix', error: 'PRICE_TOO_LOW', focus: 'price' })
    expect(decideFixForm({ no: '', name: '핑크', price: '1만' }, settings, none)).toMatchObject({ kind: 'fix', error: 'NUMBER_MISSING', focus: 'no' })
    expect(decideFixForm({ no: '0', name: '핑크', price: '1만' }, settings, none)).toMatchObject({ kind: 'fix', error: 'NUMBER_INVALID', focus: 'no' })
    expect(decideFixForm({ no: '15번', name: '핑크', price: '1만' }, settings, none)).toMatchObject({ kind: 'register', no: 15 })
  })
})

describe('번호 찾기·같은 번호 (AC-S05-12·13)', () => {
  const p15 = product(15)
  const find = (no: number) => (no === 15 ? p15 : undefined)

  it('번호만 치면(15·15번) 그 상품 자세히', () => {
    expect(decideQuickInput('15', settings, find)).toEqual({ kind: 'open', product: p15 })
    expect(decideQuickInput('15번', settings, find)).toEqual({ kind: 'open', product: p15 })
  })

  it('없는 번호만 치면 가격 칸으로', () => {
    expect(decideQuickInput('16', settings, find)).toMatchObject({ kind: 'fix', error: 'PRICE_MISSING', no: 16, focus: 'price' })
  })

  it('같은 번호의 상품 기록이 있으면(판매 종료 포함) 등록하지 않고 묻는다', () => {
    expect(decideQuickInput('15 핑크 12000', settings, find)).toEqual({ kind: 'edit', product: p15, no: 15, name: '핑크', price: 12000 })
    const closed = product(15, { status: 'CLOSED' })
    expect(decideQuickInput('15 핑크 12000', settings, () => closed)).toMatchObject({ kind: 'edit', product: closed })
  })

  it('바뀐 칸만 (친 줄에 품종이 없으면 품종은 그대로)', () => {
    expect(changedFields(p15, '핑크프릴', 10000)).toEqual({})
    expect(changedFields(p15, '핑크', 10000)).toEqual({ name: '핑크' })
    expect(changedFields(p15, '', 12000)).toEqual({ price: 12000 })
  })

  it('치는 동안 첫 토큰의 번호', () => {
    expect(previewNumber('15')).toBe(15)
    expect(previewNumber('15 핑')).toBe(15)
    expect(previewNumber('15번')).toBe(15)
    expect(previewNumber('15/핑크')).toBe(15)
    expect(previewNumber('핑크 15')).toBeNull()
    expect(previewNumber('15핑크')).toBeNull()
    expect(previewNumber('0')).toBeNull()
  })

  it('미리 보기 번호 = 코어 parseQuickInput이 읽은 번호 (전각 숫자·그 방송의 번호 최대, 화면이 따로 읽지 않는다)', () => {
    const lines = ['15', '１５ 핑크프릴 10000', '１５번 핑', '15 번', '15/핑크/1만', '15 핑크 50원', '1000 핑크', '999', '0015', '15핑크', '', '  ', '핑크 15', '#15', '15.5 핑크']
    for (const line of lines) {
      const core = parseQuickInput(line, settings)
      expect(previewNumber(line, settings), line).toBe(core.no ?? null)
    }
    expect(previewNumber('１５ 핑크프릴 10000')).toBe(15)
    const small = quickSettings({ ...DEFAULT_SETTINGS, 'claim.maxNumber': 50 })
    expect(previewNumber('60 핑크', small)).toBeNull()
    expect(previewNumber('50 핑크', small)).toBe(50)
  })

  it('고치기 칸의 번호 = 빠른 입력과 같은 번호 해석 (전각 숫자·"15 번"), 번호 하나가 아니면 범위 안내', () => {
    expect(decideFixForm({ no: '１５', name: '핑크', price: '1만' }, settings, none)).toEqual({ kind: 'register', no: 15, name: '핑크', price: 10000 })
    expect(decideFixForm({ no: ' 15 번 ', name: '핑크', price: '1만' }, settings, none)).toMatchObject({ kind: 'register', no: 15 })
    expect(decideFixForm({ no: '１５', name: '핑크', price: '1만' }, settings, find)).toMatchObject({ kind: 'edit', product: p15, no: 15 })
    for (const no of ['15 핑크', '15 1만', '핑크', '1000', '15핑크', '-3']) {
      expect(decideFixForm({ no, name: '핑크', price: '1만' }, settings, none), no).toMatchObject({ kind: 'fix', error: 'NUMBER_INVALID', focus: 'no' })
    }
    expect(decideFixForm({ no: '  ', name: '핑크', price: '1만' }, settings, none)).toMatchObject({ kind: 'fix', error: 'NUMBER_MISSING', focus: 'no' })
  })
})
