// KP1 손님 장부 경로 — 설정(CR-3·CR-7), 콘솔 손님 표시(AC-KP1-14·16), 손님 엑셀(AC-KP1-12·13 서버 쪽), 판매자만·판매자마다(AC-KP1-26).
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buy, payAll } from './crm1-support.ts'
import { at } from './i2-support.ts'
import { addSeller, client, createBroadcast, expectOk, fakeClock, login } from './support.ts'
import { ADDRESS, consent, kst, ledgerApi, logText, parcelSeller, parcelWorld, rowsOf } from './kp1-ledger-support.ts'

const D1 = '2026-10-12'
const D = '2026-10-19'

async function world4() {
  const world = await parcelWorld({ clock: fakeClock(kst(D1, '19:00:00')) })
  const seller = await parcelSeller(world)
  // D1: A 미입금(→ 오늘 입금 늦음 주의), B 125,000원 입금(단골), DD 40,000원 입금(전에 옴)
  const { b } = await buy(world, seller, D1, 'UC_A', '가람', 30_000)
  await buy(world, seller, D1, 'UC_B', '나래', 125_000, b)
  await buy(world, seller, D1, 'UC_D', '다온', 40_000, b)
  await payAll(world, seller, D1, 'UC_B')
  await payAll(world, seller, D1, 'UC_D')
  // D: 모두 다시, C는 처음
  const today = await buy(world, seller, D, 'UC_C', '시시', 10_000)
  await buy(world, seller, D, 'UC_A', '가람', 10_000, today.b)
  return { world, seller, b: today.b }
}

describe('설정 "손님 관리"의 장부 칸 (CR-3·CR-7)', () => {
  it('없으면 12개월·켬, PUT 둘 다 검사, 모르는 키 UNKNOWN_FIELD', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    const api = ledgerApi(world, seller.cookie)
    const first = await api.settings()
    expect(first.body).toEqual({ settings: { months: 12, consoleBadges: true } })
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect((await api.saveSettings({ months: 6, consoleBadges: false })).body).toEqual({ settings: { months: 6, consoleBadges: false } })
    expect((await api.settings()).body).toEqual({ settings: { months: 6, consoleBadges: false } })
    const bad = await api.saveSettings({ months: 18, consoleBadges: 'yes' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatchObject({
      code: 'INVALID_INPUT',
      problems: [
        { field: 'months', message: '보관 기간을 다시 골라 주세요.' },
        { field: 'consoleBadges', message: '방송 화면에 손님 표시를 다시 골라 주세요.' },
      ],
    })
    expect((await api.saveSettings({ months: 12, consoleBadges: true, extra: 1 })).body.error).toMatchObject({ code: 'UNKNOWN_FIELD' })
    expect((await api.saveSettings({ months: 12 })).status).toBe(400)
  })
})

describe('AC-KP1-14·16 콘솔 손님 표시', () => {
  it('A 입금 늦음 주의 · B 단골 · 누적 125,000원 · C 처음 · D 없음 (물은 순서대로), 화면 읽기 글', async () => {
    const { world, seller } = await world4()
    const api = ledgerApi(world, seller.cookie)
    const response = await api.badges(D, ['UC_A', 'UC_B', 'UC_C', 'UC_D', 'UC_A'])
    expect(response.status, response.text).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.body).toEqual({
      show: true,
      badges: [
        { buyer: 'UC_A', text: '입금 늦음 주의', spoken: '손님: 입금 늦음 주의' },
        { buyer: 'UC_B', text: '단골 · 누적 125,000원', spoken: '손님: 단골, 누적 125,000원' },
        { buyer: 'UC_C', text: '처음', spoken: '손님: 처음' },
        { buyer: 'UC_D', text: null, spoken: null },
      ],
    })
    // 끄면 모두 없음
    expect((await api.saveSettings({ months: 12, consoleBadges: false })).status).toBe(200)
    expect((await api.badges(D, ['UC_A', 'UC_B'])).body).toEqual({
      show: false,
      badges: [
        { buyer: 'UC_A', text: null, spoken: null },
        { buyer: 'UC_B', text: null, spoken: null },
      ],
    })
  })

  it('리허설·없는 날짜 404, 0명·51명·모양 틀림 400', async () => {
    const { world, seller } = await world4()
    const api = ledgerApi(world, seller.cookie)
    expect((await api.badges(D, ['UC_A'], '&rehearsal=true')).status).toBe(404)
    expect((await api.badges('2026-10-01', ['UC_A'])).status).toBe(404)
    expect((await api.badges('2026-13-40', ['UC_A'])).status).toBe(404)
    const message = { field: 'buyer', message: '손님을 1~50명씩 물어 주세요.' }
    expect((await api.badges(D, [])).body.error).toMatchObject({ code: 'INVALID_INPUT', problems: [message] })
    expect((await api.badges(D, Array.from({ length: 51 }, (_, i) => `UC_${String(i)}`))).status).toBe(400)
    expect((await api.badges(D, Array.from({ length: 50 }, (_, i) => `UC_${String(i)}`))).status).toBe(200)
    expect((await api.badges(D, ['a\u0000b'])).status).toBe(400)
  })
})

describe('AC-KP1-12·13 손님 엑셀 (서버)', () => {
  it('기본 9열 — 연락처 열은 contact=1일 때만, 받을 때마다 누가·언제·연락처 여부를 남긴다', async () => {
    const { world, seller } = await world4()
    at(world, D, '21:00:00')
    await consent(world, seller, 'UC_A', D)
    const api = ledgerApi(world, seller.cookie)
    const read = async (contact?: string) => {
      const response = await api.xlsx(contact)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent(`손님-${D}.xlsx`)}`)
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(await response.arrayBuffer())
      const sheet = book.getWorksheet('손님')
      expect(sheet).toBeDefined()
      const rows: unknown[][] = []
      sheet?.eachRow((row) => rows.push((row.values as unknown[]).slice(1)))
      return rows
    }
    const plain = await read()
    expect(plain[0]).toHaveLength(9)
    expect(plain.slice(1).map((row) => row[0])).toEqual(['나래', '다온', '가람', '시시'])
    expect(plain.flat()).not.toContain('홍길동')
    const full = await read('1')
    expect(full[0]).toHaveLength(15)
    const a = full.find((row) => row[0] === '가람') as unknown[]
    expect(a.slice(9)).toEqual(['홍길동', '01012345678', ADDRESS.address, ADDRESS.detail, '04524', '2027-10-19'])
    expect((await api.xlsx('2')).status).toBe(400)
    expect((await rowsOf(world, 'select seller_id, account_id, contact from customer_exports order by id'))).toEqual([
      { seller_id: seller.sellerId, account_id: seller.accountId, contact: false },
      { seller_id: seller.sellerId, account_id: seller.accountId, contact: true },
    ])
    expect(logText(world)).not.toContain('01012345678')
  })

  it('손님이 0명이어도 머리줄만 있는 파일', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    const response = await ledgerApi(world, seller.cookie).xlsx()
    expect(response.status).toBe(200)
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await response.arrayBuffer())
    expect(book.getWorksheet('손님')?.rowCount).toBe(1)
  })
})

describe('AC-KP1-26 판매자만·판매자마다', () => {
  it('로그인 없음 401, 보조자 403, 다른 판매자 것 404, 다른 판매자의 꼬리표에 장부가 없다', async () => {
    const { world, seller } = await world4()
    at(world, D, '21:00:00')
    await consent(world, seller, 'UC_A', D)
    const id = ((await ledgerApi(world, seller.cookie).customers()).body.customers as { id: string; name: string }[]).find((row) => row.name === '가람')?.id as string
    const ledgerId = (await rowsOf(world, 'select id from ledger_lines'))[0]?.id as string
    const created = await expectOk(client(world, seller.cookie).post('/api/assistants', { name: '엄마' }))
    const assistant = created.body as { assistant: { loginId: string }; password: string }
    const helper = await login(world, assistant.assistant.loginId, assistant.password)
    const calls = (cookie: string | null) => {
      const api = ledgerApi(world, cookie)
      return [api.settings(), api.saveSettings({ months: 6, consoleBadges: true }), api.badges(D, ['UC_A']), Promise.resolve(api.xlsx('1')).then((response: Response) => ({ status: response.status })), api.deleteLedger(id, ledgerId)]
    }
    for (const response of await Promise.all(calls(null))) expect(response.status).toBe(401)
    for (const response of await Promise.all(calls(helper))) expect(response.status).toBe(403)
    const other = await addSeller(world)
    const otherApi = ledgerApi(world, other.cookie)
    expect((await otherApi.badges(D, ['UC_A'])).status).toBe(404)
    expect((await otherApi.deleteLedger(id, ledgerId)).status).toBe(404)
    // 같은 날짜에 다른 판매자가 같은 채널을 팔아도 A의 장부·기록이 꼬리표에 나오지 않는다
    at(world, D, '21:30:00')
    await createBroadcast(world, other, { date: D })
    expect((await otherApi.badges(D, ['UC_A', 'UC_B'])).body).toEqual({
      show: true,
      badges: [
        { buyer: 'UC_A', text: '처음', spoken: '손님: 처음' },
        { buyer: 'UC_B', text: '처음', spoken: '손님: 처음' },
      ],
    })
    const otherXlsx = await otherApi.xlsx('1')
    expect(otherXlsx.status).toBe(200)
    expect(await rowsOf(world, 'select * from ledger_lines')).toHaveLength(1)
  })
})
