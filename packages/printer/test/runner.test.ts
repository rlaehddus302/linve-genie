// 실행기 + 가짜 프린터 — 30장 연속 (AC-P1-56, SPEC §8 2단계 "상품 라벨 30장 연속 출력", LBL-06 AC2·LBL-08).
import { bitmapsEqual, defaultTemplate, labelContentKey, renderProductLabel, type ProductLabelData } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { describe, expect, it } from 'vitest'
import { createFakePrinter, createPrintRunner, createPrintQueue, enqueueJob, startNextJob, type JobRenderer, type NewJob } from '../src/index.ts'
import { flush } from './fakes.ts'

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
