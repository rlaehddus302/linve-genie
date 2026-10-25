// QL3R1 E2E 공용 도우미 (test-e2e) — 품질 3회차 1회차 고칠 것 (harness/sprints/QL3R1/acceptance.md).
// 기대값은 acceptance.md의 따옴표 문장에서 정했다(구현을 보고 정하지 않음).
// 기기: 375×812·412×915 크로미움(터치), 393×852 WebKit(@webkit 묶음 — devices['iPhone 15']), PC 1440×900. 글자 150%는 공통 전제(`html { font-size: 150% }`).
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { uniqueDate } from '../s05/support.ts'
import { registerApi, scopeView, smsApi, viewerClaim, writeEvent } from '../s06/support.ts'
import { IPHONE_UA } from '../mob1/support.ts'
import { ANDROID, PC, PHONE, baseUrlOf, barHeight, broadcastApi, expectBig, freshSeller, setLabelsApi } from '../ql2/support.ts'

export { ANDROID, IPHONE_UA, PC, PHONE, barHeight }
export const IPHONE = { width: 393, height: 852 } as const

export type Viewport = { readonly width: number; readonly height: number }

/** 기기 하나 (이름은 시험 제목·실패 문장용) */
export interface Device {
  readonly label: string
  readonly viewport: Viewport
  readonly userAgent?: string
}
export const D375: Device = { label: '375×812', viewport: PHONE }
export const D412: Device = { label: '412×915', viewport: ANDROID }
export const D393: Device = { label: '393×852 WebKit', viewport: IPHONE, userAgent: IPHONE_UA }
export const D1440: Device = { label: '1440×900', viewport: PC }

export interface Seller {
  readonly dev: Page
  readonly context: BrowserContext
  readonly seller: { loginId: string; password: string; shopName: string }
  readonly close: () => Promise<void>
}

/** 새 판매자를 그 기기·글자 크기로 (시험끼리 방송·출력 기록이 섞이지 않게) */
export async function sellerOn(browser: Browser, page: Page, device: Device, big: boolean): Promise<Seller> {
  await page.goto('/')
  const phone = device.viewport.width < 768
  const { page: dev, context, seller } = await freshSeller(browser, baseUrlOf(page), {
    viewport: device.viewport,
    touch: phone,
    big,
    ...(device.userAgent === undefined ? {} : { userAgent: device.userAgent }),
  })
  return { dev, context, seller, close: () => context.close() }
}

/** 콘솔을 열고 빠른 입력이 보일 때까지 */
export async function openConsole(dev: Page, b: string, big: boolean): Promise<void> {
  await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(dev.getByLabel('빠른 입력')).toBeVisible()
  if (big) await expectBig(dev)
}

/** 수량을 정해 API로 상품 등록 */
export async function registerStock(dev: Page, b: string, no: number, name: string, price: number, stock: number): Promise<void> {
  const res = await writeEvent(dev, { type: 'product.register', b, no, name, price, stock })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

/**
 * AC-QL3R1-01 Given: 상품 1번(수량 1)에 1등 1명과 대기 2명, 배경을 600px 이상 내릴 수 있게 상품을 더 둔다.
 * 리허설이면 채팅 닉네임 "밤톨맘"·"대기하나"·"대기둘", 실제 방송이면 문자찜 메모(같은 이름이 구매자 이름 안에 든다).
 */
export async function productOneWorld(dev: Page, opts: { rehearsal?: boolean; extra?: number } = {}): Promise<{ b: string; date: string }> {
  const date = uniqueDate()
  const rehearsal = opts.rehearsal === true
  const b = await broadcastApi(dev, date, rehearsal)
  await setLabelsApi(dev, false)
  await registerStock(dev, b, 1, '핑크프릴', 10000, 1)
  const names = ['밤톨맘', '대기하나', '대기둘']
  for (const [i, name] of names.entries()) {
    if (rehearsal) await viewerClaim(dev, b, name, '1', `sim_ql3r1_${String(i)}_${String(Date.now())}`)
    else await smsApi(dev, { b, no: 1, memo: name })
  }
  for (let no = 2; no <= 1 + (opts.extra ?? 12); no += 1) await registerApi(dev, b, no, `품종${String(no)}`, 1000 * no)
  // 판정이 끝나 1등 1·대기 2가 된 뒤
  await expect
    .poll(async () => {
      const view = await scopeView(dev, date, rehearsal)
      const claims = view.claims.filter((c) => c.no === 1)
      return `${String(claims.filter((c) => c.status === 'CONFIRMED').length)}/${String(claims.filter((c) => c.status === 'WAITLISTED').length)}`
    })
    .toBe('1/2')
  return { b, date }
}

/** 상품 보드의 번호 카드 단추 (s05 boardItem과 같은 선택자) */
export function boardCard(dev: Page, no: number): Locator {
  return dev.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: new RegExp(`^${String(no)}번 `) })
}

/** 요소의 화면 상자 (getBoundingClientRect) */
export async function rectOf(target: Locator): Promise<{ top: number; bottom: number; left: number; right: number; height: number; width: number }> {
  return await target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width }
  })
}

/** 문서 기준 위 끝 (스크롤 더함) */
export async function docTop(target: Locator): Promise<number> {
  return await target.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
}

/** 화면 안 보이는 글 줄 수 (Range.getClientRects 줄 위 끝을 모아 셈) */
export async function lineCount(target: Locator): Promise<number> {
  return await target.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return new Set([...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0).map((x) => Math.round(x.top))).size
  })
}

/** 위아래·옆 잘림 수치 */
export async function clipOf(target: Locator): Promise<{ sh: number; ch: number; sw: number; cw: number; text: string }> {
  return await target.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth, text: (el.textContent ?? '').trim().slice(0, 60) }))
}
