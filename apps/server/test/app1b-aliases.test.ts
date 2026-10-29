import { afterEach, describe, expect, it } from 'vitest'
import { VoiceAliases } from '../src/voice/aliases.ts'
import { addSeller, client, newWorld, type TestServer } from './support.ts'

const worlds: TestServer[] = []
afterEach(async () => { for (const w of worlds.splice(0)) { w.server.close(); await w.database.close() } })
async function setup() { const w = await newWorld(); worlds.push(w); return w }
const old = { heard: '선버스', name: '선버스트', usedAt: 1 }

describe('APP1b 계정 별칭', () => {
  it('최초 이전은 계정 우선·멱등, 다시 배우기는 새 선택 우선이며 계정별로 격리된다', async () => {
    const w = await setup(), a = await addSeller(w), b = await addSeller(w)
    const api = client(w, a.cookie)
    expect((await api.post('/api/voice/aliases', { aliases: [old] })).body).toEqual({ aliases: [old] })
    const fromDevice = { ...old, name: '보니타', usedAt: 99 }
    for (let i = 0; i < 2; i++) expect((await api.post('/api/voice/aliases', { aliases: [fromDevice], migration: true })).body).toEqual({ aliases: [old] })
    expect((await api.post('/api/voice/aliases', { aliases: [fromDevice] })).body).toEqual({ aliases: [fromDevice] })
    expect((await client(w, b.cookie).get('/api/voice/aliases')).body).toEqual({ aliases: [] })
    expect((await client(w, null).get('/api/voice/aliases')).status).toBe(401)
    expect((await client(w, b.cookie).post('/api/voice/aliases', { aliases: [old], sellerId: a.sellerId })).status).toBe(400)
    // 인스턴스의 메모리가 아니라 DB에서 다시 읽는다.
    expect(await new VoiceAliases(w.database.db).read(a.sellerId)).toEqual([fromDevice])
    // 빈 migration은 지우기가 아니다. 명시적 화면 지우기만 계정 값을 비운다.
    expect((await api.post('/api/voice/aliases', { aliases: [], migration: true })).body).toEqual({ aliases: [fromDevice] })
    await new VoiceAliases(w.database.db).clear(a.sellerId)
    expect((await api.get('/api/voice/aliases')).body).toEqual({ aliases: [] })
  })
  it('동시 이전도 잃지 않고 200개 LRU와 흔한 말 거절을 보존한다', async () => {
    const w = await setup(), seller = await addSeller(w), aliases = new VoiceAliases(w.database.db)
    const entries = Array.from({ length: 250 }, (_, i) => ({ heard: `시험${String.fromCodePoint(0xac00 + i)}별칭`, name: '선버스트', usedAt: i + 1 }))
    await Promise.all([aliases.merge(seller.sellerId, entries.slice(0, 125), true), aliases.merge(seller.sellerId, entries.slice(125), true)])
    expect(await aliases.read(seller.sellerId)).toEqual(entries.slice(50).reverse())
    await aliases.merge(seller.sellerId, [{ heard: '보니까', name: '보니타', usedAt: 1000 }], false)
    expect(await aliases.read(seller.sellerId)).toEqual(entries.slice(50).reverse())
    expect(await aliases.merge(seller.sellerId, entries, false)).toBeNull()
  })
  it('전화번호·잘못된 형태·위험한 필드·지나친 글은 저장하지 않는다', async () => {
    const w = await setup(), seller = await addSeller(w), api = client(w, seller.cookie)
    const before = await new VoiceAliases(w.database.db).read(seller.sellerId)
    for (const aliases of [null, '글', [{}], [{ ...old, heard: '01012345678' }], [{ ...old, name: 'x'.repeat(121) }], [{ ...old, usedAt: -1 }], [{ ...old, token: 'secret-marker' }]]) {
      expect((await api.post('/api/voice/aliases', { aliases })).status).toBe(400)
    }
    expect(await new VoiceAliases(w.database.db).read(seller.sellerId)).toEqual(before)
    expect(JSON.stringify(w.logs)).not.toContain('secret-marker')
  })
})
