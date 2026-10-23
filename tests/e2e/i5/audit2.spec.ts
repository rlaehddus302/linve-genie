// I5 감사 뒤 수용 기준 (test-e2e): AC-I5-25·26(D-I5-09·10, SA-I5-01·02), AC-I5-27~33(감사 2 — D-I5-11~18).
// @webkit = webkit-iphone 묶음(사파리 흉내 가짜, iPhone 15·393px), 태그 없음 = 기본 chromium 묶음(I4 크롬 흉내 가짜).
// 기대값은 acceptance.md·DECISIONS의 따옴표 문장 그대로다. 시각은 page.clock(멈춘 채 runFor로만 흐름).
import { test, expect, type Page } from '@playwright/test'
import {
  CONSENT_MIC,
  CONSENT_SENT,
  FINAL_END_MS,
  FLUSHED_NOTE,
  MSG,
  OLD_CONSENT_MIC,
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
  firstLine,
  flushedClosed,
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
  speak,
  speechError,
  turnOnVoice,
  uniqueDate,
  voiceRegion,
  voiceStatus,
} from './support.ts'

const C15 = '15번 핑크프릴 15,000원'
const C19 = '19번 라울 10,000원'

function registerPosts(requests: { method: string; body: string }[]): unknown[] {
  return requests.filter((r) => r.method === 'POST' && r.body.includes('"product.register"'))
}

/**
 * 사파리처럼 말한다: 연 지 2.1초에 말이 들리고(조용함 끝 전) 곧 끝난다 → 엔진이 새 인식 객체를 연다.
 * 연 지 2초가 넘어 끝나므로 빨리 끝남으로 세지 않는다(D-I5-01). final false면 최종 표시 없이 끝남(끝에서 넘김, D-I5-02).
 */
async function sayLikeSafari(page: Page, text: string, final = true): Promise<void> {
  const before = (await safariCounts(page)).constructed
  await page.clock.runFor(2100)
  await safariSay(page, text, final ? {} : { final: false, endSoon: true })
  await page.clock.runFor(FINAL_END_MS + 100)
  await expect.poll(async () => (await safariCounts(page)).constructed).toBe(before + 1)
}

/** 음성 칸 상태 글자가 바뀔 때마다 모은다 (그려진 글자 모두 — "한 번도 그려지지 않음"을 보려고) */
async function recordStatusTexts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { __statusSeen: string[] }).__statusSeen = seen
    const read = (): void => {
      const text = document.querySelector('section[aria-label="음성 등록"] [role="status"]')?.textContent ?? null
      if (text !== null && seen.at(-1) !== text) seen.push(text)
    }
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true })
    read()
  })
}

async function statusTexts(page: Page): Promise<string[]> {
  return await page.evaluate(() => (window as unknown as { __statusSeen: string[] }).__statusSeen)
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(scroll.sw).toBeLessThanOrEqual(scroll.iw)
}

// ── AC-I5-25 ────────────────────────────────────────────────────────────

test.describe('I5 감사 — 끝에서 넘긴 카드 @webkit', () => {
  test('AC-I5-25: 넘긴 카드 표시·밀려 닫히면 "알겠어요"까지 남는 알림, 보통 카드는 알림 없음, 둘째 장은 아래 줄로 쌓임, 자동 등록 없음 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page)
    const requests = recordRequests(page)
    await pauseClock(page)
    await turnOnVoice(page)
    const alerts = voiceRegion(page).getByRole('alert')

    // (a) 최종 표시 없이 끝남 → "확인 필요"와 까닭 줄
    await sayLikeSafari(page, '15번 핑크프릴 만오천원', false)
    await expect(card(page, C15)).toBeVisible()
    await expect(card(page, C15).getByText('확인 필요', { exact: true })).toBeVisible()
    await expect(card(page, C15).getByText(FLUSHED_NOTE, { exact: true })).toBeVisible()

    // (b) 손대지 않은 보통 카드 셋 → 4장째에서 가장 오래된 15번이 밀려 닫힌다
    await sayLikeSafari(page, '16번 라울 만원')
    const c16 = '16번 라울 10,000원'
    await expect(card(page, c16)).toBeVisible()
    await expect(card(page, c16).getByText('확인 필요')).toHaveCount(0)
    await expect(card(page, c16).getByText(FLUSHED_NOTE)).toHaveCount(0)
    await sayLikeSafari(page, '17번 블루엘프 칠천원')
    await expect(cardList(page).getByRole('listitem')).toHaveCount(3)
    await expect(card(page, C15)).toBeVisible()
    await expect(alerts).toHaveCount(0)
    await sayLikeSafari(page, '18번 핑크프릴 만원')
    await expect(card(page, '18번 핑크프릴 10,000원')).toBeVisible()
    await expect(card(page, C15)).toHaveCount(0)
    const notice = alerts.filter({ has: page.getByText(flushedClosed(C15), { exact: true }) })
    await expect(notice).toBeVisible()
    await expect(notice.getByRole('button', { name: '알겠어요', exact: true })).toBeVisible()

    // (c) 알림을 닫기 전에 19번(넘김) — 보통 카드 16번이 밀려 닫힐 때는 문장이 생기지 않는다
    await sayLikeSafari(page, '19번 라울 만원', false)
    await expect(card(page, C19)).toBeVisible()
    await expect(card(page, c16)).toHaveCount(0)
    await expect(voiceRegion(page).getByText(/새 카드에 밀려/)).toHaveCount(1)
    await expect(voiceRegion(page).getByText(/16번/)).toHaveCount(0)
    // 보통 카드 셋(20·21·22) → 17·18·19 차례로 밀려 닫힘, 19번(넘김)만 문장이 더해진다
    await sayLikeSafari(page, '20번 블루엘프 칠천원')
    await sayLikeSafari(page, '21번 핑크프릴 만원')
    await expect(card(page, C19)).toBeVisible()
    await expect(voiceRegion(page).getByText(/새 카드에 밀려/)).toHaveCount(1)
    await sayLikeSafari(page, '22번 라울 만원')
    await expect(card(page, C19)).toHaveCount(0)
    await expect(voiceRegion(page).getByText(/새 카드에 밀려/)).toHaveCount(2)
    const first = notice.getByText(flushedClosed(C15), { exact: true })
    const second = notice.getByText(flushedClosed(C19), { exact: true })
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    const a = await first.boundingBox()
    const b = await second.boundingBox()
    expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height - 0.5)
    // 알겠어요 버튼은 하나
    await expect(voiceRegion(page).getByRole('button', { name: '알겠어요' })).toHaveCount(1)

    // (d) "알겠어요" → 두 문장 모두 사라진다
    await notice.getByRole('button', { name: '알겠어요', exact: true }).click()
    await expect(voiceRegion(page).getByText(/새 카드에 밀려/)).toHaveCount(0)
    await expect(alerts).toHaveCount(0)

    // 어느 단계에서도 15·19번은 저절로 등록되지 않는다 (자동 등록 기본 끔 — 아무 등록도 없다)
    await page.clock.runFor(30_000)
    expect(registerPosts(requests)).toEqual([])
    await expect(boardItem(page, 15)).toHaveCount(0)
    await expect(boardItem(page, 19)).toHaveCount(0)
  })
})

// ── AC-I5-26 ────────────────────────────────────────────────────────────

interface CardGeometry {
  readonly found: boolean
  readonly top: number
  readonly bottom: number
  readonly stickyBottom: number
  readonly menuTop: number
  readonly scrollY: number
  /** 카드의 "등록" 가운데 점에 맨 위로 그려진 것이 그 버튼인가 (메뉴 막대·고정 영역에 가리지 않음) */
  readonly registerOnTop: boolean
}

async function geometry(page: Page, short: string): Promise<CardGeometry> {
  return await page.evaluate((short) => {
    const el = document.querySelector(`[aria-label="${CSS.escape(`${short} 카드`)}"]`)
    const button = document.querySelector(`button[aria-label="${CSS.escape(`${short} 등록`)}"]`)
    const menu = document.querySelector('.menu')
    const sticky = document.querySelector('.console-sticky')
    if (el === null || button === null) return { found: false, top: 0, bottom: 0, stickyBottom: 0, menuTop: 0, scrollY: window.scrollY, registerOnTop: false }
    const rect = el.getBoundingClientRect()
    const b = button.getBoundingClientRect()
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    return {
      found: true,
      top: rect.top,
      bottom: rect.bottom,
      stickyBottom: sticky === null ? 0 : Math.max(0, sticky.getBoundingClientRect().bottom),
      menuTop: menu === null ? window.innerHeight : menu.getBoundingClientRect().top,
      scrollY: window.scrollY,
      registerOnTop: hit !== null && (hit === button || button.contains(hit)),
    }
  }, short)
}

function fullyShown(g: CardGeometry): boolean {
  return g.found && g.top >= g.stickyBottom - 0.5 && g.bottom <= g.menuTop + 0.5 && g.registerOnTop
}

/** 화면 코드가 부른 스크롤 함수(window.scrollBy·scrollTo·scroll, Element.scrollIntoView) 수를 센다 — 페이지를 열기 전에 */
async function countAppScrolls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const box = { calls: 0 }
    ;(window as unknown as { __appScrolls: typeof box }).__appScrolls = box
    for (const name of ['scrollBy', 'scrollTo', 'scroll'] as const) {
      const original = window[name].bind(window) as (...args: unknown[]) => void
      ;(window as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        box.calls++
        original(...args)
      }
    }
    const intoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element, ...args: Parameters<Element['scrollIntoView']>) {
      box.calls++
      intoView.apply(this, args)
    }
  })
}

async function appScrolls(page: Page): Promise<number> {
  return await page.evaluate(() => (window as unknown as { __appScrolls: { calls: number } }).__appScrolls.calls)
}

/** 다음 그리기까지 기다린 뒤의 scrollY (멈춘 시계라 rAF 대신 시계를 조금 당긴다) */
async function settledScrollY(page: Page): Promise<number> {
  await page.clock.runFor(200)
  await page.evaluate(() => document.body.getBoundingClientRect())
  return await page.evaluate(() => window.scrollY)
}

test.describe('I5 감사 — 휴대폰에서 새 카드 보이게 내림 393×568 @webkit', () => {
  test.use({ viewport: { width: 393, height: 568 } })

  test('AC-I5-26 (a)(b)(c): 새 맨 앞 카드는 손대지 않아도 메뉴 막대 위로 보이고, 고치는 중·이미 보이면 움직이지 않는다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await countAppScrolls(page)
    await clockConsole(page)
    await pauseClock(page)
    await turnOnVoice(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await settledScrollY(page)).toBe(0)

    // (a) 카드 목록이 메뉴 막대 밑에 있는 상태에서 새 카드
    const c16 = '16번 라울 10,000원'
    await sayLikeSafari(page, '16번 라울 만원')
    await expect(card(page, c16)).toBeAttached()
    await expect.poll(async () => fullyShown(await geometry(page, c16)), { message: '새 맨 앞 카드가 위 고정 영역 아래·메뉴 막대 위에 다 보인다' }).toBe(true)
    const shown = await geometry(page, c16)
    // 전제: 맨 위(scrollY 0)였다면 카드 아래 끝이 메뉴 막대 밑이었다 — 그래서 저절로 내려갔다
    expect(shown.bottom + shown.scrollY).toBeGreaterThan(shown.menuTop)
    expect(shown.scrollY).toBeGreaterThan(0)

    // (b) 고치기 칸을 열어 둔 채 새 카드 → scrollY 그대로
    await cardButton(page, c16, '고치기').click()
    await expect(cardButton(page, c16, '고치기')).toHaveAttribute('aria-expanded', 'true')
    const editingY = await settledScrollY(page)
    const scrollsBefore = await appScrolls(page)
    const c17 = '17번 블루엘프 7,000원'
    await sayLikeSafari(page, '17번 블루엘프 칠천원')
    await expect(card(page, c17)).toBeAttached()
    // D-I5-10: 고치는 중에는 화면 코드가 스크롤하지 않는다 — 스크롤 함수 호출 0번으로 본다(엄격).
    // scrollY는 첫 실행 한 번(이후 9번은 그대로) 230 → 543으로 바뀐 일이 있다. 그때 고치기 칸 입력(포커스·select)은 새 카드에 밀려
    // 메뉴 막대 밑(화면 위 끝에서 696px)에 있었고, 313px 올리면 그 입력이 메뉴 막대 위에 온다 — WebKit이 포커스된 입력의 캐럿을
    // 늦게 드러낸 것으로 보인다(재현 못 함). 그래서 scrollY가 바뀌었으면 "화면 코드 호출 0 + 포커스된 고치기 칸 입력이 보이는 곳"인 경우만 받아들인다.
    expect(await appScrolls(page)).toBe(scrollsBefore)
    const afterEdit = await settledScrollY(page)
    if (afterEdit !== editingY) {
      const caret = await page.evaluate(() => {
        const el = document.activeElement
        if (!(el instanceof HTMLInputElement) || el.closest('fieldset') === null) return false
        const r = el.getBoundingClientRect()
        const menuTop = document.querySelector('.menu')?.getBoundingClientRect().top ?? window.innerHeight
        return r.top >= 0 && r.bottom <= menuTop
      })
      expect(caret, `scrollY ${String(editingY)} → ${String(afterEdit)}: 브라우저의 캐럿 드러내기만 허용`).toBe(true)
    }

    // (c) 고치기 칸을 닫고, 맨 앞 카드가 다 보이는 위치에서 새 카드 → 움직이지 않는다
    await cardButton(page, c16, '고치기').click()
    await expect(cardButton(page, c16, '고치기')).toHaveAttribute('aria-expanded', 'false')
    await page.evaluate((short) => {
      const el = document.querySelector(`[aria-label="${CSS.escape(`${short} 카드`)}"]`)!
      const sticky = document.querySelector('.console-sticky')
      const stickyHeight = sticky === null ? 0 : sticky.getBoundingClientRect().height
      window.scrollBy({ top: el.getBoundingClientRect().top - stickyHeight - 12, behavior: 'instant' })
    }, c17)
    await expect.poll(async () => fullyShown(await geometry(page, c17))).toBe(true)
    const visibleY = await settledScrollY(page)
    const scrollsVisible = await appScrolls(page)
    const c18 = '18번 핑크프릴 10,000원'
    await sayLikeSafari(page, '18번 핑크프릴 만원')
    await expect(card(page, c18)).toBeAttached()
    expect(fullyShown(await geometry(page, c18))).toBe(true)
    expect(await settledScrollY(page)).toBe(visibleY)
    expect(await appScrolls(page)).toBe(scrollsVisible)

    // (c) 보이지 않으면 (a)처럼 — 맨 위로 올린 뒤 새 카드
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    expect(await settledScrollY(page)).toBe(0)
    const c19 = '19번 라울 10,000원'
    await sayLikeSafari(page, '19번 라울 만원')
    await expect(card(page, c19)).toBeAttached()
    await expect.poll(async () => fullyShown(await geometry(page, c19))).toBe(true)
    // 가리지 않은 "등록"을 누르면 등록된다
    await cardButton(page, c19, '등록').click()
    await expect(boardItem(page, 19)).toBeAttached()
  })

  test('AC-I5-26: 홈 화면 앱 한 줄은 카드 목록 아래에 있다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, standalone: true })
    await clockConsole(page)
    await pauseClock(page)
    await turnOnVoice(page)
    await sayLikeSafari(page, '16번 라울 만원')
    await sayLikeSafari(page, '17번 블루엘프 칠천원')
    await expect(cardList(page).getByRole('listitem')).toHaveCount(2)
    const line = voiceRegion(page).getByText(STANDALONE, { exact: true })
    await expect(line).toBeAttached()
    const list = await cardList(page).boundingBox()
    const box = await line.boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(list!.y + list!.height - 0.5)
  })
})

test('AC-I5-26 PC 폭(1280): 카드가 고정 영역에 있어 내리지 않는다', async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL!
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  const page = await context.newPage()
  await installFakeSpeech(page, { consent: true })
  await login(page)
  await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await turnOnVoice(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await speak(page, '16번 라울 만원')
  await expect(card(page, '16번 라울 10,000원')).toBeInViewport()
  await speak(page, '17번 블루엘프 칠천원')
  await expect(card(page, '17번 블루엘프 7,000원')).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await context.close()
})

// ── AC-I5-27 ────────────────────────────────────────────────────────────

async function consentLine(page: Page): Promise<void> {
  await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: '음성으로 상품 등록' })
  await expect(dlg.getByText(CONSENT_MIC, { exact: true })).toBeVisible()
  await expect(dlg).toContainText(CONSENT_SENT)
  await expect(page.getByText(OLD_CONSENT_MIC)).toHaveCount(0)
  await dlg.getByRole('button', { name: '음성 켜기', exact: true }).click()
  await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
  // 확인한 기기에서는 창이 다시 열리지 않는다
  await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
  await turnOnVoice(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText(OLD_CONSENT_MIC)).toHaveCount(0)
}

test('AC-I5-27 크로미움: 첫 안내 창의 권한 줄은 "브라우저가 마이크 사용을 물으면", "크롬이…"는 없다', async ({ page }) => {
  await installFakeSpeech(page)
  await login(page)
  await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await consentLine(page)
})

test('AC-I5-27: 첫 안내 창의 권한 줄은 "브라우저가 마이크 사용을 물으면", "크롬이…"는 없다 @webkit', async ({ page }) => {
  await installSafariSpeech(page)
  await login(page)
  await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await consentLine(page)
})

// ── AC-I5-29 ────────────────────────────────────────────────────────────

test.describe('I5 감사 2 — 다시 시작 중 깜빡임 @webkit', () => {
  test('AC-I5-29 (a): 연 지 3초 조용함 끝남은 "다시 시작 중"을 한 번도 그리지 않는다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page)
    await recordStatusTexts(page)
    await pauseClock(page)
    await turnOnVoice(page)
    for (let i = 0; i < 6; i++) await page.clock.runFor(3000)
    await expect.poll(async () => (await safariCounts(page)).constructed).toBeGreaterThanOrEqual(7)
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    expect(await statusTexts(page)).not.toContain('음성: 다시 시작 중')
    await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
  })

  test('AC-I5-29 (b): 연 지 0초 끝남(빨리 끝남)은 "다시 시작 중"이 그려진 뒤 "듣는 중" @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page)
    await pauseClock(page)
    await turnOnVoice(page)
    await safariEndNow(page)
    await expect(voiceStatus(page)).toHaveText('음성: 다시 시작 중')
    await page.clock.runFor(1500)
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    expect((await safariCounts(page)).constructed).toBe(2)
  })

  test('AC-I5-29 (c): 연 지 3초에 network 뒤 끝남은 "다시 시작 중"이 그려진 뒤 "듣는 중" @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, silenceMs: 600_000 })
    await clockConsole(page)
    await pauseClock(page)
    await turnOnVoice(page)
    await page.clock.runFor(3000)
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    await safariError(page, 'network')
    await expect(voiceStatus(page)).toHaveText('음성: 다시 시작 중')
    await page.clock.runFor(1500)
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    expect((await safariCounts(page)).constructed).toBe(2)
    await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
  })
})

// ── AC-I5-30 ────────────────────────────────────────────────────────────

/** 음성 칸 알림의 첫 줄 글자색 */
async function alertColor(page: Page, firstLineText: string): Promise<string> {
  const text = voiceRegion(page).getByRole('alert').getByText(firstLineText, { exact: true })
  await expect(text).toBeVisible()
  return await text.evaluate((el) => getComputedStyle(el).color)
}

async function unsupportedGuide(page: Page, errorPage: (other: Page, url: string) => Promise<void>): Promise<void> {
  await login(page)
  await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  const on = page.getByRole('button', { name: '음성 켜기', exact: true })
  const guide = voiceRegion(page).getByRole('alert').filter({ has: page.getByText(MSG.UNSUPPORTED, { exact: true }) })

  // (a) 안내와 "닫기"
  await on.click()
  await expect(guide).toBeVisible()
  await expect(guide.getByRole('button', { name: '닫기', exact: true })).toBeVisible()
  const guideColor = await alertColor(page, MSG.UNSUPPORTED)

  // (b) 닫기 → 사라지고 "음성 켜기" 그대로
  await guide.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(guide).toHaveCount(0)
  await expect(on).toBeVisible()

  // (c) 다시 보이고, 빠른 입력 등록이 성공하면 내려간다
  await on.click()
  await expect(guide).toBeVisible()
  await register(page, '21 라울 10', 21)
  await expect(guide).toHaveCount(0)

  // (d) 이미 있는 번호 → "고칠까요?"만 열림 — 등록이 성공하지 않았으니 남는다
  await on.click()
  await expect(guide).toBeVisible()
  const input = page.getByLabel('빠른 입력')
  await input.fill('21 라울 20')
  await input.press('Enter')
  await expect(page.getByRole('dialog', { name: '21번이 이미 있어요. 고칠까요?' })).toBeVisible()
  await expect(guide).toBeVisible()

  // 다른 오류(권한 거부)는 오류 색이고 "닫기"가 없다 — 같은 기기의 다른 탭
  const other = await page.context().newPage()
  await errorPage(other, page.url())
  const errorColor = await alertColor(other, '마이크 사용이 막혀 있어요.')
  expect(guideColor).not.toBe(errorColor)
  await expect(voiceRegion(other).getByRole('alert').getByRole('button', { name: '닫기' })).toHaveCount(0)
  await other.close()
}

test('AC-I5-30 크로미움: 지원 안 함 안내는 안내 색·"닫기"·빠른 입력 등록 성공하면 내림, "고칠까요?"만으론 남음', async ({ page }) => {
  await installFakeSpeech(page, { unsupported: true })
  await unsupportedGuide(page, async (other, url) => {
    await installFakeSpeech(other, { consent: true })
    await other.goto(url) // 같은 기기(로그인 그대로)의 같은 방송
    await turnOnVoice(other)
    await speechError(other, 'not-allowed')
  })
})

test('AC-I5-30: 지원 안 함 안내는 안내 색·"닫기"·빠른 입력 등록 성공하면 내림, "고칠까요?"만으론 남음 @webkit', async ({ page }) => {
  await installSafariSpeech(page, { unsupported: true })
  await unsupportedGuide(page, async (other, url) => {
    await installSafariSpeech(other, { consent: true })
    await other.goto(url) // 같은 기기(로그인 그대로)의 같은 방송
    await turnOnVoice(other)
    await safariError(other, 'not-allowed')
  })
})

// ── AC-I5-31 ────────────────────────────────────────────────────────────

test('AC-I5-31: 393px는 짧은 고지만, 켜진 동안 늘 보인다 @webkit', async ({ page }) => {
  await installSafariSpeech(page, { consent: true })
  await clockConsole(page)
  await pauseClock(page)
  await turnOnVoice(page)
  const short = voiceRegion(page).getByText(SENT_SHORT, { exact: true })
  await expect(short).toBeVisible()
  await expect(page.getByText(SENT)).toHaveCount(0)
  await expect(page.getByText(OLD_SENT)).toHaveCount(0)
  await sayLikeSafari(page, '16번 라울 만원')
  await expect(card(page, '16번 라울 10,000원')).toBeAttached()
  await expect(short).toBeVisible()
  await noHorizontalScroll(page)
})

test.describe('AC-I5-31 PC 폭', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('AC-I5-31 크로미움 1280: 긴 고지만, 켜진 동안 늘 보인다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await turnOnVoice(page)
    const long = voiceRegion(page).getByText(SENT, { exact: true })
    await expect(long).toBeVisible()
    await expect(page.getByText(SENT_SHORT)).toHaveCount(0)
    await expect(page.getByText(OLD_SENT)).toHaveCount(0)
    await speak(page, '16번 라울 만원')
    await expect(card(page, '16번 라울 10,000원')).toBeVisible()
    await expect(long).toBeVisible()
  })
})

// ── AC-I5-32·33 ─────────────────────────────────────────────────────────

test.describe('I5 감사 2 — 다시 시작 한도 @webkit', () => {
  test('AC-I5-32: 연 지 3초 network 끝남이 1분 안에 6번 → "연결하지 못했어요"로 멈춤, 빠른 입력 그대로 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, silenceMs: 600_000 })
    await clockConsole(page)
    await pauseClock(page)
    await turnOnVoice(page)
    for (let i = 1; i <= 6; i++) {
      await page.clock.runFor(3000)
      await safariError(page, 'network')
      if (i < 6) {
        await expect.poll(async () => (await safariCounts(page)).constructed).toBe(i + 1)
        await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
      }
    }
    await expectAlert(page, MSG.CONNECTION_FAILED)
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '음성 끄기' })).toHaveCount(0)
    expect((await safariCounts(page)).constructed).toBe(6)
    await expect(page.getByText(firstLine(MSG.KEEPS_STOPPING))).toHaveCount(0)
    await register(page, '21 핑크프릴 10', 21)
  })

  test('AC-I5-33 (a): 홈 화면 앱은 조용함 끝남도 세어 60초에 6번째에서 멈춘다 — 끊김 문장과 홈 화면 앱 줄 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, standalone: true })
    await clockConsole(page)
    await pauseClock(page)
    await turnOnVoice(page)
    for (let i = 0; i < 20; i++) await page.clock.runFor(3000)
    await expectAlert(page, MSG.KEEPS_STOPPING)
    await expect(voiceRegion(page).getByText(STANDALONE, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    expect((await safariCounts(page)).constructed).toBe(6)
  })

  test('AC-I5-33 (b): 홈 화면 앱이 아니면 같은 60초에도 오류 없이 듣는다 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page)
    await pauseClock(page)
    await turnOnVoice(page)
    for (let i = 0; i < 20; i++) await page.clock.runFor(3000)
    await expect.poll(async () => (await safariCounts(page)).constructed).toBeGreaterThanOrEqual(21)
    await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
    await expect(voiceRegion(page).getByRole('button', { name: '음성 끄기' })).toBeVisible()
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
  })
})
