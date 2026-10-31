// 방송 중 상품 리스트·상품 자세히 (D-UX2-03, AC-S05-14, PRD-04, D-088). 값은 서버 조회(코어 조회 함수 결과) 그대로이고 낱말로만 바꾼다 — 앱은 판정하지 않는다.
// 리스트: 최신이 위. 첫째 줄 번호·품종·가격을 크게, 둘째 줄 "예약 {1등} · 대기 n명". 확인이 필요한 상품(충돌·승계·일시 중지)은 주황 줄 + 쉬운 말,
// 방금 올라온 상품(가장 최근 등록 또는 방금 고른 상품)은 연한 초록. 줄을 누르면 자세히(찜 목록·판매 시작/중지/종료) 시트가 열린다.
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import type { Claim, Product } from '@livejjim/web/src/api/types.ts'
import { isApiError } from '../../api/client.ts'
import { openWeb } from '../../lib/open-web.ts'
import { boardProducts, claimWord, claimsOfProduct, nameOf, productSlots } from '../../lib/derive.ts'
import { NO_PRODUCTS_YET, PRODUCT_STATUS_WORD, formatWon } from '../../lib/words.ts'
import type { Tone } from '../../ui/theme.ts'
import { BigButton, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { Body, Hint, Notice, Row, Tag } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'

const STATUS_TONE: Readonly<Record<Product['status'], Tone>> = { READY: 'info', OPEN: 'success', SOLD: 'warning', HOLD: 'warning', CLOSED: 'info' }

function claimTone(claim: Claim): Tone {
  if (claim.status === 'CONFIRMED') return 'success'
  if (claim.status === 'CONFLICT') return 'danger'
  if (claim.status === 'WAITLISTED' || claim.status === 'PENDING') return 'info'
  return 'warning'
}

/** 상품 한 줄 요약: 번호·품종·가격·상태·1등·대기 수 (보조 기술용 이름·자세히 시트) */
export function productSummary(product: Product, nameOfBuyer: (id: string) => string): string {
  const slots = productSlots(product)
  const winners = product.hasOptions ? '변형별' : slots.winners.length === 0 ? '아직 없음' : slots.winners.map(nameOfBuyer).join(', ')
  return `${String(product.no)}번 ${nameOf(product)} ${formatWon(product.price)} · ${PRODUCT_STATUS_WORD[product.status]} · 1등 ${winners} · 대기 ${String(slots.waitlist.length)}명`
}

export interface RowWords {
  /** 둘째 줄 앞 (굵게) */
  readonly who: string
  /** 둘째 줄 뒤 (보조 글) */
  readonly wait: string
  /** 확인이 필요한 줄 (주황) */
  readonly attention: boolean
  /** 아직 예약 없음 (회색) */
  readonly empty: boolean
}

/** 리스트 둘째 줄 낱말 (D-UX2-03). 판정 결과(1등·대기·충돌·승계)는 서버 값 그대로 쓴다. */
export function rowWords(product: Product, conflictClaims: number, nameOfBuyer: (id: string) => string): RowWords {
  const slots = productSlots(product)
  if (slots.conflict || conflictClaims > 0) return { who: conflictClaims > 1 ? `예약 ${String(conflictClaims)}명이 겹쳐요` : '예약이 겹쳐요', wait: '· 눌러서 정하기', attention: true, empty: false }
  if (slots.awaitingSuccession) return { who: '다음 손님을 정해야 해요', wait: '· 눌러서 정하기', attention: true, empty: false }
  if (product.status === 'HOLD') return { who: '잠시 멈춘 상품이에요', wait: '· 눌러서 다시 열기', attention: true, empty: false }
  const wait = slots.waitlist.length === 0 ? '· 대기 없음' : `· 대기 ${String(slots.waitlist.length)}명`
  const prefix = product.status === 'CLOSED' ? '판매 끝 · ' : product.status === 'READY' ? '공개 전 · ' : ''
  if (slots.winners.length === 0) return { who: `${prefix}아직 예약 없음`, wait: slots.waitlist.length === 0 ? '' : wait, attention: false, empty: true }
  const first = nameOfBuyer(slots.winners[0]!)
  const more = slots.winners.length > 1 ? ` 외 ${String(slots.winners.length - 1)}명` : ''
  return { who: `${prefix}예약 ${first}${more}`, wait, attention: false, empty: false }
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
            <Tag tone={claimTone(claim)}>{claimWord(api.data, claim)}</Tag>
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

/** 상품 자세히 (시트 안): 가격·상태·찜 목록·판매 조작. 충돌·승계를 정하는 일은 웹과 같은 서버 처리 화면에서 한다. */
export function ProductDetail({ product }: { readonly product: Product }) {
  const api = useConsoleApi()
  return (
    <View role="group" aria-label="상품 자세히" style={{ gap: SPACE.md }}>
      <Row wrap>
        <Txt step="title" weight="heavy">
          {formatWon(product.price)}
        </Txt>
        <Tag tone={STATUS_TONE[product.status]}>{PRODUCT_STATUS_WORD[product.status]}</Tag>
        {product.stock > 1 ? <Body muted>{`재고 ${String(product.stock)}`}</Body> : null}
      </Row>
      <Hint>{productSummary(product, (id) => api.names.name(id))}</Hint>
      <ClaimLines product={product} />
      {productSlots(product).conflict || productSlots(product).awaitingSuccession ? (
        <BigButton kind="secondary" label="누가 살지 정하기 (웹으로 열기)" onPress={() => void openWeb(`/broadcasts/${encodeURIComponent(api.b)}`)} />
      ) : null}
      <ProductActions product={product} />
    </View>
  )
}

function ProductRow({ product, fresh, onOpen }: { readonly product: Product; readonly fresh: boolean; readonly onOpen: () => void }) {
  const { p } = useKit()
  const api = useConsoleApi()
  const conflicts = claimsOfProduct(api.data, product).filter((claim) => claim.status === 'CONFLICT').length
  const words = rowWords(product, conflicts, (id) => api.names.name(id))
  const bg = words.attention ? p.warnBg : fresh ? p.freshBg : p.surface
  const whoInk = words.attention ? p.warnText : words.empty ? p.textSub : p.text
  const dim = product.status === 'CLOSED'
  return (
    <Pressable
      role="button"
      aria-label={`상품 자세히 — ${String(product.no)}번`}
      onPress={onOpen}
      style={({ pressed }) => ({ gap: 6, paddingVertical: 14, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.lg, backgroundColor: bg, opacity: pressed ? 0.7 : dim ? 0.6 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <Txt step="title" weight="heavy">{`${String(product.no)}번`}</Txt>
        <View style={{ flex: 1 }}>
          <Txt step="lead" weight="heavy" numberOfLines={1}>
            {nameOf(product)}
          </Txt>
        </View>
        <Txt step="lead" weight="heavy">
          {formatWon(product.price)}
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm }}>
        <Txt weight="bold" ink={whoInk}>
          {words.who}
        </Txt>
        {words.wait === '' ? null : <Txt ink={words.attention ? p.warnText : p.textSub}>{words.wait}</Txt>}
      </View>
    </Pressable>
  )
}

/** 상품 전체 리스트 (최신이 위) */
export function ProductList({ onOpen }: { readonly onOpen: (key: string) => void }) {
  const api = useConsoleApi()
  const products = boardProducts(api.data, api.b)
  if (products.length === 0) return <Txt color="textSub">{NO_PRODUCTS_YET}</Txt>
  const freshKey = api.selected !== null && api.data.products.has(api.selected) ? api.selected : products[0]?.key
  return (
    <View role="list" aria-label="상품 목록" style={{ gap: SPACE.sm }}>
      {products.map((product) => (
        <ProductRow key={product.key} product={product} fresh={product.key === freshKey} onOpen={() => onOpen(product.key)} />
      ))}
    </View>
  )
}
