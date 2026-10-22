// 가짜 팝빌 전송 (AC-N3-15, D-N3-12): 수집 요청 → 상태 확인 → 입금만 조회의 흐름, 쪽 나눔, 대기, 시간 초과, 오류를 흉내 낸다.
// 서버 시험·적대 시험이 계좌조회 어댑터를 네트워크 없이 확인할 때 쓴다(운영 기동은 쓰지 않는다 — 연동 키가 있을 때 실제 전송).
import { SourceError, type PopbillJobState, type PopbillSearchPage, type PopbillTransport, type SourceErrorKind } from './popbill.ts'

export interface FakePopbillAccount {
  readonly corpNum: string
  readonly bankCode: string
  readonly accountNumber: string
}

/** 팝빌 조회 응답 한 줄 모양 (시험이 일부러 틀린 값도 넣을 수 있게 느슨하다) */
export interface FakePopbillRow {
  readonly tid?: unknown
  readonly trdt?: unknown
  readonly accIn?: unknown
  readonly accOut?: unknown
  readonly balance?: unknown
  readonly remark1?: unknown
  readonly remark2?: unknown
  readonly [key: string]: unknown
}

type Method = 'requestJob' | 'getJobState' | 'search' | 'getBankAccountMgtURL'

export interface FakePopbillCall {
  readonly method: Method
  readonly input: Readonly<Record<string, unknown>>
}

/** 가짜 계좌 관리 주소 (시험용 — 실제 팝빌 주소가 아니다) */
export const FAKE_POPBILL_MGT_URL = 'https://popbill.test/fake-bank-account-mgt'

const accountKey = (account: { readonly corpNum: string; readonly bankCode: string; readonly accountNumber: string }) =>
  JSON.stringify([account.corpNum, account.bankCode, account.accountNumber])

export class FakePopbillTransport implements PopbillTransport {
  /** 받은 호출 (순서대로 — 시험이 거래 종류·날짜를 확인한다) */
  readonly calls: FakePopbillCall[] = []
  /** 수집 상태를 몇 번 물어야 끝나는지 (기본 0 — 처음 물을 때 완료) */
  pollsBeforeDone = 0
  /** 상태를 물을 때마다 부른다 (시험이 서버 시계를 앞으로 돌려 60초 시간 초과를 만든다) */
  onPoll: (() => void) | null = null
  /** 수집이 은행 오류로 끝나는지 (errorCode ≠ 1) */
  jobFails = false
  /** 한 쪽의 줄 수 상한 (요청한 perPage보다 작으면 이것) */
  pageSize = 1000
  /** 쪽이 끝나지 않는 응답 (늘 1쪽·전체 2쪽) */
  loopPages = false
  readonly #accounts = new Set<string>()
  readonly #rows = new Map<string, FakePopbillRow[]>()
  readonly #jobs = new Map<string, { readonly account: string; readonly sDate: string; readonly eDate: string; polls: number }>()
  readonly #failures = new Map<Method, SourceErrorKind | 'HANG'>()
  #nextJob = 1

  /** 빠른조회로 등록한 계좌 (등록하지 않은 계좌의 수집 요청은 NOT_REGISTERED) */
  register(account: FakePopbillAccount): this {
    this.#accounts.add(accountKey(account))
    return this
  }

  /** 그 계좌의 거래 내역에 줄을 더한다 (입금·출금 모두 — 조회가 입금만 돌려준다) */
  addRows(account: FakePopbillAccount, rows: readonly FakePopbillRow[]): this {
    const key = accountKey(account)
    this.#rows.set(key, [...(this.#rows.get(key) ?? []), ...rows])
    return this
  }

  /** 그 호출을 실패시킨다 (null이면 되돌린다). 'HANG'은 응답하지 않는다 */
  fail(method: Method, kind: SourceErrorKind | 'HANG' | null): this {
    if (kind === null) this.#failures.delete(method)
    else this.#failures.set(method, kind)
    return this
  }

  #check(method: Method, input: Readonly<Record<string, unknown>>): Promise<never> | null {
    this.calls.push({ method, input })
    const failure = this.#failures.get(method)
    if (failure === undefined) return null
    if (failure === 'HANG') return new Promise<never>(() => {})
    return Promise.reject(new SourceError(failure))
  }

  requestJob(input: { readonly corpNum: string; readonly bankCode: string; readonly accountNumber: string; readonly sDate: string; readonly eDate: string }): Promise<string> {
    const failed = this.#check('requestJob', input)
    if (failed !== null) return failed
    const key = accountKey(input)
    if (!this.#accounts.has(key)) return Promise.reject(new SourceError('NOT_REGISTERED'))
    const jobId = `job-${String(this.#nextJob++)}`
    this.#jobs.set(jobId, { account: key, sDate: input.sDate, eDate: input.eDate, polls: 0 })
    return Promise.resolve(jobId)
  }

  getJobState(input: { readonly corpNum: string; readonly jobId: string }): Promise<PopbillJobState> {
    const failed = this.#check('getJobState', input)
    if (failed !== null) return failed
    const job = this.#jobs.get(input.jobId)
    if (job === undefined) return Promise.reject(new SourceError('BAD_RESPONSE'))
    job.polls++
    this.onPoll?.()
    if (job.polls <= this.pollsBeforeDone) return Promise.resolve({ jobState: 2, errorCode: 0 })
    return Promise.resolve({ jobState: 3, errorCode: this.jobFails ? -1 : 1 })
  }

  search(input: { readonly corpNum: string; readonly jobId: string; readonly tradeType: readonly ('I' | 'O')[]; readonly page: number; readonly perPage: number }): Promise<PopbillSearchPage> {
    const failed = this.#check('search', input)
    if (failed !== null) return failed
    const job = this.#jobs.get(input.jobId)
    if (job === undefined) return Promise.reject(new SourceError('BAD_RESPONSE'))
    if (this.loopPages) return Promise.resolve({ pageNum: 1, pageCount: 2, list: [] })
    const onlyIn = input.tradeType.length === 1 && input.tradeType[0] === 'I'
    const all = (this.#rows.get(job.account) ?? []).filter((row) => {
      const trdt = typeof row.trdt === 'string' ? row.trdt : ''
      // 모양이 맞는 줄만 날짜로 거른다 (틀린 줄은 그대로 돌려 어댑터가 읽지 못한 내역으로 센다)
      if (/^\d{14}$/.test(trdt) && (trdt.slice(0, 8) < job.sDate || trdt.slice(0, 8) > job.eDate)) return false
      if (onlyIn && (row.accIn === '0' || row.accIn === 0)) return false
      return true
    })
    const size = Math.max(1, Math.min(input.perPage, this.pageSize))
    const pageCount = Math.ceil(all.length / size)
    return Promise.resolve({ pageNum: input.page, pageCount, list: all.slice((input.page - 1) * size, input.page * size) })
  }

  getBankAccountMgtURL(input: { readonly corpNum: string }): Promise<string> {
    const failed = this.#check('getBankAccountMgtURL', input)
    if (failed !== null) return failed
    return Promise.resolve(`${FAKE_POPBILL_MGT_URL}?TG=BankAccount`)
  }
}
