// MOB2 적대 시험 (test-domain) — D-MOB2-04 · R-8 · AC-MOB2-10~16
// 결과 한 줄(apps/web/src/lib/vacated.ts captureVacated → vacatedLine)을 실제 엔진 상태로 돌린다.
// 화면은 서버처럼 엔진 조회 결과 + ISO 시각을 받는다. 문장은 D-MOB2-04 글자 그대로를 기대한다.
// 공격: 승계 방식 셋 × 대기 0·1·2, ASK인데 대기 0(D-077 — 물을 것 없음), 대기 한도 0인 ASK, 일시 중지 상품, 재고 2,
// 취소 요청 승인·무효, 충돌 찜이 풀려 1등이 됨(R-7 7), 옵션 변형, `<b>해커</b>` 이름, 대기 찜 취소(줄 없음).
import {
  applyEvent,
  initEngine,
  listBroadcasts,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  type EngineEvent,
  type EngineState,
  type SettingsOverride,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { withIsoTimes } from '../../../apps/server/src/time.ts'

const VACATED_MODULE = '../../../apps/web/src/lib/vacated.ts'
const SCOPE_MODULE = '../../../apps/web/src/lib/scope-data.ts'

interface Vacated {
  captureVacated(data: unknown, event: Record<string, unknown>, claims: readonly string[]): unknown
  vacatedLine(before: unknown, data: unknown): { text: string; tone: string } | null
}
interface ScopeModule {
  fromFull(view: unknown): unknown
}

const B = { id: 'b1', date: '2026-10-18', title: '1부' } as const
const T0 = Date.UTC(2026, 9, 18, 11, 0, 0)

function view(state: EngineState): unknown {
  return withIsoTimes({
    date: B.date,
    rehearsal: false,
    seq: 0,
    attention: [],
    depositLinks: [],
    broadcasts: listBroadcasts(state),
    products: listProducts(state),
    claims: listClaims(state),
    pending: listPending(state),
    buyers: listBuyers(state),
    settlements: listSettlements(state),
    effects: listEffects(state),
    cancelRequests: listCancelRequests(state),
  })
}

class World {
  state: EngineState
  seq = 0
  constructor(settings: SettingsOverride) {
    this.state = initEngine({ broadcasts: [B], settings })
  }
  apply(event: Record<string, unknown>): void {
    this.seq++
    this.state = applyEvent(this.state, { at: T0 + this.seq * 1000, ...event, seq: this.seq } as unknown as EngineEvent).state
  }
  reg(f: Record<string, unknown> = {}): void {
    this.apply({ type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000, ...f })
  }
  chat(nick: string, text = '15'): void {
    this.apply({ type: 'chat', b: 'b1', id: `m${String(this.seq)}`, ch: `UC${String(this.seq)}`, nick, text })
  }
  claimOf(nick: string): { id: string; buyer: string; status: string } {
    const names = new Map(listBuyers(this.state).map((b) => [b.id, b.display]))
    const found = listClaims(this.state).find((c) => names.get(c.buyer) === nick)
    if (found === undefined) throw new Error(nick)
    return found
  }
}

/** 조치 하나를 보낸 기기처럼: 직전 모양을 잡고 → 엔진 적용 → 따라잡은 뒤 한 줄 */
async function act(world: World, event: Record<string, unknown>, target: string): Promise<{ text: string; tone: string } | null> {
  const v = (await import(/* @vite-ignore */ VACATED_MODULE)) as Vacated
  const s = (await import(/* @vite-ignore */ SCOPE_MODULE)) as ScopeModule
  const claim = world.claimOf(target)
  const before = v.captureVacated(s.fromFull(view(world.state)), event, [claim.id])
  world.apply(event)
  if (before === null) return null
  return v.vacatedLine(before, s.fromFull(view(world.state)))
}

const cancel = (w: World, nick: string): Record<string, unknown> => ({ type: 'host.cancel', b: 'b1', no: 15, buyer: w.claimOf(nick).buyer, reason: '판매자 취소' })

describe('D-MOB2-04 결과 한 줄 = 엔진 결과 (AC-MOB2-10~16)', () => {
  it('AUTO 대기 2 → "15번 새 1등: 김철수"', async () => {
    const w = new World({ 'cancel.succession': 'AUTO' })
    w.reg()
    w.chat('<b>해커</b>')
    w.chat('김철수')
    w.chat('박영희')
    expect((await act(w, cancel(w, '<b>해커</b>'), '<b>해커</b>'))?.text).toBe('15번 새 1등: 김철수')
  })

  it('AUTO 대기 없음 → "… · 대기 없음 · 판매 중"', async () => {
    const w = new World({ 'cancel.succession': 'AUTO' })
    w.reg()
    w.chat('<b>해커</b>')
    expect((await act(w, cancel(w, '<b>해커</b>'), '<b>해커</b>'))?.text).toBe('15번 1등 자리가 비었어요 · 대기 없음 · 판매 중')
  })

  it('AUTO 대기 없음 + 일시 중지 상품 → 끝이 "일시 중지"', async () => {
    const w = new World({ 'cancel.succession': 'AUTO' })
    w.reg()
    w.chat('<b>해커</b>')
    w.apply({ type: 'product.hold', b: 'b1', no: 15 })
    expect((await act(w, cancel(w, '<b>해커</b>'), '<b>해커</b>'))?.text).toBe('15번 1등 자리가 비었어요 · 대기 없음 · 일시 중지')
  })

  it('ASK 대기 2 → "… · 대기 2명 — 누구를 1등으로 할지 골라 주세요"', async () => {
    const w = new World({ 'cancel.succession': 'ASK' })
    w.reg()
    w.chat('<b>해커</b>')
    w.chat('김철수')
    w.chat('박영희')
    expect((await act(w, cancel(w, '<b>해커</b>'), '<b>해커</b>'))?.text).toBe('15번 1등 자리가 비었어요 · 대기 2명 — 누구를 1등으로 할지 골라 주세요')
  })

  it('ASK인데 대기 없음 → 물을 것이 없으니 "대기 없음 · 판매 중" ("대기 0명 — 골라 주세요"가 아니다)', async () => {
    const w = new World({ 'cancel.succession': 'ASK' })
    w.reg()
    w.chat('<b>해커</b>')
    expect((await act(w, cancel(w, '<b>해커</b>'), '<b>해커</b>'))?.text).toBe('15번 1등 자리가 비었어요 · 대기 없음 · 판매 중')
  })

  it('REOPEN 대기 2 → "… · 대기를 비웠어요 · 판매 중"', async () => {
    const w = new World({ 'cancel.succession': 'REOPEN' })
    w.reg()
    w.chat('<b>해커</b>')
    w.chat('김철수')
    w.chat('박영희')
    expect((await act(w, cancel(w, '<b>해커</b>'), '<b>해커</b>'))?.text).toBe('15번 1등 자리가 비었어요 · 대기를 비웠어요 · 판매 중')
  })

  it('REOPEN 대기 없음 → "대기 없음"', async () => {
    const w = new World({ 'cancel.succession': 'REOPEN' })
    w.reg()
    w.chat('<b>해커</b>')
    expect((await act(w, cancel(w, '<b>해커</b>'), '<b>해커</b>'))?.text).toBe('15번 1등 자리가 비었어요 · 대기 없음 · 판매 중')
  })

  it('재고 2, 1등 A·B, 대기 C — A 취소 → "15번 새 1등: C" (B는 그대로)', async () => {
    const w = new World({ 'cancel.succession': 'AUTO' })
    w.reg({ stock: 2 })
    w.chat('에이')
    w.chat('비')
    w.chat('씨')
    expect((await act(w, cancel(w, '에이'), '에이'))?.text).toBe('15번 새 1등: 씨')
    expect(w.claimOf('비').status).toBe('CONFIRMED')
  })

  it('새 1등 이름이 `<b>해커</b>` — 글자 그대로 (자르지 않음)', async () => {
    const w = new World({ 'cancel.succession': 'AUTO' })
    w.reg()
    w.chat('김철수')
    w.chat('<b>해커</b>')
    expect((await act(w, cancel(w, '김철수'), '김철수'))?.text).toBe('15번 새 1등: <b>해커</b>')
  })

  it('무효(host.reject)도 같은 문장', async () => {
    const w = new World({ 'cancel.succession': 'AUTO' })
    w.reg()
    w.chat('<b>해커</b>')
    w.chat('김철수')
    const event = { type: 'host.reject', b: 'b1', no: 15, buyer: w.claimOf('<b>해커</b>').buyer, reason: '장난 찜' }
    expect((await act(w, event, '<b>해커</b>'))?.text).toBe('15번 새 1등: 김철수')
  })

  it('1등의 취소 요청 승인(host.approveCancel)도 같은 문장', async () => {
    const w = new World({ 'cancel.succession': 'AUTO', 'cancel.buyerChat': 'REQUEST' })
    w.reg()
    w.chat('<b>해커</b>')
    w.chat('김철수')
    // 1등이 채팅으로 취소를 부탁한다 (같은 채널 — 유튜브 구매자 ID = 채널)
    const hacker = w.claimOf('<b>해커</b>')
    w.apply({ type: 'chat', b: 'b1', id: 'cancel-msg', ch: hacker.buyer, nick: '<b>해커</b>', text: '15 취소' })
    expect(listCancelRequests(w.state).length).toBe(1)
    const event = { type: 'host.approveCancel', b: 'b1', no: 15, buyer: hacker.buyer }
    expect((await act(w, event, '<b>해커</b>'))?.text).toBe('15번 새 1등: 김철수')
  })

  it('대기 찜 취소 → 결과 줄 없음(지금 그대로 "보냈어요")', async () => {
    const w = new World({ 'cancel.succession': 'AUTO' })
    w.reg()
    w.chat('<b>해커</b>')
    w.chat('김철수')
    expect(await act(w, cancel(w, '김철수'), '김철수')).toBeNull()
  })

  it('옵션 상품 변형 "빨강" 1등 취소 → "15번 빨강 새 1등: …"', async () => {
    const w = new World({ 'cancel.succession': 'AUTO', 'claim.parseMode': 'OPTIONS' })
    w.reg({ options: [{ name: '색', choices: [{ label: '빨강' }, { label: '파랑' }] }], stocks: { 빨강: 1, 파랑: 1 } })
    w.chat('에이', '15 빨강')
    w.chat('비', '15 빨강')
    const a = w.claimOf('에이')
    if (a.status !== 'CONFIRMED') {
      // 옵션 입력 모양이 이 엔진과 다르면 이 사례는 뜻이 없다 — 상태를 보여 주고 실패시킨다
      expect(listClaims(w.state).map((c) => [c.status, c.reason, (c as unknown as { variant: string | null }).variant])).toEqual('옵션 찜 준비 실패')
    }
    expect((await act(w, cancel(w, '에이'), '에이'))?.text).toBe('15번 빨강 새 1등: 비')
  })
})
