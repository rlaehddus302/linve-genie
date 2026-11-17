// 앱 전체에 하나인 것들 (로그인한 동안 모든 화면이 같은 것을 본다): 실시간 연결·라벨 대기열·음성 세션·자리를 비운 동안 셈·기기 ID.
// 화면은 useServices()로 받는다. 시험은 가짜 모듈·가짜 서버로 만든 묶음을 Provider에 넣는다.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Me, WriteResult } from '@livejjim/web/src/api/types.ts'
import { get, isApiError, newRequestId, onUnauthorized, post, withRetry, type ApiError } from './api/client.ts'
import { AwayTracker } from './lib/away.ts'
import { setCachedAccount } from './lib/cached-get.ts'
import { useAppForeground } from './lib/use-app-state.ts'
import { LabelQueue } from './lib/label-queue.ts'
import { createLiveStream, type LiveStream } from './lib/live.ts'
import { clearVoiceArchive, setVoiceAccount } from './lib/voice-preferences.ts'
import { createVoiceEffects } from './lib/voice-effects.ts'
import { VoiceSession } from './lib/voice-session.ts'
import { nativeAudio, nativeBle, nativeShare } from './native/index.ts'
import type { NativeAudio } from './native/audio.ts'
import type { NativeBlePrinter } from './native/ble.ts'
import { StreamKeep } from './lib/stream-keep.ts'

export interface Services {
  readonly deviceId: string
  readonly stream: LiveStream
  readonly labels: LabelQueue
  readonly voice: VoiceSession
  readonly away: AwayTracker
  /** 방송 화면을 나가도 듣는 방송 (D-UX3-48) */
  readonly streamKeep: StreamKeep
}

/** 기기 ID (영문·숫자·'_'·'-' 8~64자). 설치 때 한 번 만들어 저장한다 */
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
  if (broadcast === undefined) throw new Error('라이브를 찾지 못했다')
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

export interface PrinterTests {
  has(id: string): boolean
  set(id: string, yes: boolean): void
}

export function createServices(input: { readonly audio?: NativeAudio; readonly ble?: NativeBlePrinter; readonly deviceId?: string; readonly printerTests?: PrinterTests; readonly stream?: LiveStream } = {}): Services {
  const deviceId = input.deviceId ?? makeDeviceId()
  const stream = input.stream ?? createLiveStream(() => deviceId)
  const away = new AwayTracker()
  const labels = new LabelQueue({ ble: input.ble ?? nativeBle(), share: nativeShare(), ...(input.printerTests ? { printerTests: input.printerTests } : {}), deviceId, openStream: () => stream.open() })
  const voice = new VoiceSession({
    audio: input.audio ?? nativeAudio(),
    deviceId,
    effect: createVoiceEffects(scopeOf),
    register: registerFromVoice,
    undoRegister: closeFromVoice,
    onProcessed: () => away.noteVoice(),
  })
  return { deviceId, stream, labels, voice, away, streamKeep: new StreamKeep() }
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

/**
 * 로그인 확인이 실패한 뒤의 세션: 401만 '로그인 안 됨'. 그 밖(인터넷 끊김·서버를 새로 올리는 동안의 502·503)은 로그인이 풀린 게 아니라
 * 서버에 닿지 못한 것 — 이미 들어와 있으면 그대로, 아니면 offline (D-UX3-21)
 */
export function sessionAfterCheckError(error: unknown, current: Session): Session {
  if (isApiError(error) && error.status === 401) return { state: 'out', expired: false }
  return current.state === 'in' ? current : { state: 'out', expired: false, offline: true }
}

/** 서버에 닿지 못했을 때 다시 확인하는 간격 */
export const OFFLINE_RECHECK_MS = 5_000

/** offline: 첫 확인 때 서버에 닿지 못했다 — 로그인이 풀린 것이 아닐 수 있어 "다시 확인"을 보인다 (APP2 실기기: 서버가 안 닿으면 말없이 로그인 화면이 떠 로그아웃된 줄 알았다) */
export type Session = { readonly state: 'checking' } | { readonly state: 'out'; readonly expired: boolean; readonly offline?: boolean } | { readonly state: 'in'; readonly me: Me }

export interface SessionApi {
  readonly session: Session
  readonly login: (loginId: string, password: string) => Promise<void>
  readonly logout: () => Promise<void>
  readonly recheck: () => Promise<void>
}

const SessionContext = createContext<SessionApi | null>(null)

/**
 * 기억해 둔 화면 자료의 주인 열쇠: 아이디 + 같이 보는 라이브 (D-SHARE-LIVE-01) — 다른 계정의 라이브에 들어가거나 나오면 가게가 바뀌므로
 * 기억해 둔 자료를 지우고 새로 받는다
 */
export function cacheKeyOf(me: Me): string {
  return me.live === undefined ? me.loginId : `${me.loginId}#${me.live.broadcastId}`
}

let recheckNow: (() => Promise<void>) | null = null
/** 서버에서 내 정보를 다시 읽는다 — 같이 보는 라이브에 들어가거나 나온 뒤 (D-SHARE-LIVE-01) */
export function recheckSession(): Promise<void> {
  return recheckNow?.() ?? Promise.resolve()
}

export function SessionProvider({ children, services }: { readonly children: ReactNode; readonly services: Services }) {
  const [session, setSession] = useState<Session>({ state: 'checking' })
  /** 지금 화면 자료의 주인 열쇠 (cacheKeyOf) */
  const shownKey = useRef<string | null>(null)
  /** 들어온 계정·가게를 정한다. 같은 아이디라도 같이 보는 라이브가 바뀌면 실시간 연결을 새 가게로 다시 잇고 이 기기 마이크는 끈다 (D-SHARE-LIVE-01) */
  const settle = (me: Me) => {
    const key = cacheKeyOf(me)
    const switched = shownKey.current !== null && shownKey.current !== key && shownKey.current.split('#')[0] === me.loginId
    shownKey.current = key
    setVoiceAccount(me.loginId)
    // 다른 계정(가게)이면 기억해 둔 화면 자료를 지운다 (D-UX4-77)
    setCachedAccount(key)
    if (switched) {
      services.streamKeep.release()
      void services.voice.shutdown()
      services.stream.resume()
    }
  }

  const recheck = async () => {
    try {
      const me = await get<Me>('/api/me')
      settle(me)
      setSession({ state: 'in', me })
    } catch (error) {
      setSession((current) => sessionAfterCheckError(error, current))
    }
  }

  useEffect(() => {
    void recheck()
    recheckNow = recheck
    onUnauthorized(() => {
      services.streamKeep.release()
      void services.voice.shutdown()
      void clearVoiceArchive()
      services.stream.shutdown()
      // 로그인이 풀리면 기억해 둔 화면 자료도 지운다 — 다음에 들어오는 계정에 보이지 않게 (D-UX4-77)
      setCachedAccount(null)
      shownKey.current = null
      setSession({ state: 'out', expired: true })
    })
    return () => { onUnauthorized(null); recheckNow = null }
    // eslint 주석 없이: 처음 한 번만
  }, [])

  // 서버에 닿지 못한 동안은 5초마다 다시 확인한다 — 서버가 돌아오면 판매자가 아무것도 누르지 않아도 그대로 들어간다 (D-UX3-21)
  const offline = session.state === 'out' && session.offline === true
  useEffect(() => {
    if (!offline) return
    const timer = setInterval(() => void recheck(), OFFLINE_RECHECK_MS)
    return () => clearInterval(timer)
  }, [offline])

  useAppForeground({ onForeground: () => {
    if (session.state !== 'in') return
    services.stream.resume()
    services.labels.resume()
  } })

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
        shownKey.current = null
        settle(me)
        setSession({ state: 'in', me })
      },
      logout: async () => {
        services.streamKeep.release()
        await services.voice.shutdown()
        await clearVoiceArchive()
        try {
          await post('/api/logout', {})
        } catch (error) {
          if (!isApiError(error)) throw error
        }
        services.stream.shutdown()
        setCachedAccount(null)
        shownKey.current = null
        setSession({ state: 'out', expired: false })
      },
    }),
    [session, services],
  )
  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>
}

/** 세션 밖(화면 하나만 그리는 시험 등)에서도 쓰는 곳 — 없으면 null */
export function useSessionIfAny(): SessionApi | null {
  return useContext(SessionContext)
}

export function useSession(): SessionApi {
  const api = useContext(SessionContext)
  if (api === null) throw new Error('SessionProvider 안에서만 쓴다')
  return api
}

export type { ApiError }
