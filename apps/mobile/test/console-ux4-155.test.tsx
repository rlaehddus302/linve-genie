// 사용자 지시 2026-11-16 (D-UX4-155~158):
// - 채팅·문자 탭을 누르면 탭 바가 사라진다 → 앱이 맨 아래로 굴리거나 새 줄을 따라가도 숨지 않고, 손으로 굴린 거리만 센다 (D-UX4-155)
// - 음성 인식은 왜 끝난 라이브엔 볼 수 없어? 채팅처럼 다 저장해두는 거 아니야? 보이게 해줘 → 서버 기록을 읽어 보인다 (D-UX4-156)
// - 정산 내역서의 [라이브 기록]은 쌓인 화면처럼 밀려 들어오고, 거기서 뒤로는 정산 내역서로 (D-UX4-157)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { HEARD_EMPTY_ENDED, HEARD_TAB } from '../src/screens/console/StreamAudio.tsx'
import { HEARD_EDGE_MS, localHeard, mergeHeard } from '../src/screens/console/heard-history.ts'
import { TAB_HIDE_START, nextTabHide } from '../src/screens/console/tab-hide.ts'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST, flush } from './support.ts'

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8')

describe('탭 바 숨김은 손으로 굴린 거리만 센다 (D-UX4-155)', () => {
  const TOP = 200
  const HEIGHT = 48
  it('앱이 맨 아래로 바로 굴려도(채팅·문자·음성 인식 탭) 탭 바는 다 보인다', () => {
    const jumped = nextTabHide(TAB_HIDE_START, 5_000, TOP, HEIGHT, false)
    expect(jumped.hidden).toBe(0)
    // 새 줄을 따라 또 내려가도 그대로
    expect(nextTabHide(jumped, 5_200, TOP, HEIGHT, false).hidden).toBe(0)
  })
  it('손으로 내려가면 굴린 만큼 숨고(탭 바 높이까지), 손으로 올라가면 다시 보인다', () => {
    let state = nextTabHide(TAB_HIDE_START, 300, TOP, HEIGHT, false)
    state = nextTabHide(state, 330, TOP, HEIGHT, true)
    expect(state.hidden).toBe(30)
    state = nextTabHide(state, 600, TOP, HEIGHT, true)
    expect(state.hidden).toBe(HEIGHT)
    state = nextTabHide(state, 580, TOP, HEIGHT, true)
    expect(state.hidden).toBe(28)
    state = nextTabHide(state, 500, TOP, HEIGHT, true)
    expect(state.hidden).toBe(0)
  })
  it('숨은 채로 앱이 따라 내려가도 숨김을 바꾸지 않고, 탭 바가 제자리(붙기 전)면 늘 보인다', () => {
    const hidden = { hidden: HEIGHT, lastY: 900 }
    expect(nextTabHide(hidden, 1_200, TOP, HEIGHT, false).hidden).toBe(HEIGHT)
    expect(nextTabHide(hidden, 100, TOP, HEIGHT, false).hidden).toBe(0)
    expect(nextTabHide(hidden, 150, TOP, HEIGHT, true).hidden).toBe(0)
  })
  it('라이브 화면이 탭을 바꿀 때 보이게 하고, 끌기·미끄러짐·굴림을 넘긴다 — 휴대폰 숨김(stickyHeaderHiddenOnScroll)은 쓰지 않는다', () => {
    const source = read('src/screens/ConsoleScreen.tsx')
    expect(source).not.toMatch(/^\s*stickyHeaderHiddenOnScroll/m)
    expect(source).toMatch(/useEffect\(\(\) => \{\n\s*resetFollow\(\)\n\s*showTabs\(\)/)
    for (const wire of ['tabHide.drag(true)', 'tabHide.drag(false)', 'onMomentumScrollBegin={() => tabHide.glide(true)}', 'onMomentumScrollEnd={() => tabHide.glide(false)}', 'tabHide.track(event.nativeEvent.contentOffset.y)', 'onLayout={tabHide.onLayout}']) expect(source).toContain(wire)
  })
})

describe('들린 말 서버 기록 합치기 (D-UX4-156)', () => {
  const at = (s: number) => Date.parse('2026-10-29T12:00:00.000Z') + s * 1000
  it('이 기기 줄이 없으면 서버 기록 그대로, 있으면 기기 첫 줄 앞까지의 서버 줄 + 기기 줄', () => {
    const saved = [{ at: at(0), text: '앞 말' }, { at: at(10), text: '둘째 말' }, { at: at(20), text: '셋째 말' }]
    expect(mergeHeard(saved, [])).toEqual(saved)
    const local = [{ at: at(20), text: '셋째 말' }, { at: at(25), text: '넷째 말' }]
    expect(mergeHeard(saved, local).map((line) => line.text)).toEqual(['앞 말', '둘째 말', '셋째 말', '넷째 말'])
  })
  it('기기 시계가 조금 빨라도 같은 말을 두 번 보이지 않는다', () => {
    const saved = [{ at: at(0), text: '앞 말' }, { at: at(20), text: '셋째 말' }]
    const local = [{ at: at(20) + HEARD_EDGE_MS * 3, text: '셋째 말' }]
    expect(mergeHeard(saved, local).map((line) => line.text)).toEqual(['앞 말', '셋째 말'])
  })
  it('기기 줄은 그 방송 것만', () => {
    const view = { broadcastId: 'b1', transcript: ['가', '나'], transcriptAt: [at(1), at(2)] }
    expect(localHeard(view, 'b1')).toEqual([{ at: at(1), text: '가' }, { at: at(2), text: '나' }])
    expect(localHeard(view, 'b2')).toEqual([])
  })
})

/** 끝난 라이브 세계 */
function endedWorld() {
  const world = makeWorld({ products: [] })
  world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, ended: true, endedAt: '2026-10-29T13:00:00.000Z' }] } }))
  return world
}
async function start(world: ReturnType<typeof makeWorld>, element: Parameters<typeof render>[0]) {
  render(world.wrap(element))
  await waitFor(() => expect(world.sources.length).toBeGreaterThan(0))
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
}

describe('끝난 라이브의 음성 인식 탭 (D-UX4-156)', () => {
  it('판매자에게 보이고, 서버가 남긴 그 방송의 인식한 말을 시간순으로 초까지 보인다', async () => {
    const world = endedWorld()
    const base = Date.parse('2026-10-29T12:07:33.000Z')
    world.server.on('GET', /^\/api\/broadcasts\/b1\/heard$/, () => ({ body: { lines: [{ at: base, text: '15번 핑크프릴 이만 원' }, { at: base + 61_000, text: '16번 갑니다' }] } }))
    await start(world, <ConsoleScreen broadcastId="b1" seller onBack={() => {}} startPage="record" />)
    expect(await screen.findByText('끝난 라이브')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: HEARD_TAB }))
    await waitFor(() => expect(screen.getAllByTestId('heard-tab-row')).toHaveLength(2))
    expect(screen.getAllByTestId('heard-tab-row').map((row) => row.textContent)).toEqual(['21:07:3315번 핑크프릴 이만 원', '21:08:3416번 갑니다'])
    expect(world.server.callsTo('GET', /^\/api\/broadcasts\/b1\/heard$/).length).toBeGreaterThan(0)
  })
  it('남은 말이 없으면 끝난 라이브 안내', async () => {
    const world = endedWorld()
    world.server.on('GET', /^\/api\/broadcasts\/b1\/heard$/, () => ({ body: { lines: [] } }))
    await start(world, <ConsoleScreen broadcastId="b1" seller onBack={() => {}} startPage="record" />)
    fireEvent.click(await screen.findByRole('button', { name: HEARD_TAB }))
    expect(await screen.findByText(HEARD_EMPTY_ENDED)).toBeTruthy()
  })
})

describe('정산 내역서 ↔ 라이브 기록 (D-UX4-157)', () => {
  it('[라이브 기록]은 쌓인 화면을 연다(openRecord) — 같은 화면 안에서 바꾸지 않는다', async () => {
    const world = endedWorld()
    let opened = 0
    await start(world, <ConsoleScreen broadcastId="b1" seller onBack={() => {}} openRecord={() => opened++} />)
    fireEvent.click(await screen.findByRole('button', { name: '라이브 기록' }))
    expect(opened).toBe(1)
    expect(screen.getByText('정산 내역서')).toBeTruthy()
    expect(screen.queryByText('끝난 라이브')).toBeNull()
  })
  it('쌓인 라이브 기록(startPage=record)은 정산 내역서 없이 열리고, 뒤로·매출 캡슐은 정산 내역서로(onBack)', async () => {
    const world = endedWorld()
    let back = 0
    await start(world, <ConsoleScreen broadcastId="b1" seller onBack={() => back++} startPage="record" />)
    expect(await screen.findByText('끝난 라이브')).toBeTruthy()
    expect(screen.queryByText('정산 내역서')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '정산 내역서로' }))
    expect(back).toBe(1)
  })
  it('경로가 없을 때(시험·웹) 같은 화면 안의 라이브 기록에서 뒤로는 홈이 아니라 정산 내역서', async () => {
    const world = endedWorld()
    let home = 0
    await start(world, <ConsoleScreen broadcastId="b1" seller onBack={() => home++} />)
    fireEvent.click(await screen.findByRole('button', { name: '라이브 기록' }))
    expect(screen.getByText('끝난 라이브')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '정산 내역서로' }))
    expect(await screen.findByText('정산 내역서')).toBeTruthy()
    expect(home).toBe(0)
    // 정산 내역서에서 뒤로는 지금처럼 홈
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    expect(home).toBe(1)
  })
  it('경로: 방송 화면의 [라이브 기록]은 /console/[id]/record를 쌓고, 그 화면은 다른 쌓인 화면처럼(넘김 효과 끄지 않음) 뒤로가 정산 내역서로', () => {
    const index = read('app/console/[id]/index.tsx')
    expect(index).toContain("openRecord={() => router.push({ pathname: '/console/[id]/record', params: { id } })}")
    const record = read('app/console/[id]/record.tsx')
    expect(record).toContain('<RouteFrame>')
    expect(record).toContain('startPage="record"')
    expect(record).toContain("const sales = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/console/[id]', params: { id } }))")
    expect(record).toContain('onBack={sales}')
    // 화면 넘김 없음(animation: 'none')은 아래 탭 화면만
    expect(read('app/_layout.tsx')).toContain("TAB_SCREENS.map((name) => (\n              <Stack.Screen key={name} name={name} options={{ animation: 'none' }} />")
    expect(read('src/lib/tab-routes.ts')).not.toContain('console')
  })
})
