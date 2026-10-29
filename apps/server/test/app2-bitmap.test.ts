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
