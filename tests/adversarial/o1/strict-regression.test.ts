// O1 적대 (test-domain): 다육 방송은 하나도 바뀌지 않는다 (AC-O1-03, CMT-07, R-19 "다육 회귀 없음").
// BASE 코어(harness/sprints/O1/BASE)로 만든 기록 파일과 지금 코어를 비교한다 — 기록은 fixtures/make-*.mts로 다시 만들 수 있다.
import { readFileSync } from 'node:fs'
import {
  applyEvent,
  checkEvent,
  checkInvariants,
  initEngine,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  parseChat,
  StateFormatError,
  upgradeState,
  type EngineEvent,
  type EngineState,
  type SettingsOverride,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T

describe('STRICT·LOOSE parseChat = BASE 코어 (AC-O1-03)', () => {
  const { cases } = read<{ cases: { text: string; settings: SettingsOverride; out: unknown }[] }>('parse-chat-base.json')
  it(`고정 시드 무작위 채팅 글 ${String(cases.length)}개의 결과가 BASE와 같다 (주문이 된 사례도 충분히 들어 있다)`, () => {
    expect(cases.filter((c) => (c.out as { claims: unknown[] }).claims.length > 0).length).toBeGreaterThan(100)
    const differ = cases.filter((c) => JSON.stringify(parseChat(c.text, c.settings)) !== JSON.stringify(c.out))
    expect(differ.slice(0, 5)).toEqual([])
  })
})

/** BASE 결과에 있던 키만 남긴다 (O1이 조회에 더한 칸 — key·qty·variant·amount·variants 등 — 은 비교하지 않는다) */
function likeBase(base: unknown, now: unknown): unknown {
  if (Array.isArray(base)) return Array.isArray(now) ? now.map((item, i) => likeBase(base[i], item)) : now
  if (base === null || typeof base !== 'object' || now === null || typeof now !== 'object') return now
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(base)) out[key] = likeBase((base as Record<string, unknown>)[key], (now as Record<string, unknown>)[key])
  return out
}

describe('STRICT·LOOSE 방송의 판정·정산·감사 문구 = BASE 코어 (AC-O1-03)', () => {
  const { broadcast, runs } = read<{ broadcast: { id: string; date: string; title: string }; runs: { settings: SettingsOverride; log: EngineEvent[]; out: Record<string, unknown> }[] }>('strict-engine-base.json')
  it(`무작위 다육 로그 ${String(runs.length)}개를 지금 코어로 재생한 조회 결과가 BASE 기록과 같다`, () => {
    for (const [i, run] of runs.entries()) {
      let state = initEngine({ broadcasts: [broadcast], settings: run.settings })
      for (const event of run.log) {
        expect(checkEvent(state, event), `run ${String(i)} seq ${String(event.seq)}`).toEqual([])
        state = applyEvent(state, event).state
      }
      expect(checkInvariants(state)).toEqual([])
      const now = {
        products: listProducts(state),
        claims: listClaims(state),
        pending: listPending(state),
        buyers: listBuyers(state),
        settlements: listSettlements(state),
        effects: listEffects(state),
        requests: listCancelRequests(state),
      }
      expect(likeBase(run.out, now), `run ${String(i)}`).toEqual(run.out)
    }
  })
})

describe('BASE 코어가 저장한 형식 4 상태를 이어 쓴다 (AC-O1-30)', () => {
  const { broadcast, runs } = read<{ broadcast: { id: string; date: string; title: string }; runs: { settings: SettingsOverride; log: EngineEvent[] }[] }>('strict-engine-base.json')
  const { saved } = read<{ saved: { run: number; cut: number; state: unknown }[] }>('format4-states.json')
  it('형식 4 그대로는 StateFormatError, upgradeState 뒤 나머지 로그를 이어 재생한 결과 = 처음부터 재생한 결과', () => {
    for (const { run, cut, state } of saved) {
      const { settings, log } = runs[run] as { settings: SettingsOverride; log: EngineEvent[] }
      expect(() => applyEvent(state as EngineState, log[cut] as EngineEvent)).toThrow(StateFormatError)
      let continued = upgradeState(JSON.parse(JSON.stringify(state)))
      expect(checkInvariants(continued)).toEqual([])
      for (const event of log.slice(cut)) continued = applyEvent(continued, event).state
      let fresh = initEngine({ broadcasts: [broadcast], settings })
      for (const event of log) fresh = applyEvent(fresh, event).state
      expect(JSON.stringify(continued)).toBe(JSON.stringify(fresh))
    }
  })
})
