// O2 문자찜·직접 배정·찜 조치·취소 요청 (AC-O2-40~44) — test-e2e. 기대값은 acceptance.md·D-O2-08·09·G-ENG-O2-02.
import { expect, test, type Page } from '@playwright/test'
import {
  SIZES,
  SMS_TO_REVIEW,
  boardItem,
  buyerName,
  chat,
  createBroadcast,
  history,
  login,
  noHorizontalScroll,
  openOptionBroadcast,
  openSms,
  oscope,
  productOf,
  registerOptions,
  reviewsApi,
  smsField,
  waitClaims,
} from './support.ts'

test.beforeEach(async ({ page }) => {
  await login(page)
})

function uniqueTitle(prefix: string): string {
  return `${prefix} ${crypto.randomUUID().slice(0, 8)}`
}

function smsForm(page: Page) {
  return page.getByRole('region', { name: '문자찜 넣기' })
}

test('AC-O2-40: 문자찜 옵션·수량 (375px) — 고르기 전엔 막힘, 남은 1 < 2면 확인 필요로 · 수량 0·11은 보내기 전 알림 · 같은 사람 하나 더는 번호·옵션을 비움', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const title = uniqueTitle('옵션 문자')
  const { b, date } = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS', title })
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await openSms(page, title)
  await smsField(page, '번호').fill('21')
  const size = smsForm(page).getByRole('radiogroup', { name: '사이즈' })
  await expect(size).toBeVisible()
  for (const label of ['S', 'M', 'L']) {
    const radio = size.getByRole('radio', { name: `${label} · 남은 1개` })
    await expect(radio).toBeVisible()
    await expect(radio).not.toBeChecked()
  }
  const qty = smsForm(page).getByLabel('수량', { exact: true })
  await expect(qty).toHaveValue('1')
  await expect(qty).toHaveAttribute('inputmode', 'numeric')
  const submit = page.getByRole('button', { name: '21번에 문자찜 넣기' })
  await expect(submit).toBeDisabled()
  await size.getByRole('radio', { name: 'M · 남은 1개' }).check()
  await expect(submit).toBeEnabled()
  await qty.fill('0')
  await expect(smsForm(page).getByText('수량은 1부터 10까지예요.')).toBeVisible()
  await expect(submit).toBeDisabled()
  await qty.fill('11')
  await expect(smsForm(page).getByText('수량은 1부터 10까지예요.')).toBeVisible()
  await expect(submit).toBeDisabled()
  await qty.fill('2')
  await expect(submit).toBeEnabled()
  await noHorizontalScroll(page)
  const sent = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/events' && r.request().method() === 'POST')
  await submit.click()
  const body = await (await sent).json() as { seq: number }
  const result = page.getByRole('region', { name: '넣은 결과' })
  await expect(result).toContainText(SMS_TO_REVIEW)
  await expect(result).toHaveAttribute('data-tone', 'warning')
  // 서버: 찜이 없고 확인 필요(남은 수량 부족)
  const claims = (await oscope(page, date, true)).claims.filter((c) => c.broadcast === b)
  expect(claims.filter((c) => c.origin === 'sms' && c.seq === body.seq)).toEqual([])
  const reviews = (await reviewsApi(page, { broadcast: b, rehearsal: true })).reviews
  expect(reviews.map((r) => [r.reason, r.origin, r.seq])).toEqual([['STOCK_SHORT', 'sms', body.seq]])
  const events = (await history(page, date, true)).filter((e) => e.type === 'sms')
  expect(events.map((e) => [e.fields['qty'], JSON.stringify(e.fields['options'])])).toEqual([[2, JSON.stringify({ 사이즈: 'M' })]])
  // 같은 사람 하나 더: 번호·옵션을 비운다
  await result.getByRole('button', { name: '같은 사람 하나 더' }).click()
  await expect(smsField(page, '번호')).toHaveValue('')
  await smsField(page, '번호').fill('21')
  for (const label of ['S', 'M', 'L']) await expect(smsForm(page).getByRole('radiogroup', { name: '사이즈' }).getByRole('radio', { name: new RegExp(`^${label} · `) })).not.toBeChecked()
})

test('AC-O2-40: 남은 수량이 있으면 문자찜 옵션 찜이 생긴다 (qty·options가 엔진 찜에)', async ({ page }) => {
  const title = uniqueTitle('옵션 문자 성공')
  const { b, date } = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS', title })
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES, stocks: { L: 3 } })
  await openSms(page, title)
  await smsField(page, '번호').fill('21')
  await smsForm(page).getByRole('radiogroup', { name: '사이즈' }).getByRole('radio', { name: 'L · 남은 3개' }).check()
  await smsForm(page).getByLabel('수량', { exact: true }).fill('2')
  await page.getByRole('button', { name: '21번에 문자찜 넣기' }).click()
  const result = page.getByRole('region', { name: '넣은 결과' })
  await expect(result).toContainText('21번')
  await expect(result).not.toContainText(SMS_TO_REVIEW)
  const [claim] = await waitClaims(page, date, true, b, 1)
  expect([claim!.origin, claim!.variant, claim!.qty, claim!.status, claim!.amount]).toEqual(['sms', 'L', 2, 'CONFIRMED', 30000])
})

test('AC-O2-41: 옵션 방송에서 없는 번호는 안내와 수량만, 옵션 없는 상품은 수량만 · 번호 방송 문자찜은 지금 그대로', async ({ page }) => {
  const title = uniqueTitle('옵션 문자 없음')
  const { b } = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS', title })
  await registerOptions(page, b, { no: 11, name: '컵', price: 5000 })
  await openSms(page, title)
  await smsField(page, '번호').fill('30')
  await expect(smsForm(page).getByText('상품을 등록하면 옵션을 고를 수 있어요')).toBeVisible()
  await expect(smsForm(page).getByLabel('수량', { exact: true })).toBeVisible()
  await expect(smsForm(page).getByRole('radiogroup')).toHaveCount(0)
  await smsField(page, '번호').fill('11')
  await expect(smsForm(page).getByText('상품을 등록하면 옵션을 고를 수 있어요')).toHaveCount(0)
  await expect(smsForm(page).getByLabel('수량', { exact: true })).toBeVisible()
  await expect(smsForm(page).getByRole('radiogroup')).toHaveCount(0)

  const numTitle = uniqueTitle('번호 문자')
  await createBroadcast(page, { rehearsal: true, saleMode: 'NUMBERS', title: numTitle })
  await openSms(page, numTitle)
  await smsField(page, '번호').fill('30')
  await expect(smsForm(page).getByLabel('수량', { exact: true })).toHaveCount(0)
  await expect(smsForm(page).getByText('상품을 등록하면 옵션을 고를 수 있어요')).toHaveCount(0)
})

test('AC-O2-42: 직접 배정 — 옵션은 비어 있고 수량 1, 다 골라야 보내며 host.assign에 options·qty', async ({ page }) => {
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES, stocks: { L: 2 } })
  await chat(page, b, '홍길동', '반바지 이뻐요')
  await boardItem(page, 21).click()
  await page.getByRole('dialog', { name: /21번.*자세히/ }).getByRole('button', { name: '직접 배정' }).click()
  const dlg = page.getByRole('dialog', { name: '21번 직접 배정' })
  await expect(dlg.getByLabel('사이즈')).toHaveValue('')
  await expect(dlg.getByLabel('수량')).toHaveValue('1')
  await dlg.getByLabel('닉네임으로 찾기').fill('홍길동')
  await dlg.getByRole('radio', { name: '홍길동' }).check()
  await dlg.getByLabel('사유').fill('전화 주문')
  await dlg.getByRole('button', { name: '1등으로 정하기' }).click()
  await expect(dlg).toBeVisible()
  await expect(dlg.getByText(/사이즈.*골라 주세요/)).toBeVisible()
  await dlg.getByLabel('사이즈').selectOption('L')
  await dlg.getByLabel('수량').fill('2')
  await dlg.getByRole('button', { name: '1등으로 정하기' }).click()
  await expect(dlg).toHaveCount(0)
  const [claim] = await waitClaims(page, date, true, b, 1)
  expect([claim!.variant, claim!.qty, claim!.status]).toEqual(['L', 2, 'CONFIRMED'])
  const assigns = (await history(page, date, true)).filter((e) => e.type === 'host.assign')
  expect(assigns.map((e) => [JSON.stringify(e.fields['options']), e.fields['qty']])).toEqual([[JSON.stringify({ 사이즈: 'L' }), 2]])
})

test('AC-O2-43: 한 구매자의 21 M·L 중 하나를 취소하면 그 변형만 바뀐다 (보낸 조치에 options)', async ({ page }) => {
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await chat(page, b, '홍길동', '반바지 M')
  await chat(page, b, '홍길동', '반바지 L')
  await waitClaims(page, date, true, b, 2)
  await boardItem(page, 21).click()
  const detail = page.getByRole('dialog', { name: /21번.*자세히/ })
  const l = detail.getByRole('region', { name: 'L 변형' })
  await expect(l).toContainText('홍길동')
  await expect(detail.getByRole('region', { name: 'M 변형' })).toContainText('홍길동')
  await l.getByRole('button', { name: /찜 취소하기/ }).click()
  const cancel = page.getByRole('dialog').last()
  await cancel.getByLabel('사유').fill('시청자 요청')
  await cancel.getByRole('button', { name: /취소/ }).last().click()
  await expect.poll(async () => (await oscope(page, date, true)).claims.filter((c) => c.broadcast === b && c.status === 'CONFIRMED').map((c) => c.variant)).toEqual(['M'])
  const cancels = (await history(page, date, true)).filter((e) => e.type === 'host.cancel')
  expect(cancels.map((e) => JSON.stringify(e.fields['options']))).toEqual([JSON.stringify({ 사이즈: 'L' })])
})

test('AC-O2-44: 변형을 정하지 않은 취소 요청 — 찜 둘이 옵션 글·상태와 보이고 처음엔 안 골라짐, L만 취소 → 김철수 L 1등 · "취소하지 않기"는 찜 그대로', async ({ page }) => {
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await registerOptions(page, b, { no: 22, name: '치마', price: 12000, options: SIZES })
  await chat(page, b, '홍길동', '반바지 M')
  await chat(page, b, '홍길동', '반바지 L')
  await chat(page, b, '김철수', '반바지 L')
  await chat(page, b, '이영희', '치마 S')
  await chat(page, b, '이영희', '치마 M')
  await waitClaims(page, date, true, b, 5)
  await chat(page, b, '홍길동', '21 취소')
  const strip = page.getByRole('region', { name: '알림' })
  await expect(strip.getByRole('button', { name: '취소 요청 1' })).toBeVisible()
  await strip.getByRole('button', { name: '취소 요청 1' }).click()
  const dlg = page.getByRole('dialog', { name: /^취소 요청 — 21번/ })
  await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
  await expect(dlg).toContainText('홍길동')
  const mRadio = dlg.getByRole('radio', { name: /^M · 1등/ })
  const lRadio = dlg.getByRole('radio', { name: /^L · 1등/ })
  await expect(mRadio).not.toBeChecked()
  await expect(lRadio).not.toBeChecked()
  await expect(dlg.getByRole('button', { name: '고른 찜 취소' })).toBeDisabled()
  await lRadio.check()
  await dlg.getByRole('button', { name: '고른 찜 취소' }).click()
  await expect.poll(async () => {
    const s = await oscope(page, date, true)
    const p = await productOf(page, date, true, b, 21)
    return p.variants.map((v) => [v.text, v.winners.map((id) => buyerName(s, id))])
  }, { timeout: 15_000 }).toEqual([['S', []], ['M', ['홍길동']], ['L', ['김철수']]])
  await expect(strip.getByRole('button', { name: /^취소 요청/ })).toHaveCount(0)

  // 다른 요청: "취소하지 않기"는 요청을 지우고 찜은 그대로
  await chat(page, b, '이영희', '22 취소')
  await expect(strip.getByRole('button', { name: '취소 요청 1' })).toBeVisible()
  await strip.getByRole('button', { name: '취소 요청 1' }).click()
  const dlg2 = page.getByRole('dialog', { name: /^취소 요청 — 22번/ })
  await dlg2.getByRole('button', { name: '취소하지 않기' }).click()
  await expect(strip.getByRole('button', { name: /^취소 요청/ })).toHaveCount(0, { timeout: 15_000 })
  const s = await oscope(page, date, true)
  const p22 = s.claims.filter((c) => c.broadcast === b && c.no === 22 && c.status === 'CONFIRMED')
  expect(p22.map((c) => [c.variant, c.cancelRequested])).toEqual([['S', false], ['M', false]])
})
