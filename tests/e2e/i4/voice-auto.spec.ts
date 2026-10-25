// I4 자동 확정 (AC-I4-30·31) — test-e2e. 시각은 page.clock으로 멈추고 당긴다(화면은 Date.now와 setTimeout만 쓴다).
// V3 교체 (D-V3-22 (b)): D-V3-01이 자동 확정(기본 꺼짐·기다리는 시간 5초·HIGH만)을 "번호와 가격이 들리면 바로 등록"(기본 켬, 카운트다운 없음,
// 신뢰도는 등록을 정하지 않음)으로 바꿨고, D-V3-16이 옛 키(voice.autoConfirm·autoConfirmSec)를 읽지 않게 했으며, D-V3-06·D-V3-18이
// "그 순간 그 번호가 있으면 카드에 고칠까요?"를 R-22(같으면 무시)로 바꿨다. 같은 뜻의 시험을 AC-V3 기준으로 바꿨다 — 기준이 바뀐 것이지 약화가 아니다.
// 바꾼 시험 목록은 harness/sprints/V3/test-notes-e2e.md.
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

const LABEL = '번호와 가격이 들리면 바로 등록'
const HELP = "'○○번'과 '○○원'이 들리면 그 자리에서 등록해요. 같은 번호를 다시 말하면 새로 만들지 않고, 찜이 없는 상품은 들은 대로 고쳐요. 등록 뒤 5초 안에 되돌릴 수 있어요."

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

/** 시계를 깔고 콘솔을 열어 음성을 켠 뒤 시계를 멈춘다. settings가 undefined면 저장값 없음(기본 = 바로 등록 켬) */
async function setupPaused(page: Page, settings?: unknown): Promise<{ b: string; date: string }> {
  await installFakeSpeech(page, { consent: true, autoRegister: true, ...(settings === undefined ? {} : { settings }) })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.install()
  await login(page)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  await turnOnVoice(page)
  await openExtras(page)
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(now + 1000)
  // 음성을 켠 직후 판매 이력을 받는 2초(AC-V3-43 b)는 넘겨 둔다
  await page.clock.runFor(2500)
  return { b, date }
}

test.describe('I4 자동 확정 → V3 바로 등록 (D-V3-01·D-V3-22 b)', () => {
  test('AC-I4-30 → AC-V3-40 (D-V3-01·16): 기본 켬, 도움말, "기다리는 시간(초)" 없음, 끄면 저장되어 다시 열어도 꺼짐', async ({ page }) => {
    await installFakeSpeech(page, { consent: true, autoRegister: true })
    await login(page)
    const date = uniqueDate()
    await openNewBroadcast(page, { date, rehearsal: true })
    await turnOnVoice(page)
    await openExtras(page)
    const box = settingsRegion(page).getByRole('checkbox', { name: LABEL })
    await expect(box).toBeChecked()
    await expect(settingsRegion(page).getByRole('checkbox', { name: '확실한 카드는 자동으로 등록' })).toHaveCount(0)
    await expect(settingsRegion(page).getByLabel('기다리는 시간(초)')).toHaveCount(0)
    await expect(page.getByText(HELP)).toBeVisible()
    await speak(page, '15번 핑크프릴 만오천 원')
    await expect(boardItem(page, 15)).toContainText('15,000원')
    await expect(page.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await box.uncheck()
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('livejjim.voiceSettings') ?? 'null') as unknown)
    expect(stored).toMatchObject({ 'voice.autoRegister': false })
    await page.reload()
    await turnOnVoice(page)
    await openExtras(page)
    await expect(box).not.toBeChecked()
  })

  // resolveVoiceSettings (AC-V3-07, D-V3-16): 틀린 값·옛 키는 읽지 않고 기본(켬)
  for (const [label, saved] of [
    ['"false" 글자', { 'voice.autoRegister': 'false' }],
    ['옛 키 "true" 글자', { 'voice.autoConfirm': 'true', 'voice.autoConfirmSec': 5 }],
    ['옛 키 꺼짐·0초', { 'voice.autoConfirm': false, 'voice.autoConfirmSec': 0 }],
    ['옛 키 31초', { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 31 }],
    ['모르는 키', { 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5, extra: 1 }],
  ] as const) {
    test(`AC-I4-30 → AC-V3-07·40: 저장값이 틀리거나 옛 키면(${label}) 바로 등록 켬`, async ({ page }) => {
      await installFakeSpeech(page, { consent: true, autoRegister: true, settings: saved })
      await login(page)
      await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
      await turnOnVoice(page)
      await openExtras(page)
      await expect(settingsRegion(page).getByRole('checkbox', { name: LABEL })).toBeChecked()
      await expect(settingsRegion(page).getByLabel('기다리는 시간(초)')).toHaveCount(0)
    })
  }

  test('AC-I4-30 → D-V3-16: 저장소를 읽을 수 없으면 기본(켬)', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await installFakeSpeech(page, { blockStorage: true })
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await turnOnVoice(page, { consent: true })
    await openExtras(page)
    await expect(settingsRegion(page).getByRole('checkbox', { name: LABEL })).toBeChecked()
  })

  test('AC-I4-31 → AC-V3-20 (D-V3-01): 남은 초 없이 원이 들리는 순간 등록, 되돌리기 띠, 쓰기 1번', async ({ page }) => {
    const { date } = await setupPaused(page)
    const requests = recordRequests(page)
    await speak(page, '15번 핑크프릴 만오천 원')
    await expect(boardItem(page, 15)).toBeVisible()
    await expect(page.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /되돌리기/ }).first()).toBeVisible()
    await page.clock.runFor(QUIET_MS + 5000)
    expect(registers(requests)).toHaveLength(1)
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toHaveLength(1)
  })

  test('AC-I4-31 → D-V3-01: 신뢰도는 등록을 정하지 않는다(확인 필요 품종도 바로), 설정을 끈 채 만든 카드는 등록하지 않는다', async ({ page }) => {
    const { date } = await setupPaused(page, { 'voice.autoRegister': false })
    await said(page, '15번 라울 만원')
    await expect(card(page, '15번 라울 10,000원')).toBeVisible()
    const box = settingsRegion(page).getByRole('checkbox', { name: LABEL })
    await box.check()
    await said(page, '16번 핑크푸릴 만원')
    await expect(boardItem(page, 16)).toBeVisible()
    await page.clock.runFor(10_000)
    await expect(card(page, '15번 라울 10,000원')).toBeVisible()
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register').map((e) => e.fields['no'])).toEqual([16])
  })

  // D-V3-44: 켬이면 원 없는 결과는 카드가 없다 — 카드는 설정 끔에서 본다(R21)
  test('AC-I4-31 → AC-V3-26 (D-V3-02·44): 설정 끔의 원이 없는 카드는 기다려도·고치기를 눌러도 저절로 등록되지 않는다', async ({ page }) => {
    const { date } = await setupPaused(page, { 'voice.autoRegister': false })
    await said(page, '17번 라울 만')
    const c = card(page, '17번 라울 10,000원')
    await expect(c).toBeVisible()
    await expect(c.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
    await cardButton(page, '17번 라울 10,000원', '고치기').click()
    await page.keyboard.press('Escape')
    await page.clock.runFor(10_000)
    await expect(c).toBeVisible()
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toEqual([])
  })

  test('AC-I4-31·14 → D-V3-01·44: (설정 끔) 음성을 끄고 다시 켜도 카드는 저절로 등록되지 않고, 손으로는 등록된다', async ({ page }) => {
    const { date } = await setupPaused(page, { 'voice.autoRegister': false })
    await said(page, '19번 라울 만')
    const c = card(page, '19번 라울 10,000원')
    await expect(c).toBeVisible()
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await page.clock.runFor(10_000)
    await expect(c).toBeVisible()
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(voiceRegion(page).getByRole('button', { name: '음성 끄기' })).toBeVisible()
    await page.clock.runFor(10_000)
    await expect(c).toBeVisible()
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toEqual([])
    await cardButton(page, '19번 라울 10,000원', '등록').click()
    await expect(boardItem(page, 19)).toBeVisible()
  })

  test('AC-I4-31 → TE-V3-006 AC-V3-43 (a): 창이 열린 동안은 미루고, 창을 닫으면 그때 등록한다', async ({ page }) => {
    const { b, date } = await setupPaused(page)
    await registerApi(page, b, 1, '테스트', 10000)
    await expect(boardItem(page, 1)).toBeVisible()
    await boardItem(page, 1).click()
    await expect(page.getByRole('dialog').first()).toBeVisible()
    await speak(page, '15번 라울 만원')
    await page.clock.runFor(8000)
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register' && e.fields['no'] === 15)).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.clock.runFor(300)
    await expect(boardItem(page, 15)).toBeVisible()
  })

  test('AC-I4-31 → AC-V3-21 (D-V3-06·18): 그 번호가 같은 값으로 이미 있으면 쓰기 없이 "이미 등록됐어요" — 창·카드 없음', async ({ page }) => {
    const { b, date } = await setupPaused(page)
    await registerApi(page, b, 15, '라울', 10000)
    await expect(boardItem(page, 15)).toBeVisible()
    await said(page, '15번 라울 만원')
    await expect(page.getByRole('region', { name: '지금 들리는 말', exact: true }).getByRole('status')).toHaveText('15번은 이미 등록됐어요')
    await expect(page.getByRole('list', { name: '음성 카드' })).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const regs = (await history(page, date, true)).filter((e) => e.type === 'product.register' || e.type === 'product.update')
    expect(regs).toHaveLength(1)
    await expect(boardItem(page, 15)).toContainText('10,000원')
  })

  test('AC-I4-31 → AC-V3-20: 바로 등록과 빈 빠른 입력 Enter가 겹쳐도 쓰기 1번', async ({ page }) => {
    const { date } = await setupPaused(page)
    const requests = recordRequests(page)
    await speak(page, '15번 라울 만원')
    await page.getByLabel('빠른 입력').press('Enter')
    await page.clock.runFor(10)
    await expect(boardItem(page, 15)).toBeVisible()
    await page.clock.runFor(5000)
    expect(registers(requests)).toHaveLength(1)
    expect((await history(page, date, true)).filter((e) => e.type === 'product.register')).toHaveLength(1)
  })
})
