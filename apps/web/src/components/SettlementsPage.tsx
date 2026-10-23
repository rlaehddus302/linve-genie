// 정산 (SPEC §7 화면 4, STL-01·02·03·07·09, R-12, D-058, D-092, D-101, AC-S06-30~36, AC-S06b-21·23·24·40).
// - 날짜 하나(구매자 화면과 같은 고르기)의 묶음 목록(코어 listSettlements — 그날의 지금의 구매자마다)과 위 요약, 상태 거르기·이름 찾기.
//   PC(48rem 이상)는 열 머리가 있는 표, 휴대폰은 카드 (D-101).
// - 자세히: 방송별 품목·합계, 계산 줄, 받은 금액·남은 금액·환불 필요, 기록 목록, 입력 넷(입금·배송비·할인/추가·환불) — 모두 확인 뒤 바로 보낸다.
//   주 버튼은 지금 할 일 하나: 미입금·부분 입금이면 "입금 적기", 과입금이면 "환불 적기", 입금 완료면 없다 (D-101).
// - 입력 창 머리: "입금 적기 · 홍길동 · 2026년 10월 18일 묶음"과 "최종 · 받은 금액 · 남은 금액". 보내기 전 미리 보기에 입금 상태 변화(코어 settle).
// - 금액 칸은 원 단위(AC-S06-36), 입금은 1원~100,000,000원(화면만의 오타 막기). 입금 날짜는 적은 때로 남는다(실제 입금일은 메모).
// - 자세히의 포장 라벨(AC-I1-35): 쪽마다 미리 보기·출력·그림 파일·PDF·재출력 필요. 리허설 범위는 라벨이 없다(AC-I1-36).
// - I2: 목록 위 "전원 확인서 PDF (n명)"·"판매대장 엑셀"(실제 범위 — 리허설이면 안내 한 줄), 실제 범위의 줄·자세히에 포장·배송 상태 말(송장번호),
//   자세히의 "구매 내역 확인서"(미리 보기·PDF·공유/저장) (AC-I2-13·14·22·33).
// - I3: 봉인 예정 날짜면 "이 날짜 기록은 … 봉인돼요"(7일 전부터 경고 상자), 봉인한 날짜는 볼 수만 있다 — 입금·배송비·할인/추가·환불이 잠긴다 (AC-I3-40·41).
// - 입금 확인(N3, AC-N3-47·48): 입금 확인이 적은 입금 기록은 "자동 입금 확인 · 김영희 · 10/18 21:03"(판매자 확정은 "입금 내역으로 확인 · …"),
// - T1(AC-T1-65, PC-3·PC-8): 실제 범위의 묶음 줄·자세히에 "택배: 배송 중 · 9000-0000-0001"(있을 때), 자세히에 "배송지" 칸(ParcelParts.AddressSection).
//   리허설 범위에는 배송지·택배가 없다.
//   되돌림 환불은 "입금 확인 되돌림 · 입금 #12" — 서버의 입금 연결(범위 seq)로 붙이고 메모 글을 읽지 않는다. 아직 되돌리지 않은 입금 확인 기록에는
//   "입금 확인 되돌리기"(입금 확인 화면과 같은 확인 창). 리허설 범위는 "리허설 묶음은 입금 확인에 쓰지 않아요."이고 연결·되돌리기가 없다.
import { containsPhoneRun, formatWon, type PaymentStatus } from '@livejjim/core'
import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { ApiError, isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import type { Claim, PackingWord, Settlement, WriteResult } from '../api/types.ts'
import { claimsOf } from '../lib/buyers.ts'
import type { ConsoleSnapshot, ConsoleStore } from '../lib/console-store.ts'
import { BuyerNames } from '../lib/derive.ts'
import { dateYear, kstShort } from '../lib/kst.ts'
import { ADJUST_RANGE, PAYMENT_RANGE, SHIPPING_RANGE, readAmount, refundRange } from '../lib/money.ts'
import { routePath, type Navigate, type ScopeRoute } from '../lib/router.ts'
import { saleLine } from '../lib/sale-line.ts'
import type { ScopeData } from '../lib/scope-data.ts'
import { settlementKey } from '../lib/scope-data.ts'
import { PACKING_TONE } from '../lib/packing.ts'
import { filterSettlements, paymentChange, previewWith, quantityCounts, remainingOf, sortSettlements, summarize, type PaymentFilter, type PreviewEntry } from '../lib/settlement.ts'
import { receiptSignature, useClosingSignature, usePackingList } from '../lib/use-packing.ts'
import { useScopeStore } from '../lib/use-store.ts'
import { useWide } from '../lib/use-wide.ts'
import { PAYMENT_WORD, SHIPPING_WORD, paymentWord, recordKindWord, signedWon } from '../lib/words.ts'
import { depositLinkWords } from '../lib/deposit-words.ts'
import { RevertDialog, type RevertTarget } from './deposit-parts.tsx'
import { ErrorNote } from './ErrorNote.tsx'
import { DownloadButton } from './downloads.tsx'
import { PackingLabels } from './LabelParts.tsx'
import { AmountField, FieldNote, WriteError, serverProblem, useSender } from './forms.tsx'
import { LedgerDialog } from './LedgerDialog.tsx'
import { LiveNotices } from './LiveNotices.tsx'
import { Modal } from './Modal.tsx'
import { AddressSection, ParcelTag } from './ParcelParts.tsx'
import { hidesPackingTag, packingTagWords } from '../lib/parcel-words.ts'
import type { ParcelBrief } from '../api/parcel-types.ts'
import { ReasonField } from './ReasonField.tsx'
import { ReceiptSection } from './ReceiptSection.tsx'
import { Lock } from './Lock.tsx'
import { ScopePicker, sealOf, useScopeChoice } from './ScopePicker.tsx'
import { SealNotice } from './SealNotice.tsx'
import { ReadOnlyContext } from '../lib/read-only.ts'

export const REHEARSAL_SETTLEMENT = '리허설 — 실제 정산이 아니에요'
export const REHEARSAL_DEPOSITS = '리허설 묶음은 입금 확인에 쓰지 않아요.'
export const PAYMENT_DATE_NOTE = '입금 날짜는 적은 때로 남아요. 실제 입금일이 다르면 메모에 적어 주세요.'
export const REFUND_NOTE = '입금을 잘못 적었으면 같은 금액을 환불로 적어 바로잡아요.'
export const PHONE_IN_TEXT = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'
export const ADJUST_REASONS: readonly string[] = ['단골 할인', '포장 추가', '도서산간']
export const REFUND_REASONS: readonly string[] = ['환불함', '입금액 잘못 적음']
export const NO_RECEIPT_BUYERS = '구매 내역이 있는 구매자가 없어요.'
export const REHEARSAL_NO_LEDGER = '리허설 기록은 판매대장에 넣지 않아요.'

/** 묶음의 포장·배송 상태 (실제 범위 — 받지 못했으면 없음) */
interface PackingMark {
  readonly status: PackingWord
  readonly invoice: string | null
  /** 택배 줄 (T1 — 없으면 null) */
  readonly parcel: ParcelBrief | null
}
type PackingMarks = ReadonlyMap<string, PackingMark> | null

const FILTERS: readonly { readonly key: PaymentFilter; readonly word: string }[] = [
  { key: 'ALL', word: '전체' },
  { key: 'UNPAID', word: PAYMENT_WORD.UNPAID },
  { key: 'PARTIAL', word: PAYMENT_WORD.PARTIAL },
  { key: 'PAID', word: PAYMENT_WORD.PAID },
  { key: 'OVERPAID', word: PAYMENT_WORD.OVERPAID },
]

export function SettlementsPage({ route, navigate }: { readonly route: ScopeRoute; readonly navigate: Navigate }) {
  const choice = useScopeChoice(route, navigate)
  const scope = choice.scope
  const key = scope === null ? null : `${scope.date}|${String(scope.rehearsal)}`
  const { store, snapshot } = useScopeStore(key, () => ({ scope: scope ?? { date: '', rehearsal: false } }))
  const seal = sealOf(choice.days, scope)
  return (
    <main className="page page-wide settlements-page">
      <h1>정산</h1>
      <div className="row scope-row">
        <ScopePicker route={route} navigate={navigate} days={choice.days} error={choice.error} onRetry={choice.retry} />
        {/* 정산 문서 (AC-I2-14·22): 날짜 줄에 두어 PC 표가 위로 밀리지 않게 — 목록에서만 */}
        {scope !== null && route.buyer === undefined && snapshot.data !== null && snapshot.data.date === scope.date && snapshot.data.rehearsal === scope.rehearsal ? <ClosingActions data={snapshot.data} /> : null}
      </div>
      <SealNotice sealAt={seal.sealAt} sealed={seal.sealed || snapshot.sealed} />
      {route.rehearsal ? (
        // 입금 확인 안내는 리허설 띠 옆에 (PC에서 한 줄 — 표가 아래로 밀려 보이는 줄이 줄지 않게, AC-S06b-21)
        <div className="row rehearsal-row">
          <p className="rehearsal-banner" role="note">
            {REHEARSAL_SETTLEMENT}
          </p>
          <p className="hint" role="note">
            {REHEARSAL_DEPOSITS}
          </p>
        </div>
      ) : null}
      {scope === null ? (
        choice.days !== null ? <p>아직 판매 기록이 없어요.</p> : null
      ) : snapshot.phase === 'missing' ? (
        <p>아직 판매 기록이 없어요.</p>
      ) : snapshot.phase === 'error' && snapshot.error !== null ? (
        <ErrorNote error={snapshot.error} onRetry={() => window.location.reload()} retryLabel="다시 열기" />
      ) : store === null || snapshot.data === null ? (
        <>
          <div className="page-sticky">
            <LiveNotices snapshot={snapshot} onRetry={() => void store?.retryNow()} />
          </div>
          <p role="status">불러오는 중…</p>
        </>
      ) : (
        <ReadySettlements key={key} route={route} navigate={navigate} store={store} snapshot={snapshot} data={snapshot.data} />
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
}

/** 정산 쓰기 (settlement.* — 날짜 범위로, 같은 요청 번호로 재시도 → 응답 seq까지 따라잡기). 봉인한 날짜는 보내지 않는다 */
function useCommand(store: ConsoleStore, data: ScopeData, sealed: boolean) {
  return useMemo(
    () =>
      async (event: Readonly<Record<string, unknown>>, requestId: string = newRequestId()): Promise<WriteResult> => {
        if (sealed) throw new ApiError({ status: 409, code: 'SEALED', message: '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.' })
        let result: WriteResult
        try {
          result = await withRetry(() => post<WriteResult>(withQuery('/api/events', { date: data.date, rehearsal: data.rehearsal }), { requestId, ...event }))
        } catch (error) {
          // 서버가 처리하지 못한 입력은 "확인 필요"에 남았다 — 알림을 기다리지 않고 따라잡는다
          if (isApiError(error) && error.code === 'PROCESSING_FAILED') void store.catchUp()
          throw error
        }
        await store.sync(result.seq)
        return result
      },
    [store, data.date, data.rehearsal, sealed],
  )
}

function ReadySettlements({ route, navigate, store, snapshot, data }: ReadyProps) {
  const names = useMemo(() => new BuyerNames(data.buyers, data.claims), [data.buyers, data.claims])
  const command = useCommand(store, data, snapshot.sealed)
  // 포장·배송 상태 (실제 범위만, AC-I2-33): 품목·묶음이 바뀌거나 포장 알림이 오면 다시 받는다. 받지 못하면 상태 칸을 그리지 않는다
  const signature = useClosingSignature(data)
  const packing = usePackingList(data.rehearsal ? null : data.date, `${signature}|${String(snapshot.packingVersion)}|${String(snapshot.parcelVersion)}`)
  const marks: PackingMarks = useMemo(
    () => (packing.entries === null ? null : new Map(packing.entries.map((entry) => [entry.buyer, { status: entry.status, invoice: entry.invoice, parcel: entry.parcel ?? null }]))),
    [packing.entries],
  )
  const open = (buyer: string | undefined) => navigate({ name: 'settlements', date: data.date, rehearsal: data.rehearsal, ...(buyer === undefined ? {} : { buyer }) })
  const selected = route.buyer === undefined ? undefined : data.settlements.get(settlementKey({ buyer: data.buyers.get(route.buyer)?.current ?? route.buyer, date: data.date }))
  return (
    <ReadOnlyContext.Provider value={snapshot.sealed}>
      <div className="page-sticky">
        <LiveNotices snapshot={snapshot} onRetry={() => void store.retryNow()} />
      </div>
      {route.buyer === undefined ? (
        <SettlementList data={data} names={names} marks={marks} onOpen={open} />
      ) : selected === undefined ? (
        <div className="stack-tight">
          <p>그 구매자의 정산 묶음이 없어요.</p>
          <button type="button" className="button" onClick={() => open(undefined)}>
            정산 목록으로
          </button>
        </div>
      ) : (
        <SettlementDetail
          key={selected.buyer}
          data={data}
          names={names}
          settlement={selected}
          command={command}
          sync={(seq) => store.sync(seq)}
          onBack={() => open(undefined)}
          mark={marks?.get(selected.buyer) ?? null}
          parcelVersion={`${String(snapshot.parcelVersion)}|${String(snapshot.packingVersion)}|${signature}`}
          receiptSignature={`${receiptSignature(data, selected)}|${String(snapshot.shopVersion)}`}
        />
      )}
    </ReadOnlyContext.Provider>
  )
}

// ── 정산 문서: 전원 확인서·판매대장 (AC-I2-14·22) ───────────────────────

function ClosingActions({ data }: { readonly data: ScopeData }) {
  const [ledger, setLedger] = useState(false)
  const receiptCount = useMemo(() => [...data.settlements.values()].filter((item) => item.date === data.date && item.items.length > 0).length, [data.settlements, data.date])
  return (
    <div className="row closing-actions" role="group" aria-label="정산 문서">
      <DownloadButton
        label={`전원 확인서 PDF (${String(receiptCount)}명)`}
        busyText={`확인서 ${String(receiptCount)}명을 만드는 중이에요…`}
        path={withQuery(`/api/days/${data.date}/receipts.pdf`, { rehearsal: data.rehearsal })}
        fallbackName={`receipts-${data.date}.pdf`}
        disabled={receiptCount === 0}
      />
      {receiptCount === 0 ? <span className="hint">{NO_RECEIPT_BUYERS}</span> : null}
      {data.rehearsal ? (
        <span className="hint">{REHEARSAL_NO_LEDGER}</span>
      ) : (
        <button type="button" className="button" onClick={() => setLedger(true)}>
          판매대장 엑셀
        </button>
      )}
      {ledger ? <LedgerDialog date={data.date} onClose={() => setLedger(false)} /> : null}
    </div>
  )
}

// ── 목록 (AC-S06-30) ────────────────────────────────────────────────────

function shippingWords(settlement: Settlement): string {
  return settlement.shippingOverride === null ? formatWon(settlement.shipping) : `${SHIPPING_WORD[settlement.shippingOverride]} ${formatWon(settlement.shipping)}`
}

function SettlementList({ data, names, marks, onOpen }: { readonly data: ScopeData; readonly names: BuyerNames; readonly marks: PackingMarks; readonly onOpen: (buyer: string) => void }) {
  const wide = useWide()
  const [filter, setFilter] = useState<PaymentFilter>('ALL')
  const [query, setQuery] = useState('')
  const all = useMemo(() => [...data.settlements.values()].filter((item) => item.date === data.date), [data.settlements, data.date])
  const nameOf = (buyer: string) => names.name(buyer)
  const summary = useMemo(() => summarize(all), [all])
  const list = useMemo(() => sortSettlements(filterSettlements(all, filter, query, nameOf), nameOf), [all, filter, query, names])
  const statusLine = (['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID'] as const satisfies readonly PaymentStatus[]).map((status) => `${PAYMENT_WORD[status]} ${String(summary.byStatus[status])}`).join(' · ')
  return (
    <section className="stack" aria-label="정산 목록">
      <section className="card stack-tight settlement-summary" aria-label="정산 요약">
        <p>
          묶음 {summary.count}개 · {statusLine}
        </p>
        <dl className="facts">
          <div>
            <dt>최종 금액 합</dt>
            <dd>{formatWon(summary.total)}</dd>
          </div>
          <div>
            <dt>받은 금액 합</dt>
            <dd>{formatWon(summary.received)}</dd>
          </div>
          <div>
            <dt>남은 금액 합</dt>
            <dd>{formatWon(summary.remaining)}</dd>
          </div>
          <div>
            <dt>환불 필요 합</dt>
            <dd>{formatWon(summary.refundDue)}</dd>
          </div>
        </dl>
      </section>
      <div className="toolbar">
        <div className="row" role="group" aria-label="입금 상태로 거르기">
          {FILTERS.map((item) => (
            <button key={item.key} type="button" className="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
              {item.word}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="settlement-search">이름 찾기</label>
          <input id="settlement-search" className="input" type="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>
      {list.length === 0 ? <p>{all.length === 0 ? '그날 정산할 묶음이 없어요.' : '맞는 묶음이 없어요.'}</p> : null}
      {wide ? <SettlementTable data={data} names={names} list={list} marks={marks} onOpen={onOpen} /> : <SettlementCards data={data} names={names} list={list} marks={marks} onOpen={onOpen} />}
    </section>
  )
}

interface RowsProps {
  readonly data: ScopeData
  readonly names: BuyerNames
  readonly list: readonly Settlement[]
  /** 포장·배송 상태 (실제 범위에서 받았을 때만) */
  readonly marks: PackingMarks
  readonly onOpen: (buyer: string) => void
}

/** 포장·배송 상태 꼬리표 (색 + 글자, D-102) — 택배 줄이 있으면 그 옆에 (T1) */
/** 포장 꼬리표 + 택배 꼬리표. 접수한 묶음(배송 완료 + 접수)은 택배 꼬리표 하나만 (D-T1-15, AC-T1-65) */
function PackingTag({ mark }: { readonly mark: PackingMark }) {
  const hidden = hidesPackingTag(mark.status, mark.parcel)
  return (
    <>
      {hidden ? null : (
        <span className="tag packing-tag" data-tone={PACKING_TONE[mark.status]}>
          {packingTagWords(mark.status, mark.invoice, mark.parcel)}
        </span>
      )}
      {mark.parcel !== null ? (
        <>
          {hidden ? null : ' '}
          <ParcelTag parcel={mark.parcel} />
        </>
      ) : null}
    </>
  )
}

/** 왼쪽 단추만 화면 안에서 연다 (새 탭·창은 브라우저가) */
function linkClick(event: MouseEvent<HTMLAnchorElement>, go: () => void): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  go()
}

/** 휴대폰: 카드 (AC-S06-30 그대로) */
function SettlementCards({ data, names, list, marks, onOpen }: RowsProps) {
  const counts = useMemo(() => quantityCounts(data), [data.claims, data.settlements, data.broadcasts, data.date])
  return (
    <ul className="plain-list settlement-grid" aria-label="정산 묶음">
      {list.map((item) => (
        <li key={item.buyer}>
          <a
            className="list-link settlement-card"
            href={routePath({ name: 'settlements', date: data.date, rehearsal: data.rehearsal, buyer: item.buyer })}
            onClick={(event) => linkClick(event, () => onOpen(item.buyer))}
          >
            <strong className="buyer-name">{names.name(item.buyer)}</strong>
            <span className={`tag pay-${item.payment}`}>{paymentWord(item.payment, item.refundDue)}</span>
            <span>
              상품 {counts.get(settlementKey(item)) ?? item.items.length}개 · {formatWon(item.subtotal)}
            </span>
            <span>배송비 {shippingWords(item)}</span>
            <span>조정 {signedWon(item.adjustments)}</span>
            <span>최종 {formatWon(item.total)}</span>
            <span>받은 금액 {formatWon(item.received)}</span>
            {marks?.get(item.buyer) !== undefined ? <PackingTag mark={marks.get(item.buyer) as PackingMark} /> : null}
          </a>
        </li>
      ))}
    </ul>
  )
}

/** PC: 열 머리가 있는 표 — 한 줄 = 한 묶음, 금액 열은 오른쪽, 이름 칸의 링크로 자세히 (AC-S06b-21) */
function SettlementTable({ data, names, list, marks, onOpen }: RowsProps) {
  const counts = useMemo(() => quantityCounts(data), [data.claims, data.settlements, data.broadcasts, data.date])
  return (
    <div className="table-scroll">
      <table className="list-table" aria-label="정산 묶음">
        <thead>
          <tr>
            <th scope="col">이름</th>
            <th scope="col" className="num">
              상품 수
            </th>
            <th scope="col" className="num">
              상품 합계
            </th>
            <th scope="col" className="num">
              배송비
            </th>
            <th scope="col" className="num">
              조정
            </th>
            <th scope="col" className="num">
              최종 금액
            </th>
            <th scope="col" className="num">
              받은 금액
            </th>
            <th scope="col">입금 상태</th>
            {marks !== null ? <th scope="col">포장·배송</th> : null}
          </tr>
        </thead>
        <tbody>
          {list.map((item) => (
            <tr key={item.buyer}>
              <td className="cell-name">
                <a className="table-link" href={routePath({ name: 'settlements', date: data.date, rehearsal: data.rehearsal, buyer: item.buyer })} onClick={(event) => linkClick(event, () => onOpen(item.buyer))}>
                  {names.name(item.buyer)}
                </a>
              </td>
              <td className="num">{counts.get(settlementKey(item)) ?? item.items.length}개</td>
              <td className="num">{formatWon(item.subtotal)}</td>
              <td className="num num-words">
                {item.shippingOverride === null ? null : `${SHIPPING_WORD[item.shippingOverride]} `}
                <span className="won">{formatWon(item.shipping)}</span>
              </td>
              <td className="num">{signedWon(item.adjustments)}</td>
              <td className="num">{formatWon(item.total)}</td>
              <td className="num">{formatWon(item.received)}</td>
              <td>
                <span className={`tag pay-${item.payment}`}>{paymentWord(item.payment, item.refundDue)}</span>
              </td>
              {marks !== null ? <td>{marks.get(item.buyer) !== undefined ? <PackingTag mark={marks.get(item.buyer) as PackingMark} /> : null}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 자세히 (AC-S06-31, AC-S06b-23·24) ──────────────────────────────────

type Command = (event: Readonly<Record<string, unknown>>, requestId?: string) => Promise<WriteResult>
type InputKind = 'payment' | 'shipping' | 'adjust' | 'refund'

/** 입력 창 이름 (동사) */
const INPUT_TITLE: Readonly<Record<InputKind, string>> = {
  payment: '입금 적기',
  shipping: '배송비 바꾸기',
  adjust: '할인·추가',
  refund: '환불 적기',
}

interface DetailProps {
  readonly data: ScopeData
  readonly names: BuyerNames
  readonly settlement: Settlement
  readonly command: Command
  /** 응답 seq까지 따라잡기 (입금 확인 되돌리기 뒤) */
  readonly sync: (seq: number) => Promise<void>
  readonly onBack: () => void
  /** 포장·배송 상태 (실제 범위에서 받았을 때만) */
  readonly mark: PackingMark | null
  /** 확인서에 닿는 자료의 모양 (바뀌면 미리 보기를 새로 받는다) */
  readonly receiptSignature: string
  /** 택배·포장 알림·묶음 모양 (바뀌면 배송지 칸을 다시 받는다) */
  readonly parcelVersion: string
}

/** 저장 결과 안내 (D-102): 저장 완료는 성공, 엔진이 받지 않았으면 주의 */
interface Saved {
  readonly text: string
  readonly tone: 'success' | 'warning'
}

export const NOT_APPLIED_SETTLEMENT = '적용되지 않았어요. 지금 상태를 확인해 주세요.'

/** 지금 할 일 (주 버튼, D-101): 미입금·부분 입금이면 입금, 과입금이면 환불, 입금 완료면 없다 */
export function primaryInput(payment: PaymentStatus): InputKind | null {
  if (payment === 'UNPAID' || payment === 'PARTIAL') return 'payment'
  if (payment === 'OVERPAID') return 'refund'
  return null
}

/**
 * 정산 자세히 품목 한 줄 (U-O4-01, D-O4-06 — 지난 구매·포장과 같은 모양): `{번호}번 {품종}[ {옵션 글}][ {수량}개] {찜 금액}`.
 * 찜 금액은 코어 값(단가 × 수량) 그대로, 없으면 금액 칸을 비운다(단가로 채우지 않는다). 옵션 없는 수량 1 줄은 이전 그대로.
 */
export function detailLineWords(claim: Pick<Claim, 'no' | 'variant' | 'qty' | 'amount'>, productName: string | undefined): string {
  const name = productName === undefined ? '' : productName.trim() === '' ? '품종 미입력' : productName
  const amount = claim.amount === null ? '' : ` ${formatWon(claim.amount)}`
  return `${saleLine({ no: claim.no, name, variant: claim.variant, qty: claim.qty })}${amount}`
}

function SettlementDetail({ data, names, settlement, command, sync, onBack, mark, receiptSignature, parcelVersion }: DetailProps) {
  const [input, setInput] = useState<InputKind | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [reverting, setReverting] = useState<RevertTarget | null>(null)
  const buyer = data.buyers.get(settlement.buyer)
  const claims = useMemo(() => claimsOf(data, settlement.buyer).filter((claim) => claim.status === 'CONFIRMED'), [data, settlement.buyer])
  const groups = useMemo(() => {
    const map = new Map<string, Claim[]>()
    for (const claim of claims) map.set(claim.broadcast, [...(map.get(claim.broadcast) ?? []), claim])
    const order = [...data.broadcasts.keys()]
    return [...map.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
  }, [claims, data.broadcasts])
  const remaining = remainingOf(settlement)
  const empty = settlement.items.length === 0
  const primary = primaryInput(settlement.payment)
  const openInput = (kind: InputKind) => {
    setSaved(null)
    setInput(kind)
  }
  const done = (result: WriteResult, text: string) => {
    setInput(null)
    setSaved(result.changed ? { text, tone: 'success' } : { text: NOT_APPLIED_SETTLEMENT, tone: 'warning' })
  }
  const dialogProps = { data, names, settlement, command, onClose: () => setInput(null), onDone: done }
  return (
    <section className="stack settlement-detail" aria-label="정산 자세히">
      <button type="button" className="button back-button" onClick={onBack}>
        정산 목록으로
      </button>
      <h2 className="section-title">{names.name(settlement.buyer)}</h2>
      {buyer !== undefined && buyer.merged.length > 0 ? <p>합친 구매자: {buyer.merged.map((id) => names.name(id)).join(', ')}</p> : null}
      <p className="row">
        <span className={`tag pay-${settlement.payment}`}>{paymentWord(settlement.payment, settlement.refundDue)}</span>
        {mark !== null ? <PackingTag mark={mark} /> : null}
      </p>
      {saved !== null ? (
        <p className="notice" role="status" data-tone={saved.tone}>
          {saved.text}
        </p>
      ) : null}

      <section className="stack-tight" aria-label="품목">
        <h3 className="sub-title">품목</h3>
        {empty ? <p>취소되어 품목이 없어요</p> : null}
        {groups.map(([b, list]) => {
          const title = data.broadcasts.get(b)?.title ?? ''
          // 방송 합계 = 찜 금액(단가 × 수량, 코어 값) 합 — 아래 "상품 합계"와 같은 셈 (U-O4-01)
          const sum = list.reduce((total, claim) => total + (claim.amount ?? 0), 0)
          return (
            <div key={b} className="stack-tight">
              <h4 className="sub-title">{title}</h4>
              <ul className="plain-list">
                {list.map((claim) => {
                  const product = data.products.get(claim.product)
                  return (
                    <li key={claim.id}>
                      {detailLineWords(claim, product?.name)}
                      {claim.buyer !== settlement.buyer ? ` · ${names.name(claim.buyer)}` : ''}
                    </li>
                  )
                })}
              </ul>
              <p>
                {title} 합계 {formatWon(sum)}
              </p>
            </div>
          )
        })}
      </section>

      <section className="stack-tight" aria-label="금액">
        <p className="total-line">
          상품 합계 {formatWon(settlement.subtotal)} + 배송비 {formatWon(settlement.shipping)}
          {settlement.shippingOverride !== null ? `(${SHIPPING_WORD[settlement.shippingOverride]})` : ''} + 조정 {signedWon(empty ? 0 : settlement.adjustments)} = 최종{' '}
          {formatWon(settlement.total)}
        </p>
        <p>
          받은 금액 {formatWon(settlement.received)} · 남은 금액 {formatWon(remaining)} · 환불 필요 {formatWon(settlement.refundDue)}
        </p>
      </section>

      {data.rehearsal ? null : <AddressSection date={settlement.date} buyer={settlement.buyer} version={parcelVersion} />}

      <PackingLabels date={settlement.date} buyer={settlement.buyer} rehearsal={data.rehearsal} />

      {/* 주 버튼은 지금 할 일 하나 (D-101). 봉인한 날짜는 잠긴다 (AC-I3-41) */}
      <Lock>
        <div className="row" role="group" aria-label="정산 입력">
          {(['payment', 'shipping', 'adjust', 'refund'] as const).map((kind) => (
            <button key={kind} type="button" className={kind === primary ? 'button button-primary' : 'button'} onClick={() => openInput(kind)}>
              {INPUT_TITLE[kind]}
            </button>
          ))}
        </div>
      </Lock>

      <ReceiptSection date={settlement.date} rehearsal={data.rehearsal} buyer={settlement.buyer} hasItems={settlement.items.length > 0} signature={receiptSignature} />

      <section className="stack-tight" aria-label="정산 기록">
        <h3 className="sub-title">기록</h3>
        {settlement.records.length === 0 ? <p>아직 기록이 없어요.</p> : null}
        <ul className="plain-list stack-tight">
          {settlement.records.map((record) => {
            // 입금 확인이 적은 기록 (서버의 범위 seq 연결 — 메모 글을 읽지 않는다). 리허설 범위에는 없다
            const link = data.rehearsal ? undefined : data.depositLinks.get(record.seq)
            return (
              <li key={record.seq} className="claim-row">
                <p>
                  <strong>{recordKindWord(record.kind, record.amount)}</strong>{' '}
                  {record.kind === 'shipping'
                    ? `${SHIPPING_WORD[record.mode ?? 'DEFAULT']}${record.mode === 'FIXED' && record.amount !== null ? ` ${formatWon(record.amount)}` : ''}`
                    : record.amount === null
                      ? ''
                      : formatWon(Math.abs(record.amount))}
                  {link !== undefined ? (
                    ` · ${depositLinkWords(link)}`
                  ) : (
                    <>
                      {record.reason !== null ? ` · ${record.reason}` : ''}
                      {record.memo !== null ? ` · ${record.memo}` : ''}
                    </>
                  )}
                  {` · 기록한 때 ${kstShort(record.at)}`}
                  {record.buyer !== settlement.buyer ? ` · ${names.name(record.buyer)}` : ''}
                </p>
                {link !== undefined && link.kind === 'payment' && !link.reverted ? (
                  // 봉인한 날짜는 되돌리기도 잠근다 (AC-I3-41 — 환불 기록을 새로 적는 일이다)
                  <Lock>
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        setSaved(null)
                        setReverting({ no: link.deposit.no, buyerName: names.name(settlement.buyer), date: settlement.date, amount: link.deposit.amount })
                      }}
                    >
                      입금 확인 되돌리기
                    </button>
                  </Lock>
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>

      {reverting !== null ? (
        <RevertDialog
          target={reverting}
          onClose={() => setReverting(null)}
          onDone={(result) => {
            setReverting(null)
            setSaved({ text: '입금 확인을 되돌렸어요. 같은 금액의 환불 기록을 적었어요.', tone: 'success' })
            if (result.refund !== undefined && result.refund.date === data.date) void sync(result.refund.seq)
          }}
        />
      ) : null}

      {input === 'payment' ? <PaymentDialog {...dialogProps} /> : null}
      {input === 'shipping' ? <ShippingDialog {...dialogProps} /> : null}
      {input === 'adjust' ? <AdjustDialog {...dialogProps} /> : null}
      {input === 'refund' ? <RefundDialog {...dialogProps} /> : null}
    </section>
  )
}

interface InputDialogProps {
  readonly data: ScopeData
  readonly names: BuyerNames
  readonly settlement: Settlement
  readonly command: Command
  readonly onClose: () => void
  /** 저장됨 (안내 글자) */
  readonly onDone: (result: WriteResult, text: string) => void
}

/** 입력 창 머리 (AC-S06b-23): "입금 적기 · 홍길동 · 2026년 10월 18일 묶음" */
export function inputTitle(kind: InputKind, name: string, date: string): string {
  return `${INPUT_TITLE[kind]} · ${name} · ${dateYear(date)} 묶음`
}

/** 머리 아래 줄: "최종 33,000원 · 받은 금액 0원 · 남은 금액 33,000원" */
function AmountsLine({ settlement }: { readonly settlement: Settlement }) {
  return (
    <p className="input-amounts">
      최종 {formatWon(settlement.total)} · 받은 금액 {formatWon(settlement.received)} · 남은 금액 {formatWon(remainingOf(settlement))}
    </p>
  )
}

/** 보내기 전 미리 보기의 입금 상태 변화 (AC-S06b-23): 과입금이 새로 생기거나 환불 필요가 늘면 주의 */
function PaymentPreview({ data, settlement, entry }: { readonly data: ScopeData; readonly settlement: Settlement; readonly entry: PreviewEntry | null }) {
  if (entry === null) return null
  const change = paymentChange(settlement, previewWith(data, settlement, entry))
  return (
    <p className="notice payment-change" role="status" data-tone={change.warning ? 'warning' : 'info'}>
      {change.text}
    </p>
  )
}

// ── 입금 (AC-S06-32) ────────────────────────────────────────────────────

function PaymentDialog({ data, names, settlement, command, onClose, onDone }: InputDialogProps) {
  const remaining = remainingOf(settlement)
  const [amount, setAmount] = useState(remaining > 0 ? String(remaining) : '')
  const [memo, setMemo] = useState('')
  const [tried, setTried] = useState(false)
  const [confirming, setConfirming] = useState<number | null>(null)
  const amountField = useRef<HTMLInputElement>(null)
  const sender = useSender(command)
  const read = readAmount(amount, PAYMENT_RANGE)
  const memoProblem = memo.trim() !== '' && containsPhoneRun(memo) ? PHONE_IN_TEXT : null
  const title = inputTitle('payment', names.name(settlement.buyer), settlement.date)

  const send = async (value: number) => {
    const result = await sender.send({ type: 'settlement.payment', buyer: settlement.buyer, date: settlement.date, amount: value, ...(memo.trim() === '' ? {} : { memo: memo.trim() }) })
    if (result !== null) onDone(result, '입금을 적었어요')
  }
  const submit = () => {
    setTried(true)
    if (read.kind !== 'ok' || memoProblem !== null) {
      amountField.current?.focus()
      return
    }
    if (read.amount !== remaining) {
      setConfirming(read.amount)
      return
    }
    void send(read.amount)
  }

  if (confirming !== null) {
    return (
      <Modal
        key="confirm"
        title="입금 금액 확인"
        closeLabel="고치기"
        onClose={() => {
          setConfirming(null)
          setTimeout(() => amountField.current?.focus(), 0)
        }}
        actions={
          <button type="button" className="button button-primary" disabled={sender.busy} onClick={() => void send(confirming)}>
            {formatWon(confirming)} 적기
          </button>
        }
      >
        <p>
          남은 금액({formatWon(remaining)})과 달라요. {formatWon(confirming)}으로 적을까요?
        </p>
        <PaymentPreview data={data} settlement={settlement} entry={{ kind: 'payment', amount: confirming }} />
        {sender.busy ? <p role="status">보내는 중…</p> : null}
        {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void send(confirming)} omitFields={['memo', 'amount']} /> : null}
        {serverProblem(sender.error, 'memo') !== null ? <p className="field-error">{serverProblem(sender.error, 'memo')}</p> : null}
      </Modal>
    )
  }
  return (
    <Modal
      key="form"
      title={title}
      onClose={onClose}
      actions={
        <button type="button" className="button button-primary" disabled={sender.busy} onClick={submit}>
          {sender.busy ? '보내는 중…' : '입금 적기'}
        </button>
      }
    >
      <form
        className="stack-tight"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <AmountsLine settlement={settlement} />
        <AmountField label="입금 금액" value={amount} onChange={setAmount} range={PAYMENT_RANGE} showEmpty={tried} inputRef={amountField} serverMessage={serverProblem(sender.error, 'amount')} />
        <PaymentPreview data={data} settlement={settlement} entry={read.kind === 'ok' ? { kind: 'payment', amount: read.amount } : null} />
        <div className="field">
          <label htmlFor="payment-memo">메모(선택)</label>
          <input id="payment-memo" className="input" autoComplete="off" placeholder="10/18 국민" value={memo} onChange={(event) => setMemo(event.target.value)} />
        </div>
        <FieldNote id="payment-memo-error" message={memoProblem ?? serverProblem(sender.error, 'memo')} />
        <p className="hint">{PAYMENT_DATE_NOTE}</p>
        <button type="submit" hidden />
      </form>
      {sender.error !== null ? <WriteError error={sender.error} onRetry={submit} omitFields={['memo', 'amount']} /> : null}
    </Modal>
  )
}

// ── 배송비 (AC-S06-33) ──────────────────────────────────────────────────

type ShippingChoice = 'DEFAULT' | 'PICKUP' | 'COMBINED' | 'FIXED'

function ShippingDialog({ data, names, settlement, command, onClose, onDone }: InputDialogProps) {
  const [mode, setMode] = useState<ShippingChoice | null>(null)
  const [amount, setAmount] = useState('')
  const [tried, setTried] = useState(false)
  const sender = useSender(command)
  const choices: ShippingChoice[] = [...(settlement.shippingOverride === null ? [] : (['DEFAULT'] as const)), 'PICKUP', 'COMBINED', 'FIXED']
  const read = readAmount(amount, SHIPPING_RANGE)
  const fixedAmount = mode === 'FIXED' && read.kind === 'ok' ? read.amount : null
  const entry: PreviewEntry | null = mode === null || (mode === 'FIXED' && fixedAmount === null) ? null : { kind: 'shipping', mode, amount: mode === 'FIXED' ? fixedAmount : null }
  const preview = entry === null ? null : previewWith(data, settlement, entry)
  const submit = async () => {
    setTried(true)
    if (mode === null || (mode === 'FIXED' && fixedAmount === null)) return
    const result = await sender.send({ type: 'settlement.shippingOverride', buyer: settlement.buyer, date: settlement.date, mode, ...(mode === 'FIXED' ? { amount: fixedAmount } : {}) })
    if (result !== null) onDone(result, '배송비를 바꿨어요')
  }
  const word = (choice: ShippingChoice) => (choice === 'DEFAULT' ? '기본 배송비로' : SHIPPING_WORD[choice])
  return (
    <Modal
      title={inputTitle('shipping', names.name(settlement.buyer), settlement.date)}
      onClose={onClose}
      actions={
        <button type="button" className="button button-primary" disabled={sender.busy || mode === null} onClick={() => void submit()}>
          {sender.busy ? '보내는 중…' : '배송비 바꾸기'}
        </button>
      }
    >
      <AmountsLine settlement={settlement} />
      <p>
        지금 배송비 {shippingWords(settlement)}
      </p>
      <div className="choice-list-plain" role="radiogroup" aria-label="배송비">
        {choices.map((choice) => (
          <label key={choice} className="choice">
            <input type="radio" name="shipping-mode" checked={mode === choice} onChange={() => setMode(choice)} />
            <span>{word(choice)}</span>
          </label>
        ))}
      </div>
      {mode === 'FIXED' ? <AmountField label="배송비 금액" value={amount} onChange={setAmount} range={SHIPPING_RANGE} showEmpty={tried} serverMessage={serverProblem(sender.error, 'amount')} /> : null}
      {preview !== null ? (
        <p className="notice" role="status" data-tone="info">
          배송비 {formatWon(settlement.shipping)} → {formatWon(preview.shipping)}, 최종 {formatWon(settlement.total)} → {formatWon(preview.total)}
        </p>
      ) : null}
      <PaymentPreview data={data} settlement={settlement} entry={entry} />
      {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void submit()} omitFields={['amount']} /> : null}
    </Modal>
  )
}

// ── 할인·추가 (AC-S06-34) ───────────────────────────────────────────────

function AdjustDialog({ data, names, settlement, command, onClose, onDone }: InputDialogProps) {
  const [sign, setSign] = useState<'minus' | 'plus'>('minus')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [empty, setEmpty] = useState(false)
  const [tried, setTried] = useState(false)
  const reasonField = useRef<HTMLInputElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const sender = useSender(command)
  const read = readAmount(amount, ADJUST_RANGE)
  const signed = read.kind === 'ok' ? (sign === 'minus' ? -read.amount : read.amount) : null
  const entry: PreviewEntry | null = signed === null ? null : { kind: 'adjust', amount: signed }
  const preview = entry === null ? null : previewWith(data, settlement, entry)
  const floored = preview !== null && settlement.items.length > 0 && settlement.subtotal + preview.shipping + preview.adjustments < 0
  const reasonProblem = reason.trim() !== '' && containsPhoneRun(reason) ? PHONE_IN_TEXT : null
  const verb = sign === 'minus' ? '할인 적기' : '추가 적기'
  const submit = async () => {
    setTried(true)
    if (signed === null) return
    const value = reason.trim()
    if (value === '') {
      setEmpty(true)
      reasonField.current?.focus()
      return
    }
    if (reasonProblem !== null) return
    const result = await sender.send({ type: 'settlement.adjust', buyer: settlement.buyer, date: settlement.date, amount: signed, reason: value })
    if (result !== null) onDone(result, signed < 0 ? '할인을 적었어요' : '추가를 적었어요')
  }
  return (
    <Modal
      title={inputTitle('adjust', names.name(settlement.buyer), settlement.date)}
      onClose={onClose}
      actions={
        <button ref={submitButton} type="button" className="button button-primary" disabled={sender.busy} onClick={() => void submit()}>
          {sender.busy ? '보내는 중…' : verb}
        </button>
      }
    >
      <AmountsLine settlement={settlement} />
      <div className="row" role="radiogroup" aria-label="할인 또는 추가">
        <label className="choice">
          <input type="radio" name="adjust-sign" checked={sign === 'minus'} onChange={() => setSign('minus')} />
          <span>할인</span>
        </label>
        <label className="choice">
          <input type="radio" name="adjust-sign" checked={sign === 'plus'} onChange={() => setSign('plus')} />
          <span>추가</span>
        </label>
      </div>
      <AmountField label={sign === 'minus' ? '할인 금액' : '추가 금액'} value={amount} onChange={setAmount} range={ADJUST_RANGE} showEmpty={tried} serverMessage={serverProblem(sender.error, 'amount')} />
      {preview !== null ? (
        <p className="notice" role="status" data-tone="info">
          최종 {formatWon(settlement.total)} → {formatWon(preview.total)}
        </p>
      ) : null}
      <PaymentPreview data={data} settlement={settlement} entry={entry} />
      {floored ? (
        <p className="warning" data-tone="warning">
          할인이 금액보다 커서 최종 금액은 0원이에요.
        </p>
      ) : null}
      <ReasonField
        value={reason}
        onChange={(value) => {
          setReason(value)
          setEmpty(false)
        }}
        onPicked={() => submitButton.current?.focus()}
        reasons={ADJUST_REASONS}
        empty={empty}
        problem={reasonProblem}
        error={sender.error}
        inputRef={reasonField}
        onEnter={() => void submit()}
      />
      {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void submit()} omitFields={['reason', 'amount']} /> : null}
    </Modal>
  )
}

// ── 환불 (AC-S06-35) ────────────────────────────────────────────────────

function RefundDialog({ data, names, settlement, command, onClose, onDone }: InputDialogProps) {
  const [amount, setAmount] = useState(settlement.payment === 'OVERPAID' && settlement.refundDue > 0 ? String(settlement.refundDue) : '')
  const [reason, setReason] = useState('')
  const [empty, setEmpty] = useState(false)
  const [tried, setTried] = useState(false)
  const reasonField = useRef<HTMLInputElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const sender = useSender(command)
  const range = refundRange(settlement.received)
  const read = readAmount(amount, range)
  const reasonProblem = reason.trim() !== '' && containsPhoneRun(reason) ? PHONE_IN_TEXT : null
  const submit = async () => {
    setTried(true)
    if (read.kind !== 'ok') return
    const value = reason.trim()
    if (value === '') {
      setEmpty(true)
      reasonField.current?.focus()
      return
    }
    if (reasonProblem !== null) return
    const result = await sender.send({ type: 'settlement.refund', buyer: settlement.buyer, date: settlement.date, amount: read.amount, reason: value })
    if (result !== null) onDone(result, '환불을 적었어요')
  }
  return (
    <Modal
      title={inputTitle('refund', names.name(settlement.buyer), settlement.date)}
      onClose={onClose}
      actions={
        <button ref={submitButton} type="button" className="button button-primary" disabled={sender.busy} onClick={() => void submit()}>
          {sender.busy ? '보내는 중…' : '환불 적기'}
        </button>
      }
    >
      <AmountsLine settlement={settlement} />
      {settlement.refundDue > 0 ? <p>환불 필요 {formatWon(settlement.refundDue)}</p> : null}
      <AmountField label="환불 금액" value={amount} onChange={setAmount} range={range} showEmpty={tried} serverMessage={serverProblem(sender.error, 'amount')} />
      <PaymentPreview data={data} settlement={settlement} entry={read.kind === 'ok' ? { kind: 'refund', amount: read.amount } : null} />
      <p className="hint">{REFUND_NOTE}</p>
      <ReasonField
        value={reason}
        onChange={(value) => {
          setReason(value)
          setEmpty(false)
        }}
        onPicked={() => submitButton.current?.focus()}
        reasons={REFUND_REASONS}
        empty={empty}
        problem={reasonProblem}
        error={sender.error}
        inputRef={reasonField}
        onEnter={() => void submit()}
      />
      {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void submit()} omitFields={['reason', 'amount']} /> : null}
    </Modal>
  )
}
