// 현재 상품·상품 보드 (AC-S05-14, PRD-04, D-088). 값은 서버 조회(코어 조회 함수 결과) 그대로이고 낱말로만 바꾼다 — 앱은 판정하지 않는다.
// 상태는 색 + 글자: 1등 · 대기 n번 · 보류 · 충돌 · 품절(거절 사유). 라벨 상태 낱말은 서버 출력 기록(리허설은 없음).
import { useState } from 'react'
import { View } from 'react-native'
import type { Claim, Product } from '@livejjim/web/src/api/types.ts'
import { isApiError } from '../../api/client.ts'
import { boardProducts, claimWord, claimsOfProduct, nameOf, productSlots } from '../../lib/derive.ts'
import { CURRENT_PRODUCT, NO_PRODUCTS_YET, PRODUCT_STATUS_WORD, formatWon } from '../../lib/words.ts'
import type { Tone } from '../../ui/theme.ts'
import { BigButton, Body, Card, Hint, Notice, Row, SectionTitle, Tag } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'

const STATUS_TONE: Readonly<Record<Product['status'], Tone>> = { READY: 'info', OPEN: 'success', SOLD: 'warning', HOLD: 'warning', CLOSED: 'info' }

function claimTone(claim: Claim): Tone {
  if (claim.status === 'CONFIRMED') return 'success'
  if (claim.status === 'CONFLICT') return 'danger'
  if (claim.status === 'WAITLISTED' || claim.status === 'PENDING') return 'info'
  return 'warning'
}

/** 상품 한 줄 요약: 번호·품종·가격·상태·1등·대기 수 */
export function productSummary(product: Product, nameOfBuyer: (id: string) => string): string {
  const slots = productSlots(product)
  const winners = product.hasOptions ? '변형별' : slots.winners.length === 0 ? '아직 없음' : slots.winners.map(nameOfBuyer).join(', ')
  return `${String(product.no)}번 ${nameOf(product)} ${formatWon(product.price)} · ${PRODUCT_STATUS_WORD[product.status]} · 1등 ${winners} · 대기 ${String(slots.waitlist.length)}명`
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
    <>
      <Row wrap>
        {product.status === 'READY' || product.status === 'HOLD' ? <BigButton small label="판매 시작" ariaLabel={`판매 시작 — ${String(product.no)}번`} disabled={busy} onPress={() => send('product.open')} /> : null}
        {product.status === 'OPEN' ? <BigButton small label="일시 중지" ariaLabel={`일시 중지 — ${String(product.no)}번`} disabled={busy} onPress={() => send('product.hold')} /> : null}
        {product.status !== 'CLOSED' ? <BigButton small label="판매 종료" ariaLabel={`판매 종료 — ${String(product.no)}번`} disabled={busy} onPress={() => send('product.close')} /> : null}
      </Row>
      {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
    </>
  )
}

/** 현재 상품을 크게 (AC-S05-14) */
export function CurrentProduct({ product }: { readonly product: Product | undefined }) {
  const api = useConsoleApi()
  return (
    <Card label={CURRENT_PRODUCT}>
      <SectionTitle>{CURRENT_PRODUCT}</SectionTitle>
      {product === undefined ? (
        <Body>{NO_PRODUCTS_YET}</Body>
      ) : (
        <>
          <Body big bold>{`${String(product.no)}번 ${nameOf(product)}`}</Body>
          <Row wrap>
            <Body big>{formatWon(product.price)}</Body>
            <Tag tone={STATUS_TONE[product.status]}>{PRODUCT_STATUS_WORD[product.status]}</Tag>
            {product.stock > 1 ? <Body muted>{`재고 ${String(product.stock)}`}</Body> : null}
          </Row>
          <Hint>{productSummary(product, (id) => api.names.name(id))}</Hint>
          <ClaimLines product={product} />
          <ProductActions product={product} />
        </>
      )}
    </Card>
  )
}

/** 상품 보드: 가장 최근 등록 순. 누르면 현재 상품 칸에 크게 */
export function ProductBoard() {
  const api = useConsoleApi()
  const products = boardProducts(api.data, api.b)
  if (products.length === 0) return null
  return (
    <View role="list" aria-label="상품 보드" style={{ gap: 8 }}>
      <SectionTitle>상품 보드</SectionTitle>
      {products.map((product) => (
        <Row key={product.key} wrap>
          <Tag tone={STATUS_TONE[product.status]}>{PRODUCT_STATUS_WORD[product.status]}</Tag>
          <BigButton small label={productSummary(product, (id) => api.names.name(id))} ariaLabel={`상품 자세히 — ${String(product.no)}번`} onPress={() => api.select(product.key)} />
        </Row>
      ))}
    </View>
  )
}
