// PRN2 프린터 지원 단계 — 휴대폰 앱 (AC-PRN2-06·07·08·10, LABEL_RULES L-7 지원 단계, L-11 10·13·17, D-PRN2-01·06·07·08):
// - 숨김 스위치(EXPO_PUBLIC_PRINTER_EXPERIMENTAL)가 없다 — 켠 프로필 표 전부가 고르기 목록에, 실험 줄은 "실험" 꼬리표
// - 연결 뒤 프린터 이름, 실험 기종이면 "(실험)" + L-7 안내 한 줄, "이 기기에서 출력"은 그 연결의 테스트 인쇄 "예" 뒤에만
// - 연결 알림·"이 기기에서 출력"에 프로필 ID만, 받은 작업 크기가 그 프로필 목록에 없으면 INVALID_TEMPLATE(size) + L-11 13 문장
// - 제조사 앱으로 보내기 = 서버 PNG(/api/print/test-png) 바이트 그대로 공유 창에 (앱이 다시 만들지 않는다)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PickEntry } from '@livejjim/mobile-ble'
import { defaultTemplate } from '@livejjim/label'
import { BAUATO_PPA2L, B1_PROFILE, MARKLIFE_P12 } from '@livejjim/printer'
import type { ClaimedJob, QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LabelQueue } from '../src/lib/label-queue.ts'
import { FakeBlePrinter } from '../src/native/ble.ts'
import { LabelsScreen } from '../src/screens/LabelsScreen.tsx'
import { PrinterPickList } from '../src/screens/PrinterPickList.tsx'
import { makeWorld } from './screen-support.tsx'
import { FakeClock, FakeEventSource, FakeServer, flush } from './support.ts'

const NOTICE_BAUATO = '실험 중인 프린터예요. 테스트 인쇄가 잘 나오는지 꼭 확인해 주세요. 잘 안 나오면 라벨을 그림 파일로 Luck Jingle 앱에서 인쇄해 주세요.'
const WAIT_TEST = '실험 중인 프린터는 테스트 인쇄를 하고 "예"를 누른 뒤에 이 기기에서 출력할 수 있어요.'
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const APP_ROOT = join(__dirname, '..')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.expo')) return []
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

describe('숨김 스위치 없음 (AC-PRN2-07, D-PRN2-08)', () => {
  it('앱 코드·설정·문서 어디에도 EXPO_PUBLIC_PRINTER_EXPERIMENTAL·SHOW_EXPERIMENTAL_PRINTERS·enabledFamilies가 없다', () => {
    const files = filesUnder(APP_ROOT).filter((path) => /\.(tsx?|json|md|js|mjs|cjs|example)$|\.env/.test(path) && !path.endsWith('prn2-printer.test.tsx'))
    expect(files.length).toBeGreaterThan(10)
    const hits = files.filter((path) => /EXPO_PUBLIC_PRINTER_EXPERIMENTAL|SHOW_EXPERIMENTAL_PRINTERS|enabledFamilies/.test(readFileSync(path, 'utf8')))
    expect(hits).toEqual([])
  })

  it('고르기 목록: 실험 줄은 "실험" 꼬리표, NIIMBOT 줄은 표시 없음 — 기기 이름은 글자 그대로', () => {
    const entries: PickEntry[] = [
      { device: { id: 'AA:01', name: 'P50_1234', rssi: -50 } as PickEntry['device'], title: 'P50_1234', model: 'Marklife P50', signal: '신호 강함', experimental: true, detail: 'Marklife P50 · 실험 · 신호 강함' },
      { device: { id: 'AA:02', name: '<b>B1-G325</b>', rssi: -60 } as PickEntry['device'], title: '<b>B1-G325</b>', model: 'NIIMBOT', signal: '신호 보통', experimental: false, detail: 'NIIMBOT · 신호 보통' },
    ]
    render(<PrinterPickList entries={entries} onPick={() => {}} onClose={() => {}} />)
    expect(screen.getAllByText('실험')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'P50_1234 — Marklife P50 · 실험 · 신호 강함' })).toBeTruthy()
    expect(screen.getByText('<b>B1-G325</b>')).toBeTruthy()
  })
})

const job = (id: string, size: '50x30' | 'tape12x40'): ClaimedJob => ({
  id,
  date: '2026-10-29',
  kind: 'product',
  reason: 'auto',
  attempt: `${id}-a1`,
  data: {} as ClaimedJob['data'],
  template: defaultTemplate('product', size),
  page: null,
  pages: null,
  label: { key: `${id}@1`, claim: 'c1', version: 1, broadcast: 'b1', no: 15, buyerId: 'u1', buyer: { display: '홍길동' } as unknown as ClaimedJob['label']['buyer'] },
})

const summary = (patch: Partial<QueueSummary> = {}): QueueSummary => ({ rev: 1, device: { id: 'app-device-1', name: '내 휴대폰', live: true, printerConnected: true, releasing: false }, pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled: true, ...patch })

function setup(profile: FakeBlePrinter['profile'], shared?: Uint8Array[]) {
  const server = new FakeServer()
  server.install()
  const ble = new FakeBlePrinter({ profile })
  const sources: FakeEventSource[] = []
  const queue = new LabelQueue({
    ble,
    deviceId: 'app-device-1',
    openStream: () => {
      const source = new FakeEventSource('/api/stream')
      sources.push(source)
      return source
    },
    timer: new FakeClock(),
    ...(shared === undefined ? {} : { share: async (png: Uint8Array) => void shared.push(png) }),
  })
  return { server, ble, queue, sources }
}

describe('앱 대기열 (AC-PRN2-08·10, L-11 10·13·17)', () => {
  it('연결 알림에 프로필 ID만 — 못 찍는 크기면 그림을 받지 않고 INVALID_TEMPLATE(size), 문장은 L-11 13', async () => {
    const { server, ble, queue, sources } = setup(MARKLIFE_P12)
    const jobs = [job('j1', '50x30')]
    server.on('GET', /^\/api\/print$/, () => ({ body: { queue: summary({ waiting: jobs.length }), jobs: [], discard: [] } }))
    server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
    server.on('POST', /^\/api\/print\/claim$/, () => {
      const next = jobs.shift() ?? null
      return { body: { job: next, reason: next === null ? 'EMPTY' : undefined } }
    })
    server.on('GET', /^\/api\/print\/jobs\/[^/]+\/bitmap\?/, () => ({ body: { width: 320, height: 96, data: Buffer.alloc(40 * 96).toString('base64') } }))
    server.on('POST', /^\/api\/print\/result$/, () => ({ body: { recorded: true } }))
    queue.start()
    await flush()
    sources[0]!.open()
    await queue.connect()
    await flush(30)
    expect(server.callsTo('POST', /device\/state/).at(-1)?.body).toEqual({ deviceId: 'app-device-1', connected: true, profileId: 'MARKLIFE_P12' })
    const results = server.callsTo('POST', /\/api\/print\/result$/).map((call) => call.body)
    expect(results[0]).toEqual({ deviceId: 'app-device-1', attempt: 'j1-a1', ok: false, error: { code: 'INVALID_TEMPLATE', item: 'size' } })
    expect(server.callsTo('GET', /\/jobs\/j1\/bitmap/)).toHaveLength(0)
    expect(ble.printed).toHaveLength(0)
    queue.stop()
  })

  it('못 찍는 크기의 문장', async () => {
    const { server, queue, sources } = setup(BAUATO_PPA2L)
    const jobs = [job('j1', 'tape12x40')]
    server.on('GET', /^\/api\/print$/, () => ({ body: { queue: summary({ waiting: jobs.length }), jobs: [], discard: [] } }))
    server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
    server.on('POST', /^\/api\/print\/claim$/, () => ({ body: { job: jobs.shift() ?? null, reason: 'EMPTY' } }))
    server.on('POST', /^\/api\/print\/result$/, () => ({ body: { recorded: true } }))
    queue.start()
    await flush()
    sources[0]!.open()
    await queue.connect()
    await flush(30)
    expect(queue.getSnapshot().printerError?.message).toBe('이 프린터는 테이프 12×40 라벨을 찍을 수 없어요. 라벨 설정에서 크기를 바꿔 주세요.')
    queue.stop()
  })

  it('"제조사 앱으로 보내기"는 서버 PNG 바이트를 그대로 공유 창에 — 테스트 비트맵을 받아 다시 만들지 않는다', async () => {
    const shared: Uint8Array[] = []
    const { server, queue } = setup(B1_PROFILE, shared)
    server.on('GET', /^\/api\/print\/test-png$/, () => ({ bytes: PNG, contentType: 'image/png' }))
    expect(await queue.shareTest()).toBe(true)
    expect(shared.map((png) => [...png])).toEqual([[...PNG]])
    expect(server.callsTo('GET', /test-bitmap/)).toHaveLength(0)
    // PNG가 아니면 보내지 않고 쉬운 문장
    server.on('GET', /^\/api\/print\/test-png$/, () => ({ bytes: Uint8Array.from([1, 2, 3]), contentType: 'image/png' }))
    expect(await queue.shareTest()).toBe(false)
    expect(shared).toHaveLength(1)
    expect(queue.getSnapshot().printerError?.message).toBe('라벨 그림을 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.')
  })
})

describe('앱 라벨 화면 실험 표시 (AC-PRN2-06)', () => {
  it('실험(바우아토): 이름 뒤 "(실험)" + 안내, 테스트 인쇄 "예" 뒤에만 "이 기기에서 출력" — 등록에 프로필 ID', async () => {
    const world = makeWorld()
    world.ble.profile = BAUATO_PPA2L
    world.server.on('POST', /^\/api\/print\/device$/, () => ({ body: { queue: {}, waiting: 0, backlog: false } }))
    world.server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
    world.server.on('GET', /^\/api\/print\/test-bitmap$/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
    world.services.labels.start()
    render(world.wrap(<LabelsScreen onBack={() => {}} />))
    await waitFor(() => expect(screen.getByText('출력 기기 없음')).toBeTruthy())
    // 끊긴 동안은 실험 표시가 없다 (모델은 연결한 뒤에 안다)
    expect(screen.queryByText(/\(실험\)/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '블루투스로 연결' }))
    await waitFor(() => expect(screen.getByText('연결됨')).toBeTruthy())
    expect(screen.getByText('프린터 이름: 바우아토 스티코팝 (실험)')).toBeTruthy()
    expect(screen.getByText(NOTICE_BAUATO)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '이 기기에서 출력' })).toBeNull()
    expect(screen.getByText(WAIT_TEST)).toBeTruthy()
    // "출력 그만하기"는 출력 기기일 때만
    expect(screen.queryByRole('button', { name: '출력 그만하기' })).toBeNull()
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '테스트 인쇄' }))
    const result = await screen.findByRole('group', { name: '테스트 인쇄 결과' })
    fireEvent.click(within(result).getByRole('button', { name: '아니요' }))
    expect(screen.queryByRole('button', { name: '이 기기에서 출력' })).toBeNull()
    fireEvent.click(within(result).getByRole('button', { name: '예' }))
    fireEvent.click(await screen.findByRole('button', { name: '이 기기에서 출력' }))
    await waitFor(() => expect(world.server.callsTo('POST', /\/api\/print\/device$/)).toHaveLength(1))
    expect(world.server.callsTo('POST', /\/api\/print\/device$/)[0]?.body).toEqual({ deviceId: 'app-test', name: '내 휴대폰', profileId: 'BAUATO_PPA2L' })
    // 끊으면 확인도 지운다 (다시 이으면 그 연결에서 다시)
    world.ble.setState('DISCONNECTED')
    await flush()
    expect(world.services.labels.getSnapshot().testConfirmed).toBe(false)
    world.services.labels.stop()
  })

  it('확인됨(B1): "(실험)"·안내 없이 "이 기기에서 출력"이 바로', async () => {
    const world = makeWorld()
    world.ble.profile = B1_PROFILE
    world.server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
    world.services.labels.start()
    render(world.wrap(<LabelsScreen onBack={() => {}} />))
    await waitFor(() => expect(screen.getByText('출력 기기 없음')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '블루투스로 연결' }))
    await waitFor(() => expect(screen.getByText('연결됨')).toBeTruthy())
    expect(screen.getByText('프린터 이름: NIIMBOT B1')).toBeTruthy()
    expect(screen.queryByText(/실험/)).toBeNull()
    expect(screen.getByRole('button', { name: '이 기기에서 출력' })).toBeTruthy()
    world.services.labels.stop()
  })
})
