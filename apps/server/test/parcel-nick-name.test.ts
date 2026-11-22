// 받는 분 이름에 손님 닉네임 같이 적기 (D-PARCEL-NICK-01): 판매자가 설정 "택배"에서 켜면 우체국 접수(앱 안 사전접수 채울 값·방문접수 자료/파일·주소 파일·
// 택배사 자동 접수)의 받는 분 이름이 `이름(닉네임)`. 끄면(기본) 이름만. 20자를 넘으면 닉네임을 줄이고, 우체국이 받지 않을 수 있는 글자는 뺀다.
import { describe, expect, it } from 'vitest'
import { NICK_NAME_MAX, nickText, recipientName } from '../src/parcel/rules.ts'
import { client, rid } from './support.ts'
import { ADDRESS, D, SENDER, bookOk, expect200, makeReady, parcelApi, parcelSeller, parcelWorld, sell } from './t1-support.ts'

describe('받는 분 이름 만들기 (순수 규칙)', () => {
  it('켜면 이름(닉네임), 끄거나 닉네임이 없으면 이름만', () => {
    expect(recipientName('홍길동', '대박다육', true)).toBe('홍길동(대박다육)')
    expect(recipientName('홍길동', '대박다육', false)).toBe('홍길동')
    expect(recipientName('홍길동', null, true)).toBe('홍길동')
    expect(recipientName('홍길동', '', true)).toBe('홍길동')
  })

  it('닉네임이 이름과 같거나(공백 빼고) 이름에 이미 (닉네임)이 있으면 이름만', () => {
    expect(recipientName('홍길동', '홍길동', true)).toBe('홍길동')
    expect(recipientName('홍 길동', '홍길동 ', true)).toBe('홍 길동')
    expect(recipientName('홍길동(대박다육)', '대박다육', true)).toBe('홍길동(대박다육)')
    // 닉네임이 이름 일부일 뿐이면 붙인다
    expect(recipientName('김나래', '나래', true)).toBe('김나래(나래)')
  })

  it('20자를 넘으면 이름은 그대로 두고 닉네임 뒤를 줄인다. 자리가 없으면 이름만', () => {
    expect(NICK_NAME_MAX).toBe(20)
    const long = recipientName('홍길동', '다육이를너무사랑하는사람입니다정말로요', true)
    expect(long).toBe('홍길동(다육이를너무사랑하는사람입니다)')
    expect([...long]).toHaveLength(20)
    expect(recipientName('가'.repeat(17), '대박다육', true)).toBe(`${'가'.repeat(17)}(대)`)
    expect(recipientName('가'.repeat(18), '대박다육', true)).toBe('가'.repeat(18))
    expect(recipientName('가'.repeat(20), '대박다육', true)).toBe('가'.repeat(20))
    // 줄인 끝의 공백은 지운다
    expect(recipientName('가'.repeat(15), '대박 다육이', true)).toBe(`${'가'.repeat(15)}(대박)`)
  })

  it('닉네임 다듬기: 맨 앞 @·이모지·괄호·꺾쇠·따옴표·제어 글자를 빼고, 한글(자모 포함)·영문·숫자·공백·._-만 남긴다', () => {
    expect(nickText('@daebak_dayuk')).toBe('daebak_dayuk')
    expect(nickText('다육🌵맘')).toBe('다육맘')
    expect(nickText('<script>"x"</script>')).toBe('scriptxscript')
    expect(nickText('ㅋㅋ다육')).toBe('ㅋㅋ다육')
    expect(nickText('ＡＢＣ１２３')).toBe('ABC123')
    expect(nickText('a\u0000b\nc‮d')).toBe('ab cd')
    expect(nickText('(괄호)')).toBe('괄호')
    expect(nickText('🌵🌵')).toBe('')
    expect(recipientName('홍길동', '🌵🌵', true)).toBe('홍길동')
    expect(recipientName('홍길동', '@대박 다육 🌵', true)).toBe('홍길동(대박 다육)')
  })
})

const fillOf = (world: Awaited<ReturnType<typeof parcelWorld>>, cookie: string, buyer: string) => client(world, cookie).get(`/api/parcels/days/${D}/epost?buyer=${encodeURIComponent(buyer)}`)
const kitOf = (world: Awaited<ReturnType<typeof parcelWorld>>, cookie: string) => client(world, cookie).get(`/api/parcels/days/${D}/epost-kit`)

describe('설정 "택배" — 받는 분 이름에 닉네임 같이 적기 (D-PARCEL-NICK-01)', () => {
  it('기본은 꺼짐, 참·거짓만 받고, 다른 설정을 바꿔도 그대로', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'EPOST', sender: SENDER })
    const api = parcelApi(world, seller.cookie)
    expect(((await expect200(api.settings())).body.settings as { nickInName: boolean }).nickInName).toBe(false)
    const bad = await api.putSettings({ nickInName: 'yes' })
    expect(bad.status).toBe(400)
    expect(JSON.stringify(bad.body)).toContain('닉네임')
    expect(((await expect200(api.putSettings({ nickInName: true }))).body.settings as { nickInName: boolean }).nickInName).toBe(true)
    await expect200(api.putSettings({ box: '100' }))
    expect(((await expect200(api.settings())).body.settings as { nickInName: boolean }).nickInName).toBe(true)
    expect(((await expect200(api.putSettings({ nickInName: false }))).body.settings as { nickInName: boolean }).nickInName).toBe(false)
  })

  it('켜면 우체국 채울 값·방문접수 자료·주소 파일의 받는 분이 이름(닉네임), 직접 넣은 택배는 이름만. 끄면 모두 이름만. 로그에 이름·닉네임이 없다', async () => {
    const logs: unknown[] = []
    const world = await parcelWorld({ overrides: { log: (record) => logs.push(record) } })
    const seller = await parcelSeller(world, { carrier: 'EPOST', sender: SENDER })
    await sell(world, seller, [
      ['UC_1', '@대박다육🌵', 1],
      ['UC_2', '홍길순', 1],
    ])
    await makeReady(world, seller, 'UC_1')
    await makeReady(world, seller, 'UC_2', { ...ADDRESS, name: '홍길순' })
    const extra = await client(world, seller.cookie).put(`/api/parcels/days/${D}/extra`, { requestId: rid('pe'), address: { ...ADDRESS, name: '나래' }, qty: 1 })
    expect(extra.status, extra.text).toBe(200)

    // 꺼짐 (기본): 지금처럼 이름만
    expect(((await expect200(fillOf(world, seller.cookie, 'UC_1'))).body.fill as { receiver: { name: string } }).receiver.name).toBe('홍길동')

    await expect200(parcelApi(world, seller.cookie).putSettings({ nickInName: true }))
    expect(((await expect200(fillOf(world, seller.cookie, 'UC_1'))).body.fill as { receiver: { name: string } }).receiver.name).toBe('홍길동(대박다육)')
    // 닉네임이 이름과 같으면 이름만
    expect(((await expect200(fillOf(world, seller.cookie, 'UC_2'))).body.fill as { receiver: { name: string } }).receiver.name).toBe('홍길순')
    const kit = (await expect200(kitOf(world, seller.cookie))).body.kit as { receivers: { name: string }[] }
    expect(kit.receivers.map((row) => row.name)).toEqual(['홍길동(대박다육)', '홍길순', '나래'])

    const file = await client(world, seller.cookie).raw(`/api/parcels/days/${D}/epost-addresses.xlsx`, {})
    expect(file.status).toBe(200)
    const xlsx = await import('exceljs')
    const book = new xlsx.default.Workbook()
    await book.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer)
    const names = [2, 3, 4].map((n) => book.worksheets[0]?.getRow(n).getCell(1).value)
    expect(names).toEqual(['홍길동(대박다육)', '홍길순', '나래'])

    // 저장한 배송지·택배 화면 이름은 그대로
    const { bundle } = (await expect200(parcelApi(world, seller.cookie).bundle('UC_1'))).body as { bundle: { address: { name: string }; row: { name: string } } }
    expect([bundle.address.name, bundle.row.name]).toEqual(['홍길동', '대박다육🌵'])

    await expect200(parcelApi(world, seller.cookie).putSettings({ nickInName: false }))
    expect(((await expect200(fillOf(world, seller.cookie, 'UC_1'))).body.fill as { receiver: { name: string } }).receiver.name).toBe('홍길동')
    expect(((await expect200(kitOf(world, seller.cookie))).body.kit as { receivers: { name: string }[] }).receivers.map((row) => row.name)).toEqual(['홍길동', '홍길순', '나래'])

    const logged = JSON.stringify(logs)
    expect(logged).not.toContain('홍길동')
    expect(logged).not.toContain('대박다육')
  })

  it('택배사 자동 접수에도 켜면 이름(닉네임)이 간다 — 끄면 이름만', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'FAKE', sender: SENDER, box: '80', nickInName: true })
    await sell(world, seller, [
      ['UC_1', '대박다육', 1],
      ['UC_2', '나나', 1],
    ])
    await makeReady(world, seller, 'UC_1')
    await makeReady(world, seller, 'UC_2', { ...ADDRESS, name: '김철수' })
    expect(await bookOk(world, seller, [{ buyer: 'UC_1' }])).toMatchObject([{ buyer: 'UC_1', ok: true }])
    expect(world.carrier.requests.at(-1)).toMatchObject({ op: 'book', body: { receiver: { name: '홍길동(대박다육)' } } })
    await expect200(parcelApi(world, seller.cookie).putSettings({ nickInName: false }))
    expect(await bookOk(world, seller, [{ buyer: 'UC_2' }])).toMatchObject([{ buyer: 'UC_2', ok: true }])
    expect(world.carrier.requests.at(-1)).toMatchObject({ op: 'book', body: { receiver: { name: '김철수' } } })
  })
})
