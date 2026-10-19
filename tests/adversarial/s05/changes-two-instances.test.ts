// S05 적대 테스트 (test-domain): 증분 조회 "덮으면 같다"(AC-S05-61)를 개발자 시험이 보지 않은 조건에서 공격한다.
// - 두 인스턴스가 번갈아 쓰고, 조회도 번갈아 한다(따라잡기로 만든 기준점)
// - 엔진이 예상하지 못한 오류(실패 표시 이벤트 — 확인 필요 항목)가 섞인다
// - 같은 날 방송 둘(둘째 방송·끝내기), 시계가 흘러 보류 찜이 만료된다
// - 중간에 재시작한 인스턴스(스냅샷 뒤 기준점)
import { applyEvent, type EngineEvent, type EngineState } from '@livejjim/core'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { call, event, harness, startBroadcast, type Harness } from '../s04/helpers.ts'
import type { LivejjimServer } from '@livejjim/server'

const DAY = '2026-10-18'
const LISTS = ['broadcasts', 'products', 'claims', 'pending', 'buyers', 'settlements', 'effects', 'cancelRequests'] as const
type ListName = (typeof LISTS)[number]
type Item = Record<string, unknown>
type View = Record<string, unknown>

function keyOf(name: ListName, item: Item): string {
  switch (name) {
    case 'products':
      return String(item.key)
    case 'pending':
      return String(item.product)
    case 'settlements':
      return JSON.stringify([item.buyer, item.date])
    case 'cancelRequests':
      return String(item.claim)
    default:
      return String(item.id)
  }
}

function maps(full: View): Record<string, Map<string, string>> {
  const out: Record<string, Map<string, string>> = {}
  for (const name of LISTS) out[name] = new Map((full[name] as Item[]).map((item) => [keyOf(name, item), JSON.stringify(item)]))
  out.attention = new Map((full.attention as Item[]).map((item) => [String(item.seq), JSON.stringify(item)]))
  return out
}

function overlay(full: View, changes: View): Record<string, Map<string, string>> {
  const out = maps(full)
  const removed = changes.removed as Record<ListName, unknown[]>
  for (const name of LISTS) {
    const map = out[name] as Map<string, string>
    for (const key of removed[name]) {
      map.delete(name === 'settlements' ? JSON.stringify([(key as Item).buyer, (key as Item).date]) : String(key))
    }
    for (const item of changes[name] as Item[]) map.set(keyOf(name, item), JSON.stringify(item))
  }
  for (const item of changes.attention as Item[]) out.attention?.set(String(item.seq), JSON.stringify(item))
  return out
}

const sorted = (map: Map<string, string> | undefined) => [...(map ?? new Map<string, string>()).entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

/** 실패를 주입하는 엔진: 본문이 '터짐'인 채팅에서 예상하지 못한 오류 */
const boomEngine = {
  applyEvent(state: EngineState, e: EngineEvent) {
    if ((e as { type: string; text?: string }).type === 'chat' && (e as { text?: string }).text === '터짐') throw new Error('주입한 엔진 오류')
    return applyEvent(state, e)
  },
}

type Step =
  | { kind: 'register'; b: 0 | 1; no: number }
  | { kind: 'chat'; b: 0 | 1; ch: string; text: string }
  | { kind: 'host'; b: 0 | 1; type: string; no: number; ch: string }
  | { kind: 'product'; b: 0 | 1; type: string; no: number }
  | { kind: 'renumber'; b: 0 | 1; from: number; to: number }
  | { kind: 'block'; ch: string; on: boolean }
  | { kind: 'merge'; from: string; into: string }
  | { kind: 'convert'; b: 0 | 1; message: number; no: number }
  | { kind: 'second' }
  | { kind: 'end'; b: 0 | 1 }
  | { kind: 'tick'; ms: number }
  | { kind: 'restart' }

const bi = fc.constantFrom(0 as const, 1 as const)
const no = fc.integer({ min: 1, max: 5 })
const ch = fc.constantFrom('UCa', 'UCb', 'UCc')
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('register' as const), b: bi, no }) },
  { weight: 7, arbitrary: fc.record({ kind: fc.constant('chat' as const), b: bi, ch, text: fc.oneof(no.map(String), no.map((n) => `${String(n)} 취소`), no.map((n) => `${String(n)}번 예뻐요`), fc.constant('터짐')) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('host' as const), b: bi, type: fc.constantFrom('host.cancel', 'host.reject', 'host.promote', 'host.confirm', 'host.approveCancel', 'host.dismissCancel'), no, ch }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('product' as const), b: bi, type: fc.constantFrom('product.open', 'product.hold', 'product.close'), no }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('renumber' as const), b: bi, from: no, to: fc.integer({ min: 1, max: 7 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('block' as const), ch, on: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('merge' as const), from: ch, into: ch }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('convert' as const), b: bi, message: fc.nat(40), no }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'second' as const }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('end' as const), b: bi }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('tick' as const), ms: fc.constantFrom(1000, 61_000, 200_000) }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'restart' as const }) },
)

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

describe('AC-S05-61 덮으면 같다 — 두 인스턴스·실패 표시·방송 둘·만료·재시작', () => {
  it('어느 인스턴스에서 언제 받았든 전체(a) + 증분(a → 지금) = 전체(지금)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 10, maxLength: 35 }), async (steps) => {
        await h?.close()
        h = await harness({ engine: boomEngine, snapshotEvery: 7 })
        const a = await h.account(`ci${String(Math.random()).slice(2, 10)}`)
        const servers: LivejjimServer[] = [h.server, h.restart()]
        const bs: string[] = [await startBroadcast(h.server, a.cookie, DAY, '1부')]
        const chats: { b: string; id: string }[] = []
        const fulls: View[] = []
        const take = async (s: LivejjimServer) => {
          const res = await call(s, a.cookie, 'GET', `/api/days/${DAY}`)
          expect(res.status).toBe(200)
          fulls.push(res.body)
        }
        await take(servers[0] as LivejjimServer)
        let i = 0
        for (const step of steps) {
          const s = servers[i++ % 2] as LivejjimServer
          const b = bs[('b' in step ? step.b : 0) % bs.length] as string
          switch (step.kind) {
            case 'register':
              await event(s, a.cookie, { type: 'product.register', b, no: step.no, name: '구피', price: 1000 })
              break
            case 'chat': {
              const id = `m${String(chats.length)}`
              chats.push({ b, id })
              await s.ingestChat(a.sellerId, { b, id, ch: step.ch, nick: step.ch, text: step.text })
              break
            }
            case 'host':
              await event(s, a.cookie, { type: step.type, b, no: step.no, buyer: step.ch, reason: '사유' })
              break
            case 'product':
              await event(s, a.cookie, { type: step.type, b, no: step.no })
              break
            case 'renumber':
              await event(s, a.cookie, { type: 'product.renumber', b, from: step.from, to: step.to })
              break
            case 'block':
              await event(s, a.cookie, { type: step.on ? 'host.blockBuyer' : 'host.unblockBuyer', buyer: step.ch, reason: '사유' }, DAY)
              break
            case 'merge':
              await event(s, a.cookie, { type: 'buyer.merge', from: step.from, into: step.into, reason: '같은 사람' }, DAY)
              break
            case 'convert': {
              const target = chats.filter((c) => c.b === b)
              if (target.length > 0) await event(s, a.cookie, { type: 'host.convertMessage', b, msg: (target[step.message % target.length] as { id: string }).id, no: step.no })
              break
            }
            case 'second':
              if (bs.length < 2) bs.push(await startBroadcast(s, a.cookie, DAY, '2부'))
              break
            case 'end':
              await call(s, a.cookie, 'POST', `/api/broadcasts/${b}/end`, { requestId: `end${String(i)}${b}` })
              break
            case 'tick':
              h.clock.t += step.ms
              break
            case 'restart':
              servers[i % 2] = h.restart({ engine: boomEngine, snapshotEvery: 7 })
              break
          }
          await take(servers[(i + 1) % 2] as LivejjimServer)
        }
        // 모든 기준점에서, 두 인스턴스 모두
        for (const s of servers) {
          const now = (await call(s, a.cookie, 'GET', `/api/days/${DAY}`)).body
          for (const before of fulls) {
            const res = await call(s, a.cookie, 'GET', `/api/days/${DAY}/changes?since=${String(before.seq)}`)
            if (res.status === 410) continue // 재시작한 인스턴스의 스냅샷보다 앞선 since
            expect(res.status, res.text).toBe(200)
            expect(res.body.seq).toBe(now.seq)
            const merged = overlay(before, res.body)
            const target = maps(now)
            for (const name of [...LISTS, 'attention']) expect(sorted(merged[name]), `${name} since=${String(before.seq)}`).toEqual(sorted(target[name]))
          }
        }
      }),
      { numRuns: 12, seed: 5051 },
    )
  }, 600_000)
})
