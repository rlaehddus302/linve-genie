// 채팅 패널 (AC-S05-21·22, ORD-01 AC2, R-3, NFR-06, D-076·D-088).
// - 오래된 것 위·새것 아래. 시각(KST), 닉네임, 본문. 주문·취소·언급·방송자 표시는 색과 글자를 함께.
// - 본문·닉네임은 React 기본 이스케이프로만 보인다(HTML로 해석하지 않는다).
// - 인스타그램·틱톡 채팅이 있거나 이어진 회차는 줄마다 플랫폼 글자("유튜브"·"인스타그램"·"틱톡")를 붙인다 — 색만으로 구분하지 않는다(N2b-2).
// - 맨 아래를 보고 있으면 새 메시지를 따라 내려가고, 위로 올려 보는 중이면 자리를 지키고 "새 메시지 n개"를 보인다.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage } from '../api/types.ts'
import { compareChars } from '@livejjim/core'
import type { Product } from '../api/types.ts'
import { chatOptionWords, claimWord } from '../lib/derive.ts'
import { usePendingNow } from '../lib/use-pending-now.ts'
import { kstTime } from '../lib/kst.ts'
import { PLATFORM_WORD, platformOfKey } from '../lib/platforms.ts'
import { CHAT_REVIEW_WORD, CHAT_WORD, REVIEW_REASON_WORD } from '../lib/words.ts'
import { useConsoleApi } from './console-context.ts'
// KP1 손님 꼬리표 (CR-7)
import { ChatBadgeMark, useBadgeOf } from './ChatBadges.tsx'
import type { CustomerBadge } from '../lib/ledger.ts'

export interface ChatPanelProps {
  readonly messages: readonly ChatMessage[]
  readonly older: boolean
  readonly loadingOlder: boolean
  readonly onLoadOlder: () => void
  /** 메시지 ID → 5초 대기 중이거나 보낸 변환 결과 문장 */
  readonly convertNotes: ReadonlyMap<string, string>
  /** 봉인한 날짜: 채팅 내용을 지웠다는 서버 문장 (AC-I3-41) */
  readonly sealedMessage?: string | null
  /** 옵션 방송: 확인 필요 메시지의 "확인 필요에서 고르기" (확인 필요 목록을 연다) */
  readonly onReview?: (messageId: string) => void
  /** 줄마다 플랫폼 글자를 붙인다 (인스타그램·틱톡 채팅이 있거나 이어져 있을 때, AC-N2b-2-65) */
  readonly platformTags?: boolean
  /** KP1 채팅 칸 맨 위(목록 위, 고정 영역 밖)에 두는 것 — 콘솔 첫 물음 "방송 화면에 손님 표시" (D-KP1-43) */
  readonly top?: ReactNode
}

/** 옵션 방송의 메시지 표시 (D-O2-12, AC-O2-24) — 서버가 준 optionOrders·review가 있는 메시지만 */
export interface OptionLook {
  /** "주문 21번 M"·"주문 21번 L ×2" */
  readonly orders: readonly string[]
  /** "확인 필요 · 옵션 빠짐" (남은 확인 필요가 없으면 null) */
  readonly review: string | null
  /** 상품(이름·별칭·번호)을 말한 잡담 — "언급" */
  readonly mention: boolean
  /** 옵션 상품을 말했다 (찜으로 바꾸기로는 옵션을 고를 수 없다) */
  readonly optionProduct: boolean
}

/** 옵션 방송 메시지의 표시: 주문은 서버 optionOrders, 확인 필요는 review, 언급은 번호 언급 또는 이 방송 상품의 이름·별칭이 들어간 글 */
export function optionLook(message: ChatMessage, products: readonly Pick<Product, 'no' | 'name' | 'aliases' | 'hasOptions'>[]): OptionLook | null {
  if (message.optionOrders === undefined) return null
  const orders = message.optionOrders.map((order) => `${CHAT_WORD.order} ${String(order.no)}번${order.variant === null ? '' : ` ${order.variant}`}${order.qty > 1 ? ` ×${String(order.qty)}` : ''}`)
  const review = message.review == null ? null : `${CHAT_REVIEW_WORD} · ${REVIEW_REASON_WORD[message.review.reason]}`
  const text = compareChars(message.text)
  const named = products.filter((product) => message.mentions.includes(product.no) || [product.name, ...product.aliases].some((word) => compareChars(word).length >= 2 && text.includes(compareChars(word))))
  const mention = orders.length === 0 && review === null && !message.cancel && !message.ignored && (message.mentions.length > 0 || named.length > 0)
  return { orders, review, mention, optionProduct: named.some((product) => product.hasOptions) || (message.review != null) }
}

const BOTTOM_SLACK = 24

/** 본문 안의 언급 번호를 강조한다 (숫자 덩어리가 언급 번호와 같을 때) */
export function highlightMentions(text: string, mentions: readonly number[]): ReactNode[] {
  if (mentions.length === 0) return [text]
  const wanted = new Set(mentions)
  const parts = text.split(/(\d+)/)
  return parts.map((part, index) => {
    if (index % 2 === 1 && wanted.has(Number(part))) {
      return (
        <mark key={index} className="mention">
          {part}
        </mark>
      )
    }
    return part
  })
}

export function ChatPanel({ messages, older, loadingOlder, onLoadOlder, convertNotes, sealedMessage = null, onReview, platformTags = false, top = null }: ChatPanelProps) {
  const api = useConsoleApi()
  // 찜 낱말 "보류" / "보류 · 시간 지남"은 다른 화면과 같은 판단 (D-MOB2-15)
  const pendingNow = usePendingNow(api.data)
  const badgeOf = useBadgeOf() // KP1
  const list = useRef<HTMLOListElement>(null)
  const atBottom = useRef(true)
  const lastSeq = useRef(0)
  const firstSeq = useRef(0)
  const previousHeight = useRef(0)
  const [unseen, setUnseen] = useState(0)

  useLayoutEffect(() => {
    const element = list.current
    const last = messages.at(-1)?.seq ?? 0
    const first = messages[0]?.seq ?? 0
    if (element !== null) {
      if (atBottom.current) {
        element.scrollTop = element.scrollHeight
      } else if (first < firstSeq.current && last === lastSeq.current) {
        // 이전 메시지를 앞에 붙였다: 보던 자리를 지킨다
        element.scrollTop += element.scrollHeight - previousHeight.current
      } else if (last > lastSeq.current && lastSeq.current !== 0) {
        const added = messages.filter((message) => message.seq > lastSeq.current).length
        setUnseen((count) => count + added)
      }
      previousHeight.current = element.scrollHeight
    }
    lastSeq.current = last
    firstSeq.current = first
  }, [messages])

  useEffect(() => {
    const element = list.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [])

  const onScroll = () => {
    const element = list.current
    if (element === null) return
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK
    atBottom.current = bottom
    previousHeight.current = element.scrollHeight
    if (bottom) setUnseen(0)
  }

  const { openDialog, data } = api
  const onConvert = useCallback((id: string) => openDialog({ kind: 'convert', messageId: id }), [openDialog])
  const products = useMemo(() => [...data.products.values()].filter((product) => product.broadcast === api.b), [data.products, api.b])
  const looks = useMemo(() => new Map(messages.map((message) => [message.id, optionLook(message, products)])), [messages, products])
  // 눌러서 "찜으로 바꾸기"를 펼친 잡담 줄 — 한 번에 한 줄, 다시 누르면 접힘 (AC-UX2-03, D-UX2-01)
  const [openId, setOpenId] = useState<string | null>(null)
  const onToggle = useCallback((id: string) => setOpenId((current) => (current === id ? null : id)), [])

  const toBottom = () => {
    const element = list.current
    if (element !== null) element.scrollTop = element.scrollHeight
    atBottom.current = true
    setUnseen(0)
  }

  return (
    <section className="chat card" aria-label="채팅">
      <h2 className="section-title">채팅</h2>
      {top}
      {older ? (
        <button type="button" className="button" disabled={loadingOlder} onClick={onLoadOlder}>
          {loadingOlder ? '불러오는 중…' : '이전 메시지 보기'}
        </button>
      ) : null}
      <ol ref={list} className="chat-list" aria-label="채팅 메시지" onScroll={onScroll} tabIndex={0}>
        {messages.length === 0 ? <li className="chat-empty">{sealedMessage ?? '아직 채팅이 없어요.'}</li> : null}
        {messages.map((message) => (
          <ChatRow
            key={message.id}
            message={message}
            claimText={message.claims
              .map((id) => {
                const claim = data.claims.get(id)
                return claim === undefined ? '' : `${String(claim.no)}번${chatOptionWords(claim)} ${claimWord(data, claim, pendingNow)}`
              })
              .filter((word) => word !== '')
              .join('|')}
            already={alreadyText(message, looks.get(message.id) ?? null, data.claims)}
            open={openId === message.id}
            onToggle={onToggle}
            note={convertNotes.get(message.id)}
            onConvert={onConvert}
            look={looks.get(message.id) ?? null}
            onReview={onReview}
            platformTag={platformTags}
            badge={message.owner ? undefined : badgeOf(message.channel)}
          />
        ))}
      </ol>
      {unseen > 0 ? (
        <button type="button" className="button new-messages" onClick={toBottom}>
          새 메시지 {unseen}개
        </button>
      ) : null}
    </section>
  )
}

/** "찜으로 바꾸기"를 보이는 메시지: 주문도 취소도 아니었고 무시한 방송자 메시지도 아닌 것 (D-076) */
export function canConvert(message: ChatMessage): boolean {
  return !message.order && !message.cancel && !message.ignored && !message.failed
}

/**
 * 결과 줄이 없는 주문 줄의 "이미 찜함" 표시 (AC-UX2-08~12, D-UX2-03~06). 없으면 ''.
 * 번호 방송: 주문 번호 중 그 메시지로 생긴 찜(같은 번호)이 없는 번호마다 "{번호}번 이미 찜함" ('|'로 이음).
 * 옵션 방송: 주문인데 optionOrders가 비고 확인 필요도 아니고 생긴 찜도 없으면 "이미 찜함".
 * 찜 내용이 아직 오지 않았으면(애매하면) 붙이지 않는다 (D-UX2-06).
 */
export function alreadyText(message: ChatMessage, look: OptionLook | null, claims: ReadonlyMap<string, { readonly no: number }>): string {
  if (!message.order) return ''
  const made = message.claims.map((id) => claims.get(id))
  if (made.some((claim) => claim === undefined)) return ''
  if (look !== null || message.optionOrders !== undefined) {
    return (message.optionOrders ?? []).length === 0 && message.review == null && made.length === 0 ? ALREADY_WORD : ''
  }
  const nos = new Set(made.map((claim) => claim?.no))
  return [...new Set(message.orders)]
    .filter((no) => !nos.has(no))
    .map((no) => `${String(no)}번 ${ALREADY_WORD}`)
    .join('|')
}

function canHover(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches
}

const ALREADY_WORD = '이미 찜함'
export const ALREADY_REASON = '이 분은 이 번호를 이미 찜했어요. 새 찜은 생기지 않았어요.'

interface ChatRowProps {
  /** "이미 찜함" 표시 ('|'로 이음, 없으면 '') */
  readonly already: string
  /** 눌러서 펼친 줄 */
  readonly open: boolean
  readonly onToggle: (id: string) => void
  readonly message: ChatMessage
  /** 그 메시지로 생긴 찜의 지금 상태 ('|'로 이음) */
  readonly claimText: string
  readonly note: string | undefined
  readonly onConvert: (id: string) => void
  /** 옵션 방송 메시지의 표시 (번호 방송은 null — 지금 모양 그대로) */
  readonly look: OptionLook | null
  readonly onReview: ((id: string) => void) | undefined
  /** 플랫폼 글자를 붙인다 */
  readonly platformTag: boolean
  /** KP1 손님 꼬리표 (없으면 undefined) */
  readonly badge?: CustomerBadge | undefined
}

const ChatRow = memo(
  function ChatRow({ message, claimText, already, open, onToggle, note, onConvert, look, onReview, platformTag, badge }: ChatRowProps) {
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  // 누름(마우스·터치)으로 생긴 초점은 키보드 초점으로 치지 않는다 — 다시 누르면 접혀야 한다 (AC-UX2-03)
  const pressing = useRef(false)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reasonFocused, setReasonFocused] = useState(false)
  const alreadyWords = already === '' ? [] : already.split('|')
  const claimWords = claimText === '' ? [] : claimText.split('|')
  const mentioned = look === null ? message.mentions.length > 0 : look.mention
  const classes = ['chat-row']
  if (message.order) classes.push('chat-order')
  if (message.cancel) classes.push('chat-cancel')
  if (mentioned) classes.push('chat-mention')
  if (message.owner) classes.push('chat-owner')
  // 확인 필요 메시지·옵션 상품을 말한 메시지에는 없다 — 찜으로 바꾸기로는 옵션을 고를 수 없다 (D-O2-12)
  const convertible = canConvert(message) && !(look !== null && (look.review !== null || look.optionProduct))
  // 언급 줄은 늘, 잡담 줄은 누름·초점(state)·마우스 올림(CSS, hover: hover 기기만) 때만 (AC-UX2-01~05)
  const chatter = convertible && !mentioned
  const shown = !chatter || open || focused || hovered
  if (chatter) classes.push('chat-chatter')
  if (chatter && open) classes.push('chat-open')
  return (
    <li
      className={classes.join(' ')}
      tabIndex={chatter ? 0 : undefined}
      aria-expanded={chatter ? shown : undefined}
      onClick={
        chatter
          ? (event) => {
              // 터치는 손을 뗀 뒤에 초점이 오므로 누름 표시는 click에서 지운다
              pressing.current = false
              if ((event.target as HTMLElement).closest('button') !== null) return
              onToggle(message.id)
            }
          : undefined
      }
      onKeyDown={
        chatter
          ? (event) => {
              pressing.current = false
              if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault()
                onToggle(message.id)
              }
            }
          : undefined
      }
      onPointerDown={
        chatter
          ? () => {
              pressing.current = true
            }
          : undefined
      }
      // 마우스 올림은 마우스가 있는 기기의 마우스만 (hover: hover, AC-UX2-04) — 터치로 누른 뒤 남지 않는다
      onPointerEnter={
        chatter
          ? (event) => {
              if (event.pointerType === 'mouse' && canHover()) setHovered(true)
            }
          : undefined
      }
      onPointerLeave={chatter ? () => setHovered(false) : undefined}
      onFocus={
        chatter
          ? () => {
              if (!pressing.current) setFocused(true)
            }
          : undefined
      }
      onBlur={
        chatter
          ? (event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
            }
          : undefined
      }
    >
      {/* 시각·닉네임·표시·본문을 한 줄로 이어 쓴다 — 채팅 칸에 메시지가 더 많이 보이게 (AC-S06-62) */}
      <p className="chat-line">
        <time dateTime={message.publishedAt}>{kstTime(message.publishedAt)}</time>{' '}
        {platformTag ? <span className={`tag tag-platform tag-platform-${platformOfKey(message.channel).toLowerCase()}`}>{PLATFORM_WORD[platformOfKey(message.channel)]}</span> : null}
        {platformTag ? ' ' : null}
        <strong className="chat-nick">{message.nick}</strong>
        {badge !== undefined ? <> <ChatBadgeMark badge={badge} /></> : null}
        {message.owner ? <span className="tag tag-owner">{CHAT_WORD.owner}</span> : null}
        {look !== null
          ? look.orders.map((word, index) => (
              <span key={index} className="tag tag-order">
                {word}
              </span>
            ))
          : null}
        {look === null && message.order ? (
          <span className="tag tag-order">
            {CHAT_WORD.order} {message.orders.join(', ')}
          </span>
        ) : null}
        {look?.review != null ? <span className="tag tag-alert">{look.review}</span> : null}
        {message.cancel ? (
          <span className="tag tag-cancel">
            {CHAT_WORD.cancel} {message.cancels.join(', ')}
          </span>
        ) : null}
        {mentioned ? <span className="tag tag-mention">{CHAT_WORD.mention}</span> : null}
        {message.failed ? <span className="tag tag-alert">확인 필요</span> : null}
        {alreadyWords.map((word) => (
          <button
            key={word}
            type="button"
            className="tag tag-already"
            aria-expanded={reasonOpen || reasonFocused}
            onClick={() => setReasonOpen((value) => !value)}
            onFocus={() => setReasonFocused(true)}
            onBlur={() => setReasonFocused(false)}
          >
            {word}
          </button>
        ))}{' '}
        <span className="chat-text">{highlightMentions(message.text, message.mentions)}</span>
      </p>
      {claimWords.length > 0 || note !== undefined ? (
        <p className="chat-claims">
          {claimWords.map((word, index) => (
            <span key={index} className="tag">
              {word}
            </span>
          ))}
          {note !== undefined ? <span className="tag tag-waiting">{note}</span> : null}
        </p>
      ) : null}
      {alreadyWords.length > 0 && (reasonOpen || reasonFocused) ? <p className="chat-already-reason">{ALREADY_REASON}</p> : null}
      {look?.review != null && onReview !== undefined ? (
        <button type="button" className="button button-small chat-convert" onClick={() => onReview(message.id)}>
          확인 필요에서 고르기
        </button>
      ) : null}
      {/* 숨긴 버튼은 hidden — 읽기 프로그램에도 읽히지 않는다. 마우스 올림은 CSS가 보인다 */}
      {convertible ? (
        <button type="button" className="button button-small chat-convert" hidden={!shown} onClick={() => onConvert(message.id)}>
          찜으로 바꾸기
        </button>
      ) : null}
    </li>
  )
  },
)
