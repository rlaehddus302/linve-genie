// 손님 장부 (KP1, CUSTOMER_RULES CR-2~CR-7, D-KP1-02~D-KP1-08·D-KP1-21) — 웹이 쓰는 타입·부르는 함수·문구·콘솔 꼬리표 받기.
// - 서버 계약: harness/sprints/KP1/contract.md §3.1~3.5·§4. 서버 모듈은 가져오지 않고 모양을 여기 따로 적는다.
// - 판매자 계정만(보조자 403). 판정·대기·승계·라벨·감사 메시지·정산과 상관없다 — 표시만 한다(CR-0 3).
// - 이름·주소는 React 기본 이스케이프로만 그린다. 연락처·주소는 주소창·로그에 넣지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { get, post, put } from '../api/client.ts'
import { streamUrl } from './device.ts'
import { sharedStream, type EventSourceLike } from './stream.ts'

// ── 타입 ──────────────────────────────────────────────────────────────

export type LedgerMonths = 6 | 12 | 24 | 36

export const LEDGER_MONTHS: readonly LedgerMonths[] = [6, 12, 24, 36]
export const DEFAULT_LEDGER_MONTHS: LedgerMonths = 12

/** 설정 "손님 관리"의 장부 칸 (CR-3·CR-7) */
export interface LedgerSettings {
  readonly months: LedgerMonths
  /**
   * 방송 화면에 손님 표시. null = 판매자가 아직 정하지 않음(UX-KP1-006 — 정하기 전에는 보이지 않는다).
   * 서버가 아직 null을 주지 않으면(옛 서버) 받은 참·거짓 그대로다.
   */
  readonly consoleBadges: boolean | null
}

export const DEFAULT_LEDGER_SETTINGS: LedgerSettings = { months: DEFAULT_LEDGER_MONTHS, consoleBadges: null }

/** 콘솔 채팅 줄 꼬리표 하나 (CR-7) — text가 null이면 꼬리표 없음 */
export interface CustomerBadge {
  readonly buyer: string
  readonly text: string | null
  readonly spoken: string | null
}

export interface BadgesView {
  /** 설정 "방송 화면에 손님 표시"가 켜져 있다 */
  readonly show: boolean
  readonly badges: readonly CustomerBadge[]
}

/** 묶음 자세히의 "지난 주문 배송지" — 타입은 api/parcel-types.ts에 둔다 (DOM 없는 타입 검사 설정이 그 파일을 읽는다) */
export type { LedgerPrefill } from '../api/parcel-types.ts'

/** 손님 자세히의 장부 칸 (CR-3·CR-5) — 가린 이름·끝 4자리만 */
export interface CustomerLedgerView {
  readonly ledgerId: string
  /** 가린 받는 분 (홍*동) */
  readonly name: string
  readonly phoneLast4: string
  /** 지우는 날 (KST 날짜) */
  readonly keepUntil: string
  /** 가장 최근 동의 묶음 날짜 */
  readonly consentDate: string
  /** 손님이 연결 코드로 직접 이은 계정 */
  readonly linked: readonly { readonly label: string; readonly linkedAt: string }[]
}

// ── 문구 ──────────────────────────────────────────────────────────────

export const LEDGER_MONTH_WORDS: Readonly<Record<LedgerMonths, string>> = { 6: '6개월', 12: '1년', 24: '2년', 36: '3년' }
export const LEDGER_MONTHS_LABEL = '저장한 배송지 보관 기간'
export const LEDGER_MONTHS_HELP = '손님이 다음 주문에도 쓰겠다고 고른 배송지를 이 기간 동안 보관해요. 마지막 주문 뒤 기간이 지나면 저절로 지워요.'
export const CONSOLE_BADGES_LABEL = '방송 화면에 손님 표시'
export const CONSOLE_BADGES_HELP = '방송 화면을 녹화하거나 송출 화면에 띄운다면 꺼 주세요. 손님에게 보이면 안 되는 표시예요.'
/** 아직 정하지 않았을 때 (UX-KP1-006) */
export const CONSOLE_BADGES_UNDECIDED = '아직 정하지 않았어요. 정하기 전에는 방송 화면에 보이지 않아요.'
/** 콘솔에서 처음 한 번 묻는 띠 (UX-KP1-006) */
export const CONSOLE_BADGES_ASK = '방송 화면에 손님 표시를 보일까요? 이 화면을 방송에 내보내면 손님도 볼 수 있어요.'
// 꼬리표 글 그대로("단골"·"입금 늦음 주의"·"처음")를 쓰지 않는다 — 꼬리표가 없는 콘솔에 그 낱말이 보이면 손님 표시로 헷갈린다(CRM1 AC-CRM1-19)
export const CONSOLE_BADGES_ASK_DETAIL = '채팅 이름 옆에 자주 사는 손님, 입금이 늦었던 손님, 처음 온 손님을 알려 주는 작은 표시예요. 나중에 설정 "손님 관리"에서 바꿀 수 있어요.'
export const CONSOLE_BADGES_SHOW = '보이기'
export const CONSOLE_BADGES_HIDE = '안 보이기'
export const CONSOLE_BADGES_ASK_FAILED = '저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'
/** 보관 기간을 줄일 때 확인 (UX-KP1-002) — 몇 명인지 못 받으면 수 없이 */
export const LEDGER_SHRINK_TITLE = '보관 기간을 줄일까요?'
export const LEDGER_SHRINK_ASK = '이미 기간이 지난 손님의 저장한 배송지는 1시간 안에 지워져요. 되돌릴 수 없어요.'
/** 확인 창 문장: 서버가 센 수(n)가 있으면 수와 함께 */
export function shrinkAsk(n: number | null): string {
  if (n === null) return LEDGER_SHRINK_ASK
  if (n === 0) return '지금 줄여도 바로 지워지는 손님은 없어요. 앞으로는 줄인 기간이 지나면 저장한 배송지가 지워져요. 되돌릴 수 없어요.'
  return `지금 줄이면 손님 ${n.toLocaleString('ko-KR')}명의 저장한 배송지가 1시간 안에 지워져요. 되돌릴 수 없어요.`
}
export const LEDGER_SHRINK_OK = '줄이기'
export const LEDGER_SHRINK_KEEP = '그대로 두기'
export const LEDGER_SHRINK_NOTE = '기간을 줄이면 이미 기간이 지난 손님의 저장한 배송지가 1시간 안에 지워져요. 되돌릴 수 없어요. [저장]을 누르면 몇 명인지 한 번 더 물어봐요.'
export const CONSOLE_BADGES_DETAIL = '켜면 방송 화면 채팅에 "입금 늦음 주의"·"단골 · 누적"·"처음"이 보여요. 끄면 1등 옆 "입금 늦음 주의"도 함께 사라져요.'
export const PREFILL_TITLE = '지난 주문 배송지예요 — 확인해 주세요'
export const PREFILL_HELP = '손님이 지난 주문 때 저장해 둔 배송지예요. 맞으면 [배송지 확인]을 눌러 주세요. 바뀌었으면 [고치기]로 고쳐 주세요.'
export const PREFILL_CONFIRMED = '지난 주문 배송지로 확인했어요.'
export const XLSX_BUTTON = '엑셀로 받기'
export const XLSX_TITLE = '손님 엑셀로 받기'
export const XLSX_HELP = '모든 손님을 누적 큰 순으로 받아요. 거르기·찾기와 상관없이 전부 들어가요.'
export const XLSX_CONTACT_LABEL = '연락처·주소도 넣기'
export const XLSX_CONTACT_HELP = '배송지 저장에 동의한 손님만 들어가요.'
export const XLSX_CONTACT_WARNING = '연락처가 든 파일은 다른 사람에게 보내지 마세요.'
export const XLSX_BUSY = '엑셀을 만드는 중…'
export const LINKED_PREFIX = '이 손님이 직접 이은 계정: '
export const LEDGER_TITLE = '저장한 배송지'
export const LEDGER_NONE = '저장해 둔 배송지가 없어요. 손님이 확인서 링크에서 "다음 주문에도 이 배송지 쓰기"를 고르면 생겨요.'
export const LEDGER_DELETE = '저장한 배송지 지우기'
export const LEDGER_DELETE_TITLE = '저장한 배송지 지우기'
export const LEDGER_DELETE_ASK = '이 손님의 저장한 배송지를 지울까요? 지우면 되돌릴 수 없어요. 지난 주문의 배송지와 손님 기록은 그대로예요.'
export const LEDGER_DELETED = '저장한 배송지를 지웠어요.'
export const SELLER_CANNOT_WRITE = '저장한 배송지는 손님이 확인서 링크에서 직접 고를 때만 생겨요. 판매자가 대신 만들 수 없어요.'

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
