// AC-O4-04~07 리허설 가짜 채팅 생성기의 옵션 댓글 (YT-09 AC2, D-O4-01, D-082, R-19·R-20).
// 옵션 방송(claim.parseMode=OPTIONS)에서만 옵션·수량 댓글과 확인 필요 감(review)을 섞고, 보낸 글이 그 종류로 읽히는지 코어 parseOptionComment로 다시 본다.
import { readFileSync } from 'node:fs'
import {
  FOCUS_GRACE_SEC,
  applyEvent,
  getBroadcast,
  initEngine,
  listProducts,
  listReviews,
  parseOptionComment,
  type EngineEvent,
  type EngineState,
  type OptionCatalogEntry,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { checkReplay } from '../src/check-replay.ts'
import { ChatMaker, generatorView, type GeneratedChat, type GeneratorView, type MessageKind } from '../src/generator.ts'
import { addSeller, client, expectOk, immediateTimer, newWorld, rid, waitFor, writeEvent, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-28'
const AT = Date.UTC(2026, 9, 28, 11, 0, 0)

const SHORTS = { type: 'product.register', no: 21, name: '반바지', price: 10000, stocks: { M: 1, L: 2 }, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['엠'] }, { label: 'L' }] }] }
const TEE = {
  type: 'product.register',
  no: 22,
  name: '반팔티',
  price: 15000,
  stocks: { '105/검정색': 2 },
  options: [
    { name: '사이즈', choices: [{ label: '95' }, { label: '100' }, { label: '105', price: 2000 }] },
    { name: '색상', choices: [{ label: '흰색', aliases: ['화이트'] }, { label: '검정색', aliases: ['검정', '블랙'] }] },
  ],
}
const CHOCO = { type: 'product.register', no: 11, name: '초코 과자', price: 2000, stock: 5, aliases: ['초코'] }

/** 코어만으로 만든 옵션 방송 리허설 보기: 초코 과자(옵션 없음) → 반바지 → 반팔티 순 등록이라 지금 상품 = 22 반팔티 */
function optionState(): { state: EngineState; seq: number } {
  let state = initEngine({ broadcasts: [], settings: {} })
  let seq = 0
  const apply = (event: Record<string, unknown>) => {
    state = applyEvent(state, { ...event, seq: ++seq, at: AT + seq * 1000 } as unknown as EngineEvent).state
  }
  apply({ type: 'broadcast.start', b: 'b1', date: DAY, title: '의류 리허설', settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } })
  for (const product of [CHOCO, SHORTS, TEE]) apply({ ...product, b: 'b1' })
  return { state, seq }
}

function catalogOf(view: GeneratorView): OptionCatalogEntry[] {
  return view.products.filter((p) => p.status !== 'CLOSED').map((p) => ({ no: p.no, name: p.name ?? '', aliases: p.aliases ?? [], options: p.options ?? [] }))
}

interface Made {
  readonly made: GeneratedChat
  readonly view: GeneratorView
}

/** 생성기 → 코어 엔진에 바로 넣으며(상태가 바뀌는 보기) n건 만든다. 채팅 시각은 지금 상품을 정한 지 15초가 넘게 둔다 */
function generate(seed: number, n: number): Made[] {
  let { state, seq } = optionState()
  const maker = new ChatMaker('b1', seed, 0)
  const out: Made[] = []
  for (let i = 0; i < n; i++) {
    const view = generatorView(state, 'b1') as GeneratorView
    const made = maker.next(view)
    out.push({ made, view })
    const { b, id, ch, nick, text, owner } = made.chat
    state = applyEvent(state, { type: 'chat', b, id, ch, nick, text, ...(owner === true ? { owner } : {}), seq: ++seq, at: AT + 60_000 + seq * 1000 } as unknown as EngineEvent).state
  }
  return out
}

describe('AC-O4-04 옵션 방송에서만 옵션 모양·확인 필요 감을 섞는다', () => {
  it('지금 상품 = 22 반팔티, 보기에 이름·별칭·옵션·변형 남은 수량이 있다', () => {
    const view = generatorView(optionState().state, 'b1') as GeneratorView
    expect(view.focus).toBe(22)
    expect(view.products.map((p) => [p.no, p.name, p.aliases])).toEqual([
      [11, '초코 과자', ['초코']],
      [21, '반바지', []],
      [22, '반팔티', []],
    ])
    expect(view.products.find((p) => p.no === 21)?.variants?.map((v) => [v.options, v.remaining])).toEqual([
      [[['사이즈', 'S']], 1],
      [[['사이즈', 'M']], 1],
      [[['사이즈', 'L']], 2],
    ])
  })

  for (const seed of [1, 42, 9_001]) {
    it(`시드 ${String(seed)}: 1,000건에 모든 종류(review 포함)가 있고, 선택지·별칭·수량·이름 없는 주문이 나온다`, () => {
      const all = generate(seed, 1000)
      const kinds = new Map<MessageKind, number>()
      for (const { made } of all) kinds.set(made.kind, (kinds.get(made.kind) ?? 0) + 1)
      for (const kind of ['order', 'pendingOrder', 'review', 'mention', 'cancel', 'talk', 'nickChange', 'sameNick', 'owner', 'resend'] as const) {
        expect(kinds.get(kind) ?? 0, kind).toBeGreaterThan(0)
      }
      const orders = all.filter(({ made }) => made.kind === 'order').map(({ made }) => made.chat.text)
      const choiceWords = ['S', 'M', '엠', 'L', '95', '100', '105', '흰색', '화이트', '검정색', '검정', '블랙']
      expect(orders.some((t) => choiceWords.some((w) => t.split(' ').includes(w)))).toBe(true)
      expect(orders.some((t) => / [23]개?$/.test(t))).toBe(true) // 수량이 붙은 주문
      const named = (t: string) => ['11', '21', '22', '11번', '21번', '22번', '반팔티', '반바지', '초코'].includes(t.split(' ')[0] as string) || t.startsWith('찜')
      expect(orders.some((t) => !named(t))).toBe(true) // 이름·번호 없이 선택지만 (지금 상품)
    })
  }

  it('옵션 없는 상품(초코 과자)은 이름·이름 수량·번호 모양으로 주문한다 (시드 1~20)', () => {
    const texts = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) for (const { made } of generate(seed, 300)) if (made.kind === 'order' && /^(초코 과자|11|찜11)/.test(made.chat.text)) texts.add(made.chat.text.replace(/ [23]개?$/, ' Q'))
    expect([...texts].sort()).toEqual(expect.arrayContaining(['11', '초코 과자', '초코 과자 Q']))
  })
})

describe('AC-O4-05 보내는 글은 그 종류로 읽힌다 (코어 parseOptionComment, 지금 상품 정한 지 15초)', () => {
  for (const seed of [3, 77, 2_024, 65_535, 2_147_483_647]) {
    it(`시드 ${String(seed)}`, () => {
      for (const { made, view } of generate(seed, 600)) {
        const parsed = parseOptionComment(made.chat.text, catalogOf(view), view.focus == null ? null : { no: view.focus, ageSec: FOCUS_GRACE_SEC }, view.settings)
        const label = `${made.kind} ${made.chat.text}`
        const maxQuantity = view.settings['claim.maxQuantity']
        switch (made.kind) {
          case 'order': {
            expect(parsed.orders, label).toHaveLength(1)
            expect(parsed.review, label).toBeNull()
            expect(parsed.cancels, label).toEqual([])
            const order = parsed.orders[0]
            const product = view.products.find((p) => p.no === order?.no)
            expect(product?.status, label).toBe('OPEN')
            expect(order?.qty, label).toBeGreaterThanOrEqual(1)
            expect(order?.qty, label).toBeLessThanOrEqual(maxQuantity)
            for (const item of product?.options ?? []) expect(order?.options?.[item.name], label).toBeDefined()
            break
          }
          case 'pendingOrder': {
            expect(parsed.orders, label).toHaveLength(1)
            expect(parsed.review, label).toBeNull()
            expect(view.products.some((p) => p.no === parsed.orders[0]?.no), label).toBe(false)
            break
          }
          case 'review':
            expect(parsed.review, label).not.toBeNull()
            break
          case 'mention':
            expect(parsed.orders, label).toEqual([])
            expect(parsed.cancels, label).toEqual([])
            expect(parsed.review, label).toBeNull()
            break
          case 'cancel':
            expect(parsed.cancels, label).toHaveLength(1)
            expect(parsed.orders, label).toEqual([])
            break
          default:
            break
        }
      }
    })
  }
})

describe('AC-O4-06 같은 시드·같은 보기면 같은 순서, 생성기는 시계·난수를 직접 쓰지 않는다', () => {
  it('두 번 만든 결과가 같고, 시드가 다르면 다르다', () => {
    const strip = (list: Made[]) => list.map(({ made }) => made)
    expect(strip(generate(5, 400))).toEqual(strip(generate(5, 400)))
    expect(strip(generate(5, 400))).not.toEqual(strip(generate(6, 400)))
  })

  it('generator.ts에 Math.random·Date.now 호출이 없다', () => {
    const source = readFileSync(new URL('../src/generator.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/Math\.random\s*\(/)
    expect(source).not.toMatch(/Date\.now\s*\(/)
  })
})

describe('AC-O4-07 옵션 방송 리허설에 생성기 500건 — 재생 일치·INV-1·확인 필요·리허설 효과 없음', () => {
  async function rows<T>(world: TestServer, sql: string): Promise<T[]> {
    return ((await world.database.pglite?.query<T>(sql))?.rows ?? []) as T[]
  }

  it('시험 서버(PGlite)', async () => {
    const world = await newWorld({ generatorTimer: immediateTimer })
    const seller: Seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const created = await expectOk(api.post('/api/broadcasts', { requestId: rid('bc'), date: DAY, rehearsal: true, saleMode: 'OPTIONS' }))
    const b = (created.body.broadcast as { id: string }).id
    for (const product of [CHOCO, SHORTS, TEE]) await expectOk(writeEvent(world, seller, { ...product, b }))
    const started = await expectOk(api.post(`/api/broadcasts/${b}/rehearsal/generator/start`, { total: 500, perSecond: 50, seed: 4_242 }))
    expect((started.body.generator as { running: boolean }).running).toBe(true)
    await waitFor(async () => !((await api.get(`/api/broadcasts/${b}/rehearsal/generator`)).body.generator as { running: boolean }).running, 120_000)
    const final = (await api.get(`/api/broadcasts/${b}/rehearsal/generator`)).body.generator as { sent: number; failed: number; stopReason: string }
    expect(final).toMatchObject({ sent: 500, failed: 0, stopReason: 'completed' })

    // 재생 결과 = 저장 상태·발송함
    const replay = await checkReplay(world.database.db, { rehearsal: true })
    expect(replay.length).toBeGreaterThan(0)
    for (const result of replay) expect(result.ok, JSON.stringify(result)).toBe(true)

    const state = (await world.server.writer.read(seller.sellerId, DAY, true)).state
    expect(getBroadcast(state, b)?.settings['claim.parseMode']).toBe('OPTIONS')
    // INV-1: 모든 변형의 확정 수량 ≤ 변형 재고, 옵션 없는 상품의 확정 수량 ≤ 재고
    for (const product of listProducts(state)) {
      if (product.hasOptions) for (const variant of product.variants) expect(variant.confirmedUnits, variant.key).toBeLessThanOrEqual(variant.stock)
      else expect(product.confirmedUnits, product.key).toBeLessThanOrEqual(product.stock)
    }
    expect(listProducts(state).some((product) => product.confirmedUnits > 0)).toBe(true)
    // 확인 필요 항목이 1개 이상
    expect(listReviews(state).length).toBeGreaterThan(0)
    // 리허설 효과는 실행하지 않음 (D-081): 실제 범위 발송함 행 0, 출력 작업 0
    expect(await rows<{ n: number }>(world, `select count(*)::int as n from outbox where rehearsal = false`)).toEqual([{ n: 0 }])
    expect(await rows<{ n: number }>(world, `select count(*)::int as n from print_jobs`)).toEqual([{ n: 0 }])
    expect((await api.get('/api/days')).body).toEqual({ days: [] })
    world.server.close()
  }, 180_000)
})
