// 메뉴·주소·떠나기 전 확인 (AC-S06-01, D-083), 다시 받기 실패 (AC-S06-41) — test-e2e.
import { test, expect } from '@playwright/test'
import { history, login, menu, openNewBroadcast, registerApi, scopeView, uniqueDate, untilElapsed, viewerClaim, writeEvent } from './support.ts'

test.describe('메뉴·떠나기', () => {
  test('AC-S06-01: 메뉴 네 개와 aria-current, 주소 새로고침, 세션이 끝나 다시 로그인하면 보던 주소로', async ({ page, context }) => {
    await login(page)
    const date = uniqueDate()
    await openNewBroadcast(page, { date, rehearsal: true })
    const nav = menu(page)
    for (const name of ['방송', '문자찜 입력', '구매자', '정산']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: '방송', exact: true })).toHaveAttribute('aria-current', 'page')
    await page.goto(`/buyers?date=${date}&rehearsal=true`)
    await expect(nav.getByRole('link', { name: '구매자', exact: true })).toHaveAttribute('aria-current', 'page')
    await nav.getByRole('link', { name: '정산', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/settlements\\?date=${date}&rehearsal=true`))
    await expect(nav.getByRole('link', { name: '정산', exact: true })).toHaveAttribute('aria-current', 'page')
    // 세션 끝 → 로그인 → 같은 주소
    await context.clearCookies()
    await page.reload()
    await page.getByLabel('아이디').fill('e2e-shop')
    await page.getByLabel('비밀번호').fill('e2e-pass-1234')
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page).toHaveURL(new RegExp(`/settlements\\?date=${date}&rehearsal=true`))
    await expect(page.getByRole('region', { name: '정산 요약' })).toBeVisible()
  })

  test('AC-S06-01: 콘솔에서 대기 중 조치가 있으면 메뉴로 떠나기 전에 묻고, 떠나면 보내지 않는다', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await viewerClaim(page, b, '홍길동', '15', 'sim_hong_5151')
    const item = page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^15번 / })
    await expect(item).toContainText('홍길동')
    await item.click()
    const detail = page.getByRole('dialog', { name: '15번 자세히' })
    await detail.getByRole('button', { name: '찜 취소하기' }).first().click()
    await page.keyboard.press('1')
    await page.keyboard.press('Enter')
    const since = Date.now()
    await menu(page).getByRole('link', { name: '구매자', exact: true }).click()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toContainText('보내기 전인 조치가 있어요. 떠나면 보내지 않아요.')
    await expect(ask.getByRole('button', { name: '닫기' })).toBeFocused()
    await ask.getByRole('button', { name: '보내지 않고 떠나기' }).click()
    await expect(page).toHaveURL(/\/buyers/)
    await untilElapsed(page, since, 4000)
    expect((await history(page, date, true)).filter((e) => e.type === 'host.cancel')).toHaveLength(0)
  })

  test('TE-S06-003 회귀: 구매자 화면 안에서 이동("구매자 목록으로")해 "보내지 않고 떠나기"를 고르면 대기 중이던 차단을 보내지 않는다', async ({ page }) => {
    // AC-S06-01·22, D-083: "떠나면 보내지 않아요"라고 묻고 판매자가 "보내지 않고 떠나기"를 골랐다면 그 조치는 보내지지 않아야 한다.
    // 구매자 자세히 → 목록은 같은 화면(BuyersPage) 안의 이동이라 대기열이 그대로 살아 있어 2초(E2E) 뒤 차단이 기록된다.
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await viewerClaim(page, b, '나쁜손', '15', 'sim_bad_6161')
    const view = await scopeView(page, date, true)
    const buyer = view.buyers.find((x) => x.display === '나쁜손')!.id
    await page.goto(`/buyers?date=${date}&rehearsal=true&buyer=${encodeURIComponent(buyer)}`)
    const detail = page.getByRole('region', { name: '구매자 자세히' })
    await detail.getByRole('button', { name: '차단하기' }).click()
    const dlg = page.getByRole('dialog').last()
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await page.keyboard.press('1')
    await expect(dlg.getByRole('button', { name: '차단하기' })).toBeFocused()
    await page.keyboard.press('Enter')
    const since = Date.now()
    await detail.getByRole('button', { name: '구매자 목록으로' }).click()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: '보내지 않고 떠나기' }).click()
    await expect(page.getByRole('region', { name: '구매자 목록' })).toBeVisible()
    await untilElapsed(page, since, 4000)
    expect((await history(page, date, true)).filter((e) => e.type === 'host.blockBuyer'), '"보내지 않고 떠나기"를 골랐는데 차단이 보내짐').toHaveLength(0)
  })
})

test.describe('다시 받기 실패 (AC-S06-41)', () => {
  test('정산 화면: 처음 불러오기가 몇 번 실패하면 고정 안내 → 회복되면 사라지고 그사이 입금이 보인다', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await viewerClaim(page, b, '가나다', '15', 'sim_ga_7171')
    const view = await scopeView(page, date, true)
    const buyer = view.buyers[0]!.id
    let fail = 3
    const full = new RegExp(`/api/days/${date}\\?`)
    await page.route(full, async (route) => {
      if (fail > 0 && route.request().method() === 'GET') {
        fail -= 1
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '잠시 뒤 다시 시도해 주세요.' } }) })
        return
      }
      await route.continue()
    })
    await page.goto(`/settlements?date=${date}&rehearsal=true`)
    const notice = page.getByText('화면을 최신으로 맞추지 못했어요. 다시 시도하는 중이에요.')
    await expect(notice).toBeVisible()
    await expect(page.getByRole('button', { name: '지금 다시 불러오기' })).toBeVisible()
    // 그사이 다른 기기의 입금
    expect((await writeEvent(page, { type: 'settlement.payment', buyer, date, amount: 14000 }, { date, rehearsal: true })).status).toBeLessThan(300)
    await expect(notice).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByRole('list', { name: '정산 묶음' })).toContainText('입금 완료')
  })

  test('콘솔: 410 뒤 전체 다시 받기가 실패하면 고정 안내, 회복되면 그사이 1등이 보인다', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await expect(page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^15번 / })).toBeVisible()
    let broken = true
    await page.route(/\/api\/days\/[^/]+\/changes/, async (route) => {
      if (broken) {
        await route.fulfill({ status: 410, contentType: 'application/json', body: JSON.stringify({ error: { code: 'RESYNC_REQUIRED', message: '처음부터 다시 받아 주세요.' } }) })
        return
      }
      await route.continue()
    })
    await page.route(new RegExp(`/api/days/${date}\\?`), async (route) => {
      if (broken) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버 오류' } }) })
        return
      }
      await route.continue()
    })
    await viewerClaim(page, b, '홍길동', '15', 'sim_hong_8181')
    const notice = page.getByText('화면을 최신으로 맞추지 못했어요. 다시 시도하는 중이에요.')
    await expect(notice).toBeVisible()
    broken = false
    await expect(notice).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^15번 / })).toContainText('홍길동')
  })
})
