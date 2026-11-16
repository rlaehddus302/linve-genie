// 방송 화면의 찜 기록 (D-LIVETEST-07 → D-UX3-79): 구매자별로 번호를 묶는다 — 손님 이름(문자 손님은 "문자-끝 4자리"),
// 그 아래에 찜한 번호를 하나씩 둥근 네모 꼬리표로 늘어놓고 자리가 없으면 아랫줄로 내려간다(D-UX4-199). 채팅 원문은 그리지 않는다.
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
// D-UX4-199 (사용자 지시 2026-11-16 "이 화면에서 닉네임 아래에 시간이 왜 있는가? 지워라. 그리고 정렬 ui도 상품 목록과 맞춰라.
//   글자 크기 옵션은 지워라. 닉네임 옆에 번호를 나열하지 말고 닉네임 아래에 나열하라."):
// - 154의 이름 아래 시각을 걷었다(찜 메뉴 머리의 그 찜 시각은 그대로).
// - 정렬은 상품 목록 [목록 순서]와 같은 꼴: 둘째 줄 오른쪽에 위아래 화살표 + 지금 순서 이름 단추, 누르면 아래 창(BottomSheet)에서 고른다(SheetChoices).
//   고르는 것은 그대로 최근순(기본) · 이름순. [최근순 | 이름순] 나란히 고르기는 걷었다.
// - 글자 [크게 | 작게](D-RETRO-52)를 걷었다 — 꼬리표는 늘 보통 크기(높이 36). 저장한 글자 크기는 읽지도 쓰지도 않는다(lib/feed-view).
// - 꼬리표는 이름 옆이 아니라 이름 아래 줄에 왼쪽부터 늘어놓는다(넘치면 아랫줄).
import { useMemo, useState } from 'react'
import { Keyboard, LayoutAnimation, Platform, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import type { Claim } from '@livejjim/web/src/api/types.ts'
import { BUYER_SORTS, BUYER_SORT_WORD, FEED_VIEW_DEFAULT, setFeedView, useFeedView, type BuyerSort } from '../../lib/feed-view.ts'
import { SORT_TITLE } from '../../lib/product-sort.ts'
import { BottomSheet, EmptyFill, SheetChoices, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { Hint, Notice } from '../../ui/parts.tsx'
import { SearchField } from '../customer-parts.tsx'
import { ClaimMenu, type PickedClaim } from './ClaimMenu.tsx'
import { useConsoleApi } from './context.ts'
import { feedPickable, feedRows, filterFeed, noLabel, searchText, type FeedBuyer, type FeedNo, type FeedTone } from './feed-rows.ts'
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
/** 정렬 단추·고르는 판 제목 — 상품 목록 [목록 순서]와 같은 말 (D-UX4-199) */
export const FEED_SORT_TITLE = SORT_TITLE
/** 한 번에 그리는 손님 줄 수 (최근순 — 최신 손님부터). 이름순·찾는 중에는 찾는 보기라 모두 그린다 */
export const FEED_LIMIT = 60

const PILL_TONE: Readonly<Record<FeedTone, PillTone>> = { win: 'win', wait: 'wait', pending: 'pending', conflict: 'conflict', other: 'wait' }

/** 번호 꼬리표 — 둥근 네모(사용자 지시 "배경은 라운드직사각"), 위 탭 알약과 같은 크기. onPick이 있을 때만 누른다 */
function NoTag({ item, onPick }: { readonly item: FeedNo; readonly onPick?: () => void }) {
  return <NamePill square text={`${String(item.no)} ${item.word}`} tone={PILL_TONE[item.tone]} ariaLabel={noLabel(item)} {...(onPick === undefined ? {} : { onPress: onPick })} />
}

/**
 * 손님 한 줄 (D-UX4-199): 위에 이름, 그 아래 줄에 번호 꼬리표를 왼쪽부터(넘치면 아랫줄).
 * canPick: 이 꼬리표를 누를 수 있는지(없으면 누르지 않는다) — onPick이 없으면 아무것도 누르지 않는다
 */
export function FeedLine({ row, onPick, canPick }: { readonly row: FeedBuyer; readonly onPick?: (row: FeedBuyer, item: FeedNo) => void; readonly canPick?: (item: FeedNo) => boolean }) {
  const { p } = useKit()
  return (
    <View role="listitem" aria-label={`${row.buyer} ${row.nos.map(noLabel).join(', ')}`} style={{ gap: SPACE.sm, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: p.surface }}>
      <Txt step="bodyLarge" weight="bold" numberOfLines={1}>{row.buyer}</Txt>
      <View testID="feed-tags" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', gap: SPACE.sm }}>
        {row.nos.map((item) => {
          const can = onPick !== undefined && (canPick?.(item) ?? true)
          return <NoTag key={item.id} item={item} {...(can ? { onPick: () => onPick(row, item) } : {})} />
        })}
      </View>
    </View>
  )
}

/** 고른 순서가 바뀔 때 목록을 부드럽게 (상품 목록 순서와 같은 움직임 — 웹은 없음) */
function animateNextLayout(): void {
  if (Platform.OS === 'web') return
  LayoutAnimation.configureNext(LayoutAnimation.create(240, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))
}

/** 위아래 화살표 (상품 목록 [목록 순서] 단추와 같은 그림) */
function SortGlyph({ color }: { readonly color: string }) {
  return (
    <View aria-hidden testID="chip-sort" style={{ width: 18, height: 18 }}>
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path d="M8 5 V19 M8 5 L4.8 8.2 M8 5 L11.2 8.2 M16 19 V5 M16 19 L12.8 15.8 M16 19 L19.2 15.8" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  )
}

/** 정렬 단추 (D-UX4-199 — 상품 목록 [목록 순서] 단추와 같은 꼴): 위아래 화살표 + 지금 순서 이름 — 누르면 고르는 판 */
function FeedSortButton({ sort, onPress }: { readonly sort: BuyerSort; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={`${FEED_SORT_TITLE} — ${BUYER_SORT_WORD[sort]}`} testID="feed-sort-button" onPress={onPress} hitSlop={4} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, flexShrink: 0, minHeight: 36, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <SortGlyph color={p.textSub} />
      <Txt step="body" weight="medium" ink={p.textSub} numberOfLines={1}>{BUYER_SORT_WORD[sort]}</Txt>
    </Tap>
  )
}

const SORT_CHOICES = BUYER_SORTS.map((value) => ({ value, label: BUYER_SORT_WORD[value] }))

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
 * 찜 기록 도구 줄 (D-UX4-152 → D-UX4-199): 첫 줄 찾기 칸(상품 탭 번호 검색칸과 같은 SearchField — 글이 있으면 동그란 지우기 x),
 * 둘째 줄 오른쪽 정렬 단추 — 상품 목록 도구 줄(ProductToolbar)의 [찜 된 것만] 칩 · [목록 순서] 단추 줄과 같은 자리·꼴.
 * 누르면 아래 창에서 최근순 · 이름순을 고른다. 상태는 들지 않는다 — 고르는 판(아래 창)만 여기서 연다.
 */
export function ClaimFeedToolbar({ query, onQuery, sort, onSort }: ClaimFeedToolbarProps) {
  const [picking, setPicking] = useState(false)
  return (
    <View role="group" aria-label="찜 기록 찾기·정렬" testID="feed-toolbar" style={{ gap: SPACE.sm }}>
      <SearchField label={FEED_SEARCH_LABEL} placeholder={FEED_SEARCH_HINT} value={query} onChangeText={onQuery} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm }}>
        <View />
        <FeedSortButton sort={sort} onPress={() => { Keyboard.dismiss(); setPicking(true) }} />
      </View>
      <BottomSheet visible={picking} onClose={() => setPicking(false)} title={FEED_SORT_TITLE}>
        <SheetChoices label={FEED_SORT_TITLE} testID="feed-sort-choices" choices={SORT_CHOICES} value={sort} onPick={(next) => { setPicking(false); if (next !== sort) { animateNextLayout(); onSort(next) } }} />
      </BottomSheet>
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
  /** 그 상태의 찜만 (보류 찜 판 — 누르지 않고 도구 줄 없이 최근순으로) */
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
  const own = useClaimFeedState()
  const query = queryProp ?? own.query
  const sort = sortProp ?? (only === undefined ? own.sort : FEED_VIEW_DEFAULT.buyerSort)
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
        <View role="list" aria-label="찜 기록" style={{ gap: SPACE.sm }}>
          {shown.map((row) => (
            <FeedLine
              key={row.key}
              row={row}
              {...(pickOn ? { onPick: (line: FeedBuyer, item: FeedNo) => setPicked({ id: item.id, no: item.no, buyer: line.buyer }), canPick: (item: FeedNo) => feedPickable(item, closed, canOpen) } : {})}
            />
          ))}
        </View>
      )}
      {pickOn ? <ClaimMenu picked={picked} onClose={() => setPicked(null)} onError={setError} {...(onOpenProduct === undefined ? {} : { onOpenProduct })} {...(onEditProduct === undefined ? {} : { onEditProduct })} /> : null}
    </View>
  )
}
