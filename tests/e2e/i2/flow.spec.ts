// 2단계 정산 마무리 리허설 — 끝까지 한 흐름 (acceptance K test-e2e, SPEC §8): 방송 → 상품 목록 가져오기 → 공개·문자찜(실제 범위) → 입금
// → 정산에서 확인서 공유·전원 PDF·판매대장 → 포장 모드 체크·포장 완료·라벨 저장·배송 완료(송장) → 판매대장 배송 칸 → 다음 날 같은 구매자의 지난 구매.
import { test, expect } from '@playwright/test'
import { dateLongKo, downloadBytes, login, openNewBroadcast, pay, pdfPages, phoneLike, pngSize, scopeView, smsApi, uniqueDate, writeEvent, xlsxRows } from './support.ts'

test('정산 마무리 한 흐름: 가져오기 → 판매 → 확인서·전원 PDF → 포장·라벨·배송 → 판매대장 배송 칸 → 다음 날 지난 구매', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await login(page)
  const d1 = uniqueDate()
  const d2 = uniqueDate()
  const PA = `010-9${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}-1234`
  const PB = `010-9${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}-5678`

  // 1. 방송 + 상품 목록 가져오기
  const b = await openNewBroadcast(page, { date: d1, rehearsal: false, title: '1부' })
  await page.getByRole('button', { name: '상품 목록 가져오기' }).click()
  const dlg = page.getByRole('dialog', { name: '상품 목록 가져오기' })
  await dlg.getByRole('textbox', { name: '붙여 넣기' }).fill('번호\t품종\t가격\n15\t핑크프릴\t10000\n28\t라울\t8000\n7\t블루엘프\t5000')
  await dlg.getByRole('button', { name: '미리 보기' }).click()
  await dlg.getByRole('button', { name: '3개 등록하기' }).click()
  await expect(dlg.getByText('3개를 공개 전 상품으로 등록했어요.')).toBeVisible()
  await dlg.getByRole('button', { name: '닫기' }).click()

  // 2. 공개·문자찜 (실제 범위)
  for (const no of [15, 28, 7]) expect((await writeEvent(page, { type: 'product.open', b, no })).status).toBeLessThan(300)
  await smsApi(page, { b, no: 15, phone: PA })
  await smsApi(page, { b, no: 28, phone: PA })
  await smsApi(page, { b, no: 7, phone: PB })
  const view = await scopeView(page, d1, false)
  const a = view.claims.find((c) => c.no === 15)!.currentBuyer
  expect(view.claims.find((c) => c.no === 28)!.currentBuyer).toBe(a)
  await pay(page, d1, a, 22000)

  // 3. 정산: 확인서 공유(휴대폰)·전원 PDF
  const phone = await phoneLike(browser, page)
  await phone.addInitScript(() => {
    const w = window as unknown as { __shared: number }
    w.__shared = 0
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { w.__shared += 1 } })
  })
  await phone.goto(`/settlements?date=${d1}&buyer=${encodeURIComponent(a)}`)
  await phone.getByRole('region', { name: '구매 내역 확인서' }).getByRole('button', { name: '이미지 공유' }).click()
  await expect.poll(async () => await phone.evaluate(() => (window as unknown as { __shared: number }).__shared)).toBe(1)
  await page.goto(`/settlements?date=${d1}`)
  const [all] = await Promise.all([page.waitForEvent('download'), page.getByRole('group', { name: '정산 문서' }).getByRole('button', { name: '전원 확인서 PDF (2명)' }).click()])
  expect(all.suggestedFilename()).toBe(`확인서-${d1}-전원.pdf`)
  expect(await pdfPages(await downloadBytes(all))).toBe(2)

  // 4. 포장 모드 (휴대폰): 체크 → 포장 완료 → 라벨 그림 저장 → 배송 완료(송장)
  await phone.goto(`/packing?date=${d1}`)
  await phone.getByRole('list', { name: '포장할 구매자' }).getByRole('link').filter({ hasText: '1234' }).click()
  const cl = phone.getByRole('region', { name: '체크리스트' })
  await cl.getByRole('checkbox', { name: '15번 핑크프릴' }).click()
  await cl.getByRole('checkbox', { name: '28번 라울' }).click()
  await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
  await expect(cl.getByText('포장 완료로 적었어요.')).toBeVisible()
  const [png] = await Promise.all([phone.waitForEvent('download'), cl.getByRole('region', { name: '포장 라벨' }).getByRole('button', { name: '그림 저장' }).click()])
  expect(pngSize(await downloadBytes(png))).toEqual({ width: 384, height: 240 })
  await cl.getByRole('button', { name: '배송 완료로 적기' }).click()
  const ship = phone.getByRole('dialog', { name: '배송 완료로 적기' })
  await ship.getByLabel('송장번호').fill('1234-5678-9012')
  await ship.getByRole('button', { name: '배송 완료로 적기' }).click()
  await expect(cl).toContainText('배송 완료 · 송장 123456789012')
  await phone.context().close()

  // 5. 판매대장 배송 칸
  await page.getByRole('group', { name: '정산 문서' }).getByRole('button', { name: '판매대장 엑셀' }).click()
  const led = page.getByRole('dialog', { name: '판매대장 엑셀' })
  const [xlsx] = await Promise.all([page.waitForEvent('download'), led.getByRole('button', { name: '엑셀 내려받기' }).click()])
  expect(xlsx.suggestedFilename()).toBe(`판매대장-${d1}.xlsx`)
  const rows = await xlsxRows(await downloadBytes(xlsx))
  expect(rows).toHaveLength(1 + 3)
  const shipCol = rows[0]!.indexOf('배송')
  expect(rows.slice(1).map((r) => r[shipCol]).sort()).toEqual(['배송 완료 · 송장 123456789012', '배송 완료 · 송장 123456789012', '포장 대기'].sort())

  // 6. 다음 날 같은 전화번호의 문자찜 → 구매자 자세히의 지난 구매
  const b2 = await openNewBroadcast(page, { date: d2, rehearsal: false, title: '1부' })
  expect((await writeEvent(page, { type: 'product.register', b: b2, no: 1, name: '새상품', price: 3000 })).status).toBeLessThan(300)
  await smsApi(page, { b: b2, no: 1, phone: PA })
  const a2 = (await scopeView(page, d2, false)).claims.find((c) => c.no === 1)!.currentBuyer
  await page.goto(`/buyers?date=${d2}&buyer=${encodeURIComponent(a2)}`)
  const past = page.getByRole('region', { name: '지난 구매' }).getByRole('link')
  await expect(past).toHaveCount(1)
  await expect(past).toContainText(dateLongKo(d1))
  await expect(past).toContainText('배송 완료 · 송장 123456789012')
  await expect(past).toContainText('최종 22,000원')
})
