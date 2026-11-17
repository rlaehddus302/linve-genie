// D-SHARE-LIVE-01 같이 보는 라이브 — 앱 쪽 (사용자 지시 2026-11-17):
// ① 다른 계정이 이어 둔 라이브를 이으면 서버가 { joined }로 답한다 — 앱 뿌리가 그 방송으로 옮기고 잇는 화면은 오류 없이 멈춘다(JoinedLive).
// ② 마이크는 먼저 켠 기기 하나만: 다른 기기가 쥐고 있으면 이 기기는 빨간 멈춤 없이 조용히 끄고, [휴대폰 마이크 켜기]도 보이지 않는다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from '../src/api/config.ts'
import { listenNow } from '../src/lib/listen-source.ts'
import { VoiceSession } from '../src/lib/voice-session.ts'
import { VOICE_OTHER_DEVICE } from '../src/lib/words.ts'
import { FakeNativeAudio } from '../src/native/audio.ts'
import { cacheKeyOf } from '../src/services.tsx'
import { JoinedLive, sendLiveLink, setJoinedLiveHandler } from '../src/screens/console/YoutubeSection.tsx'
import { FakeClock, flush } from './support.ts'

function server(answer: unknown): void {
  configureApi({
    baseUrl: 'https://livegenie.test',
    fetch: async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  })
}

afterEach(() => setJoinedLiveHandler(null))

describe('D-SHARE-LIVE-01 같이 보는 라이브에 들어가기', () => {
  it('유튜브·틱톡 잇기 답이 joined면 앱 뿌리에 알리고 JoinedLive를 던진다', async () => {
    const handler = vi.fn(async () => {})
    setJoinedLiveHandler(handler)
    server({ joined: { broadcastId: 'b_owner', shopName: '비트다육' } })
    await expect(sendLiveLink('b_mine', { platform: 'youtube', body: { requestId: 'r1', video: 'https://youtu.be/abcdefghijk' } })).rejects.toBeInstanceOf(JoinedLive)
    await expect(sendLiveLink('b_mine', { platform: 'tiktok', body: { requestId: 'r2', url: 'https://www.tiktok.com/@shop/live' } })).rejects.toBeInstanceOf(JoinedLive)
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledWith({ broadcastId: 'b_owner', shopName: '비트다육' })
  })

  it('보통 잇기 답이면 그대로 돌려준다', async () => {
    const handler = vi.fn(async () => {})
    setJoinedLiveHandler(handler)
    server({ link: null })
    await expect(sendLiveLink('b_mine', { platform: 'youtube', body: { requestId: 'r1', video: 'https://youtu.be/abcdefghijk' } })).resolves.toEqual({ link: null })
    expect(handler).not.toHaveBeenCalled()
  })

  it('기억해 둔 화면 자료의 열쇠는 같이 보는 라이브가 바뀌면 달라진다', () => {
    const me = { seller: { name: '가게' }, loginId: 'shop1' }
    expect(cacheKeyOf(me)).toBe('shop1')
    expect(cacheKeyOf({ ...me, live: { broadcastId: 'b_owner', shopName: '비트다육' } })).toBe('shop1#b_owner')
  })
})

describe('D-SHARE-LIVE-01 마이크는 먼저 켠 기기 하나만', () => {
  it('다른 기기가 마이크를 쥐고 있으면 이 기기 마이크는 조용히 꺼진다 — 듣기 멈춤·문제 문장 없음', async () => {
    const audio = new FakeNativeAudio()
    const clock = new FakeClock()
    const session = new VoiceSession({ audio, register: async () => {}, undoRegister: async () => {}, ticket: async () => ({ wsUrl: 'wss://test.local/api/voice/stream', token: 't' }), now: () => clock.now, timer: clock })
    await session.turnOn('b1', '라이브')
    await session.acceptConsent()
    expect(session.getView().on).toBe(true)
    audio.setState({ kind: 'stopped', message: VOICE_OTHER_DEVICE })
    await flush()
    expect(session.getView().on).toBe(false)
    expect(session.getView().state.kind).toBe('off')
    expect(session.getView().problem).toBeNull()
  })

  it('라이브 소리 상태가 "다른 기기 마이크"면 [휴대폰 마이크 켜기]를 보이지 않는다 — 그 기기가 라이브 소리로 바꾸면 보인다', () => {
    const off = { on: false, kind: 'off', allowed: true } as const
    expect(listenNow('mic', off, { phase: 'mic' } as never)).toMatchObject({ hearing: 'otherMic', canMic: false })
    expect(listenNow('mic', off, { phase: 'listening', lagMs: 0 } as never)).toMatchObject({ hearing: 'stream', canMic: true })
  })
})
