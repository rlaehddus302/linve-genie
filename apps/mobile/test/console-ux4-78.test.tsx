// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 사용자 지시 2026-11-10 (D-UX4-75·78~80):
// - 홈 "지금 라이브 중" 글자가 너무 진함 → 한 단계 연한 회색·굵기
// - 방송 관리 묶음을 다시: "방송" 묶음(방송 안에 방송 관리) 대신 하는 일로 — 라이브 채팅 · 듣기 · 상품·라벨 · 화면. 문자찜 직접 넣기·댓글 붙여넣기 없앰
// - 방송 끝내기 → 방송 연결 안 "방송 연결 끊기", 누르면 토스 팝업(끊기만 빨강)
// - 프린터·라벨 → "라벨 프린트": 프린터 연결·라벨 꾸미기·테스트 인쇄를 고르는 화면, 각 화면은 방송 시작 라벨 단계 그대로
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { EndBroadcastRow, END_LINK_BODY, END_LINK_LABEL, END_LINK_QUESTION } from '../src/screens/console/EndBroadcast.tsx'
import { LABEL_PRINT_ROWS, LABEL_PRINT_TITLE, LabelPrintScreen } from '../src/screens/LabelPrintScreen.tsx'
import { APP_IMPORT_TITLE } from '../src/screens/console/ImportSheet.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush, product } from './support.ts'

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8')

async function openManage(openLabels?: () => void) {
  const world = makeWorld({ products: [product(15)] })
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} {...(openLabels === undefined ? {} : { openLabels })} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
  fireEvent.click(screen.getByRole('button', { name: '라이브 관리' }))
  return { world, page: await screen.findByRole('dialog', { name: '라이브 관리' }) }
}

describe('라이브 관리 묶음 (D-UX4-78)', () => {
  // 옛 기대(D-UX4-78): 라이브 채팅 · 듣기 · 상품·라벨 · 화면 묶음. 새 기대(D-UX4-94): 묶음·묶음 이름 없이 흰 바탕 줄만, 듣기 줄은 없앰
  it('묶음 없이 줄만 — 라이브 연결 · 상품 미리 등록 · 라벨 프린트, 옛 묶음 이름은 없다', async () => {
    const { page } = await openManage(() => {})
    const groups = within(page).queryAllByRole('group').map((group) => group.getAttribute('aria-label')).filter((name) => name !== null)
    for (const old of ['라이브 채팅', '듣기', '상품·라벨', '화면', '라이브', '넣기·보기']) expect(groups).not.toContain(old)
    expect(within(page).getByRole('button', { name: '라이브 연결' })).toBeTruthy()
    expect(within(page).getByRole('button', { name: APP_IMPORT_TITLE })).toBeTruthy()
    expect(APP_IMPORT_TITLE).toBe('상품 미리 등록')
    expect(within(page).getByRole('button', { name: LABEL_PRINT_TITLE })).toBeTruthy()
    expect(page.textContent).not.toContain('프린터·라벨')
    expect(page.textContent).not.toContain('라이브 끝내기')
    expect(page.textContent).not.toContain('문자찜 직접 넣기')
    expect(page.textContent).not.toContain('댓글 붙여넣기')
  })

  it('라벨 프린트 줄은 라벨 프린트 화면을 연다 (경로: /label-print)', async () => {
    const openLabels = vi.fn()
    const { page } = await openManage(openLabels)
    fireEvent.click(within(page).getByRole('button', { name: LABEL_PRINT_TITLE }))
    expect(openLabels).toHaveBeenCalledTimes(1)
    expect(read('app/console/[id]/manage.tsx')).toContain("openLabels={() => router.push('/label-print')}")
  })
})

describe('라이브 연결 끊기 (D-UX4-79)', () => {
  it('라이브 연결 맨 아래 빨간 줄 → 가운데 팝업 [취소] · [끊기](빨강) → 라이브를 끝낸다', async () => {
    const world = makeWorld({ products: [] })
    const ended: string[] = []
    world.server.on('POST', /^\/api\/broadcasts\/b1\/end$/, (call) => {
      ended.push(call.path)
      return { body: { seq: world.seq } }
    })
    const onEnded = vi.fn()
    render(world.wrap(<EndBroadcastRow broadcastId="b1" onEnded={onEnded} />))
    fireEvent.click(screen.getByRole('button', { name: END_LINK_LABEL }))
    const popup = await screen.findByRole('alertdialog', { name: END_LINK_QUESTION })
    expect(popup.textContent).toContain(END_LINK_BODY)
    const buttons = within(popup).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)
    expect(buttons).toEqual(['취소', '끊기'])
    // 끊기만 빨강 — 취소와 바탕이 다르다
    const cut = within(popup).getByRole('button', { name: '끊기' })
    const cancel = within(popup).getByRole('button', { name: '취소' })
    expect(getComputedStyle(cut).backgroundColor).not.toBe(getComputedStyle(cancel).backgroundColor)
    fireEvent.click(cancel)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(ended).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: END_LINK_LABEL }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: END_LINK_QUESTION })).getByRole('button', { name: '끊기' }))
    await waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1))
    expect(ended).toEqual(['/api/broadcasts/b1/end'])
  })

  it('라이브 연결 경로가 끊은 뒤 홈으로 돌려보낸다', () => {
    expect(read('app/link/[id].tsx')).toContain("onEnded={() => (router.canDismiss() ? router.dismissAll() : router.replace('/'))}")
  })
})

describe('라벨 프린트 (D-UX4-80)', () => {
  it('라벨 뽑기 스위치 · 프린터 연결(지금 프린터) · 라벨 꾸미기 · 테스트 인쇄 · 출력 상태·농도', async () => {
    const world = makeWorld({ products: [] })
    const steps: string[] = []
    const openStatus = vi.fn()
    render(world.wrap(<LabelPrintScreen onBack={() => {}} openStep={(step) => steps.push(step)} openStatus={openStatus} />))
    const page = screen.getByTestId('label-print')
    expect(within(page).getByRole('heading', { name: LABEL_PRINT_TITLE })).toBeTruthy()
    expect(within(page).getByRole('button', { name: `${LABEL_PRINT_ROWS.connect} — 연결 안 됨` })).toBeTruthy()
    await waitFor(() => expect(within(page).getByRole('switch', { name: `${LABEL_PRINT_ROWS.on} — 켜짐` })).toBeTruthy())
    fireEvent.click(within(page).getByRole('button', { name: `${LABEL_PRINT_ROWS.connect} — 연결 안 됨` }))
    fireEvent.click(within(page).getByRole('button', { name: LABEL_PRINT_ROWS.design }))
    fireEvent.click(within(page).getByRole('button', { name: LABEL_PRINT_ROWS.test }))
    fireEvent.click(within(page).getByRole('button', { name: LABEL_PRINT_ROWS.status }))
    expect(steps).toEqual(['connect', 'design', 'test'])
    expect(openStatus).toHaveBeenCalledTimes(1)
  })

  it('한 단계 경로는 라이브 시작 라벨 단계 화면을 그대로(only) 연다', () => {
    const route = read('app/label-setup.tsx')
    expect(route).toContain('<LabelSetupScreen only={step}')
    expect(read('app/label-print.tsx')).toContain("router.push({ pathname: '/label-setup', params: { step } })")
  })
})

describe('홈 "지금 라이브 중" (D-UX4-75 → 82 → 87 → 88)', () => {
  it('아이콘은 옛 크기 36(빨간 테두리 2), 글자 18 굵게 #4F545E, › #90969E, 아이콘 화면 끝에서 24', async () => {
    // 옛 기대(D-UX4-87): 아이콘 18 · 글자 17 — 사용자 "아이콘 너무 줄였어, 원래대로 … 글자 아주 조금만 늘리자"
    const home = read('src/screens/HomeScreen.tsx')
    expect(home).toContain('<Txt step="lead" weight="bold" ink={HOME_LIVE.ink}>{label}</Txt>')
    const { HOME_LIVE, HOME_LIVE_INSET } = await import('../src/screens/HomeScreen.tsx')
    const { SPACE, TYPE } = await import('../src/ui/kit/tokens.ts')
    expect(TYPE.lead).toBe(18)
    expect(HOME_LIVE.icon).toBe(36)
    expect(HOME_LIVE.ink).toBe('#4F545E')
    expect(HOME_LIVE.chevron).toBe('#90969E')
    expect(SPACE.xl + HOME_LIVE_INSET).toBe(24)
  })

  it('수평 정렬: 꼬리표는 자리를 차지하지 않아(겹쳐 놓음) 줄 가운데 = 동그라미 가운데, 글자는 그 가운데로', async () => {
    const { render, screen } = await import('@testing-library/react')
    const { HomeScreen } = await import('../src/screens/HomeScreen.tsx')
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    render(world.wrap(<HomeScreen nav={{ openConsole: () => undefined, openNewBroadcast: () => undefined, openPacking: () => undefined, openLabels: () => undefined, openSettings: () => undefined }} />))
    const plus = await screen.findByTestId('home-live-plus')
    const style = getComputedStyle(plus)
    expect(style.width).toBe('36px')
    expect(style.height).toBe('36px')
    const row = screen.getByTestId('home-live')
    expect(getComputedStyle(row).alignItems).toBe('center')
  })
})

describe('앱이 지은 라이브 제목 (D-UX4-86)', () => {
  it('"날짜 요일 (종류) 방송" 꼴만 "…라이브"로, 판매자가 적은 제목은 그대로', async () => {
    const { shownBroadcastTitle } = await import('../src/screens/BroadcastList.tsx')
    expect(shownBroadcastTitle('2026-11-09 월요일 다육이 방송')).toBe('2026-11-09 월요일 다육이 라이브')
    expect(shownBroadcastTitle('2026-11-08 일요일 방송')).toBe('2026-11-08 일요일 라이브')
    expect(shownBroadcastTitle('저녁 방송')).toBe('저녁 방송')
    expect(shownBroadcastTitle('방송 연습')).toBe('방송 연습')
  })
})
