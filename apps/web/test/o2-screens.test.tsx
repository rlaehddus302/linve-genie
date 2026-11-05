// O2 화면 단위 시험 (AC-O2-01·02·10·11·17·21·23·24·33·35·36·37·38·40·42·43·44·50) — 실제 코어로 도는 가짜 서버(옵션 방송 b1·b2)와 확인 필요 조회.
import { DEFAULT_SETTINGS, getBuyer, listBroadcasts, listProducts, listReviews, type SaleSettings } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { ChatMessage } from '../src/api/types.ts'
import { optionLook } from '../src/components/ChatPanel.tsx'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { ReviewsPage } from '../src/components/ReviewsPage.tsx'
import { chat, iso, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, FakeServer, apiError, flush, message } from './support.ts'

const OPTIONS = { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } as const
const SHORTS = { name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }
const shorts = (no = 21, stocks: Record<string, number> = {}) => ({ type: 'product.register', b: 'b1', no, name: '반바지', price: 15000, options: [SHORTS], stocks })

let engine: EngineServer
const texts = new Map<string, string>()

/** 확인 필요 조회 (서버 계약 5의 모양 — 실제 코어 listReviews) */
function serveReviews() {
  engine.server.on('GET', /^\/api\/reviews/, (call) => {
    const url = new URL(call.path, 'http://x')
    const b = url.searchParams.get('broadcast')
    const state = engine.state
    const reviews = listReviews(state)
      .filter((review) => b === null || review.broadcast === b)
      .map((review) => ({
        ...(iso(review) as object),
        date: DATE,
        rehearsal: false,
        broadcastDate: DATE,
        broadcastTitle: review.broadcast === 'b1' ? '1부' : '2부',
        buyerName: getBuyer(state, review.currentBuyer)?.display ?? '',
        text: texts.get(review.item) ?? null,
        received: null,
        phoneLast4: null,
      }))
    return {
      body: {
        rehearsal: false,
        reviews,
        products: iso(listProducts(state).filter((product) => b === null || product.broadcast === b)),
        broadcasts: iso(listBroadcasts(state).filter((item) => b === null || item.id === b)),
        scopes: [{ date: DATE, rehearsal: false, seq: engine.seq }],
      },
    }
  })
}

function setup(events: Record<string, unknown>[] = [], settings: Record<string, string> = OPTIONS) {
  texts.clear()
  for (const event of events) if (event.type === 'chat') texts.set(String(event.id), String(event.text))
  engine = new EngineServer(events, { settings })
  serveReviews()
  vi.stubGlobal('fetch', engine.server.fetch)
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

async function openConsole(b = 'b1') {
  const navigate = vi.fn()
  const utils = render(<ConsolePage broadcastId={b} navigate={navigate} />)
  const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
  await flush(10)
  return { ...utils, quick, navigate }
}

const enter = (input: HTMLElement, text: string) => {
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('콘솔 — 옵션 방송에서만 (AC-O2-06·10·50)', () => {
  it('번호 방송: "옵션 추가"·지금 상품·판매 방식 글이 없다', async () => {
    setup([register(15, '핑크프릴', 10000)], {})
    await openConsole()
    expect(screen.queryByRole('button', { name: '옵션 추가' })).toBeNull()
    expect(screen.queryByText('상품명·옵션도 받기')).toBeNull()
    expect(screen.queryByRole('region', { name: '지금 상품' })).toBeNull()
    expect(screen.queryByText(/지금 상품으로/)).toBeNull()
  })

  it('옵션 방송: 머리에 판매 방식, "옵션 추가", 지금 상품 없음', async () => {
    setup()
    await openConsole()
    expect(screen.getByText('상품명·옵션도 받기')).toBeDefined()
    expect(screen.getByRole('button', { name: '옵션 추가' })).toBeDefined()
    expect(within(screen.getByRole('region', { name: '지금 상품' })).getByText('지금 상품 없음 — 상품 이름을 쓴 댓글만 받아요')).toBeDefined()
  })
})

describe('옵션을 붙여 한 번에 등록 (AC-O2-11)', () => {
  it('창에서 사이즈 S/M/L → 요약 → Enter 한 번에 product.register 하나(옵션 포함), 다음 줄은 옵션 없음', async () => {
    setup()
    const { quick } = await openConsole()
    fireEvent.change(quick, { target: { value: '21 반바지 15000' } })
    fireEvent.click(screen.getByRole('button', { name: '옵션 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '옵션 추가' })
    fireEvent.click(within(dialog).getByRole('button', { name: '항목 더하기' }))
    fireEvent.change(within(dialog).getByLabelText('항목 1 이름'), { target: { value: '사이즈' } })
    fireEvent.change(within(dialog).getByLabelText('항목 1 선택지 여러 개'), { target: { value: 'S, M, L' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '항목 1 선택지 한 번에 더하기' }))
    expect(within(dialog).getByText('옵션: 사이즈 S/M/L · 변형 3개')).toBeDefined()
    // 변형 재고 칸은 숫자 키패드, 처음 값 1
    expect((within(dialog).getByLabelText('M 재고') as HTMLInputElement).value).toBe('1')
    expect(within(dialog).getByLabelText('M 재고').getAttribute('inputmode')).toBe('numeric')
    fireEvent.click(within(dialog).getByRole('button', { name: '옵션 넣기' }))
    expect(await screen.findByText('옵션: 사이즈 S/M/L · 변형 3개')).toBeDefined()
    fireEvent.keyDown(quick, { key: 'Enter' })
    await waitFor(() => expect(engine.posts.filter((post) => post.type === 'product.register')).toHaveLength(1))
    expect(engine.posts[0]).toMatchObject({ type: 'product.register', b: 'b1', no: 21, name: '반바지', price: 15000, options: [SHORTS], stocks: { S: 1, M: 1, L: 1 } })
    expect(engine.posts.filter((post) => post.type === 'product.update')).toHaveLength(0)
    await waitFor(() => expect(screen.queryByRole('group', { name: '붙은 옵션' })).toBeNull())
    enter(quick, '22 티셔츠 9000')
    await waitFor(() => expect(engine.posts.filter((post) => post.type === 'product.register')).toHaveLength(2))
    expect(engine.posts.at(-1)).not.toHaveProperty('options')
    // 지금 상품: 공개로 등록한 상품
    await waitFor(() => expect(within(screen.getByRole('region', { name: '지금 상품' })).getByText(/지금 상품: 22번 티셔츠/)).toBeDefined())
  })

  it('겹침이 있으면 "옵션 넣기"가 막히고 고치면 풀린다 (AC-O2-13)', async () => {
    setup()
    await openConsole()
    fireEvent.click(screen.getByRole('button', { name: '옵션 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '옵션 추가' })
    fireEvent.click(within(dialog).getByRole('button', { name: '항목 더하기' }))
    fireEvent.change(within(dialog).getByLabelText('항목 1 이름'), { target: { value: '사이즈' } })
    fireEvent.change(within(dialog).getByLabelText('항목 1 선택지 여러 개'), { target: { value: 'M, L' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '항목 1 선택지 한 번에 더하기' }))
    fireEvent.change(within(dialog).getByLabelText('항목 1 선택지 2 별칭'), { target: { value: 'm' } })
    expect(within(dialog).getByText('‘m’이 사이즈 M과 사이즈 L에 함께 있어요')).toBeDefined()
    expect((within(dialog).getByRole('button', { name: '옵션 넣기' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('항목 1 선택지 2 별칭'), { target: { value: '라지' } })
    expect(within(dialog).queryByText(/함께 있어요/)).toBeNull()
    expect((within(dialog).getByRole('button', { name: '옵션 넣기' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('템플릿에서 고르기 — 항목이 3개면 더 고를 수 없고 이유가 보인다 (AC-O2-12)', async () => {
    setup()
    await openConsole()
    fireEvent.click(screen.getByRole('button', { name: '옵션 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '옵션 추가' })
    fireEvent.click(within(dialog).getByRole('button', { name: '템플릿에서 고르기' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '화분 — 호수' }))
    expect((within(dialog).getByLabelText('항목 1 이름') as HTMLInputElement).value).toBe('호수')
    fireEvent.click(within(dialog).getByRole('button', { name: '식품 — 맛' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '의류 — 색상' }))
    expect(within(dialog).getByText('옵션 항목은 3개까지라 더 고를 수 없어요.')).toBeDefined()
    expect((within(dialog).getByRole('button', { name: '휴대폰 케이스 — 기종' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('콘솔의 변형·지금 상품 (AC-O2-21·23)', () => {
  it('변형마다 한 줄: 1등(2개 이상이면 ×2)·대기·남은 수량, 상품 줄은 "변형 3개 · 남은 1"·"1등 변형별"', async () => {
    setup([shorts(21, { L: 2 }), chat('m1', 'UC_a', '홍길동', '반바지 M'), chat('m2', 'UC_b', '박민수', '반바지 M'), chat('m3', 'UC_c', '최지우', '반바지 L 2개')])
    await openConsole()
    const board = screen.getByRole('region', { name: '상품 보드' })
    expect(within(board).getByText('변형 3개 · 남은 1')).toBeDefined()
    expect(within(board).getByText('1등 변형별')).toBeDefined()
    fireEvent.click(within(board).getByRole('button', { name: '변형 펼치기 — 21번' }))
    const lines = within(board).getByRole('list', { name: '변형 — 21번' })
    const rows = within(lines).getAllByRole('listitem').map((row) => row.textContent?.replace(/\s+/g, ' ').trim())
    expect(rows).toEqual(['S 판매 중 1등 아직 없음 대기 0 남은 1', 'M 판매 완료 1등 홍길동 대기 1 남은 0', 'L 판매 완료 1등 최지우 ×2 대기 0 남은 0'])
  })

  it('"지금 상품으로"는 공개 전·판매 중에만, 누르면 5초 대기 없이 바로 product.focus', async () => {
    setup([shorts(21), { type: 'product.register', b: 'b1', no: 22, name: '티셔츠', price: 9000, status: 'READY' }, shorts(23), shorts(24)])
    engine.write({ type: 'product.hold', b: 'b1', no: 23 })
    engine.write({ type: 'product.close', b: 'b1', no: 24 })
    engine.write({ type: 'product.focus', b: 'b1', no: 21 })
    await openConsole()
    const board = screen.getByRole('region', { name: '상품 보드' })
    expect(within(board).queryByRole('button', { name: '지금 상품으로 — 21번' })).toBeNull()
    expect(within(board).getByText('지금 상품')).toBeDefined()
    expect(within(board).queryByRole('button', { name: '지금 상품으로 — 23번' })).toBeNull()
    expect(within(board).queryByRole('button', { name: '지금 상품으로 — 24번' })).toBeNull()
    fireEvent.click(within(board).getByRole('button', { name: '지금 상품으로 — 22번' }))
    await waitFor(() => expect(engine.posts.at(-1)).toMatchObject({ type: 'product.focus', b: 'b1', no: 22 }))
    await waitFor(() => expect(screen.getByText(/지금 상품: 22번 티셔츠/)).toBeDefined())
    expect(screen.queryByRole('region', { name: '보내기 전 조치' })).toBeNull()
    // 다른 기기에서 일시 중지 → 실시간으로 지금 상품 없음 (AC-O2-22)
    act(() => engine.write({ type: 'product.focus', b: 'b1', no: 21 }))
    expect(await screen.findByText(/지금 상품: 21번 반바지/)).toBeDefined()
    act(() => engine.write({ type: 'product.hold', b: 'b1', no: 21 }))
    expect(await screen.findByText('지금 상품 없음 — 상품 이름을 쓴 댓글만 받아요')).toBeDefined()
  })

  it('알림 띠 "확인 필요 n건"(이 방송의 것)을 누르면 확인 필요 목록을 이 방송으로 (AC-O2-25)', async () => {
    setup([shorts(21), chat('m1', 'UC_a', '김철수', '반바지'), { type: 'product.register', b: 'b2', no: 5, name: '양말', price: 3000, options: [{ name: '색', choices: [{ label: '흰' }, { label: '검' }] }] }, chat('m9', 'UC_z', '나', '양말', 'b2')])
    const { navigate } = await openConsole()
    const strip = screen.getByRole('region', { name: '알림' })
    fireEvent.click(await within(strip).findByRole('button', { name: '확인 필요 1건' }))
    expect(navigate).toHaveBeenCalledWith({ name: 'reviews', broadcast: 'b1', rehearsal: false })
  })
})

describe('옵션 고치기 (AC-O2-17)', () => {
  it('찜이 있으면 더하기·가격·재고만, XL 더하기는 저장되고, changed=false면 "바뀐 것이 없어요"', async () => {
    setup([shorts(21), chat('m1', 'UC_a', '홍길동', '반바지 M')])
    await openConsole()
    fireEvent.click(within(screen.getByRole('region', { name: '상품 보드' })).getByRole('button', { name: /^21번/ }))
    const detail = await screen.findByRole('dialog', { name: '21번 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '옵션 고치기' }))
    const dialog = await screen.findByRole('dialog', { name: '21번 옵션 고치기' })
    expect(within(dialog).getByText('찜이 있어 선택지 더하기·가격·재고만 바꿀 수 있어요. 다른 것은 새 번호로 등록해 주세요.')).toBeDefined()
    expect(within(dialog).queryByLabelText('항목 1 이름')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '항목 1 선택지 1 빼기' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '항목 더하기' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '항목 1 빼기' })).toBeNull()
    // 아무것도 바꾸지 않고 저장 → 엔진이 아무 일도 하지 않음 → "바뀐 것이 없어요"
    fireEvent.click(within(dialog).getByRole('button', { name: '옵션 저장' }))
    expect(await within(dialog).findByText('바뀐 것이 없어요')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '선택지 더하기' }))
    fireEvent.change(within(dialog).getByLabelText('항목 1 선택지 4 이름'), { target: { value: 'XL' } })
    fireEvent.change(within(dialog).getByLabelText('L 재고'), { target: { value: '3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '옵션 저장' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '21번 옵션 고치기' })).toBeNull())
    expect(engine.posts.at(-1)).toMatchObject({ type: 'product.update', options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }, { label: 'XL' }] }], stocks: { S: 1, M: 1, L: 3, XL: 1 } })
    const detailAgain = await screen.findByRole('dialog', { name: '21번 자세히' })
    expect(within(detailAgain).getByRole('region', { name: 'XL 변형' })).toBeDefined()
  })
})

describe('찜 조치의 변형·직접 배정·취소 요청 (AC-O2-42·43·44)', () => {
  it('같은 구매자의 M·L 중 M 찜 취소에는 그 변형 options', async () => {
    setup([shorts(21), chat('m1', 'UC_a', '홍길동', '반바지 M'), chat('m2', 'UC_a', '홍길동', '반바지 L')])
    await openConsole()
    fireEvent.click(within(screen.getByRole('region', { name: '상품 보드' })).getByRole('button', { name: /^21번/ }))
    const detail = await screen.findByRole('dialog', { name: '21번 자세히' })
    const m = within(detail).getByRole('region', { name: 'M 변형' })
    fireEvent.click(within(m).getByRole('button', { name: '찜 취소하기' }))
    const reason = await screen.findByRole('dialog', { name: '21번 M 홍길동 취소' })
    fireEvent.change(within(reason).getByLabelText(/사유/), { target: { value: '시청자 요청' } })
    fireEvent.click(within(reason).getByRole('button', { name: '찜 취소하기' }))
    await waitFor(() => expect(engine.posts.at(-1)).toMatchObject({ type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_a', options: { 사이즈: 'M' } }))
  })

  it('직접 배정: 사이즈(처음엔 비움)·수량(처음 1)을 골라야 보내고 host.assign에 options·qty', async () => {
    setup([shorts(21, { L: 3 }), chat('m1', 'UC_a', '홍길동', '안녕')])
    await openConsole()
    fireEvent.click(within(screen.getByRole('region', { name: '상품 보드' })).getByRole('button', { name: /^21번/ }))
    const detail = await screen.findByRole('dialog', { name: '21번 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '직접 배정' }))
    const dialog = await screen.findByRole('dialog', { name: '21번 직접 배정' })
    expect((within(dialog).getByLabelText('사이즈') as HTMLSelectElement).value).toBe('')
    expect((within(dialog).getByLabelText('수량') as HTMLInputElement).value).toBe('1')
    fireEvent.click(within(dialog).getByRole('radio', { name: '홍길동' }))
    fireEvent.change(within(dialog).getByLabelText(/사유/), { target: { value: '전화 주문' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '1등으로 정하기' }))
    expect(within(dialog).getByText('사이즈을(를) 골라 주세요.')).toBeDefined()
    fireEvent.change(within(dialog).getByLabelText('사이즈'), { target: { value: 'L' } })
    fireEvent.change(within(dialog).getByLabelText('수량'), { target: { value: '2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '1등으로 정하기' }))
    await waitFor(() => expect(engine.posts.at(-1)).toMatchObject({ type: 'host.assign', b: 'b1', no: 21, buyer: 'UC_a', options: { 사이즈: 'L' }, qty: 2 }))
  })

  it('변형을 정하지 않은 취소 요청: 고르기 전엔 막힘, L만 승인 / 취소하지 않기는 아무 찜도 취소하지 않는다', async () => {
    setup(
      [shorts(21), chat('m1', 'UC_a', '홍길동', '반바지 M'), chat('m2', 'UC_a', '홍길동', '반바지 L'), chat('m3', 'UC_b', '김철수', '반바지 L'), chat('m4', 'UC_a', '홍길동', '21 취소')],
      { ...OPTIONS, 'cancel.buyerChat': 'REQUEST' },
    )
    await openConsole()
    fireEvent.click(within(screen.getByRole('region', { name: '알림' })).getByRole('button', { name: /취소 요청/ }))
    const dialog = await screen.findByRole('dialog', { name: /취소 요청 — 21번/ })
    expect(document.activeElement?.textContent).toBe('닫기')
    expect((within(dialog).getByRole('button', { name: '고른 찜 취소' }) as HTMLButtonElement).disabled).toBe(true)
    const choices = within(dialog).getAllByRole('radio')
    expect(choices.map((radio) => (radio as HTMLInputElement).checked)).toEqual([false, false])
    fireEvent.click(within(dialog).getByRole('radio', { name: /^L · 1등/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '고른 찜 취소' }))
    await waitFor(() => expect(engine.posts.at(-1)).toMatchObject({ type: 'host.approveCancel', b: 'b1', no: 21, buyer: 'UC_a', options: { 사이즈: 'L' } }))
  })
})

describe('채팅 패널의 옵션 주문·확인 필요 (AC-O2-24)', () => {
  const products = [{ no: 21, name: '반바지', aliases: [] as string[], hasOptions: true }]
  const opt = (seq: number, text: string, patch: Partial<ChatMessage>): ChatMessage => message(seq, { text, optionOrders: [], review: null, mentions: [], order: false, ...patch })
  it('"주문 21번 M"·"주문 21번 L ×2"·"확인 필요 · 옵션 빠짐"·언급, 번호 방송 메시지는 null', () => {
    expect(optionLook(opt(1, '반바지 M', { order: true, optionOrders: [{ claim: 'c1', no: 21, variant: 'M', qty: 1 }] }), products)?.orders).toEqual(['주문 21번 M'])
    expect(optionLook(opt(2, '반바지 L 2개', { order: true, optionOrders: [{ claim: 'c2', no: 21, variant: 'L', qty: 2 }] }), products)?.orders).toEqual(['주문 21번 L ×2'])
    const review = optionLook(opt(3, '반바지', { review: { reason: 'OPTION_MISSING', no: 21, options: null, qty: null } }), products)
    expect(review?.review).toBe('확인 필요 · 옵션 빠짐')
    expect(review?.mention).toBe(false)
    // 옛 기대: 화면이 글에서 상품 이름을 찾아 언급으로 보임. SRV1(D-APP-23, 약속 5)부터 이름 언급은 서버가 준 nameMentions — 같은 단언을 서버 값으로
    const mention = optionLook(opt(4, '반바지 예뻐요 너무', { nameMentions: [21] }), products)
    expect(mention?.mention).toBe(true)
    expect(mention?.optionProduct).toBe(true)
    // 서버가 언급으로 주지 않은 글은 기기가 이름을 찾아 언급으로 바꾸지 않는다 (APP-05 AC13)
    expect(optionLook(opt(6, '반바지 예뻐요 너무', {}), products)?.mention).toBe(false)
    expect(optionLook(message(5, { text: '반바지 M' }), products)).toBeNull()
  })
})

describe('확인 필요 목록 (AC-O2-33·35·36·37·38)', () => {
  const events = () => [
    shorts(21, { L: 2 }),
    chat('m0', 'UC_y', '이영희', '반바지 M'),
    chat('m1', 'UC_a', '홍길동', '반바지'),
    chat('m2', 'UC_b', '김철수', '반바지 XLL'),
    chat('m3', 'UC_c', '최지우', '반바지 L 3개'),
  ]

  async function openReviews() {
    const utils = render(<ReviewsPage route={{ name: 'reviews', broadcast: 'b1', rehearsal: false }} navigate={vi.fn()} />)
    await screen.findByRole('list', { name: '확인 필요 목록' })
    await flush(5)
    return utils
  }

  it('원래 순서·미리 채움(읽지 않은 수량은 빈 칸)·남은 수량', async () => {
    setup(events())
    await openReviews()
    const rows = within(screen.getByRole('list', { name: '확인 필요 목록' })).getAllByRole('listitem')
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['1번째 줄', '2번째 줄', '3번째 줄'])
    const [first, , third] = rows as [HTMLElement, HTMLElement, HTMLElement]
    expect(within(first).getByText('홍길동')).toBeDefined()
    expect(within(first).getByText('옵션 빠짐')).toBeDefined()
    expect((within(first).getByLabelText('상품') as HTMLSelectElement).value).toBe('b1/21')
    expect((within(first).getByLabelText('사이즈') as HTMLSelectElement).value).toBe('')
    expect((within(first).getByLabelText('수량') as HTMLInputElement).value).toBe('')
    expect(within(first).getByLabelText('수량').getAttribute('inputmode')).toBe('numeric')
    expect((within(first).getByRole('button', { name: '1번째 줄 주문으로' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(third).getByLabelText('사이즈') as HTMLSelectElement).value).toBe('L')
    expect((within(third).getByLabelText('수량') as HTMLInputElement).value).toBe('3')
    expect(within(third).getByText('남은 2개')).toBeDefined()
  })

  it('빈 칸이 있는 줄을 고르면 "n번째 줄에 빈 칸이 있어요" — 고른 줄 주문 아님은 누를 수 있다', async () => {
    setup(events())
    await openReviews()
    fireEvent.click(screen.getByLabelText('1번째 줄 고르기'))
    fireEvent.click(screen.getByLabelText('2번째 줄 고르기'))
    expect(screen.getByText('1번째 줄에 빈 칸이 있어요')).toBeDefined()
    expect((screen.getByRole('button', { name: '고른 줄 주문으로' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '고른 줄 주문 아님' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('후보 제안은 칸만 채운다 — 보내지 않는다 (AC-O2-34)', async () => {
    setup([{ ...shorts(21), options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }, { label: 'XL' }] }] }, chat('m2', 'UC_b', '김철수', '반바지 XLL')])
    await openReviews()
    const row = screen.getByRole('listitem', { name: '1번째 줄' })
    fireEvent.click(within(row).getByRole('button', { name: '혹시: XL?' }))
    expect((within(row).getByLabelText('사이즈') as HTMLSelectElement).value).toBe('XL')
    await flush(5)
    expect(engine.posts).toHaveLength(0)
  })

  it('여러 줄은 화면에서 고른 순서와 상관없이 원래 순서로, 모자란 줄은 까닭과 함께 남는다', async () => {
    setup(events())
    await openReviews()
    const row = (n: number) => screen.getByRole('listitem', { name: `${String(n)}번째 줄` })
    fireEvent.change(within(row(1)).getByLabelText('사이즈'), { target: { value: 'M' } })
    fireEvent.change(within(row(1)).getByLabelText('수량'), { target: { value: '1' } })
    fireEvent.change(within(row(2)).getByLabelText('사이즈'), { target: { value: 'S' } })
    fireEvent.change(within(row(2)).getByLabelText('수량'), { target: { value: '1' } })
    fireEvent.click(screen.getByLabelText('3번째 줄 고르기'))
    fireEvent.click(screen.getByLabelText('1번째 줄 고르기'))
    fireEvent.click(screen.getByLabelText('2번째 줄 고르기'))
    fireEvent.click(screen.getByRole('button', { name: '고른 줄 주문으로' }))
    // 5초(시험 60ms) 대기 동안은 보내지 않는다
    expect(engine.posts).toHaveLength(0)
    await waitFor(() => expect(engine.posts).toHaveLength(3), { timeout: 3000 })
    expect(engine.posts.map((post) => post.item)).toEqual(['m1', 'm2', 'm3'])
    expect(engine.posts[0]).toMatchObject({ type: 'host.resolveReview', b: 'b1', item: 'm1', no: 21, qty: 1, options: { 사이즈: 'M' } })
    expect(await screen.findByText('홍길동 · 반바지 — 대기 1번')).toBeDefined()
    expect(await screen.findByText('김철수 · 반바지 XLL — 1등')).toBeDefined()
    expect(await screen.findByText('그대로 두었어요 — 남은 수량이 모자라요')).toBeDefined()
    const left = screen.getByRole('listitem', { name: '1번째 줄' })
    expect(within(left).getByText('최지우')).toBeDefined()
    expect(within(left).getByText('남은 2개')).toBeDefined()
  })

  it('판매 중이 아닌 상품을 가리킨 줄은 "판매 중인 상품이 아니에요"로 남는다', async () => {
    setup([shorts(21), chat('m1', 'UC_a', '홍길동', '반바지')])
    engine.write({ type: 'product.hold', b: 'b1', no: 21 })
    await openReviews()
    const row = screen.getByRole('listitem', { name: '1번째 줄' })
    fireEvent.change(within(row).getByLabelText('사이즈'), { target: { value: 'M' } })
    fireEvent.change(within(row).getByLabelText('수량'), { target: { value: '1' } })
    fireEvent.click(within(row).getByRole('button', { name: '1번째 줄 주문으로' }))
    expect(await screen.findByText('그대로 두었어요 — 판매 중인 상품이 아니에요', {}, { timeout: 3000 })).toBeDefined()
    expect(screen.getByRole('listitem', { name: '1번째 줄' })).toBeDefined()
  })
})

describe('설정의 판매 방식 (AC-O2-01·02)', () => {
  let settings: SaleSettings
  let server: FakeServer
  beforeEach(() => {
    settings = { ...DEFAULT_SETTINGS, 'contention.policy': 'RECEIVED_TIME' }
    server = new FakeServer()
    server
      .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1' } }))
      .on('GET', /^\/api\/settings$/, () => ({ body: { settings } }))
      .on('PATCH', /^\/api\/settings$/, (call) => {
        settings = { ...settings, ...((call.body?.settings ?? {}) as object) } as SaleSettings
        return { body: { settings } }
      })
      .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    vi.stubGlobal('fetch', server.fetch)
    window.history.replaceState(null, '', '/settings')
  })

  it('판매 규칙 맨 위 "판매 방식" — 번호로만 받기가 골라져 있고, 옵션을 고르면 엄격/느슨 칸이 없고 겨루기는 접수순 글, 저장은 OPTIONS+ARRIVAL', async () => {
    render(<App />)
    const group = await screen.findByRole('radiogroup', { name: '판매 방식' })
    const numbers = within(group).getByRole('radio', { name: '번호로만 받기 (다육 등 — 기본)' }) as HTMLInputElement
    expect(numbers.checked).toBe(true)
    expect(document.body.textContent).not.toMatch(/STRICT|LOOSE|OPTIONS|ARRIVAL/)
    expect(screen.getByText('주문 인식 방식')).toBeDefined()
    fireEvent.click(within(group).getByRole('radio', { name: '상품명·옵션도 받기 (의류·식품·케이스 등)' }))
    expect(screen.queryByText('주문 인식 방식')).toBeNull()
    expect(screen.getByRole('group', { name: '유튜브 찜과 문자찜이 겨루면', hidden: true }).textContent).toContain('먼저 들어온 순서(접수순)')
    expect(screen.getAllByText('상품명·옵션도 받기는 먼저 들어온 순서로만 판정해요.').length).toBeGreaterThan(0)
    // FB1 D-FB1-06: 판매 규칙 칸 안 "저장" 대신 화면 아래 저장 막대
    fireEvent.click(within(screen.getByRole('region', { name: '저장' })).getByRole('button', { name: '저장' })) // FB1 D-FB1-06
    await waitFor(() => expect(settings['claim.parseMode']).toBe('OPTIONS'))
    await screen.findByText('저장했어요. 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.') // FB1 D-FB1-06
    expect(server.callsTo('PATCH', /settings/).at(-1)?.body).toEqual({ settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } })
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '판매 방식' })).getByRole('radio', { name: '번호로만 받기 (다육 등 — 기본)' }))
    fireEvent.click(within(screen.getByRole('region', { name: '저장' })).getByRole('button', { name: '저장' })) // FB1 D-FB1-06
    await waitFor(() => expect(settings['claim.parseMode']).toBe('STRICT'))
  })
})

describe('문자찜의 옵션·수량 (AC-O2-40·41)', () => {
  async function openSms() {
    const { SmsPage } = await import('../src/components/SmsPage.tsx')
    render(<SmsPage navigate={vi.fn()} />)
    await screen.findByRole('region', { name: '최근 넣은 문자찜' })
    await flush(5)
    return screen.getByLabelText('번호') as HTMLInputElement
  }

  it('옵션 상품: 고르기 전엔 막힘, 선택지 옆 남은 수량, 수량 0은 보내기 전에 알림, 남은 1 < 2면 확인 필요로', async () => {
    // 문자찜 입력의 처음 방송은 가장 최근 방송(2부)
    setup([{ ...shorts(21), b: 'b2' }])
    const no = await openSms()
    fireEvent.change(no, { target: { value: '21' } })
    const sizes = await screen.findByRole('radiogroup', { name: '사이즈' })
    const radios = within(sizes).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((radio) => radio.checked)).toEqual([false, false, false])
    expect(within(sizes).getByText('M · 남은 1개')).toBeDefined()
    const submit = screen.getByRole('button', { name: '21번에 문자찜 넣기' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    const qty = screen.getByLabelText('수량') as HTMLInputElement
    expect(qty.value).toBe('1')
    expect(qty.getAttribute('inputmode')).toBe('numeric')
    fireEvent.click(within(sizes).getByRole('radio', { name: 'M · 남은 1개' }))
    fireEvent.change(qty, { target: { value: '0' } })
    expect(screen.getByText('수량은 1부터 10까지예요.')).toBeDefined()
    fireEvent.change(qty, { target: { value: '11' } })
    expect(screen.getByText('수량은 1부터 10까지예요.')).toBeDefined()
    fireEvent.change(qty, { target: { value: '2' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(engine.posts.at(-1)).toMatchObject({ type: 'sms', b: 'b2', no: 21, qty: 2, options: { 사이즈: 'M' } }))
    expect(await screen.findByText('21번 · 찜이 생기지 않았어요 — 확인 필요로 보냈어요')).toBeDefined()
    expect(screen.getByRole('region', { name: '넣은 결과' }).getAttribute('data-tone')).toBe('warning')
  })

  it('아직 없는 번호는 안내와 수량만, 옵션 없는 상품은 수량만, 번호 방송은 수량 칸이 없다', async () => {
    setup([register(11, '수건', 5000, 'b2')])
    const no = await openSms()
    fireEvent.change(no, { target: { value: '30' } })
    expect(await screen.findByText('상품을 등록하면 옵션을 고를 수 있어요')).toBeDefined()
    expect(screen.getByLabelText('수량')).toBeDefined()
    fireEvent.change(no, { target: { value: '11' } })
    expect(screen.queryByText('상품을 등록하면 옵션을 고를 수 있어요')).toBeNull()
    expect(screen.getByLabelText('수량')).toBeDefined()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    cleanup()
    setup([register(11, '수건', 5000, 'b2')], {})
    const plain = await openSms()
    fireEvent.change(plain, { target: { value: '11' } })
    await flush(3)
    expect(screen.queryByLabelText('수량')).toBeNull()
  })
})

describe('옵션 방송 문자찜도 보내는 동안 잠금·성공 응답 바로 비우기 (D-SMS-01, AC-SMS-01~04 × AC-O2-40)', () => {
  /** 쓰기 응답·증분 조회를 붙잡아 둔다 — 풀면 그때 가짜 서버가 답한다 */
  function hold() {
    const gates: { post: (() => void) | null; changes: (() => void) | null } = { post: null, changes: null }
    const waits: { post: Promise<void> | null; changes: Promise<void> | null } = { post: null, changes: null }
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'POST' && path.startsWith('/api/events') && waits.post !== null) await waits.post
      if (method === 'GET' && path.includes('/changes') && waits.changes !== null) await waits.changes
      return engine.server.fetch(input, init)
    })
    const make = (key: 'post' | 'changes') => {
      waits[key] = new Promise<void>((resolve) => {
        gates[key] = resolve
      })
    }
    const free = (key: 'post' | 'changes') => {
      gates[key]?.()
      gates[key] = null
      waits[key] = null
    }
    return { holdPost: () => make('post'), releasePost: () => free('post'), holdChanges: () => make('changes'), releaseChanges: () => free('changes') }
  }

  async function openSms() {
    const { SmsPage } = await import('../src/components/SmsPage.tsx')
    render(<SmsPage navigate={vi.fn()} />)
    await screen.findByRole('region', { name: '최근 넣은 문자찜' })
    await flush(5)
    return screen.getByLabelText('번호') as HTMLInputElement
  }

  it('보내는 동안 옵션·수량도 바뀌지 않고, 성공 응답 바로 옵션(고르지 않음)·수량(1)까지 비운다', async () => {
    setup([{ ...shorts(21), b: 'b2' }])
    const gate = hold()
    const no = await openSms()
    fireEvent.change(no, { target: { value: '21' } })
    const sizes = await screen.findByRole('radiogroup', { name: '사이즈' })
    fireEvent.click(within(sizes).getByRole('radio', { name: /^S/ }))
    gate.holdPost()
    fireEvent.click(screen.getByRole('button', { name: '21번에 문자찜 넣기' }))
    await flush()
    const qty = screen.getByLabelText('수량') as HTMLInputElement
    expect(qty.readOnly).toBe(true)
    expect(sizes.getAttribute('aria-readonly')).toBe('true')
    expect(screen.getByText('보내는 중이라 잠시 고칠 수 없어요.')).toBeDefined()
    fireEvent.click(within(sizes).getByRole('radio', { name: /^L/ }))
    fireEvent.change(qty, { target: { value: '3' } })
    const checked = () => (within(screen.getByRole('radiogroup', { name: '사이즈' })).getAllByRole('radio') as HTMLInputElement[]).map((radio) => radio.checked)
    expect(checked()).toEqual([true, false, false])
    expect(qty.value).toBe('1')
    gate.holdChanges()
    gate.releasePost()
    await flush(20)
    expect(engine.posts.filter((post) => post.type === 'sms')).toHaveLength(1)
    expect(engine.posts.at(-1)).toMatchObject({ type: 'sms', no: 21, qty: 1, options: { 사이즈: 'S' } })
    expect(no.value).toBe('')
    expect(screen.queryByRole('radiogroup', { name: '사이즈' })).toBeNull()
    expect(screen.getByRole('region', { name: '넣은 결과' }).textContent).toContain('21번 · 넣었어요 · 상태 확인 중…')
    // 바로 같은 번호를 다시 치면 옵션은 고르지 않음·수량 1로 다시 시작
    fireEvent.change(no, { target: { value: '21' } })
    expect(checked()).toEqual([false, false, false])
    expect((screen.getByLabelText('수량') as HTMLInputElement).value).toBe('1')
    gate.releaseChanges()
    await waitFor(() => expect(screen.getByRole('region', { name: '넣은 결과' }).textContent).not.toContain('상태 확인 중'))
    expect(screen.getByRole('region', { name: '넣은 결과' }).textContent).toContain('21번')
  })

  it('따라잡기 전에는 확인 필요로 간 문자찜도 "상태 확인 중…" — 따라잡은 뒤 "확인 필요로 보냈어요"', async () => {
    setup([{ ...shorts(21), b: 'b2' }])
    const gate = hold()
    const no = await openSms()
    fireEvent.change(no, { target: { value: '21' } })
    fireEvent.click(within(await screen.findByRole('radiogroup', { name: '사이즈' })).getByRole('radio', { name: 'M · 남은 1개' }))
    fireEvent.change(screen.getByLabelText('수량'), { target: { value: '2' } })
    gate.holdChanges()
    fireEvent.click(screen.getByRole('button', { name: '21번에 문자찜 넣기' }))
    await flush(20)
    const card = screen.getByRole('region', { name: '넣은 결과' })
    expect(card.textContent).toContain('21번 · 넣었어요 · 상태 확인 중…')
    expect(card.textContent).not.toContain('확인 필요로 보냈어요')
    expect(card.getAttribute('data-tone')).toBe('info')
    gate.releaseChanges()
    expect(await screen.findByText('21번 · 찜이 생기지 않았어요 — 확인 필요로 보냈어요')).toBeDefined()
    expect(screen.getByRole('region', { name: '넣은 결과' }).getAttribute('data-tone')).toBe('warning')
  })

  it('거절되면 잠금이 풀리고 고른 옵션·수량은 그대로', async () => {
    setup([{ ...shorts(21, { L: 3 }), b: 'b2' }])
    const no = await openSms()
    fireEvent.change(no, { target: { value: '21' } })
    fireEvent.click(within(await screen.findByRole('radiogroup', { name: '사이즈' })).getByRole('radio', { name: /^L/ }))
    fireEvent.change(screen.getByLabelText('수량'), { target: { value: '2' } })
    engine.failNext = apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'memo', message: '메모를 확인해 주세요.' }])
    fireEvent.click(screen.getByRole('button', { name: '21번에 문자찜 넣기' }))
    expect(await screen.findByText('메모를 확인해 주세요.')).toBeDefined()
    expect(no.value).toBe('21')
    const radios = within(screen.getByRole('radiogroup', { name: '사이즈' })).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((radio) => radio.checked)).toEqual([false, false, true])
    const qty = screen.getByLabelText('수량') as HTMLInputElement
    expect(qty.value).toBe('2')
    expect(qty.readOnly).toBe(false)
    expect(screen.getByRole('radiogroup', { name: '사이즈' }).getAttribute('aria-readonly')).toBe('false')
  })
})

describe('옵션 상품의 1등·대기·승계는 변형에 있다 (SA-O2-04, TE-O2-001·002·003, D-O1-01)', () => {
  const cancelM = { type: 'host.cancel', b: 'b1', no: 21, buyer: 'UC_a', options: { 사이즈: 'M' }, reason: '시험 취소' }

  it('ASK에서 변형 M 1등을 취소하면 알림 띠 "승계 1"(접힌 휴대폰)·상품 줄 표시, 창에는 M의 대기자와 options 붙은 조치', async () => {
    setup([shorts(21), chat('m1', 'UC_a', '홍길동', '반바지 M'), chat('m2', 'UC_b', '김철수', '반바지 M'), cancelM], { ...OPTIONS, 'cancel.succession': 'ASK' })
    await openConsole()
    const strip = screen.getByRole('region', { name: '알림' })
    const alert = await within(strip).findByRole('button', { name: '승계 1' }) // MOB2 D-MOB2-16 (1): 접힌 휴대폰 띠는 "승계 n"
    const board = screen.getByRole('region', { name: '상품 보드' })
    expect(within(within(board).getByRole('button', { name: /^21번/ })).getByText('승계 결정 필요')).toBeDefined()
    fireEvent.click(alert)
    const dialog = await screen.findByRole('dialog', { name: /^승계 결정 — 21번 M/ })
    expect(within(dialog).getByText('대기 1번 김철수')).toBeDefined()
    expect(within(dialog).getByRole('button', { name: /김철수 1등으로/ })).toBeDefined()
  })

  it('변형에 1등이 있으면 상품 자세히 "판매 종료"는 막히고 "1등·대기 찜을 먼저 정리해 주세요."', async () => {
    setup([shorts(21), chat('m1', 'UC_a', '홍길동', '반바지 M')])
    await openConsole()
    fireEvent.click(within(screen.getByRole('region', { name: '상품 보드' })).getByRole('button', { name: /^21번/ }))
    const detail = await screen.findByRole('dialog', { name: '21번 자세히' })
    expect((within(detail).getByRole('button', { name: '판매 종료' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(detail).getByText('1등·대기 찜을 먼저 정리해 주세요.')).toBeDefined()
  })

  it('변형에 1등이 있을 때 가격을 바꾸면 "확정된 찜에도 새 가격을 적용할까요?"와 1등 찜 수', async () => {
    setup([shorts(21), chat('m1', 'UC_a', '홍길동', '반바지 M'), chat('m2', 'UC_b', '김철수', '반바지 L')])
    const { quick } = await openConsole()
    enter(quick, '21 반바지 13000')
    fireEvent.click(within(await screen.findByRole('dialog', { name: '21번이 이미 있어요. 고칠까요?' })).getByRole('button', { name: '예' }))
    const apply = await screen.findByRole('dialog', { name: '확정된 찜에도 새 가격을 적용할까요?' })
    expect(within(apply).getByText(/이미 1등인 찜 2개의 가격도/)).toBeDefined()
  })
})

describe('붙인 옵션은 새 번호 등록에만 (SA-O2-05, RA-O2-03, D-O2-05)', () => {
  async function attachSizes() {
    fireEvent.click(screen.getByRole('button', { name: '옵션 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '옵션 추가' })
    fireEvent.click(within(dialog).getByRole('button', { name: '항목 더하기' }))
    fireEvent.change(within(dialog).getByLabelText('항목 1 이름'), { target: { value: '사이즈' } })
    fireEvent.change(within(dialog).getByLabelText('항목 1 선택지 여러 개'), { target: { value: 'S, M, L' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '항목 1 선택지 한 번에 더하기' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '옵션 넣기' }))
    expect(await screen.findByText('옵션: 사이즈 S/M/L · 변형 3개')).toBeDefined()
  }

  it('이미 있는 번호(고칠까요?)에는 넣지 않고 떼며 알린다 — 다음 번호 등록에 따라가지 않는다', async () => {
    setup([register(21, '반바지', 15000)])
    const { quick } = await openConsole()
    await attachSizes()
    enter(quick, '21 반팔 15000')
    expect(await screen.findByText(/붙인 옵션은 21번에 넣지 않고 뗐어요/)).toBeDefined()
    await waitFor(() => expect(screen.queryByText('옵션: 사이즈 S/M/L · 변형 3개')).toBeNull())
    fireEvent.click(within(await screen.findByRole('dialog', { name: '21번이 이미 있어요. 고칠까요?' })).getByRole('button', { name: '아니요' }))
    enter(quick, '22 화분 3000')
    await waitFor(() => expect(engine.posts.filter((post) => post.type === 'product.register')).toHaveLength(1))
    expect(engine.posts.at(-1)).toMatchObject({ type: 'product.register', no: 22 })
    expect(engine.posts.at(-1)).not.toHaveProperty('options')
  })

  it('찾기(번호만)에서도 뗀다', async () => {
    setup([register(21, '반바지', 15000)])
    const { quick } = await openConsole()
    await attachSizes()
    enter(quick, '21')
    expect(await screen.findByText(/붙인 옵션은 21번에 넣지 않고 뗐어요/)).toBeDefined()
    expect(screen.queryByText('옵션: 사이즈 S/M/L · 변형 3개')).toBeNull()
  })
})

describe('색과 주 버튼 (AC-O2-53)', () => {
  it('옵션 추가 창의 채운 색 주 버튼은 하나', async () => {
    setup()
    await openConsole()
    fireEvent.click(screen.getByRole('button', { name: '옵션 추가' }))
    const dialog = await screen.findByRole('dialog', { name: '옵션 추가' })
    expect(dialog.querySelectorAll('.button-primary').length).toBeLessThanOrEqual(1)
  })
})
