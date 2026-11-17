// 등록 안 된 번호의 찜 알림 (D-RETRO-23, 11월 12일 라이브 복기 9.2 — 찜 셋 중 둘이 상품보다 먼저 왔고 397번 찜은 기다리다 만료됐다):
// 아직 상품이 없는 번호에 손님 찜이 기다리고 있으면 오른쪽 아래 빨간 알림으로 알린다 — "등록 안 된 번호에 찜 2건 ›"(D-ALERTFLOAT-01, AlertFloat).
// 번호가 하나면 바로 그 번호가 채워진 상품 추가, 둘 이상이면 번호 판(UnlistedList)에서 고른다.
// 앱은 판정하지 않는다 — 서버가 준 보류 찜 자리(범위 자료 pending)를 그대로 센다. 닉네임·채팅 글은 그리지 않는다.
import { View } from 'react-native'
import type { ScopeData } from '../../lib/scope-data.ts'
import { Icon, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, pressedFill } from '../../ui/kit/tokens.ts'

export interface UnlistedNumber {
  readonly no: number
  /** 그 번호에서 기다리는 찜 수 */
  readonly count: number
}

export const UNLISTED_LABEL = '등록 안 된 번호의 찜'
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

/**
 * 등록 안 된 번호 판의 줄들 (D-ALERTFLOAT-01 — 옛 탭 바 밑 주황 상자를 바꿈): 떠 있는 빨간 알림 "등록 안 된 번호에 찜 n건"을 누르면 번호가 둘 이상일 때 이 판이 열린다.
 * 줄을 누르면 그 번호가 채워진 상품 추가. 가장 오래 기다린 번호부터. 닉네임·채팅 글은 그리지 않는다.
 */
export function UnlistedList({ numbers, onAdd }: { readonly numbers: readonly UnlistedNumber[]; readonly onAdd: (no: number) => void }) {
  const { p } = useKit()
  return (
    <View role="list" aria-label={UNLISTED_LABEL} testID="unlisted-list">
      {numbers.map((item) => (
        <Tap
          key={item.no}
          role="button"
          aria-label={unlistedPillLabel(item.no)}
          onPress={() => onAdd(item.no)}
          style={({ pressed }) => ({ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.xs, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? pressedFill(p, p.surface) : 'transparent' })}
        >
          <View style={{ flex: 1 }}>
            <Txt step="bodyLarge" weight="bold">{`${String(item.no)}번`}</Txt>
          </View>
          <Txt step="body" color="textSub">{`찜 ${String(item.count)}건`}</Txt>
          <View aria-hidden style={{ width: 16, alignItems: 'center' }}>
            <Icon name="chevron" color={p.textSub} size={16} />
          </View>
        </Tap>
      ))}
    </View>
  )
}
