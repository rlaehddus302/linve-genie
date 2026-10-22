// O4 감사 뒤 결정 단위 시험 (AC-O4-34·35·36, D-O4-09·10·11): "상품 n개" = 수량 합(셈 하나), 판매 줄 한 모양, 맨숫자 별칭 안내.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { PackingItem, PastItem } from '../src/api/types.ts'
import { BuyersPage } from '../src/components/BuyersPage.tsx'
import { OptionDialog } from '../src/components/OptionDialog.tsx'
import { pastCount, pastLineWords } from '../src/components/PastPurchases.tsx'
import { detailLineWords } from '../src/components/SettlementsPage.tsx'
import { chatOptionWords, claimOptionWords } from '../src/lib/derive.ts'
import { OPTION_TEMPLATES } from '../src/lib/option-templates.ts'
import { EMPTY_DRAFT, OPTION_WORDS, hasNumericAlias } from '../src/lib/options.ts'
import { itemCount, itemLineWords, qtyWords } from '../src/lib/packing.ts'
import { buyerQuantity, quantitySum, saleLine, saleOptionWords, settlementQuantities } from '../src/lib/sale-line.ts'
import { settlementKey } from '../src/lib/scope-data.ts'
import { quantityCounts } from '../src/lib/settlement.ts'
import { chat, dataOf, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, flush } from './support.ts'

const OPTIONS = { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } as const

/** AC-O4-34의 구매자: 초코 과자 3개 + 반바지 M 1개 확정, 반바지 L 2개는 취소 */
const EVENTS: Record<string, unknown>[] = [
  { type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 15000, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }], stocks: { S: 1, M: 1, L: 3 } },
  { type: 'product.register', b: 'b1', no: 11, name: '초코 과자', price: 2000, stock: 5 },
  chat('m1', 'UC_hong1234', '홍길동', '초코 과자 3'),
  chat('m2', 'UC_hong1234', '홍길동', '반바지 M'),
  chat('m3', 'UC_hong1234', '홍길동', '반바지 L 2'),
  { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_hong1234', options: { 사이즈: 'L' }, reason: '시청자 요청' },
]

describe('"상품 n개" = 확정 찜 수량 합, 셈 하나 (AC-O4-34, D-O4-09)', () => {
  it('구매자·정산 묶음 모두 3 + 1 = 4 (취소 찜 뺌)', () => {
    const data = dataOf(EVENTS, OPTIONS)
    const buyer = data.buyers.get('UC_hong1234')
    if (buyer === undefined) throw new Error('구매자')
    const confirmed = [...data.claims.values()].filter((claim) => claim.status === 'CONFIRMED')
    expect(confirmed.map((claim) => [claim.no, claim.variant, claim.qty])).toEqual([
      [11, null, 3],
      [21, 'M', 1],
    ])
    expect(buyer.items).toHaveLength(2)
    expect(buyerQuantity(data, buyer)).toBe(4)
    expect(settlementQuantities(data).get(settlementKey({ buyer: buyer.id, date: DATE }))).toBe(4)
    expect(quantityCounts(data).get(settlementKey({ buyer: buyer.id, date: DATE }))).toBe(4)
  })

  it('포장·지난 구매도 같은 셈 — 포장 "a/b 담음"의 b는 줄 수 2', () => {
    const packing: PackingItem[] = [
      { key: 'b1/11', broadcast: 'b1', title: '1부', no: 11, name: '초코 과자', price: 6000, id: 'p11', variant: null, qty: 3 },
      { key: 'b1/21#M', broadcast: 'b1', title: '1부', no: 21, name: '반바지', price: 15000, id: 'p21', variant: 'M', qty: 1 },
    ]
    expect(itemCount(packing)).toBe(4)
    expect(packing.length).toBe(2)
    const past: PastItem['items'][number][] = [
      { title: '1부', no: 11, name: '초코 과자', price: 2000, variant: null, qty: 3, amount: 6000 },
      { title: '1부', no: 21, name: '반바지', price: 15000, variant: 'M', qty: 1, amount: 15000 },
    ]
    expect(pastCount(past)).toBe(4)
    expect(quantitySum(past)).toBe(4)
  })

  it('다육(BUY-04 AC1 — 15·28·31번 각 1개)은 3개, 수량이 없는 이전 응답은 1로 센다', () => {
    const data = dataOf([register(15, '핑크프릴', 8000), register(28, '청보석', 9000), register(31, '라울', 7000), chat('a', 'UC_kim5555', '김철수', '15'), chat('b', 'UC_kim5555', '김철수', '28'), chat('c', 'UC_kim5555', '김철수', '31')])
    const buyer = data.buyers.get('UC_kim5555')
    if (buyer === undefined) throw new Error('구매자')
    expect(buyerQuantity(data, buyer)).toBe(3)
    expect(quantitySum([{}, { qty: 2 }])).toBe(3)
  })
})

describe('구매자 화면의 상품 수·확정 상품 줄 (AC-O4-34·35)', () => {
  let engine: EngineServer
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource)
    FakeEventSource.reset()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    onUnauthorized(null)
  })

  it('목록 "4개", 자세히 "상품 4개"와 줄 `21번 반바지 M`·`11번 초코 과자 3개` — `×` 없음', async () => {
    engine = new EngineServer(EVENTS, { settings: OPTIONS })
    vi.stubGlobal('fetch', engine.server.fetch)
    render(<BuyersPage route={{ name: 'buyers', date: DATE, rehearsal: false }} navigate={vi.fn()} />)
    await flush(10)
    const rows = within(screen.getByRole('list', { name: '구매자' })).getAllByRole('link')
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('홍길동유튜브4개 · 21,000원')])
    render(<BuyersPage route={{ name: 'buyers', date: DATE, rehearsal: false, buyer: 'UC_hong1234' }} navigate={vi.fn()} />)
    await flush(10)
    const confirmed = screen.getByRole('region', { name: '확정 상품' })
    const lines = within(confirmed)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(lines).toEqual([expect.stringMatching(/^11번 초코 과자 3개 6,000원 · /), expect.stringMatching(/^21번 반바지 M 15,000원 · /)])
    expect(confirmed.textContent).toContain('상품 4개')
    expect(confirmed.textContent).not.toContain('×')
  })
})

describe('판매 줄 한 모양 (AC-O4-35, D-O4-10)', () => {
  it('`{번호}번[ {품종}][ {옵션 글}][ {수량}개]` — 수량은 2 이상일 때만', () => {
    expect(saleLine({ no: 21, name: '반바지', variant: 'L', qty: 2 })).toBe('21번 반바지 L 2개')
    expect(saleLine({ no: 21, name: '반바지', variant: 'M', qty: 1 })).toBe('21번 반바지 M')
    expect(saleLine({ no: 7, name: '핑크프릴', variant: null, qty: 1 })).toBe('7번 핑크프릴')
    // 품종을 보이지 않는 줄
    expect(saleLine({ no: 21, variant: 'L', qty: 2 })).toBe('21번 L 2개')
    expect(saleLine({ no: 7 })).toBe('7번')
    expect(saleOptionWords({ variant: null, qty: 3 })).toBe(' 3개')
  })

  it('화면 함수가 모두 같은 모양 — 구매자·정산·지난 구매·포장·찜 이름', () => {
    const claim = { no: 21, variant: 'L', qty: 2, amount: 30000 }
    expect(detailLineWords(claim, '반바지')).toBe('21번 반바지 L 2개 30,000원')
    expect(pastLineWords({ title: '1부', no: 21, name: '반바지', price: 15000, variant: 'L', qty: 2, amount: 30000 })).toBe('21번 반바지 L 2개 30,000원')
    const packing: PackingItem = { key: 'b1/21#L', broadcast: 'b1', title: '1부', no: 21, name: '반바지', price: 15000, id: 'p21', variant: 'L', qty: 2 }
    expect(`${itemLineWords(packing)} ${qtyWords(packing)}`).toBe('21번 반바지 L 2개')
    expect(claimOptionWords({ variant: 'L', qty: 2 })).toBe(' L 2개')
    expect(detailLineWords({ no: 7, variant: null, qty: 1, amount: 8000 }, '핑크프릴')).toBe('7번 핑크프릴 8,000원')
  })

  it('채팅 패널 안의 판정 표시만 D-O2-12 그대로 `×2`', () => {
    expect(chatOptionWords({ variant: 'L', qty: 2 })).toBe(' L ×2')
    expect(chatOptionWords({ variant: 'M', qty: 1 })).toBe(' M')
  })
})

describe('맨숫자 별칭 (AC-O4-36, D-O4-11)', () => {
  afterEach(() => cleanup())

  it('템플릿 기본 별칭에 숫자만으로 된 것이 없다 — 16프로·17프로·S25·S25울트라는 그대로', () => {
    const aliases = OPTION_TEMPLATES.flatMap((group) => group.templates.flatMap((template) => template.item.choices.flatMap((choice) => choice.aliases ?? [])))
    expect(aliases.filter((alias) => /^\d+$/.test(alias))).toEqual([])
    const phone = OPTION_TEMPLATES.find((group) => group.group === '휴대폰 케이스')?.templates[0]?.item.choices ?? []
    expect(phone.map((choice) => [choice.label, choice.aliases ?? []])).toEqual([
      ['아이폰 16', []],
      ['아이폰 16 프로', ['16프로']],
      ['아이폰 17', []],
      ['아이폰 17 프로', ['17프로']],
      ['갤럭시 S25', ['S25']],
      ['갤럭시 S25 울트라', ['S25울트라']],
    ])
  })

  it('숫자만 쓴 별칭을 알아본다 — 섞인 글은 아니다', () => {
    expect(hasNumericAlias('17')).toBe(true)
    expect(hasNumericAlias('검정, 17')).toBe(true)
    expect(hasNumericAlias('17프로')).toBe(false)
    expect(hasNumericAlias('')).toBe(false)
  })

  it('별칭 칸에 `17`을 넣으면 그 칸 아래 안내 — 등록은 막지 않는다, `17프로`·선택지 이름 `100`엔 안내 없음', () => {
    const submit = vi.fn()
    render(<OptionDialog title="옵션 추가" initial={EMPTY_DRAFT} price={10000} submitLabel="등록" onSubmit={submit} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '템플릿에서 고르기' }))
    fireEvent.click(screen.getByRole('button', { name: '의류 — 사이즈(숫자)' }))
    expect(screen.queryByText(OPTION_WORDS.numericAlias)).toBeNull()
    const alias = screen.getByLabelText('항목 1 선택지 1 별칭') as HTMLInputElement
    fireEvent.change(alias, { target: { value: '17프로' } })
    expect(screen.queryByText(OPTION_WORDS.numericAlias)).toBeNull()
    fireEvent.change(alias, { target: { value: '17' } })
    expect(screen.getByText(OPTION_WORDS.numericAlias)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
