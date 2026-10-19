// 상품 자세히 (AC-S05-15·34·35, PRD-02, PRD-04, R-2, R-8, R-9, R-10, ORD-12, D-083, D-088).
// - 번호·품종·가격·재고·상태, 1등(들), 대기 목록, 그 번호의 보류·충돌 찜, 취소 요청, 가격·품종 변경 이력, 조치 기록.
// - 상품 명령(일시 중지·다시 판매·공개·판매 종료·고치기)은 바로 보낸다. 찜 조치(host.*)는 5초 뒤에 보낸다.
import { useEffect, useMemo, useState } from 'react'
import { get, isApiError, newRequestId, withQuery, type ApiError } from '../api/client.ts'
import type { Claim, HistoryItem, Product } from '../api/types.ts'
import { claimWord, formatWon } from '../lib/derive.ts'
import { kstTime } from '../lib/kst.ts'
import { useWide } from '../lib/use-wide.ts'
import { ORIGIN_WORD, PRODUCT_STATUS_WORD, actionWord, actorWord } from '../lib/words.ts'
import { openBlockAction, openClaimAction } from './actions.ts'
import { productLabel, useConsoleApi } from './console-context.ts'
import { ErrorNote } from './ErrorNote.tsx'
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
  const winners = product.winnerClaims.map((id) => api.data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
  const waitlist = product.waitlistClaims.map((id) => api.data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
  const open = claims.filter((claim) => claim.status === 'PENDING' || claim.status === 'CONFLICT')
  const ended = claims.filter((claim) => claim.status === 'CANCELLED' || claim.status === 'REJECTED' || claim.status === 'DUPLICATE').sort((a, b) => b.seq - a.seq)
  const requests = [...api.data.cancelRequests.values()].filter((request) => request.product === product.key)

  /** 실패한 명령 (잠시 뒤 다시 시도하면 되는 실패면 같은 요청 번호로 "다시 보내기") */
  const [failed, setFailed] = useState<{ event: Readonly<Record<string, unknown>>; requestId: string } | null>(null)

  const run = async (event: Readonly<Record<string, unknown>>, requestId: string = newRequestId()) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setFailed(null)
    try {
      await api.command(event, requestId)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      if (caught.transient) setFailed({ event, requestId })
    } finally {
      setBusy(false)
    }
  }

  const selling = product.status === 'OPEN' || product.status === 'SOLD'
  const hasClaims = product.winners.length > 0 || product.waitlist.length > 0
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
          <dd>{product.stock}개</dd>
        </div>
        <div>
          <dt>상태</dt>
          <dd>
            <span className={`tag status-${product.status}`}>{PRODUCT_STATUS_WORD[product.status]}</span>
            {product.conflict ? <span className="tag tag-alert">충돌</span> : null}
            {product.awaitingSuccession ? <span className="tag tag-alert">승계 결정 필요</span> : null}
            {api.waiting.products.has(product.key) ? <span className="tag tag-waiting">보내기 전</span> : null}
          </dd>
        </div>
      </dl>

      {/* 찜이 먼저: 창의 "닫기"(처음 포커스)에서 Tab 한 번이면 1등 찜의 "찜 취소하기" (AC-S06-63) */}
      <ClaimSection title="1등" claims={winners} product={product} />
      <ClaimSection title="대기" claims={waitlist} product={product} />
      <ClaimSection title="보류·충돌 찜" claims={open} product={product} />

      <section aria-label="상품 명령" className="stack-tight">
        <h3 className="sub-title">상품 명령</h3>
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
        {busy ? <p role="status">보내는 중…</p> : null}
        {error !== null ? <ErrorNote error={error} {...(failed === null ? {} : { onRetry: () => void run(failed.event, failed.requestId) })} /> : null}
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

function ClaimSection({ title, claims, product }: { readonly title: string; readonly claims: readonly Claim[]; readonly product: Product }) {
  if (claims.length === 0) {
    if (title === '1등') {
      return (
        <section className="stack-tight" aria-label={title}>
          <h3 className="sub-title">{title}</h3>
          <p>아직 없음</p>
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
          <ClaimRow key={claim.id} claim={claim} product={product} />
        ))}
      </ul>
    </section>
  )
}

function ClaimRow({ claim, product }: { readonly claim: Claim; readonly product: Product }) {
  const api = useConsoleApi()
  const name = api.names.name(claim.currentBuyer)
  const self = api.data.buyers.get(claim.buyer)
  const blocked = self?.blocked === true
  const waiting = api.waiting.claims.has(claim.id)
  const full = product.winners.length >= product.stock
  return (
    <li className="claim-row">
      <p>
        <strong>{name}</strong> <span className="tag">{claimWord(api.data, claim)}</span> <span>{ORIGIN_WORD[claim.origin]}</span>{' '}
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
              const label = `${productLabel(api, claim.broadcast, claim.no)} ${name} 확인(잠금)`
              api.queueHost({ label, event: { type: 'host.confirm', b: claim.broadcast, no: claim.no, buyer: claim.currentBuyer }, claims: [claim.id], products: [claim.product] })
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
            onClick={() => api.openDialog({ kind: 'assign', spec: { product: product.key, replace: claim.currentBuyer } })}
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
                ? api.openDialog({ kind: 'assign', spec: { product: product.key, buyer: claim.currentBuyer } })
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
