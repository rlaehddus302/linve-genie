// I4 배치·쉬운 말 (AC-I4-50·51) — test-e2e. 높이 측정은 AC-S06-61과 같은 방법(고정·sticky 가장 바깥 요소의 보이는 높이 합).
import { test, expect, type Page } from '@playwright/test'
import {
  boardItem,
  card,
  cardButton,
  cardList,
  installFakeSpeech,
  login,
  noHorizontalScroll,
  openNewBroadcast,
  registerApi,
  sendViewerChat,
  smsApi,
  speak,
  speechError,
  turnOnVoice,
  uniqueDate,
  viewerClaim,
  voiceRegion,
  openExtras,
  openVoiceLog,
} from './support.ts'
import { pendingWord } from '../mob1/support.ts' // QL3R2 D-QL3R2-02

async function fixedHeight(page: Page): Promise<{ total: number; parts: string[] }> {
  return await page.evaluate(() => {
    const vh = window.innerHeight
    const parts: string[] = []
    let total = 0
    const all = [...document.querySelectorAll<HTMLElement>('body *')]
    const pinned = all.filter((el) => {
      const p = getComputedStyle(el).position
      return p === 'fixed' || p === 'sticky'
    })
    for (const el of pinned) {
      if (pinned.some((other) => other !== el && other.contains(el))) continue
      const r = el.getBoundingClientRect()
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
      if (h === 0) continue
      total += h
      parts.push(`${el.tagName}.${el.className} ${String(Math.round(h))}`)
    }
    return { total, parts }
  })
}

/** 알림 다섯 종류(충돌·취소 요청·보류 찜 …)를 만든다 — AC-S06-61과 같은 상태 */
async function makeAlerts(page: Page, b: string): Promise<void> {
  for (let no = 1; no <= 12; no++) await registerApi(page, b, no, `상품${String(no)}`, 10000)
  await smsApi(page, { b, no: 16, memo: '갑', received: '00:01' })
  await registerApi(page, b, 16, '충돌상품', 10000)
  await smsApi(page, { b, no: 16, memo: '을', received: '00:01' })
  await viewerClaim(page, b, '셋째', '7', 'sim_third_0003')
  await sendViewerChat(page, b, '셋째', '7 취소', 'sim_third_0003')
  await smsApi(page, { b, no: 40, memo: '병' })
  const strip = page.getByRole('region', { name: '알림' })
  await expect(strip.getByRole('button', { name: new RegExp(`^${pendingWord(page)} \\d+$`) })).toBeVisible() // QL3R2 D-QL3R2-02
  await expect(strip.getByRole('button', { name: /^취소 요청 \d+$/ })).toBeVisible()
}

async function bigTargets(page: Page, scope: ReturnType<Page['getByRole']>): Promise<string[]> {
  return await scope.evaluate((root) => {
    const bad: string[] = []
    for (const el of root.querySelectorAll<HTMLElement>('button, input, summary, [role="button"]')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      if (r.height < 44 || r.width < 44) bad.push(`${el.tagName} ${el.getAttribute('aria-label') ?? el.textContent ?? ''} ${String(Math.round(r.width))}×${String(Math.round(r.height))}`)
    }
    return bad
  })
}

async function smallFonts(page: Page, scope: ReturnType<Page['getByRole']>): Promise<string[]> {
  return await scope.evaluate((root) => {
    const bad: string[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const el = n.parentElement
      if (el === null || (n.textContent ?? '').trim() === '') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size < 16) bad.push(`${(n.textContent ?? '').trim().slice(0, 20)} ${String(size)}px`)
    }
    return bad
  })
}

test.describe('I4 배치·쉬운 말', () => {
  test('AC-I4-50: 375×812 — 음성 켬·카드 3장·알림·되돌리기 대기에서 고정 영역 ≤ 284px, 가로 스크롤 없음, 누르는 곳 44px·글자 16px', async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL!
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', isMobile: true, hasTouch: true })
    const page = await context.newPage()
    await installFakeSpeech(page, { consent: true, settings: { 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5 } })
    await login(page)
    const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await makeAlerts(page, b)
    await turnOnVoice(page)
    await speak(page, '21번 핑크프릴 만오천 원')
    await speak(page, '22번 라울 만원')
    await speak(page, '23번 블루엘프 칠천 원')
    await expect(cardList(page).getByRole('listitem')).toHaveCount(3)
    const input = page.getByLabel('빠른 입력')
    await input.fill('30 새상품 10000')
    await input.press('Enter')
    await expect(boardItem(page, 30)).toBeVisible()
    const { total, parts } = await fixedHeight(page)
    expect(total, parts.join(' / ')).toBeLessThanOrEqual(284)
    await noHorizontalScroll(page)
    // 카드는 스크롤해서 볼 수 있다
    await card(page, '23번 블루엘프 7,000원').scrollIntoViewIfNeeded()
    await expect(card(page, '23번 블루엘프 7,000원')).toBeInViewport()
    const region = voiceRegion(page)
    expect(await bigTargets(page, region)).toEqual([])
    expect(await smallFonts(page, region)).toEqual([])
    const extras = page.getByRole('region', { name: '음성 설정과 기록' })
    expect(await bigTargets(page, extras)).toEqual([])
    expect(await smallFonts(page, extras)).toEqual([])
    // 고치기 칸도
    await cardButton(page, '22번 라울 10,000원', '고치기').tap()
    const form = page.getByRole('group', { name: '22번 라울 10,000원 고치기 칸' })
    await expect(form).toBeVisible()
    expect(await bigTargets(page, form)).toEqual([])
    await noHorizontalScroll(page)
    await context.close()
  })

  test('AC-I4-50: 1440×900 — 카드 3장 + 되돌리기 대기에서 고정 영역 ≤ 450px, 보드·채팅을 끝까지 내려도 카드가 보인다, 4장 이상이면 카드 칸 안에서 스크롤', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page)
    const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    for (let no = 1; no <= 30; no++) await registerApi(page, b, no, `상품${String(no)}`, 10000)
    for (let i = 1; i <= 30; i++) await sendViewerChat(page, b, `시청자${String(i)}`, `${String(i)}번 예뻐요`)
    await turnOnVoice(page)
    await speak(page, '41번 핑크프릴 만오천 원')
    await speak(page, '42번 라울 만원')
    await speak(page, '43번 블루엘프 칠천 원')
    const input = page.getByLabel('빠른 입력')
    await input.fill('50 새상품 10000')
    await input.press('Enter')
    await expect(boardItem(page, 50)).toBeVisible()
    let fixed = await fixedHeight(page)
    expect(fixed.total, fixed.parts.join(' / ')).toBeLessThanOrEqual(450)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    for (const short of ['41번 핑크프릴 15,000원', '42번 라울 10,000원', '43번 블루엘프 7,000원']) await expect(card(page, short)).toBeInViewport()
    // 손댄 카드 → 열린 카드 4장 이상
    for (const short of ['41번 핑크프릴 15,000원', '42번 라울 10,000원', '43번 블루엘프 7,000원']) {
      await cardButton(page, short, '고치기').click()
      await page.keyboard.press('Escape')
    }
    await speak(page, '44번 라울 이만 원')
    await cardButton(page, '44번 라울 20,000원', '고치기').click()
    await page.keyboard.press('Escape')
    await speak(page, '45번 라울 삼만 원')
    await expect(cardList(page).getByRole('listitem')).toHaveCount(5)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    fixed = await fixedHeight(page)
    expect(fixed.total, fixed.parts.join(' / ')).toBeLessThanOrEqual(450)
    // 맨 앞(Enter 대상) 카드는 보인다
    await expect(card(page, '45번 라울 30,000원')).toBeInViewport()
  })

  test('AC-I4-51: 음성 칸·안내 창·카드·설정·오류 문장에 영어 상태값·개발 용어가 없다', async ({ page }) => {
    const WORDS = /\b(HIGH|LOW|OPEN|CONFIRMED|CLOSED|SpeechRecognition|webkitSpeechRecognition|not-allowed|audio-capture|no-speech|null|undefined|NaN|true|false)\b/
    const seen: string[] = []
    await installFakeSpeech(page)
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: '음성으로 상품 등록' })
    seen.push(await dlg.innerText())
    await dlg.getByRole('button', { name: '음성 켜기', exact: true }).click()
    // V2는 말을 조용한 시간(1.8초)만큼 모아 읽는다(D-V2-03·D-V2-16) — 카드마다 나온 것을 보고 다음 말을 한다
    await speak(page, '15번 핑크프릴 만오천 원')
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await speak(page, '16번 핑크푸릴', { final: false })
    await speak(page, '핑크프릴 만원')
    await expect(card(page, '번호 없음 핑크프릴 10,000원')).toBeVisible()
    await speak(page, '17번 라울')
    const extras = await openExtras(page)
    await extras.getByRole('checkbox', { name: '확실한 카드는 자동으로 등록' }).check()
    await extras.getByLabel('기다리는 시간(초)').fill('abc')
    const log = await openVoiceLog(page)
    seen.push(await log.innerText())
    await page.keyboard.press('Escape')
    await expect(log).toHaveCount(0)
    await cardButton(page, '번호 없음 핑크프릴 10,000원', '등록').click()
    await expect(page.getByRole('group', { name: '번호 없음 핑크프릴 10,000원 고치기 칸' })).toBeVisible()
    seen.push(await voiceRegion(page).innerText(), await extras.innerText())
    // 고치기 칸 오류
    const form = page.getByRole('group', { name: '번호 없음 핑크프릴 10,000원 고치기 칸' })
    await form.getByLabel('가격').fill('abc')
    await form.getByLabel('번호').fill('x')
    await form.getByLabel('번호').press('Enter')
    await expect(form.getByRole('alert')).toBeVisible()
    seen.push(await form.innerText())
    for (const err of ['not-allowed', 'audio-capture', 'bad-grammar']) {
      await speechError(page, err)
      await expect(voiceRegion(page).locator('.voice-error')).toBeVisible()
      seen.push(await voiceRegion(page).innerText())
      await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
      await expect(voiceRegion(page).getByRole('button', { name: '음성 끄기' })).toBeVisible()
    }
    const bad = seen.filter((t) => WORDS.test(t))
    expect(bad).toEqual([])
  })
})
