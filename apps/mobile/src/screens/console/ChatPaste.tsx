// 방송 화면의 채팅 보기·댓글 붙여넣기 (D-APPX-03 — 웹 ChatPanel·PasteDialog와 같은 규칙·문구, AC-S05-21·22, D-N2b-2-07·08·14).
// 채팅: 최근 100줄(오래된 것 위·새것 아래). 시각·닉네임·본문, 주문·취소·언급·방송자는 글자로 함께. 찜이 생긴 줄은 그 찜의 지금 상태.
//   본문·닉네임은 글자로만 그린다. 창이 열린 동안 그 범위가 바뀌면 짧게 모아 다시 읽는다. 봉인한 날짜는 서버 문장.
// 붙여넣기: 글 → "미리 보기"(아무것도 기록하지 않는다) → 줄마다 서버 문장, 겹친 줄은 "그래도 넣기" → "찜 N개 넣기"(같은 글이면 같은 요청 번호).
//   글을 고치면 미리 보기를 다시 해야 넣을 수 있다. 처음 넣기를 누른 뒤에는 고르기를 잠근다(응답을 잃은 경우만 — 확정 거절이면 푼다).
import { useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { ChatMessage, MessagesView, PastePlanView } from '@livejjim/web/src/api/types.ts'
import { kstTime } from '@livejjim/web/src/lib/kst.ts'
import { CHAT_WORD } from '@livejjim/web/src/lib/words.ts'
import { PASTE_INCLUDE_OVERLAP, PASTE_STALE, pasteButtonLabel, pasteDoneMessage, pasteGroupMessage, pasteGroups, pasteOverlapCount } from '@livejjim/web/src/lib/platforms.ts'
import { get, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../../api/client.ts'
import { claimWord } from '../../lib/derive.ts'
import { useServices } from '../../services.tsx'
import { BigButton, Body, Field, Hint, Notice, Row, Tag } from '../../ui/parts.tsx'
import { ToggleRow } from '../../ui/kit/index.ts'
import { useConsoleApi } from './context.ts'

export const CHAT_LIMIT = 100
export const NO_CHAT = '아직 채팅이 없어요.'
export const APP_PASTE_GUIDE = "라이브 화면의 댓글을 '닉네임: 댓글' 한 줄씩 붙여 넣어 주세요."
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

export function ChatView() {
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

interface Previewed {
  readonly text: string
  readonly plan: PastePlanView
  readonly requestId: string
  readonly include: ReadonlySet<number>
  readonly sent: boolean
}
const NO_LINES: ReadonlySet<number> = new Set()

export function PasteView({ onDone }: { readonly onDone: (message: string) => void }) {
  const api = useConsoleApi()
  const [text, setText] = useState('')
  const [previewed, setPreviewed] = useState<Previewed | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<ApiError | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<ApiError | null>(null)
  const sendingRef = useRef(false)
  const base = `/api/broadcasts/${encodeURIComponent(api.b)}`
  const stale = previewed !== null && previewed.text !== text
  const plan = previewed?.plan ?? null
  const include = previewed?.include ?? NO_LINES
  const locked = previewed?.sent === true
  const total = plan === null ? 0 : plan.total + pasteOverlapCount(plan.rows, include)
  const canSend = previewed !== null && !stale && total > 0 && !sending

  const preview = async () => {
    if (previewing || sending) return
    const current = text
    setPreviewing(true)
    setPreviewError(null)
    setSendError(null)
    try {
      const result = await withRetry(() => post<PastePlanView>(`${base}/paste/preview`, { text: current }))
      setPreviewed((before) => (before !== null && before.text === current ? { ...before, plan: result } : { text: current, plan: result, requestId: newRequestId(), include: NO_LINES, sent: false }))
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      setPreviewed(null)
      setPreviewError(caught)
    } finally {
      setPreviewing(false)
    }
  }

  const send = async () => {
    if (!canSend || previewed === null || sendingRef.current) return
    sendingRef.current = true
    const { requestId, text: body } = previewed
    const includeOverlaps = [...previewed.include].sort((a, b) => a - b)
    setPreviewed({ ...previewed, sent: true })
    setSending(true)
    setSendError(null)
    try {
      const result = await withRetry(() => post<PastePlanView>(`${base}/paste`, { requestId, text: body, includeOverlaps }))
      onDone(pasteDoneMessage(result.added ?? result.total, pasteOverlapCount(result.rows)))
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      if (!caught.transient) setPreviewed((before) => (before !== null && before.requestId === requestId ? { ...before, sent: false } : before))
      setSendError(caught)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const toggle = (line: number, on: boolean) =>
    setPreviewed((before) => {
      if (before === null || before.sent) return before
      const next = new Set(before.include)
      if (on) next.add(line)
      else next.delete(line)
      return { ...before, include: next }
    })

  return (
    <View style={{ gap: 10 }}>
      <Hint>{APP_PASTE_GUIDE}</Hint>
      <Field label="붙여 넣을 댓글" value={text} onChangeText={setText} multiline numberOfLines={6} autoCorrect={false} autoCapitalize="none" />
      <BigButton label={previewing ? '보는 중…' : '미리 보기'} disabled={sending || text.trim() === ''} onPress={() => void preview()} />
      {previewError !== null ? <Notice tone="danger" alert>{previewError.message}</Notice> : null}
      {stale ? <Notice tone="warning">{PASTE_STALE}</Notice> : null}
      {plan !== null && !stale ? (
        <View style={{ gap: 6 }} role="group" aria-label="미리 보기">
          <Body bold>{`넣을 찜 ${String(total)}개`}</Body>
          <ScrollView style={{ maxHeight: 320 }}>
            {plan.rows.map((row) => (
              <View key={row.line} style={{ gap: 2, paddingVertical: 4 }}>
                <Body>{`${String(row.line)}줄 ${row.nickname ?? ''} ${row.message}`.replace(/\s+/g, ' ').trim()}</Body>
                {row.overlaps !== undefined && row.overlaps.length > 0 && row.overlapMessage !== undefined ? (
                  <>
                    <Hint>{row.overlapMessage}</Hint>
                    <ToggleRow title={PASTE_INCLUDE_OVERLAP} on={include.has(row.line)} disabled={locked || sending} onChange={(on) => toggle(row.line, on)} />
                  </>
                ) : null}
              </View>
            ))}
          </ScrollView>
          {pasteGroups(plan, include).map((group) => (
            <Hint key={group.nickname}>{`${group.nickname} · ${pasteGroupMessage(group.lines.length)}`}</Hint>
          ))}
          <BigButton primary label={pasteButtonLabel(total)} disabled={!canSend} onPress={() => void send()} />
        </View>
      ) : null}
      {sendError !== null ? (
        <View style={{ gap: 6 }}>
          <Notice tone="danger" alert>{sendError.message}</Notice>
          {sendError.transient ? <BigButton label="다시 보내기" onPress={() => void send()} /> : null}
        </View>
      ) : null}
    </View>
  )
}
