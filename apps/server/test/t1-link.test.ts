// T1 구매자 링크의 배송지 칸: AC-T1-10(칸이 보이는 때), AC-T1-11(구매자가 적기), AC-T1-12(접수 뒤 잠금과 배송 안내).
import { describe, expect, it } from 'vitest'
import { linkApi, openLink, tokenOf } from './n4b-support.ts'
import { ORIGIN, client, rid, type Seller, type TestServer } from './support.ts'
import { ADDRESS, D, bookOk, expect200, makeReady, parcelApi, parcelSeller, parcelWorld, sell, type ParcelWorld } from './t1-support.ts'

async function linkFor(world: TestServer, seller: Seller, buyer: string, date = D): Promise<string> {
  const created = await linkApi(world, seller.cookie).create(date, buyer)
  expect(created.status, created.text).toBe(200)
  return tokenOf((created.body.link as { url: string }).url)
}

const form = (values: Record<string, string>): string => new URLSearchParams(values).toString()

async function postForm(world: TestServer, token: string, values: Record<string, string>, headers: Record<string, string> = { Origin: ORIGIN }): Promise<{ status: number; headers: Headers; text: string }> {
  const response = await world.server.app.request(`/r/${token}/address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: form(values),
  })
  return { status: response.status, headers: response.headers, text: await response.text() }
}

async function addressRows(world: ParcelWorld): Promise<number> {
  return (await world.database.pglite?.query<{ n: number }>('select count(*)::int as n from parcel_addresses'))?.rows[0]?.n ?? -1
}

describe('AC-T1-10 칸이 보이는 때', () => {
  it('배송지 없음·접수 없음이면 확인서 아래 배송지 양식(여섯 칸 이름표·안내 문장), 스크립트 없음. 직접 수령·합배송은 한 문장', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_P', '피피', 1],
      ['UC_C', '시시', 1],
    ])
    const page = await openLink(world, `/r/${await linkFor(world, seller, 'UC_A')}`)
    expect(page.status).toBe(200)
    for (const label of ['받는 분', '연락처', '주소', '상세 주소', '우편번호(몰라도 돼요)', '배송 메모']) expect(page.text).toContain(`>${label}</label>`)
    expect(page.text).toContain('받는 분·연락처·주소는 이 주문을 보내는 데만 쓰고, 주문 날짜로부터 30일 뒤 지워요.')
    expect(page.text).toMatch(/<form method="post" action="\/r\/[A-Za-z0-9_-]{43}\/address">/)
    expect(page.text).not.toMatch(/<script/i)
    expect(page.headers.get('content-security-policy')).toContain("form-action 'self'")
    expect(page.headers.get('content-security-policy')).not.toContain('script-src')
    // 확인서 아래 (확인서 그림 뒤)
    expect(page.text.indexOf('id="address"')).toBeGreaterThan(page.text.indexOf('receipt.jpg'))
    for (const [buyer, mode, text] of [
      ['UC_P', 'PICKUP', '직접 받기로 했어요.'],
      ['UC_C', 'COMBINED', '다른 주문과 함께 보내요.'],
    ] as const) {
      expect((await client(world, seller.cookie).post(`/api/events?date=${D}`, { requestId: rid('ov'), type: 'settlement.shippingOverride', buyer, date: D, mode })).status).toBe(200)
      const other = await openLink(world, `/r/${await linkFor(world, seller, buyer)}`)
      expect(other.text).toContain(text)
      expect(other.text).not.toContain('<form')
    }
  })

  it('쓸 수 없는 링크는 지금과 같은 404 한 문장이고 양식이 없다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await linkFor(world, seller, 'UC_A')
    await expect200(linkApi(world, seller.cookie).revoke(D, 'UC_A'))
    const closed = await openLink(world, `/r/${token}`)
    expect(closed.status).toBe(404)
    expect(closed.text).not.toContain('<form')
    const posted = await postForm(world, token, ADDRESS)
    expect(posted.status).toBe(404)
    expect(await addressRows(world)).toBe(0)
  })
})

describe('AC-T1-11 구매자가 적기', () => {
  it('맞으면 확인 전으로 저장하고 303 같은 링크, 그 쪽에는 받았어요·이름·연락처 끝 4자리만, 다시 적기는 빈 양식', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await linkFor(world, seller, 'UC_A')
    const saved = await postForm(world, token, ADDRESS)
    expect(saved.status).toBe(303)
    expect(saved.headers.get('location')).toBe(`/r/${token}`)
    expect(saved.headers.get('cache-control')).toBe('no-store')
    const page = await openLink(world, `/r/${token}`)
    expect(page.text).toContain('배송지를 받았어요')
    expect(page.text).toContain('받는 분 홍길동 · 연락처 끝 5678')
    for (const hidden of ['세종대로', '101동', '문 앞에', '01012345678', '010-1234-5678', '04524']) expect(page.text, hidden).not.toContain(hidden)
    const bundle = await expect200(parcelApi(world, seller.cookie).bundle('UC_A'))
    expect(bundle.body.bundle).toMatchObject({ address: { source: 'BUYER', confirmed: false, name: '홍길동' } })
    const edit = await openLink(world, `/r/${token}?edit=1`)
    expect(edit.text).toContain('<form')
    expect(edit.text).not.toContain('value="홍길동"')
    expect(edit.text).toContain('id="f-name" name="name"')
  })

  it('틀리면 저장하지 않고 400 같은 쪽에 칸마다 문장(적은 값은 그 응답에만 이스케이프해서 다시 채움)', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await linkFor(world, seller, 'UC_A')
    const wrong = await postForm(world, token, { ...ADDRESS, name: '<b>홍</b>', phone: '1234', address: '' })
    expect(wrong.status).toBe(400)
    expect(wrong.text).toContain('data-code="PHONE_INVALID">연락처는 010으로 시작하는 숫자로 적어 주세요.')
    expect(wrong.text).toContain('data-code="ADDRESS_EMPTY">주소를 적어 주세요.')
    expect(wrong.text).toContain('value="&lt;b&gt;홍&lt;/b&gt;"')
    expect(wrong.text).not.toContain('<b>홍</b>')
    expect(wrong.text).toContain('aria-invalid="true"')
    expect(await addressRows(world)).toBe(0)
    // 칸이 빠진 양식 → 400, 저장 없음
    const partial = await world.server.app.request(`/r/${token}/address`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN }, body: 'name=a' })
    expect(partial.status).toBe(400)
    expect(await addressRows(world)).toBe(0)
  })

  it('Origin이 없거나 다르면 403, 양식 보내기도 링크마다 1분 60번에 함께 센다(넘으면 429, 저장 없음), 다시 적으면 덮어쓰고 확인 전', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await linkFor(world, seller, 'UC_A')
    expect((await postForm(world, token, ADDRESS, {})).status).toBe(403)
    expect((await postForm(world, token, ADDRESS, { Origin: 'https://evil.example' })).status).toBe(403)
    expect(await addressRows(world)).toBe(0)
    // 판매자가 확인한 배송지를 구매자가 다시 적으면 덮어쓰고 확인 전
    await expect200(parcelApi(world, seller.cookie).putAddress('UC_A', ADDRESS))
    expect((await postForm(world, token, { ...ADDRESS, detail: '303호' })).status).toBe(303)
    expect((await expect200(parcelApi(world, seller.cookie).bundle('UC_A'))).body.bundle).toMatchObject({ address: { detail: '303호', confirmed: false, source: 'BUYER' } })
    // 한도: 지금까지 문서 0번 + 양식 1번(403은 세지 않는다) → 59번 더 열고 다음 양식은 429
    for (let i = 0; i < 59; i++) expect((await openLink(world, `/r/${token}`)).status).toBe(200)
    const limited = await postForm(world, token, { ...ADDRESS, detail: '404호' })
    expect(limited.status).toBe(429)
    expect((await expect200(parcelApi(world, seller.cookie).bundle('UC_A'))).body.bundle).toMatchObject({ address: { detail: '303호' } })
  })
})

describe('AC-T1-11 큰 양식 본문', () => {
  it('길이를 밝히지 않은(chunked) 본문도 한도(16KB)를 넘는 순간 읽기를 멈추고 400, 저장 없음. 한도 안 chunked 본문은 저장', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await linkFor(world, seller, 'UC_A')
    let pulled = 0
    const chunk = new TextEncoder().encode(`memo=${'a'.repeat(64 * 1024)}`)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        if (pulled > 200) controller.close()
        else controller.enqueue(chunk)
      },
    })
    const big = await world.server.app.request(
      new Request(`http://localhost/r/${token}/address`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN }, body: stream, duplex: 'half' } as RequestInit),
    )
    expect(big.status).toBe(400)
    expect(pulled).toBeLessThan(5)
    expect(await addressRows(world)).toBe(0)

    const small = new TextEncoder().encode(form(ADDRESS))
    const okStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(small.slice(0, 10))
        controller.enqueue(small.slice(10))
        controller.close()
      },
    })
    const ok = await world.server.app.request(
      new Request(`http://localhost/r/${token}/address`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN }, body: okStream, duplex: 'half' } as RequestInit),
    )
    expect(ok.status).toBe(303)
    expect(await addressRows(world)).toBe(1)
  })
})

describe('AC-T1-12 접수 뒤 잠금과 배송 안내', () => {
  it('BOOKED이면 양식 대신 택배를 보냈어요(택배사·송장번호 4자리 묶음·상태·마지막 확인·배송 조회 새 창), 옛 쪽에서 보내면 409, PENDING·UNKNOWN은 준비하고 있어요', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    const token = await linkFor(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_A')
    const [booked] = await bookOk(world, seller, [{ buyer: 'UC_A' }])
    world.carrier.setStatus(booked?.invoice as string, 'PICKED_UP')
    await world.server.parcels.trackOnce()
    const page = await openLink(world, `/r/${token}`)
    expect(page.text).toContain('택배를 보냈어요')
    expect(page.text).toContain('<dd>가짜 택배(시험용)</dd>')
    expect(page.text).toContain('<dd>9000-0000-0001</dd>')
    expect(page.text).toContain('<dd>집하</dd>')
    expect(page.text).toMatch(/<dt>마지막 확인<\/dt><dd>2026-10-19 \(월\) \d{2}:\d{2}<\/dd>/)
    expect(page.text).toContain(`href="${world.carrier.url}/track/900000000001" target="_blank" rel="noopener noreferrer">배송 조회</a>`)
    expect(page.text).not.toContain('<form')
    const late = await postForm(world, token, { ...ADDRESS, detail: '바꿈' })
    expect(late.status).toBe(409)
    expect(late.text).toContain('택배를 이미 접수했어요. 바꿀 일이 있으면 판매자에게 알려 주세요.')
    expect((await expect200(parcelApi(world, seller.cookie).bundle('UC_A'))).body.bundle).toMatchObject({ address: { detail: '101동 202호' } })
    // 응답 없음 → UNKNOWN: 준비하고 있어요
    const tokenB = await linkFor(world, seller, 'UC_B')
    await makeReady(world, seller, 'UC_B', { ...ADDRESS, address: '서울 [응답없음]' })
    await bookOk(world, seller, [{ buyer: 'UC_B' }])
    const waiting = await openLink(world, `/r/${tokenB}`)
    expect(waiting.text).toContain('택배 접수를 준비하고 있어요.')
    expect(waiting.text).not.toContain('<form')
    // 취소했으면 접수가 없는 것과 같다 (양식 대신 받은 배송지) — 시험이 상태를 접수됨으로 되돌려 둔다
    world.carrier.setStatus(booked?.invoice as string, 'ACCEPTED')
    await world.server.parcels.trackOnce()
    await expect200(parcelApi(world, seller.cookie).cancel('UC_A'))
    const after = await openLink(world, `/r/${token}`)
    expect(after.text).toContain('배송지를 받았어요')
    expect(after.text).not.toContain('택배를 보냈어요')
  })
})
