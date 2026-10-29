// 화면 시험 도우미: 가짜 서버·가짜 실시간 연결·가짜 네이티브 모듈로 만든 앱 서비스 묶음과 Provider.
import type { ReactNode } from 'react'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import { LiveStream } from '../src/lib/live.ts'
import { FakeNativeAudio } from '../src/native/audio.ts'
import { FakeBlePrinter } from '../src/native/ble.ts'
import { createServices, ServicesProvider, type Services } from '../src/services.tsx'
import { BROADCAST, FakeEventSource, FakeServer, fullView, type Call } from './support.ts'

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
    wrap: (children) => <ServicesProvider services={services}>{children}</ServicesProvider>,
    seq: 5,
    events: [],
  }
  const broadcast = { ...BROADCAST, rehearsal: options.rehearsal === true }
  server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcast] } }))
  server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=true)?$/, () => ({ body: fullView({ seq: world.seq, rehearsal: broadcast.rehearsal, products: options.products ?? [] }) }))
  server.on('GET', /^\/api\/print$/, () => ({ body: { queue: { rev: 1, device: null, pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled: true }, jobs: [], discard: [] } }))
  server.on('GET', /^\/api\/print\/labels/, () => ({ body: { date: '2026-10-29', labels: [] } }))
  server.on('POST', /^\/api\/events/, (call) => {
    if (typeof call.body?.b === 'string' && /[?&](date|rehearsal)=/.test(call.path)) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: '방송이 있는 입력에는 범위를 따로 적지 않아요.' } } }
    world.events.push(call)
    world.seq += 1
    const result: WriteResult = { date: '2026-10-29', rehearsal: broadcast.rehearsal, seq: world.seq, type: String(call.body?.type), changed: true, effects: [] }
    return { body: result }
  })
  return world
}
