// 라이브 합치기 판 (D-MERGE-LIVE-01·03·05, 판매자 요청 2026-11-17 "라이브 합치는 기능 있으면 좋을 듯. 하루에 1차, 2차 이렇게 끊어서 방송하는 경우도 있기 때문에"):
// 끝난 라이브를 최근 것이 위로 한 목록에 보인다(날짜 머리 없음 — 줄 이름에 "11.16"이 있다). 줄은 홈 지난 라이브처럼 왼쪽 플랫폼 아이콘,
// 아래 "56분 전 · 59개 · 450,000원". 같은 날 라이브를 2개 이상 고르면 [합치기]. 다른 날 라이브를 누르면 그 줄 하나로 새로 고르고 까닭을 한 줄 알린다.
// - 정산서에서 열면 그 정산서의 라이브는 골라 두고 풀 수 없다(locked, D-MERGE-LIVE-05).
// - 단추는 좌우 한 줄: 왼쪽 [취소] · 오른쪽 [합치기] (절대 규칙 8).
// - 이미 합친 라이브는 "합침 · 1차"를 달고, 다시 고르면 그 묶음 전체에 더해진다(서버가 흡수한다).
// - 같은 요청 번호로 다시 보내도 서버는 처음 결과를 준다 — 판을 열 때 번호를 하나 정한다.
// 함께 쓰는 곳: 지난 라이브 목록(AllBroadcastsScreen)의 [합치기] · 정산서의 "같은 날 라이브가 n개 더 있어요." [합치기].
import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import type { BroadcastItem } from '@livejjim/web/src/api/types.ts'
import { isApiError, newRequestId, post } from '../../api/client.ts'
import { fetchCached } from '../../lib/cached-get.ts'
import { formatWon } from '../../lib/words.ts'
import {
  GROUPS_PATH, MERGE_CANCEL, MERGE_DESCRIPTION, MERGE_FAILED, MERGE_NONE, MERGE_OTHER_DAY, MERGE_TITLE, MERGED_TAG,
  MERGE_BUTTON, mergeable, roundOf, toggleMergePick, type BroadcastGroup,
} from '../../lib/broadcast-groups.ts'
import { BigButton, ChoiceCheck, CHOICE_CHECK, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { BottomSheet } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { LiveIcon, historyAgo } from '../BroadcastList.tsx'

/** 줄 이름: "11.17 보스삼촌 라이브" (지난 라이브 줄과 같은 꼴) */
export function liveName(item: BroadcastItem): string {
  const [, month, day] = item.date.split('-')
  const platform = item.platforms?.[0]
  const channel = item.channelName || (platform ? { band: '밴드', youtube: '유튜브', tiktok: '틱톡' }[platform] : '')
  return `${Number(month)}.${Number(day)} ${channel === '' ? '' : `${channel} `}라이브`
}

/** 줄 아래 글: "56분 전 · 59개 · 450,000원" — 홈 지난 라이브와 같은 지난 시간(끝난 때 기준) */
export function liveSub(item: BroadcastItem, now: number): string {
  const parts = [historyAgo(item.endedAt ?? item.createdAt, now), item.salesQty == null ? null : `${String(item.salesQty)}개`, item.salesTotal == null ? null : formatWon(item.salesTotal)]
  return parts.filter((part) => part !== null).join(' · ')
}

/** 최근 것이 위 (끝난 때 → 만든 때, 같으면 서버 목록의 뒤쪽이 위) */
export function newestMergeFirst(items: readonly BroadcastItem[]): BroadcastItem[] {
  const at = (item: BroadcastItem): number => Date.parse(item.endedAt ?? item.createdAt ?? '') || 0
  return items.map((item, index) => ({ item, index })).sort((a, b) => at(b.item) - at(a.item) || b.index - a.index).map(({ item }) => item)
}

/** 같은 날 라이브가 2개 이상 있나 */
function hasPair(items: readonly BroadcastItem[]): boolean {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.date)) return true
    seen.add(item.date)
  }
  return false
}

export function MergeLivesSheet({ visible, items, groups, initial, locked = [], now = Date.now(), onClose, onMerged }: {
  readonly visible: boolean
  /** 고를 수 있는 라이브 (서버 목록 순서 — 오래된 것부터). 끝난 실제 라이브만 보인다 */
  readonly items: readonly BroadcastItem[]
  readonly groups: readonly BroadcastGroup[] | null
  /** 처음 골라 둘 라이브 */
  readonly initial?: readonly string[]
  /** 골라 두고 풀 수 없는 라이브 (정산서에서 연 그 정산서의 라이브) */
  readonly locked?: readonly string[]
  /** 지난 시간 기준 (시험용) */
  readonly now?: number
  readonly onClose: () => void
  readonly onMerged: (group: BroadcastGroup) => void
}) {
  const { p } = useKit()
  const candidates = useMemo(() => items.filter(mergeable), [items])
  const rows = useMemo(() => newestMergeFirst(candidates), [candidates])
  const [picked, setPicked] = useState<readonly string[]>(initial ?? [])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const requestId = useRef(newRequestId())
  // 판을 열 때마다 처음 고른 것·새 요청 번호로
  const initialKey = [...new Set([...(initial ?? []), ...locked])].join('+')
  useEffect(() => {
    if (!visible) return
    setPicked(initialKey === '' ? [] : initialKey.split('+'))
    setNote('')
    requestId.current = newRequestId()
  }, [visible, initialKey])
  const pick = (id: string) => {
    if (busy || locked.includes(id)) return
    const next = toggleMergePick(candidates, picked, id)
    // 풀 수 없는 라이브가 빠지는 고르기(다른 날 라이브)는 받지 않는다
    if (!locked.every((keep) => next.picked.includes(keep))) {
      setNote(MERGE_OTHER_DAY)
      return
    }
    setPicked(next.picked)
    setNote(next.otherDay ? MERGE_OTHER_DAY : '')
  }
  const merge = async () => {
    if (busy || picked.length < 2) return
    setBusy(true)
    setNote('')
    try {
      const { group } = await post<{ group: BroadcastGroup }>(GROUPS_PATH, { requestId: requestId.current, broadcasts: picked })
      await fetchCached(GROUPS_PATH, true).catch(() => undefined)
      onMerged(group)
    } catch (e) {
      setNote(isApiError(e) ? e.message : MERGE_FAILED)
      // 서버가 받지 않았으면 다음 누름은 새 요청으로
      if (isApiError(e) && e.status !== undefined && e.status >= 400 && e.status < 500) requestId.current = newRequestId()
    } finally {
      setBusy(false)
    }
  }
  const enough = hasPair(candidates)
  return (
    <BottomSheet visible={visible} onClose={onClose} title={MERGE_TITLE} description={MERGE_DESCRIPTION} testID="merge-lives"
      actions={<>
        <BigButton kind="secondary" label={MERGE_CANCEL} disabled={busy} onPress={onClose} />
        <BigButton label={MERGE_BUTTON} busy={busy} disabled={picked.length < 2} onPress={() => void merge()} />
      </>}>
      {!enough ? <Txt color="textSub">{MERGE_NONE}</Txt> : null}
      {rows.map((item) => {
        const on = picked.includes(item.id)
        const fixed = locked.includes(item.id)
        const round = roundOf(groups, item.id)
        const name = liveName(item)
        const sub = liveSub(item, now)
        return (
          <Tap key={item.id} role="checkbox" aria-checked={on} aria-disabled={fixed} aria-label={[name, round === null ? null : `${MERGED_TAG} ${round}`, sub].filter(Boolean).join(' · ')}
            testID={`merge-pick-${item.id}`} onPress={() => pick(item.id)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 56, paddingHorizontal: SPACE.md, marginHorizontal: -SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed && !fixed ? p.pressed : 'transparent' })}>
            <LiveIcon item={item} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                <View style={{ flexShrink: 1 }}><Txt step="bodyLarge" weight="bold" numberOfLines={1}>{name}</Txt></View>
                {round === null ? null : (
                  <View style={{ paddingHorizontal: SPACE.sm, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.goldBg }}>
                    <Txt step="note" weight="bold" ink={p.goldText}>{`${MERGED_TAG} · ${round}`}</Txt>
                  </View>
                )}
              </View>
              {sub === '' ? null : <Txt step="meta" color="textSub" numberOfLines={1}>{sub}</Txt>}
            </View>
            {on ? <ChoiceCheck /> : <View aria-hidden style={{ width: CHOICE_CHECK, height: CHOICE_CHECK, borderRadius: CHOICE_CHECK / 2, borderCurve: 'continuous', borderWidth: 2, borderColor: p.border }} />}
          </Tap>
        )
      })}
      {note !== '' ? <Txt color="dangerText" role="alert">{note}</Txt> : null}
    </BottomSheet>
  )
}
