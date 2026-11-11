// 앱 프린터 연결 단계 기록 (D-PRN-DIAG): 정해진 모양의 단계 이름·정수만 로그에 남고, 나머지는 버린다
import { describe, expect, it } from 'vitest'
import { addSeller, client, newWorld } from './support.ts'

describe('POST /api/printer-diag', () => {
  it('단계 이름·숫자만 판매자 ID와 함께 로그로 남긴다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const response = await client(world, seller.cookie).post('/api/printer-diag', {
      events: [{ step: 'scan_start', ms: 3 }, { step: 'connect_err', ms: 120, code: 201 }, { step: '이름 <b>', ms: 1 }, { step: 'x'.repeat(80) }, { step: 'ok', ms: 1.5, code: 'a' }, 'junk'],
    })
    expect(response.status).toBe(204)
    const diag = world.logs.filter((r) => r.code === 'PRINTER_DIAG')
    expect(diag.map((r) => [r.reason, r.count, r.status])).toEqual([
      ['scan_start', 3, undefined],
      ['connect_err', 120, 201],
      ['ok', undefined, undefined],
    ])
    expect(diag.every((r) => r.seller !== undefined && r.level === 'info')).toBe(true)
  })

  it('로그인 없이는 받지 않는다', async () => {
    const world = await newWorld()
    const response = await client(world, null).post('/api/printer-diag', { events: [{ step: 'scan_start' }] })
    expect(response.status).toBe(401)
    expect(world.logs.some((r) => r.code === 'PRINTER_DIAG')).toBe(false)
  })
})
