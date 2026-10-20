// 출력 대기열의 부분 (LBL-06 AC2, LBL-08, LBL-11, L-8, L-11, D-I1-03·08, AC-I1-24·32·62): 멈춤 띠·대기 작업·버릴 라벨.
// 라벨 화면과 콘솔 알림 창이 같은 부분을 쓴다. 조치(다시 시작·출력 시작·빼기·버렸어요)는 엔진 기록이 아니어서 5초 대기 없이 바로 보낸다.
import { useState } from 'react'
import { ApiError, isApiError } from '../api/client.ts'
import type { JobView } from '../api/print-types.ts'
import { kstHm } from '../lib/kst.ts'
import {
  KIND_WORD,
  PRINT_ACTION,
  REASON_WORD,
  backlogMessage,
  buyerWord,
  discardWord,
  jobNameWord,
  jobNumberWord,
  printErrorMessage,
  reconnectThereMessage,
} from '../lib/print-words.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { LabelsOffNote } from './LabelsOff.tsx'
import { Modal } from './Modal.tsx'
import { useLabelsEnabled, usePrintApi, usePrintState, useStationState } from './print-context.tsx'

/** 서버 거절 문장 (끊김 멈춤의 "다시 시작"은 출력 기기 이름을 넣는다) */
function actionError(error: ApiError): ApiError {
  if (error.code !== 'PRINT_RECONNECT_REQUIRED') return error
  const device = error.details['device'] as { name?: unknown } | undefined
  const name = typeof device?.name === 'string' ? device.name : ''
  return new ApiError({ status: error.status, code: error.code, message: reconnectThereMessage(name), problems: error.problems, details: error.details })
}

/** 바로 보내는 출력 조치 하나 */
export function usePrintAction(): { readonly busy: boolean; readonly error: ApiError | null; run: (path: string, body?: Record<string, unknown>) => Promise<boolean>; clear: () => void } {
  const api = usePrintApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  return {
    busy,
    error,
    clear: () => setError(null),
    run: async (path, body = {}) => {
      if (api === null || busy) return false
      setBusy(true)
      setError(null)
      try {
        await api.store.act(path, body)
        return true
      } catch (caught) {
        if (!isApiError(caught)) throw caught
        setError(actionError(caught))
        return false
      } finally {
        setBusy(false)
      }
    },
  }
}

/**
 * 멈춤 띠 (AC-I1-09·24): 멈춘 까닭 문장과 할 일 — 끊김이면 출력 기기에서 "다시 연결"(다른 기기는 그 기기에서 하라는 문장),
 * 손으로 푸는 멈춤이면 "다시 시작", 쌓인 라벨이면 "출력 시작".
 */
export function PausePanel({ onReconnectHelp }: { readonly onReconnectHelp?: () => void }) {
  const print = usePrintState()
  const station = useStationState()
  const api = usePrintApi()
  const action = usePrintAction()
  const [reconnecting, setReconnecting] = useState(false)
  const queue = print.overview?.queue ?? null
  if (queue === null || queue.pause === null || api === null) return null
  const pause = queue.pause
  const mine = api.station.isMine(queue)
  const reconnect = async () => {
    setReconnecting(true)
    try {
      await api.station.reconnect()
    } finally {
      setReconnecting(false)
    }
  }
  return (
    <div className="pause-band" role="region" aria-label="출력 멈춤">
      <p className="pause-message">{pause.backlog ? backlogMessage(queue.waiting) : pause.message}</p>
      {pause.reason === 'DISCONNECTED' ? (
        mine ? (
          api.station.canReconnect ? (
            <button type="button" className="button button-primary" data-key="1" disabled={reconnecting || station?.connecting === true} onClick={() => void reconnect()}>
              {PRINT_ACTION.reconnect}
            </button>
          ) : (
            <div className="stack-tight">
              <p>프린터 연결 방법을 골라 다시 연결해 주세요.</p>
              {onReconnectHelp !== undefined ? (
                <button type="button" className="button button-primary" onClick={onReconnectHelp}>
                  {PRINT_ACTION.reconnect}
                </button>
              ) : null}
            </div>
          )
        ) : queue.device !== null ? (
          <p>{reconnectThereMessage(queue.device.name)}</p>
        ) : null
      ) : (
        <button type="button" className="button button-primary" disabled={action.busy} data-key="1" onClick={() => void action.run('/api/print/restart')}>
          {pause.backlog ? PRINT_ACTION.start : PRINT_ACTION.restart}
        </button>
      )}
      {station?.connectError !== null && station?.connectError !== undefined && mine && pause.reason === 'DISCONNECTED' ? <p className="field-error">{station.connectError.message}</p> : null}
      {action.error !== null ? <ErrorNote error={action.error} /> : null}
    </div>
  )
}

/** 작업 한 줄: 번호(포장은 쪽)·품종·구매자 표시·종류·만든 까닭·상태 낱말·시도 횟수·마지막 오류 문장·시각(KST) */
export function JobLine({ job }: { readonly job: JobView }) {
  const name = jobNameWord(job)
  return (
    <>
      <p className="job-main">
        <strong>{jobNumberWord(job)}</strong>
        {name !== '' ? <span> {name}</span> : null}
        <span> · {buyerWord(job.label.buyer)}</span>
        <span> · {KIND_WORD[job.kind]}</span>
        <span> · {REASON_WORD[job.reason]}</span> <span className={job.status === 'PRINTING' ? 'tag tag-printing' : 'tag'}>{job.word}</span>
        {job.attempts > 0 ? <span> · 시도 {job.attempts}번</span> : null}
      </p>
      {job.lastError !== null ? <p className="job-error">마지막 오류: {printErrorMessage(job.lastError)}</p> : null}
      <p className="hint">
        만든 때 {kstHm(job.createdAt)}
        {job.device !== null && job.printedAt !== null ? ` · ${kstHm(job.printedAt)} ${job.device}에서 출력` : ''}
      </p>
    </>
  )
}

/** 출력 중·대기 작업 (대기 작업마다 "빼기", 확인 뒤 "모두 빼기") */
export function QueueList() {
  const print = usePrintState()
  const action = usePrintAction()
  const [confirmAll, setConfirmAll] = useState(false)
  const overview = print.overview
  if (overview === null) return print.phase === 'error' && print.error !== null ? <ErrorNote error={print.error} /> : <p role="status">불러오는 중…</p>
  const waiting = overview.jobs.filter((job) => job.status === 'WAITING')
  return (
    <div className="stack-tight">
      <p>
        대기 {overview.queue.waiting}장 · 출력 중 {overview.queue.printing}장
      </p>
      {overview.jobs.length === 0 ? <p>출력할 라벨이 없어요.</p> : null}
      <ul className="plain-list job-list" aria-label="대기 작업">
        {overview.jobs.map((job) => (
          <li key={`${job.date}|${job.id}`} className="job-row">
            <JobLine job={job} />
            {job.status === 'WAITING' ? (
              <button type="button" className="button button-small" disabled={action.busy} onClick={() => void action.run('/api/print/jobs/cancel', { date: job.date, id: job.id })}>
                빼기
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {waiting.length > 0 ? (
        <button type="button" className="button" onClick={() => setConfirmAll(true)}>
          모두 빼기
        </button>
      ) : null}
      {action.error !== null ? <ErrorNote error={action.error} /> : null}
      {confirmAll ? (
        <Modal
          title="모두 빼기"
          onClose={() => setConfirmAll(false)}
          actions={
            <button
              type="button"
              className="button button-danger"
              data-key="1"
              disabled={action.busy}
              onClick={() => {
                void action.run('/api/print/jobs/cancel-all', { confirm: true }).then((ok) => {
                  if (ok) setConfirmAll(false)
                })
              }}
            >
              1 모두 빼기
            </button>
          }
        >
          <p>대기 중인 라벨 {waiting.length}장을 모두 뺄까요? 뺀 라벨은 출력하지 않아요(기록은 남아요).</p>
          {action.error !== null ? <ErrorNote error={action.error} /> : null}
        </Modal>
      ) : null}
    </div>
  )
}

/**
 * 버릴 라벨 (AC-I1-24): "15번 · 우주천사 · 26.10.18 라벨을 버려 주세요"와 "버렸어요". 라벨 기능이 꺼져 있어도 남는다(L-13 4·9).
 * "버렸어요"는 알림 창(숫자 키로 고르는 목록)에서만 주 버튼이고, 라벨 화면에서는 보통 버튼이다 (AC-N4a-21)
 */
export function DiscardList({ numbered = false }: { readonly numbered?: boolean }) {
  const print = usePrintState()
  const action = usePrintAction()
  const discard = print.overview?.discard ?? []
  return (
    <div className="stack-tight">
      {discard.length === 0 ? <p>버릴 라벨이 없어요.</p> : null}
      <ul className="plain-list job-list" aria-label="버릴 라벨 목록">
        {discard.map((job, index) => (
          <li key={`${job.date}|${job.id}`} className="job-row discard-row">
            <p className="job-main">{discardWord(job)}</p>
            {job.device !== null && job.printedAt !== null ? (
              <p className="hint">
                {kstHm(job.printedAt)} {job.device}에서 출력한 라벨
              </p>
            ) : null}
            <button
              type="button"
              className={numbered ? 'button button-primary' : 'button'}
              data-key={numbered && index < 9 ? String(index + 1) : undefined}
              disabled={action.busy}
              onClick={() => void action.run('/api/print/jobs/discard', { date: job.date, id: job.id })}
            >
              {numbered && index < 9 ? <span aria-hidden="true">{index + 1} </span> : null}
              {PRINT_ACTION.discarded}
            </button>
          </li>
        ))}
      </ul>
      {action.error !== null ? <ErrorNote error={action.error} /> : null}
    </div>
  )
}

/** 알림 띠 "출력 멈춤"의 창 (AC-I1-32): 멈춘 까닭과 할 일 — 처음 포커스 "닫기", 1 = 다시 시작·출력 시작·다시 연결 */
export function PrintPauseDialog({ onClose }: { readonly onClose: () => void }) {
  const print = usePrintState()
  const labels = useLabelsEnabled()
  const paused = print.overview?.queue.pause != null
  return (
    <Modal title="출력 멈춤" onClose={onClose}>
      {/* 창이 열린 채 라벨 기능이 꺼지면 조치 대신 안내 (L-13 9) */}
      {labels !== true ? <LabelsOffNote /> : paused ? <PausePanel /> : <p>지금은 출력이 멈추지 않았어요.</p>}
    </Modal>
  )
}

/** 알림 띠 "버릴 라벨"의 창 (AC-I1-32): 목록과 "버렸어요" — 숫자 키로 고른다 */
export function DiscardDialog({ onClose }: { readonly onClose: () => void }) {
  return (
    <Modal title="버릴 라벨" onClose={onClose} wide>
      <DiscardList numbered />
    </Modal>
  )
}
