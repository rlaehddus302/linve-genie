// 방송 화면 "채팅·문자" 탭 (D-UX4-12, 사용자 지시 2026-11-08 "방송 중 화면에서 실시간 채팅, 문자 오는거 볼 수 있게 찜 기록 옆에 새로운 탭으로").
// - 채팅: 이 방송의 최근 채팅(찜 기록·채팅 보기와 같은 useMessages — 범위가 바뀌면 다시 읽는다). 주문·취소·언급·방송자 표시는 채팅 보기와 같은 글자.
// - 문자: 휴대폰 알림 받기로 서버에 온 손님 문자(GET /api/inbox/sms — 서버 메모리, 최신이 앞). 실시간 `inbox` { kind: 'sms', b }가 오면 다시 읽는다.
// - 둘을 받은 시각으로 섞어 최신이 위. 본문·닉네임·보낸 이름은 손님이 쓴 글이라 글자로만 그린다. 판정은 하지 않는다(서버가 한 일을 낱말로만).
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import type { SmsFeedView } from '@livejjim/web/src/api/inbox-types.ts'
import type { MessagesView } from '@livejjim/web/src/api/types.ts'
import { kstTime } from '@livejjim/web/src/lib/kst.ts'
import { CHAT_WORD } from '@livejjim/web/src/lib/words.ts'
import { get, isApiError, withQuery } from '../../api/client.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { claimWord } from '../../lib/derive.ts'
import { useServices } from '../../services.tsx'
import { Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import type { Tone } from '../../ui/theme.ts'
import { Hint, Notice, Tag } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'
import { chatTags, useMessages } from './ChatPaste.tsx'

export const TALK_TAB = '채팅·문자'
export const TALK_EMPTY = '아직 채팅·문자가 없어요. 오면 여기에 바로 보여요.'
export const TALK_REHEARSAL = '리허설에는 손님 문자를 받지 않아요. 채팅만 보여요.'
export const TALK_SMS_HELP = '문자는 휴대폰 알림 받기를 켠 휴대폰으로 온 손님 문자예요.'
export const TALK_LIMIT = 150
const SMS_RELOAD_MS = 300

export interface TalkRow {
  readonly key: string
  readonly at: number
  readonly source: '채팅' | '문자'
  readonly who: string
  readonly text: string
  /** 주문 15번 · 찜 15번 · 찜 아님 … (색만으로 구분하지 않는다) */
  readonly tags: readonly { readonly word: string; readonly tone: Tone }[]
  /** 그 채팅이 만든 찜의 지금 상태 (15번 · 1등) */
  readonly notes: readonly string[]
}

const nums = (numbers: readonly number[]) => numbers.map((no) => `${String(no)}번`).join('·')

/** 서버가 그 문자로 한 일 → 낱말 */
export function smsWord(entry: Pick<SmsFeedView, 'result' | 'numbers'>): { word: string; tone: Tone } {
  const list = entry.numbers.length > 0 ? ` ${nums(entry.numbers)}` : ''
  switch (entry.result) {
    case 'claim':
      return { word: `찜${list}`, tone: 'success' }
    case 'cancel':
      return { word: `취소 요청${list}`, tone: 'warning' }
    case 'review':
      return { word: `확인 필요${list}`, tone: 'warning' }
    case 'info':
      return { word: '손님 정보', tone: 'info' }
    case 'stale':
      return { word: '넣지 않음', tone: 'danger' }
    default:
      return { word: '찜 아님', tone: 'info' }
  }
}

/** 보낸 사람 — 휴대폰 끝 4자리 또는 보낸 이름 */
export function smsWho(entry: Pick<SmsFeedView, 'last4' | 'sender'>): string {
  if (entry.last4 !== null) return `끝번호 ${entry.last4}`
  return entry.sender !== null && entry.sender.trim() !== '' ? entry.sender : '보낸 사람 모름'
}

/** 채팅 + 문자 → 한 줄씩 (최신이 위) */
export function talkRows(chat: MessagesView | null, sms: readonly SmsFeedView[], data: ScopeData): TalkRow[] {
  const rows: TalkRow[] = []
  for (const message of chat?.messages ?? []) {
    const at = Date.parse(message.at)
    rows.push({
      key: `c:${message.id}`,
      at: Number.isFinite(at) ? at : 0,
      source: '채팅',
      who: message.nick,
      text: message.text,
      tags: chatTags(message).map((word) => ({ word, tone: word.startsWith(CHAT_WORD.cancel) ? 'warning' : word.startsWith(CHAT_WORD.order) ? 'success' : 'info' })),
      notes: message.claims.flatMap((id) => {
        const claim = data.claims.get(id)
        return claim === undefined ? [] : [`${String(claim.no)}번 · ${claimWord(data, claim)}`]
      }),
    })
  }
  for (const entry of sms) {
    const at = Date.parse(entry.at)
    rows.push({ key: `s:${entry.id}`, at: Number.isFinite(at) ? at : 0, source: '문자', who: smsWho(entry), text: entry.text, tags: [smsWord(entry)], notes: [] })
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

function TalkLine({ row }: { readonly row: TalkRow }) {
  const { p } = useKit()
  return (
    <View role="listitem" aria-label={`${row.source} ${row.who}`} style={{ paddingVertical: SPACE.sm, paddingHorizontal: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: p.surface, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACE.sm }}>
        <Txt step="caption" color="textSub">{kstTime(row.at)}</Txt>
        <Tag tone={row.source === '문자' ? 'warning' : 'info'}>{row.source}</Tag>
        <View style={{ flexShrink: 1 }}><Txt weight="bold" numberOfLines={1}>{row.who}</Txt></View>
        {row.tags.map((tag) => <Tag key={tag.word} tone={tag.tone}>{tag.word}</Tag>)}
      </View>
      <Txt>{row.text}</Txt>
      {row.notes.map((note) => <Txt key={note} step="caption" color="textSub">{note}</Txt>)}
    </View>
  )
}

/** 채팅·문자 탭 */
export function LiveTalk() {
  const api = useConsoleApi()
  const { view, error } = useMessages()
  const sms = useSmsFeed()
  const rows = useMemo(() => talkRows(view?.sealed === true ? null : view, sms, api.data), [view, sms, api.data])
  return (
    <View style={{ gap: SPACE.xs }}>
      {api.data.rehearsal ? <Hint>{TALK_REHEARSAL}</Hint> : null}
      {error !== null && view === null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {view?.sealed === true ? <Notice tone="info">{view.sealedMessage ?? '봉인한 날짜라 채팅 내용을 지웠어요.'}</Notice> : null}
      {view === null && error === null ? <Hint>불러오는 중…</Hint> : rows.length === 0 ? <Hint>{TALK_EMPTY}</Hint> : (
        <View role="list" aria-label={TALK_TAB} style={{ gap: SPACE.xs }}>
          {rows.slice(0, TALK_LIMIT).map((row) => <TalkLine key={row.key} row={row} />)}
        </View>
      )}
      {!api.data.rehearsal ? <Hint>{TALK_SMS_HELP}</Hint> : null}
    </View>
  )
}
