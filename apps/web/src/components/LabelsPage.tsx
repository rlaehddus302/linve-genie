// 라벨 화면 `/labels` (SPEC §7 화면 7, LBL-03~08·10, UX-02의 프린터 단계, AC-I1-20~27·40~42·50·62, AC-N4a-13·16·18·21).
// 프린터(연결 마법사·테스트 인쇄·농도·출력 기기), 출력 대기열(멈춤 띠·빼기), 버릴 라벨, 출력 이력, 라벨 설정(상품·포장·자동 출력), 내보내기(A4 PDF·그림 파일).
// - 라벨 기능이 꺼져 있으면(L-13 9) 제목 "라벨"과 "라벨 쓰지 않음 — 설정에서 켤 수 있어요."·"설정" 링크만 — 버릴 라벨이 있으면 그 절만 남는다.
//   켬/끔을 아직 모르는 동안(불러오는 중·불러오지 못함)은 라벨 조작을 하나도 보이지 않는다(AC-N4a-18).
// - 주 버튼(.button-primary)은 창 밖에 많아야 하나 — 지금 할 일 (UX-01, D-N4a-06, AC-N4a-21): 이 기기에서 누를 수 있는 멈춤 띠의 조치가 먼저,
//   아니면 프린터 단계의 다음 할 일(연결 전: 첫 연결 방법 → 연결 뒤: 테스트 인쇄 → 테스트 결과 "예" 뒤: 이 기기에서 출력). 이 기기가 이미 출력 기기면
//   프린터 단계에 주 버튼이 없다. "버렸어요"·"라벨 설정 저장"은 이 화면에서 늘 보통 버튼이다(알림 창의 "버렸어요"는 그대로 주 버튼).
import { a4Layout, type LabelBitmap } from '@livejjim/label'
import { CONNECTION_STATE_NAMES, PRINTER_MESSAGES, RECONNECT_ACTION, type PrinterError } from '@livejjim/printer'
import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import { get, isApiError, patch, type ApiError } from '../api/client.ts'
import type { LabelView, QueueSummary } from '../api/print-types.ts'
import type { BroadcastItem, FullView } from '../api/types.ts'
import { DENSITY_MAX, DENSITY_MIN, cleanDeviceName, savedDeviceName } from '../lib/device.ts'
import { dateWords, kstToday } from '../lib/kst.ts'
import { labelEnv } from '../lib/label-env.ts'
import { canShareFile, downloadBytes, shareBytes } from '../lib/label-files.ts'
import { a4PdfBytes, broadcastA4Name, labelErrorMessage, pngBytes, productPngName, renderJob, renderProduct, waitingA4Name } from '../lib/label-render.ts'
import { KEEP_SCREEN_ON, PRINT_ACTION, SETTING_NEXT_BROADCAST, TEST_QUESTION, buyerWord, deviceLostMessage, deviceWord, historyWord, replaceQuestion } from '../lib/print-words.ts'
import type { PrinterMethod } from '../lib/printer-station.ts'
import type { Navigate } from '../lib/router.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { LabelSettings } from './LabelSettings.tsx'
import { LabelsOffNote } from './LabelsOff.tsx'
import { Modal } from './Modal.tsx'
import { DiscardList, PausePanel, QueueList, usePrintAction } from './PrintParts.tsx'
import { FONT_ERROR, useLabelsEnabled, usePrintApi, usePrintState, useScopeLabels, useStationState } from './print-context.tsx'

/** 연결 방법 단추 글 (AC-I1-21) */
export const METHOD_WORD: Readonly<Record<PrinterMethod, string>> = {
  bluetooth: '블루투스로 연결',
  serial: 'USB 선으로 연결',
  test: '시험용 프린터 — 실제로 출력되지 않아요',
}

export const TEST_HELP: readonly string[] = [
  '라벨 크기가 50×30mm인지 확인해 주세요.',
  '인쇄 농도를 한 단계 올려 보세요.',
  'NIIMBOT 정품 라벨인지 확인해 주세요.',
  '맨 아래 테두리가 빠지면 알려 주세요.',
]

const EXPORT_ID = 'label-export'
const PRINTER_ID = 'label-printer'

/**
 * 이 기기에서 누를 수 있는 멈춤 띠의 조치가 보이는가 (AC-N4a-21 우선순위 1): 손으로 푸는 멈춤·쌓인 라벨이면 "다시 시작"·"출력 시작",
 * 끊김 멈춤이면 출력 기기에서만 "다시 연결"(다른 기기는 문장뿐)
 */
export function pauseActionHere(queue: QueueSummary | null, mine: boolean): boolean {
  if (queue === null || queue.pause === null) return false
  return queue.pause.reason !== 'DISCONNECTED' || mine
}

export function LabelsPage({ navigate }: { readonly navigate?: Navigate }) {
  const labels = useLabelsEnabled()
  if (labels !== true) {
    return (
      <main className="page page-wide labels-page">
        <h1>라벨</h1>
        {labels === false ? <LabelsOffBody {...(navigate === undefined ? {} : { navigate })} /> : <LabelsUnknown />}
      </main>
    )
  }
  return <LabelsOnPage />
}

/** 켬/끔을 아직 모른다: 라벨 조작 없이 기다린다 (불러오지 못했으면 다시 시도) */
function LabelsUnknown() {
  const api = usePrintApi()
  const print = usePrintState()
  if (print.phase === 'error' && print.error !== null) return <ErrorNote error={print.error} onRetry={() => void api?.store.reload()} retryLabel="다시 시도" />
  return <p role="status">불러오는 중…</p>
}

/** 꺼져 있다 (AC-N4a-13·16): 안내와 "설정" 링크, 버릴 라벨이 있으면 그 절 */
function LabelsOffBody({ navigate }: { readonly navigate?: Navigate }) {
  const discardId = useId()
  const print = usePrintState()
  const discard = print.overview?.discard ?? []
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (navigate === undefined || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate({ name: 'settings' })
  }
  return (
    <>
      <LabelsOffNote onSettings={open} />
      {discard.length > 0 ? (
        <section className="card stack" aria-labelledby={discardId}>
          <h2 id={discardId} className="section-title">
            버릴 라벨
          </h2>
          <DiscardList />
        </section>
      ) : null}
    </>
  )
}

function LabelsOnPage() {
  const ids = { queue: useId(), discard: useId(), history: useId(), settings: useId() }
  const api = usePrintApi()
  const print = usePrintState()
  const queue = print.overview?.queue ?? null
  const mine = api?.station.isMine(queue) ?? false
  // 멈춤 띠의 조치가 보이면 그것이 주 버튼 — 프린터 단계는 모두 보통 버튼 (AC-N4a-21)
  const stepPrimary = !pauseActionHere(queue, mine)
  return (
    <main className="page page-wide labels-page">
      <h1>라벨</h1>
      <PrinterSection stepPrimary={stepPrimary} />
      <section className="card stack" aria-labelledby={ids.queue}>
        <h2 id={ids.queue} className="section-title">
          출력 대기열
        </h2>
        <PausePanel onReconnectHelp={() => document.getElementById(PRINTER_ID)?.scrollIntoView({ block: 'start' })} />
        <QueueControls />
        <QueueList />
      </section>
      <section className="card stack" aria-labelledby={ids.discard}>
        <h2 id={ids.discard} className="section-title">
          버릴 라벨
        </h2>
        <DiscardList />
      </section>
      <HistorySection titleId={ids.history} />
      <section className="card stack" aria-labelledby={ids.settings}>
        <h2 id={ids.settings} className="section-title">
          라벨 설정
        </h2>
        <AutoPrintSetting />
        <LabelSettings />
      </section>
      <ExportSection />
    </main>
  )
}

// ── 프린터 (AC-I1-21~23·50) ────────────────────────────────────────────────

function PrinterErrorView({ error, onRetry }: { readonly error: PrinterError; readonly onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <p>{error.message}</p>
      {onRetry !== undefined ? (
        <button type="button" className="button" onClick={onRetry}>
          {error.action ?? RECONNECT_ACTION}
        </button>
      ) : null}
      {error.detail !== undefined ? (
        <details className="details">
          <summary>자세히</summary>
          <p>{error.detail}</p>
        </details>
      ) : null}
    </div>
  )
}

/**
 * 프린터 칸: 연결 마법사(연결 방법 → 프린터 고르기 → 연결됨 → 테스트 인쇄 → "이 기기에서 출력"), 출력 기기 표시.
 * 시작 마법사 4단계(UX-02, D-I1-06·D-I3-01)도 이 칸을 그대로 끼운다 — 그때(inWizard)는 제목이 단계 제목 아래(h3)이고,
 * 이 브라우저가 연결할 수 없으면 안내만 보인다(그림 파일 저장은 라벨 화면의 내보내기에 있다).
 * stepPrimary: 이 단계가 주 버튼을 가질 수 있나 — 라벨 화면에서 멈춤 띠의 조치가 보이면 아니다 (AC-N4a-21)
 */
export function PrinterSection({ inWizard = false, stepPrimary = true }: { readonly inWizard?: boolean; readonly stepPrimary?: boolean }) {
  const titleId = useId()
  const api = usePrintApi()
  const print = usePrintState()
  const station = useStationState()
  /** 테스트 결과 "또렷하게 보이나요?"의 답 — "예" 뒤에는 "이 기기에서 출력"이 다음 할 일이다 */
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null)
  // 연결이 끊기면 테스트 결과의 답도 지난 일이다 (다시 연결한 직후의 다음 할 일은 테스트 인쇄)
  const linked = station?.connection === 'CONNECTED' || station?.connection === 'PRINTING'
  useEffect(() => {
    if (!linked) setAnswer(null)
  }, [linked])
  const Title = inWizard ? 'h3' : 'h2'
  if (api === null || station === null) {
    return (
      <section id={PRINTER_ID} className="card stack" aria-labelledby={titleId}>
        <Title id={titleId} className="section-title">
          프린터
        </Title>
        <p role="status">불러오는 중…</p>
      </section>
    )
  }
  const testMode = print.config?.testPrinter === true
  const methods: PrinterMethod[] = [...station.methods, ...(testMode ? (['test'] as const) : [])]
  const queue = print.overview?.queue ?? null
  const mine = api.station.isMine(queue)
  const connected = station.connection === 'CONNECTED' || station.connection === 'PRINTING'
  const unsupported = methods.length === 0
  const connect = (method: PrinterMethod) => void api.station.connect(method)
  const lastMethod = station.method
  // 이 기기가 이미 출력 기기면 프린터 단계에 주 버튼이 없다 (AC-N4a-21)
  const primary = stepPrimary && !mine
  const testAnswered = answer === 'yes' && station.testPrinted
  return (
    <section id={PRINTER_ID} className="card stack" aria-labelledby={titleId}>
      <Title id={titleId} className="section-title">
        프린터
      </Title>
      <DeviceStatus />
      {unsupported ? (
        <div className="notice stack-tight" role="note">
          <p>{PRINTER_MESSAGES.UNSUPPORTED}</p>
          <p>이 기기는 출력 기기가 될 수 없어요.</p>
          {inWizard ? null : (
            <a className="button" href={`#${EXPORT_ID}`}>
              그림 파일로 저장하기
            </a>
          )}
        </div>
      ) : (
        <>
          <p>
            이 기기의 프린터: <strong>{CONNECTION_STATE_NAMES[station.connection]}</strong>
            {connected && lastMethod !== null ? ` (${lastMethod === 'test' ? '시험용 프린터' : lastMethod === 'bluetooth' ? '블루투스' : 'USB 선'})` : ''}
          </p>
          {!connected ? (
            <div className="row" role="group" aria-label="연결 방법">
              {methods.map((method) => (
                <button key={method} type="button" className={primary && method === methods[0] ? 'button button-primary' : 'button'} disabled={station.connecting} onClick={() => connect(method)}>
                  {METHOD_WORD[method]}
                </button>
              ))}
            </div>
          ) : null}
          {station.connecting ? (
            <p role="status">{lastMethod === 'test' ? '연결하는 중…' : '연결하는 중… 브라우저 창에서 프린터(B1)를 골라 주세요.'}</p>
          ) : null}
          {station.connectError !== null && !connected ? <PrinterErrorView error={station.connectError} {...(lastMethod !== null && methods.includes(lastMethod) ? { onRetry: () => connect(lastMethod) } : {})} /> : null}
          {connected ? <ConnectedPrinter answer={answer} onAnswer={setAnswer} primary={primary && !testAnswered} /> : null}
          {connected && !mine ? <BecomeDevice primary={primary && testAnswered} /> : null}
          {testMode ? <TestHandlePanel /> : null}
        </>
      )}
    </section>
  )
}

/** 출력 기기 표시 (AC-I1-23): 이 기기면 화면 꺼짐 막기, 다른 기기면 "출력 기기: <이름> · 연결됨/끊김" */
function DeviceStatus() {
  const api = usePrintApi()
  const print = usePrintState()
  const station = useStationState()
  const action = usePrintAction()
  const queue = print.overview?.queue ?? null
  if (api === null || queue === null) return null
  const device = queue.device
  if (device === null) return <p>출력 기기 없음</p>
  const mine = api.station.isMine(queue)
  return (
    <div className="stack-tight device-status">
      {mine ? (
        <>
          <p>
            <strong>이 기기가 출력 기기예요</strong> · {device.name}
          </p>
          {station?.wake === 'unsupported' ? (
            <p className="warning" role="note">
              {KEEP_SCREEN_ON}
            </p>
          ) : station?.wake === 'on' ? (
            <p className="hint">출력하는 동안 화면이 꺼지지 않게 해 두었어요.</p>
          ) : null}
        </>
      ) : (
        <>
          <p>{deviceWord(queue)}</p>
          {!device.live ? <p className="warning">{deviceLostMessage(device.name)}</p> : null}
        </>
      )}
      {device.releasing ? <p className="hint">지금 출력 중인 라벨이 끝나면 출력 기기를 내려놓아요.</p> : null}
      <div className="row">
        <button type="button" className="button" disabled={action.busy || device.releasing} onClick={() => void action.run('/api/print/device/release')}>
          {PRINT_ACTION.release}
        </button>
      </div>
      {action.error !== null ? <ErrorNote error={action.error} /> : null}
    </div>
  )
}

interface ConnectedPrinterProps {
  readonly answer: 'yes' | 'no' | null
  readonly onAnswer: (answer: 'yes' | 'no' | null) => void
  /** "테스트 인쇄"가 지금 할 일 (주 버튼) */
  readonly primary: boolean
}

/** 연결된 프린터: 테스트 인쇄·결과 확인·농도·연결 끊기 (AC-I1-22) */
function ConnectedPrinter({ answer, onAnswer: setAnswer, primary }: ConnectedPrinterProps) {
  const api = usePrintApi()
  const print = usePrintState()
  const station = useStationState()
  const densityId = useId()
  if (api === null || station === null) return null
  const busy = station.busy || station.job !== null || station.connection === 'PRINTING'
  const product = print.templates?.product.template
  const test = () => {
    setAnswer(null)
    void api.station.testPrint({ shopName: product?.shopName ?? '', size: product?.size ?? '50x30' })
  }
  return (
    <div className="stack-tight">
      <div className="row">
        <button type="button" className={primary ? 'button button-primary' : 'button'} disabled={busy || station.testing} aria-describedby={busy ? 'test-busy' : undefined} onClick={test}>
          {station.testing ? '테스트 인쇄 중…' : '테스트 인쇄'}
        </button>
        <button type="button" className="button" onClick={() => void api.station.disconnect()}>
          연결 끊기
        </button>
      </div>
      {busy ? (
        <p className="hint" id="test-busy">
          {PRINTER_MESSAGES.BUSY}
        </p>
      ) : null}
      {station.testError !== null ? (
        <p className="field-error" role="alert">
          {station.testError}
        </p>
      ) : null}
      {station.testPrinted ? (
        <div className="notice stack-tight" role="group" aria-label="테스트 인쇄 결과">
          <p>{TEST_QUESTION}</p>
          <div className="row">
            <button type="button" className="button" aria-pressed={answer === 'yes'} onClick={() => setAnswer('yes')}>
              예
            </button>
            <button type="button" className="button" aria-pressed={answer === 'no'} onClick={() => setAnswer('no')}>
              아니요
            </button>
          </div>
          {answer === 'yes' ? <p role="status">좋아요. 이 기기에서 출력하려면 "{PRINT_ACTION.thisDevice}"를 눌러 주세요.</p> : null}
          {answer === 'no' ? (
            <ul className="plain-list" aria-label="테스트 인쇄 도움말">
              {TEST_HELP.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={densityId}>인쇄 농도</label>
        <select id={densityId} className="input input-short" value={station.density} onChange={(event) => api.station.setDensity(Number(event.target.value))}>
          {Array.from({ length: DENSITY_MAX - DENSITY_MIN + 1 }, (_, i) => DENSITY_MIN + i).map((value) => (
            <option key={value} value={value}>
              {value}
              {value === 3 ? ' (기본)' : ''}
            </option>
          ))}
        </select>
        <p className="hint">흐리게 찍히면 한 단계 올려 주세요. 이 기기에 남아요.</p>
      </div>
    </div>
  )
}

/** "이 기기에서 출력" (기기 이름 칸, 다른 기기가 출력 기기면 바꿀지 묻는다 — 처음 포커스 "닫기", 1 = 바꾸기). primary: 지금 할 일(테스트 결과 "예" 뒤) */
function BecomeDevice({ primary }: { readonly primary: boolean }) {
  const api = usePrintApi()
  const print = usePrintState()
  const nameId = useId()
  const [name, setName] = useState(savedDeviceName)
  const [nameError, setNameError] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState(false)
  if (api === null) return null
  const queue = print.overview?.queue ?? null
  const become = async (replace: boolean) => {
    const cleaned = cleanDeviceName(name)
    if (cleaned === null) {
      setNameError('기기 이름은 1~20자로 적어 주세요.')
      return
    }
    setNameError(null)
    if (!replace && queue?.device != null && queue.device.id !== api.station.deviceId) {
      setAsking(queue.device.name)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const outcome = await api.station.become(cleaned, replace)
      if (outcome.kind === 'taken') setAsking(outcome.name)
      else if (outcome.kind === 'error') setError(outcome.error)
      else {
        setAsking(null)
        setDone(true)
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack-tight become-device">
      <div className="field">
        <label htmlFor={nameId}>기기 이름</label>
        <input id={nameId} className="input" autoComplete="off" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} aria-invalid={nameError !== null} />
        {nameError !== null ? (
          <p className="field-error" role="alert">
            {nameError}
          </p>
        ) : null}
      </div>
      <div className="row">
        <button type="button" className={primary ? 'button button-primary' : 'button'} disabled={busy} onClick={() => void become(false)}>
          {PRINT_ACTION.thisDevice}
        </button>
      </div>
      {done ? <p role="status">이 기기에서 출력해요.</p> : null}
      {error !== null ? <ErrorNote error={error} /> : null}
      {asking !== null ? (
        <Modal
          title="출력 기기 바꾸기"
          onClose={() => setAsking(null)}
          actions={
            <button type="button" className="button button-primary" data-key="1" disabled={busy} onClick={() => void become(true)}>
              1 바꾸기
            </button>
          }
        >
          <p>{replaceQuestion(asking)}</p>
        </Modal>
      ) : null}
    </div>
  )
}

/** 시험용 프린터 조작 (시험 모드에서만, AC-I1-50) */
function TestHandlePanel() {
  const station = useStationState()
  const [count, setCount] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setCount(window.livejjimTestPrinter?.printedCount() ?? 0), 500)
    return () => clearInterval(timer)
  }, [])
  return (
    <details className="details test-printer">
      <summary>시험용 프린터 조작</summary>
      <p>
        시험용 프린터가 받은 그림 <span data-testid="test-printer-count">{count}</span>장
      </p>
      <button type="button" className="button" disabled={station?.method !== 'test'} onClick={() => window.livejjimTestPrinter?.simulateDisconnect()}>
        연결 끊김 흉내
      </button>
    </details>
  )
}

// ── 출력 대기열 조작 ───────────────────────────────────────────────────────

function QueueControls() {
  const print = usePrintState()
  const action = usePrintAction()
  const queue = print.overview?.queue ?? null
  if (queue === null || queue.pause !== null) return null
  return (
    <div className="stack-tight">
      <div className="row">
        <button type="button" className="button" disabled={action.busy} onClick={() => void action.run('/api/print/pause')}>
          {PRINT_ACTION.pause}
        </button>
      </div>
      {action.error !== null ? <ErrorNote error={action.error} /> : null}
    </div>
  )
}

// ── 출력 이력 (AC-I1-24) ──────────────────────────────────────────────────

interface Day {
  readonly date: string
}

function useRealDays(): { readonly days: readonly string[] | null; readonly error: ApiError | null } {
  const [state, setState] = useState<{ days: readonly string[] | null; error: ApiError | null }>({ days: null, error: null })
  useEffect(() => {
    let alive = true
    get<{ days: Day[] }>('/api/days').then(
      (result) => {
        if (alive) setState({ days: result.days.map((day) => day.date).sort().reverse(), error: null })
      },
      (error: unknown) => {
        if (alive && isApiError(error)) setState({ days: null, error })
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return state
}

function defaultDay(days: readonly string[]): string | null {
  const today = kstToday()
  return days.includes(today) ? today : (days[0] ?? null)
}

function HistorySection({ titleId }: { readonly titleId: string }) {
  const { days, error } = useRealDays()
  const [picked, setPicked] = useState<string | null>(null)
  const date = picked ?? (days === null ? null : defaultDay(days))
  const labels = useScopeLabels(date)
  const selectId = useId()
  const printed = useMemo(() => [...labels.labels.values()].filter((label) => label.printed > 0), [labels.labels])
  return (
    <section className="card stack" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        출력 이력
      </h2>
      {error !== null ? <ErrorNote error={error} /> : null}
      {days !== null && days.length === 0 ? <p>아직 판매 기록이 없어요.</p> : null}
      {days !== null && days.length > 0 && date !== null ? (
        <div className="field">
          <label htmlFor={selectId}>날짜</label>
          <select id={selectId} className="input" value={date} onChange={(event) => setPicked(event.target.value)}>
            {days.map((day) => (
              <option key={day} value={day}>
                {dateWords(day)} ({day})
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {labels.phase === 'ready' && printed.length === 0 ? <p>그날 출력한 라벨이 없어요.</p> : null}
      {labels.phase === 'error' && labels.error !== null ? <ErrorNote error={labels.error} /> : null}
      <ul className="plain-list job-list" aria-label="출력 이력 목록">
        {printed.map((label) => (
          <li key={label.key} className="job-row">
            <p className="job-main">
              <strong>{label.kind === 'packing' ? '포장' : `${String(label.no ?? '')}번`}</strong> · {buyerWord(label.buyer)} <span className="tag">{label.word}</span>
            </p>
            <p>{historyWord(label)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── 자동 출력 설정 (AC-I1-27) ─────────────────────────────────────────────

function AutoPrintSetting() {
  const [value, setValue] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [live, setLive] = useState<{ title: string; on: boolean }[]>([])
  const inputId = useId()
  useEffect(() => {
    let alive = true
    get<{ settings: Record<string, unknown> }>('/api/settings').then(
      (result) => {
        if (alive) setValue(result.settings['print.autoOnConfirm'] === true)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    // 지금 진행 중인 실제 방송의 값 (방송 시작 때 스냅샷, D-070)
    void (async () => {
      try {
        const { broadcasts } = await get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')
        const running = broadcasts.filter((item) => !item.rehearsal && !item.ended)
        const out: { title: string; on: boolean }[] = []
        for (const date of new Set(running.map((item) => item.date))) {
          const view = await get<FullView>(`/api/days/${date}`)
          for (const item of running.filter((b) => b.date === date)) {
            const settings = view.broadcasts.find((b) => b.id === item.id)?.settings
            if (settings !== undefined) out.push({ title: item.title, on: settings['print.autoOnConfirm'] })
          }
        }
        if (alive) setLive(out)
      } catch {
        // 지금 방송 값은 보이지 않는다
      }
    })()
    return () => {
      alive = false
    }
  }, [])
  const change = async (next: boolean) => {
    const previous = value
    // 누르면 바로 바뀐 것으로 보인다 — 저장하지 못하면 되돌린다
    setValue(next)
    setBusy(true)
    setError(null)
    try {
      const result = await patch<{ settings: Record<string, unknown> }>('/api/settings', { settings: { 'print.autoOnConfirm': next } })
      setValue(result.settings['print.autoOnConfirm'] === true)
      setNote(true)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setValue(previous)
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack-tight auto-print">
      <label className="choice" htmlFor={inputId}>
        <input id={inputId} type="checkbox" checked={value === true} disabled={value === null || busy} onChange={(event) => void change(event.target.checked)} />
        <span>1등 확정 때 라벨 자동 출력</span>
      </label>
      {note ? <p role="status">{SETTING_NEXT_BROADCAST}</p> : null}
      {live.map((item, index) => (
        <p key={`${item.title}-${String(index)}`}>
          지금 방송: 자동 출력 {item.on ? '켜짐' : '꺼짐'}
          {live.length > 1 ? ` (${item.title})` : ''}
        </p>
      ))}
      {error !== null ? <ErrorNote error={error} /> : null}
    </div>
  )
}

// ── 내보내기 (AC-I1-21·40·41·42) ──────────────────────────────────────────

function useBroadcasts(): BroadcastItem[] | null {
  const [list, setList] = useState<BroadcastItem[] | null>(null)
  useEffect(() => {
    let alive = true
    get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts').then(
      (result) => {
        if (alive) setList(result.broadcasts.filter((item) => !item.rehearsal))
      },
      () => {
        if (alive) setList([])
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return list
}

/** 그날 실제 방송 중 몇 번째인지 (1부터, 선언 순서) */
function broadcastOrder(list: readonly BroadcastItem[], item: BroadcastItem): number {
  return list.filter((b) => b.date === item.date).findIndex((b) => b.id === item.id) + 1
}

function ExportSection() {
  const titleId = useId()
  const selectId = useId()
  const print = usePrintState()
  const station = useStationState()
  const broadcasts = useBroadcasts()
  const [picked, setPicked] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shareRef = useRef<boolean | null>(null)
  shareRef.current ??= canShareFile()
  const chosen = broadcasts === null ? null : (broadcasts.find((item) => item.id === picked) ?? broadcasts.at(-1) ?? null)
  const labels = useScopeLabels(chosen?.date ?? null)
  const winners = useMemo(
    () =>
      chosen === null
        ? []
        : [...labels.labels.values()]
            .filter((label): label is LabelView & { data: NonNullable<LabelView['data']> } => label.kind === 'product' && label.broadcast === chosen.id && label.winner && !label.voided && label.data !== null)
            .sort((a, b) => (a.no ?? 0) - (b.no ?? 0)),
    [labels.labels, chosen],
  )
  const product = print.templates?.product.template
  const waiting = (print.overview?.jobs ?? []).filter((job) => job.status === 'WAITING' && job.data !== null)
  const perPage = a4Layout(product?.size ?? '50x30').perPage

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true)
    setMessage(null)
    try {
      setMessage(await work())
    } catch (error) {
      setMessage(isApiError(error) ? error.message : FONT_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const exportBroadcast = () =>
    run(async () => {
      if (chosen === null || product === undefined) return null
      const env = await labelEnv()
      // 지금 1등을 새로 받는다 (채팅으로 생긴 1등은 라벨 상태 알림이 없을 수 있다)
      const fresh = await get<{ labels: LabelView[] }>(`/api/print/labels?date=${chosen.date}`)
      const list = fresh.labels.filter((label) => label.kind === 'product' && label.broadcast === chosen.id && label.winner && !label.voided && label.data !== null).sort((a, b) => (a.no ?? 0) - (b.no ?? 0))
      if (list.length === 0) return '1등 라벨이 없어요.'
      const images: LabelBitmap[] = []
      for (const label of list) {
        const rendered = renderProduct(env, product, label.data as Parameters<typeof renderProduct>[2])
        if (!rendered.ok) return labelErrorMessage(rendered.error)
        images.push(rendered.image)
      }
      const pdf = a4PdfBytes(images)
      if (!pdf.ok) return pdf.message
      downloadBytes(pdf.bytes, broadcastA4Name(chosen.date, broadcastOrder(broadcasts ?? [], chosen)), 'application/pdf')
      return null
    })

  const exportWaiting = () =>
    run(async () => {
      const templates = print.templates
      if (templates === null) return null
      const env = await labelEnv()
      const images: LabelBitmap[] = []
      for (const job of waiting) {
        if (job.data === null) continue
        const template = job.kind === 'product' ? templates.product.template : templates.packing.template
        const rendered = renderJob(env, { kind: job.kind, template, data: job.data, page: job.page })
        if (!rendered.ok) return labelErrorMessage(rendered.error)
        images.push(rendered.image)
      }
      const pdf = a4PdfBytes(images)
      if (!pdf.ok) return pdf.message
      downloadBytes(pdf.bytes, waitingA4Name(kstToday()), 'application/pdf')
      return null
    })

  const savePng = (label: LabelView, share: boolean) =>
    run(async () => {
      if (product === undefined || label.data === null || label.no === null) return null
      const env = await labelEnv()
      const rendered = renderProduct(env, product, label.data as Parameters<typeof renderProduct>[2])
      if (!rendered.ok) return labelErrorMessage(rendered.error)
      const png = pngBytes(rendered.image)
      if (!png.ok) return png.message
      const name = productPngName(label.date, label.no)
      if (share) await shareBytes(png.bytes, name, 'image/png')
      else downloadBytes(png.bytes, name, 'image/png')
      return null
    })

  const noMethods = station !== null && station.methods.length === 0 && print.config?.testPrinter !== true
  return (
    <section id={EXPORT_ID} className="card stack" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        내보내기
      </h2>
      <p className="hint">
        PDF는 A4 한 장에 {perPage}개씩 모아 찍어요(실제 크기 100%로 인쇄). 파일로 저장해도 출력한 것으로 치지 않아요.
      </p>
      {broadcasts !== null && broadcasts.length === 0 ? <p>아직 실제 방송이 없어요.</p> : null}
      {broadcasts !== null && broadcasts.length > 0 && chosen !== null ? (
        <div className="stack-tight">
          <div className="field">
            <label htmlFor={selectId}>방송</label>
            <select id={selectId} className="input" value={chosen.id} onChange={(event) => setPicked(event.target.value)}>
              {broadcasts.map((item) => (
                <option key={item.id} value={item.id}>
                  {dateWords(item.date)} {item.title}
                </option>
              ))}
            </select>
          </div>
          <p>지금 1등 라벨 {winners.length}장</p>
          <div className="row">
            <button type="button" className="button" disabled={busy || winners.length === 0 || product === undefined} onClick={() => void exportBroadcast()}>
              1등 라벨 모두 A4 PDF로 저장
            </button>
          </div>
          <details className="details" open={noMethods}>
            <summary>라벨마다 그림 파일로 저장</summary>
            {winners.length === 0 ? <p>1등 라벨이 없어요.</p> : null}
            <ul className="plain-list job-list" aria-label="그림 파일로 저장할 라벨">
              {winners.map((label) => (
                <li key={label.key} className="job-row">
                  <p className="job-main">
                    <strong>{label.no}번</strong> · {buyerWord(label.buyer)}
                  </p>
                  <div className="row">
                    <button type="button" className="button button-small" disabled={busy} onClick={() => void savePng(label, false)}>
                      그림 파일로 저장
                    </button>
                    {shareRef.current === true ? (
                      <button type="button" className="button button-small" disabled={busy} onClick={() => void savePng(label, true)}>
                        공유
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
      <div className="stack-tight">
        <p>대기 중인 라벨 {waiting.length}장</p>
        <div className="row">
          <button type="button" className="button" disabled={busy || waiting.length === 0 || print.templates === null} onClick={() => void exportWaiting()}>
            대기 중인 라벨 모두 A4 PDF로 저장
          </button>
        </div>
      </div>
      {message !== null ? (
        <p className="field-error" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  )
}
