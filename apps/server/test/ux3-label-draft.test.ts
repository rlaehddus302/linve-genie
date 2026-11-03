// 저장 전 상품 라벨 초안 미리 보기 (D-UX3-19, 사용자 지시 2026-11-03 "라벨 디자인 커스텀 한 다음에 테스트 출력"): 앱 방송 시작 라벨 단계는 캔버스가 없어
// 서버가 받은 초안을 견본 값으로 그려 PNG로 준다. 저장과 같은 검사, 가장 긴 값이 안 들어가면 문장만, DB에는 아무것도 쓰지 않는다.
import { LONGEST_PRODUCT, SAMPLE_PRODUCT, defaultTemplate, encodeLabelPng, renderProductLabel } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { describe, expect, it } from 'vitest'
import { kstDate } from '../src/time.ts'
import { addSeller, client, expectOk, newWorld } from './support.ts'

const PATH = '/api/print/templates/product/preview'

describe('D-UX3-19 상품 라벨 초안 미리 보기', () => {
  it('받은 초안 + 견본 값(오늘 날짜)으로 그린 PNG — 비운 가게 이름은 설정 "가게" 이름, 템플릿은 저장하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await expectOk(api.put('/api/shop', { name: '초록다육' }))
    const draft = { ...defaultTemplate('product', '50x40'), priceStyle: 'WON' as const }
    const res = await expectOk(api.post(PATH, { template: draft }))
    const body = res.body as { width: number; height: number; png: string; longest: string | null }
    const expected = renderProductLabel(createNodeRenderEnv(), { ...draft, shopName: '초록다육' }, { ...SAMPLE_PRODUCT, date: kstDate(Number(world.clock.now())) })
    if (!expected.ok) throw new Error(expected.error.code)
    const png = encodeLabelPng(expected.image)
    if (!png.ok) throw new Error(png.error.code)
    expect(body).toMatchObject({ width: expected.image.width, height: expected.image.height, png: Buffer.from(png.bytes).toString('base64') })
    expect(body.longest === null || typeof body.longest === 'string').toBe(true)
    const stored = await world.database.pglite?.query('select 1 from label_templates where seller_id = $1', [seller.sellerId])
    expect(stored?.rows ?? []).toHaveLength(0)
  })

  it('가장 긴 값이 칸에 안 들어가면 그 항목의 문장 (미리 보기는 그대로)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const base = defaultTemplate('product')
    const tight = { ...base, items: { ...base.items, name: { ...base.items.name, fontSize: 120, minFontSize: 120 } } }
    const longest = renderProductLabel(createNodeRenderEnv(), tight, LONGEST_PRODUCT)
    const res = await client(world, seller.cookie).post(PATH, { template: tight })
    if (longest.ok) expect(res.body).toMatchObject({ longest: null })
    else if (res.status === 200) expect((res.body as { longest: string }).longest).toMatch(/칸이 좁아/)
    else expect(res.status).toBe(422)
  })

  it('틀린 초안·다른 칸은 400, 포장 라벨은 이 길이 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect((await api.post(PATH, { template: { kind: 'product' } })).status).toBe(400)
    expect((await api.post(PATH, { template: defaultTemplate('packing') })).status).toBe(400)
    expect((await api.post(PATH, { template: defaultTemplate('product'), version: 1 })).status).toBe(400)
    expect((await api.post(PATH, { template: { ...defaultTemplate('product'), shopName: '가'.repeat(41) } })).status).toBe(400)
    expect((await api.post('/api/print/templates/packing/preview', { template: defaultTemplate('packing') })).status).toBe(404)
  })
})

describe('D-UX3-19 초안 크기 바꾸기 (resize)', () => {
  it('새 크기의 기본 칸 + 끈 항목·가게 이름·가격 표기는 그대로, 끌 수 없는 칸은 켬 — 고친 초안을 같이 준다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const base = defaultTemplate('product')
    const draft = { ...base, shopName: '다육상회', priceStyle: 'WON' as const, items: { ...base.items, date: { ...base.items.date, visible: false } } }
    const res = await expectOk(client(world, seller.cookie).post(PATH, { template: draft, resize: '50x40' }))
    const fresh = defaultTemplate('product', '50x40')
    const template = (res.body as { template: typeof fresh }).template
    expect(template).toEqual({ ...fresh, shopName: '다육상회', priceStyle: 'WON', items: { ...fresh.items, date: { ...fresh.items.date, visible: false } } })
    expect((await client(world, seller.cookie).post(PATH, { template: draft, resize: '40x40' })).status).toBe(400)
  })
})
