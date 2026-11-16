// 화면의 정산서 (D-UX4-171, 사용자 지시 2026-11-16 "화면에 그냥 직사각형 표로 정산서를 그리는데, 그렇게 하지 말고 우리의 부드럽고 우아한 ui를 사용해서
// 보기 좋게 다시 그리자. 정산 내역서 구매자별, 내 가게 이름, 날짜 이건 지우고"):
// 옛: 사진과 같은 svg 직사각형 표(머리 "정산 내역서 · 구매자별"·가게 이름·날짜, 하늘색 띠) — D-RETRO-62·D-UX4-145.
// 이제 화면은 흰 둥근 카드 안의 줄(토스 거래 내역처럼: 왼쪽 이름·개수, 오른쪽 금액)로 그린다. 총계는 화면 아래 고정 판(StatementFooter, D-UX4-178)에 있다.
// 사진으로 저장할 때만 A4 그림(StatementPaper)을 쓴다 — 저장 전에 그 그림을 미리 보여 준다(StatementPhoto).
// - 구매자별 줄을 누르면 그 손님 정산서가 열린다(옛 표의 투명한 누름 자리와 같은 이름). 상품별 줄은 누르지 않는다.
// - 상품별 줄에는 그 상품을 산 구매자 이름을 모두 " · "로 잇는다 — 줄이지 않고 길면 다음 줄로 (D-UX4-179, 사용자 "상품별 목록에서 각 상품의 구매자가 안 적혀 있어").
// - 손님 닉네임은 글자(Txt)로만 그린다 — 꺾쇠·기호도 그대로 글자다.
// D-UX4-182 (사용자 지시 2026-11-16 "상품명, 개수, 구매자 닉네임이 한줄씩 있어서 공간을 너무 많이 차지해 … 구매자별 정산서에서도 닉네임을 금색 캡슐말고 버튼 모양으로 감싸고,
//   개수는 아래줄에 넣지 말고 금액 왼쪽에"):
// - 상품별 줄: 첫 줄 "상품명 · n개", 그 아래 산 구매자를 라이브 화면 찜 꼬리표처럼 금색 캡슐로 하나씩(넘치면 다음 줄로, 줄이지 않는다). 옛: 이름 · 개수 · 구매자 " · " 글이 세 줄.
// - D-UX4-186 (사용자 "정산서 상품별에서 닉네임도 개수 옆에 붙여서 한줄로 만들어. 글자크기도 번호, 품종, 개수, 닉네임, 가격 다 일정하게"):
//   상품별 줄은 번호 · 품종 · 개수 · 닉네임 캡슐 · 가격을 한 줄에, 모두 16. 옛(182): 닉네임 캡슐은 아랫줄, 번호 13·닉네임 12.
// - 구매자별 줄: 닉네임을 회색 둥근 네모(작은 단추 모양)로 감싸고, 개수는 금액 왼쪽에 한 줄로. 옛: 닉네임 글자 아래 줄에 개수.
import { View } from 'react-native'
import { salesMoney, type BuyerOrder, type StatementRow, type StatementTab } from '../../lib/broadcast-sales.ts'
import { TAG_GAP, TAG_PAD_X } from '../../lib/product-tags.ts'
import { Icon, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../../ui/kit/tokens.ts'
import { STATEMENT_EMPTY } from './StatementPhoto.tsx'

/** 여러 이름을 한 줄로 */
export const BUYER_JOIN = ' · '

/**
 * 상품 줄(판매 줄 key)마다 산 구매자 이름 — 구매자별 줄과 같은 이름(name), 한글 순, 같은 이름은 한 번 (순수 함수).
 * 구매자별 주문의 줄 key가 상품별 줄 key와 같다(broadcastSales가 같은 key로 묶는다)
 */
export function productBuyers(orders: readonly BuyerOrder[], name: (id: string) => string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const order of orders) {
    const label = name(order.id)
    for (const line of order.lines) {
      const list = out.get(line.key) ?? []
      if (!list.includes(label)) list.push(label)
      out.set(line.key, list)
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.localeCompare(b, 'ko'))
  return out
}

function Divider() {
  const { p } = useKit()
  return <View aria-hidden style={{ height: 1, backgroundColor: p.border, marginHorizontal: SPACE.xl }} />
}

/** 상품별 줄 글자 크기 (D-UX4-188): 품종·가격 16 · 번호·개수·닉네임 14 (라이브 화면 상품 줄 16, D-UX3-84) */
const STEP = 'bodyLarge'
const SUB = 'meta'
/** 번호 표·닉네임 캡슐 높이 — 같은 줄에서 키가 같게 */
const CHIP_HEIGHT = 24

function Money({ amount, step }: { readonly amount: number | null; readonly step?: typeof STEP }) {
  return amount === null
    ? <Txt step={step ?? 'body'} weight="medium" color="warnText" right>{salesMoney(null)}</Txt>
    : <Txt step="bodyLarge" weight="bold" right>{salesMoney(amount)}</Txt>
}

function Row({ row, tab, sent, buyers, label, onPress }: { readonly row: StatementRow; readonly tab: StatementTab; readonly sent: boolean; readonly buyers: readonly string[]; readonly label: string; readonly onPress?: (() => void) | undefined }) {
  const { p } = useKit()
  // 상품별 줄 (D-UX4-186): 번호 · 품종 · 개수 · 산 구매자(금색 캡슐) · 가격을 한 줄에. 한 줄에 다 안 들어가면 줄이지 않고 다음 줄로 넘긴다(가격은 늘 오른쪽).
  // 글자 크기 (D-UX4-188, 사용자 "텍스트 크기 맞추니까 가독성 별로다. 가독성 좋게 다시 맞춰" — 옛 186: 모두 16): 눈이 먼저 갈 품종·가격은 16 굵게,
  // 거드는 번호·개수·닉네임은 14로 한 단계 작게 — 라이브 화면 상품 줄처럼 품종과 가격이 먼저 읽힌다. 번호·캡슐은 같은 높이(24)로 품종 줄 가운데에 맞춘다.
  const body = tab === 'products' ? (
    // 닉네임은 아랫줄 (D-UX4-191, 사용자 "닉네임 길면 아래로 밀리는 경우가 있어서, 그냥 닉네임은 아래로 내리자" — 옛 186: 품종·개수 옆에 이어 붙임):
    // 첫 줄 번호 · 품종 · n개 · (오른쪽) 가격, 그 아래 산 구매자 금색 캡슐 — 늘 같은 자리라 들쭉날쭉하지 않다
    <View style={{ flex: 1, gap: SPACE.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        {row.no !== null ? (
          <View aria-hidden style={{ minWidth: 36, height: CHIP_HEIGHT, paddingHorizontal: SPACE.xs + 2, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: p.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Txt step={SUB} weight="medium" color="textSub">{`${row.no}번`}</Txt>
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Txt step={STEP} weight="bold">{row.label}<Txt step={SUB} color="textSub">{`${BUYER_JOIN}${row.qty}개`}</Txt></Txt>
        </View>
        <Money amount={row.money} step={STEP} />
      </View>
      {/* 산 구매자 — 라이브 화면 찜 꼬리표와 같은 금색 캡슐 */}
      {buyers.length > 0 ? (
        <View role="list" aria-label="산 구매자" testID="product-buyers" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: TAG_GAP }}>
          {buyers.map(name => (
            <View key={name} role="listitem" style={{ height: CHIP_HEIGHT, justifyContent: 'center', paddingHorizontal: TAG_PAD_X + 2, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.goldBg, maxWidth: '100%' }}>
              <Txt step={SUB} weight="bold" ink={p.goldText} numberOfLines={1}>{name}</Txt>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  ) : <>
    {/* 닉네임은 작은 단추 모양 둥근 네모 · 보냄 꼬리표 · 오른쪽에 개수와 금액 (D-UX4-182).
        바탕은 금색 (D-UX4-189, 사용자 "구매자별 정산서 목록에서 구매자 닉네임 배경 금색으로 해줘" — 옛: 회색 surfaceAlt) — 상품별 닉네임 캡슐과 같은 색 */}
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
      <View testID="buyer-name" style={{ flexShrink: 1, minHeight: 32, paddingHorizontal: SPACE.md, justifyContent: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: p.goldBg }}>
        <Txt step="body" weight="bold" ink={p.goldText} numberOfLines={1}>{row.label}</Txt>
      </View>
      {sent ? <View style={{ paddingHorizontal: SPACE.xs + 2, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.secondary }}><Txt step="note" weight="medium" color="onSecondary">보냄</Txt></View> : null}
    </View>
    <Txt step="body" color="textSub" testID="buyer-qty">{`${row.qty}개`}</Txt>
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

export function StatementList({ tab, rows, sent, buyers, onRow, rowLabel }: {
  readonly tab: StatementTab; readonly rows: readonly StatementRow[]
  /** 문자를 보낸 구매자 */
  readonly sent: readonly string[]
  /** 상품별: 줄 key마다 산 구매자 이름 (productBuyers) */
  readonly buyers?: ReadonlyMap<string, readonly string[]>
  /** 줄을 누름 (구매자별만) */
  readonly onRow?: (key: string) => void
  readonly rowLabel: (row: StatementRow) => string
}) {
  const { p } = useKit()
  return (
    <View role="list" aria-label={tab === 'products' ? '상품별 정산' : '구매자별 정산'} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', overflow: 'hidden', paddingVertical: SPACE.xs }}>
      {rows.length === 0 ? (
        <View style={{ paddingVertical: SPACE.xxl, paddingHorizontal: SPACE.xl }}><Txt color="textSub" center>{STATEMENT_EMPTY}</Txt></View>
      ) : rows.map((row, i) => (
        <View key={row.key} role="listitem">
          {i > 0 ? <Divider /> : null}
          <Row row={row} tab={tab} sent={tab === 'buyers' && sent.includes(row.key)} buyers={tab === 'products' ? buyers?.get(row.key) ?? [] : []} label={rowLabel(row)} onPress={onRow === undefined ? undefined : () => onRow(row.key)} />
        </View>
      ))}
    </View>
  )
}
