// 확인 필요 목록 (N3, DP-5·DP-6·DP-8, AC-N3-41·42·43, D-N3-07).
// - 입금마다: 입금 시각·입금자명·금액·원천, 사유 문장(DP-8 그대로), 제안 묶음(바뀔 입금 상태·판매 전 입금), 미리 고른 묶음이 골라진 상태로.
//   사유·제안은 서버가 볼 때 다시 계산한 것 — 화면은 맞추기 규칙을 다시 만들지 않는다(낱말로만 바꾼다).
// - 줄마다 "확정"(고른 묶음으로 — 없으면 누를 수 없다)·"다른 묶음 지정"·"무시"·"자세히", 고르기 칸 → "선택한 입금 확정 (N건)"·"선택한 입금 무시 (N건)".
// - 확정(한 건·한꺼번에)은 확인 창을 거쳐 바로 보낸다(방송자 조치의 5초 대기 없음). 창에는 누구의 어느 날 묶음에 얼마를 적고 상태가 어떻게 바뀌는지,
//   과입금이 새로 생기면 주의 색과 환불 필요 금액. 묶음의 구매자가 유튜브 구매자이고 이름 후보에 없는 입금자명이면 "기억" 고르기(기본 골라짐).
// - 서버가 BUNDLE_CHANGED로 거절하면 그 문장을 보이고 목록을 새로 받는다 — 새 제안을 보기 전엔 다시 보내지 않는다(창을 닫고 고른 묶음을 새 제안으로).
// - 주 버튼(채운 색)은 "선택한 입금 확정 (N건)" 하나뿐이다(고른 줄이 있을 때, UX-01·D-102).
import { formatWon } from '@livejjim/core'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import type { BulkResult, BundleView, DepositActionResult, DepositView } from '../api/deposit-types.ts'
import { BEFORE_SALE, bundleChange, bundleWords, confirmLine, depositName, reasonWords } from '../lib/deposit-words.ts'
import { dateLong } from '../lib/kst.ts'
import { useDepositSignal, useDepositStore } from './deposit-context.tsx'
import { DepositDetailDialog, DepositRows, INFO_COLUMNS, ListFrame, depositLabel, useAction, useDepositList, type DepositColumn, type Notice } from './deposit-parts.tsx'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

export const BUNDLE_CHANGED_CODE = 'BUNDLE_CHANGED'
export const REMEMBER_WORDS = '다음에도 이 입금자명이면 이 구매자로 볼게요'
export const NO_SUGGESTION = '제안할 묶음이 없어요. "다른 묶음 지정"으로 골라 주세요.'

const bundleKey = (bundle: { readonly date: string; readonly buyer: string }): string => JSON.stringify([bundle.date, bundle.buyer])

/** 확정할 줄 하나: 입금과 고른 묶음 */
export interface ConfirmLine {
  readonly deposit: DepositView
  readonly bundle: BundleView
}

/** 그 입금의 고른 묶음: 판매자가 고른 제안, 없으면 미리 고른 묶음 (제안 안에 있을 때만) */
export function chosenBundle(deposit: DepositView, picked: string | undefined): BundleView | null {
  const suggestions = deposit.review?.suggestions ?? []
  const key = picked ?? (deposit.review?.preselect == null ? undefined : bundleKey(deposit.review.preselect))
  if (key === undefined) return null
  return suggestions.find((bundle) => bundleKey(bundle) === key) ?? null
}

export function ReviewTab({ onNotice }: { readonly onNotice: (notice: Notice | null) => void }) {
  const signal = useDepositSignal()
  const store = useDepositStore()
  const list = useDepositList(['REVIEW'], [signal.tick, signal.scopeTick])
  /** 입금 번호 → 판매자가 고른 제안 묶음 키 */
  const [picked, setPicked] = useState<ReadonlyMap<number, string>>(new Map())
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [confirming, setConfirming] = useState<readonly ConfirmLine[] | null>(null)
  const [searching, setSearching] = useState<DepositView | null>(null)
  const [ignoring, setIgnoring] = useState<readonly DepositView[] | null>(null)
  const [detail, setDetail] = useState<number | null>(null)
  const ignore = useAction()

  // 목록에서 사라진 입금(다른 기기에서 처리됨)은 고르기·고른 묶음에서 뺀다
  useEffect(() => {
    const present = new Set(list.deposits.map((deposit) => deposit.no))
    setSelected((current) => (([...current].every((no) => present.has(no)) ? current : new Set([...current].filter((no) => present.has(no))))))
    setPicked((current) => {
      let changed = false
      const next = new Map<number, string>()
      for (const [no, key] of current) {
        const deposit = list.deposits.find((item) => item.no === no)
        if (deposit !== undefined && deposit.review?.suggestions.some((bundle) => bundleKey(bundle) === key) === true) next.set(no, key)
        else changed = true
      }
      return changed ? next : current
    })
  }, [list.deposits])

  const chosen = (deposit: DepositView) => chosenBundle(deposit, picked.get(deposit.no))
  const selectedDeposits = list.deposits.filter((deposit) => selected.has(deposit.no))
  const unpicked = selectedDeposits.filter((deposit) => chosen(deposit) === null)

  const toggle = (no: number, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(no)
      else next.delete(no)
      return next
    })

  const after = async () => {
    await list.reload()
    void store?.refreshCount()
  }

  /** 서버가 묶음 금액이 바뀌었다고 거절함: 문장을 보이고 새 제안으로 (고른 묶음을 지운다) */
  const changed = (message: string, nos: readonly number[]) => {
    setPicked((current) => {
      const next = new Map(current)
      for (const no of nos) next.delete(no)
      return next
    })
    onNotice({ text: message, tone: 'warning' })
    void after()
  }

  const ignoreOne = async (deposit: DepositView) => {
    const result = await ignore.run<DepositActionResult>(`/api/deposits/${String(deposit.no)}/ignore`)
    if (result === null) return
    onNotice({ text: `${depositLabel(deposit.no)}: 무시했어요. "무시함"에서 다시 확인 필요로 옮길 수 있어요.`, tone: 'success' })
    toggle(deposit.no, false)
    void after()
  }

  const columns: DepositColumn[] = [
    ...INFO_COLUMNS,
    {
      head: '사유와 묶음',
      bare: true,
      cell: (deposit) => (
        <SuggestionPicker
          deposit={deposit}
          value={chosen(deposit)}
          onPick={(bundle) =>
            setPicked((current) => {
              const next = new Map(current)
              next.set(deposit.no, bundleKey(bundle))
              return next
            })
          }
        />
      ),
    },
    {
      head: '처리',
      bare: true,
      cell: (deposit) => {
        const bundle = chosen(deposit)
        return (
          <div className="row deposit-actions" role="group" aria-label={`${depositLabel(deposit.no)} 처리`}>
            <button type="button" className="button" disabled={bundle === null} onClick={() => bundle !== null && setConfirming([{ deposit, bundle }])}>
              확정
            </button>
            <button type="button" className="button" onClick={() => setSearching(deposit)}>
              다른 묶음 지정
            </button>
            <button type="button" className="button" disabled={ignore.busy} onClick={() => void ignoreOne(deposit)}>
              무시
            </button>
            <button type="button" className="button" onClick={() => setDetail(deposit.no)}>
              자세히
            </button>
          </div>
        )
      },
    },
  ]

  const allSelected = list.deposits.length > 0 && list.deposits.every((deposit) => selected.has(deposit.no))
  return (
    <div className="stack">
      {ignore.error !== null ? <ErrorNote error={ignore.error} /> : null}
      <ListFrame list={list} empty="확인할 입금이 없어요.">
        <div className="toolbar deposit-toolbar">
          <label className="choice">
            <input type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(list.deposits.map((deposit) => deposit.no)) : new Set())} />
            <span>모두 고르기</span>
          </label>
          {selected.size > 0 ? (
            <div className="row" role="group" aria-label="선택한 입금">
              <button
                type="button"
                className="button button-primary"
                disabled={unpicked.length > 0}
                onClick={() => setConfirming(selectedDeposits.flatMap((deposit) => (chosen(deposit) === null ? [] : [{ deposit, bundle: chosen(deposit) as BundleView }])))}
              >
                선택한 입금 확정 ({selected.size}건)
              </button>
              <button type="button" className="button" onClick={() => setIgnoring(selectedDeposits)}>
                선택한 입금 무시 ({selected.size}건)
              </button>
            </div>
          ) : null}
        </div>
        {selected.size > 0 && unpicked.length > 0 ? (
          <p className="warning" data-tone="warning">
            묶음을 고르지 않은 입금이 있어요({unpicked.map((deposit) => depositLabel(deposit.no)).join(', ')}). 묶음을 고른 뒤 확정해 주세요.
          </p>
        ) : null}
        <DepositRows
          label="확인 필요 입금"
          deposits={list.deposits}
          columns={columns}
          lead={{
            head: '고르기',
            cell: (deposit) => (
              <label className="choice">
                <input type="checkbox" aria-label={`${depositLabel(deposit.no)} 고르기`} checked={selected.has(deposit.no)} onChange={(event) => toggle(deposit.no, event.target.checked)} />
              </label>
            ),
          }}
        />
      </ListFrame>
      {confirming !== null ? (
        <ConfirmDialog
          lines={confirming}
          onClose={() => setConfirming(null)}
          onChanged={(message, nos) => {
            setConfirming(null)
            changed(message, nos)
          }}
          onDone={(notice, done, changedNos) => {
            setConfirming(null)
            setSelected((current) => new Set([...current].filter((no) => !done.includes(no))))
            if (changedNos.length > 0) changed(notice.text, changedNos)
            onNotice(notice)
            void after()
          }}
        />
      ) : null}
      {searching !== null ? (
        <BundleSearchDialog
          deposit={searching}
          onClose={() => setSearching(null)}
          onPick={(bundle) => {
            const deposit = searching
            setSearching(null)
            setConfirming([{ deposit, bundle }])
          }}
        />
      ) : null}
      {ignoring !== null ? (
        <BulkIgnoreDialog
          deposits={ignoring}
          onClose={() => setIgnoring(null)}
          onDone={(notice, done) => {
            setIgnoring(null)
            setSelected((current) => new Set([...current].filter((no) => !done.includes(no))))
            onNotice(notice)
            void after()
          }}
        />
      ) : null}
      {detail !== null ? <DepositDetailDialog no={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  )
}

// ── 사유와 제안 묶음 (AC-N3-41) ─────────────────────────────────────────

function SuggestionPicker({ deposit, value, onPick }: { readonly deposit: DepositView; readonly value: BundleView | null; readonly onPick: (bundle: BundleView) => void }) {
  const name = useId()
  const review = deposit.review
  if (review === undefined) return null
  return (
    <div className="stack-tight deposit-review">
      <p className="deposit-reason">
        <strong>{reasonWords(review.reason, review.twin)}</strong>
      </p>
      {review.suggestions.length === 0 ? (
        <p className="hint">{NO_SUGGESTION}</p>
      ) : (
        <div className="choice-list-plain" role="radiogroup" aria-label={`${depositLabel(deposit.no)} 묶음`}>
          {review.suggestions.map((bundle) => {
            const change = bundleChange(bundle)
            return (
              <div key={bundleKey(bundle)} className="stack-tight">
                <label className="choice suggestion">
                  <input type="radio" name={name} checked={value !== null && bundleKey(value) === bundleKey(bundle)} onChange={() => onPick(bundle)} />
                  <span>
                    {bundleWords(bundle)}
                    {change === null ? null : (
                      <>
                        {' · '}
                        <span className={change.warning ? 'change-warning' : undefined}>{change.text}</span>
                      </>
                    )}
                  </span>
                </label>
                {bundle.beforeSale ? (
                  <p className="warning before-sale" data-tone="warning">
                    {BEFORE_SALE}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── 확정 창 (AC-N3-42) ────────────────────────────────────────────────────

export function ConfirmDialog({
  lines,
  onClose,
  onChanged,
  onDone,
}: {
  readonly lines: readonly ConfirmLine[]
  readonly onClose: () => void
  /** 묶음 금액이 바뀌어 거절됨 (서버 문장, 그 입금 번호들) */
  readonly onChanged: (message: string, nos: readonly number[]) => void
  /** 보냄 (안내, 반영한 입금 번호들, 묶음 금액이 바뀌어 거절된 입금 번호들 — 새 제안을 보기 전엔 다시 보내지 않는다) */
  readonly onDone: (notice: Notice, done: readonly number[], changed: readonly number[]) => void
}) {
  const [remember, setRemember] = useState<ReadonlyMap<number, boolean>>(() => new Map(lines.map((line) => [line.deposit.no, line.bundle.canRemember])))
  const action = useAction()
  const bulk = lines.length > 1
  const send = async () => {
    if (!bulk) {
      const line = lines[0]
      if (line === undefined) return
      const result = await action.run<DepositActionResult>(
        `/api/deposits/${String(line.deposit.no)}/confirm`,
        {
          date: line.bundle.date,
          buyer: line.bundle.buyer,
          remaining: line.bundle.remaining,
          remember: line.bundle.canRemember && remember.get(line.deposit.no) === true,
        },
        {
          // 묶음 금액이 바뀌었으면: 문장을 보이고 목록을 새로 받는다 (창을 닫는다 — 같은 값으로 다시 보내지 않게)
          handle: (error) => {
            if (error.code !== BUNDLE_CHANGED_CODE) return false
            onChanged(error.message, [line.deposit.no])
            return true
          },
        },
      )
      if (result === null) return
      const before = result.deposit.applied?.beforeSale === true ? ` ${BEFORE_SALE}` : ''
      onDone({ text: `${depositLabel(line.deposit.no)}: ${line.bundle.name} · ${dateLong(line.bundle.date)} 묶음에 적었어요.${before}`, tone: 'success' }, [line.deposit.no], [])
      return
    }
    const result = await action.run<BulkResult>('/api/deposits/bulk', {
      items: lines.map((line) => ({
        no: line.deposit.no,
        action: 'confirm',
        date: line.bundle.date,
        buyer: line.bundle.buyer,
        remaining: line.bundle.remaining,
        remember: line.bundle.canRemember && remember.get(line.deposit.no) === true,
      })),
    })
    if (result === null) return
    const done = result.results.flatMap((item) => (item.ok && item.no !== null ? [item.no] : []))
    const failed = result.results.flatMap((item) => (item.ok ? [] : [item]))
    const changedNos = failed.flatMap((item) => (item.error.code === BUNDLE_CHANGED_CODE && item.no !== null ? [item.no] : []))
    const text = failed.length === 0 ? `입금 ${String(done.length)}건을 확정했어요.` : `입금 ${String(done.length)}건을 확정했어요. ${String(failed.length)}건은 확정하지 못했어요.`
    const notice: Notice = {
      text,
      tone: failed.length === 0 ? 'success' : 'warning',
      lines: failed.map((item) => `${item.no === null ? '입금' : depositLabel(item.no)}: ${item.error.message}`),
    }
    onDone(notice, done, changedNos)
  }
  const error = action.error

  const title = bulk ? `선택한 입금 확정 (${String(lines.length)}건)` : '입금 확정'
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      actions={
        <button type="button" className="button button-primary" disabled={action.busy} onClick={() => void send()}>
          {action.busy ? '보내는 중…' : bulk ? `${String(lines.length)}건 확정` : '확정'}
        </button>
      }
    >
      <ul className="plain-list stack-tight" aria-label="확정할 입금">
        {lines.map((line) => {
          const change = bundleChange(line.bundle)
          const warning = change?.warning === true
          return (
            <li key={line.deposit.no} className="claim-row confirm-line" {...(warning ? { 'data-tone': 'warning' } : {})}>
              <p>
                <strong>{depositLabel(line.deposit.no)}</strong> · {depositName(line.deposit.name)}
              </p>
              <p className="confirm-words">{confirmLine(line.bundle, line.deposit.amount)}</p>
              {warning && line.bundle.after !== null ? <p className="field-error">환불 필요 {formatWon(line.bundle.after.refundDue)}</p> : null}
              {line.bundle.beforeSale ? <p className="warning">{BEFORE_SALE}</p> : null}
              {line.bundle.canRemember ? (
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={remember.get(line.deposit.no) === true}
                    onChange={(event) =>
                      setRemember((current) => {
                        const next = new Map(current)
                        next.set(line.deposit.no, event.target.checked)
                        return next
                      })
                    }
                  />
                  <span>{REMEMBER_WORDS}</span>
                </label>
              ) : null}
            </li>
          )
        })}
      </ul>
      {error !== null ? <ErrorNote error={error} {...(error.transient ? { onRetry: () => void send() } : {})} /> : null}
    </Modal>
  )
}

// ── 한꺼번에 무시 ─────────────────────────────────────────────────────────

function BulkIgnoreDialog({ deposits, onClose, onDone }: { readonly deposits: readonly DepositView[]; readonly onClose: () => void; readonly onDone: (notice: Notice, done: readonly number[]) => void }) {
  const action = useAction()
  const send = async () => {
    const result = await action.run<BulkResult>('/api/deposits/bulk', { items: deposits.map((deposit) => ({ no: deposit.no, action: 'ignore' })) })
    if (result === null) return
    const done = result.results.flatMap((item) => (item.ok && item.no !== null ? [item.no] : []))
    const failed = result.results.flatMap((item) => (item.ok ? [] : [item]))
    onDone(
      {
        text: failed.length === 0 ? `입금 ${String(done.length)}건을 무시했어요.` : `입금 ${String(done.length)}건을 무시했어요. ${String(failed.length)}건은 무시하지 못했어요.`,
        tone: failed.length === 0 ? 'success' : 'warning',
        lines: failed.map((item) => `${item.no === null ? '입금' : depositLabel(item.no)}: ${item.error.message}`),
      },
      done,
    )
  }
  return (
    <Modal
      title={`선택한 입금 무시 (${String(deposits.length)}건)`}
      onClose={onClose}
      actions={
        <button type="button" className="button button-primary" disabled={action.busy} onClick={() => void send()}>
          {action.busy ? '보내는 중…' : `${String(deposits.length)}건 무시`}
        </button>
      }
    >
      <p>입금 {deposits.length}건을 무시할까요? 정산에는 아무것도 적지 않아요. 무시한 입금은 "무시함"에서 다시 확인 필요로 옮길 수 있어요.</p>
      <ul className="plain-list">
        {deposits.map((deposit) => (
          <li key={deposit.no}>
            {depositLabel(deposit.no)} · {depositName(deposit.name)} · {formatWon(deposit.amount)}
          </li>
        ))}
      </ul>
      {action.error !== null ? <ErrorNote error={action.error} {...(action.error.transient ? { onRetry: () => void send() } : {})} /> : null}
    </Modal>
  )
}

// ── 다른 묶음 지정 (AC-N3-43) ─────────────────────────────────────────────

interface Day {
  readonly date: string
}

/** 찾기 말을 쓰는 동안 기다렸다가 찾는다 */
const SEARCH_DELAY_MS = 250

function BundleSearchDialog({ deposit, onClose, onPick }: { readonly deposit: DepositView; readonly onClose: () => void; readonly onPick: (bundle: BundleView) => void }) {
  const queryId = useId()
  const dateId = useId()
  const [query, setQuery] = useState('')
  const [date, setDate] = useState('')
  const [days, setDays] = useState<readonly string[]>([])
  const [bundles, setBundles] = useState<readonly BundleView[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const ticket = useRef(0)

  useEffect(() => {
    let alive = true
    get<{ days: Day[] }>('/api/days').then(
      (result) => {
        if (alive) setDays(result.days.map((day) => day.date).sort().reverse())
      },
      () => {
        // 날짜 목록을 못 받아도 찾기는 된다 (모든 날짜)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const mine = ++ticket.current
    const handle = setTimeout(
      () => {
        get<{ bundles: BundleView[] }>(withQuery(`/api/deposits/${String(deposit.no)}/bundles`, { q: query.trim() === '' ? undefined : query.trim(), date: date === '' ? undefined : date })).then(
          (result) => {
            if (mine !== ticket.current) return
            setError(null)
            setBundles(result.bundles)
          },
          (caught: unknown) => {
            if (mine !== ticket.current || !isApiError(caught)) return
            setError(caught)
          },
        )
      },
      query === '' ? 0 : SEARCH_DELAY_MS,
    )
    return () => clearTimeout(handle)
  }, [deposit.no, query, date, attempt])

  const sorted = useMemo(() => bundles ?? [], [bundles])
  return (
    <Modal title={`다른 묶음 지정 · ${depositLabel(deposit.no)}`} onClose={onClose} wide>
      <p>
        {depositName(deposit.name)} · {formatWon(deposit.amount)} 입금을 적을 묶음을 골라 주세요.
      </p>
      <div className="toolbar">
        <div className="field">
          <label htmlFor={queryId}>찾을 말 (구매자 이름·닉네임·메모·전화번호 뒤 4자리)</label>
          <input id={queryId} className="input" type="search" autoComplete="off" maxLength={40} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={dateId}>날짜</label>
          <select id={dateId} className="input" value={date} onChange={(event) => setDate(event.target.value)}>
            <option value="">모든 날짜</option>
            {days.map((day) => (
              <option key={day} value={day}>
                {dateLong(day)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error !== null ? <ErrorNote error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 찾기" /> : null}
      {bundles === null && error === null ? <p role="status">찾는 중…</p> : null}
      {bundles !== null && sorted.length === 0 ? <p>맞는 묶음이 없어요.</p> : null}
      {sorted.length > 0 ? (
        <ul className="plain-list stack-tight" aria-label="찾은 묶음">
          {sorted.map((bundle) => {
            const change = bundleChange(bundle)
            return (
              <li key={bundleKey(bundle)}>
                <button type="button" className="choice-button bundle-choice" onClick={() => onPick(bundle)}>
                  <strong>{bundle.name}</strong>
                  <span>{dateLong(bundle.date)} 묶음</span>
                  <span>
                    최종 {formatWon(bundle.total)} · 받은 금액 {formatWon(bundle.received)} · 남은 금액 {formatWon(bundle.remaining)}
                  </span>
                  {change === null ? null : <span className={change.warning ? 'change-warning' : undefined}>{change.text}</span>}
                  {bundle.beforeSale ? <span className="before-sale">{BEFORE_SALE}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </Modal>
  )
}
