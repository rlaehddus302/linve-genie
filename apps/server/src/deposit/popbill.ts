// 계좌조회 원천 어댑터 — 팝빌 EasyFinBank 형식 (DEPOSIT_RULES DP-1·DP-7, D-N3-09, AC-N3-14·15).
// 흐름: 수집 요청(사업자번호·은행·계좌번호, 어제·오늘 KST yyyyMMdd) → 수집 상태 확인(끝날 때까지, 최대 60초) → 조회(거래 종류 입금만, 쪽마다 끝까지).
// 팝빌과 주고받는 일은 전송(PopbillTransport) 하나 뒤에 둔다. 시험은 가짜 팝빌 전송(popbill-fake.ts)으로 한다 — 시험은 네트워크를 쓰지 않는다.
// 실제 전송(popbillHttpTransport)은 연동 키(LinkID·SecretKey, 서버 환경 변수)가 있을 때만 쓴다. 실계약에서의 확인은 사용자 몫이다(D-N3-09).
// 로그·오류 문장에 사업자번호·계좌번호·팝빌 응답 본문·연동 키를 넣지 않는다(AC-N3-16).
import { createHash, createHmac } from 'node:crypto'
import type { GeneratorTimer } from '../generator.ts'
import type { AccountSecret } from './account-seal.ts'
import { DAY_MS, isRealDate, kstDateOf, kstToMs } from './calendar.ts'
import { DEPOSIT_AMOUNT_MAX, cleanDepositName } from './paste.ts'

/** 원천 오류 종류 (기술 상세 없이 문장 하나로 바꾼다) */
export type SourceErrorKind = 'AUTH' | 'NO_KEY' | 'FORBIDDEN' | 'NOT_REGISTERED' | 'NETWORK' | 'TIMEOUT' | 'JOB_FAILED' | 'BAD_RESPONSE' | 'CORP_TAKEN' | 'CORP_MISMATCH'

/** 원천 오류 (메시지에 값을 넣지 않는다 — 종류만) */
export class SourceError extends Error {
  readonly kind: SourceErrorKind
  constructor(kind: SourceErrorKind) {
    super(`입금 원천 오류 (${kind})`)
    this.name = 'SourceError'
    this.kind = kind
  }
}

/** 원천 상태에 남기는 쉬운 한국어 한 문장 (AC-N3-14·15) */
export const SOURCE_MESSAGES: Readonly<Record<SourceErrorKind | 'MALFORMED', string>> = {
  AUTH: '팝빌 연결을 확인해 주세요.',
  NO_KEY: '팝빌 연결을 확인해 주세요.',
  FORBIDDEN: '팝빌 계좌조회 권한을 확인해 주세요.',
  NOT_REGISTERED: '팝빌에 등록되지 않은 계좌예요. 팝빌 계좌 관리에서 등록해 주세요.',
  NETWORK: '팝빌에 연결하지 못했어요. 잠시 뒤에 다시 받아 올게요.',
  TIMEOUT: '은행에서 내역을 받아 오는 데 시간이 오래 걸려요. 잠시 뒤에 다시 받아 올게요.',
  JOB_FAILED: '은행에서 내역을 받아 오지 못했어요. 잠시 뒤에 다시 받아 올게요.',
  BAD_RESPONSE: '팝빌에서 받은 내역을 읽지 못했어요. 잠시 뒤에 다시 받아 올게요.',
  // 사업자번호가 이 판매자에게 묶인 것이 아니다 (RA-N3-001) — 다른 계정이 쓰는지는 밝히지 않는 문장
  CORP_TAKEN: '이 사업자번호는 이 계정에서 쓸 수 없어요. 사업자번호를 확인해 주세요.',
  CORP_MISMATCH: '이 계정에 연결한 사업자번호와 달라요. 사업자번호를 확인해 주세요.',
  MALFORMED: '읽지 못한 내역이 있어요',
}

export function sourceErrorKind(error: unknown): SourceErrorKind {
  return error instanceof SourceError ? error.kind : 'BAD_RESPONSE'
}

// ── 전송 ─────────────────────────────────────────────────────────────────

/** 수집 상태 (팝빌 jobState: 1 대기 · 2 진행 · 3 완료, errorCode: 1 성공) */
export interface PopbillJobState {
  readonly jobState: number
  readonly errorCode: number
}

/** 조회 한 쪽 (팝빌 응답 그대로의 모양 — list의 줄은 어댑터가 검사한다) */
export interface PopbillSearchPage {
  readonly pageNum: number
  readonly pageCount: number
  readonly list: readonly unknown[]
}

/** 팝빌 EasyFinBank 전송. 실패는 SourceError로 던진다 */
export interface PopbillTransport {
  requestJob(input: { readonly corpNum: string; readonly bankCode: string; readonly accountNumber: string; readonly sDate: string; readonly eDate: string }): Promise<string>
  getJobState(input: { readonly corpNum: string; readonly jobId: string }): Promise<PopbillJobState>
  search(input: { readonly corpNum: string; readonly jobId: string; readonly tradeType: readonly ('I' | 'O')[]; readonly page: number; readonly perPage: number }): Promise<PopbillSearchPage>
  /** 팝빌 계좌 관리 화면 주소 (서비스는 저장하지 않고 그대로 돌려준다) */
  getBankAccountMgtURL(input: { readonly corpNum: string }): Promise<string>
}

// ── 받아 온 입금 ──────────────────────────────────────────────────────────

/** 원천에서 받아 온 입금 한 줄 (저장 전) */
export interface FetchedRow {
  /** 외부 키 (팝빌 tid · 시험이 준 키) */
  readonly key: string
  /** 거래 시각 (UTC 밀리초) */
  readonly at: number
  readonly precision: 'second' | 'minute'
  readonly amount: number
  /** 입금자명 (cleanDepositName — 짝 없는 서로게이트는 U+FFFD, NUL 뺌, 앞뒤 공백 뺌, 40자까지) */
  readonly name: string
}

export interface FetchResult {
  readonly rows: readonly FetchedRow[]
  /** 모양이 틀려 건너뛴 줄 수 (원천 오류 문장 "읽지 못한 내역이 있어요") */
  readonly malformed: number
}

const TID_RE = /^[\x21-\x7e]{1,100}$/
const TRDT_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/

const cleanName = (value: unknown): string => (typeof value === 'string' ? cleanDepositName(value) : '')

/** 팝빌 응답 한 줄 → 입금 / 건너뜀(입금액 0) / 읽지 못함 (AC-N3-15) */
export function mapPopbillRow(raw: unknown): FetchedRow | 'SKIP' | 'MALFORMED' {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'MALFORMED'
  const row = raw as Record<string, unknown>
  const tid = row['tid']
  if (typeof tid !== 'string' || !TID_RE.test(tid)) return 'MALFORMED'
  const trdt = typeof row['trdt'] === 'string' ? TRDT_RE.exec(row['trdt']) : null
  if (trdt === null) return 'MALFORMED'
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((index) => Number(trdt[index])) as [number, number, number, number, number, number]
  if (!isRealDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return 'MALFORMED'
  const accIn = row['accIn']
  const text = typeof accIn === 'number' && Number.isSafeInteger(accIn) && accIn >= 0 ? String(accIn) : accIn
  if (typeof text !== 'string' || !/^\d{1,12}$/.test(text)) return 'MALFORMED'
  const amount = Number(text)
  if (amount === 0) return 'SKIP'
  if (amount < 1 || amount > DEPOSIT_AMOUNT_MAX) return 'MALFORMED'
  const first = cleanName(row['remark1'])
  return { key: tid, at: kstToMs(year, month, day, hour, minute, second), precision: 'second', amount, name: first === '' ? cleanName(row['remark2']) : first }
}

export interface PopbillFetchOptions {
  readonly transport: PopbillTransport
  readonly now: () => number
  readonly timer: GeneratorTimer
  /** 수집 상태를 다시 묻기 전에 기다리는 시간 (기본 1000밀리초) */
  readonly pollMs: number
  /** 수집이 끝나기를 기다리는 최대 시간 (60초 — 서버 시계로 잰다) */
  readonly jobTimeoutMs: number
  /** 전송 호출 하나의 시간 제한 (기본 30초) */
  readonly callTimeoutMs: number
}

/** 한 쪽에 받는 줄 수 (팝빌 최대 1000) */
export const POPBILL_PER_PAGE = 1000
/** 쪽 수 상한 (쪽이 끝나지 않는 응답을 끊는다) */
export const POPBILL_MAX_PAGES = 100
/** 사업자번호마다 둔 팝빌 토큰 수 상한 (넘으면 가장 오래 둔 것부터 버린다 — RA-N3-001: 끝없이 늘지 않게) */
export const POPBILL_TOKEN_CACHE_MAX = 256

const yyyymmdd = (date: string): string => date.replace(/-/g, '')

function sleep(timer: GeneratorTimer, ms: number): Promise<void> {
  return new Promise((resolve) => {
    timer.schedule(ms, resolve)
  })
}

/** 시간 제한 안에 끝나지 않으면 NETWORK 오류 (전송이 응답하지 않아도 받아 오기가 멈추지 않게) */
export function withTimeout<T>(timer: GeneratorTimer, ms: number, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false
    const cancel = timer.schedule(ms, () => {
      if (done) return
      done = true
      reject(new SourceError('NETWORK'))
    })
    let started: Promise<T>
    try {
      started = work()
    } catch (error) {
      started = Promise.reject(error instanceof Error ? error : new SourceError('BAD_RESPONSE'))
    }
    started.then(
      (value) => {
        if (done) return
        done = true
        cancel()
        resolve(value)
      },
      (error: unknown) => {
        if (done) return
        done = true
        cancel()
        reject(error instanceof SourceError ? error : new SourceError(error instanceof TypeError ? 'NETWORK' : 'BAD_RESPONSE'))
      },
    )
  })
}

/** 계좌조회 한 번: 어제·오늘(KST) 입금을 받아 온다 */
export async function fetchPopbill(options: PopbillFetchOptions, account: AccountSecret): Promise<FetchResult> {
  const { transport, timer } = options
  const call = <T>(work: () => Promise<T>) => withTimeout(timer, options.callTimeoutMs, work)
  const today = kstDateOf(options.now())
  const yesterday = kstDateOf(options.now() - DAY_MS)
  const jobId = await call(() =>
    transport.requestJob({ corpNum: account.corpNum, bankCode: account.bank, accountNumber: account.accountNumber, sDate: yyyymmdd(yesterday), eDate: yyyymmdd(today) }),
  )
  if (typeof jobId !== 'string' || jobId === '' || jobId.length > 100) throw new SourceError('BAD_RESPONSE')
  const started = options.now()
  for (;;) {
    const state = await call(() => transport.getJobState({ corpNum: account.corpNum, jobId }))
    if (typeof state !== 'object' || state === null || typeof state.jobState !== 'number') throw new SourceError('BAD_RESPONSE')
    if (state.jobState === 3) {
      if (state.errorCode !== 1) throw new SourceError('JOB_FAILED')
      break
    }
    if (options.now() - started >= options.jobTimeoutMs) throw new SourceError('TIMEOUT')
    await sleep(timer, options.pollMs)
    if (options.now() - started >= options.jobTimeoutMs) throw new SourceError('TIMEOUT')
  }
  const rows: FetchedRow[] = []
  let malformed = 0
  for (let page = 1; ; page++) {
    const result = await call(() => transport.search({ corpNum: account.corpNum, jobId, tradeType: ['I'], page, perPage: POPBILL_PER_PAGE }))
    if (
      typeof result !== 'object' ||
      result === null ||
      !Array.isArray(result.list) ||
      result.pageNum !== page ||
      !Number.isSafeInteger(result.pageCount) ||
      result.pageCount < 0 ||
      result.pageCount > POPBILL_MAX_PAGES ||
      result.list.length > POPBILL_PER_PAGE
    ) {
      throw new SourceError('BAD_RESPONSE')
    }
    for (const raw of result.list) {
      const mapped = mapPopbillRow(raw)
      if (mapped === 'MALFORMED') malformed++
      else if (mapped !== 'SKIP') rows.push(mapped)
    }
    if (page >= result.pageCount) break
  }
  return { rows, malformed }
}

// ── 실제 팝빌 전송 (연동 키가 있을 때만) ────────────────────────────────────

export interface PopbillKeys {
  readonly linkId: string
  readonly secretKey: string
  /** 팝빌 테스트베드를 쓰는지 */
  readonly testBed: boolean
}

/** 연동 키 읽기 (POPBILL_LINK_ID·POPBILL_SECRET_KEY·POPBILL_TEST_BED). 둘 중 하나라도 없으면 null — 값은 어디에도 찍지 않는다 */
export function readPopbillKeys(env: Readonly<Record<string, string | undefined>>): PopbillKeys | null {
  const linkId = env['POPBILL_LINK_ID']?.trim() ?? ''
  const secretKey = env['POPBILL_SECRET_KEY']?.trim() ?? ''
  if (linkId === '' || secretKey === '') return null
  return { linkId, secretKey, testBed: env['POPBILL_TEST_BED']?.trim() === 'true' }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/**
 * 실제 팝빌 전송 (링크허브 인증 → 팝빌 EasyFinBank REST). 실계약에서 확인이 필요하다(D-N3-09 "사용자 확인 필요").
 * 응답 본문·연동 키·사업자번호·계좌번호는 오류에 담지 않는다 — 실패는 SourceError 종류뿐이다
 */
export function popbillHttpTransport(keys: PopbillKeys, options: { readonly fetch?: FetchLike; readonly now?: () => number } = {}): PopbillTransport {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init))
  const now = options.now ?? (() => Date.now())
  const serviceId = keys.testBed ? 'POPBILL_TEST' : 'POPBILL'
  const apiBase = keys.testBed ? 'https://popbill-test.linkhub.co.kr' : 'https://popbill.linkhub.co.kr'
  const tokens = new Map<string, { token: string; until: number }>()

  const request = async (url: string, init: Parameters<FetchLike>[1]): Promise<unknown> => {
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await doFetch(url, init)
    } catch {
      throw new SourceError('NETWORK')
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new SourceError('BAD_RESPONSE')
    }
    if (!response.ok) {
      if (response.status === 401) throw new SourceError('AUTH')
      if (response.status === 403) throw new SourceError('FORBIDDEN')
      throw new SourceError('BAD_RESPONSE')
    }
    return body
  }

  const token = async (corpNum: string): Promise<string> => {
    const cached = tokens.get(corpNum)
    if (cached !== undefined && cached.until > now()) return cached.token
    const uri = `/${serviceId}/Token`
    const body = JSON.stringify({ access_id: corpNum, scope: ['member', '180'] })
    const xDate = new Date(now()).toISOString()
    const digestTarget = ['POST', createHash('sha256').update(body, 'utf8').digest('base64'), xDate, '2.0', uri].join('\n')
    const signature = createHmac('sha256', Buffer.from(keys.secretKey, 'base64')).update(digestTarget, 'utf8').digest('base64')
    let result: unknown
    try {
      result = await request(`https://auth.linkhub.co.kr${uri}`, {
        method: 'POST',
        headers: { 'x-lh-date': xDate, 'x-lh-version': '2.0', Authorization: `LINKHUB ${keys.linkId} ${signature}`, 'Content-Type': 'application/json' },
        body,
      })
    } catch (error) {
      throw error instanceof SourceError && error.kind === 'NETWORK' ? error : new SourceError('AUTH')
    }
    const record = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}
    const sessionToken = record['session_token']
    if (typeof sessionToken !== 'string' || sessionToken === '') throw new SourceError('AUTH')
    // 만료된 토큰을 치우고, 그래도 상한이면 가장 오래 둔 것부터 버린다
    const at = now()
    for (const [key, value] of tokens) if (value.until <= at) tokens.delete(key)
    tokens.delete(corpNum)
    while (tokens.size >= POPBILL_TOKEN_CACHE_MAX) {
      const oldest = tokens.keys().next()
      if (oldest.done === true) break
      tokens.delete(oldest.value)
    }
    tokens.set(corpNum, { token: sessionToken, until: at + 10 * 60_000 })
    return sessionToken
  }

  const api = async (corpNum: string, method: 'GET' | 'POST', path: string): Promise<Record<string, unknown>> => {
    const result = await request(`${apiBase}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await token(corpNum)}`, 'x-pb-version': '1.0', 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '' } : {}),
    })
    if (typeof result !== 'object' || result === null || Array.isArray(result)) throw new SourceError('BAD_RESPONSE')
    return result as Record<string, unknown>
  }

  const enc = encodeURIComponent
  return {
    requestJob: async ({ corpNum, bankCode, accountNumber, sDate, eDate }) => {
      const result = await api(corpNum, 'POST', `/EasyFin/Bank/BankAccount?BankCode=${enc(bankCode)}&AccountNumber=${enc(accountNumber)}&SDate=${enc(sDate)}&EDate=${enc(eDate)}`)
      const jobId = result['jobID']
      if (typeof jobId !== 'string') throw new SourceError('BAD_RESPONSE')
      return jobId
    },
    getJobState: async ({ corpNum, jobId }) => {
      const result = await api(corpNum, 'GET', `/EasyFin/Bank/${enc(jobId)}/State`)
      return { jobState: Number(result['jobState']), errorCode: Number(result['errorCode']) }
    },
    search: async ({ corpNum, jobId, tradeType, page, perPage }) => {
      const result = await api(corpNum, 'GET', `/EasyFin/Bank/${enc(jobId)}?TradeType=${tradeType.join(',')}&Page=${String(page)}&PerPage=${String(perPage)}&Order=A`)
      return { pageNum: Number(result['pageNum']), pageCount: Number(result['pageCount']), list: Array.isArray(result['list']) ? (result['list'] as unknown[]) : [] }
    },
    getBankAccountMgtURL: async ({ corpNum }) => {
      const result = await api(corpNum, 'GET', '/EasyFin/Bank?TG=BankAccount')
      const url = result['url']
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new SourceError('BAD_RESPONSE')
      return url
    },
  }
}
