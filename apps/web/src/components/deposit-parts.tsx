// 입금 확인 화면이 함께 쓰는 조각 (N3, AC-N3-41·44·49·50).
// - 입금 목록 받기: 상태별 목록(GET /api/deposits?status=), 이어 받기, 알림 판이 바뀌면 조금 뒤 다시 받기(알림이 몰려도 한 번).
// - 입금 목록 모양: PC(48rem 이상)는 열 머리가 있는 표, 휴대폰은 입금마다 카드 한 묶음(D-101). 줄·카드의 이름은 "입금 #12".
// - 처리 하나 보내기: 누를 때 만든 요청 번호로 보내고, 네트워크 오류면 같은 요청 번호로 다시 보낸다(서버는 같은 요청 번호를 한 번만 처리한다).
// - 입금 하나 자세히(처리 기록)·되돌리기 확인 창.
// 입금자명은 신뢰할 수 없는 글이다 — React 기본 이스케이프로만 그린다(NFR-06).
import { formatWon } from '@livejjim/core'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { get, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import type { DepositActionResult, DepositDetail, DepositList, DepositStatus, DepositView } from '../api/deposit-types.ts'
import {
  DEPOSIT_STATUS_WORD,
  depositActionWord,
  depositActorWord,
  depositName,
  depositTime,
  revertQuestion,
  sourceWords,
} from '../lib/deposit-words.ts'
import { dateYear, kstStamp } from '../lib/kst.ts'
import { useWide } from '../lib/use-wide.ts'
import { useDepositStore } from './deposit-context.tsx'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

/** 한 번에 받는 입금 수 */
export const PAGE_SIZE = 50
/** 다시 받기 상한 (서버 limit 1~200) */
const RELOAD_MAX = 200
/** 알림이 몰릴 때 한 번만 다시 받도록 기다리는 시간 */
export const RELOAD_DELAY_MS = 150

export const depositLabel = (no: number): string => `입금 #${String(no)}`

/** 화면 위 안내 (성공·주의) */
export interface Notice {
  readonly text: string
  readonly tone: 'success' | 'warning' | 'info'
  /** 함께 보일 줄 (한꺼번에 처리의 거절 항목 등) */
  readonly lines?: readonly string[]
}

export function NoticeLine({ notice, onClose }: { readonly notice: Notice | null; readonly onClose: () => void }) {
  if (notice === null) return null
  return (
    <div className="notice deposit-notice stack-tight" role="status" data-tone={notice.tone}>
      <p>{notice.text}</p>
      {notice.lines !== undefined && notice.lines.length > 0 ? (
        <ul className="plain-list">
          {notice.lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="button button-small notice-close" onClick={onClose}>
        안내 닫기
      </button>
    </div>
  )
}

// ── 목록 받기 ─────────────────────────────────────────────────────────────

export interface ListState {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly deposits: readonly DepositView[]
  readonly more: boolean
  readonly error: ApiError | null
  readonly loadingMore: boolean
}

export interface DepositListApi extends ListState {
  /** 지금 보이는 만큼 다시 받는다 */
  reload(): Promise<void>
  /** 다음 쪽 */
  loadMore(): Promise<void>
}

/**
 * 상태별 입금 목록. triggers의 값이 바뀌면(알림 판) 조금 뒤 다시 받는다. 응답의 확인 필요 수는 메뉴 수에 덮는다.
 * 늦게 온 응답이 나중 응답을 덮지 않게 요청마다 번호를 붙인다.
 */
export function useDepositList(statuses: readonly DepositStatus[], triggers: readonly number[]): DepositListApi {
  const store = useDepositStore()
  const storeRef = useRef(store)
  storeRef.current = store
  const status = statuses.join(',')
  const [state, setState] = useState<ListState>({ phase: 'loading', deposits: [], more: false, error: null, loadingMore: false })
  const ticket = useRef(0)
  const shown = useRef(0)
  shown.current = state.deposits.length
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const reload = useCallback(async () => {
    const mine = ++ticket.current
    const limit = Math.min(RELOAD_MAX, Math.max(PAGE_SIZE, shown.current))
    try {
      const result = await get<DepositList>(withQuery('/api/deposits', { status, limit }))
      if (mine !== ticket.current) return
      setState({ phase: 'ready', deposits: result.deposits, more: result.more, error: null, loadingMore: false })
      storeRef.current?.setReview(result.review)
    } catch (error) {
      if (!isApiError(error)) throw error
      if (mine !== ticket.current) return
      setState((current) => ({ ...current, phase: current.phase === 'ready' ? 'ready' : 'error', error, loadingMore: false }))
    }
  }, [status])
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  const loadMore = useCallback(async () => {
    const last = state.deposits.at(-1)
    if (last === undefined || !state.more || state.loadingMore) return
    const mine = ++ticket.current
    setState((current) => ({ ...current, loadingMore: true }))
    try {
      const result = await get<DepositList>(withQuery('/api/deposits', { status, before: last.no, limit: PAGE_SIZE }))
      if (mine !== ticket.current) return
      setState((current) => ({
        phase: 'ready',
        deposits: [...current.deposits, ...result.deposits.filter((item) => !current.deposits.some((held) => held.no === item.no))],
        more: result.more,
        error: null,
        loadingMore: false,
      }))
    } catch (error) {
      if (!isApiError(error)) throw error
      if (mine !== ticket.current) return
      setState((current) => ({ ...current, error, loadingMore: false }))
    }
  }, [state.deposits, state.more, state.loadingMore, status])

  // 처음, 그리고 상태가 바뀌면 바로
  useEffect(() => {
    setState({ phase: 'loading', deposits: [], more: false, error: null, loadingMore: false })
    shown.current = 0
    void reload()
  }, [reload])

  // 알림 판이 바뀌면 조금 뒤 한 번 (처음 값은 건너뛴다)
  const key = triggers.join(',')
  const seen = useRef(key)
  useEffect(() => {
    if (seen.current === key) return
    seen.current = key
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = undefined
      void reloadRef.current()
    }, RELOAD_DELAY_MS)
  }, [key])
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
    },
    [],
  )

  return { ...state, reload, loadMore }
}

// ── 처리 보내기 ───────────────────────────────────────────────────────────

export interface RunOptions {
  /** 거절을 화면이 따로 다룬다 — 참을 돌려주면 error에 남기지 않는다 */
  readonly handle?: (error: ApiError) => boolean
}

export interface ActionRunner {
  readonly busy: boolean
  readonly error: ApiError | null
  /** 보낸다. 성공하면 응답, 아니면 null (오류는 error에). 같은 runner에서 다시 보내면(실패 뒤) 같은 요청 번호 */
  run<T>(path: string, body?: Readonly<Record<string, unknown>>, options?: RunOptions): Promise<T | null>
  clear(): void
}

/**
 * 처리 하나 (요청 번호 하나): 창 하나·버튼 하나가 쓴다. 네트워크 오류·저장 실패면 같은 요청 번호로 자동으로 다시 보낸다.
 * 거절(4xx)은 서버가 기록하지 않으므로 다시 보내면 다시 판단한다(새 요청 번호).
 */
export function useAction(): ActionRunner {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const requestId = useRef<string | null>(null)
  const busyRef = useRef(false)
  return {
    busy,
    error,
    clear: () => setError(null),
    run: async <T,>(path: string, body: Readonly<Record<string, unknown>> = {}, options: RunOptions = {}): Promise<T | null> => {
      if (busyRef.current) return null
      busyRef.current = true
      setBusy(true)
      setError(null)
      requestId.current ??= newRequestId()
      const id = requestId.current
      try {
        const result = await withRetry(() => post<T>(path, { requestId: id, ...body }))
        requestId.current = null
        return result
      } catch (caught) {
        if (!isApiError(caught)) throw caught
        // 다시 보내도 되는 실패만 같은 요청 번호를 남긴다
        if (!caught.transient) requestId.current = null
        if (options.handle?.(caught) !== true) setError(caught)
        return null
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
  }
}

// ── 목록 모양 ─────────────────────────────────────────────────────────────

export interface DepositColumn {
  readonly head: string
  readonly cell: (deposit: DepositView) => ReactNode
  /** 금액 열 (오른쪽) */
  readonly num?: boolean
  /** 휴대폰 카드에서 칸 이름 없이 보인다 (사유·처리 버튼) */
  readonly bare?: boolean
}

/** 모든 목록의 입금 정보 칸 (AC-N3-41): 입금 시각(KST) · 입금자명 · 금액 · 원천 */
export const INFO_COLUMNS: readonly DepositColumn[] = [
  { head: '입금 시각', cell: (deposit) => depositTime(deposit.at, deposit.precision) },
  { head: '입금자명', cell: (deposit) => <span className="deposit-name">{depositName(deposit.name)}</span> },
  { head: '금액', cell: (deposit) => <span className="won">{formatWon(deposit.amount)}</span>, num: true },
  { head: '원천', cell: (deposit) => sourceWords(deposit.source) },
]

export interface DepositRowsProps {
  /** 표·목록 이름 ("확인 필요 입금") */
  readonly label: string
  readonly deposits: readonly DepositView[]
  readonly columns: readonly DepositColumn[]
  /** 줄 맨 앞 (고르기 칸) */
  readonly lead?: { readonly head: string; readonly cell: (deposit: DepositView) => ReactNode }
}

/** 입금 목록: PC는 열 머리가 있는 표, 휴대폰은 입금마다 카드 (AC-N3-49, D-101) — 한 모양만 그린다 */
export function DepositRows({ label, deposits, columns, lead }: DepositRowsProps) {
  const wide = useWide()
  if (wide) {
    return (
      <div className="table-scroll">
        <table className="list-table deposit-table" aria-label={label}>
          <thead>
            <tr>
              {lead !== undefined ? <th scope="col">{lead.head}</th> : null}
              <th scope="col">번호</th>
              {columns.map((column) => (
                <th key={column.head} scope="col" className={column.num === true ? 'num' : undefined}>
                  {column.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deposits.map((deposit) => (
              <tr key={deposit.no} aria-label={depositLabel(deposit.no)}>
                {lead !== undefined ? <td>{lead.cell(deposit)}</td> : null}
                <td className="deposit-no">#{deposit.no}</td>
                {columns.map((column) => (
                  <td key={column.head} className={column.num === true ? 'num' : undefined}>
                    {column.cell(deposit)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <ul className="plain-list deposit-cards" aria-label={label}>
      {deposits.map((deposit) => (
        <li key={deposit.no} className="card deposit-card" aria-label={depositLabel(deposit.no)}>
          <div className="deposit-card-head">
            {lead !== undefined ? lead.cell(deposit) : null}
            <strong>{depositLabel(deposit.no)}</strong>
          </div>
          <dl className="facts">
            {columns
              .filter((column) => column.bare !== true)
              .map((column) => (
                <div key={column.head}>
                  <dt>{column.head}</dt>
                  <dd>{column.cell(deposit)}</dd>
                </div>
              ))}
          </dl>
          {columns
            .filter((column) => column.bare === true)
            .map((column) => (
              <div key={column.head} className="deposit-card-part">
                {column.cell(deposit)}
              </div>
            ))}
        </li>
      ))}
    </ul>
  )
}

/** 목록 상태 (불러오는 중·오류·빈 목록·더 보기) */
export function ListFrame({ list, empty, children }: { readonly list: DepositListApi; readonly empty: string; readonly children: ReactNode }) {
  if (list.phase === 'loading') return <p role="status">불러오는 중…</p>
  if (list.phase === 'error' && list.error !== null) return <ErrorNote error={list.error} onRetry={() => void list.reload()} retryLabel="다시 불러오기" />
  return (
    <div className="stack">
      {list.error !== null ? <ErrorNote error={list.error} onRetry={() => void list.reload()} retryLabel="다시 불러오기" /> : null}
      {list.deposits.length === 0 ? <p>{empty}</p> : children}
      {list.more ? (
        <button type="button" className="button more-button" disabled={list.loadingMore} onClick={() => void list.loadMore()}>
          {list.loadingMore ? '불러오는 중…' : '더 보기'}
        </button>
      ) : null}
    </div>
  )
}

/** 반영한 묶음: "다육이맘 · 2026년 10월 18일 묶음" */
export function appliedWords(applied: { readonly buyerName: string; readonly date: string }): string {
  return `${applied.buyerName} · ${dateYear(applied.date)} 묶음`
}

// ── 입금 하나 자세히 (AC-N3-44, DAT-05) ───────────────────────────────────

export function DepositDetailDialog({ no, onClose }: { readonly no: number; readonly onClose: () => void }) {
  const [detail, setDetail] = useState<DepositDetail | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setError(null)
    get<{ deposit: DepositDetail }>(`/api/deposits/${String(no)}`).then(
      (result) => {
        if (alive) setDetail(result.deposit)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [no, attempt])
  return (
    <Modal title={depositLabel(no)} onClose={onClose} wide>
      {error !== null ? <ErrorNote error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : null}
      {detail === null ? (
        error === null ? (
          <p role="status">불러오는 중…</p>
        ) : null
      ) : (
        <>
          <dl className="facts">
            <div>
              <dt>입금 시각</dt>
              <dd>{depositTime(detail.at, detail.precision)}</dd>
            </div>
            <div>
              <dt>입금자명</dt>
              <dd>{depositName(detail.name)}</dd>
            </div>
            <div>
              <dt>금액</dt>
              <dd>{formatWon(detail.amount)}</dd>
            </div>
            <div>
              <dt>원천</dt>
              <dd>{sourceWords(detail.source)}</dd>
            </div>
            <div>
              <dt>상태</dt>
              <dd>{DEPOSIT_STATUS_WORD[detail.status]}</dd>
            </div>
            {detail.applied !== null ? (
              <div>
                <dt>반영한 묶음</dt>
                <dd>{appliedWords(detail.applied)}</dd>
              </div>
            ) : null}
          </dl>
          <section className="stack-tight" aria-label="처리 기록">
            <h3 className="sub-title">처리 기록</h3>
            {detail.actions.length === 0 ? <p>처리 기록이 없어요.</p> : null}
            <ol className="plain-list history-list">
              {detail.actions.map((action, index) => (
                <li key={index} className="history-entry">
                  <span className="history-time">{kstStamp(action.at)}</span>
                  <span>{depositActionWord(action.action)}</span>
                  <span>{depositActorWord(action.actor)}</span>
                  {action.date !== null && action.buyerName !== null ? <span>{appliedWords({ buyerName: action.buyerName, date: action.date })}</span> : null}
                  {action.seq !== null ? <span>정산 기록 {action.seq}번</span> : null}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </Modal>
  )
}

// ── 되돌리기 (AC-N3-44·47, STL-09) ───────────────────────────────────────

export interface RevertTarget {
  readonly no: number
  readonly buyerName: string
  readonly date: string
  readonly amount: number
}

/** 되돌리기 확인 창: 같은 금액의 환불 기록을 적고 입금은 확인 필요로 돌아간다. 거절(409) 문장은 그대로 보인다 */
export function RevertDialog({ target, onClose, onDone }: { readonly target: RevertTarget; readonly onClose: () => void; readonly onDone: (result: DepositActionResult) => void }) {
  const action = useAction()
  const send = async () => {
    const result = await action.run<DepositActionResult>(`/api/deposits/${String(target.no)}/revert`)
    if (result !== null) onDone(result)
  }
  return (
    <Modal
      title="입금 확인 되돌리기"
      onClose={onClose}
      actions={
        <button type="button" className="button button-danger" disabled={action.busy} onClick={() => void send()}>
          {action.busy ? '보내는 중…' : '되돌리기'}
        </button>
      }
    >
      <p>{revertQuestion(target.buyerName, target.date, target.amount)}</p>
      {action.error !== null ? <ErrorNote error={action.error} {...(action.error.transient ? { onRetry: () => void send() } : {})} /> : null}
    </Modal>
  )
}
