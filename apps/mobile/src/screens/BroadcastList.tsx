// 내 방송 목록 (D-UX3-18, 사용자 지시 2026-11-03 "토스 통장 목록처럼"): 플랫폼 아이콘 · 제목 · 날짜와 "2시간 전".
// 홈에는 최근 4개만 흰 카드 하나에, [모두보기]는 쌓인 화면 — 날짜마다 흰 카드를 나눈다.
// 서버 목록은 오래된 순이라 여기서 뒤집어 최근 것을 위로 둔다 — 진행 중 방송도 가장 최근 것을 고른다.
// 리허설 방송은 앱 어디에도 보이지 않는다 (D-UX3-86) — 예전에 만든 것도 목록에서 뺀다.
import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { BroadcastItem } from '@livejjim/web/src/api/types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError } from '../api/client.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { EmptyFill, AppHeader, Icon, RowGroup, Txt, useKit, useTabBarRoom, Tap } from '../ui/kit/index.ts'
import { RADIUS, GUTTER, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { PlatformIcon } from '../ui/PlatformIcon.tsx'
import { Loading, Notice } from '../ui/parts.tsx'

/** 홈 카드에 보이는 최대 줄 수 */
export const HOME_BROADCASTS = 4

/** 실제 방송만, 최근 것이 위로 (서버는 오래된 순, 리허설은 뺀다 — D-UX3-86) */
export function newestFirst(items: readonly BroadcastItem[]): BroadcastItem[] {
  return items.filter((item) => item.rehearsal !== true).reverse()
}

/** 돌아갈 방송: 가장 최근의 끝나지 않은 실제 방송 */
export function liveBroadcast(items: readonly BroadcastItem[]): BroadcastItem | undefined {
  return newestFirst(items).find((item) => !item.ended)
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

/** 줄 아래 글: "11월 3일 · 2시간 전" */
export function broadcastSub(item: BroadcastItem, now: number): string {
  const ago = agoWords(item.createdAt, now)
  return [dateWords(item.date), ago].filter((part) => part !== null).join(' · ')
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


/** 내 방송 줄의 지난 시간 (D-UX3-85): "방금 전" · "59분 전" · "23시간 전" · "13일 전" · "4주 전" · "11개월 전" · "2년 전". 시각을 모르면 null */
export function historyAgo(iso: string | null | undefined, now: number): string | null {
  if (iso === null || iso === undefined) return null
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return null
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return '방금 전'
  if (minutes < 60) return `${String(minutes)}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}시간 전`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${String(days)}일 전`
  if (days < 30) return `${String(Math.floor(days / 7))}주 전`
  if (days < 365) return `${String(Math.min(11, Math.floor(days / 30)))}개월 전`
  return `${String(Math.floor(days / 365))}년 전`
}

/** 방송 길이 "2:30:30" · 한 시간 안이면 "15:43" (만든 때 → 끝낸 때). 모르거나 하루를 넘으면 null */
export function broadcastLength(startIso: string | null | undefined, endIso: string | null | undefined): string | null {
  if (startIso == null || endIso == null) return null
  const ms = Date.parse(endIso) - Date.parse(startIso)
  if (Number.isNaN(ms) || ms < 0 || ms >= 24 * 60 * 60_000) return null
  const total = Math.floor(ms / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  // 한 시간이 안 되면 앞의 0시간은 빼고 "15:43" (D-UX3-88)
  return hours === 0 ? `${String(minutes)}:${pad(total % 60)}` : `${String(hours)}:${pad(minutes)}:${pad(total % 60)}`
}

/** 방송 이력: 끝난 실제 방송만, 최근 것이 위 (진행 중·리허설은 빼고) */
export function pastBroadcasts(items: readonly BroadcastItem[]): BroadcastItem[] {
  return newestFirst(items).filter((item) => item.ended && !item.rehearsal)
}

/** 내 방송 한 줄 (홈·모두 보기 같은 모양, D-UX3-85·88): 플랫폼 아이콘 · 제목 · "2:30:30 · 59분 전" · 오른쪽 › */
export function HistoryRow({ item, now, onPress }: { readonly item: BroadcastItem; readonly now: number; readonly onPress: () => void }) {
  const { p } = useKit()
  const platform = item.platforms?.[0]
  // 방송 길이는 지난 시간과 헷갈려 뺐다 (D-UX3-89)
  const sub = historyAgo(item.endedAt ?? item.createdAt, now) ?? ''
  return (
    <Tap role="button" aria-label={`${broadcastTitle(item)} — ${sub}`} testID={`broadcast-${item.id}`} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md + 2, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', minHeight: TOUCH.min, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      {platform === undefined ? (
        <View aria-hidden style={{ width: 34, height: 34, borderRadius: 34 * 0.2237, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="play" color={p.textSub} size={18} />
        </View>
      ) : (
        <PlatformIcon platform={platform} size={34} />
      )}
      <View style={{ flex: 1, gap: 1 }}>
        <Txt step="bodyLarge" weight="book" numberOfLines={1}>
          {broadcastTitle(item)}
        </Txt>
        {sub === '' ? null : (
          <Txt step="caption" color="textSub" numberOfLines={1}>
            {sub}
          </Txt>
        )}
      </View>
      <Icon name="chevron" color={p.textSub} size={18} />
    </Tap>
  )
}

/** 모든 방송 (쌓인 화면) — 홈 '내 방송'과 같은 줄 모양으로 지난 방송 모두, 최근 것이 위 (D-UX3-88) */
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
  const past = items === null ? [] : pastBroadcasts(items)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="all-broadcasts">
      <AppHeader title="내 방송" onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl + room, gap: SPACE.md }}>
        {items === null && error === null ? <Loading /> : null}
        {error !== null ? (
          <Notice tone="danger" alert>
            {error}
          </Notice>
        ) : null}
        {items !== null && past.length === 0 ? <EmptyFill title="아직 지난 방송이 없어요" body="방송을 끝내면 여기에 모여요" /> : null}
        {past.length > 0 ? (
          <RowGroup label="내 방송">
            {past.map((item) => (
              <HistoryRow key={item.id} item={item} now={now} onPress={() => onOpen(item.id)} />
            ))}
          </RowGroup>
        ) : null}
      </ScrollView>
    </View>
  )
}
