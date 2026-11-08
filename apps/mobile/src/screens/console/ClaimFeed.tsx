// 방송 화면의 찜 기록 (D-LIVETEST-07): 채팅찜·문자찜·직접 넣은 찜을 최신이 위로 — 시각 · 어디서 · 손님 · 번호 · 결과, 아래에 채팅 원문.
// 이미 1등이 있는 상품을 또 찜하면 "이미 찜됨 · 1등 ○○ · 대기 n번"으로 주황 줄 — 방송 중에 "다음 분 대기예요"를 바로 말할 수 있게.
// 판정은 하지 않는다. 상태·대기 순서·1등은 서버 값(범위 자료) 그대로 낱말로만 바꾼다. 원문·닉네임은 글자로만 그린다.
import { useMemo } from 'react'
import { View } from 'react-native'
import type { Claim, MessagesView } from '@livejjim/web/src/api/types.ts'
import { kstTime } from '@livejjim/web/src/lib/kst.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { claimWord, productSlots, type BuyerNames } from '../../lib/derive.ts'
import { Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import type { Tone } from '../../ui/theme.ts'
import { Hint, Tag } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'
import { useMessages } from './ChatPaste.tsx'

export const ORIGIN_WORD: Readonly<Record<Claim['origin'], string>> = { chat: '채팅', sms: '문자', assign: '직접', convert: '넣음' }
export const FEED_EMPTY = '아직 찜이 없어요. 채팅·문자로 번호가 오면 여기에 바로 보여요.'
export const FEED_LIMIT = 60

export interface FeedRow {
  readonly id: string
  readonly no: number
  /** 찜을 받은 시각 (문자찜은 문자를 받은 시각) */
  readonly at: number
  readonly origin: string
  readonly buyer: string
  /** 1등 · 대기 n번 · 보류 · 충돌 · 취소됨 … */
  readonly word: string
  readonly tone: Tone
  /** 이미 다른 손님이 1등인 상품을 찜했다 — 그 1등 이름 */
  readonly takenBy: string | null
  /** 채팅 원문 (받아 둔 최근 채팅에 있을 때만) */
  readonly text: string | null
}

const timeOf = (value: string | number): number => (typeof value === 'number' ? value : Date.parse(value))

function rowTone(claim: Claim): Tone {
  if (claim.status === 'CONFIRMED') return 'success'
  if (claim.status === 'WAITLISTED') return 'warning'
  if (claim.status === 'CONFLICT') return 'danger'
  if (claim.status === 'PENDING') return 'info'
  return 'info'
}

/** 찜 → 찜 기록 줄 (최신이 위). texts: 찜 ID → 채팅 원문 */
export function feedRows(data: ScopeData, names: Pick<BuyerNames, 'name'>, texts: ReadonlyMap<string, string>, broadcastId: string): FeedRow[] {
  const rows: FeedRow[] = []
  for (const claim of data.claims.values()) {
    if (claim.broadcast !== broadcastId || claim.status === 'DUPLICATE') continue
    const product = data.products.get(claim.product)
    const winners = product === undefined ? [] : productSlots(product).winners
    const takenBy = claim.status === 'WAITLISTED' && winners.length > 0 && winners[0] !== claim.currentBuyer ? names.name(winners[0]!) : null
    const received = claim.received === null ? Number.NaN : Date.parse(claim.received)
    rows.push({
      id: claim.id,
      no: claim.no,
      at: Number.isFinite(received) ? received : timeOf(claim.rankTime),
      origin: ORIGIN_WORD[claim.origin],
      buyer: names.name(claim.currentBuyer),
      word: claimWord(data, claim),
      tone: rowTone(claim),
      takenBy,
      text: texts.get(claim.id) ?? null,
    })
  }
  return rows.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
}

/** 채팅 원문 찾기: 찜 ID → 그 찜을 만든 채팅 글 */
export function claimTexts(view: MessagesView | null): Map<string, string> {
  const out = new Map<string, string>()
  for (const message of view?.messages ?? []) for (const id of message.claims) out.set(id, message.text)
  return out
}

export function FeedLine({ row }: { readonly row: FeedRow }) {
  const { p } = useKit()
  const taken = row.takenBy !== null
  return (
    <View role="listitem" aria-label={`${String(row.no)}번 ${row.buyer} ${row.word}`} style={{ paddingVertical: SPACE.sm, paddingHorizontal: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: taken ? p.warnBg : p.surface, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <Txt step="caption" color="textSub">{kstTime(row.at)}</Txt>
        <Tag tone="info">{row.origin}</Tag>
        <View style={{ flexShrink: 1 }}><Txt weight="bold" numberOfLines={1}>{row.buyer}</Txt></View>
        <View style={{ flex: 1 }} />
        <Txt weight="bold">{`${String(row.no)}번`}</Txt>
        <Tag tone={row.tone}>{row.word}</Tag>
      </View>
      {taken ? <Txt step="caption" weight="bold" ink={p.warnText}>{`이미 찜됨 · 1등 ${row.takenBy ?? ''}`}</Txt> : null}
      {row.text !== null ? <Txt step="caption" color="textSub" numberOfLines={2}>{row.text}</Txt> : null}
    </View>
  )
}

/** 찜 기록 (only: 그 상태의 찜만 — 보류 찜 보기) */
export function ClaimFeed({ only }: { readonly only?: Claim['status'] }) {
  const api = useConsoleApi()
  const { view } = useMessages()
  const texts = useMemo(() => claimTexts(view), [view])
  const rows = useMemo(() => {
    const all = feedRows(api.data, api.names, texts, api.b)
    return only === undefined ? all : all.filter((row) => api.data.claims.get(row.id)?.status === only)
  }, [api.data, api.names, api.b, texts, only])
  if (rows.length === 0) return <Hint>{only === 'PENDING' ? '보류 찜이 없어요.' : FEED_EMPTY}</Hint>
  return (
    <View role="list" aria-label="찜 기록" style={{ gap: SPACE.xs }}>
      {/* 최신 FEED_LIMIT줄을 라이브 채팅처럼 최신이 맨 아래로 (D-UX3-75) */}
      {rows.slice(0, FEED_LIMIT).reverse().map((row) => <FeedLine key={row.id} row={row} />)}
      {rows.length > FEED_LIMIT ? <Hint>{`그 밖 ${String(rows.length - FEED_LIMIT)}건은 채팅 보기·구매자 화면에서 볼 수 있어요.`}</Hint> : null}
    </View>
  )
}
