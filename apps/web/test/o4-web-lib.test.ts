// O4 화면 값 단위 시험 (AC-O4-20·21·23·24·25·27, D-O4-04~07): 포장 줄·수량 합·포장 완료 품목, 바뀐 품목 안내, 지난 구매 줄, 라벨 목록 줄, 정산 상품 수.
import { describe, expect, it } from 'vitest'
import type { JobView, LabelData } from '../src/api/print-types.ts'
import type { PackingItem, PastItem } from '../src/api/types.ts'
import { pastCount, pastLineWords } from '../src/components/PastPurchases.tsx'
import { changeNotice, changeWords, diffItems, itemCount, itemIdentity, itemLineWords, packItems, qtyWords } from '../src/lib/packing.ts'
import { discardWord, labelOptionWords } from '../src/lib/print-words.ts'
import { settlementKey } from '../src/lib/scope-data.ts'
import { quantityCounts } from '../src/lib/settlement.ts'
import { productKeyOfItem } from '../src/lib/use-packing.ts'
import { chat, dataOf, register } from './engine.ts'
import { job } from './print-support.ts'

const OPTIONS = { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } as const

const item = (no: number, name: string, patch: Partial<PackingItem> = {}): PackingItem => ({ key: `b1/${String(no)}`, broadcast: 'b1', title: '1부', no, name, price: 10000, id: `p${String(no)}`, variant: null, qty: 1, ...patch })

/** AC-O4-20의 묶음: 다육 7번 · 옵션 21 M · 초코 과자 3개 · 반팔티 105/검정색 2개 */
const MIXED: readonly PackingItem[] = [
  item(7, '핑크프릴'),
  item(21, '반바지', { key: 'b1/21#M', variant: 'M' }),
  item(11, '초코 과자', { qty: 3, price: 6000 }),
  item(22, '반팔티', { key: 'b1/22#105/검정색', variant: '105/검정색', qty: 2, price: 34000 }),
]

describe('포장 줄·수량 합 (AC-O4-20, D-O4-04)', () => {
  it('줄 글 = "{번호}번 {품종}[ {옵션 글}]", 수량은 2 이상일 때만 "n개", 상품 수 = 수량 합', () => {
    expect(MIXED.map((x) => [itemLineWords(x), qtyWords(x)])).toEqual([
      ['7번 핑크프릴', ''],
      ['21번 반바지 M', ''],
      ['11번 초코 과자', '3개'],
      ['22번 반팔티 105/검정색', '2개'],
    ])
    expect(itemCount(MIXED)).toBe(7)
    // 다육만: 줄 수 그대로, 빈 품종은 "품종 미입력"
    expect(itemCount([item(15, '핑크프릴'), item(28, '청보석')])).toBe(2)
    expect(itemLineWords(item(42, ''))).toBe('42번 품종 미입력')
    // 수량·옵션 글이 없는(O3 전) 응답은 수량 1·옵션 없음으로 본다
    const legacy: PackingItem = { key: 'b1/9', broadcast: 'b1', title: '1부', no: 9, name: '라울', price: 3000 }
    expect([itemLineWords(legacy), qtyWords(legacy), itemCount([legacy])]).toEqual(['9번 라울', '', 1])
  })

  it('포장 완료 품목 = 화면 품목마다 { key, qty }, 화면 순서 (AC-O4-21, D-O4-05)', () => {
    expect(packItems(MIXED)).toEqual([
      { key: 'b1/7', qty: 1 },
      { key: 'b1/21#M', qty: 1 },
      { key: 'b1/11', qty: 3 },
      { key: 'b1/22#105/검정색', qty: 2 },
    ])
  })

  it('수량만 바뀌어도 다른 품목 — 체크가 남지 않고 새로 담을 것·뺄 것 둘 다 (D-O4-05, AC-O4-23)', () => {
    const before = [item(21, '반바지', { key: 'b1/21#L', variant: 'L', qty: 2 })]
    const after = [item(21, '반바지', { key: 'b1/21#L', variant: 'L', qty: 1 })]
    expect(itemIdentity(before[0] as PackingItem)).not.toBe(itemIdentity(after[0] as PackingItem))
    const change = diffItems(before, after)
    expect(change.add.map((x) => x.qty)).toEqual([1])
    expect(change.remove).toEqual([{ key: 'b1/21#L', broadcast: 'b1', title: '1부', no: 21, variant: 'L', qty: 2, name: '반바지' }])
    expect(changeNotice(change, false, false)).toBe('구매 내역이 바뀌었어요 — 새로 담을 것: 21번 반바지 L · 뺄 것: 21번 반바지 L 2개')
  })

  it('서버가 준 다시 확인 목록도 같은 줄 모양 — 뺄 것은 포장 때 수량, 옵션 없는 수량 1은 이전 그대로 (AC-O4-23)', () => {
    expect(
      changeWords(
        {
          add: [item(21, '반바지', { key: 'b1/21#L', variant: 'L' }), item(31, '금황')],
          remove: [
            { key: 'b1/21#L', broadcast: 'b1', title: '1부', no: 21, name: '반바지', variant: 'L', qty: 2, id: 'p21' },
            { key: 'b1/11', broadcast: 'b1', title: '1부', no: 11, name: '초코 과자', variant: null, qty: 3, id: 'p11' },
            { key: 'b1/28', broadcast: 'b1', title: '1부', no: 28, name: '청보석', variant: null, qty: 1, id: 'p28' },
          ],
        },
        false,
      ),
    ).toBe('새로 담을 것: 21번 반바지 L, 31번 · 뺄 것: 21번 반바지 L 2개, 11번 초코 과자 3개, 28번')
    // 방송이 둘 이상이면 방송 제목도
    expect(changeWords({ add: [item(22, '반팔티', { key: 'b2/22#95/흰색', broadcast: 'b2', title: '2부', variant: '95/흰색', qty: 2 })], remove: [] }, true)).toBe('새로 담을 것: 2부 22번 반팔티 95/흰색 2개')
  })

  it('옵션 품목 키의 상품 키 (품종은 상품에 있다)', () => {
    expect(productKeyOfItem('b1/21#M')).toBe('b1/21')
    expect(productKeyOfItem('b1/22#105/검정색')).toBe('b1/22')
    expect(productKeyOfItem('b1/7')).toBe('b1/7')
  })
})

describe('지난 구매 줄 (AC-O4-24, D-O4-06)', () => {
  type Line = PastItem['items'][number]
  const line = (patch: Partial<Line>): Line => ({ title: '1부', no: 7, name: '핑크프릴', price: 8000, variant: null, qty: 1, amount: 8000, ...patch })
  it('"{번호}번 {품종}[ {옵션 글}][ {수량}개] {찜 금액}" — 금액이 없으면 비우고 단가로 채우지 않는다', () => {
    expect(pastLineWords(line({ no: 22, name: '반팔티', price: 17000, variant: '105/검정색', qty: 2, amount: 34000 }))).toBe('22번 반팔티 105/검정색 2개 34,000원')
    expect(pastLineWords(line({}))).toBe('7번 핑크프릴 8,000원')
    expect(pastLineWords(line({ no: 21, name: '반바지', price: 10000, variant: 'M', amount: null }))).toBe('21번 반바지 M')
    expect(pastLineWords(line({ name: ' ' }))).toBe('7번 품종 미입력 8,000원')
    expect(pastCount([line({ qty: 2 }), line({})])).toBe(3)
  })
})

describe('라벨 목록·작업 줄 (AC-O4-25, D-O4-07)', () => {
  const data = (patch: Record<string, unknown>): LabelData => ({ no: 21, name: '반바지', price: 10000, date: '2026-10-19', buyer: { kind: 'youtube', name: '홍길동' }, ...patch }) as LabelData
  it('번호 뒤 옵션 글·수량: " M", " L · 2개", 수량만 " · 3개", 옵션 없는 수량 1·포장 라벨·데이터 없음은 빈 글', () => {
    expect(labelOptionWords(data({ variant: 'M' }))).toBe(' M')
    expect(labelOptionWords(data({ variant: 'L', qty: 2 }))).toBe(' L · 2개')
    expect(labelOptionWords(data({ qty: 3 }))).toBe(' · 3개')
    expect(labelOptionWords(data({}))).toBe('')
    expect(labelOptionWords(null)).toBe('')
    expect(labelOptionWords({ date: '2026-10-19', buyer: { kind: 'sms' }, broadcasts: [], subtotal: 0 } as unknown as LabelData)).toBe('')
  })

  it('버릴 라벨 안내에도 옵션 글·수량 — 다육은 이전 그대로', () => {
    const optionJob: JobView = job('j1', { kind: 'product', data: data({ variant: 'L', qty: 2 }), date: '2026-10-19' })
    expect(discardWord(optionJob)).toBe(`21번 L · 2개 · ${optionJob.label.buyer.kind === 'sms' ? '문자찜' : optionJob.label.buyer.name} · 26.10.19 라벨을 버려 주세요`)
    const plain: JobView = job('j2', { kind: 'product', data: data({ no: 7 }), date: '2026-10-19' })
    expect(discardWord(plain)).toBe(`7번 · ${plain.label.buyer.kind === 'sms' ? '문자찜' : plain.label.buyer.name} · 26.10.19 라벨을 버려 주세요`)
  })
})

describe('정산 상품 수 = 수량 합 (AC-O4-27, D-O4-07)', () => {
  it('초코 과자 3개 + 반바지 M 1개 → 4, 수량 1 찜만이면 품목 수 그대로', () => {
    const data = dataOf(
      [
        { type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 10000, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }] },
        { type: 'product.register', b: 'b1', no: 11, name: '초코 과자', price: 2000, stock: 5 },
        chat('m1', 'c1', '가나', '반바지 M'),
        chat('m2', 'c1', '가나', '초코 과자 3'),
        register(15, '핑크프릴', 8000),
        chat('m3', 'c2', '다라', '15'),
      ],
      OPTIONS,
    )
    const counts = quantityCounts(data)
    const c1 = [...data.settlements.values()].find((s) => s.buyer === 'c1')
    const c2 = [...data.settlements.values()].find((s) => s.buyer === 'c2')
    if (c1 === undefined || c2 === undefined) throw new Error('묶음')
    expect(c1.items.length).toBe(2)
    expect(counts.get(settlementKey(c1))).toBe(4)
    expect(counts.get(settlementKey(c2))).toBe(c2.items.length)
  })
})
