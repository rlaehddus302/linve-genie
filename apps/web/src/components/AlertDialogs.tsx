// 알림 창 (AC-S05-30~33, ORD-06 AC2, ORD-07, ORD-10, R-5, R-7, R-8, D-087).
// 처음 포커스는 "닫기", 번호 붙은 선택은 숫자 키 1·2·3으로도 누른다. 고른 방송자 조치는 5초 뒤에 보낸다.
import { useEffect, useState } from 'react'
import { get, withQuery } from '../api/client.ts'
import type { CancelRequest, Claim, HistoryItem, Product } from '../api/types.ts'
import { claimWord, orphanPending } from '../lib/derive.ts'
import { kstTime } from '../lib/kst.ts'
import { ORIGIN_WORD, REJECT_REASON_WORD } from '../lib/words.ts'
import { openReopenAction, openReasonAction } from './actions.ts'
import { productLabel, useConsoleApi, type ConsoleApi } from './console-context.ts'
import { Modal } from './Modal.tsx'

const nameOf = (product: Product | undefined): string => (product === undefined ? '' : product.name === '' ? '품종 미입력' : product.name)

/** seq의 시각 (이력 한 줄을 받아 본다 — 확인 필요·취소 요청 시각) */
function useSeqTime(api: ConsoleApi, seq: number): string | null {
  const [time, setTime] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    get<{ events: HistoryItem[] }>(withQuery(`/api/days/${api.date}/history`, { after: Math.max(0, seq - 1), limit: 1, rehearsal: api.rehearsal })).then(
      (result) => {
        const item = result.events[0]
        if (alive && item !== undefined && item.seq === seq) setTime(kstTime(item.at))
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [seq, api.date, api.rehearsal])
  return time
}

// ── 충돌 (AC-S05-31) ────────────────────────────────────────────────────

export function ConflictDialog({ onClose }: { readonly onClose: () => void }) {
  const api = useConsoleApi()
  const products = [...api.data.products.values()].filter((product) => product.conflict && !api.waiting.products.has(product.key))
  const product = products[0]
  if (product === undefined) {
    return (
      <Modal title="충돌" onClose={onClose}>
        <p>지금 정할 충돌이 없어요.</p>
      </Modal>
    )
  }
  const challenger = product.conflictClaim === null ? undefined : api.data.claims.get(product.conflictClaim)
  const winners = product.winnerClaims.map((id) => api.data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
  const label = productLabel(api, product.broadcast, product.no)
  const decide = (decision: 'KEEP' | 'SWITCH') => {
    api.queueHost({
      label: `${label} 충돌 ${decision === 'KEEP' ? '그대로 유지' : '바꾸기'}`,
      event: { type: 'host.resolveConflict', b: product.broadcast, no: product.no, decision },
      products: [product.key],
      ...(challenger === undefined ? {} : { claims: [challenger.id] }),
    })
    api.closeAll()
  }
  return (
    <Modal
      title={`충돌 — ${label} ${nameOf(product)}`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button button-primary" data-key="1" onClick={() => decide('KEEP')}>
            1 그대로 유지
          </button>
          <button type="button" className="button button-danger" data-key="2" onClick={() => decide('SWITCH')}>
            2 바꾸기
          </button>
        </>
      }
    >
      {products.length > 1 ? <p className="hint">충돌 {products.length}개 중 첫 번째예요.</p> : null}
      <p>늦게 확인된 앞선 찜이 있어요. 1등을 그대로 둘지 바꿀지 골라 주세요.</p>
      {/* 이름 뒤에 괄호를 더하지 않는다 — 이름 자체의 "문자찜(김씨)" 괄호와 겹치지 않게 " · "로 잇는다 (AC-S06b-20, D-098) */}
      <dl className="facts">
        <div>
          <dt>지금 1등</dt>
          <dd>
            {winners.length === 0
              ? '아직 없음'
              : winners.map((claim) => `${api.names.name(claim.currentBuyer)} · ${ORIGIN_WORD[claim.origin]}`).join(', ')}
          </dd>
        </div>
        <div>
          <dt>앞선 찜</dt>
          <dd>
            {challenger === undefined
              ? '알 수 없음'
              : `${api.names.name(challenger.currentBuyer)} · ${ORIGIN_WORD[challenger.origin]} · ${kstTime(challenger.rankTime)}${challenger.rankMinute ? ' 무렵' : ''}`}
          </dd>
        </div>
      </dl>
      <p className="hint">1 그대로 유지: 앞선 찜은 대기로 가요. 2 바꾸기: 앞선 찜이 1등이 되고 지금 1등은 대기 1순위로 가요.</p>
    </Modal>
  )
}

// ── 취소 요청 (AC-S05-32) ───────────────────────────────────────────────

/** 1등의 취소를 승인하면 어떻게 되는지 (그 방송의 승계 설정, R-8) */
export function successionNote(api: ConsoleApi, product: Product | undefined, claim: Claim | undefined): string | null {
  if (product === undefined || claim === undefined || claim.status !== 'CONFIRMED') return null
  const settings = api.settingsOf(product.broadcast)
  const mode = settings?.['cancel.succession'] ?? 'AUTO'
  const waitlist = product.waitlist.length
  if (waitlist === 0) return '승인하면 1등 자리가 비고 다시 판매 중이 돼요.'
  if (mode === 'REOPEN') return `승인하면 대기자 ${String(waitlist)}명이 모두 정리되고 다시 판매 중이 돼요.`
  if (mode === 'ASK' && settings?.['waitlist.max'] !== 0) return '승인하면 대기자 중 누구를 1등으로 올릴지 정해야 해요(승계 결정 필요).'
  return '승인하면 대기 1순위가 1등이 돼요'
}

export function CancelRequestDialog({ onClose }: { readonly onClose: () => void }) {
  const api = useConsoleApi()
  const requests = [...api.data.cancelRequests.values()].filter((request) => !api.waiting.claims.has(request.claim)).sort((a, b) => a.seq - b.seq)
  const request = requests[0]
  if (request === undefined) {
    return (
      <Modal title="취소 요청" onClose={onClose}>
        <p>지금 처리할 취소 요청이 없어요.</p>
      </Modal>
    )
  }
  return <CancelRequestBody key={request.claim} request={request} count={requests.length} onClose={onClose} />
}

function CancelRequestBody({ request, count, onClose }: { readonly request: CancelRequest; readonly count: number; readonly onClose: () => void }) {
  const api = useConsoleApi()
  const claim = api.data.claims.get(request.claim)
  const product = api.data.products.get(request.product) ?? (claim === undefined ? undefined : api.data.products.get(claim.product))
  const time = useSeqTime(api, request.seq)
  const no = claim?.no ?? product?.no ?? 0
  const b = claim?.broadcast ?? product?.broadcast ?? api.b
  const label = productLabel(api, b, no)
  const name = api.names.name(request.currentBuyer)
  const decide = (type: 'host.approveCancel' | 'host.dismissCancel') => {
    api.queueHost({
      label: `${label} ${name} ${type === 'host.approveCancel' ? '취소 승인' : '취소 요청 무시'}`,
      event: { type, b, no, buyer: request.currentBuyer },
      claims: [request.claim],
      products: [request.product],
    })
    api.closeAll()
  }
  const note = successionNote(api, product, claim)
  return (
    <Modal
      title={`취소 요청 — ${label} ${nameOf(product)}`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button button-danger" data-key="1" onClick={() => decide('host.approveCancel')}>
            1 취소 승인
          </button>
          <button type="button" className="button" data-key="2" onClick={() => decide('host.dismissCancel')}>
            2 요청 무시
          </button>
        </>
      }
    >
      {count > 1 ? <p className="hint">취소 요청 {count}개 중 첫 번째예요.</p> : null}
      <dl className="facts">
        <div>
          <dt>요청한 사람</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt>지금 상태</dt>
          <dd>{claim === undefined ? '알 수 없음' : claimWord(api.data, claim)}</dd>
        </div>
        <div>
          <dt>요청 시각</dt>
          <dd>{time ?? '불러오는 중…'}</dd>
        </div>
      </dl>
      {note !== null ? (
        <p className="warning" data-tone="warning">
          {note}
        </p>
      ) : null}
    </Modal>
  )
}

// ── 승계 결정 (AC-S05-33) ───────────────────────────────────────────────

export function SuccessionDialog({ onClose }: { readonly onClose: () => void }) {
  const api = useConsoleApi()
  const products = [...api.data.products.values()].filter((product) => product.awaitingSuccession && !api.waiting.products.has(product.key))
  const product = products[0]
  if (product === undefined) {
    return (
      <Modal title="승계 결정 필요" onClose={onClose}>
        <p>지금 정할 승계가 없어요.</p>
      </Modal>
    )
  }
  const label = productLabel(api, product.broadcast, product.no)
  const waiters = product.waitlistClaims.map((id) => api.data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
  return (
    <Modal title={`승계 결정 — ${label} ${nameOf(product)}`} onClose={onClose} wide>
      {products.length > 1 ? <p className="hint">승계 결정 {products.length}개 중 첫 번째예요.</p> : null}
      <p>1등 자리가 비었어요. 대기자 중 1등으로 올릴 사람을 고르거나, 대기자를 정리하고 다시 판매해 주세요.</p>
      <ol className="plain-list stack-tight">
        {waiters.map((claim, index) => {
          const name = api.names.name(claim.currentBuyer)
          const key = index < 3 ? String(index + 1) : undefined
          return (
            <li key={claim.id} className="row">
              <span>
                대기 {index + 1}번 {name}
              </span>
              <button
                type="button"
                className="button"
                data-key={key}
                onClick={() =>
                  openReasonAction(api, {
                    title: `${label} ${name} 1등으로`,
                    submitLabel: '1등으로 올리기',
                    label: `${label} ${name} 1등으로`,
                    claims: [claim.id],
                    products: [product.key],
                    build: (reason) => ({ type: 'host.promote', b: product.broadcast, no: product.no, buyer: claim.currentBuyer, reason }),
                  })
                }
              >
                {key === undefined ? '' : `${key} `}
                {name} 1등으로
              </button>
            </li>
          )
        })}
      </ol>
      <button type="button" className="button button-danger" onClick={() => openReopenAction(api, product)}>
        다시 판매(대기자 정리)
      </button>
    </Modal>
  )
}

// ── 보류 찜 (AC-S05-30, ORD-06 AC2, R-5) ────────────────────────────────

/** 보류 찜 창의 시계: 연 순간의 지금 시각으로 시작해 1초마다 (AC-S06-66 010 — 첫 그림부터 경과 초가 맞다) */
function useClock(fixed: number | undefined): number {
  const [now, setNow] = useState(() => fixed ?? Date.now())
  useEffect(() => {
    if (fixed !== undefined) return
    const handle = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(handle)
  }, [fixed])
  return fixed ?? now
}

export function PendingDialog({ onClose, now: fixedNow }: { readonly onClose: () => void; readonly now?: number }) {
  const api = useConsoleApi()
  const now = useClock(fixedNow)
  const groups = orphanPending(api.data)
  const expired = [...api.data.claims.values()]
    .filter((claim) => claim.status === 'REJECTED' && claim.reason === 'EXPIRED')
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 20)
  return (
    <Modal title="보류 찜" onClose={onClose} wide>
      {groups.length === 0 ? <p>상품이 없는 번호의 보류 찜이 없어요.</p> : null}
      <ul className="plain-list stack-tight">
        {groups.map((group) => {
          const window = api.settingsOf(group.broadcast)?.['claim.preOpenWindowSec'] ?? 30
          const oldest = Math.min(...group.claims.map((claim) => Date.parse(claim.at)))
          const ageMs = Number.isFinite(oldest) ? Math.max(0, now - oldest) : 0
          const age = Math.floor(ageMs / 1000)
          // R-5: 공개 시각 T에 at ≥ T − 유효 시간이면 유효 — 지금 등록하면 만료되는 것은 지난 시간이 유효 시간보다 길 때(밀리초로 비교)
          const expires = ageMs > window * 1000
          const label = productLabel(api, group.broadcast, group.no)
          return (
            <li key={group.product} className="row">
              <span>
                {label} 보류 찜 {group.claims.length}개 · 가장 오래된 찜 {age}초 전
              </span>
              {expires ? <span className="tag tag-alert">지금 등록하면 만료돼요</span> : null}
              {group.broadcast === api.b ? (
                <button type="button" className="button" aria-label={`${String(group.no)}번 번호 넣기`} onClick={() => api.fillQuick(`${String(group.no)} `)}>
                  번호 넣기
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
      <h3 className="sub-title">최근 만료된 찜</h3>
      {expired.length === 0 ? <p>없어요.</p> : null}
      <ul className="plain-list">
        {expired.map((claim) => (
          <li key={claim.id}>
            {productLabel(api, claim.broadcast, claim.no)} {api.names.name(claim.currentBuyer)} · {REJECT_REASON_WORD.EXPIRED}
          </li>
        ))}
      </ul>
    </Modal>
  )
}

// ── 확인 필요 (AC-S05-30, AC-S04-24) ────────────────────────────────────

export function AttentionDialog({ onClose }: { readonly onClose: () => void }) {
  const api = useConsoleApi()
  return (
    <Modal title="확인 필요" onClose={onClose} wide>
      {api.data.attention.length === 0 ? <p>확인할 입력이 없어요.</p> : null}
      <ul className="plain-list stack-tight">
        {api.data.attention.map((item) => (
          <AttentionRow key={item.seq} seq={item.seq} message={item.message} />
        ))}
      </ul>
    </Modal>
  )
}

function AttentionRow({ seq, message }: { readonly seq: number; readonly message: string }) {
  const api = useConsoleApi()
  const time = useSeqTime(api, seq)
  return (
    <li>
      {seq}번째 입력 · {time ?? '시각 불러오는 중…'} · {message}
    </li>
  )
}
