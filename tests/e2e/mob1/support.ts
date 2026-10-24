// MOB1 E2E 공용 도우미 (test-e2e) — 휴대폰 점검 바로 고칠 것 (acceptance.md AC-MOB1-90).
// 기기: 375×812(크로미움), 412×915(크로미움 터치 — 안드로이드 흉내), 393×852 WebKit(@webkit 묶음 — devices['iPhone 15']), 1440×900.
// 글자 150%는 점검과 같은 방법: 화면에 `html { font-size: 150% !important }`(공통 전제). 새로 열 때마다 들어가게 addInitScript로 넣는다.
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { login } from '../s05/support.ts'
import { loginAs } from '../i3/support.ts'

export const PHONE = { width: 375, height: 812 } as const
export const ANDROID = { width: 412, height: 915 } as const
export const PC = { width: 1440, height: 900 } as const

/** 안드로이드 크롬 사용자 에이전트 (AC-MOB1-24 기본 이름 "안드로이드 폰") */
export const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
/** 아이폰 사파리 사용자 에이전트 (크로미움에서 아이폰 흉내 — AC-MOB1-20 "또는 사용자 에이전트에 iPhone") */
export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

export interface DeviceOptions {
  readonly viewport?: { readonly width: number; readonly height: number }
  /** 터치 휴대폰 (isMobile·hasTouch) */
  readonly touch?: boolean
  readonly userAgent?: string
  /** 글자 150% */
  readonly big?: boolean
}

/** 지금 묶음의 화면 주소 */
export function baseUrlOf(page: Page): string {
  return new URL(page.url()).origin
}

/** 새 컨텍스트 (같은 화면 주소) */
export async function newDevice(browser: Browser, baseURL: string, options: DeviceOptions = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL,
    viewport: options.viewport ?? PHONE,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    ...(options.touch === true ? { isMobile: true, hasTouch: true } : {}),
    ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
  })
  if (options.big === true) await bigText(context)
  return { context, page: await context.newPage() }
}

/** 새 컨텍스트에서 시험 계정(또는 주어진 계정)으로 로그인 */
export async function deviceLoggedIn(browser: Browser, baseURL: string, options: DeviceOptions = {}, account?: { loginId: string; password: string }): Promise<Page> {
  const { page } = await newDevice(browser, baseURL, options)
  if (account === undefined) await login(page)
  else await loginAs(page, account)
  return page
}

/** 글자 150% (공통 전제 — 점검과 같은 방법). 문서마다 다시 넣는다 */
export async function bigText(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    const put = () => {
      if (document.getElementById('mob1-big-text') !== null) return
      const style = document.createElement('style')
      style.id = 'mob1-big-text'
      style.textContent = 'html { font-size: 150% !important }'
      ;(document.head ?? document.documentElement).appendChild(style)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', put)
    else put()
  })
}

/** 글자 150%가 실제로 들어갔는가 (기본 16px × 1.5 = 24px) */
export async function expectBig(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBe(24)
}

/**
 * 가로 넘침 0 (공통 전제): `document.documentElement.scrollWidth ≤ window.innerWidth`이고 보이는 버튼·칸·링크의 오른쪽 끝 ≤ 화면 폭, 왼쪽 끝 ≥ 0.
 * "보이는"은 넘침을 자르는 조상(overflow ≠ visible)으로 잘린 뒤 남는 부분이 있는 것 — 잘려 안 보이는 부분은 재지 않는다
 * (휴대폰 알림 띠는 접힌 동안 한 줄에 들어가는 것만 보인다 — AlertStrip 설계). 넘친 요소가 있으면 그 요소의 글을 실패 문장에.
 */
export async function expectNoOverflow(page: Page, where: string): Promise<void> {
  const found = await page.evaluate(() => {
    const width = window.innerWidth
    const out: string[] = []
    const doc = document.documentElement.scrollWidth
    if (doc > width) out.push(`문서 scrollWidth ${String(doc)} > ${String(width)}`)
    const items = document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role=button], [role=link]')
    for (const el of items) {
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      let left = r.left
      let right = r.right
      let top = r.top
      let bottom = r.bottom
      for (let p = el.parentElement; p !== null && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p)
        if (ps.overflowX !== 'visible' || ps.overflowY !== 'visible' || ps.clip !== 'auto' && ps.clip !== '') {
          const pr = p.getBoundingClientRect()
          left = Math.max(left, pr.left)
          right = Math.min(right, pr.right)
          top = Math.max(top, pr.top)
          bottom = Math.min(bottom, pr.bottom)
        }
      }
      if (right - left <= 0.5 || bottom - top <= 0.5) continue
      if (right > width + 0.5 || left < -0.5) {
        const text = (el.getAttribute('aria-label') ?? el.textContent ?? (el as HTMLInputElement).value ?? el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60)
        out.push(`${el.tagName.toLowerCase()} "${text}" ${String(Math.round(left))}~${String(Math.round(right))} (폭 ${String(width)})`)
      }
    }
    return out
  })
  expect(found, `${where}: 가로 넘침`).toEqual([])
}

/** 요소의 계산된 배경·글자 색 */
export async function colorsOf(target: Locator): Promise<{ bg: string; color: string }> {
  return await target.evaluate((el) => {
    const s = getComputedStyle(el)
    return { bg: s.backgroundColor, color: s.color }
  })
}

/** "rgb(…)"/"rgba(…)" → [r,g,b,a] */
export function parseRgb(text: string): [number, number, number, number] {
  const m = /rgba?\(([^)]+)\)/.exec(text)
  if (m === null) throw new Error(`색이 아니다: ${text}`)
  const parts = m[1]!.split(/[\s,/]+/).filter((x) => x !== '').map(Number)
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1]
}

/** WCAG 대비 (배경이 반투명이면 흰 바탕에 겹친 색으로) */
export function contrast(fg: string, bg: string): number {
  const over = (c: [number, number, number, number]): [number, number, number] => [0, 1, 2].map((i) => c[i]! * c[3] + 255 * (1 - c[3])) as [number, number, number]
  const lum = ([r, g, b]: [number, number, number]) => {
    const ch = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
  }
  const back = over(parseRgb(bg))
  const fc = parseRgb(fg)
  const front: [number, number, number] = [0, 1, 2].map((i) => fc[i]! * fc[3] + back[i]! * (1 - fc[3])) as [number, number, number]
  const [a, b] = [lum(front), lum(back)].sort((x, y) => y - x) as [number, number]
  return (a + 0.05) / (b + 0.05)
}

/** 알림 띠 */
export function alerts(page: Page): Locator {
  return page.getByRole('region', { name: '알림' })
}

/** 화면에 보이는 글(개발 용어·영어 상태값 검사용 — AC-I3-45와 같은 방식: 보이는 글자 전체) */
export async function visibleText(page: Page): Promise<string> {
  return await page.evaluate(() => document.body.innerText)
}

/** 개발 용어·영어 상태값 (AC-MOB1-90) — 화면 어디에도 없어야 한다 */
export const DEV_WORDS = /TRY_PHONE_YOUTUBE|DISCONNECTED|JSON|NOT_CONNECTED|RECONNECT_NEEDED|undefined|null|NaN|\[object/

export async function expectNoDevWords(page: Page, where: string): Promise<void> {
  const text = await visibleText(page)
  const hit = DEV_WORDS.exec(text)
  expect(hit?.[0] ?? null, `${where}: 화면에 개발 용어 (${hit === null ? '' : text.slice(Math.max(0, hit.index - 30), hit.index + 30)})`).toBeNull()
}

/** 방송을 API로 끝낸다 (다른 기기에서 끝낸 것과 같다) */
export async function endBroadcastApi(page: Page, b: string): Promise<void> {
  const res = await page.request.post(`/api/broadcasts/${encodeURIComponent(b)}/end`, { data: { requestId: crypto.randomUUID() }, headers: { Origin: baseUrlOf(page) } })
  expect(res.ok(), await res.text()).toBe(true)
}

/** 라벨 기능 켜기·끄기 (API) */
export async function setLabelsApi(page: Page, on: boolean): Promise<void> {
  const res = await page.request.put('/api/settings/labels', { data: { enabled: on }, headers: { Origin: baseUrlOf(page) } })
  expect(res.ok(), await res.text()).toBe(true)
}

/** 새 판매자를 만들어 새 컨텍스트에서 로그인하고 마법사를 닫아 둔다 (시험끼리 방송 목록이 섞이지 않게 — 로그아웃 확인 창은 판매자의 방송 전체를 본다) */
export async function freshSeller(browser: Browser, baseURL: string, options: DeviceOptions = {}): Promise<{ page: Page; context: BrowserContext; seller: { loginId: string; password: string; shopName: string } }> {
  const { newSeller } = await import('../i3/support.ts')
  const { page, context } = await newDevice(browser, baseURL, options)
  const seller = await newSeller(page.request)
  await loginAs(page, seller, '/settings')
  const res = await page.request.put('/api/wizard', { data: { status: 'DONE' }, headers: { Origin: baseUrlOf(page) } })
  expect(res.ok(), await res.text()).toBe(true)
  return { page, context, seller }
}

/** 실제(또는 리허설) 방송을 API로 만든다 — 화면은 옮기지 않는다 */
export async function broadcastApi(page: Page, date: string, rehearsal = false, title?: string): Promise<string> {
  const res = await page.request.post('/api/broadcasts', { data: { requestId: crypto.randomUUID(), date, rehearsal, ...(title === undefined ? {} : { title }) }, headers: { Origin: baseUrlOf(page) } })
  const body = (await res.json()) as Record<string, unknown>
  expect(res.status(), JSON.stringify(body)).toBeLessThan(300)
  const b = (body['result'] as Record<string, unknown> | undefined)?.['b'] ?? (body['broadcast'] as Record<string, unknown> | undefined)?.['id'] ?? body['b'] ?? body['id']
  if (typeof b !== 'string') throw new Error(`방송 ID 없음: ${JSON.stringify(body)}`)
  return b
}
