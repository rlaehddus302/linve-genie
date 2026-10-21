// I1 E2E 공용 도우미 (test-e2e). 라벨·출력 화면 — 시험용 프린터(서버 시험 모드)로 돈다.
// 선택자는 역할·이름 기반(harness/sprints/I1/dev-notes.md "test-e2e에게 — 화면 이름·조작").
// 출력 기록은 판매자 단위라 시험마다 끝에 cleanupPrint를 부른다(뒤의 S05·S06 시험이 알림 띠를 본다).
import { expect, type Page, type Response } from '@playwright/test'
import { postJson } from '../s05/support.ts'
import { clickMenu } from '../menu.ts'

export * from '../s06/support.ts'

export const TEST_PRINTER = '시험용 프린터 — 실제로 출력되지 않아요'

export interface Queue {
  rev: number
  device: { id: string; name: string; live: boolean; printerConnected: boolean; releasing: boolean } | null
  pause: { reason: string; message: string; backlog: boolean } | null
  waiting: number
  printing: number
  discard: number
}
export interface Job {
  id: string
  date: string
  kind: string
  reason: string
  status: string
  word: string
  voided: boolean
  discard: boolean
  attempts: number
  lastError: { code: string; item?: string } | null
  label: { key: string; claim: string; version: number; no: number; buyer: { kind: string; name?: string } }
  data: Record<string, unknown> | null
  device: string | null
}
export interface Overview { queue: Queue; jobs: Job[]; discard: Job[] }
export interface LabelView {
  key: string
  claim: string
  version: number
  no: number
  state: string
  word: string
  printed: number
  reprintNeeded: boolean
  history: { at: string; device: string }[]
  canPrint: boolean
  canReprint: boolean
  winner: boolean
  data: Record<string, unknown> | null
  buyer: { kind: string; name?: string }
}

export async function printOverview(page: Page): Promise<Overview> {
  const res = await page.request.get('/api/print')
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as Overview
}

export async function scopeLabels(page: Page, date: string): Promise<LabelView[]> {
  const res = await page.request.get(`/api/print/labels?date=${date}`)
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { labels: LabelView[] }).labels
}

/** 시험용 프린터 손잡이 */
export async function printedCount(page: Page): Promise<number> {
  return await page.evaluate(() => (window as unknown as { livejjimTestPrinter: { printedCount(): number } }).livejjimTestPrinter.printedCount())
}
export async function printed(page: Page): Promise<{ width: number; height: number; data: number[] }[]> {
  return await page.evaluate(() => (window as unknown as { livejjimTestPrinter: { printed(): { width: number; height: number; data: number[] }[] } }).livejjimTestPrinter.printed())
}
export async function setBehavior(page: Page, n: number, behavior: 'disconnect' | 'fail' | { delayMs: number } | null): Promise<void> {
  await page.evaluate(([nth, b]) => {
    (window as unknown as { livejjimTestPrinter: { setBehavior(n: number, b: unknown): void } }).livejjimTestPrinter.setBehavior(nth as number, b)
  }, [n, behavior] as const)
}
export async function waitPrinted(page: Page, n: number, timeout = 30_000): Promise<void> {
  await expect.poll(() => printedCount(page), { timeout }).toBe(n)
}

export function region(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true })
}

/** 앱 안 이동으로 라벨 화면 (메뉴 링크 — 전체 새로고침은 프린터 연결을 버린다) */
export async function gotoLabels(page: Page): Promise<void> {
  if (!new URL(page.url()).pathname.startsWith('/labels')) {
    // 휴대폰이면 "더보기"를 열고 "라벨" (앱 안 이동 그대로 — AC-NAV-06·10)
    await clickMenu(page, '라벨')
  }
  await expect(page.getByRole('heading', { name: '라벨', level: 1 })).toBeVisible()
}

/** 라벨 화면에서 시험용 프린터에 잇고 이 기기를 출력 기기로 (다른 기기가 출력 기기면 바꾸기) */
export async function becomeDevice(page: Page, name: string): Promise<{ backlog: boolean }> {
  await gotoLabels(page)
  const printer = region(page, '프린터')
  await expect(page.evaluate(() => 'livejjimTestPrinter' in window)).resolves.toBe(true)
  if (!(await printer.getByText('이 기기의 프린터: 연결됨').isVisible())) {
    await printer.getByRole('button', { name: TEST_PRINTER }).click()
    await expect(printer.getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
  }
  await printer.getByLabel('기기 이름').fill(name)
  const isDevice = (r: Response) => new URL(r.url()).pathname === '/api/print/device' && r.request().method() === 'POST' && r.status() === 200
  const ok = page.waitForResponse(isDevice)
  await printer.getByRole('button', { name: '이 기기에서 출력' }).click()
  const dlg = page.getByRole('dialog', { name: '출력 기기 바꾸기' })
  const mine = printer.getByText('이 기기가 출력 기기예요')
  await expect(dlg.or(mine)).toBeVisible()
  if (await dlg.isVisible()) {
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await page.keyboard.press('1')
  }
  const res = await ok
  await expect(mine).toBeVisible()
  return { backlog: (await res.json() as { backlog: boolean }).backlog }
}

/** 시험 끝 정리 (dev-notes "시험끼리 출력 기록이 섞이지 않게") */
export async function cleanupPrint(page: Page): Promise<void> {
  if (!page.url().startsWith('http')) return
  // 결과가 오지 않는 출력 중 작업(TE-I1-002 등)은 정리용 기기로 바꿔 대기로 되돌린 뒤 내려놓는다
  if ((await printOverview(page)).queue.printing > 0) await postJson(page, '/api/print/device', { deviceId: 'e2e-cleanup-device', name: '정리', replace: true })
  await postJson(page, '/api/print/device/release', {})
  await postJson(page, '/api/print/jobs/cancel-all', { confirm: true })
  for (let round = 0; round < 3; round += 1) {
    const ov = await printOverview(page)
    for (const job of ov.discard) await postJson(page, '/api/print/jobs/discard', { date: job.date, id: job.id })
    if (ov.queue.pause !== null) await postJson(page, '/api/print/restart', {})
    if (ov.discard.length === 0 && ov.queue.pause === null && ov.queue.printing === 0) break
    await postJson(page, '/api/print/jobs/cancel-all', { confirm: true })
  }
  await page.request.patch('/api/settings', { data: { settings: { 'print.autoOnConfirm': true } }, headers: { Origin: new URL(page.url()).origin } })
}

/** 같은 날 실제 방송 열기 (API로 만들고 콘솔로) */
export async function realBroadcast(page: Page, date: string, title?: string): Promise<string> {
  const { openNewBroadcast } = await import('../s05/support.ts')
  return await openNewBroadcast(page, { date, rehearsal: false, ...(title === undefined ? {} : { title }) })
}
