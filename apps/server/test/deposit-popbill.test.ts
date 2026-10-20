// AC-N3-15·16: 팝빌 응답 한 줄 옮기기, 연동 키 읽기, 실제 팝빌 전송(가짜 fetch로 — 네트워크 없음)의 인증·오류 종류·값을 담지 않는 오류.
import { describe, expect, it } from 'vitest'
import { kstToMs } from '../src/deposit/calendar.ts'
import { SourceError, mapPopbillRow, popbillHttpTransport, readPopbillKeys } from '../src/deposit/popbill.ts'

describe('팝빌 응답 한 줄 → 입금 (AC-N3-15)', () => {
  it('tid = 외부 키, trdt(yyyyMMddHHmmss, KST, 초) = 거래 시각, accIn = 금액, remark1(비면 remark2) = 입금자명', () => {
    expect(mapPopbillRow({ tid: 'T1', trdt: '20261018210315', accIn: '14000', remark1: '  김영희 ', remark2: '무시', balance: '99' })).toEqual({
      key: 'T1',
      at: kstToMs(2026, 10, 18, 21, 3, 15),
      precision: 'second',
      amount: 14000,
      name: '김영희',
    })
    expect(mapPopbillRow({ tid: 'T2', trdt: '20261018210315', accIn: 500, remark1: ' ', remark2: ' 박민수 ' })).toMatchObject({ amount: 500, name: '박민수' })
    expect(mapPopbillRow({ tid: 'T3', trdt: '20261018210315', accIn: '1', remark1: 'ㄱ'.repeat(50) })).toMatchObject({ name: 'ㄱ'.repeat(40) })
    expect(mapPopbillRow({ tid: 'T4', trdt: '20261018210315', accIn: '1' })).toMatchObject({ name: '' })
  })

  it('입금액 0은 건너뛰고, 모양이 틀린 줄(시각·금액·키)은 읽지 못한 내역이다', () => {
    expect(mapPopbillRow({ tid: 'T', trdt: '20261018210315', accIn: '0' })).toBe('SKIP')
    for (const row of [
      { tid: 'T', trdt: '2026101821031', accIn: '1' },
      { tid: 'T', trdt: '20260230210315', accIn: '1' },
      { tid: 'T', trdt: '20261018250315', accIn: '1' },
      { tid: 'T', trdt: '20261018210315', accIn: '100000001' },
      { tid: 'T', trdt: '20261018210315', accIn: '-1' },
      { tid: 'T', trdt: '20261018210315', accIn: '1.5' },
      { tid: 'T', trdt: '20261018210315', accIn: 1.5 },
      { tid: '', trdt: '20261018210315', accIn: '1' },
      { tid: 'T T', trdt: '20261018210315', accIn: '1' },
      { trdt: '20261018210315', accIn: '1' },
      null,
      'row',
      [1],
    ]) {
      expect(mapPopbillRow(row), JSON.stringify(row)).toBe('MALFORMED')
    }
  })
})

describe('연동 키 (AC-N3-15·16)', () => {
  it('POPBILL_LINK_ID·POPBILL_SECRET_KEY가 둘 다 있어야 한다', () => {
    expect(readPopbillKeys({})).toBeNull()
    expect(readPopbillKeys({ POPBILL_LINK_ID: 'L' })).toBeNull()
    expect(readPopbillKeys({ POPBILL_SECRET_KEY: 'S' })).toBeNull()
    expect(readPopbillKeys({ POPBILL_LINK_ID: ' L ', POPBILL_SECRET_KEY: 'S' })).toEqual({ linkId: 'L', secretKey: 'S', testBed: false })
    expect(readPopbillKeys({ POPBILL_LINK_ID: 'L', POPBILL_SECRET_KEY: 'S', POPBILL_TEST_BED: 'true' })?.testBed).toBe(true)
  })
})

describe('실제 팝빌 전송 (가짜 fetch)', () => {
  const keys = { linkId: 'LINKID', secretKey: Buffer.from('secret-key').toString('base64'), testBed: true }

  it('링크허브 토큰(LINKHUB 서명) → Bearer로 EasyFinBank 호출, 응답을 그대로 옮긴다', async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = []
    const transport = popbillHttpTransport(keys, {
      now: () => Date.UTC(2026, 9, 19, 3),
      fetch: async (url, init) => {
        calls.push({ url, ...init })
        if (url.startsWith('https://auth.linkhub.co.kr/')) return { ok: true, status: 200, json: async () => ({ session_token: 'tok' }) }
        if (url.includes('/State')) return { ok: true, status: 200, json: async () => ({ jobState: 3, errorCode: 1 }) }
        if (url.includes('TradeType=I')) return { ok: true, status: 200, json: async () => ({ pageNum: 1, pageCount: 1, list: [{ tid: 'T' }] }) }
        if (url.includes('TG=BankAccount')) return { ok: true, status: 200, json: async () => ({ url: 'https://popbill.example/mgt' }) }
        return { ok: true, status: 200, json: async () => ({ jobID: 'J1' }) }
      },
    })
    expect(await transport.requestJob({ corpNum: '1234567890', bankCode: '0004', accountNumber: '110', sDate: '20261018', eDate: '20261019' })).toBe('J1')
    expect(await transport.getJobState({ corpNum: '1234567890', jobId: 'J1' })).toEqual({ jobState: 3, errorCode: 1 })
    expect(await transport.search({ corpNum: '1234567890', jobId: 'J1', tradeType: ['I'], page: 1, perPage: 1000 })).toEqual({ pageNum: 1, pageCount: 1, list: [{ tid: 'T' }] })
    expect(await transport.getBankAccountMgtURL({ corpNum: '1234567890' })).toBe('https://popbill.example/mgt')
    const token = calls[0]
    expect(token?.url).toBe('https://auth.linkhub.co.kr/POPBILL_TEST/Token')
    expect(token?.headers['x-lh-version']).toBe('2.0')
    expect(token?.headers.Authorization).toMatch(/^LINKHUB LINKID [A-Za-z0-9+/=]+$/)
    expect(calls[1]?.url).toBe('https://popbill-test.linkhub.co.kr/EasyFin/Bank/BankAccount?BankCode=0004&AccountNumber=110&SDate=20261018&EDate=20261019')
    expect(calls[1]?.headers.Authorization).toBe('Bearer tok')
    // 토큰은 다시 받지 않는다 (10분 안)
    expect(calls.filter((call) => call.url.startsWith('https://auth.linkhub.co.kr/'))).toHaveLength(1)
  })

  it('인증 실패·권한 없음·네트워크 오류·이상한 응답은 SourceError 종류뿐이고 응답 본문·키를 담지 않는다', async () => {
    const make = (respond: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>) => popbillHttpTransport(keys, { fetch: async (url) => respond(url) })
    const kindOf = async (work: Promise<unknown>) => {
      try {
        await work
        return 'ok'
      } catch (error) {
        expect(error).toBeInstanceOf(SourceError)
        expect(String((error as Error).message)).not.toMatch(/1234567890|LINKID|비밀 응답/)
        return (error as SourceError).kind
      }
    }
    const job = { corpNum: '1234567890', bankCode: '0004', accountNumber: '110', sDate: '20261018', eDate: '20261019' }
    expect(await kindOf(make(async () => ({ ok: false, status: 401, json: async () => ({ message: '비밀 응답' }) })).requestJob(job))).toBe('AUTH')
    expect(
      await kindOf(
        make(async (url) => (url.includes('auth.linkhub') ? { ok: true, status: 200, json: async () => ({ session_token: 't' }) } : { ok: false, status: 403, json: async () => ({ message: '비밀 응답' }) })).requestJob(job),
      ),
    ).toBe('FORBIDDEN')
    expect(
      await kindOf(
        make(async () => {
          throw new TypeError('fetch failed 1234567890')
        }).requestJob(job),
      ),
    ).toBe('NETWORK')
    expect(
      await kindOf(
        make(async (url) => (url.includes('auth.linkhub') ? { ok: true, status: 200, json: async () => ({ session_token: 't' }) } : { ok: true, status: 200, json: async () => ['비밀 응답'] })).requestJob(job),
      ),
    ).toBe('BAD_RESPONSE')
    expect(
      await kindOf(
        make(async (url) => (url.includes('auth.linkhub') ? { ok: true, status: 200, json: async () => ({ session_token: 't' }) } : { ok: false, status: 500, json: async () => ({ code: -99, message: '비밀 응답' }) })).requestJob(job),
      ),
    ).toBe('BAD_RESPONSE')
  })
})
