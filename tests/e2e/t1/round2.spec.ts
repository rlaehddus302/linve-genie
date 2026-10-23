// T1 수정 라운드 2 확인 — 기다림 안내(AC-T1-62 D-T1-18, U-T1-10), 집하 뒤 취소 버튼 없음(AC-T1-64, U-T1-05),
// 날짜 고르기 수와 화면 무리 수(AC-T1-61, U-T1-09) — test-e2e. 기대 문장은 acceptance.md 따옴표 그대로.
import { test, expect, type Page } from '@playwright/test'
import {
  ADDRESS,
  bookApi,
  bookButton,
  bookedGroup,
  excludedGroup,
  fakeParcel,
  loginAs,
  makeReady,
  openParcels,
  parcelDayWith,
  parcelSeller,
  readyGroup,
  rowOf,
  taggedAddress,
} from './support.ts'

const BOOKING_NOW = '택배사에 접수하는 중이에요… 택배사 답이 늦으면 조금 걸려요.'
const UNKNOWN_WAIT = "택배사 답이 없어 접수됐는지 아직 몰라요. 잠시 뒤 '다시 확인'을 눌러 주세요. 두 번 접수되지 않아요."
const PENDING_WAIT = "택배사 답을 기다리고 있어요. 다른 일을 하셔도 돼요. 2분이 지나도 그대로면 '다시 확인'을 누를 수 있어요."

test.describe('AC-T1-62 기다림 안내 (D-T1-18)', () => {
  test('보내는 동안 "택배사에 접수하는 중이에요…", 다른 기기의 기다림 줄엔 기다림 문장·"다시 확인" 없음 → 답이 끊기면 두 화면 모두 응답 없음 문장·바로 누를 수 있는 "다시 확인"·"실패한 것만 다시"', async ({ page, browser }) => {
    test.setTimeout(150_000)
    const seller = await parcelSeller(page)
    const tag = `기다림${String(Date.now())}`
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    const buyer = buyers[0]!
    await makeReady(page, date, buyer, taggedAddress(tag))
    const name = (await rowOf(page, date, buyer)).name
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
    const phone = await ctx.newPage()
    try {
      await loginAs(phone, seller)
      await openParcels(phone, date)
      await openParcels(page, date)
      await expect(readyGroup(page).getByRole('checkbox')).toHaveCount(1)
      // 택배사는 접수하고 답은 끊긴다 (서버 기다림 15초 동안 PENDING)
      await fakeParcel(page, 'fail', { op: 'book', kind: 'TIMEOUT_AFTER_BOOK', times: 1 })
      await bookButton(page).click()
      await page.getByRole('dialog', { name: '택배 접수' }).getByRole('button', { name: '접수하기' }).click()
      await expect(page.getByRole('status').filter({ hasText: BOOKING_NOW })).toBeVisible()
      await expect(bookButton(page)).toBeDisabled()

      // 다른 기기: 기다림 줄 (다시 확인 없음)
      await expect.poll(async () => (await rowOf(page, date, buyer)).parcel?.state).toBe('PENDING')
      await phone.reload()
      await expect(phone.getByRole('heading', { level: 1, name: '택배 접수' })).toBeVisible()
      const waitRow = excludedGroup(phone).getByRole('listitem').filter({ hasText: name })
      await expect(waitRow).toContainText(PENDING_WAIT)
      await expect(waitRow.getByRole('button', { name: '다시 확인' })).toHaveCount(0)
      await expect(excludedGroup(phone).getByRole('button', { name: '실패한 것만 다시' })).toHaveCount(0)

      // 요청이 끝나면(응답 없음): 보내는 중 문장 사라짐, 응답 없음 줄, 바로 누를 수 있는 버튼
      await expect(page.getByText(BOOKING_NOW)).toHaveCount(0, { timeout: 40_000 })
      const row = excludedGroup(page).getByRole('listitem').filter({ hasText: name })
      await expect(row).toContainText(UNKNOWN_WAIT)
      await expect(row.getByRole('button', { name: '다시 확인' })).toBeEnabled()
      await expect(excludedGroup(page).getByRole('button', { name: '실패한 것만 다시' })).toBeEnabled()
      expect(await page.locator('main').innerText()).not.toContain(PENDING_WAIT)
      // 다른 기기도 새로고침 없이 기다림 → 응답 없음 (실시간 또는 30초 다시 읽기)
      const phoneRow = excludedGroup(phone).getByRole('listitem').filter({ hasText: name })
      await expect(phoneRow).toContainText(UNKNOWN_WAIT, { timeout: 40_000 })
      await expect(phoneRow.getByRole('button', { name: '다시 확인' })).toBeEnabled()

      // 다시 확인 → 같은 요청 번호로 물어 접수함 (두 번 접수 없음)
      await row.getByRole('button', { name: '다시 확인' }).click()
      await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(1)
      await expect(bookedGroup(phone).getByRole('listitem')).toHaveCount(1)
      expect((await rowOf(page, date, buyer)).parcel?.state).toBe('BOOKED')
    } finally {
      await ctx.close()
    }
  })
})

test.describe('AC-T1-64 집하 뒤 (U-T1-05)', () => {
  test('조회로 집하를 안 뒤에는 "접수 취소" 버튼 대신 택배사에 문의하라는 안내 — 운송장 PDF는 그대로', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    await makeReady(page, date, buyers[0]!)
    expect((await bookApi(page, date, buyers)).status).toBe(200)
    const row = await rowOf(page, date, buyers[0]!)
    expect(row.parcel?.cancellable).toBe(true)
    await fakeParcel(page, 'status', { invoice: row.parcel!.invoice, status: 'PICKED_UP' })
    await fakeParcel(page, 'track')
    await expect.poll(async () => (await rowOf(page, date, buyers[0]!)).parcel?.cancellable).toBe(false)
    await openParcels(page, date)
    const group = bookedGroup(page).getByRole('group', { name: `${row.name} 택배` })
    await expect(group.getByRole('button', { name: '운송장 PDF' })).toBeVisible()
    await expect(group.getByRole('button', { name: '접수 취소' })).toHaveCount(0)
    const line = bookedGroup(page).getByRole('listitem').filter({ hasText: row.name })
    await expect(line).toContainText('택배사에 직접 문의해 주세요')
    await expect(bookedGroup(page).getByRole('button', { name: '접수 취소' })).toHaveCount(0)
  })
})

async function selectedDay(page: Page): Promise<string> {
  return await page.getByRole('combobox', { name: '날짜' }).getByRole('option', { selected: true }).innerText()
}

test.describe('AC-T1-61 날짜 고르기 수 (U-T1-09)', () => {
  test('택배사가 거절한 묶음이 있는 날짜: 날짜 칸의 "보낼 수 있어요 n · 접수 m"이 화면 무리 수와 같다 — 접수·취소 뒤에도', async ({ page }) => {
    test.setTimeout(120_000)
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }, { memo: '나래' }, { memo: '다솜' }] })
    const [a, b, c] = buyers as [string, string, string]
    await makeReady(page, date, a)
    await makeReady(page, date, b, { ...ADDRESS, address: `${ADDRESS.address} [주소거절]` })
    await makeReady(page, date, c)
    const failed = await bookApi(page, date, [b])
    expect(failed.status, JSON.stringify(failed.body)).toBe(200)
    expect((await rowOf(page, date, b)).parcel?.state).toBe('FAILED')
    expect((await bookApi(page, date, [c])).status).toBe(200)

    await openParcels(page, date)
    await expect(readyGroup(page).getByRole('checkbox')).toHaveCount(1)
    await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(1)
    await expect.poll(async () => await selectedDay(page)).toMatch(/· 보낼 수 있어요 1 · 접수 1$/)
    // 화면에서 a 접수 → 0 · 2
    await bookButton(page).click()
    await page.getByRole('dialog', { name: '택배 접수' }).getByRole('button', { name: '접수하기' }).click()
    await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(2)
    await expect.poll(async () => await selectedDay(page)).toMatch(/· 보낼 수 있어요 0 · 접수 2$/)
  })
})
