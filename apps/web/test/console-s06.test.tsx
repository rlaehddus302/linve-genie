// 콘솔의 S06 변경 (AC-S06-01·41·60·61·63·66·67·70·71) — 실제 코어로 도는 가짜 서버.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { RehearsalPanel } from '../src/components/RehearsalPanel.tsx'
import { chat, register, viewOf } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { FakeEventSource, apiError, flush } from './support.ts'

let engine: EngineServer

function setup(events: Record<string, unknown>[] = [], options: ConstructorParameters<typeof EngineServer>[1] = {}) {
  engine = new EngineServer(events, options)
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

async function openConsole(navigate = vi.fn()) {
  const utils = render(<ConsolePage broadcastId="b1" navigate={navigate} />)
  const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
  await flush(10)
  return { ...utils, quick, navigate }
}

const enter = (input: HTMLElement, text: string) => {
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('남겨 둔 "고칠까요?"는 지금 상태로 다시 본다 (AC-S06-67, D-095)', () => {
  async function leaveAsk() {
    setup()
    const { quick } = await openConsole()
    // 다른 기기가 먼저 61을 등록했지만 이 화면은 아직 모른다 → 보낸 등록은 아무 일도 없고, 판매자는 벌써 다음 줄을 치는 중
    engine.writeQuietly(register(61, '꽃', 10000))
    enter(quick, '61 장미 2만')
    fireEvent.change(quick, { target: { value: '62 꽃' } })
    quick.focus()
    expect(await screen.findByRole('button', { name: '61 장미 2만 고치기' })).toBeDefined()
    expect(screen.getByText('61번이 이미 있어요. 고칠까요? 친 줄: 61 장미 2만')).toBeDefined()
    return quick
  }

  it('다른 기기에서 번호를 바꿔 61에 상품이 없으면 "61번은 지금 없어요. 이 줄로 새로 등록할까요?" → 등록하기는 친 줄로 등록(되돌리기 띠)', async () => {
    await leaveAsk()
    act(() => engine.write({ type: 'product.renumber', b: 'b1', from: 61, to: 70 }))
    expect(await screen.findByText('61번은 지금 없어요. 이 줄로 새로 등록할까요? 친 줄: 61 장미 2만')).toBeDefined()
    expect(screen.queryByRole('button', { name: '61 장미 2만 고치기' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '61 장미 2만 등록하기' }))
    await waitFor(() => expect(engine.posts.filter((post) => post.type === 'product.register')).toHaveLength(2))
    expect(engine.posts.at(-1)).toMatchObject({ type: 'product.register', b: 'b1', no: 61, name: '장미', price: 20000 })
    expect(await screen.findByText('61번을 등록했어요')).toBeDefined()
    expect(screen.queryByText(/61번은 지금 없어요/)).toBeNull()
  })

  it('"지우기"는 아무것도 보내지 않는다', async () => {
    await leaveAsk()
    act(() => engine.write({ type: 'product.renumber', b: 'b1', from: 61, to: 70 }))
    fireEvent.click(await screen.findByRole('button', { name: '61 장미 2만 지우기' }))
    expect(screen.queryByText(/61번은 지금 없어요/)).toBeNull()
    expect(engine.posts.filter((post) => post.type === 'product.register')).toHaveLength(1)
  })

  it('다른 기기에서 친 값으로 고쳐 다른 값이 없어지면 항목이 사라진다', async () => {
    await leaveAsk()
    act(() => engine.write({ type: 'product.update', b: 'b1', no: 61, name: '장미', price: 20000 }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '61 장미 2만 고치기' })).toBeNull())
  })
})

describe('키보드: 번호 Enter → 1등 찜 "찜 취소하기" → 숫자 키 사유 → 보내기 (AC-S06-63)', () => {
  it('상품 자세히의 "닫기"에서 Tab 한 번이면 1등 찜의 "찜 취소하기", 사유 창에서 숫자 1 → 보내기 버튼으로', async () => {
    setup([register(15, '핑크프릴', 10000), chat('m1', 'UC_hong1234', '홍길동', '15')])
    const { quick } = await openConsole()
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    const close = within(detail).getByRole('button', { name: '닫기' })
    await waitFor(() => expect(document.activeElement).toBe(close))
    fireEvent.keyDown(close, { key: 'Tab' })
    const cancel = within(within(detail).getByRole('region', { name: '1등' })).getByRole('button', { name: '찜 취소하기' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.click(cancel)
    const reason = await screen.findByRole('dialog', { name: '15번 홍길동 취소' })
    const reasonClose = within(reason).getByRole('button', { name: '닫기' })
    await waitFor(() => expect(document.activeElement).toBe(reasonClose))
    expect(within(within(reason).getByRole('group', { name: '자주 쓰는 이유' })).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '1 시청자 요청',
      '2 장난 찜',
      '3 번호 착오',
      '4 입금 안 함',
    ])
    fireEvent.keyDown(reasonClose, { key: '1' })
    const submit = within(reason).getByRole('button', { name: '찜 취소하기' })
    expect(document.activeElement).toBe(submit)
    fireEvent.click(submit)
    expect(await screen.findByText(/뒤 보내요: 15번 홍길동 취소/)).toBeDefined()
    await waitFor(() => expect(engine.posts.some((post) => post.type === 'host.cancel' && post.reason === '시청자 요청')).toBe(true))
  })

  it('사유 글 칸 안의 숫자는 글자로 들어간다', async () => {
    setup([register(15, '핑크프릴', 10000), chat('m1', 'UC_hong1234', '홍길동', '15')])
    const { quick } = await openConsole()
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '찜 취소하기' }))
    const reason = await screen.findByRole('dialog', { name: '15번 홍길동 취소' })
    const field = within(reason).getByLabelText('사유') as HTMLInputElement
    field.focus()
    fireEvent.keyDown(field, { key: '1' })
    expect(field.value).toBe('')
    expect(document.activeElement).toBe(field)
  })
})

describe('창 버튼 이름 (AC-S06-60)', () => {
  it('"취소"·"확인" 한 낱말 버튼이 없다 — 판매 종료 "판매 종료하기", 차단 "차단하기", 닫는 버튼 "닫기"', async () => {
    setup([register(15, '핑크프릴', 10000), register(16, '청보석', 2000), chat('m1', 'UC_hong1234', '홍길동', '15')])
    const { quick } = await openConsole()
    enter(quick, '16')
    let detail = await screen.findByRole('dialog', { name: '16번 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '판매 종료' }))
    const confirm = await screen.findByRole('dialog', { name: '판매 종료' })
    expect(within(confirm).getAllByRole('button').map((button) => button.textContent)).toEqual(['닫기', '판매 종료하기'])
    fireEvent.click(within(confirm).getByRole('button', { name: '닫기' }))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    enter(quick, '15')
    detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    for (const button of within(detail).getAllByRole('button')) expect(['취소', '확인']).not.toContain(button.textContent)
    fireEvent.click(within(detail).getByRole('button', { name: '차단하기' }))
    const block = await screen.findByRole('dialog', { name: '홍길동 차단' })
    expect(within(block).getAllByRole('button').at(-1)?.textContent).toBe('차단하기')
  })
})

describe('끝난 방송·알림 띠·조치 기록 (AC-S06-61·66·70)', () => {
  it('"끝난 방송이에요"는 버튼이 아닌 상태 글자', async () => {
    setup([{ type: 'broadcast.end', b: 'b1' }], { ended: ['b1'] })
    await openConsole()
    const note = screen.getByText('끝난 방송이에요')
    expect(note.tagName).toBe('P')
    expect(note.getAttribute('role')).toBe('status')
    expect(note.getAttribute('tabindex')).toBeNull()
  })

  it('휴대폰 알림 띠 접기: "알림 n 펼치기"(알림 영역 밖, aria-expanded) — 알림 영역의 글자는 그대로', async () => {
    setup([register(15, '핑크프릴', 10000), chat('m1', 'c1', '가', '20'), chat('m2', 'c2', '나', '21')])
    await openConsole()
    const toggle = screen.getByRole('button', { name: '알림 2 펼치기' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const region = screen.getByRole('region', { name: '알림' })
    expect(region.contains(toggle)).toBe(false)
    expect(region.textContent).toBe('보류 찜 2')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '알림 2 접기' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('상품 자세히의 조치 기록은 상품 ID로 받는다 (번호가 아니다)', async () => {
    setup([register(15, '핑크프릴', 10000)])
    const { quick } = await openConsole()
    enter(quick, '15')
    await screen.findByRole('dialog', { name: '15번 자세히' })
    await flush()
    const calls = engine.server.callsTo('GET', /\/history\?/).map((call) => call.path)
    expect(calls.at(-1)).toMatch(/[?&]product=p1(&|$)/)
    expect(calls.at(-1)).not.toMatch(/[?&](b|no)=/)
  })
})

describe('다시 받기 실패 안내 (AC-S06-41)', () => {
  it('처음 불러오기가 실패하면 고정 영역에 안내와 "지금 다시 불러오기" — 누르면 바로 다시, 맞춰지면 안내가 사라진다', async () => {
    setup([register(15, '핑크프릴', 10000)])
    let down = true
    engine.server.on('GET', /^\/api\/days\/2026-10-19$/, () => (down ? apiError(503, 'INTERNAL_ERROR', '서버에 문제가 생겼어요.') : { body: viewOf(engine.state, engine.seq) }))
    render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
    expect(await screen.findByText('화면을 최신으로 맞추지 못했어요. 다시 시도하는 중이에요.')).toBeDefined()
    down = false
    fireEvent.click(screen.getByRole('button', { name: '지금 다시 불러오기' }))
    expect(await screen.findByLabelText('빠른 입력')).toBeDefined()
    await waitFor(() => expect(screen.queryByText('화면을 최신으로 맞추지 못했어요. 다시 시도하는 중이에요.')).toBeNull())
  })
})

describe('리허설 생성기 (AC-S06-66 013·71)', () => {
  it('"시드" 낱말 없이 "채팅 순서 번호"는 더 보기 안에, 다른 방송에서 돌면 서버 문장과 그 방송으로 가는 길', async () => {
    const server = new EngineServer().server
    server.on('POST', /rehearsal\/generator\/start$/, () => ({
      status: 409,
      body: { broadcast: 'r9', error: { code: 'GENERATOR_RUNNING_ELSEWHERE', message: '다른 리허설 방송에서 가짜 채팅이 돌고 있어요. 그 방송에서 먼저 멈춰 주세요.' } },
    }))
    vi.stubGlobal('fetch', server.fetch)
    const onOpen = vi.fn()
    const { container } = render(<RehearsalPanel broadcastId="r1" generator={null} onGenerator={() => {}} onWritten={() => {}} onOpenBroadcast={onOpen} />)
    expect(container.textContent).not.toContain('시드')
    const more = container.querySelector('details') as HTMLDetailsElement
    expect(more.querySelector('summary')?.textContent).toBe('더 보기')
    expect(within(more).getByLabelText('채팅 순서 번호')).toBeDefined()
    expect(more.textContent).toContain('같은 번호면 같은 채팅이 같은 순서로 나와요')
    fireEvent.click(screen.getByRole('button', { name: '가짜 채팅 시작' }))
    expect(await screen.findByText('다른 리허설 방송에서 가짜 채팅이 돌고 있어요. 그 방송에서 먼저 멈춰 주세요.')).toBeDefined()
    const link = screen.getByRole('link', { name: '가짜 채팅이 도는 방송으로 가기' })
    expect(link.getAttribute('href')).toBe('/broadcasts/r9')
    fireEvent.click(link)
    expect(onOpen).toHaveBeenCalledWith('r9')
  })
})

describe('앱: 떠나기 전 확인·인터넷 없음 (AC-S06-01, D-083, D-093)', () => {
  it('5초 대기 중인 조치가 있으면 메뉴로 떠나기 전에 묻는다 — "닫기"는 머문다, 떠나면 보내지 않는다', async () => {
    setup([register(15, '핑크프릴', 10000), chat('m1', 'UC_hong1234', '홍길동', '15')], { delayMs: 400 })
    window.history.replaceState(null, '', '/broadcasts/b1')
    render(<App />)
    const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
    await flush(10)
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '찜 취소하기' }))
    const reason = await screen.findByRole('dialog', { name: '15번 홍길동 취소' })
    fireEvent.click(within(reason).getByRole('button', { name: '2 장난 찜' }))
    fireEvent.click(within(reason).getByRole('button', { name: '찜 취소하기' }))
    await screen.findByText('0.4초 뒤 보내요: 15번 홍길동 취소')
    const menu = screen.getByRole('navigation', { name: '메뉴' })
    expect(within(menu).getByRole('link', { name: '방송' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(within(menu).getByRole('link', { name: '문자찜 입력' }))
    let ask = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
    expect(ask.textContent).toContain('보내기 전인 조치가 있어요. 떠나면 보내지 않아요.')
    await waitFor(() => expect(document.activeElement).toBe(within(ask).getByRole('button', { name: '닫기' })))
    fireEvent.click(within(ask).getByRole('button', { name: '닫기' }))
    expect(window.location.pathname).toBe('/broadcasts/b1')
    fireEvent.click(within(menu).getByRole('link', { name: '문자찜 입력' }))
    ask = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
    fireEvent.click(within(ask).getByRole('button', { name: '보내지 않고 떠나기' }))
    await waitFor(() => expect(window.location.pathname).toBe('/sms'))
    expect(screen.getByRole('heading', { name: '문자찜 입력' })).toBeDefined()
    // 대기 시간(0.4초)이 다 지나도 보내지 않는다
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(engine.posts.filter((post) => post.type === 'host.cancel')).toHaveLength(0)
  })

  it('대기 중인 조치가 없으면 묻지 않고 간다', async () => {
    setup()
    window.history.replaceState(null, '', '/broadcasts/b1')
    render(<App />)
    await screen.findByLabelText('빠른 입력')
    fireEvent.click(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '정산' }))
    await waitFor(() => expect(window.location.pathname).toBe('/settlements'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('인터넷 없이 열면 "인터넷 연결이 없어요. 연결되면 다시 불러와요." — 연결되면 저절로 다시 불러온다', async () => {
    let online = false
    const engineServer = new EngineServer()
    engineServer.server.on('GET', /^\/api\/me$/, () => (online ? apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.') : { network: true }))
    vi.stubGlobal('fetch', engineServer.server.fetch)
    render(<App />)
    expect(await screen.findByText('인터넷 연결이 없어요. 연결되면 다시 불러와요.')).toBeDefined()
    online = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await screen.findByRole('button', { name: '로그인' })).toBeDefined()
  })
})
