// 손님별 합계 (D-BUYERSUM-01, 사용자 지시 2026-11-17 "중간에 얼마나 찜 했냐고 묻는 고객들이 있음. 라방 도중에 고객별 합산 금액도 볼 수 있게 해줘"):
// 라이브 화면 [찜 기록] 탭 오른쪽 아래 흰 캡슐 "손님별 합계 ›"(상품 탭의 매출 캡슐과 같은 꼴·자리)을 누르면 쌓인 화면으로 넘어간다.
// - 손님마다 한 줄: 닉네임(문자 손님은 "문자-0937", 찜 기록과 같은 이름) · 찜(1등) 개수 · 합계 금액. 줄을 누르면 그 손님이 찜한 상품이 줄 아래에 펼쳐진다
//   (번호 · 품종 · 금액). 다시 누르면 접힌다. 정산서 화면으로 넘어가지 않는다 — 라이브 중에 정산서 [보내기]를 잘못 누르지 않게.
// - 금액·개수는 정산 내역서(broadcastSales)와 같은 셈이다: 그 라이브에서 찜(1등)이 된 상품만, 합친 손님은 한 줄, 배송비는 빼고. 대기·보류·취소는 넣지 않는다.
// - 찾기 칸 하나(찜 기록 찾기와 같다 — 닉네임 일부 또는 번호), 정렬은 최근순(가장 최근에 찜이 된 손님이 맨 위) · 이름순(한글 먼저, 찜 기록과 같은 견주기).
//   정렬 단추·고르는 판은 찜 기록 도구 줄(ClaimFeedToolbar)을 그대로 쓴다.
// - 판정하지 않는다. 닉네임은 글자로만 그린다. 아이폰·갤럭시 같은 그리기 — 찾기 칸 키보드는 목록을 끌면 내린다.
import { useMemo, useState } from 'react'
import { Keyboard, ScrollView, View } from 'react-native'
import { broadcastSales, salesMoney, type SaleLine } from '../../lib/broadcast-sales.ts'
import type { BuyerSort } from '../../lib/feed-view.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { EmptyFill, StackPage, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, RADIUS, SPACE, pressedFill } from '../../ui/kit/tokens.ts'
import { Loading } from '../../ui/parts.tsx'
import { ClaimFeedToolbar } from './ClaimFeed.tsx'
import { FLOAT_PILL_HEIGHT, pillBottom } from './float-layout.ts'
import { useConsoleApi, type ConsoleApi } from './context.ts'
import { claimAt, compareNames, feedBuyerName, searchText } from './feed-rows.ts'
import { SlidePage } from './parts.tsx'
import { ScopeConsole } from './scope.tsx'

export const TOTALS_TITLE = '손님별 합계'
export const TOTALS_PILL = `${TOTALS_TITLE} ›`
export const TOTALS_EMPTY = '아직 찜이 된 손님이 없어요'
export const TOTALS_EMPTY_BODY = '찜(1등)이 되면 손님마다 금액을 더해 보여드릴게요'
export const TOTALS_NO_MATCH = '찾는 손님이 없어요'
export const TOTALS_NOTE = '찜(1등)이 된 상품만 더했어요. 배송비는 빠져 있어요.'

/** 손님 한 줄 */
export interface BuyerTotal {
  /** 지금의 손님 ID (합친 손님은 합친 쪽) */
  readonly id: string
  /** 보이는 이름 (찜 기록과 같다 — 문자 손님은 "문자-0937") */
  readonly name: string
  /** 찜(1등) 개수 — 정산서 개수와 같은 셈(묶음 상품은 낱개로) */
  readonly qty: number
  /** 합계 (금액을 모르는 찜이 있으면 null — "금액 확인 필요") */
  readonly subtotal: number | null
  /** 이 손님의 찜(1등) 중 가장 최근에 받은 시각 (최근순) */
  readonly latest: number
  /** 찜한 상품 줄 (번호순) */
  readonly lines: readonly SaleLine[]
}

/** 손님별 합계 줄 (화면 없이 값만): 정산 내역서와 같은 셈, 정렬은 최근순(최근이 위) 또는 이름순 */
export function buyerTotals(data: ScopeData, names: ConsoleApi['names'], broadcast: string, sort: BuyerSort): BuyerTotal[] {
  const latest = new Map<string, number>()
  for (const claim of data.claims.values()) {
    if (claim.broadcast !== broadcast || claim.status !== 'CONFIRMED') continue
    const at = claimAt(claim)
    const before = latest.get(claim.currentBuyer)
    if (Number.isFinite(at) && (before === undefined || at > before)) latest.set(claim.currentBuyer, at)
  }
  const rows = broadcastSales(data.claims, data.products, broadcast).orders.map((order): BuyerTotal => ({
    id: order.id,
    name: feedBuyerName(data, names, order.id),
    qty: order.qty,
    subtotal: order.subtotal,
    latest: latest.get(order.id) ?? 0,
    lines: order.lines,
  }))
  if (sort === 'name') return rows.sort((a, b) => compareNames(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return rows.sort((a, b) => b.latest - a.latest || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 찾는 글에 맞는 손님 줄 (찜 기록 찾기와 같다: 닉네임 일부, 숫자만 쳤으면 그 번호를 찜한 손님) */
export function filterTotals(rows: readonly BuyerTotal[], query: string): BuyerTotal[] {
  const wanted = searchText(query)
  if (wanted === '') return [...rows]
  const no = /^\d{1,9}$/.test(wanted) ? Number(wanted) : null
  return rows.filter((row) => searchText(row.name).includes(wanted) || (no !== null && row.lines.some((line) => line.no === no)))
}

/** 위 한 줄: "손님 3명 · 합계 45,000원" */
export function totalsSummary(rows: readonly BuyerTotal[]): string {
  const sum = rows.reduce<number | null>((total, row) => (total === null || row.subtotal === null ? null : total + row.subtotal), 0)
  return `손님 ${String(rows.length)}명 · 합계 ${salesMoney(sum)}`
}

/** 펼친 상품 한 줄의 글: "26번 핑크프릴" · 옵션 · 2개 이상이면 "3개" */
export function totalLineText(line: Pick<SaleLine, 'no' | 'name' | 'variant' | 'qty'>): string {
  return [`${String(line.no)}번`, line.name, line.variant ?? '', line.qty > 1 ? `${String(line.qty)}개` : ''].filter((part) => part !== '').join(' ')
}

/** 손님별 합계 쌓인 화면 (경로 /console/<방송>/totals) */
export function BuyerTotalsScreen({ broadcastId, onBack }: { readonly broadcastId: string; readonly onBack: () => void }) {
  return (
    <ScopeConsole broadcastId={broadcastId} waiting={<StackPage name={TOTALS_TITLE} title={TOTALS_TITLE} onBack={onBack} scroll={false}><Loading /></StackPage>}>
      {() => (
        <StackPage name={TOTALS_TITLE} title={TOTALS_TITLE} onBack={onBack} gray scroll={false} testID="buyer-totals-page">
          <TotalsBody />
        </StackPage>
      )}
    </ScopeConsole>
  )
}

/** 경로가 없을 때(시험·웹) 라이브 화면 안에 겹쳐 그리는 손님별 합계 */
export function BuyerTotalsPage({ visible, onClose }: { readonly visible: boolean; readonly onClose: () => void }) {
  return (
    <SlidePage visible={visible} onClose={onClose} title={TOTALS_TITLE} name={TOTALS_TITLE} gray scroll={false} testID="buyer-totals-page">
      {visible ? <TotalsBody /> : null}
    </SlidePage>
  )
}

/** 찾기 칸 · 정렬 · 요약 · 손님 줄 */
function TotalsBody() {
  const { p } = useKit()
  const api = useConsoleApi()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<BuyerSort>('recent')
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => buyerTotals(api.data, api.names, api.b, sort), [api.data, api.names, api.b, sort])
  const shown = useMemo(() => filterTotals(rows, query), [rows, query])
  return (
    <View style={{ flex: 1 }}>
      {rows.length === 0 ? null : (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: SPACE.xs, paddingBottom: SPACE.sm }}>
          <ClaimFeedToolbar query={query} onQuery={setQuery} sort={sort} onSort={setSort} searchFill={p.surface} />
        </View>
      )}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: GUTTER, paddingBottom: SPACE.xxl, gap: SPACE.sm }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={() => Keyboard.dismiss()}>
        {rows.length === 0 ? <EmptyFill title={TOTALS_EMPTY} body={TOTALS_EMPTY_BODY} /> : shown.length === 0 ? <EmptyFill title={TOTALS_NO_MATCH} /> : (
          <>
            <View style={{ gap: SPACE.xs, paddingHorizontal: SPACE.xs, paddingBottom: SPACE.xs }}>
              <Txt step="body" weight="bold" testID="totals-summary">{totalsSummary(shown)}</Txt>
              <Txt step="caption" color="textSub">{TOTALS_NOTE}</Txt>
            </View>
            <View role="list" aria-label={TOTALS_TITLE} style={{ gap: SPACE.sm }}>
              {shown.map((row) => <TotalRow key={row.id} row={row} open={open === row.id} onPress={() => setOpen((now) => (now === row.id ? null : row.id))} />)}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}

/** 손님 한 줄 — 흰 둥근 카드: 왼쪽 닉네임과 그 아래 "찜 3개", 오른쪽 합계. 누르면 아래에 상품 줄이 펼쳐진다 */
function TotalRow({ row, open, onPress }: { readonly row: BuyerTotal; readonly open: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  const money = salesMoney(row.subtotal)
  return (
    <View role="listitem" style={{ borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: p.surface, overflow: 'hidden' }}>
      <Tap
        role="button"
        aria-label={`${row.name} 찜 ${String(row.qty)}개 ${money}`}
        aria-expanded={open}
        onPress={onPress}
        pressScale={0.98}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 64, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md, backgroundColor: pressed ? pressedFill(p, p.surface) : p.surface })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Txt step="bodyLarge" weight="bold" numberOfLines={1}>{row.name}</Txt>
          <Txt step="caption" color="textSub">{`찜 ${String(row.qty)}개`}</Txt>
        </View>
        <Txt step="bodyLarge" weight="bold">{money}</Txt>
      </Tap>
      {open ? (
        <View testID="totals-lines" style={{ gap: SPACE.sm, paddingHorizontal: SPACE.lg, paddingTop: SPACE.xs, paddingBottom: SPACE.md, borderTopWidth: 1, borderTopColor: p.line }}>
          {row.lines.map((line) => (
            <View key={line.key} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingTop: SPACE.xs }}>
              <View style={{ flex: 1 }}><Txt step="body">{totalLineText(line)}</Txt></View>
              <Txt step="body" weight="medium">{salesMoney(line.amount)}</Txt>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}


/** [찜 기록] 탭 오른쪽 아래 "손님별 합계 ›" — 상품 탭 매출 캡슐과 같은 꼴, (+) 단추 자리 높이 */
export function TotalsPill({ bottom, onPress }: { readonly bottom: number; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap
      role="button"
      aria-label={TOTALS_TITLE}
      testID="totals-pill"
      onPress={onPress}
      pressScale={0.96}
      style={({ pressed }) => ({
        position: 'absolute',
        right: SPACE.xl,
        bottom: pillBottom(bottom),
        minHeight: FLOAT_PILL_HEIGHT, // 떠 있는 캡슐 모두 같은 크기 (D-FLOATLEFT-01)
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
      <Txt step="bodyLarge" weight="bold" numberOfLines={1}>{TOTALS_PILL}</Txt>
    </Tap>
  )
}
