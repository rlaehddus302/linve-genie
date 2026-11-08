// EP1 우체국 창구소포 간편사전접수 (PARCEL_RULES PC-9, D-EP1-01~D-EP1-10):
// 순수 규칙(접수번호 읽기·연락처 토막·상태 바꾸기·채울 값·파일 줄)과 API(채울 값·입력 완료·사전접수 완료·지우기·목록 무리·택배사 접수 막기·주소 파일·로그인 없음 401·다른 판매자 404).
import { describe, expect, it } from 'vitest'
import { EPOST_FILE_COLUMNS, epostFileRow, epostFill, epostTransition, phoneParts, phoneText, readEpostPassword, readReceiptNo } from '../src/parcel/epost-window.ts'
import { epostZipFinder } from '../src/parcel/epost-public.ts'
import { client, rid, type Seller, type TestServer } from './support.ts'
import { ADDRESS, D, SENDER, bookOk, dayRows, expect200, makeReady, parcelSeller, parcelWorld, sell } from './t1-support.ts'

const RECEIVER = { name: '홍길동', phone: '01012345678', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', zip: '04524', memo: '문 앞에' }
const SENDER_VALUE = { name: '다육이네', phone: '0311234567', address: '경기도 수원시 팔달구 효원로 1', detail: '1층', zip: '16490' }

describe('PC-9 순수 규칙', () => {
  it('접수번호: 공백·하이픈·전각을 다듬고 대문자로, 영숫자 6~30자이고 숫자가 있어야 한다', () => {
    expect(readReceiptNo('1234-5678-9012')).toBe('123456789012')
    expect(readReceiptNo(' １２３４ ５６７８ ')).toBe('12345678')
    expect(readReceiptNo('ab12cd34')).toBe('AB12CD34')
    expect(readReceiptNo('12345')).toBeNull()
    expect(readReceiptNo('ABCDEFGH')).toBeNull()
    expect(readReceiptNo('1'.repeat(31))).toBeNull()
    expect(readReceiptNo('1234#5678')).toBeNull()
    expect(readReceiptNo(12345678)).toBeNull()
    expect(readReceiptNo(null)).toBeNull()
  })

  it('비회원 신청 비밀번호: 숫자 4자리(전각 숫자도), 빈 글·null은 지우기, 그 밖은 invalid', () => {
    expect(readEpostPassword('4821')).toBe('4821')
    expect(readEpostPassword(' ４８２１ ')).toBe('4821')
    expect(readEpostPassword('')).toBeNull()
    expect(readEpostPassword(null)).toBeNull()
    expect(readEpostPassword('482')).toBe('invalid')
    expect(readEpostPassword('48211')).toBe('invalid')
    expect(readEpostPassword('48a1')).toBe('invalid')
    expect(readEpostPassword(4821)).toBe('invalid')
  })

  it('연락처 세 토막: 02는 앞 2자리, 그 밖은 앞 3자리, 뒤 4자리', () => {
    expect(phoneParts('01012345678')).toEqual(['010', '1234', '5678'])
    expect(phoneParts('0111234567')).toEqual(['011', '123', '4567'])
    expect(phoneParts('0212345678')).toEqual(['02', '1234', '5678'])
    expect(phoneParts('021234567')).toEqual(['02', '123', '4567'])
    expect(phoneParts('0311234567')).toEqual(['031', '123', '4567'])
    expect(phoneText('0311234567')).toBe('031-123-4567')
  })

  it('채울 값: 휴대전화·일반전화를 맞는 칸에, 내용품은 품종 없이 "식물", 물품 수·메모', () => {
    const fill = epostFill(RECEIVER, SENDER_VALUE, 3)
    expect(fill.receiver).toEqual({ name: '홍길동', zip: '04524', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', mobile: ['010', '1234', '5678'], phone: null })
    expect(fill.sender).toEqual({ name: '다육이네', zip: '16490', address: '경기도 수원시 팔달구 효원로 1', detail: '1층', mobile: null, phone: ['031', '123', '4567'] })
    expect(fill.item).toBe('식물')
    expect(fill.qty).toBe(3)
    expect(fill.memo).toBe('문 앞에')
  })

  it('파일 줄: 받는분/우편번호/기본주소/상세주소/휴대전화/일반전화', () => {
    expect(EPOST_FILE_COLUMNS).toEqual(['받는분', '우편번호', '기본주소', '상세주소', '휴대전화', '일반전화'])
    expect(epostFileRow(RECEIVER)).toEqual(['홍길동', '04524', '서울특별시 중구 세종대로 110', '101동 202호', '010-1234-5678', ''])
    expect(epostFileRow({ ...RECEIVER, phone: '0212345678', zip: '' })).toEqual(['홍길동', '', '서울특별시 중구 세종대로 110', '101동 202호', '', '02-1234-5678'])
  })

  it('상태 바꾸기: 입력 완료는 몇 번이든, 사전접수 완료 뒤 입력은 거절, 같은 번호는 그대로·다른 번호는 거절, 지우기는 언제나', () => {
    expect(epostTransition(null, 'FILLED')).toEqual({ next: { state: 'FILLED', receiptNo: null }, changed: true })
    expect(epostTransition({ state: 'FILLED', receiptNo: null }, 'FILLED')).toEqual({ next: { state: 'FILLED', receiptNo: null }, changed: true })
    expect(epostTransition({ state: 'FILLED', receiptNo: null }, 'RECEIVED', '1234-5678')).toEqual({ next: { state: 'RECEIVED', receiptNo: '12345678' }, changed: true })
    expect(epostTransition(null, 'RECEIVED', '12345678')).toEqual({ next: { state: 'RECEIVED', receiptNo: '12345678' }, changed: true })
    const received = { state: 'RECEIVED', receiptNo: '12345678' } as const
    expect(epostTransition(received, 'FILLED')).toEqual({ refused: 'ALREADY_RECEIVED' })
    expect(epostTransition(received, 'RECEIVED', '1234 5678')).toEqual({ next: received, changed: false })
    expect(epostTransition(received, 'RECEIVED', '87654321')).toEqual({ refused: 'OTHER_RECEIPT' })
    expect(epostTransition(null, 'RECEIVED', 'abc')).toEqual({ refused: 'RECEIPT_INVALID' })
    expect(epostTransition(received, 'CLEAR')).toEqual({ next: null, changed: true })
    expect(epostTransition(null, 'CLEAR')).toEqual({ next: null, changed: false })
  })
})

function epostApi(world: TestServer, cookie: string) {
  const api = client(world, cookie)
  return {
    fill: (buyer: string, date = D) => api.get(`/api/parcels/days/${date}/epost?buyer=${encodeURIComponent(buyer)}`),
    mark: (buyer: string, action: string, receiptNo?: string, date = D) => api.post(`/api/parcels/days/${date}/epost`, { requestId: rid('ep'), buyer, action, ...(receiptNo === undefined ? {} : { receiptNo }) }),
    file: (date = D) => api.raw(`/api/parcels/days/${date}/epost-addresses.xlsx`, {}),
  }
}

/** 우체국을 고른 판매자 (자동 접수 어댑터가 없어 목록 위가 막혀도 우체국 사전접수는 된다) */
async function epostSeller(world: TestServer): Promise<Seller> {
  return parcelSeller(world, { carrier: 'EPOST', sender: SENDER })
}

describe('PC-9 API', () => {
  it('채울 값은 고를 수 있는 묶음만, 우체국 화면 주소·호스트·칸 힌트를 함께 준다', async () => {
    const world = await parcelWorld()
    const seller = await epostSeller(world)
    await sell(world, seller, [
      ['UC_1', '가가', 2],
      ['UC_2', '나나', 1],
    ])
    await makeReady(world, seller, 'UC_1')
    const api = epostApi(world, seller.cookie)
    const response = await expect200(api.fill('UC_1'))
    expect(response.body.fill).toEqual({
      receiver: { name: ADDRESS.name, zip: ADDRESS.zip, address: ADDRESS.address, detail: ADDRESS.detail, mobile: ['010', '1234', '5678'], phone: null },
      sender: { name: SENDER.name, zip: SENDER.zip, address: SENDER.address, detail: SENDER.detail, mobile: null, phone: ['031', '123', '4567'] },
      item: '식물',
      qty: 2,
      memo: ADDRESS.memo,
    })
    expect((response.body.pages as { apply: string }).apply).toMatch(/^https:\/\/m\.epost\.go\.kr\//) // D-EP1-18 모바일 입구
    expect((response.body.pages as { apply: string }).apply).toContain('ctype=c2') // 소포 (빠지면 등기통상)
    expect(response.body.hosts).toContain('service.epost.go.kr')
    expect((response.body.form as { receiptWords: string[] }).receiptWords).toContain('접수번호')
    // 입금 전 묶음은 409 + 이유 문장, 모르는 구매자는 404
    const notReady = await api.fill('UC_2')
    expect(notReady.status).toBe(409)
    expect((notReady.body.error as { message: string }).message).toBe('입금 완료 전이에요')
    expect((await api.fill('UC_X')).status).toBe(404)
  })

  it('입력 완료 → 사전접수 완료(접수번호) → 목록의 우체국 무리로 옮기고, 다시 채우기·택배사 접수를 막는다. 지우면 돌아온다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world) // 가짜 택배사 — 우체국 사전접수한 묶음을 택배사에 다시 보내지 않는지 본다
    await sell(world, seller, [
      ['UC_1', '가가', 1],
      ['UC_2', '나나', 1],
    ])
    await makeReady(world, seller, 'UC_1')
    await makeReady(world, seller, 'UC_2')
    const api = epostApi(world, seller.cookie)

    const filled = await expect200(api.mark('UC_1', 'FILLED'))
    expect((filled.body.row as { epost: { state: string; word: string; receiptNo: string | null } }).epost).toMatchObject({ state: 'FILLED', word: '우체국 입력 완료', receiptNo: null })
    // 입력 완료는 아직 고를 수 있다 (신청했는지 모른다)
    expect((await dayRows(world, seller)).ready.map((row) => row.buyer)).toEqual(['UC_1', 'UC_2'])

    const invalid = await api.mark('UC_1', 'RECEIVED', '12-34')
    expect(invalid.status).toBe(400)
    expect(JSON.stringify(invalid.body)).toContain('접수번호는')
    const received = await expect200(api.mark('UC_1', 'RECEIVED', '1234-5678-9012'))
    expect((received.body.row as { epost: { state: string; receiptNo: string } }).epost).toMatchObject({ state: 'RECEIVED', word: '우체국 사전접수 완료', receiptNo: '123456789012' })
    // 같은 번호는 그대로, 다른 번호·다시 입력은 409
    await expect200(api.mark('UC_1', 'RECEIVED', '123456789012'))
    expect((await api.mark('UC_1', 'RECEIVED', '999999999999')).status).toBe(409)
    expect((await api.mark('UC_1', 'FILLED')).status).toBe(409)
    expect((await api.fill('UC_1')).status).toBe(409)

    const rows = await dayRows(world, seller)
    expect(rows.ready.map((row) => row.buyer)).toEqual(['UC_2'])
    expect((rows.body.epost as { buyer: string }[]).map((row) => row.buyer)).toEqual(['UC_1'])
    // 택배사 접수: 우체국에 사전접수한 묶음은 보내지 않는다
    const results = await bookOk(world, seller, [{ buyer: 'UC_1' }, { buyer: 'UC_2' }])
    expect(results.map((result) => [result.buyer, result.ok, result.reason ?? null])).toEqual([
      ['UC_1', false, 'EPOST'],
      ['UC_2', true, null],
    ])
    expect(world.carrier.bookingCount).toBe(1)

    // 지우기 → 다시 고를 수 있음
    const cleared = await expect200(api.mark('UC_1', 'CLEAR'))
    expect((cleared.body.row as { epost: unknown }).epost).toBeNull()
    expect((await dayRows(world, seller)).ready.map((row) => row.buyer)).toEqual(['UC_1'])
    await expect200(api.mark('UC_1', 'CLEAR'))
  })

  it('입력 전에는 고를 수 있는 묶음만 사전접수 완료로 적고, 받지 않는 칸·할 일은 400', async () => {
    const world = await parcelWorld()
    const seller = await epostSeller(world)
    await sell(world, seller, [['UC_1', '가가', 1]])
    const api = epostApi(world, seller.cookie)
    expect((await api.mark('UC_1', 'RECEIVED', '12345678')).status).toBe(409)
    expect((await api.mark('UC_1', 'SEND')).status).toBe(400)
    expect((await api.mark('UC_1', 'FILLED', '12345678')).status).toBe(400)
    const extra = await client(world, seller.cookie).post(`/api/parcels/days/${D}/epost`, { requestId: rid('ep'), buyer: 'UC_1', action: 'CLEAR', address: 'x' })
    expect(extra.status).toBe(400)
  })

  it('주소 파일: 고를 수 있는 묶음만 우체국 열 순서로, 연락처·우편번호는 글 칸. 사전접수한 묶음은 빠지고, 없으면 409', async () => {
    const world = await parcelWorld()
    const seller = await epostSeller(world)
    await sell(world, seller, [
      ['UC_1', '가가', 1],
      ['UC_2', '나나', 1],
      ['UC_3', '다다', 1],
    ])
    await makeReady(world, seller, 'UC_1')
    await makeReady(world, seller, 'UC_2', { ...ADDRESS, name: '김철수', phone: '02-123-4567', zip: '01234' })
    const api = epostApi(world, seller.cookie)
    const response = await api.file()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(response.headers.get('X-Epost-Count')).toBe('2')
    const xlsx = await import('exceljs')
    const book = new xlsx.default.Workbook()
    await book.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ArrayBuffer)
    const sheet = book.worksheets[0]
    const values = (n: number) => (sheet?.getRow(n).values as unknown[]).slice(1)
    expect(values(1)).toEqual(['받는분', '우편번호', '기본주소', '상세주소', '휴대전화', '일반전화'])
    expect(values(2)).toEqual([ADDRESS.name, ADDRESS.zip, ADDRESS.address, ADDRESS.detail, '010-1234-5678'])
    expect(values(3)).toEqual(['김철수', '01234', ADDRESS.address, ADDRESS.detail, undefined, '02-123-4567'])
    expect(sheet?.getRow(3).getCell(2).value).toBe('01234')

    await expect200(api.mark('UC_1', 'RECEIVED', '12345678'))
    await expect200(api.mark('UC_2', 'RECEIVED', '87654321'))
    const none = await api.file()
    expect(none.status).toBe(409)
  })

  it('비회원 신청 비밀번호: 설정에 저장(암호문)·판매자에게만 보이고, 채울 값에 실린다. 틀리면 400, 빈 글이면 지운다. 로그·DB 원문에 없다', async () => {
    const logs: unknown[] = []
    const world = await parcelWorld({ overrides: { log: (record) => logs.push(record) } })
    const seller = await epostSeller(world)
    await sell(world, seller, [['UC_1', '가가', 1]])
    await makeReady(world, seller, 'UC_1')
    const api = client(world, seller.cookie)
    expect(((await expect200(api.get('/api/parcels/settings'))).body.settings as { epostPassword: unknown }).epostPassword).toBeNull()
    const bad = await api.put('/api/parcels/settings', { epostPassword: '12a4' })
    expect(bad.status).toBe(400)
    expect(JSON.stringify(bad.body)).toContain('숫자 4자리')
    const saved = await expect200(api.put('/api/parcels/settings', { epostPassword: '4821' }))
    expect((saved.body.settings as { epostPassword: string }).epostPassword).toBe('4821')
    // 다른 설정만 바꿔도 그대로
    await expect200(api.put('/api/parcels/settings', { box: '100' }))
    expect(((await expect200(api.get('/api/parcels/settings'))).body.settings as { epostPassword: string }).epostPassword).toBe('4821')
    expect((await expect200(epostApi(world, seller.cookie).fill('UC_1'))).body.password).toBe('4821')
    const rows = await world.database.pglite?.query<{ epost_pw_enc: string }>('select epost_pw_enc from parcel_settings where seller_id = $1', [seller.sellerId])
    expect(rows?.rows[0]?.epost_pw_enc).toMatch(/^v1\./)
    expect(rows?.rows[0]?.epost_pw_enc).not.toContain('4821')
    expect(JSON.stringify(logs)).not.toContain('4821')
    await expect200(api.put('/api/parcels/settings', { epostPassword: '' }))
    expect(((await expect200(api.get('/api/parcels/settings'))).body.settings as { epostPassword: unknown }).epostPassword).toBeNull()
    expect((await expect200(epostApi(world, seller.cookie).fill('UC_1'))).body.password).toBeNull()
  })

  it('받는 분 우편번호가 비면 서버 우편번호 찾기로 채운다 — 외진 곳 범위 "증산리 985~1141"의 1034는 50603, 못 찾으면 빈 칸 그대로 (D-EP1-22)', async () => {
    // 2026-11-05 운영 서버에서 "증산리 1034"로 받은 실제 답(real-epost-public 시험과 같음)의 앞 두 줄
    const xml = '<?xml version="1.0" encoding="utf-8"?><NewZipCdListResponse><cmmMsgHeader><successYN>Y</successYN><returnCode>00</returnCode><errMsg></errMsg></cmmMsgHeader>' +
      '<newZipCdList><zipNo>50603</zipNo><address>경상남도 양산시 물금읍 증산리 985~1141</address><rangeKind>전체</rangeKind></newZipCdList>' +
      '<newZipCdList><zipNo>50363</zipNo><address>경상남도 창녕군 길곡면 증산리 16~1315-7</address><rangeKind>전체</rangeKind></newZipCdList></NewZipCdListResponse>'
    const asked: string[] = []
    const findZip = epostZipFinder({ serviceKey: 'k', fetch: async (input) => (asked.push(new URL(String(input)).searchParams.get('srchwrd') ?? ''), new Response(xml, { status: 200 })) })
    const world = await parcelWorld({ overrides: { parcel: { findZip } } })
    const seller = await epostSeller(world)
    await sell(world, seller, [['UC_1', '가가', 1], ['UC_2', '나나', 1]])
    await makeReady(world, seller, 'UC_1', { ...ADDRESS, address: '경상남도 양산시 물금읍 증산리 1034', detail: '시험 1호', zip: '' })
    await makeReady(world, seller, 'UC_2', { ...ADDRESS, address: '경상남도 양산시 물금읍 증산리 2000', detail: '', zip: '' })
    const api = epostApi(world, seller.cookie)
    const found = await api.fill('UC_1')
    expect(found.status, found.text).toBe(200)
    expect((found.body.fill as { receiver: { zip: string; address: string } }).receiver).toMatchObject({ zip: '50603', address: '경상남도 양산시 물금읍 증산리 1034' })
    expect(asked.some((word) => word.includes('증산리 1034'))).toBe(true)
    // 범위 밖 번지는 하나로 모이지 않아 빈 칸 — 앱이 우체국 [주소찾기]로 넣으라고 알린다
    const outside = await api.fill('UC_2')
    expect(outside.status, outside.text).toBe(200)
    expect((outside.body.fill as { receiver: { zip: string } }).receiver.zip).toBe('')
    // 우편번호가 있으면 묻지 않는다
    const before = asked.length
    await sell(world, seller, [['UC_3', '다다', 1]])
    await makeReady(world, seller, 'UC_3')
    expect(((await api.fill('UC_3')).body.fill as { receiver: { zip: string } }).receiver.zip).toBe('04524')
    expect(asked.length).toBe(before)
  })

  // main 합치기(D-EP1-21): 보조자 기능이 없어져(D-UX3-32) 보조자 403 대신 — 로그인 없이는 401, 다른 판매자에게는 묶음이 있는지도 드러내지 않는다(404)
  it('로그인하지 않으면 우체국 경로를 모두 401, 다른 판매자는 그 묶음을 404로 받는다 (받는 분 원문이 든다)', async () => {
    const world = await parcelWorld()
    const seller = await epostSeller(world)
    await sell(world, seller, [['UC_1', '가가', 1]])
    await makeReady(world, seller, 'UC_1')
    const nobody = epostApi(world, '')
    expect((await nobody.fill('UC_1')).status).toBe(401)
    expect((await nobody.mark('UC_1', 'FILLED')).status).toBe(401)
    expect((await nobody.file()).status).toBe(401)
    const other = epostApi(world, (await epostSeller(world)).cookie)
    expect((await other.fill('UC_1')).status).toBe(404)
    expect((await other.mark('UC_1', 'FILLED')).status).toBe(404)
    expect((await epostApi(world, seller.cookie).fill('UC_1')).status).toBe(200)
  })
})
