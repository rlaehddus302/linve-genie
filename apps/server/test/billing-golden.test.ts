// AC-N5-01·02·03·04·05·AC-PL1B-20: 요금 골든(tests/golden/billing/*.json, G-BIL-*)을 서버의 순수 함수 다섯으로 돌린다.
// - 파일 수 5·사례 수 82(status 26 · payment 21 · vat 7 · bizno 13 · granted 15)를 고정값으로 단언한다 — 사례가 조용히 빠지면 실패한다.
//   (D-PL1-08: 종류 `granted`(G-BIL-301~315, judgeGranted)가 더해져 4·67 → 5·82)
// - 모르는 kind·키·열거값·중복 ID는 시험 실패(읽기 오류)다. 미구현을 허용하는 장치가 없다.
// - status는 out에 적은 키만, 나머지는 out 전체를 깊은 같음으로 비교한다. 시각은 오프셋을 적은 ISO → UTC 밀리초, 결과 시각은 KST `+09:00` 초까지.
// - 결정성(AC-N5-05): 같은 입력 두 번, TZ=Pacific/Honolulu·Asia/Seoul·UTC에서 같은 출력.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  GRANTED_ACTIONS,
  GRANT_SOURCES,
  ORDER_STATES,
  PASS_KINDS,
  PAYMENT_ACTIONS,
  QUANTITY_KINDS,
  START_MODES,
  billingStatus,
  judgeGranted,
  judgePayment,
  parseBizno,
  splitVat,
  type BillingStatus,
  type LedgerGrant,
  type LedgerUsage,
  type LookedUpPayment,
  type OrderState,
} from '../src/billing/rules.ts'

const DIR = fileURLToPath(new URL('../../../tests/golden/billing/', import.meta.url))
// D-PL1-08: granted 더함
const KINDS = ['status', 'payment', 'vat', 'bizno', 'granted'] as const
type Kind = (typeof KINDS)[number]

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Obj = { [key: string]: Json }

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 형식 문제 (읽기 오류) — 모으면 시험 실패 */
const problems: string[] = []
const fail = (where: string, message: string): void => {
  problems.push(`${where}: ${message}`)
}

function keys(where: string, value: Obj, allowed: readonly string[], required: readonly string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(where, `모르는 키 '${key}'`)
  for (const key of required) if (!Object.hasOwn(value, key)) fail(where, `필수 키 '${key}'가 없다`)
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/
function time(where: string, value: Json | undefined): number {
  if (typeof value !== 'string' || !ISO_RE.test(value)) {
    fail(where, '오프셋을 적은 ISO 시각이어야 한다')
    return Number.NaN
  }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) fail(where, '읽을 수 없는 시각')
  return ms
}
const intAtLeast = (where: string, value: Json | undefined, min: number): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) fail(where, `${String(min)} 이상 정수여야 한다`)
  return value as number
}
const oneOf = <T extends string>(where: string, value: Json | undefined, choices: readonly T[]): T => {
  if (typeof value !== 'string' || !(choices as readonly string[]).includes(value)) fail(where, `${choices.join('·')} 중 하나여야 한다`)
  return value as T
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
/** UTC 밀리초 → KST `YYYY-MM-DDTHH:MM:SS+09:00` (실행 환경 시간대와 상관없다) */
function kstIso(ms: number): string {
  const d = new Date(ms + 9 * 3600_000)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`
}

/** status 결과 → 골든 out 모양 (시각은 KST ISO) */
function statusOut(status: BillingStatus): Obj {
  return {
    flat: {
      active: status.flat.active,
      until: status.flat.until === null ? null : kstIso(status.flat.until),
      chain: status.flat.chain.map((link) => ({ grant: link.grant, from: kstIso(link.from), until: kstIso(link.until) })),
    },
    balances: { ...status.balances },
    window: status.window === null ? null : { from: kstIso(status.window.from), until: kstIso(status.window.until) },
    refundable: [...status.refundable],
    start: status.start.allowed ? { allowed: true, mode: status.start.mode, useDay: status.start.useDay } : { allowed: false, reason: status.start.reason },
  }
}

const STATUS_OUT_KEYS = ['flat', 'balances', 'window', 'refundable', 'start'] as const

/** out 형식 검사 (열거값·모양) */
function checkStatusOut(where: string, out: Obj): void {
  keys(where, out, STATUS_OUT_KEYS, [])
  if (Object.keys(out).length === 0) fail(where, 'out에 키가 하나 이상 있어야 한다')
  const start = out.start
  if (start !== undefined) {
    if (!isObj(start)) fail(`${where}.start`, '맵이어야 한다')
    else if (start.allowed === true) {
      keys(`${where}.start`, start, ['allowed', 'mode', 'useDay'], ['allowed', 'mode', 'useDay'])
      oneOf(`${where}.start.mode`, start.mode, START_MODES)
    } else {
      keys(`${where}.start`, start, ['allowed', 'reason'], ['allowed', 'reason'])
      oneOf(`${where}.start.reason`, start.reason, ['NO_PASS'])
    }
  }
  if (out.balances !== undefined) {
    if (!isObj(out.balances)) fail(`${where}.balances`, '맵이어야 한다')
    else keys(`${where}.balances`, out.balances, QUANTITY_KINDS, QUANTITY_KINDS)
  }
}

interface Ran {
  readonly id: string
  readonly kind: Kind
  readonly actual: Json
  readonly expected: Json
}

/** 결제 조회 결과 읽기 (payment·granted 공통 — 맵 또는 null). 형식이 틀리면 undefined */
function lookedUp(where: string, p: Json | undefined): LookedUpPayment | null | undefined {
  if (p === null) return null
  if (!isObj(p)) {
    fail(where, '맵 또는 null')
    return undefined
  }
  keys(where, p, ['status', 'amount', 'currency', 'storeId', 'method'], ['status', 'amount', 'currency', 'storeId', 'method'])
  if (typeof p.status !== 'string' || p.status === '') fail(`${where}.status`, '글이어야 한다')
  if (p.method !== null && typeof p.method !== 'string') fail(`${where}.method`, '글 또는 null')
  return {
    status: p.status as string,
    amount: intAtLeast(`${where}.amount`, p.amount, 0),
    currency: typeof p.currency === 'string' ? p.currency : null,
    storeId: typeof p.storeId === 'string' ? p.storeId : null,
    method: typeof p.method === 'string' ? p.method : null,
  }
}

/** 사례 하나를 읽고 돌린다. 결과(비교할 값)만 돌려준다 — 형식 문제는 problems에 */
function runCase(kind: Kind, where: string, c: Obj): Ran | null {
  const common = ['id', 'title', 'refs', 'note', 'out']
  const id = typeof c.id === 'string' ? c.id : ''
  if (!Array.isArray(c.refs) || c.refs.length === 0 || !c.refs.every((ref) => typeof ref === 'string' && ref !== '')) fail(where, 'refs는 1개 이상')
  if (typeof c.title !== 'string' || c.title === '') fail(where, 'title이 없다')
  if (c.note !== undefined && typeof c.note !== 'string') fail(where, 'note는 글')
  const out = c.out
  switch (kind) {
    case 'status': {
      keys(where, c, [...common, 'grants', 'usage', 'flatStarts', 'now'], ['id', 'title', 'refs', 'out', 'grants', 'usage', 'flatStarts', 'now'])
      if (!isObj(out)) {
        fail(`${where}.out`, '맵이어야 한다')
        return null
      }
      checkStatusOut(`${where}.out`, out)
      const grants: LedgerGrant[] = (Array.isArray(c.grants) ? c.grants : []).map((g, i) => {
        const gw = `${where}.grants[${String(i)}]`
        if (!isObj(g)) {
          fail(gw, '맵이어야 한다')
          return { id: '', kind: 'DAYS', source: 'PAYMENT', at: 0 }
        }
        keys(gw, g, ['id', 'kind', 'quantity', 'source', 'at', 'revoked'], ['id', 'kind', 'source', 'at'])
        const k = oneOf(`${gw}.kind`, g.kind, PASS_KINDS)
        if (k === 'FLAT_30D' && g.quantity !== undefined) fail(`${gw}.quantity`, '정액엔 양이 없다')
        if (k !== 'FLAT_30D') intAtLeast(`${gw}.quantity`, g.quantity, 1)
        if (g.revoked !== undefined && typeof g.revoked !== 'boolean') fail(`${gw}.revoked`, 'true·false')
        if (typeof g.id !== 'string' || g.id === '') fail(`${gw}.id`, '글이어야 한다')
        return {
          id: g.id as string,
          kind: k,
          ...(typeof g.quantity === 'number' ? { quantity: g.quantity } : {}),
          source: oneOf(`${gw}.source`, g.source, GRANT_SOURCES),
          at: time(`${gw}.at`, g.at),
          ...(g.revoked === true ? { revoked: true } : {}),
        }
      })
      const usage: LedgerUsage[] = (Array.isArray(c.usage) ? c.usage : []).map((u, i) => {
        const uw = `${where}.usage[${String(i)}]`
        if (!isObj(u)) {
          fail(uw, '맵이어야 한다')
          return { kind: 'DAYS', at: 0 }
        }
        keys(uw, u, ['kind', 'at', 'count'], ['kind', 'at'])
        const k = oneOf(`${uw}.kind`, u.kind, QUANTITY_KINDS)
        if (u.count !== undefined) {
          if (k === 'DAYS') fail(`${uw}.count`, 'DAYS에는 count가 없다')
          intAtLeast(`${uw}.count`, u.count, 1)
        }
        return { kind: k, at: time(`${uw}.at`, u.at), ...(typeof u.count === 'number' ? { count: u.count } : {}) }
      })
      if (!Array.isArray(c.grants)) fail(`${where}.grants`, '목록이어야 한다')
      if (!Array.isArray(c.usage)) fail(`${where}.usage`, '목록이어야 한다')
      if (!Array.isArray(c.flatStarts)) fail(`${where}.flatStarts`, '목록이어야 한다')
      const flatStarts = (Array.isArray(c.flatStarts) ? c.flatStarts : []).map((at, i) => time(`${where}.flatStarts[${String(i)}]`, at))
      const now = time(`${where}.now`, c.now)
      const full = statusOut(billingStatus({ grants, usage, flatStarts, now }))
      // out에 적은 키만 비교한다
      const actual: Obj = {}
      for (const key of Object.keys(out)) actual[key] = full[key] ?? null
      return { id, kind, actual, expected: out }
    }
    case 'payment': {
      keys(where, c, [...common, 'order', 'payment', 'storeId'], ['id', 'title', 'refs', 'out', 'order', 'payment', 'storeId'])
      if (!isObj(out)) {
        fail(`${where}.out`, '맵이어야 한다')
        return null
      }
      keys(`${where}.out`, out, ['action', 'document'], ['action', 'document'])
      oneOf(`${where}.out.action`, out.action, PAYMENT_ACTIONS)
      if (typeof out.document !== 'boolean') fail(`${where}.out.document`, 'true·false')
      const order = c.order
      if (!isObj(order)) {
        fail(`${where}.order`, '맵이어야 한다')
        return null
      }
      keys(`${where}.order`, order, ['amount', 'state'], ['amount', 'state'])
      const state: OrderState = oneOf(`${where}.order.state`, order.state, ORDER_STATES)
      const amount = intAtLeast(`${where}.order.amount`, order.amount, 1)
      const payment = lookedUp(`${where}.payment`, c.payment)
      if (payment === undefined) return null
      if (typeof c.storeId !== 'string' || c.storeId === '') fail(`${where}.storeId`, '글이어야 한다')
      const judged = judgePayment({ order: { amount, state }, payment, storeId: c.storeId as string })
      return { id, kind, actual: { action: judged.action, document: judged.document }, expected: out }
    }
    case 'granted': {
      // D-PL1-08 (AC-PL1B-20): 부여된 결제 다시 맞추기 — out은 action 하나, 정확히 같아야 한다
      keys(where, c, [...common, 'refunding', 'settled', 'payment', 'storeId'], ['id', 'title', 'refs', 'out', 'refunding', 'settled', 'payment', 'storeId'])
      if (!isObj(out)) {
        fail(`${where}.out`, '맵이어야 한다')
        return null
      }
      keys(`${where}.out`, out, ['action'], ['action'])
      oneOf(`${where}.out.action`, out.action, GRANTED_ACTIONS)
      if (typeof c.refunding !== 'boolean') fail(`${where}.refunding`, 'true·false')
      if (typeof c.settled !== 'boolean') fail(`${where}.settled`, 'true·false')
      if (typeof c.storeId !== 'string' || c.storeId === '') fail(`${where}.storeId`, '글이어야 한다')
      const payment = lookedUp(`${where}.payment`, c.payment)
      if (payment === undefined) return null
      const action = judgeGranted({ refunding: c.refunding === true, settled: c.settled === true, payment, storeId: c.storeId as string })
      return { id, kind, actual: { action }, expected: out }
    }
    case 'vat': {
      keys(where, c, [...common, 'in'], ['id', 'title', 'refs', 'out', 'in'])
      if (!isObj(out)) {
        fail(`${where}.out`, '맵이어야 한다')
        return null
      }
      keys(`${where}.out`, out, ['supply', 'vat'], ['supply', 'vat'])
      const amount = intAtLeast(`${where}.in`, c.in, 1)
      const split = splitVat(amount)
      return { id, kind, actual: { supply: split.supply, vat: split.vat }, expected: out }
    }
    case 'bizno': {
      keys(where, c, [...common, 'in'], ['id', 'title', 'refs', 'out', 'in'])
      if (typeof c.in !== 'string') fail(`${where}.in`, '글이어야 한다')
      if (!isObj(out)) {
        fail(`${where}.out`, '맵이어야 한다')
        return null
      }
      if (Object.hasOwn(out, 'ok')) {
        keys(`${where}.out`, out, ['ok'], ['ok'])
        if (typeof out.ok !== 'string' || !/^\d{3}-\d{2}-\d{5}$/.test(out.ok)) fail(`${where}.out.ok`, "'XXX-XX-XXXXX'")
      } else {
        keys(`${where}.out`, out, ['error'], ['error'])
        oneOf(`${where}.out.error`, out.error, ['FORMAT', 'CHECKSUM'])
      }
      const parsed = parseBizno(typeof c.in === 'string' ? c.in : '')
      return { id, kind, actual: { ...parsed } as Obj, expected: out }
    }
  }
}

function loadAll(): { files: string[]; ran: Ran[] } {
  const files = readdirSync(DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const ran: Ran[] = []
  const seen = new Map<string, string>()
  for (const file of files) {
    const doc = JSON.parse(readFileSync(`${DIR}${file}`, 'utf8')) as Json
    if (!isObj(doc)) {
      fail(file, '파일은 JSON 객체여야 한다')
      continue
    }
    keys(file, doc, ['kind', 'about', 'cases'], ['kind', 'about', 'cases'])
    const kind = oneOf(`${file}.kind`, doc.kind, KINDS)
    if (!Array.isArray(doc.cases)) {
      fail(`${file}.cases`, '목록이어야 한다')
      continue
    }
    doc.cases.forEach((c, i) => {
      const where = `${file} cases[${String(i)}]`
      if (!isObj(c)) {
        fail(where, '맵이어야 한다')
        return
      }
      if (typeof c.id !== 'string' || !/^G-BIL-\d{3}$/.test(c.id)) fail(`${where}.id`, "'G-BIL-' + 세 자리")
      else if (seen.has(c.id)) fail(`${where}.id`, `중복 ID (처음: ${seen.get(c.id) ?? ''})`)
      else seen.set(c.id, where)
      const result = runCase(kind, where, c)
      if (result !== null) ran.push(result)
    })
  }
  return { files, ran }
}

const loaded = loadAll()
const originalTz = process.env.TZ
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe('요금 골든 (AC-N5-01~05)', () => {
  it('읽기 오류가 없다 (모르는 kind·키·열거값·중복 ID)', () => {
    expect(problems).toEqual([])
  })

  // D-PL1-08: granted.json(G-BIL-301~315)이 더해져 파일 4 → 5, 사례 67 → 82
  it('파일 5 · 사례 82 (status 26 · payment 21 · vat 7 · bizno 13 · granted 15)', () => {
    expect(loaded.files).toEqual(['bizno.json', 'granted.json', 'payment.json', 'status.json', 'vat.json'])
    const count = (kind: Kind) => loaded.ran.filter((item) => item.kind === kind).length
    expect({ total: loaded.ran.length, status: count('status'), payment: count('payment'), vat: count('vat'), bizno: count('bizno'), granted: count('granted') }).toEqual({
      total: 82,
      status: 26,
      payment: 21,
      vat: 7,
      bizno: 13,
      granted: 15,
    })
  })

  it.each(loaded.ran.map((item) => [item.id, item] as const))('%s', (_id, item) => {
    expect(item.actual).toEqual(item.expected)
  })

  it('결정성 — 같은 입력 두 번·TZ 셋에서 같은 출력 (AC-N5-05)', () => {
    const outputs: string[] = []
    for (const tz of ['Pacific/Honolulu', 'Asia/Seoul', 'UTC', 'Pacific/Honolulu']) {
      process.env.TZ = tz
      const before = problems.length
      const again = loadAll()
      expect(problems.length).toBe(before)
      outputs.push(JSON.stringify(again.ran.map((item) => [item.id, item.actual])))
    }
    expect(new Set(outputs).size).toBe(1)
    expect(outputs[0]).toBe(JSON.stringify(loaded.ran.map((item) => [item.id, item.actual])))
    // granted도 TZ 세 가지 결정성 검사에 든다 (AC-PL1B-20)
    expect(loaded.ran.filter((item) => item.kind === 'granted')).toHaveLength(15)
  })
})
