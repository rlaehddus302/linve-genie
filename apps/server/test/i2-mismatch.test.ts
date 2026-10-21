// AC-I2-10·11 금액이 맞지 않으면(AMOUNT_MISMATCH) 파일 없이 문서 패키지의 문장 + 서버 경보(개인정보 없이).
// 실제 코어에서는 줄 합과 상품 합계가 늘 같으므로(INV-5) 코어 getSettlement만 바꿔 끼운 가짜로 어긋난 상태를 만든다(문서 패키지 mismatch 시험과 같은 방법).
import type * as Core from '@livejjim/core'
import { describe, expect, it, vi } from 'vitest'

const corrupt = vi.hoisted(() => ({ delta: 0 }))

vi.mock('@livejjim/core', async (importOriginal) => {
  const actual = await importOriginal<typeof Core>()
  return {
    ...actual,
    getSettlement: (...args: Parameters<typeof actual.getSettlement>) => {
      const real = actual.getSettlement(...args)
      return { ...real, subtotal: real.subtotal + corrupt.delta }
    },
  }
})

const { formatLog } = await import('../src/log.ts')
const { chat, getFile, ok } = await import('./i2-support.ts')
const { addSeller, client, createBroadcast, newWorld } = await import('./support.ts')

const MESSAGE = '확인서 금액이 정산 금액과 맞지 않아 확인서를 만들지 않았어요. 정산 화면의 금액을 확인하고 고객센터에 알려 주세요.'

describe('AC-I2-10·11 금액이 맞지 않으면 만들지 않는다', () => {
  it('한 사람 데이터·PDF·PNG와 전원 PDF 모두 파일 없이 500 AMOUNT_MISMATCH, 경보는 코드·날짜뿐', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: '2026-10-19' })).id
    await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, b, 'm1', 'UC_A', '비밀닉네임', '1')
    corrupt.delta = 1
    try {
      for (const path of ['receipt?buyer=UC_A', 'receipt.pdf?buyer=UC_A', 'receipt.png?buyer=UC_A', 'receipts.pdf']) {
        const file = await getFile(world, seller.cookie, `/api/days/2026-10-19/${path}`)
        expect(file.status, path).toBe(500)
        expect(file.headers.get('content-type')).toBe('application/json')
        expect(file.json?.error).toEqual({ code: 'AMOUNT_MISMATCH', message: MESSAGE })
      }
      const alerts = world.logs.filter((record) => record.code === 'DOCUMENT_MISMATCH')
      expect(alerts).toHaveLength(4)
      expect(alerts[0]).toEqual({ level: 'error', code: 'DOCUMENT_MISMATCH', date: '2026-10-19' })
      expect(world.logs.map(formatLog).join('\n')).not.toContain('비밀닉네임')
    } finally {
      corrupt.delta = 0
    }
    expect((await client(world, seller.cookie).get('/api/days/2026-10-19/receipt?buyer=UC_A')).status).toBe(200)
  })
})
