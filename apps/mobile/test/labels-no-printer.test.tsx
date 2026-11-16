// 프린터 없이도 라벨 (D-LBL-NOPRN-01, 사용자 지시 2026-11-16 "라벨 기능 잘 동작하는지 보기 위해 라벨 프린터 연결 안 되어 있더라도 기능 보이게 활성화해라.
// 그리고 프린터 없으면 일단 큐에 넣어라"). 서버는 라벨 뽑기가 켜져 있으면 프린터(출력 기기)가 없어도 라벨 작업을 대기열에 쌓는다 — 앱은
// - 상품 자세히에 1등 라벨 단추를 프린터 연결과 상관없이 보이고, 누르면 대기열에 넣는다(POST /api/print/labels/print).
// - 이어진 프린터가 없으면 "프린터가 없어도 라벨은 대기열에 쌓여요 …" 한 줄을 보인다.
// - 라벨 뽑기가 꺼져 있으면 그 자리에서 [라벨 뽑기 켜기](PUT /api/settings/labels { enabled: true }) — 옛: "관리에서 ‘라벨 뽑기’를 켜 주세요" 글만.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import { LABELS_NO_PRINTER, LABELS_OFF_LINE, LABELS_TURN_ON } from '../src/lib/print-words.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { buyer, changes, claim, flush, product } from './support.ts'

const SLOW = 60_000

type World = ReturnType<typeof makeWorld>

const queueOf = (labelsEnabled: boolean, printer: boolean) => ({
  rev: labelsEnabled ? 2 : 1,
  device: printer ? { id: 'phone-1', name: '판매자 휴대폰', live: true, printerConnected: true, releasing: false } : null,
  pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled,
})

/** 15번 1등 홍길동의 라벨 — 아직 작업이 없어 [라벨 인쇄]를 누를 수 있다 */
const LABEL: LabelView = {
  b: 'b1', claim: 'c1', version: 1, key: 'c1@1', broadcast: 'b1', date: '2026-10-29', kind: 'product', state: 'NONE', word: '', voided: false, discard: 0, reprintNeeded: false, printed: 0, history: [],
  winner: true, data: null, canPrint: true, canReprint: false, buyer: { kind: 'youtube', name: '홍길동' },
} as unknown as LabelView

async function open(world: World, labelsEnabled: boolean, printer: boolean) {
  let enabled = labelsEnabled
  world.server.on('GET', /^\/api\/print$/, () => ({ body: { queue: queueOf(enabled, printer), jobs: [], discard: [] } }))
  world.server.on('GET', /^\/api\/print\/labels/, () => ({ body: { date: '2026-10-29', labels: enabled ? [LABEL] : [] } }))
  world.server.on('PUT', /^\/api\/settings\/labels$/, (call) => {
    enabled = call.body?.enabled === true
    return { body: { enabled, changed: true } }
  })
  world.server.on('POST', /^\/api\/print\/labels\/print$/, () => ({ body: { queued: true } }))
  world.services.labels.start()
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5$/, () => ({
    body: changes(5, 7, {
      products: [product(15, { name: '핑크프릴', price: 35_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], confirmedUnits: 1 })],
      claims: [claim('c1', 15, 'u1')],
      buyers: [buyer('u1', '홍길동')],
    }),
  }))
  await act(async () => {
    world.source().emit('change', { date: '2026-10-29', rehearsal: false, seq: 7, type: 'chat' })
    await flush()
  })
  world.seq = 7
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=([7-9]|\d\d)$/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1]), world.seq, {}) }))
}

async function openDetail() {
  fireEvent.click(within(await screen.findByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 15번' }))
  return screen.findByRole('group', { name: '상품 자세히' })
}

describe('프린터 없이도 라벨 (D-LBL-NOPRN-01)', () => {
  it('라벨 뽑기가 켜져 있고 프린터가 없으면: 1등 라벨 단추가 보이고 "대기열에 쌓여요" 한 줄 — 누르면 대기열에 넣는다', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world, true, false)
    const detail = await openDetail()
    expect(await within(detail).findByText(LABELS_NO_PRINTER)).toBeTruthy()
    const print = await within(detail).findByRole('button', { name: '홍길동 · 라벨 인쇄' })
    fireEvent.click(print)
    await waitFor(() => expect(world.server.callsTo('POST', /^\/api\/print\/labels\/print$/)).toHaveLength(1))
    expect(world.server.callsTo('POST', /^\/api\/print\/labels\/print$/)[0]?.body).toMatchObject({ b: 'b1', claim: 'c1' })
    expect(await within(detail).findByText('출력 대기열에 넣었어요.')).toBeTruthy()
    world.services.labels.stop()
  }, SLOW)

  it('프린터가 이어져 있으면 "대기열에 쌓여요" 한 줄은 없다', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world, true, true)
    const detail = await openDetail()
    await within(detail).findByRole('button', { name: '홍길동 · 라벨 인쇄' })
    expect(within(detail).queryByText(LABELS_NO_PRINTER)).toBeNull()
    world.services.labels.stop()
  }, SLOW)

  it('라벨 뽑기가 꺼져 있으면 [라벨 뽑기 켜기] → 켜고(PUT enabled true) 1등 라벨 단추가 나온다', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world, false, false)
    const detail = await openDetail()
    expect(await within(detail).findByText(LABELS_OFF_LINE)).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: '홍길동 · 라벨 인쇄' })).toBeNull()
    fireEvent.click(within(detail).getByRole('button', { name: LABELS_TURN_ON }))
    await waitFor(() => expect(world.server.callsTo('PUT', /^\/api\/settings\/labels$/)[0]?.body).toEqual({ enabled: true }))
    expect(await within(detail).findByRole('button', { name: '홍길동 · 라벨 인쇄' }, { timeout: 3000 })).toBeTruthy()
    expect(within(detail).queryByText(LABELS_OFF_LINE)).toBeNull()
    expect(within(detail).getByText(LABELS_NO_PRINTER)).toBeTruthy()
    world.services.labels.stop()
  }, SLOW)
})
