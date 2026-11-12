// PRN2 프린터 지원 단계 — 휴대폰 앱 (AC-PRN2-06·07·08·10, LABEL_RULES L-7 지원 단계, L-11 10·13·17, D-PRN2-01·06·07·08):
// - 숨김 스위치(EXPO_PUBLIC_PRINTER_EXPERIMENTAL)가 없다 — 켠 프로필 표 전부가 고르기 목록에, 실험 줄은 "실험" 꼬리표
// - 연결 뒤 프린터 이름, 실험 기종이면 "(실험)" + L-7 안내 한 줄, "이 기기에서 출력"은 그 연결의 테스트 인쇄 "예" 뒤에만
// - 연결 알림·"이 기기에서 출력"에 프로필 ID만, 받은 작업 크기가 그 프로필 목록에 없으면 INVALID_TEMPLATE(size) + L-11 13 문장
// - 제조사 앱으로 보내기 = 서버 PNG(/api/print/test-png) 바이트 그대로 공유 창에 (앱이 다시 만들지 않는다)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pickEntries, type PickEntry } from '@livejjim/mobile-ble'
import { defaultTemplate } from '@livejjim/label'
import { BAUATO_PPA2L, B1_PROFILE, MARKLIFE_P12, MARKLIFE_S2, NIIMBOT_D110 } from '@livejjim/printer'
import type { ClaimedJob, QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LabelQueue, testLabelSize } from '../src/lib/label-queue.ts'
import { FakeBlePrinter } from '../src/native/ble.ts'
import { ServicesProvider } from '../src/services.tsx'
import { LabelsScreen } from '../src/screens/LabelsScreen.tsx'
import { PrinterPickList } from '../src/screens/PrinterPickList.tsx'
import { makeWorld } from './screen-support.tsx'
import { FakeClock, FakeEventSource, FakeServer, flush } from './support.ts'

// D-UX3-19: 옛 기대 — 연결 뒤 이 안내 한 줄. 새 기대 — 안내 없음
const NOTICE_BAUATO = '실험 중인 프린터예요. 테스트 인쇄가 잘 나오는지 꼭 확인해 주세요. 잘 안 나오면 라벨을 그림 파일로 Luck Jingle 앱에서 인쇄해 주세요.'
// D-UX3-19: 옛 문장 '실험 중인 프린터는 테스트 인쇄를 하고 "예"를…'
const WAIT_TEST = '이 프린터는 테스트 인쇄를 하고 "예"를 누른 뒤에 이 기기에서 출력할 수 있어요.'
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

  // D-UX3-19 (사용자 지시 2026-11-03 "기본 프린터, 실험 프린터 그런게 어딨어"): 옛 기대 — 실험 줄은 "실험" 꼬리표 하나. 새 기대 — 어느 줄에도 꼬리표 없음
  it('고르기 목록: 어느 줄에도 "실험" 꼬리표가 없다 — 기기 이름은 글자 그대로', () => {
    // 실제 고르기 줄 만들기(pickEntries) 결과 그대로 — detail에도 없다 (D-PRN2-33)
    const devices = [
      { id: 'AA:01', name: 'P50_1234', rssi: -50 },
      { id: 'AA:02', name: '<b>B1-G325</b>', rssi: -70 },
    ] as PickEntry['device'][]
    const entries = pickEntries(devices, (device) => (device.id === 'AA:01' ? 'Marklife P50' : 'NIIMBOT'), { experimental: (device) => device.id === 'AA:01' })
    expect(entries.map((entry) => entry.detail)).toEqual(['Marklife P50 · 신호 강함', 'NIIMBOT · 신호 보통'])
    render(<PrinterPickList entries={entries} onPick={() => {}} onClose={() => {}} />)
    expect(screen.queryByText(/실험/)).toBeNull()
    expect(screen.getByRole('button', { name: 'P50_1234 — Marklife P50 · 신호 강함' })).toBeTruthy()
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
    server.on('GET', /^\/api\/print\/test-bitmap\?size=tape12x40$/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
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
    server.on('GET', /^\/api\/print\/test-bitmap\?size=50x30$/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
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
    // 크기는 이은 프린터 프로필의 기본 크기 — 모르면(끊김) 50×30 (D-PRN2-11)
    server.on('GET', /^\/api\/print\/test-png\?size=50x30$/, () => ({ bytes: PNG, contentType: 'image/png' }))
    expect(await queue.shareTest()).toBe(true)
    expect(shared.map((png) => [...png])).toEqual([[...PNG]])
    expect(server.callsTo('GET', /test-bitmap/)).toHaveLength(0)
    // PNG가 아니면 보내지 않고 쉬운 문장
    server.on('GET', /^\/api\/print\/test-png\?size=50x30$/, () => ({ bytes: Uint8Array.from([1, 2, 3]), contentType: 'image/png' }))
    expect(await queue.shareTest()).toBe(false)
    expect(shared).toHaveLength(1)
    expect(queue.getSnapshot().printerError?.message).toBe('라벨 그림을 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.')
  })
})

describe('앱 라벨 화면 실험 표시 (AC-PRN2-06)', () => {
  // D-UX3-19: 옛 기대 — 이름 뒤 "(실험)" + 안내. 새 기대 — 이름만, 테스트 "예" 뒤에만 "이 기기에서 출력"은 그대로
  it('바우아토: 이름만("(실험)"·안내 없음), 테스트 인쇄 전에도 "이 기기에서 출력" — 등록에 프로필 ID', async () => {
    const world = makeWorld()
    world.ble.profile = BAUATO_PPA2L
    world.server.on('POST', /^\/api\/print\/device$/, () => ({ body: { queue: {}, waiting: 0, backlog: false } }))
    world.server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
    world.server.on('GET', /^\/api\/print\/test-bitmap\?size=50x30$/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
    world.services.labels.start()
    render(world.wrap(<LabelsScreen onBack={() => {}} />))
    await waitFor(() => expect(screen.getByText('출력 기기 없음')).toBeTruthy())
    // 끊긴 동안은 실험 표시가 없다 (모델은 연결한 뒤에 안다)
    expect(screen.queryByText(/\(실험\)/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '블루투스로 연결' }))
    await waitFor(() => expect(screen.getByText('연결됨')).toBeTruthy())
    expect(screen.getByText('프린터 이름: 바우아토 스티코팝')).toBeTruthy()
    expect(screen.queryByText(NOTICE_BAUATO)).toBeNull()
    expect(screen.queryByText(/\(실험\)/)).toBeNull()
    expect(screen.getByRole('button', { name: '이 기기에서 출력' })).toBeTruthy()
    expect(screen.queryByText(WAIT_TEST)).toBeNull()
    // "출력 그만하기"는 출력 기기일 때만
    expect(screen.queryByRole('button', { name: '출력 그만하기' })).toBeNull()
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '테스트 인쇄' }))
    const result = await screen.findByRole('group', { name: '테스트 인쇄 결과' })
    fireEvent.click(within(result).getByRole('button', { name: '아니요' }))
    expect(screen.getByRole('button', { name: '이 기기에서 출력' })).toBeTruthy()
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

describe('출력 기기의 실험 기종: 테스트 없이 상품 출력', () => {
  function station(profile: FakeBlePrinter['profile'], jobs: ClaimedJob[]) {
    const made = setup(profile)
    const { server } = made
    server.on('GET', /^\/api\/print$/, () => ({ body: { queue: summary({ waiting: jobs.length }), jobs: [], discard: [] } }))
    server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
    server.on('POST', /^\/api\/print\/claim$/, () => {
      const next = jobs.shift() ?? null
      return { body: { job: next, reason: next === null ? 'EMPTY' : undefined } }
    })
    server.on('GET', /^\/api\/print\/jobs\/[^/]+\/bitmap\?/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
    server.on('POST', /^\/api\/print\/result$/, () => ({ body: { recorded: true } }))
    server.on('GET', /^\/api\/print\/test-bitmap\?size=[a-z0-9]+$/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
    const states = (): unknown[] => server.callsTo('POST', /device\/state/).map((call) => call.body)
    const claims = (): number => server.callsTo('POST', /\/api\/print\/claim$/).length
    return { ...made, states, claims }
  }

  it('처음 연결과 재연결에서 테스트 용지 없이 대기 중인 실제 라벨만 한 장씩 출력한다', async () => {
    const jobs = [job('j1', '50x30')]
    const { queue, sources, ble, server, states } = station(BAUATO_PPA2L, jobs)
    queue.start()
    await flush()
    sources[0]!.open()
    await queue.connect()
    await flush(30)
    expect(ble.printed).toHaveLength(1)
    ble.drop()
    await flush(30)
    expect(states().at(-1)).toEqual({ deviceId: 'app-device-1', connected: false })
    jobs.push(job('j2', '50x30'))
    await queue.reconnect()
    await flush(30)
    expect(states().at(-1)).toMatchObject({ connected: true, profileId: 'BAUATO_PPA2L' })
    expect(server.callsTo('POST', /print\/result$/).map(call => call.body)).toEqual([
      { deviceId: 'app-device-1', attempt: 'j1-a1', ok: true },
      { deviceId: 'app-device-1', attempt: 'j2-a1', ok: true },
    ])
    expect(ble.printed).toHaveLength(2)
    expect(server.callsTo('GET', /test-bitmap/)).toHaveLength(0)
    queue.stop()
  })

  it('확인됨(B1)은 테스트 없이 바로 받는다', async () => {
    const jobs = [job('j1', '50x30')]
    const { queue, sources, server, states } = station(B1_PROFILE, jobs)
    queue.start()
    await flush()
    sources[0]!.open()
    await queue.connect()
    await flush(30)
    expect(states().at(-1)).toEqual({ deviceId: 'app-device-1', connected: true, profileId: 'NIIMBOT_B1' })
    expect(server.callsTo('POST', /\/api\/print\/result$/)).toHaveLength(1)
    queue.stop()
  })

  it('수동 테스트를 누른 경우에만 결과를 확인한다', async () => {
    const world = makeWorld()
    world.ble.profile = MARKLIFE_P12
    let connected = true
    world.server.on('GET', /^\/api\/print$/, () => ({
      body: {
        queue: {
          rev: 1,
          device: { id: 'app-test', name: '내 휴대폰', live: true, printerConnected: connected, releasing: false },
          pause: connected ? null : { reason: 'DISCONNECTED', message: '프린터 연결이 끊겨 출력을 멈췄어요.', backlog: false },
          waiting: 0,
          printing: 0,
          discard: 0,
          labelsEnabled: true,
        },
        jobs: [],
        discard: [],
      },
    }))
    world.server.on('POST', /^\/api\/print\/device\/state$/, (call) => {
      connected = call.body?.['connected'] === true
      return { body: {} }
    })
    world.server.on('GET', /^\/api\/print\/test-bitmap\?size=tape12x40$/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
    world.server.on('POST', /^\/api\/print\/claim$/, () => ({body: {job:null,reason:'EMPTY'}}))
    world.services.labels.start()
    render(world.wrap(<LabelsScreen onBack={() => {}} />))
    await waitFor(() => expect(screen.getByText('이 기기가 출력 기기예요 · 내 휴대폰')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '블루투스로 연결' }))
    await waitFor(() => expect(screen.getByText('연결됨')).toBeTruthy())
    await world.services.labels.reload()
    expect(world.server.callsTo('GET', /test-bitmap/)).toHaveLength(0)
    const testButton = within(screen.getByRole('group', { name: '프린터' })).getByRole('button', { name: '테스트 인쇄' })
    await waitFor(() => expect(testButton.hasAttribute('disabled')).toBe(false))
    fireEvent.click(testButton)
    const result = await screen.findByRole('group', { name: '테스트 인쇄 결과' })
    fireEvent.click(within(result).getByRole('button', { name: '예' }))
    await waitFor(() => expect(screen.getByText('테스트 인쇄가 잘 나온 것을 확인했어요.')).toBeTruthy())
    await waitFor(() => expect(world.server.callsTo('POST', /device\/state/).at(-1)?.body).toEqual({ deviceId: 'app-test', connected: true, profileId: 'MARKLIFE_P12' }))
    expect(screen.queryByText('이 프린터는 테스트 인쇄를 하고 "예"를 누른 뒤에 라벨을 찍어요.')).toBeNull()
    world.services.labels.stop()
  })
})

describe('PRN2 수정 라운드 — 앱을 웹과 같은 기준으로 (D-PRN2-27·28·29·31·34)', () => {
  const templatesWith = (size: string) => ({ body: { product: { template: { ...defaultTemplate('product', '50x30'), size }, version: 1 }, packing: { template: defaultTemplate('packing', '50x30'), version: 1 } } })
  const testBitmap = () => ({ body: { width: 8, height: 2, data: '/4E=' } })

  function station(profile: FakeBlePrinter['profile'], jobs: ClaimedJob[], shared?: Uint8Array[]) {
    const made = setup(profile, shared)
    const { server } = made
    server.on('GET', /^\/api\/print$/, () => ({ body: { queue: summary({ waiting: jobs.length }), jobs: [], discard: [] } }))
    server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
    server.on('POST', /^\/api\/print\/claim$/, () => {
      const next = jobs.shift() ?? null
      return { body: { job: next, reason: next === null ? 'EMPTY' : undefined } }
    })
    server.on('POST', /^\/api\/print\/result$/, () => ({ body: { recorded: true } }))
    server.on('GET', /^\/api\/print\/test-bitmap\?size=[a-z0-9]+$/, testBitmap)
    const results = (): unknown[] => server.callsTo('POST', /\/api\/print\/result$/).map((call) => call.body)
    const testSizes = (): string[] => server.callsTo('GET', /test-(bitmap|png)/).map((call) => new URL(call.path, 'http://x').searchParams.get('size') ?? '')
    return { ...made, results, testSizes }
  }

  async function begin(made: ReturnType<typeof station>): Promise<void> {
    made.queue.start()
    await flush()
    made.sources[0]!.open()
    await made.queue.connect()
    await flush(30)
  }

  it('테스트 인쇄 크기: B1에 50×20 저장 → 50×20, 목록 밖 → 프로필 기본, 프로필 모름 → 저장 크기 (D-PRN2-27)', async () => {
    const made = station(B1_PROFILE, [], [])
    let saved = '50x20'
    made.server.on('GET', /^\/api\/print\/templates$/, () => templatesWith(saved))
    made.server.on('GET', /^\/api\/print\/test-png\?size=[a-z0-9]+$/, () => ({ bytes: PNG, contentType: 'image/png' }))
    // 끊긴 동안(프로필 모름) 그림 파일은 저장된 크기 그대로
    saved = '50x40'
    expect(await made.queue.shareTest()).toBe(true)
    await begin(made)
    saved = '50x20'
    expect(await made.queue.printTest()).toBe(true)
    await flush(10)
    saved = 'tape12x40'
    expect(await made.queue.printTest()).toBe(true)
    await flush(10)
    // 저장된 크기를 읽지 못하면 프로필 기본 크기
    made.server.on('GET', /^\/api\/print\/templates$/, () => ({ status: 500, body: { error: { code: 'INTERNAL', message: '잠시 뒤' } } }))
    expect(await made.queue.printTest()).toBe(true)
    await flush(10)
    expect(made.testSizes()).toEqual(['50x40', '50x20', '50x30', '50x30'])
    made.queue.stop()
  })

  it('D110(테이프)에 50×30 저장 → 테스트는 테이프 기본 크기, 테이프 15×50 저장 → 그 크기 (D-PRN2-27)', async () => {
    const made = station(NIIMBOT_D110, [])
    let saved = '50x30'
    made.server.on('GET', /^\/api\/print\/templates$/, () => templatesWith(saved))
    await begin(made)
    expect(await made.queue.printTest()).toBe(true)
    await flush(10)
    saved = 'tape15x50'
    expect(await made.queue.printTest()).toBe(true)
    await flush(10)
    expect(made.testSizes()).toEqual(['tape12x40', 'tape15x50'])
    expect(testLabelSize(null, null)).toBe('50x30')
    made.queue.stop()
  })

  it('테스트 인쇄 중에는 작업을 받지 않고, 끝난 뒤 받는다 (D-PRN2-29)', async () => {
    const jobs: ClaimedJob[] = []
    const made = station(B1_PROFILE, jobs)
    made.server.on('GET', /^\/api\/print\/jobs\/[^/]+\/bitmap\?/, testBitmap)
    let release: () => void = () => {}
    made.server.on('GET', /^\/api\/print\/test-bitmap\?size=[a-z0-9]+$/, () => new Promise((resolve) => (release = () => resolve(testBitmap()))))
    await begin(made)
    const claimsBefore = made.server.callsTo('POST', /\/api\/print\/claim$/).length
    const test = made.queue.printTest()
    await flush(10)
    expect(made.queue.getSnapshot().testing).toBe(true)
    // 테스트 그림을 기다리는 동안 새 작업 알림이 와도 받지 않는다
    jobs.push(job('j1', '50x30'))
    await made.queue.reload()
    await flush(10)
    expect(made.server.callsTo('POST', /\/api\/print\/claim$/)).toHaveLength(claimsBefore)
    // 겹쳐 누른 테스트도 하지 않는다
    expect(await made.queue.printTest()).toBe(false)
    release()
    expect(await test).toBe(true)
    await flush(30)
    expect(made.queue.getSnapshot().testing).toBe(false)
    expect(made.results()).toEqual([{ deviceId: 'app-device-1', attempt: 'j1-a1', ok: true }])
    // 테스트 한 장 뒤 작업 한 장 (겹치지 않음)
    expect(made.ble.printed).toHaveLength(2)
    made.queue.stop()
  })

  it('범위 밖 농도는 보내지 않는다 — 프로필이 바뀌어도 고른 농도를 바꾸지 않는다 (D-PRN2-31)', async () => {
    const made = setup(B1_PROFILE)
    made.server.on('GET', /^\/api\/print\/test-bitmap\?size=[a-z0-9]+$/, testBitmap)
    made.queue.start()
    await flush()
    await made.queue.connect()
    await flush(10)
    made.queue.setDensity(5)
    expect(await made.queue.printTest()).toBe(true)
    await flush(10)
    // B1(1~5)에서 고른 5 → YXQ(1~3) 프린터: 보내지 않아 프린터 기본값으로
    made.ble.profile = MARKLIFE_S2
    made.ble.changed()
    await flush()
    expect(MARKLIFE_S2.density).toEqual({ min: 1, max: 3, default: 2 })
    expect(made.queue.getSnapshot().density).toBe(5)
    expect(await made.queue.printTest()).toBe(true)
    await flush(10)
    made.queue.setDensity(2)
    expect(await made.queue.printTest()).toBe(true)
    await flush(10)
    expect(made.ble.printed.map((entry) => entry.density)).toEqual([5, undefined, 2])
    made.queue.stop()
  })

  it('템플릿에 크기가 없으면 그림을 받지 않고 INVALID_TEMPLATE(size) (D-PRN2-34, 웹과 같다)', async () => {
    const noSize = job('j1', '50x30')
    const { size: _size, ...template } = noSize.template as unknown as Record<string, unknown>
    const made = station(B1_PROFILE, [{ ...noSize, template: template as unknown as ClaimedJob['template'] }])
    made.server.on('GET', /^\/api\/print\/jobs\/[^/]+\/bitmap\?/, testBitmap)
    await begin(made)
    expect(made.results()).toEqual([{ deviceId: 'app-device-1', attempt: 'j1-a1', ok: false, error: { code: 'INVALID_TEMPLATE', item: 'size' } }])
    expect(made.server.callsTo('GET', /\/jobs\/j1\/bitmap/)).toHaveLength(0)
    expect(made.ble.printed).toHaveLength(0)
    expect(made.queue.getSnapshot().printerError?.message).toBe('쓸 수 없는 라벨 크기예요. 라벨 크기 목록에서 다시 골라 주세요.')
    made.queue.stop()
  })

  it('받은 작업의 그림 파일을 공유 창으로 — 상태를 바꾸지 않고 결과를 보내지 않는다, 받은 작업이 없으면 하지 않는다 (D-PRN2-28)', async () => {
    const shared: Uint8Array[] = []
    const made = station(B1_PROFILE, [job('j1', '50x30')], shared)
    let release: () => void = () => {}
    made.server.on('GET', /^\/api\/print\/jobs\/[^/]+\/bitmap\?/, () => new Promise((resolve) => (release = () => resolve(testBitmap()))))
    made.server.on('GET', /^\/api\/print\/jobs\/[^/]+\/png\?/, () => ({ bytes: PNG, contentType: 'image/png' }))
    expect(await made.queue.shareJob()).toBe(false)
    await begin(made)
    expect(made.queue.getSnapshot().job?.id).toBe('j1')
    expect(await made.queue.shareJob()).toBe(true)
    expect(shared.map((png) => [...png])).toEqual([[...PNG]])
    expect(made.server.callsTo('GET', /\/jobs\/j1\/png/).map((call) => call.path)).toEqual(['/api/print/jobs/j1/png?attempt=j1-a1&device=app-device-1'])
    // 보내도 출력함이 아니다: 결과 없음, 작업은 그대로
    expect(made.results()).toEqual([])
    expect(made.queue.getSnapshot().job?.id).toBe('j1')
    expect(made.queue.getSnapshot().printed).toBe(0)
    release()
    await flush(30)
    expect(made.results()).toEqual([{ deviceId: 'app-device-1', attempt: 'j1-a1', ok: true }])
    expect(await made.queue.shareJob()).toBe(false)
    made.queue.stop()
  })

  it('화면: 이 기기가 받은 작업이 있을 때만 "제조사 앱으로 보내기"(작업) 단추 — 눌러도 결과를 보내지 않는다 (D-PRN2-28)', async () => {
    const world = makeWorld()
    const shared: Uint8Array[] = []
    const jobs = [job('j1', '50x30')]
    const queue = new LabelQueue({ ble: world.ble, deviceId: 'app-test', openStream: () => new FakeEventSource('/api/stream'), timer: new FakeClock(), share: async (png) => void shared.push(png) })
    world.server.on('GET', /^\/api\/print$/, () => ({ body: { queue: { ...summary({ waiting: jobs.length }), device: { id: 'app-test', name: '내 휴대폰', live: true, printerConnected: true, releasing: false } }, jobs: [], discard: [] } }))
    world.server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
    world.server.on('POST', /^\/api\/print\/claim$/, () => ({ body: { job: jobs.shift() ?? null, reason: 'EMPTY' } }))
    world.server.on('POST', /^\/api\/print\/result$/, () => ({ body: { recorded: true } }))
    let release: () => void = () => {}
    world.server.on('GET', /^\/api\/print\/jobs\/[^/]+\/bitmap\?/, () => new Promise((resolve) => (release = () => resolve(testBitmap()))))
    world.server.on('GET', /^\/api\/print\/jobs\/[^/]+\/png\?/, () => ({ bytes: PNG, contentType: 'image/png' }))
    queue.start()
    render(<ServicesProvider services={{ ...world.services, labels: queue }}><LabelsScreen onBack={() => {}} /></ServicesProvider>)
    await waitFor(() => expect(screen.getByText('이 기기가 출력 기기예요 · 내 휴대폰')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^이 라벨/ })).toBeNull()
    // 받은 작업이 없으면 테스트 라벨 보내기만 — 보이는 글이 무엇을·어디로 (UX-PRN2-007, 끊겨 있으면 앱 이름을 모른다)
    expect(screen.getByRole('button', { name: '테스트 라벨을 제조사 앱으로 보내기' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '블루투스로 연결' }))
    // 작업 단추는 그 라벨 번호와 이은 프린터의 제조사 앱 (이 가짜 프린터는 프로필을 몰라 "제조사 앱")
    const send = await screen.findByRole('button', { name: '이 라벨(15번)을 제조사 앱으로 보내기' })
    // 이어져 잘 찍는 동안은 테스트 라벨 보내기가 없어 두 단추를 헷갈리지 않는다
    expect(screen.queryByRole('button', { name: /^테스트 라벨을/ })).toBeNull()
    expect(screen.getByText('잘 안 찍히면 이 라벨 그림을 제조사 앱으로 보내 인쇄할 수 있어요. 보내도 출력한 것으로 치지 않아요.')).toBeTruthy()
    fireEvent.click(send)
    await waitFor(() => expect(shared).toHaveLength(1))
    expect(world.server.callsTo('POST', /\/api\/print\/result$/)).toHaveLength(0)
    release()
    await waitFor(() => expect(world.server.callsTo('POST', /\/api\/print\/result$/)).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^이 라벨/ })).toBeNull())
    queue.stop()
  })
})
