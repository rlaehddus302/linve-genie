// N4a E2E 공용 도우미 (test-e2e) — 라벨 끄기 모드.
// 선택자는 역할·이름 기반(harness/sprints/N4a/dev-notes.md "test-e2e에게 — 화면 이름·조작").
// 모든 E2E가 시험 계정 하나를 함께 쓴다 — 시험마다 끝에 cleanupN4a로 라벨 기능을 켠 채 출력 기록을 비운다.
import { expect, type Page } from '@playwright/test'
import { cleanupPrint, printOverview } from '../i1/support.ts'

export * from '../i1/support.ts'

export const OFF_NOTE = '라벨 쓰지 않음 — 설정에서 켤 수 있어요.'
export const OFF_REFUSAL = '라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.'
export const TURNED_OFF = '라벨 기능을 껐어요.'
export const TURNED_ON = "라벨 기능을 켰어요. 끈 동안 1등이 된 상품의 라벨은 저절로 출력되지 않아요. 필요하면 상품에서 '라벨 출력'을 눌러 주세요."
export const SWITCH_HELP = '끄면 라벨 화면·프린터 연결·자동 출력·다시 출력·포장 라벨 출력·라벨 그림 파일 내려받기가 모두 숨겨져요. 판매 판정과 감사 메시지는 그대로예요. 방송 중에 바꿔도 바꾼 때부터 적용돼요.'
export function offWaiting(n: number): string {
  return `출력 대기 중인 라벨 ${String(n)}장은 출력하지 않고 남겨 둬요. 다시 켜면 '출력 시작'을 눌러 이어서 출력할 수 있어요.`
}
export function backlogWord(n: number): string {
  return `대기 중인 라벨 ${String(n)}장이 있어요. 출력 시작을 누르면 먼저 들어온 것부터 출력해요.`
}

export interface LabelSettingsBody {
  enabled: boolean
  history: { enabled: boolean; at: string; loginId: string }[]
  waiting: number
  rev: number
  changed?: boolean
}

/** 라벨 기능 켜기/끄기 (API) */
export async function setLabels(page: Page, enabled: boolean): Promise<LabelSettingsBody> {
  if (!page.url().startsWith('http')) await page.goto('/')
  const res = await page.request.put('/api/settings/labels', { data: { enabled }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.status(), await res.text()).toBe(200)
  return await res.json() as LabelSettingsBody
}

export async function labelSettings(page: Page): Promise<LabelSettingsBody> {
  const res = await page.request.get('/api/settings/labels')
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as LabelSettingsBody
}

/** 시험 끝 정리: 켜기 → 모두 빼기 → (I1 정리: 버렸어요·다시 시작·자동 출력 켬) */
export async function cleanupN4a(page: Page): Promise<void> {
  if (!page.url().startsWith('http')) return
  await page.request.put('/api/settings/labels', { data: { enabled: true }, headers: { Origin: new URL(page.url()).origin } })
  await cleanupPrint(page)
  const ov = await printOverview(page)
  expect((ov.queue as unknown as { labelsEnabled: boolean }).labelsEnabled).toBe(true)
}

/** 위 줄 "설정" 링크 */
export function settingsLink(page: Page) {
  return page.getByRole('banner').getByRole('link', { name: '설정', exact: true })
}

export function labelSection(page: Page) {
  return page.getByRole('region', { name: '라벨', exact: true })
}

/** 앱 안 이동으로 설정 화면 (전체 새로고침은 프린터 연결을 버린다) */
export async function gotoSettings(page: Page): Promise<void> {
  await settingsLink(page).click()
  await expect(page.getByRole('heading', { name: '설정', level: 1 })).toBeVisible()
  await expect(labelSection(page).getByText(/^라벨 기능: (켜짐|꺼짐)$/)).toBeVisible()
}

/** 라벨 조작(이름) — 꺼져 있거나 모를 때 하나도 없어야 한다 */
export const LABEL_CONTROL = /^(라벨 출력|다시 출력|포장 라벨 출력|그림 파일로 저장|PDF로 저장|라벨 크기 PDF|공유|테스트 인쇄|이 기기에서 출력|출력 시작|다시 시작|다시 연결|라벨 설정 저장|A4)/

/** 창 밖 주 버튼 수 (AC-S06b-24 표시) */
export async function primaryOutsideDialogs(page: Page): Promise<string[]> {
  return await page.evaluate(() => [...document.querySelectorAll('.button-primary')]
    .filter((el) => el.closest('[role="dialog"],dialog') === null)
    .filter((el) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' })
    .map((el) => (el.textContent ?? '').trim()))
}
