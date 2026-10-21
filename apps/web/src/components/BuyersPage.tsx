// 구매자 (SPEC §7 화면 4, BUY-01 AC2, BUY-02, BUY-03, BUY-04, STL-01, R-11, R-12, D-090·D-091·D-098·D-100~D-102, AC-S06-20~24, AC-S06b-20·21·24·33·34·40).
// - 날짜 하나(실제·리허설)를 고른다. 목록 기본은 그날 확정 찜이 있는 지금의 구매자, "찜 없는 구매자도 보기"로 넓힌다. 찾기는 그날 기록된 모든 구매자에서.
//   PC(48rem 이상)는 열 머리가 있는 표, 휴대폰은 카드 (D-101). 이름은 화면 공통 이름 표기(BuyerNames, D-098).
// - 자세히: 표시 이름·이력·뒤 4자리·채널 끝 4자리·차단·합친 구매자, 방송별 확정 상품과 합계, 합계에 들지 않는 찜, 그날 정산 묶음 요약.
//   주 버튼은 없다 — "다른 구매자와 합치기"·"떼어 내기"는 보통 버튼, "차단하기"는 위험 버튼 (D-101).
// - 합치기: 미리 보기는 서버(코어 previewMerge)가 계산한 값을 낱말로만 바꾼다(D-100). 상대·방향은 주소(merge·into)에 남아, 막힘에서 연
//   상품 자세히(product)에 갔다 와도(합치기로 돌아가기·브라우저 뒤로 가기) 같은 창이 다시 열리고 미리 보기를 지금 상태로 새로 받는다 (D-102).
// - 떼어 내기(바로)·차단(사유, 5초 뒤 — 콘솔과 같은 조치).
// - 전화번호는 뒤 4자리만(원문은 저장하지 않는다, D-073).
// - 실제 범위의 자세히에는 "지난 구매"(채널 ID·전화번호 키로 이은 다른 날짜의 묶음 — 누르면 그 날짜의 정산 자세히, I2 AC-I2-41).
// - I3: 봉인 예정 날짜면 "이 날짜 기록은 … 봉인돼요"(7일 전부터 경고 상자), 봉인한 날짜는 볼 수만 있다 — 합치기·떼어 내기·차단이 잠긴다 (AC-I3-40·41).
import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { Buyer, Claim } from '../api/types.ts'
import {
  buyerList,
  channelTail,
  claimsOf,
  defaultInto,
  distinguishWords,
  isActive,
  mergeWords,
  objectParticle,
  sameNameCounts,
  searchBuyers,
  settlementOf,
  splitProductKey,
  type BuyerSort,
} from '../lib/buyers.ts'
import type { ConsoleSnapshot, ConsoleStore } from '../lib/console-store.ts'
import { claimOptionWords, claimWord, formatWon, productSlots, type BuyerNames } from '../lib/derive.ts'
import { useUndoQueue } from '../lib/host-delay.ts'
import { PREVIEW_FAILED, PREVIEW_LOADING, PREVIEW_REFRESHING, useMergePreview } from '../lib/merge-preview.ts'
import { routePath, type Navigate, type ScopeRoute } from '../lib/router.ts'
import type { ScopeData } from '../lib/scope-data.ts'
import { useScopeStore } from '../lib/use-store.ts'
import { useWide } from '../lib/use-wide.ts'
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
import { PastPurchases } from './PastPurchases.tsx'
import { Lock } from './Lock.tsx'
import { ScopePicker, sealOf, useScopeChoice } from './ScopePicker.tsx'
import { SealNotice } from './SealNotice.tsx'
import { ReadOnlyContext } from '../lib/read-only.ts'
import { UndoBar } from './UndoBar.tsx'

/** 목록을 나눠 그리는 크기 (상품 500·채팅 1만 범위에서도 멈추지 않게, AC-S06-20) */
const PAGE = 100
export const MERGE_REASONS: readonly string[] = ['같은 사람', '같은 집 배송']
export const UNMERGE_REASONS: readonly string[] = ['잘못 합침', '따로 배송']
export const MERGE_SAME_DAY = '합치기는 같은 날짜 안에서만 돼요.'
export const MERGED_NOTICE = '합쳤어요'
export const UNMERGED_NOTICE = '떼어 냈어요'
export const BACK_TO_MERGE = '합치기로 돌아가기'

export function BuyersPage({ route, navigate }: { readonly route: ScopeRoute; readonly navigate: Navigate }) {
  const choice = useScopeChoice(route, navigate)
  const scope = choice.scope
  const key = scope === null ? null : `${scope.date}|${String(scope.rehearsal)}`
  const { store, snapshot } = useScopeStore(key, () => ({ scope: scope ?? { date: '', rehearsal: false } }))
  const queue = useUndoQueue()
  const seal = sealOf(choice.days, scope)
  return (
    <main className="page page-wide buyers-page">
      <h1>구매자</h1>
      <div className="row scope-row">
        <ScopePicker route={route} navigate={navigate} days={choice.days} error={choice.error} onRetry={choice.retry} />
        {route.rehearsal ? <span className="tag tag-rehearsal">리허설</span> : null}
      </div>
      <SealNotice sealAt={seal.sealAt} sealed={seal.sealed || snapshot.sealed} />
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

/** 주소의 합치기 창 (상대·남는 쪽) — 구매자 ID만 */
interface MergeTarget {
  readonly other: string
  readonly into: string
}

function ReadyBuyers({ route, navigate, store, snapshot, data, queue }: ReadyProps) {
  const host = useHostActions({ store, data, queue, date: data.date, rehearsal: data.rehearsal, b: '', ended: false, sealed: snapshot.sealed })
  const [notice, setNotice] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const base: ScopeRoute = { name: 'buyers', date: data.date, rehearsal: data.rehearsal }
  const open = (buyer: string | undefined) => {
    setNotice(null)
    setSearching(false)
    navigate({ ...base, ...(buyer === undefined ? {} : { buyer }) })
  }
  const selected = route.buyer === undefined ? undefined : data.buyers.get(route.buyer)
  // 합치기 창: 주소의 상대·방향 (남는 쪽은 자세히를 연 구매자 또는 상대 — 아니면 기본 방향)
  const merge: MergeTarget | null =
    selected === undefined || route.merge === undefined
      ? null
      : {
          other: route.merge,
          into:
            route.into === selected.id || route.into === route.merge
              ? route.into
              : (() => {
                  const other = data.buyers.get(route.merge)
                  return other === undefined ? selected.id : defaultInto(selected, other).id
                })(),
        }
  const withMerge = (target: MergeTarget, product?: string): ScopeRoute => ({
    ...base,
    buyer: selected?.id ?? '',
    merge: target.other,
    into: target.into,
    ...(product === undefined ? {} : { product }),
  })

  let routeDialog: ReactNode = null
  if (snapshot.sealed) {
    // 봉인한 날짜는 볼 수만 있다 — 주소에 합치기 창(merge·into·product)이 남아 있어도 열지 않는다 (AC-I3-41)
  } else if (selected !== undefined && merge !== null && route.product !== undefined) {
    routeDialog = (
      <ProductWinnersDialog
        api={host.api}
        productKey={route.product}
        // 닫기: 구매자 자세히로 (합치기 창도 닫힌다 — 돌아가려면 "합치기로 돌아가기")
        onClose={() => navigate({ ...base, buyer: selected.id }, { replace: true })}
        // 합치기로 돌아가기: 화면 안의 이동 — 보내기 전인 조치가 있으면 떠나기 확인이 그대로 묻는다 (AC-S06b-34)
        onBack={() => navigate(withMerge(merge))}
      />
    )
  } else if (selected !== undefined && merge !== null) {
    routeDialog = (
      <MergeDialog
        key={merge.other}
        api={host.api}
        opened={selected}
        otherId={merge.other}
        intoId={merge.into}
        onClose={() => navigate({ ...base, buyer: selected.id }, { replace: true })}
        onSwap={(into) => navigate(withMerge({ other: merge.other, into }), { replace: true })}
        onDone={(target) => {
          navigate({ ...base, buyer: target }, { replace: true })
          setNotice(MERGED_NOTICE)
        }}
        onProduct={(product) => navigate(withMerge(merge, product), { stay: true })}
      />
    )
  } else if (selected !== undefined && searching) {
    routeDialog = (
      <MergeSearchDialog
        api={host.api}
        opened={selected}
        onClose={() => setSearching(false)}
        onChoose={(other) => {
          setSearching(false)
          setNotice(null)
          navigate(withMerge({ other: other.id, into: defaultInto(selected, other).id }), { stay: true })
        }}
      />
    )
  }

  return (
    <ReadOnlyContext.Provider value={snapshot.sealed}>
      <div className="page-sticky">
        <LiveNotices snapshot={snapshot} onRetry={() => void store.retryNow()} />
        <UndoBar items={host.items} queue={queue} />
      </div>
      {notice !== null ? (
        <p className="notice" role="status" data-tone="success">
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
          onMerge={() => {
            setNotice(null)
            setSearching(true)
          }}
          onSettlement={(buyer) => navigate({ name: 'settlements', date: data.date, rehearsal: data.rehearsal, buyer })}
          onPast={(date, buyer) => navigate({ name: 'settlements', date, rehearsal: false, buyer })}
          onUnmerged={() => setNotice(UNMERGED_NOTICE)}
        />
      )}
      {/* 사유·확인 창(찜 취소·차단)이 열리면 그 창만 — 아래 창이 포커스를 가져가지 않게 */}
      {host.dialog ?? routeDialog}
    </ReadOnlyContext.Provider>
  )
}

// ── 목록·찾기 (AC-S06-20·21, AC-S06b-21) ───────────────────────────────

/** 왼쪽 단추만 화면 안에서 연다 (새 탭·창은 브라우저가) */
function linkClick(event: MouseEvent<HTMLAnchorElement>, go: () => void): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  go()
}

interface BuyerRow {
  readonly buyer: Buyer
  /** 찾기에서 합쳐진 구매자가 걸렸을 때 "문자찜(김씨) — 홍길동에 합쳐짐" */
  readonly extra?: string
}

function marks(buyer: Buyer, counts: ReadonlyMap<string, number>, extra: string | undefined) {
  return (
    <>
      {distinguishWords(buyer, counts).map((word) => (
        <span key={word}>{word}</span>
      ))}
      {buyer.blocked ? <span className="tag tag-alert">차단</span> : null}
      {buyer.merged.length > 0 ? <span>합친 구매자 {buyer.merged.length}명</span> : null}
      {extra !== undefined ? <span>{extra}</span> : null}
    </>
  )
}

function payTag(api: ConsoleApi, buyer: Buyer) {
  const settlement = settlementOf(api.data, buyer.id)
  return settlement === undefined ? null : <span className={`tag pay-${settlement.payment}`}>{paymentWord(settlement.payment, settlement.refundDue)}</span>
}

/** 휴대폰: 카드 목록 (AC-S06-20 그대로) */
function BuyerCards({ api, label, rows, counts, onOpen }: { readonly api: ConsoleApi; readonly label: string; readonly rows: readonly BuyerRow[]; readonly counts: ReadonlyMap<string, number>; readonly onOpen: (id: string) => void }) {
  return (
    <ul className="plain-list stack-tight" aria-label={label}>
      {rows.map(({ buyer, extra }) => (
        <li key={buyer.id}>
          <a className="list-link" href={routePath({ name: 'buyers', date: api.data.date, rehearsal: api.data.rehearsal, buyer: buyer.id })} onClick={(event) => linkClick(event, () => onOpen(buyer.id))}>
            <strong className="buyer-name">{api.names.name(buyer.id)}</strong>
            <span className="tag">{BUYER_KIND_WORD[buyer.kind]}</span>
            <span>
              {buyer.items.length}개 · {formatWon(buyer.subtotal)}
            </span>
            {payTag(api, buyer)}
            {marks(buyer, counts, extra)}
          </a>
        </li>
      ))}
    </ul>
  )
}

/** PC: 열 머리가 있는 표 — 한 줄 = 한 구매자, 금액 열은 오른쪽, 이름 칸의 링크로 자세히 (AC-S06b-21) */
function BuyerTable({ api, label, rows, counts, onOpen }: { readonly api: ConsoleApi; readonly label: string; readonly rows: readonly BuyerRow[]; readonly counts: ReadonlyMap<string, number>; readonly onOpen: (id: string) => void }) {
  return (
    <div className="table-scroll">
      <table className="list-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">이름</th>
            <th scope="col">종류</th>
            <th scope="col" className="num">
              상품 수
            </th>
            <th scope="col" className="num">
              합계
            </th>
            <th scope="col">입금 상태</th>
            <th scope="col">표시</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ buyer, extra }) => (
            <tr key={buyer.id}>
              <td className="cell-name">
                <a className="table-link" href={routePath({ name: 'buyers', date: api.data.date, rehearsal: api.data.rehearsal, buyer: buyer.id })} onClick={(event) => linkClick(event, () => onOpen(buyer.id))}>
                  {api.names.name(buyer.id)}
                </a>
              </td>
              <td>{BUYER_KIND_WORD[buyer.kind]}</td>
              <td className="num">{buyer.items.length}개</td>
              <td className="num">{formatWon(buyer.subtotal)}</td>
              <td>{payTag(api, buyer)}</td>
              <td>
                <span className="cell-marks">{marks(buyer, counts, extra)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BuyerList({ api, onOpen }: { readonly api: ConsoleApi; readonly onOpen: (id: string | undefined) => void }) {
  const wide = useWide()
  const [all, setAll] = useState(false)
  const [sort, setSort] = useState<BuyerSort>('name')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const counts = useMemo(() => sameNameCounts(api.data.buyers), [api.data.buyers])
  const list = useMemo(() => buyerList(api.data.buyers, { all, sort }), [api.data.buyers, all, sort])
  const hits = useMemo(() => searchBuyers(api.data.buyers, query, 100), [api.data.buyers, query])
  const total = list.reduce((sum, buyer) => sum + buyer.subtotal, 0)
  const searching = query.trim() !== ''
  const Rows = wide ? BuyerTable : BuyerCards
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
          <Rows
            api={api}
            label="찾은 구매자"
            counts={counts}
            onOpen={onOpen}
            rows={hits.map((hit) => ({
              buyer: hit.current,
              ...(hit.matched.id === hit.current.id ? {} : { extra: `${api.names.name(hit.matched.id)} — ${api.names.name(hit.current.id)}에 합쳐짐` }),
            }))}
          />
        </>
      ) : (
        <>
          <p className="summary-line" role="status">
            구매자 {list.length}명 · 합계 {formatWon(total)}
          </p>
          {list.length === 0 ? <p>{all ? '그날 기록된 구매자가 없어요.' : '그날 1등 찜이 있는 구매자가 없어요.'}</p> : null}
          <Rows api={api} label="구매자" counts={counts} onOpen={onOpen} rows={list.slice(0, shown).map((buyer) => ({ buyer }))} />
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

// ── 자세히 (AC-S06-22, AC-S06b-24) ─────────────────────────────────────

interface DetailProps {
  readonly api: ConsoleApi
  readonly buyer: Buyer
  readonly onOpen: (id: string | undefined) => void
  readonly onMerge: () => void
  readonly onUnmerged: () => void
  readonly onSettlement: (buyer: string) => void
  /** 지난 구매 항목 → 그 날짜의 정산 자세히 */
  readonly onPast: (date: string, buyer: string) => void
}

function BuyerDetail({ api, buyer, onOpen, onMerge, onUnmerged, onSettlement, onPast }: DetailProps) {
  const [unmerging, setUnmerging] = useState<string | null>(null)
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
        <p className="notice" data-tone="info">
          {names.name(buyer.mergedInto)}에 합쳐져 있어요.{' '}
          <button type="button" className="button" onClick={() => onOpen(buyer.current)}>
            {names.name(buyer.current)} 자세히
          </button>
        </p>
      ) : null}

      {/* 주 버튼 없음 (D-101): 합치기는 보통 버튼, 차단은 위험 버튼 모양. 봉인한 날짜는 잠긴다 (AC-I3-41) */}
      <Lock>
        <div className="row">
          {buyer.mergedInto === null ? (
            <button type="button" className="button" onClick={onMerge}>
              다른 구매자와 합치기
            </button>
          ) : null}
          <button type="button" className={buyer.blocked ? 'button' : 'button button-danger'} onClick={() => openBlockAction(api, buyer.id, !buyer.blocked)}>
            {buyer.blocked ? '차단 풀기' : '차단하기'}
          </button>
        </div>
      </Lock>

      {current.merged.length > 0 && buyer.mergedInto === null ? (
        <section className="stack-tight" aria-label="합친 구매자">
          <h3 className="sub-title">합친 구매자 {current.merged.length}명</h3>
          <ul className="plain-list stack-tight">
            {current.merged.map((id) => (
              <li key={id} className="row claim-row">
                <span>{names.name(id)}</span>
                <Lock className="lock-inline">
                  <button type="button" className="button" aria-label={`${names.name(id)} 떼어 내기`} onClick={() => setUnmerging(id)}>
                    떼어 내기
                  </button>
                </Lock>
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
                      {claim.no}번{claimOptionWords(claim)} {name} {(claim.amount ?? claim.price) === null ? '' : formatWon(claim.amount ?? claim.price ?? 0)} · {ORIGIN_WORD[claim.origin]}
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
                {productLabel(api, claim.broadcast, claim.no)}
                {claimOptionWords(claim)} {claimWord(api.data, claim)}
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

      {api.data.rehearsal ? null : <PastPurchases date={api.data.date} buyer={current.id} refreshKey={current.merged.join(',')} onOpen={onPast} />}

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
    </section>
  )
}

// ── 합치기 (AC-S06-23, AC-S06b-33·34) ──────────────────────────────────

/** 합칠 상대 고르기 */
function MergeSearchDialog({ api, opened, onClose, onChoose }: { readonly api: ConsoleApi; readonly opened: Buyer; readonly onClose: () => void; readonly onChoose: (other: Buyer) => void }) {
  const [query, setQuery] = useState('')
  const counts = useMemo(() => sameNameCounts(api.data.buyers), [api.data.buyers])
  const hits = useMemo(() => searchBuyers(api.data.buyers, query, 20).filter((hit) => hit.matched.id !== opened.id), [api.data.buyers, query, opened.id])
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
            <button type="button" className="choice-button" onClick={() => onChoose(hit.matched)}>
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

interface MergeDialogProps {
  readonly api: ConsoleApi
  readonly opened: Buyer
  /** 상대 구매자 ID (주소 merge) */
  readonly otherId: string
  /** 남는 쪽 구매자 ID (주소 into) */
  readonly intoId: string
  readonly onClose: () => void
  /** 방향 바꾸기: 새 남는 쪽 */
  readonly onSwap: (into: string) => void
  readonly onDone: (target: string) => void
  /** 막힘 문장의 "15번 자세히" (상품 키) */
  readonly onProduct: (product: string) => void
}

function MergeDialog({ api, opened, otherId, intoId, onClose, onSwap, onDone, onProduct }: MergeDialogProps) {
  const [reason, setReason] = useState('')
  const [empty, setEmpty] = useState(false)
  const [notApplied, setNotApplied] = useState(false)
  const reasonField = useRef<HTMLInputElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const sender = useSender(api.command)
  const fromId = intoId === opened.id ? otherId : opened.id
  const preview = useMergePreview({ date: api.date, rehearsal: api.rehearsal, seq: api.data.seq }, fromId, intoId)
  const view = preview.view?.preview ?? null
  const words = view === null ? null : mergeWords(api.data, api.names, view, (b, no) => productLabel(api, b, no))
  const from = api.data.buyers.get(fromId)
  const targetId = view?.target ?? api.data.buyers.get(intoId)?.current ?? intoId
  const target = api.data.buyers.get(targetId)
  const targetName = api.names.name(targetId)
  // 마지막으로 받은 미리 보기가 막힘이면 사유 칸을 두지 않는다 (새로 받는 동안에는 친 사유를 그대로 둔다)
  const lastBlocked = (preview.view ?? preview.last)?.preview.blocked ?? null
  const ready = view !== null && view.blocked === null && !sender.busy

  const submit = async () => {
    if (!ready) return
    const value = reason.trim()
    if (value === '') {
      setEmpty(true)
      reasonField.current?.focus()
      return
    }
    setNotApplied(false)
    const result = await sender.send({ type: 'buyer.merge', from: fromId, into: intoId, reason: value })
    if (result === null) return
    if (!result.changed) {
      setNotApplied(true)
      return
    }
    onDone(targetId)
  }

  return (
    <Modal
      title="구매자 합치기"
      onClose={onClose}
      wide
      actions={
        <button ref={submitButton} type="button" className="button button-danger" disabled={!ready} onClick={() => void submit()}>
          {sender.busy ? '보내는 중…' : '합치기'}
        </button>
      }
    >
      <p className="merge-direction">
        <strong>
          남는 이름: {targetName}
          {target === undefined ? '' : `(${BUYER_KIND_WORD[target.kind]})`}
        </strong>{' '}
        ← {api.names.name(fromId)}
        {from === undefined ? '' : `(${BUYER_KIND_WORD[from.kind]})`}
      </p>
      <button type="button" className="button" onClick={() => onSwap(fromId)}>
        방향 바꾸기
      </button>
      {preview.loading ? (
        <p className="notice" role="status" data-tone="info">
          {preview.refreshing ? PREVIEW_REFRESHING : PREVIEW_LOADING}
        </p>
      ) : null}
      {preview.error !== null ? (
        <div className="error-note" role="alert" data-tone="danger">
          <p>{PREVIEW_FAILED}</p>
          <p>{preview.error.message}</p>
          {preview.error.problems.map((problem, index) => (
            <p key={index}>
              {problem.message}
              {problem.hint !== undefined ? ` ${problem.hint}` : ''}
            </p>
          ))}
          <button type="button" className="button" onClick={preview.retry}>
            다시 받기
          </button>
        </div>
      ) : null}
      {/* 막히면 합치기가 일어나지 않으므로 합친 뒤의 금액·이름을 보이지 않는다 (이미 합쳐진 금액을 두 번 세지 않게, TE-S06-002) */}
      {words !== null && words.afterTotal !== null ? (
        <ul className="plain-list stack-tight" aria-label="합치면">
          <li>
            옮겨 갈 확정 찜 {words.movingCount}개 · {formatWon(words.movingTotal)}
          </li>
          <li>합친 뒤 합계 {formatWon(words.afterTotal)}</li>
          <li>정산 묶음이 하나가 되어 배송비가 한 번 붙어요</li>
          <li>합친 뒤 표시 이름은 {targetName}이고, 공개 감사 문구의 이름은 바뀌지 않아요.</li>
        </ul>
      ) : null}
      {words !== null && words.duplicates.length > 0 ? (
        <div className="warning stack-tight" role="note" data-tone="warning">
          {words.duplicates.map((line) => (
            <p key={line.claim}>{line.text}</p>
          ))}
          <p>떼어 내도 돌아오지 않아요.</p>
        </div>
      ) : null}
      {words !== null && words.blocks.length > 0 ? (
        <div className="error-note" role="alert" data-tone="danger">
          {words.blocks.map((block) =>
            block.product === undefined ? (
              <p key={block.text}>{block.text}</p>
            ) : (
              <p key={block.product.key} className="row">
                <span>{block.text}</span>
                <button type="button" className="button" onClick={() => onProduct(block.product?.key ?? '')}>
                  {productLabel(api, block.product.broadcast, block.product.no)} 자세히
                </button>
              </p>
            ),
          )}
        </div>
      ) : null}
      {lastBlocked === null && preview.error === null ? (
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
        <p className="error-note" role="alert" data-tone="danger">
          합치지 못했어요. 지금 상태를 확인해 주세요.
        </p>
      ) : null}
      {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void submit()} omitFields={['reason']} /> : null}
    </Modal>
  )
}

/**
 * 합치기 막힘에서 연 상품 자세히 (AC-S06b-34): 1등 찜과 "찜 취소하기"(사유, 5초 뒤 — 콘솔과 같다), "합치기로 돌아가기".
 * 찜 취소를 넣어도 이 창은 그대로다(주소의 product) — 보낸 뒤 돌아가면 합치기 창이 미리 보기를 새로 받는다.
 */
function ProductWinnersDialog({ api, productKey, onClose, onBack }: { readonly api: ConsoleApi; readonly productKey: string; readonly onClose: () => void; readonly onBack: () => void }) {
  const product = api.data.products.get(productKey)
  const { broadcast, no } = splitProductKey(productKey)
  const label = productLabel(api, broadcast, no)
  const winners = (product === undefined ? [] : productSlots(product).winnerClaims).map((id) => api.data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
  return (
    <Modal
      title={`${label} 자세히`}
      onClose={onClose}
      actions={
        <button type="button" className="button" onClick={onBack}>
          {BACK_TO_MERGE}
        </button>
      }
    >
      {product === undefined ? <p>그 상품을 찾지 못했어요.</p> : <p>{product.name.trim() === '' ? '품종 미입력' : product.name}</p>}
      <section className="stack-tight" aria-label="1등">
        <h3 className="sub-title">1등 {winners.length}명</h3>
        <ul className="plain-list stack-tight">
          {winners.map((claim) => (
            <li key={claim.id} className="claim-row">
              <p>
                <strong>{api.names.name(claim.currentBuyer)}</strong> <span>{ORIGIN_WORD[claim.origin]}</span>
                {api.waiting.claims.has(claim.id) ? <span className="tag tag-waiting">보내기 전</span> : null}
              </p>
              <button type="button" className="button button-small" disabled={api.waiting.claims.has(claim.id)} onClick={() => openClaimAction(api, claim, 'host.cancel')}>
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
        <p className="error-note" role="alert" data-tone="danger">
          떼어 내지 못했어요. 합친 동안 적은 환불이 한쪽 입금보다 많아요. 정산 기록을 먼저 확인해 주세요.
        </p>
      ) : null}
      {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void submit()} omitFields={['reason']} /> : null}
    </Modal>
  )
}
