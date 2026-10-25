// CRM1 "모든 손님" (test-e2e) — AC-CRM1-15(연도)·16·17·29. 기대값은 acceptance.md·D-CRM1-06 그대로.
import { test, expect, type Page } from '@playwright/test'
import { broadcast, chat, customerDateKo, customerRows, kstDate, loginNewSeller, smsSale, won, youtubeSale } from './support.ts'

/** 표지 25개(유튜브 23 + 문자 2)가 기록 묶음을 갖고, 채팅만 한 표지 5개는 따로 */
async function manyWorld(page: Page): Promise<{ t: string; phones: string[] }> {
  const t = String(Date.now())
  const dA = kstDate(8)
  const dB = kstDate(15)
  const bA = await broadcast(page, dA)
  for (let i = 0; i < 20; i++) await youtubeSale(page, { date: dA, b: bA, ch: `UC_${t}_${String(i)}`, nick: `손님${String(i).padStart(2, '0')}`, prices: [(i + 1) * 1_000], paid: true, firstNo: 100 + i })
  const bB = await broadcast(page, dB)
  for (let i = 20; i < 23; i++) await youtubeSale(page, { date: dB, b: bB, ch: `UC_${t}_${String(i)}`, nick: `손님${String(i)}`, prices: [2_000], paid: false, firstNo: 100 + i })
  const phones = [`010-6${t.slice(-3)}-2323`, `010-6${t.slice(-3)}-2424`]
  await smsSale(page, { date: dA, b: bA, phone: phones[0]!, prices: [500], paid: true, firstNo: 300 })
  await smsSale(page, { date: dA, b: bA, phone: phones[1]!, prices: [600], paid: true, firstNo: 301 })
  for (let i = 0; i < 5; i++) await chat(page, bA, `UC_${t}_chat${String(i)}`, `구경꾼${String(i)}`, '안녕하세요')
  // 손님00은 최근 날짜에 새 이름으로 한 번 더 (지난 날짜에만 쓴 닉네임 찾기)
  await youtubeSale(page, { date: kstDate(3), ch: `UC_${t}_0`, nick: '새이름', prices: [1_000], paid: true, firstNo: 10 })
  return { t, phones }
}

async function rowNames(page: Page): Promise<string[]> {
  const wide = (page.viewportSize()?.width ?? 0) >= 768
  return wide
    ? await page.getByRole('table', { name: '손님' }).locator('tbody tr td:first-child').allInnerTexts()
    : await customerRows(page).locator('.buyer-name').allInnerTexts()
}

test.describe('모든 손님 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('AC-CRM1-16·17: 20줄 + "더 보기"(5명 더), 채팅만 한 표지 없음, 정렬 셋·거르기·찾기(지난 닉네임·끝자리), 응답에 전화번호 없음, 자세히 갔다 뒤로 가기는 같은 정렬·줄 수·스크롤', async ({ page }) => {
    test.setTimeout(240_000)
    await loginNewSeller(page)
    const { phones } = await manyWorld(page)
    const bodies: string[] = []
    page.on('response', async (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/customers')) bodies.push(await r.text().catch(() => ''))
    })
    await page.goto('/buyers?view=customers')
    const region = page.getByRole('region', { name: '모든 손님' })
    await expect(region.getByRole('status').filter({ hasText: '손님 25명' })).toBeVisible()
    await expect(customerRows(page)).toHaveCount(20)
    const sort = region.getByRole('group', { name: '정렬' })
    await expect(sort.getByRole('button', { name: '누적 큰 순' })).toHaveAttribute('aria-pressed', 'true')
    // 누적 큰 순: 손님19(20,000) → 손님18 …
    expect((await rowNames(page)).slice(0, 3)).toEqual(['손님19', '손님18', '손님17'])
    await region.getByRole('button', { name: '더 보기 (5명 더)' }).click()
    await expect(customerRows(page)).toHaveCount(25)
    await expect(region).not.toContainText('구경꾼')
    const first = customerRows(page).first()
    await expect(first).toContainText(won(20_000))
    await expect(first).toContainText('1번')
    await expect(first).toContainText(`마지막 구매 ${customerDateKo(kstDate(8))}`)
    await expect(first).toContainText('미입금 0번')
    await expect(customerRows(page).filter({ hasText: '2424' })).toContainText('문자 · 끝자리 2424')

    // 최근 산 순: 구매 없는 손님(20·21·22)은 맨 뒤
    await sort.getByRole('button', { name: '최근 산 순' }).click()
    await expect(sort.getByRole('button', { name: '최근 산 순' })).toHaveAttribute('aria-pressed', 'true')
    await expect(customerRows(page)).toHaveCount(20)
    expect((await rowNames(page))[0]).toBe('새이름')
    await region.getByRole('button', { name: /^더 보기/ }).click()
    await expect(customerRows(page)).toHaveCount(25)
    expect((await rowNames(page)).slice(-3)).toEqual(['손님20', '손님21', '손님22'])
    // 입금 완료 구매가 없는 줄은 "아직 입금 완료된 구매 없음" 한 줄 (D-CRM1-16 (5)) — "누적 0원 · 0번"·"마지막 구매 구매 없음"이 아니다
    for (const name of ['손님20', '손님21', '손님22']) {
      const none = customerRows(page).filter({ hasText: name })
      await expect(none).toContainText('아직 입금 완료된 구매 없음')
      await expect(none).not.toContainText('누적 0원')
      await expect(none).not.toContainText('마지막 구매')
      await expect(none).toContainText('미입금 1번') // 15일 전 미입금 2,000원 — 기다리는 날이 지났다
    }
    await expect(customerRows(page).filter({ hasText: '손님19' })).not.toContainText('아직 입금 완료된 구매 없음')
    // 미입금 많은 순 (같으면 누적 큰 순 → 이름)
    await sort.getByRole('button', { name: '미입금 많은 순' }).click()
    await expect.poll(async () => (await rowNames(page)).slice(0, 4)).toEqual(['손님20', '손님21', '손님22', '손님19'])
    // 거르기
    const filter = region.getByRole('group', { name: '거르기' })
    await filter.getByRole('button', { name: '입금 늦음 주의만' }).click()
    await expect(customerRows(page)).toHaveCount(3)
    await filter.getByRole('button', { name: '단골만' }).click()
    await expect(region.getByRole('status').filter({ hasText: '손님 0명' })).toBeVisible()
    await filter.getByRole('button', { name: '모두' }).click()
    await expect(customerRows(page)).toHaveCount(20)

    // 찾기: 지난 날짜에만 쓴 닉네임 · 끝자리 4개
    const search = page.getByLabel('손님 찾기')
    await search.fill('손님00')
    await expect(region.getByRole('status').filter({ hasText: '손님 1명' })).toBeVisible()
    expect(await rowNames(page)).toEqual(['새이름'])
    await search.fill('2323')
    await expect(region.getByRole('status').filter({ hasText: '손님 1명' })).toBeVisible()
    await expect(customerRows(page).first()).toContainText('문자 · 끝자리 2323')
    // 숫자만이면 끝자리 4개 안에 들어 있어도 나온다 (D-CRM1-15: "23" → 끝자리 2323, 2424는 아님)
    await search.fill('23')
    await expect(region.getByRole('status').filter({ hasText: '손님 1명' })).toBeVisible()
    await expect(customerRows(page).first()).toContainText('문자 · 끝자리 2323')
    await search.fill('')
    await expect(region.getByRole('status').filter({ hasText: '손님 25명' })).toBeVisible()

    // 응답에 전화번호 키·전화번호가 없다
    const all = bodies.join('\n')
    expect(all.length).toBeGreaterThan(0)
    for (const p of phones) {
      expect(all).not.toContain(p)
      expect(all).not.toContain(p.replace(/-/g, ''))
    }
    expect(all).not.toMatch(/"p:|phoneKey|phoneHash/)

    // 최근 산 순 + 25줄 + 아래로 스크롤 → 맨 아래 손님 자세히 → 뒤로 가기
    await sort.getByRole('button', { name: '최근 산 순' }).click()
    await expect(customerRows(page)).toHaveCount(20)
    await region.getByRole('button', { name: /^더 보기/ }).click()
    await expect(customerRows(page)).toHaveCount(25)
    const last = customerRows(page).last()
    await last.scrollIntoViewIfNeeded()
    const y = await page.evaluate(() => window.scrollY)
    expect(y).toBeGreaterThan(300)
    await last.getByRole('link').click()
    await expect(page.getByRole('region', { name: '손님 자세히' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('region', { name: '모든 손님' })).toBeVisible()
    await expect(page.getByRole('group', { name: '정렬' }).getByRole('button', { name: '최근 산 순' })).toHaveAttribute('aria-pressed', 'true')
    await expect(customerRows(page)).toHaveCount(25)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y - 100)
  })
})

test('AC-CRM1-29 1280px: "모든 손님"·구매자 목록은 표, 꼬리표 글자, 정렬·거르기 단추는 aria-pressed이고 키보드로 바뀐다', async ({ page }) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await loginNewSeller(page)
  const t = String(Date.now())
  const d = kstDate(6)
  const s = await youtubeSale(page, { date: d, ch: `UC_big${t}`, nick: '큰손', prices: [60_000, 60_000], paid: true, firstNo: 10 })
  await youtubeSale(page, { date: d, b: s.b, ch: `UC_late${t}`, nick: '늦은손', prices: [3_000], paid: false, firstNo: 20 })
  await page.goto(`/buyers?date=${d}`)
  const table = page.getByRole('table', { name: '구매자' })
  await expect(table).toBeVisible()
  await expect(table.locator('tbody tr').filter({ hasText: '큰손' })).toContainText('단골')
  await expect(table.locator('tbody tr').filter({ hasText: '늦은손' })).toContainText('입금 늦음 주의')
  const cumulative = page.getByRole('group', { name: '정렬' }).getByRole('button', { name: '누적 큰 순' })
  await cumulative.focus()
  await page.keyboard.press('Enter')
  await expect(cumulative).toHaveAttribute('aria-pressed', 'true')
  const caution = page.getByRole('group', { name: '거르기' }).getByRole('button', { name: '입금 늦음 주의만' })
  await caution.focus()
  await page.keyboard.press('Space')
  await expect(caution).toHaveAttribute('aria-pressed', 'true')
  await expect(table.locator('tbody tr')).toHaveCount(1)

  const all = page.getByRole('group', { name: '보기' }).getByRole('button', { name: '모든 손님' })
  await all.focus()
  await page.keyboard.press('Enter')
  const list = page.getByRole('table', { name: '손님' })
  await expect(list).toBeVisible()
  await expect(list.getByRole('columnheader')).toHaveText(['이름', '종류', '표시', '누적 구매', '구매 횟수', '마지막 구매', '미입금'])
  await expect(list.locator('tbody tr').filter({ hasText: '큰손' })).toContainText('단골')
  // 입금 완료 구매가 없는 줄: 누적·횟수·마지막 구매 칸 자리에 한 줄 (D-CRM1-16 (5))
  const lateRow = list.locator('tbody tr').filter({ hasText: '늦은손' })
  await expect(lateRow).toContainText('아직 입금 완료된 구매 없음')
  await expect(lateRow).not.toContainText('0원')
  await expect(lateRow.locator('td')).toHaveCount(5)
  const recent = page.getByRole('region', { name: '모든 손님' }).getByRole('group', { name: '정렬' }).getByRole('button', { name: '최근 산 순' })
  await recent.focus()
  await page.keyboard.press('Enter')
  await expect(recent).toHaveAttribute('aria-pressed', 'true')
  // 줄 링크도 키보드로 연다
  await list.getByRole('link', { name: '큰손' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: '손님 자세히' })).toBeVisible()
})

test('TE-CRM1-003 AC-CRM1-15: 지난해 날짜는 연도를 붙인다 — 구매자 자세히·모든 손님 줄·손님 자세히(주소로 바로 열거나 새로고침해도)', async ({ page }) => {
  test.setTimeout(150_000)
  await loginNewSeller(page)
  const old = '2025-12-29'
  const phone = `010-8${String(Date.now()).slice(-3)}-1229`
  const s = await smsSale(page, { date: old, phone, prices: [7_000], paid: true })
  const want = customerDateKo(old)
  expect(want).toBe('2025년 12월 29일(월)')

  await page.goto(`/buyers?date=${old}&buyer=${encodeURIComponent(s.buyer)}`)
  await expect(page.getByRole('region', { name: '손님 기록' })).toContainText(`마지막 구매 ${want}`)
  await page.goto('/buyers?view=customers')
  await expect(customerRows(page).first()).toContainText(want)
  await customerRows(page).first().getByRole('link').click()
  const detail = page.getByRole('region', { name: '손님 자세히' })
  await expect(detail.getByRole('region', { name: '손님 기록' })).toContainText(`마지막 구매 ${want}`)
  await expect(detail.getByRole('region', { name: '날짜별 기록' }).getByRole('link').first()).toContainText(want)
  // 주소로 바로 연 손님 자세히 (공유·새로고침) — 올해 기준은 서버 오늘이지 그 손님의 마지막 날짜가 아니다
  await page.reload()
  const again = page.getByRole('region', { name: '손님 자세히' })
  await expect(again.getByRole('region', { name: '손님 기록' })).toContainText(`마지막 구매 ${want}`)
  await expect(again.getByRole('region', { name: '날짜별 기록' }).getByRole('link').first()).toContainText(want)
})
