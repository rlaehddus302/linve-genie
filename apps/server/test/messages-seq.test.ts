// TD-S05-005 / SA-S05-005 (AC-S05-20·21·62, D-085): 메시지 조회·증분 조회는 응답 seq까지의 메시지를 모두 담고, 기록(주문·바꾼 번호·찜)도 그 seq 시점의 것이다.
// 채팅 행 조회(store.chatRows)를 한 번 붙잡아, 그 사이에 채팅과 메시지 변환을 넣는다(실제로는 DB 조회 시간 동안 쓰기가 들어오는 순서).
// 그사이 들어온 것은 응답 seq 뒤에 있어 화면이 since=응답 seq로 증분을 받으면 빠짐없이 온다.
import type * as StoreModule from '../src/store.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addSeller, client, createBroadcast, expectOk, newWorld, writeEvent, type Seller, type TestServer } from './support.ts'

const gate: { hook: (() => Promise<void>) | null } = { hook: null }

vi.mock('../src/store.ts', async (importOriginal) => {
  const original = await importOriginal<typeof StoreModule>()
  return {
    ...original,
    chatRows: async (...args: Parameters<typeof original.chatRows>) => {
      const hook = gate.hook
      if (hook !== null) {
        gate.hook = null
        await hook()
      }
      return original.chatRows(...args)
    },
  }
})

const DAY = '2026-10-19'

interface Message {
  id: string
  seq: number
  converted: number[]
  claims: string[]
}
interface MessagesBody {
  seq: number
  more: boolean
  messages: Message[]
}

let world: TestServer | null = null
afterEach(() => {
  gate.hook = null
  world?.server.close()
  world = null
})

async function setup(): Promise<{ world: TestServer; seller: Seller; b: string }> {
  world = await newWorld()
  const seller = await addSeller(world)
  const b = (await createBroadcast(world, seller, { date: DAY })).id
  await expectOk(writeEvent(world, seller, { type: 'product.register', b, no: 16, name: 'a', price: 1000 }))
  return { world, seller, b }
}

async function chat(world: TestServer, seller: Seller, b: string, id: string): Promise<void> {
  await world.server.ingestChat(seller.sellerId, { b, id, ch: 'UCa', nick: '손님', text: '안녕하세요' })
}

async function get<T>(world: TestServer, seller: Seller, path: string): Promise<T> {
  const response = await client(world, seller.cookie).get(path)
  expect(response.status, response.text).toBe(200)
  return response.body as T
}

describe('TD-S05-005 조회를 기다리는 사이 쓰기가 들어와도 응답 seq와 담은 메시지가 맞는다', () => {
  it.each([
    ['가장 최근', (b: string) => `?b=${b}&limit=100`],
    ['방송 거르기 없이', () => '?limit=100'],
    ['before가 지금보다 큼', (b: string) => `?b=${b}&before=100000&limit=100`],
  ])('메시지 조회(%s): 응답 seq = 채팅 행을 읽기 전의 seq, 그 seq까지의 메시지 모두 · 기록은 그 시점 · 뒤의 채팅·변환은 증분으로', async (_name, query) => {
    const { world, seller, b } = await setup()
    for (const id of ['early0', 'early1', 'early2']) await chat(world, seller, b, id)
    const before = (await world.server.writer.read(seller.sellerId, DAY)).seq

    gate.hook = async () => {
      await chat(world, seller, b, 'mid0')
      await expectOk(writeEvent(world, seller, { type: 'host.convertMessage', b, msg: 'early1', no: 16 }))
      await chat(world, seller, b, 'mid1')
    }
    const res = await get<MessagesBody>(world, seller, `/api/days/${DAY}/messages${query(b)}`)
    expect(gate.hook).toBeNull()
    expect((await world.server.writer.read(seller.sellerId, DAY)).seq).toBeGreaterThan(before)

    expect(res.seq).toBe(before)
    expect(res.more).toBe(false)
    expect(res.messages.map((m) => m.id)).toEqual(['early0', 'early1', 'early2'])
    // 변환은 응답 seq 뒤의 일이라 아직 보이지 않는다
    expect(res.messages.find((m) => m.id === 'early1')).toMatchObject({ converted: [], claims: [] })

    // 화면처럼 since=응답 seq로 증분을 받으면 빈틈이 없다: 새 채팅 + 기록이 바뀐 앞 메시지
    const changes = await get<{ seq: number; messages: Message[] }>(world, seller, `/api/days/${DAY}/changes?since=${String(res.seq)}`)
    expect(changes.messages.map((m) => m.id)).toEqual(['early1', 'mid0', 'mid1'])
    expect(changes.messages[0]).toMatchObject({ converted: [16] })
    expect(changes.messages[0]?.claims).toHaveLength(1)
    const all = await get<MessagesBody>(world, seller, `/api/days/${DAY}/messages?b=${b}&limit=500`)
    expect(all.messages.filter((m) => m.seq <= res.seq).map((m) => m.id)).toEqual(res.messages.map((m) => m.id))
  })

  it('증분 조회: 새 메시지를 읽는 사이 앞 메시지가 찜으로 바뀌어도 응답의 기록은 응답 seq 시점, 바뀐 것은 다음 증분에', async () => {
    const { world, seller, b } = await setup()
    await chat(world, seller, b, 'm0')
    const since = (await world.server.writer.read(seller.sellerId, DAY)).seq
    await chat(world, seller, b, 'm1')
    const at = (await world.server.writer.read(seller.sellerId, DAY)).seq

    gate.hook = async () => {
      await expectOk(writeEvent(world, seller, { type: 'host.convertMessage', b, msg: 'm1', no: 16 }))
      await chat(world, seller, b, 'm2')
    }
    const first = await get<{ seq: number; messages: Message[]; messagesMore: boolean }>(world, seller, `/api/days/${DAY}/changes?since=${String(since)}`)
    expect(gate.hook).toBeNull()
    expect(first.seq).toBe(at)
    expect(first.messagesMore).toBe(false)
    expect(first.messages.map((m) => m.id)).toEqual(['m1'])
    expect(first.messages[0]).toMatchObject({ converted: [], claims: [] })

    const second = await get<{ seq: number; messages: Message[] }>(world, seller, `/api/days/${DAY}/changes?since=${String(first.seq)}`)
    expect(second.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(second.messages[0]).toMatchObject({ converted: [16] })
  })
})
