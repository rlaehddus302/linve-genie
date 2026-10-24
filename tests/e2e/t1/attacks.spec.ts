// T1 흐름 깨뜨리기 — 일부 실패·실패한 것만 다시, 연결 끊김 중 접수, 연타, 취소 모름, 리허설·다른 판매자 (AC-T1-21·31·33·37·62, PC-5) — test-e2e.
import { test, expect } from '@playwright/test'
import {
  ADDRESS,
  bookButton,
  bookedGroup,
  bookApi,
  bookRequestsTagged,
  excludedGroup,
  fakeParcel,
  fakeRequests,
  loginNewSeller,
  makeReady,
  openParcels,
  parcelDay,
  parcelDayWith,
  parcelSeller,
  postJson,
  kstDaysAgo,
  readyGroup,
  rowOf,
  sellerAddress,
  taggedAddress,
} from './support.ts'

test.describe('AC-T1-33 일부 실패와 "실패한 것만 다시" (화면)', () => {
  test('A 접수 · B 주소 거절 · C 접수됐는지 모름 → 줄마다 문장 → B 배송지 고침 → "실패한 것만 다시": A엔 요청 없음, B 새 요청 번호, C 같은 요청 번호·같은 송장', async ({ page }) => {
    test.setTimeout(180_000)
    await parcelSeller(page)
    const tag = `부분${String(Date.now())}`
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }, { memo: '나래' }, { memo: '다솜' }] })
    const [a, b, c] = buyers as [string, string, string]
    await makeReady(page, date, a, taggedAddress(`${tag}A`))
    await makeReady(page, date, b, { ...taggedAddress(`${tag}B`), address: `${ADDRESS.address} [주소거절]` })
    await makeReady(page, date, c, taggedAddress(`${tag}C`))
    // C: 택배사는 접수했는데 답이 끊긴다 (다음 접수 한 번)
    await fakeParcel(page, 'fail', { op: 'book', kind: 'TIMEOUT_AFTER_BOOK', times: 1 })
    expect((await bookApi(page, date, [c])).status).toBe(200)
    await expect.poll(async () => (await rowOf(page, date, c)).parcel?.state, { timeout: 30_000 }).toBe('UNKNOWN')

    await openParcels(page, date)
    // 화면에서 A·B 접수 (C는 모름이라 "보낼 수 있어요"에 없다)
    await expect(readyGroup(page).getByRole('checkbox')).toHaveCount(2)
    await bookButton(page).click()
    await page.getByRole('dialog', { name: '택배 접수' }).getByRole('button', { name: '접수하기' }).click()
    await expect(page.getByText('1개 접수했어요. 1개는 접수하지 못했어요 — 줄마다 이유를 확인해 주세요.')).toBeVisible()
    const names = Object.fromEntries((await parcelDay(page, date)).excluded.concat((await parcelDay(page, date)).booked, (await parcelDay(page, date)).ready).map((r) => [r.buyer, r.name]))
    const ex = excludedGroup(page)
    const rowB = ex.getByRole('listitem').filter({ hasText: names[b]! })
    const rowC = ex.getByRole('listitem').filter({ hasText: names[c]! })
    await expect(rowB).toContainText('택배사가 주소를 찾지 못했어요. 배송지를 확인해 주세요.')
    await expect(rowB.getByRole('link', { name: '배송지 보기' })).toBeVisible()
    await expect(rowC).toContainText('접수됐는지 아직 몰라요')
    await expect(rowC.getByRole('button', { name: '다시 확인' })).toBeVisible()
    await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(1)
    const aInvoice = (await rowOf(page, date, a)).parcel!.invoice!
    expect(await page.locator('main').innerText()).not.toMatch(/FAILED|UNKNOWN|ADDRESS|REJECTED/)

    // B 배송지 고침 (다른 화면에서)
    await sellerAddress(page, date, b, taggedAddress(`${tag}B`))
    const before = await fakeRequests(page)
    const firstC = bookRequestsTagged(before.requests, `${tag}C`)
    const firstB = bookRequestsTagged(before.requests, `${tag}B`)
    expect(firstC).toHaveLength(1)
    expect(firstB).toHaveLength(1)
    await expect(ex.getByRole('button', { name: '실패한 것만 다시' })).toBeEnabled()
    await ex.getByRole('button', { name: '실패한 것만 다시' }).click()
    await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(3, { timeout: 30_000 })
    const after = await fakeRequests(page)
    expect(bookRequestsTagged(after.requests, `${tag}A`)).toHaveLength(1)
    const bReqs = bookRequestsTagged(after.requests, `${tag}B`)
    const cReqs = bookRequestsTagged(after.requests, `${tag}C`)
    expect(bReqs).toHaveLength(2)
    expect(bReqs[1]!.requestKey).not.toBe(bReqs[0]!.requestKey)
    expect(cReqs).toHaveLength(2)
    expect(cReqs[1]!.requestKey).toBe(cReqs[0]!.requestKey)
    // C는 택배 하나: 처음에 실제로 접수된 송장 그대로
    const day = await parcelDay(page, date)
    const invoices = day.booked.map((r) => r.parcel!.invoice)
    expect(new Set(invoices).size).toBe(3)
    expect(invoices).toContain(aInvoice)
  })
})

test.describe('연결 끊김·연타 (AC-T1-31·62, PC-5)', () => {
  test('접수 답이 끊겨도 화면이 같은 요청 번호로 다시 묻는다 — 택배사 접수는 묶음마다 하나, 화면은 "접수했어요"', async ({ page }) => {
    await parcelSeller(page)
    const tag = `끊김${String(Date.now())}`
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }, { memo: '나래' }] })
    for (const [i, buyer] of buyers.entries()) await makeReady(page, date, buyer, taggedAddress(`${tag}${String(i)}`))
    await openParcels(page, date)
    const bodies: string[] = []
    let dropped = 0
    await page.route('**/api/parcels/days/*/book', async (route) => {
      bodies.push(route.request().postData() ?? '')
      if (dropped === 0) {
        dropped += 1
        // 서버는 받아 처리했지만 답이 오는 길에 끊긴다
        await route.fetch()
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })
    await bookButton(page).click()
    await page.getByRole('dialog', { name: '택배 접수' }).getByRole('button', { name: '접수하기' }).click()
    await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(2, { timeout: 20_000 })
    // 화면은 같은 요청 번호로 다시 보내 결과 문장을 받는다
    await expect(page.getByText('2개 접수했어요.')).toBeVisible({ timeout: 30_000 })
    expect(bodies.length).toBeGreaterThanOrEqual(2)
    const ids = new Set(bodies.map((b) => (JSON.parse(b) as { requestId: string }).requestId))
    expect(ids.size).toBe(1)
    const reqs = (await fakeRequests(page)).requests
    expect(bookRequestsTagged(reqs, `${tag}0`)).toHaveLength(1)
    expect(bookRequestsTagged(reqs, `${tag}1`)).toHaveLength(1)
  })

  test('확인 창 "접수하기" 연타·보내는 중 주 버튼 잠김 — 요청 하나', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    await makeReady(page, date, buyers[0]!)
    await openParcels(page, date)
    const posts: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/parcels/days/*/book', async (route) => {
      posts.push(route.request().postData() ?? '')
      await gate
      await route.continue()
    })
    await bookButton(page).click()
    await page.getByRole('dialog', { name: '택배 접수' }).getByRole('button', { name: '접수하기' }).dblclick()
    await expect(page.getByText('택배사에 접수하는 중이에요…')).toBeVisible()
    await expect(bookButton(page)).toBeDisabled()
    await expect(readyGroup(page).getByRole('checkbox')).toBeDisabled()
    await expect(readyGroup(page).getByRole('combobox', { name: '택배 크기' })).toBeDisabled() // FB1 D-FB1-05
    release()
    await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(1)
    expect(posts).toHaveLength(1)
  })
})

test.describe('AC-T1-37 취소 응답 없음 (화면)', () => {
  test('택배사 취소가 응답 없음이면 "취소됐는지 아직 몰라요. 잠시 뒤 다시 해 주세요."·줄 그대로, 다시 누르면 취소된다', async ({ page }) => {
    test.setTimeout(120_000)
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    await makeReady(page, date, buyers[0]!)
    expect((await bookApi(page, date, buyers)).status).toBe(200)
    const name = (await rowOf(page, date, buyers[0]!)).name
    await fakeParcel(page, 'fail', { op: 'cancel', kind: 'ERROR_500', times: 10 })
    await openParcels(page, date)
    const group = bookedGroup(page).getByRole('group', { name: `${name} 택배` })
    await group.getByRole('button', { name: '접수 취소' }).click()
    await page.getByRole('dialog', { name: '접수 취소' }).getByRole('button', { name: '취소하기' }).click()
    await expect(bookedGroup(page).getByText('취소됐는지 아직 몰라요. 잠시 뒤 다시 해 주세요.')).toBeVisible({ timeout: 60_000 })
    await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(1)
    expect((await rowOf(page, date, buyers[0]!)).parcel?.state).toBe('BOOKED')
    await fakeParcel(page, 'reset')
    await group.getByRole('button', { name: '접수 취소' }).click()
    await page.getByRole('dialog', { name: '접수 취소' }).getByRole('button', { name: '취소하기' }).click()
    await expect(readyGroup(page).getByRole('checkbox', { name })).toBeVisible()
  })
})

test.describe('리허설·다른 판매자', () => {
  test('리허설 날짜는 택배 화면 날짜에 없다, 다른 판매자의 날짜 주소는 "그 날짜는 택배를 접수할 수 없어요."', async ({ page, browser }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    await makeReady(page, date, buyers[0]!)
    const rehearsal = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date: kstDaysAgo(1), rehearsal: true })
    expect(rehearsal.status, JSON.stringify(rehearsal.body)).toBeLessThan(300)
    const days = (await (await page.request.get('/api/parcels/days')).json()) as { dates: { date: string }[] }
    expect(days.dates.map((d) => d.date)).toEqual([date])
    // 다른 판매자
    const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const other = await ctx.newPage()
    try {
      await loginNewSeller(other)
      await other.goto(`/parcels?date=${date}`)
      await expect(other.getByText('그 날짜는 택배를 접수할 수 없어요. 다른 날짜를 골라 주세요.')).toBeVisible()
      await expect(other.getByText(ADDRESS.name)).toHaveCount(0)
      const res = await other.request.get(`/api/parcels/days/${date}/bundle?buyer=${encodeURIComponent(buyers[0]!)}`)
      expect(res.status()).toBe(404)
    } finally {
      await ctx.close()
    }
  })
})
