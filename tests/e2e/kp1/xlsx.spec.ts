// KP1 손님 엑셀 (test-e2e) — AC-KP1-13(연락처 열은 고를 때만). 열 이름은 CUSTOMER_RULES CR-6 그대로.
import { test, expect } from '@playwright/test'
import { ADDRESS, PHONE, VIEWPORTS, XLSX_CONTACT, XLSX_WARNING, buyerBrowser, downloadBytes, kstDate, loginNewSeller, makeLink, parcelSettings, sendAddress, xlsxRows, youtubeSale } from './support.ts'

const CONTACT_COLUMNS = ['받는 분', '연락처', '주소', '상세 주소', '우편번호']

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`손님 엑셀 ${name}`, () => {
    test.use({ viewport })

    test(`AC-KP1-13 ${name}: [엑셀로 받기] 창의 "${XLSX_CONTACT}"는 처음 빈칸 — 그대로 받으면 기본 9열, 고르면 경고 한 줄과 연락처 열(장부 줄 손님만 값), 다시 열면 다시 빈칸`, async ({ page, browser }) => {
      test.setTimeout(180_000)
      await loginNewSeller(page)
      await parcelSettings(page)
      const t = String(Date.now())
      const kept = await youtubeSale(page, { date: kstDate(4), ch: `UC_K${t}`, nick: '장부손님', prices: [30_000], paid: true, firstNo: 15 })
      await youtubeSale(page, { date: kstDate(4), b: kept.b, ch: `UC_P${t}`, nick: '그냥손님', prices: [10_000], paid: true, firstNo: 16 })
      const url = await makeLink(page, kstDate(4), kept.buyer)
      const b = await buyerBrowser(browser, page, PHONE)
      try {
        await b.page.goto(url)
        await sendAddress(b.page, true)
      } finally {
        await b.context.close()
      }

      await page.goto('/buyers?view=customers')
      const region = page.getByRole('region', { name: '모든 손님' })
      await region.getByRole('button', { name: '엑셀로 받기' }).click()
      let dialog = page.getByRole('dialog', { name: '손님 엑셀로 받기' })
      const box = dialog.getByRole('checkbox', { name: XLSX_CONTACT })
      await expect(box).not.toBeChecked()
      await expect(dialog.getByText(XLSX_WARNING)).toHaveCount(0)
      // 기본 열만
      const [plain] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '받기', exact: true }).click()])
      expect(plain.suggestedFilename()).toBe(`손님-${kstDate(0)}.xlsx`)
      const plainRows = await xlsxRows(await downloadBytes(plain))
      expect(plainRows[0]).toHaveLength(9)
      for (const col of CONTACT_COLUMNS) expect(plainRows[0]).not.toContain(col)
      expect(JSON.stringify(plainRows)).not.toContain('세종대로')
      // 누적 큰 순: 장부손님(30,000) → 그냥손님
      expect(plainRows.slice(1).map((r) => r[0])).toEqual(['장부손님', '그냥손님'])

      // 고르면 경고 한 줄 + 연락처 열
      await box.check()
      await expect(dialog.getByText(XLSX_WARNING)).toBeVisible()
      const [full] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '받기', exact: true }).click()])
      const rows = await xlsxRows(await downloadBytes(full))
      const head = rows[0]!
      expect(head).toHaveLength(15)
      for (const col of CONTACT_COLUMNS) expect(head).toContain(col)
      expect(head.some((c) => c.includes('보관 끝나는 날'))).toBe(true)
      const at = (col: string) => head.indexOf(col)
      const keptRow = rows.find((r) => r[0] === '장부손님')!
      const plainRow = rows.find((r) => r[0] === '그냥손님')!
      expect(keptRow[at('받는 분')]).toBe(ADDRESS.name)
      expect(keptRow[at('연락처')]).toBe('01012345678')
      expect(keptRow[at('주소')]).toBe(ADDRESS.address)
      expect(keptRow[at('상세 주소')]).toBe(ADDRESS.detail)
      expect(keptRow[at('우편번호')]).toBe(ADDRESS.zip)
      for (const col of CONTACT_COLUMNS) expect(plainRow[at(col)] ?? '').toBe('')

      // 닫고 다시 열면 다시 빈칸 (기억하지 않음)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await region.getByRole('button', { name: '엑셀로 받기' }).click()
      dialog = page.getByRole('dialog', { name: '손님 엑셀로 받기' })
      await expect(dialog.getByRole('checkbox', { name: XLSX_CONTACT })).not.toBeChecked()
    })
  })
}
