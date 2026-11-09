// 사용자 지시 2026-11-09 (D-UX4-50~56):
// - 상품 추가·방송 관리(방송 화면 안에 겹친 화면)에서 밀어 뒤로 가면 홈으로 나가던 문제 — 겹친 화면이 열린 동안 경로 밀기를 끄고 겹친 화면만 닫힌다
// - 상태 막대까지 겹친 화면이 덮는다(방송 경로가 상태 막대까지 그린다)
// - 큰 숫자 칸 글자 조각 이름(쉼표만 미끄러지게), [다음]은 처음부터 흐리게, 번호 끝을 넘으면 빨간 글 + 에러 진동
// - 듣기 상태는 아래 들린 말 창 왼쪽, 들린 말은 지우지 않고 펼치면 지난 말만(지금 말은 겹치지 않게)
// - 빈 목록은 가운데 굵은 한 줄 + 회색 설명
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ConsoleToolScreen, ManageScreen, ProductAddScreen, TOOL_PAGE } from '../src/screens/console/StackScreens.tsx'
import { SlidePage } from '../src/screens/console/parts.tsx'
import { ASK_NO, charPieces, noLimitWords } from '../src/screens/console/ProductAdd.tsx'
import { ListenLine } from '../src/screens/console/StreamAudio.tsx'
import { FEED_EMPTY, FEED_EMPTY_BODY } from '../src/screens/console/ClaimFeed.tsx'
import { TALK_EMPTY } from '../src/screens/console/LiveTalk.tsx'
import { TRANSCRIPT_LINES, type VoiceSession, type VoiceView } from '../src/lib/voice-session.ts'
import { NO_PRODUCTS_YET, NO_PRODUCTS_YET_BODY } from '../src/lib/words.ts'
import { setErrorHaptic } from '../src/native/haptics.ts'
import { AppHeader, HeaderTextButton } from '../src/ui/kit/index.ts'
import { RouteSwipeProvider, edgeSwipeCloses, startsEdgeSwipe } from '../src/ui/kit/route-swipe.tsx'
import { makeWorld } from './screen-support.tsx'
import { changes, flush, product } from './support.ts'

async function open(world: ReturnType<typeof makeWorld>) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
}
const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}

afterEach(() => setErrorHaptic(() => {}))

describe('밀어서 뒤로 가기 (D-UX4-50)', () => {
  it('겹친 화면이 열려 있는 동안 경로의 밀기를 끄고, 닫히면 다시 켠다 — 겹친 화면이 둘이면 둘 다 닫혀야 켠다', () => {
    const calls: boolean[] = []
    const page = (a: boolean, b: boolean) => (
      <RouteSwipeProvider setEnabled={(on) => calls.push(on)}>
        <SlidePage visible={a} onClose={() => {}} name="상품 추가" />
        <SlidePage visible={b} onClose={() => {}} name="방송 관리" />
      </RouteSwipeProvider>
    )
    const view = render(page(false, false))
    expect(calls).toEqual([])
    view.rerender(page(true, false))
    expect(calls).toEqual([false])
    view.rerender(page(true, true))
    expect(calls).toEqual([false])
    view.rerender(page(false, true))
    expect(calls).toEqual([false])
    view.rerender(page(false, false))
    expect(calls).toEqual([false, true])
    // 화면이 사라질 때도 다시 켠다
    view.rerender(page(true, false))
    view.unmount()
    expect(calls).toEqual([false, true, false, true])
  })

  it('방송 화면에서 상품 추가·방송 관리를 열면 경로 밀기가 꺼지고, 닫으면 켜진다', async () => {
    const world = makeWorld({ products: [] })
    const calls: boolean[] = []
    render(world.wrap(<RouteSwipeProvider setEnabled={(on) => calls.push(on)}><ConsoleScreen broadcastId="b1" seller onBack={() => {}} /></RouteSwipeProvider>))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    await screen.findByRole('dialog', { name: '상품 추가' })
    expect(calls.at(-1)).toBe(false)
    fireEvent.click(within(screen.getByRole('dialog', { name: '상품 추가' })).getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '상품 추가' })).toBeNull())
    expect(calls.at(-1)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '방송 관리' }))
    await screen.findByRole('dialog', { name: '방송 관리' })
    expect(calls.at(-1)).toBe(false)
  })

  it('앱 뼈대가 모든 경로에 밀기 스위치를 둔다 (screenLayout → gestureEnabled)', () => {
    const layout = readFileSync(join(import.meta.dirname, '../app/_layout.tsx'), 'utf8')
    expect(layout).toMatch(/screenLayout=\{\(\{ navigation, children \}\) => <RouteSwipeProvider setEnabled=\{\(enabled\) => navigation\.setOptions\(\{ gestureEnabled: enabled \}\)\}>/)
  })

  it('겹친 화면 밀기: 왼쪽 가장자리에서 가로로 시작한 것만, 1/3 넘게 밀거나 빠르게 튕기면 닫는다', () => {
    expect(startsEdgeSwipe(10, 20, 3)).toBe(true)
    expect(startsEdgeSwipe(120, 20, 3)).toBe(false) // 가운데에서 민 것은 아니다
    expect(startsEdgeSwipe(10, 20, 30)).toBe(false) // 세로 스크롤
    expect(startsEdgeSwipe(10, 3, 0)).toBe(false)
    expect(edgeSwipeCloses(140, 0, 390)).toBe(true)
    expect(edgeSwipeCloses(80, 0, 390)).toBe(false)
    expect(edgeSwipeCloses(60, 0.8, 390)).toBe(true)
  })

  // 옛 기대(D-UX4-51): 방송 경로가 상태 막대까지 그린다. 새 기대(D-UX4-57): 상품 추가·방송 관리가 진짜 쌓인 경로라, 방송 경로는 다른 경로처럼 상태 막대 아래에서 시작한다
  it('상품 추가·방송 관리는 방송 화면 위에 진짜로 쌓이는 경로다 (D-UX4-57)', () => {
    const route = readFileSync(join(import.meta.dirname, '../app/console/[id]/index.tsx'), 'utf8')
    expect(route).toContain("edges={['top']}")
    expect(route).toContain("openAdd={() => router.push({ pathname: '/console/[id]/add', params: { id } })}")
    expect(route).toContain("openManage={() => router.push({ pathname: '/console/[id]/manage', params: { id } })}")
    for (const file of ['add', 'manage']) expect(readFileSync(join(import.meta.dirname, `../app/console/[id]/${file}.tsx`), 'utf8')).toContain("edges={['top']}")
  })
})

describe('상품 추가 큰 칸 (D-UX4-52·54)', () => {
  it('글자 조각: 숫자는 왼쪽부터, 쉼표는 묶음으로 이름이 붙어 끝에 숫자를 넣어도 남은 글자는 같은 조각이다', () => {
    expect(charPieces('1,500', '원').map((piece) => `${piece.key}=${piece.char}`)).toEqual(['d0=1', 'c1=,', 'd1=5', 'd2=0', 'd3=0', 'suffix=원'])
    expect(charPieces('15,000', '원').map((piece) => `${piece.key}=${piece.char}`)).toEqual(['d0=1', 'd1=5', 'c1=,', 'd2=0', 'd3=0', 'd4=0', 'suffix=원'])
    expect(charPieces('1,500,000', '').map((piece) => piece.key)).toEqual(['d0', 'c2', 'd1', 'd2', 'd3', 'c1', 'd4', 'd5', 'd6'])
    expect(charPieces('', '번')).toEqual([])
  })

  it('[다음]은 처음부터 보이고 값이 없으면 눌리지 않는다', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    expect(within(page).getByText(ASK_NO)).toBeTruthy()
    const next = within(page).getByRole('button', { name: '다음' })
    expect(next.getAttribute('aria-disabled')).toBe('true')
    typePad('7')
    expect(within(page).getByRole('button', { name: '다음' }).getAttribute('aria-disabled')).not.toBe('true')
  })

  // 옛 기대(D-UX4-54): 넘는 자리는 받지 않는다. 새 기대(D-UX4-61, 사용자 지시 2026-11-09 "네자리 입력된거도 보여줘야 해. 그래야 네자리에서 한자리를 지울 수 있지 … 숫자 흔들기도"):
  // 넘친 한 자리까지 보이고 빨간 글 + 흔들기·에러 진동, 그보다 더 치면 받지 않고 다시 흔든다
  it('번호 끝(999)을 넘는 한 자리는 보이고 빨간 글 + 흔들기·에러 진동, [다음]은 흐리게 — 더 치면 받지 않고 다시 진동, 지우면 사라진다', async () => {
    const haptic = vi.fn()
    setErrorHaptic(haptic)
    const world = makeWorld({ products: [] })
    await open(world)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    typePad('123')
    expect(haptic).not.toHaveBeenCalled()
    typePad('4')
    expect(within(page).getByText('1234번')).toBeTruthy()
    expect(within(page).getByRole('alert').textContent).toContain(noLimitWords(999))
    await waitFor(() => expect(haptic).toHaveBeenCalledTimes(1))
    expect(within(page).getByRole('button', { name: '다음' }).getAttribute('aria-disabled')).toBe('true')
    typePad('5')
    expect(within(page).getByText('1234번')).toBeTruthy()
    await waitFor(() => expect(haptic).toHaveBeenCalledTimes(2))
    fireEvent.click(within(page).getByRole('button', { name: '지우기' }))
    expect(within(page).getByText('123번')).toBeTruthy()
    expect(within(page).queryByRole('alert')).toBeNull()
    expect(within(page).getByRole('button', { name: '다음' }).getAttribute('aria-disabled')).not.toBe('true')
  })
})

function fakeVoice(view: Partial<VoiceView>): VoiceSession {
  const full = { on: true, broadcastId: 'b1', state: { kind: 'listening' }, transcript: [], ...view } as unknown as VoiceView
  return { subscribe: () => () => {}, getView: () => full } as unknown as VoiceSession
}

describe('들린 말 창 (D-UX4-53)', () => {
  it('왼쪽에 듣기 상태, 가운데 지금 들리는 말 — 펼치면 지난 말만 채팅처럼(지금 말은 겹치지 않는다), 화살표 반대', () => {
    const lines = Array.from({ length: 12 }, (_, index) => `${String(index + 1)}번 들린 말`)
    render(<ListenLine session={fakeVoice({ transcript: lines })} broadcastId="b1" stream={{ status: null, hold: false, retry: () => {} }} bottom={0} />)
    const dock = screen.getByRole('region', { name: '들린 말 창' })
    expect(within(dock).getByRole('status', { name: '듣는 중' })).toBeTruthy()
    expect(within(dock).getByRole('status', { name: '지금 들리는 말' }).textContent).toBe('12번 들린 말')
    fireEvent.click(within(dock).getByRole('button', { name: '들린 말 펼치기' }))
    const log = within(dock).getByRole('log', { name: '지난 들린 말' })
    // 옛 기대: 최근 6줄만 남긴다. 새 기대: 지우지 않는다 — 지난 11줄 모두, 지금 말(12번)은 아래 줄에만
    expect(log.textContent).toContain('1번 들린 말')
    expect(log.textContent).toContain('11번 들린 말')
    expect(log.textContent).not.toContain('12번 들린 말')
    expect(within(dock).getByRole('button', { name: '들린 말 접기' })).toBeTruthy()
  })

  it('들린 말은 방송 내내 남긴다 (옛 TRANSCRIPT_LINES 6줄)', () => {
    expect(TRANSCRIPT_LINES).toBeGreaterThanOrEqual(1000)
  })

  it('방송 화면 머리에는 상태 알약이 없고 "관리"만, 들린 말 창은 목록 아래(맨 아래)에 있다', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    const all = screen.getByTestId('console-screen')
    const dock = screen.getByRole('region', { name: '들린 말 창' })
    const list = screen.getByTestId('console-list')
    expect(list.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const heading = within(all).getByRole('heading', { level: 1 })
    const header = heading.parentElement?.parentElement as HTMLElement
    expect(within(header).queryByRole('status')).toBeNull()
    expect(within(header).getByRole('button', { name: '방송 관리' }).textContent).toBe('관리')
  })
})

describe('빈 목록 안내 (D-UX4-56)', () => {
  it('상품·찜 기록·채팅·문자 탭이 비면 가운데에 굵은 한 줄 + 회색 설명', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    const products = screen.getByRole('status', { name: `${NO_PRODUCTS_YET} ${NO_PRODUCTS_YET_BODY}` })
    expect(within(products).getByText(NO_PRODUCTS_YET)).toBeTruthy()
    expect(getComputedStyle(products).justifyContent).toBe('center')
    expect(getComputedStyle(products).alignItems).toBe('center')
    fireEvent.click(screen.getByRole('button', { name: '찜 기록' }))
    const feed = screen.getByRole('status', { name: `${FEED_EMPTY} ${FEED_EMPTY_BODY.replace('\n', ' ')}` })
    expect(within(feed).getByText(FEED_EMPTY)).toBeTruthy()
    expect(FEED_EMPTY_BODY).toBe('채팅이나 문자로 찜이 오면\n바로 보여드릴게요')
    fireEvent.click(screen.getByRole('button', { name: '채팅·문자' }))
    expect(await screen.findByText(TALK_EMPTY)).toBeTruthy()
  })
})

describe('진짜 쌓인 화면 (D-UX4-57)', () => {
  it('방송 화면이 경로로 열면 겹쳐 그리지 않고 경로를 연다', async () => {
    const world = makeWorld({ products: [] })
    const opened: string[] = []
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} openAdd={() => opened.push('add')} openManage={() => opened.push('manage')} />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '방송 관리' }))
    expect(opened).toEqual(['add', 'manage'])
    expect(screen.queryByRole('dialog', { name: '상품 추가' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: '방송 관리' })).toBeNull()
  })

  it('쌓인 상품 추가 화면은 아래 방송 화면과 같은 자료를 쓰고(다시 받지 않는다), 추가하면 돌아가며 방송 화면 목록에 바로 보인다', async () => {
    const world = makeWorld({ products: [] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1] ?? 5), world.seq, { products: world.seq > 5 ? [product(16, { price: 15_000 })] : [] }) }))
    let back = 0
    render(world.wrap(<><ConsoleScreen broadcastId="b1" seller onBack={() => {}} openAdd={() => {}} openManage={() => {}} /><ProductAddScreen broadcastId="b1" onBack={() => { back += 1 }} /></>))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    expect(world.server.callsTo('POST', /^\/api\/broadcasts\/b1\/open$/).length).toBe(1)
    const page = await screen.findByRole('main', { name: '상품 추가' })
    typePad('16')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    typePad('15000')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    fireEvent.click(within(page).getByRole('button', { name: '추가하기' }))
    await waitFor(() => expect(back).toBe(1))
    expect(world.events[0]?.body).toMatchObject({ type: 'product.register', b: 'b1', noText: '16', priceText: '15000원' })
    await waitFor(() => expect(within(screen.getByRole('list', { name: '상품 목록' })).getByText('16번')).toBeTruthy())
  })

  it('쌓인 방송 관리 화면: 같은 메뉴가 있고, 여기서 여는 아래 판도 이 화면 위에 뜬다', async () => {
    const world = makeWorld({ products: [] })
    render(world.wrap(<ManageScreen broadcastId="b1" onBack={() => {}} openLink={() => {}} onEnded={() => {}} />))
    await waitFor(() => expect(world.source()).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    const page = await screen.findByRole('main', { name: '방송 관리' })
    for (const row of ['음성 설정', '채팅 보기', '방송 끝내기']) expect(within(page).getByRole('button', { name: row })).toBeTruthy()
    fireEvent.click(within(page).getByRole('button', { name: '채팅 보기' }))
    expect(await screen.findByRole('dialog', { name: '채팅' })).toBeTruthy()
  })
})

describe('방송 관리 설정은 전체 화면 (D-UX4-60)', () => {
  it('경로가 있으면 방송 관리 줄은 아래 판 대신 설정 화면을 연다', async () => {
    const world = makeWorld({ products: [] })
    const tools: string[] = []
    render(world.wrap(<ManageScreen broadcastId="b1" onBack={() => {}} openLink={() => {}} openTool={(tool) => tools.push(tool)} onEnded={() => {}} />))
    await waitFor(() => expect(world.source()).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    const page = await screen.findByRole('main', { name: '방송 관리' })
    for (const row of ['문자찜 직접 넣기', '상품 목록 가져오기', '댓글 붙여넣기', '채팅 보기', '음성 설정']) fireEvent.click(within(page).getByRole('button', { name: row }))
    expect(tools).toEqual(['sms', 'import', 'paste', 'chat', 'voice'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('설정 화면: 가운데 제목 · 맨 위 굵은 한 줄 · 회색 설명 · 내용', async () => {
    const world = makeWorld({ products: [] })
    render(world.wrap(<ConsoleToolScreen broadcastId="b1" tool="sms" onBack={() => {}} />))
    await waitFor(() => expect(world.source()).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    const page = await screen.findByRole('main', { name: TOOL_PAGE.sms.title })
    expect(within(page).getByRole('heading', { name: TOOL_PAGE.sms.title, level: 1 })).toBeTruthy()
    expect(within(page).getByRole('heading', { name: TOOL_PAGE.sms.head, level: 2 })).toBeTruthy()
    expect(await within(page).findByLabelText('번호')).toBeTruthy()
  })

  it('설정 경로 파일이 방송 관리 위에 쌓는다', () => {
    const manage = readFileSync(join(import.meta.dirname, '../app/console/[id]/manage.tsx'), 'utf8')
    expect(manage).toContain("openTool={(tool) => router.push({ pathname: '/console/[id]/tool/[name]', params: { id, name: tool } })}")
    expect(readFileSync(join(import.meta.dirname, '../app/console/[id]/tool/[name].tsx'), 'utf8')).toContain('<ConsoleToolScreen')
  })
})

describe('모든 화면 머리 줄 (D-UX4-59)', () => {
  it('탭 첫 화면 머리와 쌓인 화면 머리는 같은 줄 높이(48 + 아래 4)에 놓이고, 큰 제목·글자 단추는 2.5 올린다', () => {
    const tab = render(<AppHeader title="주문" right={<HeaderTextButton label="설정" onPress={() => {}} />} testID="tab-head" />)
    const tabRow = getComputedStyle(screen.getByTestId('tab-head'))
    tab.unmount()
    render(<AppHeader title="손님" onBack={() => {}} testID="stack-head" />)
    const stackRow = getComputedStyle(screen.getByTestId('stack-head'))
    expect(tabRow.minHeight).toBe(stackRow.minHeight)
    expect(tabRow.paddingBottom).toBe(stackRow.paddingBottom)
    expect(tabRow.paddingTop).toBe(stackRow.paddingTop)
  })
})
