// SMS2 문자 자동 수신 시험 화면 E2E 도우미 (test-e2e).
// 시험 화면은 서버가 만드는 HTML이다(D-SMS2-01). 연습 모드(scripts/try/try.mjs)가 쓰는 것과 같은 상자(createSmsTestBox)와
// 같은 와이파이 http 받는 곳(createSmsTestHttpServer)을 시험 안에서 127.0.0.1·포트 0으로 띄우고, 휴대폰 대신 시험이 직접 POST한다(AC-SMS2-30 "상자를 띄운 시험 서버").
// 시계는 시험이 정한다(늦은 정도 기대값을 계산으로 고정 — 시간 기다림 없음).
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { expect, type Page } from '@playwright/test'
import { createSmsTestBox, createSmsTestHttpServer, makeSmsTestToken, SMS_TEST_PATH, type SmsTestBox } from '../../../apps/server/src/try/sms-test.ts'

export interface SmsBox {
  readonly token: string
  readonly origin: string
  /** 보기 화면 주소 (?t=토큰) */
  readonly viewUrl: string
  readonly box: SmsTestBox
  /** 서버 시계를 옮긴다 */
  setNow(at: Date): void
  now(): Date
  /** 휴대폰이 보내는 것처럼 받기 POST (머리글 X-Try-Token) */
  send(payload: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }>
  close(): Promise<void>
}

/** 서버 시계 시작값 — 한국 2026-10-26 14:03:08 */
export const START = new Date('2026-10-26T05:03:08.000Z')

export async function openSmsBox(): Promise<SmsBox> {
  const token = makeSmsTestToken()
  let clock = START
  const box = createSmsTestBox({ token, now: () => clock })
  const server: Server = createSmsTestHttpServer(box)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${String(port)}`
  return {
    token,
    origin,
    viewUrl: `${origin}${SMS_TEST_PATH}?t=${token}`,
    box,
    setNow(at) {
      clock = at
    },
    now: () => clock,
    async send(payload) {
      const res = await fetch(`${origin}${SMS_TEST_PATH}`, {
        method: 'POST',
        headers: { 'x-try-token': token, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return { status: res.status, json: (await res.json()) as Record<string, unknown> }
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** 서버 시각보다 ms만큼 앞선 휴대폰 시각 (ISO, Z) */
export function phoneAtBefore(box: SmsBox, ms: number): string {
  return new Date(box.now().getTime() - ms).toISOString()
}

/** 요약 안 기기 덩어리 (제목 "{기기} — 받은 문자 n건"으로 찾는다) */
export function group(page: Page, device: string) {
  return page.locator('.group').filter({ has: page.getByRole('heading', { level: 3, name: new RegExp(`^${device.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — 받은 문자 \\d+건$`) }) })
}

/** 보기 화면의 5초 새로고침(meta refresh)을 뗀 채로 받는다 — 크기를 재는 도중에 화면이 다시 열리지 않게(모양 시험만. 새로고침 자체는 flow 시험이 본다) */
export async function holdRefresh(page: Page): Promise<void> {
  await page.route('**/_try/sms-test**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const body = (await response.text()).replace(/<meta http-equiv="refresh"[^>]*>\n?/, '')
    await route.fulfill({ response, body })
  })
}

/** 뿌리 글자 150% (MOB1·LND1과 같은 방법 — 스타일 하나 더함. CSP style-src 'unsafe-inline'이라 막히지 않는다) */
export async function bigRoot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const put = () => {
      if (document.getElementById('sms2-big-text') !== null) return
      const style = document.createElement('style')
      style.id = 'sms2-big-text'
      style.textContent = 'html { font-size: 150% !important }'
      ;(document.head ?? document.documentElement).appendChild(style)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', put)
    else put()
  })
}

/** 가로 스크롤 0 (scrollWidth <= clientWidth) */
export async function expectNoSideScroll(page: Page, where: string): Promise<void> {
  const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(sizes.scroll, `${where}: 가로 스크롤 (scrollWidth ${String(sizes.scroll)} > clientWidth ${String(sizes.client)})`).toBeLessThanOrEqual(sizes.client)
}

/** 글이 잘리거나 화면 밖으로 나가지 않았는지 — 요소 오른쪽 끝이 화면 안, 넘침(scrollWidth > clientWidth) 없음 */
export async function expectNotCut(page: Page, texts: readonly RegExp[], where: string): Promise<void> {
  for (const pattern of texts) {
    const target = page.getByText(pattern).first()
    await expect(target, `${where}: ${String(pattern)}`).toBeVisible()
    const box = await target.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { right: r.right, left: r.left, scroll: el.scrollWidth, client: el.clientWidth, width: window.innerWidth }
    })
    expect(box.left, `${where}: ${String(pattern)} 왼쪽이 화면 밖`).toBeGreaterThanOrEqual(0)
    expect(box.right, `${where}: ${String(pattern)} 오른쪽이 화면 밖`).toBeLessThanOrEqual(box.width + 0.5)
    expect(box.scroll, `${where}: ${String(pattern)} 글이 칸을 넘침`).toBeLessThanOrEqual(box.client + 1)
  }
}
