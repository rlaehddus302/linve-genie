// 내 방송 목록 (D-UX3-18, 사용자 지시 2026-11-03 "토스 통장 목록처럼"): 플랫폼 아이콘 · 제목 · 날짜와 "2시간 전".
// 홈에는 최근 4개만 흰 카드 하나에, [모두보기]는 쌓인 화면 — 날짜마다 흰 카드를 나눈다.
// 서버 목록은 오래된 순이라 여기서 뒤집어 최근 것을 위로 둔다 — 진행 중 방송도 가장 최근 것을 고른다.
// 리허설 방송은 앱 어디에도 보이지 않는다 (D-UX3-86) — 예전에 만든 것도 목록에서 뺀다.
// 라이브 합치기 (D-MERGE-LIVE-01·03, 판매자 요청 2026-11-17 "하루에 1차, 2차 이렇게 끊어서 방송하는 경우 … 정산할 때 정보가 파편화"):
// 지난 라이브 머리 오른쪽 [합치기] → 같은 날 끝난 라이브를 골라 정산서 하나로. 합친 라이브 줄에는 "합침 · 1차" 꼬리표 — 어느 줄을 눌러도 합친 정산서가 열린다.
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { BroadcastItem } from '@livejjim/web/src/api/types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { EmptyFill, AppHeader, HeaderTextButton, Icon, RowGroup, Txt, useKit, useTabBarRoom, Tap } from '../ui/kit/index.ts'
import { MERGE_BUTTON, MERGED_TAG, mergeable, roundOf, useBroadcastGroups } from '../lib/broadcast-groups.ts'
import { MergeLivesSheet } from './console/MergeLives.tsx'
import { RADIUS, GUTTER, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { PlatformIcon } from '../ui/PlatformIcon.tsx'
import { formatWon } from '../lib/words.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { Late } from '../ui/late.tsx'

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

/**
 * 앱이 스스로 지은 제목("2026-11-09 월요일 다육이 방송")은 "…라이브"로 보인다 (D-UX4-86 — 화면 낱말 '방송'→'라이브').
 * 판매자가 직접 적은 제목은 그대로 둔다(이 꼴이 아니면 손대지 않는다).
 */
export function shownBroadcastTitle(title: string): string {
  return /^\d{4}-\d{2}-\d{2} [월화수목금토일]요일( \S+)? 방송$/.test(title) ? `${title.slice(0, -2)}라이브` : title
}

export function broadcastTitle(item: BroadcastItem): string {
  const title = item.title.trim()
  return title === '' ? `${dateWords(item.date)} 라이브` : shownBroadcastTitle(title)
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

/** 지난 라이브 줄 왼쪽 플랫폼 아이콘 (모르면 재생 표시) — 라이브 합치기 판도 같은 것을 쓴다 */
export function LiveIcon({ item, size = 34 }: { readonly item: BroadcastItem; readonly size?: number }) {
  const { p } = useKit()
  const platform = item.platforms?.[0]
  if (platform !== undefined) return <PlatformIcon platform={platform} size={size} />
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: size * 0.2237, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="play" color={p.textSub} size={Math.round(size * 0.53)} />
    </View>
  )
}

/** 홈과 모두보기에서 같은 지난 라이브 행을 쓴다. */
/** 합친 뒤 목록 위 한 줄 */
export const MERGED_DONE = '합쳤어요. 어느 라이브를 눌러도 합친 정산서가 열려요.'

export function HistoryRow({ item, now, onPress, round = null }: { readonly item: BroadcastItem; readonly now: number; readonly onPress: () => void
  /** 합친 라이브의 차례 ("1차") — 없으면 꼬리표가 없다 (D-MERGE-LIVE-03) */
  readonly round?: string | null }) {
  const { p } = useKit()
  const platform = item.platforms?.[0]
  const [, month, day] = item.date.split('-')
  const channel = item.channelName || (platform ? { band: '밴드', youtube: '유튜브', tiktok: '틱톡' }[platform] : '라이브')
  const date = `${Number(month)}.${Number(day)}`
  // 제목은 한 덩어리 "11.13 보스삼촌 라이브" — 날짜를 작은 글씨로 떼어 보이지 않는다 (D-UX4-144, 사용자 2026-11-15)
  const title = channel === '라이브' ? `${date} 라이브` : `${date} ${channel} 라이브`
  const counts = `${item.salesQty ?? '–'}개 · ${item.buyerCount ?? '–'}명`
  const sales = item.salesTotal == null ? '확인 필요' : formatWon(item.salesTotal)
  const sub = historyAgo(item.endedAt ?? item.createdAt, now) ?? ''
  return (
    <Tap role="button" aria-label={`${title}${round === null ? '' : ` · ${MERGED_TAG} ${round}`} — ${sub} · 총매출 ${sales} · ${counts}`} testID={`broadcast-${item.id}`} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md + 2, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', minHeight: TOUCH.min, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <LiveIcon item={item} />
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs }}>
          <View style={{ flexShrink: 1 }}>
            <Txt step="nav" weight="bold" numberOfLines={1}>
              {title}
            </Txt>
          </View>
          {round === null ? null : (
            <View testID={`merged-${item.id}`} style={{ paddingHorizontal: SPACE.sm, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.goldBg }}>
              <Txt step="note" weight="bold" ink={p.goldText}>{`${MERGED_TAG} · ${round}`}</Txt>
            </View>
          )}
        </View>
        {sub === '' ? null : (
          <Txt step="meta" color="textSub" numberOfLines={1}>
            {sub}
          </Txt>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt step="nav" weight="bold">{sales}</Txt>
        <Txt step="meta" color="textSub">{counts}</Txt>
      </View>
    </Tap>
  )
}

/** 같은 날 끝난 실제 라이브가 둘 이상인 날이 있나 (합치기 단추를 보일지) */
export function hasSameDayPair(items: readonly BroadcastItem[]): boolean {
  const seen = new Set<string>()
  for (const item of items) {
    if (!mergeable(item)) continue
    if (seen.has(item.date)) return true
    seen.add(item.date)
  }
  return false
}

/** 모든 방송 (쌓인 화면) — 홈 '내 방송'과 같은 줄 모양으로 지난 방송 모두, 최근 것이 위 (D-UX3-88) */
export function AllBroadcastsScreen({ onOpen, onBack, now = Date.now() }: { readonly onOpen: (id: string) => void; readonly onBack: () => void; readonly now?: number }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  // 기억해 둔 방송 목록을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77)
  const { data, error: loadError } = useCachedGet<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')
  const items = data?.broadcasts ?? null
  const error = loadError === null ? null : loadError.message
  const past = items === null ? [] : pastBroadcasts(items)
  const { groups } = useBroadcastGroups()
  const [merging, setMerging] = useState(false)
  const [done, setDone] = useState(false)
  // 같은 날 끝난 라이브가 2개 이상일 때만 [합치기]
  const canMerge = items !== null && hasSameDayPair(items)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="all-broadcasts">
      <AppHeader title="지난 라이브" onBack={onBack} right={canMerge ? <HeaderTextButton label={MERGE_BUTTON} testID="merge-open" onPress={() => { setDone(false); setMerging(true) }} /> : undefined} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl + room, gap: SPACE.md }}>
        {items === null && error === null ? <Loading /> : null}
        {error !== null ? (
          <Notice tone="danger" alert>
            {error}
          </Notice>
        ) : null}
        {/* 서버에서 받은 뒤에야 생기는 것은 부드럽게 (D-UX4-112) */}
        <Late style={{ flexGrow: 1 }}>
          {items !== null && past.length === 0 ? <EmptyFill title="아직 지난 라이브가 없어요" body="라이브를 끝내면 여기에 모여요" /> : null}
        </Late>
        {done ? <Txt color="textSub" role="status">{MERGED_DONE}</Txt> : null}
        <Late>
          {past.length > 0 ? (
            <RowGroup label="지난 라이브">
              {past.map((item) => (
                <HistoryRow key={item.id} item={item} now={now} round={roundOf(groups, item.id)} onPress={() => onOpen(item.id)} />
              ))}
            </RowGroup>
          ) : null}
        </Late>
      </ScrollView>
      {items !== null ? <MergeLivesSheet visible={merging} items={items} groups={groups} onClose={() => setMerging(false)} onMerged={() => { setMerging(false); setDone(true) }} /> : null}
    </View>
  )
}
