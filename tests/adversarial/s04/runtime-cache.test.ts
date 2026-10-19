// S04 적대 테스트 (test-domain): 범위 상태 메모리 상한(RA-S04-002 수정)으로 생긴 구멍 찾기.
// - 상한 1·스냅샷 간격 2인 인스턴스 둘이 세 날짜에 섞어 쓰고(방송 만들기·상품·채팅·차단·입금·엔진 예외 주입) 그사이 계속 버리고 다시 불러와도
//   두 인스턴스·재시작 인스턴스(상한 기본)의 날짜별 조회가 같고 재생 검사가 일치한다(AC-S04-24·28·29, INV-4).
// - 이전 날짜 범위가 버려진 상태에서 새 날짜 방송을 만들어도 차단을 이어받는다(AC-S04-27).
import type { EngineEvent, EngineState } from '@livejjim/core'
import { applyEvent } from '@livejjim/core'
import { checkReplay } from '@livejjim/server'
import { afterEach, describe, expect, it } from 'vitest'
import { call, event, harness, startBroadcast, type Harness } from './helpers.ts'

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

/** 결정적 의사 난수 (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 채팅 본문이 'boom'이면 엔진이 예상하지 못한 오류를 낸다 (쓰기·재생 모두 같은 감싸기) */
const engine = {
  applyEvent(state: EngineState, ev: EngineEvent) {
    if ((ev as { type: string; text?: string }).type === 'chat' && (ev as { text?: string }).text === 'boom') throw new Error('주입한 엔진 오류')
    return applyEvent(state, ev)
  },
}

describe('범위 상태 메모리 상한 — 버리고 다시 불러와도 같은 결과 (RA-S04-002, AC-S04-24·28·29)', () => {
  for (const seed of [1, 7, 42]) {
    it(`상한 1 인스턴스 둘이 세 날짜에 섞어 써도 조회·재생 검사가 같다 (seed ${String(seed)})`, async () => {
      h = await harness({ runtimeCacheMax: 1, snapshotEvery: 2, engine })
      const a = await h.account('shopa')
      const s1 = h.server
      const s2 = h.restart({ runtimeCacheMax: 1, snapshotEvery: 2, engine })
      const random = rng(seed)
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)] as T
      const dates = ['2026-10-16', '2026-10-17', '2026-10-18']
      const broadcasts = new Map<string, string[]>()
      const products = new Map<string, number>()
      for (const date of dates) {
        const b = await startBroadcast(pick([s1, s2]), a.cookie, date)
        broadcasts.set(date, [b])
        products.set(b, 0)
      }
      let chat = 0
      for (let step = 0; step < 60; step++) {
        const s = pick([s1, s2])
        const date = pick(dates)
        const b = pick(broadcasts.get(date) ?? [])
        const roll = random()
        if (roll < 0.08) {
          const nb = await startBroadcast(s, a.cookie, date)
          broadcasts.get(date)?.push(nb)
          products.set(nb, 0)
        } else if (roll < 0.3) {
          const no = (products.get(b) ?? 0) + 1
          products.set(b, no)
          expect((await event(s, a.cookie, { type: 'product.register', b, no, name: `상품${String(no)}`, price: 1000 * no, stock: 1 + Math.floor(random() * 2) })).status).toBe(200)
        } else if (roll < 0.8) {
          const max = products.get(b) ?? 0
          const text = random() < 0.1 ? 'boom' : String(1 + Math.floor(random() * Math.max(max, 1)))
          const res = await s.ingestChat(a.sellerId, { b, id: `m${String(++chat)}`, ch: `UC${String(Math.floor(random() * 6))}`, nick: 'n', text })
          expect(res.status).toBe('recorded')
        } else if (roll < 0.9) {
          const r = await event(s, a.cookie, { type: pick(['host.blockBuyer', 'host.unblockBuyer']), buyer: `UC${String(Math.floor(random() * 6))}`, reason: '사유' }, date)
          expect(r.status).toBe(200)
        } else {
          const r = await event(s, a.cookie, { type: 'settlement.payment', buyer: `UC${String(Math.floor(random() * 6))}`, date, amount: 1000 }, date)
          expect(r.status).toBe(200)
        }
        expect(s.writer.cachedScopes).toBeLessThanOrEqual(1)
      }
      const fresh = h.restart({ engine })
      for (const date of dates) {
        // 순서를 섞어 읽어 매번 버리고 다시 불러오게 한다
        const v1 = await call(s1, a.cookie, 'GET', `/api/days/${date}`)
        const v3 = await call(fresh, a.cookie, 'GET', `/api/days/${date}`)
        const v2 = await call(s2, a.cookie, 'GET', `/api/days/${date}`)
        expect(v1.status).toBe(200)
        expect(v2.text, `${date} 인스턴스 2`).toBe(v1.text)
        expect(v3.text, `${date} 재시작`).toBe(v1.text)
      }
      const checks = await checkReplay(h.database.db)
      expect(checks.map((c) => c.ok)).toEqual(dates.map(() => true))
    }, 120_000)
  }

  it('이전 날짜 범위가 메모리에서 버려진 뒤 새 날짜 방송을 만들어도 차단을 이어받는다 (AC-S04-27)', async () => {
    h = await harness({ runtimeCacheMax: 1 })
    const a = await h.account('shopa')
    const s = h.server
    await startBroadcast(s, a.cookie, '2026-10-17')
    expect((await event(s, a.cookie, { type: 'host.blockBuyer', buyer: 'UCbad', reason: '사유' }, '2026-10-17')).status).toBe(200)
    // 다른 날짜를 써서 10-17 범위를 메모리에서 밀어낸다
    await startBroadcast(s, a.cookie, '2026-10-10')
    expect(s.writer.cachedScopes).toBe(1)
    await startBroadcast(s, a.cookie, '2026-10-18')
    const history = (await call(s, a.cookie, 'GET', '/api/days/2026-10-18/history')).body.events as { type: string; fields: { buyer?: string } }[]
    expect(history.map((e) => [e.type, e.fields.buyer ?? null])).toEqual([
      ['broadcast.start', null],
      ['host.blockBuyer', 'UCbad'],
    ])
  }, 60_000)
})
