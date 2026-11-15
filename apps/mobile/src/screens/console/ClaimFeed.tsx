// 방송 화면의 찜 기록 (D-LIVETEST-07 → D-UX3-79): 구매자별로 번호를 묶는다 — 한 줄에 왼쪽 손님 이름(문자 손님은 "문자-끝 4자리"),
// 그 옆에 찜한 번호를 하나씩 둥근 네모 꼬리표로 늘어놓고 자리가 없으면 아랫줄로 내려간다. 채팅 원문은 그리지 않는다.
// 손님 줄마다 따로 둥근 바탕(D-UX3-83). 꼬리표는 상품 줄과 같은 색·낱말(D-UX3-83): 찜(1등) 금색 "123 찜", 대기 회색 "123 대기 1",
// 보류(아직 없는 번호) 주황 "123 보류", 겹침 빨강, 취소·안 됨 회색에 그 낱말.
// 줄 순서는 라이브 채팅처럼 가장 최근에 찜한 손님이 맨 아래(D-UX3-75), 한 손님 안의 번호는 찜한 순서.
// 판정은 하지 않는다. 상태·대기 순서·1등은 서버 값(범위 자료) 그대로 낱말로만 바꾼다. 닉네임은 글자로만 그린다.
// D-UX4-27 (사용자 지시 2026-11-09): 이름·번호 꼬리표를 위 탭 알약과 같은 크기(높이 36·본문 큰 글자)로.
// D-RETRO-51~53 (복기 F6, 사용자 지시 2026-11-12): 정렬 [최근순 | 이름순] · 글자 [크게 | 작게](이 휴대폰에 기억, lib/feed-view) · 꼬리표를 누르면 그 찜의 메뉴(ClaimMenu).
// - 작게: 글자 13~14·꼬리표 높이 30. 누르는 높이는 큰 글자 꼬리표와 같은 40(꼬리표 30 + 위아래 5)이고 폭은 48 이상 — 줄 사이를 그만큼 띄워 겹치지 않는다.
// D-UX4-151~154 (사용자 지시 2026-11-16):
// - 151 번호별 보기(D-RETRO-50)와 [손님별 | 번호별] 고르기를 걷었다 — 번호로 누가 찜했는지는 상품 탭 [찜 된 것만](D-UX4-141)이 같은 일을 한다.
// - 152 찾기 칸 하나: 번호 또는 닉네임(feed-rows feedMatches). 찾기 칸 + 정렬 줄은 ClaimFeedToolbar로 따로 — 방송 화면이 위에 붙는 머리로 옮겨 쓸 수 있게
//   상태(query·sort)는 props로 받고, ClaimFeed는 toolbar={false}면 목록만 그린다. query·sort를 안 주면 안에서 갖는다(useClaimFeedState).
// - 153 이름순은 한글 → 영문 → 숫자·기호(feed-rows compareNames).
// - 154 손님 줄 이름 아래에 그 손님이 가장 최근에 찜한 시각(초까지 "13:05:42"), 찜 메뉴 머리에 그 찜의 시각. 끝난·봉인한 라이브에서도 상품이 있는 꼬리표는 눌러 [상품 보기].
import { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { Claim } from '@livejjim/web/src/api/types.ts'
import { BUYER_SORT_WORD, FEED_SIZE_WORD, FEED_VIEW_DEFAULT, setFeedView, useFeedView, type BuyerSort, type FeedSize } from '../../lib/feed-view.ts'
import { EmptyFill, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, RADIUS, SPACE, TOUCH, pressedFill } from '../../ui/kit/tokens.ts'
import { Hint, Notice } from '../../ui/parts.tsx'
import { SearchField } from '../customer-parts.tsx'
import { ClaimMenu, type PickedClaim } from './ClaimMenu.tsx'
import { useConsoleApi } from './context.ts'
import { feedClock, feedPickable, feedRows, filterFeed, noLabel, searchText, tagColors, type FeedBuyer, type FeedNo, type FeedTone } from './feed-rows.ts'
import { NamePill, type PillTone } from './parts.tsx'

export { compareNames, feedBuyerName, feedClock, feedMatches, feedPickable, feedRows, filterFeed, noLabel, searchText, tagColors, type FeedBuyer, type FeedNo, type FeedTone } from './feed-rows.ts'

export const FEED_EMPTY = '아직 찜이 없어요'
export const FEED_EMPTY_BODY = '채팅이나 문자로 찜이 오면\n바로 보여드릴게요'
/** 찾는 글에 맞는 찜이 없을 때 (D-UX4-152) */
export const FEED_NO_MATCH = '찾는 찜이 없어요'
export const FEED_NO_MATCH_BODY = '번호나 닉네임을 다시 확인해 주세요'
/** 찾기 칸 이름(읽기 낱말 — 지우기 단추는 "찜 기록 찾기 지우기")과 회색 안내 글 */
export const FEED_SEARCH_LABEL = '찜 기록 찾기'
export const FEED_SEARCH_HINT = '번호나 닉네임으로 찾기'
/** 한 번에 그리는 손님 줄 수 (최근순 — 최신 손님부터). 이름순·찾는 중에는 찾는 보기라 모두 그린다 */
export const FEED_LIMIT = 60

const PILL_TONE: Readonly<Record<FeedTone, PillTone>> = { win: 'win', wait: 'wait', pending: 'pending', conflict: 'conflict', other: 'wait' }

/**
 * 작은 글자 치수 (D-RETRO-52): 꼬리표 높이 30·글자 13. 누르는 높이 = 30 + 위아래 5 = 40 — 큰 글자 꼬리표(36 + 위아래 2)와 같다.
 * 누르는 자리가 부모 밖으로 나가면 눌리지 않으므로 꼬리표 묶음이 위아래 5를 안쪽 여백으로 갖고, 꼬리표 줄 사이는 10(= 5 + 5)을 띄운다.
 */
export const SMALL_PILL = { height: 30, padX: 10, slopY: 5, slopX: 3, radius: 8 } as const

/** 꼬리표 묶음의 간격: 크게는 지금까지와 같이 8, 작게는 가로 6·세로 10 */
const wrapStyle = (size: FeedSize) => (size === 'small'
  ? { flexDirection: 'row' as const, flexWrap: 'wrap' as const, columnGap: SPACE.sm - 2, rowGap: SMALL_PILL.slopY * 2, paddingVertical: SMALL_PILL.slopY }
  : { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACE.sm })

/** 작은 글자 꼬리표 (둥근 네모, SMALL_PILL). 긴 닉네임은 한 줄에서 줄인다 */
function SmallPill({ text, tone, ariaLabel, onPress }: { readonly text: string; readonly tone: FeedTone; readonly ariaLabel: string; readonly onPress?: () => void }) {
  const { p, tones } = useKit()
  const pair = tagColors(p, tones.danger, tone)
  const shape = { minHeight: SMALL_PILL.height, maxWidth: '100%' as const, paddingHorizontal: SMALL_PILL.padX, borderRadius: SMALL_PILL.radius, borderCurve: 'continuous' as const, alignItems: 'center' as const, justifyContent: 'center' as const }
  const label = (
    <Txt step="caption" weight={tone === 'wait' || tone === 'other' ? 'medium' : 'bold'} ink={pair.fg} numberOfLines={1}>
      {text}
    </Txt>
  )
  if (onPress === undefined) return <View aria-label={ariaLabel} style={{ ...shape, backgroundColor: pair.bg }}>{label}</View>
  return (
    <Tap role="button" aria-label={ariaLabel} onPress={onPress} hitSlop={{ top: SMALL_PILL.slopY, bottom: SMALL_PILL.slopY, left: SMALL_PILL.slopX, right: SMALL_PILL.slopX }} pressScale={0.96} style={({ pressed }) => ({ ...shape, minWidth: TOUCH.min, backgroundColor: pressed ? pressedFill(p, pair.bg) : pair.bg })}>
      {label}
    </Tap>
  )
}

/** 번호 꼬리표 — 둥근 네모(사용자 지시 "배경은 라운드직사각"), 위 탭 알약과 같은 크기(작게는 SMALL_PILL). onPick이 있을 때만 누른다 */
function NoTag({ item, size, onPick }: { readonly item: FeedNo; readonly size: FeedSize; readonly onPick?: () => void }) {
  const text = `${String(item.no)} ${item.word}`
  if (size === 'small') return <SmallPill text={text} tone={item.tone} ariaLabel={noLabel(item)} {...(onPick === undefined ? {} : { onPress: onPick })} />
  return <NamePill square text={text} tone={PILL_TONE[item.tone]} ariaLabel={noLabel(item)} {...(onPick === undefined ? {} : { onPress: onPick })} />
}

/**
 * 손님 한 줄: 왼쪽 이름과 그 아래 가장 최근에 찜한 시각(초까지, D-UX4-154), 오른쪽 번호 꼬리표.
 * canPick: 이 꼬리표를 누를 수 있는지(없으면 누르지 않는다) — onPick이 없으면 아무것도 누르지 않는다
 */
export function FeedLine({ row, onPick, canPick, size = 'large' }: { readonly row: FeedBuyer; readonly onPick?: (row: FeedBuyer, item: FeedNo) => void; readonly canPick?: (item: FeedNo) => boolean; readonly size?: FeedSize }) {
  const { p } = useKit()
  const small = size === 'small'
  const clock = feedClock(row.latest)
  return (
    <View role="listitem" aria-label={`${row.buyer} ${row.nos.map(noLabel).join(', ')}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: small ? SPACE.sm : SPACE.md, paddingVertical: small ? 0 : SPACE.sm, paddingHorizontal: small ? SPACE.sm + 2 : SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: p.surface }}>
      <View style={{ flexShrink: 1, maxWidth: '38%', minHeight: small ? SMALL_PILL.height + SMALL_PILL.slopY * 2 : 36, justifyContent: 'center' }}>
        <Txt step={small ? 'meta' : 'bodyLarge'} weight="bold" numberOfLines={1}>{row.buyer}</Txt>
        {clock === '' ? null : <Txt step={small ? 'caption' : 'meta'} color="textSub" numberOfLines={1} aria-label={`가장 최근 찜 ${clock}`}>{clock}</Txt>}
      </View>
      <View style={{ flex: 1, ...wrapStyle(size) }}>
        {row.nos.map((item) => {
          const can = onPick !== undefined && (canPick?.(item) ?? true)
          return <NoTag key={item.id} item={item} size={size} {...(can ? { onPick: () => onPick(row, item) } : {})} />
        })}
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

/** 찜 기록 도구 줄의 상태 (찾는 글 · 정렬) — 방송 화면이 들고 ClaimFeedToolbar·ClaimFeed에 함께 넘긴다 */
export interface ClaimFeedToolbarProps {
  /** 찾는 글 (번호 또는 닉네임 — 칸에 친 그대로) */
  readonly query: string
  readonly onQuery: (query: string) => void
  /** 손님 줄 정렬: 최근순 · 이름순 */
  readonly sort: BuyerSort
  readonly onSort: (sort: BuyerSort) => void
}

/**
 * 찜 기록 도구 줄 (D-UX4-152): 첫 줄 찾기 칸(상품 탭 번호 검색칸과 같은 SearchField — 글이 있으면 동그란 지우기 x),
 * 둘째 줄 [최근순 | 이름순] · 글자 [크게 | 작게]. 단추는 한 줄에만 놓고(D-UX4-01) 좁은 화면·큰 글자에서는 옆으로 민다.
 * 글자 크기는 이 휴대폰 기억(lib/feed-view)을 바로 읽고 쓴다 — 목록도 같은 값을 읽는다.
 */
export function ClaimFeedToolbar({ query, onQuery, sort, onSort }: ClaimFeedToolbarProps) {
  const { size } = useFeedView()
  return (
    <View role="group" aria-label="찜 기록 찾기·정렬" style={{ gap: SPACE.xs }}>
      <SearchField label={FEED_SEARCH_LABEL} placeholder={FEED_SEARCH_HINT} value={query} onChangeText={onQuery} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginHorizontal: -GUTTER, flexGrow: 0 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: GUTTER, paddingVertical: SPACE.xs }}>
        <Choice name="정렬" value={sort} onPick={onSort} options={[{ value: 'recent', label: BUYER_SORT_WORD.recent, ariaLabel: `${BUYER_SORT_WORD.recent} 정렬` }, { value: 'name', label: BUYER_SORT_WORD.name, ariaLabel: `${BUYER_SORT_WORD.name} 정렬` }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2 }}>
          <Txt step="caption" weight="medium" color="textSub">글자</Txt>
          <Choice name="글자 크기" value={size} onPick={(next) => setFeedView({ size: next })} options={[{ value: 'large', label: FEED_SIZE_WORD.large, ariaLabel: `글자 ${FEED_SIZE_WORD.large}` }, { value: 'small', label: FEED_SIZE_WORD.small, ariaLabel: `글자 ${FEED_SIZE_WORD.small}` }]} />
        </View>
      </ScrollView>
    </View>
  )
}

/** 찜 기록 도구 줄 상태: 찾는 글은 화면이 떠 있는 동안만, 정렬은 이 휴대폰에 기억(lib/feed-view) */
export function useClaimFeedState(): ClaimFeedToolbarProps {
  const [query, setQuery] = useState('')
  const { buyerSort } = useFeedView()
  return { query, onQuery: setQuery, sort: buyerSort, onSort: (sort) => setFeedView({ buyerSort: sort }) }
}

export interface ClaimFeedProps {
  /** 그 상태의 찜만 (보류 찜 판 — 누르지 않고 도구 줄 없이 최근순·큰 글자로) */
  readonly only?: Claim['status']
  /** 찜 메뉴 [상품 보기] — 그 상품 자세히를 연다 */
  readonly onOpenProduct?: (key: string) => void
  /** 찜 메뉴 [상품 고치기] — 그 상품을 고치는 창을 연다 */
  readonly onEditProduct?: (key: string) => void
  /** 도구 줄(찾기 칸·정렬)을 목록 위에 그린다. 기본: only가 없으면 그린다. false면 목록만 — 도구 줄은 바깥이 ClaimFeedToolbar로 */
  readonly toolbar?: boolean
  /** 찾는 글 (주면 그 값, 안 주면 안의 상태) */
  readonly query?: string
  /** 정렬 (주면 그 값, 안 주면 이 휴대폰 기억 — only가 있으면 최근순) */
  readonly sort?: BuyerSort
  /** 안에 그리는 도구 줄이 바꿀 때 (query·sort를 줄 때 같이 준다 — 안 주면 안의 상태를 바꾼다) */
  readonly onQuery?: (query: string) => void
  readonly onSort?: (sort: BuyerSort) => void
}

/** 찜 기록 */
export function ClaimFeed({ only, onOpenProduct, onEditProduct, toolbar, query: queryProp, sort: sortProp, onQuery, onSort }: ClaimFeedProps) {
  const api = useConsoleApi()
  const saved = useFeedView()
  const own = useClaimFeedState()
  const query = queryProp ?? own.query
  const sort = sortProp ?? (only === undefined ? own.sort : FEED_VIEW_DEFAULT.buyerSort)
  const size = only === undefined ? saved.size : FEED_VIEW_DEFAULT.size
  const showToolbar = toolbar ?? only === undefined
  const buyers = useMemo(() => feedRows(api.data, api.names, api.b, only, sort), [api.data, api.names, api.b, only, sort])
  const matched = useMemo(() => filterFeed(buyers, query), [buyers, query])
  const [picked, setPicked] = useState<PickedClaim | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closed = api.ended || api.sealed
  if (buyers.length === 0) return only === 'PENDING' ? <EmptyFill title="보류 찜이 없어요" body={'번호에 맞는 상품이 없는 찜이\n여기에 모여요'} /> : <EmptyFill title={FEED_EMPTY} body={FEED_EMPTY_BODY} />
  const searching = searchText(query) !== ''
  // 최근순만 최근 FEED_LIMIT명 (라이브 채팅처럼 가장 최근 손님이 맨 아래, D-UX3-75) — 이름순·찾는 중에는 모두 그린다
  const limited = !searching && sort === 'recent' && matched.length > FEED_LIMIT
  const shown = limited ? matched.slice(-FEED_LIMIT) : matched
  // 보류 찜 판은 누르지 않는다. 끝난·봉인한 라이브는 메뉴에 [상품 보기]만 남아 그 상품이 있는 꼬리표만 (D-UX4-154)
  const pickOn = only === undefined
  const canOpen = onOpenProduct !== undefined
  const bar = showToolbar ? (
    <ClaimFeedToolbar query={query} onQuery={onQuery ?? own.onQuery} sort={sort} onSort={onSort ?? own.onSort} />
  ) : null
  return (
    <View style={{ flexGrow: 1, gap: SPACE.sm }}>
      {bar}
      {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
      {limited ? <Hint>{`그 밖 ${String(matched.length - FEED_LIMIT)}명은 구매자 화면에서 볼 수 있어요.`}</Hint> : null}
      {shown.length === 0 ? <EmptyFill title={FEED_NO_MATCH} body={FEED_NO_MATCH_BODY} /> : (
        <View role="list" aria-label="찜 기록" style={{ gap: size === 'small' ? SPACE.xs : SPACE.sm }}>
          {shown.map((row) => (
            <FeedLine
              key={row.key}
              row={row}
              size={size}
              {...(pickOn ? { onPick: (line: FeedBuyer, item: FeedNo) => setPicked({ id: item.id, no: item.no, buyer: line.buyer }), canPick: (item: FeedNo) => feedPickable(item, closed, canOpen) } : {})}
            />
          ))}
        </View>
      )}
      {pickOn ? <ClaimMenu picked={picked} onClose={() => setPicked(null)} onError={setError} {...(onOpenProduct === undefined ? {} : { onOpenProduct })} {...(onEditProduct === undefined ? {} : { onEditProduct })} /> : null}
    </View>
  )
}
