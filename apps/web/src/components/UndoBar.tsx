// 되돌리기 띠 (AC-S05-40·41, D-083): "5초 뒤 보내요: 15번 홍길동 취소"·남은 시간·되돌리기, 등록 직후 "15번을 등록했어요"·되돌리기,
// 보낸 뒤의 결과("적용되지 않았어요…"), 보내지 않은 조치("보내지 않았어요"), 저장 실패의 "다시 보내기",
// 서버가 입력을 거절한 조치의 "사유 고치기"(창을 다시 연다).
// MOB2: 1등 자리를 비운 조치의 결과 한 줄 10초("15번 새 1등: 김철수" — D-MOB2-04), 연결이 돌아와 저절로 보낸 것의 앞말
// "연결이 돌아와 보냈어요: "·다시 보낼 실패의 "연결이 돌아오면 저절로 다시 보내요. …" (D-MOB2-07·16).
// 승계 결정이 필요한 결과 줄에는 "1등 고르기" — 그 상품의 승계 결정 창을 연다(onPick을 넘긴 화면만, D-MOB2-16 (1)).
import { useEffect, useState } from 'react'
import { AUTO_RESEND_NOTE, RESENDING_WORD, RESENT_PREFIX } from '../lib/resend-board.ts'
import type { SuccessionPick, UndoItem, UndoQueue } from '../lib/undo-queue.ts'

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

export function UndoBar({ items, queue, onPick }: { readonly items: readonly UndoItem[]; readonly queue: UndoQueue; readonly onPick?: (pick: SuccessionPick) => void }) {
  const active = items.some((item) => (item.kind === 'action' && item.status === 'waiting' && item.pausedLeft === null) || (item.kind === 'registration' && item.status === 'open'))
  const now = useNow(active)
  if (items.length === 0) return null
  return (
    <section className="undo-bar" aria-label="보내기 전 조치">
      <ul className="plain-list stack-tight">
        {items.map((item) => (
          <li key={item.id} className="undo-item" data-tone={undoTone(item)}>
            <UndoLine item={item} queue={queue} now={now} {...(onPick === undefined ? {} : { onPick })} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 띠 한 줄의 뜻 (D-102): 보내기 전은 주의, 보냄·되돌림 완료는 성공, 적용 안 됨은 주의, 저장 실패는 위험, 그 밖은 보통 */
export function undoTone(item: UndoItem): 'success' | 'warning' | 'danger' | 'info' {
  if (item.kind === 'registration') {
    switch (item.status) {
      case 'undone':
        return 'success'
      case 'blocked':
        return 'warning'
      case 'failed':
        return 'danger'
      default:
        return 'info'
    }
  }
  switch (item.status) {
    case 'waiting':
    case 'notApplied':
      return 'warning'
    case 'done':
      return 'success'
    case 'outcome':
      return item.outcome?.tone ?? 'info'
    case 'failed':
      return 'danger'
    default:
      return 'info'
  }
}

function UndoLine({ item, queue, now, onPick }: { readonly item: UndoItem; readonly queue: UndoQueue; readonly now: number; readonly onPick?: (pick: SuccessionPick) => void }) {
  // 떠날지 묻는 동안은 시계가 멈춰 있다 (남은 시간 그대로)
  // 처음 그릴 때 시계(now)가 줄이 생기기 전 값이라 대기 시간보다 큰 초가 잠깐 보이지 않게 대기 시간으로 상한 (U-MOB2-07)
  const cap = Math.ceil((item.kind === 'registration' ? queue.registerUndoMs : queue.delayMs) / 1000)
  const left = Math.min(cap, Math.max(0, Math.ceil((item.kind === 'action' && item.pausedLeft !== null ? item.pausedLeft : item.deadline - now) / 1000)))
  if (item.kind === 'registration') {
    switch (item.status) {
      case 'open':
        return (
          <>
            <span role="status">
              {item.auto ? RESENT_PREFIX : ''}
              {item.no}번을 등록했어요
            </span>
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
      return <span role="status">{item.auto ? RESENDING_WORD : '보내는 중…'}: {item.label}</span>
    case 'done':
      return <span role="status">{item.auto ? RESENT_PREFIX : '보냈어요: '}{item.label}</span>
    case 'outcome': {
      // 1등 자리를 비운 조치의 결과 (이름은 글로만 — React 이스케이프)
      const pick = item.outcome?.pick
      return (
        <>
          <span role="status">{item.outcome?.text ?? ''}</span>
          {pick !== undefined && onPick !== undefined ? (
            <button type="button" className="button" onClick={() => onPick(pick)}>
              1등 고르기
            </button>
          ) : null}
          <button type="button" className="button" onClick={() => queue.dismiss(item.id)}>
            확인
          </button>
        </>
      )
    }
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
            {item.error?.retryable === true ? ` ${AUTO_RESEND_NOTE}` : ''}
          </span>
          {item.reopenLabel !== null ? (
            <button type="button" className="button" aria-label={`${item.label} ${item.reopenLabel}`} onClick={() => queue.reopen(item.id)}>
              {item.reopenLabel}
            </button>
          ) : null}
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
