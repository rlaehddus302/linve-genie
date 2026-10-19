// 출력 대기열 순수 로직 (LABEL_RULES L-8·L-10, LBL-08·09·11, D-P1-09·10).
// 시각·난수를 읽지 않는다(시각·기기 이름은 부르는 쪽이 넣는다). 받은 상태를 바꾸지 않고 새 상태를 돌려준다.
// 상태는 JSON으로 저장하고 다시 읽을 수 있다(서버 기록은 I1).

export const QUEUE_FORMAT = 1 as const

export type JobKind = 'product' | 'packing' | 'test'
export type JobStatus = 'WAITING' | 'PRINTING' | 'DONE' | 'CANCELLED'

/** 화면 낱말 (AC-P1 F 절 머리말) */
export const JOB_STATUS_NAMES: Readonly<Record<JobStatus, string>> = {
  WAITING: '대기',
  PRINTING: '출력 중',
  DONE: '출력함',
  CANCELLED: '출력 안 함',
}
export const VOIDED_NAME = '폐기'
export const VOIDED_PRINTED_NAME = '폐기 — 버려 주세요'

/**
 * 멈춘 까닭: 끊김(다시 연결되면 이어서) · 프린터 오류(다시 시작으로만) · 판매자(다시 시작으로만)
 * · 라벨 오류(라벨을 그릴 수 없음 — 다시 시작으로만. L-8에 없는 까닭이라 dev-notes "스펙에 올린 것")
 */
export type PauseReason = 'DISCONNECTED' | 'PRINTER_ERROR' | 'SELLER' | 'LABEL_ERROR'

export const PAUSE_MESSAGES: Readonly<Record<PauseReason, string>> = {
  DISCONNECTED: '프린터 연결이 끊겼어요.',
  PRINTER_ERROR: '프린터 오류로 멈췄어요.',
  SELLER: '출력을 멈췄어요.',
  LABEL_ERROR: '라벨을 만들지 못해 멈췄어요. 라벨 설정을 확인한 뒤 다시 시작해 주세요.',
}

export interface PrintJob {
  /** 작업 ID (부르는 쪽이 정한다 — 자동 출력은 PRINT_PRODUCT_LABEL 효과 ID) */
  readonly id: string
  /** 같은 라벨의 출력·재출력을 묶는 키 (자동 출력은 찜과 확정버전) */
  readonly labelKey: string
  readonly kind: JobKind
  /** 라벨 데이터 (L-3·L-4, JSON) */
  readonly data: unknown
  /** 내용 키 (L-10 — @livejjim/label labelContentKey) */
  readonly contentKey: string
  readonly status: JobStatus
  /** 폐기 표시 (상태와 따로) */
  readonly voided: boolean
  /** 실패한 시도 수 (출력 중에 오류·끊김으로 끝날 때마다 +1) */
  readonly attempts: number
  /** 마지막 오류 코드 */
  readonly lastError: string | null
  /** 넣은 시각 (부르는 쪽이 넣은 값) */
  readonly addedAt: number
  /** 출력함이 된 시각·기기 */
  readonly printedAt: number | null
  readonly device: string | null
}

export interface PrintQueueState {
  readonly format: typeof QUEUE_FORMAT
  /** 프린터가 연결됐는지 (어댑터 상태에서 부르는 쪽이 알린다) */
  readonly connected: boolean
  readonly paused: PauseReason | null
  /** 넣은 순서 (재출력은 넣은 때 기준으로 맨 끝) */
  readonly jobs: readonly PrintJob[]
  /** 폐기한 라벨 키 (되돌리지 않는다) */
  readonly voidedLabels: readonly string[]
}

export interface NewJob {
  readonly id: string
  readonly labelKey: string
  readonly kind: JobKind
  readonly data: unknown
  readonly contentKey: string
}

export type QueueRefusal = 'DUPLICATE_JOB' | 'VOIDED' | 'IN_PROGRESS' | 'NOT_PRINTED'

export const REFUSAL_MESSAGES: Readonly<Record<QueueRefusal, string>> = {
  DUPLICATE_JOB: '이미 받은 출력 요청이에요.',
  VOIDED: '폐기한 라벨은 다시 출력할 수 없어요.',
  IN_PROGRESS: '이 라벨은 이미 출력을 기다리고 있어요.',
  NOT_PRINTED: '아직 출력한 적이 없는 라벨이에요.',
}

export type QueueUpdate =
  | { readonly accepted: true; readonly state: PrintQueueState }
  | { readonly accepted: false; readonly state: PrintQueueState; readonly reason: QueueRefusal; readonly message: string }

/** 빈 대기열. 아직 연결한 적이 없으면 멈춤이 아니다(연결되면 바로 출력한다) */
export function createPrintQueue(connected = false): PrintQueueState {
  return { format: QUEUE_FORMAT, connected, paused: null, jobs: [], voidedLabels: [] }
}

const refuse = (state: PrintQueueState, reason: QueueRefusal): QueueUpdate => ({ accepted: false, state, reason, message: REFUSAL_MESSAGES[reason] })

function newJob(input: NewJob, at: number, status: JobStatus, voided: boolean): PrintJob {
  return {
    id: input.id,
    labelKey: input.labelKey,
    kind: input.kind,
    data: input.data,
    contentKey: input.contentKey,
    status,
    voided,
    attempts: 0,
    lastError: null,
    addedAt: at,
    printedAt: null,
    device: null,
  }
}

const replaceJob = (state: PrintQueueState, id: string, update: (job: PrintJob) => PrintJob): PrintQueueState => ({
  ...state,
  jobs: state.jobs.map((job) => (job.id === id ? update(job) : job)),
})

/** 손으로 풀어야 하는 멈춤(프린터 오류·판매자·라벨 오류)인지 */
const manualPause = (paused: PauseReason | null): boolean => paused !== null && paused !== 'DISCONNECTED'

/**
 * 작업 넣기 (L-8 1). 같은 작업 ID를 다시 넣으면 아무 일도 없다 — 끝난 작업이어도 같다(R-13).
 * 폐기한 라벨 키의 작업은 출력하지 않고 출력 안 함 + 폐기로 기록만 남긴다(넣은 작업은 사라지지 않는다).
 */
export function enqueueJob(state: PrintQueueState, input: NewJob, at: number): QueueUpdate {
  if (state.jobs.some((job) => job.id === input.id)) return refuse(state, 'DUPLICATE_JOB')
  if (state.voidedLabels.includes(input.labelKey)) {
    return { accepted: false, state: { ...state, jobs: [...state.jobs, newJob(input, at, 'CANCELLED', true)] }, reason: 'VOIDED', message: REFUSAL_MESSAGES.VOIDED }
  }
  return { accepted: true, state: { ...state, jobs: [...state.jobs, newJob(input, at, 'WAITING', false)] } }
}

/** 출력 중인 작업 */
export function printingJob(state: PrintQueueState): PrintJob | undefined {
  return state.jobs.find((job) => job.status === 'PRINTING')
}

/**
 * 시작 조건 (L-8 2): 연결됨, 멈추지 않음, 출력 중인 작업 없음, 대기 작업 있음 → 가장 먼저 넣은 대기 작업을 출력 중으로.
 */
export function startNextJob(state: PrintQueueState): { readonly state: PrintQueueState; readonly job: PrintJob | null } {
  if (!state.connected || state.paused !== null || printingJob(state)) return { state, job: null }
  const next = state.jobs.find((job) => job.status === 'WAITING')
  if (!next) return { state, job: null }
  const started: PrintJob = { ...next, status: 'PRINTING' }
  return { state: replaceJob(state, next.id, () => started), job: started }
}

/** 출력 중이던 작업이 출력함이 된다 (시각·기기는 부르는 쪽이 넣는다). 출력 중이 아니면 아무 일도 없다 */
export function completeJob(state: PrintQueueState, jobId: string, done: { readonly at: number; readonly device: string }): PrintQueueState {
  const job = state.jobs.find((j) => j.id === jobId)
  if (job?.status !== 'PRINTING') return state
  return replaceJob(state, jobId, (j) => ({ ...j, status: 'DONE', printedAt: done.at, device: done.device }))
}

/** 오류 코드 → 멈춘 까닭 */
export function pauseReasonFor(errorCode: string): PauseReason {
  if (errorCode === 'DISCONNECTED' || errorCode === 'NOT_CONNECTED') return 'DISCONNECTED'
  if (errorCode === 'DOES_NOT_FIT' || errorCode === 'INVALID_DATA' || errorCode === 'INVALID_TEMPLATE') return 'LABEL_ERROR'
  return 'PRINTER_ERROR'
}

/** 출력 중이던 작업을 대기 맨 앞으로 되돌린다 (폐기됐으면 출력 안 함) */
function returnToQueue(job: PrintJob, errorCode: string): PrintJob {
  return { ...job, status: job.voided ? 'CANCELLED' : 'WAITING', attempts: job.attempts + 1, lastError: errorCode }
}

/**
 * 출력이 오류로 끝났다 (L-8 3): 대기열이 멈추고, 그 작업은 대기 맨 앞으로(사라지지 않는다) 시도 +1·마지막 오류.
 * 같은 작업을 저절로 되풀이하지 않는다. 끊김이면 다시 연결될 때 이어서, 그 밖은 판매자가 다시 시작해야 이어진다.
 */
export function failJob(state: PrintQueueState, jobId: string, errorCode: string): PrintQueueState {
  const job = state.jobs.find((j) => j.id === jobId)
  if (job?.status !== 'PRINTING') return state
  const reason = pauseReasonFor(errorCode)
  const next = replaceJob(state, jobId, (j) => returnToQueue(j, errorCode))
  if (reason === 'DISCONNECTED') return { ...next, connected: false, paused: manualPause(state.paused) ? state.paused : 'DISCONNECTED' }
  return { ...next, paused: reason }
}

/**
 * 프린터 연결 상태를 알린다. 끊기면 멈춤(끊김) — 대기 중이어도 같다. 출력 중이던 작업은 대기 맨 앞으로.
 * 다시 연결되면 끊김으로 멈춘 대기열만 이어서 출력한다.
 */
export function setConnection(state: PrintQueueState, connected: boolean): PrintQueueState {
  if (connected) {
    if (state.connected && state.paused !== 'DISCONNECTED') return state
    return { ...state, connected: true, paused: state.paused === 'DISCONNECTED' ? null : state.paused }
  }
  const printing = printingJob(state)
  const jobs = printing ? state.jobs.map((j) => (j.id === printing.id ? returnToQueue(j, 'DISCONNECTED') : j)) : state.jobs
  const paused = manualPause(state.paused) ? state.paused : 'DISCONNECTED'
  if (!state.connected && !printing && paused === state.paused) return state
  return { ...state, connected: false, paused, jobs }
}

/**
 * 출력 결과를 기다리는 동안 끊김 알림이 먼저 왔다 (실행기용 — 어댑터가 출력 결과보다 상태 알림을 먼저 낼 수 있다).
 * 연결 끊김·멈춤(끊김)만 기록하고 출력 중 작업은 그대로 둔다. 그 출력의 결과가 정한다:
 * 프린터가 끝났다고 알렸으면(라벨이 나옴) completeJob, 끝나기 전에 끊겼으면 failJob이 대기 맨 앞으로 되돌린다.
 * 그래서 이미 나온 라벨을 다시 연결한 뒤 또 찍지 않는다(L-8 1, D-P1-09 — 두 장을 받아들이는 것은 찍혔는지 모를 때뿐).
 */
export function disconnectWhilePrinting(state: PrintQueueState): PrintQueueState {
  const paused = manualPause(state.paused) ? state.paused : 'DISCONNECTED'
  if (!state.connected && paused === state.paused) return state
  return { ...state, connected: false, paused }
}

/** 판매자가 멈춘다 ("출력을 멈췄어요."). 출력 중인 한 장은 끝까지 나오고 다음 장을 시작하지 않는다 */
export function pauseQueue(state: PrintQueueState): PrintQueueState {
  if (state.paused === 'SELLER' || state.paused === 'PRINTER_ERROR' || state.paused === 'LABEL_ERROR') return state
  return { ...state, paused: 'SELLER' }
}

/** "다시 시작" — 연결돼 있으면 멈춤을 풀고, 끊겨 있으면 끊김 멈춤으로 바꾼다(다시 연결되면 이어서) */
export function resumeQueue(state: PrintQueueState): PrintQueueState {
  const paused = state.connected ? null : 'DISCONNECTED'
  return state.paused === paused ? state : { ...state, paused }
}

/**
 * 폐기 (L-8 4, 라벨 키 단위 — VOID_LABEL·승계·취소). 대기 작업은 출력 안 함 + 폐기, 출력 중 작업은 끝난 뒤 폐기 표시,
 * 출력한 작업은 폐기 표시("버려 주세요"). 되돌리지 않는다. 같은 키를 다시 폐기하면 아무 일도 없다.
 */
export function voidLabel(state: PrintQueueState, labelKey: string): PrintQueueState {
  if (state.voidedLabels.includes(labelKey)) return state
  return {
    ...state,
    voidedLabels: [...state.voidedLabels, labelKey],
    jobs: state.jobs.map((job) => {
      if (job.labelKey !== labelKey) return job
      return job.status === 'WAITING' ? { ...job, status: 'CANCELLED', voided: true } : { ...job, voided: true }
    }),
  }
}

/**
 * 재출력 (L-8 5, LBL-11): 출력함 또는 출력 안 함 상태이고 폐기되지 않은 라벨 키만. 새 작업 ID·지금의 라벨 데이터로 대기 맨 끝에.
 * 그 라벨 키의 작업이 대기·출력 중이거나 폐기됐으면 하지 않는다(이유를 돌려준다).
 */
export function reprintLabel(state: PrintQueueState, input: NewJob, at: number): QueueUpdate {
  if (state.jobs.some((job) => job.id === input.id)) return refuse(state, 'DUPLICATE_JOB')
  if (state.voidedLabels.includes(input.labelKey)) return refuse(state, 'VOIDED')
  const same = state.jobs.filter((job) => job.labelKey === input.labelKey)
  if (same.some((job) => job.status === 'WAITING' || job.status === 'PRINTING')) return refuse(state, 'IN_PROGRESS')
  if (same.length === 0) return refuse(state, 'NOT_PRINTED')
  return { accepted: true, state: { ...state, jobs: [...state.jobs, newJob(input, at, 'WAITING', false)] } }
}

/** 대기 작업 빼기 (L-8 6) → 출력 안 함, 기록은 남는다. 출력 중·출력함 작업은 뺄 수 없다(아무 일도 없음) */
export function cancelJob(state: PrintQueueState, jobId: string): PrintQueueState {
  const job = state.jobs.find((j) => j.id === jobId)
  if (job?.status !== 'WAITING') return state
  return replaceJob(state, jobId, (j) => ({ ...j, status: 'CANCELLED' }))
}

export interface LabelHistory {
  /** 출력 횟수 = 출력함이 된 작업 수 */
  readonly count: number
  /** 출력함이 된 시각 (출력한 순서) */
  readonly times: readonly number[]
  /** 그때마다의 기기 이름 */
  readonly devices: readonly string[]
  readonly voided: boolean
  /** 마지막으로 출력한 내용 키 */
  readonly lastContentKey: string | null
}

/** 라벨 키의 출력 이력 (L-8 7). 한 번에 하나씩 넣은 순서로 출력하므로 출력한 순서 = 작업 목록 순서다 */
export function labelHistory(state: PrintQueueState, labelKey: string): LabelHistory {
  const done = state.jobs.filter((job) => job.labelKey === labelKey && job.status === 'DONE')
  return {
    count: done.length,
    times: done.map((job) => job.printedAt ?? 0),
    devices: done.map((job) => job.device ?? ''),
    voided: state.voidedLabels.includes(labelKey),
    lastContentKey: done.at(-1)?.contentKey ?? null,
  }
}

/** 재출력 필요 (L-10): 마지막으로 출력한 내용 키와 지금 데이터의 내용 키가 다르면. 출력한 적이 없으면 아니다 */
export function needsReprint(state: PrintQueueState, labelKey: string, currentContentKey: string): boolean {
  const last = labelHistory(state, labelKey).lastContentKey
  return last !== null && last !== currentContentKey
}

/** 작업의 화면 낱말 (폐기 표시 포함) */
export function jobStatusText(job: PrintJob): string {
  if (!job.voided) return JOB_STATUS_NAMES[job.status]
  return job.status === 'DONE' ? VOIDED_PRINTED_NAME : VOIDED_NAME
}

/** 멈춘 까닭 문장 (멈추지 않았으면 null) */
export function pauseMessage(state: PrintQueueState): string | null {
  return state.paused === null ? null : PAUSE_MESSAGES[state.paused]
}
