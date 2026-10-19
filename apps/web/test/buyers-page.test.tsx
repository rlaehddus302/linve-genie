// 구매자 화면 (AC-S06-20~24, BUY-03·BUY-04, D-090·D-091). 실제 코어로 도는 가짜 서버.
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
    expect(rows).toEqual(['김철수유튜브1개 · 5,000원미입금', '문자찜(김씨)문자뒤 4자리 56781개 · 20,000원미입금', '홍길동유튜브1개 · 10,000원미입금'])
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
    fireEvent.click(within(detail).getByRole('button', { name: '정산 자세히' }))
    expect(routes.at(-1)).toEqual({ name: 'settlements', date: DATE, rehearsal: false, buyer: 'sms:r1' })
  })
})

describe('합치기·떼어 내기 (AC-S06-23·24, G-ENG-171·172)', () => {
  async function openMerge(target: string) {
    fireEvent.click(within(list()).getByRole('link', { name: /문자찜\(김씨\)/ }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '다른 구매자와 합치기' }))
    fireEvent.change(screen.getByLabelText('합칠 구매자 찾기'), { target: { value: target } })
    fireEvent.click(within(screen.getByRole('list', { name: '합칠 구매자' })).getAllByRole('button')[0] as HTMLElement)
    return screen.findByRole('dialog', { name: '구매자 합치기' })
  }

  it('방향 기본(유튜브가 남음)·미리 보기·중복 문장, 처음 포커스 "닫기", 사유 숫자 키 → 바로 buyer.merge → "합쳤어요"와 남는 구매자 자세히', async () => {
    await open()
    const dialog = await openMerge('홍길동')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' })))
    const text = dialog.textContent ?? ''
    expect(text).toContain('남는 이름: 홍길동(유튜브)')
    expect(text).toContain('옮겨 갈 확정 찜 1개 · 20,000원')
    expect(text).toContain('합친 뒤 합계 30,000원')
    expect(text).toContain('정산 묶음이 하나가 되어 배송비가 한 번 붙어요')
    expect(text).toContain('합친 뒤 표시 이름은 홍길동이고, 공개 감사 문구의 이름은 바뀌지 않아요.')
    expect(text).toContain('15번: 문자찜(김씨)의 대기 1번 찜이 중복으로 정리돼요')
    expect(text).toContain('떼어 내도 돌아오지 않아요.')
    fireEvent.click(within(dialog).getByRole('button', { name: '방향 바꾸기' }))
    expect(dialog.textContent).toContain('남는 이름: 문자찜(김씨)(문자)')
    fireEvent.click(within(dialog).getByRole('button', { name: '방향 바꾸기' }))
    fireEvent.keyDown(within(dialog).getByRole('button', { name: '닫기' }), { key: '1' })
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '합치기' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '합치기' }))
    expect(await screen.findByText('합쳤어요')).toBeDefined()
    expect(engine.posts.at(-1)).toMatchObject({ type: 'buyer.merge', from: 'sms:r1', into: 'UC_hong1234', reason: '같은 사람' })
    expect(routes.at(-1)).toMatchObject({ buyer: 'UC_hong1234' })
    const detail = screen.getByRole('region', { name: '구매자 자세히' })
    await waitFor(() => expect(within(detail).getByRole('region', { name: '합친 구매자' }).textContent).toContain('문자찜(김씨)'))
    expect(detail.textContent).toContain('전체 합계 30,000원')
  })

  it('두 사람 모두 1등이면 막는다(합치기 누를 수 없음) → 그 상품 자세히에서 한쪽 찜 취소(대기 뒤) → 합치기', async () => {
    await open([...BASE, chat('m5', 'UC_hong1234', '홍길동', '16', 'b2'), register(18, '루비', 7000), { type: 'product.update', b: 'b1', no: 18, stock: 2 }, chat('m6', 'UC_hong1234', '홍길동', '18'), sms('r3', 18, { phoneKey: KEY, phoneLast4: '5678' })])
    let dialog = await openMerge('홍길동')
    expect(dialog.textContent).toContain('18번에 두 사람 모두 1등이에요. 먼저 한 사람의 찜을 취소해 주세요.')
    expect((within(dialog).getByRole('button', { name: '합치기' }) as HTMLButtonElement).disabled).toBe(true)
    // 구매자 화면은 방송을 고르지 않았으므로 상품 앞에 방송 제목을 붙인다 ("1부 18번")
    fireEvent.click(within(dialog).getByRole('button', { name: '1부 18번 자세히' }))
    const product = await screen.findByRole('dialog', { name: '1부 18번 자세히' })
    const rows = within(product).getAllByRole('listitem')
    const smsRow = rows.find((row) => row.textContent?.includes('문자찜')) as HTMLElement
    fireEvent.click(within(smsRow).getByRole('button', { name: '찜 취소하기' }))
    const reason = await screen.findByRole('dialog', { name: '1부 18번 문자찜(김씨) 취소' })
    fireEvent.click(within(reason).getByRole('button', { name: '3 번호 착오' }))
    fireEvent.click(within(reason).getByRole('button', { name: '찜 취소하기' }))
    await waitFor(() => expect(engine.posts.some((post) => post.type === 'host.cancel')).toBe(true))
    await flush(10)
    fireEvent.click(screen.getByRole('button', { name: '다른 구매자와 합치기' }))
    fireEvent.change(screen.getByLabelText('합칠 구매자 찾기'), { target: { value: '홍길동' } })
    fireEvent.click(within(screen.getByRole('list', { name: '합칠 구매자' })).getAllByRole('button')[0] as HTMLElement)
    dialog = await screen.findByRole('dialog', { name: '구매자 합치기' })
    expect(dialog.textContent).not.toContain('두 사람 모두 1등')
    fireEvent.change(within(dialog).getByLabelText('사유'), { target: { value: '같은 사람' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '합치기' }))
    expect(await screen.findByText('합쳤어요')).toBeDefined()
  })

  it('TE-S06-002: 막힌 합치기(이미 남는 쪽에 합쳐진 구매자 / 고리)는 막는 문장만 — 합친 뒤 합계를 보이지 않는다(합친 금액을 두 번 세지 않는다)', async () => {
    await open([...BASE, { type: 'buyer.merge', from: 'sms:r1', into: 'UC_hong1234', reason: '같은 사람' }])
    fireEvent.click(within(list()).getByRole('link', { name: /홍길동/ }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '다른 구매자와 합치기' }))
    fireEvent.change(screen.getByLabelText('합칠 구매자 찾기'), { target: { value: '김씨' } })
    fireEvent.click(within(screen.getByRole('list', { name: '합칠 구매자' })).getAllByRole('button')[0] as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: '구매자 합치기' })
    expect(dialog.textContent).toContain('문자찜(김씨)는 이미 홍길동에 합쳐져 있어요. 먼저 떼어 내 주세요.')
    expect(dialog.textContent).not.toContain('합친 뒤 합계')
    expect(within(dialog).queryByRole('list', { name: '합치면' })).toBeNull()
    expect((within(dialog).getByRole('button', { name: '합치기' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: '방향 바꾸기' }))
    expect(dialog.textContent).toContain('문자찜(김씨)는 이미 홍길동에 합쳐져 있어요.')
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
})
