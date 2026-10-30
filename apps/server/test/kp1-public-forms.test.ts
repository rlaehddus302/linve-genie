// KP1 공개 양식 감사 고침: RA-KP1-006(그 가게 판매자 세션이 함께 오면 손님 대신 동의·알림 신청을 받지 않음)·
// SA-KP1-003(처리 결과 한 줄은 서명 값이 맞고 실제 상태가 맞을 때만).
import { describe, expect, it } from 'vitest'
import { alertSubscribers } from '../src/db/schema.ts'
import { SELLER_CANNOT_CONSENT } from '../src/seller-here.ts'
import { putShop, SHOP } from './i2-support.ts'
import { addSeller, client, expectOk, ORIGIN } from './support.ts'
import { ADDRESS, consent, consents, ledgerWorld, linkFor, lines, openLink, postForm, sell } from './kp1-ledger-support.ts'

const SENTENCE = '판매자 로그인 화면에서는 손님 대신 동의할 수 없어요.'

describe('RA-KP1-006 확인서 링크: 그 가게 판매자 세션이면 동의 칸 대신 한 문장, 동의는 저장하지 않는다', () => {
  it('판매자 쿠키로 열면 칸 대신 문장, keep=on으로 보내도 배송지만 저장(장부·동의 기록 없음). 다른 판매자 쿠키는 막지 않는다', async () => {
    expect(SELLER_CANNOT_CONSENT).toBe(SENTENCE)
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    const token = await linkFor(world, seller, 'UC_A')
    const plain = await openLink(world, `/r/${token}`)
    expect(plain.text).toContain('name="keep"')
    expect(plain.text).not.toContain(SENTENCE)
    const mine = await openLink(world, `/r/${token}`, { headers: { Cookie: seller.cookie } })
    expect(mine.text).not.toContain('name="keep"')
    expect(mine.text).toContain(SENTENCE)
    const sent = await postForm(world, `/r/${token}/address`, { ...ADDRESS, keep: 'on' }, { Origin: ORIGIN, Cookie: seller.cookie })
    expect(sent.status, sent.text).toBe(303)
    expect(await lines(world)).toEqual([])
    expect(await consents(world)).toEqual([])
    const bundle = (await client(world, seller.cookie).get(`/api/parcels/days/2026-10-19/bundle?buyer=UC_A`)).body.bundle as { address: unknown }
    expect(bundle.address).not.toBeNull()
    // 다른 가게 판매자의 쿠키는 이 가게와 상관없다 — 손님처럼 동의할 수 있다
    const other = await addSeller(world)
    const tokenB = await linkFor(world, seller, 'UC_B')
    expect((await openLink(world, `/r/${tokenB}`, { headers: { Cookie: other.cookie } })).text).toContain('name="keep"')
    expect((await postForm(world, `/r/${tokenB}/address`, { ...ADDRESS, keep: 'on' }, { Origin: ORIGIN, Cookie: other.cookie })).status).toBe(303)
    expect(await lines(world)).toHaveLength(1)
  })
})

async function schedulePath(world: Parameters<typeof client>[0], cookie: string): Promise<string> {
  const view = (await expectOk(client(world, cookie).put('/api/schedule/page', { enabled: true, channelUrl: null }))).body as { page: { url: string } }
  return view.page.url.slice(ORIGIN.length)
}

describe('RA-KP1-006 공개 일정: 그 가게 판매자 세션이면 알림 신청 양식 대신 문장, 신청은 저장하지 않는다', () => {
  it('판매자 쿠키 GET은 양식 없음, POST /alert는 400·저장 없음, 쿠키 없으면 그대로', async () => {
    const { world, seller } = await ledgerWorld()
    await expectOk(putShop(world, seller, SHOP))
    const path = await schedulePath(world, seller.cookie)
    const mine = await (await world.server.app.request(path, { headers: { Cookie: seller.cookie } })).text()
    expect(mine).toContain(SENTENCE)
    expect(mine).not.toContain(`action="${path}/alert"`)
    const blocked = await postForm(world, `${path}/alert`, { phone: '010-2345-6789', agree: 'on' }, { Origin: ORIGIN, Cookie: seller.cookie })
    expect(blocked.status).toBe(400)
    expect(blocked.text).toContain(SENTENCE)
    expect(await world.database.db.select().from(alertSubscribers)).toEqual([])
    const plain = await (await world.server.app.request(path)).text()
    expect(plain).toContain(`action="${path}/alert"`)
    expect(plain).not.toContain(SENTENCE)
    expect((await postForm(world, `${path}/alert`, { phone: '010-2345-6789', agree: 'on' })).status).toBe(303)
    expect(await world.database.db.select().from(alertSubscribers)).toHaveLength(1)
  })
})

describe('SA-KP1-003 처리 결과 한 줄은 주소 질의만으로 보이지 않는다', () => {
  it('공개 일정: 지은 ?done=agree·틀린 서명·10분 지난 서명은 문장 없음, 303 주소 그대로면 보인다', async () => {
    const { world, seller } = await ledgerWorld()
    await expectOk(putShop(world, seller, SHOP))
    const path = await schedulePath(world, seller.cookie)
    const agreed = '방송 알림을 신청했어요'
    expect(await (await world.server.app.request(`${path}?done=agree&on=2026-10-19`)).text()).not.toContain(agreed)
    expect(await (await world.server.app.request(`${path}?done=agree&on=2026-10-19&n=9999999999999.AAAAAAAAAAAAAAAAAAAAAA`)).text()).not.toContain(agreed)
    const saved = await postForm(world, `${path}/alert`, { phone: '010-2345-6789', agree: 'on' })
    const location = saved.headers.get('location') as string
    expect(await (await world.server.app.request(location)).text()).toContain(agreed)
    // 다른 결과·날짜로 바꾸면 맞지 않는다
    expect(await (await world.server.app.request(location.replace('done=agree', 'done=stop'))).text()).not.toContain('그만 받아요')
    world.clock.set(world.clock.now() + 11 * 60 * 1000)
    expect(await (await world.server.app.request(location)).text()).not.toContain(agreed)
  })

  it('확인서 링크: 지은 ?ledger=deleted·linked·unlinked는 문장 없음, 서명이 맞아도 장부 줄이 남아 있으면 "지웠어요." 없음', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    for (const [query, text] of [
      ['deleted', '지웠어요.'],
      ['linked', '계정을 이었어요.'],
      ['unlinked', '잇지 않았어요.'],
    ] as const) {
      expect((await openLink(world, `/r/${token}?ledger=${query}`)).text, query).not.toContain(text)
    }
    // 지우고 받은 서명 주소 — 줄이 없으니 보인다
    const removed = await postForm(world, `/r/${token}/ledger/delete`, {})
    const location = (removed.headers.get('location') as string).replace('#ledger', '')
    expect((await openLink(world, location)).text).toContain('지웠어요.')
    // 다시 동의해 줄이 생기면 같은 서명 주소라도 "지웠어요."가 없다
    expect((await postForm(world, `/r/${token}/address`, { ...ADDRESS, keep: 'on' })).status).toBe(303)
    expect(await lines(world)).toHaveLength(1)
    expect((await openLink(world, location)).text).not.toContain('지웠어요.')
  })
})
