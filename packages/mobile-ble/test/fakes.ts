// 시험 도우미 — 가짜 B1 위의 가짜 Web Bluetooth 기기(웹 길과 바이트 비교용), 손으로 돌리는 타이머, 시험 그림.
import { createBitmap, setPixel, type LabelBitmap } from '@livejjim/label'
import type { PrinterTimer } from '@livejjim/printer'
import { FAKE_B1_CHARACTERISTIC, FAKE_B1_SERVICE, type FakeB1 } from '../src/index.ts'

export async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

/** 조건이 참이 될 때까지 실제 시간으로 기다린다 (가짜 B1이 setTimeout 0으로 답하므로 마이크로태스크만으로는 모자라다). 한도를 넘기면 예외 */
export async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('기다리던 조건이 되지 않았다')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

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

  /** 걸린 타이머의 남은 시간들 (이른 순) */
  get delays(): number[] {
    return [...this.tasks].sort((a, b) => a.at - b.at || a.id - b.id).map((t) => t.at - this.now)
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

/** 시험 그림: 테두리 + 대각선 + 씨앗으로 다른 점 (384×240 기본) */
export function sampleImage(seed = 1, width = 384, height = 240): LabelBitmap {
  const image = createBitmap(width, height)
  for (let x = 0; x < width; x++) {
    setPixel(image, x, 0, true)
    setPixel(image, x, height - 1, true)
    setPixel(image, x, Math.floor((x * height) / width), true)
  }
  for (let y = 0; y < height; y++) {
    setPixel(image, 0, y, true)
    setPixel(image, width - 1, y, true)
    setPixel(image, (y * 7 + seed * 13) % width, y, true)
  }
  return image
}

/**
 * 가짜 Web Bluetooth 기기 — niimbluelib NiimbotBluetoothClient.connect({ authorizedDevice })가 쓰는 모양만 (gatt.connect·getPrimaryServices·
 * getCharacteristics·properties·startNotifications·writeValueWithoutResponse·characteristicvaluechanged·gattserverdisconnected). 같은 가짜 B1에 닿는다.
 */
export function createFakeWebBluetoothDevice(printer: FakeB1, name = 'B1-WEB01') {
  const valueListeners = new Set<(event: { target: { value: DataView } }) => void>()
  let stopNotify: (() => void) | null = null
  let connected = false
  const characteristic = {
    uuid: FAKE_B1_CHARACTERISTIC,
    properties: { notify: true, writeWithoutResponse: true, write: false, read: false },
    addEventListener(type: string, listener: (event: { target: { value: DataView } }) => void) {
      if (type === 'characteristicvaluechanged') valueListeners.add(listener)
    },
    removeEventListener(type: string, listener: (event: { target: { value: DataView } }) => void) {
      if (type === 'characteristicvaluechanged') valueListeners.delete(listener)
    },
    async startNotifications() {
      stopNotify?.()
      stopNotify = printer.onNotify((bytes) => {
        const copy = bytes.slice()
        const value = new DataView(copy.buffer)
        for (const l of [...valueListeners]) l({ target: { value } })
      })
      return characteristic
    },
    async writeValueWithoutResponse(buffer: ArrayBuffer) {
      if (!connected) throw new Error('GATT Server is disconnected')
      printer.write(new Uint8Array(buffer))
    },
  }
  const service = { uuid: FAKE_B1_SERVICE, getCharacteristics: async () => [characteristic] }
  const server = {
    connected: false,
    async getPrimaryServices() {
      return [service]
    },
    disconnect() {
      connected = false
      stopNotify?.()
      stopNotify = null
    },
    async connect() {
      connected = true
      return server
    },
  }
  const device = {
    id: 'web-fake-b1',
    name,
    gatt: server,
    addEventListener() {},
    removeEventListener() {},
  }
  return device
}
