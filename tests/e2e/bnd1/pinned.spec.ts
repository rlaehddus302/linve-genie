// BND1 E2E — 밴드 알림 띠 줄 둘이 함께 뜬 동안 휴대폰 고정 영역 (SA-BND1-02, AC-BND1-76, 지금 규칙 UX-04·D-QL2-14 그대로).
// 기대값(스펙): 375×812 글자 100%에서 고정 영역 높이 ≤ 화면 높이 35%(284px).
//   375×812·412×915(크로미움)·393×852(WebKit) × 글자 100%·150%에서 현재 상품 요약 줄이 보인다(아래 끝 < 아래 막대 위 끝, 덮이지 않음, 글자 잘림 0).
// 띠 줄 둘: "밴드 댓글이 들어오지 않아요."(다시 연결 필요 — 가짜 밴드 10401) + "확인하지 않은 밴드 알림이 {N}개 있어요."(지운 댓글). 알림은 접힌 채.
// 잰 높이는 시험 주석(annotation)으로 남기고 test-notes-e2e.md에 옮긴다.
// TE-BND1-005: 고치기 전 375×812 100%에서 접힌 띠가 줄 셋(밴드 둘 + 다른 알림 한 줄, 각 44px)으로 148px — 고정 영역 294px > 284px.
//   기준은 낮추지 않는다(AC-BND1-76). 고침 모양은 D-BND1-21(접힌 띠의 밴드 줄 둘을 한 줄로) — 아래 AC-BND1-73 시험이 그 모양을 단언한다.
import { expect, test, type Page } from '@playwright/test'
import { bigText, expectBig } from '../mob1/support.ts'
import { expectFirstScreen, expectNoClip } from '../ql2/support.ts'
import {
  READ_WAIT,
  T,
  band,
  bandComment,
  bandUser,
  bandWorld,
  boardItem,
  cleanupBand,
  consoleBand,
  linkView,
  linkedBroadcast,
} from './support.ts'

const summary = (page: Page) => page.getByRole('status', { name: '현재 상품 요약' })
/** 콘솔 알림 띠 — 이름이 정확히 "알림"("시청자 알림" 칸은 아니다) */
const strip = (page: Page) => page.getByRole('region', { name: '알림', exact: true })

/** 붙은(fixed·sticky) 영역의 화면 안 높이 합 — 겹친 조상 안의 것은 한 번만 (AC-S06-61 s06/layout.spec·MOB1 station.spec과 같은 셈, 아래 막대 포함) */
async function pinnedHeight(page: Page): Promise<{ total: number; parts: string[] }> {
  return await page.evaluate(() => {
    const vh = window.innerHeight
    const parts: string[] = []
    let total = 0
    const all = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => ['fixed', 'sticky'].includes(getComputedStyle(el).position))
    for (const el of all) {
      if (all.some((o) => o !== el && o.contains(el))) continue
      const r = el.getBoundingClientRect()
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
      if (h === 0) continue
      total += h
      parts.push(`${el.tagName.toLowerCase()}${el.getAttribute('aria-label') === null ? '' : `[${el.getAttribute('aria-label')!}]`} ${String(Math.round(h))}`)
    }
    return { total: Math.round(total), parts }
  })
}

/** 밴드 글을 이은 실제 방송 → 손님 찜 → 그 댓글 지움(알림 1) → 토큰 풀림(다시 연결 필요) — 띠 줄 둘이 함께 */
async function bothBandLines(page: Page, percent: 100 | 150): Promise<void> {
  const w = await bandWorld(page, { baseline: 0, oneBand: true })
  const { b } = await linkedBroadcast(page, w)
  const guest = await bandUser(page.request, '높이손님')
  const key = await bandComment(page.request, w.post, { content: '1번이요', name: '높이손님', userKey: guest })
  await expect(boardItem(page, 1)).toContainText('높이손님', { timeout: READ_WAIT })
  // 참고값(단언 없음): 밴드 띠 줄이 없을 때의 고정 영역 — 띠 줄 둘이 더한 높이를 test-notes에 적으려고
  await expect(strip(page).getByText(T.notComing, { exact: true })).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, 0))
  const plain = await pinnedHeight(page)
  plain.parts.push(`알림 띠 글: ${(await strip(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText).join(' '))).replace(/\s+/g, ' ').slice(0, 80)}`)
  test.info().annotations.push({ type: '띠 줄 없을 때 고정 영역', description: `${String(plain.total)}px — ${plain.parts.join(' / ')}` })
  console.log(`[SA-BND1-02 참고] ${String(page.viewportSize()!.width)}px 띠 줄 없음(글자 100%): ${String(plain.total)}px — ${plain.parts.join(' / ')}`)
  await band(page.request, 'drop', { postKey: w.post, commentKey: key })
  await expect.poll(async () => (await linkView(page, b)).notices.unseen, { timeout: READ_WAIT }).toBe(1)
  await band(page.request, 'revoke', { userKey: w.me })
  await expect.poll(async () => (await linkView(page, b)).state, { timeout: READ_WAIT }).toBe('RECONNECT_NEEDED')
  // 새로 연 콘솔(알림 접힘·스크롤 0)에서 잰다 — 글자 150%는 여기서 켠다(잇기까지는 100%로: 재는 것은 띠가 뜬 콘솔)
  if (percent === 150) await bigText(page)
  await page.reload()
  if (percent === 150) await expectBig(page)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  await expect(strip(page).getByText(T.notComing, { exact: true })).toHaveCount(1)
  await expect(strip(page).getByText(T.notices(1), { exact: true })).toHaveCount(1)
  await expect(consoleBand(page).getByText(T.reconnect)).toHaveCount(1)
  await expect(summary(page)).toBeVisible()
}

async function measure(page: Page, where: string, limit: number | null): Promise<void> {
  // 첫 화면(스크롤 0)에서 잰다. WebKit은 초점 간 빠른 입력칸이 화면 밖이면 그 칸이 보이게 스스로 스크롤한다(150%에서 418px — 실행마다 시점이 달라 흔들림).
  // 초점을 풀고 스크롤 0이 된 것을 기다린 뒤 잰다.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.scrollTo(0, 0)
  })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  const { total, parts } = await pinnedHeight(page)
  const vh = page.viewportSize()!.height
  // 띠 안에 보이는 줄(높이 > 0)과 높이 — 무엇이 고정 영역을 키웠는지 실패 문장에 남긴다
  const rows = await strip(page).evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>('li, [role="status"], p')]
      .map((x) => ({ h: Math.round(x.getBoundingClientRect().height), t: (x.textContent ?? '').trim().slice(0, 24) }))
      .filter((x) => x.h > 0)
      .map((x) => `${x.t}… ${String(x.h)}`),
  )
  const stripHeight = Math.round((await strip(page).boundingBox())?.height ?? 0)
  const text = `${where}: ${String(total)}px (화면 ${String(vh)}px의 ${String(Math.round((total / vh) * 1000) / 10)}%) — ${parts.join(' / ')} · 알림 띠 ${String(stripHeight)}px [${rows.join(' | ')}]`
  test.info().annotations.push({ type: '고정 영역 높이', description: text })
  console.log(`[SA-BND1-02] ${text}`)
  if (limit !== null) expect(total, text).toBeLessThanOrEqual(limit)
  await expectFirstScreen(page, summary(page), `${where} 현재 상품 요약 줄`)
  await expectNoClip(summary(page), `${where} 현재 상품 요약 줄`)
}

test.describe('SA-BND1-02 밴드 알림 띠 줄 둘이 뜬 동안 휴대폰 고정 영역 @multi', () => {
  test.describe.configure({ timeout: 240_000 })
  test.afterEach(async ({ page }) => {
    await cleanupBand(page)
  })

  for (const [width, height, percent] of [
    [375, 812, 100],
    [375, 812, 150],
    [412, 915, 100],
    [412, 915, 150],
  ] as const) {
    const where = `${String(width)}×${String(height)} 글자 ${String(percent)}%`
    const limit = width === 375 && percent === 100 ? 284 : null
    test(`${limit === null ? '' : 'TE-BND1-005 '}SA-BND1-02 AC-BND1-76: ${where} — 띠 줄 둘("밴드 댓글이 들어오지 않아요."·"확인하지 않은 밴드 알림이 1개 있어요.")이 뜬 동안${limit === null ? '' : ' 고정 영역 ≤ 284px,'} 현재 상품 요약 줄이 아래 막대 위에 보이고 잘리지 않는다 @multi`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await bothBandLines(page, percent)
      await measure(page, where, limit)
    })
  }
})

test.describe('SA-BND1-02 아이폰 크기 WebKit @webkit', () => {
  test.describe.configure({ timeout: 240_000 })
  test.afterEach(async ({ page }) => {
    await cleanupBand(page)
  })

  for (const percent of [100, 150] as const) {
    test(`SA-BND1-02 AC-BND1-76: 393×852 WebKit 글자 ${String(percent)}% — 밴드 띠 줄 둘이 뜬 동안 현재 상품 요약 줄이 아래 막대 위에 보이고 잘리지 않는다 @webkit`, async ({ page }) => {
      await bothBandLines(page, percent)
      await measure(page, `393×852 WebKit 글자 ${String(percent)}%`, null)
    })
  }
})

/** 띠 안에서 이름에 "밴드"가 든, 보이는 누르는 곳 */
const bandButtons = (page: Page) => strip(page).getByRole('button', { name: /밴드/ })

test.describe('D-BND1-21 휴대폰 접힌 띠의 밴드 줄 둘은 한 줄 @multi', () => {
  test.describe.configure({ timeout: 240_000 })
  test.afterEach(async ({ page }) => {
    await cleanupBand(page)
  })

  test('TE-BND1-005 AC-BND1-73 D-BND1-21: 375×812 접힌 띠 — 두 문장이 글자 그대로 하나씩 보이고 잘리지 않으며, 밴드 쪽 누르는 곳은 1개("확인했어요" 숨김), 누르면 밴드 칸. 펼치면 두 줄 따로·"확인했어요". PC(1440×900)는 두 줄 따로 @multi', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await bothBandLines(page, 100)
    const notComing = strip(page).getByText(T.notComing, { exact: true })
    const notices = strip(page).getByText(T.notices(1), { exact: true })
    await expect(notComing).toBeVisible()
    await expect(notices).toBeVisible()
    await expectNoClip(notComing, '접힌 띠 "밴드 댓글이 들어오지 않아요."')
    await expectNoClip(notices, '접힌 띠 "확인하지 않은 밴드 알림이 1개 있어요."')
    // 두 문장은 따로 글 조각 — 차례대로(들어오지 않아요 → 알림), 한 누르는 곳 안에
    const one = bandButtons(page)
    await expect(one).toHaveCount(1)
    await expect(one).toBeVisible()
    await expect(one.getByText(T.notComing, { exact: true })).toHaveCount(1)
    await expect(one.getByText(T.notices(1), { exact: true })).toHaveCount(1)
    const order = await one.evaluate((el, [a, b]) => {
      const t = (el as HTMLElement).innerText
      return t.indexOf(a!) >= 0 && t.indexOf(b!) > t.indexOf(a!)
    }, [T.notComing, T.notices(1)])
    expect(order, '묶은 줄 안 문장 차례: "밴드 댓글이 들어오지 않아요." 다음 "확인하지 않은 밴드 알림이 1개 있어요."').toBe(true)
    // 누르는 곳은 44px 이상(AC-BND1-76)
    expect((await one.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    // "확인했어요"는 접힌 동안 숨김(U-BND1-01)
    await expect(strip(page).getByRole('button', { name: T.seen })).toHaveCount(0)
    // 누르면 밴드 칸
    await one.click()
    await expect(consoleBand(page)).toBeInViewport()
    await expect.poll(() => consoleBand(page).evaluate((el) => el.contains(document.activeElement))).toBe(true)
    // 펼치면 두 줄 따로 + "확인했어요"
    await page.evaluate(() => window.scrollTo(0, 0))
    const toggle = page.getByRole('button', { name: /^알림 \d+ 펼치기$/ })
    await toggle.click()
    await expect(page.getByRole('button', { name: /^알림 \d+ 접기$/ })).toBeVisible()
    await expect(bandButtons(page)).toHaveCount(2)
    await expect(strip(page).getByRole('button', { name: T.notComing, exact: true })).toBeVisible()
    await expect(strip(page).getByRole('button', { name: T.notices(1), exact: true })).toBeVisible()
    await expect(strip(page).getByRole('button', { name: T.seen })).toBeVisible()
    // PC: 두 줄 따로
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(strip(page).getByRole('button', { name: T.notComing, exact: true })).toBeVisible()
    await expect(strip(page).getByRole('button', { name: T.notices(1), exact: true })).toBeVisible()
    await expect(bandButtons(page)).toHaveCount(2)
  })
})
