// 번호에 남은 변형 보류 찜의 변형 찾기 (R-5, R-10 1, R-19 "찜을 가리키는 방송자 조치", R-20 8).
// 번호를 바꾸면(R-10 1) 이전 번호에 그 상품의 변형 보류 찜이 남는다. 그 번호에 상품이 없거나 다른 상품이 와도,
// 판매자는 그 찜의 옵션(claim.options)을 적어 취소·무효·요청 처리로 하나씩 끝낼 수 있어야 한다.
// 입력 검사(validate-options)와 엔진(reducer)이 같은 함수를 써서 받는 입력과 찾는 찜이 어긋나지 않게 한다.
import type { OptionPick } from '../options.ts'
import { pkeys, type PMap } from './pmap.ts'

interface PendingSlot {
  readonly pending: PMap<true>
}

interface ClaimOptions {
  readonly variant: string | null
  readonly options: readonly (readonly [string, string])[] | null
}

/** 고른 옵션 맵이 찜의 옵션 쌍과 똑같은가 (항목 수·이름·label 모두) */
function samePick(pairs: readonly (readonly [string, string])[], pick: OptionPick): boolean {
  if (Object.keys(pick).length !== pairs.length) return false
  return pairs.every(([name, label]) => Object.hasOwn(pick, name) && pick[name] === label)
}

/**
 * 그 번호의 보류 찜 가운데 고른 옵션과 옵션 쌍이 똑같은 변형 찜의 변형.
 * 같은 쌍이면 같은 옵션 글이라 어느 찜을 고르든 결과가 같다. 없으면 null.
 */
export function leftoverVariant(
  slot: PendingSlot | undefined,
  readClaim: (id: string) => ClaimOptions | undefined,
  pick: OptionPick,
): { readonly text: string; readonly pairs: readonly (readonly [string, string])[] } | null {
  if (slot === undefined) return null
  for (const id of pkeys(slot.pending)) {
    const claim = readClaim(id)
    // 옵션 쌍은 옵션 글과 함께만 있다 (ClaimRecord.options)
    if (claim?.options == null || claim.variant === null) continue
    if (samePick(claim.options, pick)) return { text: claim.variant, pairs: claim.options }
  }
  return null
}
