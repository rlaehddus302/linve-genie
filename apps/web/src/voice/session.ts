// 켠 음성은 앱 전체가 들고 있다 (V3 D-V3-52, AC-V3-58): "음성 끄기"·방송 끝·로그아웃 때까지 켜진 채이고, 켠 방송 ID에 묶인다.
// - 방송 콘솔이 열려 있으면 콘솔이 넘긴 처리(빠른 입력과 같은 등록 경로·5초 되돌리기 띠·창)를 쓰고, 콘솔 밖이면 이 파일의 처리(같은 쓰기 API)를 쓴다.
// - 콘솔 밖에서는 문자찜을 저절로 넣지 않는다(카드로 남아 콘솔에서 넣는다).
// - 그 기기에 남기는 것은 켠 방송 ID 하나뿐(VOICE_ON_KEY) — 끄기·방송 끝·로그아웃 때 지운다. 인식 글은 남기지 않는다.
// - 이 파일은 음성 패키지를 불러오지 않는다(음성 코드는 컨트롤러가 "음성 켜기" 때 불러온다, AC-I4-04).
import type { CardRegistration, SuggestionCard } from '@livejjim/voice'
import { newRequestId, post, withQuery } from '../api/client.ts'
import type { WriteResult } from '../api/types.ts'
import { ConsoleStore } from '../lib/console-store.ts'
import { productKey, productSlots } from '../lib/derive.ts'
import { OFFER_FIX_FAILED, VoiceController, type ExistingView, type RecentFixOutcome, type VoiceHost } from './controller.ts'
import { fetchPastNames, fetchSellerNames } from './history.ts'
import { loadVoice } from './load.ts'
import { readConsent, readLearned, readSettings, readSmsSettings, writeConsent, writeLearned, writeSettings, writeSmsSettings } from './storage.ts'

/** 켠 방송 ID (그 기기, D-V3-52) */
export const VOICE_ON_KEY = 'livejjim.voiceOnBroadcast'
/** 새로 고침 뒤 다시 켜지 못했을 때 (D-V3-52) */
export const VOICE_OFF_AFTER_RELOAD = "음성이 꺼졌어요. '음성 켜기'를 눌러 다시 켜 주세요."
/** 다른 방송 콘솔의 안내 (D-V3-52) */
export const voiceOtherBroadcast = (title: string): string => `음성은 '${title}' 방송에서 듣는 중이에요. 여기서 쓰려면 그 방송에서 끄고 여기서 켜 주세요.`
/** 콘솔 밖 띠 (D-V3-52) */
export const BAND_SENT = '구글·애플로 보내져요'

/** 콘솔 밖 바로 등록 되돌리기 시간 (빠른 입력과 같은 5초) */
export const OUTSIDE_UNDO_MS = 5000

export function readVoiceOn(): string | null {
  try {
    return window.localStorage.getItem(VOICE_ON_KEY)
  } catch {
    return null
  }
}

function writeVoiceOn(id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(VOICE_ON_KEY)
    else window.localStorage.setItem(VOICE_ON_KEY, id)
  } catch {
    // 남기지 못하면 새로 고침 뒤에는 꺼진 채
  }
}

/** 콘솔 밖 띠의 등록 되돌리기 (5초) */
export interface OutsideUndo {
  readonly key: string
  readonly no: number
  readonly until: number
}

/** 띠가 보는 모습 */
export interface VoiceSessionView {
  readonly broadcastId: string
  readonly title: string
  readonly on: boolean
  /** 확인할 카드 수 (상품·문자찜 카드) */
  readonly cards: number
  readonly undo: OutsideUndo | null
}

type ConsoleHost = VoiceHost

/** 콘솔 쪽이 넘기는 것 (콘솔이 열린 동안) */
export interface ConsoleBinding {
  readonly host: ConsoleHost
}

const anyDialogOpen = (): boolean => typeof document !== 'undefined' && document.querySelector('[role="dialog"]') !== null

export class VoiceSession {
  readonly broadcastId: string
  #title: string
  readonly controller: VoiceController
  readonly #store: ConsoleStore
  #console: ConsoleHost | null = null
  #undo: OutsideUndo | null = null
  #undoTimer: ReturnType<typeof setTimeout> | null = null
  readonly #listeners = new Set<() => void>()
  #view: VoiceSessionView
  #wasOn = false
  #ended = false

  constructor(broadcastId: string, title: string) {
    this.broadcastId = broadcastId
    this.#title = title
    // 콘솔 밖에서도 상품 보드를 보도록 그 방송 자료를 따로 연다 (채팅 메시지는 받지 않는다)
    this.#store = new ConsoleStore({ broadcastId, messages: false })
    this.#store.start().catch(() => {
      // 받지 못하면 콘솔 밖 처리는 빈 상품 보드로 (다시 붙으면 따라잡는다)
    })
    this.controller = new VoiceController(this.#proxy())
    this.#view = { broadcastId, title, on: false, cards: 0, undo: null }
    this.controller.subscribe(() => this.#onVoice())
    this.#store.subscribe(() => this.#onStore())
  }

  get title(): string {
    return this.#title
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getView = (): VoiceSessionView => this.#view

  /** 콘솔이 열렸다 — 그 콘솔의 처리를 쓴다 */
  attach(host: ConsoleHost, title: string): void {
    this.#console = host
    this.#title = title
    this.#emit()
  }

  /** 콘솔이 내려갔다 — 켜져 있으면 이 파일의 처리로 계속 듣는다, 꺼져 있으면 끝낸다 */
  detach(host: ConsoleHost): void {
    if (this.#console !== host) return
    this.#console = null
    if (this.controller.getSnapshot().phase === 'off' || this.controller.getSnapshot().phase === 'consent') endVoiceSession(this)
    else this.#emit()
  }

  get attached(): boolean {
    return this.#console !== null
  }

  /** 끝낸다 (끄기·방송 끝·로그아웃) */
  dispose(): void {
    if (this.#ended) return
    this.#ended = true
    if (this.#undoTimer !== null) clearTimeout(this.#undoTimer)
    this.controller.dispose()
    this.#store.stop()
    this.#listeners.clear()
  }

  /** 콘솔 밖 띠의 [되돌리기] */
  async undoOutside(): Promise<void> {
    const undo = this.#undo
    if (undo === null || Date.now() > undo.until) return
    this.#setUndo(null)
    const data = this.#store.getSnapshot().data
    const product = data?.products.get(undo.key)
    if (product !== undefined) {
      const slots = productSlots(product)
      if (slots.winners.length + slots.waitlist.length > 0) return
    }
    try {
      await this.#write({ type: 'product.close', b: this.broadcastId, no: undo.no })
      this.controller.rejectNumber(undo.no)
    } catch {
      // 되돌리지 못했으면 상품 목록에서 고친다
    }
  }

  #onVoice(): void {
    const snapshot = this.controller.getSnapshot()
    const on = snapshot.phase === 'on' || snapshot.phase === 'loading'
    if (on && !this.#wasOn) writeVoiceOn(this.broadcastId)
    this.#wasOn = on
    // 콘솔 밖에서 꺼졌으면(띠의 [끄기]·엔진 멈춤) 끝낸다
    if (!on && snapshot.phase !== 'consent' && this.#console === null) {
      endVoiceSession(this, true)
      return
    }
    this.#emit()
  }

  #onStore(): void {
    // 방송이 끝나면 음성도 끈다 (D-V3-52)
    const broadcast = this.#store.getSnapshot().broadcast
    if (broadcast !== null) this.#title = broadcast.title
    if (broadcast?.ended === true) {
      this.controller.turnOff()
      endVoiceSession(this, true)
    }
  }

  #emit(): void {
    const snapshot = this.controller.getSnapshot()
    const cards = snapshot.cards.length + snapshot.sms.filter((entry) => !entry.hidden && entry.card.status === 'OPEN').length
    this.#view = { broadcastId: this.broadcastId, title: this.#title, on: snapshot.phase === 'on' || snapshot.phase === 'loading', cards, undo: this.#undo }
    for (const listener of [...this.#listeners]) listener()
  }

  #setUndo(undo: OutsideUndo | null): void {
    if (this.#undoTimer !== null) clearTimeout(this.#undoTimer)
    this.#undoTimer = null
    this.#undo = undo
    if (undo !== null) this.#undoTimer = setTimeout(() => this.#setUndo(null), Math.max(0, undo.until - Date.now()))
    this.#emit()
  }

  async #write(event: Readonly<Record<string, unknown>>): Promise<WriteResult> {
    const broadcast = this.#store.getSnapshot().broadcast
    const scoped = typeof event.b !== 'string'
    const path = withQuery('/api/events', scoped && broadcast !== null ? { date: broadcast.date, rehearsal: broadcast.rehearsal } : {})
    return await post<WriteResult>(path, { requestId: newRequestId(), ...event })
  }

  #data() {
    return this.#store.getSnapshot().data
  }

  /** 콘솔이 열려 있으면 콘솔 처리, 아니면 콘솔 밖 처리 */
  #proxy(): VoiceHost {
    const pick = (): VoiceHost => this.#console ?? this.#outside
    const host: VoiceHost = {
      load: () => pick().load(),
      now: () => pick().now(),
      maxNumber: () => pick().maxNumber(),
      priceUnit: () => pick().priceUnit?.() ?? 'WON',
      currentNames: () => pick().currentNames(),
      products: () => pick().products(),
      existingProduct: (no) => pick().existingProduct?.(no) ?? null,
      fetchHistory: () => pick().fetchHistory(),
      fetchSellerNames: () => pick().fetchSellerNames?.() ?? Promise.resolve([]),
      dialogOpen: () => pick().dialogOpen(),
      readConsent: () => pick().readConsent(),
      writeConsent: () => pick().writeConsent(),
      readSettings: () => pick().readSettings(),
      writeSettings: (settings) => pick().writeSettings(settings),
      register: (card, registration, source) => pick().register(card, registration, source),
      focusQuick: () => pick().focusQuick(),
      smsReadOptions: () => pick().smsReadOptions?.() ?? { maxNumber: pick().maxNumber() },
      smsProduct: (no) => pick().smsProduct?.(no) ?? null,
      smsProductName: (no) => pick().smsProductName?.(no) ?? null,
      readSmsTime: (time, now) => pick().readSmsTime?.(time, now) ?? null,
      writeSms: (write, received, requestId) => {
        const target = pick().writeSms
        return target === undefined ? Promise.resolve({ kind: 'failed', message: '문자찜은 방송 콘솔에서 넣어 주세요.' }) : target(write, received, requestId)
      },
      newRequestId: () => newRequestId(),
      readSmsSettings: () => pick().readSmsSettings?.() ?? null,
      writeSmsSettings: (settings) => pick().writeSmsSettings?.(settings),
      readLearned: () => pick().readLearned?.() ?? null,
      writeLearned: (list) => pick().writeLearned?.(list),
      fixRecent: (id, changes, options) => pick().fixRecent?.(id, changes, options) ?? Promise.resolve({ kind: 'failed', message: OFFER_FIX_FAILED }),
      undoRecent: (id) => pick().undoRecent?.(id) ?? false,
      renumber: (from, to) => pick().renumber?.(from, to) ?? Promise.resolve(false),
      openProduct: (id) => pick().openProduct?.(id),
      smsAutoAllowed: () => this.#console !== null,
      voiceOff: () => writeVoiceOn(null),
    }
    return host
  }

  /** 콘솔 밖 처리 — 같은 쓰기 API, 창 없음 */
  readonly #outside: VoiceHost = {
    load: loadVoice,
    now: () => Date.now(),
    maxNumber: () => this.#data()?.broadcasts.get(this.broadcastId)?.settings['claim.maxNumber'] ?? 200,
    priceUnit: () => this.#data()?.broadcasts.get(this.broadcastId)?.settings['price.unit'] ?? 'WON',
    currentNames: () => {
      const data = this.#data()
      return data === null ? [] : [...data.products.values()].map((product) => product.name)
    },
    products: () => {
      const numbers = new Map<number, boolean>()
      for (const product of this.#data()?.products.values() ?? []) if (product.broadcast === this.broadcastId) numbers.set(product.no, product.status === 'CLOSED')
      return numbers
    },
    existingProduct: (no): ExistingView | null => {
      const product = this.#data()?.products.get(productKey(this.broadcastId, no))
      if (product === undefined) return null
      const slots = productSlots(product)
      return { key: product.key, name: product.name, price: product.price, claimCount: slots.winners.length + slots.waitlist.length, closed: product.status === 'CLOSED', status: product.status }
    },
    fetchHistory: () => {
      const broadcast = this.#store.getSnapshot().broadcast
      return broadcast === null ? Promise.resolve([]) : fetchPastNames({ date: broadcast.date, rehearsal: broadcast.rehearsal })
    },
    fetchSellerNames,
    dialogOpen: anyDialogOpen,
    readConsent,
    writeConsent,
    readSettings,
    writeSettings: (settings) => writeSettings(settings),
    register: (card: SuggestionCard, registration: CardRegistration) => void this.#registerOutside(card, registration),
    focusQuick: () => {},
    readSmsSettings,
    writeSmsSettings: (settings) => writeSmsSettings(settings),
    readLearned,
    writeLearned: (list) => writeLearned(list),
    fixRecent: async (key, changes, options = {}): Promise<RecentFixOutcome> => {
      const product = this.#data()?.products.get(key)
      if (product === undefined) return { kind: 'failed', message: '그 상품을 찾지 못했어요. 상품 목록에서 확인해 주세요.' }
      const slots = productSlots(product)
      const claimed = slots.winners.length + slots.waitlist.length > 0
      const before: { name?: string; price?: number } = {}
      if (changes.name !== undefined) before.name = product.name
      if (changes.price !== undefined) before.price = product.price
      try {
        // 콘솔 밖은 창이 없다 — 찜이 있으면 새 찜부터만 새 가격 (NEW_ONLY, D-V3-57). options.newOnly는 콘솔과 같은 뜻
        void options
        await this.#write({ type: 'product.update', b: this.broadcastId, no: product.no, ...changes, ...(changes.price !== undefined && claimed ? { applyTo: 'NEW_ONLY' } : {}) })
        return { kind: 'fixed', before }
      } catch {
        return { kind: 'failed', message: OFFER_FIX_FAILED }
      }
    },
    undoRecent: () => {
      void this.undoOutside()
      return this.#undo !== null
    },
    renumber: async (from, to) => {
      try {
        return (await this.#write({ type: 'product.renumber', b: this.broadcastId, from, to })).changed
      } catch {
        return false
      }
    },
  }

  async #registerOutside(card: SuggestionCard, registration: CardRegistration): Promise<void> {
    const { no, name, price } = registration
    try {
      const result = await this.#write({ type: 'product.register', b: this.broadcastId, no, name, price })
      const key = productKey(this.broadcastId, no)
      if (!result.changed) {
        this.controller.instantExists(card)
        return
      }
      this.controller.noteVoiceRegistered({ id: key, no, name, price })
      this.#setUndo({ key, no, until: Date.now() + OUTSIDE_UNDO_MS })
    } catch {
      // 등록하지 못했으면 카드로 남긴다 (콘솔에서 다시 등록)
      this.controller.restore(card, { touched: true })
    }
  }
}

// ── 앱 전체에 하나 ───────────────────────────────────────────────────────

let current: VoiceSession | null = null
const sessionListeners = new Set<() => void>()

function emitSessions(): void {
  for (const listener of [...sessionListeners]) listener()
}

export function subscribeVoiceSession(listener: () => void): () => void {
  sessionListeners.add(listener)
  return () => {
    sessionListeners.delete(listener)
  }
}

export const getVoiceSession = (): VoiceSession | null => current

/** 그 방송의 음성 (없으면 새로). 다른 방송에서 듣는 중이면 null — 콘솔은 안내를 보인다 */
export function acquireVoiceSession(broadcastId: string, title: string): VoiceSession | null {
  if (current !== null && current.broadcastId !== broadcastId) {
    const phase = current.controller.getSnapshot().phase
    if (phase === 'on' || phase === 'loading') return null
    endVoiceSession(current)
  }
  if (current === null) {
    current = new VoiceSession(broadcastId, title)
    emitSessions()
  }
  return current
}

/** 끝낸다 — clear면 켠 방송 ID도 지운다 (끄기·방송 끝·로그아웃) */
export function endVoiceSession(session: VoiceSession | null = current, clear = false): void {
  if (session === null) return
  if (clear) writeVoiceOn(null)
  session.dispose()
  if (current === session) {
    current = null
    emitSessions()
  }
}

/** 로그아웃: 음성을 끄고 켠 방송 ID를 지운다 */
export function logoutVoice(): void {
  current?.controller.turnOff()
  endVoiceSession(current, true)
  writeVoiceOn(null)
}

/** 판매자가 "음성 끄기"를 눌렀다 — 켠 방송 ID를 지운다 */
export function forgetVoiceOn(): void {
  writeVoiceOn(null)
}

/** 마이크 권한이 이미 허락됐나 (권한 조회를 못 하면 거짓 — 저절로 켜지 않는다) */
export async function microphoneGranted(): Promise<boolean> {
  try {
    const permissions = (navigator as Navigator & { permissions?: { query(input: { name: string }): Promise<{ state: string }> } }).permissions
    if (permissions === undefined) return false
    const status = await permissions.query({ name: 'microphone' })
    return status.state === 'granted'
  } catch {
    return false
  }
}
