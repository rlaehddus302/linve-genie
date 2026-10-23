// I5 아이폰(사파리) 음성 — webkit-iphone 묶음(@webkit, iPhone 15·393px·터치) — test-e2e.
// 사파리 흉내 가짜 인식(support.ts installSafariSpeech)과 page.clock으로 본다. 실제 아이폰은 HG-4.
import { test, expect, type Page } from '@playwright/test'
import {
  AUTO_ON,
  CONSENT_SENT,
  MSG,
  OLD_SENT,
  SENT,
  SENT_SHORT,
  STANDALONE,
  boardItem,
  card,
  cardButton,
  cardList,
  clockConsole,
  expectAlert,
  expectNoMessage,
  installSafariSpeech,
  login,
  openNewBroadcast,
  pauseClock,
  recordRequests,
  recordVoiceChunk,
  register,
  safariCounts,
  safariEndNow,
  safariError,
  safariSay,
  turnOnVoice,
  uniqueDate,
  voiceRegion,
  voiceStatus,
} from './support.ts'

const C15 = '15번 핑크프릴 15,000원'

/** 빠른 입력이 그대로 등록된다 */
async function quickStillWorks(page: Page, no: number): Promise<void> {
  await register(page, `${String(no)} 핑크프릴 10`, no)
}

test.describe('I5 아이폰(사파리) 음성 @webkit', () => {
  test('AC-I5-20: 조용할 때 3초마다 끊겨도 120초 동안 멈추지 않고, 그 뒤 최종 결과로 카드·등록 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page)
    await turnOnVoice(page)
    await pauseClock(page)
    for (let i = 0; i < 40; i++) {
      await page.clock.runFor(3000)
      await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
      await expect(voiceStatus(page)).toHaveText(/^음성: (듣는 중|다시 시작 중)$/)
      await expect(voiceRegion(page).getByRole('button', { name: '음성 끄기' })).toBeVisible()
    }
    expect((await safariCounts(page)).constructed).toBeGreaterThan(40)
    await safariSay(page, '15번 핑크프릴 만오천원')
    await expect(card(page, C15)).toBeVisible()
    await cardButton(page, C15, '등록').click()
    await expect(boardItem(page, 15)).toBeVisible()
  })

  for (const [label, run, message] of [
    ['(a) 처음 켤 때 not-allowed → 권한 거부', async (page: Page) => { await safariError(page, 'not-allowed') }, MSG.PERMISSION_DENIED],
    ['(b) 처음 켤 때 service-not-allowed → Siri 꺼짐', async (page: Page) => { await safariError(page, 'service-not-allowed') }, MSG.SERVICE_OFF],
    ['(c) 저절로 끝나 다시 연 객체에서 not-allowed → 다시 켜지지 않음', async (page: Page) => {
      await safariEndNow(page)
      await expect.poll(async () => (await safariCounts(page)).constructed).toBe(2)
      await safariError(page, 'not-allowed')
    }, MSG.RESTART_BLOCKED],
    ['(d) 연 지 0초에 끝나기 6번 → 자꾸 끊김', async (page: Page) => {
      for (let i = 0; i < 6; i++) await safariEndNow(page)
      expect((await safariCounts(page)).constructed).toBe(6)
    }, MSG.KEEPS_STOPPING],
  ] as const) {
    test(`AC-I5-21·28 ${label} @webkit`, async ({ page }) => {
      await installSafariSpeech(page, { consent: true })
      await clockConsole(page)
      // SA-I5-03: 시계를 켜기 전에 멈춘다. 켠 뒤에 멈추면 그사이(부하에서 3초 넘게) 조용함 끝남이 와서 "처음 켤 때"의 객체가 아니라
      // 다시 연 객체에 오류가 가고(→ RESTART_BLOCKED), (b)가 SERVICE_OFF 대신 다른 문장을 보여 가끔 실패했다
      await pauseClock(page)
      await turnOnVoice(page)
      expect((await safariCounts(page)).constructed).toBe(1)
      await run(page)
      // AC-I5-28: 여러 줄 문장은 줄마다 따로, 위에서 아래로 그 차례로 (expectAlert가 본다), 393px에서 가로 스크롤 없음
      await expectAlert(page, message)
      const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
      expect(scroll.sw).toBeLessThanOrEqual(scroll.iw)
      await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '음성 끄기' })).toHaveCount(0)
      await quickStillWorks(page, 21)
      // 다시 누를 수 있다 — 새 인식 객체로 듣는 중, 문장이 사라진다
      const before = (await safariCounts(page)).constructed
      await turnOnVoice(page)
      expect((await safariCounts(page)).constructed).toBe(before + 1)
      await expectNoMessage(page, message)
    })
  }

  test('AC-I5-22: 최종 표시 없이 끝난 문장은 카드 한 장, 30초 지나도 자동 등록하지 않고 "등록"으로만 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, settings: AUTO_ON })
    const { date } = await clockConsole(page)
    const requests = recordRequests(page)
    await turnOnVoice(page)
    await pauseClock(page)
    await safariSay(page, '15번 핑크프릴 만오천원', { final: false, endSoon: true })
    await page.clock.runFor(30_000)
    await expect(card(page, C15)).toHaveCount(1)
    await expect(cardList(page).getByRole('listitem')).toHaveCount(1)
    await expect(card(page, C15).getByText(/자동 등록/)).toHaveCount(0)
    await expect(cardButton(page, C15, '자동 등록 멈추기')).toHaveCount(0)
    expect(requests.filter((r) => r.method === 'POST' && r.body.includes('"product.register"'))).toEqual([])
    await cardButton(page, C15, '등록').click()
    await expect(boardItem(page, 15)).toBeVisible()
    await expect(boardItem(page, 15)).toContainText('핑크프릴')
    await expect(boardItem(page, 15)).toContainText('15,000')
    void date
  })

  test('AC-I5-04: 같은 문장이 보통 최종 결과로 오면 5초 뒤 자동 등록된다 (사파리) @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, settings: AUTO_ON })
    await clockConsole(page)
    await turnOnVoice(page)
    await pauseClock(page)
    await safariSay(page, '15번 핑크프릴 만오천원')
    await expect(card(page, C15).getByText(/초 뒤 자동 등록/)).toBeVisible()
    await page.clock.runFor(5100)
    await expect(boardItem(page, 15)).toBeVisible()
    await expect(card(page, C15)).toHaveCount(0)
  })

  test('AC-I5-11 (a)(b): 홈 화면 앱이면 한 줄 안내 — 막지 않고, 권한 거부로 멈춘 뒤에도 보인다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, standalone: true })
    await clockConsole(page)
    await turnOnVoice(page)
    await pauseClock(page)
    await expect(voiceRegion(page).getByText(STANDALONE, { exact: true })).toBeVisible()
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    await safariError(page, 'not-allowed')
    await expectAlert(page, MSG.PERMISSION_DENIED)
    await expect(voiceRegion(page).getByText(STANDALONE, { exact: true })).toBeVisible()
  })

  test('AC-I5-11 (c): 홈 화면 앱이 아니면 그 줄이 없다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page)
    await turnOnVoice(page)
    // D-I5-16: 393px는 짧은 고지
    await expect(voiceRegion(page).getByText(SENT_SHORT, { exact: true })).toBeVisible()
    await expect(page.getByText(STANDALONE)).toHaveCount(0)
    await safariError(page, 'not-allowed')
    await expectAlert(page, MSG.PERMISSION_DENIED)
    await expect(page.getByText(STANDALONE)).toHaveCount(0)
  })

  test('AC-I5-14: 다시 켜지지 않음으로 멈춘 뒤 "음성 켜기" — 창 없이 새 인식 객체, 문장 사라짐, 카드는 남는다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page)
    await turnOnVoice(page)
    await pauseClock(page)
    await safariSay(page, '15번 핑크프릴 만오천원')
    await expect(card(page, C15)).toBeVisible()
    await page.clock.runFor(200) // 최종 뒤 곧 끝남 → 엔진이 다시 연다
    await expect.poll(async () => (await safariCounts(page)).constructed).toBe(2)
    await safariError(page, 'not-allowed')
    await expectAlert(page, MSG.RESTART_BLOCKED)
    await expect(card(page, C15)).toBeVisible()
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    expect((await safariCounts(page)).constructed).toBe(3)
    await expectNoMessage(page, MSG.RESTART_BLOCKED)
    await expect(card(page, C15)).toBeVisible()
  })

  test('AC-I5-12: 처음 켤 때 창의 외부 전송 문장(애플 포함), 켜진 동안 고지 한 줄, 옛 문장은 없다 @webkit', async ({ page }) => {
    await installSafariSpeech(page)
    await clockConsole(page)
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: '음성으로 상품 등록' })
    await expect(dlg).toContainText(CONSENT_SENT)
    await expect(page.getByText(OLD_SENT)).toHaveCount(0)
    await dlg.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    // D-I5-16: 폭 768px 미만(393)은 짧은 고지, 긴 문장은 없다
    await expect(voiceRegion(page).getByText(SENT_SHORT, { exact: true })).toBeVisible()
    await expect(page.getByText(SENT)).toHaveCount(0)
    await expect(page.getByText(OLD_SENT)).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('livejjim.voiceConsent'))).toBe('yes')
  })

  test('AC-I5-10: 지원 안 하는 기기 — 창·확인 기록·인식 객체·마이크·이력 조회 없이 알림, 손 입력 그대로 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { unsupported: true })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    const requests = recordRequests(page)
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expectAlert(page, MSG.UNSUPPORTED)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('livejjim.voiceConsent'))).toBeNull()
    const counts = await safariCounts(page)
    expect(counts.constructed).toBe(0)
    expect(counts.getUserMedia).toBe(0)
    await register(page, '15 핑크프릴 10', 15)
    expect(requests.filter((r) => new URL(r.url).pathname === '/api/days' && r.method === 'GET')).toEqual([])
  })

  test('AC-I5-23: 393px — 가로 스크롤 없음, 버튼·고지·상태·빠른 입력·맨 앞 카드 버튼을 누를 수 있다, 빈 칸 Enter는 등록 안 함, 끄면 카드는 남는다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, settings: AUTO_ON })
    await clockConsole(page)
    const requests = recordRequests(page)
    await turnOnVoice(page)
    await pauseClock(page)
    for (const [no, word] of [[16, '만육천원'], [17, '만칠천원'], [18, '만팔천원']] as const) {
      await safariSay(page, `${String(no)}번 핑크프릴 ${word}`)
      const short = `${String(no)}번 핑크프릴 ${String(no)},000원`
      await cardButton(page, short, '자동 등록 멈추기').click()
      await expect(cardButton(page, short, '자동 등록 멈추기')).toHaveCount(0)
    }
    await safariSay(page, '19번 핑크프릴 만구천원')
    await expect(cardList(page).getByRole('listitem')).toHaveCount(4)
    const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    expect(scroll.sw).toBeLessThanOrEqual(scroll.iw)
    expect(scroll.iw).toBe(393)
    const front = '19번 핑크프릴 19,000원'
    for (const target of [
      voiceRegion(page).getByRole('button', { name: '음성 끄기' }),
      voiceRegion(page).getByText(SENT_SHORT, { exact: true }), // D-I5-16
      voiceStatus(page),
      page.getByLabel('빠른 입력'),
      cardButton(page, front, '등록'),
      cardButton(page, front, '닫기'),
    ]) {
      await target.scrollIntoViewIfNeeded()
      await expect(target).toBeInViewport()
    }
    // 빈 빠른 입력칸 Enter — 폭 768px 미만이라 카드를 등록하지 않는다
    const input = page.getByLabel('빠른 입력')
    await input.fill('')
    await input.press('Enter')
    await expect(cardList(page).getByRole('listitem')).toHaveCount(4)
    expect(requests.filter((r) => r.method === 'POST' && r.body.includes('"product.register"'))).toEqual([])
    // 맨 앞 카드 "닫기"를 누를 수 있다
    await cardButton(page, front, '닫기').click()
    await expect(card(page, front)).toHaveCount(0)
    // 끄면 인식을 멈추고 카드는 남는다
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    await expect(cardList(page).getByRole('listitem')).toHaveCount(3)
    const stopped = await page.evaluate(() => {
      const s = (window as unknown as { __speech: { stops: number; aborts: number } }).__speech
      return s.stops + s.aborts
    })
    expect(stopped).toBeGreaterThanOrEqual(1)
  })

  test('AC-I5-24: 음성을 켜지 않으면 인식 객체·마이크·음성 조각 요청이 없다 @webkit', async ({ page }) => {
    await installSafariSpeech(page)
    const chunks = recordVoiceChunk(page)
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await register(page, '15 핑크프릴 10', 15)
    const counts = await safariCounts(page)
    expect(counts.constructed).toBe(0)
    expect(counts.getUserMedia).toBe(0)
    expect(chunks).toEqual([])
  })

  test.describe('이력 기다림 (서비스 워커 막음 — WebKit의 page.route)', () => {
    test.use({ serviceWorkers: 'block' })

    test('AC-I5-22 깨뜨리기: 판매 이력을 기다리는 동안 끝에서 넘긴 문장도 자동 등록하지 않는다 @webkit', async ({ page }) => {
      await installSafariSpeech(page, { consent: true, settings: AUTO_ON })
      await clockConsole(page)
      // 이력 조회를 붙잡아 둔다 — 넘긴 문장이 "미룬 문장"(이력 기다림) 길로 간다
      // (WebKit은 서비스 워커가 페이지를 맡으면 page.route가 요청을 못 잡는다 — 이 묶음만 서비스 워커를 막는다)
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => { release = resolve })
      await page.route((url) => url.pathname === '/api/days', async (route) => {
        await held
        await route.continue()
      })
      const requests = recordRequests(page)
      // 시계를 먼저 멈춘다 — 이력 기다림(켠 때부터 2초)이 시험의 실제 시간에 닳지 않게
      await pauseClock(page)
      await turnOnVoice(page)
      await safariSay(page, '15번 핑크프릴 만오천원', { final: false, endSoon: true })
      await page.clock.runFor(200)
      await expect(card(page, C15)).toHaveCount(0)
      await page.clock.runFor(2000)
      await expect(card(page, C15)).toBeVisible()
      release()
      await page.clock.runFor(30_000)
      await expect(card(page, C15)).toBeVisible()
      await expect(card(page, C15).getByText(/자동 등록/)).toHaveCount(0)
      expect(requests.filter((r) => r.method === 'POST' && r.body.includes('"product.register"'))).toEqual([])
    })
  })
})
