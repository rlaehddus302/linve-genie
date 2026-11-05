// 영수증 보내기 (SPEC §7 화면 13, RCP-02, STL-04·05·06·10, D-N4b-04·05, AC-N4b-30~34) — 주소 `/broadcasts/<방송 ID>/receipts`.
// - 끝난 방송만: 방송 중이면 "방송을 끝낸 뒤 보낼 수 있어요."와 "콘솔로 돌아가기". 없는 방송·남의 방송은 콘솔과 같은 "찾지 못했어요".
// - 머리: 제목 "영수증 보내기", 날짜 "YYYY-MM-DD (요일)"·방송 제목, 같은 날 다른 방송이 있으면 그 안내, STL-05 고지.
// - 한 번에: 실제 = 주 버튼 "링크 전부 만들기" + "전원 확인서 PDF"·"전원 이미지(JPG) 묶음"·"이 방송 판매대장 엑셀"(그 날짜·이 방송만).
//   리허설 = 링크·판매대장 없이 안내 한 줄, 주 버튼 "전원 확인서 PDF" + "전원 이미지(JPG) 묶음".
// - 구매자 줄(서버 receipt-buyers, 일괄 순서): 이름(BUY-01 표기)·상품 수·최종 금액·입금 상태·링크 상태와 할 일, "이미지(JPG)"·"PDF".
//   금액·입금 상태·줄 수는 범위 실시간 알림으로 묶음이 바뀌면 다시 받는다. 링크 상태는 화면을 열 때·조치한 뒤 다시 받는다(링크 알림은 없다).
// - 링크: 만들기·복사(클립보드, 못 쓰면 손으로 복사할 글 칸)·보내기(글 공유를 받는 기기만)·끊기(확인 창, 처음 포커스 "닫기").
//   모든 구매자의 링크를 한꺼번에 복사·공유하는 버튼은 없다. 우리는 링크를 채팅·DM으로 보내지 않는다(D-N4b-05).
// - 보내는 동안 그 줄의 버튼은 잠긴다(같은 요청 번호로만 다시 보낸다). 조치를 마치거나 창을 닫으면 포커스는 그 줄의 바뀐 버튼으로.
// - 결과("복사했어요." 등)는 화면 읽기 프로그램이 읽는 알림 영역(role=status)에 나온다.
import { formatWon } from '@livejjim/core'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { get, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import type { ReceiptBuyerRow, ReceiptBuyers, ReceiptLink } from '../api/types.ts'
import type { ConsoleSnapshot } from '../lib/console-store.ts'
import { BuyerNames } from '../lib/derive.ts'
import { dateDashWeekday } from '../lib/kst.ts'
import { canShareText, copyText, linkWords, shareLinkText, shareText, usableLink } from '../lib/receipt-links.ts'
import { routePath, type Navigate } from '../lib/router.ts'
import type { ScopeData } from '../lib/scope-data.ts'
import { productKeyOfItem } from '../lib/use-packing.ts'
import { useScopeStore } from '../lib/use-store.ts'
import { PAYMENT_WORD } from '../lib/words.ts'
import { ledgerPath } from './LedgerDialog.tsx'
import { DownloadButton } from './downloads.tsx'
import { ErrorNote, RequestError } from './ErrorNote.tsx'
import { LiveNotices } from './LiveNotices.tsx'
import { Modal } from './Modal.tsx'
import { TAX_NOTE } from './PolicyPages.tsx'

export const RECEIPTS_TITLE = '영수증 보내기'
export const NOT_ENDED = '방송을 끝낸 뒤 보낼 수 있어요.'
export const SAME_DAY_NOTE = '같은 날 다른 방송의 상품도 함께 들어가요(정산은 날짜마다 하나예요).'
export const REHEARSAL_NOTE = '리허설에서는 공유 링크와 판매대장을 만들지 않아요.'
export const NO_RECEIPT_ROWS = '확인서를 만들 구매자가 없어요.'
export const NO_NEW_LINKS = '새로 만들 링크가 없어요.'
export const COPIED = '복사했어요.'
export const COPY_BY_HAND = '길게 눌러 복사해 주세요.'
export const LINK_MADE = '링크를 만들었어요.'
export const LINK_REVOKED_DONE = '링크를 끊었어요.'
export const SHARE_FAILED = '보내지 못했어요. "링크 복사"로 복사해 보내 주세요.'
export const BUSY_TEXT = '만드는 중…'

export const linksMade = (n: number): string => (n === 0 ? NO_NEW_LINKS : `링크 ${String(n)}개를 만들었어요.`)
export const revokeQuestion = (name: string): string => `${name}님의 링크를 끊으면 그 링크로는 더 이상 열 수 없어요. 필요하면 새 링크를 만들어 보내 주세요.`

export interface ReceiptsPageProps {
  readonly broadcastId: string
  readonly navigate: Navigate
  /** 가게 이름 (복사·공유하는 글의 앞말) */
  readonly shopName: string
}

export function ReceiptsPage({ broadcastId, navigate, shopName }: ReceiptsPageProps) {
  const { store, snapshot } = useScopeStore(broadcastId, () => ({ broadcastId, messages: false }))
  if (snapshot.phase === 'missing') {
    return (
      <main className="page">
        <h1>방송을 찾지 못했어요</h1>
        <p>방송 목록에서 다시 골라 주세요.</p>
      </main>
    )
  }
  if (snapshot.phase === 'error' && snapshot.error !== null) {
    return (
      <main className="page">
        <h1>{RECEIPTS_TITLE}</h1>
        <ErrorNote error={snapshot.error} onRetry={() => window.location.reload()} retryLabel="다시 열기" />
      </main>
    )
  }
  if (store === null || snapshot.data === null || snapshot.broadcast === null) {
    return (
      <main className="page">
        <h1>{RECEIPTS_TITLE}</h1>
        <div className="page-sticky">
          <LiveNotices snapshot={snapshot} onRetry={() => void store?.retryNow()} />
        </div>
        <p role="status">불러오는 중…</p>
      </main>
    )
  }
  const broadcast = snapshot.broadcast
  const view = snapshot.data.broadcasts.get(broadcastId)
  const ended = view?.ended ?? broadcast.ended
  const consoleLink = (
    <a
      className="button"
      href={routePath({ name: 'console', id: broadcastId })}
      onClick={(event) => {
        event.preventDefault()
        navigate({ name: 'console', id: broadcastId })
      }}
    >
      방송 화면으로 돌아가기
    </a>
  )
  if (!ended) {
    return (
      <main className="page">
        <h1>{RECEIPTS_TITLE}</h1>
        <p className="notice" role="status">
          {NOT_ENDED}
        </p>
        <p>{consoleLink}</p>
      </main>
    )
  }
  return (
    <ReadyReceipts
      broadcastId={broadcastId}
      title={view?.title ?? broadcast.title}
      rehearsal={broadcast.rehearsal}
      data={snapshot.data}
      snapshot={snapshot}
      onRetry={() => void store.retryNow()}
      consoleLink={consoleLink}
      shopName={shopName}
    />
  )
}

/** 구매자 줄에 닿는 범위 자료의 모양: 그날 묶음(품목·금액·입금 기록)·구매자 표시 이름·끝자리·품종·방송 제목. 같으면 다시 받지 않는다 */
export function receiptRowsSignature(data: ScopeData): string {
  const parts: unknown[] = []
  for (const settlement of data.settlements.values()) {
    if (settlement.date !== data.date) continue
    const buyer = data.buyers.get(settlement.buyer)
    parts.push([settlement, buyer?.display ?? '', buyer?.phoneLast4 ?? null, buyer?.mergedInto ?? null, settlement.items.map((key) => data.products.get(productKeyOfItem(key))?.name ?? '')])
  }
  for (const broadcast of data.broadcasts.values()) parts.push([broadcast.id, broadcast.title])
  return JSON.stringify(parts)
}

interface RowsState {
  readonly rows: readonly ReceiptBuyerRow[] | null
  readonly error: ApiError | null
  readonly reload: () => void
  /** 조치 응답의 링크로 줄을 바로 바꾼다 (다시 받기를 기다리지 않는다) */
  readonly applyLinks: (links: readonly ReceiptLink[]) => void
  /** 서버에서 다시 읽은 지금 가게 이름 (아직 못 읽었으면 null — 로그인 정보의 이름을 쓴다) */
  readonly shopName: string | null
}

/** 지금 가게 이름 (GET /api/shop). 받지 못하면 null — 줄 받기를 막지 않는다 */
async function readShopName(): Promise<string | null> {
  try {
    const { shop } = await get<{ shop: { name: string } }>('/api/shop')
    return typeof shop.name === 'string' && shop.name !== '' ? shop.name : null
  } catch {
    return null
  }
}

/**
 * 구매자 줄 받기: trigger가 바뀌거나 reload를 부르면 다시 받는다. 늦게 온 앞 응답은 버린다.
 * 가게 설정이 바뀌면(shopVersion — 다른 기기에서 바꾼 것 포함) 줄보다 먼저 가게 이름을 다시 읽는다:
 * 복사·공유 글의 가게 이름이 구매자 문서(/r/<토큰>, 서버의 지금 가게 이름)와 같아야 한다 (AC-N4b-33, TE-N4b-002).
 * 줄과 이름을 한 번에 바꾸므로 새 줄이 보이면 글도 새 이름이다.
 */
function useReceiptRows(date: string, rehearsal: boolean, trigger: string, shopVersion: number): RowsState {
  const [rows, setRows] = useState<readonly ReceiptBuyerRow[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [shopName, setShopName] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const version = useRef(0)
  /** 가게 이름을 마지막으로 읽은 shopVersion (처음엔 읽은 적 없음) */
  const shopRead = useRef<number | null>(null)
  useEffect(() => {
    const mine = ++version.current
    const fresh = shopRead.current === shopVersion ? Promise.resolve(undefined) : readShopName()
    const load = async () => {
      const name = await fresh
      return { name, result: await get<ReceiptBuyers>(withQuery(`/api/days/${date}/receipt-buyers`, { rehearsal })) }
    }
    load().then(
      ({ name, result }) => {
        if (mine !== version.current) return
        if (typeof name === 'string') {
          shopRead.current = shopVersion
          setShopName(name)
        }
        setRows(result.buyers)
        setError(null)
      },
      (caught: unknown) => {
        if (mine !== version.current || !isApiError(caught)) return
        setError(caught)
      },
    )
  }, [date, rehearsal, trigger, attempt, shopVersion])
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const applyLinks = useCallback((links: readonly ReceiptLink[]) => {
    const byBuyer = new Map(links.map((link) => [link.buyer, link]))
    setRows((current) => current?.map((row) => (byBuyer.has(row.buyer) ? { ...row, link: byBuyer.get(row.buyer) ?? row.link } : row)) ?? current)
  }, [])
  return { rows, error, reload, applyLinks, shopName }
}

interface ReadyProps {
  readonly broadcastId: string
  readonly title: string
  readonly rehearsal: boolean
  readonly data: ScopeData
  readonly snapshot: ConsoleSnapshot
  readonly onRetry: () => void
  readonly consoleLink: ReactNode
  readonly shopName: string
}

function ReadyReceipts({ broadcastId, title, rehearsal, data, snapshot, onRetry, consoleLink, shopName: loginShopName }: ReadyProps) {
  const date = data.date
  const signature = useMemo(() => receiptRowsSignature(data), [data])
  const { rows, error, reload, applyLinks, shopName: freshShopName } = useReceiptRows(date, rehearsal, signature, snapshot.shopVersion)
  const shopName = freshShopName ?? loginShopName
  const names = useMemo(() => new BuyerNames(data.buyers, data.claims), [data.buyers, data.claims])
  const sameDay = [...data.broadcasts.values()].some((item) => item.id !== broadcastId)
  const [allBusy, setAllBusy] = useState(false)
  const [allResult, setAllResult] = useState<string | null>(null)
  const [allError, setAllError] = useState<ApiError | null>(null)
  const allRequest = useRef<string | null>(null)

  const makeAll = async () => {
    if (allBusy) return
    // 같은 누름의 재시도는 같은 요청 번호 — 성공하거나 서버가 거절하면 새 번호
    const requestId = allRequest.current ?? newRequestId()
    allRequest.current = requestId
    setAllBusy(true)
    setAllError(null)
    setAllResult(null)
    try {
      const result = await withRetry(() => post<{ created: number; links: ReceiptLink[] }>(`/api/days/${date}/receipt-links/all`, { requestId }))
      allRequest.current = null
      applyLinks(result.links)
      setAllResult(linksMade(result.created))
      reload()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.network) allRequest.current = null
      setAllError(caught)
    } finally {
      setAllBusy(false)
    }
  }

  const count = rows?.length ?? 0
  const loaded = rows !== null
  const query = { rehearsal }
  const prefix = rehearsal ? 'rehearsal-' : ''

  return (
    <main className="page receipts-page">
      <h1>{RECEIPTS_TITLE}</h1>
      <div className="page-sticky">
        <LiveNotices snapshot={snapshot} onRetry={onRetry} />
      </div>
      <div className="stack-tight receipts-head">
        <p className="receipts-when">
          <span>{dateDashWeekday(date)}</span> · <span>{title}</span>
          {rehearsal ? <span className="tag tag-rehearsal">리허설</span> : null}
        </p>
        {sameDay ? <p>{SAME_DAY_NOTE}</p> : null}
        {rehearsal ? (
          <p className="notice" role="note">
            {REHEARSAL_NOTE}
          </p>
        ) : null}
        <p className="hint">{TAX_NOTE}.</p>
        <p>{consoleLink}</p>
      </div>

      {error !== null && rows === null ? <RequestError error={error} onRetry={reload} retryLabel="다시 불러오기" /> : null}
      {!loaded && error === null ? <p role="status">불러오는 중…</p> : null}

      {loaded ? (
        <section className="stack-tight receipts-all" aria-label="한 번에 하기">
          <div className="row receipts-actions">
            {!rehearsal && count > 0 ? (
              <span className="download stack-tight">
                <span className="row">
                  <button type="button" className="button button-primary" disabled={allBusy} onClick={() => void makeAll()}>
                    링크 전부 만들기
                  </button>
                  {allBusy ? <span role="status">{BUSY_TEXT}</span> : null}
                </span>
              </span>
            ) : null}
            {count > 0 ? (
              <>
                <DownloadButton label="전원 확인서 PDF" busyText={BUSY_TEXT} path={withQuery(`/api/days/${date}/receipts.pdf`, query)} fallbackName={`${prefix}receipts-${date}-all.pdf`} primary={rehearsal} />
                <DownloadButton label="전원 이미지(JPG) 묶음" busyText={BUSY_TEXT} path={withQuery(`/api/days/${date}/receipts.zip`, query)} fallbackName={`${prefix}receipts-${date}-images.zip`} />
              </>
            ) : null}
            {rehearsal ? null : <DownloadButton label="이 방송 판매대장 엑셀" busyText={BUSY_TEXT} path={ledgerPath(date, date, [broadcastId], false)} fallbackName={`ledger-${date}.xlsx`} />}
          </div>
          <div aria-live="polite" role="status" className="receipts-result">
            {allResult !== null ? <p className="notice" data-tone="success">{allResult}</p> : null}
          </div>
          {allError !== null ? <RequestError error={allError} onRetry={allError.network ? () => void makeAll() : undefined} /> : null}
        </section>
      ) : null}

      {loaded && error !== null ? <RequestError error={error} onRetry={reload} retryLabel="다시 불러오기" /> : null}

      {loaded ? (
        count === 0 ? (
          <p>{NO_RECEIPT_ROWS}</p>
        ) : (
          <ul className="plain-list receipt-rows" aria-label="구매자">
            {rows.map((row) => (
              <BuyerRow
                key={row.buyer}
                row={row}
                name={data.buyers.has(row.buyer) ? names.name(row.buyer) : row.name}
                date={date}
                rehearsal={rehearsal}
                shopName={shopName}
                locked={allBusy}
                onLink={(link) => {
                  applyLinks([link])
                  reload()
                }}
              />
            ))}
          </ul>
        )
      ) : null}
    </main>
  )
}

/** 줄의 조치 뒤 포커스를 둘 버튼 */
type FocusTarget = 'create' | 'copy' | 'revoke' | null

interface BuyerRowProps {
  readonly row: ReceiptBuyerRow
  readonly name: string
  readonly date: string
  readonly rehearsal: boolean
  readonly shopName: string
  /** "링크 전부 만들기"를 보내는 중 — 링크 버튼을 잠근다 */
  readonly locked: boolean
  readonly onLink: (link: ReceiptLink) => void
}

function BuyerRow({ row, name, date, rehearsal, shopName, locked, onLink }: BuyerRowProps) {
  const nameId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [manual, setManual] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [focus, setFocus] = useState<FocusTarget>(null)
  const pending = useRef<{ kind: 'create' | 'revoke'; requestId: string } | null>(null)
  const createRef = useRef<HTMLButtonElement>(null)
  const copyRef = useRef<HTMLButtonElement>(null)
  const revokeRef = useRef<HTMLButtonElement>(null)
  const manualRef = useRef<HTMLInputElement>(null)

  const link = row.link
  const usable = usableLink(link)
  const text = usable ? shareText(shopName, link.expiresAt, link.url) : null
  const shareable = text !== null && canShareText(text)

  // 조치를 마치면(줄이 바뀐 뒤) 그 줄의 바뀐 버튼으로 포커스
  useEffect(() => {
    if (focus === null || busy) return
    const target = focus === 'create' ? createRef.current : focus === 'copy' ? copyRef.current : revokeRef.current
    const fallback = createRef.current ?? copyRef.current
    ;(target ?? fallback)?.focus()
    setFocus(null)
  }, [focus, busy, usable])

  // 손으로 복사할 글 칸: 나타나면 글을 골라 둔다
  useEffect(() => {
    if (manual === null) return
    manualRef.current?.focus()
    manualRef.current?.select()
  }, [manual])

  const send = async (kind: 'create' | 'revoke') => {
    if (busy) return
    const requestId = pending.current?.kind === kind ? pending.current.requestId : newRequestId()
    pending.current = { kind, requestId }
    setBusy(true)
    setError(null)
    setResult(null)
    setManual(null)
    try {
      const path = kind === 'create' ? `/api/days/${date}/receipt-links` : `/api/days/${date}/receipt-links/revoke`
      const response = await withRetry(() => post<{ link: ReceiptLink }>(path, { requestId, buyer: row.buyer }))
      pending.current = null
      onLink(response.link)
      setResult(kind === 'create' ? LINK_MADE : LINK_REVOKED_DONE)
      setFocus(kind === 'create' ? 'copy' : 'create')
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.network) pending.current = null
      setError(caught)
      setFocus(kind)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (text === null) return
    setResult(null)
    setError(null)
    if (await copyText(text)) {
      setManual(null)
      setResult(COPIED)
    } else {
      setManual(text)
    }
  }

  const share = async () => {
    if (text === null) return
    setResult(null)
    setError(null)
    const outcome = await shareLinkText(text)
    if (outcome === 'failed') setResult(SHARE_FAILED)
  }

  const linkLocked = busy || locked
  const showCreate = !rehearsal && !usable

  return (
    <li className="receipt-row card">
      <div className="stack-tight" role="group" aria-labelledby={nameId}>
        <div className="receipt-row-head">
          <p id={nameId} className="receipt-row-name">
            {name}
          </p>
          {row.phoneLast4 !== null && !name.includes(row.phoneLast4) ? <p className="hint">휴대폰 끝자리 {row.phoneLast4}</p> : null}
          <p className="receipt-row-facts">
            <span>상품 {String(row.itemCount)}개</span> · <strong>{formatWon(row.total)}</strong> <span className={`tag pay-${row.payment}`}>{PAYMENT_WORD[row.payment]}</span>
          </p>
          {rehearsal ? null : <p className="receipt-row-link">{linkWords(link)}</p>}
        </div>
        <div className="row receipt-row-actions">
          {showCreate ? (
            <button ref={createRef} type="button" className="button" disabled={linkLocked} onClick={() => void send('create')}>
              링크 만들기
            </button>
          ) : null}
          {!rehearsal && usable ? (
            <>
              <button ref={copyRef} type="button" className="button" disabled={linkLocked} onClick={() => void copy()}>
                링크 복사
              </button>
              {shareable ? (
                <button type="button" className="button" disabled={linkLocked} onClick={() => void share()}>
                  링크 보내기
                </button>
              ) : null}
              <button ref={revokeRef} type="button" className="button" disabled={linkLocked} onClick={() => setConfirming(true)}>
                링크 끊기
              </button>
            </>
          ) : null}
          <DownloadButton label="이미지(JPG)" busyText={BUSY_TEXT} path={withQuery(`/api/days/${date}/receipt.jpg`, { buyer: row.buyer, rehearsal })} fallbackName={`${rehearsal ? 'rehearsal-' : ''}receipt-${date}.jpg`} />
          <DownloadButton label="PDF" busyText={BUSY_TEXT} path={withQuery(`/api/days/${date}/receipt.pdf`, { buyer: row.buyer, rehearsal })} fallbackName={`${rehearsal ? 'rehearsal-' : ''}receipt-${date}.pdf`} />
        </div>
        <div role="status" aria-live="polite" className="receipt-row-result">
          {busy ? <span>{BUSY_TEXT}</span> : result !== null ? <span>{result}</span> : null}
        </div>
        {manual !== null ? (
          <div className="field">
            <label htmlFor={`${nameId}-manual`}>{COPY_BY_HAND}</label>
            <input id={`${nameId}-manual`} ref={manualRef} className="input" readOnly value={manual} onFocus={(event) => event.currentTarget.select()} />
          </div>
        ) : null}
        {error !== null ? <RequestError error={error} onRetry={error.network ? () => void send(pending.current?.kind ?? 'create') : undefined} /> : null}
      </div>
      {confirming ? (
        <Modal
          title="링크 끊기"
          onClose={() => {
            setConfirming(false)
            setFocus('revoke')
          }}
          actions={
            <button
              type="button"
              className="button button-danger"
              data-key="1"
              onClick={() => {
                setConfirming(false)
                void send('revoke')
              }}
            >
              1 링크 끊기
            </button>
          }
        >
          <p>{revokeQuestion(name)}</p>
        </Modal>
      ) : null}
    </li>
  )
}
