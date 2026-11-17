// 라이브 화면 찾기 화면 (D-UX4-204, 사용자 2026-11-16 토스 검색 화면 사진 "검색 눌렀을 때 별도 화면으로 넘어가서 사진4처럼 넘어가"):
// 머리 돋보기를 누르면 쌓인 화면(/console/<방송>/search)으로 넘어간다 — 위에 ‹ 와 가운데 제목, 그 아래 회색 찾기 칸, 그 아래 결과.
// 하나로 찾기 (D-UX4-205, 사용자 "검색은 상품 검색이든 찜 검색이든 하나로 통합해서 다 보여주면 돼. 번호, 품종, 닉네임으로 검색되게 하면 되겠지."):
// 한 칸(휴대폰 키보드)에 번호·품종·닉네임 무엇이든 쓰면 맞는 상품과 찜 기록을 묶음 머리(토스 날짜 머리 자리) 아래 함께 보인다.
// 결과를 누르면 라이브 화면으로 돌아가 그 상품 자세히를 연다(signalConsole show — "그 상품 보기"와 같다).
import { useCallback, useMemo, useState } from 'react'
import { Keyboard, ScrollView, View } from 'react-native'
import type { Product } from '@livejjim/web/src/api/types.ts'
import Svg, { Circle, Path } from 'react-native-svg'
import { StackPage, Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, SPACE } from '../../ui/kit/tokens.ts'
import { Loading } from '../../ui/parts.tsx'
import { SearchField } from '../customer-parts.tsx'
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
export const SEARCH_NO_MATCH = '찾는 결과가 없어요'
export const SEARCH_NO_MATCH_BODY = '번호, 품종, 닉네임을 다시 확인해 주세요'

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
  /** 결과를 누르면 라이브 화면으로 돌아가 그 상품을 연다 */
  const pick = (key: string) => {
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
      <View style={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.xs, paddingBottom: SPACE.md }}>
        <SearchField label={SEARCH_LABEL} value={query} fill={p.surfaceAlt} autoFocus onChangeText={setQuery} />
      </View>
      {/* 목록을 끌기 시작하면 키보드를 내린다 (D-UX4-200과 같음) */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: GUTTER, paddingBottom: SPACE.xxl, gap: SPACE.lg }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={() => Keyboard.dismiss()}>
        {blank ? <SearchHint /> : productCount === 0 && feedCount === 0 ? <NoMatch /> : (
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

/** 빈 칸일 때: 토스 검색 화면처럼 회색 그림(줄 셋 + 돋보기) 아래 회색 두 줄 — 찾기 칸 아래 고정 자리 */
function SearchHint() {
  const { p } = useKit()
  return (
    <View role="status" aria-label={SEARCH_EMPTY.replace('\n', ' ')} testID="search-hint" style={{ alignItems: 'center', paddingTop: SEARCH_HINT_TOP, paddingHorizontal: SPACE.lg, gap: SPACE.lg }}>
      <SearchListGlyph color={p.clearCircle} />
      <Txt step="body" weight="book" ink={p.borderStrong} center>
        {SEARCH_EMPTY}
      </Txt>
    </View>
  )
}

/** 맞는 것이 없을 때 — 안내와 같은 고정 자리 (키보드에 밀려 올라가지 않는다) */
function NoMatch() {
  return (
    <View role="status" aria-label={`${SEARCH_NO_MATCH} ${SEARCH_NO_MATCH_BODY}`} testID="search-no-match" style={{ alignItems: 'center', paddingTop: SEARCH_HINT_TOP, paddingHorizontal: SPACE.lg, gap: SPACE.sm }}>
      <Txt step="lead" weight="bold" center>
        {SEARCH_NO_MATCH}
      </Txt>
      <Txt step="body" weight="medium" color="textSub" center>
        {SEARCH_NO_MATCH_BODY}
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
