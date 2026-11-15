// 화면의 정산서 (D-UX4-171, 사용자 지시 2026-11-16 "화면에 그냥 직사각형 표로 정산서를 그리는데, 그렇게 하지 말고 우리의 부드럽고 우아한 ui를 사용해서
// 보기 좋게 다시 그리자. 정산 내역서 구매자별, 내 가게 이름, 날짜 이건 지우고"):
// 옛: 사진과 같은 svg 직사각형 표(머리 "정산 내역서 · 구매자별"·가게 이름·날짜, 하늘색 띠) — D-RETRO-62·D-UX4-145.
// 이제 화면은 흰 둥근 카드 안의 줄(토스 거래 내역처럼: 왼쪽 이름·개수, 오른쪽 금액)과 맨 아래 총계 카드(금액 · 구매자 수 · 개수)로 그린다.
// 사진으로 저장할 때만 A4 그림(StatementPaper)을 쓴다 — 저장 전에 그 그림을 미리 보여 준다(StatementPhoto).
// - 구매자별 줄을 누르면 그 손님 정산서가 열린다(옛 표의 투명한 누름 자리와 같은 이름). 상품별 줄은 누르지 않는다.
// - 손님 닉네임은 글자(Txt)로만 그린다 — 꺾쇠·기호도 그대로 글자다.
import { View } from 'react-native'
import { salesMoney, type StatementRow, type StatementTab } from '../../lib/broadcast-sales.ts'
import { Icon, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../../ui/kit/tokens.ts'
import { STATEMENT_EMPTY } from './StatementPhoto.tsx'

export const TOTAL_WORD = '총계'
/** 총계 카드의 구매자 수·개수 한 줄 */
export const totalLine = (buyers: number, qty: number): string => `구매자 ${buyers}명 · ${qty}개`

function Divider() {
  const { p } = useKit()
  return <View aria-hidden style={{ height: 1, backgroundColor: p.border, marginHorizontal: SPACE.xl }} />
}

function Money({ amount, strong }: { readonly amount: number | null; readonly strong?: boolean }) {
  return amount === null
    ? <Txt step="body" weight="medium" color="warnText" right>{salesMoney(null)}</Txt>
    : <Txt step={strong === true ? 'title' : 'bodyLarge'} weight="bold" right>{salesMoney(amount)}</Txt>
}

function Row({ row, tab, sent, label, onPress }: { readonly row: StatementRow; readonly tab: StatementTab; readonly sent: boolean; readonly label: string; readonly onPress?: (() => void) | undefined }) {
  const { p } = useKit()
  const body = <>
    {tab === 'products' && row.no !== null ? (
      <View aria-hidden style={{ minWidth: 40, height: 28, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: p.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Txt step="caption" weight="medium" color="textSub">{`${row.no}번`}</Txt>
      </View>
    ) : null}
    <View style={{ flex: 1, gap: 2 }}>
      <Txt step="bodyLarge" weight="medium" numberOfLines={2}>{row.label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs }}>
        <Txt step="caption" color="textSub">{`${row.qty}개`}</Txt>
        {sent ? <View style={{ paddingHorizontal: SPACE.xs + 2, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.secondary }}><Txt step="note" weight="medium" color="onSecondary">보냄</Txt></View> : null}
      </View>
    </View>
    <Money amount={row.money} />
  </>
  const frame = { minHeight: TOUCH.min + SPACE.md, paddingVertical: SPACE.md, paddingHorizontal: SPACE.xl, flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE.md }
  if (onPress === undefined) return <View aria-label={label} style={frame}>{body}</View>
  return (
    <Tap role="button" aria-label={label} onPress={onPress} pressScale={1} style={({ pressed }) => ({ ...frame, paddingRight: SPACE.lg, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      {body}
      <Icon name="chevron" color={p.textSub} size={18} />
    </Tap>
  )
}

export function StatementList({ tab, rows, total, qty, buyers, sent, onRow, rowLabel }: {
  readonly tab: StatementTab; readonly rows: readonly StatementRow[]
  readonly total: number | null; readonly qty: number; readonly buyers: number
  /** 문자를 보낸 구매자 */
  readonly sent: readonly string[]
  /** 줄을 누름 (구매자별만) */
  readonly onRow?: (key: string) => void
  readonly rowLabel: (row: StatementRow) => string
}) {
  const { p } = useKit()
  const card = { backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous' as const, overflow: 'hidden' as const }
  return (
    <View style={{ gap: SPACE.md }}>
      <View role="list" aria-label={tab === 'products' ? '상품별 정산' : '구매자별 정산'} style={{ ...card, paddingVertical: SPACE.xs }}>
        {rows.length === 0 ? (
          <View style={{ paddingVertical: SPACE.xxl, paddingHorizontal: SPACE.xl }}><Txt color="textSub" center>{STATEMENT_EMPTY}</Txt></View>
        ) : rows.map((row, i) => (
          <View key={row.key} role="listitem">
            {i > 0 ? <Divider /> : null}
            <Row row={row} tab={tab} sent={tab === 'buyers' && sent.includes(row.key)} label={rowLabel(row)} onPress={onRow === undefined ? undefined : () => onRow(row.key)} />
          </View>
        ))}
      </View>
      {/* 총계 — 금액 · 구매자 수 · 개수 (D-UX4-170: 옛 맨 위 작은 글 "판매 수량 n개 · 구매자 n명"을 여기로) */}
      <View role="group" aria-label={`${TOTAL_WORD} ${salesMoney(total)} · ${totalLine(buyers, qty)}`} testID="statement-total" style={{ ...card, paddingVertical: SPACE.lg, paddingHorizontal: SPACE.xl, gap: SPACE.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md }}>
          <Txt step="bodyLarge" weight="bold">{TOTAL_WORD}</Txt>
          <View style={{ flexShrink: 1 }}><Money amount={total} strong /></View>
        </View>
        <Txt step="body" color="textSub">{totalLine(buyers, qty)}</Txt>
      </View>
    </View>
  )
}
