// 대기열 실행기 (LBL-06 AC2·LBL-08, SPEC §8 "30장 연속 출력", AC-P1-56) — 순수 대기열 + 어댑터 + 렌더 함수 + 주입한 시각.
// 한 번에 한 장씩 렌더해 어댑터로 보낸다. 끊기면 멈추고, 다시 연결되면 그 작업부터 이어서. 프린터 오류는 다시 시작을 기다린다.
import type { LabelBitmap } from '@livejjim/label'
import type { PrinterAdapter } from './adapter.ts'
import {
  cancelJob,
  completeJob,
  createPrintQueue,
  enqueueJob,
  failJob,
  pauseQueue,
  reprintLabel,
  resumeQueue,
  setConnection,
  startNextJob,
  voidLabel,
  type NewJob,
  type PrintJob,
  type PrintQueueState,
  type QueueUpdate,
} from './queue.ts'

/** 작업 → 1비트 그림 (보통 @livejjim/label 렌더 함수에 지금 템플릿을 넣어 감싼다) */
export type JobRenderer = (job: PrintJob) => { readonly ok: true; readonly image: LabelBitmap } | { readonly ok: false; readonly error: { readonly code: string } }

export interface PrintRunnerOptions {
  readonly adapter: PrinterAdapter
  readonly render: JobRenderer
  /** 출력함 시각 (주입 — 실행기는 시계를 읽지 않는다) */
  readonly clock: () => number
  /** 이 기기 이름 (이력에 남는다) */
  readonly device: string
  /** 농도 (없으면 프로필 기본값) */
  readonly density?: number
  /** 저장해 둔 대기열 상태 (JSON에서 다시 읽은 것) */
  readonly initialState?: PrintQueueState
  /** 상태가 바뀔 때마다 (저장·화면 갱신용) */
  readonly onChange?: (state: PrintQueueState) => void
}

export interface PrintRunner {
  readonly state: PrintQueueState
  enqueue(job: NewJob): QueueUpdate
  reprint(job: NewJob): QueueUpdate
  cancel(jobId: string): void
  voidLabel(labelKey: string): void
  /** 판매자 멈춤 */
  pause(): void
  /** "다시 시작" */
  restart(): void
  /** 지금 시작할 수 있는 출력이 모두 끝날 때까지 기다린다 */
  idle(): Promise<void>
  /** 어댑터 알림 듣기를 그만둔다 */
  dispose(): void
}

const isConnected = (adapter: PrinterAdapter): boolean => adapter.state === 'CONNECTED' || adapter.state === 'PRINTING'

export function createPrintRunner(options: PrintRunnerOptions): PrintRunner {
  const { adapter, render, clock, device } = options
  let state = setConnection(options.initialState ?? createPrintQueue(), isConnected(adapter))
  // 저장해 둔 상태에 출력 중인 작업이 있으면(앱이 출력 중에 닫혔다) 찍혔는지 모른다 — 대기 맨 앞으로 되돌린다
  if (state.jobs.some((job) => job.status === 'PRINTING')) state = setConnection(state, false)
  state = setConnection(state, isConnected(adapter))
  let running: Promise<void> | undefined

  const commit = (next: PrintQueueState): void => {
    if (next === state) return
    state = next
    options.onChange?.(state)
  }

  const drain = async (): Promise<void> => {
    for (;;) {
      const started = startNextJob(state)
      if (!started.job) return
      const job = started.job
      commit(started.state)
      let rendered: ReturnType<JobRenderer>
      try {
        rendered = render(job)
      } catch {
        rendered = { ok: false, error: { code: 'INVALID_DATA' } }
      }
      if (!rendered.ok) {
        commit(failJob(state, job.id, rendered.error.code))
        return
      }
      // 어댑터는 실패를 결과로 알린다. 그래도 예외가 나오면 프린터 오류로 멈춘다(작업은 대기 맨 앞에 남는다)
      const result = await adapter.print(rendered.image, options.density === undefined ? {} : { density: options.density }).catch(() => ({ ok: false as const, error: { code: 'PRINT_FAILED' } }))
      if (result.ok) commit(completeJob(state, job.id, { at: clock(), device }))
      else commit(failJob(state, job.id, result.error.code))
    }
  }

  /** 도는 중에 다시 불렸는지 — 돌던 것이 끝난 뒤 한 번 더 돈다(멈춤을 푼 직후 등의 알림을 놓치지 않게) */
  let again = false
  const pump = (): void => {
    if (running) {
      again = true
      return
    }
    again = false
    // drain은 다음 마이크로태스크에 시작한다 — 그 안에서 어댑터 알림이 pump를 다시 불러도 running이 이미 있다
    const current: Promise<void> = Promise.resolve()
      .then(drain)
      .finally(() => {
        if (running === current) running = undefined
        if (again) pump()
      })
    running = current
  }

  const unlisten = adapter.onStateChange((s) => {
    if (s === 'CONNECTING') return
    commit(setConnection(state, s === 'CONNECTED' || s === 'PRINTING'))
    pump()
  })

  const act = (next: PrintQueueState): void => {
    commit(next)
    pump()
  }

  // 이미 연결돼 있고 대기 작업이 있으면 바로 시작한다
  pump()

  return {
    get state() {
      return state
    },
    enqueue(job) {
      const update = enqueueJob(state, job, clock())
      act(update.state)
      return update
    },
    reprint(job) {
      const update = reprintLabel(state, job, clock())
      act(update.state)
      return update
    },
    cancel: (jobId) => act(cancelJob(state, jobId)),
    voidLabel: (labelKey) => act(voidLabel(state, labelKey)),
    pause: () => act(pauseQueue(state)),
    restart: () => act(resumeQueue(state)),
    async idle() {
      while (running) await running
    },
    dispose: () => unlisten(),
  }
}
