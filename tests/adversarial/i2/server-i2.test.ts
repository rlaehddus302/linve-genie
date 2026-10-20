// I2 적대 테스트 (test-domain): 상품 목록 가져오기·포장·확인서 서버 경로.
// 실제 판매자가 할 법한 조작부터 공격한다:
// - 미리 보기가 "500개 등록하기"라고 한 목록을 그대로 등록에 보내면 등록된다(본문 크기 상한에 걸리면 안 된다)
// - 엑셀 복사(탭 글)와 .xlsx 행 입구는 같은 표에 같은 결과를 낸다(따옴표·한 칸짜리 줄 밖)
// - 미리 보기 품종은 등록 검사(정규화한 글)를 늘 통과한다(normalizeText가 두 번 해도 같다)
// - 합쳐진 구매자 ID: 확인서·라벨·지난 구매는 지금의 구매자로 풀고, 포장 명령은 거절한다
// - 번호 변경·합치기·떼어 내기 뒤에도 포장 라벨 품목 = 체크리스트 품목, 포장 명령은 엔진 로그·seq·정산을 바꾸지 않는다
import { normalizeText } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseProductList, parseProductRows } from '../../../apps/server/src/product-import.ts'
import { chat, ok, pack, post } from '../../../apps/server/test/i2-support.ts'
import { addSeller, client, createBroadcast, newWorld, rid } from '../../../apps/server/test/support.ts'

const D = '2026-10-19'

interface Entry {
  buyer: string
  status: string
  items: { key: string; no: number; title: string }[]
}

describe('TD-I2-001 상품 목록 가져오기 — 미리 보기에서 본 500줄을 그대로 등록', () => {
  it('품종이 조금 긴(40글자) 500줄: 미리 보기 "500개 등록하기" → 등록이 본문 크기 상한(64KB)에 걸리지 않고 500개 등록된다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    // 실제 상품명처럼 꾸밈말이 붙은 품종 (40글자 안팎)
    const name = '[국민다육] 방울복랑 금 대품 뿌리 튼튼 화분 포함 선착순 한정 특가 상품'
    const text = ['번호\t품종\t가격', ...Array.from({ length: 500 }, (_, i) => `${String(i + 1)}\t${name}\t15000`)].join('\n')
    const preview = await post(world, seller, `/api/broadcasts/${b}/import/preview`, { text })
    expect(preview.status, preview.text).toBe(200)
    expect([preview.body.register, preview.body.problems]).toEqual([500, 0])
    // 화면은 미리 보기의 등록할 줄을 그대로 보낸다 (dev-notes "다음 개발자(web)에게")
    const rows = (preview.body.rows as { no: number; name: string; price: number }[]).map(({ no, name: n, price }) => ({ no, name: n, price }))
    const body = { requestId: rid('imp'), rows }
    // 이 시험이 뜻이 있으려면 본문이 64KB를 넘어야 한다
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(64 * 1024)
    const registered = await post(world, seller, `/api/broadcasts/${b}/import`, body)
    expect(registered.status, registered.text.slice(0, 200)).toBe(200)
    expect(registered.body.registered).toBe(500)
  }, 60_000)
})

describe('상품 목록 가져오기 해석 — 회귀', () => {
  const cell = fc.oneof(
    fc.constantFrom('', ' ', '15', '015번', '7 번', '핑크프릴', '1만5천', '10000', '8.5', '0', '번호', '가격', '010-1234-5678', '１５', '​', '　', '50원', '3'),
    fc.string({ maxLength: 6 }).filter((s) => !/[\t\r\n"]/.test(s)),
  )

  it('엑셀 복사(탭 글)와 .xlsx 행 입구는 같은 표에 같은 결과 (칸 둘 이상·따옴표 없는 줄)', () => {
    fc.assert(
      fc.property(fc.array(fc.array(cell, { minLength: 2, maxLength: 5 }), { minLength: 1, maxLength: 8 }), fc.constantFrom('WON', 'THOUSAND'), (table, unit) => {
        const text = table.map((row) => row.join('\t')).join('\n')
        const rows = table.map((cells, index) => ({ line: index + 1, cells }))
        expect(parseProductRows(rows, { unit, existing: [3] })).toEqual(parseProductList(text, { unit, existing: [3] }))
      }),
      { numRuns: 2000 },
    )
  })

  it('미리 보기 품종은 등록 검사(정규화한 글인가)를 늘 통과한다 — normalizeText를 두 번 해도 같다', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 30 }), (value) => {
        const once = normalizeText(value)
        expect(normalizeText(once)).toBe(once)
      }),
      { numRuns: 3000 },
    )
  })
})

describe('합쳐진 구매자·번호 변경 뒤의 포장·확인서 — 회귀', () => {
  async function sale() {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b1 = (await createBroadcast(world, seller, { date: D, title: '1부' })).id
    const b2 = (await createBroadcast(world, seller, { date: D, title: '2부' })).id
    for (const no of [7, 15, 28]) await ok(world, seller, { type: 'product.register', b: b1, no, name: `품종${String(no)}`, price: 1000 * no })
    await ok(world, seller, { type: 'product.register', b: b2, no: 7, name: '둘째7', price: 7700 })
    await chat(world, seller, b1, 'm1', 'UC_A', '홍길동', '7 15')
    await chat(world, seller, b2, 'm2', 'UC_A', '홍길동', '7')
    await ok(world, seller, { type: 'product.register', b: b1, no: 31, name: '방울복랑', price: 15000 })
    const sms = (await ok(world, seller, { type: 'sms', b: b1, no: 31, received: '20:02', phone: '010-1111-2222' })).body.buyer as string
    return { world, seller, b1, b2, sms }
  }

  it('합친 문자 구매자 ID로 확인서·라벨·지난 구매 → 지금의 구매자(UC_A)의 것, 포장 명령은 "구매자를 다시 확인해 주세요."', async () => {
    const { world, seller, sms } = await sale()
    await ok(world, seller, { type: 'buyer.merge', from: sms, into: 'UC_A', reason: '같은 사람' }, D)
    const api = client(world, seller.cookie)
    const viaMerged = await api.get(`/api/days/${D}/receipt?buyer=${encodeURIComponent(sms)}`)
    const viaRoot = await api.get(`/api/days/${D}/receipt?buyer=UC_A`)
    expect(viaMerged.status, viaMerged.text).toBe(200)
    expect(viaMerged.body).toEqual(viaRoot.body)
    const label = await api.get(`/api/days/${D}/packing-label?buyer=${encodeURIComponent(sms)}`)
    expect([label.status, label.body.buyer]).toEqual([200, 'UC_A'])
    const past = await api.get(`/api/days/${D}/past?buyer=${encodeURIComponent(sms)}`)
    expect([past.status, past.body.buyer]).toEqual([200, 'UC_A'])
    const list = (await api.get(`/api/days/${D}/packing`)).body.entries as Entry[]
    expect(list.map((entry) => entry.buyer)).toEqual(['UC_A'])
    const keys = list[0]?.items.map((item) => item.key) ?? []
    const merged = await pack(world, seller, D, { buyer: sms, action: 'pack', items: keys })
    expect([merged.status, (merged.body.error as { code: string }).code]).toEqual([400, 'BUYER_NOT_FOUND'])
  })

  it('번호 변경·합치기·떼어 내기 뒤에도 라벨 번호 = 체크리스트 품목 번호(방송 선언 순 → 번호 순), 포장 명령은 seq·정산을 바꾸지 않는다', async () => {
    const { world, seller, b1, b2, sms } = await sale()
    const api = client(world, seller.cookie)
    const check = async () => {
      const list = (await api.get(`/api/days/${D}/packing`)).body.entries as Entry[]
      for (const entry of list) {
        const label = await api.get(`/api/days/${D}/packing-label?buyer=${encodeURIComponent(entry.buyer)}`)
        const data = label.body.data as { broadcasts: { title: string; numbers: number[] }[] }
        const fromLabel = data.broadcasts.flatMap((group) => group.numbers.map((no) => `${group.title}/${String(no)}`))
        expect(fromLabel).toEqual(entry.items.map((item) => `${item.title}/${String(item.no)}`))
      }
      return list
    }
    const before = await api.get(`/api/days/${D}`)
    const first = (await check()).find((entry) => entry.buyer === 'UC_A')
    expect(first?.items.map((item) => `${item.title}/${String(item.no)}`)).toEqual(['1부/7', '1부/15', '2부/7'])
    await pack(world, seller, D, { buyer: 'UC_A', action: 'pack', items: first?.items.map((item) => item.key) })
    const after = await api.get(`/api/days/${D}`)
    expect(after.body.seq).toBe(before.body.seq)
    expect(after.body.settlements).toEqual(before.body.settlements)
    await ok(world, seller, { type: 'product.renumber', b: b1, from: 15, to: 16 })
    await check()
    await ok(world, seller, { type: 'buyer.merge', from: sms, into: 'UC_A', reason: '같은 사람' }, D)
    const merged = (await check()).find((entry) => entry.buyer === 'UC_A')
    expect(merged?.status).toBe('포장 다시 확인')
    await ok(world, seller, { type: 'buyer.unmerge', from: sms, reason: '다른 사람' }, D)
    await check()
    void b2
  })
})
