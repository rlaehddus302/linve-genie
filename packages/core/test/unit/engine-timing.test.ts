// 처리 비용 (AC-S03-05, AC-S02-05 대체 — NFR-01 판정 300ms, NFR-04 방송 1회 채팅 1만 건·상품 500개).
// - 상태가 커져도 이벤트당 비용이 늘지 않는다: 크기 4배에서 전체 시간이 8배를 넘지 않는다(이벤트당 일정이면 4배, 통째 복사면 16배).
// - 처리 시간: 상품 500·채팅 10,000·조치 100에 S03 이벤트를 섞은 로그를 접수순·실제 시각순으로 한 번씩.
//   전체 5초 안, 이벤트 하나는 처음 1,000건(준비 구간)을 뺀 p99가 20ms 이하, 최댓값은 NFR-01 예산 300ms 미만.
// 시간 비율은 같은 크기를 몇 번 돌린 가장 짧은 시간으로 잰다(쓰레기 수집·다른 작업이 끼어든 한 번에 흔들리지 않게).
import { applyEvent, checkInvariants, initEngine, listClaims, listProducts, type EngineEvent, type EngineState, type SettingsOverride } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { smsPhoneFields } from '../golden/phone-key.ts'
import { B1, T0 } from './engine-helpers.ts'

/** 결정적인 의사 난수 (테스트 데이터용 선형 합동 생성기) */
function lcg(seed: number): () => number {
  let x = seed >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

function fastest(runs: number, task: () => void): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    task()
    best = Math.min(best, performance.now() - started)
  }
  return best
}

const at = (i: number): number => T0 + i
const event = (fields: Record<string, unknown>): EngineEvent => fields as unknown as EngineEvent

/** 아직 없는 번호 하나에 서로 다른 구매자의 보류 찜을 하나씩 N개 */
function pendingPile(n: number): EngineState {
  let state = initEngine({ broadcasts: [B1], settings: {} })
  for (let i = 0; i < n; i++) state = applyEvent(state, event({ seq: i + 1, at: at(i), type: 'sms', b: 'b1', ref: `s${String(i)}`, no: 7, received: '20:00' })).state
  return state
}

/** 미리 등록한 상품 N개를 한 구매자가 하나씩 확정받는다 (등록은 시간 밖) */
function oneBuyer(n: number): { readonly prepared: EngineState; readonly run: () => EngineState } {
  let prepared = initEngine({ broadcasts: [B1], settings: {} })
  for (let no = 1; no <= n; no++) prepared = applyEvent(prepared, event({ seq: no, at: T0, type: 'product.register', b: 'b1', no, name: '품종', price: 1000 })).state
  return {
    prepared,
    run: () => {
      let state = prepared
      for (let no = 1; no <= n; no++) state = applyEvent(state, event({ seq: n + no, at: at(no), type: 'chat', b: 'b1', id: `m${String(no)}`, ch: 'UC_A', nick: '홍길동', text: String(no) })).state
      return state
    },
  }
}

describe('AC-S03-05 상태가 커져도 이벤트당 비용이 늘지 않는다', () => {
  it('보류 찜: N = 20,000의 전체 시간이 N = 5,000의 8배를 넘지 않는다', () => {
    pendingPile(2000)
    const small = fastest(3, () => pendingPile(5000))
    const large = fastest(3, () => pendingPile(20_000))
    expect(large / small, `5,000 → ${small.toFixed(0)}ms, 20,000 → ${large.toFixed(0)}ms`).toBeLessThan(8)
    expect(pendingPile(20).slots.size).toBe(1)
  })

  it('한 구매자의 찜: N = 8,000의 전체 시간이 N = 2,000의 8배를 넘지 않는다', () => {
    const small = oneBuyer(2000)
    const large = oneBuyer(8000)
    small.run()
    const smallTime = fastest(3, () => small.run())
    const largeTime = fastest(3, () => large.run())
    expect(largeTime / smallTime, `2,000 → ${smallTime.toFixed(0)}ms, 8,000 → ${largeTime.toFixed(0)}ms`).toBeLessThan(8)
    expect(listClaims(large.run()).every((claim) => claim.status === 'CONFIRMED' && claim.buyer === 'UC_A')).toBe(true)
  })

  it('checkInvariants: 상태 크기 4배에서 시간이 8배를 넘지 않는다 (판매 로그 상태, 한 번호에 보류 찜이 몰린 상태)', () => {
    const mixed = (scale: number): EngineState => {
      let state = initEngine({ broadcasts: [B1], settings: {} })
      for (const e of buildLog(scale)) state = applyEvent(state, e).state
      return state
    }
    for (const [name, small, large] of [
      ['판매 로그', mixed(1), mixed(4)],
      ['보류 찜', pendingPile(2500), pendingPile(10_000)],
    ] as const) {
      expect(checkInvariants(large), name).toEqual([])
      // 한 번은 1ms 안팎이라 기계 부하에 따라 비율이 크게 흔들린다(병렬 트랙 중 0.9ms → 8.2ms). 작은 상태 한 번 측정이
      // 30ms 이상이 되도록 같은 횟수를 반복해 재고 비율을 본다 — 기준(4배 크기에서 8배 이하, 통째 복사면 16배)은 그대로다 (D-098).
      const once = fastest(3, () => checkInvariants(small))
      const reps = Math.max(1, Math.ceil(30 / Math.max(once, 0.01)))
      const repeated = (state: EngineState) => () => {
        for (let i = 0; i < reps; i++) checkInvariants(state)
      }
      const smallTime = fastest(5, repeated(small))
      const largeTime = fastest(5, repeated(large))
      expect(largeTime / smallTime, `${name}: ${smallTime.toFixed(1)}ms → ${largeTime.toFixed(1)}ms (${String(reps)}회 반복)`).toBeLessThan(8)
    }
  })
})

/**
 * AC-S02-05의 로그(상품 500·채팅 10,000·조치 100)에 S03 이벤트(문자찜 2,000, 상품 수정 50, 번호 변경 10, 합치기·떼어 내기 20, 정산 기록 100)를 섞는다.
 * scale은 상품·채팅·문자찜·조치 수를 함께 늘린다(불변식 검사의 크기 비교용).
 */
function buildLog(scale = 1): EngineEvent[] {
  const rand = lcg(20261019)
  const pick = (n: number): number => Math.floor(rand() * n)
  const events: EngineEvent[] = []
  let seq = 0
  let time = T0
  const push = (fields: Record<string, unknown>): void => {
    time += 1 + pick(400)
    events.push(event({ ...fields, seq: ++seq, at: time }))
  }
  const products = 500 * scale
  const chats = 10_000 * scale
  const buyers = 2000 * scale
  for (let no = 1; no <= products; no++) push({ type: 'product.register', b: 'b1', no, name: `품종${String(no)}`, price: 1000 * (1 + pick(50)), stock: pick(10) === 0 ? 2 : 1 })
  const sent: { id: string; ch: string; text: string }[] = []
  const kinds = ['host.cancel', 'host.reject', 'host.promote', 'host.confirm', 'host.assign', 'host.blockBuyer', 'product.hold', 'product.open', 'host.reopen', 'host.approveCancel'] as const
  let hosts = 0
  let refs = 0
  let renumbered = 0
  const no = (): number => 1 + pick(products + 20)
  const channel = (): string => `UC_${String(pick(buyers))}`
  for (let i = 0; i < chats; i++) {
    const ch = channel()
    const roll = rand()
    let text: string
    if (roll < 0.27) text = String(no())
    else if (roll < 0.3) text = `${String(no())} ${String(no())}`
    else if (roll < 0.35) text = `${String(no())} 취소`
    else if (roll < 0.55) text = `${String(no())}번 너무 예뻐요`
    else text = '안녕하세요 오늘도 잘 볼게요'
    if (roll > 0.95 && sent.length > 0) {
      const again = sent[pick(sent.length)] as { id: string; ch: string; text: string }
      push({ type: 'chat', b: 'b1', id: again.id, ch: again.ch, nick: '닉', text: again.text })
    } else {
      const id = `m${String(i)}`
      sent.push({ id, ch, text })
      push({ type: 'chat', b: 'b1', id, ch, nick: `닉${ch}`, text, publishedAt: time - pick(3000) })
    }
    // 문자찜 2,000 (5채팅마다 하나): 휴대폰 번호·메모·지정 구매자 섞기, 수신 시각은 분·초
    if (i % 5 === 2) {
      const r = refs++
      const seconds = pick(2) === 0
      const kst = new Date(time - pick(120_000) + 9 * 3_600_000)
      const hh = String(kst.getUTCHours()).padStart(2, '0')
      const mm = String(kst.getUTCMinutes()).padStart(2, '0')
      const ss = String(kst.getUTCSeconds()).padStart(2, '0')
      const roll2 = pick(4)
      push({
        type: 'sms',
        b: 'b1',
        ref: `s${String(r)}`,
        no: no(),
        received: seconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`,
        // 전화번호는 서버처럼 키로 바꿔 넣는다 (D-061 — 로그를 만들 때 바꾸므로 잰 시간에 HMAC은 들어가지 않는다)
        ...(roll2 === 0 ? smsPhoneFields(`010-${String(1000 + pick(300 * scale))}-0000`) : {}),
        ...(roll2 === 1 ? { memo: '이모' } : {}),
        ...(roll2 === 2 && sent.length > 0 ? { buyer: (sent[pick(sent.length)] as { ch: string }).ch } : {}),
      })
    }
    if (i % 100 === 50) {
      const type = kinds[hosts++ % kinds.length] as (typeof kinds)[number]
      if (type === 'host.blockBuyer') push({ type, buyer: channel(), reason: '장난' })
      else if (type === 'product.hold' || type === 'product.open') push({ type, b: 'b1', no: no() })
      // host.reopen에는 구매자 필드가 없다 — 표에 없는 필드는 S04부터 입력 오류다 (D-073)
      else if (type === 'host.reopen') push({ type, b: 'b1', no: no(), reason: '사유' })
      else push({ type, b: 'b1', no: no(), buyer: channel(), reason: '사유' })
    }
    // 상품 수정 50, 정산 기록 100, 합치기·떼어 내기 20, 번호 변경 10 (스케일만큼)
    if (i % 200 === 80) push({ type: 'product.update', b: 'b1', no: no(), price: 1000 * (1 + pick(50)), ...(pick(2) === 0 ? { stock: 1 + pick(3), applyTo: 'UNPAID_CLAIMS' } : {}) })
    if (i % 100 === 30) {
      const kind = ['settlement.payment', 'settlement.adjust', 'settlement.refund', 'settlement.shippingOverride'][pick(4)] as string
      const buyer = channel()
      if (kind === 'settlement.shippingOverride') push({ type: kind, buyer, date: '2026-10-18', mode: 'PICKUP' })
      else push({ type: kind, buyer, date: '2026-10-18', amount: kind === 'settlement.adjust' ? -1000 : 5000, ...(kind === 'settlement.payment' ? {} : { reason: '사유' }) })
    }
    if (i % 1000 === 500) {
      for (let k = 0; k < 2; k++) {
        const from = channel()
        push({ type: 'buyer.merge', from, into: channel(), reason: '같은 사람' })
        if (k === 1) push({ type: 'buyer.unmerge', from, reason: '잘못' })
      }
    }
    if (i % 1000 === 900 && renumbered < 10 * scale) {
      renumbered++
      push({ type: 'product.renumber', b: 'b1', from: no(), to: products + 100 + renumbered })
    }
  }
  return events
}

describe('AC-S03-05 처리 시간 (AC-S02-05 대체)', () => {
  const log = buildLog()

  it('로그 구성: 상품 500·채팅 10,000·조치 100 + 문자찜 2,000·상품 수정 50·번호 변경 10·합치기·떼어 내기 20·정산 기록 100', () => {
    const count = (predicate: (e: EngineEvent) => boolean): number => log.filter(predicate).length
    expect(count((e) => e.type === 'product.register')).toBe(500)
    expect(count((e) => e.type === 'chat')).toBe(10_000)
    expect(count((e) => e.type.startsWith('host.') || e.type === 'product.hold' || e.type === 'product.open')).toBe(100)
    expect(count((e) => e.type === 'sms')).toBe(2000)
    expect(count((e) => e.type === 'product.update')).toBe(50)
    expect(count((e) => e.type === 'product.renumber')).toBe(10)
    expect(count((e) => e.type.startsWith('buyer.'))).toBe(30)
    expect(count((e) => e.type.startsWith('settlement.'))).toBe(100)
  })

  it.each([
    ['접수순', {}],
    ['실제 시각순(HOST)', { 'contention.policy': 'RECEIVED_TIME' }],
    ['실제 시각순(SMS)', { 'contention.policy': 'RECEIVED_TIME', 'contention.sameMinuteTieBreaker': 'SMS' }],
  ] as const)('%s: 전체 5초 안, 준비 구간을 뺀 p99 ≤ 20ms, 최댓값 < 300ms', (_name, settings: SettingsOverride) => {
    let state: EngineState = initEngine({ broadcasts: [B1], settings })
    const durations: number[] = []
    const started = performance.now()
    for (const e of log) {
      const t = performance.now()
      state = applyEvent(state, e).state
      durations.push(performance.now() - t)
    }
    const total = performance.now() - started
    const measured = durations.slice(1000).sort((a, b) => a - b)
    const p99 = measured[Math.floor(measured.length * 0.99)] as number
    const max = Math.max(...durations)
    expect(total, `전체 ${total.toFixed(0)}ms`).toBeLessThan(5000)
    expect(p99, `p99 ${p99.toFixed(2)}ms`).toBeLessThanOrEqual(20)
    expect(max, `최댓값 ${max.toFixed(1)}ms`).toBeLessThan(300)
    // 실제로 판정이 일어난 로그인지
    expect(listClaims(state).length).toBeGreaterThan(3500)
    expect(listProducts(state).filter((p) => p.status === 'SOLD').length).toBeGreaterThan(350)
    expect(checkInvariants(state)).toEqual([])
  })

  it('이벤트 하나는 바뀐 경로만 새로 만든다 — 큰 모음(메시지·찜·구매자)의 나머지 마디는 이전 상태와 공유', () => {
    let state: EngineState = initEngine({ broadcasts: [B1], settings: {} })
    for (const e of log.slice(0, 8000)) state = applyEvent(state, e).state
    const next = applyEvent(state, { seq: 99_999, at: T0 + 99_999_999, type: 'chat', b: 'b1', id: 'fresh', ch: 'UC_NEW', nick: '새', text: '7' }).state
    for (const key of ['messages', 'claims', 'buyers', 'slots', 'effects'] as const) {
      const before = Object.keys(state[key].root)
      const shared = before.filter((branch) => next[key].root[branch] === state[key].root[branch]).length
      // 32칸 중 바뀐 것은 많아야 몇 칸 (한 이벤트가 건드린 키 수만큼)
      expect(before.length - shared, key).toBeLessThanOrEqual(3)
    }
  })
})
