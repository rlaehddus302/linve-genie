// 실행기 + 가짜 프린터 — 30장 연속 (AC-P1-56, SPEC §8 2단계 "상품 라벨 30장 연속 출력", LBL-06 AC2·LBL-08).
import { bitmapsEqual, createBitmap, defaultTemplate, labelContentKey, renderProductLabel, type LabelBitmap, type ProductLabelData } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { describe, expect, it } from 'vitest'
import { B1_PROFILE, StateBox, type ConnectionMethod, type ConnectionState, type PrinterAdapter } from '../src/adapter.ts'
import { OK, fail, type PrinterResult } from '../src/errors.ts'
import { createFakePrinter, createPrintRunner, createPrintQueue, enqueueJob, startNextJob, type JobRenderer, type NewJob } from '../src/index.ts'
import { ManualTimer, flush } from './fakes.ts'

const env = createNodeRenderEnv()
const template = { ...defaultTemplate('product'), shopName: '다육농장' }

const render: JobRenderer = (job) => {
  const r = renderProductLabel(env, template, job.data)
  return r.ok ? { ok: true, image: r.image } : { ok: false, error: r.error }
}

function productJob(i: number): NewJob & { data: ProductLabelData } {
  const data: ProductLabelData = { no: 100 + i, name: `왕비뇌신금 ${String(i)}호`, price: 8000 + i * 1000, date: '2026-10-08', buyer: { kind: 'youtube', name: `구매자${String(i)}` } }
  const key = labelContentKey('product', data)
  if (!key.ok) throw new Error('내용 키')
  return { id: `effect-${String(i)}`, labelKey: `claim-${String(i)}@1`, kind: 'product', data, contentKey: key.key }
}

describe('실행기 + 가짜 프린터 (AC-P1-56)', () => {
  it('30장 중 12번째 출력 중 끊김 → 11장 뒤 멈춤(끊김), 12번째는 대기 맨 앞 → 다시 연결하면 이어서 정확히 30장, 넣은 순서, 렌더 그림과 바이트까지 같다', async () => {
    const printer = createFakePrinter({ script: { 12: 'disconnect' } })
    let tick = 0
    const runner = createPrintRunner({ adapter: printer, render, clock: () => ++tick, device: '판매 PC' })
    expect((await printer.connect('bluetooth')).ok).toBe(true)
    const jobs = Array.from({ length: 30 }, (_, i) => productJob(i + 1))
    for (const job of jobs) expect(runner.enqueue(job).accepted).toBe(true)
    await runner.idle()
    await flush()
    expect(printer.printed).toHaveLength(11)
    expect(runner.state.paused).toBe('DISCONNECTED')
    expect(printer.state).toBe('DISCONNECTED')
    const waiting = runner.state.jobs.filter((j) => j.status === 'WAITING')
    expect(waiting[0]).toMatchObject({ id: 'effect-12', attempts: 1, lastError: 'DISCONNECTED' })
    expect(waiting).toHaveLength(19)
    // 같은 효과가 다시 와도 두 번 넣지 않는다
    expect(runner.enqueue(jobs[11] as NewJob).accepted).toBe(false)

    expect((await printer.connect('bluetooth')).ok).toBe(true)
    await runner.idle()
    await flush()
    expect(printer.printed).toHaveLength(30)
    expect(runner.state.paused).toBeNull()
    expect(runner.state.jobs.every((j) => j.status === 'DONE')).toBe(true)
    printer.printed.forEach((record, i) => {
      const expected = render({ ...(runner.state.jobs[i] as (typeof runner.state.jobs)[number]) })
      if (!expected.ok) throw new Error('렌더 실패')
      expect(bitmapsEqual(record.image, expected.image), `${String(i + 1)}번째`).toBe(true)
      expect(runner.state.jobs[i]?.id).toBe(`effect-${String(i + 1)}`)
    })
    // 같은 작업이 두 번 기록되지 않는다 — 그림마다 번호가 달라 모두 다르다
    for (let i = 0; i < 30; i++) for (let k = i + 1; k < 30; k++) expect(bitmapsEqual(printer.printed[i]?.image as never, printer.printed[k]?.image as never)).toBe(false)
    // 이력: 기기 이름과 주입한 시각
    expect(runner.state.jobs[0]).toMatchObject({ device: '판매 PC', printedAt: expect.any(Number) as number })
    expect(printer.printed.every((r) => r.density === 3)).toBe(true)
  })

  it('프린터 오류면 멈추고 다시 시작해야 이어진다', async () => {
    const printer = createFakePrinter({ script: { 2: 'fail' } })
    const runner = createPrintRunner({ adapter: printer, render, clock: () => 0, device: 'PC' })
    await printer.connect('bluetooth')
    for (let i = 1; i <= 3; i++) runner.enqueue(productJob(i))
    await runner.idle()
    expect(printer.printed).toHaveLength(1)
    expect(runner.state.paused).toBe('PRINTER_ERROR')
    expect(runner.state.jobs[1]).toMatchObject({ status: 'WAITING', lastError: 'PRINT_FAILED' })
    await flush()
    expect(printer.printed).toHaveLength(1)
    runner.restart()
    await runner.idle()
    expect(printer.printed).toHaveLength(3)
  })

  it('렌더할 수 없는 라벨(DOES_NOT_FIT)은 출력하지 않고 멈춘다(라벨 오류) — 판매자가 빼고 다시 시작하면 이어진다', async () => {
    const printer = createFakePrinter()
    const narrow = { ...template, items: { ...template.items, price: { ...template.items.price, width: 40 } } }
    const strict: JobRenderer = (job) => {
      const r = renderProductLabel(env, job.id === 'effect-2' ? narrow : template, job.data)
      return r.ok ? { ok: true, image: r.image } : { ok: false, error: r.error }
    }
    const runner = createPrintRunner({ adapter: printer, render: strict, clock: () => 0, device: 'PC' })
    await printer.connect('bluetooth')
    for (let i = 1; i <= 3; i++) runner.enqueue(productJob(i))
    await runner.idle()
    expect(printer.printed).toHaveLength(1)
    expect(runner.state.paused).toBe('LABEL_ERROR')
    expect(runner.state.jobs[1]).toMatchObject({ status: 'WAITING', lastError: 'DOES_NOT_FIT' })
    runner.cancel('effect-2')
    runner.restart()
    await runner.idle()
    expect(printer.printed).toHaveLength(2)
    expect(runner.state.jobs.map((j) => j.status)).toEqual(['DONE', 'CANCELLED', 'DONE'])
  })

  it('판매자 멈춤·폐기·재출력을 실행기로', async () => {
    const printer = createFakePrinter()
    const changes: number[] = []
    const runner = createPrintRunner({ adapter: printer, render, clock: () => 7, device: 'PC', onChange: (s) => changes.push(s.jobs.length) })
    runner.pause()
    await printer.connect('bluetooth')
    runner.enqueue(productJob(1))
    runner.enqueue(productJob(2))
    await runner.idle()
    expect(printer.printed).toHaveLength(0)
    runner.voidLabel('claim-2@1')
    runner.restart()
    await runner.idle()
    expect(printer.printed).toHaveLength(1)
    expect(runner.reprint({ ...productJob(1), id: 'reprint-1' }).accepted).toBe(true)
    await runner.idle()
    expect(printer.printed).toHaveLength(2)
    expect(runner.reprint({ ...productJob(2), id: 'reprint-2' }).accepted).toBe(false)
    expect(changes.length).toBeGreaterThan(0)
    runner.dispose()
  })

  it('저장해 둔 상태에 출력 중 작업이 있으면(앱이 출력 중에 닫힘) 대기 맨 앞으로 되돌려 다시 출력한다', async () => {
    let saved = enqueueJob(createPrintQueue(true), productJob(1), 0).state
    saved = startNextJob(saved).state
    saved = JSON.parse(JSON.stringify(saved)) as typeof saved
    const printer = createFakePrinter()
    await printer.connect('bluetooth')
    const runner = createPrintRunner({ adapter: printer, render, clock: () => 0, device: 'PC', initialState: saved })
    // 되돌린 뒤 연결돼 있으니 바로 다시 출력한다 (시도 1, 마지막 오류 끊김)
    await runner.idle()
    expect(runner.state.jobs[0]).toMatchObject({ status: 'DONE', attempts: 1, lastError: 'DISCONNECTED' })
    expect(printer.printed).toHaveLength(1)
  })
})

/** 알림과 결과의 순서를 손으로 정하는 어댑터 — print는 finish(결과)를 부를 때 끝난다 */
class ScriptedAdapter implements PrinterAdapter {
  readonly box = new StateBox()
  readonly profile = B1_PROFILE
  /** 끝까지 출력한 그림 (받은 순서) */
  readonly printed: LabelBitmap[] = []
  private pending: { image: LabelBitmap; resolve: (r: PrinterResult) => void } | undefined

  get state(): ConnectionState {
    return this.box.state
  }
  onStateChange(listener: (state: ConnectionState) => void): () => void {
    return this.box.listen(listener)
  }
  availableMethods(): ConnectionMethod[] {
    return ['bluetooth']
  }
  async connect(): Promise<PrinterResult> {
    this.box.set('CONNECTED')
    return OK
  }
  async disconnect(): Promise<void> {
    this.box.set('DISCONNECTED')
  }
  print(image: LabelBitmap): Promise<PrinterResult> {
    if (this.box.state !== 'CONNECTED') return Promise.resolve(fail('NOT_CONNECTED'))
    this.box.set('PRINTING')
    return new Promise((resolve) => {
      this.pending = { image, resolve }
    })
  }
  get printing(): boolean {
    return this.pending !== undefined
  }
  /** 출력 결과를 낸다 (ok면 기록). 상태는 출력 중일 때만 연결됨으로 되돌린다 */
  finish(result: PrinterResult): void {
    const p = this.pending
    if (!p) throw new Error('출력 중이 아니다')
    this.pending = undefined
    if (result.ok) this.printed.push(p.image)
    if (this.box.state === 'PRINTING') this.box.set('CONNECTED')
    p.resolve(result)
  }
}

describe('실행기 — 출력 결과와 끊김 알림의 순서 (SA-P1-003, L-8 1·3, D-P1-09)', () => {
  const images = new Map<string, LabelBitmap>()
  const tiny: JobRenderer = (job) => {
    let image = images.get(job.id)
    if (!image) {
      image = createBitmap(8, 8)
      images.set(job.id, image)
    }
    return { ok: true, image }
  }
  const idOf = (image: LabelBitmap): string => [...images].find(([, img]) => img === image)?.[0] ?? '?'
  const simple = (id: string): NewJob => ({ id, labelKey: `L-${id}`, kind: 'product', data: {}, contentKey: id })

  it('끊김 알림이 먼저 오고 결과가 ok(프린터가 끝났다고 알림)면 출력함 — 다시 연결해도 같은 라벨을 또 찍지 않는다', async () => {
    const adapter = new ScriptedAdapter()
    await adapter.connect()
    const runner = createPrintRunner({ adapter, render: tiny, clock: () => 5, device: 'PC' })
    runner.enqueue(simple('A1'))
    runner.enqueue(simple('A2'))
    await flush()
    expect(adapter.printing).toBe(true)
    adapter.box.set('DISCONNECTED') // 끊김 알림이 결과보다 먼저
    expect(runner.state).toMatchObject({ connected: false, paused: 'DISCONNECTED' })
    expect(runner.state.jobs[0]).toMatchObject({ id: 'A1', status: 'PRINTING', attempts: 0 })
    adapter.finish(OK)
    await runner.idle()
    await flush()
    expect(runner.state.jobs.map((j) => [j.id, j.status, j.attempts])).toEqual([
      ['A1', 'DONE', 0],
      ['A2', 'WAITING', 0],
    ])
    expect(runner.state.jobs[0]).toMatchObject({ printedAt: 5, device: 'PC' })
    expect(runner.state.paused).toBe('DISCONNECTED')
    expect(adapter.printing).toBe(false)
    await adapter.connect()
    await flush()
    adapter.finish(OK)
    await runner.idle()
    expect(adapter.printed.map(idOf)).toEqual(['A1', 'A2'])
    expect(runner.state.jobs.map((j) => j.status)).toEqual(['DONE', 'DONE'])
  })

  it('끊김 알림이 먼저 오고 결과가 끊김 실패면 그 작업은 대기 맨 앞(시도 1), 다시 연결되면 그 작업부터', async () => {
    const adapter = new ScriptedAdapter()
    await adapter.connect()
    const runner = createPrintRunner({ adapter, render: tiny, clock: () => 1, device: 'PC' })
    runner.enqueue(simple('B1'))
    runner.enqueue(simple('B2'))
    await flush()
    adapter.box.set('DISCONNECTED')
    adapter.finish(fail('DISCONNECTED'))
    await runner.idle()
    expect(runner.state.jobs[0]).toMatchObject({ id: 'B1', status: 'WAITING', attempts: 1, lastError: 'DISCONNECTED' })
    expect(runner.state.paused).toBe('DISCONNECTED')
    await adapter.connect()
    await flush()
    adapter.finish(OK)
    await flush()
    adapter.finish(OK)
    await runner.idle()
    expect(adapter.printed.map(idOf)).toEqual(['B1', 'B2'])
  })

  it('끊김 → 다시 연결 알림이 끊김 실패 결과보다 먼저 와도 대기열이 끊김으로 굳지 않고 그 작업부터 이어서 출력한다', async () => {
    const adapter = new ScriptedAdapter()
    await adapter.connect()
    const runner = createPrintRunner({ adapter, render: tiny, clock: () => 1, device: 'PC' })
    runner.enqueue(simple('C1'))
    runner.enqueue(simple('C2'))
    await flush()
    adapter.box.set('DISCONNECTED')
    adapter.box.set('CONNECTED') // 다시 연결됨 — 앞 출력의 결과는 아직
    adapter.finish(fail('DISCONNECTED'))
    await flush()
    expect(runner.state).toMatchObject({ connected: true, paused: null })
    expect(runner.state.jobs[0]).toMatchObject({ id: 'C1', status: 'PRINTING', attempts: 1, lastError: 'DISCONNECTED' })
    adapter.finish(OK)
    await flush()
    adapter.finish(OK)
    await runner.idle()
    expect(adapter.printed.map(idOf)).toEqual(['C1', 'C2'])
    expect(runner.state.jobs.map((j) => j.status)).toEqual(['DONE', 'DONE'])
  })

  it('가짜 프린터: 프린터가 끝났다고 알린 바로 그때(결과를 돌려주기 전) 끊겨도 같은 라벨이 기록에 두 번 남지 않는다', async () => {
    const timer = new ManualTimer()
    const printer = createFakePrinter({ timer, script: { 1: { delayMs: 10 } } })
    const runner = createPrintRunner({ adapter: printer, render, clock: () => 2, device: 'PC' })
    await printer.connect('bluetooth')
    for (let i = 1; i <= 3; i++) runner.enqueue(productJob(i))
    await flush()
    expect(printer.state).toBe('PRINTING')
    timer.fireNext(() => printer.simulateDisconnect())
    await runner.idle()
    await flush()
    expect(printer.state).toBe('DISCONNECTED')
    expect(printer.printed).toHaveLength(1)
    expect(runner.state.jobs.map((j) => [j.status, j.attempts])).toEqual([
      ['DONE', 0],
      ['WAITING', 0],
      ['WAITING', 0],
    ])
    expect(runner.state.paused).toBe('DISCONNECTED')
    await printer.connect('bluetooth')
    await runner.idle()
    await flush()
    expect(printer.printed).toHaveLength(3)
    runner.state.jobs.forEach((job, i) => {
      const expected = render(job)
      if (!expected.ok) throw new Error('렌더 실패')
      expect(bitmapsEqual(printer.printed[i]?.image as LabelBitmap, expected.image), job.id).toBe(true)
    })
    expect(runner.state.jobs.map((j) => j.status)).toEqual(['DONE', 'DONE', 'DONE'])
  })
})
