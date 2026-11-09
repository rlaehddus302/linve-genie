// 방송 화면 "채팅·문자" 탭 (D-UX4-12, 사용자 지시 2026-11-08 "방송 중 화면에서 실시간 채팅, 문자 오는거 볼 수 있게 찜 기록 옆에 새로운 탭으로").
// - 채팅: 이 방송의 최근 채팅(찜 기록·채팅 보기와 같은 useMessages — 범위가 바뀌면 다시 읽는다). 주문·취소·언급·방송자 표시는 채팅 보기와 같은 글자.
// - 문자: 휴대폰 알림 받기로 서버에 온 손님 문자(GET /api/inbox/sms — 서버 메모리, 최신이 앞). 실시간 `inbox` { kind: 'sms', b }가 오면 다시 읽는다.
// - 둘을 받은 시각으로 섞는다(정렬은 최신이 위, 화면은 최신이 맨 아래 — D-UX3-75). 한 줄에 시각(23:23, 폭 고정 칸)·닉네임(문자는 "문자-끝번호")·결과 꼬리표(찜 금색·대기 회색)·내용(D-UX4-66), 줄 바탕·출처 꼬리표 없음(D-UX3-80·82).
//   본문·닉네임·보낸 이름은 손님이 쓴 글이라 글자로만 그린다. 판정은 하지 않는다(서버가 한 일을 낱말로만).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Platform, ScrollView, View, type ScrollViewInstance } from 'react-native'
import type { SmsFeedView } from '@livejjim/web/src/api/inbox-types.ts'
import type { Claim, MessagesView } from '@livejjim/web/src/api/types.ts'
import { kstHm } from '@livejjim/web/src/lib/kst.ts'
import { CHAT_WORD } from '@livejjim/web/src/lib/words.ts'
import { get, isApiError, withQuery } from '../../api/client.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { claimWord, waitPosition } from '../../lib/derive.ts'
import { useServices } from '../../services.tsx'
import { EmptyFill, Icon, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import type { Tone } from '../../ui/kit/tokens.ts'
import { TAG_PAD_X } from '../../lib/product-tags.ts'
import { Notice } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'
import { useMessages } from './ChatPaste.tsx'
import { HEARD_LOG_HEIGHT, useOpenMotion } from './StreamAudio.tsx'

export const TALK_TAB = '채팅·문자'
export const TALK_EMPTY = '아직 채팅·문자가 없어요'
export const TALK_EMPTY_BODY = '손님이 채팅이나 문자를 보내면\n바로 보여드릴게요'
export const TALK_LIMIT = 150
const SMS_RELOAD_MS = 300

export interface TalkRow {
  readonly key: string
  readonly at: number
  /** 채팅 닉네임 · 문자는 "문자-끝번호" (D-UX3-80) */
  readonly who: string
  readonly text: string
  /** 그 글이 만든 결과 꼬리표 (243번 찜 — 금색 · 342번 대기 1 — 회색 · 찜 아님 …). 낱말로도 구분한다 (D-UX3-82) */
  readonly tags: readonly TalkTag[]
}

/** win 찜(1등) 금색 · wait 대기 회색 · 그 밖은 상태 색 */
export interface TalkTag {
  readonly word: string
  readonly kind: 'win' | 'wait' | Tone
}

const each = (numbers: readonly number[], word: string, kind: TalkTag['kind']): TalkTag[] => numbers.map((no) => ({ word: `${String(no)}번 ${word}`, kind }))

/** 서버가 그 문자로 한 일 → 꼬리표 (243번 찜 · 15번 취소 요청 · 찜 아님 …) */
export function smsWord(entry: Pick<SmsFeedView, 'result' | 'numbers'>): TalkTag[] {
  const has = entry.numbers.length > 0
  switch (entry.result) {
    case 'claim':
      return has ? each(entry.numbers, '찜', 'win') : [{ word: '찜', kind: 'win' }]
    case 'cancel':
      return has ? each(entry.numbers, CHAT_WORD.cancel, 'warning') : [{ word: CHAT_WORD.cancel, kind: 'warning' }]
    case 'review':
      return has ? each(entry.numbers, '확인 필요', 'warning') : [{ word: '확인 필요', kind: 'warning' }]
    case 'info':
      return [{ word: '손님 정보', kind: 'info' }]
    case 'stale':
      return [{ word: '넣지 않음', kind: 'danger' }]
    default:
      return [{ word: '찜 아님', kind: 'neutral' }]
  }
}

/** 보낸 사람 — "문자-끝4자리" (전체 번호는 쓰지 않는다), 휴대폰 번호가 아니면 "문자-보낸 이름" (D-UX3-80) */
export function smsWho(entry: Pick<SmsFeedView, 'last4' | 'sender'>): string {
  if (entry.last4 !== null) return `문자-${entry.last4}`
  return entry.sender !== null && entry.sender.trim() !== '' ? `문자-${entry.sender.trim()}` : '문자'
}

/**
 * 채팅이 만든 찜의 지금 상태 → 꼬리표 (D-UX4-66, 사용자 지시 2026-11-10 "[...번 취소됨], [...번 취소], [...번 찜], [...번 대기 1]"):
 * 모두 "번호번 낱말" 꼴 — 찜(금색) · 대기 n(회색) · 취소됨(회색) · 보류·충돌·중복·품절·판매 중 아님 … (주의 색)
 */
export function chatClaimTag(data: ScopeData, claim: Claim): TalkTag {
  const no = `${String(claim.no)}번`
  if (claim.status === 'CONFIRMED') return { word: `${no} 찜`, kind: 'win' }
  if (claim.status === 'WAITLISTED') {
    const at = waitPosition(data, claim)
    return { word: at === null ? `${no} 대기` : `${no} 대기 ${String(at)}`, kind: 'wait' }
  }
  if (claim.status === 'CANCELLED') return { word: `${no} 취소됨`, kind: 'wait' }
  return { word: `${no} ${claimWord(data, claim)}`, kind: 'warning' }
}

/** 찜이 아직 없는 채팅 — 서버가 읽은 낱말을 번호마다 "15번 주문" · "15번 취소" · "15번 언급" · "방송자" */
export function chatWordTags(message: Pick<MessagesView['messages'][number], 'owner' | 'order' | 'cancel' | 'mentions' | 'orders' | 'cancels'>): TalkTag[] {
  const out: TalkTag[] = []
  if (message.owner) out.push({ word: CHAT_WORD.owner, kind: 'info' })
  if (message.order) out.push(...each(message.orders, CHAT_WORD.order, 'success'))
  if (message.cancel) out.push(...each(message.cancels, CHAT_WORD.cancel, 'warning'))
  if (!message.order && !message.cancel) out.push(...each(message.mentions, CHAT_WORD.mention, 'info'))
  return out
}

export function chatResult(message: MessagesView['messages'][number], data: ScopeData): TalkTag[] {
  // 취소 채팅은 그 채팅이 한 일 "15번 취소" — 취소된 찜을 만든 주문 채팅에는 "15번 취소됨"이 붙는다
  if (message.cancel && !message.order) return chatWordTags(message)
  const claims = message.claims.flatMap((id) => {
    const claim = data.claims.get(id)
    return claim === undefined ? [] : [claim]
  })
  if (claims.length > 0) return claims.map((claim) => chatClaimTag(data, claim))
  return chatWordTags(message)
}

/** 채팅 + 문자 → 한 줄씩 (최신이 위) */
export function talkRows(chat: MessagesView | null, sms: readonly SmsFeedView[], data: ScopeData): TalkRow[] {
  const rows: TalkRow[] = []
  for (const message of chat?.messages ?? []) {
    const at = Date.parse(message.at)
    rows.push({ key: `c:${message.id}`, at: Number.isFinite(at) ? at : 0, who: message.nick, text: message.text, tags: chatResult(message, data) })
  }
  for (const entry of sms) {
    const at = Date.parse(entry.at)
    rows.push({ key: `s:${entry.id}`, at: Number.isFinite(at) ? at : 0, who: smsWho(entry), text: entry.text, tags: smsWord(entry) })
  }
  return rows.sort((a, b) => b.at - a.at || b.key.localeCompare(a.key))
}

/** 이 방송에 온 최근 손님 문자 (리허설은 받지 않는다 — 빈 목록) */
export function useSmsFeed(): readonly SmsFeedView[] {
  const api = useConsoleApi()
  const { stream } = useServices()
  const [messages, setMessages] = useState<readonly SmsFeedView[]>([])
  const rehearsal = api.data.rehearsal
  const b = api.b
  useEffect(() => {
    if (rehearsal) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      get<{ messages: SmsFeedView[] }>(withQuery('/api/inbox/sms', { b })).then(
        (body) => {
          if (alive && Array.isArray(body.messages)) setMessages(body.messages)
        },
        (caught: unknown) => {
          // 문자 받기가 없는 서버(404)·잠깐의 오류는 빈 채로 두고 다음 알림 때 다시 읽는다
          if (!isApiError(caught)) throw caught
        },
      )
    const later = () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        void load()
      }, SMS_RELOAD_MS)
    }
    void load()
    const source = stream.open()
    let ready = 0
    source.addEventListener('ready', () => {
      // 다시 붙으면 그 사이에 온 문자를 받는다
      ready++
      if (ready > 1) later()
    })
    source.addEventListener('inbox', (event) => {
      try {
        const data = JSON.parse(event.data ?? '{}') as { kind?: unknown; b?: unknown }
        if (data.kind === 'sms' && data.b === b) later()
      } catch {
        // 모양이 다른 알림은 지나친다
      }
    })
    return () => {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
      source.close()
    }
  }, [rehearsal, b, stream])
  return messages
}

/**
 * 한 줄 (D-UX3-82 → D-UX4-66, 사용자 지시 2026-11-10 "닉네임 오른쪽에 태그를 위치시키자 … 시간 글자 너비와 상관없이 닉네임의 왼쪽이 맞춰지도록 컬럼 배치"):
 * [받은 시각 칸(폭 고정)] [굵은 닉네임 · 결과 꼬리표 · 내용]. 내용이 길면 닉네임 왼쪽 줄에 맞춰 아래로 내려간다. 줄 바탕은 없다. 손님 글은 글자로만
 */
function TalkLine({ row, timeWidth, onTimeWidth, oneLine = false }: { readonly row: TalkRow; readonly timeWidth: number; readonly onTimeWidth: (width: number) => void; readonly oneLine?: boolean }) {
  const { p, tones } = useKit()
  return (
    <View role="listitem" aria-label={row.who} style={{ flexDirection: 'row', alignItems: 'flex-start', columnGap: SPACE.sm, paddingVertical: 2 }}>
      {/* 시각 칸: 목록에서 가장 넓은 시각 폭으로 모두 맞춘다 (숫자 폭이 달라도 닉네임 왼쪽이 한 세로줄) */}
      <View testID="talk-time" style={{ minWidth: timeWidth }}>
        <View style={{ alignSelf: 'flex-start' }} onLayout={(event) => onTimeWidth(event.nativeEvent.layout.width)}>
          <Txt step="meta" color="textSub">{kstHm(row.at)}</Txt>
        </View>
      </View>
      <View testID="talk-body" style={{ flex: 1, flexDirection: 'row', flexWrap: oneLine ? 'nowrap' : 'wrap', alignItems: 'center', columnGap: SPACE.sm, rowGap: 2, overflow: 'hidden' }}>
        <Txt step="meta" weight="heavy">{row.who}</Txt>
        {row.tags.map((tag, index) => {
          const pair = tag.kind === 'win' ? { bg: p.goldBg, fg: p.goldText } : tag.kind === 'wait' ? { bg: p.soft, fg: p.textSub } : tones[tag.kind]
          return (
            // 위아래 1: 꼬리표 높이(18 + 2)가 닉네임 줄 높이(20)와 같아 시각과 닉네임이 한 줄에 선다
            <View key={`${tag.word}-${String(index)}`} style={{ flexShrink: 0, paddingHorizontal: TAG_PAD_X, paddingVertical: 1, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: pair.bg }}>
              <Txt step="caption" weight={tag.kind === 'wait' ? 'medium' : 'bold'} ink={pair.fg}>{tag.word}</Txt>
            </View>
          )
        })}
        <View style={{ flexShrink: 1 }}>
          <Txt step="meta" {...(oneLine ? { numberOfLines: 1 } : {})}>{row.text}</Txt>
        </View>
      </View>
    </View>
  )
}

/** 채팅·문자 탭 */
export function LiveTalk() {
  const api = useConsoleApi()
  const { view, error } = useMessages()
  const sms = useSmsFeed()
  const rows = useMemo(() => talkRows(view?.sealed === true ? null : view, sms, api.data), [view, sms, api.data])
  const [timeWidth, setTimeWidth] = useState(0)
  const onTimeWidth = useCallback((width: number) => setTimeWidth((was) => Math.max(was, Math.ceil(width))), [])
  return (
    <View style={{ gap: SPACE.xs }}>
      {error !== null && view === null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {view?.sealed === true ? <Notice tone="info">{view.sealedMessage ?? '봉인한 날짜라 채팅 내용을 지웠어요.'}</Notice> : null}
      {view === null && error === null ? null : rows.length === 0 ? <EmptyFill title={TALK_EMPTY} body={TALK_EMPTY_BODY} /> : (
        <View role="list" aria-label={TALK_TAB} style={{ gap: SPACE.xs }}>
          {/* 최신 TALK_LIMIT줄을 라이브 채팅처럼 최신이 맨 아래로 (D-UX3-75) */}
          {rows.slice(0, TALK_LIMIT).reverse().map((row) => <TalkLine key={row.key} row={row} timeWidth={timeWidth} onTimeWidth={onTimeWidth} />)}
        </View>
      )}
    </View>
  )
}

/** 아래 창으로 펼쳐 볼 최근 줄 수 */
export const TALK_DOCK_LIMIT = 30

/**
 * 채팅·문자 아래 창 (D-UX4-71 — 관리 "화면 아래 창"에서 채팅·문자를 고르면 들린 말 창 자리에): 접으면 가장 최근 한 줄(시각 · 닉네임 · 내용),
 * 누르면 들린 말 창처럼 높이가 부드럽게 늘며 최근 채팅·문자가 쌓여 보인다(새 줄이 아래). 없으면 비워 둔다.
 */
export function TalkDock({ bottom }: { readonly bottom: number }) {
  const { p } = useKit()
  const api = useConsoleApi()
  const { view } = useMessages()
  const sms = useSmsFeed()
  const rows = useMemo(() => talkRows(view?.sealed === true ? null : view, sms, api.data), [view, sms, api.data])
  const [open, setOpen] = useState(false)
  const [logHeight, setLogHeight] = useState(0)
  const [timeWidth, setTimeWidth] = useState(0)
  const onTimeWidth = useCallback((width: number) => setTimeWidth((was) => Math.max(was, Math.ceil(width))), [])
  const motion = useOpenMotion(open)
  const log = useRef<ScrollViewInstance>(null)
  const latest = rows[0] ?? null
  const earlier = rows.slice(1, TALK_DOCK_LIMIT + 1).reverse()
  const target = Math.min(logHeight, HEARD_LOG_HEIGHT) + SPACE.sm
  const height = motion.value.interpolate({ inputRange: [0, 1], outputRange: [0, target] })
  return (
    <View role="region" aria-label="채팅·문자 창" style={{ backgroundColor: p.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderCurve: 'continuous', paddingHorizontal: SPACE.md, paddingTop: SPACE.sm, paddingBottom: bottom, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -2 }, elevation: 8 }}>
      {motion.shown ? (
        <Animated.View style={{ height: Platform.OS === 'web' ? undefined : height, opacity: motion.value, overflow: 'hidden', paddingHorizontal: SPACE.xs, paddingBottom: SPACE.sm }}>
          <ScrollView ref={log} style={{ maxHeight: HEARD_LOG_HEIGHT }} onContentSizeChange={() => log.current?.scrollToEnd({ animated: false })}>
            <View role="list" aria-label="지난 채팅·문자" style={{ gap: SPACE.xs }} onLayout={(event) => setLogHeight(event.nativeEvent.layout.height)}>
              {earlier.map((row) => <TalkLine key={row.key} row={row} timeWidth={timeWidth} onTimeWidth={onTimeWidth} />)}
            </View>
          </ScrollView>
        </Animated.View>
      ) : null}
      <Tap role="button" aria-label={open ? '채팅·문자 접기' : '채팅·문자 펼치기'} aria-expanded={open} onPress={() => setOpen((was) => !was)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 44, paddingHorizontal: SPACE.xs, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
        <View role="status" aria-label="최근 채팅·문자" style={{ flex: 1 }}>
          {latest === null ? null : <TalkLine row={latest} timeWidth={timeWidth} onTimeWidth={onTimeWidth} oneLine />}
        </View>
        <Icon name={open ? 'down' : 'up'} size={16} color={p.textSub} />
      </Tap>
    </View>
  )
}
