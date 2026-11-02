// 손님 장부 (KP1, CUSTOMER_RULES CR-2~CR-7, D-KP1-02~D-KP1-08·D-KP1-21) — 웹이 쓰는 타입·부르는 함수·문구·콘솔 꼬리표 받기.
// - 서버 계약: harness/sprints/KP1/contract.md §3.1~3.5·§4. 서버 모듈은 가져오지 않고 모양을 여기 따로 적는다.
// - 판매자 계정만(보조자 403). 판정·대기·승계·라벨·감사 메시지·정산과 상관없다 — 표시만 한다(CR-0 3).
// - 이름·주소는 React 기본 이스케이프로만 그린다. 연락처·주소는 주소창·로그에 넣지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { get, post, put } from '../api/client.ts'
import { streamUrl } from './device.ts'
import { sharedStream, type EventSourceLike } from './stream.ts'

// ── 타입 ──────────────────────────────────────────────────────────────

export { LEDGER_MONTHS, DEFAULT_LEDGER_MONTHS, DEFAULT_LEDGER_SETTINGS, LEDGER_MONTH_WORDS, LEDGER_MONTHS_LABEL, LEDGER_MONTHS_HELP, CONSOLE_BADGES_LABEL, CONSOLE_BADGES_HELP, CONSOLE_BADGES_UNDECIDED, CONSOLE_BADGES_ASK, CONSOLE_BADGES_ASK_DETAIL, CONSOLE_BADGES_SHOW, CONSOLE_BADGES_HIDE, CONSOLE_BADGES_ASK_FAILED, LEDGER_SHRINK_TITLE, LEDGER_SHRINK_ASK, shrinkAsk, LEDGER_SHRINK_OK, LEDGER_SHRINK_KEEP, LEDGER_SHRINK_NOTE, CONSOLE_BADGES_DETAIL, PREFILL_TITLE, PREFILL_HELP, PREFILL_CONFIRMED, XLSX_BUTTON, XLSX_TITLE, XLSX_HELP, XLSX_CONTACT_LABEL, XLSX_CONTACT_HELP, XLSX_CONTACT_WARNING, XLSX_BUSY, LINKED_PREFIX, LEDGER_TITLE, LEDGER_NONE, LEDGER_DELETE, LEDGER_DELETE_TITLE, LEDGER_DELETE_ASK, LEDGER_DELETED, SELLER_CANNOT_WRITE } from './ledger-words.ts'
export type { LedgerMonths, LedgerSettings, CustomerBadge, BadgesView, CustomerLedgerView, LedgerPrefill } from './ledger-words.ts'
import { DEFAULT_LEDGER_MONTHS } from './ledger-words.ts'
import type { LedgerMonths, LedgerSettings, CustomerBadge, BadgesView, CustomerLedgerView } from './ledger-words.ts'

// ── 부르기 ────────────────────────────────────────────────────────────

export const LEDGER_SETTINGS_PATH = '/api/ledger-settings'

export async function fetchLedgerSettings(): Promise<LedgerSettings> {
  return (await get<{ settings: LedgerSettings }>(LEDGER_SETTINGS_PATH)).settings
}

export async function saveLedgerSettings(value: LedgerSettings): Promise<LedgerSettings> {
  // 설정 화면은 정해지지 않음을 꺼진 것으로 보이고, 거기서 저장하면 그 값(끔)으로 정해진다 (D-KP1-43)
  return (await put<{ settings: LedgerSettings }>(LEDGER_SETTINGS_PATH, { months: value.months, consoleBadges: value.consoleBadges ?? false })).settings
}

/** 보관 기간을 months로 줄이면 곧 지워질 손님 수 (`GET /api/ledger-settings/preview?months=` → `{ months, willDelete }`, UX-KP1-002) */
export async function fetchShrinkPreview(months: LedgerMonths): Promise<number> {
  const result = await get<{ months: number; willDelete: number }>(`${LEDGER_SETTINGS_PATH}/preview?months=${String(months)}`)
  if (!Number.isSafeInteger(result.willDelete) || result.willDelete < 0) throw new Error('수를 알 수 없어요')
  return result.willDelete
}

/** 한 번에 묻는 가장 많은 구매자 수 (CR-7) */
export const BADGE_BATCH = 50
/** 받기 사이 가장 짧은 간격 (CR-7 — D-CRM1-14와 같은 4초) */
export const BADGE_GAP_MS = 4_000

/** `/api/days/:date/customer-badges?buyer=a&buyer=b` (구매자는 질의로만 — 겹치면 하나로) */
export function badgesPath(date: string, buyers: readonly string[]): string {
  const search = new URLSearchParams()
  for (const buyer of new Set(buyers)) search.append('buyer', buyer)
  return `/api/days/${date}/customer-badges?${search.toString()}`
}

export function fetchBadges(date: string, buyers: readonly string[]): Promise<BadgesView> {
  return get<BadgesView>(badgesPath(date, buyers))
}

export async function deleteCustomerLedger(customerId: string, ledgerId: string): Promise<void> {
  await post<{ ledger: null }>(`/api/customers/${encodeURIComponent(customerId)}/ledger/delete`, { ledgerId })
}

export function customersXlsxPath(contact: boolean): string {
  return `/api/customers.xlsx?contact=${contact ? '1' : '0'}`
}

// ── 꼬리표 모양 ──────────────────────────────────────────────────────

export type BadgeTone = 'caution' | 'regular' | 'first'

/** 꼬리표 색 (글자와 함께 — 색만으로 가르지 않는다) */
export function badgeTone(text: string): BadgeTone {
  if (text === '입금 늦음 주의') return 'caution'
  if (text.startsWith('단골')) return 'regular'
  return 'first'
}

/** 화면 읽기 문장 (서버가 주지 않으면 " · "를 ", "로) */
export function badgeSpokenOf(badge: Pick<CustomerBadge, 'text' | 'spoken'>): string {
  if (badge.spoken !== null && badge.spoken !== '') return badge.spoken
  return `손님: ${(badge.text ?? '').split(' · ').join(', ')}`
}

/** 채팅 메시지에서 꼬리표를 물을 구매자 (방송자 본인 글·빈 채널은 빼고, 처음 나온 순서) */
export function chatBuyers(messages: readonly { readonly channel: string; readonly owner: boolean }[]): string[] {
  const out = new Set<string>()
  for (const message of messages) if (!message.owner && message.channel !== '') out.add(message.channel)
  return [...out]
}

// ── 꼬리표 받기 차례 (순수 — 시계는 부르는 쪽이 준다) ─────────────────

export type BadgeStep = { readonly kind: 'ask'; readonly buyers: readonly string[] } | { readonly kind: 'wait'; readonly ms: number } | { readonly kind: 'idle' }

/**
 * 새 구매자를 모아 50명씩, 받기 사이 4초 이상 (CR-7, AC-KP1-16).
 * 물은 구매자(성공·실패 모두)는 reset 전까지 다시 묻지 않는다 — 실패는 꼬리표 없이 조용히.
 */
export class BadgeQueue {
  readonly #gap: number
  readonly #batch: number
  readonly #asked = new Set<string>()
  readonly #pending: string[] = []
  readonly #queued = new Set<string>()
  #last: number | null = null

  constructor(gapMs = BADGE_GAP_MS, batch = BADGE_BATCH) {
    this.#gap = gapMs
    this.#batch = batch
  }

  /** 새 구매자만 줄에 세운다. 늘었으면 true */
  add(buyers: Iterable<string>): boolean {
    let added = false
    for (const buyer of buyers) {
      if (this.#asked.has(buyer) || this.#queued.has(buyer)) continue
      this.#queued.add(buyer)
      this.#pending.push(buyer)
      added = true
    }
    return added
  }

  /** 지금(now) 할 일: 물을 구매자들·기다릴 시간·없음 */
  next(now: number): BadgeStep {
    if (this.#pending.length === 0) return { kind: 'idle' }
    if (this.#last !== null && now - this.#last < this.#gap) return { kind: 'wait', ms: this.#last + this.#gap - now }
    const buyers = this.#pending.splice(0, this.#batch)
    for (const buyer of buyers) {
      this.#queued.delete(buyer)
      this.#asked.add(buyer)
    }
    this.#last = now
    return { kind: 'ask', buyers }
  }

  /** 물은 적 있나 */
  asked(buyer: string): boolean {
    return this.#asked.has(buyer)
  }

  /** 처음부터 (설정을 다시 켰을 때 — 물은 구매자를 다시 줄에 세운다. 간격은 그대로 센다) */
  reset(): void {
    const again = [...this.#asked]
    this.#asked.clear()
    this.add(again)
  }
}

// ── 콘솔 꼬리표 받기 훅 ──────────────────────────────────────────────

export interface ChatBadges {
  /**
   * "방송 화면에 손님 표시"가 꺼져 있지 않다. 거짓이면 채팅 꼬리표와 1등 옆 "입금 늦음 주의"를 모두 숨긴다(CR-7).
   * 설정을 아직 모르거나 받지 못하면 거짓(D-KP1-40 — 알 때까지 숨김. 설정·꼬리표 응답이 오면 서버의 show로 정한다).
   */
  readonly show: boolean
  /**
   * 1등 옆 "입금 늦음 주의"(CRM1)를 보인다 — 판매자가 "방송 화면에 손님 표시"를 명시적으로 껐을 때만 거짓(D-KP1-50, AC-KP1-15).
   * 아직 정하지 않았거나 설정을 모르면 예전처럼 보인다.
   */
  readonly caution: boolean
  /** 구매자 → 꼬리표 (글이 있는 것만) */
  readonly badges: ReadonlyMap<string, CustomerBadge>
  /** 설정을 받았고 판매자가 "방송 화면에 손님 표시"를 아직 정하지 않았다 — 콘솔이 한 번 묻는다(UX-KP1-006). 리허설은 늘 거짓 */
  readonly undecided: boolean
  /** 콘솔 띠에서 정하기 (PUT /api/ledger-settings — 보관 기간은 받은 그대로). 실패하면 거절 */
  readonly decide: (value: boolean) => Promise<void>
}

export interface ChatBadgesDeps {
  readonly fetchBadges: (date: string, buyers: readonly string[]) => Promise<BadgesView>
  readonly fetchSettings: () => Promise<LedgerSettings>
  readonly saveSettings: (value: LedgerSettings) => Promise<LedgerSettings>
  /** 실시간 알림 (`customers` {what:'settings'}·다시 붙음) */
  readonly openStream: () => EventSourceLike
  readonly now: () => number
}

const defaultDeps: ChatBadgesDeps = {
  fetchBadges,
  fetchSettings: fetchLedgerSettings,
  saveSettings: saveLedgerSettings,
  openStream: () => sharedStream(streamUrl).open(),
  now: () => Date.now(),
}

const NO_BADGES: ReadonlyMap<string, CustomerBadge> = new Map()

/** `customers` 알림의 what (모르면 null) */
export function customersEventWhat(raw: unknown): 'settings' | 'ledger' | null {
  try {
    const data = JSON.parse(String(raw)) as unknown
    if (typeof data !== 'object' || data === null) return null
    const what = (data as { what?: unknown }).what
    return what === 'settings' || what === 'ledger' ? what : null
  } catch {
    return null
  }
}

/**
 * 콘솔 채팅 꼬리표 (CR-7, AC-KP1-14~16). 리허설이면 아무것도 부르지 않는다.
 * - 새 채팅 구매자를 모아 4초 이상 간격으로 50명씩 묻는다. 받은 구매자는 콘솔을 다시 열 때까지(날짜가 바뀔 때까지) 다시 묻지 않는다.
 * - 실패는 조용히(오류 띠 없음, 꼬리표 없이 그대로).
 * - 설정을 열 때 한 번 받고, `customers` {what:'settings'} 알림·다시 붙음마다 다시 받는다. 꺼졌다 다시 켜지면 꼬리표를 다시 묻는다.
 */
export function useChatBadges(date: string, rehearsal: boolean, buyers: readonly string[], deps: ChatBadgesDeps = defaultDeps): ChatBadges {
  const enabled = !rehearsal && date !== ''
  const [show, setShow] = useState<boolean | null>(null)
  const [months, setMonths] = useState<LedgerMonths | null>(null)
  const [undecided, setUndecided] = useState(false)
  // 판매자가 명시적으로 껐다 (D-KP1-50 — 이때만 1등 옆 "입금 늦음 주의"도 숨긴다)
  const [off, setOff] = useState(false)
  const [badges, setBadges] = useState<ReadonlyMap<string, CustomerBadge>>(NO_BADGES)
  const depsRef = useRef(deps)
  depsRef.current = deps
  const scope = `${date}|${String(enabled)}`
  const state = useRef<{ scope: string; queue: BadgeQueue; timer: ReturnType<typeof setTimeout> | null; busy: boolean; show: boolean | null; undecided: boolean; alive: boolean } | null>(null)
  if (state.current === null || state.current.scope !== scope) {
    if (state.current?.timer != null) clearTimeout(state.current.timer)
    if (state.current !== null) state.current.alive = false
    state.current = { scope, queue: new BadgeQueue(), timer: null, busy: false, show: null, undecided: false, alive: true }
  }
  const [tick, setTick] = useState(0)

  // 날짜가 바뀌면 받은 것을 버린다 (새 콘솔)
  useEffect(() => {
    setBadges(NO_BADGES)
    setShow(null)
    setUndecided(false)
    setOff(false)
  }, [scope])

  useEffect(() => {
    const current = state.current
    return () => {
      if (current === null) return
      current.alive = false
      if (current.timer !== null) clearTimeout(current.timer)
    }
  }, [scope])

  const applySettings = (settings: LedgerSettings) => {
    if (state.current !== null) state.current.undecided = settings.consoleBadges === null
    setMonths(settings.months)
    setUndecided(settings.consoleBadges === null)
    setOff(settings.consoleBadges === false)
    applyShow(settings.consoleBadges === true)
  }

  const applyShow = (value: boolean) => {
    const current = state.current
    if (current === null) return
    const was = current.show
    current.show = value
    setShow(value)
    if (!value) setBadges(NO_BADGES)
    // 꺼졌다 다시 켜졌다: 꺼진 동안 받은 꼬리표는 글이 없으므로 다시 묻는다
    if (value && was === false) {
      current.queue.reset()
      setTick((n) => n + 1)
    }
  }

  // 설정: 열 때 + 알림·다시 붙음
  useEffect(() => {
    if (!enabled) return
    const mine = state.current
    let alive = true
    const load = () => {
      depsRef.current.fetchSettings().then(
        (settings) => {
          if (alive && mine === state.current) applySettings(settings)
        },
        () => {
          // 받지 못하면 지금 그대로 (오류 띠 없음)
        },
      )
    }
    load()
    let stream: EventSourceLike | null = null
    try {
      stream = depsRef.current.openStream()
      let ready = 0
      stream.addEventListener('ready', () => {
        ready += 1
        if (ready > 1) load()
      })
      stream.addEventListener('customers', (event) => {
        if (customersEventWhat(event.data) === 'settings') load()
      })
    } catch {
      stream = null
    }
    return () => {
      alive = false
      stream?.close()
    }
  }, [scope])

  // 새 구매자 → 줄 → 간격 맞춰 묻기
  useEffect(() => {
    const current = state.current
    if (!enabled || current === null) return
    current.queue.add(buyers)
    const run = () => {
      if (!current.alive || current.busy || current.timer !== null) return
      // 아직 정하지 않았으면 묻지 않는다 (UX-KP1-006)
      if (current.show === false || current.undecided) return
      const step = current.queue.next(depsRef.current.now())
      if (step.kind === 'idle') return
      if (step.kind === 'wait') {
        current.timer = setTimeout(() => {
          current.timer = null
          run()
        }, step.ms)
        return
      }
      current.busy = true
      depsRef.current.fetchBadges(date, step.buyers).then(
        (view) => {
          if (!current.alive) return
          current.busy = false
          // 그 사이 설정을 받아 아직 정하지 않은 것을 알았으면 꼬리표 응답의 show는 쓰지 않는다
          if (current.undecided) return
          if (view.show !== current.show) applyShow(view.show)
          // 정한 뒤 서버가 꺼짐이라 하면 명시적 끔 (아직 안 정함이면 여기까지 오지 않는다)
          setOff(!view.show)
          if (view.show) {
            const found = view.badges.filter((badge) => badge.text !== null && badge.text !== '')
            if (found.length > 0) {
              setBadges((map) => {
                const next = new Map(map)
                for (const badge of found) next.set(badge.buyer, badge)
                return next
              })
            }
          }
          run()
        },
        () => {
          if (!current.alive) return
          current.busy = false
          // 실패는 조용히 — 꼬리표 없이 그대로 (오류 띠 없음, AC-KP1-16). 그 구매자들은 다시 묻지 않는다
          run()
        },
      )
    }
    run()
  }, [buyers, scope, tick, show])

  const decide = async (value: boolean): Promise<void> => {
    const mine = state.current
    const saved = await depsRef.current.saveSettings({ months: months ?? DEFAULT_LEDGER_MONTHS, consoleBadges: value })
    if (mine === state.current && mine?.alive === true) applySettings(saved)
  }
  const decideRef = useRef(decide)
  decideRef.current = decide
  const stableDecide = useMemo(() => (value: boolean) => decideRef.current(value), [])

  return useMemo(
    () => ({ show: !enabled ? true : show === true, caution: !enabled || !off, badges: !enabled || show !== true ? NO_BADGES : badges, undecided: enabled && undecided, decide: stableDecide }),
    [enabled, show, off, badges, undecided, stableDecide],
  )
}

/**
 * 장부가 바뀐 횟수 (SSE `customers` {what:'ledger'} — 손님·판매자가 지움, 기간 지나 지움, 연결 코드).
 * 묶음 자세히의 "확인 전" 칸이 바로 따라 바뀌게 다시 받는 데 쓴다(복사하지 않았다 — CR-4). 다시 붙어도 하나 늘린다.
 */
export function useLedgerVersion(enabled = true, openStream: () => EventSourceLike = defaultDeps.openStream): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let stream: EventSourceLike
    try {
      stream = openStream()
    } catch {
      return
    }
    let ready = 0
    stream.addEventListener('ready', () => {
      ready += 1
      if (ready > 1) setVersion((n) => n + 1)
    })
    stream.addEventListener('customers', (event) => {
      if (customersEventWhat(event.data) === 'ledger') setVersion((n) => n + 1)
    })
    return () => stream.close()
  }, [enabled])
  return version
}

/** `GET /api/customers/:id` 응답에 더해지는 장부 칸 (옛 서버엔 없다) */
export interface WithCustomerLedger {
  readonly ledger?: CustomerLedgerView | null
}
