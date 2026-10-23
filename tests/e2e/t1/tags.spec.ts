// T1 접수한 묶음의 꼬리표 (AC-T1-65 D-T1-15 새 기준, U-T1-03·06·11) — test-e2e.
// 기대: 포장 상태 "배송 완료" + BOOKED 접수 = 포장 꼬리표 없이 "택배: 접수됨 · 9000-0000-0001" 하나 (정산 줄·자세히, 포장 목록·체크리스트, 택배 화면 줄).
// 예외 셋: 손으로 적은 배송 완료(접수 없음) · 배송 뒤 바뀜(둘 다) · 접수 취소(포장 완료 다시). 바뀌지 않음: API 포장 상태·걸러 보기 "배송 완료".
import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  bookApi,
  bookButton,
  bookedGroup,
  fakeParcel,
  makeReady,
  openParcels,
  packAll,
  packingCommand,
  parcelDayWith,
  parcelSeller,
  payAll,
  readyGroup,
  rowOf,
  writeEvent,
} from './support.ts'

/** 포장 꼬리표 "배송 완료"·"배송 완료 · 송장 …" (버튼 "배송 완료로 적기"·걸러 보기 "배송 완료"는 아니다) */
const DONE = /^배송 완료( · 송장 .+)?$/
/** 접수한 묶음 쪽: "배송 완료" 글 자체가 없다 (그 줄·머리에는 버튼이 없다) */
const DONE_ANY = /배송 완료/

function settlementRow(page: Page, name: string): Locator {
  return page.getByRole('table', { name: '정산 묶음' }).getByRole('row').filter({ hasText: name })
}
function detailRegion(page: Page): Locator {
  return page.getByRole('region', { name: '정산 자세히' })
}
/** 정산 자세히의 머리(이름 아래 입금·포장·택배 꼬리표 줄) — 배송지 칸의 택배 줄과 나눈다 */
function detailHead(page: Page): Locator {
  return detailRegion(page).getByRole('heading', { level: 2 }).locator('xpath=following-sibling::p[1]')
}
function packingRow(page: Page, name: string): Locator {
  return page.getByRole('list', { name: '포장할 구매자' }).getByRole('link').filter({ hasText: name })
}
function checklistHead(page: Page): Locator {
  return page.getByRole('region', { name: '체크리스트' })
}

async function openPackingList(page: Page, date: string, filter: '전체' | '배송 완료' | '포장 완료'): Promise<void> {
  await page.goto(`/packing?date=${date}`)
  await page.getByRole('region', { name: '포장 목록' }).getByRole('group', { name: '걸러 보기' }).getByRole('button', { name: filter, exact: true }).click()
}

/** 판매자 화면 다섯 곳: 각 곳의 그 묶음 영역을 차례로 열어 check를 부른다 */
async function everyPlace(page: Page, date: string, buyer: string, name: string, check: (where: string, scope: Locator) => Promise<void>): Promise<void> {
  await page.goto(`/settlements?date=${date}`)
  await expect(settlementRow(page, name)).toHaveCount(1)
  await check('정산 줄', settlementRow(page, name))
  await page.goto(`/settlements?date=${date}&buyer=${encodeURIComponent(buyer)}`)
  await expect(detailRegion(page)).toBeVisible()
  await check('정산 자세히', detailHead(page))
  await openPackingList(page, date, '전체')
  await expect(packingRow(page, name)).toHaveCount(1)
  await check('포장 목록', packingRow(page, name))
  await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
  await expect(checklistHead(page)).toBeVisible()
  await check('체크리스트', checklistHead(page))
  await openParcels(page, date)
}

test.describe('AC-T1-65 접수한 묶음은 택배 꼬리표 하나만 (D-T1-15)', () => {
  test('정산 줄·자세히, 포장 목록·체크리스트, 택배 화면 줄에 "배송 완료"가 없고 "택배: 접수됨 · 9000-…" 하나 — 배송 중으로 넘어가도 "배송 완료"는 없다, 붙은 송장 모양은 어디에도 없다', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    const buyer = buyers[0]!
    await makeReady(page, date, buyer)
    // 화면에서 접수: 확인 창 안내 문장 (D-T1-15)
    await openParcels(page, date)
    await bookButton(page).click()
    const dlg = page.getByRole('dialog', { name: '택배 접수' })
    await expect(dlg).toContainText('접수하면 포장·정산 화면에 택배 상태와 송장번호가 보여요.')
    await expect(dlg).not.toContainText(DONE_ANY)
    await dlg.getByRole('button', { name: '접수하기' }).click()
    await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(1)
    const row = await rowOf(page, date, buyer)
    const invoiceText = row.parcel!.invoiceText!
    const invoice = row.parcel!.invoice!
    expect(invoiceText).toMatch(/^\d{4}-\d{4}-\d{4}$/)

    for (const status of ['접수됨', '배송 중'] as const) {
      if (status === '배송 중') {
        await fakeParcel(page, 'status', { invoice, status: 'IN_TRANSIT' })
        await fakeParcel(page, 'track')
        await expect.poll(async () => (await rowOf(page, date, buyer)).parcel?.status).toBe('배송 중')
      }
      const tag = `택배: ${status} · ${invoiceText}`
      await everyPlace(page, date, buyer, row.name, async (where, scope) => {
        await expect(scope.getByText(tag), `${where}: ${tag}`).toHaveCount(1)
        await expect(scope.getByText(DONE_ANY), `${where}: 포장 꼬리표 없음`).toHaveCount(0)
        expect(await scope.innerText(), `${where}: 송장 한 모양`).not.toContain(invoice)
      })
      // 택배 화면 "접수했어요" 줄
      const line = bookedGroup(page).getByRole('listitem').filter({ hasText: row.name })
      await expect(line.getByText(tag)).toHaveCount(1)
      await expect(line.getByText(DONE_ANY)).toHaveCount(0)
      expect((await line.innerText()).split(invoiceText).length - 1, '송장번호는 한 번만 (U-T1-11)').toBe(1)
      expect(await page.locator('main').innerText()).not.toContain(invoice)
    }

    // 바뀌지 않음: API 포장 상태 "배송 완료"(AC-T1-30), 걸러 보기 "배송 완료"에 든다
    const packing = (await (await page.request.get(`/api/days/${date}/packing`)).json()) as { entries: { buyer: string; status: string }[] }
    expect(packing.entries.find((e) => e.buyer === buyer)!.status).toBe('배송 완료')
    await openPackingList(page, date, '배송 완료')
    await expect(packingRow(page, row.name)).toHaveCount(1)
    await openPackingList(page, date, '포장 완료')
    await expect(packingRow(page, row.name)).toHaveCount(0)
  })

  test('예외 — 손으로 적은 배송 완료(접수 없음)는 "배송 완료 · 송장 …" 그대로, 택배 꼬리표 없음', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    const buyer = buyers[0]!
    await payAll(page, date, buyer)
    await packAll(page, date, buyer)
    expect((await packingCommand(page, date, { buyer, action: 'ship', invoice: '123456789012' })).status).toBe(200)
    const name = (await rowOf(page, date, buyer)).name
    await everyPlace(page, date, buyer, name, async (where, scope) => {
      await expect(scope.getByText('배송 완료 · 송장 123456789012'), where).toHaveCount(1)
      await expect(scope.getByText(/^택배:/), where).toHaveCount(0)
    })
  })

  test('예외 — 배송 뒤 바뀜인 접수 묶음은 포장 꼬리표(주의)와 택배 꼬리표가 둘 다', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await parcelSeller(page)
    const { date, b, buyers } = await parcelDayWith(page, { buyers: [{ phone: '010-3200-0001', count: 2 }] })
    const buyer = buyers[0]!
    await makeReady(page, date, buyer)
    expect((await bookApi(page, date, [buyer])).status).toBe(200)
    const row = await rowOf(page, date, buyer)
    expect(row.parcel?.state).toBe('BOOKED')
    // 접수 뒤 품목 하나가 빠진다 = 배송 뒤 바뀜
    const res = await writeEvent(page, { type: 'host.cancel', b, no: 2, buyer, reason: '취소 요청' })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    await expect.poll(async () => ((await (await page.request.get(`/api/days/${date}/packing`)).json()) as { entries: { buyer: string; status: string }[] }).entries.find((e) => e.buyer === buyer)?.status).toBe('배송 뒤 바뀜')
    expect((await rowOf(page, date, buyer)).parcel?.state).toBe('BOOKED')
    const tag = `택배: 접수됨 · ${row.parcel!.invoiceText!}`
    await everyPlace(page, date, buyer, row.name, async (where, scope) => {
      await expect(scope.getByText(/^배송 뒤 바뀜/).first(), where).toBeVisible()
      await expect(scope.getByText(tag), where).toHaveCount(1)
    })
    const line = bookedGroup(page).getByRole('listitem').filter({ hasText: row.name })
    await expect(line.getByText(/^배송 뒤 바뀜/).first()).toBeVisible()
    await expect(line.getByText(tag)).toHaveCount(1)
  })

  test('예외 — 접수를 취소하면 포장 꼬리표 "포장 완료"가 다시 보인다', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    const buyer = buyers[0]!
    await makeReady(page, date, buyer)
    expect((await bookApi(page, date, [buyer])).status).toBe(200)
    const name = (await rowOf(page, date, buyer)).name
    await openParcels(page, date)
    await bookedGroup(page).getByRole('group', { name: `${name} 택배` }).getByRole('button', { name: '접수 취소' }).click()
    await page.getByRole('dialog', { name: '접수 취소' }).getByRole('button', { name: '취소하기' }).click()
    await expect(readyGroup(page).getByRole('checkbox', { name })).toBeVisible()
    await everyPlace(page, date, buyer, name, async (where, scope) => {
      await expect(scope.getByText('포장 완료', { exact: true }).first(), where).toBeVisible()
      await expect(scope.getByText(DONE), where).toHaveCount(0)
    })
    await expect(readyGroup(page).getByRole('listitem').filter({ hasText: name }).getByText('포장 완료', { exact: true })).toBeVisible()
  })
})
