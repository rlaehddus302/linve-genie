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
  fireEvent.click(screen.getByRole('button', { name: '방송 관리' }))
  return { world, page: await screen.findByRole('dialog', { name: '방송 관리' }) }
}

describe('방송 관리 묶음 (D-UX4-78)', () => {
  it('하는 일로 묶는다 — 라이브 채팅 · 듣기 · 상품·라벨 · 화면, "방송" 묶음은 없다', async () => {
    const { page } = await openManage(() => {})
    const groups = within(page).getAllByRole('group').map((group) => group.getAttribute('aria-label')).filter((name) => name !== null)
    expect(groups).toEqual(expect.arrayContaining(['라이브 채팅', '듣기', '상품·라벨', '화면']))
    expect(groups).not.toContain('방송')
    expect(groups).not.toContain('넣기·보기')
    const chat = within(page).getByRole('group', { name: '라이브 채팅' })
    expect(within(chat).getByRole('button', { name: '방송 연결' })).toBeTruthy()
    const goods = within(page).getByRole('group', { name: '상품·라벨' })
    expect(within(goods).getByRole('button', { name: APP_IMPORT_TITLE })).toBeTruthy()
    expect(APP_IMPORT_TITLE).toBe('상품 미리 등록')
    expect(within(goods).getByRole('button', { name: LABEL_PRINT_TITLE })).toBeTruthy()
    expect(page.textContent).not.toContain('프린터·라벨')
    expect(page.textContent).not.toContain('방송 끝내기')
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

describe('방송 연결 끊기 (D-UX4-79)', () => {
  it('방송 연결 맨 아래 빨간 줄 → 가운데 팝업 [취소] · [끊기](빨강) → 방송을 끝낸다', async () => {
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

  it('방송 연결 경로가 끊은 뒤 홈으로 돌려보낸다', () => {
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

  it('한 단계 경로는 방송 시작 라벨 단계 화면을 그대로(only) 연다', () => {
    const route = read('app/label-setup.tsx')
    expect(route).toContain('<LabelSetupScreen only={step}')
    expect(read('app/label-print.tsx')).toContain("router.push({ pathname: '/label-setup', params: { step } })")
  })
})

describe('홈 "지금 라이브 중" (D-UX4-75)', () => {
  it('가장 진한 글자·가장 굵은 굵기가 아니다 — 한 단계 연한 회색·굵게', () => {
    const home = read('src/screens/HomeScreen.tsx')
    expect(home).toContain('<Txt step="title" weight="bold" ink={p.tabInk}>{label}</Txt>')
  })
})
