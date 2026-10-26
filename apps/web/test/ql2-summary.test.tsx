// QL2 3회차 — 휴대폰 고정 영역의 현재 상품 한 줄 요약(AC-QL2-01, D-QL2-11 (1)), 빈 "등록하면" 줄(AC-QL2-01b, D-QL2-11 (2)),
// 스타일 검사는 ql2-summary-styles.node.test.ts, 출력 기기 바꾸기 문장(AC-QL2-45)은 printer-station.test.ts.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FullView, Product } from '../src/api/types.ts'
import { CurrentSummary } from '../src/components/ProductBoard.tsx'
import { ConsoleContext, type ConsoleApi } from '../src/components/console-context.ts'
import { NO_CURRENT_SUMMARY, SUMMARY_LIMIT, clipWords, currentSummaryWords } from '../src/lib/current-summary.ts'
import { BuyerNames } from '../src/lib/derive.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { DATE, fullView, product } from './support.ts'

afterEach(cleanup)

const base = { no: 15, name: '핑크프릴', status: 'OPEN' as const, winners: '아직 없음', waiting: 0 }

describe('요약 문장 currentSummaryWords (D-QL2-11 (1))', () => {
  it('"{번호}번 {이름} · {상태} · 1등 {1등} · 대기 {n}명"', () => {
    expect(currentSummaryWords(base)).toBe('15번 핑크프릴 · 판매 중 · 1등 아직 없음 · 대기 0명')
    expect(currentSummaryWords({ ...base, winners: '<b>해커</b>', waiting: 3 })).toBe('15번 핑크프릴 · 판매 중 · 1등 <b>해커</b> · 대기 3명')
  })

  it('상태 낱말 다섯 가지', () => {
    const words = (['READY', 'OPEN', 'SOLD', 'HOLD', 'CLOSED'] as const).map((status) => currentSummaryWords({ ...base, status }))
    expect(words).toEqual([
      '15번 핑크프릴 · 공개 전 · 1등 아직 없음 · 대기 0명',
      '15번 핑크프릴 · 판매 중 · 1등 아직 없음 · 대기 0명',
      '15번 핑크프릴 · 판매 완료 · 1등 아직 없음 · 대기 0명',
      '15번 핑크프릴 · 일시 중지 · 1등 아직 없음 · 대기 0명',
      '15번 핑크프릴 · 판매 종료 · 1등 아직 없음 · 대기 0명',
    ])
  })

  it('현재 상품 없음 → "현재 상품: 아직 없어요"', () => {
    expect(currentSummaryWords(undefined)).toBe('현재 상품: 아직 없어요')
    expect(NO_CURRENT_SUMMARY).toBe('현재 상품: 아직 없어요')
  })

  it('이름·1등은 10글자를 넘으면 앞 10글자 + "…" (낱자 수), 10글자면 그대로', () => {
    expect(SUMMARY_LIMIT).toBe(10)
    expect(currentSummaryWords({ ...base, name: '가나다라마바사아자차카타' })).toBe('15번 가나다라마바사아자차… · 판매 중 · 1등 아직 없음 · 대기 0명')
    expect(currentSummaryWords({ ...base, name: '가나다라마바사아자차' })).toBe('15번 가나다라마바사아자차 · 판매 중 · 1등 아직 없음 · 대기 0명')
    expect(currentSummaryWords({ ...base, winners: '홍길동, 김철수, 박영희' })).toBe('15번 핑크프릴 · 판매 중 · 1등 홍길동, 김철수, … · 대기 0명')
    // 이모지는 한 글자로 센다 (반쪽 글자 없음)
    expect(clipWords('🌵🌵🌵🌵🌵🌵🌵🌵🌵🌵🌵', 10)).toBe('🌵🌵🌵🌵🌵🌵🌵🌵🌵🌵…')
  })
})

function buyers(...pairs: (readonly [string, string])[]): FullView['buyers'] {
  return pairs.map(([id, display]) => ({
    id,
    kind: 'youtube' as const,
    current: id,
    mergedInto: null,
    merged: [],
    display,
    nameHistory: [display],
    phoneLast4: null,
    items: [],
    subtotal: 0,
    byBroadcast: {},
    blocked: false,
  }))
}

function fakeApi(view: FullView): ConsoleApi {
  const data = fromFull(view)
  return {
    b: 'b1',
    date: DATE,
    rehearsal: false,
    ended: false,
    sealed: false,
    data,
    names: new BuyerNames(data.buyers, data.claims),
    waiting: { claims: new Set(), products: new Set() },
    delayMs: 5000,
    settingsOf: (id) => data.broadcasts.get(id)?.settings ?? null,
    openDialog: () => {},
    closeTop: () => {},
    closeAll: () => {},
    queueHost: () => {},
    command: () => Promise.reject(new Error('보내지 않는다')),
    write: () => Promise.reject(new Error('보내지 않는다')),
    fillQuick: () => {},
    select: () => {},
  }
}

function draw(item: Product | undefined, view: FullView) {
  return render(
    <ConsoleContext.Provider value={fakeApi(view)}>
      <CurrentSummary product={item} />
    </ConsoleContext.Provider>,
  )
}

describe('요약 줄 CurrentSummary (AC-QL2-01)', () => {
  it('role=status·aria-live=polite, 1등 닉네임은 글자 그대로(b 요소 0), 대기 수는 카드와 같다', () => {
    const item = product(15, { winners: ['c1'], winnerClaims: ['k1'], waitlist: ['c2', 'c3'], waitlistClaims: ['k2', 'k3'] })
    const view = fullView({ products: [item], buyers: buyers(['c1', '<b>해커</b>'], ['c2', '김철수'], ['c3', '박영희']) })
    const { container } = draw(item, view)
    const line = screen.getByRole('status', { name: '현재 상품 요약' })
    expect(line.getAttribute('aria-live')).toBe('polite')
    expect(line.textContent).toBe('15번 핑크프릴 · 판매 중 · 1등 <b>해커</b> · 대기 2명')
    expect(container.querySelectorAll('b, script')).toHaveLength(0)
  })

  it('1등 여럿은 ", "로 잇고 10글자 넘으면 자른다, 옵션 상품은 "변형별"', () => {
    const many = product(15, { stock: 3, winners: ['c1', 'c2', 'c3'], winnerClaims: ['k1', 'k2', 'k3'] })
    const view = fullView({ products: [many], buyers: buyers(['c1', '홍길동'], ['c2', '김철수'], ['c3', '박영희']) })
    draw(many, view)
    expect(screen.getByRole('status').textContent).toBe('15번 핑크프릴 · 판매 중 · 1등 홍길동, 김철수, … · 대기 0명')
    cleanup()
    const options = product(21, { name: '반바지', hasOptions: true })
    draw(options, fullView({ products: [options] }))
    expect(screen.getByRole('status').textContent).toBe('21번 반바지 · 판매 중 · 1등 변형별 · 대기 0명')
  })

  it('이름 없는 상품은 카드와 같은 "품종 미입력", 상품 없음은 "현재 상품: 아직 없어요"', () => {
    const blank = product(7, { name: '' })
    draw(blank, fullView({ products: [blank] }))
    expect(screen.getByRole('status').textContent).toBe('7번 품종 미입력 · 판매 중 · 1등 아직 없음 · 대기 0명')
    cleanup()
    draw(undefined, fullView({}))
    expect(screen.getByRole('status').textContent).toBe('현재 상품: 아직 없어요')
  })
})
