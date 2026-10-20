// AC-I2-34 라벨 데이터가 형식 검사(INVALID_DATA)에 걸리면 파일 없이 오류 + 경보(개인정보 없이).
// 실제 데이터는 형식 검사를 통과하므로 라벨 패키지의 그리기 함수만 바꿔 끼운 가짜로 INVALID_DATA를 만든다.
import type * as Label from '@livejjim/label'
import { describe, expect, it, vi } from 'vitest'

const broken = vi.hoisted(() => ({ on: false }))

vi.mock('@livejjim/label', async (importOriginal) => {
  const actual = await importOriginal<typeof Label>()
  return {
    ...actual,
    renderPackingLabels: (...args: Parameters<typeof actual.renderPackingLabels>) =>
      broken.on ? { ok: false, error: { code: 'INVALID_DATA', message: '라벨 데이터를 확인해 주세요.' } } : actual.renderPackingLabels(...args),
  }
})

const { formatLog } = await import('../src/log.ts')
const { chat, getFile, ok } = await import('./i2-support.ts')
const { addSeller, createBroadcast, dumpAllTables, newWorld } = await import('./support.ts')

describe('AC-I2-34 라벨 데이터 형식 오류', () => {
  it('데이터·PNG·PDF 모두 파일 없이 500 LABEL_INVALID, 경보는 코드·날짜뿐, 아무것도 기록하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: '2026-10-19' })).id
    await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, b, 'm1', 'UC_A', '비밀닉네임', '1')
    const before = await dumpAllTables(world.database)
    broken.on = true
    try {
      for (const path of ['packing-label?buyer=UC_A', 'packing-label.png?buyer=UC_A', 'packing-label.pdf?buyer=UC_A']) {
        const file = await getFile(world, seller.cookie, `/api/days/2026-10-19/${path}`)
        expect(file.status, path).toBe(500)
        expect(file.json?.error).toEqual({ code: 'LABEL_INVALID', message: '포장 라벨을 만들지 못했어요. 고객센터에 알려 주세요.' })
      }
      expect(world.logs.filter((record) => record.code === 'LABEL_INVALID')).toEqual(Array.from({ length: 3 }, () => ({ level: 'error', code: 'LABEL_INVALID', date: '2026-10-19' })))
      expect(world.logs.map(formatLog).join('\n')).not.toContain('비밀닉네임')
      expect(await dumpAllTables(world.database)).toBe(before)
    } finally {
      broken.on = false
    }
    expect((await getFile(world, seller.cookie, '/api/days/2026-10-19/packing-label?buyer=UC_A')).status).toBe(200)
  })
})
