// 방송 중 상품 리스트·상품 자세히 (D-UX2-03, AC-S05-14, PRD-04, D-088). 값은 서버 조회(코어 조회 함수 결과) 그대로이고 낱말로만 바꾼다 — 앱은 판정하지 않는다.
// 리스트: 가장 최근에 올린 상품이 위(D-UX3-87). 첫째 줄 번호·품종·가격을 한 크기로, 그 아래 손님 닉네임 꼬리표 한 줄(D-UX3-78 → D-UX4-24 닉네임만, 문자는 "문자-0937").
// 확인이 필요한 상품(겹침·승계·일시 중지)은 주황 줄 + 쉬운 말. 판매 종료(CLOSED, 소프트 삭제)한 상품은 리스트에 그리지 않는다(D-UX4-28 — 상품 삭제).
// 방금 올라온 상품은 잠깐 연한 초록이었다가 흰색으로 천천히 돌아온다(D-UX4-29). 줄이 생기고 사라지고 커질 때는 부드럽게 움직인다.
// 자세히(아래 판, D-UX4-30, 사용자 지시 2026-11-09): 번호·품종·가격을 한 줄에 점선 둥근 칸으로 — 왼쪽 위 연필, 누르면 그 자리에서 바로 고친다.
// 그 아래 찜·대기 손님 이름 알약(위 탭 알약 크기, 넘치면 아랫줄로) — 누르면 "찜을 삭제할까요?" 팝업. 판매 완료·찜 요약·"아직 찜이 없어요"·일시 중지·판매 종료 단추는 없앴고,
// 토스 메뉴 줄로 [판매 시작](공개 전·멈춘 상품만) · [누가 살지 정하기](겹침·승계만) · [🗑 상품 삭제] — 삭제는 "상품을 삭제할까요?" 팝업 [닫기 | 삭제].
import { useEffect, useRef, useState } from 'react'
import { Animated, LayoutAnimation, Platform, Pressable, TextInput, View } from 'react-native'
import type { Buyer, Claim, Product } from '@livejjim/web/src/api/types.ts'
import { isApiError } from '../../api/client.ts'
import { boardProducts, claimsOfProduct, productKey, productSlots } from '../../lib/derive.ts'
import { TAG_GAP, TAG_PAD_X, buyerTagText, fitTags, type ProductTag } from '../../lib/product-tags.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { NO_PRODUCTS_YET, formatWon } from '../../lib/words.ts'
import { ErrorLine, Icon, PopupDialog, Txt, font, useKit } from '../../ui/kit/index.ts'
import { MAX_FONT_SCALE, RADIUS, SPACE, TYPE, WEIGHT, pressedFill } from '../../ui/kit/tokens.ts'
import { ACTIVE_CLAIM, deleteClaim, deleteProduct } from './claim-actions.ts'
import { feedBuyerName } from './ClaimFeed.tsx'
import { useConsoleApi } from './context.ts'
import { IconMenuRow, NamePill, TRASH_TINT, type PillTone } from './parts.tsx'

/** 방금 올라온 상품을 연한 초록으로 두는 시간, 흰색으로 돌아오는 시간 (D-UX4-29) */
export const FRESH_HOLD_MS = 2500
export const FRESH_FADE_MS = 800

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


/**
 * 상품 한 줄 (D-UX3-78): 첫째 줄 번호·품종·가격을 한 크기(16, D-UX3-84)로, 그 아래 꼬리표 한 줄 — 찜 닉네임(금색, 문자는 "문자-0937") → 대기 손님(회색) → [+N].
 * 찜도 대기도 없으면 아래 줄을 그리지 않는다. 확인이 필요한 상품은 꼬리표 대신 주황 글 한 줄.
 * freshAt: 방금 올라온 시각(아니면 0) — 그때부터 잠깐 연한 초록, 그 뒤 흰색으로 (D-UX4-29)
 */
function ProductRow({ product, freshAt, onOpen, doubt }: { readonly product: Product; readonly freshAt: number; readonly onOpen: () => void; readonly doubt?: string }) {
  const { p, fontScale } = useKit()
  const api = useConsoleApi()
  const [width, setWidth] = useState(0)
  const conflicts = claimsOfProduct(api.data, product).filter((claim) => claim.status === 'CONFLICT').length
  const attention = rowAttention(product, conflicts)
  const { tags, keep } = rowTags(product, (id) => api.data.buyers.get(id), (id) => api.names.name(id))
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
    <Animated.View style={{ borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: bg, overflow: 'hidden' }}>
      <Pressable
        role="button"
        aria-label={`상품 자세히 — ${String(product.no)}번`}
        onPress={onOpen}
        style={({ pressed }) => ({ gap: SPACE.xs, paddingVertical: 10, paddingHorizontal: SPACE.md, backgroundColor: pressed ? pressedFill(p, attention !== null ? p.warnBg : p.surface) : 'transparent' })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm }}>
          <Txt step="bodyLarge" weight="heavy">{`${String(product.no)}번`}</Txt>
          <View style={{ flex: 1 }}>
            <Txt step="bodyLarge" weight="bold" numberOfLines={1}>
              {rowName(product)}
            </Txt>
          </View>
          <Txt step="bodyLarge" weight="bold">{formatWon(product.price)}</Txt>
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
      </Pressable>
    </Animated.View>
  )
}

/** 상품 전체 리스트 — 가장 최근에 말한(올린) 상품이 맨 위 (D-UX3-87). 처음 받은 상품은 강조하지 않고, 그 뒤에 올라온·고른 상품만 잠깐 초록 */
export function ProductList({ onOpen }: { readonly onOpen: (key: string) => void }) {
  const api = useConsoleApi()
  const products = shownProducts(api.data, api.b)
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
  if (products.length === 0) return <Txt color="textSub">{NO_PRODUCTS_YET}</Txt>
  return (
    <View role="list" aria-label="상품 목록" style={{ gap: SPACE.xs }}>
      {products.map((product) => (
        <ProductRow key={product.key} product={product} freshAt={seen.current?.get(product.key) ?? 0} onOpen={() => onOpen(product.key)} doubt={api.doubts?.get(product.no)} />
      ))}
    </View>
  )
}

/** 점선 둥근 칸 하나 (D-UX4-30): 왼쪽 위 작은 연필, 누르면 그 자리에서 고친다. 다 쓰고 나가면(다른 곳 누름·완료) 보낸다 */
function EditBox({ label, shown, raw, numeric, flex, maxLength, disabled, onSave }: { readonly label: string; readonly shown: string; readonly raw: string; readonly numeric: boolean; readonly flex: number; readonly maxLength: number; readonly disabled: boolean; readonly onSave: (text: string) => Promise<void> }) {
  const { p } = useKit()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(raw)
  const [busy, setBusy] = useState(false)
  const done = useRef(false)
  const commit = () => {
    if (done.current) return
    done.current = true
    setEditing(false)
    const next = text.trim()
    if (next === raw.trim()) return
    setBusy(true)
    void onSave(next).finally(() => setBusy(false))
  }
  const box = { flex, minHeight: 64, paddingTop: SPACE.lg, paddingBottom: SPACE.sm, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous' as const, borderWidth: 1.5, borderStyle: 'dashed' as const, alignItems: 'center' as const, justifyContent: 'center' as const }
  const pencil = disabled ? null : (
    <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: 5, left: 7 }}>
      <Icon name="edit" size={14} color={editing ? p.primary : p.textSub} />
    </View>
  )
  // 고치는 동안은 단추가 아니라 칸 — 입력 칸을 단추 안에 넣지 않는다
  if (editing) {
    return (
      <View style={{ ...box, borderColor: p.primary, backgroundColor: p.surface }}>
        {pencil}
        <TextInput
          aria-label={label}
          autoFocus
          value={text}
          onChangeText={(value) => setText(numeric ? value.replace(/[^0-9]/g, '') : value)}
          keyboardType={numeric ? 'number-pad' : 'default'}
          returnKeyType="done"
          maxLength={maxLength}
          selectTextOnFocus
          onSubmitEditing={commit}
          onBlur={commit}
          style={{ alignSelf: 'stretch', textAlign: 'center', fontSize: TYPE.lead, paddingVertical: 0, color: p.text, ...font(WEIGHT.bold) }}
        />
      </View>
    )
  }
  return (
    <Pressable
      role="button"
      aria-label={`${label} 고치기`}
      disabled={disabled || busy}
      onPress={() => {
        done.current = false
        setText(raw)
        setEditing(true)
      }}
      style={({ pressed }) => ({ ...box, borderColor: p.borderStrong, backgroundColor: pressed ? p.pressed : 'transparent', opacity: busy ? 0.5 : 1 })}
    >
      {pencil}
      <Txt step="lead" weight="bold" numberOfLines={1}>
        {shown}
      </Txt>
    </Pressable>
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
 * 상품 자세히 (아래 판 안, D-UX4-30): 번호·품종·가격 점선 칸 → 찜·대기 이름 알약 → 메뉴 줄.
 * onDecide: 겹침·승계를 정하기 창으로 (판매자만). onKey: 번호를 바꿔 상품 열쇠가 바뀌었을 때. onDone: 상품을 지운 뒤(판 닫기)
 */
export function ProductDetail({ product, onDecide, onKey, onDone }: { readonly product: Product; readonly onDecide?: () => void; readonly onKey?: (key: string) => void; readonly onDone?: () => void }) {
  const api = useConsoleApi()
  const closed = api.ended || api.sealed
  const [error, setError] = useState<string | null>(null)
  const [askClaim, setAskClaim] = useState<{ readonly id: string; readonly name: string } | null>(null)
  const [askProduct, setAskProduct] = useState(false)
  const [busy, setBusy] = useState(false)
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
  const saveNo = (text: string) => run(async () => {
    const to = Number(text)
    if (text === '' || !Number.isSafeInteger(to) || to < 1) throw new Error('번호를 숫자로 적어 주세요.')
    const other = api.data.products.get(productKey(api.b, to))
    if (other !== undefined && other.status !== 'CLOSED') throw new Error(`${String(to)}번은 이미 있어요.`)
    const result = await api.command({ type: 'product.renumber', b: api.b, from: product.no, to })
    if (!result.changed) throw new Error('번호를 바꾸지 못했어요. 같은 번호 상품이 있는지 확인해 주세요.')
    onKey?.(productKey(api.b, to))
  }, '번호를 바꾸지 못했어요. 다시 눌러 주세요.')
  const saveName = (text: string) => run(async () => {
    await api.command({ type: 'product.update', b: api.b, no: product.no, name: text })
  }, '품종을 고치지 못했어요. 다시 눌러 주세요.')
  const savePrice = (text: string) => run(async () => {
    if (text === '' || Number(text) < 100) throw new Error('가격은 100원 이상으로 적어 주세요.')
    // 원문 칸으로 보낸다(SRV1 약속 2) — "원"을 붙여 방송 가격 단위와 상관없이 원으로 읽힌다
    await api.command({ type: 'product.update', b: api.b, noText: String(product.no), priceText: `${text}원` })
  }, '가격을 고치지 못했어요. 다시 눌러 주세요.')
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
  const productLine = `${String(product.no)}번 ${rowName(product)} ${formatWon(product.price)}`
  return (
    <View role="group" aria-label="상품 자세히" style={{ gap: SPACE.lg }}>
      <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
        <EditBox label="번호" shown={`${String(product.no)}번`} raw={String(product.no)} numeric flex={0.8} maxLength={6} disabled={closed} onSave={saveNo} />
        <EditBox label="품종" shown={rowName(product)} raw={product.name} numeric={false} flex={1.4} maxLength={40} disabled={closed} onSave={saveName} />
        <EditBox label="가격" shown={formatWon(product.price)} raw={String(product.price)} numeric flex={1.3} maxLength={9} disabled={closed} onSave={savePrice} />
      </View>
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
      <View role="group" aria-label="상품 메뉴" style={{ gap: SPACE.xs }}>
        {!closed && (product.status === 'READY' || product.status === 'HOLD') ? <IconMenuRow emoji="▶️" tint="#E6F2EB" title="판매 시작" ariaLabel={`판매 시작 — ${String(product.no)}번`} onPress={() => void open()} /> : null}
        {undecided(product) && onDecide !== undefined ? <IconMenuRow emoji="🙋" tint="#FFF4E5" title="누가 살지 정하기" onPress={onDecide} /> : null}
        {!closed ? <IconMenuRow emoji="🗑️" tint={TRASH_TINT} title="상품 삭제" ariaLabel={`상품 삭제 — ${String(product.no)}번`} onPress={() => setAskProduct(true)} /> : null}
      </View>
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
