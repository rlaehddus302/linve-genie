// D-UX4-12 방송 화면 "채팅·문자" 탭의 최근 손님 문자: 방송 창 안의 손님 문자를 서버가 한 일과 함께(찜·취소 요청·확인 필요·찜 아님) 최신이 앞으로 보이고,
// 본문은 DB에 남지 않으며(C-07) 은행 알림·다른 방송·다른 판매자 문자는 보이지 않는다.
import { describe, expect, it } from 'vitest'
import { SmsFeed, SMS_FEED_KEEP_MS, SMS_FEED_MAX } from '../src/inbox/sms-feed.ts'
import { addSeller, client, dumpAllTables, expectOk } from './support.ts'
import { app, inboxWorld, liveSale, makeToken, sms, statuses } from './sms3-support.ts'

interface FeedItem {
  readonly at: string
  readonly last4: string | null
  readonly sender: string | null
  readonly text: string
  readonly result: string
  readonly numbers: number[]
}

describe('D-UX4-12 최근 손님 문자', () => {
  it('방송 중 온 손님 문자가 서버가 한 일과 함께 최신이 앞으로 보이고, 본문은 DB에 없다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16])
    expect(
      await statuses(world, token, [
        sms('a1', '010-1234-5678', '15 김영희'),
        sms('a2', '010-2222-3333', '16 취소'),
        sms('a3', '010-4444-5555', '15 있나요?'),
        sms('a4', '010-6666-7777', '안녕하세요 오늘 방송 재밌어요'),
        app('a5', 'com.kbstar.kbbank', 'KB국민', '입금 10,000원 김영희'),
      ]),
    ).toEqual(['SAVED', 'SAVED', 'SAVED', 'IGNORED', expect.any(String)])
    const feed = (await expectOk(client(world, seller.cookie).get(`/api/inbox/sms?b=${sale.id}`))).body.messages as FeedItem[]
    expect(feed.map((item) => [item.text, item.result, item.numbers, item.last4])).toEqual([
      ['안녕하세요 오늘 방송 재밌어요', 'none', [], '7777'],
      ['15 있나요?', 'review', [15], '5555'],
      ['16 취소', 'cancel', [16], '3333'],
      ['15 김영희', 'claim', [15], '5678'],
    ])
    // 전체 번호는 응답에 없다
    expect(JSON.stringify(feed)).not.toContain('010')
    // 찜 아닌 문자·넣은 문자찜의 본문은 DB에 남기지 않는다 (C-07 그대로)
    const dump = await dumpAllTables(world.database)
    expect(dump).not.toContain('재밌어요')
    expect(dump).not.toContain('15 김영희')
  })

  it('다른 방송·다른 판매자에게는 보이지 않고, 잘못된 방송 값은 400', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('b1', '010-1234-5678', '15')])).toEqual(['SAVED'])
    const other = await addSeller(world)
    await makeToken(world, other)
    expect((await expectOk(client(world, other.cookie).get(`/api/inbox/sms?b=${sale.id}`))).body.messages).toEqual([])
    expect((await expectOk(client(world, seller.cookie).get('/api/inbox/sms?b=nope'))).body.messages).toEqual([])
    expect((await client(world, seller.cookie).get('/api/inbox/sms?b=../x')).status).toBe(400)
    expect((await client(world, seller.cookie).get('/api/inbox/sms')).status).toBe(400)
  })

  it('방송마다 최근 200통만, 마지막 문자 뒤 24시간이 지나면 지운다', () => {
    let now = 0
    const feed = new SmsFeed(() => now)
    for (let i = 0; i < SMS_FEED_MAX + 5; i++) feed.add('s', 'b', { atMs: i, last4: '1234', sender: null, text: `글${String(i)}`, result: 'none' })
    const list = feed.view('s', 'b')
    expect(list).toHaveLength(SMS_FEED_MAX)
    expect(list[0]?.text).toBe(`글${String(SMS_FEED_MAX + 4)}`)
    now += SMS_FEED_KEEP_MS + 1
    expect(feed.view('s', 'b')).toEqual([])
  })
})
