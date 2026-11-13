// 방송 화면의 찜 기록 (D-LIVETEST-07 → D-UX3-79): 구매자별로 번호를 묶는다 — 한 줄에 왼쪽 손님 이름(문자 손님은 "문자-끝 4자리"),
// 그 옆에 찜한 번호를 하나씩 둥근 네모 꼬리표로 늘어놓고 자리가 없으면 아랫줄로 내려간다. 시각·채팅 원문은 그리지 않는다.
// 손님 줄마다 따로 둥근 바탕(D-UX3-83). 꼬리표는 상품 줄과 같은 색·낱말(D-UX3-83): 찜(1등) 금색 "123 찜", 대기 회색 "123 대기 1",
// 보류(아직 없는 번호) 주황 "123 보류", 겹침 빨강, 취소·안 됨 회색에 그 낱말.
// 줄 순서는 라이브 채팅처럼 가장 최근에 찜한 손님이 맨 아래(D-UX3-75), 한 손님 안의 번호는 찜한 순서.
// 판정은 하지 않는다. 상태·대기 순서·1등은 서버 값(범위 자료) 그대로 낱말로만 바꾼다. 닉네임은 글자로만 그린다.
// D-UX4-27 (사용자 지시 2026-11-09 "찜기록 화면 각 목록이 텍스트 크기가 너무 작아. 찜 기록 알약 버튼만큼 크기 키워서 누르기 쉽게"):
// 이름·번호 꼬리표를 위 탭 알약과 같은 크기(높이 36·본문 큰 글자)로. 살아 있는 찜 꼬리표를 누르면 아래에서 "140번 찜" 메뉴(찜 삭제·상품 보기)가 올라오고,
// 찜 삭제는 "140번 찜을 삭제할까요?" 팝업 [닫기 | 삭제] 뒤 방송자 취소 — 1등이었으면 대기 1이 찜이 된다(claim-actions).
// D-RETRO-50~53 (복기 F6, 사용자 지시 2026-11-12 "번호별로 누가 찜했는지도 … 오름차순으로 … 글자 크기를 줄여 한 화면에 더 많이 … 누르면 내가 원하는 대로 수정"):
// - 목록 위 한 줄 고르기: [손님별 | 번호별] · 정렬(손님별 [최근순 | 이름순], 번호별 [번호순 | 최근순]) · 글자 [크게 | 작게]. 이 휴대폰에 기억한다(lib/feed-view). 기본은 지금까지의 모습.
// - 번호별: 한 줄에 번호·품종·가격, 그 아래 손님 꼬리표 — 찜(금색, 굵게) → 겹침 → 보류 → 대기(회색, 순번) → 취소·안 됨. 꼬리표가 많으면 "+n명"으로 접는다.
// - 작게: 글자 13~14·꼬리표 높이 30. 누르는 높이는 큰 글자 꼬리표와 같은 40(꼬리표 30 + 위아래 5)이고 폭은 48 이상 — 줄 사이를 그만큼 띄워 겹치지 않는다.
// - 꼬리표를 누르면 그 찜의 메뉴(ClaimMenu): 찜으로 올리기 · 찜 되돌리기 · 상품 보기 · 상품 고치기 · 찜 삭제. 취소·안 된 찜도 누를 수 있다(되돌리기·상품 보기).
import { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { Claim } from '@livejjim/web/src/api/types.ts'
import { BUYER_SORT_WORD, FEED_MODE_WORD, FEED_SIZE_WORD, FEED_VIEW_DEFAULT, NUMBER_SORT_WORD, setFeedView, useFeedView, type FeedSize, type FeedView } from '../../lib/feed-view.ts'
import { formatWon } from '../../lib/words.ts'
import { EmptyFill, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, RADIUS, SPACE, TOUCH, pressedFill } from '../../ui/kit/tokens.ts'
import { Hint, Notice } from '../../ui/parts.tsx'
import { ACTIVE_CLAIM } from './claim-actions.ts'
import { ClaimMenu, type PickedClaim } from './ClaimMenu.tsx'
import { useConsoleApi } from './context.ts'
import { chipLabel, feedRows, noLabel, numberRows, shownChips, tagColors, type FeedBuyer, type FeedChip, type FeedNo, type FeedNumber, type FeedTone } from './feed-rows.ts'
import { NamePill, type PillTone } from './parts.tsx'

export { feedBuyerName, feedRows, noLabel, numberRows, tagColors, type FeedBuyer, type FeedChip, type FeedNo, type FeedNumber, type FeedTone } from './feed-rows.ts'

export const FEED_EMPTY = '아직 찜이 없어요'
export const FEED_EMPTY_BODY = '채팅이나 문자로 찜이 오면\n바로 보여드릴게요'
/** 한 번에 그리는 손님 줄 수 (최근순 — 최신 손님부터). 이름순·번호별은 찾는 보기라 모두 그린다 */
export const FEED_LIMIT = 60
/** 아직 상품이 없는 번호의 줄 (번호별) */
export const NUMBER_NO_PRODUCT = '아직 상품이 없어요'

const PILL_TONE: Readonly<Record<FeedTone, PillTone>> = { win: 'win', wait: 'wait', pending: 'pending', conflict: 'conflict', other: 'wait' }

/**
 * 작은 글자 치수 (D-RETRO-52): 꼬리표 높이 30·글자 13. 누르는 높이 = 30 + 위아래 5 = 40 — 큰 글자 꼬리표(36 + 위아래 2)와 같다.
 * 누르는 자리가 부모 밖으로 나가면 눌리지 않으므로 꼬리표 묶음이 위아래 5를 안쪽 여백으로 갖고, 꼬리표 줄 사이는 10(= 5 + 5)을 띄운다.
 */
export const SMALL_PILL = { height: 30, padX: 10, slopY: 5, slopX: 3, radius: 8 } as const
/** 큰 글자 꼬리표 (NamePill과 같은 치수 — D-UX4-26) */
const LARGE_PILL = { height: 36, padX: SPACE.md + 2, slopY: 2, slopX: 2, radius: 10 } as const

/** 꼬리표 묶음의 간격: 크게는 지금까지와 같이 8, 작게는 가로 6·세로 10 */
const wrapStyle = (size: FeedSize) => (size === 'small'
  ? { flexDirection: 'row' as const, flexWrap: 'wrap' as const, columnGap: SPACE.sm - 2, rowGap: SMALL_PILL.slopY * 2, paddingVertical: SMALL_PILL.slopY }
  : { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACE.sm })

/** 꼬리표 (둥근 네모): 크게 = 위 탭 알약 크기, 작게 = SMALL_PILL. 긴 닉네임은 한 줄에서 줄인다 */
function FeedPill({ text, tone, size, ariaLabel, onPress }: { readonly text: string; readonly tone: FeedTone; readonly size: FeedSize; readonly ariaLabel: string; readonly onPress?: () => void }) {
  const { p, tones } = useKit()
  const pair = tagColors(p, tones.danger, tone)
  const dim = size === 'small' ? SMALL_PILL : LARGE_PILL
  const shape = { minHeight: dim.height, maxWidth: '100%' as const, paddingHorizontal: dim.padX, borderRadius: dim.radius, borderCurve: 'continuous' as const, alignItems: 'center' as const, justifyContent: 'center' as const }
  const label = (
    <Txt step={size === 'small' ? 'caption' : 'bodyLarge'} weight={tone === 'wait' || tone === 'other' ? 'medium' : 'bold'} ink={pair.fg} numberOfLines={1}>
      {text}
    </Txt>
  )
  if (onPress === undefined) return <View aria-label={ariaLabel} style={{ ...shape, backgroundColor: pair.bg }}>{label}</View>
  return (
    <Tap role="button" aria-label={ariaLabel} onPress={onPress} hitSlop={{ top: dim.slopY, bottom: dim.slopY, left: dim.slopX, right: dim.slopX }} pressScale={0.96} style={({ pressed }) => ({ ...shape, minWidth: TOUCH.min, backgroundColor: pressed ? pressedFill(p, pair.bg) : pair.bg })}>
      {label}
    </Tap>
  )
}

/** 누를 수 있는 찜: 살아 있는 찜, 또는 끝난 찜이어도 그 상품이 목록에 있을 때(되돌리기·상품 보기) */
const pickable = (item: Pick<FeedNo, 'status' | 'hasProduct'>): boolean => ACTIVE_CLAIM.has(item.status) || item.hasProduct

/** 번호 꼬리표 — 둥근 네모(사용자 지시 "배경은 라운드직사각"), 위 탭 알약과 같은 크기(작게는 SMALL_PILL) */
function NoTag({ item, size, onPick }: { readonly item: FeedNo; readonly size: FeedSize; readonly onPick?: (item: FeedNo) => void }) {
  const can = onPick !== undefined && pickable(item)
  const text = `${String(item.no)} ${item.word}`
  if (size === 'small') return <FeedPill text={text} tone={item.tone} size="small" ariaLabel={noLabel(item)} {...(can ? { onPress: () => onPick(item) } : {})} />
  return <NamePill square text={text} tone={PILL_TONE[item.tone]} ariaLabel={noLabel(item)} {...(can ? { onPress: () => onPick(item) } : {})} />
}

export function FeedLine({ row, onPick, size = 'large' }: { readonly row: FeedBuyer; readonly onPick?: (row: FeedBuyer, item: FeedNo) => void; readonly size?: FeedSize }) {
  const { p } = useKit()
  const small = size === 'small'
  return (
    <View role="listitem" aria-label={`${row.buyer} ${row.nos.map(noLabel).join(', ')}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: small ? SPACE.sm : SPACE.md, paddingVertical: small ? 0 : SPACE.sm, paddingHorizontal: small ? SPACE.sm + 2 : SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: p.surface }}>
      <View style={{ flexShrink: 1, maxWidth: '38%', minHeight: small ? SMALL_PILL.height + SMALL_PILL.slopY * 2 : 36, justifyContent: 'center' }}>
        <Txt step={small ? 'meta' : 'bodyLarge'} weight="bold" numberOfLines={1}>{row.buyer}</Txt>
      </View>
      <View style={{ flex: 1, ...wrapStyle(size) }}>
        {row.nos.map((item) => <NoTag key={item.id} item={item} size={size} {...(onPick === undefined ? {} : { onPick: (picked: FeedNo) => onPick(row, picked) })} />)}
      </View>
    </View>
  )
}

/** 번호 줄 머리의 읽기 낱말: "15번 핑크프릴 10,000원" · 상품이 없으면 "88번 아직 상품이 없어요" */
export function numberHead(row: Pick<FeedNumber, 'no' | 'name' | 'price'>): string {
  const no = `${String(row.no)}번`
  if (row.price === null) return `${no} ${NUMBER_NO_PRODUCT}`
  return [no, row.name, formatWon(row.price)].filter((part) => part !== '').join(' ')
}

/**
 * 번호 줄 (D-RETRO-50): 첫째 줄 번호·품종·가격, 그 아래 손님 꼬리표 — "홍길동 찜"(금색, 굵게) · "김영희 대기 1"(회색) · 그 밖은 그 낱말.
 * 꼬리표가 한도를 넘으면 "+n명"으로 접고, 누르면 펼친다(다시 접기는 "접기").
 */
export function NumberLine({ row, onPick, size = 'large' }: { readonly row: FeedNumber; readonly onPick?: (row: FeedNumber, chip: FeedChip) => void; readonly size?: FeedSize }) {
  const { p } = useKit()
  const [expanded, setExpanded] = useState(false)
  const small = size === 'small'
  const step = small ? 'meta' : 'bodyLarge'
  const { shown, more } = shownChips(row, expanded)
  const dim = small ? SMALL_PILL : LARGE_PILL
  const foldStyle = ({ pressed }: { readonly pressed: boolean }) => ({ minHeight: dim.height, minWidth: TOUCH.min, paddingHorizontal: dim.padX, borderRadius: dim.radius, borderCurve: 'continuous' as const, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: p.outline, backgroundColor: pressed ? p.pressed : p.surface })
  const foldSlop = { top: dim.slopY, bottom: dim.slopY, left: dim.slopX, right: dim.slopX }
  return (
    <View role="listitem" aria-label={`${numberHead(row)} — ${row.chips.map(chipLabel).join(', ')}`} style={{ gap: small ? 0 : SPACE.xs + 2, paddingTop: small ? SPACE.xs + 2 : SPACE.sm + 2, paddingBottom: small ? 0 : SPACE.sm, paddingHorizontal: small ? SPACE.sm + 2 : SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: p.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <Txt step={step} weight="heavy" numberOfLines={1}>{`${String(row.no)}번`}</Txt>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt step={step} weight="bold" numberOfLines={1} {...(row.price === null ? { ink: p.warnText } : {})}>{row.price === null ? NUMBER_NO_PRODUCT : row.name}</Txt>
        </View>
        {row.price === null ? null : <Txt step={step} weight="bold" right numberOfLines={1}>{formatWon(row.price)}</Txt>}
      </View>
      <View style={wrapStyle(size)}>
        {shown.map((chip) => {
          const can = onPick !== undefined && pickable(chip)
          return <FeedPill key={chip.id} text={chipLabel(chip)} tone={chip.tone} size={size} ariaLabel={chipLabel(chip)} {...(can ? { onPress: () => onPick(row, chip) } : {})} />
        })}
        {more > 0 ? (
          <Tap role="button" aria-label={`${String(row.no)}번 손님 ${String(more)}명 더 보기`} aria-expanded={false} onPress={() => setExpanded(true)} hitSlop={foldSlop} pressScale={0.96} style={foldStyle}>
            <Txt step={small ? 'caption' : 'bodyLarge'} weight="medium" color="textSub" numberOfLines={1}>{`+${String(more)}명`}</Txt>
          </Tap>
        ) : expanded && shownChips(row, false).more > 0 ? (
          <Tap role="button" aria-label={`${String(row.no)}번 손님 접기`} aria-expanded onPress={() => setExpanded(false)} hitSlop={foldSlop} pressScale={0.96} style={foldStyle}>
            <Txt step={small ? 'caption' : 'bodyLarge'} weight="medium" color="textSub" numberOfLines={1}>접기</Txt>
          </Tap>
        ) : null}
      </View>
    </View>
  )
}

/** 고르기 한 묶음 (둘 중 하나): 회색 둥근 바탕 안에 흰 칸이 고른 것. 높이 40(누르는 칸 36 + 테두리 2) */
function Choice<T extends string>({ name, value, options, onPick }: { readonly name: string; readonly value: T; readonly options: readonly { readonly value: T; readonly label: string; readonly ariaLabel: string }[]; readonly onPick: (value: T) => void }) {
  const { p } = useKit()
  return (
    <View role="group" aria-label={name} style={{ flexDirection: 'row', padding: 2, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: p.soft }}>
      {options.map((option) => {
        const on = option.value === value
        return (
          <Tap key={option.value} role="button" aria-label={option.ariaLabel} aria-selected={on} onPress={() => onPick(option.value)} hitSlop={{ top: 4, bottom: 4 }} style={({ pressed }) => ({ minHeight: 36, minWidth: TOUCH.min, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.sm - 2, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: on ? p.surface : pressed ? p.softPressed : 'transparent' })}>
            <Txt step="caption" weight={on ? 'bold' : 'medium'} color={on ? 'text' : 'textSub'} numberOfLines={1}>{option.label}</Txt>
          </Tap>
        )
      })}
    </View>
  )
}

/**
 * 찜 기록 위 고르기 줄 (D-RETRO-50~52): [손님별 | 번호별] · 정렬 · 글자 [크게 | 작게]. 한 줄에만 놓고(D-UX4-01) 좁은 화면·큰 글자에서는 옆으로 민다.
 */
export function FeedControls({ view }: { readonly view: FeedView }) {
  const sort = view.mode === 'buyer'
    ? <Choice name="정렬" value={view.buyerSort} onPick={(buyerSort) => setFeedView({ buyerSort })} options={[{ value: 'recent', label: BUYER_SORT_WORD.recent, ariaLabel: `${BUYER_SORT_WORD.recent} 정렬` }, { value: 'name', label: BUYER_SORT_WORD.name, ariaLabel: `${BUYER_SORT_WORD.name} 정렬` }]} />
    : <Choice name="정렬" value={view.numberSort} onPick={(numberSort) => setFeedView({ numberSort })} options={[{ value: 'number', label: NUMBER_SORT_WORD.number, ariaLabel: `${NUMBER_SORT_WORD.number} 정렬` }, { value: 'recent', label: NUMBER_SORT_WORD.recent, ariaLabel: `${NUMBER_SORT_WORD.recent} 정렬` }]} />
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginHorizontal: -GUTTER, flexGrow: 0 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: GUTTER, paddingVertical: SPACE.xs }}>
      <Choice name="찜 기록 보기" value={view.mode} onPick={(mode) => setFeedView({ mode })} options={[{ value: 'buyer', label: FEED_MODE_WORD.buyer, ariaLabel: `${FEED_MODE_WORD.buyer} 보기` }, { value: 'number', label: FEED_MODE_WORD.number, ariaLabel: `${FEED_MODE_WORD.number} 보기` }]} />
      {sort}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2 }}>
        <Txt step="caption" weight="medium" color="textSub">글자</Txt>
        <Choice name="글자 크기" value={view.size} onPick={(size) => setFeedView({ size })} options={[{ value: 'large', label: FEED_SIZE_WORD.large, ariaLabel: `글자 ${FEED_SIZE_WORD.large}` }, { value: 'small', label: FEED_SIZE_WORD.small, ariaLabel: `글자 ${FEED_SIZE_WORD.small}` }]} />
      </View>
    </ScrollView>
  )
}

/**
 * 찜 기록 (only: 그 상태의 찜만 — 보류 찜 보기, 판 안이라 누르지 않고 고르기 줄도 없이 손님별·최근순·큰 글자로).
 * onOpenProduct: 찜 메뉴의 "상품 보기" — 그 상품 자세히를 연다. onEditProduct: "상품 고치기" — 그 상품을 고치는 창을 연다
 */
export function ClaimFeed({ only, onOpenProduct, onEditProduct }: { readonly only?: Claim['status']; readonly onOpenProduct?: (key: string) => void; readonly onEditProduct?: (key: string) => void }) {
  const api = useConsoleApi()
  const saved = useFeedView()
  const view = only === undefined ? saved : FEED_VIEW_DEFAULT
  const buyers = useMemo(() => (view.mode === 'buyer' ? feedRows(api.data, api.names, api.b, only, view.buyerSort) : []), [api.data, api.names, api.b, only, view.mode, view.buyerSort])
  const numbers = useMemo(() => (view.mode === 'number' ? numberRows(api.data, api.names, api.b, view.numberSort) : []), [api.data, api.names, api.b, view.mode, view.numberSort])
  const [picked, setPicked] = useState<PickedClaim | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closed = api.ended || api.sealed
  const count = view.mode === 'buyer' ? buyers.length : numbers.length
  if (count === 0) return only === 'PENDING' ? <EmptyFill title="보류 찜이 없어요" body={'번호에 맞는 상품이 없는 찜이\n여기에 모여요'} /> : <EmptyFill title={FEED_EMPTY} body={FEED_EMPTY_BODY} />
  // 최근순 손님별만 최근 FEED_LIMIT명 (라이브 채팅처럼 가장 최근 손님이 맨 아래, D-UX3-75) — 이름순·번호별은 찾는 보기라 모두 그린다
  const limited = view.mode === 'buyer' && view.buyerSort === 'recent' && buyers.length > FEED_LIMIT
  const shown = limited ? buyers.slice(-FEED_LIMIT) : buyers
  const canPick = only === undefined && !closed
  return (
    <View style={{ gap: SPACE.sm }}>
      {only === undefined ? <FeedControls view={view} /> : null}
      {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
      {limited ? <Hint>{`그 밖 ${String(buyers.length - FEED_LIMIT)}명은 구매자 화면에서 볼 수 있어요.`}</Hint> : null}
      {view.mode === 'buyer' ? (
        <View role="list" aria-label="찜 기록" style={{ gap: view.size === 'small' ? SPACE.xs : SPACE.sm }}>
          {shown.map((row) => <FeedLine key={row.key} row={row} size={view.size} {...(canPick ? { onPick: (line: FeedBuyer, item: FeedNo) => setPicked({ id: item.id, no: item.no, buyer: line.buyer }) } : {})} />)}
        </View>
      ) : (
        <View role="list" aria-label="번호별 찜 기록" style={{ gap: view.size === 'small' ? SPACE.xs : SPACE.sm }}>
          {numbers.map((row) => <NumberLine key={row.key} row={row} size={view.size} {...(canPick ? { onPick: (line: FeedNumber, chip: FeedChip) => setPicked({ id: chip.id, no: line.no, buyer: chip.buyer }) } : {})} />)}
        </View>
      )}
      {canPick ? <ClaimMenu picked={picked} onClose={() => setPicked(null)} onError={setError} {...(onOpenProduct === undefined ? {} : { onOpenProduct })} {...(onEditProduct === undefined ? {} : { onEditProduct })} /> : null}
    </View>
  )
}
