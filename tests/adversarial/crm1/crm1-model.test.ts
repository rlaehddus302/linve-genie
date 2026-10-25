// CRM1 적대 시험 (test-domain) — AC-CRM1-30 "처음부터 센 것과 같다" 모형 대조.
// 무작위로 실제·리허설 날짜, 구매자(유튜브·인스타그램·틱톡·전화번호 있는 문자·전화번호 없는 문자)·합치기·입금(전액·부분·없음)·
// 취소(방송자 취소·무효·교체 취소, 사유 변형 섞음)·대기 찜 취소를 서버 쓰기 경로로 넣고, 그 사이에 입금·취소·설정 변경·날짜 넘김(시계)을 끼우며
// 손님 기록(캐시를 쓰는 서버 경로)을 따로 만든 모형이 처음부터 센 값과 비교한다.
// - 모형은 손님 기록 코드(apps/server/src/customers/**)를 쓰지 않는다. 사실(구매자·찜 상태·정산 묶음)은 기존 날짜 조회 `GET /api/days/:date`로 읽고,
//   '입금 안 함' 조치로 끝난 1등 찜은 조치 앞뒤 날짜 조회를 비교해 모형이 스스로 기록한다. "1등이었던 적"도 쓰기마다 본 확정 찜으로 모형이 기록한다.
// - 표지는 모형이 넣은 값 그대로(채널 ID, 문자찜에 쓴 전화번호) — 서버의 전화번호 키를 몰라도 같은 사람을 안다.
// - 요약 규칙은 골든 tests/golden/regulars/summary.json의 `about`을 그대로 다시 쓴 것(D-CRM1-03·04·05).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { at, chat, crm, crmWorld, kst, type Row, type Summary } from '../../../apps/server/test/crm1-support.ts'
import { client, createBroadcast, expectOk, login, writeEvent, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

// ── 날짜 조회 모양 (기존 경로) ──────────────────────────────────────────

interface VClaim {
  id: string
  broadcast: string
  no: number
  buyer: string
  currentBuyer: string
  status: string
  reason: string | null
  price: number | null
  qty: number
}
interface VBuyer {
  id: string
  kind: string
  current: string
  merged: string[]
  display: string
  nameHistory: string[]
  phoneLast4: string | null
  blocked: boolean
}
interface VSettlement {
  buyer: string
  items: string[]
  subtotal: number
  total: number
  payment: string
  records: { kind: string }[]
}
interface DayView {
  claims: VClaim[]
  buyers: VBuyer[]
  settlements: VSettlement[]
}

interface Settings {
  regularCount: number
  regularAmount: number | null
  waitDays: number
}

// ── 모형 ────────────────────────────────────────────────────────────────

interface ModelDay {
  date: string
  b: string
  /** 문자 구매자 ID → 그 문자찜에 쓴 전화번호 (전화번호 없는 문자 구매자는 없음) */
  phones: Map<string, string>
  /** 쓰기마다 본 확정 찜 */
  everConfirmed: Set<string>
  /** '입금 안 함' 조치 앞에 확정이었다가 조치 뒤 끝난 찜 */
  noPayEnded: Set<string>
}

interface Model {
  days: Map<string, ModelDay>
  settings: Settings
}

interface MBundle {
  date: string
  root: string
  name: string
  items: number
  subtotal: number
  payment: string
  cancels: number
  noPay: number
  record: boolean
}

const PLATFORM_LABEL: Record<string, string> = { UC: '유튜브', ig: '인스타그램', tt: '틱톡' }

function addDaysModel(date: string, n: number): string {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** 골든 about을 그대로 */
function modelSummary(today: string, settings: Settings, bundles: readonly MBundle[]): Summary {
  const purchase = new Set<string>()
  const unpaid = new Set<string>()
  let total = 0
  let cancels = 0
  for (const b of bundles) {
    if (b.items >= 1 && (b.payment === 'PAID' || b.payment === 'OVERPAID')) {
      purchase.add(b.date)
      total += b.subtotal
    }
    if ((b.items >= 1 && (b.payment === 'UNPAID' || b.payment === 'PARTIAL') && today > addDaysModel(b.date, settings.waitDays)) || b.noPay >= 1) unpaid.add(b.date)
    cancels += b.cancels
  }
  const max = (s: Set<string>) => ([...s].sort().at(-1) ?? null)
  const purchaseDays = purchase.size
  return {
    purchaseDays,
    purchaseTotal: total,
    lastPurchase: max(purchase),
    unpaidDays: unpaid.size,
    lastUnpaid: max(unpaid),
    cancels,
    regular: purchaseDays >= settings.regularCount || (settings.regularAmount !== null && total >= settings.regularAmount),
    caution: unpaid.size >= 1,
  }
}

async function dayView(world: TestServer, seller: Seller, date: string): Promise<DayView> {
  return (await expectOk(client(world, seller.cookie).get(`/api/days/${date}`))).body as unknown as DayView
}

/** 그날 표지 → 그 표지의 구매자 */
function markerOf(day: ModelDay, buyer: VBuyer): string | null {
  if (buyer.kind === 'youtube') return `c:${buyer.id}`
  const phone = day.phones.get(buyer.id)
  return phone === undefined ? null : `p:${phone}`
}

const isEndedClaim = (claim: VClaim) => claim.status === 'CANCELLED' || (claim.status === 'REJECTED' && claim.reason === 'BY_HOST')

function bundlesOf(day: ModelDay, view: DayView): Map<string, MBundle> {
  const out = new Map<string, MBundle>()
  for (const buyer of view.buyers) {
    if (buyer.current !== buyer.id) continue
    const settlement = view.settlements.find((item) => item.buyer === buyer.id)
    let items = 0
    let cancels = 0
    let noPay = 0
    for (const claim of view.claims) {
      if (claim.currentBuyer !== buyer.id) continue
      if (claim.status === 'CONFIRMED') items += claim.qty
      else if (day.everConfirmed.has(claim.id) && isEndedClaim(claim)) {
        cancels += 1
        if (day.noPayEnded.has(claim.id)) noPay += 1
      }
    }
    const records = (settlement?.records ?? []).filter((record) => record.kind === 'payment' || record.kind === 'refund').length
    out.set(buyer.id, {
      date: day.date,
      root: buyer.id,
      name: buyer.display,
      items,
      subtotal: settlement?.subtotal ?? 0,
      payment: settlement?.payment ?? 'UNPAID',
      cancels,
      noPay,
      record: items > 0 || records > 0 || cancels > 0,
    })
  }
  return out
}

interface Snapshot {
  views: Map<string, DayView>
  bundles: Map<string, Map<string, MBundle>>
  /** 표지 → 나온 날짜 → 그날 그 구매자 */
  markers: Map<string, Map<string, VBuyer>>
}

async function snapshot(world: TestServer, seller: Seller, model: Model): Promise<Snapshot> {
  const views = new Map<string, DayView>()
  const bundles = new Map<string, Map<string, MBundle>>()
  const markers = new Map<string, Map<string, VBuyer>>()
  for (const [date, day] of [...model.days].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const view = await dayView(world, seller, date)
    views.set(date, view)
    bundles.set(date, bundlesOf(day, view))
    for (const buyer of view.buyers) {
      const marker = markerOf(day, buyer)
      if (marker === null) continue
      const dates = markers.get(marker) ?? new Map<string, VBuyer>()
      if (!dates.has(date)) dates.set(date, buyer)
      markers.set(marker, dates)
    }
  }
  return { views, bundles, markers }
}

function markerBundles(snap: Snapshot, marker: string): MBundle[] {
  const out: MBundle[] = []
  for (const [date, buyer] of snap.markers.get(marker) ?? []) {
    const bundle = snap.bundles.get(date)?.get(buyer.current)
    if (bundle?.record === true) out.push(bundle)
  }
  return out
}

/** 날짜별 구매자 X(지금의 구매자)의 기록 묶음 (D-CRM1-02) */
function recordOf(snap: Snapshot, model: Model, date: string, root: string): MBundle[] {
  const own = snap.bundles.get(date)?.get(root)
  const view = snap.views.get(date) as DayView
  const day = model.days.get(date) as ModelDay
  const out: MBundle[] = own?.record === true ? [own] : []
  const seen = new Set([`${date}|${root}`])
  const rootBuyer = view.buyers.find((buyer) => buyer.id === root) as VBuyer
  for (const memberId of [root, ...rootBuyer.merged]) {
    const member = view.buyers.find((buyer) => buyer.id === memberId)
    const marker = member === undefined ? null : markerOf(day, member)
    if (marker === null) continue
    for (const bundle of markerBundles(snap, marker)) {
      if (bundle.date === date) continue
      const key = `${bundle.date}|${bundle.root}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(bundle)
    }
  }
  return out
}

function kindLabel(buyer: VBuyer): string {
  if (buyer.kind === 'youtube') return PLATFORM_LABEL[buyer.id.startsWith('ig:') ? 'ig' : buyer.id.startsWith('tt:') ? 'tt' : 'UC'] as string
  return buyer.phoneLast4 === null ? '문자' : `문자 · 끝자리 ${buyer.phoneLast4}`
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** 서버와 모형을 비교한다 (모든 실제 날짜의 구매자 목록 꼬리표, 몇 명의 자세히, "모든 손님" 전부·정렬·찾기) */
async function compare(world: TestServer, seller: Seller, model: Model, label: string): Promise<void> {
  const c = crm(world, seller)
  const snap = await snapshot(world, seller, model)
  const today = new Date(world.clock.now() + 9 * 3_600_000).toISOString().slice(0, 10)
  // (1) 날짜별 구매자 목록
  for (const date of snap.views.keys()) {
    const response = await expectOk(c.dayList(date))
    expect(response.body.today, `${label} today`).toBe(today)
    expect(response.body.settings, `${label} settings`).toEqual(model.settings)
    const got = response.body.customers as (Summary & { buyer: string })[]
    const roots = [...(snap.bundles.get(date) as Map<string, MBundle>).keys()].sort(byText)
    const want = roots.map((root) => ({ buyer: root, ...modelSummary(today, model.settings, recordOf(snap, model, date, root)) }))
    expect(got, `${label} ${date} 구매자 목록`).toEqual(want)
  }
  // (2) 구매자 자세히: 합쳐진 구성원 ID로 물어도 지금의 구매자로 풀고 같은 요약
  for (const [date, view] of snap.views) {
    for (const buyer of view.buyers.filter((item) => item.current !== item.id).slice(0, 2)) {
      const detail = await expectOk(c.day(date, buyer.id))
      expect(detail.body.buyer, `${label} ${date} ${buyer.id}`).toBe(buyer.current)
      expect(detail.body.summary, `${label} ${date} ${buyer.id} 자세히`).toEqual(modelSummary(today, model.settings, recordOf(snap, model, date, buyer.current)))
    }
  }
  // (3) 모든 손님: 표지마다 한 줄, 기록 묶음이 있는 표지만
  const wantRows = new Map<string, Omit<Row, 'id'>>()
  for (const [marker, dates] of snap.markers) {
    const bundles = markerBundles(snap, marker)
    if (bundles.length === 0) continue
    const latestDate = [...dates.keys()].sort().at(-1) as string
    const latest = dates.get(latestDate) as VBuyer
    wantRows.set(`${latestDate}|${latest.id}`, {
      name: latest.display,
      platform: latest.kind === 'youtube' ? (latest.id.startsWith('ig:') ? 'INSTAGRAM' : latest.id.startsWith('tt:') ? 'TIKTOK' : 'YOUTUBE') : null,
      kindLabel: kindLabel(latest),
      phoneLast4: latest.phoneLast4,
      blocked: latest.blocked,
      latestDate,
      latestBuyer: latest.id,
      ...modelSummary(today, model.settings, bundles),
    })
  }
  const rows: Row[] = []
  for (let offset: number | null = 0; offset !== null; ) {
    const page = await expectOk(c.list(`offset=${String(offset)}`))
    rows.push(...(page.body.customers as Row[]))
    expect(page.body.count, `${label} count`).toBe(wantRows.size)
    offset = page.body.next as number | null
  }
  const gotRows = new Map(rows.map(({ id: _id, ...rest }) => [`${rest.latestDate}|${rest.latestBuyer}`, rest]))
  expect(gotRows, `${label} 모든 손님`).toEqual(wantRows)
  // 누적 큰 순 → 이름 → ID
  const sorted = [...rows].sort((a, b) => b.purchaseTotal - a.purchaseTotal || byText(a.name, b.name) || byText(a.id, b.id))
  expect(rows.map((row) => row.id), `${label} 누적 큰 순`).toEqual(sorted.map((row) => row.id))
  // 거르기: 단골만·입금 늦음 주의만은 모형 표시와 같은 줄
  for (const [filter, pick] of [['regular', (row: Row) => row.regular], ['caution', (row: Row) => row.caution]] as const) {
    const filtered = await expectOk(c.list(`filter=${filter}`))
    expect(filtered.body.count, `${label} ${filter}`).toBe(rows.filter(pick).length)
  }
  // 찾기: 어떤 날짜에서든 쓴 이름(이력 포함)으로 찾으면 그 표지의 줄이 나온다
  for (const [marker, dates] of [...snap.markers].slice(0, 3)) {
    if (markerBundles(snap, marker).length === 0) continue
    const names = [...dates.values()].flatMap((buyer) => buyer.nameHistory)
    const name = names[0]
    if (name === undefined) continue
    const latestDate = [...dates.keys()].sort().at(-1) as string
    const found = (await c.rows(`q=${encodeURIComponent(name)}`)).map((row) => `${row.latestDate}|${row.latestBuyer}`)
    expect(found, `${label} 찾기 ${name}`).toContain(`${latestDate}|${(dates.get(latestDate) as VBuyer).id}`)
  }
  // (4) 손님 자세히의 날짜 줄 = 그 표지의 기록 묶음(최근부터)
  for (const row of rows.slice(0, 3)) {
    const detail = await expectOk(c.customer(row.id))
    const marker = [...snap.markers].find(([, dates]) => {
      const latestDate = [...dates.keys()].sort().at(-1) as string
      return latestDate === row.latestDate && dates.get(latestDate)?.id === row.latestBuyer
    })?.[0] as string
    const bundles = markerBundles(snap, marker).sort((a, b) => byText(b.date, a.date))
    expect((detail.body.days as { date: string; buyer: string; subtotal: number }[]).map((day) => [day.date, day.buyer, day.subtotal]), `${label} 손님 자세히`).toEqual(
      bundles.slice(0, 20).map((bundle) => [bundle.date, bundle.root, bundle.subtotal]),
    )
  }
}

// ── 시나리오 생성 ───────────────────────────────────────────────────────

const CHANNELS = ['UC_A', 'UC_B', 'ig:777', 'tt:55'] as const
const PHONES = ['010-1111-1234', '010-2222-5678'] as const
const NICKS = ['다육이맘', '초록손', '라울러버', '핑크'] as const
const PRICES = [1000, 5000, 33_333, 60_000] as const
/** 사유 변형: 앞 넷은 공백을 모두 빼면 `입금안함`, 뒤는 아니다 */
const REASONS = ['입금 안 함', ' 입금안함 ', '입금\u3000안\t함', '입금 안 함\n', '입금 안 함 (연락 없음)', '입금 안함?', '입금 안 함함', '손님 요청'] as const
const isNoPay = (reason: string) => reason.replace(/\s/gu, '') === '입금안함'

/** 참여자: 채널(0~3) / 전화번호 있는 문자(4~5) / 전화번호 없는 문자(6) */
const participant = fc.integer({ min: 0, max: 6 })

const daySpec = fc.record({
  /** 9-28 기준 며칠 뒤 */
  gap: fc.integer({ min: 1, max: 3 }),
  rehearsal: fc.boolean(),
  /** 리허설이면 같은 날 실제 방송도 있는지 */
  alsoReal: fc.boolean(),
  products: fc.array(fc.record({ price: fc.constantFrom(...PRICES), claimers: fc.array(participant, { minLength: 1, maxLength: 3 }) }), { minLength: 1, maxLength: 3 }),
  merge: fc.option(fc.tuple(fc.nat(), fc.nat()), { nil: undefined, freq: 2 }),
  pay: fc.array(fc.constantFrom('full', 'partial', 'none'), { minLength: 4, maxLength: 4 }),
  cancel: fc.option(fc.record({ kind: fc.constantFrom('cancel', 'reject', 'assign', 'waiting'), reason: fc.constantFrom(...REASONS), product: fc.nat() }), { nil: undefined }),
  nick: fc.integer({ min: 0, max: 3 }),
})

const lateAction = fc.oneof(
  fc.record({ t: fc.constant('pay' as const), day: fc.nat(), buyer: fc.nat(), full: fc.boolean() }),
  fc.record({ t: fc.constant('cancel' as const), day: fc.nat(), kind: fc.constantFrom('cancel', 'reject', 'assign', 'waiting'), reason: fc.constantFrom(...REASONS), product: fc.nat() }),
  fc.record({ t: fc.constant('settings' as const), regularCount: fc.integer({ min: 2, max: 4 }), regularAmount: fc.constantFrom(null, 1000, 40_000, 100_000), waitDays: fc.integer({ min: 1, max: 5 }) }),
  fc.record({ t: fc.constant('clock' as const), days: fc.integer({ min: 0, max: 4 }), late: fc.boolean() }),
  fc.record({ t: fc.constant('compare' as const) }),
  fc.record({ t: fc.constant('merge' as const), day: fc.nat(), from: fc.nat(), into: fc.nat() }),
  fc.record({ t: fc.constant('unmerge' as const), day: fc.nat(), pick: fc.nat() }),
  fc.record({ t: fc.constant('block' as const), day: fc.nat(), pick: fc.nat(), unblock: fc.boolean() }),
)

async function write(world: TestServer, seller: Seller, event: Record<string, unknown>, date: string, rehearsal = false) {
  // 방송이 있는 입력(b)은 날짜를 따로 적지 않는다 — 범위는 방송으로 정해진다
  return 'b' in event ? writeEvent(world, seller, event) : writeEvent(world, seller, event, date, rehearsal ? true : undefined)
}

/** 조치 하나 (실제 날짜). '입금 안 함' 사유면 앞뒤 확정 찜을 비교해 모형에 남긴다 */
async function hostAction(world: TestServer, seller: Seller, model: Model, day: ModelDay, kind: string, reason: string, pick: number): Promise<void> {
  const before = await dayView(world, seller, day.date)
  const confirmed = before.claims.filter((claim) => claim.status === 'CONFIRMED')
  const waiting = before.claims.filter((claim) => claim.status === 'WAITING')
  let event: Record<string, unknown> | null = null
  if (kind === 'waiting') {
    const target = waiting[pick % Math.max(1, waiting.length)]
    if (target !== undefined) event = { type: 'host.cancel', b: target.broadcast, no: target.no, buyer: target.buyer, reason }
  } else {
    const target = confirmed[pick % Math.max(1, confirmed.length)]
    if (target !== undefined) {
      if (kind === 'assign') {
        const other = before.buyers.find((buyer) => buyer.current === buyer.id && buyer.id !== target.currentBuyer && !buyer.blocked)
        if (other !== undefined) event = { type: 'host.assign', b: target.broadcast, no: target.no, buyer: other.id, reason, replace: target.buyer, replaceTo: 'CANCEL' }
      } else event = { type: kind === 'reject' ? 'host.reject' : 'host.cancel', b: target.broadcast, no: target.no, buyer: target.buyer, reason }
    }
  }
  if (event === null) return
  const response = await write(world, seller, event, day.date)
  if (response.status !== 200) return
  const after = await dayView(world, seller, day.date)
  for (const claim of after.claims) if (claim.status === 'CONFIRMED') day.everConfirmed.add(claim.id)
  if (isNoPay(reason)) {
    const ids = new Set(confirmed.map((claim) => claim.id))
    for (const claim of after.claims) if (ids.has(claim.id) && isEndedClaim(claim)) day.noPayEnded.add(claim.id)
  }
  void model
}

async function payBundle(world: TestServer, seller: Seller, date: string, root: string, full: boolean): Promise<void> {
  const view = await dayView(world, seller, date)
  const settlement = view.settlements.find((item) => item.buyer === root)
  if (settlement === undefined || settlement.total <= 0 || settlement.payment === 'PAID' || settlement.payment === 'OVERPAID') return
  const amount = full ? settlement.total : Math.max(1, settlement.total - 1000)
  if (!full && amount >= settlement.total) return
  await expectOk(write(world, seller, { type: 'settlement.payment', buyer: root, date, amount }, date))
}

let messageNo = 0

async function sellDay(world: TestServer, seller: Seller, model: Model, date: string, spec: DaySpec, rehearsal: boolean): Promise<void> {
  at(world, date, rehearsal ? '19:00:00' : '20:00:00')
  const b = (await createBroadcast(world, seller, { date, rehearsal })).id
  const day: ModelDay = { date, b, phones: new Map(), everConfirmed: new Set(), noPayEnded: new Set() }
  const ids = new Map<number, string>()
  for (const [index, product] of spec.products.entries()) {
    const no = index + 1
    await expectOk(write(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price: product.price }, date, rehearsal))
    for (const who of product.claimers) {
      at(world, date, rehearsal ? '19:00:01' : '20:00:01')
      if (who <= 3) {
        const ch = CHANNELS[who] as string
        await chat(world, seller, b, `m${String(++messageNo)}`, ch, `${NICKS[(who + spec.nick) % 4] as string}`, String(no))
        ids.set(who, ch)
      } else {
        const event: Record<string, unknown> = { type: 'sms', b, no, received: rehearsal ? '19:00' : '20:00', memo: `손님${String(who)}` }
        if (who <= 5) event.phone = PHONES[who - 4]
        const response = await expectOk(write(world, seller, event, date, rehearsal))
        const buyer = response.body.buyer as string | undefined
        if (buyer !== undefined) {
          ids.set(who, buyer)
          if (who <= 5) day.phones.set(buyer, PHONES[who - 4] as string)
        }
      }
    }
  }
  if (rehearsal) {
    // 리허설: 입금까지 넣는다 (실제 기록에 섞이면 안 된다)
    const view = (await expectOk(client(world, seller.cookie).get(`/api/days/${date}?rehearsal=true`))).body as unknown as DayView
    for (const settlement of view.settlements) {
      if (settlement.total > 0) await write(world, seller, { type: 'settlement.payment', buyer: settlement.buyer, date, amount: settlement.total }, date, true)
    }
    return
  }
  model.days.set(date, day)
  for (const claim of (await dayView(world, seller, date)).claims) if (claim.status === 'CONFIRMED') day.everConfirmed.add(claim.id)
  if (spec.merge !== undefined) {
    const list = [...new Set(ids.values())]
    const from = list[spec.merge[0] % Math.max(1, list.length)]
    const into = list[spec.merge[1] % Math.max(1, list.length)]
    if (from !== undefined && into !== undefined && from !== into) {
      await write(world, seller, { type: 'buyer.merge', from, into, reason: '같은 사람' }, date)
      for (const claim of (await dayView(world, seller, date)).claims) if (claim.status === 'CONFIRMED') day.everConfirmed.add(claim.id)
    }
  }
  if (spec.cancel !== undefined) await hostAction(world, seller, model, day, spec.cancel.kind, spec.cancel.reason, spec.cancel.product)
  const roots = (await dayView(world, seller, date)).buyers.filter((buyer) => buyer.current === buyer.id).map((buyer) => buyer.id)
  for (const [index, root] of roots.slice(0, 4).entries()) {
    const how = spec.pay[index]
    if (how !== 'none') await payBundle(world, seller, date, root, how === 'full')
  }
}

type DaySpec = typeof daySpec extends fc.Arbitrary<infer T> ? T : never
type LateAction = typeof lateAction extends fc.Arbitrary<infer T> ? T : never

async function runScenario(days: readonly DaySpec[], late: readonly LateAction[], start = '2026-09-28'): Promise<void> {
  const created = await crmWorld(kst(start, '09:00:00'))
  const world = created.world
  let seller = created.seller
  let loggedIn = world.clock.now()
  /** 세션은 30일 — 20일이 지나면 다시 로그인 */
  const fresh = async () => {
    if (world.clock.now() - loggedIn > 20 * 86_400_000) {
      seller = { ...seller, cookie: await login(world, seller.loginId, seller.password) }
      loggedIn = world.clock.now()
    }
  }
  const model: Model = { days: new Map(), settings: { regularCount: 3, regularAmount: 100_000, waitDays: 3 } }
  let cursor = start
  for (const spec of days) {
    cursor = addDaysModel(cursor, spec.gap)
    at(world, cursor, '08:00:00')
    await fresh()
    if (spec.rehearsal) {
      await sellDay(world, seller, model, cursor, spec, true)
      if (spec.alsoReal) await sellDay(world, seller, model, cursor, spec, false)
    } else await sellDay(world, seller, model, cursor, spec, false)
  }
  // 마지막 날짜 뒤 시계는 7일을 넘지 않는다 (30일 봉인 밖)
  const limit = kst(addDaysModel(cursor, 7), '08:00:00')
  at(world, cursor, '23:00:00')
  await fresh()
  if (model.days.size > 0) await compare(world, seller, model, '판매 직후')
  const dates = () => [...model.days.keys()].sort()
  for (const [step, action] of late.entries()) {
    const label = `늦은 조치 ${String(step)} ${action.t}`
    const list = dates()
    if (action.t === 'compare') {
      if (list.length > 0) await compare(world, seller, model, label)
    } else if (action.t === 'settings') {
      model.settings = { regularCount: action.regularCount, regularAmount: action.regularAmount, waitDays: action.waitDays }
      await expectOk(crm(world, seller).saveSettings(model.settings))
    } else if (action.t === 'clock') {
      // 날짜 넘김 — KST 자정 앞뒤로 (23:59:59 / 00:00:01)
      const next = Math.min(limit, world.clock.now() + action.days * 86_400_000)
      const kstDay = new Date(next + 9 * 3_600_000).toISOString().slice(0, 10)
      world.clock.set(Math.max(world.clock.now() + 1, Math.min(limit, kst(kstDay, action.late ? '23:59:59' : '00:00:01'))))
      await fresh()
    } else if (list.length > 0) {
      const date = list[action.day % list.length] as string
      const day = model.days.get(date) as ModelDay
      if (action.t === 'merge') {
        // 판 뒤의 합치기 (입금·취소가 있어도 — 막히면 그대로)
        const roots = (await dayView(world, seller, date)).buyers.filter((buyer) => buyer.current === buyer.id).map((buyer) => buyer.id)
        const from = roots[action.from % Math.max(1, roots.length)]
        const into = roots[action.into % Math.max(1, roots.length)]
        if (from !== undefined && into !== undefined && from !== into) {
          await write(world, seller, { type: 'buyer.merge', from, into, reason: '같은 사람' }, date)
          for (const claim of (await dayView(world, seller, date)).claims) if (claim.status === 'CONFIRMED') day.everConfirmed.add(claim.id)
        }
      } else if (action.t === 'unmerge' || action.t === 'block') {
        // 떼어 내기 / 차단·차단 풀기 ("모든 손님" 차단 꼬리표 = 가장 최근 날짜의 그 구매자 차단)
        const buyers = (await dayView(world, seller, date)).buyers
        if (action.t === 'unmerge') {
          const merged = buyers.filter((buyer) => buyer.current !== buyer.id)
          const target = merged[action.pick % Math.max(1, merged.length)]
          if (target !== undefined) await write(world, seller, { type: 'buyer.unmerge', from: target.id, reason: '다른 사람' }, date)
        } else {
          const target = buyers[action.pick % Math.max(1, buyers.length)]
          if (target !== undefined) await write(world, seller, { type: action.unblock && target.blocked ? 'host.unblockBuyer' : 'host.blockBuyer', buyer: target.id, reason: '시험' }, date)
        }
        for (const claim of (await dayView(world, seller, date)).claims) if (claim.status === 'CONFIRMED') day.everConfirmed.add(claim.id)
      } else if (action.t === 'pay') {
        const roots = (await dayView(world, seller, date)).buyers.filter((buyer) => buyer.current === buyer.id).map((buyer) => buyer.id)
        const root = roots[action.buyer % Math.max(1, roots.length)]
        if (root !== undefined) await payBundle(world, seller, date, root, action.full)
      } else await hostAction(world, seller, model, day, action.kind, action.reason, action.product)
    }
  }
  if (model.days.size > 0) await compare(world, seller, model, '끝')
}

describe('AC-CRM1-30 손님 기록 = 모형이 처음부터 센 값 (캐시 경로, 사이에 입금·취소·설정·날짜 넘김)', () => {
  it('무작위 날짜 3~7개 × 구매자·합치기·입금·취소 사유 변형 (fast-check)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(daySpec, { minLength: 3, maxLength: 7 }), fc.array(lateAction, { minLength: 2, maxLength: 8 }), async (days, late) => {
        await runScenario(days, late)
      }),
      { numRuns: 8, seed: 20261026, endOnFailure: true },
    )
  })

  it('실제·리허설 날짜 30개 (고정 씨앗 한 번)', async () => {
    const [days] = fc.sample(fc.array(daySpec, { minLength: 30, maxLength: 30 }).map((list) => list.map((spec) => ({ ...spec, gap: 1 }))), { numRuns: 1, seed: 30 })
    const [late] = fc.sample(fc.array(lateAction, { minLength: 6, maxLength: 6 }), { numRuns: 1, seed: 31 })
    await runScenario(days as DaySpec[], late as LateAction[], '2026-09-20')
  })
})
