// AC-S02-05 처리 시간 (NFR-01 판정 300ms, NFR-04 방송 1회 채팅 1만 건·상품 500개).
// 상품 500개, 채팅 10,000건(주문 약 30%, 나머지는 언급·잡담·재수신·취소), 방송자 조치 100건을 처음부터 차례로 적용한다.
// 전체 5초 안, 이벤트 하나 50ms 이하. 상태가 커져도 이벤트마다 전체를 복사하지 않는지는 구조 공유로도 확인한다.
import { applyEvent, initEngine, listClaims, listProducts, type EngineEvent, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { B1, T0 } from './engine-helpers.ts'

/** 결정적인 의사 난수 (테스트 데이터용 선형 합동 생성기) */
function lcg(seed: number): () => number {
  let x = seed >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

function buildLog(): EngineEvent[] {
  const rand = lcg(20261019)
  const pick = (n: number): number => Math.floor(rand() * n)
  const events: EngineEvent[] = []
  let seq = 0
  let at = T0
  const push = (event: Record<string, unknown>): void => {
    at += 1 + pick(400)
    events.push({ ...event, seq: ++seq, at } as unknown as EngineEvent)
  }
  for (let no = 1; no <= 500; no++) push({ type: 'product.register', b: 'b1', no, name: `품종${String(no)}`, price: 1000 * (1 + pick(50)), stock: pick(10) === 0 ? 2 : 1 })
  const sent: { id: string; ch: string; text: string }[] = []
  let hosts = 0
  for (let i = 0; i < 10_000; i++) {
    const ch = `UC_${String(pick(2000))}`
    const roll = rand()
    let text: string
    if (roll < 0.27) text = String(1 + pick(500))
    else if (roll < 0.3) text = `${String(1 + pick(500))} ${String(1 + pick(500))}`
    else if (roll < 0.35) text = `${String(1 + pick(500))} 취소`
    else if (roll < 0.55) text = `${String(1 + pick(500))}번 너무 예뻐요`
    else text = '안녕하세요 오늘도 잘 볼게요'
    if (roll > 0.95 && sent.length > 0) {
      const again = sent[pick(sent.length)] as { id: string; ch: string; text: string }
      push({ type: 'chat', b: 'b1', id: again.id, ch: again.ch, nick: '닉', text: again.text })
    } else {
      const id = `m${String(i)}`
      sent.push({ id, ch, text })
      push({ type: 'chat', b: 'b1', id, ch, nick: `닉${ch}`, text })
    }
    if (i % 100 === 50) {
      const no = 1 + pick(500)
      const buyer = `UC_${String(pick(2000))}`
      const kinds = ['host.cancel', 'host.reject', 'host.promote', 'host.confirm', 'host.assign', 'host.blockBuyer', 'product.hold', 'product.open', 'host.reopen', 'host.approveCancel'] as const
      const type = kinds[hosts++ % kinds.length] as (typeof kinds)[number]
      if (type === 'host.blockBuyer') push({ type, buyer, reason: '장난' })
      else if (type === 'product.hold' || type === 'product.open') push({ type, b: 'b1', no })
      else push({ type, b: 'b1', no, buyer, reason: '사유' })
    }
  }
  return events
}

describe('AC-S02-05 처리 시간', () => {
  it('상품 500 · 채팅 10,000 · 방송자 조치 100: 전체 5초 안, 이벤트 하나 50ms 이하', () => {
    const log = buildLog()
    expect(log.filter((e) => e.type === 'chat')).toHaveLength(10_000)
    expect(log.filter((e) => e.type.startsWith('host.') || e.type === 'product.hold' || e.type === 'product.open')).toHaveLength(100)
    let state: EngineState = initEngine({ broadcasts: [B1], settings: {} })
    let slowest = 0
    const started = performance.now()
    for (const event of log) {
      const t = performance.now()
      state = applyEvent(state, event).state
      slowest = Math.max(slowest, performance.now() - t)
    }
    const total = performance.now() - started
    expect(total, `전체 ${total.toFixed(0)}ms`).toBeLessThan(5000)
    expect(slowest, `가장 느린 이벤트 ${slowest.toFixed(1)}ms`).toBeLessThan(50)
    // 실제로 판정이 일어난 로그인지 (주문 약 30%)
    expect(listClaims(state).length).toBeGreaterThan(2500)
    expect(listProducts(state).filter((p) => p.status === 'SOLD').length).toBeGreaterThan(400)
  })

  it('이벤트 하나는 바뀐 경로만 새로 만든다 — 큰 모음(메시지·찜·구매자)의 나머지 마디는 이전 상태와 공유', () => {
    const log = buildLog()
    let state: EngineState = initEngine({ broadcasts: [B1], settings: {} })
    for (const event of log.slice(0, 8000)) state = applyEvent(state, event).state
    const next = applyEvent(state, { seq: 99_999, at: T0 + 99_999_999, type: 'chat', b: 'b1', id: 'fresh', ch: 'UC_NEW', nick: '새', text: '7' }).state
    for (const key of ['messages', 'claims', 'buyers', 'slots', 'effects'] as const) {
      const before = Object.keys(state[key].root)
      const shared = before.filter((branch) => next[key].root[branch] === state[key].root[branch]).length
      // 32칸 중 바뀐 것은 많아야 몇 칸 (한 이벤트가 건드린 키 수만큼)
      expect(before.length - shared, key).toBeLessThanOrEqual(3)
    }
  })
})
