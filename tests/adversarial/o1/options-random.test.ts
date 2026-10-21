// O1 적대 속성 시험 (test-domain): 무작위 옵션 방송 로그 (AC-O1-10·20·28·29·30).
// 개발자 속성 시험(engine-properties-o1)보다 넓게 섞는다 — 옵션 바꾸기(선택지 더하기·가격 차이·UNPAID_CLAIMS)·번호 변경·합치기·차단·
// 교체 배정·다시 열기·메시지 변환·효과 보고·입금, 그리고 같은 날 STRICT 방송(b2)을 함께 돌린다.
// 매 이벤트 뒤: checkInvariants, 변형마다 확정 수량 ≤ 재고·대기 수량 1·구매자 × 변형 활성 찜 ≤ 1·상태(SOLD ⇔ 남은 0)·
// "자리가 남았는데 대기자가 있으면 승계 결정 필요 표시"(교체 WAITLIST로 빈 자리를 둔 경우 제외), 금액은 0 이상 정수, 합계 = Σ 단가 × 수량.
// 로그 끝: INV-O2(확인 필요 항목을 비운 상태와 재고·합계·효과가 같다), INV-4(재생 = 상태), JSON 왕복 뒤 이어 재생 = 처음부터,
// INV-12(채팅·문자찜 사본을 첫 수신 뒤 아무 자리에 끼워도 결과가 같다).
// 라운드 0: 이 시드에서 번호 변경 뒤 차단으로 CorruptStateError가 난다 — 최소 반례는 round0-findings의 TD-O1-001.
import fc from 'fast-check'
import {
  applyEvent,
  checkEvent,
  checkInvariants,
  initEngine,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listProducts,
  listReviews,
  listSettlements,
  type EngineEvent,
  type EngineState,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { B1, B2, T0 } from './helpers.ts'

const SIZE = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['엠'] }, { label: 'L', price: 500 }] }]
const TOWEL = [
  { name: '색상', choices: [{ label: '흰색', aliases: ['화이트'] }, { label: '검정색', aliases: ['블랙'], price: -300 }] },
  { name: '크기', choices: [{ label: '소형' }, { label: '대형', price: 2000 }] },
]
const BUYERS = ['UC_A', 'UC_B', 'UC_C', 'UC_D', 'UC_E']
const TEXTS = [
  '반바지 M', '반바지 엠 2개', '반바지 L 3', '반바지', '21', '21 S', '21 L 2개', '반바지 XL', '반바지 s 두개', '찜 반바지 m 요',
  '수건 흰색 대형', '수건 블랙 소형 2개', '흰색 대형', '검정색 소형 3', '화이트', '31',
  '초코 과자 3', '초코 2개', '초코', '11', '11 2', '11 21', '초코과자3', '21 취소', '11 취소', '31 취소',
  '반바지 M?', '반바지 M 12,000', '반바지 M 0개', '반바지 M 99개', '25', '25 M', '반바지 M 👍', '반바지 Ｍ',
]
const NOS = [21, 31, 11, 25]
const optionsOf = (no: number): readonly { name: string; choices: readonly { label: string }[] }[] => (no === 21 || no === 25 ? SIZE : no === 31 ? TOWEL : [])
const pickOf = (no: number, pick: number): Record<string, string> | undefined => {
  const items = optionsOf(no)
  if (items.length === 0) return undefined
  const out: Record<string, string> = {}
  let rest = pick
  for (const item of items) {
    out[item.name] = (item.choices[rest % item.choices.length] as { label: string }).label
    rest = Math.floor(rest / item.choices.length)
  }
  return out
}

type Raw =
  | { readonly k: 'chat'; readonly buyer: number; readonly text: number }
  | { readonly k: 'strict'; readonly buyer: number; readonly text: number }
  | { readonly k: 'sms'; readonly no: number; readonly qty: number; readonly pick: number; readonly named: boolean; readonly buyer: number }
  | { readonly k: 'claimAct'; readonly type: number; readonly buyer: number; readonly no: number; readonly pick: number; readonly withOptions: boolean }
  | { readonly k: 'assign'; readonly buyer: number; readonly no: number; readonly qty: number; readonly pick: number; readonly replace: number }
  | { readonly k: 'reopen'; readonly no: number; readonly pick: number }
  | { readonly k: 'stock'; readonly no: number; readonly pick: number; readonly stock: number }
  | { readonly k: 'price'; readonly no: number; readonly price: number; readonly diff: number; readonly unpaid: boolean }
  | { readonly k: 'addChoice'; readonly no: number }
  | { readonly k: 'focus'; readonly no: number }
  | { readonly k: 'phase'; readonly no: number; readonly which: number }
  | { readonly k: 'renumber'; readonly back: boolean }
  | { readonly k: 'resolve'; readonly review: number; readonly no: number; readonly qty: number; readonly pick: number }
  | { readonly k: 'dismiss'; readonly review: number }
  | { readonly k: 'convert'; readonly msg: number; readonly no: number }
  | { readonly k: 'merge'; readonly from: number; readonly into: number; readonly un: boolean }
  | { readonly k: 'block'; readonly buyer: number; readonly un: boolean }
  | { readonly k: 'report'; readonly effect: number; readonly label: boolean }
  | { readonly k: 'pay'; readonly buyer: number; readonly amount: number }

const n = (max: number) => fc.nat(max)
const rawArb: fc.Arbitrary<Raw> = fc.oneof(
  { weight: 10, arbitrary: fc.record({ k: fc.constant('chat' as const), buyer: n(4), text: n(TEXTS.length - 1) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('strict' as const), buyer: n(4), text: n(TEXTS.length - 1) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('sms' as const), no: n(3), qty: fc.integer({ min: 1, max: 3 }), pick: n(11), named: fc.boolean(), buyer: n(4) }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('claimAct' as const), type: n(6), buyer: n(4), no: n(3), pick: n(11), withOptions: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('assign' as const), buyer: n(4), no: n(3), qty: fc.integer({ min: 1, max: 3 }), pick: n(11), replace: n(9) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('reopen' as const), no: n(3), pick: n(11) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('stock' as const), no: n(3), pick: n(11), stock: n(4) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('price' as const), no: n(3), price: fc.integer({ min: 0, max: 30 }), diff: fc.integer({ min: -5, max: 5 }), unpaid: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('addChoice' as const), no: n(3) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('focus' as const), no: n(4) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('phase' as const), no: n(3), which: n(5) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('renumber' as const), back: fc.boolean() }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('resolve' as const), review: n(5), no: n(3), qty: fc.integer({ min: 1, max: 3 }), pick: n(11) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('dismiss' as const), review: n(5) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('convert' as const), msg: n(9), no: n(3) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('merge' as const), from: n(5), into: n(5), un: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('block' as const), buyer: n(4), un: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('report' as const), effect: n(30), label: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('pay' as const), buyer: n(4), amount: fc.integer({ min: 1, max: 60000 }) }) },
)

const scenarioArb = fc.record({
  stocks: fc.tuple(n(3), n(3), n(3), fc.integer({ min: 1, max: 4 })),
  readyShorts: fc.boolean(),
  waitlist: n(2),
  succession: fc.constantFrom('AUTO' as const, 'ASK' as const, 'REOPEN' as const),
  buyerChat: fc.constantFrom('OFF' as const, 'REQUEST' as const, 'AUTO' as const),
  maxQuantity: fc.constantFrom(2, 10),
  raws: fc.array(rawArb, { minLength: 15, maxLength: 60 }),
})
type Scenario = typeof scenarioArb extends fc.Arbitrary<infer T> ? T : never

const CLAIM_ACTS = ['host.cancel', 'host.reject', 'host.promote', 'host.confirm', 'host.approveCancel', 'host.dismissCancel', 'host.cancel'] as const

/** 무작위 원료 하나를 지금 상태에 맞춰 이벤트로 (효과 보고·바로잡기 대상은 지금 상태에서 고른다 — 결정적) */
function eventOf(raw: Raw, i: number, state: EngineState, sentChats: readonly string[]): Record<string, unknown> | null {
  switch (raw.k) {
    case 'chat':
      return { type: 'chat', b: 'b1', id: `m${String(i)}`, ch: BUYERS[raw.buyer], nick: `닉${String(raw.buyer)}`, text: TEXTS[raw.text] }
    case 'strict':
      return { type: 'chat', b: 'b2', id: `t${String(i)}`, ch: BUYERS[raw.buyer], nick: `닉${String(raw.buyer)}`, text: ['15', '15 취소', '16', '15 16'][raw.text % 4] }
    case 'sms': {
      const no = NOS[raw.no] as number
      const options = pickOf(no, raw.pick)
      return { type: 'sms', b: 'b1', ref: `s${String(i)}`, no, received: '20:00', qty: raw.qty, ...(options === undefined ? {} : { options }), ...(raw.named ? { buyer: BUYERS[raw.buyer] } : {}) }
    }
    case 'claimAct': {
      const no = NOS[raw.no] as number
      const options = raw.withOptions ? pickOf(no, raw.pick) : undefined
      const type = CLAIM_ACTS[raw.type] as string
      return { type, b: 'b1', no, buyer: BUYERS[raw.buyer], reason: '사유', ...(options === undefined ? {} : { options }) }
    }
    case 'assign': {
      const no = NOS[raw.no] as number
      const options = pickOf(no, raw.pick)
      const replace = raw.replace < 5 ? { replace: BUYERS[raw.replace], replaceTo: raw.replace % 2 === 0 ? 'WAITLIST' : 'CANCEL' } : {}
      return { type: 'host.assign', b: 'b1', no, buyer: BUYERS[raw.buyer], reason: '사유', qty: raw.qty, ...(options === undefined ? {} : { options }), ...replace }
    }
    case 'reopen': {
      const no = NOS[raw.no] as number
      const options = pickOf(no, raw.pick)
      return { type: 'host.reopen', b: 'b1', no, reason: '사유', ...(options === undefined ? {} : { options }) }
    }
    case 'stock': {
      const no = NOS[raw.no] as number
      const options = pickOf(no, raw.pick)
      if (options === undefined) return { type: 'product.update', b: 'b1', no, stock: Math.max(1, raw.stock) }
      return { type: 'product.update', b: 'b1', no, stocks: { [Object.values(options).join('/')]: raw.stock } }
    }
    case 'price': {
      const no = NOS[raw.no] as number
      const items = optionsOf(no)
      const applyTo = raw.unpaid ? 'UNPAID_CLAIMS' : 'NEW_ONLY'
      if (items.length === 0 || raw.diff === 0) return { type: 'product.update', b: 'b1', no, price: raw.price * 1000, applyTo }
      // 첫 항목 첫 선택지 가격 차이 바꾸기 (선택지 이름·순서는 그대로)
      const changed = items.map((item, j) => (j === 0 ? { ...item, choices: item.choices.map((c, k) => (k === 0 ? { ...c, price: raw.diff * 100 } : c)) } : item))
      return { type: 'product.update', b: 'b1', no, price: 10000, options: changed, applyTo }
    }
    case 'addChoice': {
      const no = NOS[raw.no] as number
      const items = optionsOf(no)
      if (items.length === 0) return null
      const changed = items.map((item, j) => (j === 0 ? { ...item, choices: [...item.choices, { label: 'XL' }] } : item))
      return { type: 'product.update', b: 'b1', no, options: changed }
    }
    case 'focus':
      return { type: 'product.focus', b: 'b1', no: [21, 31, 11, 25, 99][raw.no] }
    case 'phase':
      return { type: ['product.hold', 'product.open', 'product.open', 'product.close', 'product.hold', 'product.open'][raw.which], b: 'b1', no: NOS[raw.no] }
    case 'renumber':
      return raw.back ? { type: 'product.renumber', b: 'b1', from: 25, to: 21 } : { type: 'product.renumber', b: 'b1', from: 21, to: 25 }
    case 'resolve':
    case 'dismiss': {
      const reviews = listReviews(state)
      const item = reviews.length > 0 && raw.review < 4 ? (reviews[raw.review % reviews.length] as { item: string }).item : (sentChats[raw.review % Math.max(1, sentChats.length)] ?? 'm0')
      if (raw.k === 'dismiss') return { type: 'host.dismissReview', b: 'b1', item }
      const no = NOS[raw.no] as number
      const options = pickOf(no, raw.pick)
      return { type: 'host.resolveReview', b: 'b1', item, no, qty: raw.qty, ...(options === undefined ? {} : { options }) }
    }
    case 'convert':
      return { type: 'host.convertMessage', b: 'b1', msg: sentChats[raw.msg % Math.max(1, sentChats.length)] ?? 'm0', no: NOS[raw.no] }
    case 'merge':
      return raw.un ? { type: 'buyer.unmerge', from: BUYERS[raw.from % 5], reason: '사유' } : { type: 'buyer.merge', from: BUYERS[raw.from % 5], into: BUYERS[raw.into % 5], reason: '사유' }
    case 'block':
      return { type: raw.un ? 'host.unblockBuyer' : 'host.blockBuyer', buyer: BUYERS[raw.buyer], reason: '사유' }
    case 'report': {
      const effects = listEffects(state)
      if (effects.length === 0) return null
      const effect = effects[raw.effect % effects.length] as { id: string; kind: string }
      return { type: effect.kind === 'POST_THANKS' ? 'effect.thanksSent' : 'effect.labelPrinted', effectId: effect.id }
    }
    case 'pay':
      return { type: 'settlement.payment', buyer: BUYERS[raw.buyer], date: B1.date, amount: raw.amount }
  }
}

function settingsOf(s: Scenario) {
  return { 'claim.parseMode': 'OPTIONS' as const, 'claim.maxQuantity': s.maxQuantity, 'waitlist.max': s.waitlist, 'cancel.succession': s.succession, 'cancel.buyerChat': s.buyerChat }
}

/** STRICT 방송 b2는 설정 스냅샷으로 선언한다 — 같은 날 다육 방송 */
function initial(s: Scenario): EngineState {
  return initEngine({ broadcasts: [B1], settings: settingsOf(s) })
}

type Logged = EngineEvent & { readonly seq: number; readonly at: number }

/** 로그 만들기: 앞 상태에 맞춰 이벤트를 만들고, 입력 오류(checkEvent 문제)는 서버처럼 기록하지 않는다 */
function build(s: Scenario): { log: Logged[]; states: EngineState[] } {
  const [sS, sM, sL, sChoco] = s.stocks
  const head: Record<string, unknown>[] = [
    { type: 'broadcast.start', b: 'b2', date: B2.date, title: B2.title, settings: { 'claim.parseMode': 'STRICT' } },
    { type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 10000, options: SIZE, stocks: { S: sS, M: sM, L: sL }, ...(s.readyShorts ? { status: 'READY' } : {}) },
    { type: 'product.register', b: 'b1', no: 31, name: '수건', price: 8000, stock: 2, options: TOWEL, aliases: ['타월'] },
    { type: 'product.register', b: 'b1', no: 11, name: '초코 과자', price: 2000, stock: sChoco, aliases: ['초코'] },
    { type: 'product.register', b: 'b2', no: 15, name: '핑크프릴', price: 12000 },
    { type: 'product.register', b: 'b2', no: 16, name: '라울', price: 7000, stock: 2 },
  ]
  let state = initial(s)
  const states = [state]
  const log: Logged[] = []
  const sentChats: string[] = []
  const push = (fields: Record<string, unknown>, i: number) => {
    const event = { seq: (log.length + 1) * 10, at: T0 + i * 3000, ...fields } as unknown as Logged
    if (checkEvent(state, event).length > 0) return
    state = applyEvent(state, event).state
    states.push(state)
    log.push(event)
    if (fields.type === 'chat' && fields.b === 'b1') sentChats.push(fields.id as string)
  }
  head.forEach((fields, i) => push(fields, i))
  s.raws.forEach((raw, j) => {
    const fields = eventOf(raw, j, state, sentChats)
    if (fields !== null) push(fields, head.length + j)
  })
  return { log, states }
}

function replay(s: Scenario, log: readonly Logged[], from: EngineState = initial(s)): EngineState {
  let state = from
  for (const event of log) state = applyEvent(state, event).state
  return state
}

const observe = (state: EngineState) => ({
  products: listProducts(state),
  claims: listClaims(state),
  buyers: listBuyers(state),
  settlements: listSettlements(state),
  effects: listEffects(state),
  requests: listCancelRequests(state),
  reviews: listReviews(state),
})

const isMoney = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0

/** 한 상태에서 보는 변형·수량 판 성질 (checkInvariants와 따로 — 조회 결과만 본다) */
function checkViews(state: EngineState, replacedToWaitlist: boolean): void {
  expect(checkInvariants(state)).toEqual([])
  const claims = listClaims(state)
  const byId = new Map(claims.map((c) => [c.id, c]))
  for (const product of listProducts(state)) {
    if (!product.hasOptions) continue
    expect(product.winners).toEqual([])
    expect(product.waitlist).toEqual([])
    const onSale = product.status === 'OPEN' || product.status === 'SOLD'
    let units = 0
    for (const v of product.variants) {
      units += v.confirmedUnits
      expect(v.confirmedUnits).toBeLessThanOrEqual(v.stock)
      expect(v.remaining).toBe(v.stock - v.confirmedUnits)
      const winnerUnits = v.winnerClaims.reduce((sum, id) => sum + (byId.get(id)?.qty ?? Number.NaN), 0)
      expect(winnerUnits).toBe(v.confirmedUnits)
      for (const id of v.waitlistClaims) expect(byId.get(id)?.qty).toBe(1)
      for (const id of [...v.winnerClaims, ...v.waitlistClaims]) expect(byId.get(id)?.key).toBe(v.key)
      if (onSale) {
        expect(v.status).toBe(v.remaining === 0 ? 'SOLD' : 'OPEN')
        // 남은 자리가 있는데 대기자가 있으면 승계 결정 필요 표시가 있어야 한다 (교체 WAITLIST로 빈 자리를 둔 경우 제외)
        if (!replacedToWaitlist && v.remaining > 0 && v.waitlist.length > 0) expect({ variant: v.key, awaiting: v.awaitingSuccession }).toEqual({ variant: v.key, awaiting: true })
      } else expect(v.status).toBe(product.status)
    }
    expect(product.confirmedUnits).toBe(units)
    if (onSale) expect(product.status).toBe(product.variants.every((v) => v.status === 'SOLD') ? 'SOLD' : 'OPEN')
  }
  // INV-2(변형 판): 지금의 구매자 × 찜 키 활성 찜 ≤ 1
  const active = claims.filter((c) => ['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT'].includes(c.status))
  const seen = new Set<string>()
  for (const c of active) {
    const key = `${c.currentBuyer}|${c.key}`
    expect(seen.has(key), `INV-2 ${key}`).toBe(false)
    seen.add(key)
  }
  for (const buyer of listBuyers(state)) {
    expect(isMoney(buyer.subtotal)).toBe(true)
    if (buyer.current !== buyer.id) continue
    const own = claims.filter((c) => c.status === 'CONFIRMED' && c.currentBuyer === buyer.id)
    expect(buyer.subtotal).toBe(own.reduce((sum, c) => sum + (c.amount as number), 0))
  }
  for (const c of claims) {
    if (c.amount !== null) {
      expect(isMoney(c.amount)).toBe(true)
      expect(c.amount).toBe((c.price as number) * c.qty)
    }
  }
  for (const s of listSettlements(state)) for (const amount of [s.subtotal, s.shipping, s.received, s.refundDue]) expect(isMoney(amount)).toBe(true)
}

describe('O1 무작위 옵션 방송 (AC-O1-10·20·28·29·30)', () => {
  it('매 이벤트 뒤 변형·수량 판 불변식, 끝에 INV-O2·INV-4·JSON 왕복·INV-12', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const { log, states } = build(s)
        const replacedToWaitlist = log.some((e) => e.type === 'host.assign' && (e as { replaceTo?: string }).replaceTo === 'WAITLIST')
        for (const state of states) checkViews(state, replacedToWaitlist)
        const last = states.at(-1) as EngineState
        // INV-O2
        const cleared = { ...last, reviews: initEngine({ broadcasts: [], settings: {} }).reviews }
        expect(listProducts(cleared)).toEqual(listProducts(last))
        expect(listBuyers(cleared)).toEqual(listBuyers(last))
        expect(listEffects(cleared)).toEqual(listEffects(last))
        expect(listSettlements(cleared)).toEqual(listSettlements(last))
        // INV-4
        expect(JSON.stringify(replay(s, log))).toBe(JSON.stringify(last))
        // JSON 왕복 뒤 이어 재생 = 처음부터
        const cut = Math.floor(log.length / 2)
        const mid = JSON.parse(JSON.stringify(states[cut])) as EngineState
        expect(observe(replay(s, log.slice(cut), mid))).toEqual(observe(last))
        // INV-12: 채팅·문자찜 사본(본문·내용을 바꾼 것 포함)을 첫 수신 뒤 바로 다음 이벤트 앞에 끼운다
        const withCopies: Logged[] = []
        log.forEach((event, i) => {
          withCopies.push(event)
          const earlier = log.slice(0, i + 1).filter((e) => e.type === 'chat' || e.type === 'sms')
          if (earlier.length === 0 || i % 3 !== 0) return
          const original = earlier[i % earlier.length] as Logged & { text?: string; qty?: number }
          const copy = original.type === 'chat' ? { ...original, text: '반바지 L 2개' } : { ...original, qty: 1, no: 11 }
          const { options: _drop, ...plain } = copy as Record<string, unknown>
          withCopies.push({ ...(original.type === 'sms' ? plain : copy), seq: event.seq + 5, at: event.at } as Logged)
        })
        expect(observe(replay(s, withCopies))).toEqual(observe(last))
      }),
      { numRuns: 300, seed: 20261022 },
    )
  })
})
