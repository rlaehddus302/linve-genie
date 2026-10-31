// KP1 적대 시험 (test-domain) — "애매하면 쓰지 않는다"(CR-0 6)와 칸이 없어야 하는 묶음.
// - 합친 묶음의 구성원(유튜브 + 전화번호 있는 문자 구매자)이 서로 다른 장부 줄 둘에 걸치면: 묶음 자세히·링크에 "확인 전"도 장부 칸도 없고 [배송지 확인]은 409 (AC-KP1-08)
// - 판매자가 다른 손님의 장부 ID로 지우기·배송지 확인을 보내도 남의 줄은 그대로 (AC-KP1-07·08)
// - 품목 없는 묶음(모두 취소)·직접 수령 묶음에서 온 keep=on은 장부를 만들지 않는다 (AC-KP1-02)
// - 손님 엑셀의 연락처 열(받는 분·주소)도 수식으로 읽히지 않는다 (AC-KP1-12·13)
// - 다가오는 일정 9개에서 동시에 셋을 더해도 10개까지만 (AC-KP1-20)
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { at, chat, ok } from '../../../apps/server/test/i2-support.ts'
import { consent, consents, ledgerApi, ledgerWorld, linkFor, lines, openLink, rowsOf, sendAddress } from '../../../apps/server/test/kp1-ledger-support.ts'
import { ORIGIN, addSeller, client, createBroadcast, fakeClock, newWorld } from '../../../apps/server/test/support.ts'
import { sell } from '../../../apps/server/test/t1-support.ts'
import { kst } from '../../../apps/server/test/i2-support.ts'

/** exceljs는 서버 패키지 의존성이라 그 패키지 기준으로 불러온다(루트에서 타입을 찾지 못해 쓰는 부분만 적는다) */
interface XlsxCell {
  readonly value: unknown
}
interface XlsxRow {
  readonly values: unknown
  getCell(index: number): XlsxCell
  eachCell(callback: (cell: XlsxCell) => void): void
}
interface XlsxSheet {
  readonly rowCount: number
  getRow(index: number): XlsxRow
  eachRow(callback: (row: XlsxRow) => void): void
}
interface XlsxBook {
  readonly xlsx: { load(data: ArrayBuffer): Promise<unknown> }
  readonly worksheets: XlsxSheet[]
  getWorksheet(name: string): XlsxSheet | undefined
}
const ExcelJS = createRequire(new URL('../../../apps/server/package.json', import.meta.url))('exceljs') as { Workbook: new () => XlsxBook }

const D = '2026-10-19'
const D2 = '2026-10-26'
const OTHER = { name: '문자손님', phone: '010-4444-5555', address: '부산광역시 해운대구 문자로 9', detail: '', zip: '48000', memo: '' }

describe('AC-KP1-08 합친 묶음이 장부 줄 둘에 걸치면 보이지 않는다 (적대)', () => {
  it('유튜브 UC_A(줄 1)와 전화번호 있는 문자 구매자(줄 2)를 다음 방송에서 합치면 — 묶음 자세히 ledger null·링크에 지난번 배송지·장부 칸 없음·[배송지 확인] 409', async () => {
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [['UC_A', '가람', 1]])
    await ok(world, seller, { type: 'product.register', b, no: 50, name: '문자상품', price: 5000 })
    const sms = (await ok(world, seller, { type: 'sms', b, no: 50, received: '20:00', phone: OTHER.phone })).body.buyer as string
    await consent(world, seller, 'UC_A')
    at(world, D, '20:10:00')
    await consent(world, seller, sms, D, OTHER)
    expect(await lines(world)).toHaveLength(2)
    // 다음 방송: 같은 두 사람 → 합침
    at(world, D2, '20:00:00')
    const b2 = await sell(world, seller, [['UC_A', '가람', 1]], D2)
    await ok(world, seller, { type: 'product.register', b: b2, no: 60, name: '문자상품2', price: 6000 })
    const sms2 = (await ok(world, seller, { type: 'sms', b: b2, no: 60, received: '20:01', phone: OTHER.phone })).body.buyer as string
    const api = ledgerApi(world, seller.cookie)
    // 합치기 전: 각자 자기 줄이 보인다 (문자 구매자는 전화번호 키로 이어진다)
    expect(((await api.bundle(sms2, D2)).body.bundle as { ledger: { name: string } | null }).ledger?.name).toBe('문자손님')
    expect(((await api.bundle('UC_A', D2)).body.bundle as { ledger: { name: string } | null }).ledger?.name).toBe('홍길동')
    const lineIds = (await lines(world)).map((row) => row.id as string)
    const before = (await api.bundle('UC_A', D2)).body.bundle as { ledger: { ledgerId: string; updatedAt: string } }
    await ok(world, seller, { type: 'buyer.merge', from: sms2, into: 'UC_A', reason: '같은 사람' }, D2)
    const merged = await api.bundle('UC_A', D2)
    expect(merged.status, merged.text).toBe(200)
    expect((merged.body.bundle as { ledger: unknown }).ledger).toBeNull()
    for (const secret of ['홍길동', '문자손님', '문자로 9', '세종대로']) expect(merged.text).not.toContain(secret)
    const page = await openLink(world, `/r/${await linkFor(world, seller, 'UC_A', D2)}`)
    expect(page.status).toBe(200)
    expect(page.text).not.toContain('지난번 배송지로 보낼게요')
    expect(page.text).not.toContain('저장해 둔 배송지가 있어요')
    expect(page.text).not.toContain('다른 계정도 잇기')
    // 합치기 전에 받아 둔 장부 ID로 [배송지 확인]해도 409 — 묶음 배송지가 생기지 않는다
    const confirm = await api.confirmLedger('UC_A', before.ledger.ledgerId, before.ledger.updatedAt, D2)
    expect(confirm.status, confirm.text).toBe(409)
    expect((confirm.body.error as { code: string }).code).toBe('NO_LEDGER')
    expect(((await api.bundle('UC_A', D2)).body.bundle as { address: unknown }).address).toBeNull()
    expect((await lines(world)).map((row) => row.id)).toEqual(lineIds)
  })
})

describe('AC-KP1-07·08 남의 장부 ID (적대)', () => {
  it('UC_B 묶음에 UC_A 장부 ID로 [배송지 확인] → 409 (UC_A 주소가 UC_B 묶음에 들어가지 않는다), UC_B 손님 자세히에서 UC_A 장부 ID로 지우기 → 409 (UC_A 줄은 그대로)', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await consent(world, seller, 'UC_A')
    at(world, D2, '20:00:00')
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ], D2)
    const api = ledgerApi(world, seller.cookie)
    const a = (await api.bundle('UC_A', D2)).body.bundle as { ledger: { ledgerId: string; updatedAt: string } }
    const wrong = await api.confirmLedger('UC_B', a.ledger.ledgerId, a.ledger.updatedAt, D2)
    expect(wrong.status, wrong.text).toBe(409)
    expect(((await api.bundle('UC_B', D2)).body.bundle as { address: unknown; ledger: unknown })).toMatchObject({ address: null, ledger: null })
    const rows = (await api.customers()).body.customers as { id: string; name: string }[]
    const bId = rows.find((row) => row.name === '나래')?.id as string
    const removed = await api.deleteLedger(bId, a.ledger.ledgerId)
    expect(removed.status, removed.text).toBe(409)
    expect(await lines(world)).toHaveLength(1)
    expect((await consents(world)).map((row) => row.type)).toEqual(['AGREE'])
  })
})

describe('AC-KP1-02 칸이 없는 묶음에서 온 keep=on (적대)', () => {
  it('모두 취소해 품목이 없는 묶음·직접 수령 묶음: 링크에 체크 칸이 없고, keep=on을 보내도 장부 줄이 생기지 않는다', async () => {
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_P', '픽업', 1],
    ])
    const tokenA = await linkFor(world, seller, 'UC_A')
    const tokenP = await linkFor(world, seller, 'UC_P')
    await ok(world, seller, { type: 'host.cancel', b, no: 1, buyer: 'UC_A', reason: '손님 요청' })
    await ok(world, seller, { type: 'settlement.shippingOverride', buyer: 'UC_P', date: D, mode: 'PICKUP' }, D)
    for (const token of [tokenA, tokenP]) {
      const page = await openLink(world, `/r/${token}`)
      expect(page.text).not.toContain('name="keep"')
      // 화면에 칸이 없어도 양식을 손으로 만들어 보낸다
      await sendAddress(world, token, true)
    }
    expect(await lines(world)).toEqual([])
    expect(await consents(world)).toEqual([])
  })
})

describe('AC-KP1-12·13 손님 엑셀 연락처 열의 수식 (적대)', () => {
  it('화면 이름 =HYPERLINK(…)·받는 분 @SUM(…)·상세 주소 +1+1 — 칸 글이 수식으로 저장되지 않고 앞에 따옴표가 붙는다', async () => {
    const { world, seller } = await ledgerWorld()
    const b = (await createBroadcast(world, seller, { date: D })).id
    await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
    await chat(world, seller, b, 'f1', 'UC_F', '=HYPERLINK("http://evil.example","눌러")', '1')
    const token = await linkFor(world, seller, 'UC_F')
    const sent = await sendAddress(world, token, true, { name: '@SUM(1+1)', phone: '010-1212-3434', address: '서울특별시 중구 세종대로 110', detail: '+1+1', zip: '04524', memo: '' })
    expect(sent.status, sent.text).toBe(303)
    const response = await ledgerApi(world, seller.cookie).xlsx('1')
    expect(response.status).toBe(200)
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await response.arrayBuffer())
    const sheet = book.getWorksheet('손님')
    const cells: unknown[] = []
    sheet?.eachRow((row) => row.eachCell((cell) => cells.push(cell.value)))
    for (const value of cells) expect(typeof value === 'object' && value !== null && 'formula' in value, JSON.stringify(value)).toBe(false)
    const texts = cells.filter((value): value is string => typeof value === 'string')
    // 화면 이름은 기존 이름 다듬기(주소 점 바꿈·길이 자름)를 거친 뒤에도 앞에 따옴표
    expect(texts.some((text) => text.startsWith("'=HYPERLINK("))).toBe(true)
    expect(texts.some((text) => text.startsWith('=') || text.startsWith('@') || text.startsWith('+'))).toBe(false)
    expect(texts).toContain("'@SUM(1+1)")
    expect(texts).toContain("'+1+1")
  })
})

describe('AC-KP1-20 다가오는 일정 10개 (적대 — 동시)', () => {
  it('9개가 있을 때 동시에 셋을 더하면 하나만 되고 둘은 409, 다가오는 일정은 10개', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-31', '09:00:00')) })
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const item = (day: number) => ({ date: `2026-11-${String(day).padStart(2, '0')}`, time: '20:00', title: `${String(day)}일 방송`, intro: '' })
    for (let day = 1; day <= 9; day++) expect((await api.post('/api/schedule/items', item(day))).status).toBe(200)
    const results = await Promise.all([20, 21, 22].map((day) => api.post('/api/schedule/items', item(day))))
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409])
    expect(((await api.get('/api/schedule')).body.items as unknown[]).length).toBe(10)
    expect(await rowsOf(world, 'select count(*)::int as n from schedule_items')).toEqual([{ n: 10 }])
  })
})

describe('AC-KP1-07·09·11 링크 장부 양식은 앱 화면에서 보낸 것만 (적대 — 다른 출처)', () => {
  it('다른 출처·Origin 없음+cross-site에서 보낸 지우기·코드 받기·확인·동의 저장은 403이고 장부·코드는 그대로. JSON 본문·없는 경로도 아무것도 바꾸지 않는다', async () => {
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    const { postForm, codes } = await import('../../../apps/server/test/kp1-ledger-support.ts')
    expect((await postForm(world, `/r/${token}/ledger/code`, {})).status).toBe(303)
    const code = (await codes(world))[0]?.code as string
    await chat(world, seller, b, 'c1', 'UC_Z', '제트', code)
    const { waitFor } = await import('../../../apps/server/test/support.ts')
    await waitFor(async () => (await codes(world))[0]?.state === 'CLAIMED')
    const before = { lines: await lines(world), codes: await codes(world), consents: await consents(world) }
    const evil: Record<string, string>[] = [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'null' }]
    for (const headers of evil) {
      for (const [path, form] of [
        ['ledger/delete', {}],
        ['ledger/code', {}],
        ['ledger/link', { answer: 'yes' }],
        ['address', { name: '공격자', phone: '010-6666-7777', address: '서울특별시 중구 공격로 1', detail: '', zip: '04524', memo: '', keep: 'on' }],
      ] as const) {
        const sent = await postForm(world, `/r/${token}/${path}`, form, headers)
        expect(sent.status, `${JSON.stringify(headers)} ${path}`).toBe(403)
      }
    }
    // JSON 본문
    const json = await world.server.app.request(`/r/${token}/ledger/delete`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}' })
    expect(json.status).not.toBe(303)
    expect(await lines(world)).toEqual(before.lines)
    expect(await codes(world)).toEqual(before.codes)
    expect(await consents(world)).toEqual(before.consents)
  })
})

describe('AC-KP1-20 일정 글의 휴대폰 번호 모양 (적대 — 실제로 칠 법한 변형)', () => {
  it('하이픈·점·공백·전각 숫자·자모 구분(ㅡ)·괄호로 쓴 휴대폰 번호는 제목·소개 모두 받지 않는다(저장 없음). 날짜·시각·가격 숫자는 받는다', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-31', '09:00:00')) })
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const phones = ['010-2345-6789', '010.2345.6789', '010 2345 6789', '０１０-２３４５-６７８９', '010ㅡ2345ㅡ6789', '(010)2345-6789', '01023456789']
    for (const phone of phones) {
      for (const body of [
        { date: '2026-11-07', time: '20:00', title: `문의 ${phone}`, intro: '' },
        { date: '2026-11-07', time: '20:00', title: '토요일 방송', intro: `주문은 ${phone}로 문자 주세요` },
      ]) {
        const sent = await api.post('/api/schedule/items', body)
        expect(sent.status, `${phone} ${JSON.stringify(body)}`).toBe(400)
      }
    }
    expect(await rowsOf(world, 'select count(*)::int as n from schedule_items')).toEqual([{ n: 0 }])
    expect((await api.post('/api/schedule/items', { date: '2026-11-07', time: '20:00', title: '11월 7일 20시 방송 — 5,000원부터', intro: '1번부터 30번까지' })).status).toBe(200)
  })
})
