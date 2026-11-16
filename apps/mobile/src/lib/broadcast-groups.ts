// 라이브 합치기 (D-MERGE-LIVE-01~, 판매자 요청 2026-11-17 "하루에 1차, 2차 이렇게 끊어서 방송하는 경우도 있기 때문에 나중에 정산할 때 정보가 파편화됨"):
// 같은 날 끝난 라이브 여럿을 정산서 하나로 묶는다. 서버가 묶음을 기록하고(GET·POST /api/broadcast-groups, 나누기 POST …/:id/split), 앱은 묶음대로 정산서를 그린다.
// - 묶인 라이브 어느 것을 열어도 합친 정산서다(1차만 담긴 정산서가 따로 나가지 않게). 가게 이름은 묶음 첫 라이브(1차)의 것.
// - 보낸 손님 표시(이 기기)는 묶음마다 따로 둔다. 합치기 전에 따로 받은 정산서·나누기 전에 받은 합친 정산서가 있으면 "먼저 받은 정산서"로 알려
//   두 번 보내 손님이 돈을 두 번 내는 일이 없게 한다 — 모두에게 보내기 차례에서도 빼고 따로 보이게 한다.
// - 옛 서버(경로 없음 404)면 묶음이 없는 것과 같다.
import type { BroadcastItem } from '@livejjim/web/src/api/types.ts'
import { roundWord } from './broadcast-sales.ts'
import { useMemo } from 'react'
import { peekCached, rememberCached, useCachedGet } from './cached-get.ts'
import { markBuyerSent, sentBuyers } from './statement-info.ts'

export const GROUPS_PATH = '/api/broadcast-groups'

export interface BroadcastGroup {
  readonly id: string
  readonly date: string
  /** 그날 시작 순서 — 첫째가 1차 */
  readonly broadcasts: readonly string[]
}

/** 정산서 하나가 담는 라이브 */
export interface StatementScope {
  /** 보낸 손님 표시의 이름 (한 라이브면 그 라이브 ID, 합친 라이브면 "group:<묶음 ID>:<라이브 ID+…>" — 묶음 모습이 바뀌면 새 이름) */
  readonly key: string
  /** 담는 라이브 (그날 시작 순서) */
  readonly broadcasts: readonly string[]
  /** 가게 이름을 읽는 라이브 (1차) */
  readonly lead: string
  readonly group: BroadcastGroup | null
  /** 묶음 목록을 받았나 (옛 서버면 받은 것으로 본다) — 받기 전에는 보내기를 막는다 */
  readonly ready: boolean
  /** 묶음 목록을 받지 못했다 (다시 불러오기를 보인다) */
  readonly failed?: boolean
}

// ── 화면 글 ──
export const MERGE_TITLE = '라이브 합치기'
export const MERGE_DESCRIPTION = '같은 날 끝난 라이브를 골라 주세요. 정산서가 하나로 합쳐지고 배송비는 한 번만 붙어요. 언제든 다시 나눌 수 있어요.'
export const MERGE_BUTTON = '합치기'
export const MERGE_CANCEL = '취소'
export const mergeConfirm = (count: number): string => `${String(count)}개 합치기`
export const MERGE_OTHER_DAY = '같은 날 라이브만 합칠 수 있어요.'
export const MERGE_NONE = '같은 날 끝난 라이브가 2개 이상 있어야 합칠 수 있어요.'
export const MERGE_FAILED = '합치지 못했어요. 다시 해 주세요.'
export const SPLIT_QUESTION = '합친 라이브를 나눌까요?'
export const SPLIT_DESCRIPTION = '라이브마다 정산서가 따로 생기고 배송비도 라이브마다 붙어요. 이미 보낸 정산서는 그대로예요.'
export const SPLIT_BUTTON = '나누기'
export const SPLIT_FAILED = '나누지 못했어요. 다시 해 주세요.'
export const MERGED_TAG = '합침'
export const GROUPS_CHECKING = '합친 라이브인지 확인하고 있어요.'
export const GROUPS_FAILED = '합친 라이브인지 확인하지 못했어요. 다시 불러와 주세요.'
export const GROUPS_RETRY = '다시 불러오기'
/** 합친 정산서 위 한 줄: "1차 · 2차를 합친 정산서예요" */
export const mergedNote = (count: number): string => `${Array.from({ length: count }, (_, i) => roundWord(i)).join(' · ')}를 합친 정산서예요`
/** 합치지 않은 같은 날 라이브가 더 있을 때 */
export const siblingsNote = (count: number): string => `같은 날 끝난 라이브가 ${String(count)}개 더 있어요. 합치면 정산서 하나로 보낼 수 있어요.`
export const EARLIER_TITLE = '먼저 받은 정산서가 있어요'
export const EARLIER_NOTE = '이 손님은 합치기(또는 나누기) 전에 정산서를 받았어요. 이미 입금했는지 확인하고 보내 주세요.'

/** 서버 묶음 응답 → 지금 묶음 목록 (옛 서버 404면 빈 목록, 아직이면 null) */
export function useBroadcastGroups(): { readonly groups: readonly BroadcastGroup[] | null; readonly failed: boolean; readonly reload: () => Promise<void> } {
  const { data, error, reload } = useCachedGet<{ groups: BroadcastGroup[] }>(GROUPS_PATH)
  if (data !== null) return { groups: data.groups, failed: false, reload }
  if (error !== null) return error.status === 404 ? { groups: [], failed: false, reload } : { groups: null, failed: true, reload }
  return { groups: null, failed: false, reload }
}

/** 그 라이브가 든 묶음 */
export function groupOf(groups: readonly BroadcastGroup[] | null, broadcastId: string): BroadcastGroup | null {
  return groups?.find((group) => group.broadcasts.includes(broadcastId)) ?? null
}

/** 정산서가 담는 라이브 (순수 함수) */
export function statementScope(groups: readonly BroadcastGroup[] | null, broadcastId: string): StatementScope {
  const group = groupOf(groups, broadcastId)
  if (group === null) return { key: broadcastId, broadcasts: [broadcastId], lead: broadcastId, group: null, ready: groups !== null }
  return { key: `group:${group.id}:${group.broadcasts.join('+')}`, broadcasts: group.broadcasts, lead: group.broadcasts[0] ?? broadcastId, group, ready: true }
}

/** 정산서 화면이 쓰는 묶음 범위 */
export function useStatementScope(broadcastId: string): StatementScope & { readonly reload: () => Promise<void> } {
  const { groups, failed, reload } = useBroadcastGroups()
  const scope = statementScope(groups, broadcastId)
  // 같은 모습이면 같은 물건 — 화면의 useMemo가 쓸데없이 다시 돌지 않게
  return useMemo(() => ({ ...scope, failed, reload }), [scope.key, scope.ready, failed, reload])
}

/**
 * 합친 정산서를 받은 손님 (라이브마다, "<정산서 이름>\n<구매자>") — 나눈 뒤에도 남는다.
 * 정산서 이름에 묶음의 라이브 목록이 들어 있어, 3차를 더해 묶음이 커지면 앞서 1·2차만 담긴 정산서를 받은 손님을 "보냄"이 아니라 "먼저 받음"으로 본다
 */
const mergedSentKey = (broadcastId: string): string => `app:statement-sent-merged:${broadcastId}`
const SEP = '\n'
function mergedSent(broadcastId: string): readonly string[] {
  return peekCached<readonly string[]>(mergedSentKey(broadcastId)) ?? []
}

/** 보냈다고 적는다 — 합친 정산서면 담긴 라이브마다 "합친 정산서를 받음"도 적는다 */
export function markScopeSent(scope: Pick<StatementScope, 'key' | 'broadcasts' | 'group'>, buyer: string): readonly string[] {
  if (scope.group !== null) {
    for (const id of scope.broadcasts) rememberCached(mergedSentKey(id), [...new Set([...mergedSent(id), `${scope.key}${SEP}${buyer}`])])
  }
  return markBuyerSent(scope.key, buyer)
}

/**
 * 이 정산서가 아닌 다른 정산서로 이미 받은 손님 (이 기기 기억만 읽는다):
 * 합친 정산서면 — 담긴 라이브 하나만의 정산서를 받았거나, 모습이 다른(나눈·커진) 합친 정산서를 받은 손님.
 * 한 라이브 정산서면 — 이 라이브가 든 합친 정산서를 받은 손님. 이 정산서로 이미 보낸 손님은 "보냄"이라 뺀다
 */
export function earlierSent(scope: Pick<StatementScope, 'key' | 'broadcasts' | 'group'>): readonly string[] {
  const out = new Set<string>()
  for (const id of scope.broadcasts) {
    if (scope.group !== null) for (const buyer of sentBuyers(id)) out.add(buyer)
    for (const entry of mergedSent(id)) {
      const at = entry.indexOf(SEP)
      if (at > 0 && entry.slice(0, at) !== scope.key) out.add(entry.slice(at + SEP.length))
    }
  }
  for (const buyer of sentBuyers(scope.key)) out.delete(buyer)
  return [...out]
}

// ── 고르기 (순수 함수) ──

/** 합칠 수 있는 라이브: 끝난 실제 라이브 */
export const mergeable = (item: BroadcastItem): boolean => item.ended && !item.rehearsal

/**
 * 줄을 눌렀을 때 고른 목록. 다른 날 라이브를 누르면 그 줄 하나로 새로 고른다(같은 날만 함께 고를 수 있다) — 바뀐 까닭을 알릴지(otherDay)도 준다
 */
export function toggleMergePick(items: readonly BroadcastItem[], picked: readonly string[], id: string): { readonly picked: readonly string[]; readonly otherDay: boolean } {
  const item = items.find((row) => row.id === id)
  if (item === undefined || !mergeable(item)) return { picked, otherDay: false }
  if (picked.includes(id)) return { picked: picked.filter((row) => row !== id), otherDay: false }
  const date = items.find((row) => row.id === picked[0])?.date
  if (date !== undefined && date !== item.date) return { picked: [id], otherDay: true }
  return { picked: [...picked, id], otherDay: false }
}

/** 같은 날 끝난 라이브 가운데 이 정산서에 담기지 않은 것 (합치기 안내) */
export function sameDayOthers(items: readonly BroadcastItem[], scope: Pick<StatementScope, 'broadcasts'>, date: string): BroadcastItem[] {
  return items.filter((item) => mergeable(item) && item.date === date && !scope.broadcasts.includes(item.id))
}

/** 묶음의 차례 이름 ("1차") — 묶이지 않았으면 null */
export function roundOf(groups: readonly BroadcastGroup[] | null, broadcastId: string): string | null {
  const group = groupOf(groups, broadcastId)
  if (group === null) return null
  return roundWord(group.broadcasts.indexOf(broadcastId))
}
