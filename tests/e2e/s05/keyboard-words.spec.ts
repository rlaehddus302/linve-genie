// 키보드만·단축키·화면 낱말·글자·누르는 곳 (AC-S05-42·70·72·73, test-e2e).
import { test, expect } from '@playwright/test'
import { boardItem, history, login, openNewBroadcast, register, sendViewerChat, uniqueDate } from './support.ts'

const ENGINE_WORDS = /\b(CONFIRMED|WAITLISTED|PENDING|CONFLICT|SOLD_OUT|OPEN|READY|HOLD|CLOSED|REJECTED|DUPLICATE|CANCELLED|collector|outbox|undefined|null|NaN)\b/

test('AC-S05-42: 키보드만 — 등록 → Ctrl+Z → Alt+1 → 숫자 키 → Esc', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  const input = page.getByLabel('빠른 입력')
  await page.keyboard.type('15 핑크프릴 10000')
  await page.keyboard.press('Enter')
  await expect(boardItem(page, 15)).toBeVisible()
  await expect(input).toHaveValue('')
  await page.keyboard.press('Control+z')
  await expect(page.getByText('15번 등록을 되돌렸어요(판매 종료)')).toBeVisible()
  // 충돌 만들기: 언급(앞) → 주문(뒤) → 언급을 16번으로 변환
  await register(page, '16 청보석 20000', 16)
  await sendViewerChat(page, b, '앞사람', '16번 예뻐요')
  await sendViewerChat(page, b, '뒷사람', '16')
  await expect(boardItem(page, 16)).toContainText('뒷사람')
  await page.getByRole('list', { name: '채팅 메시지' }).getByRole('listitem').filter({ hasText: '앞사람' }).getByRole('button', { name: '찜으로 바꾸기' }).click()
  await page.keyboard.press('1')
  await expect(page.getByRole('region', { name: '알림' }).getByRole('button', { name: '충돌 1' })).toBeVisible({ timeout: 15_000 })
  await input.focus()
  await page.keyboard.press('Alt+1')
  const dlg = page.getByRole('dialog', { name: /^충돌 — 16번/ })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
  await expect(input).toHaveValue('') // Alt+1은 칸에 글자를 넣지 않는다
  await page.keyboard.press('Escape')
  await expect(dlg).toHaveCount(0)
  await expect(input).toBeFocused()
  await page.keyboard.press('Alt+1')
  await page.keyboard.press('2')
  await expect(page.getByRole('region', { name: '보내기 전 조치' })).toContainText(/초 뒤 보내요/)
  await expect(input).toBeFocused()
  await expect(boardItem(page, 16)).toContainText('앞사람', { timeout: 15_000 })
  const types = (await history(page, date, true)).map((e) => e.type)
  expect(types.filter((t) => t === 'host.resolveConflict')).toHaveLength(1)
})

test('AC-S05-42: Ctrl+Z는 가장 최근의 대기 조치부터, 글자가 있는 칸에서는 글자 되돌리기', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  await register(page, '1 하나 1000', 1)
  await register(page, '2 둘 2000', 2)
  await sendViewerChat(page, b, '가', '1')
  await sendViewerChat(page, b, '나', '2')
  await expect(boardItem(page, 2)).toContainText('나')
  await expect(boardItem(page, 1)).toContainText('가')
  for (const no of [1, 2]) {
    await boardItem(page, no).click()
    await page.getByRole('dialog', { name: `${String(no)}번 자세히` }).getByRole('button', { name: '확인(잠금)' }).click()
  }
  const bar = page.getByRole('region', { name: '보내기 전 조치' })
  await expect(bar).toContainText('1번 가 확인(잠금)')
  await expect(bar).toContainText('2번 나 확인(잠금)')
  const input = page.getByLabel('빠른 입력')
  await input.fill('3 셋')
  await input.press('Control+z') // 칸에 글자가 있다 → 조치는 그대로
  await input.fill('')
  await page.keyboard.press('Control+z')
  await expect(bar).toContainText('보내지 않았어요: 2번 나 확인(잠금)')
  await expect(bar).toContainText(/보냈어요: 1번 가 확인\(잠금\)/, { timeout: 15_000 })
  const confirms = (await history(page, date, true)).filter((e) => e.type === 'host.confirm')
  expect(confirms.map((e) => e.fields['no'])).toEqual([1])
})

test('AC-S05-70: 화면에 엔진 영어 값이 없다 (보드·자세히·채팅·알림 창)', async ({ page }) => {
  await login(page)
  const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await register(page, '5 다섯 5000', 5)
  await register(page, '6 여섯 6000', 6)
  await sendViewerChat(page, b, '가', '5')
  await sendViewerChat(page, b, '나', '5')
  await sendViewerChat(page, b, '다', '7') // 보류
  await sendViewerChat(page, b, '가', '5 취소')
  await expect(page.getByRole('region', { name: '알림' }).getByRole('button', { name: '보류 찜 1' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(ENGINE_WORDS)
  await boardItem(page, 5).click()
  await expect(page.getByRole('dialog', { name: '5번 자세히' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(ENGINE_WORDS)
  await page.keyboard.press('Escape')
  await page.getByRole('region', { name: '알림' }).getByRole('button', { name: '보류 찜 1' }).click()
  const pending = page.getByRole('dialog', { name: '보류 찜' })
  await expect(pending).toContainText('7')
  await expect(page.locator('body')).not.toContainText(ENGINE_WORDS)
  await pending.getByRole('button', { name: '7번 번호 넣기' }).click()
  await expect(page.getByLabel('빠른 입력')).toHaveValue('7 ')
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
})

test('AC-S05-72·73: 375px — 가로 넘침 없음, 글자 16px 이상, 누르는 곳 44px 이상', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  const page = await ctx.newPage()
  await login(page)
  const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await register(page, '15 아주아주긴품종이름이라서화면폭을넘을수도있는다육이 10000', 15)
  await sendViewerChat(page, b, '긴닉네임긴닉네임긴닉네임긴닉네임긴닉네임긴닉네임', 'ㅋ'.repeat(80) + 'https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 😀😀')
  await expect(page.getByRole('list', { name: '채팅 메시지' })).toContainText('😀')
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }))
  expect(overflow.sw, '가로 스크롤 없음').toBeLessThanOrEqual(overflow.w)
  const problems = await page.evaluate(() => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll('button, input, a, [role=button]'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const label = (el.getAttribute('aria-label') ?? (el as HTMLElement).innerText ?? '').slice(0, 30)
      if (r.height < 44 || r.width < 44) out.push(`크기 ${label} ${String(Math.round(r.width))}x${String(Math.round(r.height))}`)
    }
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const he = el as HTMLElement
      if (he.childNodes.length === 0 || !Array.from(he.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')) continue
      const fs = parseFloat(getComputedStyle(he).fontSize)
      if (fs < 16) out.push(`글자 ${he.tagName} ${(he.textContent ?? '').slice(0, 20)} ${String(fs)}px`)
    }
    return out
  })
  expect(problems).toEqual([])
  await ctx.close()
})
