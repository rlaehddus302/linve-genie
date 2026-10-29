import { defaultTemplate, renderProductLabel, renderTestLabel } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { describe, expect, it, vi } from 'vitest'
import * as printStore from '../src/print-store.ts'
import { DAY, DEVICE_A, DEVICE_B, chat, printApi, register, settled } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, writeEvent } from './support.ts'

async function claimedLabel() {
  const world = await newWorld()
  const seller = await addSeller(world)
  const broadcast = await createBroadcast(world, seller, { date: DAY })
  await register(world, seller, broadcast.id, 15, '핑크프릴', 10000)
  await chat(world, seller, broadcast.id, 'UC_A', '홍길동', '15')
  const api = printApi(world, seller)
  await expectOk(api.register(DEVICE_A, '휴대폰'))
  await expectOk(api.restart())
  const { job } = await api.claim(DEVICE_A)
  if (job === null) throw new Error('출력할 라벨이 없다')
  const url = `/api/print/jobs/${encodeURIComponent(job.id)}/bitmap?device=${DEVICE_A}&attempt=${job.attempt}`
  return { world, seller, api, job, url }
}

describe('APP2 서버 라벨 그림', () => {
  it('단일 키 미리보기는 날짜 전체 라벨·출력 이력을 읽지 않고 처음 이름·현재 품종·찜 금액을 보존한다', async () => {
    const { world, seller, api, job } = await claimedLabel()
    const b = job.label.broadcast!
    await api.done(DEVICE_A, job.attempt)
    await register(world, seller, b, 16)
    await chat(world, seller, b, 'UC_B', '김철수', '16')
    await chat(world, seller, b, 'UC_A', '새이름', '반가워요')
    await expectOk(writeEvent(world, seller, { type: 'product.update', b, no: 15, name: '핑크프릴 금' }))
    await expectOk(writeEvent(world, seller, { type: 'product.update', b, no: 15, price: 12000, applyTo: 'UNPAID_CLAIMS' }))
    const originalView = (await api.labels()).labels.find((label) => label.key === job.label.key)
    expect(originalView?.data).toMatchObject({ name: '핑크프릴 금', price: 12000, buyer: { kind: 'youtube', name: '홍길동' } })
    const expected = renderProductLabel(createNodeRenderEnv(), job.template, originalView?.data)
    if (!expected.ok) throw new Error('기준 그림을 만들지 못했다')
    await settled(world)
    const allLabels = vi.spyOn(printStore, 'scopeLabels')
    const histories = vi.spyOn(printStore, 'jobsOfLabels')
    try {
      const preview = await expectOk(api.api.get(`/api/print/preview/product?${new URLSearchParams({ date: DAY, ref: job.label.key })}`))
      const [image] = preview.body.images as Record<string, unknown>[]
      expect(image?.data === Buffer.from(expected.image.data).toString('base64')).toBe(true)
      expect(allLabels).not.toHaveBeenCalled()
      expect(histories).not.toHaveBeenCalled()
    } finally { allLabels.mockRestore(); histories.mockRestore() }
    expect((await api.labels()).labels.find((label) => label.key === job.label.key)).toEqual(originalView)
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b, no: 15, buyer: 'UC_A', reason: '구매자 요청' }))
    expect((await api.api.get(`/api/print/preview/product?${new URLSearchParams({ date: DAY, ref: job.label.key })}`)).status).toBe(404)
  })

  it('출력 작업이 아직 없는 1등도 현재 이름으로 같은 그림을 주며 승계 뒤 옛 확정 키는 거절한다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = printApi(world, seller)
    await expectOk(api.put('/api/settings/labels', { enabled: false }))
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15, '핑크프릴', 10000)
    await chat(world, seller, b.id, 'UC_A', '홍길동', '15')
    await chat(world, seller, b.id, 'UC_B', '김철수', '15')
    await chat(world, seller, b.id, 'UC_A', '새이름', '반가워요')
    const first = (await api.labels()).labels.find((label) => label.winner)
    expect(first).toMatchObject({ state: 'NONE', data: { buyer: { kind: 'youtube', name: '새이름' } } })
    const template = (await world.server.print.templates(seller.sellerId)).product.template
    const expected = renderProductLabel(createNodeRenderEnv(), template, first?.data)
    if (!expected.ok) throw new Error('기준 그림을 만들지 못했다')
    const path = `/api/print/preview/product?${new URLSearchParams({ date: DAY, ref: String(first?.key) })}`
    const before = await api.overview()
    const preview = await expectOk(api.api.get(path))
    expect((preview.body.images as Record<string, unknown>[])[0]?.data === Buffer.from(expected.image.data).toString('base64')).toBe(true)
    expect(await api.overview()).toEqual(before)
    expect((await api.labels()).labels).toEqual([first])
    const rows = await world.database.pglite!.query<{ count: number }>('select count(*)::int as count from print_labels where seller_id = $1', [seller.sellerId])
    expect(rows.rows[0]?.count).toBe(0)
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UC_A', reason: '구매자 요청' }))
    expect((await api.api.get(path)).status).toBe(404)
    const successor = (await api.labels()).labels.find((label) => label.winner)
    expect(successor?.key).not.toBe(first?.key)
    expect((await api.api.get(`/api/print/preview/product?${new URLSearchParams({ date: DAY, ref: String(successor?.key) })}`)).status).toBe(200)
  })

  it('출력 완료 뒤 미리보기는 같은 점을 주고 출력 이력·대기열은 바꾸지 않는다', async () => {
    const { api, job, url } = await claimedLabel()
    const printed = (await expectOk(api.api.get(url))).body
    await api.done(DEVICE_A, job.attempt)
    const before = await api.overview()
    const path = `/api/print/preview/product?${new URLSearchParams({ date: DAY, ref: job.label.key })}`
    const preview = await expectOk(api.api.get(path))
    expect(preview.headers.get('Cache-Control')).toBe('no-store')
    const [image] = preview.body.images as Record<string, unknown>[]
    expect(image?.width).toBe(printed.width)
    expect(image?.height).toBe(printed.height)
    expect(image?.data === printed.data).toBe(true)
    expect(await api.overview()).toEqual(before)
    expect((await api.api.get(url)).status).toBe(404)
    // 실제 라벨의 미리보기는 현재 설정으로, 완료한 옛 출력의 시도는 계속 닫혀 있다.
    await expectOk(api.put('/api/print/templates/product', { template: { ...defaultTemplate('product'), shopName: '새 가게' }, version: 0 }))
    const changed = (await expectOk(api.api.get(path))).body.images as Record<string, unknown>[]
    expect(changed[0]?.data === printed.data).toBe(false)
  })

  it('미리보기는 로그인·판매자·실제 날짜·현재 라벨 키를 검사한다', async () => {
    const { world, api, job } = await claimedLabel()
    const path = `/api/print/preview/product?${new URLSearchParams({ date: DAY, ref: job.label.key })}`
    expect((await world.server.app.request(path)).status).toBe(401)
    const other = await addSeller(world)
    expect((await client(world, other.cookie).get(path)).status).toBe(404)
    expect((await api.api.get(path.replace(DAY, '2026-10-20'))).status).toBe(404)
    expect((await api.api.get(`${path}&rehearsal=true`)).status).toBe(422)
    expect((await api.api.get('/api/print/preview/product?date=bad&ref=c1%401')).status).toBe(400)
    expect((await api.api.get(`/api/print/preview/product?date=${DAY}&ref=not-a-key`)).status).toBe(404)
  })

  it('포장 미리보기와 대기 작업 내보내기도 같은 서버 점이며 대기 작업의 쪽을 유지한다', async () => {
    const { api, job } = await claimedLabel()
    await api.done(DEVICE_A, job.attempt)
    await expectOk(api.packing(DAY, 'UC_A'))
    const overview = await api.overview()
    const waiting = overview.jobs.find((item) => item.kind === 'packing')
    if (waiting === undefined) throw new Error('포장 작업이 없다')
    const all = (await expectOk(api.api.get(`/api/print/preview/packing?${new URLSearchParams({ date: DAY, ref: 'UC_A' })}`))).body.images as Record<string, unknown>[]
    const one = (await expectOk(api.api.get(`/api/print/preview/job?${new URLSearchParams({ date: DAY, ref: waiting.id })}`))).body.images as Record<string, unknown>[]
    expect(one).toHaveLength(1)
    const next = (await api.claim(DEVICE_A)).job
    if (next === null) throw new Error('포장 작업을 받지 못했다')
    const bits = (await expectOk(api.api.get(`/api/print/jobs/${encodeURIComponent(next.id)}/bitmap?device=${DEVICE_A}&attempt=${next.attempt}`))).body
    expect(one[0]?.data === bits.data).toBe(true)
    expect(all[(next.page ?? 1) - 1]?.data === bits.data).toBe(true)
  })
  it('포장 작업을 만든 뒤 한 장 번호 수가 바뀌어도 두 쪽 미리보기는 실제 출력과 같다', async () => {
    const { world, seller, api, job } = await claimedLabel()
    await api.done(DEVICE_A, job.attempt)
    for (const no of [16, 17]) {
      await register(world, seller, job.label.broadcast!, no)
      await chat(world, seller, job.label.broadcast!, 'UC_A', '홍길동', String(no))
    }
    await expectOk(api.cancelAll())
    await expectOk(api.put('/api/print/templates/packing', { template: { ...defaultTemplate('packing'), perPage: 2 }, version: 0 }))
    await expectOk(api.packing(DAY, 'UC_A'))
    const jobs = (await api.overview()).jobs.filter((item) => item.kind === 'packing')
    expect(jobs).toHaveLength(2)
    await expectOk(api.put('/api/print/templates/packing', { template: { ...defaultTemplate('packing'), perPage: 3 }, version: 1 }))
    const previews = new Map<string, unknown>()
    for (const item of jobs) {
      const images = (await expectOk(api.api.get(`/api/print/preview/job?${new URLSearchParams({ date: DAY, ref: item.id })}`))).body.images as Record<string, unknown>[]
      expect(images).toHaveLength(1)
      previews.set(item.id, images[0]?.data)
    }
    await expectOk(api.restart())
    for (let page = 1; page <= 2; page++) {
      const next = (await api.claim(DEVICE_A)).job
      expect(next).toMatchObject({ page, pages: 2, template: { perPage: 2 } })
      if (next === null) throw new Error('포장 작업을 받지 못했다')
      const bits = (await expectOk(api.api.get(`/api/print/jobs/${encodeURIComponent(next.id)}/bitmap?device=${DEVICE_A}&attempt=${next.attempt}`))).body
      expect(bits.data === previews.get(next.id)).toBe(true)
      await api.done(DEVICE_A, next.attempt)
    }
  })
  it('웹에 준 템플릿·데이터와 같은 점이며 받기 뒤 템플릿을 바꿔도 그대로다', async () => {
    const { api, job, url } = await claimedLabel()
    const expected = renderProductLabel(createNodeRenderEnv(), job.template, job.data)
    if (!expected.ok) throw new Error('기준 그림을 만들지 못했다')
    await expectOk(api.put('/api/print/templates/product', { template: { ...defaultTemplate('product'), shopName: '바뀐 가게' }, version: 0 }))
    const response = await expectOk(api.api.get(url))
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.body).toEqual({ width: expected.image.width, height: expected.image.height, data: Buffer.from(expected.image.data).toString('base64') })
    expect(expected.image.data.some((value) => value !== 0)).toBe(true)
    expect((await api.api.get(url)).body).toEqual(response.body)
  })

  it('로그인 없음·다른 판매자·다른 기기·다른 작업·끝난 시도는 그림을 받지 못한다', async () => {
    const { world, seller, api, job, url } = await claimedLabel()
    const other = await addSeller(world)
    expect((await world.server.app.request(url)).status).toBe(401)
    expect((await client(world, other.cookie).get(url)).status).toBe(404)
    expect((await api.api.get(url.replace(DEVICE_A, DEVICE_B))).status).toBe(404)
    expect((await api.api.get(url.replace(encodeURIComponent(job.id), 'unknown-job'))).status).toBe(404)
    expect(await api.done(DEVICE_A, job.attempt)).toBe(true)
    expect((await client(world, seller.cookie).get(url)).status).toBe(404)
  })

  it('출력 기기가 바뀌면 옛 시도의 점을 더 받지 못한다', async () => {
    const { api, url } = await claimedLabel()
    await expectOk(api.register(DEVICE_B, '다른 휴대폰', true))
    expect((await api.api.get(url)).status).toBe(404)
  })

  it('테스트 인쇄는 서버 날짜·가게 이름으로 만든 한글·테두리 그림이다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = printApi(world, seller)
    const response = await expectOk(api.api.get('/api/print/test-bitmap'))
    const date = new Date(world.clock.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const expected = renderTestLabel(createNodeRenderEnv(), { shopName: `가게 ${seller.loginId}`, date, size: '50x30' })
    if (!expected.ok) throw new Error('기준 그림을 만들지 못했다')
    expect(response.body).toEqual({ width: expected.image.width, height: expected.image.height, data: Buffer.from(expected.image.data).toString('base64') })
  })
})
