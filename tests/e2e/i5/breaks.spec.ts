// I5 깨뜨리기 + 크로미움 쪽 수용 기준 (AC-I5-10·12·13 크로미움, AC-I5-03 화면 쪽, D-I5-01 1분 창, 좁은 화면의 긴 문장) — test-e2e.
// @webkit이 붙은 시험은 webkit-iphone 묶음(사파리 흉내 가짜), 안 붙은 시험은 기본 chromium 묶음(I4 크롬 흉내 가짜).
import { test, expect, type Page } from '@playwright/test'
import {
  AUTO_ON,
  CONSENT_SENT,
  MSG,
  OLD_SENT,
  SENT,
  STANDALONE,
  boardItem,
  card,
  cardButton,
  cardList,
  clockConsole,
  expectAlert,
  lines,
  installFakeSpeech,
  installSafariSpeech,
  login,
  openNewBroadcast,
  pauseClock,
  recordRequests,
  register,
  safariCounts,
  safariEndNow,
  safariError,
  safariSay,
  speechCounts,
  turnOnVoice,
  uniqueDate,
  voiceRegion,
  voiceStatus,
} from './support.ts'

const C15 = '15번 핑크프릴 15,000원'
const CLOUD_WORDS = /Deepgram|리턴제로|클라우드 음성|유료 음성/

function registerPosts(requests: { method: string; body: string }[]): unknown[] {
  return requests.filter((r) => r.method === 'POST' && r.body.includes('"product.register"'))
}

async function expectNoCloud(page: Page): Promise<void> {
  await expect(page.getByText(CLOUD_WORDS)).toHaveCount(0)
  await expect(page.getByLabel(CLOUD_WORDS)).toHaveCount(0)
  await expect(page.getByLabel(/음성.*키|키.*음성/)).toHaveCount(0)
}

test.describe('I5 크로미움 (기본 묶음)', () => {
  test('AC-I5-10 크로미움: 지원 안 하는 브라우저 — 창·확인 기록·인식 객체·마이크·이력 조회 없이 알림, 다시 눌러도 같고 손 입력 그대로', async ({ page }) => {
    await installFakeSpeech(page, { unsupported: true })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    const requests = recordRequests(page)
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
      await expectAlert(page, MSG.UNSUPPORTED)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '음성 끄기' })).toHaveCount(0)
    }
    expect(await page.evaluate(() => localStorage.getItem('livejjim.voiceConsent'))).toBeNull()
    const counts = await speechCounts(page)
    expect(counts.instances).toBe(0)
    expect(counts.getUserMedia).toBe(0)
    await register(page, '15 핑크프릴 10', 15)
    expect(requests.filter((r) => new URL(r.url).pathname === '/api/days' && r.method === 'GET')).toEqual([])
  })

  test('AC-I5-12 크로미움: 창의 외부 전송 문장, 켜진 동안 고지 한 줄, 옛 문장은 어디에도 없다', async ({ page }) => {
    await installFakeSpeech(page)
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: '음성으로 상품 등록' })
    await expect(dlg).toContainText(CONSENT_SENT)
    await expect(page.getByText(OLD_SENT)).toHaveCount(0)
    await dlg.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    await expect(voiceRegion(page).getByText(SENT, { exact: true })).toBeVisible()
    await expect(page.getByText(OLD_SENT)).toHaveCount(0)
    // 크롬에는 홈 화면 앱 줄이 없다 (navigator.standalone 없음)
    await expect(page.getByText(STANDALONE)).toHaveCount(0)
  })

  test('AC-I5-13 크로미움: 설정 화면과 콘솔(음성 켬)에 클라우드 음성·음성 키 칸이 없다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await login(page)
    await page.goto('/settings')
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expectNoCloud(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await turnOnVoice(page)
    await expectNoCloud(page)
  })
})

test.describe('I5 사파리 깨뜨리기 @webkit', () => {
  test('AC-I5-13 @webkit: 설정 화면과 콘솔(음성 켬)에 클라우드 음성·음성 키 칸이 없다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await login(page)
    await page.goto('/settings')
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expectNoCloud(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await turnOnVoice(page)
    await expectNoCloud(page)
  })

  test('AC-I5-03(c) 화면: 중간 결과 뒤 판매자가 "음성 끄기" — 카드·등록 없음 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, settings: AUTO_ON })
    await clockConsole(page)
    const requests = recordRequests(page)
    await turnOnVoice(page)
    await pauseClock(page)
    await safariSay(page, '15번 핑크프릴 만오천원', { final: false })
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    await page.clock.runFor(10_000)
    await expect(card(page, C15)).toHaveCount(0)
    await expect(boardItem(page, 15)).toHaveCount(0)
    expect(registerPosts(requests)).toEqual([])
  })

  test('AC-I5-03(d) 화면: 중간 결과 뒤 다시 시작하지 않는 오류(not-allowed) — 카드 없음, 권한 문장 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, settings: AUTO_ON })
    await clockConsole(page)
    const requests = recordRequests(page)
    await turnOnVoice(page)
    await pauseClock(page)
    await safariSay(page, '15번 핑크프릴 만오천원', { final: false })
    await safariError(page, 'not-allowed')
    await expectAlert(page, MSG.PERMISSION_DENIED)
    await page.clock.runFor(10_000)
    await expect(card(page, C15)).toHaveCount(0)
    expect(registerPosts(requests)).toEqual([])
  })

  test('AC-I5-03(e) 화면: 공백뿐인 중간 결과로 끝나면 카드·알림 없이 계속 듣는다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page)
    await turnOnVoice(page)
    await pauseClock(page)
    await safariSay(page, '   ', { final: false, endSoon: true })
    await page.clock.runFor(3000)
    await expect.poll(async () => (await safariCounts(page)).constructed).toBeGreaterThanOrEqual(2)
    await expect(cardList(page).getByRole('listitem')).toHaveCount(0)
    await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
    await expect(voiceRegion(page).getByRole('button', { name: '음성 끄기' })).toBeVisible()
  })

  test('AC-I5-03(b)·22 깨뜨리기: 최종으로 온 문장은 끝날 때 다시 넘기지 않고, 그 뒤 조용함 끝 20번에도 카드는 한 장 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page)
    await turnOnVoice(page)
    await pauseClock(page)
    await safariSay(page, '15번 핑크프릴 만오천원')
    await expect(card(page, C15)).toBeVisible()
    for (let i = 0; i < 20; i++) await page.clock.runFor(3000)
    await expect(cardList(page).getByRole('listitem')).toHaveCount(1)
    // 끝에서 넘긴 문장도 다음 인식 객체들에서 다시 넘어오지 않는다
    await safariSay(page, '16번 핑크프릴 만육천원', { final: false, endSoon: true })
    for (let i = 0; i < 20; i++) await page.clock.runFor(3000)
    await expect(cardList(page).getByRole('listitem')).toHaveCount(2)
    await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
  })

  test('D-I5-02 깨뜨리기: 끝에서 넘긴 카드가 있는 채로 자동 등록을 켜도 그 카드는 자동 등록되지 않는다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, settings: { 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5 } })
    await clockConsole(page)
    const requests = recordRequests(page)
    await turnOnVoice(page)
    await pauseClock(page)
    await safariSay(page, '15번 핑크프릴 만오천원', { final: false, endSoon: true })
    await page.clock.runFor(3000) // 끝남 + 이력 기다림
    await expect(card(page, C15)).toBeVisible()
    const box = page.getByRole('region', { name: '음성 설정과 기록' }).getByRole('checkbox', { name: '확실한 카드는 자동으로 등록' })
    await box.check()
    await expect(box).toBeChecked()
    await page.clock.runFor(30_000)
    await expect(card(page, C15)).toBeVisible()
    await expect(card(page, C15).getByText(/자동 등록/)).toHaveCount(0)
    expect(registerPosts(requests)).toEqual([])
  })

  test('D-I5-01 깨뜨리기: 빨리 끝남 5번 뒤 1분 넘게 조용하다가 빨리 끝남 1번 — 멈추지 않는다(1분 창) @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page)
    await turnOnVoice(page)
    await pauseClock(page)
    for (let i = 0; i < 5; i++) await safariEndNow(page)
    await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
    for (let i = 0; i < 21; i++) await page.clock.runFor(3000) // 63초 — 조용함 끝은 세지 않는다
    await safariEndNow(page)
    await expect.poll(async () => (await safariCounts(page)).constructed).toBeGreaterThanOrEqual(28)
    await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
    await expect(voiceRegion(page).getByRole('button', { name: '음성 끄기' })).toBeVisible()
  })

  test('D-I5-01 깨뜨리기: 빨리 끝남 사이사이 조용함 끝이 있어도 1분 안에 빨리 끝남 6번이면 멈춘다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page)
    await turnOnVoice(page)
    await pauseClock(page)
    for (let i = 0; i < 5; i++) {
      await safariEndNow(page)
      await page.clock.runFor(3000) // 조용함 끝 한 번 (세지 않지만 센 것을 비우지도 않는다)
    }
    await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
    await safariEndNow(page)
    await expectAlert(page, MSG.KEEPS_STOPPING)
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
  })

  test('393px 깨뜨리기: 가장 긴 오류 문장 + 홈 화면 앱 줄 + 카드가 있어도 가로 스크롤이 없다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, standalone: true })
    await clockConsole(page)
    await turnOnVoice(page)
    await pauseClock(page)
    await safariSay(page, '15번 핑크프릴 만오천원')
    await expect(card(page, C15)).toBeVisible()
    await page.clock.runFor(200)
    await expect.poll(async () => (await safariCounts(page)).constructed).toBe(2)
    await safariError(page, 'service-not-allowed')
    await expectAlert(page, MSG.RESTART_BLOCKED)
    await expect(voiceRegion(page).getByText(STANDALONE, { exact: true })).toBeVisible()
    for (const line of lines(MSG.RESTART_BLOCKED)) {
      const box = await voiceRegion(page).getByText(line, { exact: true }).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(393)
    }
    const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    expect(scroll.sw).toBeLessThanOrEqual(scroll.iw)
    // 다시 켜면 그 자리에서 듣는다, 카드는 남는다
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    await cardButton(page, C15, '등록').click()
    await expect(boardItem(page, 15)).toBeVisible()
  })
})
