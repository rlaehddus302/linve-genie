// 구매자 (SPEC §7 화면 4, BUY-01 AC2, BUY-02, BUY-03, BUY-04, STL-01, R-11, R-12, D-090·D-091, AC-S06-20~24).
// - 날짜 하나(실제·리허설)를 고른다. 목록 기본은 그날 확정 찜이 있는 지금의 구매자, "찜 없는 구매자도 보기"로 넓힌다. 찾기는 그날 기록된 모든 구매자에서.
// - 자세히: 표시 이름·이력·뒤 4자리·채널 끝 4자리·차단·합친 구매자, 방송별 확정 상품과 합계, 합계에 들지 않는 찜, 그날 정산 묶음 요약.
// - 합치기(미리 보기 확인 뒤 바로)·떼어 내기(바로)·차단(사유, 5초 뒤 — 콘솔과 같은 조치).
// - 전화번호는 뒤 4자리만(원문은 저장하지 않는다, D-073).
import { useMemo, useRef, useState } from 'react'
import type { Buyer, Claim } from '../api/types.ts'
import { buyerList, claimsOf, defaultInto, distinguishWords, isActive, planMerge, sameNameCounts, searchBuyers, settlementOf, channelTail, type BuyerSort } from '../lib/buyers.ts'
import type { ConsoleSnapshot, ConsoleStore } from '../lib/console-store.ts'
import { claimWord, formatWon, type BuyerNames } from '../lib/derive.ts'
import { useUndoQueue } from '../lib/host-delay.ts'
import { routePath, type Navigate, type ScopeRoute } from '../lib/router.ts'
import type { ScopeData } from '../lib/scope-data.ts'
import { useScopeStore } from '../lib/use-store.ts'
import type { UndoQueue } from '../lib/undo-queue.ts'
import { BUYER_KIND_WORD, ORIGIN_WORD, paymentWord } from '../lib/words.ts'
import { openBlockAction, openClaimAction } from './actions.ts'
import { productLabel, type ConsoleApi } from './console-context.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { WriteError, useSender } from './forms.tsx'
import { useHostActions } from './host-actions.tsx'
import { LiveNotices } from './LiveNotices.tsx'
import { Modal } from './Modal.tsx'
import { ReasonField } from './ReasonField.tsx'
import { ScopePicker, useScopeChoice } from './ScopePicker.tsx'
import { UndoBar } from './UndoBar.tsx'

/** 목록을 나눠 그리는 크기 (상품 500·채팅 1만 범위에서도 멈추지 않게, AC-S06-20) */
const PAGE = 100
export const MERGE_REASONS: readonly string[] = ['같은 사람', '같은 집 배송']
export const UNMERGE_REASONS: readonly string[] = ['잘못 합침', '따로 배송']
export const MERGE_SAME_DAY = '합치기는 같은 날짜 안에서만 돼요.'

export function BuyersPage({ route, navigate }: { readonly route: ScopeRoute; readonly navigate: Navigate }) {
  const choice = useScopeChoice(route, navigate)
  const scope = choice.scope
  const key = scope === null ? null : `${scope.date}|${String(scope.rehearsal)}`
  const { store, snapshot } = useScopeStore(key, () => ({ scope: scope ?? { date: '', rehearsal: false } }))
  const queue = useUndoQueue()
  return (
    <main className="page page-wide buyers-page">
      <h1>구매자</h1>
      <div className="row scope-row">
        <ScopePicker route={route} navigate={navigate} days={choice.days} error={choice.error} onRetry={choice.retry} />
        {route.rehearsal ? <span className="tag tag-rehearsal">리허설</span> : null}
      </div>
      <p className="hint">{MERGE_SAME_DAY}</p>
      {scope === null ? (
        choice.days !== null ? <p>아직 판매 기록이 없어요.</p> : null
      ) : snapshot.phase === 'missing' ? (
        <p>아직 판매 기록이 없어요.</p>
      ) : snapshot.phase === 'error' && snapshot.error !== null ? (
        <ErrorNote error={snapshot.error} onRetry={() => window.location.reload()} retryLabel="다시 열기" />
      ) : store === null || queue === null || snapshot.data === null ? (
        <>
          <div className="page-sticky">
            <LiveNotices snapshot={snapshot} onRetry={() => void store?.retryNow()} />
          </div>
          <p role="status">불러오는 중…</p>
        </>
      ) : (
        <ReadyBuyers key={key} route={route} navigate={navigate} store={store} snapshot={snapshot} data={snapshot.data} queue={queue} />
      )}
    </main>
  )
}

interface ReadyProps {
  readonly route: ScopeRoute
  readonly navigate: Navigate
  readonly store: ConsoleStore
  readonly snapshot: ConsoleSnapshot
  readonly data: ScopeData
  readonly queue: UndoQueue
}

function ReadyBuyers({ route, navigate, store, snapshot, data, queue }: ReadyProps) {
  const host = useHostActions({ store, data, queue, date: data.date, rehearsal: data.rehearsal, b: '', ended: false })
  const [notice, setNotice] = useState<string | null>(null)
  const open = (buyer: string | undefined) => {
    setNotice(null)
    navigate({ name: 'buyers', date: data.date, rehearsal: data.rehearsal, ...(buyer === undefined ? {} : { buyer }) })
  }
  const selected = route.buyer === undefined ? undefined : data.buyers.get(route.buyer)
  return (
    <>
      <div className="page-sticky">
        <LiveNotices snapshot={snapshot} onRetry={() => void store.retryNow()} />
        <UndoBar items={host.items} queue={queue} />
      </div>
      {notice !== null ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {route.buyer === undefined ? (
        <BuyerList api={host.api} onOpen={open} />
      ) : selected === undefined ? (
        <div className="stack-tight">
          <p>그 구매자를 찾지 못했어요.</p>
          <button type="button" className="button" onClick={() => open(undefined)}>
            구매자 목록으로
          </button>
        </div>
      ) : (
        <BuyerDetail
          key={selected.id}
          api={host.api}
          buyer={selected}
          onOpen={open}
          onMerged={(target) => {
            open(target)
            setNotice('합쳤어요')
          }}
          onSettlement={(buyer) => navigate({ name: 'settlements', date: data.date, rehearsal: data.rehearsal, buyer })}
          onUnmerged={() => setNotice('떼어 냈어요')}
        />
      )}
      {host.dialog}
    </>
  )
}

// ── 목록·찾기 (AC-S06-20·21) ────────────────────────────────────────────

function BuyerRowBody({ api, buyer, counts }: { readonly api: ConsoleApi; readonly buyer: Buyer; readonly counts: ReadonlyMap<string, number> }) {
  const settlement = settlementOf(api.data, buyer.id)
  return (
    <>
      <strong className="buyer-name">{buyer.display}</strong>
      <span className="tag">{BUYER_KIND_WORD[buyer.kind]}</span>
      {distinguishWords(buyer, counts).map((word) => (
        <span key={word}>{word}</span>
      ))}
      <span>
        {buyer.items.length}개 · {formatWon(buyer.subtotal)}
      </span>
      {settlement !== undefined ? <span className={`tag pay-${settlement.payment}`}>{paymentWord(settlement.payment, settlement.refundDue)}</span> : null}
      {buyer.blocked ? <span className="tag tag-alert">차단</span> : null}
      {buyer.merged.length > 0 ? <span>합친 구매자 {buyer.merged.length}명</span> : null}
    </>
  )
}

function BuyerLink({ api, buyer, counts, onOpen, extra }: { readonly api: ConsoleApi; readonly buyer: Buyer; readonly counts: ReadonlyMap<string, number>; readonly onOpen: (id: string) => void; readonly extra?: string }) {
  return (
    <a
      className="list-link"
      href={routePath({ name: 'buyers', date: api.data.date, rehearsal: api.data.rehearsal, buyer: buyer.id })}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey) return
        event.preventDefault()
        onOpen(buyer.id)
      }}
    >
      <BuyerRowBody api={api} buyer={buyer} counts={counts} />
      {extra !== undefined ? <span>{extra}</span> : null}
    </a>
  )
}

function BuyerList({ api, onOpen }: { readonly api: ConsoleApi; readonly onOpen: (id: string | undefined) => void }) {
  const [all, setAll] = useState(false)
  const [sort, setSort] = useState<BuyerSort>('name')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const counts = useMemo(() => sameNameCounts(api.data.buyers), [api.data.buyers])
  const list = useMemo(() => buyerList(api.data.buyers, { all, sort }), [api.data.buyers, all, sort])
  const hits = useMemo(() => searchBuyers(api.data.buyers, query, 100), [api.data.buyers, query])
  const total = list.reduce((sum, buyer) => sum + buyer.subtotal, 0)
  const searching = query.trim() !== ''
  return (
    <section className="stack" aria-label="구매자 목록">
      <div className="toolbar">
        <div className="field">
          <label htmlFor="buyer-search">구매자 찾기</label>
          <input id="buyer-search" className="input" type="search" autoComplete="off" placeholder="닉네임·메모·뒤 4자리" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <label className="choice">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => {
              setAll(event.target.checked)
              setShown(PAGE)
            }}
          />
          <span>찜 없는 구매자도 보기</span>
        </label>
        <div className="row" role="group" aria-label="정렬">
          <button type="button" className="button" aria-pressed={sort === 'name'} onClick={() => setSort('name')}>
            이름 순
          </button>
          <button type="button" className="button" aria-pressed={sort === 'total'} onClick={() => setSort('total')}>
            합계 큰 순
          </button>
        </div>
      </div>
      {searching ? (
        <>
          <p role="status">찾은 구매자 {hits.length}명</p>
          {hits.length === 0 ? <p>찾는 구매자가 없어요.</p> : null}
          <ul className="plain-list stack-tight" aria-label="찾은 구매자">
            {hits.map((hit) => (
              <li key={hit.current.id}>
                <BuyerLink
                  api={api}
                  buyer={hit.current}
                  counts={counts}
                  onOpen={onOpen}
                  {...(hit.matched.id === hit.current.id ? {} : { extra: `${hit.matched.display} — ${hit.current.display}에 합쳐짐` })}
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="summary-line" role="status">
            구매자 {list.length}명 · 합계 {formatWon(total)}
          </p>
          {list.length === 0 ? <p>{all ? '그날 기록된 구매자가 없어요.' : '그날 1등 찜이 있는 구매자가 없어요.'}</p> : null}
          <ul className="plain-list stack-tight" aria-label="구매자">
            {list.slice(0, shown).map((buyer) => (
              <li key={buyer.id}>
                <BuyerLink api={api} buyer={buyer} counts={counts} onOpen={onOpen} />
              </li>
            ))}
          </ul>
          {list.length > shown ? (
            <button type="button" className="button" onClick={() => setShown((n) => n + PAGE)}>
              더 보기 ({list.length - shown}명 더)
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}

// ── 자세히 (AC-S06-22) ──────────────────────────────────────────────────

interface DetailProps {
  readonly api: ConsoleApi
  readonly buyer: Buyer
  readonly onOpen: (id: string | undefined) => void
  readonly onMerged: (target: string) => void
  readonly onUnmerged: () => void
  readonly onSettlement: (buyer: string) => void
}

function BuyerDetail({ api, buyer, onOpen, onMerged, onUnmerged, onSettlement }: DetailProps) {
  const [merging, setMerging] = useState(false)
  const [unmerging, setUnmerging] = useState<string | null>(null)
  const [productDialog, setProductDialog] = useState<{ broadcast: string; no: number; product: string } | null>(null)
  const names = api.names
  const current = buyer.mergedInto === null ? buyer : (api.data.buyers.get(buyer.current) ?? buyer)
  const claims = useMemo(() => claimsOf(api.data, current.id), [api.data, current.id])
  const confirmed = claims.filter((claim) => claim.status === 'CONFIRMED')
  const others = claims.filter((claim) => claim.status !== 'CONFIRMED' && isActive(claim))
  const settlement = settlementOf(api.data, current.id)
  const byBroadcast = useMemo(() => {
    const groups = new Map<string, Claim[]>()
    for (const claim of confirmed) groups.set(claim.broadcast, [...(groups.get(claim.broadcast) ?? []), claim])
    const order = [...api.data.broadcasts.keys()]
    return [...groups.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
  }, [confirmed, api.data.broadcasts])
  const history = buyer.nameHistory.filter((name) => name !== buyer.display)

  return (
    <section className="stack buyer-detail" aria-label="구매자 자세히">
      <button type="button" className="button back-button" onClick={() => onOpen(undefined)}>
        구매자 목록으로
      </button>
      <h2 className="section-title">{names.name(buyer.id)}</h2>
      <dl className="facts">
        <div>
          <dt>종류</dt>
          <dd>{BUYER_KIND_WORD[buyer.kind]}</dd>
        </div>
        {history.length > 0 ? (
          <div>
            <dt>{buyer.kind === 'youtube' ? '닉네임 이력' : '메모 이력'}</dt>
            <dd>{history.join(', ')}</dd>
          </div>
        ) : null}
        {buyer.phoneLast4 !== null ? (
          <div>
            <dt>전화번호</dt>
            <dd>뒤 4자리 {buyer.phoneLast4}</dd>
          </div>
        ) : null}
        {buyer.kind === 'youtube' ? (
          <div>
            <dt>채널</dt>
            <dd>끝 {channelTail(buyer)}</dd>
          </div>
        ) : null}
        <div>
          <dt>차단</dt>
          <dd>{buyer.blocked ? <span className="tag tag-alert">차단</span> : '아니요'}</dd>
        </div>
      </dl>
      {buyer.mergedInto !== null ? (
        <p className="notice">
          {names.name(buyer.mergedInto)}에 합쳐져 있어요.{' '}
          <button type="button" className="button" onClick={() => onOpen(buyer.current)}>
            {names.name(buyer.current)} 자세히
          </button>
        </p>
      ) : null}

      <div className="row">
        {buyer.mergedInto === null ? (
          <button type="button" className="button button-primary" onClick={() => setMerging(true)}>
            다른 구매자와 합치기
          </button>
        ) : null}
        <button type="button" className="button" onClick={() => openBlockAction(api, buyer.id, !buyer.blocked)}>
          {buyer.blocked ? '차단 풀기' : '차단하기'}
        </button>
      </div>

      {current.merged.length > 0 && buyer.mergedInto === null ? (
        <section className="stack-tight" aria-label="합친 구매자">
          <h3 className="sub-title">합친 구매자 {current.merged.length}명</h3>
          <ul className="plain-list stack-tight">
            {current.merged.map((id) => (
              <li key={id} className="row claim-row">
                <span>{names.name(id)}</span>
                <button type="button" className="button" aria-label={`${names.name(id)} 떼어 내기`} onClick={() => setUnmerging(id)}>
                  떼어 내기
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="stack-tight" aria-label="확정 상품">
        <h3 className="sub-title">확정 상품</h3>
        {byBroadcast.length === 0 ? <p>1등 찜이 없어요.</p> : null}
        {byBroadcast.map(([b, list]) => {
          const title = api.data.broadcasts.get(b)?.title ?? ''
          return (
            <div key={b} className="stack-tight">
              <h4 className="sub-title">{title}</h4>
              <ul className="plain-list">
                {list.map((claim) => {
                  const product = api.data.products.get(claim.product)
                  const name = product === undefined ? '' : product.name.trim() === '' ? '품종 미입력' : product.name
                  return (
                    <li key={claim.id}>
                      {claim.no}번 {name} {claim.price === null ? '' : formatWon(claim.price)} · {ORIGIN_WORD[claim.origin]}
                      {claim.buyer !== current.id ? ` · ${names.name(claim.buyer)}` : ''}
                    </li>
                  )
                })}
              </ul>
              <p>
                {title} 합계 {formatWon(current.byBroadcast[b] ?? 0)}
              </p>
            </div>
          )
        })}
        <p className="total-line">전체 합계 {formatWon(current.subtotal)}</p>
      </section>

      {others.length > 0 ? (
        <section className="stack-tight" aria-label="합계에 들지 않는 찜">
          <h3 className="sub-title">합계에 들지 않는 찜</h3>
          <ul className="plain-list">
            {others.map((claim) => (
              <li key={claim.id}>
                {productLabel(api, claim.broadcast, claim.no)} {claimWord(api.data, claim)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="stack-tight" aria-label="정산 요약">
        <h3 className="sub-title">그날 정산</h3>
        {settlement === undefined ? (
          <p>정산할 것이 없어요.</p>
        ) : (
          <p>
            최종 {formatWon(settlement.total)} · 받은 금액 {formatWon(settlement.received)} · {paymentWord(settlement.payment, settlement.refundDue)}
          </p>
        )}
        <button type="button" className="button" onClick={() => onSettlement(current.id)}>
          정산 자세히
        </button>
      </section>

      {merging ? (
        <MergeDialog
          api={api}
          opened={buyer}
          onClose={() => setMerging(false)}
          onDone={(target) => {
            setMerging(false)
            onMerged(target)
          }}
          onProduct={(target) => {
            setMerging(false)
            setProductDialog(target)
          }}
        />
      ) : null}
      {unmerging !== null ? (
        <UnmergeDialog
          api={api}
          from={unmerging}
          onClose={() => setUnmerging(null)}
          onDone={() => {
            setUnmerging(null)
            onUnmerged()
          }}
        />
      ) : null}
      {productDialog !== null ? <ProductWinnersDialog api={api} target={productDialog} onClose={() => setProductDialog(null)} /> : null}
    </section>
  )
}

// ── 합치기 (AC-S06-23) ──────────────────────────────────────────────────

function MergeDialog({
  api,
  opened,
  onClose,
  onDone,
  onProduct,
}: {
  readonly api: ConsoleApi
  readonly opened: Buyer
  readonly onClose: () => void
  readonly onDone: (target: string) => void
  readonly onProduct: (target: { broadcast: string; no: number; product: string }) => void
}) {
  const [query, setQuery] = useState('')
  const [other, setOther] = useState<Buyer | null>(null)
  const [into, setInto] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [empty, setEmpty] = useState(false)
  const [notApplied, setNotApplied] = useState(false)
  const reasonField = useRef<HTMLInputElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const sender = useSender(api.command)
  const counts = useMemo(() => sameNameCounts(api.data.buyers), [api.data.buyers])
  const hits = useMemo(() => searchBuyers(api.data.buyers, query, 20).filter((hit) => hit.matched.id !== opened.id), [api.data.buyers, query, opened.id])

  if (other === null) {
    return (
      <Modal title="다른 구매자와 합치기" onClose={onClose} wide>
        <p className="hint">{MERGE_SAME_DAY}</p>
        <div className="field">
          <label htmlFor="merge-search">합칠 구매자 찾기</label>
          <input id="merge-search" className="input" type="search" autoComplete="off" placeholder="닉네임·메모·뒤 4자리" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {query.trim() !== '' && hits.length === 0 ? <p>찾는 구매자가 없어요.</p> : null}
        <ul className="plain-list stack-tight" aria-label="합칠 구매자">
          {hits.map((hit) => (
            <li key={hit.matched.id}>
              <button
                type="button"
                className="choice-button"
                onClick={() => {
                  const chosen = hit.matched
                  setOther(chosen)
                  setInto(defaultInto(opened, chosen).id)
                }}
              >
                <strong>{api.names.name(hit.matched.id)}</strong>
                <span className="tag">{BUYER_KIND_WORD[hit.matched.kind]}</span>
                {distinguishWords(hit.matched, counts).map((word) => (
                  <span key={word}>{word}</span>
                ))}
                <span>
                  {hit.matched.items.length}개 · {formatWon(hit.matched.subtotal)}
                </span>
                {hit.matched.mergedInto !== null ? <span>{`${api.names.name(hit.matched.current)}에 합쳐짐`}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    )
  }

  const intoId = into ?? opened.id
  const fromId = intoId === opened.id ? other.id : opened.id
  const plan = planMerge(api.data, api.names, fromId, intoId, (b, no) => productLabel(api, b, no))
  if (plan === null) {
    return (
      <Modal title="구매자 합치기" onClose={onClose}>
        <p>그 구매자를 찾지 못했어요.</p>
      </Modal>
    )
  }
  const blocked = plan.blocks.length > 0
  const targetName = api.names.name(plan.target.id)
  const submit = async () => {
    if (blocked) return
    const value = reason.trim()
    if (value === '') {
      setEmpty(true)
      reasonField.current?.focus()
      return
    }
    setNotApplied(false)
    const result = await sender.send({ type: 'buyer.merge', from: plan.from.id, into: plan.into.id, reason: value })
    if (result === null) return
    if (!result.changed) {
      setNotApplied(true)
      return
    }
    onDone(plan.target.id)
  }
  return (
    <Modal
      title="구매자 합치기"
      onClose={onClose}
      wide
      actions={
        <button ref={submitButton} type="button" className="button button-danger" disabled={blocked || sender.busy} onClick={() => void submit()}>
          {sender.busy ? '보내는 중…' : '합치기'}
        </button>
      }
    >
      <p className="merge-direction">
        <strong>
          남는 이름: {targetName}({BUYER_KIND_WORD[plan.target.kind]})
        </strong>{' '}
        ← {api.names.name(plan.from.id)}({BUYER_KIND_WORD[plan.from.kind]})
      </p>
      <button type="button" className="button" onClick={() => setInto(fromId)}>
        방향 바꾸기
      </button>
      {/* 막히면 합치기가 일어나지 않으므로 합친 뒤의 금액·이름을 보이지 않는다 (이미 합쳐진 금액을 두 번 세지 않게, TE-S06-002) */}
      {plan.afterTotal !== null ? (
        <ul className="plain-list stack-tight" aria-label="합치면">
          <li>
            옮겨 갈 확정 찜 {plan.movingCount}개 · {formatWon(plan.movingTotal)}
          </li>
          <li>합친 뒤 합계 {formatWon(plan.afterTotal)}</li>
          <li>정산 묶음이 하나가 되어 배송비가 한 번 붙어요</li>
          <li>합친 뒤 표시 이름은 {targetName}이고, 공개 감사 문구의 이름은 바뀌지 않아요.</li>
        </ul>
      ) : null}
      {plan.duplicates.length > 0 ? (
        <div className="warning stack-tight" role="note">
          {plan.duplicates.map((line) => (
            <p key={line.claim.id}>{line.text}</p>
          ))}
          <p>떼어 내도 돌아오지 않아요.</p>
        </div>
      ) : null}
      {plan.blocks.map((block) =>
        block.kind === 'bothWinners' ? (
          <div key={block.kind} className="error-note" role="alert">
            {block.products.map((item) => (
              <p key={item.product} className="row">
                <span>{item.text}</span>
                <button type="button" className="button" onClick={() => onProduct(item)}>
                  {productLabel(api, item.broadcast, item.no)} 자세히
                </button>
              </p>
            ))}
          </div>
        ) : (
          <p key={block.kind} className="error-note" role="alert">
            {block.text}
          </p>
        ),
      )}
      {!blocked ? (
        <ReasonField
          value={reason}
          onChange={(value) => {
            setReason(value)
            setEmpty(false)
          }}
          onPicked={() => submitButton.current?.focus()}
          reasons={MERGE_REASONS}
          empty={empty}
          error={sender.error}
          inputRef={reasonField}
          onEnter={() => void submit()}
        />
      ) : null}
      {notApplied ? (
        <p className="error-note" role="alert">
          합치지 못했어요. 지금 상태를 확인해 주세요.
        </p>
      ) : null}
      {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void submit()} omitFields={['reason']} /> : null}
    </Modal>
  )
}

/** 두 사람 모두 1등인 상품: 1등 찜을 보이고 "찜 취소하기"(사유, 5초 뒤 — 콘솔과 같다) */
function ProductWinnersDialog({ api, target, onClose }: { readonly api: ConsoleApi; readonly target: { broadcast: string; no: number; product: string }; readonly onClose: () => void }) {
  const product = api.data.products.get(target.product)
  const label = productLabel(api, target.broadcast, target.no)
  const winners = (product?.winnerClaims ?? []).map((id) => api.data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
  return (
    <Modal title={`${label} 자세히`} onClose={onClose}>
      {product !== undefined ? <p>{product.name.trim() === '' ? '품종 미입력' : product.name}</p> : null}
      <section className="stack-tight" aria-label="1등">
        <h3 className="sub-title">1등 {winners.length}명</h3>
        <ul className="plain-list stack-tight">
          {winners.map((claim) => (
            <li key={claim.id} className="claim-row">
              <p>
                <strong>{api.names.name(claim.currentBuyer)}</strong> <span>{ORIGIN_WORD[claim.origin]}</span>
                {api.waiting.claims.has(claim.id) ? <span className="tag tag-waiting">보내기 전</span> : null}
              </p>
              <button
                type="button"
                className="button button-small"
                onClick={() => {
                  onClose()
                  openClaimAction(api, claim, 'host.cancel')
                }}
              >
                찜 취소하기
              </button>
            </li>
          ))}
        </ul>
      </section>
    </Modal>
  )
}

// ── 떼어 내기 (AC-S06-24) ────────────────────────────────────────────────

export function unmergeSentence(names: BuyerNames, buyer: Buyer): string {
  const name = names.name(buyer.id)
  const rest = buyer.merged.length
  const head = rest > 0 ? `${name}(그리고 ${name}에 합쳐 있던 ${String(rest)}명)을` : `${name}${objectParticle(name)}`
  return `${head} 떼어 내요. 중복으로 정리된 찜은 돌아오지 않아요. 입금·환불 기록은 적힌 구매자에 남아요.`
}

/** 받침이 있으면 "을", 없으면 "를" (한글이 아니면 "을(를)") */
function objectParticle(word: string): string {
  for (let i = word.length - 1; i >= 0; i--) {
    const code = word.charCodeAt(i)
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? '를' : '을'
  }
  return '을(를)'
}

function UnmergeDialog({ api, from, onClose, onDone }: { readonly api: ConsoleApi; readonly from: string; readonly onClose: () => void; readonly onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [empty, setEmpty] = useState(false)
  const [notApplied, setNotApplied] = useState(false)
  const reasonField = useRef<HTMLInputElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const sender = useSender(api.command)
  const buyer = api.data.buyers.get(from)
  if (buyer === undefined) {
    return (
      <Modal title="떼어 내기" onClose={onClose}>
        <p>그 구매자를 찾지 못했어요.</p>
      </Modal>
    )
  }
  const submit = async () => {
    const value = reason.trim()
    if (value === '') {
      setEmpty(true)
      reasonField.current?.focus()
      return
    }
    setNotApplied(false)
    const result = await sender.send({ type: 'buyer.unmerge', from, reason: value })
    if (result === null) return
    if (!result.changed) {
      setNotApplied(true)
      return
    }
    onDone()
  }
  return (
    <Modal
      title={`${api.names.name(from)} 떼어 내기`}
      onClose={onClose}
      actions={
        <button ref={submitButton} type="button" className="button button-danger" disabled={sender.busy} onClick={() => void submit()}>
          {sender.busy ? '보내는 중…' : '떼어 내기'}
        </button>
      }
    >
      <p>{unmergeSentence(api.names, buyer)}</p>
      <ReasonField
        value={reason}
        onChange={(value) => {
          setReason(value)
          setEmpty(false)
        }}
        onPicked={() => submitButton.current?.focus()}
        reasons={UNMERGE_REASONS}
        empty={empty}
        error={sender.error}
        inputRef={reasonField}
        onEnter={() => void submit()}
      />
      {notApplied ? (
        <p className="error-note" role="alert">
          떼어 내지 못했어요. 합친 동안 적은 환불이 한쪽 입금보다 많아요. 정산 기록을 먼저 확인해 주세요.
        </p>
      ) : null}
      {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void submit()} omitFields={['reason']} /> : null}
    </Modal>
  )
}
