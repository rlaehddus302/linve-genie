// I2 화면 (AC-I2-02·13·15·35~38·52·65·80~82): 포장 모드(실제 코어로 도는 가짜 서버 + 가짜 포장 기록), 설정, 상품 목록 가져오기, 확인서 공유.
import { listBroadcasts, listBuyers, listProducts, listSettlements } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { PackingEntry, PackingItem, PackingWord } from '../src/api/types.ts'
import { ImportDialog } from '../src/components/ImportDialog.tsx'
import { PackingPage } from '../src/components/PackingPage.tsx'
import { ReceiptSection } from '../src/components/ReceiptSection.tsx'
import { BackupSection, ExportSection, ShopForm } from '../src/components/SettingsPage.tsx'
import type { Route } from '../src/lib/router.ts'
import { chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, FakeServer, apiError, flush, type Call, type Reply } from './support.ts'

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

// ── 포장 모드 ────────────────────────────────────────────────────────────

/**
 * 가짜 포장 기록: 구매자마다 단계(대기·포장·배송)와 포장한 품목. 상태 말은 지금 품목과 견준다(서버 packingWord와 같은 규칙).
 * 포장 명령으로 적은 기록은 품목마다 상품 ID·품종도 남겨 (상품 ID, 상품 키) 쌍으로 견준다(D-I2-19). 시험이 직접 넣은 기록(키만)은 키로만 견준다.
 */
class FakePacking {
  readonly records = new Map<string, { phase: 'WAITING' | 'PACKED' | 'SHIPPED'; packed: string[]; invoice: string | null; ids?: Record<string, { id: string; name: string }> }>()
  readonly posts: Record<string, unknown>[] = []
  readonly #seen = new Map<string, unknown>()
  /** 다음 명령을 이 응답으로 대신한다 */
  failNext: Reply | null = null

  readonly engine: EngineServer

  constructor(engine: EngineServer) {
    this.engine = engine
    engine.server
      .on('GET', new RegExp(`^/api/days/${DATE}/packing$`), () => ({ body: { date: DATE, seq: engine.seq, entries: this.entries() } }))
      .on('POST', new RegExp(`^/api/days/${DATE}/packing$`), (call) => this.#command(call))
      .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\?`), () => ({ body: { date: DATE, buyer: 'c1', data: {}, pages: 1 } }))
      .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\.png\\?`), () => ({ body: {} }))
  }

  entries(): PackingEntry[] {
    const state = this.engine.state
    const products = new Map(listProducts(state).map((product) => [product.key, product]))
    const titles = new Map(listBroadcasts(state).map((broadcast) => [broadcast.id, broadcast.title]))
    const displays = new Map(listBuyers(state).map((buyer) => [buyer.id, buyer.display]))
    const out: PackingEntry[] = []
    for (const settlement of listSettlements(state)) {
      const record = this.records.get(settlement.buyer) ?? { phase: 'WAITING' as const, packed: [], invoice: null }
      if (settlement.items.length === 0 && record.phase === 'WAITING') continue
      const items: PackingItem[] = settlement.items.map((key) => {
        const product = products.get(key)
        return { key, broadcast: product?.broadcast ?? '', title: titles.get(product?.broadcast ?? '') ?? '', no: product?.no ?? 0, name: product?.name ?? '', price: product?.price ?? 0, id: product?.id ?? '' }
      })
      const ids = record.ids
      const nowIds = new Map(items.map((x) => [x.key, x.id]))
      // 지금 품목에 (상품 ID, 키) 쌍으로 있는가
      const kept = (key: string) => nowIds.has(key) && (ids === undefined || ids[key]?.id === nowIds.get(key))
      const now = new Set(settlement.items)
      const same = record.packed.length === now.size && record.packed.every(kept)
      const status: PackingWord = record.phase === 'WAITING' ? '포장 대기' : record.phase === 'PACKED' ? (same ? '포장 완료' : '포장 다시 확인') : same ? '배송 완료' : '배송 뒤 바뀜'
      const changed = status === '포장 다시 확인' || status === '배송 뒤 바뀜'
      out.push({
        buyer: settlement.buyer,
        name: displays.get(settlement.buyer) ?? settlement.buyer,
        phoneLast4: null,
        payment: settlement.payment,
        items,
        status,
        invoice: record.phase === 'SHIPPED' ? record.invoice : null,
        add: changed ? items.filter((x) => !record.packed.includes(x.key) || (ids !== undefined && ids[x.key]?.id !== x.id)) : [],
        remove: changed
          ? record.packed
              .filter((key) => !kept(key))
              .map((key) => ({ key, broadcast: key.split('/')[0] ?? '', title: titles.get(key.split('/')[0] ?? '') ?? '', no: Number(key.split('/')[1]), ...(ids?.[key] === undefined ? {} : { name: ids[key].name, id: ids[key].id }) }))
          : [],
      })
    }
    return out
  }

  #command(call: Call): Reply {
    const body = call.body ?? {}
    this.posts.push(body)
    const prior = this.#seen.get(String(body.requestId))
    if (prior !== undefined) return prior as Reply
    if (this.failNext !== null) {
      const reply = this.failNext
      this.failNext = null
      return reply
    }
    const buyer = String(body.buyer)
    const entry = () => this.entries().find((item) => item.buyer === buyer)
    const current = entry()
    if (current === undefined) return apiError(400, 'BUYER_NOT_FOUND', '구매자를 다시 확인해 주세요.')
    let reply: Reply
    if (body.action === 'pack') {
      // 품목: { key, qty }(화면이 본 수량) 또는 키 글(수량 1로 읽는다 — 서버 D-O4-05와 같은 셈)
      const sent = (body.items as (string | { key: string; qty: number })[]).map((item) => (typeof item === 'string' ? { key: item, qty: 1 } : item))
      const items = sent.map((item) => item.key)
      const qtyOf = new Map(current.items.map((item) => [item.key, item.qty ?? 1]))
      if (items.length !== qtyOf.size || !sent.every((item) => qtyOf.get(item.key) === item.qty)) {
        reply = { status: 409, body: { error: { code: 'ITEMS_CHANGED', message: '그 사이에 구매 내역이 바뀌었어요. 다시 확인해 주세요.' }, entry: current } }
      } else {
        this.records.set(buyer, { phase: 'PACKED', packed: [...items], invoice: null, ids: Object.fromEntries(current.items.map((x) => [x.key, { id: x.id ?? '', name: x.name }])) })
        reply = { body: { date: DATE, entry: entry(), recorded: true } }
      }
    } else if (body.action === 'ship') {
      const record = this.records.get(buyer)
      if (record === undefined) return apiError(409, 'PACKING_STATE', '포장 완료 뒤에 배송 완료로 적을 수 있어요.')
      if (typeof body.invoice === 'string' && body.invoice.startsWith('010')) {
        return { status: 400, body: { error: { code: 'INVALID_INPUT', message: '전화번호처럼 보여요. 송장번호를 확인해 주세요.', problems: [{ field: 'invoice', message: '전화번호처럼 보여요. 송장번호를 확인해 주세요.' }] } } }
      }
      this.records.set(buyer, { ...record, phase: 'SHIPPED', invoice: typeof body.invoice === 'string' ? body.invoice.replace(/\D/g, '') : null })
      reply = { body: { date: DATE, entry: entry(), recorded: true } }
    } else if (body.action === 'unpack') {
      this.records.delete(buyer)
      reply = { body: { date: DATE, entry: entry(), recorded: true } }
    } else {
      const record = this.records.get(buyer)
      if (record !== undefined) this.records.set(buyer, { ...record, phase: 'PACKED' })
      reply = { body: { date: DATE, entry: entry(), recorded: true } }
    }
    this.#seen.set(String(body.requestId), reply)
    return reply
  }
}

/** 가나: 15·28번 · 다라: 41번(포장 완료) · 마바: 42번(입금 완료) */
const BASE = [
  register(15, '핑크프릴', 10000),
  register(28, '청보석', 5000),
  register(41, '사파이어', 3000),
  register(42, '', 4000),
  chat('m1', 'c1', '가나', '15'),
  chat('m2', 'c1', '가나', '28'),
  chat('m3', 'c2', '다라', '41'),
  chat('m4', 'c3', '마바', '42'),
  { type: 'settlement.payment', buyer: 'c3', date: DATE, amount: 8000 },
]

function PackingHarness({ initial }: { readonly initial: Route }) {
  const [route, setRoute] = useState<Route>(initial)
  return route.name === 'packing' ? <PackingPage route={route} navigate={setRoute} /> : null
}

async function openPacking(buyer?: string) {
  const engine = new EngineServer(BASE)
  const packing = new FakePacking(engine)
  packing.records.set('c2', { phase: 'PACKED', packed: ['b1/41'], invoice: null })
  vi.stubGlobal('fetch', engine.server.fetch)
  render(<PackingHarness initial={{ name: 'packing', date: DATE, ...(buyer === undefined ? {} : { buyer }) }} />)
  await flush(15)
  return { engine, packing }
}

const rows = () => within(screen.getByRole('list', { name: '포장할 구매자' })).getAllByRole('link')
const checklist = () => screen.getByRole('region', { name: '체크리스트' })

describe('포장 목록 (AC-I2-35)', () => {
  it('기본 "포장할 것": 줄마다 이름·상품 n개·상태 말·입금 완료가 아니면 입금 상태 — 걸러 보기마다 알맞은 빈 문장', async () => {
    await openPacking()
    expect(rows().map((row) => row.textContent)).toEqual(['가나상품 2개포장 대기미입금', '마바상품 1개포장 대기'])
    expect(screen.getByRole('button', { name: '포장할 것' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '포장 완료' }))
    expect(rows().map((row) => row.textContent)).toEqual(['다라상품 1개포장 완료미입금'])
    expect(within(rows()[0] as HTMLElement).getByText('포장 완료').getAttribute('data-tone')).toBe('success')
    fireEvent.click(screen.getByRole('button', { name: '배송 완료' }))
    expect(screen.getByText('배송 완료한 구매자가 없어요.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '전체' }))
    expect(rows()).toHaveLength(3)
    expect(rows()[0]?.getAttribute('href')).toBe(`/packing?date=${DATE}&buyer=c1`)
  })

  it('포장 알림(packing)이 오면 목록을 다시 받는다 — 증분 조회에는 포장 상태가 없다 (AC-I2-32)', async () => {
    const { engine, packing } = await openPacking()
    const before = engine.server.callsTo('GET', /\/packing$/).length
    packing.records.set('c1', { phase: 'PACKED', packed: ['b1/15', 'b1/28'], invoice: null })
    act(() => FakeEventSource.last.emit('packing', { date: DATE, buyer: 'c1' }))
    await flush(10)
    expect(engine.server.callsTo('GET', /\/packing$/).length).toBe(before + 1)
    expect(rows().map((row) => row.textContent)).toEqual(['마바상품 1개포장 대기'])
    // 다른 날짜의 알림은 무시
    act(() => FakeEventSource.last.emit('packing', { date: '2026-10-20', buyer: 'c1' }))
    await flush(10)
    expect(engine.server.callsTo('GET', /\/packing$/).length).toBe(before + 1)
  })
})

describe('체크리스트·포장 완료 (AC-I2-36)', () => {
  it('모두 체크해야 "포장 완료" — 누르면 체크한 품목과 함께 바로 보내고 "포장 완료로 적었어요."와 "다음 구매자"', async () => {
    const { packing } = await openPacking('c1')
    const region = checklist()
    expect(region.textContent).toContain('2026년 10월 19일(월)')
    expect(region.textContent).toContain('상품 2개')
    const pack = within(region).getByRole('button', { name: '포장 완료' })
    expect((pack as HTMLButtonElement).disabled).toBe(true)
    expect(region.textContent).toContain('모두 담으면 포장 완료를 누를 수 있어요.')
    fireEvent.click(within(region).getByRole('checkbox', { name: '15번 핑크프릴' }))
    expect(region.textContent).toContain('1/2 담음')
    fireEvent.click(within(region).getByRole('checkbox', { name: '28번 청보석' }))
    expect(region.textContent).toContain('2/2 담음')
    expect((pack as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(pack)
    await flush(10)
    expect(packing.posts).toHaveLength(1)
    // 화면 품목마다 { key, qty }, 화면 순서 (D-O4-05, AC-O4-21 — 키 글만 보내던 I2 모양을 바꿨다)
    expect(packing.posts[0]).toMatchObject({ buyer: 'c1', action: 'pack', items: [{ key: 'b1/15', qty: 1 }, { key: 'b1/28', qty: 1 }] })
    expect(typeof packing.posts[0]?.requestId).toBe('string')
    expect(checklist().textContent).toContain('포장 완료로 적었어요.')
    fireEvent.click(within(checklist()).getByRole('button', { name: '다음 구매자' }))
    await flush(5)
    expect(within(checklist()).getByRole('heading', { level: 2 }).textContent).toBe('마바')
    // 빈 품종은 "품종 미입력"
    expect(within(checklist()).getByRole('checkbox', { name: '42번 품종 미입력' })).toBeDefined()
  })

  it('연 동안 품목이 바뀌면: 새 품목은 체크 안 됨, 남은 체크는 그대로, "구매 내역이 바뀌었어요 — 새로 담을 것: 31번"', async () => {
    const { engine } = await openPacking('c1')
    fireEvent.click(within(checklist()).getByRole('checkbox', { name: '15번 핑크프릴' }))
    fireEvent.click(within(checklist()).getByRole('checkbox', { name: '28번 청보석' }))
    engine.write(register(31, '금황', 8000))
    engine.write(chat('m9', 'c1', '가나', '31'))
    await flush(20)
    const region = checklist()
    expect(region.textContent).toContain('구매 내역이 바뀌었어요 — 새로 담을 것: 31번')
    expect((within(region).getByRole('checkbox', { name: '15번 핑크프릴' }) as HTMLInputElement).checked).toBe(true)
    expect((within(region).getByRole('checkbox', { name: '31번 금황' }) as HTMLInputElement).checked).toBe(false)
    expect(region.textContent).toContain('2/3 담음')
    expect((within(region).getByRole('button', { name: '포장 완료' }) as HTMLButtonElement).disabled).toBe(true)
    // 체크는 이 기기 화면에만 — 브라우저 저장소에 두지 않는다 (AC-I2-81).
    // 합친 뒤(main I1): sessionStorage에는 실시간 연결이 밝히는 이 탭의 기기 ID(LABEL_RULES L-11 10, lib/device.ts) 하나만 있다 — 체크 상태가 아니다
    expect(localStorage.length).toBe(0)
    expect(Object.keys(sessionStorage).filter((key) => key !== 'livejjim.deviceId')).toEqual([])
  })

  it('보냈는데 그 사이 품목이 바뀌어 거절되면 같은 안내로 새 품목을 보인다 (영어 코드는 화면 글자에 없다)', async () => {
    const { engine, packing } = await openPacking('c1')
    fireEvent.click(within(checklist()).getByRole('checkbox', { name: '15번 핑크프릴' }))
    fireEvent.click(within(checklist()).getByRole('checkbox', { name: '28번 청보석' }))
    // 화면이 아직 모르는 변경 (알림 없이)
    engine.writeQuietly({ type: 'host.cancel', b: 'b1', no: 28, buyer: 'c1', reason: '시청자 요청' })
    fireEvent.click(within(checklist()).getByRole('button', { name: '포장 완료' }))
    await flush(15)
    expect(packing.records.get('c1')).toBeUndefined()
    const region = checklist()
    expect(region.textContent).toContain('구매 내역이 바뀌었어요 — 뺄 것: 28번')
    expect(region.textContent).not.toMatch(/ITEMS_CHANGED|PACKED|SHIPPED/)
    expect(within(region).queryByRole('checkbox', { name: '28번 청보석' })).toBeNull()
  })

  it('포장 다시 확인: 포장 때와 비교한 안내, 체크는 비어 있다 — 다시 모두 체크해 포장 완료', async () => {
    const engine = new EngineServer([...BASE, register(31, '금황', 8000), chat('m9', 'c1', '가나', '31')])
    const packing = new FakePacking(engine)
    packing.records.set('c1', { phase: 'PACKED', packed: ['b1/15', 'b1/28'], invoice: null })
    vi.stubGlobal('fetch', engine.server.fetch)
    render(<PackingHarness initial={{ name: 'packing', date: DATE, buyer: 'c1' }} />)
    await flush(15)
    const region = checklist()
    expect(region.textContent).toContain('포장 다시 확인')
    expect(region.textContent).toContain('구매 내역이 바뀌었어요 — 새로 담을 것: 31번')
    expect(region.textContent).toContain('0/3 담음')
    for (const name of ['15번 핑크프릴', '28번 청보석', '31번 금황']) fireEvent.click(within(region).getByRole('checkbox', { name }))
    fireEvent.click(within(region).getByRole('button', { name: '포장 완료' }))
    await flush(10)
    expect(packing.records.get('c1')?.packed).toEqual(['b1/15', 'b1/28', 'b1/31'])
    expect(checklist().textContent).toContain('포장 완료로 적었어요.')
  })

  it('결과와 "다음 구매자"는 상품 줄 아래 버튼 줄 바로 위·안 — 저장되면 포커스가 "다음 구매자"(주 버튼)로 간다 (UX-I2-001)', async () => {
    await openPacking('c1')
    const region = checklist()
    for (const name of ['15번 핑크프릴', '28번 청보석']) fireEvent.click(within(region).getByRole('checkbox', { name }))
    fireEvent.click(within(region).getByRole('button', { name: '포장 완료' }))
    await flush(10)
    const done = within(checklist()).getByText('포장 완료로 적었어요.')
    const actions = within(checklist()).getByRole('group', { name: '포장·배송' })
    const lastItem = within(checklist()).getByRole('checkbox', { name: '28번 청보석' })
    // 문서 순서: 마지막 상품 줄 → 결과 → 버튼 줄
    expect(lastItem.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(done.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const next = within(actions).getByRole('button', { name: '다음 구매자' })
    expect(document.activeElement).toBe(next)
    expect(next.className).toContain('button-primary')
    expect(within(actions).getByRole('button', { name: '배송 완료로 적기' }).className).not.toContain('button-primary')
  })

  it('다음 구매자가 없으면 포커스는 결과 안내로, 배송 완료로 적기가 주 버튼 · 창을 닫은 뒤 결과 안내로 (UX-I2-001)', async () => {
    const engine = new EngineServer([register(15, '핑크프릴', 10000), chat('m1', 'c1', '가나', '15')])
    const packing = new FakePacking(engine)
    vi.stubGlobal('fetch', engine.server.fetch)
    render(<PackingHarness initial={{ name: 'packing', date: DATE, buyer: 'c1' }} />)
    await flush(15)
    fireEvent.click(within(checklist()).getByRole('checkbox', { name: '15번 핑크프릴' }))
    fireEvent.click(within(checklist()).getByRole('button', { name: '포장 완료' }))
    await flush(10)
    expect(within(checklist()).queryByRole('button', { name: '다음 구매자' })).toBeNull()
    expect(document.activeElement?.textContent).toBe('포장 완료로 적었어요.')
    expect(within(checklist()).getByRole('button', { name: '배송 완료로 적기' }).className).toContain('button-primary')
    // 포장 완료 취소 → 확인 창에서 보내면 창이 닫히고 결과 안내로
    fireEvent.click(within(checklist()).getByRole('button', { name: '포장 완료 취소' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '포장 완료 취소' })).getByRole('button', { name: '포장 완료 취소하기' }))
    await flush(10)
    expect(packing.records.get('c1')).toBeUndefined()
    expect(document.activeElement?.textContent).toBe('포장 완료를 취소했어요.')
  })

  it('보냈는데 그 사이 품목이 바뀌어 거절되면 버튼 줄 위에도 "적지 않았어요" — 휴대폰에서 누른 자리에 결과가 있다 (UX-I2-001)', async () => {
    const { engine } = await openPacking('c1')
    for (const name of ['15번 핑크프릴', '28번 청보석']) fireEvent.click(within(checklist()).getByRole('checkbox', { name }))
    engine.writeQuietly({ type: 'host.cancel', b: 'b1', no: 28, buyer: 'c1', reason: '시청자 요청' })
    fireEvent.click(within(checklist()).getByRole('button', { name: '포장 완료' }))
    await flush(15)
    const result = within(checklist()).getByText('그 사이 구매 내역이 바뀌어 포장 완료로 적지 않았어요. 바뀐 품목을 담고 다시 눌러 주세요.')
    expect(result.compareDocumentPosition(within(checklist()).getByRole('group', { name: '포장·배송' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(checklist().textContent).toContain('구매 내역이 바뀌었어요 — 뺄 것: 28번')
  })

  it('같은 번호에 다른 상품(번호 변경 뒤 빈 번호에 새 상품): 연 동안 — 그 번호 체크는 풀리고 "새로 담을 것: 28번 라울 · 뺄 것: 28번 청보석" (D-I2-19)', async () => {
    const { engine } = await openPacking('c1')
    fireEvent.click(within(checklist()).getByRole('checkbox', { name: '15번 핑크프릴' }))
    fireEvent.click(within(checklist()).getByRole('checkbox', { name: '28번 청보석' }))
    engine.write({ type: 'product.renumber', b: 'b1', from: 28, to: 70 })
    engine.write(register(28, '라울', 9000))
    engine.write(chat('m9', 'c1', '가나', '28'))
    await flush(20)
    const region = checklist()
    expect(region.textContent).toContain('구매 내역이 바뀌었어요 — 새로 담을 것: 28번 라울 · 뺄 것: 28번 청보석')
    expect((within(region).getByRole('checkbox', { name: '15번 핑크프릴' }) as HTMLInputElement).checked).toBe(true)
    expect((within(region).getByRole('checkbox', { name: '28번 라울' }) as HTMLInputElement).checked).toBe(false)
    expect(region.textContent).toContain('1/2 담음')
    expect((within(region).getByRole('button', { name: '포장 완료' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('같은 번호에 다른 상품 — 포장 완료 뒤 번호 변경 → 포장 다시 확인 "뺄 것: 28번", 빈 28번에 새 상품 1등 → 번호 뒤 품종 (D-I2-19, AC-I2-30 흐름 5·8)', async () => {
    const { engine, packing } = await openPacking('c1')
    for (const name of ['15번 핑크프릴', '28번 청보석']) fireEvent.click(within(checklist()).getByRole('checkbox', { name }))
    fireEvent.click(within(checklist()).getByRole('button', { name: '포장 완료' }))
    await flush(10)
    expect(packing.records.get('c1')?.phase).toBe('PACKED')
    engine.write({ type: 'product.renumber', b: 'b1', from: 28, to: 70 })
    await flush(20)
    // 번호 변경 → 찜 무효(D-056) → 뺄 것 28번
    expect(checklist().textContent).toContain('포장 다시 확인')
    expect(checklist().textContent).toContain('구매 내역이 바뀌었어요 — 뺄 것: 28번')
    engine.write(register(28, '라울', 9000))
    engine.write(chat('m9', 'c1', '가나', '28'))
    await flush(20)
    const region = checklist()
    expect(region.textContent).toContain('구매 내역이 바뀌었어요 — 새로 담을 것: 28번 라울 · 뺄 것: 28번 청보석')
    expect((within(region).getByRole('checkbox', { name: '28번 라울' }) as HTMLInputElement).checked).toBe(false)
    expect((within(region).getByRole('button', { name: '포장 완료' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('방송이 다른 같은 번호: 1부 7번은 남고 2부 7번이 빠지면 "뺄 것: 2부 7번"과 체크리스트의 방송 제목 (TD-I2-002)', async () => {
    const events = [register(7, '핑크프릴', 10000, 'b1'), register(7, '라울', 8000, 'b2'), chat('m1', 'c1', '가나', '7', 'b1'), chat('m2', 'c1', '가나', '7', 'b2')]
    // 포장 대기 — 연 동안 빠짐 (처음 품목과 비교)
    const engine = new EngineServer(events)
    new FakePacking(engine)
    vi.stubGlobal('fetch', engine.server.fetch)
    render(<PackingHarness initial={{ name: 'packing', date: DATE, buyer: 'c1' }} />)
    await flush(15)
    engine.write({ type: 'host.cancel', b: 'b2', no: 7, buyer: 'c1', reason: '취소 요청' })
    await flush(20)
    let region = checklist()
    expect(region.textContent).toContain('구매 내역이 바뀌었어요 — 뺄 것: 2부 7번')
    expect(within(region).getByRole('heading', { level: 3, name: '1부' })).toBeDefined()
    expect(within(region).getByRole('group', { name: '1부' })).toBeDefined()
    cleanup()
    // 포장 완료 뒤 빠짐 = 포장 다시 확인 (서버가 준 뺄 것)
    const after = new EngineServer([...events, { type: 'host.cancel', b: 'b2', no: 7, buyer: 'c1', reason: '취소 요청' }])
    const packing = new FakePacking(after)
    packing.records.set('c1', { phase: 'PACKED', packed: ['b1/7', 'b2/7'], invoice: null })
    vi.stubGlobal('fetch', after.server.fetch)
    render(<PackingHarness initial={{ name: 'packing', date: DATE, buyer: 'c1' }} />)
    await flush(15)
    region = checklist()
    expect(region.textContent).toContain('포장 다시 확인')
    expect(region.textContent).toContain('구매 내역이 바뀌었어요 — 뺄 것: 2부 7번')
    expect(within(region).getByRole('heading', { level: 3, name: '1부' })).toBeDefined()
  })
})

describe('포장 라벨 (AC-I2-39·34, LBL-03)', () => {
  const pngCalls = (engine: EngineServer) => engine.server.callsTo('GET', /\/packing-label\.png\?/).length

  it('연 동안 입금 전 찜까지 가격이 바뀌어 상품 합계가 달라지면 라벨 그림을 새로 받는다 (SA-I2-002)', async () => {
    const { engine } = await openPacking('c1')
    const before = pngCalls(engine)
    expect(before).toBe(1)
    engine.write({ type: 'product.update', b: 'b1', no: 15, price: 12000, applyTo: 'UNPAID_CLAIMS' })
    await flush(20)
    expect(pngCalls(engine)).toBe(before + 1)
    // 포장 목록(품목의 가격 스냅샷)도 다시 받았다
    expect(engine.server.callsTo('GET', /\/packing$/).length).toBeGreaterThanOrEqual(2)
  })

  it('구매자 표시 이름(닉네임)이 바뀌면 새로 받고, 그 묶음과 상관없는 변경(다른 구매자 입금·같은 이름의 채팅)에는 받지 않는다', async () => {
    const { engine } = await openPacking('c1')
    const before = pngCalls(engine)
    engine.write(chat('m8', 'c1', '가나', '감사해요'))
    engine.write({ type: 'settlement.payment', buyer: 'c2', date: DATE, amount: 3000 })
    await flush(20)
    expect(pngCalls(engine)).toBe(before)
    engine.write(chat('m9', 'c1', '가나다', '안녕하세요'))
    await flush(20)
    expect(pngCalls(engine)).toBe(before + 1)
  })
})

describe('배송 완료·취소 (AC-I2-38)', () => {
  it('입금 완료가 아니면 묻는다(처음 포커스 "닫기") — 송장 문제는 칸 옆에 서버 문장, 다시 보내면 숫자만', async () => {
    const { packing } = await openPacking('c2')
    fireEvent.click(within(checklist()).getByRole('button', { name: '배송 완료로 적기' }))
    const ship = screen.getByRole('dialog', { name: '배송 완료로 적기' })
    const field = within(ship).getByLabelText('송장번호') as HTMLInputElement
    expect(field.getAttribute('inputmode')).toBe('numeric')
    fireEvent.change(field, { target: { value: '01012345678' } })
    fireEvent.click(within(ship).getByRole('button', { name: '배송 완료로 적기' }))
    const ask = screen.getByRole('dialog', { name: '입금 확인' })
    expect(ask.textContent).toContain('아직 입금 완료가 아니에요(미입금). 그래도 배송 완료로 적을까요?')
    expect(document.activeElement?.textContent).toBe('닫기')
    fireEvent.click(within(ask).getByRole('button', { name: '배송 완료로 적기' }))
    await flush(10)
    const again = screen.getByRole('dialog', { name: '배송 완료로 적기' })
    expect(within(again).getByRole('alert').textContent).toBe('전화번호처럼 보여요. 송장번호를 확인해 주세요.')
    expect(screen.getAllByText('전화번호처럼 보여요. 송장번호를 확인해 주세요.')).toHaveLength(1)
    fireEvent.change(within(again).getByLabelText('송장번호'), { target: { value: '1234-5678-9012' } })
    fireEvent.click(within(again).getByRole('button', { name: '배송 완료로 적기' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '입금 확인' })).getByRole('button', { name: '배송 완료로 적기' }))
    await flush(10)
    expect(packing.records.get('c2')).toMatchObject({ phase: 'SHIPPED', invoice: '123456789012' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(checklist().textContent).toContain('배송 완료 · 송장 123456789012')
    // 배송 완료 취소: 확인 뒤 바로
    fireEvent.click(within(checklist()).getByRole('button', { name: '배송 완료 취소' }))
    const confirm = screen.getByRole('dialog', { name: '배송 완료 취소' })
    expect(confirm.textContent).toContain('배송 완료를 취소할까요? 포장 완료로 돌아가요.')
    expect(document.activeElement?.textContent).toBe('닫기')
    fireEvent.click(within(confirm).getByRole('button', { name: '배송 완료 취소하기' }))
    await flush(10)
    expect(packing.records.get('c2')?.phase).toBe('PACKED')
    expect(checklist().textContent).toContain('배송 완료를 취소했어요.')
  })

  it('연결이 끊기면 "인터넷 연결을 확인하고 다시 눌러 주세요." — 다시 누르면 같은 요청 번호 (AC-I2-82)', async () => {
    const { packing } = await openPacking('c2')
    packing.failNext = { network: true }
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      fireEvent.click(within(checklist()).getByRole('button', { name: '포장 완료 취소' }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '포장 완료 취소' })).getByRole('button', { name: '포장 완료 취소하기' }))
      // 저절로 다시 보내도(같은 번호) 끊긴 채 — 첫 실패 뒤로는 실제 서버가 받게 한다
      packing.failNext = null
      const engineFetch = (globalThis.fetch as typeof fetch)
      let down = 3
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'POST' && down > 0) {
          down--
          packing.posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
          throw new TypeError('Failed to fetch')
        }
        return engineFetch(input, init)
      })
      await vi.advanceTimersByTimeAsync(4000)
      await flush(5)
    } finally {
      vi.useRealTimers()
    }
    expect(checklist().textContent).toContain('인터넷 연결을 확인하고 다시 눌러 주세요.')
    fireEvent.click(within(checklist()).getByRole('button', { name: '포장 완료 취소' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '포장 완료 취소' })).getByRole('button', { name: '포장 완료 취소하기' }))
    await flush(10)
    const ids = new Set(packing.posts.map((post) => post.requestId))
    expect(ids.size).toBe(1)
    expect(packing.records.get('c2')).toBeUndefined()
  })
})

// ── 설정 (AC-I2-02·65) ──────────────────────────────────────────────────

describe('설정 화면', () => {
  /** 합친 뒤(main I3) 설정 화면은 판매 규칙·유튜브·보조자 칸도 함께 불러온다(settings-page.test.tsx) — 이 시험은 I2 칸(가게·백업·전체 기록 내려받기)을 그린다 */
  function SettingsPage({ onShopName }: { readonly onShopName: (name: string) => void }) {
    return (
      <>
        <ShopForm onRenamed={onShopName} />
        <BackupSection />
        <ExportSection />
      </>
    )
  }

  function settingsServer(backups: Record<string, unknown>) {
    const server = new FakeServer()
    let shop = { name: '시험 가게', bank: '', accountNumber: '', accountHolder: '', accountNote: '' }
    server
      .on('GET', /^\/api\/shop$/, () => ({ body: { shop } }))
      .on('PUT', /^\/api\/shop$/, (call) => {
        const body = call.body as typeof shop
        const filled = [body.bank, body.accountNumber, body.accountHolder].filter((value) => value.trim() !== '').length
        if (filled > 0 && filled < 3) {
          return apiError(400, 'INVALID_INPUT', '은행·계좌번호·예금주를 모두 적거나 모두 비워 주세요.', [
            ...(body.accountNumber.trim() === '' ? [{ field: 'accountNumber', message: '계좌번호를 적어 주세요.' }] : []),
            ...(body.accountHolder.trim() === '' ? [{ field: 'accountHolder', message: '예금주를 적어 주세요.' }] : []),
          ])
        }
        shop = body
        return { body: { shop } }
      })
      .on('GET', /^\/api\/backups$/, () => ({ body: backups }))
    vi.stubGlobal('fetch', server.fetch)
    return server
  }

  it('가게: 다섯 칸·확인서 미리 보기·저장 → "저장했어요."·위 가게 이름이 바뀐다, 서버 오류는 그 칸 옆', async () => {
    const server = settingsServer({ enabled: true, retentionDays: 30, lastSuccessAt: new Date(Date.now() - 3600_000).toISOString(), backups: [] })
    const names: string[] = []
    render(<SettingsPage onShopName={(name) => names.push(name)} />)
    await flush(5)
    expect(screen.getByText('확인서에 입금 계좌가 나오지 않아요.')).toBeDefined()
    fireEvent.change(screen.getByLabelText('은행'), { target: { value: '농협' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await flush(5)
    expect(screen.getAllByText('은행·계좌번호·예금주를 모두 적거나 모두 비워 주세요.')).toHaveLength(1)
    expect(screen.getByText('계좌번호를 적어 주세요.').id).toBe(screen.getByLabelText('계좌번호').getAttribute('aria-describedby'))
    fireEvent.change(screen.getByLabelText('계좌번호'), { target: { value: '302-9988-7766-11' } })
    fireEvent.change(screen.getByLabelText('예금주'), { target: { value: '김판매' } })
    fireEvent.change(screen.getByLabelText('입금 안내 문장'), { target: { value: '입금자명은 닉네임으로 적어 주세요' } })
    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '초록다육' } })
    const preview = screen.getByRole('region', { name: '확인서에 나올 모양' })
    expect(preview.textContent).toContain('농협 302-9988-7766-11 (예금주 김판매)')
    expect(preview.textContent).toContain('입금자명은 닉네임으로 적어 주세요')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await flush(5)
    expect(screen.getByText('저장했어요.').getAttribute('data-tone')).toBe('success')
    expect(names).toEqual(['초록다육'])
    expect(server.callsTo('PUT', /\/api\/shop/).at(-1)?.body).toEqual({ name: '초록다육', bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', accountNote: '입금자명은 닉네임으로 적어 주세요' })
  })

  it('백업: 마지막 자동 백업(KST)·30일 보관·목록(크기) — 복구·백업 파일 내려받기 버튼은 없다', async () => {
    settingsServer({ enabled: true, retentionDays: 30, lastSuccessAt: new Date(Date.now() - 3600_000).toISOString(), backups: [{ createdAt: '2026-10-19T19:00:00.000Z', size: 1.2 * 1024 * 1024 }] })
    render(<SettingsPage onShopName={() => {}} />)
    await flush(5)
    expect(screen.getByText('백업은 30일 동안 보관해요.')).toBeDefined()
    expect(screen.getByRole('list', { name: '보관 중인 백업' }).textContent).toBe('2026년 10월 20일 (화) 04:00 · 1.2MB')
    expect(screen.getByText('백업 시점으로 되돌리려면 운영자에게 날짜를 알려 주세요.')).toBeDefined()
    expect(screen.queryByText('자동 백업이 멈췄어요. 운영자에게 알려 주세요.')).toBeNull()
    expect(screen.queryByRole('button', { name: /복구|되돌리기/ })).toBeNull()
    expect(screen.getByRole('button', { name: '전체 기록(JSON)' })).toBeDefined()
    expect(screen.getByRole('button', { name: '전체 판매대장(엑셀)' })).toBeDefined()
    expect(screen.getByText('구매자 닉네임·메모·전화번호 끝자리가 들어 있어요. 파일을 다른 사람에게 보내지 마세요.')).toBeDefined()
  })

  it('자동 백업이 꺼져 있거나 26시간보다 오래됐으면 주의', async () => {
    settingsServer({ enabled: false, retentionDays: 30, lastSuccessAt: null, backups: [] })
    render(<SettingsPage onShopName={() => {}} />)
    await flush(5)
    expect(screen.getByText('자동 백업이 멈췄어요. 운영자에게 알려 주세요.').getAttribute('data-tone')).toBe('warning')
  })
})

// ── 상품 목록 가져오기 (AC-I2-52) ────────────────────────────────────────

describe('상품 목록 가져오기 창', () => {
  const preview = {
    broadcast: 'b1',
    unit: 'WON',
    maxNumber: 999,
    error: null,
    header: 1,
    headerCells: ['번호', '품종', '가격'],
    rows: [
      { line: 2, no: 15, name: '핑크프릴', price: 10000, text: '15\t핑크프릴\t10000' },
      { line: 3, no: 31, name: '', price: 8000, text: '31\t\t8000' },
      { line: 4, error: 'NAME_PHONE', text: '7\t010-1234-5678\t3000' },
    ],
    register: 2,
    problems: 1,
  }

  it('미리 보기: 요약·머리글·표(문제 줄은 쉬운 말) → "2개 등록하기"는 바로 보낸다, 거절되면 새 미리 보기와 안내', async () => {
    const server = new FakeServer()
    let rejectOnce = true
    server
      .on('POST', /^\/api\/broadcasts\/b1\/import\/preview$/, () => ({ body: preview }))
      .on('POST', /^\/api\/broadcasts\/b1\/import$/, () => {
        if (rejectOnce) {
          rejectOnce = false
          return { status: 409, body: { error: { code: 'IMPORT_CHANGED', message: '그 사이에 바뀐 것이 있어요. 다시 확인해 주세요.', problems: [{ field: 'rows.0', message: '그 사이에 바뀐 것이 있어요. 다시 확인해 주세요.' }] } } }
        }
        return { body: { registered: 2, seq: 9 } }
      })
    vi.stubGlobal('fetch', server.fetch)
    const synced: number[] = []
    render(<ImportDialog broadcastId="b1" onClose={() => {}} onRegistered={async (seq) => void synced.push(seq)} />)
    const dialog = screen.getByRole('dialog', { name: '상품 목록 가져오기' })
    expect(dialog.textContent).toContain('엑셀에서 번호·품종·가격 세 칸을 복사해 붙여 넣거나 파일을 골라 주세요.')
    expect(document.activeElement).toBe(within(dialog).getByLabelText('붙여 넣기'))
    expect((within(dialog).getByRole('button', { name: '0개 등록하기' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('붙여 넣기'), { target: { value: '번호\t품종\t가격\n15\t핑크프릴\t10000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '미리 보기' }))
    await flush(5)
    expect(server.callsTo('POST', /preview$/)[0]?.body).toEqual({ text: '번호\t품종\t가격\n15\t핑크프릴\t10000' })
    expect(dialog.textContent).toContain('등록할 상품 2개 · 빼는 줄 1개')
    expect(dialog.textContent).toContain('머리글로 보고 뺀 줄: 1번 줄 (번호, 품종, 가격)')
    const table = within(dialog).getByRole('table', { name: '가져올 상품' })
    expect(within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['2', '15번', '핑크프릴', '10,000원', ''],
      ['3', '31번', '품종 미입력', '8,000원', ''],
      ['4', '7\t010-1234-5678\t3000', '품종에 전화번호처럼 보이는 숫자가 있어요.'],
    ])
    expect(dialog.textContent).not.toMatch(/NAME_PHONE|WON/)
    fireEvent.click(within(dialog).getByRole('button', { name: '2개 등록하기' }))
    await flush(10)
    expect(dialog.textContent).toContain('그 사이에 바뀐 것이 있어요. 다시 확인해 주세요.')
    expect(server.callsTo('POST', /preview$/)).toHaveLength(2)
    fireEvent.click(within(dialog).getByRole('button', { name: '2개 등록하기' }))
    await flush(10)
    const registers = server.callsTo('POST', /import$/)
    expect(registers.at(-1)?.body).toMatchObject({ rows: [{ no: 15, name: '핑크프릴', price: 10000 }, { no: 31, name: '', price: 8000 }] })
    expect(dialog.textContent).toContain('2개를 공개 전 상품으로 등록했어요.')
    expect(synced).toEqual([9])
  })

  it('파일을 고르면 그 파일이 입력(붙여 넣은 글은 비움) — 2MB 넘는 파일은 올리기 전에 막는다', async () => {
    const server = new FakeServer().on('POST', /preview$/, () => ({ body: preview }))
    vi.stubGlobal('fetch', server.fetch)
    render(<ImportDialog broadcastId="b1" onClose={() => {}} onRegistered={async () => {}} />)
    fireEvent.change(screen.getByLabelText('붙여 넣기'), { target: { value: '15\t핑크프릴\t10000' } })
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], '큰목록.xlsx')
    fireEvent.change(screen.getByLabelText('파일 고르기'), { target: { files: [big] } })
    await flush(5)
    expect(screen.getByRole('alert').textContent).toBe('파일이 너무 커요(2MB까지).')
    const csv = new File([new TextEncoder().encode('15,핑크프릴,10000')], '목록.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('파일 고르기'), { target: { files: [csv] } })
    await flush(10)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('고른 파일: 목록.csv')).toBeDefined()
    expect((screen.getByLabelText('붙여 넣기') as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '미리 보기' }))
    await flush(5)
    expect(server.callsTo('POST', /preview$/)[0]?.body).toEqual({ file: { name: '목록.csv', data: btoa(String.fromCharCode(...new TextEncoder().encode('15,핑크프릴,10000'))) } })
  })

  it('품종에 보이지 않는 글자(NAME_CONTROL)는 쉬운 말 — 코드는 보이지 않는다 (D-I2-17)', async () => {
    const control = {
      ...preview,
      header: null,
      headerCells: null,
      rows: [
        { line: 1, error: 'NAME_CONTROL', text: '9\t핑크\u0001프릴\t10000' },
        { line: 2, no: 15, name: '핑크프릴', price: 10000, text: '15\t핑크프릴\t10000' },
      ],
      register: 1,
      problems: 1,
    }
    const server = new FakeServer().on('POST', /preview$/, () => ({ body: control }))
    vi.stubGlobal('fetch', server.fetch)
    render(<ImportDialog broadcastId="b1" onClose={() => {}} onRegistered={async () => {}} />)
    const dialog = screen.getByRole('dialog', { name: '상품 목록 가져오기' })
    fireEvent.change(within(dialog).getByLabelText('붙여 넣기'), { target: { value: '9\t핑크\u0001프릴\t10000\n15\t핑크프릴\t10000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '미리 보기' }))
    await flush(5)
    expect(dialog.textContent).toContain('등록할 상품 1개 · 빼는 줄 1개')
    const table = within(dialog).getByRole('table', { name: '가져올 상품' })
    const problem = within(table).getByText('품종에 보이지 않는 글자가 있어요. 품종을 다시 적어 주세요.')
    expect(problem.closest('tr')?.getAttribute('data-tone')).toBe('warning')
    expect(dialog.textContent).not.toContain('NAME_CONTROL')
    expect((within(dialog).getByRole('button', { name: '1개 등록하기' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('빈 목록·500개 넘음은 쉬운 말', async () => {
    const server = new FakeServer().on('POST', /preview$/, () => ({ body: { ...preview, error: 'TOO_MANY', rows: [], register: 0, problems: 0, header: null, headerCells: null } }))
    vi.stubGlobal('fetch', server.fetch)
    render(<ImportDialog broadcastId="b1" onClose={() => {}} onRegistered={async () => {}} />)
    fireEvent.change(screen.getByLabelText('붙여 넣기'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '미리 보기' }))
    await flush(5)
    expect(screen.getByText('한 번에 500개까지 가져올 수 있어요.')).toBeDefined()
    expect((screen.getByRole('button', { name: '0개 등록하기' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

// ── 확인서 (AC-I2-13·15) ────────────────────────────────────────────────

describe('정산 자세히의 확인서', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
  const NAME = '확인서-2026-10-19-길동이.png'

  function receiptFetch(onRequest?: (path: string) => void, gate?: Promise<void>) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const path = String(input)
      onRequest?.(path)
      if (gate !== undefined) await gate
      return new Response(PNG.slice(), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="receipt-2026-10-19.png"; filename*=UTF-8''${encodeURIComponent(NAME)}`, 'X-Receipt-Created-At': '1' },
      })
    })
    vi.stubGlobal('URL', Object.assign(Object.create(URL) as object, URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} }))
  }

  it('미리 보기 그림(대체 글)·"PDF 내려받기"·공유할 수 있으면 "이미지 공유" — 누르면 받아 둔 같은 바이트를 그 이름의 File로 넘긴다', async () => {
    const paths: string[] = []
    receiptFetch((path) => paths.push(path))
    const shared: File[] = []
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share: async (data: { files: File[] }) => void shared.push(...data.files) })
    render(<ReceiptSection date={DATE} rehearsal={false} buyer="c1" hasItems signature="a" />)
    await flush(5)
    const section = screen.getByRole('region', { name: '구매 내역 확인서' })
    expect(within(section).getByRole('img', { name: '구매 내역 확인서 미리 보기' }).getAttribute('src')).toBe('blob:preview')
    expect(paths).toEqual([`/api/days/${DATE}/receipt.png?buyer=c1`])
    expect(within(section).queryByRole('button', { name: '이미지 저장' })).toBeNull()
    fireEvent.click(within(section).getByRole('button', { name: '이미지 공유' }))
    await flush(3)
    expect(paths).toHaveLength(1)
    expect(shared).toHaveLength(1)
    expect(shared[0]?.name).toBe(NAME)
    expect(shared[0]?.type).toBe('image/png')
    expect(new Uint8Array(await (shared[0] as File).arrayBuffer())).toEqual(PNG)
  })

  it('공유 창을 닫으면(AbortError) 아무 오류도 없고, 그 밖의 실패면 안내와 "이미지 저장"', async () => {
    receiptFetch()
    let fail: Error = new DOMException('닫음', 'AbortError')
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share: async () => Promise.reject(fail) })
    render(<ReceiptSection date={DATE} rehearsal={false} buyer="c1" hasItems signature="a" />)
    await flush(5)
    fireEvent.click(screen.getByRole('button', { name: '이미지 공유' }))
    await flush(3)
    expect(screen.queryByRole('alert')).toBeNull()
    fail = new Error('막힘')
    fireEvent.click(screen.getByRole('button', { name: '이미지 공유' }))
    await flush(3)
    expect(screen.getByRole('alert').textContent).toContain("공유하지 못했어요. '이미지 저장'으로 저장해 주세요.")
    expect(within(screen.getByRole('alert')).getByRole('button', { name: '이미지 저장' })).toBeDefined()
  })

  it('그 묶음이 바뀌면 새로 받고, 받는 동안 "확인서를 만드는 중이에요…"와 버튼 잠금 · 공유할 수 없는 기기는 "이미지 저장" · 리허설 안내', async () => {
    let release: () => void = () => {}
    const paths: string[] = []
    receiptFetch((path) => paths.push(path))
    vi.stubGlobal('navigator', { ...navigator, canShare: undefined, share: undefined })
    const view = render(<ReceiptSection date={DATE} rehearsal buyer="c1" hasItems signature="a" />)
    await flush(5)
    expect(screen.getByText('리허설 기록이에요.')).toBeDefined()
    expect(paths[0]).toBe(`/api/days/${DATE}/receipt.png?buyer=c1&rehearsal=true`)
    const save = screen.getByRole('button', { name: '이미지 저장' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    receiptFetch(
      (path) => paths.push(path),
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    view.rerender(<ReceiptSection date={DATE} rehearsal buyer="c1" hasItems signature="b" />)
    await flush(3)
    expect(screen.getByText('확인서를 만드는 중이에요…')).toBeDefined()
    expect((screen.getByRole('button', { name: '이미지 저장' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'PDF 내려받기' }) as HTMLButtonElement).disabled).toBe(true)
    release()
    await flush(5)
    expect((screen.getByRole('button', { name: '이미지 저장' }) as HTMLButtonElement).disabled).toBe(false)
    expect(paths).toHaveLength(2)
  })

  it('품목이 없는 묶음은 한 문장만 (버튼 없음)', () => {
    render(<ReceiptSection date={DATE} rehearsal={false} buyer="c1" hasItems={false} signature="a" />)
    expect(screen.getByRole('region', { name: '구매 내역 확인서' }).textContent).toBe('구매 내역 확인서구매 내역이 없어 확인서를 만들 수 없어요.')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
