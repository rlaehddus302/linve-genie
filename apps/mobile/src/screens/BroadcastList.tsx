// 내 방송 목록 (D-UX3-18, 사용자 지시 2026-11-03 "토스 통장 목록처럼"): 플랫폼 아이콘 · 제목 · 날짜와 "2시간 전".
// 홈에는 최근 4개만 흰 카드 하나에, [모두보기]는 쌓인 화면 — 날짜마다 흰 카드를 나눈다.
// 서버 목록은 오래된 순(날짜·리허설·선언 순)이라 여기서 뒤집어 최근 것을 위로 둔다 — 진행 중 방송도 가장 최근 것을 고른다.
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { BroadcastItem } from '@livejjim/web/src/api/types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError } from '../api/client.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { AppHeader, Icon, RowGroup, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { PlatformIcon } from '../ui/PlatformIcon.tsx'
import { Loading, Notice } from '../ui/parts.tsx'

/** 홈 카드에 보이는 최대 줄 수 */
export const HOME_BROADCASTS = 4

/** 최근 것이 위로 (서버는 오래된 순) */
export function newestFirst(items: readonly BroadcastItem[]): BroadcastItem[] {
  return [...items].reverse()
}

/** 돌아갈 방송: 가장 최근의 끝나지 않은 실제 방송, 없으면 가장 최근의 끝나지 않은 리허설 */
export function liveBroadcast(items: readonly BroadcastItem[]): BroadcastItem | undefined {
  const recent = newestFirst(items)
  return recent.find((item) => !item.ended && !item.rehearsal) ?? recent.find((item) => !item.ended)
}

/** "방금 전" · "12분 전" · "2시간 전" · "어제" · "3일 전" (시각을 모르면 null) */
export function agoWords(iso: string | null | undefined, now: number): string | null {
  if (iso === null || iso === undefined) return null
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return null
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return '방금 전'
  if (minutes < 60) return `${String(minutes)}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}시간 전`
  const days = Math.floor(hours / 24)
  return days === 1 ? '어제' : `${String(days)}일 전`
}

export function broadcastTitle(item: BroadcastItem): string {
  const title = item.title.trim()
  return title === '' ? `${dateWords(item.date)} 방송` : title
}

/** 줄 아래 글: "11월 3일 · 2시간 전" (+ 리허설) */
export function broadcastSub(item: BroadcastItem, now: number): string {
  const ago = agoWords(item.createdAt, now)
  return [dateWords(item.date), ago, item.rehearsal ? '리허설' : null].filter((part) => part !== null).join(' · ')
}

/** 날짜별 묶음 (최근 날짜가 위, 묶음 안도 최근 것이 위) */
export function byDate(items: readonly BroadcastItem[]): { readonly date: string; readonly items: readonly BroadcastItem[] }[] {
  const groups: { date: string; items: BroadcastItem[] }[] = []
  for (const item of newestFirst(items)) {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.date === item.date) last.items.push(item)
    else groups.push({ date: item.date, items: [item] })
  }
  return groups
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'] as const
function dateHeading(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return `${dateWords(date)} ${WEEKDAY[day] ?? ''}요일`
}

/** 판 개수·금액 (홈이 아는 방송만) */
export interface SoldSummary {
  readonly count: number
  readonly amount: number
}

/** 방송 한 줄: 플랫폼 아이콘(없으면 회색 재생 표) · 제목 · 날짜와 지난 시간 · 오른쪽 "진행 중" 또는 판 금액 */
export function BroadcastRow({ item, now, onPress, sold, amountWords }: { readonly item: BroadcastItem; readonly now: number; readonly onPress: () => void; readonly sold?: SoldSummary | null; readonly amountWords?: (amount: number) => string }) {
  const { p } = useKit()
  const platform = item.platforms?.[0]
  const sub = broadcastSub(item, now)
  const state = item.ended ? '끝남' : '진행 중'
  return (
    <Pressable role="button" aria-label={`${broadcastTitle(item)} — ${sub} · ${state}`} testID={`broadcast-${item.id}`} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: SPACE.md, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', minHeight: TOUCH.min, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      {platform === undefined ? (
        <View aria-hidden style={{ width: 40, height: 40, borderRadius: 40 * 0.2237, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="play" color={p.textSub} size={20} />
        </View>
      ) : (
        <PlatformIcon platform={platform} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt step="bodyLarge" weight="bold" numberOfLines={1}>
          {broadcastTitle(item)}
        </Txt>
        <Txt step="caption" color="textSub" numberOfLines={1}>
          {sub}
        </Txt>
      </View>
      {!item.ended ? (
        <Txt step="caption" weight="bold" color="primaryText">
          진행 중
        </Txt>
      ) : sold !== null && sold !== undefined && amountWords !== undefined ? (
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Txt weight="heavy">{amountWords(sold.amount)}</Txt>
          <Txt step="caption" color="textSub">{`${String(sold.count)}개 팔림`}</Txt>
        </View>
      ) : null}
    </Pressable>
  )
}

/** 모든 방송 (쌓인 화면): 날짜마다 흰 카드 */
export function AllBroadcastsScreen({ onOpen, onBack, now = Date.now() }: { readonly onOpen: (id: string) => void; readonly onBack: () => void; readonly now?: number }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const [items, setItems] = useState<readonly BroadcastItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts').then(
      (view) => {
        if (alive) setItems(view.broadcasts)
      },
      (caught: unknown) => {
        if (alive) setError(isApiError(caught) ? caught.message : RETRY_NOW)
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="all-broadcasts">
      <AppHeader title="내 방송" onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl + room, gap: SPACE.md }}>
        {items === null && error === null ? <Loading /> : null}
        {error !== null ? (
          <Notice tone="danger" alert>
            {error}
          </Notice>
        ) : null}
        {items !== null && items.length === 0 ? (
          <Txt color="textSub">아직 방송이 없어요</Txt>
        ) : null}
        {byDate(items ?? []).map((group) => (
          <RowGroup key={group.date} title={dateHeading(group.date)}>
            {group.items.map((item) => (
              <BroadcastRow key={item.id} item={item} now={now} onPress={() => onOpen(item.id)} />
            ))}
          </RowGroup>
        ))}
      </ScrollView>
    </View>
  )
}
