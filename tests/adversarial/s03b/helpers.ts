// S03b 적대 테스트 공용 도구 (test-domain). S03 도구(../s03/helpers.ts)를 그대로 쓰고, 이벤트 사이 비교 도구만 더한다.
// 문자찜 sms(ref, no, received, { phone })는 S03 도구가 서버처럼 phoneKey·phoneLast4로 바꿔 넣는다(D-061).
import type { EngineEffect, EngineState } from '@livejjim/core'
import { listClaims, observe, type Played } from '../s03/helpers.ts'

export * from '../s03/helpers.ts'

/** index번째 이벤트(0부터)가 아무 일도 하지 않았는지: 조회 결과 전부 같고 새 효과 없음 */
export function noOp(p: Played, index: number): { same: boolean; effects: number } {
  const before = JSON.stringify(observe(p.states[index] as EngineState))
  const after = JSON.stringify(observe(p.states[index + 1] as EngineState))
  return { same: before === after, effects: (p.emitted[index] as readonly EngineEffect[]).length }
}

/** 상태 from → to 사이에 새로 REJECTED(SOLD_OUT)이 된 찜 ID */
export function newSoldOut(p: Played, from: number, to: number): string[] {
  const sold = (s: EngineState): string[] => listClaims(s).filter((c) => c.status === 'REJECTED' && c.reason === 'SOLD_OUT').map((c) => c.id)
  const before = new Set(sold(p.states[from] as EngineState))
  return sold(p.states[to] as EngineState).filter((id) => !before.has(id))
}
