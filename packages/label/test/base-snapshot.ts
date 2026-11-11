// O3 다육 회귀 고정값 도구 (AC-O3-02·AC-O3-06 — 테스트 파일 아님). O3 전(BASE) 라벨 골든 파일 네 개의 데이터로
// 그린 1비트 그림의 해시와 내용 키를 모은다. 이 도구는 O3 전에도 있던 함수만 쓴다 — BASE 커밋의 src로도 같은 모양으로 돌아
// `base-o3.json`(BASE 렌더 결과)을 만들 수 있다. 시험은 지금 코드로 다시 모은 값이 그 고정값과 같은지 본다.
//
// 고정값 다시 만들기는 gen-base-snapshot.ts 머리말 (BASE src로 — 지금 src로 만들면 회귀 시험이 아니다).
// D-STB-01(기본 상품 템플릿 날짜 칸 x 292→290 · 폭 88→90) 뒤로는 BASE 고정값을 옛 기본 템플릿(`revertStbDateBox`)으로 그려 맞추고,
// 새 기본 템플릿으로 달라진 그림만 `base-o3-stb.json`(gen-stb-snapshot.ts)에 새 고정값으로 더한다.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALL_LABEL_SIZES,
  PACKING_LABEL_SIZES,
  canMakePackingLabel,
  defaultTemplate,
  isLabelSize,
  labelContentKey,
  renderPackingLabels,
  renderProductLabel,
  type LabelBitmap,
  type LabelRenderEnv,
  type LabelSizeId,
  type LabelTemplate,
} from '../src/index.ts'

/** O3 전부터 있던 라벨 골든 파일 (O3가 더한 product-options·packing-options는 빼고) */
export const BASE_GOLDEN_FILES = ['packing.json', 'product-sized.json', 'product.json'] as const

const GOLDEN_DIR = join(import.meta.dirname, '..', '..', '..', 'tests', 'golden', 'label')

export interface BaseCase {
  readonly id: string
  readonly kind: 'product' | 'packing'
  readonly template?: Record<string, unknown>
  readonly data: unknown
}

/** 기존 라벨 골든의 상품·포장 사례 (오류 사례 포함 — 오류도 그대로여야 한다) */
export function baseCases(): BaseCase[] {
  const out: BaseCase[] = []
  for (const file of BASE_GOLDEN_FILES) {
    const raw = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8')) as { kind: string; cases: Record<string, unknown>[] }
    if (raw.kind !== 'product' && raw.kind !== 'packing') continue
    for (const c of raw.cases) out.push({ id: c.id as string, kind: raw.kind, template: c.template as Record<string, unknown> | undefined, data: c.data })
  }
  return out
}

/** 기본 템플릿 만들기 — 보통은 `defaultTemplate`, 옛 고정값 확인에는 옛 기본 템플릿(`revertStbDateBox`) */
export type DefaultsOf = (kind: 'product' | 'packing', size?: LabelSizeId) => LabelTemplate

// 글자 크기 50 도입 전에 저장된 상품 설정. 당시 비트맵·JSON 고정값으로 호환성을 검증한다.
export const beforeLargeFont: DefaultsOf = (kind, size) => {
  const t = defaultTemplate(kind, size)
  if (t.kind !== 'product') return t
  const pair = { '50x30': [28, 28], '50x20': [24, 24], '50x40': [36, 32], '50x50': [40, 36], '50x15': [30, 30],
    tape12x40: [24, 24], tape15x30: [24, 24], tape15x50: [24, 24] } as const
  const [name, buyer] = pair[t.size]
  return { ...t, items: { ...t.items, name: { ...t.items.name, fontSize: name }, buyer: { ...t.items.buyer, ...(t.size === '50x30' ? { y: 180, height: 54 } : {}), fontSize: buyer } } }
}

const currentDefaults: DefaultsOf = (kind, size) => defaultTemplate(kind, size)

/** D-STB-01로 바뀐 기본 상품 템플릿(50×20·30·40·50)의 날짜 칸 */
export const STB_DATE_SIZES: readonly LabelSizeId[] = ['50x20', '50x30', '50x40', '50x50']
export const STB_DATE_BOX = { now: { x: 290, width: 90 }, before: { x: 292, width: 88 } } as const

/**
 * D-STB-01 전 기본 템플릿: 지금 기본 템플릿에서 네 크기 상품 템플릿 날짜 칸의 x·폭 두 값만 옛 값으로 되돌린다.
 * 바뀐 것이 그 두 값뿐이라야 하므로, 지금 값이 새 값이 아니면 던진다.
 */
export const revertStbDateBox: DefaultsOf = (kind, size) => {
  const t = beforeLargeFont(kind, size)
  if (t.kind !== 'product' || !STB_DATE_SIZES.includes(t.size)) return t
  const date = t.items.date
  if (date.x !== STB_DATE_BOX.now.x || date.width !== STB_DATE_BOX.now.width) throw new Error(`${t.size} 날짜 칸이 D-STB-01 값이 아니다`)
  return { ...t, items: { ...t.items, date: { ...date, ...STB_DATE_BOX.before } } }
}

/** 골든 시험과 같은 템플릿 짓기 (README "size 덮어쓰기") */
export function templateFor(kind: 'product' | 'packing', overrides: Record<string, unknown> = {}, defaults: DefaultsOf = currentDefaults): Record<string, unknown> {
  const size = overrides.size
  const start =
    size === undefined
      ? defaults(kind)
      : !isLabelSize(size)
        ? { ...defaults(kind), size }
        : kind === 'packing' && !canMakePackingLabel(size)
          ? { ...defaults('packing'), size }
          : defaults(kind, size)
  const base = structuredClone(start) as unknown as Record<string, unknown>
  const items = base.items as Record<string, Record<string, unknown>>
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'size') continue
    if (key === 'visible') {
      for (const [id, visible] of Object.entries(value as Record<string, unknown>)) items[id] = { ...(items[id] ?? {}), visible }
    } else base[key] = value
  }
  return base
}

export function bitmapHash(image: LabelBitmap): string {
  return createHash('sha256').update(`${String(image.width)}x${String(image.height)}:`).update(image.data).digest('hex').slice(0, 32)
}

/** 템플릿 이름 → 템플릿: 사례의 템플릿 하나 + 크기마다의 기본 템플릿 */
export function templatesOf(c: BaseCase, defaults: DefaultsOf = currentDefaults): [string, Record<string, unknown>][] {
  const sizes: readonly string[] = c.kind === 'product' ? ALL_LABEL_SIZES : PACKING_LABEL_SIZES
  return [['case', templateFor(c.kind, c.template, defaults)], ...sizes.map((size): [string, Record<string, unknown>] => [size, templateFor(c.kind, { size }, defaults)])]
}

/** 데이터 하나를 템플릿으로 그린 결과 글: 오류 코드(·항목) 또는 쪽마다 그림 해시 */
export function renderSignature(env: LabelRenderEnv, kind: 'product' | 'packing', template: unknown, data: unknown): string {
  if (kind === 'product') {
    const r = renderProductLabel(env, template, data)
    return r.ok ? bitmapHash(r.image) : `error:${r.error.code}:${r.error.item ?? ''}`
  }
  const r = renderPackingLabels(env, template, data)
  return r.ok ? r.pages.map((p) => bitmapHash(p.image)).join(',') : `error:${r.error.code}:${r.error.item ?? ''}`
}

export function keySignature(kind: 'product' | 'packing', data: unknown): string {
  const r = labelContentKey(kind, data)
  return r.ok ? r.key : `error:${r.error.code}`
}

export interface BaseSnapshot {
  /** `<사례 ID> <템플릿 이름>` → 그림 서명 */
  readonly renders: Record<string, string>
  /** 사례 ID → 내용 키 */
  readonly keys: Record<string, string>
}

export function collectSnapshot(env: LabelRenderEnv, transform: (c: BaseCase) => unknown = (c) => c.data, defaults: DefaultsOf = currentDefaults): BaseSnapshot {
  const renders: Record<string, string> = {}
  const keys: Record<string, string> = {}
  for (const c of baseCases()) {
    const data = transform(c)
    keys[c.id] = keySignature(c.kind, data)
    for (const [name, template] of templatesOf(c, defaults)) renders[`${c.id} ${name}`] = renderSignature(env, c.kind, template, data)
  }
  return { renders, keys }
}
