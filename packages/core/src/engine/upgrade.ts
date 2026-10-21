// 상태 형식 4 → 5 (O1, AC-O1-30). 형식 4는 옵션 방송이 없던 상태라 새 칸을 빈 값·기본값으로 채우면 같은 판정이 이어진다:
// 방송의 지금 상품 없음, 상품의 별칭·옵션·변형 없음, 번호의 변형 자리·변형 활성 표시·변형을 정하지 않은 취소 요청 없음,
// 찜의 수량 1·옵션 없음, 메시지의 확인 필요 아님, 확인 필요 항목 없음, 설정 스냅샷의 claim.maxQuantity = 기본값.
// 저장했다 읽은 형식 4 상태를 바꿔 이어 재생한 결과 = 처음부터 재생한 결과다(단위 시험이 확인한다).
import { DEFAULT_SETTINGS } from '../settings.ts'
import { emptyPMap, pentries, pset, type PMap } from './pmap.ts'
import { STATE_FORMAT, StateFormatError, assertStateFormat } from './state-format.ts'
import type { BroadcastRecord, ClaimRecord, EngineState, MessageRecord, ProductRecord, SlotRecord } from './types.ts'

/** 형식 4 상태의 모양 (새 칸이 없다) */
interface V4State {
  readonly format: 4
  readonly broadcasts: readonly Omit<BroadcastRecord, 'focus'>[]
  readonly slots: PMap<Omit<SlotRecord, 'units' | 'variantActive' | 'requests' | 'product'> & { readonly product: Omit<ProductRecord, 'aliases' | 'options' | 'variants'> | null }>
  readonly claims: PMap<Omit<ClaimRecord, 'qty' | 'qtyWritten' | 'variant' | 'options'>>
  readonly messages: PMap<Omit<MessageRecord, 'review'>>
  readonly [key: string]: unknown
}

function mapValues<A, B>(map: PMap<A>, f: (value: A) => B): PMap<B> {
  let out = emptyPMap<B>()
  for (const [key, value] of pentries(map)) out = pset(out, key, f(value))
  return out
}

/**
 * 저장한 상태를 지금 형식으로 바꾼다. 지금 형식이면 그대로 돌려주고, 형식 4면 새 칸을 채운 새 상태를 돌려준다(넘긴 상태는 바꾸지 않는다).
 * 그 밖의 형식(3 이하, 모르는 값)은 StateFormatError — 이벤트 로그를 처음부터 재생한다(D-072).
 */
export function upgradeState(state: unknown): EngineState {
  if (typeof state === 'object' && state !== null && (state as { readonly format?: unknown }).format === STATE_FORMAT) {
    assertStateFormat(state)
    return state as EngineState
  }
  if (typeof state !== 'object' || state === null || (state as { readonly format?: unknown }).format !== 4) {
    assertStateFormat(state)
    throw new StateFormatError(null, '알 수 없음')
  }
  const old = state as V4State
  const broadcasts: BroadcastRecord[] = old.broadcasts.map((broadcast) => ({
    ...broadcast,
    settings: { ...DEFAULT_SETTINGS, ...broadcast.settings, 'claim.maxQuantity': DEFAULT_SETTINGS['claim.maxQuantity'] },
    focus: null,
  }))
  const slots = mapValues(old.slots, (slot): SlotRecord => ({
    ...slot,
    product: slot.product === null ? null : { ...slot.product, aliases: [], options: [], variants: [] },
    units: [],
    variantActive: emptyPMap(),
    requests: [],
  }))
  const claims = mapValues(old.claims, (claim): ClaimRecord => ({ ...claim, qty: 1, qtyWritten: false, variant: null, options: null }))
  const messages = mapValues(old.messages, (message): MessageRecord => ({ ...message, review: false }))
  return { ...(old as unknown as EngineState), format: STATE_FORMAT, broadcasts, slots, claims, messages, reviews: emptyPMap() }
}
