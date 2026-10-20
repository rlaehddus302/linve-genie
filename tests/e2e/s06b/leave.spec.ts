// 대기 조치와 떠나기 (AC-S06b-42·43, UX-06, D-083, D-103), 휴대폰 조치 기록 (AC-S06b-41), 날짜는 연도·요일까지 (AC-S06b-22) — test-e2e.
// E2E 기동의 방송자 조치 대기 = 2초(E2E_HOST_DELAY_MS 기본). "보내지 않음"은 대기 시간이 지난 뒤 이력으로 확인한다.
import { test, expect, type Page } from '@playwright/test'
import { boardItem, dateLongKo, history, login, menu, openNewBroadcast, registerApi, uniq, uniqueDate, untilElapsed, viewerClaim, writeEvent } from './support.ts'

const DELAY = Number(process.env['E2E_HOST_DELAY_MS'] ?? '2000')

async function consoleWithClaim(page: Page): Promise<{ b: string; date: string }> {
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await viewerClaim(page, b, '홍길동', '15', uniq('sim_leave_'))
  await expect(boardItem(page, 15)).toContainText('홍길동')
  return { b, date }
}

/** 15번 1등 찜 취소를 넣는다 (대기 시작) */
async function queueCancel(page: Page): Promise<number> {
  await boardItem(page, 15).click()
  const detail = page.getByRole('dialog', { name: '15번 자세히' })
  await detail.getByRole('button', { name: '찜 취소하기' }).first().click()
  await page.keyboard.press('1')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: '보내기 전 조치' }).getByText(/초 뒤 보내요/)).toBeVisible()
  const since = Date.now()
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  return since
}

const cancels = async (page: Page, date: string) => (await history(page, date, true)).filter((e) => e.type === 'host.cancel').length

test.describe('떠나기 창을 닫으면 다시 전체 대기 (AC-S06b-42)', () => {
  test('창을 대기 시간보다 오래 연 뒤 "닫기" → 그때부터 대기 시간 전체를 다시 기다린 뒤 한 번 보낸다, 띠는 처음 값부터', async ({ page }) => {
    await login(page)
    const { date } = await consoleWithClaim(page)
    await queueCancel(page)
    await menu(page).getByRole('link', { name: '구매자', exact: true }).click()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toBeVisible()
    const opened = Date.now()
    await untilElapsed(page, opened, DELAY + 1500)
    expect(await cancels(page, date)).toBe(0) // 창이 열린 동안 보내지 않는다
    await ask.getByRole('button', { name: '닫기' }).click()
    const closed = Date.now()
    await expect(page.getByRole('region', { name: '보내기 전 조치' })).toContainText(`${String(Math.round(DELAY / 1000))}초 뒤 보내요`)
    await untilElapsed(page, closed, DELAY - 700)
    expect(await cancels(page, date), '닫은 뒤 대기 시간이 지나기 전에 보냈다').toBe(0)
    await expect.poll(async () => await cancels(page, date), { timeout: 10_000 }).toBe(1)
    await untilElapsed(page, closed, DELAY + 1500)
    expect(await cancels(page, date)).toBe(1)
  })

  test('닫은 뒤 다시 기다리는 동안 되돌리면 보내지 않는다', async ({ page }) => {
    await login(page)
    const { date } = await consoleWithClaim(page)
    await queueCancel(page)
    await menu(page).getByRole('link', { name: '정산', exact: true }).click()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await untilElapsed(page, Date.now(), DELAY + 500)
    await ask.getByRole('button', { name: '닫기' }).click()
    const closed = Date.now()
    await page.getByRole('region', { name: '보내기 전 조치' }).getByRole('button', { name: /되돌리기/ }).first().click()
    await untilElapsed(page, closed, DELAY + 1500)
    expect(await cancels(page, date)).toBe(0)
  })
})

test.describe('처음 연 화면의 뒤로 가기·새로고침·닫기 (AC-S06b-43)', () => {
  test('주소로 바로 연 콘솔 → 조치 → 뒤로 가기: 앱을 떠나지 않고 묻는다 → 닫기 → 다시 뒤로 → 묻는다 → 보내지 않고 떠나기 → 보내지 않음', async ({ page }) => {
    await login(page)
    const { b, date } = await consoleWithClaim(page)
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(boardItem(page, 15)).toContainText('홍길동')
    await queueCancel(page)
    await page.goBack()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(`/broadcasts/${encodeURIComponent(b)}`)
    await ask.getByRole('button', { name: '닫기' }).click()
    await expect(ask).toHaveCount(0)
    await page.goBack()
    await expect(ask).toBeVisible()
    const since = Date.now()
    await ask.getByRole('button', { name: '보내지 않고 떠나기' }).click()
    await expect(page).not.toHaveURL(new RegExp(`/broadcasts/${encodeURIComponent(b)}$`))
    await untilElapsed(page, since, DELAY + 2000)
    expect(await cancels(page, date)).toBe(0)
  })

  test('보내기 전인 조치가 있으면 beforeunload가 preventDefault와 returnValue(빈 글자 아님)를 함께 한다', async ({ page }) => {
    await login(page)
    const { date } = await consoleWithClaim(page)
    await queueCancel(page)
    await page.evaluate(() => {
      window.addEventListener('beforeunload', (event) => {
        const w = window as unknown as { __bu: unknown }
        w.__bu = { prevented: event.defaultPrevented, value: event.returnValue }
      })
    })
    page.once('dialog', (dialog) => {
      expect(dialog.type()).toBe('beforeunload')
      void dialog.dismiss()
    })
    await page.close({ runBeforeUnload: true })
    // dismiss면 남는다 — 같은 창에서 값을 본다
    await expect.poll(async () => await page.evaluate(() => (window as unknown as { __bu?: unknown }).__bu ?? null)).not.toBeNull()
    const bu = await page.evaluate(() => (window as unknown as { __bu: { prevented: boolean; value: unknown } }).__bu)
    expect(bu.prevented).toBe(true)
    expect(typeof bu.value === 'string' ? bu.value.length : 0).toBeGreaterThan(0)
    expect(await cancels(page, date)).toBe(0)
  })

  test('막을 수 없는 닫기(탭을 그냥 닫음)로 떠나면 보내기 전인 조치는 보내지 않는다', async ({ page, browser }) => {
    await login(page)
    const { date } = await consoleWithClaim(page)
    const other = await browser.newContext({ baseURL: new URL(page.url()).origin })
    const p2 = await other.newPage()
    try {
      await login(p2)
      await p2.goto(new URL(page.url()).pathname)
      await expect(boardItem(p2, 15)).toContainText('홍길동')
      await queueCancel(p2)
      const since = Date.now()
      await p2.close()
      await untilElapsed(page, since, DELAY + 2000)
      expect(await cancels(page, date)).toBe(0)
    } finally {
      await other.close()
    }
  })
})

test.describe('처음 연 화면 — 다른 화면 (AC-S06b-43)', () => {
  test('휴대폰: 주소로 바로 연 구매자 자세히 → 차단(대기) → 뒤로 가기는 묻는다 → 닫기 → 대기 전체 뒤 한 번 보냄 → 그 뒤 뒤로 가기는 묻지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    const ch = uniq('sim_blk_')
    await viewerClaim(page, b, '장난꾸러기', '15', ch)
    await page.goto(`/buyers?date=${date}&rehearsal=true&buyer=${encodeURIComponent(ch)}`)
    const detail = page.getByRole('region', { name: '구매자 자세히' })
    await detail.getByRole('button', { name: '차단하기' }).click()
    const dlg = page.getByRole('dialog').last()
    await dlg.getByRole('button', { name: /^1 / }).click()
    await dlg.getByRole('button', { name: '차단하기' }).click()
    await expect(dlg).toHaveCount(0)
    await page.goBack()
    const ask = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(ask).toBeVisible()
    await expect(detail).toBeVisible()
    await ask.getByRole('button', { name: '닫기' }).click()
    const closed = Date.now()
    const blocks = async () => (await history(page, date, true)).filter((e) => e.type === 'host.blockBuyer').length
    await untilElapsed(page, closed, DELAY - 700)
    expect(await blocks()).toBe(0)
    await expect.poll(blocks, { timeout: 10_000 }).toBe(1)
    await expect(page.getByRole('region', { name: '보내기 전 조치' }).getByText(/초 뒤 보내요/)).toHaveCount(0)
    // 보낼 것이 없으면 뒤로 가기는 묻지 않는다 (더 쌓은 기록 때문에 한 번 더 눌러야 할 수는 있다)
    await page.goBack()
    await expect(ask).toHaveCount(0)
  })
})

test.describe('휴대폰 조치 기록 (AC-S06b-41)', () => {
  test('375×812: 기록마다 한 묶음, 시각은 잘리지 않고 한 줄, 낱말이 중간에서 줄을 바꾸지 않음, 가로 스크롤 없음 — PC는 표', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    const ch = uniq('sim_log_')
    await viewerClaim(page, b, '홍길동', '15', ch)
    await expect(boardItem(page, 15)).toContainText('홍길동')
    const long = '시청자가 방송 중에 번호를 잘못 말해서 다시 확인한 뒤 판매자에게 취소를 요청했어요 입금확인완료뒤재요청'
    expect((await writeEvent(page, { type: 'host.cancel', b, no: 15, buyer: ch, reason: long })).status).toBeLessThan(300)
    expect((await writeEvent(page, { type: 'product.renumber', b, from: 15, to: 16 })).status).toBeLessThan(300)
    await expect(boardItem(page, 16)).toBeVisible()
    // PC: 표 그대로
    await boardItem(page, 16).click()
    let log = page.getByRole('dialog', { name: '16번 자세히' }).getByRole('region', { name: '조치 기록' })
    await expect(log.getByRole('table')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 375, height: 812 })
    await boardItem(page, 16).click()
    const dlg = page.getByRole('dialog', { name: '16번 자세히' })
    log = dlg.getByRole('region', { name: '조치 기록' })
    await expect(log.getByRole('table')).toHaveCount(0)
    const entries = log.locator('ol.history-list > li.history-entry')
    await expect(entries.filter({ hasText: '15번 → 16번' })).toHaveCount(1)
    await expect(entries.filter({ hasText: long })).toHaveCount(1)
    await log.scrollIntoViewIfNeeded()
    const report = await entries.evaluateAll((els) => els.map((li) => {
      const time = li.querySelector<HTMLElement>('span.history-time')
      const timeRect = time?.getBoundingClientRect()
      const lineHeight = time === null ? 0 : parseFloat(getComputedStyle(time).lineHeight) || 24
      // 낱말마다 줄이 바뀌면 그 낱말의 사각형이 둘 이상
      const split: string[] = []
      const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent ?? ''
        const re = /\S+/g
        for (let m = re.exec(text); m !== null; m = re.exec(text)) {
          const range = document.createRange()
          range.setStart(node, m.index)
          range.setEnd(node, m.index + m[0].length)
          const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
          if (tops.size > 1) split.push(m[0])
        }
      }
      return {
        time: time?.textContent ?? null,
        timeLines: timeRect === undefined ? 0 : Math.round(timeRect.height / lineHeight),
        split,
        overflow: li.scrollWidth > li.clientWidth + 1,
      }
    }))
    for (const r of report) {
      expect(r.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
      expect(r.timeLines, `시각 ${String(r.time)}`).toBeLessThanOrEqual(1)
      expect(r.split, '중간에서 줄이 바뀐 낱말').toEqual([])
      expect(r.overflow).toBe(false)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    expect(await dlg.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  })
})

test.describe('날짜는 연도·요일까지 (AC-S06b-22)', () => {
  test('해를 넘긴 같은 날짜 두 리허설 범위가 날짜 고르기에서 다른 글자 "YYYY년 10월 18일(요일) 리허설"', async ({ page }) => {
    await login(page)
    const year = 2200 + Math.floor(Math.random() * 600)
    const d1 = `${String(year)}-10-18`
    const d2 = `${String(year + 1)}-10-18`
    for (const date of [d1, d2]) {
      const b = await openNewBroadcast(page, { date, rehearsal: true, title: uniq('해') })
      await registerApi(page, b, 1, '가', 1000)
      await viewerClaim(page, b, '해손님', '1', uniq('sim_year_'))
    }
    for (const path of ['buyers', 'settlements']) {
      await page.goto(`/${path}?date=${d1}&rehearsal=true`)
      const select = page.getByLabel('날짜', { exact: true })
      await expect(select.locator('option:checked')).toHaveText(`${dateLongKo(d1)} 리허설`)
      const texts = await select.locator('option').allInnerTexts()
      expect(texts).toContain(`${dateLongKo(d1)} 리허설`)
      expect(texts).toContain(`${dateLongKo(d2)} 리허설`)
      expect(dateLongKo(d1)).not.toBe(dateLongKo(d2))
    }
  })
})
