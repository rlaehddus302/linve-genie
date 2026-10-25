// 밴드 로그·오류 응답에 남지 않는 것 (BND1, AC-BND1-61, DAT-06, D-073, D-BND1-14).
// 심은 값으로 연결(성공·다섯 실패)·목록·잇기(성공·거절)·읽기·기록·건너뜀·지움·고침·모든 실패 코드·10초 넘김·쪽 고리·끊기·다시 연결을 돌린 뒤
// 로그 전체와 판매자에게 간 오류 응답에 그 값이 0번 나온다. access_token=이 든 주소도 로그에 0번.
import { afterEach, describe, expect, it } from 'vitest'
import { FakeBand } from '../src/band/fake.ts'
import { addSeller, client, rid, type JsonResponse } from './support.ts'
import { DATE, approve, bandWorld, callback, guestComment, linkBand, realBroadcast, tick, type BandWorld } from './band-support.ts'

let w: BandWorld | null = null
let fake: FakeBand | null = null
afterEach(async () => {
  await w?.close()
  await fake?.close()
  w = null
  fake = null
})

const PLANTED = [
  'PLANTED-BAND-TOKEN',
  'PLANTED-BAND-SECRET',
  'PLANTED-BAND-CODE',
  'PLANTEDSELLERKEY',
  'PLANTEDBUYERKEY',
  'PLANTED-BAND-NICK',
  'PLANTED-BAND-TEXT-15',
  'PLANTEDBANDKEY',
  'PLANTEDPOSTKEY',
  'PLANTED-BAND-MESSAGE',
]

describe('AC-BND1-61 로그·오류에 남지 않는 것', () => {
  it('심은 값이 로그·오류 응답에 0번, access_token이 든 주소도 0번', async () => {
    const { StepClock } = await import('./band-support.ts')
    const bclock = new StepClock()
    fake = await FakeBand.start({ clientSecret: 'PLANTED-BAND-SECRET', now: () => bclock.now() })
    w = await bandWorld({ fake, bclock, timeoutMs: 200 })
    const errors: JsonResponse[] = []
    const keep = (response: JsonResponse): JsonResponse => {
      if (response.status >= 400) errors.push(response)
      return response
    }
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    fake.addUser('다육가게', 'PLANTEDSELLERKEY')
    fake.addBand({ name: '방', members: ['PLANTEDSELLERKEY'], bandKey: 'PLANTEDBANDKEY' })
    // 연결: 다섯 실패 갈래 + 성공
    const attempt = async (prepare: () => void): Promise<string> => {
      const started = keep(await api.post('/api/band/connect', {}))
      fake?.nextLogin({ decision: 'approve', userKey: 'PLANTEDSELLERKEY' })
      if (fake !== null) fake.nextCode = 'PLANTED-BAND-CODE'
      const back = await approve(w as BandWorld, started.body.url as string)
      prepare()
      return callback(w as BandWorld, seller, back)
    }
    expect(await attempt(() => fake?.fail('token', { tokenError: 'invalid_grant' }))).toBe('failed')
    expect(await attempt(() => fake?.fail('token', 'HANG'))).toBe('failed')
    fake.releaseHanging()
    fake.nextLogin({ decision: 'deny' })
    const denied = keep(await api.post('/api/band/connect', {}))
    expect(await callback(w, seller, await approve(w, denied.body.url as string))).toBe('denied')
    expect(await callback(w, seller, '/api/band/callback/PLANTED-BAND-CODE-PLANTED-BAND-CODE?code=PLANTED-BAND-CODE')).toBe('expired')
    fake.nextLogin({ decision: 'approve', userKey: 'PLANTEDSELLERKEY', scope: 'READ_POST' })
    const scoped = keep(await api.post('/api/band/connect', {}))
    fake.nextCode = 'PLANTED-BAND-CODE'
    expect(await callback(w, seller, await approve(w, scoped.body.url as string))).toBe('scope')
    fake.nextToken = 'PLANTED-BAND-TOKEN'
    expect(await attempt(() => undefined)).toBe('connected')
    // 목록·잇기 거절·잇기
    keep(await api.get('/api/band/bands'))
    keep(await api.get('/api/band/posts?band=PLANTEDBANDKEY'))
    keep(await api.get('/api/band/posts?band=PLANTEDBANDKEY&cursor=PLANTEDCURSORVALUE'))
    fake.addPost({ bandKey: 'PLANTEDBANDKEY', authorUserKey: 'SOMEONE', postKey: 'PLANTEDOTHERPOST' })
    fake.addPost({ bandKey: 'PLANTEDBANDKEY', authorUserKey: 'PLANTEDSELLERKEY', postKey: 'PLANTEDPOSTKEY' })
    const b = await realBroadcast(w, seller)
    keep(await linkBand(w, seller, b, 'PLANTEDBANDKEY', 'PLANTEDOTHERPOST'))
    fake.fail('post', { resultCode: 60102 })
    keep(await linkBand(w, seller, b, 'PLANTEDBANDKEY', 'PLANTEDPOSTKEY'))
    expect(keep(await linkBand(w, seller, b, 'PLANTEDBANDKEY', 'PLANTEDPOSTKEY')).status).toBe(200)
    keep(await linkBand(w, seller, b, 'PLANTEDBANDKEY', 'PLANTEDPOSTKEY'))
    // 읽기·기록·건너뜀·지움·고침
    const recorded = guestComment(w, 'PLANTEDPOSTKEY', 'PLANTED-BAND-TEXT-15', { userKey: 'PLANTEDBUYERKEY', name: 'PLANTED-BAND-NICK' })
    const edited = guestComment(w, 'PLANTEDPOSTKEY', 'PLANTED-BAND-TEXT-15 둘', { userKey: 'PLANTEDBUYERKEY', name: 'PLANTED-BAND-NICK' })
    guestComment(w, 'PLANTEDPOSTKEY', 'PLANTED-BAND-TEXT-15', { userKey: null, name: 'PLANTED-BAND-NICK' })
    guestComment(w, 'PLANTEDPOSTKEY', 'PLANTED-BAND-TEXT-15'.repeat(40), { userKey: 'PLANTEDBUYERKEY', name: 'PLANTED-BAND-NICK' })
    guestComment(w, 'PLANTEDPOSTKEY', 'PLANTED-BAND-TEXT-15 판매자', { userKey: 'PLANTEDSELLERKEY' })
    await tick(w, 10_000)
    fake.dropComment('PLANTEDPOSTKEY', recorded)
    fake.editComment('PLANTEDPOSTKEY', edited, 'PLANTED-BAND-TEXT-15 고침')
    await tick(w, 60_000)
    // 모든 실패 코드·10초 넘김·쪽 고리
    for (const code of [1001, 1002, 1003, 2300, 3000, 211, 212, 60000, 99999]) {
      fake.fail('comments', { resultCode: code })
      await tick(w, 700_000)
    }
    for (const fault of [{ http: 500 }, 'NOT_JSON', 'BAD_SHAPE', 'HANG'] as const) {
      fake.fail('comments', fault)
      await tick(w, 700_000)
      fake.releaseHanging()
    }
    fake.pageSize = 1
    fake.pagingOverride = (_op, next) => (next === null ? null : { ...next, after: '0', access_token: 'PLANTED-BAND-TOKEN' })
    await tick(w, 70_000)
    fake.pagingOverride = null
    fake.pageSize = 20
    // 다시 연결·끊기 · NO_ACCESS · 10401
    fake.fail('comments', { resultCode: 10401 })
    await tick(w, 10_000)
    keep(await api.get('/api/band/posts?band=PLANTEDBANDKEY'))
    expect(await attempt(() => undefined)).toBe('connected')
    await tick(w, 10_000)
    fake.fail('comments', { resultCode: 60203 })
    await tick(w, 10_000)
    keep(await api.post(`/api/broadcasts/${b}/band/unlink`, { requestId: rid('u') }))
    keep(await api.post(`/api/broadcasts/${b}/band/unlink`, { requestId: rid('u') }))
    keep(await api.post('/api/band/disconnect', { requestId: rid('d') }))
    keep(await api.get('/api/band/bands'))
    keep(await linkBand(w, seller, b, 'PLANTEDBANDKEY', 'PLANTEDPOSTKEY'))
    // 흐름이 정말 돌았는지
    expect(w.logs.some((log) => log.code === 'BAND_API_FAILED')).toBe(true)
    expect(w.logs.some((log) => log.code === 'BAND_PAGING_LOOP')).toBe(true)
    expect(errors.length).toBeGreaterThan(5)
    const logs = JSON.stringify(w.logs)
    for (const value of PLANTED) expect(logs, value).not.toContain(value)
    expect(logs).not.toContain('access_token')
    expect(logs).not.toMatch(/https?:\/\//)
    const bodies = errors.map((response) => response.text).join('\n')
    for (const value of PLANTED) expect(bodies, value).not.toContain(value)
    void DATE
  })
})
