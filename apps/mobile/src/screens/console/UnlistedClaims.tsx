// 등록 안 된 번호의 찜 알림 (D-RETRO-23, 11월 12일 라이브 복기 9.2 — 찜 셋 중 둘이 상품보다 먼저 왔고 397번 찜은 기다리다 만료됐다):
// 아직 상품이 없는 번호에 손님 찜이 기다리고 있으면 탭 바 위에 주황 줄로 알린다 — "등록 안 된 번호에 찜 2건" + 번호 알약.
// 번호 알약을 누르면 그 번호가 채워진 상품 추가가 열린다. 번호가 많아도 알약은 한 줄(옆으로 밀어 본다)이라 위아래로 쌓이지 않는다.
// 앱은 판정하지 않는다 — 서버가 준 보류 찜 자리(범위 자료 pending)를 그대로 센다. 닉네임·채팅 글은 그리지 않는다.
import { ScrollView, View } from 'react-native'
import type { ScopeData } from '../../lib/scope-data.ts'
import { Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, pressedFill } from '../../ui/kit/tokens.ts'

export interface UnlistedNumber {
  readonly no: number
  /** 그 번호에서 기다리는 찜 수 */
  readonly count: number
}

export const UNLISTED_LABEL = '등록 안 된 번호의 찜'
export const unlistedTitle = (total: number): string => `등록 안 된 번호에 찜 ${String(total)}건`
export const unlistedPill = (item: UnlistedNumber): string => (item.count > 1 ? `${String(item.no)}번 ${String(item.count)}건 ›` : `${String(item.no)}번 ›`)
export const unlistedPillLabel = (no: number): string => `${String(no)}번 상품 추가`

/** 그 방송에서 아직 상품이 없는 번호에 기다리는 찜 — 가장 오래 기다린 번호부터 (알림 띠의 "보류 찜"과 같은 기준: 상품이 있는 번호는 뺀다) */
export function unlistedNumbers(data: ScopeData, b: string): UnlistedNumber[] {
  const rows: { readonly no: number; readonly count: number; readonly first: number }[] = []
  for (const slot of data.pending.values()) {
    if (slot.broadcast !== b || slot.claims.length === 0 || data.products.has(slot.product)) continue
    let first = Number.MAX_SAFE_INTEGER
    for (const id of slot.claims) first = Math.min(first, data.claims.get(id)?.seq ?? Number.MAX_SAFE_INTEGER)
    rows.push({ no: slot.no, count: slot.claims.length, first })
  }
  return rows.sort((x, y) => x.first - y.first || x.no - y.no).map(({ no, count }) => ({ no, count }))
}

export function UnlistedClaims({ numbers, onAdd }: { readonly numbers: readonly UnlistedNumber[]; readonly onAdd: (no: number) => void }) {
  const { p, tones } = useKit()
  if (numbers.length === 0) return null
  const pair = tones.warning
  const total = numbers.reduce((sum, item) => sum + item.count, 0)
  return (
    <View role="region" aria-label={UNLISTED_LABEL} testID="unlisted-claims" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.sm, paddingLeft: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pair.bg, overflow: 'hidden' }}>
      <Txt step="caption" weight="bold" ink={pair.fg}>
        {unlistedTitle(total)}
      </Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', gap: SPACE.xs, paddingRight: SPACE.md }}>
        {numbers.map((item) => (
          <Tap
            key={item.no}
            role="button"
            aria-label={unlistedPillLabel(item.no)}
            hitSlop={6}
            onPress={() => onAdd(item.no)}
            style={({ pressed }) => ({ paddingVertical: 6, paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: pressed ? pressedFill(p, p.surface) : p.surface })}
          >
            <Txt step="caption" weight="bold">
              {unlistedPill(item)}
            </Txt>
          </Tap>
        ))}
      </ScrollView>
    </View>
  )
}
