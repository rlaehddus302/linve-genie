// QS1 E2E 공용 도우미 (test-e2e) — 프린터 다시 잇기(D-QS1-01~03).
// 기대 문장은 docs/spec/LABEL_RULES.md L-7 오류 표·연결 상태 낱말 그대로(D-QS1-05 — 새 화면 문장 없음).
// 시험 손잡이 이름은 harness/sprints/QS1/dev-notes.md "web — 시험 손잡이" 그대로.
// 시험마다 새 판매자(loginNewSeller) — 출력 기기·대기열이 다른 시험과 섞이지 않는다.
import { expect, type Page } from '@playwright/test'

export { loginNewSeller } from '../i3/support.ts'
export { becomeDevice, gotoLabels, printedCount, region, registerApi, realBroadcast, scopeLabels, smsApi, TEST_PRINTER, uniqueDate, waitPrinted, printOverview } from '../i1/support.ts'

/** L-7 연결 상태·오류 문장 (지금 있는 것만) */
export const DISCONNECTED = '프린터 연결이 끊겼어요.'
export const BLUETOOTH_OFF = '블루투스가 꺼져 있어요. 블루투스를 켠 뒤 다시 연결해 주세요.'
export const BLUETOOTH = '블루투스로 연결'
export const USB = 'USB 선으로 연결'
/** D-QS1-02 간격 (ms) — 1·2·4·8·16·30초 */
export const DELAYS = [1000, 2000, 4000, 8000, 16000, 30000] as const

export interface FakeB1Setup { getDevices?: boolean | 'throws'; permitted?: boolean; available?: boolean; adapterOff?: boolean; powered?: boolean }
export interface FakeB1State { requests: number; connectAttempts: number; connected: boolean; powered: boolean; permitted: boolean; getDevicesCalls: number }
export interface FakeUsbState { requests: number; getPortsCalls: number; connectAttempts: number; connected: boolean }

/** 시험 손잡이의 함수 하나를 부른다 */
export async function handle<T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return await page.evaluate(([fn, rest]) => {
    const h = (window as unknown as { livejjimTestPrinter: Record<string, (...a: unknown[]) => unknown> }).livejjimTestPrinter
    return h[fn as string]!(...(rest as unknown[]))
  }, [name, args] as const) as T
}

export async function waitHandle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => 'livejjimTestPrinter' in window)).toBe(true)
}

export const fakeB1State = (page: Page) => handle<FakeB1State | null>(page, 'fakeB1State')
export const fakeUsb = (page: Page) => handle<FakeUsbState | null>(page, 'fakeUsb')
export const autoAttempts = (page: Page) => handle<number>(page, 'autoReconnectAttempts')
export const autoWaiting = (page: Page) => handle<boolean>(page, 'autoReconnectWaiting')
export const setFakeB1 = (page: Page, setup: FakeB1Setup) => handle(page, 'setFakeB1', setup)

export function printer(page: Page) {
  return page.getByRole('region', { name: '프린터', exact: true })
}

export function stateLine(page: Page, word: '끊김' | '연결 중' | '연결됨' | '출력 중') {
  return printer(page).getByText(new RegExp(`^이 기기의 프린터: ${word}( \\(|$)`))
}

/** 라벨 화면을 열고 시험 손잡이가 생길 때까지 */
export async function openLabels(page: Page): Promise<void> {
  await page.goto('/labels')
  await expect(page.getByRole('heading', { name: '라벨', level: 1 })).toBeVisible()
  await waitHandle(page)
}

/** 연결 방법 단추로 잇고 "연결됨"까지 */
export async function connectBy(page: Page, method: string): Promise<void> {
  await printer(page).getByRole('button', { name: method, exact: true }).click()
  await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
}

/**
 * 저절로 다시 잇기 n번째 시도(1부터)를 브라우저 시계로 당겨 일으킨다 — 앞 시도가 끝나 다음 기다림이 잡힌 뒤에만 당긴다.
 * (시간이 아니라 상태를 기다린다: 시도 수가 n이 되고, 실패한 시도가 끝났는지)
 */
export async function fireAttempt(page: Page, n: number): Promise<void> {
  await expect.poll(() => autoWaiting(page)).toBe(true)
  await page.clock.fastForward(DELAYS[n - 1]!)
  await expect.poll(() => autoAttempts(page)).toBe(n)
}
