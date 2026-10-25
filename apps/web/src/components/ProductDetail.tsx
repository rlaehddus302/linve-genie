// 상품 자세히 (AC-S05-15·34·35, PRD-02, PRD-04, R-2, R-8, R-9, R-10, ORD-12, D-083, D-088, AC-I1-31·36).
// - 번호·품종·가격·재고·상태, 1등(들), 대기 목록, 그 번호의 보류·충돌 찜, 라벨(1등마다 미리 보기·상태·이력·출력·내보내기 — 리허설은 없음),
//   취소 요청, 가격·품종 변경 이력, 조치 기록.
// - 상품 관리(일시 중지·다시 판매·공개·판매 종료·고치기)은 바로 보낸다. 찜 조치(host.*)는 5초 뒤에 보낸다.
import { useEffect, useMemo, useState } from 'react'
import { get, isApiError, newRequestId, withQuery, type ApiError } from '../api/client.ts'
import type { Claim, HistoryItem, Product } from '../api/types.ts'
import { usePendingNow } from '../lib/use-pending-now.ts'
import { AUTO_RESEND_NOTE, RESENDING_WORD } from '../lib/resend-board.ts'
import { claimOptionWords, claimOptionsField, claimWord, formatWon, productSlots } from '../lib/derive.ts'
import { optionSummary } from '../lib/options.ts'
import { stockLeftWords } from '../lib/stock.ts'
import { kstTime } from '../lib/kst.ts'
import { useWide } from '../lib/use-wide.ts'
import { ORIGIN_WORD, PRODUCT_STATUS_WORD, actionWord, actorWord } from '../lib/words.ts'
import { openBlockAction, openClaimAction } from './actions.ts'
import { consoleLabels, productLabel, useConsoleApi } from './console-context.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { ProductLabels } from './LabelParts.tsx'
import { FocusButton } from './ProductBoard.tsx'
import { Modal } from './Modal.tsx'

export function ProductDetail({ productKey, onClose, onEdit }: { readonly productKey: string; readonly onClose: () => void; readonly onEdit: (product: Product) => void }) {
  const api = useConsoleApi()
  const product = api.data.products.get(productKey)
  if (product === undefined) {
    return (
      <Modal title="상품 자세히" onClose={onClose}>
        <p>그 상품을 찾지 못했어요.</p>
      </Modal>
    )
  }
  return <DetailBody product={product} onClose={onClose} onEdit={onEdit} />
}

function DetailBody({ product, onClose, onEdit }: { readonly product: Product; readonly onClose: () => void; readonly onEdit: (product: Product) => void }) {
  const api = useConsoleApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const title = productLabel(api, product.broadcast, product.no)

  const claims = useMemo(() => {
    const out: Claim[] = []
    for (const claim of api.data.claims.values()) if (claim.product === product.key) out.push(claim)
    return out
  }, [api.data.claims, product.key])
  const claimsOf = (ids: readonly string[]) => ids.map((id) => api.data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
  // 옵션 상품의 1등·대기는 변형에 있다 (D-O1-01) — 라벨 칸은 모든 변형의 1등
  const winners = product.hasOptions ? product.variants.flatMap((variant) => claimsOf(variant.winnerClaims)) : claimsOf(product.winnerClaims)
  const waitlist = claimsOf(product.waitlistClaims)
  const open = claims.filter((claim) => claim.status === 'PENDING' || claim.status === 'CONFLICT')
  const ended = claims.filter((claim) => claim.status === 'CANCELLED' || claim.status === 'REJECTED' || claim.status === 'DUPLICATE').sort((a, b) => b.seq - a.seq)
  const requests = [...api.data.cancelRequests.values()].filter((request) => request.product === product.key)

  /** 실패한 명령 (잠시 뒤 다시 시도하면 되는 실패면 같은 요청 번호로 "다시 보내기") */
  const [failed, setFailed] = useState<{ event: Readonly<Record<string, unknown>>; requestId: string } | null>(null)

  /** 다시 보내는 중인가 (연결이 돌아와 저절로, D-MOB2-07) */
  const [resending, setResending] = useState(false)

  // 창이 닫혀도 남는 한 번 보내기 — 창이 닫혀 있으면 결과는 상품 카드 상태로 보인다(React는 닫힌 창의 상태 바꾸기를 무시한다)
  const attempt = async (event: Readonly<Record<string, unknown>>, requestId: string, auto: boolean): Promise<void> => {
    const board = api.resend
    const key = `command:${requestId}`
    board?.remove(key)
    setBusy(true)
    setResending(auto)
    setError(null)
    setFailed(null)
    try {
      await api.command(event, requestId)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      if (caught.transient) setFailed({ event, requestId })
      // 기록되지 않았음이 확실한 실패: 연결이 돌아오면 같은 요청 번호로 한 번 저절로 (D-MOB2-07)
      if (caught.retryable) board?.add(key, 'command', () => attempt(event, requestId, true))
    } finally {
      setBusy(false)
      setResending(false)
    }
  }

  const run = async (event: Readonly<Record<string, unknown>>, requestId: string = newRequestId()) => {
    if (busy) return
    await attempt(event, requestId, false)
  }

  const selling = product.status === 'OPEN' || product.status === 'SOLD'
  // 옵션 상품은 1등·대기가 변형에 있다 (D-O1-01) — 변형을 합쳐 본다 (S05 판매 종료 규칙)
  const slots = productSlots(product)
  const hasClaims = slots.winners.length > 0 || slots.waitlist.length > 0
  const base = { b: product.broadcast, no: product.no }

  return (
    <Modal title={`${title} 자세히`} onClose={onClose} wide>
      <dl className="facts">
        <div>
          <dt>품종</dt>
          <dd>{product.name === '' ? '품종 미입력' : product.name}</dd>
        </div>
        <div>
          <dt>가격</dt>
          <dd>{formatWon(product.price)}</dd>
        </div>
        <div>
          <dt>재고</dt>
          <dd>{product.hasOptions ? '옵션별' : (stockLeftWords(product) ?? `${String(product.stock)}개`)}</dd>
        </div>
        {product.hasOptions ? (
          <div>
            <dt>옵션</dt>
            <dd>{optionSummary(product.options)}</dd>
          </div>
        ) : null}
        {product.aliases.length > 0 ? (
          <div>
            <dt>상품 별칭</dt>
            <dd>{product.aliases.join(', ')}</dd>
          </div>
        ) : null}
        <div>
          <dt>상태</dt>
          <dd>
            <span className={`tag status-${product.status}`}>{PRODUCT_STATUS_WORD[product.status]}</span>
            {slots.conflict ? <span className="tag tag-alert">충돌</span> : null}
            {slots.awaitingSuccession ? <span className="tag tag-alert">승계 결정 필요</span> : null}
            {api.waiting.products.has(product.key) ? <span className="tag tag-waiting">보내기 전</span> : null}
          </dd>
        </div>
      </dl>

      {/* 찜이 먼저: 창의 "닫기"(처음 포커스)에서 Tab 한 번이면 1등 찜의 "찜 취소하기" (AC-S06-63) */}
      {product.hasOptions ? (
        product.variants.map((variant) => {
          const full = variant.confirmedUnits >= variant.stock
          return (
            <section key={variant.key} className="stack-tight variant-section" aria-label={`${variant.text} 변형`}>
              <h3 className="sub-title">
                {variant.text} · <span className={`tag status-${variant.status}`}>{PRODUCT_STATUS_WORD[variant.status]}</span> · {formatWon(variant.price)} · 남은 {variant.remaining}개 (재고{' '}
                {variant.stock})
              </h3>
              <ClaimSection title={`${variant.text} 1등`} claims={claimsOf(variant.winnerClaims)} product={product} full={full} empty="아직 없음" />
              <ClaimSection title={`${variant.text} 대기`} claims={claimsOf(variant.waitlistClaims)} product={product} full={full} />
            </section>
          )
        })
      ) : (
        <>
          <ClaimSection title="1등" claims={winners} product={product} />
          <ClaimSection title="대기" claims={waitlist} product={product} />
        </>
      )}
      <ClaimSection title="보류·충돌 찜" claims={open} product={product} />

      <ProductLabels
        product={product}
        winners={winners}
        labels={consoleLabels(api)}
        rehearsal={api.rehearsal}
        date={api.date}
        nameOf={(claim) => api.names.name(claim.currentBuyer)}
      />

      <section aria-label="상품 관리" className="stack-tight">
        <h3 className="sub-title">상품 관리</h3>
        <div className="row">
          {selling ? (
            <button type="button" className="button" disabled={busy} onClick={() => void run({ type: 'product.hold', ...base })}>
              일시 중지
            </button>
          ) : null}
          {product.status === 'READY' ? (
            <button type="button" className="button" disabled={busy} onClick={() => void run({ type: 'product.open', ...base })}>
              공개
            </button>
          ) : null}
          {product.status === 'HOLD' || product.status === 'CLOSED' ? (
            <button type="button" className="button" disabled={busy} onClick={() => void run({ type: 'product.open', ...base })}>
              다시 판매
            </button>
          ) : null}
          {product.status !== 'CLOSED' ? (
            <button
              type="button"
              className="button button-danger"
              disabled={busy || hasClaims}
              aria-describedby={hasClaims ? `close-note-${product.id}` : undefined}
              onClick={() =>
                api.openDialog({
                  kind: 'confirm',
                  spec: {
                    title: '판매 종료',
                    message: `${String(product.no)}번을 판매 종료할까요? 새 찜을 받지 않아요.`,
                    confirmLabel: '판매 종료하기',
                    onConfirm: async () => {
                      await api.command({ type: 'product.close', ...base })
                      api.closeTop()
                    },
                  },
                })
              }
            >
              판매 종료
            </button>
          ) : null}
          <button type="button" className="button" disabled={busy} onClick={() => onEdit(product)}>
            고치기
          </button>
          {/* 옵션 방송만: 옵션 고치기·지금 상품으로 (D-O2-03·10·11) */}
          {api.options === true ? (
            <button type="button" className="button" disabled={busy} onClick={() => api.openDialog({ kind: 'editOptions', product: product.key })}>
              옵션 고치기
            </button>
          ) : null}
          <FocusButton product={product} />
          <button
            type="button"
            className="button"
            disabled={product.conflict || !selling}
            onClick={() => api.openDialog({ kind: 'assign', spec: { product: product.key } })}
          >
            직접 배정
          </button>
        </div>
        {hasClaims && product.status !== 'CLOSED' ? (
          <p className="hint" id={`close-note-${product.id}`}>
            1등·대기 찜을 먼저 정리해 주세요.
          </p>
        ) : null}
        {product.conflict ? (
          <p className="warning" data-tone="warning">
            충돌부터 정해 주세요.
          </p>
        ) : null}
        {!selling && !product.conflict ? <p className="hint">직접 배정은 판매 중일 때만 할 수 있어요.</p> : null}
        {busy ? <p role="status">{resending ? RESENDING_WORD : '보내는 중…'}</p> : null}
        {error !== null ? <ErrorNote error={error} {...(failed === null ? {} : { onRetry: () => void run(failed.event, failed.requestId) })} /> : null}
        {error?.retryable === true && api.resend !== undefined ? <p className="hint">{AUTO_RESEND_NOTE}</p> : null}
      </section>

      {requests.length > 0 ? (
        <section className="stack-tight" aria-label="취소 요청">
          <h3 className="sub-title">취소 요청</h3>
          <ul className="plain-list">
            {requests.map((request) => (
              <li key={request.claim}>{api.names.name(request.currentBuyer)}님이 취소를 요청했어요.</li>
            ))}
          </ul>
          <button type="button" className="button" onClick={() => api.openDialog({ kind: 'cancelRequests' })}>
            취소 요청 창 열기
          </button>
        </section>
      ) : null}

      {product.priceHistory.length > 0 || product.nameHistory.length > 0 ? (
        <section className="stack-tight" aria-label="가격·품종 변경 이력">
          <h3 className="sub-title">가격·품종 변경 이력</h3>
          <ul className="plain-list">
            {product.priceHistory.map((change, index) => (
              <li key={`p${String(index)}`}>
                {kstTime(change.at)} 가격 {formatWon(change.from)} → {formatWon(change.to)}
              </li>
            ))}
            {product.nameHistory.map((change, index) => (
              <li key={`n${String(index)}`}>
                {kstTime(change.at)} 품종 {change.from === '' ? '품종 미입력' : change.from} → {change.to === '' ? '품종 미입력' : change.to}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ended.length > 0 ? (
        <details className="details">
          <summary>끝난 찜 {ended.length}개</summary>
          <ul className="plain-list">
            {ended.slice(0, 50).map((claim) => (
              <li key={claim.id}>
                {api.names.name(claim.currentBuyer)} · {claimWord(api.data, claim)} · {ORIGIN_WORD[claim.origin]}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <ActionHistory product={product} claims={claims} />
    </Modal>
  )
}

function ClaimSection({
  title,
  claims,
  product,
  full,
  empty,
}: {
  readonly title: string
  readonly claims: readonly Claim[]
  readonly product: Product
  /** 자리가 다 찼나 (옵션 상품은 그 변형) */
  readonly full?: boolean
  /** 비었을 때 보일 글 (없으면 칸을 숨긴다 — "1등"은 늘 "아직 없음") */
  readonly empty?: string
}) {
  if (claims.length === 0) {
    const words = empty ?? (title === '1등' ? '아직 없음' : undefined)
    if (words !== undefined) {
      return (
        <section className="stack-tight" aria-label={title}>
          <h3 className="sub-title">{title}</h3>
          <p>{words}</p>
        </section>
      )
    }
    return null
  }
  return (
    <section className="stack-tight" aria-label={title}>
      <h3 className="sub-title">
        {title} {claims.length}명
      </h3>
      <ul className="plain-list stack-tight">
        {claims.map((claim) => (
          <ClaimRow key={claim.id} claim={claim} product={product} full={full ?? product.winners.length >= product.stock} />
        ))}
      </ul>
    </section>
  )
}

function ClaimRow({ claim, product, full }: { readonly claim: Claim; readonly product: Product; readonly full: boolean }) {
  const api = useConsoleApi()
  const name = api.names.name(claim.currentBuyer)
  const self = api.data.buyers.get(claim.buyer)
  const blocked = self?.blocked === true
  const waiting = api.waiting.claims.has(claim.id)
  const pick = claimOptionsField(claim)
  // 시간이 지난 보류 찜은 "보류 · 시간 지남" (D-MOB2-06 — 공개 전(READY) 상품의 보류 찜도 같은 규칙)
  const now = usePendingNow(api.data)
  return (
    <li className="claim-row">
      <p>
        <strong>{name}</strong>
        {claim.variant !== null || claim.qty > 1 ? <span className="claim-option">{claimOptionWords(claim)}</span> : null} <span className="tag">{claimWord(api.data, claim, now)}</span>{' '}
        <span>{ORIGIN_WORD[claim.origin]}</span>{' '}
        <span>{kstTime(claim.rankTime)}</span>
        {claim.locked ? <span className="tag">잠금</span> : null}
        {claim.cancelRequested ? <span className="tag tag-alert">취소 요청</span> : null}
        {blocked ? <span className="tag tag-alert">차단</span> : null}
        {waiting ? <span className="tag tag-waiting">보내기 전</span> : null}
      </p>
      <div className="row">
        {claim.status === 'CONFIRMED' || claim.status === 'WAITLISTED' || claim.status === 'PENDING' || claim.status === 'CONFLICT' ? (
          <>
            <button type="button" className="button button-small" onClick={() => openClaimAction(api, claim, 'host.cancel')}>
              찜 취소하기
            </button>
            <button type="button" className="button button-small" onClick={() => openClaimAction(api, claim, 'host.reject')}>
              무효로 하기
            </button>
          </>
        ) : null}
        {claim.status === 'CONFIRMED' && !claim.locked ? (
          <button
            type="button"
            className="button button-small"
            onClick={() => {
              const label = `${productLabel(api, claim.broadcast, claim.no)}${claimOptionWords(claim)} ${name} 확인(잠금)`
              api.queueHost({ label, event: { type: 'host.confirm', b: claim.broadcast, no: claim.no, buyer: claim.currentBuyer, ...pick }, claims: [claim.id], products: [claim.product] })
              api.closeAll()
            }}
          >
            확인(잠금)
          </button>
        ) : null}
        {claim.status === 'CONFIRMED' ? (
          <button
            type="button"
            className="button button-small"
            disabled={product.conflict}
            onClick={() => api.openDialog({ kind: 'assign', spec: { product: product.key, replace: claim.currentBuyer, ...pick } })}
          >
            다른 사람으로 바꾸기
          </button>
        ) : null}
        {claim.status === 'WAITLISTED' ? (
          <button
            type="button"
            className="button button-small"
            disabled={full && product.conflict}
            onClick={() =>
              full
                ? api.openDialog({ kind: 'assign', spec: { product: product.key, buyer: claim.currentBuyer, ...pick } })
                : openClaimAction(api, claim, 'host.promote')
            }
          >
            1등으로 올리기
          </button>
        ) : null}
        {claim.status === 'CONFLICT' ? (
          <button type="button" className="button button-small" onClick={() => api.openDialog({ kind: 'conflict' })}>
            충돌 창 열기
          </button>
        ) : null}
        <button type="button" className="button button-small" onClick={() => openBlockAction(api, claim.buyer, !blocked)}>
          {blocked ? '차단 풀기' : '차단하기'}
        </button>
      </div>
      {claim.status === 'CONFIRMED' && product.conflict ? <p className="hint">충돌부터 정해 주세요.</p> : null}
    </li>
  )
}

/**
 * 조치 기록 (AC-S05-35, AC-S06-70, D-095): 그 상품 기록(상품 ID — 번호를 바꿔도 같다)을 대상으로 한 조치. 시각·조치 낱말·대상 구매자·사유·조치자.
 * 번호 변경은 "번호 변경 15번 → 16번". 맞지 않아 아무 일도 없었던 조치도 보인다.
 * PC(48rem 이상)는 표, 휴대폰은 표 대신 기록마다 한 묶음(시각 · 조치 · 대상 · 사유 · 조치자) — 좁은 표 칸에서 낱말이 한 글자씩 꺾이지 않게 (AC-S06b-41, D-102).
 */
function ActionHistory({ product, claims }: { readonly product: Product; readonly claims: readonly Claim[] }) {
  const api = useConsoleApi()
  const wide = useWide()
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  // 상품이나 그 찜이 바뀌면 다시 받는다 (채팅만 오가는 동안은 받지 않는다)
  const signature = `${JSON.stringify(product)}|${claims.map((claim) => `${claim.id}:${claim.status}:${claim.cancelRequested ? 1 : 0}`).join(',')}`
  useEffect(() => {
    let alive = true
    get<{ events: HistoryItem[] }>(withQuery(`/api/days/${api.date}/history`, { after: 0, limit: 500, product: product.id, rehearsal: api.rehearsal })).then(
      (result) => {
        if (alive) {
          setItems(result.events)
          setError(null)
        }
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [signature, api.date, api.rehearsal])
  return (
    <section className="stack-tight" aria-label="조치 기록">
      <h3 className="sub-title">조치 기록</h3>
      {error !== null ? <ErrorNote error={error} /> : null}
      {items === null && error === null ? <p>불러오는 중…</p> : null}
      {items !== null && items.length === 0 ? <p>아직 조치가 없어요.</p> : null}
      {items !== null && items.length > 0 && !wide ? (
        <ol className="plain-list history-list">
          {items.map((item) => {
            const target = typeof item.fields.buyer === 'string' ? api.names.name(item.fields.buyer) : ''
            return (
              <li key={item.seq} className="history-entry">
                <span className="history-time">{kstTime(item.at)}</span>
                <span className="history-word">{actionWord(item.type, item.fields)}</span>
                {target !== '' ? <span className="history-word">{target}</span> : null}
                {item.reason !== null ? <span className="history-word">{item.reason}</span> : null}
                <span className="history-word">{actorWord(item.actor)}</span>
              </li>
            )
          })}
        </ol>
      ) : null}
      {items !== null && items.length > 0 && wide ? (
        <table className="history">
          <thead>
            <tr>
              <th scope="col">시각</th>
              <th scope="col">조치</th>
              <th scope="col">대상</th>
              <th scope="col">사유</th>
              <th scope="col">조치자</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.seq}>
                <td className="history-time">{kstTime(item.at)}</td>
                <td>{actionWord(item.type, item.fields)}</td>
                <td>{typeof item.fields.buyer === 'string' ? api.names.name(item.fields.buyer) : ''}</td>
                <td>{item.reason ?? ''}</td>
                <td>{actorWord(item.actor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}
