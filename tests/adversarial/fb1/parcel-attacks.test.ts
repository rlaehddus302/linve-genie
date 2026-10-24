// FB1 적대 시험 (test-domain): 택배 크기·쓰는 택배사 (AC-FB1-15·16·89, PARCEL_RULES PC-1·PC-6, D-FB1-04·D-FB1-05).
// - 택배 크기: 설정 저장·접수 본문 box에 무작위 글·숫자·배열·객체·옛 낱말 변형(앞뒤 공백·전각·NFD로 푼 한글·보이지 않는 글자)을 넣어
//   골든 함수(parcel/box.json의 규칙 — 글자 그대로, 새 코드 다섯·옛 낱말 넷)와 같은 결과인지, 저장값은 늘 새 코드 다섯 가운데 하나인지
// - 택배사: carrier·carrierName에 무작위 값·긴 글·보이지 않는 글자·<script> → 400(아무것도 저장 안 함) 또는 다듬은 이름 저장(1~20 코드 포인트),
//   DB 행은 늘 "OTHER일 때만 이름". 어댑터 없는 택배사로 접수 → 택배사로 나가는 요청 0개
// - 택배사를 바꿔도 이미 접수된 기록(가짜 택배)의 운송장·조회·취소는 그 기록의 택배사로 된다(회귀)
// 가짜 택배사를 붙인 서버(apps/server/test/t1-support.ts)를 쓴다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { readBox } from '../../../apps/server/src/parcel/rules.ts'
import { SENDER, attempts, bookOk, dayRows, expect200, makeReady, parcelApi, parcelSeller, parcelWorld, rowOf, sell, type ParcelWorld } from '../../../apps/server/test/t1-support.ts'
import type { Seller } from '../../../apps/server/test/support.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const CODES = ['60', '80', '100', '120', '160'] as const
const LEGACY: Readonly<Record<string, string>> = { 극소: '60', 소: '80', 중: '100', 대: '120' }
const NO_AUTO_BOOK = '고른 택배사는 아직 자동 접수를 할 수 없어요. 포장 화면에서 송장번호를 직접 적어 주세요.'

/** 골든 parcel/box.json의 규칙 (about 그대로): 글자 그대로 비교 — 새 코드는 그대로, 옛 낱말 넷은 옮긴 코드, 그 밖은 BOX_INVALID */
function oracle(value: unknown): { box: string } | { error: 'BOX_INVALID' } {
  if (typeof value !== 'string') return { error: 'BOX_INVALID' }
  if ((CODES as readonly string[]).includes(value)) return { box: value }
  if (Object.hasOwn(LEGACY, value)) return { box: LEGACY[value] as string }
  return { error: 'BOX_INVALID' }
}

// 실제로 올 법한 변형: 옛 화면을 연 탭(옛 낱말), 복사·붙여 넣기의 공백, 휴대폰 전각 숫자, 맥에서 NFD로 풀린 한글, 화면 낱말 그대로
const near = ['극소', '소', '중', '대', ...CODES, '특대', '80cm 이하', '80cm', '80 ', ' 80', '080', '８０', '１６０', '60.0', '6e1', '소 ', ' 중', '　대', '소​', '​소', '극 소', '小', '中', '大', 'small', 'S', 'M', 'L', '__proto__', 'constructor', 'toString', 'hasOwnProperty']
const nfd = ['극소', '소', '중', '대'].map((w) => w.normalize('NFD'))
const boxArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...near, ...nfd) },
  { weight: 2, arbitrary: fc.string({ maxLength: 8 }) },
  { weight: 1, arbitrary: fc.integer({ min: -10, max: 300 }) },
  { weight: 1, arbitrary: fc.constantFrom(60, 80, 100, 120, 160, 80.0, Number.NaN, true, false, null, [], ['80'], { box: '80' }, { toString: '80' }) },
)

async function settingsRow(world: ParcelWorld, seller: Seller): Promise<{ carrier: string | null; carrier_name: string | null; box: string }> {
  const rows = await world.database.pglite?.query<{ carrier: string | null; carrier_name: string | null; box: string }>('select carrier, carrier_name, box from parcel_settings where seller_id = $1', [seller.sellerId])
  const row = rows?.rows[0]
  if (row === undefined) throw new Error('설정 행이 없다')
  return row
}

const bookRequests = (world: ParcelWorld) => world.carrier.requests.filter((item) => item.op === 'book')

describe('TD-FB1 택배 크기 읽기 = 골든 규칙 (AC-FB1-16·17·89)', () => {
  it('readBox: 무작위 값 2,000개가 골든 규칙과 같다 — 다듬기·NFC·반각 바꾸기 없음, 결과 코드는 늘 다섯 가운데 하나', () => {
    fc.assert(
      fc.property(boxArb, (value) => {
        const read = readBox(value)
        expect(read, JSON.stringify(value)).toEqual(oracle(value))
        if ('box' in read) expect(CODES).toContain(read.box)
      }),
      { numRuns: 2_000, seed: 20261024 },
    )
  })

  it('골든 parcel/box.json 사례가 readBox와 같다 (골든을 그대로 읽는다)', () => {
    const golden = JSON.parse(readFileSync(join(ROOT, 'tests/golden/parcel/box.json'), 'utf8')) as { cases: { id: string; in: { value: unknown }; out: unknown }[] }
    expect(golden.cases.length).toBe(19)
    for (const c of golden.cases) {
      expect(readBox(c.in.value), c.id).toEqual(c.out)
      expect(oracle(c.in.value), c.id).toEqual(c.out)
    }
  })

  it('설정 저장 box 무작위 60개: 받아들이면 골든 결과 코드로 저장, 아니면 400·저장값 그대로 — DB 값은 늘 새 코드', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'FAKE', sender: SENDER, box: '100' })
    const api = parcelApi(world, seller.cookie)
    await fc.assert(
      fc.asyncProperty(boxArb, async (value) => {
        const before = await settingsRow(world, seller)
        const expected = oracle(value)
        const r = await api.putSettings({ box: value })
        const after = await settingsRow(world, seller)
        if ('box' in expected) {
          expect(r.status, `${JSON.stringify(value)} ${r.text}`).toBe(200)
          expect((r.body.settings as { box: string }).box).toBe(expected.box)
          expect(after.box).toBe(expected.box)
        } else {
          expect(r.status, JSON.stringify(value)).toBe(400)
          expect(r.body.error).toMatchObject({ problems: [{ field: 'box', message: '상자 크기를 골라 주세요.' }] })
          expect(after).toEqual(before)
        }
        expect(CODES).toContain(after.box)
      }),
      { numRuns: 60, seed: 5 },
    )
  })

  it('접수 본문 items[].box 무작위 30개: 하나라도 골든 밖이면 400이고 택배사 요청 0개, 아니면 그 코드로 접수 (어댑터가 받는 값도 새 코드)', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'FAKE', sender: SENDER, box: '80' })
    const buyers = Array.from({ length: 30 }, (_, i) => `UC_${String(i).padStart(2, '0')}`)
    await sell(
      world,
      seller,
      buyers.map((b) => [b, `닉${b}`, 1] as const),
    )
    for (const b of buyers) await makeReady(world, seller, b)
    const api = parcelApi(world, seller.cookie)
    const values = fc.sample(boxArb, { numRuns: buyers.length, seed: 9 })
    for (const [i, buyer] of buyers.entries()) {
      const value = values[i]
      const expected = oracle(value)
      const sentBefore = bookRequests(world).length
      if ('error' in expected) {
        // 다른 묶음(올바른 값)과 섞어 보내도 아무것도 접수하지 않는다
        const r = await api.book([{ buyer: buyers[(i + 1) % buyers.length], box: '60' }, { buyer, box: value }])
        expect(r.status, JSON.stringify(value)).toBe(400)
        expect(r.text).toContain('상자 크기를 골라 주세요.')
        expect(bookRequests(world).length).toBe(sentBefore)
        expect(await attempts(world, seller.sellerId, buyer)).toEqual([])
      } else {
        const results = await bookOk(world, seller, [{ buyer, box: value }])
        expect(results[0], JSON.stringify(value)).toMatchObject({ ok: true })
        expect((await attempts(world, seller.sellerId, buyer)).map((row) => row.box)).toEqual([expected.box])
        const sent = bookRequests(world).slice(sentBefore)
        expect(sent.map((item) => (item.body as { box: unknown }).box)).toEqual([expected.box])
      }
    }
    // DB 어디에도 옛 낱말·표 밖 값이 없다
    const left = await world.database.pglite?.query<{ box: string }>('select box from parcels union all select box from parcel_settings')
    for (const row of left?.rows ?? []) expect(CODES).toContain(row.box)
  })
})

// ── 쓰는 택배사 ────────────────────────────────────────────
const nameArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('경동택배', '  경동   택배 ', '대신택배', '<script>alert(1)</script>', '<b>합동</b>', '"; drop table parcels; --', '🚚택배', '🚚'.repeat(20), '🚚'.repeat(21), '가'.repeat(20), '가'.repeat(21), '경동\n택배', '경동\t택배', '　경동　', '\u0000경동', '경동\u0007', '', ' ', '　', '\n\t', '&lt;b&gt;') },
  { weight: 2, arbitrary: fc.string({ maxLength: 30 }) },
  { weight: 1, arbitrary: fc.string({ minLength: 20, maxLength: 400 }) },
  { weight: 1, arbitrary: fc.constantFrom(0, 42, true, null, [], ['경동'], { name: '경동' }) },
)
const carrierArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom('EPOST', 'CJ', 'HANJIN', 'LOGEN', 'LOTTE', 'OTHER', 'FAKE', null) },
  { weight: 2, arbitrary: fc.constantFrom('cj', 'Other', 'OTHER ', ' EPOST', 'KDEXP', '', 'CJ대한통운', '우체국택배', '__proto__', 'toString', 0, true, ['CJ'], { code: 'CJ' }) },
  { weight: 1, arbitrary: fc.string({ maxLength: 10 }) },
)

/** 서버 다듬기(PC-2 1)와 같은 뜻: NFC → 공백(\s)·제어 글자는 공백 하나, 앞뒤 지우기 */
const tidy = (text: string): string =>
  [...text.normalize('NFC')]
    .map((c) => ((c.codePointAt(0) as number) <= 0x1f || ((c.codePointAt(0) as number) >= 0x7f && (c.codePointAt(0) as number) <= 0x9f) || /^\s$/u.test(c) ? ' ' : c))
    .join('')
    .replace(/ +/g, ' ')
    .trim()

describe('TD-FB1 쓰는 택배사 무작위 (AC-FB1-15·89)', () => {
  it('carrier·carrierName 무작위 80쌍: 400이면 아무것도 저장 안 함, 200이면 다듬은 1~20자 이름(OTHER일 때만) — 행은 늘 "OTHER일 때만 이름", 이름은 로그에 없음', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'FAKE', sender: SENDER })
    const api = parcelApi(world, seller.cookie)
    const names: string[] = []
    await fc.assert(
      fc.asyncProperty(fc.option(carrierArb, { nil: undefined }), fc.option(nameArb, { nil: undefined }), async (carrier, carrierName) => {
        const body: Record<string, unknown> = {}
        if (carrier !== undefined) body.carrier = carrier
        if (carrierName !== undefined) body.carrierName = carrierName
        const before = await settingsRow(world, seller)
        const r = await api.putSettings(body)
        const after = await settingsRow(world, seller)
        expect([200, 400], r.text).toContain(r.status)
        if (r.status === 400) {
          expect(after, JSON.stringify(body)).toEqual(before)
          return
        }
        // 행 모양: OTHER일 때만 이름, 이름은 다듬은 1~20 코드 포인트
        if (after.carrier === 'OTHER') {
          expect(after.carrier_name).not.toBeNull()
          const n = after.carrier_name as string
          expect(n).toBe(tidy(n))
          expect(n.length > 0 && [...n].length <= 20, JSON.stringify(n)).toBe(true)
          names.push(n)
          if (body.carrierName !== undefined) expect(n).toBe(tidy(String(body.carrierName)))
          expect((r.body.settings as { carrierName: string }).carrierName).toBe(n)
        } else expect(after.carrier_name).toBeNull()
        // 받아들인 carrier는 목록 안 코드 하나 (또는 고르지 않음)
        expect([null, 'EPOST', 'CJ', 'HANJIN', 'LOGEN', 'LOTTE', 'OTHER', 'FAKE']).toContain(after.carrier)
        if (carrier !== undefined) expect(after.carrier).toBe(carrier)
      }),
      { numRuns: 80, seed: 77 },
    )
    const logs = JSON.stringify(world.logs)
    for (const n of names) if ([...n].length >= 2) expect(logs.includes(n), `로그에 이름 ${n}`).toBe(false)
  })

  it('<script> 이름: 다듬어 저장되고 응답은 JSON 글로만(태그가 HTML로 나가지 않음), 화면 코드에 HTML로 넣는 길이 없다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'FAKE', sender: SENDER })
    await sell(world, seller, [['UC_A', '가가', 1]])
    const api = parcelApi(world, seller.cookie)
    const saved = await expect200(api.putSettings({ carrier: 'OTHER', carrierName: '<b>경동</b>' }))
    expect(saved.headers.get('content-type')).toContain('application/json')
    expect((saved.body.settings as { carrierName: string }).carrierName).toBe('<b>경동</b>')
    expect((await dayRows(world, seller)).body.carrier).toEqual({ code: 'OTHER', name: '<b>경동</b>' })
    for (const file of ['ParcelSettings.tsx', 'ParcelsPage.tsx', 'ParcelParts.tsx']) {
      const source = readFileSync(join(ROOT, 'apps/web/src/components', file), 'utf8')
      expect(source, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
    }
  })

  it('어댑터가 없는 택배사 다섯 + 직접 입력으로 바꿔 가며 접수·같은 요청 번호 다시 보내기·동시 접수 → 택배사 요청 0개, 접수 기록 0개', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'FAKE', sender: SENDER })
    await sell(world, seller, [
      ['UC_A', '가가', 1],
      ['UC_B', '나나', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_B')
    const api = parcelApi(world, seller.cookie)
    for (const settings of [{ carrier: 'EPOST' }, { carrier: 'CJ' }, { carrier: 'HANJIN' }, { carrier: 'LOGEN' }, { carrier: 'LOTTE' }, { carrier: 'OTHER', carrierName: '경동택배' }]) {
      await expect200(api.putSettings(settings))
      expect((await dayRows(world, seller)).blocked).toEqual({ code: 'NO_AUTO_BOOK', message: NO_AUTO_BOOK })
      const all = await Promise.all(Array.from({ length: 5 }, () => api.book([{ buyer: 'UC_A' }, { buyer: 'UC_B', box: '160' }])))
      for (const r of all) {
        expect(r.status, r.text).toBe(409)
        expect(r.body.error).toMatchObject({ code: 'PARCEL_BLOCKED', message: NO_AUTO_BOOK })
      }
    }
    expect(bookRequests(world)).toEqual([])
    expect(world.carrier.requests).toEqual([])
    for (const buyer of ['UC_A', 'UC_B']) expect(await attempts(world, seller.sellerId, buyer)).toEqual([])
  })

  it('가짜 택배로 접수한 뒤 쓰는 택배사를 CJ·직접 입력·고르지 않음으로 바꿔도 그 기록의 운송장·조회·취소는 된다 (회귀)', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world, { carrier: 'FAKE', sender: SENDER })
    await sell(world, seller, [
      ['UC_A', '가가', 1],
      ['UC_B', '나나', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_B')
    const booked = await bookOk(world, seller, [{ buyer: 'UC_A' }, { buyer: 'UC_B' }])
    expect(booked.every((item) => item.ok)).toBe(true)
    const api = parcelApi(world, seller.cookie)
    for (const settings of [{ carrier: 'CJ' }, { carrier: 'OTHER', carrierName: '경동' }, { carrier: null }]) {
      await expect200(api.putSettings(settings))
      expect((await api.waybill('UC_A')).status).toBe(200)
      expect((await api.waybills()).status).toBe(200)
    }
    await expect200(api.putSettings({ carrier: 'LOTTE' }))
    world.carrier.setStatus(booked[0]?.invoice as string, 'PICKED_UP')
    await world.server.parcels.trackOnce()
    expect((await rowOf(world, seller, 'UC_A')).parcel?.status).toBe('집하')
    await expect200(api.cancel('UC_B'))
    expect((await rowOf(world, seller, 'UC_B')).parcel?.state).toBe('CANCELLED')
  })
})
