// S03b 코어 정리 (AC-S03b-01~03·10·20~23·30·31): 전화번호 키·뒤 4자리, ref 첫 수신 기록, 메시지 변환·시청자 취소·충돌 중 배정·한쪽만 온 교체,
// 재고 늘림 확정버전 순서, 충돌이 자리가 비어 풀릴 때의 넘침 정리. 골든(14-core-cleanup)이 고정한 것 밖의 경계와 경로를 규칙 문장대로 본다.
import {
  InvalidEventError,
  applyEvent,
  buyerOfRef,
  checkEvent,
  getBuyer,
  getProduct,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listSmsRefs,
  normalizePhone,
  phoneLast4,
  type EngineEvent,
  type EngineState,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { Draft } from '../../src/engine/draft.ts'
import { smsPhoneFields, testPhoneKey } from '../golden/phone-key.ts'
import { RECEIVED_TIME, T0, chat, host, kst, play, register, sms, type EventInput } from './engine-helpers.ts'

const KEY_A = testPhoneKey('01012345678')
const KEY_B = testPhoneKey('01077775678')
const product = (state: EngineState, no = 15) => getProduct(state, 'b1', no)
const claimOf = (state: EngineState, buyer: string, no = 15) => listClaims(state).findLast((c) => c.buyer === buyer && c.no === no)
const apply = (state: EngineState, event: Record<string, unknown>, seq = 99) => applyEvent(state, { seq, at: T0 + seq * 1000, ...event } as EngineEvent)
const assign = (buyer: string, extra: Record<string, unknown> = {}, no = 15): EventInput => ({ type: 'host.assign', b: 'b1', no, buyer, reason: '사유', ...extra }) as EventInput
const convert = (msg: string, no: number): EventInput => ({ type: 'host.convertMessage', b: 'b1', msg, no })
const merge = (from: string, into: string): EventInput => ({ type: 'buyer.merge', from, into, reason: '같은 사람' })

// ── A. 개인정보 — 전화번호 키 ────────────────────────────────────────────

describe('AC-S03b-01 sms 이벤트 모양과 입력 오류', () => {
  const base = play([register(15), chat('UC_A', '안녕')]).state
  const SMS = { type: 'sms', b: 'b1', ref: 's1', no: 15, received: '20:00' }

  const malformed: readonly (readonly [string, Record<string, unknown>, string])[] = [
    ['phone만', { phone: '010-1234-5678' }, 'phone'],
    ['phone과 키·뒤 4자리 함께', { phone: '010-1234-5678', phoneKey: KEY_A, phoneLast4: '5678' }, 'phone'],
    ['phone이 undefined여도 필드가 있음', { phone: undefined }, 'phone'],
    ['phone이 빈 문자열', { phone: '' }, 'phone'],
    ['phoneKey만', { phoneKey: KEY_A }, 'phoneLast4'],
    ['phoneLast4만', { phoneLast4: '5678' }, 'phoneKey'],
    ['phoneKey 15자', { phoneKey: 'a'.repeat(15), phoneLast4: '5678' }, 'phoneKey'],
    ['phoneKey 129자', { phoneKey: 'a'.repeat(129), phoneLast4: '5678' }, 'phoneKey'],
    ['phoneKey 빈 문자열', { phoneKey: '', phoneLast4: '5678' }, 'phoneKey'],
    ['phoneKey에 공백', { phoneKey: `${'a'.repeat(16)} b`, phoneLast4: '5678' }, 'phoneKey'],
    ['phoneKey에 +', { phoneKey: `${'a'.repeat(16)}+`, phoneLast4: '5678' }, 'phoneKey'],
    ['phoneKey에 = (base64 채움)', { phoneKey: `${'a'.repeat(16)}=`, phoneLast4: '5678' }, 'phoneKey'],
    ['phoneKey에 /', { phoneKey: `${'a'.repeat(16)}/`, phoneLast4: '5678' }, 'phoneKey'],
    ['phoneKey에 한글', { phoneKey: `${'a'.repeat(16)}김`, phoneLast4: '5678' }, 'phoneKey'],
    ['phoneKey가 수', { phoneKey: 1234567890123456, phoneLast4: '5678' }, 'phoneKey'],
    ['phoneKey가 하이픈 번호(13자)', { phoneKey: '010-1234-5678', phoneLast4: '5678' }, 'phoneKey'],
    ['phoneKey가 정규화한 번호(11자)', { phoneKey: '01012345678', phoneLast4: '5678' }, 'phoneKey'],
    ['phoneLast4 3자리', { phoneKey: KEY_A, phoneLast4: '567' }, 'phoneLast4'],
    ['phoneLast4 5자리', { phoneKey: KEY_A, phoneLast4: '56789' }, 'phoneLast4'],
    ['phoneLast4 전각', { phoneKey: KEY_A, phoneLast4: '５６７８' }, 'phoneLast4'],
    ['phoneLast4에 글자', { phoneKey: KEY_A, phoneLast4: '12a4' }, 'phoneLast4'],
    ['phoneLast4가 수', { phoneKey: KEY_A, phoneLast4: 5678 }, 'phoneLast4'],
    ['phoneLast4 끝에 줄바꿈', { phoneKey: KEY_A, phoneLast4: '5678\n' }, 'phoneLast4'],
    ['ref 빈 문자열', { ref: '' }, 'ref'],
    ['ref 65자', { ref: 'a'.repeat(65) }, 'ref'],
    ['ref 한글(이름)', { ref: '김영희' }, 'ref'],
    ['ref에 공백', { ref: 's 1' }, 'ref'],
    ['ref에 :', { ref: 's:1' }, 'ref'],
    ['ref가 전화번호와 공백', { ref: '010-1234-5678 ' }, 'ref'],
    ['ref가 수', { ref: 15 }, 'ref'],
  ]

  it.each(malformed)('%s → 입력 오류, 상태 그대로, checkEvent가 같은 필드를 짚는다', (_name, fields, field) => {
    const before = JSON.stringify(base)
    const event = { seq: 9, at: T0 + 9000, ...SMS, ...fields }
    let thrown: unknown
    try {
      applyEvent(base, event as unknown as EngineEvent)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(InvalidEventError)
    expect((thrown as InvalidEventError).problems.map((p) => p.field)).toContain(field)
    expect(checkEvent(base, event).map((p) => p.field)).toEqual((thrown as InvalidEventError).problems.map((p) => p.field))
    expect(JSON.stringify(base)).toBe(before)
  })

  it.each([
    ['phoneKey 16자·뒤 4자리 0000', { phoneKey: 'a'.repeat(16), phoneLast4: '0000' }],
    ['phoneKey 128자', { phoneKey: `${'A-_9'.repeat(32)}`, phoneLast4: '9999' }],
    ['HMAC-SHA256 base64url 43자', { phoneKey: KEY_A, phoneLast4: '5678' }],
    ['ref 1자', { ref: 'x' }],
    ['ref 64자', { ref: 'a'.repeat(64) }],
    ['ref 영문·숫자·_·-', { ref: 'a-b_C9' }],
    ['ref 숫자만(서버 일련번호)', { ref: '1234567' }],
    ['키 없는 문자찜(전화번호 없음)', {}],
  ] as const)('받는 경계: %s', (_name, fields) => {
    const event = { seq: 9, at: T0 + 9000, ...SMS, ...fields }
    expect(checkEvent(base, event)).toEqual([])
    expect(listClaims(applyEvent(base, event as unknown as EngineEvent).state)).toHaveLength(1)
  })

  it('코어는 서버·화면·골든 러너가 쓸 normalizePhone과 뒤 4자리 도우미를 내보낸다', () => {
    const normalized = normalizePhone('(010) 1234-5678')
    expect(normalized).toBe('01012345678')
    expect(phoneLast4(normalized as string)).toBe('5678')
    expect(smsPhoneFields('010-1234-5678')).toEqual({ phoneKey: KEY_A, phoneLast4: '5678' })
  })
})

describe('AC-S03b-02 전화번호 키로 잇기와 뒤 4자리', () => {
  it('같은 키면 같은 문자 구매자, 뒤 4자리만 같고 키가 다르면 다른 구매자', () => {
    const { state } = play([
      register(1),
      register(2),
      register(3),
      sms('s1', 1, '20:00', { phoneKey: KEY_A, phoneLast4: '5678' }),
      sms('s2', 2, '20:00', { phoneKey: KEY_A, phoneLast4: '5678' }),
      sms('s3', 3, '20:00', { phoneKey: KEY_B, phoneLast4: '5678' }),
    ])
    expect(['s1', 's2', 's3'].map((ref) => buyerOfRef(state, ref))).toEqual(['sms:s1', 'sms:s1', 'sms:s3'])
    expect(getBuyer(state, 'sms:s1')).toMatchObject({ items: ['b1/1', 'b1/2'], phoneLast4: '5678' })
    expect(getBuyer(state, 'sms:s3')).toMatchObject({ items: ['b1/3'], phoneLast4: '5678' })
  })

  it('새 문자 구매자의 뒤 4자리 = 만든 문자찜의 것. 같은 키에 다른 뒤 4자리가 와도 바뀌지 않는다. 키 없이 만든 문자 구매자·유튜브 구매자는 null', () => {
    const { state } = play([
      register(1),
      register(2),
      chat('UC_A', '안녕'),
      sms('s1', 1, '20:00', { phoneKey: KEY_A, phoneLast4: '5678' }),
      sms('s2', 2, '20:00', { phoneKey: KEY_A, phoneLast4: '0000' }),
      sms('s3', 2, '20:00'),
    ])
    expect(buyerOfRef(state, 's2')).toBe('sms:s1')
    expect(listBuyers(state).map((b) => [b.id, b.phoneLast4])).toEqual([
      ['UC_A', null],
      ['sms:s1', '5678'],
      ['sms:s3', null],
    ])
  })

  it('지정 구매자가 있으면 키를 보지도 기록하지도 않는다 — 나중에 같은 키로 온 문자찜은 새 문자 구매자, 지정 구매자에 뒤 4자리가 붙지 않는다', () => {
    const { state } = play([
      register(1),
      register(2),
      chat('UC_H', '안녕'),
      sms('s0', 1, '20:00'),
      sms('s1', 1, '20:00', { buyer: 'UC_H', phoneKey: KEY_A, phoneLast4: '5678' }),
      sms('s2', 2, '20:00', { buyer: 'sms:s0', phoneKey: KEY_B, phoneLast4: '1111' }),
      sms('s3', 2, '20:00', { phoneKey: KEY_A, phoneLast4: '5678' }),
      sms('s4', 1, '20:00', { phoneKey: KEY_B, phoneLast4: '1111' }),
    ])
    expect(['s1', 's2', 's3', 's4'].map((ref) => buyerOfRef(state, ref))).toEqual(['UC_H', 'sms:s0', 'sms:s3', 'sms:s4'])
    expect(getBuyer(state, 'UC_H')?.phoneLast4).toBeNull()
    expect(getBuyer(state, 'sms:s0')?.phoneLast4).toBeNull()
    expect(state.phoneKeys.size).toBe(2)
  })

  it('구매자 보기의 전화번호 정보는 뒤 4자리뿐이다 (키가 보이지 않는다)', () => {
    const { state } = play([register(1), sms('s1', 1, '20:00', { phone: '010-1234-5678' })])
    const buyer = getBuyer(state, 'sms:s1')
    expect(buyer?.phoneLast4).toBe('5678')
    expect(Object.keys(buyer ?? {})).not.toContain('phoneKey')
    expect(JSON.stringify([listBuyers(state), listClaims(state), listSmsRefs(state)])).not.toContain(KEY_A)
  })
})

describe('AC-S03b-03 엔진 상태·효과에 전화번호가 없다', () => {
  const formats = ['010-1234-5678', '01012345678', '(010) 1234 5678', '０１０-１２３４-５６７８', '010.1234.5678', '+82 10-1234-5678', '1234-5678']
  const { state, emitted } = play(
    [
      register(1),
      register(2),
      chat('UC_H', '안녕'),
      ...formats.map((phone, i) => sms(`s${String(i)}`, 1 + (i % 2), '20:00', { phone, memo: i === 0 ? '김영희 010-1234-5678' : '이모' })),
      sms('h1', 2, '20:00', { buyer: 'UC_H', phone: '010-9999-0000' }),
      merge('sms:s0', 'UC_H'),
      { type: 'buyer.unmerge', from: 'sms:s0', reason: '잘못' },
      { type: 'product.renumber', b: 'b1', from: 2, to: 20 },
    ],
    { 'thanks.videoComment': 'PER_SALE' },
  )

  it('상태(직렬화) 어디에도 입력 번호 원문·정규화한 번호가 없다 (메모에 적은 것은 메모 처리 범위 밖이라 빼고 본다)', () => {
    const text = JSON.stringify(state).replaceAll('김영희 010-1234-5678', '<메모>')
    for (const number of ['01012345678', '010-1234-5678', '12345678', '1234-5678', '1234 5678', '１２３４', '01099990000', '99990000', '9999-0000']) expect(text).not.toContain(number)
    expect(state.format).toBe(3)
  })

  it('효과(필드 전부)·효과 ID·찜 ID·구매자 ID에 전화번호 키·뒤 4자리·메모가 없고, 감사 문구는 R-13 공식 그대로(문자찜)', () => {
    const published = JSON.stringify([listEffects(state), emitted, listClaims(state).map((c) => c.id), listBuyers(state).map((b) => b.id)])
    for (const secret of [KEY_A, testPhoneKey('01099990000'), '5678', '김영희', '이모']) expect(published).not.toContain(secret)
    const texts = listEffects(state).flatMap((e) => (e.text === null ? [] : [e.text]))
    expect(texts.length).toBeGreaterThan(0)
    for (const text of texts) expect(text).toMatch(/^\d+번 핑크프릴 10,000원 문자찜님 구매 감사합니다$/)
  })
})

// ── B. 문자찜 재전송 ─────────────────────────────────────────────────────

describe('AC-S03b-10 ref는 처음 받을 때 기록한다', () => {
  it('모르는 지정 구매자의 문자찜: ref만 기록, buyerOfRef는 null, listSmsRefs에는 없다. 알게 된 뒤 사본(같은·다른 내용)은 아무 일도 없다', () => {
    const { state, states } = play([register(15), sms('s1', 15, '20:00', { buyer: 'UC_A', memo: '전화' }), chat('UC_A', '안녕')])
    expect(states[2]).not.toBe(states[1])
    expect(buyerOfRef(state, 's1')).toBeNull()
    expect(listSmsRefs(state)).toEqual([])
    expect(listClaims(state)).toEqual([])
    for (const copy of [
      sms('s1', 15, '20:00', { buyer: 'UC_A', memo: '전화' }),
      sms('s1', 16, '19:59:59', { buyer: 'UC_A' }),
      sms('s1', 15, '20:00', { phone: '010-1234-5678', memo: '다른' }),
      sms('s1', 15, '20:00'),
    ]) {
      const result = apply(state, copy as unknown as Record<string, unknown>)
      expect(result.state).toBe(state)
      expect(result.effects).toEqual([])
    }
  })

  it('작업 사본: 같은 이벤트 안에서 구매자를 정하지 않은 ref(null)를 기록하면 이전 상태로 내려가 읽지 않고 null을 돌려준다', () => {
    const { state } = play([register(15), sms('s1', 15, '20:00')])
    const draft = new Draft(state, { seq: 9, at: T0 })
    expect(draft.readRef('s1')).toBe('sms:s1')
    expect(draft.readRef('s2')).toBeUndefined()
    draft.setRef('s2', null)
    expect(draft.readRef('s2')).toBeNull()
    expect(buyerOfRef(draft.commit().state, 's2')).toBeNull()
  })

  it('같은 ref의 사본은 처음 것이 무엇을 했든(새 구매자·이은 구매자·지정 구매자·같은 사람 반복) 아무것도 바꾸지 않는다', () => {
    const { state } = play([
      register(15),
      chat('UC_A', '15'),
      sms('s1', 15, '20:00', { phone: '010-1234-5678' }),
      sms('s2', 15, '20:00', { phone: '01012345678' }),
      sms('s3', 15, '20:00', { buyer: 'UC_A' }),
    ])
    for (const ref of ['s1', 's2', 's3']) {
      const result = apply(state, sms(ref, 16, '20:00', { phone: '010-7777-5678', memo: '사본' }) as unknown as Record<string, unknown>)
      expect(result.state, ref).toBe(state)
    }
  })
})

// ── C. 방송자 조작 규칙 ──────────────────────────────────────────────────

describe('AC-S03b-20 메시지 변환은 주문이 아니었던 메시지만', () => {
  const unchanged = (events: readonly EventInput[], conversions: readonly EventInput[], settings: Record<string, unknown> = {}) => {
    const { state } = play(events, settings)
    for (const event of conversions) expect(apply(state, event as unknown as Record<string, unknown>).state, JSON.stringify(event)).toBe(state)
  }

  it('STRICT 주문 메시지(찜을 만든·같은 사람 반복이라 만들지 않은)는 같은 번호·다른 번호·상품 없는 번호 어디로도 아무 일도 없다', () => {
    unchanged([register(15), register(16), chat('A', '15', { id: 'm1' }), chat('A', '15번', { id: 'm2' }), host('host.cancel', 15, 'A')], [convert('m1', 15), convert('m1', 16), convert('m1', 30), convert('m2', 15), convert('m2', 16)])
  })

  it('LOOSE에서 주문으로 읽은 "15번 너무 예뻐요"는 주문이었던 메시지, STRICT에서는 언급이라 변환된다 (받을 때의 해석)', () => {
    unchanged([register(15), register(16), chat('A', '15번 너무 예뻐요', { id: 'm1' })], [convert('m1', 15), convert('m1', 16)], { 'claim.parseMode': 'LOOSE' })
    const { state } = play([register(15), register(16), chat('A', '15번 너무 예뻐요', { id: 'm1' }), convert('m1', 16)])
    expect(product(state, 16)?.winners).toEqual(['A'])
  })

  it('FIRST의 "15 16"은 주문(15)이라 16으로도 변환하지 않고, IGNORE의 "15 16"은 주문이 아니라 변환된다', () => {
    unchanged([register(15), register(16), chat('A', '15 16', { id: 'm1' })], [convert('m1', 16), convert('m1', 15)], { 'claim.multiNumber': 'FIRST' })
    const { state } = play([register(15), register(16), chat('A', '15 16', { id: 'm1' }), convert('m1', 16)], { 'claim.multiNumber': 'IGNORE' })
    expect(product(state, 16)?.winners).toEqual(['A'])
  })

  it('차단된 구매자의 주문 메시지(차단 거절)는 차단을 풀어도 변환하지 않는다. 판매 아님으로 거절된 주문도 같다', () => {
    unchanged(
      [register(15), register(16), { type: 'product.hold', b: 'b1', no: 16 }, chat('X', '안녕'), { type: 'host.blockBuyer', buyer: 'X', reason: '장난' }, chat('X', '15', { id: 'm1' }), chat('Y', '16', { id: 'm2' }), { type: 'host.unblockBuyer', buyer: 'X', reason: '풀어 줌' }],
      [convert('m1', 15), convert('m1', 16), convert('m2', 15), convert('m2', 16)],
    )
  })

  it('주문이 아니었던 메시지는 번호마다 한 번: 같은 번호 두 번째는 아무 일도 없고, 다른 번호는 된다. 같은 사람 반복이라 찜이 없었던 변환은 다시 할 수 있다', () => {
    const { state } = play([register(15), register(16), chat('A', '15번이용ㅎ', { id: 'm1' }), chat('A', '16'), convert('m1', 15), convert('m1', 16)])
    expect(apply(state, convert('m1', 15) as unknown as Record<string, unknown>).state).toBe(state)
    expect(listClaims(state).map((c) => [c.no, c.origin])).toEqual([
      [16, 'chat'],
      [15, 'convert'],
    ])
    // A의 16번 찜이 끝나면 16번으로의 변환이 된다(앞의 변환은 찜을 만들지 않았다)
    const after = play([register(15), register(16), chat('A', '15번이용ㅎ', { id: 'm1' }), chat('A', '16'), convert('m1', 16), host('host.cancel', 16, 'A'), convert('m1', 16)]).state
    expect(listClaims(after).map((c) => [c.no, c.origin, c.status])).toEqual([
      [16, 'chat', 'CANCELLED'],
      [16, 'convert', 'CONFIRMED'],
    ])
  })
})

describe('AC-S03b-21 시청자 채팅 취소는 그 채널 자신의 찜에만', () => {
  const AUTO = { 'cancel.buyerChat': 'AUTO' } as const

  it.each([
    ['채팅 주문', [chat('A', '15')]],
    ['메시지 변환', [chat('A', '15번이용ㅎ', { id: 'mx' }), convert('mx', 15)]],
    ['A에게 한 직접 배정', [chat('A', '안녕'), assign('A')]],
    ['A를 지정한 문자찜', [chat('A', '안녕'), sms('s1', 15, '20:00', { buyer: 'A' })]],
  ] as const)('자기 찜(%s)은 AUTO면 취소, REQUEST면 요청 — S문자 구매자와 합쳐져 있어도', (_name, own) => {
    const events: EventInput[] = [register(15), register(16), sms('s0', 16, '20:00'), ...own, merge('A', 'sms:s0'), chat('A', '15 취소')]
    expect(claimOf(play(events, AUTO).state, 'A')?.status).toBe('CANCELLED')
    const request = play(events).state
    expect(listCancelRequests(request).map((r) => [r.product, r.buyer, r.currentBuyer])).toEqual([['b1/15', 'A', 'sms:s0']])
  })

  it.each([
    ['A → S', [merge('A', 'sms:s1')]],
    ['S → A', [merge('sms:s1', 'A')]],
    ['사슬 A → S → B', [merge('A', 'sms:s1'), merge('sms:s1', 'B')]],
    ['사슬 S → A → B', [merge('sms:s1', 'A'), merge('A', 'B')]],
  ] as const)('합친 다른 구매자(문자 구매자)의 찜은 무시 (%s, AUTO·REQUEST), 방송자 조치는 지금의 구매자로 찾는다', (_name, merges) => {
    for (const settings of [AUTO, {}]) {
      const { state, emitted } = play([register(15), sms('s1', 15, '20:00'), chat('A', '안녕'), chat('B', '안녕'), ...merges, chat('A', '15 취소'), chat('B', '15 취소')], settings)
      expect(claimOf(state, 'sms:s1')?.status).toBe('CONFIRMED')
      expect(listCancelRequests(state)).toEqual([])
      expect(emitted.at(-1)).toEqual([])
      expect(emitted.at(-2)).toEqual([])
      const byHost = apply(state, host('host.cancel', 15, 'A') as unknown as Record<string, unknown>).state
      expect(claimOf(byHost, 'sms:s1')?.status).toBe('CANCELLED')
    }
  })

  it('떼어 낸 뒤에는 다시 자기 찜만 본다 — 떼어 낸 문자 구매자의 찜은 여전히 남의 찜', () => {
    const { state } = play([register(15), register(16), sms('s1', 15, '20:00'), chat('A', '16'), merge('A', 'sms:s1'), { type: 'buyer.unmerge', from: 'A', reason: '잘못' }, chat('A', '15 취소'), chat('A', '16 취소')], AUTO)
    expect(claimOf(state, 'sms:s1')?.status).toBe('CONFIRMED')
    expect(claimOf(state, 'A', 16)?.status).toBe('CANCELLED')
  })

  it('합치기 전에 받은 자기 찜의 취소 요청은 합친 뒤에도 승인으로 취소된다 (방송자 조치)', () => {
    const { state } = play([register(15), chat('A', '15'), chat('A', '15 취소'), sms('s1', 16, '20:00'), merge('A', 'sms:s1'), { type: 'host.approveCancel', b: 'b1', no: 15, buyer: 'sms:s1' }])
    expect(claimOf(state, 'A')?.status).toBe('CANCELLED')
  })
})

describe('AC-S03b-22 충돌 중인 상품에는 직접 배정이 없다', () => {
  // A 확정·잠금, B 대기, s1(05) 수신이 앞서 충돌, C 기록
  const conflicted = play(
    [
      register(15, { at: kst(20) }),
      chat('A', '15', { at: kst(20, 0, 10) }),
      { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A', at: kst(20, 0, 11) } as EventInput,
      chat('B', '15', { at: kst(20, 0, 12) }),
      chat('C', '안녕', { at: kst(20, 0, 13) }),
      sms('s1', 15, '20:00:05', { at: kst(20, 0, 20) }),
    ],
    RECEIVED_TIME,
  ).state

  it.each([
    ['교체 WAITLIST', assign('C', { replace: 'A', replaceTo: 'WAITLIST' })],
    ['교체 CANCEL', assign('C', { replace: 'A', replaceTo: 'CANCEL' })],
    ['교체 없음', assign('C')],
    ['대기 중인 구매자에게', assign('B', { replace: 'A', replaceTo: 'CANCEL' })],
    ['충돌 찜의 구매자에게', assign('sms:s1', { replace: 'A', replaceTo: 'WAITLIST' })],
  ] as const)('%s → 1등·대기·충돌·효과 그대로 (같은 상태 객체)', (_name, event) => {
    expect(product(conflicted)).toMatchObject({ winners: ['A'], waitlist: ['B'], conflict: true })
    const result = apply(conflicted, event as unknown as Record<string, unknown>)
    expect(result.state).toBe(conflicted)
    expect(result.effects).toEqual([])
  })

  it('충돌을 정한 뒤(KEEP)에는 S02 규칙대로 교체 배정된다', () => {
    const kept = apply(conflicted, { type: 'host.resolveConflict', b: 'b1', no: 15, decision: 'KEEP' }).state
    const assigned = apply(kept, assign('C', { replace: 'A', replaceTo: 'WAITLIST' }) as unknown as Record<string, unknown>, 100).state
    expect(product(assigned)).toMatchObject({ winners: ['C'], waitlist: ['A', 'sms:s1', 'B'], conflict: false })
  })
})

describe('AC-S03b-23 host.assign의 replace·replaceTo 한쪽만은 입력 오류', () => {
  it('checkEvent가 빠진 쪽을 짚고 applyEvent는 상태를 바꾸지 않고 던진다', () => {
    const { state } = play([register(15), chat('A', '15'), chat('B', '안녕')])
    const before = JSON.stringify(state)
    for (const [fields, missing] of [
      [{ replace: 'A' }, 'replaceTo'],
      [{ replaceTo: 'WAITLIST' }, 'replace'],
      [{ replaceTo: 'CANCEL', replace: undefined }, 'replace'],
    ] as const) {
      const event = { seq: 9, at: T0 + 9000, ...assign('B', fields) }
      expect(checkEvent(state, event).map((p) => p.field)).toEqual([missing])
      expect(() => applyEvent(state, event as unknown as EngineEvent)).toThrow(InvalidEventError)
    }
    expect(JSON.stringify(state)).toBe(before)
  })
})

// ── D. 확정버전·대기 넘침 ────────────────────────────────────────────────

describe('AC-S03b-30 재고 늘림의 확정버전은 대기 순번 순서', () => {
  it('충돌이 먼저 풀린 찜까지 대기 순번 순서로 확정하고 확정버전도 그 순서다', () => {
    // A(10) 잠금, B(20)·C(30) 대기, s1(05) 충돌 → 재고 1→3: s1을 대기 자리 [s1, B, C]에 넣고 s1(2)·B(3) 확정
    const { state, emitted } = play(
      [
        register(15, { at: kst(20) }),
        chat('A', '15', { at: kst(20, 0, 10) }),
        { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A', at: kst(20, 0, 11) } as EventInput,
        chat('B', '15', { at: kst(20, 0, 20) }),
        chat('C', '15', { at: kst(20, 0, 30) }),
        sms('s1', 15, '20:00:05', { at: kst(20, 0, 40) }),
        { type: 'product.update', b: 'b1', no: 15, stock: 3, at: kst(20, 0, 50) },
      ],
      RECEIVED_TIME,
    )
    expect(product(state)).toMatchObject({ winners: ['A', 'sms:s1', 'B'], waitlist: ['C'], conflict: false, confirmVersion: 3 })
    expect((emitted.at(-1) ?? []).map((e) => [e.buyer, e.confirmVersion])).toEqual([
      ['sms:s1', 2],
      ['sms:s1', 2],
      ['B', 3],
      ['B', 3],
    ])
    expect(claimOf(state, 'sms:s1')?.confirmVersion).toBe(2)
    expect(claimOf(state, 'B')?.confirmVersion).toBe(3)
  })
})

describe('AC-S03b-31 충돌이 자리가 비어 풀릴 때 넘침 정리는 승계·재고 규칙 뒤', () => {
  /** A(10) 확정·잠금, B(20)·C(30) 대기(한도 2, 꽉 참), s1(05) 충돌 */
  const full = (settings: Record<string, unknown>, extra: EventInput[]) =>
    play(
      [
        register(15, { at: kst(20) }),
        chat('A', '15', { at: kst(20, 0, 10) }),
        { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A', at: kst(20, 0, 11) } as EventInput,
        chat('B', '15', { at: kst(20, 0, 20) }),
        chat('C', '15', { at: kst(20, 0, 30) }),
        sms('s1', 15, '20:00:05', { at: kst(20, 0, 40) }),
        ...extra,
      ],
      { ...RECEIVED_TIME, 'waitlist.max': 2, ...settings },
    )
  const soldOut = (state: EngineState) => listClaims(state).filter((c) => c.reason === 'SOLD_OUT').map((c) => c.buyer)

  it.each([
    ['무효', [host('host.reject', 15, 'A')]],
    ['취소 승인 (잠금 후라 시청자 자동 취소가 요청이 된 뒤)', [chat('A', '15 취소', { at: kst(20, 0, 50) }), { type: 'host.approveCancel', b: 'b1', no: 15, buyer: 'A' } as EventInput]],
    ['재고 늘림 +1', [{ type: 'product.update', b: 'b1', no: 15, stock: 2 } as EventInput]],
  ] as const)('AUTO·%s: 아무도 품절되지 않는다 — s1이 대기 1순위로 들어가 1등이 되고 대기 [B, C]', (_name, extra) => {
    const { state } = full({ 'cancel.buyerChat': 'AUTO' }, [...extra])
    expect(product(state)).toMatchObject({ waitlist: ['B', 'C'], conflict: false })
    expect(product(state)?.winners).toContain('sms:s1')
    expect(soldOut(state)).toEqual([])
  })

  it('재고 늘림 +2: s1·B가 확정되고 대기 [C]', () => {
    const { state } = full({}, [{ type: 'product.update', b: 'b1', no: 15, stock: 3 } as EventInput])
    expect(product(state)).toMatchObject({ winners: ['A', 'sms:s1', 'B'], waitlist: ['C'] })
    expect(soldOut(state)).toEqual([])
  })

  it('ASK: 빈 자리는 승계 결정 필요로 남고, 한도를 넘는 맨 끝(C)이 품절된다', () => {
    const { state } = full({ 'cancel.succession': 'ASK' }, [host('host.cancel', 15, 'A')])
    expect(product(state)).toMatchObject({ winners: [], waitlist: ['sms:s1', 'B'], awaitingSuccession: true, conflict: false })
    expect(soldOut(state)).toEqual(['C'])
  })

  it('REOPEN: 충돌 찜도 대기자와 함께 WAITLIST_CLEARED, 품절 없음', () => {
    const { state } = full({ 'cancel.succession': 'REOPEN' }, [host('host.cancel', 15, 'A')])
    expect(product(state)).toMatchObject({ winners: [], waitlist: [], conflict: false, status: 'OPEN' })
    expect(listClaims(state).filter((c) => c.reason === 'WAITLIST_CLEARED').map((c) => c.buyer)).toEqual(['B', 'C', 'sms:s1'])
    expect(soldOut(state)).toEqual([])
  })

  it('대기 한도 0: 1등 취소·재고 늘림 모두 충돌 찜이 품절되지 않고 1등이 된다', () => {
    const zero = (extra: EventInput) =>
      play(
        [
          register(15, { at: kst(20) }),
          chat('A', '15', { at: kst(20, 0, 10) }),
          { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A', at: kst(20, 0, 11) } as EventInput,
          sms('s1', 15, '20:00:05', { at: kst(20, 0, 20) }),
          extra,
        ],
        { ...RECEIVED_TIME, 'waitlist.max': 0 },
      ).state
    expect(product(zero(host('host.cancel', 15, 'A')))).toMatchObject({ winners: ['sms:s1'], waitlist: [], conflict: false })
    expect(product(zero({ type: 'product.update', b: 'b1', no: 15, stock: 2 } as EventInput))).toMatchObject({ winners: ['A', 'sms:s1'], waitlist: [] })
  })

  it('KEEP·새 찜의 넘침 정리는 S03 그대로 — KEEP은 넣자마자 맨 끝을 품절시킨다', () => {
    const { state } = full({}, [{ type: 'host.resolveConflict', b: 'b1', no: 15, decision: 'KEEP' } as EventInput])
    expect(product(state)).toMatchObject({ winners: ['A'], waitlist: ['sms:s1', 'B'] })
    expect(soldOut(state)).toEqual(['C'])
  })
})
