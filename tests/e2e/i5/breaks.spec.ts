// I5 깨뜨리기 + 크로미움 쪽 수용 기준 (AC-I5-10·12·13 크로미움, AC-I5-03 화면 쪽, D-I5-01 1분 창, 좁은 화면의 긴 문장) — test-e2e.
// @webkit이 붙은 시험은 webkit-iphone 묶음(합성 PCM·실제 WS·모의 worker), 안 붙은 시험은 기본 chromium 묶음(I4 크롬 흉내 가짜).
import { test, expect, type Page } from '@playwright/test'
import { closePcmConnection, LG_FAILED, pcmCounts, reconnectPcm } from '../app1/support.ts'
import {
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
  installFakeSpeech,
  installSafariSpeech,
  login,
  openNewBroadcast,
  pauseClock,
  recordRequests,
  register,
  safariSay,
  speechCounts,
  turnOnVoice,
  uniqueDate,
  voiceRegion,
  voiceStatus,
  openExtras,
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

test.describe('I5 사파리 → APP1 연결·늦은 글 공격 @webkit', () => {
  test('AC-I5-13: 설정과 콘솔에 클라우드 음성 키 칸이 없다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await login(page); await page.goto('/settings')
    await expect(page.getByRole('heading').first()).toBeVisible(); await expectNoCloud(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true }); await turnOnVoice(page); await expectNoCloud(page)
  })
  test('AC-I5-03 c → APP1-40: 아직 결과가 없는 소리 중 끄면 카드·등록 없이 소리 폐기 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    const requests = recordRequests(page)
    await safariSay(page, '15번 핑크프릴 만오천원', { final: false })
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await page.clock.runFor(10_000)
    await expect(card(page, C15)).toHaveCount(0); await expect(boardItem(page, 15)).toHaveCount(0)
    expect(registerPosts(requests)).toEqual([])
    expect((await pcmCounts(page)).stops).toBeGreaterThan(0)
  })
  test('AC-I5-03 d → APP1-33: 결과 전 로그아웃으로 AUTH 종료, 카드·자동 쓰기 없음 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    const requests = recordRequests(page)
    await safariSay(page, '15번 핑크프릴 만오천원', { final: false })
    await page.evaluate(async () => { await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }) })
    await expect(voiceRegion(page)).toContainText('로그인이 끝나 음성 듣기를 멈췄어요. 다시 로그인해 주세요.')
    await page.clock.runFor(10_000)
    await expect(card(page, C15)).toHaveCount(0); expect(registerPosts(requests)).toEqual([])
    expect((await pcmCounts(page)).sockets).toBe(1)
  })
  test('AC-I5-03 e → APP1-38: 공백뿐인 최종 글은 카드·알림 없이 같은 흐름으로 듣는다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    await safariSay(page, '   '); await page.clock.runFor(3000)
    expect((await pcmCounts(page)).sockets).toBe(1)
    await expect(cardList(page).getByRole('listitem')).toHaveCount(0)
    await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
  })
  test('AC-I5-03 b·22 → APP1b-12: 최종 글 뒤 60초 조용함에도 카드 하나, 늦은 다음 글도 한 장만 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    await safariSay(page, '15번 핑크프릴 만오천원'); await expect(card(page, C15)).toBeVisible()
    await page.clock.runFor(60_000); await expect(cardList(page).getByRole('listitem')).toHaveCount(1)
    await safariSay(page, '16번 핑크프릴 만육천원', { final: false, endSoon: true })
    await page.clock.runFor(60_000); await expect(cardList(page).getByRole('listitem')).toHaveCount(2)
    expect((await pcmCounts(page)).sockets).toBe(1)
  })
  test('D-I5-02 → APP1-36: 늦은 카드 뒤 바로 등록을 켜도 옛 카드는 수동 확인으로 남는다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    const requests = recordRequests(page)
    await safariSay(page, '15번 핑크프릴 만오천원', { final: false, endSoon: true }); await expect(card(page, C15)).toBeVisible()
    const box = (await openExtras(page)).getByRole('checkbox', { name: '번호와 가격이 들리면 바로 등록' })
    await box.check(); await expect(box).toBeChecked(); await page.clock.runFor(30_000)
    await expect(card(page, C15)).toBeVisible(); await expect(card(page, C15).getByText(/자동 등록/)).toHaveCount(0)
    expect(registerPosts(requests)).toEqual([])
  })
  test('D-I5-01 → APP1-31: 5회 끊김 뒤 63초가 지나면 여섯 번째 끊김도 다시 연결 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    for (let i = 0; i < 5; i++) await reconnectPcm(page, i)
    await page.clock.runFor(63_000); await reconnectPcm(page, 4)
    expect((await pcmCounts(page)).sockets).toBe(7)
    await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
  })
  test('D-I5-01 → APP1-31: 사이사이 3초 조용함이 있어도 60초 안 여섯 번째 끊김은 멈춤 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    for (let i = 0; i < 5; i++) { await reconnectPcm(page, i); await page.clock.runFor(3000) }
    await closePcmConnection(page)
    await expect(voiceRegion(page)).toContainText(LG_FAILED)
    await expect(page.getByRole('button', { name: '다시 켜기', exact: true }).first()).toBeVisible()
    expect((await pcmCounts(page)).sockets).toBe(6)
  })
  test('393px → APP1-31: 긴 연결 오류와 대기 카드·서버 고지가 가로 넘침 없이 복구된다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, standalone: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    await safariSay(page, '15번 핑크프릴 만오천원'); await expect(card(page, C15)).toBeVisible()
    for (let i = 0; i < 5; i++) await reconnectPcm(page, i)
    await closePcmConnection(page); await expect(voiceRegion(page)).toContainText(LG_FAILED)
    await expect(page.getByText(STANDALONE)).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const box = await voiceRegion(page).getByText(LG_FAILED, { exact: true }).boundingBox()
    expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(393)
    await page.getByRole('button', { name: '다시 켜기', exact: true }).first().click(); await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    await expect(card(page, C15)).toBeVisible(); await cardButton(page, C15, '등록').click(); await expect(boardItem(page, 15)).toBeVisible()
  })
})
