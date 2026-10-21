// 실행기 + Marklife 어댑터 — 30장 연속 (AC-N1-44, SPEC §8 2단계 "30장 연속", LBL-08, AC-P1-56). 가짜 Web Bluetooth 기기·주입 타이머로 돈다.
import { defaultTemplate, labelContentKey, renderProductLabel, type LabelSizeId, type ProductLabelData } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { describe, expect, it } from 'vitest'
import { MARKLIFE_P12, MARKLIFE_S2, buildPrintJob, createFakeBluetooth, createMarklifeAdapter, createPrintRunner, type JobRenderer, type ModelProfile, type NewJob } from '../src/index.ts'
import { ManualTimer } from './fakes.ts'

const env = createNodeRenderEnv()

function productJob(i: number): NewJob & { data: ProductLabelData } {
  const data: ProductLabelData = { no: 100 + i, name: `왕비뇌신금 ${String(i)}호`, price: 8000 + i * 1000, date: '2026-10-08', buyer: { kind: 'youtube', name: `구매자${String(i)}` } }
  const key = labelContentKey('product', data)
  if (!key.ok) throw new Error('내용 키')
  return { id: `effect-${String(i)}`, labelKey: `claim-${String(i)}@1`, kind: 'product', data, contentKey: key.key }
}

const rendererFor = (size: LabelSizeId): JobRenderer => {
  const template = { ...defaultTemplate('product', size), shopName: '다육농장' }
  return (job) => {
    const r = renderProductLabel(env, template, job.data)
    return r.ok ? { ok: true, image: r.image } : { ok: false, error: r.error }
  }
}

/** 조건이 맞을 때까지 타이머를 돌린다 */
async function until(timer: ManualTimer, done: () => boolean, maxMs = 3_600_000): Promise<void> {
  for (let t = 0; t < maxMs && !done(); t += 300) await timer.advance(300)
  expect(done()).toBe(true)
}

for (const [title, profile, name, size] of [
  ['S2(50×30)', MARKLIFE_S2, 'S2_1A2B_BLE', '50x30'],
  ['P12(테이프 12×40)', MARKLIFE_P12, 'P12_ZA15B', 'tape12x40'],
] as [string, ModelProfile, string, LabelSizeId][]) {
  describe(`실행기 + Marklife 어댑터 ${title} (AC-N1-44)`, () => {
    const render = rendererFor(size)
    const expectedBytes = (job: NewJob): Uint8Array => {
      const r = render({ ...job, status: 'WAITING', attempts: 0 } as never)
      if (!r.ok) throw new Error('렌더')
      const bytes = buildPrintJob(profile, r.image)
      if (!bytes.ok) throw new Error(bytes.code)
      return bytes.bytes
    }

    it('30장 중 12번째 출력 중 끊김 → 11장 뒤 멈춤(끊김), 12번째는 대기 맨 앞 → 다시 연결하면 이어서 30장, 넣은 순서, 작업 바이트와 같다', async () => {
      const timer = new ManualTimer()
      const fake = createFakeBluetooth({ name, timer, jobs: { 12: { disconnectAtPacket: 3 } } })
      const adapter = createMarklifeAdapter({ environment: () => fake.environment, timer })
      let tick = 0
      const runner = createPrintRunner({ adapter, render, clock: () => ++tick, device: '판매 PC' })
      expect((await adapter.connect('bluetooth')).ok).toBe(true)
      const jobs = Array.from({ length: 30 }, (_, i) => productJob(i + 1))
      for (const job of jobs) expect(runner.enqueue(job).accepted).toBe(true)
      await until(timer, () => runner.state.paused === 'DISCONNECTED')
      expect(fake.printed).toHaveLength(11)
      expect(adapter.state).toBe('DISCONNECTED')
      const waiting = runner.state.jobs.filter((j) => j.status === 'WAITING')
      expect(waiting[0]).toMatchObject({ id: 'effect-12', attempts: 1, lastError: 'DISCONNECTED' })
      expect(waiting).toHaveLength(19)

      expect((await adapter.connect('bluetooth')).ok).toBe(true)
      await until(timer, () => runner.state.jobs.every((j) => j.status === 'DONE'))
      await runner.idle()
      expect(runner.state.paused).toBeNull()
      expect(fake.printed).toHaveLength(30)
      fake.printed.forEach((bytes, i) => {
        expect(runner.state.jobs[i]?.id).toBe(`effect-${String(i + 1)}`)
        expect(Buffer.from(bytes).equals(Buffer.from(expectedBytes(jobs[i] as NewJob))), `${String(i + 1)}번째`).toBe(true)
      })
      // 12번째: 끊기기 전 조각(2개 — 3번째에서 끊김)과 다시 보낸 작업이 따로 기록된다
      expect(fake.attempts).toHaveLength(31)
      const broken = fake.attempts[11]
      expect(broken).toMatchObject({ complete: false, acked: false })
      expect(broken?.packets).toHaveLength(2)
      const twelfth = expectedBytes(jobs[11] as NewJob)
      expect(Buffer.from(broken?.bytes ?? []).equals(Buffer.from(twelfth.subarray(0, broken?.bytes.length)))).toBe(true)
      expect(fake.attempts[12]).toMatchObject({ complete: true, acked: true })
      expect(Buffer.from(fake.attempts[12]?.bytes ?? []).equals(Buffer.from(twelfth))).toBe(true)
      expect(runner.state.jobs[0]).toMatchObject({ device: '판매 PC', printedAt: expect.any(Number) as number })
      runner.dispose()
    })

    it('7번째 출력에 AA가 오지 않으면 그 작업은 TIMEOUT으로 대기 맨 앞에 남고 대기열은 프린터 오류 멈춤 — 출력함이 되지 않는다', async () => {
      const timer = new ManualTimer()
      const fake = createFakeBluetooth({ name, timer, jobs: { 7: { ack: 'none' } } })
      const adapter = createMarklifeAdapter({ environment: () => fake.environment, timer })
      const runner = createPrintRunner({ adapter, render, clock: () => 0, device: 'PC' })
      expect((await adapter.connect('bluetooth')).ok).toBe(true)
      for (let i = 1; i <= 10; i++) runner.enqueue(productJob(i))
      await until(timer, () => runner.state.paused === 'PRINTER_ERROR')
      expect(fake.printed).toHaveLength(6)
      const seventh = runner.state.jobs.find((j) => j.id === 'effect-7')
      expect(seventh).toMatchObject({ status: 'WAITING', attempts: 1, lastError: 'TIMEOUT' })
      expect(runner.state.jobs.filter((j) => j.status === 'WAITING')[0]?.id).toBe('effect-7')
      expect(runner.state.jobs.filter((j) => j.status === 'DONE')).toHaveLength(6)
      expect(adapter.state).toBe('CONNECTED')
      // 다시 시작하면 7번째부터 이어진다 (같은 라벨이 두 번 나올 수는 있어도 빠지지 않는다)
      runner.restart()
      await until(timer, () => runner.state.jobs.every((j) => j.status === 'DONE'))
      expect(fake.printed).toHaveLength(10)
      expect(fake.attempts).toHaveLength(11)
      runner.dispose()
    })
  })
}
