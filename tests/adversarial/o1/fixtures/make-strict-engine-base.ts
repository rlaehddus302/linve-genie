// BASE 코어(O1 전)로 무작위 다육(STRICT·LOOSE) 로그를 돌린 기록을 만든다 (AC-O1-03 적대 — 엔진 판정·정산·감사 문구 회귀 비교용).
// 쓰는 법: node tests/adversarial/o1/fixtures/make-strict-engine-base.ts <BASE packages/core/src> > tests/adversarial/o1/fixtures/strict-engine-base.json
// 로그는 고정 시드 의사 난수로 만들고, BASE checkEvent가 문제를 낸 이벤트는 서버처럼 기록하지 않는다.
const src = process.argv[2]
if (src === undefined) throw new Error('BASE packages/core/src 경로를 주세요')
const core = (await import(`${src}/index.ts`)) as Record<string, (...args: never[]) => unknown>
type AnyFn = (...args: unknown[]) => unknown
const call = (name: string, ...args: unknown[]): unknown => (core[name] as unknown as AnyFn)(...args)

let seed = 7
const rand = (n: number): number => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) % n
}
const pick = <T>(xs: readonly T[]): T => xs[rand(xs.length)] as T
const B = ['A', 'B', 'C', 'D']
const NO = [15, 16, 17]
const T0 = Date.UTC(2026, 9, 25, 11, 0, 0)
const BROADCAST = { id: 'b1', date: '2026-10-25', title: '다육 1부' }
const TEXTS = ['15', '16', '17', '15 16', '15 취소', '16 취소', '15번요', '찜 17', '15,16,17', '안녕', '15?', '１６', '15 1000']

function eventOf(state: unknown): Record<string, unknown> {
  const r = rand(100)
  const no = pick(NO)
  const buyer = pick(B)
  if (r < 8) return { type: 'product.register', b: 'b1', no, name: pick(['핑크프릴', '라울', '<b>x</b>']), price: pick([0, 7000, 12000, 1000000]), stock: 1 + rand(3), ...(rand(3) === 0 ? { status: 'READY' } : {}) }
  if (r < 14) return { type: pick(['product.open', 'product.hold', 'product.close']), b: 'b1', no }
  if (r < 50) return { type: 'chat', b: 'b1', id: `m${String(rand(60))}`, ch: buyer, nick: `닉${buyer}`, text: pick(TEXTS), ...(rand(4) === 0 ? { publishedAt: T0 + rand(200) * 1000 } : {}) }
  if (r < 56) return { type: 'sms', b: 'b1', ref: `s${String(rand(20))}`, no, received: pick(['20:00', '20:01:30', '19:59']), ...(rand(2) === 0 ? { buyer } : {}) }
  if (r < 70) return { type: pick(['host.cancel', 'host.reject', 'host.promote', 'host.confirm', 'host.approveCancel', 'host.dismissCancel']), b: 'b1', no, buyer, reason: '사유' }
  if (r < 74) return { type: 'host.reopen', b: 'b1', no, reason: '사유' }
  if (r < 79) return { type: 'host.assign', b: 'b1', no, buyer, reason: '사유', ...(rand(2) === 0 ? { replace: pick(B), replaceTo: pick(['WAITLIST', 'CANCEL']) } : {}) }
  if (r < 82) return { type: 'product.update', b: 'b1', no, ...(rand(2) === 0 ? { price: pick([5000, 9000]), applyTo: pick(['NEW_ONLY', 'UNPAID_CLAIMS']) } : { stock: 1 + rand(3) }) }
  if (r < 84) return { type: 'product.renumber', b: 'b1', from: no, to: pick(NO) }
  if (r < 86) return { type: 'host.convertMessage', b: 'b1', msg: `m${String(rand(60))}`, no }
  if (r < 88) return { type: 'host.resolveConflict', b: 'b1', no, decision: pick(['KEEP', 'SWITCH']) }
  if (r < 90) return { type: 'buyer.merge', from: buyer, into: pick(B), reason: '사유' }
  if (r < 92) return { type: rand(2) === 0 ? 'host.blockBuyer' : 'host.unblockBuyer', buyer, reason: '사유' }
  if (r < 95) return { type: 'settlement.payment', buyer, date: BROADCAST.date, amount: 1 + rand(40000) }
  const effects = call('listEffects', state) as { id: string; kind: string }[]
  if (effects.length === 0) return { type: 'chat', b: 'b1', id: 'mx', ch: buyer, nick: 'n', text: '15' }
  const effect = pick(effects)
  return { type: effect.kind === 'POST_THANKS' ? 'effect.thanksSent' : 'effect.labelPrinted', effectId: effect.id }
}

const SETTINGS = [
  {},
  { 'claim.parseMode': 'LOOSE', 'cancel.succession': 'ASK' },
  { 'contention.policy': 'RECEIVED_TIME', 'waitlist.max': 1 },
  { 'cancel.succession': 'REOPEN', 'cancel.buyerChat': 'AUTO', 'thanks.videoComment': 'PER_SALE' },
  { 'cancel.buyerChat': 'REQUEST', 'waitlist.max': 0, 'shipping.freeThreshold': 20000 },
]
const runs: unknown[] = []
for (let k = 0; k < 50; k++) {
  const settings = SETTINGS[k % SETTINGS.length]
  let state = call('initEngine', { broadcasts: [BROADCAST], settings })
  const log: Record<string, unknown>[] = []
  for (let i = 0; i < 40; i++) {
    const event = { seq: log.length + 1, at: T0 + i * 2000, ...eventOf(state) }
    if ((call('checkEvent', state, event) as unknown[]).length > 0) continue
    state = (call('applyEvent', state, event) as { state: unknown }).state
    log.push(event)
  }
  runs.push({
    settings,
    log,
    out: {
      products: call('listProducts', state),
      claims: call('listClaims', state),
      pending: call('listPending', state),
      buyers: call('listBuyers', state),
      settlements: call('listSettlements', state),
      effects: call('listEffects', state),
      requests: call('listCancelRequests', state),
    },
  })
}
process.stdout.write(`${JSON.stringify({ base: 'harness/sprints/O1/BASE', broadcast: BROADCAST, runs })}\n`)
