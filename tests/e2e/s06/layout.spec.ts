// 휴대폰 고정 영역·끊김 안내 (AC-S06-61), 채팅 밀도 (AC-S06-62), 버튼 명암 (AC-S06-64) — test-e2e.
import { test, expect, type Page } from '@playwright/test'
import { boardItem, login, openNewBroadcast, postJson, registerApi, sendViewerChat, smsApi, uniqueDate, viewerClaim, writeEvent } from './support.ts'
import { pendingWord } from '../mob1/support.ts' // QL3R2 D-QL3R2-02

/** 화면 위·아래에 고정된 영역(position fixed·sticky, 가장 바깥 것)의 보이는 높이 합 */
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

test.describe('고정 영역·밀도·명암', () => {
  test('AC-S06-61: 375×812 콘솔 — 알림 여러 종류 + 되돌리기 대기에서 고정 영역 ≤ 284px, 끊김 안내는 끝까지 내려도 보인다', async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL!
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', isMobile: true, hasTouch: true })
    const page = await context.newPage()
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    for (let no = 1; no <= 12; no++) await registerApi(page, b, no, `상품${String(no)}`, 10000)
    // 충돌: 같은 분까지만 적은 문자찜 둘 (G-ENG-169)
    await smsApi(page, { b, no: 16, memo: '갑', received: '00:01' })
    await registerApi(page, b, 16, '충돌상품', 10000)
    await smsApi(page, { b, no: 16, memo: '을', received: '00:01' })
    // 취소 요청
    await viewerClaim(page, b, '셋째', '7', 'sim_third_0003')
    await sendViewerChat(page, b, '셋째', '7 취소', 'sim_third_0003')
    // 보류 찜
    await smsApi(page, { b, no: 40, memo: '병' })
    const strip = page.getByRole('region', { name: '알림' })
    // MOB2 D-MOB2-02: 접힌 띠에 다 들지 않는 칩은 숨겨지고 접근성 트리에서도 빠진다 — 항목이 있는지·차례는 숨은 칩도 센다
    await expect(strip.getByRole('button', { name: new RegExp(`^${pendingWord(page)} \\d+$`), includeHidden: true })).toHaveCount(1) // QL3R2 D-QL3R2-02 · MOB2 D-MOB2-02 (D-MOB2-11 준비 줄)
    await expect(strip.getByRole('button', { name: /^취소 요청 \d+$/, includeHidden: true })).toHaveCount(1) // MOB2 D-MOB2-02 (D-MOB2-11 준비 줄)
    // 되돌리기 대기 (빠른 입력 등록)
    const input = page.getByLabel('빠른 입력')
    await input.fill('20 새상품 10000')
    await input.press('Enter')
    await expect(boardItem(page, 20)).toBeVisible()
    const { total, parts } = await fixedHeight(page)
    expect(total, parts.join(' / ')).toBeLessThanOrEqual(284)
    // 끊김 안내: 끝까지 내려도 보인다
    await context.setOffline(true)
    const lost = page.getByText('실시간 연결이 끊겼어요. 다시 연결하는 중이에요.')
    await expect(lost).toBeVisible({ timeout: 15_000 })
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(lost).toBeInViewport()
    await context.setOffline(false)
    await context.close()
    void writeEvent
  })

  test('AC-S06-62 · TE-S06-004: 1440×900 리허설 콘솔에서 흔한 길이의 언급 메시지 20개 중 8개 이상이 채팅 칸에 보인다(회귀 — 라운드 0에는 두 줄로 접혀 6~7개)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    // 실제 방송에서 흔한 길이의 언급 (주문도 취소도 아님)
    const lines = ['15번 예뻐요', '15번 색 너무 이뻐요', '15번 사이즈 어때요?', '15번 실물도 이래요?', '15번 향 좋아요?']
    for (let i = 1; i <= 20; i++) await sendViewerChat(page, b, `시청자${String(i)}`, lines[i % lines.length]!)
    const list = page.getByRole('list', { name: '채팅 메시지' })
    await expect(list.getByRole('listitem').filter({ hasText: '시청자20' })).toBeVisible()
    const visible = await list.evaluate((ol) => {
      const box = ol.getBoundingClientRect()
      const top = Math.max(box.top, 0)
      const bottom = Math.min(box.bottom, window.innerHeight)
      return [...ol.querySelectorAll('li')].filter((li) => {
        const r = li.getBoundingClientRect()
        return r.top >= top - 1 && r.bottom <= bottom + 1
      }).length
    })
    expect(visible).toBeGreaterThanOrEqual(8)
    for (const button of await list.getByRole('button', { name: '찜으로 바꾸기' }).all()) await expect(button).toBeVisible()
    void postJson
  })

  test('AC-S06-64: 잠긴 버튼은 마우스를 올려도 모양이 그대로, 버튼 명암비 보통 4.5:1·잠김 3:1 이상', async ({ page }) => {
    await login(page)
    await page.goto('/sms')
    const submit = page.getByRole('button', { name: '문자찜 넣기' })
    await expect(submit).toBeDisabled()
    const style = () => submit.evaluate((el) => {
      const s = getComputedStyle(el)
      return `${s.backgroundColor}|${s.color}|${s.borderColor}`
    })
    // 화면이 자료를 받으며 버튼을 다시 그릴 수 있다 — 붙어 있는 버튼의 모양을 읽는다 (흔들림 고침: 떨어진 요소의 계산 모양은 빈 글자)
    // 흔들림 고침(STAB): 확인한 뒤 다시 읽으면 그 사이 다시 그려져 빈 값을 읽을 수 있다 — 붙어 있고 잠긴 버튼에서 두 번 연달아 같은 빈 값 아닌 모양을 읽은 그 값을 기준으로 쓴다
    await expect(submit).toBeVisible()
    await expect(submit).toBeDisabled()
    let before = ''
    let last = ''
    await expect
      .poll(async () => {
        const now = await style()
        const stable = now !== '||' && now === last
        last = now
        if (stable) before = now
        return stable
      })
      .toBe(true)
    await submit.hover({ force: true })
    await expect.poll(style).toBe(before) // 올려 둔 채 모양이 바뀌면 계속 다르다
    const ratios = await page.evaluate(() => {
      const parse = (c: string): [number, number, number, number] => {
        const m = /rgba?\(([^)]+)\)/.exec(c)
        if (m === null) return [0, 0, 0, 1]
        const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number)
        return [p[0]!, p[1]!, p[2]!, p[3] ?? 1]
      }
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => {
          const s = v / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
      }
      const bgOf = (el: Element | null): [number, number, number] => {
        for (let cur = el; cur !== null; cur = cur.parentElement) {
          const c = parse(getComputedStyle(cur).backgroundColor)
          if (c[3] > 0.5) return [c[0], c[1], c[2]]
        }
        return [255, 255, 255]
      }
      const out: { name: string; disabled: boolean; ratio: number }[] = []
      for (const el of document.querySelectorAll('button')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0) continue
        const fg = parse(getComputedStyle(el).color)
        const bg = bgOf(el)
        const a = lum(fg)
        const b = lum(bg)
        out.push({ name: (el.textContent ?? '').trim(), disabled: el.disabled, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) })
      }
      return out
    })
    const bad = ratios.filter((x) => x.ratio < (x.disabled ? 3 : 4.5)).map((x) => `${x.name}${x.disabled ? '(잠김)' : ''} ${x.ratio.toFixed(2)}`)
    expect(bad).toEqual([])
  })
})
