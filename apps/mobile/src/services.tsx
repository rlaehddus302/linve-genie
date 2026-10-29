// 앱 전체에 하나인 것들 (로그인한 동안 모든 화면이 같은 것을 본다): 실시간 연결·라벨 대기열·음성 세션·자리를 비운 동안 셈·기기 ID.
// 화면은 useServices()로 받는다. 시험은 가짜 모듈·가짜 서버로 만든 묶음을 Provider에 넣는다.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Me, WriteResult } from '@livejjim/web/src/api/types.ts'
import { get, isApiError, newRequestId, onUnauthorized, post, withRetry, type ApiError } from './api/client.ts'
import { AwayTracker } from './lib/away.ts'
import { LabelQueue } from './lib/label-queue.ts'
import { createLiveStream, type LiveStream } from './lib/live.ts'
import { clearVoiceArchive, setVoiceAccount } from './lib/voice-preferences.ts'
import { createVoiceEffects } from './lib/voice-effects.ts'
import { VoiceSession } from './lib/voice-session.ts'
import { nativeAudio, nativeBle } from './native/index.ts'
import type { NativeAudio } from './native/audio.ts'
import type { NativeBlePrinter } from './native/ble.ts'

export interface Services {
  readonly deviceId: string
  readonly stream: LiveStream
  readonly labels: LabelQueue
  readonly voice: VoiceSession
  readonly away: AwayTracker
}

/** 기기 ID (영문·숫자·'_'·'-' 8~64자). 앱이 켜져 있는 동안 하나 — 출력 기기 역할은 다시 열면 다시 고른다 */
export function makeDeviceId(random: () => number = Math.random): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = 'app'
  for (let i = 0; i < 20; i++) out += chars[Math.floor(random() * chars.length)] ?? 'a'
  return out
}

/** 방송 ID → 범위 (한 번 찾으면 기억한다) */
const scopes = new Map<string, { date: string; rehearsal: boolean }>()
async function scopeOf(broadcastId: string): Promise<{ date: string; rehearsal: boolean }> {
  const known = scopes.get(broadcastId)
  if (known !== undefined) return known
  const { broadcasts } = await get<{ broadcasts: { id: string; date: string; rehearsal: boolean }[] }>('/api/broadcasts')
  const broadcast = broadcasts.find((item) => item.id === broadcastId)
  if (broadcast === undefined) throw new Error('방송을 찾지 못했다')
  const scope = { date: broadcast.date, rehearsal: broadcast.rehearsal }
  scopes.set(broadcastId, scope)
  return scope
}

/** 바로 등록 요청: 서버가 읽은 결과로 product.register를 보낸다 (입력 우선 기록 — 서버가 이벤트로 먼저 적는다) */
async function registerFromVoice(broadcastId: string, reading: { readonly no: number | null; readonly name: string; readonly price: number | null }): Promise<void> {
  if (reading.no === null || reading.price === null) throw new Error('번호·가격이 없다')
  const requestId = newRequestId()
  await withRetry(() =>
    post<WriteResult>('/api/events', {
      requestId,
      type: 'product.register',
      b: broadcastId,
      no: reading.no,
      name: reading.name,
      price: reading.price,
    }),
  )
}

async function closeFromVoice(broadcastId: string, no: number): Promise<void> {
  const requestId = newRequestId()
  await withRetry(() => post<WriteResult>('/api/events', { requestId, type: 'product.close', b: broadcastId, no }))
}

export function createServices(input: { readonly audio?: NativeAudio; readonly ble?: NativeBlePrinter; readonly deviceId?: string; readonly stream?: LiveStream } = {}): Services {
  const deviceId = input.deviceId ?? makeDeviceId()
  const stream = input.stream ?? createLiveStream(() => deviceId)
  const away = new AwayTracker()
  const labels = new LabelQueue({ ble: input.ble ?? nativeBle(), deviceId, openStream: () => stream.open() })
  const voice = new VoiceSession({
    audio: input.audio ?? nativeAudio(),
    deviceId,
    effect: createVoiceEffects(scopeOf),
    register: registerFromVoice,
    undoRegister: closeFromVoice,
    onProcessed: () => away.noteVoice(),
  })
  return { deviceId, stream, labels, voice, away }
}

const ServicesContext = createContext<Services | null>(null)

export function ServicesProvider({ services, children }: { readonly services: Services; readonly children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
}

export function useServices(): Services {
  const services = useContext(ServicesContext)
  if (services === null) throw new Error('ServicesProvider 안에서만 쓴다')
  return services
}

// ── 세션 ──

export type Session = { readonly state: 'checking' } | { readonly state: 'out'; readonly expired: boolean } | { readonly state: 'in'; readonly me: Me }

export interface SessionApi {
  readonly session: Session
  readonly login: (loginId: string, password: string) => Promise<void>
  readonly logout: () => Promise<void>
  readonly recheck: () => Promise<void>
}

const SessionContext = createContext<SessionApi | null>(null)

export function SessionProvider({ children, services }: { readonly children: ReactNode; readonly services: Services }) {
  const [session, setSession] = useState<Session>({ state: 'checking' })

  const recheck = async () => {
    try {
      const me = await get<Me>('/api/me')
      setVoiceAccount(me.loginId)
      setSession({ state: 'in', me })
    } catch (error) {
      if (isApiError(error) && error.status === 401) setSession({ state: 'out', expired: false })
      else setSession((current) => (current.state === 'in' ? current : { state: 'out', expired: false }))
    }
  }

  useEffect(() => {
    void recheck()
    onUnauthorized(() => {
      void services.voice.shutdown()
      void clearVoiceArchive()
      services.stream.shutdown()
      setSession({ state: 'out', expired: true })
    })
    return () => onUnauthorized(null)
    // eslint 주석 없이: 처음 한 번만
  }, [])

  // 로그인한 동안 라벨 대기열(실시간 포함)을 켠다
  useEffect(() => {
    if (session.state !== 'in') return
    services.labels.start()
    return () => services.labels.stop()
  }, [session.state === 'in'])

  const api = useMemo<SessionApi>(
    () => ({
      session,
      recheck,
      login: async (loginId, password) => {
        const me = await post<Me>('/api/login', { loginId, password })
        setVoiceAccount(me.loginId)
        setSession({ state: 'in', me })
      },
      logout: async () => {
        await services.voice.shutdown()
        await clearVoiceArchive()
        try {
          await post('/api/logout', {})
        } catch (error) {
          if (!isApiError(error)) throw error
        }
        services.stream.shutdown()
        setSession({ state: 'out', expired: false })
      },
    }),
    [session, services],
  )
  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>
}

export function useSession(): SessionApi {
  const api = useContext(SessionContext)
  if (api === null) throw new Error('SessionProvider 안에서만 쓴다')
  return api
}

export type { ApiError }
