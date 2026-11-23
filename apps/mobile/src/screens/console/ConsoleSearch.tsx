// 라이브 화면 찾기 화면 (D-UX4-204, 사용자 2026-11-16 토스 검색 화면 사진 "검색 눌렀을 때 별도 화면으로 넘어가서 사진4처럼 넘어가"):
// 머리 돋보기를 누르면 쌓인 화면(/console/<방송>/search)으로 넘어간다 — 위에 ‹ 와 가운데 제목, 그 아래 회색 찾기 칸, 그 아래 결과.
// 하나로 찾기 (D-UX4-205, 사용자 "검색은 상품 검색이든 찜 검색이든 하나로 통합해서 다 보여주면 돼. 번호, 품종, 닉네임으로 검색되게 하면 되겠지."):
// 한 칸(휴대폰 키보드)에 번호·품종·닉네임 무엇이든 쓰면 맞는 상품과 찜 기록을 묶음 머리(토스 날짜 머리 자리) 아래 함께 보인다.
// 결과를 누르면 라이브 화면으로 돌아가 그 상품 자세히를 연다(signalConsole show — "그 상품 보기"와 같다).
import { useCallback, useMemo, useState } from 'react'
import { Keyboard, ScrollView, View } from 'react-native'
import type { Product } from '@livejjim/web/src/api/types.ts'
import Svg, { Circle, Path } from 'react-native-svg'
import { addRecentSearch, clearRecentSearches, useRecentSearches } from '../../lib/recent-searches.ts'
import { RADIUS, StackPage, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, SPACE } from '../../ui/kit/tokens.ts'
import { Loading } from '../../ui/parts.tsx'
import { SearchField, TextButton } from '../customer-parts.tsx'
import { ClaimFeed } from './ClaimFeed.tsx'
import { feedRowMatches, productMatches } from './console-search.ts'
import { useConsoleApi } from './context.ts'
import { feedRows, type FeedBuyer } from './feed-rows.ts'
import { ProductList, rowName, shownProducts } from './ProductBoard.tsx'
import { ScopeConsole, signalConsole } from './scope.tsx'

/** 화면 이름(머리 가운데 제목) */
export const SEARCH_PAGE_NAME = '검색'
export const SEARCH_LABEL = '번호, 품종, 닉네임 검색'
/** 빈 칸일 때 안내 (D-SEARCH-EMPTY-01, 사용자 2026-11-17 토스 지출·수입 검색 사진 "사진2 디자인을 그대로 배껴") */
export const SEARCH_EMPTY = '상품 번호·품명이나\n닉네임을 검색해보세요.'
/**
 * 안내가 찾기 칸 아래 이만큼 떨어져 고정된다 (D-SEARCH-EMPTY-01, 사용자 "글자가 키보드에 밀려 올라오던데 그렇게 하지 말고 검색바 아래 일정 거리에 고정배치해"):
 * 토스 사진에서 찾기 칸 밑에서 그림 위까지 ≈ 165 — 찾기 칸 아래 여백(12)을 뺀 값. 가운데 맞춤이 아니라 키보드가 떠도 움직이지 않는다.
 */
export const SEARCH_HINT_TOP = 152
/** 최근 검색어 (D-SEARCH-RECENT-01, 토스 검색 사진) */
export const RECENT_TITLE = '최근 검색어'
export const RECENT_CLEAR = '전체 삭제'
/** 맞는 것이 없을 때 (D-SEARCH-EMPTY-02, 사용자 2026-11-17 토스 검색 결과 없음 사진 "검색 결과 없을 때 저렇게 똑같이 띄워줘.") — 빈 칸 안내와 같은 그림 아래 한 줄 */
export const SEARCH_NO_MATCH = '검색한 내용을 찾을 수 없어요.'
/**
 * 처음 뜨는 키보드는 숫자 키패드 (D-UX4-212, 사용자 "검색에서 기본 키보드 띄울 때, 숫자 키패드를 기본으로 띄워. 보통 번호를 검색하니까."):
 * 숫자 키패드에는 글자로 바꾸는 키가 없어(아이폰·갤럭시 모두) 칸 오른쪽 글자 단추로 바꾼다 — 숫자일 때 [한글], 글자일 때 [숫자]
 */
export const KEYS_TO_TEXT = '한글'
export const KEYS_TO_DIGITS = '숫자'

export function ConsoleSearchScreen({ broadcastId, onBack }: { readonly broadcastId: string; readonly onBack: () => void }) {
  return (
    <ScopeConsole broadcastId={broadcastId} waiting={<StackPage name={SEARCH_PAGE_NAME} title={SEARCH_PAGE_NAME} onBack={onBack} scroll={false}><Loading /></StackPage>}>
      {() => <SearchPage broadcastId={broadcastId} onBack={onBack} />}
    </ScopeConsole>
  )
}

function SearchPage({ broadcastId, onBack }: { readonly broadcastId: string; readonly onBack: () => void }) {
  const { p } = useKit()
  const api = useConsoleApi()
  const [query, setQuery] = useState('')
  const [textKeys, setTextKeys] = useState(false)
  /** 결과를 누르면 라이브 화면으로 돌아가 그 상품을 연다 */
  const recent = useRecentSearches()
  const pick = (key: string) => {
    // 결과를 눌러 열면 그 검색어를 남긴다 (D-SEARCH-RECENT-01)
    addRecentSearch(query)
    Keyboard.dismiss()
    signalConsole(broadcastId, { kind: 'show', key })
    onBack()
  }
  const nameOf = useCallback((id: string) => api.names.name(id), [api.names])
  const matchProduct = useCallback((product: Product) => productMatches(product, query, nameOf), [query, nameOf])
  const productNameOf = useCallback((no: number) => {
    const product = api.data.products.get(`${broadcastId}/${String(no)}`)
    return product === undefined ? '' : rowName(product)
  }, [api.data.products, broadcastId])
  const matchFeed = useCallback((row: FeedBuyer) => feedRowMatches(row, query, productNameOf), [query, productNameOf])
  const productCount = useMemo(() => shownProducts(api.data, broadcastId).filter(matchProduct).length, [api.data, broadcastId, matchProduct])
  const feedCount = useMemo(() => feedRows(api.data, api.names, broadcastId).filter(matchFeed).length, [api.data, api.names, broadcastId, matchFeed])
  const blank = query.trim() === ''
  return (
    <StackPage name={SEARCH_PAGE_NAME} title={SEARCH_PAGE_NAME} onBack={onBack} scroll={false} testID="console-search-page">
      {/* 토스 검색 화면처럼 화면 끝에서 16 안쪽에 회색 찾기 칸 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingHorizontal: SPACE.lg, paddingTop: SPACE.xs, paddingBottom: SPACE.md }}>
        <View style={{ flex: 1 }}>
          <SearchField label={SEARCH_LABEL} value={query} fill={p.surfaceAlt} autoFocus keyboardType={textKeys ? 'default' : 'number-pad'} onChangeText={setQuery} onSubmit={() => addRecentSearch(query)} />
        </View>
        <TextButton label={textKeys ? KEYS_TO_DIGITS : KEYS_TO_TEXT} ariaLabel={textKeys ? '숫자 키보드로 바꾸기' : '한글 키보드로 바꾸기'} color="textSub" onPress={() => setTextKeys(on => !on)} />
      </View>
      {/* 목록을 끌기 시작하면 키보드를 내린다 (D-UX4-200과 같음) */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: GUTTER, paddingBottom: SPACE.xxl, gap: SPACE.lg }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={() => Keyboard.dismiss()}>
        {blank ? (recent.length > 0 ? <RecentSearches list={recent} onPick={setQuery} /> : <SearchHint />) : productCount === 0 && feedCount === 0 ? <NoMatch /> : (
          <>
            {productCount === 0 ? null : (
              <View testID="search-products">
                <SectionHead text={`상품 ${String(productCount)}`} />
                <ProductList onOpen={pick} query={query} onQuery={setQuery} numberSearch={NO_PAD} toolbar={false} match={matchProduct} />
              </View>
            )}
            {feedCount === 0 ? null : (
              <View testID="search-feed">
                <SectionHead text={`찜 기록 ${String(feedCount)}`} />
                <ClaimFeed toolbar={false} query={query} match={matchFeed} onOpenProduct={pick} onEditProduct={pick} />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </StackPage>
  )
}

/**
 * 최근 검색어 (D-SEARCH-RECENT-01, 토스 검색 사진을 재어): 왼쪽 "최근 검색어" · 오른쪽 회색 [전체 삭제], 그 아래 옅은 회색 둥근 네모 검색어 한 줄(옆으로 밀어 더 보기).
 * 누르면 그 글로 바로 찾는다. 빈 칸일 때만 — 글을 쓰면 결과가 그 자리에 나온다.
 */
function RecentSearches({ list, onPick }: { readonly list: readonly string[]; readonly onPick: (text: string) => void }) {
  const { p } = useKit()
  return (
    <View role="group" aria-label={RECENT_TITLE} testID="recent-searches" style={{ paddingTop: SPACE.lg + 2, gap: SPACE.sm + 2, marginHorizontal: -GUTTER }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: SPACE.xl, paddingRight: SPACE.sm }}>
        <Txt step="bodyLarge" weight="medium" role="heading" aria-level={2}>
          {RECENT_TITLE}
        </Txt>
        <Tap role="button" aria-label={`${RECENT_TITLE} ${RECENT_CLEAR}`} onPress={clearRecentSearches} hitSlop={4} style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', paddingHorizontal: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
          <Txt step="meta" weight="book" ink={p.borderStrong}>
            {RECENT_CLEAR}
          </Txt>
        </Tap>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: SPACE.xl, gap: SPACE.sm }}>
        {list.map((text) => (
          <Tap key={text} role="button" aria-label={`최근 검색어 ${text}`} testID="recent-search" onPress={() => onPick(text)} style={({ pressed }) => ({ minWidth: 58, maxWidth: 220, height: 34, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACE.lg, borderRadius: RADIUS.sm, borderCurve: 'continuous', borderWidth: 1, borderColor: p.line, backgroundColor: pressed ? p.pressed : p.surfaceAlt })}>
            <Txt step="bodyLarge" weight="book" color="textSub" numberOfLines={1}>
              {text}
            </Txt>
          </Tap>
        ))}
      </ScrollView>
    </View>
  )
}

/** 빈 칸일 때: 토스 검색 화면처럼 회색 그림(줄 셋 + 돋보기) 아래 회색 두 줄 — 찾기 칸 아래 고정 자리 */
function SearchHint() {
  return <GlyphNote text={SEARCH_EMPTY} testID="search-hint" />
}

/** 맞는 것이 없을 때 — 토스 사진처럼 같은 그림 아래 회색 한 줄, 안내와 같은 고정 자리 (키보드에 밀려 올라가지 않는다, D-SEARCH-EMPTY-02) */
function NoMatch() {
  return <GlyphNote text={SEARCH_NO_MATCH} testID="search-no-match" />
}

/** 회색 그림 + 회색 글 (찾기 칸 아래 SEARCH_HINT_TOP 고정) */
function GlyphNote({ text, testID }: { readonly text: string; readonly testID: string }) {
  const { p } = useKit()
  return (
    <View role="status" aria-label={text.replace(/\n/g, ' ')} testID={testID} style={{ alignItems: 'center', paddingTop: SEARCH_HINT_TOP, paddingHorizontal: SPACE.lg, gap: SPACE.lg }}>
      <SearchListGlyph color={p.clearCircle} />
      <Txt step="body" weight="book" ink={p.borderStrong} center>
        {text}
      </Txt>
    </View>
  )
}

/** 줄 셋 + 돋보기 (토스 검색 안내 그림을 재어 그대로 — 30×28) */
function SearchListGlyph({ color }: { readonly color: string }) {
  return (
    <View aria-hidden testID="search-hint-glyph">
      <Svg width={30} height={28} viewBox="24 22 72 66" fill="none">
        <Path d="M30.5 29H82.5M30.5 51H44M30.5 74H47.5" stroke={color} strokeWidth={7} strokeLinecap="round" />
        <Circle cx={68} cy={59} r={15.5} stroke={color} strokeWidth={7} />
        <Path d="M79.5 70.5L90 81" stroke={color} strokeWidth={7} strokeLinecap="round" />
      </Svg>
    </View>
  )
}

/** 결과 묶음 머리 — 토스 검색 결과의 날짜 머리처럼 작은 회색 글 */
function SectionHead({ text }: { readonly text: string }) {
  const { p } = useKit()
  return (
    <View role="heading" style={{ paddingHorizontal: SPACE.sm + 2, paddingTop: SPACE.sm, paddingBottom: SPACE.xs }}>
      <Txt step="meta" weight="medium" ink={p.borderStrong}>{text}</Txt>
    </View>
  )
}

/** 찾기 화면은 휴대폰 키보드 하나만 쓴다 — 상품 목록의 번호 숫자판 연결은 비운다 */
const NO_PAD = { open: () => {}, submit: () => {} }
