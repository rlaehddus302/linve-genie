// 화면 시험 도우미: 가짜 서버·가짜 실시간 연결·가짜 네이티브 모듈로 만든 앱 서비스 묶음과 Provider.
import { fireEvent, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import { LiveStream } from '../src/lib/live.ts'
import { FakeNativeAudio } from '../src/native/audio.ts'
import { FakeBlePrinter } from '../src/native/ble.ts'
import { createServices, ServicesProvider, type Services } from '../src/services.tsx'
import { KeptStreamAudio } from '../src/screens/console/StreamAudio.tsx'
import { quickErrorMessage } from '../../../packages/voice-session/src/read/quick.ts'
import { READ_KINDS, readText, type ReadKind } from '../../../packages/voice-session/src/read/index.ts'
import { BROADCAST, FakeEventSource, FakeServer, SETTINGS, fullView, type Call } from './support.ts'

export interface ScreenWorld {
  readonly server: FakeServer
  readonly sources: FakeEventSource[]
  readonly audio: FakeNativeAudio
  readonly ble: FakeBlePrinter
  readonly services: Services
  /** 가장 최근 실시간 연결 */
  readonly source: () => FakeEventSource
  readonly wrap: (children: ReactNode) => ReactNode
  /** 범위 seq (쓰기마다 는다) */
  seq: number
  readonly events: Call[]
  /** 서버 읽기 입구로 온 요청 (SRV1) */
  readonly reads: Call[]
}

/** 방송 하나·범위 하나·쓰기(/api/events)·출력 요약이 있는 세상 */
export function makeWorld(options: { readonly products?: ReturnType<typeof fullView>['products']; readonly rehearsal?: boolean } = {}): ScreenWorld {
  const server = new FakeServer()
  server.install()
  const sources: FakeEventSource[] = []
  const stream = new LiveStream({
    url: () => 'http://test.local/api/stream?device=app-test',
    create: (url) => {
      const source = new FakeEventSource(url)
      sources.push(source)
      return source
    },
  })
  const audio = new FakeNativeAudio()
  const ble = new FakeBlePrinter()
  const services = createServices({ audio, ble, deviceId: 'app-test', stream })
  const world: ScreenWorld = {
    server,
    sources,
    audio,
    ble,
    services,
    source: () => sources[sources.length - 1]!,
    // 앱 뿌리처럼 방송 소리 붙잡기(D-UX3-48)를 함께 둔다
    wrap: (children) => <ServicesProvider services={services}><KeptStreamAudio session={services.voice} keep={services.streamKeep} signedIn />{children}</ServicesProvider>,
    seq: 5,
    events: [],
    reads: [],
  }
  const broadcast = { ...BROADCAST, rehearsal: options.rehearsal === true }
  server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcast] } }))
  server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=true)?$/, () => ({ body: fullView({ seq: world.seq, rehearsal: broadcast.rehearsal, products: options.products ?? [] }) }))
  server.on('GET', /^\/api\/print$/, () => ({ body: { queue: { rev: 1, device: null, pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled: true }, jobs: [], discard: [] } }))
  server.on('GET', /^\/api\/print\/labels/, () => ({ body: { date: '2026-10-29', labels: [] } }))
  // 서버 읽기 입구 (SRV1 약속 1): 서버와 같은 읽기 함수(packages/voice-session/src/read)로 그 방송 설정·상품을 읽어 { read }로 답한다 — 앱은 읽지 않는다
  server.on('POST', /^\/api\/broadcasts\/b1\/read$/, (call) => {
    world.reads.push(call)
    const kind = call.body?.kind
    if (typeof kind !== 'string' || !(READ_KINDS as readonly string[]).includes(kind)) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.' } } }
    const products = options.products ?? []
    const read = readText(kind as ReadKind, call.body?.text as string, {
      settings: { 'price.unit': SETTINGS['price.unit'], 'claim.maxNumber': SETTINGS['claim.maxNumber'] },
      findProduct: (no) => {
        const found = products.find((item) => item.no === no)
        return found === undefined ? undefined : { id: found.id, no: found.no, name: found.name, price: found.price, closed: found.status === 'CLOSED' }
      },
      now: Date.now(),
    })
    return { body: { read } }
  })
  server.on('POST', /^\/api\/events/, (call) => {
    if (typeof call.body?.b === 'string' && /[?&](date|rehearsal)=/.test(call.path)) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: '방송이 있는 입력에는 범위를 따로 적지 않아요.' } } }
    // 서버 문자찜 입구 (SRV1 D-APP-24): 번호 칸 원문을 그 방송 번호 한도로 읽고, 숫자가 아니거나 한도 밖이면 문장으로 거절한다 — 이벤트는 쓰지 않는다
    if (call.body?.type === 'sms' && typeof call.body.noText === 'string') {
      const typed = call.body.noText.trim()
      const number = Number(typed)
      const max = SETTINGS['claim.maxNumber']
      if (!/^\d+$/.test(typed) || !Number.isInteger(number) || number < 1) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: '상품 번호를 숫자로 적어 주세요.' } } }
      if (number > max) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: quickErrorMessage('NUMBER_INVALID', max) } } }
    }
    world.events.push(call)
    world.seq += 1
    const result: WriteResult = { date: '2026-10-29', rehearsal: broadcast.rehearsal, seq: world.seq, type: String(call.body?.type), changed: true, effects: [] }
    return { body: result }
  })
  return world
}

/**
 * 라이브 화면 찾기 칸 (D-UX4-201, 사용자 "검색창을 오른쪽 위에 검색 아이콘으로"): 칸은 머리 오른쪽 돋보기를 눌러야 나온다 —
 * 이미 보이면(찾는 글이 남았거나 도구 줄을 따로 그린 화면) 그 칸을 돌려준다. 상품 탭에서 누르면 숫자판도 열린다
 */
export function openSearchField(label: string): HTMLElement {
  const shown = screen.queryByLabelText(label)
  if (shown !== null) return shown
  fireEvent.click(screen.getByTestId('console-search'))
  return screen.getByLabelText(label)
}
