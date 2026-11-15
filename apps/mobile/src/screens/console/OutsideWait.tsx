// 대기 밖 찜 (D-UX4-142, 사용자 메모 11-13 "218번 상품에 찜이 9개인데 6개까지밖에 안 보여줌", 개선 계획 E4):
// 대기 인원 설정(waitlist.max)이 차서 대기에 들지 못한 찜은 엔진이 품절(REJECTED · SOLD_OUT)로 끝낸다 — 상품 줄·자세히에 1등·대기만 그려 판매자는
// 찜이 사라진 줄 알았다. 판정(누가 1등·대기인지)은 바꾸지 않고 보이기만 한다: 상품 줄은 대기 뒤에 흐린 꼬리표, 자세히는 "대기 밖 n명 ›"을 눌러 흐린 이름을 펼친다.
// 흐린 이름은 누를 수 없다 — 이미 끝난 찜이라 지울 것이 없다(찜으로 올리기는 찜 기록에서, D-RETRO-53).
import { useState } from 'react'
import { View } from 'react-native'
import type { Claim, Product } from '@livejjim/web/src/api/types.ts'
import { productSlots } from '../../lib/derive.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { useConsoleApi } from './context.ts'
import { feedBuyerName } from './feed-rows.ts'
import { NamePill } from './parts.tsx'

/** 흐린 꼬리표·이름의 불투명도 */
export const OUTSIDE_DIM = 0.45

/** "대기 밖 n명" */
export const outsideTitle = (count: number): string => `대기 밖 ${String(count)}명`

/** 대기 밖 찜을 펼쳤을 때 이름 위 한 줄 */
export const OUTSIDE_NOTE = '대기 인원이 차서 대기에 들지 못한 찜이에요. 누가 살지는 바뀌지 않아요.'

/** 상품 열쇠 → 대기가 차 품절로 끝난 찜(찜이 온 순서) — 찜 표를 한 번만 훑는다 */
export function soldOutClaims(data: Pick<ScopeData, 'claims'>): Map<string, Claim[]> {
  const map = new Map<string, Claim[]>()
  for (const claim of data.claims.values()) {
    if (claim.status !== 'REJECTED' || claim.reason !== 'SOLD_OUT') continue
    const list = map.get(claim.product)
    if (list === undefined) map.set(claim.product, [claim])
    else list.push(claim)
  }
  for (const list of map.values()) list.sort((a, b) => a.seq - b.seq)
  return map
}

/**
 * 대기 밖 손님(지금의 구매자 ID) — 그 상품에 대기가 차 품절로 끝난 찜의 손님을 찜이 온 순서대로, 같은 손님은 한 번.
 * 이미 1등·대기에 있는 손님은 뺀다(같은 손님의 다른 찜이 자리에 있다).
 */
export function outsideBuyers(data: ScopeData, product: Product, soldOut: ReadonlyMap<string, readonly Claim[]> = soldOutClaims(data)): string[] {
  const slots = productSlots(product)
  const inside = new Set([...slots.winners, ...slots.waitlist])
  const out: string[] = []
  for (const claim of soldOut.get(product.key) ?? []) {
    if (inside.has(claim.currentBuyer) || out.includes(claim.currentBuyer)) continue
    out.push(claim.currentBuyer)
  }
  return out
}

/** 상품 자세히의 "대기 밖 n명 ›" — 누르면 흐린 이름 알약을 펼친다. 없으면 그리지 않는다 */
export function OutsideWait({ product }: { readonly product: Product }) {
  const api = useConsoleApi()
  const { p } = useKit()
  const [open, setOpen] = useState(false)
  const buyers = outsideBuyers(api.data, product)
  if (buyers.length === 0) return null
  const title = outsideTitle(buyers.length)
  return (
    <View style={{ gap: SPACE.sm }}>
      <Tap role="button" aria-label={title} aria-expanded={open} onPress={() => setOpen((now) => !now)} hitSlop={4}
        style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: SPACE.sm, marginHorizontal: -SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
        <Txt step="body" weight="bold" color="textSub">{open ? `${title} · 접기` : `${title} ›`}</Txt>
      </Tap>
      {open ? (
        <>
          <Txt step="caption" color="textSub">{OUTSIDE_NOTE}</Txt>
          <View role="list" aria-label={`${String(product.no)}번 ${title}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, opacity: OUTSIDE_DIM }}>
            {buyers.map((id) => {
              const name = feedBuyerName(api.data, api.names, id)
              return (
                <View key={id} role="listitem">
                  <NamePill text={name} tone="wait" ariaLabel={`${name} 대기 밖`} />
                </View>
              )
            })}
          </View>
        </>
      ) : null}
    </View>
  )
}
