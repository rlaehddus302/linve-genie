// 채팅 패널 (AC-S05-21·22, ORD-01 AC2, R-3, NFR-06, D-076·D-088).
// - 오래된 것 위·새것 아래. 시각(KST), 닉네임, 본문. 주문·취소·언급·방송자 표시는 색과 글자를 함께.
// - 본문·닉네임은 React 기본 이스케이프로만 보인다(HTML로 해석하지 않는다).
// - 맨 아래를 보고 있으면 새 메시지를 따라 내려가고, 위로 올려 보는 중이면 자리를 지키고 "새 메시지 n개"를 보인다.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage } from '../api/types.ts'
import { claimWord } from '../lib/derive.ts'
import { kstTime } from '../lib/kst.ts'
import { CHAT_WORD } from '../lib/words.ts'
import { useConsoleApi } from './console-context.ts'

export interface ChatPanelProps {
  readonly messages: readonly ChatMessage[]
  readonly older: boolean
  readonly loadingOlder: boolean
  readonly onLoadOlder: () => void
  /** 메시지 ID → 5초 대기 중이거나 보낸 변환 결과 문장 */
  readonly convertNotes: ReadonlyMap<string, string>
  /** 봉인한 날짜: 채팅 내용을 지웠다는 서버 문장 (AC-I3-41) */
  readonly sealedMessage?: string | null
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

export function ChatPanel({ messages, older, loadingOlder, onLoadOlder, convertNotes, sealedMessage = null }: ChatPanelProps) {
  const api = useConsoleApi()
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

  const toBottom = () => {
    const element = list.current
    if (element !== null) element.scrollTop = element.scrollHeight
    atBottom.current = true
    setUnseen(0)
  }

  return (
    <section className="chat card" aria-label="채팅">
      <h2 className="section-title">채팅</h2>
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
                return claim === undefined ? '' : `${String(claim.no)}번 ${claimWord(data, claim)}`
              })
              .filter((word) => word !== '')
              .join('|')}
            note={convertNotes.get(message.id)}
            onConvert={onConvert}
          />
        ))}
      </ol>
      {unseen > 0 ? (
        <button type="button" className="button button-primary new-messages" onClick={toBottom}>
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

interface ChatRowProps {
  readonly message: ChatMessage
  /** 그 메시지로 생긴 찜의 지금 상태 ('|'로 이음) */
  readonly claimText: string
  readonly note: string | undefined
  readonly onConvert: (id: string) => void
}

const ChatRow = memo(function ChatRow({ message, claimText, note, onConvert }: ChatRowProps) {
  const claimWords = claimText === '' ? [] : claimText.split('|')
  const mentioned = message.mentions.length > 0
  const classes = ['chat-row']
  if (message.order) classes.push('chat-order')
  if (message.cancel) classes.push('chat-cancel')
  if (mentioned) classes.push('chat-mention')
  if (message.owner) classes.push('chat-owner')
  return (
    <li className={classes.join(' ')}>
      {/* 시각·닉네임·표시·본문을 한 줄로 이어 쓴다 — 채팅 칸에 메시지가 더 많이 보이게 (AC-S06-62) */}
      <p className="chat-line">
        <time dateTime={message.publishedAt}>{kstTime(message.publishedAt)}</time> <strong className="chat-nick">{message.nick}</strong>
        {message.owner ? <span className="tag tag-owner">{CHAT_WORD.owner}</span> : null}
        {message.order ? (
          <span className="tag tag-order">
            {CHAT_WORD.order} {message.orders.join(', ')}
          </span>
        ) : null}
        {message.cancel ? (
          <span className="tag tag-cancel">
            {CHAT_WORD.cancel} {message.cancels.join(', ')}
          </span>
        ) : null}
        {mentioned ? <span className="tag tag-mention">{CHAT_WORD.mention}</span> : null}
        {message.failed ? <span className="tag tag-alert">확인 필요</span> : null}{' '}
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
      {canConvert(message) ? (
        <button type="button" className="button button-small chat-convert" onClick={() => onConvert(message.id)}>
          찜으로 바꾸기
        </button>
      ) : null}
    </li>
  )
})
