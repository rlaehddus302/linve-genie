// N4b AC-N4b-02 성능: 구매자 100명(품목 합 500개) 범위의 전원 이미지 묶음(ZIP)을 30초 안에 (AC-P2-24와 같은 기준). `pnpm perf`가 돌린다 (D-902)
import { describe, expect, it } from 'vitest'
import { getFile } from './i2-support.ts'
import { readZip } from './n4b-support.ts'
import { addSeller, createBroadcast, newWorld } from './support.ts'

describe('AC-N4b-02 전원 이미지 묶음 성능', () => {
  it('구매자 100명·품목 500개 → ZIP 응답이 30초 안, JPG 100개', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: '2026-10-19' })
    await world.server.writer.write({
      sellerId: seller.sellerId,
      date: '2026-10-19',
      rehearsal: false,
      createScope: false,
      requestId: null,
      build: () => {
        const drafts = []
        for (let no = 1; no <= 500; no++) {
          drafts.push({ fields: { type: 'product.register', b: b.id, no, name: `품종${String(no % 37)}`, price: 1000 + no * 10 }, actor: { kind: 'server' } as const })
          drafts.push({
            fields: { type: 'chat', b: b.id, id: `p${String(no)}`, ch: `UC_${String(Math.floor((no - 1) / 5)).padStart(3, '0')}`, nick: `구매자${String(Math.floor((no - 1) / 5))}`, text: String(no) },
            actor: { kind: 'collector' } as const,
            chat: { b: b.id, id: `p${String(no)}` },
          })
        }
        return drafts
      },
    })
    const started = performance.now()
    const file = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.zip')
    const elapsed = performance.now() - started
    expect(file.status).toBe(200)
    expect(file.headers.get('x-receipt-count')).toBe('100')
    expect(readZip(file.bytes)).toHaveLength(100)
    expect(elapsed).toBeLessThan(30_000)
  }, 120_000)
})
