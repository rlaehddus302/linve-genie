// P1 적대 테스트 (test-domain): 출력 대기열 무작위 열 (AC-P1-71, L-8).
// 넣기·시작·끝·실패·끊김·다시 연결·다시 시작·멈춤·폐기·재출력·빼기·JSON 왕복을 fast-check로 섞어 아래 속성을 본다.
// (1) 넣은 작업은 사라지지 않는다 (2) 출력 중은 언제나 0~1개 (3) 같은 작업 ID는 한 번만 출력함
// (4) 출력함이 되는 순서 = 넣은 순서(재출력은 넣은 때 기준) (5) 폐기된 라벨 키는 그 뒤 새로 출력함이 되지 않는다
// (출력 중이던 한 장은 끝난 뒤 폐기 표시 — L-8 4) (6) 멈춘 동안은 아무것도 출력 중이 되지 않는다 (7) JSON 왕복 뒤에도 같은 결과
import {
  cancelJob,
  completeJob,
  createPrintQueue,
  enqueueJob,
  failJob,
  pauseQueue,
  printingJob,
  reprintLabel,
  resumeQueue,
  setConnection,
  startNextJob,
  voidLabel,
  type PrintQueueState,
} from '@livejjim/printer'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

type Cmd =
  | { t: 'enqueue'; id: number; key: number }
  | { t: 'start' }
  | { t: 'complete' }
  | { t: 'fail'; code: 'PRINT_FAILED' | 'DISCONNECTED' | 'TIMEOUT' | 'DOES_NOT_FIT' }
  | { t: 'conn'; on: boolean }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'void'; key: number }
  | { t: 'reprint'; id: number; key: number }
  | { t: 'cancel'; id: number }
  | { t: 'json' }

const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ t: fc.constant('enqueue' as const), id: fc.nat(14), key: fc.nat(5) }) },
  { weight: 4, arbitrary: fc.constant({ t: 'start' as const }) },
  { weight: 4, arbitrary: fc.constant({ t: 'complete' as const }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('fail' as const), code: fc.constantFrom('PRINT_FAILED', 'DISCONNECTED', 'TIMEOUT', 'DOES_NOT_FIT') }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('conn' as const), on: fc.boolean() }) },
  { weight: 1, arbitrary: fc.constant({ t: 'pause' as const }) },
  { weight: 2, arbitrary: fc.constant({ t: 'resume' as const }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('void' as const), key: fc.nat(5) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('reprint' as const), id: fc.nat(14), key: fc.nat(5) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('cancel' as const), id: fc.nat(14) }) },
  { weight: 1, arbitrary: fc.constant({ t: 'json' as const }) },
)

const jobOf = (id: number, key: number) => ({ id: `J${String(id)}`, labelKey: `L${String(key)}`, kind: 'product' as const, data: { no: id }, contentKey: `c${String(id)}` })

function apply(s: PrintQueueState, c: Cmd, at: number): PrintQueueState {
  switch (c.t) {
    case 'enqueue':
      return enqueueJob(s, jobOf(c.id, c.key), at).state
    case 'start':
      return startNextJob(s).state
    case 'complete': {
      const p = printingJob(s)
      return p ? completeJob(s, p.id, { at, device: 'PC' }) : s
    }
    case 'fail': {
      const p = printingJob(s)
      return p ? failJob(s, p.id, c.code) : s
    }
    case 'conn':
      return setConnection(s, c.on)
    case 'pause':
      return pauseQueue(s)
    case 'resume':
      return resumeQueue(s)
    case 'void':
      return voidLabel(s, `L${String(c.key)}`)
    case 'reprint':
      return reprintLabel(s, jobOf(c.id, c.key), at).state
    case 'cancel':
      return cancelJob(s, `J${String(c.id)}`)
    case 'json':
      return JSON.parse(JSON.stringify(s)) as PrintQueueState
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

describe('대기열 무작위 열 (AC-P1-71)', () => {
  it('속성 (1)~(7)', () => {
    fc.assert(
      fc.property(fc.array(cmd, { maxLength: 80 }), (cmds) => {
        let s = createPrintQueue()
        const everAdded = new Set<string>()
        const doneOrder: string[] = []
        for (const [step, c] of cmds.entries()) {
          const at = 1000 + step
          const before = deepFreeze(s)
          const beforeJson = JSON.stringify(before)
          const voidedBefore = new Set(before.voidedLabels)
          const printingBefore = printingJob(before)?.id
          const next = apply(before, c, at)
          // (7) 받은 상태를 바꾸지 않고(얼려도 통과), JSON 왕복한 상태에 같은 일을 해도 같은 결과
          expect(JSON.stringify(before)).toBe(beforeJson)
          if (c.t !== 'json') expect(JSON.stringify(apply(JSON.parse(beforeJson) as PrintQueueState, c, at))).toBe(JSON.stringify(next))
          // (1) 넣은 작업은 사라지지 않는다
          for (const job of before.jobs) everAdded.add(job.id)
          const ids = next.jobs.map((j) => j.id)
          for (const id of everAdded) expect(ids, `${id} 사라짐`).toContain(id)
          expect(new Set(ids).size).toBe(ids.length)
          // (2) 출력 중 0~1개
          expect(next.jobs.filter((j) => j.status === 'PRINTING').length).toBeLessThanOrEqual(1)
          // (6) 멈춘 동안·끊긴 동안 새로 출력 중이 되는 작업은 없다
          const printingAfter = printingJob(next)?.id
          if (printingAfter !== undefined && printingAfter !== printingBefore) {
            expect(before.paused).toBeNull()
            expect(before.connected).toBe(true)
          }
          // (3)(4)(5) 새로 출력함이 된 작업
          const newlyDone = next.jobs.filter((j) => j.status === 'DONE' && before.jobs.find((b) => b.id === j.id)?.status !== 'DONE')
          expect(newlyDone.length).toBeLessThanOrEqual(1)
          for (const job of newlyDone) {
            expect(doneOrder).not.toContain(job.id) // (3)
            expect(job.id).toBe(printingBefore) // 출력 중이던 작업만 출력함이 된다
            if (voidedBefore.has(job.labelKey)) expect(job.voided).toBe(true) // (5) 출력 중에 폐기된 한 장만, 폐기 표시와 함께
            doneOrder.push(job.id)
          }
          // 한 번 출력함은 되돌아가지 않는다
          for (const b of before.jobs) if (b.status === 'DONE') expect(next.jobs.find((j) => j.id === b.id)?.status).toBe('DONE')
          // 폐기 키의 작업은 대기로 남지 않는다
          for (const j of next.jobs) if (next.voidedLabels.includes(j.labelKey)) expect(j.status === 'WAITING').toBe(false)
          s = next
        }
        // (4) 출력함 순서 = 작업 목록(넣은) 순서
        const listOrder = s.jobs.filter((j) => j.status === 'DONE').map((j) => j.id)
        expect(doneOrder).toEqual(listOrder)
      }),
      { numRuns: 400, seed: 20261020 },
    )
  })
})
