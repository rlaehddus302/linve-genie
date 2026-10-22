// O4 E2E 공용 도우미 (test-e2e) — 옵션 주문 끝까지(댓글 → 확인 필요 → 라벨 → 확인서 → 판매대장 → 포장)와 다육 회귀.
// 기대값은 harness/sprints/O4/acceptance.md와 골든 tests/golden/engine/25-o4-integration.yaml(G-ENG-O4-01~03)에서 정했다.
// 화면 낱말·역할은 harness/sprints/O4/dev-notes.md "다음(test-e2e)에게".
import { computeProductText, renderProductLabel } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { expect, type Locator, type Page } from '@playwright/test'
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

// ── 라벨 그림 비교 (AC-O4-15·33 — I1 files.spec.ts 방식) ─────────────────────

export type Bits = { width: number; height: number; data: number[] }

/** 미리 보기 캔버스(정수 배)를 1비트 바이트로 */
export async function canvasBits(canvas: Locator): Promise<Bits> {
  return await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement
    const scale = Number(c.dataset['scale'])
    const width = Number(c.dataset['width'])
    const height = Number(c.dataset['height'])
    const ctx = c.getContext('2d')!
    const img = ctx.getImageData(0, 0, c.width, c.height).data
    const row = Math.ceil(width / 8)
    const data = new Array<number>(row * height).fill(0)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = ((y * scale) * c.width + x * scale) * 4
      const lum = ((img[i] ?? 255) + (img[i + 1] ?? 255) + (img[i + 2] ?? 255)) / 3
      if (lum < 128) data[y * row + (x >> 3)]! |= 0x80 >> (x & 7)
    }
    return { width, height, data }
  })
}

/** PNG 바이트를 브라우저에서 읽어 1비트 바이트로 */
export async function pngBits(page: Page, bytes: Buffer): Promise<Bits> {
  return await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }))
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    const row = Math.ceil(bmp.width / 8)
    const data = new Array<number>(row * bmp.height).fill(0)
    for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) {
      const i = (y * bmp.width + x) * 4
      if (((img[i] ?? 255) + (img[i + 1] ?? 255) + (img[i + 2] ?? 255)) / 3 < 128) data[y * row + (x >> 3)]! |= 0x80 >> (x & 7)
    }
    return { width: bmp.width, height: bmp.height, data }
  }, bytes.toString('base64'))
}

/** 판매자의 지금 상품 라벨 템플릿 (GET /api/print/templates) */
export async function productTemplate(page: Page): Promise<unknown> {
  const res = await page.request.get('/api/print/templates')
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { product: { template: unknown } }).product.template
}

/** 라벨 데이터의 글 자리 (같은 패키지 함수 — L-3) */
export function productLabelItems(template: unknown, data: unknown): Record<string, string> {
  const r = computeProductText(template, data)
  if (!r.ok) throw new Error(`라벨 글을 만들지 못함: ${r.error.message}`)
  return { ...r.text.items } as Record<string, string>
}

/** Node 캔버스로 그린 상품 라벨 (글자 가장자리 점은 브라우저와 조금 다르다 — 가까움 비교에만 쓴다) */
export function nodeProductBits(template: unknown, data: unknown): Bits {
  const r = renderProductLabel(createNodeRenderEnv(), template, data)
  if (!r.ok) throw new Error(`라벨을 그리지 못함: ${r.error.message}`)
  return { width: r.image.width, height: r.image.height, data: [...r.image.data] }
}

/** 두 1비트 그림의 다른 점 수 (크기가 다르면 무한대) */
export function bitsDiff(a: Bits, b: Bits): number {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return Number.POSITIVE_INFINITY
  let n = 0
  for (let i = 0; i < a.data.length; i++) for (let x = (a.data[i]! ^ b.data[i]!) & 0xff; x !== 0; x >>= 1) n += x & 1
  return n
}
