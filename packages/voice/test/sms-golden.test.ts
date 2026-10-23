// AC-V1-01 음성 문자찜 골든 (tests/golden/voice/*.json — README "음성 문자찜 골든").
// 이 폴더의 모든 *.json을 읽어 readSmsSentence로 돌리고 out과 깊은 같음으로 비교한다.
// 모르는 키·모르는 kind·겹친 id는 읽기 오류(시험 실패)이고, 파일 수·사례 수 합계를 고정값으로 단언한다 — 미구현을 허용하는 장치가 없다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readSmsSentence, type SmsReadOptions } from '../src/index.ts'

const GOLDEN_DIR = fileURLToPath(new URL('../../../tests/golden/voice/', import.meta.url))
/** V1 고정값 — 다음 스프린트가 사례를 더하면 이 값도 함께 바꾼다 */
const EXPECTED_FILES = 1
const EXPECTED_CASES = 63

const FILE_KEYS = new Set(['kind', 'about', 'cases'])
const CASE_KEYS = new Set(['id', 'title', 'refs', 'note', 'in', 'settings', 'catalog', 'focus', 'out'])
const SETTINGS_KEYS = new Set(['parseMode', 'maxNumber', 'maxQuantity'])
const OUT_KEYS = ['orders', 'last4', 'name', 'time', 'problem']
const ORDER_KEYS = new Set(['no', 'options', 'qty'])
const PROBLEMS = new Set([null, 'CANCEL', 'NOT_SURE', 'LAST4_UNCLEAR', 'NAME_UNCLEAR', 'TIME_UNCLEAR', 'NUMBER_UNCLEAR', 'OPTION_UNCLEAR'])
const ID_PATTERN = /^G-VSM-[A-Z0-9]+-[0-9]{2}$/

interface GoldenCase {
  readonly file: string
  readonly id: string
  readonly title: string
  readonly input: string
  readonly options: SmsReadOptions
  readonly out: unknown
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function fail(file: string, where: string, message: string): never {
  throw new Error(`${file} ${where}: ${message}`)
}

function checkOut(file: string, id: string, out: unknown): void {
  if (out === null) return
  if (!isObject(out)) fail(file, id, 'out은 null 또는 객체여야 한다')
  const keys = Object.keys(out)
  if (keys.length !== OUT_KEYS.length || !OUT_KEYS.every((key) => keys.includes(key))) fail(file, id, `out 키는 정확히 ${OUT_KEYS.join(', ')}`)
  if (!Array.isArray(out['orders'])) fail(file, id, 'orders는 배열')
  for (const order of out['orders'] as unknown[]) {
    if (!isObject(order) || Object.keys(order).some((key) => !ORDER_KEYS.has(key))) fail(file, id, `모르는 주문 키: ${JSON.stringify(order)}`)
  }
  if (!PROBLEMS.has(out['problem'] as string | null)) fail(file, id, `모르는 problem: ${String(out['problem'])}`)
  if (out['last4'] !== null && !(typeof out['last4'] === 'string' && /^[0-9]{4}$/.test(out['last4']))) fail(file, id, 'last4는 숫자 4개 문자열 또는 null')
}

function loadGolden(): { files: number; cases: GoldenCase[] } {
  const names = readdirSync(GOLDEN_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const cases: GoldenCase[] = []
  const ids = new Set<string>()
  for (const name of names) {
    const data: unknown = JSON.parse(readFileSync(join(GOLDEN_DIR, name), 'utf8'))
    if (!isObject(data)) fail(name, '파일', '객체가 아니다')
    for (const key of Object.keys(data)) if (!FILE_KEYS.has(key)) fail(name, '파일', `모르는 키: ${key}`)
    if (data['kind'] !== 'voice-sms') fail(name, '파일', `모르는 kind: ${String(data['kind'])}`)
    if (!Array.isArray(data['cases'])) fail(name, '파일', 'cases는 배열')
    for (const item of data['cases'] as unknown[]) {
      if (!isObject(item)) fail(name, '사례', '객체가 아니다')
      const id = item['id']
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail(name, String(id), 'id 형식')
      if (ids.has(id)) fail(name, id, '겹친 id')
      ids.add(id)
      for (const key of Object.keys(item)) if (!CASE_KEYS.has(key)) fail(name, id, `모르는 키: ${key}`)
      if (typeof item['title'] !== 'string') fail(name, id, 'title')
      if (!Array.isArray(item['refs']) || item['refs'].length === 0) fail(name, id, 'refs는 1개 이상')
      if (typeof item['in'] !== 'string') fail(name, id, 'in은 문자열')
      if (!Object.hasOwn(item, 'out')) fail(name, id, 'out이 없다')
      const settings = item['settings'] ?? {}
      if (!isObject(settings)) fail(name, id, 'settings는 객체')
      for (const key of Object.keys(settings)) if (!SETTINGS_KEYS.has(key)) fail(name, id, `모르는 설정 키: ${key}`)
      const optionsMode = settings['parseMode'] === 'OPTIONS'
      if (optionsMode && (!Array.isArray(item['catalog']) || !Object.hasOwn(item, 'focus'))) fail(name, id, '옵션 방식은 catalog·focus가 필요하다')
      if (!optionsMode && (Object.hasOwn(item, 'catalog') || Object.hasOwn(item, 'focus'))) fail(name, id, 'catalog·focus는 옵션 방식에만')
      checkOut(name, id, item['out'])
      const options: SmsReadOptions = {
        ...(settings as SmsReadOptions),
        ...(optionsMode ? { catalog: item['catalog'] as SmsReadOptions['catalog'], focus: item['focus'] as SmsReadOptions['focus'] } : {}),
      }
      cases.push({ file: name, id, title: item['title'], input: item['in'], options, out: item['out'] })
    }
  }
  return { files: names.length, cases }
}

const golden = loadGolden()

describe('AC-V1-01 음성 문자찜 골든 (tests/golden/voice)', () => {
  it(`파일 ${String(EXPECTED_FILES)} · 사례 ${String(EXPECTED_CASES)} (고정값)`, () => {
    expect(golden.files).toBe(EXPECTED_FILES)
    expect(golden.cases).toHaveLength(EXPECTED_CASES)
  })

  it.each(golden.cases.map((item) => [item.id, item.title, item] as const))('%s %s', (_id, _title, item) => {
    const before = JSON.stringify(item.options)
    expect(readSmsSentence(item.input, item.options)).toEqual(item.out)
    // 키까지 정확히 (toEqual은 undefined 키를 무시하므로 글로도 비교 — options가 없어야 할 주문에 options 키가 없게)
    expect(JSON.parse(JSON.stringify(readSmsSentence(item.input, item.options)))).toStrictEqual(item.out)
    if (item.out !== null) expect(Object.keys(readSmsSentence(item.input, item.options) as object)).toEqual(Object.keys(item.out as object))
    // 넘긴 값을 바꾸지 않는다
    expect(JSON.stringify(item.options)).toBe(before)
  })
})

describe('AC-V1-01 골든 읽기 오류 검사기 자체', () => {
  it('모르는 키·kind·겹친 id는 읽기 오류다 (검사 함수가 던진다)', () => {
    expect(() => checkOut('x.json', 'G-VSM-V1-99', { orders: [], last4: null, name: null, time: null })).toThrow()
    expect(() => checkOut('x.json', 'G-VSM-V1-99', { orders: [{ no: 1, qty: 1, extra: 1 }], last4: null, name: null, time: null, problem: null })).toThrow()
    expect(() => checkOut('x.json', 'G-VSM-V1-99', { orders: [], last4: '123', name: null, time: null, problem: null })).toThrow()
    expect(() => checkOut('x.json', 'G-VSM-V1-99', { orders: [], last4: null, name: null, time: null, problem: 'WHAT' })).toThrow()
  })
})
