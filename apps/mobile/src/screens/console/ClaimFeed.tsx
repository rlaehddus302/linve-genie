// 방송 화면의 찜 기록 (D-LIVETEST-07 → D-UX3-79): 구매자별로 번호를 묶는다 — 한 줄에 왼쪽 손님 이름(문자 손님은 "문자-끝 4자리"),
// 그 옆에 찜한 번호를 하나씩 둥근 네모 꼬리표로 늘어놓고 자리가 없으면 아랫줄로 내려간다. 시각·채팅 원문은 그리지 않는다.
// 꼬리표 바탕은 결과를 살짝 알린다: 1등 초록 · 대기(이미 찜됨) 노랑 · 보류 파랑 · 확인 필요 빨강 · 취소·안 됨 회색.
// 줄 순서는 라이브 채팅처럼 가장 최근에 찜한 손님이 맨 아래(D-UX3-75), 한 손님 안의 번호는 찜한 순서.
// 판정은 하지 않는다. 상태·대기 순서·1등은 서버 값(범위 자료) 그대로 낱말로만 바꾼다. 닉네임은 글자로만 그린다.
import { useMemo } from 'react'
import { View } from 'react-native'
import type { Claim } from '@livejjim/web/src/api/types.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { claimWord, productSlots, type BuyerNames } from '../../lib/derive.ts'
import { Txt, useKit } from '../../ui/kit/index.ts'
import { SPACE, type Tone } from '../../ui/kit/tokens.ts'
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
  /** 1등 · 대기 n번 · 보류 · 충돌 · 취소됨 … */
  readonly word: string
  readonly tone: Tone
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

const timeOf = (value: string | number): number => (typeof value === 'number' ? value : Date.parse(value))

function noTone(status: Claim['status']): Tone {
  if (status === 'CONFIRMED') return 'success'
  if (status === 'WAITLISTED') return 'warning'
  if (status === 'CONFLICT') return 'danger'
  if (status === 'PENDING') return 'info'
  return 'neutral'
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
      word: claimWord(data, claim),
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
  return item.takenBy === null ? `${String(item.no)}번 ${item.word}` : `${String(item.no)}번 ${item.word} · 이미 찜됨 · 1등 ${item.takenBy}`
}

function NoTag({ item }: { readonly item: FeedNo }) {
  const { tones } = useKit()
  const pair = tones[item.tone]
  return (
    <View aria-label={noLabel(item)} style={{ paddingHorizontal: SPACE.sm, paddingVertical: 2, borderRadius: TAG_RADIUS, borderCurve: 'continuous', backgroundColor: pair.bg }}>
      <Txt step="caption" weight="bold" ink={pair.fg}>{String(item.no)}</Txt>
    </View>
  )
}

export function FeedLine({ row }: { readonly row: FeedBuyer }) {
  return (
    <View role="listitem" aria-label={`${row.buyer} ${row.nos.map(noLabel).join(', ')}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm, paddingVertical: SPACE.xs }}>
      <View style={{ flexShrink: 1, maxWidth: '40%', paddingVertical: 2 }}>
        <Txt step="caption" weight="bold" numberOfLines={1}>{row.buyer}</Txt>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
        {row.nos.map((item) => <NoTag key={item.id} item={item} />)}
      </View>
    </View>
  )
}

/** 꼬리표 색 풀이 한 줄 */
function FeedLegend() {
  const legend: readonly { readonly word: string; readonly tone: Tone }[] = [
    { word: '1등', tone: 'success' },
    { word: '대기', tone: 'warning' },
    { word: '보류', tone: 'info' },
  ]
  const { tones } = useKit()
  return (
    <View aria-label="색 풀이: 초록 1등, 노랑 대기, 파랑 보류" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, paddingBottom: SPACE.xs }}>
      {legend.map((item) => {
        const pair = tones[item.tone]
        return (
          <View key={item.word} aria-hidden style={{ paddingHorizontal: SPACE.sm, paddingVertical: 2, borderRadius: TAG_RADIUS, borderCurve: 'continuous', backgroundColor: pair.bg }}>
            <Txt step="note" weight="bold" ink={pair.fg}>{item.word}</Txt>
          </View>
        )
      })}
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
      {only === undefined ? <FeedLegend /> : null}
      {rows.length > FEED_LIMIT ? <Hint>{`그 밖 ${String(rows.length - FEED_LIMIT)}명은 구매자 화면에서 볼 수 있어요.`}</Hint> : null}
      {/* 최근 FEED_LIMIT명을 라이브 채팅처럼 가장 최근 손님이 맨 아래로 (D-UX3-75) */}
      <View role="list" aria-label="찜 기록">
        {shown.map((row) => <FeedLine key={row.key} row={row} />)}
      </View>
    </View>
  )
}
