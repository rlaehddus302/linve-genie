// APP2 독립 통합 검증: 실제 서버 라벨 → native 전송 → 바이트를 해석한 B1.
import { describe, expect, it } from 'vitest'
import { createFakeBleTransport, createNativeB1Adapter } from '../../packages/mobile-ble/src/index.ts'
import { addSeller, createBroadcast, expectOk, newWorld } from '../../apps/server/test/support.ts'
import { DAY, DEVICE_A, chat, printApi, register } from '../../apps/server/test/print-support.ts'

describe('TD-APP2-01 실제 서버와 BLE 어댑터의 라벨 계약', () => {
  it('서버의 점을 그대로 출력하고 완료 뒤 같은 시도로 그림을 다시 받지 못한다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const broadcast = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, broadcast.id, 15, '핑크프릴', 20000)
    await chat(world, seller, broadcast.id, 'UC_LABEL', '홍길동', '15')
    const api = printApi(world, seller)
    await expectOk(api.register(DEVICE_A, '아이폰'))
    await expectOk(api.restart())
    const { job } = await api.claim(DEVICE_A)
    if (job === null) throw new Error('출력 작업이 없다')
    const url = `/api/print/jobs/${encodeURIComponent(job.id)}/bitmap?device=${DEVICE_A}&attempt=${job.attempt}`
    const body = (await expectOk(api.api.get(url))).body as unknown as { width: number; height: number; data: string }
    const image = { width: body.width, height: body.height, data: new Uint8Array(Buffer.from(body.data, 'base64')) }
    const fake = createFakeBleTransport()
    const adapter = createNativeB1Adapter({
      transport: fake.transport,
      pickDevice: async () => fake.device,
      client: { packetIntervalMs: 0 },
    })
    try {
      expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
      expect(await adapter.print(image)).toEqual({ ok: true })
      expect(fake.printer.printed).toHaveLength(1)
      const page = fake.printer.printed[0]!
      expect(page.cols).toBe(image.width)
      expect(page.rows).toBe(image.height + 1)
      expect(page.bitmap.subarray(0, image.data.length)).toEqual(image.data)
      expect([...page.bitmap.subarray(image.data.length)].every((value) => value === 0)).toBe(true)
      expect(await api.done(DEVICE_A, job.attempt)).toBe(true)
      expect(await api.done(DEVICE_A, job.attempt)).toBe(false)
      expect((await api.api.get(url)).status).toBe(404)
    } finally {
      await adapter.disconnect()
    }
  })
})
