import { defaultTemplate, renderProductLabel, renderTestLabel } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { describe, expect, it } from 'vitest'
import { DAY, DEVICE_A, DEVICE_B, chat, printApi, register } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld } from './support.ts'

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
