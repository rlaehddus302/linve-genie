// S06 라운드 1 공격 (test-e2e): 수정 라운드 1의 떠나기 확인(뒤로 가기·두 번 뒤로·창 연 채 기다림·같은 화면 안 이동·새로고침·콘솔),
// 문자찜 화면 안 방송 바꾸기, 문자찜 결과 위치, 새 화면 쓰기 오류(AC-S06-82), 휴대폰 합치기 → PC(AC-S06-40), 채운 범위 목록 그리기(@fill),
// 연타(입금·환불·문자찜), 새 화면의 다시 받기 실패 안내(AC-S06-41·61). 모두 통과 — 회귀 시험으로 남긴다.
import { test, expect, type Browser, type Page } from '@playwright/test'
import {
  history, login, menu, openNewBroadcast, openSms, registerApi, scopeView, smsApi, smsField, smsUi, uniqueDate, untilElapsed, viewerClaim, writeEvent,
} from './support.ts'

function uniq(prefix: string): string {
  return `${prefix}${String(Math.floor(Math.random() * 1e6))}`
}

/** 구매자 자세히에서 차단을 대기열에 넣는다 (숫자 키 1 → Enter) */
async function queueBlock(page: Page): Promise<void> {
  const detail = page.getByRole('region', { name: '구매자 자세히' })
  await detail.getByRole('button', { name: '차단하기' }).click()
  const dlg = page.getByRole('dialog').last()
  await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
  await page.keyboard.press('1')
  await expect(dlg.getByRole('button', { name: '차단하기' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dlg).toHaveCount(0)
}

async function buyerSetup(page: Page, nick: string, channel: string): Promise<{ b: string; date: string; buyer: string }> {
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await viewerClaim(page, b, nick, '15', channel)
  const view = await scopeView(page, date, true)
  const buyer = view.buyers.find((x) => x.display === nick)!.id
  return { b, date, buyer }
}

async function phone(browser: Browser): Promise<Page> {
  const baseURL = test.info().project.use.baseURL!
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await login(page)
  return page
}

test.describe('떠나기 확인 다시 (RA-S06-001·UX-S06-001·TE-S06-003)', () => {
  test('RA-S06-001: 브라우저 뒤로 가기 → 묻는다 → "보내지 않고 떠나기"면 차단이 기록되지 않는다', async ({ page }) => {
    await login(page)
    const { date, buyer } = await buyerSetup(page, '뒤로가', 'sim_back_1111')
    await page.goto(`/buyers?date=${date}&rehearsal=true`)
    await page.getByRole('region', { name: '구매자 목록' }).getByRole('link', { name: /뒤로가/ }).click()
    await expect(page).toHaveURL(new RegExp(`buyer=${encodeURIComponent(buyer)}`))
    await queueBlock(page)
    const since = Date.now()
    await page.goBack()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: '보내지 않고 떠나기' }).click()
    await expect(page.getByRole('region', { name: '구매자 목록' })).toBeVisible()
    await untilElapsed(page, since, 4000)
    expect((await history(page, date, true)).filter((e) => e.type === 'host.blockBuyer')).toHaveLength(0)
  })

  test('RA-S06-001·UX-S06-001: 뒤로 가기 창을 연 채 대기(2초)보다 오래 있어도 보내지 않고, "닫기"면 보던 주소로 돌아가 남은 시간 뒤 한 번 보낸다', async ({ page }) => {
    await login(page)
    const { date, buyer } = await buyerSetup(page, '머무름', 'sim_stay_2222')
    await page.goto(`/buyers?date=${date}&rehearsal=true`)
    await page.getByRole('region', { name: '구매자 목록' }).getByRole('link', { name: /머무름/ }).click()
    const detailUrl = new RegExp(`buyer=${encodeURIComponent(buyer)}`)
    await expect(page).toHaveURL(detailUrl)
    await queueBlock(page)
    const since = Date.now()
    await page.goBack()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toBeVisible()
    await untilElapsed(page, since, 4500)
    expect((await history(page, date, true)).filter((e) => e.type === 'host.blockBuyer'), '창을 연 동안 보냈다').toHaveLength(0)
    await ask.getByRole('button', { name: '닫기' }).click()
    await expect(page).toHaveURL(detailUrl)
    await expect(page.getByRole('region', { name: '구매자 자세히' })).toBeVisible()
    await expect.poll(async () => (await history(page, date, true)).filter((e) => e.type === 'host.blockBuyer').length, { timeout: 10_000 }).toBe(1)
  })

  test('RA-S06-001: 뒤로 가기를 두 번 눌러도(창이 열린 채) "닫기" 한 번이면 보던 화면에 남고 조치는 한 번만 나간다', async ({ page }) => {
    await login(page)
    const { date, buyer } = await buyerSetup(page, '두번뒤', 'sim_twice_3333')
    await page.goto(`/buyers?date=${date}&rehearsal=true`)
    // 앱 안 이동만으로 기록 셋: 목록 → 자세히 → 목록 → 자세히
    await page.getByRole('region', { name: '구매자 목록' }).getByRole('link', { name: /두번뒤/ }).click()
    await page.getByRole('region', { name: '구매자 자세히' }).getByRole('button', { name: '구매자 목록으로' }).click()
    await page.getByRole('region', { name: '구매자 목록' }).getByRole('link', { name: /두번뒤/ }).click()
    await expect(page).toHaveURL(new RegExp(`buyer=${encodeURIComponent(buyer)}`))
    await queueBlock(page)
    await page.goBack()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toBeVisible()
    await page.goBack()
    await expect(ask).toHaveCount(1)
    await ask.getByRole('button', { name: '닫기' }).click()
    await expect(ask).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`buyer=${encodeURIComponent(buyer)}`))
    await expect(page.getByRole('region', { name: '구매자 자세히' })).toBeVisible()
    await expect.poll(async () => (await history(page, date, true)).filter((e) => e.type === 'host.blockBuyer').length, { timeout: 10_000 }).toBe(1)
  })

  test('TE-S06-003 다시: 같은 화면 안에서 "보내지 않고 떠나기" 뒤 새 차단을 대기열에 넣으면 메뉴로 떠날 때 또 묻는다', async ({ page }) => {
    await login(page)
    const { date, buyer } = await buyerSetup(page, '또물음', 'sim_again_4444')
    await page.goto(`/buyers?date=${date}&rehearsal=true&buyer=${encodeURIComponent(buyer)}`)
    await queueBlock(page)
    const detail = page.getByRole('region', { name: '구매자 자세히' })
    await detail.getByRole('button', { name: '구매자 목록으로' }).click()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await ask.getByRole('button', { name: '보내지 않고 떠나기' }).click()
    await page.getByRole('region', { name: '구매자 목록' }).getByRole('link', { name: /또물음/ }).click()
    await queueBlock(page)
    const since = Date.now()
    await menu(page).getByRole('link', { name: '정산', exact: true }).click()
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: '보내지 않고 떠나기' }).click()
    await expect(page.getByRole('region', { name: '정산 요약' })).toBeVisible()
    await untilElapsed(page, since, 4000)
    expect((await history(page, date, true)).filter((e) => e.type === 'host.blockBuyer')).toHaveLength(0)
  })

  test('AC-S06-01: 새로고침하면 브라우저가 묻고(beforeunload), 새로고침 뒤 대기 중이던 차단은 보내지 않는다', async ({ page }) => {
    await login(page)
    const { date, buyer } = await buyerSetup(page, '새로고', 'sim_reload_5555')
    await page.goto(`/buyers?date=${date}&rehearsal=true&buyer=${encodeURIComponent(buyer)}`)
    await queueBlock(page)
    const kinds: string[] = []
    page.on('dialog', (d) => {
      kinds.push(d.type())
      void d.accept()
    })
    const since = Date.now()
    await page.reload()
    await expect(page.getByRole('region', { name: '구매자 자세히' })).toBeVisible()
    await untilElapsed(page, since, 4000)
    expect((await history(page, date, true)).filter((e) => e.type === 'host.blockBuyer')).toHaveLength(0)
    expect(kinds).toContain('beforeunload')
  })
})

test.describe('문자찜 화면 안에서 방송 바꾸기', () => {
  test('D-083: 찜 취소를 기다리는 중에 "방송 바꾸기"로 다른 방송을 골라도, 그 취소는 보내지면 띠에 "보냈어요"류로 끝나고 "보내지 못했어요"가 되지 않는다', async ({ page }) => {
    await login(page)
    const t1 = uniq('바꿈가')
    const t2 = uniq('바꿈나')
    const date = uniqueDate()
    const b1 = await openNewBroadcast(page, { date, rehearsal: true, title: t1 })
    await openNewBroadcast(page, { date, rehearsal: true, title: t2 })
    await registerApi(page, b1, 15, '핑크프릴', 10000)
    await openSms(page, t1)
    await smsUi(page, { no: 15, memo: '바꿈' })
    const result = page.getByRole('region', { name: '넣은 결과' })
    await expect(result).toContainText('1등')
    await result.getByRole('button', { name: '찜 취소하기' }).click()
    await page.keyboard.press('1')
    await page.keyboard.press('Enter')
    // 대기 중에 방송 바꾸기
    await page.getByRole('region', { name: '고른 방송' }).getByRole('button', { name: '방송 바꾸기' }).click()
    const dlg = page.getByRole('dialog', { name: '방송 고르기' })
    await dlg.getByRole('button', { name: new RegExp(`^${t2} ·`) }).click()
    await expect(page.getByRole('region', { name: '고른 방송' })).toContainText(t2)
    await expect.poll(async () => (await history(page, date, true)).filter((e) => e.type === 'host.cancel').length, { timeout: 10_000 }).toBe(1)
    // 기록됐으면 화면이 실패라고 하지 않는다 (같은 요청을 다시 보내게 하지 않는다)
    await expect(page.getByText('보내지 못했어요')).toHaveCount(0)
    await expect(page.getByText(/저장하지 못했어요/)).toHaveCount(0)
  })
})

test.describe('문자찜 결과 위치 (UX-S06-002)', () => {
  for (const size of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
    test(`보낸 뒤 "넣은 결과" 카드와 번호 칸이 화면 안에 있다 (${String(size.width)}×${String(size.height)})`, async ({ page }) => {
      await page.setViewportSize(size)
      await login(page)
      const title = uniq('위치')
      const date = uniqueDate()
      const b = await openNewBroadcast(page, { date, rehearsal: true, title })
      await registerApi(page, b, 15, '핑크프릴', 10000)
      await openSms(page, title)
      await smsUi(page, { no: 15, phone: '010-4321-8765', memo: '위치', received: '00:00:01' })
      await expect(page.getByRole('region', { name: '넣은 결과' })).toBeInViewport({ ratio: 1 })
      await expect(smsField(page, '번호')).toBeInViewport({ ratio: 1 })
      await expect(smsField(page, '번호')).toBeFocused()
    })
  }
})

test.describe('새 화면 쓰기 오류 (AC-S06-82)', () => {
  test('정산 입금: 503 SAVE_FAILED가 이어지면 "저장하지 못했어요" + 다시 보내기 → 같은 요청 번호로 한 번만 기록', async ({ page }) => {
    await login(page)
    const { date, buyer } = await buyerSetup(page, '입금오', 'sim_payerr_6666')
    const ids: string[] = []
    let fail = true
    await page.route(/\/api\/events/, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const body = route.request().postDataJSON() as { type?: string; requestId?: string }
      if (body.type !== 'settlement.payment') return route.continue()
      ids.push(body.requestId ?? '')
      if (fail) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SAVE_FAILED', message: '저장하지 못했어요. 잠시 뒤 다시 보내 주세요.' } }) })
        return
      }
      await route.continue()
    })
    await page.goto(`/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(buyer)}`)
    const detail = page.getByRole('region', { name: '정산 자세히' })
    await detail.getByRole('button', { name: '입금 적기' }).click()
    const pay = page.getByRole('dialog', { name: '입금 적기' })
    await expect(pay.getByLabel('입금 금액')).toHaveValue('14000')
    await pay.getByRole('button', { name: '입금 적기' }).click()
    await expect(page.getByText(/저장하지 못했어요/).first()).toBeVisible({ timeout: 20_000 })
    const retry = page.getByRole('button', { name: '다시 보내기' })
    await expect(retry).toBeVisible()
    expect(new Set(ids).size, '저절로 다시 보낼 때 요청 번호가 바뀌었다').toBe(1)
    fail = false
    await retry.click()
    await expect(detail).toContainText('입금 완료')
    expect(new Set(ids).size).toBe(1)
    expect((await history(page, date, true)).filter((e) => e.type === 'settlement.payment')).toHaveLength(1)
  })

  test('구매자 합치기: 500 PROCESSING_FAILED면 "확인 필요"이고 저절로 다시 보내지 않는다', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 16, '로즈', 8000)
    await viewerClaim(page, b, '합침가', '15', 'sim_mrg_7771')
    await smsApi(page, { b, no: 16, memo: '합침나' })
    const view = await scopeView(page, date, true)
    const target = view.buyers.find((x) => x.display === '합침가')!.id
    let posts = 0
    await page.route(/\/api\/events/, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const body = route.request().postDataJSON() as { type?: string }
      if (body.type !== 'buyer.merge') return route.continue()
      posts += 1
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'PROCESSING_FAILED', message: '처리하지 못했어요. 지금 상태를 확인해 주세요.' } }) })
    })
    await page.goto(`/buyers?date=${date}&rehearsal=true&buyer=${encodeURIComponent(target)}`)
    const detail = page.getByRole('region', { name: '구매자 자세히' })
    await detail.getByRole('button', { name: '다른 구매자와 합치기' }).click()
    const pick = page.getByRole('dialog', { name: '다른 구매자와 합치기' })
    await pick.getByLabel('합칠 구매자 찾기').fill('합침나')
    await pick.getByRole('list', { name: '합칠 구매자' }).getByRole('button').first().click()
    const merge = page.getByRole('dialog', { name: '구매자 합치기' })
    await expect(merge).toBeVisible()
    await page.keyboard.press('1')
    await merge.getByRole('button', { name: '합치기', exact: true }).click()
    await expect(page.getByText('확인 필요').first()).toBeVisible()
    // 저절로 다시 보내지 않는다
    const since = Date.now()
    await untilElapsed(page, since, 2500)
    expect(posts).toBe(1)
  })

  test('정산 환불: 401이면 로그인 화면, 다시 로그인하면 같은 정산 주소', async ({ page }) => {
    await login(page)
    const { date, buyer } = await buyerSetup(page, '세션끝', 'sim_401_8888')
    const url = `/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(buyer)}`
    await page.goto(url)
    await page.route(/\/api\/events/, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: '다시 로그인해 주세요.' } }) })
    })
    const detail = page.getByRole('region', { name: '정산 자세히' })
    await detail.getByRole('button', { name: '할인·추가' }).click()
    const adj = page.getByRole('dialog', { name: '할인·추가' })
    await adj.getByLabel('할인 금액').fill('1000')
    await page.keyboard.press('Tab')
    await adj.getByRole('button', { name: /단골 할인/ }).click()
    await adj.getByRole('button', { name: '할인 적기' }).click()
    await expect(page.getByLabel('아이디')).toBeVisible()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.getByLabel('아이디').fill('e2e-shop')
    await page.getByLabel('비밀번호').fill('e2e-pass-1234')
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page).toHaveURL(new RegExp(`/settlements\\?date=${date}&rehearsal=true&buyer=`))
    await expect(page.getByRole('region', { name: '정산 자세히' })).toBeVisible()
  })
})

test.describe('두 기기 (AC-S06-40)', () => {
  test('휴대폰에서 한 합치기가 PC 구매자 목록에 1초 안에 보인다 (5번)', async ({ page, browser }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    const mobile = await phone(browser)
    try {
      for (let i = 1; i <= 5; i++) {
        await registerApi(page, b, i, `품${String(i)}`, 1000 * i)
        await viewerClaim(page, b, `유튜브${String(i)}`, String(i), `sim_two_${String(i)}000`)
        await smsApi(page, { b, no: i, memo: `문자${String(i)}` })
      }
      await page.goto(`/buyers?date=${date}&rehearsal=true`)
      const pcList = page.getByRole('region', { name: '구매자 목록' })
      await pcList.getByRole('checkbox', { name: '찜 없는 구매자도 보기' }).check()
      for (let i = 1; i <= 5; i++) {
        const view = await scopeView(page, date, true)
        const into = view.buyers.find((x) => x.display === `유튜브${String(i)}`)!.id
        await expect(pcList.getByRole('link', { name: new RegExp(`문자찜\\(문자${String(i)}\\)`) })).toHaveCount(1)
        await mobile.goto(`/buyers?date=${date}&rehearsal=true&buyer=${encodeURIComponent(into)}`)
        const detail = mobile.getByRole('region', { name: '구매자 자세히' })
        await detail.getByRole('button', { name: '다른 구매자와 합치기' }).click()
        const pick = mobile.getByRole('dialog', { name: '다른 구매자와 합치기' })
        await pick.getByLabel('합칠 구매자 찾기').fill(`문자${String(i)}`)
        await pick.getByRole('list', { name: '합칠 구매자' }).getByRole('button').first().click()
        const merge = mobile.getByRole('dialog', { name: '구매자 합치기' })
        await expect(merge).toBeVisible()
        await mobile.keyboard.press('1')
        const sent = Date.now()
        await merge.getByRole('button', { name: '합치기', exact: true }).click()
        await expect(pcList.getByRole('link', { name: new RegExp(`문자찜\\(문자${String(i)}\\)`) })).toHaveCount(0, { timeout: 5000 })
        await expect(mobile.getByText('합쳤어요')).toBeVisible()
        expect(Date.now() - sent, `${String(i)}번째 합치기 PC 반영`).toBeLessThan(1000)
      }
    } finally {
      await mobile.context().close()
    }
  })
})

test.describe('채운 범위 목록 그리기 (AC-S06-20·30, SA-S06-005)', () => {
  test('상품 500·채팅 1만 범위: 구매자·정산 목록이 자료를 받은 뒤 1초 안에 그려지고 1초 넘게 멈추지 않는다 @fill', async ({ page }) => {
    test.setTimeout(120_000)
    await login(page)
    await page.evaluate(() => {
      const w = window as unknown as { __long: number[] }
      w.__long = []
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__long.push(entry.duration)
      }).observe({ type: 'longtask', buffered: true })
    })
    const nav = menu(page)
    for (const [link, listName] of [['구매자', '구매자'], ['정산', '정산 묶음']] as const) {
      const full = page.waitForResponse((r) => /\/api\/days\/\d{4}-\d{2}-\d{2}(\?|$)/.test(new URL(r.url()).pathname + new URL(r.url()).search) && r.request().method() === 'GET' && r.ok())
      await nav.getByRole('link', { name: link, exact: true }).click()
      await full
      const t0 = Date.now()
      await expect(page.getByRole('table', { name: listName, exact: true }).getByRole('link').first()).toBeVisible() // PC는 표 (AC-S06b-21 — 교체)
      const took = Date.now() - t0
      console.log(`${link} 목록 그리기 ${String(took)}ms`)
      expect(took, `${link} 목록 그리기`).toBeLessThan(1000)
    }
    // 찜 없는 구매자도 보기 (채팅만 쓴 시청자 전부)
    await nav.getByRole('link', { name: '구매자', exact: true }).click()
    const all = page.getByRole('checkbox', { name: '찜 없는 구매자도 보기' })
    await expect(all).toBeVisible()
    const t1 = Date.now()
    await all.check()
    await expect(all).toBeChecked()
    await expect(page.getByRole('table', { name: '구매자', exact: true }).getByRole('link').first()).toBeVisible()
    const took = Date.now() - t1
    console.log(`찜 없는 구매자도 보기 ${String(took)}ms`)
    expect(took).toBeLessThan(1000)
    const longest = await page.evaluate(() => Math.max(0, ...(window as unknown as { __long: number[] }).__long))
    console.log(`가장 긴 작업 ${String(longest)}ms`)
    expect(longest, '화면이 1초 넘게 멈췄다').toBeLessThan(1000)
  })
})

test.describe('연타 (같은 입력이 두 번 기록되지 않는다)', () => {
  test('정산 입금: "입금 적기"를 두 번 빨리 눌러도 입금은 한 번 (AC-S06-32)', async ({ page }) => {
    await login(page)
    const { date, buyer } = await buyerSetup(page, '연타입', 'sim_dbl_1212')
    await page.goto(`/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(buyer)}`)
    const detail = page.getByRole('region', { name: '정산 자세히' })
    await detail.getByRole('button', { name: '입금 적기' }).click()
    const pay = page.getByRole('dialog', { name: '입금 적기' })
    await expect(pay.getByLabel('입금 금액')).toHaveValue('14000')
    await pay.getByRole('button', { name: '입금 적기' }).dblclick()
    await expect(detail).toContainText('입금 완료')
    await expect.poll(async () => (await scopeView(page, date, true)).settlements[0]!.received).toBe(14000)
    expect((await history(page, date, true)).filter((e) => e.type === 'settlement.payment')).toHaveLength(1)
  })

  test('정산 환불: "환불 적기"를 두 번 빨리 눌러도 환불은 한 번 (AC-S06-35)', async ({ page }) => {
    await login(page)
    const { date, buyer } = await buyerSetup(page, '연타환', 'sim_dbl_1313')
    const scope = { date, rehearsal: true }
    expect((await writeEvent(page, { type: 'settlement.payment', buyer, date, amount: 28000 }, scope)).status).toBeLessThan(300)
    await page.goto(`/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(buyer)}`)
    const detail = page.getByRole('region', { name: '정산 자세히' })
    await expect(detail).toContainText('과입금(환불 필요 14,000원)')
    await detail.getByRole('button', { name: '환불 적기' }).click()
    const refund = page.getByRole('dialog', { name: '환불 적기' })
    await expect(refund.getByLabel('환불 금액')).toHaveValue('14000')
    await refund.getByRole('button', { name: '1 환불함' }).click()
    await refund.getByRole('button', { name: '환불 적기' }).dblclick()
    await expect(detail.getByText('입금 완료').first()).toBeVisible()
    await expect.poll(async () => (await history(page, date, true)).filter((e) => e.type === 'settlement.refund').length).toBeGreaterThan(0)
    expect((await history(page, date, true)).filter((e) => e.type === 'settlement.refund')).toHaveLength(1)
    expect((await scopeView(page, date, true)).settlements[0]!.received).toBe(14000)
  })

  test('문자찜: 번호 칸에서 Enter를 두 번 빨리 눌러도 문자찜은 한 번 (AC-S06-14)', async ({ page }) => {
    await login(page)
    const title = uniq('연타문')
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true, title })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await openSms(page, title)
    await smsField(page, '번호').fill('15')
    await smsField(page, '메모').fill('연타')
    await smsField(page, '번호').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: '넣은 결과' })).toContainText('15번')
    await expect.poll(async () => (await history(page, date, true)).filter((e) => e.type === 'sms').length).toBeGreaterThan(0)
    const view = await scopeView(page, date, true)
    expect(view.claims.filter((c) => c.origin === 'sms')).toHaveLength(1)
    expect((await history(page, date, true)).filter((e) => e.type === 'sms')).toHaveLength(1)
  })

  test('문자찜: 보내기 버튼을 두 번 빨리 눌러도 문자찜은 한 번 (AC-S06-14)', async ({ page }) => {
    await login(page)
    const title = uniq('연타버')
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true, title })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await openSms(page, title)
    await smsField(page, '번호').fill('15')
    await smsField(page, '메모').fill('연타')
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).dblclick()
    await expect(page.getByRole('region', { name: '넣은 결과' })).toContainText('15번')
    await expect.poll(async () => (await history(page, date, true)).filter((e) => e.type === 'sms').length).toBeGreaterThan(0)
    expect((await history(page, date, true)).filter((e) => e.type === 'sms')).toHaveLength(1)
  })
})

test.describe('새 화면의 다시 받기 실패 안내 (AC-S06-41·61)', () => {
  test('375×812 문자찜 입력: 410 뒤 전체 다시 받기가 실패하면 안내가 고정 영역에 있어 끝까지 내려도 보이고, 회복되면 사라진다', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await login(page)
    const title = uniq('안내')
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true, title })
    for (let i = 1; i <= 10; i++) await registerApi(page, b, i, `품${String(i)}`, 1000)
    await openSms(page, title)
    for (let i = 1; i <= 10; i++) await smsApi(page, { b, no: i, memo: `안내${String(i)}` })
    await expect(page.getByRole('region', { name: '최근 넣은 문자찜' })).toContainText('안내10')
    let broken = true
    await page.route(/\/api\/days\/[^/]+\/changes/, async (route) => {
      if (broken) return route.fulfill({ status: 410, contentType: 'application/json', body: JSON.stringify({ error: { code: 'RESYNC_REQUIRED', message: '처음부터 다시 받아 주세요.' } }) })
      return route.continue()
    })
    await page.route(new RegExp(`/api/days/${date}\\?`), async (route) => {
      if (broken) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버 오류' } }) })
      return route.continue()
    })
    await smsApi(page, { b, no: 1, memo: '깨움' })
    const notice = page.getByText('화면을 최신으로 맞추지 못했어요. 다시 시도하는 중이에요.')
    await expect(notice).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(notice).toBeInViewport()
    await expect(page.getByRole('button', { name: '지금 다시 불러오기' })).toBeInViewport()
    broken = false
    await expect(notice).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByRole('region', { name: '최근 넣은 문자찜' })).toContainText('깨움')
  })
})

test.describe('콘솔 뒤로 가기 (RA-S06-001)', () => {
  test('콘솔에서 찜 취소 대기 중 브라우저 뒤로 가기(방송 목록) → 묻고, "보내지 않고 떠나기"면 취소가 기록되지 않고 방송 목록이 보인다', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const title = uniq('콘뒤')
    const b = await openNewBroadcast(page, { date, rehearsal: true, title })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await viewerClaim(page, b, '홍길동', '15', 'sim_cback_9191')
    // 앱 안에서 방송 목록 → 콘솔 (같은 문서의 기록)
    await menu(page).getByRole('link', { name: '방송', exact: true }).click()
    await page.getByRole('list', { name: '방송' }).getByRole('link', { name: new RegExp(title) }).click()
    const item = page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^15번 / })
    await expect(item).toContainText('홍길동')
    await item.click()
    await page.getByRole('dialog', { name: '15번 자세히' }).getByRole('button', { name: '찜 취소하기' }).first().click()
    await page.keyboard.press('1')
    await page.keyboard.press('Enter')
    const since = Date.now()
    await page.goBack()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: '보내지 않고 떠나기' }).click()
    await expect(page.getByRole('list', { name: '방송' })).toBeVisible()
    await expect(page).not.toHaveURL(/\/broadcasts\//)
    await untilElapsed(page, since, 4000)
    expect((await history(page, date, true)).filter((e) => e.type === 'host.cancel')).toHaveLength(0)
  })
})
