// CRM1 날짜 줄 낱말·봉인 뒤 노쇼 기록 (test-e2e) — AC-CRM1-17(D-CRM1-13 낱말), AC-CRM1-33(D-CRM1-12 보관 행).
// 기대값은 acceptance.md·D-CRM1-12·13 그대로. 봉인은 /_e2e/seal, 1시간 차례는 /_e2e/customer-archive(지금 한 번)로 부른다.
// 차례는 모든 판매자를 돈다 — 이 폴더는 일꾼 1명(workers: 1)이라 다른 시험과 겹치지 않는다. 서버 기동 때·1시간마다 저절로 도는 차례가
// 시험 한가운데 끼면 "차례가 돌지 않은 봉인 날짜"가 "돈 날짜"로 바뀔 수 있다(한 시험이 수십 초라 드묾 — 흔들리면 이것부터 본다).
import { test, expect, type Page } from '@playwright/test'
import { apiUrl } from '../i3/support.ts'
import { broadcast, buyerRows, chat, customerDateKo, customerRows, dayCustomers, kstDate, loginNewSeller, payAll, scopeView, writeEvent, youtubeSale, type DayCustomer, type Seller } from './support.ts'

test('AC-CRM1-17 (D-CRM1-13): 날짜 줄 낱말 — 센 미입금 "미입금으로 셈" 하나, 센 부분 입금 "부분 입금"+"미입금으로 셈", 기다리는 날 안 "입금 기다리는 중", 입금 완료는 그대로', async ({ page }) => {
  test.setTimeout(180_000)
  await loginNewSeller(page)
  const ch = `UC_W${String(Date.now())}`
  const [dPaid, dPartial, dUnpaid, dWaiting] = [kstDate(12), kstDate(8), kstDate(5), kstDate(1)] as const
  await youtubeSale(page, { date: dPaid, ch, nick: '낱말손님', prices: [6_000], paid: true })
  const partial = await youtubeSale(page, { date: dPartial, ch, nick: '낱말손님', prices: [10_000], paid: false })
  expect((await writeEvent(page, { type: 'settlement.payment', buyer: partial.buyer, date: dPartial, amount: 4_000 }, { date: dPartial, rehearsal: false })).status).toBeLessThan(300)
  await expect.poll(async () => (await scopeView(page, dPartial, false)).settlements.find((x) => x.buyer === partial.buyer)?.payment).toBe('PARTIAL')
  await youtubeSale(page, { date: dUnpaid, ch, nick: '낱말손님', prices: [7_000], paid: false })
  await youtubeSale(page, { date: dWaiting, ch, nick: '낱말손님', prices: [8_000], paid: false })

  await page.goto('/buyers?view=customers')
  await customerRows(page).filter({ hasText: '낱말손님' }).getByRole('link').first().click()
  const detail = page.getByRole('region', { name: '손님 자세히' })
  // 기다리는 날 3일(기본): 8일 전·5일 전은 센 날, 1일 전은 아직 기다리는 날 → 미입금 2번
  await expect(detail.getByRole('region', { name: '손님 기록' })).toContainText(`미입금 2번 · 마지막 ${customerDateKo(dUnpaid)}`)
  const lines = detail.getByRole('region', { name: '날짜별 기록' }).getByRole('link')
  await expect(lines).toHaveCount(4)
  const words = async (i: number) => await lines.nth(i).innerText()
  const count = (text: string, word: RegExp) => (text.match(word) ?? []).length

  await expect(lines.nth(0)).toContainText(customerDateKo(dWaiting))
  await expect(lines.nth(0)).toContainText('입금 기다리는 중')
  expect(count(await words(0), /미입금/g), '기다리는 날 줄에 "미입금" 없음').toBe(0)

  await expect(lines.nth(1)).toContainText(customerDateKo(dUnpaid))
  await expect(lines.nth(1)).toContainText('미입금으로 셈')
  expect(count(await words(1), /미입금/g), '센 미입금 줄의 "미입금"은 하나').toBe(1)
  await expect(lines.nth(1)).not.toContainText('입금 기다리는 중')

  await expect(lines.nth(2)).toContainText(customerDateKo(dPartial))
  await expect(lines.nth(2)).toContainText('부분 입금')
  await expect(lines.nth(2)).toContainText('미입금으로 셈')
  expect(count(await words(2), /미입금/g)).toBe(1)

  await expect(lines.nth(3)).toContainText(customerDateKo(dPaid))
  await expect(lines.nth(3)).toContainText('입금 완료')
  expect(count(await words(3), /미입금|기다리는/g)).toBe(0)
})

interface NoShowWorld { old: string; recent: string; n: string; m: string }

/**
 * AC-CRM1-33 Given: 40일 전 실제 날짜 old(유튜브 채팅 있음)에
 * - UC_N(노쇼손님)의 1등 찜(15번 10,000)을 사유 "입금 안 함"으로 취소하고 15번을 다른 손님(UC_X)에게 다시 판다 → UC_N 품목 0·입금 0
 * - UC_M(취소손님)은 16번 12,000 입금 완료, 17번 1등 찜은 사유 "연락 없음"으로 취소당함
 * 둘 다 2일 전 날짜(recent)에 입금 안 된 구매(아직 기다리는 날 안 — 세지 않음)가 있어 그날 목록·콘솔 조회에서 숫자를 본다.
 */
async function noShowWorld(page: Page): Promise<NoShowWorld> {
  const t = String(Date.now())
  const n = `UC_N${t}`
  const m = `UC_M${t}`
  const old = kstDate(40)
  const recent = kstDate(2)
  const b = await broadcast(page, old)
  await youtubeSale(page, { date: old, b, ch: n, nick: '노쇼손님', prices: [10_000], paid: false, firstNo: 15 })
  expect((await writeEvent(page, { type: 'host.cancel', b, no: 15, buyer: n, reason: '입금 안 함' })).status).toBeLessThan(300)
  await expect.poll(async () => (await scopeView(page, old, false)).products.find((p) => p.no === 15)?.winners ?? ['?']).toEqual([])
  const x = `UC_X${t}`
  await chat(page, b, x, '다시산손님', '15')
  await expect.poll(async () => (await scopeView(page, old, false)).products.find((p) => p.no === 15)?.winners ?? []).toEqual([x])
  await payAll(page, old, x)
  const ms = await youtubeSale(page, { date: old, b, ch: m, nick: '취소손님', prices: [12_000, 5_000], paid: false, firstNo: 16 })
  expect((await writeEvent(page, { type: 'host.cancel', b, no: 17, buyer: m, reason: '연락 없음' })).status).toBeLessThan(300)
  await expect.poll(async () => (await scopeView(page, old, false)).buyers.find((y) => y.id === m)?.subtotal ?? -1).toBe(12_000)
  await payAll(page, old, ms.buyer)
  // UC_N은 그날 품목 0 (다시 팔렸다)
  expect((await scopeView(page, old, false)).buyers.find((y) => y.id === n)?.subtotal ?? 0).toBe(0)
  const rb = await broadcast(page, recent)
  await youtubeSale(page, { date: recent, b: rb, ch: n, nick: '노쇼손님', prices: [3_000], paid: false, firstNo: 40 })
  await youtubeSale(page, { date: recent, b: rb, ch: m, nick: '취소손님', prices: [4_000], paid: false, firstNo: 41 })
  return { old, recent, n, m }
}

async function seal(page: Page, seller: Seller, date: string): Promise<void> {
  const res = await page.request.post(`${apiUrl()}/_e2e/seal`, { data: { loginId: seller.loginId, date } })
  expect(res.ok(), await res.text()).toBe(true)
  expect(((await res.json()) as { sealed: boolean }).sealed).toBe(true)
}

async function archiveTurn(page: Page): Promise<{ written: number; frozen: number; failed: number }> {
  const res = await page.request.post(`${apiUrl()}/_e2e/customer-archive`, { data: {} })
  expect(res.ok(), await res.text()).toBe(true)
  const body = (await res.json()) as { written: number; frozen: number; failed: number }
  expect(body.failed, JSON.stringify(body)).toBe(0)
  return body
}

async function rowOf(page: Page, date: string, buyer: string): Promise<DayCustomer> {
  const row = (await dayCustomers(page, date)).customers.find((c) => c.buyer === buyer)
  if (row === undefined) throw new Error(`${date} 손님 기록에 ${buyer} 없음`)
  return row
}

const pick = (c: DayCustomer) => ({ purchaseDays: c.purchaseDays, purchaseTotal: c.purchaseTotal, unpaidDays: c.unpaidDays, lastUnpaid: c.lastUnpaid, cancels: c.cancels, caution: c.caution })

test('AC-CRM1-33 (3)(4): 차례가 한 번도 돌지 않은 봉인 날짜는 장부만으로 센다 — 취소·"입금 안 함"을 지어내지 않고, 그 뒤 차례가 돌아도 그대로', async ({ page }) => {
  test.setTimeout(240_000)
  const seller = await loginNewSeller(page)
  const w = await noShowWorld(page)
  // 봉인 전: 지금 상태로 센다 (D-CRM1-04 (나), D-CRM1-03 ②)
  expect(pick(await rowOf(page, w.recent, w.n))).toEqual({ purchaseDays: 0, purchaseTotal: 0, unpaidDays: 1, lastUnpaid: w.old, cancels: 1, caution: true })
  expect(pick(await rowOf(page, w.recent, w.m))).toEqual({ purchaseDays: 1, purchaseTotal: 12_000, unpaidDays: 0, lastUnpaid: null, cancels: 1, caution: false })

  await seal(page, seller, w.old) // 차례 없이 봉인
  expect(pick(await rowOf(page, w.recent, w.n))).toEqual({ purchaseDays: 0, purchaseTotal: 0, unpaidDays: 0, lastUnpaid: null, cancels: 0, caution: false })
  expect(pick(await rowOf(page, w.recent, w.m))).toEqual({ purchaseDays: 1, purchaseTotal: 12_000, unpaidDays: 0, lastUnpaid: null, cancels: 0, caution: false })
  // 봉인 뒤 차례가 돌아도 봉인 날짜에는 쓰지 않는다 (4)
  await archiveTurn(page)
  expect(pick(await rowOf(page, w.recent, w.n))).toEqual({ purchaseDays: 0, purchaseTotal: 0, unpaidDays: 0, lastUnpaid: null, cancels: 0, caution: false })
  expect(pick(await rowOf(page, w.recent, w.m)).cancels).toBe(0)
})

test('AC-CRM1-33 (1)(2)(4): 차례가 돈 뒤 봉인한 날짜의 "입금 안 함" 노쇼는 봉인 뒤에도 미입금 1번·취소 1번·"입금 늦음 주의" — 모든 손님·다른 날짜 목록·손님 자세히(봉인 날짜 줄은 누를 수 없음)·그날 자세히 404', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 375, height: 812 }) // 휴대폰 카드 — 줄에 "미입금 1번" 글이 그대로 보인다
  const seller = await loginNewSeller(page)
  const w = await noShowWorld(page)
  const nBefore = pick(await rowOf(page, w.recent, w.n))
  const mBefore = pick(await rowOf(page, w.recent, w.m))
  expect(nBefore).toEqual({ purchaseDays: 0, purchaseTotal: 0, unpaidDays: 1, lastUnpaid: w.old, cancels: 1, caution: true })
  expect(mBefore).toEqual({ purchaseDays: 1, purchaseTotal: 12_000, unpaidDays: 0, lastUnpaid: null, cancels: 1, caution: false })
  // 봉인 전 그날 자세히는 열린다 (봉인 뒤 404와 견주려고)
  expect((await page.request.get(`/api/days/${w.old}/customer?buyer=${encodeURIComponent(w.n)}`)).status()).toBe(200)

  const turn = await archiveTurn(page)
  expect(turn.written).toBeGreaterThanOrEqual(1)
  await seal(page, seller, w.old)

  // 봉인 전과 같은 숫자 (1)(2)
  expect(pick(await rowOf(page, w.recent, w.n))).toEqual(nBefore)
  expect(pick(await rowOf(page, w.recent, w.m))).toEqual(mBefore)
  // 그 뒤 차례가 또 돌아도 그대로 (4)
  await archiveTurn(page)
  expect(pick(await rowOf(page, w.recent, w.n))).toEqual(nBefore)
  expect(pick(await rowOf(page, w.recent, w.m))).toEqual(mBefore)
  // 장부에 없는 구매자의 그날 자세히는 404 그대로
  expect((await page.request.get(`/api/days/${w.old}/customer?buyer=${encodeURIComponent(w.n)}`)).status()).toBe(404)

  // 다른 실제 날짜 구매자 목록: 꼬리표
  await page.goto(`/buyers?date=${w.recent}`)
  await expect(buyerRows(page).filter({ hasText: '노쇼손님' })).toContainText('입금 늦음 주의')
  await expect(buyerRows(page).filter({ hasText: '취소손님' })).not.toContainText('입금 늦음 주의')

  // 모든 손님 줄
  await page.goto('/buyers?view=customers')
  const nRow = customerRows(page).filter({ hasText: '노쇼손님' })
  await expect(nRow).toHaveCount(1)
  await expect(nRow).toContainText('미입금 1번')
  await expect(nRow).toContainText('입금 늦음 주의')
  const mRow = customerRows(page).filter({ hasText: '취소손님' })
  await expect(mRow).toContainText(`12,000원`)
  await expect(mRow).toContainText('미입금 0번')

  // 손님 자세히: 미입금 1번 · 마지막 old · 취소 1번, 봉인 날짜 줄은 보이되 누르는 것이 아니다
  await nRow.getByRole('link').first().click()
  const detail = page.getByRole('region', { name: '손님 자세히' })
  const record = detail.getByRole('region', { name: '손님 기록' })
  await expect(record).toContainText(`미입금 1번 · 마지막 ${customerDateKo(w.old)}`)
  await expect(record).toContainText('취소 1번')
  await expect(record).toContainText('입금 늦음 주의')
  const days = detail.getByRole('region', { name: '날짜별 기록' })
  await expect(days.getByRole('listitem')).toHaveCount(2)
  const sealedLine = days.getByRole('listitem').filter({ hasText: customerDateKo(w.old) })
  await expect(sealedLine).toHaveCount(1)
  await expect(sealedLine).toContainText('미입금으로 셈')
  await expect(sealedLine.getByRole('link')).toHaveCount(0)
  await expect(sealedLine.getByRole('button')).toHaveCount(0)
  await expect(days.getByRole('link')).toHaveCount(1) // recent 줄만 누를 수 있다
  await expect(days.getByRole('link').first()).toContainText(customerDateKo(w.recent))

  await page.goBack()
  await customerRows(page).filter({ hasText: '취소손님' }).getByRole('link').first().click()
  const mRecord = page.getByRole('region', { name: '손님 자세히' }).getByRole('region', { name: '손님 기록' })
  await expect(mRecord).toContainText('누적 구매 12,000원 · 1번')
  await expect(mRecord).toContainText(`마지막 구매 ${customerDateKo(w.old)}`)
  await expect(mRecord).toContainText('취소 1번')
  await expect(mRecord).toContainText('미입금 없음')
})
