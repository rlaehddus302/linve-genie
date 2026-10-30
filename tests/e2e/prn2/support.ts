// PRN2 E2E 공용 도우미 (test-e2e). 근거: harness/sprints/PRN2/acceptance.md AC-PRN2-06~10, docs/spec/LABEL_RULES.md L-7 "지원 단계"·L-11 10·13·17.
// 시험마다 새 판매자(loginNewSeller) — 출력 기기·템플릿이 다른 시험과 섞이지 않는다.
import { expect, type Page } from '@playwright/test'
import { gotoLabels, printed, region, TEST_PRINTER, waitPrinted } from '../i1/support.ts'

export { loginNewSeller, openRealBroadcast } from '../i3/support.ts'
export { postJson, registerApi, smsApi } from '../i1/support.ts'
export { gotoLabels, printed, printedCount, region, scopeLabels, TEST_PRINTER, waitPrinted } from '../i1/support.ts'

/** L-7 "지원 단계" 안내 한 줄 — {앱}은 프로필의 대체 경로 앱 */
export const experimentalNotice = (app: string): string =>
  `실험 중인 프린터예요. 테스트 인쇄가 잘 나오는지 꼭 확인해 주세요. 잘 안 나오면 라벨을 그림 파일로 ${app}에서 인쇄해 주세요.`
export const BAUATO_APP = 'Luck Jingle 앱'
/** L-7 PRN2 개정 — 켠 프로필 ID와 화면 이름 */
export const BAUATO = { id: 'BAUATO_PPA2L', name: '바우아토 스티코팝', sizes: ['50×30mm', '50×15mm', '50×50mm'] } as const
export const D110 = { id: 'NIIMBOT_D110', sizes: ['테이프 12×40mm', '테이프 15×30mm', '테이프 15×50mm'] } as const
export const B1_SIZES = ['50×30mm', '50×20mm', '50×40mm'] as const

type Handle = { setTestProfile(id: string | null): boolean }

/** 시험용 프린터가 흉내 낼 기종 (null = B1). 이어져 있으면 먼저 끊긴다. */
export async function setTestProfile(page: Page, id: string | null): Promise<void> {
  await expect.poll(() => page.evaluate(() => 'livejjimTestPrinter' in window)).toBe(true)
  const ok = await page.evaluate((p) => (window as unknown as { livejjimTestPrinter: Handle }).livejjimTestPrinter.setTestProfile(p), id)
  expect(ok, `프로필 ${String(id)}`).toBe(true)
}

/** 라벨 화면에서 기종을 정하고 시험용 프린터에 잇는다 (출력 기기는 아직 아님) */
export async function connectAs(page: Page, id: string | null): Promise<void> {
  await gotoLabels(page)
  await setTestProfile(page, id)
  const printer = region(page, '프린터')
  await printer.getByRole('button', { name: TEST_PRINTER }).click()
  await expect(printer.getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
}

/** 테스트 인쇄 → "예" (실험 기종 출력 기기 조건) */
export async function confirmTestPrint(page: Page): Promise<void> {
  const printer = region(page, '프린터')
  const before = (await printed(page)).length
  await printer.getByRole('button', { name: '테스트 인쇄' }).click()
  await waitPrinted(page, before + 1)
  await printer.getByRole('group', { name: '테스트 인쇄 결과' }).getByRole('button', { name: '예' }).click()
}

/** 연결한 프린터로 이 기기를 출력 기기로 (실험 기종이면 테스트 인쇄 "예" 먼저) */
export async function becomeOutputDevice(page: Page, name: string, experimental: boolean): Promise<void> {
  const printer = region(page, '프린터')
  if (experimental) await confirmTestPrint(page)
  await printer.getByLabel('기기 이름').fill(name)
  await printer.getByRole('button', { name: '이 기기에서 출력' }).click()
  await expect(printer.getByText('이 기기가 출력 기기예요')).toBeVisible()
}

export async function queueOf(page: Page): Promise<{ device: { profileId: string | null } | null; labelSizes: string[]; pause: { reason: string } | null }> {
  const res = await page.request.get('/api/print')
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { queue: { device: { profileId: string | null } | null; labelSizes: string[]; pause: { reason: string } | null } }).queue
}

