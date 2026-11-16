// 방송 중 상품 리스트·상품 자세히 (D-UX2-03, AC-S05-14, PRD-04, D-088). 값은 서버 조회(코어 조회 함수 결과) 그대로이고 낱말로만 바꾼다 — 앱은 판정하지 않는다.
// 리스트: 기본은 가장 최근에 올린 상품이 위(D-UX3-87), 목록 위 [목록 순서]로 바꾼다(D-UX4-150).
// 첫째 줄 "37 · 라비홍 · 50,000원"을 왼쪽부터 한 줄로(D-UX4-148), 그 아래 손님 닉네임 꼬리표 한 줄(D-UX3-78 → D-UX4-24 닉네임만, 문자는 "문자-0937").
// D-UX4-197 (사용자 지시 2026-11-16 "라이브 화면에서 상품 목록도 이렇게 만들어달라" — 정산서 상품별 목록, D-UX4-196): 상품마다 따로 흰 카드였던 것을
//   한 흰 둥근 카드 안의 줄로(줄 사이 1px 선, 양옆 20 띄움). 줄은 왼쪽 회색 "N번" 표 · 가운데 세로 칸(품종 굵게 16, 그 바로 아래 손님 금색 캡슐 높이 24) ·
//   오른쪽 가격 굵게 16. 옛(D-UX4-148): 첫째 줄 "12 · 녹두장군 · 250,000원" 한 줄 + 아래 작은 꼬리표 줄. 누르면 자세히·새 상품 초록 빛·주황 줄과 쉬운 말·
//   흐린 대기 밖·[+N]·순서·[찜 된 것만]·빈 화면은 그대로 — 초록·주황은 이제 그 줄 바탕이다. 손님 이름은 글자(Txt)로만 그린다.
// 확인이 필요한 상품(겹침·승계·일시 중지)은 주황 줄 + 쉬운 말. 판매 종료(CLOSED, 소프트 삭제)한 상품은 리스트에 그리지 않는다(D-UX4-28 — 상품 삭제).
// 방금 올라온 상품은 약 5초 연한 초록이었다가 흰색으로 천천히 돌아온다(D-UX4-29 → D-UX4-149). 줄이 생기고 사라지고 커질 때는 부드럽게 움직인다.
// 자세히(아래 판, D-UX4-30, 사용자 지시 2026-11-09): 번호·품종·가격을 한 줄에 점선 둥근 칸으로 — 왼쪽 위 연필. 누르면 반 화면 판에서 고친다(D-UX4-106, ProductEdit).
// 그 아래 찜·대기 손님 이름 알약(위 탭 알약 크기, 넘치면 아랫줄로) — 누르면 "찜을 삭제할까요?" 팝업. 판매 완료·찜 요약·"아직 찜이 없어요"·일시 중지·판매 종료 단추는 없앴고,
// 토스 메뉴 줄로 [판매 시작](공개 전·멈춘 상품만) · [누가 살지 정하기](겹침·승계만) · [🗑 상품 삭제] — 삭제는 "상품을 삭제할까요?" 팝업 [닫기 | 삭제].
// D-UX4-141·142 (사용자 메모 11-13, 개선 계획 E4): 목록 위 [찜 된 것만] 켜고 끄기, 대기가 차 대기 밖이 된 찜도 줄 꼬리표(흐리게)·자세히("대기 밖 n명")에 보인다.
// 목록 위 도구 줄(ProductToolbar — 번호 검색칸 / [찜 된 것만] 걸러 보기 칩 · [목록 순서])은 따로 꺼내 쓸 수 있다(D-UX4-150): ProductList toolbar={false}면 목록만 그린다.
// D-RETRO-54 (복기 F7): 메뉴 줄 [찜 넣기] — 누르면 메뉴 자리에 손님 이름·전화번호 끝 네 자리 칸이 나오고 [닫기 | 찜 넣기]로 그 상품에 문자찜을 넣는다(ClaimAdd). 옵션 상품·끝난 라이브는 없다.
import { displayNickname, productTitle } from '@livejjim/core/format'
import { Fragment, memo, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { Animated, Keyboard, LayoutAnimation, Platform, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import type { Buyer, Claim, Product } from '@livejjim/web/src/api/types.ts'
import { ProductLabelAction, QueueLabelButton } from '../ProductLabelAction.tsx'
import { SearchField } from '../customer-parts.tsx'
import { isApiError } from '../../api/client.ts'
import { boardProducts, claimsOfProduct, productSlots, type BuyerNames } from '../../lib/derive.ts'
import { buyerTagText, type ProductTag } from '../../lib/product-tags.ts'
import { isTentative, tentativeAttention, waitingAt } from '../../lib/tentative.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { DEFAULT_PRODUCT_SORT, PRODUCT_SORTS, SORT_TITLE, sortProducts, sortWord, type ProductSort } from '../../lib/product-sort.ts'
import { NO_PRODUCTS_YET, NO_PRODUCTS_YET_BODY, priceWords } from '../../lib/words.ts'
import { BottomSheet, EmptyFill, ErrorLine, PopupDialog, SheetChoices, Txt, useKit, Tap } from '../../ui/kit/index.ts'
import { GUTTER, RADIUS, SPACE, TOUCH, pressedFill } from '../../ui/kit/tokens.ts'
import { Notice } from '../../ui/parts.tsx'
import { ACTIVE_CLAIM, deleteClaim, deleteProduct } from './claim-actions.ts'
import { CLAIM_ADD, ClaimAddForm, type ClaimAdded } from './ClaimAdd.tsx'
import { feedBuyerName } from './feed-rows.ts'
import { useConsoleApi } from './context.ts'
import { IconMenuRow, NamePill, TRASH_TINT, type PillTone } from './parts.tsx'
import { TentativePanel } from './TentativeCard.tsx'
import { OutsideWait, outsideBuyers, soldOutClaims } from './OutsideWait.tsx'

/**
 * 방금 올라온 상품을 연한 초록으로 두는 시간, 흰색으로 돌아오는 시간 (D-UX4-29).
 * D-UX4-149 (사용자 2026-11-16 "새로 등록된 상품 빛나는 시간이 너무 짧다"): 약 5초 보인 뒤 1초 동안 흐려진다 — 옛 2.5초 + 0.8초
 */
export const FRESH_HOLD_MS = 5000
export const FRESH_FADE_MS = 1000

/** 상품 줄 읽기 글의 나눔 (D-UX4-148): "37 · 라비홍 · 50,000원" — D-UX4-197부터 화면에는 나눔 없이 칸으로 그리고 이 글은 줄의 읽기 이름에만 쓴다 */
export const ROW_JOIN = ' · '

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
/** 상품 줄의 품종: 개수가 2 이상이면 "채홍 3개" (D-PIECES-01) */
export const rowName = (product: Pick<Product, 'name' | 'pieces'>): string => productTitle(product.name, product.pieces)

/** 줄 아래 꼬리표: 1등(금색) → 손님 꼬리표(입금 늦음 주의·단골) → 대기 손님(회색) → 대기 밖 손님(흐리게, D-UX4-142), 순서는 서버 순서 그대로 (D-UX3-78) */
export function rowTags(product: Product, buyerOf: (id: string) => Pick<Buyer, 'kind' | 'phoneLast4'> | undefined, nameOfBuyer: (id: string) => string, badge?: string, outside: readonly string[] = []): { readonly tags: ProductTag[]; readonly keep: number } {
  const slots = productSlots(product)
  const tags: ProductTag[] = slots.winners.map((id) => ({ kind: 'win', text: buyerTagText(buyerOf(id), nameOfBuyer(id), true) }))
  let keep = tags.length === 0 ? 0 : 1
  if (badge !== undefined && tags.length > 0) {
    tags.splice(1, 0, { kind: 'badge', text: badge })
    keep = 2
  }
  for (const id of slots.waitlist) tags.push({ kind: 'wait', text: buyerTagText(buyerOf(id), nameOfBuyer(id), false) })
  for (const id of outside) tags.push({ kind: 'out', text: buyerTagText(buyerOf(id), nameOfBuyer(id), false) })
  return { tags, keep }
}


/** 상품 줄 한 줄 글 (D-UX4-148): 번호 · 품종 · 가격 — 품종이 비면 "37 · 50,000원". D-UX4-197부터 줄 칸(product-row-line)의 읽기 이름 */
export function rowLine(product: Pick<Product, 'no' | 'name' | 'pieces' | 'price'>): string {
  return [String(product.no), rowName(product), priceWords(product.price)].filter((part) => part !== '').join(ROW_JOIN)
}

/**
 * 상품 한 줄 (D-UX3-78 → D-UX4-197): 정산서 상품별 줄처럼 왼쪽 회색 "N번" 표 · 가운데 세로 칸(품종 굵게, 그 바로 아래 손님 금색 캡슐) · 오른쪽 가격.
 * 캡슐은 찜 닉네임(금색, 문자는 "문자-0937") → 대기 손님(회색) → 대기 밖(흐리게) → [+N]. 찜도 대기도 없으면 캡슐 줄을 그리지 않는다.
 * 확인이 필요한 상품은 줄 바탕이 주황이고 캡슐 대신 주황 글 한 줄(품종 아래).
 * freshAt: 방금 올라온 시각(아니면 0) — 그때부터 잠깐 연한 초록, 그 뒤 흰색으로 (D-UX4-29)
 */
const ProductRow = memo(function ProductRow({ product, freshAt, onOpen, doubt, conflicts, waiting, outside, buyers, names }: {
  readonly product: Product
  /** 대기 밖 손님 (D-UX4-142) — 대기 뒤에 흐린 꼬리표 */
  readonly outside: readonly string[]
  readonly freshAt: number
  readonly onOpen: (key: string) => void
  readonly doubt?: string
  readonly conflicts: number
  /** 그 번호로 기다리는 찜 수 — 확인 중 상품의 줄에만 쓴다 (D-RETRO-90) */
  readonly waiting: number
  readonly buyers: ScopeData['buyers']
  readonly names: BuyerNames
}) {
  const { p } = useKit()
  // 확인 중 상품은 주황 줄 "확인 중 · 기다리는 찜 n건 · 눌러서 확정하기" (D-RETRO-90)
  const attention = tentativeAttention(product, waiting) ?? rowAttention(product, conflicts)
  const { tags } = rowTags(product, (id) => buyers.get(id), (id) => names.name(id), undefined, outside)
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
  const name = rowName(product)
  const who = rowBuyerParts(tags)
  return (
    // 꾹 누르면 줄이 통째로 들어간다 (D-UX4-105, 사용자 지시 2026-11-10 "흰색 영역이 통째로 버튼 영역이어야") — 누르는 틀(Tap)이 바깥, 줄 바탕은 그 안.
    // 줄은 흰 화면에 바로 놓인다 — 카드·줄 사이 선 없음 (D-UX4-201). 누름·초록·주황 바탕이 화면 끝까지 닿게 목록 여백만큼 바깥으로 편다
    <Tap
      role="button"
      aria-label={`상품 자세히 — ${String(product.no)}번`}
      testID="product-row"
      onPress={() => { Keyboard.dismiss(); onOpen(product.key) }}
      style={{ marginHorizontal: -GUTTER }}
    >
      {({ pressed }) => (
      <Animated.View testID="product-row-fill" style={{ minHeight: TOUCH.min + SPACE.md, justifyContent: 'center', paddingVertical: ROW_PAD_Y, paddingLeft: GUTTER + ROW_LEFT, paddingRight: GUTTER + ROW_RIGHT, backgroundColor: bg }}>
        {/* 꾹 누르면 토스 줄처럼 줄 안쪽에 둥근 회색 판이 깔리고 줄이 살짝 들어간다 (D-UX4-203; 들어가는 정도는 전역 규칙 D-UX4-202) */}
        {pressed ? <View aria-hidden testID="product-row-pressed" pointerEvents="none" style={{ position: 'absolute', top: SPACE.xs / 2, bottom: SPACE.xs / 2, left: SPACE.sm, right: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressedFill(p, attention !== null ? p.warnBg : p.surface) }} /> : null}
        {/* 토스 거래 내역 줄처럼 (D-UX4-201): 왼쪽 번호(아이콘 자리, 줄 가운데) · 가운데 품종(위)과 찜(아래 회색 한 줄) · 품종 줄 오른쪽 가격 */}
        <View testID="product-row-line" aria-label={rowLine(product)} style={{ flexDirection: 'row', alignItems: 'center', gap: ROW_GAP }}>
          {/* 번호는 토스 줄의 아이콘 자리 — 옅은 회색 둥근 네모 안에 진한 글 (D-UX4-203) */}
          <View aria-hidden testID="product-row-no" style={{ flexShrink: 0, minWidth: NO_SIZE, height: NO_SIZE, paddingHorizontal: SPACE.xs, borderRadius: NO_RADIUS, borderCurve: 'continuous', backgroundColor: p.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Txt step="body" weight="bold" center numberOfLines={1}>{String(product.no)}</Txt>
          </View>
          <View testID="product-row-main" style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
              {/* 품종이 비면 칸만 비운다 — "-"를 쓰지 않는다 (D-UX4-111) */}
              <View {...(name === '' ? {} : { testID: 'product-row-name' })} style={{ flex: 1, minWidth: 0 }}>
                {name === '' ? null : <Txt step="nav" weight="book">{name}</Txt>}
              </View>
              <View testID="product-row-price" style={{ flexShrink: 0 }}>
                {/* 가격이 빈 확인 중 상품은 "가격 듣는 중"을 흐리게 (D-RECOG-22) */}
                <Txt step="nav" weight="medium" right numberOfLines={1} {...(product.price === null ? { ink: p.placeholder } : {})}>{priceWords(product.price)}</Txt>
              </View>
            </View>
            {/* 아랫줄은 토스처럼 윗줄에 바짝 붙는다 (D-UX4-203) */}
            <View style={{ marginTop: SUB_PULL }}>
            {attention !== null ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.xs }}>
                <Txt step="meta" weight="bold" ink={p.warnText}>
                  {attention.who}
                </Txt>
                <Txt step="meta" ink={p.warnText}>
                  {attention.what}
                </Txt>
              </View>
            ) : who.length === 0 ? null : (
              // 찜한 손님 — 회색 글 한 줄(토스 줄의 "내 KB국민은행 계좌" 자리). 1등 · 대기 · 대기 밖(더 옅게) 차례, 길면 두 줄까지
              <Txt step="meta" ink={p.placeholder} numberOfLines={2} role="list" aria-label={`${String(product.no)}번 찜한 손님`} testID="product-row-buyers">
                {who.map((part) => (
                  <Fragment key={part.key}>
                    {part.lead}
                    <Txt step="meta" ink={part.kind === 'out' ? p.iconPressed : p.placeholder} role="listitem" {...(part.kind === 'out' ? { 'aria-label': `${part.name} 대기 밖` } : {})}>{part.name}</Txt>
                  </Fragment>
                ))}
              </Txt>
            )}
            {/* 채팅 의심 표시 (D-V3-129): 자동으로 고치지 않고 판매자가 확인한다 */}
            {doubt === undefined ? null : <Txt step="meta" weight="bold" ink={p.warnText} role="note" aria-label={`번호 확인 — ${String(product.no)}번`}>{doubt}</Txt>}
            </View>
          </View>
        </View>
      </Animated.View>
      )}
    </Tap>
  )
})

/** 번호 네모 크기 — 토스 줄의 아이콘(34~40)과 같은 자리, 세 자리 번호까지 품종 시작 줄이 맞는다 (D-UX4-203) */
const NO_SIZE = 40
/** 번호 네모 모서리 — 토스 아이콘 판처럼 둥근 네모 */
const NO_RADIUS = 12
/** 번호와 품종 사이 — 토스 아이콘과 글 사이 12 */
const ROW_GAP = SPACE.md
/** 줄 안쪽 왼쪽·오른쪽 여백 — 목록 여백(12)에 더해 화면 끝에서 22 · 24 (토스 거래 내역 사진 재기, D-UX4-203) */
const ROW_LEFT = 10
const ROW_RIGHT = 12
/** 줄 위아래 — 줄 간격 63쯤 (토스 62.6) */
const ROW_PAD_Y = 10
/** 아랫줄을 윗줄 쪽으로 당김 — 윗글 머리에서 아랫글 머리까지 20쯤 (토스 20.4) */
const SUB_PULL = -2

/** 찜 손님 한 줄의 조각: 앞 글(이음표·"대기 "·"대기 밖 ") + 이름 */
export interface BuyerPart {
  readonly key: string
  readonly lead: string
  readonly name: string
  readonly kind: ProductTag['kind']
}

/**
 * 찜 손님 한 줄 (D-UX4-201 — 옛 꼬리표 D-UX3-78·D-UX4-197): "가람 · 나무 · 대기 다솜, 라온 · 대기 밖 보람" — 서버 순서 그대로, 줄이지 않는다.
 * 1등(과 손님 꼬리표)은 " · "로, 대기는 "대기 " 뒤에 ", "로, 대기 밖은 "대기 밖 " 뒤에 ", "로 잇는다
 */
export function rowBuyerParts(tags: readonly ProductTag[]): BuyerPart[] {
  const parts: BuyerPart[] = []
  let last: ProductTag['kind'] | null = null
  tags.forEach((tag, index) => {
    const group = tag.kind === 'badge' ? 'win' : tag.kind
    const head = group === 'wait' ? '대기 ' : group === 'out' ? '대기 밖 ' : ''
    const lead = last === null ? head : last === group ? (group === 'win' ? ROW_JOIN : ', ') : `${ROW_JOIN}${head}`
    parts.push({ key: `${tag.kind}-${String(index)}`, lead, name: tag.text, kind: tag.kind })
    last = group
  })
  return parts
}

/** 찜 손님 한 줄 글 (읽기·시험) */
export const rowBuyersText = (tags: readonly ProductTag[]): string => rowBuyerParts(tags).map((part) => part.lead + part.name).join('')

/** 상품 줄이 놓인 화면 요소 (자리를 재는 데 쓴다) */
export type RowNode = ComponentRef<typeof View>

/** 목록 위 걸러 보기 단추 (D-UX4-141) */
export const CLAIMED_ONLY = '찜 된 것만'
/** 찜 된 것만 켰는데 맞는 상품이 없을 때 */
export const NO_CLAIMED_YET = '찜 된 상품이 아직 없어요'

/**
 * 찜 된 상품인가 (D-UX4-141): 살아 있는 찜(1등·대기·겹침·보류)이 하나라도 있거나, 확인 중 상품에 그 번호로 기다리는 찜이 있다.
 * 대기 밖(품절로 끝난) 찜만 있는 상품은 없다 — 대기가 찼다는 것은 1등이 있다는 뜻이다.
 */
export function hasClaims(data: ScopeData, b: string, product: Product): boolean {
  const slots = productSlots(product)
  if (slots.winners.length > 0 || slots.waitlist.length > 0) return true
  if (claimsOfProduct(data, product).some((claim) => ACTIVE_CLAIM.has(claim.status))) return true
  return isTentative(product) && waitingAt(data, b, product.no) > 0
}

/** 번호 검색 (앱 숫자판 — 방송 화면이 열고 닫는다) */
export interface NumberSearch {
  readonly open: () => void
  readonly submit: () => void
}

/** 찾기 칸 보이기 (D-UX4-201) — 라이브 화면은 머리 오른쪽 돋보기를 눌렀을 때(또는 찾는 글이 있을 때)만 칸을 보인다. 기본은 늘 보인다 */
export interface SearchSlot {
  readonly searchShown?: boolean
  /** 칸 바탕 — 흰 화면 위에서는 회색 */
  readonly searchFill?: string
  /** 칸이 나타나자마자 쓸 수 있게 */
  readonly searchFocus?: boolean
  readonly onSearchBlur?: () => void
}

export interface ProductToolbarProps extends SearchSlot {
  /** 번호 검색칸 글 (숫자만) */
  readonly query: string
  readonly onQuery: (value: string) => void
  /** 찜 된 것만 보기 (D-UX4-141). onClaimedOnly가 없으면 칩을 그리지 않는다 */
  readonly claimedOnly?: boolean
  readonly onClaimedOnly?: (on: boolean) => void
  /** 목록 순서 (D-UX4-150) */
  readonly sort: ProductSort
  readonly onSort: (sort: ProductSort) => void
  readonly numberSearch: NumberSearch
}

/**
 * 상품 목록 위 도구 줄 (D-UX4-150): 첫 줄 번호 검색칸, 둘째 줄 왼쪽 [찜 된 것만] 걸러 보기 칩 · 오른쪽 [목록 순서] 단추.
 * 상태는 들지 않는다 — 부르는 쪽(ProductList 또는 방송 화면의 붙는 머리)이 query·claimedOnly·sort를 들고 넘긴다. 순서 고르는 판(아래 창)만 여기서 연다.
 */
export function ProductToolbar({ query, onQuery, claimedOnly = false, onClaimedOnly, sort, onSort, numberSearch, searchShown = true, searchFill, searchFocus, onSearchBlur }: ProductToolbarProps) {
  const [picking, setPicking] = useState(false)
  return (
    <View testID="product-toolbar" style={{ gap: SPACE.sm }}>
      {searchShown ? (
        <View onTouchEnd={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
          <SearchField label="상품 번호 검색" value={query} numberSearch={numberSearch} onChangeText={text => onQuery(text.normalize('NFKC').replace(/\D/g, ''))} {...(searchFill === undefined ? {} : { fill: searchFill })} {...(searchFocus === true ? { autoFocus: true } : {})} {...(onSearchBlur === undefined ? {} : { onBlur: onSearchBlur })} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm }}>
        {onClaimedOnly === undefined ? <View /> : <FilterChip on={claimedOnly} label={CLAIMED_ONLY} onPress={() => { animateNextLayout(); onClaimedOnly(!claimedOnly) }} />}
        <SortButton sort={sort} onPress={() => { Keyboard.dismiss(); setPicking(true) }} />
      </View>
      <BottomSheet visible={picking} onClose={() => setPicking(false)} title={SORT_TITLE}>
        <SheetChoices label={SORT_TITLE} testID="product-sort-choices" choices={SORT_CHOICES} value={sort} onPick={(next) => { setPicking(false); if (next !== sort) { animateNextLayout(); onSort(next) } }} />
      </BottomSheet>
    </View>
  )
}

const SORT_CHOICES = PRODUCT_SORTS.map((value) => ({ value, label: sortWord(value) }))

export interface ProductListProps {
  readonly onOpen: (key: string) => void
  readonly query: string
  readonly onQuery: (value: string) => void
  /** 찜 된 것만 보기 (D-UX4-141) — 방송 화면이 들고 있다("그 상품 보기"에서 푼다) */
  readonly claimedOnly?: boolean
  readonly onClaimedOnly?: (on: boolean) => void
  readonly numberSearch: NumberSearch
  /** 줄이 놓인 자리(상품 열쇠 → 줄) — 방송 화면이 "그 상품 보기"에서 그 줄로 스크롤한다 (D-RETRO-22) */
  readonly onRow?: (key: string, node: RowNode | null) => void
  /** 목록 위 도구 줄(ProductToolbar)을 안에 그릴지 (기본 true). false면 목록만 — 도구 줄은 부르는 쪽이 따로 놓는다 (D-UX4-150) */
  readonly toolbar?: boolean
  /** 목록 순서 (D-UX4-150). 주지 않으면 목록이 스스로 들고 기본은 최근 올린 순 */
  readonly sort?: ProductSort
  readonly onSort?: (sort: ProductSort) => void
}

/**
 * 상품 전체 리스트 — 기본은 가장 최근에 말한(올린) 상품이 맨 위(D-UX3-87), [목록 순서]로 바꾼다 (D-UX4-150).
 * 찜 된 것만(D-UX4-141)·번호 검색과 함께 걸린다 — 번호 검색은 정확히 같은 번호를 맨 위에, 나머지는 고른 순서대로.
 * 처음 받은 상품은 강조하지 않고, 그 뒤에 올라온·고른 상품만 잠깐 초록
 */
export function ProductList({ onOpen, query, onQuery, claimedOnly = false, onClaimedOnly, numberSearch, onRow, toolbar = true, sort: sortProp, onSort }: ProductListProps) {
  const api = useConsoleApi()
  const [ownSort, setOwnSort] = useState<ProductSort>(DEFAULT_PRODUCT_SORT)
  const sort = sortProp ?? ownSort
  const pickSort = (next: ProductSort) => {
    setOwnSort(next)
    onSort?.(next)
  }
  const products = shownProducts(api.data, api.b)
  const claims = api.data.claims
  const conflictCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const claim of claims.values()) {
      if (claim.status === 'CONFLICT') counts.set(claim.product, (counts.get(claim.product) ?? 0) + 1)
    }
    return counts
  }, [claims])
  // 대기 밖 손님 (D-UX4-142) — 같은 손님들이면 앞 배열을 그대로 넘겨 줄(memo)이 괜히 다시 그려지지 않게
  const lastOutside = useRef(new Map<string, readonly string[]>())
  const soldOut = useMemo(() => soldOutClaims({ claims }), [claims])
  const outsideOf = new Map<string, readonly string[]>()
  for (const product of products) {
    const now = outsideBuyers(api.data, product, soldOut)
    if (now.length === 0) continue
    const before = lastOutside.current.get(product.key)
    outsideOf.set(product.key, before !== undefined && before.join('|') === now.join('|') ? before : now)
  }
  lastOutside.current = outsideOf
  const seen = useRef<Map<string, number> | null>(null)
  const lastSelected = useRef<string | null>(api.selected)
  if (seen.current === null) seen.current = new Map(products.map((product) => [product.key, 0]))
  const now = Date.now()
  for (const product of products) if (!seen.current.has(product.key)) seen.current.set(product.key, now)
  if (api.selected !== lastSelected.current) {
    lastSelected.current = api.selected
    if (api.selected !== null && seen.current.has(api.selected)) seen.current.set(api.selected, now)
  }
  const shown = sortProducts(claimedOnly ? products.filter((product) => hasClaims(api.data, api.b, product)) : products, sort)
  useAnimatedChange(shown.map((product) => `${product.key}:${String(productSlots(product).winners.length + productSlots(product).waitlist.length)}:${String(outsideOf.get(product.key)?.length ?? 0)}:${product.conflict ? 1 : 0}`).join('|'))
  if (products.length === 0 && query === '') return <EmptyFill title={NO_PRODUCTS_YET} body={NO_PRODUCTS_YET_BODY} />
  const prefix = query.replace(/^0+(?=\d)/, '')
  const matches = prefix === '' ? shown : shown
    .filter((product) => String(product.no).startsWith(prefix))
    .sort((a, b) => Number(b.no === Number(prefix)) - Number(a.no === Number(prefix)))
  return (
    <View style={{ flexGrow: 1, gap: SPACE.sm }}>
      {toolbar ? <ProductToolbar query={query} onQuery={onQuery} claimedOnly={claimedOnly} {...(onClaimedOnly === undefined ? {} : { onClaimedOnly })} sort={sort} onSort={pickSort} numberSearch={numberSearch} /> : null}
      {matches.length === 0 ? <EmptyFill title={prefix === '' && claimedOnly ? NO_CLAIMED_YET : '해당 번호의 상품이 없어요'} /> : (
        // 흰 화면에 줄을 바로 놓는다 — 카드·줄 사이 선 없이 토스 거래 내역처럼 (D-UX4-201, 옛 D-UX4-197: 한 흰 둥근 카드 안 1px 선)
        <View role="list" aria-label="상품 목록">
          {matches.map((product) => (
            <View key={product.key} collapsable={false} ref={onRow === undefined ? undefined : (node) => onRow(product.key, node)}>
              <ProductRow product={product} freshAt={seen.current?.get(product.key) ?? 0} onOpen={onOpen} buyers={api.data.buyers} names={api.names} conflicts={conflictCounts.get(product.key) ?? 0} outside={outsideOf.get(product.key) ?? NO_OUTSIDE} waiting={isTentative(product) ? waitingAt(api.data, api.b, product.no) : 0} doubt={api.doubts?.get(product.no)} />
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const NO_OUTSIDE: readonly string[] = []

/**
 * 걸러 보기 칩 (D-UX4-141 → D-UX4-148, 사용자 2026-11-16 "탭 알약과 똑같이 생겨 구분이 안 된다"): 탭 알약(알약 모양·흰 바탕/주색 바탕)과 다르게
 * 덜 둥근 네모 테두리 칩. 끄면 바탕 없이 회색 테두리·깔때기·회색 글, 켜면 옅은 주색 바탕·주색 테두리·체크·주색 굵은 글
 */
function FilterChip({ on, label, onPress }: { readonly on: boolean; readonly label: string; readonly onPress: () => void }) {
  const { p } = useKit()
  const ink = on ? p.onSecondary : p.textSub
  return (
    <Tap role="switch" aria-label={label} aria-checked={on} testID="claimed-only-chip" onPress={onPress} hitSlop={4} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2, flexShrink: 1, minHeight: 36, paddingLeft: SPACE.sm + 2, paddingRight: SPACE.md, borderRadius: RADIUS.sm, borderCurve: 'continuous', borderWidth: 1, borderColor: on ? p.primary : p.softPressed, backgroundColor: pressed ? (on ? p.secondaryPressed : p.pressed) : on ? p.secondary : 'transparent' })}>
      <ChipGlyph kind={on ? 'check' : 'funnel'} color={on ? p.primary : p.textSub} />
      <Txt step="body" weight={on ? 'bold' : 'medium'} ink={ink} numberOfLines={1}>{label}</Txt>
    </Tap>
  )
}

/** 칩·순서 단추 앞 작은 그림 (장식 — 이름은 단추가 읽는다) */
function ChipGlyph({ kind, color }: { readonly kind: 'funnel' | 'check' | 'sort'; readonly color: string }) {
  const d = kind === 'funnel' ? 'M4.5 6 H19.5 L14 12.6 V18.2 L10 19.8 V12.6 Z' : kind === 'check' ? 'M5.5 12.6 L10 17 L18.8 7.6' : 'M8 5 V19 M8 5 L4.8 8.2 M8 5 L11.2 8.2 M16 19 V5 M16 19 L12.8 15.8 M16 19 L19.2 15.8'
  return (
    <View aria-hidden testID={`chip-${kind}`} style={{ width: 18, height: 18 }}>
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path d={d} stroke={color} strokeWidth={kind === 'check' ? 2.8 : 2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  )
}

/** [목록 순서] 단추 (D-UX4-150): 위아래 화살표 + 지금 순서 이름 — 누르면 고르는 판 */
function SortButton({ sort, onPress }: { readonly sort: ProductSort; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={`${SORT_TITLE} — ${sortWord(sort)}`} testID="product-sort-button" onPress={onPress} hitSlop={4} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, flexShrink: 0, minHeight: 36, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <ChipGlyph kind="sort" color={p.textSub} />
      <Txt step="body" weight="medium" ink={p.textSub} numberOfLines={1}>{sortWord(sort)}</Txt>
    </Tap>
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
  const tentative = isTentative(product)
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
  const productLine = [`${String(product.no)}번`, rowName(product), priceWords(product.price)].filter((part) => part !== '').join(' ')
  const winnerLabels = api.productLabels?.filter((label) => label.kind === 'product' && label.broadcast === api.b && label.winner && label.claim !== null && claims.some((claim) => claim.id === label.claim)) ?? []
  return (
    <View role="group" aria-label="상품 자세히" style={{ gap: SPACE.lg }}>
      {fields}
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      {/* 확인 중 상품 (D-RETRO-91): 방송 화면 카드와 같은 물음·단추 — [판매 시작]·[상품 삭제] 자리에 확정·거두기. */}
      {/* 끝난 라이브에도 둔다(봉인 전까지) — 라이브가 끝날 때 남은 확인 중 상품의 기다리는 찜을 판매자가 뒤에 정리할 수 있게 */}
      {tentative && !api.sealed ? <TentativePanel product={product} values={false} {...(onDone === undefined ? {} : { onDone })} /> : null}
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
      {/* 대기 밖 n명 (D-UX4-142) — 판정은 그대로, 눌러 흐린 이름을 펼친다 */}
      <OutsideWait key={product.key} product={product} />
      {added !== null ? <Notice tone={added.tone}>{added.text}</Notice> : null}
      {adding && !closed ? (
        <ClaimAddForm product={product} onClose={() => setAdding(false)} onAdded={(line) => { animateNextLayout(); setAdded(line); setAdding(false) }} />
      ) : (
      <View role="group" aria-label="상품 메뉴" style={{ gap: SPACE.xs }}>
        {api.labelsOff ? <Txt color="textSub">라벨을 인쇄하려면 관리에서 ‘라벨 뽑기’를 켜 주세요.</Txt> : null}
        {/* 가격이 빈 상품은 라벨을 뽑지 않는다 — 가격 자리를 비우거나 0원으로 찍지 않게 (D-RECOG-22) */}
        {api.productLabels !== undefined && productSlots(product).winnerClaims.length === 0 && product.price !== null ? (
          <QueueLabelButton key={`${product.id}:${copy}`} action="direct" title="상품 라벨 인쇄" disabled={false}
            body={{ b: api.b, no: product.no, name: product.name, price: product.price }} onQueued={() => setCopy((n) => n + 1)} />
        ) : null}
        {/* 가격·품종을 고쳐 뽑아 둔 라벨과 달라졌으면 먼저 알린다 (D-RETRO-20) — 서버가 "재출력 필요"로 본 라벨 */}
        {winnerLabels.some((label) => label.reprintNeeded && label.canReprint) ? <Txt step="caption" weight="bold" color="warnText" role="note">{REPRINT_HINT}</Txt> : null}
        {winnerLabels.map((label) => (
          <ProductLabelAction key={label.key} label={label} title={`${label.buyer.kind === 'youtube' ? displayNickname(label.buyer.name, api.names.hideSuffix) : '문자찜'} · ${label.canPrint ? '라벨 인쇄' : '라벨 다시 인쇄'}`} />
        ))}
        {!closed && !tentative && (product.status === 'READY' || product.status === 'HOLD') ? <IconMenuRow emoji="▶️" tint="#E6F2EB" title="판매 시작" ariaLabel={`판매 시작 — ${String(product.no)}번`} onPress={() => void open()} /> : null}
        {!closed && !product.hasOptions ? <IconMenuRow emoji="✍️" tint="#F8E3A3" title={CLAIM_ADD} ariaLabel={`${CLAIM_ADD} — ${String(product.no)}번`} onPress={() => { setError(null); setAdded(null); setAdding(true) }} /> : null}
        {undecided(product) && onDecide !== undefined ? <IconMenuRow emoji="🙋" tint="#FFF4E5" title="누가 살지 정하기" onPress={onDecide} /> : null}
        {/* 확인 중 상품은 삭제(판매 종료 — 기다리던 찜이 "판매 중 아님"으로 끝난다) 대신 위 [거두기](찜은 그대로 남는다) */}
        {!closed && !tentative ? <IconMenuRow emoji="🗑️" tint={TRASH_TINT} title="상품 삭제" ariaLabel={`상품 삭제 — ${String(product.no)}번`} onPress={() => setAskProduct(true)} /> : null}
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
