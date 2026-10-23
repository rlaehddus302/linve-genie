// AC-A1-01 제안 골든 (tests/golden/assist/*.json, R-20 10, D-A1-02·05·06): 서버의 순수 함수(규칙 제안·응답 검사·가리기·호출 고르기)를 모든 사례로 돌려
// out과 깊은 같음으로 비교한다. 파일 수 5·사례 수 105를 고정값으로 단언하고, 모르는 kind·키·열거값이면 읽기 오류로 실패한다(미구현 허용 장치 없음).
// TZ를 바꿔 돌려도 같다 — 함수가 시계를 쓰지 않는다(아래 "TZ" 시험이 다른 시간대의 자식 프로세스로 다시 돌린다).
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OptionCatalogEntry } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { planAssist, redact, ruleSuggestion, validateResponse, type PlanInput } from '../src/assist/rules.ts'

const DIR = fileURLToPath(new URL('../../../tests/golden/assist/', import.meta.url))
const FILES = 5
const CASES = 105

const KINDS = new Set(['rule', 'validate', 'redact', 'plan'])
const REASONS = new Set(['OPTION_MISSING', 'OPTION_CONFLICT', 'UNKNOWN_WORD', 'QTY_INVALID', 'NUMBER_AMBIGUOUS', 'PRODUCT_AMBIGUOUS', 'MULTI_PRODUCT', 'FOCUS_CHANGED', 'STOCK_SHORT'])
const FILE_KEYS: Readonly<Record<string, readonly string[]>> = {
  rule: ['kind', 'about', 'settings', 'catalog', 'cases'],
  validate: ['kind', 'about', 'settings', 'catalog', 'cases'],
  redact: ['kind', 'about', 'cases'],
  plan: ['kind', 'about', 'cases'],
}
const CASE_KEYS: Readonly<Record<string, readonly string[]>> = {
  rule: ['text', 'review'],
  validate: ['items', 'response'],
  redact: ['in'],
  plan: ['in'],
}
const COMMON = ['id', 'title', 'refs', 'note', 'out']
const ID_RE = /^G-AST-A1-\d{3}$/

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

class ReadError extends Error {}
const fail = (where: string, what: string): never => {
  throw new ReadError(`${where}: ${what}`)
}
const onlyKeys = (where: string, value: Json, allowed: readonly string[], required: readonly string[] = []) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(where, `모르는 키 ${key}`)
  for (const key of required) if (!Object.hasOwn(value, key)) fail(where, `${key}가 없다`)
}

function checkSettings(where: string, value: unknown, keys: readonly string[]): Json {
  if (!isObj(value)) return fail(where, 'settings가 객체가 아니다')
  onlyKeys(where, value, keys)
  for (const key of Object.keys(value)) if (!Number.isSafeInteger(value[key])) fail(where, `settings.${key}가 정수가 아니다`)
  return value
}

function checkCatalog(where: string, value: unknown): OptionCatalogEntry[] {
  if (!Array.isArray(value)) return fail(where, 'catalog가 목록이 아니다')
  for (const entry of value) {
    if (!isObj(entry)) fail(where, 'catalog 항목이 객체가 아니다')
    onlyKeys(where, entry as Json, ['no', 'name', 'aliases', 'options'], ['no', 'name'])
    const options = (entry as Json).options
    if (options !== undefined) {
      if (!Array.isArray(options)) fail(where, 'options가 목록이 아니다')
      for (const item of options as unknown[]) {
        if (!isObj(item)) fail(where, '옵션 항목이 객체가 아니다')
        onlyKeys(where, item as Json, ['name', 'choices'], ['name', 'choices'])
        for (const choice of (item as Json).choices as unknown[]) {
          if (!isObj(choice)) fail(where, '선택지가 객체가 아니다')
          onlyKeys(where, choice as Json, ['label', 'aliases', 'price'], ['label'])
        }
      }
    }
  }
  return value as OptionCatalogEntry[]
}

function checkSuggestion(where: string, value: unknown): void {
  if (value === null) return
  if (!isObj(value)) return fail(where, '제안이 객체·null이 아니다')
  onlyKeys(where, value, ['no', 'options', 'qty'], ['no', 'qty'])
}

function checkReview(where: string, value: unknown): Json {
  if (!isObj(value)) return fail(where, 'review가 객체가 아니다')
  onlyKeys(where, value, ['reason', 'no', 'options', 'qty'], ['reason'])
  if (!REASONS.has(value.reason as string)) fail(where, `모르는 사유 ${String(value.reason)}`)
  return value
}

function checkPlanInput(where: string, value: unknown): PlanInput {
  if (!isObj(value)) return fail(where, 'in이 객체가 아니다')
  onlyKeys(where, value, ['enabled', 'hasKey', 'usedToday', 'dailyLimit', 'globalUsed', 'globalLimit', 'batchMax', 'items'], ['enabled', 'hasKey', 'usedToday', 'dailyLimit', 'globalUsed', 'globalLimit', 'batchMax', 'items'])
  for (const item of value.items as unknown[]) {
    if (!isObj(item)) fail(where, 'items 항목이 객체가 아니다')
    const row = item as Json
    onlyKeys(where, row, ['id', 'origin', 'reason', 'no', 'rule', 'cached', 'text'], ['id', 'origin', 'reason', 'no', 'rule', 'cached', 'text'])
    if (row.origin !== 'chat' && row.origin !== 'sms') fail(where, `모르는 origin ${String(row.origin)}`)
    if (!REASONS.has(row.reason as string)) fail(where, `모르는 사유 ${String(row.reason)}`)
  }
  return value as unknown as PlanInput
}

interface Loaded {
  readonly file: string
  readonly id: string
  readonly run: () => unknown
  readonly out: unknown
}

/** 파일을 읽어 사례마다 (실행, 기대)를 만든다 — 형식 계약 위반은 ReadError */
function load(): { files: string[]; cases: Loaded[] } {
  const files = readdirSync(DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const cases: Loaded[] = []
  const ids = new Set<string>()
  for (const file of files) {
    const doc = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as unknown
    if (!isObj(doc)) fail(file, '파일이 객체가 아니다')
    const json = doc as Json
    const kind = json.kind as string
    if (!KINDS.has(kind)) fail(file, `모르는 kind ${String(kind)}`)
    onlyKeys(file, json, FILE_KEYS[kind] as readonly string[], FILE_KEYS[kind] as readonly string[])
    const settings = kind === 'rule' ? checkSettings(file, json.settings, ['maxNumber', 'maxQuantity']) : kind === 'validate' ? checkSettings(file, json.settings, ['maxQuantity']) : {}
    const catalog = kind === 'rule' || kind === 'validate' ? checkCatalog(file, json.catalog) : []
    if (!Array.isArray(json.cases)) fail(file, 'cases가 목록이 아니다')
    for (const raw of json.cases as unknown[]) {
      if (!isObj(raw)) fail(file, '사례가 객체가 아니다')
      const c = raw as Json
      const where = `${file} ${String(c.id)}`
      onlyKeys(where, c, [...COMMON, ...(CASE_KEYS[kind] as readonly string[])], ['id', 'title', 'refs', 'out', ...(CASE_KEYS[kind] as readonly string[])])
      if (typeof c.id !== 'string' || !ID_RE.test(c.id)) fail(where, 'id 모양이 틀렸다')
      if (ids.has(c.id as string)) fail(where, 'id가 겹친다')
      ids.add(c.id as string)
      if (typeof c.title !== 'string' || !Array.isArray(c.refs) || c.refs.length === 0) fail(where, 'title·refs가 틀렸다')
      if (c.note !== undefined && typeof c.note !== 'string') fail(where, 'note가 글이 아니다')
      let run: () => unknown
      if (kind === 'rule') {
        const review = checkReview(where, c.review)
        if (typeof c.text !== 'string') fail(where, 'text가 글이 아니다')
        checkSuggestion(where, c.out)
        const parseSettings = { 'claim.maxNumber': settings.maxNumber as number, 'claim.maxQuantity': settings.maxQuantity as number }
        run = () => ruleSuggestion(c.text as string, review as never, catalog, parseSettings)
      } else if (kind === 'validate') {
        if (!Array.isArray(c.items)) fail(where, 'items가 목록이 아니다')
        for (const item of c.items as unknown[]) {
          if (!isObj(item)) fail(where, 'items 항목이 객체가 아니다')
          onlyKeys(where, item as Json, ['id', 'no'], ['id'])
        }
        if (typeof c.response !== 'string') fail(where, 'response가 글이 아니다')
        if (!isObj(c.out)) fail(where, 'out이 객체가 아니다')
        for (const value of Object.values(c.out as Json)) checkSuggestion(where, value)
        run = () => validateResponse(c.items as never, c.response, catalog, settings.maxQuantity as number)
      } else if (kind === 'redact') {
        if (typeof c.in !== 'string' || typeof c.out !== 'string') fail(where, 'in·out이 글이 아니다')
        run = () => redact(c.in as string)
      } else {
        const input = checkPlanInput(where, c.in)
        if (!isObj(c.out)) fail(where, 'out이 객체가 아니다')
        onlyKeys(where, c.out as Json, ['send'], ['send'])
        run = () => planAssist(input)
      }
      cases.push({ file, id: c.id as string, run, out: c.out })
    }
  }
  return { files, cases }
}

describe('AC-A1-01 제안 골든 105사례', () => {
  const loaded = load()

  it('파일 5개·사례 105개를 읽는다 (조용히 빠지면 실패)', () => {
    expect(loaded.files).toHaveLength(FILES)
    expect(loaded.cases).toHaveLength(CASES)
  })

  for (const c of loaded.cases) {
    it(`${c.id} (${c.file})`, () => {
      expect(c.run()).toEqual(c.out)
    })
  }

  it('같은 입력이면 같은 결과다 — 두 번 돌려도 같다', () => {
    for (const c of loaded.cases) expect(c.run()).toEqual(c.run())
  })

  it('모르는 kind·키·열거값은 읽기 오류다 (형식 검사 자체)', () => {
    expect(() => checkReview('x', { reason: 'WHAT' })).toThrow(ReadError)
    expect(() => onlyKeys('x', { id: 1, odd: 2 }, ['id'])).toThrow(ReadError)
    expect(() => checkPlanInput('x', { enabled: true, hasKey: true, usedToday: 0, dailyLimit: 1, globalUsed: 0, globalLimit: 1, batchMax: 1, items: [{ id: 'a', origin: 'mail', reason: 'UNKNOWN_WORD', no: null, rule: false, cached: false, text: '' }] })).toThrow(
      ReadError,
    )
    expect(() => checkSuggestion('x', { no: 1, qty: 1, why: '' })).toThrow(ReadError)
  })

  it('TZ를 바꿔 돌려도 같다 (다른 시간대의 자식 프로세스 — 사례마다 결과 해시가 같다)', () => {
    const probe = (tz: string) =>
      spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { env: { ...process.env, TZ: tz, A1_DIR: DIR }, encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) })
    const seoul = probe('Asia/Seoul')
    const ny = probe('America/New_York')
    expect(seoul.status, seoul.stderr).toBe(0)
    expect(ny.status, ny.stderr).toBe(0)
    expect(seoul.stdout).toBe(ny.stdout)
    expect(seoul.stdout.trim()).toMatch(/^[0-9a-f]{64}$/)
  })
})

/** 자식 프로세스: 모든 사례를 돌려 결과 전체의 해시를 찍는다 */
const CHILD = `
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const { planAssist, redact, ruleSuggestion, validateResponse } = await import(new URL('./src/assist/rules.ts', 'file://' + process.cwd() + '/').href)
const dir = process.env.A1_DIR
const out = []
for (const file of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
  const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  for (const c of doc.cases) {
    let r
    if (doc.kind === 'rule') r = ruleSuggestion(c.text, c.review, doc.catalog, { 'claim.maxNumber': doc.settings.maxNumber, 'claim.maxQuantity': doc.settings.maxQuantity })
    else if (doc.kind === 'validate') r = validateResponse(c.items, c.response, doc.catalog, doc.settings.maxQuantity)
    else if (doc.kind === 'redact') r = redact(c.in)
    else r = planAssist(c.in)
    out.push([c.id, r])
  }
}
process.stdout.write(createHash('sha256').update(JSON.stringify(out)).digest('hex') + '\\n')
`
