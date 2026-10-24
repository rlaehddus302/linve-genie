// FB1 적대 시험 (test-domain): 직접 입력 택배사 이름 = L-2 글 다듬기 (AC-FB1-15 회차 2·AC-FB1-89, D-FB1-16, PARCEL_RULES PC-1, LABEL_RULES L-2).
// - 저장된 이름에는 \p{Cc}·\p{Cf}·U+2028·U+2029가 하나도 없다
// - 저장된 이름 = 라벨 패키지 trimLabelText(입력) = 스펙 L-2 1~4를 따로 적은 기준 함수(빈 글이면 400 carrierName "택배사 이름을 적어 주세요.")
// - 글자 수(1~20 코드 포인트)는 다듬은 뒤에 센다
// - 무작위 \p{Cf} 글자만으로 된 이름 1,000개 → 모두 400, 저장값 그대로
// - 한글 채움 글자 등 서식 문자가 아닌 글자는 지우지 않는다(새 글자 표 없음 — D-036)
import { trimLabelText } from '@livejjim/label'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SENDER, dayRows, expect200, parcelApi, parcelSeller, parcelWorld, sell, type ParcelWorld } from '../../../apps/server/test/t1-support.ts'
import type { Seller } from '../../../apps/server/test/support.ts'

const EMPTY = '택배사 이름을 적어 주세요.'
const TOO_LONG = '택배사 이름은 20자까지 적어 주세요.'
const FORBIDDEN = /[\p{Cc}\p{Cf}\u2028\u2029]/u

/** 스펙 L-2 1~4를 그대로 적은 기준 함수 (제품 코드와 따로) */
function l2(value: string): string {
  let out = ''
  for (const ch of value.normalize('NFC')) {
    if (/\p{Cc}/u.test(ch) || ch === '\u2028' || ch === '\u2029') out += ' '
    else if (/\p{Cf}/u.test(ch)) continue
    else out += ch
  }
  return out.replace(/\p{Zs}+/gu, ' ').replace(/^ +| +$/g, '')
}

// 실행 환경의 유니코드 표에서 \p{Cf} 글자 전부 (U+FEFF·U+200B~U+200F·U+202A~U+202E·U+2060~·U+00AD·태그 글자 등)
const CF: string[] = []
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue
  const ch = String.fromCodePoint(cp)
  if (/\p{Cf}/u.test(ch)) CF.push(ch)
}
const cfArb = fc.constantFrom(...CF)
const cfOnlyArb = fc.array(cfArb, { minLength: 1, maxLength: 30 }).map((xs) => xs.join(''))

// 실제로 붙여 넣을 법한 이름 + 보이지 않는 글자 섞기
const base = fc.constantFrom('경동택배', '대신택배', '합동택배', '<script>alert(1)</script>', '🚚택배', '가'.repeat(19), '가'.repeat(20), '가'.repeat(21), '\u3164', '경동\u3164택배', '한진', 'Cafe\u0301', '경 동')
const noise = fc.oneof(cfArb, fc.constantFrom('\u2028', '\u2029', '\n', '\r\n', '\t', '\u0000', '\u007f', '\u0085', ' ', '\u3000', '\u00a0', '\u3000'))
const mixedArb = fc.tuple(base, fc.array(fc.tuple(fc.nat(), noise), { maxLength: 6 })).map(([name, inserts]) => {
  const chars = [...name]
  for (const [at, ch] of inserts) chars.splice(at % (chars.length + 1), 0, ch)
  return chars.join('')
})

async function savedName(world: ParcelWorld, seller: Seller): Promise<{ carrier: string | null; carrier_name: string | null }> {
  const rows = await world.database.pglite?.query<{ carrier: string | null; carrier_name: string | null }>('select carrier, carrier_name from parcel_settings where seller_id = $1', [seller.sellerId])
  const row = rows?.rows[0]
  if (row === undefined) throw new Error('설정 행이 없다')
  return row
}

describe('TD-FB1 택배사 이름 = L-2 글 다듬기 (D-FB1-16)', () => {
  it('기준 함수 l2 = trimLabelText (보이지 않는 글자를 섞은 이름 2,000개·무작위 글 1,000개)', () => {
    expect(CF.length).toBeGreaterThan(100)
    fc.assert(
      fc.property(fc.oneof(mixedArb, cfOnlyArb, fc.string({ unit: 'binary', maxLength: 40 })), (text) => {
        const trimmed = trimLabelText(text)
        expect(trimmed, JSON.stringify(text)).toBe(l2(text))
        expect(FORBIDDEN.test(trimmed), JSON.stringify(trimmed)).toBe(false)
      }),
      { numRuns: 3_000, seed: 20261024 },
    )
  })

  it('보이지 않는 글자를 섞은 이름 150개: 200이면 저장값 = trimLabelText(입력)(서식·제어·줄 구분 글자 0개, 1~20자), 400이면 저장값 그대로', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'OTHER', carrierName: '처음택배', sender: SENDER })
    await sell(world, seller, [['UC_A', '가가', 1]])
    const api = parcelApi(world, seller.cookie)
    let accepted = 0
    await fc.assert(
      fc.asyncProperty(mixedArb, async (name) => {
        const before = await savedName(world, seller)
        const r = await api.putSettings({ carrier: 'OTHER', carrierName: name })
        const after = await savedName(world, seller)
        const want = trimLabelText(name)
        if (want === '' || [...want].length > 20) {
          expect(r.status, `${JSON.stringify(name)} ${r.text}`).toBe(400)
          expect(JSON.stringify(r.body)).toContain(want === '' ? EMPTY : TOO_LONG)
          expect(JSON.stringify(r.body)).toContain('carrierName')
          expect(after).toEqual(before)
          return
        }
        expect(r.status, `${JSON.stringify(name)} ${r.text}`).toBe(200)
        accepted++
        expect(after).toEqual({ carrier: 'OTHER', carrier_name: want })
        expect(want).toBe(l2(name))
        expect(FORBIDDEN.test(after.carrier_name ?? ''), JSON.stringify(after.carrier_name)).toBe(false)
        expect((r.body.settings as { carrierName: string }).carrierName).toBe(want)
        expect((await dayRows(world, seller)).body.carrier).toEqual({ code: 'OTHER', name: want })
      }),
      { numRuns: 150, seed: 2028 },
    )
    expect(accepted).toBeGreaterThan(50)
  })

  it('무작위 \\p{Cf} 글자만으로 된 이름 1,000개 → 모두 400 "택배사 이름을 적어 주세요.", 저장값 그대로', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'OTHER', carrierName: '처음택배', sender: SENDER })
    const api = parcelApi(world, seller.cookie)
    const names = fc.sample(cfOnlyArb, { numRuns: 1_000, seed: 2029 })
    expect(names).toHaveLength(1_000)
    for (const [i, name] of names.entries()) {
      // 처음 고르기(OTHER로 새로 보내기)와 이름만 보내기를 번갈아
      const body = i % 2 === 0 ? { carrier: 'OTHER', carrierName: name } : { carrierName: name }
      const r = await api.putSettings(body)
      expect(r.status, `${JSON.stringify(name)} ${r.text}`).toBe(400)
      expect(JSON.stringify(r.body)).toContain(EMPTY)
    }
    expect(await savedName(world, seller)).toEqual({ carrier: 'OTHER', carrier_name: '처음택배' })
    // 고르지 않음 → 직접 입력 + 서식 글자만 → 400, 고르지 않음 그대로
    await expect200(api.putSettings({ carrier: null }))
    for (const name of names.slice(0, 20)) expect((await api.putSettings({ carrier: 'OTHER', carrierName: name })).status).toBe(400)
    expect(await savedName(world, seller)).toEqual({ carrier: null, carrier_name: null })
  })

  it('경계: 글자 수는 다듬은 뒤 — 20자 + 서식 글자는 저장, 한글 채움 글자는 지우지 않는다, 방향 바꾸기 글자는 지운다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'FAKE', sender: SENDER })
    const api = parcelApi(world, seller.cookie)
    const cases: readonly (readonly [string, string | null])[] = [
      [`${'가'.repeat(20)}\u200b\u200d\u00ad\ufeff`, '가'.repeat(20)],
      [`\u202e${'가'.repeat(20)}\u202c`, '가'.repeat(20)],
      [`${'가'.repeat(10)}\u2028${'나'.repeat(9)}`, `${'가'.repeat(10)} ${'나'.repeat(9)}`],
      [`${'가'.repeat(10)}\u2029\u2029${'나'.repeat(10)}`, null], // 다듬으면 21자
      ['경동\u202e버택', '경동버택'],
      ['\u3164', '\u3164'], // U+3164 한글 채움은 Lo — 지우지 않는다 (D-FB1-16)
      ['\u2028\u2029\u0085\u200b', null],
      ['e\u0301', 'é'], // NFC
    ]
    for (const [input, want] of cases) {
      const r = await api.putSettings({ carrier: 'OTHER', carrierName: input })
      if (want === null) {
        expect(r.status, JSON.stringify(input)).toBe(400)
        continue
      }
      expect(r.status, `${JSON.stringify(input)} ${r.text}`).toBe(200)
      expect(trimLabelText(input)).toBe(want)
      expect(await savedName(world, seller)).toEqual({ carrier: 'OTHER', carrier_name: want })
    }
  })
})
