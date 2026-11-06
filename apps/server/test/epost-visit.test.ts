// 우체국 방문접수 파일 (D-UX3-36): 계약 없는 판매자가 인터넷우체국 [파일(주소) 등록]에 올리는 엑셀.
// 공식 양식의 머리 두 줄은 그대로, 3행부터 "보낼 수 있어요" 묶음. 택배사에는 아무것도 보내지 않고 상태도 바꾸지 않는다.
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { client, type TestServer } from './support.ts'
import { ADDRESS, D, SENDER, attempts, dayRows, makeReady, parcelSeller, parcelWorld, sell } from './t1-support.ts'

const fileOf = async (world: TestServer, cookie: string, date = D, query = ''): Promise<Response> => client(world, cookie).raw(`/api/parcels/days/${date}/epost-visit.xlsx${query}`, {})

async function sheetOf(response: Response): Promise<ExcelJS.Worksheet> {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(new Uint8Array(await response.arrayBuffer()) as unknown as ArrayBuffer)
  return book.worksheets[0] as ExcelJS.Worksheet
}

const rowValues = (sheet: ExcelJS.Worksheet, n: number): unknown[] => Array.from({ length: 21 }, (_, i) => sheet.getRow(n).getCell(i + 1).value ?? null)

describe('우체국 방문접수 파일 (D-UX3-36)', () => {
  it('보낼 수 있는 묶음만 우체국 양식 3행부터 — 상자 기본값의 중량·크기, 내용품코드 [21], 보내는 분 칸은 비움', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'EPOST', sender: SENDER, box: '100' })
    await sell(world, seller, [
      ['UC_A', '가람', 2],
      ['UC_B', '나래', 1],
      ['UC_C', '다솜', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_B', { name: '김다육', phone: '01098765432', address: '경상남도 양산시 물금읍 증산리 1034', detail: '', zip: '', memo: '' })
    const before = await dayRows(world, seller)
    expect(before.ready.map((row) => row.buyer)).toEqual(['UC_A', 'UC_B'])

    const response = await fileOf(world, seller.cookie)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('spreadsheetml')
    expect(response.headers.get('x-epost-count')).toBe('2')
    expect(decodeURIComponent(response.headers.get('content-disposition') ?? '')).toContain(`우체국-방문접수-${D}.xlsx`)
    const sheet = await sheetOf(response)
    expect(sheet.name).toBe('방문접수소포 파일접수양식')
    expect(sheet.getCell('A2').value).toBe('받는 분 이름')
    expect(sheet.getCell('U2').value).toBe('보내는분 연락처')
    expect(rowValues(sheet, 3)).toEqual([
      ADDRESS.name, ADDRESS.zip, ADDRESS.address, ADDRESS.detail, '010-1234-5678',
      10, 100, 'N', null, null, null, null, '[21]농/수/축산물(일반)', '물품 2개', '미신청', ADDRESS.memo,
      null, null, null, null, null,
    ])
    // 우편번호가 없으면 빈 칸(우체국 [주소검증]이 찾는다), 상세 주소가 없으면 양식 안내대로 "."
    expect(rowValues(sheet, 4).slice(0, 8)).toEqual(['김다육', null, '경상남도 양산시 물금읍 증산리 1034', '.', '010-9876-5432', 10, 100, 'N'])
    expect(sheet.getRow(5).getCell(1).value ?? null).toBeNull()

    // 아무것도 바꾸지 않는다: 그대로 보낼 수 있어요, 시도 없음, 택배사 요청 없음
    expect((await dayRows(world, seller)).ready.map((row) => row.buyer)).toEqual(['UC_A', 'UC_B'])
    expect(await attempts(world, seller.sellerId, 'UC_A')).toEqual([])
    expect(world.carrier.requests).toEqual([])
  })

  it('보낼 묶음이 없으면 409와 쉬운 문장, 다른 판매자·리허설은 404', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'EPOST', sender: SENDER, box: '80' })
    await sell(world, seller, [['UC_A', '가람', 1]])
    const none = await fileOf(world, seller.cookie)
    expect(none.status).toBe(409)
    const body = (await none.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('NO_PARCELS')
    expect(body.error.message).toBe('우체국 파일에 넣을 묶음이 없어요. 입금·포장·배송지 확인이 끝난 묶음만 들어가요.')

    await makeReady(world, seller, 'UC_A')
    const other = await parcelSeller(world, { carrier: 'EPOST', sender: SENDER, box: '80' })
    expect((await fileOf(world, other.cookie)).status).toBe(404)
    expect((await fileOf(world, seller.cookie, D, '?rehearsal=true')).status).toBe(404)
    const sheet = await sheetOf(await fileOf(world, seller.cookie))
    // 80cm 상자 → 5kg·80cm
    expect(rowValues(sheet, 3).slice(5, 7)).toEqual([5, 80])
  })

  it('빈 우편번호는 서버 우편번호 찾기로 채운다 — 번지를 상세 주소에 따로 적었으면 이어 붙여 묻고, 못 찾으면 빈 칸 그대로', async () => {
    const asked: string[] = []
    const world = await parcelWorld({
      overrides: {
        parcel: {
          findZip: async (query: string) => {
            asked.push(query)
            return query === '경상남도 양산시 물금읍 증산리 1034' ? { kind: 'ZIP', zip: '50603' } : { kind: 'NONE' }
          },
        },
      },
    })
    const seller = await parcelSeller(world, { carrier: 'EPOST', sender: SENDER, box: '80' })
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
      ['UC_C', '다솜', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_B', { name: '김다육', phone: '01098765432', address: '경상남도 양산시 물금읍 증산리', detail: '1034', zip: '', memo: '' })
    await makeReady(world, seller, 'UC_C', { name: '이모름', phone: '01011112222', address: '어딘가 모르는 길', detail: '', zip: '', memo: '' })
    const sheet = await sheetOf(await fileOf(world, seller.cookie))
    expect(asked.sort()).toEqual(['경상남도 양산시 물금읍 증산리 1034', '어딘가 모르는 길'])
    expect([rowValues(sheet, 3)[1], rowValues(sheet, 4)[1], rowValues(sheet, 5)[1]]).toEqual([ADDRESS.zip, '50603', null])
  })
})
