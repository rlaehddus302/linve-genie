// 라이브 화면 찾기 화면 (D-UX4-204, 사용자 2026-11-16 토스 검색 화면 사진 "검색 눌렀을 때 별도 화면으로 넘어가서 사진4처럼 넘어가"):
// 머리 돋보기를 누르면 쌓인 화면(/console/<방송>/search)으로 넘어간다 — 위에 ‹ 와 가운데 제목, 그 아래 회색 찾기 칸, 그 아래 결과.
// 하나로 찾기 (D-UX4-205, 사용자 "검색은 상품 검색이든 찜 검색이든 하나로 통합해서 다 보여주면 돼. 번호, 품종, 닉네임으로 검색되게 하면 되겠지."):
// 한 칸(휴대폰 키보드)에 번호·품종·닉네임 무엇이든 쓰면 맞는 상품과 찜 기록을 묶음 머리(토스 날짜 머리 자리) 아래 함께 보인다.
// 결과를 누르면 라이브 화면으로 돌아가 그 상품 자세히를 연다(signalConsole show — "그 상품 보기"와 같다).
import { useCallback, useMemo, useState } from 'react'
import { Keyboard, ScrollView, View } from 'react-native'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { EmptyFill, StackPage, Txt, useKit } from '../../ui/kit/index.ts'
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
export const SEARCH_EMPTY = '번호, 품종, 닉네임으로 찾아요'
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
        {blank ? <EmptyFill title={SEARCH_EMPTY} /> : productCount === 0 && feedCount === 0 ? <EmptyFill title={SEARCH_NO_MATCH} body={SEARCH_NO_MATCH_BODY} /> : (
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
