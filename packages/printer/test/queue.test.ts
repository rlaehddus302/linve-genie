// 출력 대기열 순수 로직 (AC-P1-50~55·57, L-8·L-10).
import { labelContentKey } from '@livejjim/label'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  JOB_STATUS_NAMES,
  PAUSE_MESSAGES,
  cancelJob,
  completeJob,
  createPrintQueue,
  enqueueJob,
  failJob,
  jobStatusText,
  labelHistory,
  needsReprint,
  pauseMessage,
  pauseQueue,
  printingJob,
  reprintLabel,
  resumeQueue,
  setConnection,
  startNextJob,
  voidLabel,
  type NewJob,
  type PrintJob,
  type PrintQueueState,
} from '../src/index.ts'

const G001 = { no: 194, name: '왕비뇌신금', price: 8000, date: '2026-10-08', buyer: { kind: 'youtube', name: '우주천사' } }

function key(data: unknown): string {
  const k = labelContentKey('product', data)
  if (!k.ok) throw new Error('내용 키 실패')
  return k.key
}

const job = (id: string, labelKey: string, data: unknown = { ...G001, no: Number(id.replace(/\D/g, '')) || 1 }): NewJob => ({ id, labelKey, kind: 'product', data, contentKey: key(data) })

/** 깊이 얼린다 — 순수 함수가 받은 상태를 바꾸면 던진다 */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

function add(state: PrintQueueState, ...jobs: NewJob[]): PrintQueueState {
  let s = state
  for (const j of jobs) s = enqueueJob(deepFreeze(s), j, 1000).state
  return s
}

function start(state: PrintQueueState): [PrintQueueState, PrintJob] {
  const r = startNextJob(deepFreeze(state))
  if (!r.job) throw new Error('시작할 작업이 없다')
  return [r.state, r.job]
}

const statusOf = (s: PrintQueueState, id: string) => s.jobs.find((j) => j.id === id)
const waitingOrder = (s: PrintQueueState) => s.jobs.filter((j) => j.status === 'WAITING').map((j) => j.id)

describe('순서와 중복 (AC-P1-50)', () => {
  it('J1 → J2 → J3 순서로 한 번에 하나만 출력 중이 된다', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1'), job('J2', 'L2'), job('J3', 'L3'))
    const order: string[] = []
    for (let i = 0; i < 3; i++) {
      const [next, j] = start(s)
      expect(startNextJob(next).job).toBeNull() // 출력 중이면 다음을 시작하지 않는다
      expect(next.jobs.filter((x) => x.status === 'PRINTING')).toHaveLength(1)
      order.push(j.id)
      s = completeJob(next, j.id, { at: 2000 + i, device: 'PC' })
    }
    expect(order).toEqual(['J1', 'J2', 'J3'])
    expect(startNextJob(s).job).toBeNull()
  })

  it('같은 작업 ID를 다시 넣으면(내용이 달라도, 끝난 뒤여도) 아무 일도 없다', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1'), job('J2', 'L2'))
    const again = enqueueJob(s, job('J2', 'L9', { ...G001, no: 999 }), 5000)
    expect(again.accepted).toBe(false)
    expect(again.state).toBe(s)
    let j: PrintJob
    ;[s, j] = start(s)
    s = completeJob(s, j.id, { at: 3000, device: 'PC' })
    ;[s, j] = start(s)
    s = completeJob(s, j.id, { at: 4000, device: 'PC' })
    const afterDone = enqueueJob(s, job('J2', 'L2'), 6000)
    expect(!afterDone.accepted && afterDone.reason).toBe('DUPLICATE_JOB')
    expect(afterDone.state).toBe(s)
    expect(s.jobs).toHaveLength(2)
  })

  it('연결 전에는 시작하지 않는다', () => {
    const s = add(createPrintQueue(false), job('J1', 'L1'))
    expect(startNextJob(s).job).toBeNull()
    expect(startNextJob(setConnection(s, true)).job?.id).toBe('J1')
  })
})

describe('멈춤과 이어서 — 라벨이 사라지지 않는다 (AC-P1-51)', () => {
  it('J1 출력 중 끊김 → 멈춤(끊김), J1은 대기 맨 앞(시도 1·DISCONNECTED), 멈춘 동안 J4는 맨 끝, 다시 연결되면 J1부터', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1'), job('J2', 'L2'), job('J3', 'L3'))
    ;[s] = start(s)
    s = setConnection(deepFreeze(s), false)
    expect(s.paused).toBe('DISCONNECTED')
    expect(pauseMessage(s)).toBe('프린터 연결이 끊겼어요.')
    expect(waitingOrder(s)).toEqual(['J1', 'J2', 'J3'])
    expect(statusOf(s, 'J1')).toMatchObject({ status: 'WAITING', attempts: 1, lastError: 'DISCONNECTED' })
    // 어댑터가 뒤늦게 끊김 실패를 알려도 두 번 세지 않는다
    s = failJob(s, 'J1', 'DISCONNECTED')
    expect(statusOf(s, 'J1')?.attempts).toBe(1)
    s = add(s, job('J4', 'L4'))
    expect(waitingOrder(s)).toEqual(['J1', 'J2', 'J3', 'J4'])
    expect(startNextJob(s).job).toBeNull()
    s = setConnection(s, true)
    expect(s.paused).toBeNull()
    const done: string[] = []
    for (;;) {
      const r = startNextJob(s)
      if (!r.job) break
      done.push(r.job.id)
      s = completeJob(r.state, r.job.id, { at: 1, device: 'PC' })
    }
    expect(done).toEqual(['J1', 'J2', 'J3', 'J4'])
  })

  it('어댑터가 끊김 실패를 먼저 알려도 같다 (failJob DISCONNECTED → 멈춤·끊김)', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1'), job('J2', 'L2'))
    ;[s] = start(s)
    s = failJob(deepFreeze(s), 'J1', 'DISCONNECTED')
    expect(s).toMatchObject({ paused: 'DISCONNECTED', connected: false })
    expect(statusOf(s, 'J1')).toMatchObject({ status: 'WAITING', attempts: 1 })
    s = setConnection(s, true)
    expect(startNextJob(s).job?.id).toBe('J1')
  })

  it('연결된 채로 J2가 PRINT_FAILED → 멈춤(프린터 오류), 저절로 다시 출력하지 않는다, 다시 시작하면 J2부터', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1'), job('J2', 'L2'), job('J3', 'L3'))
    let j: PrintJob
    ;[s, j] = start(s)
    s = completeJob(s, j.id, { at: 1, device: 'PC' })
    ;[s, j] = start(s)
    s = failJob(deepFreeze(s), 'J2', 'PRINT_FAILED')
    expect(s.paused).toBe('PRINTER_ERROR')
    expect(pauseMessage(s)).toBe('프린터 오류로 멈췄어요.')
    expect(waitingOrder(s)[0]).toBe('J2')
    expect(statusOf(s, 'J2')).toMatchObject({ attempts: 1, lastError: 'PRINT_FAILED' })
    // 연결이 그대로여도·다시 연결 알림이 와도 저절로 시작하지 않는다
    expect(startNextJob(s).job).toBeNull()
    expect(startNextJob(setConnection(s, true)).job).toBeNull()
    s = resumeQueue(s)
    expect(startNextJob(s).job?.id).toBe('J2')
    expect(j.id).toBe('J2')
  })

  it('판매자가 멈춘 대기열은 다시 시작으로만 이어진다, 끊겼다 다시 연결돼도 판매자 멈춤은 그대로', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1'))
    s = pauseQueue(deepFreeze(s))
    expect(pauseMessage(s)).toBe('출력을 멈췄어요.')
    expect(startNextJob(s).job).toBeNull()
    s = setConnection(setConnection(s, false), true)
    expect(s.paused).toBe('SELLER')
    expect(startNextJob(s).job).toBeNull()
    s = resumeQueue(s)
    expect(startNextJob(s).job?.id).toBe('J1')
  })

  it('대기 중에 끊겨도 멈춤(끊김), 끊긴 채 다시 시작하면 끊김 멈춤으로 남는다', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1'))
    s = setConnection(s, false)
    expect(s.paused).toBe('DISCONNECTED')
    s = pauseQueue(s)
    s = resumeQueue(s)
    expect(s.paused).toBe('DISCONNECTED')
    s = setConnection(s, true)
    expect(startNextJob(s).job?.id).toBe('J1')
  })

  it('멈춘 까닭 문장 · 상태 낱말', () => {
    expect(PAUSE_MESSAGES).toMatchObject({ DISCONNECTED: '프린터 연결이 끊겼어요.', PRINTER_ERROR: '프린터 오류로 멈췄어요.', SELLER: '출력을 멈췄어요.' })
    expect(JOB_STATUS_NAMES).toEqual({ WAITING: '대기', PRINTING: '출력 중', DONE: '출력함', CANCELLED: '출력 안 함' })
  })
})

describe('폐기 표시 (AC-P1-52)', () => {
  it('L1 출력함·L2 대기·L3 출력 중에서 L2·L3·L1 폐기', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1'))
    let j: PrintJob
    ;[s, j] = start(s)
    s = completeJob(s, j.id, { at: 1, device: 'PC' })
    s = add(s, job('J3', 'L3'), job('J2', 'L2'))
    ;[s, j] = start(s)
    expect(j.id).toBe('J3')
    for (const k of ['L2', 'L3', 'L1']) s = voidLabel(deepFreeze(s), k)
    expect(statusOf(s, 'J2')).toMatchObject({ status: 'CANCELLED', voided: true })
    expect(statusOf(s, 'J3')).toMatchObject({ status: 'PRINTING', voided: true })
    s = completeJob(s, 'J3', { at: 2, device: 'PC' })
    expect(statusOf(s, 'J3')).toMatchObject({ status: 'DONE', voided: true })
    expect(statusOf(s, 'J1')).toMatchObject({ status: 'DONE', voided: true })
    expect(jobStatusText(statusOf(s, 'J1') as PrintJob)).toBe('폐기 — 버려 주세요')
    expect(jobStatusText(statusOf(s, 'J2') as PrintJob)).toBe('폐기')
    expect(startNextJob(s).job).toBeNull() // J2는 출력되지 않는다
    // 같은 라벨 키를 다시 폐기하면 아무 일도 없다
    expect(voidLabel(s, 'L1')).toBe(s)
    // 폐기한 라벨 키는 재출력할 수 없다
    const re = reprintLabel(s, job('J1b', 'L1'), 9)
    expect(!re.accepted && re.reason).toBe('VOIDED')
    expect(re.state).toBe(s)
  })

  it('출력 중에 폐기된 작업이 실패·끊김으로 끝나면 다시 출력하지 않는다(출력 안 함 + 폐기)', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1'))
    ;[s] = start(s)
    s = voidLabel(s, 'L1')
    s = setConnection(s, false)
    expect(statusOf(s, 'J1')).toMatchObject({ status: 'CANCELLED', voided: true })
    expect(startNextJob(setConnection(s, true)).job).toBeNull()
  })

  it('폐기한 라벨 키로 새 작업을 넣으면 출력하지 않고 출력 안 함 + 폐기로 남긴다', () => {
    let s = voidLabel(createPrintQueue(true), 'L1')
    const r = enqueueJob(s, job('J1', 'L1'), 1)
    expect(!r.accepted && r.reason).toBe('VOIDED')
    s = r.state
    expect(statusOf(s, 'J1')).toMatchObject({ status: 'CANCELLED', voided: true })
    expect(startNextJob(s).job).toBeNull()
  })
})

describe('재출력과 이력 (AC-P1-53)', () => {
  it('L1의 J1이 t1에 PC에서 출력함 → J1b 재출력 → 출력 횟수 2, 시각 [t1, t2], 기기 [PC, 폰]', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1'), job('J2', 'L2'))
    let j: PrintJob
    ;[s, j] = start(s)
    s = completeJob(s, j.id, { at: 111, device: 'PC' })
    const re = reprintLabel(deepFreeze(s), job('J1b', 'L1'), 150)
    expect(re.accepted).toBe(true)
    s = re.state
    expect(waitingOrder(s)).toEqual(['J2', 'J1b'])
    // J1b가 대기·출력 중이면 또 재출력해도 아무 일도 없다 (이유를 돌려준다)
    const twice = reprintLabel(s, job('J1c', 'L1'), 151)
    expect(!twice.accepted && [twice.reason, twice.message]).toEqual(['IN_PROGRESS', '이 라벨은 이미 출력을 기다리고 있어요.'])
    expect(twice.state).toBe(s)
    // 이미 있는 작업 ID로 재출력하면 아무 일도 없다
    expect(!reprintLabel(s, job('J2', 'L1'), 152).accepted).toBe(true)
    ;[s, j] = start(s)
    s = completeJob(s, j.id, { at: 200, device: '폰' })
    ;[s, j] = start(s)
    expect(j.id).toBe('J1b')
    expect(reprintLabel(s, job('J1d', 'L1'), 201).accepted).toBe(false) // 출력 중
    s = completeJob(s, j.id, { at: 222, device: '폰' })
    expect(labelHistory(s, 'L1')).toMatchObject({ count: 2, times: [111, 222], devices: ['PC', '폰'], voided: false })
  })

  it('출력 안 함(판매자가 뺀) 라벨은 재출력할 수 있고, 출력한 적 없는 라벨 키는 없다', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1'))
    s = cancelJob(s, 'J1')
    expect(reprintLabel(s, job('J1b', 'L1'), 5).accepted).toBe(true)
    const none = reprintLabel(s, job('J9', 'L9'), 5)
    expect(!none.accepted && none.reason).toBe('NOT_PRINTED')
  })
})

describe('대기 작업 빼기 (AC-P1-54)', () => {
  it('대기 작업은 출력 안 함이 되고 기록은 남는다, 출력 중·출력함 작업은 뺄 수 없다', () => {
    const [started, j] = start(add(createPrintQueue(true), job('J1', 'L1'), job('J2', 'L2'), job('J3', 'L3')))
    let s = cancelJob(deepFreeze(started), 'J2')
    expect(statusOf(s, 'J2')).toMatchObject({ status: 'CANCELLED', voided: false })
    expect(s.jobs).toHaveLength(3)
    expect(cancelJob(s, 'J1')).toBe(s) // 출력 중
    s = completeJob(s, j.id, { at: 1, device: 'PC' })
    expect(cancelJob(s, 'J1')).toBe(s) // 출력함
    expect(startNextJob(s).job?.id).toBe('J3')
    expect(jobStatusText(statusOf(s, 'J2') as PrintJob)).toBe('출력 안 함')
  })
})

describe('재출력 필요 — 내용 키 (AC-P1-55)', () => {
  it('같은 데이터면 아니고, 번호·품종·가격·구매자·날짜가 바뀌면 재출력 필요, 템플릿만 바꾸면 아니다', () => {
    let s = add(createPrintQueue(true), job('J1', 'L1', G001))
    let j: PrintJob
    expect(needsReprint(s, 'L1', key({ ...G001, no: 1 }))).toBe(false) // 출력한 적 없음
    ;[s, j] = start(s)
    s = completeJob(s, j.id, { at: 1, device: 'PC' })
    expect(needsReprint(s, 'L1', key(G001))).toBe(false)
    expect(needsReprint(s, 'L1', key({ ...G001, name: '왕비뇌신금 ' }))).toBe(false) // 다듬으면 같은 글
    for (const changed of [{ no: 195 }, { name: '핑크프릴' }, { price: 9000 }, { buyer: { kind: 'sms' } }, { date: '2026-10-09' }]) {
      expect(needsReprint(s, 'L1', key({ ...G001, ...changed })), JSON.stringify(changed)).toBe(true)
    }
    // 재출력해 새 데이터로 출력하면 다시 재출력 필요가 아니다
    const newer = { ...G001, price: 9000 }
    s = reprintLabel(s, job('J1b', 'L1', newer), 2).state
    ;[s, j] = start(s)
    s = completeJob(s, j.id, { at: 3, device: 'PC' })
    expect(needsReprint(s, 'L1', key(newer))).toBe(false)
    expect(needsReprint(s, 'L1', key(G001))).toBe(true)
  })
})

describe('순수·직렬화 (AC-P1-57)', () => {
  type Op =
    | { t: 'add'; i: number; l: number }
    | { t: 'start' }
    | { t: 'done' }
    | { t: 'fail'; code: string }
    | { t: 'conn'; on: boolean }
    | { t: 'pause' }
    | { t: 'resume' }
    | { t: 'void'; l: number }
    | { t: 'reprint'; i: number; l: number }
    | { t: 'cancel'; i: number }

  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ t: fc.constant('add' as const), i: fc.nat(30), l: fc.nat(6) }),
    fc.constant({ t: 'start' as const }),
    fc.constant({ t: 'done' as const }),
    fc.record({ t: fc.constant('fail' as const), code: fc.constantFrom('PRINT_FAILED', 'DISCONNECTED', 'TIMEOUT', 'NOT_CONNECTED') }),
    fc.record({ t: fc.constant('conn' as const), on: fc.boolean() }),
    fc.constant({ t: 'pause' as const }),
    fc.constant({ t: 'resume' as const }),
    fc.record({ t: fc.constant('void' as const), l: fc.nat(6) }),
    fc.record({ t: fc.constant('reprint' as const), i: fc.nat(30), l: fc.nat(6) }),
    fc.record({ t: fc.constant('cancel' as const), i: fc.nat(30) }),
  )

  function apply(s: PrintQueueState, op: Op, step: number): PrintQueueState {
    switch (op.t) {
      case 'add':
        return enqueueJob(s, job(`J${String(op.i)}`, `L${String(op.l)}`), step).state
      case 'start':
        return startNextJob(s).state
      case 'done': {
        const p = printingJob(s)
        return p ? completeJob(s, p.id, { at: step, device: 'PC' }) : s
      }
      case 'fail': {
        const p = printingJob(s)
        return p ? failJob(s, p.id, op.code) : s
      }
      case 'conn':
        return setConnection(s, op.on)
      case 'pause':
        return pauseQueue(s)
      case 'resume':
        return resumeQueue(s)
      case 'void':
        return voidLabel(s, `L${String(op.l)}`)
      case 'reprint':
        return reprintLabel(s, job(`R${String(op.i)}`, `L${String(op.l)}`), step).state
      case 'cancel':
        return cancelJob(s, `J${String(op.i)}`)
    }
  }

  it('받은 상태를 바꾸지 않는다(얼린 상태로 돈다), 아무 때나 JSON 왕복해도 같은 다음 동작', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), fc.nat(60), (ops, cut) => {
        let a = createPrintQueue()
        let b = createPrintQueue()
        ops.forEach((op, step) => {
          a = apply(deepFreeze(a), op, step)
          if (step === cut) b = JSON.parse(JSON.stringify(b)) as PrintQueueState
          b = apply(b, op, step)
          // 출력 중은 언제나 0~1개, 멈춘 동안·끊긴 동안 새로 출력 중이 되지 않는다
          expect(a.jobs.filter((j) => j.status === 'PRINTING').length).toBeLessThanOrEqual(1)
          if (op.t === 'start' && (a.paused !== null || !a.connected)) expect(startNextJob(a).job).toBeNull()
        })
        expect(JSON.parse(JSON.stringify(b))).toEqual(JSON.parse(JSON.stringify(a)))
      }),
      { numRuns: 300 },
    )
  })

  it('시각·기기 이름은 인자로만 받는다 — 상태는 JSON 그대로다', () => {
    const [started, j] = start(add(createPrintQueue(true), job('J1', 'L1')))
    const s = completeJob(started, j.id, { at: 1_760_000_000_000, device: '판매 PC' })
    const back = JSON.parse(JSON.stringify(s)) as PrintQueueState
    expect(back).toEqual(s)
    expect(labelHistory(back, 'L1')).toEqual(labelHistory(s, 'L1'))
    expect(s.format).toBe(1)
  })
})

describe('대기열은 시계·난수를 읽지 않는다 (AC-P1-15)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Date.now·Math.random을 던지게 해도 같은 결과', () => {
    const run = (): PrintQueueState => {
      const [started, j] = start(add(createPrintQueue(true), job('J1', 'L1'), job('J2', 'L2')))
      let s = completeJob(started, j.id, { at: 5, device: 'PC' })
      s = failJob(startNextJob(s).state, 'J2', 'PRINT_FAILED')
      s = voidLabel(resumeQueue(s), 'L2')
      return reprintLabel(s, job('J1b', 'L1'), 9).state
    }
    const before = run()
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now')
    })
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random')
    })
    expect(run()).toEqual(before)
  })
})
