// 실제 웹캐스트 연결기 감싸개 (D-904, D-N2b-1-01·06·07, AC-N2b-1-01~04). tiktok-live-connector를 import하는 파일은 모듈 안에서 이것 하나뿐이다.
// 라이브러리는 2.1.0(마지막 MIT 정식판)에 고정한다 — 2.4.0부터 AGPL-3.0이다. AGPL 판의 코드는 복사하거나 옮겨 적지 않는다.
// 넘기는 값은 (아이디, 허용 목록 옵션)뿐이다: 세션·쿠키·인증·프록시·머리글 덮어쓰기 옵션은 넘기지 않고, 글을 올리는 조작은 부르지 않는다.
// 이벤트 꺼내기·실패 종류 가르기는 가짜 웹캐스트와 같은 코드(comment.ts·failure.ts)가 한다. 여기는 클라이언트를 만드는 곳이다.
import { TikTokLiveConnection } from 'tiktok-live-connector'
import { systemTikTokClock, type TikTokClock } from './clock.ts'
import type { TikTokLibraryOptions } from './settings.ts'
import type { WebcastClient, WebcastFactory } from './webcast.ts'

/** 라이브러리 연결 객체 중 감싸개가 쓰는 부분 (2.1.0 TikTokLiveConnection) */
export interface LibraryConnectionLike {
  connect(): Promise<unknown>
  disconnect(): Promise<void> | void
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/** 라이브러리 생성자 모양 — 시험에서 바꿔 끼운다 (넘기는 값 확인, AC-N2b-1-03) */
export type LibraryConnectionConstructor = new (uniqueId: string, options: TikTokLibraryOptions) => LibraryConnectionLike

export interface LibraryWebcastOptions {
  /** 라이브러리 생성자 (기본: tiktok-live-connector 2.1.0 TikTokLiveConnection) */
  readonly Connection?: LibraryConnectionConstructor
  /** 앞 시도를 기다리는 시간을 재는 시계 (기본 실제 시계) */
  readonly clock?: TikTokClock
}

/** 같은 아이디의 앞 연결 시도가 끝나기를 이만큼까지 기다린 뒤 새 시도를 연다 (D-N2b-2-11 (나)) */
export const TIKTOK_LINGER_WAIT_MS = 20_000

const DEFAULT_CONNECTION = TikTokLiveConnection as unknown as LibraryConnectionConstructor

function quietly(run: () => unknown): void {
  try {
    const result = run()
    if (result instanceof Promise) result.catch(() => undefined)
  } catch {
    // 닫다 난 오류는 무시한다
  }
}

/** 버린 시도라 열지 않았다 (연결 관리가 이미 버린 시도라 이 거부는 쓰이지 않는다) */
class AbandonedAttempt extends Error {}

/**
 * 라이브러리 연결 하나를 경계 모양으로. 라이브러리는 연결 시도 중에 닫을 수 없다(disconnect는 연결된 뒤에만 닫는다) —
 * 그래서 닫은 뒤에 늦게 성공하면 여기서 바로 한 번 닫고(라이브러리 안에서 웹소켓이 늦게 열린 경우 포함), 닫은 뒤의 이벤트는 넘기지 않는다.
 * 같은 아이디의 앞 시도가 아직 끝나지 않았으면(버렸어도 라이브러리 안에서는 도는 중) 그것이 끝나기를(늦게 열렸으면 닫히기를) 기다린 뒤 연다 —
 * 판매자 하나의 열린 라이브러리 연결은 어떤 순서에서도 많아야 하나다(AC-N2b-2-41). 기다리는 동안 버려지면 열지 않는다.
 */
function adapt(connection: LibraryConnectionLike, prior: Promise<void> | null, settle: () => void, clock: TikTokClock): WebcastClient {
  let closed = false
  let opened = false
  let finished = false
  /** 열린 뒤 한 번만 닫는다 */
  const finish = (): void => {
    if (finished) return
    finished = true
    quietly(() => connection.disconnect())
  }
  const waitPrior = async (before: Promise<void>): Promise<void> => {
    let cancel: () => void = () => undefined
    const timeout = new Promise<void>((resolve) => {
      cancel = clock.setTimer(TIKTOK_LINGER_WAIT_MS, resolve)
    })
    await Promise.race([before, timeout])
    cancel()
  }
  const open = async (): Promise<unknown> => {
    const state = await connection.connect()
    opened = true
    if (closed) finish()
    return state
  }
  return {
    connect() {
      // 앞 시도가 없으면 바로 연다 (부른 그 자리에서 라이브러리 connect를 부른다)
      const run =
        prior === null
          ? open()
          : waitPrior(prior).then(() => {
              if (closed) throw new AbandonedAttempt('abandoned')
              return open()
            })
      return run.finally(settle)
    },
    disconnect() {
      if (finished) return
      closed = true
      if (opened) finish()
      else quietly(() => connection.disconnect())
    },
    on(event, listener) {
      return connection.on(event, (...args: unknown[]) => {
        if (!closed) listener(...args)
      })
    },
  }
}

/** 실제 웹캐스트 클라이언트를 만드는 곳. 연결 시도마다 새 라이브러리 연결을 (아이디, 옵션)으로 만든다 */
export function libraryWebcast(options: LibraryWebcastOptions = {}): WebcastFactory {
  const Connection = options.Connection ?? DEFAULT_CONNECTION
  const clock = options.clock ?? systemTikTokClock
  /** 아이디마다 마지막 시도가 끝나는 약속 */
  const last = new Map<string, Promise<void>>()
  return (uniqueId, libraryOptions) => {
    const prior = last.get(uniqueId) ?? null
    let settle: () => void = () => undefined
    const mine = new Promise<void>((resolve) => {
      settle = resolve
    })
    last.set(uniqueId, mine)
    void mine.then(() => {
      if (last.get(uniqueId) === mine) last.delete(uniqueId)
    })
    return adapt(new Connection(uniqueId, libraryOptions), prior, settle, clock)
  }
}
