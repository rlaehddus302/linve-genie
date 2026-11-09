// KP1 한 바퀴 (test-e2e) — AC-KP1-29, PC와 375px.
// 방송 1(유튜브 UC_A 15번 1등) → 링크에서 배송지 + "다음 주문에도" → 방송 2(같은 UC_A) → 콘솔 첫 물음에 [보이기](D-KP1-43) → 콘솔 꼬리표 "단골…"("처음" 아님)
// → 묶음에 "지난 주문 배송지예요" → [배송지 확인] → 리포트에 다시 온 손님 1 → 링크에서 [저장한 정보 지우기] → 방송 3 묶음엔 보이지 않음.
import { test, expect } from '@playwright/test'
import {
  ADDRESS,
  BADGES_ASK,
  DELETED,
  DELETE_SAVED,
  LINK_PREFILL,
  PHONE,
  PREFILL_TITLE,
  SAVED_LINE,
  VIEWPORTS,
  addressForm,
  badgesAsk,
  broadcast,
  buyerBrowser,
  bundleOf,
  chat,
  chatRow,
  consentBox,
  endBroadcast,
  kstDate,
  LEDGER_SOURCE_LINE,
  ledgerSection,
  loginNewSeller,
  makeLink,
  noOverflow,
  openBundle,
  openConsole,
  parcelSettings,
  registerApi,
  scopeView,
  sendAddress,
  youtubeSale,
} from './support.ts'

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`한 바퀴 ${name}`, () => {
    test.use({ viewport })

    test(`AC-KP1-29 ${name}: 동의 → 다음 방송 꼬리표·확인 전 배송지·확인 → 리포트 다시 온 손님 1 → 링크에서 지움 → 그다음 방송엔 안 보임`, async ({ page, browser }) => {
      test.setTimeout(300_000)
      await loginNewSeller(page)
      await parcelSettings(page)
      const ch = `UC_A${String(Date.now())}`
      const d1 = kstDate(6)
      const d2 = kstDate(3)
      const d3 = kstDate(1)

      // 방송 1: UC_A가 15번 1등 (120,000원 입금 — 단골 금액 기준 100,000원 이상)
      const s1 = await youtubeSale(page, { date: d1, ch, nick: '가람손님', prices: [120_000], paid: true, firstNo: 15 })
      expect((await scopeView(page, d1, false)).products.find((p) => p.no === 15)?.winners).toEqual([ch])
      await endBroadcast(page, s1.b)

      // 링크: 배송지 + "다음 주문에도"
      const link1 = await makeLink(page, d1, s1.buyer)
      const buyer = await buyerBrowser(browser, page, viewport)
      try {
        await buyer.page.goto(link1)
        await expect(consentBox(buyer.page)).not.toBeChecked()
        await sendAddress(buyer.page, true)
        await expect(ledgerSection(buyer.page)).toContainText(SAVED_LINE)
        if (viewport.width === PHONE.width) await noOverflow(buyer.page, '링크 375px')

        // 방송 2: 같은 UC_A — 콘솔 꼬리표
        const b2 = await broadcast(page, d2)
        await registerApi(page, b2, 15, '핑크프릴', 10_000)
        await openConsole(page, b2)
        // D-KP1-43(AC-KP1-29): 처음엔 손님 표시를 정하지 않아 콘솔이 한 번 묻는다 → [보이기]
        await expect(badgesAsk(page)).toContainText(BADGES_ASK)
        await badgesAsk(page).getByRole('button', { name: '보이기', exact: true }).click()
        await expect(badgesAsk(page)).toHaveCount(0)
        await chat(page, b2, ch, '가람손님', '15')
        const row = chatRow(page, '가람손님')
        await expect(row).toContainText('단골 · 누적 120,000원')
        await expect(row).not.toContainText('처음')
        await expect(page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^15번 / })).toContainText('가람손님')
        if (viewport.width === PHONE.width) await noOverflow(page, '콘솔 375px')
        await expect.poll(async () => (await scopeView(page, d2, false)).buyers.find((x) => x.id === ch)?.subtotal ?? 0).toBe(10_000)
        const buyer2 = (await scopeView(page, d2, false)).buyers.find((x) => x.id === ch)!
        const id2 = buyer2.current ?? buyer2.id

        // 묶음 자세히: "지난 주문 배송지예요" → [배송지 확인]
        const region = await openBundle(page, d2, id2)
        const prefill = region.getByRole('region', { name: PREFILL_TITLE })
        await expect(prefill).toContainText(ADDRESS.address)
        await expect(prefill).toContainText('확인 전')
        await prefill.getByRole('button', { name: '배송지 확인' }).click()
        await expect(region).toContainText('확인함')
        // D-KP1-44: 출처 장부 확인 — "손님이 지난번에 적은 배송지 · 판매자가 확인함"
        await expect(region).toContainText(LEDGER_SOURCE_LINE)
        expect((await bundleOf(page, d2, id2)).address).toMatchObject({ address: ADDRESS.address, source: 'LEDGER', confirmed: true })
        if (viewport.width === PHONE.width) await noOverflow(page, '묶음 자세히 375px')
        await endBroadcast(page, b2)

        // 리포트: 다시 온 손님 1
        await page.goto(`/settlements?date=${d2}`)
        await page.getByRole('link', { name: '라이브 리포트' }).click() // 문구 바뀜 (D-UX4-86)
        const people = page.locator('main section').filter({ has: page.getByRole('heading', { name: '손님', exact: true }) })
        await expect(people.locator('div').filter({ hasText: /^다시 온 손님/ })).toContainText('1명')
        await expect(people.locator('div').filter({ hasText: /^새 손님/ })).toContainText('0명')
        expect(await page.locator('main').innerText()).not.toContain('가람손님')
        if (viewport.width === PHONE.width) await noOverflow(page, '리포트 375px')

        // 링크에서 [저장한 정보 지우기]
        await buyer.page.goto(link1)
        await ledgerSection(buyer.page).getByRole('link', { name: DELETE_SAVED }).click()
        await ledgerSection(buyer.page).getByRole('button', { name: '지우기', exact: true }).click()
        await expect(buyer.page.getByText(DELETED, { exact: true })).toBeVisible()
        await expect(buyer.page.getByText(SAVED_LINE)).toHaveCount(0)
      } finally {
        await buyer.context.close()
      }

      // 방송 3: 묶음에 지난 주문 배송지가 보이지 않는다 (판매자·링크 모두)
      const s3 = await youtubeSale(page, { date: d3, ch, nick: '가람손님', prices: [7_000], paid: false, firstNo: 15 })
      const region3 = await openBundle(page, d3, s3.buyer)
      await expect(region3.getByRole('button', { name: '배송지 적기' })).toBeVisible()
      await expect(region3.getByRole('region', { name: PREFILL_TITLE })).toHaveCount(0)
      await expect(region3).not.toContainText(ADDRESS.address)
      expect((await bundleOf(page, d3, s3.buyer)).ledger ?? null).toBeNull()
      const link3 = await makeLink(page, d3, s3.buyer)
      const buyer3 = await buyerBrowser(browser, page, viewport)
      try {
        await buyer3.page.goto(link3)
        await expect(buyer3.page.getByText(LINK_PREFILL)).toHaveCount(0)
        await expect(addressForm(buyer3.page).getByLabel('받는 분', { exact: true })).toHaveValue('')
        await expect(consentBox(buyer3.page)).not.toBeChecked()
        await expect(ledgerSection(buyer3.page)).toHaveCount(0)
      } finally {
        await buyer3.context.close()
      }
    })
  })
}
