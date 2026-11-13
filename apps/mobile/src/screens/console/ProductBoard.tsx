// 방송 중 상품 리스트·상품 자세히 (D-UX2-03, AC-S05-14, PRD-04, D-088). 값은 서버 조회(코어 조회 함수 결과) 그대로이고 낱말로만 바꾼다 — 앱은 판정하지 않는다.
// 리스트: 가장 최근에 올린 상품이 위(D-UX3-87). 첫째 줄 번호·품종·가격을 한 크기로, 그 아래 손님 닉네임 꼬리표 한 줄(D-UX3-78 → D-UX4-24 닉네임만, 문자는 "문자-0937").
// 확인이 필요한 상품(겹침·승계·일시 중지)은 주황 줄 + 쉬운 말. 판매 종료(CLOSED, 소프트 삭제)한 상품은 리스트에 그리지 않는다(D-UX4-28 — 상품 삭제).
// 방금 올라온 상품은 잠깐 연한 초록이었다가 흰색으로 천천히 돌아온다(D-UX4-29). 줄이 생기고 사라지고 커질 때는 부드럽게 움직인다.
// 자세히(아래 판, D-UX4-30, 사용자 지시 2026-11-09): 번호·품종·가격을 한 줄에 점선 둥근 칸으로 — 왼쪽 위 연필. 누르면 반 화면 판에서 고친다(D-UX4-106, ProductEdit).
// 그 아래 찜·대기 손님 이름 알약(위 탭 알약 크기, 넘치면 아랫줄로) — 누르면 "찜을 삭제할까요?" 팝업. 판매 완료·찜 요약·"아직 찜이 없어요"·일시 중지·판매 종료 단추는 없앴고,
// 토스 메뉴 줄로 [판매 시작](공개 전·멈춘 상품만) · [누가 살지 정하기](겹침·승계만) · [🗑 상품 삭제] — 삭제는 "상품을 삭제할까요?" 팝업 [닫기 | 삭제].
// D-RETRO-54 (복기 F7): 메뉴 줄 [찜 넣기] — 누르면 메뉴 자리에 손님 이름·전화번호 끝 네 자리 칸이 나오고 [닫기 | 찜 넣기]로 그 상품에 문자찜을 넣는다(ClaimAdd). 옵션 상품·끝난 라이브는 없다.
import { displayNickname } from '@livejjim/core/format'
import { memo, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { Animated, Keyboard, LayoutAnimation, Platform, View } from 'react-native'
import type { Buyer, Claim, Product } from '@livejjim/web/src/api/types.ts'
import { ProductLabelAction, QueueLabelButton } from '../ProductLabelAction.tsx'
import { SearchField } from '../customer-parts.tsx'
import { isApiError } from '../../api/client.ts'
import { boardProducts, claimsOfProduct, productSlots, type BuyerNames } from '../../lib/derive.ts'
import { TAG_GAP, TAG_PAD_X, buyerTagText, fitTags, type ProductTag } from '../../lib/product-tags.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { NO_PRODUCTS_YET, NO_PRODUCTS_YET_BODY, formatWon } from '../../lib/words.ts'
import { EmptyFill, ErrorLine, PopupDialog, Txt, useKit, Tap } from '../../ui/kit/index.ts'
import { MAX_FONT_SCALE, RADIUS, SPACE, TYPE, pressedFill } from '../../ui/kit/tokens.ts'
import { Notice } from '../../ui/parts.tsx'
import { ACTIVE_CLAIM, deleteClaim, deleteProduct } from './claim-actions.ts'
import { CLAIM_ADD, ClaimAddForm, type ClaimAdded } from './ClaimAdd.tsx'
import { feedBuyerName } from './feed-rows.ts'
import { useConsoleApi } from './context.ts'
import { IconMenuRow, NamePill, TRASH_TINT, type PillTone } from './parts.tsx'

/** 방금 올라온 상품을 연한 초록으로 두는 시간, 흰색으로 돌아오는 시간 (D-UX4-29) */
export const FRESH_HOLD_MS = 2500
export const FRESH_FADE_MS = 800

// 앱 글꼴 16pt 실측: '999번' 약 45pt, '10,000,000원' 약 100pt. 숫자별 폭 차이와 반올림 여유를 둔다.
const NUMBER_COLUMN = 48
const PRICE_COLUMN = 104

/** 상품 자세히: 값을 고쳐 이미 뽑은 라벨과 달라졌을 때 라벨 다시 인쇄 줄 위에 (D-RETRO-20) */
export const REPRINT_HINT = '값이 바뀐 라벨이 있어요. 라벨을 다시 인쇄해 주세요.'

/** 줄이 생기고·사라지고·커질 때 부드럽게 (D-UX4-29). 웹(시험)은 움직이지 않는다 */
export function animateNextLayout(): void {
  if (Platform.OS === 'web') return
  LayoutAnimation.configureNext(LayoutAnimation.create(240, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))
}

/** 값이 바뀌면 그다음 그리기를 부드럽게 — 그리기 중에 불러 바뀐 배치가 붙기 전에 움직임을 정한다 */
function useAnimatedChange(signature: string): void {
  const last = useRef(signature)
  if (last.current !== signature) {
    last.current = signature
    animateNextLayout()
  }
}

/** 리스트에 그리는 상품: 판매 종료(삭제)한 상품은 뺀다 (D-UX4-28) */
export function shownProducts(data: ScopeData, b: string): Product[] {
  return boardProducts(data, b).filter((product) => product.status !== 'CLOSED')
}

/** 아직 정하지 않은 상품 (겹침·다음 손님 정하기) */
export function undecided(product: Product): boolean {
  const slots = productSlots(product)
  return slots.conflict || slots.awaitingSuccession
}

export interface RowAttention {
  /** 앞 (굵게) */
  readonly who: string
  /** 뒤 (어떻게 하면 되는지) */
  readonly what: string
}

/** 확인이 필요한 줄(주황)의 낱말 (D-UX2-03). 판정 결과(충돌·승계)는 서버 값 그대로 쓴다. 확인할 것이 없으면 null */
export function rowAttention(product: Product, conflictClaims: number): RowAttention | null {
  const slots = productSlots(product)
  if (slots.conflict || conflictClaims > 0) return { who: conflictClaims > 1 ? `찜 ${String(conflictClaims)}명이 겹쳐요` : '찜이 겹쳐요', what: '· 눌러서 정하기' }
  if (slots.awaitingSuccession) return { who: '다음 손님을 정해야 해요', what: '· 눌러서 정하기' }
  if (product.status === 'HOLD') return { who: '잠시 멈춘 상품이에요', what: '· 눌러서 다시 열기' }
  return null
}

/** 줄 첫째 줄의 품종 — 비어 있으면 아무것도 쓰지 않는다 (D-UX3-78 "-" → D-UX4-111, 사용자 지시 2026-11-10 "품종 없으면 - 했는데 그냥 아무것도 넣지 말자") */
export const rowName = (product: Pick<Product, 'name'>): string => product.name.trim()

/** 줄 아래 꼬리표: 1등(금색) → 손님 꼬리표(입금 늦음 주의·단골) → 대기 손님(회색), 순서는 서버 순서 그대로 (D-UX3-78) */
export function rowTags(product: Product, buyerOf: (id: string) => Pick<Buyer, 'kind' | 'phoneLast4'> | undefined, nameOfBuyer: (id: string) => string, badge?: string): { readonly tags: ProductTag[]; readonly keep: number } {
  const slots = productSlots(product)
  const tags: ProductTag[] = slots.winners.map((id) => ({ kind: 'win', text: buyerTagText(buyerOf(id), nameOfBuyer(id), true) }))
  let keep = tags.length === 0 ? 0 : 1
  if (badge !== undefined && tags.length > 0) {
    tags.splice(1, 0, { kind: 'badge', text: badge })
    keep = 2
  }
  for (const id of slots.waitlist) tags.push({ kind: 'wait', text: buyerTagText(buyerOf(id), nameOfBuyer(id), false) })
  return { tags, keep }
}


/**
 * 상품 한 줄 (D-UX3-78): 첫째 줄 번호·품종·가격을 한 크기(16, D-UX3-84)로, 그 아래 꼬리표 한 줄 — 찜 닉네임(금색, 문자는 "문자-0937") → 대기 손님(회색) → [+N].
 * 찜도 대기도 없으면 아래 줄을 그리지 않는다. 확인이 필요한 상품은 꼬리표 대신 주황 글 한 줄.
 * freshAt: 방금 올라온 시각(아니면 0) — 그때부터 잠깐 연한 초록, 그 뒤 흰색으로 (D-UX4-29)
 */
const ProductRow = memo(function ProductRow({ product, freshAt, onOpen, doubt, conflicts, buyers, names }: {
  readonly product: Product
  readonly freshAt: number
  readonly onOpen: (key: string) => void
  readonly doubt?: string
  readonly conflicts: number
  readonly buyers: ScopeData['buyers']
  readonly names: BuyerNames
}) {
  const { p, fontScale } = useKit()
  const [width, setWidth] = useState(0)
  const attention = rowAttention(product, conflicts)
  const { tags, keep } = rowTags(product, (id) => buyers.get(id), (id) => names.name(id))
  const fit = fitTags(tags, width, TYPE.note * Math.min(fontScale, MAX_FONT_SCALE), keep)
  const glow = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const left = freshAt === 0 ? 0 : FRESH_HOLD_MS - (Date.now() - freshAt)
    if (left <= 0) {
      glow.setValue(0)
      return
    }
    glow.setValue(1)
    if (Platform.OS === 'web') {
      const handle = setTimeout(() => glow.setValue(0), left)
      return () => clearTimeout(handle)
    }
    const run = Animated.sequence([Animated.delay(left), Animated.timing(glow, { toValue: 0, duration: FRESH_FADE_MS, useNativeDriver: false })])
    run.start()
    return () => run.stop()
  }, [freshAt, glow])
  const bg = attention !== null ? p.warnBg : glow.interpolate({ inputRange: [0, 1], outputRange: [p.surface, p.freshBg] })
  const tagStyle = (fill: string) => ({ flexShrink: 0, paddingHorizontal: TAG_PAD_X, paddingVertical: 2, borderRadius: RADIUS.pill, borderCurve: 'continuous' as const, backgroundColor: fill })
  return (
    // 꾹 누르면 흰 줄이 통째로 들어간다 (D-UX4-105, 사용자 지시 2026-11-10 "흰색 영역이 통째로 버튼 영역이어야") — 누르는 틀(Tap)이 바깥, 흰 바탕은 그 안
    <Tap
      role="button"
      aria-label={`상품 자세히 — ${String(product.no)}번`}
      testID="product-row"
      onPress={() => { Keyboard.dismiss(); onOpen(product.key) }}
      style={{ borderRadius: RADIUS.md, borderCurve: 'continuous', overflow: 'hidden' }}
    >
      {({ pressed }) => (
      <Animated.View testID="product-row-fill" style={{ gap: SPACE.xs, paddingVertical: 10, paddingHorizontal: SPACE.md, backgroundColor: bg }}>
        {pressed ? <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: pressedFill(p, attention !== null ? p.warnBg : p.surface) }} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
          <View testID="product-row-no" style={{ width: Math.ceil(NUMBER_COLUMN * fontScale), maxWidth: '20%' }}>
            <Txt step="bodyLarge" weight="heavy" center numberOfLines={1} adjustsFontSizeToFit>{`${String(product.no)}번`}</Txt>
          </View>
          <View testID="product-row-name" style={{ flex: 1, minWidth: 0 }}>
            <Txt step="bodyLarge" weight="bold" center numberOfLines={1}>
              {rowName(product)}
            </Txt>
          </View>
          <View testID="product-row-price" style={{ width: Math.ceil(PRICE_COLUMN * fontScale), maxWidth: '50%' }}>
            <Txt step="bodyLarge" weight="bold" right numberOfLines={1} adjustsFontSizeToFit>{formatWon(product.price)}</Txt>
          </View>
        </View>
        {attention !== null ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.xs }}>
            <Txt step="caption" weight="bold" ink={p.warnText}>
              {attention.who}
            </Txt>
            <Txt step="caption" ink={p.warnText}>
              {attention.what}
            </Txt>
          </View>
        ) : tags.length === 0 ? null : (
          <View role="list" aria-label={`${String(product.no)}번 찜한 손님`} onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))} style={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: TAG_GAP, overflow: 'hidden' }}>
            {fit.shown.map((tag, index) => {
              const fill = tag.kind === 'win' ? p.goldBg : p.soft
              const ink = tag.kind === 'win' ? p.goldText : p.textSub
              return (
                <View key={`${tag.kind}-${String(index)}`} role="listitem" style={tagStyle(fill)}>
                  <Txt step="note" weight={tag.kind === 'wait' ? 'medium' : 'bold'} ink={ink} numberOfLines={1}>
                    {tag.text}
                  </Txt>
                </View>
              )
            })}
            {fit.more > 0 ? (
              <View role="listitem" aria-label={`${String(fit.more)}명 더`} style={tagStyle(p.soft)}>
                <Txt step="note" weight="bold" ink={p.textSub}>{`+${String(fit.more)}`}</Txt>
              </View>
            ) : null}
          </View>
        )}
        {/* 채팅 의심 표시 (D-V3-129): 자동으로 고치지 않고 판매자가 확인한다 */}
        {doubt === undefined ? null : <Txt step="caption" weight="bold" ink={p.warnText} role="note" aria-label={`번호 확인 — ${String(product.no)}번`}>{doubt}</Txt>}
      </Animated.View>
      )}
    </Tap>
  )
})

/** 상품 줄이 놓인 화면 요소 (자리를 재는 데 쓴다) */
export type RowNode = ComponentRef<typeof View>

/** 상품 전체 리스트 — 가장 최근에 말한(올린) 상품이 맨 위 (D-UX3-87). 처음 받은 상품은 강조하지 않고, 그 뒤에 올라온·고른 상품만 잠깐 초록 */
export function ProductList({ onOpen, query, onQuery, numberSearch, onRow }: {
  readonly onOpen: (key: string) => void
  readonly query: string
  readonly onQuery: (value: string) => void
  readonly numberSearch: { open: () => void; submit: () => void }
  /** 줄이 놓인 자리(상품 열쇠 → 줄) — 방송 화면이 "그 상품 보기"에서 그 줄로 스크롤한다 (D-RETRO-22) */
  readonly onRow?: (key: string, node: RowNode | null) => void
}) {
  const api = useConsoleApi()
  const products = shownProducts(api.data, api.b)
  const claims = api.data.claims
  const conflictCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const claim of claims.values()) {
      if (claim.status === 'CONFLICT') counts.set(claim.product, (counts.get(claim.product) ?? 0) + 1)
    }
    return counts
  }, [claims])
  const seen = useRef<Map<string, number> | null>(null)
  const lastSelected = useRef<string | null>(api.selected)
  if (seen.current === null) seen.current = new Map(products.map((product) => [product.key, 0]))
  const now = Date.now()
  for (const product of products) if (!seen.current.has(product.key)) seen.current.set(product.key, now)
  if (api.selected !== lastSelected.current) {
    lastSelected.current = api.selected
    if (api.selected !== null && seen.current.has(api.selected)) seen.current.set(api.selected, now)
  }
  useAnimatedChange(products.map((product) => `${product.key}:${String(productSlots(product).winners.length + productSlots(product).waitlist.length)}:${product.conflict ? 1 : 0}`).join('|'))
  if (products.length === 0 && query === '') return <EmptyFill title={NO_PRODUCTS_YET} body={NO_PRODUCTS_YET_BODY} />
  const prefix = query.replace(/^0+(?=\d)/, '')
  const matches = prefix === '' ? products : products
    .filter((product) => String(product.no).startsWith(prefix))
    .sort((a, b) => Number(b.no === Number(prefix)) - Number(a.no === Number(prefix)))
  return (
    <View style={{ flexGrow: 1, gap: SPACE.sm }}>
      <View onTouchEnd={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
        <SearchField label="상품 번호 검색" value={query} numberSearch={numberSearch} onChangeText={text => onQuery(text.normalize('NFKC').replace(/\D/g, ''))} />
      </View>
      {matches.length === 0 ? <EmptyFill title="해당 번호의 상품이 없어요" /> : (
        <View role="list" aria-label="상품 목록" style={{ gap: SPACE.xs }}>
          {matches.map((product) => (
            <View key={product.key} collapsable={false} ref={onRow === undefined ? undefined : (node) => onRow(product.key, node)}>
              <ProductRow product={product} freshAt={seen.current?.get(product.key) ?? 0} onOpen={onOpen} buyers={api.data.buyers} names={api.names} conflicts={conflictCounts.get(product.key) ?? 0} doubt={api.doubts?.get(product.no)} />
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const pillToneOf = (claim: Claim): PillTone => (claim.status === 'CONFIRMED' ? 'win' : claim.status === 'CONFLICT' ? 'conflict' : claim.status === 'PENDING' ? 'pending' : 'wait')

/** 자세히의 찜·대기 손님 순서: 1등 → 겹침 → 대기 순번 (서버 순서 그대로) */
export function detailClaims(data: ScopeData, product: Product): Claim[] {
  const slots = productSlots(product)
  const all = claimsOfProduct(data, product).filter((claim) => ACTIVE_CLAIM.has(claim.status))
  const byId = new Map(all.map((claim) => [claim.id, claim]))
  const out: Claim[] = []
  const take = (id: string) => {
    const claim = byId.get(id)
    if (claim !== undefined && !out.includes(claim)) out.push(claim)
  }
  for (const id of slots.winnerClaims) take(id)
  for (const claim of all) if (claim.status === 'CONFLICT') take(claim.id)
  for (const id of slots.waitlistClaims) take(id)
  for (const claim of all) take(claim.id)
  return out
}

/**
 * 상품 자세히 (아래 판 안, D-UX4-30): 번호·품종·가격 칸(fields — 고치기는 ProductEdit, D-UX4-106) → 찜·대기 이름 알약 → 메뉴 줄.
 * onDecide: 겹침·승계를 정하기 창으로 (판매자만). onDone: 상품을 지운 뒤(판 닫기)
 */
export function ProductDetail({ product, fields, onDecide, onDone }: { readonly product: Product; readonly fields: ReactNode; readonly onDecide?: () => void; readonly onKey?: (key: string) => void; readonly onDone?: () => void }) {
  const api = useConsoleApi()
  const closed = api.ended || api.sealed
  const [error, setError] = useState<string | null>(null)
  const [askClaim, setAskClaim] = useState<{ readonly id: string; readonly name: string } | null>(null)
  const [askProduct, setAskProduct] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copy, setCopy] = useState(0)
  // 찜 넣기 (D-RETRO-54): 칸을 연 동안은 메뉴 줄 대신 칸을 보인다. added: 넣은 결과 한 줄
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<ClaimAdded | null>(null)
  // 다른 상품으로 바뀌면(번호를 바꿔 열쇠가 바뀐 때 포함) 넣던 칸·결과 줄을 치운다
  useEffect(() => {
    setAdding(false)
    setAdded(null)
  }, [product.key])
  const claims = detailClaims(api.data, product)
  useAnimatedChange(claims.map((claim) => claim.id).join('|'))
  const fail = (caught: unknown, fallback: string) => setError(isApiError(caught) ? caught.message : caught instanceof Error && caught.message !== '' ? caught.message : fallback)
  const run = async (work: () => Promise<void>, fallback: string) => {
    setError(null)
    try {
      await work()
    } catch (caught) {
      fail(caught, fallback)
    }
  }
  const removeClaim = async () => {
    if (askClaim === null) return
    const claim = api.data.claims.get(askClaim.id)
    setBusy(true)
    await run(async () => {
      if (claim !== undefined && ACTIVE_CLAIM.has(claim.status)) await deleteClaim(api, claim)
    }, '찜을 지우지 못했어요. 다시 눌러 주세요.')
    setBusy(false)
    setAskClaim(null)
  }
  const removeProduct = async () => {
    setBusy(true)
    let ok = false
    await run(async () => {
      await deleteProduct(api, product)
      ok = true
    }, '상품을 지우지 못했어요. 다시 눌러 주세요.')
    setBusy(false)
    setAskProduct(false)
    if (ok) {
      animateNextLayout()
      onDone?.()
    }
  }
  const open = async () => run(async () => {
    await api.command({ type: 'product.open', b: api.b, no: product.no })
  }, '판매를 시작하지 못했어요. 다시 눌러 주세요.')
  const productLine = [`${String(product.no)}번`, rowName(product), formatWon(product.price)].filter((part) => part !== '').join(' ')
  const winnerLabels = api.productLabels?.filter((label) => label.kind === 'product' && label.broadcast === api.b && label.winner && label.claim !== null && claims.some((claim) => claim.id === label.claim)) ?? []
  return (
    <View role="group" aria-label="상품 자세히" style={{ gap: SPACE.lg }}>
      {fields}
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      {claims.length === 0 ? null : (
        <View role="list" aria-label={`${String(product.no)}번 찜·대기`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
          {claims.map((claim) => {
            const name = feedBuyerName(api.data, api.names, claim.currentBuyer)
            const tone = pillToneOf(claim)
            const word = tone === 'win' ? '찜' : tone === 'conflict' ? '겹침' : tone === 'pending' ? '보류' : '대기'
            return <NamePill key={claim.id} text={name} tone={tone} ariaLabel={`${name} ${word}`} {...(closed ? {} : { onPress: () => setAskClaim({ id: claim.id, name }) })} />
          })}
        </View>
      )}
      {added !== null ? <Notice tone={added.tone}>{added.text}</Notice> : null}
      {adding && !closed ? (
        <ClaimAddForm product={product} onClose={() => setAdding(false)} onAdded={(line) => { animateNextLayout(); setAdded(line); setAdding(false) }} />
      ) : (
      <View role="group" aria-label="상품 메뉴" style={{ gap: SPACE.xs }}>
        {api.labelsOff ? <Txt color="textSub">라벨을 인쇄하려면 관리에서 ‘라벨 뽑기’를 켜 주세요.</Txt> : null}
        {api.productLabels !== undefined && productSlots(product).winnerClaims.length === 0 ? (
          <QueueLabelButton key={`${product.id}:${copy}`} action="direct" title="상품 라벨 인쇄" disabled={false}
            body={{ b: api.b, no: product.no, name: product.name, price: product.price }} onQueued={() => setCopy((n) => n + 1)} />
        ) : null}
        {/* 가격·품종을 고쳐 뽑아 둔 라벨과 달라졌으면 먼저 알린다 (D-RETRO-20) — 서버가 "재출력 필요"로 본 라벨 */}
        {winnerLabels.some((label) => label.reprintNeeded && label.canReprint) ? <Txt step="caption" weight="bold" color="warnText" role="note">{REPRINT_HINT}</Txt> : null}
        {winnerLabels.map((label) => (
          <ProductLabelAction key={label.key} label={label} title={`${label.buyer.kind === 'youtube' ? displayNickname(label.buyer.name, api.names.hideSuffix) : '문자찜'} · ${label.canPrint ? '라벨 인쇄' : '라벨 다시 인쇄'}`} />
        ))}
        {!closed && (product.status === 'READY' || product.status === 'HOLD') ? <IconMenuRow emoji="▶️" tint="#E6F2EB" title="판매 시작" ariaLabel={`판매 시작 — ${String(product.no)}번`} onPress={() => void open()} /> : null}
        {!closed && !product.hasOptions ? <IconMenuRow emoji="✍️" tint="#F8E3A3" title={CLAIM_ADD} ariaLabel={`${CLAIM_ADD} — ${String(product.no)}번`} onPress={() => { setError(null); setAdded(null); setAdding(true) }} /> : null}
        {undecided(product) && onDecide !== undefined ? <IconMenuRow emoji="🙋" tint="#FFF4E5" title="누가 살지 정하기" onPress={onDecide} /> : null}
        {!closed ? <IconMenuRow emoji="🗑️" tint={TRASH_TINT} title="상품 삭제" ariaLabel={`상품 삭제 — ${String(product.no)}번`} onPress={() => setAskProduct(true)} /> : null}
      </View>
      )}
      <PopupDialog
        visible={askClaim !== null}
        message="찜을 삭제할까요?"
        description={askClaim?.name ?? null}
        cancelLabel="닫기"
        confirmLabel="삭제"
        busy={busy}
        onCancel={() => setAskClaim(null)}
        onConfirm={() => void removeClaim()}
      />
      <PopupDialog
        visible={askProduct}
        message="상품을 삭제할까요?"
        description={claims.length === 0 ? productLine : `${productLine}\n찜 ${String(claims.length)}건도 함께 지워져요.`}
        cancelLabel="닫기"
        confirmLabel="삭제"
        busy={busy}
        onCancel={() => setAskProduct(false)}
        onConfirm={() => void removeProduct()}
      />
    </View>
  )
}
