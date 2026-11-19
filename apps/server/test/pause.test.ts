// D-PAUSE-01 채팅·상품 인식 잠깐 멈춤: 방송 중 broadcast.pause로 켜고 끈다.
// 멈춘 사이 — 채팅은 받은 메시지로 기록만(찜·취소 없음), 음성·화면 일꾼의 상품 등록·고침은 거절, 휴대폰 문자함의 자동 문자찜은 확인 필요 카드.
// 판매자가 손으로 하는 상품 등록·문자찜은 그대로 된다. 판매자 기본값으로는 저장하지 못한다.
import { getBroadcast, getProduct, listClaims, listMessages } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { chat } from './print-support.ts'
import { client, createBroadcast, expectOk, writeEvent } from './support.ts'
import { cards, claimsOf, inboxWorld, liveSale, sms, statuses } from './sms3-support.ts'
import { connectSeller, linkedBroadcast, youtubeWorld } from './youtube-support.ts'

const TOKEN = 'screen-worker-token-0123456789abcdef'

async function screen(world: Awaited<ReturnType<typeof youtubeWorld>>, body: unknown) {
  const response = await world.server.app.request('/internal/screen/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> }
}

describe('D-PAUSE-01 채팅·상품 인식 잠깐 멈춤', () => {
  it('멈춘 사이 채팅은 기록만 하고 화면 일꾼 등록은 423 PAUSED, 다시 켜면 그 뒤부터 받는다', async () => {
    const world = await youtubeWorld({ overrides: { screenWorkerToken: TOKEN } })
    const connected = await connectSeller(world)
    const { b, live } = await linkedBroadcast(world, connected)
    const seller = connected.seller
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: '핑크프릴', price: 10_000 }))
    const state = async () => (await world.server.writer.read(seller.sellerId, b.date, false)).state

    await expectOk(writeEvent(world, seller, { type: 'broadcast.pause', b: b.id, paused: true }))
    expect(getBroadcast(await state(), b.id)?.settings['claim.paused']).toBe(true)
    await chat(world, seller, b.id, 'UC_A', '홍길동', '1')
    expect(listClaims(await state())).toHaveLength(0)
    const paused = await screen(world, { videoId: live.videoId, no: 2, price: 5000, name: '라울', requestId: 'screen-p-2-1' })
    expect(paused.status, JSON.stringify(paused.body)).toBe(423)
    expect(paused.body).toMatchObject({ error: { code: 'PAUSED' } })
    expect(getProduct(await state(), b.id, 2)).toBeNull()
    // 판매자의 손 등록은 멈춤과 상관없다
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 3, name: '성미인', price: 8000 }))

    await expectOk(writeEvent(world, seller, { type: 'broadcast.pause', b: b.id, paused: false }))
    await chat(world, seller, b.id, 'UC_B', '김철수', '1')
    expect(listClaims(await state()).map((claim) => claim.buyer)).toEqual(['UC_B'])
    const again = await screen(world, { videoId: live.videoId, no: 2, price: 5000, name: '라울', requestId: 'screen-p-2-2' })
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    expect(again.body).toMatchObject({ ok: true, changed: true })
    // 멈춘 사이 A의 "1"은 주문도 취소도 아니었던 메시지로 남는다 — 나중에 "찜으로 바꾸기"로 살릴 수 있다
    expect(listMessages(await state()).map((message) => [message.channel, message.order, message.ignored])).toEqual([['UC_A', false, false], ['UC_B', true, false]])
  })

  it('멈춘 사이 음성으로 읽은 등록은 거절(409 PAUSED)하고 손 등록은 받는다', async () => {
    const { world, seller } = await inboxWorld()
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'broadcast.pause', b: b.id, paused: true }))
    const voice = await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 5, name: '라울', price: 5000, voiceLog: { heard: '오번 라울 오천원' } })
    expect(voice.status, voice.text).toBe(409)
    expect(voice.body).toMatchObject({ error: { code: 'PAUSED' } })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 5, name: '라울', price: 5000 }))
  })

  it('멈춘 사이 휴대폰 문자함의 문자찜은 넣지 않고 확인 필요 카드(PAUSED)로 남긴다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    await expectOk(writeEvent(world, seller, { type: 'broadcast.pause', b: sale.id, paused: true }))
    expect(await statuses(world, token, [sms('p1', '010-1111-2222', '15')])).toEqual(['SAVED'])
    expect(await claimsOf(world, seller)).toEqual([])
    const list = await cards(world, seller, sale.id)
    expect(list.map((card) => [card.kind, card.why, card.numbers, card.message])).toEqual([['REVIEW', 'PAUSED', [15], '잠깐 멈춤 중에 온 문자예요. 넣으려면 직접 넣어 주세요']])
  })

  it('판매자 기본값으로는 저장하지 못하고, 켜기·끄기 값은 참·거짓만 받는다', async () => {
    const { world, seller } = await inboxWorld()
    const saved = await client(world, seller.cookie).patch('/api/settings', { settings: { 'claim.paused': true } })
    expect(saved.status).toBe(400)
    const b = await createBroadcast(world, seller)
    expect((await writeEvent(world, seller, { type: 'broadcast.pause', b: b.id, paused: 'yes' })).status).toBe(400)
  })
})
