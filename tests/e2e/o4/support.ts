// O4 E2E 공용 도우미 (test-e2e) — 옵션 주문 끝까지(댓글 → 확인 필요 → 라벨 → 확인서 → 판매대장 → 포장)와 다육 회귀.
// 기대값은 harness/sprints/O4/acceptance.md와 골든 tests/golden/engine/25-o4-integration.yaml(G-ENG-O4-01~03)에서 정했다.
// 화면 낱말·역할은 harness/sprints/O4/dev-notes.md "다음(test-e2e)에게".
import { expect, type Page } from '@playwright/test'
import { postJson, writeEvent, type OptionItem } from '../o2/support.ts'

export * from '../o2/support.ts'
export { packingCommand, packingList, downloadBytes, xlsxRows, pdfPages, pngSize } from '../i2/support.ts'
export { dateLongKo, phoneLike, uniq } from '../s06b/support.ts'

/** G-ENG-O4-01 반바지 (사이즈 S·M(엠)·L, 재고 M 1·L 2) */
export const SHORTS = {
  no: 21,
  name: '반바지',
  price: 10000,
  stocks: { M: 1, L: 2 },
  options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M', aliases: ['엠'] }, { label: 'L' }] }] as OptionItem[],
}

/** G-ENG-O4-01 반팔티 (사이즈 95·100·105(+2,000) × 색상 흰색(화이트)·검정색(검정·블랙), 105/검정색 재고 2) */
export const TEE = {
  no: 22,
  name: '반팔티',
  price: 15000,
  stocks: { '105/검정색': 2 },
  options: [
    { name: '사이즈', choices: [{ label: '95' }, { label: '100' }, { label: '105', price: 2000 }] },
    { name: '색상', choices: [{ label: '흰색', aliases: ['화이트'] }, { label: '검정색', aliases: ['검정', '블랙'] }] },
  ] as OptionItem[],
}

/** 라벨 기능 켬/끔 (N4a) */
export async function setLabels(page: Page, enabled: boolean): Promise<void> {
  const res = await page.request.put('/api/settings/labels', { data: { enabled }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.status(), await res.text()).toBe(200)
}

/** 방송자 조치 (API) — 화면 흐름이 아닌 준비용 */
export async function hostAction(page: Page, event: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await writeEvent(page, event)
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  return res.body
}

/** 리허설 생성기 시작 (POST /api/broadcasts/:b/rehearsal/generator/start) */
export async function startGenerator(page: Page, b: string, opts: { total: number; perSecond: number; seed: number }): Promise<void> {
  const res = await postJson(page, `/api/broadcasts/${b}/rehearsal/generator/start`, opts)
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

export interface GeneratorState { running: boolean; sent: number; total: number; [key: string]: unknown }

export async function generatorState(page: Page, b: string): Promise<GeneratorState> {
  const res = await page.request.get(`/api/broadcasts/${b}/rehearsal/generator`)
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { generator: GeneratorState }).generator
}

/** 생성기가 total건을 다 보내고 멈출 때까지 */
export async function waitGeneratorDone(page: Page, b: string, total: number, timeout = 90_000): Promise<void> {
  await expect.poll(async () => { const g = await generatorState(page, b); return [g.running, g.sent] }, { timeout }).toEqual([false, total])
}

/** 포장 라벨 데이터 (GET /api/days/:date/packing-label) */
export async function packingLabelData(page: Page, date: string, buyer: string): Promise<{ data: { broadcasts: { title: string; numbers: unknown[] }[]; subtotal: number } }> {
  const res = await page.request.get(`/api/days/${date}/packing-label?buyer=${encodeURIComponent(buyer)}`)
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as never
}

/** 채팅 패널 (콘솔) */
export function chatPanel(page: Page) {
  return page.getByRole('region', { name: '채팅', exact: true })
}
