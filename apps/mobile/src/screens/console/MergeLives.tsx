// 라이브 합치기 판 (D-MERGE-LIVE-01·03, 판매자 요청 2026-11-17 "라이브 합치는 기능 있으면 좋을 듯. 하루에 1차, 2차 이렇게 끊어서 방송하는 경우도 있기 때문에"):
// 끝난 라이브를 날짜마다 묶어 보이고, 같은 날 라이브를 2개 이상 고르면 [n개 합치기]. 다른 날 라이브를 누르면 그 줄 하나로 새로 고르고 까닭을 한 줄 알린다.
// - 단추는 좌우 한 줄: 왼쪽 [취소] · 오른쪽 [n개 합치기] (절대 규칙 8).
// - 이미 합친 라이브는 "합침 · 1차"를 달고, 다시 고르면 그 묶음 전체에 더해진다(서버가 흡수한다).
// - 같은 요청 번호로 다시 보내도 서버는 처음 결과를 준다 — 판을 열 때 번호를 하나 정한다.
// 함께 쓰는 곳: 지난 라이브 목록(AllBroadcastsScreen)의 [합치기] · 정산서의 "같은 날 라이브가 더 있어요" [합치기].
import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import type { BroadcastItem } from '@livejjim/web/src/api/types.ts'
import { dateWords, kstHm } from '@livejjim/web/src/lib/kst.ts'
import { isApiError, newRequestId, post } from '../../api/client.ts'
import { fetchCached } from '../../lib/cached-get.ts'
import { formatWon } from '../../lib/words.ts'
import {
  GROUPS_PATH, MERGE_CANCEL, MERGE_DESCRIPTION, MERGE_FAILED, MERGE_NONE, MERGE_OTHER_DAY, MERGE_TITLE, MERGED_TAG,
  mergeConfirm, mergeable, roundOf, toggleMergePick, type BroadcastGroup,
} from '../../lib/broadcast-groups.ts'
import { BigButton, ChoiceCheck, CHOICE_CHECK, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { BottomSheet } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'

/** 줄 이름: "11.17 보스삼촌 라이브" (지난 라이브 줄과 같은 꼴) */
export function liveName(item: BroadcastItem): string {
  const [, month, day] = item.date.split('-')
  const platform = item.platforms?.[0]
  const channel = item.channelName || (platform ? { band: '밴드', youtube: '유튜브', tiktok: '틱톡' }[platform] : '')
  return `${Number(month)}.${Number(day)} ${channel === '' ? '' : `${channel} `}라이브`
}

/** 줄 아래 글: "오후 9:10에 끝남 · 12개 · 350,000원" — 같은 날 라이브를 끝난 시각으로 가른다 */
export function liveSub(item: BroadcastItem): string {
  const ended = item.endedAt === null ? '' : kstHm(item.endedAt)
  const parts = [ended === '' ? null : `${ended}에 끝남`, item.salesQty == null ? null : `${String(item.salesQty)}개`, item.salesTotal == null ? null : formatWon(item.salesTotal)]
  return parts.filter((part) => part !== null).join(' · ')
}

/** 날짜별 (최근 날짜가 위, 날짜 안은 시작 순서 — 1차가 위) */
function byDay(items: readonly BroadcastItem[]): { readonly date: string; readonly items: readonly BroadcastItem[] }[] {
  const days = new Map<string, BroadcastItem[]>()
  for (const item of items) days.set(item.date, [...(days.get(item.date) ?? []), item])
  return [...days.entries()].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0)).map(([date, list]) => ({ date, items: list }))
}

export function MergeLivesSheet({ visible, items, groups, initial, onClose, onMerged }: {
  readonly visible: boolean
  /** 고를 수 있는 라이브 (서버 목록 순서 — 오래된 것부터). 끝난 실제 라이브만 보인다 */
  readonly items: readonly BroadcastItem[]
  readonly groups: readonly BroadcastGroup[] | null
  /** 처음 골라 둘 라이브 */
  readonly initial?: readonly string[]
  readonly onClose: () => void
  readonly onMerged: (group: BroadcastGroup) => void
}) {
  const { p } = useKit()
  const candidates = useMemo(() => items.filter(mergeable), [items])
  const days = useMemo(() => byDay(candidates), [candidates])
  const [picked, setPicked] = useState<readonly string[]>(initial ?? [])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const requestId = useRef(newRequestId())
  // 판을 열 때마다 처음 고른 것·새 요청 번호로
  const initialKey = (initial ?? []).join('+')
  useEffect(() => {
    if (!visible) return
    setPicked(initialKey === '' ? [] : initialKey.split('+'))
    setNote('')
    requestId.current = newRequestId()
  }, [visible, initialKey])
  const pick = (id: string) => {
    if (busy) return
    const next = toggleMergePick(candidates, picked, id)
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
  const enough = days.some((day) => day.items.length >= 2)
  return (
    <BottomSheet visible={visible} onClose={onClose} title={MERGE_TITLE} description={MERGE_DESCRIPTION} testID="merge-lives"
      actions={<>
        <BigButton kind="secondary" label={MERGE_CANCEL} disabled={busy} onPress={onClose} />
        <BigButton label={mergeConfirm(picked.length)} busy={busy} disabled={picked.length < 2} onPress={() => void merge()} />
      </>}>
      {!enough ? <Txt color="textSub">{MERGE_NONE}</Txt> : null}
      {days.map((day) => (
        <View key={day.date} role="group" aria-label={dateWords(day.date)} style={{ gap: SPACE.xs }}>
          <Txt step="body" weight="bold" color="textSub">{dateWords(day.date)}</Txt>
          {day.items.map((item) => {
            const on = picked.includes(item.id)
            const round = roundOf(groups, item.id)
            const name = liveName(item)
            const sub = liveSub(item)
            return (
              <Tap key={item.id} role="checkbox" aria-checked={on} aria-label={[name, round === null ? null : `${MERGED_TAG} ${round}`, sub].filter(Boolean).join(' · ')}
                testID={`merge-pick-${item.id}`} onPress={() => pick(item.id)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 56, paddingHorizontal: SPACE.md, marginHorizontal: -SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
                    <Txt step="bodyLarge" weight="bold">{name}</Txt>
                    {round === null ? null : (
                      <View style={{ paddingHorizontal: SPACE.sm, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.goldBg }}>
                        <Txt step="note" weight="bold" ink={p.goldText}>{`${MERGED_TAG} · ${round}`}</Txt>
                      </View>
                    )}
                  </View>
                  {sub === '' ? null : <Txt step="meta" color="textSub">{sub}</Txt>}
                </View>
                {on ? <ChoiceCheck /> : <View aria-hidden style={{ width: CHOICE_CHECK, height: CHOICE_CHECK, borderRadius: CHOICE_CHECK / 2, borderCurve: 'continuous', borderWidth: 2, borderColor: p.border }} />}
              </Tap>
            )
          })}
        </View>
      ))}
      {note !== '' ? <Txt color="dangerText" role="alert">{note}</Txt> : null}
    </BottomSheet>
  )
}
