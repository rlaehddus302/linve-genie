// 리허설 가짜 채팅 생성기 (YT-09 AC2, D-082, AC-S05-51, AC-S06-71).
// - 판매자마다 동시에 하나만 돈다(모든 리허설 방송을 통틀어, D-096). 메시지마다 서버 수집 함수(ingestChat, 조치자 collector)로만 쓴다 — 실제 수집기(S10)와 같은 기록·판정을 탄다.
// - 끝난 실행 기록은 방송마다 마지막 하나, 판매자마다 최대 GENERATOR_RECORDS_MAX개(가장 먼저 끝난 것부터 지운다). 지운 방송의 상태는 서버를 다시 시작한 뒤와 같다.
// - 다음 메시지는 시드와 그 시점의 리허설 범위 상태(그 방송 상품의 번호·상태, 그 방송의 설정 스냅샷)로만 정한다.
//   시계·Math.random을 직접 쓰지 않는다: 난수는 시드로 만든 의사 난수, 시계·타이머는 주입한다(시험은 기다리지 않고 돌린다).
//   같은 시드·같은 상태 순서면 같은 메시지 순서다.
// - 멈추는 때: 총 개수를 다 보냄 · 멈춤 요청 · 그 방송을 끝냄 · 서버 종료(다시 시작해도 이어서 하지 않는다).
//   저장 실패(save_failed)는 다시 시도하지 않고 다음 메시지로 가며 실패 수를 센다.
// - 로그에 본문·닉네임을 남기지 않는다(쓰는 로그가 없다 — 기록 경로의 로그 규칙 그대로).
// - 옵션 방송(설정 스냅샷 claim.parseMode=OPTIONS, D-O4-01)만 옵션·수량 댓글과 확인 필요 감(review)을 섞는다. 보내기 전에 코어 parseOptionComment로
//   그 종류로 읽히는지 확인한다(지금 상품은 정한 지 15초로 본다). 번호 방송(STRICT·LOOSE)은 BASE와 같은 메시지 순서·글자다(AC-O4-03).
import {
  FOCUS_GRACE_SEC,
  getBroadcast,
  listProducts,
  parseChat,
  parseOptionComment,
  type EngineState,
  type OptionCatalogEntry,
  type OptionCommentResult,
  type OptionItem,
  type ProductStatus,
  type SaleSettings,
} from '@livejjim/core'

// ── 주입점 ───────────────────────────────────────────────────────────────

/** 생성기 타이머: ms 뒤에 fn을 부르고, 취소 함수를 돌려준다 */
export interface GeneratorTimer {
  schedule(ms: number, fn: () => void): () => void
}

export const realTimer: GeneratorTimer = {
  schedule(ms, fn) {
    const timer = setTimeout(fn, ms)
    timer.unref?.()
    return () => clearTimeout(timer)
  },
}

// ── 설정 범위 (D-082) ────────────────────────────────────────────────────

export const GENERATOR_TOTAL_MIN = 1
export const GENERATOR_TOTAL_MAX = 10_000
export const GENERATOR_TOTAL_DEFAULT = 300
export const GENERATOR_RATE_MIN = 1
export const GENERATOR_RATE_MAX = 50
export const GENERATOR_RATE_DEFAULT = 1
export const GENERATOR_SEED_MAX = 2_147_483_647
/** 판매자마다 남겨 두는 끝난 실행 기록 수 (D-096) */
export const GENERATOR_RECORDS_MAX = 20

// ── 의사 난수 (mulberry32 — 시드만으로 정해진다) ────────────────────────

export class SeededRandom {
  #state: number
  constructor(seed: number) {
    this.#state = seed >>> 0
  }
  /** [0, 1) */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0
    let t = this.#state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** [0, n) 정수 */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)] as T
  }
}

// ── 메시지 만들기 ────────────────────────────────────────────────────────

/** 생성기 보기의 변형 하나 (옵션 방송, D-O4-01) */
export interface GeneratorVariant {
  /** 고른 옵션 `[항목 이름, label]`, 항목 순서 */
  readonly options: readonly (readonly [string, string])[]
  readonly status: ProductStatus
  /** 남은 수량 */
  readonly remaining: number
}

/** 생성기 보기의 상품 하나. 번호 방송은 번호·상태만 쓴다 (나머지 칸은 옵션 방송만 — 없으면 빈 것으로 본다) */
export interface GeneratorProduct {
  readonly no: number
  readonly status: ProductStatus
  readonly name?: string
  readonly aliases?: readonly string[]
  readonly options?: readonly OptionItem[]
  readonly variants?: readonly GeneratorVariant[]
}

/** 생성기가 보는 그 시점의 리허설 범위 상태 (그 방송만) */
export interface GeneratorView {
  /** 그 방송의 상품 (번호 순) */
  readonly products: readonly GeneratorProduct[]
  /** 그 방송의 설정 스냅샷 */
  readonly settings: SaleSettings
  /** 지금 상품 번호 (옵션 방송, R-20 6 — 일시 중지·판매 종료 상품이면 없음) */
  readonly focus?: number | null
}

/** 범위 상태에서 그 방송의 생성기 보기를 만든다 (방송이 없으면 null) */
export function generatorView(state: EngineState, b: string): GeneratorView | null {
  const broadcast = getBroadcast(state, b)
  if (broadcast === null) return null
  const products = listProducts(state)
    .filter((product) => product.broadcast === b)
    .map((product) => ({
      no: product.no,
      status: product.status,
      name: product.name,
      aliases: product.aliases,
      options: product.options,
      variants: product.variants.map((variant) => ({ options: variant.options, status: variant.status, remaining: variant.remaining })),
    }))
  const focusNo = broadcast.focus?.no ?? null
  const focused = focusNo === null ? undefined : products.find((product) => product.no === focusNo)
  const focus = focused === undefined || focused.status === 'HOLD' || focused.status === 'CLOSED' ? null : focused.no
  return { products, settings: broadcast.settings, focus }
}

/** 섞는 메시지 종류 (D-082). review = 확인 필요가 될 댓글 (옵션 방송만, D-O4-01) */
export type MessageKind = 'order' | 'pendingOrder' | 'review' | 'mention' | 'cancel' | 'talk' | 'nickChange' | 'sameNick' | 'owner' | 'resend'

export interface GeneratedChat {
  readonly kind: MessageKind
  /** 수집 함수에 넘길 채팅 (ingestChat 입력) */
  readonly chat: { readonly b: string; readonly id: string; readonly ch: string; readonly nick: string; readonly text: string; readonly owner?: true }
}

/** 종류별 비율 (합 100). 1,000건이면 가장 드문 종류도 기대값이 40건이다 */
const KIND_WEIGHTS: readonly (readonly [MessageKind, number])[] = [
  ['order', 30],
  ['pendingOrder', 10],
  ['mention', 12],
  ['cancel', 6],
  ['talk', 21],
  ['nickChange', 5],
  ['sameNick', 6],
  ['owner', 4],
  ['resend', 6],
]

/** 옵션 방송의 종류별 비율 (합 100, D-O4-01) — 일반 대화 21 중 8을 확인 필요 감으로 */
const OPTION_KIND_WEIGHTS: readonly (readonly [MessageKind, number])[] = [
  ['order', 30],
  ['pendingOrder', 10],
  ['review', 8],
  ['mention', 12],
  ['cancel', 6],
  ['talk', 13],
  ['nickChange', 5],
  ['sameNick', 6],
  ['owner', 4],
  ['resend', 6],
]

const TALK = ['안녕하세요', '오늘도 예쁘네요', '배송은 언제 와요?', 'ㅋㅋㅋㅋ', '와 대박', '물 온도는 몇 도예요?', '처음 왔어요', '🐟 너무 예뻐요', '사장님 목소리 좋아요', '합사 가능한가요?']
const ADJECTIVES = ['구피', '물멍', '새우', '수초', '베타', '금붕어', '어항', '해초', '산호', '물방울']
const NOUNS = ['사랑', '집사', '러버', '마니아', '친구', '요정', '대장', '언니', '형님', '초보']
const OWNER_CHANNEL = 'sim_owner'
const OWNER_NICK = '방송자'
/** 다시 보낼 사본은 최근 이만큼 보낸 메시지에서 고른다 */
const RESEND_WINDOW = 50

interface Viewer {
  readonly channel: string
  nick: string
  /** 이 채널이 주문한 번호 (취소에 쓴다) */
  readonly ordered: number[]
}

/**
 * 가짜 채팅을 하나씩 만든다. 같은 시드·같은 보기 순서면 같은 메시지 순서다.
 * 메시지 ID = `sim-<시드>-<시작 seq>-<순번>` (같은 방송에서 다시 시작해도 겹치지 않는다 — 앞 실행이 기록한 만큼 seq가 늘었다)
 */
export class ChatMaker {
  readonly #random: SeededRandom
  readonly #b: string
  readonly #prefix: string
  readonly #viewers: Viewer[] = []
  readonly #recent: GeneratedChat['chat'][] = []
  #count = 0

  constructor(b: string, seed: number, startSeq: number) {
    this.#random = new SeededRandom(seed)
    this.#b = b
    this.#prefix = `sim-${String(seed)}-${String(startSeq)}`
  }

  next(view: GeneratorView): GeneratedChat {
    const index = this.#count++
    const options = view.settings['claim.parseMode'] === 'OPTIONS'
    const kind = this.#kind(options ? OPTION_KIND_WEIGHTS : KIND_WEIGHTS)
    const made = options ? this.#makeOption(kind, view, index) : this.#make(kind, view, index)
    if (made.kind !== 'resend') {
      this.#recent.push(made.chat)
      if (this.#recent.length > RESEND_WINDOW) this.#recent.shift()
    }
    return made
  }

  #kind(weights: readonly (readonly [MessageKind, number])[]): MessageKind {
    let roll = this.#random.int(100)
    for (const [kind, weight] of weights) {
      if (roll < weight) return kind
      roll -= weight
    }
    return 'talk'
  }

  #id(index: number): string {
    return `${this.#prefix}-${String(index)}`
  }

  #newNick(): string {
    return `${this.#random.pick(ADJECTIVES)}${this.#random.pick(NOUNS)}`
  }

  #newViewer(nick = this.#newNick()): Viewer {
    const viewer: Viewer = { channel: `sim_c${String(this.#viewers.length + 1)}`, nick, ordered: [] }
    this.#viewers.push(viewer)
    return viewer
  }

  /** 채팅할 시청자: 처음 몇 명까지는 새로, 그 뒤는 대개 이미 온 시청자 */
  #viewer(): Viewer {
    if (this.#viewers.length < 3 || this.#random.next() < 0.25) return this.#newViewer()
    return this.#random.pick(this.#viewers)
  }

  #chat(viewer: Viewer, text: string, index: number): GeneratedChat['chat'] {
    return { b: this.#b, id: this.#id(index), ch: viewer.channel, nick: viewer.nick, text }
  }

  #talk(viewer: Viewer, index: number): GeneratedChat {
    return { kind: 'talk', chat: this.#chat(viewer, this.#random.pick(TALK), index) }
  }

  #make(kind: MessageKind, view: GeneratorView, index: number): GeneratedChat {
    const { settings } = view
    const maxNumber = settings['claim.maxNumber']
    const isOrder = (text: string, no: number) => {
      const parsed = parseChat(text, settings)
      return parsed.claims.length === 1 && parsed.claims[0] === no && parsed.cancels.length === 0
    }
    switch (kind) {
      case 'order': {
        const open = view.products.filter((product) => product.status === 'OPEN')
        if (open.length === 0) return this.#make('pendingOrder', view, index)
        const no = this.#random.pick(open).no
        const viewer = this.#viewer()
        const text = this.#firstMatching([`${String(no)}`, `${String(no)}번`, `${String(no)}번이요`, `찜${String(no)}`, `${String(no)}번 찜`], (t) => isOrder(t, no))
        if (text === null) return this.#talk(viewer, index)
        viewer.ordered.push(no)
        return { kind: 'order', chat: this.#chat(viewer, text, index) }
      }
      case 'pendingOrder': {
        const taken = new Set(view.products.map((product) => product.no))
        const highest = view.products.reduce((max, product) => Math.max(max, product.no), 0)
        let no = Math.min(maxNumber, highest + 1 + this.#random.int(5))
        for (let tries = 0; taken.has(no) && tries < 50; tries++) no = 1 + this.#random.int(maxNumber)
        const viewer = this.#viewer()
        if (taken.has(no)) return this.#talk(viewer, index)
        const text = this.#firstMatching([`${String(no)}`, `${String(no)}번`, `찜${String(no)}`], (t) => isOrder(t, no))
        if (text === null) return this.#talk(viewer, index)
        viewer.ordered.push(no)
        return { kind: 'pendingOrder', chat: this.#chat(viewer, text, index) }
      }
      case 'mention': {
        const viewer = this.#viewer()
        const known = view.products.length > 0 ? this.#random.pick(view.products).no : Math.min(maxNumber, 1 + this.#random.int(Math.min(maxNumber, 30)))
        const candidates = this.#random.next() < 0.5 ? [`${String(known)}번 예뻐요`, `${String(known)}번 아직 있나요?`] : ['3개 남았나요?', `${String(known)}번 크기가 어떻게 돼요?`]
        const text = this.#firstMatching(candidates, (t) => {
          const parsed = parseChat(t, settings)
          return parsed.claims.length === 0 && parsed.cancels.length === 0
        })
        return { kind: 'mention', chat: this.#chat(viewer, text ?? '몇 개 남았나요?', index) }
      }
      case 'cancel': {
        const withOrders = this.#viewers.filter((viewer) => viewer.ordered.length > 0)
        if (withOrders.length === 0) return this.#make('mention', view, index)
        const viewer = this.#random.pick(withOrders)
        const no = this.#random.pick(viewer.ordered)
        const text = this.#firstMatching([`${String(no)} 취소`, `${String(no)}번 취소`, `${String(no)}번 취소할게요`], (t) => {
          const parsed = parseChat(t, settings)
          return parsed.cancels.length === 1 && parsed.cancels[0] === no
        })
        if (text === null) return this.#talk(viewer, index)
        return { kind: 'cancel', chat: this.#chat(viewer, text, index) }
      }
      case 'nickChange': {
        if (this.#viewers.length === 0) return this.#talk(this.#viewer(), index)
        const viewer = this.#random.pick(this.#viewers)
        let nick = this.#newNick()
        if (nick === viewer.nick) nick = `${nick}${this.#random.pick(NOUNS)}`
        viewer.nick = nick
        return { kind: 'nickChange', chat: this.#chat(viewer, this.#random.pick(TALK), index) }
      }
      case 'sameNick': {
        if (this.#viewers.length === 0) return this.#talk(this.#viewer(), index)
        const twin = this.#newViewer(this.#random.pick(this.#viewers).nick)
        return { kind: 'sameNick', chat: this.#chat(twin, this.#random.pick(TALK), index) }
      }
      case 'owner': {
        const no = view.products.length > 0 ? this.#random.pick(view.products).no : 1
        const text = this.#random.pick([`${String(no)}번 마감 임박이에요`, `${String(no)}`, '다음 상품 보여 드릴게요'])
        return { kind: 'owner', chat: { b: this.#b, id: this.#id(index), ch: OWNER_CHANNEL, nick: OWNER_NICK, text, owner: true } }
      }
      case 'resend': {
        if (this.#recent.length === 0) return this.#talk(this.#viewer(), index)
        return { kind: 'resend', chat: { ...this.#random.pick(this.#recent) } }
      }
      case 'review':
      case 'talk':
        return this.#talk(this.#viewer(), index)
    }
  }

  /** 옵션 방송의 메시지 (D-O4-01). 글은 보내기 전에 코어 parseOptionComment로 그 종류로 읽히는지 확인한다 */
  #makeOption(kind: MessageKind, view: GeneratorView, index: number): GeneratedChat {
    const { settings } = view
    const maxNumber = settings['claim.maxNumber']
    const maxQuantity = settings['claim.maxQuantity']
    // 인식 함수가 보는 상품 = 판매 종료가 아닌 상품(공개 전 포함, R-20 머리말). 지금 상품은 정한 지 15초로 본다
    const products = view.products.map((product) => ({
      no: product.no,
      status: product.status,
      name: product.name ?? '',
      aliases: product.aliases ?? [],
      options: product.options ?? [],
      variants: product.variants ?? [],
    }))
    const focusNo = view.focus ?? null
    const catalog: OptionCatalogEntry[] = products
      .filter((product) => product.status !== 'CLOSED')
      .map((product) => ({ no: product.no, name: product.name, aliases: product.aliases, options: product.options }))
    const focus = focusNo === null ? null : { no: focusNo, ageSec: FOCUS_GRACE_SEC }
    const read = (text: string): OptionCommentResult => parseOptionComment(text, catalog, focus, settings)
    const word = (label: string, aliases: readonly string[] = []) => this.#random.pick([label, ...aliases])
    switch (kind) {
      case 'order': {
        const open = products.filter((product) => product.status === 'OPEN')
        if (open.length === 0) return this.#makeOption('pendingOrder', view, index)
        const product = this.#random.pick(open)
        const viewer = this.#viewer()
        const qty = maxQuantity >= 2 && this.#random.int(5) === 0 ? Math.min(maxQuantity, 2 + this.#random.int(2)) : 1
        const qtyText = qty === 1 ? '' : this.#random.next() < 0.5 ? ` ${String(qty)}개` : ` ${String(qty)}`
        const no = String(product.no)
        let candidates: string[]
        let pick: Readonly<Record<string, string>> | null = null
        if (product.options.length > 0 && product.variants.length > 0) {
          const left = product.variants.filter((variant) => variant.status === 'OPEN' && variant.remaining > 0)
          const variant = this.#random.pick(left.length > 0 ? left : product.variants)
          pick = Object.fromEntries(variant.options.map(([item, label]) => [item, label]))
          const words = variant.options.map(([item, label]) => {
            const choice = product.options.find((option) => option.name === item)?.choices.find((c) => c.label === label)
            return word(label, choice?.aliases)
          })
          const choices = `${words.join(' ')}${qtyText}`
          candidates = [`${no} ${choices}`, `${product.name} ${choices}`]
          if (product.aliases.length > 0) candidates.push(`${this.#random.pick(product.aliases)} ${choices}`)
          if (focusNo === product.no) candidates.push(choices)
        } else {
          candidates = qty === 1 ? [product.name, no, `${no}번`, `찜${no}`] : [`${product.name}${qtyText}`]
        }
        const text = this.#firstMatching(candidates, (t) => {
          const parsed = read(t)
          const order = parsed.orders[0]
          if (parsed.orders.length !== 1 || order === undefined || parsed.cancels.length > 0 || parsed.review !== null) return false
          if (order.no !== product.no || order.qty !== qty) return false
          if (pick === null) return order.options === undefined
          return Object.entries(pick).every(([item, label]) => order.options?.[item] === label)
        })
        if (text === null) return this.#talk(viewer, index)
        viewer.ordered.push(product.no)
        return { kind: 'order', chat: this.#chat(viewer, text, index) }
      }
      case 'pendingOrder': {
        const taken = new Set(products.map((product) => product.no))
        const highest = products.reduce((max, product) => Math.max(max, product.no), 0)
        let no = Math.min(maxNumber, highest + 1 + this.#random.int(5))
        for (let tries = 0; taken.has(no) && tries < 50; tries++) no = 1 + this.#random.int(maxNumber)
        const viewer = this.#viewer()
        if (taken.has(no)) return this.#talk(viewer, index)
        const text = this.#firstMatching([`${String(no)}`, `${String(no)}번`, `찜${String(no)}`], (t) => {
          const parsed = read(t)
          return parsed.orders.length === 1 && parsed.orders[0]?.no === no && parsed.orders[0].qty === 1 && parsed.cancels.length === 0 && parsed.review === null
        })
        if (text === null) return this.#talk(viewer, index)
        viewer.ordered.push(no)
        return { kind: 'pendingOrder', chat: this.#chat(viewer, text, index) }
      }
      case 'review': {
        const viewer = this.#viewer()
        const optioned = products.filter((product) => product.status !== 'CLOSED' && product.options.length > 0)
        if (optioned.length === 0) return this.#talk(viewer, index)
        const product = this.#random.pick(optioned)
        const items = product.options
        const all = items.map((item) => {
          const choice = this.#random.pick(item.choices)
          return word(choice.label, choice.aliases)
        })
        const candidates = [product.name, `${product.name} ${all.join(' ')} ${String(maxQuantity + 1)}개`, `${product.name} 특대`]
        const wide = items.find((item) => item.choices.length >= 2)
        if (wide !== undefined) {
          const first = this.#random.int(wide.choices.length)
          const second = (first + 1 + this.#random.int(wide.choices.length - 1)) % wide.choices.length
          candidates.push(`${product.name} ${(wide.choices[first] as { label: string }).label} ${(wide.choices[second] as { label: string }).label}`)
        }
        const text = this.#firstMatching(candidates, (t) => read(t).review !== null)
        if (text === null) return this.#talk(viewer, index)
        return { kind: 'review', chat: this.#chat(viewer, text, index) }
      }
      case 'mention': {
        const viewer = this.#viewer()
        const known = products.length > 0 ? this.#random.pick(products) : null
        const knownNo = known?.no ?? Math.min(maxNumber, 1 + this.#random.int(Math.min(maxNumber, 30)))
        const candidates =
          this.#random.next() < 0.5 ? [`${String(knownNo)}번 예뻐요`, `${String(knownNo)}번 아직 있나요?`] : ['3개 남았나요?', `${String(knownNo)}번 크기가 어떻게 돼요?`]
        const item = known?.options[0]
        if (known !== null && item !== undefined && item.choices.length > 0) candidates.push(`${known.name} ${this.#random.pick(item.choices).label} 있나요?`)
        const text = this.#firstMatching(candidates, (t) => {
          const parsed = read(t)
          return parsed.orders.length === 0 && parsed.cancels.length === 0 && parsed.review === null
        })
        return { kind: 'mention', chat: this.#chat(viewer, text ?? '몇 개 남았나요?', index) }
      }
      case 'cancel': {
        const withOrders = this.#viewers.filter((viewer) => viewer.ordered.length > 0)
        if (withOrders.length === 0) return this.#makeOption('mention', view, index)
        const viewer = this.#random.pick(withOrders)
        const no = this.#random.pick(viewer.ordered)
        const text = this.#firstMatching([`${String(no)} 취소`, `${String(no)}번 취소`, `${String(no)}번 취소할게요`], (t) => {
          const parsed = read(t)
          return parsed.cancels.length === 1 && parsed.cancels[0] === no && parsed.orders.length === 0 && parsed.review === null
        })
        if (text === null) return this.#talk(viewer, index)
        return { kind: 'cancel', chat: this.#chat(viewer, text, index) }
      }
      default:
        return this.#make(kind, view, index)
    }
  }

  /** 후보 중 시드로 고른 것부터 차례로 보며 조건에 맞는 첫 글 (없으면 null) */
  #firstMatching(candidates: readonly string[], ok: (text: string) => boolean): string | null {
    const start = this.#random.int(candidates.length)
    for (let i = 0; i < candidates.length; i++) {
      const text = candidates[(start + i) % candidates.length] as string
      if (ok(text)) return text
    }
    return null
  }
}

// ── 실행 관리 ────────────────────────────────────────────────────────────

export type StopReason = 'completed' | 'stopped' | 'ended' | 'shutdown'

/** 생성기 상태 (API 응답·SSE generator 알림) */
export interface GeneratorStatus {
  readonly b: string
  readonly running: boolean
  /** 보낸 수 (다시 보낸 사본 포함) */
  readonly sent: number
  readonly total: number
  readonly perSecond: number
  readonly seed: number | null
  /** 다시 보낸 사본 수 (수집 함수가 duplicate로 걸러 기록하지 않았다) */
  readonly duplicates: number
  /** 저장하지 못한 수 (다시 시도하지 않았다) */
  readonly failed: number
  /** 멈춘 까닭: completed 다 보냄 · stopped 멈춤 요청 · ended 방송 끝냄 · shutdown 서버 종료. 돌고 있거나 시작한 적 없으면 null */
  readonly stopReason: StopReason | null
}

export interface GeneratorSettings {
  readonly total: number
  readonly perSecond: number
  readonly seed: number
}

/** 수집 함수 결과 중 생성기가 보는 것 */
export type IngestStatus = 'recorded' | 'duplicate' | 'rejected' | 'not_found' | 'save_failed'

export interface GeneratorDeps {
  readonly timer: GeneratorTimer
  readonly now: () => number
  /** 그 리허설 범위의 최신 상태와 seq */
  readonly read: (sellerId: string, date: string) => Promise<{ state: EngineState; seq: number }>
  /** 수집 함수 (조치자 collector) */
  readonly ingest: (sellerId: string, chat: GeneratedChat['chat']) => Promise<IngestStatus>
  /** 상태가 바뀔 때 (SSE) */
  readonly publish: (sellerId: string, date: string, status: GeneratorStatus) => void
  /** 타이머 간격을 나누는 값 (E2E 시험 속도, 기본 1) */
  readonly speed?: number
}

interface Run {
  readonly sellerId: string
  readonly b: string
  readonly date: string
  readonly settings: GeneratorSettings
  readonly maker: ChatMaker
  readonly requestId: string | null
  running: boolean
  sent: number
  duplicates: number
  failed: number
  stopReason: StopReason | null
  due: number
  cancel: (() => void) | null
  /** 지금 보내는 중인 메시지 (멈출 때 끝나기를 기다린다) */
  inFlight: Promise<void> | null
  /** 멈춘 차례 (끝난 실행 기록을 지울 때 가장 먼저 끝난 것부터). 돌고 있으면 0 */
  finishedOrder: number
}

const idleStatus = (b: string): GeneratorStatus => ({ b, running: false, sent: 0, total: 0, perSecond: 0, seed: null, duplicates: 0, failed: 0, stopReason: null })

export type GeneratorStart =
  | { readonly kind: 'started'; readonly status: GeneratorStatus }
  /** 그 방송에서 이미 돈다 (same: 같은 요청 번호로 다시 보낸 시작) */
  | { readonly kind: 'running'; readonly status: GeneratorStatus; readonly same: boolean }
  /** 그 판매자의 다른 리허설 방송(b)에서 돌고 있다 — 아무것도 시작하지 않았다 */
  | { readonly kind: 'elsewhere'; readonly b: string }

export class ChatGenerators {
  readonly #deps: GeneratorDeps
  /** 판매자 → (방송 → 그 방송의 마지막 실행). 판매자마다 따로라 서로 영향이 없다 */
  readonly #sellers = new Map<string, Map<string, Run>>()
  #finished = 0

  constructor(deps: GeneratorDeps) {
    this.#deps = deps
  }

  status(sellerId: string, b: string): GeneratorStatus {
    const run = this.#sellers.get(sellerId)?.get(b)
    return run === undefined ? idleStatus(b) : statusOf(run)
  }

  /** 지금 도는 생성기 수 (시험용) */
  get running(): number {
    let n = 0
    for (const runs of this.#sellers.values()) for (const run of runs.values()) if (run.running) n++
    return n
  }

  /** 남아 있는 실행 기록 수 (돌고 있는 것 포함, 시험용). sellerId를 주면 그 판매자만 */
  records(sellerId?: string): number {
    if (sellerId !== undefined) return this.#sellers.get(sellerId)?.size ?? 0
    let n = 0
    for (const runs of this.#sellers.values()) n += runs.size
    return n
  }

  /**
   * 시작한다. 그 방송에서 이미 돌고 있으면 'running'(같은 요청 번호로 다시 보낸 시작이면 그 상태), 그 판매자의 다른 리허설 방송에서
   * 돌고 있으면 'elsewhere'(아무것도 시작하지 않는다, D-096). 호출하는 쪽이 리허설 방송인지·끝나지 않았는지 이미 확인했다.
   * 첫 메시지는 바로 보낸다
   */
  async start(sellerId: string, b: string, date: string, settings: GeneratorSettings, requestId: string | null): Promise<GeneratorStart> {
    let runs = this.#sellers.get(sellerId)
    const existing = runs?.get(b)
    if (existing !== undefined && (existing.running || (requestId !== null && existing.requestId === requestId))) {
      return { kind: 'running', status: statusOf(existing), same: requestId !== null && existing.requestId === requestId }
    }
    for (const run of runs?.values() ?? []) if (run.running) return { kind: 'elsewhere', b: run.b }
    if (runs === undefined) {
      runs = new Map()
      this.#sellers.set(sellerId, runs)
    }
    // 자리를 먼저 잡는다(그 판매자의 두 번째 시작은 위에서 걸린다 — 여기까지 기다림이 없다). 시작 seq는 그다음에 읽는다.
    // 그 방송의 앞 실행 기록은 새 실행으로 바꾼다(방송마다 마지막 하나)
    const placeholder: Run = {
      sellerId,
      b,
      date,
      settings,
      maker: new ChatMaker(b, settings.seed, 0),
      requestId,
      running: true,
      sent: 0,
      duplicates: 0,
      failed: 0,
      stopReason: null,
      due: this.#deps.now(),
      cancel: null,
      inFlight: null,
      finishedOrder: 0,
    }
    runs.delete(b)
    runs.set(b, placeholder)
    let startSeq: number
    try {
      startSeq = (await this.#deps.read(sellerId, date)).seq
    } catch (error) {
      // 시작하지 못했다: 앞 실행 기록을 되돌린다
      if (runs.get(b) === placeholder) {
        runs.delete(b)
        if (existing !== undefined) runs.set(b, existing)
      }
      if (runs.size === 0 && this.#sellers.get(sellerId) === runs) this.#sellers.delete(sellerId)
      throw error
    }
    // 읽는 동안 멈춤·끝냄·서버 종료가 있었으면 그 상태(멈춘 차례 포함)를 그대로 가져간다
    const run: Run = { ...placeholder, maker: new ChatMaker(b, settings.seed, startSeq), due: this.#deps.now() }
    runs.set(b, run)
    if (!run.running) this.#prune(sellerId)
    if (run.running) {
      this.#publish(run)
      this.#schedule(run, 0)
    }
    return { kind: 'started', status: statusOf(run) }
  }

  /** 멈춘다 (보내는 중인 메시지가 끝나기를 기다린다). 돌고 있지 않으면 그대로 */
  async stop(sellerId: string, b: string, reason: StopReason): Promise<GeneratorStatus> {
    const run = this.#sellers.get(sellerId)?.get(b)
    if (run === undefined) return this.status(sellerId, b)
    if (run.running) this.#halt(run, reason)
    await run.inFlight
    return statusOf(run)
  }

  /** 서버 종료: 모두 멈춘다 (다시 시작해도 이어서 하지 않는다) */
  closeAll(): void {
    for (const runs of [...this.#sellers.values()]) for (const run of [...runs.values()]) if (run.running) this.#halt(run, 'shutdown')
  }

  #halt(run: Run, reason: StopReason): void {
    run.running = false
    run.stopReason = reason
    run.finishedOrder = ++this.#finished
    run.cancel?.()
    run.cancel = null
    this.#publish(run)
    this.#prune(run.sellerId)
  }

  /** 그 판매자의 끝난 실행 기록이 GENERATOR_RECORDS_MAX개를 넘으면 가장 먼저 끝난 것부터 지운다 (D-096) */
  #prune(sellerId: string): void {
    const runs = this.#sellers.get(sellerId)
    if (runs === undefined) return
    const finished = [...runs.values()].filter((run) => !run.running).sort((x, y) => x.finishedOrder - y.finishedOrder)
    for (const run of finished.slice(0, Math.max(0, finished.length - GENERATOR_RECORDS_MAX))) {
      if (runs.get(run.b) === run) runs.delete(run.b)
    }
    if (runs.size === 0) this.#sellers.delete(sellerId)
  }

  #publish(run: Run): void {
    try {
      this.#deps.publish(run.sellerId, run.date, statusOf(run))
    } catch {
      // 알림 실패는 생성기를 멈추지 않는다
    }
  }

  #schedule(run: Run, delay: number): void {
    run.cancel = this.#deps.timer.schedule(delay, () => {
      run.cancel = null
      if (!run.running) return
      const flight = this.#tick(run).finally(() => {
        if (run.inFlight === flight) run.inFlight = null
      })
      run.inFlight = flight
    })
  }

  async #tick(run: Run): Promise<void> {
    let status: IngestStatus
    try {
      const { state } = await this.#deps.read(run.sellerId, run.date)
      if (!run.running) return
      const view = generatorView(state, run.b)
      if (view === null || getBroadcast(state, run.b)?.ended === true) {
        this.#halt(run, 'ended')
        return
      }
      const next = run.maker.next(view)
      status = await this.#deps.ingest(run.sellerId, next.chat)
    } catch {
      status = 'save_failed'
    }
    run.sent += 1
    if (status === 'duplicate') run.duplicates += 1
    else if (status === 'save_failed' || status === 'rejected') run.failed += 1
    else if (status === 'not_found') {
      this.#halt(run, 'ended')
      return
    }
    if (run.sent >= run.settings.total) {
      if (run.running) this.#halt(run, 'completed')
      return
    }
    if (!run.running) return
    this.#publish(run)
    const speed = this.#deps.speed ?? 1
    run.due += 1000 / run.settings.perSecond / speed
    this.#schedule(run, Math.max(0, run.due - this.#deps.now()))
  }
}

function statusOf(run: Run): GeneratorStatus {
  return {
    b: run.b,
    running: run.running,
    sent: run.sent,
    total: run.settings.total,
    perSecond: run.settings.perSecond,
    seed: run.settings.seed,
    duplicates: run.duplicates,
    failed: run.failed,
    stopReason: run.stopReason,
  }
}
