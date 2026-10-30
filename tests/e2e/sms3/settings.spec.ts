// 설정 "휴대폰 알림 받기" (AC-SMS3-28, ORD-13 C-02·받기 상태, AC-SMS3-05의 화면 몫) — PC와 375px.
// 토큰은 한 번만 보이고 "복사하기", "다시 만들기"는 확인 창("전에 쓰던 휴대폰·단축어는 더 이상 보내지 못해요") 뒤 옛 토큰 401,
// "끄기" 뒤 그 토큰은 403 INBOX_OFF·다시 켜면 같은 토큰(D-SMS3-27), 마지막으로 받은 시각·기기 이름(이스케이프), 아이폰 단축어 만들기 안내.
import { test, expect } from '@playwright/test'
import { claimsOf, expectNoDevWords, fakeDevice, heightOf, inboxSection, kstToday, makeTokenOnScreen, onSale, realBroadcast, sellerAt, type Width } from './support.ts'

for (const width of ['PC', '375'] as const satisfies readonly Width[]) {
  test(`AC-SMS3-28 (${width}): 토큰 한 번 보이기 → 다시 만들기 확인 창 → 옛 토큰 401 → 끄기 403 → 다시 켜기 같은 토큰`, async ({ browser, baseURL }) => {
    test.setTimeout(120_000)
    const { page, context } = await sellerAt(browser, baseURL!, width)
    await page.goto('/settings/inbox')
    const section = inboxSection(page)
    await expect(section).toBeVisible()
    await expect(section.getByRole('textbox', { name: '받기 토큰' })).toHaveCount(0)
    await expectNoDevWords(section, '꺼진 설정 칸')

    // 1. 켜고 토큰 만들기 → 한 번 보이고 "복사하기"
    const t1 = await makeTokenOnScreen(page)
    await expect(section.getByRole('button', { name: '복사하기' })).toBeVisible()
    await expect(section).toContainText('한 번만')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await section.getByRole('button', { name: '복사하기' }).click()
    await expect(section.getByRole('status').filter({ hasText: /복사/ })).toBeVisible()
    if (width === '375') expect(await heightOf(section.getByRole('button', { name: '복사하기' }))).toBeGreaterThanOrEqual(44)
    await expectNoDevWords(section, '토큰을 만든 설정 칸')
    // 저장소·주소에 토큰 원문이 남지 않는다 (C-07)
    const stored = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, u: location.href }))
    expect(stored).not.toContain(t1)

    const device = await fakeDevice(baseURL!, t1, '<b>김사장</b> 갤럭시')
    const ok1 = await device.send([])
    expect(ok1.status, JSON.stringify(ok1.body)).toBe(200)
    expect(Object.keys(ok1.body).sort()).toEqual(['filters', 'results'])

    // 마지막으로 받은 시각·기기 이름 (이스케이프 — 글 그대로)
    await device.sms('010-2222-3333', '안녕하세요', 'IGNORED')
    await expect(section).toContainText('<b>김사장</b> 갤럭시')
    await expect(section.locator('b', { hasText: '김사장' })).toHaveCount(0)
    await expect(section).toContainText('마지막으로 받은 시각')

    // 2. 다시 오면 토큰은 보이지 않는다 (한 번만)
    await page.reload()
    await expect(inboxSection(page)).toBeVisible()
    await expect(inboxSection(page).getByRole('textbox', { name: '받기 토큰' })).toHaveCount(0)
    await expect(inboxSection(page)).toContainText('켜져 있어요')
    await expect(inboxSection(page)).toContainText('<b>김사장</b> 갤럭시')

    // 3. 다시 만들기 — 확인 창 문구, "그대로 두기"면 그대로
    await inboxSection(page).getByRole('button', { name: '토큰 다시 만들기' }).click()
    let dlg = page.getByRole('dialog', { name: '토큰을 다시 만들까요?' })
    await expect(dlg).toContainText('전에 쓰던 휴대폰·단축어는 더 이상 보내지 못해요')
    await dlg.getByRole('button', { name: '그대로 두기' }).click()
    await expect(dlg).toHaveCount(0)
    expect((await device.send([])).status, '그대로 두면 옛 토큰이 그대로 통한다').toBe(200)
    await inboxSection(page).getByRole('button', { name: '토큰 다시 만들기' }).click()
    dlg = page.getByRole('dialog', { name: '토큰을 다시 만들까요?' })
    await dlg.getByRole('button', { name: '새로 만들기' }).click()
    await expect(dlg).toHaveCount(0)
    const box = inboxSection(page).getByRole('textbox', { name: '받기 토큰' })
    await expect(box).toBeVisible()
    const t2 = await box.inputValue()
    expect(t2).not.toBe(t1)
    const old = await device.send([])
    expect(old.status, '다시 만든 뒤 옛 토큰은 401').toBe(401)
    expect((old.body['error'] as { code?: string } | undefined)?.code).toBe('TOKEN_INVALID')
    expect((await device.send([], { token: t2 })).status).toBe(200)

    // 4. 끄기 → 확인 창 → 403 INBOX_OFF → 다시 켜기 → 넣어 둔 같은 토큰으로 다시 받는다 (D-SMS3-27)
    await inboxSection(page).getByRole('button', { name: '끄기' }).click()
    dlg = page.getByRole('dialog', { name: '휴대폰 알림 받기를 끌까요?' })
    await dlg.getByRole('button', { name: '끌게요' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(inboxSection(page)).toContainText('꺼져 있어요')
    await expect(inboxSection(page).getByRole('textbox', { name: '받기 토큰' }), '끄면 보이던 토큰도 감춘다').toHaveCount(0)
    // D-SMS3-27: 끈 뒤에는 403 INBOX_OFF(토큰은 그대로 — 401은 토큰이 없거나 틀리거나 무효일 때만). 판정 순서 401 → 403
    const off = await device.send([], { token: t2 })
    expect(off.status, '끈 뒤 403').toBe(403)
    expect((off.body['error'] as { code?: string } | undefined)?.code).toBe('INBOX_OFF')
    expect(off.body['filters'], '꺼진 동안 filters를 주지 않는다').toBeUndefined()
    const offOld = await device.send([], { token: t1 })
    expect(offOld.status, '꺼져 있어도 옛 토큰은 401 (401 → 403 순서)').toBe(401)
    await expectNoDevWords(inboxSection(page), '끈 설정 칸')
    await inboxSection(page).getByRole('button', { name: '다시 켜기' }).click()
    await expect(inboxSection(page)).toContainText('켜져 있어요')
    expect((await device.send([], { token: t2 })).status, '다시 켜면 넣어 둔 토큰으로').toBe(200)

    // 5. 아이폰 단축어 만들기 안내 (접는 칸)
    const guide = inboxSection(page).getByRole('button', { name: '아이폰 단축어 만들기 안내' })
    await guide.click()
    await expect(inboxSection(page)).toContainText('/api/inbox/messages')
    await device.dispose()
    await context.close()
  })
}

test('AC-SMS3-05 화면 몫: 토큰 없이·엉터리·남의 판매자 토큰 — 401이거나 그 판매자 것으로만', async ({ browser, baseURL }) => {
  const a = await sellerAt(browser, baseURL!, 'PC')
  const ta = await makeTokenOnScreen(a.page)
  const dev = await fakeDevice(baseURL!, ta)
  const none = await dev.send([], { token: null })
  expect(none.status).toBe(401)
  expect((none.body['error'] as { code?: string } | undefined)?.code).toBe('TOKEN_INVALID')
  expect((await dev.send([], { token: 'garbage-token' })).status).toBe(401)
  expect((await dev.send([], { token: `${ta}x` })).status).toBe(401)
  // 응답에 토큰이 되돌아오지 않는다
  const fine = await dev.send([])
  expect(JSON.stringify(fine.body)).not.toContain(ta)
  // 받기 토큰으로 다른 API를 부를 수 없다
  const ctx = await (await import('@playwright/test')).request.newContext({ baseURL: baseURL! })
  const other = await ctx.get('/api/broadcasts', { headers: { authorization: `Bearer ${ta}` } })
  expect(other.status()).toBe(401)
  await ctx.dispose()
  // 판매자 B의 토큰은 B의 것으로만 — A의 방송에 아무것도 없다
  const bRealDate = kstToday()
  const ab = await realBroadcast(a.page)
  await onSale(a.page, ab, 15, '핑크프릴', 10_000)
  const bs = await sellerAt(browser, baseURL!, 'PC')
  const tb = await makeTokenOnScreen(bs.page)
  const devB = await fakeDevice(baseURL!, tb)
  await devB.sms('010-4444-5555', '15', 'IGNORED')
  expect(await claimsOf(a.page, bRealDate, 15)).toHaveLength(0)
  // A의 토큰으로는 A의 방송에 들어간다
  await dev.sms('010-4444-5555', '15')
  await expect.poll(async () => (await claimsOf(a.page, bRealDate, 15)).length).toBe(1)
  await devB.dispose()
  await bs.context.close()
  await dev.dispose()
  await a.context.close()
})
