// O2 라운드 1 깨뜨리기 (test-e2e) — 수정(TE-O2-001~004·SA-O2-05)의 뒷길과 AC-O2-53 색·주 버튼.
// 기대값은 acceptance.md(AC-O2-11·23·53)·D-O2-05 보강(dev-notes 5번, spec-keeper 확정 전 가장 안전한 쪽)·AC-S05-33에서 정했다.
// 색은 글자와 함께 data-tone(주의 warning·위험 danger·성공 success)으로, 채운 색 주 버튼은 button-primary로 센다(UX-01, D-102).
import { expect, test, type Locator, type Page } from '@playwright/test'
import { loginNewSeller } from '../i3/support.ts'
import {
  SIZES,
  SMS_TO_REVIEW,
  boardItem,
  buyerName,
  chat,
  createBroadcast,
  history,
  login,
  openOptionBroadcast,
  openReviews,
  openSms,
  oscope,
  productOf,
  registerOptions,
  reviewLine,
  reviewList,
  smsField,
  waitClaims,
  waitReviews,
  writeEvent,
} from './support.ts'

const DROPPED = (no: number) => `붙인 옵션은 ${String(no)}번에 넣지 않고 뗐어요.`

/** 보이는 채운 색 주 버튼 수 */
async function primaryCount(scope: Locator): Promise<number> {
  return await scope.locator('.button-primary:visible').count()
}

/** 빠른 입력 줄에 옵션(사이즈 S·M)을 붙인다 */
async function attachSizes(page: Page) {
  await page.getByRole('button', { name: '옵션 추가' }).click()
  const dlg = page.getByRole('dialog', { name: '옵션 추가' })
  await dlg.getByRole('button', { name: '항목 더하기' }).click()
  await dlg.getByLabel('항목 1 이름').fill('사이즈')
  await dlg.getByLabel('항목 1 선택지 여러 개').fill('S, M')
  await dlg.getByRole('button', { name: '항목 1 선택지 한 번에 더하기' }).click()
  await dlg.getByRole('button', { name: '옵션 넣기' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(page.getByRole('group', { name: '붙은 옵션' })).toContainText('사이즈 S/M')
}

test('SA-O2-05 회귀: 21이 이미 있을 때 옵션을 붙이고 "21 …" Enter — 떼었다는 주의 안내, 붙은 옵션 사라짐, 21·이어 친 22 모두 옵션 없음', async ({ page }) => {
  await login(page)
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000 })
  await expect(boardItem(page, 21)).toBeVisible()
  const input = page.getByLabel('빠른 입력')
  await input.fill('21 반바지 16000')
  await attachSizes(page)
  await input.press('Enter')
  const ask = page.getByRole('dialog', { name: '21번이 이미 있어요. 고칠까요?' })
  await expect(ask).toBeVisible()
  const note = page.getByRole('status').filter({ hasText: DROPPED(21) })
  await expect(note).toBeVisible()
  await expect(note).toHaveAttribute('data-tone', 'warning')
  await expect(page.getByRole('group', { name: '붙은 옵션' })).toHaveCount(0)
  await ask.getByRole('button', { name: '예' }).click()
  await expect.poll(async () => (await productOf(page, date, true, b, 21)).price).toBe(16000)
  await input.fill('22 티셔츠 9000')
  await input.press('Enter')
  await expect(boardItem(page, 22)).toBeVisible()
  const events = (await history(page, date, true)).filter((e) => e.type.startsWith('product.'))
  const reg22 = events.find((e) => e.type === 'product.register' && e.fields['no'] === 22)
  expect(reg22, JSON.stringify(events)).toBeDefined()
  expect(reg22!.fields['options']).toBeUndefined()
  const upd21 = events.find((e) => e.type === 'product.update' && e.fields['no'] === 21)
  expect(upd21?.fields['options']).toBeUndefined()
  expect((await productOf(page, date, true, b, 21)).hasOptions).toBe(false)
  expect((await productOf(page, date, true, b, 22)).hasOptions).toBe(false)
})

test('SA-O2-05 회귀: 옵션을 붙인 채 번호만 친 찾기("21")도 떼고 알린다 — 다음 새 번호에 따라가지 않는다', async ({ page }) => {
  await login(page)
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000 })
  await expect(boardItem(page, 21)).toBeVisible()
  const input = page.getByLabel('빠른 입력')
  await input.fill('21')
  await attachSizes(page)
  await input.press('Enter')
  await expect(page.getByRole('status').filter({ hasText: DROPPED(21) })).toBeVisible()
  await expect(page.getByRole('group', { name: '붙은 옵션' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await input.fill('23 모자 7000')
  await input.press('Enter')
  await expect(boardItem(page, 23)).toBeVisible()
  expect((await productOf(page, date, true, b, 23)).hasOptions).toBe(false)
})

test('TE-O2-001 이어서: 변형 둘의 승계 결정 — M은 대기자를 1등으로(options M), L은 다시 판매(options L), 다른 변형은 그대로', async ({ page }) => {
  await loginNewSeller(page)
  const origin = new URL(page.url()).origin
  const res = await page.request.patch('/api/settings', { data: { settings: { 'cancel.succession': 'ASK' } }, headers: { Origin: origin } })
  expect(res.status(), await res.text()).toBe(200)
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await chat(page, b, '홍길동', '반바지 M')
  await chat(page, b, '김철수', '반바지 M')
  await chat(page, b, '이영희', '반바지 L')
  await chat(page, b, '박민수', '반바지 L')
  await waitClaims(page, date, true, b, 4)
  const s = await oscope(page, date, true)
  const byName = (n: string) => s.claims.find((c) => c.broadcast === b && buyerName(s, c.currentBuyer) === n)!
  for (const [n, size] of [['홍길동', 'M'], ['이영희', 'L']] as const) {
    const cancel = await writeEvent(page, { type: 'host.cancel', b, no: 21, buyer: byName(n).currentBuyer, options: { 사이즈: size }, reason: '시험 취소' })
    expect(cancel.status, JSON.stringify(cancel.body)).toBeLessThan(300)
  }
  const strip = page.getByRole('region', { name: '알림' })
  await expect(strip.getByRole('button', { name: /^승계 결정 필요 2/ })).toBeVisible()
  await strip.getByRole('button', { name: /^승계 결정 필요/ }).click()
  const m = page.getByRole('dialog', { name: '승계 결정 — 21번 M 반바지' })
  await expect(m).toContainText('대기 1번 김철수')
  await expect(m).not.toContainText('박민수')
  await m.getByRole('button', { name: /김철수 1등으로/ }).click()
  const reason = page.getByRole('dialog').last()
  await reason.getByLabel('사유').fill('시험 승계')
  await reason.getByLabel('사유').press('Enter')
  await expect.poll(async () => {
    const v = (await productOf(page, date, true, b, 21)).variants.find((x) => x.text === 'M')!
    return [v.awaitingSuccession, v.winners.length]
  }, { timeout: 15_000 }).toEqual([false, 1])
  const after = await oscope(page, date, true)
  const mv = (await productOf(page, date, true, b, 21)).variants.find((x) => x.text === 'M')!
  expect(buyerName(after, mv.winners[0]!)).toBe('김철수')
  await expect(strip.getByRole('button', { name: /^승계 결정 필요 1/ })).toBeVisible()
  await strip.getByRole('button', { name: /^승계 결정 필요/ }).click()
  const l = page.getByRole('dialog', { name: '승계 결정 — 21번 L 반바지' })
  await expect(l).toContainText('대기 1번 박민수')
  await l.getByRole('button', { name: '다시 판매(대기자 정리)' }).click()
  const reopen = page.getByRole('dialog').last()
  await expect(reopen).toContainText('대기자 1명이 모두 정리돼요')
  await reopen.getByLabel('사유').fill('시험 다시 판매')
  await reopen.getByLabel('사유').press('Enter')
  await expect.poll(async () => {
    const v = (await productOf(page, date, true, b, 21)).variants.find((x) => x.text === 'L')!
    return [v.awaitingSuccession, v.waitlist.length, v.winners.length]
  }, { timeout: 15_000 }).toEqual([false, 0, 0])
  await expect(strip.getByText('알림 없음')).toBeVisible()
  const log = (await history(page, date, true)).filter((e) => e.type === 'host.promote' || e.type === 'host.reopen')
  expect(log.map((e) => [e.type, e.fields['options']])).toEqual([['host.promote', { 사이즈: 'M' }], ['host.reopen', { 사이즈: 'L' }]])
  // M 1등 김철수는 L 다시 판매에 휩쓸리지 않는다
  const final = (await productOf(page, date, true, b, 21)).variants.find((x) => x.text === 'M')!
  expect(final.winners.length).toBe(1)
})

test('AC-O2-53: 옵션 추가 창 — 오류는 위험 색(글자 함께), 채운 색 주 버튼은 하나', async ({ page }) => {
  await login(page)
  await openOptionBroadcast(page)
  await page.getByLabel('빠른 입력').fill('21 반바지 15000')
  await page.getByRole('button', { name: '옵션 추가' }).click()
  const dlg = page.getByRole('dialog', { name: '옵션 추가' })
  await dlg.getByRole('button', { name: '항목 더하기' }).click()
  await dlg.getByLabel('항목 1 이름').fill('사이즈')
  await dlg.getByLabel('항목 1 선택지 여러 개').fill('S, M, L')
  await dlg.getByRole('button', { name: '항목 1 선택지 한 번에 더하기' }).click()
  expect(await primaryCount(dlg)).toBeLessThanOrEqual(1)
  await dlg.getByLabel('항목 1 선택지 3 별칭').fill('m')
  const problem = dlg.getByText('‘m’이 사이즈 M과 사이즈 L에 함께 있어요')
  await expect(problem).toBeVisible()
  // 겹침은 넣을 수 없는 오류다: 위험 색
  // 위험 색(붉은 글자 또는 붉은 띠)이고 화면 읽기 프로그램에 알린다
  const alert = dlg.getByRole('alert').filter({ hasText: '함께 있어요' })
  await expect(alert).toBeVisible()
  const reddish = await alert.evaluate((el) => {
    const red = (c: string) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c); return m !== null && Number(m[1]) > Number(m[2]) + 60 && Number(m[1]) > Number(m[3]) + 60 }
    const st = getComputedStyle(el)
    return el.getAttribute('data-tone') === 'danger' || red(st.color) || red(st.backgroundColor) || red(st.borderLeftColor)
  })
  expect(reddish).toBe(true)
  expect(await primaryCount(dlg)).toBeLessThanOrEqual(1)
})

test('AC-O2-53: 확인 필요 목록 — 줄이 여럿이어도 채운 색 주 버튼은 하나, 찜이 생긴 결과는 성공 색·그대로 두었어요는 주의 색', async ({ page }) => {
  await login(page)
  const { b } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await chat(page, b, '김철수', '반바지')
  await chat(page, b, '이영희', '반바지')
  await chat(page, b, '박민수', '반바지')
  await waitReviews(page, b, true, 3)
  await openReviews(page, b, true)
  const main = page.locator('main')
  expect(await primaryCount(main)).toBeLessThanOrEqual(1)
  await reviewLine(page, 1).getByLabel('사이즈').selectOption('M')
  await reviewLine(page, 1).getByLabel('수량').fill('1')
  await reviewLine(page, 1).getByRole('checkbox', { name: '1번째 줄 고르기' }).check()
  expect(await primaryCount(main)).toBeLessThanOrEqual(1)
  await reviewLine(page, 1).getByRole('button', { name: '1번째 줄 주문으로' }).click()
  const done = page.getByRole('list', { name: '보낸 결과' }).getByRole('status').filter({ hasText: '1등' })
  await expect(done).toBeVisible({ timeout: 15_000 })
  await expect(done).toHaveAttribute('data-tone', 'success')
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(2)
  // S를 수량 2로 고르면 남은 1 < 2 → 서버가 아무 일도 하지 않음 → 그대로 두었어요(주의 색)
  await reviewLine(page, 1).getByLabel('사이즈').selectOption('S')
  await reviewLine(page, 1).getByLabel('수량').fill('2')
  await reviewLine(page, 1).getByRole('button', { name: '1번째 줄 주문으로' }).click()
  const kept = reviewLine(page, 1).getByText(/^그대로 두었어요 — /)
  await expect(kept).toBeVisible({ timeout: 15_000 })
  await expect(kept).toHaveAttribute('data-tone', 'warning')
  expect(await primaryCount(main)).toBeLessThanOrEqual(1)
})

test('AC-O2-53: 문자찜 결과 — 확인 필요로 보낸 결과는 주의 색, 찜이 생긴 결과는 성공 색 (375px)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await login(page)
  const title = `색 ${crypto.randomUUID().slice(0, 8)}`
  const { b } = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS', title })
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await openSms(page, title)
  const form = page.getByRole('region', { name: '문자찜 넣기' })
  expect(await primaryCount(page.locator('main'))).toBeLessThanOrEqual(1)
  await smsField(page, '번호').fill('21')
  await smsField(page, '전화번호').fill('010-1111-2222')
  await form.getByRole('radiogroup', { name: '사이즈' }).getByRole('radio', { name: 'M · 남은 1개' }).check()
  await form.getByLabel('수량', { exact: true }).fill('1')
  await page.getByRole('button', { name: '21번에 문자찜 넣기' }).click()
  const result = page.getByRole('region', { name: '넣은 결과' })
  await expect(result).toContainText('1등', { timeout: 15_000 })
  await expect(result).toHaveAttribute('data-tone', 'success')
  expect(await primaryCount(page.locator('main'))).toBeLessThanOrEqual(1)

  await smsField(page, '번호').fill('21')
  await smsField(page, '전화번호').fill('010-3333-4444')
  await form.getByRole('radiogroup', { name: '사이즈' }).getByRole('radio', { name: /^S · 남은 1개/ }).check()
  await form.getByLabel('수량', { exact: true }).fill('3')
  await page.getByRole('button', { name: '21번에 문자찜 넣기' }).click()
  await expect(result).toContainText(SMS_TO_REVIEW, { timeout: 15_000 })
  await expect(result).toHaveAttribute('data-tone', 'warning')
  expect(await primaryCount(page.locator('main'))).toBeLessThanOrEqual(1)
})

test('깨뜨리기: 옵션을 붙인 등록이 서버에 닿은 뒤 응답만 끊겨도(재시도 모두 실패) "다시 보내기"로 한 번만, 옵션과 함께 기록된다', async ({ page }) => {
  await login(page)
  const { b, date } = await openOptionBroadcast(page)
  const input = page.getByLabel('빠른 입력')
  await input.fill('21 반바지 15000')
  await attachSizes(page)
  let cut = true
  await page.route('**/api/events', async (route) => {
    const body = route.request().postData() ?? ''
    if (cut && route.request().method() === 'POST' && body.includes('product.register')) {
      await route.fetch() // 서버는 받아 기록한다
      await route.abort('internetdisconnected') // 화면은 응답을 못 받는다
      return
    }
    await route.continue()
  })
  await input.press('Enter')
  const retry = page.getByRole('button', { name: '다시 보내기' })
  await expect(retry).toBeVisible({ timeout: 20_000 })
  cut = false
  await retry.click()
  await expect(boardItem(page, 21)).toBeVisible()
  await expect(page.getByRole('group', { name: '붙은 옵션' })).toHaveCount(0)
  // 떼었다는 안내는 나오지 않는다 (옵션이 21에 들어갔다)
  await expect(page.getByRole('status').filter({ hasText: DROPPED(21) })).toHaveCount(0)
  const regs = (await history(page, date, true)).filter((e) => e.type === 'product.register')
  expect(regs.length).toBe(1)
  const p21 = await productOf(page, date, true, b, 21)
  expect(p21.variants.map((v) => v.text)).toEqual(['S', 'M'])
  // 이어 친 새 번호엔 옵션이 따라가지 않는다
  await input.fill('22 티셔츠 9000')
  await input.press('Enter')
  await expect(boardItem(page, 22)).toBeVisible()
  expect((await productOf(page, date, true, b, 22)).hasOptions).toBe(false)
})

test('깨뜨리기: 옵션을 붙여 Enter한 사이 다른 기기가 같은 번호를 먼저 등록하면 — 떼었다는 안내와 고칠까요, 옵션은 어느 상품에도 들어가지 않는다', async ({ page, browser }) => {
  await login(page)
  const { b, date } = await openOptionBroadcast(page)
  const phone = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 375, height: 800 } })
  const p2 = await phone.newPage()
  try {
    const input = page.getByLabel('빠른 입력')
    await input.fill('21 반바지 15000')
    await attachSizes(page)
    // 이 기기의 등록 요청을 잡아 두고, 그사이 휴대폰이 21을 먼저 등록한다
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    await page.route('**/api/events', async (route) => {
      if (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('product.register')) await held
      await route.continue()
    })
    await input.press('Enter')
    await p2.goto(`/broadcasts/${encodeURIComponent(b)}`)
    const pi = p2.getByLabel('빠른 입력')
    await expect(pi).toBeFocused()
    await pi.fill('21 치마 12000')
    await pi.press('Enter')
    await expect(boardItem(p2, 21)).toBeVisible()
    release()
    await expect(page.getByRole('status').filter({ hasText: DROPPED(21) })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('dialog', { name: '21번이 이미 있어요. 고칠까요?' })).toBeVisible()
    await expect(page.getByRole('group', { name: '붙은 옵션' })).toHaveCount(0)
    const p21 = await productOf(page, date, true, b, 21)
    expect([p21.name, p21.hasOptions]).toEqual(['치마', false])
    await page.getByRole('dialog', { name: '21번이 이미 있어요. 고칠까요?' }).getByRole('button', { name: '아니요' }).click()
    await page.unroute('**/api/events')
    await input.fill('22 티셔츠 9000')
    await input.press('Enter')
    await expect(boardItem(page, 22)).toBeVisible()
    expect((await productOf(page, date, true, b, 22)).hasOptions).toBe(false)
  } finally {
    await phone.close()
  }
})
