// 콘솔 채팅 줄 손님 꼬리표 (KP1 CR-7, AC-KP1-14~16): 시청자 이름 뒤 작은 꼬리표 하나 — "입금 늦음 주의"·"단골 · 누적 125,000원"·"처음".
// - 누르는 것이 아니다. 글자 + 색(색만으로 가르지 않는다). 화면 읽기 프로그램엔 "손님: 단골, 누적 125,000원".
// - 실제 방송만(리허설은 받지 않는다). 설정 "방송 화면에 손님 표시"를 끄면 꼬리표와 1등 옆 "입금 늦음 주의"가 모두 사라진다.
// - 표시만 한다 — 판정·대기·승계·라벨·감사 메시지·정산과 상관없다.
import { createContext, useContext, useRef, useState } from 'react'
import {
  CONSOLE_BADGES_ASK,
  CONSOLE_BADGES_ASK_DETAIL,
  CONSOLE_BADGES_ASK_FAILED,
  CONSOLE_BADGES_HIDE,
  CONSOLE_BADGES_SHOW,
  badgeSpokenOf,
  badgeTone,
  type CustomerBadge,
} from '../lib/ledger.ts'
import type { CautionOf } from './caution.tsx'

/** 구매자 → 꼬리표 (없으면 undefined) */
export type BadgeOf = (buyer: string) => CustomerBadge | undefined

const NONE: BadgeOf = () => undefined

export const ChatBadgesContext = createContext<BadgeOf>(NONE)

export const useBadgeOf = (): BadgeOf => useContext(ChatBadgesContext)

/** 설정을 끈 콘솔의 1등 옆 꼬리표 (아무도 주의가 아니다) */
export const HIDDEN_CAUTION: CautionOf = () => false

/** 받은 꼬리표 지도 → 찾기 함수 */
export function badgeLookup(badges: ReadonlyMap<string, CustomerBadge>): BadgeOf {
  return badges.size === 0 ? NONE : (buyer) => badges.get(buyer)
}

const TONE_CLASS = { caution: 'tag-caution', regular: 'tag-regular', first: 'tag-first' } as const

/** 이름 뒤 꼬리표 (글이 없으면 그리지 않는다) */
export function ChatBadgeMark({ badge }: { readonly badge: CustomerBadge | undefined }) {
  if (badge === undefined || badge.text === null || badge.text === '') return null
  return (
    <span className={`tag badge-mark ${TONE_CLASS[badgeTone(badge.text)]}`}>
      <span aria-hidden="true">{badge.text}</span>
      <span className="sr-only">{badgeSpokenOf(badge)}</span>
    </span>
  )
}

/**
 * 콘솔에서 처음 한 번 묻는 띠 (UX-KP1-006): 판매자가 "방송 화면에 손님 표시"를 아직 정하지 않았을 때만(실제 방송).
 * [보이기]·[안 보이기] → 설정에 저장(PUT /api/ledger-settings). 정할 때까지 꼬리표는 보이지 않는다.
 */
export function ConsoleBadgesAsk({ onDecide }: { readonly onDecide: (value: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const sending = useRef(false)
  const decide = async (value: boolean) => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setFailed(false)
    try {
      await onDecide(value)
    } catch {
      setFailed(true)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return (
    <section className="badges-ask kp1-seller" aria-label="방송 화면에 손님 표시 정하기">
      <p>
        <strong>{CONSOLE_BADGES_ASK}</strong>
      </p>
      <p>{CONSOLE_BADGES_ASK_DETAIL}</p>
      <div className="row" role="group" aria-label="방송 화면에 손님 표시">
        <button type="button" className="button" disabled={busy} onClick={() => void decide(true)}>
          {CONSOLE_BADGES_SHOW}
        </button>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void decide(false)}>
          {CONSOLE_BADGES_HIDE}
        </button>
      </div>
      {failed ? (
        <p className="field-error" role="alert">
          {CONSOLE_BADGES_ASK_FAILED}
        </p>
      ) : null}
    </section>
  )
}
