// 되돌리기 띠 (AC-S05-40·41, D-083): "5초 뒤 보내요: 15번 홍길동 취소"·남은 시간·되돌리기, 등록 직후 "15번을 등록했어요"·되돌리기,
// 보낸 뒤의 결과("적용되지 않았어요…"), 보내지 않은 조치("보내지 않았어요"), 저장 실패의 "다시 보내기".
import { useEffect, useState } from 'react'
import type { UndoItem, UndoQueue } from '../lib/undo-queue.ts'

export const NOT_APPLIED_MESSAGE = '적용되지 않았어요. 지금 상태를 확인해 주세요.'

/** 대기 시간 글자: 5000 → "5초", 300 → "0.3초" */
export function secondsWord(ms: number): string {
  const seconds = Math.round(ms / 100) / 10
  return `${Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)}초`
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const handle = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(handle)
  }, [active])
  return now
}

export function UndoBar({ items, queue }: { readonly items: readonly UndoItem[]; readonly queue: UndoQueue }) {
  const active = items.some((item) => (item.kind === 'action' && item.status === 'waiting') || (item.kind === 'registration' && item.status === 'open'))
  const now = useNow(active)
  if (items.length === 0) return null
  return (
    <section className="undo-bar" aria-label="보내기 전 조치">
      <ul className="plain-list stack-tight">
        {items.map((item) => (
          <li key={item.id} className="undo-item">
            <UndoLine item={item} queue={queue} now={now} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function UndoLine({ item, queue, now }: { readonly item: UndoItem; readonly queue: UndoQueue; readonly now: number }) {
  const left = Math.max(0, Math.ceil((item.deadline - now) / 1000))
  if (item.kind === 'registration') {
    switch (item.status) {
      case 'open':
        return (
          <>
            <span role="status">{item.no}번을 등록했어요</span>
            <span className="countdown">남은 시간 {left}초</span>
            <button type="button" className="button" aria-label={`${String(item.no)}번 등록 되돌리기`} onClick={() => queue.undo(item.id)}>
              되돌리기
            </button>
          </>
        )
      case 'undoing':
        return <span role="status">{item.no}번 등록을 되돌리는 중…</span>
      default:
        return (
          <>
            <span role="status">{item.message ?? ''}</span>
            <button type="button" className="button" onClick={() => queue.dismiss(item.id)}>
              확인
            </button>
          </>
        )
    }
  }
  switch (item.status) {
    case 'waiting':
      return (
        <>
          <span role="status" className="tag-waiting-text">
            {secondsWord(queue.delayMs)} 뒤 보내요: {item.label}
          </span>
          <span className="countdown">남은 시간 {left}초</span>
          <button type="button" className="button" aria-label={`${item.label} 되돌리기`} onClick={() => queue.undo(item.id)}>
            되돌리기
          </button>
        </>
      )
    case 'sending':
    case 'retrying':
      return <span role="status">보내는 중…: {item.label}</span>
    case 'done':
      return <span role="status">보냈어요: {item.label}</span>
    case 'notApplied':
      return (
        <>
          <span role="status">
            {item.label} — {NOT_APPLIED_MESSAGE}
          </span>
          <button type="button" className="button" onClick={() => queue.dismiss(item.id)}>
            확인
          </button>
        </>
      )
    case 'cancelled':
      return <span role="status">보내지 않았어요: {item.label}</span>
    case 'failed':
      return (
        <>
          <span role="alert">
            {item.label} — {item.error?.retryable === true ? `저장하지 못했어요. ${item.error.code === 'SAVE_FAILED' ? '' : item.error.message}` : (item.error?.message ?? '보내지 못했어요.')}
            {item.error?.problems.map((problem) => ` ${problem.message}${problem.hint !== undefined ? ` ${problem.hint}` : ''}`).join('')}
          </span>
          {item.error?.transient === true ? (
            <button type="button" className="button" onClick={() => queue.resend(item.id)}>
              다시 보내기
            </button>
          ) : null}
          <button type="button" className="button" onClick={() => queue.dismiss(item.id)}>
            확인
          </button>
        </>
      )
  }
}
