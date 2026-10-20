// 출력 화면 시험 도우미: 서버 출력 계약 모양(harness/sprints/I1/dev-notes.md "dev-server > 바뀐 계약")의 값 만들기.
import { LABEL_FONT_FAMILY, defaultTemplate, parseLabelFont, type LabelCanvas2D, type LabelRenderEnv } from '@livejjim/label'
import type { JobView, LabelView, PrintOverview, QueueSummary, Templates } from '../src/api/print-types.ts'
import { DATE } from './support.ts'

/** 대기열 요약 — 라벨 기능은 기본 켬(서버 기본, N4a dev-notes "dev-server > 바뀐 계약" 2) */
export function queue(patch: Partial<QueueSummary> = {}): QueueSummary {
  return { rev: 1, device: null, pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled: true, ...patch }
}

export function device(id: string, patch: Partial<NonNullable<QueueSummary['device']>> = {}): NonNullable<QueueSummary['device']> {
  return { id, name: 'PC', live: true, printerConnected: true, releasing: false, ...patch }
}

export function job(id: string, patch: Partial<JobView> = {}): JobView {
  return {
    id,
    date: DATE,
    kind: 'product',
    reason: 'auto',
    status: 'WAITING',
    word: '작업 대기',
    voided: false,
    discard: false,
    discardedAt: null,
    attempts: 0,
    lastError: null,
    label: { key: `c-${id}@1`, claim: `c-${id}`, version: 1, broadcast: 'b1', no: 15, buyerId: null, buyer: { kind: 'youtube', name: '우주천사' } },
    page: null,
    pages: null,
    data: { no: 15, name: '핑크프릴', price: 10000, date: DATE, buyer: { kind: 'youtube', name: '우주천사' } },
    device: null,
    printedAt: null,
    createdAt: '2026-10-19T11:00:00.000Z',
    ...patch,
  }
}

export function labelView(key: string, patch: Partial<LabelView> = {}): LabelView {
  const [claim, version] = key.split('@')
  return {
    key,
    claim: claim ?? null,
    version: Number(version ?? '1'),
    broadcast: 'b1',
    no: 15,
    buyerId: null,
    buyer: { kind: 'youtube', name: '우주천사' },
    date: DATE,
    kind: 'product',
    state: 'NONE',
    word: '',
    voided: false,
    discard: 0,
    reprintNeeded: false,
    printed: 0,
    history: [],
    winner: true,
    data: { no: 15, name: '핑크프릴', price: 10000, date: DATE, buyer: { kind: 'youtube', name: '우주천사' } },
    canPrint: true,
    canReprint: false,
    ...patch,
  }
}

export function overview(patch: Partial<PrintOverview> = {}): PrintOverview {
  return { queue: queue(), jobs: [], discard: [], ...patch }
}

export function templates(): Templates {
  return { product: { template: defaultTemplate('product'), version: 0 }, packing: { template: defaultTemplate('packing'), version: 0 } }
}

interface NodeCanvasModule {
  readonly GlobalFonts: { register(font: Uint8Array, family: string): unknown }
  createCanvas(width: number, height: number): { getContext(kind: '2d'): unknown }
}

/** 이 설정(jsdom·DOM 타입)에는 Node 타입이 없다 — 시험이 쓰는 Node 기본 모듈 몇 개만 좁게 적는다 */
interface NodeBuiltins {
  readonly module: { createRequire(from: string): ((id: string) => unknown) & { resolve(id: string): string } }
  readonly fs: { readFileSync(path: string): Uint8Array }
  readonly buffer: { Buffer: { from(bytes: Uint8Array): Uint8Array } }
}

function builtin<K extends keyof NodeBuiltins>(name: K): NodeBuiltins[K] {
  const runtime = globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }
  return runtime.process.getBuiltinModule(`node:${name}`) as NodeBuiltins[K]
}

let jsdomEnv: LabelRenderEnv | null = null

/**
 * jsdom 시험에서 쓰는 Node 캔버스 렌더 환경 (@livejjim/label/node와 같은 글꼴·캔버스).
 * jsdom 변환은 그 진입점의 글꼴 경로(import.meta.url)를 화면 주소로 바꾸므로, 글꼴 파일은 패키지 내보내기('@livejjim/label/font')로 찾고
 * 캔버스는 라벨 패키지의 의존성에서 불러온다.
 */
export function jsdomLabelEnv(): LabelRenderEnv {
  if (jsdomEnv !== null) return jsdomEnv
  const { createRequire } = builtin('module')
  const fontPath = createRequire(import.meta.url).resolve('@livejjim/label/font')
  const canvas = createRequire(fontPath)('@napi-rs/canvas') as NodeCanvasModule
  const bytes = new Uint8Array(builtin('fs').readFileSync(fontPath))
  if (canvas.GlobalFonts.register(builtin('buffer').Buffer.from(bytes), LABEL_FONT_FAMILY) === null) throw new Error('내장 글꼴을 Node 캔버스에 등록하지 못했다')
  jsdomEnv = { font: parseLabelFont(bytes, LABEL_FONT_FAMILY), createContext: (width, height) => canvas.createCanvas(width, height).getContext('2d') as LabelCanvas2D }
  return jsdomEnv
}
