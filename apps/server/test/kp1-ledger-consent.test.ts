// KP1 손님 장부 — 동의 받기(AC-KP1-02·03·05)와 다음 주문에 "확인 전"으로 보이기·[배송지 확인](AC-KP1-08), 판매자는 대신 적을 수 없음(AC-KP1-04 서버 쪽).
import { describe, expect, it } from 'vitest'
import { at, ok } from './i2-support.ts'
import { client, rid, writeEvent } from './support.ts'
import { expectNoSecret, packAll, parcelApi, pay } from './t1-support.ts'
import { ADDRESS, D, consent, consents, ledgerApi, ledgerWorld, lines, linkFor, logText, markers, openLink, postForm, sell, sendAddress } from './kp1-ledger-support.ts'

const D2 = '2026-10-26'
const CONSENT_TEXT = '다음 주문에도 이 배송지 쓰기 (선택)'
const OTHER = { name: '남궁민수', phone: '010-2222-9999', address: '부산광역시 해운대구 우동 1', detail: '3층', zip: '48060', memo: '' }

describe('AC-KP1-02 동의 칸 보이기', () => {
  it('실제 날짜·품목 있음·유튜브 구매자: 양식 안 저장 버튼 위에 빈 체크 칸과 CR-CONSENT-2 글(기간 1년)', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const page = await openLink(world, `/r/${await linkFor(world, seller, 'UC_A')}`)
    expect(page.status).toBe(200)
    expect(page.text).toContain('<input id="f-keep" type="checkbox" name="keep" value="on" aria-describedby="keep-help">')
    expect(page.text).not.toMatch(/name="keep"[^>]*checked/)
    expect(page.text).toContain(CONSENT_TEXT)
    expect(page.text).toContain('마지막 주문 뒤 1년 동안 보관해요.')
    const form = page.text.slice(page.text.indexOf('<form'), page.text.indexOf('</form>'))
    expect(form.indexOf('name="keep"')).toBeGreaterThan(form.indexOf('name="memo"'))
    expect(form.indexOf('name="keep"')).toBeLessThan(form.indexOf('type="submit"'))
    expect(page.text).not.toMatch(/<script/i)
  })

  it('설정 기간을 바꾸면 문구의 {기간}도 바뀐다', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    expect((await ledgerApi(world, seller.cookie).saveSettings({ months: 36, consoleBadges: true })).status).toBe(200)
    expect((await openLink(world, `/r/${await linkFor(world, seller, 'UC_A')}`)).text).toContain('마지막 주문 뒤 3년 동안 보관해요.')
  })

  it('직접 수령·합배송·표지 없는 묶음(전화번호 없는 문자 구매자)에는 칸이 없다', async () => {
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [
      ['UC_P', '피피', 1],
      ['UC_C', '시시', 1],
    ])
    await ok(world, seller, { type: 'product.register', b, no: 50, name: '문자 상품', price: 5000 })
    const sms = (await ok(world, seller, { type: 'sms', b, no: 50, received: '20:30', memo: '번호 없음' })).body.buyer as string
    for (const [buyer, mode] of [
      ['UC_P', 'PICKUP'],
      ['UC_C', 'COMBINED'],
    ] as const) {
      expect((await client(world, seller.cookie).post(`/api/events?date=${D}`, { requestId: rid('ov'), type: 'settlement.shippingOverride', buyer, date: D, mode })).status).toBe(200)
    }
    for (const buyer of ['UC_P', 'UC_C', sms]) {
      const page = await openLink(world, `/r/${await linkFor(world, seller, buyer)}`)
      expect(page.status, buyer).toBe(200)
      expect(page.text, buyer).not.toContain('name="keep"')
      expect(page.text, buyer).not.toContain(CONSENT_TEXT)
    }
    // 표지 없는 묶음에서 온 keep=on은 무시하고 배송지만 저장한다
    const token = await linkFor(world, seller, sms)
    expect((await sendAddress(world, token, true)).status).toBe(303)
    expect(await lines(world)).toEqual([])
  })
})

describe('AC-KP1-03 고르고 저장', () => {
  it('고르면 같은 트랜잭션에서 장부 줄(표지 = 구성원)·암호화한 다섯 칸·AGREE 기록, 개인정보는 기록·로그에 없다', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    await consent(world, seller, 'UC_A')
    const [line] = await lines(world)
    expect(line?.seller_id).toBe(seller.sellerId)
    expect(String(line?.id)).toMatch(/^[0-9a-f]{32}$/)
    expect(line?.consent_date).toBe(D)
    expect(line?.consent_months).toBe(12)
    const sealed = String(line?.contact_enc)
    for (const secret of [ADDRESS.name, '01012345678', ADDRESS.address, ADDRESS.detail, '04524', ADDRESS.memo]) expectNoSecret(sealed, secret)
    expect(await markers(world)).toEqual([{ seller_id: seller.sellerId, marker: 'c:UC_A', line_id: line?.id, source: 'CONSENT', label_platform: null, label_name: null, label_last4: null }])
    expect(await consents(world)).toEqual([
      { seller_id: seller.sellerId, line_id: line?.id, type: 'AGREE', items: '받는 분·연락처·주소·상세 주소·우편번호', wording: 'CR-CONSENT-2', months: 12, route: 'RECEIPT_LINK', order_date: D, reason: null, account_id: null },
    ])
    const logs = logText(world)
    for (const secret of [ADDRESS.name, '01012345678', ADDRESS.address, 'c:UC_A']) expectNoSecret(logs, secret)
  })

  it('고르지 않고 저장하면 장부는 그대로 (새로 생기지도, 지워지지도 않는다)', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await linkFor(world, seller, 'UC_A')
    expect((await sendAddress(world, token, false)).status).toBe(303)
    expect(await lines(world)).toEqual([])
    expect((await sendAddress(world, token, true)).status).toBe(303)
    const before = await lines(world)
    expect(before).toHaveLength(1)
    expect((await sendAddress(world, token, false, OTHER)).status).toBe(303)
    expect(await lines(world)).toEqual(before)
  })

  it('keep 칸이 둘이거나 on이 아니면 400 (저장 없음)', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await linkFor(world, seller, 'UC_A')
    const fields = Object.entries(ADDRESS)
    expect((await postForm(world, `/r/${token}/address`, [...fields, ['keep', 'yes']])).status).toBe(400)
    expect((await postForm(world, `/r/${token}/address`, [...fields, ['keep', 'on'], ['keep', 'on']])).status).toBe(400)
    expect(await lines(world)).toEqual([])
  })

  it('표지 A·B의 두 줄이 있는데 합친 묶음(A·B)에서 고르면 한 줄로 (먼저 만든 ID, 표지 A∪B, 연락처는 이번 값). 없어진 줄은 EXPIRE 줄 합침', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await consent(world, seller, 'UC_A')
    at(world, D, '20:10:00')
    await consent(world, seller, 'UC_B', D, OTHER)
    const [first, second] = await lines(world)
    expect(second).toBeDefined()
    at(world, D2, '20:00:00')
    await sell(
      world,
      seller,
      [
        ['UC_A', '가람', 1],
        ['UC_B', '나래', 1],
      ],
      D2,
    )
    expect((await writeEvent(world, seller, { type: 'buyer.merge', from: 'UC_B', into: 'UC_A', reason: '같은 사람' }, D2)).status).toBe(200)
    // 합친 묶음엔 줄이 둘이라 "확인 전"이 보이지 않는다 (AC-KP1-08 끝)
    expect((await ledgerApi(world, seller.cookie).bundle('UC_A', D2)).body.bundle).toMatchObject({ ledger: null })
    await consent(world, seller, 'UC_A', D2)
    const after = await lines(world)
    expect(after.map((line) => line.id)).toEqual([first?.id])
    expect(after[0]?.consent_date).toBe(D2)
    expect((await markers(world)).map((row) => [row.marker, row.line_id]).sort()).toEqual([
      ['c:UC_A', first?.id],
      ['c:UC_B', first?.id],
    ])
    const view = (await ledgerApi(world, seller.cookie).bundle('UC_A', D2)).body.bundle as { ledger: unknown; address: unknown }
    expect(view.address).not.toBeNull()
    const types = (await consents(world)).map((row) => [row.type, row.line_id, row.reason])
    expect(types).toEqual([
      ['AGREE', first?.id, null],
      ['AGREE', second?.id, null],
      ['EXPIRE', second?.id, '줄 합침'],
      ['AGREE', first?.id, null],
    ])
  })
})

describe('AC-KP1-04 판매자는 대신 적을 수 없다', () => {
  it('판매자가 묶음 배송지를 적어도 장부가 생기지 않는다 (keep을 보내도 400)', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const parcels = parcelApi(world, seller.cookie)
    expect((await parcels.putAddress('UC_A', ADDRESS)).status).toBe(200)
    expect((await client(world, seller.cookie).put(`/api/parcels/days/${D}/address`, { requestId: rid('pa'), buyer: 'UC_A', address: ADDRESS, keep: true })).status).toBe(400)
    expect(await lines(world)).toEqual([])
  })
})

describe('AC-KP1-05·08 이미 저장한 손님 / 다음 주문에 "확인 전"', () => {
  it('링크에 가린 이름·끝 4자리만 (주소 원문 없음)', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    const page = await openLink(world, `/r/${token}`)
    expect(page.text).toContain('저장해 둔 배송지가 있어요 (받는 분 홍*동 · 연락처 끝 5678)')
    expect(page.text).toContain('저장한 정보 지우기')
    expect(page.text).toContain('id="ledger"')
    const ledgerPart = page.text.slice(page.text.indexOf('id="ledger"'))
    for (const secret of [ADDRESS.address, ADDRESS.detail, '04524', '01012345678', '010-1234-5678']) expect(ledgerPart).not.toContain(secret)
  })

  it('새 날짜 UC_A 묶음: 판매자 다섯 칸·택배 목록 UNCONFIRMED·링크 "지난번 배송지" → [배송지 확인]으로 묶음 배송지(판매자·확인함), 그 뒤 장부를 바꿔도 그대로', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    await consent(world, seller, 'UC_A')
    at(world, D2, '20:00:00')
    await sell(world, seller, [['UC_A', '가람', 1]], D2)
    // 입금·포장까지 끝나 배송지만 남은 묶음
    await pay(world, seller, 'UC_A', undefined, D2)
    await packAll(world, seller, 'UC_A', D2)
    const api = ledgerApi(world, seller.cookie)
    const bundle = (await api.bundle('UC_A', D2)).body.bundle as { address: unknown; ledger: Record<string, string>; row: { address: string; reason: string } }
    expect(bundle.address).toBeNull()
    expect(bundle.ledger).toEqual({ ledgerId: (await lines(world))[0]?.id, updatedAt: expect.any(String), name: '홍길동', phone: '01012345678', address: ADDRESS.address, detail: ADDRESS.detail, zip: '04524' })
    expect(bundle.row.address).toBe('UNCONFIRMED')
    const day = (await parcelApi(world, seller.cookie).day(D2)).body as { excluded: { buyer: string; reason: string; address: string }[] }
    expect(day.excluded.find((row) => row.buyer === 'UC_A')).toMatchObject({ reason: 'ADDRESS_UNCONFIRMED', address: 'UNCONFIRMED' })
    const token = await linkFor(world, seller, 'UC_A', D2)
    const page = await openLink(world, `/r/${token}`)
    expect(page.text).toContain('지난번 배송지로 보낼게요 (받는 분 홍*동 · 연락처 끝 5678). 바뀌었으면 다시 적어 주세요.')
    expect(page.text).not.toContain(ADDRESS.address)
    expect((await openLink(world, `/r/${token}?edit=1`)).text).toContain('<form method="post"')

    // 오류: 다른 ID·바뀐 시각
    expect((await api.confirmLedger('UC_A', '0'.repeat(32), bundle.ledger.updatedAt ?? '', D2)).body.error).toMatchObject({ code: 'NO_LEDGER', message: '지난 주문 배송지가 없어졌어요. 배송지를 직접 적어 주세요.' })
    expect((await api.confirmLedger('UC_A', bundle.ledger.ledgerId ?? '', '2020-01-01T00:00:00.000Z', D2)).body.error).toMatchObject({ code: 'LEDGER_CHANGED', message: '지난 주문 배송지가 바뀌었어요. 다시 확인해 주세요.' })
    const confirmed = await api.confirmLedger('UC_A', bundle.ledger.ledgerId ?? '', bundle.ledger.updatedAt ?? '', D2)
    expect(confirmed.status, confirmed.text).toBe(200)
    const saved = confirmed.body.bundle as { address: Record<string, unknown>; ledger: unknown; row: { address: string } }
    expect(saved.address).toMatchObject({ name: '홍길동', phone: '01012345678', memo: '', source: 'LEDGER', confirmed: true })
    expect(saved.ledger).toBeNull()
    expect(saved.row.address).toBe('CONFIRMED')
    expect((await api.confirmLedger('UC_A', bundle.ledger.ledgerId ?? '', bundle.ledger.updatedAt ?? '', D2)).body.error).toMatchObject({ code: 'ADDRESS_EXISTS' })
    // 장부를 바꿔도(새 동의) 묶음 배송지는 그대로
    at(world, D2, '21:00:00')
    await sell(world, seller, [['UC_A', '가람', 1]], '2026-10-27')
    await consent(world, seller, 'UC_A', '2026-10-27', OTHER)
    expect(((await api.bundle('UC_A', D2)).body.bundle as { address: { name: string } }).address.name).toBe('홍길동')
    // 판매자가 적은 배송지는 장부에 들어가지 않는다 (AC-KP1-04)
    expect((await consents(world)).map((row) => row.type)).toEqual(['AGREE', 'AGREE'])
  })

  it('확인 전에 장부를 지우면 보이던 칸이 바로 사라진다 (복사하지 않았다)', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    at(world, D2, '20:00:00')
    await sell(world, seller, [['UC_A', '가람', 1]], D2)
    const api = ledgerApi(world, seller.cookie)
    expect(((await api.bundle('UC_A', D2)).body.bundle as { ledger: unknown }).ledger).not.toBeNull()
    expect((await postForm(world, `/r/${token}/ledger/delete`, {})).status).toBe(303)
    const bundle = (await api.bundle('UC_A', D2)).body.bundle as { ledger: unknown; row: { address: string } }
    expect(bundle.ledger).toBeNull()
    expect(bundle.row.address).toBe('NONE')
  })

  it('다른 판매자의 같은 채널은 이어지지 않는다 (CR-0 5)', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    await consent(world, seller, 'UC_A')
    const { parcelSeller } = await import('./t1-support.ts')
    const other = await parcelSeller(world)
    at(world, D2, '20:00:00')
    await sell(world, other, [['UC_A', '가람', 1]], D2)
    expect(((await ledgerApi(world, other.cookie).bundle('UC_A', D2)).body.bundle as { ledger: unknown }).ledger).toBeNull()
    expect((await openLink(world, `/r/${await linkFor(world, other, 'UC_A', D2)}`)).text).not.toContain('지난번 배송지')
  })
})
