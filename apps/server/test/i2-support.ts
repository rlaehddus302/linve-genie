// I2 서버 시험 도우미: 골든 G-ENG-201·202와 같은 판매를 서버 쓰기 경로(API·수집 함수)로 넣는다, 파일 응답 읽기.
import { expect } from 'vitest'
import { ORIGIN, client, createBroadcast, expectOk, rid, writeEvent, type JsonResponse, type Seller, type TestServer } from './support.ts'

/** KST 'YYYY-MM-DD HH:MM:SS' → UTC 밀리초 */
export function kst(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const [hh, mm, ss = 0] = time.split(':').map(Number) as [number, number, number?]
  return Date.UTC(y, m - 1, d, hh - 9, mm, ss)
}

/** 서버 시계를 그 KST 시각으로 (같은 범위 안에서 줄지 않게 — 이미 지났으면 그대로 1ms 뒤) */
export function at(world: TestServer, date: string, time: string): void {
  world.clock.set(Math.max(kst(date, time), world.clock.now() + 1))
}

export async function chat(world: TestServer, seller: Seller, b: string, id: string, ch: string, nick: string, text: string): Promise<void> {
  const outcome = await world.server.ingestChat(seller.sellerId, { b, id, ch, nick, text })
  expect(outcome.status, JSON.stringify(outcome)).toBe('recorded')
}

export async function ok(world: TestServer, seller: Seller, event: Record<string, unknown>, date?: string): Promise<JsonResponse> {
  return expectOk(writeEvent(world, seller, event, date))
}

export const SHOP = { name: '초록다육', bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', accountNote: '입금자명은 닉네임으로 적어 주세요' }

export async function putShop(world: TestServer, seller: Seller, shop: Record<string, unknown> = SHOP): Promise<JsonResponse> {
  const response = await world.server.app.request('/api/shop', {
    method: 'PUT',
    headers: { Cookie: seller.cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(shop),
  })
  const text = await response.text()
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>), text, headers: response.headers }
}

/**
 * G-ENG-201과 같은 판매 (같은 날 1부·2부, 닉네임 변경, 확정 뒤 가격 변경, 할인, 부분 입금, 직접 수령 문자찜)를 서버로.
 * 돌려주는 값: 방송 ID 둘과 문자 구매자 ID(서버가 만든 ref)
 */
export async function sellG201(world: TestServer, seller: Seller, date = '2026-10-18'): Promise<{ b1: string; b2: string; sms: string }> {
  at(world, date, '19:59:00')
  const b1 = (await createBroadcast(world, seller, { date, title: '1부' })).id
  const b2 = (await createBroadcast(world, seller, { date, title: '2부' })).id
  at(world, date, '20:00:00')
  await ok(world, seller, { type: 'product.register', b: b1, no: 15, name: '핑크프릴', price: 10000 })
  at(world, date, '20:00:05')
  await chat(world, seller, b1, 'm1', 'UC_A', '홍길동', '15')
  at(world, date, '20:01:00')
  await ok(world, seller, { type: 'product.register', b: b1, no: 28, name: '라울', price: 5000 })
  at(world, date, '20:01:03')
  await chat(world, seller, b1, 'm2', 'UC_A', '홍길동', '28')
  at(world, date, '20:02:00')
  await ok(world, seller, { type: 'product.register', b: b1, no: 31, name: '방울복랑 금', price: 15000 })
  at(world, date, '20:02:10')
  const sms = (await ok(world, seller, { type: 'sms', b: b1, no: 31, received: '20:02', memo: '김영희', phone: '010-1234-5678' })).body.buyer as string
  at(world, date, '22:00:00')
  await ok(world, seller, { type: 'product.register', b: b2, no: 7, name: '블루엘프', price: 8000 })
  at(world, date, '22:00:04')
  await chat(world, seller, b2, 'm3', 'UC_A', '길동이', '7')
  at(world, date, '22:00:30')
  await ok(world, seller, { type: 'product.update', b: b2, no: 7, price: 9000 })
  at(world, date, '22:10:00')
  await ok(world, seller, { type: 'settlement.adjust', buyer: 'UC_A', date, amount: -2000, reason: '단골 할인' }, date)
  at(world, date, '22:11:00')
  await ok(world, seller, { type: 'settlement.shippingOverride', buyer: sms, date, mode: 'PICKUP' }, date)
  at(world, date, '22:12:00')
  await ok(world, seller, { type: 'settlement.payment', buyer: 'UC_A', date, amount: 10000 }, date)
  return { b1, b2, sms }
}

/** G-ENG-202와 같은 판매 (재고 2·승계·안 팔린 상품·메시지 변환·직접 배정·문자찜·품목 없는 과입금)를 서버로 */
export async function sellG202(world: TestServer, seller: Seller, date = '2026-10-19'): Promise<{ b1: string; sms: string }> {
  at(world, date, '19:59:00')
  const b1 = (await createBroadcast(world, seller, { date, title: '1부' })).id
  at(world, date, '20:00:00')
  await ok(world, seller, { type: 'product.register', b: b1, no: 1, name: '핑크프릴', price: 10000, stock: 2 })
  at(world, date, '20:00:03')
  await chat(world, seller, b1, 'm1', 'UC_A', '홍길동', '1')
  at(world, date, '20:00:04')
  await chat(world, seller, b1, 'm2', 'UC_B', '꽃님', '1번')
  at(world, date, '20:01:00')
  await ok(world, seller, { type: 'product.register', b: b1, no: 2, name: '라울', price: 5000 })
  at(world, date, '20:01:02')
  await chat(world, seller, b1, 'm3', 'UC_C', '다육맘', '2')
  at(world, date, '20:01:03')
  await chat(world, seller, b1, 'm4', 'UC_D', '초록이', '2')
  at(world, date, '20:02:00')
  await ok(world, seller, { type: 'settlement.payment', buyer: 'UC_C', date, amount: 9000 }, date)
  at(world, date, '20:03:00')
  await ok(world, seller, { type: 'host.cancel', b: b1, no: 2, buyer: 'UC_C', reason: '구매자 요청' })
  at(world, date, '20:04:00')
  await ok(world, seller, { type: 'product.register', b: b1, no: 3, name: '블루엘프', price: 8000 })
  at(world, date, '20:05:00')
  await ok(world, seller, { type: 'product.register', b: b1, no: 4, name: '레티지아', price: 7000, status: 'READY' })
  at(world, date, '20:06:00')
  await chat(world, seller, b1, 'm5', 'UC_E', '새싹', '5번 예뻐요')
  at(world, date, '20:06:30')
  await ok(world, seller, { type: 'product.register', b: b1, no: 5, name: '황금사', price: 6000 })
  at(world, date, '20:07:00')
  await ok(world, seller, { type: 'host.convertMessage', b: b1, msg: 'm5', no: 5 })
  at(world, date, '20:08:00')
  await ok(world, seller, { type: 'product.register', b: b1, no: 6, name: '블랙프린스', price: 12000 })
  at(world, date, '20:08:20')
  const sms = (await ok(world, seller, { type: 'sms', b: b1, no: 6, received: '20:08', phone: '010-9876-5432' })).body.buyer as string
  at(world, date, '20:09:00')
  await ok(world, seller, { type: 'product.register', b: b1, no: 7, name: '로라', price: 4000 })
  at(world, date, '20:09:30')
  await ok(world, seller, { type: 'host.assign', b: b1, no: 7, buyer: 'UC_B', reason: '전화 주문' })
  at(world, date, '20:10:00')
  await ok(world, seller, { type: 'product.register', b: b1, no: 8, name: '자보', price: 3000 })
  at(world, date, '20:10:30')
  await ok(world, seller, { type: 'product.close', b: b1, no: 8 })
  return { b1, sms }
}

export interface FileResponse {
  readonly status: number
  readonly bytes: Uint8Array
  readonly headers: Headers
  readonly json: Record<string, unknown> | null
}

/** GET 응답을 바이트로 (오류면 JSON도) */
export async function getFile(world: TestServer, cookie: string | null, path: string): Promise<FileResponse> {
  const response = await world.server.app.request(path, { headers: cookie === null ? {} : { Cookie: cookie } })
  const bytes = new Uint8Array(await response.arrayBuffer())
  let json: Record<string, unknown> | null = null
  if ((response.headers.get('content-type') ?? '').startsWith('application/json')) json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  return { status: response.status, bytes, headers: response.headers, json }
}

/** Content-Disposition의 UTF-8 파일 이름 */
export function fileNameOf(headers: Headers): string {
  const value = headers.get('content-disposition') ?? ''
  const match = /filename\*=UTF-8''([^;]+)/.exec(value)
  return match === null ? '' : decodeURIComponent(match[1] ?? '')
}

export async function post(world: TestServer, seller: Seller, path: string, body: Record<string, unknown>): Promise<JsonResponse> {
  return client(world, seller.cookie).post(path, body)
}

export const pack = (world: TestServer, seller: Seller, date: string, body: Record<string, unknown>): Promise<JsonResponse> =>
  post(world, seller, `/api/days/${date}/packing`, { requestId: rid('pk'), ...body })

/** PNG 머리: 폭·높이·비트 깊이·색 형식 */
export function pngHeader(bytes: Uint8Array): { width: number; height: number; bitDepth: number; colorType: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return { width: view.getUint32(16), height: view.getUint32(20), bitDepth: bytes[24] as number, colorType: bytes[25] as number }
}
