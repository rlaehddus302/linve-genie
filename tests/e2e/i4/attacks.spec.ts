// I4 흐름 깨뜨리기 (test-e2e 라운드 0). 통과한 공격은 회귀로 남기고, 재현한 버그는 지적 ID(TE-I4-xxx)를 붙인다.
import { test, expect, type Page } from '@playwright/test'
import {
  boardItem,
  card,
  cardButton,
  cardList,
  history,
  installFakeSpeech,
  login,
  openNewBroadcast,
  recordRequests,
  speak,
  speechEnd,
  turnOnVoice,
  uniqueDate,
  voiceLogItems,
  voiceRegion,
  openVoiceLog,
} from './support.ts'

async function setup(page: Page): Promise<{ b: string; date: string }> {
  await installFakeSpeech(page, { consent: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  await turnOnVoice(page)
  return { b, date }
}

test.describe('I4 흐름 깨뜨리기', () => {
  test('고치기 칸을 열고 바꾸지 않은 채 Enter·"등록" → 카드 값 그대로(15,000원이 1,500만 원이 되지 않는다)', async ({ page }) => {
    const { date } = await setup(page)
    await speak(page, '15번 핑크프릴 만오천 원')
    await cardButton(page, '15번 핑크프릴 15,000원', '고치기').click()
    const form = page.getByRole('group', { name: '15번 핑크프릴 15,000원 고치기 칸' })
    await expect(form.getByLabel('가격')).toHaveValue('15,000원')
    await form.getByLabel('번호').press('Enter')
    await expect(boardItem(page, 15)).toContainText('15,000원')
    await speak(page, '16번 라울 칠천 원')
    await cardButton(page, '16번 라울 7,000원', '고치기').click()
    await cardButton(page, '16번 라울 7,000원', '등록').click()
    await expect(boardItem(page, 16)).toContainText('7,000원')
    const regs = (await history(page, date, true)).filter((e) => e.type === 'product.register').map((e) => e.fields['price'])
    expect(regs).toEqual([15000, 7000])
  })

  test('서버가 등록을 거절하면 카드를 손댄 카드로 되살리고 오류를 보인다(자동 확정도 다시 하지 않는다)', async ({ page }) => {
    await installFakeSpeech(page, { consent: true, settings: { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 3 } })
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page)
    const date = uniqueDate()
    await openNewBroadcast(page, { date, rehearsal: true })
    await turnOnVoice(page)
    let rejected = 0
    await page.route((url) => url.pathname === '/api/events', async (route) => {
      const body = route.request().postData() ?? ''
      if (route.request().method() === 'POST' && body.includes('"product.register"')) {
        rejected++
        await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID_INPUT', message: '입력을 확인해 주세요.', problems: [] } }) })
        return
      }
      await route.continue()
    })
    await speak(page, '15번 핑크프릴 만오천 원')
    const c = card(page, '15번 핑크프릴 15,000원')
    await expect(c.getByText(/초 뒤 자동 등록/)).toBeVisible()
    await cardButton(page, '15번 핑크프릴 15,000원', '등록').click()
    await expect(page.getByText('입력을 확인해 주세요.').first()).toBeVisible()
    await expect(c).toBeVisible()
    await expect(c.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    const since = await page.evaluate(() => Date.now())
    await page.waitForFunction((end) => Date.now() >= end, since + 3500)
    expect(rejected).toBe(1)
    await expect(c).toBeVisible()
  })

  test('음성 기록은 최근 덩어리 50개만 (D-V2-08 — "들린 말 기록" 20개를 대신함)', async ({ page }) => {
    await page.clock.install()
    await setup(page)
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(now + 1000)
    // 숫자 없는 잡담 51덩어리 — 덩어리마다 조용한 시간(1.8초)을 넘긴다
    const lines = Array.from({ length: 51 }, (_, i) => `잡담 이야기예요 ${String.fromCharCode(0xac00 + i * 28)}${String.fromCharCode(0xac00 + i * 28)}`)
    for (const line of lines) {
      await speak(page, line)
      await page.clock.runFor(1900)
    }
    await openVoiceLog(page)
    const items = voiceLogItems(page)
    await expect(items).toHaveCount(50)
    await expect(items.first()).toContainText(lines[50]!)
    await expect(items.last()).toContainText(lines[1]!)
    await expect(page.getByRole('dialog', { name: '음성 기록' })).not.toContainText(lines[0]!)
  })

  test('한 결과 이벤트에 최종 문장 둘 → 카드 둘(새 것이 앞), 같은 위치가 다시 와도 카드 하나', async ({ page }) => {
    await setup(page)
    await speak(page, ['15번 핑크프릴 만오천 원', '16번 라울 만원'])
    await expect(cardList(page).getByRole('listitem')).toHaveText([/^16번/, /^15번/])
    // 같은 결과 목록을 다시 알림 (크롬이 같은 위치를 다시 보내는 경우)
    await page.evaluate(() => {
      const s = (window as unknown as { __speech: { instances: { onresult: (e: unknown) => void; results: unknown[] }[] } }).__speech
      const rec = s.instances.at(-1)!
      rec.onresult({ resultIndex: 0, results: rec.results })
    })
    await expect(cardList(page).getByRole('listitem')).toHaveCount(2)
  })

  test('다시 시작한 인식 객체의 결과도 카드가 되고, 지난 객체의 늦은 결과는 무시한다', async ({ page }) => {
    await setup(page)
    await speechEnd(page)
    await expect(voiceRegion(page).getByRole('button', { name: '음성 끄기' })).toBeVisible()
    // 지난 객체(0번)의 늦은 결과
    await speak(page, '14번 라울 만원', { instance: 0 })
    await speak(page, '15번 핑크프릴 만오천 원', { instance: 1 })
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await expect(card(page, '14번 라울 10,000원')).toHaveCount(0)
  })

  test('"음성 끄기" 직후 늦게 온 중간·최종 결과는 기록에도 남지 않는다', async ({ page }) => {
    await setup(page)
    await speak(page, '첫 문장이에요')
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await speak(page, '늦게 온 문장이에요')
    await openVoiceLog(page)
    await expect(voiceLogItems(page)).toHaveCount(1)
    await expect(voiceLogItems(page).first()).toContainText('첫 문장이에요')
    await expect(page.getByRole('dialog', { name: '음성 기록' })).not.toContainText('늦게 온 문장이에요')
  })

  test('음성이 켜진 채 다른 방송 콘솔로 바로 가면 인식이 멈추고 새 콘솔은 꺼진 상태', async ({ page }) => {
    const { b } = await setup(page)
    await speak(page, '15번 라울 만원')
    const other = await (async () => {
      const res = await page.request.post('/api/broadcasts', { data: { requestId: crypto.randomUUID(), date: uniqueDate(), rehearsal: true }, headers: { Origin: new URL(page.url()).origin } })
      const body = await res.json() as Record<string, unknown>
      return ((body['result'] as Record<string, unknown> | undefined)?.['b'] ?? (body['broadcast'] as Record<string, unknown> | undefined)?.['id'] ?? body['b'] ?? body['id']) as string
    })()
    const before = await page.evaluate(() => (window as unknown as { __speech: { stops: number; aborts: number } }).__speech)
    await page.evaluate((id) => {
      window.history.pushState(null, '', `/broadcasts/${encodeURIComponent(id)}`)
      dispatchEvent(new PopStateEvent('popstate'))
    }, other)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    await expect(cardList(page)).toHaveCount(0)
    const after = await page.evaluate(() => (window as unknown as { __speech: { stops: number; aborts: number } }).__speech)
    expect(after.stops + after.aborts).toBeGreaterThan(before.stops + before.aborts)
    // 지난 인식 객체의 늦은 결과는 새 콘솔에 카드를 만들지 않는다
    await speak(page, '16번 라울 만원')
    await expect(cardList(page)).toHaveCount(0)
    void b
  })

  test('카드 등록 요청이 늦는 동안 같은 카드를 또 누르거나 Enter를 눌러도 쓰기 1번', async ({ page }) => {
    const { date } = await setup(page)
    const requests = recordRequests(page)
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route((url) => url.pathname === '/api/events', async (route) => {
      if ((route.request().postData() ?? '').includes('"product.register"')) await gate
      await route.continue()
    })
    await speak(page, '15번 핑크프릴 만오천 원')
    await expect(card(page, '15번 핑크프릴 15,000원').getByText('Enter 등록', { exact: true })).toBeVisible()
    const button = cardButton(page, '15번 핑크프릴 15,000원', '등록')
    await button.click()
    await expect(button).toHaveCount(0)
    await page.getByLabel('빠른 입력').press('Enter')
    release()
    await expect(boardItem(page, 15)).toBeVisible()
    expect(requests.filter((r) => r.method === 'POST' && r.body.includes('"product.register"'))).toHaveLength(1)
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toHaveLength(1)
  })

  test('방송 스냅샷의 claim.maxNumber(50)로 뽑는다 — 60번은 번호로 읽지 않는다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page)
    const origin = new URL(page.url()).origin
    const before = await (await page.request.get('/api/settings')).json() as { settings: Record<string, unknown> }
    const set = await page.request.patch('/api/settings', { data: { settings: { 'claim.maxNumber': 50 } }, headers: { Origin: origin } })
    expect(set.ok(), await set.text()).toBe(true)
    try {
      await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    } finally {
      await page.request.patch('/api/settings', { data: { settings: { 'claim.maxNumber': before.settings['claim.maxNumber'] ?? 999 } }, headers: { Origin: origin } })
    }
    await turnOnVoice(page)
    await speak(page, '60번 라울 만원')
    await expect(card(page, '60번 라울 10,000원')).toHaveCount(0)
    await expect(cardList(page).getByRole('listitem')).toHaveCount(1)
    await expect(cardList(page).getByRole('listitem').first()).toHaveAccessibleName(/^번호 없음 라울 10,000원 카드$/)
    await speak(page, '45번 라울 만원')
    await expect(card(page, '45번 라울 10,000원')).toBeVisible()
  })

  test('휴대폰 폭에서 긴 자막·긴 카드 문장도 가로 스크롤을 만들지 않는다', async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL!
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', isMobile: true, hasTouch: true })
    const page = await context.newPage()
    await installFakeSpeech(page, { consent: true })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await turnOnVoice(page)
    const long = '자 여러분 이번에 보여드릴 상품은요 정말 오랜만에 들어온 아주아주예쁜핑크빛으로물든다육이인데요 '.repeat(3)
    await speak(page, long, { final: false })
    await expect(voiceRegion(page).getByText(/^들리는 말:/)).toBeVisible()
    let width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(375)
    await speak(page, `15번 핑크프릴 만오천 원 ${long}`)
    await expect(cardList(page).getByRole('listitem')).toHaveCount(1)
    await openVoiceLog(page)
    width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(375)
    await context.close()
  })

  test('자동 확정 카드와 같은 번호의 빠른 입력 등록이 응답을 기다리는 중이면, 차례에서 번호가 생겨 창 없이 카드로 돌아온다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true, settings: { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 3 } })
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page)
    const date = uniqueDate()
    await openNewBroadcast(page, { date, rehearsal: true })
    await turnOnVoice(page)
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let held = 0
    await page.route((url) => url.pathname === '/api/events', async (route) => {
      if ((route.request().postData() ?? '').includes('"product.register"') && held === 0) {
        held++
        await gate
      }
      await route.continue()
    })
    await speak(page, '15번 라울 만원')
    const c = card(page, '15번 라울 10,000원')
    await expect(c.getByText(/초 뒤 자동 등록/)).toBeVisible()
    const input = page.getByLabel('빠른 입력')
    await input.fill('15 핑크프릴 20')
    await input.press('Enter')
    await expect.poll(() => held).toBe(1)
    // 자동 확정 시각이 지나 카드가 등록 경로로 넘어간다 (차례는 앞 등록 뒤)
    await expect(c).toHaveCount(0, { timeout: 6000 })
    release()
    await expect(boardItem(page, 15)).toContainText('20,000원')
    await expect(c).toBeVisible()
    await expect(c.getByText('15번이 이미 있어요. 고칠까요?')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const regs = (await history(page, date, true)).filter((e) => e.type === 'product.register')
    expect(regs).toHaveLength(1)
  })

  test('TE-I4-001: 저절로 끝나 다시 시작할 때 상태가 "음성: 다시 시작 중"을 거친다 (AC-I4-12) — 지금은 한 번도 그려지지 않는다', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => {
      const seen: string[] = []
      ;(window as unknown as { __labels: string[] }).__labels = seen
      const region = document.querySelector('[aria-label="음성 등록"]')
      if (region === null) throw new Error('음성 칸 없음')
      new MutationObserver(() => {
        for (const el of region.querySelectorAll('[role="status"]')) seen.push(el.textContent ?? '')
      }).observe(region, { subtree: true, childList: true, characterData: true })
    })
    await speechEnd(page)
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    const labels = await page.evaluate(() => (window as unknown as { __labels: string[] }).__labels)
    expect(labels).toContain('음성: 다시 시작 중')
  })

  test('TE-I4-002: 음성 코드를 받지 못하면 안내하고 꺼진 그대로, 다시 누르면 다시 받아 켜진다 — 지금은 새로 고침 전까지 계속 실패', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    let fail = true
    let aborted = 0
    let passed = 0
    await page.route((url) => /^\/assets\/src-[^/]*\.js$/.test(url.pathname), async (route) => {
      if (!fail) passed++
      if (fail) {
        aborted++
        await route.abort('internetdisconnected')
        return
      }
      await route.continue()
    })
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '음성 기능을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요.' })).toBeVisible()
    expect(aborted).toBeGreaterThanOrEqual(1)
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeEnabled()
    fail = false
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    // 다시 누르면 음성 조각을 다시 받아야 한다 (크롬은 실패한 동적 import를 같은 주소로 다시 받지 않는다)
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' }), '다시 누르면 켜진다').toBeVisible()
    expect(passed).toBeGreaterThanOrEqual(1)
    await speak(page, '15번 라울 만원')
    await expect(card(page, '15번 라울 10,000원')).toBeVisible()
  })

  test('AC-I4-10: 방송 설정(스냅샷)을 받기 전에는 "음성 켜기"를 누를 수 없다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route((url) => url.pathname === `/api/days/${date}`, async (route) => {
      await gate
      await route.continue()
    })
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    const toggle = page.getByRole('button', { name: '음성 켜기', exact: true })
    await expect(page.getByRole('status').filter({ hasText: '불러오는 중' }).first()).toBeVisible()
    // 받기 전: 누를 수 있는 "음성 켜기"가 없다 (콘솔이 아직 없거나 잠김)
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true, disabled: false })).toHaveCount(0)
    release()
    await expect(toggle).toBeEnabled()
  })
})
