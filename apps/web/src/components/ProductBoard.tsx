// 현재 상품·상품 보드 (AC-S05-14, SPEC §7 화면 2, PRD-04, D-088, AC-I1-30). 값은 서버 조회(코어 조회 함수 결과) 그대로이고 낱말로만 바꾼다.
// CRM1 D-CRM1-07: 실제 방송의 1등이 "입금 늦음 주의" 손님이면 카드·보드·요약 줄·변형 줄의 이름 뒤에 작은 꼬리표(caution.tsx) — 판정은 그대로.
// 라벨 상태 낱말은 서버의 출력 기록(라벨 키마다 — 라벨 대기·출력 중·라벨 출력됨·재출력 필요·출력 안 함)이다. 리허설은 보이지 않는다.
import { FOCUS_GRACE_SEC } from '@livejjim/core'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isApiError, type ApiError } from '../api/client.ts'
import type { Product } from '../api/types.ts'
import { boardProducts, cancelRequestCount, formatWon, productSlots } from '../lib/derive.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { stockLeftWords } from '../lib/stock.ts'
import { ALERT_WORD, PRODUCT_STATUS_WORD } from '../lib/words.ts'
import { consoleLabels, useConsoleApi } from './console-context.ts'
import { boardLabelWords } from './LabelParts.tsx'
import { currentSummaryParts, currentSummaryWords } from '../lib/current-summary.ts'
import { CautionMark, WinnerNames, useCaution } from './caution.tsx'
import { CAUTION_WORD } from '../lib/customers.ts'

/** 1등 표시 이름 (재고 2 이상이면 여럿). 없으면 "아직 없음". 옵션 상품은 1등이 변형마다라 "변형별" (D-O2-12) */
function useWinnerNames(product: Product): string {
  const api = useConsoleApi()
  if (product.hasOptions) return '변형별'
  if (product.winners.length === 0) return '아직 없음'
  return product.winners.map((id) => api.names.name(id)).join(', ')
}

/** 1등 이름들 + 주의 꼬리표 (옵션 상품은 "변형별", 없으면 "아직 없음" — 글자는 useWinnerNames와 같다) */
function Winners({ product }: { readonly product: Product }) {
  const api = useConsoleApi()
  if (product.hasOptions) return <>변형별</>
  if (product.winners.length === 0) return <>아직 없음</>
  return <WinnerNames ids={product.winners} nameOf={(id) => api.names.name(id)} />
}

/** 옵션 상품의 모은 값: "변형 3개 · 남은 1" */
export function variantTotals(product: Product): string {
  const remaining = product.variants.reduce((sum, variant) => sum + Math.max(0, variant.remaining), 0)
  return `변형 ${String(product.variants.length)}개 · 남은 ${String(remaining)}`
}

/** 대기 수 (옵션 상품은 변형 대기의 합) */
const waitCount = (product: Product): number => productSlots(product).waitlist.length

/** "지금 상품으로"를 둘 수 있는 상품: 공개 전·판매 중·판매 완료 (일시 중지·판매 종료에는 없다, D-O1-06·D-O2-10) */
export const focusable = (product: Product): boolean => product.status === 'READY' || product.status === 'OPEN' || product.status === 'SOLD'

/**
 * "지금 상품으로" 버튼 / 이미 지금 상품이면 "지금 상품" 표시 (옵션 방송만). 누르면 5초 대기·되돌리기 없이 바로 product.focus를 보낸다(D-O2-10) —
 * 다른 상품을 다시 누르면 된다.
 */
export function FocusButton({ product }: { readonly product: Product }) {
  const api = useConsoleApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  if (api.options !== true) return null
  const focus = api.data.broadcasts.get(product.broadcast)?.focus ?? null
  if (focus !== null && focus.product === product.key) return <span className="tag tag-focus">지금 상품</span>
  if (!focusable(product) || api.ended || api.sealed) return null
  return (
    <>
      <button
        type="button"
        className="button button-small"
        disabled={busy}
        aria-label={`지금 상품으로 — ${String(product.no)}번`}
        onClick={() => {
          setBusy(true)
          setError(null)
          api.command({ type: 'product.focus', b: product.broadcast, no: product.no }).then(
            () => setBusy(false),
            (caught: unknown) => {
              setBusy(false)
              if (isApiError(caught)) setError(caught)
            },
          )
        }}
      >
        지금 상품으로
      </button>
      {error !== null ? <ErrorNote error={error} /> : null}
    </>
  )
}

/** 1초마다 지금 시각 (15초 안내) */
function useSecondClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const handle = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(handle)
  }, [active])
  return now
}

export const NO_FOCUS_WORDS = '지금 상품 없음 — 상품 이름을 쓴 댓글만 받아요'
export const FOCUS_GRACE_WORDS = '15초 동안 상품 이름 없는 댓글은 확인 필요로 모아요'

/** 지금 상품 (옵션 방송 콘솔 위쪽 고정 영역, D-O2-10, CMT-05): "지금 상품: 21번 반바지" — 일시 중지·판매 종료하면 실시간으로 없어진다 */
export function FocusBanner() {
  const api = useConsoleApi()
  const focus = api.data.broadcasts.get(api.b)?.focus ?? null
  const at = focus === null ? Number.NaN : Date.parse(focus.at)
  const recent = focus !== null && Number.isFinite(at)
  const now = useSecondClock(recent)
  const product = focus === null ? undefined : api.data.products.get(focus.product)
  const inGrace = recent && now - at < FOCUS_GRACE_SEC * 1000 && now - at >= -FOCUS_GRACE_SEC * 1000
  return (
    <section className="focus-banner" aria-label="지금 상품" aria-live="polite">
      {focus === null ? (
        <p className="focus-none">{NO_FOCUS_WORDS}</p>
      ) : (
        <>
          <p className="focus-name">
            지금 상품: {focus.no}번 {product === undefined ? '' : nameOf(product)}
          </p>
          {inGrace ? <p className="hint focus-grace">{FOCUS_GRACE_WORDS}</p> : null}
        </>
      )}
    </section>
  )
}

const nameOf = (product: Product): string => (product.name.trim() === '' ? '품종 미입력' : product.name)

/** 상품 한 줄 요약: 번호·품종·가격·상태·1등·대기 수 (번호 찾기 미리 보기) */
export function ProductSummary({ product }: { readonly product: Product }) {
  return (
    <p className="summary">
      <strong>{product.no}번</strong> <span>{nameOf(product)}</span> <span>{formatWon(product.price)}</span>{' '}
      <span className={`tag status-${product.status}`}>{PRODUCT_STATUS_WORD[product.status]}</span> <span>
        1등 <Winners product={product} />
      </span>{' '}
      <span>대기 {waitCount(product)}명</span>
      {stockLeftWords(product) !== null ? <span> {stockLeftWords(product)}</span> : null}
      {product.hasOptions ? <span> {variantTotals(product)}</span> : null}
    </p>
  )
}

/** 현재 상품을 크게 (AC-S05-14) */
export function CurrentProduct({ product, onOpen }: { readonly product: Product | undefined; readonly onOpen: (key: string) => void }) {
  return (
    <section className="current card" aria-label="현재 상품">
      <h2 className="section-title">현재 상품</h2>
      {product === undefined ? <p>아직 등록한 상품이 없어요. 빠른 입력칸에 "15 핑크프릴 10000"처럼 적어 주세요.</p> : <CurrentBody product={product} onOpen={onOpen} />}
    </section>
  )
}

/**
 * 휴대폰 고정 영역 맨 위(알림 띠 위)의 현재 상품 한 줄 요약 (QL2 D-QL2-11 (1)·D-QL2-14 (1), AC-QL2-01) — 스크롤해도 늘 보인다. 누르는 기능은 없다(카드가 그대로 있다).
 * 값은 카드와 같다(1등·대기). 100% 글자 고정 영역 35%는 요약이 든 채로 지켜져(측정, dev-notes) 6글자 줄이기(D-QL2-11 (3))는 쓰지 않는다
 */
export function CurrentSummary({ product }: { readonly product: Product | undefined }) {
  return (
    <p className="current-summary" role="status" aria-live="polite" aria-label="현재 상품 요약">
      {product === undefined ? currentSummaryWords(undefined) : <SummaryText product={product} />}
    </p>
  )
}

function SummaryText({ product }: { readonly product: Product }) {
  const winners = useWinnerNames(product)
  const caution = useCaution()
  const input = { no: product.no, name: nameOf(product), status: product.status, winners, waiting: waitCount(product) }
  // 1등 중 입금 늦음 주의 손님이 있으면 1등 글 뒤에 꼬리표 하나 (요약 줄에 다 들어가지 않으면 "주의" — SummaryFit)
  const flagged = !product.hasOptions && product.winners.some((id) => caution(id))
  if (!flagged) return <>{currentSummaryWords(input)}</>
  const [head, tail] = currentSummaryParts(input)
  return <SummaryFit key={`${head}|${tail}`} head={head} tail={tail} />
}

/**
 * 요약 줄의 꼬리표 (D-CRM1-07, AC-CRM1-20): "입금 늦음 주의"를 넣어도 줄 수(높이)가 꼬리표 없을 때와 같으면 그대로, 늘면 "주의" 한 낱말.
 * 고정 영역 높이 규칙(D-QL2-11·D-QL2-14)을 넘지 않게. 잴 때만 보이지 않는 두 벌(꼬리표 없음·긴 꼬리표)을 줄 안에 두고 그림 전에 재고 뺀다
 * — 다 그린 줄의 글자에는 두 벌이 남지 않는다. 폭이 바뀌면 다시 잰다. 글이 바뀌면 부르는 쪽이 key로 새로 만든다.
 */
function SummaryFit({ head, tail }: { readonly head: string; readonly tail: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const [fit, setFit] = useState<{ readonly measuring: boolean; readonly short: boolean; readonly width: number }>({ measuring: true, short: false, width: -1 })
  useLayoutEffect(() => {
    if (!fit.measuring) return
    const element = box.current
    if (element === null) return
    const bare = element.querySelector<HTMLElement>('[data-fit="bare"]')
    const long = element.querySelector<HTMLElement>('[data-fit="long"]')
    const a = bare?.getBoundingClientRect().height ?? 0
    const b = long?.getBoundingClientRect().height ?? 0
    const width = element.parentElement?.getBoundingClientRect().width ?? 0
    setFit({ measuring: false, short: a > 0 && b > a, width })
  }, [fit.measuring])
  useEffect(() => {
    const line = box.current?.parentElement
    if (line === null || line === undefined || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => {
      const width = line.getBoundingClientRect().width
      setFit((current) => (current.measuring || Math.abs(current.width - width) < 0.5 ? current : { ...current, measuring: true }))
    })
    observer.observe(line)
    return () => observer.disconnect()
  }, [])
  return (
    <span ref={box}>
      {head} <CautionMark short={fit.short} />
      {tail}
      {fit.measuring ? (
        <span className="summary-measure" aria-hidden="true">
          <span data-fit="bare">
            {head}
            {tail}
          </span>
          <span data-fit="long">
            {head} <span className="tag tag-caution caution-mark">{CAUTION_WORD}</span>
            {tail}
          </span>
        </span>
      ) : null}
    </span>
  )
}

function CurrentBody({ product, onOpen }: { readonly product: Product; readonly onOpen: (key: string) => void }) {
  return (
    <div className="current-body">
      <p className="current-number">{product.no}번</p>
      <div className="stack-tight">
        <p className="current-name">{nameOf(product)}</p>
        {/* 1등은 이름 바로 아래 — 큰 글씨에서 "몇 번·무엇·누가"가 한눈에 (QL2 D-QL2-01 (2)) */}
        <p>
          1등: <Winners product={product} />
        </p>
        <p>{formatWon(product.price)}</p>
        <p>
          <span className={`tag status-${product.status}`}>{PRODUCT_STATUS_WORD[product.status]}</span>
        </p>
        <p>대기 {waitCount(product)}명</p>
        {stockLeftWords(product) !== null ? <p className="stock-left">{stockLeftWords(product)}</p> : null}
        {product.hasOptions ? <p>{variantTotals(product)}</p> : null}
        <button type="button" className="button" onClick={() => onOpen(product.key)}>
          {product.no}번 자세히
        </button>
      </div>
    </div>
  )
}

/** 상품 보드 (가장 최근 등록 순) */
export function ProductBoard({ onOpen }: { readonly onOpen: (key: string) => void }) {
  const api = useConsoleApi()
  const products = useMemo(() => boardProducts(api.data, api.b), [api.data.products, api.b])
  return (
    <section className="board card" aria-label="상품 보드">
      <h2 className="section-title">상품 보드 ({products.length}개)</h2>
      {products.length === 0 ? <p>아직 상품이 없어요.</p> : null}
      <ul className="board-list">
        {products.map((product) => (
          <BoardItem key={product.key} product={product} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  )
}

const BoardItem = memo(function BoardItem({ product, onOpen }: { readonly product: Product; readonly onOpen: (key: string) => void }) {
  const api = useConsoleApi()
  const requests = cancelRequestCount(api.data, product)
  const labels = boardLabelWords(consoleLabels(api), api.data.claims, product)
  const waiting = api.waiting.products.has(product.key)
  const [open, setOpen] = useState(false)
  return (
    <li className={api.options === true ? 'board-entry' : undefined}>
      <button type="button" className="board-item" onClick={() => onOpen(product.key)}>
        <span className="board-no">{product.no}번</span>
        <span className="board-name">{nameOf(product)}</span>
        <span>{formatWon(product.price)}</span>
        <span className={`tag status-${product.status}`}>{PRODUCT_STATUS_WORD[product.status]}</span>
        <span>
          1등 <Winners product={product} />
        </span>
        <span>대기 {waitCount(product)}</span>
        {stockLeftWords(product) !== null ? <span>{stockLeftWords(product)}</span> : null}
        {product.hasOptions ? <span>{variantTotals(product)}</span> : null}
        {productSlots(product).conflict ? <span className="tag tag-alert">{ALERT_WORD.conflict}</span> : null}
        {requests > 0 ? <span className="tag tag-alert">{ALERT_WORD.cancelRequest}</span> : null}
        {productSlots(product).awaitingSuccession ? <span className="tag tag-alert">{ALERT_WORD.succession}</span> : null}
        {labels.map((word) => (
          <span key={word} className={word === '재출력 필요' ? 'tag tag-alert' : 'tag'}>
            {word}
          </span>
        ))}
        {waiting ? <span className="tag tag-waiting">보내기 전</span> : null}
      </button>
      {api.options === true ? (
        <div className="row board-extra">
          <FocusButton product={product} />
          {product.hasOptions ? (
            <button type="button" className="button button-small" aria-expanded={open} aria-label={`변형 ${open ? '접기' : '펼치기'} — ${String(product.no)}번`} onClick={() => setOpen((value) => !value)}>
              {open ? '변형 접기' : `변형 ${String(product.variants.length)}개 펼치기`}
            </button>
          ) : null}
        </div>
      ) : null}
      {open && product.hasOptions ? <VariantLines product={product} /> : null}
    </li>
  )
})

/**
 * 변형마다 한 줄 (D-O2-12, AC-O2-23): 옵션 글 · 상태 낱말 · 1등(2개 이상이면 "최지우 ×2") · 대기 수 · 남은 수량.
 * 상품이 일시 중지면 변형 상태도 일시 중지(코어 변형 상태 그대로).
 */
export function VariantLines({ product }: { readonly product: Product }) {
  const api = useConsoleApi()
  const caution = useCaution()
  return (
    <ul className="plain-list variant-lines" aria-label={`변형 — ${String(product.no)}번`}>
      {product.variants.map((variant) => {
        const winners = variant.winnerClaims
          .map((id) => api.data.claims.get(id))
          .filter((claim) => claim !== undefined)
          .map((claim) => ({ id: claim.currentBuyer, text: `${api.names.name(claim.currentBuyer)}${claim.qty > 1 ? ` ×${String(claim.qty)}` : ''}` }))
        return (
          <li key={variant.key} className="variant-line">
            <strong>{variant.text}</strong> <span className={`tag status-${variant.status}`}>{PRODUCT_STATUS_WORD[variant.status]}</span>{' '}
            <span>
              1등{' '}
              {winners.length === 0
                ? '아직 없음'
                : !winners.some((winner) => caution(winner.id))
                  ? winners.map((winner) => winner.text).join(', ')
                  : winners.map((winner, index) => (
                    <span key={`${winner.id}-${String(index)}`}>
                      {index > 0 ? ', ' : ''}
                      {winner.text}
                      {caution(winner.id) ? (
                        <>
                          {' '}
                          <CautionMark />
                        </>
                      ) : null}
                    </span>
                  ))}
            </span> <span>대기 {variant.waitlist.length}</span> <span>남은 {variant.remaining}</span>
            {variant.conflict ? <span className="tag tag-alert">{ALERT_WORD.conflict}</span> : null}
            {variant.awaitingSuccession ? <span className="tag tag-alert">{ALERT_WORD.succession}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}
