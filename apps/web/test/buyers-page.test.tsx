// 구매자 화면 (AC-S06-20~24, AC-S06b-20·24·33·34·40, BUY-03·BUY-04, D-090·D-091·D-098~D-102). 실제 코어로 도는 가짜 서버(합치기 미리 보기는 코어 previewMerge).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { BuyersPage } from '../src/components/BuyersPage.tsx'
import type { Route, ScopeRoute } from '../src/lib/router.ts'
import { chat, register, sms } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, apiError, failWrites, flush } from './support.ts'

let engine: EngineServer
let routes: Route[]

const KEY = 'phonekey-aaaaaaaaaaaaaa'
const BASE = [
  register(15, '핑크프릴', 10000),
  register(16, '청보석', 20000, 'b2'),
  register(17, '금황', 5000),
  chat('m1', 'UC_hong1234', '홍길동', '15'), // 홍길동 15 1등
  sms('r1', 15, { phoneKey: KEY, phoneLast4: '5678', memo: '김씨' }), // 문자 15 대기 1번
  sms('r2', 16, { phoneKey: KEY, phoneLast4: '5678' }, 'b2'), // 같은 번호 → 같은 문자 구매자, 2부 16 1등
  chat('m3', 'UC_kim5555', '김철수', '17'),
  chat('m4', 'UC_watch0001', '구경꾼', '안녕하세요'),
]

function Harness({ initial }: { readonly initial: ScopeRoute }) {
  const [route, setRoute] = useState<Route>(initial)
  return route.name === 'buyers' ? (
    <BuyersPage
      route={route}
      navigate={(next) => {
        routes.push(next)
        setRoute(next)
      }}
    />
  ) : (
    <p>다른 화면</p>
  )
}

async function open(events: Record<string, unknown>[] = BASE, initial: ScopeRoute = { name: 'buyers', date: DATE, rehearsal: false }) {
  engine = new EngineServer(events)
  vi.stubGlobal('fetch', engine.server.fetch)
  render(<Harness initial={initial} />)
  await flush(10)
}

beforeEach(() => {
  routes = []
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

const list = () => screen.getByRole('list', { name: '구매자' })

describe('구매자 목록·찾기 (AC-S06-20·21)', () => {
  it('날짜가 없으면 오늘(없으면 가장 최근) 실제 범위를 주소에 적는다', async () => {
    await open(BASE, { name: 'buyers', rehearsal: false })
    expect(routes.at(-1)).toEqual({ name: 'buyers', date: DATE, rehearsal: false })
    expect(screen.getByLabelText('날짜')).toBeDefined()
  })

  it('기본은 확정 찜이 있는 지금의 구매자 — 종류·구분 표시·상품 수·합계·입금 상태, 위에 "구매자 n명 · 합계 n원"', async () => {
    await open()
    const rows = within(list()).getAllByRole('link').map((link) => link.textContent)
    expect(rows).toEqual(['김철수유튜브1개 · 5,000원미입금', '문자찜(김씨)문자1개 · 20,000원미입금', '홍길동유튜브1개 · 10,000원미입금'])
    expect(screen.getByText('구매자 3명 · 합계 35,000원')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '합계 큰 순' }))
    expect(within(list()).getAllByRole('link')[0]?.textContent).toContain('문자찜(김씨)')
    fireEvent.click(screen.getByLabelText('찜 없는 구매자도 보기'))
    expect(within(list()).getAllByRole('link').map((link) => link.textContent)).toContain('구경꾼유튜브0개 · 0원')
    expect(screen.getByText('합치기는 같은 날짜 안에서만 돼요.')).toBeDefined()
  })

  it('찾기: 뒤 4자리·채널 끝 4자리, 합쳐진 구매자가 걸리면 지금의 구매자 줄과 "○○에 합쳐짐"', async () => {
    await open([...BASE, { type: 'host.cancel', b: 'b2', no: 16, buyer: 'sms:r1', reason: '시청자 요청' }, { type: 'buyer.merge', from: 'sms:r1', into: 'UC_hong1234', reason: '같은 사람' }])
    fireEvent.change(screen.getByLabelText('구매자 찾기'), { target: { value: '5678' } })
    const found = screen.getByRole('list', { name: '찾은 구매자' })
    const links = within(found).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]?.textContent).toContain('홍길동')
    expect(links[0]?.textContent).toContain('합친 구매자 1명')
    expect(links[0]?.textContent).toContain('문자찜(김씨) — 홍길동에 합쳐짐')
    fireEvent.change(screen.getByLabelText('구매자 찾기'), { target: { value: '5555' } })
    expect(within(screen.getByRole('list', { name: '찾은 구매자' })).getByRole('link').textContent).toContain('김철수')
  })
})

describe('PC는 표 (AC-S06b-21, D-101)', () => {
  it('48rem 이상이면 구매자 목록은 열 머리가 있는 표 — 이름·종류·상품 수·합계·입금 상태·표시, 금액 열 오른쪽, 이름 칸 링크로 자세히', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    await open([...BASE, { type: 'host.cancel', b: 'b1', no: 15, buyer: 'sms:r1', reason: '시청자 요청' }, { type: 'buyer.merge', from: 'UC_watch0001', into: 'UC_kim5555', reason: '같은 사람' }])
    const table = screen.getByRole('table', { name: '구매자' })
    const heads = within(table).getAllByRole('columnheader')
    expect(heads.map((th) => th.textContent)).toEqual(['이름', '종류', '상품 수', '합계', '입금 상태', '표시'])
    expect(heads.every((th) => th.getAttribute('scope') === 'col')).toBe(true)
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['김철수', '유튜브', '1개', '5,000원', '미입금', '합친 구매자 1명'],
      ['문자찜(김씨)', '문자', '1개', '20,000원', '미입금', ''],
      ['홍길동', '유튜브', '1개', '10,000원', '미입금', ''],
    ])
    expect(within(rows[0] as HTMLElement).getAllByRole('cell')[3]?.className).toContain('num')
    expect(screen.queryByRole('list', { name: '구매자' })).toBeNull()
    // 찾기 결과도 같은 표
    fireEvent.change(screen.getByLabelText('구매자 찾기'), { target: { value: '구경' } })
    const found = screen.getByRole('table', { name: '찾은 구매자' })
    expect(within(found).getAllByRole('row')[1]?.textContent).toContain('구경꾼 — 김철수에 합쳐짐')
    fireEvent.change(screen.getByLabelText('구매자 찾기'), { target: { value: '' } })
    fireEvent.click(within(screen.getByRole('table', { name: '구매자' })).getByRole('link', { name: '문자찜(김씨)' }))
    await flush()
    expect(routes.at(-1)).toEqual({ name: 'buyers', date: DATE, rehearsal: false, buyer: 'sms:r1' })
  })

  it('같은 메모의 전화번호 없는 문자 구매자 둘은 목록·자세히·합치기 창에서 같은 다른 이름 (AC-S06b-20)', async () => {
    await open([register(15, '핑크프릴', 10000), register(17, '금황', 5000), sms('rA', 15, { memo: '김씨', received: '20:01:05' }), sms('rB', 17, { memo: '김씨', received: '20:02' })])
    const names = within(list()).getAllByRole('link').map((link) => link.querySelector('.buyer-name')?.textContent)
    expect(names).toEqual(['문자찜(김씨) · 문자 20:01:05', '문자찜(김씨) · 문자 20:02'])
    fireEvent.click(within(list()).getByRole('link', { name: /문자 20:02/ }))
    await flush()
    expect(screen.getByRole('heading', { name: '문자찜(김씨) · 문자 20:02' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '다른 구매자와 합치기' }))
    fireEvent.change(screen.getByLabelText('합칠 구매자 찾기'), { target: { value: '김씨' } })
    expect(within(screen.getByRole('list', { name: '합칠 구매자' })).getAllByRole('button').map((button) => button.querySelector('strong')?.textContent)).toEqual(['문자찜(김씨) · 문자 20:01:05'])
    fireEvent.click(within(screen.getByRole('list', { name: '합칠 구매자' })).getAllByRole('button')[0] as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: '구매자 합치기' })
    expect(dialog.textContent).toContain('남는 이름: 문자찜(김씨) · 문자 20:02(문자) ← 문자찜(김씨) · 문자 20:01:05(문자)')
  })
})

describe('자세히 (AC-S06-22)', () => {
  it('종류·메모 이력·뒤 4자리, 방송별 확정 상품(경로)·방송별 합계·전체 합계, 합계에 들지 않는 찜, 정산 요약 — 전화번호 원문은 없다', async () => {
    await open()
    fireEvent.click(within(list()).getByRole('link', { name: /문자찜\(김씨\)/ }))
    await flush()
    expect(routes.at(-1)).toEqual({ name: 'buyers', date: DATE, rehearsal: false, buyer: 'sms:r1' })
    const detail = screen.getByRole('region', { name: '구매자 자세히' })
    const text = detail.textContent ?? ''
    expect(text).toContain('뒤 4자리 5678')
    expect(text).toContain('2부16번 청보석 20,000원 · 문자찜2부 합계 20,000원')
    expect(text).toContain('전체 합계 20,000원')
    expect(within(detail).getByRole('region', { name: '합계에 들지 않는 찜' }).textContent).toContain('15번 대기 1번')
    expect(within(detail).getByRole('region', { name: '정산 요약' }).textContent).toContain('최종 24,000원 · 받은 금액 0원 · 미입금')
    expect(text).not.toMatch(/sms:|010/)
    // 주 버튼이 없다 — 합치기는 보통 버튼, 차단은 위험 버튼 모양 (AC-S06b-24)
    expect(detail.querySelectorAll('.button-primary')).toHaveLength(0)
    expect(within(detail).getByRole('button', { name: '다른 구매자와 합치기' }).className).toBe('button')
    expect(within(detail).getByRole('button', { name: '차단하기' }).className).toContain('button-danger')
    fireEvent.click(within(detail).getByRole('button', { name: '정산 자세히' }))
    expect(routes.at(-1)).toEqual({ name: 'settlements', date: DATE, rehearsal: false, buyer: 'sms:r1' })
  })
})

describe('"문자찜(확인 필요)" 구매자 자세히 (D-V1-22, AC-V1-29)', () => {
  it('위에 안내 한 줄, 첫 버튼 "다른 구매자와 합치기", "차단하기"는 맨 뒤 — 다른 구매자 자세히는 그대로', async () => {
    await open([...BASE, sms('r9', 17, { memo: '확인 필요' })])
    fireEvent.click(screen.getByLabelText('찜 없는 구매자도 보기'))
    await flush()
    fireEvent.click(within(list()).getByRole('link', { name: /문자찜\(확인 필요\)/ }))
    await flush()
    const detail = screen.getByRole('region', { name: '구매자 자세히' })
    expect(detail.textContent).toContain('누구의 문자인지 찾아 합쳐 주세요.')
    const buttons = within(detail).getAllByRole('button').map((button) => button.textContent)
    const merge = buttons.indexOf('다른 구매자와 합치기')
    expect(merge).toBe(buttons.findIndex((label) => label !== '구매자 목록으로'))
    expect(buttons.at(-1)).toBe('차단하기')
    expect(buttons[merge + 1]).not.toBe('차단하기')
    fireEvent.click(within(detail).getByRole('button', { name: '구매자 목록으로' }))
    await flush()
    fireEvent.click(within(list()).getByRole('link', { name: /문자찜\(김씨\)/ }))
    await flush()
    const other = screen.getByRole('region', { name: '구매자 자세히' })
    expect(other.textContent).not.toContain('누구의 문자인지 찾아 합쳐 주세요.')
    const otherButtons = within(other).getAllByRole('button').map((button) => button.textContent)
    expect(otherButtons[otherButtons.indexOf('다른 구매자와 합치기') + 1]).toBe('차단하기')
  })
})

describe('합치기·떼어 내기 (AC-S06-23·24, AC-S06b-33·34, G-ENG-171·172·174)', () => {
  async function openMerge(target: string, from = /문자찜\(김씨\)/) {
    fireEvent.click(within(list()).getByRole('link', { name: from }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '다른 구매자와 합치기' }))
    fireEvent.change(screen.getByLabelText('합칠 구매자 찾기'), { target: { value: target } })
    fireEvent.click(within(screen.getByRole('list', { name: '합칠 구매자' })).getAllByRole('button')[0] as HTMLElement)
    return screen.findByRole('dialog', { name: '구매자 합치기' })
  }
  const previews = () => engine.server.callsTo('GET', /\/merge-preview\?/).map((call) => new URLSearchParams(call.path.slice(call.path.indexOf('?') + 1)))

  it('방향 기본(유튜브가 남음)·미리 보기(서버 계산)·중복 문장, 처음 포커스 "닫기", 사유 숫자 키 → 바로 buyer.merge → "합쳤어요"와 남는 구매자 자세히', async () => {
    await open()
    const dialog = await openMerge('홍길동')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' })))
    // 상대·방향은 주소에 (구매자 ID만)
    expect(routes.at(-1)).toEqual({ name: 'buyers', date: DATE, rehearsal: false, buyer: 'sms:r1', merge: 'UC_hong1234', into: 'UC_hong1234' })
    await waitFor(() => expect(dialog.textContent).toContain('합친 뒤 합계 30,000원'))
    expect(previews().map((params) => [params.get('from'), params.get('into')])).toEqual([['sms:r1', 'UC_hong1234']])
    const text = dialog.textContent ?? ''
    expect(text).toContain('남는 이름: 홍길동(유튜브)')
    expect(text).toContain('옮겨 갈 확정 찜 1개 · 20,000원')
    expect(text).toContain('정산 묶음이 하나가 되어 배송비가 한 번 붙어요')
    expect(text).toContain('합친 뒤 표시 이름은 홍길동이고, 공개 감사 문구의 이름은 바뀌지 않아요.')
    expect(text).toContain('15번: 문자찜(김씨)의 대기 1번 찜이 중복으로 정리돼요')
    expect(text).toContain('떼어 내도 돌아오지 않아요.')
    expect(within(dialog).getByRole('note').getAttribute('data-tone')).toBe('warning')
    fireEvent.click(within(dialog).getByRole('button', { name: '방향 바꾸기' }))
    expect(routes.at(-1)).toMatchObject({ merge: 'UC_hong1234', into: 'sms:r1' })
    await waitFor(() => expect(dialog.textContent).toContain('남는 이름: 문자찜(김씨)(문자)'))
    await waitFor(() => expect(previews().at(-1)?.get('from')).toBe('UC_hong1234'))
    fireEvent.click(within(dialog).getByRole('button', { name: '방향 바꾸기' }))
    await waitFor(() => expect(dialog.textContent).toContain('합친 뒤 합계 30,000원'))
    fireEvent.keyDown(within(dialog).getByRole('button', { name: '닫기' }), { key: '1' })
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '합치기' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '합치기' }))
    const notice = await screen.findByText('합쳤어요')
    expect(notice.getAttribute('data-tone')).toBe('success')
    expect(engine.posts.at(-1)).toMatchObject({ type: 'buyer.merge', from: 'sms:r1', into: 'UC_hong1234', reason: '같은 사람' })
    expect(routes.at(-1)).toEqual({ name: 'buyers', date: DATE, rehearsal: false, buyer: 'UC_hong1234' })
    const detail = screen.getByRole('region', { name: '구매자 자세히' })
    await waitFor(() => expect(within(detail).getByRole('region', { name: '합친 구매자' }).textContent).toContain('문자찜(김씨)'))
    expect(detail.textContent).toContain('전체 합계 30,000원')
  })

  it('G-ENG-174 흐름: 두 사람 모두 1등이면 막힘(합치기 누를 수 없음) → "18번 자세히"(주소 product) → 한쪽 찜 취소(5초 뒤) → "합치기로 돌아가기" → 같은 상대·방향, 새 미리 보기 → 합치기', async () => {
    await open([...BASE, chat('m5', 'UC_hong1234', '홍길동', '16', 'b2'), register(18, '루비', 7000), { type: 'product.update', b: 'b1', no: 18, stock: 2 }, chat('m6', 'UC_hong1234', '홍길동', '18'), sms('r3', 18, { phoneKey: KEY, phoneLast4: '5678' })])
    let dialog = await openMerge('홍길동')
    await waitFor(() => expect(dialog.textContent).toContain('18번에 두 사람 모두 1등이에요. 먼저 한 사람의 찜을 취소해 주세요.'))
    expect(within(dialog).getByRole('alert').getAttribute('data-tone')).toBe('danger')
    expect(dialog.textContent).not.toContain('합친 뒤 합계')
    expect((within(dialog).getByRole('button', { name: '합치기' }) as HTMLButtonElement).disabled).toBe(true)
    const mergeRoute = routes.at(-1)
    // 구매자 화면은 방송을 고르지 않았으므로 상품 앞에 방송 제목을 붙인다 ("1부 18번")
    fireEvent.click(within(dialog).getByRole('button', { name: '1부 18번 자세히' }))
    expect(routes.at(-1)).toEqual({ ...mergeRoute, product: 'b1/18' })
    const product = await screen.findByRole('dialog', { name: '1부 18번 자세히' })
    const rows = within(product).getAllByRole('listitem')
    const smsRow = rows.find((row) => row.textContent?.includes('문자찜')) as HTMLElement
    fireEvent.click(within(smsRow).getByRole('button', { name: '찜 취소하기' }))
    const reason = await screen.findByRole('dialog', { name: '1부 18번 문자찜(김씨) 취소' })
    fireEvent.click(within(reason).getByRole('button', { name: '3 번호 착오' }))
    fireEvent.click(within(reason).getByRole('button', { name: '찜 취소하기' }))
    // 사유 창이 닫히면 상품 자세히가 그대로 — 합치기로 돌아가는 길이 있다
    const again = await screen.findByRole('dialog', { name: '1부 18번 자세히' })
    await waitFor(() => expect(engine.posts.some((post) => post.type === 'host.cancel')).toBe(true))
    await waitFor(() => expect(within(again).getAllByRole('listitem')).toHaveLength(1))
    const before = previews().length
    fireEvent.click(within(again).getByRole('button', { name: '합치기로 돌아가기' }))
    expect(routes.at(-1)).toEqual(mergeRoute)
    dialog = await screen.findByRole('dialog', { name: '구매자 합치기' })
    await waitFor(() => expect(dialog.textContent).toContain('합친 뒤 합계'))
    expect(previews().length).toBeGreaterThan(before)
    expect(dialog.textContent).not.toContain('두 사람 모두 1등')
    fireEvent.change(within(dialog).getByLabelText('사유'), { target: { value: '같은 사람' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '합치기' }))
    expect(await screen.findByText('합쳤어요')).toBeDefined()
  })

  it('주소에 상대·방향이 있으면(새로고침·뒤로 가기) 같은 합치기 창이 열리고 미리 보기를 받는다', async () => {
    await open(BASE, { name: 'buyers', date: DATE, rehearsal: false, buyer: 'sms:r1', merge: 'UC_hong1234', into: 'sms:r1' })
    const dialog = await screen.findByRole('dialog', { name: '구매자 합치기' })
    await waitFor(() => expect(dialog.textContent).toContain('합친 뒤 합계'))
    expect(dialog.textContent).toContain('남는 이름: 문자찜(김씨)(문자) ← 홍길동(유튜브)')
    expect(previews().map((params) => [params.get('from'), params.get('into')])).toEqual([['UC_hong1234', 'sms:r1']])
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    expect(routes.at(-1)).toEqual({ name: 'buyers', date: DATE, rehearsal: false, buyer: 'sms:r1' })
  })

  it('미리 보기를 연 채 다른 기기에서 바뀌면(보는 범위의 seq가 앞서면) 새로 받는 동안 "합치기"를 누를 수 없고, 막힘이 풀려 보인다', async () => {
    await open([...BASE, register(18, '루비', 7000), { type: 'product.update', b: 'b1', no: 18, stock: 2 }, chat('m6', 'UC_hong1234', '홍길동', '18'), sms('r3', 18, { phoneKey: KEY, phoneLast4: '5678' })])
    const dialog = await openMerge('홍길동')
    await waitFor(() => expect(dialog.textContent).toContain('18번에 두 사람 모두 1등이에요.'))
    // 다른 기기: 문자 구매자의 18번 찜 취소 — 미리 보기 응답을 잠시 붙잡는다
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    engine.server.on('GET', /\/merge-preview\?/, async (call) => {
      await held
      return engine.mergePreview(call.path)
    })
    engine.write({ type: 'host.cancel', b: 'b1', no: 18, buyer: 'sms:r1', reason: '번호 착오' })
    expect(await within(dialog).findByText('미리 보기를 새로 받는 중이에요.')).toBeDefined()
    expect((within(dialog).getByRole('button', { name: '합치기' }) as HTMLButtonElement).disabled).toBe(true)
    release()
    await waitFor(() => expect(dialog.textContent).toContain('합친 뒤 합계'))
    expect(dialog.textContent).not.toContain('두 사람 모두 1등')
    expect(within(dialog).queryByText('미리 보기를 새로 받는 중이에요.')).toBeNull()
  })

  it('미리 보기를 받지 못하면 "미리 보기를 받지 못했어요." + "다시 받기", 그동안 "합치기"를 누를 수 없다', async () => {
    await open()
    engine.failNextPreview = apiError(503, 'INTERNAL_ERROR', '서버에 문제가 생겼어요.')
    const dialog = await openMerge('홍길동')
    expect(await within(dialog).findByText('미리 보기를 받지 못했어요.')).toBeDefined()
    expect((within(dialog).getByRole('button', { name: '합치기' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: '다시 받기' }))
    await waitFor(() => expect(dialog.textContent).toContain('합친 뒤 합계 30,000원'))
    expect(within(dialog).queryByText('미리 보기를 받지 못했어요.')).toBeNull()
  })

  it('응답이 보던 화면보다 낡았으면(서버가 늦게 따라옴) 되풀이해 받지 않고 "다시 받기"를 보이며 "합치기"를 누를 수 없다', async () => {
    await open()
    engine.server.on('GET', /\/merge-preview\?/, (call) => {
      const reply = engine.mergePreview(call.path) as { body: Record<string, unknown> }
      return { body: { ...reply.body, seq: 0 } }
    })
    const dialog = await openMerge('홍길동')
    expect(await within(dialog).findByText('화면이 바뀌었는데 미리 보기를 새로 받지 못했어요. "다시 받기"를 눌러 주세요.')).toBeDefined()
    expect((within(dialog).getByRole('button', { name: '합치기' }) as HTMLButtonElement).disabled).toBe(true)
    await flush(10)
    expect(engine.previews).toBe(1)
  })

  it('TE-S06-002: 막힌 합치기(이미 남는 쪽에 합쳐진 구매자 / 고리)는 막는 문장만 — 합친 뒤 합계를 보이지 않는다(합친 금액을 두 번 세지 않는다)', async () => {
    await open([...BASE, { type: 'buyer.merge', from: 'sms:r1', into: 'UC_hong1234', reason: '같은 사람' }])
    const dialog = await openMerge('김씨', /홍길동/)
    await waitFor(() => expect(dialog.textContent).toContain('문자찜(김씨)는 이미 홍길동에 합쳐져 있어요. 먼저 떼어 내 주세요.'))
    expect(dialog.textContent).not.toContain('합친 뒤 합계')
    expect(within(dialog).queryByRole('list', { name: '합치면' })).toBeNull()
    expect(within(dialog).queryByLabelText('사유')).toBeNull()
    expect((within(dialog).getByRole('button', { name: '합치기' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: '방향 바꾸기' }))
    await waitFor(() => expect(dialog.textContent).toContain('문자찜(김씨)는 이미 홍길동에 합쳐져 있어요.'))
    expect(dialog.textContent).not.toContain('먼저 떼어 내 주세요')
    expect(dialog.textContent).not.toContain('합친 뒤 합계')
  })

  it('떼어 내기: 확인 문장·사유 → 바로 buyer.unmerge. 엔진이 받지 않으면(합친 동안 적은 환불) 그 문장', async () => {
    await open([
      ...BASE,
      { type: 'host.cancel', b: 'b1', no: 15, buyer: 'sms:r1', reason: '시청자 요청' },
      { type: 'settlement.payment', buyer: 'sms:r1', date: DATE, amount: 14000 },
      { type: 'buyer.merge', from: 'sms:r1', into: 'UC_hong1234', reason: '같은 사람' },
      { type: 'settlement.refund', buyer: 'UC_hong1234', date: DATE, amount: 14000, reason: '환불함' },
    ])
    fireEvent.click(within(list()).getByRole('link', { name: /홍길동/ }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '문자찜(김씨) 떼어 내기' }))
    const dialog = await screen.findByRole('dialog', { name: '문자찜(김씨) 떼어 내기' })
    expect(dialog.textContent).toContain('문자찜(김씨)를 떼어 내요. 중복으로 정리된 찜은 돌아오지 않아요. 입금·환불 기록은 적힌 구매자에 남아요.')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' })))
    fireEvent.click(within(dialog).getByRole('button', { name: '1 잘못 합침' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '떼어 내기' }))
    expect(await within(dialog).findByText('떼어 내지 못했어요. 합친 동안 적은 환불이 한쪽 입금보다 많아요. 정산 기록을 먼저 확인해 주세요.')).toBeDefined()
    expect(engine.posts.at(-1)).toMatchObject({ type: 'buyer.unmerge', from: 'sms:r1', reason: '잘못 합침' })
  })
})

describe('쓰기 오류 (AC-S06-82)', () => {
  async function openMergeWithHong() {
    await open()
    fireEvent.click(within(list()).getByRole('link', { name: /문자찜\(김씨\)/ }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '다른 구매자와 합치기' }))
    fireEvent.change(screen.getByLabelText('합칠 구매자 찾기'), { target: { value: '홍길동' } })
    fireEvent.click(within(screen.getByRole('list', { name: '합칠 구매자' })).getAllByRole('button')[0] as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: '구매자 합치기' })
    await waitFor(() => expect(dialog.textContent).toContain('합친 뒤 합계'))
    fireEvent.click(within(dialog).getByRole('button', { name: '1 같은 사람' }))
    return dialog
  }

  it('합치기 SAVE_FAILED: 저절로 다시 보낸 뒤 "저장하지 못했어요" → "다시 보내기"는 같은 요청 번호 — 한 번만 합친다', async () => {
    const dialog = await openMergeWithHong()
    const sent = failWrites(engine.server, 4, apiError(503, 'SAVE_FAILED', '저장하지 못했어요. 다시 보내 주세요.'))
    fireEvent.click(within(dialog).getByRole('button', { name: '합치기' }))
    expect(await within(dialog).findByText(/저장하지 못했어요\. "다시 보내기"를 눌러 주세요\./, {}, { timeout: 8000 })).toBeDefined()
    expect(engine.posts).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: '다시 보내기' }))
    expect(await screen.findByText('합쳤어요')).toBeDefined()
    expect(new Set(sent).size).toBe(1)
    expect(engine.posts.filter((post) => post.type === 'buyer.merge')).toHaveLength(1)
  }, 15_000)

  it('합치기 PROCESSING_FAILED는 "확인 필요: …", 사유의 서버 문제는 사유 칸 아래', async () => {
    const dialog = await openMergeWithHong()
    failWrites(engine.server, 1, apiError(500, 'PROCESSING_FAILED', '처리하지 못했어요. 확인 필요 목록에 남겼어요.'))
    fireEvent.click(within(dialog).getByRole('button', { name: '합치기' }))
    expect(await within(dialog).findByText('확인 필요: 처리하지 못했어요. 확인 필요 목록에 남겼어요.')).toBeDefined()
    failWrites(engine.server, 1, apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'reason', message: '사유를 다시 적어 주세요.' }]))
    fireEvent.click(within(dialog).getByRole('button', { name: '합치기' }))
    const note = await within(dialog).findByText('사유를 다시 적어 주세요.')
    expect(within(dialog).getByLabelText('사유').getAttribute('aria-describedby') ?? '').toContain(note.id)
    expect(engine.posts).toHaveLength(0)
  })

  // D-I2-20: 포장·배송을 적은 구매자의 합치기·떼어 내기는 서버가 409로 거절한다 — 화면은 서버 문장 그대로(한 번만), 다시 보내기 없이
  const PACKED_MERGE = '포장이나 배송을 적은 구매자는 다른 구매자에 합칠 수 없어요. 포장 모드에서 먼저 취소해 주세요.'
  const SHIPPED_UNMERGE = '배송을 적은 구매자에게서는 떼어 낼 수 없어요. 포장 모드에서 배송 완료를 먼저 취소해 주세요.'

  it('합치기 409(포장·배송을 적은 구매자, D-I2-20): 서버 문장을 그대로 한 번 — 다시 보내기 없음, 합치지 않음', async () => {
    const dialog = await openMergeWithHong()
    failWrites(engine.server, 1, apiError(409, 'PACKING_RECORDED', PACKED_MERGE, [{ field: null, message: PACKED_MERGE }]))
    fireEvent.click(within(dialog).getByRole('button', { name: '합치기' }))
    const text = await within(dialog).findByText(PACKED_MERGE)
    expect(within(dialog).getAllByText(PACKED_MERGE)).toHaveLength(1)
    expect(text.closest('[role="alert"]')?.getAttribute('data-tone')).toBe('danger')
    expect(within(dialog).queryByRole('button', { name: '다시 보내기' })).toBeNull()
    expect(engine.posts).toHaveLength(0)
    expect(screen.queryByText('합쳤어요')).toBeNull()
  })

  it('떼어 내기 409(배송을 적은 구매자에게서, D-I2-20): 서버 문장을 그대로 — 엔진 거절 문장(환불)이 아니다', async () => {
    await open([...BASE, { type: 'buyer.merge', from: 'sms:r1', into: 'UC_hong1234', reason: '같은 사람' }])
    fireEvent.click(within(list()).getByRole('link', { name: /홍길동/ }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '문자찜(김씨) 떼어 내기' }))
    const dialog = await screen.findByRole('dialog', { name: '문자찜(김씨) 떼어 내기' })
    fireEvent.click(within(dialog).getByRole('button', { name: '1 잘못 합침' }))
    failWrites(engine.server, 1, apiError(409, 'PACKING_RECORDED', SHIPPED_UNMERGE))
    fireEvent.click(within(dialog).getByRole('button', { name: '떼어 내기' }))
    expect(await within(dialog).findByText(SHIPPED_UNMERGE)).toBeDefined()
    expect(dialog.textContent).not.toContain('떼어 내지 못했어요.')
    expect(within(dialog).queryByRole('button', { name: '다시 보내기' })).toBeNull()
    expect(engine.posts.filter((post) => post.type === 'buyer.unmerge')).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: '문자찜(김씨) 떼어 내기' })).toBe(dialog)
  })
})
