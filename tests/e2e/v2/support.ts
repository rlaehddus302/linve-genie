// V2 E2E 공용 도우미 (test-e2e): 음성 이어 붙이기·정정·후보·음성 기록. I4 가짜 인식 계약 그대로(addInitScript).
// 시각은 page.clock을 멈춘 뒤 runFor로만 흐른다 — 사례 표(harness/sprints/V2/acceptance.md)의 시각을 그대로 옮긴다.
import { expect, type Page } from '@playwright/test'
import { loginNewSeller } from '../i3/support.ts'
import { cardList, installFakeSpeech, openNewBroadcast, speak, turnOnVoice, uniqueDate } from '../i4/support.ts'

export * from '../i4/support.ts'

export const SETTINGS_KEY = 'livejjim.voiceSettings'
export const LEARNED_KEY = 'livejjim.voiceLearnedAliases'

/** 새 판매자 → 리허설 방송 콘솔 → 음성 켜기 → 시계 멈춤 */
export async function setupV2(page: Page, opts: { width?: number; settings?: unknown } = {}): Promise<{ b: string; date: string }> {
  await installFakeSpeech(page, { consent: true, ...(opts.settings === undefined ? {} : { settings: opts.settings }) })
  await page.setViewportSize({ width: opts.width ?? 1440, height: 900 })
  await page.clock.install()
  await loginNewSeller(page)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  await turnOnVoice(page)
  await pause(page)
  return { b, date }
}

export async function pause(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(now + 1000)
}

/** 사례 표의 결과들을 시각대로 넣는다 ([글, 시각ms, final?]) — 마지막 결과 뒤 시계는 그 시각에 멈춰 있다 */
export async function sayAt(page: Page, items: readonly (readonly [string, number] | readonly [string, number, boolean])[]): Promise<void> {
  let t = 0
  for (const item of items) {
    const [text, at, final] = item
    if (at > t) await page.clock.runFor(at - t)
    t = at
    await speak(page, text, { final: final ?? true })
  }
}

export function heardBox(page: Page) {
  return page.getByRole('region', { name: '들은 말', exact: true })
}

export function offerList(page: Page) {
  return page.getByRole('list', { name: '방금 등록한 상품 고치기' })
}

export function cards(page: Page) {
  return cardList(page).getByRole('listitem')
}

export async function expectNoCards(page: Page): Promise<void> {
  await expect(cards(page)).toHaveCount(0)
}

export async function openLog(page: Page) {
  await page.getByRole('region', { name: '음성 설정과 기록' }).getByRole('button', { name: '음성 기록 보기' }).click()
  const dlg = page.getByRole('dialog', { name: '음성 기록' })
  await expect(dlg).toBeVisible()
  return dlg
}

export function quietField(page: Page) {
  return page.getByRole('region', { name: '음성 설정과 기록' }).getByLabel('말이 끝났다고 볼 때까지(초)')
}

/** 자동 확정 켬·5초 */
export const AUTO_ON = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }
