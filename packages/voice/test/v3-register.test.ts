// V3 음성 바로 등록 (R-17 3·4·5·7·8, R-22, D-V3-01~D-V3-12) — 골든 tests/golden/voice-register/*.json 러너 + 실제 방송 문장 단위 시험.
// 골든 폴더의 모든 *.json을 읽어 kind에 맞는 함수로 돌리고 out과 깊은 같음으로 비교한다. 모르는 키·kind·겹친 id·표 밖 열거값은 읽기 오류.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VARIETIES,
  createCard,
  decideForExisting,
  decideSameNumber,
  extractVoice,
  guessVariety,
  isBigChange,
  mergeSameNumberCards,
  prepareVoiceDictionary,
  readChunk,
  readRenumber,
  readSegments,
  readRegistration,
  readyToRegister,
  touchCard,
  withObject,
  type SameNumberInput,
  type SuggestionCard,
} from '../src/index.ts'

const GOLDEN_DIR = fileURLToPath(new URL('../../../tests/golden/voice-register/', import.meta.url))
/** V3 고정값 (README "음성 바로 등록 골든": 파일 3 · 사례 124 — variety-guess 42 · same-number 58 · renumber 24 (D-V3-68로 seller-note 없앰), D-V3-22 (c)) */
const EXPECTED_FILES = 3
const EXPECTED_CASES = 124

const FILE_KEYS = new Set(['kind', 'about', 'cases'])
const CASE_KEYS = new Set(['id', 'title', 'refs', 'note', 'in', 'out'])
const ID_PATTERN = /^G-(VGS|VSN|VRN)-[A-Z0-9]+-[0-9]{2}$/
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const fail = (where: string, message: string): never => {
  throw new Error(`${where}: ${message}`)
}
const onlyKeys = (where: string, value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!isObject(value)) return fail(where, '객체가 아니다')
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(where, `모르는 키 ${key}`)
  return value
}
const STATUSES = ['READY', 'OPEN', 'SOLD', 'HOLD', 'CLOSED']
const NAME_FROM = ['DICTIONARY', 'GUESS', null]

interface Loaded {
  readonly id: string
  readonly kind: 'variety-guess' | 'same-number' | 'renumber'
  readonly input: Record<string, unknown>
  readonly out: unknown
}

function load(): Loaded[] {
  const files = readdirSync(GOLDEN_DIR).filter((file) => file.endsWith('.json')).sort()
  expect(files).toHaveLength(EXPECTED_FILES)
  const ids = new Set<string>()
  const cases: Loaded[] = []
  for (const file of files) {
    const doc = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8')) as unknown
    if (!isObject(doc)) fail(file, '객체가 아니다')
    const root = doc as Record<string, unknown>
    for (const key of Object.keys(root)) if (!FILE_KEYS.has(key)) fail(file, `모르는 키 ${key}`)
    const kind = root.kind
    if (kind !== 'variety-guess' && kind !== 'same-number' && kind !== 'renumber') return fail(file, `모르는 kind ${String(kind)}`)
    if (!Array.isArray(root.cases)) fail(file, 'cases가 배열이 아니다')
    for (const item of root.cases as unknown[]) {
      if (!isObject(item)) fail(file, '사례가 객체가 아니다')
      const c = item as Record<string, unknown>
      for (const key of Object.keys(c)) if (!CASE_KEYS.has(key)) fail(file, `모르는 사례 키 ${key}`)
      const id = c.id
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) return fail(file, `id ${String(id)}`)
      if (ids.has(id)) fail(file, `겹친 id ${id}`)
      ids.add(id)
      if (!Array.isArray(c.refs) || c.refs.length === 0) fail(id, 'refs')
      if (kind === 'renumber') {
        const input = onlyKeys(id, c.in, ['text', 'maxNumber'])
        if (typeof input.text !== 'string') fail(id, 'text')
        if (c.out !== null) {
          const out = onlyKeys(id, c.out, ['from', 'to'])
          if (!(out.from === null || typeof out.from === 'number') || typeof out.to !== 'number') fail(id, 'out')
        }
        cases.push({ id, kind, input, out: c.out })
      } else if (kind === 'variety-guess') {
        const input = onlyKeys(id, c.in, ['text', 'maxNumber'])
        if (typeof input.text !== 'string') fail(id, 'text')
        const out = onlyKeys(id, c.out, ['guess'])
        if (!('guess' in out) || !(out.guess === null || (typeof out.guess === 'string' && out.guess !== ''))) fail(id, 'out.guess')
        cases.push({ id, kind, input, out })
      } else {
        const input = onlyKeys(id, c.in, ['heard', 'product', 'auto', 'recent', 'otherDevice'])
        if (!(input.recent === undefined || typeof input.recent === 'boolean')) fail(id, 'recent')
        if (!(input.otherDevice === undefined || typeof input.otherDevice === 'boolean')) fail(id, 'otherDevice')
        const heard = onlyKeys(id, input.heard, ['price', 'priceSure', 'name', 'nameFrom', 'numberFrom'])
        if (!['MARKER', 'BARE', undefined].includes(heard.numberFrom as string | undefined)) fail(id, 'numberFrom')
        const product = onlyKeys(id, input.product, ['name', 'price', 'status', 'liveClaims'])
        if (!NAME_FROM.includes(heard.nameFrom as string | null)) fail(id, 'nameFrom')
        if (!STATUSES.includes(product.status as string)) fail(id, 'status')
        if (typeof input.auto !== 'boolean') fail(id, 'auto')
        const out = onlyKeys(id, c.out, ['action', 'changes', 'reason'])
        if (!['IGNORE', 'AUTO_FIX', 'ASK'].includes(out.action as string)) fail(id, 'action')
        if (![null, 'NO_AUTO', 'NUMBER_BARE', 'NOT_OPEN', 'PRICE_NOT_SURE', 'MAYBE_OTHER', 'NOT_RECENT'].includes(out.reason as string | null)) fail(id, 'reason')
        onlyKeys(id, out.changes, ['price', 'name'])
        cases.push({ id, kind, input, out })
      }
    }
  }
  expect(cases).toHaveLength(EXPECTED_CASES)
  return cases
}

describe('골든 voice-register (R-17 7·R-22)', () => {
  const cases = load()
  it.each(cases.map((item) => [item.id, item] as const))('%s', (_, item) => {
    if (item.kind === 'renumber') {
      const maxNumber = item.input.maxNumber
      expect(readRenumber(item.input.text, typeof maxNumber === 'number' ? { maxNumber } : {})).toEqual(item.out)
    } else if (item.kind === 'variety-guess') {
      const maxNumber = item.input.maxNumber
      expect({ guess: guessVariety(item.input.text, typeof maxNumber === 'number' ? { maxNumber } : {}) }).toEqual(item.out)
    } else {
      expect(decideSameNumber(item.input as unknown as SameNumberInput)).toStrictEqual(item.out)
    }
  })
})

// ── 실제 방송 문장 (harness/sprints/V3/real-broadcast.txt, 크롬 인식 그대로) ──

const DICT = prepareVoiceDictionary()
const read = (text: string) => readRegistration(text, { dictionary: DICT })

describe('실제 방송 문장 → 바로 등록 (기본 사전)', () => {
  it('1. 108번 bts 10만 원까지 → 108 · 100,000원 · 추측 bts는 한 번만 나와 품종 없음(실방송 3차 — 추측은 두 번 이상 나올 때만)', () => {
    const text = '네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요'
    expect(readyToRegister(text, { dictionary: DICT })).toEqual({ no: 108, price: 100000, name: null, nameNeedsCheck: false, numberFrom: 'marker' })
  })
  it('2. 10만 원 108번(끝) → 108 · 100,000원 · 품종 미입력, 후보 bts(두 번 나온 낱말)', () => {
    const r = readyToRegister('자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번', { dictionary: DICT })
    // D-V3-37: 추측(bts)은 등록 품종이 아니고 후보 단추용 guess로만
    expect(r).toEqual({ no: 108, price: 100000, name: null, nameNeedsCheck: false, numberFrom: 'marker' })
    expect(readRegistration('자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번', { dictionary: DICT }).guess).toBe('bts')
  })
  it('3. 180번 … 30 5만 원 → 180 · 350,000원 · 삼광색금', () => {
    const text = '자 180번 상관 세금 자 요 아이 자 유아이 35만 원까지 네 요 아이는 35만 원까지 그대로 봅니다 색금 이렇게 잘 들었어요 자 3강색급 요 아이는 30 5만 원'
    expect(readyToRegister(text, { dictionary: DICT })).toEqual({ no: 180, price: 350000, name: '삼광색금', nameNeedsCheck: false, numberFrom: 'marker' })
  })
  it('4. 28만 원 174번 … 174(번 없음) → 174 · 280,000원 · 삼광색금', () => {
    const text = '자 파이텐트까지 나오는 상강색 게임 잘 들었어요 자 상강 색금 자 요 아이 자 28만 원 174번 자 174 자 이거 28만 원 자 3강색은 요 아이 28마리까지'
    expect(readyToRegister(text, { dictionary: DICT })).toEqual({ no: 174, price: 280000, name: '삼광색금', nameNeedsCheck: false, numberFrom: 'marker' })
  })
  it("5. '3번'이 말 그대로 있음 → 3 · 250,000원 (스펙 R-17 8대로 확정 — 판매자 뜻은 170번일 수 있어 되돌리기로 고친다, D-V3-20)", () => {
    const text = '자 9cm에 자 9cm에 3번 자 3강 세금 뿌리 다 남았고요 얘는 자 25만 원 170 자 요런 색금 예쁘게 나왔습니다 이거 25만 원 3강 세금 170 자 이 703강 세금이 자 25만 원까지'
    const r = read(text)
    expect(r.extraction.no).toBe(3)
    expect(r.extraction.price).toBe(250000)
    expect(r.extraction.name).toBe('삼광색금')
  })
  it('6. 189번 … 139번 → 번호 비움, 바로 등록 안 함, 들린 번호 둘', () => {
    const r = read('어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요')
    expect(r.ready).toBeNull()
    expect(r.extraction.no).toBeNull()
    expect(r.extraction.price).toBe(500000)
    expect(r.extraction.name).toBe('빅뱅금')
    expect(r.heardNumbers).toEqual([189, 139])
  })
  it('7. 일육팔 삼광색금 이십오만 원 → 168 · 250,000원 · 삼광색금', () => {
    expect(readyToRegister('일육팔 삼광색금 이십오만 원', { dictionary: DICT })).toEqual({ no: 168, price: 250000, name: '삼광색금', nameNeedsCheck: false, numberFrom: 'bare' })
  })
  it("'요 아이'를 적은 ui·UI·유아이·요아이는 품종 후보가 아니다", () => {
    expect(readyToRegister('자 ui 삼광색금 180번 35만 원', { dictionary: DICT })).toEqual({ no: 180, price: 350000, name: '삼광색금', nameNeedsCheck: false, numberFrom: 'marker' })
    for (const filler of ['ui는', 'UI는', '유아이는', '요아이가', '요 아이는']) {
      const r = readyToRegister(`180번 ${filler} 35만 원`, { dictionary: DICT })
      expect(r).toEqual({ no: 180, price: 350000, name: null, nameNeedsCheck: false, numberFrom: 'marker' })
    }
  })
})

describe('확정 읽기 (R-17 8) — 중간 결과', () => {
  it("'원'이 들리기 전에는 확정이 아니다", () => {
    expect(readyToRegister('108번 bts 10만', { dictionary: DICT })).toBeNull()
    expect(readyToRegister('108번 30 5만', { dictionary: DICT })).toBeNull()
    expect(readyToRegister('bts 10만 원', { dictionary: DICT })).toBeNull()
    expect(readyToRegister('108번 bts 10만 원', { dictionary: DICT })).toEqual({ no: 108, price: 100000, name: null, nameNeedsCheck: false, numberFrom: 'marker' })
  })
  it('원 없는 가격(묶음)만으로는 확정이 아니다', () => {
    const r = read('15번 라울 만오천')
    expect(r.extraction.price).toBe(15000)
    expect(r.priceSure).toBe(false)
    expect(r.ready).toBeNull()
  })
  it('정정·취소 낱말이 있으면 확정하지 않는다(칸 이름은 막지 않는다)', () => {
    expect(readyToRegister('15번 라울 만 원 아니 2만 원', { dictionary: DICT })).toBeNull()
    expect(readyToRegister('15번 취소 만 원', { dictionary: DICT })).toBeNull()
    expect(readyToRegister('15번 품종은 라울 만 원', { dictionary: DICT })).toMatchObject({ no: 15, price: 10000 })
  })
  it('자리 읽기: 일 육 팔 / 1 6 8 / 일육팔번', () => {
    // D-V3-27: 띄어 쓴 한글 한 글자 셋은 '번'이 붙을 때만 번호
    expect(extractVoice('일 육 팔 이십오만 원').no).toBeNull()
    expect(extractVoice('이 삼 일번 만 원')).toMatchObject({ no: 231, price: 10000 })
    expect(extractVoice('1 6 8 이십오만 원')).toMatchObject({ no: 168, price: 250000 })
    expect(extractVoice('일육팔번 만 원')).toMatchObject({ no: 168, price: 10000 })
    expect(extractVoice('1 6 8번 만 원')).toMatchObject({ no: 168, price: 10000 })
    // 번호 표시가 따로 있으면 번 없는 자리 읽기는 보지 않는다
    expect(extractVoice('일육팔 15번 만 원')).toMatchObject({ no: 15, price: 10000 })
    // 두 자리·네 자리는 아니다
    expect(extractVoice('일오 만 원').no).toBeNull()
    expect(extractVoice('1 6 8 9 만 원').no).toBeNull()
  })
})

describe('음성 같은 번호 — 화면용 decideForExisting', () => {
  const product = { no: 108, name: 'bts', price: 100000, claimCount: 0 }
  it('같으면 IGNORE, 품종 없음·가격 같음도 IGNORE', () => {
    expect(decideForExisting(product, { name: 'bts', price: 100000, nameNeedsCheck: true })).toEqual({ kind: 'IGNORE' })
    expect(decideForExisting(product, { name: null, price: 100000 })).toEqual({ kind: 'IGNORE' })
  })
  it('찜 0이면 가격·품종 바로 고침 (바뀌는 칸만)', () => {
    expect(decideForExisting(product, { name: null, price: 120000 })).toEqual({ kind: 'AUTO_FIX', price: 120000, name: null })
    expect(decideForExisting(product, { name: '삼광색금', price: 100000 })).toEqual({ kind: 'AUTO_FIX', price: null, name: '삼광색금' })
  })
  it('추측 품종은 있는 품종을 덮지 않는다', () => {
    expect(decideForExisting({ ...product, name: '삼광색금' }, { name: '상관', price: 100000, nameNeedsCheck: true })).toEqual({ kind: 'IGNORE' })
  })
  // D-V3-55·57: 'N번' + '원' 확정이면 찜이 있어도 바로 고친다(품종만이면 FILL_NAME, 가격이 바뀌면 AUTO_FIX)
  it('찜이 있어도: 품종만 사전 이름으로 바뀌면 FILL_NAME, 가격이 바뀌면 AUTO_FIX', () => {
    const claimed = { ...product, name: '', claimCount: 2 }
    expect(decideForExisting(claimed, { name: '삼광색금', price: 100000 })).toEqual({ kind: 'FILL_NAME', name: '삼광색금' })
    expect(decideForExisting(claimed, { name: null, price: 90000 })).toEqual({ kind: 'AUTO_FIX', price: 90000, name: null })
    expect(decideForExisting({ ...product, claimCount: 1 }, { name: '삼광색금', price: 100000 })).toEqual({ kind: 'FILL_NAME', name: '삼광색금' })
  })
})

describe('열린 카드 합치기', () => {
  const card = (id: string, no: number | null, name: string | null, price: number | null, createdAt: number): SuggestionCard => {
    const made = createCard({ id, extraction: { no, name, price, confidence: 'LOW' }, text: '', createdAt })
    if (made === null) throw new Error('카드 없음')
    return made
  }
  it('같은 번호 열린 카드는 새 카드에 빈 칸을 채우고 옛 카드를 닫는다', () => {
    const cards = [card('b', 108, null, 100000, 2), card('a', 108, 'bts', null, 1), card('c', 5, null, 5000, 0)]
    const merged = mergeSameNumberCards(cards)
    expect(merged.map((item) => [item.id, item.status, item.name, item.price])).toEqual([
      ['b', 'OPEN', 'bts', 100000],
      ['a', 'CLOSED', 'bts', null],
      ['c', 'OPEN', null, 5000],
    ])
    expect(cards[0]?.name).toBeNull()
  })
  it('손댄 카드가 남는다', () => {
    const cards = [card('b', 108, null, 100000, 2), touchCard(card('a', 108, 'bts', null, 1))]
    expect(mergeSameNumberCards(cards).map((item) => [item.id, item.status, item.price])).toEqual([
      ['b', 'CLOSED', 100000],
      ['a', 'OPEN', 100000],
    ])
  })
})

describe("'번' 없는 번호 (V3 사용자 추가 요구: 'N번' > '번' 없는 번호)", () => {
  const ready = (text: string) => readyToRegister(text, { dictionary: DICT })
  it('한글 수·숫자·자리 읽기·끝말 붙은 꼴', () => {
    expect(ready('백육십팔 삼광색금 이십오만 원')).toEqual({ no: 168, price: 250000, name: '삼광색금', nameNeedsCheck: false, numberFrom: 'bare' })
    expect(ready('168 삼광색금 25만 원')).toEqual({ no: 168, price: 250000, name: '삼광색금', nameNeedsCheck: false, numberFrom: 'bare' })
    expect(ready('일육팔은 25만 원')).toMatchObject({ no: 168, price: 250000 })
    expect(ready('168은 25만 원')).toMatchObject({ no: 168, price: 250000 })
    expect(ready('108 bts 10만 원')).toEqual({ no: 108, price: 100000, name: null, nameNeedsCheck: false, numberFrom: 'bare' })
  })
  it('단위가 붙거나 한글이 붙은 수는 번호가 아니다', () => {
    // 실방송 3차: 원 가격 줄 뒤에 온 '번' 없는 번호는 다음 상품 번호일 수 있어 카드만 (D-V3-23 사례 — 스펙 판정 대기)
    expect(readyToRegister('자 9cm에 이거 25만 원 170', { dictionary: DICT, final: true })).toBeNull()
    expect(readRegistration('자 9cm에 이거 25만 원 170', { dictionary: DICT, final: true })).toMatchObject({ blocked: 'BARE_NUMBER_AFTER_PRICE', extraction: { no: 170, price: 250000 } })
    // D-V3-26: 중간 결과(final 생략) 끝의 '번' 없는 번호는 다음 낱말·최종 결과까지 기다린다. 'N번'은 글 끝이어도 바로
    expect(ready('자 9cm에 이거 25만 원 170')).toBeNull()
    expect(ready('25만 원 1')).toBeNull()
    expect(ready('25만 원 이십')).toBeNull()
    // 다음 낱말이 와도 원 가격 줄 뒤의 '번' 없는 번호라 카드만 (실방송 3차)
    expect(readRegistration('25만 원 이십 라울', { dictionary: DICT })).toMatchObject({ ready: null, blocked: 'BARE_NUMBER_AFTER_PRICE', extraction: { no: 20 } })
    expect(ready('25만 원 108번')).toMatchObject({ no: 108, price: 250000 })
    expect(read('삼광색금 3강 25만 원').extraction).toMatchObject({ no: null, price: 250000, name: '삼광색금' })
    expect(read('삼광색금 3 개 25만 원').extraction.no).toBeNull()
    expect(read('삼광색금 28 마리 25만 원').extraction.no).toBeNull()
    expect(read('이 아이 25만 원').extraction.no).toBeNull()
  })
  it("가격 줄은 자리가 내려갈 때만 합친다 — 170 25만 원 → 170번 250,000원, 30 5만 원 → 350,000원", () => {
    expect(ready('170 25만 원')).toMatchObject({ no: 170, price: 250000 })
    expect(ready('108번 30 5만 원')).toMatchObject({ no: 108, price: 350000 })
    // 'N번'이 있으면 줄에서 빠진 수를 설명할 수 없어 가격이 애매하다 (골든 voice-extract '15번 라울 174 28만 원')
    expect(read('15번 라울 174 28만 원').extraction.price).toBeNull()
  })
  it("'번' 없는 번호가 서로 다르면 비우고, 같은 수 되풀이는 하나", () => {
    const r = read('168 삼광색금 170 25만 원')
    expect(r.extraction.no).toBeNull()
    expect(r.heardNumbers).toEqual([168, 170])
    expect(r.ready).toBeNull()
    expect(ready('168 삼광색금 168 25만 원')).toMatchObject({ no: 168, price: 250000 })
  })
  it("'N번'이 있으면 그것을 쓴다 (실제 방송 5: 3번)", () => {
    expect(ready('170 자 3번 25만 원')).toMatchObject({ no: 3, price: 250000 })
  })
})

describe('적대 지적 TD-V3-001·002', () => {
  it.each(['일육팔에 25만 원', '일육팔까지 25만 원', '일육팔이에요 25만 원', '일육팔 개 25만 원', '일 육 팔 개 25만 원', '일육팔 마리 25만 원', '택배는 이 삼 일 걸리고 만 원이에요'])('%s → 번호 없음', (text) => {
    expect(read(text).extraction.no).toBeNull()
    expect(read(text).ready).toBeNull()
  })
  it.each(['100 5만 원', '이백 오만 원', '육백 삼만원', '자 300 2만 원'])('%s → 자리가 안 겹치는데 안 읽힘 → 가격·번호 비움', (text) => {
    expect(read(text).extraction).toMatchObject({ no: null, price: null })
  })
  it('자리 겹침이면 뗀다: 170 25만 원, 174 28만 원(번호 표시 없음)', () => {
    expect(read('170 25만 원').extraction).toMatchObject({ no: 170, price: 250000 })
    expect(read('174 28만 원').extraction).toMatchObject({ no: 174, price: 280000 })
  })
})

describe('실방송 3차 위험 사례 (판매자 안전)', () => {
  it('a) "… 65만 원까지 … 60 어 자" → 바로 등록 안 함, 품종 "나왔네" 아님', () => {
    const r = readRegistration('자 sp 참 다진노게임 자 요 아이는 65만 원까지 자 색감이 이렇게 예쁘게 나왔네요 자 60 어 자', { dictionary: DICT, final: true })
    expect(r.ready).toBeNull()
    expect(r.blocked).toBe('BARE_NUMBER_AFTER_PRICE')
    expect(r.safeGuess).toBeNull()
  })
  it('말끝 모양 낱말은 두 번 나와도 추측으로 쓰지 않는다', () => {
    expect(readRegistration('15번 나왔네 자 나왔네 만 원', { dictionary: DICT }).safeGuess).toBeNull()
    expect(readRegistration('15번 bts 자 bts 만 원', { dictionary: DICT }).safeGuess).toBe('bts')
  })
  // D-V3-64(사용자 "가격차이 커도 고칠건 자동으로 고쳐야지"): 가격 크기로 막지 않고 크게 바뀜 표시만 — 처음 기대(막음)를 바꿈
  it('b) "605만 원" → 바로 등록, 크게 바뀜 표시', () => {
    const r = readRegistration('38번 진등의 금이 잘 표현되고 ui 자 605만 원까지', { dictionary: DICT })
    expect(r.ready).toMatchObject({ no: 38, price: 6050000 })
    expect(r.blocked).toBeNull()
    expect(readSegments('38번 605만 원', { dictionary: DICT }).picks).toMatchObject([{ no: 38, price: 6050000, blocked: null, bigChange: true }])
    expect(readSegments('38번 300만 원', { dictionary: DICT }).picks).toMatchObject([{ price: 3000000, bigChange: false }])
  })
  const existing = { no: 38, name: '', price: 650000, claimCount: 0 }
  it('b) 추측 품종은 이미 있는 상품 품종을 채우지도 바꾸지도 않는다', () => {
    expect(decideForExisting(existing, { name: '설비', price: 650000, nameNeedsCheck: true })).toEqual({ kind: 'IGNORE' })
    expect(decideForExisting({ ...existing, claimCount: 2 }, { name: '나왔네', price: 650000, nameNeedsCheck: true })).toEqual({ kind: 'IGNORE' })
    expect(decideForExisting(existing, { name: '나왔네', price: 700000, nameNeedsCheck: true })).toEqual({ kind: 'AUTO_FIX', price: 700000, name: null })
    expect(decideForExisting(existing, { name: '창녹금', price: 650000 })).toEqual({ kind: 'AUTO_FIX', price: null, name: '창녹금' })
  })
  // D-V3-55·57: 묻는 것은 새 가격 300만 원 초과뿐 — 내림("62번 2만 원")·3배 넘는 올림(300만 원 이하)은 바로 고친다
  // D-V3-64: 300만 원 넘어도 바로 고치고 크게 바뀜 표시 (R-25: 새 가격 > 300만·3배 넘게 오름·1/3 미만 내림)
  it('b) 가격 크기와 상관없이 바로 고치고, 크게 바뀜이면 표시', () => {
    expect(decideForExisting(existing, { name: null, price: 6050000 })).toEqual({ kind: 'AUTO_FIX', price: 6050000, name: null, bigChange: true })
    expect(decideForExisting(existing, { name: null, price: 200000 })).toEqual({ kind: 'AUTO_FIX', price: 200000, name: null, bigChange: true })
    expect(decideForExisting(existing, { name: null, price: 300000 })).toEqual({ kind: 'AUTO_FIX', price: 300000, name: null })
    expect(decideForExisting(existing, { name: null, price: 1950000 })).toEqual({ kind: 'AUTO_FIX', price: 1950000, name: null })
    expect(decideForExisting(existing, { name: null, price: 1950001 })).toEqual({ kind: 'AUTO_FIX', price: 1950001, name: null, bigChange: true })
    expect(decideForExisting({ no: 62, name: '', price: 100000, claimCount: 0 }, { name: null, price: 20000 })).toEqual({ kind: 'AUTO_FIX', price: 20000, name: null, bigChange: true })
    expect(decideForExisting({ no: 62, name: '', price: 100000, claimCount: 3 }, { name: null, price: 34000 })).toEqual({ kind: 'AUTO_FIX', price: 34000, name: null })
  })
  it("'번' 없는 번호로 잡힌 같은 번호는 바로 고치지 않는다", () => {
    expect(decideForExisting(existing, { name: null, price: 650000, numberFrom: 'bare' })).toEqual({ kind: 'IGNORE' })
    expect(decideForExisting(existing, { name: null, price: 700000, numberFrom: 'bare' })).toEqual({ kind: 'ASK', price: 700000, name: null })
    expect(decideForExisting({ ...existing, claimCount: 1 }, { name: '창녹금', price: 650000, numberFrom: 'bare' })).toEqual({ kind: 'ASK', price: null, name: '창녹금' })
    expect(readRegistration('170 25만 원', { dictionary: DICT }).ready).toMatchObject({ no: 170, numberFrom: 'bare' })
  })
})

describe('TE-V3-001·004', () => {
  it('삼광색금 별칭은 AC-V3-05 목록 그대로이고, 들린 꼴이 모두 삼광색금', () => {
    const entry = DEFAULT_VARIETIES.find((item) => item.name === '삼광색금')
    expect(entry?.aliases).toEqual(['삼강색금', '삼강세금', '상강색금', '상관세금', '삼광세금'])
    for (const text of ['180번 3강 세금 35만 원', '180번 상관 세금 35만 원', '174번 상강 색금 28만 원', '180번 3강색급 35만 원']) {
      expect(readChunk(text, { dictionary: DICT }).name, text).toBe('삼광색금')
    }
  })
  it('실방송 3: 낱말을 늘려 넣어도 처음 확정 때 품종이 이미 삼광색금 (추측으로 먼저 등록하지 않음)', () => {
    const words = '자 180번 상관 세금 자 요 아이 자 유아이 35만 원까지 네 요 아이는 35만 원까지 그대로 봅니다 색금 이렇게 잘 들었어요 자 3강색급 요 아이는 30 5만 원'.split(' ')
    const first = words.map((_, k) => readyToRegister(words.slice(0, k + 1).join(' '), { dictionary: DICT })).find((item) => item !== null)
    expect(first).toEqual({ no: 180, price: 350000, name: '삼광색금', nameNeedsCheck: false, numberFrom: 'marker' })
  })
  it('목적격 조사: 받침 없는 로마자는 를', () => {
    expect(withObject('108번 bts')).toBe('108번 bts를')
    expect(withObject('15번 핑크문')).toBe('15번 핑크문을')
    expect(withObject('15번 라울')).toBe('15번 라울을')
    expect(withObject('12번 루비')).toBe('12번 루비를')
    expect(withObject('3번 GTM')).toBe('3번 GTM을')
    expect(withObject('7번')).toBe('7번을')
  })
})

describe('AC-V3-70 크게 바뀜 판단 (R-25, 정수 비교)', () => {
  it('등록: 3,000,001원 표시, 3,000,000원 아님 / 고침: 100,000 → 300,001 표시, 300,000 아님, 33,333 표시, 34,000 아님', () => {
    expect(isBigChange(null, 3000001)).toBe(true)
    expect(isBigChange(null, 3000000)).toBe(false)
    expect(isBigChange(100000, 300001)).toBe(true)
    expect(isBigChange(100000, 300000)).toBe(false)
    expect(isBigChange(100000, 33333)).toBe(true)
    expect(isBigChange(100000, 34000)).toBe(false)
    expect(isBigChange(1000000, 3000001)).toBe(true)
  })
})
