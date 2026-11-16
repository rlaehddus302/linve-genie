// 라이브 화면 찾기 화면 (D-UX4-204, 사용자 2026-11-16 토스 검색 화면 사진 "검색 눌렀을 때 별도 화면으로 넘어가서 사진4처럼 넘어가"):
// 머리 돋보기를 누르면 쌓인 화면(/console/<방송>/search?kind=)으로 넘어간다 — 위에 ‹ 와 가운데 제목, 그 아래 회색 찾기 칸, 그 아래 결과 줄(라이브 화면과 같은 줄).
// 상품은 번호만 찾으니 앱 숫자판이 아래에 붙고, 찜 기록은 휴대폰 키보드. 결과를 누르면 라이브 화면으로 돌아가 그 상품 자세히를 연다(signalConsole show — "그 상품 보기"와 같다).
import { useState } from 'react'
import { Keyboard, ScrollView, View } from 'react-native'
import { StackPage, useBottomInset, useKit } from '../../ui/kit/index.ts'
import { GUTTER, SPACE } from '../../ui/kit/tokens.ts'
import { Loading } from '../../ui/parts.tsx'
import { SearchField } from '../customer-parts.tsx'
import { ClaimFeed, FEED_SEARCH_HINT, FEED_SEARCH_LABEL } from './ClaimFeed.tsx'
import { NumberKeys } from './ProductAdd.tsx'
import { ProductList } from './ProductBoard.tsx'
import { ScopeConsole, signalConsole } from './scope.tsx'

export type ConsoleSearchKind = 'products' | 'feed'

/** 화면 이름(머리 가운데 제목) */
export const SEARCH_PAGE_NAME: Readonly<Record<ConsoleSearchKind, string>> = { products: '상품 검색', feed: '찜 기록 검색' }
export const PRODUCT_SEARCH_LABEL = '상품 번호 검색'

export function ConsoleSearchScreen({ broadcastId, kind, onBack }: { readonly broadcastId: string; readonly kind: ConsoleSearchKind; readonly onBack: () => void }) {
  return (
    <ScopeConsole broadcastId={broadcastId} waiting={<StackPage name={SEARCH_PAGE_NAME[kind]} title={SEARCH_PAGE_NAME[kind]} onBack={onBack} scroll={false}><Loading /></StackPage>}>
      {() => <SearchPage broadcastId={broadcastId} kind={kind} onBack={onBack} />}
    </ScopeConsole>
  )
}

function SearchPage({ broadcastId, kind, onBack }: { readonly broadcastId: string; readonly kind: ConsoleSearchKind; readonly onBack: () => void }) {
  const { p } = useKit()
  const inset = useBottomInset()
  const [query, setQuery] = useState('')
  // 상품 찾기는 숫자판을 연 채로 시작한다 — 들어오자마자 번호를 누를 수 있게
  const [pad, setPad] = useState(kind === 'products')
  const name = SEARCH_PAGE_NAME[kind]
  /** 결과를 누르면 라이브 화면으로 돌아가 그 상품을 연다 */
  const pick = (key: string) => {
    Keyboard.dismiss()
    setPad(false)
    signalConsole(broadcastId, { kind: 'show', key })
    onBack()
  }
  const numberSearch = { open: () => setPad(true), submit: () => setPad(false) }
  const quiet = () => {
    setPad(false)
    Keyboard.dismiss()
  }
  return (
    <StackPage name={name} title={name} onBack={onBack} scroll={false} testID="console-search-page"
      footer={kind === 'products' && pad ? (
        <View testID="console-search-pad" style={{ backgroundColor: p.surface, borderTopWidth: 1, borderTopColor: p.line, paddingBottom: Math.max(inset, SPACE.sm) }}>
          <NumberKeys doubleZero={false} onKey={(key) => setQuery((value) => (key === 'back' ? value.slice(0, -1) : value + key))} />
        </View>
      ) : null}>
      {/* 토스 검색 화면처럼 화면 끝에서 16 안쪽에 회색 찾기 칸 */}
      <View style={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.xs, paddingBottom: SPACE.md }}>
        {kind === 'products' ? (
          <SearchField label={PRODUCT_SEARCH_LABEL} value={query} fill={p.surfaceAlt} autoFocus numberSearch={numberSearch}
            onChangeText={(text) => setQuery(text.normalize('NFKC').replace(/\D/g, ''))} />
        ) : (
          <SearchField label={FEED_SEARCH_LABEL} placeholder={FEED_SEARCH_HINT} value={query} fill={p.surfaceAlt} autoFocus onChangeText={setQuery} />
        )}
      </View>
      {/* 목록을 끌기 시작하면 숫자판·키보드를 내린다 (D-UX4-200과 같음) */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: GUTTER, paddingBottom: SPACE.xxl }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={quiet}>
        {kind === 'products'
          ? <ProductList onOpen={pick} query={query} onQuery={setQuery} numberSearch={numberSearch} toolbar={false} />
          : <ClaimFeed toolbar={false} query={query} onQuery={setQuery} onOpenProduct={pick} onEditProduct={pick} />}
      </ScrollView>
    </StackPage>
  )
}
