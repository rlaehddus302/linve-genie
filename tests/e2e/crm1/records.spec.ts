// CRM1 손님 기록 칸·메모 (test-e2e) — AC-CRM1-05·06·09·15·22·23. 기대값은 acceptance.md·D-CRM1-03·04·06·08 그대로.
import { test, expect } from '@playwright/test'
import { broadcast, chat, customerDateKo, customerRows, kstDate, loginNewSeller, payAll, registerApi, scopeView, settlementOf, smsSale, won, writeEvent, youtubeSale } from './support.ts'

const NO_PHONE = '전화번호 없는 문자 손님은 다른 날과 이어지지 않아 메모를 남길 수 없어요.'
const PHONE_BAD = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'
const TOO_LONG = '메모는 200자까지 적을 수 있어요.'
const CONTROL_BAD = '메모에 쓸 수 없는 글자가 있어요. 빼고 적어 주세요.'

test('AC-CRM1-06: 리허설 날짜 묶음은 세지 않고, 리허설 구매자 화면에 꼬리표·누적 큰 순·거르기·손님 기록 칸이 없고 조회도 부르지 않는다', async ({ page }) => {
  test.setTimeout(150_000)
  await loginNewSeller(page)
  const ch = `UC_A${String(Date.now())}`
  const dr = kstDate(9)
  const d = kstDate(8)
  // 리허설: 같은 채널이 찜·입금
  const rb = await broadcast(page, dr, true, '연습')
  await registerApi(page, rb, 15, '연습상품', 40_000)
  await chat(page, rb, ch, '다육이맘', '15')
  await expect.poll(async () => (await scopeView(page, dr, true)).buyers.find((x) => x.id === ch)?.subtotal ?? 0).toBe(40_000)
  await payAll(page, dr, ch, true)
  // 실제: 입금 완료 12,000
  const s = await youtubeSale(page, { date: d, ch, nick: '다육이맘', prices: [12_000], paid: true })

  await page.goto(`/buyers?date=${d}&buyer=${encodeURIComponent(s.buyer)}`)
  await expect(page.getByRole('region', { name: '손님 기록' })).toContainText(`누적 구매 ${won(12_000)} · 1번`)

  const asked: string[] = []
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname
    if (p.includes('/customer')) asked.push(p)
  })
  await page.goto(`/buyers?date=${dr}&rehearsal=true`)
  await expect(page.getByText('다육이맘').first()).toBeVisible()
  await expect(page.getByRole('group', { name: '정렬' }).getByRole('button', { name: '이름 순' })).toBeVisible()
  await expect(page.getByRole('button', { name: '누적 큰 순' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: '거르기' })).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText(/단골|입금 늦음 주의/)
  await page.goto(`/buyers?date=${dr}&rehearsal=true&buyer=${encodeURIComponent(ch)}`)
  await expect(page.getByRole('heading', { name: /다육이맘/ }).first()).toBeVisible()
  await expect(page.getByRole('region', { name: '손님 기록' })).toHaveCount(0)
  expect(asked).toEqual([])
  // 리허설 날짜를 고른 손님 기록 조회는 거절 (숫자 없음)
  for (const path of [`/api/days/${dr}/customers?rehearsal=true`, `/api/days/${dr}/customers`, `/api/days/${dr}/customer?buyer=${encodeURIComponent(ch)}&rehearsal=true`]) {
    const res = await page.request.get(path)
    expect(res.status(), path).toBe(404)
    expect(await res.text(), path).not.toMatch(/purchaseTotal|40000|40,000/)
  }
  // 모든 손님: 실제 쪽 1번·12,000원만
  await page.goto('/buyers?view=customers')
  await expect(customerRows(page)).toHaveCount(1)
  await expect(customerRows(page).first()).toContainText(won(12_000))
  await expect(customerRows(page).first()).toContainText('1번')
})

test('AC-CRM1-05: 전화번호 없는 문자 손님(메모 "김씨")은 그날 묶음만 1번, 모든 손님에 줄 없음, 메모 칸 대신 안내', async ({ page }) => {
  test.setTimeout(150_000)
  await loginNewSeller(page)
  await smsSale(page, { date: kstDate(16), memo: '김씨', prices: [9_000], paid: true })
  const s = await smsSale(page, { date: kstDate(9), memo: '김씨', prices: [11_000], paid: true })
  await page.goto(`/buyers?date=${s.date}&buyer=${encodeURIComponent(s.buyer)}`)
  const record = page.getByRole('region', { name: '손님 기록' })
  await expect(record).toContainText(`누적 구매 ${won(11_000)} · 1번`)
  await expect(record.getByText(NO_PHONE)).toBeVisible()
  await expect(record.getByRole('textbox')).toHaveCount(0)
  await page.goto('/buyers?view=customers')
  await expect(page.getByRole('region', { name: '모든 손님' }).getByRole('status').filter({ hasText: '손님 0명' })).toBeVisible()
  await expect(customerRows(page)).toHaveCount(0)
})

test('AC-CRM1-09: 미입금 1번 → 입금을 적으면 열어 둔 자세히에서 바로 빠지고(구매 1번·상품 합계만), 되돌리면(환불 기록) 다시 미입금 1번·구매 0번', async ({ page }) => {
  test.setTimeout(150_000)
  await loginNewSeller(page)
  const d = kstDate(6)
  const s = await youtubeSale(page, { date: d, ch: `UC_A${String(Date.now())}`, nick: '늦은손님', prices: [15_000], paid: false })
  const total = (await settlementOf(page, d, s.buyer)).total
  expect(total).toBeGreaterThan(15_000) // 배송비가 붙는다 (누적에는 들어가지 않는다)
  await page.goto(`/buyers?date=${d}&buyer=${encodeURIComponent(s.buyer)}`)
  const record = page.getByRole('region', { name: '손님 기록' })
  await expect(record).toContainText(`미입금 1번 · 마지막 ${customerDateKo(d)}`)
  await expect(record).toContainText('아직 입금 완료된 구매 없음')
  await expect(record).toContainText('입금 늦음 주의')

  // 손으로 적은 입금 (STL-07) — 다른 기기에서 적은 것과 같다
  expect((await writeEvent(page, { type: 'settlement.payment', buyer: s.buyer, date: d, amount: total }, { date: d, rehearsal: false })).status).toBeLessThan(300)
  await expect(record).toContainText('미입금 없음')
  await expect(record).toContainText(`누적 구매 ${won(15_000)} · 1번`)
  await expect(record).not.toContainText('입금 늦음 주의')

  // 되돌리기 (환불 기록으로 받은 돈 0)
  expect((await writeEvent(page, { type: 'settlement.refund', buyer: s.buyer, date: d, amount: total, reason: '잘못 적음' }, { date: d, rehearsal: false })).status).toBeLessThan(300)
  await expect(record).toContainText(`미입금 1번 · 마지막 ${customerDateKo(d)}`)
  await expect(record).toContainText('아직 입금 완료된 구매 없음')
})

test('AC-CRM1-22: 메모 검사 — 번호 거절, 201자는 보내지 않음, 200자(한글·이모지) 저장, 앞뒤 공백 뺌, 제어 글자 거절, 안내 문장', async ({ page }) => {
  test.setTimeout(150_000)
  await loginNewSeller(page)
  const s = await youtubeSale(page, { date: kstDate(7), ch: `UC_A${String(Date.now())}`, nick: '메모손님', prices: [5_000], paid: true })
  await page.goto(`/buyers?date=${s.date}&buyer=${encodeURIComponent(s.buyer)}`)
  const record = page.getByRole('region', { name: '손님 기록' })
  const box = record.getByLabel('메모 — 유튜브 · 메모손님')
  const save = record.getByRole('button', { name: '메모 저장 — 유튜브 · 메모손님' })
  await expect(record.getByText(/연락처·주소는 적지 마세요\./)).toBeVisible()
  const memoPuts: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/memo')) memoPuts.push(r.postData() ?? '')
  })

  await box.fill('010-1234-5678 연락')
  await save.click()
  await expect(record.getByText(PHONE_BAD)).toBeVisible()
  await expect(record.locator('.memo-text')).toHaveCount(0)

  const two = '가🌵'.repeat(100) // 코드 포인트 200
  await box.fill(`${two}나`)
  await expect(record.getByText(TOO_LONG)).toBeVisible()
  const sentBefore = memoPuts.length
  if (await save.isEnabled()) await save.click()
  expect(memoPuts.length).toBe(sentBefore)

  await box.fill(two)
  await save.click()
  await expect(record.getByRole('status').filter({ hasText: '메모를 저장했어요.' })).toBeVisible()
  await expect(record.locator('.memo-text')).toHaveText(two)

  await box.fill('  가  ')
  await save.click()
  await expect(record.locator('.memo-text')).toHaveText('가')
  await expect(box).toHaveValue('가')

  await box.fill('삐\u0007소리')
  await save.click()
  await expect(record.getByText(CONTROL_BAD)).toBeVisible()
  await expect(record.locator('.memo-text')).toHaveText('가')

  // 새로 열어도 마지막 저장 글
  await page.reload()
  await expect(page.getByRole('region', { name: '손님 기록' }).locator('.memo-text')).toHaveText('가')
})

test('AC-CRM1-23: 메모 <img src=x onerror=alert(1)>는 글자 그대로, 실행되지 않는다(구매자 자세히·모든 손님 자세히)', async ({ page }) => {
  test.setTimeout(150_000)
  await loginNewSeller(page)
  const s = await youtubeSale(page, { date: kstDate(7), ch: `UC_A${String(Date.now())}`, nick: '<b>굵게</b>', prices: [5_000], paid: true })
  let dialogs = 0
  page.on('dialog', (d) => {
    dialogs += 1
    void d.dismiss()
  })
  const evil = '<img src=x onerror=alert(1)>'
  await page.goto(`/buyers?date=${s.date}&buyer=${encodeURIComponent(s.buyer)}`)
  const record = page.getByRole('region', { name: '손님 기록' })
  await record.getByRole('textbox').first().fill(evil)
  await record.getByRole('button', { name: /^메모 저장 — / }).first().click()
  await expect(record.locator('.memo-text')).toHaveText(evil)
  await page.reload()
  await expect(page.getByRole('region', { name: '손님 기록' }).locator('.memo-text')).toHaveText(evil)
  expect(await page.locator('main img[src="x"]').count()).toBe(0)
  await page.goto('/buyers?view=customers')
  await expect(customerRows(page).first()).toContainText('<b>굵게</b>')
  await customerRows(page).first().getByRole('link').first().click()
  await expect(page.getByRole('region', { name: '손님 자세히' }).locator('.memo-text')).toHaveText(evil)
  expect(await page.locator('main img, main b').count()).toBe(0)
  expect(dialogs).toBe(0)
})
