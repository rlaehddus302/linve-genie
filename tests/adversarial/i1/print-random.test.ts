// I1 적대 테스트 (test-domain): 무작위 판매 열 + 출력 결과 열 (acceptance L "test-domain" 1~6, AC-I1-02·04·05·06·07·08).
// 판매(채팅 찜·채팅 취소·문자찜·방송자 취소·취소 승인·품종·가격·재고 변경)와 출력 기기 조작(정하기·바꾸기·받기·출력함·실패·늦은 결과·
// 다시 연결·다시 시작·멈추기·라벨 출력·다시 출력·빼기·그만하기)을 fast-check로 섞고, 매 단계 서버 DB와 코어 재생을 대조한다.
//  1. 출력 중 작업은 판매자마다 많아야 하나
//  2. 작업은 사라지지 않고 상태는 넷 중 하나
//  3. 1등이 아닌 라벨 키의 출력함 작업은 모두 폐기 표시. 새로 받는 작업의 라벨 키는 늘 지금 1등
//  4. 자동 작업 수 = 코어 재생의 PRINT_PRODUCT_LABEL 효과 수
//  5. effect.labelPrinted는 효과마다 하나이고, 그 집합 = 출력함이 된 자동 효과(라벨 키의 효과 ID) 집합
//  6. 받은 상품 라벨 데이터 = 그 시점 상태로 손으로 계산한 L-9 값 (구매자는 라벨 키가 처음 생긴 때의 이름)
import { applyEvent, getBuyer, getProduct, initEngine, listClaims, listEffects, type ClaimInfo, type EngineEvent, type EngineState } from '@livejjim/core'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { DAY, DEV_A, DEV_B, call, chat, harness, printer, rid, startBroadcast, type Claimed, type Harness } from './helpers.ts'

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

type Op =
  | { t: 'chat'; buyer: number; no: number; nick: number }
  | { t: 'chatCancel'; buyer: number; no: number }
  | { t: 'sms'; no: number }
  | { t: 'hostCancel'; buyer: number; no: number }
  | { t: 'approve'; buyer: number; no: number }
  | { t: 'rename'; no: number; k: number }
  | { t: 'price'; no: number; k: number }
  | { t: 'stock'; no: number }
  | { t: 'reg'; dev: number; replace: boolean }
  | { t: 'claim'; dev: number }
  | { t: 'ok'; dev: number }
  | { t: 'fail'; dev: number; code: 'DISCONNECTED' | 'PRINT_FAILED' | 'DOES_NOT_FIT' }
  | { t: 'late'; dev: number }
  | { t: 'conn'; dev: number }
  | { t: 'restart' }
  | { t: 'pause' }
  | { t: 'manual'; pick: number }
  | { t: 'reprint'; pick: number }
  | { t: 'cancelJob'; pick: number }
  | { t: 'release' }

const buyer = fc.nat(3)
const no = fc.integer({ min: 1, max: 3 })
const dev = fc.nat(1)
const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ t: fc.constant('chat' as const), buyer, no, nick: fc.nat(1) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('chatCancel' as const), buyer, no }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('sms' as const), no }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('hostCancel' as const), buyer, no }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('approve' as const), buyer, no }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('rename' as const), no, k: fc.nat(2) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('price' as const), no, k: fc.nat(2) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('stock' as const), no }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('reg' as const), dev, replace: fc.boolean() }) },
  { weight: 5, arbitrary: fc.record({ t: fc.constant('claim' as const), dev }) },
  { weight: 5, arbitrary: fc.record({ t: fc.constant('ok' as const), dev }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('fail' as const), dev, code: fc.constantFrom('DISCONNECTED' as const, 'PRINT_FAILED' as const, 'DOES_NOT_FIT' as const) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('late' as const), dev }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('conn' as const), dev }) },
  { weight: 2, arbitrary: fc.constant({ t: 'restart' as const }) },
  { weight: 1, arbitrary: fc.constant({ t: 'pause' as const }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('manual' as const), pick: fc.nat(9) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('reprint' as const), pick: fc.nat(9) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('cancelJob' as const), pick: fc.nat(9) }) },
  { weight: 1, arbitrary: fc.constant({ t: 'release' as const }) },
)

interface JobRowLite {
  id: number
  job_id: string
  status: string
  voided: boolean
  reason: string
  label_id: number
}
interface LabelRowLite {
  id: number
  key: string
  kind: string
  claim: string | null
  version: number | null
  effect_id: string | null
}

async function replay(h: Harness, sellerId: string): Promise<EngineState> {
  const rows =
    (
      await h.database.pglite?.query<{ body: string; failed: boolean }>(
        `select e.body, e.failed from events e join scopes s on s.id = e.scope_id where e.seller_id = $1 and s.date = $2 and s.rehearsal = false order by e.seq`,
        [sellerId, DAY],
      )
    )?.rows ?? []
  let state: EngineState = initEngine({ broadcasts: [], settings: {} })
  for (const row of rows) if (!row.failed) state = applyEvent(state, JSON.parse(row.body) as EngineEvent).state
  return state
}

const DEVICES = [DEV_A, DEV_B] as const

describe('무작위 판매 열 + 출력 결과 열 — 서버 출력 기록 불변식 (L-11)', () => {
  it('불변식 1~6이 매 단계 지켜진다', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 10, maxLength: 40 }), async (ops) => {
        await h?.close()
        h = await harness()
        const H = h
        const a = await H.account('rand')
        const settings = await call(H.server, a.cookie, 'PATCH', '/api/settings', { settings: { 'cancel.buyerChat': 'AUTO' } })
        expect(settings.status, settings.text).toBe(200)
        const b = await startBroadcast(H.server, a.cookie, DAY)
        const p = printer(H, a.cookie)
        for (const n of [1, 2, 3]) {
          const r = await call(H.server, a.cookie, 'POST', '/api/events', { requestId: rid('reg'), type: 'product.register', b, no: n, name: `품종${String(n)}`, price: 10000 * n, ...(n === 3 ? { stock: 2 } : {}) })
          expect(r.status, r.text).toBe(200)
        }
        const attempts: Record<string, string[]> = { [DEV_A]: [], [DEV_B]: [] }
        const nicks = ['가', '나', '다', '라']
        /** 라벨 키 → 처음 생긴 때의 구매자 (내 계산) */
        const firstBuyer = new Map<string, { kind: string; name?: string }>()
        const seenJobs = new Set<number>()
        const trace: string[] = []

        const check = async (claimed: Claimed | null): Promise<void> => {
          const pg = H.database.pglite
          if (pg === null) throw new Error('PGlite')
          const state = await replay(H, a.sellerId)
          const claims = new Map<string, ClaimInfo>(listClaims(state).map((c) => [c.id, c]))
          const isWinner = (claim: string | null, version: number | null) => {
            const info = claim === null ? undefined : claims.get(claim)
            return info !== undefined && info.status === 'CONFIRMED' && info.confirmVersion === version
          }
          const jobs = (await pg.query<JobRowLite>(`select id, job_id, status, voided, reason, label_id from print_jobs where seller_id = $1`, [a.sellerId])).rows
          const labels = (await pg.query<LabelRowLite>(`select id, key, kind, claim, version, effect_id from print_labels where seller_id = $1`, [a.sellerId])).rows
          const where = `\n${trace.join('\n')}`
          // 새 라벨 키: 처음 생긴 때의 L-9 구매자를 내 계산으로 남긴다
          for (const label of labels) {
            if (label.kind !== 'product' || label.claim === null || firstBuyer.has(label.key)) continue
            const info = claims.get(label.claim)
            if (info === undefined) continue
            const owner = getBuyer(state, info.buyer)
            firstBuyer.set(label.key, info.origin === 'sms' || owner === null || owner.kind === 'sms' ? { kind: 'sms' } : { kind: 'youtube', name: owner.display })
          }
          // 1
          expect(jobs.filter((j) => j.status === 'PRINTING').length, `출력 중 둘 이상${where}`).toBeLessThanOrEqual(1)
          // 2
          for (const id of seenJobs) expect(jobs.some((j) => j.id === id), `작업이 사라짐${where}`).toBe(true)
          for (const j of jobs) {
            seenJobs.add(j.id)
            expect(['WAITING', 'PRINTING', 'DONE', 'CANCELLED']).toContain(j.status)
          }
          // 3
          const labelById = new Map(labels.map((l) => [l.id, l]))
          for (const j of jobs) {
            const label = labelById.get(j.label_id)
            if (label?.kind !== 'product' || j.status !== 'DONE') continue
            if (!isWinner(label.claim, label.version)) expect(j.voided, `1등이 아닌 라벨 키 ${label.key}의 출력함이 폐기 표시 없음${where}`).toBe(true)
          }
          if (claimed !== null && claimed.kind === 'product') {
            expect(isWinner(claimed.label.claim, claimed.label.version), `1등이 아닌 라벨 키를 받음 ${claimed.label.key}${where}`).toBe(true)
            // 6
            const info = claims.get(claimed.label.claim ?? '') as ClaimInfo
            const product = getProduct(state, info.broadcast, info.no)
            expect(claimed.data, `받은 데이터${where}`).toEqual({
              no: info.no,
              name: product?.name,
              price: info.price ?? product?.price,
              date: DAY,
              buyer: firstBuyer.get(claimed.label.key),
            })
          }
          // 4
          const effects = listEffects(state).filter((e) => e.kind === 'PRINT_PRODUCT_LABEL')
          expect(jobs.filter((j) => j.reason === 'auto').length, `자동 작업 수 ≠ 효과 수${where}`).toBe(effects.length)
          // 5
          const reports = (await pg.query<{ body: string }>(`select body from events where type = 'effect.labelPrinted' and seller_id = $1`, [a.sellerId])).rows.map(
            (r) => (JSON.parse(r.body) as { effectId: string }).effectId,
          )
          expect(new Set(reports).size, `같은 효과의 보고가 둘 이상${where}`).toBe(reports.length)
          const printedEffects = new Set(
            labels.filter((l) => l.effect_id !== null && jobs.some((j) => j.label_id === l.id && j.status === 'DONE')).map((l) => l.effect_id as string),
          )
          expect(new Set(reports), `보고 집합 ≠ 출력함이 된 자동 효과 집합${where}`).toEqual(printedEffects)
        }

        const claimIds = async (): Promise<string[]> => listClaims(await replay(H, a.sellerId)).map((c) => c.id)
        let k = 0
        for (const o of ops) {
          H.clock.t += 1000
          trace.push(JSON.stringify(o))
          let claimed: Claimed | null = null
          const write = (body: Record<string, unknown>) => call(H.server, a.cookie, 'POST', '/api/events', { requestId: rid('ev'), ...body })
          switch (o.t) {
            case 'chat':
              await chat(H, a.sellerId, b, `UC_${String(o.buyer)}`, `${nicks[o.buyer] ?? ''}${o.nick === 1 ? '별' : ''}`, String(o.no))
              break
            case 'chatCancel':
              await chat(H, a.sellerId, b, `UC_${String(o.buyer)}`, nicks[o.buyer] ?? '', `${String(o.no)} 취소`)
              break
            case 'sms':
              await write({ type: 'sms', b, no: o.no, received: '20:00' })
              break
            case 'hostCancel':
              await write({ type: 'host.cancel', b, no: o.no, buyer: `UC_${String(o.buyer)}`, reason: '시험' })
              break
            case 'approve':
              await write({ type: 'host.approveCancel', b, no: o.no, buyer: `UC_${String(o.buyer)}`, reason: '시험' })
              break
            case 'rename':
              await write({ type: 'product.update', b, no: o.no, name: `새품종${String(o.k)}` })
              break
            case 'price':
              await write({ type: 'product.update', b, no: o.no, price: 5000 + 1000 * o.k, applyTo: 'UNPAID_CLAIMS' })
              break
            case 'stock':
              await write({ type: 'product.update', b, no: o.no, stock: 2 })
              break
            case 'reg': {
              await p.register(DEVICES[o.dev] as string, o.dev === 0 ? '휴대폰' : 'PC', o.replace)
              break
            }
            case 'claim': {
              const r = await p.raw('POST', '/api/print/claim', { deviceId: DEVICES[o.dev] })
              const job = (r.body as { job?: Claimed | null }).job ?? null
              if (r.status === 200 && job !== null) {
                claimed = job
                attempts[DEVICES[o.dev] as string]?.push(job.attempt)
              }
              break
            }
            case 'ok': {
              const list = attempts[DEVICES[o.dev] as string] ?? []
              const last = list.at(-1)
              if (last !== undefined) await p.result(DEVICES[o.dev] as string, last, true)
              break
            }
            case 'fail': {
              const list = attempts[DEVICES[o.dev] as string] ?? []
              const last = list.at(-1)
              if (last !== undefined) await p.result(DEVICES[o.dev] as string, last, false, o.code, o.code === 'DOES_NOT_FIT' ? 'price' : undefined)
              break
            }
            case 'late': {
              const list = attempts[DEVICES[o.dev] as string] ?? []
              const old = list.at(0)
              if (old !== undefined) await p.result(DEVICES[o.dev] as string, old, true)
              break
            }
            case 'conn':
              await p.state(DEVICES[o.dev] as string, true)
              break
            case 'restart':
              await p.restart()
              break
            case 'pause':
              await p.pause()
              break
            case 'manual': {
              const ids = await claimIds()
              const id = ids[o.pick % Math.max(ids.length, 1)]
              if (id !== undefined) await p.print(b, id, `m${String(++k)}`)
              break
            }
            case 'reprint': {
              const ids = await claimIds()
              const id = ids[o.pick % Math.max(ids.length, 1)]
              if (id !== undefined) await p.reprint(b, id, undefined, `r${String(++k)}`)
              break
            }
            case 'cancelJob': {
              const overview = await p.overview()
              const job = overview.jobs.filter((j) => j.status === 'WAITING')[o.pick % Math.max(overview.jobs.length, 1)]
              if (job !== undefined) await p.cancel(job.date, job.id)
              break
            }
            case 'release':
              await p.release()
              break
          }
          await check(claimed)
        }
      }),
      { numRuns: Number(process.env.RUNS ?? 12), endOnFailure: true },
    )
  }, 300_000)
})
