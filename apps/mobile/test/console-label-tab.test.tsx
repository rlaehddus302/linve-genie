// 라이브 화면 [라벨] 탭 (D-LABELTAB-01, 사용자 지시 2026-11-17 "라벨 기능 켜면 탭 바에 '라벨' 탭을 추가하고, 라벨 출력 리스트를 상품 리스트와 동일한 컨셉으로 …
// 출력된 라벨과 대기 중인 라벨 구분되게 … + 플로팅 버튼 위치에 출력 아이콘으로 … 수동으로 인풋 넣어서 출력").
// 탭 바 치수 (D-TABS-03, "토스와 상단 탭 바 위 여백·글자 크기가 다르다").
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { LABEL_GROUP_DONE, LABEL_WAITING, labelRows } from '../src/screens/console/LabelBoard.tsx'
import { LINE_TAB_BAR, LINE_TAB_HEIGHT, LINE_TABS_TOP } from '../src/ui/kit/index.ts'
import { barStart } from '../src/ui/kit/line-tabs.tsx'
import { SPACE, TYPE } from '../src/ui/kit/tokens.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, changes, claim, flush, product } from './support.ts'

const SLOW = 60_000
type World = ReturnType<typeof makeWorld>

const queueOf = (labelsEnabled: boolean) => ({ rev: labelsEnabled ? 2 : 1, device: null, pause: null, waiting: 1, printing: 0, discard: 0, labelsEnabled })

const label = (over: Partial<Record<keyof LabelView, unknown>>): LabelView => ({
  claim: 'c1', version: 1, key: 'c1@1', broadcast: 'b1', no: 15, buyerId: 'u1', date: '2026-10-29', kind: 'product', state: 'WAITING', word: '라벨 대기', voided: false, discard: 0, reprintNeeded: false, printed: 0, history: [],
  winner: true, data: { no: 15, name: '핑크프릴', price: 35_000, date: '2026-10-29', buyer: { kind: 'youtube', name: '홍길동' } }, canPrint: false, canReprint: false, buyer: { kind: 'youtube', name: '홍길동' },
  ...over,
}) as unknown as LabelView

/** 15번 대기 중, 16번 출력됨(19:42), 다른 라이브 라벨 하나(빠져야 한다), 직접 인쇄 출력됨 하나 */
const LABELS: LabelView[] = [
  label({}),
  label({ claim: 'c2', key: 'c2@1', no: 16, buyerId: 'u2', state: 'PRINTED', word: '라벨 출력됨', printed: 1, history: [{ at: '2026-10-29T19:42:00-10:00', device: '휴대폰' }], data: { no: 16, name: '홍옥', price: 3000, date: '2026-10-29', buyer: { kind: 'youtube', name: '김영희' } }, buyer: { kind: 'youtube', name: '김영희' } }),
  label({ claim: 'c9', key: 'c9@1', broadcast: 'b2', no: 3 }),
  label({ claim: null, key: 'direct:m1', no: 77, buyerId: null, state: 'PRINTED', history: [{ at: '2026-10-29T19:40:00-10:00', device: '휴대폰' }], data: { no: 77, name: '', price: 0, date: '2026-10-29', buyer: { kind: 'youtube', name: '직접 인쇄' } } }),
]

async function open(world: World, labelsEnabled: boolean) {
  world.server.on('GET', /^\/api\/print$/, () => ({ body: { queue: queueOf(labelsEnabled), jobs: [], discard: [] } }))
  world.server.on('GET', /^\/api\/print\/labels/, () => ({ body: { date: '2026-10-29', labels: labelsEnabled ? LABELS : [] } }))
  world.server.on('POST', /^\/api\/print\/labels\/direct$/, () => ({ body: { jobs: [] } }))
  world.services.labels.start()
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5$/, () => ({
    body: changes(5, 7, {
      products: [
        product(15, { name: '핑크프릴', price: 35_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], confirmedUnits: 1 }),
        product(16, { name: '홍옥', price: 3000, status: 'SOLD', winners: ['u2'], winnerClaims: ['c2'], confirmedUnits: 1 }),
      ],
      claims: [claim('c1', 15, 'u1'), claim('c2', 16, 'u2')],
      buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희')],
    }),
  }))
  await act(async () => {
    world.source().emit('change', { date: '2026-10-29', rehearsal: false, seq: 7, type: 'chat' })
    await flush()
  })
  world.seq = 7
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=([7-9]|\d\d)$/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1]), world.seq, {}) }))
}

describe('라이브 화면 [라벨] 탭 (D-LABELTAB-01)', () => {
  it('줄 묶기: 이 라이브 상품 라벨만, 대기 중 먼저 · 출력됨은 최근 출력 먼저', () => {
    const rows = labelRows(LABELS, 'b1', [], null)
    expect(rows.map((row) => [row.no, row.group])).toEqual([[15, 'waiting'], [16, 'done'], [77, 'done']])
    expect(rows[0]?.status).toBe(LABEL_WAITING)
    expect(rows[1]?.status).toMatch(/^\d{1,2}:\d{2} 출력$/)
    expect(rows[2]?.direct).toBe(true)
  })

  it('라벨 기능이 꺼져 있으면 [라벨] 탭이 없다', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world, false)
    await screen.findByRole('button', { name: '상품' })
    expect(screen.queryByRole('button', { name: '라벨' })).toBeNull()
    world.services.labels.stop()
  }, SLOW)

  it('켜져 있으면 [라벨] 탭 — 대기 중·출력됨이 나뉘고, 인쇄 단추로 직접 인쇄(번호를 적으면 품종·가격을 채운다)', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world, true)
    fireEvent.click(await screen.findByRole('button', { name: '라벨' }))
    const list = await screen.findByRole('list', { name: '라벨 목록' })
    expect(within(list).getByTestId('label-group-waiting')).toBeTruthy()
    expect(within(within(list).getByTestId('label-group-waiting')).getByText('핑크프릴')).toBeTruthy()
    expect(within(within(list).getByTestId('label-group-done')).getByText('홍옥')).toBeTruthy()
    expect(within(list).getByText(`${LABEL_GROUP_DONE} 2`)).toBeTruthy()
    expect(within(list).queryByText('3')).toBeNull()
    // (+) 자리엔 인쇄 단추, 상품 추가 단추는 없다
    expect(screen.queryByTestId('add-product')).toBeNull()
    fireEvent.click(screen.getByTestId('print-fab'))
    const form = await screen.findByRole('group', { name: '라벨 직접 인쇄' })
    fireEvent.change(within(form).getByLabelText('상품 번호'), { target: { value: '16' } })
    expect((within(form).getByLabelText('품종') as HTMLInputElement).value).toBe('홍옥')
    expect((within(form).getByLabelText('가격 (원)') as HTMLInputElement).value).toBe('3000')
    fireEvent.change(within(form).getByLabelText('손님 이름 (선택)'), { target: { value: '꽃언니' } })
    fireEvent.click(within(form).getByRole('button', { name: '16번 라벨 인쇄' }))
    await waitFor(() => expect(world.server.callsTo('POST', /^\/api\/print\/labels\/direct$/)).toHaveLength(1))
    expect(world.server.callsTo('POST', /^\/api\/print\/labels\/direct$/)[0]?.body).toMatchObject({ b: 'b1', no: 16, name: '홍옥', price: 3000, nickname: '꽃언니' })
    world.services.labels.stop()
  }, SLOW)
})

describe('탭 바 치수 (D-TABS-03, 토스 거래 내역 사진 재기)', () => {
  it('위 여백 4 · 탭 높이 35 · 밑줄 2 · 글 15', async () => {
    expect(LINE_TABS_TOP).toBe(SPACE.xs)
    expect(LINE_TAB_HEIGHT).toBe(35)
    expect(LINE_TAB_BAR).toBe(2)
    const world = makeWorld({ products: [product(15)] })
    await open(world, true)
    const tab = await screen.findByRole('button', { name: '상품' })
    expect(getComputedStyle(within(tab).getByText(/^상품/)).fontSize).toBe(`${String(TYPE.body)}px`)
    expect(getComputedStyle(within(tab).getByTestId('line-tab-bar')).height).toBe('2px')
    world.services.labels.stop()
  }, SLOW)
})

// D-TABS-04 (사용자 "탭 전환할 때 탭 아래 검정 선이 좌우로 움직이는 애니메이션"): 새 탭 밑줄은 옛 밑줄 가운데·폭에서 시작해 제자리로
describe('탭 밑줄 미끄러짐 (D-TABS-04)', () => {
  it('옛 탭 가운데까지 옮기고 옛 폭 비율로 늘여 시작한다', () => {
    // 옛 탭 0~100(가운데 50), 새 탭 120~180(가운데 150, 폭 60)
    expect(barStart({ x: 0, width: 100 }, { x: 120, width: 60 })).toEqual({ shift: -100, stretch: 100 / 60 })
    // 오른쪽에서 왼쪽으로
    expect(barStart({ x: 120, width: 60 }, { x: 0, width: 100 })).toEqual({ shift: 100, stretch: 0.6 })
  })
  it('처음 그릴 때·같은 자리·폭이 0이면 움직이지 않는다', () => {
    expect(barStart(null, { x: 0, width: 100 })).toBeNull()
    expect(barStart({ x: 10, width: 50 }, { x: 10, width: 50 })).toBeNull()
    expect(barStart({ x: 10, width: 50 }, { x: 80, width: 0 })).toBeNull()
  })
  it('탭을 바꿔도 밑줄은 고른 탭 안에 하나', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world, true)
    fireEvent.click(await screen.findByRole('button', { name: '찜 기록' }))
    await waitFor(() => expect(within(screen.getByRole('button', { name: '찜 기록' })).getByTestId('line-tab-bar')).toBeTruthy())
    expect(screen.getAllByTestId('line-tab-bar')).toHaveLength(1)
    expect(within(screen.getByRole('button', { name: '상품' })).queryByTestId('line-tab-bar')).toBeNull()
    world.services.labels.stop()
  }, SLOW)
})
