// D-REAL-04 우체국 계약소포 어댑터: 접수 전 같은 주문번호 확인(두 번 접수 막기)·계약 승인번호/공급지 코드 묻기·오류 코드 나누기·취소(집하 전만)·
// 판매자 설정(인증키·보안키 암호화, 우체국에 맞는지 물어 본 뒤 저장, 화면·DB에 원문 없음)·계약 정보 없으면 자동 접수 막기.
import { describe, expect, it } from 'vitest'
import type { CarrierAccount } from '../src/parcel/carrier.ts'
import { EPOST_CONTENT_CODE, epostCarrier, epostPlain, epostTrackUrl, kstYmd, readEpostXml } from '../src/parcel/epost.ts'
import { PARCEL_MESSAGES } from '../src/parcel/rules.ts'
import { epostEncrypt } from '../src/parcel/seed.ts'
import { dumpAllTables } from './support.ts'
import { ADDRESS, SENDER, bookOk, dayRows, expect200, makeReady, parcelApi, parcelSeller, parcelWorld, sell } from './t1-support.ts'

const ACCOUNT: CarrierAccount = { key: 'live-key-abc', secret: 'secret-0123456789ab', customerNo: '0011223344' }
const xml = (body: string) => `<?xml version='1.0' encoding="utf-8"?>\n<xsync>${body}</xsync>`
const cdata = (name: string, value: string) => `<${name}>\n<![CDATA[${value}]]>\n</${name}>`
const error = (code: string) => xml(`<error>${cdata('error_code', code)}${cdata('message', '서울 중구 세종대로 110 수취인 오류')}</error>`)

type Reply = string | null
/** 우체국 흉내: API 이름마다 차례로 줄 답(없으면 기본 답). null은 연결 실패 */
class FakeEpost {
  readonly calls: { name: string; key: string; regData: string; url: string }[] = []
  readonly queue = new Map<string, Reply[]>()
  regiNo = '6013082362377'
  readonly fetch: typeof fetch = async (input) => {
    const url = new URL(String(input))
    const name = /^\/api\.(\w+)\.jparcel$/.exec(url.pathname)?.[1] ?? ''
    this.calls.push({ name, key: url.searchParams.get('key') ?? '', regData: url.searchParams.get('regData') ?? '', url: String(input) })
    const queued = this.queue.get(name)
    const reply = queued !== undefined && queued.length > 0 ? (queued.shift() as Reply) : this.#default(name)
    if (reply === null) throw new TypeError('fetch failed')
    return new Response(reply, { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }
  #default(name: string): string {
    if (name === 'GetResInfo') return error('ERR-225')
    if (name === 'GetApprNo') return xml(`<contractInfo>${cdata('apprNo', '1018680001')}${cdata('statusNm', '승인')}</contractInfo>`)
    if (name === 'GetOfficeInfo') return xml(`<officeInfo>${cdata('officeSer', '06')}${cdata('officeDivCd', '1')}</officeInfo>`)
    if (name === 'InsertOrder') return xml(`${cdata('reqNo', '202005116403648050')}${cdata('resNo', '2020051152119574')}${cdata('regiNo', this.regiNo)}${cdata('price', '3300')}`)
    if (name === 'GetResCancelCmd') return xml(`${cdata('canceledYn', 'Y')}${cdata('regiNo', '6013082362389')}`)
    return error('ERR-111')
  }
  push(name: string, ...replies: Reply[]): void {
    this.queue.set(name, [...(this.queue.get(name) ?? []), ...replies])
  }
  names(): string[] {
    return this.calls.map((call) => call.name)
  }
}

const resInfo = (regiNo: string, status: string) => xml(`<resInfo>${cdata('reqNo', '202005116403648050')}${cdata('resNo', '2020051152119574')}${cdata('regiNo', regiNo)}${cdata('treatStusCd', status)}</resInfo>`)

// 2026-10-19 10:00 KST
const NOW = Date.parse('2026-10-19T01:00:00Z')
const receiver = { name: '홍길동', phone: '01012345678', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', zip: '04524', memo: '문 앞에' }
const sender = { name: '다육이네', phone: '0311234567', address: '경기도 수원시 팔달구 효원로 1', detail: '1층', zip: '16490' }
const request = (requestKey = 'lj-abc') => ({ requestKey, customerNo: ACCOUNT.customerNo, receiver, sender, box: '80' as const, count: 3, account: ACCOUNT })

describe('D-REAL-04 우체국 어댑터', () => {
  it('처음 접수: 오늘·어제 같은 주문번호가 없는지 묻고, 계약 승인번호·공급지를 물어 소포신청. 평문 칸과 암호문이 맞고, 두 번째부터는 계약을 다시 묻지 않는다', async () => {
    const epost = new FakeEpost()
    const adapter = epostCarrier({ fetch: epost.fetch, now: () => NOW })
    expect(adapter.needsAccount).toBe(true)
    expect(await adapter.book(request())).toEqual({ kind: 'BOOKED', invoice: '6013082362377' })
    expect(epost.names()).toEqual(['GetResInfo', 'GetResInfo', 'GetApprNo', 'GetOfficeInfo', 'InsertOrder'])
    expect(epost.calls.every((call) => call.url.startsWith('https://ship.epost.go.kr/api.') && call.key === ACCOUNT.key)).toBe(true)
    // 오늘·어제(KST) 날짜로 묻는다
    expect(epost.calls[0]?.regData).toBe(epostEncrypt(ACCOUNT.secret, 'custNo=0011223344&reqType=1&orderNo=lj-abc&reqYmd=20261019'))
    expect(epost.calls[1]?.regData).toBe(epostEncrypt(ACCOUNT.secret, 'custNo=0011223344&reqType=1&orderNo=lj-abc&reqYmd=20261018'))
    const plain = [
      'custNo=0011223344',
      'apprNo=1018680001',
      'payType=1',
      'reqType=1',
      'officeSer=06',
      'volume=80',
      'microYn=N',
      'orderNo=lj-abc',
      'ordCompNm=다육이네',
      'ordNm=다육이네',
      'ordZip=16490',
      'ordAddr1=경기도 수원시 팔달구 효원로 1',
      'ordAddr2=1층',
      'ordTel=0311234567',
      'recNm=홍길동',
      'recZip=04524',
      'recAddr1=서울특별시 중구 세종대로 110',
      'recAddr2=101동 202호',
      'recMob=01012345678',
      `contCd=${EPOST_CONTENT_CODE}`,
      'goodsNm=물품 3개',
      'qty=3',
      'delivMsg=문 앞에',
      'printYn=N',
    ].join('&')
    expect(epost.calls[4]?.regData).toBe(epostEncrypt(ACCOUNT.secret, plain))
    // 품종·가격은 보내지 않는다 (PC-6)
    expect(plain).not.toMatch(/품종|가격|price/)
    epost.regiNo = '6013082362384'
    expect(await adapter.book(request('lj-def'))).toEqual({ kind: 'BOOKED', invoice: '6013082362384' })
    expect(epost.names().slice(5)).toEqual(['GetResInfo', 'GetResInfo', 'InsertOrder'])
    expect(adapter.trackUrl('6013082362377')).toBe(epostTrackUrl('6013082362377'))
  })

  it('두 번 접수 막기: 같은 주문번호가 이미 있으면 그 등기번호, 확인이 안 되면 넣지 않고 모름, 취소된 신청이면 거절', async () => {
    const epost = new FakeEpost()
    const adapter = epostCarrier({ fetch: epost.fetch, now: () => NOW })
    epost.push('GetResInfo', error('ERR-225'), resInfo('6013082362377', '01'))
    expect(await adapter.book(request())).toEqual({ kind: 'BOOKED', invoice: '6013082362377' })
    epost.push('GetResInfo', null)
    expect(await adapter.book(request())).toEqual({ kind: 'UNKNOWN' })
    epost.push('GetResInfo', resInfo('6013082362389', '05'))
    expect(await adapter.book(request())).toEqual({ kind: 'FAILED', reason: 'REJECTED' })
    // 등기번호 모양이 아니면(시험 신청 TESTREGINOAPI 등) 모름
    epost.push('GetResInfo', resInfo('TESTREGINOAPI', '01'))
    expect(await adapter.book(request())).toEqual({ kind: 'UNKNOWN' })
    expect(epost.names()).not.toContain('InsertOrder')
    // 인증키가 틀려 확인부터 거절되면 넣지 않고 거절
    epost.push('GetResInfo', error('ERR-123'))
    expect(await adapter.book(request())).toEqual({ kind: 'FAILED', reason: 'REJECTED' })
    expect(epost.names()).not.toContain('InsertOrder')
  })

  it('소포신청 결과: 수취인 오류(ERR-3xx)는 주소, 그 밖 오류는 거절, 답이 없으면 모름. 우편번호가 없으면 묻지 않고 주소', async () => {
    const epost = new FakeEpost()
    const adapter = epostCarrier({ fetch: epost.fetch, now: () => NOW })
    epost.push('InsertOrder', error('ERR-311'), error('ERR-123'), null, xml('<x/>'))
    expect(await adapter.book(request())).toEqual({ kind: 'FAILED', reason: 'ADDRESS' })
    expect(await adapter.book(request())).toEqual({ kind: 'FAILED', reason: 'REJECTED' })
    expect(await adapter.book(request())).toEqual({ kind: 'UNKNOWN' })
    expect(await adapter.book(request())).toEqual({ kind: 'UNKNOWN' })
    const before = epost.calls.length
    expect(await adapter.book({ ...request(), receiver: { ...receiver, zip: '' } })).toEqual({ kind: 'FAILED', reason: 'ADDRESS' })
    expect(epost.calls.length).toBe(before)
    // 계약 정보가 없으면 보내지 않는다
    expect(await adapter.book({ ...request(), account: null })).toEqual({ kind: 'FAILED', reason: 'REJECTED' })
    expect(epost.calls.length).toBe(before)
  })

  it('취소: 집하 전(소포신청·운송장출력)만 취소, 집하완료 뒤는 거절, 이미 취소면 취소됨, 모르면 모름', async () => {
    const epost = new FakeEpost()
    const adapter = epostCarrier({ fetch: epost.fetch, now: () => NOW })
    const context = { requestKey: 'lj-abc', bookedAt: new Date(NOW), account: ACCOUNT }
    epost.push('GetResInfo', resInfo('6013082362377', '01'))
    expect(await adapter.cancel('6013082362377', context)).toEqual({ kind: 'CANCELLED' })
    expect(epost.names()).toEqual(['GetResInfo', 'GetApprNo', 'GetOfficeInfo', 'GetResCancelCmd'])
    expect(epost.calls[3]?.regData).toBe(
      epostEncrypt(ACCOUNT.secret, 'custNo=0011223344&apprNo=1018680001&reqType=1&reqNo=202005116403648050&resNo=2020051152119574&regiNo=6013082362377&reqYmd=20261019&delYn=N'),
    )
    epost.push('GetResInfo', resInfo('6013082362377', '03'))
    expect(await adapter.cancel('6013082362377', context)).toEqual({ kind: 'REFUSED' })
    epost.push('GetResInfo', resInfo('6013082362389', '05'))
    expect(await adapter.cancel('6013082362377', context)).toEqual({ kind: 'CANCELLED' })
    epost.push('GetResInfo', resInfo('6013082362377', '02'))
    epost.push('GetResCancelCmd', xml(cdata('canceledYn', 'N')))
    expect(await adapter.cancel('6013082362377', context)).toEqual({ kind: 'REFUSED' })
    epost.push('GetResInfo', null)
    expect(await adapter.cancel('6013082362377', context)).toEqual({ kind: 'UNKNOWN' })
    expect(await adapter.cancel('6013082362377')).toEqual({ kind: 'UNKNOWN' })
  })

  it('계약 확인: 맞음·틀림·모름', async () => {
    const epost = new FakeEpost()
    const adapter = epostCarrier({ fetch: epost.fetch, now: () => NOW })
    expect(await adapter.verify?.(ACCOUNT)).toBe('OK')
    epost.push('GetApprNo', error('ERR-123'))
    expect(await adapter.verify?.(ACCOUNT)).toBe('REJECTED')
    epost.push('GetApprNo', null)
    expect(await adapter.verify?.(ACCOUNT)).toBe('UNKNOWN')
  })

  it('평문 다듬기·XML 읽기·KST 날짜', () => {
    expect(epostPlain([['a', 'x&y=z'], ['b', ''], ['c', null], ['d', 3], ['e', '줄\n바꿈']])).toBe('a=x＆y＝z&d=3&e=줄 바꿈')
    expect(readEpostXml('<html>점검 중</html>')).toBeNull()
    expect(readEpostXml(error('ERR-225'))).toEqual({ kind: 'error', code: 'ERR-225' })
    expect(kstYmd(Date.parse('2026-10-18T15:00:00Z'))).toBe('20261019')
    expect(kstYmd(Date.parse('2026-10-18T14:59:59Z'))).toBe('20261018')
  })
})

describe('D-REAL-04 우체국 설정·접수', () => {
  it('계약 정보가 없으면 자동 접수를 막고, 우체국이 맞다고 한 정보만 암호화해 저장하고(화면·DB에 원문 없음), 접수·취소가 판매자 계약으로 간다', async () => {
    const epost = new FakeEpost()
    const world = await parcelWorld({ overrides: { parcel: { carriers: { EPOST: epostCarrier({ fetch: epost.fetch, now: () => Date.now() }) } } } })
    const seller = await parcelSeller(world, { carrier: 'EPOST', sender: SENDER, box: '80' })
    const api = parcelApi(world, seller.cookie)
    await sell(world, seller, [['UC_A', '가', 1]])
    await makeReady(world, seller, 'UC_A', ADDRESS)
    expect((await dayRows(world, seller)).blocked).toEqual({ code: 'NO_AUTO_BOOK', message: PARCEL_MESSAGES.noEpostAccount })
    expect(epost.calls).toHaveLength(0)

    // 우체국이 거절하면 저장하지 않는다
    epost.push('GetApprNo', error('ERR-123'))
    const rejected = await api.putSettings({ customerNo: ACCOUNT.customerNo, epostKey: ACCOUNT.key, epostSecret: ACCOUNT.secret })
    expect(rejected.status).toBe(400)
    expect((rejected.body.error as { message: string }).message).toBe(PARCEL_MESSAGES.epostRejected)
    // 연결이 안 되면 503, 저장하지 않는다
    epost.push('GetApprNo', null)
    expect((await api.putSettings({ customerNo: ACCOUNT.customerNo, epostKey: ACCOUNT.key, epostSecret: ACCOUNT.secret })).status).toBe(503)
    expect(((await expect200(api.settings())).body.settings as { epostReady: boolean }).epostReady).toBe(false)
    // 하나만 적으면 틀림
    expect((await api.putSettings({ epostKey: ACCOUNT.key })).status).toBe(400)

    const saved = await expect200(api.putSettings({ customerNo: ACCOUNT.customerNo, epostKey: ` ${ACCOUNT.key} `, epostSecret: ACCOUNT.secret }))
    expect(saved.body.settings).toMatchObject({ carrier: 'EPOST', epostReady: true, customerNoLast4: '3344' })
    expect(saved.text).not.toContain(ACCOUNT.key)
    expect(saved.text).not.toContain(ACCOUNT.secret)
    const dump = await dumpAllTables(world.database)
    expect(dump).not.toContain(ACCOUNT.key)
    expect(dump).not.toContain(ACCOUNT.secret)
    // 같은 정보로 다시 저장하면 우체국에 다시 묻지 않는다
    const asked = epost.calls.length
    await expect200(api.putSettings({ box: '100' }))
    expect(epost.calls.length).toBe(asked)
    expect((await dayRows(world, seller)).blocked).toBeNull()

    const results = await bookOk(world, seller, [{ buyer: 'UC_A' }])
    expect(results[0]).toMatchObject({ buyer: 'UC_A', ok: true, invoice: '6013082362377' })
    const insert = epost.calls.find((call) => call.name === 'InsertOrder')
    expect(insert?.key).toBe(ACCOUNT.key)
    const booked = (await dayRows(world, seller)).booked.find((row) => row.buyer === 'UC_A')
    expect(booked?.parcel).toMatchObject({ state: 'BOOKED', cancellable: true, trackUrl: epostTrackUrl('6013082362377') })

    epost.push('GetResInfo', resInfo('6013082362377', '01'))
    const cancelled = await expect200(api.cancel('UC_A'))
    expect(cancelled.status).toBe(200)
    expect(epost.names()).toContain('GetResCancelCmd')

    // 둘 다 빈 글이면 지우고 다시 막힌다
    expect(((await expect200(api.putSettings({ epostKey: '', epostSecret: '' }))).body.settings as { epostReady: boolean }).epostReady).toBe(false)
    expect((await dayRows(world, seller)).blocked?.message).toBe(PARCEL_MESSAGES.noEpostAccount)
  })
})
