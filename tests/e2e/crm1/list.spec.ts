// CRM1 구매자 목록 꼬리표·"누적 큰 순"·거르기 (test-e2e) — AC-CRM1-13·14·29.
// 기대값은 acceptance.md 그대로: 단골 = 3번 이상 또는 누적 100,000원 이상(기본), 입금 늦음 주의 = 미입금 날 1번 이상(기다리는 날 3일 지남).
import { test, expect, type Page } from '@playwright/test'
import { buyerRows, chat, kstDate, loginNewSeller, smsSale, writeEvent, youtubeSale } from './support.ts'

/** 목록 줄의 이름 순서 (카드·표 모두 이름 글자로) */
async function names(page: Page, wanted: readonly string[]): Promise<string[]> {
  const texts = await buyerRows(page).allInnerTexts()
  return texts.map((t) => wanted.find((w) => t.includes(w)) ?? `?${t.slice(0, 20)}`)
}

/** AC-CRM1-14 세계: 한 날짜에 A(나리 50,000)·B(다솜 120,000)·C(가람 50,000)는 입금 완료, D(라온 10,000)는 미입금(5일 전 → 미입금 날), E(마루)는 채팅만 */
async function sortWorld(page: Page): Promise<{ date: string; b: string }> {
  const date = kstDate(5)
  const t = String(Date.now())
  const a = await youtubeSale(page, { date, ch: `UC_na${t}`, nick: '나리', prices: [50_000], paid: true, firstNo: 10 })
  await youtubeSale(page, { date, b: a.b, ch: `UC_da${t}`, nick: '다솜', prices: [60_000, 60_000], paid: true, firstNo: 20 })
  await youtubeSale(page, { date, b: a.b, ch: `UC_ga${t}`, nick: '가람', prices: [50_000], paid: true, firstNo: 30 })
  await youtubeSale(page, { date, b: a.b, ch: `UC_ra${t}`, nick: '라온', prices: [10_000], paid: false, firstNo: 40 })
  await chat(page, a.b, `UC_ma${t}`, '마루', '안녕하세요')
  return { date, b: a.b }
}

for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 900 }]) {
  test.describe(`${String(viewport.width)}px`, () => {
    test.use({ viewport })

    test(`AC-CRM1-14 ${String(viewport.width)}px: 누적 큰 순 B→C→A→D(같은 금액은 이름 순), 입금 늦음 주의만 = D, 단골만 = B, 모두 = 넷, "찜 없는 구매자도 보기"와 함께`, async ({ page }) => {
      test.setTimeout(150_000)
      await loginNewSeller(page)
      const { date } = await sortWorld(page)
      const who = ['나리', '다솜', '가람', '라온', '마루']
      await page.goto(`/buyers?date=${date}`)
      const sort = page.getByRole('group', { name: '정렬' })
      const filter = page.getByRole('group', { name: '거르기' })
      // 기존 "이름 순"은 그대로
      await expect(buyerRows(page)).toHaveCount(4)
      expect(await names(page, who)).toEqual(['가람', '나리', '다솜', '라온'])
      await sort.getByRole('button', { name: '누적 큰 순' }).click()
      await expect(sort.getByRole('button', { name: '누적 큰 순' })).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => names(page, who)).toEqual(['다솜', '가람', '나리', '라온'])
      await filter.getByRole('button', { name: '입금 늦음 주의만' }).click()
      await expect.poll(() => names(page, who)).toEqual(['라온'])
      await filter.getByRole('button', { name: '단골만' }).click()
      await expect.poll(() => names(page, who)).toEqual(['다솜'])
      await expect(filter.getByRole('button', { name: '단골만' })).toHaveAttribute('aria-pressed', 'true')
      await expect(filter.getByRole('button', { name: '모두' })).toHaveAttribute('aria-pressed', 'false')
      await filter.getByRole('button', { name: '모두' }).click()
      await expect.poll(() => names(page, who)).toEqual(['다솜', '가람', '나리', '라온'])
      // 찜 없는 구매자도 보기: 거르기가 함께 적용된다
      await page.getByText('찜 없는 구매자도 보기').click()
      await expect(buyerRows(page)).toHaveCount(5)
      await filter.getByRole('button', { name: '단골만' }).click()
      await expect.poll(() => names(page, who)).toEqual(['다솜'])
      await filter.getByRole('button', { name: '모두' }).click()
      // "합계 큰 순"(그날 합계)은 그대로
      await sort.getByRole('button', { name: '합계 큰 순' }).click()
      await expect.poll(async () => (await names(page, who)).slice(0, 4)).toEqual(['다솜', '가람', '나리', '라온'])
    })
  })
}

test.describe('375px 꼬리표', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('AC-CRM1-13: A "단골", B "입금 늦음 주의", C "단골"·"입금 늦음 주의"·"차단" 글자, 꼬리표 없는 줄은 없음', async ({ page }) => {
    test.setTimeout(150_000)
    await loginNewSeller(page)
    const t = String(Date.now())
    const early = kstDate(12)
    const date = kstDate(5)
    const chC = `UC_cc${t}`
    await youtubeSale(page, { date: early, ch: chC, nick: '씨손님', prices: [7_000], paid: false, firstNo: 10 }) // 미입금 날
    const a = await youtubeSale(page, { date, ch: `UC_aa${t}`, nick: '에이손님', prices: [60_000, 60_000], paid: true, firstNo: 10 })
    await youtubeSale(page, { date, b: a.b, ch: `UC_bb${t}`, nick: '비손님', prices: [9_000], paid: false, firstNo: 20 })
    const c = await youtubeSale(page, { date, b: a.b, ch: chC, nick: '씨손님', prices: [110_000], paid: true, firstNo: 30 })
    await smsSale(page, { date, b: a.b, phone: '010-5555-4321', prices: [3_000], paid: true, firstNo: 40 })
    expect((await writeEvent(page, { type: 'host.blockBuyer', buyer: c.buyer, reason: '장난' }, { date, rehearsal: false })).status).toBeLessThan(300)
    await page.goto(`/buyers?date=${date}`)
    const row = (name: string) => buyerRows(page).filter({ hasText: name })
    await expect(row('씨손님')).toContainText('차단')
    await expect(row('에이손님')).toContainText('단골')
    await expect(row('에이손님')).not.toContainText('입금 늦음 주의')
    await expect(row('비손님')).toContainText('입금 늦음 주의')
    await expect(row('비손님')).not.toContainText('단골')
    for (const word of ['단골', '입금 늦음 주의', '차단']) await expect(row('씨손님').getByText(word, { exact: true })).toBeVisible()
    const plain = row('문자찜')
    await expect(plain).toHaveCount(1)
    await expect(plain).not.toContainText(/단골|입금 늦음 주의|차단/)
  })
})
