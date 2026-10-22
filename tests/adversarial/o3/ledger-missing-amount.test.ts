// O3 봉인 장부: 확정 찜의 찜 금액이 없을 때 (test-domain, D-O3-12·D-O3-15, AC-O3-26·29).
// 코어로는 만들 수 없는 상태라 코어 listClaims를 감싸 한 찜의 amount만 null로 바꾼다(시험용 주입 — AC-O3-29와 같은 방법).
// 장부는 고칠 수 없는 기록이라, 금액 없는 판매를 단가 × 수량·가격 스냅샷으로 채운 장부가 나오면 안 된다 — 장부를 만들지 않는다.
import type * as Core from '@livejjim/core'
import { describe, expect, it, vi } from 'vitest'

const hole = vi.hoisted(() => ({ claimId: null as string | null }))
vi.mock('@livejjim/core', async (importOriginal) => {
  const core = await importOriginal<typeof Core>()
  return {
    ...core,
    listClaims: (state: Core.EngineState) => core.listClaims(state).map((c) => (c.id === hole.claimId ? { ...c, amount: null } : c)),
  }
})

const { listClaims } = await import('@livejjim/core')
const { buildLedger } = await import('../../../apps/server/src/youtube/seal.ts')
const { D1, optionScenario, play } = await import('./scenarios.ts')

const SEALED_AT = Date.parse('2026-11-24T15:00:00Z')

describe('D-O3-15 찜 금액이 없는 확정 찜 → 봉인 장부를 만들지 않는다', () => {
  it('옵션 찜(수량 2 이상)과 옵션 없는 수량 1 찜 각각: buildLedger가 장부를 돌려주지 않는다(오류 글에 금액 없음)', () => {
    let tried = 0
    for (let seed = 5; seed < 400 && tried < 6; seed += 37) {
      const { state } = play(optionScenario(seed))
      hole.claimId = null
      const confirmed = listClaims(state).filter((c) => c.status === 'CONFIRMED')
      const targets = [confirmed.find((c) => c.variant !== null && c.qty >= 2), confirmed.find((c) => c.variant === null && c.qty === 1)].filter((c) => c !== undefined)
      for (const target of targets) {
        hole.claimId = target.id
        let ledger: unknown = null
        try {
          ledger = buildLedger(D1, state, new Map(), SEALED_AT)
        } catch (error) {
          expect((error as { name?: string }).name, `seed ${String(seed)}`).toBe('MissingAmountError')
          expect(String((error as Error).message)).not.toContain(String(target.price))
        }
        expect(ledger, `seed ${String(seed)} ${target.id}: 금액 없는 판매로 장부가 만들어짐`).toBeNull()
        tried++
      }
    }
    hole.claimId = null
    expect(tried).toBeGreaterThan(2)
  })
})
