// 화면 단위 시험 도우미: 입금 확인 API를 흉내 내는 가짜 서버 (harness/sprints/N3/dev-notes.md "dev-server > 화면(dev-web)에게"의 모양).
// 맞추기 규칙은 흉내 내지 않는다 — 시험이 사유·제안을 정해 넣는다(화면은 서버가 계산한 값을 낱말로만 바꾼다).
import type { BundleView, DepositActionView, DepositStatus, DepositView, PastePreview, PasteSummary, RememberedName, SourceView } from '../src/api/deposit-types.ts'
import { FakeServer, apiError, type Call, type Reply } from './support.ts'

export const D_DATE = '2026-10-18'

export function bundle(patch: Partial<BundleView> = {}): BundleView {
  return {
    date: D_DATE,
    buyer: 'UC_A',
    name: '다육이맘',
    total: 14000,
    received: 0,
    remaining: 14000,
    payment: 'UNPAID',
    refundDue: 0,
    after: { payment: 'PAID', received: 14000, refundDue: 0 },
    beforeSale: false,
    canRemember: false,
    ...patch,
  }
}

export function deposit(no: number, patch: Partial<DepositView> = {}): DepositView {
  return {
    no,
    source: { id: 'dsrc_fake', kind: 'FAKE', label: '시험용 입금' },
    at: '2026-10-18T12:03:15.000Z',
    precision: 'second',
    amount: 14000,
    name: '다육이 맘',
    status: 'REVIEW',
    applied: null,
    receivedAt: '2026-10-18T12:05:00.000Z',
    handledAt: null,
    review: { reason: 'NAME_MISMATCH', twin: null, suggestions: [bundle()], preselect: { date: D_DATE, buyer: 'UC_A' } },
    ...patch,
  }
}

export function source(patch: Partial<SourceView> = {}): SourceView {
  return {
    id: 'dsrc_fake',
    kind: 'FAKE',
    label: '시험용 입금',
    enabled: true,
    intervalMin: 5,
    bank: null,
    accountLast4: null,
    lastFetchedAt: '2026-10-18T12:05:00.000Z',
    lastError: null,
    lastErrorAt: null,
    lastNew: 2,
    fetching: false,
    fetchable: true,
    ...patch,
  }
}

const STATUS_LIST = /^\/api\/deposits\?(.*)$/

export class DepositServer {
  readonly server = new FakeServer()
  deposits: DepositView[]
  sources: SourceView[] = [source(), source({ id: 'dsrc_paste', kind: 'PASTE', label: '붙여넣기', fetchable: false, lastFetchedAt: null, lastNew: null })]
  popbill = false
  testMode = true
  names: RememberedName[] = []
  bundles: BundleView[] = []
  actions = new Map<number, DepositActionView[]>()
  preview: PastePreview | Reply = { rows: [], skipped: [], unreadable: [] }
  pasteSummary: PasteSummary = { read: 0, skipped: 0, unreadable: [], new: 0, existing: 0, old: 0, future: 0, auto: 0, review: 0 }
  /** 다음 처리 요청(확정·무시·다시·되돌리기·한꺼번에)을 이 응답으로 대신한다 (한 번) */
  failNext: Reply | null = null
  /** 그 입금 번호의 처리를 이 응답으로 대신한다 (한꺼번에 항목 거절) */
  readonly failFor = new Map<number, Reply>()

  constructor(deposits: DepositView[] = []) {
    this.deposits = deposits
    this.server
      .on('GET', /^\/api\/deposits\/count$/, () => ({ body: { review: this.review } }))
      .on('GET', STATUS_LIST, (call) => this.list(call))
      .on('GET', /^\/api\/deposits\/sources$/, () => ({ body: { sources: this.sources, popbill: this.popbill, testMode: this.testMode } }))
      .on('POST', /^\/api\/deposits\/sources$/, (call) => {
        const kind = call.body?.kind
        if (kind === 'POPBILL' && !this.popbill) return apiError(409, 'POPBILL_NOT_READY', '계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요.')
        const made = source({ id: `dsrc_${String(this.sources.length + 1)}`, kind: kind === 'POPBILL' ? 'POPBILL' : 'FAKE', label: typeof call.body?.label === 'string' ? call.body.label : '시험용 입금', lastFetchedAt: null, lastNew: null })
        this.sources.push(made)
        return { body: made }
      })
      .on('PATCH', /^\/api\/deposits\/sources\/([^/]+)$/, (call, match) => {
        const index = this.sources.findIndex((item) => item.id === match[1])
        if (index < 0) return apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
        const next = { ...(this.sources[index] as SourceView), ...(call.body as Partial<SourceView>) }
        this.sources[index] = next
        return { body: next }
      })
      .on('POST', /^\/api\/deposits\/sources\/([^/]+)\/fetch$/, (_call, match) => ({ body: { source: this.sources.find((item) => item.id === match[1]) } }))
      .on('GET', /^\/api\/deposits\/names$/, () => ({ body: { names: this.names } }))
      .on('DELETE', /^\/api\/deposits\/names\/(\d+)$/, (_call, match) => {
        this.names = this.names.filter((item) => item.id !== Number(match[1]))
        return { body: { ok: true } }
      })
      .on('POST', /^\/api\/deposits\/paste\/preview$/, () => ('rows' in this.preview ? { body: this.preview } : this.preview))
      .on('POST', /^\/api\/deposits\/paste$/, () => ({ body: this.pasteSummary }))
      .on('POST', /^\/api\/deposits\/bulk$/, (call) => this.bulk(call))
      .on('GET', /^\/api\/deposits\/(\d+)$/, (_call, match) => {
        const found = this.deposits.find((item) => item.no === Number(match[1]))
        return found === undefined ? apiError(404, 'NOT_FOUND', '찾을 수 없어요.') : { body: { deposit: { ...found, actions: this.actions.get(found.no) ?? [] } } }
      })
      .on('GET', /^\/api\/deposits\/(\d+)\/bundles(\?.*)?$/, () => ({ body: { bundles: this.bundles } }))
      .on('POST', /^\/api\/deposits\/(\d+)\/(confirm|ignore|reopen|revert)$/, (call, match) => this.act(Number(match[1]), match[2] as string, call.body ?? {}))
      .on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: D_DATE, rehearsal: false, seq: 3 }, { date: '2026-10-17', rehearsal: false, seq: 2 }] } }))
  }

  get review(): number {
    return this.deposits.filter((item) => item.status === 'REVIEW').length
  }

  list(call: Call): Reply {
    const params = new URLSearchParams(STATUS_LIST.exec(call.path)?.[1] ?? '')
    const statuses = (params.get('status') ?? 'REVIEW').split(',') as DepositStatus[]
    const before = params.get('before')
    const limit = Number(params.get('limit') ?? '50')
    const all = this.deposits.filter((item) => statuses.includes(item.status) && (before === null || item.no < Number(before))).sort((a, b) => b.no - a.no)
    return { body: { deposits: all.slice(0, limit), more: all.length > limit, review: this.review } }
  }

  #take(): Reply | null {
    const reply = this.failNext
    this.failNext = null
    return reply
  }

  #set(no: number, patch: Partial<DepositView>): DepositView | null {
    const index = this.deposits.findIndex((item) => item.no === no)
    if (index < 0) return null
    const next = { ...(this.deposits[index] as DepositView), ...patch }
    this.deposits[index] = next
    return next
  }

  act(no: number, action: string, body: Record<string, unknown>, fromBulk = false): Reply {
    const fail = fromBulk ? null : this.#take()
    if (fail !== null) return fail
    const itemFail = this.failFor.get(no)
    if (itemFail !== undefined) return itemFail
    const found = this.deposits.find((item) => item.no === no)
    if (found === undefined) return apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
    switch (action) {
      case 'confirm': {
        const applied = { date: String(body.date), buyer: String(body.buyer), buyerName: '다육이맘', seq: 40, auto: false }
        this.#set(no, { status: 'APPLIED', applied })
        return { body: { deposit: { no, status: 'APPLIED', applied: { ...applied, beforeSale: false } } } }
      }
      case 'ignore':
        this.#set(no, { status: 'IGNORED' })
        return { body: { deposit: { no, status: 'IGNORED', applied: null } } }
      case 'reopen':
        this.#set(no, { status: 'REVIEW' })
        return { body: { deposit: { no, status: 'REVIEW', applied: null } } }
      default:
        this.#set(no, { status: 'REVIEW', applied: null })
        return { body: { deposit: { no, status: 'REVIEW', applied: null }, refund: { date: D_DATE, seq: 41 } } }
    }
  }

  bulk(call: Call): Reply {
    const fail = this.#take()
    if (fail !== null) return fail
    const items = (call.body?.items ?? []) as Record<string, unknown>[]
    const results = items.map((item) => {
      const reply = this.act(Number(item.no), item.action === 'confirm' ? 'confirm' : 'ignore', item, true)
      const body = reply.body as { deposit?: unknown; error?: { code: string; message: string } }
      return (reply.status ?? 200) < 300 ? { no: item.no, ok: true, deposit: body.deposit } : { no: item.no, ok: false, status: reply.status, error: body.error }
    })
    return { body: { results } }
  }
}
