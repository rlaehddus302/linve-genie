// AC-I1-70 (프린트 스테이션 30장 연속 + 12번째 끊김), AC-I1-15 (실시간), AC-I1-23 (다른 기기 표시)
import { expect, test } from '@playwright/test'
import { becomeDevice, boardItem, cleanupPrint, history, login, printOverview, printed, realBroadcast, region, registerApi, scopeLabels, setBehavior, smsApi, uniqueDate, waitPrinted } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

test('AC-I1-70: 휴대폰 출력 기기 30장 — 12번째 끊김 → 두 기기 멈춤 → 다시 연결 → 정확히 30장·판정 순서·보고 30', async ({ page, browser }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)

  const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin, isMobile: true, hasTouch: true })
  const phone = await phoneCtx.newPage()
  try {
    await login(phone)
    await becomeDevice(phone, '휴대폰')
    await setBehavior(phone, 12, 'disconnect')

    // PC: 다른 기기 표시
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '라벨' }).click()
    await expect(region(page, '프린터')).toContainText('출력 기기: 휴대폰 · 연결됨')
    await page.goBack()
    await expect(page.getByLabel('빠른 입력')).toBeVisible()

    for (let no = 1; no <= 30; no += 1) await registerApi(page, b, no, `품종${String(no)}`, 1000 * no)
    for (let no = 1; no <= 30; no += 1) await smsApi(page, { b, no, phone: `010-5555-${String(1000 + no)}` })

    // 12번째에서 끊김 → 끊김 멈춤
    const paused = '프린터 연결이 끊겼어요.'
    await expect(page.getByRole('region', { name: '알림' })).toContainText(`출력 멈춤 · ${paused}`, { timeout: 60_000 })
    const pauseBand = region(phone, '출력 멈춤')
    await expect(pauseBand).toContainText(paused, { timeout: 1_000 })
    expect(await printed(phone)).toHaveLength(11)
    const ov = await printOverview(page)
    expect(ov.queue.pause?.reason).toBe('DISCONNECTED')
    expect(ov.jobs[0]!.label.no).toBe(12)
    expect(ov.jobs[0]!.status).toBe('WAITING')
    expect(ov.jobs[0]!.attempts).toBe(1)
    expect(ov.jobs[0]!.lastError?.code).toBe('DISCONNECTED')

    await pauseBand.getByRole('button', { name: '다시 연결' }).click()
    await waitPrinted(phone, 30, 90_000)
    await expect.poll(async () => (await printOverview(page)).queue.waiting).toBe(0)

    // 판정 순서·라벨 키 하나씩
    const labels = await scopeLabels(page, date)
    const product = labels.filter((l) => l.no >= 1 && l.no <= 30 && l.winner)
    expect(product).toHaveLength(30)
    for (const l of product) {
      expect(l.printed, `${String(l.no)}번`).toBe(1)
      expect(l.word).toBe('라벨 출력됨')
      expect(l.history.map((h) => h.device)).toEqual(['휴대폰'])
    }
    const order = [...product].sort((x, y) => Date.parse(x.history[0]!.at) - Date.parse(y.history[0]!.at)).map((l) => l.no)
    expect(order).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
    const images = await printed(phone)
    expect(images).toHaveLength(30)
    expect(new Set(images.map((x) => x.data.join(','))).size).toBe(30)

    for (const no of [1, 12, 30]) await expect(boardItem(page, no)).toContainText('라벨 출력됨')
    const events = await history(page, date, false)
    expect(events.filter((e) => e.type === 'effect.labelPrinted')).toHaveLength(30)
  } finally {
    await phoneCtx.close()
  }
})
