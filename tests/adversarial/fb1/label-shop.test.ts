// FB1 적대 시험 (test-domain): 라벨 가게 이름 — 비면 그 판매자의 가게 이름 (AC-FB1-27·89, LABEL_RULES L-11 13, D-FB1-07).
// 두 판매자 A·B(B는 템플릿 가게 이름이 빈 글 또는 보이지 않는 글자뿐)에서 이름 바꾸기·저장·조회·출력 기기 작업·포장 라벨 그림을 엇갈려 해도
// B 쪽 어디에도 A의 가게 이름·템플릿 이름이 나오지 않는다. 다른 판매자의 템플릿은 고칠 수 없다(판매자 ID는 세션에서만 — 지금 그대로).
import { computeProductText, defaultTemplate, type LabelTemplate } from '@livejjim/label'
import { describe, expect, it } from 'vitest'
import { getFile } from '../../../apps/server/test/i2-support.ts'
import { DAY, DEVICE_A, DEVICE_B, becomeDevice, chat, printApi, register } from '../../../apps/server/test/print-support.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

type Kind = 'product' | 'packing'
type Served = Record<Kind, { template: LabelTemplate; version: number; storedShopName: string }>

const rename = async (world: TestServer, seller: Seller, name: string) => expectOk(client(world, seller.cookie).put('/api/shop', { name }))
const served = async (world: TestServer, seller: Seller): Promise<{ body: Served; text: string }> => {
  const r = await expectOk(client(world, seller.cookie).get('/api/print/templates'))
  return { body: r.body as unknown as Served, text: r.text }
}

async function sale(world: TestServer, seller: Seller, device: string, channel: string): Promise<void> {
  const b = await createBroadcast(world, seller, { date: DAY })
  await register(world, seller, b.id, 15, '핑크프릴', 10000)
  await chat(world, seller, b.id, channel, '홍길동', '15')
  await becomeDevice(world, seller, device)
}

describe('TD-FB1 라벨 가게 이름 두 판매자 (AC-FB1-27·89)', () => {
  it('B의 템플릿 가게 이름이 빈 글·공백·전각 공백·보이지 않는 글자뿐이면 B의 가게 이름 — A의 이름은 B의 조회·작업·그림 어디에도 없다', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const b = await addSeller(world)
    await rename(world, a, '에이농원')
    await rename(world, b, '비농원')
    await expectOk(printApi(world, a).put('/api/print/templates/product', { template: { ...defaultTemplate('product'), shopName: '에이라벨' }, version: 0 }))
    await expectOk(printApi(world, a).put('/api/print/templates/packing', { template: { ...defaultTemplate('packing'), shopName: '' }, version: 0 }))
    await sale(world, a, DEVICE_A, 'UC_A')
    await sale(world, b, DEVICE_B, 'UC_A')
    let version = 0
    for (const blank of ['', ' ', '　　', '\t\n', '​', '​‍﻿']) {
      const put = await expectOk(printApi(world, b).put('/api/print/templates/product', { template: { ...defaultTemplate('product'), shopName: blank }, version }))
      version = (put.body as { version: number }).version
      expect((put.body as { template: LabelTemplate }).template.shopName, JSON.stringify(blank)).toBe('비농원')
      expect((put.body as { storedShopName: string }).storedShopName).toBe(blank)
      const read = await served(world, b)
      expect(read.body.product.template.shopName, JSON.stringify(blank)).toBe('비농원')
      for (const word of ['에이농원', '에이라벨']) expect(read.text).not.toContain(word)
    }
    // B의 출력 기기 작업: 글 계산 결과 맨 위 = 비농원
    const job = await printApi(world, b).claim(DEVICE_B)
    expect(job.job?.kind).toBe('product')
    expect(job.job?.template.shopName).toBe('비농원')
    const text = computeProductText(job.job?.template, job.job?.data)
    expect(text.ok && text.text.items.shop).toBe('비농원')
    expect(JSON.stringify(job)).not.toMatch(/에이/)
    // A의 작업은 A의 템플릿 이름
    const jobA = await printApi(world, a).claim(DEVICE_A)
    expect(jobA.job?.template.shopName).toBe('에이라벨')
    expect(JSON.stringify(jobA)).not.toMatch(/비농원/)
    // 포장 라벨 그림: A(빈 포장 템플릿)는 A의 가게 이름, B는 B — 두 그림은 다르다
    const pngA = await getFile(world, a.cookie, `/api/days/${DAY}/packing-label.png?buyer=UC_A&page=1`)
    const pngB = await getFile(world, b.cookie, `/api/days/${DAY}/packing-label.png?buyer=UC_A&page=1`)
    expect(pngA.status).toBe(200)
    expect(pngB.status).toBe(200)
    expect(Buffer.from(pngA.bytes).equals(Buffer.from(pngB.bytes))).toBe(false)
  })

  it('A가 가게 이름을 여러 번 바꾸는 동안 B가 동시에 조회해도 B에는 B의 이름만 (판매자마다 따로 읽는다)', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const b = await addSeller(world)
    await rename(world, b, '비농원')
    const names = Array.from({ length: 8 }, (_, i) => `에이${String(i)}호점`)
    const results = await Promise.all([...names.map((name) => rename(world, a, name)), ...Array.from({ length: 8 }, () => served(world, b))])
    for (const r of results.slice(names.length) as { body: Served; text: string }[]) {
      expect(r.body.product.template.shopName).toBe('비농원')
      expect(r.body.packing.template.shopName).toBe('비농원')
      expect(r.text).not.toContain('에이')
    }
    const last = await served(world, a)
    expect(names).toContain(last.body.product.template.shopName)
  })

  it('B는 A의 템플릿을 고칠 수 없다 — 본문에 판매자 칸을 넣어도 모르는 칸(400), A의 판·이름은 그대로', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const b = await addSeller(world)
    await rename(world, a, '에이농원')
    await expectOk(printApi(world, a).put('/api/print/templates/product', { template: { ...defaultTemplate('product'), shopName: '에이라벨' }, version: 0 }))
    for (const body of [
      { template: { ...defaultTemplate('product'), shopName: '빼앗음' }, version: 1, sellerId: a.sellerId },
      { template: { ...defaultTemplate('product'), shopName: '빼앗음', sellerId: a.sellerId }, version: 1 },
    ]) {
      const r = await printApi(world, b).put('/api/print/templates/product', body)
      expect(r.status, r.text).toBe(400)
    }
    // 판 번호를 맞춰 보내도 B 자신의 템플릿(판 0)에 대한 충돌일 뿐 — A는 그대로
    const r = await printApi(world, b).put('/api/print/templates/product', { template: { ...defaultTemplate('product'), shopName: '빼앗음' }, version: 1 })
    expect(r.status).toBe(409)
    const readA = await served(world, a)
    expect(readA.body.product).toMatchObject({ version: 1, storedShopName: '에이라벨', template: { shopName: '에이라벨' } })
    expect(readA.text).not.toContain('빼앗음')
  })
})
