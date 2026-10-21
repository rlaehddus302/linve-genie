// 판매대장 내보내기 창 (STL-06 "기간·방송 선택해서 내보낸다", D-I2-03, D-101, AC-I2-22).
// - "시작 날짜"·"끝 날짜": 실제 범위 날짜에서 고른다(기본 = 보고 있는 날짜, 연도·요일까지 "2026년 10월 18일(일)").
// - 그 기간의 실제 방송 목록(날짜·제목 — 체크, 기본 모두, "모두 고르기"·"모두 풀기"). 기간을 바꾸면 그 기간 것으로 바뀌고
//   전에 고른 방송 중 기간 안 것은 고른 채다(새로 들어온 방송은 기본대로 고름). 하나도 고르지 않으면 "엑셀 내려받기"가 잠긴다.
// - 서버가 거절하면 서버 문장 그대로. 리허설 범위는 대장에 넣지 않는다(이 창은 실제 범위에서만 연다).
import { useEffect, useId, useMemo, useState } from 'react'
import { get, isApiError, type ApiError } from '../api/client.ts'
import type { BroadcastItem } from '../api/types.ts'
import { dateLong } from '../lib/kst.ts'
import { useDownload } from './downloads.tsx'
import { RequestError } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

export const PICK_ONE_BROADCAST = '방송을 하나 이상 골라 주세요.'
export const START_AFTER_END = '시작 날짜가 끝 날짜보다 늦어요.'
export const NO_BROADCAST_IN_PERIOD = '고른 기간에 방송이 없어요.'

export interface LedgerDialogProps {
  /** 보고 있는 날짜 (기본 기간) */
  readonly date: string
  readonly onClose: () => void
}

/** 판매대장 요청 주소: 기간 안 방송을 모두 골랐으면 b를 적지 않는다(서버 = 기간 안 모든 실제 방송) */
export function ledgerPath(from: string, to: string, picked: readonly string[], all: boolean): string {
  const params = new URLSearchParams({ from, to })
  if (!all) for (const id of picked) params.append('b', id)
  return `/api/ledger.xlsx?${params.toString()}`
}

export function LedgerDialog({ date, onClose }: LedgerDialogProps) {
  const id = useId()
  const [days, setDays] = useState<readonly string[] | null>(null)
  const [broadcasts, setBroadcasts] = useState<readonly BroadcastItem[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [from, setFrom] = useState(date)
  const [to, setTo] = useState(date)
  /** 판매자가 푼 방송 (기본은 모두 고름 — 기간에 새로 들어온 방송은 고른 채로 보인다) */
  const [unpicked, setUnpicked] = useState<ReadonlySet<string>>(new Set())
  const download = useDownload()

  useEffect(() => {
    let alive = true
    setLoadError(null)
    Promise.all([get<{ days: { date: string }[] }>('/api/days'), get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')]).then(
      ([real, list]) => {
        if (!alive) return
        setDays(real.days.map((day) => day.date))
        setBroadcasts(list.broadcasts.filter((item) => !item.rehearsal))
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setLoadError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  const options = useMemo(() => {
    const set = new Set(days ?? [])
    set.add(date)
    return [...set].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  }, [days, date])
  const ordered = from <= to
  const inPeriod = useMemo(
    () => (broadcasts ?? []).filter((item) => ordered && item.date >= from && item.date <= to).sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1)),
    [broadcasts, from, to, ordered],
  )
  const picked = inPeriod.filter((item) => !unpicked.has(item.id)).map((item) => item.id)
  const all = picked.length === inPeriod.length
  const problem = !ordered ? START_AFTER_END : broadcasts !== null && inPeriod.length === 0 ? NO_BROADCAST_IN_PERIOD : picked.length === 0 ? PICK_ONE_BROADCAST : null

  const toggle = (broadcast: string) =>
    setUnpicked((set) => {
      const next = new Set(set)
      if (next.has(broadcast)) next.delete(broadcast)
      else next.add(broadcast)
      return next
    })

  const dayField = (label: string, value: string, onChange: (value: string) => void, suffix: string) => (
    <div className="field">
      <label htmlFor={`${id}-${suffix}`}>{label}</label>
      <select id={`${id}-${suffix}`} className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((day) => (
          <option key={day} value={day}>
            {dateLong(day)}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <Modal
      title="판매대장 엑셀"
      onClose={onClose}
      wide
      actions={
        <button type="button" className="button button-primary" disabled={problem !== null || broadcasts === null || download.busy} onClick={() => void download.run(ledgerPath(from, to, picked, all), `ledger-${from}.xlsx`)}>
          엑셀 내려받기
        </button>
      }
    >
      {loadError !== null ? <RequestError error={loadError} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : null}
      <div className="ledger-period">
        {dayField('시작 날짜', from, setFrom, 'from')}
        {dayField('끝 날짜', to, setTo, 'to')}
      </div>
      {broadcasts === null && loadError === null ? <p role="status">방송 목록을 불러오는 중…</p> : null}
      {inPeriod.length > 0 ? (
        <fieldset className="ledger-broadcasts stack-tight">
          <legend>방송 고르기</legend>
          <div className="row">
            <button type="button" className="button" onClick={() => setUnpicked(new Set([...unpicked].filter((item) => !inPeriod.some((b) => b.id === item))))}>
              모두 고르기
            </button>
            <button type="button" className="button" onClick={() => setUnpicked(new Set([...unpicked, ...inPeriod.map((item) => item.id)]))}>
              모두 풀기
            </button>
          </div>
          <ul className="plain-list choice-list-plain" aria-label="판매대장에 넣을 방송">
            {inPeriod.map((item) => (
              <li key={item.id}>
                <label className="choice">
                  <input type="checkbox" checked={!unpicked.has(item.id)} onChange={() => toggle(item.id)} />
                  <span>
                    {dateLong(item.date)} · {item.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      {problem !== null && broadcasts !== null ? (
        <p className="field-error" role="alert">
          {problem}
        </p>
      ) : null}
      {download.busy ? <p role="status">판매대장을 만드는 중이에요…</p> : null}
      {download.error !== null ? <RequestError error={download.error} /> : null}
    </Modal>
  )
}
