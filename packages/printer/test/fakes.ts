// 시험용 가짜 niimbluelib 클라이언트·손으로 돌리는 타이머·인쇄 그림 풀기.
import type { EncodedImage } from '@mmote/niimbluelib'
import { createBitmap, setPixel, type LabelBitmap } from '@livejjim/label'
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

  async printEnd(): Promise<boolean> {
    this.ended++
    return true
  }
}

/** niimbluelib 클라이언트 흉내 — 받은 인쇄 작업과 그림을 기록한다 */
export class FakeNiimbotClient implements NiimbotClientLike {
  connected = false
  model: string | undefined = 'B1'
  connectError: unknown
  autoFinish = true
  failOn: 'init' | 'page' | undefined
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
