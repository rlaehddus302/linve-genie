// 앱 없이 서버가 방송 소리를 읽고 등록하기 (D-LV1-14, 사용자 지시 2026-11-08 "서버에서 다 처리하면 사용자가 앱에 다시 돌아왔을 때 서버에서 인식 중이었던 거를 보여주면").
// - 방송 소리에서 받아쓴 글을 받을 앱(조작 흐름)이 없을 때만 쓴다 — 앱이 돌아오면 앱이 받고(앱 쪽 규칙 그대로) 이 읽기는 닫는다.
// - 읽기는 앱과 같은 서버 읽기 세션(readingFactory)을 그대로 쓴다: 바로 등록(번호·가격이 들림)·자동 확인은 앱 기본 설정 그대로이고, 쓰기 효과 중
//   등록(product.register, 음성 기록 포함)만 서버가 직접 한다. 고치기·번호 바꾸기·문자찜처럼 사람이 확인해야 할 효과는 하지 않고 "못 한 말"로 남긴다.
// - 한 일과 들은 말은 방송마다 메모리에만(최근 300줄, DB·로그 없음 — 방송 소리 원칙) 남겨 앱이 돌아오면 보인다. 확인이 필요한 말(카드)도 함께 보인다.
import { randomUUID } from 'node:crypto'
import { productKey } from '../../../web/src/lib/derive.ts'
import type { SessionContext } from '../auth.ts'
import type { LogSink } from '../log.ts'
import type { Service } from '../service.ts'
import type { Clock } from '../time.ts'
import type { VoiceReadingSession, VoiceRelayOptions } from './relay.ts'

/** 서버가 들은·한 일 한 줄 */
export interface HeardEntry {
  /** 서버 시각 (UTC ms) */
  readonly at: number
  /** heard 받아쓴 말 · registered 등록함 · exists 이미 있는 번호 · skipped 사람이 확인할 말이라 하지 않음 · failed 등록 실패 */
  readonly kind: 'heard' | 'registered' | 'exists' | 'skipped' | 'failed'
  readonly text?: string
  readonly no?: number
  readonly name?: string
  readonly price?: number
}

export interface HeardView {
  readonly entries: readonly HeardEntry[]
  /** 아직 확인하지 않은 말 (카드) */
  readonly pending: readonly string[]
}

export const HEARD_MAX = 300
/** 서버 읽기 기기 이름 (음성 기록의 device) */
export const SERVER_DEVICE = 'livegenie-server'

type ReadingFactory = NonNullable<VoiceRelayOptions['reading']>

interface Reader {
  readonly sellerId: string
  readonly broadcastId: string
  session: VoiceReadingSession | null
  opening: Promise<VoiceReadingSession | null> | null
  captureAt: number | null
  work: Promise<void>
  closed: boolean
}

export interface HeadlessVoiceOptions {
  readonly reading: ReadingFactory
  readonly service: Pick<Service, 'writeEvent'>
  readonly clock: Clock
  readonly log: LogSink
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export class HeadlessVoice {
  readonly #o: HeadlessVoiceOptions
  /** 판매자 → 지금 읽는 방송 하나 */
  readonly #readers = new Map<string, Reader>()
  /** `${판매자}\n${방송}` → 들은·한 일 */
  readonly #heard = new Map<string, { entries: HeardEntry[]; pending: string[] }>()

  constructor(options: HeadlessVoiceOptions) {
    this.#o = options
  }

  /** 앱이 받지 않은 받아쓴 글 하나 (시각은 서버 시각 ms) */
  deliver(sellerId: string, broadcastId: string, result: { text: string; startAt: number; endAt: number; conf?: number }): void {
    let reader = this.#readers.get(sellerId)
    if (reader !== undefined && reader.broadcastId !== broadcastId) {
      this.#close(reader)
      reader = undefined
    }
    if (reader === undefined) {
      reader = { sellerId, broadcastId, session: null, opening: null, captureAt: null, work: Promise.resolve(), closed: false }
      this.#readers.set(sellerId, reader)
    }
    this.#note(sellerId, broadcastId, { at: result.endAt, kind: 'heard', text: result.text })
    const current = reader
    current.work = current.work.then(async () => {
      const session = await this.#session(current)
      if (session === null || current.closed) return
      if (current.captureAt === null) {
        current.captureAt = result.startAt
        await session.onServerCapture?.(result.startAt)
      }
      const base = current.captureAt
      await session.onResult({ text: result.text, startMs: Math.max(0, result.startAt - base), endMs: Math.max(0, result.endAt - base), ...(result.conf === undefined ? {} : { conf: result.conf }) })
    }).catch(() => undefined)
  }

  /** 앱이 돌아왔다·방송 끝·설정 끔 — 그 판매자의 서버 읽기를 닫는다(들은 말은 남긴다) */
  release(sellerId: string): void {
    const reader = this.#readers.get(sellerId)
    if (reader !== undefined) this.#close(reader)
  }

  /** 앱에 보일 들은 말 (그 방송) */
  view(sellerId: string, broadcastId: string): HeardView {
    const heard = this.#heard.get(`${sellerId}\n${broadcastId}`)
    return heard === undefined ? { entries: [], pending: [] } : { entries: [...heard.entries], pending: [...heard.pending] }
  }

  /** 앱이 다 봤다 — 그 방송의 들은 말을 지운다 */
  clear(sellerId: string, broadcastId: string): void {
    this.#heard.delete(`${sellerId}\n${broadcastId}`)
  }

  /** 방송이 끝났다 — 읽기를 닫는다 (들은 말은 앱이 볼 때까지 남긴다) */
  endBroadcast(sellerId: string, broadcastId: string): void {
    const reader = this.#readers.get(sellerId)
    if (reader !== undefined && reader.broadcastId === broadcastId) this.#close(reader)
  }

  status(): { reading: number } {
    return { reading: this.#readers.size }
  }

  close(): void {
    for (const reader of [...this.#readers.values()]) this.#close(reader)
    this.#heard.clear()
  }

  // ── 안쪽 ──────────────────────────────────────────────

  #close(reader: Reader): void {
    reader.closed = true
    if (this.#readers.get(reader.sellerId) === reader) this.#readers.delete(reader.sellerId)
    reader.session?.close()
    reader.session = null
  }

  #note(sellerId: string, broadcastId: string, entry: HeardEntry): void {
    const key = `${sellerId}\n${broadcastId}`
    let heard = this.#heard.get(key)
    if (heard === undefined) {
      heard = { entries: [], pending: [] }
      this.#heard.set(key, heard)
    }
    heard.entries.push(entry)
    if (heard.entries.length > HEARD_MAX) heard.entries.splice(0, heard.entries.length - HEARD_MAX)
  }

  #pending(sellerId: string, broadcastId: string, texts: string[]): void {
    const key = `${sellerId}\n${broadcastId}`
    const heard = this.#heard.get(key) ?? { entries: [], pending: [] }
    heard.pending = texts.slice(0, 50)
    this.#heard.set(key, heard)
  }

  #session(reader: Reader): Promise<VoiceReadingSession | null> {
    if (reader.session !== null) return Promise.resolve(reader.session)
    if (reader.opening !== null) return reader.opening
    const { sellerId, broadcastId } = reader
    reader.opening = (async () => {
      try {
        let session: VoiceReadingSession | null = null
        const send = (message: unknown) => {
          if (reader.closed || session === null) return
          this.#onMessage(reader, session, message)
        }
        // 서버 읽기는 판매자 ID만 쓴다 (세션 쿠키·계정 없음)
        const context = { sellerId } as unknown as SessionContext
        session = await this.#o.reading({ session: context, broadcastId, device: SERVER_DEVICE, mode: 'livegenie', send })
        if (reader.closed) {
          session.close()
          return null
        }
        reader.session = session
        // 앱의 처음 인사와 같다: 동의함(방송 소리 듣기는 판매자가 켠 것), 설정은 앱 기본값, 문자찜 자동 보내기는 하지 않는다(사람이 확인할 일)
        await session.onMessage({ type: 'voice.session', op: 'hello', context: { now: this.#o.clock.now(), dialogOpen: false, smsAutoAllowed: false, consent: true, listening: true } })
        return session
      } catch {
        this.#o.log({ level: 'warn', code: 'STREAM_AUDIO_SERVER_READING_FAILED', seller: sellerId })
        return null
      } finally {
        reader.opening = null
      }
    })()
    return reader.opening
  }

  #onMessage(reader: Reader, session: VoiceReadingSession, message: unknown): void {
    if (!record(message)) return
    if (message.type === 'voice.state' && record(message.snapshot) && Array.isArray(message.snapshot.cards)) {
      const texts = message.snapshot.cards.flatMap((card: unknown) => (record(card) && typeof card.text === 'string' ? [card.text] : []))
      this.#pending(reader.sellerId, reader.broadcastId, texts)
      return
    }
    if (message.type !== 'voice.effect' || typeof message.method !== 'string' || typeof message.id !== 'number') return
    const id = message.id
    const args = Array.isArray(message.args) ? message.args : []
    if (message.method === 'register') {
      reader.work = reader.work.then(() => this.#register(reader, session, args)).catch(() => undefined)
      return
    }
    // 사람이 확인해야 할 쓰기(고치기·번호 바꾸기·문자찜): 하지 않고 기다리는 읽기에 "못 함"을 돌려준다
    if (message.method === 'fixRecent' || message.method === 'renumber' || message.method === 'writeSms') {
      this.#note(reader.sellerId, reader.broadcastId, { at: this.#o.clock.now(), kind: 'skipped' })
      void session.onMessage({ type: 'voice.session', op: 'effectResult', id, value: null })
    }
  }

  async #register(reader: Reader, session: VoiceReadingSession, args: readonly unknown[]): Promise<void> {
    const [card, registration, source, voiceLog] = args
    if (!record(registration) || typeof registration.no !== 'number' || typeof registration.name !== 'string' || typeof registration.price !== 'number') return
    const { no, name, price } = registration
    const at = this.#o.clock.now()
    const body: Record<string, unknown> = { type: 'product.register', b: reader.broadcastId, no, name, price, ...(record(voiceLog) ? { voiceLog } : {}) }
    try {
      const outcome = await this.#o.service.writeEvent(reader.sellerId, { kind: 'server' }, `voice-server-${randomUUID()}`, body, undefined)
      const result = outcome.kind === 'phone' ? outcome.outcome : outcome
      if (result.kind === 'ok' && result.result.changed) {
        this.#note(reader.sellerId, reader.broadcastId, { at, kind: 'registered', no, name, price })
        await session.onMessage({ type: 'voice.session', op: 'command', method: 'noteVoiceRegistered', args: [{ id: productKey(reader.broadcastId, no), no, name, price }] })
        return
      }
      this.#note(reader.sellerId, reader.broadcastId, { at, kind: result.kind === 'ok' ? 'exists' : 'failed', no, name, price })
      if (card !== undefined) await session.onMessage({ type: 'voice.session', op: 'command', method: source === 'instant' ? 'instantExists' : 'restore', args: source === 'instant' ? [card] : [card, { touched: true }] })
    } catch {
      this.#note(reader.sellerId, reader.broadcastId, { at, kind: 'failed', no, name, price })
    }
  }
}
