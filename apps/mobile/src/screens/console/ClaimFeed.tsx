// 방송 화면의 찜 기록 (D-LIVETEST-07 → D-UX3-79): 구매자별로 번호를 묶는다 — 한 줄에 왼쪽 손님 이름(문자 손님은 "문자-끝 4자리"),
// 그 옆에 찜한 번호를 하나씩 둥근 네모 꼬리표로 늘어놓고 자리가 없으면 아랫줄로 내려간다. 시각·채팅 원문은 그리지 않는다.
// 손님 줄마다 따로 둥근 바탕(D-UX3-83). 꼬리표는 상품 줄과 같은 색·낱말(D-UX3-83): 찜(1등) 금색 "123 찜", 대기 회색 "123 대기 1",
// 보류(아직 없는 번호) 주황 "123 보류", 겹침 빨강, 취소·안 됨 회색에 그 낱말.
// 줄 순서는 라이브 채팅처럼 가장 최근에 찜한 손님이 맨 아래(D-UX3-75), 한 손님 안의 번호는 찜한 순서.
// 판정은 하지 않는다. 상태·대기 순서·1등은 서버 값(범위 자료) 그대로 낱말로만 바꾼다. 닉네임은 글자로만 그린다.
import { useMemo } from 'react'
import { View } from 'react-native'
import type { Claim } from '@livejjim/web/src/api/types.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { claimWord, productSlots, waitPosition, type BuyerNames } from '../../lib/derive.ts'
import { Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, type Palette, type TonePair } from '../../ui/kit/tokens.ts'
import { Hint } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'

export const FEED_EMPTY = '아직 찜이 없어요. 채팅·문자로 번호가 오면 여기에 바로 보여요.'
/** 한 번에 그리는 손님 줄 수 (최신 손님부터) */
export const FEED_LIMIT = 60
/** 번호 꼬리표 모서리 — 알약이 아닌 둥근 네모 (사용자 지시 "배경은 라운드직사각") */
const TAG_RADIUS = 6

export interface FeedNo {
  readonly id: string
  readonly no: number
  /** 찜을 받은 시각 (문자찜은 문자를 받은 시각) — 순서에만 쓴다 */
  readonly at: number
  readonly status: Claim['status']
  /** 꼬리표 낱말: 찜 · 대기 n · 보류 · 겹침 · 취소됨 … */
  readonly word: string
  readonly tone: FeedTone
  /** 이미 다른 손님이 1등인 상품을 찜했다 — 그 1등 이름 */
  readonly takenBy: string | null
}

export interface FeedBuyer {
  /** 손님 ID */
  readonly key: string
  /** 채팅 닉네임, 문자 손님은 "문자-0937" */
  readonly buyer: string
  /** 이 손님의 가장 최근 찜 시각 */
  readonly latest: number
  /** 찜한 순서 */
  readonly nos: readonly FeedNo[]
}

/** 꼬리표 색: 찜 금색 · 대기 회색 · 보류 주황 · 겹침 빨강 · 그 밖 회색 */
export type FeedTone = 'win' | 'wait' | 'pending' | 'conflict' | 'other'

const timeOf = (value: string | number): number => (typeof value === 'number' ? value : Date.parse(value))

function noTone(status: Claim['status']): FeedTone {
  if (status === 'CONFIRMED') return 'win'
  if (status === 'WAITLISTED') return 'wait'
  if (status === 'PENDING') return 'pending'
  if (status === 'CONFLICT') return 'conflict'
  return 'other'
}

/** 꼬리표 낱말 — 상품 줄과 같은 말 (1등은 "찜", D-UX3-78) */
function noWord(data: ScopeData, claim: Claim): string {
  if (claim.status === 'CONFIRMED') return '찜'
  if (claim.status === 'WAITLISTED') {
    const position = waitPosition(data, claim)
    return position === null ? '대기' : `대기 ${String(position)}`
  }
  if (claim.status === 'PENDING') return '보류'
  if (claim.status === 'CONFLICT') return '겹침'
  return claimWord(data, claim)
}

/** 꼬리표 바탕·글자 (키트 색 쌍, 대비 4.5:1 이상 — tokens 대비 시험) */
export function tagColors(p: Palette, danger: TonePair, tone: FeedTone): TonePair {
  if (tone === 'win') return { bg: p.goldBg, fg: p.goldText }
  if (tone === 'pending') return { bg: p.warnBg, fg: p.warnText }
  if (tone === 'conflict') return danger
  return { bg: p.soft, fg: p.textSub }
}

/** 줄 왼쪽 이름: 문자 손님은 "문자-끝 4자리"(전체 번호는 쓰지 않는다), 끝 4자리를 모르면 이름 표기 그대로 */
export function feedBuyerName(data: ScopeData, names: Pick<BuyerNames, 'name'>, buyerId: string): string {
  const buyer = data.buyers.get(buyerId)
  if (buyer?.kind === 'sms' && buyer.phoneLast4 !== null) return `문자-${buyer.phoneLast4}`
  return names.name(buyerId)
}

/** 찜 → 손님별 줄 (가장 최근에 찜한 손님이 맨 아래). only: 그 상태의 찜만 (보류 찜 보기) */
export function feedRows(data: ScopeData, names: Pick<BuyerNames, 'name'>, broadcastId: string, only?: Claim['status']): FeedBuyer[] {
  const groups = new Map<string, FeedNo[]>()
  for (const claim of data.claims.values()) {
    if (claim.broadcast !== broadcastId || claim.status === 'DUPLICATE') continue
    if (only !== undefined && claim.status !== only) continue
    const product = data.products.get(claim.product)
    const winners = product === undefined ? [] : productSlots(product).winners
    const takenBy = claim.status === 'WAITLISTED' && winners.length > 0 && winners[0] !== claim.currentBuyer ? names.name(winners[0]!) : null
    const received = claim.received === null ? Number.NaN : Date.parse(claim.received)
    const item: FeedNo = {
      id: claim.id,
      no: claim.no,
      at: Number.isFinite(received) ? received : timeOf(claim.rankTime),
      status: claim.status,
      word: noWord(data, claim),
      tone: noTone(claim.status),
      takenBy,
    }
    const list = groups.get(claim.currentBuyer)
    if (list === undefined) groups.set(claim.currentBuyer, [item])
    else list.push(item)
  }
  const rows: FeedBuyer[] = []
  for (const [key, list] of groups) {
    const nos = [...list].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    rows.push({ key, buyer: feedBuyerName(data, names, key), latest: nos.at(-1)!.at, nos })
  }
  return rows.sort((a, b) => a.latest - b.latest || a.key.localeCompare(b.key))
}

/** 꼬리표 하나의 읽기 낱말 (화면 읽기·시험용) */
export function noLabel(item: FeedNo): string {
  const base = `${String(item.no)} ${item.word}`
  return item.takenBy === null ? base : `${base} · 이미 찜됨 · 1등 ${item.takenBy}`
}

function NoTag({ item }: { readonly item: FeedNo }) {
  const { p, tones } = useKit()
  const pair = tagColors(p, tones.danger, item.tone)
  return (
    <View aria-label={noLabel(item)} style={{ paddingHorizontal: SPACE.sm, paddingVertical: 2, borderRadius: TAG_RADIUS, borderCurve: 'continuous', backgroundColor: pair.bg }}>
      <Txt step="meta" weight={item.tone === 'wait' ? 'medium' : 'bold'} ink={pair.fg}>{`${String(item.no)} ${item.word}`}</Txt>
    </View>
  )
}

export function FeedLine({ row }: { readonly row: FeedBuyer }) {
  const { p } = useKit()
  return (
    <View role="listitem" aria-label={`${row.buyer} ${row.nos.map(noLabel).join(', ')}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm, paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: p.surface }}>
      <View style={{ flexShrink: 1, maxWidth: '40%', paddingVertical: 2 }}>
        <Txt step="meta" weight="bold" numberOfLines={1}>{row.buyer}</Txt>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
        {row.nos.map((item) => <NoTag key={item.id} item={item} />)}
      </View>
    </View>
  )
}

/** 찜 기록 (only: 그 상태의 찜만 — 보류 찜 보기) */
export function ClaimFeed({ only }: { readonly only?: Claim['status'] }) {
  const api = useConsoleApi()
  const rows = useMemo(() => feedRows(api.data, api.names, api.b, only), [api.data, api.names, api.b, only])
  if (rows.length === 0) return <Hint>{only === 'PENDING' ? '보류 찜이 없어요.' : FEED_EMPTY}</Hint>
  const shown = rows.slice(-FEED_LIMIT)
  return (
    <View style={{ gap: SPACE.xs }}>
      {rows.length > FEED_LIMIT ? <Hint>{`그 밖 ${String(rows.length - FEED_LIMIT)}명은 구매자 화면에서 볼 수 있어요.`}</Hint> : null}
      {/* 최근 FEED_LIMIT명을 라이브 채팅처럼 가장 최근 손님이 맨 아래로 (D-UX3-75) */}
      <View role="list" aria-label="찜 기록" style={{ gap: SPACE.xs }}>
        {shown.map((row) => <FeedLine key={row.key} row={row} />)}
      </View>
    </View>
  )
}
