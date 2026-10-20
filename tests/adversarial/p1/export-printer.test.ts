// P1 적대 테스트 (test-domain): 내보내기·프린터 공격 (AC-P1-72, AC-P1-30~32·42~44·56, L-6·L-7).
// - PNG·PDF: 크기 세 가지의 점 수·쪽 수·바이트 결정성, A4 장 수 경계(24·25·48·49장 꼴), 섞인 크기, 빈 목록
//   PDF는 pdf-lib 없이(루트에서 못 읽는다) 바이트를 직접 읽는다: 쪽마다 MediaBox·Do 수, 그림은 node:zlib으로 풀어 라벨 바이트와 대조
// - B1: 폭 385점, 농도 경계, 출력 중 끊김·오류·지연이 겹친 가짜 클라이언트
// - 가짜 프린터·실행기: 끝난 직후 끊김
import { inflateSync } from 'node:zlib'
import { bitmapsEqual, createA4Pdf, createBitmap, createLabelPdf, encodeLabelPng, labelSizeInfo, setPixel, type LabelBitmap, type LabelSizeId } from '@livejjim/label'
import {
  createB1Adapter,
  createFakePrinter,
  createPrintRunner,
  type JobRenderer,
  type NiimbotClientLike,
  type NiimbotPrintTaskLike,
  type PrinterTimer,
} from '@livejjim/printer'
import { describe, expect, it } from 'vitest'

type B1SizeId = '50x30' | '50x20' | '50x40'
const SIZES: readonly B1SizeId[] = ['50x30', '50x20', '50x40']
const A4_PER_PAGE: Record<B1SizeId, number> = { '50x30': 24, '50x20': 36, '50x40': 18 }

function pattern(size: LabelSizeId, seed: number): LabelBitmap {
  const { widthDots, heightDots } = labelSizeInfo(size)
  const image = createBitmap(widthDots, heightDots)
  for (let y = 0; y < heightDots; y++) for (let x = 0; x < widthDots; x++) if ((x * 3 + y * 5 + seed) % 7 === 0) setPixel(image, x, y, true)
  return image
}

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1')

/** 이 PDF 작성기는 내용 스트림을 압축하지 않는다 — 쪽 객체·내용·그림 스트림을 글로 읽는다 */
function readPdf(bytes: Uint8Array): { pages: { mediaBox: number[]; draws: number; cutBoxes: number }[]; images: Uint8Array[] } {
  const text = latin1(bytes)
  const objects = new Map<number, { dict: string; stream?: Buffer }>()
  const re = /(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const body = m[2] as string
    const s = body.indexOf('\nstream\n')
    if (s < 0) objects.set(Number(m[1]), { dict: body })
    else {
      const start = m.index + (m[0].indexOf('\nstream\n') + 8)
      const len = Number(/\/Length (\d+)/.exec(body)?.[1])
      objects.set(Number(m[1]), { dict: body.slice(0, s), stream: Buffer.from(bytes.subarray(start, start + len)) })
    }
  }
  const pagesObj = [...objects.values()].find((o) => o.dict.includes('/Type /Pages'))
  const kids = [...(pagesObj?.dict.matchAll(/(\d+) 0 R/g) ?? [])].map((k) => Number(k[1]))
  const pages = kids.map((id) => {
    const page = objects.get(id)?.dict ?? ''
    const mediaBox = (/\/MediaBox \[([^\]]+)\]/.exec(page)?.[1] ?? '').trim().split(/\s+/).map(Number)
    const contentId = Number(/\/Contents (\d+) 0 R/.exec(page)?.[1])
    const content = objects.get(contentId)?.stream?.toString('latin1') ?? ''
    return { mediaBox, draws: (content.match(/ Do Q/g) ?? []).length, cutBoxes: (content.match(/ re S/g) ?? []).length }
  })
  const images = [...objects.values()].filter((o) => o.dict.includes('/Subtype /Image')).map((o) => new Uint8Array(inflateSync(o.stream as Buffer)))
  return { pages, images }
}

describe('PNG (AC-P1-72·30)', () => {
  it.each(SIZES)('%s: 점 수·결정성, 다시 풀면 라벨 바이트(뒤집힘)와 같다', (size) => {
    const image = pattern(size, 3)
    const a = encodeLabelPng(image)
    const b = encodeLabelPng(pattern(size, 3))
    if (!a.ok || !b.ok) throw new Error('PNG 실패')
    expect(latin1(a.bytes)).toBe(latin1(b.bytes))
    const view = new DataView(a.bytes.buffer, a.bytes.byteOffset)
    expect([view.getUint32(16), view.getUint32(20), a.bytes[24], a.bytes[25]]).toEqual([image.width, image.height, 1, 0])
    // IDAT 풀기 → 줄마다 필터 0 + 뒤집힌 라벨 바이트
    const text = latin1(a.bytes)
    const at = text.indexOf('IDAT')
    const len = view.getUint32(at - 4)
    const raw = inflateSync(Buffer.from(a.bytes.subarray(at + 4, at + 4 + len)))
    const row = image.width / 8
    for (let y = 0; y < image.height; y++) {
      expect(raw[y * (row + 1)]).toBe(0)
      for (let i = 0; i < row; i++) expect(raw[y * (row + 1) + 1 + i]).toBe(~(image.data[y * row + i] as number) & 0xff)
    }
  })

  it('형식이 아닌 그림은 PNG를 만들지 않는다', () => {
    expect(encodeLabelPng({ width: 384, height: 240, data: new Uint8Array(10) }).ok).toBe(false)
  })
})

describe('라벨 크기 PDF (AC-P1-72·31)', () => {
  it.each(SIZES)('%s: 쪽 수 = 그림 수, 쪽 크기, 그림은 원래 바이트 그대로, 두 번 만들면 같은 바이트', (size) => {
    const images = [pattern(size, 1), pattern(size, 2), pattern(size, 3)]
    const pdf = createLabelPdf(images)
    const again = createLabelPdf([pattern(size, 1), pattern(size, 2), pattern(size, 3)])
    if (!pdf.ok || !again.ok) throw new Error('PDF 실패')
    expect(latin1(pdf.bytes)).toBe(latin1(again.bytes))
    const read = readPdf(pdf.bytes)
    const info = labelSizeInfo(size)
    expect(read.pages).toHaveLength(3)
    for (const page of read.pages) {
      expect(page.mediaBox[2]).toBeCloseTo((info.widthMm * 72) / 25.4, 2)
      expect(page.mediaBox[3]).toBeCloseTo((info.heightMm * 72) / 25.4, 2)
      expect(page.draws).toBe(1)
    }
    read.images.forEach((data, i) => expect(Buffer.from(data).equals(Buffer.from((images[i] as LabelBitmap).data))).toBe(true))
    // 문서 정보(만든 시각·작성자·제목)가 없다
    expect(latin1(pdf.bytes)).not.toMatch(/\/Info|\/CreationDate|\/ModDate|\/Author|\/Title|\/Producer/)
  })
})

describe('A4 모아찍기 PDF 장 수 경계 (AC-P1-72·32)', () => {
  for (const size of SIZES) {
    const per = A4_PER_PAGE[size]
    it.each([per, per + 1, 2 * per, 2 * per + 1])(`${size}: %i장`, (n) => {
      const images = Array.from({ length: n }, (_, i) => pattern(size, i))
      const pdf = createA4Pdf(images)
      if (!pdf.ok) throw new Error('PDF 실패')
      const read = readPdf(pdf.bytes)
      const expectedPages = Math.ceil(n / per)
      expect(pdf.pages).toBe(expectedPages)
      expect(read.pages).toHaveLength(expectedPages)
      read.pages.forEach((page, p) => {
        const onPage = Math.min(per, n - p * per)
        expect(page.draws).toBe(onPage)
        expect(page.cutBoxes).toBe(onPage)
        expect(page.mediaBox[2]).toBeCloseTo(595.28, 1)
        expect(page.mediaBox[3]).toBeCloseTo(841.89, 1)
      })
      // 넣은 그림이 순서대로, 빠짐·겹침 없이 들어 있다
      expect(read.images).toHaveLength(n)
      read.images.forEach((data, i) => expect(Buffer.from(data).equals(Buffer.from((images[i] as LabelBitmap).data)), `${String(i)}번째`).toBe(true))
    })
  }

  it('크기가 섞이면(첫 장·가운데·끝 어디든) PDF를 만들지 않는다, 빈 목록도 오류', () => {
    const a = pattern('50x30', 1)
    const b = pattern('50x20', 1)
    for (const list of [[b, a, a], [a, b, a], [a, a, a, a, b]]) {
      for (const make of [createA4Pdf, createLabelPdf]) {
        const r = make(list)
        expect(r.ok).toBe(false)
        if (!r.ok) {
          expect(r.error.code).toBe('MIXED_SIZES')
          expect(r.error.message).toMatch(/[가-힣]/)
        }
      }
    }
    expect(createA4Pdf([]).ok).toBe(false)
    expect(createLabelPdf([]).ok).toBe(false)
    // 목록 밖 크기(384×200)도 넣지 않는다
    expect(createA4Pdf([createBitmap(384, 200)]).ok).toBe(false)
  })
})

// ---- 프린터 ----

const noTimer: PrinterTimer = { setTimeout: () => 0, clearTimeout: () => undefined }
const flush = async (n = 40): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}
const BT = { bluetooth: { requestDevice: (): undefined => undefined } }

/** 단계마다 손으로 풀어 주는 가짜 niimbluelib 클라이언트 (끊김·오류를 원하는 순간에 낸다) */
class GatedClient implements NiimbotClientLike {
  connected = false
  readonly listeners = new Set<() => void>()
  finished = false
  ended = 0
  endGate: (() => void) | undefined
  waitGate: { resolve: () => void; reject: (e: unknown) => void } | undefined
  holdFinish = false
  holdEnd = false
  readonly densities: number[] = []
  readonly protocol = {
    newPrintTask: (_name: string, options: { density: number }): NiimbotPrintTaskLike => {
      this.densities.push(options.density)
      return {
        printInit: async () => undefined,
        printPage: async () => undefined,
        waitForFinished: () =>
          this.holdFinish
            ? new Promise<void>((resolve, reject) => {
                this.waitGate = {
                  resolve: () => {
                    this.finished = true
                    resolve()
                  },
                  reject,
                }
              })
            : Promise.resolve().then(() => {
                this.finished = true
              }),
        printEnd: () => {
          this.ended++
          return this.holdEnd ? new Promise<boolean>((res) => (this.endGate = () => res(true))) : Promise.resolve(true)
        },
      }
    },
  }
  async connect(): Promise<unknown> {
    this.connected = true
    return {}
  }
  async disconnect(): Promise<void> {
    this.connected = false
  }
  isConnected(): boolean {
    return this.connected
  }
  getModelMetadata(): { model: string } {
    return { model: 'B1' }
  }
  on(_e: 'disconnect', l: () => void): unknown {
    this.listeners.add(l)
    return this
  }
  off(_e: 'disconnect', l: () => void): unknown {
    this.listeners.delete(l)
    return this
  }
  drop(): void {
    this.connected = false
    for (const l of [...this.listeners]) l()
  }
}

async function connectedB1(client = new GatedClient()) {
  const adapter = createB1Adapter({ environment: () => BT, createClient: () => client, timer: noTimer })
  expect((await adapter.connect('bluetooth')).ok).toBe(true)
  return { adapter, client }
}

describe('B1 어댑터 경계 (AC-P1-72·42·43)', () => {
  it('폭 385점은 보내지 않고 IMAGE_TOO_WIDE, 384점은 보낸다', async () => {
    const { adapter, client } = await connectedB1()
    const wide = await adapter.print(createBitmap(385, 240))
    expect(wide.ok ? null : wide.error.code).toBe('IMAGE_TOO_WIDE')
    expect(client.densities).toHaveLength(0)
    expect((await adapter.print(createBitmap(384, 240))).ok).toBe(true)
    expect(adapter.state).toBe('CONNECTED')
  })

  it('농도 1·5는 그대로, 0·6·2.5·NaN·-1은 보내지 않는다', async () => {
    const { adapter, client } = await connectedB1()
    for (const d of [1, 5]) expect((await adapter.print(createBitmap(384, 240), { density: d })).ok).toBe(true)
    for (const d of [0, 6, 2.5, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const r = await adapter.print(createBitmap(384, 240), { density: d })
      expect(r.ok, String(d)).toBe(false)
    }
    expect(client.densities).toEqual([1, 5])
    expect(adapter.state).toBe('CONNECTED')
  })

  it('프린터가 끝났다고 알리기 전에 끊기면 DISCONNECTED, 상태도 끊김', async () => {
    const client = new GatedClient()
    client.holdFinish = true
    const { adapter } = await connectedB1(client)
    const p = adapter.print(createBitmap(384, 240))
    await flush()
    client.drop()
    const r = await p
    expect(r.ok ? null : r.error.code).toBe('DISCONNECTED')
    expect(adapter.state).toBe('DISCONNECTED')
  })

  it('끊김 알림과 프린터 오류 예외가 겹쳐도(예외가 먼저) DISCONNECTED 한 번, 다음 출력은 NOT_CONNECTED', async () => {
    const client = new GatedClient()
    client.holdFinish = true
    const { adapter } = await connectedB1(client)
    const states: string[] = []
    adapter.onStateChange((s) => states.push(s))
    const p = adapter.print(createBitmap(384, 240))
    await flush()
    client.connected = false
    client.waitGate?.reject(new Error('PrintError'))
    client.drop()
    const r = await p
    expect(r.ok ? null : r.error.code).toBe('DISCONNECTED')
    expect(states.filter((s) => s === 'DISCONNECTED')).toHaveLength(1)
    const next = await adapter.print(createBitmap(384, 240))
    expect(next.ok ? null : next.error.code).toBe('NOT_CONNECTED')
  })

  it('TD-P1-001: 프린터가 끝났다고 알린 뒤(라벨이 나옴) 끝냄 알림(printEnd) 도중 끊겨도 그 출력은 실패가 아니다 — 대기열이 같은 라벨을 다시 찍지 않게', async () => {
    // niimbot.ts는 "끝냄 알림 — 라벨은 이미 나왔으니 이 알림의 실패는 출력 실패로 보지 않는다"고 적었지만,
    // printEnd를 기다리는 동안 온 끊김 알림은 interruptPrint로 DISCONNECTED를 돌려준다 → 실행기가 그 작업을 대기 맨 앞으로 되돌려
    // 다시 연결하면 같은 라벨을 한 장 더 찍는다(AC-P1-42 "출력은 프린터가 끝났다고 알린 뒤에 끝난다", L-8 1 "같은 효과가 두 번 출력되지 않게").
    const client = new GatedClient()
    client.holdEnd = true
    const { adapter } = await connectedB1(client)
    const p = adapter.print(createBitmap(384, 240))
    await flush()
    expect(client.finished).toBe(true)
    expect(client.endGate).toBeDefined()
    client.drop() // printEnd 응답 전에 블루투스가 끊긴다 (전원을 끔·거리)
    const r = await p
    expect(r).toEqual({ ok: true })
    expect(adapter.state).toBe('DISCONNECTED')
  })
})

describe('가짜 프린터·실행기 — 끝난 직후 끊김 (AC-P1-72·44·56)', () => {
  it('TD-P1-002: 가짜 프린터는 출력이 끝난 직후(결과를 돌려주기 전) 끊기면 상태를 CONNECTED로 되돌리지 않는다', async () => {
    // fake.ts print: outcome 'done'이 정해진 뒤 simulateDisconnect가 오면 box가 DISCONNECTED가 되지만,
    // 이어서 box.set('CONNECTED')로 덮어써 끊긴 프린터가 "연결됨"이 된다(B1 어댑터와 다른 동작 — 같은 계약 위반).
    const printer = createFakePrinter()
    await printer.connect('bluetooth')
    const p = printer.print(createBitmap(384, 240))
    await Promise.resolve() // 지연 0 출력이 끝남(결과 확정) — 아직 print의 await 뒤는 돌지 않았다
    printer.simulateDisconnect()
    await p
    expect(printer.state).toBe('DISCONNECTED')
  })

  it('TD-P1-002: 실행기 + 가짜 프린터 — 끝난 직후 끊겨도 같은 작업이 가짜 프린터 기록에 두 번 남지 않는다', async () => {
    const printer = createFakePrinter()
    const images = [1, 2, 3].map((i) => {
      const img = createBitmap(384, 240)
      setPixel(img, i, i, true)
      return img
    })
    const render: JobRenderer = (job) => ({ ok: true, image: images[Number(job.id.slice(1)) - 1] as LabelBitmap })
    const runner = createPrintRunner({ adapter: printer, render, clock: () => 1, device: 'PC' })
    await printer.connect('bluetooth')
    // 첫 장의 결과가 정해진 바로 그 순간에 끊기게: 가짜 프린터의 상태 알림을 보고 PRINTING이 된 뒤 한 틱 뒤에 끊는다
    let dropped = false
    printer.onStateChange((s) => {
      if (s === 'PRINTING' && !dropped) {
        dropped = true
        queueMicrotask(() => queueMicrotask(() => printer.simulateDisconnect()))
      }
    })
    for (const i of [1, 2, 3]) runner.enqueue({ id: `J${String(i)}`, labelKey: `L${String(i)}`, kind: 'product', data: {}, contentKey: `c${String(i)}` })
    await runner.idle()
    await flush()
    if (printer.state !== 'CONNECTED') await printer.connect('bluetooth')
    await runner.idle()
    await flush()
    const order = printer.printed.map((r) => images.findIndex((img) => bitmapsEqual(img, r.image)) + 1)
    expect(order).toEqual([1, 2, 3])
    expect(runner.state.jobs.map((j) => j.status)).toEqual(['DONE', 'DONE', 'DONE'])
  })
})
