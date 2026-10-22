// 무거운 파일 작업을 판정과 다른 스레드에서 (I2 — RA-I2-003·RA-I2-004).
// 서버는 노드 프로세스 하나다. 확인서 그림·PDF, 전원 확인서 PDF, 판매대장 엑셀 쓰기, 상품 목록 .xlsx 읽기는 수백 밀리초~수십 초 CPU를 쓰므로
// 같은 이벤트 루프에서 하면 그동안 모든 판매자의 채팅 판정·실시간 반영이 멈춘다. 그래서 워커 스레드(work-worker.ts)에 맡긴다.
// - 풀마다 워커 수·작업 시간 상한·워커 메모리 상한을 둔다. 시간을 넘기면 그 워커를 끝내고(다음 작업은 새 워커), 메모리를 넘기면 그 워커만 죽는다(서버는 그대로).
// - 판매자마다 동시에 맡길 수 있는 작업 수와 풀의 기다리는 줄 길이에 상한을 둔다 — 넘으면 바로 WorkBusy(화면: "지금 다른 파일을 만들고 있어요…").
// - 요청이 끊기면(abort) 아직 시작하지 않은 작업은 줄에서 뺀다.
// - 워커는 처음 맡길 때 띄우고, 한동안 쉬면 끝낸다(쉬는 워커는 프로세스 종료를 막지 않는다).
// - 넘기는 값·결과는 구조화 복제로 오간다(파일 바이트는 옮긴다 — transfer). 작업 내용은 로그에 남기지 않는다.
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import type { LedgerRow } from '@livejjim/documents'

export type WorkKind = 'receiptPdf' | 'receiptPng' | 'receiptJpg' | 'receiptJpgZip' | 'ledgerXlsx' | 'xlsxRows'

/** 판매대장 엑셀 조각 하나 = 날짜 하나의 대장 행과 그 날짜 대장에 옵션 방송이 있는지 (O3 D-O3-07) */
export interface LedgerChunk {
  readonly rows: readonly LedgerRow[]
  readonly options: boolean
}

export interface WorkPoolOptions {
  /** 풀 이름 (로그·점검용) */
  readonly name: string
  /** 워커 수 상한 */
  readonly size: number
  /** 작업 하나의 시간 상한 (워커에 맡긴 때부터) */
  readonly timeoutMs: number
  /** 워커 하나의 힙 상한 (MB) */
  readonly memoryMb: number
  /** 판매자마다 동시에 맡긴(기다리는 것 포함) 작업 수 상한 */
  readonly perOwner: number
  /** 기다리는 줄 길이 상한 */
  readonly maxQueue: number
  /** 이만큼 쉬면 워커를 끝낸다 (기본 2분) */
  readonly idleMs?: number
  /** 워커 파일 (기본 work-worker.ts) */
  readonly entry?: URL
}

/** 지금은 맡을 수 없음 (판매자의 동시 작업 상한·줄 길이 상한) */
export class WorkBusy extends Error {
  constructor() {
    super('작업이 밀려 있다')
    this.name = 'WorkBusy'
  }
}

/** 워커가 작업을 끝내지 못함 — timeout(시간 상한)·crashed(워커가 죽음, 메모리 상한 포함)·error(작업 안 오류)·aborted(요청이 끊김) */
export class WorkFailed extends Error {
  readonly reason: 'timeout' | 'crashed' | 'error' | 'aborted'
  constructor(reason: 'timeout' | 'crashed' | 'error' | 'aborted') {
    super(`작업 실패: ${reason}`)
    this.name = 'WorkFailed'
    this.reason = reason
  }
}

export interface RunOptions {
  /** 옮길 버퍼 (보내는 쪽에서는 더 쓰지 않는다) */
  readonly transfer?: readonly ArrayBuffer[]
  /** 작업에 이어 보낼 조각 (판매대장 행처럼 크게 쌓이는 입력 — 한 번에 복제하지 않고 조각마다 보낸다) */
  readonly chunks?: AsyncIterable<unknown>
  /** 요청이 끊기면 아직 시작하지 않은 작업은 뺀다 */
  readonly signal?: AbortSignal
}

interface Job {
  readonly id: number
  readonly owner: string
  readonly kind: WorkKind
  readonly input: unknown
  readonly options: RunOptions
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  settled: boolean
}

interface Slot {
  readonly worker: Worker
  job: Job | null
  timer: ReturnType<typeof setTimeout> | null
  idle: ReturnType<typeof setTimeout> | null
}

type Reply = { readonly id: number; readonly ok: true; readonly value: unknown } | { readonly id: number; readonly ok: false }

export interface WorkPoolStats {
  readonly workers: number
  readonly running: number
  readonly queued: number
  /** 워커가 끝낸 작업 수 */
  readonly completed: number
}

export class WorkPool {
  readonly #options: WorkPoolOptions
  readonly #slots: Slot[] = []
  readonly #queue: Job[] = []
  readonly #owners = new Map<string, number>()
  #nextId = 1
  #completed = 0
  #closed = false

  constructor(options: WorkPoolOptions) {
    if (!Number.isSafeInteger(options.size) || options.size < 1) throw new TypeError('워커 수는 1 이상이어야 한다')
    this.#options = options
  }

  stats(): WorkPoolStats {
    return { workers: this.#slots.length, running: this.#slots.filter((slot) => slot.job !== null).length, queued: this.#queue.length, completed: this.#completed }
  }

  /** 워커 하나를 미리 띄운다 (운영 서버 시작 — 첫 미리 보기가 워커를 띄우는 시간을 기다리지 않게) */
  warm(): void {
    if (this.#closed || this.#slots.length > 0) return
    const slot = this.#spawn()
    this.#rest(slot)
  }

  /** 작업 하나를 맡긴다. 판매자의 동시 작업·줄 길이 상한을 넘으면 WorkBusy */
  run<T>(owner: string, kind: WorkKind, input: unknown, options: RunOptions = {}): Promise<T> {
    if (this.#closed) return Promise.reject(new WorkFailed('crashed'))
    if ((this.#owners.get(owner) ?? 0) >= this.#options.perOwner || this.#queue.length >= this.#options.maxQueue) return Promise.reject(new WorkBusy())
    if (options.signal?.aborted === true) return Promise.reject(new WorkFailed('aborted'))
    return new Promise<T>((resolve, reject) => {
      const job: Job = { id: this.#nextId++, owner, kind, input, options, resolve: resolve as (value: unknown) => void, reject, settled: false }
      this.#owners.set(owner, (this.#owners.get(owner) ?? 0) + 1)
      options.signal?.addEventListener(
        'abort',
        () => {
          const index = this.#queue.indexOf(job)
          if (index >= 0) {
            this.#queue.splice(index, 1)
            this.#settle(job, new WorkFailed('aborted'))
          }
        },
        { once: true },
      )
      this.#queue.push(job)
      this.#dispatch()
    })
  }

  /** 워커를 모두 끝낸다 (기다리는 작업·하던 작업은 crashed로 끝난다) */
  async close(): Promise<void> {
    this.#closed = true
    for (const job of this.#queue.splice(0)) this.#settle(job, new WorkFailed('crashed'))
    const slots = this.#slots.splice(0)
    for (const slot of slots) {
      if (slot.job !== null) this.#settle(slot.job, new WorkFailed('crashed'))
      this.#clearTimers(slot)
    }
    await Promise.all(slots.map((slot) => slot.worker.terminate().catch(() => undefined)))
  }

  #settle(job: Job, outcome: Error | { value: unknown }): void {
    if (job.settled) return
    job.settled = true
    const left = (this.#owners.get(job.owner) ?? 1) - 1
    if (left <= 0) this.#owners.delete(job.owner)
    else this.#owners.set(job.owner, left)
    if (outcome instanceof Error) job.reject(outcome)
    else job.resolve(outcome.value)
  }

  #clearTimers(slot: Slot): void {
    if (slot.timer !== null) clearTimeout(slot.timer)
    if (slot.idle !== null) clearTimeout(slot.idle)
    slot.timer = null
    slot.idle = null
  }

  #spawn(): Slot {
    const worker = new Worker(this.#options.entry ?? new URL('./work-worker.ts', import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: this.#options.memoryMb },
      // 워커의 표준 출력은 부모로 넘기지 않는다 (작업 내용이 로그로 새지 않게)
      stdout: true,
      stderr: true,
    })
    worker.stdout.resume()
    worker.stderr.resume()
    const slot: Slot = { worker, job: null, timer: null, idle: null }
    this.#slots.push(slot)
    worker.on('message', (reply: Reply) => {
      const job = slot.job
      if (job === null || reply.id !== job.id) return
      this.#finish(slot)
      this.#completed++
      this.#settle(job, reply.ok ? { value: reply.value } : new WorkFailed('error'))
      this.#dispatch()
    })
    const lost = () => {
      const index = this.#slots.indexOf(slot)
      if (index < 0) return
      this.#slots.splice(index, 1)
      this.#clearTimers(slot)
      const job = slot.job
      slot.job = null
      if (job !== null) this.#settle(job, new WorkFailed('crashed'))
      this.#dispatch()
    }
    worker.on('error', lost)
    worker.on('exit', lost)
    return slot
  }

  /** 작업이 끝난 워커: 시간 상한을 풀고 쉰다 */
  #finish(slot: Slot): void {
    slot.job = null
    this.#clearTimers(slot)
    this.#rest(slot)
  }

  /** 쉬는 워커는 프로세스 종료를 막지 않고, 한동안 쉬면 끝낸다 */
  #rest(slot: Slot): void {
    slot.worker.unref()
    slot.idle = setTimeout(() => {
      const index = this.#slots.indexOf(slot)
      if (index < 0 || slot.job !== null) return
      this.#slots.splice(index, 1)
      void slot.worker.terminate().catch(() => undefined)
    }, this.#options.idleMs ?? 120_000)
    slot.idle.unref?.()
  }

  #dispatch(): void {
    if (this.#closed) return
    while (this.#queue.length > 0) {
      let slot = this.#slots.find((candidate) => candidate.job === null)
      if (slot === undefined) {
        if (this.#slots.length >= this.#options.size) return
        slot = this.#spawn()
      }
      const job = this.#queue.shift() as Job
      this.#start(slot, job)
    }
  }

  #start(slot: Slot, job: Job): void {
    this.#clearTimers(slot)
    slot.job = job
    slot.worker.ref()
    slot.timer = setTimeout(() => {
      if (slot.job !== job) return
      // 시간 상한: 그 워커를 끝낸다 (exit → lost가 줄을 정리하고 다음 작업을 새 워커에)
      this.#settle(job, new WorkFailed('timeout'))
      void slot.worker.terminate().catch(() => undefined)
    }, this.#options.timeoutMs)
    const chunks = job.options.chunks
    try {
      slot.worker.postMessage({ id: job.id, kind: job.kind, input: job.input, streamed: chunks !== undefined }, [...(job.options.transfer ?? [])])
    } catch {
      this.#settle(job, new WorkFailed('error'))
      this.#finish(slot)
      return
    }
    if (chunks === undefined) return
    void (async () => {
      try {
        for await (const chunk of chunks) {
          if (slot.job !== job) return
          slot.worker.postMessage({ id: job.id, chunk })
        }
        if (slot.job === job) slot.worker.postMessage({ id: job.id, end: true })
      } catch {
        // 조각을 만들다 실패: 그 워커를 끝낸다 (작업 상태를 알 수 없다)
        if (slot.job === job) {
          this.#settle(job, new WorkFailed('error'))
          void slot.worker.terminate().catch(() => undefined)
        }
      }
    })()
  }
}

/** 서버의 작업 풀 (확인서 한 장·문서·엑셀 읽기를 나눠 큰 문서가 미리 보기를 막지 않게) */
export interface WorkPools {
  /** 확인서 한 장(그림·PDF) — 화면 미리 보기가 자주 부른다 */
  readonly receipts: WorkPool
  /** 전원 확인서 PDF·판매대장 엑셀 (기간·전체) */
  readonly documents: WorkPool
  /** 상품 목록 .xlsx 읽기 (판매자가 올린 파일 — 짧은 시간·작은 메모리 상한) */
  readonly sheets: WorkPool
}

export function createWorkPools(): WorkPools {
  const spare = Math.max(1, Math.min(2, availableParallelism() - 1))
  return {
    receipts: new WorkPool({ name: 'receipts', size: 1, timeoutMs: 30_000, memoryMb: 512, perOwner: 8, maxQueue: 64 }),
    documents: new WorkPool({ name: 'documents', size: spare, timeoutMs: 300_000, memoryMb: 2048, perOwner: 2, maxQueue: 16 }),
    sheets: new WorkPool({ name: 'sheets', size: 1, timeoutMs: 15_000, memoryMb: 512, perOwner: 2, maxQueue: 8 }),
  }
}

let shared: WorkPools | null = null

/** 프로세스에 하나 (서버를 여럿 만드는 시험도 워커를 나눠 쓴다) */
export function sharedWorkPools(): WorkPools {
  shared ??= createWorkPools()
  return shared
}
