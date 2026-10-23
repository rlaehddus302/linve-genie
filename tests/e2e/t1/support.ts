// T1 택배 자동 접수 E2E 공용 도우미 (test-e2e).
// 기대 문장은 harness/sprints/T1/acceptance.md·docs/spec/PARCEL_RULES.md 따옴표 그대로, 선택자는 역할·이름 기반(T1 dev-notes "[web] 택배 화면").
// - 시험마다 새 판매자(loginNewSeller) — 택배 설정·날짜가 다른 시험과 섞이지 않는다.
// - 배송지는 날짜 + 30일에 지우므로(PC-3) 날짜는 오늘(KST)에서 며칠 전의 실제 범위를 쓴다(새 판매자라 날짜가 겹쳐도 범위는 따로다).
// - 가짜 택배사 조작은 E2E 서버의 /_e2e/parcel/*(T1 dev-notes "[server] 시험·E2E") — 세션 없이 서버 주소로 바로 부른다.
import { expect, type Locator, type Page } from '@playwright/test'
import { apiUrl, loginNewSeller, type Seller } from '../i3/support.ts'
import { packingCommand, packingList, postJson, realDay } from '../i2/support.ts'

export { apiUrl, directApi, loginAs, loginNewSeller } from '../i3/support.ts'
export { downloadBytes, noHorizontalScroll, packingCommand, packingList, pdfPages, postJson, realDay, writeEvent } from '../i2/support.ts'
export { anonymousPhone, endBroadcast } from '../n4b/support.ts'

/** 시험 배송지 (AC-T1-02의 값) */
export const ADDRESS = { name: '홍길동', phone: '010-1234-5678', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', zip: '04524', memo: '문 앞에' }
/** 시험 보내는 사람 */
export const SENDER = { name: '다육이네', phone: '031-123-4567', address: '경기도 수원시 팔달구 효원로 1', detail: '1층', zip: '16490' }

export const WAYBILL_NOTE = '운송장은 일반 프린터나 100×150 라벨 프린터로 찍어요. 라벨 프린터(B1)로는 찍을 수 없어요.'
export const PICKED_UP_TEXT = '택배사가 이미 가져갔어요. 택배사에 직접 문의해 주세요.'
export const LOCKED_TEXT = '택배 접수를 먼저 취소해 주세요.'
export const ADDRESS_NOTE = '받는 분·연락처·주소는 이 주문을 보내는 데만 쓰고, 주문 날짜로부터 30일 뒤 지워요.'

/** 오늘(KST)에서 days일 전 YYYY-MM-DD */
export function kstDaysAgo(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - days * 86_400_000))
}

async function put(page: Page, path: string, data: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await page.request.put(path, { data, headers: { Origin: new URL(page.url()).origin } })
  return { status: res.status(), body: (await res.json()) as Record<string, unknown> }
}

/** 새 판매자로 로그인하고 설정 "택배"(가짜 택배사·보내는 사람)를 API로 넣는다 */
export async function parcelSeller(page: Page, settings: Record<string, unknown> = { carrier: 'FAKE', sender: SENDER, box: '소' }): Promise<Seller> {
  const seller = await loginNewSeller(page)
  if (Object.keys(settings).length > 0) {
    const res = await put(page, '/api/parcels/settings', settings)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  }
  return seller
}

export interface ParcelBrief {
  state: string
  invoice: string | null
  invoiceText: string | null
  status: string | null
  checkedAt: string | null
  reason: string | null
  message: string | null
  cancellable: boolean
  trackUrl: string | null
}
export interface ParcelRow { buyer: string; name: string; reason: string | null; message: string | null; ready: boolean; box: string; qty: number; total: number; parcel: ParcelBrief | null }
export interface ParcelDay { date: string; blocked: { code: string; message: string } | null; ready: ParcelRow[]; excluded: ParcelRow[]; booked: ParcelRow[] }

export async function parcelDay(page: Page, date: string): Promise<ParcelDay> {
  const res = await page.request.get(`/api/parcels/days/${date}`)
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as ParcelDay
}

export async function rowOf(page: Page, date: string, buyer: string): Promise<ParcelRow & { group: 'ready' | 'excluded' | 'booked' }> {
  const day = await parcelDay(page, date)
  for (const group of ['ready', 'excluded', 'booked'] as const) {
    const row = day[group].find((r) => r.buyer === buyer)
    if (row !== undefined) return { ...row, group }
  }
  throw new Error(`묶음 없음: ${buyer}`)
}

/** 그 묶음의 최종 금액 */
export async function totalOf(page: Page, date: string, buyer: string): Promise<number> {
  const res = await page.request.get(`/api/days/${date}`)
  expect(res.status(), await res.text()).toBe(200)
  const body = (await res.json()) as { settlements: { buyer: string; date: string; total: number }[] }
  const s = body.settlements.find((x) => x.buyer === buyer && x.date === date)
  if (s === undefined) throw new Error(`정산 없음: ${buyer}`)
  return s.total
}

export async function payAll(page: Page, date: string, buyer: string): Promise<void> {
  const amount = await totalOf(page, date, buyer)
  const res = await postJson(page, `/api/events?date=${date}`, { requestId: crypto.randomUUID(), type: 'settlement.payment', buyer, date, amount })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

export async function packAll(page: Page, date: string, buyer: string): Promise<void> {
  const entry = (await packingList(page, date)).find((e) => e.buyer === buyer)
  if (entry === undefined) throw new Error(`포장 묶음 없음: ${buyer}`)
  const res = await packingCommand(page, date, { buyer, action: 'pack', items: entry.items.map((i) => i.key) })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

/** 판매자가 배송지를 적는다 (확인함) */
export async function sellerAddress(page: Page, date: string, buyer: string, address: Record<string, string> = ADDRESS): Promise<void> {
  const res = await put(page, `/api/parcels/days/${date}/address`, { requestId: crypto.randomUUID(), buyer, address })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

/**
 * 실제 방송 하나: 구매자마다 상품 count개. memo를 주면 메모 구매자(표시 이름 "문자찜(<메모>)" — 서로 다른 이름, 전화번호 없는 문자찜은
 * 찜마다 새 구매자라 count는 1만),
 * phone만 주면 전화번호 구매자(표시 이름은 모두 "문자찜" — 이름 규칙 D-098 시험용). 구매자 ID를 준 순서대로
 */
export async function parcelDayWith(page: Page, opts: { date?: string; buyers: { phone?: string; memo?: string; count?: number }[] }): Promise<{ date: string; b: string; buyers: string[] }> {
  const date = opts.date ?? kstDaysAgo(2)
  const products: { no: number; name: string; price: number }[] = []
  const claims: { no: number; phone?: string; memo?: string }[] = []
  let no = 0
  for (const buyer of opts.buyers) {
    if (buyer.phone === undefined && (buyer.count ?? 1) !== 1) throw new Error('메모 구매자는 상품 하나만 (찜마다 새 구매자)')
    for (let k = 0; k < (buyer.count ?? 1); k++) {
      no += 1
      products.push({ no, name: `품종${String(no)}`, price: 1000 * no })
      claims.push(buyer.phone !== undefined ? { no, phone: buyer.phone } : { no, memo: buyer.memo ?? '' })
    }
  }
  const { b, buyers } = await realDay(page, { date, products, claims })
  return { date, b, buyers: opts.buyers.map((x) => buyers.get(x.phone ?? x.memo ?? '')!) }
}

/** 시험마다 다른 상세 주소 (가짜 택배사가 받은 요청 중 이 시험 것만 고를 때) */
export function taggedAddress(tag: string): typeof ADDRESS {
  return { ...ADDRESS, detail: `101동 202호 ${tag}` }
}

/** 접수할 수 있는 묶음으로: 입금 완료 → 포장 완료 → 배송지(판매자가 적어 확인함) */
export async function makeReady(page: Page, date: string, buyer: string, address: Record<string, string> = ADDRESS): Promise<void> {
  await payAll(page, date, buyer)
  await packAll(page, date, buyer)
  await sellerAddress(page, date, buyer, address)
}

export async function bookApi(page: Page, date: string, buyers: string[], requestId: string = crypto.randomUUID()): Promise<{ status: number; body: Record<string, unknown> }> {
  return await postJson(page, `/api/parcels/days/${date}/book`, { requestId, items: buyers.map((buyer) => ({ buyer })) })
}

// ── 가짜 택배사 조작 (세션 없음) ─────────────────────────────────────────

export async function fakeParcel<T = Record<string, unknown>>(page: Page, path: string, data: unknown = {}): Promise<T> {
  const res = await page.request.post(`${apiUrl()}/_e2e/parcel/${path}`, { data })
  expect(res.ok(), `${path} ${await res.text()}`).toBe(true)
  return (await res.json()) as T
}

export interface FakeRequest { op: string; requestKey: string; invoices: string[]; body: unknown }
export async function fakeRequests(page: Page): Promise<{ requests: FakeRequest[]; bookings: number }> {
  const res = await page.request.get(`${apiUrl()}/_e2e/parcel/requests`)
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json()) as { requests: FakeRequest[]; bookings: number }
}

/** 상세 주소에 tag가 든 접수 요청만 (다른 시험이 쌓은 요청 제외) */
export function bookRequestsTagged(requests: FakeRequest[], tag: string): FakeRequest[] {
  return requests.filter((r) => r.op === 'book' && JSON.stringify(r.body).includes(tag))
}

// ── 화면 ────────────────────────────────────────────────────────────────

export function readyGroup(page: Page): Locator {
  return page.getByRole('region', { name: '보낼 수 있어요', exact: true })
}
export function excludedGroup(page: Page): Locator {
  return page.getByRole('region', { name: '아직 못 보내요', exact: true })
}
export function bookedGroup(page: Page): Locator {
  return page.getByRole('region', { name: '접수했어요', exact: true })
}
export function bookButton(page: Page): Locator {
  return page.getByRole('button', { name: /^\d+개 택배 접수하기$/ })
}

/** 택배 화면을 연다 (그날 목록이 다 그려질 때까지) */
export async function openParcels(page: Page, date: string): Promise<void> {
  await page.goto(`/parcels?date=${date}`)
  await expect(page.getByRole('heading', { level: 1, name: '택배 접수' })).toBeVisible()
  await expect(bookedGroup(page)).toBeVisible()
}

/** 누르는 곳 높이 44px 이상 */
export async function tall(target: Locator): Promise<void> {
  const box = await target.boundingBox()
  expect(box, '보이는 곳').not.toBeNull()
  expect(box!.height).toBeGreaterThanOrEqual(44)
}
