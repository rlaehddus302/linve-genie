// V1 흐름 깨뜨리기 — 두 기기·연결 끊김·응답 잃음·Enter·빠른 연속 문장 (test-e2e).
// 기대값은 acceptance(AC-V1-10 같은 요청 번호, AC-V1-22 보내지 못함, D-V1-06)와 dev-notes "정한 것"에서 정했다.
import { test, expect } from '@playwright/test'
import {
  board,
  boardItem,
  history,
  installSmsSpeech,
  login,
  recordRequests,
  registerApi,
  scopeView,
  setupLive,
  setupPaused,
  smsButton,
  smsCard,
  smsEvents,
  smsResults,
  smsWrites,
  speak,
  turnOnVoice,
} from './support.ts'

const C165 = '165번 · 끝자리 1234 · 문자찜'

test.describe('V1 깨뜨리기', () => {
  test('두 기기(PC + 휴대폰 375px)가 같은 방송에서 같은 말을 듣고 둘 다 넣어도 끝자리 1234 손님의 찜은 하나, 휴대폰 보드에 1등 반영', async ({ browser }) => {
    const pcCtx = await browser.newContext()
    const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
    const pc = await pcCtx.newPage()
    const phone = await phoneCtx.newPage()
    try {
      const { b, date } = await setupLive(pc)
      await registerApi(pc, b, 165, '핑크프릴', 10000)
      await installSmsSpeech(phone)
      await login(phone)
      await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(boardItem(phone, 165)).toBeVisible()
      await turnOnVoice(phone)
      await speak(pc, '165번 문자찜 끝자리 1234')
      await speak(phone, '165번 문자찜 끝자리 1234')
      await smsButton(pc, C165, '지금 넣기').click()
      await expect(smsResults(pc, C165)).toHaveText(/^165번 · 문자찜 · 1등 · /)
      await expect(boardItem(phone, 165)).toContainText(/1등|문자찜/)
      await smsButton(phone, C165, '지금 넣기').click()
      await expect(smsResults(phone, C165)).toHaveText('165번 · 이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등) · 뒤 4자리 1234')
      const view = await scopeView(pc, date, false)
      expect(view.claims.filter((x) => x.no === 165)).toHaveLength(1)
      expect(view.buyers.filter((x) => x.kind === 'sms')).toHaveLength(1)
      expect(await smsEvents(pc, date, false)).toHaveLength(2)
    } finally {
      await pcCtx.close()
      await phoneCtx.close()
    }
  })

  test('연결이 끊긴 채 기다림이 끝남 → 넣지 못함 안내·저절로 다시 안 보냄 → 연결 뒤 "넣기"는 같은 요청 번호로 한 번', async ({ page, context }) => {
    const { b, date } = await setupLive(page)
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    await expect(smsCard(page, C165).getByText(/초 뒤 넣어요$/)).toBeVisible()
    await context.setOffline(true)
    const card = smsCard(page, C165)
    await expect(card.getByRole('alert')).toBeVisible({ timeout: 15_000 })
    await expect(card.getByRole('button')).toHaveText(['넣기', '넣지 않기'])
    const tried = smsWrites(requests).length
    expect(tried).toBeGreaterThanOrEqual(1)
    await context.setOffline(false)
    // 저절로 다시 보내지 않는다 (보내지 못함은 손댄 카드)
    await expect(card.getByText(/초 뒤 넣어요$/)).toHaveCount(0)
    expect(smsWrites(requests)).toHaveLength(tried)
    await smsButton(page, C165, '넣기').click()
    await expect(smsResults(page, C165)).toHaveText(/^165번 · 문자찜 · 1등 · /)
    const writes = smsWrites(requests)
    expect(new Set(writes.map((w) => w['requestId'])).size).toBe(1)
    expect(await smsEvents(page, date, false)).toHaveLength(1)
  })

  test('서버는 받았는데 응답을 잃음 → 다시 "넣기"는 같은 요청 번호 → 찜·이벤트 하나', async ({ page }) => {
    const { b, date } = await setupLive(page)
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    let lost = 0
    await page.route('**/api/events', async (route) => {
      const body = route.request().postData() ?? ''
      if (lost === 0 && body.includes('"sms"')) {
        lost++
        await route.fetch()
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    await smsButton(page, C165, '지금 넣기').click()
    // 화면이 저절로 같은 요청 번호로 다시 보내거나(일시적 오류), 안내를 띄우고 "넣기"를 기다린다 — 어느 쪽이든 찜은 하나
    const alert = smsCard(page, C165).getByRole('alert')
    await expect(alert.or(smsResults(page, C165))).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await smsEvents(page, date, false)).length).toBe(1)
    if (await alert.isVisible()) await smsButton(page, C165, '넣기').click()
    await expect(smsResults(page, C165)).toHaveText(/^165번 · 문자찜 · 1등 · /)
    const writes = smsWrites(requests)
    expect(writes.length).toBeGreaterThanOrEqual(2)
    expect(new Set(writes.map((w) => w['requestId'])).size).toBe(1)
    expect(await smsEvents(page, date, false)).toHaveLength(1)
    expect((await scopeView(page, date, false)).claims).toHaveLength(1)
  })

  test('기다리는 문자찜 카드가 있을 때 빠른 입력의 Enter는 문자찜을 넣지 않는다(상품 등록만)', async ({ page }) => {
    const { b, date } = await setupPaused(page)
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    await expect(smsCard(page, C165)).toBeVisible()
    const input = page.getByLabel('빠른 입력')
    await input.focus()
    await input.press('Enter')
    await input.fill('20 라울 10')
    await input.press('Enter')
    await expect(boardItem(page, 20)).toBeVisible()
    expect(smsWrites(requests)).toEqual([])
    await expect(smsCard(page, C165).getByText(/초 뒤 넣어요$/)).toBeVisible()
    await page.clock.runFor(3000)
    await expect(smsResults(page, C165)).toHaveText(/^165번 · 문자찜 · 1등 · /)
    expect((await history(page, date, false)).filter((e) => e.type === 'sms')).toHaveLength(1)
    await expect(board(page)).toBeVisible()
  })

  test('빠른 연속 문장(기다림 10초) — 같은 카드를 두 번 넣지 않고, 넣은 것은 모두 서버에 하나씩', async ({ page }) => {
    const { b, date } = await setupPaused(page, { smsSettings: { 'voice.smsListen': true, 'voice.smsAutoSec': 10 } })
    for (const no of [165, 166, 167, 168]) await registerApi(page, b, no, '핑크프릴', 10000)
    await expect(boardItem(page, 168)).toBeVisible()
    const requests = recordRequests(page)
    const said = [['165', '1111'], ['166', '2222'], ['167', '3333'], ['168', '4444']] as const
    for (const [no, last4] of said) {
      await speak(page, `${no}번 문자찜 끝자리 ${last4}`)
      await page.clock.runFor(1000)
    }
    await page.clock.runFor(15_000)
    await expect.poll(() => smsWrites(requests).length).toBeGreaterThan(0)
    // 열린 카드 수 규칙(D-I4-02)으로 손대지 않은 가장 오래된 카드가 닫힐 수 있다 — 닫힌 것은 넣지 않는다
    const writes = smsWrites(requests)
    const sent = writes.map((w) => `${String(w['no'])}:${String(w['last4'])}`)
    expect(new Set(sent).size).toBe(sent.length)
    const events = await smsEvents(page, date, false)
    expect(events.map((e) => e['no']).sort()).toEqual(writes.map((w) => w['no']).sort())
    test.info().annotations.push({ type: 'sent', description: sent.join(', ') })
  })
})
