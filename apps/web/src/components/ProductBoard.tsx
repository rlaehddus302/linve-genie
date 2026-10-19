// 현재 상품·상품 보드 (AC-S05-14, SPEC §7 화면 2, PRD-04, D-088). 값은 서버 조회(코어 조회 함수 결과) 그대로이고 낱말로만 바꾼다.
import { memo, useMemo } from 'react'
import type { Product } from '../api/types.ts'
import { boardProducts, cancelRequestCount, formatWon, labelWords } from '../lib/derive.ts'
import { ALERT_WORD, PRODUCT_STATUS_WORD } from '../lib/words.ts'
import { useConsoleApi } from './console-context.ts'

/** 1등 표시 이름 (재고 2 이상이면 여럿). 없으면 "아직 없음" */
function useWinnerNames(product: Product): string {
  const api = useConsoleApi()
  if (product.winners.length === 0) return '아직 없음'
  return product.winners.map((id) => api.names.name(id)).join(', ')
}

const nameOf = (product: Product): string => (product.name.trim() === '' ? '품종 미입력' : product.name)

/** 상품 한 줄 요약: 번호·품종·가격·상태·1등·대기 수 (번호 찾기 미리 보기) */
export function ProductSummary({ product }: { readonly product: Product }) {
  const winners = useWinnerNames(product)
  return (
    <p className="summary">
      <strong>{product.no}번</strong> <span>{nameOf(product)}</span> <span>{formatWon(product.price)}</span>{' '}
      <span className={`tag status-${product.status}`}>{PRODUCT_STATUS_WORD[product.status]}</span> <span>1등 {winners}</span>{' '}
      <span>대기 {product.waitlist.length}명</span>
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

function CurrentBody({ product, onOpen }: { readonly product: Product; readonly onOpen: (key: string) => void }) {
  const winners = useWinnerNames(product)
  return (
    <div className="current-body">
      <p className="current-number">{product.no}번</p>
      <div className="stack-tight">
        <p className="current-name">{nameOf(product)}</p>
        <p>{formatWon(product.price)}</p>
        <p>
          <span className={`tag status-${product.status}`}>{PRODUCT_STATUS_WORD[product.status]}</span>
        </p>
        <p>1등: {winners}</p>
        <p>대기 {product.waitlist.length}명</p>
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
  const winners = useWinnerNames(product)
  const requests = cancelRequestCount(api.data, product)
  const labels = labelWords(api.data, product)
  const waiting = api.waiting.products.has(product.key)
  return (
    <li>
      <button type="button" className="board-item" onClick={() => onOpen(product.key)}>
        <span className="board-no">{product.no}번</span>
        <span className="board-name">{nameOf(product)}</span>
        <span>{formatWon(product.price)}</span>
        <span className={`tag status-${product.status}`}>{PRODUCT_STATUS_WORD[product.status]}</span>
        <span>1등 {winners}</span>
        <span>대기 {product.waitlist.length}</span>
        {product.conflict ? <span className="tag tag-alert">{ALERT_WORD.conflict}</span> : null}
        {requests > 0 ? <span className="tag tag-alert">{ALERT_WORD.cancelRequest}</span> : null}
        {product.awaitingSuccession ? <span className="tag tag-alert">{ALERT_WORD.succession}</span> : null}
        {labels.map((word) => (
          <span key={word} className="tag">
            {word}
          </span>
        ))}
        {waiting ? <span className="tag tag-waiting">보내기 전</span> : null}
      </button>
    </li>
  )
})
