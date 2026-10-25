// 입금 확인 화면 /deposits (N3 — AC-N3-40~46·49·50, DP-5·DP-6·DP-8, D-N3-07·08·09·11).
// 서버는 가짜(deposit-server.ts) — 사유·제안은 서버가 계산한 값을 시험이 넣는다(화면은 낱말로만 바꾼다).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { DepositView } from '../src/api/deposit-types.ts'
import { DepositContext } from '../src/components/deposit-context.tsx'
import { DepositsPage } from '../src/components/DepositsPage.tsx'
import { TopBar } from '../src/components/TopBar.tsx'
import { DepositStore } from '../src/lib/deposit-store.ts'
import { parseRoute, routePath, type DepositTab, type Route } from '../src/lib/router.ts'
import { DepositServer, D_DATE, bundle, deposit, source } from './deposit-server.ts'
import { FakeEventSource, apiError, flush } from './support.ts'
import { menuNav, openMore } from './menu-support.ts'

let api: DepositServer
let stream: FakeEventSource
let store: DepositStore

function Harness({ initial }: { readonly initial: Route }) {
  const [route, setRoute] = useState<Route>(initial)
  return (
    <DepositContext.Provider value={store}>
      <TopBar shopName="구피 가게" onLogout={() => {}} route={route} navigate={setRoute} />
      {route.name === 'deposits' ? <DepositsPage route={route} navigate={setRoute} /> : null}
    </DepositContext.Provider>
  )
}

async function open(deposits: DepositView[], tab: DepositTab = 'review', setup?: (server: DepositServer) => void) {
  api = new DepositServer(deposits)
  setup?.(api)
  vi.stubGlobal('fetch', api.server.fetch)
  stream = new FakeEventSource('/api/stream')
  store = new DepositStore({ openStream: () => stream })
  store.start()
  render(<Harness initial={{ name: 'deposits', tab }} />)
  await flush(10)
}

function wide() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

beforeEach(() => {
  FakeEventSource.reset()
  window.history.replaceState(null, '', '/deposits')
})

afterEach(() => {
  cleanup()
  store?.stop()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

const main = () => screen.getByRole('main')
const card = (no: number) => screen.getByRole('listitem', { name: `입금 번호 ${String(no)}` }) // MOB2 D-MOB2-05
const dialog = () => screen.getByRole('dialog')

describe('주소·메뉴·실시간 (AC-N3-40)', () => {
  it('주소는 /deposits, 목록은 검색값 tab — 입금자명·금액은 주소에 없다', () => {
    expect(parseRoute('/deposits')).toEqual({ name: 'deposits', tab: 'review' })
    expect(parseRoute('/deposits', '?tab=paste')).toEqual({ name: 'deposits', tab: 'paste' })
    expect(parseRoute('/deposits', '?tab=bogus')).toEqual({ name: 'deposits', tab: 'review' })
    expect(routePath({ name: 'deposits', tab: 'review' })).toBe('/deposits')
    expect(routePath({ name: 'deposits', tab: 'sources' })).toBe('/deposits?tab=sources')
  })

  it('메뉴 "입금 확인 2"(수는 글자로), 지금 화면은 aria-current — 다른 기기의 처리 알림으로 목록·수가 바로 바뀐다', async () => {
    await open([deposit(1), deposit(2)])
    // 휴대폰(D-NAV-01): "더보기"가 지금 위치이고 수는 붙이지 않는다 — 수는 목록 안 "입금 확인 2"에서 (AC-NAV-04·05)
    const more = within(menuNav()).getByRole('button', { name: '더보기' })
    expect(more.getAttribute('aria-current')).toBe('page')
    const menuLink = within(openMore()).getByRole('link', { name: '입금 확인 2' })
    expect(menuLink.getAttribute('aria-current')).toBe('page')
    expect(menuLink.getAttribute('href')).toBe('/deposits')
    expect(screen.getByRole('tab', { name: '확인 필요 2' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('listitem').filter((item) => item.getAttribute('aria-label')?.startsWith('입금 번호 '))).toHaveLength(2) // MOB2 D-MOB2-05
    // 다른 기기가 #2를 확정함
    api.deposits[1] = { ...(api.deposits[1] as DepositView), status: 'APPLIED' }
    stream.emit('deposit', { deposits: [2], review: 1, sources: [] })
    await flush()
    // 열어 둔 목록의 수가 바로 바뀐다 (AC-NAV-05), "더보기" 이름은 그대로
    expect(within(within(menuNav()).getByRole('list')).getByRole('link', { name: '입금 확인 1' })).toBeDefined()
    expect(more.textContent).toBe('더보기')
    await waitFor(() => expect(screen.queryByRole('listitem', { name: '입금 번호 2' })).toBeNull()) // MOB2 D-MOB2-05
    expect(card(1)).toBeDefined()
  })

  it('실제 범위의 판매 기록(change)이 오면 1초 뒤 확인 필요를 다시 받는다(사유·제안은 볼 때 다시 계산) — 리허설 기록은 아니다', async () => {
    await open([deposit(1)])
    const lists = () => api.server.callsTo('GET', /^\/api\/deposits\?/).length
    const before = lists()
    stream.emit('change', { date: D_DATE, rehearsal: true, seq: 5 })
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await flush()
    expect(lists()).toBe(before)
    for (let seq = 6; seq < 10; seq++) stream.emit('change', { date: D_DATE, rehearsal: false, seq })
    // 여럿이 와도 한 번 (부하가 큰 기계에서 타이머가 늦어도 되게 기다림은 상태로)
    await waitFor(() => expect(lists()).toBe(before + 1), { timeout: 3000 })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(lists()).toBe(before + 1)
  })

  it('확인 필요가 없으면 메뉴에 수를 붙이지 않는다', async () => {
    await open([])
    expect(within(openMore()).getByRole('link', { name: '입금 확인' }).textContent).toBe('입금 확인')
    expect(screen.getByText('확인할 입금이 없어요.')).toBeDefined()
  })
})

describe('확인 필요 목록 (AC-N3-41·49·50)', () => {
  it('휴대폰: 입금마다 카드 — 시각(KST)·이름(빈 이름은 "(이름 없음)")·금액·원천·사유 문장·제안·미리 고른 묶음', async () => {
    await open([
      deposit(3, { name: '', review: { reason: 'NO_MATCH', twin: null, suggestions: [], preselect: null } }),
      deposit(7, { name: '<script>alert(1)</script>', source: { id: 'p', kind: 'POPBILL', label: '국민 1234' }, precision: 'minute', at: '2026-10-18T12:03:00.000Z' }),
      deposit(9, {
        name: '=1+2',
        review: {
          reason: 'POSSIBLE_DUPLICATE',
          twin: 7,
          suggestions: [bundle(), bundle({ buyer: 'UC_B', name: '다육이맘 · 끝 1234', payment: 'PAID', received: 14000, remaining: 0, after: { payment: 'OVERPAID', received: 28000, refundDue: 14000 }, beforeSale: true })],
          preselect: null,
        },
      }),
    ])
    expect(screen.queryByRole('table')).toBeNull()
    const three = card(3).textContent ?? ''
    expect(three).toContain('입금 시각10/18 21:03:15')
    expect(three).toContain('입금자명(이름 없음)')
    expect(three).toContain('금액14,000원')
    expect(three).toContain('원천시험용 입금')
    expect(three).toContain('맞는 묶음을 찾지 못했어요')
    expect((within(card(3)).getByRole('button', { name: '확정' }) as HTMLButtonElement).disabled).toBe(true)
    const seven = card(7)
    expect(seven.textContent).toContain('입금 시각10/18 21:03')
    expect(seven.textContent).not.toContain('21:03:')
    expect(seven.textContent).toContain('원천계좌조회 · 국민 1234')
    // 이름은 글자 그대로 (스크립트로 해석하지 않는다)
    expect(seven.textContent).toContain('<script>alert(1)</script>')
    expect(document.querySelector('main script')).toBeNull()
    expect(seven.textContent).toContain('금액은 맞는데 이름이 달라요')
    const radios = within(within(seven).getByRole('radiogroup', { name: '입금 번호 7 묶음' })).getAllByRole('radio') as HTMLInputElement[] // MOB2 D-MOB2-05
    expect(radios.map((radio) => radio.checked)).toEqual([true])
    expect(seven.textContent).toContain('다육이맘 · 2026년 10월 18일 묶음 · 남은 금액 14,000원 · 미입금 → 입금 완료')
    expect((within(seven).getByRole('button', { name: '확정' }) as HTMLButtonElement).disabled).toBe(false)
    const nine = card(9)
    expect(nine.textContent).toContain('=1+2')
    expect(nine.textContent).toContain('같은 입금이 두 번 들어왔을 수 있어요 (입금 번호 7과 같아요)') // MOB2 D-MOB2-05
    expect(nine.textContent).toContain('입금 완료 → 과입금(환불 필요 14,000원)')
    expect(nine.textContent).toContain('입금 시각이 이 묶음의 판매보다 먼저예요.')
    // 미리 고른 묶음이 없으면 확정은 누를 수 없다 — 고르면 누를 수 있다
    expect((within(nine).getByRole('button', { name: '확정' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(nine).getAllByRole('radio')[0] as HTMLElement)
    expect((within(nine).getByRole('button', { name: '확정' }) as HTMLButtonElement).disabled).toBe(false)
    for (const name of ['다른 묶음 지정', '무시', '자세히']) expect(within(nine).getByRole('button', { name })).toBeDefined()
    // 영어 상태값·개발 용어가 보이지 않는다 (AC-N3-50)
    const text = main().textContent ?? ''
    for (const word of ['REVIEW', 'AUTO_APPLIED', 'POPBILL', 'FAKE', 'NAME_MISMATCH', 'POSSIBLE_DUPLICATE', 'NO_MATCH', 'requestId', 'tid']) expect(text).not.toContain(word)
  })

  it('PC(48rem 이상): 열 머리가 있는 표 — 한 줄 = 입금 하나 ("입금 번호 7")', async () => { // MOB2 D-MOB2-05
    wide()
    await open([deposit(7)])
    const table = screen.getByRole('table', { name: '확인 필요 입금' })
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['고르기', '번호', '입금 시각', '입금자명', '금액', '원천', '사유와 묶음', '처리'])
    const row = within(table).getByRole('row', { name: '입금 번호 7' }) // MOB2 D-MOB2-05
    // "번호" 칸은 숫자만 — "#"은 쓰지 않는다 (D-MOB2-12, AC-MOB2-21)
    expect(row.querySelector('.deposit-no')?.textContent).toBe('7') // MOB2 D-MOB2-12
    expect(row.textContent).not.toContain('#') // MOB2 D-MOB2-12
    expect(row.textContent).toContain('10/18 21:03:15')
    expect(within(row).getByRole('button', { name: '확정' })).toBeDefined()
  })

  it('주 버튼(채운 색)은 많아야 하나 — 고른 줄이 있으면 "선택한 입금 확정 (N건)"만', async () => {
    await open([deposit(1), deposit(2)])
    expect(main().querySelectorAll('.button-primary')).toHaveLength(0)
    fireEvent.click(within(card(1)).getByRole('checkbox', { name: '입금 번호 1 고르기' })) // MOB2 D-MOB2-05
    fireEvent.click(within(card(2)).getByRole('checkbox', { name: '입금 번호 2 고르기' })) // MOB2 D-MOB2-05
    const group = screen.getByRole('group', { name: '선택한 입금' })
    expect(within(group).getByRole('button', { name: '선택한 입금 확정 (2건)' }).className).toContain('button-primary')
    expect(within(group).getByRole('button', { name: '선택한 입금 무시 (2건)' })).toBeDefined()
    expect(main().querySelectorAll('.button-primary')).toHaveLength(1)
  })
})

describe('확정 창 (AC-N3-42)', () => {
  it('한 건: 누구의 어느 날 묶음에 얼마를 적고 상태가 어떻게 바뀌는지 → 확인 뒤 바로 보낸다 (기억 고르기는 기본 골라짐)', async () => {
    await open([deposit(5, { review: { reason: 'NAME_MISMATCH', twin: null, suggestions: [bundle({ canRemember: true })], preselect: { date: D_DATE, buyer: 'UC_A' } } })])
    fireEvent.click(within(card(5)).getByRole('button', { name: '확정' }))
    const dlg = dialog()
    expect(dlg.textContent).toContain('다육이맘 · 2026년 10월 18일 묶음 · 14,000원 입금 · 미입금 → 입금 완료')
    const remember = within(dlg).getByRole('checkbox', { name: '다음에도 이 입금자명이면 이 구매자로 볼게요' }) as HTMLInputElement
    expect(remember.checked).toBe(true)
    // 5초 대기 없이 바로
    fireEvent.click(within(dlg).getByRole('button', { name: '확정' }))
    await flush(10)
    const sent = api.server.callsTo('POST', /^\/api\/deposits\/5\/confirm$/)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.body).toMatchObject({ date: D_DATE, buyer: 'UC_A', remaining: 14000, remember: true })
    expect(typeof sent[0]?.body?.requestId).toBe('string')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('입금 번호 5: 다육이맘 · 2026년 10월 18일(일) 묶음에 적었어요.') // MOB2 D-MOB2-05
    expect(screen.queryByRole('listitem', { name: '입금 번호 5' })).toBeNull() // MOB2 D-MOB2-05
  })

  it('기억 고르기를 끄면 remember: false, 이름 후보에 있거나 문자 구매자면(canRemember 거짓) 고르기가 없다', async () => {
    await open([deposit(5, { review: { reason: 'NAME_MISMATCH', twin: null, suggestions: [bundle({ canRemember: true })], preselect: { date: D_DATE, buyer: 'UC_A' } } }), deposit(6)])
    fireEvent.click(within(card(5)).getByRole('button', { name: '확정' }))
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: '다음에도 이 입금자명이면 이 구매자로 볼게요' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: '확정' }))
    await flush(10)
    expect(api.server.callsTo('POST', /^\/api\/deposits\/5\/confirm$/)[0]?.body?.remember).toBe(false)
    fireEvent.click(within(card(6)).getByRole('button', { name: '확정' }))
    expect(within(dialog()).queryByRole('checkbox')).toBeNull()
  })

  it('과입금이 새로 생기면 주의 색과 "환불 필요 4,000원"', async () => {
    const over = bundle({ payment: 'PARTIAL', received: 10000, remaining: 4000, after: { payment: 'OVERPAID', received: 24000, refundDue: 10000 - 0 } })
    await open([deposit(5, { review: { reason: 'AMOUNT_MISMATCH', twin: null, suggestions: [{ ...over, after: { payment: 'OVERPAID', received: 18000, refundDue: 4000 } }], preselect: { date: D_DATE, buyer: 'UC_A' } } })])
    fireEvent.click(within(card(5)).getByRole('button', { name: '확정' }))
    const line = within(dialog()).getByRole('listitem')
    expect(line.getAttribute('data-tone')).toBe('warning')
    expect(line.textContent).toContain('부분 입금 → 과입금(환불 필요 4,000원)')
    expect(line.textContent).toContain('환불 필요 4,000원')
  })

  it('BUNDLE_CHANGED: 서버 문장을 보이고 목록을 새로 받는다 — 창을 닫아 같은 값으로 다시 보내지 않는다', async () => {
    await open([deposit(5)])
    api.failNext = apiError(409, 'BUNDLE_CHANGED', '묶음 금액이 바뀌었어요. 다시 확인해 주세요.')
    const lists = api.server.callsTo('GET', /^\/api\/deposits\?/).length
    fireEvent.click(within(card(5)).getByRole('button', { name: '확정' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: '확정' }))
    await flush(10)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('묶음 금액이 바뀌었어요. 다시 확인해 주세요.')
    expect(api.server.callsTo('GET', /^\/api\/deposits\?/).length).toBeGreaterThan(lists)
    expect(api.server.callsTo('POST', /^\/api\/deposits\/5\/confirm$/)).toHaveLength(1)
  })

  it('그 밖의 거절은 서버 문장을 그대로 한 문장으로 (기술 상세는 접어 둔다)', async () => {
    await open([deposit(5)])
    api.failNext = apiError(409, 'DEPOSIT_APPLIED', '이미 반영한 입금이에요.')
    fireEvent.click(within(card(5)).getByRole('button', { name: '확정' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: '확정' }))
    await flush(10)
    const alert = within(dialog()).getByRole('alert')
    expect(alert.textContent).toContain('이미 반영한 입금이에요.')
    expect(within(alert).getByText('자세히').closest('details')?.open).toBe(false)
  })

  it('한꺼번에: 고른 줄마다 한 줄 → 항목마다 결과 (거절 항목의 문장), 묶음을 고르지 않은 줄이 있으면 확정할 수 없다', async () => {
    await open([deposit(1), deposit(2), deposit(3, { review: { reason: 'NO_MATCH', twin: null, suggestions: [], preselect: null } })])
    for (const no of [1, 2, 3]) fireEvent.click(within(card(no)).getByRole('checkbox', { name: `입금 번호 ${String(no)} 고르기` })) // MOB2 D-MOB2-05
    expect((screen.getByRole('button', { name: '선택한 입금 확정 (3건)' }) as HTMLButtonElement).disabled).toBe(true)
    expect(main().textContent).toContain('묶음을 고르지 않은 입금이 있어요(입금 번호 3). 묶음을 고른 뒤 확정해 주세요.') // MOB2 D-MOB2-05
    fireEvent.click(within(card(3)).getByRole('checkbox', { name: '입금 번호 3 고르기' })) // MOB2 D-MOB2-05
    api.failFor.set(1, apiError(409, 'BUNDLE_CHANGED', '묶음 금액이 바뀌었어요. 다시 확인해 주세요.'))
    fireEvent.click(screen.getByRole('button', { name: '선택한 입금 확정 (2건)' }))
    const dlg = dialog()
    expect(within(dlg).getByRole('heading').textContent).toBe('선택한 입금 확정 (2건)')
    expect(within(within(dlg).getByRole('list', { name: '확정할 입금' })).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(within(dlg).getByRole('button', { name: '2건 확정' }))
    await flush(10)
    const sent = api.server.callsTo('POST', /^\/api\/deposits\/bulk$/)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.body?.items).toEqual([
      { no: 2, action: 'confirm', date: D_DATE, buyer: 'UC_A', remaining: 14000, remember: false },
      { no: 1, action: 'confirm', date: D_DATE, buyer: 'UC_A', remaining: 14000, remember: false },
    ])
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('입금 1건을 확정했어요. 1건은 확정하지 못했어요.')
    expect(status.textContent).toContain('입금 번호 1: 묶음 금액이 바뀌었어요. 다시 확인해 주세요.') // MOB2 D-MOB2-05
  })

  it('한꺼번에 무시: 확인 창 뒤 보낸다', async () => {
    await open([deposit(1), deposit(2)])
    for (const no of [1, 2]) fireEvent.click(within(card(no)).getByRole('checkbox', { name: `입금 번호 ${String(no)} 고르기` })) // MOB2 D-MOB2-05
    fireEvent.click(screen.getByRole('button', { name: '선택한 입금 무시 (2건)' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: '2건 무시' }))
    await flush(10)
    expect(api.server.callsTo('POST', /^\/api\/deposits\/bulk$/)[0]?.body?.items).toEqual([
      { no: 2, action: 'ignore' },
      { no: 1, action: 'ignore' },
    ])
    expect(screen.getByRole('status').textContent).toContain('입금 2건을 무시했어요.')
  })

  it('무시(한 건)는 바로 보내고 되돌릴 수 있다고 알린다', async () => {
    await open([deposit(4)])
    fireEvent.click(within(card(4)).getByRole('button', { name: '무시' }))
    await flush(10)
    expect(api.server.callsTo('POST', /^\/api\/deposits\/4\/ignore$/)).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toContain('입금 번호 4: 무시했어요. "무시함"에서 다시 확인 필요로 옮길 수 있어요.') // MOB2 D-MOB2-05
  })
})

describe('다른 묶음 지정 (AC-N3-43)', () => {
  it('찾기 칸·날짜 고르기(연도·요일)로 찾고, 고르면 확정 창으로 — 입금 완료 묶음은 과입금이 됨을, 판매 전 입금은 그 문장을 보인다', async () => {
    await open([deposit(8, { review: { reason: 'NO_MATCH', twin: null, suggestions: [], preselect: null } })], 'review', (server) => {
      server.bundles = [
        bundle({ buyer: 'UC_B', name: '초록이', date: '2026-10-17', payment: 'PAID', received: 14000, remaining: 0, after: { payment: 'OVERPAID', received: 28000, refundDue: 14000 }, beforeSale: true }),
      ]
    })
    fireEvent.click(within(card(8)).getByRole('button', { name: '다른 묶음 지정' }))
    await flush(10)
    const dlg = dialog()
    const date = within(dlg).getByLabelText('날짜') as HTMLSelectElement
    expect([...date.options].map((option) => option.textContent)).toEqual(['입금 날짜 앞뒤 (60일 전 ~ 30일 뒤)', '2026년 10월 18일(일)', '2026년 10월 17일(토)'])
    fireEvent.change(within(dlg).getByLabelText('찾을 말 (구매자 이름·닉네임·메모·전화번호 뒤 4자리)'), { target: { value: '초록' } })
    fireEvent.change(date, { target: { value: '2026-10-17' } })
    await new Promise((resolve) => setTimeout(resolve, 300))
    await flush(5)
    const last = api.server.callsTo('GET', /^\/api\/deposits\/8\/bundles/).at(-1)
    expect(last?.path).toBe('/api/deposits/8/bundles?q=%EC%B4%88%EB%A1%9D&date=2026-10-17')
    const choice = within(dlg).getByRole('button', { name: /초록이/ })
    expect(choice.textContent).toContain('입금 완료 → 과입금(환불 필요 14,000원)')
    expect(choice.textContent).toContain('입금 시각이 이 묶음의 판매보다 먼저예요.')
    fireEvent.click(choice)
    const confirm = dialog()
    expect(confirm.textContent).toContain('초록이 · 2026년 10월 17일 묶음 · 14,000원 입금 · 입금 완료 → 과입금(환불 필요 14,000원)')
    expect(confirm.textContent).toContain('입금 시각이 이 묶음의 판매보다 먼저예요.')
    fireEvent.click(within(confirm).getByRole('button', { name: '확정' }))
    await flush(10)
    expect(api.server.callsTo('POST', /^\/api\/deposits\/8\/confirm$/)[0]?.body).toMatchObject({ date: '2026-10-17', buyer: 'UC_B', remaining: 0 })
  })
})

describe('자동 확인됨·확인함·무시함 (AC-N3-44)', () => {
  const applied = (no: number, auto: boolean) =>
    deposit(no, { status: auto ? 'AUTO_APPLIED' : 'APPLIED', applied: { date: D_DATE, buyer: 'UC_A', buyerName: '다육이맘', seq: 12, auto }, review: undefined } as never)

  it('반영한 묶음과 낱말, "되돌리기"는 확인 창 뒤 보내고 409 문장을 그대로 보인다', async () => {
    await open([applied(1, true), applied(2, false)], 'done')
    expect(card(1).textContent).toContain('반영한 묶음다육이맘 · 2026년 10월 18일 묶음')
    expect(card(1).textContent).toContain('자동 확인됨')
    expect(card(2).textContent).toContain('확인함')
    fireEvent.click(within(card(1)).getByRole('button', { name: '되돌리기' }))
    expect(dialog().textContent).toContain('다육이맘 · 10월 18일 묶음에 적은 14,000원 입금을 되돌려요. 같은 금액의 환불 기록이 남고 이 입금은 확인 필요로 돌아가요.')
    api.failNext = apiError(409, 'REFUND_RECORDED', '이미 환불을 적어서 되돌릴 수 없어요. 정산에서 확인해 주세요.')
    fireEvent.click(within(dialog()).getByRole('button', { name: '되돌리기' }))
    await flush(10)
    expect(within(dialog()).getByRole('alert').textContent).toContain('이미 환불을 적어서 되돌릴 수 없어요. 정산에서 확인해 주세요.')
    fireEvent.click(within(dialog()).getByRole('button', { name: '되돌리기' }))
    await flush(10)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.server.callsTo('POST', /^\/api\/deposits\/1\/revert$/)).toHaveLength(2)
    expect(screen.getByRole('status').textContent).toContain('입금 번호 1: 되돌렸어요.') // MOB2 D-MOB2-05
    expect(screen.queryByRole('listitem', { name: '입금 번호 1' })).toBeNull() // MOB2 D-MOB2-05
  })

  it('무시함: 줄마다 "다시 확인 필요로"', async () => {
    await open([deposit(3, { status: 'IGNORED', review: undefined } as never)], 'ignored')
    fireEvent.click(within(card(3)).getByRole('button', { name: '다시 확인 필요로' }))
    await flush(10)
    expect(api.server.callsTo('POST', /^\/api\/deposits\/3\/reopen$/)).toHaveLength(1)
    expect(screen.getByText('무시한 입금이 없어요.')).toBeDefined()
  })

  it('입금 하나를 열면 처리 기록(누가·언제·무엇)을 시간 순서로', async () => {
    await open([applied(1, true)], 'done', (server) => {
      server.actions.set(1, [
        { action: 'RECEIVED', actor: { kind: 'auto', loginId: null }, at: '2026-10-18T12:05:00.000Z', date: null, buyer: null, buyerName: null, seq: null },
        { action: 'AUTO', actor: { kind: 'auto', loginId: null }, at: '2026-10-18T12:05:01.000Z', date: D_DATE, buyer: 'UC_A', buyerName: '다육이맘', seq: 12 },
        { action: 'REVERT', actor: { kind: 'account', loginId: 'shop1' }, at: '2026-10-18T12:10:00.000Z', date: D_DATE, buyer: 'UC_A', buyerName: '다육이맘', seq: 13 },
      ])
    })
    fireEvent.click(within(card(1)).getByRole('button', { name: '자세히' }))
    await flush(10)
    const history = within(dialog()).getByRole('region', { name: '처리 기록' })
    expect(within(history).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '10/18 21:05:00받음입금 자동 확인',
      '10/18 21:05:01자동 확인입금 자동 확인다육이맘 · 2026년 10월 18일 묶음', // MOB2 D-MOB2-05
      '10/18 21:10:00되돌리기shop1다육이맘 · 2026년 10월 18일 묶음', // MOB2 D-MOB2-05
    ])
  })
})

describe('붙여넣기 (AC-N3-45)', () => {
  const PREVIEW = {
    rows: [
      { line: 3, at: '2026-10-18T21:03:00+09:00', precision: 'minute' as const, amount: 14000, name: '김영희', balance: null, state: 'NEW' as const },
      { line: 4, at: '2026-10-18T21:04:05+09:00', precision: 'second' as const, amount: 9000, name: '', balance: 1000, state: 'EXISTING' as const },
    ],
    skipped: [{ line: 5, why: 'NOT_DEPOSIT' as const }],
    unreadable: [
      { line: 6, why: 'BAD_AMOUNT' as const },
      { line: 7, why: 'BAD_TIME' as const },
    ],
  }

  it('읽어 보기 → 미리 보기(낱말로 구분, 읽지 못한 줄 번호·이유) → "입금 내역 넣기"(주 버튼) → 결과 문장, 글 칸을 비운다', async () => {
    await open([], 'paste', (server) => {
      server.preview = PREVIEW
      server.pasteSummary = { read: 6, skipped: 1, unreadable: PREVIEW.unreadable, new: 5, existing: 1, old: 0, future: 0, auto: 3, review: 2 }
    })
    const insert = screen.getByRole('button', { name: '입금 내역 넣기' }) as HTMLButtonElement
    expect(insert.className).toContain('button-primary')
    expect(insert.disabled).toBe(true)
    const field = screen.getByLabelText('입금 내역') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: '거래일시\t입금액\n...' } })
    fireEvent.click(screen.getByRole('button', { name: '읽어 보기' }))
    await flush(10)
    expect(api.server.callsTo('POST', /^\/api\/deposits\/paste\/preview$/)[0]?.body).toEqual({ text: '거래일시\t입금액\n...' })
    const result = screen.getByRole('region', { name: '읽어 본 결과' })
    expect(result.textContent).toContain('읽은 입금 2건 · 건너뛴 줄 1개(출금 등) · 읽지 못한 줄 2개')
    expect(result.textContent).toContain('새 입금 1건 · 이미 있는 입금 1건 · 오래된 입금 0건 · 시각이 앞으로인 입금 0건')
    expect(within(result).getByRole('list', { name: '읽지 못한 줄' }).textContent).toBe('6번째 줄: 금액을 읽지 못했어요7번째 줄: 시각을 읽지 못했어요(분까지 필요해요)')
    const rows = within(within(result).getByRole('list', { name: '읽은 입금' })).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual(['새 입금 3번째 줄10/18 21:03 · 김영희 · 14,000원', '이미 있는 입금 4번째 줄10/18 21:04:05 · (이름 없음) · 9,000원'])
    // 미리 본 뒤 글이 바뀌면 다시 읽어 봐야 넣는다
    fireEvent.change(field, { target: { value: '거래일시\t입금액\n...!' } })
    expect(insert.disabled).toBe(true)
    fireEvent.change(field, { target: { value: '거래일시\t입금액\n...' } })
    expect(insert.disabled).toBe(false)
    fireEvent.click(insert)
    await flush(10)
    const sent = api.server.callsTo('POST', /^\/api\/deposits\/paste$/)
    expect(sent[0]?.body).toMatchObject({ text: '거래일시\t입금액\n...' })
    expect(typeof sent[0]?.body?.requestId).toBe('string')
    expect(screen.getByRole('status').textContent).toContain('새 입금 5건 — 자동 확인 3건, 확인 필요 2건 (이미 있던 입금 1건)')
    expect(field.value).toBe('')
  })

  it('머리글 없음은 서버 문장을 그대로', async () => {
    await open([], 'paste', (server) => {
      server.preview = apiError(400, 'PASTE_NO_HEADER', '표의 첫 줄(거래일시·입금액 같은 칸 이름)을 함께 붙여 넣어 주세요.')
    })
    fireEvent.change(screen.getByLabelText('입금 내역'), { target: { value: '2026-10-18 21:03,14000' } })
    fireEvent.click(screen.getByRole('button', { name: '읽어 보기' }))
    await flush(10)
    expect(screen.getByRole('alert').textContent).toContain('표의 첫 줄(거래일시·입금액 같은 칸 이름)을 함께 붙여 넣어 주세요.')
  })

  it('CSV 파일(EUC-KR)을 고르면 글 칸에 읽어 넣고 바로 읽어 본다', async () => {
    await open([], 'paste', (server) => {
      server.preview = PREVIEW
    })
    const hex = 'b0c5b7a1c0cfbdc32cc0d4b1ddbed72cc0d4b1ddc0dab8ed0a323032362d31302d31382032313a30332c31343030302cb1e8bfb5c8f10a'
    const bytes = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
    const input = screen.getByLabelText('CSV 파일 고르기')
    fireEvent.change(input, { target: { files: [new File([bytes], '거래내역.csv', { type: 'text/csv' })] } })
    await flush(10)
    expect((screen.getByLabelText('입금 내역') as HTMLTextAreaElement).value).toBe('거래일시,입금액,입금자명\n2026-10-18 21:03,14000,김영희\n')
    expect(api.server.callsTo('POST', /^\/api\/deposits\/paste\/preview$/)[0]?.body?.text).toBe('거래일시,입금액,입금자명\n2026-10-18 21:03,14000,김영희\n')
  })
})

describe('계좌 연동 (AC-N3-46)', () => {
  it('원천 목록: 표시 이름·종류·켜짐·주기·마지막으로 받아 온 때·오류 문장, 지금 받아 오기·주기·끄기 — 붙여넣기는 받아 오기가 없다', async () => {
    await open([], 'sources', (server) => {
      server.sources = [
        source({ id: 'dsrc_p', kind: 'POPBILL', label: '국민 1234', bank: '0004', accountLast4: '5678', lastError: '팝빌 연결을 확인해 주세요.', lastErrorAt: '2026-10-18T12:06:00.000Z' }),
        source({ id: 'dsrc_paste', kind: 'PASTE', label: '붙여넣기', fetchable: false, lastFetchedAt: null, lastNew: null }),
      ]
    })
    const popbill = screen.getByRole('listitem', { name: '원천 국민 1234' })
    expect(popbill.textContent).toContain('국민 1234 · 계좌조회 · 국민은행 계좌 끝 5678 · 켜짐 · 5분마다')
    expect(popbill.textContent).toContain('마지막으로 받아 온 때 10/18 21:05 · 새 입금 2건')
    expect(popbill.textContent).toContain('팝빌 연결을 확인해 주세요. (10/18 21:06)')
    const paste = screen.getByRole('listitem', { name: '원천 붙여넣기' })
    expect(within(paste).queryByRole('button', { name: '지금 받아 오기' })).toBeNull()
    fireEvent.click(within(popbill).getByRole('button', { name: '지금 받아 오기' }))
    await flush(10)
    expect(api.server.callsTo('POST', /^\/api\/deposits\/sources\/dsrc_p\/fetch$/)).toHaveLength(1)
    fireEvent.change(within(popbill).getByLabelText('받아 오는 주기'), { target: { value: '2' } })
    await flush(10)
    expect(api.server.callsTo('PATCH', /^\/api\/deposits\/sources\/dsrc_p$/)[0]?.body).toEqual({ intervalMin: 2 })
    fireEvent.click(within(screen.getByRole('listitem', { name: '원천 국민 1234' })).getByRole('button', { name: '끄기' }))
    await flush(10)
    expect(api.server.callsTo('PATCH', /^\/api\/deposits\/sources\/dsrc_p$/)[1]?.body).toEqual({ enabled: false })
    expect(screen.getByRole('listitem', { name: '원천 국민 1234' }).textContent).toContain('꺼짐')
  })

  it('연동 키가 없는 서버: 추가 대신 준비 중 문장, 시험 모드에서만 시험용 입금 원천 추가', async () => {
    await open([], 'sources')
    expect(screen.getByText('계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요.')).toBeDefined()
    expect(screen.queryByLabelText('사업자번호')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '시험용 입금 원천 추가' }))
    await flush(10)
    expect(api.server.callsTo('POST', /^\/api\/deposits\/sources$/)[0]?.body).toEqual({ kind: 'FAKE' })
    cleanup()
    store.stop()
    await open([], 'sources', (server) => {
      server.testMode = false
    })
    expect(screen.queryByRole('button', { name: '시험용 입금 원천 추가' })).toBeNull()
  })

  it('계좌조회 원천 추가: 번호 칸은 숫자 키패드, 비밀번호 칸은 없고 "계좌 비밀번호는 여기에 적지 않아요." — 보낸 뒤 칸을 비운다', async () => {
    await open([], 'sources', (server) => {
      server.popbill = true
    })
    expect(screen.getByText('계좌 비밀번호는 여기에 적지 않아요. 팝빌 계좌 관리에서 등록해요.')).toBeDefined()
    expect(screen.getByRole('button', { name: '팝빌에서 계좌 등록·관리' })).toBeDefined()
    expect(document.querySelector('input[type=password]')).toBeNull()
    const corp = screen.getByLabelText('사업자번호') as HTMLInputElement
    const account = screen.getByLabelText('계좌번호') as HTMLInputElement
    expect(corp.inputMode).toBe('numeric')
    expect(account.inputMode).toBe('numeric')
    fireEvent.change(screen.getByLabelText('표시 이름'), { target: { value: '국민 1234' } })
    fireEvent.change(corp, { target: { value: '123-45-67890' } })
    fireEvent.change(screen.getByLabelText('은행'), { target: { value: '0004' } })
    fireEvent.change(account, { target: { value: '123456-78-901234' } })
    fireEvent.click(screen.getByRole('button', { name: '계좌 연결' }))
    await flush(10)
    expect(api.server.callsTo('POST', /^\/api\/deposits\/sources$/)[0]?.body).toEqual({ kind: 'POPBILL', label: '국민 1234', corpNum: '123-45-67890', bank: '0004', accountNumber: '123456-78-901234' })
    expect(corp.value).toBe('')
    expect(account.value).toBe('')
  })

  it('기억한 입금자명(입금자명 → 구매자 표시 이름)과 "지우기"(확인 뒤)', async () => {
    await open([], 'sources', (server) => {
      server.names = [{ id: 4, name: '김영희', buyerName: '다육이맘', createdAt: '2026-10-17T12:00:00.000Z' }]
    })
    const item = screen.getByRole('listitem', { name: '김영희 → 다육이맘' })
    fireEvent.click(within(item).getByRole('button', { name: '지우기' }))
    expect(dialog().textContent).toContain('이 입금자명을 지울까요?')
    fireEvent.click(within(dialog()).getByRole('button', { name: '지우기' }))
    await flush(10)
    const sent = api.server.callsTo('DELETE', /^\/api\/deposits\/names\/4$/)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.body).toEqual({})
    expect(screen.getByText('기억한 입금자명이 없어요.')).toBeDefined()
  })
})
