// 포장 모드 (AC-I2-35~39·32·33·80, STL-08, D-I2-05~07) — test-e2e. 기대 문장은 acceptance.md 따옴표 그대로.
import { test, expect, type Page } from '@playwright/test'
import { downloadBytes, login, noHorizontalScroll, packingCommand, packingList, pay, pdfPages, phoneLike, pngSize, realDay, smsApi, uniqueDate, writeEvent } from './support.ts'

const A = '010-2000-0001'
const B = '010-2000-0002'

async function twoBuyers(page: Page) {
  const date = uniqueDate()
  const { b, buyers } = await realDay(page, {
    date,
    products: [
      { no: 15, name: '핑크프릴', price: 10000 },
      { no: 28, name: '라울', price: 8000 },
      { no: 7, name: '', price: 5000 },
      { no: 31, name: '블루엘프', price: 3000 },
    ],
    claims: [{ no: 15, phone: A }, { no: 28, phone: A }, { no: 7, phone: B }],
  })
  const a = buyers.get(A)!
  const bb = buyers.get(B)!
  await pay(page, date, a, 22000)
  return { date, b, a, bb }
}

function checklist(page: Page) {
  return page.getByRole('region', { name: '체크리스트' })
}

test.describe('포장 모드 (AC-I2-35·36·38) — 휴대폰 375×812', () => {
  test('목록 → 체크 → 포장 완료 → 다음 구매자, 새로고침해도 같은 화면, 가로 스크롤 없음', async ({ page, browser }) => {
    await login(page)
    const { date, a, bb } = await twoBuyers(page)
    const phone = await phoneLike(browser, page)
    await phone.goto(`/packing?date=${date}`)
    const list = phone.getByRole('region', { name: '포장 목록' })
    await expect(list.getByRole('group', { name: '걸러 보기' }).getByRole('button', { name: '포장할 것' })).toHaveAttribute('aria-pressed', 'true')
    const rows = list.getByRole('list', { name: '포장할 구매자' }).getByRole('link')
    await expect(rows).toHaveCount(2)
    const rowA = rows.filter({ hasText: '4자리 0001' })
    const rowB = rows.filter({ hasText: '4자리 0002' })
    await expect(rowA).toContainText('상품 2개')
    await expect(rowA).toContainText('포장 대기')
    await expect(rowA).not.toContainText('미입금')
    await expect(rowB).toContainText('상품 1개')
    await expect(rowB).toContainText('미입금')
    await noHorizontalScroll(phone)
    // 누르는 곳 44px 이상, 글자 16px 이상 (UX-04)
    for (const target of [rowA, list.getByRole('button', { name: '포장할 것' }), list.getByRole('button', { name: '전체' })]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect(await target.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    }

    await rowA.click()
    await expect(phone).toHaveURL(new RegExp(`/packing\\?date=${date}&buyer=${encodeURIComponent(a)}`))
    const cl = checklist(phone)
    await expect(cl).toContainText('상품 2개')
    const c15 = cl.getByRole('checkbox', { name: '15번 핑크프릴' })
    const c28 = cl.getByRole('checkbox', { name: '28번 라울' })
    await expect(cl.getByText('0/2 담음')).toBeVisible()
    const packBtn = cl.getByRole('button', { name: '포장 완료', exact: true })
    await expect(packBtn).toBeDisabled()
    await expect(cl.getByText('모두 담으면 포장 완료를 누를 수 있어요.')).toBeVisible()
    // 상품 줄 전체가 44px 이상 체크 버튼
    const box = await c15.locator('xpath=ancestor::label[1]').boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    // 번호는 32px 이상 굵게 (AC-I2-36)
    const noStyle = await c15.locator('xpath=ancestor::label[1]').getByText('15번', { exact: true }).evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), weight: Number(getComputedStyle(el).fontWeight) }))
    expect(noStyle.size).toBeGreaterThanOrEqual(32)
    expect(noStyle.weight).toBeGreaterThanOrEqual(700)
    await c15.click()
    await expect(c15).toBeChecked()
    await c15.click()
    await expect(c15).not.toBeChecked()
    await c15.click()
    await c28.click()
    await expect(cl.getByText('2/2 담음')).toBeVisible()
    await noHorizontalScroll(phone)
    await expect(packBtn).toBeEnabled()
    await packBtn.click()
    await expect(cl.getByText('포장 완료로 적었어요.')).toBeVisible()
    expect((await packingList(page, date)).find((e) => e.buyer === a)?.status).toBe('포장 완료')
    await cl.getByRole('button', { name: '다음 구매자' }).click()
    await expect(phone).toHaveURL(new RegExp(`buyer=${encodeURIComponent(bb)}`))
    await expect(checklist(phone).getByRole('checkbox', { name: '7번 품종 미입력' })).toBeVisible()
    // 새로고침해도 같은 구매자, 체크는 처음부터
    await checklist(phone).getByRole('checkbox', { name: '7번 품종 미입력' }).click()
    await phone.reload()
    await expect(checklist(phone).getByRole('checkbox', { name: '7번 품종 미입력' })).not.toBeChecked()
    // 브라우저 저장소에 포장 체크·그림을 두지 않는다 (AC-I2-81)
    const stored = await phone.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
    expect(stored).not.toContain('7')
    await phone.context().close()
  })
})

test.describe('배송 완료·취소 (AC-I2-38)', () => {
  test('송장 전화번호 모양 → 칸 옆 서버 문장, 1234-5678-9012 → 숫자만, 고치기, 취소 확인 창은 닫기가 처음 포커스', async ({ page }) => {
    await login(page)
    const { date, a } = await twoBuyers(page)
    const all = (await packingList(page, date)).find((e) => e.buyer === a)!
    expect((await packingCommand(page, date, { buyer: a, action: 'pack', items: all.items.map((i) => i.key) })).status).toBe(200)
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(a)}`)
    const cl = checklist(page)
    await cl.getByRole('button', { name: '배송 완료로 적기' }).click()
    const dlg = page.getByRole('dialog', { name: '배송 완료로 적기' })
    const field = dlg.getByLabel('송장번호')
    await expect(field).toHaveAttribute('inputmode', 'numeric')
    await field.fill('010-1234-5678')
    await dlg.getByRole('button', { name: '배송 완료로 적기' }).click()
    await expect(dlg.getByText('전화번호처럼 보여요. 송장번호를 확인해 주세요.')).toBeVisible()
    await field.fill('1234')
    await dlg.getByRole('button', { name: '배송 완료로 적기' }).click()
    await expect(dlg.getByText('송장번호는 숫자 8~20자리로 적어 주세요.')).toBeVisible()
    await field.fill('1234-5678-9012')
    await dlg.getByRole('button', { name: '배송 완료로 적기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(cl.getByText('배송 완료로 적었어요.')).toBeVisible()
    await expect(cl).toContainText('배송 완료 · 송장 123456789012')
    // 송장번호 고치기
    await cl.getByRole('button', { name: '송장번호 고치기' }).click()
    const fix = page.getByRole('dialog', { name: '송장번호 고치기' })
    await fix.getByLabel('송장번호').fill('987654321098')
    await fix.getByRole('button', { name: '배송 완료로 적기' }).click()
    await expect(fix).toHaveCount(0)
    await expect(cl).toContainText('배송 완료 · 송장 987654321098')
    // 배송 완료 취소 — 닫기가 처음 포커스
    await cl.getByRole('button', { name: '배송 완료 취소' }).click()
    const unship = page.getByRole('dialog', { name: '배송 완료 취소' })
    await expect(unship.getByText('배송 완료를 취소할까요? 포장 완료로 돌아가요.')).toBeVisible()
    await expect(unship.getByRole('button', { name: '닫기' })).toBeFocused()
    await unship.getByRole('button', { name: '배송 완료 취소하기' }).click()
    await expect(cl.getByText('배송 완료를 취소했어요.')).toBeVisible()
    await expect(cl.getByRole('button', { name: '배송 완료로 적기' })).toBeVisible()
    await cl.getByRole('button', { name: '포장 완료 취소' }).click()
    const unpack = page.getByRole('dialog', { name: '포장 완료 취소' })
    await expect(unpack.getByText('포장 완료를 취소할까요? 포장 대기로 돌아가요.')).toBeVisible()
    await expect(unpack.getByRole('button', { name: '닫기' })).toBeFocused()
    await unpack.getByRole('button', { name: '포장 완료 취소하기' }).click()
    await expect(cl.getByText('포장 완료를 취소했어요.')).toBeVisible()
    expect((await packingList(page, date)).find((e) => e.buyer === a)?.status).toBe('포장 대기')
  })

  test('입금 완료가 아니면 "아직 입금 완료가 아니에요(미입금)…"를 묻고 닫기가 처음 포커스', async ({ page }) => {
    await login(page)
    const { date, bb } = await twoBuyers(page)
    const entry = (await packingList(page, date)).find((e) => e.buyer === bb)!
    expect((await packingCommand(page, date, { buyer: bb, action: 'pack', items: entry.items.map((i) => i.key) })).status).toBe(200)
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(bb)}`)
    await checklist(page).getByRole('button', { name: '배송 완료로 적기' }).click()
    await page.getByRole('dialog', { name: '배송 완료로 적기' }).getByRole('button', { name: '배송 완료로 적기' }).click()
    const ask = page.getByRole('dialog', { name: '입금 확인' })
    await expect(ask.getByText('아직 입금 완료가 아니에요(미입금). 그래도 배송 완료로 적을까요?')).toBeVisible()
    await expect(ask.getByRole('button', { name: '닫기' })).toBeFocused()
    await ask.getByRole('button', { name: '배송 완료로 적기' }).click()
    await expect(checklist(page).getByText('배송 완료로 적었어요.')).toBeVisible()
    expect((await packingList(page, date)).find((e) => e.buyer === bb)?.status).toBe('배송 완료')
  })
})

test.describe('두 화면 실시간·바뀐 품목 (AC-I2-32·37)', () => {
  test('체크리스트를 연 동안 새 1등·취소 → 안내, 남은 체크 유지, 다른 기기의 포장 완료가 1초 안에 목록에', async ({ page, browser }) => {
    await login(page)
    const { date, b, a, bb } = await twoBuyers(page)
    const phone = await phoneLike(browser, page)
    await phone.goto(`/packing?date=${date}&buyer=${encodeURIComponent(a)}`)
    const cl = checklist(phone)
    await cl.getByRole('checkbox', { name: '15번 핑크프릴' }).click()
    // 다른 기기(PC API)에서 31번을 A가 문자찜 → 새로 담을 것 31번
    await smsApi(page, { b, no: 31, phone: A })
    await expect(cl.getByText('구매 내역이 바뀌었어요 — 새로 담을 것: 31번')).toBeVisible()
    await expect(cl.getByRole('checkbox', { name: '31번 블루엘프' })).not.toBeChecked()
    await expect(cl.getByRole('checkbox', { name: '15번 핑크프릴' })).toBeChecked()
    // 28번 A 찜 취소 → 뺄 것 28번
    const claims = (await (await page.request.get(`/api/days/${date}`)).json() as { claims: { no: number; buyer: string; status: string }[] }).claims
    expect(claims.some((c) => c.no === 28)).toBe(true)
    const res = await writeEvent(page, { type: 'host.cancel', b, no: 28, buyer: a, reason: '취소 요청' })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    await expect(cl.getByText('구매 내역이 바뀌었어요 — 새로 담을 것: 31번 · 뺄 것: 28번')).toBeVisible()
    await expect(cl.getByRole('checkbox', { name: '28번 라울' })).toHaveCount(0)
    await expect(cl.getByRole('checkbox', { name: '15번 핑크프릴' })).toBeChecked()
    await expect(cl.getByRole('button', { name: '포장 완료', exact: true })).toBeDisabled()
    // 다른 묶음의 포장 완료(PC) → 휴대폰 목록 화면에 1초 안
    await phone.getByRole('button', { name: '포장 목록으로' }).click()
    const rowB = phone.getByRole('list', { name: '포장할 구매자' }).getByRole('link').filter({ hasText: '4자리 0002' })
    await expect(rowB).toBeVisible()
    const entryB = (await packingList(page, date)).find((e) => e.buyer === bb)!
    expect((await packingCommand(page, date, { buyer: bb, action: 'pack', items: entryB.items.map((i) => i.key) })).status).toBe(200)
    await expect(rowB).toHaveCount(0, { timeout: 1500 })
    await phone.getByRole('group', { name: '걸러 보기' }).getByRole('button', { name: '포장 완료' }).click()
    await expect(phone.getByRole('list', { name: '포장할 구매자' }).getByRole('link').filter({ hasText: '4자리 0002' })).toContainText('포장 완료')
    await phone.context().close()
  })

  test('포장 완료한 뒤 품목이 바뀌면 목록 맨 앞 "포장 다시 확인"(주의), 열면 같은 안내·빈 체크, 다시 모두 체크해 포장 완료', async ({ page }) => {
    await login(page)
    const { date, b, a, bb } = await twoBuyers(page)
    const entry = (await packingList(page, date)).find((e) => e.buyer === bb)!
    expect((await packingCommand(page, date, { buyer: bb, action: 'pack', items: entry.items.map((i) => i.key) })).status).toBe(200)
    await smsApi(page, { b, no: 31, phone: B })
    await page.goto(`/packing?date=${date}`)
    const rows = page.getByRole('list', { name: '포장할 구매자' }).getByRole('link')
    await expect(rows.first()).toContainText('포장 다시 확인')
    await expect(rows.first().locator('[data-tone]').filter({ hasText: '포장 다시 확인' })).toHaveAttribute('data-tone', 'warning')
    await rows.first().click()
    const cl = checklist(page)
    await expect(cl.getByText('구매 내역이 바뀌었어요 — 새로 담을 것: 31번')).toBeVisible()
    await expect(cl.getByRole('checkbox', { name: '7번 품종 미입력' })).not.toBeChecked()
    await cl.getByRole('checkbox', { name: '7번 품종 미입력' }).click()
    await cl.getByRole('checkbox', { name: '31번 블루엘프' }).click()
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.getByText('포장 완료로 적었어요.')).toBeVisible()
    expect((await packingList(page, date)).find((e) => e.buyer === bb)?.status).toBe('포장 완료')
    void a
  })
})

test.describe('포장 라벨 (AC-I2-39)', () => {
  test('쪽마다 그림·그림 저장(384×240 PNG)·라벨 PDF, 품목 12개 → 2쪽, B1 버튼 없음', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const nos = Array.from({ length: 12 }, (_, i) => i + 1)
    const { buyers } = await realDay(page, { date, products: nos.map((no) => ({ no, name: `품종${String(no)}`, price: 1000 })), claims: nos.map((no) => ({ no, phone: '010-3000-0001' })) })
    const a = buyers.get('010-3000-0001')!
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(a)}`)
    const label = page.getByRole('region', { name: '포장 라벨' })
    await expect(label.getByRole('img', { name: '포장 라벨 1/2쪽' })).toBeVisible()
    await expect(label.getByRole('img', { name: '포장 라벨 2/2쪽' })).toBeVisible()
    const [png] = await Promise.all([page.waitForEvent('download'), label.getByRole('button', { name: '그림 저장' }).first().click()])
    expect(png.suggestedFilename()).toMatch(new RegExp(`^포장라벨-${date}-.+-1of2\\.png$`))
    expect(pngSize(await downloadBytes(png))).toEqual({ width: 384, height: 240 })
    const [pdf] = await Promise.all([page.waitForEvent('download'), label.getByRole('button', { name: '라벨 PDF' }).click()])
    expect(pdf.suggestedFilename()).toMatch(new RegExp(`^포장라벨-${date}-.+\\.pdf$`))
    expect(await pdfPages(await downloadBytes(pdf))).toBe(2)
    await expect(page.getByRole('button', { name: /B1|프린터/ })).toHaveCount(0)
  })
})

test.describe('포장 라벨이 지금 묶음과 같다 (AC-I2-39·34)', () => {
  test('TE-I2-001: 연 동안 가격이 바뀌면(입금 전 찜까지, 상품 합계가 바뀜) 라벨을 새로 받고, "그림 저장"은 지금 라벨 그림이다', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const { b, buyers } = await realDay(page, { date, products: [{ no: 15, name: '핑크프릴', price: 10000 }], claims: [{ no: 15, phone: '010-3100-0001' }] })
    const a = buyers.get('010-3100-0001')!
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(a)}`)
    const label = page.getByRole('region', { name: '포장 라벨' })
    await expect(label.getByRole('img', { name: '포장 라벨 1/1쪽' })).toBeVisible()
    await expect(label.getByRole('button', { name: '그림 저장' })).toBeEnabled()
    const before = await (await page.request.get(`/api/days/${date}/packing-label?buyer=${encodeURIComponent(a)}`)).json() as { data: { subtotal: number } }
    expect(before.data.subtotal).toBe(10000)
    // 다른 기기에서 15번 가격을 입금 전 찜까지 12,000원으로 → 상품 합계 12,000원
    const res = await writeEvent(page, { type: 'product.update', b, no: 15, price: 12000, applyTo: 'UNPAID_CLAIMS' })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    const after = await (await page.request.get(`/api/days/${date}/packing-label?buyer=${encodeURIComponent(a)}`)).json() as { data: { subtotal: number } }
    expect(after.data.subtotal).toBe(12000)
    const current = await (await page.request.get(`/api/days/${date}/packing-label.png?buyer=${encodeURIComponent(a)}&page=1`)).body()
    // 라벨 그림은 결정적이다 (같은 상태 → 같은 바이트)
    expect((await (await page.request.get(`/api/days/${date}/packing-label.png?buyer=${encodeURIComponent(a)}&page=1`)).body()).equals(current)).toBe(true)
    // 화면의 라벨 그림이 지금 라벨(상품 합계 12,000원)로 바뀌어야 한다
    await expect.poll(async () => {
      const shown = await label.getByRole('img', { name: '포장 라벨 1/1쪽' }).evaluate(async (img: HTMLImageElement) => [...new Uint8Array(await (await fetch(img.src)).arrayBuffer())])
      return Buffer.from(shown).equals(current)
    }, { timeout: 5000 }).toBe(true)
    const [png] = await Promise.all([page.waitForEvent('download'), label.getByRole('button', { name: '그림 저장' }).click()])
    expect((await downloadBytes(png)).equals(current)).toBe(true)
  })
})

test.describe('배송 뒤 바뀜·체크 유지 (AC-I2-36·37)', () => {
  test('다른 묶음의 포장 완료로 다시 그려도 체크 유지, 배송 뒤 품목이 빠지면 "배송한 뒤 구매 내역이 바뀌었어요 — 뺄 것: 28번. 따로 보내거나 환불해 주세요."와 "배송 완료 취소"', async ({ page, browser }) => {
    await login(page)
    const { date, b, a, bb } = await twoBuyers(page)
    const phone = await phoneLike(browser, page)
    await phone.goto(`/packing?date=${date}&buyer=${encodeURIComponent(a)}`)
    const cl = checklist(phone)
    await cl.getByRole('checkbox', { name: '15번 핑크프릴' }).click()
    const entryB = (await packingList(page, date)).find((e) => e.buyer === bb)!
    const listLoaded = phone.waitForResponse((r) => new URL(r.url()).pathname === `/api/days/${date}/packing` && r.request().method() === 'GET')
    expect((await packingCommand(page, date, { buyer: bb, action: 'pack', items: entryB.items.map((i) => i.key) })).status).toBe(200)
    await listLoaded
    await expect(cl.getByRole('checkbox', { name: '15번 핑크프릴' })).toBeChecked()
    await expect(cl.getByText('1/2 담음')).toBeVisible()
    // A: 포장 완료 → 배송 완료 → 28번 취소 = 배송 뒤 바뀜
    await cl.getByRole('checkbox', { name: '28번 라울' }).click()
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.getByText('포장 완료로 적었어요.')).toBeVisible()
    expect((await packingCommand(page, date, { buyer: a, action: 'ship', invoice: null })).status).toBe(200)
    await expect(cl).toContainText('배송 완료')
    const res = await writeEvent(page, { type: 'host.cancel', b, no: 28, buyer: a, reason: '취소 요청' })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    await expect(cl.getByText('배송한 뒤 구매 내역이 바뀌었어요 — 뺄 것: 28번. 따로 보내거나 환불해 주세요.')).toBeVisible()
    await expect(cl.locator('[data-tone]').filter({ hasText: '배송 뒤 바뀜' }).first()).toHaveAttribute('data-tone', 'warning')
    await expect(cl.getByRole('button', { name: '배송 완료 취소' })).toBeVisible()
    await expect(cl.getByRole('button', { name: '포장 완료', exact: true })).toHaveCount(0)
    await phone.getByRole('button', { name: '포장 목록으로' }).click()
    await phone.getByRole('group', { name: '걸러 보기' }).getByRole('button', { name: '배송 완료' }).click()
    await expect(phone.getByRole('list', { name: '포장할 구매자' }).getByRole('link').first()).toContainText('배송 뒤 바뀜')
    await phone.context().close()
  })
})
