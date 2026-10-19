// 문자찜 (AC-S03-10~13): 판정표, 구매자 정하기·휴대폰 번호 정규화, ref 재전송, 표시 이름과 개인정보, 수신 시각 해석.
import { spawnSync } from 'node:child_process'
import {
  applyEvent,
  buyerOfRef,
  currentBuyerOf,
  getBuyer,
  getProduct,
  listBuyers,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  isValidDate,
  isValidReceivedTime,
  normalizePhone,
  resolveReceivedTime,
  type EngineEvent,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { RECEIVED_TIME, T0, chat, kst, play, register, sms } from './engine-helpers.ts'

const HOUR = 3_600_000

describe('AC-S03-10 문자찜 판정 — 채팅 찜과 같은 판정표', () => {
  it('차단된 지정 구매자 → BLOCKED, 상품 없음·READY → 보류, HOLD·CLOSED → NOT_ON_SALE, 확정·대기·품절', () => {
    const { state } = play(
      [
        register(1),
        register(2, { status: 'READY' }),
        register(3),
        { type: 'product.hold', b: 'b1', no: 3 },
        register(4),
        { type: 'product.close', b: 'b1', no: 4 },
        chat('X', '안녕'),
        { type: 'host.blockBuyer', buyer: 'X', reason: '장난' },
        sms('s1', 1, '20:00', { buyer: 'X' }),
        sms('s2', 1, '20:00'),
        sms('s3', 1, '20:00'),
        sms('s4', 9, '20:00'),
        sms('s5', 2, '20:00'),
        sms('s6', 3, '20:00'),
        sms('s7', 4, '20:00'),
      ],
      { 'waitlist.max': 0 },
    )
    expect(listClaims(state).map((c) => [c.buyer, c.no, c.status, c.reason, c.origin])).toEqual([
      ['X', 1, 'REJECTED', 'BLOCKED', 'sms'],
      ['sms:s2', 1, 'CONFIRMED', null, 'sms'],
      ['sms:s3', 1, 'REJECTED', 'SOLD_OUT', 'sms'],
      ['sms:s4', 9, 'PENDING', 'UNOPENED', 'sms'],
      ['sms:s5', 2, 'PENDING', 'UNOPENED', 'sms'],
      ['sms:s6', 3, 'REJECTED', 'NOT_ON_SALE', 'sms'],
      ['sms:s7', 4, 'REJECTED', 'NOT_ON_SALE', 'sms'],
    ])
    expect(listPending(state).map((p) => [p.product, p.buyers])).toEqual([
      ['b1/2', ['sms:s5']],
      ['b1/9', ['sms:s4']],
    ])
  })

  it('같은 구매자(같은 번호)의 활성 찜이 있으면 새 찜이 없다 — 보류 중이어도', () => {
    const { state } = play([sms('s1', 7, '20:00', { phone: '010-1111-2222' }), sms('s2', 7, '20:01', { phone: '01011112222' })])
    expect(listClaims(state)).toHaveLength(1)
    expect(buyerOfRef(state, 's2')).toBe('sms:s1')
  })

  it('접수순(기본): 문자찜의 순위는 그 이벤트의 seq — 수신이 더 빨라도 늦게 입력되면 대기', () => {
    const { state } = play([register(15, { at: kst(20) }), chat('A', '15', { at: kst(20, 0, 10) }), sms('s1', 15, '20:00:01', { at: kst(20, 1) })])
    expect(getProduct(state, 'b1', 15)).toMatchObject({ winners: ['A'], waitlist: ['sms:s1'] })
  })

  it('보류 찜 유효 시간은 수신 시각이 아니라 입력 시각(at)으로 잰다 — 정책과 상관없이', () => {
    for (const settings of [{}, RECEIVED_TIME]) {
      const { state } = play(
        [
          sms('s1', 15, '19:00', { at: kst(20, 0, 10) }),
          sms('s2', 16, '20:00:59', { at: kst(20, 0, 20) }),
          register(15, { at: kst(20, 0, 40) }),
          register(16, { at: kst(20, 0, 51) }),
        ],
        settings,
      )
      expect(listClaims(state).map((c) => [c.buyer, c.status, c.reason])).toEqual([
        ['sms:s1', 'CONFIRMED', null],
        ['sms:s2', 'REJECTED', 'EXPIRED'],
      ])
    }
  })
})

describe('AC-S03-11 문자찜 구매자 정하기', () => {
  it('지정 구매자 → 휴대폰 번호 → 새 문자 구매자. 지정 구매자가 있으면 전화번호는 보지 않는다', () => {
    const { state } = play([
      chat('UC_H', '안녕'),
      sms('s1', 1, '20:00', { phone: '010-1234-5678' }),
      sms('s2', 2, '20:00', { phone: '010-1234-5678', buyer: 'UC_H' }),
      sms('s3', 3, '20:00', { phone: '010 1234 5678' }),
      sms('s4', 4, '20:00'),
      sms('s5', 5, '20:00'),
    ])
    expect(['s1', 's2', 's3', 's4', 's5'].map((ref) => buyerOfRef(state, ref))).toEqual(['sms:s1', 'UC_H', 'sms:s1', 'sms:s4', 'sms:s5'])
    expect(listBuyers(state).map((b) => [b.id, b.kind])).toEqual([
      ['UC_H', 'youtube'],
      ['sms:s1', 'sms'],
      ['sms:s4', 'sms'],
      ['sms:s5', 'sms'],
    ])
  })

  it('엔진이 모르는 지정 구매자 → 이벤트 전체가 아무 일도 없다 (ref도 받지 않는다 — 고쳐 보내면 받는다)', () => {
    const { state } = play([register(1), chat('UC_A', '안녕')])
    const unknown = applyEvent(state, { seq: 10, at: T0 + 10_000, ...sms('s1', 1, '20:00', { buyer: 'UC_Z', memo: '메모', phone: '010-1234-5678' }) } as EngineEvent)
    expect(unknown.state).toBe(state)
    expect(unknown.effects).toEqual([])
    expect(buyerOfRef(unknown.state, 's1')).toBeNull()
    const fixed = applyEvent(state, { seq: 11, at: T0 + 11_000, ...sms('s1', 1, '20:00', { buyer: 'UC_A' }) } as EngineEvent).state
    expect(getProduct(fixed, 'b1', 1)?.winners).toEqual(['UC_A'])
  })

  it('이미 받은 ref가 다시 오면 아무 일도 없다 — 내용(번호·지정 구매자·전화번호·메모·수신 시각)을 바꿔도', () => {
    const { state } = play([register(1), register(2), chat('UC_A', '안녕'), sms('s1', 1, '20:00', { memo: '처음' })])
    const before = JSON.stringify([listClaims(state), listBuyers(state), listEffects(state)])
    for (const resend of [
      sms('s1', 1, '20:00', { memo: '처음' }),
      sms('s1', 2, '19:00:01', { memo: '바꿈', phone: '010-9999-0000' }),
      sms('s1', 2, '20:00', { buyer: 'UC_A' }),
    ]) {
      const result = applyEvent(state, { seq: 50, at: T0 + 50_000, ...resend } as EngineEvent)
      expect(result.state).toBe(state)
      expect(result.effects).toEqual([])
      expect(JSON.stringify([listClaims(result.state), listBuyers(result.state), listEffects(result.state)])).toBe(before)
    }
  })

  it('구매자 키 sms:<ref>는 그 문자찜이 정한 구매자로 풀린다 — 다른 ref여도 같은 번호면 같은 구매자, 다른 방송에서도', () => {
    const B2 = { id: 'b2', date: '2026-10-18', title: '2부' }
    const { state } = play(
      [register(1), register(1, { b: 'b2' }), sms('s1', 1, '20:00', { phone: '010-5555-0001' }), sms('s2', 1, '20:00', { phone: '01055550001', b: 'b2' })],
      {},
      [{ id: 'b1', date: '2026-10-18', title: '1부' }, B2],
    )
    expect(buyerOfRef(state, 's2')).toBe('sms:s1')
    expect(getBuyer(state, 'sms:s1')).toMatchObject({ items: ['b1/1', 'b2/1'], subtotal: 20000 })
    expect(listSettlements(state).map((s) => [s.buyer, s.subtotal, s.shipping])).toEqual([['sms:s1', 20000, 4000]])
    expect(currentBuyerOf(state, 'sms:s1')).toBe('sms:s1')
    expect(buyerOfRef(state, 's9')).toBeNull()
  })

  describe('휴대폰 번호 정규화 (D-051)', () => {
    it.each([
      ['010-1234-5678', '01012345678'],
      ['010 1234 5678', '01012345678'],
      ['01012345678', '01012345678'],
      ['０１０１２３４５６７８', '01012345678'],
      ['０１０-１２３４-５６７８', '01012345678'],
      ['(010) 1234-5678', '01012345678'],
      ['010.1234.5678', '01012345678'],
      ['010-1234-5678 (집)', '01012345678'],
      ['  010-1234-5678  ', '01012345678'],
      ['011-123-4567', '0111234567'],
      ['0161234567', '0161234567'],
      ['5678', null],
      ['1234-5678', null],
      ['+82 10-1234-5678', null],
      ['+82-010-1234-5678', null],
      ['82 10 1234 5678', null],
      ['010-123-456', null],
      ['010-1234-56789', null],
      ['02-1234-5678', null],
      ['0212345678', null],
      ['10-1234-5678', null],
      ['', null],
      ['없음', null],
      ['٠١٠١٢٣٤٥٦٧٨', null],
    ])('%s → %s', (input, expected) => {
      expect(normalizePhone(input)).toBe(expected)
    })

    it('속성: 결과가 있으면 01로 시작하는 10~11자리 숫자이고, 다시 넣어도 같다(멱등). 구분 글자를 끼워도 같다', () => {
      const digit = fc.constantFrom(...'0123456789')
      const separator = fc.constantFrom(' ', '-', '+', '(', ')', '.', '/', '·', '번', 'ㄱ', '​')
      fc.assert(
        fc.property(fc.array(fc.oneof({ weight: 5, arbitrary: digit }, { weight: 1, arbitrary: separator }), { maxLength: 20 }), (chars) => {
          const input = chars.join('')
          const result = normalizePhone(input)
          if (result !== null) {
            expect(result).toMatch(/^01\d{8,9}$/)
            expect(normalizePhone(result)).toBe(result)
          }
          expect(normalizePhone(input.replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x30 + 0xff10)))).toBe(result)
          expect(normalizePhone(chars.filter((c) => /\d/.test(c)).join('-'))).toBe(result)
        }),
        { numRuns: 500 },
      )
    })
  })
})

describe('AC-S03-12 문자 구매자 표시와 개인정보', () => {
  it('표시 이름 = 가장 최근의 비어 있지 않은 메모(앞뒤 공백 제거), 찜을 만들지 않은 문자찜의 메모도, 이력은 바뀔 때마다(연속 중복 없음)', () => {
    const phone = { phone: '010-2222-3333' }
    const { state } = play([
      register(1),
      sms('s1', 1, '20:00', phone),
      sms('s2', 1, '20:00', { ...phone, memo: '  길동 이모 ' }),
      sms('s3', 2, '20:00', { ...phone, memo: '   ' }),
      sms('s4', 3, '20:00', { ...phone, memo: '길동 이모' }),
      sms('s5', 4, '20:00', { ...phone, memo: '길동' }),
      sms('s6', 5, '20:00', { ...phone, memo: '길동 이모' }),
    ])
    expect(getBuyer(state, 'sms:s1')).toMatchObject({ display: '문자찜(길동 이모)', nameHistory: ['문자찜', '문자찜(길동 이모)', '문자찜(길동)', '문자찜(길동 이모)'] })
    // s2는 1번에 같은 사람 반복이라 찜이 없지만 메모는 반영됐다
    expect(listClaims(state).map((c) => c.no)).toEqual([1, 2, 3, 4, 5])
  })

  it('처음 메모가 있으면 이력의 처음도 그 이름이다. 지정 구매자가 유튜브 구매자면 메모는 그 이름을 바꾸지 않는다', () => {
    const { state } = play([register(1), register(2), chat('UC_H', '안녕', { nick: '홍길동' }), sms('s1', 1, '20:00', { memo: '이모' }), sms('s2', 2, '20:00', { memo: '홍 사장님', buyer: 'UC_H' })])
    expect(getBuyer(state, 'sms:s1')).toMatchObject({ display: '문자찜(이모)', nameHistory: ['문자찜(이모)'] })
    expect(getBuyer(state, 'UC_H')).toMatchObject({ display: '홍길동', nameHistory: ['홍길동'] })
    // 문자찜으로 생긴 찜의 감사 이름은 지정 구매자가 유튜브여도 "문자찜"
    expect(listEffects(state).filter((e) => e.kind === 'POST_THANKS').map((e) => e.text)).toEqual(['1번 핑크프릴 10,000원 문자찜님 구매 감사합니다', '2번 핑크프릴 10,000원 문자찜님 구매 감사합니다'])
  })

  it('조회 결과의 전화번호는 뒤 4자리뿐, 효과·효과 ID·찜 ID·조회 결과 어디에도 전체 번호·메모가 없다', () => {
    const phone = '010-9876-5432'
    const memo = '김영희이모'
    const { state, emitted } = play(
      [
        register(1),
        register(2),
        sms('s1', 1, '20:00:03', { phone, memo }),
        sms('s2', 2, '20:00:04', { phone: '01098765432', memo: '두번째메모' }),
        { type: 'effect.labelPrinted', effectId: 'c1:PRINT_PRODUCT_LABEL:-:1' },
        { type: 'host.cancel', b: 'b1', no: 1, buyer: 'sms:s1', reason: '착오' },
      ],
      { 'thanks.videoComment': 'PER_SALE' },
    )
    expect(getBuyer(state, 'sms:s1')?.phoneLast4).toBe('5432')
    const effects = JSON.stringify([emitted, listEffects(state), listClaims(state).map((c) => c.id)])
    for (const secret of ['98765432', '9876', '010-9876', memo, '두번째메모']) expect(effects).not.toContain(secret)
    const views = JSON.stringify([listBuyers(state), listClaims(state), listProducts(state), listPending(state), listSettlements(state)])
    for (const secret of ['98765432', '010-9876-5432', '01098765432']) expect(views).not.toContain(secret)
    expect(listEffects(state).some((e) => e.kind === 'VOID_LABEL')).toBe(true)
  })
})

describe('AC-S03-13 문자 수신 시각 해석 (D-023)', () => {
  const KST = 9 * HOUR
  const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0): number => Date.UTC(y, mo - 1, d, h, mi, s) - KST

  it.each([
    ['00:01:30 입력의 23:59:40 → 전날', at(2026, 10, 19, 0, 1, 30), '23:59:40', at(2026, 10, 18, 23, 59, 40), false],
    ['20:10:06 입력의 20:10:08 → 당일(휴대폰 시계가 빠름)', at(2026, 10, 18, 20, 10, 6), '20:10:08', at(2026, 10, 18, 20, 10, 8), false],
    ['23:59:50 입력의 00:00:05 → 다음날', at(2026, 10, 18, 23, 59, 50), '00:00:05', at(2026, 10, 19, 0, 0, 5), false],
    ['분 단위는 구간 시작으로 잰다', at(2026, 10, 18, 20, 0, 59), '20:00', at(2026, 10, 18, 20, 0), true],
    ['자정 직후 입력의 분 단위 23:59 → 전날 23:59 구간', at(2026, 10, 19, 0, 0, 20), '23:59', at(2026, 10, 18, 23, 59), true],
    ['정확히 12시간 떨어진 두 날짜 → 늦은 날짜', at(2026, 10, 18, 8, 0), '20:00', at(2026, 10, 18, 20, 0), true],
    ['정확히 12시간 (초 단위) → 늦은 날짜', at(2026, 10, 18, 20, 0, 0), '08:00:00', at(2026, 10, 19, 8, 0, 0), false],
    ['12시간보다 1초 가까운 과거', at(2026, 10, 18, 20, 0, 0), '08:00:01', at(2026, 10, 18, 8, 0, 1), false],
    ['연말 자정', at(2027, 1, 1, 0, 0, 30), '23:59:59', at(2026, 12, 31, 23, 59, 59), false],
  ])('%s', (_name, input, received, expected, minute) => {
    expect(resolveReceivedTime(received, input)).toEqual({ time: expected, minute })
  })

  it.each(['24:00', '8:01', '20:01:60', '20:60', '20:1', '20:01:5', '2001', '20:01:00.5', ' 20:01', '２０:０１', ''])('형식이 틀리면 null: %j', (received) => {
    expect(resolveReceivedTime(received, at(2026, 10, 18, 20, 0))).toBeNull()
  })

  it('at이 유한한 수가 아니면 null', () => {
    expect(resolveReceivedTime('20:00', Number.NaN)).toBeNull()
  })

  it('속성: 결과와 at의 거리는 12시간 이하, 결과의 KST 시·분·초 = 입력, 분 단위 ⇔ 초 없음', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 0, 1) }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.option(fc.integer({ min: 0, max: 59 }), { nil: undefined }),
        (input, h, m, s) => {
          const pad = (n: number): string => String(n).padStart(2, '0')
          const text = `${pad(h)}:${pad(m)}${s === undefined ? '' : `:${pad(s)}`}`
          const result = resolveReceivedTime(text, input)
          expect(result).not.toBeNull()
          if (result === null) return
          expect(Math.abs(result.time - input)).toBeLessThanOrEqual(12 * HOUR)
          const clock = (((result.time + KST) % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR)
          expect(clock).toBe(h * HOUR + m * 60_000 + (s ?? 0) * 1000)
          expect(result.minute).toBe(s === undefined)
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('실행 환경의 시간대와 무관하다 (자식 프로세스, AC-S03-03)', () => {
    const script = [
      "import { resolveReceivedTime, initEngine, applyEvent, listProducts } from '@livejjim/core'",
      `const out = [resolveReceivedTime('23:59:40', ${String(at(2026, 10, 19, 0, 1, 30))}), resolveReceivedTime('20:00', ${String(at(2026, 10, 18, 8, 0))})]`,
      "let s = initEngine({ broadcasts: [{ id: 'b1', date: '2026-10-18', title: '1부' }], settings: { 'contention.policy': 'RECEIVED_TIME' } })",
      `s = applyEvent(s, { seq: 1, at: ${String(at(2026, 10, 18, 23, 59))}, type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000 }).state`,
      `s = applyEvent(s, { seq: 2, at: ${String(at(2026, 10, 19, 0, 0, 30))}, type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: 'a', text: '15' }).state`,
      `s = applyEvent(s, { seq: 3, at: ${String(at(2026, 10, 19, 0, 1, 30))}, type: 'sms', b: 'b1', ref: 's1', no: 15, received: '23:59:40' }).state`,
      'process.stdout.write(JSON.stringify([out, listProducts(s)]))',
    ].join('\n')
    const outputs = ['Asia/Seoul', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Chatham'].map((tz) => {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TZ: tz } })
      expect(result.status, result.stderr).toBe(0)
      return result.stdout
    })
    expect(new Set(outputs).size).toBe(1)
    expect(JSON.parse(outputs[0] as string)[1][0].winners).toEqual(['sms:s1'])
  })
})

describe('순수 도우미의 입력 검사 (AC-S03-01)', () => {
  it('isValidDate: 실제 있는 YYYY-MM-DD만 (윤년·달의 날 수)', () => {
    for (const ok of ['2024-02-29', '2000-02-29', '2026-02-28', '2026-04-30', '2026-12-31', '2026-01-31']) expect(isValidDate(ok), ok).toBe(true)
    for (const bad of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31', '2026-13-01', '2026-00-10', '2026-10-00', '26-10-18', '2026-1-18', 20261018, null]) {
      expect(isValidDate(bad), String(bad)).toBe(false)
    }
  })

  it('isValidReceivedTime·resolveReceivedTime·normalizePhone은 문자열이 아니면 받지 않는다', () => {
    expect(isValidReceivedTime(2001)).toBe(false)
    expect(resolveReceivedTime(2001 as unknown as string, 0)).toBeNull()
    expect(normalizePhone(1012345678 as unknown as string)).toBeNull()
  })
})
