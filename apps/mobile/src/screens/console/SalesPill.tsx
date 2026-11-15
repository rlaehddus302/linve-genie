// 매출 캡슐 (D-UX4-140, 사용자 메모 11-13 "총매출을 맨 위에 한 줄 통째로 차지하게 하지 말고 맨 아래 + 버튼 왼쪽에 캡슐 형태 버튼으로"):
// 옛 탭 바 위 한 줄(알림 칸 오른쪽 "현재 매출 n원 ›")을 없애고, 상품 탭 화면 아래 (+) 단추 왼쪽에 떠 있는 흰 캡슐로 — 누르면 정산 내역서(옛 줄과 같은 곳).
// (+)가 없는 때(끝난 라이브의 라이브 기록)는 (+) 자리(오른쪽 끝)에 선다. 위아래 가운데는 (+) 단추(58)와 맞춘다. 아이폰·갤럭시 같은 그리기(그림자는 각자 방식).
import { Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, pressedFill } from '../../ui/kit/tokens.ts'
import { salesMoney } from '../../lib/broadcast-sales.ts'

/** (+) 단추 지름 (ProductAdd AddFab) */
const FAB_SIZE = 58
/** 캡슐 높이 */
export const SALES_PILL_HEIGHT = 44

/** 캡슐 글: 방송 중 "현재 매출", 끝나면 "총매출" (옛 줄과 같은 말) */
export const salesPillText = (closed: boolean, total: number | null): string => `${closed ? '총매출' : '현재 매출'} ${salesMoney(total)} ›`

export function SalesPill({ closed, total, bottom, besideFab, onPress }: {
  readonly closed: boolean
  readonly total: number | null
  /** (+) 단추의 아래 자리 — 캡슐을 그 단추와 위아래 가운데로 맞춘다 */
  readonly bottom: number
  /** (+) 단추가 오른쪽에 있다 — 그 왼쪽에 선다 */
  readonly besideFab: boolean
  readonly onPress: () => void
}) {
  const { p } = useKit()
  const text = salesPillText(closed, total)
  return (
    <Tap
      role="button"
      aria-label={text.replace(' ›', '')}
      testID="sales-pill"
      onPress={onPress}
      pressScale={0.96}
      style={({ pressed }) => ({
        position: 'absolute',
        right: SPACE.xl + (besideFab ? FAB_SIZE + SPACE.sm : 0),
        bottom: bottom + (FAB_SIZE - SALES_PILL_HEIGHT) / 2,
        maxWidth: '70%',
        minHeight: SALES_PILL_HEIGHT,
        paddingHorizontal: SPACE.lg,
        borderRadius: RADIUS.pill, borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: p.line,
        backgroundColor: pressed ? pressedFill(p, p.surface) : p.surface,
        shadowColor: '#000000',
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
      })}
    >
      <Txt step="body" weight="bold" numberOfLines={1}>{text}</Txt>
    </Tap>
  )
}
