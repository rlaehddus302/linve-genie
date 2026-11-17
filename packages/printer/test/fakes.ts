// 시험용 가짜 niimbluelib 클라이언트·손으로 돌리는 타이머·인쇄 그림 풀기·Marklife 작업 바이트 풀기.
import { inflateSync } from 'node:zlib'
import { PrintError, type EncodedImage } from '@mmote/niimbluelib'
import { createBitmap, getPixel, setPixel, type LabelBitmap } from '@livejjim/label'
import type { NiimbotClientLike, NiimbotPrintTaskLike, NiimbotTaskOptions, PrinterTimer } from '../src/index.ts'

/** 손으로 돌리는 타이머 — 시각을 읽지 않는다 */
export class ManualTimer implements PrinterTimer {
  now = 0
  private nextId = 1
  private tasks: { id: number; at: number; fn: () => void }[] = []

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++
    this.tasks.push({ id, at: this.now + ms, fn })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((t) => t.id !== handle)
  }

  get pending(): number {
    return this.tasks.length
  }

  /** 가장 이른 타이머 하나를 바로 돌리고, 마이크로태스크를 비우지 않은 채 then을 부른다 (결과가 정해진 직후를 흉내) */
  fireNext(then?: () => void): void {
    const due = [...this.tasks].sort((a, b) => a.at - b.at || a.id - b.id)[0]
    if (!due) throw new Error('돌릴 타이머가 없다')
    this.tasks = this.tasks.filter((t) => t !== due)
    this.now = due.at
    due.fn()
    then?.()
  }

  async advance(ms: number): Promise<void> {
    const target = this.now + ms
    for (;;) {
      await flush()
      const due = this.tasks.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) break
      this.tasks = this.tasks.filter((t) => t !== due)
      this.now = due.at
      due.fn()
    }
    this.now = target
    await flush()
  }
}

/** 마이크로태스크를 넉넉히 비운다 */
export async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export class FakeTask implements NiimbotPrintTaskLike {
  readonly pages: { image: EncodedImage; quantity: number | undefined }[] = []
  inited = false
  ended = 0
  readonly finished = deferred()
  private readonly client: FakeNiimbotClient
  readonly name: string
  readonly options: NiimbotTaskOptions

  constructor(client: FakeNiimbotClient, name: string, options: NiimbotTaskOptions) {
    this.client = client
    this.name = name
    this.options = options
  }

  async printInit(): Promise<void> {
    if (this.client.failOn === 'init') throw new Error('PrintError: 프린터 오류 상태')
    this.inited = true
  }

  async printPage(image: EncodedImage, quantity?: number): Promise<void> {
    if (this.client.failOn === 'page' && this.client.printErrorReason !== undefined) {
      // niimbluelib이 프린터 오류 패킷(In_PrintError)을 받았을 때 던지는 그 예외
      throw new PrintError(`Print error ${String(this.client.printErrorReason)}`, this.client.printErrorReason)
    }
    if (this.client.failOn === 'page') throw Object.assign(new Error('Print error 3: 덮개 열림'), { name: 'PrintError' })
    this.pages.push({ image, quantity })
  }

  /** 프린터가 끝났다고 알렸다 */
  done = false

  finish(): void {
    this.done = true
    this.finished.resolve()
  }

  waitForFinished(): Promise<void> {
    if (this.client.autoFinish) this.finish()
    return this.finished.promise
  }

  /** 끝냄 알림의 응답을 붙잡아 두었으면 그 응답을 낸다 */
  releaseEnd: ((ok: boolean) => void) | undefined

  printEnd(): Promise<boolean> {
    this.ended++
    if (!this.client.holdEnd) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      this.releaseEnd = resolve
    })
  }
}

/** niimbluelib 클라이언트 흉내 — 받은 인쇄 작업과 그림을 기록한다 */
export class FakeNiimbotClient implements NiimbotClientLike {
  connected = false
  model: string | undefined = 'B1'
  connectError: unknown
  autoFinish = true
  /** 끝냄 알림(printEnd)의 응답을 붙잡아 둔다 — 프린터가 끝났다고 알린 뒤 응답 전에 끊기는 경우 */
  holdEnd = false
  failOn: 'init' | 'page' | undefined
  /** failOn 'page'일 때 niimbluelib PrintError(reasonId = 이 번호)를 던진다 — 없으면 까닭 없는 예외 */
  printErrorReason: number | undefined
  disconnectCalls = 0
  readonly tasks: FakeTask[] = []
  private readonly listeners = new Set<() => void>()

  readonly protocol = {
    newPrintTask: (name: string, options: NiimbotTaskOptions): NiimbotPrintTaskLike => {
      const task = new FakeTask(this, name, options)
      this.tasks.push(task)
      return task
    },
  }

  async connect(): Promise<unknown> {
    if (this.connectError !== undefined) throw this.connectError
    this.connected = true
    return { result: 1 }
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls++
    this.connected = false
    for (const l of [...this.listeners]) l()
  }

  isConnected(): boolean {
    return this.connected
  }

  getModelMetadata(): { model: string } | undefined {
    return this.connected && this.model !== undefined ? { model: this.model } : undefined
  }

  on(_event: 'disconnect', listener: () => void): unknown {
    this.listeners.add(listener)
    return this
  }

  off(_event: 'disconnect', listener: () => void): unknown {
    this.listeners.delete(listener)
    return this
  }

  /** 프린터 쪽에서 끊긴다 (블루투스 GATT 끊김 알림) */
  emitDisconnect(): void {
    this.connected = false
    for (const l of [...this.listeners]) l()
  }

  get listenerCount(): number {
    return this.listeners.size
  }
}

/** niimbluelib 인쇄 그림 → 1비트 그림 (확인용) */
export function decodeEncoded(image: EncodedImage, width: number): LabelBitmap {
  const out = createBitmap(width, image.rows)
  let y = 0
  for (const row of image.rowsData) {
    if (row.dataType === 'check') continue
    for (let r = 0; r < row.repeat; r++) {
      if (row.dataType === 'pixels' && row.rowDataBlack) {
        for (let x = 0; x < width; x++) {
          const byte = row.rowDataBlack[x >> 3] ?? 0
          if (byte & (0x80 >> (x & 7))) setPixel(out, x, y, true)
        }
      }
      y++
    }
  }
  if (y !== image.rows) throw new Error(`줄 수가 맞지 않다: ${String(y)} ≠ ${String(image.rows)}`)
  return out
}

/** 시험용 그림 (결정적 무늬) */
export function sampleImage(seed = 1, width = 384, height = 240): LabelBitmap {
  const image = createBitmap(width, height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if ((x * 7 + y * 13 + seed) % 11 === 0) setPixel(image, x, y, true)
  return image
}

/**
 * 짧은 지연(autoBelowMs 미만 — 조각 사이 30ms 등)은 마이크로태스크로 바로 돌리고, 긴 지연(1초 크레딧 기다림·시간 초과·늦은 끝 알림)은
 * 손으로 돌릴 때까지 붙잡아 두는 타이머. 어댑터 계약 묶음(contract.test.ts)이 Marklife 어댑터를 B1과 같은 시험으로 돌릴 때 쓴다 —
 * 조각 간격의 정확한 시간은 marklife.test.ts가 ManualTimer로 따로 본다. 시각을 읽지 않는다.
 */
export class PacedTimer extends ManualTimer {
  private readonly autoBelowMs: number
  private readonly quick = new Map<number, boolean>()
  private quickId = 1_000_000

  constructor(autoBelowMs = 1000) {
    super()
    this.autoBelowMs = autoBelowMs
  }

  override setTimeout(fn: () => void, ms: number): unknown {
    if (ms >= this.autoBelowMs) return super.setTimeout(fn, ms)
    const id = this.quickId++
    this.quick.set(id, true)
    queueMicrotask(() => {
      if (!this.quick.delete(id)) return
      fn()
    })
    return id
  }

  override clearTimeout(handle: unknown): void {
    if (typeof handle === 'number' && this.quick.delete(handle)) return
    super.clearTimeout(handle)
  }

  override get pending(): number {
    return super.pending + this.quick.size
  }
}

/** Marklife 작업 바이트 → 받은 그림 (확인용 — YXQ는 node:zlib 창 10으로 풀고, CW90은 되돌린다). 폭이 8의 배수인 그림만 그대로 되돌린다 */
export function decodeMarklifeJob(bytes: Uint8Array, profile: { readonly protocol: string; readonly rotate: string }): LabelBitmap {
  let widthBytes: number
  let height: number
  let rows: Uint8Array
  if (profile.protocol === 'MARKLIFE_L11' || profile.protocol === 'LUCKJINGLE') {
    // 래스터 머리 자리는 둘 다 19 (L11 00×15 + 시작 4 · Luck Jingle 켜기 4 + 깨우기 12 + 위치 맞춤 시작 3)
    const at = 19
    widthBytes = (bytes[at + 4] as number) | ((bytes[at + 5] as number) << 8)
    height = (bytes[at + 6] as number) | ((bytes[at + 7] as number) << 8)
    rows = bytes.slice(at + 8, at + 8 + widthBytes * height)
  } else {
    const at = profile.protocol === 'MARKLIFE_YXQ2' ? 8 : 21
    widthBytes = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number)
    height = ((bytes[at + 4] as number) << 8) | (bytes[at + 5] as number)
    const length = (((bytes[at + 6] as number) << 24) | ((bytes[at + 7] as number) << 16) | ((bytes[at + 8] as number) << 8) | (bytes[at + 9] as number)) >>> 0
    rows = new Uint8Array(inflateSync(bytes.subarray(at + 10, at + 10 + length), { windowBits: 10 }))
  }
  const sent: LabelBitmap = { width: widthBytes * 8, height, data: rows }
  if (profile.rotate !== 'CW90') return sent
  // 보낸 그림 (rx, ry) = 받은 그림 (ry, H−1−rx) → 받은 그림 (x, y) = 보낸 그림 (H−1−y, x)
  const W = height
  const H = widthBytes * 8
  const out = createBitmap(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (getPixel(sent, H - 1 - y, x)) setPixel(out, x, y, true)
  return out
}
