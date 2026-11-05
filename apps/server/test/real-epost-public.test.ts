// D-REAL-08 우체국 공개 OpenAPI(공공데이터포털): 배송 조회(종적 → 조회 상태)·우편번호 찾기(하나로 모일 때만)·키 문제는 전체 실패·
// 우체국 어댑터가 우편번호 없는 주소를 찾아 접수하고, 찾기를 묻지 못하면 넣지 않고 모름.
import { describe, expect, it } from 'vitest'
import type { CarrierAccount } from '../src/parcel/carrier.ts'
import { epostCarrier } from '../src/parcel/epost.ts'
import { epostTracker, epostZipFinder, readDataGoKrKey, readPublicHeader, traceCode, traceWord } from '../src/parcel/epost-public.ts'

const head = (yn: string, code: string) => `<cmmMsgHeader><requestMsgId></requestMsgId><responseMsgId></responseMsgId><responseTime>20261105:221121756</responseTime><successYN>${yn}</successYN><returnCode>${code}</returnCode><errMsg>메시지</errMsg></cmmMsgHeader>`
const trace = (rows: readonly string[], dlvy = '') =>
  `<?xml version="1.0" encoding="utf-8" standalone="yes"?><LongitudinalDomesticListResponse>${head('Y', '00')}<addrseNm>홍*동</addrseNm><applcntNm>다*이</applcntNm><dlvySttus>${dlvy}</dlvySttus><pstmtrKnd>소포</pstmtrKnd><rgist>6013082362377</rgist>${rows
    .map((word) => `<longitudinalDomesticList><dlvyDate>2026.11.05</dlvyDate><dlvyTime>10:00</dlvyTime><nowLc>수원우체국</nowLc><processSttus>${word}</processSttus><detailDc></detailDc></longitudinalDomesticList>`)
    .join('')}</LongitudinalDomesticListResponse>`
const failed = (code: string) => `<?xml version="1.0" encoding="utf-8" standalone="yes"?><LongitudinalDomesticListResponse>${head('N', code)}</LongitudinalDomesticListResponse>`
const gateway = (reason: string) => `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>X</returnAuthMsg><returnReasonCode>${reason}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`
const zipRows = (rows: readonly (readonly [string, string, string])[]) =>
  `<?xml version="1.0" encoding="utf-8" standalone="yes"?><NewAddressListResponse>${head('Y', '00')}${rows
    .map(([zip, road, lot]) => `<newAddressListAreaCd><zipNo>${zip}</zipNo><lnmAdres>${lot}</lnmAdres><rnAdres>${road}</rnAdres></newAddressListAreaCd>`)
    .join('')}<totalCount>${String(rows.length)}</totalCount></NewAddressListResponse>`

/** 공개 API 흉내: 경로·물음마다 답을 정한다. null은 연결 실패 */
function fakePublic(answer: (path: string, params: URLSearchParams) => string | null) {
  const calls: URL[] = []
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    calls.push(url)
    const reply = answer(url.pathname, url.searchParams)
    if (reply === null) throw new TypeError('fetch failed')
    return new Response(reply, { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }
  return { calls, fetch }
}

describe('D-REAL-08 우체국 배송 조회', () => {
  it('처리현황 낱말 → 조회 상태: 접수·집하는 집하, 발송·도착·배달준비·미배달은 배송 중, 배달완료는 도착, 모르는 낱말은 없음', () => {
    expect(traceWord('접수')).toBe('PICKED_UP')
    expect(traceWord('집하완료')).toBe('PICKED_UP')
    expect(traceWord('발송')).toBe('IN_TRANSIT')
    expect(traceWord('도착')).toBe('IN_TRANSIT')
    expect(traceWord('배달준비')).toBe('IN_TRANSIT')
    expect(traceWord('미배달')).toBe('IN_TRANSIT')
    expect(traceWord('배달완료')).toBe('DELIVERED')
    expect(traceWord('')).toBeNull()
    expect(traceWord('기타')).toBeNull()
    // 가장 먼 상태 (차례가 섞여 와도)
    expect(traceCode(trace(['배달준비', '접수', '발송']))).toBe('IN_TRANSIT')
    expect(traceCode(trace(['접수', '발송'], '배달완료'))).toBe('DELIVERED')
    expect(traceCode(trace([]))).toBeNull()
  })

  it('머리 읽기: 성공·키 문제(30 등록 안 된 키, 포털 22 한도)·그 밖', () => {
    expect(readPublicHeader(trace(['접수']))).toBe('OK')
    expect(readPublicHeader(failed('30'))).toBe('AUTH')
    expect(readPublicHeader(failed('01'))).toBe('OTHER')
    expect(readPublicHeader(gateway('22'))).toBe('AUTH')
    expect(readPublicHeader(gateway('12'))).toBe('OTHER')
  })

  it('등기번호마다 묻고 종적이 있는 것만 담는다. 종적 없음·오류 답인 건은 빼고, 송장 모양이 아니면 묻지 않는다. 키는 serviceKey로 인코딩해 보낸다', async () => {
    const fake = fakePublic((_path, params) => {
      const rgist = params.get('rgist')
      if (rgist === '6013082362377') return trace(['접수', '발송'])
      if (rgist === '6013082362378') return trace(['접수', '발송', '배달준비'], '배달완료')
      if (rgist === '6013082362379') return trace([])
      return failed('01')
    })
    const track = epostTracker({ serviceKey: 'ab+c/d==', fetch: fake.fetch })
    const answer = await track(['6013082362377', '6013082362378', '6013082362379', '6013082362380', 'abc'])
    expect(answer).toEqual({
      ok: true,
      items: new Map([
        ['6013082362377', 'IN_TRANSIT'],
        ['6013082362378', 'DELIVERED'],
      ]),
    })
    expect(fake.calls).toHaveLength(4)
    expect(fake.calls[0]?.origin).toBe('http://openapi.epost.go.kr')
    expect(fake.calls[0]?.pathname).toBe('/trace/retrieveLongitudinalService/retrieveLongitudinalService/getLongitudinalDomesticList')
    expect(fake.calls[0]?.searchParams.get('serviceKey')).toBe('ab+c/d==')
    expect(String(fake.calls[0])).toContain('serviceKey=ab%2Bc%2Fd%3D%3D')
  })

  it('키 문제면 더 묻지 않고 실패, 하나도 못 물었으면 실패, 일부만 연결 실패면 나머지로 성공', async () => {
    const auth = fakePublic(() => failed('30'))
    expect(await epostTracker({ serviceKey: 'k', fetch: auth.fetch })(Array.from({ length: 10 }, (_, i) => `60130823623${String(i).padStart(2, '0')}`))).toEqual({ ok: false, status: 401 })
    expect(auth.calls.length).toBeLessThanOrEqual(4)
    const down = fakePublic(() => null)
    expect(await epostTracker({ serviceKey: 'k', fetch: down.fetch })(['6013082362377'])).toEqual({ ok: false, status: null })
    const half = fakePublic((_path, params) => (params.get('rgist') === '6013082362377' ? null : trace(['접수'])))
    expect(await epostTracker({ serviceKey: 'k', fetch: half.fetch })(['6013082362377', '6013082362378'])).toEqual({ ok: true, items: new Map([['6013082362378', 'PICKED_UP']]) })
  })

  it('공공데이터포털 키: 비면 없음, Encoding 값은 풀어서 둔다', () => {
    expect(readDataGoKrKey({})).toBeNull()
    expect(readDataGoKrKey({ LIVEJJIM_DATA_GO_KR_KEY: '  ' })).toBeNull()
    expect(readDataGoKrKey({ LIVEJJIM_DATA_GO_KR_KEY: 'ab+c/d==' })).toBe('ab+c/d==')
    expect(readDataGoKrKey({ LIVEJJIM_DATA_GO_KR_KEY: 'ab%2Bc%2Fd%3D%3D' })).toBe('ab+c/d==')
  })
})

describe('D-REAL-08 우편번호 찾기', () => {
  const rows = zipRows([
    ['04524', '서울특별시 중구 세종대로 110 (태평로1가)', '서울특별시 중구 태평로1가 31'],
    ['04525', '서울특별시 중구 세종대로 1101 (가상동)', '서울특별시 중구 가상동 1'],
    ['47100', '부산광역시 부산진구 세종대로 110 (가상동)', '부산광역시 부산진구 가상동 2'],
    ['48900', '부산광역시 중구 세종대로 110 (가상동)', '부산광역시 중구 가상동 3'],
  ])

  it('도로명 + 건물번호로 묻고, 시·군·구가 맞고 번호가 꼭 맞는 줄의 우편번호가 하나면 그 번호', async () => {
    const fake = fakePublic(() => rows)
    const find = epostZipFinder({ serviceKey: 'k', fetch: fake.fetch })
    expect(await find('서울특별시 중구 세종대로 110 (태평로1가)')).toEqual({ kind: 'ZIP', zip: '04524' })
    // 광역 이름 줄임·같은 이름 구(부산 중구)는 광역으로 가른다
    expect(await find('서울 중구 세종대로 110')).toEqual({ kind: 'ZIP', zip: '04524' })
    expect(await find('부산 중구 세종대로110')).toEqual({ kind: 'ZIP', zip: '48900' })
    expect(fake.calls[0]?.pathname).toBe('/postal/retrieveNewAdressAreaCdService/retrieveNewAdressAreaCdService/getNewAddressListAreaCd')
    expect(fake.calls[0]?.searchParams.get('searchSe')).toBe('road')
    expect(fake.calls[0]?.searchParams.get('srchwrd')).toBe('세종대로 110')
  })

  it('시·군·구가 없어 여러 우편번호로 갈리면, 답이 없으면, 주소 모양이 아니면 못 찾음. 연결 실패·키 문제는 물어보지 못함', async () => {
    expect(await epostZipFinder({ serviceKey: 'k', fetch: fakePublic(() => rows).fetch })('세종대로 110')).toEqual({ kind: 'NONE' })
    expect(await epostZipFinder({ serviceKey: 'k', fetch: fakePublic(() => zipRows([])).fetch })('서울 중구 세종대로 110')).toEqual({ kind: 'NONE' })
    expect(await epostZipFinder({ serviceKey: 'k', fetch: fakePublic(() => rows).fetch })('그냥 아무 글')).toEqual({ kind: 'NONE' })
    expect(await epostZipFinder({ serviceKey: 'k', fetch: fakePublic(() => null).fetch })('서울 중구 세종대로 110')).toEqual({ kind: 'ERROR' })
    expect(await epostZipFinder({ serviceKey: 'k', fetch: fakePublic(() => failed('30')).fetch })('서울 중구 세종대로 110')).toEqual({ kind: 'ERROR' })
  })

  it('지번 주소는 동 + 번지로 묻는다', async () => {
    const fake = fakePublic(() => rows)
    expect(await epostZipFinder({ serviceKey: 'k', fetch: fake.fetch })('서울특별시 중구 태평로1가 31번지')).toEqual({ kind: 'ZIP', zip: '04524' })
    expect(fake.calls[0]?.searchParams.get('searchSe')).toBe('dong')
    expect(fake.calls[0]?.searchParams.get('srchwrd')).toBe('태평로1가 31')
  })
})

describe('D-REAL-08 우체국 어댑터와 함께', () => {
  const ACCOUNT: CarrierAccount = { key: 'live-key-abc', secret: 'secret-0123456789ab', customerNo: '0011223344' }
  const xml = (body: string) => `<?xml version='1.0' encoding="utf-8"?>\n<xsync>${body}</xsync>`
  const cdata = (name: string, value: string) => `<${name}><![CDATA[${value}]]></${name}>`
  const epostFetch = (sent: string[]): typeof fetch => async (input) => {
    const name = /^\/api\.(\w+)\.jparcel$/.exec(new URL(String(input)).pathname)?.[1] ?? ''
    sent.push(name)
    const body =
      name === 'GetResInfo'
        ? xml(`<error>${cdata('error_code', 'ERR-225')}</error>`)
        : name === 'GetApprNo'
          ? xml(`<contractInfo>${cdata('apprNo', '1018680001')}</contractInfo>`)
          : name === 'GetOfficeInfo'
            ? xml(`<officeInfo>${cdata('officeSer', '06')}</officeInfo>`)
            : xml(`${cdata('regiNo', '6013082362377')}`)
    return new Response(body, { status: 200 })
  }
  const request = (zip: string) => ({
    requestKey: 'lj-abc',
    customerNo: ACCOUNT.customerNo,
    receiver: { name: '홍길동', phone: '01012345678', address: '서울특별시 중구 세종대로 110', detail: '101동', zip, memo: '' },
    sender: { name: '다육이네', phone: '0311234567', address: '경기도 수원시 팔달구 효원로 1', detail: '', zip: '16490' },
    box: '80' as const,
    count: 1,
    account: ACCOUNT,
  })

  it('우편번호가 비면 찾아서 접수, 못 찾으면 주소, 묻지 못하면 우체국에 아무것도 넣지 않고 모름. 우편번호가 있으면 찾지 않는다', async () => {
    const sent: string[] = []
    const asked: string[] = []
    const found = epostCarrier({ fetch: epostFetch(sent), now: () => Date.parse('2026-11-05T01:00:00Z'), findZip: async (address) => (asked.push(address), { kind: 'ZIP', zip: '04524' }) })
    expect(await found.book(request(''))).toEqual({ kind: 'BOOKED', invoice: '6013082362377' })
    expect(asked).toEqual(['서울특별시 중구 세종대로 110'])
    expect(sent).toContain('InsertOrder')
    expect(await found.book(request('04524'))).toEqual({ kind: 'BOOKED', invoice: '6013082362377' })
    expect(asked).toHaveLength(1)

    const noneSent: string[] = []
    const none = epostCarrier({ fetch: epostFetch(noneSent), now: () => 0, findZip: async () => ({ kind: 'NONE' }) })
    expect(await none.book(request(''))).toEqual({ kind: 'FAILED', reason: 'ADDRESS' })
    const downSent: string[] = []
    const down = epostCarrier({ fetch: epostFetch(downSent), now: () => 0, findZip: async () => ({ kind: 'ERROR' }) })
    expect(await down.book(request(''))).toEqual({ kind: 'UNKNOWN' })
    const thrown = epostCarrier({ fetch: epostFetch(downSent), now: () => 0, findZip: async () => Promise.reject(new Error('x')) })
    expect(await thrown.book(request(''))).toEqual({ kind: 'UNKNOWN' })
    expect([...noneSent, ...downSent]).toEqual([])
  })

  it('조회는 옵션이 있을 때만 붙는다', () => {
    expect(epostCarrier({ now: () => 0 }).track).toBeUndefined()
    const track = async () => ({ ok: true as const, items: new Map() })
    expect(epostCarrier({ now: () => 0, track }).track).toBe(track)
  })
})
