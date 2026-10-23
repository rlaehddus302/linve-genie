// 감사 채팅 올리기 (선택 기능, X1 YT-10 AC11~AC17, D-X1-17~D-X1-24). content script가 쓴다 — 크롬 API 없이 가짜 페이지로 시험한다.
// - 글은 서버가 만든 것만 넣는다(서버 발송함의 감사, YT-07 묶음·이름 정리 끝난 글). 고치지 않고 글자로만 넣는다(HTML 아님).
// - 가져가기는 넣을 준비가 됐을 때만: 입력 칸이 있고, 비었고, 마지막 키 입력 뒤 5초가 지났을 때(D-X1-22). 판매자 글은 지우거나 덮지 않는다.
// - "로그인 계정이 방송 채널 주인인가(입력 칸의 주인 배지)"와 방송 채널을 함께 보낸다. 서버가 주인이고 방송 채널이 그 회차 채널과 같을 때만 글을 준다(D-X1-20·29).
//   주인인지 못 읽으면(관리자·다른 계정·로그인 안 함) 다른 값으로 대신하지 않고 올리지 않는다.
// - 보낸 뒤 15초 안에 내 채널의 같은 글이 채팅 목록에 뜨면 "게시됨", 못 보면 "확인 필요" — 어느 쪽이든 다시 올리지 않는다(D-X1-23).
//   넣기 전에 멈춘 경우(쓰는 중·입력 칸 없음·보내기 단추 없음)만 "안 올림"으로 돌려준다.
// - 글 사이는 3초 이상(서버도 지킨다, D-X1-21). 결과는 같은 것을 다시 알려도 서버가 한 번만 반영한다.
// - 채팅 내용을 남기지(저장·출력) 않는다.
import type { Timers } from './outbox.ts'
import type { ChatMessage } from './reader.ts'
import { INPUT_FIELD, ME_OWNER_ATTR, OWNER_ATTR, SEND_BUTTON, WHO_EVENT } from './selectors.ts'

/** 마지막 키 입력 뒤 이만큼 지나야 넣는다 (D-X1-22) */
export const TYPING_IDLE_MS = 5_000
/** 보낸 뒤 내 글이 뜨기를 기다리는 시간 (D-X1-23) */
export const CONFIRM_MS = 15_000
/** 글 사이 간격 (D-X1-21) */
export const GAP_MS = 3_000
/** 평소 묻는 간격 */
export const POLL_MS = 3_000
/** 쓰는 중일 때 다시 보는 간격 */
export const BUSY_MS = 1_000
/** 꺼짐·회차 안 이음·주인 아님·멈춤일 때 묻는 간격 */
export const IDLE_MS = 15_000
/** 결과 알리기를 다시 하는 횟수·간격 */
const RESULT_TRIES = 5
const RESULT_RETRY_MS = 2_000

export type ThanksOutcome = 'POSTED' | 'UNCONFIRMED' | 'NOT_POSTED'

export interface Identity {
  /** 로그인 계정이 방송 채널 주인인가 (입력 칸 주인 배지) */
  readonly meIsOwner: boolean
  readonly owner: string | null
}

export interface PosterOptions {
  readonly document: Document
  readonly video: string
  /** 서비스 워커에 묻기 (hub.ts thanksTake·thanksResult) */
  readonly ask: (message: unknown) => Promise<unknown>
  readonly timers: Timers
  readonly now?: () => number
  /** 로그인 채널·방송 채널 읽기 (기본: 페이지 쪽 스크립트에 묻기) */
  readonly identity?: () => Identity
}

interface Waiting {
  readonly ids: readonly number[]
  readonly text: string
  /** 방송 채널 ID — 이 채널의 같은 글이 뜨면 게시됨 */
  readonly owner: string
  readonly timer: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 견줄 글: 공백을 하나로 (유튜브가 줄바꿈·겹친 공백을 줄일 수 있다) */
export function sameText(text: string): string {
  return text.replace(/[\s\u00a0]+/g, ' ').trim()
}

/** 입력 칸의 글 */
function fieldText(field: Element): string {
  return sameText(field.textContent ?? '')
}

/** 페이지 쪽 스크립트에 물어 로그인 채널·방송 채널을 읽는다 (붙었던 속성은 바로 지운다) */
export function askIdentity(doc: Document): Identity {
  const root = doc.documentElement
  root.removeAttribute(ME_OWNER_ATTR)
  root.removeAttribute(OWNER_ATTR)
  doc.dispatchEvent(new CustomEvent(WHO_EVENT))
  const meIsOwner = root.getAttribute(ME_OWNER_ATTR) === '1'
  const owner = root.getAttribute(OWNER_ATTR)
  root.removeAttribute(ME_OWNER_ATTR)
  root.removeAttribute(OWNER_ATTR)
  return { meIsOwner, owner }
}

export class ThanksPoster {
  readonly #doc: Document
  readonly #video: string
  readonly #ask: (message: unknown) => Promise<unknown>
  readonly #timers: Timers
  readonly #now: () => number
  readonly #identity: () => Identity
  #timer: unknown = null
  #busy = false
  #stopped = true
  #inserting = false
  #lastKey = Number.NEGATIVE_INFINITY
  #waiting: Waiting | null = null
  readonly #onKey = (event: Event) => {
    if (this.#inserting) return
    const field = this.#doc.querySelector(INPUT_FIELD)
    const target = event.target
    if (field !== null && target instanceof this.#view().Node && (field === target || field.contains(target))) this.#lastKey = this.#now()
  }

  constructor(options: PosterOptions) {
    this.#doc = options.document
    this.#video = options.video
    this.#ask = options.ask
    this.#timers = options.timers
    this.#now = options.now ?? (() => Date.now())
    this.#identity = options.identity ?? (() => askIdentity(this.#doc))
  }

  #view(): typeof globalThis {
    return (this.#doc.defaultView ?? globalThis) as typeof globalThis
  }

  start(firstMs: number = POLL_MS): void {
    if (!this.#stopped) return
    this.#stopped = false
    for (const type of ['keydown', 'input', 'compositionstart', 'compositionupdate', 'paste']) this.#doc.addEventListener(type, this.#onKey, true)
    this.#schedule(firstMs)
  }

  stop(): void {
    this.#stopped = true
    for (const type of ['keydown', 'input', 'compositionstart', 'compositionupdate', 'paste']) this.#doc.removeEventListener(type, this.#onKey, true)
    if (this.#timer !== null) this.#timers.clear(this.#timer)
    this.#timer = null
  }

  /** 결과를 기다리는 글이 있는가 (시험용) */
  get waiting(): boolean {
    return this.#waiting !== null
  }

  #schedule(ms: number): void {
    if (this.#stopped) return
    if (this.#timer !== null) this.#timers.clear(this.#timer)
    this.#timer = this.#timers.set(() => {
      this.#timer = null
      void this.tick()
    }, ms)
  }

  /** 입력 칸이 비었고 마지막 키 입력 뒤 5초가 지났나 */
  #ready(field: Element | null): field is Element {
    return field !== null && fieldText(field) === '' && this.#now() - this.#lastKey >= TYPING_IDLE_MS
  }

  /** 한 번 보기: 준비됐으면 서버에 글을 묻고, 받으면 넣고 보낸다 */
  async tick(): Promise<void> {
    if (this.#stopped || this.#busy || this.#waiting !== null) return
    const field = this.#doc.querySelector(INPUT_FIELD)
    // 판매자가 쓰는 중이면 묻지 않고 기다린다
    if (field !== null && !this.#ready(field)) {
      this.#schedule(BUSY_MS)
      return
    }
    this.#busy = true
    try {
      // 입력 칸이 없으면(로그인 안 함) 채널을 모르는 것으로 묻는다 → 서버가 "방송 채널 계정으로 로그인해야…"를 알린다
      const who: Identity = field === null ? { meIsOwner: false, owner: null } : this.#identity()
      const reply = await this.#ask({ type: 'thanksTake', v: this.#video, meIsOwner: who.meIsOwner, owner: who.owner })
      if (this.#stopped) return
      if (!isRecord(reply)) {
        this.#schedule(POLL_MS)
        return
      }
      const state = reply['state']
      const post = reply['post']
      if (state === 'POST' && isRecord(post) && who.meIsOwner && who.owner !== null) {
        const ids = Array.isArray(post['ids']) ? post['ids'].filter((id): id is number => typeof id === 'number') : []
        const text = typeof post['text'] === 'string' ? post['text'] : ''
        await this.#post(ids, text, who.owner)
        return
      }
      if (state === 'POST') {
        // 받았지만 넣을 수 없음 (모양이 틀림) — 돌려준다
        const ids = isRecord(post) && Array.isArray(post['ids']) ? post['ids'].filter((id): id is number => typeof id === 'number') : []
        if (ids.length > 0) await this.#report(ids, 'NOT_POSTED')
        this.#schedule(GAP_MS)
        return
      }
      if (state === 'NONE') {
        const after = typeof reply['afterMs'] === 'number' && Number.isFinite(reply['afterMs']) ? reply['afterMs'] : POLL_MS
        this.#schedule(Math.min(60_000, Math.max(BUSY_MS, after)))
        return
      }
      this.#schedule(IDLE_MS)
    } finally {
      this.#busy = false
    }
  }

  /** 받은 글을 넣고 보낸다. 넣기 전에 멈추면 "안 올림" */
  async #post(ids: readonly number[], text: string, owner: string): Promise<void> {
    if (ids.length === 0) {
      this.#schedule(POLL_MS)
      return
    }
    const field = this.#doc.querySelector(INPUT_FIELD)
    // 묻는 사이에 판매자가 쓰기 시작했으면 넣지 않는다
    if (text === '' || !this.#ready(field)) {
      await this.#report(ids, 'NOT_POSTED')
      this.#schedule(BUSY_MS)
      return
    }
    const button = this.#doc.querySelector(SEND_BUTTON)
    if (button === null || (button as HTMLButtonElement).disabled || button.getAttribute('aria-disabled') === 'true') {
      await this.#report(ids, 'NOT_POSTED')
      this.#schedule(IDLE_MS)
      return
    }
    this.#insert(field, text)
    if (fieldText(field) !== sameText(text)) {
      // 들어가지 않았다 — 우리가 넣은 것만 지우고 안 올림
      this.#clearOurs(field, text)
      await this.#report(ids, 'NOT_POSTED')
      this.#schedule(IDLE_MS)
      return
    }
    const timer = this.#timers.set(() => void this.#settle('UNCONFIRMED'), CONFIRM_MS)
    this.#waiting = { ids, text: sameText(text), owner, timer }
    ;(button as HTMLElement).click()
  }

  /** 글자로만 넣는다 (execCommand insertText — 유튜브 입력 칸이 알아듣는 방식, 안 되면 textContent + input 이벤트) */
  #insert(field: Element, text: string): void {
    this.#inserting = true
    try {
      ;(field as HTMLElement).focus()
      let done = false
      try {
        done = typeof this.#doc.execCommand === 'function' && this.#doc.execCommand('insertText', false, text)
      } catch {
        done = false
      }
      if (!done || fieldText(field) !== sameText(text)) {
        field.textContent = text
        const view = this.#view()
        const InputEventCtor = (view as unknown as { InputEvent?: typeof InputEvent }).InputEvent
        field.dispatchEvent(InputEventCtor === undefined ? new view.Event('input', { bubbles: true }) : new InputEventCtor('input', { bubbles: true, inputType: 'insertText', data: text }))
      }
    } finally {
      this.#inserting = false
    }
  }

  #clearOurs(field: Element, text: string): void {
    const now = fieldText(field)
    if (now !== '' && sameText(text).startsWith(now)) {
      this.#inserting = true
      field.textContent = ''
      this.#inserting = false
    }
  }

  /** 새로 읽은 채팅 (reader.ts) — 내 채널의 같은 글이면 게시됨 */
  onMessages(messages: readonly ChatMessage[]): void {
    const waiting = this.#waiting
    if (waiting === null) return
    if (messages.some((message) => message.ch === waiting.owner && sameText(message.text) === waiting.text)) void this.#settle('POSTED')
  }

  async #settle(result: 'POSTED' | 'UNCONFIRMED'): Promise<void> {
    const waiting = this.#waiting
    if (waiting === null) return
    this.#waiting = null
    this.#timers.clear(waiting.timer)
    // 확인하지 못했는데 우리 글이 입력 칸에 그대로 남아 있으면(보내지지 않음) 지운다 — 판매자 글은 건드리지 않는다
    if (result === 'UNCONFIRMED') {
      const field = this.#doc.querySelector(INPUT_FIELD)
      if (field !== null && fieldText(field) === waiting.text) this.#clearOurs(field, waiting.text)
    }
    await this.#report(waiting.ids, result)
    this.#schedule(GAP_MS)
  }

  /** 결과 알리기 (서버에 닿지 못하면 몇 번 더 — 같은 결과를 다시 알려도 한 번만 반영된다) */
  async #report(ids: readonly number[], result: ThanksOutcome): Promise<void> {
    for (let attempt = 0; attempt < RESULT_TRIES; attempt++) {
      const reply = await this.#ask({ type: 'thanksResult', ids, result })
      if (isRecord(reply) && reply['ok'] === true) return
      if (this.#stopped) return
      await new Promise<void>((resolve) => this.#timers.set(resolve, RESULT_RETRY_MS))
    }
  }
}
