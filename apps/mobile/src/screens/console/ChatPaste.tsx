// 방송 화면의 채팅 보기 (D-APPX-03 — 웹 ChatPanel과 같은 규칙·문구, AC-S05-21·22, D-N2b-2-07·08·14).
// 채팅: 최근 100줄(오래된 것 위·새것 아래). 시각·닉네임·본문, 주문·취소·언급·방송자는 글자로 함께. 찜이 생긴 줄은 그 찜의 지금 상태.
//   본문·닉네임은 글자로만 그린다. 창이 열린 동안 그 범위가 바뀌면 짧게 모아 다시 읽는다. 봉인한 날짜는 서버 문장.
// 댓글 붙여넣기는 앱에서 없앴다 (D-UX4-78, 사용자 지시 2026-11-10) — 웹에는 남아 있다.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { ChatMessage, MessagesView } from '@livejjim/web/src/api/types.ts'
import { kstTime } from '@livejjim/web/src/lib/kst.ts'
import { CHAT_WORD } from '@livejjim/web/src/lib/words.ts'
import { get, isApiError, withQuery, type ApiError } from '../../api/client.ts'
import { claimWord } from '../../lib/derive.ts'
import { useServices } from '../../services.tsx'
import { Body, Hint, Notice, Row, Tag } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'

export const CHAT_LIMIT = 100
export const NO_CHAT = '아직 채팅이 없어요.'
const RELOAD_MS = 500

/** 채팅 줄의 표시 글자 (색만으로 구분하지 않는다) */
export function chatTags(message: Pick<ChatMessage, 'owner' | 'order' | 'cancel' | 'mentions' | 'orders' | 'cancels'>): string[] {
  const out: string[] = []
  if (message.owner) out.push(CHAT_WORD.owner)
  if (message.order) out.push(`${CHAT_WORD.order} ${message.orders.map((no) => `${String(no)}번`).join('·')}`)
  if (message.cancel) out.push(`${CHAT_WORD.cancel} ${message.cancels.map((no) => `${String(no)}번`).join('·')}`)
  if (!message.order && !message.cancel && message.mentions.length > 0) out.push(`${CHAT_WORD.mention} ${message.mentions.map((no) => `${String(no)}번`).join('·')}`)
  return out
}

/** 이 방송의 최근 채팅 (창이 열린 동안 범위가 바뀌면 짧게 모아 다시 읽는다) — 채팅 보기·찜 기록이 함께 쓴다 */
export function useMessages(): { readonly view: MessagesView | null; readonly error: ApiError | null } {
  const api = useConsoleApi()
  const { stream } = useServices()
  const [view, setView] = useState<MessagesView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const rehearsal = api.data.rehearsal
  const path = withQuery(`/api/days/${api.data.date}/messages`, { b: api.b, limit: CHAT_LIMIT, rehearsal })
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      get<MessagesView>(path).then(
        (next) => {
          if (!alive) return
          setView(next)
          setError(null)
        },
        (caught: unknown) => {
          if (alive && isApiError(caught)) setError(caught)
        },
      )
    void load()
    const source = stream.open()
    source.addEventListener('change', () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        void load()
      }, RELOAD_MS)
    })
    return () => {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
      source.close()
    }
  }, [path, stream])
  return { view, error }
}

export function ChatView() {
  const api = useConsoleApi()
  const { view, error } = useMessages()
  if (view === null) return error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : <Hint>불러오는 중…</Hint>
  if (view.sealed === true) return <Notice tone="info">{view.sealedMessage ?? '봉인한 날짜라 채팅 내용을 지웠어요.'}</Notice>
  if (view.messages.length === 0) return <Hint>{NO_CHAT}</Hint>
  return (
    <View style={{ gap: 8 }} role="list" aria-label="채팅">
      {view.messages.map((message) => {
        const tags = chatTags(message)
        const claims = message.claims.map((id) => api.data.claims.get(id)).filter((claim) => claim !== undefined)
        return (
          <View key={message.id} role="listitem" style={{ gap: 2 }}>
            <Row wrap>
              <Hint>{kstTime(message.at)}</Hint>
              <Body bold>{message.nick}</Body>
              {tags.map((tag) => (
                <Tag key={tag} tone={tag.startsWith(CHAT_WORD.cancel) ? 'warning' : tag.startsWith(CHAT_WORD.order) ? 'success' : 'info'}>{tag}</Tag>
              ))}
            </Row>
            <Body>{message.text}</Body>
            {claims.map((claim) => (
              <Hint key={claim.id}>{`${String(claim.no)}번 · ${claimWord(api.data, claim)}`}</Hint>
            ))}
          </View>
        )
      })}
    </View>
  )
}
