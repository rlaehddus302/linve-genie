// O3 적대 시험 공용 도구 (test-domain, AC-O3-30). 테스트 파일이 아니다.
// - 무작위(결정적 PRNG) 다육 방송·옵션 방송 이벤트 로그를 실제 코어로 돌린다.
// - snapshot()은 엔진 상태 하나에서 라벨 데이터·내용 키·포장 데이터·라벨 그림 해시·확인서 데이터·대장 행을 모은다.
//   모듈을 인자로 받는다 — BASE 커밋의 src로 같은 함수를 돌려 고정값(fixtures/base-strict.json)을 만들 수 있게(gen-base.ts).
//   그래서 이 파일은 O3 전에도 있던 함수와 필드만 쓴다.
import { createHash } from 'node:crypto'
import type * as DocumentsModule from '@livejjim/documents'
import type * as LabelModule from '@livejjim/label'
import type * as LabelDataModule from '../../../apps/server/src/label-data.ts'
import type * as PackingModule from '../../../apps/server/src/packing.ts'
import { applyEvent, checkEvent, initEngine, listClaims, listSettlements, type EngineEvent, type EngineState, type SettingsOverride } from '@livejjim/core'

export const D1 = '2026-10-25'
export const D2 = '2026-10-26'
/** 2026-10-25 20:00:00 KST */
export const T0 = Date.UTC(2026, 9, 25, 11, 0, 0)
/** 확인서 만든 시각 (고정) */
export const CREATED_AT = Date.UTC(2026, 9, 26, 14, 30, 0)

/** 결정적 난수 (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T
const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1))

/** 실제 시청자가 쓸 법한 닉네임 + HTML·수식 모양·이모지·제로폭·아주 긴 이름 */
export const NICKS = ['홍길동', '김철수', '<b>다육</b>맘', '=1+1', '+82 이모', '@초록', '🌵선인장🌵', '이​영희', '　전각 공백　', '아주아주아주아주아주아주아주아주아주아주긴닉네임입니다정말로요']
export const BUYERS = ['UC_A', 'UC_B', 'UC_C', 'UC_D', 'UC_E', 'UC_F']
/** 품종 — 빈 품종·HTML·수식 모양·긴 품종 */
export const NAMES = ['핑크프릴', '', '<script>x</script>', '=SUM(A1)', '라울', '블랙프린스 금 대형 군생 한 판 특가 상품입니다', '🌸 벚꽃', '-1+2']

export interface Scenario {
  readonly broadcasts: readonly { id: string; date: string; title: string }[]
  readonly settings: SettingsOverride
  readonly events: readonly Record<string, unknown>[]
}

export interface Played {
  readonly state: EngineState
  /** 적용한(입력 오류가 아닌) 이벤트 */
  readonly applied: readonly Record<string, unknown>[]
}

/** 입력 오류 이벤트는 건너뛴다(서버가 기록하지 않는다) */
export function play(s: Scenario): Played {
  let state = initEngine({ broadcasts: s.broadcasts, settings: s.settings })
  const applied: Record<string, unknown>[] = []
  let seq = 0
  s.events.forEach((event, i) => {
    const full = { at: T0 + i * 7000, ...event, seq: seq + 1 } as unknown as EngineEvent
    if (checkEvent(state, full).length > 0) return
    seq++
    state = applyEvent(state, full).state
    applied.push(event)
  })
  return { state, applied }
}

/** 다육(STRICT)만 있는 무작위 판매: 같은 날 두 방송 + 다음 날 한 방송. 옵션·수량 칸은 하나도 없다 */
export function strictScenario(seed: number): Scenario {
  const r = rng(seed)
  const broadcasts = [
    { id: 'b1', date: D1, title: '다육 1부' },
    { id: 'b2', date: D1, title: '<i>다육</i> 2부' },
    { id: 'b3', date: D2, title: '=다음 날' },
  ]
  const events: Record<string, unknown>[] = []
  const nos: Record<string, number[]> = { b1: [], b2: [], b3: [] }
  for (const b of ['b1', 'b2', 'b3']) {
    const count = int(r, 2, 6)
    for (let k = 0; k < count; k++) {
      const no = r() < 0.1 ? 9999 : int(r, 1, 40)
      if (nos[b]?.includes(no)) continue
      nos[b]?.push(no)
      const price = pick(r, [0, 1000, 8000, 12500, 15000, 99_999_000, 100])
      events.push({ type: 'product.register', b, no, name: pick(r, NAMES), price, ...(r() < 0.3 ? { stock: int(r, 2, 3) } : {}) })
    }
  }
  const steps = int(r, 15, 45)
  let m = 0
  let s = 0
  for (let k = 0; k < steps; k++) {
    const b = pick(r, ['b1', 'b2', 'b3'])
    const list = nos[b] as number[]
    if (list.length === 0) continue
    const no = pick(r, list)
    const bi = int(r, 0, BUYERS.length - 1)
    const roll = r()
    if (roll < 0.55) {
      const text = r() < 0.8 ? String(no) : r() < 0.5 ? `${String(no)} 취소` : `${String(no)} ${String(pick(r, list))}`
      events.push({ type: 'chat', b, id: `m${String(++m)}`, ch: BUYERS[bi], nick: NICKS[bi], text })
    } else if (roll < 0.65) {
      events.push({ type: 'sms', b, ref: `s${String(++s)}`, no, received: '20:30', memo: pick(r, ['이영희', '<b>메모</b>', '=HYPERLINK("x")']), phoneKey: `${'k'.repeat(42)}${String(s % 3)}`, phoneLast4: pick(r, ['5678', '0000', '1234']) })
    } else if (roll < 0.72) {
      events.push({ type: 'host.cancel', b, no, buyer: BUYERS[bi], reason: '사유' })
    } else if (roll < 0.78) {
      events.push({ type: 'host.assign', b, no, buyer: BUYERS[bi], reason: '사유' })
    } else if (roll < 0.83) {
      events.push({ type: 'buyer.merge', from: BUYERS[bi], into: pick(r, BUYERS), reason: '사유' })
    } else if (roll < 0.86) {
      events.push({ type: 'buyer.unmerge', from: BUYERS[bi], reason: '사유' })
    } else if (roll < 0.92) {
      events.push({ type: 'settlement.payment', buyer: BUYERS[bi], date: b === 'b3' ? D2 : D1, amount: pick(r, [1000, 8000, 50_000]), memo: '입금' })
    } else if (roll < 0.95) {
      events.push({ type: 'product.update', b, no, price: pick(r, [3000, 9000]), applyTo: r() < 0.5 ? 'UNPAID_CLAIMS' : 'NEW_ONLY' })
    } else {
      events.push({ type: 'settlement.shippingOverride', buyer: BUYERS[bi], date: D1, mode: pick(r, ['PICKUP', 'COMBINED', 'DEFAULT']) })
    }
  }
  return { broadcasts, settings: {}, events }
}

const SIZES = [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L', price: 500 }] }]
const TEE = [
  { name: '사이즈', choices: [{ label: '95' }, { label: '100' }, { label: '105', price: 2000 }] },
  { name: '색상', choices: [{ label: '흰색', aliases: ['화이트'] }, { label: '검정색', aliases: ['블랙'] }] },
]
const CASE = [{ name: '기종', choices: [{ label: '아이폰 17 프로 맥스' }, { label: '갤럭시 S26 울트라' }] }, { name: '색상', choices: [{ label: '투명' }, { label: '<i>빨강' }, { label: '=2+3' }] }]

export interface OptionProduct {
  readonly no: number
  readonly name: string
  readonly options: readonly { name: string; choices: readonly { label: string }[] }[]
}
export const OPTION_PRODUCTS: readonly OptionProduct[] = [
  { no: 21, name: '반바지', options: SIZES },
  { no: 22, name: '반팔티', options: TEE },
  { no: 11, name: '초코 과자', options: [] },
  { no: 31, name: '=1+1 케이스', options: CASE },
  { no: 12, name: '', options: [] },
]

/** 옵션 방송(b2, maxQuantity 99) + 같은 날 다육 방송(b1) 무작위 판매 */
export function optionScenario(seed: number): Scenario {
  const r = rng(seed)
  const broadcasts = [{ id: 'b1', date: D1, title: '다육 1부' }]
  const events: Record<string, unknown>[] = [
    { type: 'product.register', b: 'b1', no: 7, name: '핑크프릴', price: 8000 },
    { type: 'product.register', b: 'b1', no: 8, name: '<b>라울</b>', price: 12000, stock: 2 },
    { type: 'broadcast.start', b: 'b2', date: D1, title: '의류 2부', settings: { 'claim.parseMode': 'OPTIONS', 'claim.maxQuantity': 99 } },
  ]
  for (const p of OPTION_PRODUCTS) {
    const price = pick(r, [2000, 15000, 111_111, 0])
    const stock = int(r, 1, 120)
    events.push({ type: 'product.register', b: 'b2', no: p.no, name: p.name, price, stock, ...(p.options.length > 0 ? { options: p.options } : {}) })
  }
  const steps = int(r, 20, 60)
  let m = 0
  let s = 0
  const choiceOf = (p: OptionProduct): Record<string, string> | undefined => {
    if (p.options.length === 0) return undefined
    const out: Record<string, string> = {}
    for (const item of p.options) out[item.name] = pick(r, item.choices).label
    return out
  }
  for (let k = 0; k < steps; k++) {
    const bi = int(r, 0, BUYERS.length - 1)
    const roll = r()
    if (roll < 0.1) {
      events.push({ type: 'chat', b: 'b1', id: `t${String(++m)}`, ch: BUYERS[bi], nick: NICKS[bi], text: pick(r, ['7', '8', '7 취소', '8 7']) })
      continue
    }
    const p = pick(r, OPTION_PRODUCTS)
    const qty = pick(r, [1, 1, 2, 3, 10, 60, 99])
    const options = choiceOf(p)
    if (roll < 0.5) {
      events.push({ type: 'host.assign', b: 'b2', no: p.no, buyer: BUYERS[bi], reason: '사유', qty, ...(options === undefined ? {} : { options }) })
    } else if (roll < 0.65) {
      events.push({ type: 'sms', b: 'b2', ref: `s${String(++s)}`, no: p.no, received: '21:00', memo: '이영희', phoneKey: `${'k'.repeat(42)}${String(s % 2)}`, phoneLast4: '5678', qty, ...(options === undefined ? {} : { options }) })
    } else if (roll < 0.8) {
      const text = options === undefined ? `${p.name === '' ? String(p.no) : p.name} ${String(qty)}개` : `${String(p.no)} ${Object.values(options).join(' ')} ${String(qty)}개`
      events.push({ type: 'chat', b: 'b2', id: `m${String(++m)}`, ch: BUYERS[bi], nick: NICKS[bi], text })
    } else if (roll < 0.9) {
      events.push({ type: 'host.cancel', b: 'b2', no: p.no, buyer: BUYERS[bi], reason: '사유', ...(options === undefined ? {} : { options }) })
    } else if (roll < 0.95) {
      events.push({ type: 'buyer.merge', from: BUYERS[bi], into: pick(r, BUYERS), reason: '사유' })
    } else {
      events.push({ type: 'product.update', b: 'b2', no: p.no, price: pick(r, [3000, 9000]), applyTo: 'UNPAID_CLAIMS' })
    }
  }
  return { broadcasts, settings: {}, events }
}

// ── 결과 모으기 (BASE에도 있던 함수만) ─────────────────────────────

/** BASE·지금 두 트리의 모듈을 같은 모양으로 받는다 (O3 전에도 있던 함수만 부른다) */
export interface Mods {
  readonly labelData: typeof LabelDataModule
  readonly packing: typeof PackingModule
  readonly label: typeof LabelModule
  readonly documents: typeof DocumentsModule
  readonly env: LabelModule.LabelRenderEnv
}

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex').slice(0, 24)

export interface Snapshot {
  readonly product: Record<string, unknown>
  readonly packing: Record<string, unknown>
  readonly receipts: Record<string, unknown>
  readonly batch: unknown
  readonly ledger: unknown
}

/** 상태 하나의 문서·라벨 결과. 키는 찜 ID·(구매자, 날짜) */
export function snapshot(state: EngineState, mods: Mods): Snapshot {
  const { labelData, packing, label, documents, env } = mods
  const index = labelData.buildClaimIndex(state)
  const product: Record<string, unknown> = {}
  for (const claim of listClaims(state)) {
    if (claim.status !== 'CONFIRMED' || claim.confirmVersion === null) continue
    const buyer = labelData.productLabelBuyer(state, claim)
    const data = labelData.productLabelData(state, index, { claim: claim.id, version: claim.confirmVersion, buyer })
    const rendered = data === null ? null : label.renderProductLabel(env, label.defaultTemplate('product'), data)
    product[claim.id] = {
      data,
      key: data === null ? null : labelData.contentKeyOf('product', data),
      image: rendered === null ? null : rendered.ok ? hash(rendered.image.data) : `error:${String(rendered.error.code)}`,
    }
  }
  const packs: Record<string, unknown> = {}
  const receipts: Record<string, unknown> = {}
  for (const settlement of listSettlements(state)) {
    if (settlement.items.length === 0) continue
    const id = `${settlement.buyer}@${settlement.date}`
    const a = labelData.packingLabelData(state, settlement.buyer, settlement.date)
    const b = packing.packingLabelData(state, settlement.date, settlement.buyer)
    const rendered = b === null ? null : label.renderPackingLabels(env, label.defaultTemplate('packing'), b)
    packs[id] = {
      labelData: a,
      packingData: b,
      key: a === null ? null : labelData.contentKeyOf('packing', a.data),
      images: rendered === null ? null : rendered.ok ? rendered.pages.map((page) => hash(page.image.data)) : `error:${String(rendered.error.code)}`,
    }
    receipts[id] = documents.buildReceipt({ state, date: settlement.date, buyer: settlement.buyer, rehearsal: false, createdAt: CREATED_AT, shop: { name: '초록 다육' } })
  }
  const batch = [D1, D2].map((date) => documents.buildReceipts({ state, date, rehearsal: false, createdAt: CREATED_AT }))
  const ledgerResult = documents.buildLedger({ scopes: [{ state, rehearsal: false }], from: D1, to: D2 })
  const ledger = ledgerResult.ok ? { rows: ledgerResult.rows, values: ledgerResult.rows.map((row) => documents.ledgerRowValues(row)) } : ledgerResult
  return { product, packing: packs, receipts, batch, ledger }
}

/** 고정값에 쓰는 다육 시나리오 씨앗 */
export const STRICT_SEEDS: readonly number[] = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919)
