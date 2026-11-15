// 손님의 "패스" (D-RETRO-103·113 — 11-13 방송 13:33 "패스" 한 마디로 155번 대기 1번이 끝까지 남은 일).
// 받은 채팅이 이벤트로 기록된 뒤 엔진이 정한다: 번호와 함께면 번호 취소, 번호 없으면 살아 있는 찜이 하나일 때만 그 찜, 둘 이상이면 취소 요청으로 띄우기만.
// 메시지 조회는 번호 없는 패스 메시지에 pass: true를 싣는다(화면이 "패스"라고 보인다). "패스트" 같은 말은 아무 일도 없다.
import { getProduct, listCancelRequests, listClaims, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { addSeller, client, createBroadcast, expectOk, newWorld, writeEvent, type Seller, type TestServer } from './support.ts'

const DAY = '2026-11-13'

interface Message {
  readonly id: string
  readonly cancel: boolean
  readonly cancels: readonly number[]
  readonly pass?: true
}

async function setup(settings: Record<string, unknown>): Promise<{ world: TestServer; seller: Seller; b: string }> {
  const world = await newWorld()
  const seller = await addSeller(world)
  await expectOk(client(world, seller.cookie).patch('/api/settings', { settings }))
  const b = (await createBroadcast(world, seller, { date: DAY })).id
  for (const no of [155, 160]) await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name: '핑크프릴', price: 15000 }))
  return { world, seller, b }
}

const chat = (world: TestServer, seller: Seller, b: string, id: string, ch: string, text: string) => world.server.ingestChat(seller.sellerId, { b, id, ch, nick: ch === 'UC_A' ? '별빛' : ch === 'UC_B' ? '한강' : '모래시계', text })
const state = async (world: TestServer, seller: Seller): Promise<EngineState> => (await world.server.writer.read(seller.sellerId, DAY)).state
const statusOf = (s: EngineState, buyer: string, no: number) => listClaims(s).find((claim) => claim.buyer === buyer && claim.no === no)?.status
async function messages(world: TestServer, seller: Seller): Promise<Message[]> {
  const response = await client(world, seller.cookie).get(`/api/days/${DAY}/messages?limit=500`)
  expect(response.status).toBe(200)
  return (response.body as { messages: Message[] }).messages
}

describe('채팅 "패스" (D-RETRO-113)', () => {
  it('찜이 155번 대기 하나뿐인 손님의 "패스" — 그 대기가 취소되고 뒤 대기가 당겨진다(AUTO). 메시지에 pass', async () => {
    const { world, seller, b } = await setup({ 'cancel.buyerChat': 'AUTO' })
    await chat(world, seller, b, 'm1', 'UC_A', '155')
    await chat(world, seller, b, 'm2', 'UC_B', '155')
    await chat(world, seller, b, 'm3', 'UC_C', '155')
    await chat(world, seller, b, 'm4', 'UC_B', '패스')
    const s = await state(world, seller)
    expect(statusOf(s, 'UC_B', 155)).toBe('CANCELLED')
    expect(statusOf(s, 'UC_C', 155)).toBe('WAITLISTED')
    expect(getProduct(s, b, 155)?.waitlist).toEqual(['UC_C'])
    const list = await messages(world, seller)
    expect(list.find((message) => message.id === 'm4')).toMatchObject({ cancel: true, cancels: [], pass: true })
    expect(list.find((message) => message.id === 'm1')?.pass).toBeUndefined()
    world.server.close()
  })

  it('찜이 둘인 손님의 "패스" — 취소하지 않고 두 찜에 같은 seq의 취소 요청만 건다', async () => {
    const { world, seller, b } = await setup({ 'cancel.buyerChat': 'AUTO' })
    await chat(world, seller, b, 'm1', 'UC_A', '155')
    await chat(world, seller, b, 'm2', 'UC_B', '155')
    await chat(world, seller, b, 'm3', 'UC_B', '160')
    await chat(world, seller, b, 'm4', 'UC_B', '패스요')
    const s = await state(world, seller)
    expect(statusOf(s, 'UC_B', 155)).toBe('WAITLISTED')
    expect(statusOf(s, 'UC_B', 160)).toBe('CONFIRMED')
    const requests = listCancelRequests(s)
    expect(requests.map((request) => request.buyer)).toEqual(['UC_B', 'UC_B'])
    expect(new Set(requests.map((request) => request.seq)).size).toBe(1)
    // 화면 조회(범위 조회)에도 두 요청이 같은 seq로 실린다 — 앱이 한 묶음으로 보인다
    const view = await client(world, seller.cookie).get(`/api/days/${DAY}`)
    expect(view.status).toBe(200)
    const viewed = (view.body as { cancelRequests: { buyer: string; seq: number }[] }).cancelRequests
    expect(viewed.map((request) => request.seq)).toEqual(requests.map((request) => request.seq))
    expect((await messages(world, seller)).find((message) => message.id === 'm4')).toMatchObject({ cancel: true, pass: true })
    world.server.close()
  })

  it('번호와 함께 쓴 "155번 패스" — 기본(REQUEST)이면 번호 취소처럼 그 찜의 취소 요청. 메시지는 취소 번호 [155]이고 pass는 없다', async () => {
    const { world, seller, b } = await setup({})
    await chat(world, seller, b, 'm1', 'UC_A', '155')
    await chat(world, seller, b, 'm2', 'UC_A', '155번 패스')
    const s = await state(world, seller)
    expect(statusOf(s, 'UC_A', 155)).toBe('CONFIRMED')
    expect(listCancelRequests(s).map((request) => request.product)).toEqual([`${b}/155`])
    const message = (await messages(world, seller)).find((item) => item.id === 'm2')
    expect(message).toMatchObject({ cancel: true, cancels: [155] })
    expect(message?.pass).toBeUndefined()
    world.server.close()
  })

  it('"패스트"·"이건 패스"는 찜이 하나여도 아무 일도 없다', async () => {
    const { world, seller, b } = await setup({ 'cancel.buyerChat': 'AUTO' })
    await chat(world, seller, b, 'm1', 'UC_A', '155')
    await chat(world, seller, b, 'm2', 'UC_A', '패스트')
    await chat(world, seller, b, 'm3', 'UC_A', '이건 패스')
    const s = await state(world, seller)
    expect(statusOf(s, 'UC_A', 155)).toBe('CONFIRMED')
    expect(listCancelRequests(s)).toEqual([])
    const list = await messages(world, seller)
    for (const id of ['m2', 'm3']) expect(list.find((message) => message.id === id)).toMatchObject({ cancel: false })
    expect(list.some((message) => message.pass === true)).toBe(false)
    world.server.close()
  })
})
