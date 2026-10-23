// I4 자동 확정 (AC-I4-30·31) — test-e2e. 시각은 page.clock으로 멈추고 당긴다(화면은 Date.now와 setTimeout만 쓴다).
import { test, expect, type Page } from '@playwright/test'
import {
  boardItem,
  card,
  cardButton,
  history,
  installFakeSpeech,
  login,
  openNewBroadcast,
  recordRequests,
  registerApi,
  speak,
  turnOnVoice,
  uniqueDate,
  voiceRegion,
  openExtras,
} from './support.ts'

const AUTO_ON = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }
const HELP = '번호·품종·가격이 모두 확실한 카드만, 손대지 않으면 정한 시간 뒤 등록해요. 등록 뒤 5초 안에 되돌릴 수 있어요.'

/** 조용한 시간 기본값 (V2 D-V2-03: 말이 끝난 뒤 이만큼 지나야 덩어리를 읽어 카드가 나온다) */
const QUIET_MS = 1800

/** 최종 결과를 내고 조용한 시간만큼 시계를 넘긴다 (AC-V2-32 — 기대 카드 글은 그대로) */
async function said(page: Page, text: string): Promise<void> {
  await speak(page, text)
  await page.clock.runFor(QUIET_MS)
}

function settingsRegion(page: Page) {
  return page.getByRole('region', { name: '음성 설정과 기록' })
}

function registers(requests: { method: string; body: string }[]) {
  return requests.filter((r) => r.method === 'POST' && r.body.includes('"product.register"'))
}

/** 시계를 깔고 콘솔을 열어 음성을 켠 뒤 시계를 멈춘다 */
async function setupPaused(page: Page, settings: unknown = AUTO_ON): Promise<{ b: string; date: string }> {
  await installFakeSpeech(page, { consent: true, settings })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.install()
  await login(page)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  await turnOnVoice(page)
  await openExtras(page)
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(now + 1000)
  return { b, date }
}

test.describe('I4 자동 확정', () => {
  test('AC-I4-30: 기본 꺼짐·5초, 켜면 안내 문장, 저장되어 다시 열어도 같다, 틀린 기다림은 받지 않는다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await turnOnVoice(page)
    await openExtras(page)
    const box = settingsRegion(page).getByRole('checkbox', { name: '확실한 카드는 자동으로 등록' })
    const secs = settingsRegion(page).getByLabel('기다리는 시간(초)')
    await expect(box).not.toBeChecked()
    await expect(secs).toHaveValue('5')
    await expect(page.getByText(HELP)).toHaveCount(0)
    await speak(page, '15번 핑크프릴 만오천 원')
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await expect(card(page, '15번 핑크프릴 15,000원').getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await box.check()
    await expect(page.getByText(HELP)).toBeVisible()
    await secs.fill('2')
    await expect(settingsRegion(page).getByRole('alert')).toBeVisible()
    await secs.fill('10')
    await expect(settingsRegion(page).getByRole('alert')).toHaveCount(0)
    await secs.fill('7.5')
    await expect(settingsRegion(page).getByRole('alert')).toBeVisible()
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('livejjim.voiceSettings') ?? 'null') as unknown)
    expect(stored).toEqual({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 10 })
    await page.reload()
    await turnOnVoice(page)
    await openExtras(page)
    await expect(box).toBeChecked()
    await expect(secs).toHaveValue('10')
    void b
  })

  // resolveVoiceSettings는 키마다 따로 본다: 틀린 키만 기본값(꺼짐·5초)으로 (acceptance "resolveVoiceSettings대로")
  for (const [label, saved, checked] of [
    ['"true" 글자', { 'voice.autoConfirm': 'true', 'voice.autoConfirmSec': 5 }, false],
    ['0초', { 'voice.autoConfirm': false, 'voice.autoConfirmSec': 0 }, false],
    ['31초 (켬은 그대로)', { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 31 }, true],
    ['모르는 키', { 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5, extra: 1 }, false],
  ] as const) {
    test(`AC-I4-30: 저장값이 틀리면(${label}) 그 값은 기본값(꺼짐·5초)`, async ({ page }) => {
      await installFakeSpeech(page, { consent: true, settings: saved })
      await login(page)
      await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
      await turnOnVoice(page)
      await openExtras(page)
      const box = settingsRegion(page).getByRole('checkbox', { name: '확실한 카드는 자동으로 등록' })
      if (checked) await expect(box).toBeChecked()
      else await expect(box).not.toBeChecked()
      await expect(settingsRegion(page).getByLabel('기다리는 시간(초)')).toHaveValue('5')
    })
  }

  test('AC-I4-30: 저장소를 읽을 수 없으면 꺼짐·5초', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await installFakeSpeech(page, { blockStorage: true })
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await turnOnVoice(page, { consent: true })
    await openExtras(page)
    await expect(settingsRegion(page).getByRole('checkbox', { name: '확실한 카드는 자동으로 등록' })).not.toBeChecked()
    await expect(settingsRegion(page).getByLabel('기다리는 시간(초)')).toHaveValue('5')
  })

  test('AC-I4-31: 남은 초가 줄어들고 +4.9초엔 없고 +5초에 등록, 되돌리기 띠', async ({ page }) => {
    const { date } = await setupPaused(page)
    const requests = recordRequests(page)
    await said(page, '15번 핑크프릴 만오천 원')
    const c = card(page, '15번 핑크프릴 15,000원')
    await expect(c.getByText('5초 뒤 자동 등록')).toBeVisible()
    await expect(cardButton(page, '15번 핑크프릴 15,000원', '자동 등록 멈추기')).toBeVisible()
    await page.clock.runFor(1000)
    await expect(c.getByText('4초 뒤 자동 등록')).toBeVisible()
    await page.clock.runFor(3900)
    await expect(c).toBeVisible()
    expect(registers(requests)).toHaveLength(0)
    await page.clock.runFor(100)
    await expect(boardItem(page, 15)).toBeVisible()
    await expect(c).toHaveCount(0)
    await expect(page.getByRole('button', { name: /되돌리기/ }).first()).toBeVisible()
    expect(registers(requests)).toHaveLength(1)
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toHaveLength(1)
  })

  test('AC-I4-31: LOW 카드·설정을 끈 채 만든 카드·손댄 카드·고치기 카드는 자동 등록하지 않는다', async ({ page }) => {
    const { date } = await setupPaused(page, { 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5 })
    await said(page, '15번 라울 만원')
    const box = settingsRegion(page).getByRole('checkbox', { name: '확실한 카드는 자동으로 등록' })
    await box.check()
    await said(page, '16번 핑크푸릴 만원')
    await expect(card(page, '16번 핑크프릴 10,000원').getByText('확인 필요')).toBeVisible()
    await expect(card(page, '16번 핑크프릴 10,000원').getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await expect(card(page, '15번 라울 10,000원').getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await said(page, '17번 라울 만원')
    await expect(card(page, '17번 라울 10,000원').getByText('5초 뒤 자동 등록')).toBeVisible()
    await cardButton(page, '17번 라울 10,000원', '자동 등록 멈추기').click()
    await expect(card(page, '17번 라울 10,000원').getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await page.clock.runFor(10_000)
    await expect(card(page, '17번 라울 10,000원')).toBeVisible()
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toEqual([])
  })

  test('AC-I4-31: 고치기를 누른 카드는 자동 등록하지 않는다', async ({ page }) => {
    const { date } = await setupPaused(page)
    await said(page, '17번 라울 만원')
    await cardButton(page, '17번 라울 10,000원', '고치기').click()
    await expect(card(page, '17번 라울 10,000원').getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.clock.runFor(10_000)
    await expect(card(page, '17번 라울 10,000원')).toBeVisible()
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toEqual([])
  })

  test('AC-I4-31·14: 음성을 끄면 남은 초가 사라지고 기다림이 지나도 등록 없음, 다시 켜도 재개하지 않는다, 손으로는 등록된다', async ({ page }) => {
    const { date } = await setupPaused(page)
    await said(page, '19번 라울 만원')
    const c = card(page, '19번 라울 10,000원')
    await expect(c.getByText('5초 뒤 자동 등록')).toBeVisible()
    await page.clock.runFor(2000)
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await expect(c.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await page.clock.runFor(10_000)
    await expect(c).toBeVisible()
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(voiceRegion(page).getByRole('button', { name: '음성 끄기' })).toBeVisible()
    await expect(c.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await page.clock.runFor(10_000)
    await expect(c).toBeVisible()
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toEqual([])
    await cardButton(page, '19번 라울 10,000원', '등록').click()
    await expect(boardItem(page, 19)).toBeVisible()
  })

  test('AC-I4-31: 창이 열린 동안은 미루고, 창을 닫으면 기다림이 지난 카드를 바로 등록한다', async ({ page }) => {
    const { b, date } = await setupPaused(page)
    await registerApi(page, b, 1, '테스트', 10000)
    await expect(boardItem(page, 1)).toBeVisible()
    await speak(page, '15번 라울 만원')
    await boardItem(page, 1).click()
    await expect(page.getByRole('dialog').first()).toBeVisible()
    await page.clock.runFor(8000)
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register' && e.fields['no'] === 15)).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.clock.runFor(300)
    await expect(boardItem(page, 15)).toBeVisible()
  })

  test('AC-I4-31: 그 순간 그 번호가 있으면 등록 없이 카드에 "고칠까요?" — 창 없음, 그 카드 자동 확정 끔', async ({ page }) => {
    const { b, date } = await setupPaused(page)
    await said(page, '15번 라울 만원')
    const c = card(page, '15번 라울 10,000원')
    await expect(c.getByText('5초 뒤 자동 등록')).toBeVisible()
    await registerApi(page, b, 15, '핑크프릴', 20000)
    await expect(boardItem(page, 15)).toBeVisible()
    await page.clock.runFor(5000)
    await expect(c.getByText('15번이 이미 있어요. 고칠까요?')).toBeVisible()
    await expect(c.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const regs = (await history(page, date, true)).filter((e) => e.type === 'product.register')
    expect(regs).toHaveLength(1)
    await expect(boardItem(page, 15)).toContainText('20,000원')
  })

  test('AC-I4-31: 자동 확정 직전의 Enter·누르기와 겹쳐도 쓰기 1번', async ({ page }) => {
    const { date } = await setupPaused(page)
    const requests = recordRequests(page)
    await speak(page, '15번 라울 만원')
    await page.clock.runFor(4999)
    await expect(card(page, '15번 라울 10,000원').getByText('Enter 등록', { exact: true })).toBeVisible()
    await page.getByLabel('빠른 입력').press('Enter')
    await page.clock.runFor(10)
    await expect(boardItem(page, 15)).toBeVisible()
    await page.clock.runFor(5000)
    expect(registers(requests)).toHaveLength(1)
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toHaveLength(1)
  })
})
