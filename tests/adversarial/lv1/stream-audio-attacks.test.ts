// LV1 방송 소리로 듣기 적대 시험 (test-domain). 기준: harness/sprints/LV1/acceptance.md, D-LV1-03~10.
import { once } from 'node:events'
import type { Server } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createNodeServer } from '../../../apps/server/src/node-server.ts'
import { createBackupBytes } from '../../../apps/server/src/backup.ts'
import { generateMasterKey } from '../../../apps/server/src/secrets.ts'
import { startMockWorker } from '../../../apps/server/src/voice/mock-worker.ts'
import { FakeBroadcastAudio, PRACTICE_SPEECH, ffmpegAvailable, readStreamAudioSwitch, recordFailure, retryDelayMs, type AudioSink, type StreamLocation } from '../../../apps/server/src/voice/stream-audio.ts'
import { StreamAudioService } from '../../../apps/server/src/voice/stream-service.ts'
import type { LogRecord } from '../../../apps/server/src/log.ts'
import type { VoiceRelay } from '../../../apps/server/src/voice/relay.ts'
import { addSeller, client, createBroadcast, dumpAllTables, newWorld, openTestDb, ORIGIN, startServer, waitFor, type TestServer } from '../../../apps/server/test/support.ts'

// ── 서비스 단독 공격용 가짜들 ─────────────────────────────

class Feed {
  readonly sinks: { url: string; sink: AudioSink; closed: boolean }[] = []
  open(url: string, sink: AudioSink) { const f = { url, sink, closed: false }; this.sinks.push(f); return { close: () => { f.closed = true } } }
  live() { return this.sinks.filter((f) => !f.closed) }
  last() { return this.sinks[this.sinks.length - 1]! }
}
class Timers {
  jobs: { run: () => void; ms: number; live: boolean }[] = []
  schedule = (run: () => void, ms: number) => { const j = { run, ms, live: true }; this.jobs.push(j); return () => { j.live = false } }
  retries(): number[] { const due = this.jobs.filter((j) => j.live && j.ms !== 5_000); for (const j of due) { j.live = false; j.run() } return due.map((j) => j.ms) }
}
type Delivered = { seller: string; b: string; text: string; startAt: number; endAt: number }
class Relay {
  mic = new Set<string>()
  consoles = new Set<string>() // `${seller}/${b}`
  delivered: Delivered[] = []
  opened: { seller: string | null; onResult: (r: { text: string; startMs: number; endMs: number }) => void; onLost: () => void; sent: Buffer[]; closed: boolean }[] = []
  micActive(seller: string) { return this.mic.has(seller) }
  openExternal(onResult: (r: { text: string; startMs: number; endMs: number }) => void, onLost: () => void) {
    const s = { seller: null, onResult, onLost, sent: [] as Buffer[], closed: false }
    this.opened.push(s)
    return { send: (pcm: Buffer) => { if (s.closed) return false; s.sent.push(pcm); return true }, close: () => { s.closed = true } }
  }
  deliver(seller: string, b: string, r: { text: string; startAt: number; endAt: number }) {
    if (!this.consoles.has(`${seller}/${b}`)) return false
    this.delivered.push({ seller, b, ...r }); return true
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0))
function rig(o: { available?: boolean; on?: boolean; locate?: (s: string, b: string) => StreamLocation } = {}) {
  let t = 1_800_000_000_000
  const clock = { now: () => t }
  const feed = new Feed(); const timers = new Timers(); const relay = new Relay(); const logs: LogRecord[] = []
  const svc = new StreamAudioService({
    available: o.available ?? true,
    locate: async (s, b) => (o.locate ?? (() => ({ kind: 'ok', url: `https://manifest.googlevideo.com/${s}/${b}.m3u8` })))(s, b),
    feed, clock, log: (r) => logs.push(r), sellerOn: async () => o.on ?? true, schedule: timers.schedule,
  })
  svc.attach(relay as unknown as VoiceRelay)
  return { svc, feed, timers, relay, logs, clock, advance: (ms: number) => { t += ms }, at: () => t }
}
const pcm = (n = 0) => Buffer.alloc(3_200, n)

describe('TD-LV1 등록 시각 (AC-LV1-03, D-LV1-04)', () => {
  it('일꾼이 실시간보다 앞선 말 끝(endMs)을 돌려줘도 endAt·startAt은 지금을 넘지 않고 start ≤ end', async () => {
    const r = rig(); r.relay.consoles.add('s1/b1')
    await r.svc.watch('s1', 'b1'); await flush()
    r.feed.last().sink.chunk(pcm(), r.at())
    r.advance(500)
    r.relay.opened[0]!.onResult({ text: '15번', startMs: 9_000, endMs: 60_000 })
    const d = r.relay.delivered[0]!
    expect(d.endAt).toBeLessThanOrEqual(r.at())
    expect(d.startAt).toBeLessThanOrEqual(d.endAt)
  })
  it('다시 이은 뒤 옛 흐름의 늦은 결과는 버린다(시각 기준이 다른 흐름)', async () => {
    const r = rig(); r.relay.consoles.add('s1/b1')
    await r.svc.watch('s1', 'b1'); await flush()
    r.feed.last().sink.chunk(pcm(), r.at())
    const old = r.relay.opened[0]!
    r.feed.last().sink.fail()
    r.advance(1_000); r.timers.retries(); await flush()
    r.feed.last().sink.chunk(pcm(), r.at())
    old.onResult({ text: '옛 말', startMs: 0, endMs: 100 })
    expect(r.relay.delivered).toEqual([])
  })
  it('끊긴 동안 들어온 조각은 일꾼에 가지 않는다(따라잡지 않음)', async () => {
    const r = rig()
    await r.svc.watch('s1', 'b1'); await flush()
    const sink = r.feed.last().sink
    sink.chunk(pcm(1), r.at())
    sink.fail()
    sink.chunk(pcm(2), r.at())
    expect(r.relay.opened.flatMap((s) => s.sent).map((b) => b[0])).toEqual([1])
  })
})

describe('TD-LV1 늦음 30초 경계 (AC-LV1-06·13, D-LV1-10)', () => {
  for (const [lag, late] of [[29_000, false], [30_000, false], [30_001, true]] as const) {
    it(`${lag}ms 늦음 → late ${late}`, async () => {
      const r = rig()
      await r.svc.watch('s1', 'b1'); await flush()
      r.feed.last().sink.chunk(pcm(), r.at() - lag)
      expect(r.svc.view('s1', 'b1')).toEqual({ phase: 'listening', lagMs: lag, late })
    })
  }
  it('방송 시각이 서버보다 앞서도(시계 어긋남) 늦음은 음수가 아니다', async () => {
    const r = rig()
    await r.svc.watch('s1', 'b1'); await flush()
    r.feed.last().sink.chunk(pcm(), r.at() + 5_000)
    expect(r.svc.view('s1', 'b1')).toEqual({ phase: 'listening', lagMs: 0, late: false })
  })
})

describe('TD-LV1 끊김 다시 잇기 (AC-LV1-05, D-LV1-05)', () => {
  it('1·2·4·8·8초 뒤 다시, 60초 안 여섯 번째에 멈춤, 멈춘 뒤 타이머 없음', async () => {
    const r = rig()
    await r.svc.watch('s1', 'b1'); await flush()
    const delays: number[] = []
    for (let i = 0; i < 5; i++) {
      r.feed.last().sink.fail()
      expect(r.svc.view('s1', 'b1').phase).toBe('reconnecting')
      r.advance(retryDelayMs(i + 1)); delays.push(...r.timers.retries()); await flush()
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 8_000])
    r.feed.last().sink.fail()
    expect(r.svc.view('s1', 'b1').phase).toBe('stopped')
    expect(r.timers.retries()).toEqual([])
    expect(r.feed.live()).toEqual([])
    // 멈춘 뒤 콘솔 열림 신호가 계속 와도 멈춤 그대로(다시 켜기만)
    await r.svc.watch('s1', 'b1'); await flush()
    expect(r.svc.view('s1', 'b1').phase).toBe('stopped')
  })
  it('같은 실패를 두 번 알려도(fail 중복) 한 번으로 센다', async () => {
    const r = rig()
    await r.svc.watch('s1', 'b1'); await flush()
    for (let i = 0; i < 3; i++) { const s = r.feed.last().sink; s.fail(); s.fail(); s.fail(); r.timers.retries(); await flush() }
    expect(r.svc.view('s1', 'b1').phase).not.toBe('stopped')
  })
  it('59.999초 안 여섯 번째는 멈춤, 12초 간격 여섯 번(첫 끊김이 정확히 60초 전)은 멈추지 않음', () => {
    const a: number[] = []
    for (const s of [0, 1, 2, 3, 4]) recordFailure(a, s * 1_000)
    expect(recordFailure(a, 59_999).stop).toBe(true)
    const b: number[] = []
    for (const s of [0, 12, 24, 36, 48]) recordFailure(b, s * 1_000)
    expect(recordFailure(b, 60_000).stop).toBe(false)
  })
  it('일꾼을 잃어도 끊김으로 세고 다시 잇는다', async () => {
    const r = rig()
    await r.svc.watch('s1', 'b1'); await flush()
    r.feed.last().sink.chunk(pcm(), r.at())
    r.relay.opened[0]!.onLost()
    expect(r.svc.view('s1', 'b1').phase).toBe('reconnecting')
    expect(r.timers.retries()).toEqual([1_000])
  })
})

describe('TD-LV1 흐름 하나 — 마이크 우선·되돌아옴 (AC-LV1-07, D-LV1-06)', () => {
  it('마이크 켜면 소리 받기·일꾼 흐름 모두 닫히고, 끄면 다시 하나만 열린다', async () => {
    const r = rig()
    await r.svc.watch('s1', 'b1'); await flush()
    r.feed.last().sink.chunk(pcm(), r.at())
    r.relay.mic.add('s1'); r.svc.micChanged('s1', true)
    expect(r.feed.live()).toEqual([])
    expect(r.relay.opened.every((s) => s.closed)).toBe(true)
    expect(r.svc.view('s1', 'b1').phase).toBe('mic')
    // 마이크 켜진 동안 콘솔 신호·쓸기가 와도 열지 않는다
    await r.svc.watch('s1', 'b1'); await flush(); r.timers.retries(); await flush()
    expect(r.feed.live()).toEqual([])
    r.relay.mic.delete('s1'); r.svc.micChanged('s1', false); await flush()
    await r.svc.watch('s1', 'b1'); await flush()
    expect(r.feed.live().length).toBe(1)
    r.feed.last().sink.chunk(pcm(), r.at())
    expect(r.svc.view('s1', 'b1').phase).toBe('listening')
  })
  it('주소 찾는 중에 마이크가 켜지면 소리 받기를 열지 않는다', async () => {
    let release!: () => void
    const gate = new Promise<void>((res) => { release = res })
    let t = 0
    const feed = new Feed(); const relay = new Relay()
    const svc = new StreamAudioService({ available: true, feed, clock: { now: () => t }, log: () => {}, sellerOn: async () => true, schedule: new Timers().schedule,
      locate: async () => { await gate; return { kind: 'ok', url: 'https://manifest.googlevideo.com/a' } } })
    svc.attach(relay as unknown as VoiceRelay)
    await svc.watch('s1', 'b1')
    relay.mic.add('s1'); svc.micChanged('s1', true)
    release(); await flush(); await flush()
    expect(feed.live()).toEqual([])
    t++
  })
  it('같은 판매자가 다른 방송 콘솔을 함께 열어도 소리 흐름은 하나', async () => {
    const r = rig()
    await r.svc.watch('s1', 'b1'); await flush()
    await r.svc.watch('s1', 'b2'); await flush()
    expect(r.feed.live().length).toBe(1)
  })
  it('콘솔 신호가 마이크 켜짐과 엇갈려 여러 번 와도 소리 받기 흐름은 겹치지 않는다', async () => {
    const r = rig()
    await Promise.all([r.svc.watch('s1', 'b1'), r.svc.watch('s1', 'b1'), r.svc.watch('s1', 'b1')]); await flush()
    r.svc.micChanged('s1', false); r.svc.micChanged('s1', false); await flush()
    expect(r.feed.live().length).toBe(1)
  })
})

describe('TD-LV1 콘솔 없으면 버림 (AC-LV1-10, D-LV1-03)', () => {
  it('콘솔 열림 신호가 없으면 아무것도 열지 않는다', async () => {
    const r = rig()
    r.timers.jobs.filter((j) => j.ms === 5_000).forEach((j) => j.run()); await flush()
    expect(r.feed.sinks).toEqual([])
  })
  it('넘길 콘솔이 없으면 글을 버리고, 로그에는 까닭 코드만(글 없음)', async () => {
    const r = rig()
    await r.svc.watch('s1', 'b1'); await flush()
    r.feed.last().sink.chunk(pcm(), r.at())
    r.relay.opened[0]!.onResult({ text: '십오번 이만원', startMs: 0, endMs: 100 })
    r.relay.opened[0]!.onResult({ text: '십오번 이만원', startMs: 0, endMs: 100 })
    expect(r.relay.delivered).toEqual([])
    expect(JSON.stringify(r.logs)).not.toContain('십오번')
    expect(r.logs.filter((l) => l.code === 'STREAM_AUDIO_NO_CONSOLE').length).toBe(1)
  })
  it('콘솔 신호가 25초 넘게 끊기면 쓸기에서 흐름을 닫는다', async () => {
    const r = rig()
    await r.svc.watch('s1', 'b1'); await flush()
    r.advance(25_000); r.svc.sweep()
    expect(r.feed.live()).toEqual([])
    expect(r.svc.status().listening).toBe(0)
  })
  it('판매자 설정 끔이면 열려 있던 흐름도 닫힌다', async () => {
    let on = true
    const feed = new Feed()
    const svc = new StreamAudioService({ available: true, feed, clock: { now: () => 0 }, log: () => {}, sellerOn: async () => on, schedule: new Timers().schedule, locate: async () => ({ kind: 'ok', url: 'https://manifest.googlevideo.com/a' }) })
    svc.attach(new Relay() as unknown as VoiceRelay)
    await svc.watch('s1', 'b1'); await flush()
    on = false
    expect(await svc.watch('s1', 'b1')).toEqual({ phase: 'off' })
    expect(feed.live()).toEqual([])
  })
})

describe('TD-LV1 판매자 사이 섞임 없음', () => {
  it('두 판매자가 동시에 들을 때 각자 자기 방송 주소·자기 콘솔로만 간다', async () => {
    const r = rig(); r.relay.consoles.add('A/bA'); r.relay.consoles.add('B/bB')
    await r.svc.watch('A', 'bA'); await r.svc.watch('B', 'bB'); await flush()
    expect(r.feed.sinks.map((f) => f.url)).toEqual(['https://manifest.googlevideo.com/A/bA.m3u8', 'https://manifest.googlevideo.com/B/bB.m3u8'])
    r.feed.sinks[0]!.sink.chunk(pcm(), r.at()); r.feed.sinks[1]!.sink.chunk(pcm(), r.at())
    r.relay.opened[1]!.onResult({ text: 'B 말', startMs: 0, endMs: 100 })
    r.relay.opened[0]!.onResult({ text: 'A 말', startMs: 0, endMs: 100 })
    expect(r.relay.delivered.map((d) => `${d.seller}/${d.b}/${d.text}`)).toEqual(['B/bB/B 말', 'A/bA/A 말'])
    // A가 마이크를 켜도 B는 그대로
    r.relay.mic.add('A'); r.svc.micChanged('A', true)
    expect(r.svc.view('B', 'bB').phase).toBe('listening')
    r.svc.endBroadcast('A', 'bB')
    expect(r.svc.view('B', 'bB').phase).toBe('listening')
  })
  it('다른 판매자 방송 번호로 watch·restart하면 404, 소리를 열지 않는다', async () => {
    let opened = 0
    const world = await newWorld({ streamAudio: { on: true, feed: { open: () => { opened++; return { close: () => {} } } }, locate: async () => ({ kind: 'ok', url: 'https://manifest.googlevideo.com/x' }) } })
    try {
      const a = await addSeller(world); const b = await addSeller(world)
      const bA = await createBroadcast(world, a)
      expect((await client(world, b.cookie).post(`/api/broadcasts/${bA.id}/stream-audio/watch`, {})).status).toBe(404)
      expect((await client(world, b.cookie).post(`/api/broadcasts/${bA.id}/stream-audio/restart`, {})).status).toBe(404)
      await flush()
      expect(opened).toBe(0)
    } finally { world.server.close(); await world.database.close() }
  })
})

describe('TD-LV1 끄기 (AC-LV1-09, D-LV1-08)', () => {
  it('스위치 off 변형', () => {
    for (const v of ['off', 'OFF', ' Off\n', '\toff ']) expect(readStreamAudioSwitch({ LIVEJJIM_STREAM_AUDIO: v })).toBe(false)
    for (const v of [undefined, '', 'on', '1']) expect(readStreamAudioSwitch({ LIVEJJIM_STREAM_AUDIO: v })).toBe(true)
  })
  it('쓸 수 없는 서버면 watch·restart·view 모두 hidden, 아무것도 열지 않는다', async () => {
    const r = rig({ available: false })
    expect(await r.svc.watch('s1', 'b1')).toEqual({ phase: 'hidden' })
    expect(await r.svc.restart('s1', 'b1')).toEqual({ phase: 'hidden' })
    expect(r.feed.sinks).toEqual([])
    expect(r.timers.jobs).toEqual([])
  })
  it('ffmpeg가 없으면 설정 칸 없음(available false)·hidden', async () => {
    expect(ffmpegAvailable('livejjim-no-such-ffmpeg-binary')).toBe(false)
    const path = process.env['PATH']
    process.env['PATH'] = '/nonexistent-livejjim'
    let world: TestServer
    try { world = await newWorld({ streamAudio: { on: true } }) } finally { process.env['PATH'] = path }
    try {
      const s = await addSeller(world); const b = await createBroadcast(world, s)
      expect(((await client(world, s.cookie).get('/api/settings/stream-audio')).body as { available: boolean }).available).toBe(false)
      expect((await client(world, s.cookie).post(`/api/broadcasts/${b.id}/stream-audio/watch`, {})).body).toEqual({ phase: 'hidden' })
      expect(world.logs.some((l) => l.code === 'STREAM_AUDIO_NO_FFMPEG')).toBe(true)
    } finally { world.server.close(); await world.database.close() }
  })
})

// ── 소리·받아쓴 글이 로그·DB·백업에 없음 (AC-LV1-04) ────────────────
const TOKEN = 'test-worker-token-lv1-adversarial'
const servers: Server[] = []; const sockets: WebSocket[] = []; const cleanups: (() => void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) c()
  for (const s of sockets.splice(0)) s.terminate()
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((res) => s.close(() => res()))))
})

describe('TD-LV1 개인정보: 소리·글이 남지 않음', () => {
  it('연습 흐름으로 등록까지 간 뒤에도 받아쓴 글 전체가 음성 인식 기록 밖의 DB·로그·백업 어디에도 없다', async () => {
    const database = await openTestDb()
    const fake = new FakeBroadcastAudio(database.db)
    const live = startServer(database, generateMasterKey(), { transcribeWorkerToken: TOKEN, streamAudio: { on: true, feed: fake, locate: async () => ({ kind: 'ok', url: 'fake:live' }) } })
    cleanups.push(() => { fake.control('cut') })
    try {
      const server = createNodeServer({ app: live.server.app }); servers.push(server)
      server.listen(0, '127.0.0.1'); await once(server, 'listening')
      const addr = server.address(); if (addr === null || typeof addr === 'string') throw new Error('주소 없음')
      const url = `ws://127.0.0.1:${addr.port}`
      const w = startMockWorker({ url: `${url}/api/voice/worker`, token: TOKEN }); cleanups.push(() => w.close())
      await waitFor(() => live.server.voice.status().workers === 1)
      const seller = await addSeller(live); const b = await createBroadcast(live, seller)
      const ws = new WebSocket(`${url}/api/voice/stream?broadcastId=${b.id}&device=consolepc01&capture=false`, { headers: { Origin: ORIGIN, Cookie: seller.cookie } })
      sockets.push(ws); ws.on('error', () => {})
      const msgs: Record<string, unknown>[] = []
      ws.on('message', (d, bin) => { if (!bin) msgs.push(JSON.parse(String(d))) })
      await waitFor(() => msgs.some((m) => m.type === 'ready'))
      ws.send(JSON.stringify({ type: 'voice.session', op: 'hello', context: { now: live.clock.now(), dialogOpen: false, smsAutoAllowed: true, consent: true } }))
      await client(live, seller.cookie).post(`/api/broadcasts/${b.id}/stream-audio/watch`, {})
      await waitFor(() => msgs.some((m) => m.type === 'voice.effect' && m.method === 'register'), 10_000)
      await new Promise((res) => setTimeout(res, 300))
      const variants = [PRACTICE_SPEECH, PRACTICE_SPEECH.replace(/ /g, ''), '이만 원']
      // D-UX4-156 (사용자 "음성인식은 … 채팅처럼 다 저장해두는 거 아니야? 보이게 해줘"): 받아쓴 글은 그 판매자의 음성 인식 기록(voice_heard)에만 남긴다 —
      // 그 밖의 DB·로그·백업 파일에는 여전히 없다 (옛 기대: DB 어디에도 없다)
      await live.server.heard.settled()
      expect(await dumpAllTables(live.database)).toContain(PRACTICE_SPEECH)
      const tables = await dumpAllTables(live.database, ['voice_heard'])
      const logs = JSON.stringify(live.logs)
      let backup = Buffer.from(await createBackupBytes(live.database.db, seller.sellerId, live.clock.now()))
      if (backup[0] === 0x1f && backup[1] === 0x8b) backup = gunzipSync(backup)
      const text = backup.toString('utf8')
      for (const v of variants) {
        expect(tables, `DB: ${v}`).not.toContain(v)
        expect(logs, `로그: ${v}`).not.toContain(v)
        expect(text, `백업: ${v}`).not.toContain(v)
      }
      expect(logs).not.toContain('googlevideo')
    } finally { live.server.close(); await live.database.close() }
  }, 20_000)
})

describe('TD-LV1 마이크를 껐다 켠 뒤 방송 소리 글이 다시 콘솔로 감 (AC-LV1-07)', () => {
  it('TD-LV1-001: 콘솔이 열린 채 휴대폰 마이크 켬→끔 뒤 방송 소리 "15번 핑크프릴 이만 원"이 그 콘솔에 다시 온다', async () => {
    const database = await openTestDb()
    const fake = new FakeBroadcastAudio(database.db)
    const live = startServer(database, generateMasterKey(), { transcribeWorkerToken: TOKEN, streamAudio: { on: true, feed: fake, locate: async () => ({ kind: 'ok', url: 'fake:live' }) } })
    cleanups.push(() => { fake.control('cut') })
    try {
      const server = createNodeServer({ app: live.server.app }); servers.push(server)
      server.listen(0, '127.0.0.1'); await once(server, 'listening')
      const addr = server.address(); if (addr === null || typeof addr === 'string') throw new Error('주소 없음')
      const url = `ws://127.0.0.1:${addr.port}`
      const w = startMockWorker({ url: `${url}/api/voice/worker`, token: TOKEN }); cleanups.push(() => w.close())
      await waitFor(() => live.server.voice.status().workers === 1)
      const seller = await addSeller(live); const b = await createBroadcast(live, seller)
      const open = (dev: string, capture: boolean) => {
        const ws = new WebSocket(`${url}/api/voice/stream?broadcastId=${b.id}&device=${dev}${capture ? '' : '&capture=false'}`, { headers: { Origin: ORIGIN, Cookie: seller.cookie } })
        sockets.push(ws); ws.on('error', () => {})
        const msgs: Record<string, unknown>[] = []
        ws.on('message', (d, bin) => { if (!bin) msgs.push(JSON.parse(String(d))) })
        return { ws, msgs }
      }
      const c = open('consolepc01', false)
      await waitFor(() => c.msgs.some((m) => m.type === 'ready'))
      c.ws.send(JSON.stringify({ type: 'voice.session', op: 'hello', context: { now: live.clock.now(), dialogOpen: false, smsAutoAllowed: true, consent: true } }))
      await client(live, seller.cookie).post(`/api/broadcasts/${b.id}/stream-audio/watch`, {})
      await waitFor(() => c.msgs.some((m) => m.type === 'result'), 10_000)
      const mic = open('phonemic01', true)
      await waitFor(async () => ((await client(live, seller.cookie).get(`/api/broadcasts/${b.id}/stream-audio`)).body as { phase: string }).phase === 'mic', 8_000)
        .catch(() => { throw new Error(`TD-LV1-001 콘솔 조작 흐름이 열려 있으면 휴대폰 마이크가 못 들어온다: 마이크가 받은 것 ${JSON.stringify(mic.msgs)}`) })
      mic.ws.close()
      await waitFor(async () => ((await client(live, seller.cookie).get(`/api/broadcasts/${b.id}/stream-audio`)).body as { phase: string }).phase === 'listening', 8_000)
      c.msgs.length = 0
      fake.control('say')
      await waitFor(() => c.msgs.some((m) => m.type === "result" && m.text === PRACTICE_SPEECH), 8_000).catch(() => { throw new Error(`콘솔 상태 ${c.ws.readyState}, 받은 것 ${JSON.stringify(c.msgs).slice(0, 400)}`) })
    } finally { live.server.close(); await live.database.close() }
  }, 30_000)
})
