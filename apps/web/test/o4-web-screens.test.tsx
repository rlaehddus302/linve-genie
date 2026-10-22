// O4 화면 단위 시험 (AC-O4-20·21·23·25·26, D-O4-04·05·07): 포장 모드 옵션 글·수량·수량 합·{ key, qty } 보내기·409 뒤 다시 보이기,
// 포장 다시 확인 목록 모양, 라벨 작업 줄, 품종 칸을 끈 템플릿 안내(막지 않음).
import { defaultTemplate } from '@livejjim/label'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { PackingEntry, PackingItem } from '../src/api/types.ts'
import { PackingPage } from '../src/components/PackingPage.tsx'
import { JobLine } from '../src/components/PrintParts.tsx'
import { NAME_OFF_OPTIONS_NOTE } from '../src/components/LabelSettings.tsx'
import type { Route } from '../src/lib/router.ts'
import { chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { job, overview, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, flush, type Call, type Reply } from './support.ts'

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

const item = (no: number, name: string, patch: Partial<PackingItem> = {}): PackingItem => ({ key: `b1/${String(no)}`, broadcast: 'b1', title: '1부', no, name, price: 10000, id: `p${String(no)}`, variant: null, qty: 1, ...patch })

/** AC-O4-20의 묶음 */
const MIXED: readonly PackingItem[] = [
  item(7, '핑크프릴'),
  item(21, '반바지', { key: 'b1/21#M', variant: 'M' }),
  item(11, '초코 과자', { qty: 3, price: 6000 }),
  item(22, '반팔티', { key: 'b1/22#105/검정색', variant: '105/검정색', qty: 2, price: 34000 }),
]

const entryOf = (items: readonly PackingItem[], patch: Partial<PackingEntry> = {}): PackingEntry => ({
  buyer: 'c1',
  name: '가나',
  phoneLast4: null,
  payment: 'UNPAID',
  items,
  status: '포장 대기',
  invoice: null,
  add: [],
  remove: [],
  ...patch,
})

function PackingHarness({ initial }: { readonly initial: Route }) {
  const [route, setRoute] = useState<Route>(initial)
  return route.name === 'packing' ? <PackingPage route={route} navigate={setRoute} /> : null
}

/** 포장 목록·명령을 정해 둔 응답으로 (그 밖의 범위 자료는 실제 코어로 도는 가짜 서버) */
async function openPacking(entry: PackingEntry, onPack: (call: Call) => Reply, buyer: string | null = 'c1') {
  const engine = new EngineServer([register(7, '핑크프릴', 10000), chat('m1', 'c1', '가나', '7')])
  const state = { entry }
  engine.server
    .on('GET', new RegExp(`^/api/days/${DATE}/packing$`), () => ({ body: { date: DATE, seq: engine.seq, entries: [state.entry] } }))
    .on('POST', new RegExp(`^/api/days/${DATE}/packing$`), (call) => onPack(call))
    .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\?`), () => ({ body: { date: DATE, buyer: 'c1', data: {}, pages: 1 } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\.png\\?`), () => ({ body: {} }))
  vi.stubGlobal('fetch', engine.server.fetch)
  render(<PackingHarness initial={{ name: 'packing', date: DATE, ...(buyer === null ? {} : { buyer }) }} />)
  await flush(15)
  return { engine, state }
}

const checklist = () => screen.getByRole('region', { name: '체크리스트' })
const LINES = ['7번 핑크프릴', '21번 반바지 M', '11번 초코 과자 3개', '22번 반팔티 105/검정색 2개']

describe('포장 모드 옵션 글·수량 (AC-O4-20, D-O4-04)', () => {
  it('줄 글 · 큰 수량 · "상품 7개"(수량 합) · "0/4 담음"(줄 수) — 목록 줄도 수량 합', async () => {
    await openPacking(entryOf(MIXED), () => ({ status: 500, body: {} }))
    const region = checklist()
    expect(within(region).getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual(LINES)
    for (const name of LINES) expect(within(region).getByRole('checkbox', { name })).toBeDefined()
    expect(region.textContent).toContain('상품 7개')
    expect(region.textContent).toContain('0/4 담음')
    // 수량은 번호와 같은 굵기의 큰 글자, 1이면 없다
    expect([...region.querySelectorAll('.pack-qty')].map((node) => node.textContent)).toEqual(['3개', '2개'])
    expect([...region.querySelectorAll('.pack-variant')].map((node) => node.textContent)).toEqual(['M', '105/검정색'])
  })

  it('포장 목록 줄의 "상품 n개"도 수량 합', async () => {
    await openPacking(entryOf(MIXED), () => ({ status: 500, body: {} }), null)
    const row = within(screen.getByRole('list', { name: '포장할 구매자' })).getByRole('link')
    expect(row.textContent).toBe('가나상품 7개포장 대기미입금')
  })

  it('옵션 글·품종은 글로만 넣는다 (꺾쇠가 요소가 되지 않는다)', async () => {
    await openPacking(entryOf([item(5, '<b>굵게</b>', { key: 'b1/5#<i>x</i>', variant: '<i>x</i>', qty: 2 })]), () => ({ status: 500, body: {} }))
    const region = checklist()
    expect(region.querySelector('b')).toBeNull()
    expect(region.querySelector('i')).toBeNull()
    expect(within(region).getByRole('checkbox', { name: '5번 <b>굵게</b> <i>x</i> 2개' })).toBeDefined()
  })
})

describe('포장 완료는 { key, qty } (AC-O4-21, D-O4-05)', () => {
  it('모두 체크 → 화면 품목마다 { key, qty }, 화면 순서', async () => {
    const posts: Record<string, unknown>[] = []
    await openPacking(entryOf(MIXED), (call) => {
      posts.push(call.body ?? {})
      return { body: { date: DATE, entry: entryOf(MIXED, { status: '포장 완료' }), recorded: true } }
    })
    for (const name of LINES) fireEvent.click(within(checklist()).getByRole('checkbox', { name }))
    expect(checklist().textContent).toContain('4/4 담음')
    fireEvent.click(within(checklist()).getByRole('button', { name: '포장 완료' }))
    await flush(10)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.items).toEqual([
      { key: 'b1/7', qty: 1 },
      { key: 'b1/21#M', qty: 1 },
      { key: 'b1/11', qty: 3 },
      { key: 'b1/22#105/검정색', qty: 2 },
    ])
    expect(checklist().textContent).toContain('포장 완료로 적었어요.')
  })

  it('그 사이 수량이 바뀌어 409면 바뀐 품목을 보이고 그 품목의 체크를 지운다 — 다시 모두 체크하면 새 수량으로 보낸다', async () => {
    const changed = MIXED.map((x) => (x.no === 22 ? { ...x, qty: 1, price: 17000 } : x))
    const posts: Record<string, unknown>[] = []
    await openPacking(entryOf(MIXED), (call) => {
      posts.push(call.body ?? {})
      if (posts.length === 1) return { status: 409, body: { error: { code: 'ITEMS_CHANGED', message: '그 사이에 구매 내역이 바뀌었어요. 다시 확인해 주세요.' }, entry: entryOf(changed) } }
      return { body: { date: DATE, entry: entryOf(changed, { status: '포장 완료' }), recorded: true } }
    })
    for (const name of LINES) fireEvent.click(within(checklist()).getByRole('checkbox', { name }))
    fireEvent.click(within(checklist()).getByRole('button', { name: '포장 완료' }))
    await flush(15)
    const region = checklist()
    expect(region.textContent).toContain('구매 내역이 바뀌었어요 — 새로 담을 것: 22번 반팔티 105/검정색 · 뺄 것: 22번 반팔티 105/검정색 2개')
    expect(region.textContent).not.toMatch(/ITEMS_CHANGED/)
    expect((within(region).getByRole('checkbox', { name: '22번 반팔티 105/검정색' }) as HTMLInputElement).checked).toBe(false)
    expect((within(region).getByRole('checkbox', { name: '11번 초코 과자 3개' }) as HTMLInputElement).checked).toBe(true)
    expect(region.textContent).toContain('상품 6개')
    expect(region.textContent).toContain('3/4 담음')
    fireEvent.click(within(region).getByRole('checkbox', { name: '22번 반팔티 105/검정색' }))
    fireEvent.click(within(checklist()).getByRole('button', { name: '포장 완료' }))
    await flush(10)
    expect(posts).toHaveLength(2)
    expect(posts[1]?.items).toEqual([
      { key: 'b1/7', qty: 1 },
      { key: 'b1/21#M', qty: 1 },
      { key: 'b1/11', qty: 3 },
      { key: 'b1/22#105/검정색', qty: 1 },
    ])
  })
})

describe('포장 다시 확인 목록 (AC-O4-23, D-O3-14)', () => {
  it('새로 담을 것·뺄 것 줄 모양이 체크리스트 줄과 같다 — 뺄 것은 포장 때 수량', async () => {
    const now = [item(21, '반바지', { key: 'b1/21#L', variant: 'L', qty: 1 })]
    await openPacking(
      entryOf(now, {
        status: '포장 다시 확인',
        add: now,
        remove: [{ key: 'b1/21#L', broadcast: 'b1', title: '1부', no: 21, name: '반바지', variant: 'L', qty: 2, id: 'p21' }],
      }),
      () => ({ status: 500, body: {} }),
    )
    const region = checklist()
    expect(region.textContent).toContain('포장 다시 확인')
    expect(region.textContent).toContain('구매 내역이 바뀌었어요 — 새로 담을 것: 21번 반바지 L · 뺄 것: 21번 반바지 L 2개')
    expect(within(region).getByRole('checkbox', { name: '21번 반바지 L' })).toBeDefined()
  })
})

describe('라벨 작업 줄 (AC-O4-25, D-O4-07)', () => {
  it('옵션 라벨은 번호·품종 뒤에 옵션 글·수량, 다육은 이전 그대로', () => {
    const optionJob = job('j1', { data: { no: 21, name: '반바지', price: 10000, date: DATE, buyer: { kind: 'youtube', name: '홍길동' }, variant: 'L', qty: 2 }, label: { ...job('j1').label, no: 21, buyer: { kind: 'youtube', name: '홍길동' } } })
    const { container, unmount } = render(<JobLine job={optionJob} />)
    expect(container.querySelector('.job-main')?.textContent).toContain('21번 반바지 L · 2개 · 홍길동')
    unmount()
    const plain = render(<JobLine job={job('j2')} />)
    expect(plain.container.querySelector('.job-main')?.textContent).toMatch(/^15번 핑크프릴 · 우주천사 · /)
  })
})

describe('품종 칸을 끈 템플릿 안내 (AC-O4-26, D-O4-07)', () => {
  let server: FakeServer
  let optionScopes: unknown[]
  let saved: Record<string, unknown>[]

  beforeEach(() => {
    window.sessionStorage.clear()
    server = new FakeServer()
    optionScopes = []
    saved = []
    server
      .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1' } }))
      .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000 } }))
      .on('GET', /^\/api\/print$/, () => ({ body: overview() }))
      .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
      .on('GET', /^\/api\/print\/labels\?/, () => ({ body: { date: DATE, labels: [] } }))
      .on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: DATE }] } }))
      .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
      .on('GET', /^\/api\/settings$/, () => ({ body: { settings: { 'print.autoOnConfirm': true } } }))
      .on('GET', /^\/api\/reviews(\?rehearsal=true)?$/, (_call, match) => ({ body: { rehearsal: match[1] !== undefined, reviews: [], products: [], broadcasts: [], scopes: match[1] === undefined ? optionScopes : [] } }))
      .on('PUT', /^\/api\/print\/templates\/product$/, (call) => {
        saved.push(call.body ?? {})
        return { body: { template: (call.body as { template: unknown }).template, version: 1, message: '라벨 설정을 저장했어요.' } }
      })
    vi.stubGlobal('fetch', server.fetch)
    window.history.replaceState(null, '', '/labels')
  })

  afterEach(() => {
    FakeEventSource.reset()
  })

  async function openSettings() {
    render(<App />)
    await screen.findByRole('heading', { name: '라벨', level: 1 })
    await flush(10)
    return screen.getByRole('checkbox', { name: /^품종\s?켜기$/ }) as HTMLInputElement
  }

  it('옵션 방송이 있는 판매자: 품종 칸을 끄면 안내 한 줄 — 저장 단추는 막히지 않는다', async () => {
    optionScopes = [{ date: DATE, rehearsal: false, seq: 3 }]
    const name = await openSettings()
    expect(screen.queryByText(NAME_OFF_OPTIONS_NOTE)).toBeNull()
    fireEvent.click(name)
    await waitFor(() => expect(screen.getByText(NAME_OFF_OPTIONS_NOTE)).toBeTruthy())
    expect((screen.getByRole('button', { name: '라벨 설정 저장' }) as HTMLButtonElement).disabled).toBe(false)
    // 다시 켜면 안내가 사라진다
    fireEvent.click(name)
    expect(screen.queryByText(NAME_OFF_OPTIONS_NOTE)).toBeNull()
  })

  it('옵션 방송이 없는 판매자: 안내가 없다, 품종 칸을 끄지 않으면 묻지도 않는다', async () => {
    const name = await openSettings()
    expect(server.callsTo('GET', /^\/api\/reviews/)).toHaveLength(0)
    fireEvent.click(name)
    await flush(10)
    expect(server.callsTo('GET', /^\/api\/reviews/).length).toBeGreaterThan(0)
    expect(screen.queryByText(NAME_OFF_OPTIONS_NOTE)).toBeNull()
  })

  it('이미 품종 칸을 끈 템플릿을 연 옵션 판매자에게도 보인다', async () => {
    optionScopes = [{ date: DATE, rehearsal: false, seq: 3 }]
    const product = defaultTemplate('product')
    server.on('GET', /^\/api\/print\/templates$/, () => ({ body: { ...templates(), product: { template: { ...product, items: { ...product.items, name: { ...product.items.name, visible: false } } }, version: 2 } } }))
    await openSettings()
    await waitFor(() => expect(screen.getByText(NAME_OFF_OPTIONS_NOTE)).toBeTruthy())
    expect(saved).toHaveLength(0)
  })
})
