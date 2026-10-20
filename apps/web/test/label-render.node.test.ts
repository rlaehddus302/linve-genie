// @vitest-environment node
// 라벨 그리기·검사·파일 이름 (AC-I1-25·26·40~42): 미리 보기 = 출력 그림(같은 렌더러), 저장 전 최악값 검사, 파일 이름에 사람 정보 없음.
// 렌더 환경은 Node 캔버스(@livejjim/label/node — 같은 내장 글꼴)다.
import { bitmapsEqual, defaultTemplate, renderPackingLabels, type LabelTemplate, type PackingTemplate, type ProductTemplate } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { describe, expect, it } from 'vitest'
import {
  LONGEST_PRODUCT,
  SAMPLE_PACKING,
  SAMPLE_PRODUCT,
  broadcastA4Name,
  checkTemplate,
  labelErrorMessage,
  longestPacking,
  packingPdfName,
  packingPngName,
  productPdfName,
  productPngName,
  renderJob,
  renderProduct,
  renderSample,
  waitingA4Name,
} from '../src/lib/label-render.ts'

const env = createNodeRenderEnv()

function withItem<T extends LabelTemplate>(template: T, id: string, patch: Record<string, number | boolean>): T {
  const items = template.items as Record<string, object>
  return { ...template, items: { ...items, [id]: { ...items[id], ...patch } } } as T
}

describe('미리 보기 = 출력 그림 (AC-I1-25)', () => {
  it('같은 데이터·템플릿이면 출력 기기가 그리는 그림과 점 하나까지 같다', () => {
    const template = { ...defaultTemplate('product'), shopName: '다육농장' }
    const preview = renderProduct(env, template, SAMPLE_PRODUCT)
    const printed = renderJob(env, { kind: 'product', template, data: SAMPLE_PRODUCT, page: null })
    expect(preview.ok && printed.ok).toBe(true)
    if (preview.ok && printed.ok) expect(bitmapsEqual(preview.image, printed.image)).toBe(true)
  })

  it('포장 작업은 요청 때의 쪽을 그린다', () => {
    const template: PackingTemplate = { ...defaultTemplate('packing'), perPage: 1 }
    const pages = renderPackingLabels(env, template, SAMPLE_PACKING)
    const second = renderJob(env, { kind: 'packing', template, data: SAMPLE_PACKING, page: 2 })
    expect(pages.ok && second.ok).toBe(true)
    if (pages.ok && second.ok) expect(bitmapsEqual(pages.pages[1]?.image ?? second.image, second.image)).toBe(true)
    const missing = renderJob(env, { kind: 'packing', template, data: SAMPLE_PACKING, page: 9 })
    expect(missing.ok).toBe(false)
  })

  it('견본: 판매자 샘플(194번 · 왕비뇌신금 · 8,000원)과 가장 긴 값 — 포장은 첫 쪽·마지막 쪽', () => {
    expect(SAMPLE_PRODUCT).toEqual({ no: 194, name: '왕비뇌신금', price: 8000, date: '2026-10-08', buyer: { kind: 'youtube', name: '우주천사' } })
    expect(renderSample(env, defaultTemplate('product'), false).ok).toBe(true)
    expect(renderSample(env, defaultTemplate('product'), true).ok).toBe(true)
    const packing = renderSample(env, defaultTemplate('packing'), true)
    expect(packing.ok && packing.images.length).toBe(2)
    expect(longestPacking().broadcasts.reduce((sum, b) => sum + b.numbers.length, 0)).toBe(999)
    expect(LONGEST_PRODUCT.no).toBe(9999)
  })
})

describe('저장 전 검사 (AC-I1-26)', () => {
  it('기본 템플릿(세 크기)은 최악값이 들어간다', () => {
    for (const size of ['50x30', '50x20', '50x40'] as const) {
      for (const style of ['THOUSAND', 'WON'] as const) expect(checkTemplate(env, { ...defaultTemplate('product', size), priceStyle: style, shopName: '다육농장' }).ok, `${size} ${style}`).toBe(true)
      expect(checkTemplate(env, { ...defaultTemplate('packing', size), shopName: '다육농장' }).ok, size).toBe(true)
    }
  })

  it('가격 칸을 좁히면 최악값(99,999,999원)이 들어가지 않아 저장하지 않고 그 항목을 알린다', () => {
    const narrow = withItem(defaultTemplate('product') as ProductTemplate, 'price', { width: 40 })
    const result = checkTemplate(env, narrow)
    expect(result.ok).toBe(false)
    expect('doesNotFit' in result ? result.doesNotFit : '').toBe('가격 칸이 좁아 라벨을 만들 수 없어요. 칸을 넓히거나 최소 글자 크기를 줄여 주세요.')
  })

  it('포장 번호 목록 칸이 한 장 번호 수만큼의 네 자리 번호를 못 담으면 알린다', () => {
    const many: PackingTemplate = { ...defaultTemplate('packing'), perPage: 40 }
    const result = checkTemplate(env, many)
    expect(result.ok).toBe(false)
    expect('doesNotFit' in result ? result.doesNotFit : '').toContain('번호 목록 칸이 좁아')
  })

  it('검사 오류(끌 수 없는 항목 끄기·한 장 번호 수 밖)는 문제마다 문장으로', () => {
    const off = withItem(defaultTemplate('product') as ProductTemplate, 'number', { visible: false })
    const result = checkTemplate(env, off)
    expect('problems' in result ? result.problems.map((p) => p.message) : []).toEqual(['번호는 끌 수 없어요.'])
    const zero = checkTemplate(env, { ...defaultTemplate('packing'), perPage: 0 })
    expect('problems' in zero ? zero.problems.map((p) => p.message) : []).toEqual(['한 장에 넣을 번호 수는 1~40 사이로 정해 주세요.'])
  })

  it('겹침은 경고만 — 저장할 수 있다', () => {
    const overlap = withItem(defaultTemplate('product') as ProductTemplate, 'shop', { y: 50 })
    const result = checkTemplate(env, overlap)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('라벨 오류 문장: DOES_NOT_FIT은 항목 문장', () => {
    expect(labelErrorMessage({ code: 'DOES_NOT_FIT', message: 'x', item: 'name' })).toBe('품종 칸이 좁아 라벨을 만들 수 없어요. 칸을 넓히거나 최소 글자 크기를 줄여 주세요.')
  })
})

describe('파일 이름 (AC-I1-40~42)', () => {
  it('날짜·번호·쪽·순번만 — 구매자 이름·메모·전화번호 없음', () => {
    expect(productPngName('2026-10-18', 15)).toBe('라벨-2026-10-18-15번.png')
    expect(productPdfName('2026-10-18', 15)).toBe('라벨-2026-10-18-15번.pdf')
    expect(broadcastA4Name('2026-10-18', 1)).toBe('라벨-2026-10-18-1-A4.pdf')
    expect(waitingA4Name('2026-10-20')).toBe('라벨-대기-2026-10-20-A4.pdf')
    expect(packingPngName('2026-10-18', 2)).toBe('포장라벨-2026-10-18-2쪽.png')
    expect(packingPdfName('2026-10-18')).toBe('포장라벨-2026-10-18.pdf')
  })
})
