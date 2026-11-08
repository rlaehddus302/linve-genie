// 방송 중 상품 리스트·상품 자세히 (D-UX2-03, AC-S05-14, PRD-04, D-088). 값은 서버 조회(코어 조회 함수 결과) 그대로이고 낱말로만 바꾼다 — 앱은 판정하지 않는다.
// 리스트: 최신이 아래(D-UX3-75). 첫째 줄 번호·품종·가격을 한 크기로, 그 아래 [찜 닉네임]·대기 손님 꼬리표 한 줄(D-UX3-78). 확인이 필요한 상품(겹침·승계·일시 중지)은 주황 줄 + 쉬운 말,
// 자세히 시트도 같은 말(찜·겹쳐요)을 쓰고, 정하지 않은 상품은 "판매 완료"·"1등" 대신 "아직 안 정했어요"로 보인다(D-UX2-07).
// 방금 올라온 상품(가장 최근 등록 또는 방금 고른 상품)은 연한 초록. 줄을 누르면 자세히(찜 목록·판매 시작/중지/종료) 시트가 열린다.
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import type { Buyer, Claim, Product } from '@livejjim/web/src/api/types.ts'
import { isApiError } from '../../api/client.ts'
import { useWinnerBadges } from '../../lib/customer-badges.ts'
import { boardProducts, claimWord, claimsOfProduct, nameOf, productSlots } from '../../lib/derive.ts'
import { TAG_GAP, TAG_PAD_X, buyerTagText, fitTags, type ProductTag } from '../../lib/product-tags.ts'
import { NO_PRODUCTS_YET, PRODUCT_STATUS_WORD, formatWon } from '../../lib/words.ts'
import type { Tone } from '../../ui/theme.ts'
import { BigButton, Txt, useKit } from '../../ui/kit/index.ts'
import { MAX_FONT_SCALE, RADIUS, SPACE, TYPE, pressedFill } from '../../ui/kit/tokens.ts'
import { Body, Hint, Notice, Row, Tag } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'

const STATUS_TONE: Readonly<Record<Product['status'], Tone>> = { READY: 'info', OPEN: 'success', SOLD: 'warning', HOLD: 'warning', CLOSED: 'info' }

function claimTone(claim: Claim, conflict: boolean): Tone {
  // 겹침은 잘못이 아니라 정할 일이다 — 보드의 주황 줄과 같은 색
  if (claim.status === 'CONFIRMED') return conflict ? 'warning' : 'success'
  if (claim.status === 'CONFLICT') return 'warning'
  if (claim.status === 'WAITLISTED' || claim.status === 'PENDING') return 'info'
  return 'warning'
}

/** 상품 한 줄 요약: 번호·품종·가격·상태·1등·대기 수 (보조 기술용 이름) */
export function productSummary(product: Product, nameOfBuyer: (id: string) => string): string {
  const slots = productSlots(product)
  const winners = product.hasOptions ? '변형별' : slots.winners.length === 0 ? '아직 없음' : slots.winners.map(nameOfBuyer).join(', ')
  return `${String(product.no)}번 ${nameOf(product)} ${formatWon(product.price)} · ${PRODUCT_STATUS_WORD[product.status]} · 1등 ${winners} · 대기 ${String(slots.waitlist.length)}명`
}

/** 아직 정하지 않은 상품 (겹침·다음 손님 정하기) — 시트는 "판매 완료"·"1등"처럼 끝난 말을 쓰지 않는다 (D-UX2-07) */
export function undecided(product: Product): boolean {
  const slots = productSlots(product)
  return slots.conflict || slots.awaitingSuccession
}

/** 자세히 시트의 상태 배지 낱말: 정하지 않았으면 "아직 안 정했어요", 아니면 상품 상태 낱말 */
export function sheetStatusWord(product: Product): string {
  return undecided(product) ? '아직 안 정했어요' : PRODUCT_STATUS_WORD[product.status]
}

/** 자세히 시트의 찜 낱말 — 보드와 같은 말: 1등은 "찜"(D-UX3-78, 옛 "예약"), 겹친 상품의 1등·겹친 찜은 "겹침" (판정 값은 그대로, 낱말만) */
export function sheetClaimWord(base: string, claim: Claim, product: Product): string {
  if (claim.status === 'CONFLICT') return '겹침'
  if (claim.status === 'CONFIRMED') return productSlots(product).conflict ? '겹침' : '찜'
  return base
}

/** 자세히 시트 요약 한 줄 (제목·가격을 되풀이하지 않는다). 찜도 대기도 없으면 null — 찜 목록이 "아직 찜이 없어요"를 말한다 */
export function sheetSummary(product: Product, conflictClaims: number, nameOfBuyer: (id: string) => string): string | null {
  const slots = productSlots(product)
  if (slots.conflict || conflictClaims > 0) return '찜이 겹쳐서 정해야 해요.'
  if (slots.awaitingSuccession) return '다음 손님을 정해야 해요.'
  const attention = rowAttention(product, conflictClaims)
  if (attention !== null) return attention.who
  const parts: string[] = []
  if (slots.winners.length > 0) parts.push(`찜 ${nameOfBuyer(slots.winners[0]!)}${slots.winners.length > 1 ? ` 외 ${String(slots.winners.length - 1)}명` : ''}`)
  if (slots.waitlist.length > 0) parts.push(`대기 ${String(slots.waitlist.length)}명`)
  return parts.length === 0 ? null : parts.join(' · ')
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

/** 줄 첫째 줄의 품종 — 비어 있으면 "-" (D-UX3-78, 사용자 지시 "품종 미입력 이렇게 하지 말고 그냥 -") */
export const rowName = (product: Pick<Product, 'name'>): string => (product.name.trim() === '' ? '-' : product.name)

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

function ClaimLines({ product }: { readonly product: Product }) {
  const api = useConsoleApi()
  const claims = claimsOfProduct(api.data, product).filter((claim) => claim.status !== 'CANCELLED' && claim.status !== 'DUPLICATE')
  if (claims.length === 0) return <Hint>아직 찜이 없어요.</Hint>
  return (
    <View role="list" aria-label={`${String(product.no)}번 찜`} style={{ gap: 4 }}>
      {claims.slice(0, 12).map((claim) => {
        const label = api.labelWords.get(claim.id)
        return (
          <Row key={claim.id} wrap>
            <Tag tone={claimTone(claim, productSlots(product).conflict)}>{sheetClaimWord(claimWord(api.data, claim), claim, product)}</Tag>
            <Body>{api.names.name(claim.currentBuyer)}</Body>
            {claim.variant !== null ? <Body muted>{claim.variant}</Body> : null}
            {claim.qty > 1 ? <Body muted>{`${String(claim.qty)}개`}</Body> : null}
            {label !== undefined && label !== '' ? <Tag tone="info">{label}</Tag> : null}
          </Row>
        )
      })}
      {claims.length > 12 ? <Hint>{`그 밖 ${String(claims.length - 12)}건`}</Hint> : null}
    </View>
  )
}

function ProductActions({ product }: { readonly product: Product }) {
  const api = useConsoleApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (api.ended || api.sealed) return null
  const send = (type: 'product.open' | 'product.hold' | 'product.close') => {
    setBusy(true)
    setError(null)
    api.command({ type, b: api.b, no: product.no }).then(
      () => setBusy(false),
      (caught: unknown) => {
        setBusy(false)
        setError(isApiError(caught) ? caught.message : '보내지 못했어요. 다시 눌러 주세요.')
      },
    )
  }
  return (
    <View style={{ gap: SPACE.sm }}>
      {product.status === 'READY' || product.status === 'HOLD' ? <BigButton label="판매 시작" ariaLabel={`판매 시작 — ${String(product.no)}번`} disabled={busy} onPress={() => send('product.open')} /> : null}
      {product.status === 'OPEN' ? <BigButton kind="secondary" label="일시 중지" ariaLabel={`일시 중지 — ${String(product.no)}번`} disabled={busy} onPress={() => send('product.hold')} /> : null}
      {product.status !== 'CLOSED' ? <BigButton kind="outline" label="판매 종료" ariaLabel={`판매 종료 — ${String(product.no)}번`} disabled={busy} onPress={() => send('product.close')} /> : null}
      {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
    </View>
  )
}

/** 상품 자세히 (시트 안): 가격·상태·찜 목록·판매 조작. 겹침·승계는 "누가 살지 정하기"가 방송 화면의 정하기 창을 그 상품으로 연다(D-APPX-03). */
export function ProductDetail({ product, onDecide }: { readonly product: Product; readonly onDecide?: () => void }) {
  const api = useConsoleApi()
  const open = undecided(product)
  const conflicts = claimsOfProduct(api.data, product).filter((claim) => claim.status === 'CONFLICT').length
  const summary = sheetSummary(product, conflicts, (id) => api.names.name(id))
  return (
    <View role="group" aria-label="상품 자세히" style={{ gap: SPACE.md }}>
      <Row wrap>
        <Txt step="title" weight="heavy">
          {formatWon(product.price)}
        </Txt>
        <Tag tone={open ? 'warning' : STATUS_TONE[product.status]}>{sheetStatusWord(product)}</Tag>
        {product.stock > 1 ? <Body muted>{`재고 ${String(product.stock)}`}</Body> : null}
      </Row>
      {summary === null ? null : open ? <Notice tone="warning">{summary}</Notice> : <Hint>{summary}</Hint>}
      <ClaimLines product={product} />
      {open ? (
        <View style={{ gap: SPACE.xs }}>
          {onDecide !== undefined ? <BigButton kind="secondary" label="누가 살지 정하기" onPress={onDecide} /> : <Hint>판매자 계정에서 정할 수 있어요.</Hint>}
        </View>
      ) : null}
      <ProductActions product={product} />
    </View>
  )
}

const BADGE_TONE = (badge: string): Tone => (badge === '입금 늦음 주의' ? 'warning' : badge.startsWith('단골') ? 'success' : 'info')

/**
 * 상품 한 줄 (D-UX3-78): 첫째 줄 번호·품종·가격을 한 크기로, 그 아래 꼬리표 한 줄 — [찜 닉네임](금색, 문자찜은 [문자찜 0937]) → 대기 손님(회색) → [+N].
 * 찜도 대기도 없으면 아래 줄을 그리지 않는다. 확인이 필요한 상품은 꼬리표 대신 주황 글 한 줄.
 */
function ProductRow({ product, fresh, onOpen, badge, doubt }: { readonly product: Product; readonly fresh: boolean; readonly onOpen: () => void; readonly badge?: string; readonly doubt?: string }) {
  const { p, tones, fontScale } = useKit()
  const api = useConsoleApi()
  const [width, setWidth] = useState(0)
  const conflicts = claimsOfProduct(api.data, product).filter((claim) => claim.status === 'CONFLICT').length
  const attention = rowAttention(product, conflicts)
  const { tags, keep } = rowTags(product, (id) => api.data.buyers.get(id), (id) => api.names.name(id), badge)
  const fit = fitTags(tags, width, TYPE.note * Math.min(fontScale, MAX_FONT_SCALE), keep)
  const bg = attention !== null ? p.warnBg : fresh ? p.freshBg : p.surface
  const dim = product.status === 'CLOSED'
  const tagStyle = (fill: string) => ({ flexShrink: 0, paddingHorizontal: TAG_PAD_X, paddingVertical: 2, borderRadius: RADIUS.pill, borderCurve: 'continuous' as const, backgroundColor: fill })
  return (
    <Pressable
      role="button"
      aria-label={`상품 자세히 — ${String(product.no)}번`}
      onPress={onOpen}
      style={({ pressed }) => ({ gap: SPACE.xs, paddingVertical: 10, paddingHorizontal: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? pressedFill(p, bg) : bg, opacity: dim ? 0.6 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm }}>
        <Txt weight="heavy">{`${String(product.no)}번`}</Txt>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" numberOfLines={1}>
            {rowName(product)}
          </Txt>
        </View>
        <Txt weight="bold">{formatWon(product.price)}</Txt>
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
            const pair = tag.kind === 'badge' ? tones[BADGE_TONE(tag.text)] : null
            const fill = tag.kind === 'win' ? p.goldBg : pair !== null ? pair.bg : p.soft
            const ink = tag.kind === 'win' ? p.goldText : pair !== null ? pair.fg : p.textSub
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
    </Pressable>
  )
}

/** 상품 전체 리스트 — 라이브 채팅처럼 최신이 맨 아래 (D-UX3-75) */
export function ProductList({ onOpen }: { readonly onOpen: (key: string) => void }) {
  const api = useConsoleApi()
  const products = boardProducts(api.data, api.b)
  // 1등 옆 손님 꼬리표 (CR-7) — 첫 1등만 (줄에 보이는 이름)
  const badges = useWinnerBadges(api.data.date, api.data.rehearsal, products.flatMap((product) => productSlots(product).winners.slice(0, 1)))
  if (products.length === 0) return <Txt color="textSub">{NO_PRODUCTS_YET}</Txt>
  const freshKey = api.selected !== null && api.data.products.has(api.selected) ? api.selected : products[0]?.key
  return (
    <View role="list" aria-label="상품 목록" style={{ gap: SPACE.xs }}>
      {[...products].reverse().map((product) => (
        <ProductRow key={product.key} product={product} fresh={product.key === freshKey} onOpen={() => onOpen(product.key)} badge={badges.get(productSlots(product).winners[0] ?? '')} doubt={api.doubts?.get(product.no)} />
      ))}
    </View>
  )
}
