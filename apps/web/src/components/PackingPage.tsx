// 포장 모드 (SPEC §7 화면 5, STL-08, LBL-02·03·07, D-I2-05~D-I2-07, AC-I2-35~39·55·80~82).
// - 날짜(실제 범위만, 연도·요일)·연 구매자는 주소 검색값(`/packing?date=2026-10-18&buyer=UC_A`) — 새로고침·뒤로 가기에도 같은 화면.
//   기본 = 오늘(KST) 실제 범위, 없으면 가장 최근 실제 범위, 둘 다 없으면 "아직 판매 기록이 없어요."
// - 목록: 걸러 보기("포장할 것" 기본·"포장 완료"·"배송 완료"·"전체"), 줄마다 이름(BUY-01 이름 표기)·"상품 n개"·상태 말(색 + 글자)·입금 완료가 아니면 입금 상태.
//   순서는 포장 다시 확인·배송 뒤 바뀜 먼저, 그다음 이름 순(구매자 목록과 같은 순서).
// - 체크리스트(휴대폰은 화면 전체, 넓은 화면은 목록 옆): 상품 줄 전체가 체크 칸(44px 이상, 이름 "15번 핑크프릴"). 모두 체크해야 "포장 완료"가 켜지고
//   누르면 체크한 품목과 함께 바로 보낸다. 체크는 이 기기 화면에만 있다(저장하지 않는다 — 새로고침하면 처음부터).
// - 품목이 바뀌면 새 품목은 체크 안 됨으로 더하고 빠진 품목은 지우고 남은 체크는 그대로, "구매 내역이 바뀌었어요 — 새로 담을 것: … · 뺄 것: …".
// - 배송 완료(송장번호 선택)·송장번호 고치기·배송 완료 취소·포장 완료 취소. 확인 창의 처음 포커스는 "닫기". 같은 요청은 같은 요청 번호로 다시 보낸다.
// - 명령 결과("포장 완료로 적었어요."·오류)와 "다음 구매자"는 버튼 줄 바로 위·안에 — 휴대폰에서 맨 아래 "포장 완료"를 누른 자리에서 보인다.
//   저장되면 포커스를 "다음 구매자"(없으면 결과 안내)로 옮긴다. 포장 완료 직후엔 "다음 구매자"가 주 버튼이다 (UX-I2-001).
// - 포장 라벨: 쪽마다 서버 그림(대체 글 "포장 라벨 1/2쪽")·"그림 저장"(PNG)·"라벨 PDF". 라벨에 찍히는 값(품목·방송 제목·상품 합계·구매자 이름·가게 이름)이
//   바뀌면 새로 받고, 받기 전엔 저장을 잠근다 (SA-I2-002).
//   "B1로 출력"·프린터 연결은 없다(I1을 합친 뒤 — D-I2-07).
import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import { get, getFile, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import type { PackingAction, PackingEntry, PackingItem, PackingLabelView, PackingResult } from '../api/types.ts'
import type { ConsoleSnapshot, ConsoleStore } from '../lib/console-store.ts'
import { BuyerNames } from '../lib/derive.ts'
import { objectUrl, revokeObjectUrl, saveFile } from '../lib/files.ts'
import { dateLong, kstToday } from '../lib/kst.ts'
import {
  PACKING_FILTERS,
  PACKING_TONE,
  changeNotice,
  checklistSpansBroadcasts,
  diffItems,
  inFilter,
  isChanged,
  nextBuyer,
  packingWords,
  sortEntries,
  type ItemChange,
  type PackingFilter,
} from '../lib/packing.ts'
import { routePath, type Navigate, type PackingRoute } from '../lib/router.ts'
import type { ScopeData } from '../lib/scope-data.ts'
import { packingLabelSignature, useClosingSignature, usePackingList } from '../lib/use-packing.ts'
import { useScopeStore } from '../lib/use-store.ts'
import { useWide } from '../lib/use-wide.ts'
import { PAYMENT_WORD } from '../lib/words.ts'
import { useDownload } from './downloads.tsx'
import { ErrorNote, RequestError } from './ErrorNote.tsx'
import { LiveNotices } from './LiveNotices.tsx'
import { Modal } from './Modal.tsx'

export const NO_SALES = '아직 판매 기록이 없어요.'
export const ALL_CHECKED_HINT = '모두 담으면 포장 완료를 누를 수 있어요.'
export const PACKED_NOTICE = '포장 완료로 적었어요.'
export const NO_LABEL_ITEMS = '담을 상품이 없어 포장 라벨을 만들 수 없어요.'
export const LABEL_LOADING = '포장 라벨을 만드는 중이에요…'
export const ITEMS_CHANGED_RESULT = '그 사이 구매 내역이 바뀌어 포장 완료로 적지 않았어요. 바뀐 품목을 담고 다시 눌러 주세요.'

// ── 날짜 고르기 (실제 범위만) ────────────────────────────────────────────

interface Days {
  readonly days: readonly string[] | null
  readonly error: ApiError | null
  readonly retry: () => void
}

/** 실제 범위 날짜를 받아 기본 날짜를 주소에 적는다 (기록을 남기지 않고) */
function usePackingDays(route: PackingRoute, navigate: Navigate): Days {
  const [days, setDays] = useState<readonly string[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setError(null)
    get<{ days: { date: string }[] }>('/api/days').then(
      (result) => {
        if (alive) setDays(result.days.map((day) => day.date))
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])
  const defaultDay = days === null ? null : days.includes(kstToday()) ? kstToday() : days.length === 0 ? null : days.reduce((latest, date) => (date > latest ? date : latest))
  useEffect(() => {
    if (route.date === undefined && defaultDay !== null) navigate({ name: 'packing', date: defaultDay }, { replace: true })
  }, [route.date, defaultDay, navigate])
  return { days, error, retry: () => setAttempt((n) => n + 1) }
}

function DayPicker({ route, navigate, days }: { readonly route: PackingRoute; readonly navigate: Navigate; readonly days: readonly string[] }) {
  const id = useId()
  const options = [...new Set([...days, ...(route.date === undefined ? [] : [route.date])])].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  if (options.length === 0) return null
  return (
    <div className="field scope-picker">
      <label htmlFor={id}>날짜</label>
      <select id={id} className="input" value={route.date ?? ''} onChange={(event) => navigate({ name: 'packing', date: event.target.value })}>
        {route.date === undefined ? <option value="">날짜를 골라 주세요</option> : null}
        {options.map((day) => (
          <option key={day} value={day}>
            {dateLong(day)}
          </option>
        ))}
      </select>
    </div>
  )
}

export function PackingPage({ route, navigate }: { readonly route: PackingRoute; readonly navigate: Navigate }) {
  const days = usePackingDays(route, navigate)
  const date = route.date ?? null
  const { store, snapshot } = useScopeStore(date === null ? null : `packing|${date}`, () => ({ scope: { date: date ?? '', rehearsal: false } }))
  return (
    <main className="page page-wide packing-page">
      <h1>포장</h1>
      <div className="row scope-row">
        {days.error !== null ? <RequestError error={days.error} onRetry={days.retry} retryLabel="다시 불러오기" /> : days.days === null ? <p role="status">날짜를 불러오는 중…</p> : <DayPicker route={route} navigate={navigate} days={days.days} />}
      </div>
      {date === null ? (
        days.days !== null ? <p>{NO_SALES}</p> : null
      ) : snapshot.phase === 'missing' ? (
        <p>{NO_SALES}</p>
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
        <ReadyPacking key={date} route={route} navigate={navigate} store={store} snapshot={snapshot} data={snapshot.data} />
      )}
    </main>
  )
}

interface ReadyProps {
  readonly route: PackingRoute
  readonly navigate: Navigate
  readonly store: ConsoleStore
  readonly snapshot: ConsoleSnapshot
  readonly data: ScopeData
}

function ReadyPacking({ route, navigate, store, snapshot, data }: ReadyProps) {
  const wide = useWide()
  const names = useMemo(() => new BuyerNames(data.buyers, data.claims), [data.buyers, data.claims])
  const signature = useClosingSignature(data)
  const packing = usePackingList(data.date, `${signature}|${String(snapshot.packingVersion)}`)
  const [filter, setFilter] = useState<PackingFilter>('todo')
  const displayOf = (entry: PackingEntry) => data.buyers.get(entry.buyer)?.display ?? entry.name
  const sorted = useMemo(() => (packing.entries === null ? [] : sortEntries(packing.entries, displayOf)), [packing.entries, data.buyers])
  const nameOf = (entry: PackingEntry) => (data.buyers.has(entry.buyer) ? names.name(entry.buyer) : entry.name)
  const open = (buyer: string | undefined) => navigate({ name: 'packing', date: data.date, ...(buyer === undefined ? {} : { buyer }) })

  // 연 구매자가 그사이 다른 구매자에 합쳐졌으면 지금의 구매자로 (주소를 바꾼다 — 기록을 남기지 않고)
  const current = route.buyer === undefined ? undefined : (data.buyers.get(route.buyer)?.current ?? route.buyer)
  useEffect(() => {
    if (route.buyer !== undefined && current !== undefined && current !== route.buyer) navigate({ name: 'packing', date: data.date, buyer: current }, { replace: true })
  }, [route.buyer, current, data.date, navigate])
  const selected = current === undefined ? undefined : sorted.find((entry) => entry.buyer === current)

  const list = <PackingListView data={data} entries={sorted} filter={filter} onFilter={setFilter} nameOf={nameOf} selected={current} onOpen={open} loaded={packing.entries !== null} />
  const checklist =
    current === undefined ? null : selected === undefined ? (
      packing.entries === null ? (
        <p role="status">불러오는 중…</p>
      ) : (
        <div className="stack-tight">
          <p>그 구매자의 포장 묶음이 없어요.</p>
          <button type="button" className="button" onClick={() => open(undefined)}>
            포장 목록으로
          </button>
        </div>
      )
    ) : (
      <PackingChecklist
        key={selected.buyer}
        date={data.date}
        entry={selected}
        name={nameOf(selected)}
        labelSignature={`${packingLabelSignature(data, selected.buyer)}|${String(snapshot.shopVersion)}`}
        showBack={!wide}
        onBack={() => open(undefined)}
        onSent={packing.replace}
        next={nextBuyer(sorted, selected.buyer)}
        onNext={(buyer) => open(buyer)}
      />
    )

  return (
    <>
      <div className="page-sticky">
        <LiveNotices snapshot={snapshot} onRetry={() => void store.retryNow()} />
      </div>
      {packing.error !== null ? <RequestError error={packing.error} onRetry={packing.reload} retryLabel="다시 불러오기" /> : null}
      {wide ? (
        <div className="packing-layout">
          {list}
          {checklist}
        </div>
      ) : current !== undefined ? (
        checklist
      ) : (
        list
      )}
    </>
  )
}

// ── 목록 (AC-I2-35) ─────────────────────────────────────────────────────

/** 왼쪽 단추만 화면 안에서 연다 (새 탭·창은 브라우저가) */
function linkClick(event: MouseEvent<HTMLAnchorElement>, go: () => void): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  go()
}

interface ListProps {
  readonly data: ScopeData
  readonly entries: readonly PackingEntry[]
  readonly filter: PackingFilter
  readonly onFilter: (filter: PackingFilter) => void
  readonly nameOf: (entry: PackingEntry) => string
  readonly selected: string | undefined
  readonly onOpen: (buyer: string) => void
  readonly loaded: boolean
}

function PackingListView({ data, entries, filter, onFilter, nameOf, selected, onOpen, loaded }: ListProps) {
  const visible = entries.filter((entry) => inFilter(entry, filter))
  const empty = PACKING_FILTERS.find((item) => item.key === filter)?.empty ?? ''
  return (
    <section className="stack packing-list" aria-label="포장 목록">
      <div className="row" role="group" aria-label="걸러 보기">
        {PACKING_FILTERS.map((item) => (
          <button key={item.key} type="button" className="button" aria-pressed={filter === item.key} onClick={() => onFilter(item.key)}>
            {item.word}
          </button>
        ))}
      </div>
      {!loaded ? <p role="status">포장 목록을 불러오는 중…</p> : visible.length === 0 ? <p>{empty}</p> : null}
      {visible.length > 0 ? (
        <ul className="plain-list stack-tight" aria-label="포장할 구매자">
          {visible.map((entry) => (
            <li key={entry.buyer}>
              <a
                className="list-link packing-row"
                href={routePath({ name: 'packing', date: data.date, buyer: entry.buyer })}
                aria-current={entry.buyer === selected ? 'true' : undefined}
                onClick={(event) => linkClick(event, () => onOpen(entry.buyer))}
              >
                <strong className="buyer-name">{nameOf(entry)}</strong>
                <span>상품 {entry.items.length}개</span>
                <span className="tag" data-tone={PACKING_TONE[entry.status]}>
                  {packingWords(entry.status, entry.invoice)}
                </span>
                {entry.payment !== 'PAID' ? (
                  <span className="tag" data-tone="warning">
                    {PAYMENT_WORD[entry.payment]}
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

// ── 체크리스트 (AC-I2-36~38) ────────────────────────────────────────────

interface ChecklistProps {
  readonly date: string
  readonly entry: PackingEntry
  readonly name: string
  /** 포장 라벨에 찍히는 값(L-9)과 가게 이름의 모양 — 바뀌면 라벨 그림을 새로 받는다 */
  readonly labelSignature: string
  readonly showBack: boolean
  readonly onBack: () => void
  /** 명령 응답(거절 응답 포함)의 지금 상태로 목록 한 줄을 바꾼다 */
  readonly onSent: (entry: PackingEntry) => void
  /** "다음 구매자" (포장할 것 목록의 다음 사람) */
  readonly next: string | null
  readonly onNext: (buyer: string) => void
}

type Ask = 'ship' | 'fixInvoice' | 'unpack' | 'unship' | null

interface Sent {
  readonly text: string
  readonly packed: boolean
}

const SENT_TEXT: Readonly<Record<PackingAction, string>> = {
  pack: PACKED_NOTICE,
  unpack: '포장 완료를 취소했어요.',
  ship: '배송 완료로 적었어요.',
  unship: '배송 완료를 취소했어요.',
}

/** 포장 명령 보내기: 같은 내용을 다시 보내면 같은 요청 번호 (연결이 끊긴 뒤 다시 눌러도 한 번만 기록) */
function usePackingCommand(date: string, buyer: string, onSent: (entry: PackingEntry) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const pending = useRef<{ key: string; requestId: string } | null>(null)
  const running = useRef(false)
  const send = async (body: { readonly action: PackingAction; readonly items?: readonly string[]; readonly invoice?: string | null }): Promise<PackingResult | null> => {
    if (running.current) return null
    const key = JSON.stringify([buyer, body])
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const { requestId } = pending.current
    running.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await withRetry(() => post<PackingResult>(`/api/days/${date}/packing`, { requestId, buyer, ...body }))
      pending.current = null
      onSent(result.entry)
      return result
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      // 거절 응답에도 지금 상태가 실려 온다 — 화면을 그 상태로
      const entry = caught.details.entry
      if (typeof entry === 'object' && entry !== null && 'buyer' in entry) onSent(entry as PackingEntry)
      if (!caught.transient) pending.current = null
      setError(caught)
      return null
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { busy, error, send, clearError: () => setError(null) }
}

function PackingChecklist({ date, entry, name, labelSignature, showBack, onBack, onSent, next, onNext }: ChecklistProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  /** 비교 기준: 연 때의 품목(포장·포장 취소가 저장되면 그때의 품목) */
  const [base, setBase] = useState<readonly PackingItem[]>(entry.items)
  const [sent, setSent] = useState<Sent | null>(null)
  const [ask, setAsk] = useState<Ask>(null)
  const command = usePackingCommand(date, entry.buyer, onSent)
  const keys = entry.items.map((item) => item.key)
  const done = keys.filter((key) => checked.has(key)).length
  const allChecked = keys.length > 0 && done === keys.length
  const change: ItemChange = isChanged(entry.status) ? { add: entry.add, remove: entry.remove } : entry.status === '포장 대기' ? diffItems(base, entry.items) : { add: [], remove: [] }
  const changed = change.add.length > 0 || change.remove.length > 0
  // 방송 제목: 지금 품목과 바뀐 품목을 합쳐 방송이 둘 이상이면 안내와 체크리스트 모두에 붙인다 (1부 7번·2부 7번 — TD-I2-002)
  const multi = checklistSpansBroadcasts(entry.items, change)
  const canPack = entry.status === '포장 대기' || entry.status === '포장 다시 확인'
  /** 포장 완료를 저장한 뒤 "다음 구매자" — 상태가 그대로 포장 완료면 주 버튼(배송 완료로 적기는 보조), 그 사이 품목이 바뀌었으면 보조 */
  const nextBuyerId = sent !== null && sent.packed ? next : null
  const nextFirst = nextBuyerId !== null && entry.status === '포장 완료'
  const nextButton = useRef<HTMLButtonElement>(null)
  const result = useRef<HTMLDivElement>(null)
  /** 명령이 저장되면 창이 닫힌 뒤 한 번 포커스를 옮긴다 */
  const focusAfterSend = useRef(false)

  const toggle = (key: string) =>
    setChecked((set) => {
      const nextSet = new Set(set)
      if (nextSet.has(key)) nextSet.delete(key)
      else nextSet.add(key)
      return nextSet
    })

  const run = async (body: { readonly action: PackingAction; readonly items?: readonly string[]; readonly invoice?: string | null }) => {
    setSent(null)
    const reply = await command.send(body)
    if (reply === null) return false
    if (body.action === 'pack' || body.action === 'unpack') setBase(reply.entry.items)
    focusAfterSend.current = true
    setSent({ text: SENT_TEXT[body.action], packed: body.action === 'pack' })
    return true
  }

  // 저장되면 누른 자리 근처의 다음 할 일로: "다음 구매자", 없으면 결과 안내 (누른 버튼이 사라져 포커스가 문서 처음으로 가지 않게, 휴대폰은 그 자리가 화면 안으로)
  useEffect(() => {
    if (!focusAfterSend.current || ask !== null) return
    focusAfterSend.current = false
    const target = nextButton.current ?? result.current
    target?.focus()
  }, [sent, ask])

  const pack = () => {
    if (!allChecked) return
    void run({ action: 'pack', items: keys })
  }

  // 거절(그 사이 품목이 바뀜)은 바뀐 품목 안내로 보인다 — 같은 글을 두 번 보이지 않게 오류 문장은 뺀다
  // 창(배송 완료·확인)이 열려 있으면 오류는 그 창 안에만 보인다
  const showError = command.error !== null && ask === null && !(command.error.code === 'ITEMS_CHANGED' && changed)
  // 그때는 버튼 옆에 "적지 않았어요"만 짧게 (바뀐 품목 안내는 체크리스트 위에 있다 — 휴대폰에서 누른 자리에 결과가 없지 않게)
  const itemsChangedResult = command.error !== null && ask === null && command.error.code === 'ITEMS_CHANGED' && changed
  const groups = useMemo(() => {
    const out: { broadcast: string; title: string; items: PackingItem[] }[] = []
    for (const item of entry.items) {
      const last = out.at(-1)
      if (last !== undefined && last.broadcast === item.broadcast) last.items.push(item)
      else out.push({ broadcast: item.broadcast, title: item.title, items: [item] })
    }
    return out
  }, [entry.items])

  return (
    <section className="stack packing-checklist" aria-label="체크리스트">
      {showBack ? (
        <button type="button" className="button back-button" onClick={onBack}>
          포장 목록으로
        </button>
      ) : null}
      <header className="stack-tight">
        <h2 className="section-title">{name}</h2>
        <p className="row">
          <span>{dateLong(date)}</span>
          <span>상품 {entry.items.length}개</span>
          <span className={`tag pay-${entry.payment}`}>{PAYMENT_WORD[entry.payment]}</span>
          <span className="tag" data-tone={PACKING_TONE[entry.status]}>
            {packingWords(entry.status, entry.invoice)}
          </span>
        </p>
      </header>

      {changed ? (
        <p className="notice" role="status" data-tone="warning">
          {changeNotice(change, multi, entry.status === '배송 뒤 바뀜')}
        </p>
      ) : null}

      {entry.items.length === 0 ? <p>담을 상품이 없어요.</p> : null}
      <div className="stack-tight">
        {groups.map((group) => (
          <div key={group.broadcast} className="stack-tight" role="group" aria-label={multi ? group.title : '담을 상품'}>
            {multi ? <h3 className="sub-title">{group.title}</h3> : null}
            <ul className="plain-list stack-tight">
              {group.items.map((item) => (
                <li key={item.key}>
                  <label className="pack-item">
                    <input type="checkbox" checked={checked.has(item.key)} onChange={() => toggle(item.key)} />
                    <span className="pack-no">{String(item.no)}번</span> <span className="pack-name">{item.name.trim() === '' ? '품종 미입력' : item.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {entry.items.length > 0 ? (
        <p className="pack-count" aria-live="polite">
          {String(done)}/{String(keys.length)} 담음
        </p>
      ) : null}

      {/* 결과는 버튼 줄 바로 위 — 휴대폰에서 맨 아래 버튼을 누른 자리에서 보인다 (UX-I2-001) */}
      {sent !== null ? (
        <div ref={result} tabIndex={-1} className="notice packing-result" role="status" data-tone="success">
          {sent.text}
        </div>
      ) : null}
      {showError && command.error !== null ? <RequestError error={command.error} omitFields={['invoice']} /> : null}
      {itemsChangedResult ? (
        <p className="notice packing-result" role="status" data-tone="warning">
          {ITEMS_CHANGED_RESULT}
        </p>
      ) : null}

      <div className="row" role="group" aria-label="포장·배송">
        {nextBuyerId !== null ? (
          <button ref={nextButton} type="button" className={nextFirst ? 'button button-primary' : 'button'} onClick={() => onNext(nextBuyerId)}>
            다음 구매자
          </button>
        ) : null}
        {canPack ? (
          <button type="button" className="button button-primary" disabled={!allChecked || command.busy} onClick={pack}>
            포장 완료
          </button>
        ) : null}
        {entry.status === '포장 완료' ? (
          <button type="button" className={nextFirst ? 'button' : 'button button-primary'} disabled={command.busy} onClick={() => setAsk('ship')}>
            배송 완료로 적기
          </button>
        ) : null}
        {entry.status === '배송 완료' ? (
          <button type="button" className="button" disabled={command.busy} onClick={() => setAsk('fixInvoice')}>
            송장번호 고치기
          </button>
        ) : null}
        {entry.status === '포장 완료' || entry.status === '포장 다시 확인' ? (
          <button type="button" className="button" disabled={command.busy} onClick={() => setAsk('unpack')}>
            포장 완료 취소
          </button>
        ) : null}
        {entry.status === '배송 완료' || entry.status === '배송 뒤 바뀜' ? (
          <button type="button" className="button" disabled={command.busy} onClick={() => setAsk('unship')}>
            배송 완료 취소
          </button>
        ) : null}
        {command.busy ? <span role="status">보내는 중…</span> : null}
      </div>
      {canPack && !allChecked && entry.items.length > 0 ? <p className="hint">{ALL_CHECKED_HINT}</p> : null}

      <PackingLabelSection date={date} buyer={entry.buyer} empty={entry.items.length === 0} signature={labelSignature} />

      {ask === 'ship' || ask === 'fixInvoice' ? (
        <ShipDialog
          entry={entry}
          fixing={ask === 'fixInvoice'}
          busy={command.busy}
          error={command.error}
          onClose={() => {
            setAsk(null)
            command.clearError()
          }}
          onSend={async (invoice) => {
            if (await run({ action: 'ship', invoice })) setAsk(null)
          }}
        />
      ) : null}
      {ask === 'unpack' ? (
        <ConfirmSend
          title="포장 완료 취소"
          text="포장 완료를 취소할까요? 포장 대기로 돌아가요."
          confirmLabel="포장 완료 취소하기"
          busy={command.busy}
          onClose={() => setAsk(null)}
          onConfirm={async () => {
            setAsk(null)
            await run({ action: 'unpack' })
          }}
        />
      ) : null}
      {ask === 'unship' ? (
        <ConfirmSend
          title="배송 완료 취소"
          text="배송 완료를 취소할까요? 포장 완료로 돌아가요."
          confirmLabel="배송 완료 취소하기"
          busy={command.busy}
          onClose={() => setAsk(null)}
          onConfirm={async () => {
            setAsk(null)
            await run({ action: 'unship' })
          }}
        />
      ) : null}
    </section>
  )
}

function ConfirmSend({ title, text, confirmLabel, busy, onClose, onConfirm }: { readonly title: string; readonly text: string; readonly confirmLabel: string; readonly busy: boolean; readonly onClose: () => void; readonly onConfirm: () => Promise<void> }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        <button type="button" className="button button-danger" disabled={busy} onClick={() => void onConfirm()}>
          {confirmLabel}
        </button>
      }
    >
      <p>{text}</p>
    </Modal>
  )
}

/** 배송 완료 창 (AC-I2-38): 송장번호(선택, 숫자 키패드). 입금 완료가 아니면 보내기 전에 한 번 묻는다(송장번호 고치기는 묻지 않는다) */
function ShipDialog({
  entry,
  fixing,
  busy,
  error,
  onClose,
  onSend,
}: {
  readonly entry: PackingEntry
  readonly fixing: boolean
  readonly busy: boolean
  readonly error: ApiError | null
  readonly onClose: () => void
  readonly onSend: (invoice: string | null) => Promise<void>
}) {
  const id = useId()
  const [invoice, setInvoice] = useState(fixing ? (entry.invoice ?? '') : '')
  const [confirming, setConfirming] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const problem = error?.problemFor('invoice')
  const value = invoice.trim() === '' ? null : invoice.trim()
  const submit = () => {
    if (busy) return
    if (!fixing && entry.payment !== 'PAID') {
      setConfirming(true)
      return
    }
    void onSend(value)
  }
  if (confirming) {
    return (
      <Modal
        key="confirm"
        title="입금 확인"
        onClose={() => setConfirming(false)}
        actions={
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => {
              setConfirming(false)
              void onSend(value)
            }}
          >
            배송 완료로 적기
          </button>
        }
      >
        <p>아직 입금 완료가 아니에요({PAYMENT_WORD[entry.payment]}). 그래도 배송 완료로 적을까요?</p>
      </Modal>
    )
  }
  return (
    <Modal
      key="form"
      title={fixing ? '송장번호 고치기' : '배송 완료로 적기'}
      onClose={onClose}
      initialFocus={field}
      actions={
        <button type="button" className="button button-primary" disabled={busy} onClick={submit}>
          배송 완료로 적기
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
        <div className="field">
          <label htmlFor={id}>송장번호</label>
          <input
            id={id}
            ref={field}
            className="input"
            inputMode="numeric"
            autoComplete="off"
            value={invoice}
            aria-invalid={problem !== undefined}
            aria-describedby={problem === undefined ? undefined : `${id}-error`}
            onChange={(event) => setInvoice(event.target.value)}
          />
          <p className="hint">적지 않아도 돼요. 적으면 숫자만 남겨요.</p>
        </div>
        {problem !== undefined ? (
          <p className="field-error" role="alert" id={`${id}-error`}>
            {problem.message}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
      {busy ? <p role="status">보내는 중…</p> : null}
      {error !== null && problem === undefined ? <RequestError error={error} /> : null}
    </Modal>
  )
}

// ── 포장 라벨 (AC-I2-39) ────────────────────────────────────────────────

interface LabelPage {
  readonly blob: Blob
  readonly fileName: string
  readonly url: string | null
}

/**
 * signature = 라벨에 찍히는 값(L-9: 품목·방송 제목·상품 합계·구매자 표시 이름)과 가게 이름의 모양 — 바뀌면 새로 받는다(받는 동안 저장 잠금).
 * 가격만 바뀌어(입금 전 찜까지) 상품 합계가 달라지거나 닉네임이 바뀌어도 화면 그림 = 저장 그림 = 지금 라벨 (AC-I2-39, LBL-03, SA-I2-002).
 */
function PackingLabelSection({ date, buyer, empty, signature }: { readonly date: string; readonly buyer: string; readonly empty: boolean; readonly signature: string }) {
  const [pages, setPages] = useState<readonly LabelPage[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const pdf = useDownload()
  const held = useRef<readonly LabelPage[]>([])

  useEffect(() => {
    if (empty) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const query = { buyer }
    void (async () => {
      try {
        const view = await get<PackingLabelView>(withQuery(`/api/days/${date}/packing-label`, query), { signal: controller.signal })
        const files = await Promise.all(
          Array.from({ length: view.pages }, (_, index) =>
            getFile(withQuery(`/api/days/${date}/packing-label.png`, { buyer, page: index + 1 }), { signal: controller.signal, fallbackName: `packing-label-${date}-${String(index + 1)}.png` }),
          ),
        )
        if (controller.signal.aborted) return
        const next = files.map((file) => ({ blob: file.blob, fileName: file.fileName, url: objectUrl(file.blob) }))
        for (const page of held.current) revokeObjectUrl(page.url)
        held.current = next
        setPages(next)
        setLoading(false)
      } catch (caught) {
        if (controller.signal.aborted) return
        for (const page of held.current) revokeObjectUrl(page.url)
        held.current = []
        setPages(null)
        setLoading(false)
        if (isApiError(caught)) setError(caught)
      }
    })()
    return () => controller.abort()
  }, [date, buyer, signature, attempt, empty])

  useEffect(() => () => held.current.forEach((page) => revokeObjectUrl(page.url)), [])

  const locked = loading || pages === null
  return (
    <section className="stack-tight packing-label" aria-label="포장 라벨">
      <h3 className="sub-title">포장 라벨</h3>
      {empty ? <p>{NO_LABEL_ITEMS}</p> : null}
      {!empty && loading ? <p role="status">{LABEL_LOADING}</p> : null}
      {!empty && error !== null ? <RequestError error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 만들기" /> : null}
      {!empty && pages !== null ? (
        <ul className="plain-list label-pages">
          {pages.map((page, index) => (
            <li key={`${String(index)}-${page.fileName}`} className="label-page stack-tight">
              {page.url !== null ? <img className="label-image" src={page.url} alt={`포장 라벨 ${String(index + 1)}/${String(pages.length)}쪽`} /> : null}
              <button type="button" className="button" disabled={locked} onClick={() => saveFile(page.blob, page.fileName)}>
                그림 저장
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!empty ? (
        <div className="row">
          <button type="button" className="button" disabled={locked || pdf.busy} onClick={() => void pdf.run(withQuery(`/api/days/${date}/packing-label.pdf`, { buyer }), `packing-label-${date}.pdf`)}>
            라벨 PDF
          </button>
          {pdf.busy ? <span role="status">라벨 PDF를 만드는 중이에요…</span> : null}
        </div>
      ) : null}
      {pdf.error !== null ? <RequestError error={pdf.error} /> : null}
    </section>
  )
}
