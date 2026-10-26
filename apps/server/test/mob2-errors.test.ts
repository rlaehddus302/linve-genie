// MOB2 D-MOB2-05 · AC-MOB2-24: 화면에 나갈 수 있는 서버 오류 문장을 쉬운 한국어로.
// 오류 코드·HTTP 상태·칸 이름은 그대로(화면이 코드로 판단한다), 문장만 바뀐다. 문장에 개발 용어("요청 번호"·"ID"·"영문"·"product")가 없다.
import { afterEach, describe, expect, it } from 'vitest'
import { fieldMessage } from '../src/messages.ts'
import { addSeller, client, countRows, createBroadcast, newWorld, rid, type JsonResponse, type TestServer } from './support.ts'
import { DATE, realBroadcast, tiktokSeller, ttWorld } from './tiktok-live-support.ts'

const TOP = '보내는 중 문제가 생겼어요. 화면을 새로고침한 뒤 다시 해 주세요.'
const FIELD = '화면을 새로고침한 뒤 다시 해 주세요.'
const DEVICE = '이 기기를 알아보지 못했어요. 화면을 새로고침한 뒤 다시 해 주세요.'
const BANNED = ['요청 번호', 'ID', '영문', 'product']

// 틱톡 세계만 닫을 것이 있다 (newWorld는 닫을 것이 없다)
const worlds: { close: () => Promise<void> }[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})
async function world(): Promise<TestServer> {
  return newWorld()
}

interface ErrorBody {
  readonly code: string
  readonly message: string
  readonly problems?: readonly { readonly field: string; readonly message: string }[]
}
const errorOf = (response: JsonResponse): ErrorBody => response.body.error as ErrorBody

/** 응답의 모든 문장(맨 위·칸)에 개발 용어가 없다 */
function expectEasy(response: JsonResponse): void {
  const error = errorOf(response)
  const texts = [error.message, ...(error.problems ?? []).map((problem) => problem.message)]
  for (const text of texts) for (const word of BANNED) expect(text, `${text} 에 ${word}`).not.toContain(word)
}

function expectInvalidRequestId(response: JsonResponse): void {
  expect(response.status, response.text).toBe(400)
  expect(errorOf(response)).toEqual({ code: 'INVALID_REQUEST_ID', message: TOP, problems: [{ field: 'requestId', message: FIELD }] })
  expectEasy(response)
}

describe('AC-MOB2-24 요청 번호가 없거나 틀린 쓰기', () => {
  it('일반·출력·입금·택배 쓰기 경로 — 코드·400·칸 requestId 그대로, 문장만 새로고침 안내', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const b = await createBroadcast(w, seller, { date: DATE })
    const paths: readonly [string, Record<string, unknown>][] = [
      // 일반 (api.ts)
      ['/api/broadcasts', { date: DATE }],
      ['/api/broadcasts', { requestId: 'has space', date: DATE }],
      ['/api/broadcasts', { requestId: 'x'.repeat(65), date: DATE }],
      ['/api/events', { type: 'product.register', b: b.id, no: 15, name: '상품15', price: 10_000 }],
      ['/api/events', { requestId: 7, type: 'product.register', b: b.id, no: 15, name: '상품15', price: 10_000 }],
      [`/api/broadcasts/${b.id}/end`, {}],
      [`/api/days/${DATE}/packing`, {}],
      [`/api/broadcasts/${b.id}/import`, { rows: [] }],
      // 출력 (print-api.ts)
      ['/api/print/labels/print', {}],
      ['/api/print/packing', {}],
      // 입금 (deposit/api.ts)
      ['/api/deposits/paste', { text: '' }],
      ['/api/deposits/bulk', {}],
      // 택배 (parcel/api.ts)
      [`/api/parcels/days/${DATE}/book`, {}],
      [`/api/parcels/days/${DATE}/address/confirm`, {}],
    ]
    const before = await countRows(w.database, 'events')
    for (const [path, payload] of paths) {
      const response = await api.post(path, payload)
      expect(errorOf(response)?.code, `${path} ${response.text}`).toBe('INVALID_REQUEST_ID')
      expectInvalidRequestId(response)
    }
    // 거절된 쓰기는 아무것도 기록하지 않는다
    expect(await countRows(w.database, 'events')).toBe(before)
  })

  it('입금 확인이 쓰는 요청 번호 앞머리(dep-)로 보낸 이벤트 쓰기도 같은 문장', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const response = await client(w, seller.cookie).post(`/api/events?date=${DATE}`, { requestId: 'dep-1-pay-1', type: 'settlement.payment', buyer: 'UC_A', date: DATE, amount: 1 })
    expectInvalidRequestId(response)
  })

  it('틱톡 붙여넣기 쓰기(tiktok-live/routes.ts) — 같은 문장', async () => {
    const w = await ttWorld()
    worlds.push(w)
    const { seller } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    expectInvalidRequestId(await client(w, seller.cookie).post(`/api/broadcasts/${b}/paste`, { text: '홍길동: 15' }))
    expectInvalidRequestId(await client(w, seller.cookie).post('/api/tiktok/consent', {}))
  })

  it('요청 번호 칸 문장(엔진 칸 문장 표·리허설 생성기)도 새로고침 안내', async () => {
    expect(fieldMessage('requestId')).toBe(FIELD)
    const w = await world()
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller, { date: DATE, rehearsal: true })
    const response = await client(w, seller.cookie).post(`/api/broadcasts/${b.id}/rehearsal/generator/start`, { requestId: 'has space' })
    expect(response.status, response.text).toBe(400)
    expect(errorOf(response).code).toBe('INVALID_INPUT')
    expect(errorOf(response).problems).toContainEqual({ field: 'requestId', message: FIELD })
    expectEasy(response)
  })
})

describe('AC-MOB2-24 기기 칸·상품 칸·다시 쓴 요청', () => {
  it('출력 기기 칸 deviceId·실시간 연결 칸 device — 코드·400·칸 이름 그대로, "이 기기를 알아보지 못했어요"', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    for (const path of ['/api/print/device', '/api/print/device/state', '/api/print/claim', '/api/print/result']) {
      const response = await api.post(path, { deviceId: 'short' })
      expect(response.status, `${path} ${response.text}`).toBe(400)
      expect(errorOf(response).code).toBe('INVALID_INPUT')
      expect(errorOf(response).problems).toEqual([{ field: 'deviceId', message: DEVICE }])
      expectEasy(response)
    }
    const stream = await api.get('/api/stream?device=bad id')
    expect(stream.status, stream.text).toBe(400)
    expect(errorOf(stream).code).toBe('INVALID_INPUT')
    expect(errorOf(stream).problems).toEqual([{ field: 'device', message: DEVICE }])
    expectEasy(stream)
  })

  it('상품을 두 방법으로 고른 조치 기록 조회 — 칸 product, "상품을 하나만 골라 주세요."', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller, { date: DATE })
    const response = await client(w, seller.cookie).get(`/api/days/${DATE}/history?product=p_1&b=${b.id}&no=15`)
    expect(response.status, response.text).toBe(400)
    expect(errorOf(response).code).toBe('INVALID_INPUT')
    expect(errorOf(response).problems).toEqual([{ field: 'product', message: '상품을 하나만 골라 주세요.' }])
    expectEasy(response)
  })

  it('틱톡 붙여넣기 REQUEST_REUSED — 409·코드 그대로, "이미 보낸 내용이에요. 다시 미리 보기를 해 주세요."', async () => {
    const w = await ttWorld()
    worlds.push(w)
    const { seller } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    const api = client(w, seller.cookie)
    const registered = await api.post('/api/events', { requestId: rid('reg'), type: 'product.register', b, no: 15, name: '상품15', price: 10_000 })
    expect(registered.status, registered.text).toBe(200)
    const requestId = rid('paste')
    const first = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text: '홍길동: 15' })
    expect(first.status, first.text).toBe(200)
    const reused = await api.post(`/api/broadcasts/${b}/paste`, { requestId, text: '홍길동: 16' })
    expect(reused.status, reused.text).toBe(409)
    expect(errorOf(reused)).toMatchObject({ code: 'REQUEST_REUSED', message: '이미 보낸 내용이에요. 다시 미리 보기를 해 주세요.' })
    expectEasy(reused)
  })
})
