// 실시간 연결 하나를 화면 전체가 함께 쓴다 (D-075·D-085, I1 AC-I1-15·23).
// - 한 페이지에 SSE 연결은 하나다: 범위 저장소(콘솔·정산…)와 출력 기록(앱 전체 — 프린터 상태·알림·출력 기기), 유튜브 알림(설정·마법사·콘솔 유튜브 칸, I3), 라벨 기능 켬/끔 알림(labels, N4a), 입금 확인 신호(N3 — 메뉴의 확인 필요 수)가
//   같은 연결의 알림을 나눠 받는다.
//   브라우저의 같은 주소 연결 수 상한(HTTP/1.1 여섯 개)을 실시간 연결이 다 쓰지 않게 한다.
// - 연결은 이 기기의 기기 ID를 밝힌다(`?device=`) — 이 기기가 출력 기기면 다른 기기에 "연결됨/끊김"이 이것으로 보인다(L-11 10).
// - 보는 쪽(view)마다 EventSource와 같은 모양을 준다. 늦게 붙은 쪽에는 지금까지 받은 범위별 seq로 ready를 한 번 다시 준다
//   (새 연결의 ready와 같은 성질 — 그 seq 뒤의 변경은 change로 온다).
// - 마지막 보는 쪽이 닫히면 연결을 닫는다. 브라우저가 오프라인이 되면 연결을 닫는다(다시 붙는 쪽이 새로 연다 — 새 ready).
import type { ScopeSeq } from '../api/types.ts'

export interface EventSourceLike {
  readonly readyState: number
  onopen: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  addEventListener(type: string, listener: (event: MessageEvent) => void): void
  close(): void
}

/** 받는 알림 종류 (I2: 포장·배송 기록 packing, 가게 설정 shop — AC-I2-32·13 · N4a: 라벨 기능 켬/끔 labels · N2b-2: 인스타그램 instagram, 틱톡 tiktok · N3: 입금 확인 deposit) */
export const STREAM_EVENTS = ['ready', 'change', 'generator', 'print', 'youtube', 'instagram', 'packing', 'shop', 'labels', 'tiktok', 'deposit'] as const

const CLOSED = 2
const OPEN = 1

const scopeKey = (scope: { readonly date: string; readonly rehearsal: boolean }): string => `${scope.date}|${scope.rehearsal ? 'r' : 'l'}`

function parse(event: MessageEvent): unknown {
  try {
    return JSON.parse(String(event.data))
  } catch {
    return null
  }
}

class StreamView implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  readonly #owner: SharedStream
  readonly #listeners = new Map<string, ((event: MessageEvent) => void)[]>()
  #closed = false

  constructor(owner: SharedStream) {
    this.#owner = owner
  }

  get readyState(): number {
    return this.#closed ? CLOSED : this.#owner.readyState
  }

  get closed(): boolean {
    return this.#closed
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener])
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#owner.detach(this)
  }

  dispatch(type: string, event: MessageEvent): void {
    if (this.#closed) return
    for (const listener of this.#listeners.get(type) ?? []) listener(event)
  }
}

export interface SharedStreamOptions {
  /** 연결 주소 (연결을 새로 열 때마다 읽는다) */
  readonly url: () => string
  /** 연결 만들기 (기본: 브라우저 EventSource) */
  readonly create?: (url: string) => EventSourceLike
}

export class SharedStream {
  readonly #options: SharedStreamOptions
  readonly #views = new Set<StreamView>()
  #source: EventSourceLike | null = null
  /** 이 연결이 지금까지 알게 된 범위별 seq (ready + change) — 늦게 붙는 쪽의 ready */
  #seqs: Map<string, ScopeSeq> | null = null
  #unwatch: (() => void) | null = null

  constructor(options: SharedStreamOptions) {
    this.#options = options
  }

  get readyState(): number {
    return this.#source?.readyState ?? CLOSED
  }

  /** 보는 쪽 하나를 붙인다 (연결이 없거나 닫혔으면 새로 연다) */
  open(): EventSourceLike {
    const view = new StreamView(this)
    this.#views.add(view)
    this.#watchNetwork()
    if (this.#source === null || this.#source.readyState === CLOSED) {
      this.#connect()
    } else if (this.#source.readyState === OPEN && this.#seqs !== null) {
      // 이미 열린 연결: 지금까지 받은 seq로 ready를 한 번 (붙이는 쪽이 듣기를 단 뒤에)
      const scopes = [...this.#seqs.values()]
      void Promise.resolve().then(() => view.dispatch('ready', new MessageEvent('ready', { data: JSON.stringify({ scopes }) })))
    }
    return view
  }

  /** 연결을 닫고 새 주소로 다시 연다 (기기 ID가 바뀜 — 보는 쪽은 그대로, 새 ready를 받는다) */
  restart(): void {
    this.#closeSource()
    if (this.#views.size > 0) this.#connect()
  }

  /** 연결이 없거나 닫혔으면 새로 연다 (보는 쪽은 그대로 — 새 ready를 받는다) */
  ensure(): void {
    if (this.#views.size === 0) return
    if (this.#source === null || this.#source.readyState === CLOSED) this.#connect()
  }

  detach(view: StreamView): void {
    this.#views.delete(view)
    if (this.#views.size === 0) {
      this.#closeSource()
      this.#unwatch?.()
      this.#unwatch = null
    }
  }

  #closeSource(): void {
    this.#source?.close()
    this.#source = null
    this.#seqs = null
  }

  #connect(): void {
    this.#closeSource()
    const create = this.#options.create ?? ((url: string) => new EventSource(url, { withCredentials: true }))
    const source = create(this.#options.url())
    this.#source = source
    const views = () => [...this.#views]
    source.onopen = (event) => {
      if (this.#source !== source) return
      for (const view of views()) view.onopen?.(event)
    }
    source.onerror = (event) => {
      if (this.#source !== source) return
      // 브라우저가 다시 붙지 않는 닫힘이면 지금 연결을 버린다 — 보는 쪽이 다시 붙을 때 새로 연다
      if (source.readyState === CLOSED) {
        this.#source = null
        this.#seqs = null
      }
      for (const view of views()) {
        // 닫힌 연결: 보는 쪽에는 닫힌 연결로 보인다
        view.onerror?.(event)
      }
    }
    source.addEventListener('ready', (event) => {
      if (this.#source !== source) return
      const data = parse(event) as { scopes?: ScopeSeq[] } | null
      const seqs = new Map<string, ScopeSeq>()
      for (const scope of data?.scopes ?? []) seqs.set(scopeKey(scope), { date: scope.date, rehearsal: scope.rehearsal, seq: scope.seq })
      this.#seqs = seqs
      for (const view of views()) view.dispatch('ready', event)
    })
    source.addEventListener('change', (event) => {
      if (this.#source !== source) return
      const data = parse(event) as ScopeSeq | null
      if (data !== null && this.#seqs !== null && typeof data.seq === 'number') {
        const key = scopeKey(data)
        const known = this.#seqs.get(key)
        if (known === undefined || data.seq > known.seq) this.#seqs.set(key, { date: data.date, rehearsal: data.rehearsal, seq: data.seq })
      }
      for (const view of views()) view.dispatch('change', event)
    })
    for (const type of STREAM_EVENTS) {
      if (type === 'ready' || type === 'change') continue
      source.addEventListener(type, (event) => {
        if (this.#source !== source) return
        for (const view of views()) view.dispatch(type, event)
      })
    }
  }

  /** 오프라인이 되면 연결을 닫는다 — 열린 연결이 남아 있어도 받지 못할 수 있다. 다시 온라인이 되면 새로 연다(새 ready) */
  #watchNetwork(): void {
    if (this.#unwatch !== null || typeof window === 'undefined') return
    const offline = () => this.#closeSource()
    const online = () => this.ensure()
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    this.#unwatch = () => {
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
    }
  }
}

/** 이 페이지의 실시간 연결 (기기 ID를 밝힌다) */
let appStream: SharedStream | null = null

export function sharedStream(url: () => string): SharedStream {
  appStream ??= new SharedStream({ url })
  return appStream
}
