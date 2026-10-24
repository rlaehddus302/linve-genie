// FB1 택배 화면 (AC-FB1-20, AC-FB1-90 택배 줄): 줄마다 택배 크기 다섯 낱말(값 = 새 코드), 어댑터 없는 택배사의 막힘 문장·설정 링크·접수 잠금,
// 접수 요청은 택배사에 아무것도 보내지 않는다. 가짜 택배사(FAKE)는 받은 크기를 새 코드로 받는다(AC-FB1-16).
import { expect, test } from '@playwright/test'
import {
  SENDER,
  bookApi,
  bookButton,
  fakeRequests,
  makeReady,
  openParcels,
  parcelDayWith,
  parcelSeller,
  readyGroup,
  taggedAddress,
  bookRequestsTagged,
} from '../t1/support.ts'
import { BOX_WORDS, DEV_WORDS, NO_AUTO_BOOK } from './support.ts'

test.describe('AC-FB1-20 택배 화면', () => {
  for (const [word, carrier] of [['씨제이', { carrier: 'CJ' }], ['우체국', { carrier: 'EPOST' }], ['직접', { carrier: 'OTHER', carrierName: '경동택배' }]] as const) {
    test(`어댑터가 없는 택배사(${String(carrier.carrier)}) — 목록 위 문장·"설정으로"·접수 잠금, 접수 API 409이고 택배사로 나간 요청 0`, async ({ page }) => {
      await parcelSeller(page, { ...carrier, sender: SENDER, box: '100' })
      const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: `막힘${word}` }] })
      const tag = `fb1-${String(carrier.carrier)}-${String(Date.now())}`
      await makeReady(page, date, buyers[0]!, taggedAddress(tag))
      await openParcels(page, date)
      await expect(page.getByRole('note').filter({ hasText: NO_AUTO_BOOK })).toBeVisible()
      await expect(page.getByText('택배사를 먼저 이어 주세요.')).toHaveCount(0)
      await expect(bookButton(page)).toBeDisabled()
      await expect(page.getByRole('link', { name: '설정으로' })).toBeVisible()
      const size = readyGroup(page).getByRole('combobox', { name: '택배 크기' })
      await expect(size).toHaveValue('100')
      await expect(size.first().getByRole('option')).toHaveText(BOX_WORDS)
      expect(await page.locator('main').innerText()).not.toMatch(DEV_WORDS)
      const res = await bookApi(page, date, buyers)
      expect(res.status).toBe(409)
      expect(bookRequestsTagged((await fakeRequests(page)).requests, tag)).toEqual([])
      await page.getByRole('link', { name: '설정으로' }).click()
      await expect(page).toHaveURL(/\/settings\/parcel$/)
    })
  }

  test('가짜 택배: 줄의 택배 크기를 160으로 바꿔 접수 → 택배사가 받은 크기는 새 코드', async ({ page }) => {
    await parcelSeller(page, { carrier: 'FAKE', sender: SENDER, box: '소' })
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '크기' }] })
    const tag = `fb1-box-${String(Date.now())}`
    await makeReady(page, date, buyers[0]!, taggedAddress(tag))
    await openParcels(page, date)
    const size = readyGroup(page).getByRole('combobox', { name: '택배 크기' })
    // 옛 낱말 "소"로 넣은 설정은 80으로 옮겨진다
    await expect(size).toHaveValue('80')
    await size.selectOption({ label: '160cm 이하' })
    await bookButton(page).click()
    await page.getByRole('dialog', { name: '택배 접수' }).getByRole('button', { name: '접수하기' }).click()
    await expect.poll(async () => bookRequestsTagged((await fakeRequests(page)).requests, tag).length, { timeout: 20_000 }).toBe(1)
    const req = bookRequestsTagged((await fakeRequests(page)).requests, tag)[0]!
    expect(JSON.stringify(req.body)).toContain('"box":"160"')
    expect(JSON.stringify(req.body)).not.toMatch(/"box":"(극소|소|중|대)"/)
  })
})
