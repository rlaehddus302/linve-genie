// T1 적대 시험 (test-domain): 택배 순수 규칙을 스펙 문장으로 다시 쓴 기준 구현과 무작위로 맞대 본다.
// - PC-2 배송지 읽기(AC-T1-01): 전각 공백·탭·줄바꿈·제어 글자·제로폭·이모지·풀어 쓴 한글·하이픈·괄호·전각 숫자를 섞은 입력
// - PC-4 접수할 수 있는지(AC-T1-04): 사실 조합 전부(표 위에서부터 처음 걸린 이유)
// - PC-3 보관 30일(AC-T1-03): "날짜 + 30일의 0시(KST)"와 정리 작업의 "지울 마지막 날짜"가 같은 경계인지, KST 자정 전후
// - PC-5 멈춘 시도: 2분 넘게 남은 PENDING만 UNKNOWN
// - PC-7 운송장(AC-T1-40·42): Code 128 부호값·검사값, 연락처 가리기, 송장번호 글, 가장 긴 바른 배송지가 운송장에 들어가는지
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { code128Codes, formatInvoiceNumber, layoutWaybill, loadDocumentFont, maskPhone, type WaybillData } from '@livejjim/documents'
import { fontBytes } from '../../../packages/documents/test/helpers.ts'
import {
  ADDRESS_FIELDS,
  ADDRESS_STATES,
  PACKING_WORD_KINDS,
  PARCEL_STATE_KINDS,
  PAYMENT_KINDS,
  SHIPPING_KINDS,
  STALE_PENDING_MS,
  effectiveState,
  parcelEligibility,
  readAddress,
  type AddressField,
  type EligibilityFacts,
} from '../../../apps/server/src/parcel/rules.ts'
import { addressExpiresAt, lastExpiredDate } from '../../../apps/server/src/parcel/service.ts'

// ── PC-2 기준 구현 (스펙 문장 그대로) ─────────────────────────────────────

function specTidy(text: string): string {
  const chars = [...text.normalize('NFC')].map((ch) => {
    const code = ch.codePointAt(0) as number
    return /\s/u.test(ch) || code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? ' ' : ch
  })
  return chars.join('').replace(/ +/g, ' ').replace(/^ | $/g, '')
}

function specRead(input: Record<AddressField, string>): { ok: Record<AddressField, string> } | { errors: string[] } {
  const t = Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, specTidy(input[f])])) as Record<AddressField, string>
  const len = (s: string) => [...s].length
  const errors: string[] = []
  if (t.name === '') errors.push('NAME_EMPTY')
  else if (len(t.name) > 20) errors.push('NAME_TOO_LONG')
  const phone = t.phone.replace(/[ \-.()]/g, '')
  if (phone === '') errors.push('PHONE_EMPTY')
  else if (!(/^[0-9]+$/.test(phone) && phone.startsWith('0') && phone.length >= 9 && phone.length <= 11)) errors.push('PHONE_INVALID')
  if (t.address === '') errors.push('ADDRESS_EMPTY')
  else if (len(t.address) > 100) errors.push('ADDRESS_TOO_LONG')
  if (len(t.detail) > 100) errors.push('DETAIL_TOO_LONG')
  if (t.zip !== '' && !/^[0-9]{5}$/.test(t.zip)) errors.push('ZIP_INVALID')
  if (len(t.memo) > 50) errors.push('MEMO_TOO_LONG')
  return errors.length > 0 ? { errors } : { ok: { ...t, phone } }
}

// 실제 사람이 붙여 넣을 법한 조각 + 다듬기를 시험하는 글자
const PIECES = [
  '홍', '길동', '김', '서울특별시', ' 중구 ', '세종대로 110', '101동', '202호', '문 앞에', '경비실',
  ' ', '  ', '\t', '\n', '\r\n', '　', ' ', '​', '﻿', '\u0000', '\u0085', '\u007f',
  '홍', // 풀어 쓴 "홍"
  '🌵', '🪴', '漢', 'Ａ', '０', '<b>', '&amp;', '"', "'",
  '0', '1', '5', '9', '010', '-', '.', '(', ')', '+82', '０１０',
]
const piece = fc.constantFrom(...PIECES)
const field = fc.oneof(
  { arbitrary: fc.array(piece, { maxLength: 12 }).map((xs) => xs.join('')), weight: 4 },
  { arbitrary: fc.string({ maxLength: 30 }), weight: 1 },
  { arbitrary: fc.integer({ min: 0, max: 130 }).map((n) => '가'.repeat(n)), weight: 1 },
)
const phoneArb = fc.oneof(
  fc.constantFrom('010-1234-5678', '01012345678', '(02) 123-4567', '010.1234.5678', ' 010 1234 5678 ', '021234567', '0101234567890', '+82 10-1234-5678', '０１０１２３４５６７８', '010-1234-567８', '1012345678'),
  fc.array(fc.constantFrom('0', '1', '2', '9', '-', ' ', '.', '(', ')', '　'), { maxLength: 16 }).map((xs) => xs.join('')),
  field,
)
const zipArb = fc.oneof(fc.constantFrom('', '04524', ' 04524 ', '0452', '045245', '０４５２４', '04-524'), fc.stringMatching(/^[0-9]{0,6}$/), field)
const addressInput = fc.record({ name: field, phone: phoneArb, address: field, detail: field, zip: zipArb, memo: field })

describe('TD-T1 PC-2 배송지 읽기 = 스펙 문장', () => {
  it('무작위 입력에서 결과가 기준 구현과 같다 (다듬기·길이·연락처·우편번호·오류 순서)', () => {
    fc.assert(
      fc.property(addressInput, (input) => {
        expect(readAddress(input)).toEqual(specRead(input))
      }),
      { numRuns: 3000, seed: 20261023 },
    )
  })

  it('읽은 값을 다시 읽으면 그대로다 (판매자가 본 값으로 고쳐 저장해도 바뀌지 않는다)', () => {
    fc.assert(
      fc.property(addressInput, (input) => {
        const first = readAddress(input)
        if ('ok' in first) expect(readAddress(first.ok)).toEqual(first)
      }),
      { numRuns: 2000, seed: 7 },
    )
  })

  it('경계: 받는 분 20자(이모지·풀어 쓴 한글 포함)는 받고 21자는 NAME_TOO_LONG', () => {
    const base = { phone: '01012345678', address: '서울', detail: '', zip: '', memo: '' }
    expect(readAddress({ ...base, name: '🌵'.repeat(20) })).toMatchObject({ ok: { name: '🌵'.repeat(20) } })
    expect(readAddress({ ...base, name: '🌵'.repeat(21) })).toEqual({ errors: ['NAME_TOO_LONG'] })
    // 풀어 쓴 한글 20자(코드 포인트 60개)는 NFC 뒤 20자
    expect(readAddress({ ...base, name: '홍'.repeat(20) })).toMatchObject({ ok: { name: '홍'.repeat(20) } })
    // 공백만인 이름은 비었다, 제로폭 글자는 거르지 않는다(스펙: 따로 거르는 글자 표 없음)
    expect(readAddress({ ...base, name: '　\t\n' })).toEqual({ errors: ['NAME_EMPTY'] })
  })
})

// ── PC-4 기준 구현 ────────────────────────────────────────────────────────

function specEligibility(f: EligibilityFacts): { ready: true } | { reason: string } {
  const table: [string, boolean][] = [
    ['BOOKING', f.parcel === 'PENDING' || f.parcel === 'UNKNOWN'],
    ['BOOKED', f.parcel === 'BOOKED'],
    ['NO_ITEMS', f.items === 0],
    ['PICKUP', f.shipping === 'PICKUP'],
    ['COMBINED', f.shipping === 'COMBINED'],
    ['SHIPPED', f.packing === '배송 완료' || f.packing === '배송 뒤 바뀜'],
    ['NOT_PAID', f.payment === 'UNPAID' || f.payment === 'PARTIAL'],
    ['NOT_PACKED', f.packing === '포장 대기'],
    ['PACK_CHECK', f.packing === '포장 다시 확인'],
    ['NO_ADDRESS', f.address === 'NONE'],
    ['ADDRESS_UNCONFIRMED', f.address === 'UNCONFIRMED'],
  ]
  const hit = table.find(([, when]) => when)
  return hit === undefined ? { ready: true } : { reason: hit[0] }
}

describe('TD-T1 PC-4 접수할 수 있는지 = 표', () => {
  it('사실 조합 전부에서 표 위에서부터 처음 걸린 이유와 같다', () => {
    let count = 0
    for (const items of [0, 1, 3])
      for (const shipping of SHIPPING_KINDS)
        for (const payment of PAYMENT_KINDS)
          for (const packing of PACKING_WORD_KINDS)
            for (const parcel of PARCEL_STATE_KINDS)
              for (const address of ADDRESS_STATES) {
                const facts: EligibilityFacts = { items, shipping, payment, packing, parcel, address }
                expect(parcelEligibility(facts), JSON.stringify(facts)).toEqual(specEligibility(facts))
                count++
              }
    expect(count).toBe(3 * 4 * 4 * 5 * 6 * 3)
  })
})

// ── PC-3 보관 30일 경계 (KST) ─────────────────────────────────────────────

const H = 3_600_000
const kstMidnight = (date: string, plusDays: number): number => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d + plusDays) - 9 * H
}

describe('TD-T1 PC-3 보관 기간 경계', () => {
  it('보관 끝 = 날짜 + 30일의 0시 KST, 정리 작업이 지우는 날짜 ⇔ 그 시각이 지났거나 같다', () => {
    const dateArb = fc.date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2027-12-31T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10))
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -2 * 24 * H, max: 2 * 24 * H }), (date, offset) => {
        expect(addressExpiresAt(date)).toBe(kstMidnight(date, 30))
        const now = addressExpiresAt(date) + offset
        // 정리 작업은 date <= lastExpiredDate(now)인 날짜를 지운다
        expect(date <= lastExpiredDate(now), `${date} now=${new Date(now).toISOString()}`).toBe(now >= addressExpiresAt(date))
      }),
      { numRuns: 2000, seed: 1022 },
    )
  })

  it('AC-T1-03 예: 2026-10-01은 2026-10-30 23:59 KST에는 남고 2026-10-31 00:00 KST에 지운다 (해가 바뀌는 12-02도)', () => {
    expect(lastExpiredDate(kstMidnight('2026-10-31', 0) - 60_000) < '2026-10-01').toBe(true)
    expect(lastExpiredDate(kstMidnight('2026-10-31', 0))).toBe('2026-10-01')
    expect(addressExpiresAt('2026-12-02')).toBe(kstMidnight('2027-01-01', 0))
    expect(lastExpiredDate(kstMidnight('2027-01-01', 0))).toBe('2026-12-02')
  })
})

// ── PC-5 멈춘 시도 ───────────────────────────────────────────────────────

describe('TD-T1 PC-5 멈춘 시도 2분', () => {
  it('PENDING은 2분 "넘게" 남아야 UNKNOWN, 다른 상태는 그대로', () => {
    expect(effectiveState('PENDING', 0, STALE_PENDING_MS)).toBe('PENDING')
    expect(effectiveState('PENDING', 0, STALE_PENDING_MS + 1)).toBe('UNKNOWN')
    for (const state of ['UNKNOWN', 'BOOKED', 'FAILED', 'CANCELLED'] as const) expect(effectiveState(state, 0, 10 * STALE_PENDING_MS)).toBe(state)
  })
})

// ── PC-7 운송장 ──────────────────────────────────────────────────────────

describe('TD-T1 PC-7 운송장 순수 함수', () => {
  const invoiceArb = fc.integer({ min: 8, max: 20 }).chain((n) => fc.stringMatching(new RegExp(`^[0-9]{${String(n)}}$`)))

  it('Code 128: 시작 C, 두 자리씩, 홀수면 마지막 앞 코드 B, 검사값 = (105 + Σ 위치×값) mod 103, 끝 106 — 부호값에서 송장번호를 되살린다', () => {
    fc.assert(
      fc.property(invoiceArb, (invoice) => {
        const out = code128Codes(invoice)
        expect('codes' in out).toBe(true)
        const codes = (out as { codes: readonly number[] }).codes
        expect(codes[0]).toBe(105)
        expect(codes.at(-1)).toBe(106)
        const data = codes.slice(1, -2)
        const check = codes.at(-2) as number
        expect(check).toBe((105 + data.reduce((sum, v, i) => sum + (i + 1) * v, 0)) % 103)
        let text = ''
        let setB = false
        for (const v of data) {
          if (v === 100) setB = true
          else text += setB ? String.fromCharCode(v + 32) : String(v).padStart(2, '0')
        }
        expect(text).toBe(invoice)
        expect(data.filter((v) => v === 100).length).toBe(invoice.length % 2)
      }),
      { numRuns: 500, seed: 128 },
    )
    for (const bad of ['1234567', '123456789012345678901', '12345678a', '１２３４５６７８', '', '1234 5678']) expect(code128Codes(bad)).toEqual({ error: 'FORMAT' })
  })

  it('연락처 가리기: 앞 3 + * (n−7)개 + 뒤 4, 송장번호 글: 4자리마다 -', () => {
    fc.assert(
      fc.property(fc.integer({ min: 9, max: 11 }).chain((n) => fc.stringMatching(new RegExp(`^0[0-9]{${String(n - 1)}}$`))), (phone) => {
        expect(maskPhone(phone)).toBe(`${phone.slice(0, 3)}${'*'.repeat(phone.length - 7)}${phone.slice(-4)}`)
      }),
      { numRuns: 300, seed: 3 },
    )
    fc.assert(
      fc.property(invoiceArb, (invoice) => {
        expect(formatInvoiceNumber(invoice)).toBe((invoice.match(/.{1,4}/g) as string[]).join('-'))
      }),
      { numRuns: 300, seed: 4 },
    )
  })

  it('AC-T1-42: PC-2가 받는 가장 긴 바른 배송지(받는 분 20·주소 100·상세 100·메모 50, 띄어쓰기 없음·넓은 글자 포함)와 가장 긴 보내는 사람도 운송장에 들어간다', () => {
    const font = loadDocumentFont(fontBytes())
    const base: WaybillData = {
      carrier: 'FAKE',
      invoice: '90000000000000000001',
      receiver: { name: '홍길동', phone: '01012345678', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', zip: '04524', memo: '문 앞에' },
      sender: { name: '다육이네', phone: '0311234567', address: '경기도 수원시 팔달구 효원로 1', detail: '1층' },
      itemCount: 999,
      box: '극소',
      bookedDate: '2026-10-22',
    }
    const realistic = '경기도 성남시 분당구 판교역로 235 에이치스퀘어 엔동 '.repeat(5).slice(0, 100)
    for (const fill of ['가', 'W', '鬱', '@']) {
      const receiver = { name: fill.repeat(20), phone: '01012345678', address: fill.repeat(100), detail: fill.repeat(100), zip: '04524', memo: fill.repeat(50) }
      const sender = { name: fill.repeat(20), phone: '0311234567', address: fill.repeat(100), detail: fill.repeat(100) }
      const out = layoutWaybill({ ...base, receiver, sender }, font)
      expect(out.ok, `${fill} ${out.ok ? '' : out.error.code}`).toBe(true)
    }
    const out = layoutWaybill({ ...base, receiver: { ...base.receiver, address: realistic, detail: realistic, memo: realistic.slice(0, 50) } }, font)
    expect(out.ok).toBe(true)
  })
})
