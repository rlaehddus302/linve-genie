// V1 흐름 깨뜨리기 — 두 기기·연결 끊김·응답 잃음·Enter·빠른 연속 문장 (test-e2e).
// 기대값은 acceptance(AC-V1-10 같은 요청 번호, AC-V1-22 보내지 못함, D-V1-06)와 dev-notes "정한 것"에서 정했다.
import { test, expect } from '@playwright/test'
import {
  board,
  boardItem,
  heardCard,
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

// 품종 '핑크프릴'로 등록 — 카드 이름에 품종(D-V1-21)
const C165 = '165번 핑크프릴 · 끝자리 1234 · 문자찜'
const C166 = '166번 핑크프릴 · 손님 확인 필요 · 문자찜'
const REPEATED = '같은 말을 다른 기기에서 방금 넣었어요.'

test.describe('V1 깨뜨리기', () => {
  test('AC-V1-31: 두 기기(PC + 휴대폰 375px)가 같은 말을 거의 함께 넣으면 한 번만 — 늦은 쪽은 "같은 말을 다른 기기에서 방금 넣었어요."와 "닫기"만, 본문 voice: true', async ({ browser }) => {
    test.setTimeout(120_000)
    const pcCtx = await browser.newContext()
    const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
    const pc = await pcCtx.newPage()
    const phone = await phoneCtx.newPage()
    try {
      const { b, date } = await setupLive(pc)
      for (const no of [165, 166]) await registerApi(pc, b, no, '핑크프릴', 10000)
      await installSmsSpeech(phone)
      await login(phone)
      await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(boardItem(phone, 166)).toBeVisible()
      await turnOnVoice(phone)
      const pcRequests = recordRequests(pc)
      const phoneRequests = recordRequests(phone)

      // 끝자리 있는 말: PC가 먼저 넣고 휴대폰은 3초 뒤 저절로 → 서버가 같은 음성 쓰기로 거절(D-V1-13)
      await speak(pc, '165번 문자찜 끝자리 1234')
      await speak(phone, '165번 문자찜 끝자리 1234')
      await smsButton(pc, C165, '지금 넣기').click()
      await expect(smsResults(pc, C165)).toHaveText(/^165번 · 문자찜 · 1등 · /)
      await expect(boardItem(phone, 165)).toContainText(/1등|문자찜/)
      const late165 = heardCard(phone, '165번 문자찜 끝자리 1234')
      await expect(late165.getByRole('alert')).toHaveText(REPEATED, { timeout: 15_000 })
      await expect(late165).toHaveAccessibleName('문자찜 · 넣지 않았어요 카드')
      await expect(late165.getByRole('button')).toHaveText(['닫기'])

      // 끝자리 없는 같은 말을 두 곳이 거의 함께 (둘 다 3초 뒤 저절로) → 166번 문자찜은 하나(1등만, 대기 없음)
      await speak(pc, '166번 문자찜')
      await speak(phone, '166번 문자찜')
      const outcomes = [pc, phone].map((p) => ({ reason: heardCard(p, '166번 문자찜').getByRole('alert'), result: smsResults(p, C166) }))
      for (const o of outcomes) await expect(o.reason.or(o.result)).toBeVisible({ timeout: 15_000 })
      const reasons = await Promise.all(outcomes.map((o) => o.reason.count()))
      expect(reasons.reduce((a, n) => a + n, 0)).toBe(1)
      const late = outcomes[reasons[0] === 1 ? 0 : 1]!
      const early = outcomes[reasons[0] === 1 ? 1 : 0]!
      await expect(late.reason).toHaveText(REPEATED)
      await expect(early.result).toHaveText(/^166번 · 문자찜\(확인 필요\).* · 1등 · /)
      const latePage = reasons[0] === 1 ? pc : phone
      await expect(heardCard(latePage, '166번 문자찜').getByRole('button')).toHaveText(['닫기'])

      // 쓰기는 모두 voice: true, 늦은 쪽도 저절로 다시 보내지 않는다
      const sent = [...smsWrites(pcRequests), ...smsWrites(phoneRequests)]
      for (const w of sent) expect(w['voice']).toBe(true)
      const before = sent.length
      await heardCard(latePage, '166번 문자찜').getByRole('button', { name: /닫기$/ }).click()
      await expect(heardCard(latePage, '166번 문자찜')).toHaveCount(0)
      expect(smsWrites(pcRequests).length + smsWrites(phoneRequests).length).toBe(before)

      const view = await scopeView(pc, date, false)
      for (const no of [165, 166]) {
        expect(view.claims.filter((x) => x.no === no), String(no)).toHaveLength(1)
        expect(view.products.find((x) => x.no === no)!.waitlist, String(no)).toEqual([])
      }
      expect(view.buyers.filter((x) => x.kind === 'sms')).toHaveLength(2)
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
    await expect(card.getByRole('button')).toHaveText(['넣지 않기', '넣기']) // D-V1-20
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

  test('빠른 연속 문장(기다림 10초) — 같은 카드를 두 번 넣지 않고, 넷 모두 서버에 하나씩(D-V1-18)', async ({ page }) => {
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
    // D-V1-18: 넣을 수 있는 문자찜 카드는 열린 카드 수 규칙으로 닫지 않는다 — 넷 모두 넣는다
    await expect.poll(() => smsWrites(requests).length).toBe(4)
    await expect(page.getByText(/넣지 않은 문자찜 카드를 닫았어요/)).toHaveCount(0)
    const writes = smsWrites(requests)
    const sent = writes.map((w) => `${String(w['no'])}:${String(w['last4'])}`)
    expect(new Set(sent).size).toBe(sent.length)
    const events = await smsEvents(page, date, false)
    expect(events.map((e) => e['no']).sort()).toEqual([165, 166, 167, 168])
    expect(writes.map((w) => w['no']).sort()).toEqual([165, 166, 167, 168])
    test.info().annotations.push({ type: 'sent', description: sent.join(', ') })
  })
})
